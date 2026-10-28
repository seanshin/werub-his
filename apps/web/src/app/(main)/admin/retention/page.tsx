'use client';

// 데이터 보유/파기(Retention) 관제 — gap-remediation R6 (EP 7종 첫 소비처 · ADMIN 전용 RETENTION_MANAGE)
// 🔴 정직 표기 원칙:
//   - 고위험(AUDIT_LOG 등) 파기 핸들러는 **의도적 미구현**(법정 보존·아카이빙 대상) — 실행 버튼을 그리지 않는다.
//   - DRY-RUN 은 절대 삭제하지 않지만 **read-only 가 아니다**(정책 행의 lastRunAt/lastCandidates 를 갱신).
//   - supported=false 의 candidates 0 은 "0건"이 아니라 "세지 않음(핸들러 없음)" — 0 으로 그리지 않는다.
//   - 감사 로그 보존일 정본은 이 화면의 정책 행(AUDIT_LOG)이다 — 중복이던 config
//     security.audit.retentionDays 는 2026-09-06 제거(R9-⑥).

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { EmptyState, KDate } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import type { RetentionCountry, RetentionMappingStatus } from '@hospital-run/shared';

interface RetentionPolicy {
  id: string;
  resourceType: string;
  /** 기간 정본이 설정 키인 종류(SCRIBE_TRANSCRIPT)는 설정값 — 숫자가 아니면 null(지어내지 않는다) */
  retentionDays: number | null;
  /** 'POLICY' 또는 설정 키(예: scribe.transcript.retention) */
  retentionDaysSource?: string;
  /** 설정 출처 — db/env 면 설정됨, default/unset 이면 정해진 적 없음(파기 거부) */
  periodSource?: string | null;
  periodConfigured?: boolean;
  legalMinDays: number;
  action: 'REPORT_ONLY' | 'SOFT_DELETE' | 'ANONYMIZE' | 'HARD_PURGE' | string;
  legalConfirmed: boolean;
  enabled: boolean;
  description?: string | null;
  lastRunAt?: string | null;
  lastCandidates?: number | null;
}

interface DryRunRow {
  resourceType: string;
  action: string;
  retentionDays: number | null;
  retentionDaysSource?: string;
  periodSource?: string | null;
  periodConfigured?: boolean;
  legalMinDays: number;
  legalConfirmed: boolean;
  /** 기간이 숫자가 아니면 null — 후보를 산출하지 않았다 */
  cutoff: string | null;
  /** 🔴 supported=false 면 null — 세지 않은 것이다(0 이 아니다) */
  candidates: number | null;
  /** 환자 마지막 진료일 기준(T10 기산점 후보) — 환자 귀속이 아닌 기록은 null(해당 없음) */
  candidatesByLastEncounterAt?: number | null;
  oldestAt: string | null;
  /** 종류별 부가 집계(SCRIBE_TRANSCRIPT: retainedTotal·heldOut·notTerminal) — 없으면 없는 것 */
  detail?: Record<string, number | null> | null;
  supported: boolean;
  wouldPurge: boolean;
}

/** 기간 출처 한 줄 — 설정 키 종류만 그린다. 기본값/미설정은 "정해진 적 없음"이라 말한다(기본값을 정책인 척하지 않는다) */
function PeriodSource({ row }: { row: { retentionDaysSource?: string; periodSource?: string | null; periodConfigured?: boolean } }) {
  if (!row.retentionDaysSource || row.retentionDaysSource === 'POLICY') return null;
  return (
    <div className="mt-0.5 text-[11px]">
      <span className="font-mono text-gray-500">{row.retentionDaysSource}</span>{' '}
      {row.periodConfigured
        ? <span className="text-gray-500">(<T k="설정됨" />{row.periodSource ? ` · ${row.periodSource}` : ''})</span>
        : <span className="font-semibold text-amber-700"><T k="기본값 — 정해진 적 없음(파기 거부)" /></span>}
    </div>
  );
}

interface DryRunResult { dryRun: boolean; generatedAt: string; policies: DryRunRow[] }

interface LegalKindRow {
  key: string;
  country: RetentionCountry;
  legalName: string;
  mapping: RetentionMappingStatus;
  sources: string[];
  note: string;
  source: { label: string; url: string; sourceVerified: boolean };
  /** UNMAPPED 는 세지 않는다(false) — total 0 이 아니라 null */
  counted: boolean;
  total: number | null;
  oldestCreatedAt: string | null;
  oldestLastEncounterAt: string | null;
}
interface LegalKindsResult { country: RetentionCountry; generatedAt: string; periodsConfirmed: boolean; kinds: LegalKindRow[] }

const MAPPING_BADGE: Record<RetentionMappingStatus, { label: string; cls: string }> = {
  MAPPED: { label: '대응 모델 있음', cls: 'bg-green-100 text-green-700' },
  CANDIDATE: { label: '후보 — 법무 확인 필요', cls: 'bg-amber-100 text-amber-800' },
  UNMAPPED: { label: '미매핑', cls: 'bg-gray-200 text-gray-600' },
};

interface ApprovalRow {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  requestedBy: string;
  status: string;
  reason?: string | null;
  requestedAt: string;
  expiresAt: string;
}

const ACTION_LABEL: Record<string, string> = {
  REPORT_ONLY: '리포트만(파기 안 함)', SOFT_DELETE: '소프트 삭제', ANONYMIZE: '익명화', HARD_PURGE: '완전 파기',
};

export default function RetentionPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [requestTarget, setRequestTarget] = useState<RetentionPolicy | null>(null);
  const [requestReason, setRequestReason] = useState('');
  // 🔴 법정 종류 보유 현황은 버튼으로만 조회한다 — 기록 테이블 여럿을 세는 무거운 읽기라 마운트마다 돌리지 않는다
  const [legalCountry, setLegalCountry] = useState<RetentionCountry | null>(null);

  const policiesQ = useQuery({
    queryKey: ['retention-policies'],
    queryFn: () => apiClient.get<{ data: RetentionPolicy[] }>('/api/v1/retention/policies'),
  });
  const policies = (policiesQ.data?.data ?? []) as RetentionPolicy[];

  const legalKindsQ = useQuery({
    queryKey: ['retention-legal-kinds', legalCountry],
    queryFn: () => apiClient.get<{ data: LegalKindsResult }>(`/api/v1/retention/legal-kinds?country=${legalCountry}`),
    enabled: legalCountry != null,
  });
  const legalKinds = (legalKindsQ.data?.data ?? null) as LegalKindsResult | null;
  const unconfirmedCount = policies.filter((p) => !p.legalConfirmed).length;

  const approvalsQ = useQuery({
    queryKey: ['retention-approvals'],
    queryFn: () => apiClient.get<{ data: ApprovalRow[] }>('/api/v1/retention/approvals'),
  });
  const allApprovals = (approvalsQ.data?.data ?? []) as ApprovalRow[];
  // 🔴 서버 목록은 action 무필터(다른 4-eyes 요청까지 섞여 온다 — 실측) → 화면에서 가른다
  const retentionApprovals = allApprovals.filter((a) => a.action === 'RETENTION_PURGE');
  const otherApprovals = allApprovals.length - retentionApprovals.length;

  const runReport = useMutation({
    mutationFn: () => apiClient.get<{ data: DryRunResult }>('/api/v1/retention/report'),
    onSuccess: (res) => {
      setDryRun((res.data ?? null) as DryRunResult | null);
      qc.invalidateQueries({ queryKey: ['retention-policies'] }); // lastRunAt 이 방금 갱신됨
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : tAttr('DRY-RUN 실패')),
  });

  const submitRequest = useMutation({
    mutationFn: (p: { resourceType: string; reason: string }) =>
      apiClient.post('/api/v1/retention/purge-request', { resourceType: p.resourceType, confirm: true, reason: p.reason }),
    onSuccess: () => {
      setRequestTarget(null); setRequestReason('');
      qc.invalidateQueries({ queryKey: ['retention-approvals'] });
      toast.success(tAttr('파기 승인 요청을 등록했습니다 — 다른 관리자의 승인(4-eyes)이 필요합니다.'));
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : tAttr('요청 실패')),
  });

  const approve = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/retention/approvals/${id}/approve`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['retention-approvals'] }); toast.success(tAttr('승인했습니다.')); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : tAttr('승인 실패')),
  });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900"><T k="데이터 보유·파기 (Retention)" /></h1>
        <p className="mt-1 text-sm text-gray-500">
          <T k="리소스별 보존 정책과 파기 후보 집계(DRY-RUN), 파기 4-eyes 승인 큐. 보존 컷오프는" /> <b><T k="보존일수와 법정 최소 중 긴 쪽" /></b><T k="으로 항상 안전측 산정됩니다." />
        </p>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <b><T k="현재 실제 파기가 도는 경로는 없습니다." /></b> <T k="전역 게이트(retention.purgeEnabled)가 꺼져 있고, 정책이 리포트 전용·법무 미확정이면 파기 요청도 서버가 거부합니다. 감사 로그(AUDIT_LOG)·외부 앱 접근 기록은 법정 보존 대상이라" /> <b><T k="파기 핸들러 자체가 없습니다" /></b><T k="(아카이빙 별도 설계 대상) — 이 화면은 실행 버튼을 만들지 않습니다." />
      </div>

      {/* 🔴 (2026-09-13 T10) 법무 미확정은 "대기"가 아니라 "파기 불가"다 — 그 사실을 첫 화면에서 말한다 */}
      {policies.length > 0 && unconfirmedCount > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" data-testid="retention-unconfirmed-banner">
          <b><Tf k="법무 미확정 정책 {미확정} / 전체 {전체}" params={{ 미확정: unconfirmedCount, 전체: policies.length }} /></b>
          {' — '}<T k="보존기간·기산점이 확정되지 않아 이 정책들은 파기할 수 없습니다(서버가 거부합니다)." />
        </div>
      )}

      {/* 정책 목록 */}
      <section>
        <h2 className="mb-2 text-base font-semibold text-gray-900"><T k="보존 정책" /> ({policies.length})</h2>
        {policiesQ.isError ? (
          <QueryErrorFallback error={policiesQ.error} onRetry={() => policiesQ.refetch()} />
        ) : policiesQ.isLoading ? (
          <div className="py-6 text-center text-sm text-gray-400"><T k="불러오는 중…" /></div>
        ) : policies.length === 0 ? (
          <EmptyState compact title="등록된 보존 정책이 없습니다" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2"><T k="리소스" /></th><th className="px-3 py-2"><T k="보존(일)" /></th><th className="px-3 py-2"><T k="법정 최소(일)" /></th>
                  <th className="px-3 py-2"><T k="처리 방식" /></th><th className="px-3 py-2"><T k="법무 확정" /></th><th className="px-3 py-2"><T k="최근 집계" /></th><th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => (
                  <tr key={p.id} className={`border-t border-gray-100 ${p.enabled ? '' : 'opacity-50'}`}>
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs font-semibold">{p.resourceType}</div>
                      {p.description && <div className="mt-0.5 text-xs text-gray-500">{p.description}</div>}
                    </td>
                    <td className="px-3 py-2">
                      {p.retentionDays == null ? <span className="text-amber-700"><T k="산출 불가(설정값이 숫자가 아님)" /></span> : p.retentionDays}
                      <PeriodSource row={p} />
                    </td>
                    <td className="px-3 py-2">{p.legalMinDays}</td>
                    <td className="px-3 py-2"><T k={ACTION_LABEL[p.action] ?? p.action} /></td>
                    <td className="px-3 py-2">
                      {p.legalConfirmed
                        ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700"><T k="확정" /></span>
                        : <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700"><T k="법무 미확정 — 파기 불가" /></span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {/* 🔴 (T10-10) lastCandidates=null 은 "세지 않음"이다 — 종전엔 미지원 정책도 0 이 저장돼 "후보 0건"이라 말했다 */}
                      {p.lastRunAt
                        ? <><KDate value={p.lastRunAt} mode="datetime" /> · {p.lastCandidates == null
                            ? <span className="text-amber-700"><T k="세지 않음(핸들러 없음)" /></span>
                            : <><T k="후보" /> <Tf k="{건수}건" params={{ 건수: p.lastCandidates }} /></>}</>
                        : <T k="집계 이력 없음" />}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {p.action === 'REPORT_ONLY' ? (
                        <span className="text-xs text-gray-400" title={tAttr('리포트 전용 정책은 파기 요청이 서버에서 거부됩니다')}><T k="요청 불가" /></span>
                      ) : (
                        <button type="button" onClick={() => { setRequestTarget(p); setRequestReason(''); }}
                          className="min-h-[44px] rounded-lg border border-red-300 px-3 text-xs font-semibold text-red-700 hover:bg-red-50">
                          <T k="파기 요청" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* DRY-RUN */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900"><T k="파기 후보 집계 (DRY-RUN)" /></h2>
          <button type="button" onClick={() => runReport.mutate()} disabled={runReport.isPending}
            className="min-h-[44px] rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {runReport.isPending ? <T k="집계 중…" /> : <T k="DRY-RUN 실행" />}
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          <T k="삭제하지 않고 후보 건수만 셉니다. 단, 실행 이력(최근 집계 시각·건수)은 정책 행에 기록됩니다." />
        </p>
        {dryRun && (
          <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr><th className="px-3 py-2"><T k="리소스" /></th><th className="px-3 py-2"><T k="컷오프" /></th><th className="px-3 py-2"><T k="후보(작성일 기준)" /></th><th className="px-3 py-2"><T k="후보(마지막 진료일 기준)" /></th><th className="px-3 py-2"><T k="가장 오래된 건" /></th></tr>
              </thead>
              <tbody>
                {dryRun.policies.map((r) => (
                  <tr key={r.resourceType} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-mono text-xs font-semibold">{r.resourceType}<PeriodSource row={r} /></td>
                    <td className="px-3 py-2 text-gray-600">{r.cutoff ? <KDate value={r.cutoff} /> : <span className="text-amber-700"><T k="산출 불가(기간 없음)" /></span>}</td>
                    <td className="px-3 py-2">
                      {r.supported && r.candidates != null ? <Tf k="{건수}건" params={{ 건수: r.candidates }} />
                        : !r.cutoff ? <span className="text-amber-700"><T k="산출 불가(기간 없음)" /></span>
                        : <span className="text-amber-700" title={tAttr('이 리소스는 집계 핸들러가 없어 세지 않았습니다 — 0건이 아닙니다')}><T k="세지 않음(핸들러 없음)" /></span>}
                      {/* 전사 보존 — 분모를 함께: 남아 있는 종료 세션 전사 총량 · 보존명령으로 제외된 것 · 미반영 대기라 세지 않은 것 */}
                      {r.detail && (
                        <div className="mt-0.5 text-[11px] text-gray-500">
                          <T k="전사 남은 종료 세션" /> {r.detail.retainedTotal ?? '-'} · <T k="보존명령 제외" /> {r.detail.heldOut ?? '-'} · <T k="미반영 대기(파기 대상 아님)" /> {r.detail.notTerminal ?? '-'}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {!r.supported
                        ? <span className="text-amber-700"><T k="세지 않음(핸들러 없음)" /></span>
                        : r.candidatesByLastEncounterAt == null
                          ? <span className="text-gray-400" title={tAttr('환자에 귀속되지 않는 기록이라 마지막 진료일 기준이 성립하지 않습니다')}><T k="해당 없음" /></span>
                          : <Tf k="{건수}건" params={{ 건수: r.candidatesByLastEncounterAt }} />}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{r.supported ? (r.oldestAt ? <KDate value={r.oldestAt} mode="datetime" /> : '-') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-2 text-[11px] text-gray-400"><T k="집계 시각" /> <KDate value={dryRun.generatedAt} mode="datetime" /> · <T k="어떤 행도 삭제되지 않았습니다." /></p>
            <p className="px-3 pb-2 text-[11px] text-gray-400"><T k="기산점이 확정되지 않아 두 기준을 함께 셉니다 — 작성일(한국 의료법 해석)과 환자 마지막 진료일(UAE 해석 · 진료만 절차로 본 근사)." /></p>
          </div>
        )}
      </section>

      {/* 🔴 (2026-09-13 T10) 국가별 법정 기록 종류 — 기간은 없다(법무 확정 전 · 지어내지 않는다) */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900"><T k="국가별 법정 보존 기록 종류" /></h2>
          <div className="flex gap-2">
            {(['KR', 'AE'] as RetentionCountry[]).map((c) => (
              <button key={c} type="button" onClick={() => setLegalCountry(c)}
                className={`min-h-[44px] rounded-xl border px-4 text-sm font-semibold ${legalCountry === c ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
                {c === 'KR' ? <T k="한국 보유 현황" /> : <T k="UAE 보유 현황" />}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          <T k="법령이 정한 기록 종류와 이 시스템의 대응 모델, 종류별 보유량을 봅니다. 보존기간·기산점은 법무 확정 전이라 파기 후보 수는 산출하지 않습니다." />
        </p>
        {legalCountry == null ? null : legalKindsQ.isError ? (
          <QueryErrorFallback error={legalKindsQ.error} onRetry={() => legalKindsQ.refetch()} />
        ) : legalKindsQ.isLoading || !legalKinds ? (
          <div className="py-6 text-center text-sm text-gray-400"><T k="불러오는 중…" /></div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200" data-testid="retention-legal-kinds">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2"><T k="법정 기록 종류" /></th><th className="px-3 py-2"><T k="시스템 대응" /></th><th className="px-3 py-2"><T k="보유량" /></th>
                  <th className="px-3 py-2"><T k="가장 오래된(작성일)" /></th><th className="px-3 py-2"><T k="가장 오래된(마지막 진료일)" /></th><th className="px-3 py-2"><T k="근거" /></th>
                </tr>
              </thead>
              <tbody>
                {legalKinds.kinds.map((k) => (
                  <tr key={k.key} className="border-t border-gray-100 align-top">
                    <td className="px-3 py-2">
                      <div className="font-semibold"><T k={k.legalName} /></div>
                      <div className="mt-0.5 text-xs text-gray-500"><T k={k.note} /></div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${MAPPING_BADGE[k.mapping].cls}`}><T k={MAPPING_BADGE[k.mapping].label} /></span>
                      {k.sources.length > 0 && <div className="mt-1 font-mono text-[11px] text-gray-500">{k.sources.join(' + ')}</div>}
                    </td>
                    <td className="px-3 py-2">
                      {k.counted && k.total != null ? <Tf k="{건수}건" params={{ 건수: k.total }} /> : <span className="text-gray-500"><T k="세지 않음(미매핑)" /></span>}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{k.oldestCreatedAt ? <KDate value={k.oldestCreatedAt} /> : '-'}</td>
                    <td className="px-3 py-2 text-gray-600">{k.oldestLastEncounterAt ? <KDate value={k.oldestLastEncounterAt} /> : '-'}</td>
                    <td className="px-3 py-2 text-xs">
                      <a href={k.source.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">{k.source.label}</a>
                      {!k.source.sourceVerified && <div className="mt-0.5 text-amber-700"><T k="원문 미대조(2차 출처)" /></div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-2 text-[11px] text-gray-400"><T k="보존 기간 값은 이 목록에 없습니다 — 기간·기산점은 기관 정책(위 표)과 법무 확정이 정합니다. 마지막 진료일 기준은 진료(encounters)만 절차로 본 근사입니다." /></p>
          </div>
        )}
      </section>

      {/* 4-eyes 승인 큐 */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-base font-semibold text-gray-900">
          <T k="파기 승인 대기 (4-eyes)" />
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${retentionApprovals.length ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>{retentionApprovals.length}건</span>
        </h2>
        {approvalsQ.isError ? (
          <QueryErrorFallback error={approvalsQ.error} onRetry={() => approvalsQ.refetch()} />
        ) : approvalsQ.isLoading ? (
          <div className="py-6 text-center text-sm text-gray-400"><T k="불러오는 중…" /></div>
        ) : retentionApprovals.length === 0 ? (
          <EmptyState compact title="대기 중인 파기 승인 요청이 없습니다" />
        ) : (
          <div className="space-y-2">
            {retentionApprovals.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3">
                <span className="font-mono text-xs font-semibold">{a.targetId}</span>
                {a.reason && <span className="text-sm text-gray-600">{a.reason}</span>}
                <span className="text-xs text-gray-400"><T k="요청" /> <KDate value={a.requestedAt} mode="datetime" /> · <T k="만료" /> <KDate value={a.expiresAt} mode="datetime" /></span>
                <button type="button" disabled={approve.isPending} onClick={() => approve.mutate(a.id)}
                  className="ml-auto min-h-[44px] rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white hover:bg-black disabled:opacity-50">
                  <T k="승인" />
                </button>
              </div>
            ))}
            <p className="text-[11px] text-gray-400">
              <T k="요청자 본인은 승인할 수 없습니다(서버 강제). 반려는" /> <a href="/admin/identity" className="text-blue-700 hover:underline"><T k="계정·승인 관리" /></a> <T k="화면의 승인함에서 처리합니다." />
            </p>
          </div>
        )}
        {otherApprovals > 0 && (
          <p className="mt-2 text-[11px] text-gray-400">
            <T k="파기 외 다른 승인 대기" /> {otherApprovals}건은 <a href="/admin/identity" className="text-blue-700 hover:underline"><T k="계정·승인 관리" /></a><T k="에서 확인하세요." />
          </p>
        )}
      </section>

      {requestTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-bold text-gray-900"><T k="파기 승인 요청 —" /> {requestTarget.resourceType}</h3>
            <p className="mt-2 text-xs text-gray-500">
              <T k={ACTION_LABEL[requestTarget.action] ?? requestTarget.action} /> · <T k="보존" /> {requestTarget.retentionDays ?? '-'}일(<T k="법정 최소" /> {requestTarget.legalMinDays}일).
              <T k="요청이 승인되어도 전역 게이트·법무 확정·핸들러가 갖춰져야 실행됩니다." />
            </p>
            <label className="mb-1 mt-3 block text-xs font-semibold text-gray-500"><T k="요청 사유 *" /></label>
            <input value={requestReason} onChange={(e) => setRequestReason(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setRequestTarget(null)} className="min-h-[44px] rounded-lg border border-gray-300 px-4 text-sm text-gray-700"><T k="취소" /></button>
              <button type="button" disabled={submitRequest.isPending || !requestReason.trim()}
                onClick={() => submitRequest.mutate({ resourceType: requestTarget.resourceType, reason: requestReason.trim() })}
                className="min-h-[44px] rounded-lg bg-red-600 px-4 text-sm font-bold text-white disabled:opacity-50">
                {submitRequest.isPending ? <T k="요청 중…" /> : <T k="승인 요청" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
