/**
 * 재시도·멱등 계측 기준선(2026-09-16 J4) — 정본 스캐너 `idempotency-scan.ts`.
 *
 * 🔴 **이 수는 '결함 수'가 아니다.** 처음 한 번만 만들 수 있는 생성 EP, 상태 전이가 두 번째 호출을 막는 자리,
 *    자연키에 DB 유니크가 걸린 자리가 섞여 있다. 지키는 것은 **조용히 늘지 않는다** 하나다.
 * 🔴 가드 판정은 **메서드 단위**라 한 메서드가 A는 막고 B는 안 막는 경우를 구분하지 못한다 —
 *    항암 `startCycle` 이 그랬다(사이클 전이는 막는데 교차 서비스 조제 지시는 안 막았다).
 *    그래서 이 목록은 **보호의 상한**이지 확정이 아니다.
 * 🔴 **DB 유니크 제약은 이 스캐너가 보지 못한다.** 무방비 자리 한 건씩 판정은 **문서가 아니라 코드**에 있다 —
 *    `idempotency-judgment.ts`(스키마 유니크·nullability, 메서드 본문 앵커, 호출부 0, 결정 등록부 키를 기계 대조).
 *    종전 파일별 무방비 수(`IDEMPOTENCY_UNGUARDED_BASELINE`)는 그 등록부로 **대체**했다(정본이 둘이면 갈라진다).
 *
 * 이력:
 *   2026-09-16 J4  최초 94 / 무방비 34
 *   2026-09-16 K2  96 / 무방비 32 — 총계 +2 는 스캐너가 더 보게 된 것(반환 타입 `{` 에 걸려 두 메서드가 안 보였다).
 *                  무방비 −2 는 실제 봉합(특수영양 처방 · NIMS 적재).
 *   2026-09-28 재판정 a13360  **97 / 무방비 32** — 델타를 항목별로 가른다(합쳐 적으면 봉합과 착시가 섞인다):
 *     총계 −1 · 무방비 ±0 : **허수 제거** — 메서드 경계 정규식이 모듈 최상위 함수 안의 `  if (…)` 를 메서드로 읽어
 *        `checkup.service.ts` `method:'if'` 한 줄(가드 있음)이 올라 있었다. 🔴 줄어든 것이 봉합이 아니다.
 *     총계 +2 · 무방비 +1 : **가려져 있던 것** — 결과 모델 목록에 CSSD 재고 원장 `supplyTransaction` 이 빠져 있었다.
 *        새로 보인 둘: `cssd-po.receive`(이번에 봉합 → 가드 있음) · `cssd-inventory.tx`(원장 헬퍼 → 무방비·판정 helperCallerOwned).
 *        (트랜잭션 클라이언트 이름 `tx\w*` 확장은 오늘 기준 추가 0건 — 유일한 `txc` 가 이번 봉합으로 `tx` 가 됐다. 대조군이 픽스처로 지킨다.)
 *     무방비 −1 : **실제 봉합** — `claim.generateClaims`(동시 호출이 같은 수납에 청구 두 벌 = 보험 이중청구 ·
 *        면제 근거였던 `claimNumber @unique` 는 `String?` 이고 채워지지도 않았다). 잠금 + 잠근 뒤 재확인.
 *     🔴 재고 문서 4자리(발주·부서청구·소분·실사)는 채번 충돌(P2002 → 500)을 봉합했지만 **무방비로 남긴다** —
 *        번호 충돌을 없앤 것이지 중복 제출을 막은 것이 아니다(결정 등록부 `policy.inventory.duplicateSubmit`).
 *        중단된 원 작업은 채번의 `count` 를 선검사로 세게 해 무방비 −4 를 "봉합"으로 적었다 — 그렇게 세면 기준선이 거짓으로 준다.
 *   2026-09-30  **98 / 무방비 32** — 총계 +1 · 무방비 ±0 : 처방 갱신 `prescription.renew`(새 처방 생성) — 원처방의 조건부 중단
 *        (`updateMany where status=ACTIVE` · 0건이면 409 로 새 처방을 만들지 않음)이 가드다. 재시도는 두 번째 호출이 409.
 */
export const IDEMPOTENCY_TOTAL_BASELINE = 104; // 103→104 2026-10-22 중간정산 환불 원장 줄 refundInterimBilling(ERP R5 · 회차 행 FOR UPDATE 뒤 누적 ≤ 수납액 — 🔴 같은 요청 재전송은 상한 안에서 두 번째 환불이 될 수 있다(멱등 키 없음 · 화면은 처리 중 단추 잠금) · 무방비 판정 수 그대로) · 102→103 2026-10-22 중간정산 수납 원장 줄 payInterimBilling(같은 트랜잭션의 상태 조건부 updateMany 가 한 번만 통과 — 무방비 수 그대로) · 101→102 2026-10-14 비대면 진료 취소 환불 원장 줄 refundAndCancel(P3-1 · 같은 트랜잭션의 상담 조건부 updateMany 가 한 번만 통과 — 무방비 수 그대로) · 100→101 2026-10-14 환불 원장 줄 recordRefundLine(P1-5 · 호출부 조건부 updateMany 가 재시도를 막는다 — 판정 helperCallerOwned) · 99→100 2026-10-10 서류 수수료 수납 줄 addNonCoveredLine — 같은 서류 요청 id 줄이 있으면 ALREADY(선행 조회 preCheck · 무방비 수 그대로) · 98→99 2026-10-01 아웃박스 대상 지정 적재 enqueueDirect — 유니크(domain,ref)+조건부 되살림이라 무방비 아님(무방비 수 그대로)
export const IDEMPOTENCY_UNGUARDED_TOTAL = 33; // 32→33 2026-10-14 recordRefundLine — 헬퍼라 스캐너가 무방비로 센다 · 판정 등록부에 helperCallerOwned 로 등재

/**
 * 🔴 **봉합한 자리가 무방비로 돌아오면 실패한다**(파일 단위가 아니라 메서드 단위 — 같은 파일에 정당한 무방비가
 *    함께 사는 자리가 있어 파일 수만으로는 되돌아온 것을 못 잡는다). 스캐너가 그 자리를 **아예 못 보게 된 것**도
 *    실패로 본다(리팩터가 계측을 가리는 것 — 캠페인 사각 #9).
 */
export const IDEMPOTENCY_SEALED_METHODS: ReadonlyArray<readonly [string, string]> = [
  ['chemo/chemo.service.ts', 'startCycle'], // J4
  ['voucher/voucher.service.ts', 'issueBatch'], // J4
  ['controlled-substance/controlled-substance.service.ts', 'enqueueNims'], // K2
  ['billing/billing.service.ts', 'createInpatientStayBilling'], // K2
  ['nutrition/nutrition-advanced.service.ts', 'createSpecialNutrition'], // K2
  ['claim/claim.service.ts', 'generateClaims'], // 2026-09-28 a13360
  ['cssd/cssd-po.service.ts', 'receive'], // 2026-09-28 a13360
  ['insurance-claim/insurance-claim.service.ts', 'create'], // 2026-09-28 a13360(잠금 안으로 옮긴 선검사)
];
