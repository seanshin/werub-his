'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';

// 스탭 포털(웹) 유휴 타임아웃 → 자동 로그아웃 (보안).
// 인증 상태에서 일정 시간 무활동 시 logout() + 로그인 화면으로 이동(복귀경로·timeout 플래그 포함).
const IDLE_MS = 10 * 60 * 1000; // 10분 무활동
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;

export function StaffIdleLogout() {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, logout } = useAuthStore();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // 로그인 화면이거나 미인증이면 타이머 불필요
    if (!isAuthenticated) return;
    if (pathname && pathname.startsWith('/staff/login')) return;

    const doLogout = async () => {
      try { await logout(); } catch { /* 로컬 토큰은 logout() 내부에서 정리됨 */ }
      const next = pathname && pathname.startsWith('/staff') ? pathname : '/staff/approvals';
      router.replace(`/staff/login?next=${encodeURIComponent(next)}&timeout=1`);
    };

    const reset = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { void doLogout(); }, IDLE_MS);
    };

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset(); // 마운트 시 타이머 시작

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, reset));
      if (timer.current) clearTimeout(timer.current);
    };
  }, [isAuthenticated, pathname, logout, router]);

  return null;
}
