// 渲染层纯函数工具：时间、字节、参数美化、截图路径提取

export function relTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' 分钟前';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + ' 小时前';
  if (diff < 7 * 86_400_000) return Math.floor(diff / 86_400_000) + ' 天前';
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

export function shortTitle(text: string, max = 26): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max) + '…' : one || '新会话';
}

/** 从工具输出里抠出截图文件路径（screenshot 工具会打印「截图已保存：<path>」） */
export function extractImagePath(output?: string): string | null {
  if (!output) return null;
  const m = output.match(/(\/[^\n]*?\.(?:jpg|jpeg|png|webp))/i);
  return m ? m[1] : null;
}

export function paramLines(params: Record<string, unknown>): { key: string; value: string }[] {
  return Object.entries(params).map(([key, value]) => {
    let text: string;
    if (value === null || value === undefined) text = '—';
    else if (typeof value === 'string') text = value;
    else if (Array.isArray(value)) text = value.join(', ') || '—';
    else text = JSON.stringify(value);
    return { key, value: text };
  });
}

export function statusLabel(state: string): string {
  switch (state) {
    case 'idle': return '未连接';
    case 'booting': return '启动中';
    case 'ready': return '就绪';
    case 'sending': return '发送中';
    case 'awaiting': return '等待回复';
    case 'parsing': return '解析中';
    case 'pending_approval': return '等待授权';
    case 'executing': return '执行工具';
    case 'feeding': return '回填结果';
    case 'aborting': return '中止中';
    case 'error': return '出错';
    default: return state;
  }
}

export function statusKind(state: string): 'ready' | 'running' | 'error' | 'clay' {
  if (state === 'error') return 'error';
  if (state === 'ready') return 'ready';
  if (state === 'idle') return 'clay';
  return 'running';
}
