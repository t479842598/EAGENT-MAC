import type { CdpClient } from '../cdp';
import { loadSelectors } from '../selectors';

export interface MouseResult {
  ok: boolean;
  output: string;
}

/**
 * 鼠标工具 —— 从「CGEvent + 辅助功能权限」改为 CDP Input.dispatchMouseEvent。
 *
 * 旧方案在未授权辅助功能时会静默失败（CGEvent 被系统丢弃，macinput 仍返回 OK），
 * 模型会被骗；CDP 这条路不需要任何系统权限，且坐标就是页面 CSS 像素，
 * 与 capturePage 的截图完全同尺度，模型可以直接照图点。
 */
export async function controlMouse(
  params: { x: number | null; y: number | null; button: string },
  client: CdpClient
): Promise<MouseResult> {
  if (params.x === null || params.y === null || Number.isNaN(params.x) || Number.isNaN(params.y)) {
    return {
      ok: false,
      output:
        '[工具][错误] 鼠标坐标解析失败。\n' +
        '正确写法：_1_ 写 x 数字、_2_ 写 y 数字；\n' +
        '要看有什么可点：_1_ 写 list；只想滚动：_1_ 写 scroll，_2_ 写 dy（负数向上）。'
    };
  }
  const button = (['left', 'right', 'middle'].includes(params.button) ? params.button : 'left') as
    | 'left'
    | 'right'
    | 'middle';
  try {
    await client.mouseClick(params.x, params.y, button);
    // 回读落点命中的元素，帮模型确认点到了什么
    const hit = await client.evaluate<string>(`(() => {
      const el = document.elementFromPoint(${params.x}, ${params.y});
      if (!el) return '(无元素)';
      const txt = (el.innerText || '').trim().slice(0, 40);
      const cls = (el.className || '').toString().slice(0, 60);
      return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (txt ? ' | ' + txt : '');
    })()`);
    return {
      ok: true,
      output: `页面点击 (${params.x}, ${params.y}) 按键=${button}\n命中元素：${hit ?? '(未知)'}`
    };
  } catch (err) {
    return {
      ok: false,
      output: `[工具][错误] 页面点击失败: ${String(err instanceof Error ? err.message : err).slice(0, 300)}`
    };
  }
}

export async function mouseScroll(
  params: { x: number | null; y: number | null; dy: number },
  client: CdpClient
): Promise<MouseResult> {
  const x = params.x ?? 400;
  const y = params.y ?? 400;
  try {
    await client.mouseScroll(x, y, params.dy);
    const info = await client.evaluate<string>(`(() => {
      const el = document.elementFromPoint(${x}, ${y});
      const sc = el && el.closest('[class*="scroll"],[class*="overflow"]');
      if (sc) return 'scrollTop=' + Math.round(sc.scrollTop);
      return 'scrollY=' + Math.round(window.scrollY);
    })()`);
    return { ok: true, output: `页面滚轮 (${x}, ${y}) dy=${params.dy}\n${info ?? ''}` };
  } catch (err) {
    return {
      ok: false,
      output: `[工具][错误] 页面滚轮失败: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`
    };
  }
}

/** 把当前页面上所有可点击元素列出来，供模型选择坐标 */
export async function listClickables(client: CdpClient, limit = 60): Promise<{ ok: boolean; output: string }> {
  const expr = `(() => {
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('button,a,[role="button"],input,textarea,[contenteditable="true"]')) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      const label = ((el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '') + '').trim().slice(0, 40);
      const key = Math.round(r.x) + ',' + Math.round(r.y) + ',' + label;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 50),
        label,
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
        w: Math.round(r.width),
        h: Math.round(r.height)
      });
      if (out.length >= ${limit}) break;
    }
    return out;
  })()`;
  try {
    const list = await client.evaluate<any[]>(expr);
    if (!list || !list.length) return { ok: true, output: '(页面上没有找到可点击元素)' };
    const lines = list.map(
      (e, i) =>
        `${i + 1}. (${e.x}, ${e.y}) ${e.tag} ${e.w}×${e.h} ${e.label ? '「' + e.label + '」' : ''} ${e.cls ? '[' + e.cls + ']' : ''}`
    );
    return { ok: true, output: `页面可点击元素（${list.length} 个，坐标为点击中心点）：\n` + lines.join('\n') };
  } catch (err) {
    return { ok: false, output: `[工具][错误] 枚举失败: ${String(err instanceof Error ? err.message : err).slice(0, 200)}` };
  }
}
