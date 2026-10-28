'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { DocumentFrame } from './DocumentFrame';
import { CertificateDoc, type CertificateData } from './forms/CertificateDoc';
import { useDocumentIssue } from './lib/useDocumentIssue';
import { useAuthStore } from '@/stores/auth-store';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

/** 진단서 발급 모달 — encounter 진단/의사 + 입력(용도·향후소견·발병일) → 미리보기 → 발급. */
export function CertificateModal({ patientId, encounterId, onClose }: { patientId: string; encounterId: string; onClose: () => void }) {
  const [purpose, setPurpose] = useState('');
  const [opinion, setOpinion] = useState('');
  const [onsetDate, setOnsetDate] = useState('');

  const { data: encRes, isError: encIsError, error: encError, refetch: refetchEnc } = useQuery({
    queryKey: ['encounter-doc', encounterId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>(`/api/v1/encounters/${encounterId}`),
  });
  const { data: ptRes, isError: ptIsError, error: ptError, refetch: refetchPt } = useQuery({
    queryKey: ['patient-detail-doc', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>(`/api/v1/patients/${patientId}`),
    staleTime: 60000,
  });

  const e = (encRes?.data as { data?: Record<string, unknown> })?.data ?? (encRes?.data as Record<string, unknown> | null) ?? {};
  const p = (ptRes?.data as { data?: Record<string, unknown> })?.data ?? (ptRes?.data as Record<string, unknown> | null) ?? {};
  const doctor = e.doctor as { familyName?: string; givenName?: string; licenseNumber?: string } | undefined;
  const diagnoses = (e.diagnoses as Array<{ diagnosisCode?: { code?: string; nameKo?: string } }> | undefined) ?? [];

  const data: CertificateData = {
    patient: {
      name: p ? `${(p.familyName as string) ?? ''}${(p.givenName as string) ?? ''}` : undefined,
      rrn: str(p.nationalId), mrn: str(p.mrn), sex: str(p.gender),
      birth: p.dateOfBirth ? String(p.dateOfBirth).slice(0, 10) : undefined,
      address: str(p.address),
    },
    diagnoses: diagnoses.map((d) => ({ kcdCode: d.diagnosisCode?.code, name: d.diagnosisCode?.nameKo })),
    // 🔴 (A4) 발병일을 진료일로 채우지 않는다 — 입력하지 않으면 비어 있다(모르는 날짜를 증명서에 박지 않는다)
    onsetDate: onsetDate || undefined,
    diagnosedDate: str(e.createdAt),
    treatmentOpinion: opinion,
    purpose,
    // 미리보기 — 발급하면 서버가 **발급한 의사 본인**·면허·오늘 날짜로 고쳐 쓴 판을 그린다
    doctor: { name: doctor ? `${doctor.familyName ?? ''}${doctor.givenName ?? ''}` : undefined, license: doctor?.licenseNumber },
    issuedAt: undefined,
  };

  const { meta, issue, issuing, issued, issuedSnapshot } = useDocumentIssue('CERTIFICATE', encounterId, patientId);
  const shown: CertificateData = issuedSnapshot ? ({ ...data, ...(issuedSnapshot as unknown as CertificateData) }) : data;
  // 🔴 (A4) 진단서는 의사만 발급한다(의료법 §17 · 서버도 거부) — 다른 역할에는 발급 버튼을 그리지 않고 이유를 말한다
  const isDoctor = useAuthStore((s) => s.user?.role) === 'DOCTOR';
  const encounterSigned = e.status === 'SIGNED';

  // 🔴 조회 실패에 빈 진단서를 그리지 않는다 — 환자·진단명·의사 면허가 빠진 채로 발급될 수 있다
  if (encIsError || ptIsError) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-auto py-6" onClick={onClose} data-portal>
        <div className="relative bg-white rounded-2xl p-6 w-[420px] max-w-[90vw]" onClick={(ev) => ev.stopPropagation()}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-gray-900">진단서</h3>
            <button onClick={onClose} className="text-gray-400 text-sm">✕ 닫기</button>
          </div>
          <QueryErrorFallback
            error={encIsError ? encError : ptError}
            onRetry={() => { if (encIsError) refetchEnc(); if (ptIsError) refetchPt(); }}
          />
          <p className="text-xs text-gray-500 text-center">진단 내용을 불러오지 못해 진단서를 표시할 수 없습니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-auto py-6" onClick={onClose} data-portal>
      <div className="relative" onClick={(ev) => ev.stopPropagation()}>
        <button onClick={onClose} className="doc-no-print absolute -top-1 right-0 z-10 px-3 py-1 text-white text-sm">✕ 닫기</button>
        {/* 발급 입력(미발급 시) */}
        {!issued && (
          <div className="doc-no-print bg-white rounded-xl p-3 mb-2 grid grid-cols-3 gap-2" style={{ maxWidth: '210mm', margin: '0 auto 8px' }}>
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="용도(제출처)" className="px-2 py-1.5 border rounded text-sm" />
            <input type="date" value={onsetDate} onChange={(e) => setOnsetDate(e.target.value)} className="px-2 py-1.5 border rounded text-sm" title="발병연월일" />
            <input value={opinion} onChange={(e) => setOpinion(e.target.value)} placeholder="향후 치료 소견" className="px-2 py-1.5 border rounded text-sm" />
          </div>
        )}
        {!issued && (!isDoctor || !encounterSigned) && (
          <p className="doc-no-print bg-amber-50 text-amber-800 rounded-xl p-2 mb-2 text-xs" style={{ maxWidth: '210mm', margin: '0 auto 8px' }} data-certificate-issue-blocked={!isDoctor ? 'ROLE' : 'UNSIGNED'}>
            {!isDoctor ? '진단서는 의사만 발급할 수 있습니다 — 미리보기만 표시합니다.' : '서명된 진료기록만 진단서로 발급할 수 있습니다 — 진료기록을 서명한 뒤 발급하세요.'}
          </p>
        )}
        <DocumentFrame title="진단서" meta={meta} onIssue={isDoctor && encounterSigned ? () => issue(data as unknown as Record<string, unknown>) : undefined} issued={issued} issuing={issuing}>
          <CertificateDoc data={shown} meta={meta} />
        </DocumentFrame>
      </div>
    </div>
  );
}
