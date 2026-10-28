'use client';
import { ReasonInput, reasonFilled } from '@/components/ui/ReasonInput';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useHasRole } from '@/hooks/use-admin-write';
import { toast } from '@/stores/toast-store';
import PatientSelector from '@/components/ui/PatientSelector';
import { kdate } from '@/lib/ui-settings';
import { EmptyState, Unit } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { kstToday } from '@/lib/kst-today';
import { T, useTAttr } from '@/components/ui/i18n-text';
import GateOverrideHistory from './GateOverrideHistory';

interface RegimenDrug {
  id?: string; role: string; drugName: string; dosePerM2?: number | null; fixedDose?: number | null;
  capMg?: number | null; bandMg?: number | null; dayOffsets: number[]; infusionNote?: string | null;
}
interface Regimen {
  id: string; code: string; name: string; cycleLengthDays: number; defaultCycles: number;
  emetogenicity?: string | null; status: string; drugs: RegimenDrug[]; _count?: { courses: number };
}
interface Cycle {
  id: string; cycleNumber: number; plannedDate: string; startedAt?: string | null; completedAt?: string | null;
  status: string; delayDays: number; delayReason?: string | null; doseReductionPct?: number | null;
  gateResult?: { pass: boolean; mode: string; checks: GateCheckRow[]; startedDespiteFail?: { by?: string; at?: string; override?: boolean; reason?: string | null } } | null; compoundingOrderId?: string | null;
}

/**
 * 사이클에 남은 게이트 기록(2026-10-10) — 시작·보류 때 서버가 저장한 결과. 🔴 기록이 없으면 '점검 기록 없음'(통과로 그리지 않는다) ·
 * 미통과로 시작했으면 그 사실과 사유를 그대로.
 */
function CycleGateRecord({ gate }: { gate: Cycle['gateResult'] }) {
  if (!gate) return <span className="text-[10px] text-gray-400" data-cycle-gate="none"><T k="점검 기록 없음" /></span>;
  const failed = gate.checks.filter((c) => !c.pass).map((c) => c.name);
  return (
    <span className="inline-flex flex-col text-[10px]" data-cycle-gate={gate.pass ? 'pass' : gate.startedDespiteFail ? 'override' : 'fail'}>
      <span className={gate.pass ? 'text-emerald-700' : 'text-rose-700'}>{gate.pass ? <T k="게이트 통과" /> : <T k="게이트 미통과" />} · {gate.mode}{failed.length ? ` · ${failed.join(', ')}` : ''}</span>
      {gate.startedDespiteFail && (
        <span className="text-amber-700"><T k="미통과로 시작" />{gate.startedDespiteFail.reason ? ` — ${gate.startedDespiteFail.reason}` : ''}</span>
      )}
    </span>
  );
}
interface GateCheckRow { name: string; value: string | null; unit: string | null; normalized: number | null; min: number; pass: boolean; reason?: string }
interface Course {
  id: string; status: string; plannedCycles: number; bsa: string; heightCm: string; weightKg: string;
  doseReductionPct: number; startDate: string; stopReason?: string | null;
  patient?: { mrn: string; familyName: string; givenName: string };
  regimen: { code: string; name: string; cycleLengthDays: number; drugs?: RegimenDrug[] };
  cycles: Cycle[];
}

const CYCLE_BADGE: Record<string, string> = {
  PLANNED: 'bg-gray-100 text-gray-600',
  GATE_HOLD: 'bg-rose-100 text-rose-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  SKIPPED: 'bg-gray-100 text-gray-400 line-through',
};
const CYCLE_LABEL: Record<string, string> = {
  PLANNED: '예정', GATE_HOLD: '게이트 보류', IN_PROGRESS: '투여중', COMPLETED: '완료', SKIPPED: '생략',
};
const unwrap = <T,>(r: unknown): T => {
  const raw = (r as { data?: unknown })?.data as { data?: T } | T | undefined;
  return ((raw as { data?: T })?.data ?? raw) as T;
};
const errMsg = (e: unknown) => (e as { message?: string })?.message || '요청 실패';

export default function ChemoPage() {
  const [tab, setTab] = useState<'courses' | 'regimens' | 'overrides'>('courses');
  return (
    <div className="max-w-6xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="항암 치료 (사이클 엔진)" /></h1>
        <p className="text-sm text-gray-500 mt-1"><T k="레지멘 기반 코스·BSA 용량계산·nadir 게이트·무균조제(CHEMO) 자동 연계" /></p>
      </div>
      <div className="flex gap-1 border-b border-gray-200">
        {([['courses', '치료 코스'], ['regimens', '레지멘 정본'], ['overrides', '점검 우회 이력']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <T k={label} />
          </button>
        ))}
      </div>
      {tab === 'courses' ? <CoursesTab /> : tab === 'regimens' ? <RegimensTab /> : <GateOverrideHistory />}
    </div>
  );
}

// ═══════════ 코스 탭 ═══════════

function CoursesTab() {
  const tAttr = useTAttr();
  /** 🔴 코스 개시·중단은 처방 판단이라 서버가 `@Roles(DOCTOR, ADMIN)` 이다(간호·약사 403) */
  const canOrder = useHasRole('DOCTOR');
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  // 🔴 (2026-10-10) 조회 실패를 "코스가 없습니다"로 말하지 않는다(4개 조회 모두 isError 미처리였다)
  const { data: courses, isLoading: coursesLoading, isError: coursesIsError, error: coursesError, refetch: refetchCourses } = useQuery({
    queryKey: ['chemo-courses'],
    queryFn: () => apiClient.get('/api/v1/chemo/courses').then((r) => unwrap<Course[]>(r)),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
      <div className="lg:col-span-2 space-y-3">
        {canOrder && <button onClick={() => setShowCreate((v) => !v)}
          className="w-full px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          <T k={showCreate ? '닫기' : '+ 새 코스 시작'} />
        </button>}
        {showCreate && <CreateCourseForm onDone={(id) => { setShowCreate(false); setSelectedId(id); qc.invalidateQueries({ queryKey: ['chemo-courses'] }); }} />}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
          {coursesIsError ? (
            <div className="p-3"><QueryErrorFallback error={coursesError} onRetry={refetchCourses} size="compact" /></div>
          ) : coursesLoading ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400"><T k="불러오는 중…" /></p>
          ) : !courses?.length ? (
            <EmptyState icon="💉" title="코스가 없습니다" />
          ) : courses.map((c) => {
            const done = c.cycles.filter((y) => y.status === 'COMPLETED').length;
            return (
              <button key={c.id} onClick={() => setSelectedId(c.id)}
                className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${selectedId === c.id ? 'bg-blue-50/50' : ''}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">
                    {c.patient ? `${c.patient.familyName}${c.patient.givenName}` : '—'}
                    <span className="ml-1.5 text-xs text-gray-400">{c.patient?.mrn}</span>
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${c.status === 'ACTIVE' ? 'bg-blue-100 text-blue-700' : c.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    <T k={c.status === 'ACTIVE' ? '진행중' : c.status === 'COMPLETED' ? '완료' : '중단'} />
                  </span>
                </div>
                <div className="mt-1 text-xs text-gray-500">{c.regimen.code} · {done}/{c.plannedCycles} 사이클{c.doseReductionPct > 0 ? ` · 감량 ${c.doseReductionPct}%` : ''}</div>
              </button>
            );
          })}
        </div>
      </div>
      <div className="lg:col-span-3">
        {selectedId ? <CourseDetail courseId={selectedId} /> : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-24 text-center text-sm text-gray-400"><T k="코스를 선택하세요" /></div>
        )}
      </div>
    </div>
  );
}

function CreateCourseForm({ onDone }: { onDone: (id: string) => void }) {
  const tAttr = useTAttr();
  const [patientId, setPatientId] = useState('');
  const [form, setForm] = useState({ regimenId: '', startDate: kstToday(), plannedCycles: '', heightCm: '', weightKg: '', doseReductionPct: '0' });
  const { data: regimens, isError: regimensIsError, error: regimensError, refetch: refetchRegimens } = useQuery({
    queryKey: ['chemo-regimens', 'ACTIVE'],
    queryFn: () => apiClient.get('/api/v1/chemo/regimens?status=ACTIVE').then((r) => unwrap<Regimen[]>(r)),
  });
  const create = useMutation({
    mutationFn: () => apiClient.post('/api/v1/chemo/courses', {
      patientId,
      regimenId: form.regimenId,
      startDate: form.startDate,
      ...(form.plannedCycles ? { plannedCycles: Number(form.plannedCycles) } : {}),
      ...(form.heightCm ? { heightCm: Number(form.heightCm) } : {}),
      ...(form.weightKg ? { weightKg: Number(form.weightKg) } : {}),
      ...(form.doseReductionPct !== '0' ? { doseReductionPct: Number(form.doseReductionPct) } : {}),
    }),
    onSuccess: (r) => { toast.success(tAttr('코스가 생성되었습니다')); onDone(unwrap<Course>(r).id); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const inputCls = 'w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg';
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
      <PatientSelector value={patientId} onChange={(id: string) => setPatientId(id)} context="order" placeholder={tAttr('환자 검색(이름/MRN)')} />
      {/* 레지멘 조회 실패를 빈 선택지로 숨기지 않는다 */}
      {regimensIsError && <QueryErrorFallback error={regimensError} onRetry={refetchRegimens} size="compact" />}
      <select value={form.regimenId} onChange={(e) => setForm({ ...form, regimenId: e.target.value })} className={inputCls}>
        <option value="">{tAttr('레지멘 선택')}</option>
        {regimens?.map((rg) => <option key={rg.id} value={rg.id}>{rg.code} — {rg.name} (주기 {rg.cycleLengthDays}<Unit><T k="일" /></Unit>·{rg.defaultCycles}사이클)</option>)}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-500"><T k="시작일" /><input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className={inputCls} /></label>
        <label className="text-xs text-gray-500"><T k="사이클 수(기본값 사용 시 비움)" /><input type="number" value={form.plannedCycles} onChange={(e) => setForm({ ...form, plannedCycles: e.target.value })} className={inputCls} placeholder={tAttr('레지멘 기본')} /></label>
        <label className="text-xs text-gray-500"><T k="키 cm(비우면 최근 바이탈)" /><input type="number" value={form.heightCm} onChange={(e) => setForm({ ...form, heightCm: e.target.value })} className={inputCls} placeholder={tAttr('자동')} /></label>
        <label className="text-xs text-gray-500"><T k="몸무게 kg" /><input type="number" value={form.weightKg} onChange={(e) => setForm({ ...form, weightKg: e.target.value })} className={inputCls} placeholder={tAttr('자동')} /></label>
      </div>
      <label className="block text-xs text-gray-500"><T k="기본 감량률 %" /><input type="number" min={0} max={100} value={form.doseReductionPct} onChange={(e) => setForm({ ...form, doseReductionPct: e.target.value })} className={inputCls} /></label>
      <button disabled={!patientId || !form.regimenId || create.isPending} onClick={() => create.mutate()}
        className="w-full min-h-[44px] px-3 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40">
        <T k="코스 생성 (BSA 자동 계산)" />
      </button>
    </div>
  );
}

function CourseDetail({ courseId }: { courseId: string }) {
  /**
   * 🔴 서버의 구분을 그대로 따른다 — 사이클 **시작**은 게이트 통과 후 **CHEMO 무균조제를
   *    자동 지시**하므로 처방 행위다(`@Roles(DOCTOR, ADMIN)`). 지연·감량·코스 중단도 같다.
   *    **완료**만 간호사에게 열려 있다(투여를 마친 사람이 누른다).
   */
  const tAttr = useTAttr();
  const canOrder = useHasRole('DOCTOR');
  const canComplete = useHasRole('DOCTOR', 'NURSE');
  const qc = useQueryClient();
  const [gateView, setGateView] = useState<{ cycleId: string; mode: string; pass: boolean; checks: GateCheckRow[] } | null>(null);
  const [delayFor, setDelayFor] = useState<string | null>(null);
  const [delayForm, setDelayForm] = useState({ days: '7', reason: '' });
  const { data: course, isError: courseIsError, error: courseError, refetch: refetchCourse } = useQuery({
    queryKey: ['chemo-course', courseId],
    queryFn: () => apiClient.get(`/api/v1/chemo/courses/${courseId}`).then((r) => unwrap<Course>(r)),
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['chemo-course', courseId] }); qc.invalidateQueries({ queryKey: ['chemo-courses'] }); };

  const checkGate = useMutation({
    mutationFn: (cycleId: string) => apiClient.get(`/api/v1/chemo/cycles/${cycleId}/gate`).then((r) => ({ cycleId, ...unwrap<{ mode: string; pass: boolean; checks: GateCheckRow[] }>(r) })),
    onSuccess: (d) => setGateView(d),
    onError: (e) => toast.error(errMsg(e)),
  });
  const start = useMutation({
    mutationFn: (cycleId: string) => apiClient.post(`/api/v1/chemo/cycles/${cycleId}/start`, {}),
    onSuccess: (r) => {
      const d = unwrap<{ compoundingOrder?: { id: string } | null; warning?: string }>(r);
      toast.success(`${tAttr('사이클 시작')}${d.compoundingOrder ? ` — ${tAttr('무균조제 지시 생성됨')}` : ''}`);
      if (d.warning) toast.error(d.warning);
      refresh();
    },
    onError: (e) => { toast.error(errMsg(e)); refresh(); },
  });
  const complete = useMutation({
    mutationFn: (cycleId: string) => apiClient.post(`/api/v1/chemo/cycles/${cycleId}/complete`, {}),
    onSuccess: (r) => { toast.success(unwrap<{ courseCompleted: boolean }>(r).courseCompleted ? tAttr('코스 전체 완료 — 암등록 요약 기록') : tAttr('사이클 완료')); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const delay = useMutation({
    mutationFn: (cycleId: string) => apiClient.post(`/api/v1/chemo/cycles/${cycleId}/delay`, { days: Number(delayForm.days), reason: delayForm.reason }),
    onSuccess: () => { toast.success(tAttr('사이클이 지연 이동되었습니다')); setDelayFor(null); setDelayForm({ days: '7', reason: '' }); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const stop = useMutation({
    mutationFn: (reason: string) => apiClient.patch(`/api/v1/chemo/courses/${courseId}`, { stopReason: reason }),
    onSuccess: () => { toast.success(tAttr('코스가 중단되었습니다')); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });

  // 🔴 조회 실패를 영구 "불러오는 중"으로 굳히지 않는다
  if (courseIsError) return <QueryErrorFallback error={courseError} onRetry={refetchCourse} />;
  if (!course) return <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-24 text-center text-sm text-gray-400"><T k="불러오는 중…" /></div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-base font-semibold text-gray-900">
              {course.patient ? `${course.patient.familyName}${course.patient.givenName}` : ''} — {course.regimen.name} <span className="text-gray-400 text-sm">({course.regimen.code})</span>
            </div>
            <div className="mt-1 text-xs text-gray-500">
              BSA {course.bsa}㎡ ({course.heightCm}cm·{course.weightKg}kg) · 주기 {course.regimen.cycleLengthDays}일 · 기본 감량 {course.doseReductionPct}%
              {course.stopReason && <span className="text-rose-600"> · 중단: {course.stopReason}</span>}
            </div>
          </div>
          {canOrder && course.status === 'ACTIVE' && (
            <button onClick={() => { const r = window.prompt(tAttr('중단 사유')); if (r) stop.mutate(r); }}
              className="min-h-[44px] px-3 py-2 text-xs font-medium text-rose-600 border border-rose-200 rounded-lg hover:bg-rose-50"><T k="코스 중단" /></button>
          )}
        </div>
        {course.regimen.drugs && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {course.regimen.drugs.map((d, i) => (
              <span key={i} className="px-2 py-0.5 rounded-full text-[10px] bg-gray-100 text-gray-600">
                {d.drugName} {d.dosePerM2 ? `${d.dosePerM2}mg/㎡` : `${d.fixedDose}mg`} D{(d.dayOffsets as number[]).join('·D')}{d.role !== 'CHEMO' ? ` (${d.role})` : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      {gateView && (
        <div className={`rounded-2xl border p-4 ${gateView.pass ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">{gateView.pass ? '✅ ' : '⛔ '}<T k={gateView.pass ? 'nadir 게이트 통과' : 'nadir 게이트 미통과'} /> <span className="font-normal text-xs text-gray-500">(모드 {gateView.mode})</span></span>
            <button onClick={() => setGateView(null)} className="text-xs text-gray-400"><T k="닫기" /></button>
          </div>
          <div className="mt-2 space-y-1">
            {gateView.checks.map((c, i) => (
              <div key={i} className="text-xs text-gray-700">
                {c.pass ? '✓' : '✗'} {c.name}: {c.value != null ? `${c.value} ${c.unit ?? ''}${c.normalized != null && String(c.normalized) !== c.value ? ` (=${c.normalized.toLocaleString()}/µL)` : ''}` : '—'}
                {' '}<span className="text-gray-400">기준 {c.min.toLocaleString()}/µL</span>
                {c.reason && <span className="text-rose-600"> — {c.reason}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50 text-xs text-gray-500 text-left">
              <th className="px-3 py-2.5"><T k="사이클" /></th><th className="px-3 py-2.5"><T k="예정일" /></th><th className="px-3 py-2.5"><T k="상태" /></th>
              <th className="px-3 py-2.5"><T k="지연" /></th><th className="px-3 py-2.5"><T k="게이트 기록" /></th><th className="px-3 py-2.5 text-right"><T k="액션" /></th>
            </tr>
          </thead>
          <tbody>
            {course.cycles.map((cy) => (
              <tr key={cy.id} className="border-b border-gray-50">
                {/* 감량 — 사이클 값이 있으면 그것, 없으면 코스 기본값(출처를 밝힌다) */}
                <td className="px-3 py-2.5 text-xs font-medium text-gray-800">C{cy.cycleNumber}{cy.doseReductionPct != null
                  ? <span className="text-amber-600" data-cycle-reduction="cycle"> (<T k="감량" /> {cy.doseReductionPct}<Unit>%</Unit>)</span>
                  : course.doseReductionPct > 0 ? <span className="text-gray-500" data-cycle-reduction="course"> (<T k="코스 기본 감량" /> {course.doseReductionPct}<Unit>%</Unit>)</span> : ''}</td>
                <td className="px-3 py-2.5 text-xs text-gray-600">{kdate(new Date(cy.plannedDate))}</td>
                <td className="px-3 py-2.5"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${CYCLE_BADGE[cy.status]}`}><T k={CYCLE_LABEL[cy.status]} /></span></td>
                <td className="px-3 py-2.5 text-xs text-gray-500">{cy.delayDays > 0 ? `+${cy.delayDays}일 (${cy.delayReason ?? ''})` : '—'}</td>
                <td className="px-3 py-2.5"><CycleGateRecord gate={cy.gateResult} /></td>
                <td className="px-3 py-2.5">
                  {course.status === 'ACTIVE' && ['PLANNED', 'GATE_HOLD'].includes(cy.status) && (
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => checkGate.mutate(cy.id)} className="px-2 py-1 text-[11px] border border-gray-200 rounded-lg hover:bg-gray-50"><T k="게이트 점검" /></button>
                      {canOrder && <button onClick={() => setDelayFor(delayFor === cy.id ? null : cy.id)} className="px-2 py-1 text-[11px] border border-amber-200 text-amber-700 rounded-lg hover:bg-amber-50"><T k="지연" /></button>}
                      {canOrder && <button onClick={() => start.mutate(cy.id)} disabled={start.isPending} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"><T k="시작" /></button>}
                    </div>
                  )}
                  {cy.status === 'IN_PROGRESS' && (
                    <div className="flex justify-end">
                      {canComplete && <button onClick={() => complete.mutate(cy.id)} disabled={complete.isPending} className="min-h-[48px] px-3 py-3 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40"><T k="완료" /></button>}
                    </div>
                  )}
                  {delayFor === cy.id && (
                    <div className="mt-2 flex items-center justify-end gap-1.5">
                      <input type="number" min={1} max={60} value={delayForm.days} onChange={(e) => setDelayForm({ ...delayForm, days: e.target.value })}
                        className="w-14 px-2 py-1 text-xs border border-gray-200 rounded-lg" /><T k="일" />
                      <div className="w-36"><ReasonInput domain="chemoDelay" required value={delayForm.reason} onChange={(v) => setDelayForm({ ...delayForm, reason: v })} placeholder={tAttr('사유(필수)')}
                        className="w-full px-2 py-1 text-xs border border-gray-200 rounded-lg" /></div>
                      <button onClick={() => delay.mutate(cy.id)} disabled={!reasonFilled(delayForm.reason) || delay.isPending}
                        className="min-h-[44px] px-3 py-2 text-xs font-medium bg-amber-600 text-white rounded-lg disabled:opacity-40"><T k="이동" /></button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════ 레지멘 탭 ═══════════

const EMPTY_DRUG = { role: 'CHEMO', drugName: '', dosePerM2: '', fixedDose: '', capMg: '', dayOffsets: '1', infusionNote: '' };

function RegimensTab() {
  const tAttr = useTAttr();
  /** 🔴 레지멘 마스터는 서버가 `@Roles(DOCTOR, PHARMACIST, ADMIN)` — 간호사는 403 이었다 */
  const canEditRegimen = useHasRole('DOCTOR', 'PHARMACIST');
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', cycleLengthDays: '21', defaultCycles: '6', emetogenicity: '', notes: '' });
  const [drugs, setDrugs] = useState<(typeof EMPTY_DRUG)[]>([{ ...EMPTY_DRUG }]);
  const { data: regimens, isLoading: regimensLoading, isError: regimensIsError, error: regimensError, refetch: refetchRegimens } = useQuery({
    queryKey: ['chemo-regimens', 'all'],
    queryFn: () => apiClient.get('/api/v1/chemo/regimens').then((r) => unwrap<Regimen[]>(r)),
  });
  const create = useMutation({
    mutationFn: () => apiClient.post('/api/v1/chemo/regimens', {
      code: form.code, name: form.name,
      cycleLengthDays: Number(form.cycleLengthDays), defaultCycles: Number(form.defaultCycles),
      ...(form.emetogenicity ? { emetogenicity: form.emetogenicity } : {}),
      ...(form.notes ? { notes: form.notes } : {}),
      drugs: drugs.map((d, i) => ({
        role: d.role, drugName: d.drugName,
        ...(d.dosePerM2 ? { dosePerM2: Number(d.dosePerM2) } : {}),
        ...(d.fixedDose ? { fixedDose: Number(d.fixedDose) } : {}),
        ...(d.capMg ? { capMg: Number(d.capMg) } : {}),
        dayOffsets: d.dayOffsets.split(',').map((s) => Number(s.trim())).filter((n) => n > 0),
        ...(d.infusionNote ? { infusionNote: d.infusionNote } : {}),
        sortOrder: i,
      })),
    }),
    onSuccess: () => {
      toast.success(tAttr('레지멘이 생성되었습니다'));
      setShowCreate(false); setForm({ code: '', name: '', cycleLengthDays: '21', defaultCycles: '6', emetogenicity: '', notes: '' }); setDrugs([{ ...EMPTY_DRUG }]);
      qc.invalidateQueries({ queryKey: ['chemo-regimens'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const retire = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/chemo/regimens/${id}`, { status: 'RETIRED' }),
    onSuccess: () => { toast.success(tAttr('레지멘이 은퇴 처리되었습니다')); qc.invalidateQueries({ queryKey: ['chemo-regimens'] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const inputCls = 'px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg';

  return (
    <div className="space-y-4">
      {canEditRegimen && <button onClick={() => setShowCreate((v) => !v)} className="px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700">
        <T k={showCreate ? '닫기' : '+ 레지멘 등록'} />
      </button>}
      {showCreate && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <input placeholder={tAttr('코드 (FOLFOX6)')} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className={inputCls} />
            <input placeholder={tAttr('이름 (mFOLFOX6)')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
            <label className="text-xs text-gray-500"><T k="주기(일)" /><input type="number" value={form.cycleLengthDays} onChange={(e) => setForm({ ...form, cycleLengthDays: e.target.value })} className={`${inputCls} w-full`} /></label>
            <label className="text-xs text-gray-500"><T k="기본 사이클" /><input type="number" value={form.defaultCycles} onChange={(e) => setForm({ ...form, defaultCycles: e.target.value })} className={`${inputCls} w-full`} /></label>
          </div>
          <div className="space-y-2">
            {drugs.map((d, i) => (
              <div key={i} className="grid grid-cols-2 md:grid-cols-7 gap-2 items-center">
                <select value={d.role} onChange={(e) => setDrugs(drugs.map((x, j) => j === i ? { ...x, role: e.target.value } : x))} className={inputCls}>
                  {['CHEMO', 'PREMED', 'HYDRATION', 'GCSF', 'SUPPORT'].map((r) => <option key={r}>{r}</option>)}
                </select>
                <input placeholder={tAttr('약물명')} value={d.drugName} onChange={(e) => setDrugs(drugs.map((x, j) => j === i ? { ...x, drugName: e.target.value } : x))} className={`${inputCls} md:col-span-2`} />
                <input placeholder="mg/㎡" type="number" value={d.dosePerM2} onChange={(e) => setDrugs(drugs.map((x, j) => j === i ? { ...x, dosePerM2: e.target.value, fixedDose: '' } : x))} className={inputCls} />
                <input placeholder={tAttr('고정mg')} type="number" value={d.fixedDose} onChange={(e) => setDrugs(drugs.map((x, j) => j === i ? { ...x, fixedDose: e.target.value, dosePerM2: '' } : x))} className={inputCls} />
                <input placeholder="D-day (1,8)" value={d.dayOffsets} onChange={(e) => setDrugs(drugs.map((x, j) => j === i ? { ...x, dayOffsets: e.target.value } : x))} className={inputCls} />
                <button onClick={() => setDrugs(drugs.filter((_, j) => j !== i))} disabled={drugs.length === 1} className="text-xs text-rose-500 disabled:opacity-30"><T k="삭제" /></button>
              </div>
            ))}
            <button onClick={() => setDrugs([...drugs, { ...EMPTY_DRUG }])} className="text-xs text-blue-600"><T k="+ 약물 추가" /></button>
          </div>
          <button disabled={!form.code || !form.name || drugs.some((d) => !d.drugName || (!d.dosePerM2 && !d.fixedDose)) || create.isPending}
            onClick={() => create.mutate()}
            className="min-h-[44px] px-3 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40">
            <T k="레지멘 저장" />
          </button>
        </div>
      )}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
        {regimensIsError ? (
          <div className="p-3"><QueryErrorFallback error={regimensError} onRetry={refetchRegimens} size="compact" /></div>
        ) : regimensLoading ? (
          <p className="px-4 py-6 text-center text-sm text-gray-400"><T k="불러오는 중…" /></p>
        ) : !regimens?.length ? (
          <EmptyState icon="💊" title="등록된 레지멘이 없습니다" />
        ) : regimens.map((rg) => (
          <div key={rg.id} className="px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-900">{rg.code} — {rg.name}
                <span className="ml-2 text-xs text-gray-400">주기 {rg.cycleLengthDays}<Unit><T k="일" /></Unit> · 기본 {rg.defaultCycles}사이클 · 사용 {rg._count?.courses ?? 0}<Unit><T k="건" /></Unit></span>
              </span>
              <div className="flex items-center gap-2">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${rg.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{rg.status}</span>
                {canEditRegimen && rg.status === 'ACTIVE' && <button onClick={() => retire.mutate(rg.id)} className="min-h-[44px] px-3 py-2 text-xs font-medium text-gray-400 hover:text-rose-500"><T k="은퇴" /></button>}
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {rg.drugs.map((d, i) => (
                <span key={i} className="px-2 py-0.5 rounded-full text-[10px] bg-gray-100 text-gray-600">
                  {d.drugName} {d.dosePerM2 ? `${d.dosePerM2}mg/㎡` : `${d.fixedDose}mg`} D{(d.dayOffsets as number[]).join('·D')}{d.role !== 'CHEMO' ? ` (${d.role})` : ''}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
