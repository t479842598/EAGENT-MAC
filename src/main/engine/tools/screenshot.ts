import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Settings } from '../../../shared/types';

const exec = promisify(execFile);

export interface ScreenshotResult {
  ok: boolean;
  filePath?: string;
  output: string;
  info?: Record<string, unknown>;
}

function runMacinput(binPath: string, args: string[]): Promise<any> {
  return exec(binPath, args, { timeout: 8000 }).then((r) => JSON.parse(r.stdout.trim()));
}

export async function takeScreenshot(
  params: { target: 'screen' | 'window'; windowId: number | null },
  settings: Settings,
  tempDir: string,
  macinputPath: string
): Promise<ScreenshotResult> {
  fs.mkdirSync(tempDir, { recursive: true });
  const file = path.join(tempDir, `屏幕截图_${Date.now()}.jpg`);

  const args = ['-x', '-o', '-C', '-t', 'jpg'];
  if (params.target === 'window' && params.windowId) {
    args.push(`-l${params.windowId}`);
  }
  args.push(file);

  try {
    await exec('/usr/sbin/screencapture', args, { timeout: 20_000 });
  } catch (err: any) {
    const msg = String(err?.stderr || err?.message || err);
    if (/could not create image|not authorized|permission/i.test(msg)) {
      return {
        ok: false,
        output:
          '[工具][错误] 截图失败：缺少「屏幕录制」权限。\n' +
          '请到 系统设置 → 隐私与安全性 → 屏幕录制，勾选 EAgent 后重启应用。'
      };
    }
    return { ok: false, output: `[工具][错误] 截图失败: ${msg.slice(0, 400)}` };
  }

  if (!fs.existsSync(file)) {
    return { ok: false, output: '[工具][错误] 截图失败：未生成文件（可能被系统权限拦截）' };
  }

  let info: Record<string, unknown> | undefined;
  try {
    info = await runMacinput(macinputPath, ['info']);
  } catch {
    info = undefined;
  }

  const size = fs.statSync(file).size;
  const kb = (size / 1024).toFixed(0);
  const displays = (info?.displays as any[]) ?? [];
  const d0 = displays[0];
  const mouse = (info?.mouse as any) ?? {};

  const lines: string[] = [];
  lines.push(`截图已保存：${file}（${kb} KB）`);
  if (d0) {
    lines.push('');
    lines.push('【附加信息】');
    lines.push(`- 主屏物理像素：${d0.pixelWidth} × ${d0.pixelHeight}（scale=${d0.scale}）`);
    lines.push(`- 主屏逻辑点尺寸：${d0.logicalWidth} × ${d0.logicalHeight}`);
    lines.push(`- 坐标系：左上原点，单位=逻辑点`);
    lines.push(`- 当前鼠标逻辑坐标：(${Math.round(mouse.x ?? 0)}, ${Math.round(mouse.y ?? 0)})`);
    lines.push('- 调用鼠标工具时请使用逻辑点坐标，不要用物理像素坐标。');
  }
  if (params.target === 'window' && params.windowId) {
    lines.push(`- 已截取窗口 id=${params.windowId}`);
  }

  return { ok: true, filePath: file, output: lines.join('\n'), info };
}

export async function listWindows(macinputPath: string): Promise<any> {
  try {
    return await runMacinput(macinputPath, ['windows']);
  } catch {
    return { windows: [] };
  }
}
