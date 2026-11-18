import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Hand,
  Headphones,
  ListMusic,
  MessageSquare,
  Mic,
  MicOff,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Send,
  Shield,
  SkipForward,
  Sliders,
  UserCheck,
  UserX,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  CheerEmoji,
  CheerEvent,
  RoomState,
  SongItem,
  WSClientMessage,
  WSServerMessage,
} from '../shared/types.ts';
import { useWakeLock } from '../hooks/useWakeLock.ts';
import { useVoiceEngine } from '../hooks/useVoiceEngine.ts';
import { YouTubeStagePlayer, YouTubeStagePlayerHandle } from './YouTubeStagePlayer.tsx';
import { Avatar } from './Avatar.tsx';
import { SongLibraryPanel } from './SongLibraryPanel.tsx';
import { ChatBottomSheet } from './ChatBottomSheet.tsx';
import { EarphoneGateModal } from './EarphoneGateModal.tsx';

interface RoomViewProps {
  roomCode: string;
  roomNameHint?: string;
  isRoomCreator?: boolean;
  participantId: string;
  displayName: string;
  avatarColor: string;
  onLeaveRoom: () => void;
}

type WorkspaceTab = 'songs' | 'chat' | 'people' | 'mix' | 'admin';

function shouldMaskAnnouncementName(name: string): boolean {
  return /roshni|roshu/i.test(name.trim());
}

export function RoomView({
  roomCode,
  roomNameHint,
  isRoomCreator = false,
  participantId,
  displayName,
  avatarColor,
  onLeaveRoom,
}: RoomViewProps) {
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [httpFallbackActive, setHttpFallbackActive] = useState(false);
  const [roomNotFound, setRoomNotFound] = useState(false);
  const [createFallback, setCreateFallback] = useState(false);
  const [dismissPreviewBanner, setDismissPreviewBanner] = useState(false);
  const [kickedReason, setKickedReason] = useState<string | null>(null);
  const [toastError, setToastError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const isPrivatePreview =
    typeof window !== 'undefined' && window.location.hostname.startsWith('ais-dev-');
  const sharedRoomUrl = isPrivatePreview
    ? `${window.location.origin.replace('://ais-dev-', '://ais-pre-')}/?room=${roomCode}`
    : null;

  // Audio & UI state
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [musicVolume, setMusicVolume] = useState(75);
  const [vocalsVolume, setVocalsVolume] = useState(95);
  const [selfMonitor, setSelfMonitor] = useState(false); // OFF by default
  const [announcementsEnabled, setAnnouncementsEnabled] = useState(true);
  const [announcementNotice, setAnnouncementNotice] = useState<string | null>(null);
  const [earphonesConfirmed, setEarphonesConfirmed] = useState(false);
  const [showEarphoneGate, setShowEarphoneGate] = useState(false);
  const [micMuted, setMicMuted] = useState(true);
  const [rttMs, setRttMs] = useState(140);

  // Navigation & chat
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('songs');
  const [unreadChat, setUnreadChat] = useState(0);
  const [quickChatDraft, setQuickChatDraft] = useState('');
  const [cheers, setCheers] = useState<CheerEvent[]>([]);
  const [audioLevels, setAudioLevels] = useState<Record<string, number>>({});
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<YouTubeStagePlayerHandle | null>(null);
  const rtcSignalHandlerRef = useRef<
    ((fromId: string, signalType: 'offer' | 'answer' | 'ice', payload: unknown) => void) | null
  >(null);
  const voicePcmHandlerRef = useRef<
    ((fromId: string, sampleRate: number, data: string) => void) | null
  >(null);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const announcementsEnabledRef = useRef(announcementsEnabled);
  announcementsEnabledRef.current = announcementsEnabled;
  const lastLocalMicToggleMsRef = useRef<number>(0);

  const { wakeLockActive, isIosSafari } = useWakeLock(true);

  const httpFallbackRef = useRef(httpFallbackActive);
  httpFallbackRef.current = httpFallbackActive;
  const lastHttpCheerMsRef = useRef<number>(Date.now());
  const prevMsgCountRef = useRef<number>(0);

  const sendWsFast = useCallback((msg: WSClientMessage | Record<string, unknown>) => {
    const sock = wsRef.current;
    if (sock && sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify(msg));
    }
  }, []);

  const sendWs = useCallback(
    (msg: WSClientMessage | Record<string, unknown>) => {
      const sock = wsRef.current;
      if (sock && sock.readyState === WebSocket.OPEN) {
        sock.send(JSON.stringify(msg));
        return;
      }
      const msgType = (msg as { type?: string }).type;
      if (msgType !== 'mic:level' && msgType !== 'ping' && msgType !== 'voice:pcm') {
        fetch(`/api/rooms/${encodeURIComponent(roomCode)}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ participantId, message: msg }),
        })
          .then(async (res) => {
            if (!res.ok) return null;
            return (await res.json()) as { state?: RoomState; error?: string };
          })
          .then((data) => {
            if (data?.state) {
              setRoomState(data.state);
              const updatedMe = data.state.participants.find((p) => p.id === participantId);
              if (updatedMe) {
                if (
                  (updatedMe.adminMuted && !updatedMe.onStage) ||
                  Date.now() - lastLocalMicToggleMsRef.current > 800
                ) {
                  setMicMuted(updatedMe.micMuted);
                }
              }
            }
            if (data?.error) {
              setToastError(data.error);
              window.setTimeout(() => setToastError(null), 4000);
            }
          })
          .catch(() => {});
      }
    },
    [roomCode, participantId]
  );

  // WebSocket lifecycle with automatic HTTP polling fallback if WS is blocked
  useEffect(() => {
    let closedByUser = false;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;
    let httpPollTimer: number | null = null;
    let fallbackCheckTimer: number | null = null;
    const allowCreate = Boolean(isRoomCreator || createFallback);

    const stopHttpFallback = () => {
      if (httpPollTimer) {
        window.clearInterval(httpPollTimer);
        httpPollTimer = null;
      }
      setHttpFallbackActive(false);
    };

    const startHttpFallback = async () => {
      if (closedByUser || httpPollTimer) return;
      try {
        const joinRes = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            participantId,
            name: displayName,
            avatarColor,
            roomName: roomNameHint,
            createIfMissing: allowCreate,
          }),
        });
        if (joinRes.status === 404) {
          setRoomNotFound(true);
          return;
        }
        if (joinRes.ok) {
          const data = (await joinRes.json()) as { state: RoomState };
          setRoomState(data.state);
          prevMsgCountRef.current = data.state.messages.length;
          setHttpFallbackActive(true);
        }
      } catch {
        return;
      }

      httpPollTimer = window.setInterval(async () => {
        if (closedByUser) return;
        try {
          const res = await fetch(
            `/api/rooms/${encodeURIComponent(roomCode)}/state?participantId=${encodeURIComponent(
              participantId
            )}&sinceMs=${lastHttpCheerMsRef.current}`
          );
          if (res.status === 404) {
            setRoomNotFound(true);
            stopHttpFallback();
            return;
          }
          if (!res.ok) return;
          const data = (await res.json()) as {
            state: RoomState;
            cheers?: CheerEvent[];
            signals?: Array<{ fromId: string; signalType: 'offer' | 'answer' | 'ice'; payload: unknown }>;
          };
          setRoomState(data.state);
          const updatedMe = data.state.participants.find((p) => p.id === participantId);
          if (updatedMe && updatedMe.adminMuted && !updatedMe.onStage) {
            setMicMuted(true);
          }
          if (activeTabRef.current !== 'chat' && data.state.messages.length > prevMsgCountRef.current) {
            const added = data.state.messages
              .slice(prevMsgCountRef.current)
              .filter((m) => m.type === 'chat').length;
            if (added > 0) setUnreadChat((c) => c + added);
          }
          prevMsgCountRef.current = data.state.messages.length;

          if (data.cheers && data.cheers.length > 0) {
            lastHttpCheerMsRef.current = Math.max(
              lastHttpCheerMsRef.current,
              ...data.cheers.map((c) => c.timestampMs)
            );
            setCheers((prev) => [...prev.slice(-10), ...data.cheers!]);
            window.setTimeout(() => {
              const ids = new Set(data.cheers!.map((c) => c.id));
              setCheers((prev) => prev.filter((c) => !ids.has(c.id)));
            }, 1700);
          }
          if (data.signals && rtcSignalHandlerRef.current) {
            for (const sig of data.signals) {
              rtcSignalHandlerRef.current(sig.fromId, sig.signalType, sig.payload);
            }
          }
        } catch {
          // retry next tick
        }
      }, 700);
    };

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      fallbackCheckTimer = window.setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN && !closedByUser) {
          startHttpFallback();
        }
      }, 2200);

      ws.onopen = () => {
        if (fallbackCheckTimer) {
          window.clearTimeout(fallbackCheckTimer);
          fallbackCheckTimer = null;
        }
        stopHttpFallback();
        setWsConnected(true);
        ws.send(
          JSON.stringify({
            type: 'room:join',
            roomCode,
            participantId,
            name: displayName,
            avatarColor,
            roomName: roomNameHint,
            createIfMissing: allowCreate,
          })
        );
        ws.send(JSON.stringify({ type: 'ping', clientTs: Date.now() }));
        pingTimer = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', clientTs: Date.now() }));
          }
        }, 5000);
      };

      ws.onmessage = (event) => {
        let msg: WSServerMessage;
        try {
          msg = JSON.parse(event.data) as WSServerMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case 'room:state': {
            setRoomNotFound(false);
            setRoomState(msg.state);
            prevMsgCountRef.current = msg.state.messages.length;
            const me = msg.state.participants.find((p) => p.id === participantId);
            if (me) {
              if (
                (me.adminMuted && !me.onStage) ||
                Date.now() - lastLocalMicToggleMsRef.current > 800
              ) {
                setMicMuted(me.micMuted);
              }
            }
            break;
          }
          case 'room:not_found': {
            setRoomNotFound(true);
            closedByUser = true;
            ws.close();
            break;
          }
          case 'playback:state': {
            setRoomState((prev) => (prev ? { ...prev, playback: msg.playback } : prev));
            break;
          }
          case 'pong': {
            const sample = Math.max(20, Date.now() - msg.clientTs);
            setRttMs((prev) => Math.round(prev * 0.65 + sample * 0.35));
            break;
          }
          case 'mic:levels': {
            setAudioLevels((prev) => ({ ...prev, ...msg.levels }));
            break;
          }
          case 'chat:message': {
            setRoomState((prev) => {
              if (!prev) return prev;
              if (prev.messages.some((m) => m.id === msg.message.id)) return prev;
              return {
                ...prev,
                messages: [...prev.messages.slice(-99), msg.message],
              };
            });
            if (activeTabRef.current !== 'chat' && msg.message.type === 'chat') {
              setUnreadChat((c) => c + 1);
            }
            break;
          }
          case 'cheer:burst': {
            setCheers((prev) => [...prev.slice(-10), msg.cheer]);
            window.setTimeout(() => {
              setCheers((prev) => prev.filter((c) => c.id !== msg.cheer.id));
            }, 1700);
            break;
          }
          case 'rtc:signal': {
            if (rtcSignalHandlerRef.current) {
              rtcSignalHandlerRef.current(msg.fromId, msg.signalType, msg.payload);
            }
            break;
          }
          case 'voice:pcm': {
            if (voicePcmHandlerRef.current) {
              voicePcmHandlerRef.current(msg.fromId, msg.sampleRate, msg.data);
            }
            break;
          }
          case 'room:kicked': {
            setKickedReason(msg.reason);
            closedByUser = true;
            break;
          }
          case 'error': {
            setToastError(msg.message);
            window.setTimeout(() => setToastError(null), 4000);
            break;
          }
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (pingTimer) {
          window.clearInterval(pingTimer);
          pingTimer = null;
        }
        if (!closedByUser) {
          startHttpFallback();
          reconnectTimer = window.setTimeout(connect, 2500);
        }
      };
    };

    connect();

    return () => {
      closedByUser = true;
      if (fallbackCheckTimer) window.clearTimeout(fallbackCheckTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (pingTimer) window.clearInterval(pingTimer);
      stopHttpFallback();
      wsRef.current?.close();
    };
  }, [roomCode, participantId, displayName, avatarColor, roomNameHint, isRoomCreator, createFallback]);

  const me = useMemo(
    () => roomState?.participants.find((p) => p.id === participantId) || null,
    [roomState, participantId]
  );

  const isAdmin = roomState?.adminId === participantId;
  const isSinger = Boolean(roomState?.activeSingerIds.includes(participantId));
  const isController = isAdmin || isSinger;
  const isMicDisallowed = Boolean(me && me.adminMuted && !isSinger);
  const shouldTransmitMic = Boolean(
    me &&
      !micMuted &&
      !isMicDisallowed &&
      (!isSinger || earphonesConfirmed)
  );

  // Latency compensation: one-way voice latency in seconds
  const voiceLatencySec = useMemo(
    () => Number(Math.min(0.45, Math.max(0.06, rttMs / 2000 + 0.08)).toFixed(3)),
    [rttMs]
  );

  const voice = useVoiceEngine({
    roomCode,
    participantId,
    participantName: displayName,
    participants: roomState?.participants || [],
    activeSingerIds: roomState?.activeSingerIds || [],
    isSinger,
    shouldTransmitMic,
    vocalsVolume,
    selfMonitor,
    audioUnlocked,
    sendWs,
    sendWsFast,
    onSignalRef: rtcSignalHandlerRef,
    onVoicePcmRef: voicePcmHandlerRef,
  });

  // Only when transitioning ONTO stage (false -> true), open EarphoneGate or unmute once
  const prevIsSingerRef = useRef(false);
  useEffect(() => {
    const justEnteredStage = isSinger && !prevIsSingerRef.current;
    prevIsSingerRef.current = isSinger;
    if (!justEnteredStage) return;

    if (!earphonesConfirmed) {
      setShowEarphoneGate(true);
      return;
    }
    voice.ensureMicrophone(true).then((stream) => {
      if (!stream) return;
      lastLocalMicToggleMsRef.current = Date.now();
      setMicMuted(false);
      sendWs({
        type: 'mic:state',
        micMuted: false,
        earphonesConfirmed: true,
        voiceStatus: 'active',
      });
    });
  }, [isSinger, earphonesConfirmed, voice, sendWs]);

  // Spoken & visual announcements when someone enters the room or takes stage mic
  // Never announces the name if it is "roshni" or "roshu"
  const announcementInitRef = useRef(false);
  const prevParticipantIdsRef = useRef<Set<string>>(new Set());
  const prevActiveSingersRef = useRef<Set<string>>(new Set());
  const announcementTimerRef = useRef<number | null>(null);

  const triggerAnnouncement = useCallback((spokenText: string) => {
    if (!announcementsEnabledRef.current) return;
    setAnnouncementNotice(spokenText);
    if (announcementTimerRef.current) {
      window.clearTimeout(announcementTimerRef.current);
    }
    announcementTimerRef.current = window.setTimeout(() => {
      setAnnouncementNotice(null);
    }, 3500);

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        const utter = new SpeechSynthesisUtterance(spokenText);
        utter.lang = 'en-IN';
        utter.rate = 1.02;
        utter.pitch = 1.0;
        utter.volume = 0.85;
        window.speechSynthesis.speak(utter);
      } catch {
        // Ignore if browser blocks speech synthesis before user tap
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      if (announcementTimerRef.current) {
        window.clearTimeout(announcementTimerRef.current);
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  useEffect(() => {
    if (!roomState) return;
    const currentParticipantIds = new Set(roomState.participants.map((p) => p.id));
    const currentSingers = new Set(roomState.activeSingerIds);

    if (!announcementInitRef.current) {
      announcementInitRef.current = true;
      prevParticipantIdsRef.current = currentParticipantIds;
      prevActiveSingersRef.current = currentSingers;
      return;
    }

    for (const p of roomState.participants) {
      if (!prevParticipantIdsRef.current.has(p.id) && p.id !== participantId) {
        const masked = shouldMaskAnnouncementName(p.name);
        triggerAnnouncement(masked ? 'Someone joined the room' : `${p.name} joined the room`);
      }
    }

    for (const singerId of roomState.activeSingerIds) {
      if (!prevActiveSingersRef.current.has(singerId)) {
        const singer = roomState.participants.find((p) => p.id === singerId);
        if (singer) {
          const masked = shouldMaskAnnouncementName(singer.name);
          triggerAnnouncement(
            masked ? 'Someone took the mic on stage' : `${singer.name} took the mic on stage`
          );
        }
      }
    }

    prevParticipantIdsRef.current = currentParticipantIds;
    prevActiveSingersRef.current = currentSingers;
  }, [roomState, participantId, triggerAnnouncement]);

  const activeSingers = useMemo(
    () =>
      (roomState?.participants || []).filter((p) =>
        roomState?.activeSingerIds.includes(p.id)
      ),
    [roomState]
  );

  const raisedHands = useMemo(
    () => (roomState?.participants || []).filter((p) => p.handRaised && !p.onStage),
    [roomState]
  );

  const handleCopyShareLink = async () => {
    const shareUrl = `${window.location.origin}/?room=${roomCode}`;
    const isPrivatePreview = window.location.hostname.startsWith('ais-dev-');
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2000);
      if (isPrivatePreview) {
        setToastError(
          'Copied preview link. Note: ais-dev URLs only work in your own session — publish via Share and use the Shared App URL for other devices.'
        );
        window.setTimeout(() => setToastError(null), 6000);
      }
    } catch {
      setToastError(`Share code: ${roomCode}`);
    }
  };

  const handleConfirmEarphones = async () => {
    setShowEarphoneGate(false);
    setAudioUnlocked(true);
    const stream = await voice.ensureMicrophone(true);
    if (!stream) {
      setToastError(
        'Microphone permission is blocked by your browser — allow mic access and tap Retry Mic.'
      );
      window.setTimeout(() => setToastError(null), 5000);
      return;
    }
    lastLocalMicToggleMsRef.current = Date.now();
    setEarphonesConfirmed(true);
    setMicMuted(false);
    sendWs({
      type: 'stage:take',
      earphonesConfirmed: true,
    });
  };

  const handleMicOrStageButton = async () => {
    setAudioUnlocked(true);
    voice.markActivity();

    if (voice.idleDisconnected) {
      voice.rejoinVoice();
      return;
    }

    // If disallowed by host (or audience muted), toggle a mic request to the host
    if (isMicDisallowed) {
      sendWs({ type: 'mic:handRaise', raised: !me?.handRaised });
      return;
    }

    // Lead stage singer must keep earphones confirmed
    if (isSinger && !earphonesConfirmed) {
      setShowEarphoneGate(true);
      return;
    }

    const nextMuted = !micMuted;
    if (!nextMuted) {
      const stream = await voice.ensureMicrophone(isSinger);
      if (!stream) {
        setToastError(
          'Allow Microphone in browser site settings (or open in a full browser tab), then tap Retry Mic.'
        );
        window.setTimeout(() => setToastError(null), 5000);
        return;
      }
    }
    lastLocalMicToggleMsRef.current = Date.now();
    setMicMuted(nextMuted);
    sendWs({
      type: 'mic:state',
      micMuted: nextMuted,
      earphonesConfirmed,
      voiceStatus: 'active',
    });
  };

  const handleSeekTo = useCallback(
    (targetSec: number) => {
      if (!isController) return;
      const maxDur = durationSec > 0 ? durationSec : roomState?.playback.currentSong?.durationSec || 600;
      const clamped = Math.max(0, Math.min(maxDur, Math.round(targetSec)));
      setAudioUnlocked(true);
      setCurrentTimeSec(clamped);
      playerRef.current?.seekTo(clamped);
      sendWs({ type: 'playback:seek', positionSec: clamped });
    },
    [isController, durationSec, roomState?.playback.currentSong?.durationSec, sendWs]
  );

  const handleControllerAction = useCallback(
    (action: 'play' | 'pause' | 'seek' | 'ended', positionSec: number) => {
      if (action === 'play') sendWs({ type: 'playback:play', positionSec });
      if (action === 'pause') sendWs({ type: 'playback:pause', positionSec });
      if (action === 'seek') sendWs({ type: 'playback:seek', positionSec });
      if (action === 'ended' && roomState?.playback.currentSong) {
        sendWs({
          type: 'playback:ended',
          videoId: roomState.playback.currentSong.videoId,
        });
      }
    },
    [roomState?.playback.currentSong, sendWs]
  );

  const formatTrackTime = (sec: number) => {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${String(rem).padStart(2, '0')}`;
  };

  const recentChatMessages = useMemo(
    () => (roomState?.messages || []).filter((m) => m.type === 'chat').slice(-2),
    [roomState?.messages]
  );

  const totalChatCount = useMemo(
    () => (roomState?.messages || []).filter((m) => m.type === 'chat').length,
    [roomState?.messages]
  );

  const handleSendQuickChat = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = quickChatDraft.trim();
    if (!trimmed) return;
    sendWs({ type: 'chat:send', text: trimmed });
    setQuickChatDraft('');
  };

  if (roomNotFound) {
    return (
      <div className="min-h-dvh bg-[#0B0D12] text-white flex items-center justify-center p-6">
        <div className="max-w-sm w-full bg-[#141720] border border-white/10 rounded-3xl p-6 text-center space-y-4">
          <h2 className="font-display text-xl font-bold">Room {roomCode} Not Found</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            This room isn&apos;t active on this URL. Make sure both you and the host opened the same{' '}
            <strong>Shared App URL</strong> (not the private <code>ais-dev</code> preview).
          </p>
          <div className="space-y-2.5 pt-1">
            <button
              type="button"
              onClick={() => {
                setCreateFallback(true);
                setRoomNotFound(false);
              }}
              className="w-full min-h-[46px] rounded-xl bg-[#FF5A36] hover:bg-[#ff6d4d] text-white font-semibold text-sm transition-colors"
            >
              Start Room {roomCode} Here
            </button>
            <button
              type="button"
              onClick={onLeaveRoom}
              className="w-full min-h-[46px] rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 font-semibold text-sm transition-colors"
            >
              Back to Lobby
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (kickedReason) {
    return (
      <div className="min-h-dvh bg-[#0B0D12] text-white flex items-center justify-center p-6">
        <div className="max-w-sm w-full bg-[#141720] border border-white/10 rounded-3xl p-6 text-center space-y-4">
          <h2 className="font-display text-xl font-bold">Removed from Room</h2>
          <p className="text-sm text-slate-300">{kickedReason}</p>
          <button
            type="button"
            onClick={onLeaveRoom}
            className="w-full min-h-[46px] rounded-xl bg-[#FF5A36] text-white font-semibold text-sm"
          >
            Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#0B0D12] text-[#F4F5F8] flex flex-col">
      {isPrivatePreview && sharedRoomUrl && !dismissPreviewBanner && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 px-3 sm:px-6 py-2 flex items-center justify-between gap-3 text-xs text-amber-200">
          <p className="min-w-0">
            <strong>Private Preview (ais-dev):</strong> Friends on other devices cannot join here.{' '}
            <a
              href={sharedRoomUrl.replace(`/?room=${roomCode}`, '')}
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-300"
            >
              Open Shared App URL ↗
            </a>
          </p>
          <button
            type="button"
            onClick={() => setDismissPreviewBanner(true)}
            className="text-amber-300 hover:text-white shrink-0 px-1.5"
            aria-label="Dismiss preview notice"
          >
            ✕
          </button>
        </div>
      )}

      {/* Compact Sticky Mobile Top Bar (52px) */}
      <header className="sticky top-0 z-30 h-[52px] bg-[#0B0D12]/95 backdrop-blur-md border-b border-white/10 px-3 sm:px-6 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onLeaveRoom}
            className="min-w-[40px] min-h-[40px] rounded-xl hover:bg-white/10 flex items-center justify-center text-slate-300 shrink-0"
            aria-label="Leave room"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="font-display text-sm sm:text-base font-semibold text-white truncate">
              {roomState?.name || roomNameHint || `Room ${roomCode}`}
            </h1>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <span className="font-mono-tabular">
                {roomState?.participants.length || 1}/20
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular">{Math.round(voiceLatencySec * 1000)}ms</span>
              {!wsConnected && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className={httpFallbackActive ? 'text-emerald-400' : 'text-amber-400'}>
                    {httpFallbackActive ? 'Synced' : 'Connecting'}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setAudioUnlocked(true);
              playerRef.current?.resyncNow();
            }}
            className="min-h-[38px] px-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-200 flex items-center gap-1.5 whitespace-nowrap"
            title="Resync beat to singer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Resync</span>
          </button>

          <button
            type="button"
            onClick={handleCopyShareLink}
            className="min-h-[38px] px-3 rounded-xl bg-[#FF5A36]/15 hover:bg-[#FF5A36]/25 border border-[#FF5A36]/30 text-xs font-mono-tabular font-semibold text-[#FF5A36] flex items-center gap-1.5 whitespace-nowrap"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedLink ? 'Copied' : roomCode}</span>
          </button>
        </div>
      </header>

      {/* Main Studio Layout: Mobile Portrait Single Column -> Desktop 12-Col Grid */}
      <div className="flex-1 max-w-7xl w-full mx-auto lg:grid lg:grid-cols-12 lg:gap-6 lg:p-6 pb-20 lg:pb-6">
        {/* Left/Center Column: Unobstructed Player + Stage Controls + Workspace */}
        <div className="lg:col-span-8 flex flex-col min-w-0">
          {/* Official YouTube Player (Never hidden, overlaid, or restyled) */}
          <div className="lg:rounded-2xl overflow-hidden border-b lg:border border-white/10 bg-black">
            {roomState ? (
              <YouTubeStagePlayer
                ref={playerRef}
                playback={roomState.playback}
                musicVolume={musicVolume}
                isController={isController}
                isSinger={isSinger}
                voiceLatencySec={voiceLatencySec}
                audioUnlocked={audioUnlocked}
                onUnlockAudio={() => setAudioUnlocked(true)}
                onControllerAction={handleControllerAction}
                onTimeUpdate={(cur, dur) => {
                  setCurrentTimeSec(cur);
                  if (dur > 0) setDurationSec(dur);
                }}
              />
            ) : (
              <div className="w-full min-h-[210px] aspect-video max-h-[36vh] bg-black flex items-center justify-center text-xs text-slate-400">
                Connecting to stage...
              </div>
            )}
          </div>

          {/* Dedicated Stage Strip & Floating Cheers Zone (strictly below the iframe) */}
          <div className="relative bg-[#141720] border-b lg:border lg:rounded-2xl lg:mt-3 border-white/10 px-3.5 py-3 space-y-2.5">
            {/* Floating cheers lane (above text, never over the YouTube iframe) */}
            {cheers.length > 0 && (
              <div className="pointer-events-none absolute -top-9 right-4 flex items-center gap-2 overflow-visible">
                {cheers.map((c) => (
                  <div
                    key={c.id}
                    className="animate-float-cheer flex items-center gap-1 bg-[#1A1E29]/90 border border-white/15 rounded-full px-2.5 py-1 text-sm shadow-lg"
                  >
                    <span>{c.emoji}</span>
                    <span className="text-[10px] text-slate-300 font-medium">{c.senderName}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Mobile Autoplay Tap Unlock Banner */}
            {!audioUnlocked && (
              <button
                type="button"
                onClick={() => {
                  setAudioUnlocked(true);
                  playerRef.current?.resyncNow();
                }}
                className="w-full min-h-[44px] px-4 rounded-xl bg-[#FF5A36] hover:bg-[#ff6d4d] text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <Volume2 className="w-4 h-4" />
                <span>Tap to Start Audio &amp; Sync Beat</span>
              </button>
            )}

            {/* Idle 10-Min Auto-Disconnect Recovery */}
            {voice.idleDisconnected && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between gap-3">
                <p className="text-xs text-amber-200">
                  Voice paused after 10 min of idle. Music &amp; chat remain live.
                </p>
                <button
                  type="button"
                  onClick={voice.rejoinVoice}
                  className="min-h-[38px] px-3 rounded-lg bg-amber-500 text-black text-xs font-semibold whitespace-nowrap shrink-0"
                >
                  Rejoin Voice
                </button>
              </div>
            )}

            {/* Listen-Only / Mic Permission Recovery Banner */}
            {(voice.permissionState === 'denied' || voice.micError) && (
              <div className="px-3 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs text-rose-200 min-w-0 flex-1">
                  {voice.micError || 'Mic permission is blocked — allow Microphone and retry.'}
                </p>
                <div className="flex items-center gap-1.5 shrink-0">
                  {typeof window !== 'undefined' && window.self !== window.top && (
                    <a
                      href={window.location.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[32px] px-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white flex items-center whitespace-nowrap"
                    >
                      Open Tab ↗
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      setAudioUnlocked(true);
                      const stream = await voice.ensureMicrophone(isSinger);
                      if (stream && !isMicDisallowed) {
                        lastLocalMicToggleMsRef.current = Date.now();
                        setMicMuted(false);
                        sendWs({
                          type: 'mic:state',
                          micMuted: false,
                          earphonesConfirmed,
                          voiceStatus: 'active',
                        });
                      }
                    }}
                    className="min-h-[32px] px-3 rounded-lg bg-[#FF5A36] hover:bg-[#ff6d4d] text-xs font-semibold text-white whitespace-nowrap"
                  >
                    Retry Mic
                  </button>
                </div>
              </div>
            )}

            {/* Host Mic Requests Banner (when listeners ask to speak) */}
            {isAdmin && raisedHands.length > 0 && (
              <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/35 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-200">
                    <Hand className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>
                      {raisedHands.length === 1
                        ? `${raisedHands[0].name} is requesting mic access`
                        : `${raisedHands.length} people are requesting mic access`}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => sendWs({ type: 'admin:muteAllOthers', muted: false })}
                    className="min-h-[32px] px-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-semibold whitespace-nowrap"
                  >
                    Allow All Mics
                  </button>
                </div>

                <div className="flex flex-col gap-1.5">
                  {raisedHands.map((reqUser) => (
                    <div
                      key={reqUser.id}
                      className="flex items-center justify-between gap-2 bg-[#0B0D12]/60 rounded-lg px-2.5 py-1.5"
                    >
                      <span className="text-xs font-medium text-white truncate">
                        {reqUser.name}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            sendWs({
                              type: 'admin:muteParticipant',
                              targetId: reqUser.id,
                              muted: false,
                            })
                          }
                          className="min-h-[30px] px-2.5 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold"
                        >
                          Allow Mic
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            sendWs({ type: 'stage:pass', targetParticipantId: reqUser.id })
                          }
                          className="min-h-[30px] px-2.5 rounded-md bg-[#FF5A36]/20 hover:bg-[#FF5A36]/30 text-[#FF5A36] text-[11px] font-semibold"
                        >
                          Pass Stage
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            sendWs({
                              type: 'admin:muteParticipant',
                              targetId: reqUser.id,
                              muted: true,
                            })
                          }
                          className="min-h-[30px] px-2 rounded-md bg-white/5 hover:bg-white/10 text-slate-400 text-[11px]"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Audience Muted / Host-Disallowed Mic Banner */}
            {(roomState?.audienceMuted || isMicDisallowed) && (
              <div className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-amber-200 min-w-0">
                  <VolumeX className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="truncate">
                    {isAdmin
                      ? 'Audience mics muted — only host & stage are heard'
                      : isMicDisallowed
                        ? 'Your mic is disabled by host'
                        : 'Room mics are open for you'}
                  </span>
                </div>
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => sendWs({ type: 'admin:muteAllOthers', muted: false })}
                    className="min-h-[34px] px-3 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-200 text-xs font-semibold whitespace-nowrap shrink-0"
                  >
                    Allow All Mics
                  </button>
                ) : isMicDisallowed ? (
                  <button
                    type="button"
                    onClick={() => sendWs({ type: 'mic:handRaise', raised: !me?.handRaised })}
                    className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                      me?.handRaised
                        ? 'bg-[#FF5A36] text-white'
                        : 'bg-amber-500 text-black hover:bg-amber-400'
                    }`}
                  >
                    <Hand className="w-3.5 h-3.5" />
                    <span>{me?.handRaised ? 'Mic Requested' : 'Request Mic'}</span>
                  </button>
                ) : null}
              </div>
            )}

            {/* Song Info + Cheers Row */}
            <div className="flex items-center justify-between gap-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white truncate">
                  {roomState?.playback.currentSong?.title || 'Pick a song to begin'}
                </p>
                <p className="text-xs text-slate-400 truncate">
                  {roomState?.playback.currentSong?.artist || 'Curated library ready'}
                  {roomState?.duetMode ? ' · Duet Stage' : ''}
                </p>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {(['👏', '🔥', '❤️'] as CheerEmoji[]).map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => sendWs({ type: 'cheer:send', emoji })}
                    className="min-w-[38px] min-h-[38px] rounded-xl bg-white/5 hover:bg-white/10 text-base flex items-center justify-center active:scale-90 transition-transform"
                    aria-label={`Cheer ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            {/* Synced Playback Transport & Timeline Scrubber */}
            {roomState?.playback.currentSong && (
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center gap-2">
                  {isController && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleSeekTo(currentTimeSec - 10)}
                        className="min-w-[36px] min-h-[36px] px-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 flex items-center justify-center gap-0.5 text-[11px] font-semibold"
                        title="Rewind 10 seconds for everyone"
                        aria-label="Rewind 10 seconds"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>10</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setAudioUnlocked(true);
                          const pos =
                            playerRef.current?.getCurrentTime() || roomState.playback.positionSec;
                          sendWs({
                            type: roomState.playback.isPlaying ? 'playback:pause' : 'playback:play',
                            positionSec: pos,
                          });
                        }}
                        className="min-w-[38px] min-h-[36px] rounded-lg bg-[#FF5A36] hover:bg-[#ff6d4d] text-white flex items-center justify-center transition-colors"
                        aria-label={roomState.playback.isPlaying ? 'Pause' : 'Play'}
                      >
                        {roomState.playback.isPlaying ? (
                          <Pause className="w-4 h-4" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSeekTo(currentTimeSec + 10)}
                        className="min-w-[36px] min-h-[36px] px-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 flex items-center justify-center gap-0.5 text-[11px] font-semibold"
                        title="Forward 10 seconds for everyone"
                        aria-label="Forward 10 seconds"
                      >
                        <span>10</span>
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => sendWs({ type: 'queue:skip' })}
                        className="min-w-[36px] min-h-[36px] rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 flex items-center justify-center transition-colors"
                        aria-label="Skip song"
                        title="Skip to next song"
                      >
                        <SkipForward className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  <div className="flex-1 flex items-center gap-2 min-w-0">
                    <span className="text-[11px] font-mono-tabular text-slate-400 w-9 text-right shrink-0">
                      {formatTrackTime(currentTimeSec)}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(
                        1,
                        Math.round(
                          durationSec > 0
                            ? durationSec
                            : roomState.playback.currentSong.durationSec || 300
                        )
                      )}
                      value={Math.min(
                        Math.round(currentTimeSec),
                        Math.max(
                          1,
                          Math.round(
                            durationSec > 0
                              ? durationSec
                              : roomState.playback.currentSong.durationSec || 300
                          )
                        )
                      )}
                      disabled={!isController}
                      onChange={(e) => handleSeekTo(Number(e.target.value))}
                      aria-label="Song progress"
                      className={`w-full h-1.5 rounded-lg accent-[#FF5A36] ${
                        isController ? 'cursor-pointer bg-white/15' : 'cursor-default bg-white/10 opacity-75'
                      }`}
                    />
                    <span className="text-[11px] font-mono-tabular text-slate-400 w-9 shrink-0">
                      {formatTrackTime(
                        durationSec > 0
                          ? durationSec
                          : roomState.playback.currentSong.durationSec || 0
                      )}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Active Singer Spotlight + Room Mic Row */}
            <div className="pt-2 border-t border-white/5 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {activeSingers.length === 0 ? (
                  <span className="text-xs text-slate-400">
                    {roomState?.audienceMuted
                      ? 'Stage open — grab earphones to sing'
                      : 'Room mics open (Google Meet style) — tap Mic to talk'}
                  </span>
                ) : (
                  <div className="flex items-center gap-3 flex-wrap">
                    {activeSingers.map((singer) => {
                      const lvl =
                        singer.id === participantId
                          ? voice.localAudioLevel
                          : audioLevels[singer.id] ?? singer.audioLevel;
                      return (
                        <div key={singer.id} className="flex items-center gap-2 min-w-0">
                          <Avatar
                            name={singer.name}
                            color={singer.avatarColor}
                            size="sm"
                            onStage
                            audioLevel={lvl}
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-white truncate max-w-[120px]">
                              {singer.name}
                            </p>
                            {/* Live audio-level meter */}
                            <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden mt-0.5">
                              <div
                                className="h-full bg-[#FF5A36] transition-all duration-100"
                                style={{ width: `${Math.max(8, lvl)}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* Google-Meet-style Mic / Request Mic pill */}
                <button
                  type="button"
                  onClick={handleMicOrStageButton}
                  className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                    isMicDisallowed
                      ? me?.handRaised
                        ? 'bg-amber-500 text-black'
                        : 'bg-white/10 hover:bg-white/15 text-amber-300 border border-amber-500/30'
                      : shouldTransmitMic
                        ? 'bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300'
                        : 'bg-white/10 hover:bg-white/15 text-slate-200'
                  }`}
                >
                  {isMicDisallowed ? (
                    <>
                      <Hand className="w-3.5 h-3.5" />
                      <span>{me?.handRaised ? 'Mic Requested' : 'Request Mic'}</span>
                    </>
                  ) : shouldTransmitMic ? (
                    <>
                      <Mic className="w-3.5 h-3.5" />
                      <span>Mic Live</span>
                    </>
                  ) : (
                    <>
                      <MicOff className="w-3.5 h-3.5" />
                      <span>Unmute Mic</span>
                    </>
                  )}
                </button>

                {isSinger ? (
                  <button
                    type="button"
                    onClick={() => sendWs({ type: 'stage:release' })}
                    className="min-h-[38px] px-3 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white whitespace-nowrap"
                  >
                    Pass Stage
                  </button>
                ) : (roomState?.activeSingerIds.length || 0) < (roomState?.duetMode ? 2 : 1) ? (
                  <button
                    type="button"
                    onClick={() => {
                      setAudioUnlocked(true);
                      if (earphonesConfirmed) {
                        handleConfirmEarphones();
                      } else {
                        setShowEarphoneGate(true);
                      }
                    }}
                    className="min-h-[38px] px-3 rounded-xl bg-[#FF5A36] hover:bg-[#ff6d4d] text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Mic className="w-3.5 h-3.5" />
                    <span>Take Stage</span>
                  </button>
                ) : isAdmin ? (
                  <button
                    type="button"
                    onClick={() => {
                      setAudioUnlocked(true);
                      if (earphonesConfirmed) {
                        handleConfirmEarphones();
                      } else {
                        setShowEarphoneGate(true);
                      }
                    }}
                    className="min-h-[38px] px-3 rounded-xl bg-[#FF5A36] hover:bg-[#ff6d4d] text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Mic className="w-3.5 h-3.5" />
                    <span>Take Stage Back</span>
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {/* Mobile Always-Visible Live Chat Strip (immediately below Stage Strip, never hidden in a modal) */}
          {activeTab !== 'chat' && (
            <div className="lg:hidden bg-[#11141C] border-b border-white/10 px-3.5 py-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <MessageSquare className="w-3.5 h-3.5 text-[#FF5A36]" />
                  <span>Live Chat</span>
                  {unreadChat > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full bg-[#FF5A36] text-[10px] font-bold text-white leading-none">
                      {unreadChat} new
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('chat');
                    setUnreadChat(0);
                  }}
                  className="text-xs font-semibold text-[#FF5A36] hover:text-[#ff7a5c] px-2 py-1 rounded-lg bg-[#FF5A36]/10"
                >
                  Open Full Chat ({totalChatCount})
                </button>
              </div>

              {recentChatMessages.length > 0 ? (
                <div className="space-y-1">
                  {recentChatMessages.map((m) => (
                    <p key={m.id} className="text-xs text-slate-200 truncate">
                      <span className="font-semibold text-white mr-1.5">{m.senderName}:</span>
                      <span className="text-slate-300">{m.text}</span>
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-slate-500">
                  Chat is live right here — say hi while someone sings.
                </p>
              )}

              <form onSubmit={handleSendQuickChat} className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={400}
                  value={quickChatDraft}
                  onChange={(e) => setQuickChatDraft(e.target.value)}
                  placeholder="Say something to the room..."
                  className="flex-1 min-h-[38px] px-3 rounded-xl bg-[#0B0D12] border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#FF5A36]"
                />
                <button
                  type="submit"
                  disabled={!quickChatDraft.trim()}
                  className="min-w-[38px] min-h-[38px] px-3 rounded-xl bg-[#FF5A36] hover:bg-[#ff6d4d] disabled:opacity-40 text-white flex items-center justify-center transition-colors shrink-0"
                  aria-label="Send quick chat message"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          )}

          {/* Desktop Workspace Tabs */}
          <div className="hidden lg:flex items-center gap-2 mt-4">
            {(
              [
                { id: 'songs', label: 'Songs & Queue', icon: ListMusic },
                {
                  id: 'people',
                  label: `Participants (${roomState?.participants.length || 0})`,
                  icon: Users,
                },
                { id: 'mix', label: 'Audio Mix', icon: Sliders },
                ...(isAdmin ? [{ id: 'admin' as const, label: 'Admin Stage', icon: Shield }] : []),
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`min-h-[42px] px-4 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'bg-[#1F2433] text-white border border-white/15'
                      : 'bg-[#141720] text-slate-400 hover:text-white border border-white/5'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Active Workspace Content */}
          <div className="p-3.5 sm:p-4 lg:px-0 lg:pt-4 flex-1">
            {activeTab === 'chat' && (
              <div className="h-[52dvh] min-h-[300px]">
                <ChatBottomSheet
                  open
                  desktopEmbedded
                  onClose={() => setActiveTab('songs')}
                  messages={roomState?.messages || []}
                  onSendMessage={(text) => sendWs({ type: 'chat:send', text })}
                  onSendCheer={(emoji) => sendWs({ type: 'cheer:send', emoji })}
                />
              </div>
            )}
            {activeTab === 'songs' && (
              <SongLibraryPanel
                queue={roomState?.queue || []}
                currentSong={roomState?.playback.currentSong || null}
                isPlaying={Boolean(roomState?.playback.isPlaying)}
                isAdmin={Boolean(isAdmin)}
                isController={isController}
                participantId={participantId}
                onAddToQueue={(song: SongItem) => sendWs({ type: 'queue:add', song })}
                onPlayNow={(song: SongItem) => {
                  setAudioUnlocked(true);
                  sendWs({ type: 'playback:loadSong', song });
                }}
                onRemoveQueueItem={(itemId) => sendWs({ type: 'queue:remove', itemId })}
                onReorderQueue={(itemId, direction) =>
                  sendWs({ type: 'queue:reorder', itemId, direction })
                }
                onSkipCurrent={() => sendWs({ type: 'queue:skip' })}
              />
            )}

            {activeTab === 'people' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 px-1 flex-wrap">
                  <div>
                    <h2 className="font-display text-sm font-semibold text-white">
                      In the Room ({roomState?.participants.length || 0}/20)
                    </h2>
                    <p className="text-[11px] text-slate-400">
                      {roomState?.audienceMuted
                        ? 'Room mics locked — stage & allowed speakers only'
                        : 'Room mics open to all (Google Meet style)'}
                    </p>
                  </div>

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() =>
                        sendWs({
                          type: 'admin:muteAllOthers',
                          muted: !roomState?.audienceMuted,
                        })
                      }
                      className={`min-h-[34px] px-3 rounded-xl text-xs font-semibold transition-colors ${
                        roomState?.audienceMuted
                          ? 'bg-emerald-500 text-black hover:bg-emerald-400'
                          : 'bg-amber-500/20 text-amber-200 border border-amber-500/30 hover:bg-amber-500/30'
                      }`}
                    >
                      {roomState?.audienceMuted ? 'Allow All Mics' : 'Mute All Others'}
                    </button>
                  )}
                </div>

                <div className="divide-y divide-white/5 border border-white/10 rounded-2xl bg-[#141720] overflow-hidden">
                  {(roomState?.participants || []).map((p) => {
                    const lvl =
                      p.id === participantId
                        ? voice.localAudioLevel
                        : audioLevels[p.id] ?? p.audioLevel;
                    return (
                      <div
                        key={p.id}
                        className="px-3.5 py-3 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <Avatar
                            name={p.name}
                            color={p.avatarColor}
                            onStage={p.onStage}
                            audioLevel={lvl}
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white truncate">
                              {p.name}
                              {p.id === participantId ? ' (You)' : ''}
                            </p>
                            <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5 flex-wrap">
                              <span>{p.isAdmin ? 'Host' : p.onStage ? 'On Stage' : 'Member'}</span>
                              {p.handRaised && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-amber-300 font-medium">Asking for mic</span>
                                </>
                              )}
                              {p.adminMuted && !p.onStage ? (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-rose-400">Mic disallowed</span>
                                </>
                              ) : !p.micMuted ? (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-emerald-400 font-medium">Mic live</span>
                                </>
                              ) : (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-slate-500">Mic off</span>
                                </>
                              )}
                              {p.voiceStatus === 'listen-only' && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-slate-500">Listen-only</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {isAdmin && p.id === participantId && !p.onStage && (
                          <button
                            type="button"
                            onClick={() => {
                              setAudioUnlocked(true);
                              if (earphonesConfirmed) {
                                handleConfirmEarphones();
                              } else {
                                setShowEarphoneGate(true);
                              }
                            }}
                            className="min-h-[36px] px-2.5 rounded-lg bg-[#FF5A36] hover:bg-[#ff6d4d] text-white text-xs font-semibold whitespace-nowrap shrink-0"
                          >
                            Take Stage Back
                          </button>
                        )}

                        {isAdmin && p.id !== participantId && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            {p.onStage ? (
                              <button
                                type="button"
                                onClick={() =>
                                  sendWs({ type: 'stage:release', targetParticipantId: p.id })
                                }
                                className="min-h-[36px] px-2.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-semibold whitespace-nowrap"
                              >
                                Off Stage
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  sendWs({ type: 'stage:pass', targetParticipantId: p.id })
                                }
                                className="min-h-[36px] px-2.5 rounded-lg bg-[#FF5A36]/15 hover:bg-[#FF5A36]/25 text-[#FF5A36] text-xs font-semibold whitespace-nowrap"
                              >
                                Stage
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                sendWs({
                                  type: 'admin:muteParticipant',
                                  targetId: p.id,
                                  muted: !p.adminMuted,
                                })
                              }
                              className={`min-h-[36px] px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1 whitespace-nowrap ${
                                p.adminMuted
                                  ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-white/5 hover:bg-white/10 text-slate-300'
                              }`}
                              title={
                                p.adminMuted ? 'Allow mic for this user' : 'Disallow mic for this user'
                              }
                            >
                              {p.adminMuted ? (
                                <>
                                  <Mic className="w-3.5 h-3.5" />
                                  <span>Allow</span>
                                </>
                              ) : (
                                <>
                                  <MicOff className="w-3.5 h-3.5 text-rose-400" />
                                  <span className="hidden sm:inline">Disallow</span>
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => sendWs({ type: 'admin:transferAdmin', targetId: p.id })}
                              className="min-w-[36px] min-h-[36px] rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 flex items-center justify-center"
                              title="Make room host"
                            >
                              <UserCheck className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => sendWs({ type: 'admin:kick', targetId: p.id })}
                              className="min-w-[36px] min-h-[36px] rounded-lg bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 flex items-center justify-center"
                              title="Remove from room"
                            >
                              <UserX className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === 'mix' && (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-[#141720] border border-white/10 space-y-4">
                  <h2 className="font-display text-sm font-semibold text-white">
                    Separate Audio Mix
                  </h2>

                  <label className="block space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300 font-medium">Karaoke Track (YouTube)</span>
                      <span className="font-mono-tabular text-slate-400">{musicVolume}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={musicVolume}
                      onChange={(e) => setMusicVolume(Number(e.target.value))}
                      className="w-full accent-[#FF5A36] h-2 bg-white/10 rounded-lg cursor-pointer"
                    />
                  </label>

                  <label className="block space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300 font-medium">Live Singer Vocals</span>
                      <span className="font-mono-tabular text-slate-400">{vocalsVolume}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={vocalsVolume}
                      onChange={(e) => setVocalsVolume(Number(e.target.value))}
                      className="w-full accent-[#FF5A36] h-2 bg-white/10 rounded-lg cursor-pointer"
                    />
                  </label>
                </div>

                <div className="p-4 rounded-2xl bg-[#141720] border border-white/10 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">Self-Monitor (Off by default)</p>
                      <p className="text-xs text-slate-400">
                        Plays your own mic locally via Web Audio while singing
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelfMonitor((v) => !v)}
                      className={`min-h-[38px] px-3.5 rounded-xl text-xs font-semibold transition-colors ${
                        selfMonitor
                          ? 'bg-[#FF5A36] text-white'
                          : 'bg-white/5 text-slate-300 border border-white/10'
                      }`}
                    >
                      {selfMonitor ? 'On' : 'Off'}
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-3 border-t border-white/5">
                    <div>
                      <p className="text-sm font-medium text-white">Voice Announcements</p>
                      <p className="text-xs text-slate-400">
                        Announce when guests enter the room or take the stage mic
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAnnouncementsEnabled((v) => !v)}
                      className={`min-h-[38px] px-3.5 rounded-xl text-xs font-semibold transition-colors ${
                        announcementsEnabled
                          ? 'bg-[#FF5A36] text-white'
                          : 'bg-white/5 text-slate-300 border border-white/10'
                      }`}
                    >
                      {announcementsEnabled ? 'On' : 'Off'}
                    </button>
                  </div>

                  <div className="pt-3 border-t border-white/5 flex items-center justify-between gap-3 text-xs text-slate-400">
                    <div>
                      <span>Voice offset: </span>
                      <span className="font-mono-tabular text-slate-200">
                        {Math.round(voiceLatencySec * 1000)}ms
                      </span>
                      <span aria-hidden="true"> · </span>
                      <span>
                        {voice.transportMode === 'livekit' ? 'LiveKit SFU' : 'WebRTC Direct'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => playerRef.current?.resyncNow()}
                      className="min-h-[36px] px-3 rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 font-medium"
                    >
                      Resync Track
                    </button>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-[#141720] border border-white/10 text-xs text-slate-400 space-y-1">
                  <p className="flex items-center gap-2 text-slate-200 font-medium">
                    <Headphones className="w-4 h-4 text-amber-400" />
                    <span>
                      {wakeLockActive
                        ? 'Screen Wake Lock active during session'
                        : 'Keep screen awake while jamming'}
                    </span>
                  </p>
                  {isIosSafari && (
                    <p>
                      iOS Safari note: YouTube playback pauses if the browser is backgrounded or the screen locks — keep the app in the foreground.
                    </p>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'admin' && isAdmin && (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-[#141720] border border-white/10 space-y-3">
                  <h2 className="font-display text-sm font-semibold text-white">
                    Room Mic &amp; Stage Controls
                  </h2>

                  <div className="flex items-center justify-between gap-3 py-1">
                    <div>
                      <p className="text-sm font-medium text-white">Room Mics (Google Meet Style)</p>
                      <p className="text-xs text-slate-400">
                        {roomState?.audienceMuted
                          ? 'Audience muted — disallowing others unless approved'
                          : 'Everyone can unmute & talk unless individually disallowed'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        sendWs({
                          type: 'admin:muteAllOthers',
                          muted: !roomState?.audienceMuted,
                        })
                      }
                      className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold transition-colors shrink-0 ${
                        roomState?.audienceMuted
                          ? 'bg-emerald-500 text-black hover:bg-emerald-400'
                          : 'bg-amber-500/20 text-amber-200 border border-amber-500/30 hover:bg-amber-500/30'
                      }`}
                    >
                      {roomState?.audienceMuted ? 'Allow All Mics' : 'Mute All Others'}
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-3 py-1 border-t border-white/5 pt-3">
                    <div>
                      <p className="text-sm font-medium text-white">Auto-Mute on Stage</p>
                      <p className="text-xs text-slate-400">
                        Automatically mute audience whenever a new singer takes the stage
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        sendWs({
                          type: 'admin:toggleAutoMuteOnStage',
                          enabled: !roomState?.autoMuteOnStage,
                        })
                      }
                      className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold transition-colors shrink-0 ${
                        roomState?.autoMuteOnStage
                          ? 'bg-[#FF5A36] text-white'
                          : 'bg-white/10 text-slate-300'
                      }`}
                    >
                      {roomState?.autoMuteOnStage ? 'Enabled' : 'Off'}
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-3 py-1 border-t border-white/5 pt-3">
                    <div>
                      <p className="text-sm font-medium text-white">Duet Stage Mode</p>
                      <p className="text-xs text-slate-400">
                        Allow two simultaneous lead singers with earphones
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        sendWs({
                          type: 'stage:toggleDuet',
                          duetMode: !roomState?.duetMode,
                        })
                      }
                      className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold transition-colors shrink-0 ${
                        roomState?.duetMode
                          ? 'bg-[#FF5A36] text-white'
                          : 'bg-white/10 text-slate-300'
                      }`}
                    >
                      {roomState?.duetMode ? '2 Singers' : 'Solo (1)'}
                    </button>
                  </div>
                </div>

                {raisedHands.length > 0 && (
                  <div className="p-4 rounded-2xl bg-[#141720] border border-amber-500/25 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold text-amber-300">
                        Mic Requests ({raisedHands.length})
                      </h3>
                      <button
                        type="button"
                        onClick={() => sendWs({ type: 'admin:muteAllOthers', muted: false })}
                        className="min-h-[32px] px-3 rounded-lg bg-emerald-500 text-black text-xs font-semibold"
                      >
                        Allow All Mics
                      </button>
                    </div>
                    {raisedHands.map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2">
                        <span className="text-sm text-white truncate">{p.name}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              sendWs({
                                type: 'admin:muteParticipant',
                                targetId: p.id,
                                muted: false,
                              })
                            }
                            className="min-h-[36px] px-3 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold"
                          >
                            Allow Mic
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              sendWs({ type: 'stage:pass', targetParticipantId: p.id })
                            }
                            className="min-h-[36px] px-3 rounded-lg bg-[#FF5A36] text-xs font-semibold text-white"
                          >
                            Pass Stage
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Desktop Right Column: Live Chat Always Visible */}
        <aside className="hidden lg:block lg:col-span-4 h-[calc(100dvh-100px)] sticky top-[76px]">
          <ChatBottomSheet
            open
            desktopEmbedded
            onClose={() => {}}
            messages={roomState?.messages || []}
            onSendMessage={(text) => sendWs({ type: 'chat:send', text })}
            onSendCheer={(emoji) => sendWs({ type: 'cheer:send', emoji })}
          />
        </aside>
      </div>

      {/* Mobile Thumb-Reachable Bottom Bar */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-[#141720]/95 backdrop-blur-md border-t border-white/10 px-2 pt-1.5 pb-safe grid grid-cols-5 items-center"
        aria-label="Room controls"
      >
        <button
          type="button"
          onClick={handleMicOrStageButton}
          className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
            shouldTransmitMic
              ? 'text-emerald-400'
              : me?.handRaised
                ? 'text-amber-400'
                : isMicDisallowed
                  ? 'text-rose-400'
                  : 'text-slate-300'
          }`}
        >
          {isMicDisallowed ? (
            <Hand className="w-5 h-5" />
          ) : shouldTransmitMic ? (
            <Mic className="w-5 h-5" />
          ) : (
            <MicOff className="w-5 h-5" />
          )}
          <span className="text-[10px] font-medium">
            {isMicDisallowed
              ? me?.handRaised
                ? 'Asked'
                : 'Request'
              : shouldTransmitMic
                ? 'Mic On'
                : 'Mic Off'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('chat');
            setUnreadChat(0);
          }}
          className={`relative min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
            activeTab === 'chat' ? 'text-[#FF5A36]' : 'text-slate-300'
          }`}
        >
          <MessageSquare className="w-5 h-5" />
          <span className="text-[10px] font-medium">Chat</span>
          {unreadChat > 0 && activeTab !== 'chat' && (
            <span className="absolute top-1.5 right-3 min-w-[16px] h-4 px-1 rounded-full bg-[#FF5A36] text-[10px] font-bold text-white flex items-center justify-center">
              {unreadChat > 9 ? '9+' : unreadChat}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('songs')}
          className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
            activeTab === 'songs' ? 'text-[#FF5A36]' : 'text-slate-300'
          }`}
        >
          <ListMusic className="w-5 h-5" />
          <span className="text-[10px] font-medium">Songs</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('mix')}
          className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
            activeTab === 'mix' ? 'text-[#FF5A36]' : 'text-slate-300'
          }`}
        >
          <Sliders className="w-5 h-5" />
          <span className="text-[10px] font-medium">Mix</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab(isAdmin && activeTab === 'people' ? 'admin' : 'people')}
          className={`relative min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
            activeTab === 'people' || activeTab === 'admin' ? 'text-[#FF5A36]' : 'text-slate-300'
          }`}
        >
          {isAdmin ? <Shield className="w-5 h-5" /> : <Users className="w-5 h-5" />}
          <span className="text-[10px] font-medium">{isAdmin ? 'Host' : 'People'}</span>
          {isAdmin && raisedHands.length > 0 && (
            <span className="absolute top-1.5 right-3 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-[10px] font-bold text-black flex items-center justify-center">
              {raisedHands.length}
            </span>
          )}
        </button>
      </nav>

      {/* Toast & Announcement Notifications */}
      {announcementNotice && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-xl bg-emerald-500/20 border border-emerald-400/40 backdrop-blur-md text-xs font-medium text-emerald-100 shadow-lg max-w-[90vw] text-center flex items-center gap-2">
          <Volume2 className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
          <span>{announcementNotice}</span>
        </div>
      )}

      {toastError && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-[#1F2433] border border-white/15 text-xs text-white shadow-xl max-w-[90vw] text-center">
          {toastError}
        </div>
      )}

      {/* Mandatory Headphones Confirmation Gate */}
      <EarphoneGateModal
        open={showEarphoneGate}
        onConfirm={handleConfirmEarphones}
        onCancel={() => setShowEarphoneGate(false)}
      />
    </div>
  );
}
