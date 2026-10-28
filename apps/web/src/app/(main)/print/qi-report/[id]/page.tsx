'use client';

/**
 * QI 보고서 인쇄(QI-FLOW-001 · 2026-10-08) — 보고서 원장에 **보존된 본문**을 그대로 그린다(다시 계산하지 않는다).
 * 🔴 만든 시점의 값이다 — 이후 측정이 정정돼도 이 판은 바뀌지 않는다(sha256 · 읽은 측정 행 id 를 함께 찍는다).
 * 🔴 값이 없으면 "미측정"·"산출 불가"로 — 0 이나 빈칸으로 접지 않는다.
 */
import { use, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatNum, QI_MEASUREMENT_SOURCE_LABEL, qiReportPrintLines, type QiMeasurementSource } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { KDate } from '@/components/ui/display';
import { usePrintIssue } from '@/components/print/usePrintIssue';
import { PrintDoc } from '@/components/print/PrintSheet';
import { T, Tf } from '@/components/ui/i18n-text';

interface Row { indicatorId: string; name: string; category: string; current: number | null; currentSource?: string | null; target: number; unit: string | null; achieved: boolean | null; latestAvailablePeriod: string | null }
interface Report {
  id: string; period: string; title: string; status: string; createdAt: string; submittedAt: string | null; agendaId: string | null; sha256: string | null;
  /** (C4) 서버가 저장된 본문으로 봉인을 다시 계산한 결과 — 없으면(옛 서버) 모른다 */
  sealCheck?: 'MATCH' | 'MISMATCH' | 'LEGACY' | 'UNSEALED';
  body: {
    generatedAt?: string; precedence?: string;
    summary?: { keyFindings?: string[] };
    sections?: { indicatorDashboard?: { indicators?: Row[] } | Row[] };
    measurementIds?: { id: string; source: string | null; alternateId: string | null }[];
    accreditationSelfAssessment?: { standards: number; assessed: number; verified: number; byJudgment: Record<string, number> };
  };
}

function rowsOf(d: Report['body']['sections']): Row[] {
  const x = d?.indicatorDashboard;
  if (Array.isArray(x)) return x;
  return x?.indicators ?? [];
}

export default function QiReportPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({
    queryKey: ['qi-report', id],
    queryFn: () => apiClient.get<{ data: Report }>(`/api/v1/quality-flow/reports/${id}`).then((r) => r.data),
  });
  /** 🔴 인쇄 = 서버 발급(QI 보고서 · 보존된 본문 sha256 을 발급 원장에 묶는다) — 발급 실패면 인쇄하지 않는다 */
  const printLines = useMemo(() => (q.data ? qiReportPrintLines(q.data) : []), [q.data]);
  const pr = usePrintIssue('QI_REPORT', { reportId: id }, printLines, () => { void q.refetch(); });
  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  if (!r) return <div className="h-40 animate-pulse rounded-xl bg-gray-100" />;
  const rows = rowsOf(r.body.sections);
  const acc = r.body.accreditationSelfAssessment;
  /**
   * 🔴 (2026-10-12) 종전 인쇄는 빈 종이(인쇄 루트 없음) — 본문을 인쇄 전용 문서(PrintDoc)에 한 번 더 그린다.
   *    진위는 서버가 보존한 본문 sha256 그대로(다시 계산하지 않는다) · 문서 끝 서명란.
   */
  const body = (print: boolean) => (<>
      {!print && <h1 className="text-xl font-bold">{r.title}</h1>}
      <p className="mt-1 text-xs text-gray-600">
        <T k="작성" /> <KDate value={r.createdAt} mode="datetimeShort" />
        {' · '}<T k={r.status === 'SUBMITTED' ? '위원회 제출됨' : '초안'} />
        {r.submittedAt && <> (<KDate value={r.submittedAt} mode="datetimeShort" />)</>}
      </p>
      {!print && r.sha256 && <p className="font-mono text-[10px] text-gray-400">sha256 {r.sha256}</p>}
      {!print && (
        <p className={`text-[11px] ${r.sealCheck === 'MISMATCH' ? 'text-red-600' : 'text-gray-500'}`} data-qi-seal-check={r.sealCheck ?? 'UNKNOWN'}>
          {r.sealCheck === 'MATCH' ? <T k="봉인 확인 — 저장된 본문으로 다시 계산한 sha256 이 일치합니다" />
            : r.sealCheck === 'MISMATCH' ? <T k="봉인 불일치 — 저장된 본문이 봉인과 다릅니다(인쇄본을 발급하지 않습니다)" />
            : r.sealCheck === 'LEGACY' ? <T k="옛 봉인 — 2026-10-13 전 방식이라 저장된 본문으로 다시 계산할 수 없습니다" />
            : r.sealCheck === 'UNSEALED' ? <T k="봉인 없음" /> : <T k="봉인 확인 결과를 받지 못했습니다" />}
        </p>
      )}

      <h2 className="mt-5 border-b pb-1 font-bold"><T k="주요 소견" /></h2>
      {(r.body.summary?.keyFindings ?? []).length === 0
        ? <p className="mt-1 text-gray-400"><T k="기록된 소견 없음" /></p>
        : <ul className="mt-1 list-disc pl-5">{r.body.summary!.keyFindings!.map((f, i) => <li key={i}>{f}</li>)}</ul>}

      <h2 className="mt-5 border-b pb-1 font-bold"><Tf k="질 지표 ({기간})" params={{ 기간: r.period }} /></h2>
      <table className="mt-1 w-full text-xs">
        <thead><tr className="border-b text-left text-gray-500">
          <th className="py-1"><T k="지표명" /></th><th><T k="값" /></th><th><T k="출처" /></th><th><T k="목표" /></th><th><T k="판정" /></th>
        </tr></thead>
        <tbody>
          {rows.map((x) => {
            const unit = x.unit ? ` ${x.unit}` : '';
            return (
              <tr key={x.indicatorId} className="border-b border-gray-100" data-qi-print-row={x.indicatorId}>
                <td className="py-1">{x.name}</td>
                <td className="tabular-nums">{x.current == null ? <span className="text-gray-400"><T k="미측정" /></span> : `${formatNum(x.current, 'qiValue')}${unit}`}</td>
                <td>{x.currentSource ? <T k={QI_MEASUREMENT_SOURCE_LABEL[x.currentSource as QiMeasurementSource] ?? x.currentSource} /> : <span className="text-gray-400">—</span>}</td>
                <td className="tabular-nums">{formatNum(x.target, 'qiValue')}{unit}</td>
                <td>{x.current == null ? '—' : x.achieved == null ? <T k="판정 불가" /> : <T k={x.achieved ? '달성' : '미달'} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-gray-500">
        <Tf k="읽은 측정 행 {n}건 · 같은 달 수기·자동 값의 정본 규칙: {규칙}" params={{ n: r.body.measurementIds?.length ?? 0, 규칙: r.body.precedence ?? '—' }} />
      </p>

      <h2 className="mt-5 border-b pb-1 font-bold"><T k="인증 자체 평가" /></h2>
      {!acc || acc.standards === 0
        ? <p className="mt-1 text-gray-400"><T k="등록된 인증 기준이 없습니다." /></p>
        : <p className="mt-1"><Tf k="기준 {a}개 중 평가 {b} · 확인 {c}(나머지는 자가 평가)" params={{ a: acc.standards, b: acc.assessed, c: acc.verified }} /> · {Object.entries(acc.byJudgment).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>}
  </>);
  return (
    <div className="mx-auto max-w-4xl bg-white p-8 text-sm" data-qi-report-print={r.id}>
      <div className="mb-4 flex items-start justify-between">
        <p className="text-xs text-gray-500"><T k="인쇄 미리보기 — 보존된 본문을 그대로 그립니다." /></p>
        <button type="button" onClick={() => void pr.start()} disabled={pr.issuing} data-print-issue-button className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">{pr.issuing ? <T k="발급 중…" /> : <T k="발급 후 인쇄" />}</button>
      </div>
      {pr.bar && <div className="mb-4">{pr.bar}</div>}
      {body(false)}
      <PrintDoc attr={`qi-report:${r.id}`} kind={<T k="QI 보고서" />} code="HIS-QI-REPORT v1" title={r.title}
        idLine={r.id} hash={{ doc: r.sha256 }} {...pr.state}
        qr={{ t: 'HIS-QI-REPORT', v: 1, id: r.id, period: r.period, status: r.status }}>
        <div className="text-[9pt]">{body(true)}</div>
      </PrintDoc>
    </div>
  );
}
