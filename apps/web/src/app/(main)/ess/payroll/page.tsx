'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { T } from '@/components/ui/i18n-text';

// 급여 기초정보는 경량 셸(/staff/payroll·모바일 친화)로 통합. 기존 URL은 리다이렉트로 호환.
export default function EssPayrollRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/staff/payroll'); }, [router]);
  return <div className="p-6 text-sm text-slate-400"><T k="이동 중…" /></div>;
}
