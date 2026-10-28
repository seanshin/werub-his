'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { kdate } from '@/lib/ui-settings';
import { useHasRole } from '@/hooks/use-admin-write';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf } from '@/components/ui/i18n-text';

/**
 * 진료 전 요약(2026-10-02) — 환자 차트 첫 화면이 의료진에게 먼저 말해야 하는 것.
 *
 * 🔴 종전 "AI 환자 요약"은 버튼을 눌러야 했고, 모델에 넘긴 것이 **건수뿐**이었다(`활성 처방: 34건` — 검사·영상 오더 포함,
 *    `활성 문제: 없음` — 문제 목록이 비었을 뿐 서명 진료에는 고혈압·당뇨·폐렴 진단이 있었다). 환자 설명문 생성 EP 를 빌려 썼고
 *    환자 지목 감사도 남지 않았다.
 * → 서버 결정론 브리핑(`GET ai/brief/:patientId` · LLM 없음 · 환자 지목 감사 · 근거 데이터가 바뀌면 다시 계산) 하나를 읽는다.
 *    해석하지 않는다 — 기록에 있는 값과 그 시각만 나열한다.
 */
export interface PatientBriefView {
  computedAt: string;
  trigger: string;
  basis: string[];
  activeMedications: string[];
  medicationDetails?: Array<{ name: string; dosage: string | null; frequency: string | null; latestPrescribedAt: string; durationDays: number | null; overDuration: boolean | null; count: number }>;
  activeProblems: string[];
  /** onProblemList — 같은 진단 코드가 문제 목록에 있는가(상태 무관) · null = 문제 목록을 읽지 못함(모름) */
  recordDiagnoses?: Array<{ code: string; name: string; lastAt: string; encounters: number; diagnosisCodeId?: string; onProblemList?: boolean | null }>;
  recentLabs: Array<{ testName: string; value: string; unit: string | null; flag: string | null; resultedAt: string | null }>;
  abnormalLabCount: number;
  lastLabAt?: string | null;
  lastEncounter: { at: string; chiefComplaint: string | null; assessment: string | null; status: string } | null;
  currentAdmission: { admittedAt: string; ward: string | null } | null;
  unavailable: string[];
}

/** 서버 `ai/brief` 의 역할 집합과 같다 — 밖의 역할은 부르지 않는다(403 을 "없음"으로 그리지 않게) */
export const BRIEF_ROLES = ['DOCTOR', 'NURSE', 'PHARMACIST'] as const;

export function usePatientBrief(patientId: string) {
  const allowed = useHasRole(...BRIEF_ROLES);
  const q = useQuery({
    queryKey: ['patient-brief', patientId],
    queryFn: () => apiClient.get<{ data: PatientBriefView | null }>(`/api/v1/ai/brief/${patientId}`),
    enabled: !!patientId && allowed,
    staleTime: 60_000,
  });
  return { allowed, ...q, brief: q.data?.data ?? null };
}

/** 며칠 전 — 날짜만 보면 오래된 기록을 최신처럼 읽는다 */
export function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export function AgoText({ at }: { at: string | null | undefined }) {
  const d = daysAgo(at);
  if (d == null) return null;
  return <span className={`text-[10px] ${d > 30 ? 'text-amber-700' : 'text-gray-400'}`}>{d === 0 ? <T k="오늘" /> : <Tf k="{일}일 전" params={{ 일: d }} />}</span>;
}

export function PatientBriefCard({ patientId, onTabChange }: { patientId: string; onTabChange: (tab: string) => void }) {
  const { allowed, brief, isLoading, isError, error, refetch, isFetching } = usePatientBrief(patientId);

  if (!allowed) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600" data-brief-gated>
        <T k="진료 전 요약은 임상 역할(의사·간호사·약사·관리자)에게만 보입니다 — 비어 있다는 뜻이 아닙니다." />
      </div>
    );
  }
  if (isLoading) return <div className="h-28 animate-pulse rounded-2xl bg-gray-100" />;
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} size="compact" />;
  if (!brief) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        <T k="진료 전 요약을 계산하지 못했습니다(서버 구성) — 아래 카드와 각 탭을 직접 확인하세요." />
      </div>
    );
  }

  const dx = brief.recordDiagnoses;
  const lastEnc = brief.lastEncounter;
  const medCount = brief.medicationDetails?.length ?? brief.activeMedications.length;
  const overDue = brief.medicationDetails?.filter((m) => m.overDuration === true).length ?? 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-brief-card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900"><T k="진료 전 요약" /></p>
          <p className="text-[10px] text-gray-500">
            <T k="기록에 있는 값만 모았습니다(AI 해석 아님)" /> · {kdate(brief.computedAt, 'datetimeShort')} <T k="기준" />
          </p>
        </div>
        <button type="button" onClick={() => void apiClient.get(`/api/v1/ai/brief/${patientId}?refresh=1`).finally(() => refetch())} disabled={isFetching}
          className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"><T k="다시 계산" /></button>
      </div>

      <dl className="grid gap-x-6 gap-y-3 text-xs md:grid-cols-2">
        {/* 지금 어디에 있는가 */}
        <div data-brief-status>
          <dt className="mb-0.5 font-semibold text-gray-500"><T k="현재" /></dt>
          <dd className="text-gray-800">
            {brief.currentAdmission
              ? <><span className="font-semibold text-indigo-700"><T k="재원 중" /></span> · {brief.currentAdmission.ward ?? <T k="병상 미배정" />} · <T k="입원" /> {kdate(brief.currentAdmission.admittedAt)} <AgoText at={brief.currentAdmission.admittedAt} /></>
              : <T k="재원 중 아님" />}
          </dd>
        </div>

        {/* 마지막 서명 진료 — 초안은 확정 기록이 아니다 */}
        <div data-brief-last-encounter>
          <dt className="mb-0.5 font-semibold text-gray-500"><T k="마지막 서명 진료" /></dt>
          <dd className="text-gray-800">
            {lastEnc ? (
              <>
                {kdate(lastEnc.at)} <AgoText at={lastEnc.at} />
                {lastEnc.chiefComplaint && <p className="truncate"><span className="text-gray-400">CC</span> {lastEnc.chiefComplaint}</p>}
                {lastEnc.assessment && <p className="truncate"><span className="text-gray-400">A</span> {lastEnc.assessment}</p>}
              </>
            ) : <span className="text-gray-500"><T k="서명된 진료 기록 없음" /></span>}
          </dd>
        </div>

        {/* 진단 — 문제 목록과 진료 기록 진단은 출처가 다르다(섞지 않는다) */}
        <div className="md:col-span-2" data-brief-diagnoses>
          <dt className="mb-0.5 font-semibold text-gray-500"><T k="진단" /></dt>
          <dd className="space-y-1 text-gray-800">
            {brief.activeProblems.length > 0 && (
              <p><span className="mr-1 rounded bg-amber-50 px-1 text-[10px] text-amber-800"><T k="문제 목록(활성·만성)" /></span>{brief.activeProblems.join(' · ')}</p>
            )}
            {dx && dx.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-600"><T k="진료 기록 진단(서명)" /></span>
                {dx.map((d) => (
                  <span key={d.code} className={`rounded-full border px-2 py-0.5 ${d.onProblemList === false ? 'border-amber-300 bg-amber-50/60' : 'border-gray-200'}`} title={`${d.encounters}회 · 마지막 ${kdate(d.lastAt)}`} data-brief-dx={d.code} data-on-problem-list={d.onProblemList == null ? 'unknown' : String(d.onProblemList)}>
                    <span className="font-mono text-[10px] text-gray-500">{d.code}</span> {d.name} <span className="text-[10px] text-gray-400">{kdate(d.lastAt, 'dateShortYear')}</span>
                    {d.onProblemList === false && <span className="ml-1 text-[10px] font-semibold text-amber-700"><T k="문제 목록에 없음" /></span>}
                  </span>
                ))}
              </div>
            ) : dx ? <p className="text-gray-500"><T k="서명된 진료 기록에 진단 없음" /></p> : null}
            {/* 🔴 (2026-10-03) 종전엔 문제 목록이 **완전히 비었을 때만** 말했다 — 일부만 정리된 경우(고혈압은 있고 당뇨는 없음)는 침묵했다.
                진단마다 등재 여부를 서버가 판정한다(상태 무관). 자동 등록은 하지 않는다 — 정리는 문제목록 탭에서 사람이 */}
            {dx && dx.some((d) => d.onProblemList === false) && (
              <p className="text-[10px] text-amber-700" data-brief-dx-gap>
                <Tf k="진료 기록 진단 {전체}개 중 {수}개가 문제 목록에 없습니다" params={{ 전체: dx.length, 수: dx.filter((d) => d.onProblemList === false).length }} />
                <button type="button" onClick={() => onTabChange('problems')} className="ml-2 text-blue-600 hover:underline"><T k="문제목록에서 정리" /></button>
              </p>
            )}
            {dx && dx.length > 0 && dx.some((d) => d.onProblemList === null) && (
              <p className="text-[10px] text-gray-500"><T k="문제 목록을 읽지 못해 진단의 등재 여부를 알 수 없습니다" /></p>
            )}
          </dd>
        </div>

        {/* 투약 — 같은 약이 여러 번 활성으로 남은 것·기간이 지난 것을 숨기지 않는다 */}
        <div data-brief-meds>
          <dt className="mb-0.5 font-semibold text-gray-500"><T k="활성 투약" /></dt>
          <dd className="text-gray-800">
            {medCount > 0 ? <Tf k="{수}종" params={{ 수: medCount }} /> : <T k="활성 투약 없음" />}
            {overDue > 0 && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800"><Tf k="처방 기간 지남 {수}" params={{ 수: overDue }} /></span>}
            {medCount > 0 && <button type="button" onClick={() => onTabChange('medications')} className="ml-2 text-[10px] text-blue-600 hover:underline"><T k="투약 이력" /></button>}
          </dd>
        </div>

        {/* 검사 — 30일 창이 비었으면 마지막 검사가 언제였는지 말한다(0건을 "이상 없음"으로 읽지 않게) */}
        <div data-brief-labs>
          <dt className="mb-0.5 font-semibold text-gray-500"><T k="검사" /></dt>
          <dd className="text-gray-800">
            {brief.recentLabs.length > 0 ? (
              <><Tf k="최근 30일 {수}항목" params={{ 수: brief.recentLabs.length }} />{brief.abnormalLabCount > 0 && <span className="ml-1 font-semibold text-red-700"><Tf k="· 이상 {수}" params={{ 수: brief.abnormalLabCount }} /></span>}</>
            ) : brief.lastLabAt ? (
              <><T k="최근 30일 검사 없음" /> · <T k="마지막 검사" /> {kdate(brief.lastLabAt)} <AgoText at={brief.lastLabAt} /></>
            ) : <span className="text-gray-500"><T k="검사 기록 없음" /></span>}
          </dd>
        </div>
      </dl>

      {brief.unavailable.length > 0 && (
        <p className="mt-3 rounded-lg bg-amber-50 px-2 py-1 text-[10px] text-amber-800" data-brief-unavailable>
          <T k="계산하지 못한 항목:" /> {brief.unavailable.join(', ')} — <T k="없다는 뜻이 아닙니다." />
        </p>
      )}
    </div>
  );
}

/** 활성 투약 카드 — 브리핑의 약 단위 목록(검사·영상 오더를 "처방"으로 세지 않는다) */
export function ActiveMedicationsCard({ patientId, onTabChange, totalActiveOrders }: { patientId: string; onTabChange: (tab: string) => void; totalActiveOrders?: number | null }) {
  const { allowed, brief, isLoading, isError, error, refetch } = usePatientBrief(patientId);
  const meds = brief?.medicationDetails;
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm" data-active-meds>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-500"><T k="활성 투약" /></h4>
        <button onClick={() => onTabChange('medications')} className="text-xs font-medium text-blue-600 hover:text-blue-700"><T k="투약 이력 보기" /></button>
      </div>
      {!allowed ? (
        <p className="text-xs text-gray-500"><T k="투약 목록은 임상 역할에게만 보입니다 — 비어 있다는 뜻이 아닙니다." /></p>
      ) : isLoading ? <div className="h-12 animate-pulse rounded-xl bg-gray-100" />
        : isError ? <QueryErrorFallback error={error} onRetry={refetch} size="compact" />
        : !meds ? <p className="text-xs text-amber-700"><T k="투약 상세를 계산하지 못했습니다 — 투약 이력 탭을 확인하세요." /></p>
        : meds.length === 0 ? <p className="text-xs text-gray-400"><T k="활성 투약 없음" /></p>
        : (
          <ul className="space-y-1.5">
            {meds.map((m) => (
              <li key={`${m.name}|${m.dosage}|${m.frequency}`} className="text-xs" data-med-row>
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 font-medium text-gray-900 [overflow-wrap:anywhere]">{m.name}</span>
                  <span className="shrink-0 text-gray-500">{[m.dosage, m.frequency].filter(Boolean).join(' ')}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[10px] text-gray-400">
                  <span>{kdate(m.latestPrescribedAt)} <T k="처방" />{m.durationDays != null && <> · <Tf k="{일}일분" params={{ 일: m.durationDays }} /></>}</span>
                  {m.overDuration === true && <span className="rounded bg-amber-100 px-1 font-semibold text-amber-800" data-med-over><T k="처방 기간 지남(활성으로 남음)" /></span>}
                  {m.count > 1 && <span className="rounded bg-rose-50 px-1 font-semibold text-rose-700" data-med-dup><Tf k="같은 처방 {수}건 활성" params={{ 수: m.count }} /></span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      {totalActiveOrders != null && (
        <p className="mt-2 text-[10px] text-gray-400"><Tf k="활성 오더 전체 {수}건(검사·영상 등 포함)" params={{ 수: totalActiveOrders }} /></p>
      )}
    </div>
  );
}
