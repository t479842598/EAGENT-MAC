import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from '../../shared/types';
import { CdpClient, CdpError } from './cdp';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface LaunchResult {
  alreadyRunning: boolean;
  pid?: number;
  port: number;
  version?: string;
}

/**
 * Chrome 生命周期管理。
 * 关键约束：Chrome 136+ 拒绝在默认 profile 上开 --remote-debugging-port，
 * 因此必须使用独立的 --user-data-dir（顺带固化 DeepSeek 登录态）。
 */
export class BrowserManager {
  private child: ChildProcess | null = null;
  private client: CdpClient | null = null;

  constructor(private settings: Settings) {}

  updateSettings(s: Settings) {
    this.settings = s;
  }

  async isPortAlive(): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.settings.debugPort}/json/version`, {
        signal: AbortSignal.timeout(1200)
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async version(): Promise<string | undefined> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.settings.debugPort}/json/version`, {
        signal: AbortSignal.timeout(1500)
      });
      if (!res.ok) return undefined;
      const json = (await res.json()) as { Browser?: string };
      return json.Browser;
    } catch {
      return undefined;
    }
  }

  async launch(url = 'https://chat.deepseek.com'): Promise<LaunchResult> {
    if (await this.isPortAlive()) {
      return { alreadyRunning: true, port: this.settings.debugPort, version: await this.version() };
    }

    const bin = this.resolveChromePath();
    if (!bin) {
      throw new Error(
        '未找到 Google Chrome。请在「设置 → 浏览器路径」中指定，或安装 Chrome。'
      );
    }
    fs.mkdirSync(this.settings.userDataDir, { recursive: true });

    const args = [
      `--remote-debugging-port=${this.settings.debugPort}`,
      `--user-data-dir=${this.settings.userDataDir}`,
      `--app=${url}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-popup-blocking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion',
      '--disable-blink-features=AutomationControlled',
      '--remote-allow-origins=*',
      '--test-type'
    ];

    this.child = spawn(bin, args, {
      detached: false,
      stdio: 'ignore'
    });
    this.child.unref?.();

    // 轮询 /json/version，20 × 500ms（对齐上游）
    for (let i = 0; i < 20; i++) {
      if (await this.isPortAlive()) {
        return {
          alreadyRunning: false,
          pid: this.child?.pid,
          port: this.settings.debugPort,
          version: await this.version()
        };
      }
      await sleep(500);
    }
    throw new Error(`Chrome 已启动但调试端口 ${this.settings.debugPort} 未就绪`);
  }

  resolveChromePath(): string | null {
    const candidates = [
      this.settings.chromePath,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
    ].filter(Boolean);
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  }

  async connect(): Promise<CdpClient> {
    const page = await CdpClient.findPage(this.settings.debugPort);
    const client = new CdpClient();
    await client.connect(page.webSocketDebuggerUrl);
    await client.enableDomains();
    this.client = client;
    return client;
  }

  getClient(): CdpClient | null {
    return this.client;
  }

  async close(): Promise<void> {
    try {
      if (this.client?.isOpen) await this.client.closeBrowser();
    } catch {
      /* ignore */
    }
    this.client?.close();
    this.client = null;
    await sleep(600);
    await this.killByProfile();
  }

  /** 兜底：按 user-data-dir 特征杀进程（对齐上游 taskkill /IM powershell.exe） */
  async killByProfile(): Promise<void> {
    const marker = path.basename(this.settings.userDataDir);
    if (!marker || marker.length < 4) return;
    await new Promise<void>((resolve) => {
      const p = spawn('pkill', ['-f', marker], { stdio: 'ignore' });
      p.on('exit', () => resolve());
      p.on('error', () => resolve());
    });
  }

  async isDeepSeekLoaded(client: CdpClient): Promise<boolean> {
    try {
      const has = await client.evaluate<boolean>(
        `!!document.querySelector('textarea') && location.hostname.includes('deepseek')`
      );
      return !!has;
    } catch (err) {
      if (err instanceof CdpError && err.code === 'BROKEN') throw err;
      return false;
    }
  }
}
