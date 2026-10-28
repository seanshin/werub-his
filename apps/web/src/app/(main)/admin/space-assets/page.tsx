'use client';

// 공간 자산 배치 — 워크스테이션·PC·의료기기·장비·보관 장소의 위치 원장 (API `/api/v1/space-assets` 첫 소비처)
// 기획 docs/01-plan/features/spatial-flow-vision-3d.plan.md §5-A
// 🔴 정직 표기 원칙:
//   - 배치율 분모는 **활성 자산**이다. 분모 0 이면 "산출 불가"(0% 아님). 폐기·비활성은 분모에서 빠진다.
//   - 기존 자유 텍스트 위치는 **덮어쓰지 않는다** — 원장과 다르면 "텍스트 다름"으로 드러낼 뿐(틀렸다는 뜻이 아니다).
//   - 텍스트 기반 후보는 **제안**이다 — 누르면 입력칸만 채운다. 자동 배치 없음.
//   - 좌표는 도면이 확정된 구역에서만 받는다 — 지금은 확정 도면이 없어 구역 단위로만 기록된다(그 사실을 말한다).
//   - QR 위치 스테이션은 자기 테이블이 위치를 갖는다 — 여기서 바꾸지 않는다(정본 둘 금지).
//   - 🔴 조회 실패는 "배치 0건"이 아니다 — 실패로 그린다.

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ASSET_KIND_META, ASSET_KINDS, PLACEMENT_SOURCE_LABEL, type AssetKind, type PlacementSource } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { EmptyState, KDate, Ratio } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { BedLinkPanel } from './BedLinkPanel';

interface Coverage {
  kind: AssetKind; label: string; group: string; sourceTable: string; placeable: boolean;
  total: number; active: number; placed: number; unplaced: number; placedRatio: number | null;
  unplacedWithLegacyText: number; legacyDiffers: number; legacyUnknown: number;
}
interface Zone { id: string; code: string | null; name: string; roomNumber: string | null; spaceType: string; nodeType: string; geometrySource: string | null }
interface Floor { id: string; code: string | null; name: string; floor: number | null; zones: Zone[] }
interface AssetView { kind: AssetKind; id: string; label: string; detail: string | null; status: string | null; active: boolean; legacyText: string | null }
interface PlacementRow {
  placementId: string | null; kind: AssetKind; kindLabel: string; source: PlacementSource;
  asset: AssetView | null; assetMissing: boolean;
  space: { id: string; name: string; code: string | null; floor: number | null; nodeType: string } | null;
  floor: string | null; placedAt: string | null; note: string | null; legacyTextMatches: boolean | null;
}
type SuggestionReason = 'NAME' | 'NAME_PART' | 'ROOM_NUMBER' | 'FLOOR';
interface Suggestion { spaceNodeId: string; name: string; floor: number | null; score: number; reasons: SuggestionReason[] }
/** 서버는 근거 코드만 준다(서버 조립 한국어 금지) — 문장은 화면이 */
const REASON_LABEL: Record<SuggestionReason, string> = { NAME: '이름 포함', NAME_PART: '이름 일부', ROOM_NUMBER: '실번호', FLOOR: '층 일치' };
/** 라벨 없는 단말은 서버가 장치 UUID 끝 6자리(`…abc123`)만 준다 */
const assetName = (a: AssetView, unitWord: string) => (a.kind === 'TERMINAL' && a.label.startsWith('…') ? `${unitWord} ${a.label}` : a.label);
interface HistoryRow {
  id: string; space: { name: string } | null; floor: string | null; source: string; note: string | null;
  legacyTextAtPlacement: string | null; placedAt: string; endedAt: string | null; endReason: string | null;
}

const PLACEABLE_KINDS = ASSET_KINDS.filter((k) => ASSET_KIND_META[k].placeable);

/** 검진 스테이션(검사 흐름 단위) — 공간 연결이 있어야 환자 앱이 층·방을 안내하고 도착이 위치 원장에 관측으로 남는다(P0-4·P0-5) */
/** 외래 진료실 — 진료 스케줄의 이름 원문 ↔ 공간(P0-5). 연결돼야 QR 대기표에 층·구역이 안내된다 */
interface ClinicRoomRow {
  name: string;
  activeSchedules: number;
  space: { id: string; name: string; floor: number | null } | null;
  suggestion: { spaceNodeId: string; name: string; floor: number | null } | null;
}
interface CheckupStationRow { stationId: string; name: string; category: string; location: string | null; spaceNodeId: string | null }

export default function SpaceAssetsPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [floorId, setFloorId] = useState('');
  const [kindFilter, setKindFilter] = useState<AssetKind | ''>('');
  const [unplacedKind, setUnplacedKind] = useState<AssetKind>('EQUIPMENT');
  const [form, setForm] = useState<{ kind: AssetKind; assetId: string; assetLabel: string; spaceNodeId: string; note: string } | null>(null);
  const [ending, setEnding] = useState<{ id: string; label: string } | null>(null);
  const [endReason, setEndReason] = useState('');
  const [historyOf, setHistoryOf] = useState<{ kind: AssetKind; id: string; label: string } | null>(null);

  const covQ = useQuery({
    queryKey: ['space-assets', 'coverage'],
    queryFn: () => apiClient.get<{ data: Coverage[]; meta: { excluded: { table: string; reason: string }[] } }>('/api/v1/space-assets/coverage'),
  });
  const spacesQ = useQuery({
    queryKey: ['space-assets', 'spaces'],
    queryFn: () => apiClient.get<{ data: Floor[] }>('/api/v1/space-assets/spaces'),
  });
  const floors = (spacesQ.data?.data ?? []) as Floor[];
  const activeFloor = floorId || floors[0]?.id || '';

  const placementsQ = useQuery({
    queryKey: ['space-assets', 'placements', activeFloor, kindFilter],
    enabled: !!activeFloor,
    queryFn: () =>
      apiClient.get<{ data: PlacementRow[] }>('/api/v1/space-assets/placements', {
        floor: activeFloor, ...(kindFilter ? { kind: kindFilter } : {}),
      }),
  });
  const unplacedQ = useQuery({
    queryKey: ['space-assets', 'unplaced', unplacedKind],
    queryFn: () => apiClient.get<{ data: { items: { asset: AssetView; suggestions: Suggestion[] }[] } }>('/api/v1/space-assets/unplaced', { kind: unplacedKind }),
  });
  const stationsQ = useQuery({
    queryKey: ['space-assets', 'checkup-stations'],
    queryFn: () => apiClient.get<{ data: CheckupStationRow[] }>('/api/v1/checkup/ws/stations'),
  });
  const stationMut = useMutation({
    mutationFn: (v: { stationId: string; spaceNodeId: string | null }) =>
      apiClient.put(`/api/v1/checkup/ws/stations/${encodeURIComponent(v.stationId)}`, { spaceNodeId: v.spaceNodeId }),
    onSuccess: () => { toast.success(tAttr('스테이션 공간 연결을 저장했습니다')); qc.invalidateQueries({ queryKey: ['space-assets', 'checkup-stations'] }); },
    onError: (e: Error) => toast.error(e.message || tAttr('스테이션 공간 연결에 실패했습니다')),
  });

  const roomsQ = useQuery({
    queryKey: ['space-assets', 'clinic-rooms'],
    queryFn: () => apiClient.get<{ data: ClinicRoomRow[] }>('/api/v1/space-assets/clinic-rooms'),
  });
  const roomMut = useMutation({
    mutationFn: (v: { name: string; spaceNodeId: string | null }) => apiClient.put('/api/v1/space-assets/clinic-rooms', v),
    onSuccess: () => { toast.success(tAttr('진료실 공간 연결을 저장했습니다')); qc.invalidateQueries({ queryKey: ['space-assets', 'clinic-rooms'] }); },
    onError: (e: Error) => toast.error(e.message || tAttr('진료실 공간 연결에 실패했습니다')),
  });

  const linkExactMut = useMutation({
    mutationFn: () => apiClient.post<{ data: { linked: { name: string }[]; ambiguous: string[]; remainingUnlinked: number } }>('/api/v1/space-assets/clinic-rooms/link-exact', {}),
    onSuccess: (r) => {
      const d = r?.data;
      toast.success(tAttr('이름 일치 진료실을 연결했습니다') + ` (${d?.linked.length ?? 0})`);
      qc.invalidateQueries({ queryKey: ['space-assets', 'clinic-rooms'] });
    },
    onError: (e: Error) => toast.error(e.message || tAttr('일괄 연결에 실패했습니다')),
  });

  const historyQ = useQuery({
    queryKey: ['space-assets', 'history', historyOf?.kind, historyOf?.id],
    enabled: !!historyOf,
    queryFn: () => apiClient.get<{ data: HistoryRow[] }>(`/api/v1/space-assets/history/${historyOf!.kind}/${historyOf!.id}`),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['space-assets'] });

  const placeMut = useMutation({
    mutationFn: () => apiClient.post<{ data: { changed: boolean } }>('/api/v1/space-assets/placements', {
      kind: form!.kind, assetId: form!.assetId, spaceNodeId: form!.spaceNodeId, source: 'MANUAL', note: form!.note.trim() || undefined,
    }),
    onSuccess: (r) => {
      toast.success(r?.data?.changed === false ? tAttr('이미 같은 위치입니다 — 바뀐 것이 없습니다') : tAttr('배치를 기록했습니다'));
      setForm(null);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message || tAttr('배치 기록에 실패했습니다')),
  });
  const endMut = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/space-assets/placements/${ending!.id}/end`, { reason: endReason.trim() }),
    onSuccess: () => { toast.success(tAttr('배치를 종료했습니다')); setEnding(null); setEndReason(''); refresh(); },
    onError: (e: Error) => toast.error(e.message || tAttr('배치 종료에 실패했습니다')),
  });

  const rows = (placementsQ.data?.data ?? []) as PlacementRow[];
  const byZone = useMemo(() => {
    const m = new Map<string, PlacementRow[]>();
    for (const r of rows) {
      const k = r.space?.name ?? tAttr('(공간 없음)');
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, tAttr]);
  const allZones = floors.flatMap((f) => f.zones.map((z) => ({ ...z, floorName: f.name })));
  const anyConfirmed = allZones.some((z) => z.geometrySource === 'DRAWING_CONFIRMED' || z.geometrySource === 'SURVEYED');

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold"><T k="공간 자산 배치" /></h1>
        <p className="text-sm text-gray-600">
          <T k="워크스테이션·PC·의료기기·장비·보관 장소가 어느 공간에 있는지 기록합니다. 자산 정보는 각자의 원래 화면이 정본이고, 여기서는 위치만 기록합니다." />
        </p>
        {!anyConfirmed && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            <T k="확정된 도면이 아직 없어 구역 단위로만 기록됩니다(좌표 없음). 도면이 확정되면 좌표를 함께 기록할 수 있습니다." />
          </p>
        )}
      </header>

      {/* 종류별 현황 */}
      <section className="space-y-2">
        <h2 className="font-semibold"><T k="종류별 배치 현황" /></h2>
        {covQ.isError ? (
          <QueryErrorFallback error={covQ.error} onRetry={() => covQ.refetch()} size="compact" />
        ) : covQ.isLoading ? (
          <p className="text-sm text-gray-500"><T k="불러오는 중…" /></p>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr>
                  <th className="py-1"><T k="종류" /></th>
                  <th><T k="배치율(배치 / 활성)" /></th>
                  <th><T k="미배치" /></th>
                  <th><T k="미배치 중 기존 텍스트 있음" /></th>
                  <th><T k="텍스트 다름" /></th>
                  <th><T k="정본 테이블" /></th>
                </tr>
              </thead>
              <tbody>
                {(covQ.data?.data ?? []).map((c) => (
                  <tr key={c.kind} className="border-t">
                    <td className="py-1.5">{c.label}{!c.placeable && <span className="ml-1 text-[11px] text-gray-500">(<T k="자체 위치 — 여기서 변경 불가" />)</span>}</td>
                    <td><Ratio numerator={c.placed} denominator={c.active} unavailableHint="활성 자산 없음" /></td>
                    <td>{c.unplaced}</td>
                    <td>{c.unplacedWithLegacyText}</td>
                    <td>{c.legacyDiffers}</td>
                    <td className="font-mono text-[11px] text-gray-500">{c.sourceTable}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <details className="text-[12px] text-gray-600">
              <summary className="cursor-pointer"><T k="원장에 넣지 않은 테이블과 이유" /></summary>
              <ul className="mt-1 list-disc pl-5">
                {(covQ.data?.meta?.excluded ?? []).map((e) => <li key={e.table}><span className="font-mono">{e.table}</span> — {e.reason}</li>)}
              </ul>
            </details>
          </>
        )}
      </section>

      {/* 층별 배치 */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold"><T k="층별 배치" /></h2>
          <select className="rounded border px-2 py-1 text-sm" value={activeFloor} onChange={(e) => setFloorId(e.target.value)} aria-label={tAttr('층')}>
            {floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <select className="rounded border px-2 py-1 text-sm" value={kindFilter} onChange={(e) => setKindFilter(e.target.value as AssetKind | '')} aria-label={tAttr('종류')}>
            <option value="">{tAttr('전체 종류')}</option>
            {ASSET_KINDS.map((k) => <option key={k} value={k}>{ASSET_KIND_META[k].label}</option>)}
          </select>
        </div>
        {spacesQ.isError ? (
          <QueryErrorFallback error={spacesQ.error} onRetry={() => spacesQ.refetch()} size="compact" />
        ) : placementsQ.isError ? (
          <QueryErrorFallback error={placementsQ.error} onRetry={() => placementsQ.refetch()} size="compact" />
        ) : placementsQ.isLoading || spacesQ.isLoading ? (
          <p className="text-sm text-gray-500"><T k="불러오는 중…" /></p>
        ) : byZone.length === 0 ? (
          <EmptyState icon="📍" title="이 층에 기록된 배치가 없습니다" compact />
        ) : (
          <div className="space-y-3">
            {byZone.map(([zone, list]) => (
              <div key={zone} className="rounded-xl border">
                <div className="border-b bg-gray-50 px-3 py-1.5 text-sm font-semibold">{zone} <span className="font-normal text-gray-500">· {list.length}</span></div>
                <ul className="divide-y text-sm">
                  {list.map((r) => (
                    <li key={`${r.kind}-${r.asset?.id ?? r.placementId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                      <span className="rounded bg-gray-100 px-1.5 text-[11px]">{r.kindLabel}</span>
                      {r.assetMissing ? (
                        <span className="text-red-700"><T k="자산 행이 사라짐 — 원래 화면에서 삭제되었는지 확인" /></span>
                      ) : (
                        <span className="font-medium">{r.asset ? assetName(r.asset, tAttr('단말')) : null}{r.asset?.detail && <span className="ml-1 text-gray-500">({r.asset.detail})</span>}</span>
                      )}
                      {r.asset && !r.asset.active && <span className="rounded bg-gray-200 px-1.5 text-[11px]"><T k="폐기·비활성" /></span>}
                      <span className="text-[11px] text-gray-500">{PLACEMENT_SOURCE_LABEL[r.source]}</span>
                      {r.legacyTextMatches === false && (
                        <span className="rounded bg-amber-100 px-1.5 text-[11px] text-amber-800" title={r.asset?.legacyText ?? ''}>
                          <T k="텍스트 다름" />: {r.asset?.legacyText}
                        </span>
                      )}
                      {r.placedAt && <span className="text-[11px] text-gray-500"><KDate value={r.placedAt} mode="datetime" /></span>}
                      {r.placementId && r.asset && (
                        <span className="ml-auto flex gap-1">
                          <button className="min-h-[36px] rounded border px-2 text-[12px]" onClick={() => setForm({ kind: r.kind, assetId: r.asset!.id, assetLabel: assetName(r.asset!, tAttr('단말')), spaceNodeId: '', note: '' })}><T k="이동" /></button>
                          <button className="min-h-[36px] rounded border px-2 text-[12px]" onClick={() => setHistoryOf({ kind: r.kind, id: r.asset!.id, label: assetName(r.asset!, tAttr('단말')) })}><T k="이력" /></button>
                          <button className="min-h-[36px] rounded border border-red-200 px-2 text-[12px] text-red-700" onClick={() => setEnding({ id: r.placementId!, label: assetName(r.asset!, tAttr('단말')) })}><T k="배치 종료" /></button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 미배치 */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold"><T k="미배치 자산" /></h2>
          <select className="rounded border px-2 py-1 text-sm" value={unplacedKind} onChange={(e) => setUnplacedKind(e.target.value as AssetKind)} aria-label={tAttr('종류')}>
            {PLACEABLE_KINDS.map((k) => <option key={k} value={k}>{ASSET_KIND_META[k].label}</option>)}
          </select>
        </div>
        <p className="text-[12px] text-gray-500"><T k="후보는 기존 텍스트 위치로 찾은 제안입니다. 누르면 입력칸만 채우고, 기록은 직접 확인한 뒤 합니다." /></p>
        {unplacedQ.isError ? (
          <QueryErrorFallback error={unplacedQ.error} onRetry={() => unplacedQ.refetch()} size="compact" />
        ) : unplacedQ.isLoading ? (
          <p className="text-sm text-gray-500"><T k="불러오는 중…" /></p>
        ) : (unplacedQ.data?.data.items ?? []).length === 0 ? (
          <EmptyState icon="✅" title="이 종류에 미배치 활성 자산이 없습니다" compact />
        ) : (
          <ul className="divide-y rounded-xl border text-sm">
            {unplacedQ.data!.data.items.map(({ asset, suggestions }) => (
              <li key={asset.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="font-medium">{assetName(asset, tAttr('단말'))}</span>
                {asset.detail && <span className="text-gray-500">({asset.detail})</span>}
                <span className="text-[12px] text-gray-500">
                  <T k="기존 텍스트" />: {asset.legacyText?.trim() ? asset.legacyText : tAttr('없음')}
                </span>
                {suggestions.map((s) => (
                  <button key={s.spaceNodeId} className="rounded-full border border-blue-200 px-2 py-0.5 text-[11px] text-blue-700"
                    onClick={() => setForm({ kind: unplacedKind, assetId: asset.id, assetLabel: assetName(asset, tAttr('단말')), spaceNodeId: s.spaceNodeId, note: '' })}>
                    {tAttr('후보')}: {s.name} · {s.reasons.map((r) => tAttr(REASON_LABEL[r])).join('·')}
                  </button>
                ))}
                <button className="ml-auto min-h-[36px] rounded border px-2 text-[12px]" onClick={() => setForm({ kind: unplacedKind, assetId: asset.id, assetLabel: assetName(asset, tAttr('단말')), spaceNodeId: '', note: '' })}>
                  <T k="배치" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 검진 스테이션 ↔ 공간 */}
      <section className="space-y-2">
        <h2 className="font-semibold"><T k="검진 스테이션 공간 연결" /></h2>
        <p className="text-[12px] text-gray-500">
          <T k="연결된 스테이션만 환자 앱에 층·방이 안내되고, 도착 처리가 위치 기록(관측)으로 남습니다. 연결하지 않으면 '위치 미등록'으로 표시됩니다." />
        </p>
        {stationsQ.isError ? (
          <QueryErrorFallback error={stationsQ.error} onRetry={() => stationsQ.refetch()} size="compact" />
        ) : stationsQ.isLoading ? (
          <p className="text-sm text-gray-500"><T k="불러오는 중…" /></p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr><th className="py-1"><T k="스테이션" /></th><th><T k="공간" /></th><th><T k="기존 텍스트" /></th></tr>
            </thead>
            <tbody>
              {(stationsQ.data?.data ?? []).map((st) => (
                <tr key={st.stationId} className="border-t">
                  <td className="py-1.5">{st.name} <span className="font-mono text-[11px] text-gray-400">{st.stationId}</span></td>
                  <td>
                    <select className="min-h-[36px] rounded border px-2 text-sm" aria-label={tAttr('공간')}
                      value={st.spaceNodeId ?? ''} disabled={stationMut.isPending}
                      onChange={(e) => stationMut.mutate({ stationId: st.stationId, spaceNodeId: e.target.value || null })}>
                      <option value="">{tAttr('연결 안 함(위치 미등록)')}</option>
                      {floors.map((f) => (
                        <optgroup key={f.id} label={f.name}>
                          {f.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td className="text-[12px] text-gray-500">{st.location?.trim() ? st.location : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 외래 진료실 ↔ 공간 */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold"><T k="외래 진료실 공간 연결" /></h2>
          {(roomsQ.data?.data ?? []).some((r) => r.suggestion) && (
            <button className="min-h-[44px] rounded bg-blue-600 px-3 text-[12px] text-white disabled:opacity-50" disabled={linkExactMut.isPending} onClick={() => linkExactMut.mutate()}>
              <T k="이름이 같은 후보 일괄 연결" /> ({(roomsQ.data?.data ?? []).filter((r) => r.suggestion).length})
            </button>
          )}
        </div>
        <p className="text-[12px] text-gray-500">
          <T k="진료 스케줄에 적힌 진료실 이름입니다. 연결된 진료실만 QR 대기표에 층·구역이 안내됩니다. 이름이 같은 구역은 후보로만 보이며 누를 때 연결됩니다." />
        </p>
        {roomsQ.isError ? (
          <QueryErrorFallback error={roomsQ.error} onRetry={() => roomsQ.refetch()} size="compact" />
        ) : roomsQ.isLoading ? (
          <p className="text-sm text-gray-500"><T k="불러오는 중…" /></p>
        ) : (roomsQ.data?.data ?? []).length === 0 ? (
          <EmptyState icon="🚪" title="진료 스케줄에 진료실이 없습니다" compact />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr><th className="py-1"><T k="진료실" /></th><th><T k="활성 스케줄" /></th><th><T k="공간" /></th></tr>
            </thead>
            <tbody>
              {roomsQ.data!.data.map((r) => (
                <tr key={r.name} className="border-t">
                  <td className="py-1.5">{r.name}</td>
                  <td>{r.activeSchedules}</td>
                  <td className="flex flex-wrap items-center gap-2 py-1">
                    <select className="min-h-[36px] rounded border px-2 text-sm" aria-label={tAttr('공간')}
                      value={r.space?.id ?? ''} disabled={roomMut.isPending}
                      onChange={(e) => roomMut.mutate({ name: r.name, spaceNodeId: e.target.value || null })}>
                      <option value="">{tAttr('연결 안 함(위치 미등록)')}</option>
                      {floors.map((f) => (
                        <optgroup key={f.id} label={f.name}>
                          {f.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    {r.suggestion && (
                      <button className="min-h-[44px] rounded-full border border-blue-200 px-3 text-[11px] text-blue-700"
                        disabled={roomMut.isPending}
                        onClick={() => roomMut.mutate({ name: r.name, spaceNodeId: r.suggestion!.spaceNodeId })}>
                        {tAttr('후보')}: {r.suggestion.name} — <T k="이 후보로 연결" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 병상 ↔ 공간(2026-10-02 · 통합 상황판 3D 병상) */}
      <BedLinkPanel floors={floors} />

      {/* 배치 입력 */}
      {form && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5">
            <h3 className="font-semibold">{form.assetLabel} — <T k="위치 기록" /></h3>
            <select className="w-full rounded border px-2 py-2 text-sm" value={form.spaceNodeId} onChange={(e) => setForm({ ...form, spaceNodeId: e.target.value })} aria-label={tAttr('공간')}>
              <option value="">{tAttr('공간을 선택하세요')}</option>
              {floors.map((f) => (
                <optgroup key={f.id} label={f.name}>
                  <option value={f.id}>{f.name} ({tAttr('층 단위 — 구역 미상')})</option>
                  {f.zones.map((z) => <option key={z.id} value={z.id}>{z.name}{z.roomNumber ? ` ${z.roomNumber}` : ''}</option>)}
                </optgroup>
              ))}
            </select>
            <input className="w-full rounded border px-2 py-2 text-sm" placeholder={tAttr('메모(선택)')} maxLength={300}
              value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            <div className="flex justify-end gap-2">
              <button className="min-h-[44px] rounded border px-4 text-sm" onClick={() => setForm(null)}><T k="취소" /></button>
              <button className="min-h-[44px] rounded bg-blue-600 px-4 text-sm text-white disabled:opacity-50"
                disabled={!form.spaceNodeId || placeMut.isPending} onClick={() => placeMut.mutate()}>
                <T k="기록" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 배치 종료 */}
      {ending && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5">
            <h3 className="font-semibold">{ending.label} — <T k="배치 종료" /></h3>
            <p className="text-[12px] text-gray-600"><T k="철거·반출·폐기 등으로 이 공간에서 빠졌을 때 씁니다. 자산 자체는 삭제되지 않습니다." /></p>
            <input className="w-full rounded border px-2 py-2 text-sm" placeholder={tAttr('종료 사유(필수)')} maxLength={300}
              value={endReason} onChange={(e) => setEndReason(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button className="min-h-[44px] rounded border px-4 text-sm" onClick={() => setEnding(null)}><T k="취소" /></button>
              <button className="min-h-[44px] rounded bg-red-600 px-4 text-sm text-white disabled:opacity-50"
                disabled={endReason.trim().length < 2 || endMut.isPending} onClick={() => endMut.mutate()}>
                <T k="종료" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 이력 */}
      {historyOf && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[80vh] w-full max-w-lg space-y-3 overflow-auto rounded-2xl bg-white p-5">
            <h3 className="font-semibold">{historyOf.label} — <T k="배치 이력" /></h3>
            {historyQ.isError ? (
              <QueryErrorFallback error={historyQ.error} onRetry={() => historyQ.refetch()} size="compact" />
            ) : historyQ.isLoading ? (
              <p className="text-sm text-gray-500"><T k="불러오는 중…" /></p>
            ) : (
              <ul className="space-y-2 text-sm">
                {(historyQ.data?.data ?? []).map((h) => (
                  <li key={h.id} className="rounded border px-3 py-2">
                    <div className="font-medium">{h.floor} · {h.space?.name ?? '—'}</div>
                    <div className="text-[12px] text-gray-500">
                      <KDate value={h.placedAt} mode="datetime" /> ~ {h.endedAt ? <KDate value={h.endedAt} mode="datetime" /> : tAttr('현재')}
                      {h.endReason && <> · {h.endReason === 'MOVED' ? tAttr('이동') : h.endReason}</>}
                    </div>
                    {h.legacyTextAtPlacement && <div className="text-[11px] text-gray-500"><T k="배치 시점 기존 텍스트" />: {h.legacyTextAtPlacement}</div>}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end"><button className="min-h-[44px] rounded border px-4 text-sm" onClick={() => setHistoryOf(null)}><T k="닫기" /></button></div>
          </div>
        </div>
      )}
    </div>
  );
}
