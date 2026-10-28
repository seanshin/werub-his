'use client';

import { DrugName } from '@/components/ui/display';
import { ReasonInput, reasonFilled } from '@/components/ui/ReasonInput';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { safeFormat as format } from '@/lib/safe-date';
import {
  MedDoubleCheckPanel, DoubleCheckBypassBadge, doubleCheckScopeOf, doubleCheckReady,
  doubleCheckPayload, EMPTY_DOUBLE_CHECK, type DoubleCheckValue,
} from '@/components/nursing/MedDoubleCheck';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 🔴 이 화면의 **투약 안전 어휘는 의도적으로 배선하지 않는다**(nursing.ts 헤더의 제외 선언과 같은 근거).
 *    MAR 상태 라벨(예정/투여완료/보류/거부/미투약)·BCMA 바코드 대조 문구·⛔고위험(ISMP) 배지·
 *    이중확인 안내·투약 확인 결과 토스트가 그것이다 — 오역이 투약 사고가 되는 자리라
 *    한국어 원문이 그대로 나가는 편이 정직하다. 아래 `<T>` 는 그 밖의 화면 크롬만 덮는다.
 */
const STATUS_CONFIG: Record<string, { label: string; icon: string; bg: string; text: string }> = {
  SCHEDULED: { label: '예정', icon: '\u23F3', bg: 'bg-gray-100', text: 'text-gray-600' },
  ADMINISTERED: { label: '투여완료', icon: '\u2705', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  HELD: { label: '보류', icon: '\u23F8\uFE0F', bg: 'bg-amber-100', text: 'text-amber-700' },
  REFUSED: { label: '거부', icon: '\u274C', bg: 'bg-red-100', text: 'text-red-700' },
  MISSED: { label: '미투약', icon: '\u26A0\uFE0F', bg: 'bg-red-50', text: 'text-red-600' },
};

interface MedicationScheduleItem {
  id: string;
  scheduledAt: string;
  dose: string;
  route: string;
  status: string;
  administeredAt?: string;
  holdReason?: string;
  notes?: string | null;
  prescription?: { medicationCode?: { nameKo?: string; nameEn?: string | null; ingredient?: string | null; highAlertFlag?: boolean; highAlertCategory?: string | null } };
  nurse?: { familyName: string; givenName: string };
}

interface MedScheduleListResponse {
  data: MedicationScheduleItem[];
}

interface AdministerPayload {
  id: string;
  dose: string;
  route: string;
  notes: string;
  patientBandScan?: string;
  medScan?: string;
  // 🔴 DTO(`AdministerMedDto`)에 없는 키는 전역 whitelist 가 조용히 지운다 — 기계 대조 가드 있음.
  verifiedBy?: string;
  doubleCheckBypassReason?: string;
}

export default function MARPage({ params }: { params: Promise<{ admissionId: string }> }) {
  const { admissionId } = use(params);
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [dateFilter, setDateFilter] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [adminModal, setAdminModal] = useState<string | null>(null);
  const [holdModal, setHoldModal] = useState<string | null>(null);
  const [refuseModal, setRefuseModal] = useState<string | null>(null);
  const [adminForm, setAdminForm] = useState({ dose: '', route: 'PO', notes: '', patientBandScan: '', medScan: '' });
  const [holdReason, setHoldReason] = useState('');
  const [refuseReason, setRefuseReason] = useState('');
  const [aiCheck, setAiCheck] = useState<{ loading: boolean; result: Record<string, unknown> | null }>({ loading: false, result: null });
  // 고위험약 독립 이중확인(IPSG.3) — 범위 판정은 shared 정본
  const [dc, setDc] = useState<DoubleCheckValue>(EMPTY_DOUBLE_CHECK);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['mar-schedule', admissionId, dateFilter],
    queryFn: () => apiClient.get<{ data: MedicationScheduleItem[] }>(`/api/v1/admissions/${admissionId}/medication-schedule`, { date: dateFilter }),
  });

  const administerMut = useMutation({
    mutationFn: ({ id, ...body }: AdministerPayload) => apiClient.patch<{ data: { warnings?: string[] } }>(`/api/v1/medication-administrations/${id}/administer`, body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['mar-schedule'] });
      setAdminModal(null);
      const raw = res?.data as unknown as { data?: { warnings?: string[] } };
      const warns = raw?.data?.warnings ?? (res?.data as unknown as { warnings?: string[] })?.warnings;
      // 🔴 경고를 하나만 보여주면 나머지가 침묵한다(이중확인 우회 + 경로 불일치가 동시에 날 수 있다)
      if (warns?.length) warns.forEach((w) => toast.warning(w)); else toast.success('투약 확인 완료');
    },
    onError: (e) => toast.error((e as { message?: string })?.message || '투약 확인 실패'),
  });

  const holdMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiClient.patch(`/api/v1/medication-administrations/${id}/hold`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mar-schedule'] }); setHoldModal(null); },
  });

  const refuseMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiClient.patch(`/api/v1/medication-administrations/${id}/refuse`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mar-schedule'] }); setRefuseModal(null); },
  });

  const _schedRaw = data?.data;
  const schedule = Array.isArray(_schedRaw) ? _schedRaw : (_schedRaw as MedScheduleListResponse | undefined)?.data ?? [];

  // Sort by scheduled time
  const sortedSchedule = [...schedule].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  // Status summary counts
  const statusCounts = sortedSchedule.reduce((acc, m) => {
    acc[m.status] = (acc[m.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="max-w-5xl space-y-6">
      <Link href="/inpatient" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-indigo-600 transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        <T k="입원 목록" />
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900"><T k="투약확인 (MAR)" /></h1>
        <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
      </div>

      {/* Status Summary */}
      {!isLoading && sortedSchedule.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
            const count = statusCounts[key] || 0;
            if (count === 0) return null;
            return (
              <div key={key} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${cfg.bg}`}>
                <span className="text-sm">{cfg.icon}</span>
                <span className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</span>
                <span className={`text-xs font-bold ${cfg.text}`}>{count}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="예정시간" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="약품명" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="용량" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="경로" /></th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500"><T k="상태" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="간호사" /></th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500"><T k="액션" /></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i}>
                  <td className="px-4 py-3"><div className="h-4 w-12 bg-gray-100 rounded animate-pulse" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-32 bg-gray-100 rounded animate-pulse" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-16 bg-gray-100 rounded animate-pulse" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-10 bg-gray-100 rounded animate-pulse" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-16 bg-gray-100 rounded animate-pulse mx-auto" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-14 bg-gray-100 rounded animate-pulse" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-16 bg-gray-100 rounded animate-pulse mx-auto" /></td>
                </tr>
              ))
            ) : sortedSchedule.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center">
                      <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                    </div>
                    <div>
                      <p className="text-gray-900 font-medium"><T k="투약 스케줄이 없습니다" /></p>
                      <p className="text-sm text-gray-500 mt-0.5"><T k="해당 날짜에 예정된 투약이 없습니다. 처방을 확인해주세요." /></p>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              sortedSchedule.map((m: MedicationScheduleItem) => {
                const st = STATUS_CONFIG[m.status] ?? STATUS_CONFIG.SCHEDULED;
                return (
                  <tr key={m.id} className={`hover:bg-gray-50 ${m.status === 'SCHEDULED' ? '' : m.status === 'ADMINISTERED' ? 'bg-emerald-50/30' : m.status === 'HELD' ? 'bg-amber-50/30' : m.status === 'REFUSED' ? 'bg-red-50/30' : ''}`}>
                    <td className="px-4 py-3 text-gray-600 font-medium">{format(new Date(m.scheduledAt), 'HH:mm')}</td>
                    <td className="px-4 py-3 text-gray-900 font-medium">
                      <DrugName nameKo={m.prescription?.medicationCode?.nameKo} nameEn={m.prescription?.medicationCode?.nameEn} ingredient={m.prescription?.medicationCode?.ingredient} code={null} />
                      {m.prescription?.medicationCode?.highAlertFlag && (
                        <span className="ml-1.5 text-[9px] bg-red-600 text-white px-1.5 py-0.5 rounded font-bold align-middle whitespace-nowrap" title="ISMP 고위험 약물 — 투약 전 2인 확인(Two-person check)">⛔고위험</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{m.dose}</td>
                    <td className="px-4 py-3 text-gray-600">{m.route}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${st.bg} ${st.text}`}>
                        <span>{st.icon}</span>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{m.nurse ? `${m.nurse.familyName}${m.nurse.givenName}` : '-'}</td>
                    <td className="px-4 py-3 text-center">
                      {m.status === 'SCHEDULED' && (
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => { setAdminModal(m.id); setAdminForm({ dose: m.dose, route: m.route, notes: '', patientBandScan: '', medScan: '' }); setDc(EMPTY_DOUBLE_CHECK); }} className="min-h-[44px] px-3 py-2 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700">
                            투약확인
                          </button>
                          <button onClick={() => { setHoldModal(m.id); setHoldReason(''); }} className="min-h-[44px] px-3 py-2 bg-amber-500 text-white text-xs font-medium rounded-lg hover:bg-amber-600">보류</button>
                          <button onClick={() => { setRefuseModal(m.id); setRefuseReason(''); }} className="min-h-[44px] px-3 py-2 bg-red-500 text-white text-xs font-medium rounded-lg hover:bg-red-600">거부</button>
                        </div>
                      )}
                      {m.status === 'ADMINISTERED' && m.administeredAt && (
                        <span className="inline-flex flex-col items-center gap-0.5">
                          <span className="text-[11px] text-emerald-600 font-medium">{format(new Date(m.administeredAt), 'HH:mm')} 투여</span>
                          {/* 🔴 우회 표식이 notes 안에만 있어 어느 화면에도 뜨지 않던 것 */}
                          <DoubleCheckBypassBadge notes={m.notes} />
                        </span>
                      )}
                      {(m.status === 'HELD' || m.status === 'REFUSED') && m.holdReason && (
                        <span className={`text-[11px] cursor-help ${m.status === 'REFUSED' ? 'text-red-600' : 'text-amber-600'}`} title={m.holdReason}><T k="사유 보기" /></span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Administer Modal */}
      {adminModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setAdminModal(null)}>
          <div className="bg-white rounded-2xl p-6 w-96 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">투약 확인</h3>
            {/* 고위험약 독립 이중확인(IPSG.3) — 대상이 아니면 렌더되지 않는다(불필요한 마찰 금지) */}
            <MedDoubleCheckPanel
              scope={doubleCheckScopeOf(schedule.find((m: MedicationScheduleItem) => m.id === adminModal), adminForm.route)}
              value={dc}
              onChange={setDc}
            />
            {/* BCMA bedside 스캔(R2-3) — 불일치는 서버가 항상 차단. 미스캔은 정책(WARN/BLOCK)에 따름 */}
            <div className="bg-rose-50 rounded-lg p-3 space-y-2">
              <p className="text-[11px] font-semibold text-rose-700">BCMA 바코드 대조 (환자·약품)</p>
              <div className="grid grid-cols-2 gap-2">
                <input value={adminForm.patientBandScan} onChange={e => setAdminForm(f => ({ ...f, patientBandScan: e.target.value }))}
                  placeholder="손목밴드 스캔(MRN)" className="px-2.5 py-1.5 border border-rose-200 rounded-lg text-xs" />
                <input value={adminForm.medScan} onChange={e => setAdminForm(f => ({ ...f, medScan: e.target.value }))}
                  placeholder="약품 바코드 스캔" className="px-2.5 py-1.5 border border-rose-200 rounded-lg text-xs" />
              </div>
              {(!adminForm.patientBandScan || !adminForm.medScan) && (
                <p className="text-[10px] text-rose-500">스캔 없이 투약 시 정책에 따라 경고 표식 또는 차단됩니다.</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="실제 투여량" /></label>
              <input value={adminForm.dose} onChange={e => setAdminForm(f => ({ ...f, dose: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="투여경로" /></label>
              <select value={adminForm.route} onChange={e => setAdminForm(f => ({ ...f, route: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                {['PO', 'IV', 'IM', 'SC', 'SL', 'PR', 'INH', 'TOP'].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="메모" /></label>
              <input value={adminForm.notes} onChange={e => setAdminForm(f => ({ ...f, notes: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            {/* WeRU.B 약물 안전 검증 */}
            <div>
              <button onClick={async () => {
                const med = schedule.find((m: MedicationScheduleItem) => m.id === adminModal);
                const medName = med?.prescription?.medicationCode?.nameKo ?? '';
                setAiCheck({ loading: true, result: null });
                try {
                  // DTO 필수 필드는 drugs — 종전 medications 전송으로 whitelist strip 후 항상 400이었음(2026-07-07 검토).
                  // age/sex는 이 화면에 실데이터가 없어 생략(선택 필드 — 날조 기본값 금지)
                  const res = await apiClient.post<{ data: Record<string, unknown> }>('/api/v1/ai/predict/adverse-drug', {
                    drugs: [medName],
                  });
                  setAiCheck({ loading: false, result: res?.data ?? null });
                } catch {
                  setAiCheck({ loading: false, result: { error: `${AI_ORIGIN_TEXT} 검증 실패` } });
                }
              }} disabled={aiCheck.loading}
                className="w-full px-3 py-2 bg-amber-50 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-100 disabled:opacity-50 mb-2">
                {aiCheck.loading ? `${AI_ORIGIN_TEXT} 안전 검증 중...` : `${AI_ORIGIN_TEXT} 투약 전 안전 검증`}
              </button>
              {aiCheck.result && !aiCheck.result.error && (
                <div className="bg-amber-50 rounded-lg p-2.5 mb-2 text-xs">
                  <p className="font-semibold text-amber-700 mb-1">{AI_ORIGIN_TEXT} 약물 안전 결과</p>
                  <div className="text-amber-900 whitespace-pre-wrap">
                    {typeof aiCheck.result === 'string' ? aiCheck.result :
                      (aiCheck.result as Record<string, unknown>).risk_level ?
                        `위험도: ${(aiCheck.result as Record<string, unknown>).risk_level}` :
                        JSON.stringify(aiCheck.result, null, 2)}
                  </div>
                  <p className="mt-1.5 text-[11px] text-gray-500">{AI_ORIGIN_TEXT}가 생성한 참고 정보입니다 — 최종 판단은 의료진에게 있습니다.</p>
                </div>
              )}
              {typeof aiCheck.result?.error === 'string' && (
                <p className="text-xs text-red-500 mb-2">{aiCheck.result.error}</p>
              )}
            </div>

            <div className="flex gap-2">
              {(() => {
                const scope = doubleCheckScopeOf(schedule.find((m: MedicationScheduleItem) => m.id === adminModal), adminForm.route);
                const ready = doubleCheckReady(scope, dc);
                return (
                  <button
                    onClick={() => {
                      administerMut.mutate({
                        id: adminModal, dose: adminForm.dose, route: adminForm.route, notes: adminForm.notes,
                        ...(adminForm.patientBandScan.trim() ? { patientBandScan: adminForm.patientBandScan.trim() } : {}),
                        ...(adminForm.medScan.trim() ? { medScan: adminForm.medScan.trim() } : {}),
                        ...doubleCheckPayload(scope, dc),
                      });
                      setAiCheck({ loading: false, result: null });
                    }}
                    disabled={administerMut.isPending || !ready}
                    title={ready ? undefined : '확인 간호사를 지정하거나 우회 사유를 선택하세요'}
                    className="flex-1 min-h-[48px] py-3 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                  >투약 확인</button>
                );
              })()}
              <button onClick={() => { setAdminModal(null); setAiCheck({ loading: false, result: null }); }} className="flex-1 py-2.5 bg-gray-100 text-gray-700 text-sm rounded-lg"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}

      {/* Hold Modal */}
      {holdModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setHoldModal(null)}>
          <div className="bg-white rounded-2xl p-6 w-96 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold"><T k="투약 보류" /></h3>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="보류 사유" /></label>
              <ReasonInput domain="medicationHold" multiline rows={3} required value={holdReason} onChange={setHoldReason}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={tAttr('사유를 입력하세요...')} />
            </div>
            <div className="flex gap-2">
              <button onClick={() => holdMut.mutate({ id: holdModal, reason: holdReason })} disabled={holdMut.isPending || !reasonFilled(holdReason)} className="flex-1 min-h-[48px] py-3 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-50"><T k="보류 확인" /></button>
              <button onClick={() => setHoldModal(null)} className="flex-1 py-2.5 bg-gray-100 text-gray-700 text-sm rounded-lg"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}

      {/* Refuse Modal (환자 거부 — 임상 보류와 구분) */}
      {refuseModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setRefuseModal(null)}>
          <div className="bg-white rounded-2xl p-6 w-96 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold"><T k="투약 거부" /> <span className="text-xs font-normal text-gray-500"><T k="(환자 거부)" /></span></h3>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="거부 사유" /></label>
              <ReasonInput domain="medicationRefuse" multiline rows={3} required value={refuseReason} onChange={setRefuseReason}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={tAttr('환자 거부 사유를 입력하세요...')} />
            </div>
            <div className="flex gap-2">
              <button onClick={() => refuseMut.mutate({ id: refuseModal, reason: refuseReason })} disabled={refuseMut.isPending || !reasonFilled(refuseReason)} className="flex-1 min-h-[48px] py-3 bg-red-500 text-white text-sm font-semibold rounded-lg hover:bg-red-600 disabled:opacity-50"><T k="거부 확인" /></button>
              <button onClick={() => setRefuseModal(null)} className="flex-1 py-2.5 bg-gray-100 text-gray-700 text-sm rounded-lg"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
