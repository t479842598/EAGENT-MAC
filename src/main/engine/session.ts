import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type {
  ChatMessage,
  SessionEvent,
  SessionState,
  SessionStats,
  Settings,
  ToolCall
} from '../../shared/types';
import { BrowserManager } from './browser';
import { CdpClient, CdpError } from './cdp';
import { DeepSeekDriver } from './deepseek';
import { buildSystemPrompt } from './prompt';
import { detectFakeCall, parseToolCall, type ParsedToolCall } from './sentinel';
import { executeTool, wrapToolResult, type ToolContext } from './tools';
import { detectDanger } from './tools/shell';

export interface SessionEngineOptions {
  settings: Settings;
  macinputPath: string;
  skillsDir: string;
  systemPromptPath: string;
  /** 系统提示词正文：首轮对话前注入，之后靠对话历史维持 */
  systemPrompt: string;
  /** 设置变更回调：用户点「始终允许」时把白名单落盘，否则重启 App 就丢 */
  onSettingsChange?: (patch: Partial<Settings>) => void;
}

interface PendingApproval {
  call: ToolCall;
  parsed: ParsedToolCall;
  resolve: (verdict: 'allow_once' | 'always_allow' | 'deny') => void;
}

const now = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

export class SessionEngine extends EventEmitter {
  private settings: Settings;
  private browser: BrowserManager;
  private driver: DeepSeekDriver | null = null;
  private client: CdpClient | null = null;
  private state: SessionState = 'idle';
  private stats: SessionStats = {
    turns: 0,
    toolCalls: 0,
    state: 'idle',
    chromeConnected: false,
    loggedIn: false
  };
  private pending: PendingApproval | null = null;
  private abortController: AbortController | null = null;
  private alwaysAllow = new Set<string>();
  private booted = false;
  /** 系统提示词是否已注入当前会话 */
  private promptInjected = false;

  constructor(private opts: SessionEngineOptions) {
    super();
    this.settings = opts.settings;
    this.browser = new BrowserManager(opts.settings);
    this.alwaysAllow = new Set(opts.settings.alwaysAllow ?? []);
  }

  // ---------- 事件 ----------

  private emitEvent(e: SessionEvent) {
    this.emit('event', e);
  }

  private log(level: 'info' | 'warn' | 'error', text: string) {
    this.emitEvent({ type: 'log', level, text });
  }

  private setState(state: SessionState, detail?: string) {
    this.state = state;
    this.stats.state = state;
    this.emitEvent({ type: 'state', state, detail });
    this.emitStats();
  }

  private emitStats() {
    this.emitEvent({ type: 'stats', stats: { ...this.stats } });
  }

  // ---------- 生命周期 ----------

  updateSettings(s: Settings) {
    this.settings = s;
    this.browser.updateSettings(s);
    this.alwaysAllow = new Set(s.alwaysAllow ?? []);
  }

  getState(): SessionState {
    return this.state;
  }

  /** 供 doctor 使用的只读句柄 */
  getBrowser(): BrowserManager {
    return this.browser;
  }

  getDriver(): DeepSeekDriver | null {
    return this.driver;
  }

  async boot(): Promise<void> {
    if (this.state === 'booting' || this.state === 'ready' || this.state === 'awaiting') return;
    this.setState('booting', '启动 Chrome…');
    try {
      const launch = await this.browser.launch();
      this.log('info', launch.alreadyRunning ? 'Chrome 调试端口已在运行，复用现有实例' : `Chrome 已启动 (pid=${launch.pid})`);

      this.setState('booting', '连接 CDP…');
      const client = await this.browser.connect();
      this.client = client;
      const driver = new DeepSeekDriver(client);
      this.driver = driver;
      this.stats.chromeConnected = true;

      // 等页面加载出输入框
      for (let i = 0; i < 40; i++) {
        if (await driver.hasInput()) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      this.stats.loggedIn = await driver.isLoggedIn();
      this.booted = true;
      this.setState('ready', this.stats.loggedIn ? '已就绪' : '等待登录 DeepSeek');
      this.emitStats();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState('error', msg);
      this.emitEvent({ type: 'error', message: msg, fatal: true });
    }
  }

  async reconnect(): Promise<void> {
    this.client?.close();
    this.client = null;
    this.driver = null;
    this.booted = false;
    this.stats.chromeConnected = false;
    this.setState('idle');
    await this.boot();
  }

  async shutdown(): Promise<void> {
    try {
      this.abortController?.abort();
      await this.browser.close();
    } catch {
      /* ignore */
    }
    this.client?.close();
    this.client = null;
    this.driver = null;
    this.stats.chromeConnected = false;
    this.stats.loggedIn = false;
    this.booted = false;
    this.setState('idle', '已关闭');
  }

  async abort(): Promise<void> {
    this.abortController?.abort();
    this.abortController = null;
    if (this.pending) {
      this.pending.resolve('deny');
      this.pending = null;
    }
    this.setState('ready', '已中止');
  }

  // ---------- 会话主循环 ----------

  async send(text: string, files: string[] = []): Promise<void> {
    if (!this.driver) {
      await this.boot();
      if (!this.driver) throw new Error('引擎未就绪');
    }
    const busyStates: SessionState[] = [
      'awaiting',
      'sending',
      'executing',
      'parsing',
      'feeding',
      'pending_approval'
    ];
    if (busyStates.includes(this.state)) {
      throw new Error('上一轮尚未结束');
    }

    this.abortController = new AbortController();
    const driver = this.driver!;
    const tempDir = this.opts.systemPromptPath ? path.dirname(this.opts.systemPromptPath) : os.tmpdir();

    const userMsg: ChatMessage = {
      id: randomUUID(),
      role: 'user',
      text,
      time: now(),
      attachments: files.map((f) => ({
        id: randomUUID(),
        name: path.basename(f),
        path: f,
        size: formatSize(safeStat(f)),
        category: categorize(f)
      }))
    };
    this.emitEvent({ type: 'user_msg', message: userMsg });

    this.stats.turns++;
    this.setState('sending', '发送中…');

    try {
      // 首轮把系统提示词拼在用户消息前面（与上游 EAgent 同策略）
      let outbound = text;
      if (!this.promptInjected && this.opts.systemPrompt) {
        outbound = `${this.opts.systemPrompt}\n\n---\n\n${text}`;
        this.promptInjected = true;
      }
      const result = await this.runTurn(outbound, files, driver, tempDir);
      if (!result) return; // 已由 runTurn 内部收尾
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitEvent({ type: 'error', message: msg });
      this.setState('error', msg);
    }
  }

  /**
   * 一轮完整交互：发送 → 等回复 → 解析工具 → 执行 → 回填 → 再等回复，
   * 直到 AI 不再调用工具（或用户中止 / 出错）。
   */
  private async runTurn(
    firstText: string,
    firstFiles: string[],
    driver: DeepSeekDriver,
    tempDir: string
  ): Promise<boolean> {
    let nextPayload: { text?: string; files?: string[] } = { text: firstText, files: firstFiles };
    let guard = 0;
    // 关键：abort() 会把 this.abortController 置 null，所以必须在这里捕获同一个 signal 引用，
    // 否则后面的 signal.aborted 判断会读到 null 而漏掉中止。
    const signal = this.abortController?.signal;

    while (nextPayload) {
      if (guard++ > 30) {
        this.emitEvent({ type: 'error', message: '工具调用轮次超过 30，已自动停止' });
        break;
      }
      const { text, files } = nextPayload;

      this.setState('awaiting', '等待 DeepSeek 回复…');
      const t0 = Date.now();
      const res = await driver.sendAndWait({
        text,
        files,
        timeoutMs: this.settings.replyTimeoutMs,
        signal
      });
      this.stats.lastLatencyMs = Date.now() - t0;
      if (signal?.aborted) {
        this.setState('ready', '已中止');
        return false;
      }

      const messageId = randomUUID();
      const assistantMsg: ChatMessage = {
        id: messageId,
        role: 'assistant',
        text: res.text || '(空回复)',
        time: now(),
        images: []
      };

      if (res.timedOut && !res.text) {
        this.emitEvent({
          type: 'error',
          message: `等待回复超时（${this.settings.replyTimeoutMs}ms）。请检查 Chrome 窗口是否卡在验证码/登录页。`
        });
        this.setState('error', '等待回复超时');
        return false;
      }

      this.setState('parsing', '解析工具调用…');
      const call = parseToolCall(res.text);

      if (!call) {
        const fake = detectFakeCall(res.text);
        if (fake) {
          this.emitEvent({ type: 'assistant_done', message: assistantMsg });
          this.log('warn', `检测到假调用（${fake}），已回填错误提示让模型重写`);
          nextPayload = {
            text: `!![工具][错误]!! 你提到了 ${fake} 工具，但没有按哨兵格式书写。请只输出一个代码块，并逐字照抄哨兵行（含「本行注释一定要完全保留」）。`
          };
          continue;
        }
        this.emitEvent({ type: 'assistant_done', message: assistantMsg });
        this.setState('ready', '本轮结束');
        this.stats.loggedIn = await driver.isLoggedIn().catch(() => this.stats.loggedIn);
        this.emitStats();
        return true;
      }

      // 有工具调用 —— 先落卡片，等授权
      const toolCall: ToolCall = {
        id: randomUUID(),
        name: call.name,
        raw: call.raw,
        params: call.params,
        summary: call.summary,
        status: 'pending_approval',
        startedAt: Date.now(),
        dangerReason: call.name === 'shell' ? detectDanger(String(call.params.script ?? '')) ?? undefined : undefined
      };
      assistantMsg.toolCall = toolCall;
      this.emitEvent({ type: 'assistant_done', message: assistantMsg });

      const verdict = await this.awaitApproval(toolCall, call);
      // 急停会以 deny 结束等待，此时不应再回填「用户拒绝」让模型继续，直接收尾
      if (signal?.aborted) {
        this.emitEvent({
          type: 'tool_update',
          messageId,
          callId: toolCall.id,
          patch: { status: 'denied', finishedAt: Date.now(), output: '已急停' }
        });
        this.setState('ready', '已中止');
        return false;
      }
      if (verdict === 'deny') {
        this.emitEvent({
          type: 'tool_update',
          messageId,
          callId: toolCall.id,
          patch: { status: 'denied', finishedAt: Date.now(), output: '用户拒绝执行' }
        });
        nextPayload = { text: '//[工具][取回结果]//\n[工具]用户拒绝执行命令\n//[END]//' };
        continue;
      }

      // 执行
      this.setState('executing', call.summary);
      this.emitEvent({
        type: 'tool_update',
        messageId,
        callId: toolCall.id,
        patch: { status: 'running' }
      });

      const ctx: ToolContext = {
        settings: this.settings,
        tempDir,
        macinputPath: this.opts.macinputPath,
        skillsDir: this.opts.skillsDir,
        uploadFiles: (files) => driver.uploadFiles(files)
      };

      let execResult;
      try {
        execResult = await executeTool(call, ctx, signal);
      } catch (err) {
        execResult = {
          ok: false,
          output: `[工具][错误] ${err instanceof Error ? err.message : String(err)}`
        };
      }

      this.stats.toolCalls++;
      this.emitEvent({
        type: 'tool_update',
        messageId,
        callId: toolCall.id,
        patch: {
          status: execResult.ok ? 'success' : 'error',
          output: execResult.output,
          finishedAt: Date.now()
        }
      });

      // 截图等产出文件 → 进消息图集
      if (execResult.files?.length) {
        this.emitEvent({
          type: 'tool_update',
          messageId,
          callId: toolCall.id,
          patch: { output: execResult.output }
        });
      }

      this.setState('feeding', '回填工具结果…');
      nextPayload = { text: wrapToolResult(execResult) };
    }

    this.setState('ready', '本轮结束');
    return true;
  }

  private awaitApproval(call: ToolCall, parsed: ParsedToolCall): Promise<'allow_once' | 'always_allow' | 'deny'> {
    const autoAllowed =
      (this.settings.autoApprove && !call.dangerReason) ||
      (this.alwaysAllow.has(call.name) && !call.dangerReason);

    if (autoAllowed) {
      return Promise.resolve('allow_once');
    }

    return new Promise((resolve) => {
      this.pending = { call, parsed, resolve };
      this.setState('pending_approval', `等待授权：${call.summary}`);
    });
  }

  resolveApproval(callId: string, verdict: 'allow_once' | 'always_allow' | 'deny'): boolean {
    if (!this.pending || this.pending.call.id !== callId) return false;
    const { call, resolve } = this.pending;
    this.pending = null;
    if (verdict === 'always_allow') {
      this.alwaysAllow.add(call.name);
      const next = Array.from(this.alwaysAllow) as Settings['alwaysAllow'];
      this.settings.alwaysAllow = next;
      this.opts.onSettingsChange?.({ alwaysAllow: next });
    }
    resolve(verdict);
    return true;
  }
}

function safeStat(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

function formatSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function categorize(p: string): 'code' | 'pdf' | 'image' | 'text' | 'archive' | 'general' {
  const ext = path.extname(p).toLowerCase();
  if (['.pdf'].includes(ext)) return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.bmp'].includes(ext)) return 'image';
  if (['.zip', '.tar', '.gz', '.tgz', '.7z', '.rar'].includes(ext)) return 'archive';
  if (['.ts', '.tsx', '.js', '.jsx', '.py', '.swift', '.go', '.rs', '.c', '.cpp', '.java', '.sh', '.json', '.yml', '.yaml', '.toml'].includes(ext)) return 'code';
  if (['.txt', '.md', '.log', '.csv'].includes(ext)) return 'text';
  return 'general';
}
