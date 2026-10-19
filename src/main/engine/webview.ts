import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { WebContentsView, type BrowserWindow, type Session, type WebContents } from 'electron';
import type { Settings } from '../../shared/types';
import { CdpClient, CdpError } from './cdp';
import { readSessionBlob, writeSessionBlob, type SessionBlob } from './session-blob';

const DEEPSEEK_URL = 'https://chat.deepseek.com/';
const PARTITION = 'persist:deepseek';

/**
 * 桌面版 Chrome 的 UA：避免 DeepSeek 把内嵌的 Electron UA 判成陌生客户端。
 * 按宿主平台切换，否则 Windows 上会以 macOS UA 请求，站点可能给出不一致的构建。
 */
const CHROME_MAJOR = '130.0.0.0';
const DESKTOP_UA =
  process.platform === 'win32'
    ? `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR} Safari/537.36`
    : process.platform === 'linux'
      ? `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR} Safari/537.36`
      : `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR} Safari/537.36`;

export type WebViewStatus = 'idle' | 'loading' | 'ready' | 'login_required' | 'error';

export interface WebStatusEvent {
  status: WebViewStatus;
  url?: string;
  detail?: string;
}

/**
 * 内嵌 DeepSeek 网页宿主。
 *
 * 替代旧的「外部 Chrome + 9222 端口」方案：
 *  - 页面跑在 WebContentsView 里，由 Electron 自带 Chromium 渲染；
 *  - CDP 走 webContents.debugger，进程内直连，不开端口；
 *  - 登录态靠 persist:deepseek 分区落盘，另可导出/导入 session.json 迁机。
 *
 * 视图可隐藏（setVisible(false)）而不中断 CDP —— 实测隐藏后
 * Input.insertText / dispatchKeyEvent 仍然生效，回复照常返回，
 * 因此「后台静默跑」是真实可用的能力。
 */
export class WebViewHost extends EventEmitter {
  private view: WebContentsView | null = null;
  private client: CdpClient | null = null;
  private status: WebViewStatus = 'idle';
  private lastUrl = '';
  private visible = false;
  private win: BrowserWindow | null = null;

  constructor(private settings: Settings) {
    super();
  }

  updateSettings(s: Settings) {
    this.settings = s;
  }

  getStatus(): { status: WebViewStatus; url: string; visible: boolean } {
    return { status: this.status, url: this.lastUrl, visible: this.visible };
  }

  getClient(): CdpClient | null {
    return this.client;
  }

  getView(): WebContentsView | null {
    return this.view;
  }

  /** 截图工具需要 WebContents 句柄 */
  getWebContents(): WebContents | null {
    const wc = this.view?.webContents;
    return wc && !wc.isDestroyed() ? wc : null;
  }

  /** 重新加载页面并重连 CDP（标题栏「重连」按钮） */
  async reload(): Promise<void> {
    const wc = this.getWebContents();
    if (!wc) throw new CdpError('内嵌页面不存在', 'NO_TARGET');
    this.client?.close();
    this.client = null;
    await wc.loadURL(DEEPSEEK_URL).catch(() => undefined);
    await this.connect();
  }

  private setStatus(status: WebViewStatus, detail?: string) {
    this.status = status;
    this.emit('status', { status, url: this.lastUrl, detail } satisfies WebStatusEvent);
  }

  /** 创建视图（不自动显示） */
  async attach(win: BrowserWindow, bounds: { x: number; y: number; width: number; height: number }): Promise<void> {
    this.win = win;
    if (this.view && !this.view.webContents.isDestroyed()) {
      this.setBounds(bounds);
      return;
    }
    this.setStatus('loading', '创建内嵌页面…');
    const view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // 后台不被节流：隐藏后仍要能收发消息
        backgroundThrottling: false,
        // 不用 webview 标签，避免额外的 guest 权限面
        webviewTag: false,
        // 允许 CDP 在页面加载前就开始追踪
        offscreen: false
      }
    });
    this.view = view;
    view.webContents.setUserAgent(desktopUA());
    this.setBounds(bounds);
    win.contentView.addChildView(view);
    // 默认可见：用户第一眼就该看到登录页/对话页，而不是一片占位
    this.setVisible(true);

    view.webContents.on('did-navigate', (_e, url) => {
      this.lastUrl = url;
      this.emit('status', { status: this.status, url } satisfies WebStatusEvent);
    });
    view.webContents.on('did-navigate-in-page', (_e, url) => {
      this.lastUrl = url;
    });
    view.webContents.on('did-fail-load', (_e, code, desc, url) => {
      // -3 是被取消的导航，忽略
      if (code === -3) return;
      this.setStatus('error', `页面加载失败 (${code}) ${desc} ${url}`);
    });
    view.webContents.on('destroyed', () => {
      this.view = null;
      this.client = null;
      this.setStatus('idle', '页面已销毁');
    });

    await this.load();
  }

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    if (!this.view) return;
    this.view.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height))
    });
  }

  setVisible(v: boolean): void {
    this.visible = v;
    if (!this.view) return;
    // WebContentsView 从 Electron 30 起提供 setVisible
    (this.view as unknown as { setVisible?: (v: boolean) => void }).setVisible?.(v);
    this.emit('visibility', v);
  }

  isVisible(): boolean {
    return this.visible;
  }

  private async load(): Promise<void> {
    const wc = this.view?.webContents;
    if (!wc) return;
    this.setStatus('loading', '加载 chat.deepseek.com…');
    try {
      await wc.loadURL(DEEPSEEK_URL);
    } catch (err) {
      this.setStatus('error', err instanceof Error ? err.message : String(err));
      return;
    }
    await this.connect();
  }

  /** 附着 CDP 并开启必要 domain */
  async connect(): Promise<CdpClient> {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) throw new CdpError('内嵌页面不存在', 'NO_TARGET');
    const client = new CdpClient(wc);
    await client.connect();
    await client.enableDomains();
    this.client = client;
    this.setStatus('ready', '已连接内嵌页面');
    return client;
  }

  /** 等待页面出现输入框（登录页/首屏加载都靠它判定） */
  async waitForReady(timeoutMs = 30_000): Promise<boolean> {
    const client = this.client;
    if (!client) return false;
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        const ok = await client.evaluate<boolean>('!!document.querySelector("textarea")');
        if (ok) {
          this.setStatus('ready');
          return true;
        }
      } catch {
        /* 页面还在导航 */
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    this.setStatus('login_required', '等待在页面内登录');
    return false;
  }

  /** 把 session.json 注入当前分区（迁机/迁移登录态） */
  async importSession(blob: SessionBlob): Promise<{ cookies: number; storage: number }> {
    const wc = this.view?.webContents;
    if (!wc) throw new CdpError('内嵌页面不存在', 'NO_TARGET');
    const ses = wc.session;
    let cookieCount = 0;
    for (const c of blob.cookies ?? []) {
      const domain = String(c.domain ?? '').replace(/^\./, '');
      if (!domain) continue;
      const detail: Electron.CookiesSetDetails = {
        url: `${c.secure ? 'https' : 'http'}://${domain}${c.path || '/'}`,
        name: String(c.name),
        value: String(c.value),
        domain: String(c.domain),
        path: String(c.path || '/'),
        secure: !!c.secure,
        httpOnly: !!c.httpOnly
      };
      // 关键：Electron 只接受小写的 sameSite，Chrome 导出的是 'Strict'
      const sameSite = String(c.sameSite ?? '').toLowerCase();
      if (sameSite === 'strict' || sameSite === 'lax' || sameSite === 'no_restriction') {
        detail.sameSite = sameSite as Electron.CookiesSetDetails['sameSite'];
      }
      if (typeof c.expires === 'number' && c.expires > 0) detail.expirationDate = c.expires;
      try {
        await ses.cookies.set(detail);
        cookieCount++;
      } catch {
        /* 单条失败不阻断 */
      }
    }
    let storageCount = 0;
    const ls = blob.localStorage ?? {};
    const client = this.client;
    if (Object.keys(ls).length && client) {
      // 关键：不能「先 loadURL 再 setItem」。
      // 页面自己的 JS 一启动就会把 userToken 重置成 {"value":null}，
      // 覆盖掉刚写进去的登录态（实测复现）。
      // 正确做法是用 Page.addScriptToEvaluateOnNewDocument 把写入挂到
      // 任何页面脚本之前执行，再 reload —— 站点读到 true token 时才认为已登录。
      const source = `(() => {
        try {
          const d = ${JSON.stringify(ls)};
          for (const k of Object.keys(d)) localStorage.setItem(k, d[k]);
        } catch (e) {}
      })()`;
      const added = await client.send<{ identifier: string }>(
        'Page.addScriptToEvaluateOnNewDocument',
        { source }
      );
      storageCount = Object.keys(ls).length;
      await wc.loadURL(DEEPSEEK_URL).catch(() => undefined);
      if (added?.identifier) {
        await client
          .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: added.identifier })
          .catch(() => undefined);
      }
    }
    return { cookies: cookieCount, storage: storageCount };
  }

  /** 导出当前登录态，用于备份/迁移 */
  async exportSession(): Promise<SessionBlob> {
    const wc = this.view?.webContents;
    if (!wc) throw new CdpError('内嵌页面不存在', 'NO_TARGET');
    const cookies = await wc.session.cookies.get({ domain: '.deepseek.com' });
    const localStorage = (await this.client?.dumpLocalStorage()) ?? {};
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      cookies: cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain ?? '',
        path: c.path ?? '/',
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
        expires: c.expirationDate
      })),
      localStorage
    };
  }

  sessionPartition(): Session {
    return this.view!.webContents.session;
  }

  async destroy(): Promise<void> {
    this.client?.close();
    this.client = null;
    if (this.view && !this.view.webContents.isDestroyed()) {
      try {
        this.win?.contentView.removeChildView(this.view);
      } catch {
        /* ignore */
      }
      try {
        this.view.webContents.close();
      } catch {
        /* ignore */
      }
    }
    this.view = null;
    this.setStatus('idle', '已关闭');
  }
}

function desktopUA(): string {
  return DESKTOP_UA;
}

export { readSessionBlob, writeSessionBlob };
export const DEFAULT_DEEPSEEK_URL = DEEPSEEK_URL;
