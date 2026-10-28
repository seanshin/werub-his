'use client';

import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { RadsAssistPanel } from '@/components/clinical-charts/RadsAssistPanel';
import { kdate } from '@/lib/ui-settings';
import { DiagnosticDosePanel } from './DiagnosticDosePanel';
import { T } from '@/components/ui/i18n-text';

interface PacsStudy {
  orthanc_id?: string;
  study_instance_uid: string;
  study_description?: string;
  study_date?: string;
  modalities?: string;
  series_count?: number;
}

interface PacsReport {
  id?: string;
  study_uid?: string;
  study_description?: string;
  status: string;
  findings?: string;
  conclusion?: string;
  radiologist_name?: string;
  created_at?: string;
}

interface PacsStudiesResponse {
  results?: PacsStudy[];
}

interface PacsReportsResponse {
  results?: PacsReport[];
}

const REPORT_STATUS_MAP: Record<string, { label: string; bg: string; text: string }> = {
  DRAFT: { label: '초안', bg: 'bg-gray-100', text: 'text-gray-600' },
  PRELIMINARY: { label: '예비판독', bg: 'bg-amber-50', text: 'text-amber-700' },
  FINAL: { label: '최종판독', bg: 'bg-emerald-50', text: 'text-emerald-700' },
};

export function ImagingTab({ patientMrn, patientId }: { patientMrn: string; patientId?: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['patient-pacs-studies', patientMrn],
    queryFn: () => apiClient.get<{ data: PacsStudiesResponse }>('/api/v1/pacs/studies', { patientId: patientMrn }),
    enabled: !!patientMrn,
  });

  const { data: reportsData, isLoading: reportsLoading } = useQuery({
    queryKey: ['patient-pacs-reports', patientMrn],
    queryFn: () => apiClient.get<{ data: PacsReportsResponse }>(`/api/v1/pacs/patients/${encodeURIComponent(patientMrn)}/reports`),
    enabled: !!patientMrn,
  });

  const studies = data?.data?.results ?? [];
  const reportsRaw = reportsData?.data?.results ?? reportsData?.data;
  const reports: PacsReport[] = Array.isArray(reportsRaw) ? reportsRaw : [];

  const openOhif = async (studyUid: string) => {
    try {
      const res = await apiClient.get<{ data: { url: string } }>(`/api/v1/pacs/viewer/${encodeURIComponent(studyUid)}`);
      window.open(res.data.url, '_blank');
    } catch {
      const token = sessionStorage.getItem('accessToken');
      const params = new URLSearchParams({ PatientID: patientMrn });
      if (token) params.set('token', token);
      // Orthanc(/pacs/)는 자체 Basic 인증이라 브라우저 로그인 창이 뜬다 → OHIF(/viewer/)로
      window.open(`/viewer/?${params.toString()}`, '_blank', 'noopener');
    }
  };

  // Map reports by study_uid for quick lookup
  const reportsByStudy: Record<string, PacsReport> = {};
  reports.forEach((r: PacsReport) => {
    if (r.study_uid) reportsByStudy[r.study_uid] = r;
  });

  return (
    <div className="space-y-6">
      {/*
        🔴 누적 진단 피폭선량(mSv) — `GET /imaging/patients/:id/radiation-exposure` 의 **첫 소비처**다.
           EP 는 있었으나 부르는 화면이 없어(2026-08-27 실측 0곳) 아무도 볼 수 없었다.
           "EP 를 만들면 부르는 화면까지가 한 벌"의 자리. 방사선치료(Gy)는 방사선종양 탭이 갖는다.
      */}
      {patientId && <DiagnosticDosePanel patientId={patientId} />}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900"><T k="영상 검사 (PACS)" /></h3>
          <a
            /* Orthanc(/pacs/)는 Basic 인증 → OHIF(/viewer/) */
            href={`/viewer/?PatientID=${encodeURIComponent(patientMrn)}`}
            target="_blank"
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            <T k="PACS 뷰어에서 보기" />
          </a>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : isError ? (
          /* 🔴 조회 실패를 "없습니다"로 그리지 않는다 — import 만 있고 렌더가 없던 자리(2026-09-02) */
          <QueryErrorFallback error={error} onRetry={() => refetch()} />
        ) : studies.length === 0 ? (
          <div className="text-center py-12">
            <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169" />
            </svg>
            <p className="text-sm text-gray-400"><T k="영상 검사 기록이 없습니다." /></p>
          </div>
        ) : (
          <div className="space-y-3">
            {studies.map((study: PacsStudy) => {
              const report = reportsByStudy[study.study_instance_uid];
              const st = report ? (REPORT_STATUS_MAP[report.status] ?? REPORT_STATUS_MAP.DRAFT) : null;
              return (
                <div
                  key={study.orthanc_id || study.study_instance_uid}
                  className="border border-gray-100 rounded-xl p-4 hover:border-blue-200 hover:bg-blue-50/30 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center">
                        <span className="text-xs font-bold text-violet-600">
                          {(study.modalities ?? 'IM').toString().slice(0, 2)}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {study.study_description || 'No Description'}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {study.study_date}
                          <span className="mx-1.5 text-gray-300">|</span>
                          {study.modalities ?? '-'}
                          <span className="mx-1.5 text-gray-300">|</span>
                          {study.series_count ?? 0} series
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {st && (
                        <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${st.bg} ${st.text}`}>
                          {st.label}
                        </span>
                      )}
                      {!st && (
                        <span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-gray-50 text-gray-400">
                          <T k="미판독" />
                        </span>
                      )}
                      <button
                        onClick={() => openOhif(study.study_instance_uid)}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-medium hover:bg-blue-700 transition-colors"
                      >
                        <T k="OHIF 뷰어" />
                      </button>
                    </div>
                  </div>
                  {report && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      {report.findings && (
                        <p className="text-sm text-gray-600 line-clamp-2">
                          <span className="font-medium text-gray-400"><T k="소견:" /></span> {report.findings}
                        </p>
                      )}
                      {report.conclusion && (
                        <p className="text-sm text-gray-600 mt-1 line-clamp-1">
                          <span className="font-medium text-gray-400"><T k="결론:" /></span> {report.conclusion}
                        </p>
                      )}
                      {report.radiologist_name && (
                        <p className="text-xs text-gray-400 mt-1">판독의: {report.radiologist_name}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 판독 보조 (RADS·영상 분류) — 등급 입력→권고→환자 차트 영속 */}
      <RadsAssistPanel
        patientId={patientId}
        studies={studies.map((s: PacsStudy) => ({
          uid: s.study_instance_uid,
          label: `${s.study_description || 'No Description'} (${s.study_date ?? '-'}${s.modalities ? ` · ${s.modalities}` : ''})`,
        }))}
      />

      {/* Standalone Reports (not matched to a study) */}
      {!reportsLoading && reports.filter((r: PacsReport) => !studies.some((s: PacsStudy) => s.study_instance_uid === r.study_uid)).length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-bold text-gray-700 mb-4"><T k="추가 판독 리포트" /></h3>
          <div className="space-y-3">
            {reports
              .filter((r: PacsReport) => !studies.some((s: PacsStudy) => s.study_instance_uid === r.study_uid))
              .map((report: PacsReport, idx: number) => {
                const st = REPORT_STATUS_MAP[report.status] ?? REPORT_STATUS_MAP.DRAFT;
                return (
                  <div key={report.id ?? idx} className="border border-gray-100 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${st.bg} ${st.text}`}>
                          {st.label}
                        </span>
                        <span className="text-sm font-medium text-gray-900">
                          {report.study_description || report.study_uid?.slice(-12) || '-'}
                        </span>
                      </div>
                      <span className="text-xs text-gray-400">
                        {kdate(report.created_at && new Date(report.created_at))}
                      </span>
                    </div>
                    {report.findings && (
                      <p className="text-sm text-gray-600 line-clamp-2">
                        <span className="font-medium text-gray-400"><T k="소견:" /></span> {report.findings}
                      </p>
                    )}
                    {report.conclusion && (
                      <p className="text-sm text-gray-600 mt-1 line-clamp-1">
                        <span className="font-medium text-gray-400"><T k="결론:" /></span> {report.conclusion}
                      </p>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
