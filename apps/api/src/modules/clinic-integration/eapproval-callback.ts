/**
 * 전자결재 결과 → ERP 콜백 요청 정본(2026-10-01).
 *
 * 즉시 전달(`ErpEapprovalService.deliverCallback`)과 자동 재시도(`IntegrationOutboxService` 의 `EAPPROVAL` 포맷)가
 * **같은 본문·같은 서명·같은 egress 규칙**으로 나가야 한다 — 두 곳이 각자 만들면 갈라진다(재시도만 서명이 다르면 ERP 가 거부한다).
 * 계약: 본문 = 콜백 JSON 그대로(봉투 없음) · `X-Signature: sha256=<HMAC-SHA256(EAPPROVAL_CALLBACK_SECRET, 본문)>` ·
 *       허용 호스트 `EAPPROVAL_CALLBACK_HOSTS`(설정 시 강제) · 타임아웃 8초.
 */
import * as crypto from 'crypto';
import type { SafeFetchOptions } from '../../common/util/safe-fetch';

/** 아웃박스 행 구분 — 도메인·이벤트·포맷 */
export const EAPPROVAL_OUTBOX = { domain: 'eapproval', event: 'eapproval.callback', format: 'EAPPROVAL' } as const;

export function eapprovalCallbackRequest(raw: string, secret: string): RequestInit {
  const sig = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  return { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': sig }, body: raw };
}

export function eapprovalEgressOpts(hostsCsv: string | undefined | null): SafeFetchOptions {
  return {
    allowedHosts: (hostsCsv || '').split(',').map((s) => s.trim()).filter(Boolean),
    timeoutMs: 8000, // 원래 타임아웃이 없어 ERP 가 응답을 끌면 워커가 무한 대기했다
  };
}

/** 아웃박스 멱등 키 — 한 릴레이·한 결과에 한 행(같은 결과 재수신이 행을 늘리지 않는다) */
export function eapprovalOutboxRef(relayId: string, result: string): string {
  return `${relayId}:${result}`;
}
