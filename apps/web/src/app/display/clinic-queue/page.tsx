'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ClinicQueueBoard } from '../_boards/ClinicQueueBoard';

/** 외래 진료실 대기 TV — 직접 URL 경로(?departments=). 박스 경로(/display/box/<key>)와 같은 컴포넌트를 쓴다. */
function Inner() {
  const sp = useSearchParams();
  return <ClinicQueueBoard departments={sp.get('departments') ?? ''} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-[#0a0e16]" />}>
      <Inner />
    </Suspense>
  );
}
