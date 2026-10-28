'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { pollMs } from '@/lib/ui-settings';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import PatientSelector from '@/components/ui/PatientSelector';
import { T } from '@/components/ui/i18n-text';
import { useAuthStore } from '@/stores/auth-store';

const TYPE_LABEL: Record<string, string> = { SECLUSION: '격리(최대 12h)', RESTRAINT: '강박(최대 4h)' };
const RISK_LABEL: Record<string, string> = { SELF_HARM: '자해 위험', HARM_OTHERS: '타해 위험', BOTH: '자·타해 위험' };

interface SeclusionOrder {
  id: string;
  type: string;
  reason: string;
  riskType: string;
  startedAt: string;
  legalMaxUntil: string;
  extensionCount: number;
  psychiatristVerified: boolean;
  legalOverdue?: boolean;
  monitoringOverdue?: boolean;
  remainingMinutes?: number;
  patient?: { familyName: string | null; givenName: string | null; mrn: string | null } | null;
}

function unwrap<T>(d: unknown): T { const o = d as { data?: unknown }; return (o && typeof o === 'object' && 'data' in o ? o.data : d) as T; }

/**
 * 지시·연장은 서버가 의사·관리자만 받는다(`psychiatry.controller` 클래스 @Roles · 정신건강복지법 §75 전문의 지시).
 * 간호사는 현황·관찰 기록·해제만 — 누를 수 없는 버튼을 보이지 않는다(2026-10-10 간호 화면 `/nurse-station/seclusion`).
 */
export const SECLUSION_ORDER_ROLES: readonly string[] = ['DOCTOR', 'ADMIN'];

/** §75 격리·강박 현황 — 정신건강복지법: 전문의 지시·법정 최대시간·주기 관찰·연장(대면진찰)·해제 */
export default function SeclusionRestraintSection({ patientId }: { patientId?: string }) {
  const qc = useQueryClient();
  const role = useAuthStore((st) => st.user?.role);
  const canOrder = !!role && SECLUSION_ORDER_ROLES.includes(role);
  const [showForm, setShowForm] = useState(false);
  // 유형·위험 유형은 미선택에서 시작한다(2026-10-07 — 종전 격리·자해가 미리 골라져 있었다 · 법정 기록이다)
  const [form, setForm] = useState({ patientId: patientId ?? '', type: '', riskType: '', reason: '' });
  const [obsTarget, setObsTarget] = useState<string | null>(null);
  const [observation, setObservation] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['psych-seclusions-active'],
    queryFn: () => apiClient.get<{ data: SeclusionOrder[] }>('/api/v1/psychiatry/seclusions/active'),
    refetchInterval: pollMs('normal'),
  });
  const rows = (unwrap<SeclusionOrder[]>(data?.data) ?? []) as SeclusionOrder[];

  const invalidate = () => qc.invalidateQueries({ queryKey: ['psych-seclusions-active'] });
  const createMut = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiClient.post('/api/v1/psychiatry/seclusions', payload),
    onSuccess: () => { invalidate(); toast.success('격리·강박 지시를 등록했습니다'); setShowForm(false); setForm({ patientId: patientId ?? '', type: '', riskType: '', reason: '' }); }, // 🔴 등록 뒤에도 미선택으로(종전 격리·자해로 되돌아갔다)
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '등록 실패(§75 요건 확인)'),
  });
  const monitorMut = useMutation({
    mutationFn: ({ id, continued }: { id: string; continued: boolean }) =>
      apiClient.post(`/api/v1/psychiatry/seclusions/${id}/monitorings`, { observation: observation || undefined, continued }),
    onSuccess: (_r, v) => { invalidate(); toast.success(v.continued ? '관찰을 기록했습니다' : '관찰 기록 + 해제되었습니다'); setObsTarget(null); setObservation(''); },
    onError: () => toast.error('관찰 기록 실패'),
  });
  const extendMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiClient.patch(`/api/v1/psychiatry/seclusions/${id}/extend`, { reason }),
    onSuccess: () => { invalidate(); toast.success('연장했습니다(전문의 대면진찰 기록)'); },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '연장 실패'),
  });
  const releaseMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/psychiatry/seclusions/${id}/release`, {}),
    onSuccess: () => { invalidate(); toast.success('해제했습니다'); },
    onError: () => toast.error('해제 실패'),
  });

  const fmtRemain = (m?: number) => m == null ? '-' : m < 0 ? `초과 ${Math.abs(m)}분` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}분`;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-gray-900">§75 격리·강박 <span className="text-[10px] font-normal text-gray-400">정신건강복지법 — 전문의 지시·격리 12h/강박 4h</span></h3>
        </div>
        {canOrder ? (
          <button onClick={() => setShowForm(!showForm)} className="px-3 py-1.5 bg-rose-600 text-white rounded-xl text-xs font-medium hover:bg-rose-700">
            {showForm ? '닫기' : '+ 지시 등록'}
          </button>
        ) : (
          <span className="text-[11px] text-gray-500" data-seclusion-order-note><T k="지시·연장은 의사만 — 관찰 기록·해제만 할 수 있습니다" /></span>
        )}
      </div>

      {canOrder && showForm && (
        <div className="bg-rose-50/50 rounded-xl p-4 grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">환자</label>
            <PatientSelector value={form.patientId} onChange={(id) => setForm({ ...form, patientId: id })} context="admission" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">유형</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">선택</option>
                <option value="SECLUSION">격리 (12h)</option>
                <option value="RESTRAINT">강박 (4h)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">위험 유형</label>
              <select value={form.riskType} onChange={(e) => setForm({ ...form, riskType: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">선택</option>
                <option value="SELF_HARM">자해</option>
                <option value="HARM_OTHERS">타해</option>
                <option value="BOTH">자·타해</option>
              </select>
            </div>
          </div>
          <div className="col-span-2">
            <label className="text-xs text-gray-500 mb-1 block">법정 사유 <span className="text-rose-500">*</span> — 자·타해 위험이 뚜렷하고 다른 방법으로 위험 회피가 어려운 경우에 한함</label>
            <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="구체적 위험 상황과 대체수단 불가 사유" />
          </div>
          <div className="col-span-2 flex justify-end">
            <button disabled={!form.patientId || !form.type || !form.riskType || !form.reason.trim() || createMut.isPending}
              onClick={() => createMut.mutate(form)}
              className="min-h-[44px] px-4 py-2 bg-rose-600 text-white rounded-xl text-sm font-medium disabled:opacity-50">지시 등록</button>
          </div>
        </div>
      )}

      {/* 🔴 조회 실패를 "활성 격리·강박 없음"으로 말하지 않는다(§75 감시 대상이 사라진다) */}
      {isError ? (
        <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />
      ) : isLoading ? (
        <p className="text-xs text-gray-400 py-3 text-center">로딩 중...</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-400 py-3 text-center">활성 격리·강박 없음</p>
      ) : (
        <div className="space-y-2">
          {rows.map((o) => (
            <div key={o.id} className={`border rounded-xl p-3 ${o.legalOverdue ? 'border-red-300 bg-red-50/40 ring-1 ring-red-200' : o.monitoringOverdue ? 'border-amber-300 bg-amber-50/30' : 'border-gray-100'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${o.type === 'SECLUSION' ? 'bg-indigo-100 text-indigo-700' : 'bg-rose-100 text-rose-700'}`}>{TYPE_LABEL[o.type] ?? o.type}</span>
                  <span className="text-sm font-semibold">{o.patient?.familyName}{o.patient?.givenName} <span className="text-xs text-gray-400">{o.patient?.mrn}</span></span>
                  <span className="text-[10px] text-gray-500">{RISK_LABEL[o.riskType] ?? o.riskType}</span>
                  {!o.psychiatristVerified && <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[9px] font-bold rounded" title="지시자 정신과 전문의 미검증 — 감사 대상">전문의 미검증</span>}
                  {o.legalOverdue && <span className="px-1.5 py-0.5 bg-red-600 text-white text-[9px] font-bold rounded animate-pulse">법정시간 초과</span>}
                  {!o.legalOverdue && o.monitoringOverdue && <span className="px-1.5 py-0.5 bg-amber-500 text-white text-[9px] font-bold rounded">관찰 지연(1h+)</span>}
                </div>
                <span className={`text-xs font-semibold ${o.legalOverdue ? 'text-red-600' : 'text-gray-600'}`}>잔여 {fmtRemain(o.remainingMinutes)}{o.extensionCount > 0 ? ` · 연장 ${o.extensionCount}회` : ''}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1 truncate" title={o.reason}>{o.reason}</p>
              <div className="flex items-center gap-2 mt-2">
                <button onClick={() => setObsTarget(obsTarget === o.id ? null : o.id)}
                  className="px-2.5 py-1 bg-gray-100 text-gray-600 rounded-lg text-[11px] hover:bg-gray-200">관찰 기록</button>
                {canOrder && (
                  <button onClick={() => { const reason = window.prompt('연장 사유(전문의 대면진찰 소견) — 격리 12h/강박 4h 단위 연장'); if (reason?.trim()) extendMut.mutate({ id: o.id, reason }); }}
                    className="min-h-[44px] px-2.5 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[11px] hover:bg-indigo-100" data-seclusion-extend>연장</button>
                )}
                <button onClick={() => releaseMut.mutate(o.id)}
                  className="min-h-[44px] px-2.5 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-[11px] hover:bg-emerald-100">해제</button>
              </div>
              {obsTarget === o.id && (
                <div className="mt-2 flex gap-2">
                  <input value={observation} onChange={(e) => setObservation(e.target.value)} placeholder="관찰 소견(행동·순환·피부 등)"
                    className="flex-1 border rounded-lg px-3 py-1.5 text-xs" />
                  <button onClick={() => monitorMut.mutate({ id: o.id, continued: true })}
                    className="min-h-[44px] px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[11px]">기록</button>
                  <button onClick={() => monitorMut.mutate({ id: o.id, continued: false })}
                    className="min-h-[44px] px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[11px]" title="지속 불필요 → 기록 후 자동 해제">기록+해제</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
