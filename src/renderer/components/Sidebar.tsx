import React, { useState } from 'react';
import { Plus, Pin, PinOff, Trash2, Search, Activity } from 'lucide-react';
import type { SessionState, SessionStats } from '@shared/types';
import type { StoredSession } from '../lib/sessions';
import { relTime, statusKind, statusLabel } from '../lib/format';
import { StatusDot } from '@cds/StatusIndicators';

interface SidebarProps {
  sessions: StoredSession[];
  activeId: string;
  state: SessionState;
  detail?: string;
  stats: SessionStats;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRemove: (id: string) => void;
  onTogglePin: (id: string) => void;
  onOpenDoctor: () => void;
  onOpenSettings: () => void;
}

/**
 * 侧栏（自建，非 vendored DraggableSessionList）。
 * vendored 那张列表内部写死 INITIAL_SESSIONS、不接受外部数据，无法承载真实会话。
 */
export function Sidebar({
  sessions,
  activeId,
  state,
  detail,
  stats,
  onSelect,
  onCreate,
  onRemove,
  onTogglePin,
  onOpenDoctor,
  onOpenSettings
}: SidebarProps) {
  const [query, setQuery] = useState('');
  const filtered = query
    ? sessions.filter((s) => s.title.toLowerCase().includes(query.toLowerCase()))
    : sessions;

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-white/[0.07] bg-surface-1">
      {/* 顶部留出红绿灯空间（窗口 titleBarStyle: hidden） */}
      <div className="h-[38px] shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={onCreate}
          className="flex h-8 w-full items-center gap-2 rounded-lg bg-white/[0.07] px-2.5 text-[12.5px] text-neutral-200 transition-colors hover:bg-white/[0.11]"
        >
          <Plus size={14} />
          新建会话
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="flex h-7 items-center gap-1.5 rounded-lg bg-white/[0.04] px-2">
          <Search size={12} className="shrink-0 text-neutral-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索会话"
            className="w-full bg-transparent text-[12px] text-neutral-200 outline-none placeholder:text-neutral-600"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {filtered.length === 0 && (
          <p className="px-2 py-6 text-center text-[11.5px] text-neutral-600">没有匹配的会话</p>
        )}
        {filtered.map((s) => {
          const active = s.id === activeId;
          return (
            <div
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={`group mb-0.5 flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors ${
                active ? 'bg-white/[0.09]' : 'hover:bg-white/[0.05]'
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className={`truncate text-[12.5px] ${active ? 'text-neutral-100' : 'text-neutral-300'}`}>
                  {s.title}
                </p>
                <p className="mt-0.5 text-[10.5px] text-neutral-600">{relTime(s.updatedAt)}</p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin(s.id);
                }}
                title={s.pinned ? '取消置顶' : '置顶'}
                className="shrink-0 text-neutral-600 opacity-0 transition-opacity hover:text-neutral-300 group-hover:opacity-100"
              >
                {s.pinned ? <PinOff size={11} /> : <Pin size={11} />}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(s.id);
                }}
                title="删除"
                className="shrink-0 text-neutral-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
              >
                <Trash2 size={11} />
              </button>
            </div>
          );
        })}
      </div>

      {/* 状态区 */}
      <div className="border-t border-white/[0.07] px-3 py-2.5">
        <div className="flex items-center justify-between">
          <StatusDot kind={statusKind(state)} label={statusLabel(state)} />
          <span className="text-[10.5px] text-neutral-600">{stats.turns} 轮 · {stats.toolCalls} 工具</span>
        </div>
        {detail && <p className="mt-1 truncate text-[10.5px] text-neutral-600">{detail}</p>}
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            onClick={onOpenDoctor}
            className="flex h-7 flex-1 items-center justify-center gap-1 rounded-lg bg-white/[0.05] text-[11.5px] text-neutral-300 transition-colors hover:bg-white/[0.09]"
          >
            <Activity size={11} />
            自检
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex h-7 flex-1 items-center justify-center gap-1 rounded-lg bg-white/[0.05] text-[11.5px] text-neutral-300 transition-colors hover:bg-white/[0.09]"
          >
            设置
          </button>
        </div>
      </div>
    </aside>
  );
}
