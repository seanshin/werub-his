import { issuedDocumentTypeLabel } from '@hospital-run/shared';

// 문서 발급 메타 (설계 §5)
export type DocumentType =
  | 'LAB_REPORT'
  | 'ENCOUNTER_RECORD'
  | 'PRESCRIPTION'
  | 'CERTIFICATE'
  | 'RECEIPT'
  | 'CONSENT';

export type DocumentStatus = 'ORIGINAL' | 'COPY' | 'REISSUE' | 'VOID' | 'DRAFT';

export interface DocumentMeta {
  documentType: DocumentType;
  sourceId: string;
  patientId?: string;
  issueNo?: string;        // WRB-{TYPE}-{YYYYMMDD}-{seq} (BE 발급 시 부여)
  issuedAt?: string;       // ISO
  issuedBy?: string;
  status?: DocumentStatus; // 기본 DRAFT(미발급 미리보기)
  hash?: string;
  qrUrl?: string;          // /verify/document/{issueNo}
  qrDataUrl?: string;      // BE가 생성한 QR 이미지(data URL) — 없으면 슬롯만
}

/** 종류 라벨 — shared 정본 하나(진위확인 화면과 같은 표 · 2026-10-12 G15) */
export const documentTitle = (t: DocumentType) => issuedDocumentTypeLabel(t) ?? '문서';

/** status → 워터마크 (ORIGINAL/COPY/REISSUE/VOID/DRAFT) */
export const watermarkOf = (s?: DocumentStatus): DocumentStatus | null =>
  !s || s === 'ORIGINAL' ? null : s;
