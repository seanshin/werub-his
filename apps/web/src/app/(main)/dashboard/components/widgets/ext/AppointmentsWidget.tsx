'use client';
import ApiWidget from '../ApiWidget';
import { kdate } from '@/lib/ui-settings';
import StatusBadge from '@/components/ui/StatusBadge';

import { EmptyState } from '@/components/ui/display';
import { T } from '@/components/ui/i18n-text';

const hhmm = (s?: string) => (s ?kdate(s, 'time') : '');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// 이름이 없으면 null — 렌더 자리에서 `(이름없음)` 을 i18n 층으로 그린다(ko 표시는 종전과 같다)
function patientName(item: any): string | null {
  const p = item.patient;
  if (p && (p.familyName || p.givenName)) return `${p.familyName ?? ''}${p.givenName ?? ''}`;
  if (item.familyName || item.givenName) return `${item.familyName ?? ''}${item.givenName ?? ''}`;
  return item.name ?? null;
}

export default function AppointmentsWidget() {
  return <ApiWidget widgetId="appointments" endpoint={`/api/v1/appointments?date=${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })}&limit=10`} render={(data) => (
    <div className="space-y-1.5 text-xs">
      {Array.isArray(data) && data.length > 0 ? data.slice(0, 8).map((item: any, i: number) => {
        return (
          <div key={item.id ?? i} className="flex justify-between items-center py-1 border-b border-gray-50 last:border-0">
            <span className="font-medium text-gray-800 truncate">
              <span className="text-gray-400 mr-1.5">{hhmm(item.scheduledAt)}</span>{patientName(item) ?? <T k="(이름없음)" />}
              {item.doctor && <span className="text-gray-400 font-normal ml-1.5">· {item.doctor.familyName}{item.doctor.givenName}</span>}
            </span>
            <StatusBadge domain="appointment" status={item.status ?? ''} className="ml-2 whitespace-nowrap" />
          </div>
        );
      }) : <EmptyState compact icon="📅" title="오늘 예약이 없습니다" />}
    </div>
  )} />;
}
