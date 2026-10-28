'use client';

/**
 * 처방 도우미(2026-10-07) — 새 처방 입력 창에서 "무엇을 낼지"를 미리 꺼내 놓는 자리.
 *
 *  · 진단 기반 표준처방(CP) 추천 — `order-sets/recommend`(상병 → 세트 · 금기 대조 · 매칭 근거) · 적용은 약속처방 탭에서(미리보기 후)
 *  · 진행 중 임상경로 — 배정된 표준진료지침의 오늘(Day N) 항목·앞선 미기록 항목·다음 날 항목(참고 — 처방을 자동으로 내지 않는다)
 *  · 사전처방 대기 — 이 환자에게 미리 내 둔 오더를 **이번 진료로 승인**(승인 시 처방 생성 · DUR 재검증 실패는 비차단 경고)
 *  · 약속처방 — 개인·과 세트 탭으로 바로
 *
 * 🔴 추천은 권고가 아니다 — 매칭 근거(주상병·EXACT/PREFIX)를 함께 보이고, 적용은 의사가 미리보기 후 고른다.
 * 🔴 임상경로 항목은 기록에 없는 것을 "지연"이라 말하지 않는다 — "기록 없음"이다(지연 판정 기준은 정하지 않았다).
 * 🔴 권한 — 추천 EP 는 @Roles(DOCTOR) + RolesGuard 의 관리자 통과(운영 실측 관리자 200) · 사전처방 승인은 DOCTOR·ADMIN · 경로 조회는 DOCTOR·NURSE·ADMIN.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { joinPatientName } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { KDate } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

interface Recommended { id: string; name: string; code?: string | null; items?: unknown[]; matchedBy: string; matchedCode: string; contraUnevaluated?: boolean; department?: string | null }
interface PreOrder {
  id: string; type: string; priority?: string | null; dosage?: string | null; frequency?: string | null; reason?: string | null; scheduledDate?: string | null; createdAt: string;
  doctor?: { familyName?: string; givenName?: string } | null;
  medicationCode?: { code?: string; nameKo?: string } | null; procedureCode?: { code?: string; nameKo?: string } | null;
  appointment?: { scheduledAt?: string | null } | null;
}
interface Assignment { id: string; status: string; startDate: string; pathway: { name: string; code: string; totalDays: number } }
interface AssignmentDetail extends Assignment {
  pathway: Assignment['pathway'] & { milestones: { id: string; day: number; category: string; title: string; isRequired: boolean; orderSet?: { id: string; name: string | null; status: string } | null }[] };
  outcomes: { milestoneId: string; status: string }[];
}

const MATCH_LABEL: Record<string, string> = { EXACT: '상병 일치', LEGACY_EXACT: '상병 일치', PREFIX: '상병 분류 일치' };
const CATEGORY_LABEL: Record<string, string> = { ORDER: '오더', MEDICATION: '투약', ASSESSMENT: '평가', EDUCATION: '교육', DISCHARGE: '퇴원' };
const OUTCOME_LABEL: Record<string, string> = { DONE: '완료', SKIPPED: '생략', DELAYED: '지연 기록', DEVIATED: '이탈' };

/** Day N — 시작일이 Day 0(경로 정본의 마일스톤 day 는 0부터) · date-only 끼리 달력 날짜로 뺀다 */
export function pathwayDayOf(startDate: string, today: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(startDate); const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(today);
  if (!a || !b) return null;
  return (Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86_400_000;
}

type Panel = 'CP' | 'PATHWAY' | 'PREORDER' | null;

export function OrderAssistBar({ patientId, encounterId, diagnosisCodes, primaryCode, today, onOpenOrderSet, onPrescriptionsAdded }: {
  patientId: string;
  encounterId: string;
  diagnosisCodes: string[];
  primaryCode: string | null;
  /** KST 오늘(YYYY-MM-DD) */
  today: string;
  onOpenOrderSet: (previewId?: string) => void;
  onPrescriptionsAdded: (items: { type: string; name: string; code: string }[]) => void;
}) {
  const tAttr = useTAttr();
  const role = useAuthStore((s) => s.user?.role);
  // 서버 @Roles 와 같은 판정 — 권한 밖이면 부르지 않는다
  const canRecommend = role === 'DOCTOR' || role === 'ADMIN';
  const canPathway = role === 'DOCTOR' || role === 'NURSE' || role === 'ADMIN';
  const canApprove = role === 'DOCTOR' || role === 'ADMIN';
  const canOrderSet = role === 'DOCTOR' || role === 'ADMIN';
  const [open, setOpen] = useState<Panel>(null);
  const [approving, setApproving] = useState<string | null>(null);

  const codesKey = diagnosisCodes.join(',');
  const rec = useQuery({
    queryKey: ['order-assist-cp', patientId, codesKey, primaryCode],
    queryFn: () => apiClient.get<{ data: Recommended[] }>('/api/v1/order-sets/recommend', {
      diagnosisCodes: codesKey, ...(primaryCode ? { primaryCode } : {}), patientId,
    }).then((r) => r.data ?? []),
    enabled: canRecommend && diagnosisCodes.length > 0,
  });
  const pre = useQuery({
    queryKey: ['pre-orders-patient', patientId],
    // 서버 응답이 `{ data: { data: [...] } }` 로 한 번 더 감싸여 온다(서비스가 { data } 를 돌려준다)
    queryFn: () => apiClient.get<{ data: PreOrder[] | { data: PreOrder[] } }>(`/api/v1/pre-orders/patient/${patientId}`)
      .then((r) => (Array.isArray(r.data) ? r.data : r.data?.data ?? [])),
  });
  const asg = useQuery({
    queryKey: ['order-assist-pathway', patientId],
    queryFn: () => apiClient.get<{ data: Assignment[] }>('/api/v1/pathways/assignments', { patientId, status: 'ACTIVE' }).then((r) => r.data ?? []),
    enabled: canPathway,
  });
  const active = asg.data?.[0] ?? null;
  const detail = useQuery({
    queryKey: ['order-assist-pathway-detail', active?.id],
    queryFn: () => apiClient.get<{ data: AssignmentDetail }>(`/api/v1/pathways/assignments/${active!.id}`).then((r) => r.data),
    enabled: !!active && open === 'PATHWAY',
  });

  const approve = async (p: PreOrder) => {
    setApproving(p.id);
    try {
      const res = await apiClient.patch<{ data?: { durCheck?: { status?: string }; data?: { durCheck?: { status?: string } } } }>(`/api/v1/pre-orders/${p.id}/approve`, { encounterId });
      const durStatus = res?.data?.durCheck?.status ?? res?.data?.data?.durCheck?.status;
      const name = p.medicationCode?.nameKo ?? p.procedureCode?.nameKo ?? tAttr('사전처방');
      onPrescriptionsAdded([{ type: p.type, name, code: p.medicationCode?.code ?? p.procedureCode?.code ?? '' }]);
      // 🔴 승인 시점 DUR 재검증이 실패해도 서버는 막지 않고 FAILED 로 기록한다 — "경고 없음"으로 보이지 않게
      if (durStatus === 'FAILED') toast.warning(tAttr('DUR 재검증을 하지 못한 채 승인되었습니다 — DUR 을 다시 확인하세요'));
      else toast.success(`${name} — ${tAttr('사전처방을 이번 진료로 승인했습니다')}`);
      void pre.refetch();
    } catch (e) {
      toast.error(extractErrorMessage(e) || tAttr('사전처방 승인 실패'));
    }
    setApproving(null);
  };

  const preList = pre.data ?? [];
  const recList = rec.data ?? [];
  const chip = (k: Exclude<Panel, null>, icon: string, label: string, badge: React.ReactNode, hidden = false) => hidden ? null : (
    <button type="button" onClick={() => setOpen(open === k ? null : k)} data-assist-chip={k}
      className={`flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${open === k ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}>
      <span aria-hidden>{icon}</span><T k={label} />{badge}
    </button>
  );
  const count = (n: number | null, tone = 'bg-gray-100 text-gray-600') => n == null ? null : <span className={`rounded-full px-1.5 text-[10px] font-bold ${tone}`}>{n}</span>;

  const day = active ? pathwayDayOf(active.startDate, today) : null;
  const doneOf = (id: string) => detail.data?.outcomes.find((o) => o.milestoneId === id)?.status ?? null;
  const ms = detail.data?.pathway.milestones ?? [];
  const overdue = day == null ? [] : ms.filter((m) => m.day < day && !doneOf(m.id));
  const todayMs = day == null ? [] : ms.filter((m) => m.day === day);
  const nextMs = day == null ? [] : ms.filter((m) => m.day === day + 1);

  return (
    <div className="space-y-2 rounded-xl border border-indigo-100 bg-indigo-50/40 p-2.5" data-order-assist>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-bold text-indigo-900"><T k="처방 도우미" /></span>
        {chip('CP', '🧭', '진단 기반 표준처방', diagnosisCodes.length ? count(rec.isSuccess ? recList.length : null, recList.length ? 'bg-indigo-600 text-white' : undefined) : null, !canRecommend)}
        {chip('PATHWAY', '🛤️', '임상경로', count(asg.isSuccess ? (asg.data?.length ?? 0) : null, asg.data?.length ? 'bg-emerald-600 text-white' : undefined), !canPathway)}
        {chip('PREORDER', '⏳', '사전처방 대기', count(pre.isSuccess ? preList.length : null, preList.length ? 'bg-amber-500 text-white' : undefined))}
        {canOrderSet && (
          <button type="button" onClick={() => onOpenOrderSet()} data-assist-chip="ORDERSET"
            className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50">
            <span aria-hidden>📋</span><T k="약속처방" />
          </button>
        )}
      </div>

      {open === 'CP' && (
        <div className="rounded-lg bg-white p-2.5" data-assist-panel="CP">
          {!diagnosisCodes.length ? <p className="text-xs text-gray-500" data-assist-cp-needs-dx><T k="상병을 입력하면 그 상병에 맞는 표준처방(CP)·약속처방 세트를 찾아 드립니다." /></p>
            : rec.isError ? <QueryErrorFallback error={rec.error} onRetry={() => rec.refetch()} />
              : rec.isLoading ? <div className="h-16 animate-pulse rounded bg-gray-100" />
                : !recList.length ? <p className="text-xs text-gray-500"><Tf k="상병 {코드}에 연결된 표준처방 세트가 없습니다 — 세트의 상병 연결은 관리 화면에서 합니다." params={{ 코드: codesKey }} /></p>
                  : (
                    <ul className="space-y-1">
                      {recList.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-indigo-50/60" data-assist-cp={r.id}>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-gray-900">{r.name}</p>
                            <p className="text-[10px] text-gray-500">
                              <T k={MATCH_LABEL[r.matchedBy] ?? '상병 일치'} /> {r.matchedCode}
                              {primaryCode && r.matchedCode === primaryCode && <> · <T k="주상병" /></>}
                              {' · '}{Array.isArray(r.items) ? r.items.length : 0}<T k="건" />
                            </p>
                            {r.contraUnevaluated && <p className="text-[10px] font-semibold text-amber-700"><T k="금기 메모가 있으나 자동 대조가 안 됩니다 — 미리보기에서 직접 확인하세요" /></p>}
                          </div>
                          {canOrderSet && (
                            <button type="button" onClick={() => onOpenOrderSet(r.id)} className="min-h-[36px] rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white" data-assist-cp-open={r.id}>
                              <T k="미리보기·적용" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
          <p className="mt-1.5 text-[10px] text-gray-400"><T k="상병과 세트의 연결로 찾은 후보입니다 — 권고가 아니며, 적용은 미리보기 후 직접 고릅니다." /></p>
        </div>
      )}

      {open === 'PATHWAY' && (
        <div className="rounded-lg bg-white p-2.5" data-assist-panel="PATHWAY">
          {asg.isError ? <QueryErrorFallback error={asg.error} onRetry={() => asg.refetch()} />
            : !active ? <p className="text-xs text-gray-500"><T k="진행 중인 임상경로가 없습니다." /> <Link href="/clinical-pathway" className="text-blue-700 hover:underline"><T k="임상경로 적용 →" /></Link></p>
              : (
                <div className="space-y-2">
                  <p className="text-xs text-gray-700">
                    <b>{active.pathway.name}</b> <span className="text-gray-400">{active.pathway.code}</span>
                    {' · '}<T k="시작" /> <KDate value={active.startDate} />
                    {day != null && <> · <b className="text-emerald-700" data-assist-day={day}><Tf k="오늘 Day {일}" params={{ 일: day }} /></b> / {active.pathway.totalDays}<T k="일" /></>}
                    {day != null && day >= active.pathway.totalDays && (
                      <span className="ml-1 font-semibold text-amber-700" data-assist-overrun>
                        <Tf k="예정 기간 {일}일을 넘겼습니다 — 경로 종료·이탈 여부를 확인하세요" params={{ 일: active.pathway.totalDays }} />
                      </span>
                    )}
                    {!!asg.data && asg.data.length > 1 && <span className="ml-1 text-amber-700"><Tf k="진행 중 경로 {수}개 — 가장 최근 것만 보입니다" params={{ 수: asg.data!.length }} /></span>}
                  </p>
                  {detail.isError ? <QueryErrorFallback error={detail.error} onRetry={() => detail.refetch()} />
                    : detail.isLoading ? <div className="h-16 animate-pulse rounded bg-gray-100" />
                      : (
                        <>
                          {([['앞선 날 기록 없음', overdue, 'overdue'], ['오늘', todayMs, 'today'], ['내일', nextMs, 'next']] as const).map(([label, list, key]) => list.length > 0 && (
                            <div key={key} data-assist-ms={key}>
                              <p className={`text-[11px] font-semibold ${key === 'overdue' ? 'text-amber-700' : 'text-gray-600'}`}><T k={label} /></p>
                              <ul className="mt-0.5 space-y-0.5">
                                {list.map((m) => {
                                  const st = doneOf(m.id);
                                  return (
                                    <li key={m.id} className="flex items-center gap-1.5 text-xs">
                                      <span className="rounded bg-gray-100 px-1 text-[10px] text-gray-600">D{m.day}</span>
                                      <span className="rounded bg-indigo-50 px-1 text-[10px] text-indigo-700"><T k={CATEGORY_LABEL[m.category] ?? m.category} /></span>
                                      <span className="min-w-0 flex-1 truncate text-gray-800">{m.title}</span>
                                      {m.isRequired && <span className="text-[10px] text-rose-600"><T k="필수" /></span>}
                                      {st ? <span className="text-[10px] text-emerald-700"><T k={OUTCOME_LABEL[st] ?? st} /></span> : <span className="text-[10px] text-gray-400"><T k="기록 없음" /></span>}
                                      {/* 경로 관리에서 사람이 연결한 세트만 — 제목을 오더로 풀지 않는다 · 사용 중 아닌 세트는 담기 없이 상태만 */}
                                      {m.orderSet && (m.orderSet.status === 'ACTIVE'
                                        ? canOrderSet && (
                                          <button type="button" onClick={() => onOpenOrderSet(m.orderSet!.id)} data-assist-ms-set={m.orderSet.id}
                                            title={m.orderSet.name ?? undefined}
                                            className="min-h-[32px] shrink-0 rounded-lg bg-emerald-600 px-2 text-[11px] font-semibold text-white">
                                            <T k="세트 담기" />
                                          </button>
                                        )
                                        : <span className="shrink-0 text-[10px] text-amber-700" data-assist-ms-set-stale={m.orderSet.status}><T k={m.orderSet.status === 'MISSING' ? '연결 세트 없음' : '연결 세트 사용 중 아님'} /></span>)}
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          ))}
                          {!overdue.length && !todayMs.length && !nextMs.length && <p className="text-xs text-gray-500"><T k="오늘·내일 예정된 경로 항목이 없습니다." /></p>}
                          <p className="text-[10px] text-gray-400"><T k="경로 항목은 참고입니다 — 처방을 자동으로 내지 않습니다(연결된 세트도 미리보기 후 직접 담습니다). 기록 없는 항목을 지연으로 판정하지 않습니다." /></p>
                        </>
                      )}
                </div>
              )}
        </div>
      )}

      {open === 'PREORDER' && (
        <div className="rounded-lg bg-white p-2.5" data-assist-panel="PREORDER">
          {pre.isError ? <QueryErrorFallback error={pre.error} onRetry={() => pre.refetch()} />
            : pre.isLoading ? <div className="h-16 animate-pulse rounded bg-gray-100" />
              : !preList.length ? <p className="text-xs text-gray-500"><T k="이 환자에게 대기 중인 사전처방이 없습니다." /></p>
                : (
                  <ul className="space-y-1">
                    {preList.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-amber-50/60" data-assist-preorder={p.id}>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900">
                            {p.medicationCode?.nameKo ?? p.procedureCode?.nameKo ?? <T k="이름 없음" />}
                            {p.priority === 'STAT' && <span className="ml-1 rounded bg-rose-600 px-1 text-[9px] font-bold text-white">STAT</span>}
                          </p>
                          <p className="text-[10px] text-gray-500">
                            {[p.dosage, p.frequency].filter(Boolean).join(' · ')}
                            {p.reason && <> · {p.reason}</>}
                            {p.doctor && <> · {joinPatientName(p.doctor.familyName, p.doctor.givenName)}</>}
                            {' · '}<T k="낸 날" /> <KDate value={p.createdAt} />
                            {p.appointment?.scheduledAt && <> · <T k="예약" /> <KDate value={p.appointment.scheduledAt} mode="datetimeShort" /></>}
                          </p>
                        </div>
                        {canApprove
                          ? (
                            <button type="button" disabled={approving === p.id} onClick={() => approve(p)} data-assist-approve={p.id}
                              className="min-h-[44px] rounded-lg bg-amber-500 px-3 text-xs font-semibold text-white disabled:opacity-50">
                              <T k="이번 진료로 승인" />
                            </button>
                          )
                          : <span className="text-[10px] text-gray-400"><T k="승인은 의사가 합니다" /></span>}
                      </li>
                    ))}
                  </ul>
                )}
          <p className="mt-1.5 text-[10px] text-gray-400"><T k="승인하면 이 진료에 처방이 만들어지고 승인 시점에 DUR 을 다시 확인합니다." /></p>
        </div>
      )}
    </div>
  );
}
