import fs from 'node:fs';
import path from 'node:path';
import type { Settings, ToolName } from '../../../shared/types';
import type { ParsedToolCall } from '../sentinel';
import { detectDanger, runShell } from './shell';
import { takeScreenshot } from './screenshot';
import { controlMouse } from './mouse';
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
  macinputPath: string;
  skillsDir: string;
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
        settings,
        ctx.tempDir,
        ctx.macinputPath
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
        output: `已上传 ${existing.length} 个文件：\n${existing.map((f) => '- ' + path.basename(f)).join('\n')}` +
          (missing.length ? `\n（跳过不存在的文件：${missing.join(', ')}）` : '')
      };
    }
    case 'mouse': {
      const r = await controlMouse(
        call.params as { x: number | null; y: number | null; button: string },
        ctx.macinputPath
      );
      return { ok: r.ok, output: r.output };
    }
    case 'keyboard': {
      const r = await controlKeyboard(
        call.params as { mode: string; key: string; text: string; window: string },
        ctx.macinputPath
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
