import React, { useEffect, useState } from 'react';
import { Play, RotateCw, Power, Activity } from 'lucide-react';
import type { SessionState } from '@shared/types';
import { statusKind, statusLabel } from '../lib/format';
import { StatusDot } from '@cds/StatusIndicators';

interface TitleBarProps {
  state: SessionState;
  detail?: string;
  onBoot: () => void;
  onReconnect: () => void;
  onShutdown: () => void;
  onOpenDoctor: () => void;
}

/**
 * 顶栏：自绘 45px 拖拽带 + 74px 红绿灯避让（逆缩放补偿）。
 * 不复用 vendored ClaudeDesktopHeader 的原因：它的避让宽度读 window.electronAPI 的
 * 全屏/缩放事件，逻辑正确但内部结构固定，无法承载本应用的运行控制按钮组；
 * 这里保留同样的几何规格（74px / Math.min(zoom,1) 逆补偿）自行实现。
 */
export function TitleBar({ state, detail, onBoot, onReconnect, onShutdown, onOpenDoctor }: TitleBarProps) {
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

  const needsSpacer = navigator.userAgent.includes('Mac') && !fullscreen;
  const spacer = needsSpacer ? Math.round(74 / Math.min(zoom, 1)) : 0;

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
          <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-neutral-400">macOS</span>
          <span className="mx-1 h-3 w-px bg-white/10" />
          <StatusDot kind={statusKind(state)} label={statusLabel(state)} />
          {detail && <span className="truncate text-[11px] text-neutral-500">{detail}</span>}
        </div>

        <div
          className="draggable-none flex shrink-0 items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            type="button"
            onClick={onBoot}
            title="启动浏览器并连接"
            className="flex h-7 items-center gap-1 rounded-lg bg-white/[0.07] px-2.5 text-[11.5px] text-neutral-200 transition-colors hover:bg-white/[0.12]"
          >
            <Play size={11} />
            启动浏览器
          </button>
          <button
            type="button"
            onClick={onReconnect}
            title="重新连接页面"
            className="flex size-7 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/[0.07] hover:text-neutral-200"
          >
            <RotateCw size={12} />
          </button>
          <button
            type="button"
            onClick={onOpenDoctor}
            title="环境自检"
            className="flex size-7 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/[0.07] hover:text-neutral-200"
          >
            <Activity size={12} />
          </button>
          <button
            type="button"
            onClick={onShutdown}
            title="关闭浏览器"
            className="flex size-7 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-white/[0.07] hover:text-red-400"
          >
            <Power size={12} />
          </button>
        </div>
      </header>
    </>
  );
}
