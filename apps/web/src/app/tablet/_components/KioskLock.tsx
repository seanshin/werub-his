'use client';
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';

const IDLE_MS = 3 * 60 * 1000; // 3분 무동작 자동 잠금

/** 키오스크 화면 잠금 — 무동작 타임아웃·수동(tablet:lock 이벤트). 비밀번호 재인증으로 해제. */
export default function KioskLock() {
  const [locked, setLocked] = useState(false);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const email = useAuthStore((s) => s.user?.email);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const reset = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { if (email) setLocked(true); }, IDLE_MS);
    };
    const lockNow = () => { if (email) setLocked(true); };
    const acts: (keyof WindowEventMap)[] = ['pointerdown', 'keydown'];
    acts.forEach((a) => window.addEventListener(a, reset));
    window.addEventListener('tablet:lock', lockNow);
    reset();
    return () => {
      acts.forEach((a) => window.removeEventListener(a, reset));
      window.removeEventListener('tablet:lock', lockNow);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [email]);

  const unlock = async () => {
    if (!email) return;
    setBusy(true); setErr(false);
    try {
      await useAuthStore.getState().login(email, pw);
      setLocked(false); setPw('');
    } catch { setErr(true); }
    finally { setBusy(false); }
  };

  if (!locked) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-gray-900/95 backdrop-blur flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <h2 className="text-xl font-bold text-gray-900">화면 잠금</h2>
        <p className="text-sm text-gray-500 mt-1">{email}</p>
        <input
          type="password" value={pw} autoFocus
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') unlock(); }}
          placeholder="비밀번호로 잠금 해제"
          className="mt-5 w-full h-14 px-5 rounded-2xl border border-gray-200 text-lg outline-none focus:border-blue-400 text-center"
        />
        {err && <p className="mt-2 text-sm text-red-600">비밀번호가 올바르지 않습니다.</p>}
        <button onClick={unlock} disabled={busy || !pw}
          className="mt-4 w-full h-14 rounded-2xl bg-blue-600 text-white text-lg font-semibold disabled:opacity-40">
          {busy ? '확인 중…' : '잠금 해제'}
        </button>
      </div>
    </div>
  );
}
