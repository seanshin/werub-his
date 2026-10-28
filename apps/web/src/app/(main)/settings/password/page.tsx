'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { apiClient, ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 내 비밀번호 변경 — `POST /api/v1/auth/change-password`(JwtAuthGuard · 전 역할).
 *
 * 🔴 (2026-09-14) 서버 EP 는 있었는데 **부르는 화면이 0** 이었다 — 일회용 비밀번호를 받은 직원이 바꿀 길이 없었다.
 *  - 정책(길이·문자 조합)은 서버 정본(`password-policy.ts`)이 판정한다 — 화면이 규칙을 따로 적지 않는다(정본이 둘이면 갈라진다).
 *    화면이 하는 검사는 "새 비밀번호 두 칸이 같은가"뿐이다.
 *  - 변경되면 서버가 **모든 세션을 만료**한다 → 서버 로그아웃을 부르지 않고(이미 401) 로컬 세션만 정리하고 로그인 화면으로.
 */
export default function MyPasswordPage() {
  const tAttr = useTAttr();
  const router = useRouter();
  const clearSession = useAuthStore((s) => s.clearSession);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);

  const m = useMutation({
    mutationFn: () => apiClient.post<{ data: { message: string } }>('/api/v1/auth/change-password', { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setDone(true);
      setTimeout(() => { clearSession(); router.push('/login'); }, 1500);
    },
  });

  const mismatch = next.length > 0 && confirm.length > 0 && next !== confirm;
  const canSubmit = current.length > 0 && next.length > 0 && next === confirm && !m.isPending && !done;
  const errorText = m.error instanceof ApiError ? m.error.message : m.error ? tAttr('비밀번호를 변경하지 못했습니다.') : null;

  return (
    <div className="max-w-md mx-auto p-4">
      <h1 className="text-lg font-bold text-gray-900 mb-1"><T k="비밀번호 변경" /></h1>
      <p className="text-xs text-gray-500 mb-4"><T k="변경하면 모든 기기에서 로그아웃되며 새 비밀번호로 다시 로그인합니다." /></p>

      {done ? (
        <p role="status" className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
          <T k="비밀번호가 변경되었습니다. 로그인 화면으로 이동합니다." />
        </p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => { e.preventDefault(); if (canSubmit) m.mutate(); }}
        >
          <label className="block text-sm">
            <span className="text-gray-700"><T k="현재 비밀번호" /></span>
            <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700"><T k="새 비밀번호" /></span>
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700"><T k="새 비밀번호 확인" /></span>
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2" />
          </label>
          <p className="text-xs text-gray-500"><T k="비밀번호 규칙은 서버 정책이 판정합니다 — 맞지 않으면 사유가 아래에 표시됩니다." /></p>
          {mismatch && <p className="text-xs text-red-600"><T k="새 비밀번호 두 칸이 일치하지 않습니다." /></p>}
          {errorText && <p role="alert" className="text-xs text-red-600">{errorText}</p>}
          <button type="submit" disabled={!canSubmit}
            className="min-h-[44px] w-full rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50">
            {m.isPending ? <T k="변경 중..." /> : <T k="비밀번호 변경" />}
          </button>
        </form>
      )}
    </div>
  );
}
