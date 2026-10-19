import type { DoctorReport, SessionEvent, Settings } from '@shared/types';

/** preload 暴露的 window.eagent 类型声明 */
export interface EagentApi {
  boot(): Promise<string>;
  reconnect(): Promise<string>;
  shutdown(): Promise<string>;
  abort(): Promise<string>;
  send(text: string, files?: string[]): Promise<boolean>;
  approve(callId: string, verdict: 'allow_once' | 'always_allow' | 'deny'): Promise<boolean>;
  onEvent(cb: (event: SessionEvent) => void): () => void;
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
