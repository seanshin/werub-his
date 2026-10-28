'use client';

/**
 * 🔴 (2026-09-14 확인) **이 컴포넌트를 쓰는 화면이 없다**(JSX 소비처 0 — `apps/web/test/architecture/signature-status-consumers.spec.ts` 가 목록으로 동결).
 *    배선하지 않은 이유: 기획서(`blockchain-cert-system-integration.plan.md` §5.3·`blockchain-medical-certificate.plan.md`)는
 *    "문서 목록/상세 페이지"라고만 적었고 **어느 화면·어떤 documentType** 인지 정하지 않았다. 목록 행마다 붙이면 행 수만큼
 *    `GET /api/v1/document-sign/document/:type/:id` 조회가 나간다(여러 문서를 한 번에 묻는 EP 는 아래 확인분 기준 없음) — 자리를 지어내 붙이지 않는다.
 *    지우지도 않는다(기능 삭제 확인 규칙) — 붙일 화면을 정하면 가드 목록에서 빼고 배선한다.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { T } from '@/components/ui/i18n-text';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SignatureBadgeProps {
  documentType: string;
  documentId: string;
  onClick?: () => void;
}

interface SignatureStatus {
  status: 'NONE' | 'PENDING' | 'SIGNED' | 'BLOCKCHAIN_CONFIRMED';
  current?: number;
  required?: number;
}

/**
 * 🔴 **경로만 고치면 안 된다** — 이 EP 는 `{status,current,required}` 가 아니라
 *    `SignedDocument`(status·requiredSigners·completedSigners) 를 준다. 종전 코드는
 *    `data.status` 를 그대로 읽어 **서명된 문서도 늘 '서명 필요'** 로 그렸을 것이다.
 *    (경로 자체가 없어 개통 이래 그 상태였다 — 목이 아니라 **정본의 실제 반환 모양**을 쓴다.)
 *    문서가 없으면(404) 아직 서명 절차가 시작되지 않은 것이라 `NONE` 이 맞다.
 */
interface SignedDocumentResponse {
  status?: string;
  requiredSigners?: number;
  completedSigners?: number;
}

function toSignatureStatus(doc: SignedDocumentResponse | undefined): SignatureStatus {
  if (!doc?.status) return { status: 'NONE' };
  const required = doc.requiredSigners;
  const current = doc.completedSigners;
  const s = doc.status.toUpperCase();
  const status: SignatureStatus['status'] =
    s === 'BLOCKCHAIN_CONFIRMED' || s === 'ANCHORED' ? 'BLOCKCHAIN_CONFIRMED'
    : s === 'COMPLETED' || s === 'SIGNED' ? 'SIGNED'
    : s === 'PENDING' ? 'PENDING'
    : 'NONE';
  return { status, current, required };
}

// ---------------------------------------------------------------------------
// Badge styles
// ---------------------------------------------------------------------------

const BADGE_STYLES: Record<
  SignatureStatus['status'],
  { bg: string; text: string; label: string }
> = {
  NONE: {
    bg: 'bg-red-50 border-red-200',
    text: 'text-red-700',
    label: '서명 필요',
  },
  PENDING: {
    bg: 'bg-amber-50 border-amber-200',
    text: 'text-amber-700',
    label: '서명 대기',
  },
  SIGNED: {
    bg: 'bg-emerald-50 border-emerald-200',
    text: 'text-emerald-700',
    label: '전자서명 됨',
  },
  BLOCKCHAIN_CONFIRMED: {
    bg: 'bg-blue-50 border-blue-200',
    text: 'text-blue-700',
    label: '블록체인 확인',
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SignatureBadge({
  documentType,
  documentId,
  onClick,
}: SignatureBadgeProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['signature-status', documentType, documentId],
    queryFn: () =>
      // 🔴 `/document-sign/status` 는 서버에 없다(운영 404) — 이 배지는 **개통 이래 상태를 못 읽었다**.
      //    정본은 `GET /document-sign/document/:type/:id`.
      apiClient.get<{ data: SignedDocumentResponse }>(`/api/v1/document-sign/document/${documentType}/${documentId}`)
        .then((r) => toSignatureStatus(r.data))
        // 🔴 문서가 없으면 404 다 — "조회 실패"가 아니라 **아직 서명 절차 전**이라는 뜻이다.
        //    (2026-09-14) 단 **404 만** NONE 이다 — 종전엔 403(역할 밖)·500·네트워크 오류도 NONE 이 되어
        //    서명이 끝난 문서를 "서명 필요"로 그렸다. 나머지 실패는 전파해 "상태 확인 불가"로 말한다.
        .catch((e: unknown) => {
          if (/NOT_FOUND/.test(String((e as { code?: string })?.code ?? ''))) return { status: 'NONE' } as SignatureStatus;
          throw e;
        }),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <span className="inline-block px-2.5 py-1 rounded-full border bg-gray-50 border-gray-200 animate-pulse whitespace-nowrap">
        <span className="text-xs text-transparent">loading</span>
      </span>
    );
  }

  // 조회 실패는 "서명 필요"가 아니다 — 모르는 상태를 서명 상태로 단정하지 않는다
  if (isError) {
    return (
      <span className="inline-block px-2.5 py-1 rounded-full border bg-gray-50 border-gray-200 whitespace-nowrap">
        <span className="text-xs font-medium text-gray-500"><T k="상태 확인 불가" /></span>
      </span>
    );
  }

  const status = data?.status ?? 'NONE';
  const style = BADGE_STYLES[status];
  const current = data?.current;
  const required = data?.required;

  let label = style.label;
  if (status === 'PENDING' && current != null && required != null) {
    label = `서명 대기 ${current}/${required}`;
  }

  const Tag = onClick ? 'button' : 'span';

  return (
    <Tag
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-semibold whitespace-nowrap transition-colors ${
        style.bg
      } ${style.text} ${onClick ? 'cursor-pointer hover:opacity-80' : ''}`}
    >
      {status === 'NONE' && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/cert/icons/sign-required.svg" alt="" width={14} height={14} />
        </>
      )}
      {status === 'PENDING' && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/cert/icons/sign-pending.svg" alt="" width={14} height={14} />
        </>
      )}
      {status === 'SIGNED' && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/cert/icons/sign-complete.svg" alt="" width={14} height={14} />
        </>
      )}
      {status === 'BLOCKCHAIN_CONFIRMED' && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/cert/icons/sign-blockchain.svg" alt="" width={14} height={14} />
        </>
      )}
      {label}
    </Tag>
  );
}
