'use client';

import { useAuthStore } from '@/stores/auth-store';
import { useHydrateUiLocale } from '@/stores/ui-locale-store';
import { useHydrateReviewOverlay } from '@/stores/i18n-overlay-store';

/**
 * UI 언어 부팅 — `(main)` 밖 직원 화면 그룹(`/staff`·`/tablet`·`/record-*`)의 레이아웃에 붙인다.
 *
 * 🔴 (2026-09-11 실측) `useHydrateUiLocale()`·`useHydrateReviewOverlay()` 를 부르는 곳이 **`(main)/layout.tsx` 하나뿐**이었다.
 *    그래서 `/staff/*` 로 바로 들어오면 저장된 언어를 읽지 않고 ko 에 머물렀다 — `/staff` 10화면을 배선해도 새 탭·새로고침에서는
 *    번역이 **보이지 않는다**(`(main)` 에서 클라이언트 이동으로 넘어올 때만 보였다). 승인된 사람 검수 번역도 `(main)` 에서만 얹혔다.
 *    세션 만료를 `(main)` 만 듣던 것(SessionExpiryWatcher)과 같은 모양이다.
 * 🔴 로그인 전에는 서버를 부르지 않는다 — 로컬 캐시만 적용하고, 로그인되면 다시 돈다.
 */
export function UiLocaleBoot() {
  const authed = useAuthStore((s) => !!s.user);
  useHydrateUiLocale({ server: authed });
  useHydrateReviewOverlay({ enabled: authed });
  return null;
}
