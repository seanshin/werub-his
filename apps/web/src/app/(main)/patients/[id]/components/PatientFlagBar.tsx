'use client';
import { ReasonInput } from '@/components/ui/ReasonInput';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Staff { id: string; familyName: string; givenName: string; role: string; department?: string }
interface FlagItem { id: string; reason?: string; relation?: string; flagger?: Staff | null; related?: Staff | null }
interface FlagSummary { rubyCount: number; malicious: FlagItem[]; vip: FlagItem[]; acquaintance: FlagItem[] }

const name = (u?: Staff | null) => u ? `${u.familyName}${u.givenName}` : '-';

export function PatientFlagBar({ patientId }: { patientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data, isError: flagsIsError, error: flagsError, refetch: refetchFlags } = useQuery({ queryKey: ['pflags', patientId], queryFn: () => apiClient.get<{ data: FlagSummary }>(`/api/v1/patient-flags/${patientId}`) });
  const s = (data?.data as { data?: FlagSummary })?.data ?? (data?.data as FlagSummary | null);
  const { data: mineData, isError: mineIsError, error: mineError, refetch: refetchMine } = useQuery({ queryKey: ['pflags-mine', patientId], queryFn: () => apiClient.get<{ data: string[] }>(`/api/v1/patient-flags/${patientId}/mine`) });
  const mine = ((mineData?.data as { data?: string[] })?.data ?? mineData?.data ?? []) as string[];

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['pflags', patientId] }); qc.invalidateQueries({ queryKey: ['pflags-mine', patientId] }); };
  const flagMut = useMutation({ mutationFn: (body: any) => apiClient.post('/api/v1/patient-flags', { patientId, ...body }), onSuccess: () => { invalidate(); toast.success('마킹되었습니다'); }, onError: (e: any) => toast.error(e?.message || '마킹 실패') });
  const unflagMut = useMutation({ mutationFn: (type: string) => apiClient.del(`/api/v1/patient-flags/${patientId}/${type}`), onSuccess: () => { invalidate(); toast.success('마킹 해제됨'); } });

  return (
    <span className="relative inline-flex items-center gap-1.5">
      {/* 🔴 마킹(루비·VIP·지인) 조회 실패 — 배지가 안 뜨는 것을 "마킹 없음"으로 읽히게 두지 않는다 */}
      {(flagsIsError || mineIsError) && (
        <QueryErrorFallback
          error={flagsIsError ? flagsError : mineError}
          onRetry={() => { if (flagsIsError) refetchFlags(); if (mineIsError) refetchMine(); }}
          size="compact"
        />
      )}
      {/* 배지 */}
      {!!s?.rubyCount && (
        <span title={s.malicious.map(m => `${name(m.flagger)}: ${m.reason ?? '주의'}`).join('\n')} className="text-xs font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-300 whitespace-nowrap">💎 루비 {s.rubyCount}</span>
      )}
      {!!s?.vip?.length && (
        <span title={s.vip.map(v => `${name(v.related)}의 VIP`).join('\n')} className="text-amber-400 text-sm leading-none">⭐</span>
      )}
      {!!s?.acquaintance?.length && (
        <span title={s.acquaintance.map(a => `${name(a.related)}의 ${a.relation ?? '지인'}`).join('\n')} className="text-xs font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-300 whitespace-nowrap">👥 지인 {s.acquaintance.length}</span>
      )}

      <button onClick={() => setOpen(v => !v)} className="text-[11px] px-2 py-0.5 rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50 whitespace-nowrap"><T k="마킹 ▾" /></button>

      {open && <FlagPopover patientId={patientId} mine={mine} summary={s} onClose={() => setOpen(false)} onFlag={(b) => flagMut.mutate(b)} onUnflag={(t) => unflagMut.mutate(t)} />}
    </span>
  );
}

function FlagPopover({ mine, summary, onClose, onFlag, onUnflag }: { patientId: string; mine: string[]; summary: FlagSummary | null; onClose: () => void; onFlag: (b: any) => void; onUnflag: (t: string) => void }) {
  const tAttr = useTAttr();
  const { data, isError, error, refetch } = useQuery({ queryKey: ['pflag-staff'], queryFn: () => apiClient.get<{ data: Staff[] }>('/api/v1/users') });
  const staff = ((data?.data as { data?: Staff[] })?.data ?? data?.data ?? []) as Staff[];
  const [reason, setReason] = useState('');
  const [vipWho, setVipWho] = useState('');
  const [acqWho, setAcqWho] = useState('');
  const [acqRel, setAcqRel] = useState('FAMILY');
  const markedRuby = mine.includes('MALICIOUS');

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute top-7 left-0 z-50 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 p-4 space-y-3" onClick={e => e.stopPropagation()}>
        {/* 직원 목록 조회 실패 — VIP/지인 선택지가 비어 보이는 것을 "직원 없음"으로 말하지 않는다 */}
        {isError && <QueryErrorFallback error={error} onRetry={refetch} size="compact" />}
        {/* 악성(루비) */}
        <div className="space-y-1.5">
          <p className="text-xs font-bold text-rose-700"><T k="💎 악성/주의 환자(루비)" /></p>
          <p className="text-[10px] text-gray-400">누구나 표시 가능. 표시한 직원 수가 카운트됩니다. (현재 {summary?.rubyCount ?? 0})</p>
          {markedRuby ? (
            <button onClick={() => onUnflag('MALICIOUS')} className="w-full py-1.5 text-xs border border-rose-200 text-rose-600 rounded-lg"><T k="내 루비 표시 해제" /></button>
          ) : (
            <div className="flex gap-1.5">
              <div className="flex-1"><ReasonInput domain="patientFlag" maxLength={1000} value={reason} onChange={setReason} placeholder={tAttr("사유(선택)")} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs" /></div>
              <button onClick={() => onFlag({ flagType: 'MALICIOUS', reason })} className="px-3 bg-rose-600 text-white text-xs rounded-lg whitespace-nowrap"><T k="루비 표시" /></button>
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 pt-3 space-y-1.5">
          <p className="text-xs font-bold text-amber-700"><T k="⭐ VIP (누구의 VIP인지)" /></p>
          <div className="flex gap-1.5">
            <select value={vipWho} onChange={e => setVipWho(e.target.value)} className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white"><option value=""><T k="직원 선택" /></option>{staff.map(u => <option key={u.id} value={u.id}>{name(u)}</option>)}</select>
            <button onClick={() => vipWho && onFlag({ flagType: 'VIP', relatedUserId: vipWho })} disabled={!vipWho} className="px-3 bg-amber-500 text-white text-xs rounded-lg disabled:opacity-40 whitespace-nowrap">VIP</button>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-3 space-y-1.5">
          <p className="text-xs font-bold text-purple-700"><T k="👥 직원 지인/가족 (누구의 지인인지)" /></p>
          <div className="flex gap-1.5">
            <select value={acqWho} onChange={e => setAcqWho(e.target.value)} className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white"><option value=""><T k="직원 선택" /></option>{staff.map(u => <option key={u.id} value={u.id}>{name(u)}</option>)}</select>
            <select value={acqRel} onChange={e => setAcqRel(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white"><option value="FAMILY"><T k="가족" /></option><option value="FRIEND"><T k="지인" /></option><option value="ACQUAINTANCE"><T k="관계인" /></option></select>
            <button onClick={() => acqWho && onFlag({ flagType: 'ACQUAINTANCE', relatedUserId: acqWho, relation: acqRel })} disabled={!acqWho} className="px-3 bg-purple-600 text-white text-xs rounded-lg disabled:opacity-40 whitespace-nowrap"><T k="표시" /></button>
          </div>
        </div>
      </div>
    </>
  );
}
