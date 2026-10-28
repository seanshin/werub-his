'use client';

import { useState } from 'react';
import { formatNum } from '@hospital-run/shared';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useHasRole } from '@/hooks/use-admin-write';
import { toast } from '@/stores/toast-store';
import { pollMs, kdate } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface GenomicPatientRef {
  familyName?: string;
  givenName?: string;
  mrn?: string;
}

interface GenomicVariant {
  id: string;
  gene: string;
  hgvsC?: string;
  hgvsP?: string;
  variantType: string;
  classification: string;
  alleleFreq?: number | string | null;
  actionability?: string;
  chromosome?: string;
  dbSnpId?: string;
  cosmicId?: string;
  clinicalSig?: string;
}

interface GenomicReport {
  id: string;
  reportType: string;
  interpretation?: string;
  recommendation?: string;
  reportedAt: string;
  reporter?: { familyName?: string; givenName?: string };
}

interface GenomicTestSummary {
  id: string;
  status: string;
  testType: string;
  panelName?: string;
  orderedAt?: string;
  patient?: GenomicPatientRef;
  _count?: { variants?: number };
}

interface GenomicTestDetail {
  id: string;
  status: string;
  testType: string;
  sampleType: string;
  panelName?: string;
  orderedAt: string;
  patient?: GenomicPatientRef;
  orderer?: { familyName?: string; givenName?: string };
  referenceLab?: { name: string };
  variants?: GenomicVariant[];
  reports?: GenomicReport[];
  variantSummary?: { total: number; pathogenic: number; actionable: number };
  counselNotes?: string;
  counseledAt?: string;
}

const STATUS_STEPS = [
  { key: 'ORDERED', label: '오더' },
  { key: 'SAMPLE_RECEIVED', label: '검체접수' },
  { key: 'EXTRACTION', label: 'DNA추출' },
  { key: 'LIBRARY_PREP', label: '라이브러리' },
  { key: 'SEQUENCING', label: '시퀀싱' },
  { key: 'ANALYSIS', label: '분석' },
  { key: 'INTERPRETATION', label: '판독' },
  { key: 'REPORTED', label: '보고' },
  { key: 'COUNSELED', label: '상담완료' },
];

const STATUS_COLOR: Record<string, string> = {
  ORDERED: 'bg-blue-100 text-blue-700',
  SAMPLE_RECEIVED: 'bg-indigo-100 text-indigo-700',
  EXTRACTION: 'bg-purple-100 text-purple-700',
  LIBRARY_PREP: 'bg-violet-100 text-violet-700',
  SEQUENCING: 'bg-amber-100 text-amber-700',
  ANALYSIS: 'bg-orange-100 text-orange-700',
  INTERPRETATION: 'bg-cyan-100 text-cyan-700',
  REPORTED: 'bg-emerald-100 text-emerald-700',
  COUNSELED: 'bg-gray-200 text-gray-600',
};

const ACMG_COLOR: Record<string, string> = {
  PATHOGENIC: 'bg-red-100 text-red-700',
  LIKELY_PATHOGENIC: 'bg-orange-100 text-orange-700',
  VUS: 'bg-gray-100 text-gray-600',
  LIKELY_BENIGN: 'bg-blue-100 text-blue-700',
  BENIGN: 'bg-green-100 text-green-700',
};

const ACMG_LABEL: Record<string, string> = {
  PATHOGENIC: 'Pathogenic',
  LIKELY_PATHOGENIC: 'Likely Path.',
  VUS: 'VUS',
  LIKELY_BENIGN: 'Likely Benign',
  BENIGN: 'Benign',
};

const TIER_LABEL: Record<string, string> = { TIER_1: 'Tier I', TIER_2: 'Tier II', TIER_3: 'Tier III', TIER_4: 'Tier IV' };
const TIER_COLOR: Record<string, string> = { TIER_1: 'bg-red-100 text-red-700', TIER_2: 'bg-orange-100 text-orange-700', TIER_3: 'bg-gray-100 text-gray-600', TIER_4: 'bg-gray-50 text-gray-400' };

const TEST_TYPE_LABEL: Record<string, string> = { WGS: 'WGS (전장유전체)', WES: 'WES (전장엑솜)', PANEL: '패널', SINGLE_GENE: '단일유전자', SOMATIC: '체세포변이', PHARMACOGENOMICS: '약물유전체' };
const SAMPLE_TYPE_LABEL: Record<string, string> = { BLOOD: '혈액', TISSUE: '조직', SALIVA: '타액', BONE_MARROW: '골수', FFPE: 'FFPE' };

export default function GenomicsTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showVariantForm, setShowVariantForm] = useState(false);
  const [showReportForm, setShowReportForm] = useState(false);
  const [showCounselForm, setShowCounselForm] = useState(false);

  const [form, setForm] = useState({
    patientId: '', testType: 'PANEL', panelName: '', sampleType: 'BLOOD', referenceLabId: '', notes: '',
  });
  const [variantForm, setVariantForm] = useState({
    gene: '', chromosome: '', position: '', variantType: 'SNV',
    classification: 'VUS', alleleFreq: '', actionability: '', hgvsC: '', hgvsP: '',
    dbSnpId: '', cosmicId: '', clinicalSig: '',
  });
  const [reportForm, setReportForm] = useState({ reportType: 'FINAL', interpretation: '', recommendation: '', reportFileUrl: '' });
  const [counselNotes, setCounselNotes] = useState('');

  const { data: testsData, isLoading } = useQuery({
    queryKey: ['genomic-tests'],
    queryFn: () => apiClient.get<{ data: GenomicTestSummary[] | { data: GenomicTestSummary[] } }>('/api/v1/lab/genomics/tests'),
    refetchInterval: pollMs('normal'),
  });

  const { data: detailData } = useQuery({
    queryKey: ['genomic-detail', selectedId],
    queryFn: () => apiClient.get<{ data: GenomicTestDetail | { data: GenomicTestDetail } }>(`/api/v1/lab/genomics/tests/${selectedId}`),
    enabled: !!selectedId,
    refetchInterval: pollMs('fast'),
  });

  const createMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/lab/genomics/tests', {
      ...form,
      referenceLabId: form.referenceLabId || undefined,
      panelName: form.panelName || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['genomic-tests'] }); setShowCreate(false); toast.success('유전체 검사 오더 완료'); },
    onError: () => toast.error('오더 실패'),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiClient.patch(`/api/v1/lab/genomics/tests/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['genomic-tests'] });
      qc.invalidateQueries({ queryKey: ['genomic-detail', selectedId] });
      toast.success('상태 변경');
    },
  });

  const variantMut = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/lab/genomics/tests/${id}/variants`, {
      ...variantForm,
      position: variantForm.position ? parseInt(variantForm.position) : undefined,
      alleleFreq: variantForm.alleleFreq ? parseFloat(variantForm.alleleFreq) : undefined,
      actionability: variantForm.actionability || undefined,
      chromosome: variantForm.chromosome || undefined,
      dbSnpId: variantForm.dbSnpId || undefined,
      cosmicId: variantForm.cosmicId || undefined,
      hgvsC: variantForm.hgvsC || undefined,
      hgvsP: variantForm.hgvsP || undefined,
      clinicalSig: variantForm.clinicalSig || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['genomic-detail', selectedId] });
      setShowVariantForm(false);
      setVariantForm({ gene: '', chromosome: '', position: '', variantType: 'SNV', classification: 'VUS', alleleFreq: '', actionability: '', hgvsC: '', hgvsP: '', dbSnpId: '', cosmicId: '', clinicalSig: '' });
      toast.success('변이 추가 완료');
    },
    onError: () => toast.error('변이 추가 실패'),
  });

  const reportMut = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/lab/genomics/tests/${id}/reports`, {
      ...reportForm,
      interpretation: reportForm.interpretation || undefined,
      recommendation: reportForm.recommendation || undefined,
      reportFileUrl: reportForm.reportFileUrl || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['genomic-detail', selectedId] });
      setShowReportForm(false);
      setReportForm({ reportType: 'FINAL', interpretation: '', recommendation: '', reportFileUrl: '' });
      toast.success('보고서 추가 완료');
    },
    onError: () => toast.error('보고서 추가 실패'),
  });

  /**
   * 🔴 (2026-09-17 L3) 유전상담 기록은 서버가 `@Roles(DOCTOR, ADMIN)` 다 — 결과를 환자에게 설명한
   *    사람의 기록이라 검사기사에게 열지 않는다. nav(`/lab`)는 LAB_TECH 를 포함하는데 버튼은 그대로
   *    그려 누를 때마다 403 이었다(같은 화면의 세포치료제 출하와 같은 자리).
   */
  const canCounsel = useHasRole('DOCTOR');
  const counselMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/lab/genomics/tests/${id}/counsel`, { notes: counselNotes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['genomic-tests'] });
      qc.invalidateQueries({ queryKey: ['genomic-detail', selectedId] });
      setShowCounselForm(false);
      setCounselNotes('');
      toast.success('유전상담 기록 완료');
    },
    onError: () => toast.error('상담 기록 실패'),
  });

  const tests: GenomicTestSummary[] = (() => {
    const r = testsData?.data;
    return Array.isArray(r) ? r : (r as { data: GenomicTestSummary[] })?.data ?? [];
  })();
  const detail: GenomicTestDetail | null = detailData?.data
    ? ((detailData.data as { data: GenomicTestDetail })?.data ?? detailData.data) as GenomicTestDetail
    : null;

  const getStatusIndex = (status: string) => STATUS_STEPS.findIndex((s) => s.key === status);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900"><T k="유전체 검사 (Genomics)" /></h3>
        <button onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 text-xs font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700"><T k="+ 새 오더" /></button>
      </div>

      {showCreate && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
          <p className="text-xs font-bold text-gray-700"><T k="새 유전체 검사 오더" /></p>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-[10px] text-gray-500"><T k="환자 ID *" /></label>
              <input value={form.patientId} onChange={(e) => setForm({ ...form, patientId: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" /></div>
            <div><label className="text-[10px] text-gray-500"><T k="검사 유형" /></label>
              <select value={form.testType} onChange={(e) => setForm({ ...form, testType: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white">
                {Object.entries(TEST_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className="text-[10px] text-gray-500"><T k="검체 유형" /></label>
              <select value={form.sampleType} onChange={(e) => setForm({ ...form, sampleType: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white">
                {Object.entries(SAMPLE_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-[10px] text-gray-500"><T k="패널명" /></label>
              <input value={form.panelName} onChange={(e) => setForm({ ...form, panelName: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder={tAttr('예: OncoPanel v3')} /></div>
            <div><label className="text-[10px] text-gray-500"><T k="비고" /></label>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" /></div>
            <div className="flex items-end">
              <button onClick={() => createMut.mutate()} disabled={!form.patientId || createMut.isPending}
                className="min-h-[44px] px-3 py-2 text-xs font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 w-full">
                <T k={createMut.isPending ? '생성 중...' : '오더 생성'} /></button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_480px] gap-4">
        {/* 검사 목록 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[90px]"><T k="상태" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[100px]"><T k="유형" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[120px]"><T k="패널" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]"><T k="변이" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="오더일" /></th>
            </tr></thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)
              ) : tests.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="유전체 검사가 없습니다" /></td></tr>
              ) : tests.map((t: GenomicTestSummary) => (
                <tr key={t.id} onClick={() => setSelectedId(t.id)}
                  className={`border-b border-gray-50 cursor-pointer ${selectedId === t.id ? 'bg-purple-50' : 'hover:bg-gray-50'}`}>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[t.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      <T k={STATUS_STEPS.find((s) => s.key === t.status)?.label ?? t.status} />
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{t.patient?.familyName}{t.patient?.givenName}</p>
                    <p className="text-[10px] text-gray-400">{t.patient?.mrn}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500"><T k={TEST_TYPE_LABEL[t.testType] ?? t.testType} /></td>
                  <td className="px-4 py-3 text-xs text-gray-500 truncate max-w-[120px]">{t.panelName ?? '-'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{t._count?.variants ?? 0}</td>
                  <td className="px-4 py-3 text-xs text-gray-400 font-mono">
                    {t.orderedAt ? kdate(t.orderedAt) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 상세 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 max-h-[800px] overflow-y-auto">
          {!selectedId ? (
            <p className="text-sm text-gray-400 text-center py-8"><T k="검사를 선택하세요" /></p>
          ) : !detail ? (
            <p className="text-xs text-gray-400 text-center py-4"><T k="로딩 중..." /></p>
          ) : (
            <div className="space-y-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-gray-900"><T k={TEST_TYPE_LABEL[detail.testType] ?? detail.testType} /></h4>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[detail.status]}`}>
                  <T k={STATUS_STEPS.find((s) => s.key === detail.status)?.label ?? detail.status} />
                </span>
              </div>

              {/* 9-step workflow indicator */}
              <div className="flex items-center gap-0.5 overflow-x-auto pb-1">
                {STATUS_STEPS.map((step, i) => {
                  const currentIdx = getStatusIndex(detail.status);
                  const isDone = i <= currentIdx;
                  const isCurrent = i === currentIdx;
                  return (
                    <div key={step.key} className="flex items-center">
                      <div className={`text-[8px] px-1.5 py-0.5 rounded whitespace-nowrap ${
                        isCurrent ? 'bg-purple-600 text-white font-bold' :
                        isDone ? 'bg-purple-100 text-purple-700' : 'bg-gray-50 text-gray-300'
                      }`}><T k={step.label} /></div>
                      {i < STATUS_STEPS.length - 1 && <span className={`text-[8px] mx-0.5 ${isDone ? 'text-purple-400' : 'text-gray-200'}`}>&rarr;</span>}
                    </div>
                  );
                })}
              </div>

              {/* 환자 정보 */}
              <div className="bg-purple-50 rounded-xl p-3 text-xs space-y-1">
                <div><span className="text-purple-600"><T k="환자:" /></span> <span className="font-medium text-gray-900">{detail.patient?.familyName}{detail.patient?.givenName}</span> ({detail.patient?.mrn})</div>
                <div><span className="text-purple-600"><T k="검체:" /></span> <span className="text-gray-700"><T k={SAMPLE_TYPE_LABEL[detail.sampleType] ?? detail.sampleType} /></span></div>
                {detail.panelName && <div><span className="text-purple-600"><T k="패널:" /></span> <span className="text-gray-700">{detail.panelName}</span></div>}
                {detail.referenceLab && <div><span className="text-purple-600"><T k="위탁:" /></span> <span className="text-gray-700">{detail.referenceLab.name}</span></div>}
                <div><span className="text-purple-600"><T k="오더:" /></span> <span className="text-gray-700">{detail.orderer?.familyName}{detail.orderer?.givenName}</span> ({kdate(new Date(detail.orderedAt))})</div>
              </div>

              {/* 변이 요약 */}
              {detail.variantSummary && (
                <div className="flex gap-2 text-xs">
                  <div className="flex-1 bg-gray-50 rounded-lg p-2 text-center">
                    <p className="text-gray-400"><T k="변이 총" /></p><p className="font-bold text-gray-900">{detail.variantSummary.total}</p>
                  </div>
                  <div className="flex-1 bg-red-50 rounded-lg p-2 text-center">
                    <p className="text-red-400"><T k="병원성" /></p><p className="font-bold text-red-700">{detail.variantSummary.pathogenic}</p>
                  </div>
                  <div className="flex-1 bg-orange-50 rounded-lg p-2 text-center">
                    <p className="text-orange-400"><T k="실행가능" /></p><p className="font-bold text-orange-700">{detail.variantSummary.actionable}</p>
                  </div>
                </div>
              )}

              {/* 변이 테이블 */}
              {detail.variants && detail.variants.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-500 mb-1"><T k="변이 목록" /></p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px]">
                      <thead><tr className="bg-gray-50">
                        <th className="px-2 py-1 text-left text-gray-500">Gene</th>
                        <th className="px-2 py-1 text-left text-gray-500">HGVS</th>
                        <th className="px-2 py-1 text-left text-gray-500">ACMG</th>
                        <th className="px-2 py-1 text-left text-gray-500">VAF</th>
                        <th className="px-2 py-1 text-left text-gray-500">Tier</th>
                      </tr></thead>
                      <tbody>
                        {detail.variants.map((v: GenomicVariant) => (
                          <tr key={v.id} className="border-b border-gray-50">
                            <td className="px-2 py-1 font-bold text-gray-900">{v.gene}</td>
                            <td className="px-2 py-1 text-gray-500 font-mono">{v.hgvsP ?? v.hgvsC ?? '-'}</td>
                            <td className="px-2 py-1">
                              <span className={`px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap ${ACMG_COLOR[v.classification] ?? 'bg-gray-100 text-gray-500'}`}>
                                <T k={ACMG_LABEL[v.classification] ?? v.classification} />
                              </span>
                            </td>
                            <td className="px-2 py-1 text-gray-500">{v.alleleFreq != null ? `${formatNum(parseFloat(String(v.alleleFreq)) * 100, 'percent', { unit: false })}%` : '-'}</td>
                            <td className="px-2 py-1">
                              {v.actionability ? (
                                <span className={`px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap ${TIER_COLOR[v.actionability] ?? 'bg-gray-50 text-gray-400'}`}>
                                  <T k={TIER_LABEL[v.actionability] ?? v.actionability} />
                                </span>
                              ) : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 변이 추가 */}
              {!showVariantForm ? (
                <button onClick={() => setShowVariantForm(true)}
                  className="w-full py-1 text-[10px] text-purple-600 border border-dashed border-purple-200 rounded-lg hover:bg-purple-50"><T k="+ 변이 추가" /></button>
              ) : (
                <div className="space-y-1.5 bg-purple-50/50 rounded-xl p-2">
                  <p className="text-[10px] font-bold text-purple-700"><T k="변이 추가" /></p>
                  <div className="grid grid-cols-3 gap-1.5">
                    <input value={variantForm.gene} onChange={(e) => setVariantForm({ ...variantForm, gene: e.target.value })}
                      className="px-2 py-1 border border-gray-200 rounded text-xs" placeholder="Gene *" />
                    <select value={variantForm.variantType} onChange={(e) => setVariantForm({ ...variantForm, variantType: e.target.value })}
                      className="px-2 py-1 border border-gray-200 rounded text-xs bg-white">
                      <option value="SNV">SNV</option><option value="INDEL">INDEL</option><option value="CNV">CNV</option><option value="FUSION">FUSION</option>
                    </select>
                    <select value={variantForm.classification} onChange={(e) => setVariantForm({ ...variantForm, classification: e.target.value })}
                      className="px-2 py-1 border border-gray-200 rounded text-xs bg-white">
                      {Object.entries(ACMG_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <input value={variantForm.hgvsC} onChange={(e) => setVariantForm({ ...variantForm, hgvsC: e.target.value })}
                      className="px-2 py-1 border border-gray-200 rounded text-xs" placeholder="HGVS.c" />
                    <input value={variantForm.hgvsP} onChange={(e) => setVariantForm({ ...variantForm, hgvsP: e.target.value })}
                      className="px-2 py-1 border border-gray-200 rounded text-xs" placeholder="HGVS.p" />
                    <input value={variantForm.alleleFreq} onChange={(e) => setVariantForm({ ...variantForm, alleleFreq: e.target.value })}
                      className="px-2 py-1 border border-gray-200 rounded text-xs" placeholder="VAF (0-1)" type="number" step="0.01" />
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <select value={variantForm.actionability} onChange={(e) => setVariantForm({ ...variantForm, actionability: e.target.value })}
                      className="px-2 py-1 border border-gray-200 rounded text-xs bg-white">
                      <option value=""><T k="Tier (선택)" /></option>
                      {Object.entries(TIER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <input value={variantForm.dbSnpId} onChange={(e) => setVariantForm({ ...variantForm, dbSnpId: e.target.value })}
                      className="px-2 py-1 border border-gray-200 rounded text-xs" placeholder="dbSNP ID" />
                    <input value={variantForm.cosmicId} onChange={(e) => setVariantForm({ ...variantForm, cosmicId: e.target.value })}
                      className="px-2 py-1 border border-gray-200 rounded text-xs" placeholder="COSMIC ID" />
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => detail && variantMut.mutate(detail.id)} disabled={!variantForm.gene}
                      className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"><T k="추가" /></button>
                    <button onClick={() => setShowVariantForm(false)} className="px-2 py-1 text-[10px] bg-gray-100 text-gray-500 rounded"><T k="취소" /></button>
                  </div>
                </div>
              )}

              {/* 보고서 */}
              {detail.reports && detail.reports.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-500 mb-1"><T k="보고서" /></p>
                  {detail.reports.map((r: GenomicReport) => (
                    <div key={r.id} className="bg-gray-50 rounded-lg p-2 mb-1 text-[10px]">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-gray-700">{r.reportType}</span>
                        <span className="text-gray-400">{r.reporter?.familyName}{r.reporter?.givenName} ({kdate(new Date(r.reportedAt))})</span>
                      </div>
                      {r.interpretation && <p className="text-gray-600 mt-1">{r.interpretation}</p>}
                      {r.recommendation && <p className="text-emerald-600 mt-0.5">{r.recommendation}</p>}
                    </div>
                  ))}
                </div>
              )}

              {/* 보고서 추가 */}
              {!showReportForm ? (
                <button onClick={() => setShowReportForm(true)}
                  className="w-full py-1 text-[10px] text-emerald-600 border border-dashed border-emerald-200 rounded-lg hover:bg-emerald-50"><T k="+ 보고서 추가" /></button>
              ) : (
                <div className="space-y-1.5 bg-emerald-50/50 rounded-xl p-2">
                  <p className="text-[10px] font-bold text-emerald-700"><T k="보고서 추가" /></p>
                  <select value={reportForm.reportType} onChange={(e) => setReportForm({ ...reportForm, reportType: e.target.value })}
                    className="w-full px-2 py-1 border border-gray-200 rounded text-xs bg-white">
                    <option value="PRELIMINARY"><T k="예비 보고" /></option><option value="FINAL"><T k="최종 보고" /></option><option value="AMENDED"><T k="수정 보고" /></option>
                  </select>
                  <textarea value={reportForm.interpretation} onChange={(e) => setReportForm({ ...reportForm, interpretation: e.target.value })}
                    className="w-full px-2 py-1 border border-gray-200 rounded text-xs resize-none" rows={2} placeholder={tAttr('해석 (Interpretation)')} />
                  <textarea value={reportForm.recommendation} onChange={(e) => setReportForm({ ...reportForm, recommendation: e.target.value })}
                    className="w-full px-2 py-1 border border-gray-200 rounded text-xs resize-none" rows={2} placeholder={tAttr('권고사항 (Recommendation)')} />
                  <div className="flex gap-1">
                    <button onClick={() => detail && reportMut.mutate(detail.id)}
                      className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700"><T k="추가" /></button>
                    <button onClick={() => setShowReportForm(false)} className="px-2 py-1 text-[10px] bg-gray-100 text-gray-500 rounded"><T k="취소" /></button>
                  </div>
                </div>
              )}

              {/* 상담 기록 */}
              {detail.counselNotes && (
                <div className="bg-amber-50 rounded-lg p-2 text-[10px]">
                  <p className="font-bold text-amber-700 mb-0.5"><T k="유전상담 기록" /></p>
                  <p className="text-gray-700">{detail.counselNotes}</p>
                  <p className="text-gray-400 mt-0.5">{kdate(detail.counseledAt && new Date(detail.counseledAt))}</p>
                </div>
              )}

              {canCounsel && !showCounselForm && detail.status === 'REPORTED' && (
                <button onClick={() => setShowCounselForm(true)}
                  className="w-full py-1 text-[10px] text-amber-600 border border-dashed border-amber-200 rounded-lg hover:bg-amber-50"><T k="+ 유전상담 기록" /></button>
              )}
              {canCounsel && showCounselForm && (
                <div className="space-y-1.5 bg-amber-50/50 rounded-xl p-2">
                  <p className="text-[10px] font-bold text-amber-700"><T k="유전상담 기록" /></p>
                  <textarea value={counselNotes} onChange={(e) => setCounselNotes(e.target.value)}
                    className="w-full px-2 py-1 border border-gray-200 rounded text-xs resize-none" rows={3} placeholder={tAttr('상담 내용...')} />
                  <div className="flex gap-1">
                    <button onClick={() => detail && counselMut.mutate(detail.id)} disabled={!counselNotes}
                      className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"><T k="기록" /></button>
                    <button onClick={() => setShowCounselForm(false)} className="px-2 py-1 text-[10px] bg-gray-100 text-gray-500 rounded"><T k="취소" /></button>
                  </div>
                </div>
              )}

              {/* 상태 변경 */}
              <div className="flex gap-2 pt-2 border-t border-gray-100">
                {detail.status === 'ORDERED' && <button onClick={() => statusMut.mutate({ id: detail.id, status: 'SAMPLE_RECEIVED' })} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg"><T k="검체 접수" /></button>}
                {detail.status === 'SAMPLE_RECEIVED' && <button onClick={() => statusMut.mutate({ id: detail.id, status: 'EXTRACTION' })} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-purple-600 text-white rounded-lg"><T k="DNA 추출 시작" /></button>}
                {detail.status === 'EXTRACTION' && <button onClick={() => statusMut.mutate({ id: detail.id, status: 'LIBRARY_PREP' })} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-violet-600 text-white rounded-lg"><T k="라이브러리 준비" /></button>}
                {detail.status === 'LIBRARY_PREP' && <button onClick={() => statusMut.mutate({ id: detail.id, status: 'SEQUENCING' })} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-amber-600 text-white rounded-lg"><T k="시퀀싱 시작" /></button>}
                {detail.status === 'SEQUENCING' && <button onClick={() => statusMut.mutate({ id: detail.id, status: 'ANALYSIS' })} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-orange-600 text-white rounded-lg"><T k="분석 시작" /></button>}
                {detail.status === 'ANALYSIS' && <button onClick={() => statusMut.mutate({ id: detail.id, status: 'INTERPRETATION' })} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-cyan-600 text-white rounded-lg"><T k="판독 시작" /></button>}
                {detail.status === 'INTERPRETATION' && <button onClick={() => statusMut.mutate({ id: detail.id, status: 'REPORTED' })} className="flex-1 min-h-[48px] py-3 text-sm font-semibold bg-emerald-600 text-white rounded-lg"><T k="보고 완료" /></button>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
