import React, { useEffect, useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
import { ChatMessage, CheerEmoji } from '../shared/types.ts';
import { Avatar } from './Avatar.tsx';

interface ChatBottomSheetProps {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  onSendCheer: (emoji: CheerEmoji) => void;
  desktopEmbedded?: boolean;
}

const QUICK_CHEERS: CheerEmoji[] = ['👏', '🔥', '❤️', '🎤'];

export function ChatBottomSheet({
  open,
  onClose,
  messages,
  onSendMessage,
  onSendCheer,
  desktopEmbedded = false,
}: ChatBottomSheetProps) {
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open || desktopEmbedded) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, open, desktopEmbedded]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setDraft('');
  };

  const innerContent = (
    <div className="flex flex-col h-full bg-[#141720]">
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2 shrink-0">
        <div>
          <h3 className="font-display text-sm font-semibold text-white">Room Chat</h3>
          <p className="text-[11px] text-slate-400">Live reactions stay below the lyrics</p>
        </div>
        <div className="flex items-center gap-1">
          {QUICK_CHEERS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onSendCheer(emoji)}
              className="min-w-[40px] min-h-[40px] rounded-xl bg-white/5 hover:bg-white/10 text-base flex items-center justify-center active:scale-95 transition-transform"
              aria-label={`Send cheer ${emoji}`}
            >
              {emoji}
            </button>
          ))}
          {!desktopEmbedded && (
            <button
              type="button"
              onClick={onClose}
              className="min-w-[40px] min-h-[40px] rounded-xl text-slate-400 hover:text-white flex items-center justify-center ml-1"
              aria-label="Close chat"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500 py-8">
            Say hello or send a cheer while someone sings.
          </div>
        ) : (
          messages.map((msg) =>
            msg.type === 'system' ? (
              <div key={msg.id} className="text-[11px] text-slate-400 py-0.5">
                {msg.text}
              </div>
            ) : (
              <div key={msg.id} className="flex items-start gap-2.5">
                <Avatar name={msg.senderName} color={msg.senderColor} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold text-slate-200 truncate">
                      {msg.senderName}
                    </span>
                    <span className="text-[10px] font-mono-tabular text-slate-500">
                      {new Date(msg.timestampMs).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="text-sm text-slate-100 break-words leading-snug mt-0.5">
                    {msg.text}
                  </p>
                </div>
              </div>
            )
          )
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={submit}
        className="p-3 border-t border-white/10 flex items-center gap-2 shrink-0 bg-[#10131B]"
      >
        <input
          type="text"
          maxLength={400}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the room..."
          className="flex-1 min-h-[44px] px-3.5 rounded-xl bg-[#0B0D12] border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#FF5A36]"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="min-w-[44px] min-h-[44px] px-3.5 rounded-xl bg-[#FF5A36] hover:bg-[#ff6d4d] disabled:opacity-40 text-white flex items-center justify-center transition-colors"
          aria-label="Send message"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );

  if (desktopEmbedded) {
    return (
      <div className="h-full rounded-2xl border border-white/10 overflow-hidden">
        {innerContent}
      </div>
    );
  }

  if (!open) return null;

  // Slides up over the lower workspace strictly below the YouTube player so lyrics remain visible
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden flex flex-col justify-end pointer-events-none">
      <div
        className="pointer-events-auto w-full h-[52dvh] max-h-[calc(100dvh-295px)] min-h-[240px] rounded-t-3xl border-t border-white/15 bg-[#141720] shadow-2xl overflow-hidden flex flex-col"
        role="dialog"
        aria-label="Room chat"
      >
        <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mt-2.5 mb-1 shrink-0" />
        <div className="flex-1 min-h-0">{innerContent}</div>
      </div>
    </div>
  );
}
