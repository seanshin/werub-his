'use client';

// Code Blue / RRT 기록·통계 — gap-remediation R4 (EP 7종 첫 소비처)
// 🔴 시각은 사실 입력이다 — 자동 now 채움은 버튼별 "지금" 명시 클릭만(자동 각인 금지).
// 🔴 목록은 서버가 최근 200건으로 절단한다 — 통계 탭의 서버 집계(stats)는 절단 없음.
// 🔴 서버는 시간 순서·상태 전이를 강제하지 않는다(실측 2026-09-06) — 역전 기록은 숨기지 않고 표기한다.

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { CodeCallModal } from '@/components/staff-call/CodeCallModal';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { EmptyState, KDate } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import PatientSelector from '@/components/ui/PatientSelector';
import { RATIO_UNAVAILABLE, canCallCode } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface CodeBlueEvent {
  id: string;
  patientId: string;
  location: string;
  recognizedAt: string;
  teamArrivedAt?: string | null;
  cprStartedAt?: string | null;
  roscAt?: string | null;
  endedAt?: string | null;
  defibrillationCount: number;
  outcome: 'ONGOING' | 'ROSC' | 'DEATH' | 'TRANSFER';
  notes?: string | null;
  patient: { id: string; familyName?: string; givenName?: string; mrn?: string } | null;
  responseMinutes: number | null;
}

interface RrtRow {
  id: string;
  patientId: string;
  trigger: 'NEWS2' | 'DIRECT_CALL' | 'FAMILY' | 'OTHER';
  activatedAt: string;
  respondedAt?: string | null;
  responderTeam?: string | null;
  reason?: string | null;
  outcome: 'ONGOING' | 'WARD_STAY' | 'ICU_TRANSFER' | 'CODE_BLUE' | 'DECEASED';
  patient: { id: string; familyName?: string; givenName?: string; mrn?: string } | null;
  slaMinutes: number | null;
}

interface CodeBlueStats {
  total: number; rosc: number; death: number; ongoing: number; transfer: number;
  roscRate: number | null; avgArrivalMinutes: number | null; arrivalsN: number;
}

const OUTCOME_LABEL: Record<string, string> = { ONGOING: '진행 중', ROSC: 'ROSC(자발순환 회복)', DEATH: '사망', TRANSFER: '전원' };
const RRT_TRIGGER_LABEL: Record<string, string> = { NEWS2: 'NEWS2 조기경보', DIRECT_CALL: '직접 호출', FAMILY: '가족 요청', OTHER: '기타' };
const RRT_OUTCOME_LABEL: Record<string, string> = { ONGOING: '진행 중', WARD_STAY: '병동 유지', ICU_TRANSFER: 'ICU 전동', CODE_BLUE: '코드블루 격상', DECEASED: '사망' };

const pName = (p: CodeBlueEvent['patient']) => (p ? `${p.familyName ?? ''}${p.givenName ?? ''}` : '(환자 미확인)');

/** datetime-local 값 → ISO. 빈 값은 null(자동 채움 금지 — 서버로 안 보낸다). */
const toIso = (v: string) => (v ? new Date(v).toISOString() : null);
const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export default function CodeBluePage() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-gray-50" />}>
      <CodeBlueInner />
    </Suspense>
  );
}

function CodeBlueInner() {
  const [tab, setTab] = useState<'code-blue' | 'rrt' | 'stats'>('code-blue');
  const role = useAuthStore((st) => st.user?.role);
  const [codeOpen, setCodeOpen] = useState(false);
  // 🔴 (2026-10-07) 호출(스태프콜 CODE)과 소생 기록이 이어지지 않았다 — `staffCallId` 칸은 있는데 아무도 채우지 않았다.
  //    호출 뒤 "소생 기록 시작"으로 오면(쿼리) 그 호출·위치로 기록 창을 연다
  const params = useSearchParams();
  const prefill = params.get('staffCallId') ? { staffCallId: params.get('staffCallId')!, location: params.get('location') ?? '' } : null;
  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
       <div>
        <h1 className="text-xl font-bold text-gray-900">Code Blue / RRT</h1>
        <p className="mt-1 text-sm text-gray-500">
          원내 심정지(Code Blue) 소생 경과와 신속대응팀(RRT) 활성화·응답 기록.
          호출·알림은 스태프콜(CODE)이 담당합니다 — 이 화면은 <b>경과 기록</b>입니다.
        </p>
       </div>
        {canCallCode(role) && (
          <button type="button" onClick={() => setCodeOpen(true)} data-codeblue-call
            className="min-h-[48px] rounded-xl bg-red-600 px-5 text-sm font-bold text-white shadow-sm hover:bg-red-700">🚨 <T k="코드 호출" /></button>
        )}
      </div>
      {codeOpen && <CodeCallModal onClose={() => setCodeOpen(false)} />}
      <div className="flex gap-1 border-b border-gray-200">
        {([['code-blue', '코드블루'], ['rrt', 'RRT(신속대응팀)'], ['stats', '통계']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`min-h-[44px] px-4 text-sm font-medium ${tab === k ? 'border-b-2 border-red-600 text-red-700' : 'text-gray-500 hover:text-gray-800'}`}>
            <T k={label} />
          </button>
        ))}
      </div>
      {tab === 'code-blue' && <CodeBlueTab key={prefill?.staffCallId ?? 'none'} prefill={prefill} />}
      {tab === 'rrt' && <RrtTab />}
      {tab === 'stats' && <StatsTab />}
    </div>
  );
}

/* ── 코드블루 ─────────────────────────────────────────────── */

function CodeBlueTab({ prefill }: { prefill: { staffCallId: string; location: string } | null }) {
  const qc = useQueryClient();
  const tA = useTAttr();
  const [showCreate, setShowCreate] = useState(!!prefill);
  const [closeTarget, setCloseTarget] = useState<CodeBlueEvent | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['code-blue-list'],
    queryFn: () => apiClient.get<{ data: CodeBlueEvent[] }>('/api/v1/code-blue'),
  });
  const rows = (data?.data ?? []) as CodeBlueEvent[];
  const ongoing = rows.filter((r) => r.outcome === 'ONGOING');
  const closed = rows.filter((r) => r.outcome !== 'ONGOING');

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiClient.patch(`/api/v1/code-blue/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['code-blue-list'] }); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '기록 실패'),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={() => refetch()} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <T k="진행 중" />
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${ongoing.length ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>{ongoing.length}건</span>
        </h2>
        <button type="button" onClick={() => setShowCreate(true)}
          className="min-h-[44px] rounded-xl bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700">
          + <T k="코드블루 발생 기록" />
        </button>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-gray-400"><T k="불러오는 중…" /></div>
      ) : ongoing.length === 0 ? (
        <EmptyState compact title="진행 중인 코드블루가 없습니다" />
      ) : (
        <div className="space-y-3">
          {ongoing.map((ev) => (
            <div key={ev.id} className="rounded-xl border-2 border-red-200 bg-red-50/50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-gray-900">{pName(ev.patient)}</span>
                {ev.patient?.mrn && <span className="text-xs text-gray-500">{ev.patient.mrn}</span>}
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{ev.location}</span>
                <span className="text-xs text-gray-500"><T k="발견" /> <KDate value={ev.recognizedAt} mode="datetime" /></span>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Milestone label="팀 도착" value={ev.teamArrivedAt} onNow={() => patch.mutate({ id: ev.id, body: { teamArrivedAt: new Date().toISOString() } })} />
                <Milestone label="CPR 시작" value={ev.cprStartedAt} onNow={() => patch.mutate({ id: ev.id, body: { cprStartedAt: new Date().toISOString() } })} />
                <Milestone label="ROSC" value={ev.roscAt} onNow={() => patch.mutate({ id: ev.id, body: { roscAt: new Date().toISOString() } })} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-sm text-gray-700">제세동 <b>{ev.defibrillationCount}</b>회</span>
                <button type="button" disabled={patch.isPending}
                  onClick={() => patch.mutate({ id: ev.id, body: { defibrillationCount: ev.defibrillationCount + 1 } })}
                  className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium hover:bg-gray-50">+1 제세동</button>
                <button type="button" onClick={() => setCloseTarget(ev)}
                  className="ml-auto min-h-[44px] rounded-lg bg-gray-800 px-4 text-sm font-semibold text-white hover:bg-gray-900"><T k="종결 기록" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <section>
        <h2 className="mb-2 text-base font-semibold text-gray-700"><T k="종결 기록" /> ({closed.length}건 · <T k="서버가 최근 200건까지만 반환" />)</h2>
        {closed.length === 0 ? (
          <EmptyState compact title="종결된 기록이 없습니다" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2"><T k="환자" /></th><th className="px-3 py-2"><T k="장소" /></th><th className="px-3 py-2"><T k="발견" /></th>
                  <th className="px-3 py-2"><T k="팀도착(분)" /></th><th className="px-3 py-2"><T k="제세동" /></th><th className="px-3 py-2"><T k="결과" /></th>
                </tr>
              </thead>
              <tbody>
                {closed.map((ev) => (
                  <tr key={ev.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-medium">{pName(ev.patient)}</td>
                    <td className="px-3 py-2 text-gray-600">{ev.location}</td>
                    <td className="px-3 py-2 text-gray-600"><KDate value={ev.recognizedAt} mode="datetime" /></td>
                    <td className="px-3 py-2">
                      {ev.responseMinutes == null ? <span className="text-gray-400"><T k="기록 없음" /></span>
                        : ev.responseMinutes < 0 ? <span className="text-amber-600" title="팀도착 시각이 발견 시각보다 앞서 기록됨">{ev.responseMinutes} (시간 역전 기록)</span>
                        : ev.responseMinutes}
                    </td>
                    <td className="px-3 py-2">{ev.defibrillationCount}</td>
                    <td className="px-3 py-2">{OUTCOME_LABEL[ev.outcome] ?? ev.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showCreate && <CreateCodeBlueDialog prefill={prefill} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['code-blue-list'] }); }} />}
      {closeTarget && (
        <CloseCodeBlueDialog ev={closeTarget} onClose={() => setCloseTarget(null)}
          onSaved={() => { setCloseTarget(null); qc.invalidateQueries({ queryKey: ['code-blue-list'] }); }} />
      )}
    </div>
  );
}

/** 경과 지점 — 기록된 시각을 보여주거나, "지금" 명시 클릭으로만 각인한다 */
function Milestone({ label, value, onNow }: { label: string; value?: string | null; onNow: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2">
      <T k={label} className="text-xs font-semibold text-gray-500" />
      {value ? (
        <span className="text-sm font-medium text-gray-900"><KDate value={value} mode="time" /></span>
      ) : (
        <button type="button" onClick={onNow} className="min-h-[44px] rounded-lg bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700"><T k="지금" /></button>
      )}
    </div>
  );
}

function CreateCodeBlueDialog({ prefill, onClose, onCreated }: { prefill?: { staffCallId: string; location: string } | null; onClose: () => void; onCreated: () => void }) {
  const tA = useTAttr();
  const [patientId, setPatientId] = useState('');
  const [location, setLocation] = useState(prefill?.location ?? '');
  const [recognizedAt, setRecognizedAt] = useState(''); // 미선택이 초기값 — "지금" 클릭 또는 직접 입력
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!patientId || !recognizedAt) return;
    setSaving(true);
    try {
      await apiClient.post('/api/v1/code-blue', {
        patientId, location: location.trim() || undefined,
        recognizedAt: toIso(recognizedAt), notes: notes.trim() || undefined,
        // 이 기록을 일으킨 호출(스태프콜 CODE) — 호출에서 왔을 때만
        ...(prefill?.staffCallId ? { staffCallId: prefill.staffCallId } : {}),
      });
      toast.success('코드블루 발생을 기록했습니다.');
      onCreated();
    } catch (e) { toast.error(e instanceof Error ? e.message : '기록 실패'); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-bold text-gray-900"><T k="코드블루 발생 기록" /></h3>
        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="환자" /> *</label>
            <PatientSelector onChange={(id) => setPatientId(id)} autoFocus />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="발생 장소" /></label>
            <input value={location} maxLength={100} onChange={(e) => setLocation(e.target.value)} placeholder={tA('예: 5병동 512호')}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="발견 시각" /> *</label>
            <div className="flex gap-2">
              <input type="datetime-local" value={recognizedAt} onChange={(e) => setRecognizedAt(e.target.value)}
                className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm" />
              <button type="button" onClick={() => setRecognizedAt(nowLocal())}
                className="min-h-[44px] rounded-lg border border-blue-300 bg-blue-50 px-3 text-xs font-bold text-blue-700"><T k="지금" /></button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="비고" /></label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-lg border border-gray-300 px-4 text-sm text-gray-700"><T k="취소" /></button>
          <button type="button" onClick={submit} disabled={saving || !patientId || !recognizedAt}
            className="min-h-[44px] rounded-lg bg-red-600 px-4 text-sm font-bold text-white disabled:opacity-50">
            <T k={saving ? '기록 중…' : '발생 기록'} />
          </button>
        </div>
      </div>
    </div>
  );
}

function CloseCodeBlueDialog({ ev, onClose, onSaved }: { ev: CodeBlueEvent; onClose: () => void; onSaved: () => void }) {
  const tA = useTAttr();
  const [endedAt, setEndedAt] = useState('');
  const [outcome, setOutcome] = useState<'' | 'ROSC' | 'DEATH' | 'TRANSFER'>(''); // 미선택 초기값
  const [notes, setNotes] = useState(ev.notes ?? '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!endedAt || !outcome) return;
    setSaving(true);
    try {
      await apiClient.patch(`/api/v1/code-blue/${ev.id}`, { endedAt: toIso(endedAt), outcome, notes: notes.trim() || undefined });
      toast.success('종결을 기록했습니다.');
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : '기록 실패'); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-bold text-gray-900"><T k="종결 기록" /> — {pName(ev.patient)}</h3>
        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="종료 시각" /> *</label>
            <div className="flex gap-2">
              <input type="datetime-local" value={endedAt} onChange={(e) => setEndedAt(e.target.value)}
                className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm" />
              <button type="button" onClick={() => setEndedAt(nowLocal())}
                className="min-h-[44px] rounded-lg border border-blue-300 bg-blue-50 px-3 text-xs font-bold text-blue-700"><T k="지금" /></button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="결과" /> *</label>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm">
              <option value="">{tA('— 선택 —')}</option>
              <option value="ROSC">ROSC(자발순환 회복)</option>
              <option value="DEATH">사망</option>
              <option value="TRANSFER">전원</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="비고" /></label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-lg border border-gray-300 px-4 text-sm text-gray-700"><T k="취소" /></button>
          <button type="button" onClick={submit} disabled={saving || !endedAt || !outcome}
            className="min-h-[44px] rounded-lg bg-gray-900 px-4 text-sm font-bold text-white disabled:opacity-50">
            <T k={saving ? '기록 중…' : '종결'} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── RRT ─────────────────────────────────────────────────── */

function RrtTab() {
  const qc = useQueryClient();
  const tA = useTAttr();
  const [showActivate, setShowActivate] = useState(false);
  const [respondTarget, setRespondTarget] = useState<RrtRow | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['rrt-list'],
    queryFn: () => apiClient.get<{ data: RrtRow[] }>('/api/v1/code-blue/rrt'),
  });
  const rows = (data?.data ?? []) as RrtRow[];
  const pendingResponse = rows.filter((r) => !r.respondedAt);
  const responded = rows.filter((r) => r.respondedAt);

  if (isError) return <QueryErrorFallback error={error} onRetry={() => refetch()} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <T k="미응답" />
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${pendingResponse.length ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{pendingResponse.length}건</span>
        </h2>
        <button type="button" onClick={() => setShowActivate(true)}
          className="min-h-[44px] rounded-xl bg-amber-600 px-4 text-sm font-bold text-white hover:bg-amber-700">+ <T k="RRT 활성화" /></button>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-gray-400"><T k="불러오는 중…" /></div>
      ) : pendingResponse.length === 0 ? (
        <EmptyState compact title="응답 대기 중인 RRT 활성화가 없습니다" />
      ) : (
        <div className="space-y-2">
          {pendingResponse.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
              <span className="font-semibold text-gray-900">{pName(r.patient)}</span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{RRT_TRIGGER_LABEL[r.trigger] ?? r.trigger}</span>
              <span className="text-xs text-gray-500"><T k="활성화" /> <KDate value={r.activatedAt} mode="datetime" /></span>
              {r.reason && <span className="truncate text-xs text-gray-600" title={r.reason}>{r.reason}</span>}
              <button type="button" onClick={() => setRespondTarget(r)}
                className="ml-auto min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"><T k="응답 기록" /></button>
            </div>
          ))}
        </div>
      )}

      <section>
        <h2 className="mb-2 text-base font-semibold text-gray-700"><T k="응답 완료" /> ({responded.length}건 · <T k="서버가 최근 200건까지만 반환" />)</h2>
        {responded.length === 0 ? (
          <EmptyState compact title="응답 완료 기록이 없습니다" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr><th className="px-3 py-2"><T k="환자" /></th><th className="px-3 py-2"><T k="계기" /></th><th className="px-3 py-2"><T k="활성화" /></th><th className="px-3 py-2"><T k="도착 SLA(분)" /></th><th className="px-3 py-2"><T k="팀" /></th><th className="px-3 py-2"><T k="결과" /></th></tr>
              </thead>
              <tbody>
                {responded.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-medium">{pName(r.patient)}</td>
                    <td className="px-3 py-2 text-gray-600">{RRT_TRIGGER_LABEL[r.trigger] ?? r.trigger}</td>
                    <td className="px-3 py-2 text-gray-600"><KDate value={r.activatedAt} mode="datetime" /></td>
                    <td className="px-3 py-2">
                      {r.slaMinutes == null ? <span className="text-gray-400">-</span>
                        : r.slaMinutes < 0 ? <span className="text-amber-600" title="응답 시각이 활성화보다 앞서 기록됨">{r.slaMinutes} (시간 역전 기록)</span>
                        : r.slaMinutes}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{r.responderTeam ?? '-'}</td>
                    <td className="px-3 py-2">{RRT_OUTCOME_LABEL[r.outcome] ?? r.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showActivate && <ActivateRrtDialog onClose={() => setShowActivate(false)} onCreated={() => { setShowActivate(false); qc.invalidateQueries({ queryKey: ['rrt-list'] }); }} />}
      {respondTarget && <RespondRrtDialog row={respondTarget} onClose={() => setRespondTarget(null)} onSaved={() => { setRespondTarget(null); qc.invalidateQueries({ queryKey: ['rrt-list'] }); }} />}
    </div>
  );
}

function ActivateRrtDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const tA = useTAttr();
  const [patientId, setPatientId] = useState('');
  const [trigger, setTrigger] = useState('');
  const [activatedAt, setActivatedAt] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!patientId || !trigger || !activatedAt) return;
    setSaving(true);
    try {
      await apiClient.post('/api/v1/code-blue/rrt', { patientId, trigger, activatedAt: toIso(activatedAt), reason: reason.trim() || undefined });
      toast.success('RRT 활성화를 기록했습니다.');
      onCreated();
    } catch (e) { toast.error(e instanceof Error ? e.message : '기록 실패'); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-bold text-gray-900"><T k="RRT 활성화" /></h3>
        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="환자" /> *</label>
            <PatientSelector onChange={(id) => setPatientId(id)} autoFocus />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="활성화 계기" /> *</label>
            <select value={trigger} onChange={(e) => setTrigger(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm">
              <option value="">{tA('— 선택 —')}</option>
              {Object.entries(RRT_TRIGGER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="활성화 시각" /> *</label>
            <div className="flex gap-2">
              <input type="datetime-local" value={activatedAt} onChange={(e) => setActivatedAt(e.target.value)}
                className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm" />
              <button type="button" onClick={() => setActivatedAt(nowLocal())}
                className="min-h-[44px] rounded-lg border border-blue-300 bg-blue-50 px-3 text-xs font-bold text-blue-700"><T k="지금" /></button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="사유" /></label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-lg border border-gray-300 px-4 text-sm text-gray-700"><T k="취소" /></button>
          <button type="button" onClick={submit} disabled={saving || !patientId || !trigger || !activatedAt}
            className="min-h-[44px] rounded-lg bg-amber-600 px-4 text-sm font-bold text-white disabled:opacity-50">
            <T k={saving ? '기록 중…' : '활성화 기록'} />
          </button>
        </div>
      </div>
    </div>
  );
}

function RespondRrtDialog({ row, onClose, onSaved }: { row: RrtRow; onClose: () => void; onSaved: () => void }) {
  const tA = useTAttr();
  const [respondedAt, setRespondedAt] = useState('');
  const [team, setTeam] = useState(row.responderTeam ?? '');
  const [outcome, setOutcome] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!respondedAt) return;
    setSaving(true);
    try {
      await apiClient.patch(`/api/v1/code-blue/rrt/${row.id}`, {
        respondedAt: toIso(respondedAt), responderTeam: team.trim() || undefined,
        ...(outcome ? { outcome } : {}),
      });
      toast.success('RRT 응답을 기록했습니다.');
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : '기록 실패'); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-bold text-gray-900"><T k="RRT 응답 기록" /> — {pName(row.patient)}</h3>
        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="도착(응답) 시각" /> *</label>
            <div className="flex gap-2">
              <input type="datetime-local" value={respondedAt} onChange={(e) => setRespondedAt(e.target.value)}
                className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm" />
              <button type="button" onClick={() => setRespondedAt(nowLocal())}
                className="min-h-[44px] rounded-lg border border-blue-300 bg-blue-50 px-3 text-xs font-bold text-blue-700"><T k="지금" /></button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="응답 팀" /></label>
            <input value={team} maxLength={100} onChange={(e) => setTeam(e.target.value)} placeholder={tA('예: RRT 1팀')}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="결과(정해진 경우만)" /></label>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm">
              <option value="">{tA('— 미정(진행 중) —')}</option>
              <option value="WARD_STAY">병동 유지</option>
              <option value="ICU_TRANSFER">ICU 전동</option>
              <option value="CODE_BLUE">코드블루 격상</option>
              <option value="DECEASED">사망</option>
            </select>
            <p className="mt-1 text-[11px] text-gray-400"><T k="코드블루 격상을 선택해도 코드블루 발생 기록이 자동 생성되지 않습니다 — 코드블루 탭에서 별도로 기록하세요." /></p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-lg border border-gray-300 px-4 text-sm text-gray-700"><T k="취소" /></button>
          <button type="button" onClick={submit} disabled={saving || !respondedAt}
            className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-50">
            <T k={saving ? '기록 중…' : '응답 기록'} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 통계 ─────────────────────────────────────────────────── */

function StatsTab() {
  const tA = useTAttr();
  const [month, setMonth] = useState(''); // 빈 값 = 전체 기간
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['code-blue-stats', month],
    queryFn: () => apiClient.get<{ data: CodeBlueStats }>(`/api/v1/code-blue/stats${month ? `?month=${month}` : ''}`),
  });
  const s = data?.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-600"><T k="기간" /></label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          className="rounded-xl border border-gray-200 px-3 py-2 text-sm" />
        <span className="text-xs text-gray-400">{month ? `${month} 월 (UTC 월 경계 기준)` : tA('전체 기간')}</span>
      </div>

      {isError ? (
        <QueryErrorFallback error={error} onRetry={() => refetch()} />
      ) : isLoading || !s ? (
        <div className="py-8 text-center text-sm text-gray-400"><T k="불러오는 중…" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatBox label={tA('전체 발생')} value={String(s.total)} />
            <StatBox label="ROSC" value={String(s.rosc)} />
            <StatBox label={tA('사망')} value={String(s.death)} />
            <StatBox label={tA('전원')} value={String(s.transfer)} />
            <StatBox label={tA('진행 중')} value={String(s.ongoing)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs font-semibold text-gray-500"><T k="ROSC 비율" /></p>
              {s.roscRate == null ? (
                <p className="mt-1 text-sm text-gray-400">{RATIO_UNAVAILABLE} — 표본 0건</p>
              ) : (
                <>
                  <p className="mt-1 text-2xl font-bold text-gray-900">{s.roscRate}<span className="text-sm font-normal text-gray-500">%</span></p>
                  <p className="mt-1 text-[11px] text-gray-400">분모 {s.total}건(진행 중 {s.ongoing}건 포함 — 종결 전 건이 많으면 과소 산출됩니다)</p>
                </>
              )}
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs font-semibold text-gray-500"><T k="평균 팀도착 시간" /></p>
              {s.avgArrivalMinutes == null ? (
                <p className="mt-1 text-sm text-gray-400">{RATIO_UNAVAILABLE} — 팀도착 기록이 있는 건 0건</p>
              ) : (
                <>
                  <p className="mt-1 text-2xl font-bold text-gray-900">{s.avgArrivalMinutes}<span className="text-sm font-normal text-gray-500">분</span></p>
                  <p className="mt-1 text-[11px] text-gray-400">분모 {s.arrivalsN}건(팀도착 기록이 있는 건만)</p>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-semibold text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}
