import fs from 'node:fs';
import type { CdpClient } from './cdp';
import { CdpError } from './cdp';
import { loadSelectors } from './selectors';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SendOptions {
  text?: string;
  files?: string[];
  timeoutMs?: number;
  /** 轮询间隔，默认 300ms（对齐上游） */
  pollMs?: number;
  /** 文本连续稳定 tick 数，默认 7（≈2.1s） */
  stableTicks?: number;
  onProgress?: (info: { elapsedMs: number; chars: number }) => void;
  signal?: AbortSignal;
}

export interface SendResult {
  text: string;
  elapsedMs: number;
  sawNew: boolean;
  timedOut: boolean;
}

function jsString(s: string): string {
  return JSON.stringify(s);
}

/**
 * DeepSeek 网页驱动。
 *
 * 与前代（外部 Chrome 版）的差异：
 *  1. 文本注入从「原生 setter + dispatch input」改为 CDP Input.insertText ——
 *     前者在 React 受控组件上不会同步状态，发送按钮保持 disabled，实测完全发不出去。
 *  2. 发送从「派发合成 KeyboardEvent」改为 Input.dispatchKeyEvent —— 合成事件被 React 忽略。
 *  3. 不再调用 Page.bringToFront（内嵌视图可能处于隐藏态，且无需抢前台）。
 */
export class DeepSeekDriver {
  constructor(private client: CdpClient) {}

  private sel() {
    return loadSelectors();
  }

  async snapshot(): Promise<{ assistantCount: number; userCount: number; lastAssistant: string }> {
    const s = this.sel();
    const expr = `(() => {
      const sels = ${JSON.stringify(s.assistant)};
      let nodes = [];
      for (const sel of sels) {
        const found = document.querySelectorAll(sel);
        if (found.length) { nodes = Array.from(found); break; }
      }
      const users = document.querySelectorAll(${jsString(s.user.join(','))});
      const last = nodes.length ? (nodes[nodes.length - 1].innerText || '') : '';
      return { assistantCount: nodes.length, userCount: users.length, lastAssistant: last };
    })()`;
    const res = await this.client.evaluate<{
      assistantCount: number;
      userCount: number;
      lastAssistant: string;
    }>(expr);
    return res ?? { assistantCount: 0, userCount: 0, lastAssistant: '' };
  }

  async hasStopButton(): Promise<boolean> {
    const s = this.sel();
    const expr = `(() => {
      const sel = ${jsString(s.stopButton.join(','))};
      return !!document.querySelector(sel);
    })()`;
    const res = await this.client.evaluate<boolean>(expr);
    return !!res;
  }

  async hasInput(): Promise<boolean> {
    const s = this.sel();
    const expr = `(() => !!document.querySelector(${jsString(s.input.join(','))}))()`;
    const res = await this.client.evaluate<boolean>(expr);
    return !!res;
  }

  /** 输入框当前内容（用于校验注入是否生效） */
  async inputValue(): Promise<string> {
    const s = this.sel();
    const expr = `(() => {
      const el = document.querySelector(${jsString(s.input.join(','))});
      return el ? (el.value ?? '') : '';
    })()`;
    const res = await this.client.evaluate<string>(expr);
    return res ?? '';
  }

  async isLoggedIn(): Promise<boolean> {
    if (!(await this.hasInput())) return false;
    // 登录态以 localStorage.userToken 为准：正文里「登录」二字经常出现在侧栏历史标题中，
    // 按整页 innerText 判断会误判为未登录。
    const expr = `(() => {
      try {
        const raw = localStorage.getItem('userToken');
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        const token = parsed && (parsed.value ?? parsed.token);
        if (!token) return false;
        const hasComposer = !!document.querySelector('textarea');
        const loginModal = !!document.querySelector('[class*="login-modal"],[class*="loginModal"]');
        return hasComposer && !loginModal;
      } catch (e) {
        return false;
      }
    })()`;
    const res = await this.client.evaluate<boolean>(expr);
    return !!res;
  }

  async uploadFiles(files: string[]): Promise<boolean> {
    const existing = files.filter((f) => fs.existsSync(f));
    if (!existing.length) return false;
    const s = this.sel();
    for (const selector of s.fileInput) {
      try {
        const ok = await this.client.setFilesOnInput(existing, selector);
        if (ok) {
          await sleep(400);
          return true;
        }
      } catch {
        /* try next selector */
      }
    }
    return false;
  }

  /** 聚焦输入框并清空（若已有内容先全选） */
  async focusInput(): Promise<boolean> {
    const s = this.sel();
    const expr = `(() => {
      const el = document.querySelector(${jsString(s.input.join(','))});
      if (!el) return false;
      el.focus();
      el.setSelectionRange && el.setSelectionRange(0, (el.value || '').length);
      return true;
    })()`;
    const res = await this.client.evaluate<boolean>(expr);
    return !!res;
  }

  /**
   * 注入文本。必须走 CDP Input.insertText：真实输入事件才能让 React 同步状态、
   * 把发送按钮从 disabled 切到 enabled。
   */
  async injectText(text: string): Promise<boolean> {
    if (!(await this.focusInput())) return false;
    await this.client.insertText(text);
    await sleep(200);
    const v = await this.inputValue();
    return v.length > 0;
  }

  async pressEnter(): Promise<void> {
    await this.client.pressEnter();
  }

  /** 点击发送按钮（作为 Enter 发送失败时的兜底） */
  async clickSendButton(): Promise<boolean> {
    const s = this.sel();
    const expr = `(() => {
      const list = Array.from(document.querySelectorAll(${jsString(s.sendButton.join(','))}));
      if (!list.length) return null;
      const w = window.innerWidth, h = window.innerHeight;
      const filtered = list.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.x > w * 0.4 && r.y > h * 0.5 && r.width > 0 && r.height > 0;
      });
      const target = filtered[0] || list[0];
      const r = target.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`;
    const pos = await this.client.evaluate<{ x: number; y: number } | null>(expr);
    if (!pos) return false;
    await this.client.mouseClick(pos.x, pos.y, 'left');
    return true;
  }

  async sendAndWait(opts: SendOptions): Promise<SendResult> {
    const started = Date.now();
    const timeoutMs = opts.timeoutMs ?? 180_000;
    const pollMs = opts.pollMs ?? 300;
    const stableTicks = opts.stableTicks ?? 7;

    if (!(await this.hasInput())) {
      throw new Error('页面未就绪：找不到输入框。请在内嵌页面完成登录后重试。');
    }

    const before = await this.snapshot();

    if (opts.files?.length) {
      const ok = await this.uploadFiles(opts.files);
      if (!ok) throw new Error('文件上传失败：未找到 file input 或文件不存在');
      await sleep(500);
    }

    const hasText = !!(opts.text && opts.text.trim());
    if (hasText) {
      const ok = await this.injectText(opts.text!);
      if (!ok) throw new Error('文本注入失败：输入框未接受内容');
      await sleep(120);
      await this.pressEnter();
    } else {
      const ok = await this.clickSendButton();
      if (!ok) throw new Error('发送失败：未找到发送按钮');
    }

    let sawNew = false;
    let lastText = '';
    let stable = 0;
    let best = '';

    while (Date.now() - started < timeoutMs) {
      if (opts.signal?.aborted) {
        return {
          text: best || lastText,
          elapsedMs: Date.now() - started,
          sawNew,
          timedOut: false
        };
      }
      await sleep(pollMs);
      let snap: { assistantCount: number; userCount: number; lastAssistant: string } | null = null;
      try {
        snap = await this.snapshot();
      } catch (err) {
        if (err instanceof CdpError && err.code === 'BROKEN') throw err;
        continue;
      }
      if (!snap) continue;

      const grew = snap.assistantCount > before.assistantCount;
      const changed = snap.lastAssistant !== before.lastAssistant;
      if (!sawNew && (grew || (changed && snap.lastAssistant.trim().length > 0))) {
        sawNew = true;
        lastText = snap.lastAssistant;
        stable = 0;
        best = lastText;
        continue;
      }
      if (!sawNew) continue;

      const cur = snap.lastAssistant;
      best = cur.length >= best.length ? cur : best;

      if (cur === lastText) {
        stable++;
      } else {
        stable = 0;
        lastText = cur;
      }

      let stopVisible = false;
      try {
        stopVisible = await this.hasStopButton();
      } catch {
        stopVisible = false;
      }
      if (stable >= stableTicks && !stopVisible) {
        return { text: best, elapsedMs: Date.now() - started, sawNew, timedOut: false };
      }
      opts.onProgress?.({ elapsedMs: Date.now() - started, chars: best.length });
    }

    return { text: best || lastText, elapsedMs: Date.now() - started, sawNew, timedOut: true };
  }

  /** 选择器探针：给 doctor 用 */
  async probeSelectors(): Promise<Record<string, number>> {
    const s = this.sel();
    const expr = `(() => {
      const keys = ${JSON.stringify(s)};
      const out = {};
      for (const k of Object.keys(keys)) {
        const list = keys[k];
        let n = 0;
        for (const sel of list) {
          try { n = Math.max(n, document.querySelectorAll(sel).length); } catch (e) {}
        }
        out[k] = n;
      }
      return out;
    })()`;
    const res = await this.client.evaluate<Record<string, number>>(expr);
    return res ?? {};
  }

  /** 新建会话（点击「开启新对话」），避免历史消息影响计数 */
  async newConversation(): Promise<boolean> {
    const expr = `(() => {
      const all = Array.from(document.querySelectorAll('div,button,a,span'));
      const t = all.find((e) => {
        const txt = (e.innerText || '').trim();
        return (txt === '开启新对话' || txt === '新会话' || txt === 'New chat') && e.offsetHeight > 15 && e.offsetHeight < 80;
      });
      if (!t) return false;
      t.click();
      return true;
    })()`;
    const res = await this.client.evaluate<boolean>(expr);
    if (res) await sleep(1200);
    return !!res;
  }
}
