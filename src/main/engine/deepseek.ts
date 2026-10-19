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
 * DeepSeek 网页驱动。逻辑对齐上游 2_发送并等待回复.ps1：
 *  快照 → 上传 → 注入文本 → 发送 → 轮询（sawNew + 连续稳定）→ 回收
 * 差异：全 UTF-8（无 GBK 转码）；新增「停止生成按钮消失」作为并行完成判据。
 */
export class DeepSeekDriver {
  constructor(private client: CdpClient) {}

  private sel() {
    return loadSelectors();
  }

  async snapshot(): Promise<{ assistantCount: number; userCount: number; lastAssistant: string }> {
    const s = this.sel();
    const expr = `(() => {
      const asst = document.querySelectorAll(${jsString(s.assistant.join(','))});
      const users = document.querySelectorAll(${jsString(s.user.join(','))});
      const last = asst.length ? (asst[asst.length - 1].innerText || '') : '';
      return { assistantCount: asst.length, userCount: users.length, lastAssistant: last };
    })()`;
    const res = await this.client.evaluate<{ assistantCount: number; userCount: number; lastAssistant: string }>(expr);
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
        // 有输入框 + 有 token + 页面没有全屏登录弹层
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

  /** 用原生 setter 注入文本，绕过 React 受控组件 */
  async injectText(text: string): Promise<boolean> {
    const s = this.sel();
    const expr = `(() => {
      const ta = document.querySelector(${jsString(s.input.join(','))});
      if (!ta) return false;
      const proto = ta instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(ta, ${jsString(text)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      ta.focus();
      return ta.value.length > 0;
    })()`;
    const res = await this.client.evaluate<boolean>(expr);
    return !!res;
  }

  async pressEnter(): Promise<void> {
    const expr = `(() => {
      const ta = document.querySelector(${jsString(this.sel().input.join(','))});
      const target = ta || document.body;
      const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
      target.dispatchEvent(new KeyboardEvent('keydown', opts));
      target.dispatchEvent(new KeyboardEvent('keypress', opts));
      target.dispatchEvent(new KeyboardEvent('keyup', opts));
      return true;
    })()`;
    await this.client.evaluate(expr);
  }

  async clickSendButton(): Promise<boolean> {
    const s = this.sel();
    const expr = `(() => {
      const list = Array.from(document.querySelectorAll(${jsString(s.sendButton.join(','))}));
      if (!list.length) return false;
      const w = window.innerWidth, h = window.innerHeight;
      const filtered = list.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.x > w * 0.5 && r.y > h * 0.6 && r.width > 0 && r.height > 0;
      });
      const target = filtered[0] || list[0];
      target.click();
      return true;
    })()`;
    const res = await this.client.evaluate<boolean>(expr);
    return !!res;
  }

  async sendAndWait(opts: SendOptions): Promise<SendResult> {
    const started = Date.now();
    const timeoutMs = opts.timeoutMs ?? 180_000;
    const pollMs = opts.pollMs ?? 300;
    const stableTicks = opts.stableTicks ?? 7;

    await this.client.bringToFront();

    if (!(await this.hasInput())) {
      throw new Error('页面未就绪：找不到输入框。请在 Chrome 窗口完成登录/验证后重试。');
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
      await sleep(150);
      await this.pressEnter();
    } else {
      const ok = await this.clickSendButton();
      if (!ok) throw new Error('发送失败：未找到发送按钮');
    }

    // 等待「新消息出现」
    let sawNew = false;
    let lastText = '';
    let stable = 0;
    let best = '';

    while (Date.now() - started < timeoutMs) {
      if (opts.signal?.aborted) {
        return { text: best || lastText, elapsedMs: Date.now() - started, sawNew, timedOut: false };
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

      // 双判据：文本稳定 && 停止按钮消失
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
}
