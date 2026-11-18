import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Room as LiveKitRoom,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  LocalAudioTrack,
} from 'livekit-client';
import { Participant, VoiceStatus } from '../shared/types.ts';

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const PCM_FALLBACK_DELAY_MS = 2000; // Wait 2s for direct WebRTC P2P before bridging over WS
const TARGET_PCM_RATE = 16000;

function extractSdpSessionId(sdp?: string | null): string | null {
  if (!sdp) return null;
  const m = sdp.match(/^o=\S+\s+(\S+)/m);
  return m ? m[1] : null;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 4,
};

interface UseVoiceEngineOptions {
  roomCode: string;
  participantId: string;
  participantName: string;
  participants: Participant[];
  activeSingerIds: string[];
  isSinger: boolean;
  shouldTransmitMic: boolean;
  vocalsVolume: number; // 0..100
  selfMonitor: boolean;
  audioUnlocked: boolean;
  sendWs: (msg: Record<string, unknown>) => void;
  sendWsFast?: (msg: Record<string, unknown>) => void;
  onSignalRef: React.MutableRefObject<
    ((fromId: string, signalType: 'offer' | 'answer' | 'ice', payload: unknown) => void) | null
  >;
  onVoicePcmRef?: React.MutableRefObject<
    ((fromId: string, sampleRate: number, data: string) => void) | null
  >;
}

function encodeInt16Base64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function decodeInt16Base64(base64: string): Int16Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 2));
}

function downsampleToInt16(input: Float32Array, inputRate: number, targetRate: number): Int16Array {
  if (inputRate <= targetRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }
  const ratio = inputRate / targetRate;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += input[j];
      count++;
    }
    const sample = count > 0 ? sum / count : input[start] || 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}

export function useVoiceEngine({
  roomCode,
  participantId,
  participantName,
  participants,
  activeSingerIds,
  isSinger,
  shouldTransmitMic,
  vocalsVolume,
  selfMonitor,
  audioUnlocked,
  sendWs,
  sendWsFast,
  onSignalRef,
  onVoicePcmRef,
}: UseVoiceEngineOptions) {
  const [transportMode, setTransportMode] = useState<'livekit' | 'webrtc-mesh'>('webrtc-mesh');
  const [permissionState, setPermissionState] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('active');
  const [localAudioLevel, setLocalAudioLevel] = useState(0);
  const [idleDisconnected, setIdleDisconnected] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [streamVersion, setStreamVersion] = useState(0);
  const [rtcRetryNonce, setRtcRetryNonce] = useState(0);

  const localStreamRef = useRef<MediaStream | null>(null);
  const streamStudioModeRef = useRef<boolean>(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const monitorGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const pcmGainRef = useRef<GainNode | null>(null);
  const pcmProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmMuteSinkRef = useRef<GainNode | null>(null);

  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteAudioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const remoteCtxBridgeRef = useRef<
    Map<string, { source: MediaStreamAudioSourceNode; stream: MediaStream }>
  >(new Map());
  const pendingIceCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const makingOfferRef = useRef<Set<string>>(new Set());
  const ignoreOfferRef = useRef<Set<string>>(new Set());
  const negotiatedSendRef = useRef<Set<string>>(new Set());
  const peerAttemptStartedAtRef = useRef<Map<string, number>>(new Map());
  const webrtcConnectedPeersRef = useRef<Set<string>>(new Set());
  const pcmPlayheadRef = useRef<Map<string, number>>(new Map());

  const livekitRoomRef = useRef<LiveKitRoom | null>(null);
  const livekitLocalTrackRef = useRef<LocalAudioTrack | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  // Always-fresh refs for callbacks so WebRTC PCs don't thrash
  const participantsRef = useRef(participants);
  participantsRef.current = participants;
  const shouldTransmitMicRef = useRef(shouldTransmitMic);
  shouldTransmitMicRef.current = shouldTransmitMic;
  const vocalsVolumeRef = useRef(vocalsVolume);
  vocalsVolumeRef.current = vocalsVolume;
  const audioUnlockedRef = useRef(audioUnlocked);
  audioUnlockedRef.current = audioUnlocked;
  const transportModeRef = useRef(transportMode);
  transportModeRef.current = transportMode;
  const sendWsRef = useRef(sendWs);
  sendWsRef.current = sendWs;
  const sendWsFastRef = useRef(sendWsFast || sendWs);
  sendWsFastRef.current = sendWsFast || sendWs;

  const participantIdsKey = useMemo(
    () =>
      participants
        .map((p) => p.id)
        .filter((id) => id !== participantId)
        .sort()
        .join(','),
    [participants, participantId]
  );

  const markActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  const getOrCreateAudioContext = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    const AudioContextCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return null;
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      const ctx = new AudioContextCtor({ latencyHint: 'interactive' });
      audioCtxRef.current = ctx;
      const pcmGain = ctx.createGain();
      pcmGain.gain.value = Math.max(0, Math.min(1, vocalsVolumeRef.current / 100));
      pcmGain.connect(ctx.destination);
      pcmGainRef.current = pcmGain;
    } else if (!pcmGainRef.current) {
      const pcmGain = audioCtxRef.current.createGain();
      pcmGain.gain.value = Math.max(0, Math.min(1, vocalsVolumeRef.current / 100));
      pcmGain.connect(audioCtxRef.current.destination);
      pcmGainRef.current = pcmGain;
    }
    return audioCtxRef.current;
  }, []);

  // Update vocals playback volume across all remote <audio> elements & PCM gain node
  useEffect(() => {
    const vol = Math.max(0, Math.min(1, vocalsVolume / 100));
    for (const audioEl of remoteAudioElsRef.current.values()) {
      audioEl.volume = vol;
    }
    if (pcmGainRef.current && audioCtxRef.current) {
      pcmGainRef.current.gain.setTargetAtTime(vol, audioCtxRef.current.currentTime, 0.02);
    }
  }, [vocalsVolume]);

  // Toggle low-latency local Web Audio self-monitor (OFF by default)
  useEffect(() => {
    if (monitorGainRef.current && audioCtxRef.current) {
      monitorGainRef.current.gain.setTargetAtTime(
        selfMonitor && shouldTransmitMic && !idleDisconnected ? 0.85 : 0,
        audioCtxRef.current.currentTime,
        0.02
      );
      if (selfMonitor && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
    }
  }, [selfMonitor, shouldTransmitMic, idleDisconnected]);

  // Keep permissionState synced with browser Permissions API when supported
  useEffect(() => {
    let cancelled = false;
    let statusObj: PermissionStatus | null = null;
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((status) => {
          if (cancelled) return;
          statusObj = status;
          if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
            setPermissionState(status.state);
            if (status.state === 'granted') {
              setMicError(null);
            }
          }
          status.onchange = () => {
            if (cancelled) return;
            if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
              setPermissionState(status.state);
              if (status.state === 'granted') {
                setMicError(null);
                setVoiceStatus('active');
              }
            }
          };
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      if (statusObj) statusObj.onchange = null;
    };
  }, []);

  const teardownRemoteCtxBridge = useCallback((peerId: string) => {
    const bridge = remoteCtxBridgeRef.current.get(peerId);
    if (bridge) {
      try {
        bridge.source.disconnect();
      } catch {
        // ignore
      }
      remoteCtxBridgeRef.current.delete(peerId);
    }
  }, []);

  const routeStreamViaAudioContext = useCallback(
    (peerId: string, stream: MediaStream, audioEl: HTMLAudioElement) => {
      const ctx = getOrCreateAudioContext();
      if (!ctx || !pcmGainRef.current) return;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const existing = remoteCtxBridgeRef.current.get(peerId);
      if (existing && existing.stream === stream) return;
      teardownRemoteCtxBridge(peerId);
      try {
        // Keep <audio> element muted so native audio & AudioContext never double-play
        audioEl.muted = true;
        const source = ctx.createMediaStreamSource(stream);
        source.connect(pcmGainRef.current);
        remoteCtxBridgeRef.current.set(peerId, { source, stream });
      } catch {
        // ignore
      }
    },
    [getOrCreateAudioContext, teardownRemoteCtxBridge]
  );

  const playRemoteAudioEl = useCallback(
    (peerId: string, audioEl: HTMLAudioElement, canHear: boolean) => {
      if (!canHear) {
        audioEl.muted = true;
        return;
      }
      // If AudioContext bridge is active for this peer, keep <audio> muted until unlocked
      if (remoteCtxBridgeRef.current.has(peerId)) {
        audioEl.muted = true;
        return;
      }
      audioEl.muted = false;
      if (audioEl.paused && audioEl.srcObject) {
        const p = audioEl.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {
            if (audioEl.srcObject instanceof MediaStream) {
              routeStreamViaAudioContext(peerId, audioEl.srcObject, audioEl);
            }
          });
        }
      }
    },
    [routeStreamViaAudioContext]
  );

  // Global user gesture unblocker: eagerly creates/resumes AudioContext & plays paused remote <audio>
  useEffect(() => {
    const unblockAudioPlayback = () => {
      const ctx = getOrCreateAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      for (const [pid, el] of remoteAudioElsRef.current.entries()) {
        const participant = participantsRef.current.find((x) => x.id === pid);
        const canHear = participant
          ? !participant.micMuted && (participant.onStage || !participant.adminMuted)
          : true;
        if (!canHear) {
          el.muted = true;
          continue;
        }
        if (el.paused && el.srcObject) {
          el.play()
            .then(() => {
              teardownRemoteCtxBridge(pid);
              el.muted = false;
            })
            .catch(() => {});
        } else if (!el.paused && remoteCtxBridgeRef.current.has(pid)) {
          teardownRemoteCtxBridge(pid);
          el.muted = false;
        }
      }
    };
    window.addEventListener('pointerdown', unblockAudioPlayback, { passive: true });
    window.addEventListener('keydown', unblockAudioPlayback, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', unblockAudioPlayback);
      window.removeEventListener('keydown', unblockAudioPlayback);
    };
  }, [getOrCreateAudioContext, teardownRemoteCtxBridge]);

  // Unlock remote audio elements once user taps mobile autoplay button
  useEffect(() => {
    if (!audioUnlocked) return;
    const ctx = getOrCreateAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    for (const [pid, el] of remoteAudioElsRef.current.entries()) {
      const participant = participantsRef.current.find((x) => x.id === pid);
      const canHear = participant
        ? !participant.micMuted && (participant.onStage || !participant.adminMuted)
        : true;
      if (canHear && el.paused && el.srcObject) {
        el.play()
          .then(() => {
            teardownRemoteCtxBridge(pid);
            el.muted = false;
          })
          .catch(() => {});
      }
    }
  }, [audioUnlocked, getOrCreateAudioContext, teardownRemoteCtxBridge]);

  const teardownMicAudioGraph = useCallback(() => {
    if (pcmProcessorRef.current) {
      pcmProcessorRef.current.onaudioprocess = null;
      try {
        pcmProcessorRef.current.disconnect();
      } catch {
        // ignore
      }
      pcmProcessorRef.current = null;
    }
    if (pcmMuteSinkRef.current) {
      try {
        pcmMuteSinkRef.current.disconnect();
      } catch {
        // ignore
      }
      pcmMuteSinkRef.current = null;
    }
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // ignore
      }
      sourceNodeRef.current = null;
    }
    if (monitorGainRef.current) {
      try {
        monitorGainRef.current.disconnect();
      } catch {
        // ignore
      }
      monitorGainRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  // Acquire singer/participant microphone with raw 48kHz for stage singers
  // and AEC/NS/AGC for open-room talkers, plus resilient mobile fallbacks
  const ensureMicrophone = useCallback(
    async (studioMode = isSinger): Promise<MediaStream | null> => {
      if (idleDisconnected) return null;
      if (localStreamRef.current && streamStudioModeRef.current === studioMode) {
        const tracks = localStreamRef.current.getAudioTracks();
        if (tracks.length > 0 && tracks[0].readyState === 'live') {
          setPermissionState('granted');
          setVoiceStatus('active');
          setMicError(null);
          return localStreamRef.current;
        }
      } else if (localStreamRef.current && streamStudioModeRef.current !== studioMode) {
        teardownMicAudioGraph();
        for (const t of localStreamRef.current.getTracks()) t.stop();
        localStreamRef.current = null;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setPermissionState('denied');
        setVoiceStatus('listen-only');
        setMicError(
          'Microphone unavailable here. Make sure you opened the HTTPS Shared URL in Chrome or Safari.'
        );
        return null;
      }

      const preferredAudio: MediaTrackConstraints = studioMode
        ? {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: { ideal: 1 },
            sampleRate: { ideal: 48000 },
          }
        : {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          };

      let stream: MediaStream | null = null;
      let lastErr: unknown = null;

      const attempts: MediaStreamConstraints[] = [
        { audio: preferredAudio, video: false },
        {
          audio: {
            echoCancellation: !studioMode,
            noiseSuppression: !studioMode,
            autoGainControl: !studioMode,
          },
          video: false,
        },
        { audio: true, video: false },
      ];

      for (const constraints of attempts) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (err) {
          lastErr = err;
          const errName = err instanceof Error ? err.name : '';
          if (
            errName === 'NotAllowedError' ||
            errName === 'PermissionDeniedError' ||
            errName === 'SecurityError'
          ) {
            break;
          }
        }
      }

      if (!stream) {
        const errName = lastErr instanceof Error ? lastErr.name : '';
        const errMsg = lastErr instanceof Error ? lastErr.message : 'Microphone permission denied';
        const isPermissionBlock =
          !errName ||
          errName === 'NotAllowedError' ||
          errName === 'PermissionDeniedError' ||
          errName === 'SecurityError';
        const inIframe = typeof window !== 'undefined' && window.self !== window.top;

        if (isPermissionBlock) {
          setPermissionState('denied');
          setMicError(
            inIframe
              ? 'Mic blocked inside preview frame or browser settings. Allow mic in address bar or open in a full browser tab.'
              : 'Microphone permission is blocked. Allow Microphone in your browser site settings, then tap Retry Mic.'
          );
        } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
          setPermissionState('prompt');
          setMicError('No microphone detected on this device. Connect a mic/headset and tap Retry Mic.');
        } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
          setPermissionState('prompt');
          setMicError('Microphone is busy in another app. Close it and tap Retry Mic.');
        } else {
          setPermissionState('prompt');
          setMicError(`Could not start microphone (${errMsg}). Tap Retry Mic.`);
        }

        setVoiceStatus('listen-only');
        sendWsRef.current({
          type: 'mic:state',
          micMuted: true,
          earphonesConfirmed: false,
          voiceStatus: 'listen-only',
        });
        return null;
      }

      localStreamRef.current = stream;
      streamStudioModeRef.current = studioMode;
      setPermissionState('granted');
      setVoiceStatus('active');
      setMicError(null);
      setStreamVersion((v) => v + 1);

      // Build Web Audio graph for vocal level meter + self-monitor + WS NAT fallback capture
      try {
        const ctx = getOrCreateAudioContext();
        if (ctx) {
          if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
          }
          teardownMicAudioGraph();

          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          const monitorGain = ctx.createGain();
          monitorGain.gain.value = 0;

          source.connect(analyser);
          source.connect(monitorGain);
          monitorGain.connect(ctx.destination);

          // Lightweight PCM fallback capture: sends NOTHING unless a remote peer failed to reach WebRTC connected
          if (typeof ctx.createScriptProcessor === 'function') {
            const processor = ctx.createScriptProcessor(2048, 1, 1);
            const silentSink = ctx.createGain();
            silentSink.gain.value = 0;
            processor.onaudioprocess = (ev) => {
              if (!shouldTransmitMicRef.current || transportModeRef.current !== 'webrtc-mesh') return;
              const now = Date.now();
              const fallbackTargets: string[] = [];
              for (const p of participantsRef.current) {
                if (p.id === participantId) continue;
                if (webrtcConnectedPeersRef.current.has(p.id)) continue;
                const startedAt = peerAttemptStartedAtRef.current.get(p.id);
                if (startedAt && now - startedAt >= PCM_FALLBACK_DELAY_MS) {
                  fallbackTargets.push(p.id);
                }
              }
              if (fallbackTargets.length === 0) return;
              const inputData = ev.inputBuffer.getChannelData(0);
              const int16 = downsampleToInt16(inputData, ctx.sampleRate, TARGET_PCM_RATE);
              const encoded = encodeInt16Base64(int16);
              sendWsFastRef.current({
                type: 'voice:pcm',
                targetIds: fallbackTargets,
                sampleRate: TARGET_PCM_RATE,
                data: encoded,
              });
            };
            source.connect(processor);
            processor.connect(silentSink);
            silentSink.connect(ctx.destination);
            pcmProcessorRef.current = processor;
            pcmMuteSinkRef.current = silentSink;
          }

          sourceNodeRef.current = source;
          analyserRef.current = analyser;
          monitorGainRef.current = monitorGain;
        }
      } catch {
        // Non-fatal: WebRTC direct voice still works
      }

      return stream;
    },
    [getOrCreateAudioContext, idleDisconnected, isSinger, participantId, teardownMicAudioGraph]
  );

  // Clean up all voice connections
  const disconnectVoiceTransport = useCallback(() => {
    for (const pc of peerConnectionsRef.current.values()) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.close();
    }
    peerConnectionsRef.current.clear();
    pendingIceCandidatesRef.current.clear();
    makingOfferRef.current.clear();
    ignoreOfferRef.current.clear();
    negotiatedSendRef.current.clear();
    peerAttemptStartedAtRef.current.clear();
    webrtcConnectedPeersRef.current.clear();
    pcmPlayheadRef.current.clear();

    for (const pid of Array.from(remoteCtxBridgeRef.current.keys())) {
      teardownRemoteCtxBridge(pid);
    }
    for (const el of remoteAudioElsRef.current.values()) {
      el.pause();
      el.srcObject = null;
      el.remove();
    }
    remoteAudioElsRef.current.clear();

    if (livekitLocalTrackRef.current) {
      livekitLocalTrackRef.current.stop();
      livekitLocalTrackRef.current = null;
    }
    if (livekitRoomRef.current) {
      livekitRoomRef.current.disconnect();
      livekitRoomRef.current = null;
    }

    teardownMicAudioGraph();
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
      localStreamRef.current = null;
    }
    setLocalAudioLevel(0);
  }, [teardownMicAudioGraph]);

  // LiveKit SFU connection (only when LIVEKIT_URL + key/secret are configured on server)
  useEffect(() => {
    if (!roomCode || !participantId || idleDisconnected) return;
    let cancelled = false;

    const initTransport = async () => {
      try {
        const res = await fetch('/api/livekit-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomCode, participantId, participantName }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          mode: 'livekit' | 'webrtc-mesh';
          token: string | null;
          livekitUrl: string | null;
        };

        if (cancelled) return;
        setTransportMode(data.mode);

        if (data.mode === 'livekit' && data.token && data.livekitUrl) {
          const lkRoom = new LiveKitRoom({
            adaptiveStream: true,
            dynacast: true,
          });
          livekitRoomRef.current = lkRoom;

          lkRoom.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
            if (track.kind !== Track.Kind.Audio || participant.identity === participantId) return;
            const audioEl = track.attach() as HTMLAudioElement;
            const p = participantsRef.current.find((x) => x.id === participant.identity);
            const canHear = p ? !p.micMuted && (p.onStage || !p.adminMuted) : true;
            audioEl.volume = Math.max(0, Math.min(1, vocalsVolumeRef.current / 100));
            audioEl.muted = !canHear;
            audioEl.autoplay = true;
            document.body.appendChild(audioEl);
            remoteAudioElsRef.current.set(participant.identity, audioEl);
            if (canHear) {
              audioEl.play().catch(() => {});
            }
          });

          lkRoom.on(RoomEvent.TrackUnsubscribed, (_track, _pub, participant) => {
            const el = remoteAudioElsRef.current.get(participant.identity);
            if (el) {
              el.pause();
              el.srcObject = null;
              el.remove();
              remoteAudioElsRef.current.delete(participant.identity);
            }
          });

          await lkRoom.connect(data.livekitUrl, data.token);
        }
      } catch {
        setTransportMode('webrtc-mesh');
      }
    };

    initTransport();

    return () => {
      cancelled = true;
      disconnectVoiceTransport();
    };
  }, [roomCode, participantId, participantName, idleDisconnected, disconnectVoiceTransport]);

  const attachRemoteAudio = useCallback(
    (peerId: string, stream: MediaStream) => {
      if (peerId === participantId) return;
      const p = participantsRef.current.find((x) => x.id === peerId);
      const canHear = p ? !p.micMuted && (p.onStage || !p.adminMuted) : true;

      let audioEl = remoteAudioElsRef.current.get(peerId);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.setAttribute('playsinline', 'true');
        audioEl.style.display = 'none';
        document.body.appendChild(audioEl);
        remoteAudioElsRef.current.set(peerId, audioEl);
      }
      audioEl.srcObject = stream;
      audioEl.volume = Math.max(0, Math.min(1, vocalsVolumeRef.current / 100));
      playRemoteAudioEl(peerId, audioEl, canHear);
    },
    [participantId, playRemoteAudioEl]
  );

  const cleanupPeerConnection = useCallback(
    (peerId: string, clearAttemptTimer = false) => {
      const pc = peerConnectionsRef.current.get(peerId);
      if (pc) {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.oniceconnectionstatechange = null;
        pc.close();
        peerConnectionsRef.current.delete(peerId);
      }
      pendingIceCandidatesRef.current.delete(peerId);
      makingOfferRef.current.delete(peerId);
      ignoreOfferRef.current.delete(peerId);
      negotiatedSendRef.current.delete(peerId);
      webrtcConnectedPeersRef.current.delete(peerId);
      if (clearAttemptTimer) {
        peerAttemptStartedAtRef.current.delete(peerId);
      }
      pcmPlayheadRef.current.delete(peerId);
      teardownRemoteCtxBridge(peerId);

      const el = remoteAudioElsRef.current.get(peerId);
      if (el) {
        el.pause();
        el.srcObject = null;
        el.remove();
        remoteAudioElsRef.current.delete(peerId);
      }
    },
    [teardownRemoteCtxBridge]
  );

  const createPeerConnection = useCallback(
    (peerId: string) => {
      const existing = peerConnectionsRef.current.get(peerId);
      if (existing && existing.connectionState !== 'closed' && existing.connectionState !== 'failed') {
        return existing;
      }
      if (existing) {
        cleanupPeerConnection(peerId);
      }

      const pc = new RTCPeerConnection(RTC_CONFIG);
      peerConnectionsRef.current.set(peerId, pc);
      if (!peerAttemptStartedAtRef.current.has(peerId)) {
        peerAttemptStartedAtRef.current.set(peerId, Date.now());
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendWsRef.current({
            type: 'rtc:signal',
            targetId: peerId,
            signalType: 'ice',
            payload: event.candidate,
          });
        }
      };

      pc.ontrack = (event) => {
        const stream = (event.streams && event.streams[0]) || new MediaStream([event.track]);
        attachRemoteAudio(peerId, stream);
        event.track.onunmute = () => {
          const el = remoteAudioElsRef.current.get(peerId);
          if (el && !el.muted && el.paused) {
            el.play().catch(() => {});
          }
        };
      };

      const syncConnectedState = () => {
        const isConnected =
          pc.connectionState === 'connected' ||
          pc.iceConnectionState === 'connected' ||
          pc.iceConnectionState === 'completed';

        if (isConnected) {
          webrtcConnectedPeersRef.current.add(peerId);
          const el = remoteAudioElsRef.current.get(peerId);
          if (el && !el.muted && el.paused) {
            el.play().catch(() => {});
          }
        } else if (
          pc.connectionState === 'failed' ||
          pc.connectionState === 'closed' ||
          pc.iceConnectionState === 'failed'
        ) {
          webrtcConnectedPeersRef.current.delete(peerId);
          cleanupPeerConnection(peerId);
          window.setTimeout(() => {
            setRtcRetryNonce((n) => n + 1);
          }, 1500);
        }
      };

      pc.onconnectionstatechange = syncConnectedState;
      pc.oniceconnectionstatechange = syncConnectedState;

      return pc;
    },
    [attachRemoteAudio, cleanupPeerConnection]
  );

  const flushPendingIceCandidates = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    const queued = pendingIceCandidatesRef.current.get(peerId);
    if (!queued || queued.length === 0) return;
    pendingIceCandidatesRef.current.delete(peerId);
    for (const cand of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch {
        // Ignore stale candidate
      }
    }
  }, []);

  const attachOutgoingAudioTrack = useCallback(
    async (peerId: string, pc: RTCPeerConnection, stream: MediaStream): Promise<boolean> => {
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) return false;

      const transceivers = pc.getTransceivers();
      const transceiver =
        transceivers.find(
          (t) => t.receiver?.track?.kind === 'audio' || t.sender?.track?.kind === 'audio'
        ) || transceivers[0];

      if (transceiver) {
        const alreadySent =
          negotiatedSendRef.current.has(peerId) &&
          (transceiver.direction === 'sendrecv' || transceiver.direction === 'sendonly');
        transceiver.direction = 'sendrecv';
        if (transceiver.sender.track !== audioTrack) {
          await transceiver.sender.replaceTrack(audioTrack).catch(() => {});
        }
        return !alreadySent;
      }

      pc.addTrack(audioTrack, stream);
      return true;
    },
    []
  );

  // Sync outgoing mic track & negotiate ONLY with peers that haven't negotiated send yet
  useEffect(() => {
    if (idleDisconnected) return;
    let cancelled = false;

    const syncMicPublishing = async () => {
      if (shouldTransmitMic) {
        const stream = await ensureMicrophone();
        if (!stream || cancelled) return;
        for (const t of stream.getAudioTracks()) {
          t.enabled = true;
        }
        markActivity();

        if (transportMode === 'livekit' && livekitRoomRef.current) {
          if (!livekitLocalTrackRef.current) {
            const track = await createLocalAudioTrack({
              echoCancellation: !isSinger,
              noiseSuppression: !isSinger,
              autoGainControl: !isSinger,
              channelCount: 1,
              sampleRate: 48000,
            });
            livekitLocalTrackRef.current = track;
            await livekitRoomRef.current.localParticipant.publishTrack(track);
          } else {
            await livekitLocalTrackRef.current.unmute();
          }
          return;
        }

        const remoteIds = participantIdsKey ? participantIdsKey.split(',') : [];
        for (const peerId of remoteIds) {
          if (!peerId || peerId === participantId || cancelled) continue;
          const pc = createPeerConnection(peerId);
          const needsOffer = await attachOutgoingAudioTrack(peerId, pc, stream);
          if (needsOffer && pc.signalingState === 'stable' && !makingOfferRef.current.has(peerId)) {
            makingOfferRef.current.add(peerId);
            try {
              const offer = await pc.createOffer();
              if (pc.signalingState !== 'stable' || cancelled) continue;
              await pc.setLocalDescription(offer);
              negotiatedSendRef.current.add(peerId);
              if (!peerAttemptStartedAtRef.current.has(peerId)) {
                peerAttemptStartedAtRef.current.set(peerId, Date.now());
              }
              sendWsRef.current({
                type: 'rtc:signal',
                targetId: peerId,
                signalType: 'offer',
                payload: pc.localDescription,
              });
            } catch {
              // Retry on next state/retry tick
            } finally {
              makingOfferRef.current.delete(peerId);
            }
          }
        }
      } else {
        if (localStreamRef.current) {
          for (const t of localStreamRef.current.getAudioTracks()) {
            t.enabled = false;
          }
        }
        for (const pc of peerConnectionsRef.current.values()) {
          for (const sender of pc.getSenders()) {
            if (sender.track && sender.track.kind === 'audio') {
              sender.track.enabled = false;
            }
          }
        }
        if (livekitLocalTrackRef.current) {
          livekitLocalTrackRef.current.mute().catch(() => {});
        }
      }
    };

    syncMicPublishing();

    return () => {
      cancelled = true;
    };
  }, [
    shouldTransmitMic,
    idleDisconnected,
    transportMode,
    participantIdsKey,
    streamVersion,
    rtcRetryNonce,
    participantId,
    isSinger,
    ensureMicrophone,
    markActivity,
    createPeerConnection,
    attachOutgoingAudioTrack,
  ]);

  // Handle incoming WebRTC signaling (with ICE candidate buffering + perfect negotiation)
  useEffect(() => {
    onSignalRef.current = async (fromId, signalType, payload) => {
      if (idleDisconnected || transportMode === 'livekit' || fromId === participantId) return;
      try {
        let pc = createPeerConnection(fromId);

        if (signalType === 'offer') {
          const offerInit = payload as RTCSessionDescriptionInit;
          const incomingSessId = extractSdpSessionId(offerInit?.sdp);
          const prevRemoteSessId = extractSdpSessionId(pc.remoteDescription?.sdp);
          if (incomingSessId && prevRemoteSessId && incomingSessId !== prevRemoteSessId) {
            // Remote peer refreshed/rejoined with a new RTCPeerConnection session
            cleanupPeerConnection(fromId);
            pc = createPeerConnection(fromId);
          }

          const isPolite = participantId < fromId;
          const offerCollision =
            makingOfferRef.current.has(fromId) || pc.signalingState !== 'stable';
          const ignoreOffer = !isPolite && offerCollision;

          if (ignoreOffer) {
            ignoreOfferRef.current.add(fromId);
            return;
          }
          ignoreOfferRef.current.delete(fromId);

          if (pc.signalingState !== 'stable') {
            await pc.setLocalDescription({ type: 'rollback' });
          }

          await pc.setRemoteDescription(new RTCSessionDescription(offerInit));
          await flushPendingIceCandidates(fromId, pc);

          if (shouldTransmitMicRef.current && localStreamRef.current) {
            const audioTrack = localStreamRef.current.getAudioTracks()[0];
            if (audioTrack) {
              audioTrack.enabled = true;
              const transceivers = pc.getTransceivers();
              const transceiver =
                transceivers.find(
                  (t) => t.receiver?.track?.kind === 'audio' || t.sender?.track?.kind === 'audio'
                ) || transceivers[0];
              if (transceiver) {
                transceiver.direction = 'sendrecv';
                if (transceiver.sender.track !== audioTrack) {
                  await transceiver.sender.replaceTrack(audioTrack).catch(() => {});
                }
              } else {
                pc.addTrack(audioTrack, localStreamRef.current);
              }
              negotiatedSendRef.current.add(fromId);
            }
          }

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if (!peerAttemptStartedAtRef.current.has(fromId)) {
            peerAttemptStartedAtRef.current.set(fromId, Date.now());
          }
          sendWsRef.current({
            type: 'rtc:signal',
            targetId: fromId,
            signalType: 'answer',
            payload: pc.localDescription,
          });
        } else if (signalType === 'answer') {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(
              new RTCSessionDescription(payload as RTCSessionDescriptionInit)
            );
            await flushPendingIceCandidates(fromId, pc);
          }
        } else if (signalType === 'ice' && payload) {
          const candidateInit = payload as RTCIceCandidateInit;
          if (!pc.remoteDescription || !pc.remoteDescription.type) {
            const q = pendingIceCandidatesRef.current.get(fromId) || [];
            q.push(candidateInit);
            pendingIceCandidatesRef.current.set(fromId, q.slice(-60));
          } else {
            await pc.addIceCandidate(new RTCIceCandidate(candidateInit)).catch(() => {});
          }
        }
      } catch (err) {
        console.warn('RTC signaling error:', err);
      }
    };

    return () => {
      onSignalRef.current = null;
    };
  }, [
    createPeerConnection,
    flushPendingIceCandidates,
    idleDisconnected,
    onSignalRef,
    participantId,
    transportMode,
  ]);

  // Handle incoming WS PCM fallback frames ONLY when direct WebRTC is not connected for that peer
  useEffect(() => {
    if (!onVoicePcmRef) return;
    onVoicePcmRef.current = (fromId, sampleRate, data) => {
      if (idleDisconnected || transportMode === 'livekit' || fromId === participantId) return;
      if (webrtcConnectedPeersRef.current.has(fromId)) return;

      const p = participantsRef.current.find((x) => x.id === fromId);
      if (!p) return;
      const canHear = !p.micMuted && (p.onStage || !p.adminMuted);
      if (!canHear) return;

      const ctx = getOrCreateAudioContext();
      if (!ctx || !pcmGainRef.current) return;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      try {
        const int16 = decodeInt16Base64(data);
        if (int16.length === 0) return;
        const buffer = ctx.createBuffer(1, int16.length, sampleRate || TARGET_PCM_RATE);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < int16.length; i++) {
          channel[i] = int16[i] / 0x8000;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(pcmGainRef.current);

        const now = ctx.currentTime;
        let startAt = pcmPlayheadRef.current.get(fromId) ?? now + 0.04;
        if (startAt < now + 0.01) {
          startAt = now + 0.03;
        } else if (startAt > now + 0.35) {
          startAt = now + 0.06;
        }
        source.start(startAt);
        pcmPlayheadRef.current.set(fromId, startAt + buffer.duration);
      } catch {
        // Ignore malformed PCM chunk
      }
    };

    return () => {
      onVoicePcmRef.current = null;
    };
  }, [getOrCreateAudioContext, idleDisconnected, onVoicePcmRef, participantId, transportMode]);

  // Clean up departed peers & keep remote audio mute/play states synced to participants
  useEffect(() => {
    const activeIds = new Set(participants.map((p) => p.id));

    for (const pid of Array.from(peerConnectionsRef.current.keys())) {
      if (!activeIds.has(pid)) {
        cleanupPeerConnection(pid, true);
      }
    }

    for (const [pid, el] of remoteAudioElsRef.current.entries()) {
      if (!activeIds.has(pid)) {
        teardownRemoteCtxBridge(pid);
        el.pause();
        el.srcObject = null;
        el.remove();
        remoteAudioElsRef.current.delete(pid);
        continue;
      }
      const p = participants.find((x) => x.id === pid);
      if (p) {
        const canHear = !p.micMuted && (p.onStage || !p.adminMuted);
        playRemoteAudioEl(pid, el, canHear);
      }
    }
  }, [participants, activeSingerIds, cleanupPeerConnection, playRemoteAudioEl, teardownRemoteCtxBridge]);

  // Vocal level meter sampler + throttled WebSocket emission
  useEffect(() => {
    if (!shouldTransmitMic || idleDisconnected) {
      setLocalAudioLevel(0);
      return;
    }

    const buf = new Uint8Array(128);
    let lastEmit = 0;
    const timer = window.setInterval(() => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteFrequencyData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i];
      const avg = sum / buf.length;
      const level = Math.min(100, Math.round((avg / 120) * 100));
      setLocalAudioLevel(level);
      if (level > 6) {
        markActivity();
      }
      const now = Date.now();
      if (now - lastEmit >= 140) {
        lastEmit = now;
        sendWsRef.current({ type: 'mic:level', level });
      }
    }, 80);

    return () => window.clearInterval(timer);
  }, [shouldTransmitMic, idleDisconnected, markActivity]);

  // Track user interactions & auto-disconnect voice after 10 minutes of idle
  useEffect(() => {
    const bump = () => {
      lastActivityRef.current = Date.now();
    };
    window.addEventListener('pointerdown', bump, { passive: true });
    window.addEventListener('keydown', bump, { passive: true });

    const idleInterval = window.setInterval(() => {
      if (idleDisconnected) return;
      if (Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS && !shouldTransmitMic) {
        setIdleDisconnected(true);
        setVoiceStatus('idle-disconnected');
        disconnectVoiceTransport();
        sendWsRef.current({
          type: 'mic:state',
          micMuted: true,
          earphonesConfirmed: false,
          voiceStatus: 'idle-disconnected',
        });
      }
    }, 15000);

    return () => {
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('keydown', bump);
      window.clearInterval(idleInterval);
    };
  }, [idleDisconnected, shouldTransmitMic, disconnectVoiceTransport]);

  const rejoinVoice = useCallback(() => {
    lastActivityRef.current = Date.now();
    setIdleDisconnected(false);
    setVoiceStatus(permissionState === 'denied' ? 'listen-only' : 'active');
    sendWsRef.current({
      type: 'mic:state',
      micMuted: true,
      earphonesConfirmed: false,
      voiceStatus: permissionState === 'denied' ? 'listen-only' : 'active',
    });
  }, [permissionState]);

  return {
    transportMode,
    permissionState,
    voiceStatus,
    localAudioLevel,
    idleDisconnected,
    micError,
    ensureMicrophone,
    rejoinVoice,
    markActivity,
  };
}
