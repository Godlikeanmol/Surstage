import React, { useState } from 'react';
import { ArrowRight, Headphones, LogIn, LogOut, Mic, Plus, Users } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.tsx';

interface LobbyViewProps {
  initialRoomCode: string;
  displayName: string;
  avatarColor: string;
  onChangeDisplayName: (name: string) => void;
  onChangeAvatarColor: (color: string) => void;
  onEnterRoom: (roomCode: string, roomName?: string, createIfMissing?: boolean) => void;
}

const AVATAR_SWATCHES = [
  '#FF5A36',
  '#E11D48',
  '#D97706',
  '#059669',
  '#2563EB',
  '#7C3AED',
];

export function LobbyView({
  initialRoomCode,
  displayName,
  avatarColor,
  onChangeDisplayName,
  onChangeAvatarColor,
  onEnterRoom,
}: LobbyViewProps) {
  const { user, signingIn, authError, signInWithGoogle, signOut } = useAuth();
  const [joinCode, setJoinCode] = useState(initialRoomCode);
  const [roomName, setRoomName] = useState('Friday Acoustic Jam');
  const [mode, setMode] = useState<'create' | 'join'>(initialRoomCode ? 'join' : 'create');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [missingRoomCode, setMissingRoomCode] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isPrivatePreview =
    typeof window !== 'undefined' && window.location.hostname.startsWith('ais-dev-');
  const sharedOrigin = isPrivatePreview
    ? window.location.origin.replace('://ais-dev-', '://ais-pre-')
    : null;

  const effectiveName = displayName.trim() || user?.displayName || '';

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveName) {
      setErrorMsg('Enter your singer name to open a room.');
      return;
    }
    setCreating(true);
    setErrorMsg(null);
    setMissingRoomCode(null);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: roomName.trim() || 'Acoustic Jam' }),
      });
      if (!res.ok) {
        throw new Error('Could not create room. Please try again.');
      }
      const data = (await res.json()) as { code: string; name: string };
      onChangeDisplayName(effectiveName);
      onEnterRoom(data.code, data.name, true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to create room');
    } finally {
      setCreating(false);
    }
  };

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = joinCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (clean.length !== 6) {
      setErrorMsg('Enter a 6-character room code.');
      return;
    }
    if (!effectiveName) {
      setErrorMsg('Enter your singer name before joining.');
      return;
    }
    setJoining(true);
    setErrorMsg(null);
    setMissingRoomCode(null);
    try {
      const checkRes = await fetch(`/api/rooms/${encodeURIComponent(clean)}`);
      if (checkRes.ok) {
        const check = (await checkRes.json()) as { exists: boolean; name?: string };
        if (!check.exists) {
          setMissingRoomCode(clean);
          setErrorMsg(
            `Room ${clean} is not active on this URL yet. Make sure both devices use the same Shared App URL (not ais-dev preview), or start it here.`
          );
          return;
        }
        onChangeDisplayName(effectiveName);
        onEnterRoom(clean, check.name, false);
        return;
      }
    } catch {
      // Fall through to room check on RoomView
    } finally {
      setJoining(false);
    }
    onChangeDisplayName(effectiveName);
    onEnterRoom(clean, undefined, false);
  };

  return (
    <div className="min-h-dvh bg-[#0B0D12] text-[#F4F5F8] flex flex-col">
      {/* Clean 3-zone top bar */}
      <header className="border-b border-white/10 px-4 sm:px-8 h-14 flex items-center justify-between gap-4 max-w-6xl w-full mx-auto">
        <span className="font-display text-xl font-bold tracking-tight whitespace-nowrap shrink-0">
          SurStage
        </span>
        <nav className="hidden md:flex items-center gap-6 text-sm text-slate-400">
          <a href="#stage-entry" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
            Rooms
          </a>
          <a href="#audio-design" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
            Audio Routing
          </a>
        </nav>
        <div className="shrink-0">
          {user ? (
            <button
              onClick={() => signOut()}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{user.displayName?.split(' ')[0] || 'Signed in'}</span>
            </button>
          ) : (
            <button
              onClick={() => signInWithGoogle(avatarColor)}
              disabled={signingIn}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-medium text-white flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>{signingIn ? 'Signing in...' : 'Google Sign-In'}</span>
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-6 sm:py-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Left: Editorial Stage Backdrop */}
        <section className="lg:col-span-7 flex flex-col justify-between rounded-3xl overflow-hidden bg-[#141720] border border-white/10">
          <div className="relative h-56 sm:h-72 lg:h-80 w-full overflow-hidden bg-[#141720]">
            <img
              src="/src/assets/images/studio_stage_banner_1794935271657.jpg"
              alt="Intimate acoustic karaoke lounge microphone and mixer"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#141720] via-[#141720]/45 to-transparent" />
            <div className="absolute bottom-4 left-5 right-5">
              <p className="text-xs text-amber-300/90 font-medium mb-1">
                Synced YouTube Karaoke · Live Mic Stage · Up to 20 Friends
              </p>
              <h1 className="font-display text-2xl sm:text-4xl font-bold tracking-tight text-white [text-wrap:balance]">
                Sing live together without echo or track lag
              </h1>
            </div>
          </div>

          <div id="audio-design" className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-white/5">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Mic className="w-4 h-4 text-[#FF5A36] shrink-0" />
                <span>Singer-Only Mic</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                48kHz mono capture without speech ducking. Only active singers transmit vocals.
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Headphones className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Local Karaoke Track</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Everyone plays YouTube locally with separate sliders for music and live voice.
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Users className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Beat Synced</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Listeners offset by round-trip voice latency so live vocals hit right on the beat.
              </p>
            </div>
          </div>
        </section>

        {/* Right: Create or Join Room Form */}
        <section
          id="stage-entry"
          className="lg:col-span-5 bg-[#141720] border border-white/10 rounded-3xl p-5 sm:p-7 flex flex-col justify-between space-y-6"
        >
          <div className="space-y-5">
            {isPrivatePreview && sharedOrigin && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-200 space-y-1.5">
                <p className="font-semibold text-amber-300">Single-Device Preview (ais-dev)</p>
                <p className="text-amber-100/90 leading-relaxed">
                  Other devices cannot join rooms created on this private preview URL. Publish via{' '}
                  <strong>Share</strong> and open the Shared App URL on all devices to jam together.
                </p>
                <a
                  href={sharedOrigin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-amber-300 underline underline-offset-2"
                >
                  Open Shared App URL ↗
                </a>
              </div>
            )}

            <div className="grid grid-cols-2 gap-1 p-1 bg-[#0B0D12] rounded-xl border border-white/10">
              <button
                type="button"
                onClick={() => {
                  setMode('create');
                  setErrorMsg(null);
                  setMissingRoomCode(null);
                }}
                className={`min-h-[44px] rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
                  mode === 'create'
                    ? 'bg-[#FF5A36] text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Create Room
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('join');
                  setErrorMsg(null);
                  setMissingRoomCode(null);
                }}
                className={`min-h-[44px] rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
                  mode === 'join'
                    ? 'bg-[#FF5A36] text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Join by Code
              </button>
            </div>

            {initialRoomCode && mode === 'join' && (
              <div className="p-3 rounded-xl bg-[#FF5A36]/10 border border-[#FF5A36]/30 text-xs text-slate-200">
                Invited to room <strong className="font-mono-tabular text-white">{initialRoomCode}</strong> — enter your name below to join.
              </div>
            )}

            <div className="space-y-3">
              <label className="block">
                <span className="block text-xs font-medium text-slate-300 mb-1.5">
                  Your Stage Name <span className="text-[#FF5A36]">*</span>
                </span>
                <input
                  type="text"
                  required
                  autoFocus={Boolean(initialRoomCode && !displayName.trim())}
                  maxLength={36}
                  value={displayName}
                  onChange={(e) => {
                    onChangeDisplayName(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder={user?.displayName || 'Enter your name (required)'}
                  className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#0B0D12] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#FF5A36]"
                />
              </label>

              <div>
                <span className="block text-xs font-medium text-slate-300 mb-2">
                  Avatar Color
                </span>
                <div className="flex items-center gap-2.5">
                  {AVATAR_SWATCHES.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      onClick={() => onChangeAvatarColor(swatch)}
                      className={`w-9 h-9 rounded-full transition-transform ${
                        avatarColor === swatch ? 'ring-2 ring-white ring-offset-2 ring-offset-[#141720] scale-105' : 'opacity-75 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: swatch }}
                      aria-label={`Select color ${swatch}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            {mode === 'create' ? (
              <form onSubmit={handleCreateRoom} className="space-y-4">
                <label className="block">
                  <span className="block text-xs font-medium text-slate-300 mb-1.5">
                    Room Name
                  </span>
                  <input
                    type="text"
                    maxLength={60}
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    placeholder="Friday Acoustic Jam"
                    className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#0B0D12] border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#FF5A36]"
                  />
                </label>
                <button
                  type="submit"
                  disabled={creating}
                  className="w-full min-h-[48px] px-5 rounded-xl bg-[#FF5A36] hover:bg-[#ff6d4d] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                >
                  <Plus className="w-4 h-4" />
                  <span>{creating ? 'Opening Stage...' : 'Open Karaoke Room'}</span>
                </button>
              </form>
            ) : (
              <form onSubmit={handleJoinRoom} className="space-y-4">
                <label className="block">
                  <span className="block text-xs font-medium text-slate-300 mb-1.5">
                    6-Character Room Code
                  </span>
                  <input
                    type="text"
                    maxLength={6}
                    value={joinCode}
                    onChange={(e) =>
                      setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                    }
                    placeholder="K7M9P2"
                    className="w-full min-h-[48px] px-4 rounded-xl bg-[#0B0D12] border border-white/10 font-mono-tabular text-lg tracking-[0.25em] uppercase text-white placeholder:text-slate-600 focus:outline-none focus:border-[#FF5A36]"
                  />
                </label>
                <button
                  type="submit"
                  disabled={joining}
                  className="w-full min-h-[48px] px-5 rounded-xl bg-[#FF5A36] hover:bg-[#ff6d4d] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                >
                  <span>{joining ? 'Checking Room...' : 'Join Room'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            )}

            {(errorMsg || authError) && (
              <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3.5 py-2.5 space-y-2">
                <p>{errorMsg || authError}</p>
                {missingRoomCode && (
                  <button
                    type="button"
                    onClick={() => {
                      onChangeDisplayName(effectiveName);
                      onEnterRoom(missingRoomCode, `Jam Room ${missingRoomCode}`, true);
                    }}
                    className="w-full min-h-[40px] px-3 rounded-lg bg-white/10 hover:bg-white/15 text-white font-semibold text-xs transition-colors"
                  >
                    Start Room {missingRoomCode} Here
                  </button>
                )}
              </div>
            )}
          </div>

          <p className="text-xs text-slate-400 leading-relaxed pt-3 border-t border-white/5">
            Wear earphones before taking the mic so your karaoke music never loops into the room.
          </p>
        </section>
      </main>
    </div>
  );
}
