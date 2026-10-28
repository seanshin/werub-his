'use client';

import { use } from 'react';
import { ConsentSignView } from '@/components/signature/ConsentSignView';

export default function ConsentSignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <ConsentSignView token={token} />;
}
