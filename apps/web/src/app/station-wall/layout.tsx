// 간호 스테이션 벽걸이(TV) 화면 — 독립 셸((main) 사이드바·탑바 없음 · 타블렛의 잠금 화면도 없음: 벽걸이는 무인 상시 표시).
// 루트 Providers(QueryClient·auth)는 app/layout.tsx 에서 상속. 로그인한 직원 단말에서 띄운다(공개 전광판 아님).
import type { Metadata } from 'next';
import { SessionExpiryWatcher } from '@/components/auth/SessionExpiryWatcher';
import { UiLocaleBoot } from '@/components/i18n/UiLocaleBoot';

export const metadata: Metadata = {
  title: '간호 스테이션 벽걸이',
};

export default function StationWallLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {children}
      <SessionExpiryWatcher loginPath="/login" />
      <UiLocaleBoot />
    </div>
  );
}
