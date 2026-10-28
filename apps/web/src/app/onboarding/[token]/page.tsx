'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { onboardingApi, registerOnboardingBiometric } from '@/lib/onboarding';
import { ONBOARDING_STATUS_LABEL } from '@hospital-run/shared';

const STATUS_LABEL = ONBOARDING_STATUS_LABEL; // 정본(onboarding)

export default function OnboardingLanding() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [view, setView] = useState<any>(null);
  const [error, setError] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => onboardingApi.view(token).then(setView).catch((e) => setError(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

  const doClaim = async () => {
    setBusy(true); setMsg('');
    try { await onboardingApi.claim(token, birthDate); setMsg('본인확인 완료. 이제 생체등록을 진행하세요.'); await load(); }
    catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };
  const doBiometric = async () => {
    setBusy(true); setMsg('');
    try { await registerOnboardingBiometric(token, '온보딩 기기'); setMsg('생체등록 완료! 환영 페이지로 이동합니다.'); await load(); setTimeout(() => router.push(`/onboarding/${token}/welcome`), 800); }
    catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };

  if (error) return <Shell><p className="text-rose-600 text-center py-10">{error}</p></Shell>;
  if (!view) return <Shell><p className="text-slate-400 text-center py-10">불러오는 중…</p></Shell>;

  const verified = view.steps?.identity;
  return (
    <Shell>
      <div className="text-center mb-6">
        <p className="text-sm text-slate-500">{view.jobCategory}{view.department ? ` · ${view.department}` : ''}</p>
        <h1 className="text-2xl font-bold mt-1">{view.name}님, 환영합니다</h1>
        <span className="inline-block mt-2 px-3 py-0.5 rounded-full bg-slate-100 text-xs">{STATUS_LABEL[view.status] ?? view.status}</span>
      </div>

      <Stepper status={view.status} />

      {!verified && (
        <div className="space-y-4 mt-6">
          <div className="rounded-xl border p-4">
            <h2 className="font-semibold text-sm mb-2">① 본인확인 (생년월일)</h2>
            <div className="flex gap-2">
              <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className="border rounded-lg px-3 py-2 text-sm flex-1" />
              <button disabled={!birthDate || busy} onClick={doClaim} className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm disabled:opacity-50">확인</button>
            </div>
          </div>
          <div className="rounded-xl border p-4">
            <h2 className="font-semibold text-sm mb-2">② 스마트폰 생체등록 (로그인 정보)</h2>
            <p className="text-xs text-slate-500 mb-3">지문/얼굴로 본인의 로그인 수단을 등록합니다. 입사 후에도 이 생체로 로그인합니다.</p>
            <button disabled={busy} onClick={doBiometric} className="w-full px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium disabled:opacity-50">🔐 생체등록 시작</button>
          </div>
        </div>
      )}

      {verified && (
        <div className="mt-6 space-y-2">
          <NavCard href={`/onboarding/${token}/welcome`} title="회사 소개·문화" done={view.welcomeViewed} />
          <NavCard href={`/onboarding/${token}/profile`} title="인적사항 입력" done={view.steps?.documents} />
          <NavCard href={`/onboarding/${token}/documents`} title="서류 제출" done={view.steps?.documents} />
          <NavCard href={`/onboarding/${token}/contract`} title="근로계약 서명" done={view.steps?.contract} />
        </div>
      )}

      {msg && <p className="text-center text-sm mt-4 text-slate-600">{msg}</p>}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border p-6">{children}</div>
    </div>
  );
}

function Stepper({ status }: { status: string }) {
  const order = ['INVITED', 'VERIFIED', 'DOC_SUBMITTED', 'CONTRACT_SIGNED', 'BOOTED'];
  const idx = order.indexOf(status);
  const labels = ['초대', '본인확인', '서류', '계약', '완료'];
  return (
    <div className="flex items-center justify-between">
      {labels.map((l, i) => (
        <div key={l} className="flex-1 flex flex-col items-center">
          <div className={`w-6 h-6 rounded-full text-[10px] flex items-center justify-center ${i <= idx ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-400'}`}>{i + 1}</div>
          <span className="text-[10px] mt-1 text-slate-500">{l}</span>
        </div>
      ))}
    </div>
  );
}

function NavCard({ href, title, done }: { href: string; title: string; done?: boolean }) {
  return (
    <a href={href} className="flex items-center justify-between rounded-xl border p-3.5 hover:bg-slate-50">
      <span className="text-sm font-medium">{title}</span>
      <span className={`text-xs ${done ? 'text-emerald-600' : 'text-slate-400'}`}>{done ? '완료 ✓' : '진행 →'}</span>
    </a>
  );
}
