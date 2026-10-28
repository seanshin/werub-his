'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { EmptyState } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

interface BedRow {
  bedId: string;
  ward: { id: string; name: string; floor: number; type: string };
  roomNumber: string;
  bedNumber: string;
  space: { id: string; name: string; floor: number | null } | null;
  suggestion: { spaceNodeId: string; name: string; floor: number | null } | null;
}
interface ZoneOpt { id: string; name: string }
interface FloorOpt { id: string; name: string; zones: ZoneOpt[] }

/** 병실(병동·호실) 단위 묶음 — 한 방의 병상은 같은 공간에 있다 */
export function groupBedRooms(rows: BedRow[]) {
  const m = new Map<string, { key: string; ward: BedRow['ward']; roomNumber: string; beds: BedRow[] }>();
  for (const r of rows) {
    const key = `${r.ward.id}:${r.roomNumber}`;
    const cur = m.get(key) ?? { key, ward: r.ward, roomNumber: r.roomNumber, beds: [] };
    cur.beds.push(r);
    m.set(key, cur);
  }
  return [...m.values()];
}

/**
 * 병상 ↔ 도면 공간(2026-10-02 · 통합 상황판 3D 병상).
 * 🔴 사람이 잇는다 — 층·호실이 같은 병실(응급 병동은 응급실 한 공간)이 **하나뿐일 때만** 후보로 보이고, 누를 때 연결된다.
 *    응급실은 도면에 구역 칸이 없어 구역별 위치를 잇지 않는다(한 공간).
 */
export function BedLinkPanel({ floors }: { floors: FloorOpt[] }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['space-assets', 'bed-links'],
    queryFn: () => apiClient.get<{ data: BedRow[] }>('/api/v1/space-assets/bed-links'),
  });
  const done = () => qc.invalidateQueries({ queryKey: ['space-assets', 'bed-links'] });
  const setMut = useMutation({
    mutationFn: (v: { bedIds: string[]; spaceNodeId: string | null }) => apiClient.put('/api/v1/space-assets/bed-links', v),
    onSuccess: () => { toast.success(tAttr('병상 공간 연결을 저장했습니다')); done(); },
    onError: (e: Error) => toast.error(e.message || tAttr('병상 공간 연결에 실패했습니다')),
  });
  const bulkMut = useMutation({
    mutationFn: () => apiClient.post<{ data: { linked: number; noSuggestion: number } }>('/api/v1/space-assets/bed-links/link-suggested', {}),
    onSuccess: (r) => {
      const d = (r as { data?: { linked: number; noSuggestion: number } }).data;
      toast.success(`${tAttr('후보가 하나뿐인 병상을 연결했습니다')} (${d?.linked ?? 0})`);
      done();
    },
    onError: (e: Error) => toast.error(e.message || tAttr('일괄 연결에 실패했습니다')),
  });
  const rows = (q.data?.data ?? []) as BedRow[];
  const rooms = useMemo(() => groupBedRooms(rows), [rows]);
  const suggested = rows.filter((r) => !r.space && r.suggestion).length;
  const unlinked = rows.filter((r) => !r.space).length;

  return (
    <section className="space-y-2" data-bed-links>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold"><T k="병상 공간 연결" /></h2>
        {suggested > 0 && (
          <button className="min-h-[44px] rounded bg-blue-600 px-3 text-[12px] text-white disabled:opacity-50" disabled={bulkMut.isPending} onClick={() => bulkMut.mutate()}>
            <T k="후보가 하나뿐인 병상 일괄 연결" /> ({suggested})
          </button>
        )}
        {!q.isLoading && !q.isError && <span className="text-[12px] text-gray-500"><Tf k="미연결 {미}/{전체}" params={{ 미: unlinked, 전체: rows.length }} /></span>}
      </div>
      <p className="text-[12px] text-gray-500">
        <T k="연결된 병상만 통합 상황판 3D 에 표식으로 그려집니다. 층·호실이 같은 병실이 하나뿐일 때만 후보로 보이며 누를 때 연결됩니다. 응급 병동은 도면에 구역 칸이 없어 응급실 한 공간으로 잇습니다." />
      </p>
      {q.isError ? <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} size="compact" />
        : q.isLoading ? <p className="text-sm text-gray-500"><T k="불러오는 중…" /></p>
        : rooms.length === 0 ? <EmptyState icon="🛏️" title="등록된 병상이 없습니다" compact />
        : (
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr><th className="py-1"><T k="병동" /></th><th><T k="호실" /></th><th><T k="병상" /></th><th><T k="공간" /></th></tr>
            </thead>
            <tbody>
              {rooms.map((room) => {
                const linked = room.beds.find((b) => b.space)?.space ?? null;
                const mixed = new Set(room.beds.map((b) => b.space?.id ?? '')).size > 1;
                const sug = room.beds.find((b) => !b.space && b.suggestion)?.suggestion ?? null;
                const ids = room.beds.map((b) => b.bedId);
                return (
                  <tr key={room.key} className="border-t" data-bed-room={room.key}>
                    <td className="py-1.5">{room.ward.name}</td>
                    <td>{room.roomNumber}</td>
                    <td>{room.beds.length}</td>
                    <td className="flex flex-wrap items-center gap-2 py-1">
                      <select className="min-h-[36px] rounded border px-2 text-sm" aria-label={tAttr('공간')}
                        value={mixed ? '__mixed' : linked?.id ?? ''} disabled={setMut.isPending}
                        onChange={(e) => setMut.mutate({ bedIds: ids, spaceNodeId: e.target.value || null })}>
                        {mixed && <option value="__mixed" disabled>{tAttr('병상마다 다름')}</option>}
                        <option value="">{tAttr('연결 안 함(위치 미등록)')}</option>
                        {floors.map((f) => (
                          <optgroup key={f.id} label={f.name}>
                            {f.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                          </optgroup>
                        ))}
                      </select>
                      {sug && (
                        <button className="min-h-[44px] rounded-full border border-blue-200 px-3 text-[11px] text-blue-700" disabled={setMut.isPending}
                          onClick={() => setMut.mutate({ bedIds: room.beds.filter((b) => !b.space).map((b) => b.bedId), spaceNodeId: sug.spaceNodeId })}>
                          {tAttr('후보')}: {sug.name} — <T k="이 후보로 연결" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
    </section>
  );
}
