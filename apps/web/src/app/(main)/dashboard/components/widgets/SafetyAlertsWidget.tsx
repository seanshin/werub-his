'use client';
import { useNotificationStore, type Notification } from '@/stores/notification-store';
import { Unit } from '@/components/ui/display';
import Link from 'next/link';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 미확인 알림 — 같은 제목은 한 줄로 묶어 건수를 붙인다(2026-10-02 실화면).
 * 🔴 종전엔 최근 5건을 그대로 늘어놓아 "미서명 차트 회수"가 네 줄을 차지했고(미확인 77건 중 같은 제목),
 *    머리의 "미확인 알림 N건"은 **잘라낸 5건을 센 수**라 99건이 있어도 5건이라 말했다.
 *    또 첫 조회 전 빈 목록과 조회 실패를 "새 알림 없음"이라 말했다. 이름도 "안전·알림"이었지만 안전 지표가 아니라
 *    내 미확인 알림 목록이다 → 위젯 이름을 "미확인 알림"으로(머리가 이름을 말하므로 본문은 건수만).
 */
const URGENT = new Set(['critical', 'high']);
const MAX_GROUPS = 5;

interface Group { title: string; count: number; urgent: boolean; severityKnown: boolean; latest: string; href?: string }

export function groupUnread(list: Notification[]): Group[] {
  const by = new Map<string, Group>();
  for (const n of list) {
    if (n.read) continue;
    const g = by.get(n.title);
    const urgent = n.severity != null && URGENT.has(n.severity);
    if (!g) {
      by.set(n.title, { title: n.title, count: 1, urgent, severityKnown: n.severity != null, latest: n.createdAt, href: n.href });
    } else {
      g.count += 1;
      g.urgent ||= urgent;
      g.severityKnown ||= n.severity != null;
      if (n.createdAt > g.latest) { g.latest = n.createdAt; g.href = n.href ?? g.href; }
    }
  }
  // 위급 먼저, 그 안에서 많은 순, 같으면 최근 순
  return [...by.values()].sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.count - a.count || b.latest.localeCompare(a.latest));
}

export default function SafetyAlertsWidget() {
  const tt = useTAttr();
  const notifications = useNotificationStore((st) => st.notifications);
  const unreadCount = useNotificationStore((st) => st.unreadCount);
  const fetchError = useNotificationStore((st) => st.fetchError);
  const hasFetched = useNotificationStore((st) => st.hasFetched);
  const groups = groupUnread(notifications ?? []);
  const loadedCapped = (notifications ?? []).length >= 100;

  return (
    <div className="flex flex-col h-full">
      <div className="text-xs text-gray-500 mb-1.5">
        <b className="text-gray-900 tabular-nums">{hasFetched ? unreadCount : '…'}</b><Unit>건</Unit>
        {hasFetched && groups.length > 0 && <span className="text-gray-400"> · {groups.length}<Unit>종</Unit></span>}
        {loadedCapped && <span className="text-gray-400"> · <T k="최근 100건 기준" /></span>}
      </div>
      <div className="space-y-0.5 text-xs flex-1">
        {fetchError ? <span className="text-red-600"><T k="알림 조회 실패 — 확인 필요" /></span>
          : !hasFetched ? <span className="text-gray-400"><T k="불러오는 중" /></span>
          : groups.length === 0 ? <span className="text-gray-400"><T k="새 알림 없음" /></span>
          : groups.slice(0, MAX_GROUPS).map((g) => {
            const label = tt(!g.severityKnown ? '중요도 미기재' : g.urgent ? '위급' : '일반');
            const body = (
              <>
                {/* 🔴 색만으로 중요도를 말하지 않는다(§4.6) — 의미는 aria-label·title 에 */}
                <span aria-label={label} title={label}
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${g.urgent ? 'bg-red-500' : g.severityKnown ? 'bg-blue-400' : 'bg-gray-300'}`} />
                <span className="truncate text-gray-700 flex-1">{g.title}</span>
                {g.count > 1 && <span className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-600 tabular-nums">{g.count}</span>}
              </>
            );
            return g.href
              ? <Link key={g.title} href={g.href} className="flex items-center gap-1.5 rounded px-1 py-1 hover:bg-slate-50">{body}</Link>
              : <div key={g.title} className="flex items-center gap-1.5 px-1 py-1">{body}</div>;
          })}
        {hasFetched && groups.length > MAX_GROUPS && (
          <p className="px-1 pt-0.5 text-[11px] text-gray-400"><T k="외" /> {groups.length - MAX_GROUPS}<Unit>종</Unit></p>
        )}
      </div>
      <div className="mt-auto pt-2 text-[11px]"><Link href="/notifications" className="text-blue-600 hover:underline"><T k="전체 알림" /></Link></div>
    </div>
  );
}
