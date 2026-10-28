'use client';

import { extractErrorMessage, isForbidden, isSessionExpired } from '@/lib/error-utils';
import { T } from '@/components/ui/i18n-text';

/**
 * 서버 유래 메시지 렌더 — 카탈로그에 있으면 번역, 없으면 원문+미등록 티(<T> 3상태).
 * 🔴 `@` 를 품은 문자열(이메일 등)은 <T> 의 `원문@문맥` 키 규약이 `@` 뒤를 잘라내므로
 *    감싸지 않고 원문 그대로 그린다 — ko 렌더 불변이 우선이다.
 */
const msgNode = (message: string) => (message.includes('@') ? <>{message}</> : <T k={message} />);

interface QueryErrorFallbackProps {
  error: unknown;
  onRetry?: () => void;
  /** compact: 인라인/테이블 내부, full: 페이지 전체 */
  size?: 'compact' | 'full';
  className?: string;
}

export function QueryErrorFallback({ error, onRetry, size = 'full', className = '' }: QueryErrorFallbackProps) {
  const message = extractErrorMessage(error);
  /**
   * 🔴 세션이 끝났으면 **재시도를 권하지 않는다.**
   *    2026-08-28 사람 신고 — "시간이 한참 지나면 재시도는 의미가 없으니, 로그아웃이 맞거나
   *    다른 화면으로 전환되어야 함". 눌러도 같은 401 로 돌아오는 버튼은
   *    할 수 있는 일처럼 보이지만 아무것도 하지 못한다.
   */
  const expired = isSessionExpired(error);
  /** 🔴 권한 부족은 기다린다고 풀리지 않는다 — 재시도를 권하지 않는다(2026-09-02) */
  const forbidden = !expired && isForbidden(error);

  if (size === 'compact') {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 text-xs text-red-600 bg-red-50 rounded-lg ${className}`}>
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <span>{msgNode(message)}</span>
        {expired ? (
          <a href="/login" className="ml-auto text-red-700 hover:underline font-medium whitespace-nowrap">
            <T k="다시 로그인" />
          </a>
        ) : forbidden ? (
          <span className="ml-auto text-red-700 whitespace-nowrap"><T k="권한 필요" /></span>
        ) : onRetry ? (
          <button onClick={onRetry} className="ml-auto text-red-700 hover:underline font-medium">
            <T k="재시도" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center justify-center py-16 text-center ${className}`}>
      <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mb-4">
        <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
      </div>
      <p className="text-sm text-gray-600 mb-1">{msgNode(message)}</p>
      {/* 🔴 세션 만료에 "잠시 후 다시 시도"는 거짓말이다 — 기다려도 돌아오지 않는다 */}
      <p className="text-xs text-gray-400 mb-5">
        {expired
          ? <T k="로그인 화면으로 이동합니다." />
          : forbidden
            ? <T k="이 화면의 자료를 볼 권한이 없습니다. 필요하면 관리자에게 권한을 요청하세요." />
            : <T k="잠시 후 다시 시도해주세요" />}
      </p>
      {forbidden ? null : expired ? (
        <a
          href="/login"
          className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
        >
          <T k="다시 로그인" />
        </a>
      ) : onRetry ? (
        <button
          onClick={onRetry}
          className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
        >
          <T k="다시 시도" />
        </button>
      ) : null}
    </div>
  );
}
