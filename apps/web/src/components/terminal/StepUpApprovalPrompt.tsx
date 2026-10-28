'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { registerStepUpPrompt, type StepUpPromptOptions } from '@/lib/step-up-push';

// 스마트폰 푸시 생체승인 대기 모달 (단말 제로트러스트 ② Tier2 Step C).
// 전역 마운트 — api-client 가 403 STEPUP_REQUIRED 시 promptStepUp() 호출 →
// push/request 로 승인요청 생성(스태프 폰 푸시) → status polling → 승인 시 step-up 토큰 반환.
type Phase = 'pending' | 'expired' | 'denied' | 'error';

export function StepUpApprovalPrompt() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('pending');
  const resolverRef = useRef<((v: string | null) => void) | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const finish = useCallback((token: string | null) => {
    stopPoll();
    setOpen(false);
    const r = resolverRef.current;
    resolverRef.current = null;
    r?.(token);
  }, [stopPoll]);

  const start = useCallback(async (opts: StepUpPromptOptions) => {
    setPhase('pending');
    setOpen(true);
    try {
      const res = await apiClient.post<{ data: { requestId: string } }>(
        '/api/v1/auth/step-up/push/request',
        { action: opts.action, resourceId: opts.resourceId },
      );
      const requestId = res.data.requestId;
      pollRef.current = setInterval(async () => {
        try {
          const r = await apiClient.get<{ data: { status: string; stepUpToken?: string } }>(
            `/api/v1/auth/step-up/push/status/${requestId}`,
          );
          const s = r.data.status;
          if (s === 'APPROVED' && r.data.stepUpToken) {
            finish(r.data.stepUpToken);
          } else if (s === 'EXPIRED') {
            stopPoll();
            setPhase('expired');
            setTimeout(() => finish(null), 1500);
          } else if (s === 'DENIED') {
            stopPoll();
            setPhase('denied');
            setTimeout(() => finish(null), 1500);
          }
        } catch {
          /* 일시 오류 — 다음 주기 재시도 */
        }
      }, 2000);
    } catch {
      setPhase('error');
      setTimeout(() => finish(null), 1500);
    }
  }, [finish, stopPoll]);

  useEffect(() => {
    registerStepUpPrompt(
      (opts: StepUpPromptOptions) =>
        new Promise<string | null>((resolve) => {
          resolverRef.current = resolve;
          void start(opts);
        }),
    );
    return () => registerStepUpPrompt(null);
  }, [start]);

  if (!open) return null;

  const msg =
    phase === 'expired'
      ? '승인 시간이 만료되었습니다.'
      : phase === 'denied'
        ? '승인이 거부되었습니다.'
        : phase === 'error'
          ? '승인 요청에 실패했습니다.'
          : '등록된 스마트폰에서 생체인증으로 승인해 주세요.';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="w-80 rounded-lg bg-white p-6 text-center shadow-xl">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
          {phase === 'pending' ? (
            <svg className="h-6 w-6 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          ) : (
            <span className="text-xl">{phase === 'expired' || phase === 'denied' || phase === 'error' ? '⚠️' : '📱'}</span>
          )}
        </div>
        <h3 className="mb-1 text-base font-semibold text-gray-900">스마트폰 승인 필요</h3>
        <p className="mb-4 text-sm text-gray-500">{msg}</p>
        <button
          onClick={() => finish(null)}
          className="w-full rounded border px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          취소
        </button>
      </div>
    </div>
  );
}
