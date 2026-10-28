'use client';

import { useEffect, useState } from 'react';

import { T } from '@/components/ui/i18n-text';

export function NetworkStatusBanner() {
  const [isOffline, setIsOffline] = useState(false);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => {
      setIsOffline(false);
      setShowReconnected(true);
      setTimeout(() => setShowReconnected(false), 3000);
    };

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);

    // 마운트 시 현재 상태 확인
    if (!navigator.onLine) setIsOffline(true);

    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!isOffline && !showReconnected) return null;

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[10000] text-center text-sm font-medium py-2 transition-colors ${
        isOffline
          ? 'bg-red-600 text-white'
          : 'bg-emerald-600 text-white'
      }`}
    >
      {isOffline
        ? <T k="네트워크 연결이 끊어졌습니다. 일부 기능이 제한될 수 있습니다." />
        : <T k="네트워크가 다시 연결되었습니다." />}
    </div>
  );
}
