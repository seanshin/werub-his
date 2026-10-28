'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import { pollMs, kdate } from '@/lib/ui-settings';
import { patientNameLabel } from '@hospital-run/shared';

const LEGAL_LABEL: Record<string, string> = {
  VOLUNTARY: '자의입원(§41)',
  CONSENT: '동의입원(§42)',
  GUARDIAN: '보호입원(§43)',
  ADMINISTRATIVE: '행정입원(§44)',
  EMERGENCY: '응급입원(§50)',
};

interface Alert { code: string; message: string; severity: 'ERROR' | 'WARN' }
/** 계속입원심사 대상 유형 — 서버 `recordContinuationReview` 와 같은 판정(기한이 있는 보호·행정입원만). */
export function continuationReviewable(r: { legalType: string; continuationReviewDue?: string | null }): boolean {
  return !!r.continuationReviewDue && (r.legalType === 'GUARDIAN' || r.legalType === 'ADMINISTRATIVE');
}

type ReviewKind = 'suitability' | 'continuation' | 'discharge';
const REVIEW_OPTIONS: Record<ReviewKind, string[]> = {
  suitability: ['적합', '부적합', '퇴원명령'],
  continuation: ['계속입원', '퇴원'],
  discharge: [],
};

interface PsychAdmission {
  id: string;
  legalType: string;
  continuationReviewDue?: string | null;
  status: string;
  admittedAt: string;
  legalExpiryAt: string | null;
  suitabilityReviewDue: string | null;
  suitabilityReviewedAt: string | null;
  suitabilityResult: string | null;
  guardian1Name: string | null;
  guardian2Name: string | null;
  patient?: { familyName: string | null; givenName: string | null; mrn: string | null };
  alerts?: Alert[];
}

function unwrap<T>(d: unknown): T { const o = d as { data?: unknown }; return (o && typeof o === 'object' && 'data' in o ? o.data : d) as T; }

export default function InvoluntaryAdmissionSection({ patientId }: { patientId?: string }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  // 심사·퇴원 — 브라우저 prompt('적합' 미리 채움)·한 번 클릭 연장을 결과 선택 창으로(2026-10-07)
  const [review, setReview] = useState<{ kind: ReviewKind; row: PsychAdmission } | null>(null);
  const [reviewResult, setReviewResult] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewPsy2, setReviewPsy2] = useState('');
  const openReview = (kind: ReviewKind, row: PsychAdmission) => { setReview({ kind, row }); setReviewResult(''); setReviewNotes(''); setReviewPsy2(''); };
  const [form, setForm] = useState({
    // 입원 유형은 미선택에서 시작한다(2026-10-07 — 종전 보호입원이 미리 골라져 있었다)
    patientId: patientId ?? '', legalType: '', diagnosis: '',
    guardian1Name: '', guardian1Relation: '', guardian2Name: '', guardian2Relation: '',
    psychiatrist1Id: '', notes: '',
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['psych-admissions-active'],
    queryFn: () => apiClient.get<{ data: PsychAdmission[] }>('/api/v1/psychiatry/admissions/active'),
    refetchInterval: pollMs('normal'),
  });
  const rows = (unwrap<PsychAdmission[]>(data?.data) ?? []) as PsychAdmission[];

  const invalidate = () => qc.invalidateQueries({ queryKey: ['psych-admissions-active'] });
  const createMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiClient.post('/api/v1/psychiatry/admissions', payload),
    onSuccess: () => { invalidate(); toast.success('비자의입원을 등록했습니다'); setShowForm(false); },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '등록 실패(법정요건 확인)'),
  });
  const suitabilityMut = useMutation({
    mutationFn: ({ id, result, notes }: { id: string; result: string; notes?: string }) => apiClient.patch(`/api/v1/psychiatry/admissions/${id}/suitability-review`, { result, ...(notes ? { notes } : {}) }),
    onSuccess: () => { invalidate(); setReview(null); toast.success('적합성심사 결과를 기록했습니다'); },
    onError: () => toast.error('심사 기록 실패'),
  });
  const continuationMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => apiClient.patch(`/api/v1/psychiatry/admissions/${id}/continuation-review`, body),
    onSuccess: () => { invalidate(); setReview(null); toast.success('계속입원심사를 기록했습니다'); },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '심사 기록 실패'),
  });
  const dischargeMut = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) => apiClient.patch(`/api/v1/psychiatry/admissions/${id}/discharge`, notes ? { notes } : {}),
    onSuccess: () => { invalidate(); setReview(null); toast.success('퇴원 처리했습니다'); },
    onError: () => toast.error('퇴원 처리 실패'),
  });

  const alertRows = rows.filter(r => (r.alerts?.length ?? 0) > 0);

  return (
    <div className="space-y-4">
      {/* 컴플라이언스 경고 */}
      {alertRows.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <p className="text-sm font-bold text-red-700 mb-2">⚠ 법정기한 경고 {alertRows.length}<Unit>건</Unit></p>
          <ul className="space-y-1">
            {alertRows.flatMap(r => (r.alerts ?? []).map((a, i) => (
              <li key={`${r.id}-${i}`} className="text-xs text-red-600">
                <span className="font-medium">{r.patient?.familyName}{r.patient?.givenName}</span> — {a.message}
              </li>
            )))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900">활성 비자의입원 {rows.length}<Unit>건</Unit></h3>
        <button onClick={() => setShowForm(v => !v)} className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">+ 비자의입원 등록</button>
      </div>

      {/* 등록 폼 */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input value={form.patientId} onChange={e => setForm({ ...form, patientId: e.target.value })} placeholder="환자 ID(UUID)" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
            <select value={form.legalType} onChange={e => setForm({ ...form, legalType: e.target.value })} className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs">
              <option value="">입원 유형 선택</option>
              {Object.entries(LEGAL_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input value={form.diagnosis} onChange={e => setForm({ ...form, diagnosis: e.target.value })} placeholder="진단명" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs col-span-2" />
            <input value={form.guardian1Name} onChange={e => setForm({ ...form, guardian1Name: e.target.value })} placeholder="보호의무자1 성명" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
            <input value={form.guardian1Relation} onChange={e => setForm({ ...form, guardian1Relation: e.target.value })} placeholder="보호의무자1 관계" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
            <input value={form.guardian2Name} onChange={e => setForm({ ...form, guardian2Name: e.target.value })} placeholder="보호의무자2 성명(보호입원 필수)" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
            <input value={form.guardian2Relation} onChange={e => setForm({ ...form, guardian2Relation: e.target.value })} placeholder="보호의무자2 관계" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
            <input value={form.psychiatrist1Id} onChange={e => setForm({ ...form, psychiatrist1Id: e.target.value })} placeholder="진단 전문의 ID(보호입원 필수)" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs col-span-2" />
          </div>
          <p className="text-[10px] text-gray-400">보호입원(§43)은 보호의무자 2인·전문의 진단이 없으면 등록이 거부됩니다.</p>
          <div className="flex gap-2">
            <button
              onClick={() => { if (!form.patientId.trim()) { toast.warning('환자 ID를 입력하세요'); return; } if (!form.legalType) { toast.warning('입원 유형을 고르세요'); return; } createMut.mutate({ ...form, psychiatrist1Id: form.psychiatrist1Id || undefined }); }}
              disabled={createMut.isPending}
              className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 disabled:opacity-50">등록</button>
            <button onClick={() => setShowForm(false)} className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs rounded-lg">취소</button>
          </div>
        </div>
      )}

      {/* 목록 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-100 bg-gray-50/50">
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">환자</th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">유형</th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">입원일</th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">법정만료</th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">적합성심사</th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">조치</th>
          </tr></thead>
          <tbody>
            {/* 🔴 조회 실패를 "활성 비자의입원 없음"으로 말하지 않는다(기한 경과 감시가 꺼진다) */}
            {isError ? <tr><td colSpan={6} className="px-4 py-3"><QueryErrorFallback error={error} onRetry={refetch} size="compact" /></td></tr>
            : isLoading ? <tr><td colSpan={6} className="py-12 text-center text-gray-400">불러오는 중...</td></tr>
            : rows.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400">활성 비자의입원 없음</td></tr>
            : rows.map(r => {
              const hasError = (r.alerts ?? []).some(a => a.severity === 'ERROR');
              return (
                <tr key={r.id} className={`border-b border-gray-50 hover:bg-gray-50/50 ${hasError ? 'bg-red-50/40' : ''}`}>
                  <td className="px-3 py-3 text-xs text-gray-800">{r.patient?.familyName}{r.patient?.givenName}<span className="text-gray-400 ml-1">{r.patient?.mrn}</span></td>
                  <td className="px-3 py-3 text-xs"><span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">{LEGAL_LABEL[r.legalType] ?? r.legalType}</span></td>
                  <td className="px-3 py-3 text-xs text-gray-500">{kdate(new Date(r.admittedAt))}</td>
                  <td className={`px-3 py-3 text-xs ${hasError ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>{r.legalExpiryAt ? kdate(r.legalExpiryAt) : '-'}</td>
                  <td className="px-3 py-3 text-xs">{r.suitabilityReviewedAt ? <span className="text-emerald-600">{r.suitabilityResult ?? '완료'}</span> : r.suitabilityReviewDue ? <span className="text-amber-600">미실시({kdate(new Date(r.suitabilityReviewDue))})</span> : <span className="text-gray-300">해당없음</span>}</td>
                  <td className="px-3 py-3 text-xs">
                    <div className="flex gap-1 flex-wrap">
                      {!r.suitabilityReviewedAt && r.suitabilityReviewDue && (
                        <button onClick={() => openReview('suitability', r)} data-psych-review="suitability" className="min-h-[32px] px-2 rounded bg-amber-50 text-amber-700 hover:bg-amber-100">적합성심사</button>
                      )}
                      {continuationReviewable(r) && (
                        <button onClick={() => openReview('continuation', r)} data-psych-review="continuation" className="min-h-[32px] px-2 rounded bg-blue-50 text-blue-700 hover:bg-blue-100">계속심사</button>
                      )}
                      <button onClick={() => openReview('discharge', r)} data-psych-review="discharge" className="min-h-[32px] px-2 rounded bg-gray-100 text-gray-600 hover:bg-gray-200">퇴원</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {review && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" data-psych-review-dialog={review.kind}>
          <div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5">
            <h4 className="text-sm font-bold text-gray-900">
              {review.kind === 'suitability' ? '입원적합성심사 결과' : review.kind === 'continuation' ? '계속입원심사 결과' : '비자의입원 퇴원'}
              <span className="ml-2 text-xs font-normal text-gray-500">{patientNameLabel(review.row.patient ?? {})} · {LEGAL_LABEL[review.row.legalType] ?? review.row.legalType}</span>
            </h4>
            {REVIEW_OPTIONS[review.kind].length > 0 && (
              <div className="flex gap-2" role="radiogroup" aria-label="심사 결과">
                {REVIEW_OPTIONS[review.kind].map((o) => (
                  <button key={o} type="button" role="radio" aria-checked={reviewResult === o} data-review-result={o} onClick={() => setReviewResult(o)}
                    className={`min-h-[44px] flex-1 rounded-lg border text-sm font-semibold ${reviewResult === o ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-200 text-gray-700'}`}>{o}</button>
                ))}
              </div>
            )}
            {review.kind === 'continuation' && reviewResult === '계속입원' && (
              <>
                <p className="text-[11px] text-amber-700">계속입원을 고르면 오늘부터 3개월로 법정 입원기간·다음 심사 기한이 갱신됩니다.</p>
                <input value={reviewPsy2} onChange={e => setReviewPsy2(e.target.value)} placeholder="계속입원 진단 전문의 ID(선택)" className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" />
              </>
            )}
            <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} rows={2} placeholder="심사 근거·비고" className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" />
            <div className="flex gap-2">
              <button type="button" data-review-confirm
                disabled={(REVIEW_OPTIONS[review.kind].length > 0 && !reviewResult) || suitabilityMut.isPending || continuationMut.isPending || dischargeMut.isPending}
                onClick={() => {
                  const notes = reviewNotes.trim() || undefined;
                  if (review.kind === 'suitability') suitabilityMut.mutate({ id: review.row.id, result: reviewResult, notes });
                  else if (review.kind === 'continuation') continuationMut.mutate({ id: review.row.id, body: { result: reviewResult, ...(notes ? { notes } : {}), ...(reviewResult === '계속입원' && reviewPsy2.trim() ? { psychiatrist2Id: reviewPsy2.trim() } : {}) } });
                  else dischargeMut.mutate({ id: review.row.id, notes });
                }}
                className="min-h-[44px] flex-1 rounded-lg bg-indigo-600 text-sm font-semibold text-white disabled:opacity-40">기록</button>
              <button type="button" onClick={() => setReview(null)} className="min-h-[44px] rounded-lg bg-gray-100 px-4 text-sm text-gray-600">취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
