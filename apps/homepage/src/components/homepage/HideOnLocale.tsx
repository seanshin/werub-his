'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

// 다국어 랜딩(/en·/zh·/ja)은 자체 헤더/푸터를 가지므로, 홈페이지 공통 GNB/Footer를 숨긴다.
// (서버 컴포넌트를 children으로 받아 클라이언트에서 경로 기준 조건부 표시)
const LOCALE_PREFIXES = ['/en', '/zh', '/ja'];

export function HideOnLocale({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/';
  const onLocale = LOCALE_PREFIXES.some((l) => pathname === l || pathname.startsWith(l + '/'));
  if (onLocale) return null;
  return <>{children}</>;
}
