// shell 工具跨平台冒烟测试：直接调用打包后的 runShell，验证编码/路径/生命周期。
// 在 GitHub Actions 的 windows-latest 与 macos-14 上跑，覆盖本地无法复现的平台差异。
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'eagent-shell-'));
const bundle = path.join(OUT, 'shell.cjs');

await build({
  entryPoints: [path.join(ROOT, 'src/main/engine/tools/shell.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: bundle,
  logLevel: 'silent'
});

const mod = require(bundle);
const isWin = process.platform === 'win32';
const settings = {
  workDir: OUT,
  autoApprove: false,
  alwaysAllow: [],
  commandTimeoutMs: 20000,
  replyTimeoutMs: 180000,
  maxOutputChars: 64000,
  systemPromptExtra: '',
  theme: 'system'
};

let pass = 0;
let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : ''));
  }
};

const run = (script, patch) => mod.runShell(script, { ...settings, ...(patch || {}) }, path.join(OUT, 'run-' + Math.random().toString(36).slice(2)));

console.log('platform=' + process.platform + ' arch=' + process.arch);
console.log('node=' + process.version);

// 1. 基础输出
{
  const r = await run(isWin ? 'Write-Output "BASIC-OK"' : 'echo "BASIC-OK"');
  ok('基础输出', r.ok && r.output.includes('BASIC-OK'), JSON.stringify(r.output));
}

// 2. 中文（Windows 上最容易坏的一条：控制台代码页）
{
  const r = await run(isWin ? 'Write-Output "中文输出：你好世界"' : 'echo "中文输出：你好世界"');
  ok('中文输出原样', r.ok && r.output.includes('中文输出：你好世界'), JSON.stringify(r.output));
}

// 3. 多行 + 变量 + 引号
{
  const script = isWin
    ? '$a = 2\r\n$b = 3\r\nWrite-Output ("SUM=" + ($a + $b))\r\nWrite-Output ("Q=" + [char]34 + "q" + [char]34)'
    : 'a=2\nb=3\necho "SUM=$((a+b))"\nprintf \'Q="q"\\n\'';
  const r = await run(script);
  ok('多行脚本', r.ok && r.output.includes('SUM=5'), JSON.stringify(r.output));
  ok('引号未被啃', r.output.includes('Q="q"'), JSON.stringify(r.output));
}

// 4. 工作目录
{
  const r = await run(isWin ? 'Write-Output ("PWD=" + (Get-Location).Path)' : 'echo "PWD=$(pwd)"');
  const norm = (s) => s.replace(/\\/g, '/').toLowerCase();
  ok('工作目录正确', r.ok && norm(r.output).includes(norm(OUT)), JSON.stringify(r.output));
}

// 5. 退出码
{
  const r = await run(isWin ? 'exit 7' : 'exit 7');
  ok('非零退出码', r.ok === false && r.exitCode === 7, 'exit=' + r.exitCode);
}

// 6. stderr 合并
{
  const r = await run(isWin ? 'Write-Error "ERR-LINE"' : 'echo "ERR-LINE" 1>&2');
  ok('stderr 被捕获', r.output.includes('ERR-LINE'), JSON.stringify(r.output));
}

// 7. 脚本文件编码：Windows 必须带 UTF-8 BOM
if (isWin) {
  const r = await run('Write-Output "BOM-CHECK"');
  const bytes = fs.readFileSync(r.scriptPath);
  ok('脚本带 UTF-8 BOM', bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, bytes.subarray(0, 3).toString('hex'));
  ok('脚本用 .ps1 后缀', r.scriptPath.endsWith('.ps1'), r.scriptPath);
}

// 8. 超时终止
{
  const t0 = Date.now();
  const r = await run(isWin ? 'Start-Sleep -Seconds 30' : 'sleep 30', { commandTimeoutMs: 1500 });
  const elapsed = Date.now() - t0;
  ok('超时被终止', r.timedOut === true && r.ok === false, 'timedOut=' + r.timedOut);
  ok('超时响应及时', elapsed < 12000, elapsed + 'ms');
}

// 9. 急停终止
{
  const ac = new AbortController();
  const t0 = Date.now();
  const p = mod.runShell(
    isWin ? 'Start-Sleep -Seconds 30' : 'sleep 30',
    { ...settings, commandTimeoutMs: 25000 },
    path.join(OUT, 'abort'),
    ac.signal
  );
  setTimeout(() => ac.abort(), 500);
  const r = await p;
  const elapsed = Date.now() - t0;
  ok('急停终止', r.ok === false && String(r.output).includes('急停'), JSON.stringify(r.output));
  ok('急停响应及时', elapsed < 10000, elapsed + 'ms');
}

// 10. 危险命令识别（两平台各自的写法）
{
  const cases = isWin
    ? ['Remove-Item C:\\tmp -Recurse -Force', 'Start-Process cmd -Verb RunAs', 'Stop-Computer', 'format C:']
    : ['rm -rf /tmp/x', 'sudo ls', 'diskutil list', 'shutdown -h now'];
  for (const c of cases) {
    ok('危险命令识别: ' + c, mod.detectDanger(c) !== null, String(mod.detectDanger(c)));
  }
  ok('普通命令不误报', mod.detectDanger(isWin ? 'Get-ChildItem' : 'ls -la') === null);
}

console.log('');
console.log('RESULT pass=' + pass + ' fail=' + fail);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
