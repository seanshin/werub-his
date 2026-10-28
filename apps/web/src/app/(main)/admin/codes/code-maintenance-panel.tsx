'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import type { ServerMessage } from '@hospital-run/shared';
import { ServerText } from '@/components/ui/server-text';

/**
 * 코드 정비 — 중복 후보(F6)와 코드집 내보내기(F9).
 *
 * 🔴 **자동으로 합치지 않는다.** 병합은 [폐지 + 후속 코드 지정]이고 그 정본은 코드 상세에 있다.
 * 🔴 **조용히 자르지 않는다.** 내보내기는 장 단위이고 전체 건수를 함께 말한다.
 */
type CodeRow = { id: string; code: string; nameKo: string; origin: string | null };
type DupReport = {
  sourceTable: string;
  scope: string;
  scanned: number;
  groups: { name: string; codes: CodeRow[] }[];
  collidesWithMaster: { local: CodeRow; masterCodes: CodeRow[] }[];
  notes: string[];
  /** 정본 `{ k, params }`(같은 순서) — 없으면(구 서버) `notes` 원문 */
  notesMsg?: ServerMessage[];
};
type ExportResult = {
  csv: string; total: number; page: number; pageSize: number;
  returned: number; hasMore: boolean; notes: string[]; notesMsg?: ServerMessage[];
};

const TABLES = [
  { key: 'DiagnosisCode', kind: 'diagnosis', label: '진단' },
  { key: 'ProcedureCode', kind: 'procedure', label: '수가' },
  { key: 'MedicationCode', kind: 'medication', label: '약품' },
];

export default function CodeMaintenancePanel() {
  const [table, setTable] = useState(TABLES[0]);
  const [exportOrigin, setExportOrigin] = useState('');
  const [exportPage, setExportPage] = useState(1);
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();

  const dup = useQuery({
    queryKey: ['code-duplicates', table.key],
    // 🔴 `queryFn` 안에서 실패를 기본값으로 접지 않는다 — 접으면 오류 화면이 도달 불가 코드가 된다
    queryFn: () => apiClient.get<{ data: DupReport }>(`/api/v1/codes/duplicates/${table.key}`),
  });

  const exp = useMutation({
    mutationFn: (page: number) =>
      apiClient.get<{ data: ExportResult }>(
        `/api/v1/codes/export/${table.kind}?active=true&page=${page}${exportOrigin ? `&origin=${exportOrigin}` : ''}`,
      ),
    onSuccess: (r) => {
      const d = r.data;
      const blob = new Blob([d.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `codes-${table.kind}${exportOrigin ? `-${exportOrigin.toLowerCase()}` : ''}-p${d.page}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(
        d.hasMore
          ? tfAttr('{받은}건 받았습니다 — 전체 {전체}건 중 일부입니다', { 받은: d.returned.toLocaleString(), 전체: d.total.toLocaleString() })
          : tfAttr('{받은}건 받았습니다(전체)', { 받은: d.returned.toLocaleString() }),
      );
    },
    onError: (e: Error) => toast.error(e.message || tAttr('내보내기에 실패했습니다')),
  });

  const report = dup.data?.data;
  const lastExport = exp.data?.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {TABLES.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTable(t); setExportPage(1); }}
            className={`rounded-full px-3 py-1 text-[11px] font-medium ${
              table.key === t.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'
            }`}
          >
            <T k={t.label} />
          </button>
        ))}
      </div>

      {/* 중복 후보 */}
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <h3 className="text-sm font-bold text-gray-900"><T k="중복 후보" /></h3>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
          🔴 <b><T k="고시 마스터는 검사하지 않습니다." /></b>{' '}
          <Tf
            k="같은 명칭에 여러 코드가 있는 것이 정상이기 때문입니다 — 2026-08-26 실측에서 명칭만으로 세면 수가에서만 {무리}가 나오는데, 그것은 한 마취 행위에 붙는 {가산} 같은 것들입니다."
            params={{ 무리: <b><T k="8,535 무리" /></b>, 가산: <b><T k="가산 코드 240개" /></b> }}
          />{' '}
          <Tf k="그것을 “중복”이라 부르고 합치면 {강조}" params={{ 강조: <b><T k="청구가 망가집니다." /></b> }} />
        </p>

        {dup.isError ? (
          <div className="mt-4"><QueryErrorFallback error={dup.error as Error} onRetry={() => dup.refetch()} /></div>
        ) : dup.isLoading ? (
          <p className="py-6 text-center text-sm text-gray-400"><T k="확인하는 중…" /></p>
        ) : report ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-baseline gap-3 text-[12px]">
              <span className="rounded-lg bg-gray-50 px-3 py-1.5">
                {/* `scope` 는 서버가 정한 문자열이라 번역하지 않고 끼운다 */}
                <Tf k="검사 범위 {범위}" params={{ 범위: <b className="text-gray-800">{report.scope}</b> }} />
              </span>
              {/* 🔴 분모를 함께 낸다 — "중복 없음"은 검사한 것이 있을 때만 뜻이 있다 */}
              <span className="rounded-lg bg-gray-50 px-3 py-1.5">
                <Tf k="검사한 코드 {수}건" params={{ 수: <b className="tabular-nums text-gray-800">{report.scanned.toLocaleString()}</b> }} />
              </span>
              <span className="rounded-lg bg-gray-50 px-3 py-1.5">
                <Tf k="겹치는 무리 {수}" params={{ 수: <b className="tabular-nums text-gray-800">{report.groups.length}</b> }} />
              </span>
              <span className="rounded-lg bg-gray-50 px-3 py-1.5">
                <Tf k="마스터와 명칭 충돌 {수}" params={{ 수: <b className="tabular-nums text-gray-800">{report.collidesWithMaster.length}</b> }} />
              </span>
            </div>

            {report.notes.map((n, i) => (
              <p key={i} className="text-[11px] leading-relaxed text-amber-700"><ServerText msg={report.notesMsg?.[i]} fallback={n} /></p>
            ))}

            {report.groups.map((g, i) => (
              <div key={i} className="rounded-xl border border-amber-200 bg-amber-50/40 px-3 py-2">
                <p className="text-[12px] font-semibold text-gray-800">{g.name}</p>
                <p className="mt-1 font-mono text-[11px] text-gray-600">
                  {g.codes.map((c) => c.code).join(' · ')}
                </p>
              </div>
            ))}

            {report.collidesWithMaster.map((c, i) => (
              <div key={i} className="rounded-xl border border-rose-200 bg-rose-50/40 px-3 py-2 text-[12px]">
                <p className="font-semibold text-gray-800">
                  <Tf k="원내 {코드} {명칭}" params={{ 코드: <span className="font-mono">{c.local.code}</span>, 명칭: c.local.nameKo }} />
                </p>
                <p className="mt-1 text-gray-600">
                  <Tf k="마스터에 같은 명칭이 있습니다 — {코드}" params={{ 코드: <span className="font-mono">{c.masterCodes.map((m) => m.code).join(' · ')}</span> }} />
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* 내보내기 */}
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <h3 className="text-sm font-bold text-gray-900"><T k="코드집 내보내기" /></h3>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
          <T k="인증 심사·기관 제출용 CSV." />{' '}🔴{' '}
          {/* 🔴 (2026-09-11) 건수를 상수('166,744')로 적어 두면 시간이 지나 거짓이 된다 — 수를 말하지 않는다(전체 건수는 내보낼 때 서버가 함께 준다) */}
          <Tf
            k="수가는 한 번에 다 담기지 않습니다 — {강조} 알려 드립니다."
            params={{ 강조: <b><T k="장 단위로 나가고 전체 건수를 함께" /></b> }}
          />{' '}
          <T k="일부를 전부로 제출하면 안 되기 때문입니다." />
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {[
            { key: '', label: '전체' },
            { key: 'LOCAL', label: '원내 등록만' },
            { key: 'HIRA', label: '고시 반영만' },
            { key: 'UNKNOWN', label: '표기 없음만' },
          ].map((o) => (
            <button
              key={o.key || 'all'}
              onClick={() => { setExportOrigin(o.key); setExportPage(1); }}
              className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                exportOrigin === o.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'
              }`}
            >
              <T k={o.label} />
            </button>
          ))}
          <button
            onClick={() => exp.mutate(exportPage)}
            disabled={exp.isPending}
            className="ml-auto rounded-xl bg-blue-600 px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            {exp.isPending ? <T k="만드는 중…" /> : <Tf k="{장}장 받기" params={{ 장: exportPage }} />}
          </button>
        </div>

        {lastExport && (
          <div className="mt-3 space-y-1 text-[12px]">
            <p className="text-gray-600">
              <Tf
                k="전체 {전체}건 · 이번 장 {이번}건 (한 장 {한장}건)"
                params={{
                  전체: <b className="tabular-nums">{lastExport.total.toLocaleString()}</b>,
                  이번: <b className="tabular-nums">{lastExport.returned.toLocaleString()}</b>,
                  한장: lastExport.pageSize.toLocaleString(),
                }}
              />
            </p>
            {lastExport.notes.map((n, i) => (
              <p key={i} className="text-amber-700"><ServerText msg={lastExport.notesMsg?.[i]} fallback={n} /></p>
            ))}
            {lastExport.hasMore && (
              <button
                onClick={() => { const n = exportPage + 1; setExportPage(n); exp.mutate(n); }}
                className="font-semibold text-blue-600 underline underline-offset-2"
              >
                <Tf k="다음 장({장}장) 받기" params={{ 장: exportPage + 1 }} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
