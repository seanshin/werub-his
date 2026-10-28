'use client';

import type { EgressDataClass, EgressCrossBorderRisk, EgressRoute, EgressSummary } from '@hospital-run/shared';
import { Data, T, Tf } from '@/components/ui/i18n-text';

/**
 * 🔴 외부 전송 경로(T10-4 데이터 소재지 — 결정 전 목록화·동결).
 *
 * 메시지 채널(위 목록)과 달리 **서버 코드가 병원 밖으로 부르는 모든 호출 지점**을 경로로 묶는다.
 * 정본은 shared `EGRESS_ROUTES` 하나 — 코드 스캔 가드(`egress-inventory-guard.spec.ts`)가 동결한다.
 *
 * 🔴 판정하지 않는다 — 국외 이전 허용/금지는 국가 프로파일 결정 뒤. 목적지는 코드가 가리키는 설정 키이고
 *    운영 설정값이 원내인지는 확인하지 않았다(그래서 "원내"로 접힌 경로가 없다).
 * 🔴 불명을 0 으로도 비PHI 로도 접지 않는다 — 요약에 따로 세고 배지도 따로 그린다.
 */
export interface EgressInventory {
  routes: (EgressRoute & { crossBorderRisk: EgressCrossBorderRisk })[];
  summary: EgressSummary;
  verdictNote: string;
}

const CLASS_VIEW: Record<EgressDataClass, { label: string; cls: string }> = {
  PHI: { label: '환자정보(PHI)', cls: 'bg-red-50 text-red-700 border-red-200' },
  PSEUDONYMOUS: { label: '가명정보', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  NON_PHI: { label: '비PHI', cls: 'bg-gray-50 text-gray-600 border-gray-200' },
  UNKNOWN: { label: '데이터 불명', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
};

const RISK_VIEW: Record<EgressCrossBorderRisk, { label: string; cls: string }> = {
  review: { label: '국외 이전 검토 대상', cls: 'bg-red-50 text-red-700 border-red-200' },
  unknown: { label: '검토 여부 불명', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  none: { label: '검토 대상 아님', cls: 'bg-gray-50 text-gray-600 border-gray-200' },
  internal: { label: '원내', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

const RISK_ORDER: EgressCrossBorderRisk[] = ['review', 'unknown', 'none', 'internal'];

export function EgressInventorySection({ egress }: { egress: EgressInventory | undefined }) {
  // 🔴 응답에 없으면 "경로 0"이 아니라 "정보 없음"이다
  if (!egress) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
        <p className="text-sm font-medium text-gray-700"><T k="외부 전송 경로" /></p>
        <p className="text-[11px] text-gray-500 mt-1"><T k="응답에 외부 전송 경로 목록이 없습니다 — 경로가 없다는 뜻이 아닙니다" /></p>
      </div>
    );
  }
  const { routes, summary, verdictNote } = egress;
  const sorted = [...routes].sort((a, b) => RISK_ORDER.indexOf(a.crossBorderRisk) - RISK_ORDER.indexOf(b.crossBorderRisk));

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden" data-testid="egress-inventory">
      <div className="px-5 py-3 border-b border-gray-100 space-y-1.5">
        <p className="text-sm font-medium text-gray-700"><T k="외부 전송 경로" /></p>
        <p className="text-[11px] text-gray-500">
          <T k="서버 코드가 병원 밖(설정된 주소 포함)으로 데이터를 보내는 호출 지점을 경로로 묶었습니다 — 코드 실측을 동결한 목록입니다." />
        </p>
        {/* 🔴 분모 병기 · 불명을 따로 센다 */}
        <p className="text-xs text-gray-700" data-testid="egress-summary">
          <Tf
            k="전체 경로 {전체}개 중 검토 대상(PHI·가명) {검토}개 · 데이터 불명 {불명}개 · 검토 대상 아님 {비대상}개"
            params={{ 전체: <b>{summary.total}</b>, 검토: <b>{summary.review}</b>, 불명: <b>{summary.unknown}</b>, 비대상: <b>{summary.none}</b> }}
          />
        </p>
        <p className="text-[11px] text-gray-500">
          <Tf k="고정 외부 호스트로 나가는 검토 대상·불명 경로 {n}개 — 나머지는 설정 주소라 운영값에 따라 원내일 수도 원외일 수도 있습니다" params={{ n: <b>{summary.fixedExternalReview}</b> }} />
        </p>
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
          <T k="국외 이전 판정 없음 — 국가 프로파일 결정 전" /> · <Data>{verdictNote}</Data>
        </p>
      </div>
      <div className="divide-y divide-gray-50">
        {sorted.map((r) => {
          const c = CLASS_VIEW[r.dataClass];
          const k = RISK_VIEW[r.crossBorderRisk];
          const calls = r.codeRefs.reduce((s, x) => s + x.calls, 0);
          return (
            <div key={r.id} className="px-5 py-3" data-testid={`egress-route-${r.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900"><Data>{r.label}</Data></p>
                  <p className="text-[11px] text-gray-400 mt-0.5 break-all">
                    <code>{r.id}</code> · <T k="목적지" /> <code>{r.destination}</code>
                    {' · '}<T k={r.network === 'FIXED_EXTERNAL' ? '고정 외부 호스트' : '설정 주소'} />
                  </p>
                </div>
                <div className="shrink-0 flex flex-wrap justify-end gap-1">
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${c.cls}`}><T k={c.label} /></span>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${k.cls}`}><T k={k.label} /></span>
                </div>
              </div>
              <p className="text-[11px] text-gray-500 mt-1"><Data>{r.note}</Data></p>
              <p className="text-[11px] text-gray-400 mt-0.5 break-all">
                <Tf k="호출 {n}곳" params={{ n: calls }} />:{' '}
                {r.codeRefs.map((x) => <code key={x.file} className="mx-0.5">{x.file.replace(/^apps\/api\/src\//, '')}×{x.calls}</code>)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
