'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { DocumentFrame } from './DocumentFrame';
import { PrescriptionDoc, type PrescriptionData } from './forms/PrescriptionDoc';
import { useDocumentIssue } from './lib/useDocumentIssue';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

/** 처방전 미리보기 모달 — encounter 단위 처방을 별지9호 양식으로. */
export function PrescriptionModal({ patientId, encounterId, onClose }: { patientId: string; encounterId: string; onClose: () => void }) {
  const { data: encRes, isError: encIsError, error: encError, refetch: refetchEnc } = useQuery({
    queryKey: ['encounter-doc', encounterId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>(`/api/v1/encounters/${encounterId}`),
  });
  const { data: sumRes, isError: sumIsError, error: sumError, refetch: refetchSum } = useQuery({
    queryKey: ['patient-summary-doc', patientId],
    queryFn: () => apiClient.get<{ data: { patient?: Record<string, unknown> } }>(`/api/v1/patients/${patientId}/summary`),
    staleTime: 60000,
  });
  // 주민번호(마스킹) — patient.service가 복호 후 maskNationalId로 반환(W-3, 신규 복호 표면 없음)
  const { data: ptRes, isError: ptIsError, error: ptError, refetch: refetchPt } = useQuery({
    queryKey: ['patient-detail-doc', patientId],
    queryFn: () => apiClient.get<{ data: { nationalId?: string } }>(`/api/v1/patients/${patientId}`),
    staleTime: 60000,
  });
  const maskedRrn = (ptRes?.data as { nationalId?: string } | null)?.nationalId;

  const e = (encRes?.data as { data?: Record<string, unknown> })?.data ?? (encRes?.data as Record<string, unknown> | null) ?? {};
  const p = (sumRes?.data as { data?: { patient?: Record<string, unknown> } })?.data?.patient
    ?? (sumRes?.data as { patient?: Record<string, unknown> })?.patient;
  const doctor = e.doctor as { familyName?: string; givenName?: string; licenseNumber?: string } | undefined;
  const diagnoses = (e.diagnoses as Array<{ diagnosisCode?: { code?: string; nameKo?: string } }> | undefined) ?? [];
  const rxList = (e.prescriptions as Array<Record<string, unknown>> | undefined) ?? [];
  const drugs = rxList
    .filter((rx) => rx.medicationCode || rx.medicationCodeId) // 의약품만(검사/처치 오더 제외)
    .map((rx) => ({
      name: (rx.medicationCode as { nameKo?: string } | undefined)?.nameKo ?? str(rx.medicationCodeId) ?? '의약품',
      doseOnce: str(rx.dosage),
      freqPerDay: str(rx.frequency),
      days: (rx.duration as number | undefined) ?? undefined,
      route: str(rx.route),
      instructions: str(rx.instructions),
    }));

  // 대표 처방구분/유효기간(첫 의약품 기준)
  const first = rxList.find((rx) => rx.medicationCode || rx.medicationCodeId);
  const data: PrescriptionData = {
    patient: { name: p ? `${(p.familyName as string) ?? ''}${(p.givenName as string) ?? ''}` : undefined, mrn: p?.mrn as string | undefined, rrn: maskedRrn },
    diagnoses: diagnoses.map((d) => ({ kcdCode: d.diagnosisCode?.code, name: d.diagnosisCode?.nameKo })),
    prescriber: { name: doctor ? `${doctor.familyName ?? ''}${doctor.givenName ?? ''}` : undefined, license: doctor?.licenseNumber },
    dispensingType: (first?.dispensingType as 'INTERNAL' | 'EXTERNAL' | undefined) ?? 'EXTERNAL',
    rxValidUntil: str(first?.rxValidUntil),
    issuedAt: str(e.signedAt) ?? str(e.createdAt),
    drugs,
  };

  const { meta, issue, issuing, issued } = useDocumentIssue('PRESCRIPTION', encounterId, patientId);

  // 🔴 조회 실패에 빈 처방전을 그리지 않는다 — 환자명·의약품·의사 면허가 빠진 채로 발급될 수 있다
  const docIsError = encIsError || sumIsError || ptIsError;
  if (docIsError) {
    const failed = encIsError ? encError : sumIsError ? sumError : ptError;
    const retry = () => { if (encIsError) refetchEnc(); if (sumIsError) refetchSum(); if (ptIsError) refetchPt(); };
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-auto py-6" onClick={onClose} data-portal>
        <div className="relative bg-white rounded-2xl p-6 w-[420px] max-w-[90vw]" onClick={(ev) => ev.stopPropagation()}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-gray-900">처방전</h3>
            <button onClick={onClose} className="text-gray-400 text-sm">✕ 닫기</button>
          </div>
          <QueryErrorFallback error={failed} onRetry={retry} />
          <p className="text-xs text-gray-500 text-center">처방 내용을 불러오지 못해 처방전을 표시할 수 없습니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-auto py-6" onClick={onClose} data-portal>
      <div className="relative" onClick={(ev) => ev.stopPropagation()}>
        <button onClick={onClose} className="doc-no-print absolute -top-1 right-0 z-10 px-3 py-1 text-white text-sm">✕ 닫기</button>
        <DocumentFrame title="처방전" meta={meta} onIssue={() => issue(data as unknown as Record<string, unknown>)} issued={issued} issuing={issuing}>
          <PrescriptionDoc data={data} meta={meta} />
        </DocumentFrame>
      </div>
    </div>
  );
}
