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

interface SignatureStatusIndicatorProps {
  documentType: string;
  documentId: string;
  compact?: boolean;
}

interface SignatureStatus {
  status: 'NONE' | 'PENDING' | 'SIGNED' | 'COMPLETED' | 'BLOCKCHAIN_CONFIRMED';
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
  // 이 컴포넌트는 단계 수를 표시하지 않는다 — 상태만 돌려준다(모양을 지어내지 않는다)
  void current; void required;
  return { status };
}

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  string,
  { color: string; label: string } | null
> = {
  NONE: null,
  PENDING: { color: 'bg-amber-400', label: '대기중' },
  SIGNED: { color: 'bg-emerald-500', label: '서명됨' },
  COMPLETED: { color: 'bg-emerald-500', label: '서명됨' },
  BLOCKCHAIN_CONFIRMED: { color: 'bg-blue-500', label: '블록체인' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SignatureStatusIndicator({
  documentType,
  documentId,
  compact = false,
}: SignatureStatusIndicatorProps) {
  const { data, isError } = useQuery({
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

  // 조회 실패를 "서명 기록 없음"(숨김)과 같은 모양으로 그리지 않는다
  if (isError) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <span className="w-2 h-2 rounded-full bg-gray-300" />
        {!compact && <span className="text-xs text-gray-500"><T k="상태 확인 불가" /></span>}
      </span>
    );
  }

  const status = data?.status ?? 'NONE';
  const config = STATUS_CONFIG[status];

  // No record or NONE: hidden
  if (!config) return null;

  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className={`w-2 h-2 rounded-full ${config.color}`} />
      {!compact && (
        <span className="text-xs text-gray-600">{config.label}</span>
      )}
    </span>
  );
}
