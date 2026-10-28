'use client';

// 공간 도면 가져오기 — space-import.v1 올리기·검증·확정 (API `/api/v1/space/imports` 첫 소비처)
// 기획 docs/01-plan/features/spatial-flow-vision-3d.plan.md P1
// 🔴 정직 표기 원칙:
//   - 확정은 사람이 한다. 검증 오류가 있으면 확정할 수 없다(서버가 다시 검증한다 — 화면 버튼만 막는 가짜 게이트가 아니다).
//   - 합성 도면(SYNTHETIC)은 "실제 건물 아님" 표식을 달고, 운영 모드 REAL 에서는 서버가 거부한다.
//   - 경고(도면에 없는 구역)는 확정을 막지 않는다 — 그 구역은 좌표가 생기지 않는다는 사실을 말할 뿐이다.
//   - 🔴 조회 실패는 "가져오기 0건"이 아니다.

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SPACE_IMPORT_STATUS_LABEL, SYNTHETIC_GEOMETRY_NOTICE } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { EmptyState, KDate } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

/** 서버는 검증 결과를 코드·값으로만 준다(서버 조립 한국어 금지) — 문장은 여기서 조립한다 */
interface ImportIssue { code: string; floor?: string; space?: string; other?: string; value?: string | number; names?: string[] }
const ISSUE_TEXT: Record<string, string> = {
  SCHEMA: '형식이 space-import.v1 이 아닙니다',
  NO_FLOORS: '층이 없습니다',
  FLOOR_CODE_UNKNOWN: '{층}: 층 코드 {값} 이(가) 공간 모델에 없습니다',
  BAD_RECT: '{층} {공간}: 사각형이 올바르지 않습니다',
  SPACE_CODE_UNKNOWN: '{층} {공간}: 공간 코드 {값} 이(가) 공간 모델에 없습니다',
  SPACE_FLOOR_MISMATCH: '{층} {공간}: {값} 은(는) 공간 모델에서 {다른}층입니다',
  DUP_CODE: '공간 코드 {값} 이(가) 두 번 나옵니다',
  OVERLAP: '{층}: {공간} ↔ {다른} 이(가) 겹칩니다',
  CONN_BROKEN: '{층}: 연결 {값} 이(가) 없는 공간을 가리킵니다',
  EDGE_BROKEN: '{층}: 동선 간선 {값} 이(가) 끊겼습니다',
  VERTICAL_BROKEN: '수직 연결 {값} 이(가) 끊겼습니다',
  ENTRANCE_BROKEN: '{층} 출입구 {공간} 이(가) 동선 그래프에 없습니다',
  MISSING_ZONES: '{층}: 도면에 없는 구역 {값}개 — {이름}',
  NO_MAIN_ENTRANCE: '주출입구가 지정되지 않았습니다 — 길안내 기본 출발점이 없습니다',
};
function IssueText({ i }: { i: ImportIssue }) {
  const k = ISSUE_TEXT[i.code];
  if (!k) return <span className="font-mono">{i.code}</span>; // 모르는 코드는 코드 그대로(지어내지 않는다)
  return <Tf k={k} params={{ 층: i.floor ?? '', 공간: i.space ?? '', 다른: i.other ?? '', 값: i.value ?? '', 이름: (i.names ?? []).join(', ') }} />;
}

interface ImportSummary {
  errors: ImportIssue[];
  warnings: ImportIssue[];
  floors: { key: string; spaces: number; mapped: number; connections: number; missingZones: string[] }[];
  totals: { spaces: number; mapped: number; connections: number; graphEdges: number; entrances: number };
}
interface ImportRow {
  id: string;
  source: 'SYNTHETIC' | 'DRAWING';
  status: 'DRAFT' | 'CONFIRMED' | 'REJECTED' | 'SUPERSEDED';
  title: string;
  summary: ImportSummary;
  confirmedAt: string | null;
  rejectedReason: string | null;
  createdAt: string;
}

export default function SpaceModelPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [actKind, setActKind] = useState<'reject' | 'withdraw'>('reject');
  const [reason, setReason] = useState('');

  const listQ = useQuery({ queryKey: ['space-imports'], queryFn: () => apiClient.get<{ data: ImportRow[] }>('/api/v1/space/imports') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['space-imports'] });

  const uploadMut = useMutation({
    mutationFn: async () => {
      const f = fileRef.current?.files?.[0];
      if (!f) throw new Error(tAttr('파일을 선택하세요'));
      let payload: unknown;
      try { payload = JSON.parse(await f.text()); } catch { throw new Error(tAttr('JSON 파일이 아닙니다')); }
      return apiClient.post('/api/v1/space/imports', { title: title.trim() || f.name, payload });
    },
    onSuccess: () => { toast.success(tAttr('초안으로 올렸습니다 — 검증 결과를 확인한 뒤 확정하세요')); setTitle(''); if (fileRef.current) fileRef.current.value = ''; refresh(); },
    onError: (e: Error) => toast.error(e.message || tAttr('올리기에 실패했습니다')),
  });
  const confirmMut = useMutation({
    mutationFn: (id: string) => apiClient.post<{ data: { appliedNodes: number; superseded: number } }>(`/api/v1/space/imports/${id}/confirm`, {}),
    onSuccess: () => { toast.success(tAttr('확정했습니다 — 공간 모델에 좌표를 반영했습니다')); refresh(); },
    onError: (e: Error) => toast.error(e.message || tAttr('확정에 실패했습니다')),
  });
  const rejectMut = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/space/imports/${rejecting}/${actKind}`, { reason: reason.trim() }),
    onSuccess: () => { toast.success(actKind === 'withdraw' ? tAttr('철회했습니다 — 공간 모델의 좌표를 회수했습니다') : tAttr('반려했습니다')); setRejecting(null); setReason(''); refresh(); },
    onError: (e: Error) => toast.error(e.message || tAttr('반려에 실패했습니다')),
  });

  const rows = (listQ.data?.data ?? []) as ImportRow[];

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold"><T k="공간 도면 가져오기" /></h1>
        <p className="text-sm text-gray-600">
          <T k="층별 방·문·동선을 담은 도면 데이터(space-import.v1)를 올리고, 검증 결과를 확인한 뒤 사람이 확정합니다. 확정된 도면만 동선 뷰어와 길안내에 쓰입니다." />
        </p>
      </header>

      <section className="space-y-2 rounded-2xl border p-4">
        <h2 className="font-semibold"><T k="올리기" /></h2>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="application/json,.json" className="text-sm" aria-label={tAttr('도면 JSON 파일')} />
          <input className="min-h-[44px] flex-1 rounded border px-2 text-sm" placeholder={tAttr('제목(선택)')} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="min-h-[44px] rounded bg-blue-600 px-4 text-sm text-white disabled:opacity-50" disabled={uploadMut.isPending} onClick={() => uploadMut.mutate()}>
            <T k="초안으로 올리기" />
          </button>
        </div>
        <p className="text-[12px] text-gray-500"><T k="합성 도면은 운영 모드 REAL 에서 거부됩니다." /></p>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold"><T k="가져오기 기록" /></h2>
        {listQ.isError ? (
          <QueryErrorFallback error={listQ.error} onRetry={() => listQ.refetch()} size="compact" />
        ) : listQ.isLoading ? (
          <p className="text-sm text-gray-500"><T k="불러오는 중…" /></p>
        ) : rows.length === 0 ? (
          <EmptyState icon="🗺️" title="올린 도면이 없습니다" compact />
        ) : rows.map((r) => {
          const s = r.summary;
          const canConfirm = r.status === 'DRAFT' && s.errors.length === 0;
          return (
            <div key={r.id} className="space-y-2 rounded-2xl border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{r.title}</span>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px]"><T k={SPACE_IMPORT_STATUS_LABEL[r.status]} /></span>
                {r.source === 'SYNTHETIC' && <span className="rounded border border-red-300 px-2 py-0.5 text-[11px] text-red-700"><T k={SYNTHETIC_GEOMETRY_NOTICE} /></span>}
                <span className="text-[11px] text-gray-500"><KDate value={r.createdAt} mode="datetime" /></span>
              </div>
              <div className="text-[12px] text-gray-700">
                <T k="공간" /> {s.totals.spaces} · <T k="공간 모델 연결" /> {s.totals.mapped} · <T k="문·개구부" /> {s.totals.connections} · <T k="동선 간선" /> {s.totals.graphEdges} · <T k="출입구" /> {s.totals.entrances}
              </div>
              <div className="flex flex-wrap gap-1">
                {s.floors.map((f) => (
                  <span key={f.key} className="rounded-full border px-2 py-0.5 text-[11px]" title={f.missingZones.join(', ')}>
                    {f.key} · {f.mapped}/{f.spaces}{f.missingZones.length ? ` · ⚠${f.missingZones.length}` : ''}
                  </span>
                ))}
              </div>
              {s.errors.length > 0 && (
                <details open className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
                  <summary className="cursor-pointer font-semibold"><T k="검증 오류" /> {s.errors.length} — <T k="확정할 수 없습니다" /></summary>
                  <ul className="mt-1 list-disc pl-5">{s.errors.slice(0, 30).map((e, i) => <li key={i}><IssueText i={e} /></li>)}</ul>
                </details>
              )}
              {s.warnings.length > 0 && (
                <details className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                  <summary className="cursor-pointer"><T k="경고" /> {s.warnings.length}</summary>
                  <ul className="mt-1 list-disc pl-5">{s.warnings.map((e, i) => <li key={i}><IssueText i={e} /></li>)}</ul>
                </details>
              )}
              {r.rejectedReason && <p className="text-[12px] text-gray-600"><T k="반려 사유" />: {r.rejectedReason}</p>}
              {r.status === 'DRAFT' && (
                <div className="flex gap-2">
                  <button className="min-h-[44px] rounded bg-emerald-600 px-4 text-sm text-white disabled:opacity-50" disabled={!canConfirm || confirmMut.isPending} onClick={() => confirmMut.mutate(r.id)}>
                    <T k="확정" />
                  </button>
                  <button className="min-h-[44px] rounded border border-red-200 px-4 text-sm text-red-700" onClick={() => { setActKind('reject'); setRejecting(r.id); }}><T k="반려" /></button>
                </div>
              )}
              {r.status === 'CONFIRMED' && (
                <button className="min-h-[44px] rounded border border-red-200 px-4 text-sm text-red-700" onClick={() => { setActKind('withdraw'); setRejecting(r.id); }}>
                  <T k="확정 철회(좌표 회수)" />
                </button>
              )}
            </div>
          );
        })}
      </section>

      {rejecting && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5">
            <h3 className="font-semibold">{actKind === 'withdraw' ? <T k="확정 철회(좌표 회수)" /> : <T k="반려" />}</h3>
            {actKind === 'withdraw' && <p className="text-[12px] text-gray-600"><T k="철회하면 동선 뷰어·길안내가 이 도면을 쓰지 않고, 공간 모델의 좌표가 회수됩니다. 기록은 남습니다." /></p>}
            <input className="min-h-[44px] w-full rounded border px-2 text-sm" placeholder={tAttr('사유(필수)')} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button className="min-h-[44px] rounded border px-4 text-sm" onClick={() => setRejecting(null)}><T k="취소" /></button>
              <button className="min-h-[44px] rounded bg-red-600 px-4 text-sm text-white disabled:opacity-50" disabled={reason.trim().length < 2 || rejectMut.isPending} onClick={() => rejectMut.mutate()}>
                {actKind === 'withdraw' ? <T k="철회" /> : <T k="반려" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
