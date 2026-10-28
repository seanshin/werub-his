'use client';

/**
 * 간호 스테이션 「통증 재평가」 탭(2026-10-26) — 원내 규정(`/admin/nursing-rules`)대로 서버가 판정한 재평가 대기·지연.
 *  · 🔴 규정이 없으면 목록을 만들지 않고 그렇다고 말한다(기준 점수를 화면이 지어내지 않는다 · "대기 0"이라 말하지 않는다).
 *  · 🔴 조회 실패를 "대기 없음"으로 그리지 않는다 · 약품 분류를 모르는 투약은 진통제 아님으로 접지 않고 수를 말한다.
 *  · 재평가 = 통증 점수를 새로 기록하는 것(활력 탭) — 이 화면은 기록하지 않는다.
 */
import { useQuery } from '@tanstack/react-query';
import type { PainReassessRule } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import { unwrapData } from '@/lib/nursing-rules';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState, KDate, PatientName } from '@/components/ui/display';
import { T, Tf } from '@/components/ui/i18n-text';

interface Item {
  admissionId: string;
  patient: { id: string; familyName: string; givenName: string; mrn: string };
  ward: { id: string; name: string } | null;
  room: string | null;
  lastPain: { at: string; score: number } | null;
  trigger: { kind: 'PAIN_SCORE'; at: string; score: number } | { kind: 'ANALGESIC'; at: string; name: string | null };
  dueAt: string;
  status: 'DUE' | 'OVERDUE';
  minutes: number;
}
interface Payload {
  rule: PainReassessRule | null;
  ruleSource: 'CONFIGURED' | 'SEED' | 'UNSET' | 'UNKNOWN';
  reason: 'RULE_UNSET' | 'RULE_UNKNOWN' | null;
  windowHours: number;
  items: Item[] | null;
  admissions: number | null;
  unclassifiedAdministrations: number | null;
  generatedAt: string;
}

export function PainReassessTab({ scopeAdmissionIds, onRecordVitals }: { scopeAdmissionIds: Set<string>; onRecordVitals: () => void }) {
  const q = useQuery({
    queryKey: ['pain-reassessment'],
    queryFn: async () => unwrapData<Payload>(await apiClient.get('/api/v1/nursing-rules/pain-reassessment')) ?? null,
    refetchInterval: pollMs('normal'),
  });
  const d = q.data;

  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading || !d) return <p className="text-sm text-gray-400"><T k="불러오는 중…" /></p>;

  if (d.reason) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900" data-pain-reason={d.reason}>
        <p className="font-semibold">
          {d.reason === 'RULE_UNSET' ? <T k="통증 재평가 원내 규정이 아직 없습니다 — 재평가 목록을 만들지 않습니다." /> : <T k="통증 재평가 규정을 조회하지 못했습니다 — 재평가 대기를 확인할 수 없습니다." />}
        </p>
        <p className="mt-1 text-xs"><T k="기준 점수·재평가 기한은 간호부 규정으로 정해 관리 화면에 입력합니다(화면이 기준을 지어내지 않습니다)." /></p>
        <p className="mt-1 text-xs text-amber-800"><T k="입력 화면: 관리 → 간호 원내 규정(3418 · 관리자)" /></p>
      </div>
    );
  }

  const rule = d.rule!;
  const all = d.items ?? [];
  const items = all.filter((i) => scopeAdmissionIds.has(i.admissionId));
  const outside = all.length - items.length;
  const overdue = items.filter((i) => i.status === 'OVERDUE').length;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden" data-pain-reassess>
      <div className="px-5 py-3 border-b border-gray-100 space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-gray-700"><T k="통증 재평가 대기" /></p>
          <div className="flex gap-2 text-xs">
            <span className="rounded-full bg-rose-50 px-2 py-0.5 font-semibold text-rose-700" data-pain-overdue={overdue}><Tf k="지연 {수}" params={{ 수: overdue }} /></span>
            <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800"><Tf k="대기 {수}" params={{ 수: items.length - overdue }} /></span>
          </div>
        </div>
        <p className="text-[11px] text-gray-500" data-pain-rule>
          <Tf k="원내 규정: NRS {점}점 이상이면 {분}분 안에 재평가" params={{ 점: rule.thresholdScore, 분: rule.withinMinutes }} />
          {' · '}
          {rule.afterAnalgesicMinutes != null
            ? <Tf k="진통제 투여 뒤 {분}분 안에 재평가" params={{ 분: rule.afterAnalgesicMinutes }} />
            : <T k="진통제 투여는 재평가 사건으로 보지 않음" />}
          {' · '}
          <Tf k="최근 {시간}시간 기록만 봅니다" params={{ 시간: d.windowHours }} />
          {/* 🔴 개발 시드 값은 원내 규정이 아니다 — 그 값으로 돌지만 그렇다고 말한다 */}
          {d.ruleSource === 'SEED' && <span className="ml-1 font-semibold text-violet-700" data-pain-rule-seed><T k="(개발 시드 — 원내 규정 아님)" /></span>}
        </p>
        {d.unclassifiedAdministrations != null && d.unclassifiedAdministrations > 0 && (
          <p className="text-[11px] text-amber-700" data-pain-unclassified={d.unclassifiedAdministrations}>
            <Tf k="약품 분류를 모르는 투약 {수}건 — 진통제인지 판정하지 못해 목록에 넣지 않았습니다." params={{ 수: d.unclassifiedAdministrations }} />
          </p>
        )}
        {outside > 0 && <p className="text-[11px] text-gray-500"><Tf k="지금 보는 범위 밖(다른 병동·담당) {수}명은 뺐습니다." params={{ 수: outside }} /></p>}
      </div>
      {items.length === 0 ? (
        <EmptyState compact icon="✅" title="지금 범위에 재평가 대기가 없습니다." />
      ) : (
        <div className="divide-y divide-gray-50">
          {items.map((i) => (
            <div key={i.admissionId} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3" data-pain-item={i.status}>
              <div className="min-w-0 text-sm">
                <div className="flex items-center gap-2">
                  <PatientName familyName={i.patient.familyName} givenName={i.patient.givenName} mrn={i.patient.mrn} className="font-medium text-gray-900" />
                  <span className="text-[11px] text-gray-500">{i.ward?.name ?? ''} {i.room ?? ''}</span>
                </div>
                <p className="text-xs text-gray-600">
                  {i.trigger.kind === 'PAIN_SCORE'
                    ? <Tf k="통증 NRS {점}점 기록" params={{ 점: i.trigger.score }} />
                    : <Tf k="진통제 투여 {약}" params={{ 약: i.trigger.name ?? '' }} />}
                  {' · '}<KDate value={i.trigger.at} mode="datetime" />
                  {i.lastPain && i.trigger.kind === 'ANALGESIC' && <> · <Tf k="마지막 통증 NRS {점}점" params={{ 점: i.lastPain.score }} /></>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold ${i.status === 'OVERDUE' ? 'text-rose-700' : 'text-amber-800'}`}>
                  {i.status === 'OVERDUE'
                    ? <Tf k="기한 {분}분 지남" params={{ 분: i.minutes }} />
                    : <Tf k="기한까지 {분}분" params={{ 분: i.minutes }} />}
                </span>
                <button type="button" onClick={onRecordVitals} className="min-h-[44px] rounded-lg border border-blue-200 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50">
                  <T k="활력 탭에서 통증 기록" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
