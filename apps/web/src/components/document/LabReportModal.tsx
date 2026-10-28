'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { DocumentFrame } from './DocumentFrame';
import { LabReportDoc, type LabReportData } from './forms/LabReportDoc';
import { useDocumentIssue } from './lib/useDocumentIssue';

interface ResultLike {
  id: string;
  collectedAt?: string;
  completedAt?: string;
  items?: Array<{ testName: string; value?: string; unit?: string; normalMin?: number | null; normalMax?: number | null; flag?: string }>;
}

/** 검사 성적서 미리보기 모달 — 이미 로드된 result + 환자기본정보 조합(추가 fetch 최소). */
export function LabReportModal({ patientId, result, onClose }: { patientId: string; result: ResultLike; onClose: () => void }) {
  const { data: summary, isError, error, refetch } = useQuery({
    queryKey: ['patient-summary-doc', patientId],
    queryFn: () => apiClient.get<{ data: { patient?: { familyName?: string; givenName?: string; mrn?: string; gender?: string; dateOfBirth?: string } } }>(`/api/v1/patients/${patientId}/summary`),
    staleTime: 60000,
  });
  const p = (summary?.data as { data?: { patient?: Record<string, unknown> } })?.data?.patient
    ?? (summary?.data as { patient?: Record<string, unknown> })?.patient;

  const data: LabReportData = {
    patient: {
      name: p ? `${(p.familyName as string) ?? ''}${(p.givenName as string) ?? ''}` : undefined,
      mrn: p?.mrn as string | undefined,
      sex: p?.gender as string | undefined,
      birth: p?.dateOfBirth ? String(p.dateOfBirth).slice(0, 10) : undefined,
    },
    specimen: { collectedAt: result.collectedAt, completedAt: result.completedAt },
    items: result.items ?? [],
  };

  const { meta, issue, issuing, issued } = useDocumentIssue('LAB_REPORT', result.id, patientId);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-auto py-6" onClick={onClose} data-portal>
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="doc-no-print absolute -top-1 right-0 z-10 px-3 py-1 text-white text-sm">✕ 닫기</button>
        {/* 🔴 환자 기본정보를 못 읽은 채 성적서를 그리면 이름·MRN 이 빈 문서가 발급된다 */}
        {isError ? (
          <div className="bg-white rounded-2xl p-6 w-[min(90vw,42rem)]">
            <p className="text-sm font-bold text-gray-900 mb-3">검사 성적서</p>
            <QueryErrorFallback error={error} onRetry={refetch} />
          </div>
        ) : (
        <DocumentFrame title="검사 성적서" meta={meta} onIssue={() => issue(data as unknown as Record<string, unknown>)} issued={issued} issuing={issuing}>
          <LabReportDoc data={data} meta={meta} />
        </DocumentFrame>
        )}
      </div>
    </div>
  );
}
