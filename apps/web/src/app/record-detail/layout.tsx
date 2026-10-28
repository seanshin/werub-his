import type { ReactNode } from 'react';
import { SessionExpiryWatcher } from '@/components/auth/SessionExpiryWatcher';
import { UiLocaleBoot } from '@/components/i18n/UiLocaleBoot';

// 기록 열람 새 창((main) 밖) — 세션이 끝나면 빈 화면으로 남지 않게 로그인으로 되돌린다.
export default function RecordWindowLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <SessionExpiryWatcher />
      {/* UI 언어 — (main) 밖이라 여기서 부팅한다(없으면 새 창이 늘 ko) */}
      <UiLocaleBoot />
    </>
  );
}
