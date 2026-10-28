'use client';

import { LabTerm } from '@/components/ui/lab-term';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { Duration, KDate, Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FreshnessBadge } from '@/components/dashboard/FreshnessBadge';
import { apiClient } from '@/lib/api-client';
import { useHasRole } from '@/hooks/use-admin-write';
import { toast } from '@/stores/toast-store';
import { pollMs } from '@/lib/ui-settings';

type Alert = { id: string; patientId: string; name: string; mrn: string; testName: string; value: string; unit: string; reason: string; notifiedAt: string; minsElapsed: number; status?: string; escalatedAt?: string | null };
/** 확인 이후 루프 — ACKNOWLEDGED(조치 기록 대기)·ACTED(종결 대기) */
type FollowUp = { id: string; patientId: string; testName: string; value: string; unit: string; status: string; acknowledgedAt: string | null; actedAt: string | null; responseAction: string | null; patient: { familyName: string; givenName: string; mrn: string } | null };
type Queue = { testType: string; ordered: number; inProgress: number; total: number };
type Overdue = { id: string; testType: string; testName: string; status: string; priority: string; patientId: string; elapsed: number; target: number; roomName?: string | null };
type Critical = { id: string; testType: string; testName: string; criticalNote?: string | null; patientId: string; reportedAt?: string | null };
/** 원자료(위급 flag)에는 있는데 경보가 생성되지 않은 결과 — '경보 부재' 자체가 결함이다 */
type Unalerted = { id: string; labResultId: string; patientId: string | null; name: string; mrn: string; testName: string; value: string; unit: string; flag: string | null; resultAt: string | null };
type Resp = {
  summary: { criticalPending: number; criticalOverdue: number | null; criticalOverdueAfterMinutes: number | null; criticalOverduePolicy: 'CONFIGURED' | 'NOT_CONFIGURED' | 'INVALID' | 'UNAVAILABLE'; labPending: number; imagingUnread: number; functionalActive: number; functionalCritical: number; tatOverdue: number; pendingReview: number; criticalUnalerted: number; criticalFlagTotal: number };
  criticalAlerts: Alert[];
  criticalUnalertedList: Unalerted[];
  labStatus: { pending: number; inProgress: number };
  imagingUnread: number;
  imagingByModality: { modality: string; count: number }[];
  functionalQueues: Queue[];
  functionalCritical: Critical[];
  tatOverdue: Overdue[];
  pendingReviewList: { id: string; testType: string; testName: string; conclusion?: string | null; patientId: string; deltaFlag: boolean; criticalFlag: boolean }[];
};
const TEST_LABEL: Record<string, string> = { EKG: '심전도', EEG: '뇌파', PFT: '폐기능', ECHO: '심초음파', HOLTER: 'Holter', TMT: '운동부하', PSG: '수면다원', AUDIOMETRY: '청력', DEXA: '골밀도', ENDOSCOPY_UPPER: '위내시경', ENDOSCOPY_LOWER: '대장내시경' };

function Stat({ label, value, tone, sub }: { label: string; value: number | null; tone?: string; sub?: ReactNode }) {
  return (
    /* 🔴 라벨 `경보 미생성(원자료 위급)` 이 최소폭 150px 카드에서 2줄로 접혀 그 카드만 높아졌다 */
    <div className={`flex flex-col justify-center rounded-2xl border p-4 ${tone ?? 'border-gray-100 bg-white'}`}>
      {/* 산출 불가(null)는 0 이 아니다 — '-' 로 두고 사유는 sub 가 말한다 */}
      <div className="overflow-x-auto whitespace-nowrap text-2xl font-bold text-gray-900">{value ?? '-'}</div>
      <div className="text-xs text-gray-500 mt-0.5"><T k={label} /></div>
      {sub ? <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div> : null}
    </div>
  );
}
// 경과 표기는 표시 정본(`<Duration>`)이 담당한다 — 로컬 포맷터는 24시간을 일로 바꾸지 못해
// TAT 초과가 `1815시간 1분`(=75일)처럼 읽을 수 없는 값이 됐다(2026-08-12 실측).

export default function DiagnosticsBoard() {
  /** 🔴 검사 결과 검토(승인·반려)는 의학적 판단이라 서버가 `@Roles(DOCTOR, ADMIN)` 이다 */
  const canReview = useHasRole('DOCTOR');
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const { data, isLoading, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['diagnostics-board'],
    queryFn: () => apiClient.get<{ data: Resp }>('/api/v1/diagnostics/board'),
    refetchInterval: pollMs('normal'),
  });
  const r = data?.data;
  const s = r?.summary;
  const alerts = r?.criticalAlerts ?? [];
  /** 허용시간 초과로 크론이 상향 표시한 미확인 — 목록(최대 100)에서 센다(미확인 건수와 같은 모집단) */
  const escalatedCount = alerts.filter((a) => a.status === 'ESCALATED').length;
  const unalerted = r?.criticalUnalertedList ?? [];
  const queues = r?.functionalQueues ?? [];
  const imgModality = r?.imagingByModality ?? [];
  const overdue = r?.tatOverdue ?? [];
  const funcCritical = r?.functionalCritical ?? [];
  const pendingReview = r?.pendingReviewList ?? [];

  /**
   * 🔴 확인(ACKNOWLEDGED)에서 루프가 멈추지 않게 — 조치 기록(ACTED)·종결(CLOSED)이 남은 경보 목록.
   *    서버가 DOCTOR·ADMIN 전용이라 그 밖의 직군은 부르지 않는다(부르면 403 배너만 남는다).
   */
  const followQ = useQuery({
    queryKey: ['critical-values-follow-ups'],
    queryFn: () => apiClient.get<{ data: FollowUp[] }>('/api/v1/lab/critical-values/follow-ups'),
    enabled: canReview,
    refetchInterval: pollMs('normal'),
  });
  const followUps = ((followQ.data?.data as { data?: FollowUp[] })?.data ?? followQ.data?.data ?? []) as FollowUp[];
  const [actionDraft, setActionDraft] = useState<Record<string, string>>({});
  const loopMut = useMutation({
    mutationFn: ({ id, op, action }: { id: string; op: 'act' | 'close'; action?: string }) =>
      apiClient.patch(`/api/v1/lab/critical-values/${id}/${op}`, op === 'act' ? { action } : {}),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['critical-values-follow-ups'] });
      if (v.op === 'act') setActionDraft((m) => ({ ...m, [v.id]: '' }));
      toast.success(v.op === 'act' ? '조치를 기록했습니다' : '종결했습니다');
    },
    // 🔴 실패를 삼키지 않는다 — 409(다른 사람이 먼저 바꿈)·400(전이 불가)은 루프가 닫히지 않았다는 사실이다
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '처리하지 못했습니다'),
  });

  const reviewMut = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: string }) => apiClient.patch(`/api/v1/diagnostic-tests/${id}/review`, { decision }),
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: ['diagnostics-board'] }); toast.success(v.decision === 'APPROVED' ? '판독 승인' : '판독 반려'); },
    onError: () => toast.error('처리 실패'),
  });

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="검사·영상 보드" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="위험값(critical) 미보고·검사 대기·영상 판독대기 실시간 현황" /></p>
        </div>
        <FreshnessBadge updatedAt={dataUpdatedAt} isFetching={isFetching} staleMs={35000} />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        <Stat label="위험값 미보고" value={s?.criticalPending ?? 0} tone="border-rose-200 bg-rose-50" />
        {/* 🔴 (2026-09-14) 종전 '30분 초과' 하드코딩 — 기준은 상향 보고 크론과 같은 config. 미설정·해석 불가·조회 실패는 '-' + 사유 */}
        <Stat
          label="허용시간 초과 미보고"
          value={s ? s.criticalOverdue : 0}
          tone="border-rose-300 bg-rose-100"
          sub={!s ? null
            : s.criticalOverduePolicy === 'CONFIGURED' && s.criticalOverdueAfterMinutes != null ? <Tf k="기준 {분}분" params={{ 분: s.criticalOverdueAfterMinutes }} />
            : s.criticalOverduePolicy === 'INVALID' ? <T k="기준 해석 불가" />
            : s.criticalOverduePolicy === 'UNAVAILABLE' ? <T k="기준 조회 불가" />
            : <T k="기준 미설정" />}
        />
        {/* 허용시간 config 를 넘겨 크론이 상향 표시한 미확인 — 허용시간 미설정이면 늘 0 이다(아래 표 머리에서 기준을 말한다) */}
        <Stat label="허용시간 초과 상향 표시" value={escalatedCount} tone={escalatedCount > 0 ? 'border-yellow-300 bg-yellow-50' : undefined} />
        {/* 🔴 경보가 아니라 '경보 부재' — 원자료에 위급 flag 가 있는데 경보가 없는 건. 0 이 아니면 아래 초록을 띄우지 않는다. */}
        <Stat label="경보 미생성(원자료 위급)" value={s?.criticalUnalerted ?? 0} tone={(s?.criticalUnalerted ?? 0) > 0 ? 'border-amber-300 bg-amber-50' : undefined} />
        <Stat label="검사 대기" value={s?.labPending ?? 0} />
        <Stat label="영상 판독대기" value={s?.imagingUnread ?? 0} />
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        <Stat label="기능검사 미완료" value={s?.functionalActive ?? 0} />
        <Stat label="기능검사 위험소견" value={s?.functionalCritical ?? 0} tone={(s?.functionalCritical ?? 0) > 0 ? 'border-rose-200 bg-rose-50' : undefined} />
        <Stat label="TAT 초과" value={s?.tatOverdue ?? 0} tone={(s?.tatOverdue ?? 0) > 0 ? 'border-amber-200 bg-amber-50' : undefined} />
        <Stat label="판독 검토 대기" value={s?.pendingReview ?? 0} tone={(s?.pendingReview ?? 0) > 0 ? 'border-indigo-200 bg-indigo-50' : undefined} />
      </div>

      {/* 기능검사 위험소견(미검토) */}
      {funcCritical.length > 0 && (
        <div className="bg-white rounded-2xl border border-rose-200 shadow-sm p-4">
          <div className="text-sm font-bold text-rose-700 mb-2">⚠ <T k="기능검사 위험소견 (미검토)" /></div>
          <div className="space-y-1.5">
            {funcCritical.map(c => (
              <div key={c.id} className="flex items-center gap-2 text-xs bg-rose-50 rounded-lg px-3 py-2">
                <span className="font-bold text-rose-700 whitespace-nowrap">{TEST_LABEL[c.testType] ?? c.testType}</span>
                <span className="text-gray-700 truncate">{c.criticalNote ?? c.testName}</span>
                <Link href={`/patients/${c.patientId}`} className="ml-auto text-blue-700 hover:underline shrink-0"><T k="환자" /></Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 모달별 큐 */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(420px,1fr))] gap-3">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="text-sm font-bold text-gray-800 mb-2"><T k="기능검사 모달별 큐" /></div>
          {queues.length === 0 ? <p className="text-xs text-gray-400"><T k="대기 없음" /></p> : (
            <div className="space-y-1">
              {queues.map(q => (
                <div key={q.testType} className="flex items-center justify-between text-xs border-b border-gray-50 py-1.5">
                  <span className="text-gray-700">{TEST_LABEL[q.testType] ?? q.testType}</span>
                  <span className="flex gap-2"><span className="text-gray-500"><T k="대기" /> {q.ordered}</span><span className="text-blue-600"><T k="진행" /> {q.inProgress}</span><span className="font-bold text-gray-800"><T k="계" /> {q.total}</span></span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="text-sm font-bold text-gray-800 mb-2"><T k="영상 모달별 판독대기" /></div>
          {imgModality.length === 0 ? <p className="text-xs text-gray-400"><T k="판독대기 없음" /></p> : (
            <div className="space-y-1">
              {imgModality.map(m => (
                <div key={m.modality} className="flex items-center justify-between text-xs border-b border-gray-50 py-1.5">
                  <span className="text-gray-700">{m.modality}</span>
                  <span className="font-bold text-gray-800">{m.count}<Unit>건</Unit></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* TAT 초과 */}
      {overdue.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-4">
          <div className="text-sm font-bold text-amber-700 mb-2"><T k="TAT 초과 (목표 소요시간 경과)" /></div>
          <div className="space-y-1">
            {overdue.map(o => (
              <div key={o.id} className="flex items-center gap-2 text-xs border-b border-gray-50 py-1.5">
                {o.priority === 'STAT' && <span className="px-1.5 py-0.5 rounded-full bg-rose-600 text-white font-bold whitespace-nowrap">STAT</span>}
                <span className="text-gray-700">{TEST_LABEL[o.testType] ?? o.testType}</span>
                {o.roomName && <span className="text-gray-400">· {o.roomName}</span>}
                <span className="ml-auto text-amber-700 font-semibold whitespace-nowrap"><Duration minutes={o.elapsed} /> / <T k="목표" /> {o.target}<Unit>분</Unit></span>
                <Link href={`/patients/${o.patientId}`} className="text-blue-700 hover:underline shrink-0"><T k="환자" /></Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 판독 검토 대기 (P2 서명 워크플로) */}
      {pendingReview.length > 0 && (
        <div className="bg-white rounded-2xl border border-indigo-200 shadow-sm p-4">
          <div className="text-sm font-bold text-indigo-700 mb-2"><T k="판독 검토 대기 (서명)" /></div>
          <div className="space-y-1.5">
            {pendingReview.map(t => (
              <div key={t.id} className="flex items-center gap-2 text-xs border-b border-gray-50 py-1.5">
                <span className="font-medium text-gray-800 whitespace-nowrap">{TEST_LABEL[t.testType] ?? t.testType}</span>
                <span className="text-gray-500">{t.conclusion ?? '-'}</span>
                {t.criticalFlag && <span className="px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 font-bold whitespace-nowrap"><T k="위험" /></span>}
                {t.deltaFlag && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold whitespace-nowrap"><T k="급변" /></span>}
                <div className="ml-auto flex items-center gap-1.5 shrink-0">
                  <Link href={`/patients/${t.patientId}`} className="text-blue-700 hover:underline"><T k="환자" /></Link>
                  {canReview && <button onClick={() => reviewMut.mutate({ id: t.id, decision: 'APPROVED' })} className="px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700"><T k="승인@버튼" /></button>}
                  {canReview && <button onClick={() => reviewMut.mutate({ id: t.id, decision: 'REJECTED' })} className="px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700"><T k="반려@버튼" /></button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-bold text-rose-700 bg-rose-50/40">⚠ <T k="위험값 미보고 (PENDING)" /></div>
        {isLoading ? <div className="p-8 text-center text-sm text-gray-400"><T k="불러오는 중…" /></div>
        : !alerts.length ? (
          // 🔴 "경보 0 = 안전"이 아니다. 이 표는 **탐지된 경보**만 센다 — 원자료(위급 flag)에 있는데
          //    경보가 만들어지지 않은 건이 있으면 초록을 띄우는 순간 화면이 거짓말을 한다(P17).
          (unalerted.length > 0 || (s?.criticalUnalerted ?? 0) > 0)
            ? <div className="p-6 text-center text-sm text-amber-700 bg-amber-50/60">
                미확인 경보는 없습니다. 다만 <strong>원자료에 위급값 {s?.criticalUnalerted ?? unalerted.length}건</strong>이 있는데 경보가 생성되지 않았습니다 — 아래 표를 확인하세요.
              </div>
            : (s?.criticalFlagTotal ?? 0) === 0
              ? <div className="p-8 text-center text-sm text-gray-500">위급 flag 결과 자체가 없습니다(표본 없음) — &lsquo;안전&rsquo;이 아니라 &lsquo;해당 없음&rsquo;입니다.</div>
              : <div className="p-8 text-center text-sm text-emerald-600">미보고 위험값이 없습니다 ✓ <span className="text-[11px] text-gray-400">(위급 flag 결과 {s?.criticalFlagTotal}건 전건 경보 생성됨)</span></div>
        )
        : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-[11px] text-gray-400 text-left">
                <th className="px-4 py-2 font-medium"><T k="환자" /></th>
                <th className="px-3 py-2 font-medium"><T k="검사@항목" /></th>
                <th className="px-3 py-2 font-medium"><T k="값" /></th>
                <th className="px-3 py-2 font-medium"><T k="사유" /></th>
                <th className="px-3 py-2 font-medium"><T k="경과" /></th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} className={`border-b border-gray-50 hover:bg-gray-50/60 ${a.minsElapsed >= 30 ? 'bg-rose-50/50' : ''}`}>
                  <td className="px-4 py-2.5">
                    <Link href={`/patients/${a.patientId}`} className="font-medium text-blue-700 hover:underline">{a.name}</Link>
                    <span className="text-[11px] text-gray-400 ml-1.5 font-mono">{a.mrn}</span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-700"><LabTerm name={a.testName} /></td>
                  <td className="px-3 py-2.5"><span className="text-rose-600 font-semibold">{a.value}</span> <span className="text-[11px] text-gray-400">{a.unit}</span></td>
                  <td className="px-3 py-2.5 text-[11px] text-gray-500">
                    {a.reason}
                    {a.status === 'ESCALATED' && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 text-[10px] font-bold whitespace-nowrap"><T k="상향 표시" /></span>
                    )}
                  </td>
                  <td className="px-3 py-2.5"><span className={a.minsElapsed >= 30 ? 'text-rose-600 font-semibold' : 'text-gray-600'}><Duration minutes={a.minsElapsed} /></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canReview && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-bold text-gray-800"><T k="위급값 확인 이후 — 조치 기록·종결 대기" /></div>
          {followQ.isError
            ? <div className="p-4 text-sm text-rose-700"><T k="확인 이후 목록을 불러오지 못했습니다" /></div>
            : followQ.isLoading
              ? <div className="p-4 text-sm text-gray-400"><T k="불러오는 중" /></div>
              : followUps.length === 0
                ? <div className="p-4 text-sm text-gray-500"><T k="조치 기록·종결이 남은 위급값이 없습니다" /></div>
                : (
                  <div className="divide-y divide-gray-50">
                    {followUps.map((f) => (
                      <div key={f.id} className="px-4 py-2.5 flex flex-wrap items-center gap-2 text-sm">
                        <Link href={`/patients/${f.patientId}`} className="font-medium text-blue-700 hover:underline">
                          {f.patient ? `${f.patient.familyName}${f.patient.givenName}` : '-'}
                        </Link>
                        <span className="text-gray-700"><LabTerm name={f.testName} /> <strong>{f.value}</strong> <span className="text-[11px] text-gray-400">{f.unit}</span></span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${f.status === 'ACTED' ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'}`}>
                          {f.status === 'ACTED' ? <T k="조치 기록됨 — 종결 대기" /> : <T k="확인됨 — 조치 기록 대기" />}
                        </span>
                        {f.status === 'ACKNOWLEDGED' ? (
                          <span className="ml-auto flex items-center gap-1.5">
                            <input value={actionDraft[f.id] ?? ''} onChange={(e) => setActionDraft((m) => ({ ...m, [f.id]: e.target.value }))}
                              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs w-56" aria-label={tAttr('조치 내용')} />
                            <button onClick={() => loopMut.mutate({ id: f.id, op: 'act', action: actionDraft[f.id] })}
                              disabled={!(actionDraft[f.id] ?? '').trim() || loopMut.isPending}
                              className="min-h-[44px] px-3 rounded-lg bg-sky-600 text-white text-xs font-bold disabled:opacity-50"><T k="조치 기록" /></button>
                          </span>
                        ) : (
                          <button onClick={() => loopMut.mutate({ id: f.id, op: 'close' })} disabled={loopMut.isPending}
                            className="ml-auto min-h-[44px] px-3 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:opacity-50"><T k="종결" /></button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
        </div>
      )}

      {/* 🔴 원자료와 경보의 괴리 — 지표가 '탐지된 경보'만 세고 있다는 사실을 화면에서 드러낸다.
          운영 실측(2026-08-18): lab_result_items 3,188건 중 flag HH/LL 6건에 대응하는 경보 0건
          (시드가 결과 저장 경로를 우회해 INSERT). 원인은 데이터 생성 쪽이지만, 그것을 숨기면
          화면이 "미보고 위험값 없음 ✓"이라고 안심시킨다. 조치 판단은 사람이 한다. */}
      {unalerted.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-300 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-amber-100 text-sm font-bold text-amber-800 bg-amber-50">
            ⚠ 원자료 위급값인데 경보 미생성 ({s?.criticalUnalerted ?? unalerted.length}<Unit>건</Unit> / 위급 flag 결과 {s?.criticalFlagTotal ?? '-'}<Unit>건</Unit>)
          </div>
          <p className="px-4 py-2 text-[11px] text-gray-500 bg-amber-50/40">
            결과에 위급 flag(HH·LL 등)가 있으나 통보 경보(CriticalValueAlert)가 없습니다. 위 &lsquo;위험값 미보고&rsquo; 표에는 나타나지 않으므로,
            경보 건수만으로 안전을 판단하면 안 됩니다. 결과 저장 경로를 우회해 들어온 데이터일 수 있습니다.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-[11px] text-gray-400 text-left">
                <th className="px-4 py-2 font-medium"><T k="환자" /></th>
                <th className="px-3 py-2 font-medium"><T k="검사@항목" /></th>
                <th className="px-3 py-2 font-medium"><T k="값" /></th>
                <th className="px-3 py-2 font-medium">flag</th>
                <th className="px-3 py-2 font-medium"><T k="결과일" /></th>
              </tr>
            </thead>
            <tbody>
              {unalerted.map((u) => (
                <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                  <td className="px-4 py-2.5">
                    {u.patientId
                      ? <Link href={`/patients/${u.patientId}`} className="font-medium text-blue-700 hover:underline">{u.name}</Link>
                      : <span className="text-gray-400">-</span>}
                    <span className="text-[11px] text-gray-400 ml-1.5 font-mono">{u.mrn}</span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-700"><LabTerm name={u.testName} /></td>
                  <td className="px-3 py-2.5"><span className="text-amber-700 font-semibold">{u.value}</span> <span className="text-[11px] text-gray-400">{u.unit}</span></td>
                  <td className="px-3 py-2.5"><span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[11px] font-bold">{u.flag ?? '-'}</span></td>
                  <td className="px-3 py-2.5 text-[11px] text-gray-500">{u.resultAt ? <KDate value={u.resultAt} /> : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
