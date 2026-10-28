'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { pollMs, kdate } from '@/lib/ui-settings';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

const ECT_STATUS_LABEL: Record<string, string> = { ORDERED: '처방됨', COMPLETED: '완료', CANCELLED: '취소' };
const ECT_STATUS_COLOR: Record<string, string> = {
  ORDERED: 'bg-indigo-100 text-indigo-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-gray-200 text-gray-600',
};

interface EctSession {
  id: string;
  status: string;
  consentFormId: string | null;
  scheduledAt: string | null;
  performedAt: string | null;
  seizureDurationSec: number | null;
  complications: string | null;
  anesthesiaNote: string | null;
  notes: string | null;
  createdAt: string;
}

interface ConsentRow {
  id: string;
  status: string;
  isValid: boolean;
  templateName: string | null;
  consentType: string | null;
  signedAt: string | null;
}

function unwrap<T>(d: unknown): T { const o = d as { data?: unknown }; return (o && typeof o === 'object' && 'data' in o ? o.data : d) as T; }

export default function EctSection({ patientId }: { patientId?: string }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ patientId: patientId ?? '', consentFormId: '', scheduledAt: '', anesthesiaNote: '', notes: '' });

  const listPid = (patientId ?? form.patientId).trim();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['psych-ect', listPid],
    queryFn: () => apiClient.get<{ data: EctSession[] }>(`/api/v1/psychiatry/ect/patient/${listPid}`),
    enabled: !!listPid,
    refetchInterval: pollMs('normal'),
  });
  const rows = (unwrap<EctSession[]>(data?.data) ?? []) as EctSession[];

  // 동의 게이트(기본 BLOCK) — 폼에서 서명된 유효 동의서를 골라 consentFormId로 전송
  const formPid = form.patientId.trim();
  const { data: consentData, isError: consentIsError, error: consentError, refetch: refetchConsents } = useQuery({
    queryKey: ['patient-consents', formPid],
    queryFn: () => apiClient.get<{ data: ConsentRow[] }>(`/api/v1/patients/${formPid}/consents`),
    enabled: showForm && !!formPid,
  });
  const signedConsents = ((unwrap<ConsentRow[]>(consentData?.data) ?? []) as ConsentRow[])
    .filter(c => c.status === 'SIGNED' && c.isValid !== false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['psych-ect'] });
  const createMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiClient.post('/api/v1/psychiatry/ect', payload),
    onSuccess: () => {
      invalidate(); toast.success('ECT 세션을 처방했습니다');
      setShowForm(false);
      setForm(f => ({ ...f, consentFormId: '', scheduledAt: '', anesthesiaNote: '', notes: '' }));
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '처방 실패 — 서명된 동의서가 필요합니다(게이트 BLOCK)'),
  });
  const completeMut = useMutation({
    mutationFn: ({ id, seizureDurationSec }: { id: string; seizureDurationSec?: number }) =>
      apiClient.patch(`/api/v1/psychiatry/ect/${id}/complete`, seizureDurationSec != null ? { seizureDurationSec } : {}),
    onSuccess: () => { invalidate(); toast.success('ECT 시행 완료를 기록했습니다'); },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '완료 처리 실패'),
  });
  const cancelMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      apiClient.patch(`/api/v1/psychiatry/ect/${id}/cancel`, reason ? { reason } : {}),
    onSuccess: () => { invalidate(); toast.success('ECT 세션을 취소했습니다'); },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '취소 실패'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900">
          ECT (전기경련치료) {listPid ? `${rows.length}건` : ''}
          <span className="ml-2 text-xs font-normal text-gray-400">서명 동의서 게이트 — 정신과 전문의 처방</span>
        </h3>
        <button
          onClick={() => { setShowForm(v => !v); if (!showForm && patientId && !form.patientId) setForm(f => ({ ...f, patientId })); }}
          className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">+ ECT 처방</button>
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input value={form.patientId} onChange={e => setForm({ ...form, patientId: e.target.value, consentFormId: '' })}
              placeholder="환자 ID(UUID)" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
            <select value={form.consentFormId} onChange={e => setForm({ ...form, consentFormId: e.target.value })}
              className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs">
              <option value="">동의서 선택 (서명 완료본만 표시)</option>
              {signedConsents.map(c => (
                <option key={c.id} value={c.id}>
                  {c.templateName ?? c.consentType ?? '동의서'} — {c.signedAt ? kdate(c.signedAt) : ''} 서명
                </option>
              ))}
            </select>
            <div>
              <label className="text-[10px] text-gray-500">시행 예정일시</label>
              <input type="datetime-local" value={form.scheduledAt} onChange={e => setForm({ ...form, scheduledAt: e.target.value })}
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500">마취 메모</label>
              <input value={form.anesthesiaNote} onChange={e => setForm({ ...form, anesthesiaNote: e.target.value })}
                placeholder="마취과 협진·전처치 등" className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs" />
            </div>
            <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
              placeholder="비고" className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs col-span-2" />
          </div>
          {/* 🔴 동의서 조회 실패를 "동의서 없음"으로 말하지 않는다 — 이미 서명한 동의서를 다시 받게 된다 */}
          {consentIsError && <QueryErrorFallback error={consentError} onRetry={() => refetchConsents()} size="compact" />}
          {!consentIsError && formPid && signedConsents.length === 0 && (
            <p className="text-[10px] text-amber-600">이 환자의 서명 완료 동의서가 없습니다 — ECT 동의서를 먼저 발급·서명받으세요(게이트 기본 BLOCK: 동의서 없이는 처방이 거부됩니다).</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (!formPid) { toast.warning('환자 ID를 입력하세요'); return; }
                createMut.mutate({
                  patientId: formPid,
                  consentFormId: form.consentFormId || undefined,
                  scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : undefined,
                  anesthesiaNote: form.anesthesiaNote || undefined,
                  notes: form.notes || undefined,
                });
              }}
              disabled={createMut.isPending}
              className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 disabled:opacity-50">처방</button>
            <button onClick={() => setShowForm(false)} className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs rounded-lg">취소</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-100 bg-gray-50/50">
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">상태</th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">예정일시</th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">시행일시</th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">발작시간</th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">동의서</th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">합병증/비고</th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">조치</th>
          </tr></thead>
          <tbody>
            {!listPid ? <tr><td colSpan={7} className="py-10 text-center text-gray-400">아래 개별 환자 조회에서 환자 ID를 입력하거나 처방 폼에 환자 ID를 넣으면 이력이 표시됩니다</td></tr>
            : isError ? <tr><td colSpan={7} className="p-3"><QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" /></td></tr>
            : isLoading ? <tr><td colSpan={7} className="py-10 text-center text-gray-400">불러오는 중...</td></tr>
            : rows.length === 0 ? <tr><td colSpan={7} className="py-10 text-center text-gray-400">ECT 이력 없음</td></tr>
            : rows.map(r => (
              <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-3 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${ECT_STATUS_COLOR[r.status] ?? 'bg-gray-100'}`}>{ECT_STATUS_LABEL[r.status] ?? r.status}</span></td>
                <td className="px-3 py-3 text-xs text-gray-700">{r.scheduledAt ? kdate(new Date(r.scheduledAt), 'datetime') : '-'}</td>
                <td className="px-3 py-3 text-xs text-gray-700">{r.performedAt ? kdate(new Date(r.performedAt), 'datetime') : '-'}</td>
                <td className="px-3 py-3 text-xs text-gray-700">{r.seizureDurationSec != null ? `${r.seizureDurationSec}초` : '-'}</td>
                <td className="px-3 py-3 text-xs">{r.consentFormId ? <span className="text-emerald-600 font-medium">✓ 확보</span> : <span className="text-amber-600">없음</span>}</td>
                <td className="px-3 py-3 text-xs text-gray-500 max-w-[200px] truncate">{[r.complications, r.notes].filter(Boolean).join(' / ') || '-'}</td>
                <td className="px-3 py-3 text-xs">
                  {r.status === 'ORDERED' && (
                    <div className="flex gap-1 flex-wrap">
                      <button
                        onClick={() => {
                          const v = window.prompt('발작 지속시간(초) — 미기록 시 빈칸', '');
                          if (v === null) return;
                          const n = v.trim() === '' ? undefined : Number(v);
                          if (n !== undefined && (!Number.isFinite(n) || n < 0)) { toast.error('숫자를 입력하세요'); return; }
                          completeMut.mutate({ id: r.id, seizureDurationSec: n });
                        }}
                        className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100">시행 완료</button>
                      <button
                        onClick={() => {
                          if (!window.confirm('이 ECT 세션을 취소할까요?')) return;
                          const reason = window.prompt('취소 사유(선택)', '') ?? undefined;
                          cancelMut.mutate({ id: r.id, reason: reason || undefined });
                        }}
                        className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200">취소</button>
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
