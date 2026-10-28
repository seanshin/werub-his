'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { EssContent } from '@/app/(main)/ess/_components/EssContent';
import { T, useTAttr } from '@/components/ui/i18n-text';

// 내부포털(모바일) 전용 내 행정(ESS) — 경량 셸. (main) 데스크톱 셸 미사용.
export default function StaffEssPage() {
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

  if (!ready) return <div className="min-h-screen flex items-center justify-center text-gray-400"><T k="로딩 중…" /></div>;

  return (
    <div className="min-h-[100dvh] bg-[#f0f4f8]">
      <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/60 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
          <button onClick={() => router.push('/staff')} aria-label={tAttr('내부포털로')} className="p-1 -ml-1 rounded-lg hover:bg-gray-100">
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="font-bold text-gray-800"><T k="내 행정 (ESS)" /></span>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-5">
        <EssContent showTitle={false} />
      </main>
    </div>
  );
}
