# 검진권(voucher) 수동 마이그레이션 적용 순서

`deploy.sh --schema`는 `npx prisma db push`를 쓰는데, 현재 `procedure_codes (code, valid_from)`
복합 unique 드리프트(타 기능의 미적용 스키마 변경)가 db push 전체를 차단한다
(로컬 점검상 중복 0건이라 적용 자체는 안전하나, db push가 destructive 플래그를 요구).

따라서 **voucher 컬럼 추가는 db push가 아니라 아래 수동 SQL로 적용**한다. 모두
`ADD COLUMN IF NOT EXISTS`라 멱등(재적용 안전). 서버엔 voucher 테이블이 이미 존재(P1~P4 배포).

## 적용 순서

```bash
cd apps/api
# 1) 정산 보강(H-2 4-eyes / H-3 claw-back 미정산 이월)
npx prisma db execute --file prisma/manual/voucher-settlement-clawback.sql --url "$DATABASE_URL"
# 2) 구매 흐름 G1(활성화코드 봉투암호화 저장)
npx prisma db execute --file prisma/manual/voucher-purchase-flow.sql --url "$DATABASE_URL"
# 3) 딜러 국내/해외 구분(dealer_type·contract_ref·license_number nullable화)
npx prisma db execute --file prisma/manual/voucher-dealer-type.sql --url "$DATABASE_URL"
# 4) 국내 유치업자 차등 수수료 상한(domestic_max_commission_rate)
npx prisma db execute --file prisma/manual/voucher-domestic-commission.sql --url "$DATABASE_URL"
# 5) A1 수납 검진권 결제(BillingPayment 분할라인·redeem↔Billing)
npx prisma db execute --file prisma/manual/voucher-billing-payment.sql --url "$DATABASE_URL"
# 6) A2 검진권 결제 환불·취소 역상환(reversed_at·reversal_reason)
npx prisma db execute --file prisma/manual/voucher-redeem-reversal.sql --url "$DATABASE_URL"
# 7) B2-a 딜러 세무/송금 마스터(tax_id·bank_info)
npx prisma db execute --file prisma/manual/voucher-dealer-tax-bank.sql --url "$DATABASE_URL"
# 8) DB-2 정산 환율 스냅샷(fx_rate_source)
npx prisma db execute --file prisma/manual/voucher-settlement-fxrate.sql --url "$DATABASE_URL"
# 9) B3 정산 지급 회신(paid_at·erp_voucher_ref·amount_paid_krw·withholding_krw·paid_callback_event_id)
npx prisma db execute --file prisma/manual/voucher-settlement-paid-callback.sql --url "$DATABASE_URL"
# 10) M-2 활성화 무차별대입 잠금(activation_fail_count·activation_locked_until)
npx prisma db execute --file prisma/manual/voucher-activation-lockout.sql --url "$DATABASE_URL"
# 11) 클라이언트 갱신(서버 dist 반영 전 필요 시)
npx prisma generate
```

## 컬럼 요약 (스키마 생성 DDL과 타입 일치 검증됨)

| 테이블 | 컬럼 | 타입 | 용도 |
|--------|------|------|------|
| checkup_vouchers | activation_code_enc | text | 활성화코드 봉투암호화(G1) |
| voucher_settlements | confirmed_by | uuid | 정산 4-eyes 확정자(H-2) |
| voucher_settlements | confirmed_at | timestamptz | 확정 시각(H-2) |
| voucher_refunds | distributor_id | uuid | claw-back 대상 딜러(H-3) |
| voucher_refunds | settled_at | timestamptz | 미정산 이월 추적(H-3) |
| voucher_refunds | settlement_id | uuid | 반영된 정산(H-3) |
| voucher_distributors | dealer_type | varchar(12) | 국내(DOMESTIC)/해외(OVERSEAS) 구분·기본 OVERSEAS |
| voucher_distributors | contract_ref | varchar(120) | 해외 딜러 제휴계약 참조 |
| voucher_distributors | license_number | (nullable화) | 해외 딜러는 한국 유치업 등록 면제 |
| voucher_policies | domestic_max_commission_rate | integer (def 15) | 국내 유치업자 수수료 상한(해외와 차등·더 엄격) |

## 로컬 dev DB 주의
로컬 dev DB는 voucher 11테이블이 없고(운영만 배포됨) 다수 최신 테이블/컬럼이 stale하다.
로컬 검증이 필요하면 `prisma migrate diff`로 voucher 테이블만 추출해 격리 적용한다
(voucher FK는 자기참조뿐이라 외부 의존성 없음). 전체 db push는 멀티 CLI 공유 DB라 지양.
