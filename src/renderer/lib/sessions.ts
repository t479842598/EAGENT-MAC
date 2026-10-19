// 本地会话归档：侧栏列表 + localStorage 持久化。
// 说明：DeepSeek 网页侧只有一个真实对话，这里的「会话」是本地视图档案；
// 切换会话时会让引擎在下一次发送时重新注入系统提示词。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '@shared/types';
import { shortTitle } from './format';

export interface StoredSession {
  id: string;
  title: string;
  updatedAt: number;
  pinned: boolean;
  messages: ChatMessage[];
}

const KEY = 'eagent.sessions.v1';

function loadStore(): StoredSession[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((s) => s && typeof s.id === 'string').map((s) => ({
      id: s.id,
      title: s.title || '新会话',
      updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : Date.now(),
      pinned: !!s.pinned,
      messages: Array.isArray(s.messages) ? s.messages : []
    }));
  } catch {
    return [];
  }
}

function persist(list: StoredSession[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 60)));
  } catch {
    /* 配额满时静默丢弃，不阻塞对话 */
  }
}

function newId(): string {
  return 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

export interface SessionStore {
  sessions: StoredSession[];
  activeId: string;
  activeMessages: ChatMessage[];
  select: (id: string) => void;
  create: () => void;
  remove: (id: string) => void;
  rename: (id: string, title: string) => void;
  togglePin: (id: string) => void;
}

export function useSessions(liveMessages: ChatMessage[], onSwitch?: () => void): SessionStore {
  const [sessions, setSessions] = useState<StoredSession[]>(() => {
    const list = loadStore();
    if (list.length) return list;
    return [{ id: newId(), title: '新会话', updatedAt: Date.now(), pinned: false, messages: [] }];
  });
  const [activeId, setActiveId] = useState<string>(() => {
    const list = loadStore();
    return list.length ? list[0].id : '';
  });
  const lastSignature = useRef<string>('');

  // 首个会话补齐 id（首次启动时 sessions 与 activeId 分别初始化，可能对不上）
  useEffect(() => {
    if (!activeId && sessions.length) setActiveId(sessions[0].id);
  }, [activeId, sessions]);

  // 把引擎产出的实时消息同步进当前会话档案
  useEffect(() => {
    if (!activeId) return;
    const last = liveMessages[liveMessages.length - 1];
    const signature = activeId + '|' + liveMessages.length + '|' + (last ? last.id + ':' + (last.toolCall ? last.toolCall.status : '') : '');
    if (signature === lastSignature.current) return;
    lastSignature.current = signature;
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === activeId);
      if (idx < 0) return prev;
      const target = prev[idx];
      const firstUser = liveMessages.find((m) => m.role === 'user');
      const next = [...prev];
      next[idx] = {
        ...target,
        title: firstUser ? shortTitle(firstUser.text) : target.title,
        updatedAt: Date.now(),
        messages: liveMessages
      };
      persist(next);
      return next;
    });
  }, [liveMessages, activeId]);

  const select = useCallback((id: string) => {
    setActiveId(id);
    lastSignature.current = '';
    onSwitch?.();
  }, [onSwitch]);

  const create = useCallback(() => {
    const fresh: StoredSession = { id: newId(), title: '新会话', updatedAt: Date.now(), pinned: false, messages: [] };
    setSessions((prev) => {
      const next = [fresh, ...prev];
      persist(next);
      return next;
    });
    setActiveId(fresh.id);
    lastSignature.current = '';
    onSwitch?.();
  }, [onSwitch]);

  const remove = useCallback((id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      persist(next);
      return next.length ? next : [{ id: newId(), title: '新会话', updatedAt: Date.now(), pinned: false, messages: [] }];
    });
  }, []);

  const rename = useCallback((id: string, title: string) => {
    setSessions((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, title } : s));
      persist(next);
      return next;
    });
  }, []);

  const togglePin = useCallback((id: string) => {
    setSessions((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, pinned: !s.pinned } : s));
      persist(next);
      return next;
    });
  }, []);

  const ordered = useMemo(() => {
    return [...sessions].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
  }, [sessions]);

  const activeMessages = useMemo(() => {
    const found = sessions.find((s) => s.id === activeId);
    return found ? found.messages : [];
  }, [sessions, activeId]);

  return { sessions: ordered, activeId, activeMessages, select, create, remove, rename, togglePin };
}
