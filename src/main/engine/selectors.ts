import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export interface SelectorTable {
  assistant: string[];
  user: string[];
  input: string[];
  sendButton: string[];
  stopButton: string[];
  fileInput: string[];
  loginHint: string[];
}

const FALLBACK: SelectorTable = {
  assistant: ['.ds-assistant-message-main-content', '[class*="ds-assistant-message-main-content"]', '[class*="ds-markdown"]'],
  user: ['[class*="fbb737a4"]', '[class*="ds-user-message"]'],
  input: ['textarea'],
  sendButton: ['div[role="button"].ds-button--primary.ds-button--circle', '[role="button"][aria-label*="发送"]', '[role="button"][aria-label*="Send"]'],
  stopButton: ['[role="button"][aria-label*="停止"]', '[role="button"][aria-label*="Stop"]'],
  fileInput: ['input[type="file"]'],
  loginHint: ['[class*="login"]']
};

function candidatePaths(): string[] {
  const list: string[] = [];
  // 打包后：process.resourcesPath/resources/selectors.json
  if (process.resourcesPath) {
    list.push(path.join(process.resourcesPath, 'resources', 'selectors.json'));
    list.push(path.join(process.resourcesPath, 'selectors.json'));
  }
  // 开发态：<repo>/resources/selectors.json
  list.push(path.join(app.getAppPath(), 'resources', 'selectors.json'));
  list.push(path.join(process.cwd(), 'resources', 'selectors.json'));
  return list;
}

let cached: SelectorTable | null = null;

export function loadSelectors(): SelectorTable {
  if (cached) return cached;
  for (const p of candidatePaths()) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const json = JSON.parse(raw);
      cached = { ...FALLBACK, ...json };
      return cached!;
    } catch {
      /* try next */
    }
  }
  cached = FALLBACK;
  return cached;
}

export function reloadSelectors(): SelectorTable {
  cached = null;
  return loadSelectors();
}

/** 生成「按优先级取第一个非空」的 JS 表达式片段 */
export function pickExpr(list: string[], exprForSelector: (s: string) => string): string {
  return list.map((s) => exprForSelector(s)).join(' || ');
}

export { FALLBACK };
