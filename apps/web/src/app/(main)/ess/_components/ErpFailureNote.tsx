'use client';

import type { ReactNode } from 'react';
import { isErpFailureRetryable, isErpReadFailure, type ErpReadFailure } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * ERP 조회 실패 안내 — **서버가 가른 사유를 화면이 읽는 자리**.
 *
 * 🔴 서버(`ess.service.ts` `erpGetDetailed`)는 2026-09-22 부터 실패를 4종으로 갈라 `failure` 로 실어보냈는데
 *    web 어디에서도 그 필드를 읽지 않았다(grep 0) — 화면은 여전히 "연결하지 못해" 한 문장이었다.
 *    "ERP 를 아직 안 붙였다"(설정 작업)와 "키가 거부됐다"(장애 신고)는 사람이 할 일이 정반대다.
 *
 * 어휘는 shared `ERP_READ_FAILURES` 하나 — 여기 표의 키는 그 어휘 **전부**를 덮어야 한다(하나 빠지면 그 상태에서 사유 없이 뜬다).
 * 사유 문장은 이 표에서만 나온다(호출 화면마다 문장을 다시 쓰면 갈라진다). 호출 화면은 **무엇을** 못 봤는지(children)만 말한다.
 * `failure` 가 없거나 모르는 값이면 "사유 미상"으로 말한다 — 지어내지 않는다.
 */
export const ERP_FAILURE_TEXT: Record<ErpReadFailure, string> = {
  NOT_CONFIGURED: '급여시스템(ERP) 연동이 설정되어 있지 않습니다(관리자 설정 필요)',
  UNAUTHORIZED: '급여시스템(ERP)이 연동 키를 거부했습니다 — 다시 시도해도 풀리지 않습니다(인사·전산팀 확인 필요)',
  UPSTREAM_ERROR: '급여시스템(ERP)이 오류로 응답했습니다',
  UNREACHABLE: '급여시스템(ERP)에 연결하지 못했습니다',
  BAD_RESPONSE: '급여시스템(ERP) 응답을 해석하지 못했습니다',
};
const UNKNOWN_FAILURE_KEY = '급여시스템(ERP)에서 자료를 받지 못했습니다(사유 미상)';

export const erpFailureKey = (failure: unknown): string => (isErpReadFailure(failure) ? ERP_FAILURE_TEXT[failure] : UNKNOWN_FAILURE_KEY);

/** 속성·짧은 자리용(대시보드 위젯 등) — 같은 표를 번역해 문자열로 준다 */
export function useErpFailureText(): (failure: unknown) => string {
  const tAttr = useTAttr();
  return (failure) => tAttr(erpFailureKey(failure));
}

export function ErpFailureNote({
  failure,
  upstreamStatus,
  onRetry,
  children,
  className,
}: {
  failure: unknown;
  upstreamStatus?: number | null;
  onRetry?: () => void;
  /** 무엇을 확인할 수 없는지 — 이미 번역된 노드(`<Tf k="{기간} 급여명세를 확인할 수 없습니다" …/>`) */
  children?: ReactNode;
  className?: string;
}) {
  const known = isErpReadFailure(failure) ? failure : null;
  // 🔴 설정·키 문제에 '다시 시도' 버튼을 두면 거짓 희망이다 — 눌러도 풀리지 않는다. 사유 미상은 눌러볼 수 있게 둔다.
  const retryable = known ? isErpFailureRetryable(known) : true;
  return (
    <div className={className ?? 'rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-700'}>
      {children ? <>{children} — </> : null}
      <T k={erpFailureKey(failure)} />
      <span className="text-amber-500"> ({known ?? 'UNKNOWN'}{upstreamStatus ? ` ${upstreamStatus}` : ''})</span>
      {onRetry && retryable && (
        <button type="button" onClick={onRetry} className="ml-1.5 underline"><T k="다시 시도" /></button>
      )}
    </div>
  );
}
