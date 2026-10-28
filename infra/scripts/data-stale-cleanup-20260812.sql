-- ═══════════════════════════════════════════════════════════════════════════
-- 방치 데이터 종결 — 2026-08-12
--
-- 화면 점검(W1·W2)에서 반복 확인된 것: **날짜/상태 기반 화면은 '지금'만 보므로,
-- 종결되지 않은 업무는 어느 화면에도 뜨지 않고 조용히 쌓인다.**
-- 불변식 48·48b·48c·48d 로 가시화한 것들을 실제로 닫는다.
--
-- 🔴 지키는 원칙(2026-08-03 정합성 교정 트랙에서 확립)
--    ① **임상 내용 날조 금지** — 하지 않은 치료를 "완료"로 만들지 않는다
--    ② **추정 금지** — 모르는 시각을 그럴듯하게 채우지 않는다
--    ③ 닫을 때는 **닫았다는 사실과 이유**를 데이터에 남긴다(사후 추적 가능하게)
--
-- 손대지 않는 것:
--   · **DRAFT 진료 109건** — `EncounterStatus` 에 취소/폐기 상태가 아예 없다.
--     서명은 임상 내용이라 대신 할 수 없다. DRAFT 로 남은 것 자체가 정확한 사실이다.
--   · therapy_orders.completed_at — 시행하지 않은 치료를 완료로 만들지 않는다.
--     상위 오더를 취소해 큐에서 빠지게 한다.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

\echo '── 적용 전 ──'
SELECT '치료 THERAPY 오더(30d+ ORDERED)' AS 항목, count(*) AS 건수 FROM orders
  WHERE status = 'ORDERED' AND department = 'THERAPY' AND created_at < current_date - interval '30 days'
UNION ALL SELECT '식사 오더(7d+ 미처리)', count(*) FROM meal_orders
  WHERE status IN ('ORDERED', 'PREPARED') AND date < current_date - interval '7 days'
UNION ALL SELECT 'PACU 재실(24h+)', count(*) FROM pacu_records
  WHERE discharge_time IS NULL AND arrival_time < now() - interval '24 hours';

-- ───────────────────────────────────────────────────────────────────────────
-- 1. 치료 오더 — 예정일이 한참 지난 미시행 건을 **취소**한다(완료 아님)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _stale_therapy AS
SELECT o.id AS order_id, o.prescription_id
FROM orders o
WHERE o.status = 'ORDERED'
  AND o.department = 'THERAPY'
  AND o.created_at < current_date - interval '30 days';

UPDATE orders o
SET status = 'CANCELLED',
    cancelled_at = now(),
    notes = concat_ws(' · ', nullif(o.notes, ''),
      '[2026-08-12 데이터 정리] 예정일 30일 초과 미시행 — 취소 처리(시행 기록 없음)')
FROM _stale_therapy s
WHERE o.id = s.order_id;

-- 처방도 함께 닫는다 — 오더만 취소하면 ACTIVE 처방이 남아 치료 큐에 계속 뜬다
UPDATE prescriptions p
SET status = 'CANCELLED'
FROM _stale_therapy s
WHERE p.id = s.prescription_id AND p.status = 'ACTIVE';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. 식사 오더 — 배식일이 지난 미처리 건을 **미배식(UNDELIVERED)** 으로
--    (테이블에 사유 컬럼이 있어 이유를 남길 수 있다)
-- ───────────────────────────────────────────────────────────────────────────
UPDATE meal_orders
SET status = 'UNDELIVERED',
    undelivered_reason = coalesce(nullif(undelivered_reason, ''),
      '[2026-08-12 데이터 정리] 배식일 경과 — 미배식으로 종결(배식 기록 없음)')
WHERE status IN ('ORDERED', 'PREPARED')
  AND date < current_date - interval '7 days';

-- ───────────────────────────────────────────────────────────────────────────
-- 3. PACU — 24시간 넘게 '재실'인 기록을 닫는다.
--    🔴 **퇴실 시각을 지어내지 않는다.** 실제 퇴실 시각은 아무도 모른다.
--       `discharge_time` 은 닫은 시각(now)으로 두고, `discharge_override` 로
--       "정상 퇴실 절차가 아님"을 표시하며, notes 에 사실을 적는다.
--       (체류시간 통계가 왜곡되지 않도록 override 건은 화면에서 제외한다 — 후속 코드 과제)
-- ───────────────────────────────────────────────────────────────────────────
--    🔴 `disposition`(HOME/WARD)도 **건드리지 않는다** — 귀가했는지 병동으로 갔는지
--       기록이 없다. 그럴듯한 값을 넣으면 없는 사실을 만드는 것이다.
UPDATE pacu_records
SET discharge_time = now(),
    discharge_override = true,
    notes = concat_ws(' · ', nullif(notes, ''),
      '[2026-08-12 데이터 정리] 24시간 초과 재실 — 퇴실 처리. 실제 퇴실 시각·행선지 불명(추정하지 않음)')
WHERE discharge_time IS NULL
  AND arrival_time < now() - interval '24 hours';

\echo '── 적용 후 ──'
SELECT '치료 THERAPY 오더(30d+ ORDERED)' AS 항목, count(*) AS 잔여 FROM orders
  WHERE status = 'ORDERED' AND department = 'THERAPY' AND created_at < current_date - interval '30 days'
UNION ALL SELECT '식사 오더(7d+ 미처리)', count(*) FROM meal_orders
  WHERE status IN ('ORDERED', 'PREPARED') AND date < current_date - interval '7 days'
UNION ALL SELECT 'PACU 재실(24h+)', count(*) FROM pacu_records
  WHERE discharge_time IS NULL AND arrival_time < now() - interval '24 hours'
UNION ALL SELECT '(참고) 손대지 않은 DRAFT 진료 30d+', count(*) FROM encounters
  WHERE status = 'DRAFT' AND created_at < current_date - interval '30 days';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. 마취 종류 표기 통일 (한글 → 표준 코드)
--
--    의미가 1:1 로 대응하므로 **정보가 더해지거나 사라지지 않는다**(표현 통일).
--    표시는 shared `anesthesiaText` 가 이미 양쪽을 받지만, 저장까지 갈라두면
--    통계·필터가 두 값을 따로 세게 된다.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE surgeries SET anesthesia_type = 'GENERAL'  WHERE anesthesia_type = '전신마취';
UPDATE surgeries SET anesthesia_type = 'LOCAL'    WHERE anesthesia_type = '국소마취';
UPDATE surgeries SET anesthesia_type = 'SPINAL'   WHERE anesthesia_type = '척추마취';
UPDATE surgeries SET anesthesia_type = 'EPIDURAL' WHERE anesthesia_type = '경막외마취';
UPDATE surgeries SET anesthesia_type = 'SEDATION' WHERE anesthesia_type = '수면마취';
UPDATE surgeries SET anesthesia_type = 'REGIONAL' WHERE anesthesia_type = '부분마취';
UPDATE surgeries SET anesthesia_type = 'NONE'     WHERE anesthesia_type = '무마취';

\echo '── 마취 표기 잔여(코드 아닌 것) ──'
SELECT anesthesia_type, count(*) FROM surgeries
  WHERE anesthesia_type IS NOT NULL AND anesthesia_type !~ '^[A-Z_]+$'
  GROUP BY 1;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 **손대지 않기로 판정한 것** — 전부 "사람이 해야 하는 행위"이기 때문이다.
--    닫는 것이 곧 "했다"는 뜻이 되므로, 대신 해주면 기록이 거짓이 된다.
--
--  · 검사결과 검증 대기 252건 — 검증은 판독·확인이라는 **임상 행위**다.
--      (2026-08-03 교정 트랙에서도 `lab COMPLETED = 검증 전 정상` 으로 오탐 판정된 항목)
--  · 협진 의뢰 회신 대기 5건 — 회신은 상대 진료과의 **임상 판단**이다.
--  · DRAFT 진료 109건 — 서명은 작성 의사의 행위이고, 애초에 취소 상태값도 없다.
--  · 서명된 진료인데 진단 없음 79건 — 진단 입력은 임상 내용이다(HIM 미비기록으로 노출 중).
--  · 알림 미읽음 19건 — '읽음'은 수신자의 행위다. 임의 처리하면 통보 이력이 왜곡된다.
--  · 수술 예정시각 ≠ 배정시각 2건(불변식 49) — 어느 쪽이 참인지 기록만으로 알 수 없다.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. 오기록된 노쇼 교정 — 2026-08-13
--
-- 🔴 자동 노쇼 스윕이 **접수 여부를 보지 않아** 온 환자를 "안 왔다"로 기록했다.
--    (주석은 처음부터 '미접수 → NO_SHOW' 라고 밝히고 있었는데 구현에 그 조건이 없었다)
--
-- 이건 **추정이 아니라 파생 복원**이다 — 그 예약에 연결된 접수(waiting_queue)가
-- `COMPLETED` 라는 사실이 이미 기록돼 있다. 접수를 마친 예약은 노쇼가 아니다.
--    · 접수가 COMPLETED  → 예약도 COMPLETED
--    · 접수가 진행 중     → 예약은 CHECKED_IN
-- 🔴 접수 기록이 없는 노쇼는 **건드리지 않는다**(정말 안 왔을 수 있다).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE appointments a
SET status = 'COMPLETED'
FROM waiting_queue w
WHERE w.appointment_id = a.id
  AND a.status = 'NO_SHOW'
  AND w.status = 'COMPLETED';

UPDATE appointments a
SET status = 'CHECKED_IN'
FROM waiting_queue w
WHERE w.appointment_id = a.id
  AND a.status = 'NO_SHOW'
  AND w.status IN ('WAITING', 'CALLED', 'IN_CONSULTATION', 'CASHIER_WAITING');

\echo '── 교정 후: 접수 기록이 있는데 여전히 노쇼 ──'
SELECT count(*) FROM appointments a JOIN waiting_queue w ON w.appointment_id = a.id
  WHERE a.status = 'NO_SHOW';

COMMIT;
