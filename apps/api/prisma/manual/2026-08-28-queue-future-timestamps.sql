-- 🔴 미래 시각의 대기열 기록 교정 (2026-08-28)
--
-- 실측 234건: `checked_in_at`·`called_at`·`started_at`·`completed_at` 이 **현재보다 뒤**였다.
-- 원인은 데이터가 아니라 **도구**다 — 데모 롤포워드가 일 단위로만 옮겨서,
-- 원래 시각이 지금보다 늦은 행은 이동 후 "오늘의 미래"가 됐다.
-- 접수·호출·진료시작·완료는 *일어난 일*의 시각이라 미래일 수 없다.
--
-- 🔴 **파생값 복원이지 임상 내용 날조가 아니다** — 도구가 잘못 만든 오프셋을 되돌릴 뿐이고,
--    되돌리는 방식은 고친 도구가 앞으로 하는 것과 **동일**하다(하루 되돌리기).
--    `now()` 로 잘라 붙이지 않는다 — 여러 행이 같은 시각에 쌓여 순서가 사라진다.
-- 🔴 예약(`appointments.scheduled_at`)은 건드리지 않는다 — 미래 예약이 정상이다.
BEGIN;

-- 최대 3회 — 롤이 여러 번 돌아 이틀 이상 미래로 간 행이 있을 수 있다(0 이 되면 멈춘다)
DO $$
DECLARE n integer; i integer := 0;
BEGIN
  LOOP
    UPDATE waiting_queue SET
      checked_in_at = checked_in_at - interval '1 day',
      called_at     = called_at     - interval '1 day',
      started_at    = started_at    - interval '1 day',
      completed_at  = completed_at  - interval '1 day',
      created_at    = created_at    - interval '1 day'
    WHERE checked_in_at > now() OR called_at > now() OR started_at > now() OR completed_at > now();
    GET DIAGNOSTICS n = ROW_COUNT;
    i := i + 1;
    EXIT WHEN n = 0 OR i >= 3;
  END LOOP;
  RAISE NOTICE '대기열 미래 시각 교정 — 반복 %회', i;
END $$;

COMMIT;
