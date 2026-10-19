import type { ToolName } from '../../shared/types';

/**
 * 哨兵协议解析器 —— 与上游 EAgent 完全同构。
 * AI 只输出一个代码块，代码块内含 HTML/PowerShell 注释形式的哨兵行；
 * 主程序用「取出中间文本」的等价逻辑截取工具参数。
 */

const HEAD_SUFFIX = '_调用工具_识别头_本行注释一定要完全保留';
const TAIL_SUFFIX = '_调用工具_识别尾_本行注释一定要完全保留';

export interface SentinelSpec {
  name: ToolName;
  heads: string[];        // 兼容别名，按顺序匹配
  tail: string;
}

export const SENTINELS: SentinelSpec[] = [
  { name: 'shell', heads: ['# shell_tool', '# powershell_tool'], tail: '# powershell_tool' + TAIL_SUFFIX },
  { name: 'screenshot', heads: ['# tool_取屏幕截图'], tail: '# tool_取屏幕截图' + TAIL_SUFFIX },
  { name: 'upload', heads: ['# tool_上传文件'], tail: '# tool_上传文件' + TAIL_SUFFIX },
  { name: 'mouse', heads: ['# tool_控制鼠标'], tail: '# tool_控制鼠标' + TAIL_SUFFIX },
  { name: 'keyboard', heads: ['# tool_控制键盘'], tail: '# tool_控制键盘' + TAIL_SUFFIX },
  { name: 'skill', heads: ['# tool_读取skill', '# tool_读取SKILL'], tail: '# tool_读取skill' + TAIL_SUFFIX }
];

export interface ParsedToolCall {
  name: ToolName;
  raw: string;
  body: string;
  params: Record<string, unknown>;
  summary: string;
}

/** 去掉 markdown 代码围栏，只留正文 */
export function stripFences(text: string): string {
  return text.replace(/^\s*```[a-zA-Z0-9_-]*\s*$/gm, '').replace(/^```\s*$/gm, '');
}

function findBody(text: string, spec: SentinelSpec): { head: string; body: string } | null {
  for (const head of spec.heads) {
    // 头部：允许 head + 任意后缀（_本行注释一定要完全保留）
    const headRe = new RegExp(escapeRe(head) + '[^\\n]*', 'g');
    let m: RegExpExecArray | null;
    while ((m = headRe.exec(text)) !== null) {
      const start = m.index + m[0].length;
      // 尾部：兼容 # powershell_tool_调用工具_识别尾_... 或 # shell_tool_...
      const tailCandidates = [
        spec.tail,
        '# shell_tool' + TAIL_SUFFIX,
        '# powershell_tool' + TAIL_SUFFIX
      ];
      for (const t of tailCandidates) {
        const idx = text.indexOf(t, start);
        if (idx >= 0) {
          return { head, body: text.slice(start, idx).trim() };
        }
      }
      // 兜底：若同块内出现其它哨兵头，则截到那里
      const nextIdx = nextSentinelIndex(text, start);
      if (nextIdx > start) {
        return { head, body: text.slice(start, nextIdx).trim() };
      }
      return { head, body: text.slice(start).trim() };
    }
  }
  return null;
}

function nextSentinelIndex(text: string, from: number): number {
  let min = -1;
  for (const s of SENTINELS) {
    for (const h of s.heads) {
      const i = text.indexOf(h, from);
      if (i >= 0 && (min < 0 || i < min)) min = i;
    }
  }
  return min;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------- 各工具参数解析 ----------

function between(text: string, startMark: string, endMark: string): string | null {
  const i = text.indexOf(startMark);
  if (i < 0) return null;
  const from = i + startMark.length;
  const j = text.indexOf(endMark, from);
  if (j < 0) return null;
  return text.slice(from, j).trim();
}

function parseScreenshot(body: string): Record<string, unknown> {
  const inner = between(body, 'agent_getjpg_1_star', '_1_getjpg_end');
  const target = (inner ?? '屏幕').trim();
  const isScreen = /屏幕|screen|全屏/i.test(target);
  return {
    target: isScreen ? 'screen' : 'window',
    windowId: isScreen ? null : Number(target.replace(/[^0-9]/g, '')) || null,
    raw: target
  };
}

function parseUpload(body: string): Record<string, unknown> {
  const inner = between(body, 'agent_getfile_head', 'agent_getfile_end');
  const files = (inner ?? '')
    .split(/[\n,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { files };
}

function parseMouse(body: string): Record<string, unknown> {
  const raw1 = (between(body, 'agent_mouse_simulate_1_start', '_agent_mouse_simulate_1_end') ?? '').trim();
  const raw2 = (between(body, 'agent_mouse_simulate_2_start', '_agent_mouse_simulate_2_end') ?? '').trim();
  const b = between(body, 'agent_mouse_simulate_3_start', '_agent_mouse_simulate_3_end');
  const button = (b ?? 'left').trim().toLowerCase();
  const btn = ['left', 'right', 'middle'].includes(button) ? button : 'left';

  // 内嵌模式扩展：_1_ 可以是 list（枚举可点击元素）或 scroll（_2_ 为 dy）
  const mode = raw1.toLowerCase();
  if (mode === 'list') {
    return { x: null, y: null, button: btn, list: true };
  }
  if (mode === 'scroll') {
    const dy = raw2 !== '' && !Number.isNaN(Number(raw2)) ? Number(raw2) : -400;
    return { x: null, y: null, button: btn, scrollDy: dy };
  }

  return {
    x: raw1 !== '' && !Number.isNaN(Number(raw1)) ? Number(raw1) : null,
    y: raw2 !== '' && !Number.isNaN(Number(raw2)) ? Number(raw2) : null,
    button: btn
  };
}

function parseKeyboard(body: string): Record<string, unknown> {
  const k1 = between(body, 'agent_keyboard_simulate_1_start', '_agent_keyboard_simulate_1_end');
  const k2 = between(body, 'agent_keyboard_simulate_2_start', '_agent_keyboard_simulate_2_end');
  const k3 = between(body, 'agent_keyboard_simulate_3_start', '_agent_keyboard_simulate_3_end');
  const w = between(body, 'agent_keyboard_simulate_4_start', '_agent_keyboard_simulate_4_end');
  // 新协议：key / combo / type 三选一，写在 body 纯文本里
  const plain = body.replace(/agent_keyboard_simulate_[0-9]_start[\s\S]*?agent_keyboard_simulate_[0-9]_end/g, '').trim();
  const mode = (k1 ?? '').trim();
  return {
    mode: mode || 'tap',
    key: (k2 ?? '').trim(),
    text: (k3 ?? '').trim(),
    window: (w ?? '').trim(),
    plain
  };
}

function parseSkill(body: string): Record<string, unknown> {
  const inner = between(body, 'agent_skill_start', '_agent_skill_end');
  return { name: (inner ?? body.split('\n')[0] ?? '').trim() };
}

function summarize(name: ToolName, params: Record<string, unknown>, body: string): string {
  switch (name) {
    case 'shell':
      return firstLine(body) || '执行 shell 命令';
    case 'screenshot':
      return params.target === 'screen' ? '截取全屏' : `截取窗口 #${params.windowId ?? '?'}`;
    case 'upload': {
      const files = (params.files as string[]) ?? [];
      return `上传 ${files.length} 个文件`;
    }
    case 'mouse':
      if (params.list) return '鼠标：枚举页面可点击元素';
      if (typeof params.scrollDy === 'number') return `鼠标：滚轮 dy=${params.scrollDy}`;
      return `鼠标 ${params.button} 点击 (${params.x}, ${params.y})`;
    case 'keyboard':
      return `键盘 ${params.mode} ${(params.key || params.text || '') as string}`.trim();
    case 'skill':
      return `读取 skill：${(params.name as string) || '(列出全部)'}`;
    default:
      return name;
  }
}

function firstLine(s: string): string {
  const line = s.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
  return (line ?? '').slice(0, 160);
}

export function parseToolCall(reply: string): ParsedToolCall | null {
  const text = stripFences(reply);
  for (const spec of SENTINELS) {
    const hit = findBody(text, spec);
    if (!hit) continue;
    let params: Record<string, unknown> = {};
    switch (spec.name) {
      case 'shell':
        params = { script: hit.body };
        break;
      case 'screenshot':
        params = parseScreenshot(hit.body);
        break;
      case 'upload':
        params = parseUpload(hit.body);
        break;
      case 'mouse':
        params = parseMouse(hit.body);
        break;
      case 'keyboard':
        params = parseKeyboard(hit.body);
        break;
      case 'skill':
        params = parseSkill(hit.body);
        break;
    }
    return {
      name: spec.name,
      raw: hit.head + '\n' + hit.body,
      body: hit.body,
      params,
      summary: summarize(spec.name, params, hit.body)
    };
  }
  return null;
}

/**
 * 「假调用」自愈：AI 提到了工具名却没写对哨兵 —— 上游同款兜底。
 */
export function detectFakeCall(reply: string): ToolName | null {
  const t = reply;
  if (/powershell_tool|shell_tool/i.test(t) && !t.includes('识别头')) return 'shell';
  if (/tool_取屏幕截图_调用/i.test(t) && !t.includes('识别头')) return 'screenshot';
  if (/tool_上传文件_调用/i.test(t) && !t.includes('识别头')) return 'upload';
  if (/tool_控制鼠标_调用/i.test(t) && !t.includes('识别头')) return 'mouse';
  if (/tool_控制键盘_调用/i.test(t) && !t.includes('识别头')) return 'keyboard';
  if (/tool_读取skill_调用/i.test(t) && !t.includes('识别头')) return 'skill';
  return null;
}

export const SENTINEL_HEAD = '# shell_tool' + HEAD_SUFFIX;
export const SENTINEL_TAIL = '# shell_tool' + TAIL_SUFFIX;
