import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import { AccessToken } from 'livekit-server-sdk';
import { SEED_SONGS, fuzzySearchSongs } from './src/shared/songSeed.ts';
import { SONG_CATEGORIES } from './src/shared/types.ts';
import type {
  ChatMessage,
  CheerEvent,
  Participant,
  QueueItem,
  RoomState,
  SongCategory,
  SongItem,
  WSClientMessage,
  WSServerMessage,
} from './src/shared/types.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const MAX_PARTICIPANTS = 20;
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface ConnectedClient {
  ws: WebSocket;
  participantId: string;
  roomCode: string;
}

interface ServerRoom {
  state: RoomState;
  clients: Map<string, WebSocket>;
  httpParticipants: Map<string, number>;
  disconnectTimers: Map<string, NodeJS.Timeout>;
  pendingLevels: Record<string, number>;
  recentCheers: CheerEvent[];
  pendingSignals: Map<
    string,
    Array<{ fromId: string; signalType: 'offer' | 'answer' | 'ice'; payload: unknown }>
  >;
}

const songCatalog: SongItem[] = [...SEED_SONGS];
const rooms = new Map<string, ServerRoom>();
const socketMeta = new WeakMap<WebSocket, ConnectedClient>();

function generateRoomCode(): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function getEffectivePosition(room: ServerRoom): number {
  const { playback } = room.state;
  if (!playback.isPlaying) return playback.positionSec;
  const elapsedSec = Math.max(0, (Date.now() - playback.updatedAtMs) / 1000);
  return playback.positionSec + elapsedSec;
}

function sendToClient(ws: WebSocket, msg: WSServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastRoom(room: ServerRoom, msg: WSServerMessage, excludeId?: string): void {
  const encoded = JSON.stringify(msg);
  for (const [pid, clientWs] of room.clients.entries()) {
    if (excludeId && pid === excludeId) continue;
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(encoded);
    }
  }
}

function appendSystemMessage(room: ServerRoom, text: string): void {
  const sysMsg: ChatMessage = {
    id: makeId('sys'),
    senderId: 'system',
    senderName: 'Stage',
    senderColor: '#FF5A36',
    text,
    timestampMs: Date.now(),
    type: 'system',
  };
  room.state.messages = [...room.state.messages.slice(-99), sysMsg];
  broadcastRoom(room, { type: 'chat:message', message: sysMsg });
}

function createRoomState(code: string, name: string, adminId: string): RoomState {
  return {
    code,
    name: name.trim() || `Jam Room ${code}`,
    adminId,
    duetMode: false,
    audienceMuted: false,
    autoMuteOnStage: false,
    activeSingerIds: [],
    participants: [],
    queue: [],
    playback: {
      currentSong: SEED_SONGS[0],
      isPlaying: false,
      positionSec: 0,
      updatedAtMs: Date.now(),
      syncSeq: 1,
    },
    messages: [],
    maxParticipants: MAX_PARTICIPANTS,
  };
}

function getOrCreateRoom(code: string, name?: string, adminId?: string): ServerRoom {
  const cleanCode = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const existing = rooms.get(cleanCode);
  if (existing) return existing;

  const newRoom: ServerRoom = {
    state: createRoomState(cleanCode, name || `Jam Room ${cleanCode}`, adminId || ''),
    clients: new Map(),
    httpParticipants: new Map(),
    disconnectTimers: new Map(),
    pendingLevels: {},
    recentCheers: [],
    pendingSignals: new Map(),
  };
  rooms.set(cleanCode, newRoom);
  return newRoom;
}

function getHydratedState(room: ServerRoom): RoomState {
  return {
    ...room.state,
    playback: {
      ...room.state.playback,
      positionSec: getEffectivePosition(room),
      updatedAtMs: Date.now(),
    },
  };
}

function removeParticipantFromRoom(room: ServerRoom, participantId: string): void {
  const leaving = room.state.participants.find((p) => p.id === participantId);
  if (!leaving) return;

  room.clients.delete(participantId);
  room.httpParticipants.delete(participantId);
  room.pendingSignals.delete(participantId);
  room.state.participants = room.state.participants.filter((p) => p.id !== participantId);
  room.state.activeSingerIds = room.state.activeSingerIds.filter((id) => id !== participantId);

  if (room.state.participants.length === 0) {
    rooms.delete(room.state.code);
    return;
  }

  if (room.state.adminId === participantId) {
    room.state.adminId = room.state.participants[0].id;
    appendSystemMessage(room, `${room.state.participants[0].name} took over as room host`);
  } else {
    appendSystemMessage(room, `${leaving.name} left the room`);
  }

  syncStageFlags(room);
  broadcastRoom(room, { type: 'room:state', state: getHydratedState(room) });
}

function joinParticipantToRoom(
  room: ServerRoom,
  participantId: string,
  name: string,
  avatarColor: string,
  ws?: WebSocket
): { ok: true; state: RoomState } | { ok: false; error: string } {
  const existingIdx = room.state.participants.findIndex((p) => p.id === participantId);

  if (existingIdx === -1 && room.state.participants.length >= MAX_PARTICIPANTS) {
    return {
      ok: false,
      error: `Room ${room.state.code} is full (${MAX_PARTICIPANTS}/${MAX_PARTICIPANTS} participants).`,
    };
  }

  const pendingTimer = room.disconnectTimers.get(participantId);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    room.disconnectTimers.delete(participantId);
  }

  if (ws) {
    room.clients.set(participantId, ws);
    room.httpParticipants.delete(participantId);
    socketMeta.set(ws, {
      ws,
      participantId,
      roomCode: room.state.code,
    });
  } else {
    room.httpParticipants.set(participantId, Date.now());
  }

  if (!room.state.adminId || room.state.participants.length === 0) {
    room.state.adminId = participantId;
  }

  if (existingIdx >= 0) {
    room.state.participants[existingIdx] = {
      ...room.state.participants[existingIdx],
      name: name.trim().slice(0, 40) || room.state.participants[existingIdx].name,
      avatarColor: avatarColor || room.state.participants[existingIdx].avatarColor,
    };
  } else {
    const newParticipant: Participant = {
      id: participantId,
      name: name.trim().slice(0, 40) || 'Guest Singer',
      avatarColor: avatarColor || '#FF5A36',
      isAdmin: participantId === room.state.adminId,
      onStage: false,
      micMuted: true,
      adminMuted: room.state.audienceMuted,
      earphonesConfirmed: false,
      handRaised: false,
      audioLevel: 0,
      voiceStatus: 'active',
      joinedAtMs: Date.now(),
    };
    room.state.participants.push(newParticipant);
    appendSystemMessage(room, `${newParticipant.name} joined the room`);
  }

  syncStageFlags(room);
  const hydratedState = getHydratedState(room);
  if (ws) {
    sendToClient(ws, { type: 'room:state', state: hydratedState });
    const queuedSignals = room.pendingSignals.get(participantId);
    if (queuedSignals && queuedSignals.length > 0) {
      room.pendingSignals.delete(participantId);
      for (const sig of queuedSignals) {
        sendToClient(ws, {
          type: 'rtc:signal',
          fromId: sig.fromId,
          signalType: sig.signalType,
          payload: sig.payload,
        });
      }
    }
    broadcastRoom(room, { type: 'room:state', state: hydratedState }, participantId);
  } else {
    broadcastRoom(room, { type: 'room:state', state: hydratedState });
  }
  return { ok: true, state: hydratedState };
}

function syncStageFlags(room: ServerRoom): void {
  const activeSet = new Set(room.state.activeSingerIds);
  for (const p of room.state.participants) {
    p.onStage = activeSet.has(p.id);
    p.isAdmin = p.id === room.state.adminId;
    if (p.onStage) {
      p.handRaised = false;
    }
  }
}

function advanceQueue(room: ServerRoom, autoPlay = true): void {
  if (room.state.queue.length > 0) {
    const [nextItem, ...rest] = room.state.queue;
    room.state.queue = rest;
    room.state.playback = {
      currentSong: nextItem.song,
      isPlaying: autoPlay,
      positionSec: 0,
      updatedAtMs: Date.now(),
      syncSeq: room.state.playback.syncSeq + 1,
    };
    appendSystemMessage(
      room,
      `Up now: ${nextItem.song.title} (requested by ${nextItem.requestedByName})`
    );
  } else {
    room.state.playback = {
      ...room.state.playback,
      isPlaying: false,
      positionSec: 0,
      updatedAtMs: Date.now(),
      syncSeq: room.state.playback.syncSeq + 1,
    };
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', rooms: rooms.size, songs: songCatalog.length });
  });

  const KARAOKE_CHANNELS: Array<{
    id: string;
    name: string;
    category: SongCategory;
    language: string;
  }> = [
    { id: 'UC_6QXpAD97cajzLjow2PGEA', name: 'KaraokeSaga', category: 'Latest Hindi', language: 'Hindi' },
    { id: 'UC_gkNE3eO0FZ23mpdx16-nQ', name: 'SAS Karaoke', category: 'Latest Hindi', language: 'Hindi' },
    { id: 'UCEQB85C58eNP43DmnyyaHTQ', name: 'Sing India Karaoke', category: 'Bollywood', language: 'Hindi' },
    { id: 'UCpQiC_zElVHhNm58uwCi7Gw', name: 'Saregama Karaoke', category: 'Hindi retro', language: 'Hindi' },
    { id: 'UCBXg-Xjj8qgJTv6SJFLla8A', name: 'Hindi Karaoke Shop', category: 'Bollywood', language: 'Hindi' },
    { id: 'UCcSPkKDSKMugQ8TeFsK0eIA', name: 'Karaoke Songs Hindi', category: 'Bollywood', language: 'Hindi' },
    { id: 'UCWBeHsyJIF-NebNvTZvD1zA', name: 'Karaoke With Tanujoy', category: 'Latest Hindi', language: 'Hindi' },
    { id: 'UCT6gmg64AlPvva6ViW6XWgQ', name: 'Roshan Jose Karaoke', category: 'Latest Hindi', language: 'Hindi' },
  ];

  const TRUSTED_KARAOKE_RE =
    /karaokesaga|sas karaoke|sing india|saregama|hindi karaoke shop|karaoke songs hindi|tanujoy|roshanjose|roshan jose|karaoke/i;
  const WESTERN_KARAOKE_RE =
    /sing king|zzang karaoke|karafun|vocal star karaoke|great karaoke music|easy karaoke|matt monro|andy williams/i;

  const ytSearchCache = new Map<string, { ts: number; songs: SongItem[] }>();
  const channelFeedCache = new Map<string, { ts: number; songs: SongItem[] }>();
  const embedCache = new Map<string, boolean>();

  function parseDurationToSec(text: string): number {
    if (!text) return 240;
    const parts = text.split(':').map((n) => Number(n));
    if (parts.some((n) => !Number.isFinite(n))) return 240;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 240;
  }

  async function isVideoEmbeddable(videoId: string): Promise<boolean> {
    if (embedCache.has(videoId)) return Boolean(embedCache.get(videoId));
    try {
      const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${videoId}`
      )}`;
      const res = await fetch(url);
      const ok = res.ok;
      if (ok || res.status === 401 || res.status === 403 || res.status === 404) {
        embedCache.set(videoId, ok);
      }
      return ok;
    } catch {
      return false;
    }
  }

  function extractYtInitialData(html: string): Record<string, unknown> | null {
    const markers = ['var ytInitialData =', 'window["ytInitialData"] ='];
    for (const marker of markers) {
      const idx = html.indexOf(marker);
      if (idx === -1) continue;
      const start = html.indexOf('{', idx + marker.length);
      if (start === -1) continue;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = start; i < html.length; i++) {
        const ch = html[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          if (inString) escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(html.slice(start, i + 1)) as Record<string, unknown>;
            } catch {
              break;
            }
          }
        }
      }
    }
    return null;
  }

  function inferYouTubeCategory(title: string, channel: string): SongCategory {
    const hay = `${title} ${channel}`.toLowerCase();
    if (/punjabi|aujla|diljit|sidhu|ap dhillon|gippy|sartaaj/.test(hay)) return 'Punjabi';
    if (/bhajan|aarti|devotional|mantra|hanuman/.test(hay)) return 'devotional';
    if (/kishore|rafi|lata|asha|mukesh|retro|70s|80s/.test(hay)) return 'Hindi retro';
    if (/90s|udit|alka|kumar sanu|sonu nigam/.test(hay)) return '90s';
    if (/2024|2025|2026|latest|new|anuv jain|navjot ahuja|akhil sachdeva|aditya rikhari|faheem abdullah/.test(hay)) {
      return 'Latest Hindi';
    }
    return 'Bollywood';
  }

  function decodeXmlEntities(str: string): string {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  async function fetchChannelSongs(
    channelsToFetch: typeof KARAOKE_CHANNELS
  ): Promise<SongItem[]> {
    const cacheKey = channelsToFetch.map((c) => c.id).join(',');
    const cached = channelFeedCache.get(cacheKey);
    if (cached && cached.songs.length > 0 && Date.now() - cached.ts < 30 * 60 * 1000) {
      return cached.songs;
    }

    try {
      const feedResults = await Promise.all(
        channelsToFetch.map(async (ch) => {
          const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`;
          const r = await fetch(rssUrl);
          if (!r.ok) return [] as Array<{ song: SongItem; publishedMs: number }>;
          const xml = await r.text();
          const entries = xml.split('<entry>').slice(1, 9);
          const list: Array<{ song: SongItem; publishedMs: number }> = [];
          for (const entry of entries) {
            const vid = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1]?.trim();
            const titleRaw = entry.match(/<title>([^<]+)<\/title>/)?.[1] || '';
            const published = entry.match(/<published>([^<]+)<\/published>/)?.[1] || '';
            if (!vid || !/^[a-zA-Z0-9_-]{11}$/.test(vid)) continue;
            const title = decodeXmlEntities(titleRaw).trim();
            if (!title || /#shorts/i.test(title)) continue;
            // Skip clearly non-Hindi/non-karaoke regional tags when mixed in multi-language shops
            if (/^tamil\s*-|^telugu\s*-|^malayalam\s*-/i.test(title) && ch.language === 'Hindi') {
              continue;
            }
            list.push({
              song: {
                id: `ch_${vid}`,
                videoId: vid,
                title: title.slice(0, 160),
                artist: ch.name,
                language: ch.language,
                category: inferYouTubeCategory(title, ch.name) || ch.category,
                durationSec: 240,
              },
              publishedMs: Date.parse(published) || 0,
            });
          }
          return list;
        })
      );

      const merged = feedResults
        .flat()
        .sort((a, b) => b.publishedMs - a.publishedMs)
        .slice(0, channelsToFetch.length === 1 ? 15 : 32);

      const embedChecks = await Promise.all(
        merged.map(async (item) => ({
          song: item.song,
          embeddable: await isVideoEmbeddable(item.song.videoId),
        }))
      );

      const songs = embedChecks.filter((x) => x.embeddable).map((x) => x.song);
      if (songs.length > 0) {
        channelFeedCache.set(cacheKey, { ts: Date.now(), songs });
      }
      return songs;
    } catch (err) {
      console.error('Karaoke channel feed error:', err);
      return [];
    }
  }

  // Warm Hindi channel uploads on startup so search immediately includes channel tracks
  void fetchChannelSongs(KARAOKE_CHANNELS);

  app.get('/api/songs', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const category =
      typeof req.query.category === 'string' &&
      (categoryIsValid(req.query.category) || req.query.category === 'All')
        ? (req.query.category as SongCategory | 'All')
        : 'All';

    const channelSongs = await fetchChannelSongs(KARAOKE_CHANNELS);
    const seen = new Set(songCatalog.map((s) => s.videoId));
    const combined = [...songCatalog, ...channelSongs.filter((s) => !seen.has(s.videoId))];
    const results = fuzzySearchSongs(combined, q, category);
    res.json({ songs: results });
  });

  app.get('/api/songs/youtube-search', async (req, res) => {
    const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const karaokeOnly = req.query.karaokeOnly !== 'false';
    if (rawQuery.length < 2) {
      res.json({ songs: [] });
      return;
    }

    const hasRegionOrArtistHint =
      /\b(hindi|punjabi|bollywood|bhajan|marathi|tamil|telugu|malayalam|aujla|diljit|sidhu|arijit|sachdeva|anuv|navjot|dhillon)\b/i.test(
        rawQuery
      );
    const hasKaraokeHint = /\b(karaoke|instrumental|minus one|sing along)\b/i.test(rawQuery);
    const effectiveQuery = karaokeOnly
      ? `${rawQuery}${hasRegionOrArtistHint ? '' : ' hindi'}${hasKaraokeHint ? '' : ' karaoke'}`
      : hasRegionOrArtistHint
        ? rawQuery
        : `${rawQuery} hindi song`;

    const cacheKey = `hi_${karaokeOnly ? 'k' : 'all'}:${effectiveQuery.toLowerCase()}`;
    const cached = ytSearchCache.get(cacheKey);
    if (cached && cached.songs.length > 0 && Date.now() - cached.ts < 15 * 60 * 1000) {
      res.json({ songs: cached.songs, query: effectiveQuery });
      return;
    }

    try {
      const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(effectiveQuery)}`;
      const response = await fetch(ytUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          Cookie: 'SOCS=CAI;',
        },
      });
      if (!response.ok) {
        res.status(502).json({ error: 'YouTube search temporarily unavailable', songs: [] });
        return;
      }

      const html = await response.text();
      const parsed = extractYtInitialData(html);
      if (!parsed) {
        res.json({ songs: [], query: effectiveQuery });
        return;
      }

      const data = parsed as {
        contents?: {
          twoColumnSearchResultsRenderer?: {
            primaryContents?: {
              sectionListRenderer?: {
                contents?: Array<{
                  itemSectionRenderer?: {
                    contents?: Array<{
                      videoRenderer?: {
                        videoId?: string;
                        title?: { runs?: Array<{ text?: string }>; simpleText?: string };
                        ownerText?: { runs?: Array<{ text?: string }> };
                        longBylineText?: { runs?: Array<{ text?: string }> };
                        lengthText?: { simpleText?: string };
                      };
                      richItemRenderer?: {
                        content?: {
                          videoRenderer?: {
                            videoId?: string;
                            title?: { runs?: Array<{ text?: string }>; simpleText?: string };
                            ownerText?: { runs?: Array<{ text?: string }> };
                            longBylineText?: { runs?: Array<{ text?: string }> };
                            lengthText?: { simpleText?: string };
                          };
                        };
                      };
                    }>;
                  };
                }>;
              };
            };
          };
        };
      };

      const sections =
        data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
          ?.contents || [];
      const candidates: Array<{
        videoId: string;
        title: string;
        artist: string;
        durationSec: number;
        score: number;
      }> = [];

      const seenIds = new Set<string>();
      for (const sec of sections) {
        for (const item of sec?.itemSectionRenderer?.contents || []) {
          const vr = item.videoRenderer || item.richItemRenderer?.content?.videoRenderer;
          if (!vr?.videoId || !/^[a-zA-Z0-9_-]{11}$/.test(vr.videoId)) continue;
          if (seenIds.has(vr.videoId)) continue;
          seenIds.add(vr.videoId);

          const title = (
            vr.title?.runs?.map((r) => r.text || '').join('') ||
            vr.title?.simpleText ||
            ''
          ).trim();
          const channel = (
            vr.ownerText?.runs?.map((r) => r.text || '').join('') ||
            vr.longBylineText?.runs?.map((r) => r.text || '').join('') ||
            ''
          ).trim();
          const durationSec = parseDurationToSec(vr.lengthText?.simpleText || '');

          if (!title || durationSec < 45 || durationSec > 1200) continue;
          if (WESTERN_KARAOKE_RE.test(title) || WESTERN_KARAOKE_RE.test(channel)) continue;

          let score = 0;
          if (/karaoke/i.test(title)) score += 3;
          if (/instrumental|lyrics|minus one/i.test(title)) score += 2;
          if (/hindi|bollywood|punjabi/i.test(`${title} ${channel}`)) score += 2;
          if (TRUSTED_KARAOKE_RE.test(channel)) score += 4;

          candidates.push({
            videoId: vr.videoId,
            title: title.slice(0, 160),
            artist: channel.slice(0, 120) || 'Hindi Karaoke',
            durationSec,
            score,
          });
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      const topCandidates = candidates.slice(0, 12);

      // Verify embeddability in parallel so every displayed result plays cleanly in the iframe
      const embedChecks = await Promise.all(
        topCandidates.map(async (c) => ({
          candidate: c,
          embeddable: await isVideoEmbeddable(c.videoId),
        }))
      );

      const songs: SongItem[] = embedChecks
        .filter((x) => x.embeddable)
        .map(({ candidate }) => ({
          id: `yt_${candidate.videoId}`,
          videoId: candidate.videoId,
          title: candidate.title,
          artist: candidate.artist,
          language: 'Hindi',
          category: inferYouTubeCategory(candidate.title, candidate.artist),
          durationSec: candidate.durationSec,
        }));

      if (songs.length > 0) {
        ytSearchCache.set(cacheKey, { ts: Date.now(), songs });
      }
      res.json({ songs, query: effectiveQuery });
    } catch (err) {
      console.error('YouTube karaoke search error:', err);
      res.status(502).json({ error: 'Unable to search YouTube right now', songs: [] });
    }
  });

  app.get('/api/songs/channels', async (req, res) => {
    const requestedId = typeof req.query.channelId === 'string' ? req.query.channelId.trim() : 'all';
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const channelsToFetch =
      requestedId === 'all'
        ? KARAOKE_CHANNELS
        : KARAOKE_CHANNELS.filter((c) => c.id === requestedId);

    if (channelsToFetch.length === 0) {
      res.json({ channels: KARAOKE_CHANNELS, songs: [] });
      return;
    }

    const songs = await fetchChannelSongs(channelsToFetch);
    const filtered = q ? fuzzySearchSongs(songs, q, 'All') : songs;
    res.json({ channels: KARAOKE_CHANNELS, songs: filtered });
  });

  app.get('/api/songs/surprise', (req, res) => {
    const category =
      typeof req.query.category === 'string' && categoryIsValid(req.query.category)
        ? (req.query.category as SongCategory)
        : null;
    const exclude = typeof req.query.exclude === 'string' ? req.query.exclude.trim() : '';
    const categoryPool = category
      ? songCatalog.filter((s) => s.category === category)
      : songCatalog;
    const nonCurrentPool = exclude
      ? categoryPool.filter((s) => s.videoId !== exclude)
      : categoryPool;
    const list =
      nonCurrentPool.length > 0
        ? nonCurrentPool
        : categoryPool.length > 0
          ? categoryPool
          : songCatalog;
    const song = list[Math.floor(Math.random() * list.length)];
    res.json({ song });
  });

  app.get('/api/youtube-meta', async (req, res) => {
    const rawId = typeof req.query.videoId === 'string' ? req.query.videoId.trim() : '';
    if (!/^[a-zA-Z0-9_-]{11}$/.test(rawId)) {
      res.status(400).json({ error: 'Invalid YouTube video ID' });
      return;
    }
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${rawId}`
      )}&format=json`;
      const response = await fetch(oembedUrl);
      if (!response.ok) {
        res.status(404).json({ error: 'Video not found or embedding restricted' });
        return;
      }
      const data = (await response.json()) as { title?: string; author_name?: string };
      res.json({
        videoId: rawId,
        title: data.title || 'Untitled Karaoke Track',
        artist: data.author_name || 'YouTube Karaoke',
      });
    } catch {
      res.status(502).json({ error: 'Unable to fetch video metadata' });
    }
  });

  app.post('/api/songs', (req, res) => {
    const { videoId, title, artist, language, category, durationSec } = req.body || {};
    if (typeof videoId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(videoId.trim())) {
      res.status(400).json({ error: 'Valid 11-character YouTube videoId is required' });
      return;
    }
    if (typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: 'Song title is required' });
      return;
    }
    if (!categoryIsValid(category)) {
      res.status(400).json({ error: 'Invalid category' });
      return;
    }
    const existing = songCatalog.find((s) => s.videoId === videoId.trim());
    if (existing) {
      res.json({ song: existing });
      return;
    }
    const newSong: SongItem = {
      id: makeId('song'),
      videoId: videoId.trim(),
      title: title.trim().slice(0, 160),
      artist: typeof artist === 'string' && artist.trim() ? artist.trim().slice(0, 120) : 'Custom Track',
      language: typeof language === 'string' && language.trim() ? language.trim().slice(0, 40) : 'Hindi',
      category,
      durationSec: Number.isFinite(Number(durationSec)) ? Math.max(30, Number(durationSec)) : 240,
    };
    songCatalog.unshift(newSong);
    res.status(201).json({ song: newSong });
  });

  app.post('/api/rooms', (req, res) => {
    const { name, adminId } = req.body || {};
    const code = generateRoomCode();
    const room = getOrCreateRoom(
      code,
      typeof name === 'string' ? name.slice(0, 80) : `Jam Room ${code}`,
      typeof adminId === 'string' ? adminId : ''
    );
    res.status(201).json({
      code: room.state.code,
      name: room.state.name,
      maxParticipants: MAX_PARTICIPANTS,
    });
  });

  app.get('/api/rooms/:code', (req, res) => {
    const code = req.params.code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const room = rooms.get(code);
    if (!room) {
      res.json({ exists: false, code, participantCount: 0, maxParticipants: MAX_PARTICIPANTS });
      return;
    }
    res.json({
      exists: true,
      code: room.state.code,
      name: room.state.name,
      participantCount: room.state.participants.length,
      maxParticipants: MAX_PARTICIPANTS,
    });
  });

  app.post('/api/rooms/:code/join', (req, res) => {
    const cleanCode = req.params.code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const { participantId, name, avatarColor, roomName, createIfMissing } = req.body || {};
    if (!cleanCode || typeof participantId !== 'string' || !participantId.trim()) {
      res.status(400).json({ error: 'Valid room code and participantId are required' });
      return;
    }
    if (!rooms.has(cleanCode) && !createIfMissing) {
      res.status(404).json({ notFound: true, roomCode: cleanCode, error: `Room ${cleanCode} not found on this server` });
      return;
    }
    const room = getOrCreateRoom(
      cleanCode,
      typeof roomName === 'string' ? roomName : undefined,
      participantId
    );
    const joined = joinParticipantToRoom(
      room,
      participantId,
      typeof name === 'string' ? name : 'Guest Singer',
      typeof avatarColor === 'string' ? avatarColor : '#FF5A36'
    );
    if (!joined.ok) {
      res.status(409).json({ error: joined.error });
      return;
    }
    res.json({ state: joined.state });
  });

  app.get('/api/rooms/:code/state', (req, res) => {
    const cleanCode = req.params.code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const room = rooms.get(cleanCode);
    if (!room) {
      res.status(404).json({ notFound: true, roomCode: cleanCode });
      return;
    }
    const participantId = typeof req.query.participantId === 'string' ? req.query.participantId : '';
    const sinceMs = Number(req.query.sinceMs || 0);
    if (participantId && room.state.participants.some((p) => p.id === participantId)) {
      if (!room.clients.has(participantId)) {
        room.httpParticipants.set(participantId, Date.now());
      }
    }
    const cheers = room.recentCheers.filter((c) => c.timestampMs > sinceMs);
    const signals = participantId ? room.pendingSignals.get(participantId) || [] : [];
    if (participantId && signals.length > 0) {
      room.pendingSignals.delete(participantId);
    }
    res.json({ state: getHydratedState(room), cheers, signals });
  });

  app.post('/api/rooms/:code/action', (req, res) => {
    const cleanCode = req.params.code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const room = rooms.get(cleanCode);
    if (!room) {
      res.status(404).json({ notFound: true, roomCode: cleanCode });
      return;
    }
    const { participantId, message } = req.body || {};
    if (typeof participantId !== 'string' || !message || typeof message.type !== 'string') {
      res.status(400).json({ error: 'Invalid action payload' });
      return;
    }
    if (!room.clients.has(participantId)) {
      room.httpParticipants.set(participantId, Date.now());
    }
    let errorMsg: string | null = null;
    processRoomMessage(room, participantId, message as WSClientMessage, (err) => {
      errorMsg = err;
    });
    if (errorMsg) {
      res.status(400).json({ error: errorMsg, state: getHydratedState(room) });
      return;
    }
    res.json({ state: getHydratedState(room) });
  });

  app.post('/api/livekit-token', async (req, res) => {
    const { roomCode, participantId, participantName } = req.body || {};
    const livekitUrl = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!livekitUrl || !apiKey || !apiSecret) {
      res.json({ mode: 'webrtc-mesh', token: null, livekitUrl: null });
      return;
    }

    try {
      const at = new AccessToken(apiKey, apiSecret, {
        identity: String(participantId || makeId('user')),
        name: String(participantName || 'Singer').slice(0, 60),
        ttl: '4h',
      });
      at.addGrant({
        roomJoin: true,
        room: String(roomCode || 'DEFAULT').toUpperCase(),
        canPublish: true,
        canSubscribe: true,
      });
      const token = await at.toJwt();
      res.json({ mode: 'livekit', token, livekitUrl });
    } catch (error) {
      console.error('Failed to mint LiveKit token:', error);
      res.json({ mode: 'webrtc-mesh', token: null, livekitUrl: null });
    }
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg: WSClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as WSClientMessage;
      } catch {
        return;
      }

      if (msg.type === 'ping') {
        sendToClient(ws, { type: 'pong', clientTs: msg.clientTs, serverTs: Date.now() });
        return;
      }

      if (msg.type === 'room:join') {
        const cleanCode = msg.roomCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
        if (!cleanCode) {
          sendToClient(ws, { type: 'error', message: 'Invalid room code' });
          return;
        }
        if (!rooms.has(cleanCode) && !msg.createIfMissing) {
          sendToClient(ws, { type: 'room:not_found', roomCode: cleanCode });
          return;
        }
        const room = getOrCreateRoom(cleanCode, msg.roomName, msg.participantId);
        const joined = joinParticipantToRoom(
          room,
          msg.participantId,
          msg.name,
          msg.avatarColor,
          ws
        );
        if (!joined.ok) {
          sendToClient(ws, { type: 'error', message: joined.error });
        }
        return;
      }

      const meta = socketMeta.get(ws);
      if (!meta) return;
      const room = rooms.get(meta.roomCode);
      if (!room) return;
      processRoomMessage(room, meta.participantId, msg, (errMsg) => {
        sendToClient(ws, { type: 'error', message: errMsg });
      });
    });

    ws.on('close', () => {
      const meta = socketMeta.get(ws);
      if (!meta) return;
      const room = rooms.get(meta.roomCode);
      if (!room) return;
      if (room.clients.get(meta.participantId) !== ws) return;

      room.clients.delete(meta.participantId);

      const timer = setTimeout(() => {
        room.disconnectTimers.delete(meta.participantId);
        removeParticipantFromRoom(room, meta.participantId);
      }, 15000);

      room.disconnectTimers.set(meta.participantId, timer);
    });
  });

  function processRoomMessage(
    room: ServerRoom,
    participantId: string,
    msg: WSClientMessage,
    notifyError: (message: string) => void
  ): void {
    const sender = room.state.participants.find((p) => p.id === participantId);
    if (!sender) return;

    const isAdmin = participantId === room.state.adminId;
    const isSinger = room.state.activeSingerIds.includes(participantId);

    switch (msg.type) {
        case 'playback:play': {
          if (!isAdmin && !isSinger) return;
          room.state.playback = {
            ...room.state.playback,
            isPlaying: true,
            positionSec: Math.max(0, msg.positionSec),
            updatedAtMs: Date.now(),
            syncSeq: room.state.playback.syncSeq + 1,
          };
          broadcastRoom(room, { type: 'playback:state', playback: room.state.playback });
          break;
        }
        case 'playback:pause': {
          if (!isAdmin && !isSinger) return;
          room.state.playback = {
            ...room.state.playback,
            isPlaying: false,
            positionSec: Math.max(0, msg.positionSec),
            updatedAtMs: Date.now(),
            syncSeq: room.state.playback.syncSeq + 1,
          };
          broadcastRoom(room, { type: 'playback:state', playback: room.state.playback });
          break;
        }
        case 'playback:seek': {
          if (!isAdmin && !isSinger) return;
          room.state.playback = {
            ...room.state.playback,
            positionSec: Math.max(0, msg.positionSec),
            updatedAtMs: Date.now(),
            syncSeq: room.state.playback.syncSeq + 1,
          };
          broadcastRoom(room, { type: 'playback:state', playback: room.state.playback });
          break;
        }
        case 'playback:loadSong': {
          if (!isAdmin && !isSinger) return;
          room.state.playback = {
            currentSong: msg.song,
            isPlaying: true,
            positionSec: 0,
            updatedAtMs: Date.now(),
            syncSeq: room.state.playback.syncSeq + 1,
          };
          appendSystemMessage(room, `${sender.name} queued "${msg.song.title}" on stage`);
          broadcastRoom(room, { type: 'room:state', state: room.state });
          break;
        }
        case 'playback:ended': {
          if (!isAdmin && !isSinger) return;
          if (room.state.playback.currentSong?.videoId !== msg.videoId) return;
          advanceQueue(room, true);
          broadcastRoom(room, { type: 'room:state', state: room.state });
          break;
        }
        case 'queue:add': {
          const item: QueueItem = {
            id: makeId('q'),
            song: msg.song,
            requestedById: sender.id,
            requestedByName: sender.name,
            addedAtMs: Date.now(),
          };
          if (!room.state.playback.currentSong) {
            room.state.playback = {
              currentSong: msg.song,
              isPlaying: true,
              positionSec: 0,
              updatedAtMs: Date.now(),
              syncSeq: room.state.playback.syncSeq + 1,
            };
            appendSystemMessage(room, `${sender.name} started "${msg.song.title}"`);
          } else {
            room.state.queue.push(item);
            appendSystemMessage(room, `${sender.name} added "${msg.song.title}" to queue`);
          }
          broadcastRoom(room, { type: 'room:state', state: room.state });
          break;
        }
        case 'queue:remove': {
          const idx = room.state.queue.findIndex((q) => q.id === msg.itemId);
          if (idx === -1) return;
          const item = room.state.queue[idx];
          if (!isAdmin && item.requestedById !== sender.id) return;
          room.state.queue.splice(idx, 1);
          broadcastRoom(room, { type: 'room:state', state: room.state });
          break;
        }
        case 'queue:reorder': {
          if (!isAdmin) return;
          const idx = room.state.queue.findIndex((q) => q.id === msg.itemId);
          if (idx === -1) return;
          const targetIdx = msg.direction === 'up' ? idx - 1 : idx + 1;
          if (targetIdx < 0 || targetIdx >= room.state.queue.length) return;
          const copy = [...room.state.queue];
          const [moved] = copy.splice(idx, 1);
          copy.splice(targetIdx, 0, moved);
          room.state.queue = copy;
          broadcastRoom(room, { type: 'room:state', state: room.state });
          break;
        }
        case 'queue:skip': {
          if (!isAdmin && !isSinger) return;
          advanceQueue(room, true);
          broadcastRoom(room, { type: 'room:state', state: room.state });
          break;
        }
        case 'stage:take': {
          if (!msg.earphonesConfirmed) {
            notifyError('Please confirm earphones before taking the mic.');
            return;
          }
          const maxSingers = room.state.duetMode ? 2 : 1;
          if (
            !room.state.activeSingerIds.includes(sender.id) &&
            room.state.activeSingerIds.length >= maxSingers
          ) {
            if (!isAdmin) {
              notifyError(
                room.state.duetMode
                  ? 'Both duet mic slots are currently occupied.'
                  : 'Someone else currently holds the mic.'
              );
              return;
            }
            while (room.state.activeSingerIds.length >= maxSingers) {
              const removedId = room.state.activeSingerIds.shift();
              const removed = room.state.participants.find((p) => p.id === removedId);
              if (removed) {
                removed.micMuted = true;
                removed.audioLevel = 0;
              }
            }
          }
          if (!room.state.activeSingerIds.includes(sender.id)) {
            room.state.activeSingerIds.push(sender.id);
          }
          sender.earphonesConfirmed = true;
          sender.micMuted = false;
          sender.adminMuted = false;
          sender.handRaised = false;
          sender.voiceStatus = 'active';

          if (room.state.autoMuteOnStage) {
            room.state.audienceMuted = true;
            for (const p of room.state.participants) {
              if (!room.state.activeSingerIds.includes(p.id)) {
                p.adminMuted = true;
                p.micMuted = true;
              }
            }
          }
          syncStageFlags(room);
          appendSystemMessage(room, `${sender.name} took the stage mic`);
          broadcastRoom(room, { type: 'room:state', state: room.state });
          break;
        }
        case 'stage:release': {
          const targetId =
            isAdmin && msg.targetParticipantId ? msg.targetParticipantId : sender.id;
          room.state.activeSingerIds = room.state.activeSingerIds.filter(
            (id) => id !== targetId
          );
          const target = room.state.participants.find((p) => p.id === targetId);
          if (target) {
            target.micMuted = true;
            target.audioLevel = 0;
          }
          syncStageFlags(room);
          appendSystemMessage(
            room,
            target && target.id !== sender.id
              ? `${sender.name} stepped ${target.name} off stage`
              : `${sender.name} passed the stage mic`
          );
          broadcastRoom(room, { type: 'room:state', state: room.state });
          break;
        }
        case 'stage:pass': {
          if (!isAdmin) return;
          const target = room.state.participants.find((p) => p.id === msg.targetParticipantId);
          if (!target) return;
          const maxSingers = room.state.duetMode ? 2 : 1;
          if (!room.state.activeSingerIds.includes(target.id)) {
            while (room.state.activeSingerIds.length >= maxSingers) {
              const removedId = room.state.activeSingerIds.shift();
              const removed = room.state.participants.find((p) => p.id === removedId);
              if (removed) {
                removed.micMuted = true;
                removed.audioLevel = 0;
              }
            }
            room.state.activeSingerIds.push(target.id);
          }
          target.adminMuted = false;
          target.handRaised = false;
          if (room.state.autoMuteOnStage) {
            room.state.audienceMuted = true;
            for (const p of room.state.participants) {
              if (!room.state.activeSingerIds.includes(p.id)) {
                p.adminMuted = true;
                p.micMuted = true;
              }
            }
          }
          syncStageFlags(room);
          appendSystemMessage(
            room,
            target.id === sender.id
              ? `${sender.name} reclaimed the stage mic`
              : `${sender.name} handed the stage mic to ${target.name}`
          );
          broadcastRoom(room, { type: 'room:state', state: room.state });
          break;
        }
        case 'stage:toggleDuet': {
          if (!isAdmin) return;
          room.state.duetMode = msg.duetMode;
          if (!msg.duetMode && room.state.activeSingerIds.length > 1) {
            const [first, ...others] = room.state.activeSingerIds;
            room.state.activeSingerIds = [first];
            for (const oid of others) {
              const op = room.state.participants.find((p) => p.id === oid);
              if (op) op.micMuted = true;
            }
          }
          syncStageFlags(room);
          appendSystemMessage(
            room,
            msg.duetMode ? 'Duet mode enabled (2 singers on stage)' : 'Solo stage mode enabled'
          );
          broadcastRoom(room, { type: 'room:state', state: room.state });
          break;
        }
        case 'mic:state': {
          sender.earphonesConfirmed = msg.earphonesConfirmed;
          sender.voiceStatus = msg.voiceStatus;
          if (sender.adminMuted && !sender.onStage && !msg.micMuted) {
            sender.micMuted = true;
          } else {
            sender.micMuted = msg.micMuted;
            if (!msg.micMuted) {
              sender.handRaised = false;
            }
          }
          if (sender.micMuted) {
            sender.audioLevel = 0;
          }
          broadcastRoom(room, { type: 'room:state', state: room.state });
          break;
        }
        case 'mic:level': {
          const clamped = Math.max(0, Math.min(100, Math.round(msg.level)));
          sender.audioLevel = clamped;
          room.pendingLevels[sender.id] = clamped;
          break;
        }
        case 'mic:handRaise': {
          sender.handRaised = msg.raised;
          broadcastRoom(room, { type: 'room:state', state: room.state });
          break;
        }
        case 'admin:muteAllOthers': {
          if (!isAdmin) return;
          room.state.audienceMuted = msg.muted;
          for (const p of room.state.participants) {
            if (!room.state.activeSingerIds.includes(p.id)) {
              p.adminMuted = msg.muted;
              if (msg.muted) {
                p.micMuted = true;
                p.audioLevel = 0;
              } else {
                p.handRaised = false;
              }
            }
          }
          appendSystemMessage(
            room,
            msg.muted ? 'Audience muted — stage focus active' : 'Host enabled mic access for everyone'
          );
          broadcastRoom(room, { type: 'room:state', state: room.state });
          break;
        }
        case 'admin:toggleAutoMuteOnStage': {
          if (!isAdmin) return;
          room.state.autoMuteOnStage = msg.enabled;
          broadcastRoom(room, { type: 'room:state', state: room.state });
          break;
        }
        case 'admin:muteParticipant': {
          if (!isAdmin) return;
          const target = room.state.participants.find((p) => p.id === msg.targetId);
          if (!target) return;
          target.adminMuted = msg.muted;
          target.handRaised = false;
          if (msg.muted) {
            target.micMuted = true;
            target.audioLevel = 0;
          }
          appendSystemMessage(
            room,
            msg.muted
              ? `Host disabled mic for ${target.name}`
              : `Host allowed mic for ${target.name}`
          );
          broadcastRoom(room, { type: 'room:state', state: room.state });
          break;
        }
        case 'admin:kick': {
          if (!isAdmin || msg.targetId === sender.id) return;
          const target = room.state.participants.find((p) => p.id === msg.targetId);
          if (!target) return;
          const targetWs = room.clients.get(msg.targetId);
          if (targetWs) {
            sendToClient(targetWs, {
              type: 'room:kicked',
              reason: 'You were removed from the room by the host.',
            });
            targetWs.close();
          }
          room.clients.delete(msg.targetId);
          room.state.participants = room.state.participants.filter((p) => p.id !== msg.targetId);
          room.state.activeSingerIds = room.state.activeSingerIds.filter(
            (id) => id !== msg.targetId
          );
          syncStageFlags(room);
          appendSystemMessage(room, `${target.name} was removed from the room`);
          broadcastRoom(room, { type: 'room:state', state: room.state });
          break;
        }
        case 'admin:transferAdmin': {
          if (!isAdmin) return;
          const target = room.state.participants.find((p) => p.id === msg.targetId);
          if (!target) return;
          room.state.adminId = target.id;
          syncStageFlags(room);
          appendSystemMessage(room, `${target.name} is now the room host`);
          broadcastRoom(room, { type: 'room:state', state: room.state });
          break;
        }
        case 'chat:send': {
          const text = msg.text.trim().slice(0, 400);
          if (!text) return;
          const chatMsg: ChatMessage = {
            id: makeId('msg'),
            senderId: sender.id,
            senderName: sender.name,
            senderColor: sender.avatarColor,
            text,
            timestampMs: Date.now(),
            type: 'chat',
          };
          room.state.messages = [...room.state.messages.slice(-99), chatMsg];
          broadcastRoom(room, { type: 'chat:message', message: chatMsg });
          break;
        }
        case 'cheer:send': {
          const allowed = new Set(['👏', '🔥', '❤️', '🎤']);
          if (!allowed.has(msg.emoji)) return;
          const cheer: CheerEvent = {
            id: makeId('ch'),
            emoji: msg.emoji,
            senderName: sender.name,
            timestampMs: Date.now(),
          };
          room.recentCheers = [...room.recentCheers.slice(-20), cheer];
          broadcastRoom(room, {
            type: 'cheer:burst',
            cheer,
          });
          break;
        }
        case 'rtc:signal': {
          const targetExists = room.state.participants.some((p) => p.id === msg.targetId);
          if (!targetExists || msg.targetId === sender.id) return;
          const targetWs = room.clients.get(msg.targetId);
          if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            sendToClient(targetWs, {
              type: 'rtc:signal',
              fromId: sender.id,
              signalType: msg.signalType,
              payload: msg.payload,
            });
          } else {
            const existing = room.pendingSignals.get(msg.targetId) || [];
            existing.push({
              fromId: sender.id,
              signalType: msg.signalType,
              payload: msg.payload,
            });
            room.pendingSignals.set(msg.targetId, existing.slice(-60));
          }
          break;
        }
        case 'voice:pcm': {
          if (sender.micMuted || (sender.adminMuted && !sender.onStage)) return;
          if (!Array.isArray(msg.targetIds) || typeof msg.data !== 'string' || msg.data.length > 32768) {
            return;
          }
          const sampleRate = Number(msg.sampleRate) === 16000 ? 16000 : 16000;
          for (const targetId of msg.targetIds) {
            if (!targetId || targetId === sender.id) continue;
            const targetWs = room.clients.get(targetId);
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
              sendToClient(targetWs, {
                type: 'voice:pcm',
                fromId: sender.id,
                sampleRate,
                data: msg.data,
              });
            }
          }
          break;
        }
      }
  }

  // Authoritative playback sync heartbeat (2s) + HTTP fallback stale cleanup + mic level batching (120ms)
  setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      for (const [pid, lastSeen] of room.httpParticipants.entries()) {
        if (now - lastSeen > 25000 && !room.clients.has(pid)) {
          removeParticipantFromRoom(room, pid);
        }
      }
      if ((room.clients.size === 0 && room.httpParticipants.size === 0) || !room.state.playback.isPlaying) {
        continue;
      }
      const pos = getEffectivePosition(room);
      room.state.playback.positionSec = pos;
      room.state.playback.updatedAtMs = now;
      broadcastRoom(room, { type: 'playback:state', playback: room.state.playback });
    }
  }, 2000);

  setInterval(() => {
    for (const room of rooms.values()) {
      const keys = Object.keys(room.pendingLevels);
      if (keys.length === 0) continue;
      const levels = { ...room.pendingLevels };
      room.pendingLevels = {};
      broadcastRoom(room, { type: 'mic:levels', levels });
    }
  }, 120);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build not found');
      }
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`SurStage server listening on http://0.0.0.0:${PORT}`);
  });
}

function categoryIsValid(value: unknown): value is SongCategory {
  return typeof value === 'string' && SONG_CATEGORIES.includes(value as SongCategory);
}

startServer().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});
