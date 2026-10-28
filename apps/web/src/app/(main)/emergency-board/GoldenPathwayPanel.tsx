'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { pollMs } from '@/lib/ui-settings';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

const unwrap = <T,>(d: unknown): T => {
  const raw = (d as { data?: unknown })?.data;
  return (raw && typeof raw === 'object' && 'data' in (raw as object) ? (raw as { data: T }).data : raw) as T;
};

interface Milestone { key: string; label: string; targetMin: number; done: boolean; overdue: boolean }
interface Pathway {
  id: string; patientId: string; name: string; mrn: string;
  pathwayType: string; primaryMetric: string; targetMinutes: number;
  elapsed: number; overTarget: boolean; remaining: number;
  milestones: Milestone[]; doneCount: number; total: number;
}

const TYPE_META: Record<string, { label: string; tone: string }> = {
  STEMI: { label: '심근경색 (STEMI)', tone: 'bg-rose-600' },
  STROKE: { label: '뇌졸중 (Stroke)', tone: 'bg-purple-600' },
  SEPSIS: { label: '패혈증 (Sepsis)', tone: 'bg-amber-600' },
};
const fmtMin = (m: number) => (Math.abs(m) < 60 ? `${m}분` : `${m < 0 ? '-' : ''}${Math.floor(Math.abs(m) / 60)}시간 ${Math.abs(m) % 60}분`);

export default function GoldenPathwayPanel() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [showActivate, setShowActivate] = useState(false);
  const [form, setForm] = useState({ patientId: '', pathwayType: 'STEMI' });

  const { data } = useQuery({
    queryKey: ['golden-pathways'],
    queryFn: () => apiClient.get('/api/v1/emergency-pathways/active'),
    refetchInterval: pollMs('normal'),
  });
  const pathways = unwrap<Pathway[]>(data) ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ['golden-pathways'] });
  const activateMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/emergency-pathways', { patientId: form.patientId.trim(), pathwayType: form.pathwayType }),
    onSuccess: () => { invalidate(); setShowActivate(false); setForm({ patientId: '', pathwayType: 'STEMI' }); toast.success(tAttr('프로토콜 활성화')); },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || tAttr('활성화 실패')),
  });
  const milestoneMut = useMutation({
    mutationFn: ({ id, key }: { id: string; key: string }) => apiClient.patch(`/api/v1/emergency-pathways/${id}/milestone`, { key }),
    onSuccess: () => invalidate(),
  });
  const completeMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/emergency-pathways/${id}/complete`, {}),
    onSuccess: () => { invalidate(); toast.success(tAttr('프로토콜 완료')); },
  });

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-gray-900">⏱ <T k="골든타임 프로토콜" /> <span className="text-[11px] font-normal text-gray-400"><T k="STEMI·뇌졸중·패혈증" /></span></h2>
        <button onClick={() => setShowActivate(v => !v)} className="px-3 py-1.5 text-xs font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-700"><T k="활성화@버튼" /></button>
      </div>

      {showActivate && (
        <div className="flex flex-wrap items-center gap-2 mb-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
          <input value={form.patientId} onChange={e => setForm(f => ({ ...f, patientId: e.target.value }))} placeholder={tAttr('환자 ID(UUID)')}
            className="flex-1 min-w-[180px] px-3 py-2 border border-gray-200 rounded-lg text-xs" />
          <select value={form.pathwayType} onChange={e => setForm(f => ({ ...f, pathwayType: e.target.value }))} className="px-2 py-2 border border-gray-200 rounded-lg text-xs bg-white">
            {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{tAttr(v.label)}</option>)}
          </select>
          <button onClick={() => activateMut.mutate()} disabled={activateMut.isPending || !form.patientId.trim()}
            className="px-3 py-2 text-xs bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-40"><T k="시작" /></button>
        </div>
      )}

      {pathways.length === 0 ? <p className="text-xs text-gray-400 text-center py-4"><T k="활성 프로토콜 없음" /></p> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {pathways.map(pw => {
            const meta = TYPE_META[pw.pathwayType] ?? { label: pw.pathwayType, tone: 'bg-gray-600' };
            return (
              <div key={pw.id} className={`rounded-xl border p-3 ${pw.overTarget ? 'border-rose-300 bg-rose-50/40' : 'border-gray-100'}`}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full text-white whitespace-nowrap ${meta.tone}`}><T k={meta.label} /></span>
                    <Link href={`/patients/${pw.patientId}`} className="text-xs font-medium text-blue-700 hover:underline truncate">{pw.name}</Link>
                  </div>
                  <span className={`text-sm font-bold tabular-nums ${pw.overTarget ? 'text-rose-600' : pw.remaining <= 10 ? 'text-amber-600' : 'text-gray-800'}`}>
                    {pw.overTarget
                      ? <Tf k="+{시간} 초과" params={{ 시간: fmtMin(pw.elapsed - pw.targetMinutes) }} />
                      : <Tf k="{시간} 남음" params={{ 시간: fmtMin(pw.remaining) }} />}
                  </span>
                </div>
                <div className="text-[11px] text-gray-500 mb-2"><Tf k="{지표} 목표 {목표} · 경과 {경과} · {완료}/{전체}" params={{
                  지표: pw.primaryMetric, 목표: <>{pw.targetMinutes}<Unit>분</Unit></>, 경과: fmtMin(pw.elapsed), 완료: pw.doneCount, 전체: pw.total,
                }} /></div>
                <div className="space-y-1">
                  {pw.milestones.map(m => (
                    <button key={m.key} disabled={m.done} onClick={() => milestoneMut.mutate({ id: pw.id, key: m.key })}
                      className={`w-full flex items-center gap-2 text-[11px] px-2 py-1.5 rounded-lg border text-left ${m.done ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : m.overdue ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100' : 'bg-white border-gray-100 hover:bg-gray-50'}`}>
                      <span className="w-4 shrink-0">{m.done ? '✓' : m.overdue ? '⚠' : '○'}</span>
                      <span className="flex-1 truncate">{m.label}</span>
                      <span className="text-gray-400 whitespace-nowrap"><Tf k="목표 {목표}" params={{ 목표: <>{m.targetMin}<Unit>분</Unit></> }} /></span>
                    </button>
                  ))}
                </div>
                <button onClick={() => completeMut.mutate(pw.id)} className="w-full mt-2 py-1.5 text-[11px] font-medium bg-gray-800 text-white rounded-lg hover:bg-gray-900"><T k="프로토콜 완료" /></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
