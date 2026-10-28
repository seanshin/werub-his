'use client';

import { useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useNotificationStore, type Notification } from '@/stores/notification-store';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { pollMs } from '@/lib/ui-settings';
import { useEdgeSafeAlign } from '@/components/ui/useEdgeSafeAlign';

const TYPE_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  order:       { icon: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108', color: 'text-violet-500 bg-violet-50', label: '오더' },
  billing:     { icon: 'M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0', color: 'text-amber-500 bg-amber-50', label: '수납' },
  lab:         { icon: 'M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5m14 0H5', color: 'text-indigo-500 bg-indigo-50', label: '검사' },
  pharmacy:    { icon: 'M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5m14 0H5', color: 'text-teal-500 bg-teal-50', label: '약국' },
  appointment: { icon: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5', color: 'text-blue-500 bg-blue-50', label: '예약' },
  clinical:    { icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z', color: 'text-rose-500 bg-rose-50', label: '임상 위급' },
  approval:    { icon: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z', color: 'text-cyan-600 bg-cyan-50', label: '결재/승인' },
  consult:     { icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.9 9.9 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z', color: 'text-orange-500 bg-orange-50', label: '상담/VoC' },
  system:      { icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281', color: 'text-gray-500 bg-gray-50', label: '시스템' },
};

/**
 * 🔴 **미기재를 안전색으로 칠하지 않는다**(2026-09-02).
 *    종전엔 `severity ?? 'info'` + `?? SEVERITY_DOT.info` 라 **중요도를 모르는 알림이 초록**이었다.
 *    모르는 것은 회색으로 두고, 아래에서 라벨(`aria-label`·`title`)을 함께 준다 —
 *    색만으로 상태를 전달하지 않는다(§4.6).
 */
const SEVERITY_DOT: Record<string, string> = {
  info:     'bg-emerald-400',
  low:      'bg-emerald-400',
  warning:  'bg-amber-400',
  moderate: 'bg-amber-400',
  high:     'bg-orange-500',
  critical: 'bg-red-500',
  unknown:  'bg-gray-300',
};
const SEVERITY_WORD: Record<string, string> = {
  info: '정보', low: '낮음', warning: '주의', moderate: '보통', high: '높음', critical: '위급',
  unknown: '중요도 미기재',
};

function getRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  /**
   * 🔴 **미래 시각을 '방금'이라 말하지 않는다** — 자료부족·진짜 0·미래는 서로 다른 사실이다(§1).
   *    같은 결함을 clinic-queue·pharmacy-board·reception-billing-board·ErFlowBoard 가 이미 고쳤고
   *    전역 부품만 남아 있었다(2026-09-02).
   */
  if (diffMs < 0) return '시각 확인 필요';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return '방금';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}주 전`;
  const months = Math.floor(days / 30);
  return `${months}개월 전`;
}

export function NotificationBell() {
  const { unreadCount, toggle, fetchNotifications } = useNotificationStore();
  const tAttr = useTAttr();

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, pollMs('normal'));
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  return (
    <button onClick={toggle} className="relative p-1.5 rounded-lg hover:bg-gray-100 transition-colors" aria-label={tAttr('알림')}>
      <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      </svg>
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center min-w-[18px] h-[18px] px-1">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}

export function NotificationPanel() {
  const { notifications, isOpen, close, markRead, markAllRead, fetchError } = useNotificationStore();
  const tAttr = useTAttr();
  const panelRef = useRef<HTMLDivElement>(null);
  // 🔴 컨테이너(main) 밖으로 뻗어 잘리지 않게 여는 방향을 정한다 — 정본 하나(useEdgeSafeAlign)
  const { alignClass } = useEdgeSafeAlign(isOpen, 340, panelRef);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) close();
    };
    if (isOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, close]);

  const hasUnread = useMemo(() => notifications.some((n) => !n.read), [notifications]);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className={`absolute ${alignClass} top-full mt-2 w-[340px] bg-white rounded-2xl border border-gray-200 shadow-xl z-50 max-h-[420px] flex flex-col overflow-hidden`}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900"><T k="알림" /></h3>
          {notifications.length > 0 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 whitespace-nowrap">
              {notifications.length}건
            </span>
          )}
        </div>
        {hasUnread && (
          <button
            onClick={markAllRead}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium"
          >
            <T k="모두 읽음" />
          </button>
        )}
      </div>

      {/* Notification list */}
      <div className="flex-1 overflow-y-auto" style={{ maxHeight: '300px' }}>
        {notifications.length === 0 ? (
          <div className="py-12 text-center">
            <svg className="w-10 h-10 mx-auto text-gray-200 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
            {/* 🔴 조회 실패를 "새 알림이 없습니다"로 말하지 않는다 — 미확인 위급값·결재가 있는지조차 모른다 */}
            <p className={`text-xs ${fetchError ? 'text-amber-600' : 'text-gray-400'}`}>
              {fetchError ? <T k='알림을 불러오지 못했습니다 — "없음"이 아닙니다' /> : <T k="새 알림이 없습니다" />}
            </p>
          </div>
        ) : (
          notifications.map((n) => {
            const tc = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.system;
            // 🔴 서버가 중요도를 안 주면 'info'(초록)가 아니라 '미기재'다
            const severity = (n as Notification & { severity?: string }).severity ?? 'unknown';
            // 🔴 미지 중요도를 info(초록)로 접지 않는다 — 모르는 것은 회색 + '미기재' 라벨
            const severityDot = SEVERITY_DOT[severity] ?? SEVERITY_DOT.unknown;
            const severityWord = SEVERITY_WORD[severity] ?? SEVERITY_WORD.unknown;

            return (
              <Link
                key={n.id}
                href={n.href ?? '#'}
                onClick={() => { markRead(n.id); close(); }}
                className={`flex items-start gap-3 px-4 py-3 hover:bg-blue-50/50 transition-colors border-b border-gray-50 last:border-0 ${!n.read ? 'bg-blue-50/30' : ''}`}
              >
                {/* Severity dot */}
                <div className="flex flex-col items-center gap-1 pt-1.5 flex-shrink-0">
                  {/* 🔴 색 + 라벨 병기 — 색각이상·스크린리더에도 중요도가 전달돼야 한다 */}
                  <span className={`w-2 h-2 rounded-full ${severityDot}`} role="img" aria-label={tAttr(severityWord)} title={tAttr(severityWord)} />
                </div>
                {/* Icon */}
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${tc.color}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={tc.icon} />
                  </svg>
                </div>
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-sm truncate ${!n.read ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                      {n.title}
                    </p>
                    <span className="text-[10px] text-gray-400 flex-shrink-0 whitespace-nowrap">
                      {getRelativeTime(n.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{n.message}</p>
                  <span className={`inline-block mt-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${tc.color}`}>
                    <T k={tc.label} />
                  </span>
                </div>
                {/* Unread indicator */}
                {!n.read && <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-2" />}
              </Link>
            );
          })
        )}
      </div>

      {/* Footer */}
      {notifications.length > 0 && (
        <div className="px-4 py-2.5 border-t border-gray-100 flex-shrink-0">
          <Link
            href="/notifications"
            onClick={close}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium"
          >
            <T k="전체 알림 보기" />
          </Link>
        </div>
      )}
    </div>
  );
}
