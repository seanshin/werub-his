'use client';

/**
 * 원내 코드 호출(2026-10-07) — 직원 화면(/staff)·코드블루 화면(/code-blue)이 같은 부품을 쓴다.
 *  · 종류는 고르기 전 미선택(한 번 눌러 고른다) · 위치 필수(서버 DTO 필수) · 발신 전 한 번 더 확인(전 직원 도달 — 거짓 호출 방지)
 *  · 결과는 서버가 센 도달 수·푸시 발송 수를 그대로(보냈다 ≠ 받았다 — 확인 응답은 알림에서)
 *  · CODE BLUE 는 소생 기록으로 이어진다(`/code-blue?staffCallId=…` — 호출과 기록을 잇는다)
 * 환자 정보는 보내지 않는다(서버 FR-49 — 운영 정보만).
 */
import { useState } from 'react';
import Link from 'next/link';
import { CODE_CALL_LABEL, CODE_CALL_TYPES, type CodeCallType } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

type Result = { id: string; delivered: number; fcmSent?: number };

export function CodeCallModal({ onClose, onSent }: { onClose: () => void; onSent?: (r: Result & { codeType: CodeCallType; location: string }) => void }) {
  const tAttr = useTAttr();
  const [codeType, setCodeType] = useState<CodeCallType | ''>('');
  const [location, setLocation] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const ready = !!codeType && location.trim().length > 0;

  const send = async () => {
    if (!ready || !codeType) return;
    setBusy(true); setError('');
    try {
      const r = await apiClient.post<{ data: Result }>('/api/v1/staff-calls/code', { targetKind: 'ALL', codeType, location: location.trim() });
      const d = ((r as { data?: Result })?.data ?? r) as Result;
      setResult(d);
      onSent?.({ ...d, codeType, location: location.trim() });
    } catch (e) {
      setError(extractErrorMessage(e) || tAttr('발신 실패'));
      setConfirming(false);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" data-code-call-modal>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5">
        <h3 className="mb-3 text-lg font-bold text-red-700">🚨 <T k="코드 호출" /></h3>
        {result ? (
          <div className="space-y-3" data-code-call-result={result.id}>
            <p className="text-sm font-semibold text-gray-900">
              <Tf k="발신됨 — 앱 알림 {n}명 · 푸시 {f}건" params={{ n: result.delivered, f: result.fcmSent ?? 0 }} />
            </p>
            <p className="text-xs text-gray-500"><T k="보낸 것이지 받은 것이 아닙니다 — 응답은 알림에서 확인합니다" /></p>
            {codeType === 'CODE_BLUE' && (
              <Link href={`/code-blue?staffCallId=${result.id}&location=${encodeURIComponent(location.trim())}`} data-code-call-record
                className="flex min-h-[48px] items-center justify-center rounded-xl bg-red-600 text-sm font-bold text-white">
                <T k="소생 기록 시작" /> →
              </Link>
            )}
            <button type="button" onClick={onClose} className="min-h-[44px] w-full rounded-xl bg-gray-100 text-sm text-gray-700"><T k="닫기" /></button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2" role="radiogroup" aria-label={tAttr('코드 종류')}>
              {CODE_CALL_TYPES.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={codeType === c} onClick={() => { setCodeType(c); setConfirming(false); }} data-code-type={c}
                  className={`min-h-[52px] rounded-xl border-2 text-sm font-bold ${codeType === c ? (c === 'CODE_BLUE' ? 'border-blue-700 bg-blue-700 text-white' : c === 'CODE_RED' ? 'border-red-600 bg-red-600 text-white' : 'border-gray-700 bg-gray-700 text-white') : 'border-gray-200 bg-white text-gray-700'}`}>
                  {tAttr(CODE_CALL_LABEL[c])}
                </button>
              ))}
            </div>
            <input value={location} onChange={(e) => { setLocation(e.target.value); setConfirming(false); }} aria-label={tAttr('위치')} data-code-location
              placeholder={tAttr('위치 (예: 본관 5층 503호)')} className="min-h-[48px] w-full rounded-xl border px-3 text-sm" />
            <p className="text-[11px] text-gray-500"><T k="전 직원에게 갑니다 · 환자 정보는 보내지 않습니다(위치만)" /></p>
            {error && <p className="text-sm text-red-700" data-code-call-error>{error}</p>}
            {!confirming ? (
              <button type="button" disabled={!ready} onClick={() => setConfirming(true)} data-code-call-send
                className="min-h-[52px] w-full rounded-xl bg-red-600 text-base font-bold text-white disabled:opacity-40">
                <T k="발신" />
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={send} data-code-call-confirm
                className="min-h-[56px] w-full animate-pulse rounded-xl bg-red-700 text-base font-bold text-white">
                {busy ? <T k="발신 중…" /> : <Tf k="{c} 지금 발신 — 한 번 더 눌러 확인" params={{ c: codeType ? tAttr(CODE_CALL_LABEL[codeType]) : '' }} />}
              </button>
            )}
            <button type="button" onClick={onClose} className="min-h-[44px] w-full rounded-xl bg-gray-100 text-sm text-gray-700"><T k="취소" /></button>
          </div>
        )}
      </div>
    </div>
  );
}
