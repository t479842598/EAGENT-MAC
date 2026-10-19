import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from '../../../shared/types';

export interface ShellResult {
  ok: boolean;
  output: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  scriptPath: string;
}

/** 危险命令特征 —— 命中则强制二次确认（无视 Always Allow） */
const DANGER_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\brm\s+-[a-zA-Z]*[rf]/i, reason: '递归/强制删除 (rm -rf)' },
  { re: /\bsudo\b/i, reason: '提权执行 (sudo)' },
  { re: /\bdiskutil\b/i, reason: '磁盘操作 (diskutil)' },
  { re: /\blaunchctl\b/i, reason: '系统服务操作 (launchctl)' },
  { re: /\bmkfs|\bdd\s+if=/i, reason: '裸设备写入 (mkfs/dd)' },
  { re: /\bcsrutil\b/i, reason: '系统完整性保护 (csrutil)' },
  { re: /:(){ :\|:& };:/, reason: 'fork 炸弹' },
  { re: /\bchmod\s+-R\s+777\s+\//i, reason: '全盘权限放开' },
  { re: /\b(shutdown|reboot|halt)\b/i, reason: '关机/重启' },
  { re: /\bsecurity\s+(delete|dump)/i, reason: '钥匙串操作' }
];

export function detectDanger(script: string): string | null {
  for (const p of DANGER_PATTERNS) {
    if (p.re.test(script)) return p.reason;
  }
  return null;
}

export async function runShell(
  script: string,
  settings: Settings,
  tempDir: string
): Promise<ShellResult> {
  const started = Date.now();
  fs.mkdirSync(tempDir, { recursive: true });
  const scriptPath = path.join(tempDir, `shell_${Date.now()}.zsh`);
  fs.writeFileSync(scriptPath, script, 'utf8');

  return await new Promise<ShellResult>((resolve) => {
    const child = spawn('zsh', ['-lc', script], {
      cwd: settings.workDir,
      env: {
        ...process.env,
        PATH: [
          '/opt/homebrew/bin',
          '/opt/homebrew/sbin',
          '/usr/local/bin',
          path.join(process.env.HOME ?? '', '.local/node/bin'),
          '/usr/bin',
          '/bin',
          '/usr/sbin',
          '/sbin'
        ].join(':')
      }
    });

    let out = '';
    let timedOut = false;
    const limit = settings.maxOutputChars;

    const append = (chunk: Buffer) => {
      if (out.length < limit) out += chunk.toString('utf8');
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, settings.commandTimeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        output: `[工具][错误] 无法启动 zsh: ${err.message}`,
        exitCode: null,
        timedOut: false,
        durationMs: Date.now() - started,
        scriptPath
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      let text = out;
      if (text.length >= limit) {
        text = text.slice(0, limit) + `\n…[输出已截断，共超过 ${limit} 字符]`;
      }
      if (timedOut) {
        text += `\n[工具][错误] 命令超时（${settings.commandTimeoutMs}ms）已被强制终止`;
      }
      resolve({
        ok: code === 0 && !timedOut,
        output: text.trim() || (code === 0 ? '(无输出)' : `(退出码 ${code}，无输出)`),
        exitCode: code,
        timedOut,
        durationMs: Date.now() - started,
        scriptPath
      });
    });
  });
}
