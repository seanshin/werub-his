-- 2026-08-19 · 키오스크 날조 수납 1건 정리 (원무 승인)
--
-- 대상: billing f3ab1437-ea2d-4117-9ea8-c0cfca3c475a · 5,190원 · 2026-07-05
--       환자 SEED-ELIG-P010(자격검증 환자10 — 시드 테스트 환자)
--
-- 사실: PG·VAN 연동이 없는데 키오스크가 승인번호를 `KIOSK-<timestamp>` 로 지어내 수납을 확정했다.
--       **실제로 돈이 오간 적이 없다.** 따라서 이 청구는 미납이 맞다.
--
-- 🔴 무엇을 남기고 무엇을 지우는가
--   · `billing_payments` 행은 **삭제**한다 — 있지도 않은 결제를 주장하는 행이다.
--   · 그 사실은 `billings.cashier_note` 에 **원본 값과 함께** 남긴다(근거를 지우지 않는다).
--   · 상태는 PENDING 으로 되돌린다 — 받지 않은 돈을 받았다고 두지 않는다.

BEGIN;

DO $$
DECLARE b RECORD; n_pay int;
BEGIN
  SELECT * INTO b FROM billings WHERE id = 'f3ab1437-ea2d-4117-9ea8-c0cfca3c475a';
  IF NOT FOUND THEN RAISE EXCEPTION '대상 청구를 찾을 수 없다 — 사람이 먼저 확인할 것'; END IF;

  -- 전제: 이미 정리된 상태(VOID 표기)여야 한다. 다르면 그 사이 무슨 일이 있었다는 뜻이다.
  IF b.card_approval_no IS DISTINCT FROM 'VOID-NO-PG-APPROVAL' THEN
    RAISE EXCEPTION '승인번호가 예상과 다르다(%): 1차 교정 이후 변경된 것 — 멈춘다', b.card_approval_no;
  END IF;
  IF b.status <> 'PAID' THEN
    RAISE EXCEPTION '상태가 PAID 가 아니다(%) — 이미 정리됐거나 다른 변경이 있었다', b.status;
  END IF;

  SELECT count(*) INTO n_pay FROM billing_payments WHERE billing_id = b.id;
  RAISE NOTICE '대상 확인 — 청구 %원 · 수납행 %건', b.paid_amount, n_pay;

  DELETE FROM billing_payments WHERE billing_id = b.id;

  UPDATE billings
     SET status = 'PENDING',
         paid_at = NULL,
         paid_amount = 0,
         payment_method = NULL,
         card_approval_no = NULL,
         cashier_note = concat_ws(E'\n',
           nullif(b.cashier_note, ''),
           '[2026-08-19 정리] 키오스크가 PG 연동 없이 승인번호를 생성해 수납을 확정한 건 —'
           || ' 실제 결제가 없었으므로 미납으로 되돌림.'
           || ' 원본: status=PAID, paid_amount=' || coalesce(b.paid_amount::text,'-')
           || ', payment_method=' || coalesce(b.payment_method,'-')
           || ', card_approval_no=KIOSK-1783218955594(날조), paid_at=' || coalesce(b.paid_at::text,'-')
           || '. 근거: kiosk.service.ts:82 (2026-08-19 봉합).')
   WHERE id = b.id;
END $$;

-- 사후 확인 — 되돌아갔는가
DO $$
DECLARE st text; amt int; n int;
BEGIN
  SELECT status, paid_amount INTO st, amt FROM billings WHERE id='f3ab1437-ea2d-4117-9ea8-c0cfca3c475a';
  SELECT count(*) INTO n FROM billing_payments WHERE billing_id='f3ab1437-ea2d-4117-9ea8-c0cfca3c475a';
  IF st <> 'PENDING' OR coalesce(amt,0) <> 0 OR n <> 0 THEN
    RAISE EXCEPTION '정리가 끝나지 않았다: status=% paid=% payments=%', st, amt, n;
  END IF;
  RAISE NOTICE '정리 완료 — status=PENDING · paid_amount=0 · 수납행 0 · 사유는 cashier_note 에 보존';
END $$;

COMMIT;
