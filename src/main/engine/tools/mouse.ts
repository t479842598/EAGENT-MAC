import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readPermState, AX_HINT } from './perm';

const exec = promisify(execFile);

export interface MouseResult {
  ok: boolean;
  output: string;
}

export async function controlMouse(
  params: { x: number | null; y: number | null; button: string },
  macinputPath: string
): Promise<MouseResult> {
  if (params.x === null || params.y === null || Number.isNaN(params.x) || Number.isNaN(params.y)) {
    return {
      ok: false,
      output: '[工具][错误] 鼠标坐标解析失败：需要在 agent_mouse_simulate_1/2 中给出数字 x/y。'
    };
  }
  const perm = await readPermState(macinputPath);
  if (!perm.accessibilityTrusted) {
    return {
      ok: false,
      output:
        '[工具][错误] 鼠标模拟失败：缺少「辅助功能」权限（CGEvent 会被系统丢弃，不会报错）。\n' + AX_HINT
    };
  }
  try {
    const { stdout } = await exec(
      macinputPath,
      ['mouse', 'click', String(params.x), String(params.y), params.button],
      { timeout: 10_000 }
    );
    return { ok: true, output: `鼠标已点击 (${params.x}, ${params.y}) 按键=${params.button}\n${stdout.trim()}` };
  } catch (err: any) {
    const msg = String(err?.stderr || err?.message || err);
    if (/not trusted|accessibility/i.test(msg) || msg.includes('143')) {
      return {
        ok: false,
        output:
          '[工具][错误] 鼠标模拟失败：缺少「辅助功能」权限。\n' +
          '请到 系统设置 → 隐私与安全性 → 辅助功能，勾选 EAgent 后重启应用。'
      };
    }
    return { ok: false, output: `[工具][错误] 鼠标模拟失败: ${msg.slice(0, 300)}` };
  }
}

export async function mouseScroll(dy: number, macinputPath: string): Promise<MouseResult> {
  const perm = await readPermState(macinputPath);
  if (!perm.accessibilityTrusted) {
    return { ok: false, output: '[工具][错误] 滚轮失败：缺少「辅助功能」权限。\n' + AX_HINT };
  }
  try {
    await exec(macinputPath, ['mouse', 'scroll', String(dy)], { timeout: 8000 });
    return { ok: true, output: `滚轮 ${dy}` };
  } catch (err: any) {
    return { ok: false, output: `[工具][错误] 滚轮失败: ${String(err?.message ?? err).slice(0, 200)}` };
  }
}
