import React, { useState } from 'react';
import { X, FolderOpen, RotateCcw } from 'lucide-react';
import type { Settings, ToolName } from '@shared/types';
import { api } from '../lib/api';

interface SettingsSheetProps {
  open: boolean;
  settings: Settings | null;
  onClose: () => void;
  onSave: (patch: Partial<Settings>) => void;
}

const TOOL_LABELS: { key: ToolName; label: string }[] = [
  { key: 'shell', label: '终端命令' },
  { key: 'screenshot', label: '屏幕截图' },
  { key: 'upload', label: '上传文件' },
  { key: 'mouse', label: '鼠标操作' },
  { key: 'keyboard', label: '键盘操作' },
  { key: 'skill', label: '读取技能' }
];

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-white/[0.05] py-2.5 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] text-neutral-200">{label}</p>
          {hint && <p className="mt-0.5 text-[10.5px] leading-relaxed text-neutral-500">{hint}</p>}
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    </div>
  );
}

const INPUT =
  'h-7 rounded-lg bg-white/[0.06] px-2 text-[12px] text-neutral-200 outline-none placeholder:text-neutral-600 focus:bg-white/[0.1]';

export function SettingsSheet({ open, settings, onClose, onSave }: SettingsSheetProps) {
  const [draft, setDraft] = useState<Partial<Settings>>({});
  if (!open || !settings) return null;

  const value = <K extends keyof Settings>(k: K): Settings[K] => (draft[k] ?? settings[k]) as Settings[K];

  const patch = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = () => {
    onSave(draft);
    setDraft({});
    onClose();
  };

  const toggleTool = (tool: ToolName) => {
    const list = value('alwaysAllow') as ToolName[];
    const next = list.includes(tool) ? list.filter((t) => t !== tool) : [...list, tool];
    patch('alwaysAllow', next);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[82vh] w-[600px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-surface-2 shadow-popover"
      >
        <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
          <h3 className="text-[14px] font-medium text-neutral-100">设置</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/[0.07] hover:text-neutral-200"
          >
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          <Row label="工作目录" hint="终端命令的 cwd，也是文件选择器的默认位置">
            <div className="flex items-center gap-1.5">
              <input
                value={value('workDir')}
                onChange={(e) => patch('workDir', e.target.value)}
                className={INPUT + ' w-64'}
              />
              <button
                type="button"
                onClick={async () => {
                  const dirs = await api.pickDir();
                  if (dirs[0]) patch('workDir', dirs[0]);
                }}
                className="flex size-7 items-center justify-center rounded-lg bg-white/[0.07] text-neutral-300 hover:bg-white/[0.12]"
              >
                <FolderOpen size={12} />
              </button>
            </div>
          </Row>

          <Row label="Chrome 路径" hint="默认使用系统安装的 Google Chrome">
            <input
              value={value('chromePath')}
              onChange={(e) => patch('chromePath', e.target.value)}
              className={INPUT + ' w-64 font-mono text-[11px]'}
            />
          </Row>

          <Row label="调试端口" hint="CDP 端口，默认 9222">
            <input
              type="number"
              value={value('debugPort')}
              onChange={(e) => patch('debugPort', Number(e.target.value) || 9222)}
              className={INPUT + ' w-24 text-right'}
            />
          </Row>

          <Row label="自动授权" hint="开启后普通工具自动放行；高危命令仍强制逐条确认">
            <button
              type="button"
              onClick={() => patch('autoApprove', !value('autoApprove'))}
              className={`relative h-5 w-9 rounded-full transition-colors ${
                value('autoApprove') ? 'bg-clay' : 'bg-white/15'
              }`}
            >
              <span
                className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${
                  value('autoApprove') ? 'translate-x-[18px]' : 'translate-x-0.5'
                }`}
              />
            </button>
          </Row>

          <Row label="始终允许的工具" hint="勾选后该工具不再逐条询问（高危命令除外）">
            <div className="flex flex-wrap justify-end gap-1">
              {TOOL_LABELS.map((t) => {
                const on = (value('alwaysAllow') as ToolName[]).includes(t.key);
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => toggleTool(t.key)}
                    className={`h-6 rounded-md px-2 text-[11px] transition-colors ${
                      on ? 'bg-clay/20 text-clay' : 'bg-white/[0.06] text-neutral-400 hover:bg-white/[0.1]'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </Row>

          <Row label="命令超时" hint="单条终端命令最长执行时间（毫秒）">
            <input
              type="number"
              value={value('commandTimeoutMs')}
              onChange={(e) => patch('commandTimeoutMs', Number(e.target.value) || 120000)}
              className={INPUT + ' w-28 text-right'}
            />
          </Row>

          <Row label="回复超时" hint="等待 DeepSeek 回复的最长时间（毫秒）">
            <input
              type="number"
              value={value('replyTimeoutMs')}
              onChange={(e) => patch('replyTimeoutMs', Number(e.target.value) || 180000)}
              className={INPUT + ' w-28 text-right'}
            />
          </Row>

          <Row label="输出截断" hint="回填给模型的最大字符数">
            <input
              type="number"
              value={value('maxOutputChars')}
              onChange={(e) => patch('maxOutputChars', Number(e.target.value) || 64000)}
              className={INPUT + ' w-28 text-right'}
            />
          </Row>

          <div className="border-b border-white/[0.05] py-2.5">
            <p className="text-[12.5px] text-neutral-200">追加系统提示词</p>
            <p className="mt-0.5 text-[10.5px] text-neutral-500">
              每次「重新生成提示词」时追加到内置提示词末尾，可用于固定项目约定
            </p>
            <textarea
              value={value('systemPromptExtra')}
              onChange={(e) => patch('systemPromptExtra', e.target.value)}
              rows={4}
              placeholder="例如：本项目统一用 pnpm；不要改 vendor 目录。"
              className="mt-1.5 w-full resize-none rounded-lg bg-white/[0.06] p-2 text-[12px] leading-relaxed text-neutral-200 outline-none placeholder:text-neutral-600 focus:bg-white/[0.1]"
            />
            <button
              type="button"
              onClick={async () => {
                await api.rebuildPrompt(String(value('systemPromptExtra') ?? ''));
              }}
              className="mt-1.5 flex h-6 items-center gap-1 rounded-md bg-white/[0.07] px-2 text-[11px] text-neutral-300 hover:bg-white/[0.12]"
            >
              <RotateCcw size={10} />
              重新生成提示词
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] px-4 py-3">
          <button
            type="button"
            onClick={() => {
              setDraft({});
              onClose();
            }}
            className="h-7 rounded-lg px-3 text-[12px] text-neutral-400 hover:bg-white/[0.06] hover:text-neutral-200"
          >
            取消
          </button>
          <button
            type="button"
            onClick={save}
            className="h-7 rounded-lg bg-clay px-3.5 text-[12px] font-medium text-white transition-colors hover:bg-clay-hover"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
