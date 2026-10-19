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

/**
 * 危险命令特征 —— 命中则强制二次确认（无视 Always Allow）。
 * 同时覆盖 POSIX 与 Windows 两套习惯写法：用户可能在 Mac 上 ssh 到其他机器，
 * 也可能在 Windows 上跑 PowerShell。
 */
const DANGER_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\brm\s+-[a-zA-Z]*[rf]/i, reason: '递归/强制删除 (rm -rf)' },
  { re: /\bRemove-Item\b[^\n]*-(Recurse|Force)/i, reason: '递归/强制删除 (Remove-Item)' },
  { re: /\bdel\s+\/[sq]/i, reason: '强制删除 (del /s /q)' },
  { re: /\bformat\s+[a-z]:/i, reason: '格式化磁盘 (format)' },
  { re: /\bsudo\b/i, reason: '提权执行 (sudo)' },
  { re: /\bStart-Process\b[^\n]*-Verb\s+RunAs/i, reason: '提权执行 (RunAs)' },
  { re: /\bdiskutil\b/i, reason: '磁盘操作 (diskutil)' },
  { re: /\blaunchctl\b/i, reason: '系统服务操作 (launchctl)' },
  { re: /\bmkfs|\bdd\s+if=/i, reason: '裸设备写入 (mkfs/dd)' },
  { re: /\bcsrutil\b/i, reason: '系统完整性保护 (csrutil)' },
  { re: /:(){ :\|:& };:/, reason: 'fork 炸弹' },
  { re: /\bchmod\s+-R\s+777\s+\//i, reason: '全盘权限放开' },
  { re: /\b(shutdown|reboot|halt)\b/i, reason: '关机/重启' },
  { re: /\bStop-Computer\b/i, reason: '关机/重启' },
  { re: /\bsecurity\s+(delete|dump)/i, reason: '钥匙串操作' }
];

export function detectDanger(script: string): string | null {
  for (const p of DANGER_PATTERNS) {
    if (p.re.test(script)) return p.reason;
  }
  return null;
}

const isWin = process.platform === 'win32';

/** 各平台的默认 shell 与配套参数（Windows 优先 pwsh 7，回落系统自带 powershell.exe） */
function shellSpec(): { cmd: string; args: (script: string) => string[]; ext: string; label: string } {
  if (isWin) {
    return {
      cmd: 'powershell.exe',
      args: (script) => ['-NoLogo', '-NonInteractive', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      ext: 'ps1',
      label: 'powershell'
    };
  }
  return {
    cmd: process.env.SHELL && process.env.SHELL.includes('zsh') ? 'zsh' : '/bin/zsh',
    args: (script) => ['-lc', script],
    ext: 'zsh',
    label: 'zsh'
  };
}

/** 补齐 PATH：GUI 启动的进程继承 launchd / explorer 的最小环境，找不到 brew、node 等 */
function buildEnv(): NodeJS.ProcessEnv {
  const base = { ...process.env };
  if (isWin) {
    const extra = [
      path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs'),
      path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'nodejs'),
      path.join(process.env.APPDATA ?? '', 'npm')
    ].filter((p) => p && fs.existsSync(p));
    base.PATH = [...extra, base.PATH ?? ''].filter(Boolean).join(path.delimiter);
    return base;
  }
  const current = (base.PATH ?? '').split(':');
  const wanted = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    path.join(process.env.HOME ?? '', '.local/node/bin'),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ];
  const merged = [...wanted, ...current.filter((p) => p && !wanted.includes(p))];
  base.PATH = merged.join(':');
  return base;
}

export async function runShell(
  script: string,
  settings: Settings,
  tempDir: string,
  signal?: AbortSignal
): Promise<ShellResult> {
  const started = Date.now();
  fs.mkdirSync(tempDir, { recursive: true });
  const spec = shellSpec();
  const scriptPath = path.join(tempDir, `shell_${Date.now()}.${spec.ext}`);
  fs.writeFileSync(scriptPath, script, 'utf8');

  return await new Promise<ShellResult>((resolve) => {
    const child = spawn(spec.cmd, spec.args(script), {
      cwd: settings.workDir,
      env: buildEnv(),
      windowsHide: true
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

    // ⌘. / Ctrl+. 急停：立刻杀掉正在跑的 shell，避免命令在后台继续执行
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* 已退出 */
        }
      }, 800);
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    child.on('error', (err) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({
        ok: false,
        output: `[工具][错误] 无法启动 ${spec.label}: ${err.message}`,
        exitCode: null,
        timedOut: false,
        durationMs: Date.now() - started,
        scriptPath
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      let text = out;
      if (text.length >= limit) {
        text = text.slice(0, limit) + `\n…[输出已截断，共超过 ${limit} 字符]`;
      }
      if (timedOut) {
        text += `\n[工具][错误] 命令超时（${settings.commandTimeoutMs}ms）已被强制终止`;
      }
      if (aborted) {
        text += '\n[工具][错误] 用户急停，命令已终止';
      }
      resolve({
        ok: code === 0 && !timedOut && !aborted,
        output: text.trim() || (code === 0 ? '(无输出)' : `(退出码 ${code}，无输出)`),
        exitCode: code,
        timedOut,
        durationMs: Date.now() - started,
        scriptPath
      });
    });
  });
}
