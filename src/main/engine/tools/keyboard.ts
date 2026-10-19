import type { CdpClient, KeyEventInit } from '../cdp';
import { MOD } from '../cdp';

const isMac = process.platform === 'darwin';

export interface KeyboardResult {
  ok: boolean;
  output: string;
}

/** 常见按键 → Windows 虚拟键码（CDP 需要它才能触发页面快捷键） */
const VK: Record<string, number> = {
  enter: 13,
  tab: 9,
  escape: 27,
  esc: 27,
  backspace: 8,
  delete: 46,
  ' ': 32,
  space: 32,
  arrowup: 38,
  arrowdown: 40,
  arrowleft: 37,
  arrowright: 39,
  home: 36,
  end: 35,
  pageup: 33,
  pagedown: 34,
  up: 38,
  down: 40,
  left: 37,
  right: 39
};

function codeFor(key: string): string {
  const k = key.toLowerCase();
  if (k.length === 1 && /[a-z]/.test(k)) return 'Key' + k.toUpperCase();
  if (k.length === 1 && /[0-9]/.test(k)) return 'Digit' + k;
  const map: Record<string, string> = {
    enter: 'Enter',
    tab: 'Tab',
    escape: 'Escape',
    esc: 'Escape',
    backspace: 'Backspace',
    delete: 'Delete',
    ' ': 'Space',
    space: 'Space',
    arrowup: 'ArrowUp',
    arrowdown: 'ArrowDown',
    arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight',
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pagedown: 'PageDown'
  };
  return map[k] ?? key;
}

function vkFor(key: string): number {
  const k = key.toLowerCase();
  if (VK[k] !== undefined) return VK[k];
  if (k.length === 1) {
    const up = k.toUpperCase();
    if (up >= 'A' && up <= 'Z') return up.charCodeAt(0);
    if (up >= '0' && up <= '9') return up.charCodeAt(0);
  }
  return 0;
}

function parseCombo(combo: string): KeyEventInit {
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean);
  let modifiers = 0;
  let main = '';
  for (const p of parts) {
    const low = p.toLowerCase();
    // Windows/Linux 上没有 Command 键：把 cmd/meta 归一化成 Ctrl，
    // 避免模型照抄 macOS 习惯写出 cmd+a 在 Windows 上变成「只按了 A」。
    if (low === 'cmd' || low === 'command' || low === 'meta' || low === 'super') {
      modifiers |= isMac ? MOD.meta : MOD.ctrl;
    } else if (low === 'ctrl' || low === 'control') modifiers |= MOD.ctrl;
    else if (low === 'alt' || low === 'option' || low === 'opt') modifiers |= MOD.alt;
    else if (low === 'shift') modifiers |= MOD.shift;
    else main = p;
  }
  if (!main) main = parts[parts.length - 1] ?? '';
  return { key: main, code: codeFor(main), keyCode: vkFor(main), modifiers };
}

/**
 * 键盘工具 —— 从「CGEvent + 辅助功能权限」改为 CDP Input.dispatchKeyEvent。
 * 只作用于内嵌页面，不影响系统其他应用，也不需要任何系统授权。
 */
export async function controlKeyboard(
  params: { mode: string; key: string; text: string; window: string; plain?: string },
  client: CdpClient
): Promise<KeyboardResult> {
  const mode = (params.mode || 'tap').toLowerCase();

  // 兼容旧协议：模型有时把 key/combo 写在 body 纯文本首行
  const fallback = (params.plain ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';

  try {
    if (mode === 'type') {
      const text = params.text || params.key || fallback;
      if (!text) return { ok: false, output: '[工具][错误] 键盘 type 缺少要输入的文字' };
      await client.insertText(text);
      return { ok: true, output: `已在页面输入 ${text.length} 个字符` };
    }

    if (mode === 'combo') {
      const combo = params.key || fallback;
      if (!combo) return { ok: false, output: '[工具][错误] 键盘 combo 缺少组合键（如 cmd+a）' };
      const init = parseCombo(combo);
      await client.dispatchKey(init);
      return { ok: true, output: `已发送组合键 ${combo}` };
    }

    // tap（默认）
    const key = params.key || fallback || 'Enter';
    const init = parseCombo(key);
    await client.dispatchKey(init);
    return { ok: true, output: `已发送按键 ${key}` };
  } catch (err) {
    return {
      ok: false,
      output: `[工具][错误] 键盘发送失败: ${String(err instanceof Error ? err.message : err).slice(0, 300)}`
    };
  }
}
