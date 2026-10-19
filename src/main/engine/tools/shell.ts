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

/**
 * 各平台的 shell 与配套参数。
 *
 * Windows 走 `-File` 而不是 `-Command`：命令行参数在 Windows 上要经过
 * ANSI/OEM 代码页转换，中文、引号、换行很容易被啃掉；写成带 BOM 的 .ps1
 * 再交给 -File，脚本内容和编码都是原样。
 */
function shellSpec(): {
  cmd: string;
  args: (script: string, scriptPath: string) => string[];
  ext: string;
  label: string;
} {
  if (isWin) {
    return {
      cmd: 'powershell.exe',
      args: (_script, scriptPath) => [
        '-NoLogo',
        '-NonInteractive',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath
      ],
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

/**
 * Windows 上 PowerShell 往管道里写东西时用的是控制台输出代码页（简中是 936/GBK），
 * Node 按 utf8 解码就会乱码。脚本开头把控制台输出改成 UTF-8，子进程也跟着继承 65001。
 */
const WIN_PREAMBLE = [
  '$ErrorActionPreference = "Continue"',
  '$ProgressPreference = "SilentlyContinue"',
  'try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}',
  'try { $OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}',
  ''
].join('\n');

/**
 * Windows 上 child.kill() 只终止直接子进程，powershell 拉起的孙进程会变成孤儿，
 * 所以走 taskkill /T 杀整棵进程树；taskkill 起不来时回落普通 kill。
 */
function killTree(child: ReturnType<typeof spawn>, force: boolean): void {
  if (isWin && child.pid) {
    try {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', ...(force ? ['/F'] : [])], {
        stdio: 'ignore',
        windowsHide: true
      });
      // 没有 error 监听时，spawn 失败会变成 unhandled error 直接把主进程带崩
      killer.on('error', () => {
        try {
          child.kill(force ? 'SIGKILL' : 'SIGTERM');
        } catch {
          /* 已退出 */
        }
      });
      return;
    } catch {
      /* 回落普通 kill */
    }
  }
  try {
    child.kill(force ? 'SIGKILL' : 'SIGTERM');
  } catch {
    /* 已退出 */
  }
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
  // PowerShell 只有在文件带 BOM 时才按 UTF-8 解析；否则中文会变成乱码
  fs.writeFileSync(scriptPath, isWin ? '\uFEFF' + WIN_PREAMBLE + script : script, 'utf8');

  return await new Promise<ShellResult>((resolve) => {
    const child = spawn(spec.cmd, spec.args(script, scriptPath), {
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
      killTree(child, true);
    }, settings.commandTimeoutMs);

    // ⌘. / Ctrl+. 急停：立刻杀掉正在跑的 shell，避免命令在后台继续执行
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      killTree(child, false);
      setTimeout(() => killTree(child, true), 800);
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
