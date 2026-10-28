'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { onboardingApi } from '@/lib/onboarding';

export default function OnboardingContract() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(false);

  const sign = async () => {
    setBusy(true); setMsg('');
    try { await onboardingApi.signContract(token); setDone(true); setMsg('계약 서명이 완료되었습니다. 담당자 승인 후 입사가 확정됩니다.'); }
    catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="max-w-md mx-auto bg-white rounded-2xl shadow-sm border p-6">
        <a href={`/onboarding/${token}`} className="text-xs text-slate-400 hover:underline">← 처음으로</a>
        <h1 className="text-xl font-bold mt-2 mb-3">근로/위촉 계약 서명</h1>

        <div className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-600 h-48 overflow-y-auto">
          <p className="font-medium mb-2">근로계약서</p>
          <p className="whitespace-pre-line text-xs leading-relaxed">
            본 계약은 병원과 입사자 간의 근로조건을 정합니다. 근무시간·임금·복무규정 등 세부 조건은 취업규칙에 따릅니다.
            전자서명은 전자문서 및 전자거래 기본법·전자서명법에 따라 서면 서명과 동일한 효력을 가집니다.
            {'\n\n'}(실제 운영 시 관리자가 등록한 계약 템플릿이 표시됩니다.)
          </p>
        </div>

        {!done && (
          <>
            <label className="flex items-center gap-2 mt-4 text-sm text-slate-700">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              계약 내용을 확인했으며 전자서명에 동의합니다.
            </label>
            <button disabled={!agree || busy} onClick={sign} className="w-full mt-4 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium disabled:opacity-50">
              {busy ? '서명 중…' : '✍️ 전자서명'}
            </button>
          </>
        )}
        {done && (
          <button onClick={() => router.push(`/onboarding/${token}`)} className="w-full mt-4 px-4 py-2.5 rounded-lg border text-sm">처음으로</button>
        )}
        {msg && <p className="text-center text-sm mt-3 text-slate-600">{msg}</p>}
      </div>
    </div>
  );
}
