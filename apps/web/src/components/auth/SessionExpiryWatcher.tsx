'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SESSION_EXPIRED_EVENT } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

/**
 * 세션 만료 감시 — 만료되면 정리하고 **돌아올 곳을 들고** 로그인 화면으로 이동한다.
 *
 * 🔴 `api-client` 의 `notifySessionExpired()` 는 **일부러 라우팅하지 않고 이벤트만 쏜다**
 *    ("지금 이 화면을 떠나도 되는가"는 화면이 판단한다). 그래서 **듣는 화면만 반응한다.**
 *
 * 🔴 2026-09-02 실측: 그 이벤트를 듣는 곳이 `(main)` 레이아웃 **하나뿐**이었다.
 *    `(main)` 밖 인증 화면 — 태블릿 11 · 직원 포털 8 · 기록 새 창 3 — 은 세션이 끝나도
 *    아무 일도 일어나지 않았다. 토큰은 이미 지워졌으니 모든 조회가 401 로 떨어지고,
 *    화면은 "불러오는 중…"이나 빈 목록으로 남는다. **로그인으로 가는 길도 없다.**
 *    특히 `/tablet/nursing` 은 PWA `start_url` 이다 — 설치된 태블릿이 여는 첫 화면이다.
 *
 * 로그인 경로가 그룹마다 다르므로(`/login` vs `/staff/login`) 인자로 받는다.
 */
export function SessionExpiryWatcher({ loginPath = '/login' }: { loginPath?: string }) {
  const router = useRouter();
  const clearSession = useAuthStore((s) => s.clearSession);

  useEffect(() => {
    const onExpired = () => {
      clearSession();
      const here = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '';
      router.replace(here && here !== loginPath ? `${loginPath}?next=${encodeURIComponent(here)}` : loginPath);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [router, clearSession, loginPath]);

  return null;
}
