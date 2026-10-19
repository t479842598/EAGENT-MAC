import React, { useCallback, useState } from 'react';
import { Check, X, RefreshCw, ExternalLink, Loader2, Terminal } from 'lucide-react';
import type { DoctorReport } from '@shared/types';
import { api } from '../lib/api';

interface DoctorSheetProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 自检面板：七项（Chrome / 调试端口 / 选择器 / 登录 / macinput / 辅助功能 / 屏幕录制 / 工作目录）。
 * 每项失败都给一键修复入口（打开系统设置或启动浏览器）。
 */
export function DoctorSheet({ open, onClose }: DoctorSheetProps) {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState('');

  const run = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await api.runDoctor());
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (open && !report) void run();
  }, [open, report, run]);

  if (!open) return null;

  const results = report?.results ?? [];
  const passed = results.filter((r) => r.ok).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-[560px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-surface-2 shadow-popover"
      >
        <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
          <div>
            <h3 className="text-[14px] font-medium text-neutral-100">环境自检</h3>
            <p className="mt-0.5 text-[11px] text-neutral-500">
              {loading ? '检查中…' : results.length ? `${passed} / ${results.length} 项通过` : '尚未检查'}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void run()}
              className="flex h-7 items-center gap-1 rounded-lg bg-white/[0.07] px-2.5 text-[11.5px] text-neutral-200 transition-colors hover:bg-white/[0.12]"
            >
              {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              重新检查
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex size-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/[0.07] hover:text-neutral-200"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {results.map((r) => (
            <div key={r.id} className="flex gap-2.5 border-b border-white/[0.05] py-2.5 last:border-0">
              <span
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${
                  r.ok ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                }`}
              >
                {r.ok ? <Check size={10} strokeWidth={3} /> : <X size={10} strokeWidth={3} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] text-neutral-200">{r.label}</p>
                <p className="mt-0.5 whitespace-pre-wrap break-all text-[11px] leading-relaxed text-neutral-500">
                  {r.detail}
                </p>
                {!r.ok && r.fix && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {r.fix.url && (
                      <button
                        type="button"
                        onClick={() => void api.openExternal(r.fix!.url!)}
                        className="flex h-6 items-center gap-1 rounded-md bg-clay/15 px-2 text-[11px] text-clay transition-colors hover:bg-clay/25"
                      >
                        <ExternalLink size={10} />
                        {r.fix.label}
                      </button>
                    )}
                    {r.fix.command && (
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(r.fix!.command!);
                          setCopied(r.id);
                          setTimeout(() => setCopied(''), 1800);
                        }}
                        className="flex h-6 items-center gap-1 rounded-md bg-white/[0.07] px-2 text-[11px] text-neutral-300 transition-colors hover:bg-white/[0.12]"
                      >
                        <Terminal size={10} />
                        {copied === r.id ? '已复制' : '复制命令'}
                      </button>
                    )}
                    {!r.fix.url && !r.fix.command && (
                      <span className="flex h-6 items-center rounded-md bg-white/[0.05] px-2 text-[11px] text-neutral-400">
                        {r.fix.label}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {!results.length && !loading && (
            <p className="py-8 text-center text-[12px] text-neutral-500">点击「重新检查」开始诊断</p>
          )}
        </div>

        {report?.macinput && (
          <div className="border-t border-white/[0.07] px-4 py-2">
            <pre className="max-h-24 overflow-auto font-mono text-[10px] leading-relaxed text-neutral-600">
              {JSON.stringify(report.macinput, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
