'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { kdate } from '@/lib/ui-settings';
import { infectionTypeLabel, isolationLabel } from './infection-labels';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

const unwrap = <T,>(d: unknown): T => {
  const raw = (d as { data?: unknown })?.data;
  return (raw && typeof raw === 'object' && 'data' in (raw as object) ? (raw as { data: T }).data : raw) as T;
};

type RegTab = 'hai' | 'mdro' | 'notifiable';
interface Hai { id: string; haiType: string; organism?: string | null; deviceType?: string | null; deviceDays?: number | null; ward?: string | null; onsetAt: string; status: string; reportedToKonis: boolean }
interface Mdro { id: string; organism: string; mdroType: string; mechanism?: string | null; specimen?: string | null; ward?: string | null; detectedAt: string; isolationType?: string | null; active: boolean }
/**
 * 🔴 법정감염병 신고는 질병관리청으로 **나가지 않는다**(연동 미구축) — 화면 실사용 점검 W7.
 * 종전 화면은 초록 '신고완료' 배지와 `KCDC-…` 접수번호를 보여줘, 미신고(감염병예방법 §11)를
 * 이행으로 읽히게 했다. 이제 서버가 건별 `transmission`(전송 사실)을 함께 주고,
 * 화면은 그 판정만 말한다 — 저장된 status 를 곧바로 '신고완료'로 번역하지 않는다.
 */
interface NdrTransmission { state: 'DRAFT' | 'LOCAL_ONLY' | 'SEND_FAILED' | 'UNVERIFIED' | 'SENT'; transmitted: boolean; label: string; note: string; channel: string }
interface Ndr { id: string; diseaseName: string; diseaseGrade?: string | null; status: string; reportRef?: string | null; createdAt: string; transmission?: NdrTransmission }

/** 🔴 라벨표 2벌이었다(상단 감염감시 표=영문 raw) → 화면 공통 정본 infection-labels 로 수렴 */
const HAI_LABEL = (code: string) => infectionTypeLabel(code);
const MDRO_TONE: Record<string, string> = { MRSA: 'bg-orange-100 text-orange-700', VRE: 'bg-amber-100 text-amber-700', CRE: 'bg-rose-100 text-rose-700', CRAB: 'bg-red-100 text-red-700', CPE: 'bg-red-100 text-red-700' };
/** 전송 사실별 배지 — 초록(신고완료)은 **기관 접수 근거가 있을 때만** 쓴다 */
const NDR_TX: Record<NdrTransmission['state'], { c: string }> = {
  DRAFT: { c: 'bg-gray-100 text-gray-600' },
  LOCAL_ONLY: { c: 'bg-amber-100 text-amber-800' },
  SEND_FAILED: { c: 'bg-red-100 text-red-700' },
  UNVERIFIED: { c: 'bg-amber-100 text-amber-800' },
  SENT: { c: 'bg-emerald-100 text-emerald-700' },
};
/** 서버가 transmission 을 주지 않는 구버전 응답용 폴백 — 전송 근거가 없으므로 '신고완료'라 하지 않는다 */
const NDR_STATUS_FALLBACK: Record<string, string> = { DRAFT: '작성중', SUBMITTED: '전송 근거 없음', LOCAL_RECORDED: '원내 접수(미전송)', SEND_FAILED: '전송 실패', ACKNOWLEDGED: '전송 근거 없음', REJECTED: '반려' };

export default function InfectionRegistry() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const [tab, setTab] = useState<RegTab>('hai');
  const base = '/api/v1/infection-control';

  const hai = useQuery({ queryKey: ['hai-cases'], queryFn: () => apiClient.get(`${base}/hai-cases`), enabled: tab === 'hai' });
  const haiStats = useQuery({ queryKey: ['hai-stats'], queryFn: () => apiClient.get(`${base}/hai-cases/stats`), enabled: tab === 'hai' });
  const mdro = useQuery({ queryKey: ['mdro'], queryFn: () => apiClient.get(`${base}/mdro`), enabled: tab === 'mdro' });
  const ndr = useQuery({ queryKey: ['ndr'], queryFn: () => apiClient.get(`${base}/notifiable`), enabled: tab === 'notifiable' });

  const haiList = unwrap<Hai[]>(hai.data) ?? [];
  const hs = unwrap<{ active: number; konisPending: number; konisPendingResolved?: number; konisChannelImplemented?: boolean; byType: { haiType: string; count: number }[] }>(haiStats.data);
  const mdroList = unwrap<Mdro[]>(mdro.data) ?? [];
  const ndrList = unwrap<Ndr[]>(ndr.data) ?? [];

  // 🔴 종결은 종결일 뿐 — KONIS 로 보내는 코드가 없으므로 "KONIS 보고"라고 말하지 않는다.
  //    (종전: reportedToKonis:true 를 보내 미보고 케이스를 보고완료로 적고 토스트도 그렇게 말했다.)
  const resolveHai = useMutation({
    mutationFn: (id: string) => apiClient.put(`${base}/hai-cases/${id}/resolve`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hai-cases'] }); qc.invalidateQueries({ queryKey: ['hai-stats'] }); toast.success(tAttr('HAI 케이스 종결 — KONIS 보고는 별도(수기)')); },
  });
  const clearMdro = useMutation({ mutationFn: (id: string) => apiClient.put(`${base}/mdro/${id}/clear`, {}), onSuccess: () => { qc.invalidateQueries({ queryKey: ['mdro'] }); toast.success(tAttr('MDRO 음전')); } });
  const submitNdr = useMutation({
    mutationFn: (id: string) => apiClient.put<{ data?: { transmission?: NdrTransmission }; meta?: { transmission?: NdrTransmission } }>(`${base}/notifiable/${id}/submit`, {}),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['ndr'] });
      const tx = res?.meta?.transmission ?? res?.data?.transmission;
      if (tx?.transmitted) toast.success(tAttr('질병관리청 신고 접수 완료'));
      // 🔴 `tx.note` 는 서버가 조립한 판정문이다 — 번역하지 않고 보간으로만 끼운다
      else toast.warning(tfAttr('원내 접수만 완료 — {사유}', { 사유: tx?.note ?? tAttr('질병관리청으로 전송되지 않았습니다 — 감염병 웹신고로 수기 신고하십시오') }));
    },
  });

  const badge = (c: string) => `text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${c}`;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
      <div className="flex items-center gap-1 mb-4 bg-gray-100/80 p-1 rounded-xl w-fit">
        {([['hai', 'HAI 감염관리'], ['mdro', 'MDRO 레지스트리'], ['notifiable', '법정감염병 신고']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 text-sm font-medium rounded-lg ${tab === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><T k={l} /></button>
        ))}
      </div>

      {tab === 'hai' && (
        <div>
          {hs && (
            <div className="flex flex-wrap gap-2 mb-3 text-xs">
              {/* 🔴 상단 배지 '활성 N'(감염감시)과 세는 대상이 다르다 — 무엇을 세는지 밝힌다 */}
              <Tf className={badge('bg-rose-100 text-rose-700')} k="HAI 케이스 활성 {건수}" params={{ 건수: hs.active }} />
              {/* 🔴 종전엔 활성 케이스만 세어, 종결 버튼을 누르는 순간 미보고인 채로 지표에서 사라졌다 */}
              <span className={badge('bg-amber-100 text-amber-700')}>
                <Tf k="KONIS 미보고 {건수}" params={{ 건수: hs.konisPending }} />
                {hs.konisPendingResolved ? <>{' '}<Tf k="(종결분 {건수})" params={{ 건수: hs.konisPendingResolved }} /></> : ''}
              </span>
              {hs.byType?.map(t => <span key={t.haiType} className={badge('bg-gray-100 text-gray-600')}><T k={HAI_LABEL(t.haiType)} /> {t.count}</span>)}
            </div>
          )}
          {hs?.konisChannelImplemented === false && (
            <p className="text-[11px] text-amber-700 mb-2">⚠ <T k="KONIS 자동 전송 연동이 없습니다 — 종결해도 보고되지 않으며, KONIS 웹에서 수기 보고해야 합니다." /></p>
          )}
          {haiList.length === 0 ? <p className="text-xs text-gray-400 py-4 text-center"><T k="HAI 케이스 없음" /></p> : (
            <div className="space-y-1.5">
              {haiList.map(c => (
                <div key={c.id} className="flex items-center gap-2 text-xs border border-gray-100 rounded-lg px-3 py-2">
                  <span className={badge(c.status === 'ACTIVE' ? 'bg-rose-100 text-rose-700' : 'bg-gray-100 text-gray-500')}><T k={HAI_LABEL(c.haiType)} /></span>
                  <span className="text-gray-700 truncate">{c.organism ?? '-'}{c.deviceDays != null ? <>{' · '}<Tf k="기구 {일수}일" params={{ 일수: c.deviceDays }} /></> : ''}{c.ward ? ` · ${c.ward}` : ''}</span>
                  {!c.reportedToKonis && <span className={badge('bg-amber-50 text-amber-600')}><T k="KONIS 미보고" /></span>}
                  <span className="ml-auto text-gray-400">{kdate(new Date(c.onsetAt))}</span>
                  {c.status === 'ACTIVE' && <button onClick={() => resolveHai.mutate(c.id)} className="px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700"><T k="종결" /></button>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'mdro' && (
        <div>
          {mdroList.length === 0 ? <p className="text-xs text-gray-400 py-4 text-center"><T k="활성 MDRO 없음" /></p> : (
            <div className="space-y-1.5">
              {mdroList.map(m => (
                <div key={m.id} className="flex items-center gap-2 text-xs border border-gray-100 rounded-lg px-3 py-2">
                  <span className={badge(MDRO_TONE[m.mdroType] ?? 'bg-gray-100 text-gray-600')}>{m.mdroType}</span>
                  <span className="text-gray-700 truncate">{m.organism}{m.mechanism ? ` (${m.mechanism})` : ''}{m.specimen ? ` · ${m.specimen}` : ''}{m.ward ? ` · ${m.ward}` : ''}</span>
                  {m.isolationType && <span className={badge('bg-purple-50 text-purple-600')}><T k={isolationLabel(m.isolationType)} /></span>}
                  <span className="ml-auto text-gray-400">{kdate(new Date(m.detectedAt))}</span>
                  <button onClick={() => clearMdro.mutate(m.id)} className="px-2 py-1 rounded bg-gray-600 text-white hover:bg-gray-700"><T k="음전" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'notifiable' && (
        <div>
          {ndrList.length === 0 ? <p className="text-xs text-gray-400 py-4 text-center"><T k="신고 없음" /></p> : (
            <div className="space-y-1.5">
              {ndrList.map(n => {
                const tx = n.transmission;
                // 🔴 `tx.label` 은 서버 판정문이다 — 번역 대상이 아니고, 없을 때의 원내 폴백만 번역한다
                const serverLabel = tx?.label;
                const label = serverLabel ?? NDR_STATUS_FALLBACK[n.status] ?? n.status;
                const tone = NDR_TX[tx?.state ?? 'UNVERIFIED']?.c ?? 'bg-gray-100 text-gray-500';
                // 전송되지 않은 건은 다시 시도할 수 있어야 한다(영구 미신고 방지).
                const canSubmit = !tx?.transmitted;
                return (
                  <div key={n.id} className="border border-gray-100 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 text-xs">
                      {n.diseaseGrade && <Tf className={badge('bg-indigo-100 text-indigo-700')} k="{등급}급" params={{ 등급: n.diseaseGrade }} />}
                      <span className="font-medium text-gray-800">{n.diseaseName}</span>
                      <span className={badge(tone)}>{serverLabel ? label : <T k={label} />}</span>
                      {n.reportRef && (
                        <span className="text-gray-400">
                          {n.reportRef}
                          {!tx?.transmitted && <span className="text-amber-600 ml-1"><T k="(원내 번호)" /></span>}
                        </span>
                      )}
                      <span className="ml-auto text-gray-400">{kdate(new Date(n.createdAt))}</span>
                      {canSubmit && <button onClick={() => submitNdr.mutate(n.id)} className="px-2 py-1 rounded bg-rose-600 text-white hover:bg-rose-700"><T k={n.status === 'DRAFT' ? '신고 제출' : '재제출'} /></button>}
                    </div>
                    {tx && !tx.transmitted && n.status !== 'DRAFT' && (
                      <p className="mt-1 text-[11px] text-amber-700">⚠ {tx.note}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
