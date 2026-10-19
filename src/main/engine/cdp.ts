import type { WebContents } from 'electron';

/**
 * 进程内 CDP 客户端。
 *
 * 旧版通过 ws 连接外部 Chrome 的 9222 调试端口；现在直接复用 Electron 自带的
 * webContents.debugger —— 零端口、零外部浏览器、零辅助功能权限。
 * 对外 API 与旧 ws 版保持一致，下游 DeepSeekDriver 无需感知协议来源。
 */
export class CdpError extends Error {
  constructor(
    message: string,
    readonly code: 'NO_TARGET' | 'BROKEN' | 'TIMEOUT' | 'PROTOCOL' = 'PROTOCOL'
  ) {
    super(message);
    this.name = 'CdpError';
  }
}

export interface KeyEventInit {
  key: string;
  code?: string;
  keyCode?: number;
  modifiers?: number;
  text?: string;
}

/** modifiers 位掩码（CDP 约定） */
export const MOD = {
  alt: 1,
  ctrl: 2,
  meta: 4,
  shift: 8
} as const;

export class CdpClient {
  private attached = false;
  private closed = false;
  private nullStreak = 0;

  constructor(private readonly wc: WebContents) {}

  async connect(): Promise<void> {
    if (this.wc.isDestroyed()) throw new CdpError('页面已销毁', 'NO_TARGET');
    if (this.attached) return;
    try {
      this.wc.debugger.attach('1.3');
    } catch (err) {
      // 已附着（例如热重载后复用同一 webContents）视为成功
      const msg = err instanceof Error ? err.message : String(err);
      if (!/already attached/i.test(msg)) {
        throw new CdpError(`调试器附着失败: ${msg}`, 'NO_TARGET');
      }
    }
    this.attached = true;
    this.closed = false;
  }

  async send<T = any>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 30_000
  ): Promise<T> {
    if (this.closed || !this.attached) {
      throw new CdpError('CDP 未连接', 'BROKEN');
    }
    if (this.wc.isDestroyed()) {
      throw new CdpError('页面已销毁', 'BROKEN');
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        this.wc.debugger.sendCommand(method, params) as Promise<T>,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new CdpError(`CDP 调用超时: ${method}`, 'TIMEOUT')),
            timeoutMs
          );
        })
      ]);
      return result;
    } catch (err) {
      if (err instanceof CdpError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new CdpError(`CDP ${method} 失败: ${msg}`, 'PROTOCOL');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 求值并返回 JSON 可序列化结果。
   * nullStreak 连续 10 次拿不到 result 判 BROKEN（沿用旧版语义）。
   */
  async evaluate<T = any>(
    expression: string,
    opts: { awaitPromise?: boolean; timeoutMs?: number } = {}
  ): Promise<T | null> {
    let result: any;
    try {
      result = await this.send(
        'Runtime.evaluate',
        {
          expression,
          returnByValue: true,
          awaitPromise: opts.awaitPromise ?? false,
          userGesture: true
        },
        opts.timeoutMs ?? 30_000
      );
    } catch (err) {
      this.nullStreak++;
      if (this.nullStreak >= 10) throw new CdpError('CDP 连续失败，判定连接已损坏', 'BROKEN');
      throw err;
    }
    if (!result || !('result' in result)) {
      this.nullStreak++;
      if (this.nullStreak >= 10) {
        throw new CdpError('CDP 连续返回空结果，判定连接已损坏', 'BROKEN');
      }
      return null;
    }
    this.nullStreak = 0;
    if (result.exceptionDetails) {
      const desc =
        result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        '页面脚本异常';
      throw new CdpError(String(desc).split('\n')[0]);
    }
    return (result.result?.value ?? null) as T | null;
  }

  async enableDomains(): Promise<void> {
    await this.send('Page.enable').catch(() => undefined);
    await this.send('DOM.enable').catch(() => undefined);
    await this.send('Runtime.enable').catch(() => undefined);
  }

  async bringToFront(): Promise<void> {
    await this.send('Page.bringToFront').catch(() => undefined);
    await this.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(
      () => undefined
    );
  }

  // ---------- 输入：不再依赖系统辅助功能权限 ----------

  /**
   * 用真实的输入法事件写入文本。
   * 关键：JS 直接改 value 无法让 React 受控组件同步状态（发送按钮保持 disabled），
   * 必须走 Input.insertText。调用前建议先 focus + select。
   */
  async insertText(text: string): Promise<void> {
    await this.send('Input.insertText', { text });
  }

  /** 逐字符输入（某些场景 insertText 不触发 composition 回调时使用） */
  async typeText(text: string, delayMs = 0): Promise<void> {
    for (const ch of text) {
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch });
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  async dispatchKey(init: KeyEventInit): Promise<void> {
    const params = {
      key: init.key,
      code: init.code ?? init.key,
      windowsVirtualKeyCode: init.keyCode ?? 0,
      nativeVirtualKeyCode: init.keyCode ?? 0,
      modifiers: init.modifiers ?? 0,
      ...(init.text ? { text: init.text } : {})
    };
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
  }

  async pressEnter(): Promise<void> {
    await this.dispatchKey({ key: 'Enter', code: 'Enter', keyCode: 13 });
  }

  async pressEscape(): Promise<void> {
    await this.dispatchKey({ key: 'Escape', code: 'Escape', keyCode: 27 });
  }

  /** 全选当前焦点元素内容（配合 insertText 覆盖旧文本） */
  async selectAll(): Promise<void> {
    await this.dispatchKey({ key: 'a', code: 'KeyA', keyCode: 65, modifiers: MOD.meta });
  }

  async mouseClick(x: number, y: number, button: 'left' | 'right' | 'middle' = 'left', clickCount = 1): Promise<void> {
    const base = { x, y, button, clickCount, buttons: button === 'left' ? 1 : button === 'right' ? 2 : 4 };
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
  }

  async mouseMove(x: number, y: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  }

  async mouseScroll(x: number, y: number, deltaY: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x,
      y,
      deltaX: 0,
      deltaY,
      button: 'none',
      buttons: 0
    });
  }

  /** 用 CDP DOM.setFileInputFiles 往页面的 <input type=file> 塞文件 */
  async setFilesOnInput(files: string[], selector = 'input[type="file"]'): Promise<boolean> {
    const doc = await this.send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: -1 });
    const q = await this
      .send<{ nodeId: number }>('DOM.querySelector', { nodeId: doc.root.nodeId, selector })
      .catch(() => ({ nodeId: 0 }));
    if (!q || !q.nodeId) return false;
    await this.send('DOM.setFileInputFiles', { nodeId: q.nodeId, files });
    return true;
  }

  /** 读页面内 localStorage（用于迁移登录态） */
  async dumpLocalStorage(): Promise<Record<string, string>> {
    const res = await this.evaluate<Record<string, string>>(
      `(() => {
        const out = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k !== null) out[k] = localStorage.getItem(k) ?? '';
        }
        return out;
      })()`
    );
    return res ?? {};
  }

  close(): void {
    this.closed = true;
    if (this.attached && !this.wc.isDestroyed()) {
      try {
        this.wc.debugger.detach();
      } catch {
        /* ignore */
      }
    }
    this.attached = false;
  }

  get isOpen(): boolean {
    return this.attached && !this.closed;
  }
}
