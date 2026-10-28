'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { describeClaimGenerate, readClaimGenerateResult } from '@/lib/claims-generate-result';
import { toast } from '@/stores/toast-store';
import StatusBadge from '@/components/ui/StatusBadge';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import StatCard from '@/components/ui/StatCard';
import PageHeader from '@/components/ui/PageHeader';
import { money, kdate } from '@/lib/ui-settings';
import { Money } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { claimTransmission, type ClaimTransmission } from '@/lib/claim-transmission';
import { claimCounts } from '@/lib/claims-summary';
import { downloadClaimXml } from '@/lib/claim-xml-download';

interface ClaimItem {
  id: string;
  status: string;
  /** 🔴 미전송이면 null — 전송된 건만 시각이 있다(claim.service.ts) */
  submittedAt?: string | null;
  claimData?: { transmission?: ClaimTransmission } | null;
  claimedAmount?: number;
  approvedAmount?: number;
  claimDate: string;
  patient?: { familyName?: string; givenName?: string };
}

interface ClaimsSummary {
  totalClaimed?: number;
  totalApproved?: number;
  pendingCount?: number;
  rejectedCount?: number;
}

interface ApiWrapper<T> { data?: T }

// 상태 라벨/색 — shared CLAIM_STATUS_LABEL + StatusBadge(domain='claim')로 일원화(UX P1 마이그레이션)

export default function ClaimsPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['claims'], queryFn: () => apiClient.get<{ data: ClaimItem[] }>('/api/v1/claims') });
  const _claimsRaw = data?.data;
  const claimsList: ClaimItem[] = Array.isArray(_claimsRaw) ? _claimsRaw : (_claimsRaw as unknown as ApiWrapper<ClaimItem[]>)?.data ?? [];
  const { data: summary } = useQuery({ queryKey: ['claims-summary'], queryFn: () => apiClient.get<{ data: ClaimsSummary }>('/api/v1/claims/summary') });
  const generate = useMutation({
    mutationFn: () => apiClient.post('/api/v1/claims/generate'),
    // 🔴 (2026-09-30) 종전엔 응답을 읽지 않고 늘 "생성되었습니다" — 0건·전부 건너뜀도 성공 문장이었다
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['claims'] });
      qc.invalidateQueries({ queryKey: ['claims-summary'] });
      const d = describeClaimGenerate(readClaimGenerateResult(res));
      const text = d.parts.map((p) => (p.n != null ? `${tAttr(p.key)} ${p.n}${tAttr('건')}` : tAttr(p.key))).join(' · ');
      if (d.tone === 'success') toast.success(text); else if (d.tone === 'warning') toast.warning(text); else toast.info(text);
    },
    onError: (e) => { toast.error(extractErrorMessage(e) || tAttr('청구 생성에 실패했습니다.')); },
  });
  const submit = useMutation({
    mutationFn: (id: string) => apiClient.patch<{ data: ClaimItem }>(`/api/v1/claims/${id}/submit`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['claims'] });
      // 🔴 상태가 SUBMITTED 라고 심평원에 나간 것이 아니다 — 전송 채널이 아직 없다.
      //    종전엔 무조건 "청구가 제출되었습니다"를 띄웠다.
      const t = claimTransmission(res?.data);
      if (t?.transmitted === true) toast.success('청구를 전송했습니다.');
      else if (t?.transmitted === false) toast.warning(`청구를 원내에 기록했습니다 — 아직 전송되지 않았습니다. ${t.note ?? ''}`);
      else toast.warning('청구를 기록했습니다 — 전송 여부는 확인할 수 없습니다.');
    },
    onError: () => { toast.error('청구 제출에 실패했습니다.'); },
  });
  const batchSubmit = useMutation({
    mutationFn: async (ids: string[]) => {
      const out: ClaimItem[] = [];
      for (const id of ids) out.push((await apiClient.patch<{ data: ClaimItem }>(`/api/v1/claims/${id}/submit`))?.data);
      return out;
    },
    onSuccess: (list) => {
      qc.invalidateQueries({ queryKey: ['claims'] }); setSelectedIds([]);
      // 🔴 "일괄 제출되었습니다"는 전송을 뜻하지 않는다 — 전송된 건과 아닌 건을 나눠 센다.
      const views = (list ?? []).map((c) => claimTransmission(c));
      const sent = views.filter((v) => v?.transmitted === true).length;
      const not = views.filter((v) => v?.transmitted === false).length;
      const unknown = views.length - sent - not;
      if (not + unknown === 0) toast.success(`${sent}건을 전송했습니다.`);
      else toast.warning(`${views.length}건 기록 — 전송 ${sent}건 · 미전송 ${not}건${unknown ? ` · 확인 불가 ${unknown}건` : ''}. 미전송 건은 수기 제출이 필요합니다.`);
    },
    onError: () => { toast.error('일괄 제출에 실패했습니다.'); },
  });

  // 🔴 (2026-10-14 P4-3) 종전 `window.open` 은 인증 헤더가 없어 늘 401 — 헤더를 실어 받고 서버 사유(422 등)를 말한다
  const handleXmlDownload = async (id: string) => {
    const err = await downloadClaimXml(id).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
    if (err) toast.error(err);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  // 🔴 (2026-10-14 P4-3) 서버 요약은 상태별 groupBy **배열**인데 평면 객체(`totalClaimed`)로 읽어 늘 폴백했고,
  //    폴백은 목록의 **최근 20건**으로 셌다(잘림 고지 없음). 정본 파서 `claimCounts` 로 전체를 읽고, 요약을 못 받으면 지어내지 않는다.
  const _summaryRaw = summary?.data as unknown;
  const _summaryRows = (Array.isArray(_summaryRaw) ? _summaryRaw : (_summaryRaw as { data?: unknown } | undefined)?.data) as unknown;
  const counts = Array.isArray(_summaryRows) ? claimCounts(_summaryRows) : null;
  const stats: ClaimsSummary | null = counts && {
    totalClaimed: counts.totalClaimed,
    totalApproved: counts.totalApproved,
    pendingCount: counts.reviewing,
    rejectedCount: counts.rejected,
  };
  const listTotal = ((data as { pagination?: { total?: number }; meta?: { total?: number } } | undefined)?.pagination?.total
    ?? (data as { meta?: { total?: number } } | undefined)?.meta?.total) ?? null;

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div>
      <PageHeader
        title={tAttr('건강보험 청구')}
        actions={
          <div className="flex gap-2">
            <Link href="/claims/stats" className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-xl text-sm font-medium hover:bg-indigo-100 border border-indigo-200">
              📊 <T k="통계" />
            </Link>
            {selectedIds.length > 0 && (
              <button onClick={() => batchSubmit.mutate(selectedIds)} disabled={batchSubmit.isPending} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                {batchSubmit.isPending ? <T k="제출 중..." /> : `일괄 제출 (${selectedIds.length}건)`}
              </button>
            )}
            <button onClick={() => generate.mutate()} disabled={generate.isPending} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {generate.isPending ? <T k="생성 중..." /> : <T k="청구 생성" />}
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6" data-claims-stats={stats ? 'SERVER' : 'UNAVAILABLE'}>
        <StatCard title={tAttr('총 청구액')} value={stats ? <Money value={(stats.totalClaimed ?? 0)} /> : tAttr('확인 불가')} color="gray" />
        <StatCard title={tAttr('인정액')} value={stats ? <Money value={(stats.totalApproved ?? 0)} /> : tAttr('확인 불가')} color="emerald" />
        {/* 🔴 (P4-4) SUBMITTED 는 심평원 전송 채널이 없어 '심사 중'이 아니라 '제출 기록'이다 */}
        <StatCard title={tAttr('제출됨')} value={stats ? `${stats.pendingCount ?? 0}건` : tAttr('확인 불가')} color="amber" />
        <StatCard title={tAttr('반려')} value={stats ? `${stats.rejectedCount ?? 0}건` : tAttr('확인 불가')} color="red" />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-3 py-3 w-10"><input type="checkbox" className="rounded" onChange={(e) => { if (e.target.checked) { setSelectedIds(claimsList.filter((c: ClaimItem) => c.status === 'DRAFT').map((c: ClaimItem) => c.id) || []); } else { setSelectedIds([]); } }} checked={selectedIds.length > 0 && selectedIds.length === (claimsList.filter((c: ClaimItem) => c.status === 'DRAFT').length || 0)} /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="청구액" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="인정액" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="청구일" /></th>
              <th className="px-5 py-3 text-xs font-medium text-gray-500"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-5 py-4"><div className="h-4 w-20 bg-gray-100 rounded-lg animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : !claimsList.length ? (
              <tr>
                <td colSpan={7} className="py-16 text-center">
                  <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <p className="text-sm text-gray-400"><T k="청구 내역이 없습니다" /></p>
                </td>
              </tr>
            ) : (
              claimsList.map((c: ClaimItem) => (
                <tr key={c.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                  <td className="px-3 py-4"><input type="checkbox" className="rounded" checked={selectedIds.includes(c.id)} onChange={() => toggleSelect(c.id)} disabled={c.status !== 'DRAFT'} /></td>
                  <td className="px-5 py-4 font-medium"><Link href={`/claims/${c.id}`} className="text-blue-600 hover:underline">{c.patient?.familyName}{c.patient?.givenName}</Link></td>
                  <td className="px-5 py-4 text-gray-700"><Money value={c.claimedAmount} /></td>
                  <td className="px-5 py-4 text-gray-600">{c.approvedAmount != null ? <Money value={c.approvedAmount} /> : '-'}</td>
                  <td className="px-5 py-4">
                    <StatusBadge domain="claim" status={c.status} className="text-[11px] font-medium px-2.5 py-1" />
                    {/* 🔴 상태('제출')는 전송을 뜻하지 않는다 — 전송 채널이 없어 원내 기록만 된 건이 섞인다 */}
                    {(() => {
                      const t = claimTransmission(c);
                      if (!t || t.transmitted === true) return null;
                      return (
                        <span title={t.note ?? undefined} aria-label={t.label}
                          className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${t.transmitted === false ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-gray-100 text-gray-600 border border-gray-200'}`}>
                          {t.label}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-5 py-4 text-gray-500 text-xs">{kdate(new Date(c.claimDate))}</td>
                  <td className="px-5 py-4 text-right flex gap-2 justify-end">
                    <button onClick={() => handleXmlDownload(c.id)} className="text-xs text-purple-600 font-medium hover:text-purple-800 transition-colors">XML</button>
                    {c.status === 'DRAFT' && (
                      <button onClick={() => submit.mutate(c.id)} className="text-xs text-blue-600 font-medium hover:text-blue-800 transition-colors"><T k="제출@버튼" /></button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {listTotal != null && listTotal > claimsList.length && (
          <p className="px-5 py-2 text-xs text-amber-700 bg-amber-50 border-t border-amber-100" data-claims-truncated>
            <Tf k="{전체}건 중 {표시}건 표시" params={{ 전체: listTotal, 표시: claimsList.length }} />
          </p>
        )}
      </div>
    </div>
  );
}
