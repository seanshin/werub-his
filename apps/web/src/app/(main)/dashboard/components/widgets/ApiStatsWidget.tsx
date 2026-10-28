'use client';

import type { ReactNode } from 'react';
import { useWidgetQuery } from '../../hooks/use-widget-query';
import WidgetForbidden from '../WidgetForbidden';
import { T } from '@/components/ui/i18n-text';

interface StatItem {
  key: string;
  label: string;
  color?: string;
  /**
   * 값 포맷터.
   *
   * 🔴 종전 시그니처는 `(v) => string` 이라 **위젯이 응답의 분모에 닿을 수 없었다** —
   *    가동률·준수율 칸이 구조적으로 `72%` 처럼 **분모 없는 퍼센트**밖에 그릴 수 없었다
   *    (등록 병상 2개 중 1개도 50%, 200개 중 100개도 50%).
   *    → 두 번째 인자로 **응답 전체(row)** 를 넘겨 `<Ratio numerator denominator>` 를 그릴 수 있게 넓혔다.
   *
   * 하위호환: 첫 인자 타입·인자 개수는 그대로다(기존 `(v) => \`${v}%\`` 호출부는 무변경 컴파일).
   * 반환형만 `string` → `ReactNode` 로 넓혀 정본 부품을 반환할 수 있다.
   */
  format?: (v: any, row?: Record<string, unknown>) => ReactNode;
}

interface ApiStatsWidgetProps {
  widgetId: string;
  endpoint: string;
  stats: StatItem[];
  refetchInterval?: number;
  /** 응답 shape 이 stats 키와 다를 때(예: groupBy 배열) 키 해석 전에 한 번 변환 */
  transform?: (data: any) => any;
}

/** 범용 API 통계 카드 위젯 — endpoint → 숫자 그리드 자동 렌더링 */
export default function ApiStatsWidget({ widgetId, endpoint, stats, refetchInterval = 60000, transform }: ApiStatsWidgetProps) {
  const { data: rawData, isLoading, isForbidden, error } = useWidgetQuery<any>(
    ['widget', widgetId],
    endpoint,
    { refetchInterval },
  );
  const data = rawData != null && transform ? transform(rawData) : rawData;

  if (isForbidden) return <WidgetForbidden widgetId={widgetId} />;
  if (isLoading) return <div className="flex items-center justify-center h-full text-xs text-gray-400"><T k="로딩..." /></div>;
  // 🔴 조회 실패를 '데이터 없음'(=진짜 0)이라 말하지 않는다 — 확인 못 한 것과 없는 것은 다르다(P17)
  if (error) return <div className="flex items-center justify-center h-full text-xs text-red-600"><T k="조회 실패 — 확인 필요" /></div>;
  if (!data) return <div className="flex items-center justify-center h-full text-xs text-gray-400"><T k="데이터 없음" /></div>;

  return (
    <div className="grid grid-cols-2 gap-3">
      {stats.map((s) => {
        // 점(.) 경로 지원 — 중첩 응답(예: 'ipsg5.activeInfections')도 매핑. 플랫 키는 단일 스텝(하위호환).
        const val = s.key.split('.').reduce<any>((o, k) => (o == null ? o : o[k]), data);
        return (
          <div key={s.key} className="text-center">
            <p className={`text-lg font-bold ${s.color ?? 'text-gray-900'}`}>
              {s.format ? s.format(val, data as Record<string, unknown>) : (val ?? '-')}
            </p>
            <p className="text-[10px] text-gray-500"><T k={s.label} /></p>
          </div>
        );
      })}
    </div>
  );
}
