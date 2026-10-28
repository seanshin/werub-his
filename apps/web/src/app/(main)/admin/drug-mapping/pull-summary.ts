/**
 * `POST /api/v1/billing/drug-mapping/pull-confirmed` 응답 — 서버 `BillingService.pullConfirmedDrugCodes` 와 한 벌.
 *
 * 🔴 (2026-09-23 · 생태계 인바운드 §23 회수) 종전 화면은 `{ pulled, updated }` 만 읽고 "ERP 확정 N건 백필" 초록
 *    토스트 한 줄을 띄웠다. 서버는 형식 거부(`rejected`)를 **버렸고**, 화면은 HIS 미존재(`notFound`)를 받고도 **안 읽었다**.
 *    ERP 가 3건을 보내고 1건만 반영돼도 운영자는 "1건 백필"만 봤다 — 나머지 2건은 어디에도 없었다.
 *
 *    화면은 여기서 나온 **수**(분모·미반영 갈래)를 i18n 보간(`tfAttr`/`<Tf>`)에 넣어 그린다 — 문장은 카탈로그가 갖는다.
 */
export interface PullResult {
  /** ERP 가 보낸 행 수(키 누락 포함) — 분모 */
  received?: number;
  /** 키가 갖춰져 검증에 들어간 행 수 */
  pulled: number;
  /** MedicationCode.insuranceCode 가 실제로 갱신된 행 수 */
  updated: number;
  /** HIS 약품코드가 없어 갱신 0 행이었던 코드 */
  notFound?: string[];
  /** 보험코드 형식(8~13자리 숫자) 검증에서 거부된 `code:insuranceCode` */
  rejected?: string[];
  /** 코드·보험코드 중 하나가 비어 들어온 행 `code:insuranceCode`(빈 자리는 `?`) */
  malformed?: string[];
  /** ERP 미설정·HTTP 오류·네트워크 — 이 값이 있으면 위 수치는 전부 0(당기지 못한 것이지 0건 반영이 아니다) */
  reason?: string;
}

export interface PullSummary {
  /** 분모 — 서버가 `received` 를 안 주면 `null`(모르는 값을 `pulled` 로 대신 말하지 않는다) */
  denom: number | null;
  updated: number;
  rejected: number;
  malformed: number;
  notFound: number;
  /** 거부+누락+미존재 */
  unapplied: number;
  reason?: string;
}

export function summarizePull(r: PullResult): PullSummary {
  const rejected = r.rejected?.length ?? 0;
  const malformed = r.malformed?.length ?? 0;
  const notFound = r.notFound?.length ?? 0;
  return {
    denom: typeof r.received === 'number' ? r.received : null,
    updated: r.updated ?? 0,
    rejected,
    malformed,
    notFound,
    unapplied: rejected + malformed + notFound,
    ...(r.reason ? { reason: r.reason } : {}),
  };
}
