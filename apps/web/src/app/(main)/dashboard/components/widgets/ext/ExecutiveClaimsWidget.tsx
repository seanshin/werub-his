'use client';
import Link from 'next/link';
import ApiWidget from '../ApiWidget';
import { T } from '@/components/ui/i18n-text';
import { Money, Unit } from '@/components/ui/display';

/**
 * 이번 달 청구 — `GET /api/v1/executive/claims`(경영 화면과 같은 응답).
 * 🔴 (2026-10-02) 종전 경영진 배치의 '청구 현황'은 `/claims/summary`(관리자 전용)를 불러 경영진에게 늘 403 이었다.
 *    삭감률은 표본(청구 금액)이 없으면 서버가 null 과 사유(note)를 준다 — 0% 로 그리지 않고 그 문장을 보인다.
 */
interface Claims {
  count?: number; draft?: number; submitted?: number; approved?: number;
  totalClaimed?: number | null; reductionRatePct?: { value: number | null; n: number }; note?: string | null;
}

export default function ExecutiveClaimsWidget() {
  return <ApiWidget widgetId="executive-claims" endpoint="/api/v1/executive/claims" refetchInterval={300000} render={(raw) => {
    const d = (raw ?? {}) as Claims;
    return (
      <div className="flex h-full flex-col text-xs" data-executive-claims>
        <div className="mb-2 grid grid-cols-4 gap-1 text-center">
          {([['count', '전체'], ['draft', '작성 중'], ['submitted', '제출'], ['approved', '승인']] as const).map(([k, l]) => (
            <div key={k}>
              <p className="text-lg font-bold tabular-nums text-gray-900">{d[k] ?? '-'}</p>
              <p className="text-[10px] text-gray-500"><T k={l} /></p>
            </div>
          ))}
        </div>
        <div className="flex justify-between border-t border-gray-50 pt-1.5">
          <span className="text-gray-500"><T k="청구 금액" /></span>
          <Money value={d.totalClaimed} className="font-semibold text-gray-900" />
        </div>
        <div className="flex justify-between py-1">
          <span className="text-gray-500"><T k="삭감률" /></span>
          {d.reductionRatePct?.value == null
            ? <span className="text-right text-gray-400">{d.note ?? '-'}</span>
            : <span className="font-semibold">{d.reductionRatePct.value}<Unit>%</Unit></span>}
        </div>
        <div className="mt-auto pt-2 text-[11px]"><Link href="/executive" className="text-blue-600 hover:underline"><T k="경영 화면" /></Link></div>
      </div>
    );
  }} />;
}
