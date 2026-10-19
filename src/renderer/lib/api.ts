import type { DoctorReport, SessionEvent, Settings } from '@shared/types';

export interface SessionBlobInfo {
  ok: boolean;
  path: string;
  cookies: number;
  storage: number;
}

/** preload 暴露的 window.eagent 类型声明 */
export interface EagentApi {
  boot(): Promise<string>;
  reconnect(): Promise<string>;
  shutdown(): Promise<string>;
  abort(): Promise<string>;
  send(text: string, files?: string[]): Promise<boolean>;
  approve(callId: string, verdict: 'allow_once' | 'always_allow' | 'deny'): Promise<boolean>;
  onEvent(cb: (event: SessionEvent) => void): () => void;

  setPageVisible(visible: boolean): Promise<boolean>;
  togglePage(): Promise<boolean>;
  isPageVisible(): Promise<boolean>;
  setPageBounds(b: { x: number; y: number; width: number; height: number }): Promise<boolean>;
  onPageVisibility(cb: (visible: boolean) => void): () => void;
  onRelayout(cb: () => void): () => void;

  exportSession(): Promise<SessionBlobInfo>;
  importSession(): Promise<SessionBlobInfo>;
  onMenuExport(cb: () => void): () => void;
  onMenuImport(cb: () => void): () => void;

  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  defaults(): Promise<Settings>;
  rebuildPrompt(extra: string): Promise<string>;
  runDoctor(): Promise<DoctorReport>;
  pickFiles(): Promise<string[]>;
  pickDir(): Promise<string[]>;
  readImage(p: string): Promise<string>;
  appVersion(): Promise<string>;
  openExternal(url: string): Promise<boolean>;
  revealPath(p: string): Promise<boolean>;
  getContentSize(): Promise<{ width: number; height: number }>;
}

declare global {
  interface Window {
    eagent: EagentApi;
    electronAPI?: {
      getFullscreen?: () => Promise<boolean>;
      getZoomFactor?: () => Promise<number>;
      setZoomFactor?: (f: number) => Promise<number>;
      onFullscreenChanged?: (cb: (v: boolean) => void) => () => void;
      onZoomFactorChanged?: (cb: (v: number) => void) => () => void;
    };
  }
}

export const api: EagentApi = window.eagent;
