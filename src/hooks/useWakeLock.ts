import { useEffect, useRef, useState } from 'react';

export function useWakeLock(active: boolean) {
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  const isIosSafari =
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    /Safari/.test(navigator.userAgent) &&
    !/CriOS|FxiOS/.test(navigator.userAgent);

  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) {
      setWakeLockActive(false);
      return;
    }

    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) {
          await sentinel.release();
          return;
        }
        sentinelRef.current = sentinel;
        setWakeLockActive(true);
        sentinel.addEventListener('release', () => {
          if (!cancelled) setWakeLockActive(false);
        });
      } catch {
        setWakeLockActive(false);
      }
    };

    acquire();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        acquire();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (sentinelRef.current) {
        sentinelRef.current.release().catch(() => {});
        sentinelRef.current = null;
      }
      setWakeLockActive(false);
    };
  }, [active]);

  return { wakeLockActive, isIosSafari };
}
