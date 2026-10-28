'use client';

/**
 * 자산 배치 편집(관리자) — 도면 뷰어(2D·3D) 옆에서 미배치 자산을 골라 방에 놓고, 놓인 자산을 옮기거나 배치를 끝낸다.
 * 기존 배치 원장 API(`/api/v1/space-assets`)만 쓴다 — 새 쓰기 경로 없음.
 *
 * 🔴 정직 표기:
 *   - **좌표는 확정 도면(DRAWING_CONFIRMED·SURVEYED)에서만** 기록한다(서버 규칙). 합성 도면이면 방 단위로 기록하고,
 *     3D 의 방 안 정렬은 위치가 아니라고 말한다.
 *   - 후보 방은 기존 자유 텍스트에서 찾은 **제안**이다 — 자동 배치는 없다(사람이 방을 누른다).
 *   - 배치 종료는 사유 필수 · 자산 행은 건드리지 않는다 · 자체 테이블이 위치를 가진 자산(NATIVE)은 여기서 바꾸지 않는다.
 *   - 조회 실패는 "미배치 0"이 아니다.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ASSET_KINDS, ASSET_KIND_META, PLACEMENT_SOURCE_LABEL, type AssetKind, type PlacementSource } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { KDate, Ratio } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import type { GeoSpace } from './FloorPlanSvg';
import type { AssetMarker } from './space-scene';

export interface PlacementRow {
  placementId: string | null;
  kind: AssetKind;
  kindLabel: string;
  source: PlacementSource;
  asset: { id: string; label: string; detail: string | null } | null;
  space: { id: string; name: string; floor: number | null } | null;
  x: number | null;
  y: number | null;
  placedAt: string | null;
}
interface Suggestion { spaceNodeId: string; name: string; floor: number | null; score: number }
interface UnplacedItem { asset: { id: string; label: string; detail: string | null; legacyText: string | null }; suggestions: Suggestion[] }
interface CoverageRow { kind: AssetKind; label: string; placeable: boolean; active: number; placed: number }

export interface PlacingState {
  kind: AssetKind;
  assetId: string;
  label: string;
  suggestions: Suggestion[];
  /** 옮기기면 원래 공간 이름 */
  movingFrom?: string | null;
}

export const PLACEMENT_QUERY_KEYS = [['space-viewer-assets'], ['space-asset-unplaced'], ['space-asset-coverage']] as const;

const PLACEABLE_KINDS = ASSET_KINDS.filter((k) => ASSET_KIND_META[k].placeable);
const floorLabel = (f: number | null) => (f == null ? '' : f < 0 ? `B${-f}` : `${f}F`);

export function AssetPlacementPanel({
  synthetic,
  placing,
  setPlacing,
  picked,
  pickedPoint,
  selectedAsset,
  setSelectedAsset,
  rows,
}: {
  /** 도면이 합성인가 — 좌표를 보내지 않는다 */
  synthetic: boolean;
  placing: PlacingState | null;
  setPlacing: (p: PlacingState | null) => void;
  picked: GeoSpace | null;
  pickedPoint: [number, number] | null;
  selectedAsset: AssetMarker | null;
  setSelectedAsset: (m: AssetMarker | null) => void;
  rows: PlacementRow[];
}) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [kind, setKind] = useState<AssetKind>('WORKSTATION_PROFILE');
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const [endReason, setEndReason] = useState('');

  const coverageQ = useQuery({
    queryKey: ['space-asset-coverage'],
    queryFn: () => apiClient.get<{ data: CoverageRow[] }>('/api/v1/space-assets/coverage'),
  });
  const unplacedQ = useQuery({
    queryKey: ['space-asset-unplaced', kind],
    queryFn: () => apiClient.get<{ data: { items: UnplacedItem[] } }>(`/api/v1/space-assets/unplaced?kind=${kind}`),
    enabled: !placing && !selectedAsset,
  });
  const refresh = () => { for (const k of PLACEMENT_QUERY_KEYS) qc.invalidateQueries({ queryKey: [...k] }); };

  const placeM = useMutation({
    mutationFn: (v: { spaceNodeId: string; x?: number; y?: number }) => apiClient.post('/api/v1/space-assets/placements', {
      kind: placing!.kind, assetId: placing!.assetId, spaceNodeId: v.spaceNodeId,
      ...(v.x != null && v.y != null ? { x: v.x, y: v.y } : {}), source: 'MANUAL', ...(note.trim() ? { note: note.trim() } : {}),
    }),
    onSuccess: () => { toast.success(tAttr('자산을 배치했습니다')); setPlacing(null); setNote(''); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : tAttr('배치 실패')),
  });
  const endM = useMutation({
    mutationFn: (placementId: string) => apiClient.post(`/api/v1/space-assets/placements/${placementId}/end`, { reason: endReason.trim() }),
    onSuccess: () => { toast.success(tAttr('배치를 종료했습니다')); setSelectedAsset(null); setEndReason(''); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : tAttr('종료 실패')),
  });

  const coverage = (coverageQ.data?.data ?? []).filter((c) => c.placeable);
  const placedSum = coverage.reduce((a, c) => a + c.placed, 0);
  const activeSum = coverage.reduce((a, c) => a + c.active, 0);
  const selRow = selectedAsset ? rows.find((r) => r.kind === selectedAsset.kind && r.asset?.id === selectedAsset.assetId) ?? null : null;
  const items = (unplacedQ.data?.data.items ?? []).filter((i) => !q.trim() || `${i.asset.label} ${i.asset.detail ?? ''} ${i.asset.legacyText ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="space-y-3 rounded-2xl border border-indigo-200 bg-white p-3 text-sm shadow-sm">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-indigo-900"><T k="자산 배치 편집" /></p>
        {coverageQ.isError ? null : coverage.length > 0 && (
          <span className="text-[11px] text-gray-500"><T k="배치" /> <Ratio numerator={placedSum} denominator={activeSum} /></span>
        )}
      </div>
      {coverageQ.isError && <QueryErrorFallback error={coverageQ.error} onRetry={() => coverageQ.refetch()} size="compact" />}
      <p className="rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">
        {synthetic
          ? <T k="합성 도면이라 좌표는 기록하지 않습니다 — 방 단위로 기록하고, 3D 에서는 방 안에 자동 정렬해 그립니다(정렬 위치는 실제 위치가 아닙니다)." />
          : <T k="확정 도면입니다 — 방을 누른 지점이 좌표로 기록됩니다." />}
      </p>

      {placing ? (
        <div className="space-y-2">
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[12px] text-amber-900">
            <Tf k="「{자산}」을 놓을 방을 누르세요" params={{ 자산: placing.label }} />
            {placing.movingFrom && <> · <Tf k="지금 위치: {방}" params={{ 방: placing.movingFrom }} /></>}
          </p>
          {placing.suggestions.length > 0 && (
            <div className="text-[11px] text-gray-600">
              <p className="mb-1 font-medium"><T k="기존 텍스트에서 찾은 후보 방(노란색 · 제안일 뿐)" /></p>
              <div className="flex flex-wrap gap-1">
                {placing.suggestions.map((s) => (
                  <span key={s.spaceNodeId} className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">{floorLabel(s.floor)} {s.name}</span>
                ))}
              </div>
            </div>
          )}
          {picked?.spaceNodeId && (
            <div className="space-y-1.5 rounded-lg border p-2">
              <p className="text-[12px]"><Tf k="놓을 곳: {방}" params={{ 방: <b>{picked.name}</b> }} /></p>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={tAttr('메모(선택)')}
                className="min-h-[36px] w-full rounded border px-2 text-[12px]" />
              <button disabled={placeM.isPending} onClick={() => placeM.mutate({
                spaceNodeId: picked.spaceNodeId!,
                ...(synthetic || !pickedPoint ? {} : { x: pickedPoint[0], y: pickedPoint[1] }),
              })} className="min-h-[44px] w-full rounded-lg bg-indigo-600 text-[12px] font-medium text-white disabled:opacity-40">
                {placing.movingFrom ? <T k="여기로 옮기기" /> : <T k="여기에 배치" />}
              </button>
            </div>
          )}
          <button onClick={() => setPlacing(null)} className="min-h-[36px] w-full rounded-lg border text-[12px] text-gray-600"><T k="취소" /></button>
        </div>
      ) : selectedAsset ? (
        <div className="space-y-2">
          <div>
            <p className="font-semibold">{selectedAsset.label}</p>
            <p className="text-[11px] text-gray-500"><T k={ASSET_KIND_META[selectedAsset.kind as AssetKind]?.label ?? selectedAsset.kind} />{selRow?.asset?.detail ? ` · ${selRow.asset.detail}` : ''}</p>
          </div>
          {selRow && (
            <div className="space-y-0.5 text-[12px] text-gray-700">
              <p><Tf k="위치: {방}" params={{ 방: <b>{selRow.space?.name ?? '-'}</b> }} /> {selRow.space && <span className="text-gray-400">{floorLabel(selRow.space.floor)}</span>}</p>
              <p className="text-[11px] text-gray-500">
                <T k={PLACEMENT_SOURCE_LABEL[selRow.source]} /> · {selRow.x != null ? <T k="좌표 기록됨" /> : <T k="방 단위(좌표 없음)" />}
                {selRow.placedAt && <> · <KDate value={selRow.placedAt} mode="datetimeShort" /></>}
              </p>
            </div>
          )}
          {selectedAsset.placementId ? (<>
            <button onClick={() => setPlacing({ kind: selectedAsset.kind as AssetKind, assetId: selectedAsset.assetId, label: selectedAsset.label, suggestions: [], movingFrom: selRow?.space?.name ?? null })}
              className="min-h-[44px] w-full rounded-lg border border-indigo-300 text-[12px] font-medium text-indigo-700 hover:bg-indigo-50">
              <T k="다른 방으로 옮기기" />
            </button>
            <div className="space-y-1 border-t pt-2">
              <input value={endReason} onChange={(e) => setEndReason(e.target.value)} maxLength={300} placeholder={tAttr('종료 사유(철거·반출·폐기 등 — 필수)')}
                className="min-h-[36px] w-full rounded border px-2 text-[12px]" />
              <button disabled={endReason.trim().length < 2 || endM.isPending} onClick={() => endM.mutate(selectedAsset.placementId!)}
                className="min-h-[44px] w-full rounded-lg border border-rose-300 text-[12px] font-medium text-rose-700 disabled:opacity-40">
                <T k="배치 종료" />
              </button>
            </div>
          </>) : (
            <p className="text-[11px] text-gray-500"><T k="이 자산은 자기 테이블이 위치를 관리합니다 — 여기서 바꾸지 않습니다." /></p>
          )}
          <button onClick={() => setSelectedAsset(null)} className="min-h-[36px] w-full rounded-lg text-[12px] text-gray-500 underline"><T k="선택 해제" /></button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-1.5">
            <select value={kind} onChange={(e) => setKind(e.target.value as AssetKind)} aria-label={tAttr('자산 종류')}
              className="min-h-[36px] flex-1 rounded border px-1 text-[12px]">
              {PLACEABLE_KINDS.map((k) => {
                const c = coverage.find((x) => x.kind === k);
                return <option key={k} value={k}>{tAttr(ASSET_KIND_META[k].label)}{c ? ` (${c.active - c.placed})` : ''}</option>;
              })}
            </select>
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tAttr('이름·기존 위치 텍스트로 찾기')}
            className="min-h-[36px] w-full rounded border px-2 text-[12px]" />
          {unplacedQ.isError ? <QueryErrorFallback error={unplacedQ.error} onRetry={() => unplacedQ.refetch()} size="compact" />
            : unplacedQ.isLoading ? <p className="text-[12px] text-gray-500"><T k="불러오는 중…" /></p>
            : items.length === 0 ? <p className="text-[12px] text-gray-500"><T k="미배치 자산이 없습니다" /></p>
            : (
              <ul className="max-h-[320px] space-y-1 overflow-y-auto pr-1">
                {items.map((i) => (
                  <li key={i.asset.id}>
                    <button onClick={() => { setSelectedAsset(null); setPlacing({ kind, assetId: i.asset.id, label: i.asset.label, suggestions: i.suggestions }); }}
                      className="w-full rounded-lg border px-2 py-1.5 text-left hover:border-indigo-300 hover:bg-indigo-50">
                      <p className="truncate text-[12px] font-medium">{i.asset.label}</p>
                      <p className="truncate text-[10px] text-gray-500">
                        {i.asset.legacyText ? <Tf k="기존 위치 텍스트: {텍스트}" params={{ 텍스트: i.asset.legacyText }} /> : <T k="기존 위치 텍스트 없음" />}
                        {i.suggestions.length > 0 && <> · <Tf k="후보 {수}" params={{ 수: i.suggestions.length }} /></>}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </div>
  );
}

/** 배치 원장 행 → 3D 표식 */
export function placementMarkers(rows: PlacementRow[]): AssetMarker[] {
  return rows
    .filter((r) => r.space && r.asset)
    .map((r) => ({
      placementId: r.placementId, kind: r.kind, assetId: r.asset!.id,
      group: ASSET_KIND_META[r.kind]?.group ?? 'IT', label: r.asset!.label,
      spaceNodeId: r.space!.id, x: r.x, y: r.y,
    }));
}
