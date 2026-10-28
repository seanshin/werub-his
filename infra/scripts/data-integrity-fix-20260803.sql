-- 데이터 정합성 교정 (2026-08-03) — 1회성. 실행 전 백업 필수.
--
-- 원칙
--   ① 파생 가능한 값만 복원한다(다른 컬럼에서 확정적으로 나오는 값).
--   ② **모르는 시각·행위자는 추정하지 않는다** — 원장에 영구 오기록이 남는다.
--   ③ 임상 내용(진단·SOAP·청구 라인)은 **절대 만들어내지 않는다**.
--   ④ 데모 전용 더미값 교체는 그 사실을 주석에 남긴다.
--
-- 적용 대상은 전부 운영 개시 전 시드·데모 데이터임을 실측으로 확인했다
-- (61건: 청구 노출 0·MAR 0·조제 0).

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- ① 파생 복원 — 추정 없음
-- ══════════════════════════════════════════════════════════════

-- [01] 취소된 오더의 처방이 ACTIVE 로 남아 있던 61건.
--      정책=연동 취소(같은 행위). 신규분은 order.service 가 처리하므로 여기선 과거분만.
UPDATE prescriptions p SET status = 'CANCELLED'
  FROM orders o
 WHERE o.prescription_id = p.id AND o.status = 'CANCELLED' AND p.status = 'ACTIVE';

-- [02] 반대 방향 잔여 — 처방은 취소인데 오더가 아직 대기(ORDERED)인 1건.
--      cancelled_at 은 **모르므로 넣지 않는다**(추정 금지). 상태만 정리.
UPDATE orders o SET status = 'CANCELLED'
  FROM prescriptions p
 WHERE p.id = o.prescription_id AND p.status = 'CANCELLED' AND o.status = 'ORDERED';

-- [10] 서명 진료의 서명자 누락 380건 — signed_at 은 있고 signed_by 만 비어 있었다.
--      담당의(doctor_id)가 곧 서명자이므로 **추정이 아니라 복원**이다.
--      (런타임 서명 경로는 정상. 시드 파일들이 signedBy 를 안 넣은 것)
UPDATE encounters SET signed_by = doctor_id
 WHERE status = 'SIGNED' AND signed_at IS NOT NULL AND signed_by IS NULL AND doctor_id IS NOT NULL;

-- [25] 검사 상태 규약: COMPLETED = 결과 입력 완료(검증 전), VERIFIED = 검증 완료.
--      COMPLETED 인데 검증 스탬프가 남은 15건은 검증 취소 후 스탬프가 안 지워진 잔재.
--      (런타임은 COMPLETED 로 되돌릴 때 verified_* 를 null 로 지운다 — 그 규약에 맞춘다)
UPDATE lab_results SET verified_at = NULL, verified_by = NULL
 WHERE status = 'COMPLETED' AND (verified_at IS NOT NULL OR verified_by IS NOT NULL);

-- ══════════════════════════════════════════════════════════════
-- ② 데모 더미값 교체 — 원본이 이미 임의값이라 정보 손실이 없다
-- ══════════════════════════════════════════════════════════════

-- [36] 생년월일이 미래인 환자 13명(P2026-14xx 배치·진료/검사 이력 0건인 순수 더미).
--      미래 DOB 는 나이가 음수로 계산돼 소아 용량·기준치·DUR 연령금기를 어긋나게 한다.
--      원래 값을 알 수 없고 알 필요도 없는 더미이므로 30년 과거로 옮긴다.
UPDATE patients SET date_of_birth = date_of_birth - interval '30 years'
 WHERE date_of_birth > current_date;

-- [17] 퇴원일이 입원일보다 빠른 1건 — 같은 날 입퇴원인데 퇴원이 자정(date-only)으로 들어갔다.
--      입원 시각으로 맞춘다(같은 날이라는 사실은 보존).
UPDATE admissions SET discharge_date = admit_date
 WHERE discharge_date IS NOT NULL AND discharge_date < admit_date
   AND discharge_date::date = admit_date::date;

COMMIT;

-- ══════════════════════════════════════════════════════════════
-- ③ 손대지 않는 것 — 이유를 남긴다
-- ══════════════════════════════════════════════════════════════
-- [04] 취소 오더 62건에 취소 시각 없음
--      → **추정 금지**. 언제 취소됐는지 알 수 없다. updated_at 으로 채우면 원장에 거짓 시각이 박힌다.
--        (order_sign_logs 도 이 값을 '미상'으로 집계하고 있다)
-- [09] 서명 진료 78건에 진단 없음 / [11] SOAP 전부 빈 서명 진료 1건 / [13] 처방 달린 DRAFT 30건
--      → 임상 내용은 만들어낼 수 없다. **코드 게이트로 재발을 막는 게 정답**(아래 후속 참조).
-- [28/29] PAID 인데 결제액 0 (18건) / 결제 시각 없음 (17건)
--      → 재무 기록이다. 전액 수납인지 부분 수납인지, 언제 수납했는지 알 수 없다. 사람 판단 대상.
-- [32] 라인 없는 PAID 청구 1건 → 무엇을 청구했는지 알 수 없다(라인 날조 금지).
-- [07] 오더 없는 ACTIVE 처방 244건(전부 MEDICATION)
--      → 지금 오더를 만들면 약국 큐에 244건이 쏟아진다. 운영 판단 대상.
-- [21/23] 지난 예약 118건·1일 초과 대기 188건 → 자동 만료 기능이 없어서 쌓인 것. 기능으로 해소.
-- [27] 워크리스트 FAILED 2건 → PACS 서비스 계정 대기(외부).
-- [39] 검진권 체인 불일치 10건 → 리허설 데이터로 이미 종결 판정.
