'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { onboardingApi } from '@/lib/onboarding';

export default function OnboardingProfile() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [f, setF] = useState<Record<string, string | boolean>>({ gender: '', nationality: 'KR', zipCode: '', addr1: '', addr2: '', emgName: '', emgRelation: '', emgPhone: '', military: '', sensitiveConsent: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const set = (k: string, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => { onboardingApi.getProfile(token).then((p) => { if (p) setF((prev) => ({ ...prev, ...p })); }).catch(() => {}); }, [token]);

  const save = async (submit: boolean) => {
    setBusy(true); setMsg('');
    try {
      await onboardingApi.putProfile(token, { ...f, submit });
      if (submit) { setMsg('제출 완료'); router.push(`/onboarding/${token}/documents`); }
      else setMsg('임시저장됨');
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="max-w-md mx-auto bg-white rounded-2xl shadow-sm border p-6">
        <a href={`/onboarding/${token}`} className="text-xs text-slate-400 hover:underline">← 처음으로</a>
        <h1 className="text-xl font-bold mt-2 mb-1">인적사항 입력</h1>
        <p className="text-xs text-slate-400 mb-4">※ 주민등록번호·급여계좌는 입력하지 않습니다. 신분증·통장사본은 다음 단계에서 서류로 제출합니다.</p>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <select value={f.gender as string} onChange={(e) => set('gender', e.target.value)} className="border rounded-lg px-3 py-2">
            <option value="">성별</option><option value="M">남</option><option value="F">여</option><option value="OTHER">기타</option>
          </select>
          <input placeholder="국적" value={f.nationality as string} onChange={(e) => set('nationality', e.target.value)} className="border rounded-lg px-3 py-2" />
          <input placeholder="우편번호" value={f.zipCode as string} onChange={(e) => set('zipCode', e.target.value)} className="border rounded-lg px-3 py-2" />
          <input placeholder="기본주소" value={f.addr1 as string} onChange={(e) => set('addr1', e.target.value)} className="border rounded-lg px-3 py-2" />
          <input placeholder="상세주소" value={f.addr2 as string} onChange={(e) => set('addr2', e.target.value)} className="border rounded-lg px-3 py-2 col-span-2" />
          <div className="col-span-2 text-xs text-slate-400 mt-1">비상연락처</div>
          <input placeholder="이름" value={f.emgName as string} onChange={(e) => set('emgName', e.target.value)} className="border rounded-lg px-3 py-2" />
          <input placeholder="관계" value={f.emgRelation as string} onChange={(e) => set('emgRelation', e.target.value)} className="border rounded-lg px-3 py-2" />
          <input placeholder="전화" value={f.emgPhone as string} onChange={(e) => set('emgPhone', e.target.value)} className="border rounded-lg px-3 py-2 col-span-2" />
          <select value={f.military as string} onChange={(e) => set('military', e.target.value)} className="border rounded-lg px-3 py-2 col-span-2">
            <option value="">병역(선택)</option><option value="DONE">군필</option><option value="EXEMPT">면제</option><option value="NA">해당없음</option><option value="UNFINISHED">미필</option>
          </select>
        </div>

        <label className="flex items-center gap-2 mt-3 text-xs text-slate-600">
          <input type="checkbox" checked={f.sensitiveConsent as boolean} onChange={(e) => set('sensitiveConsent', e.target.checked)} />
          민감정보 수집·이용에 동의합니다 (개인정보보호법 §23·§24)
        </label>

        <div className="flex gap-2 mt-4">
          <button disabled={busy} onClick={() => save(false)} className="flex-1 px-4 py-2 rounded-lg border text-sm disabled:opacity-50">임시저장</button>
          <button disabled={busy} onClick={() => save(true)} className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-50">제출 · 다음 →</button>
        </div>
        {msg && <p className="text-center text-sm mt-3 text-slate-600">{msg}</p>}
      </div>
    </div>
  );
}
