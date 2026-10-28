'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DIAGNOSTIC_STATION_CATEGORY } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

const unwrap = <TData,>(d: unknown): TData => {
  const raw = (d as { data?: unknown })?.data;
  return (raw && typeof raw === 'object' && 'data' in (raw as object) ? (raw as { data: TData }).data : raw) as TData;
};

interface Peripheral { id: string; type: string; name: string; connection: string; host?: string | null; port?: number | null; isDefault: boolean; isActive: boolean; status?: string; config?: Record<string, unknown> | null }
interface Workstation { id: string; code: string; label: string; department?: string | null; location?: string | null; terminalId?: string | null; defaultStationIds: string[]; isActive: boolean; peripherals: Peripheral[] }
const CONFIG_FIELDS: Record<string, { key: string; label: string; ph: string }[]> = {
  LABEL_PRINTER: [{ key: 'paper', label: '용지', ph: '40x25mm' }, { key: 'dpi', label: 'DPI', ph: '203' }],
  DOC_PRINTER: [{ key: 'paper', label: '용지', ph: 'A4' }],
  DICOM_MODALITY: [{ key: 'aeTitle', label: 'AE Title', ph: 'HIS_WL' }],
};
interface Terminal { id: string; deviceUuid: string; label?: string | null; location?: string | null }
interface LStation { stationId: string; label: string; category: string; department?: string | null }

const PTYPE: { v: string; l: string; icon: string }[] = [
  { v: 'LABEL_PRINTER', l: '라벨 프린터', icon: '🏷️' }, { v: 'DOC_PRINTER', l: '문서 프린터', icon: '🖨️' },
  { v: 'BARCODE_SCANNER', l: '바코드 스캐너', icon: '📷' }, { v: 'SIGNATURE_PAD', l: '서명패드', icon: '✍️' },
  { v: 'DICOM_MODALITY', l: 'DICOM 모달리티', icon: '🩻' }, { v: 'VITALS_MONITOR', l: '활력계', icon: '💓' },
  { v: 'CARD_READER', l: '카드리더', icon: '💳' }, { v: 'OTHER', l: '기타', icon: '🔌' },
];
const PTL = Object.fromEntries(PTYPE.map(p => [p.v, p]));
const CONN = [['NETWORK', '네트워크(IP)'], ['LOCAL_AGENT', '로컬 에이전트'], ['WEBUSB', 'WebUSB'], ['WEBSERIAL', 'WebSerial']];

const EMPTY_WS = { code: '', label: '', department: '', location: '', terminalId: '' };
const EMPTY_P = { type: 'LABEL_PRINTER', name: '', connection: 'NETWORK', host: '', port: '', isDefault: false };

export default function WorkstationsAdmin() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [wsForm, setWsForm] = useState({ ...EMPTY_WS });
  const [wsStations, setWsStations] = useState<string[]>([]);
  const [wsActive, setWsActive] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [pForm, setPForm] = useState<{ id?: string } & typeof EMPTY_P>({ ...EMPTY_P });
  const [pConfig, setPConfig] = useState<Record<string, string>>({});

  const { data } = useQuery({ queryKey: ['ws-admin'], queryFn: () => apiClient.get('/api/v1/workstation-setup/workstations') });
  const { data: termData } = useQuery({ queryKey: ['ws-terminals'], queryFn: () => apiClient.get('/api/v1/workstation-setup/terminals/available') });
  const { data: stationData } = useQuery({ queryKey: ['ws-logical'], queryFn: () => apiClient.get('/api/v1/workstation-setup/logical-stations') });
  // 공식 위치 = 공간 자산 배치 원장(P0 · 아래 '위치' 입력칸은 자유 텍스트 메모로 남는다 — 원장과 다르면 원장이 기준)
  const placementsQ = useQuery({
    queryKey: ['ws-placements'],
    queryFn: () => apiClient.get<{ data: { asset: { id: string } | null; floor: string | null; space: { name: string } | null }[] }>('/api/v1/space-assets/placements', { kind: 'WORKSTATION_PROFILE' }),
  });
  const placementOf = new Map((placementsQ.data?.data ?? []).filter((p) => p.asset).map((p) => [p.asset!.id, p]));
  const list = unwrap<Workstation[]>(data) ?? [];
  const terminals = unwrap<Terminal[]>(termData) ?? [];
  const logicalStations = unwrap<LStation[]>(stationData) ?? [];
  const sel = list.find(w => w.id === selected) ?? null;

  const loadWs = (w: Workstation) => {
    setWsForm({ code: w.code, label: w.label, department: w.department ?? '', location: w.location ?? '', terminalId: w.terminalId ?? '' });
    setWsStations(w.defaultStationIds ?? []); setWsActive(w.isActive);
  };
  const toggleStation = (sid: string) => setWsStations(s => s.includes(sid) ? s.filter(x => x !== sid) : [...s, sid]);

  const inv = () => qc.invalidateQueries({ queryKey: ['ws-admin'] });
  const wsMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/workstation-setup/workstations', { code: wsForm.code.trim(), label: wsForm.label.trim(), department: wsForm.department.trim() || undefined, location: wsForm.location.trim() || undefined, terminalId: wsForm.terminalId || undefined, defaultStationIds: wsStations, isActive: wsActive }),
    onSuccess: () => { inv(); setWsForm({ ...EMPTY_WS }); setWsStations([]); setWsActive(true); toast.success(tAttr('워크스테이션 저장')); qc.invalidateQueries({ queryKey: ['ws-terminals'] }); },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || tAttr('저장 실패')),
  });
  const wsDel = useMutation({ mutationFn: (id: string) => apiClient.del(`/api/v1/workstation-setup/workstations/${id}`), onSuccess: () => { inv(); setSelected(null); toast.success(tAttr('삭제됨')); qc.invalidateQueries({ queryKey: ['ws-terminals'] }); } });

  const savePeripheral = useMutation({
    mutationFn: () => {
      const cfg = Object.fromEntries(Object.entries(pConfig).filter(([, v]) => v.trim()));
      const body = { workstationProfileId: selected, type: pForm.type, name: pForm.name.trim(), connection: pForm.connection, host: pForm.host.trim() || undefined, port: pForm.port ? Number(pForm.port) : undefined, isDefault: pForm.isDefault, config: Object.keys(cfg).length ? cfg : undefined };
      return pForm.id ? apiClient.put(`/api/v1/workstation-setup/peripherals/${pForm.id}`, body) : apiClient.post('/api/v1/workstation-setup/peripherals', body);
    },
    onSuccess: () => { inv(); setPForm({ ...EMPTY_P }); setPConfig({}); toast.success(tAttr('주변기기 저장')); },
    onError: () => toast.error(tAttr('저장 실패')),
  });
  const pDel = useMutation({ mutationFn: (id: string) => apiClient.del(`/api/v1/workstation-setup/peripherals/${id}`), onSuccess: () => { inv(); toast.success(tAttr('삭제됨')); } });
  const testPrint = useMutation({
    mutationFn: (id: string) => apiClient.post<{ data: { ok?: boolean; clientSide?: boolean; message?: string } }>(`/api/v1/workstation-setup/peripherals/${id}/test-print`),
    onSuccess: (res) => { inv(); const d = unwrap<{ ok?: boolean; clientSide?: boolean; message?: string }>(res); toast.success(d?.message || tAttr('테스트 인쇄 전송')); },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || tAttr('인쇄 실패')),
  });

  const input = 'px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-400 focus:outline-none';

  return (
    <div className="max-w-6xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="워크스테이션-디바이스 설정" /></h1>
        <p className="text-sm text-gray-500 mt-1"><T k="물리 워크스테이션 등록 · 단말 바인딩(자동 해석) · 주변기기(프린터·스캐너·서명패드) 연결 설정. 정체성은" /> <b><T k="단말 바인딩(자동) + 코드 선택(폴백)" /></b> <T k="하이브리드." /></p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5">
        {/* 목록 */}
        <div className="space-y-2">
          {list.length === 0 && <p className="text-sm text-gray-400 text-center py-8"><T k="등록된 워크스테이션 없음" /></p>}
          {list.map(w => (
            <div key={w.id} className={`bg-white rounded-xl border p-4 cursor-pointer ${selected === w.id ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-100'}`} onClick={() => { setSelected(w.id); setPForm({ ...EMPTY_P }); }}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-xs font-bold text-blue-700">{w.code}</span>
                  <span className="text-sm font-medium text-gray-900 truncate">{w.label}</span>
                  {w.terminalId && <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 whitespace-nowrap"><T k="단말 바인딩" /></span>}
                  {!w.isActive && <span className="text-[11px] text-gray-400"><T k="비활성" /></span>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={(e) => { e.stopPropagation(); loadWs(w); }} className="text-xs text-blue-600 hover:underline"><T k="수정" /></button>
                  <button onClick={(e) => { e.stopPropagation(); if (confirm(tAttr('삭제?'))) wsDel.mutate(w.id); }} className="text-xs text-red-500 hover:underline"><T k="삭제" /></button>
                </div>
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">{w.department ?? '-'} · {w.location ?? '-'}{w.defaultStationIds?.length ? ` · 스테이션 ${w.defaultStationIds.length}` : ''}</div>
              <div className="text-[11px] mt-0.5">
                {placementsQ.isError ? (
                  <span className="text-red-600"><T k="배치 조회 실패" /></span>
                ) : placementsQ.isLoading ? null : placementOf.get(w.id) ? (
                  <span className="text-emerald-700"><T k="공식 위치" />: {placementOf.get(w.id)!.floor} · {placementOf.get(w.id)!.space?.name}</span>
                ) : (
                  <a href="/admin/space-assets" className="text-amber-700 hover:underline" onClick={(e) => e.stopPropagation()}><T k="공식 위치 미지정 — 공간 자산 배치에서 지정" /></a>
                )}
              </div>
              {w.peripherals.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {w.peripherals.map(p => (
                    <span key={p.id} className={`text-[11px] px-2 py-0.5 rounded-full border ${p.isDefault ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-gray-50 text-gray-600 border-gray-100'}`}>
                      {PTL[p.type]?.icon} {p.name}{p.host ? ` · ${p.host}${p.port ? ':' + p.port : ''}` : ''}{p.isDefault ? ' ·기본' : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 우측 폼 (고정) */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto lg:pr-1">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2">
            <p className="text-sm font-bold text-gray-700"><T k="워크스테이션 등록/수정" /></p>
            <div className="grid grid-cols-2 gap-2">
              <input value={wsForm.code} onChange={e => setWsForm(f => ({ ...f, code: e.target.value }))} placeholder={tAttr('코드 예 WS-LAB-01')} className={input} />
              <input value={wsForm.label} onChange={e => setWsForm(f => ({ ...f, label: e.target.value }))} placeholder={tAttr('이름@명칭')} className={input} />
              <input value={wsForm.department} onChange={e => setWsForm(f => ({ ...f, department: e.target.value }))} placeholder={tAttr('부서')} className={input} />
              <input value={wsForm.location} onChange={e => setWsForm(f => ({ ...f, location: e.target.value }))} placeholder={tAttr('위치')} className={input} />
            </div>
            <p className="text-[11px] text-gray-500"><T k="위치 칸은 메모입니다. 공식 위치는 공간 자산 배치 화면에서 지정합니다." /></p>
            <select value={wsForm.terminalId} onChange={e => setWsForm(f => ({ ...f, terminalId: e.target.value }))} className={`${input} w-full`}>
              <option value="">{tAttr('단말 바인딩 없음(코드 선택 방식)')}</option>
              {terminals.map(t => <option key={t.id} value={t.id}>{t.label ?? t.deviceUuid.slice(0, 12)} · {t.location ?? '-'}</option>)}
            </select>
            <details className="rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2">
              <summary className="text-[11px] font-medium text-gray-600 cursor-pointer"><T k="처리 스테이션 매핑" /> ({wsStations.length}) · <T k="활성" /></summary>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-600 mt-2"><input type="checkbox" checked={wsActive} onChange={e => setWsActive(e.target.checked)} /><T k="활성" /></label>
              <div className="max-h-40 overflow-y-auto mt-2 space-y-0.5">
                {logicalStations.map(s => (
                  <label key={s.stationId} className="flex items-center gap-1.5 text-[11px] text-gray-700 py-0.5">
                    <input type="checkbox" checked={wsStations.includes(s.stationId)} onChange={() => toggleStation(s.stationId)} />
                    <span className="text-gray-400">[{s.category}]</span> {s.label} <span className="text-gray-300 font-mono">{s.stationId}</span>
                  </label>
                ))}
              </div>
            </details>
            <div className="flex gap-2">
              <button onClick={() => wsMut.mutate()} disabled={!wsForm.code.trim() || !wsForm.label.trim() || wsMut.isPending} className="flex-1 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"><T k="저장(코드 upsert)" /></button>
              <button onClick={() => { setWsForm({ ...EMPTY_WS }); setWsStations([]); setWsActive(true); }} className="px-3 py-2 text-sm bg-gray-100 text-gray-600 rounded-lg"><T k="새로" /></button>
            </div>
          </div>

          {sel && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2">
              <p className="text-sm font-bold text-gray-700"><T k="주변기기" /> — <span className="text-blue-700 font-mono text-xs">{sel.code}</span></p>
              <div className="grid grid-cols-2 gap-2">
                <select value={pForm.type} onChange={e => setPForm(f => ({ ...f, type: e.target.value }))} className={input}>
                  {PTYPE.map(t => <option key={t.v} value={t.v}>{t.icon} {tAttr(t.l)}</option>)}
                </select>
                <input value={pForm.name} onChange={e => setPForm(f => ({ ...f, name: e.target.value }))} placeholder={tAttr('기기명')} className={input} />
                <select value={pForm.connection} onChange={e => setPForm(f => ({ ...f, connection: e.target.value }))} className={input}>
                  {CONN.map(([v, l]) => <option key={v} value={v}>{tAttr(l)}</option>)}
                </select>
                <div className="flex gap-1">
                  <input value={pForm.host} onChange={e => setPForm(f => ({ ...f, host: e.target.value }))} placeholder={tAttr('IP/호스트')} className={`${input} flex-1 min-w-0`} disabled={pForm.connection !== 'NETWORK' && pForm.connection !== 'LOCAL_AGENT'} />
                  <input value={pForm.port} onChange={e => setPForm(f => ({ ...f, port: e.target.value }))} placeholder={tAttr('포트')} className={`${input} w-20`} disabled={pForm.connection !== 'NETWORK'} />
                </div>
              </div>
              {CONFIG_FIELDS[pForm.type] && (
                <div className="flex flex-wrap gap-2">
                  {CONFIG_FIELDS[pForm.type].map(cf => (
                    <div key={cf.key}>
                      <label className="block text-[10px] text-gray-400"><T k={cf.label} /></label>
                      <input value={pConfig[cf.key] ?? ''} onChange={e => setPConfig(c => ({ ...c, [cf.key]: e.target.value }))} placeholder={cf.ph} className={`${input} w-28`} />
                    </div>
                  ))}
                </div>
              )}
              <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={pForm.isDefault} onChange={e => setPForm(f => ({ ...f, isDefault: e.target.checked }))} /><T k="이 유형의 기본 기기" /></label>
              <div className="flex gap-2">
                <button onClick={() => savePeripheral.mutate()} disabled={!pForm.name.trim() || savePeripheral.isPending} className="flex-1 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40"><T k={pForm.id ? '수정' : '주변기기 추가'} /></button>
                {pForm.id && <button onClick={() => setPForm({ ...EMPTY_P })} className="px-3 py-2 text-sm bg-gray-100 text-gray-600 rounded-lg"><T k="취소" /></button>}
              </div>
              {sel.peripherals.length > 0 && (
                <div className="pt-2 border-t border-gray-100 space-y-1">
                  {sel.peripherals.map(p => (
                    <div key={p.id} className="flex items-center gap-2 text-xs py-1">
                      <span>{PTL[p.type]?.icon}</span>
                      <span className="font-medium text-gray-800">{p.name}</span>
                      <span className="text-gray-400">{p.connection}{p.host ? ` ${p.host}${p.port ? ':' + p.port : ''}` : ''}</span>
                      {p.isDefault && <span className="text-[11px] px-1.5 rounded-full bg-blue-100 text-blue-700"><T k="기본" /></span>}
                      {p.status === 'ONLINE' && <span className="text-[11px] px-1.5 rounded-full bg-emerald-100 text-emerald-700"><T k="온라인" /></span>}
                      {p.status === 'OFFLINE' && <span className="text-[11px] px-1.5 rounded-full bg-red-100 text-red-600"><T k="오프라인" /></span>}
                      <div className="ml-auto flex gap-1.5">
                        {(p.type === 'LABEL_PRINTER' || p.type === 'DOC_PRINTER') && <button onClick={() => testPrint.mutate(p.id)} disabled={testPrint.isPending} className="text-emerald-600 hover:underline disabled:opacity-40"><T k="테스트 인쇄" /></button>}
                        <button onClick={() => { setPForm({ id: p.id, type: p.type, name: p.name, connection: p.connection, host: p.host ?? '', port: p.port ? String(p.port) : '', isDefault: p.isDefault }); setPConfig(Object.fromEntries(Object.entries(p.config ?? {}).map(([k, v]) => [k, String(v)]))); }} className="text-blue-600 hover:underline"><T k="수정" /></button>
                        <button onClick={() => pDel.mutate(p.id)} className="text-red-500 hover:underline"><T k="삭제" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <StationOrderCodesEditor stations={logicalStations} input={input} />
    </div>
  );
}

interface StationOrderCodes {
  stationId: string; label: string; category: string;
  orderCodes: string[]; matched: { code: string; nameKo: string }[];
  unknownCodes: string[] | null; usesProcedureCodes: boolean;
}

/**
 * 🔴 논리 스테이션 검사항목(수가코드) 설정 — 2026-09-13 외부 실측 S9.
 *    검사·영상 워크스테이션 배너가 "이 설정을 고칠 화면은 아직 없습니다"라고 말했고 사실이었다.
 *    **화면이 "안 맞다"고 말하면 고칠 자리가 있어야 한다** — 이 카드가 그 자리다.
 *    마스터에 없는 코드는 막지 않는다(원내 코드 선등록 전 강제 → 아무 코드나 골라 통과). 대신 무엇이 안 맞는지 보인다.
 *    기초검사 자리는 어휘가 달라(검사 종류) 여기서 편집하지 않는다 — 목록에서 뺀다.
 */
function StationOrderCodesEditor({ stations, input }: { stations: LStation[]; input: string }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const editable = stations.filter((s) => s.category !== DIAGNOSTIC_STATION_CATEGORY);
  const [stationId, setStationId] = useState('');
  const [draft, setDraft] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['ws-order-codes', stationId],
    queryFn: () => apiClient.get(`/api/v1/workstation-setup/logical-stations/${encodeURIComponent(stationId)}/order-codes`),
    enabled: !!stationId,
  });
  const cur = q.data ? unwrap<StationOrderCodes>(q.data) : null;
  const text = draft ?? (cur?.orderCodes ?? []).join('\n');

  const save = useMutation({
    mutationFn: () => apiClient.put(`/api/v1/workstation-setup/logical-stations/${encodeURIComponent(stationId)}/order-codes`, {
      orderCodes: text.split(/[\s,]+/).map((c) => c.trim()).filter(Boolean),
    }),
    onSuccess: () => { setDraft(null); qc.invalidateQueries({ queryKey: ['ws-order-codes', stationId] }); toast.success(tAttr('검사항목 설정 저장')); },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || tAttr('저장 실패')),
  });

  return (
    <div data-testid="station-order-codes" className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
      <div>
        <p className="text-sm font-bold text-gray-700"><T k="스테이션 검사항목(수가코드) 설정" /></p>
        <p className="text-[11px] text-gray-500 mt-0.5"><T k="검사·영상 워크스테이션 큐가 이 코드로 오더를 거릅니다. 수가 마스터에 없는 코드도 저장은 되지만 큐가 거르지 못하고, 하나도 맞지 않으면 부서 전체를 표시합니다. 기초검사 자리는 기초검사 워크스테이션에서 설정합니다." /></p>
      </div>
      <select value={stationId} onChange={(e) => { setStationId(e.target.value); setDraft(null); }} className={`${input} w-full`}>
        <option value="">{tAttr('스테이션 선택')}</option>
        {editable.map((s) => <option key={s.stationId} value={s.stationId}>[{s.category}] {s.label} · {s.stationId}</option>)}
      </select>
      {stationId && q.isLoading && <p className="text-xs text-gray-400"><T k="불러오는 중…" /></p>}
      {stationId && q.isError && <p className="text-xs text-red-600"><T k="설정을 불러오지 못했습니다" /></p>}
      {cur && (
        <>
          <textarea value={text} onChange={(e) => setDraft(e.target.value)} rows={4} className={`${input} w-full font-mono`} placeholder={tAttr('수가코드를 줄바꿈·쉼표로 구분')} />
          <div className="text-[11px] space-y-1">
            <p className="text-gray-600">
              <Tf k="마스터 일치 {일치} / 설정 {설정}" params={{ 일치: cur.matched.length, 설정: cur.orderCodes.length }} />
              {cur.orderCodes.length > 0 && cur.matched.length === 0 && (
                <span className="ml-2 text-amber-700"><T k="하나도 맞지 않아 큐가 부서 전체를 표시하는 중입니다" /></span>
              )}
            </p>
            {cur.matched.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {cur.matched.map((m) => <span key={m.code} className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100"><span className="font-mono">{m.code}</span> {m.nameKo}</span>)}
              </div>
            )}
            {(cur.unknownCodes?.length ?? 0) > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-amber-700"><T k="마스터에 없는 코드(큐가 거르지 못함)" /></span>
                {cur.unknownCodes!.map((c) => <span key={c} className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-100 font-mono">{c}</span>)}
              </div>
            )}
          </div>
          <button onClick={() => save.mutate()} disabled={save.isPending || draft === null} className="min-h-[44px] px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"><T k="저장" /></button>
        </>
      )}
    </div>
  );
}
