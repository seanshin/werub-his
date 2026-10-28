'use client';

import { useState } from 'react';
import { Unit, useDurationText } from '@/components/ui/display';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import PatientSelector from '@/components/ui/PatientSelector';
import { toast } from '@/stores/toast-store';
import { pollMs } from '@/lib/ui-settings';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { deliveredAtIso, motherBabyVerifyOutcome } from '@/lib/obgyn-delivery';
import { buildPartograph, type LaborProgressRow } from '@/lib/partograph';
import { kdate } from '@/lib/ui-settings';

const unwrap = <T,>(d: unknown): T => {
  const raw = (d as { data?: unknown })?.data;
  return (raw && typeof raw === 'object' && 'data' in (raw as object) ? (raw as { data: T }).data : raw) as T;
};

/** `bandsRegistered` = 신생아·산모 식별밴드가 **둘 다** 등록됨. 번호 자체는 서버가 내려보내지 않는다. */
interface Newborn { id: string; sex: string; apgar1?: number | null; apgar5?: number | null; nicuAdmission: boolean; bandsRegistered?: boolean }
interface Progress { cervicalDilation?: number | null; station?: number | null; fetalHeartRate?: number | null; recordedAt: string }
interface Delivery {
  id: string; patientId: string; name: string; mrn: string; status: string;
  gestationalWeeks?: string | null; deliveryType?: string | null; laborMins?: number | null;
  newborns: Newborn[]; latestProgress?: Progress | null;
}
interface Board { summary: { inLabor: number; delivered: number; postpartum: number; todayDelivered: number }; items: Delivery[] }

const STATUS_META: Record<string, { label: string; cls: string }> = {
  IN_LABOR: { label: '진통중', cls: 'bg-rose-100 text-rose-700' },
  DELIVERED: { label: '분만완료', cls: 'bg-emerald-100 text-emerald-700' },
  POSTPARTUM: { label: '산욕', cls: 'bg-sky-100 text-sky-700' },
};
const DTYPE: Record<string, string> = { VAGINAL: '질식분만', VACUUM: '흡입분만', FORCEPS: '겸자분만', CESAREAN: '제왕절개' };
// 표시 정본은 `useDurationText()` — 분만 진행시간이 하루를 넘을 수 있고, 단위어는 UI 언어를 따른다

export default function DeliveryBoard() {
  const fmtMin = useDurationText();
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const [showStart, setShowStart] = useState(false);
  const [startForm, setStartForm] = useState({ patientId: '', gestationalWeeks: '' });
  const [expanded, setExpanded] = useState<string | null>(null);

  // 🔴 종전엔 `isError` 를 꺼내지 않아 **조회 실패가 "분만 없음"** 이 됐다:
  //    요약 4타일이 `?? 0` 으로 전부 0, 목록이 "진행 중 분만 없음". 분만장에서 조회 장애 = 분만 없음이었다.
  //    같은 페이지의 다른 표들은 전부 QueryErrorFallback 을 쓴다 — 한 화면 안에서 정본이 갈려 있었다.
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ld-board'],
    queryFn: () => apiClient.get('/api/v1/obgyn/deliveries/board'),
    refetchInterval: pollMs('normal'),
  });
  const board = unwrap<Board>(data);
  const items = board?.items ?? [];
  const s = board?.summary;

  const inv = () => qc.invalidateQueries({ queryKey: ['ld-board'] });
  const startMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/obgyn/deliveries', { patientId: startForm.patientId.trim(), gestationalWeeks: startForm.gestationalWeeks.trim() || undefined }),
    onSuccess: () => { inv(); setShowStart(false); setStartForm({ patientId: '', gestationalWeeks: '' }); toast.success(tAttr('분만 개시')); },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || tAttr('실패')),
  });
  // 🔴 `onError` 없이 두면 React Query 는 오류를 뮤테이션 상태에만 담는다 —
  //    "분만 완료"·신생아(Apgar·체중·NICU) 기록이 실패해도 **토스트도 화면 변화도 없었다**(법정 기록이다).
  // 서버 사유(message)는 번역하지 않는다 — 서버가 조립한 문장이다
  const mutErr = (what: string) => (e: unknown) => toast.error(tfAttr('{항목} 저장 실패 — {사유}', { 항목: tAttr(what), 사유: (e as { message?: string })?.message || tAttr('알 수 없는 오류') }));
  const progressMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, number | string> }) => apiClient.post(`/api/v1/obgyn/deliveries/${id}/progress`, body),
    onSuccess: () => { inv(); toast.success(tAttr('진행 기록')); },
    onError: mutErr('분만 진행'),
  });
  const deliverMut = useMutation({
    mutationFn: ({ id, deliveryType, deliveredAt }: { id: string; deliveryType: string; deliveredAt: string }) => apiClient.patch(`/api/v1/obgyn/deliveries/${id}`, { deliveryType, deliveredAt }),
    onSuccess: () => { inv(); toast.success(tAttr('분만 완료')); },
    onError: mutErr('분만 완료'),
  });
  const newbornMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => apiClient.post(`/api/v1/obgyn/deliveries/${id}/newborn`, body),
    onSuccess: () => { inv(); toast.success(tAttr('신생아 기록')); },
    onError: mutErr('신생아 기록'),
  });

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-gray-900">🤰 <T k="분만장 보드 (L&D)" /></h2>
        <button onClick={() => setShowStart(v => !v)} className="px-3 py-1.5 text-xs font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-700"><T k="분만 개시" /></button>
      </div>
      {isError ? (
        <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" className="mb-3" />
      ) : (
      <div className="grid grid-cols-4 gap-2 mb-3">
        {[['진통중', s?.inLabor], ['분만완료', s?.delivered], ['산욕', s?.postpartum], ['오늘 분만', s?.todayDelivered]].map(([l, v]) => (
          <div key={l as string} className="rounded-xl border border-gray-100 p-2.5 text-center">
            {/* 아직 안 온 것(로딩)과 0건은 다른 사실이다 — 로딩 중에 0 을 단정하지 않는다 */}
            <div className="text-xl font-bold text-gray-900">{typeof v === 'number' ? v : <span className="text-gray-300">…</span>}</div>
            <div className="text-[11px] text-gray-500"><T k={l as string} /></div>
          </div>
        ))}
      </div>
      )}

      {showStart && (
        <div className="flex flex-wrap items-center gap-2 mb-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
          {/* 환자는 검색해 고른다(2026-10-10 — 종전 UUID 직접 입력칸) */}
          <div className="flex-1 min-w-[220px]" data-delivery-patient-picker><PatientSelector value={startForm.patientId} onChange={(id) => setStartForm(f => ({ ...f, patientId: id }))} context="admission" /></div>
          <input value={startForm.gestationalWeeks} onChange={e => setStartForm(f => ({ ...f, gestationalWeeks: e.target.value }))} placeholder={tAttr('재태주수 예 39+2')} className="w-32 px-3 py-2 border border-gray-200 rounded-lg text-xs" />
          <button onClick={() => startMut.mutate()} disabled={startMut.isPending || !startForm.patientId.trim()} className="px-3 py-2 text-xs bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-40"><T k="개시" /></button>
        </div>
      )}

      {isError ? null
        : isLoading ? <p className="text-xs text-gray-400 text-center py-4"><T k="분만 현황 불러오는 중…" /></p>
        : items.length === 0 ? <p className="text-xs text-gray-400 text-center py-4"><T k="진행 중 분만 없음" /></p> : (
        <div className="space-y-2">
          {items.map(d => (
            <div key={d.id} className={`rounded-xl border p-3 ${d.status === 'IN_LABOR' ? 'border-rose-200 bg-rose-50/30' : 'border-gray-100'}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_META[d.status]?.cls ?? 'bg-gray-100 text-gray-600'}`}><T k={STATUS_META[d.status]?.label ?? d.status} /></span>
                  <Link href={`/patients/${d.patientId}`} className="text-sm font-medium text-blue-700 hover:underline">{d.name}</Link>
                  {d.gestationalWeeks && <span className="text-[11px] text-gray-500">{d.gestationalWeeks}<Unit>주</Unit></span>}
                  {d.deliveryType && <span className="text-[11px] text-emerald-600"><T k={DTYPE[d.deliveryType] ?? d.deliveryType} /></span>}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-gray-500">
                  {d.status === 'IN_LABOR' && <span><Tf k="진통 {시간}" params={{ 시간: fmtMin(d.laborMins) }} /></span>}
                  {d.latestProgress && <span className="text-rose-600"><Tf k="개대 {개대} · FHR {심박}" params={{ 개대: <>{d.latestProgress.cervicalDilation ?? '-'}<Unit>cm</Unit></>, 심박: d.latestProgress.fetalHeartRate ?? '-' }} /></span>}
                  <button onClick={() => setExpanded(expanded === d.id ? null : d.id)} className="text-blue-600 hover:underline"><T k={expanded === d.id ? '닫기' : '기록@버튼'} /></button>
                </div>
              </div>
              {d.newborns.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {d.newborns.map(n => (
                    <span key={n.id} className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                      <T k={n.sex === 'M' ? '남' : n.sex === 'F' ? '여' : '?'} /> · Apgar {n.apgar1 ?? '-'}/{n.apgar5 ?? '-'}{n.nicuAdmission ? ' · NICU' : ''}
                    </span>
                  ))}
                  {/* 🔴 밴드가 등록되지 않은 신생아가 있으면 그 사실을 말한다 — 대조할 것이 없다는 뜻이다 */}
                  {d.newborns.some(n => n.bandsRegistered === false) && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                      <T k="식별밴드 미등록 — 모아 대조 불가" />
                    </span>
                  )}
                </div>
              )}
              {expanded === d.id && (
                <div className="mt-2 pt-2 border-t border-gray-100 space-y-2">
                  <LaborPartograph deliveryId={d.id} />
                  {d.status === 'IN_LABOR' && (
                    <ProgressForm onSubmit={(body) => progressMut.mutateAsync({ id: d.id, body })} />
                  )}
                  {d.status === 'IN_LABOR' && (
                    <DeliverForm pending={deliverMut.isPending} onSubmit={(deliveryType, deliveredAt) => deliverMut.mutate({ id: d.id, deliveryType, deliveredAt })} />
                  )}
                  {d.status !== 'IN_LABOR' && (
                    <NewbornForm onSubmit={(body) => newbornMut.mutateAsync({ id: d.id, body })} />
                  )}
                  {/* 수유·투약 전 모아 식별밴드 대조(신생아 오인 방지) */}
                  {d.newborns.length > 0 && (
                    <div className="pt-2 border-t border-gray-100 space-y-1.5">
                      <p className="text-[11px] font-semibold text-purple-800"><T k="수유·투약 전 모아 식별밴드 대조" /></p>
                      {d.newborns.map(n => (
                        <div key={n.id} className="flex flex-wrap items-end gap-2">
                          <span className="text-[11px] text-gray-500 pb-1.5"><T k={n.sex === 'M' ? '남아' : n.sex === 'F' ? '여아' : '신생아'} /></span>
                          <MotherBabyMatch newborn={n} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 분만 완료 — 방식·시각을 고르고 확인한다(2026-10-07). 종전엔 방식 버튼 한 번이 누른 시각을 분만 시각으로 박았다.
 */
function DeliverForm({ onSubmit, pending }: { onSubmit: (deliveryType: string, deliveredAtIso: string) => void; pending: boolean }) {
  const tAttr = useTAttr();
  const [type, setType] = useState('');
  const [at, setAt] = useState('');
  const checked = deliveredAtIso(at);
  return (
    <div className="flex flex-wrap items-end gap-1.5" data-deliver-form>
      <span className="pb-1.5 text-[11px] text-gray-500"><T k="분만 완료:" /></span>
      <select value={type} onChange={(e) => setType(e.target.value)} aria-label={tAttr('분만 방식')} className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[11px]">
        <option value="">{tAttr('— 방식 선택 —')}</option>
        {Object.entries(DTYPE).map(([k, v]) => <option key={k} value={k}>{tAttr(v)}</option>)}
      </select>
      <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-label={tAttr('분만 시각')} data-delivered-at className="rounded-lg border border-gray-200 px-2 py-1.5 text-[11px]" />
      {!checked.ok && checked.reason === 'FUTURE' && <span className="pb-1.5 text-[10px] text-red-600"><T k="미래 시각은 기록할 수 없습니다" /></span>}
      <button type="button" disabled={!type || !checked.ok || pending} data-deliver-confirm
        onClick={() => { if (type && checked.ok) onSubmit(type, checked.iso); }}
        className="min-h-[36px] rounded-lg bg-emerald-600 px-3 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"><T k="분만 완료 기록" /></button>
    </div>
  );
}

/**
 * 파토그래프(2026-10-10) — 분만 상세 EP 의 진행 원장 전체를 시간 축으로. 종전엔 화면이 최신 1건만 보여 진행 추세를 볼 곳이 없었다.
 * 🔴 경고선·행동선은 그리지 않는다(원내 기준 미정 — 표준선을 원내 판정처럼 겹치지 않는다).
 * 쿼리 키가 ['ld-board', …] 아래라 진행 기록 저장 후 보드와 함께 새로 읽힌다.
 */
export function LaborPartograph({ deliveryId }: { deliveryId: string }) {
  const tAttr = useTAttr();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ld-board', 'detail', deliveryId],
    queryFn: () => apiClient.get(`/api/v1/obgyn/deliveries/${deliveryId}`),
  });
  if (isError) return <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />;
  if (isLoading) return <p className="text-[11px] text-gray-400"><T k="파토그래프 불러오는 중…" /></p>;
  const detail = unwrap<{ laborOnsetAt?: string | null; laborProgress?: LaborProgressRow[] }>(data);
  const g = buildPartograph(detail?.laborProgress ?? [], detail?.laborOnsetAt);
  if (!g.points.length) return <p className="text-[11px] text-gray-400" data-partograph="EMPTY"><T k="분만 진행 기록이 없어 파토그래프를 그릴 수 없습니다" /></p>;
  const W = 320, H = 140, L = 28, B = 18;
  const x = (h: number) => L + (h / g.spanH) * (W - L - 6);
  const y = (cm: number) => 6 + ((10 - cm) / 10) * (H - B - 6);
  const dil = g.points.filter((p) => p.dilation != null);
  return (
    <div className="rounded-lg border border-rose-100 bg-white p-2" data-partograph="DRAWN">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold text-rose-800"><T k="파토그래프 — 자궁경부 개대(cm)" /></p>
        <p className="text-[10px] text-gray-500">
          <T k={g.origin === 'LABOR_ONSET' ? '0시 = 진통 시작' : '0시 = 첫 진행 기록(진통 시작 시각 미기록)'} />
          {g.originAt && <> · {kdate(g.originAt, 'datetime')}</>}
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[480px]" role="img" aria-label={tAttr('파토그래프 — 자궁경부 개대(cm)')}>
        {[0, 2, 4, 6, 8, 10].map((cm) => (
          <g key={cm}>
            <line x1={L} x2={W - 6} y1={y(cm)} y2={y(cm)} stroke="#f1f5f9" />
            <text x={L - 4} y={y(cm) + 3} fontSize="8" textAnchor="end" fill="#94a3b8">{cm}</text>
          </g>
        ))}
        {Array.from({ length: Math.floor(g.spanH / 2) + 1 }, (_, i) => i * 2).map((h) => (
          <text key={h} x={x(h)} y={H - 4} fontSize="8" textAnchor="middle" fill="#94a3b8">{h}h</text>
        ))}
        {dil.length > 1 && <polyline fill="none" stroke="#e11d48" strokeWidth="1.5" points={dil.map((p) => `${x(p.h)},${y(p.dilation as number)}`).join(' ')} />}
        {dil.map((p) => <circle key={p.at} cx={x(p.h)} cy={y(p.dilation as number)} r="2.5" fill="#e11d48"><title>{`${kdate(p.at, 'datetime')} · ${p.dilation}cm`}</title></circle>)}
      </svg>
      {dil.length === 0 && <p className="text-[10px] text-amber-700"><T k="개대가 기록된 진행 기록이 없습니다 — 선을 그리지 않았습니다" /></p>}
      {/* 같은 시간축의 태아심박·자궁수축(2026-10-10) — 기록된 점만 · 🔴 정상 범위 띠는 그리지 않는다(판정은 서버 태아곤란 경보) */}
      <PartographStrip label="FHR (bpm)" points={g.points.map((p) => ({ h: p.h, at: p.at, v: p.fhr }))} spanH={g.spanH} kind="line" />
      <PartographStrip label={tAttr('수축/10min')} points={g.points.map((p) => ({ h: p.h, at: p.at, v: p.contractions }))} spanH={g.spanH} kind="bar" />
      <table className="mt-1 w-full text-[10px]">
        <thead><tr className="text-gray-400"><th className="text-left font-normal"><T k="시각" /></th><th className="font-normal"><T k="개대(cm)" /></th><th className="font-normal"><T k="하강도" /></th><th className="font-normal">FHR</th><th className="font-normal"><T k="수축/10min" /></th></tr></thead>
        <tbody>
          {g.points.map((p) => (
            <tr key={p.at} className="text-center text-gray-700">
              <td className="text-left">{kdate(p.at, 'datetime')}</td>
              <td>{p.dilation ?? '—'}</td>
              <td>{p.station ?? '—'}</td>
              {/* 태아 심박 이상 판정은 서버(태아곤란 경보)가 한다 — 화면이 기준 숫자를 따로 두지 않는다 */}
              <td>{p.fhr ?? '—'}</td>
              <td>{p.contractions ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-gray-500"><T k="경고선·행동선은 원내 기준이 정해지지 않아 그리지 않습니다" /></p>
    </div>
  );
}

/** 파토그래프 보조 띠 — 같은 시간축 · 기록된 값만(미측정은 점·막대 없음) · 축 범위는 기록된 값으로(정상 범위를 지어 그리지 않는다) */
function PartographStrip({ label, points, spanH, kind }: { label: string; points: Array<{ h: number; at: string; v: number | null }>; spanH: number; kind: 'line' | 'bar' }) {
  const pts = points.filter((p) => p.v != null) as Array<{ h: number; at: string; v: number }>;
  if (pts.length === 0) return null;
  const W = 320, H = 44, L = 28;
  const x = (h: number) => L + (h / spanH) * (W - L - 6);
  const vmin = kind === 'bar' ? 0 : Math.min(...pts.map((p) => p.v));
  const vmax = Math.max(...pts.map((p) => p.v));
  const y = (v: number) => 4 + (1 - (v - vmin) / (vmax - vmin || 1)) * (H - 10);
  return (
    <div data-partograph-strip={kind}>
      <p className="mt-1 text-[10px] text-gray-500">{label} <span className="text-gray-400">({vmin}–{vmax})</span></p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[480px]" role="img" aria-label={label}>
        {kind === 'line' && pts.length > 1 && <polyline fill="none" stroke="#0ea5e9" strokeWidth="1.2" points={pts.map((p) => `${x(p.h)},${y(p.v)}`).join(' ')} />}
        {pts.map((p) => kind === 'line'
          ? <circle key={p.at} cx={x(p.h)} cy={y(p.v)} r="2" fill="#0ea5e9"><title>{`${kdate(p.at, 'datetime')} · ${p.v}`}</title></circle>
          : <rect key={p.at} x={x(p.h) - 2.5} y={y(p.v)} width="5" height={Math.max(1, H - 6 - y(p.v))} fill="#a78bfa"><title>{`${kdate(p.at, 'datetime')} · ${p.v}`}</title></rect>)}
      </svg>
    </div>
  );
}

/**
 * 분만 진행 기록 — 🔴 (2026-10-10) 종전엔 측정 시각 칸이 없어 **저장 시각**이 측정 시각이 됐고(파토그래프 시간축이 입력 지연만큼 밀림),
 *    잰 값이 하나도 없어도 버튼이 눌려 빈 진행 기록이 쌓였다. 측정 시각은 비우면 저장 시각(그렇게 말한다).
 */
export function ProgressForm({ onSubmit }: { onSubmit: (b: Record<string, number | string>) => Promise<unknown> }) {
  const EMPTY = { cervicalDilation: '', station: '', fetalHeartRate: '', contractionFreq: '', recordedAt: '' };
  const [f, setF] = useState(EMPTY);
  const num = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));
  const body = (() => {
    const b: Record<string, number | string> = {};
    for (const k of ['cervicalDilation', 'station', 'fetalHeartRate', 'contractionFreq'] as const) { const n = num(f[k]); if (n != null) b[k] = n; }
    return b;
  })();
  const hasValue = Object.keys(body).length > 0;
  return (
    <div className="flex flex-wrap items-end gap-1.5" data-labor-progress-form>
      <Field label="개대(cm)" v={f.cervicalDilation} on={(v) => setF(s => ({ ...s, cervicalDilation: v }))} />
      <Field label="하강도" v={f.station} on={(v) => setF(s => ({ ...s, station: v }))} />
      <Field label="FHR" v={f.fetalHeartRate} on={(v) => setF(s => ({ ...s, fetalHeartRate: v }))} />
      <Field label="수축/10min" v={f.contractionFreq} on={(v) => setF(s => ({ ...s, contractionFreq: v }))} />
      <div>
        <label className="block text-[10px] text-gray-400"><T k="측정 시각" /></label>
        <input type="datetime-local" value={f.recordedAt} onChange={(e) => setF(s => ({ ...s, recordedAt: e.target.value }))} data-labor-progress-time
          className="px-2 py-1.5 border border-gray-200 rounded-lg text-[11px] bg-white" />
      </div>
      <button disabled={!hasValue} data-labor-progress-submit
        onClick={() => { onSubmit({ ...body, ...(f.recordedAt ? { recordedAt: new Date(f.recordedAt).toISOString() } : {}) }).then(() => setF(EMPTY), () => { /* 실패 — 입력을 지우지 않는다(오류는 mutation onError 가 알린다) */ }); }}
        className="min-h-[44px] px-3 text-[11px] bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-40"><T k="진행 기록" /></button>
      {!f.recordedAt && <span className="w-full text-[10px] text-gray-500"><T k="측정 시각을 비우면 저장한 시각으로 기록됩니다" /></span>}
    </div>
  );
}

/**
 * 신생아 기록 폼.
 *
 * 🔴 2026-08-26 F3 — 이 폼은 **식별밴드 번호를 한 번도 묻지 않았다.** 그래서 운영 신생아 2건 모두
 *    `id_band_no`·`mother_band_no` 가 NULL 이고, 모아 대조 EP(`verify-match`)는 **구조적으로 항상 실패**할
 *    수밖에 없었다(v4.5.0 "계수 입력 UI 가 없어 잔류이물 게이트가 셀 것이 없었다"와 같은 형태).
 *    셀 것을 먼저 만들지 않고 탐지기만 두면 탐지기는 죽어 있다.
 * 🔴 성별 초기값이 `'M'` 이었다 — 아무것도 고르지 않고 저장하면 **남아로 기록**된다(P16).
 *    쓰기 폼의 초기값은 미선택이다.
 */
function NewbornForm({ onSubmit }: { onSubmit: (b: Record<string, unknown>) => Promise<unknown> }) {
  const EMPTY = { sex: '', weightG: '', apgar1: '', apgar5: '', nicu: false, idBandNo: '', motherBandNo: '' };
  const [f, setF] = useState(EMPTY);
  const tAttr = useTAttr();
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-end gap-1.5">
        <div>
          <label className="block text-[10px] text-gray-400"><T k="성별" /></label>
          <select value={f.sex} onChange={e => setF(s => ({ ...s, sex: e.target.value }))} className="px-2 py-1.5 border border-gray-200 rounded-lg text-[11px] bg-white">
            <option value="">{tAttr('— 선택 —')}</option>
            <option value="M">{tAttr('남')}</option><option value="F">{tAttr('여')}</option><option value="AMBIGUOUS">{tAttr('불명')}</option>
          </select>
        </div>
        <Field label="체중(g)" v={f.weightG} on={(v) => setF(s => ({ ...s, weightG: v }))} />
        <Field label="Apgar 1분" v={f.apgar1} on={(v) => setF(s => ({ ...s, apgar1: v }))} />
        <Field label="Apgar 5분" v={f.apgar5} on={(v) => setF(s => ({ ...s, apgar5: v }))} />
        <label className="flex items-center gap-1 text-[11px] text-gray-600"><input type="checkbox" checked={f.nicu} onChange={e => setF(s => ({ ...s, nicu: e.target.checked }))} />NICU</label>
      </div>
      <div className="flex flex-wrap items-end gap-1.5">
        <Field label="신생아 밴드번호" v={f.idBandNo} on={(v) => setF(s => ({ ...s, idBandNo: v }))} />
        <Field label="산모 밴드번호" v={f.motherBandNo} on={(v) => setF(s => ({ ...s, motherBandNo: v }))} />
        {/* 🔴 필수로 강제하지 않는다 — 강제하면 아무 번호나 넣어 통과한다. 대신 무엇이 안 되는지 말한다. */}
        <span className="text-[10px] text-amber-700 pb-1.5">
          <T k={f.idBandNo.trim() && f.motherBandNo.trim() ? '모아 대조가 가능해집니다.' : '비워 두면 수유·투약 전 모아 대조를 할 수 없습니다.'} />
        </span>
      </div>
      <button
        disabled={!f.sex}
        onClick={() => {
          const b: Record<string, unknown> = { sex: f.sex, nicuAdmission: f.nicu };
          if (f.weightG) b.weightG = Number(f.weightG);
          if (f.apgar1) b.apgar1 = Number(f.apgar1);
          if (f.apgar5) b.apgar5 = Number(f.apgar5);
          if (f.idBandNo.trim()) b.idBandNo = f.idBandNo.trim();
          if (f.motherBandNo.trim()) b.motherBandNo = f.motherBandNo.trim();
          // 저장이 확인된 뒤에만 비운다(2026-10-07 — 종전엔 실패해도 입력이 사라졌다)
          onSubmit(b).then(() => setF(EMPTY), () => { /* 실패 — 입력 유지 · 오류는 mutation onError 가 알린다 */ });
        }}
        className="px-3 py-1.5 text-[11px] bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40">
        <T k="신생아 기록" />
      </button>
    </div>
  );
}

/**
 * 모아 식별밴드 대조 — 수유·투약 전 이중 확인(신생아 오인 방지).
 *
 * 🔴 EP 는 있었는데 **FE 전역에 `verify-match` 문자열이 0건**이었다(2026-08-26 F3).
 * 🔴 **자동으로 통과시키지 않는다.** 서버가 저장된 번호와 대조하고, 불일치는 400 으로 막는다.
 *    화면은 정답(등록된 번호)을 보여주지 않는다 — 보이면 베껴 쓰기가 된다.
 */
function MotherBabyMatch({ newborn }: { newborn: Newborn }) {
  const [motherBand, setMotherBand] = useState('');
  const [babyBand, setBabyBand] = useState('');
  const [result, setResult] = useState<'MATCH' | 'MISMATCH' | 'ERROR' | null>(null);
  const tAttr = useTAttr();

  const mut = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/obgyn/newborns/${newborn.id}/verify-match`, { motherBand: motherBand.trim(), babyBand: babyBand.trim() }),
    onSuccess: () => { setResult('MATCH'); toast.success(tAttr('모아 식별밴드 일치 — 진행 가능')); },
    // 🔴 서버가 불일치라고 말한 것만 불일치다 — 네트워크·권한 실패를 "불일치"로 그리지 않는다(2026-10-07)
    onError: (e: unknown) => { const o = motherBabyVerifyOutcome(e); setResult(o); toast.error((e as { message?: string })?.message || (o === 'MISMATCH' ? tAttr('모아 식별밴드 불일치 — 수유·투약 전 재확인') : tAttr('모아 대조를 하지 못했습니다'))); },
  });

  if (newborn.bandsRegistered === false) {
    return (
      <p className="text-[11px] text-amber-700">
        <Tf k="식별밴드가 등록되지 않아 {강조} — 밴드번호를 먼저 기록하세요." params={{ 강조: <b><T k="모아 대조를 할 수 없습니다" /></b> }} />
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-1.5">
      <Field label="산모 밴드 스캔" v={motherBand} on={(v) => { setMotherBand(v); setResult(null); }} />
      <Field label="신생아 밴드 스캔" v={babyBand} on={(v) => { setBabyBand(v); setResult(null); }} />
      <button onClick={() => mut.mutate()} disabled={!motherBand.trim() || !babyBand.trim() || mut.isPending}
        className="min-h-[44px] px-3 py-1.5 text-[11px] bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-40">
        <T k="모아 대조" />
      </button>
      {result === 'MATCH' && <span className="text-[11px] font-bold text-emerald-700 pb-1.5">✓ <T k="일치" /></span>}
      {result === 'MISMATCH' && <span className="text-[11px] font-bold text-rose-700 pb-1.5">✗ <T k="불일치 — 진행하지 마세요" /></span>}
      {result === 'ERROR' && <span className="text-[11px] font-bold text-amber-700 pb-1.5" data-verify-error>! <T k="대조하지 못했습니다(결과 없음) — 다시 시도하세요" /></span>}
    </div>
  );
}

function Field({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[10px] text-gray-400"><T k={label} /></label>
      <input value={v} onChange={e => on(e.target.value)} className="w-20 px-2 py-1.5 border border-gray-200 rounded-lg text-[11px]" />
    </div>
  );
}
