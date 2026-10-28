// 수술방 차트 — 독립 셸((main) 사이드바·탑바 없음): 수술방 태블릿·모니터 전체 화면용.
// 루트 Providers(QueryClient·auth)는 app/layout.tsx 에서 상속 · 로그인한 직원 단말에서만(세션 만료 시 로그인으로).
import type { Metadata } from 'next';
import { SessionExpiryWatcher } from '@/components/auth/SessionExpiryWatcher';
import { UiLocaleBoot } from '@/components/i18n/UiLocaleBoot';

export const metadata: Metadata = {
  title: '수술방 차트',
};

export default function OrChartLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 text-gray-900">
      {children}
      <SessionExpiryWatcher loginPath="/login" />
      <UiLocaleBoot />
    </div>
  );
}
