import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export interface CookieRecord {
  name: string;
  value: string;
  domain: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
  expires?: number;
}

export interface SessionBlob {
  version: number;
  exportedAt: string;
  cookies: CookieRecord[];
  localStorage: Record<string, string>;
}

/** 备份根目录：<userData>/sessions/ */
function sessionsDir(): string {
  return path.join(app.getPath('userData'), 'sessions');
}

export function sessionBlobPath(name = 'deepseek-session.json'): string {
  return path.join(sessionsDir(), name);
}

export function readSessionBlob(file = sessionBlobPath()): SessionBlob | null {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const json = JSON.parse(raw) as SessionBlob;
    if (!json || typeof json !== 'object') return null;
    return {
      version: json.version ?? 1,
      exportedAt: json.exportedAt ?? new Date().toISOString(),
      cookies: Array.isArray(json.cookies) ? json.cookies : [],
      localStorage: json.localStorage ?? {}
    };
  } catch {
    return null;
  }
}

export function writeSessionBlob(blob: SessionBlob, file = sessionBlobPath()): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(blob, null, 2), { encoding: 'utf8', mode: 0o600 });
  return file;
}
