'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isCriticalFlag } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState, KDate, PatientName, Unit } from '@/components/ui/display';
import { Data, T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { LabTerm } from '@/components/ui/lab-term';

/**
 * 검사결과 확인함(1011) — 결과가 도착했는데 아직 확인하지 않은 오더. **확인하면 줄어드는 목록**이다.
 *
 * 🔴 (2026-09-30) 확인 EP(`PATCH doctors/orders/:id/acknowledge`)는 처음부터 있었는데 부르는 화면이 없었다 —
 *    센서스의 "미확인 검사 N건"은 줄일 방법이 없는 숫자였다. 워크리스트가 없으면 의사는 기억으로 일한다.
 *
 * 화면이 말하는 사실:
 *  · 기본은 **내 오더**(내가 처방했거나 내 진료에서 나온 오더). `?patientId=` 로 오면 그 환자의 미확인 결과 **전부**(처방의 무관)
 *  · 위급 → 이상 → 그 외 순. 자르면 "전체 N건 중 a–b" 로 말한다
 *  · 검사 결과가 검증 전(예비)인지 검증 확정인지 따로 말한다 — 확인은 "봤다"는 기록이지 검증이 아니다
 *  · 위급값 복창(read-back) 확인은 별도다(상단 위급값 배너) — 여기서 확인해도 위급값 경보는 닫히지 않는다
 *  · 조회 실패는 "확인할 결과 없음"이 아니라 실패로 그린다
 */

type Severity = 'CRITICAL' | 'ABNORMAL' | 'NORMAL' | 'UNJUDGED' | 'NO_FLAG';

interface InboxItem {
  orderId: string;
  department: 'LAB' | 'IMAGING' | string;
  priority: string;
  completedAt: string | null;
  severity: Severity;
  testName: string | null;
  testCode: string | null;
  patient: { id: string; familyName: string; givenName: string; mrn: string } | null;
  encounterId: string | null;
  orderedByMe: boolean;
  lab: {
    resultId: string;
    status: string;
    verifiedAt: string | null;
    itemCount: number;
    flaggedItems: Array<{ testName: string; value: string; unit: string; flag: string | null }>;
    unjudgedCount: number;
  } | null;
  imaging: {
    resultId: string;
    status: string;
    modality: string;
    bodyPart: string | null;
    impression: string | null;
    reportedAt: string | null;
  } | null;
}

interface ResultsInboxResponse {
  scope: 'MINE' | 'PATIENT';
  patientId: string | null;
  total: number;
  counts: { critical: number; abnormal: number; other: number };
  offset: number;
  limit: number;
  items: InboxItem[];
}

const PAGE = 50;

const SEVERITY_BADGE: Record<Severity, { label: string; cls: string }> = {
  CRITICAL: { label: '위급', cls: 'bg-red-600 text-white' },
  ABNORMAL: { label: '이상', cls: 'bg-orange-100 text-orange-800' },
  NORMAL: { label: '정상', cls: 'bg-green-50 text-green-700' },
  // 🔴 미판정은 초록으로도 빨강으로도 그리지 않는다(기준치 미등록 — 정상이라는 뜻이 아니다)
  UNJUDGED: { label: '판정 불가', cls: 'bg-gray-100 text-gray-700' },
  NO_FLAG: { label: '판독문 확인', cls: 'bg-pink-50 text-pink-700' },
};

const unwrap = <X,>(r: unknown): X => ((r as { data?: X })?.data ?? r) as X;

export default function ResultsInboxPage() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse bg-gray-50 rounded-2xl" />}>
      <ResultsInbox />
    </Suspense>
  );
}

function ResultsInbox() {
  const params = useSearchParams();
  const patientId = params.get('patientId');
  const tfAttr = useTfAttr();
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const q = useQuery({
    queryKey: ['results-inbox', patientId, offset],
    queryFn: async () => {
      const qs = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (patientId) qs.set('patientId', patientId);
      return unwrap<ResultsInboxResponse>(await apiClient.get(`/api/v1/doctors/results-inbox?${qs.toString()}`));
    },
    refetchInterval: pollMs('normal'),
  });

  const afterAck = () => {
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ['results-inbox'] });
    qc.invalidateQueries({ queryKey: ['my-census'] });
  };

  const ackOne = useMutation({
    mutationFn: (orderId: string) => apiClient.patch(`/api/v1/doctors/orders/${orderId}/acknowledge`, {}),
    onSuccess: afterAck,
  });
  const ackBulk = useMutation({
    mutationFn: async (orderIds: string[]) =>
      unwrap<{ requested: number; acknowledged: number; skipped: number }>(
        await apiClient.post('/api/v1/doctors/orders/acknowledge', { orderIds }),
      ),
    onSuccess: (r) => {
      // 요청 수를 "확인됨"으로 말하지 않는다 — 서버가 실제로 확인한 수와 건너뛴 수를 그대로
      toast.success(tfAttr('확인 {확인}건 · 건너뜀 {건너뜀}건', { 확인: r.acknowledged, 건너뜀: r.skipped }));
      afterAck();
    },
  });

  const data = q.data;
  const items = useMemo(() => data?.items ?? [], [data]);
  const allOnPage = items.length > 0 && items.every((i) => selected.has(i.orderId));

  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />;

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="검사결과 확인함" /></h2>
          <p className="text-sm text-gray-500 mt-1">
            {patientId
              ? <T k="이 환자의 미확인 결과 전부입니다(처방의 무관)." />
              : <T k="내가 처방했거나 내 진료에서 나온 오더 중 결과가 도착했고 아직 확인하지 않은 건입니다." />}{' '}
            <T k="확인하면 목록에서 빠집니다. 위급값 복창 확인은 상단 위급값 배너에서 따로 합니다." />
          </p>
          {patientId && (
            <Link href="/results-inbox" className="text-xs text-blue-600 hover:underline"><T k="내 오더 전체 보기" /> →</Link>
          )}
        </div>
        <button
          onClick={() => ackBulk.mutate([...selected])}
          disabled={selected.size === 0 || ackBulk.isPending}
          className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium disabled:opacity-40"
        >
          <Tf k="선택 {건수}건 확인" params={{ 건수: selected.size }} />
        </button>
      </div>

      {data && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="px-2 py-1 rounded-full bg-red-50 text-red-700"><T k="위급" /> {data.counts.critical}</span>
          <span className="px-2 py-1 rounded-full bg-orange-50 text-orange-700"><T k="이상" /> {data.counts.abnormal}</span>
          <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600"><T k="그 외" /> {data.counts.other}</span>
          <span className="text-gray-500">
            {data.total > items.length
              ? <Tf k="전체 {전체}건 중 {시작}–{끝}번째" params={{ 전체: data.total, 시작: data.total === 0 ? 0 : data.offset + 1, 끝: data.offset + items.length }} />
              : <Tf k="전체 {전체}건" params={{ 전체: data.total }} />}
          </span>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        {q.isLoading || !data ? (
          <div className="h-40 animate-pulse bg-gray-50 rounded-2xl" />
        ) : items.length === 0 ? (
          <EmptyState icon="✅" title={offset > 0 ? '이 쪽에는 남은 결과가 없습니다.' : '확인할 결과가 없습니다.'} />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 border-b border-gray-100">
              <tr>
                <th className="px-3 py-2 w-10">
                  <input type="checkbox" aria-label={tAttr('전체 선택')} checked={allOnPage}
                    onChange={() => setSelected(allOnPage ? new Set() : new Set(items.map((i) => i.orderId)))} />
                </th>
                <th className="px-3 py-2 text-left"><T k="판정" /></th>
                <th className="px-3 py-2 text-left"><T k="환자" /></th>
                <th className="px-3 py-2 text-left"><T k="검사·영상" /></th>
                <th className="px-3 py-2 text-left"><T k="결과" /></th>
                <th className="px-3 py-2 text-left"><T k="완료" /></th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((it) => {
                const sev = SEVERITY_BADGE[it.severity] ?? SEVERITY_BADGE.UNJUDGED;
                return (
                  <tr key={it.orderId} className={it.severity === 'CRITICAL' ? 'bg-red-50/40' : ''}>
                    <td className="px-3 py-2 align-top">
                      <input type="checkbox" aria-label={tAttr('선택')} checked={selected.has(it.orderId)} onChange={() => toggle(it.orderId)} />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded text-[11px] font-bold ${sev.cls}`}><T k={sev.label} /></span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      {it.patient ? (
                        // 차트의 그 결과 탭으로 바로(검사 → 검사결과 · 영상 → 영상) — 종전엔 차트 첫 화면(개요)이라 다시 찾아야 했다
                        <Link href={`/patients/${it.patient.id}?tab=${it.department === 'IMAGING' ? 'imaging' : 'labresults'}`} className="hover:underline" data-inbox-chart-link={it.department === 'IMAGING' ? 'imaging' : 'labresults'}>
                          <PatientName familyName={it.patient.familyName} givenName={it.patient.givenName} mrn={it.patient.mrn} maskable className="font-medium text-gray-900" />
                        </Link>
                      ) : <span className="text-gray-400">-</span>}
                      {!it.orderedByMe && patientId && (
                        <p className="text-[11px] text-gray-400"><T k="다른 의사의 오더" /></p>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className={`mr-1 px-1.5 py-px rounded-full text-[10px] font-medium ${it.department === 'IMAGING' ? 'bg-pink-100 text-pink-700' : 'bg-indigo-100 text-indigo-700'}`}>
                        <T k={it.department === 'IMAGING' ? '영상' : '검사'} />
                      </span>
                      {it.testName ? <LabTerm name={it.testName} /> : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-gray-700">
                      {it.lab && (
                        <>
                          <span className={`mr-1 px-1.5 py-px rounded text-[10px] ${it.lab.status === 'VERIFIED' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                            <T k={it.lab.status === 'VERIFIED' ? '검증 확정' : '예비(검증 전)'} />
                          </span>
                          {it.lab.flaggedItems.length > 0 ? (
                            <span>
                              {it.lab.flaggedItems.slice(0, 4).map((f, i) => (
                                <span key={i} className={`mr-2 ${isCriticalFlag(f.flag) ? 'font-bold text-red-700' : 'text-orange-700'}`}>
                                  <LabTerm name={f.testName} /> {f.value}{f.unit ? <Unit>{f.unit}</Unit> : null} ({f.flag})
                                </span>
                              ))}
                              {it.lab.flaggedItems.length > 4 && (
                                <Tf k="외 {건수}건" params={{ 건수: it.lab.flaggedItems.length - 4 }} />
                              )}
                            </span>
                          ) : null}
                          <span className="text-gray-400">
                            {' '}{it.lab.unjudgedCount > 0
                              ? <Tf k="(항목 {항목}개 · 판정 불가 {미판정}개)" params={{ 항목: it.lab.itemCount, 미판정: it.lab.unjudgedCount }} />
                              : <Tf k="(항목 {항목}개)" params={{ 항목: it.lab.itemCount }} />}
                          </span>
                        </>
                      )}
                      {it.imaging && (
                        <span className="line-clamp-2"><Data>{it.imaging.impression || it.imaging.modality}</Data></span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-gray-500 whitespace-nowrap">
                      <KDate value={it.completedAt} mode="datetimeShort" />
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      <button
                        onClick={() => ackOne.mutate(it.orderId)}
                        disabled={ackOne.isPending}
                        className="min-h-[44px] px-3 py-1.5 rounded-lg border border-blue-200 text-blue-700 text-xs font-medium hover:bg-blue-50 disabled:opacity-40"
                      >
                        <T k="확인함" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {data && data.total > PAGE && (
        <div className="flex items-center justify-end gap-2">
          <button onClick={() => { setSelected(new Set()); setOffset(Math.max(offset - PAGE, 0)); }} disabled={offset === 0}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs disabled:opacity-40"><T k="이전" /></button>
          <button onClick={() => { setSelected(new Set()); setOffset(offset + PAGE); }} disabled={offset + items.length >= data.total}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs disabled:opacity-40"><T k="다음" /></button>
        </div>
      )}
    </div>
  );
}
