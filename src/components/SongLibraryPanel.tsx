import React, { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Dice5,
  Link2,
  ListMusic,
  Play,
  Plus,
  Radio,
  Search,
  SkipForward,
  Trash2,
} from 'lucide-react';
import {
  QueueItem,
  SONG_CATEGORIES,
  SongCategory,
  SongItem,
} from '../shared/types.ts';
import { fuzzySearchSongs, SEED_SONGS } from '../shared/songSeed.ts';
import { fetchPublicSongsFromFirestore, saveSongToFirestore } from '../lib/firebase.ts';
import { useAuth } from '../hooks/useAuth.tsx';

interface KaraokeChannelInfo {
  id: string;
  name: string;
  category: SongCategory;
  language: string;
}

interface SongLibraryPanelProps {
  queue: QueueItem[];
  currentSong: SongItem | null;
  isPlaying: boolean;
  isAdmin: boolean;
  isController: boolean;
  participantId: string;
  onAddToQueue: (song: SongItem) => void;
  onPlayNow: (song: SongItem) => void;
  onRemoveQueueItem: (itemId: string) => void;
  onReorderQueue: (itemId: string, direction: 'up' | 'down') => void;
  onSkipCurrent: () => void;
}

function extractYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.replace('/', '').slice(0, 11);
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    const v = url.searchParams.get('v');
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
    const parts = url.pathname.split('/');
    const embedIdx = parts.findIndex((p) => p === 'embed' || p === 'shorts' || p === 'live');
    if (embedIdx >= 0 && parts[embedIdx + 1]) {
      const id = parts[embedIdx + 1].slice(0, 11);
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function SongLibraryPanel({
  queue,
  currentSong,
  isPlaying,
  isAdmin,
  isController,
  participantId,
  onAddToQueue,
  onPlayNow,
  onRemoveQueueItem,
  onReorderQueue,
  onSkipCurrent,
}: SongLibraryPanelProps) {
  const { user } = useAuth();
  const [subTab, setSubTab] = useState<'library' | 'channels' | 'queue'>('library');
  const [queryText, setQueryText] = useState('');
  const [karaokeOnly, setKaraokeOnly] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<SongCategory | 'All'>('All');

  const [songs, setSongs] = useState<SongItem[]>(SEED_SONGS);
  const [ytResults, setYtResults] = useState<SongItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [ytLoading, setYtLoading] = useState(false);

  // Dedicated karaoke channels state
  const [channels, setChannels] = useState<KaraokeChannelInfo[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string>('all');
  const [channelQuery, setChannelQuery] = useState<string>('');
  const [channelSongs, setChannelSongs] = useState<SongItem[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);

  const [surprisePick, setSurprisePick] = useState<{
    song: SongItem;
    action: 'playing' | 'queued';
  } | null>(null);

  // Add custom YouTube link form
  const [showAddForm, setShowAddForm] = useState(false);
  const [ytInput, setYtInput] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [customArtist, setCustomArtist] = useState('');
  const [customCategory, setCustomCategory] = useState<SongCategory>('Bollywood');
  const [customLanguage, setCustomLanguage] = useState('Hindi');
  const [addingSong, setAddingSong] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Local + Firestore catalog search
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (queryText.trim()) params.set('q', queryText.trim());
        if (selectedCategory !== 'All') params.set('category', selectedCategory);
        const res = await fetch(`/api/songs?${params.toString()}`);
        let merged: SongItem[] = SEED_SONGS;
        if (res.ok) {
          const data = (await res.json()) as { songs: SongItem[] };
          merged = data.songs;
        } else {
          merged = fuzzySearchSongs(SEED_SONGS, queryText, selectedCategory);
        }

        if (user) {
          const fbSongs = await fetchPublicSongsFromFirestore().catch(() => []);
          if (fbSongs.length > 0) {
            const seen = new Set(merged.map((s) => s.videoId));
            const extra = fbSongs.filter((s) => !seen.has(s.videoId));
            if (extra.length > 0) {
              merged = fuzzySearchSongs([...extra, ...merged], queryText, selectedCategory);
            }
          }
        }

        if (active) setSongs(merged);
      } finally {
        if (active) setLoading(false);
      }
    }, 140);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [queryText, selectedCategory, user]);

  // Whole-YouTube live karaoke search (zero API quota)
  useEffect(() => {
    const q = queryText.trim();
    if (q.length < 2) {
      setYtResults([]);
      setYtLoading(false);
      return;
    }

    let active = true;
    setYtLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q,
          karaokeOnly: karaokeOnly ? 'true' : 'false',
        });
        const res = await fetch(`/api/songs/youtube-search?${params.toString()}`);
        if (!res.ok) {
          if (active) setYtResults([]);
          return;
        }
        const data = (await res.json()) as { songs: SongItem[] };
        if (active) setYtResults(data.songs || []);
      } catch {
        if (active) setYtResults([]);
      } finally {
        if (active) setYtLoading(false);
      }
    }, 380);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [queryText, karaokeOnly]);

  // Dedicated karaoke channels live feed (searchable)
  useEffect(() => {
    if (subTab !== 'channels') return;
    let active = true;
    setChannelsLoading(true);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ channelId: selectedChannelId });
      if (channelQuery.trim()) params.set('q', channelQuery.trim());
      fetch(`/api/songs/channels?${params.toString()}`)
        .then((res) => (res.ok ? res.json() : { channels: [], songs: [] }))
        .then((data: { channels?: KaraokeChannelInfo[]; songs?: SongItem[] }) => {
          if (!active) return;
          if (data.channels && data.channels.length > 0) {
            setChannels(data.channels);
          }
          setChannelSongs(data.songs || []);
        })
        .catch(() => {
          if (active) setChannelSongs([]);
        })
        .finally(() => {
          if (active) setChannelsLoading(false);
        });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [subTab, selectedChannelId, channelQuery]);

  const persistPickedSong = (song: SongItem) => {
    if (song.id.startsWith('yt_') || song.id.startsWith('ch_')) {
      fetch('/api/songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(song),
      }).catch(() => {});
      if (user) {
        saveSongToFirestore(song).catch(() => {});
      }
    }
  };

  const handleQueueSong = (song: SongItem) => {
    persistPickedSong(song);
    onAddToQueue(song);
  };

  const handlePlaySong = (song: SongItem) => {
    persistPickedSong(song);
    onPlayNow(song);
  };

  const applySurpriseSong = (picked: SongItem) => {
    if (isController && !isPlaying) {
      handlePlaySong(picked);
      setSurprisePick({ song: picked, action: 'playing' });
    } else {
      handleQueueSong(picked);
      setSurprisePick({ song: picked, action: 'queued' });
    }
  };

  const handleSurpriseMe = async () => {
    try {
      const params = new URLSearchParams();
      if (selectedCategory !== 'All') params.set('category', selectedCategory);
      if (currentSong?.videoId) params.set('exclude', currentSong.videoId);
      const res = await fetch(`/api/songs/surprise?${params.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as { song: SongItem };
        if (data.song) {
          applySurpriseSong(data.song);
          return;
        }
      }
    } catch {
      // fallback below
    }
    const categoryPool =
      selectedCategory === 'All'
        ? songs
        : songs.filter((s) => s.category === selectedCategory);
    const nonCurrentPool = currentSong
      ? categoryPool.filter((s) => s.videoId !== currentSong.videoId)
      : categoryPool;
    const list =
      nonCurrentPool.length > 0
        ? nonCurrentPool
        : categoryPool.length > 0
          ? categoryPool
          : SEED_SONGS;
    applySurpriseSong(list[Math.floor(Math.random() * list.length)]);
  };

  const handleLookupYouTube = async (val: string) => {
    setYtInput(val);
    setAddError(null);
    const vid = extractYouTubeVideoId(val);
    if (!vid) return;
    try {
      const res = await fetch(`/api/youtube-meta?videoId=${encodeURIComponent(vid)}`);
      if (res.ok) {
        const meta = (await res.json()) as { title: string; artist: string };
        if (!customTitle) setCustomTitle(meta.title);
        if (!customArtist) setCustomArtist(meta.artist);
      }
    } catch {
      // User can fill manually
    }
  };

  const handleAddCustomSong = async (e: React.FormEvent) => {
    e.preventDefault();
    const vid = extractYouTubeVideoId(ytInput);
    if (!vid) {
      setAddError('Paste a valid YouTube link or 11-character video ID.');
      return;
    }
    if (!customTitle.trim()) {
      setAddError('Enter a song title.');
      return;
    }

    setAddingSong(true);
    setAddError(null);
    try {
      const res = await fetch('/api/songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: vid,
          title: customTitle.trim(),
          artist: customArtist.trim() || 'YouTube Karaoke',
          language: customLanguage.trim() || 'Hindi',
          category: customCategory,
          durationSec: 240,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error || 'Could not add song');
      }
      const { song } = (await res.json()) as { song: SongItem };
      if (user) {
        await saveSongToFirestore(song).catch(() => {});
      }
      setSongs((prev) => [song, ...prev.filter((s) => s.videoId !== song.videoId)]);
      onAddToQueue(song);
      setYtInput('');
      setCustomTitle('');
      setCustomArtist('');
      setShowAddForm(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Unable to add song');
    } finally {
      setAddingSong(false);
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const localVideoIds = new Set(songs.map((s) => s.videoId));
  const dedupedYtResults = ytResults.filter((s) => !localVideoIds.has(s.videoId));

  const renderSongRow = (song: SongItem, subtitleExtra?: string) => {
    const isNowPlaying = currentSong?.videoId === song.videoId;
    return (
      <div
        key={`${song.id}_${song.videoId}`}
        className="px-3.5 py-3 flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white truncate">{song.title}</p>
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5 truncate">
            <span className="truncate">{song.artist}</span>
            <span aria-hidden="true">·</span>
            <span>{subtitleExtra || song.category}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">{formatDuration(song.durationSec)}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isController && !isNowPlaying && (
            <button
              type="button"
              onClick={() => handlePlaySong(song)}
              className="min-w-[40px] min-h-[40px] rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 flex items-center justify-center transition-colors"
              title="Play now"
              aria-label={`Play ${song.title} now`}
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => handleQueueSong(song)}
            className="min-h-[40px] px-3 rounded-xl bg-[#FF5A36]/15 hover:bg-[#FF5A36]/25 text-[#FF5A36] text-xs font-semibold flex items-center gap-1 transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Queue</span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Segmented switcher: Library vs Channels vs Queue */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="grid grid-cols-3 gap-1 p-1 bg-[#0B0D12] rounded-xl border border-white/10 flex-1 min-w-[220px]">
          <button
            type="button"
            onClick={() => setSubTab('library')}
            className={`min-h-[40px] px-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              subTab === 'library'
                ? 'bg-[#1F2433] text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Search &amp; Library
          </button>
          <button
            type="button"
            onClick={() => setSubTab('channels')}
            className={`min-h-[40px] px-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap flex items-center justify-center gap-1 ${
              subTab === 'channels'
                ? 'bg-[#1F2433] text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Channels</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('queue')}
            className={`min-h-[40px] px-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap flex items-center justify-center gap-1 ${
              subTab === 'queue'
                ? 'bg-[#1F2433] text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ListMusic className="w-3.5 h-3.5" />
            <span>Queue ({queue.length})</span>
          </button>
        </div>

        <button
          type="button"
          onClick={handleSurpriseMe}
          className="min-h-[42px] px-3.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
        >
          <Dice5 className="w-4 h-4" />
          <span>Surprise me</span>
        </button>
      </div>

      {surprisePick && (
        <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-amber-300">
              {surprisePick.action === 'playing' ? 'Loaded on Stage' : 'Added to Queue'}
            </p>
            <p className="text-xs font-semibold text-white truncate">
              {surprisePick.song.title} · {surprisePick.song.artist}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {surprisePick.action === 'queued' && isController && (
              <button
                type="button"
                onClick={() => {
                  handlePlaySong(surprisePick.song);
                  setSurprisePick({ song: surprisePick.song, action: 'playing' });
                }}
                className="min-h-[36px] px-3 rounded-lg bg-[#FF5A36] hover:bg-[#ff6d4d] text-white text-xs font-semibold whitespace-nowrap"
              >
                Play Now
              </button>
            )}
            {surprisePick.action === 'queued' && (
              <button
                type="button"
                onClick={() => setSubTab('queue')}
                className="min-h-[36px] px-3 rounded-lg bg-white/10 hover:bg-white/15 text-slate-200 text-xs font-medium whitespace-nowrap"
              >
                Queue
              </button>
            )}
            <button
              type="button"
              onClick={() => setSurprisePick(null)}
              className="min-h-[36px] px-2 rounded-lg text-xs text-slate-400 hover:text-white"
              aria-label="Dismiss surprise pick"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {subTab === 'library' && (
        <div className="space-y-3">
          {/* Unified search bar: curated library + live YouTube karaoke search */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                placeholder="Search any song on YouTube or library..."
                className="w-full min-h-[44px] pl-10 pr-3.5 rounded-xl bg-[#0B0D12] border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#FF5A36]"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setKaraokeOnly((v) => !v)}
                className={`min-h-[44px] px-3 rounded-xl text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 ${
                  karaokeOnly
                    ? 'bg-[#FF5A36]/15 border-[#FF5A36]/40 text-[#FF5A36]'
                    : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                }`}
                title="Automatically append karaoke to YouTube search"
              >
                {karaokeOnly ? 'Karaoke Only' : 'All Videos'}
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm((prev) => !prev)}
                className="min-h-[44px] px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-slate-200 flex items-center gap-1.5 whitespace-nowrap shrink-0"
                title="Paste YouTube URL"
              >
                <Link2 className="w-4 h-4" />
                <span className="hidden sm:inline">Paste URL</span>
              </button>
            </div>
          </div>

          {/* 7 Category filter tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
            {(['All', ...SONG_CATEGORIES] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`min-h-[38px] px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  selectedCategory === cat
                    ? 'bg-[#FF5A36] text-white'
                    : 'bg-[#0B0D12] text-slate-400 hover:text-white border border-white/10'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {showAddForm && (
            <form
              onSubmit={handleAddCustomSong}
              className="p-4 rounded-2xl bg-[#0B0D12] border border-white/10 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-white">Add Track via YouTube Link</h4>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
              </div>
              <input
                type="text"
                value={ytInput}
                onChange={(e) => handleLookupYouTube(e.target.value)}
                placeholder="Paste YouTube karaoke / instrumental URL or 11-char ID"
                className="w-full min-h-[42px] px-3 rounded-xl bg-[#141720] border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#FF5A36]"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="Song title"
                  className="min-h-[42px] px-3 rounded-xl bg-[#141720] border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#FF5A36]"
                />
                <input
                  type="text"
                  value={customArtist}
                  onChange={(e) => setCustomArtist(e.target.value)}
                  placeholder="Artist / Singer"
                  className="min-h-[42px] px-3 rounded-xl bg-[#141720] border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#FF5A36]"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <select
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value as SongCategory)}
                  className="min-h-[42px] px-3 rounded-xl bg-[#141720] border border-white/10 text-xs text-white focus:outline-none focus:border-[#FF5A36]"
                >
                  {SONG_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={customLanguage}
                  onChange={(e) => setCustomLanguage(e.target.value)}
                  placeholder="Language"
                  className="min-h-[42px] px-3 rounded-xl bg-[#141720] border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#FF5A36]"
                />
              </div>
              {addError && <p className="text-xs text-rose-400">{addError}</p>}
              <button
                type="submit"
                disabled={addingSong}
                className="w-full min-h-[42px] rounded-xl bg-[#FF5A36] hover:bg-[#ff6d4d] text-white text-xs font-semibold transition-colors"
              >
                {addingSong ? 'Saving...' : 'Save & Add to Queue'}
              </button>
            </form>
          )}

          {/* Live YouTube Karaoke Results when searching */}
          {queryText.trim().length >= 2 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-xs font-semibold text-slate-300">
                  YouTube Hindi {karaokeOnly ? 'Karaoke' : ''} Results
                </h3>
                {ytLoading && <span className="text-[11px] text-slate-400">Searching YouTube...</span>}
              </div>
              <div className="divide-y divide-white/5 border border-white/10 rounded-2xl bg-[#141720] overflow-hidden">
                {ytLoading && dedupedYtResults.length === 0 ? (
                  <div className="p-5 text-center text-xs text-slate-400">
                    Finding embeddable Hindi karaoke tracks on YouTube...
                  </div>
                ) : dedupedYtResults.length === 0 ? (
                  <div className="p-5 text-center text-xs text-slate-400">
                    No embeddable YouTube results found for &ldquo;{queryText.trim()}&rdquo;.
                  </div>
                ) : (
                  dedupedYtResults.map((song) => renderSongRow(song, 'YouTube'))
                )}
              </div>
            </div>
          )}

          {/* Curated + Hindi Karaoke Channels Matches */}
          <div className="space-y-1.5">
            {queryText.trim().length >= 2 && (
              <h3 className="text-xs font-semibold text-slate-400 px-1">
                Library &amp; Hindi Channels
              </h3>
            )}
            <div className="divide-y divide-white/5 border border-white/10 rounded-2xl bg-[#141720] overflow-hidden">
              {loading && songs.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">Searching catalog...</div>
              ) : songs.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  {queryText.trim().length >= 2
                    ? 'No local matches — use the YouTube results above.'
                    : 'No matching tracks in this category.'}
                </div>
              ) : (
                songs.map((song) => renderSongRow(song))
              )}
            </div>
          </div>
        </div>
      )}

      {subTab === 'channels' && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={channelQuery}
              onChange={(e) => setChannelQuery(e.target.value)}
              placeholder="Search inside Hindi karaoke channels..."
              className="w-full min-h-[42px] pl-10 pr-3.5 rounded-xl bg-[#0B0D12] border border-white/10 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#FF5A36]"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
            <button
              type="button"
              onClick={() => setSelectedChannelId('all')}
              className={`min-h-[38px] px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                selectedChannelId === 'all'
                  ? 'bg-[#FF5A36] text-white'
                  : 'bg-[#0B0D12] text-slate-400 hover:text-white border border-white/10'
              }`}
            >
              All Hindi Channels
            </button>
            {channels.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => setSelectedChannelId(ch.id)}
                className={`min-h-[38px] px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  selectedChannelId === ch.id
                    ? 'bg-[#FF5A36] text-white'
                    : 'bg-[#0B0D12] text-slate-400 hover:text-white border border-white/10'
                }`}
              >
                {ch.name}
              </button>
            ))}
          </div>

          <div className="divide-y divide-white/5 border border-white/10 rounded-2xl bg-[#141720] overflow-hidden">
            {channelsLoading ? (
              <div className="p-6 text-center text-xs text-slate-400">
                Loading newest uploads from Hindi karaoke channels...
              </div>
            ) : channelSongs.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                {channelQuery.trim()
                  ? `No channel uploads match "${channelQuery.trim()}". Try Search & Library for all of YouTube.`
                  : 'No embeddable uploads found for this channel right now.'}
              </div>
            ) : (
              channelSongs.map((song) => renderSongRow(song, 'Channel Upload'))
            )}
          </div>
        </div>
      )}

      {subTab === 'queue' && (
        <div className="space-y-3">
          {currentSong && (
            <div className="p-3.5 rounded-2xl bg-[#141720] border border-white/10 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-[#FF5A36]">Now on Stage</p>
                <p className="text-sm font-semibold text-white truncate">{currentSong.title}</p>
                <p className="text-xs text-slate-400 truncate">{currentSong.artist}</p>
              </div>
              {isController && (
                <button
                  type="button"
                  onClick={onSkipCurrent}
                  className="min-h-[42px] px-3.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-medium text-white flex items-center gap-1.5 shrink-0"
                >
                  <SkipForward className="w-4 h-4" />
                  <span>Skip</span>
                </button>
              )}
            </div>
          )}

          {queue.length === 0 ? (
            <div className="p-6 rounded-2xl bg-[#141720] border border-white/10 text-center space-y-2">
              <p className="text-sm font-medium text-slate-200">Queue is empty</p>
              <p className="text-xs text-slate-400">
                Search any song on YouTube, browse Karaoke Channels, or tap Surprise me.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/5 border border-white/10 rounded-2xl bg-[#141720] overflow-hidden">
              {queue.map((item, idx) => {
                const canDelete = isAdmin || item.requestedById === participantId;
                return (
                  <div
                    key={item.id}
                    className="px-3.5 py-3 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white truncate">
                        <span className="font-mono-tabular text-slate-500 mr-2">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        {item.song.title}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">
                        {item.song.artist} · Requested by {item.requestedByName}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {isAdmin && (
                        <>
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => onReorderQueue(item.id, 'up')}
                            className="min-w-[38px] min-h-[38px] rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 text-slate-300 flex items-center justify-center"
                            aria-label="Move up"
                          >
                            <ArrowUp className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === queue.length - 1}
                            onClick={() => onReorderQueue(item.id, 'down')}
                            className="min-w-[38px] min-h-[38px] rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 text-slate-300 flex items-center justify-center"
                            aria-label="Move down"
                          >
                            <ArrowDown className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => onRemoveQueueItem(item.id)}
                          className="min-w-[38px] min-h-[38px] rounded-lg bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 flex items-center justify-center"
                          aria-label="Remove from queue"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
