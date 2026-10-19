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
import { RELAYOUT_CHANNEL } from '../../shared/layout';
import { DeepSeekDriver } from './deepseek';
import { WebViewHost } from './webview';
import { readSessionBlob, sessionBlobPath, type SessionBlob } from './session-blob';
import { detectFakeCall, parseToolCall, type ParsedToolCall } from './sentinel';
import { executeTool, wrapToolResult, type ToolContext } from './tools';
import { detectDanger } from './tools/shell';
import { getMainWindow } from '../window';

export interface SessionEngineOptions {
  settings: Settings;
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

/**
 * 会话引擎。
 *
 * 与上一代最大的区别：不再启动外部 Chrome，也不再连 9222 端口。
 * 页面由 WebViewHost 在进程内托管，CDP 走 webContents.debugger，
 * 因此截图/鼠标/键盘全部零系统权限（不碰辅助功能、不碰屏幕录制）。
 */
export class SessionEngine extends EventEmitter {
  private settings: Settings;
  private host: WebViewHost;
  private driver: DeepSeekDriver | null = null;
  private state: SessionState = 'idle';
  private stats: SessionStats = {
    turns: 0,
    toolCalls: 0,
    state: 'idle',
    pageConnected: false,
    loggedIn: false
  };
  private pending: PendingApproval | null = null;
  private abortController: AbortController | null = null;
  private alwaysAllow = new Set<string>();
  /** 系统提示词是否已注入当前会话 */
  private promptInjected = false;

  constructor(private opts: SessionEngineOptions) {
    super();
    this.settings = opts.settings;
    this.host = new WebViewHost(opts.settings);
    this.alwaysAllow = new Set(opts.settings.alwaysAllow ?? []);
    this.host.on('status', (e: { status: string; url?: string; detail?: string }) => {
      if (e.detail) this.log('info', e.detail);
    });
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
    this.host.updateSettings(s);
    this.alwaysAllow = new Set(s.alwaysAllow ?? []);
  }

  getState(): SessionState {
    return this.state;
  }

  getHost(): WebViewHost {
    return this.host;
  }

  getDriver(): DeepSeekDriver | null {
    return this.driver;
  }

  /**
   * 窗口尺寸变化时让渲染层重新测量占位 div 并回报矩形。
   * 主进程不自己算高度：顶栏/输入区高度由 DOM 决定，硬算必然错位。
   */
  layout(): void {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send(RELAYOUT_CHANNEL);
  }

  async boot(): Promise<void> {
    if (this.state === 'booting') return;
    const win = getMainWindow();
    if (!win || win.isDestroyed()) {
      this.setState('error', '主窗口尚未创建');
      return;
    }
    this.setState('booting', '启动内嵌页面…');
    try {
      // 初始矩形给个兜底值，渲染层挂载后会立刻用实测矩形覆盖
      const [w, h] = win.getContentSize();
      await this.host.attach(win, { x: 0, y: 45, width: w - 248, height: Math.max(1, h - 141) });

      const client = this.host.getClient();
      if (!client) throw new Error('内嵌页面 CDP 未就绪');
      this.driver = new DeepSeekDriver(client);
      this.stats.pageConnected = true;

      const ready = await this.host.waitForReady(45_000);
      if (!ready) {
        this.stats.loggedIn = false;
        this.setState('ready', '等待登录 DeepSeek');
        this.emitStats();
        return;
      }
      this.stats.loggedIn = await this.driver.isLoggedIn().catch(() => false);

      // 未登录但本地有备份 → 自动导入（换机/重装后不用再手动选文件）
      if (!this.stats.loggedIn) {
        const blobFile = sessionBlobPath();
        if (fs.existsSync(blobFile)) {
          const blob = readSessionBlob(blobFile);
          if (blob && blob.cookies.length) {
            this.log('info', `检测到登录态备份，正在导入 ${blob.cookies.length} 条 cookie…`);
            try {
              await this.host.importSession(blob);
              await this.host.waitForReady(20_000);
              this.stats.loggedIn = await this.driver.isLoggedIn().catch(() => false);
            } catch {
              /* 导入失败就走手动登录 */
            }
          }
        }
      }

      this.setState('ready', this.stats.loggedIn ? '已就绪' : '等待登录 DeepSeek');
      this.emitStats();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState('error', msg);
      this.emitEvent({ type: 'error', message: msg, fatal: true });
    }
  }

  async reconnect(): Promise<void> {
    this.host.getClient()?.close();
    this.driver = null;
    this.stats.pageConnected = false;
    this.setState('idle');
    try {
      await this.host.reload();
      const client = this.host.getClient();
      if (client) {
        this.driver = new DeepSeekDriver(client);
        this.stats.pageConnected = true;
        await this.host.waitForReady(30_000);
        this.stats.loggedIn = await this.driver.isLoggedIn().catch(() => false);
        this.setState('ready', this.stats.loggedIn ? '已就绪' : '等待登录 DeepSeek');
      }
    } catch (err) {
      this.setState('error', err instanceof Error ? err.message : String(err));
    }
    this.emitStats();
  }

  async shutdown(): Promise<void> {
    try {
      this.abortController?.abort();
      await this.host.destroy();
    } catch {
      /* ignore */
    }
    this.driver = null;
    this.stats.pageConnected = false;
    this.stats.loggedIn = false;
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

  /** 显示/隐藏内嵌网页（隐藏后 CDP 仍可用，后台静默跑） */
  setPageVisible(v: boolean): boolean {
    this.host.setVisible(v);
    return this.host.isVisible();
  }

  isPageVisible(): boolean {
    return this.host.isVisible();
  }

  async exportSession(): Promise<SessionBlob> {
    return await this.host.exportSession();
  }

  async importSession(blob: SessionBlob): Promise<{ cookies: number; storage: number }> {
    const r = await this.host.importSession(blob);
    if (this.driver) {
      this.stats.loggedIn = await this.driver.isLoggedIn().catch(() => false);
      this.emitStats();
    }
    return r;
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
      await this.runTurn(outbound, files, driver, tempDir);
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
    let nextPayload: { text?: string; files?: string[] } | null = { text: firstText, files: firstFiles };
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
          message: `等待回复超时（${this.settings.replyTimeoutMs}ms）。请确认内嵌页面没有停在验证码/登录页。`
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
        skillsDir: this.opts.skillsDir,
        webContents: () => this.host.getWebContents(),
        client: () => this.host.getClient(),
        uploadFiles: (f) => driver.uploadFiles(f)
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

      // 截图产出 → 作为消息图片挂到卡片上，渲染层据此显示缩略图
      if (execResult.files?.length) {
        assistantMsg.images = execResult.files.map((f) => ({ path: f, name: path.basename(f) }));
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
