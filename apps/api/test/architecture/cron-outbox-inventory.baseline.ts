/**
 * 크론 실패 처리 기준선 — 2026-09-16 E4 실측.
 *
 * 분모 59개(@Cron 핸들러). 분류는 **catch 블록 안**을 본다.
 *   swallows 2 · unhandled 36 · logsOnly 20 · recorded 1
 *
 * 🔴 **줄이는 방향으로만 고친다.** 늘면 가드가 실패하고, 줄이면 이 값을 내리는 커밋을 강제한다.
 */

// 2026-10-02 +1 `command-center-kpi-snapshot`(상황판 지표 이력 5분 · 기록 실패는 logger.error·칸은 추세선에서 끊긴다)
export const CRON_TOTAL_BASELINE = 63; // 62→63 데모 환자 이동 시뮬레이터 2026-10-09(2분마다 · REAL·데모 꺼짐이면 돌지 않음 · 실패는 로그 후 다음 주기) · 60→62 QI 흐름 2026-10-08 — 재원일수 스냅샷(매일 00:10)·질 지표 월 마감(매월 1일 06:30 · 설정 qi.autoMeasure.enabled 켜졌을 때만) · 둘 다 실패를 로그로 남기고 다음 실행에 맡긴다

/**
 * 실패를 삼키는 크론 — **남은 2건은 한 건씩 읽고 정당하다고 판단한 것**이다(억지로 0 을 만들지 않는다).
 *
 *  · `audit.service.ts` flushPendingAudit — 실패한 항목을 Redis 큐 뒤로 되돌리는 `rpush` 의 `.catch`.
 *    되돌리기가 실패해도 **본 실패는 바로 위에서 logger.error 로 남고**, 재시도 상한(AUDIT_FLUSH_MAX_TRIES)과
 *    poison message 격리가 이미 있다.
 *  · `data-quality.service.ts` captureSnapshot — 보존기간 경과분 `deleteMany` 의 `.catch`(정리 작업).
 *    스냅샷 저장 실패는 별도로 `failed[]` + logger.warn 으로 남는다.
 *
 * 🔴 설정 조회 폴백(`config.get(...).catch(() => null)`)은 스캐너가 제외한다 —
 *    문서화된 규약이고, 섞으면 진짜 작업 경로의 삼킴이 묻힌다.
 */
export const CRON_SWALLOW_BASELINE: Record<string, number> = {
  'modules/audit/audit.service.ts': 1,
  'modules/data-quality/data-quality.service.ts': 1,
};

/**
 * try/catch 가 없는 크론 — 실패가 스케줄러로 새어 unhandledRejection 으로만 보인다.
 *
 * 🔴 **이 36건이 결함 36건이라는 뜻이 아니다.** 부수적 정리·집계는 이것으로 충분하고,
 *    되돌릴 수 없는 일을 하는 것만 한 건씩 봐야 한다(E4 는 검진권 만료·오더 재봉인 두 건을 그렇게 골라 고쳤다).
 *    상한만 지킨다 — 새로 늘리지 않는다.
 */
export const CRON_UNHANDLED_TOTAL_BASELINE = 36;
