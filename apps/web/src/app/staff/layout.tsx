import type { ReactNode } from 'react';
import { StaffIdleLogout } from '@/components/staff/StaffIdleLogout';
import { SessionExpiryWatcher } from '@/components/auth/SessionExpiryWatcher';
import { UiLocaleBoot } from '@/components/i18n/UiLocaleBoot';

// 스탭 포털 공용 레이아웃 — 유휴 타임아웃 자동 로그아웃(웹 보안) 부착.
export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <StaffIdleLogout />
      {/* 유휴 로그아웃과 별개 — 토큰 만료(refresh 실패)도 로그인으로 되돌린다 */}
      <SessionExpiryWatcher loginPath="/staff/login" />
      {/* 🔴 UI 언어 부팅 — 종전엔 (main) 에서만 돌아 /staff 로 바로 들어오면 늘 ko 였다(배선 10화면이 안 보임) */}
      <UiLocaleBoot />
    </>
  );
}
