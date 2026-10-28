'use client';

import { useEffect, useState, useRef } from 'react';
import { useNotificationStore } from '@/stores/notification-store';
import { kdate } from '@/lib/ui-settings';
import { useEdgeSafeAlign } from '@/components/ui/useEdgeSafeAlign';

const SEV_DOT: Record<string, string> = {
  critical: 'bg-rose-500', high: 'bg-rose-500', warning: 'bg-amber-500', moderate: 'bg-amber-500',
};
/* 🔴 색만으로 중증도를 말하지 않는다(§4.6) — 의미는 색이 아니라 n.severity 에서 가져온다.
   SEV_DOT 에 없는 값(info·미상 등)은 '정보'가 아니라 원문 그대로/미상으로 말한다. */
const SEV_WORD: Record<string, string> = {
  critical: '위급', high: '위급', warning: '주의', moderate: '주의', info: '정보', low: '정보',
};
const sevWord = (s?: string | null) => (s ? SEV_WORD[s] ?? s : '중요도 미기재');

/**
 * 태블릿 셸 전용 플로팅 알림 벨 — (main) TopBar를 상속하지 않는 독립 셸이라
 * SSE 연결·위급 토스트·알림 목록이 전부 없던 갭 봉합(알림 검토 이관분).
 * connectSSE로 실시간 채널을 열면 store가 CRITICAL/WARNING을 토스트로 표면화(PR#668).
 */
export default function TabletNotificationBell() {
  const { notifications, unreadCount, connectSSE, disconnectSSE, fetchNotifications, markRead } = useNotificationStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // 🔴 컨테이너 밖으로 뻗어 잘리지 않게 — 정본 하나(useEdgeSafeAlign)
  const { alignClass } = useEdgeSafeAlign(open, 320, ref);

  useEffect(() => {
    void fetchNotifications();
    connectSSE();
    return () => disconnectSSE();
  }, [connectSSE, disconnectSSE, fetchNotifications]);

  useEffect(() => {
    const h = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, []);

  const criticalUnread = notifications.filter((n) => !n.read && (n.severity === 'critical' || n.severity === 'high')).length;

  return (
    <div ref={ref} className="fixed bottom-5 right-5 z-40">
      {open && (
        <div className={`absolute bottom-16 ${alignClass} w-80 max-h-[60vh] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-gray-100`}>
          <div className="sticky top-0 bg-white px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-bold text-gray-900">알림 {unreadCount > 0 && <span className="text-rose-500">({unreadCount})</span>}</span>
          </div>
          {notifications.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-10">새 알림이 없습니다</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {notifications.slice(0, 30).map((n) => (
                <button key={n.id} onClick={() => { markRead(n.id); }}
                  className={`w-full text-left px-4 py-3 flex gap-2.5 ${n.read ? 'opacity-60' : ''} hover:bg-gray-50`}>
                  <span
                    aria-label={sevWord(n.severity)}
                    title={sevWord(n.severity)}
                    className={`mt-1 w-2 h-2 rounded-full shrink-0 ${SEV_DOT[n.severity ?? ''] ?? 'bg-blue-400'}`}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-gray-900 truncate">{n.title}</p>
                    <p className="text-[11px] text-gray-500 line-clamp-2">{n.message}</p>
                    <p className="text-[10px] text-gray-300 mt-0.5">{kdate(n.createdAt, 'datetime')}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <button onClick={() => setOpen((o) => !o)}
        className={`relative w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors ${criticalUnread > 0 ? 'bg-rose-500 animate-pulse' : 'bg-white border border-gray-200'}`}
        aria-label="알림">
        <svg className={`w-6 h-6 ${criticalUnread > 0 ? 'text-white' : 'text-gray-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}
