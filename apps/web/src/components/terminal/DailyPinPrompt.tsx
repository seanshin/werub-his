'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { registerDailyPinPrompt, type DailyPinPromptOptions } from '@/lib/daily-pin-prompt';

// 데일리 PIN 승인 모달 (단말 제로트러스트 ② Step 2 FE).
// 전역 마운트 — api-client 가 403 DAILY_PIN_REQUIRED 시 promptDailyPin() 호출 → 본 모달 표시.
// 승인 PIN 입력 → resolve(pin) → api-client 가 x-daily-pin 헤더로 원요청 재시도.
export function DailyPinPrompt() {
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [pin, setPin] = useState('');
  const resolverRef = useRef<((v: string | null) => void) | null>(null);

  useEffect(() => {
    registerDailyPinPrompt((opts: DailyPinPromptOptions) =>
      new Promise<string | null>((resolve) => {
        setInvalid(!!opts.invalid);
        setPin('');
        setOpen(true);
        resolverRef.current = resolve;
      }),
    );
    return () => registerDailyPinPrompt(null);
  }, []);

  const close = useCallback((value: string | null) => {
    setOpen(false);
    const r = resolverRef.current;
    resolverRef.current = null;
    r?.(value);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onClick={() => close(null)}
    >
      <div className="w-80 rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-base font-semibold text-gray-900">승인 PIN 입력</h3>
        <p className="mb-3 text-sm text-gray-500">이 작업을 승인하려면 오늘의 데일리 PIN을 입력하세요.</p>
        {invalid && <p className="mb-2 text-sm text-red-600">PIN이 일치하지 않습니다. 다시 입력하세요.</p>}
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          maxLength={6}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && pin) close(pin);
            if (e.key === 'Escape') close(null);
          }}
          className="mb-3 w-full rounded border px-3 py-2 text-center text-lg tracking-widest"
          placeholder="••••••"
        />
        <div className="flex gap-2">
          <button
            onClick={() => close(null)}
            className="flex-1 rounded border px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            취소
          </button>
          <button
            onClick={() => pin && close(pin)}
            disabled={!pin}
            className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            승인
          </button>
        </div>
      </div>
    </div>
  );
}
