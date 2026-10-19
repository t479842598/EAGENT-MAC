import fs from 'node:fs';
import path from 'node:path';
import type { WebContents } from 'electron';
import type { Settings } from '../../../shared/types';

export interface ScreenshotResult {
  ok: boolean;
  filePath?: string;
  output: string;
  info?: Record<string, unknown>;
}

/**
 * 截图工具 —— 从「系统 screencapture + 屏幕录制权限」改为 webContents.capturePage()。
 *
 * 两个关键事实（实测）：
 *  1. capturePage 不需要屏幕录制权限，因为它截的是页面自身的合成结果；
 *  2. 但 webContents 必须处于「有 display surface」的状态 —— 视图被 setVisible(false)
 *     隐藏后仍然可以截（这一点与窗口 show:false 不同），实测返回非空位图。
 */
export async function takeScreenshot(
  params: { target: 'screen' | 'window'; windowId: number | null },
  webContents: WebContents | null,
  settings: Settings,
  tempDir: string
): Promise<ScreenshotResult> {
  if (!webContents || webContents.isDestroyed()) {
    return { ok: false, output: '[工具][错误] 截图失败：内嵌页面未就绪' };
  }

  fs.mkdirSync(tempDir, { recursive: true });
  const file = path.join(tempDir, `屏幕截图_${Date.now()}.jpg`);

  let image: Electron.NativeImage;
  try {
    image = await webContents.capturePage();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/display surface not available/i.test(msg)) {
      return {
        ok: false,
        output:
          '[工具][错误] 截图失败：当前窗口不可见导致合成表面不可用。\n' +
          '请确认窗口没有被最小化（隐藏到后台是可以的，最小化不行）。'
      };
    }
    return { ok: false, output: `[工具][错误] 截图失败: ${msg.slice(0, 300)}` };
  }

  if (image.isEmpty()) {
    return { ok: false, output: '[工具][错误] 截图失败：位图为空（窗口可能被最小化）' };
  }

  const jpeg = image.toJPEG(85);
  fs.writeFileSync(file, jpeg);

  const size = image.getSize();
  const zoom = webContents.getZoomFactor?.() ?? 1;
  // capturePage 出的是设备像素（Retina 下是 CSS 像素的两倍）。
  // 鼠标工具吃的是 CSS 像素，必须把换算系数明确写给模型，否则它会把图片像素当坐标用。
  const cssSize = webContents.executeJavaScript
    ? await webContents
        .executeJavaScript('({w: innerWidth, h: innerHeight})', true)
        .catch(() => null)
    : null;
  const cssW = cssSize?.w || Math.round(size.width / zoom);
  const cssH = cssSize?.h || Math.round(size.height / zoom);
  const dpr = cssW ? Math.round((size.width / cssW) * 100) / 100 : 2;
  const kb = (jpeg.length / 1024).toFixed(0);

  const lines: string[] = [];
  lines.push(`截图已保存：${file}（${kb} KB）`);
  lines.push('');
  lines.push('【附加信息】');
  lines.push(`- 图片像素尺寸：${size.width} × ${size.height}`);
  lines.push(`- 页面视口（CSS 像素）：${cssW} × ${cssH}`);
  lines.push(`- 换算：CSS 坐标 = 图片坐标 ÷ ${dpr}`);
  lines.push(`- 页面缩放：${zoom}`);
  lines.push('- 鼠标/键盘工具使用【CSS 像素】坐标，左上原点；不要直接拿图片像素当坐标。');
  if (params.target === 'window' && params.windowId) {
    lines.push(`- 已忽略窗口 id=${params.windowId}（内嵌模式只有当前页面）`);
  }
  lines.push(`- 当前页面：${webContents.getURL()}`);

  return { ok: true, filePath: file, output: lines.join('\n') };
}
