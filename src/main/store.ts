import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Settings } from '../shared/types';

const DEFAULTS: Settings = {
  workDir: path.join(os.homedir(), 'EAgent'),
  autoApprove: false,
  alwaysAllow: [],
  commandTimeoutMs: 120_000,
  replyTimeoutMs: 180_000,
  maxOutputChars: 64_000,
  systemPromptExtra: '',
  theme: 'system'
};

let cached: Settings | null = null;

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function getSettings(): Settings {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Settings> & Record<string, unknown>;
    // 迁移：旧版把 Chrome 路径/调试端口/独立 profile 目录写进了配置，内嵌版已无意义
    delete parsed.chromePath;
    delete parsed.debugPort;
    delete parsed.userDataDir;
    cached = { ...DEFAULTS, ...parsed };
  } catch {
    cached = { ...DEFAULTS };
  }
  return cached!;
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  cached = next;
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export { DEFAULTS };
