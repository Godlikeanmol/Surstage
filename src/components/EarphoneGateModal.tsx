import React, { useState } from 'react';
import { Headphones, Mic, X } from 'lucide-react';

interface EarphoneGateModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function EarphoneGateModal({ open, onConfirm, onCancel }: EarphoneGateModalProps) {
  const [checked, setChecked] = useState(false);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="earphone-gate-title"
    >
      <div className="w-full max-w-md bg-[#141720] border border-white/15 rounded-3xl p-5 sm:p-6 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-500/15 text-amber-400 flex items-center justify-center shrink-0">
              <Headphones className="w-5 h-5" />
            </div>
            <div>
              <h2 id="earphone-gate-title" className="font-display text-lg font-bold text-white">
                Earphones Required on Stage
              </h2>
              <p className="text-xs text-slate-400">Prevents music echo for everyone else</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/5"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-slate-300 leading-relaxed">
          Your karaoke track plays locally while your voice streams without browser echo cancellation for clean singing quality. Playing music through phone speakers will echo back to the entire room.
        </p>

        <label className="flex items-start gap-3 p-3.5 rounded-2xl bg-[#0B0D12] border border-white/10 cursor-pointer min-h-[48px]">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 w-5 h-5 rounded accent-[#FF5A36] shrink-0"
          />
          <span className="text-sm font-medium text-white">
            I&apos;m wearing earphones or headphones right now
          </span>
        </label>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 min-h-[46px] rounded-xl bg-white/5 hover:bg-white/10 text-sm font-medium text-slate-200 transition-colors"
          >
            Stay Listening
          </button>
          <button
            type="button"
            disabled={!checked}
            onClick={() => {
              setChecked(false);
              onConfirm();
            }}
            className="flex-1 min-h-[46px] rounded-xl bg-[#FF5A36] hover:bg-[#ff6d4d] disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-white flex items-center justify-center gap-2 transition-colors"
          >
            <Mic className="w-4 h-4" />
            <span>Take the Mic</span>
          </button>
        </div>
      </div>
    </div>
  );
}
