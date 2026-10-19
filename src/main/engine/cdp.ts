import WebSocket from 'ws';

/**
 * 零依赖 CDP 客户端。
 * 上游 EAgent 用 PowerShell ClientWebSocket 直连 page target；这里换成 ws，
 * 协议层完全一致（Runtime.evaluate / DOM.setFileInputFiles / Page.*）。
 */
export interface CdpTarget {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl: string;
}

export class CdpError extends Error {
  constructor(message: string, readonly code: 'NO_TARGET' | 'BROKEN' | 'TIMEOUT' | 'PROTOCOL' = 'PROTOCOL') {
    super(message);
    this.name = 'CdpError';
  }
}

export class CdpClient {
  private ws: WebSocket | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private nullStreak = 0;
  private closed = false;

  static async listTargets(port: number): Promise<CdpTarget[]> {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!res.ok) throw new CdpError(`/json/list 返回 ${res.status}`, 'NO_TARGET');
    return (await res.json()) as CdpTarget[];
  }

  static async findPage(port: number, urlIncludes = 'deepseek'): Promise<CdpTarget> {
    const targets = await CdpClient.listTargets(port);
    const page = targets.find((t) => t.type === 'page' && t.url.includes(urlIncludes))
      ?? targets.find((t) => t.type === 'page');
    if (!page) throw new CdpError('未找到可用的页面 target', 'NO_TARGET');
    return page;
  }

  async connect(wsUrl: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new CdpError('WebSocket 连接超时', 'TIMEOUT'));
      }, 10_000);
      ws.on('open', () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve();
      });
      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(new CdpError(`WebSocket 连接失败: ${err.message}`));
      });
      ws.on('message', (data) => this.onMessage(data.toString()));
      ws.on('close', () => {
        this.closed = true;
        for (const [, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new CdpError('CDP 连接已关闭', 'BROKEN'));
        }
        this.pending.clear();
      });
    });
  }

  private onMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg.id !== 'number') return; // 事件帧，忽略
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.error) {
      entry.reject(new CdpError(`CDP ${msg.error.code}: ${msg.error.message}`));
    } else {
      entry.resolve(msg.result);
    }
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
    if (!this.ws || this.closed) return Promise.reject(new CdpError('CDP 未连接', 'BROKEN'));
    const id = ++this.seq;
    const payload = JSON.stringify({ id, method, params });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpError(`CDP 调用超时: ${method}`, 'TIMEOUT'));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: any) => void, reject, timer });
      this.ws!.send(payload, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new CdpError(`CDP 发送失败: ${err.message}`));
        }
      });
    });
  }

  /**
   * 求值并在页面内返回 JSON 可序列化结果。
   * nullStreak 连续 10 次拿不到 result 判 BROKEN（对齐上游 exit 3 语义）。
   */
  async evaluate<T = any>(expression: string, opts: { awaitPromise?: boolean; timeoutMs?: number } = {}): Promise<T | null> {
    let result: any;
    try {
      result = await this.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: opts.awaitPromise ?? false,
        userGesture: true
      }, opts.timeoutMs ?? 30_000);
    } catch (err) {
      this.nullStreak++;
      if (this.nullStreak >= 10) throw new CdpError('CDP 连续失败，判定连接已损坏', 'BROKEN');
      throw err;
    }
    if (!result || !('result' in result)) {
      this.nullStreak++;
      if (this.nullStreak >= 10) throw new CdpError('CDP 连续返回空结果，判定连接已损坏', 'BROKEN');
      return null;
    }
    this.nullStreak = 0;
    if (result.exceptionDetails) {
      const desc = result.exceptionDetails.exception?.description
        ?? result.exceptionDetails.text
        ?? '页面脚本异常';
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
    await this.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined);
  }

  /** 用 CDP DOM.setFileInputFiles 往页面的 <input type=file> 塞文件 */
  async setFilesOnInput(files: string[], selector = 'input[type="file"]'): Promise<boolean> {
    const doc = await this.send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: 1 });
    const q = await this.send<{ nodeId: number }>('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector
    }).catch(() => ({ nodeId: 0 }));
    if (!q || !q.nodeId) return false;
    await this.send('DOM.setFileInputFiles', { nodeId: q.nodeId, files });
    return true;
  }

  async closeBrowser(): Promise<void> {
    await this.send('Browser.close', {}, 5000).catch(() => undefined);
  }

  close(): void {
    this.closed = true;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }

  get isOpen(): boolean {
    return !!this.ws && !this.closed;
  }
}
