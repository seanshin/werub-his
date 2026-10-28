// 타블렛 보기 모드 — 독립 셸(데스크탑 (main) 사이드바/탑바 미사용).
// 루트 Providers(QueryClient·auth)는 app/layout.tsx에서 상속.
import type { Metadata } from 'next';
import KioskLock from './_components/KioskLock';
import TabletNotificationBell from './_components/TabletNotificationBell';
import { SessionExpiryWatcher } from '@/components/auth/SessionExpiryWatcher';
import { UiLocaleBoot } from '@/components/i18n/UiLocaleBoot';

export const metadata: Metadata = {
  title: '타블렛 차트 — WERUBYHOSP',
};

export default function TabletLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-100 text-gray-900 select-none [touch-action:manipulation]">
      {children}
      <TabletNotificationBell />
      {/* 세션이 끝나면 잠금이 아니라 로그인으로 — KioskLock 은 로그인 상태에서만 잠근다 */}
      <SessionExpiryWatcher loginPath="/staff/login" />
      {/* UI 언어 부팅 — (main) 밖 직원 화면 그룹 공통 */}
      <UiLocaleBoot />
      <KioskLock />
    </div>
  );
}
