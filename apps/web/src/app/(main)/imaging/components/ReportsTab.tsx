'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { pollMs, kdate } from '@/lib/ui-settings';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

const REPORT_STATUS: Record<string, { label: string; bg: string; text: string }> = {
  DRAFT: { label: '초안', bg: 'bg-gray-100', text: 'text-gray-600' },
  PRELIMINARY: { label: '예비판독', bg: 'bg-amber-50', text: 'text-amber-700' },
  FINAL: { label: '최종판독', bg: 'bg-emerald-50', text: 'text-emerald-700' },
};

interface PacsReport {
  id?: string;
  report_id?: string;
  status: string;
  study_description?: string;
  study_uid?: string;
  patient_id?: string;
  patient_name?: string;
  findings?: string;
  conclusion?: string;
  radiologist_name?: string;
  created_at?: string;
  signed_at?: string;
}

interface PacsReportsResponse {
  results: PacsReport[];
  count: number;
}

interface PacsReportDetail extends PacsReport {}

export function ReportsTab() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [statusFilter, setStatusFilter] = useState('');
  const [patientId, setPatientId] = useState('');
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['pacs-reports', statusFilter, patientId],
    queryFn: () => apiClient.get<{ data: PacsReportsResponse }>('/api/v1/pacs/reports', { status: statusFilter || undefined, patientId: patientId || undefined }),
    refetchInterval: pollMs('fast'),
  });

  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ['pacs-report-detail', selectedReportId],
    queryFn: () => apiClient.get<{ data: PacsReportDetail }>(`/api/v1/pacs/reports/${selectedReportId}`),
    enabled: !!selectedReportId,
  });

  const signMutation = useMutation({
    mutationFn: ({ id, asPreliminary }: { id: string; asPreliminary: boolean }) =>
      apiClient.post<{ data: PacsReport }>(`/api/v1/pacs/reports/${id}/sign?as_preliminary=${asPreliminary}`, {}),
    onSuccess: () => {
      toast.success(tAttr('리포트 서명이 완료되었습니다.'));
      qc.invalidateQueries({ queryKey: ['pacs-reports'] });
      qc.invalidateQueries({ queryKey: ['pacs-report-detail', selectedReportId] });
    },
    onError: () => toast.error(tAttr('서명에 실패했습니다.')),
  });

  const reports = data?.data?.results ?? [];
  const totalCount = data?.data?.count ?? 0;
  const reportDetail = detailData?.data;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-500 mb-1"><T k="환자 ID" /></label>
          <input value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder={tAttr('예: P000001')} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
        </div>
        <div className="w-36">
          <label className="block text-xs font-medium text-gray-500 mb-1"><T k="판독 상태" /></label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">
            <option value="">{tAttr('전체')}</option><option value="DRAFT">{tAttr('초안')}</option><option value="PRELIMINARY">{tAttr('예비판독')}</option><option value="FINAL">{tAttr('최종판독')}</option>
          </select>
        </div>
      </div>

      <div className="flex gap-4">
        <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden ${selectedReportId ? 'w-1/2' : 'w-full'} transition-all`}>
          {isLoading ? (
            <div className="p-5 space-y-4">{[...Array(4)].map((_, i) => (<div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />))}</div>
          ) : reports.length === 0 ? (
            isError ? (
              <div className="p-12 text-center">
                {/* 🔴 서버 사유는 서버가 조립한 문장이라 번역하지 않는다 — 없을 때의 원내 문구만 번역한다 */}
                <p className="text-sm text-red-600">{(error as { message?: string })?.message ?? tAttr('판독 리포트를 불러오지 못했습니다.')}</p>
                <p className="text-xs text-gray-400 mt-1"><T k="리포트가 없는 것이 아니라 조회에 실패했습니다." /></p>
                <button onClick={() => refetch()} className="mt-3 px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg"><T k="다시 시도" /></button>
              </div>
            ) : <div className="p-12 text-center"><p className="text-sm text-gray-400"><T k="판독 리포트가 없습니다." /></p></div>
          ) : (
            <>
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-100"><Tf className="text-xs text-gray-500" k="총 {건수}" params={{ 건수: <>{totalCount}<Unit>건</Unit></> }} /></div>
              <div className="divide-y divide-gray-50">
                {reports.map((report: PacsReport, idx: number) => {
                  const st = REPORT_STATUS[report.status] ?? { label: report.status ?? '미상', bg: 'bg-gray-100', text: 'text-gray-600' };
                  const reportId = report.id ?? report.report_id;
                  const isSelected = selectedReportId === reportId;
                  return (
                    <div key={reportId ?? idx} onClick={() => reportId && setSelectedReportId(isSelected ? null : reportId)}
                      className={`p-4 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 border-l-4 border-blue-600' : 'hover:bg-blue-50/30'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${st.bg} ${st.text}`}><T k={st.label} /></span>
                          <span className="text-sm font-medium text-gray-900">{report.study_description || report.study_uid?.slice(-12) || '-'}</span>
                        </div>
                        <span className="text-xs text-gray-400">{report.patient_id}{report.created_at && ` | ${kdate(new Date(report.created_at))}`}</span>
                      </div>
                      {report.findings && <p className="text-sm text-gray-600 line-clamp-2"><span className="font-medium text-gray-400"><T k="소견:" /></span> {report.findings}</p>}
                      {report.conclusion && <p className="text-sm text-gray-600 mt-1 line-clamp-1"><span className="font-medium text-gray-400"><T k="결론:" /></span> {report.conclusion}</p>}
                      {report.radiologist_name && <Tf className="text-xs text-gray-400 mt-1 block" k="판독의: {판독의}" params={{ 판독의: report.radiologist_name }} />}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {selectedReportId && (
          <div className="w-1/2 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900"><T k="리포트 상세" /></h3>
              <button onClick={() => setSelectedReportId(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            {detailLoading ? (
              <div className="p-5 space-y-3">{[...Array(5)].map((_, i) => (<div key={i} className="h-6 bg-gray-100 rounded animate-pulse" />))}</div>
            ) : reportDetail ? (
              <div className="p-5 space-y-4">
                <div><span className="text-xs font-medium text-gray-400">Study</span><p className="text-sm text-gray-900">{reportDetail.study_description || reportDetail.study_uid || '-'}</p></div>
                <div><span className="text-xs font-medium text-gray-400"><T k="환자" /></span><p className="text-sm text-gray-900">{reportDetail.patient_name || reportDetail.patient_id || '-'}</p></div>
                <div><span className="text-xs font-medium text-gray-400"><T k="상태" /></span><p className="mt-1">{(() => { const st = REPORT_STATUS[reportDetail.status] ?? { label: reportDetail.status ?? '미상', bg: 'bg-gray-100', text: 'text-gray-600' }; return <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${st.bg} ${st.text}`}><T k={st.label} /></span>; })()}</p></div>
                {reportDetail.findings && <div><span className="text-xs font-medium text-gray-400"><T k="소견 (Findings)" /></span><p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{reportDetail.findings}</p></div>}
                {reportDetail.conclusion && <div><span className="text-xs font-medium text-gray-400"><T k="결론 (Conclusion)" /></span><p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{reportDetail.conclusion}</p></div>}
                {reportDetail.radiologist_name && <div><span className="text-xs font-medium text-gray-400"><T k="판독의" /></span><p className="text-sm text-gray-900">{reportDetail.radiologist_name}</p></div>}
                {reportDetail.signed_at && <div><span className="text-xs font-medium text-gray-400"><T k="서명일시" /></span><p className="text-sm text-gray-900">{kdate(reportDetail.signed_at, 'datetimeSec')}</p></div>}
                {reportDetail.status !== 'FINAL' && (
                  <div className="flex gap-2 pt-3 border-t border-gray-100">
                    {reportDetail.status === 'DRAFT' && (
                      <button onClick={() => signMutation.mutate({ id: selectedReportId, asPreliminary: true })} disabled={signMutation.isPending}
                        className="px-4 py-2 bg-amber-500 text-white text-xs font-medium rounded-xl hover:bg-amber-600 disabled:opacity-50 transition-colors"><T k="예비판독 서명" /></button>
                    )}
                    <button onClick={() => signMutation.mutate({ id: selectedReportId, asPreliminary: false })} disabled={signMutation.isPending}
                      className="px-4 py-2 bg-emerald-600 text-white text-xs font-medium rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors"><T k="최종판독 서명" /></button>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center"><p className="text-sm text-gray-400"><T k="리포트 정보를 불러올 수 없습니다." /></p></div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
