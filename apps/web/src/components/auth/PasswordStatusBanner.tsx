'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { T, Tf } from '@/components/ui/i18n-text';

/**
 * 비밀번호 변경 필요 배너 — 공통 셸(`(main)/layout`)에서 로그인 후 1회 조회.
 *
 * 🔴 (2026-09-14) 계정 생성·초기화는 일회용 비밀번호를 발급하고 `passwordChangedAt=null` 로 둔다.
 *    서버 정본 `AuthService.isPasswordExpired`(`GET /auth/password-status`)가 "최초 설정 필요 또는 N일 경과"를
 *    판정하는데 **부르는 화면이 0** 이었다 — 일회용 비밀번호를 계속 쓸 수 있었고 아무도 그 사실을 말하지 않았다.
 *
 * 지키는 것:
 *  - 🔴 **강제하지 않는다**(로그인 차단·강제 이동은 정책 — 이 부품의 범위가 아니다). 사실을 말하고 변경 길만 연다.
 *  - 서버가 주는 값만 쓴다: `expired`(참/거짓)·`maxAgeDays`. "최초 설정"과 "기간 경과"를 서버가 가르지 않으므로
 *    화면도 가르지 않는다. "만료 임박" 기준은 서버에 없어 **지어내지 않는다**.
 *  - 조회 실패는 배너를 띄우지 않되 **성공으로 그리지도 않는다** — 콘솔 경고로 남긴다(전역 셸 소음 방지).
 *    EP 는 `JwtAuthGuard` 만 걸려 14역할 전부가 부를 수 있다(가드 테스트가 고정).
 *  - 닫으면 이 브라우저 세션 동안만 숨긴다(다음 로그인 창에서는 다시 말한다).
 */
const DISMISS_KEY = 'his.passwordStatusBanner.dismissed';

type PasswordStatus = { expired: boolean; maxAgeDays?: number | null };

function readDismissed(): boolean {
  try {
    return typeof window !== 'undefined' && window.sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function PasswordStatusBanner() {
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(readDismissed);
  const q = useQuery({
    queryKey: ['auth', 'password-status'],
    queryFn: () => apiClient.get<{ data: PasswordStatus }>('/api/v1/auth/password-status'),
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    if (q.isError) console.warn('[PasswordStatusBanner] password-status lookup failed - banner not shown', q.error);
  }, [q.isError, q.error]);

  const status = q.data?.data;
  if (dismissed || !status?.expired) return null;
  if (pathname?.startsWith('/settings/password')) return null;

  const days = typeof status.maxAgeDays === 'number' ? status.maxAgeDays : null;
  const dismiss = () => {
    setDismissed(true);
    try { window.sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* 저장 불가 — 이 화면에서만 숨김 */ }
  };

  return (
    <div role="status" className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs bg-amber-50 border-b border-amber-200 text-amber-900">
      {days != null
        ? <Tf k="비밀번호 변경이 필요합니다 — 최초 설정 전이거나 변경 후 {일수}일이 지났습니다." params={{ 일수: days }} />
        : <T k="비밀번호 변경이 필요합니다 — 최초 설정 전이거나 변경 기한이 지났습니다." />}
      <Link href="/settings/password" className="font-semibold underline underline-offset-2"><T k="비밀번호 변경" /></Link>
      <button type="button" onClick={dismiss} className="ml-auto text-amber-700 hover:text-amber-900"><T k="닫기" /></button>
    </div>
  );
}
