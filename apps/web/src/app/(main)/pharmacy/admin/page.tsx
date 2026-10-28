'use client';

import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useHasRole, useAdminWrite } from '@/hooks/use-admin-write';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { kdate } from '@/lib/ui-settings';
import { EmptyState, Unit, DrugName, useDurationText } from '@/components/ui/display';
import { SubstitutionDecision } from '@/components/pharmacy/SubstitutionDecision';

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

interface MedBatch {
  id: string;
  lotNumber: string;
  expirationDate: string;
  quantity: number;
  remainingQty: number;
  manufacturer?: string;
  storageCondition: string;
  isControlled: boolean;
  receivedAt: string;
  medicationCode?: { code?: string; nameKo?: string; nameEn?: string | null; ingredient?: string | null };
}

interface AdrReport {
  id: string;
  suspectedDrugName: string;
  suspectedDrugCode?: string;
  reactionDescription: string;
  onsetDate: string;
  severity: string;
  outcome: string;
  status: string;
  kidsReported: boolean;
  createdAt: string;
  patient?: { familyName?: string; givenName?: string; mrn?: string };
  reporter?: { familyName?: string; givenName?: string };
}

interface PharmDevice {
  id: string;
  name: string;
  type: string;
  status: string;
  connectionType: string;
  location?: string;
  lastHeartbeatAt?: string;
}

interface SubstitutionItem {
  id: string;
  reason: string;
  status: string;
  requestedAt: string;
  originalPrescription?: { medicationCode?: { nameKo?: string; code?: string }; encounter?: { patient?: { familyName?: string; givenName?: string; mrn?: string } } };
  substituteMedication?: { nameKo?: string; code?: string };
  pharmacist?: { familyName?: string; givenName?: string };
}

/* ═══════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════ */

const TABS = [
  { key: 'inventory', label: '재고 관리', icon: '📦' },
  { key: 'adr', label: 'ADR 보고', icon: '⚠️' },
  { key: 'substitution', label: '대체조제', icon: '🔄' },
  { key: 'devices', label: '기기 관리', icon: '🖥️' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const SEVERITY_COLOR: Record<string, string> = { MILD: 'bg-yellow-100 text-yellow-700', MODERATE: 'bg-orange-100 text-orange-700', SEVERE: 'bg-red-100 text-red-700', FATAL: 'bg-red-600 text-white' };
const DEVICE_STATUS_COLOR: Record<string, string> = { ONLINE: 'bg-emerald-100 text-emerald-700', OFFLINE: 'bg-gray-200 text-gray-600', ERROR: 'bg-red-100 text-red-700', MAINTENANCE: 'bg-amber-100 text-amber-700' };
const STORAGE_LABEL: Record<string, string> = { ROOM: '실온', COLD: '냉장(2~8°C)', FROZEN: '냉동(-20°C)' };

function fmtDate(d?: string) { return d ? kdate(d) : '-'; }
// 표시 정본(dense=분 생략) — 🔴 접미 '전' 까지 한국어로 굳던 자리라 문장 전체를 `<Tf k="{경과} 전@경과">` 로 옮겼다
function useTimeAgo() {
  const fmtDur = useDurationText();
  return (d?: string) => (d ? fmtDur(Math.floor((Date.now() - new Date(d).getTime()) / 60000), '-', true) : null);
}

/* ═══════════════════════════════════════════════════════════════
   Main Page
   ═══════════════════════════════════════════════════════════════ */

export default function PharmacyAdminPage() {
  const [tab, setTab] = useState<TabKey>('inventory');

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="약국 관리" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="재고 · ADR 보고 · 대체조제 · 기기 연동" /></p>
      </div>

      <div className="flex gap-2 mb-6">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 ${tab === t.key ? 'bg-teal-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
            <span>{t.icon}</span> <T k={t.label} />
          </button>
        ))}
      </div>

      {tab === 'inventory' && <InventoryTab />}
      {tab === 'adr' && <AdrTab />}
      {tab === 'substitution' && <SubstitutionTab />}
      {tab === 'devices' && <DevicesTab />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   재고 관리 탭
   ═══════════════════════════════════════════════════════════════ */

function InventoryTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [showReceive, setShowReceive] = useState(false);
  const [receiveForm, setReceiveForm] = useState({ medicationCodeId: '', lotNumber: '', expirationDate: '', quantity: 0, manufacturer: '', storageCondition: 'ROOM', isControlled: false });

  const { data: invData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['pharmacy-inventory'],
    queryFn: () => apiClient.get<{ data: MedBatch[] }>('/api/v1/pharmacy/inventory'),
  });

  const { data: expiringData, isError: expiringIsError, error: expiringError, refetch: refetchExpiring } = useQuery({
    queryKey: ['pharmacy-expiring'],
    queryFn: () => apiClient.get<{ data: MedBatch[] }>('/api/v1/pharmacy/inventory/expiring?days=30'),
  });

  const receiveMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/pharmacy/inventory/receive', receiveForm),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pharmacy-inventory'] }); setShowReceive(false); toast.success('입고 완료'); },
    onError: () => toast.error('입고 실패'),
  });

  const inventory = (Array.isArray(invData?.data) ? invData.data : []) as MedBatch[];
  const expiring = (Array.isArray(expiringData?.data) ? expiringData.data : []) as MedBatch[];

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="space-y-6">
      {/* 유효기간 임박 경고 */}
      {/* 🔴 유효기간 임박 조회 실패로 배너가 사라지면 "임박 없음"으로 읽힌다 */}
      {expiringIsError && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
          <p className="text-sm font-bold text-gray-900 mb-2"><T k="유효기간 임박 약품" /></p>
          <QueryErrorFallback error={expiringError} onRetry={refetchExpiring} size="compact" />
        </div>
      )}
      {!expiringIsError && expiring.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <p className="text-sm font-bold text-amber-800 mb-2"><T k="⚠ 유효기간 임박 약품 (" />{expiring.length}<Unit><T k="건" /></Unit>)</p>
          <div className="space-y-1">
            {expiring.slice(0, 5).map(b => (
              <div key={b.id} className="flex justify-between text-xs">
                <span className="text-amber-700"><DrugName nameKo={b.medicationCode?.nameKo} nameEn={b.medicationCode?.nameEn} ingredient={b.medicationCode?.ingredient} /> (LOT: {b.lotNumber})</span>
                <span className="text-amber-600 font-mono">{fmtDate(b.expirationDate)} <T k="만료 · 잔여" /> {b.remainingQty}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-between items-center">
        <p className="text-sm font-semibold text-gray-700"><T k="재고 현황 (" />{inventory.length}<Unit><T k="건" /></Unit>)</p>
        <button onClick={() => setShowReceive(!showReceive)} className="px-3 py-1.5 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700"><T k="+ 입고" /></button>
      </div>

      {/* 입고 폼 */}
      {showReceive && (
        <div className="bg-white rounded-2xl border p-4 space-y-3">
          <p className="text-sm font-bold text-gray-900"><T k="약품 입고" /></p>
          <div className="grid grid-cols-2 gap-3">
            <input value={receiveForm.medicationCodeId} onChange={e => setReceiveForm(f => ({ ...f, medicationCodeId: e.target.value }))} placeholder={tAttr('약품코드 ID')} className="px-3 py-2 border rounded-lg text-sm" />
            <input value={receiveForm.lotNumber} onChange={e => setReceiveForm(f => ({ ...f, lotNumber: e.target.value }))} placeholder={tAttr('LOT 번호')} className="px-3 py-2 border rounded-lg text-sm" />
            <input type="date" value={receiveForm.expirationDate} onChange={e => setReceiveForm(f => ({ ...f, expirationDate: e.target.value }))} className="px-3 py-2 border rounded-lg text-sm" />
            <input type="number" value={receiveForm.quantity || ''} onChange={e => setReceiveForm(f => ({ ...f, quantity: Number(e.target.value) }))} placeholder={tAttr('수량')} className="px-3 py-2 border rounded-lg text-sm" />
            <input value={receiveForm.manufacturer} onChange={e => setReceiveForm(f => ({ ...f, manufacturer: e.target.value }))} placeholder={tAttr('제조사')} className="px-3 py-2 border rounded-lg text-sm" />
            <select value={receiveForm.storageCondition} onChange={e => setReceiveForm(f => ({ ...f, storageCondition: e.target.value }))} className="px-3 py-2 border rounded-lg text-sm">
              <option value="ROOM">{tAttr('실온')}</option><option value="COLD">{tAttr('냉장')}</option><option value="FROZEN">{tAttr('냉동')}</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={receiveForm.isControlled} onChange={e => setReceiveForm(f => ({ ...f, isControlled: e.target.checked }))} className="rounded" /> <T k="마약류" />
          </label>
          <div className="flex gap-2">
            <button onClick={() => receiveMut.mutate()} disabled={!receiveForm.medicationCodeId || !receiveForm.lotNumber || !receiveForm.quantity} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-teal-600 text-white rounded-lg disabled:opacity-50"><T k="입고" /></button>
            <button onClick={() => setShowReceive(false)} className="px-4 py-2 text-sm bg-gray-100 text-gray-600 rounded-lg"><T k="취소" /></button>
          </div>
        </div>
      )}

      {/* 재고 테이블 */}
      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500 border-b">
              <th className="px-4 py-2.5 text-left"><T k="약품명" /></th>
              <th className="px-4 py-2.5 text-left">LOT</th>
              <th className="px-4 py-2.5 text-left"><T k="유효기간" /></th>
              <th className="px-4 py-2.5 text-right"><T k="잔여/입고" /></th>
              <th className="px-4 py-2.5 text-left"><T k="보관" /></th>
              <th className="px-4 py-2.5 text-left"><T k="입고일" /></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading ? <tr><td colSpan={6} className="py-8 text-center text-gray-400"><T k="로딩 중..." /></td></tr> :
             inventory.length === 0 ? <tr><td colSpan={6}><EmptyState icon="📦" title="재고 데이터가 없습니다" /></td></tr> :
             inventory.map(b => (
              <tr key={b.id} className="hover:bg-gray-50">
                <td className="px-4 py-2.5">
                  <span className="font-medium text-gray-900"><DrugName nameKo={b.medicationCode?.nameKo} nameEn={b.medicationCode?.nameEn} ingredient={b.medicationCode?.ingredient} /></span>
                  {b.isControlled && <span className="ml-1 text-[9px] bg-red-100 text-red-700 px-1 py-0.5 rounded whitespace-nowrap"><T k="마약류" /></span>}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{b.lotNumber}</td>
                <td className="px-4 py-2.5 text-xs">{fmtDate(b.expirationDate)}</td>
                <td className="px-4 py-2.5 text-right text-xs"><span className="font-bold text-gray-900">{b.remainingQty}</span> / {b.quantity}</td>
                <td className="px-4 py-2.5"><span className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded whitespace-nowrap"><T k={STORAGE_LABEL[b.storageCondition] ?? b.storageCondition} /></span></td>
                <td className="px-4 py-2.5 text-xs text-gray-500">{fmtDate(b.receivedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ADR 보고 탭
   ═══════════════════════════════════════════════════════════════ */

function AdrTab() {
  const tAttr = useTAttr();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ patientId: '', suspectedDrugName: '', suspectedDrugCode: '', reactionDescription: '', onsetDate: '', severity: 'MODERATE', outcome: 'RECOVERING', actionTaken: 'UNCHANGED' });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['pharmacy-adr'],
    queryFn: () => apiClient.get<{ data: AdrReport[] }>('/api/v1/pharmacy/adr'),
  });

  const createMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/pharmacy/adr', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pharmacy-adr'] }); setShowForm(false); toast.success('ADR 보고 등록'); },
    onError: () => toast.error('ADR 보고 실패'),
  });

  const submitMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/pharmacy/adr/${id}/submit`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pharmacy-adr'] }); toast.success('KIDS 보고 완료'); },
  });

  const reports = (Array.isArray(data?.data) ? data.data : []) as AdrReport[];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm font-semibold text-gray-700"><T k="ADR 보고 목록 (" />{reports.length}<Unit><T k="건" /></Unit>)</p>
        <button onClick={() => setShowForm(!showForm)} className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700"><T k="+ ADR 보고" /></button>
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl border p-4 space-y-3">
          <p className="text-sm font-bold text-gray-900"><T k="약물이상반응 보고" /></p>
          <div className="grid grid-cols-2 gap-3">
            <input value={form.patientId} onChange={e => setForm(f => ({ ...f, patientId: e.target.value }))} placeholder={tAttr('환자 ID')} className="px-3 py-2 border rounded-lg text-sm" />
            <input value={form.suspectedDrugName} onChange={e => setForm(f => ({ ...f, suspectedDrugName: e.target.value }))} placeholder={tAttr('의심 약물명')} className="px-3 py-2 border rounded-lg text-sm" />
            <input value={form.suspectedDrugCode} onChange={e => setForm(f => ({ ...f, suspectedDrugCode: e.target.value }))} placeholder={tAttr('약물 코드 (EDI)')} className="px-3 py-2 border rounded-lg text-sm" />
            <input type="date" value={form.onsetDate} onChange={e => setForm(f => ({ ...f, onsetDate: e.target.value }))} className="px-3 py-2 border rounded-lg text-sm" />
            <select value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))} className="px-3 py-2 border rounded-lg text-sm">
              <option value="MILD">{tAttr('경미(MILD)')}</option><option value="MODERATE">{tAttr('중등도(MODERATE)')}</option><option value="SEVERE">{tAttr('중증(SEVERE)')}</option><option value="FATAL">{tAttr('치명적(FATAL)')}</option>
            </select>
            <select value={form.outcome} onChange={e => setForm(f => ({ ...f, outcome: e.target.value }))} className="px-3 py-2 border rounded-lg text-sm">
              <option value="RECOVERED">{tAttr('회복')}</option><option value="RECOVERING">{tAttr('회복 중')}</option><option value="NOT_RECOVERED">{tAttr('미회복')}</option><option value="UNKNOWN">{tAttr('불명')}</option>
            </select>
          </div>
          <textarea value={form.reactionDescription} onChange={e => setForm(f => ({ ...f, reactionDescription: e.target.value }))} placeholder={tAttr('이상반응 상세 설명')} rows={3} className="w-full px-3 py-2 border rounded-lg text-sm" />
          <div className="flex gap-2">
            <button onClick={() => createMut.mutate()} disabled={!form.patientId || !form.suspectedDrugName || !form.reactionDescription} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-red-600 text-white rounded-lg disabled:opacity-50"><T k="보고 등록" /></button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm bg-gray-100 text-gray-600 rounded-lg"><T k="취소" /></button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50 text-xs text-gray-500 border-b">
            <th className="px-4 py-2.5 text-left"><T k="환자" /></th>
            <th className="px-4 py-2.5 text-left"><T k="의심 약물" /></th>
            <th className="px-4 py-2.5 text-left"><T k="이상반응" /></th>
            <th className="px-4 py-2.5 text-left"><T k="중증도" /></th>
            <th className="px-4 py-2.5 text-left"><T k="상태" /></th>
            <th className="px-4 py-2.5 text-left"><T k="보고일" /></th>
            <th className="px-4 py-2.5 text-right">KIDS</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {isError ? <tr><td colSpan={7} className="px-4 py-3"><QueryErrorFallback error={error} onRetry={refetch} size="compact" /></td></tr> :
             isLoading ? <tr><td colSpan={7} className="py-8 text-center text-gray-400"><T k="로딩 중..." /></td></tr> :
             reports.length === 0 ? <tr><td colSpan={7}><EmptyState icon="📋" title="ADR 보고가 없습니다" /></td></tr> :
             reports.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 text-xs">{r.patient?.familyName}{r.patient?.givenName}<br/><span className="text-gray-400">{r.patient?.mrn}</span></td>
                <td className="px-4 py-2.5 text-xs font-medium">{r.suspectedDrugName}</td>
                <td className="px-4 py-2.5 text-xs text-gray-600 max-w-[200px] truncate">{r.reactionDescription}</td>
                <td className="px-4 py-2.5"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${SEVERITY_COLOR[r.severity] ?? ''}`}>{r.severity}</span></td>
                <td className="px-4 py-2.5 text-xs">{r.status}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500">{fmtDate(r.createdAt)}</td>
                <td className="px-4 py-2.5 text-right">
                  {r.kidsReported ? <span className="text-[10px] text-emerald-600 font-medium"><T k="보고완료" /></span> :
                   <button onClick={() => submitMut.mutate(r.id)} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700"><T k="KIDS 보고" /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   대체조제 탭
   ═══════════════════════════════════════════════════════════════ */

function SubstitutionTab() {
  const tAttr = useTAttr();
  /**
   * 🔴 **대체조제는 약사가 요청하고 의사가 승인한다** — 서버가 요청은 약사(`pharmacistId`),
   *    승인·반려는 `@Roles(DOCTOR, ADMIN)` 으로 갈라 뒀는데 화면이 약사에게 승인 버튼을 그렸다.
   */
  const canApproveSub = useHasRole('DOCTOR');
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['pharmacy-substitution-pending'],
    queryFn: () => apiClient.get<{ data: SubstitutionItem[] }>('/api/v1/pharmacy/substitution/pending'),
  });

  // 최근 판정 — 약사가 결과(누가·왜)를 보는 자리(2026-09-30) · 종전엔 대기 목록에서 사라지는 것으로만 알았다
  const decidedQ = useQuery({
    queryKey: ['pharmacy-substitution-decided'],
    queryFn: () => apiClient.get<{ data: DecidedSubstitution[]; meta?: { truncated?: boolean; windowDays?: number } }>('/api/v1/pharmacy/substitution/decided'),
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['pharmacy-substitution-pending'] }); qc.invalidateQueries({ queryKey: ['pharmacy-substitution-decided'] }); };

  const items = (Array.isArray(data?.data) ? data.data : []) as SubstitutionItem[];

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-gray-700"><T k="대체조제 대기 (" />{items.length}<Unit><T k="건" /></Unit>)</p>
      {isError ? <QueryErrorFallback error={error} onRetry={refetch} /> :
       isLoading ? <div className="text-center py-8 text-gray-400"><T k="로딩 중..." /></div> :
       items.length === 0 ? <EmptyState icon="💊" title="대기 중인 대체조제 요청이 없습니다" className="bg-white rounded-2xl border" /> :
       <div className="space-y-3">
        {items.map(s => (
          <div key={s.id} className="bg-white rounded-2xl border p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-bold text-gray-900">{s.originalPrescription?.encounter?.patient?.familyName}{s.originalPrescription?.encounter?.patient?.givenName} <span className="text-xs text-gray-400">({s.originalPrescription?.encounter?.patient?.mrn})</span></p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-red-600 line-through">{s.originalPrescription?.medicationCode?.nameKo}</span>
                  <span className="text-xs text-gray-400">→</span>
                  <span className="text-xs text-emerald-700 font-medium">{s.substituteMedication?.nameKo}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1"><T k="사유:" /> {s.reason}</p>
                <p className="text-[10px] text-gray-400"><T k="약사:" /> {s.pharmacist?.familyName}{s.pharmacist?.givenName} · {fmtDate(s.requestedAt)}</p>
              </div>
              {canApproveSub && <SubstitutionDecision id={s.id} onDone={refresh} />}
            </div>
          </div>
        ))}
       </div>}
      <DecidedSubstitutions q={decidedQ} />
    </div>
  );
}

type DecidedSubstitution = SubstitutionItem & {
  status: 'APPROVED' | 'REJECTED';
  decidedAt: string | null;
  decisionNote: string | null;
  decidedBy: { id: string; name: string | null; role: string | null; isPrescriber: boolean } | null;
};

/** 최근 판정 목록 — 판정자가 책임 처방의 본인인지·관리자 대리인지 · 판정자 칸 이전 판정은 "기록 없음" */
function DecidedSubstitutions({ q }: { q: { data?: { data: DecidedSubstitution[]; meta?: { truncated?: boolean; windowDays?: number } }; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void } }) {
  const items = Array.isArray(q.data?.data) ? q.data!.data : [];
  return (
    <div className="space-y-2" data-sub-decided>
      <p className="text-sm font-semibold text-gray-700"><Tf k="최근 판정 ({d}일)" params={{ d: q.data?.meta?.windowDays ?? 30 }} /></p>
      {q.isError ? <QueryErrorFallback error={q.error} onRetry={q.refetch} /> :
       q.isLoading ? <div className="text-center py-4 text-gray-400 text-sm"><T k="로딩 중..." /></div> :
       items.length === 0 ? <p className="text-xs text-gray-400"><T k="최근 판정된 대체조제가 없습니다." /></p> : (
        <ul className="space-y-1.5">
          {items.map((s) => (
            <li key={s.id} className="rounded-xl border bg-white px-3 py-2 text-xs" data-sub-decided-row={s.status}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${s.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{s.status === 'APPROVED' ? <T k="승인" /> : <T k="거부" />}</span>
                <span className="font-medium text-gray-900">{s.originalPrescription?.encounter?.patient?.familyName}{s.originalPrescription?.encounter?.patient?.givenName}</span>
                <span className="text-red-600 line-through"><DrugName nameKo={s.originalPrescription?.medicationCode?.nameKo} /></span>
                <span className="text-gray-400">→</span>
                <span className="text-emerald-700"><DrugName nameKo={s.substituteMedication?.nameKo} /></span>
              </div>
              <p className="mt-0.5 text-[11px] text-gray-500" data-sub-decider={s.decidedBy ? (s.decidedBy.isPrescriber ? 'PRESCRIBER' : 'PROXY') : 'UNKNOWN'}>
                {s.decidedBy ? (
                  <>
                    <T k="판정:" /> {s.decidedBy.name ?? '—'} · {s.decidedBy.isPrescriber ? <T k="책임 처방의" /> : <T k="관리자·대리 판정(책임 처방의 아님)" />}
                    {s.decidedAt ? <> · {kdate(s.decidedAt, 'datetime')}</> : null}
                  </>
                ) : <T k="판정자 기록 없음(기능 도입 전 판정)" />}
              </p>
              {s.decisionNote && <p className="text-[11px] text-gray-700"><T k="사유:" /> {s.decisionNote}</p>}
            </li>
          ))}
        </ul>
      )}
      {q.data?.meta?.truncated && <p className="text-[11px] text-amber-700"><T k="최근 200건만 보입니다." /></p>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   기기 관리 탭
   ═══════════════════════════════════════════════════════════════ */

function DevicesTab() {
  const timeAgo = useTimeAgo();
  const tAttr = useTAttr();
  /** 🔴 조제 기기 등록은 서버가 `@Roles(ADMIN)` — 약사에게는 조회·상태 확인 화면이다 */
  const canManageDevice = useAdminWrite();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'ATC', connectionType: 'TCP', connectionConfig: '{}', location: '' });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['pharmacy-devices'],
    queryFn: () => apiClient.get<{ data: PharmDevice[] }>('/api/v1/pharmacy/devices'),
  });

  const createMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/pharmacy/devices', { ...form, connectionConfig: JSON.parse(form.connectionConfig || '{}') }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pharmacy-devices'] }); setShowAdd(false); toast.success('기기 등록 완료'); },
    onError: () => toast.error('기기 등록 실패'),
  });

  const heartbeatMut = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/pharmacy/devices/${id}/heartbeat`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pharmacy-devices'] }); toast.success('상태 체크 완료'); },
  });

  const devices = (Array.isArray(data?.data) ? data.data : []) as PharmDevice[];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm font-semibold text-gray-700"><T k="약국 기기 (" />{devices.length}<T k="대)" /></p>
        {canManageDevice && <button onClick={() => setShowAdd(!showAdd)} className="px-3 py-1.5 text-xs font-medium bg-teal-600 text-white rounded-lg"><T k="+ 기기 등록" /></button>}
      </div>

      {showAdd && (
        <div className="bg-white rounded-2xl border p-4 space-y-3">
          <p className="text-sm font-bold text-gray-900"><T k="기기 등록" /></p>
          <div className="grid grid-cols-2 gap-3">
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={tAttr('기기명')} className="px-3 py-2 border rounded-lg text-sm" />
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="px-3 py-2 border rounded-lg text-sm">
              <option value="ATC">{tAttr('자동조제기(ATC)')}</option><option value="COUNTER">{tAttr('정제 계수기')}</option><option value="PACKAGER">{tAttr('포장기')}</option><option value="LABEL_PRINTER">{tAttr('라벨 프린터')}</option>
            </select>
            <select value={form.connectionType} onChange={e => setForm(f => ({ ...f, connectionType: e.target.value }))} className="px-3 py-2 border rounded-lg text-sm">
              <option value="TCP">TCP/IP</option><option value="SERIAL">{tAttr('시리얼')}</option><option value="USB">USB</option><option value="API">API</option>
            </select>
            <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder={tAttr('위치')} className="px-3 py-2 border rounded-lg text-sm" />
          </div>
          <textarea value={form.connectionConfig} onChange={e => setForm(f => ({ ...f, connectionConfig: e.target.value }))} placeholder='{"host":"192.168.1.100","port":9100}' rows={2} className="w-full px-3 py-2 border rounded-lg text-sm font-mono" />
          <div className="flex gap-2">
            <button onClick={() => createMut.mutate()} disabled={!form.name} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-teal-600 text-white rounded-lg disabled:opacity-50"><T k="등록" /></button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm bg-gray-100 text-gray-600 rounded-lg"><T k="취소" /></button>
          </div>
        </div>
      )}

      {isError ? <QueryErrorFallback error={error} onRetry={refetch} /> :
       isLoading ? <div className="text-center py-8 text-gray-400"><T k="로딩 중..." /></div> :
       devices.length === 0 ? <EmptyState icon="🖥️" title="등록된 기기가 없습니다" className="bg-white rounded-2xl border" /> :
       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {devices.map(d => (
          <div key={d.id} className="bg-white rounded-2xl border p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${d.status === 'ONLINE' ? 'bg-emerald-500' : d.status === 'ERROR' ? 'bg-red-500' : 'bg-gray-400'}`} />
                <p className="text-sm font-bold text-gray-900">{d.name}</p>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${DEVICE_STATUS_COLOR[d.status] ?? ''}`}>{d.status}</span>
            </div>
            <div className="grid grid-cols-2 gap-1 text-xs text-gray-500 mb-3">
              <span><T k="유형:" /> {d.type}</span>
              <span><T k="연결:" /> {d.connectionType}</span>
              {d.location && <span><T k="위치:" /> {d.location}</span>}
              <span><T k="마지막 체크:" /> {(() => { const ago = timeAgo(d.lastHeartbeatAt); return ago ? <Tf k="{경과} 전@경과" params={{ 경과: ago }} /> : '-'; })()}</span>
            </div>
            <button onClick={() => heartbeatMut.mutate(d.id)} className="w-full min-h-[44px] px-3 py-2 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"><T k="상태 체크" /></button>
          </div>
        ))}
       </div>}
    </div>
  );
}
