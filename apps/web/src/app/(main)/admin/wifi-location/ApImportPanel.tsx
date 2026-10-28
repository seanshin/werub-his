'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { WIFI_AP_CSV_ERROR_LABEL, WIFI_AP_IMPORT_MAX_ROWS, type WifiApCsvError } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { T, Tf } from '@/components/ui/i18n-text';

/**
 * AP 등록부 CSV 가져오기(2026-10-10) — 실제 설치 도면을 받으면 한 대씩 치지 않게.
 *  · 미리보기(쓰기 0) → 오류가 하나도 없을 때만 적용 버튼이 열린다(일부만 들어간 등록부를 만들지 않는다)
 *  · create-only — 이미 있는 BSSID 는 건너뜀(관리자가 고친 좌표·교정을 덮지 않는다)
 */
type ImportErrorReason = WifiApCsvError | 'FLOOR_NOT_IN_DRAWING';
interface ImportResult {
  total: number; valid: number; create: number; floors: string[];
  errors: Array<{ line: number; reason: ImportErrorReason; value?: string }>;
  skipExisting: Array<{ line: number; bssid: string }>;
  applied: boolean; created: number;
}
const reasonLabel = (r: ImportErrorReason) => (r === 'FLOOR_NOT_IN_DRAWING' ? '확정 도면에 없는 층입니다' : WIFI_AP_CSV_ERROR_LABEL[r]);

export function ApImportPanel() {
  const qc = useQueryClient();
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const run = useMutation({
    mutationFn: (dryRun: boolean) => apiClient.post<{ data: ImportResult }>('/api/v1/location/wifi/access-points/import', { csv, dryRun }).then((r) => r.data),
    onSuccess: (r) => {
      setPreview(r);
      if (r.applied) { qc.invalidateQueries({ queryKey: ['wifi-aps'] }); qc.invalidateQueries({ queryKey: ['wifi-status'] }); }
    },
  });
  const canApply = !!preview && !preview.applied && preview.errors.length === 0 && preview.create > 0;
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" data-wifi-ap-import id="wifi-ap-import">
      <h2 className="text-sm font-bold text-gray-900"><T k="AP 등록부 CSV 가져오기" /></h2>
      <p className="mt-1 text-[11px] text-gray-500">
        <Tf k="첫 줄 머리글 bssid,label,floorKey,x,y,vendor · 한 번에 {n}행까지 · 미리보기 먼저 — 오류가 하나라도 있으면 아무것도 넣지 않습니다 · 이미 있는 BSSID 는 건너뜁니다." params={{ n: WIFI_AP_IMPORT_MAX_ROWS }} />
      </p>
      <textarea value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); }} rows={5} placeholder={'bssid,label,floorKey,x,y,vendor\naa:bb:cc:dd:ee:01,3F 간호스테이션,3F,12.5,8,'}
        className="mt-2 w-full rounded border px-2 py-1 font-mono text-xs" data-wifi-ap-import-csv />
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="min-h-[44px] rounded border border-gray-300 px-3 text-xs disabled:opacity-40" disabled={!csv.trim() || run.isPending} onClick={() => run.mutate(true)} data-wifi-ap-import-preview><T k="미리보기" /></button>
        <button type="button" className="min-h-[44px] rounded bg-gray-900 px-3 text-xs text-white disabled:opacity-40" disabled={!canApply || run.isPending} onClick={() => run.mutate(false)} data-wifi-ap-import-apply>
          {preview && preview.create > 0 ? <Tf k="{n}대 등록" params={{ n: preview.create }} /> : <T k="등록" />}
        </button>
      </div>
      {run.isError && <p className="mt-2 text-xs text-rose-700"><T k="가져오지 못했습니다" /></p>}
      {preview && (
        <div className="mt-2 space-y-1 rounded-xl bg-gray-50 p-3 text-xs" data-wifi-ap-import-result={preview.applied ? 'applied' : 'preview'}>
          <p>
            {preview.applied
              ? <Tf k="등록 {n}대 완료" params={{ n: preview.created }} />
              : <Tf k="유효 {유효}행 · 새로 등록 {새}대 · 이미 있음 {있음}대 · 오류 {오류}건" params={{ 유효: preview.valid, 새: preview.create, 있음: preview.skipExisting.length, 오류: preview.errors.length }} />}
            {preview.floors.length > 0 && <> · <T k="층" /> {preview.floors.join(', ')}</>}
          </p>
          {preview.errors.length > 0 && (
            <ul className="max-h-40 overflow-auto text-rose-700" data-wifi-ap-import-errors>
              {preview.errors.map((e, i) => (
                <li key={`${e.line}-${i}`}><Tf k="{줄}번째 줄" params={{ 줄: e.line }} />: <T k={reasonLabel(e.reason)} />{e.value ? ` (${e.value})` : ''}</li>
              ))}
            </ul>
          )}
          {!preview.applied && preview.errors.length === 0 && preview.create === 0 && <p className="text-gray-600"><T k="새로 등록할 AP 가 없습니다" /></p>}
        </div>
      )}
    </section>
  );
}
