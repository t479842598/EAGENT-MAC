import { contextBridge, ipcRenderer } from 'electron';
import type { DoctorReport, SessionEvent, Settings } from '../shared/types';

/**
 * 渲染层唯一通道。
 * 注意：window.electronAPI 的方法名是 open-claude-ui 的 ClaudeDesktopHeader 硬编码依赖，
 * 改名会导致顶栏红绿灯避让失效。
 */

const on = <T extends unknown[]>(channel: string, cb: (...args: T) => void) => {
  const handler = (_e: unknown, ...args: unknown[]) => cb(...(args as T));
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

export interface SessionBlobInfo {
  ok: boolean;
  path: string;
  cookies: number;
  storage: number;
}

const api = {
  // ---------- 会话 ----------
  boot: (): Promise<string> => ipcRenderer.invoke('session:boot'),
  reconnect: (): Promise<string> => ipcRenderer.invoke('session:reconnect'),
  shutdown: (): Promise<string> => ipcRenderer.invoke('session:shutdown'),
  abort: (): Promise<string> => ipcRenderer.invoke('session:abort'),
  send: (text: string, files: string[] = []): Promise<boolean> =>
    ipcRenderer.invoke('session:send', { text, files }),
  approve: (callId: string, verdict: 'allow_once' | 'always_allow' | 'deny'): Promise<boolean> =>
    ipcRenderer.invoke('session:approve', { callId, verdict }),
  onEvent: (cb: (event: SessionEvent) => void) => on<[SessionEvent]>('session:event', cb),

  // ---------- 内嵌网页 ----------
  setPageVisible: (visible: boolean): Promise<boolean> =>
    ipcRenderer.invoke('page:set-visible', visible),
  togglePage: (): Promise<boolean> => ipcRenderer.invoke('page:toggle-visible'),
  isPageVisible: (): Promise<boolean> => ipcRenderer.invoke('page:is-visible'),
  setPageBounds: (b: { x: number; y: number; width: number; height: number }): Promise<boolean> =>
    ipcRenderer.invoke('page:set-bounds', b),
  onPageVisibility: (cb: (visible: boolean) => void) => on<[boolean]>('page:visibility', cb),
  onRelayout: (cb: () => void) => on<[]>('page:relayout', cb),

  // ---------- 登录态迁移 ----------
  exportSession: (): Promise<SessionBlobInfo> => ipcRenderer.invoke('session:export-blob'),
  importSession: (): Promise<SessionBlobInfo> => ipcRenderer.invoke('session:import-blob'),
  onMenuExport: (cb: () => void) => on<[]>('menu:export-session', cb),
  onMenuImport: (cb: () => void) => on<[]>('menu:import-session', cb),

  // ---------- 设置 ----------
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke('settings:set', patch),
  defaults: (): Promise<Settings> => ipcRenderer.invoke('settings:defaults'),
  rebuildPrompt: (extra: string): Promise<string> =>
    ipcRenderer.invoke('system:rebuild-prompt', extra),

  // ---------- 自检 ----------
  runDoctor: (): Promise<DoctorReport> => ipcRenderer.invoke('doctor:run'),

  // ---------- 文件 ----------
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:pick-files'),
  pickDir: (): Promise<string[]> => ipcRenderer.invoke('dialog:pick-dir'),
  readImage: (p: string): Promise<string> => ipcRenderer.invoke('file:read-image', p),

  // ---------- 系统 ----------
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('system:open-external', url),
  revealPath: (p: string): Promise<boolean> => ipcRenderer.invoke('system:reveal-path', p),

  // ---------- 窗口 ----------
  getContentSize: (): Promise<{ width: number; height: number }> =>
    ipcRenderer.invoke('window:content-size')
};

const electronAPI = {
  getFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:get-fullscreen'),
  getZoomFactor: (): Promise<number> => ipcRenderer.invoke('window:get-zoom'),
  setZoomFactor: (f: number): Promise<number> => ipcRenderer.invoke('window:set-zoom', f),
  minimize: (): Promise<boolean> => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggle-maximize'),
  onFullscreenChanged: (cb: (v: boolean) => void) => on<[boolean]>('window:fullscreen-changed', cb),
  onZoomFactorChanged: (cb: (v: number) => void) => on<[number]>('window:zoom-changed', cb)
};

contextBridge.exposeInMainWorld('eagent', api);
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type EagentApi = typeof api;
export type ElectronApi = typeof electronAPI;
