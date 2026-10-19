import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChatMessage,
  SessionEvent,
  SessionState,
  SessionStats,
  Settings,
  ToolCall
} from '@shared/types';
import { api } from './api';

export interface SessionView {
  messages: ChatMessage[];
  state: SessionState;
  detail?: string;
  stats: SessionStats;
  settings: Settings | null;
  logs: { level: string; text: string; at: number }[];
  busy: boolean;
  send: (text: string, files: string[]) => Promise<void>;
  approve: (callId: string, verdict: 'allow_once' | 'always_allow' | 'deny') => Promise<void>;
  abort: () => Promise<void>;
  boot: () => Promise<void>;
  reconnect: () => Promise<void>;
  shutdown: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  clearMessages: () => void;
}

const EMPTY_STATS: SessionStats = {
  turns: 0,
  toolCalls: 0,
  state: 'idle',
  chromeConnected: false,
  loggedIn: false
};

export function useSession(): SessionView {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<SessionState>('idle');
  const [detail, setDetail] = useState<string | undefined>();
  const [stats, setStats] = useState<SessionStats>(EMPTY_STATS);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [logs, setLogs] = useState<{ level: string; text: string; at: number }[]>([]);
  const stateRef = useRef<SessionState>('idle');

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => undefined);
  }, []);

  useEffect(() => {
    const off = api.onEvent((event: SessionEvent) => {
      switch (event.type) {
        case 'state':
          setState(event.state);
          setDetail(event.detail);
          break;
        case 'user_msg':
          setMessages((prev) => [...prev, event.message]);
          break;
        case 'assistant_done':
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === event.message.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = event.message;
              return next;
            }
            return [...prev, event.message];
          });
          break;
        case 'tool_update':
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== event.messageId || !m.toolCall) return m;
              const patch = event.patch as Partial<ToolCall>;
              return { ...m, toolCall: { ...m.toolCall, ...patch } };
            })
          );
          break;
        case 'stats':
          setStats(event.stats);
          break;
        case 'error':
          setLogs((prev) => [...prev.slice(-40), { level: 'error', text: event.message, at: Date.now() }]);
          break;
        case 'log':
          setLogs((prev) => [...prev.slice(-40), { level: event.level, text: event.text, at: Date.now() }]);
          break;
        default:
          break;
      }
    });
    return off;
  }, []);

  const send = useCallback(async (text: string, files: string[]) => {
    await api.send(text, files);
  }, []);

  const approve = useCallback(
    async (callId: string, verdict: 'allow_once' | 'always_allow' | 'deny') => {
      await api.approve(callId, verdict);
    },
    []
  );

  const abort = useCallback(async () => {
    await api.abort();
  }, []);

  const boot = useCallback(async () => {
    await api.boot();
  }, []);

  const reconnect = useCallback(async () => {
    await api.reconnect();
  }, []);

  const shutdown = useCallback(async () => {
    await api.shutdown();
  }, []);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = await api.setSettings(patch);
    setSettings(next);
  }, []);

  const clearMessages = useCallback(() => setMessages([]), []);

  const busy = ['sending', 'awaiting', 'parsing', 'executing', 'feeding', 'booting'].includes(state);

  return {
    messages,
    state,
    detail,
    stats,
    settings,
    logs,
    busy,
    send,
    approve,
    abort,
    boot,
    reconnect,
    shutdown,
    updateSettings,
    clearMessages
  };
}
