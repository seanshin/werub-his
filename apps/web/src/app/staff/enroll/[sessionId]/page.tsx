'use client';

import { useState, useEffect, use } from 'react';
import { enrollDevice, passkeySupported } from '@/lib/passkey';
import { isInAppBrowser } from '@/lib/browser';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

export default function StaffEnrollPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [supported, setSupported] = useState(true);
  const [inApp, setInApp] = useState(false);
  const tAttr = useTAttr();

  useEffect(() => {
    setSupported(passkeySupported());
    setInApp(isInAppBrowser());
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await enrollDevice(sessionId, code.trim(), deviceName.trim() || undefined);
      setDone(true);
    } catch (e: unknown) {
      setError((e as { message?: string })?.message || tAttr('등록에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  // 문장 한가운데 끼는 강조 — 보간 부품(<Tf>)에 노드로 넘긴다
  const safariOpen = <b>"<T k="Safari로 열기" />"</b>;

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="max-w-sm w-full bg-white rounded-3xl shadow-xl p-8 text-center">
          <div className="text-4xl mb-3" aria-hidden>✅</div>
          <h1 className="text-lg font-bold text-gray-900"><T k="등록 요청 완료" /></h1>
          <p className="text-sm text-gray-500 mt-2">
            <T k="관리자가 최종 확인하면 이 기기로 로그인할 수 있습니다." />
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <main className="w-full max-w-sm bg-white rounded-3xl shadow-xl border border-gray-100 p-7">
        <h1 className="text-lg font-bold text-gray-900 text-center"><T k="이 기기 등록" /></h1>
        <p className="text-sm text-gray-500 text-center mt-1 mb-5">
          <Tf k="관리자 화면의 {인증번호}를 입력하고 생체인증으로 등록하세요." params={{ 인증번호: <b><T k="인증번호 6자리" /></b> }} />
        </p>

        {inApp && (
          <div role="alert" className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800">
            ⚠️ <Tf k="인앱 브라우저(텔레그램·카카오톡 등)에서는 {경고}." params={{ 경고: <b><T k="생체등록이 동작하지 않습니다" /></b> }} /><br />
            <Tf k="우측 상단 {메뉴} → {열기} 후 이 화면을 다시 열어 등록하세요." params={{ 메뉴: <b>···</b>, 열기: safariOpen }} />
          </div>
        )}

        {!supported ? (
          <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            <T k="이 브라우저는 생체인증(패스키)을 지원하지 않습니다. 지원 기기에서 다시 시도하세요." />
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1"><T k="인증번호" /></label>
              <input
                id="code"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="w-full px-3.5 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none text-center text-2xl tracking-[0.4em] font-mono"
                placeholder="------"
                required
              />
            </div>
            <div>
              <label htmlFor="dn" className="block text-sm font-medium text-gray-700 mb-1"><T k="기기 이름 (선택)" /></label>
              <input
                id="dn"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none text-sm"
                placeholder={tAttr('예: 내 아이폰')}
              />
            </div>
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold text-sm shadow-md disabled:opacity-60"
            >
              {busy ? <T k="등록 중…" /> : <>🔐 <T k="생체인증으로 등록" /></>}
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-4 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}
      </main>
    </div>
  );
}
