export type SongCategory =
  | 'Latest Hindi'
  | 'Bollywood'
  | 'Hindi retro'
  | 'Punjabi'
  | '90s'
  | 'regional'
  | 'devotional';

export const SONG_CATEGORIES: SongCategory[] = [
  'Latest Hindi',
  'Bollywood',
  'Hindi retro',
  'Punjabi',
  '90s',
  'regional',
  'devotional',
];

export interface SongItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  language: string;
  category: SongCategory;
  durationSec: number;
}

export interface QueueItem {
  id: string;
  song: SongItem;
  requestedById: string;
  requestedByName: string;
  addedAtMs: number;
}

export type VoiceStatus = 'active' | 'listen-only' | 'idle-disconnected';

export interface Participant {
  id: string;
  name: string;
  avatarColor: string;
  isAdmin: boolean;
  onStage: boolean;
  micMuted: boolean;
  adminMuted: boolean;
  earphonesConfirmed: boolean;
  handRaised: boolean;
  audioLevel: number;
  voiceStatus: VoiceStatus;
  joinedAtMs: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderColor: string;
  text: string;
  timestampMs: number;
  type: 'chat' | 'system';
}

export type CheerEmoji = '👏' | '🔥' | '❤️' | '🎤';

export interface CheerEvent {
  id: string;
  emoji: CheerEmoji;
  senderName: string;
  timestampMs: number;
}

export interface PlaybackState {
  currentSong: SongItem | null;
  isPlaying: boolean;
  positionSec: number;
  updatedAtMs: number;
  syncSeq: number;
}

export interface RoomState {
  code: string;
  name: string;
  adminId: string;
  duetMode: boolean;
  audienceMuted: boolean;
  autoMuteOnStage: boolean;
  activeSingerIds: string[];
  participants: Participant[];
  queue: QueueItem[];
  playback: PlaybackState;
  messages: ChatMessage[];
  maxParticipants: number;
}

export type WSClientMessage =
  | {
      type: 'room:join';
      roomCode: string;
      participantId: string;
      name: string;
      avatarColor: string;
      roomName?: string;
      createIfMissing?: boolean;
    }
  | { type: 'ping'; clientTs: number }
  | { type: 'playback:play'; positionSec: number }
  | { type: 'playback:pause'; positionSec: number }
  | { type: 'playback:seek'; positionSec: number }
  | { type: 'playback:loadSong'; song: SongItem }
  | { type: 'playback:ended'; videoId: string }
  | { type: 'queue:add'; song: SongItem }
  | { type: 'queue:remove'; itemId: string }
  | { type: 'queue:reorder'; itemId: string; direction: 'up' | 'down' }
  | { type: 'queue:skip' }
  | { type: 'stage:take'; earphonesConfirmed: boolean }
  | { type: 'stage:release'; targetParticipantId?: string }
  | { type: 'stage:pass'; targetParticipantId: string }
  | { type: 'stage:toggleDuet'; duetMode: boolean }
  | { type: 'mic:state'; micMuted: boolean; earphonesConfirmed: boolean; voiceStatus: VoiceStatus }
  | { type: 'mic:level'; level: number }
  | { type: 'mic:handRaise'; raised: boolean }
  | { type: 'admin:muteAllOthers'; muted: boolean }
  | { type: 'admin:toggleAutoMuteOnStage'; enabled: boolean }
  | { type: 'admin:muteParticipant'; targetId: string; muted: boolean }
  | { type: 'admin:kick'; targetId: string }
  | { type: 'admin:transferAdmin'; targetId: string }
  | { type: 'chat:send'; text: string }
  | { type: 'cheer:send'; emoji: CheerEmoji }
  | {
      type: 'rtc:signal';
      targetId: string;
      signalType: 'offer' | 'answer' | 'ice';
      payload: unknown;
    }
  | {
      type: 'voice:pcm';
      targetIds: string[];
      sampleRate: number;
      data: string;
    };

export type WSServerMessage =
  | { type: 'room:state'; state: RoomState }
  | { type: 'playback:state'; playback: PlaybackState }
  | { type: 'pong'; clientTs: number; serverTs: number }
  | { type: 'mic:levels'; levels: Record<string, number> }
  | { type: 'chat:message'; message: ChatMessage }
  | { type: 'cheer:burst'; cheer: CheerEvent }
  | {
      type: 'rtc:signal';
      fromId: string;
      signalType: 'offer' | 'answer' | 'ice';
      payload: unknown;
    }
  | {
      type: 'voice:pcm';
      fromId: string;
      sampleRate: number;
      data: string;
    }
  | { type: 'room:kicked'; reason: string }
  | { type: 'room:not_found'; roomCode: string }
  | { type: 'error'; message: string };
