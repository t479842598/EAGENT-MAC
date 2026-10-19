import React, { useEffect, useState } from 'react';
import { MediaLightboxViewer, type MediaItem } from '@cds/MediaLightboxViewer';
import { api } from '../lib/api';

interface LightboxProps {
  path: string | null;
  onClose: () => void;
}

/** 截图灯箱：本地文件经 IPC 转 data URL 后才能进 <img>（渲染进程读不到文件系统） */
export function Lightbox({ path, onClose }: LightboxProps) {
  const [item, setItem] = useState<MediaItem | null>(null);

  useEffect(() => {
    let alive = true;
    if (!path) {
      setItem(null);
      return;
    }
    void api.readImage(path).then((url) => {
      if (!alive || !url) return;
      setItem({ id: path, url, alt: path.split('/').pop() || '截图' });
    });
    return () => {
      alive = false;
    };
  }, [path]);

  if (!path || !item) return null;

  return (
    <MediaLightboxViewer
      items={[item]}
      isOpen
      onClose={onClose}
      backdrop="blur"
      renderHeader={() => (
        <span className="font-mono text-[11px] text-neutral-400">{path}</span>
      )}
    />
  );
}
