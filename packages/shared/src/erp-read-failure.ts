/**
 * ERP 읽기 실패 사유 — **정본 어휘**(ESS ↔ 급여시스템(ERP) 조회).
 *
 * 왜 shared 에 있는가: 서버(`ess.service.ts`)가 사유를 갈라 실어보내도 화면이 다른 어휘를 읽으면
 * 분기는 영원히 타지 않는다(2026-09-23 실측 — 서버는 4종으로 갈랐는데 web 어디에서도 `failure` 를 읽지 않았고,
 * 병행 갈래는 `ERP_AUTH_FAILED` 같은 자체 5종을 써서 서로 어긋났다). 어휘는 여기 하나, 양쪽이 가져다 쓴다.
 *
 * 🔴 실패는 "없음"이 아니다 — 목록 조회가 실패하면 `items: null`(산출 불가)이지 `items: []`(0건)이 아니다.
 *
 *   NOT_CONFIGURED  — `erp.webhookUrl` 미설정. 장애가 아니라 **설정 작업**(재시도 무의미)
 *   UNAUTHORIZED    — HTTP 401/403. 연동 키·대상 토큰 거부(재시도로 풀리지 않는다 — 키 교체)
 *   UPSTREAM_ERROR  — 그 외 비정상 HTTP 상태(5xx 등). ERP 쪽 장애
 *   UNREACHABLE     — 네트워크·DNS·타임아웃. 물어보지 못했다
 *   BAD_RESPONSE    — 200 인데 JSON 오브젝트가 아니다. 🔴 종전에는 `res.json()` 예외가 UNREACHABLE(망)로 새어
 *                     "닿지 못했다"고 거짓말했다 — 닿았고 답이 이상한 것은 다른 사실이라 어휘를 하나 더 두었다
 */
export const ERP_READ_FAILURES = ['NOT_CONFIGURED', 'UNAUTHORIZED', 'UPSTREAM_ERROR', 'UNREACHABLE', 'BAD_RESPONSE'] as const;
export type ErpReadFailure = (typeof ERP_READ_FAILURES)[number];

export function isErpReadFailure(v: unknown): v is ErpReadFailure {
  return typeof v === 'string' && (ERP_READ_FAILURES as readonly string[]).includes(v);
}

/** 다시 시도 버튼이 뜻이 있는 사유 — 설정·키 문제는 눌러도 풀리지 않는다(버튼이 거짓 희망이 된다) */
export function isErpFailureRetryable(f: ErpReadFailure | null | undefined): boolean {
  return f === 'UPSTREAM_ERROR' || f === 'UNREACHABLE' || f === 'BAD_RESPONSE';
}

/** ERP 를 읽지 못한 응답 봉투 — `available:false` 한 마디로 뭉개지 않고 사유·상류 상태를 함께 싣는다 */
export interface ErpReadUnavailable {
  available: false;
  /** 하위 호환 — 종전 화면이 읽던 굵은 사유. 세부는 `failure` */
  reason: 'ERP_UNAVAILABLE';
  failure: ErpReadFailure;
  /** ERP 가 HTTP 로 답한 경우 그 상태 코드 · 미설정/미도달이면 null */
  upstreamStatus: number | null;
}
