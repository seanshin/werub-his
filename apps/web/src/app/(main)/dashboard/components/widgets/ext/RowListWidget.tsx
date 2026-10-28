'use client';
import type { ReactNode } from 'react';
import ApiWidget from '../ApiWidget';
import { T, Tf } from '@/components/ui/i18n-text';
import { KDate } from '@/components/ui/display';
import { kstDateOf, kstToday } from '@/lib/kst-today';

const MAX_ROWS = 8;

export type Row = { key?: string; label: ReactNode; right?: ReactNode; tone?: 'rose' | 'amber' | 'gray' };

/**
 * 공용 목록 위젯 — endpoint 응답을 pick()으로 Row[]로 변환해 렌더.
 * pick은 배열/객체 응답을 모두 받아 안전하게 행 배열을 반환해야 한다.
 * (원시 JSON 노출·라벨 누락 방지: 도메인별 필드 매핑을 pick에 명시)
 */
export default function RowListWidget({ widgetId, endpoint, pick, empty, refetchInterval }: {
  widgetId: string;
  endpoint: string;
  pick: (data: any) => Row[];
  empty: string;
  refetchInterval?: number;
}) {
  return <ApiWidget widgetId={widgetId} endpoint={endpoint} refetchInterval={refetchInterval} render={(data) => {
    // 🔴 종전 `catch { rows = [] }` — 파싱 오류(응답 shape 변경 등)가 "격리 환자 없음"·"응급 대기 없음"
    //    으로 둔갑했다. 실패는 0건이 아니다(P17). 실패는 실패라고 말하고 콘솔에 남긴다.
    let rows: Row[];
    try {
      rows = pick(data) ?? [];
    } catch (e) {
      console.error(`[widget:${widgetId}] 응답 해석 실패`, e);
      return <p className="text-xs text-red-600"><T k="응답 해석 실패 — 0건이 아니라 확인 필요" /></p>;
    }
    if (!rows.length) return <p className="text-xs text-gray-400"><T k={empty} /></p>;
    return (
      <div className="space-y-1.5 text-xs">
        {rows.slice(0, MAX_ROWS).map((r, i) => (
          <div key={r.key ?? i} className="flex justify-between items-center py-1 border-b border-gray-50 last:border-0">
            <span className="font-medium text-gray-800 truncate">{r.label}</span>
            <span className={`whitespace-nowrap ml-2 ${r.tone === 'rose' ? 'text-rose-600 font-semibold' : r.tone === 'amber' ? 'text-amber-600' : 'text-gray-500'}`}>{r.right}</span>
          </div>
        ))}
        {/* 🔴 자르면 잘랐다고 말한다(2026-10-02) — 종전엔 80건 중 8건을 그리고 아무 말도 없었다 */}
        {rows.length > MAX_ROWS && (
          <p className="pt-1 text-[11px] text-gray-400" data-row-truncated><Tf k="{전체}건 중 {표시}건 표시" params={{ 전체: rows.length, 표시: MAX_ROWS }} /></p>
        )}
      </div>
    );
  }} />;
}

/** 응답이 배열이면 그대로, 객체면 지정 키의 배열을 꺼낸다. */
export function asArray(data: any, key?: string): any[] {
  if (Array.isArray(data)) return data;
  if (key && Array.isArray(data?.[key])) return data[key];
  return [];
}

/**
 * 행 시각 — 오늘(KST)이면 시각만, 아니면 월·일(2026-10-02).
 * 🔴 지난 결과·오래된 대기 건을 시각만 그리면 "오늘 12:55"로 읽힌다(8월 결과가 오늘 것처럼 보였다).
 */
export function When({ at }: { at?: string | null }) {
  if (!at) return null;
  return kstDateOf(at) === kstToday() ? <KDate value={at} mode="time" /> : <KDate value={at} mode="monthDay" />;
}
