'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { EmptyState, useDurationText } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * ER 베드·운영 관리(§4.4·ADMIN) — 베드 추가/구역·번호 변경/상태 전환 + 운영 설정 4키.
 * 삭제는 없다(이력 보존) — 쓰지 않는 베드는 MAINTENANCE(정비)로 내린다.
 * 구역 개편·원무 분리 전환은 위원회 안건 상정 권고(⚖) 대상.
 */

interface BedRow {
  id: string; roomNumber: string; bedNumber: string; status: string;
  visit?: { id: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: '가용', OCCUPIED: '점유', RESERVED: '예약', CLEANING: '청소', MAINTENANCE: '정비', ISOLATION: '격리',
};
/**
 * 🔴 표시용 카탈로그 키는 **문맥 키**를 쓴다 — 라벨 Record 는 그대로 두고 `@병상` 만 붙인다.
 *    이유: 무문맥 `예약` 은 먼저 등록된 `common` 이 'Appointment'(진료 예약)로 이기고 있어
 *    베드 상태 RESERVED 가 "Appointment" 로 나간다(교차 카탈로그 충돌 가드가 잡는 그 유형).
 */
const bedStatusKey = (s: string) => `${STATUS_LABEL[s] ?? s}@병상`;
const SETTABLE = ['AVAILABLE', 'RESERVED', 'CLEANING', 'MAINTENANCE', 'ISOLATION'];
const ZONE_LABEL: Record<string, string> = { RESUS: '소생', ACUTE: '중증', GEN: '일반', ISO: '격리', OBS: '관찰' };

const CONFIG_FIELDS: { key: string; label: string; type: 'number' | 'boolean' | 'gate'; hint: string }[] = [
  { key: 'er.cleaning.slaMinutes', label: '청소 SLA (분)', type: 'number', hint: '초과 시 보드에 청소 지연 표시' },
  { key: 'er.boarding.warnMinutes', label: '입원대기 경고 (분)', type: 'number', hint: '입원 결정 후 병상 배정까지 경과 경고 기준' },
  { key: 'er.reception.separated', label: '응급 원무 분리 운영', type: 'boolean', hint: 'ON=베드 보드 접수 트랙, OFF=일반 접수 데스크 응급 배너. 응급 원무는 접수 전용(예약·수납 없음)' },
  { key: 'er.registration.guardianGate', label: '보호자 등록 게이트', type: 'gate', hint: 'WARN=미등록 접수 트랙 표시(진료는 안 막음), OFF=표시 안 함' },
];

export default function ErBedsAdminPage() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [newBed, setNewBed] = useState<{ zone: string; bedNumber: string } | null>(null);
  const [rename, setRename] = useState<{ id: string; zone: string; bedNumber: string } | null>(null);

  const boardQ = useQuery({
    queryKey: ['er-beds-admin'],
    queryFn: () => apiClient.get<{ data: { beds: BedRow[] } }>('/api/v1/emergency/beds'),
  });
  const beds = boardQ.data?.data?.beds ?? [];
  const zones = [...new Set(beds.map((b) => b.roomNumber))];
  const refresh = () => qc.invalidateQueries({ queryKey: ['er-beds-admin'] });
  const onErr = (e: unknown) => toast.error((e as { message?: string })?.message || tAttr('처리 실패'));

  const createMut = useMutation({
    mutationFn: (p: { zone: string; bedNumber: string }) => apiClient.post('/api/v1/emergency/beds/create', p),
    onSuccess: () => { toast.success(tAttr('베드를 추가했습니다.')); setNewBed(null); refresh(); },
    onError: onErr,
  });
  const renameMut = useMutation({
    mutationFn: (p: { id: string; zone: string; bedNumber: string }) =>
      apiClient.patch(`/api/v1/emergency/beds/${p.id}/rename`, { zone: p.zone, bedNumber: p.bedNumber }),
    onSuccess: () => { toast.success(tAttr('변경했습니다.')); setRename(null); refresh(); },
    onError: onErr,
  });
  const statusMut = useMutation({
    mutationFn: (p: { id: string; status: string }) => apiClient.patch(`/api/v1/emergency/beds/${p.id}/status`, { status: p.status }),
    onSuccess: () => refresh(),
    onError: onErr,
  });

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="응급실 베드·운영 관리" /></h1>
          <p className="text-sm text-gray-500 mt-1">
            <T k="베드 추가·구역/번호 변경·상태 전환과 운영 설정. 삭제는 없습니다(이력 보존) — 미사용 베드는 정비로 전환." />
            <span className="ml-1 text-indigo-500">⚖ <T k="구역 개편·원무 분리 전환은 위원회 안건 상정을 권고합니다." /></span>
          </p>
        </div>
        <button onClick={() => setNewBed({ zone: zones[0] ?? 'GEN', bedNumber: '' })}
          className="px-3 py-2 text-sm font-semibold bg-gray-900 text-white rounded-xl hover:bg-gray-700"><T k="+ 베드 추가" /></button>
      </div>

      {beds.length === 0 ? (
        boardQ.isError ? (
          /* 🔴 조회 실패를 "베드 0개"로 그리지 않는다 — 24병상이 실재하는 축에서 장애가 '없음'이 된다 */
          <QueryErrorFallback error={boardQ.error} onRetry={() => boardQ.refetch()} />
        ) : (
          <EmptyState icon="🛏" title="응급실 베드가 없습니다" />
        )
      ) : zones.map((zone) => (
        <div key={zone} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-sm font-bold text-gray-700 mb-2">
            <T k={ZONE_LABEL[zone] ?? zone} /> <span className="font-mono text-xs text-gray-400">{zone}</span>
            <span className="ml-2 text-xs font-normal text-gray-400">{beds.filter((b) => b.roomNumber === zone).length}병상</span>
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
            {beds.filter((b) => b.roomNumber === zone).map((b) => {
              const occupied = b.status === 'OCCUPIED' || !!b.visit;
              return (
                <div key={b.id} className="rounded-xl border border-gray-100 p-2.5">
                  {rename?.id === b.id ? (
                    <div className="space-y-1">
                      <div className="flex gap-1">
                        <input value={rename.zone} onChange={(e) => setRename({ ...rename, zone: e.target.value.toUpperCase() })}
                          className="w-16 px-1.5 py-1 border border-gray-200 rounded text-xs font-mono" />
                        <input value={rename.bedNumber} onChange={(e) => setRename({ ...rename, bedNumber: e.target.value })}
                          className="w-10 px-1.5 py-1 border border-gray-200 rounded text-xs" />
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => renameMut.mutate(rename)} className="text-[10px] px-1.5 py-0.5 bg-blue-600 text-white rounded"><T k="저장" /></button>
                        <button onClick={() => setRename(null)} className="text-[10px] px-1.5 py-0.5 bg-gray-100 rounded"><T k="취소" /></button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-800 font-mono">{b.roomNumber}-{b.bedNumber}</span>
                        <span className="flex items-center gap-1">
                          <a href={`/emergency/bed-display/${b.id}`} target="_blank" rel="noreferrer"
                            title={tAttr('베드사이드 디스플레이 열기(태블릿/모니터 전체화면)')} className="text-gray-300 hover:text-blue-500 text-xs">🖵</a>
                          {!occupied && (
                            <button onClick={() => setRename({ id: b.id, zone: b.roomNumber, bedNumber: b.bedNumber })}
                              title={tAttr('구역/번호 변경')} className="text-gray-300 hover:text-gray-600 text-xs">✎</button>
                          )}
                        </span>
                      </div>
                      {occupied ? (
                        <p className="mt-1 text-[11px] font-medium text-rose-500"><T k="점유 중 — 보드에서 해제/이동" /></p>
                      ) : (
                        <select value={b.status} onChange={(e) => statusMut.mutate({ id: b.id, status: e.target.value })}
                          className="mt-1 w-full px-1.5 py-1 border border-gray-200 rounded-lg text-[11px] bg-white">
                          {SETTABLE.map((s) => <option key={s} value={s}>{tAttr(bedStatusKey(s))}</option>)}
                        </select>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <StatsCard />

      <ConfigCard />

      {newBed && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setNewBed(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-gray-900"><T k="베드 추가" /></h3>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="구역 (대문자)" /></label>
                <input value={newBed.zone} onChange={(e) => setNewBed({ ...newBed, zone: e.target.value.toUpperCase() })}
                  className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm font-mono" />
              </div>
              <div className="w-20">
                <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="번호" /></label>
                <input value={newBed.bedNumber} onChange={(e) => setNewBed({ ...newBed, bedNumber: e.target.value })} inputMode="numeric"
                  className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => createMut.mutate(newBed)} disabled={!newBed.zone || !newBed.bedNumber || createMut.isPending}
                className="flex-1 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl disabled:opacity-40"><T k="추가" /></button>
              <button onClick={() => setNewBed(null)} className="px-3 py-2 bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="닫기" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 운영 리포트(P3) — 배정 이력 기반 구역 점유율·베드 회전. 표본 없으면 없는 대로(추정 금지) */
function StatsCard() {
  const fmtDur = useDurationText();
  const tAttr = useTAttr();
  const [days, setDays] = useState(7);
  const statsQ = useQuery({
    queryKey: ['er-bed-stats', days],
    queryFn: () => apiClient.get<{ data: {
      windowDays: number; totalAssignments: number; avgOccupancyMinutes: number | null;
      zones: { zone: string; assignments: number; avgOccupancyMinutes: number | null }[];
      releaseReasons: Record<string, number>;
    } }>(`/api/v1/emergency/beds/stats?days=${days}`),
  });
  const s = statsQ.data?.data;
  const REASON_KO: Record<string, string> = { MOVE: '이동', DISPOSITION: '입퇴원·퇴실', MANUAL: '수동', AUTO_CLOSE: '자동정리' };
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-bold text-gray-700"><T k="운영 리포트" /> <span className="text-xs font-normal text-gray-400"><T k="배정 이력 기반" /></span></p>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white">
          <option value={7}>{tAttr('최근 7일')}</option><option value={30}>{tAttr('최근 30일')}</option><option value={90}>{tAttr('최근 90일')}</option>
        </select>
      </div>
      {!s ? <p className="text-sm text-gray-400"><T k="불러오는 중…" /></p> : s.totalAssignments === 0 ? (
        <p className="text-sm text-gray-400"><T k="기간 내 배정 이력이 없습니다." /></p>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-3 flex-wrap text-xs">
            <span className="px-2.5 py-1.5 rounded-lg bg-gray-50 border border-gray-100"><T k="총 배정" /> <b className="tabular-nums">{s.totalAssignments}</b><T k="건" /></span>
            <span className="px-2.5 py-1.5 rounded-lg bg-gray-50 border border-gray-100"><T k="평균 점유" /> <b className="tabular-nums">{fmtDur(s.avgOccupancyMinutes)}</b></span>
            {Object.entries(s.releaseReasons).map(([k, n]) => (
              <span key={k} className="px-2.5 py-1.5 rounded-lg bg-gray-50 border border-gray-100 text-gray-500"><T k={REASON_KO[k] ?? k} /> {n}</span>
            ))}
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2">
            {s.zones.map((z) => (
              <div key={z.zone} className="rounded-xl border border-gray-100 px-3 py-2">
                <p className="text-[11px] font-bold text-gray-500"><T k={ZONE_LABEL[z.zone] ?? z.zone} /> <span className="font-mono text-gray-300">{z.zone}</span></p>
                <p className="text-sm font-bold tabular-nums mt-0.5">{z.assignments}<T k="건" /> <span className="text-xs font-normal text-gray-400">· <T k="평균" /> {fmtDur(z.avgOccupancyMinutes)}</span></p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 운영 설정 4키 — SystemConfig 정본을 직접 편집(PUT /config/:key). SurfaceMap ⚖ 표면 */
function ConfigCard() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const configsQ = useQuery({
    queryKey: ['er-config', CONFIG_FIELDS.map((f) => f.key)],
    /**
     * 🔴 키마다 성공/실패를 **따로** 들고 온다. 종전엔 실패를 `null` 로 접어
     * `values[key]` 가 undefined 가 됐고, 그러면 아래 렌더가 **모르는 상태를 단정**했다 —
     * boolean 은 `v !== false` 라 "ON (분리)", gate 는 `v === 'OFF' ? … : 'WARN'` 이라 "WARN".
     * 안전 게이트 관리 화면이 조회 실패를 특정 모드로 말하면 안 된다.
     * 키 하나가 실패해도 나머지는 살린다(그건 정당한 부분 성공) — 대신 그 키는 "불러오지 못함"으로.
     */
    queryFn: async () => {
      const entries = await Promise.all(CONFIG_FIELDS.map(async (f) => {
        try {
          const r = await apiClient.get<{ data: unknown }>(`/api/v1/config/${f.key}`);
          return [f.key, { ok: true, value: (r as { data?: unknown })?.data }] as const;
        } catch {
          return [f.key, { ok: false }] as const;
        }
      }));
      return Object.fromEntries(entries) as Record<string, { ok: boolean; value?: unknown }>;
    },
  });
  const values: Record<string, { ok: boolean; value?: unknown }> = configsQ.data ?? {};
  const saveMut = useMutation({
    mutationFn: (p: { key: string; value: unknown }) => apiClient.put(`/api/v1/config/${p.key}`, { value: p.value }),
    onSuccess: () => { toast.success(tAttr('설정을 저장했습니다.')); qc.invalidateQueries({ queryKey: ['er-config'] }); },
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('저장 실패')),
  });

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <p className="text-sm font-bold text-gray-700 mb-3"><T k="운영 설정" /> <span className="text-xs font-normal text-indigo-400">⚖ <T k="거버넌스 표면" /></span></p>
      <div className="grid md:grid-cols-2 gap-3">
        {CONFIG_FIELDS.map((f) => {
          const st = values[f.key];
          const loaded = st?.ok === true;
          const v = st?.value;
          return (
            <div key={f.key} className="rounded-xl border border-gray-100 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-gray-700"><T k={f.label} /></p>
                {/* 🔴 현재 값을 모르면 모른다고 말하고 편집을 막는다 — 모르는 값 위에 덮어쓰지 않게 */}
                {!loaded && (
                  <span className="flex items-center gap-1.5">
                    <span className="text-[11px] text-red-600 font-medium"><T k="현재 값을 불러오지 못했습니다" /></span>
                    <button onClick={() => configsQ.refetch()} className="text-[11px] px-2 py-0.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"><T k="재시도" /></button>
                  </span>
                )}
                {loaded && f.type === 'number' && (
                  <input key={String(v)} defaultValue={typeof v === 'number' ? v : ''} inputMode="numeric"
                    onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n > 0 && n !== v) saveMut.mutate({ key: f.key, value: n }); }}
                    className="w-20 px-2 py-1 border border-gray-200 rounded-lg text-sm text-right" />
                )}
                {loaded && f.type === 'boolean' && (
                  <button onClick={() => saveMut.mutate({ key: f.key, value: v === false })}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold ${v !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    <T k={v !== false ? 'ON (분리)' : 'OFF (통합)'} />
                  </button>
                )}
                {loaded && f.type === 'gate' && (
                  <select value={v === 'OFF' ? 'OFF' : 'WARN'} onChange={(e) => saveMut.mutate({ key: f.key, value: e.target.value })}
                    className="px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white">
                    <option value="WARN">WARN</option><option value="OFF">OFF</option>
                  </select>
                )}
              </div>
              <p className="text-[11px] text-gray-400 mt-1"><T k={f.hint} /></p>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-400 mt-2"><T k="전체 config 는 시스템 관리 > 시스템 설정에서도 관리됩니다(같은 정본)." /></p>
    </div>
  );
}
