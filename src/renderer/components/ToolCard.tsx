import React, { useState } from 'react';
import {
  Terminal,
  Camera,
  Upload,
  MousePointer2,
  Keyboard,
  BookOpen,
  ShieldAlert,
  Check,
  X,
  Loader2,
  ChevronDown,
  ChevronRight,
  type LucideIcon
} from 'lucide-react';
import type { ToolCall } from '@shared/types';
import { paramLines } from '../lib/format';

const ICONS: Record<string, LucideIcon> = {
  shell: Terminal,
  screenshot: Camera,
  upload: Upload,
  mouse: MousePointer2,
  keyboard: Keyboard,
  skill: BookOpen
};

const NAMES: Record<string, string> = {
  shell: '终端命令',
  screenshot: '屏幕截图',
  upload: '上传文件',
  mouse: '鼠标操作',
  keyboard: '键盘操作',
  skill: '读取技能'
};

interface ToolCardProps {
  call: ToolCall;
  onVerdict: (verdict: 'allow_once' | 'always_allow' | 'deny') => void;
}

/**
 * 工具调用卡片（自建，非 vendored McpToolDecisionCard）。
 * 原因：vendored 那张卡片内部用 setTimeout 假执行、状态自成一体，
 * 无法接真实引擎状态。这里的状态完全由主进程 tool_update 事件驱动。
 */
export function ToolCard({ call, onVerdict }: ToolCardProps) {
  const [open, setOpen] = useState(true);
  const Icon = ICONS[call.name] ?? Terminal;
  const pending = call.status === 'pending_approval';
  const running = call.status === 'running';
  const done = call.status === 'success';
  const failed = call.status === 'error' || call.status === 'denied';
  const params = paramLines(call.params).filter((p) => p.value && p.value !== '—');

  const tone = pending
    ? 'border-amber-500/30 bg-amber-500/[0.06]'
    : running
      ? 'border-clay/30 bg-clay/[0.06]'
      : done
        ? 'border-emerald-500/25 bg-emerald-500/[0.05]'
        : 'border-red-500/25 bg-red-500/[0.05]';

  return (
    <div className={`my-3 w-full overflow-hidden rounded-xl border ${tone} transition-colors`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-white/5 text-neutral-300">
          <Icon size={13} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-neutral-200">
            {NAMES[call.name] ?? call.name}
            {call.dangerReason && (
              <span className="flex items-center gap-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-normal text-red-300">
                <ShieldAlert size={9} /> 高危
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-[11.5px] text-neutral-400">{call.summary}</span>
        </span>
        <span className="shrink-0">
          {pending && <span className="text-[11px] text-amber-300">待授权</span>}
          {running && <Loader2 size={13} className="animate-spin text-clay" />}
          {done && <Check size={13} className="text-emerald-400" />}
          {failed && <X size={13} className="text-red-400" />}
        </span>
        {open ? <ChevronDown size={13} className="shrink-0 text-neutral-500" /> : <ChevronRight size={13} className="shrink-0 text-neutral-500" />}
      </button>

      {open && (
        <div className="border-t border-white/[0.06] px-3 py-2.5">
          {call.dangerReason && (
            <p className="mb-2 rounded-md bg-red-500/10 px-2 py-1.5 text-[11.5px] leading-relaxed text-red-300">
              命中危险规则：{call.dangerReason}。即使已开启自动授权，此命令也必须逐条确认。
            </p>
          )}

          <dl className="space-y-1">
            {params.map((p) => (
              <div key={p.key} className="flex gap-2 text-[11.5px] leading-relaxed">
                <dt className="w-16 shrink-0 text-neutral-500">{p.key}</dt>
                <dd className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-neutral-300">
                  {p.value.length > 800 ? p.value.slice(0, 800) + ' …' : p.value}
                </dd>
              </div>
            ))}
          </dl>

          {pending && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onVerdict('allow_once')}
                className="h-7 rounded-lg bg-clay px-3 text-[12px] font-medium text-white transition-colors hover:bg-clay-hover"
              >
                允许本次
              </button>
              <button
                type="button"
                onClick={() => onVerdict('always_allow')}
                disabled={!!call.dangerReason}
                className="h-7 rounded-lg bg-white/10 px-3 text-[12px] text-neutral-200 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                始终允许 {NAMES[call.name] ?? call.name}
              </button>
              <button
                type="button"
                onClick={() => onVerdict('deny')}
                className="h-7 rounded-lg px-3 text-[12px] text-neutral-400 transition-colors hover:bg-white/5 hover:text-neutral-200"
              >
                拒绝
              </button>
            </div>
          )}

          {call.output && (
            <pre className="mt-2.5 max-h-72 overflow-auto rounded-lg bg-black/40 p-2.5 font-mono text-[11.5px] leading-relaxed text-neutral-300">
              {call.output.length > 6000 ? call.output.slice(0, 6000) + '\n…（已截断）' : call.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
