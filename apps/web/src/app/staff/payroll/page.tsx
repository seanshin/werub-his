'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { PayrollBasicsSection } from '@/app/(main)/ess/_components/PayrollBasicsSection';
import { PayslipSection } from '@/app/(main)/ess/_components/PayslipSection';
import { PayExtrasSection } from '@/app/(main)/ess/_components/PayExtrasSection';
import { T, useTAttr } from '@/components/ui/i18n-text';

// 내부포털(경량 셸)에서 진입하는 급여 기초정보 — 모바일 작업 가능. (main) 데스크톱 셸 미사용 → 백 오류 없음.
export default function StaffPayrollPage() {
  const router = useRouter();
  const { user, isAuthenticated, loadProfile } = useAuthStore();
  const [ready, setReady] = useState(false);
  const tAttr = useTAttr();

  useEffect(() => {
    (async () => {
      if (!isAuthenticated) { router.replace('/staff/login'); return; }
      if (!user) { try { await loadProfile(); } catch { router.replace('/staff/login'); return; } }
      setReady(true);
    })();
  }, [isAuthenticated, user, loadProfile, router]);

  if (!ready) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400"><T k="로딩 중…" /></div>;
  }

  return (
    <div className="min-h-[100dvh] bg-[#f0f4f8]">
      <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/60 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
          <button onClick={() => router.push('/staff')} aria-label={tAttr('내부포털로')} className="p-1 -ml-1 rounded-lg hover:bg-gray-100">
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="font-bold text-gray-800"><T k="급여 기초정보" /></span>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-5">
        <p className="text-xs text-slate-500 mb-3"><T k="급여명세·계좌·주민번호·부양가족·입사서류를 관리합니다. (본인만 열람)" /></p>
        <div className="space-y-5">
          <PayslipSection />
          <PayExtrasSection />
          <PayrollBasicsSection />
        </div>
      </main>
    </div>
  );
}
