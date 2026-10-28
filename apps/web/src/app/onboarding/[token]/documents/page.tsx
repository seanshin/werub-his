'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { onboardingApi } from '@/lib/onboarding';

const CATS: { key: string; label: string }[] = [
  { key: 'ID_CARD', label: '신분증' },
  { key: 'BANKBOOK', label: '통장사본' },
  { key: 'LICENSE', label: '면허/자격증' },
  { key: 'CAREER', label: '경력증명' },
  { key: 'PLEDGE', label: '서약서' },
  { key: 'HEALTH', label: '건강검진' },
  { key: 'PHOTO', label: '증명사진' },
];

export default function OnboardingDocuments() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [docs, setDocs] = useState<any[]>([]);
  /** 🔴 조회 실패를 '미제출'로 보이게 하지 않는다 — 중복 업로드를 유발한다 */
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState('');
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = () => onboardingApi.listDocuments(token).then(setDocs).catch(() => setLoadFailed(true));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

  const upload = async (category: string, file?: File) => {
    if (!file) return;
    setBusy(category);
    try { await onboardingApi.uploadDocument(token, category, file); await load(); }
    catch (e: any) { alert(e.message); } finally { setBusy(''); }
  };

  const uploadedOf = (cat: string) => docs.filter((d) => d.category === cat);

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="max-w-md mx-auto bg-white rounded-2xl shadow-sm border p-6">
        <a href={`/onboarding/${token}`} className="text-xs text-slate-400 hover:underline">← 처음으로</a>
        <h1 className="text-xl font-bold mt-2 mb-1">서류 제출</h1>
        <p className="text-xs text-slate-400 mb-4">신분증·통장사본은 급여 담당(ERP)에서 직접 확인·입력합니다. (이미지/PDF, 10MB)</p>
        {/* 🔴 조회 실패를 "미제출"로 보이게 하지 않는다 — 이미 낸 서류를 또 올리게 된다 */}
        {loadFailed && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            제출 이력을 불러오지 못했습니다. 아래가 비어 있어도 <b>미제출이라는 뜻이 아닙니다.</b>
          </div>
        )}

        <div className="space-y-2">
          {CATS.map((c) => {
            const ups = uploadedOf(c.key);
            return (
              <div key={c.key} className="flex items-center justify-between rounded-xl border p-3">
                <div>
                  <span className="text-sm font-medium">{c.label}</span>
                  {ups.length > 0 && <span className="ml-2 text-xs text-emerald-600">제출됨 ({ups.length})</span>}
                </div>
                <input ref={(el) => { fileRefs.current[c.key] = el; }} type="file" accept="image/*,application/pdf" className="hidden"
                  onChange={(e) => upload(c.key, e.target.files?.[0])} />
                <button disabled={busy === c.key} onClick={() => fileRefs.current[c.key]?.click()}
                  className="px-3 py-1.5 rounded-lg border text-xs hover:bg-slate-50 disabled:opacity-50">{busy === c.key ? '업로드 중…' : '업로드'}</button>
              </div>
            );
          })}
        </div>

        <button onClick={() => router.push(`/onboarding/${token}/contract`)} className="w-full mt-5 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium">
          다음 · 근로계약 →
        </button>
      </div>
    </div>
  );
}
