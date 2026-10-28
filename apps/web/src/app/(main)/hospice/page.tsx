'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import { kdate } from '@/lib/ui-settings';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { AdvanceDirectiveCard } from './AdvanceDirectiveCard';
import { AdvanceDirectiveForm } from './AdvanceDirectiveForm';
import { HospiceEndForm } from './HospiceEndForm';

/* ═══════════════════════════════════════════════════════════════ */

const TABS = [
  { key: 'list', label: '환자 목록', icon: '📋' },
  { key: 'register', label: '신규 등록', icon: '➕' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const PPS_LABELS: Record<number, string> = { 100: '정상', 90: '약간 제한', 80: '일부 제한', 70: '상당한 제한', 60: '부분 도움 필요', 50: '상당한 도움', 40: '대부분 침상', 30: '완전 침상', 20: '완전 돌봄', 10: '의식저하', 0: '사망' };
const STATUS_COLOR: Record<string, string> = { ACTIVE: 'bg-emerald-100 text-emerald-700', DISCHARGED: 'bg-gray-200 text-gray-600', DECEASED: 'bg-gray-400 text-white' };
// 라벨 맵 값은 i18n 키 — DISCHARGED 는 무문맥 `퇴원`(=메뉴 Discharge)이 이기므로 상태 문맥 키로
const STATUS_LABEL: Record<string, string> = { ACTIVE: '활성', DISCHARGED: '퇴원@상태', DECEASED: '사망' };
const ESAS_LABELS = ['통증', '피로', '오심', '우울', '불안', '졸림', '식욕', '안녕감', '호흡곤란'];

function fmtDate(d?: string) { return d ? kdate(d) : '-'; }

interface Registration { id: string; ppsScore: number; primaryDiagnosis: string; prognosis?: string; hospiceType: string; status: string; dnrStatus?: boolean; goals?: string; registeredAt: string; patient?: { id?: string; familyName?: string; givenName?: string; mrn?: string; dateOfBirth?: string }; _count?: { assessments: number; conferences: number } }
interface Assessment { id: string; pain: number; tiredness: number; nausea: number; depression: number; anxiety: number; drowsiness: number; appetite: number; wellbeing: number; shortnessOfBreath: number; totalScore: number; whoStep?: number; assessedAt: string; assessor?: { familyName?: string; givenName?: string } }

/* ═══════════════════════════════════════════════════════════════ */

export default function HospicePage() {
  const [tab, setTab] = useState<TabKey>('list');

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="호스피스 / 완화의료" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="호스피스 등록 · ESAS 증상 평가 · 사전의료의향서 · 돌봄 회의" /></p>
      </div>

      <div className="flex gap-2 mb-6">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 ${tab === t.key ? 'bg-purple-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
            <span>{t.icon}</span> <T k={t.label} />
          </button>
        ))}
      </div>

      {tab === 'list' && <RegistrationList />}
      {tab === 'register' && <RegisterForm onSuccess={() => setTab('list')} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ */

function RegistrationList() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [showEsas, setShowEsas] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['hospice-registrations', statusFilter],
    queryFn: () => apiClient.get<{ data: Registration[] }>(`/api/v1/hospice/registrations${statusFilter ? `?status=${statusFilter}` : ''}`),
  });

  const { data: detailData, isError: detailIsError, error: detailError, refetch: detailRefetch } = useQuery({
    queryKey: ['hospice-detail', selectedId],
    queryFn: () => apiClient.get<{ data: Registration & { assessments: Assessment[]; conferences: unknown[] } }>(`/api/v1/hospice/registrations/${selectedId}`),
    enabled: !!selectedId,
  });

  const { data: statsData, isError: statsIsError } = useQuery({
    queryKey: ['hospice-stats'],
    queryFn: () => apiClient.get<{ data: { active: number; total: number; deceased: number; discharged: number } }>('/api/v1/hospice/stats'),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status, occurredAt }: { id: string; status: string; occurredAt?: string }) => apiClient.patch(`/api/v1/hospice/registrations/${id}/status`, { status, ...(occurredAt ? { occurredAt } : {}) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hospice-registrations'] }); qc.invalidateQueries({ queryKey: ['hospice-detail'] }); qc.invalidateQueries({ queryKey: ['hospice-stats'] }); toast.success(tAttr('상태 변경 완료')); },
  });

  const esasMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post('/api/v1/hospice/assessments', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hospice-detail'] }); setShowEsas(false); toast.success(tAttr('ESAS 평가 저장')); },
    onError: () => toast.error(tAttr('저장 실패')),
  });

  const registrations = (Array.isArray(data?.data) ? data.data : []) as Registration[];
  const detail = detailData?.data as (Registration & { assessments: Assessment[] }) | undefined;
  const stats = statsData?.data as { active: number; total: number; deceased: number; discharged: number } | undefined;

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="space-y-6">
      {/* 통계 */}
      {statsIsError && <p className="text-xs text-red-700" data-hospice-stats-failed><T k="통계를 불러오지 못했습니다 — 0건이 아닙니다" /></p>}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl border p-5"><p className="text-xs text-gray-500"><T k="활성 환자" /></p><p className="text-2xl font-bold text-purple-700">{stats.active}</p></div>
          <div className="bg-white rounded-2xl border p-5"><p className="text-xs text-gray-500"><T k="총 등록" /></p><p className="text-2xl font-bold text-gray-900">{stats.total}</p></div>
          <div className="bg-white rounded-2xl border p-5"><p className="text-xs text-gray-500"><T k="퇴원@상태" /></p><p className="text-2xl font-bold text-emerald-700">{stats.discharged}</p></div>
          <div className="bg-white rounded-2xl border p-5"><p className="text-xs text-gray-500"><T k="사망" /></p><p className="text-2xl font-bold text-gray-500">{stats.deceased}</p></div>
        </div>
      )}

      {/* 필터 */}
      <div className="flex gap-2">
        {['', 'ACTIVE', 'DISCHARGED', 'DECEASED'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${statusFilter === s ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <T k={s ? STATUS_LABEL[s] : '전체'} />
          </button>
        ))}
      </div>

      <div className="flex gap-6">
        {/* 목록 */}
        <div className="flex-1 bg-white rounded-2xl border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 border-b text-xs text-gray-500">
              <th className="px-4 py-2.5 text-left"><T k="환자" /></th>
              <th className="px-4 py-2.5 text-left"><T k="진단" /></th>
              <th className="px-4 py-2.5 text-center">PPS</th>
              <th className="px-4 py-2.5 text-left"><T k="유형" /></th>
              <th className="px-4 py-2.5 text-left"><T k="상태" /></th>
              <th className="px-4 py-2.5 text-left"><T k="등록일" /></th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="로딩 중..." /></td></tr> :
               registrations.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="등록된 환자가 없습니다" /></td></tr> :
               registrations.map(r => (
                <tr key={r.id} onClick={() => setSelectedId(r.id)}
                  className={`cursor-pointer ${selectedId === r.id ? 'bg-purple-50' : 'hover:bg-gray-50'}`}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{r.patient?.familyName}{r.patient?.givenName}</p>
                    <p className="text-[10px] text-gray-400">{r.patient?.mrn}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 max-w-[150px] truncate">{r.primaryDiagnosis}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-bold ${r.ppsScore <= 30 ? 'text-red-600' : r.ppsScore <= 50 ? 'text-amber-600' : 'text-gray-700'}`}>{r.ppsScore}<Unit>%</Unit></span>
                  </td>
                  <td className="px-4 py-3 text-xs"><T k={r.hospiceType === 'INPATIENT' ? '입원' : r.hospiceType === 'HOME' ? '가정@호스피스' : '자문'} /></td>
                  <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[r.status]}`}><T k={STATUS_LABEL[r.status] ?? ''} /></span></td>
                  <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(r.registeredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 상세 */}
        {/* 🔴 (2026-10-10) 상세 조회 실패가 빈 칸이었다 — 실패를 '선택 안 함'처럼 보이지 않게 */}
        {selectedId && detailIsError && <div className="lg:col-span-1"><QueryErrorFallback error={detailError} onRetry={() => detailRefetch()} size="compact" /></div>}
        {detail && (
          <div className="w-[380px] shrink-0 space-y-4">
            <div className="bg-white rounded-2xl border p-5 space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-lg font-bold text-gray-900">{detail.patient?.familyName}{detail.patient?.givenName}</p>
                  <p className="text-xs text-gray-500">{detail.patient?.mrn} · PPS {detail.ppsScore}<Unit>%</Unit></p>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLOR[detail.status]}`}><T k={STATUS_LABEL[detail.status] ?? ''} /></span>
              </div>
              <div className="text-xs space-y-1">
                <p><span className="text-gray-500"><T k="진단:" /></span> {detail.primaryDiagnosis}</p>
                <p><span className="text-gray-500"><T k="예후:" /></span> {detail.prognosis ?? '-'}</p>
                <p><span className="text-gray-500">DNR:</span> {detail.dnrStatus ? <>✅ <T k="예" /></> : <T k="아니오" />}</p>
              </div>
              {detail.status === 'ACTIVE' && (
                <div className="space-y-2 pt-2 border-t">
                  <button onClick={() => setShowEsas(true)} className="w-full min-h-[44px] text-[11px] font-medium bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200"><T k="ESAS 평가" /></button>
                  {/* 퇴원·사망 — 구분과 일어난 시각을 고른 뒤에만(종전 '퇴원' 버튼 한 번 = 그 순간이 퇴원 시각) */}
                  <HospiceEndForm busy={statusMut.isPending} onSubmit={(v) => statusMut.mutate({ id: detail.id, ...v })} />
                </div>
              )}
            </div>

            {/* 사전연명의료(사전의료의향서·연명의료계획서) — 등록 시 DNR 칸과 다른 원장이다(2026-10-10 · 종전 화면 미표시) */}
            {detail.patient?.id
              ? <div className="space-y-2"><AdvanceDirectiveCard patientId={detail.patient.id} registrationDnr={detail.dnrStatus} /><AdvanceDirectiveForm patientId={detail.patient.id} /></div>
              : <div className="bg-white rounded-2xl border p-4 text-xs text-gray-500"><T k="환자 식별 정보가 없어 사전연명의료 문서를 조회할 수 없습니다" /></div>}

            {/* ESAS 추이 */}
            {detail.assessments?.length > 0 && (
              <div className="bg-white rounded-2xl border p-5">
                <h4 className="text-sm font-bold text-gray-900 mb-3"><T k="ESAS 증상 평가 이력" /></h4>
                <div className="space-y-2">
                  {detail.assessments.slice(0, 5).map(a => (
                    <div key={a.id} className="bg-gray-50 rounded-xl p-3">
                      <div className="flex justify-between mb-1">
                        <span className="text-xs font-bold text-gray-700"><Tf k="총점: {점수}/90" params={{ 점수: a.totalScore }} /></span>
                        <span className="text-[10px] text-gray-400">{fmtDate(a.assessedAt)}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-[10px]">
                        {ESAS_LABELS.map((label, i) => {
                          const vals = [a.pain, a.tiredness, a.nausea, a.depression, a.anxiety, a.drowsiness, a.appetite, a.wellbeing, a.shortnessOfBreath];
                          const v = vals[i];
                          return <span key={label} className={v >= 7 ? 'text-red-600 font-bold' : v >= 4 ? 'text-amber-600' : 'text-gray-500'}><T k={label} />: {v}</span>;
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ESAS 입력 모달 */}
            {showEsas && <EsasForm registrationId={detail.id} onSubmit={(data) => esasMut.mutate(data)} onClose={() => setShowEsas(false)} isPending={esasMut.isPending} />}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ */

function EsasForm({ registrationId, onSubmit, onClose, isPending }: { registrationId: string; onSubmit: (data: Record<string, unknown>) => void; onClose: () => void; isPending: boolean }) {
  const tAttr = useTAttr();
  // 쓰기 폼은 미선택에서 시작한다(2026-10-07) — 종전 ESAS 9항목이 0(증상 없음)·WHO 1단계로 미리 골라져 있어
  //    누르지 않은 항목이 "증상 없음"으로 저장됐다. 9항목 다 고르기 전엔 저장하지 않는다(합계가 정의되지 않는다).
  const [scores, setScores] = useState<(number | null)[]>(Array(9).fill(null));
  const [whoStep, setWhoStep] = useState<number | null>(null);
  const unanswered = scores.filter((v) => v == null).length;
  const [notes, setNotes] = useState('');

  return (
    <div className="bg-white rounded-2xl border p-5 space-y-3">
      <div className="flex justify-between items-center">
        <h4 className="text-sm font-bold text-gray-900"><T k="ESAS 증상 평가" /></h4>
        <button onClick={onClose} className="text-gray-400 text-lg">&times;</button>
      </div>
      <div className="space-y-2">
        {ESAS_LABELS.map((label, i) => (
          <div key={label} className="flex items-center justify-between">
            <span className="text-xs text-gray-700 w-16"><T k={label} /></span>
            <div className="flex gap-0.5">
              {Array.from({ length: 11 }).map((_, v) => (
                <button key={v} aria-pressed={scores[i] === v} onClick={() => setScores(s => s.map((sv, si) => si === i ? v : sv))}
                  className={`w-6 h-6 rounded text-[9px] font-bold ${scores[i] === v ? (v >= 7 ? 'bg-red-500 text-white' : v >= 4 ? 'bg-amber-400 text-white' : 'bg-emerald-500 text-white') : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  {v}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500"><T k="WHO 통증 단계:" /></span>
        {[1, 2, 3].map(s => (
          <button key={s} onClick={() => setWhoStep(w => (w === s ? null : s))} aria-pressed={whoStep === s}
            className={`px-2 py-1 text-xs rounded ${whoStep === s ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600'}`}><Tf k="{단계}단계" params={{ 단계: s }} /></button>
        ))}
      </div>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={tAttr('추가 메모...')} rows={2} className="w-full px-3 py-2 border rounded-lg text-sm resize-none" />
      {unanswered > 0 && <p className="text-xs text-amber-700" data-esas-unanswered={unanswered}><Tf k="미응답 {n}항목 — 9항목을 모두 골라야 저장됩니다" params={{ n: unanswered }} /></p>}
      <button onClick={() => {
        if (unanswered > 0) return;
        const v = scores as number[];
        onSubmit({
          registrationId,
          pain: v[0], tiredness: v[1], nausea: v[2], depression: v[3],
          anxiety: v[4], drowsiness: v[5], appetite: v[6], wellbeing: v[7],
          shortnessOfBreath: v[8], ...(whoStep != null ? { whoStep } : {}), notes: notes || undefined,
        });
      }} disabled={isPending || unanswered > 0} data-esas-save className="w-full py-2.5 bg-purple-600 text-white text-sm font-medium rounded-xl hover:bg-purple-700 disabled:opacity-50">
        <T k={isPending ? '저장 중...' : 'ESAS 평가 저장'} />
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════ */

function RegisterForm({ onSuccess }: { onSuccess: () => void }) {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  // 쓰기 폼은 미선택에서 시작한다(2026-10-07) — 종전 PPS 50%·예후 수주·입원형·DNR 아님이 미리 골라져 있었다.
  //    DNR 은 체크 해제가 "모름"과 "심폐소생술 시행"을 구분하지 못해 반드시 둘 중 하나를 고른다.
  const [form, setForm] = useState<{ patientId: string; ppsScore: number | null; primaryDiagnosis: string; prognosis: string; hospiceType: string; goals: string; dnr: '' | 'DNR' | 'FULL' }>(
    { patientId: '', ppsScore: null, primaryDiagnosis: '', prognosis: '', hospiceType: '', goals: '', dnr: '' });
  const ready = !!form.patientId && !!form.primaryDiagnosis && form.ppsScore != null && !!form.hospiceType && !!form.dnr;

  const mut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/hospice/register', {
      patientId: form.patientId, ppsScore: form.ppsScore, primaryDiagnosis: form.primaryDiagnosis,
      ...(form.prognosis ? { prognosis: form.prognosis } : {}), hospiceType: form.hospiceType,
      ...(form.goals.trim() ? { goals: form.goals.trim() } : {}), dnrStatus: form.dnr === 'DNR',
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hospice-registrations'] }); qc.invalidateQueries({ queryKey: ['hospice-stats'] }); toast.success(tAttr('호스피스 등록 완료')); onSuccess(); },
    onError: () => toast.error(tAttr('등록 실패')),
  });

  return (
    <div className="max-w-2xl bg-white rounded-2xl border p-6 space-y-5">
      <h3 className="text-lg font-bold text-gray-900"><T k="호스피스 신규 등록" /></h3>
      <div className="grid grid-cols-2 gap-4">
        <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="환자 ID" /></label>
          <input value={form.patientId} onChange={e => setForm(f => ({ ...f, patientId: e.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder={tAttr('환자 UUID')} /></div>
        <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="PPS 점수" /></label>
          <select value={form.ppsScore ?? ''} onChange={e => setForm(f => ({ ...f, ppsScore: e.target.value === '' ? null : Number(e.target.value) }))} className="w-full px-3 py-2 border rounded-lg text-sm">
            <option value="">{tAttr('-- 선택 --')}</option>
            {[100,90,80,70,60,50,40,30,20,10].map(v => <option key={v} value={v}>{v}<Unit>%</Unit> — {tAttr(PPS_LABELS[v])}</option>)}
          </select></div>
        <div className="col-span-2"><label className="block text-xs font-medium text-gray-600 mb-1"><T k="주 진단명" /></label>
          <input value={form.primaryDiagnosis} onChange={e => setForm(f => ({ ...f, primaryDiagnosis: e.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder={tAttr('예: 폐암 4기')} /></div>
        <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="예후" /></label>
          <select value={form.prognosis} onChange={e => setForm(f => ({ ...f, prognosis: e.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm">
            <option value="">{tAttr('미기록')}</option><option value="DAYS">{tAttr('수일')}</option><option value="WEEKS">{tAttr('수주')}</option><option value="MONTHS">{tAttr('수개월')}</option>
          </select></div>
        <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="호스피스 유형" /></label>
          <select value={form.hospiceType} onChange={e => setForm(f => ({ ...f, hospiceType: e.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm">
            <option value="">{tAttr('-- 선택 --')}</option><option value="INPATIENT">{tAttr('입원형')}</option><option value="HOME">{tAttr('가정형')}</option><option value="CONSULTATION">{tAttr('자문형')}</option>
          </select></div>
      </div>
      <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="돌봄 목표" /></label>
        <textarea value={form.goals} onChange={e => setForm(f => ({ ...f, goals: e.target.value }))} rows={3} className="w-full px-3 py-2 border rounded-lg text-sm resize-none" placeholder={tAttr('환자/가족의 돌봄 목표...')} /></div>
      <div className="flex items-center gap-2 text-sm text-gray-700" role="radiogroup" aria-label={tAttr('심폐소생술 여부')}>
        <span className="text-xs font-medium text-gray-600"><T k="심폐소생술 여부" /></span>
        {(['DNR', 'FULL'] as const).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={form.dnr === v} data-hospice-dnr={v} onClick={() => setForm(f => ({ ...f, dnr: v }))}
            className={`min-h-[44px] px-3 rounded-lg border text-xs font-semibold ${form.dnr === v ? 'border-purple-600 bg-purple-600 text-white' : 'border-gray-200 text-gray-600'}`}>
            <T k={v === 'DNR' ? 'DNR (심폐소생술 거부)' : '심폐소생술 시행'} />
          </button>
        ))}
      </div>
      <button onClick={() => mut.mutate()} disabled={!ready || mut.isPending} data-hospice-register
        className="w-full py-3 bg-purple-600 text-white text-sm font-semibold rounded-xl hover:bg-purple-700 disabled:opacity-50">
        <T k={mut.isPending ? '등록 중...' : '호스피스 등록'} />
      </button>
    </div>
  );
}
