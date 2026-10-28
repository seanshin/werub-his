'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { onboardingApi } from '@/lib/onboarding';

export default function OnboardingWelcome() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [content, setContent] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { onboardingApi.welcome(token).then(setContent).catch(() => setContent({ sections: [] })); }, [token]);

  const pick = (v: any) => (typeof v === 'string' ? v : v?.ko ?? v?.en ?? '');
  const sections: any[] = content?.sections ?? [];

  const ack = async () => {
    setBusy(true);
    try { await onboardingApi.ackWelcome(token); router.push(`/onboarding/${token}/profile`); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border p-6">
        <a href={`/onboarding/${token}`} className="text-xs text-slate-400 hover:underline">← 처음으로</a>
        <h1 className="text-xl font-bold mt-2 mb-4">회사 소개 · 문화</h1>

        {!content && <p className="text-slate-400 py-10 text-center">불러오는 중…</p>}
        {content && sections.length === 0 && (
          <div className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">
            환영합니다! 우리 병원의 일원이 되신 것을 진심으로 환영합니다.<br />
            <span className="text-xs text-slate-400">(환영 콘텐츠는 관리자가 등록할 수 있습니다.)</span>
          </div>
        )}
        {sections.map((s, i) => (
          <section key={i} className="mb-5">
            {s.title && <h2 className="font-semibold text-sm mb-1">{pick(s.title)}</h2>}
            {s.by && <p className="text-xs text-slate-400 mb-1">{s.by}</p>}
            {s.body && <p className="text-sm text-slate-600 whitespace-pre-line">{pick(s.body)}</p>}
            {s.type === 'CODE_OF_CONDUCT' && <span className="inline-block mt-1 text-[11px] text-amber-600">※ 필수 숙지 항목</span>}
          </section>
        ))}

        <button disabled={busy} onClick={ack} className="w-full mt-4 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium disabled:opacity-50">
          확인했습니다 · 다음(인적사항) →
        </button>
      </div>
    </div>
  );
}
