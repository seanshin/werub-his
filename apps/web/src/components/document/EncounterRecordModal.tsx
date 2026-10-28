'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { DocumentFrame } from './DocumentFrame';
import { EncounterRecordDoc, type EncounterRecordData } from './forms/EncounterRecordDoc';
import { useDocumentIssue } from './lib/useDocumentIssue';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

/** 진료기록지 미리보기 모달 — encounter 상세 + 환자기본정보 fetch → 양식 바인딩. */
export function EncounterRecordModal({ patientId, encounterId, onClose }: { patientId: string; encounterId: string; onClose: () => void }) {
  const { data: encRes, isError: encIsError, error: encError, refetch: refetchEnc } = useQuery({
    queryKey: ['encounter-doc', encounterId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>(`/api/v1/encounters/${encounterId}`),
  });
  const { data: sumRes, isError: sumIsError, error: sumError, refetch: refetchSum } = useQuery({
    queryKey: ['patient-summary-doc', patientId],
    queryFn: () => apiClient.get<{ data: { patient?: Record<string, unknown> } }>(`/api/v1/patients/${patientId}/summary`),
    staleTime: 60000,
  });

  const e = (encRes?.data as { data?: Record<string, unknown> })?.data ?? (encRes?.data as Record<string, unknown> | null) ?? {};
  const p = (sumRes?.data as { data?: { patient?: Record<string, unknown> } })?.data?.patient
    ?? (sumRes?.data as { patient?: Record<string, unknown> })?.patient;
  const doctor = e.doctor as { familyName?: string; givenName?: string; licenseNumber?: string } | undefined;
  const diagnoses = (e.diagnoses as Array<{ diagnosisCode?: { code?: string; nameKo?: string }; type?: string; certainty?: string }> | undefined) ?? [];

  const data: EncounterRecordData = {
    patient: {
      name: p ? `${(p.familyName as string) ?? ''}${(p.givenName as string) ?? ''}` : undefined,
      mrn: p?.mrn as string | undefined,
      sex: p?.gender as string | undefined,
      birth: p?.dateOfBirth ? String(p.dateOfBirth).slice(0, 10) : undefined,
    },
    visitType: str(e.visitType),
    date: str(e.createdAt),
    cc: str(e.chiefComplaint),
    hpi: str(e.historyPresentIllness),
    pmh: str(e.pastMedicalHistory),
    familyHistory: str(e.familyHistory),
    soap: { subjective: str(e.subjective), objective: str(e.objective), assessment: str(e.assessment), plan: str(e.plan) },
    diagnoses: diagnoses.map((d) => ({ kcdCode: d.diagnosisCode?.code, name: d.diagnosisCode?.nameKo, type: d.type, certainty: d.certainty })),
    doctor: { name: doctor ? `${doctor.familyName ?? ''}${doctor.givenName ?? ''}` : undefined, license: doctor?.licenseNumber },
    signedAt: str(e.signedAt),
  };

  const { meta, issue, issuing, issued } = useDocumentIssue('ENCOUNTER_RECORD', encounterId, patientId);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-auto py-6" onClick={onClose} data-portal>
      <div className="relative" onClick={(ev) => ev.stopPropagation()}>
        <button onClick={onClose} className="doc-no-print absolute -top-1 right-0 z-10 px-3 py-1 text-white text-sm">✕ 닫기</button>
        {/* 🔴 조회 실패로 빈 진료기록지를 그리지 않는다 — 발급까지 이어지면 백지 법정기록이 된다 */}
        {(encIsError || sumIsError) ? (
          <div className="bg-white rounded-2xl p-6 w-[min(90vw,42rem)]">
            <p className="text-sm font-bold text-gray-900 mb-3">진료기록지</p>
            {encIsError && <QueryErrorFallback error={encError} onRetry={refetchEnc} />}
            {sumIsError && <QueryErrorFallback error={sumError} onRetry={refetchSum} />}
          </div>
        ) : (
        <DocumentFrame title="진료기록지" meta={meta} onIssue={() => issue(data as unknown as Record<string, unknown>)} issued={issued} issuing={issuing}>
          <EncounterRecordDoc data={data} meta={meta} />
        </DocumentFrame>
        )}
      </div>
    </div>
  );
}
