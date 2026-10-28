# 건강검진권(블록체인) 발행·유통·재판매 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/prisma/schema.prisma:13618 model CheckupVoucher · apps/api/src/modules/voucher/voucher-settlement.controller.ts:24 · 잔여: 없음

> **Feature**: checkup-voucher-blockchain
> **Project**: Hospital RUN
> **Version**: 1.0
> **Date**: 2026-06-17
> **Status**: Draft v1.1 (결정 반영: 검진권 둘다·선결제매입·해외딜러 비율수수료·별도 판매상 포털)
> **규제 프레임**: 해외 딜러 = **외국인환자 유치(외국인환자유치법)** → 의료법 §27 예외(합법 가능). §13 참조.
> **관련 인프라**: CheckupProgram · CheckupContract(기존 단체계약) · BlockchainCertificate/BlockchainAnchor(블록체인 앵커) · Billing · IssuedDocument(진위 QR)

---

## 1. 문제 정의 / 배경

건강검진 상품(비급여 종합검진)을 **선불 이용권(검진권)** 형태로 발행·판매하고, 이를
**대량 구매 → 중간 판매상에게 배분 → 재판매**하는 유통 구조를 운영하려 한다.
요구 핵심:

1. 검진권은 **개별 시리얼 번호**로 식별되고, **블록체인(해시체인+앵커)** 으로 발행·이전·사용·폐기가 위변조 불가하게 기록된다.
2. **대량 일괄 구매**(배치 발행) 후 수량을 **배분(allocation)** 하여 재판매할 수 있다.
3. **중간 판매상(Distributor)** 을 등록·계층 관리하고, 그들의 재고·재판매·정산을 관제한다.

> 현재 시스템은 `CheckupContract`(기업 단체검진 — 인원수·할인율로 직접 예약)는 있으나,
> **양도 가능한 시리얼 검진권**과 **재판매 유통망**은 없다. 본 기획이 그 갭을 채운다.

---

## 2. 목표 / 비목표

### 2.1 목표 (결정 반영)
- 검진권 도메인: **발행(배치) → 배분 → 재판매 → 활성화(소비자) → 사용(검진 예약 상환) → 정산/환불/폐기** 전 생애주기.
- **검진권 2형태 모두 지원**: ① 상품권형(특정 프로그램 고정) ② 금액권형(액면가·차액정산). (결정 #1)
- 각 상태 전이를 **해시체인 이벤트**로 기록하고 주기적으로 **BlockchainAnchor(merkle root)** 에 앵커링 → 위변조·이중사용 방지.
- 중간 판매상 = **해외 딜러(외국인환자 유치업자)**, **선결제 매입** 방식, **정해진 비율 수수료**. 계층(총판→대리점) 관리 + 재고/정산 콘솔. (결정 #2·#3)
- 판매상 전용 **별도 포털**(독립 인증). (결정 #4)
- 소비자/판매상이 시리얼·QR로 **진위·잔여·소유 검증**.

### 2.2 비목표 (Out of Scope)
- 외부 퍼블릭 체인(Ethereum 등) 메인넷 직접 기록 ❌ — 기존 패턴(내부 해시체인 + 선택적 외부 앵커 txHash)을 따른다. 외부 체인 앵커는 chainType 옵션으로 후속.
- 암호화폐 결제/토큰화(검진권 NFT 거래소) ❌.
- 국가검진·보험급여 검진의 검진권화 ❌ (§13 규제 — 비급여 종합검진 한정).
- 검진권 ↔ 현금 환전(소비자 간 P2P 양도 마켓) ❌ — 공식 유통망(병원→판매상→소비자) 내로 한정.

---

## 3. 핵심 개념 / 도메인 모델

```
CheckupProgram (검진상품·정가)
      │ 1:N
CheckupVoucherBatch (대량 발행 배치) ── 발행자·수량·단가·정책
      │ 1:N
CheckupVoucher (검진권 1매 = 시리얼 1개) ── 상태머신 + 현재 소유자
      │            └─ N:1 currentOwner(Distributor|병원|소비자Patient)
      │ 1:N
VoucherEvent (해시체인 이벤트: ISSUE/ALLOCATE/TRANSFER/ACTIVATE/REDEEM/REVOKE/REFUND)
      │            └─ prevHash → hash (체인) → 배치 merkleRoot → BlockchainAnchor
      
Distributor (해외 딜러) ── 계층(parentId), 등급, 유치업등록번호, commissionRate(비율 수수료), 국가/통화
      │ 1:N
VoucherAllocation (선결제 매입 배분: 병원→딜러 / 딜러→하위딜러) ── 수량·공급단가·매입결제·기간
      │
VoucherSale (재판매: 딜러→외국인환자/하위) ── 시리얼·판가·수수료(비율)·결제(외화)
      │
VoucherRedemption (사용: 검진권 → CheckupVisit 예약 상환)
```

### 3.1 CheckupVoucher (검진권) — 신규 모델 (요지)
| 필드 | 설명 |
|------|------|
| `serial` | 시리얼 번호(고유, §4 체계) |
| `batchId` | 발행 배치 |
| `programId` | 바인딩된 검진 상품(또는 금액권형은 null + faceValue) |
| `faceValue` | 액면가(원). 상품권형=program.price 스냅샷 |
| `status` | ISSUED→ALLOCATED→SOLD→ACTIVE→REDEEMED / REVOKED / REFUNDED / EXPIRED |
| `currentOwnerType` / `currentOwnerId` | HOSPITAL / DISTRIBUTOR / PATIENT |
| `genesisHash` `headHash` | 해시체인 시작/최신 |
| `anchorId` | 소속 배치의 BlockchainAnchor(merkle) |
| `activationCode` | 소비자 활성화용 PIN(시리얼과 분리·표면 비노출) |
| `expiresAt` | 유효기간(§13 최소 보장) |
| `redeemedVisitId` | 사용 시 연결된 CheckupVisit |

> **저장 전략**: 신규 모델은 Prisma 마이그레이션 필요(검진권 도메인은 규모가 커 SystemConfig 재사용 부적합).
> 배포는 `deploy.sh --schema --api`(자동 백업) — `db push --accept-data-loss` 금지.

---

## 4. 시리얼 번호 체계

```
WGC-<프로그램군2><발행연도2>-<배치4>-<일련6>-<체크4>
예) WGC-PR26-0007-014532-9F3A
 ├ WGC        : 발급기관(위루비병원)
 ├ PR         : 프로그램군(BASIC=BS·PLUS=PL·PRECISION=PR·PREMIUM=PM 등 CheckupProgram.category 매핑)
 ├ 26         : 발행연도
 ├ 0007       : 배치 시퀀스
 ├ 014532     : 배치 내 일련번호
 └ 9F3A       : 체크값 = HMAC(secret, 앞부분)[:4] — 오프라인 형식검증 + 위조 1차 차단
```
- 표면 시리얼과 **활성화 코드(activationCode)** 분리 → 유통 중 노출돼도 소비자 활성화 전까지 사용 불가.
- 시리얼은 **추측 불가**해야 함(일련번호는 순차지만 체크값 HMAC로 임의 생성 차단).

---

## 5. 블록체인 구조 (해시체인 + 앵커)

기존 `BlockchainAnchor`(dataHash·merkleRoot·merkleProof·chainType·txHash) 인프라 재사용.

### 5.1 검진권별 이벤트 해시체인 (VoucherEvent)
```
event.hash = sha256( prevHash + serial + type + payloadHash + actorId + ts )
genesis(ISSUE) → ALLOCATE → TRANSFER → ... → REDEEM
```
- 각 상태 전이가 **추가전용(append-only)** 이벤트. 위변조 시 이후 해시 전부 불일치.
- payload에 소유 이전 당사자·수량·단가·결제ref 포함.

### 5.2 배치 단위 앵커링 (merkle)
- 발행/일배치의 검진권 head 해시들을 **merkle tree → merkleRoot** 산출 → `BlockchainAnchor` 1건 기록(anchorType=`CHECKUP_VOUCHER_BATCH`).
- 주기적(cron) 앵커: 미앵커 이벤트를 모아 merkleRoot 갱신 → (옵션) 외부 체인 txHash 기록.
- 검증: 임의 검진권의 headHash가 merkleProof로 merkleRoot에 포함됨을 증명 → "이 검진권은 발급기관이 발행했고 변조되지 않음".

### 5.3 이중사용(double-spend) 방지
- REDEEM은 DB 트랜잭션 + `status='ACTIVE'` 조건부 updateMany(원자적) + advisory lock(serial) → 동시 상환 1건만 성공.
- 체인상 REDEEM 이벤트는 1회만 추가 가능(headHash 선행조건).

---

## 6. 유통 구조 (발행 → 배분 → 재판매)

```
[병원(발급기관)]
   │ 발행: VoucherBatch (대량 시리얼 생성)
   │ 배분(VoucherAllocation): 수량·공급단가·기간
   ▼
[총판 Distributor(tier=MASTER)]
   │ 재배분: 하위 판매상에게 수량·단가
   ▼
[대리점 Distributor(tier=AGENT, parentId=총판)]
   │ 재판매(VoucherSale): 소비자에게 판매·결제
   ▼
[소비자(Patient)]  ── 활성화(ACTIVATE) → 검진 예약 시 사용(REDEEM)
```

- **배분(Allocation) = 선결제 매입**(결정 #2): 판매상이 공급단가로 **미리 구매(매입)** 하면 소유권 이전 + 재고 증가. 매입 완결분만 재판매 가능 → 미수/신용 리스크 없음(위탁 모델 제외).
- **재판매(Sale)**: 판매상이 자기 재고를 최종 소비자(외국인환자)/하위 딜러에 판매. **수수료 = 정해진 비율(commissionRate)**(결정 #3) — 자의적 마진이 아니라 등록된 유치 수수료율 적용(외국인환자유치법 §13).
- **해외 딜러 특성**: 결제 통화(외화)·환율·해외 송금·세무(영세율/환급) 고려. 딜러는 **외국인환자 유치업 등록** 주체.
- **회수**: 선결제 매입분이라 회수는 원칙적 환불(REFUND) 처리. 미판매·만료분 상위 반품은 환불 규정에 따름.

---

## 7. 상태 머신 (CheckupVoucher.status)

```
ISSUED ──allocate──▶ ALLOCATED ──(재)allocate──▶ ALLOCATED ──sell──▶ SOLD
SOLD ──activate(소비자)──▶ ACTIVE ──redeem──▶ REDEEMED
임의상태 ──revoke──▶ REVOKED(회수/위조/분실)
SOLD/ACTIVE ──refund──▶ REFUNDED(환불·규정)
ACTIVE ──기간만료──▶ EXPIRED(§13 환불의무 기간 경과 후)
```
- 모든 전이 = VoucherEvent 1건(append-only) + 상태 업데이트(동일 트랜잭션).

---

## 8. 기능 요구사항 (FR)

### 8.1 발행/구매
- FR-1 배치 발행: 프로그램·수량·발행단가·유효기간·시리얼 규칙 → N개 검진권 + genesis 이벤트 + 앵커.
- FR-2 대량 구매 결제: 외부 대량 구매자(B2B)·총판 선결제 → Billing 연계(`billing.line_recorded` 발행, ERP 정산).

### 8.2 배분(Allocation)
- FR-3 병원→판매상 배분(수량·공급단가·기간·선결제/위탁).
- FR-4 판매상→하위 재배분(계층 깊이 제한·상위단가 이상 가드).
- FR-5 배분 회수/반품.

### 8.3 재판매(Sale)
- FR-6 판매상 재판매(소비자 대상): 시리얼 선택/자동배정·판가·결제수단·영수.
- FR-7 마진/정산 산출: 판가−공급단가, 위탁분 정산 청구.

### 8.4 판매상 관리(Distributor)
- FR-8 판매상 등록/심사/계층(총판·대리점)·등급·수수료율·신용한도.
- FR-9 판매상 포털: 내 재고·배분받은 검진권·재판매·정산·실적.
- FR-10 판매상 정지/해지 시 미판매 재고 회수.

### 8.5 사용(Redemption)
- FR-11 소비자 활성화(시리얼+활성화코드 → 본인/환자 바인딩).
- FR-12 검진 예약 시 검진권 사용 → CheckupVisit 생성·상환(REDEEM)·이중사용 차단.
- FR-13 부분사용/차액(액면가>실검진가) 정책: 잔액권 발행 or 차액환불 or 소멸(택1·규정).

### 8.6 검증/조회
- FR-14 공개 진위검증: 시리얼/QR → 발급기관·프로그램·상태·잔여·블록체인 포함증명(merkleProof). PHI 비노출.
- FR-15 소유이력 조회(감사): 발행→배분→판매→사용 전 체인.

### 8.7 환불/폐기
- FR-16 환불(§13 유효기간·잔액 기준)·분실/위조 신고 시 REVOKE + 재발행.

---

## 9. 권한 / 역할 (RBAC + 판매상 포털)

- **검진권 관리자**(신규 기능 권한 `voucher.admin`) — 발행·배분·정산·회수·딜러 심사. [[feature_access_matrix]] 의 기능 접근 매트릭스에 `voucher.*` 등록 → 세밀 권한.
- **판매상(해외 딜러) — 별도 전용 포털**(결정 #4): staff/patient와 **완전 분리된 독립 인증주체**(Distributor 계정·자체 IdP, staff JwtAuthGuard·portal 가드와 분리). 다국어/해외 접속 전제. 자기 재고·매입·재판매·정산만 접근(**스코프 가드 — 타 딜러 IDOR 차단 필수**).
- **소비자(외국인환자 포털)** — 내 검진권 활성화·사용·잔여조회(다국어).
- **공개 검증** — 무인증(시리얼+QR), PHI/소유자 비노출.

---

## 10. 화면 구성

| 영역 | 화면 |
|------|------|
| 관리자(admin) | 검진권 대시보드(발행/유통/사용 집계) · 배치 발행 · 판매상 관리(계층·심사) · 배분 · 정산 · 회수/환불 · 블록체인 앵커 상태 |
| 판매상 포털 | 내 재고 · 배분 이력 · 재판매 등록 · 하위 배분 · 정산 명세 · 실적 |
| 소비자(포털) | 내 검진권 · 활성화 · 검진 예약 시 사용 · 잔여/유효기간 |
| 공개 | 시리얼/QR 진위·잔여 검증 페이지 |

---

## 11. API 설계 개요 (`/api/v1/checkup/vouchers` 외)

```
POST   /vouchers/batches                 배치 발행(FR-1)
GET    /vouchers/batches/:id             배치 상세/앵커상태
POST   /vouchers/allocations             배분(FR-3/4)
POST   /vouchers/allocations/:id/revoke  회수(FR-5)
POST   /vouchers/sales                   재판매(FR-6)
POST   /vouchers/:serial/activate        소비자 활성화(FR-11)
POST   /vouchers/:serial/redeem          사용·검진예약 상환(FR-12)
POST   /vouchers/:serial/refund          환불(FR-16)
GET    /distributors                     판매상 목록/계층(FR-8)
POST   /distributors                     판매상 등록/심사
GET    /distributors/:id/inventory       재고
GET    /distributors/:id/settlement      정산
GET    /public/vouchers/:serial/verify   공개 진위검증(FR-14, 무인증·PHI없음)
```

---

## 12. 보안 / 위변조 방지

- 시리얼 체크값(HMAC) + 활성화코드 분리(유통 중 도난 무력화).
- 블록체인 merkle 포함증명으로 발급 진위 + 변조 탐지.
- REDEEM 원자성(트랜잭션+advisory lock+조건부 update) → 이중사용 0.
- 판매상 포털 스코프 가드(타 판매상 데이터 IDOR 차단 — [[feature_portal_endpoint_guard]] 패턴).
- 공개 검증 EP는 PHI·소유자·체인 내부 미노출(상태·잔여·발급기관만).
- 모든 발행/배분/정산은 4-eyes(고액 배치) + 감사로그.

---

## 13. 규제 / 법무 (해외 딜러 = 외국인환자 유치 프레임)

해외 딜러가 재판매한다는 결정(#3)으로 규제 구도가 **유리하게** 바뀐다 — 핵심은 **외국인환자 유치**다.

| 영역 | 쟁점 | 대응 |
|------|------|------|
| **외국인환자유치법** (의료 해외진출 및 외국인환자 유치 지원법) | 해외 딜러를 통한 외국인환자 유치는 **합법적 사업 영역**. 단, 딜러는 **유치업 등록**, 병원은 **유치 의료기관 등록** 필요. 유치 **수수료는 신고·과도금지(비율 규제)**. | 딜러 온보딩 시 **유치업 등록증 검증** 필드. commissionRate = 신고된 유치 수수료율 한도 내. 수수료 산정·정산 감사 |
| **의료법 §27③ 환자 유인·알선 금지** | 내국인 대상이면 큰 리스크였으나, **외국인환자 유치는 §27의 예외**(외국인환자유치법 근거) → 등록 유치업자의 수수료 수취 **합법**. | 검진권 재판매 대상을 **외국인환자로 한정**(내국인 재판매는 별도 법무 — 본 기획 범위 밖). 딜러·고객의 외국인 여부 검증 |
| **비급여 한정** | 국가검진·보험급여 검진권화 불가 | 비급여 종합검진 프로그램만 발행 |
| **신유형 상품권/전자금융거래법** | 양도성 선불 이용권 = 상품권/선불수단 규제(유효기간·환불·낙전) | 유효기간 표준약관(잔액 환불 의무 기간)·미사용 환불 규정 |
| **외환·세무** | 해외 딜러 외화 결제·송금·부가세 | 영세율/환급(외국인환자 검진)·외국환거래 신고·이전가격 검토 |
| **개인정보·국외이전** | 소비자(외국인) 정보 | 최소수집·공개검증 PHI 비노출·국외이전 동의 |

> **게이트(완화됨)**: 외국인환자유치법 프레임에서는 P2(유통/재판매)도 **합법 진행 가능**.
> 선결 조건 = ① 병원 **외국인환자 유치 의료기관 등록**, ② 딜러 **유치업 등록 검증** 체계, ③ **수수료율 신고 한도** 준수. 내국인 대상 재판매는 본 기획 범위에서 제외(향후 별도 법무).

---

## 14. 단계별 구현

| Phase | 범위 | 게이트 |
|-------|------|--------|
| **P0** | 등록 체계: 병원 외국인환자 유치 의료기관 등록 + 딜러 유치업 등록 검증 + 수수료율 한도 확인 | 법무·행정 |
| **P1** | 검진권 코어: 모델·시리얼·발행 배치·해시체인·앵커·**2형태(상품권/금액권)**·소비자 활성화·검진 예약 상환·공개 검증 | 스키마 배포(--schema --api) |
| **P2** | 유통: Distributor(해외 딜러) 계층·**선결제 매입 배분**·재판매·재고·**비율 수수료** | P0 |
| **P3** | 정산: 수수료(비율) 정산·외화/세무·Billing/ERP 연계·환불/회수 | — |
| **P4** | **딜러 별도 포털**(독립 인증·다국어) + 소비자 포털 + 관리자 대시보드 + 블록체인 앵커 cron | — |

---

## 15. 완료 기준 (DoD)
- 검진권 발행→배분→재판매→활성화→사용 전 생애주기가 시리얼+해시체인으로 추적·검증.
- 공개 검증에서 merkleProof로 발급 진위·변조 여부 증명.
- 이중사용 E2E(동시 상환) → 정확히 1건.
- 판매상 포털 스코프 격리(IDOR 0) + 4-eyes 고액 배치.
- §13 법무 확정 반영(재판매 모델 적법 범위 내).
- code-analyzer 🔴0.

---

## 16. 결정사항 (반영 완료)
1. ✅ 검진권 형태: **둘 다**(상품권형 + 금액권형·차액정산).
2. ✅ 판매상 정산: **선결제 매입**(위탁 제외 → 미수/신용 리스크 없음).
3. ✅ 재판매: **해외 딜러 + 정해진 비율 수수료** → 외국인환자 유치 프레임(§13, §27 예외).
4. ✅ 판매상 포털: **별도 전용 포털**(독립 인증·다국어).

### 남은 확인(설계 단계)
- 외부 퍼블릭 체인 앵커 txHash 연동 시점(내부 해시체인 P1 → 외부 체인 후속?).
- 금액권형 차액정산 정책(잔액권 발행 vs 차액환불 vs 소멸).
- 딜러 수수료율 상한(외국인환자유치 신고 수수료율) 구체값.
- 병원 외국인환자 유치 의료기관 등록·딜러 유치업 등록 현황(행정).
