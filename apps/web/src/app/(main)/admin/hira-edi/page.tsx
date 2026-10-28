'use client';

import { useState, useMemo } from 'react';
import { formatNum } from '@hospital-run/shared';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pollMs, kdate } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 🔴 W8 R3 C2 — 이 화면은 서버에 **없는 필드**를 읽고 있었다:
 *   `insurerAmount`(→ insuranceAmount) · `claimNumber`(→ claim.claimNumber) ·
 *   `claimType`(→ documentType) · `periodStart/End`(→ treatmentFrom/To) ·
 *   `validationErrors: {field,message}[]`(서버는 **string[]**).
 * 그래서 보험자부담 175,000원이 화면에 "0"으로, 청구번호·기간이 공백으로 나왔다(P11 FE↔서버 계약 불일치).
 * 아래 인터페이스는 `HiraClaimDocument`(prisma) + 서버가 붙여주는 `transmission` 계약 그대로다.
 */
interface HiraDocument {
  id: string;
  claimId: string;
  documentType: string; // OUTPATIENT | INPATIENT | PHARMACY
  ediVersion: string;
  status: string;
  treatmentFrom: string;
  treatmentTo: string;
  totalAmount: number;
  insuranceAmount: number;
  patientAmount: number;
  submittedAt: string | null;
  createdAt: string;
  receiptNo: string | null;
  patient?: { familyName: string; givenName: string; mrn: string };
  claim?: { id: string; claimNumber: string | null; status: string };
  validationErrors?: string[] | null;
  transmission?: {
    state: string;
    transmitted: boolean;
    label: string;
    note: string;
    channel: string;
    receiptNo: string | null;
  };
}

interface HiraStats {
  byStatus?: Record<string, number>;
  totalAmount: number;
  insuranceAmount: number;
  patientAmount: number;
  transmittedCount: number;
  notTransmittedCount: number;
  channel?: { key: string; name: string; implemented: boolean; manualFallback: string };
}

type HiraTab = 'claims' | 'stats';

const STATUS_LABEL: Record<string, string> = {
  DRAFT: '초안', VALIDATED: '검증완료', LOCAL_RECORDED: '원내 접수(미전송)', SEND_FAILED: '전송 실패',
  SUBMITTED: '제출됨', ACCEPTED: '승인', REJECTED: '반려', ADJUSTED: '조정',
};
const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  VALIDATED: 'bg-blue-100 text-blue-700',
  LOCAL_RECORDED: 'bg-orange-100 text-orange-700',
  SEND_FAILED: 'bg-red-100 text-red-700',
  SUBMITTED: 'bg-amber-100 text-amber-700',
  ACCEPTED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  ADJUSTED: 'bg-violet-100 text-violet-700',
};

// 🔴 전송 근거가 없는 상태는 초록/성공색을 쓰지 않는다(P17 근거 없이 안심시킴).
const TX_COLOR: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  VALIDATED: 'bg-blue-100 text-blue-700',
  LOCAL_ONLY: 'bg-orange-100 text-orange-700',
  SEND_FAILED: 'bg-red-100 text-red-700',
  UNVERIFIED: 'bg-red-100 text-red-700',
  REVIEW_RECORDED: 'bg-violet-100 text-violet-700',
  SENT: 'bg-green-100 text-green-700',
};

const TYPE_LABEL: Record<string, string> = { OUTPATIENT: '외래', INPATIENT: '입원', PHARMACY: '약국' };

export default function HiraEdiPage() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [tab, setTab] = useState<HiraTab>('claims');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [generateClaimId, setGenerateClaimId] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['hira-claims'],
    queryFn: () => apiClient.get<{ data: HiraDocument[] }>('/api/v1/hira-edi'),
    refetchInterval: pollMs('normal'),
  });

  const { data: statsData } = useQuery({
    queryKey: ['hira-stats'],
    queryFn: () => apiClient.get<{ data: HiraStats }>('/api/v1/hira-edi/stats'),
  });

  const validateMut = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/hira-edi/${id}/validate`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hira-claims'] }); toast.success(tAttr('검증 완료@완료')); },
    onError: () => toast.error(tAttr('검증 실패')),
  });

  // 🔴 C1 — '제출 완료'라고 말하지 않는다. 서버가 실제 전송 여부(transmission)를 돌려준다.
  const submitMut = useMutation({
    mutationFn: (id: string) => apiClient.post<{ data: HiraDocument }>(`/api/v1/hira-edi/${id}/submit`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['hira-claims'] });
      qc.invalidateQueries({ queryKey: ['hira-stats'] });
      const r = res?.data as unknown as Record<string, unknown>;
      const doc = ((r?.data ?? r) ?? {}) as HiraDocument;
      if (doc.transmission?.transmitted) toast.success(tAttr('심평원 전송 완료'));
      else toast.warning(doc.transmission?.note ?? tAttr('원내 접수만 완료 — 심평원으로 전송되지 않았습니다'));
    },
    onError: () => toast.error(tAttr('제출 실패')),
  });

  const regenerateMut = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/hira-edi/${id}/regenerate`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hira-claims'] }); toast.success(tAttr('재생성 완료')); },
    onError: () => toast.error(tAttr('재생성 실패')),
  });

  const generateMut = useMutation({
    mutationFn: (claimId: string) => apiClient.post(`/api/v1/hira-edi/generate/${claimId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hira-claims'] }); toast.success(tAttr('명세서 생성 완료')); setShowGenerate(false); setGenerateClaimId(''); },
    onError: () => toast.error(tAttr('명세서 생성 실패')),
  });

  const _raw = data?.data;
  const allClaims: HiraDocument[] = Array.isArray(_raw) ? _raw : (_raw as unknown as Record<string, unknown>)?.data as HiraDocument[] ?? [];
  const stats: HiraStats | null = (() => { const r = statsData?.data; if (!r) return null; return (r as unknown as Record<string, unknown>)?.data as HiraStats ?? r as unknown as HiraStats; })();

  const counts = useMemo(() => ({
    draft: allClaims.filter(c => c.status === 'DRAFT').length,
    validated: allClaims.filter(c => c.status === 'VALIDATED').length,
    // 🔴 '제출됨' 은 실제 전송된 건만 센다(종전 status==='SUBMITTED' 는 전송 근거가 없었다).
    transmitted: allClaims.filter(c => c.transmission?.transmitted).length,
    notTransmitted: allClaims.filter(c => c.transmission && !c.transmission.transmitted
      && ['LOCAL_ONLY', 'SEND_FAILED', 'UNVERIFIED'].includes(c.transmission.state)).length,
    accepted: allClaims.filter(c => c.status === 'ACCEPTED').length,
    rejected: allClaims.filter(c => c.status === 'REJECTED').length,
  }), [allClaims]);

  const channelReady = stats?.channel?.implemented ?? false;

  // 🔴 값이 없으면 0 이라고 말하지 않는다(P1) — 모르는 값은 '-'.
  const formatAmount = (n: number | null | undefined) =>
    typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('ko-KR') : '-';

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">HIRA EDI <T k="청구" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="건강보험심사평가원 전자청구 관리" /></p>
        </div>
        <button onClick={() => setShowGenerate(true)}
          className="px-4 py-2.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
          <T k="+ 명세서 생성" />
        </button>
      </div>

      {/* 🔴 C1 — 심평원 전송 연동이 없다는 사실을 화면 맨 위에서 말한다(성공을 흉내내지 않는다). */}
      {!channelReady && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
          <p className="text-sm font-bold text-orange-800"><T k="심평원 전송 연동 미구축 — 이 화면의 제출은 원내 접수까지입니다" /></p>
          <p className="text-xs text-orange-700 mt-0.5">
            {stats?.channel?.manualFallback ?? tAttr('요양기관업무포털에서 EDI 명세서를 수기 제출한 뒤, 심평원 접수번호를 「심사결과 기록」에 입력하십시오')}
          </p>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-5 gap-4">
        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-xs text-gray-500 font-medium"><T k="초안" /></p>
          <p className="text-3xl font-bold text-gray-700 mt-1">{counts.draft}</p>
        </div>
        <div className="bg-blue-50 rounded-xl p-4">
          <p className="text-xs text-blue-500 font-medium"><T k="검증완료" /></p>
          <p className="text-3xl font-bold text-blue-700 mt-1">{counts.validated}</p>
        </div>
        <div className="bg-orange-50 rounded-xl p-4">
          <p className="text-xs text-orange-500 font-medium"><T k="원내 접수(미전송)" /></p>
          <p className="text-3xl font-bold text-orange-700 mt-1">{counts.notTransmitted}</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4">
          <p className="text-xs text-green-500 font-medium"><T k="심평원 전송됨" /></p>
          <p className="text-3xl font-bold text-green-700 mt-1">{counts.transmitted}</p>
        </div>
        <div className="bg-red-50 rounded-xl p-4">
          <p className="text-xs text-red-500 font-medium"><T k="반려" /></p>
          <p className="text-3xl font-bold text-red-700 mt-1">{counts.rejected}</p>
        </div>
      </div>

      {/* Generate Modal */}
      {showGenerate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-gray-900 mb-4"><T k="명세서 생성" /></h3>
            <label className="block text-sm font-medium text-gray-700 mb-1"><T k="청구 ID" /></label>
            <input value={generateClaimId} onChange={e => setGenerateClaimId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mb-4" placeholder={tAttr('청구 ID를 입력하세요')} />
            <div className="flex gap-2">
              <button onClick={() => { if (generateClaimId.trim()) generateMut.mutate(generateClaimId.trim()); }}
                disabled={generateMut.isPending || !generateClaimId.trim()}
                className="flex-1 py-2.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                <T k={generateMut.isPending ? '생성 중...' : '생성'} />
              </button>
              <button onClick={() => { setShowGenerate(false); setGenerateClaimId(''); }}
                className="px-4 py-2.5 text-sm font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100/80 p-1 rounded-xl w-fit">
        {([
          { key: 'claims' as HiraTab, label: '명세서 목록' },
          { key: 'stats' as HiraTab, label: '통계' },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}><T k={t.label} /></button>
        ))}
      </div>

      {/* Claims Table */}
      {tab === 'claims' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="청구번호" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자명" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="유형" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="기간" /></th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500"><T k="총액" /></th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500"><T k="보험자부담" /></th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500"><T k="본인부담" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="심평원 전송" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="생성일" /></th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500"><T k="작업" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td colSpan={11} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                  </tr>
                ))
              ) : allClaims.length === 0 ? (
                <tr><td colSpan={11} className="py-12 text-center text-gray-400"><T k="청구 명세서가 없습니다" /></td></tr>
              ) : allClaims.map(claim => {
                const tx = claim.transmission;
                const canSubmit = ['VALIDATED', 'LOCAL_RECORDED', 'SEND_FAILED'].includes(claim.status);
                const canRegenerate = !tx?.transmitted && !['ACCEPTED', 'ADJUSTED'].includes(claim.status);
                return (
                <tr key={claim.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">
                    {claim.claim?.claimNumber ?? <span className="text-gray-300"><T k="미발번" /></span>}
                    {claim.receiptNo && <p className="text-[10px] text-orange-600 mt-0.5">{claim.receiptNo}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{claim.patient?.familyName}{claim.patient?.givenName}</p>
                    <p className="text-[10px] text-gray-400">{claim.patient?.mrn}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-indigo-100 text-indigo-700">
                      <T k={TYPE_LABEL[claim.documentType] ?? claim.documentType} />
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {kdate(claim.treatmentFrom && new Date(claim.treatmentFrom))}
                    {claim.treatmentTo && ` ~ ${kdate(new Date(claim.treatmentTo))}`}
                  </td>
                  <td className="px-4 py-3 text-right text-xs font-mono text-gray-700">{formatAmount(claim.totalAmount)}</td>
                  <td className="px-4 py-3 text-right text-xs font-mono text-gray-700">{formatAmount(claim.insuranceAmount)}</td>
                  <td className="px-4 py-3 text-right text-xs font-mono text-gray-700">{formatAmount(claim.patientAmount)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[claim.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      <T k={STATUS_LABEL[claim.status] ?? claim.status} />
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {tx ? (
                      <span title={tAttr(tx.note)}
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${TX_COLOR[tx.state] ?? 'bg-gray-100 text-gray-600'}`}>
                        <T k={tx.label} />
                      </span>
                    ) : <span className="text-[10px] text-gray-400">-</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {claim.createdAt ?kdate(claim.createdAt, 'date') : '-'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {claim.status === 'DRAFT' && (
                        <button onClick={() => validateMut.mutate(claim.id)} disabled={validateMut.isPending}
                          className="px-2.5 py-1 text-[10px] font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 whitespace-nowrap"><T k="검증" /></button>
                      )}
                      {canSubmit && (
                        <button onClick={() => submitMut.mutate(claim.id)} disabled={submitMut.isPending}
                          className="px-2.5 py-1 text-[10px] font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 whitespace-nowrap">
                          <T k={claim.status === 'VALIDATED' ? '제출' : '재제출'} />
                        </button>
                      )}
                      {canRegenerate && (
                        <button onClick={() => regenerateMut.mutate(claim.id)} disabled={regenerateMut.isPending}
                          className="px-2.5 py-1 text-[10px] font-medium bg-gray-600 text-white rounded-lg hover:bg-gray-700 whitespace-nowrap"><T k="재생성" /></button>
                      )}
                      {claim.validationErrors && claim.validationErrors.length > 0 && (
                        <button onClick={() => setExpandedId(expandedId === claim.id ? null : claim.id)}
                          className="px-2.5 py-1 text-[10px] font-medium bg-red-100 text-red-700 rounded-lg hover:bg-red-200 whitespace-nowrap">
                          <T k="오류" /> {claim.validationErrors.length}
                        </button>
                      )}
                    </div>
                    {/* 🔴 검증 오류는 서버 계약상 string[] — 종전 {field,message} 로 읽어 전부 공백이었다 */}
                    {expandedId === claim.id && claim.validationErrors && claim.validationErrors.length > 0 && (
                      <div className="mt-2 text-left bg-red-50 rounded-lg p-2 space-y-1">
                        {claim.validationErrors.map((err, idx) => (
                          <p key={idx} className="text-[10px] text-red-700">{err}</p>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Stats Tab */}
      {tab === 'stats' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs text-gray-500 font-medium mb-2"><T k="상태별 현황" /></p>
              <div className="space-y-2">
                {Object.entries(STATUS_LABEL).map(([key, label]) => {
                  const count = allClaims.filter(c => c.status === key).length;
                  return (
                    <div key={key} className="flex items-center justify-between">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[key]}`}><T k={label} /></span>
                      <span className="text-sm font-bold text-gray-900">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs text-gray-500 font-medium mb-2"><T k="총 청구액" /></p>
              <p className="text-2xl font-bold text-gray-900 mt-4">
                {formatAmount(stats?.totalAmount ?? allClaims.reduce((s, c) => s + (c.totalAmount ?? 0), 0))}
                <span className="text-sm font-normal text-gray-400 ml-1"><T k="원" /></span>
              </p>
              <p className="text-[10px] text-gray-400 mt-2">
                <T k="보험자부담" /> {formatAmount(stats?.insuranceAmount)} · <T k="본인부담" /> {formatAmount(stats?.patientAmount)}
              </p>
            </div>
            {/*
              🔴 C1 — 종전 '승인율'은 심사결과를 한 번도 받아본 적이 없는 분모(전체 명세서) 위에서
              계산돼 늘 0%였고, 그것이 마치 심사 성적처럼 보였다(P17). 심사결과 기록이 없으면
              '산출 불가'라고 말한다.
            */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs text-gray-500 font-medium mb-2"><T k="심사 승인율" /></p>
              {(() => {
                const reviewed = allClaims.filter(c => ['ACCEPTED', 'REJECTED', 'ADJUSTED'].includes(c.status)).length;
                if (reviewed === 0) {
                  return (
                    <>
                      <p className="text-lg font-bold text-gray-400 mt-4"><T k="산출 불가" /></p>
                      <p className="text-[10px] text-gray-400 mt-1"><T k="심사결과가 기록된 명세서가 없습니다(표본 0)" /></p>
                    </>
                  );
                }
                return (
                  <>
                    <p className="text-2xl font-bold text-emerald-700 mt-4">
                      {formatNum((counts.accepted / reviewed) * 100, 'percent', { unit: false })}
                      <span className="text-sm font-normal text-gray-400 ml-1">%</span>
                    </p>
                    <p className="text-[10px] text-gray-400 mt-1"><T k="심사결과 기록" /> {reviewed}<T k="건 기준" /></p>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
