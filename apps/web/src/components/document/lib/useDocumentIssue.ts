'use client';

import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { extractErrorMessage } from '@/lib/error-utils';
import type { DocumentMeta, DocumentType } from './documentMeta';

/** 문서 발급 훅 — DRAFT 미리보기 → "발급" 시 BE 발급(스냅샷 동결)·issueNo/QR/ORIGINAL 반영. */
export function useDocumentIssue(documentType: DocumentType, sourceId: string, patientId?: string) {
  const [meta, setMeta] = useState<DocumentMeta>({ documentType, sourceId, patientId, status: 'DRAFT' });
  const [issuing, setIssuing] = useState(false);
  /** 서버가 동결한 판 — 의사 발급 문서는 서버가 서명 의사·진단·발급일을 원장에서 고쳐 쓴다(A4). 발급 뒤엔 이 판을 그린다 */
  const [issuedSnapshot, setIssuedSnapshot] = useState<Record<string, unknown> | null>(null);

  const issue = async (snapshot: Record<string, unknown>) => {
    if (meta.issueNo) return;
    setIssuing(true);
    try {
      const r = await apiClient.post<{ data: { issueNo: string; qrUrl: string; qrDataUrl?: string; issuedAt: string; status: string; snapshot?: Record<string, unknown> } }>(
        '/api/v1/documents/issue', { documentType, sourceId, patientId, snapshot },
      );
      const d = r.data;
      setMeta((m) => ({ ...m, issueNo: d.issueNo, qrUrl: d.qrUrl, qrDataUrl: d.qrDataUrl, issuedAt: d.issuedAt, status: 'ORIGINAL' }));
      if (d.snapshot && typeof d.snapshot === 'object') setIssuedSnapshot(d.snapshot);
      toast.success(`발급되었습니다 (${d.issueNo})`);
    } catch (e) {
      // 서버가 거부한 이유(의사만 발급·서명 안 된 진료기록 등)를 그대로 말한다
      toast.error(extractErrorMessage(e) || '발급에 실패했습니다');
    } finally {
      setIssuing(false);
    }
  };

  return { meta, issue, issuing, issued: !!meta.issueNo, issuedSnapshot };
}
