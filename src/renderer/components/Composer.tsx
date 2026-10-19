import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, ArrowUp, Square, X, FileText, Image as ImageIcon } from 'lucide-react';
import { AttachmentCard } from '@cds/AttachmentCard';
import { api } from '../lib/api';

interface PickedFile {
  path: string;
  name: string;
  size: string;
}

function toPicked(paths: string[]): PickedFile[] {
  return paths.map((p) => {
    const name = p.split('/').pop() || p;
    return { path: p, name, size: '' };
  });
}

interface ComposerProps {
  busy: boolean;
  disabled?: boolean;
  placeholder?: string;
  onSend: (text: string, files: string[]) => void;
  onAbort: () => void;
}

/**
 * 自建输入区（不用 vendored ChatComposer）。
 * 原因：ChatComposer 没有受控 value/disabled，附件只能靠它内置的假「+ Add content」菜单，
 * 无法把真实文件路径注入引擎。这里保留它的视觉规格（20px 圆角、陶土发送键、CJK 输入法守卫）。
 */
export function Composer({ busy, disabled, placeholder, onSend, onAbort }: ComposerProps) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<PickedFile[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);

  // 自适应高度（textarea 的 field-sizing 在旧内核上不可靠，这里手动算）
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = Math.min(el.scrollHeight, 320) + 'px';
  }, [text]);

  const submit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || busy || disabled) return;
    onSend(trimmed, files.map((f) => f.path));
    setText('');
    setFiles([]);
  }, [text, files, busy, disabled, onSend]);

  const pick = useCallback(async () => {
    const paths = await api.pickFiles();
    if (!paths.length) return;
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.path));
      return [...prev, ...toPicked(paths).filter((f) => !seen.has(f.path))];
    });
  }, []);

  return (
    <div className="w-full px-4 pb-4">
      <div
        className="relative mx-auto flex w-full max-w-3xl flex-col gap-2 rounded-composer bg-surface-2 p-[0.875rem] shadow-composer transition-shadow focus-within:shadow-composer-focus"
      >
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((f) => (
              <div key={f.path} className="relative">
                <AttachmentCard
                  name={f.name}
                  size={f.size}
                  layout="chip"
                  onRemove={() => setFiles((prev) => prev.filter((x) => x.path !== f.path))}
                />
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // CJK 输入法合成期一律放行，避免拼音上屏被当成回车发送
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          disabled={disabled}
          placeholder={placeholder ?? '让 EAgent 在 Mac 上干活…（Enter 发送 / Shift+Enter 换行）'}
          className="max-h-80 min-h-[3rem] w-full resize-none border-none bg-transparent text-[15px] leading-[1.5] text-neutral-100 outline-none placeholder:text-neutral-500 disabled:opacity-60"
        />

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={pick}
            title="添加文件"
            className="flex size-7 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/[0.07] hover:text-neutral-200"
          >
            <Plus size={16} />
          </button>

          <span className="flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-neutral-400">
            <span className="size-1.5 rounded-full bg-clay" />
            DeepSeek 网页
          </span>

          <span className="flex-1" />

          {busy ? (
            <button
              type="button"
              onClick={onAbort}
              title="中止（⌘.）"
              className="flex size-8 items-center justify-center rounded-lg bg-white/10 text-neutral-200 transition-colors hover:bg-white/15"
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!text.trim() || disabled}
              title="发送"
              className="flex size-8 items-center justify-center rounded-lg bg-clay text-white transition-all hover:bg-clay-hover disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-neutral-500"
            >
              <ArrowUp size={15} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
      <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-neutral-500">
        工具执行需逐条授权 · ⌘. 随时急停
      </p>
    </div>
  );
}
