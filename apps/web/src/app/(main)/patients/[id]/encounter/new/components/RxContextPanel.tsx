'use client';

import { useQuery } from '@tanstack/react-query';
import { Unit } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { allergyNotice, drugShort, isAbnormalLab, sortLabs } from './rx-context';
import { T } from '@/components/ui/i18n-text';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

/**
 * 처방 참고 패널 — 처방/협진 열의 남는 공간을 **처방 판단에 필요한 근거**로 채운다.
 *
 * 무엇을 넣지 않았는가가 더 중요하다: 환자 차트 전체(참조 패널 소관)나 과거 진료 본문(하단 목록 소관)을
 * 옮겨오지 않는다. 여기 있는 것은 **지금 약을 낼 때 손이 가는 정보**뿐이다 —
 *   ① 알레르기(3-상태: 미문진≠없음)  ② 현재 복용약(중복·상호작용 인지)
 *   ③ 최근 검사 이상치(용량·금기 판단 근거)  ④ 지난 처방(반복 처방 재입력 제거)
 *
 * 클릭은 **검색창에 약품명을 넣는 것까지만** 한다 — 처방 추가는 정본 흐름(DUR·포뮬러리 게이트)을 거쳐야 하므로
 * 여기서 바로 담지 않는다.
 */
interface PatientContext {
  allergies: string[];
  allergyStatus?: string;
  medications: string[];
  problems: string[];
  recentLabs?: string[];
}

interface TimelineRx {
  id: string;
  at: string;
  title?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  duration?: number | null;
  rxType?: string | null;
  status?: string | null;
}

const shortDate = (iso: string) => {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return '';
  }
};


export function RxContextPanel({
  patientId,
  onPickDrug,
  className = '',
}: {
  patientId: string;
  /** 약품명을 처방 검색창에 넣는다(담기는 정본 흐름) */
  onPickDrug?: (name: string) => void;
  className?: string;
}) {
  // 🔴 조회 실패·로딩을 '기록 없음'으로 말하지 않는다 — 종전엔 403·500 이어도 "알레르기 기록 없음·복용약 없음"이었다(2026-09-30)
  const { data: ctxRes, isLoading: ctxLoading, isError: ctxIsError, error: ctxErr, refetch: refetchCtx } = useQuery({
    queryKey: ['patient-context', patientId],
    queryFn: () => apiClient.get<{ data: PatientContext }>(`/api/v1/ai/patient-context/${patientId}`),
    staleTime: 5 * 60 * 1000,
  });
  const ctx = ((ctxRes?.data as unknown as { data?: PatientContext })?.data ?? ctxRes?.data) as PatientContext | undefined;

  const { data: rxRes, isLoading: rxLoading, isError: rxIsError, error: rxErr, refetch: refetchRx } = useQuery({
    queryKey: ['encounter-rx-history', patientId],
    queryFn: () =>
      apiClient.get<{ data: { items: TimelineRx[] } }>(
        `/api/v1/patients/${patientId}/record-timeline?types=PRESCRIPTION&limit=40`,
      ),
    staleTime: 5 * 60 * 1000,
  });
  const rxHistory = (rxRes?.data?.items ?? []).filter((r) => r.rxType === 'MEDICATION' || !r.rxType);

  const labs = sortLabs(ctx?.recentLabs ?? []);
  const allergy = allergyNotice(ctx?.allergies, ctx?.allergyStatus);
  const ctxPending = ctxLoading || ctxIsError; // 이때는 아래 세 칸(알레르기·복용·검사)을 그리지 않는다

  return (
    <div className={`rounded-2xl border border-gray-100 bg-white p-4 shadow-sm ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <h3 className="text-sm font-semibold text-gray-900"><T k="처방 참고" /></h3>
        <span className="text-[11px] text-gray-400"><T k="지금 약을 낼 때 필요한 것만" /></span>
      </div>

      <div className="space-y-3">
        {ctxIsError && <QueryErrorFallback error={ctxErr} onRetry={() => refetchCtx()} size="compact" />}
        {ctxLoading && <p className="text-[11px] text-gray-400" data-rx-context-loading><T k="불러오는 중…" /></p>}
        {!ctxPending && (<>
        {/* 알레르기 — 🔴 빈 배열은 '없음'이 아니라 '기록 없음'이다(미문진 ≠ 무알레르기) */}
        <section>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400"><T k="알레르기" /></p>
          {allergy.kind === 'LIST' ? (
            <div className="flex flex-wrap gap-1">
              {(ctx?.allergies ?? []).map((a) => (
                <span key={a} className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700 ring-1 ring-rose-200">
                  {a}
                </span>
              ))}
            </div>
          ) : allergy.kind === 'NKA' ? (
            <p className="text-[11px] text-gray-600"><T k={allergy.text!} /></p>
          ) : (
            <p className="text-[11px] text-gray-400">
              <T k={allergy.text!} /> <span className="text-gray-300"><T k="— 미문진일 수 있으니 확인 후 처방" /></span>
            </p>
          )}
        </section>

        {/* 현재 복용약 — 중복 처방·상호작용을 손으로 짚을 수 있게 */}
        <section>
          <p className="mb-1 flex items-baseline gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            현재 복용
            {ctx?.medications?.length ? <span className="tabular-nums text-gray-400">{ctx.medications.length}<Unit>종</Unit></span> : null}
          </p>
          {ctx?.medications?.length ? (
            <div className="flex flex-wrap gap-1">
              {ctx.medications.map((m) => (
                <button
                  key={m}
                  type="button"
                  title={`${m}\n클릭하면 처방 검색창에 넣습니다`}
                  onClick={() => onPickDrug?.(drugShort(m))}
                  className="max-w-[15rem] truncate rounded-md bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-700 transition-colors hover:bg-blue-50 hover:text-blue-700"
                >
                  {drugShort(m)}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-gray-400"><T k="복용 중인 약 기록 없음" /></p>
          )}
        </section>

        {/* 최근 검사 — 이상치를 앞으로(용량 조절·금기 판단 근거) */}
        <section>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400"><T k="최근 검사" /></p>
          {labs.length ? (
            <div className="flex flex-wrap gap-1">
              {labs.map((l) => (
                <span
                  key={l}
                  className={`rounded-md px-1.5 py-0.5 text-[11px] tabular-nums ${
                    isAbnormalLab(l) ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' : 'bg-gray-50 text-gray-600'
                  }`}
                >
                  {l}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-gray-400"><T k="최근 검사 결과 없음" /></p>
          )}
        </section>
        </>)}

        {/* 지난 처방 — 반복 처방을 다시 타이핑하지 않게(담기는 정본 흐름) */}
        <section>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400"><T k="지난 처방" /></p>
          {rxIsError ? (
            <QueryErrorFallback error={rxErr} onRetry={() => refetchRx()} size="compact" />
          ) : rxLoading ? (
            <p className="text-[11px] text-gray-400"><T k="불러오는 중…" /></p>
          ) : rxHistory.length ? (
            <ul className="divide-y divide-gray-50">
              {rxHistory.slice(0, 8).map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => r.title && onPickDrug?.(drugShort(r.title))}
                    title={`${r.title ?? ''}\n클릭하면 처방 검색창에 넣습니다`}
                    className="flex w-full items-baseline gap-2 py-1 text-left transition-colors hover:bg-gray-50"
                  >
                    <span className="w-9 shrink-0 text-[10px] tabular-nums text-gray-400">{shortDate(r.at)}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-gray-800">{r.title ? drugShort(r.title) : '—'}</span>
                    <span className="shrink-0 text-[10px] text-gray-400">
                      {[r.dosage, r.frequency, r.duration ? `${r.duration}일` : null].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-gray-400"><T k="지난 약 처방 없음" /></p>
          )}
        </section>
      </div>

      <p className="mt-3 border-t border-gray-100 pt-2 text-[10px] text-gray-400">
        <T k="항목을 누르면 검색창에 이름만 채워집니다 — 처방 추가는 DUR·포뮬러리 점검을 거칩니다." />
      </p>
    </div>
  );
}
