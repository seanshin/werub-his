'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useSearchParams } from 'next/navigation';
import { LabReportDoc } from '@/components/document/forms/LabReportDoc';
import { EncounterRecordDoc } from '@/components/document/forms/EncounterRecordDoc';
import { PrescriptionDoc } from '@/components/document/forms/PrescriptionDoc';
import { CertificateDoc } from '@/components/document/forms/CertificateDoc';
import { DeathCertificateDoc } from '@/components/document/forms/DeathCertificateDoc';
import { BirthCertificateDoc } from '@/components/document/forms/BirthCertificateDoc';
import { MedicalRecordCopyDoc } from '@/components/document/forms/MedicalRecordCopyDoc';
import { ErpContractDoc } from '@/components/document/forms/ErpContractDoc';
import { DetailedBillDoc } from '@/components/document/forms/DetailedBillDoc';
import { AttendanceCertDoc } from '@/components/document/forms/AttendanceCertDoc';
import { ReceiptSummaryDoc } from '@/components/document/forms/ReceiptSummaryDoc';
import type { DocumentMeta } from '@/components/document/lib/documentMeta';
import { HospitalProfileProvider, profileFromConfig } from '@/components/document/lib/hospitalProfile';

/**
 * 헤드리스 PDF 렌더 전용 인쇄 페이지 (browserless가 print 미디어로 로드 → page.pdf).
 * DocumentFrame과 동일하게 .doc-print-root를 body 직하 Portal로 마운트 → @media print 규칙 적용.
 */
export default function PrintDocumentPage() {
  const params = useParams();
  const sp = useSearchParams();
  const issueNo = String(params?.issueNo ?? '');
  const rt = sp.get('rt') ?? '';
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<{ documentType?: string; snapshot?: Record<string, unknown>; meta?: DocumentMeta; hospital?: Record<string, unknown> | null; error?: string }>({});

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!issueNo || !rt) return;
    fetch(`/api/v1/documents/render/${encodeURIComponent(issueNo)}?rt=${encodeURIComponent(rt)}`)
      .then((r) => r.json())
      .then((j) => setState(j.data ? { documentType: j.data.documentType, snapshot: j.data.snapshot, meta: j.data.meta, hospital: j.data.hospital ?? null } : { error: 'no-data' }))
      .catch(() => setState({ error: 'fetch-failed' }));
  }, [issueNo, rt]);

  const meta = state.meta;
  const snap = state.snapshot;
  let body: React.ReactNode = null;
  if (state.documentType === 'LAB_REPORT') body = <LabReportDoc data={snap as never} meta={meta} />;
  else if (state.documentType === 'ENCOUNTER_RECORD') body = <EncounterRecordDoc data={snap as never} meta={meta} />;
  else if (state.documentType === 'PRESCRIPTION') body = <PrescriptionDoc data={snap as never} meta={meta} />;
  else if (state.documentType === 'CERTIFICATE') body = <CertificateDoc data={snap as never} meta={meta} />;
  else if (state.documentType === 'OPINION') body = <CertificateDoc data={snap as never} meta={meta} title="소견서" kind="OPINION" />;
  else if (state.documentType === 'ADMISSION_CERT') body = <CertificateDoc data={snap as never} meta={meta} title="입퇴원확인서" kind="ADMISSION_CERT" />;
  // N-W1 — 사망진단서(certKind 로 검안서 전환)·출생증명서
  else if (state.documentType === 'DEATH_CERT') body = <DeathCertificateDoc data={snap as never} meta={meta} />;
  else if (state.documentType === 'BIRTH_CERT') body = <BirthCertificateDoc data={snap as never} meta={meta} />;
  else if (state.documentType === 'MEDICAL_RECORD_COPY') body = <MedicalRecordCopyDoc data={snap as never} meta={meta} />;
  else if (state.documentType === 'ERP_MEDICAL_CONTRACT') body = <ErpContractDoc data={snap as never} meta={meta} title="의료계약서" />;
  else if (state.documentType === 'ERP_OUTSOURCING_CONTRACT') body = <ErpContractDoc data={snap as never} meta={meta} title="외주용역계약서" />;
  // F-4 실손보험 서류 세트 — 자동발급 2종 + 번들 동봉 영수증
  else if (state.documentType === 'DETAILED_BILL') body = <DetailedBillDoc data={snap as never} meta={meta} />;
  else if (state.documentType === 'ATTENDANCE_CERT') body = <AttendanceCertDoc data={snap as never} meta={meta} />;
  else if (state.documentType === 'RECEIPT') body = <ReceiptSummaryDoc data={snap as never} meta={meta} />;

  const ready = !!body;
  /**
   * 🔴 (2026-10-12) 양식이 없는 종류도 "로딩 중…"으로 남아 서버 PDF 가 그 글자로 만들어졌다(전자서명 해시 대상이 됐다).
   *    받은 종류에 양식이 없으면 그렇다고 말하고 오류 상태로 끝낸다 — 서버도 그런 종류는 PDF 를 만들지 않는다(409).
   */
  const noForm = !state.error && !!state.documentType && !ready;

  return (
    <div data-print-ready={state.error || noForm ? 'error' : ready ? 'ok' : 'loading'} style={{ padding: 16, color: '#888' }}>
      {state.error ? '문서를 불러올 수 없습니다.' : noForm ? `이 문서 종류(${state.documentType})는 서버 인쇄 양식이 없습니다.` : ready ? '' : '로딩 중…'}
      {mounted && ready && createPortal(<HospitalProfileProvider value={profileFromConfig(state.hospital)}><div className="doc-print-root">{body}</div></HospitalProfileProvider>, document.body)}
    </div>
  );
}
