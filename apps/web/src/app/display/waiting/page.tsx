'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { LegacyWaitingBoard } from '../_boards/LegacyWaitingBoard';

/**
 * 외래 호출 전광판(구형) — 직접 URL 경로(?departments=).
 * 박스 경로(/display/box/<key>)와 **같은 컴포넌트**를 쓴다(2026-08-14 W8: 박스에서 이 보드를
 * 지정해도 TV 가 "보드 미지정"을 띄우던 것 봉합).
 */
function Inner() {
  const sp = useSearchParams();
  return <LegacyWaitingBoard departments={sp.get('departments') ?? ''} />;
}

export default function WaitingDisplayPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900" />}>
      <Inner />
    </Suspense>
  );
}
