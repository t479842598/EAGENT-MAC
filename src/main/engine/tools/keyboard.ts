import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface KeyboardResult {
  ok: boolean;
  output: string;
}

export async function controlKeyboard(
  params: { mode: string; key: string; text: string; window: string },
  macinputPath: string
): Promise<KeyboardResult> {
  const mode = (params.mode || 'tap').toLowerCase();

  // 可选：先激活目标应用（对齐上游「窗口句柄」语义）
  if (params.window) {
    try {
      await exec(macinputPath, ['activate', params.window], { timeout: 8000 });
    } catch {
      /* 激活失败不阻断，继续发键 */
    }
  }

  try {
    if (mode === 'type') {
      const text = params.text || params.key;
      if (!text) return { ok: false, output: '[工具][错误] type 模式需要提供要输入的文本' };
      await exec(macinputPath, ['key', 'type', text], { timeout: 30_000, maxBuffer: 1024 * 1024 });
      return { ok: true, output: `已输入 ${text.length} 个字符` };
    }
    if (mode === 'combo') {
      if (!params.key) return { ok: false, output: '[工具][错误] combo 模式需要在 _2_ 提供组合键，如 cmd+shift+4' };
      await exec(macinputPath, ['key', 'combo', params.key], { timeout: 10_000 });
      return { ok: true, output: `已发送组合键 ${params.key}` };
    }
    // tap
    const key = params.key || params.text;
    if (!key) return { ok: false, output: '[工具][错误] tap 模式需要在 _2_ 提供键名，如 return / tab / esc' };
    await exec(macinputPath, ['key', 'tap', key], { timeout: 10_000 });
    return { ok: true, output: `已按下 ${key}` };
  } catch (err: any) {
    const msg = String(err?.stderr || err?.message || err);
    if (/not trusted|accessibility/i.test(msg)) {
      return {
        ok: false,
        output:
          '[工具][错误] 键盘模拟失败：缺少「辅助功能」权限。\n' +
          '请到 系统设置 → 隐私与安全性 → 辅助功能，勾选 EAgent 后重启应用。'
      };
    }
    return { ok: false, output: `[工具][错误] 键盘模拟失败: ${msg.slice(0, 300)}` };
  }
}
