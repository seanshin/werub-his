'use client';

import { useEffect, useMemo, useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { Unit } from '@/components/ui/display';
import { useRouter } from 'next/navigation';
import { useNotificationStore, Notification } from '@/stores/notification-store';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'border-l-4 border-red-600 bg-red-50',
  high: 'border-l-4 border-orange-500 bg-orange-50',
  warning: 'border-l-4 border-yellow-500 bg-yellow-50',
  moderate: 'border-l-4 border-blue-400 bg-blue-50',
  info: 'border-l-4 border-gray-300 bg-gray-50',
  low: 'border-l-4 border-gray-200 bg-white',
};
const SEVERITY_LABELS: Record<string, string> = { critical: '긴급', high: '높음', warning: '주의', moderate: '보통', info: '정보', low: '낮음' };
const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-600 text-white', high: 'bg-orange-500 text-white', warning: 'bg-yellow-500 text-white', moderate: 'bg-blue-400 text-white', info: 'bg-gray-300 text-gray-700', low: 'bg-gray-200 text-gray-600',
};

interface Category { key: string; label: string; icon: string; match?: (t: string) => boolean }
const CATEGORIES: Category[] = [
  { key: 'safety',   label: '안전·위급', icon: '🚨', match: (t) => /ICU|FALL|VITAL|CRITICAL|EWS|CODE_|SEPSIS|DNR/.test(t) },
  { key: 'clinical', label: '임상·검사', icon: '🔬', match: (t) => /ORDER|LAB|DISPENS|PHARM|RESULT|IMAG|NURSING|ASSESS|MAR/.test(t) },
  { key: 'surgery',  label: '수술·동의', icon: '🏥', match: (t) => /PROTOCOL|CONSENT|SIGN|SURGERY|OPERAT/.test(t) },
  { key: 'billing',  label: '수납·청구', icon: '💳', match: (t) => /BILLING|CLAIM|PAYMENT|UNPAID|OVERDUE|SETTLE|INSUR/.test(t) },
  { key: 'comm',     label: '호출·소통', icon: '📞', match: (t) => /CALL|MESSAGE|HANDOFF|BROADCAST/.test(t) },
  { key: 'voc',      label: '상담·VoC', icon: '💬', match: (t) => /VOC|CONSULT/.test(t) },
  { key: 'security', label: '보안·기기', icon: '🔐', match: (t) => /SECURITY|DEVICE|AUTH|ACCESS|LOGIN|CERT|GUARDIAN/.test(t) },
  { key: 'system',   label: '시스템',   icon: '⚙️' },
];
const CAT_ICON: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.icon]));
function categoryOf(n: Notification): string {
  const t = (n.rawType ?? n.type ?? '').toUpperCase();
  return CATEGORIES.find((c) => c.match?.(t))?.key ?? 'system';
}

type FilterRead = 'all' | 'unread' | 'read';
type FilterSev = 'all' | 'critical' | 'warning';
/** 필터 라벨(i18n 키) — 값은 코드(`all`·`unread`…) */
const READ_LABEL: Record<FilterRead, string> = { all: '전체', unread: '읽지 않음', read: '읽음' };
const SEV_FILTER_LABEL: Record<FilterSev, string> = { all: '전체', critical: '긴급·높음', warning: '주의' };

export default function NotificationsPage() {
  const router = useRouter();
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const { notifications, unreadCount, fetchError, hasFetched, fetchNotifications, markRead, markAllRead, connectSSE, disconnectSSE } = useNotificationStore();
  const [cat, setCat] = useState<string>('all');
  const [filterRead, setFilterRead] = useState<FilterRead>('all');
  const [filterSev, setFilterSev] = useState<FilterSev>('all');

  useEffect(() => {
    fetchNotifications();
    connectSSE();
    return () => disconnectSSE();
  }, [fetchNotifications, connectSSE, disconnectSSE]);

  // 카테고리별 건수(미읽음)
  const catCounts = useMemo(() => {
    const m: Record<string, { total: number; unread: number }> = {};
    for (const n of notifications) {
      const k = categoryOf(n);
      (m[k] ??= { total: 0, unread: 0 }).total++;
      if (!n.read) m[k].unread++;
    }
    return m;
  }, [notifications]);

  const filtered = useMemo(() => notifications.filter((n) => {
    if (cat !== 'all' && categoryOf(n) !== cat) return false;
    if (filterRead === 'unread' && n.read) return false;
    if (filterRead === 'read' && !n.read) return false;
    if (filterSev === 'critical' && !(n.severity === 'critical' || n.severity === 'high')) return false;
    if (filterSev === 'warning' && n.severity !== 'warning') return false;
    return true;
  }), [notifications, cat, filterRead, filterSev]);

  // 시간대 그룹
  const groups = useMemo(() => {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const week = startToday - 6 * 86400000;
    const g: { key: string; label: string; items: Notification[] }[] = [
      { key: 'today', label: '오늘', items: [] },
      { key: 'week', label: '최근 7일', items: [] },
      { key: 'older', label: '이전', items: [] },
    ];
    for (const n of filtered) {
      const t = new Date(n.createdAt).getTime();
      (t >= startToday ? g[0] : t >= week ? g[1] : g[2]).items.push(n);
    }
    return g.filter((x) => x.items.length);
  }, [filtered]);

  const formatTime = (iso: string) => {
    const d = new Date(iso); const diff = Date.now() - d.getTime();
    if (diff < 60000) return tAttr('방금 전');
    if (diff < 3600000) return tfAttr('{분}분 전', { 분: Math.floor(diff / 60000) });
    if (diff < 86400000) return tfAttr('{시}시간 전', { 시: Math.floor(diff / 3600000) });
    return kdate(d, 'datetimeShort');
  };
  const onClick = (n: Notification) => { if (!n.read) markRead(n.id); if (n.href) router.push(n.href); };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="알림 센터" /></h1>
          <p className="text-sm text-gray-500 mt-1"><Tf k="읽지 않은 알림 {미읽음} · 총 {전체}" params={{ 미읽음: <>{unreadCount}<Unit>건</Unit></>, 전체: <>{notifications.length}<Unit>건</Unit></> }} /></p>
        </div>
        <button onClick={markAllRead} disabled={unreadCount === 0} className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 disabled:opacity-50"><T k="모두 읽음" /></button>
      </div>

      {/* 카테고리 칩 (건수·미읽음) */}
      <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
        <CatChip active={cat === 'all'} onClick={() => setCat('all')} icon="🔔" label="전체" total={notifications.length} unread={unreadCount} />
        {CATEGORIES.map((c) => {
          const cc = catCounts[c.key];
          if (!cc) return null;
          return <CatChip key={c.key} active={cat === c.key} onClick={() => setCat(c.key)} icon={c.icon} label={c.label} total={cc.total} unread={cc.unread} />;
        })}
      </div>

      {/* 읽음·심각도 필터 */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          {(['all', 'unread', 'read'] as FilterRead[]).map((f) => (
            <button key={f} onClick={() => setFilterRead(f)} className={`px-3 py-1.5 text-xs font-medium ${filterRead === f ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}><T k={READ_LABEL[f]} /></button>
          ))}
        </div>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          {(['all', 'critical', 'warning'] as FilterSev[]).map((f) => (
            <button key={f} onClick={() => setFilterSev(f)} className={`px-3 py-1.5 text-xs font-medium ${filterSev === f ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}><T k={SEV_FILTER_LABEL[f]} /></button>
          ))}
        </div>
      </div>

      {/* 🔴 (2026-09-30) 조회 실패가 "알림이 없습니다"로 그려졌다 — 미확인 위급값·결재가 있는지 모르는 상태를 "없다"로 단정했다.
          실패는 실패로 말하고 다시 시도할 수 있게 한다. 이미 받은 목록이 있으면 그 목록은 그대로 두고 경고만 얹는다. */}
      {fetchError && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">
            {notifications.length === 0
              ? <T k="알림을 불러오지 못했습니다 — 알림이 없는 것이 아니라 확인할 수 없는 상태입니다." />
              : <T k="알림 새로고침에 실패했습니다 — 아래 목록은 마지막으로 받은 것입니다." />}
          </p>
          <button onClick={() => { void fetchNotifications(); }} className="min-h-[36px] shrink-0 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100">
            <T k="다시 시도" />
          </button>
        </div>
      )}

      {/* 시간대 그룹 목록 */}
      {groups.length === 0 && fetchError && notifications.length === 0 ? null
        : !hasFetched && notifications.length === 0 ? (
        // 첫 응답 전 — 아직 모르는 것을 "없음"으로 그리지 않는다
        <div className="h-32 rounded-lg bg-gray-50 animate-pulse" aria-busy="true" />
      ) : groups.length === 0 ? (
        <div className="text-center py-16 text-gray-400"><p className="text-4xl mb-2">🔔</p><p><T k="알림이 없습니다" /></p></div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.key}>
              <p className="text-xs font-semibold text-gray-400 mb-2 px-1"><T k={g.label} /> · {g.items.length}</p>
              <div className="space-y-2">
                {g.items.map((n) => (
                  <div key={n.id} onClick={() => onClick(n)} className={`p-3 rounded-lg cursor-pointer transition-all ${SEVERITY_STYLES[n.severity || 'info']} ${n.read ? 'opacity-60' : ''} hover:shadow-sm`}>
                    <div className="flex items-start gap-3">
                      <span className="text-lg flex-shrink-0">{CAT_ICON[categoryOf(n)] || '🔔'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-semibold text-sm text-gray-900 truncate">{n.title}</span>
                          {n.severity && n.severity !== 'info' && n.severity !== 'low' && (
                            <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded whitespace-nowrap ${SEVERITY_BADGE[n.severity]}`}>{SEVERITY_LABELS[n.severity] ? <T k={SEVERITY_LABELS[n.severity]} /> : null}</span>
                          )}
                          {!n.read && <span className="w-2 h-2 bg-blue-600 rounded-full flex-shrink-0" />}
                        </div>
                        <p className="text-sm text-gray-600 truncate">{n.message}</p>
                      </div>
                      <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">{formatTime(n.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CatChip({ active, onClick, icon, label, total, unread }: { active: boolean; onClick: () => void; icon: string; label: string; total: number; unread: number }) {
  return (
    <button onClick={onClick} className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
      <span aria-hidden="true">{icon}</span>
      {/* label 은 원문 키 — 여기서 번역한다(호출부가 번역해 넘기면 이중 번역) */}
      <span><T k={label} /></span>
      <span className={`px-1.5 rounded-full text-[10px] ${active ? 'bg-white/25' : 'bg-gray-100'}`}>{total}</span>
      {unread > 0 && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
    </button>
  );
}
