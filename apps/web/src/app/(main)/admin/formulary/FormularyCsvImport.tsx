'use client';

/**
 * 포뮬러리 CSV 일괄 등재 — ① 미리보기(서버 판정·쓰기 없음) → ② 확정(서버가 다시 판정한 뒤 행마다 등재 정본 호출).
 * 🔴 행 단위로 말한다: 오류 행은 사유와 함께 남고, 확정 결과는 생성·재활성화·적용 실패를 따로 센다(전체 성공으로 뭉개지 않는다).
 * 🔴 코드는 정확 일치만 — 이름으로 찾거나 비슷한 코드를 고르지 않는다(여러 버전이면 열로 좁히라고 말한다).
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

type Action = 'CREATE' | 'REACTIVATE' | 'UNCHANGED' | 'ERROR';
interface CsvRow {
  line: number; code: string | null; presetKey: string | null; note: string | null;
  action: Action; error: string | null; codeId: string | null; label: string | null; previousStatus: string | null;
}
interface CsvResult {
  dryRun: boolean; domain: string; unknownColumns: string[];
  summary: { total: number; create: number; reactivate: number; unchanged: number; error: number };
  applied: { created: number; reactivated: number; applyFailed: number } | null;
  rows: CsvRow[];
}

/** 오류 사유 코드 → 화면 문구(원문 키) — 서버 `formulary-csv.ts` CsvRowError 와 1:1 */
const ERROR_TEXT: Record<string, string> = {
  MISSING_CODE: '코드가 비어 있습니다',
  MISSING_PRESET_KEY: '프리셋 키가 비어 있습니다',
  NOT_FOUND: '마스터에 없는 코드입니다(정확 일치만)',
  MASTER_INACTIVE: '마스터에서 비활성인 코드입니다',
  AMBIGUOUS: '여러 마스터 행과 일치합니다 — validFrom 또는 codeSystem 열로 좁혀 주세요',
  BAD_VALID_FROM: 'validFrom 은 YYYY-MM-DD 형식이어야 합니다',
  UNKNOWN_PRESET: '정본 프리셋 목록에 없는 키입니다',
  DUPLICATE_IN_FILE: '파일 안에서 앞 행과 중복입니다',
  APPLY_FAILED: '적용 중 실패했습니다',
};

const ACTION_TEXT: Record<Action, string> = { CREATE: '신규 등재', REACTIVATE: '재활성화', UNCHANGED: '이미 등재(변경 없음)', ERROR: '오류' };
const ACTION_CLS: Record<Action, string> = {
  CREATE: 'bg-blue-50 text-blue-700', REACTIVATE: 'bg-amber-50 text-amber-700', UNCHANGED: 'bg-gray-100 text-gray-500', ERROR: 'bg-red-50 text-red-700',
};

export function FormularyCsvImport({ domain, isPreset, committee, note, onApplied }: {
  domain: string; isPreset: boolean; committee: string; note: string; onApplied: () => void;
}) {
  const tAttr = useTAttr();
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<CsvResult | null>(null);
  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      apiClient.post<{ data: CsvResult }>('/api/v1/formulary/import-csv', {
        domain, csv, dryRun, ...(committee.trim() ? { committee: committee.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: (r) => {
      const d = (r as { data: CsvResult }).data;
      setResult(d);
      if (!d.dryRun) {
        onApplied();
        if (d.applied && d.applied.applyFailed > 0) toast.error(tAttr('일부 행은 적용하지 못했습니다 — 결과 표를 확인하세요.'));
        else toast.success(tAttr('CSV 일괄 등재를 반영했습니다.'));
      }
    },
    onError: () => toast.error(tAttr('CSV 를 처리하지 못했습니다.')),
  });

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setCsv(await f.text());
    setResult(null);
  };

  const canApply = !!result && result.dryRun && result.summary.create + result.summary.reactivate > 0;

  return (
    <div className="border-t border-gray-100 pt-3 space-y-2">
      <h4 className="text-xs font-semibold text-gray-600"><T k="CSV 일괄 등재" /></h4>
      <p className="text-[11px] text-gray-400">
        {isPreset ? <T k="머리글: presetKey, note(선택) — 정본 프리셋 목록에 있는 키만 받습니다." />
          : <T k="머리글: code, note(선택), validFrom·codeSystem(여러 버전일 때) — 마스터 코드와 정확히 같은 행만 받습니다." />}
      </p>
      <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="text-xs" />
      <textarea value={csv} onChange={(e) => { setCsv(e.target.value); setResult(null); }} rows={4} placeholder={tAttr('또는 CSV 내용을 붙여 넣기')}
        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-mono" />
      <div className="flex gap-2">
        <button onClick={() => run.mutate(true)} disabled={!csv.trim() || run.isPending}
          className="flex-1 min-h-[44px] px-3 py-2 border border-blue-200 text-blue-700 text-xs font-medium rounded-xl disabled:opacity-40">
          <T k="① 미리보기(쓰기 없음)" />
        </button>
        <button onClick={() => run.mutate(false)} disabled={!canApply || run.isPending}
          className="flex-1 min-h-[44px] px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-xl disabled:opacity-40">
          <T k="② 확정 반영" />
        </button>
      </div>

      {result && (
        <div className="space-y-2">
          <p className="text-[11px] text-gray-600">
            <Tf k="전체 {전체}행 · 신규 {신규} · 재활성화 {재활성화} · 변경 없음 {변경없음} · 오류 {오류}" params={{
              전체: result.summary.total, 신규: result.summary.create, 재활성화: result.summary.reactivate, 변경없음: result.summary.unchanged, 오류: result.summary.error,
            }} />
          </p>
          {result.applied && (
            <p className="text-[11px] font-semibold text-gray-700">
              <Tf k="반영 결과 — 생성 {생성} · 재활성화 {재활성화} · 적용 실패 {실패}" params={{ 생성: result.applied.created, 재활성화: result.applied.reactivated, 실패: result.applied.applyFailed }} />
            </p>
          )}
          {result.unknownColumns.length > 0 && (
            <p className="text-[11px] text-amber-700"><Tf k="인식하지 못한 열(무시됨): {열}" params={{ 열: result.unknownColumns.join(', ') }} /></p>
          )}
          {result.summary.reactivate > 0 && result.dryRun && (
            <p className="text-[11px] text-amber-700"><T k="재활성화 행은 중지·제거됐던 항목을 다시 사용 승인합니다 — 이전 상태를 확인하세요." /></p>
          )}
          <div className="max-h-64 overflow-auto border border-gray-100 rounded-xl">
            <table className="w-full text-[11px]">
              <thead className="bg-gray-50 text-gray-500">
                <tr><th className="px-2 py-1 text-left"><T k="행" /></th><th className="px-2 py-1 text-left"><T k="입력" /></th><th className="px-2 py-1 text-left"><T k="판정" /></th><th className="px-2 py-1 text-left"><T k="내용" /></th></tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.line} className="border-t border-gray-50">
                    <td className="px-2 py-1 tabular-nums">{r.line}</td>
                    <td className="px-2 py-1 font-mono">{r.code ?? r.presetKey ?? '-'}</td>
                    <td className="px-2 py-1"><span className={`px-1.5 py-0.5 rounded ${ACTION_CLS[r.action]}`}><T k={ACTION_TEXT[r.action]} /></span></td>
                    <td className="px-2 py-1 text-gray-600">
                      {r.error ? <T k={ERROR_TEXT[r.error] ?? r.error} /> : r.label}
                      {r.previousStatus && r.action === 'REACTIVATE' && <span className="ml-1 text-gray-400">({r.previousStatus})</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
