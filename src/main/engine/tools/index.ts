import fs from 'node:fs';
import path from 'node:path';
import type { WebContents } from 'electron';
import type { Settings, ToolName } from '../../../shared/types';
import type { CdpClient } from '../cdp';
import type { ParsedToolCall } from '../sentinel';
import { detectDanger, runShell } from './shell';
import { takeScreenshot } from './screenshot';
import { controlMouse, mouseScroll, listClickables } from './mouse';
import { controlKeyboard } from './keyboard';

export interface ToolExecResult {
  ok: boolean;
  output: string;
  files?: string[];
  dangerReason?: string | null;
}

export interface ToolContext {
  settings: Settings;
  tempDir: string;
  skillsDir: string;
  /** 内嵌页面句柄，截图用 */
  webContents: () => WebContents | null;
  /** 进程内 CDP 客户端，鼠标/键盘用 */
  client: () => CdpClient | null;
  uploadFiles: (files: string[]) => Promise<boolean>;
}

export async function executeTool(
  call: ParsedToolCall,
  ctx: ToolContext,
  signal?: AbortSignal
): Promise<ToolExecResult> {
  const { settings } = ctx;

  switch (call.name) {
    case 'shell': {
      const script = String(call.params.script ?? '');
      const danger = detectDanger(script);
      const r = await runShell(script, settings, ctx.tempDir, signal);
      return { ok: r.ok, output: r.output, dangerReason: danger };
    }
    case 'screenshot': {
      const r = await takeScreenshot(
        call.params as { target: 'screen' | 'window'; windowId: number | null },
        ctx.webContents(),
        settings,
        ctx.tempDir
      );
      return { ok: r.ok, output: r.output, files: r.filePath ? [r.filePath] : [] };
    }
    case 'upload': {
      const files = (call.params.files as string[]) ?? [];
      const existing = files.filter((f) => fs.existsSync(f));
      if (!existing.length) {
        return { ok: false, output: `[工具][错误] 上传失败：文件不存在 -> ${files.join(', ')}` };
      }
      const ok = await ctx.uploadFiles(existing);
      if (!ok) return { ok: false, output: '[工具][错误] 上传失败：页面上找不到 file input' };
      const missing = files.filter((f) => !fs.existsSync(f));
      return {
        ok: true,
        output:
          `已上传 ${existing.length} 个文件：\n` +
          existing.map((f) => '- ' + path.basename(f)).join('\n') +
          (missing.length ? `\n（跳过不存在的文件：${missing.join(', ')}）` : '')
      };
    }
    case 'mouse': {
      const client = ctx.client();
      if (!client) return { ok: false, output: '[工具][错误] 页面未连接，无法执行鼠标操作' };
      const p = call.params as {
        x: number | null;
        y: number | null;
        button: string;
        scrollDy?: number | null;
        list?: boolean;
      };
      // 扩展能力：list=true 枚举页面可点击元素；scrollDy 存在时走滚轮
      if (p.list) return await listClickables(client);
      if (typeof p.scrollDy === 'number' && !Number.isNaN(p.scrollDy)) {
        const r = await mouseScroll({ x: p.x, y: p.y, dy: p.scrollDy }, client);
        return { ok: r.ok, output: r.output };
      }
      const r = await controlMouse({ x: p.x, y: p.y, button: p.button }, client);
      return { ok: r.ok, output: r.output };
    }
    case 'keyboard': {
      const client = ctx.client();
      if (!client) return { ok: false, output: '[工具][错误] 页面未连接，无法执行键盘操作' };
      const r = await controlKeyboard(
        call.params as { mode: string; key: string; text: string; window: string; plain?: string },
        client
      );
      return { ok: r.ok, output: r.output };
    }
    case 'skill': {
      const name = String(call.params.name ?? '').trim();
      const base = ctx.skillsDir;
      if (!name) {
        const list = safeListSkills(base);
        return {
          ok: true,
          output: `skills 目录: ${base}\n可用 skill：\n${list.map((s) => '- ' + s).join('\n') || '(空)'}`
        };
      }
      // 防目录穿越：只允许一层目录名
      if (name.includes('/') || name.includes('\\') || name === '..') {
        return { ok: false, output: `[工具][错误] 非法 skill 名称: ${name}` };
      }
      const dir = path.join(base, name);
      const md = path.join(dir, 'SKILL.md');
      if (!fs.existsSync(md)) {
        const list = safeListSkills(base);
        return {
          ok: false,
          output: `[工具][错误] 未找到 skill: ${name}。可用：\n${list.map((s) => '- ' + s).join('\n')}`
        };
      }
      const body = fs.readFileSync(md, 'utf8');
      const extra: string[] = [];
      for (const sub of ['references', 'docs', 'templates', 'snippets']) {
        const d = path.join(dir, sub);
        if (fs.existsSync(d) && fs.statSync(d).isDirectory()) {
          extra.push(`- ${sub}/: ${fs.readdirSync(d).join(', ')}`);
        }
      }
      return {
        ok: true,
        output: `# skill: ${name}\n目录: ${dir}\n${extra.length ? '附带资源：\n' + extra.join('\n') + '\n' : ''}\n--- SKILL.md ---\n${body}`
      };
    }
    default:
      return { ok: false, output: `[工具][错误] 未知工具: ${call.name as ToolName}` };
  }
}

function safeListSkills(base: string): string[] {
  try {
    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

export function wrapToolResult(result: ToolExecResult): string {
  const head = result.ok ? '//[工具][取回结果]//' : '//[工具][错误]//';
  const body = result.output || '(空)';
  return `${head}\n${body}\n//[END]//`;
}
