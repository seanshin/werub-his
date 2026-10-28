'use client';

import { useQuery } from '@tanstack/react-query';
import { kdate } from '@/lib/ui-settings';
import { apiClient, ApiError } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SignedDocumentFooterProps {
  documentType: string;
  /** 🔴 서명이 **기록된** 문서 id 와 같아야 한다(처방은 처방 id — 진료 id 로 물으면 늘 미서명, P1) */
  documentId: string;
  /** 한 인쇄물에 서명 문서가 여럿일 때(처방 건별) 어느 문서의 서명인지 */
  caption?: string;
}

/**
 * 서명 문서 조회 — 🔴 (P1) 서버는 서명 문서가 없으면 404(`SIGNED_DOCUMENT_NOT_FOUND`)를 준다.
 *    그것은 "미서명"이라는 사실이다. 다른 실패(네트워크·500·권한)는 "확인 불가"로 남긴다(모르는 것을 미서명이라 하지 않는다).
 */
export async function fetchSignedDocument(documentType: string, documentId: string): Promise<{ data: SignedDocumentResponse | null }> {
  try {
    return await apiClient.get<{ data: SignedDocumentResponse | null }>(`/api/v1/document-sign/document/${documentType}/${documentId}`);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'SIGNED_DOCUMENT_NOT_FOUND') return { data: null };
    throw e;
  }
}

interface SignatureInfo {
  signerName?: string;
  signerLicense?: string;
  certSerialNumber?: string;
  documentHash?: string;
  signatureAlgorithm?: string;
  signedAt?: string;
  blockchainStatus?: string;
  blockchainTxHash?: string;
  status?: string;
  /** 서버가 공개키로 검증했는가 — VERIFIED 외에는 '미검증'으로 말한다 */
  verification?: 'VERIFIED' | 'NOT_VERIFIED';
  /** (A2) 서명한 해시 ↔ 지금 문서 내용 — 없거나 계산 불가면 대조 불가로 말한다 */
  contentState?: 'MATCH' | 'MISMATCH' | 'NOT_COMPUTABLE';
}

/** 서버 응답(`GET /document-sign/document/:type/:id`) 의 실제 모양 */
interface SignedDocumentResponse {
  status?: string;
  documentHash?: string;
  contentState?: 'MATCH' | 'MISMATCH' | 'NOT_COMPUTABLE';
  blockchainTxId?: string | null;
  signatures?: Array<{
    signedAt: string;
    signatureAlgorithm?: string;
    isValid?: boolean;
    verification?: 'VERIFIED' | 'NOT_VERIFIED';
    certificate?: { serialNumber?: string } | null;
    signerUser?: { familyName?: string; givenName?: string } | null;
    signerPatient?: { familyName?: string; givenName?: string } | null;
  }>;
}

/**
 * 🔴 (2026-09-15 N2) 종전 이 부품은 응답에 **없는** 최상위 `signerName`·`certSerialNumber`·`signedAt` 을 읽어
 *    인쇄물에 서명자·일시가 한 번도 찍힌 적이 없었다(P11). 서버 응답의 `signatures[]` 에서 현행 마지막 서명을 뽑는다.
 *    검증 상태는 서버 정본(`verification`)만 쓴다 — 없으면 미검증.
 */
export function toSignatureInfo(doc: SignedDocumentResponse | null | undefined): SignatureInfo | null {
  if (!doc) return null;
  const current = (doc.signatures ?? []).filter((x) => x.isValid !== false);
  const last = current[current.length - 1];
  const who = last?.signerUser ?? last?.signerPatient ?? null;
  return {
    status: doc.status,
    documentHash: doc.documentHash,
    contentState: doc.contentState,
    signerName: who ? `${who.familyName ?? ''}${who.givenName ?? ''}` || undefined : undefined,
    certSerialNumber: last?.certificate?.serialNumber,
    signedAt: last?.signedAt,
    signatureAlgorithm: last?.signatureAlgorithm,
    // 🔴 (M1) `internal-<난수>` 는 내부 원장 기록이다(동의서 앵커 — 외부 체인 트랜잭션 아님). "블록체인 확인됨"으로 그리지 않는다
    blockchainStatus: doc.blockchainTxId ? (doc.blockchainTxId.startsWith('internal-') ? 'INTERNAL' : 'CONFIRMED') : undefined,
    verification: last ? (last.verification === 'VERIFIED' ? 'VERIFIED' : 'NOT_VERIFIED') : undefined,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SignedDocumentFooter({
  documentType,
  documentId,
  caption,
}: SignedDocumentFooterProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['document-sign', documentType, documentId],
    queryFn: () => fetchSignedDocument(documentType, documentId),
    staleTime: 30_000,
  });

  const info = toSignatureInfo(data?.data);

  if (isLoading) {
    return (
      <div className="mt-8 pt-4 border-t-2 border-gray-300 print:border-black">
        <div className="animate-pulse h-16 bg-gray-100 rounded" />
      </div>
    );
  }

  // 🔴 (M1) 조회 실패는 "미서명"이 아니다 — 서명된 문서를 인쇄물에 "(미서명)"으로 찍던 자리
  if (isError) {
    return (
      <div className="mt-8 pt-4 border-t-2 border-gray-300 print:border-black">
        <p className="text-sm text-gray-500 text-center">{caption ? `${caption} · ` : ''}(전자서명 정보 확인 불가 — 조회에 실패했습니다)</p>
      </div>
    );
  }

  // Not signed
  if (!info || !info.status || info.status === 'NONE') {
    return (
      <div className="mt-8 pt-4 border-t-2 border-gray-300 print:border-black">
        <p className="text-sm text-gray-400 text-center">{caption ? `${caption} · ` : ''}(미서명)</p>
      </div>
    );
  }

  return (
    <div className="mt-8 pt-4 border-t-2 border-gray-300 print:border-black">
      <div className="flex items-start justify-between gap-6">
        {/* Signature info */}
        <div className="flex-1 space-y-1.5">
          <h4 className="text-sm font-bold text-gray-900 print:text-black">
            전자서명 정보{caption ? ` · ${caption}` : ''}
          </h4>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {info.signerName && (
              <>
                <span className="text-gray-500 print:text-gray-700">서명자</span>
                <span className="font-medium text-gray-900 print:text-black">
                  {info.signerName}
                </span>
              </>
            )}
            {info.signerLicense && (
              <>
                <span className="text-gray-500 print:text-gray-700">면허번호</span>
                <span className="font-medium text-gray-900 print:text-black">
                  {info.signerLicense}
                </span>
              </>
            )}
            {info.certSerialNumber && (
              <>
                <span className="text-gray-500 print:text-gray-700">인증서</span>
                <span className="font-mono text-gray-900 print:text-black">
                  {info.certSerialNumber.slice(0, 16)}...
                </span>
              </>
            )}
            {info.signedAt && (
              <>
                <span className="text-gray-500 print:text-gray-700">서명일시</span>
                <span className="font-medium text-gray-900 print:text-black">
                  {kdate(info.signedAt, 'datetimeSec')}
                </span>
              </>
            )}
            {info.verification && (
              <>
                <span className="text-gray-500 print:text-gray-700">서명 검증</span>
                <span className="font-medium">
                  {info.verification === 'VERIFIED' ? (
                    <span className="text-emerald-700">공개키 검증됨</span>
                  ) : (
                    <span className="text-amber-700">미검증</span>
                  )}
                </span>
              </>
            )}
            {info.blockchainStatus && (
              <>
                <span className="text-gray-500 print:text-gray-700">블록체인</span>
                <span className="font-medium">
                  {info.blockchainStatus === 'INTERNAL' ? (
                    <span className="text-gray-700">내부 원장 기록(외부 체인 아님)</span>
                  ) : info.blockchainStatus === 'CONFIRMED' ? (
                    <span className="text-blue-700">확인됨</span>
                  ) : (
                    <span className="text-amber-700">{info.blockchainStatus}</span>
                  )}
                </span>
              </>
            )}
          </div>

          {/* Document hash */}
          {info.documentHash && (
            <div className="mt-2 pt-2 border-t border-gray-200 print:border-gray-400">
              {/* 🔴 무엇의 해시인지 적는다 — (M1) 2026-10-13 전 서명은 화면이 만든 식별 해시(유형·번호·제목)였고,
                  (A2) 이후는 서버가 문서 내용으로 계산한 해시다. 지금 내용과 같은지는 서버 대조(contentState)만 말한다. */}
              <p className="text-[10px] text-gray-400 print:text-gray-600" data-sign-content-state={info.contentState ?? 'NOT_COMPUTABLE'}>
                {info.contentState === 'MATCH' ? 'SHA-256 · 문서 내용 해시(지금 내용과 일치)'
                  : info.contentState === 'MISMATCH' ? 'SHA-256 · 서명한 해시 — 지금 문서 내용과 다름(서명 뒤 변경 또는 2026-10-13 전 제목 서명)'
                  : 'SHA-256 · 서명한 해시(지금 내용과 대조할 수 없음)'}
              </p>
              <p className="text-[10px] font-mono text-gray-500 print:text-gray-700 break-all">
                {info.documentHash}
              </p>
            </div>
          )}
        </div>

        {/* 🔴 (M1) 종전 자리: "QR Code" 빈 상자 + `/verify/<유형>/<id>` URL — 그 경로는 **존재하지 않는다**
            (공개 검증은 `/verify/document/<발급번호>` 뿐·전자서명 문서용 공개 검증 페이지 없음). 인쇄물이 열리지 않는 검증
            주소를 안내하던 것을 걷었다. 검증 페이지가 생기면 그때 실재 경로로 넣는다. */}
      </div>

      {/* Print styles */}
      <style jsx>{`
        @media print {
          .mt-8 {
            margin-top: 2rem;
          }
        }
      `}</style>
    </div>
  );
}
