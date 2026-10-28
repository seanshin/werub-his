'use client';

import { T, useTAttr } from '@/components/ui/i18n-text';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { INSP_TYPE_LABEL, RESULT_COLOR, CONDITION_LABEL, CONDITION_COLOR } from './constants';
import { money, kdate } from '@/lib/ui-settings';
import { kstToday } from '@/lib/kst-today';

interface EquipmentPart {
  id: string;
  partName: string;
  partNumber?: string;
  currentStock: number;
  minStock: number;
  supplier?: string;
  unitPrice?: number;
}

interface EquipmentUsageLog {
  id: string;
  usedDate: string;
  usedBy: string;
  department?: string;
  patientCount?: number;
  usageHours?: number;
  purpose?: string;
  condition: string;
}

interface InspectionCheckItem {
  item: string;
  result: string;
  notes: string;
}

interface InspectionLog {
  id: string;
  inspectionDate: string;
  inspectorName: string;
  inspectionType: string;
  overallResult: string;
  checkItems: InspectionCheckItem[];
  findings?: string;
  actionTaken?: string;
}

interface InspectionForm {
  inspectionDate: string;
  inspectorName?: string;
  inspectionType: string;
  overallResult: string;
  checkItems: InspectionCheckItem[];
  findings?: string;
  nextInspectionDate?: string;
}

export function EquipmentPartsSection({ equipmentId }: { equipmentId: string }) {
  const tAttr = useTAttr();
  const { data } = useQuery({ queryKey: ['eq-parts', equipmentId], queryFn: () => apiClient.get<{ data: EquipmentPart[] }>(`/api/v1/equipment/${equipmentId}/parts`) });
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  const _partsRaw = data?.data;
  const parts: EquipmentPart[] = Array.isArray(_partsRaw) ? _partsRaw : (_partsRaw as unknown as Record<string, unknown>)?.data as EquipmentPart[] ?? [];

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiClient.post(`/api/v1/equipment/${equipmentId}/parts`, form);
    setShowAdd(false); setForm({});
    qc.invalidateQueries({ queryKey: ['eq-parts', equipmentId] });
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-gray-900"><T k="부품 재고" /></h3>
        <button onClick={() => setShowAdd(!showAdd)} className="text-xs text-blue-600 hover:text-blue-700 font-medium"><T k="+ 부품 추가" /></button>
      </div>
      {showAdd && (
        <form onSubmit={handleAdd} className="grid grid-cols-3 gap-2 mb-4 p-3 bg-gray-50 rounded-xl">
          <input placeholder={tAttr('부품명 *')} value={form.partName ?? ''} onChange={e => setForm(p => ({ ...p, partName: e.target.value }))} required className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <input placeholder={tAttr('부품번호')} value={form.partNumber ?? ''} onChange={e => setForm(p => ({ ...p, partNumber: e.target.value }))} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <input placeholder={tAttr('현재고')} type="number" value={form.currentStock ?? ''} onChange={e => setForm(p => ({ ...p, currentStock: e.target.value }))} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <input placeholder={tAttr('안전재고')} type="number" value={form.minStock ?? ''} onChange={e => setForm(p => ({ ...p, minStock: e.target.value }))} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <input placeholder={tAttr('공급처')} value={form.supplier ?? ''} onChange={e => setForm(p => ({ ...p, supplier: e.target.value }))} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />

          <button type="submit" className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium"><T k="등록" /></button>
        </form>
      )}
      {parts.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4"><T k="등록된 부품 없음" /></p>
      ) : (
        <table className="w-full text-xs">
          <thead><tr className="border-b border-gray-100">
            <th className="px-2 py-2 text-left text-gray-500"><T k="부품명" /></th><th className="px-2 py-2 text-left text-gray-500"><T k="부품번호" /></th>
            <th className="px-2 py-2 text-right text-gray-500"><T k="현재고" /></th><th className="px-2 py-2 text-right text-gray-500"><T k="안전재고" /></th>
            <th className="px-2 py-2 text-left text-gray-500"><T k="공급처" /></th><th className="px-2 py-2 text-right text-gray-500"><T k="단가" /></th>
          </tr></thead>
          <tbody>{parts.map((p: EquipmentPart) => (
            <tr key={p.id} className="border-b border-gray-50">
              <td className="px-2 py-2 font-medium text-gray-900">{p.partName}</td>
              <td className="px-2 py-2 text-gray-500 font-mono">{p.partNumber ?? '-'}</td>
              <td className={`px-2 py-2 text-right tabular-nums font-medium ${p.currentStock <= p.minStock ? 'text-red-600' : 'text-gray-700'}`}>{p.currentStock}</td>
              <td className="px-2 py-2 text-right tabular-nums text-gray-500">{p.minStock}</td>
              <td className="px-2 py-2 text-gray-600">{p.supplier ?? '-'}</td>
              <td className="px-2 py-2 text-right tabular-nums text-gray-600">{p.unitPrice ? `${money(p.unitPrice)}` : '-'}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

export function EquipmentUsageSection({ equipmentId }: { equipmentId: string }) {
  const tAttr = useTAttr();
  const { data } = useQuery({ queryKey: ['eq-usage', equipmentId], queryFn: () => apiClient.get<{ data: EquipmentUsageLog[] }>(`/api/v1/equipment/${equipmentId}/usage-logs`) });
  const _usageRaw = data?.data;
  const usageLogs: EquipmentUsageLog[] = Array.isArray(_usageRaw) ? _usageRaw : (_usageRaw as unknown as Record<string, unknown>)?.data as EquipmentUsageLog[] ?? [];
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ usedDate: kstToday(), condition: 'NORMAL' });
  const qc = useQueryClient();

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiClient.post(`/api/v1/equipment/${equipmentId}/usage-logs`, form);
    setShowAdd(false); setForm({ usedDate: kstToday(), condition: 'NORMAL' });
    qc.invalidateQueries({ queryKey: ['eq-usage', equipmentId] });
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-gray-900"><T k="사용일지" /></h3>
        <button onClick={() => setShowAdd(!showAdd)} className="text-xs text-blue-600 hover:text-blue-700 font-medium"><T k="+ 사용 기록" /></button>
      </div>
      {showAdd && (
        <form onSubmit={handleAdd} className="grid grid-cols-3 gap-2 mb-4 p-3 bg-gray-50 rounded-xl">
          <input type="date" value={form.usedDate} onChange={e => setForm(p => ({ ...p, usedDate: e.target.value }))} required className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <input placeholder={tAttr('사용자 *')} value={form.usedBy ?? ''} onChange={e => setForm(p => ({ ...p, usedBy: e.target.value }))} required className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <input placeholder={tAttr('부서')} value={form.department ?? ''} onChange={e => setForm(p => ({ ...p, department: e.target.value }))} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <input placeholder={tAttr('환자수')} type="number" value={form.patientCount ?? ''} onChange={e => setForm(p => ({ ...p, patientCount: e.target.value }))} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <input placeholder={tAttr('사용시간(h)')} type="number" step="0.5" value={form.usageHours ?? ''} onChange={e => setForm(p => ({ ...p, usageHours: e.target.value }))} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <select value={form.condition} onChange={e => setForm(p => ({ ...p, condition: e.target.value }))} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs">
            <option value="NORMAL">{tAttr('정상')}</option><option value="ISSUE">{tAttr('이상감지')}</option><option value="FAULT">{tAttr('고장')}</option>
          </select>
          <input placeholder={tAttr('사용 목적')} value={form.purpose ?? ''} onChange={e => setForm(p => ({ ...p, purpose: e.target.value }))} className="col-span-2 px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />
          <button type="submit" className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium"><T k="등록" /></button>
        </form>
      )}
      {usageLogs.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4"><T k="사용일지 없음" /></p>
      ) : (
        <table className="w-full text-xs">
          <thead><tr className="border-b border-gray-100">
            <th className="px-2 py-2 text-left text-gray-500"><T k="일자" /></th><th className="px-2 py-2 text-left text-gray-500"><T k="사용자" /></th>
            <th className="px-2 py-2 text-left text-gray-500"><T k="부서" /></th><th className="px-2 py-2 text-right text-gray-500"><T k="환자수" /></th>
            <th className="px-2 py-2 text-right text-gray-500"><T k="시간" /></th><th className="px-2 py-2 text-left text-gray-500"><T k="목적" /></th>
            <th className="px-2 py-2 text-left text-gray-500"><T k="상태" /></th>
          </tr></thead>
          <tbody>{usageLogs.map((u: EquipmentUsageLog) => (
            <tr key={u.id} className="border-b border-gray-50">
              <td className="px-2 py-2 tabular-nums text-gray-600">{kdate(new Date(u.usedDate))}</td>
              <td className="px-2 py-2 text-gray-900 font-medium">{u.usedBy}</td>
              <td className="px-2 py-2 text-gray-600">{u.department ?? '-'}</td>
              <td className="px-2 py-2 text-right tabular-nums text-gray-700">{u.patientCount ?? '-'}</td>
              <td className="px-2 py-2 text-right tabular-nums text-gray-700">{u.usageHours ?? '-'}h</td>
              <td className="px-2 py-2 text-gray-600 max-w-[120px] truncate">{u.purpose ?? '-'}</td>
              <td className="px-2 py-2"><span className={`font-semibold ${CONDITION_COLOR[u.condition] ?? 'text-gray-500'}`}>{CONDITION_LABEL[u.condition] ?? '-'}</span></td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

export function EquipmentInspectionSection({ equipmentId }: { equipmentId: string }) {
  const tAttr = useTAttr();
  const { data } = useQuery({ queryKey: ['eq-insp', equipmentId], queryFn: () => apiClient.get<{ data: InspectionLog[] }>(`/api/v1/equipment/${equipmentId}/inspection-logs`) });
  const _inspRaw = data?.data;
  const inspLogs: InspectionLog[] = Array.isArray(_inspRaw) ? _inspRaw : (_inspRaw as unknown as Record<string, unknown>)?.data as InspectionLog[] ?? [];
  const [showAdd, setShowAdd] = useState(false);
  /**
   * 🔴 점검 항목의 초기값은 **미선택**이다(2026-09-02).
   *    종전엔 5항목 전부 `PASS` 로 시작해 **점검하지 않아도 전부 합격이 저장됐다**(P16).
   *    형제 화면 `InspectionLogTab` 은 **이미 이 결함을 고쳤는데**(빈 result·미점검 option·저장 차단)
   *    같은 원장(`POST /equipment/:id/inspection-logs`)에 쓰는 이 폼만 남아 있었다 —
   *    한 곳만 고치면 갈라진다. 가드도 그 파일 하나로 핀 고정돼 이쪽을 못 봤다.
   */
  const [form, setForm] = useState<InspectionForm>({ inspectionDate: kstToday(), inspectionType: 'MONTHLY', overallResult: '', checkItems: [{ item: '외관 상태', result: '', notes: '' }, { item: '작동 확인', result: '', notes: '' }, { item: '안전장치', result: '', notes: '' }, { item: '전기/접지', result: '', notes: '' }, { item: '교정 상태', result: '', notes: '' }] });
  const [unjudgedError, setUnjudgedError] = useState<string | null>(null);
  const qc = useQueryClient();

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    // 🔴 미판정 항목이 있으면 저장하지 않는다 — 미점검과 '적합'은 다른 사실이다(형제 화면과 같은 규칙)
    const unjudged = form.checkItems.filter((c) => c.item.trim() && !c.result).map((c) => c.item);
    if (unjudged.length > 0 || !form.overallResult) {
      setUnjudgedError(
        !form.overallResult
          ? '종합결과를 선택해야 저장됩니다'
          : `판정하지 않은 항목: ${unjudged.join(' · ')} — 적합/부적합/N/A 를 선택해야 저장됩니다`,
      );
      return;
    }
    setUnjudgedError(null);
    await apiClient.post(`/api/v1/equipment/${equipmentId}/inspection-logs`, form);
    setShowAdd(false);
    qc.invalidateQueries({ queryKey: ['eq-insp', equipmentId] });
  };

  const updateCheckItem = (idx: number, field: string, val: string) => {
    setForm(prev => {
      const items = [...prev.checkItems];
      items[idx] = { ...items[idx], [field]: val };
      return { ...prev, checkItems: items };
    });
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-gray-900"><T k="점검일지" /></h3>
        <button onClick={() => setShowAdd(!showAdd)} className="text-xs text-blue-600 hover:text-blue-700 font-medium"><T k="+ 점검 기록" /></button>
      </div>
      {showAdd && (
        <form onSubmit={handleAdd} className="mb-4 p-4 bg-gray-50 rounded-xl space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <div><label className="text-[10px] text-gray-500"><T k="점검일 *" /></label><input type="date" value={form.inspectionDate} onChange={e => setForm(p => ({ ...p, inspectionDate: e.target.value }))} required className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs" /></div>
            <div><label className="text-[10px] text-gray-500"><T k="점검자 *" /></label><input value={form.inspectorName ?? ''} onChange={e => setForm(p => ({ ...p, inspectorName: e.target.value }))} required placeholder={tAttr('홍길동')} className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs" /></div>
            <div><label className="text-[10px] text-gray-500"><T k="유형" /></label><select value={form.inspectionType} onChange={e => setForm(p => ({ ...p, inspectionType: e.target.value }))} className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs">
              <option value="DAILY">{tAttr('일일')}</option><option value="WEEKLY">{tAttr('주간')}</option><option value="MONTHLY">{tAttr('월간')}</option><option value="QUARTERLY">{tAttr('분기')}</option><option value="ANNUAL">{tAttr('연간')}</option>
            </select></div>
            <div><label className="text-[10px] text-gray-500"><T k="종합결과" /></label><select value={form.overallResult} onChange={e => setForm(p => ({ ...p, overallResult: e.target.value }))} className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs">
              <option value="">{tAttr('선택 — 미판정')}</option><option value="PASS">{tAttr('적합(PASS)')}</option><option value="CONDITIONAL">{tAttr('조건부')}</option><option value="FAIL">{tAttr('부적합(FAIL)')}</option>
            </select></div>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-gray-500 mb-1"><T k="점검 항목" /></p>
            <div className="space-y-1">
              {form.checkItems.map((ci: InspectionCheckItem, i: number) => (
                <div key={i} className="grid grid-cols-[1fr_80px_1fr] gap-1">
                  <input value={ci.item} onChange={e => updateCheckItem(i, 'item', e.target.value)} placeholder={tAttr('점검항목')} className="px-2 py-1 border border-gray-200 rounded-lg text-xs" />
                  <select value={ci.result} onChange={e => updateCheckItem(i, 'result', e.target.value)} className="px-1 py-1 border border-gray-200 rounded-lg text-xs">
                    <option value="">{tAttr('미점검')}</option><option value="PASS">{tAttr('적합')}</option><option value="FAIL">{tAttr('부적합')}</option><option value="NA">N/A</option>
                  </select>
                  <input value={ci.notes} onChange={e => updateCheckItem(i, 'notes', e.target.value)} placeholder={tAttr('비고')} className="px-2 py-1 border border-gray-200 rounded-lg text-xs" />
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-[10px] text-gray-500"><T k="소견" /></label><input value={form.findings ?? ''} onChange={e => setForm(p => ({ ...p, findings: e.target.value }))} className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs" /></div>
            <div><label className="text-[10px] text-gray-500"><T k="다음점검일" /></label><input type="date" value={form.nextInspectionDate ?? ''} onChange={e => setForm(p => ({ ...p, nextInspectionDate: e.target.value }))} className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs" /></div>
          </div>

          {unjudgedError && <p className="text-[11px] text-red-600 mb-2">{unjudgedError}</p>}
          <button type="submit" className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium"><T k="점검일지 저장" /></button>
        </form>
      )}
      {inspLogs.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4"><T k="점검일지 없음" /></p>
      ) : (
        <div className="space-y-3">
          {inspLogs.map((l: InspectionLog) => {
            const items = Array.isArray(l.checkItems) ? l.checkItems : [];
            return (
              <div key={l.id} className="border border-gray-100 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100"><T k={INSP_TYPE_LABEL[l.inspectionType] ?? l.inspectionType} /></span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${RESULT_COLOR[l.overallResult]}`}>{l.overallResult}</span>
                    <span className="text-xs text-gray-500"><T k="점검자:" /> {l.inspectorName}</span>
                  </div>
                  <span className="text-xs text-gray-400 tabular-nums">{kdate(new Date(l.inspectionDate))}</span>
                </div>
                {items.length > 0 && (
                  <div className="grid grid-cols-3 gap-1 mb-2">
                    {items.map((ci: InspectionCheckItem, i: number) => (
                      <div key={i} className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded ${ci.result === 'PASS' || ci.result === 'OK' ? 'bg-emerald-50 text-emerald-700' : ci.result === 'FAIL' ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-500'}`}>
                        <span>{ci.result === 'PASS' || ci.result === 'OK' ? '✓' : ci.result === 'FAIL' ? '✗' : '-'}</span>
                        <span>{ci.item}</span>
                      </div>
                    ))}
                  </div>
                )}
                {l.findings && <p className="text-xs text-gray-600">{l.findings}</p>}
                {l.actionTaken && <p className="text-xs text-amber-600 mt-1"><T k="조치:" /> {l.actionTaken}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
