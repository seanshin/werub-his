-- 2026-08-19 전 UI 검토 후속 데이터 교정
--
-- 두 가지를 고친다. 둘 다 **코드 결함이 만든 거짓 기록**이지 시드 품질 문제가 아니다.
-- (시드 품질 결함은 데이터가 아니라 생성기를 고친다 — 이 저장소의 규칙.)
--
-- 🔴 원칙
--   · 근거를 지우지 않는다. 행을 삭제하지 않고 **사실이 아닌 부분만** 바로잡는다.
--   · 모르는 것을 지어내지 않는다. 실제 승인 정보는 없으므로 "없음"이라고 적는다.
--   · 실행 전 전제를 스스로 검사하고, 어긋나면 멈춘다(RAISE EXCEPTION).
--
-- 실행: docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun -v ON_ERROR_STOP=1 -f -

BEGIN;

-- ── 전제 확인 ─────────────────────────────────────────────────────────────
DO $$
DECLARE n_billing int; n_pay int; n_sess int;
BEGIN
  SELECT count(*) INTO n_billing FROM billings WHERE card_approval_no LIKE 'KIOSK-%';
  SELECT count(*) INTO n_pay     FROM billing_payments WHERE card_approval_no LIKE 'KIOSK-%';
  SELECT count(*) INTO n_sess    FROM agent_sessions
    WHERE channel = 'WEB_BOOKING' AND context::text LIKE '%allergies%';

  RAISE NOTICE '대상: billings=% billing_payments=% agent_sessions=%', n_billing, n_pay, n_sess;

  -- 실측(2026-08-19)과 크게 어긋나면 멈춘다 — 그 사이 무슨 일이 있었다는 뜻이다
  IF n_billing > 5 OR n_pay > 5 THEN
    RAISE EXCEPTION '날조 승인번호가 실측(각 1건)보다 많다: billings=% payments=% — 사람이 먼저 확인할 것',
      n_billing, n_pay;
  END IF;
END $$;

-- ── ① 키오스크가 지어낸 카드 승인번호 ────────────────────────────────────
-- `KIOSK-<timestamp>` 는 결제 단말이 준 승인번호가 아니라 **코드가 만든 문자열**이다.
-- PG·VAN 연동이 없으므로 실제 승인은 존재하지 않는다.
-- 🔴 행은 지우지 않는다(무슨 일이 있었는지가 증거다). 승인번호 자리만 사실대로 바꾼다.

UPDATE billing_payments
   SET card_approval_no = 'VOID-NO-PG-APPROVAL'
 WHERE card_approval_no LIKE 'KIOSK-%';

UPDATE billings
   SET card_approval_no = 'VOID-NO-PG-APPROVAL'
 WHERE card_approval_no LIKE 'KIOSK-%';

-- 🔴 수납 상태(PAID)는 **이 스크립트에서 되돌리지 않는다.**
--    되돌리면 미수금이 되살아나 회계·정산에 영향이 간다. 그 판단은 원무·회계의 몫이다.
--    대상은 아래 한 건뿐이며 시드 테스트 환자다(MRN SEED-ELIG-P010):
--      billing f3ab1437-ea2d-4117-9ea8-c0cfca3c475a · 5,190원 · 2026-07-05
--    승인번호가 'VOID-NO-PG-APPROVAL' 이면 실제 결제가 아니라는 뜻이므로 조회로 식별된다.

-- ── ② 공개 예약 세션에 남은 임상정보 ─────────────────────────────────────
-- 무인증 공개 채널(`/api/v1/booking/*`)이 알레르기·문제목록·최근 진료를 세션에 적재했다.
-- 조회 EP 도 공개라 세션 ID 만 알면 지금도 읽힌다(코드는 같은 날 봉합).
-- 🔴 세션 행 자체는 남긴다 — 언제 무엇이 있었는지가 기록이다. **임상 필드만** 제거한다.

UPDATE agent_sessions
   SET context = (context #- '{patient,allergies}' #- '{patient,problemList}' #- '{patient,lastEncounter}')
                 || jsonb_build_object('phiPurgedAt', to_jsonb(now()))
 WHERE channel = 'WEB_BOOKING'
   AND (context ? 'patient')
   AND (context::text LIKE '%allergies%' OR context::text LIKE '%problemList%' OR context::text LIKE '%lastEncounter%');

-- 대화 본문에 실린 환자 카드(알레르기·문제목록 줄)도 같은 이유로 가린다.
-- 🔴 메시지를 지우지 않고 **가려진 사실을 남긴다** — 대화가 있었다는 것 자체는 기록이다.
UPDATE agent_sessions
   SET messages = (
         SELECT jsonb_agg(
           CASE
             WHEN m->>'content' LIKE '%알레르기:%' OR m->>'content' LIKE '%문제목록:%' OR m->>'content' LIKE '%마지막 진료:%'
               THEN jsonb_set(m, '{content}',
                    to_jsonb('[임상정보 삭제됨 — 무인증 채널 노출분 2026-08-19 정리]'::text))
             ELSE m
           END
           ORDER BY ord)
         FROM jsonb_array_elements(messages) WITH ORDINALITY AS t(m, ord)
       )
 WHERE channel = 'WEB_BOOKING'
   AND jsonb_typeof(messages) = 'array'
   AND (messages::text LIKE '%알레르기:%' OR messages::text LIKE '%문제목록:%' OR messages::text LIKE '%마지막 진료:%');

-- ── 사후 확인 ─────────────────────────────────────────────────────────────
DO $$
DECLARE n_kiosk int; n_phi int; n_msg int;
BEGIN
  SELECT count(*) INTO n_kiosk FROM billings WHERE card_approval_no LIKE 'KIOSK-%';
  SELECT count(*) INTO n_phi FROM agent_sessions
    WHERE channel='WEB_BOOKING' AND (context::text LIKE '%allergies%' OR context::text LIKE '%problemList%');
  SELECT count(*) INTO n_msg FROM agent_sessions
    WHERE channel='WEB_BOOKING' AND messages::text LIKE '%알레르기:%';

  IF n_kiosk <> 0 OR n_phi <> 0 OR n_msg <> 0 THEN
    RAISE EXCEPTION '교정이 끝나지 않았다: kiosk=% phi=% msg=%', n_kiosk, n_phi, n_msg;
  END IF;
  RAISE NOTICE '교정 완료 — 날조 승인번호 0 · 세션 임상정보 0 · 대화 노출 0';
END $$;

COMMIT;
