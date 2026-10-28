'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { pollMs, kdate } from '@/lib/ui-settings';
import { rhSign, bloodTypeText, BLOOD_PRODUCT_LABEL } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

const unwrap = <T,>(d: unknown): T => {
  const raw = (d as { data?: unknown })?.data;
  return (raw && typeof raw === 'object' && 'data' in (raw as object) ? (raw as { data: T }).data : raw) as T;
};

interface Alert { productType: string; bloodType: string; rhFactor?: string; count: number; min: number }
interface Mtp { id: string; patientId: string; indication: string; ratio?: string; packsIssued: number; status: string; activatedAt: string }
interface Reorder { id: string; productType: string; bloodType: string; units: number; urgency: string; status: string; requestedAt: string }
interface Reaction { id: string; reactionType: string; severity: string; reportedToBloodCenter: boolean; createdAt: string }
interface Profile { typing?: { abo: string; rh: string; antibodyScreen?: string; typedAt: string } | null; antibodies: { id: string; antibody: string; significance?: string }[]; hasSignificantAntibody: boolean }

const IND_LABEL: Record<string, string> = { TRAUMA: '외상', OB_HEMORRHAGE: '산과출혈', GI_BLEED: '위장관출혈', SURGICAL: '수술', OTHER: '기타' };
const RXN_LABEL: Record<string, string> = { FEBRILE: '발열성', ALLERGIC: '알레르기', HEMOLYTIC_ACUTE: '급성용혈', HEMOLYTIC_DELAYED: '지연용혈', TRALI: 'TRALI', TACO: 'TACO', SEPSIS: '패혈증', OTHER: '기타' };
const URGENCY_LABEL: Record<string, string> = { ROUTINE: '정규', URGENT: '긴급', STAT: '응급' };
const REORDER_STATUS_LABEL: Record<string, string> = { REQUESTED: '요청', ORDERED: '발주', RECEIVED: '입고', CANCELLED: '취소' };

export default function BloodBankEnhancement() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [pid, setPid] = useState('');
  const [queryPid, setQueryPid] = useState('');
  const [reorderForm, setReorderForm] = useState({ productType: 'PRBC', bloodType: 'O+', units: '2', urgency: 'ROUTINE' });

  const alerts = useQuery({ queryKey: ['bb-alerts'], queryFn: () => apiClient.get('/api/v1/blood-bank/inventory/alerts'), refetchInterval: pollMs('normal') });
  const mtps = useQuery({ queryKey: ['bb-mtp'], queryFn: () => apiClient.get('/api/v1/blood-bank/mtp/active'), refetchInterval: pollMs('fast') });
  const reorders = useQuery({ queryKey: ['bb-reorders'], queryFn: () => apiClient.get('/api/v1/blood-bank/reorders') });
  const reactions = useQuery({ queryKey: ['bb-reactions'], queryFn: () => apiClient.get('/api/v1/blood-bank/reaction-reports') });
  const profile = useQuery({ queryKey: ['bb-profile', queryPid], queryFn: () => apiClient.get(`/api/v1/blood-bank/patients/${queryPid}/profile`), enabled: !!queryPid });

  const alertList = unwrap<{ alerts: Alert[]; min: number }>(alerts.data)?.alerts ?? [];
  const mtpList = unwrap<Mtp[]>(mtps.data) ?? [];
  const reorderList = unwrap<Reorder[]>(reorders.data) ?? [];
  const reactionList = unwrap<Reaction[]>(reactions.data) ?? [];
  const prof = unwrap<Profile>(profile.data);

  const reorderMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/blood-bank/reorders', { productType: reorderForm.productType, bloodType: reorderForm.bloodType, units: Number(reorderForm.units), urgency: reorderForm.urgency }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bb-reorders'] }); toast.success(tAttr('발주 요청됨')); },
    onError: () => toast.error(tAttr('발주 실패')),
  });
  const reorderStatusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiClient.patch(`/api/v1/blood-bank/reorders/${id}/status`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bb-reorders'] }); toast.success(tAttr('상태 갱신')); },
  });
  const deactivateMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/blood-bank/mtp/${id}`, { deactivate: true }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bb-mtp'] }); toast.success(tAttr('MTP 해제')); },
  });

  const card = 'bg-white rounded-2xl border border-gray-100 shadow-sm p-5';
  const badge = (cls: string) => `text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 재고 임계 알림 */}
      <div className={card}>
        <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="재고 임계 알림" /></h3>
        {alertList.length === 0 ? <p className="text-xs text-gray-400"><T k="임계 미만 없음 (양호)" /></p> : (
          <div className="space-y-1.5">
            {alertList.map((a, i) => (
              <div key={i} className="flex items-center justify-between text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                <span className="font-medium text-red-800"><T k={BLOOD_PRODUCT_LABEL[a.productType] ?? a.productType} /> · {a.rhFactor ? bloodTypeText(a.bloodType, a.rhFactor) : a.bloodType}</span>
                <span className={badge('bg-red-600 text-white')}>{a.count}<T k="단위" /> (<T k="최소" /> {a.min})</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 활성 MTP */}
      <div className={card}>
        <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="활성 대량수혈 프로토콜(MTP)" /></h3>
        {mtpList.length === 0 ? <p className="text-xs text-gray-400"><T k="활성 MTP 없음" /></p> : (
          <div className="space-y-1.5">
            {mtpList.map(m => (
              <div key={m.id} className="flex items-center justify-between text-xs bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={badge('bg-orange-600 text-white')}><T k={IND_LABEL[m.indication] ?? m.indication} /></span>
                  <span className="text-gray-700"><T k="비율" /> {m.ratio ?? tAttr('미기록')} · {m.packsIssued}<T k="팩" /></span>
                </div>
                <button onClick={() => deactivateMut.mutate(m.id)} className="text-orange-700 hover:underline shrink-0"><T k="해제" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 환자 수혈전검사 프로필 */}
      <div className={card}>
        <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="환자 수혈전검사 조회" /></h3>
        <div className="flex gap-1.5 mb-3">
          <input value={pid} onChange={e => setPid(e.target.value)} placeholder={tAttr('환자 ID(UUID)')}
            className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-xs" />
          <button onClick={() => setQueryPid(pid.trim())} disabled={!pid.trim()}
            className="px-3 py-2 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40"><T k="조회" /></button>
        </div>
        {queryPid && (prof?.typing ? (
          <div className="text-xs space-y-1.5">
            <div className="flex items-center gap-2">
              <span className={badge('bg-red-100 text-red-700')}>{prof.typing.abo}형 Rh{rhSign(prof.typing.rh)}</span>
              <span className="text-gray-500"><T k="항체선별" /> {prof.typing.antibodyScreen ?? '-'}</span>
              {prof.hasSignificantAntibody && <span className={badge('bg-red-600 text-white')}><T k="⚠ 유의 항체" /></span>}
            </div>
            {prof.antibodies.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {prof.antibodies.map(a => <span key={a.id} className={badge(a.significance === 'SIGNIFICANT' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600')}>{a.antibody}</span>)}
              </div>
            )}
          </div>
        ) : <p className="text-xs text-gray-400"><T k="혈액형 검사 기록 없음" /></p>)}
      </div>

      {/* 수혈반응 보고 */}
      <div className={card}>
        <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="수혈반응 보고" /></h3>
        {reactionList.length === 0 ? <p className="text-xs text-gray-400"><T k="보고 없음" /></p> : (
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {reactionList.map(r => (
              <div key={r.id} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={badge(r.severity === 'LIFE_THREATENING' || r.severity === 'SEVERE' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}><T k={RXN_LABEL[r.reactionType] ?? r.reactionType} /></span>
                  <span className="text-gray-500">{kdate(new Date(r.createdAt))}</span>
                </div>
                {r.reportedToBloodCenter ? <span className={badge('bg-emerald-100 text-emerald-700')}><T k="혈액원 신고됨" /></span> : <span className={badge('bg-gray-100 text-gray-500')}><T k="미신고" /></span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 혈액원 발주 */}
      <div className={`${card} lg:col-span-2`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3"><T k="혈액원 발주" /></h3>
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <select value={reorderForm.productType} onChange={e => setReorderForm(f => ({ ...f, productType: e.target.value }))} className="px-2 py-2 border border-gray-200 rounded-lg text-xs bg-white">
            {['PRBC', 'FFP', 'PC', 'CRYO'].map(o => <option key={o} value={o}>{tAttr(BLOOD_PRODUCT_LABEL[o] ?? o)}</option>)}
          </select>
          <select value={reorderForm.bloodType} onChange={e => setReorderForm(f => ({ ...f, bloodType: e.target.value }))} className="px-2 py-2 border border-gray-200 rounded-lg text-xs bg-white">
            {['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'].map(o => <option key={o}>{o}</option>)}
          </select>
          <input type="number" value={reorderForm.units} onChange={e => setReorderForm(f => ({ ...f, units: e.target.value }))} className="w-20 px-2 py-2 border border-gray-200 rounded-lg text-xs" placeholder={tAttr('단위')} />
          <select value={reorderForm.urgency} onChange={e => setReorderForm(f => ({ ...f, urgency: e.target.value }))} className="px-2 py-2 border border-gray-200 rounded-lg text-xs bg-white">
            {[['ROUTINE', '정규'], ['URGENT', '긴급'], ['STAT', '응급']].map(([v, l]) => <option key={v} value={v}>{tAttr(l)}</option>)}
          </select>
          <button onClick={() => reorderMut.mutate()} disabled={reorderMut.isPending} className="px-4 py-2 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40"><T k="발주 요청" /></button>
        </div>
        {reorderList.length > 0 && (
          <div className="space-y-1">
            {reorderList.slice(0, 8).map(r => (
              <div key={r.id} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg px-3 py-1.5">
                <span className="text-gray-800"><T k={BLOOD_PRODUCT_LABEL[r.productType] ?? r.productType} /> · {r.bloodType} · {r.units}<T k="단위" /> · <T k={URGENCY_LABEL[r.urgency] ?? r.urgency} /></span>
                <select value={r.status} onChange={e => reorderStatusMut.mutate({ id: r.id, status: e.target.value })} className="text-[11px] border border-gray-200 rounded px-1.5 py-1 bg-white">
                  {['REQUESTED', 'ORDERED', 'RECEIVED', 'CANCELLED'].map(s => <option key={s} value={s}>{tAttr(REORDER_STATUS_LABEL[s] ?? s)}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
