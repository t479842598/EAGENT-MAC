import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from './lib/useSession';
import { useSessions } from './lib/sessions';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { MessageList } from './components/MessageList';
import { Composer } from './components/Composer';
import { DoctorSheet } from './components/DoctorSheet';
import { SettingsSheet } from './components/SettingsSheet';
import { Lightbox } from './components/Lightbox';
import { api } from './lib/api';

export default function App() {
  const session = useSession();
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const bootedRef = useRef(false);

  const store = useSessions(session.messages, () => session.clearMessages());

  // 首启自动拉起浏览器（失败不弹错，状态条会显示原因）
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void session.boot().catch(() => undefined);
  }, [session]);

  // 引擎错误 → 顶部轻提示
  useEffect(() => {
    const last = session.logs[session.logs.length - 1];
    if (!last || last.level !== 'error') return;
    setToast(last.text);
    const timer = setTimeout(() => setToast(''), 4200);
    return () => clearTimeout(timer);
  }, [session.logs]);

  // ⌘. 由主进程 globalShortcut 处理；这里兜住焦点在渲染层时的同一组合
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '.' && e.metaKey) {
        e.preventDefault();
        void session.abort();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);

  const onSend = useCallback(
    (text: string, files: string[]) => {
      void session.send(text, files).catch((err: unknown) => {
        setToast(err instanceof Error ? err.message : String(err));
        setTimeout(() => setToast(''), 4200);
      });
    },
    [session]
  );

  const onVerdict = useCallback(
    (callId: string, verdict: 'allow_once' | 'always_allow' | 'deny') => {
      void session.approve(callId, verdict);
    },
    [session]
  );

  const onSaveSettings = useCallback(
    (patch: Parameters<typeof session.updateSettings>[0]) => {
      void session.updateSettings(patch);
    },
    [session]
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface-1 text-neutral-200">
      <TitleBar
        state={session.state}
        detail={session.detail}
        onBoot={() => void session.boot()}
        onReconnect={() => void session.reconnect()}
        onShutdown={() => void session.shutdown()}
        onOpenDoctor={() => setDoctorOpen(true)}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          sessions={store.sessions}
          activeId={store.activeId}
          state={session.state}
          detail={session.detail}
          stats={session.stats}
          onSelect={store.select}
          onCreate={store.create}
          onRemove={store.remove}
          onTogglePin={store.togglePin}
          onOpenDoctor={() => setDoctorOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <main className="flex min-w-0 flex-1 flex-col bg-surface-0">
          <MessageList messages={session.messages} onVerdict={onVerdict} onOpenImage={setLightbox} />
          <Composer
            busy={session.busy}
            onSend={onSend}
            onAbort={() => void session.abort()}
          />
        </main>
      </div>

      {toast && (
        <div className="pointer-events-none fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-red-500/30 bg-red-500/15 px-3 py-2 text-[12px] text-red-200 backdrop-blur">
          {toast}
        </div>
      )}

      <DoctorSheet open={doctorOpen} onClose={() => setDoctorOpen(false)} />
      <SettingsSheet
        open={settingsOpen}
        settings={session.settings}
        onClose={() => setSettingsOpen(false)}
        onSave={onSaveSettings}
      />
      <Lightbox path={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}
