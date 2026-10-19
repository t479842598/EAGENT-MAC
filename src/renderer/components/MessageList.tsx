import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, ToolCall } from '@shared/types';
import { Markdown } from './Markdown';
import { ToolCard } from './ToolCard';
import { extractImagePath } from '../lib/format';
import { api } from '../lib/api';

interface MessageListProps {
  messages: ChatMessage[];
  onVerdict: (callId: string, verdict: 'allow_once' | 'always_allow' | 'deny') => void;
  onOpenImage: (path: string) => void;
}

function ScreenshotThumb({ path, onOpen }: { path: string; onOpen: (p: string) => void }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    void api.readImage(path).then((d) => {
      if (alive) setSrc(d);
    });
    return () => {
      alive = false;
    };
  }, [path]);
  if (!src) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen(path)}
      className="mt-2 block overflow-hidden rounded-xl border border-white/10 transition-transform hover:scale-[1.01]"
    >
      <img src={src} alt="屏幕截图" className="max-h-72 w-auto object-contain" />
    </button>
  );
}

function UserRow({ m }: { m: ChatMessage }) {
  return (
    <div className="flex w-full flex-col items-end gap-1.5">
      {!!m.attachments?.length && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {m.attachments.map((a) => (
            <span
              key={a.id}
              className="flex max-w-56 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-neutral-300"
            >
              <span className="font-mono text-[10px] uppercase text-clay">{a.category}</span>
              <span className="truncate">{a.name}</span>
            </span>
          ))}
        </div>
      )}
      <div className="max-w-[78%] whitespace-pre-wrap break-words rounded-bubble rounded-br-md bg-white/[0.08] px-4 py-2.5 text-[14.5px] leading-relaxed text-neutral-100">
        {m.text}
      </div>
      <span className="text-[10.5px] text-neutral-600">{m.time}</span>
    </div>
  );
}

function AssistantRow({
  m,
  onVerdict,
  onOpenImage
}: {
  m: ChatMessage;
  onVerdict: (callId: string, verdict: 'allow_once' | 'always_allow' | 'deny') => void;
  onOpenImage: (path: string) => void;
}) {
  const imagePath = useMemo(() => extractImagePath(m.toolCall?.output), [m.toolCall?.output]);
  return (
    <div className="flex w-full flex-col items-start gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-clay" />
        <span className="text-[11px] font-medium text-neutral-400">EAgent</span>
        <span className="text-[10.5px] text-neutral-600">{m.time}</span>
      </div>
      <div className="w-full max-w-[92%]">
        <Markdown text={m.text} />
        {m.toolCall && <ToolCard call={m.toolCall as ToolCall} onVerdict={(v) => onVerdict(m.toolCall!.id, v)} />}
        {imagePath && <ScreenshotThumb path={imagePath} onOpen={onOpenImage} />}
      </div>
    </div>
  );
}

export function MessageList({ messages, onVerdict, onOpenImage }: MessageListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // 贴底滚动：用户主动上滑后不再强制拽回底部
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div ref={scroller} className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 py-6">
        {messages.length === 0 ? (
          <div className="mt-24 text-center">
            <h2 className="text-[19px] font-medium text-neutral-200">EAgent · macOS</h2>
            <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-neutral-500">
              通过 Chrome 调试协议驱动 chat.deepseek.com，在你本机执行终端命令、截屏、鼠标键盘与文件上传。
              首次使用请先点右上角「启动浏览器」并登录 DeepSeek。
            </p>
          </div>
        ) : (
          messages.map((m) =>
            m.role === 'user' ? (
              <UserRow key={m.id} m={m} />
            ) : (
              <AssistantRow key={m.id} m={m} onVerdict={onVerdict} onOpenImage={onOpenImage} />
            )
          )
        )}
      </div>
    </div>
  );
}
