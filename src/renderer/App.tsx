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
  const [pageVisible, setPageVisible] = useState(true);
  const bootedRef = useRef(false);
  /** 内嵌网页的落位容器：WebContentsView 会精确覆盖这个 div 的矩形 */
  const pageHostRef = useRef<HTMLDivElement | null>(null);

  const store = useSessions(session.messages, () => session.clearMessages());

  // 首启自动拉起内嵌页面（失败不弹错，状态条会显示原因）
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void session.boot().catch(() => undefined);
  }, [session]);

  // 把 pageHost 的实测矩形同步给主进程 —— WebContentsView 是原生层，
  // 只能靠显式 setBounds 摆放，不能用 CSS 定位。
  useEffect(() => {
    const el = pageHostRef.current;
    if (!el) return;
    let raf = 0;
    const sync = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      void api.setPageBounds({
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height)
      });
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(sync);
    };
    sync();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    window.addEventListener('resize', schedule);
    // 主进程在窗口 resize / 全屏切换时发这个事件，触发重新测量
    const offRelayout = api.onRelayout(schedule);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
      offRelayout();
    };
  }, []);

  // 页面显示/隐藏状态由主进程持真源
  useEffect(() => {
    void api.isPageVisible().then(setPageVisible).catch(() => undefined);
    const off = api.onPageVisibility((v) => setPageVisible(v));
    return off;
  }, []);

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
      // macOS 用 ⌘.，Windows 用 Ctrl+.
      if (e.key === '.' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void session.abort();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);

  const showToast = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast(''), 4200);
  }, []);

  const onSend = useCallback(
    (text: string, files: string[]) => {
      void session.send(text, files).catch((err: unknown) => {
        showToast(err instanceof Error ? err.message : String(err));
      });
    },
    [session, showToast]
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

  const onTogglePage = useCallback(() => {
    void api.togglePage().then((v) => {
      setPageVisible(v);
      showToast(v ? '已显示 DeepSeek 网页' : '网页已隐藏，智能体仍在后台运行');
    });
  }, [showToast]);

  const onExportSession = useCallback(() => {
    void api
      .exportSession()
      .then((r) => {
        if (!r.ok) return;
        showToast(`登录态已导出：${r.cookies} 条 cookie / ${r.storage} 项 localStorage`);
      })
      .catch((err: unknown) => showToast(err instanceof Error ? err.message : String(err)));
  }, [showToast]);

  // 菜单触发的导入/导出
  useEffect(() => {
    const offExport = api.onMenuExport(onExportSession);
    const offImport = api.onMenuImport(() => {
      void api
        .importSession()
        .then((r) => {
          if (!r.ok) return;
          showToast(`登录态已导入：${r.cookies} 条 cookie / ${r.storage} 项 localStorage`);
        })
        .catch((err: unknown) => showToast(err instanceof Error ? err.message : String(err)));
    });
    return () => {
      offExport();
      offImport();
    };
  }, [onExportSession, showToast]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface-1 text-neutral-200">
      <TitleBar
        state={session.state}
        detail={session.detail}
        pageVisible={pageVisible}
        onTogglePage={onTogglePage}
        onReconnect={() => void session.reconnect()}
        onOpenDoctor={() => setDoctorOpen(true)}
        onExportSession={onExportSession}
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

        {/* 左：对话与工具授权 */}
        <main className="flex min-w-0 flex-1 flex-col bg-surface-0">
          <MessageList messages={session.messages} onVerdict={onVerdict} onOpenImage={setLightbox} />
          <Composer busy={session.busy} onSend={onSend} onAbort={() => void session.abort()} />
        </main>

        {/*
          右：内嵌 DeepSeek 网页。
          WebContentsView 是原生视图，永远浮在 DOM 之上，因此这里只放一个
          空占位层 —— 它的矩形就是视图要覆盖的区域，由上面的 ResizeObserver 上报。
        */}
        {pageVisible ? (
          <section className="flex w-[38%] min-w-[360px] shrink-0 flex-col border-l border-white/[0.07] bg-surface-1">
            <div className="flex h-[34px] shrink-0 items-center justify-between px-3 text-[11px] text-neutral-500">
              <span>chat.deepseek.com</span>
              <button
                type="button"
                onClick={onTogglePage}
                className="rounded px-1.5 py-0.5 transition-colors hover:bg-white/[0.07] hover:text-neutral-300"
                title="隐藏网页（⌘⇧D）"
              >
                隐藏
              </button>
            </div>
            <div ref={pageHostRef} className="min-h-0 flex-1 bg-surface-0" />
          </section>
        ) : (
          <div ref={pageHostRef} className="hidden" aria-hidden />
        )}
      </div>

      {toast && (
        <div className="pointer-events-none fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-white/10 bg-black/70 px-3 py-2 text-[12px] text-neutral-200 backdrop-blur">
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
