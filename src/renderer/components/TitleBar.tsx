import React, { useEffect, useState } from 'react';
import { RotateCw, Activity, Monitor, MonitorOff, KeyRound } from 'lucide-react';
import type { SessionState } from '@shared/types';
import { statusKind, statusLabel, hotkeyTogglePage } from '../lib/format';
import { StatusDot } from '@cds/StatusIndicators';

interface TitleBarProps {
  state: SessionState;
  detail?: string;
  pageVisible: boolean;
  onTogglePage: () => void;
  onReconnect: () => void;
  onOpenDoctor: () => void;
  onExportSession: () => void;
}

/**
 * 顶栏：自绘 45px 拖拽带 + 74px 红绿灯避让（逆缩放补偿）。
 * 不复用 vendored ClaudeDesktopHeader 的原因：它的避让宽度读 window.electronAPI 的
 * 全屏/缩放事件，逻辑正确但内部结构固定，无法承载本应用的运行控制按钮组；
 * 这里保留同样的几何规格（74px / Math.min(zoom,1) 逆补偿）自行实现。
 */
export function TitleBar({
  state,
  detail,
  pageVisible,
  onTogglePage,
  onReconnect,
  onOpenDoctor,
  onExportSession
}: TitleBarProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    void api.getFullscreen?.().then((v) => setFullscreen(!!v));
    void api.getZoomFactor?.().then((v) => setZoom(v || 1));
    const offFs = api.onFullscreenChanged?.((v) => setFullscreen(!!v));
    const offZoom = api.onZoomFactorChanged?.((v) => setZoom(v || 1));
    return () => {
      offFs?.();
      offZoom?.();
    };
  }, []);

  const isMac = navigator.userAgent.includes('Mac');
  // macOS：左侧 74px 红绿灯避让；
  // Windows：右上角是系统窗口按钮（titleBarOverlay），右侧留出约 140px，否则按钮会被盖住。
  const needsSpacer = isMac && !fullscreen;
  const spacer = needsSpacer ? Math.round(74 / Math.min(zoom, 1)) : 0;
  const rightInset = isMac ? 0 : 140;

  return (
    <>
      <div
        aria-hidden
        className="fixed inset-x-0 top-0 z-40 h-[45px]"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
      <header
        className="relative z-30 flex h-[45px] w-full shrink-0 items-center gap-2 border-b border-white/[0.07] bg-surface-1 px-4"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div style={{ width: spacer }} className="shrink-0" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-[13px] font-medium text-neutral-100">EAgent</span>
          <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-neutral-400">内嵌版</span>
          <span className="mx-1 h-3 w-px bg-white/10" />
          <StatusDot kind={statusKind(state)} label={statusLabel(state)} />
          {detail && <span className="truncate text-[11px] text-neutral-500">{detail}</span>}
        </div>

        <div
          className="draggable-none flex shrink-0 items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag', marginRight: rightInset } as React.CSSProperties}
        >
          <button
            type="button"
            onClick={onTogglePage}
            title={`${pageVisible ? '隐藏' : '显示'} DeepSeek 网页（${hotkeyTogglePage}）`}
            className={`flex h-7 items-center gap-1 rounded-lg px-2.5 text-[11.5px] transition-colors ${
              pageVisible
                ? 'bg-clay/20 text-clay'
                : 'bg-white/[0.07] text-neutral-200 hover:bg-white/[0.12]'
            }`}
          >
            {pageVisible ? <Monitor size={11} /> : <MonitorOff size={11} />}
            {pageVisible ? '隐藏网页' : '显示网页'}
          </button>
          <button
            type="button"
            onClick={onReconnect}
            title="重新加载内嵌页面"
            className="flex size-7 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/[0.07] hover:text-neutral-200"
          >
            <RotateCw size={12} />
          </button>
          <button
            type="button"
            onClick={onExportSession}
            title="导出登录态（迁移到另一台机器）"
            className="flex size-7 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/[0.07] hover:text-neutral-200"
          >
            <KeyRound size={12} />
          </button>
          <button
            type="button"
            onClick={onOpenDoctor}
            title="环境自检"
            className="flex size-7 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/[0.07] hover:text-neutral-200"
          >
            <Activity size={12} />
          </button>
        </div>
      </header>
    </>
  );
}
