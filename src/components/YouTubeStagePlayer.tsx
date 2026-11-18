import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { PlaybackState } from '../shared/types.ts';

interface YTPlayerInstance {
  loadVideoById: (opts: { videoId: string; startSeconds?: number }) => void;
  cueVideoById: (opts: { videoId: string; startSeconds?: number }) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volume: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  destroy: () => void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        options: {
          videoId?: string;
          playerVars?: Record<string, number | string>;
          events?: {
            onReady?: () => void;
            onStateChange?: (event: { data: number }) => void;
            onError?: (event: { data: number }) => void;
          };
        }
      ) => YTPlayerInstance;
      PlayerState: {
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export interface YouTubeStagePlayerHandle {
  getCurrentTime: () => number;
  getDuration: () => number;
  seekTo: (seconds: number) => void;
  resyncNow: () => void;
}

interface YouTubeStagePlayerProps {
  playback: PlaybackState;
  musicVolume: number;
  isController: boolean;
  isSinger: boolean;
  voiceLatencySec: number;
  audioUnlocked: boolean;
  onUnlockAudio: () => void;
  onTimeUpdate?: (currentSec: number, durationSec: number) => void;
  onControllerAction: (action: 'play' | 'pause' | 'seek' | 'ended', positionSec: number) => void;
}

let ytApiPromise: Promise<void> | null = null;

function loadYouTubeIframeAPI(): Promise<void> {
  if (window.YT && window.YT.Player) {
    return Promise.resolve();
  }
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve) => {
    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prevCallback) prevCallback();
      resolve();
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      document.head.appendChild(tag);
    }
  });

  return ytApiPromise;
}

export const YouTubeStagePlayer = React.forwardRef<
  YouTubeStagePlayerHandle,
  YouTubeStagePlayerProps
>(function YouTubeStagePlayer(
  {
    playback,
    musicVolume,
    isController,
    isSinger,
    voiceLatencySec,
    audioUnlocked,
    onUnlockAudio,
    onTimeUpdate,
    onControllerAction,
  },
  ref
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [embedError, setEmbedError] = useState<string | null>(null);

  const loadedVideoIdRef = useRef<string | null>(null);
  const lastAppliedSeqRef = useRef<number>(0);
  const suppressEventRef = useRef(false);
  const latestPropsRef = useRef({
    playback,
    isController,
    isSinger,
    voiceLatencySec,
    audioUnlocked,
    onTimeUpdate,
    onControllerAction,
  });

  latestPropsRef.current = {
    playback,
    isController,
    isSinger,
    voiceLatencySec,
    audioUnlocked,
    onTimeUpdate,
    onControllerAction,
  };

  const computeTargetPosition = (pb: PlaybackState, singer: boolean, latencySec: number) => {
    const elapsed = pb.isPlaying ? Math.max(0, (Date.now() - pb.updatedAtMs) / 1000) : 0;
    const rawPos = pb.positionSec + elapsed;
    // Latency compensation: listeners offset behind singer so live vocals align with beat
    return singer ? rawPos : Math.max(0, rawPos - latencySec);
  };

  const syncPlayerToState = (forceSeek = false) => {
    const player = playerRef.current;
    if (!player || !playerReady) return;
    const { playback: pb, isSinger: singer, voiceLatencySec: lat, audioUnlocked: unlocked } =
      latestPropsRef.current;
    if (!pb.currentSong) return;

    const seqChanged = pb.syncSeq !== lastAppliedSeqRef.current;
    lastAppliedSeqRef.current = pb.syncSeq;

    const targetPos = computeTargetPosition(pb, singer, lat);

    suppressEventRef.current = true;
    window.setTimeout(() => {
      suppressEventRef.current = false;
    }, 450);

    if (loadedVideoIdRef.current !== pb.currentSong.videoId) {
      loadedVideoIdRef.current = pb.currentSong.videoId;
      setEmbedError(null);
      if (pb.isPlaying && unlocked) {
        player.loadVideoById({ videoId: pb.currentSong.videoId, startSeconds: targetPos });
      } else {
        player.cueVideoById({ videoId: pb.currentSong.videoId, startSeconds: targetPos });
      }
      return;
    }

    const currentPos = Number(player.getCurrentTime?.() || 0);
    const drift = Math.abs(currentPos - targetPos);
    const threshold = seqChanged ? 0.35 : 0.75;
    if (forceSeek || drift > threshold) {
      player.seekTo(targetPos, true);
    }

    const state = player.getPlayerState?.();
    if (pb.isPlaying && unlocked) {
      if (state !== 1 && state !== 3) {
        player.playVideo();
      }
    } else if (!pb.isPlaying && state === 1) {
      player.pauseVideo();
    }
  };

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => Number(playerRef.current?.getCurrentTime?.() || 0),
    getDuration: () => Number(playerRef.current?.getDuration?.() || 0),
    seekTo: (seconds: number) => {
      const player = playerRef.current;
      if (!player || !playerReady) return;
      suppressEventRef.current = true;
      window.setTimeout(() => {
        suppressEventRef.current = false;
      }, 450);
      player.seekTo(Math.max(0, seconds), true);
    },
    resyncNow: () => syncPlayerToState(true),
  }));

  // Mount official YouTube IFrame Player API once
  useEffect(() => {
    let mounted = true;

    loadYouTubeIframeAPI().then(() => {
      if (!mounted || !hostRef.current || !window.YT) return;
      const mountEl = document.createElement('div');
      mountEl.className = 'w-full h-full';
      hostRef.current.innerHTML = '';
      hostRef.current.appendChild(mountEl);

      const initialId = latestPropsRef.current.playback.currentSong?.videoId || 'I5-4eRqxG64';
      loadedVideoIdRef.current = initialId;

      playerRef.current = new window.YT.Player(mountEl, {
        videoId: initialId,
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            if (!mounted) return;
            setPlayerReady(true);
            playerRef.current?.setVolume(musicVolume);
            syncPlayerToState(true);
          },
          onStateChange: (event) => {
            if (suppressEventRef.current) return;
            const { isController: ctrl, onControllerAction: emit, playback: pb } =
              latestPropsRef.current;
            const curTime = Number(playerRef.current?.getCurrentTime?.() || 0);

            // 1 = PLAYING, 2 = PAUSED, 0 = ENDED
            if (event.data === 1) {
              if (!latestPropsRef.current.audioUnlocked) {
                onUnlockAudio();
              }
              if (ctrl && !pb.isPlaying) {
                emit('play', curTime);
              }
            } else if (event.data === 2) {
              if (ctrl && pb.isPlaying) {
                emit('pause', curTime);
              }
            } else if (event.data === 0) {
              if (ctrl) {
                emit('ended', curTime);
              }
            }
          },
          onError: () => {
            setEmbedError('This track restricts embedded playback. Tap Skip to play the next song.');
          },
        },
      });
    });

    return () => {
      mounted = false;
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, []);

  // Poll current playback time + detect direct iframe scrubbing by host/controller
  useEffect(() => {
    if (!playerReady) return;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      const cur = Number(player.getCurrentTime?.() || 0);
      const dur = Number(player.getDuration?.() || 0);
      latestPropsRef.current.onTimeUpdate?.(cur, dur);

      const { isController: ctrl, playback: pb, isSinger: singer, voiceLatencySec: lat, onControllerAction: emit } =
        latestPropsRef.current;
      if (ctrl && !suppressEventRef.current && pb.currentSong) {
        const expected = computeTargetPosition(pb, singer, lat);
        const state = player.getPlayerState?.();
        if ((state === 1 || state === 2) && Math.abs(cur - expected) > 1.8) {
          suppressEventRef.current = true;
          window.setTimeout(() => {
            suppressEventRef.current = false;
          }, 500);
          emit('seek', cur);
        }
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [playerReady]);

  // Apply music volume slider immediately
  useEffect(() => {
    if (playerReady && playerRef.current) {
      playerRef.current.setVolume(Math.max(0, Math.min(100, musicVolume)));
    }
  }, [musicVolume, playerReady]);

  // Sync whenever authoritative playback state updates or autoplay unlocks
  useEffect(() => {
    syncPlayerToState(false);
  }, [
    playback.currentSong?.videoId,
    playback.isPlaying,
    playback.syncSeq,
    playback.positionSec,
    audioUnlocked,
    playerReady,
  ]);

  return (
    <div className="w-full bg-black">
      {/* Unobstructed YouTube IFrame container: >=200x200px minimum, never hidden, overlaid, or restyled */}
      <div
        ref={hostRef}
        className="w-full min-w-[200px] min-h-[210px] aspect-video max-h-[36vh] sm:max-h-[42vh] bg-black"
      />
      {embedError && (
        <div className="px-4 py-2 bg-amber-500/15 border-t border-amber-500/30 text-xs text-amber-200">
          {embedError}
        </div>
      )}
    </div>
  );
});
