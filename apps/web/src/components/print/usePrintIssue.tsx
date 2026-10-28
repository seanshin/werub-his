'use client';

import { useState } from 'react';
import { apiClient, ApiError } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { sanctionedPrint } from '@/components/print/PrintGuard';
import { sha256Hex } from '@/components/print/PrintSheet';
import type { ServerBuiltDocumentType } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 서버 발급 인쇄본 흐름 — 2026-10-12 기획 `decision-print-remaining` P0-6·P1(결정 대장·의사결정서·개시 브리핑·당직표·QI 보고서).
 *
 * 🔴 종전엔 인쇄 버튼이 브라우저 안에서 해시·QR 을 만들고 바로 찍었다 — 어디에도 남지 않아 QR 을 찍어도 대조할 곳이 없었다.
 *  1. 인쇄 → 서버가 지금 원장에서 발급(발급번호·해시·진위확인 주소)
 *  2. 🔴 화면 줄의 해시 ≠ 서버 해시 → **인쇄하지 않는다**(원장이 그 사이 바뀌었다 — 새로 불러오게)
 *  3. 발급 실패 → **인쇄하지 않는다.** 이유를 말하고 "미발급 미리보기"를 고를 수 있다(워터마크·QR 없음)
 *  4. 쪽마다 QR 이 만들어진 뒤에 인쇄 대화상자를 연다(QR 이 비어 찍히지 않게)
 */
export interface IssuedPrint { issueNo: string; hash: string; verifyUrl: string; issuedAt: string }
type Phase = 'idle' | 'issuing' | 'failed';

/** 쪽 QR 이 준비될 때까지 기다린다 — 실패·시간 초과도 그대로 알린다(빈 QR 로 찍지 않는다) */
function waitQr(timeoutMs = 4000): Promise<'ready' | 'failed' | 'timeout'> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      const s = document.querySelector('style[data-print-page-qr]')?.getAttribute('data-print-page-qr');
      if (s === 'ready' || s === 'failed') return resolve(s);
      if (Date.now() - t0 > timeoutMs) return resolve('timeout');
      setTimeout(tick, 50);
    };
    tick();
  });
}

/** `params` — 서버가 같은 문서를 다시 만들 조건(결정 키·월·부서·보고서 id) · `lines` — 화면이 그리는 정본 줄(shared 같은 함수) */
export function usePrintIssue(kind: ServerBuiltDocumentType, params: { key?: string; month?: string; department?: string; reportId?: string }, lines: string[], onStale?: () => void) {
  const tAttr = useTAttr();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<{ text: string; stale?: boolean } | null>(null);
  const [issued, setIssued] = useState<IssuedPrint | null>(null);
  const [unissued, setUnissued] = useState(false);

  const start = async () => {
    if (phase === 'issuing') return;
    setPhase('issuing'); setError(null); setUnissued(false);
    try {
      const r = await apiClient.post<{ data: IssuedPrint & { lines: number } }>('/api/v1/print-issue', { kind, ...params });
      const local = await sha256Hex(lines.join('\n'));
      if (!local || local !== r.data.hash) {
        // 🔴 화면이 그리는 줄과 서버가 동결한 줄이 다르다 — 이 종이는 발급 원장과 맞지 않는다
        setIssued(null);
        setError({ text: tAttr('화면 자료가 발급 시점 원장과 다릅니다 — 그 사이 결정이 바뀌었습니다. 새로 불러온 뒤 다시 인쇄하세요. (발급번호는 원장에 남았습니다: {issueNo})').replace('{issueNo}', r.data.issueNo), stale: true });
        setPhase('failed');
        return;
      }
      setIssued(r.data);
      const qr = await waitQr();
      if (qr !== 'ready') {
        setError({ text: tAttr('진위확인 QR 을 만들지 못해 인쇄하지 않았습니다. 다시 시도하세요.') });
        setPhase('failed');
        return;
      }
      setPhase('idle');
      sanctionedPrint(`issue:${r.data.issueNo} type:${kind} sha:${r.data.hash.slice(0, 16)}`);
    } catch (e) {
      const forbidden = e instanceof ApiError && e.code === 'ERR_FORBIDDEN';
      setError({ text: forbidden
        ? tAttr('발급 권한이 없습니다(인쇄본 발급은 관리자). 미발급 미리보기만 인쇄할 수 있습니다.')
        : `${tAttr('발급하지 못해 인쇄하지 않았습니다')} — ${e instanceof ApiError ? extractErrorMessage(e) : (e as Error)?.message ?? ''}` });
      setPhase('failed');
    }
  };

  /** 미발급 미리보기 — 워터마크 "미발급 — 진위확인 불가" · QR 없음 · 감사에 unissued 로 남긴다 */
  const printUnissued = () => {
    setIssued(null); setUnissued(true); setError(null); setPhase('idle');
    requestAnimationFrame(() => requestAnimationFrame(() => sanctionedPrint(['unissued', kind, ...Object.values(params).filter(Boolean)].join(':').slice(0, 200))));
  };

  const bar = (error || phase === 'issuing') ? (
    <div className="print:hidden rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-900" role="status" data-print-issue-state={phase}>
      {phase === 'issuing' ? <T k="발급 중 — 발급번호를 받으면 인쇄합니다…" /> : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1 min-w-[240px]">{error!.text}</span>
          {error!.stale && onStale && (
            <button onClick={() => { setError(null); setPhase('idle'); onStale(); }} className="min-h-[36px] rounded-lg border border-amber-300 bg-white px-3 font-semibold"><T k="새로 불러오기" /></button>
          )}
          <button onClick={printUnissued} className="min-h-[36px] rounded-lg border border-amber-300 bg-white px-3" data-print-unissued><T k="미발급 미리보기 인쇄" /></button>
        </div>
      )}
    </div>
  ) : null;

  /** 인쇄 문서에 넘길 발급 상태 — PrintDoc·결정 인쇄본이 같은 모양으로 받는다 */
  const state = { issued, unissued: unissued ? ('PREVIEW' as const) : null };
  return { start, issuing: phase === 'issuing', issued, unissued, state, bar };
}
