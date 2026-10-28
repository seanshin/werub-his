# 검진권 구매 흐름 완결 설계 (G1·G2)

> 상위 설계: [checkup-voucher-blockchain.design.md](./checkup-voucher-blockchain.design.md) §14
> 본 문서: 구매 흐름의 미완 연결고리 **G1(활성화코드 전달)·G2(구매자 포털 온보딩)** 보강 설계
> 작성일: 2026-06-18 · 상태: IMPLEMENTED(커밋 057c51bd·미배포) — BE/FE 완료, 서버 마이그레이션·배포 대기

## 1. 문제 정의 (현 상태 grounded)

발행→매입→재판매→활성화→상환의 **상태머신·정합성·보안은 완성**(C-1·C-2·H-2·H-3 수정 완료)이나, 외국인 구매자가 실물 흐름으로 검진권을 **받아 활성화·사용**하는 마지막 연결이 비어 있음.

| ID | 단절 | 근거 |
|----|------|------|
| **G1** | 활성화코드가 구매자에게 도달하는 경로 없음. 코드 원문은 발행 응답에 1회·≤200장만 반환, **어디에도 저장 안 됨**(해시만), 재조회/재발급 EP 없음, ">200 봉인 전달 시스템"은 **미존재** | `voucher.service.ts:90,104-105` |
| **G2** | `sell`이 buyerName/contact 자유텍스트만 기록 → 구매자는 환자도 포털계정도 아님. 그러나 `activateSelf`는 **기존 포털 환자**(PortalOrPatientGuard) 전제 → 활성화 화면 도달 불가 | `voucher-trade.service.ts:95-101`, `voucher.controller.ts:75-92` |

재사용 가능한 기존 자산:
- `foreign-patient.service.registerForeign(dto, userId)` — 외국인 Patient 생성(외국인 MRN·여권·국적) `foreign-patient.service.ts:50`
- `patient-auth.service.signup(dto)` — Patient + PatientAccount(포털 로그인 phone/password/pin) `patient-auth.service.ts:29`
- `ENCRYPTION_KEY` 봉투 암호화 유틸(기존 PHI 암호화 패턴)
- 시뮬레이션 외부연동(SMS/이메일) 토글 — [[dev_simulation_registry]]

## 2. 설계 방침 — Claim 기반 셀프 온보딩

G1·G2를 **하나의 흐름으로 통합**한다. 해외 딜러 중개(B2B2C·오프라인 결제) 모델에서 가장 단순하고 일관된 경로:

```
[딜러] 재판매 시 ──시리얼+활성화코드 전달──▶ [구매자]
                                              │
[구매자] 포털 "검진권 등록" 1화면 진입         ▼
   = 시리얼 + 활성화코드 + 최소신원(이름·국적·여권·생년·연락처) + 비밀번호
                                              │
[시스템] 코드검증 → 외국인환자 생성 → 포털계정 생성 → 검진권 활성화(바인딩) ─▶ 완료
```

- **코드 = 구매자 손에 들어가는 자격증명**(G1) · **활성화 = 온보딩 시점**(G2). 사전 초대·사전 환자등록 불필요.
- 활성화코드의 전달 채널 = **딜러**(재판매 시점). 따라서 딜러가 코드를 손에 쥘 수 있어야 함(§3 G1).

대안(기각): ① 사전 포털초대 메일 발송 = 구매자 이메일 신뢰·2단계라 이탈↑ ② 코드리스(sell이 토큰생성) = 발행 무결성 체인과 분리되어 검증 약화. → claim 기반이 최소 단계.

## 3. G1 — 활성화코드 전달 체인

### 3.1 데이터 모델
`CheckupVoucher`에 **복호 가능 봉인 저장** 추가(기존 `activationHash`는 검증용 유지):
```prisma
activationCodeEnc  String?  @map("activation_code_enc") // ENCRYPTION_KEY 봉투암호화. 딜러 전달용. 활성화 후 null 처리(소각)
```
- 발행 시 `makeActivationCode()` 원문을 **해시(activationHash, 검증)** + **암호화(activationCodeEnc, 전달)** 양쪽 저장.
- 활성화 성공 시 `activationCodeEnc = null` 소각(재노출 차단·단일사용 원칙).

### 3.2 엔드포인트
| EP | 가드 | 동작 |
|----|------|------|
| `sell` 응답 확장 | DistributorAuthGuard | 재판매 성공 시 응답에 `activationCode`(해당 시리얼 복호) 포함 → 딜러가 구매자에게 시리얼과 함께 전달. **감사로그 기록**(누가·언제 코드 열람) |
| `GET /distributor/vouchers/:serial/activation-code` | DistributorAuthGuard + 본인보유 | 딜러 재전달용(분실 시). 본인이 **현재 보유 또는 본인이 판매한** 시리얼만. 감사 |
| `GET /voucher/batches/:id/activation-codes/export` | voucher.admin + 4-eyes | 대량 배치 봉인 내보내기(CSV/PDF, 다운로드 1회·감사) — 미존재 "봉인 전달 시스템" 대체. 딜러 일괄 핸드오프용 |

### 3.3 보안
- 코드 복호 노출은 **딜러(보유자)·발행관리자(4-eyes)** 로 한정. 무차별 대입 방지: 활성화 실패 카운트/잠금(별도 — 직전 QA M-2 후속).
- 봉인 저장이 "구매자만 코드를 안다"는 가정을 약화하나, **코드의 목적은 활성화-바인딩 1회용**이고 활성화 후 즉시 소각·status ACTIVE로 무력화되므로 잔존 위험 낮음.

## 4. G2 — 구매자 포털 온보딩 (Claim)

### 4.1 신규 엔드포인트(무인증 → 자체 검증)
`POST /api/v1/portal/vouchers/claim` (Public, rate-limited)
```ts
{ serial, activationCode, consent,            // 자격
  identity: { familyName, givenName, nationality, passportNo, birthDate, contact },
  password, pin }                              // 포털 계정
```
처리(트랜잭션):
1. `verifySerialFormat` + 검진권 조회 + 상태 SOLD/ISSUED + 만료 검사 + `hashActivation==activationHash`(코드 검증).
2. **L1 외국인 강제**: `nationality !== 'KR'` 아니면 거부.
3. 신원으로 외국인 환자 생성(`registerForeign` 경로 재사용·외국인 MRN). 동일 여권 존재 시 기존 환자 링크(중복 방지).
4. 포털 계정 생성(`signup` 경로 재사용·bcrypt·PIN).
5. `activate(serial, {patientId, code, consent})` 호출 → ACTIVE·boundPatientId·코드 소각.
6. 포털 세션 토큰 발급 → 즉시 로그인 상태로 "내 검진권" 화면.

### 4.2 멱등·경합
- claim 멱등키 또는 (serial 단위 advisory lock + 활성화 원자성) 재사용 — 동일 코드 동시 claim 시 1건만.
- 여권 중복 환자 생성 방지: passportNo unique 조회 후 링크.

### 4.3 프론트
- 포털 비로그인 진입점 "검진권 등록/활성화"(홈페이지·포털 로그인 화면 링크). 1화면 폼(시리얼·코드·신원·비번·동의).
- 기존 로그인 사용자는 현행 `HealthTab` 활성화 UI(`HealthTab.tsx:1389`) 유지(이미 환자인 경우).

## 5. 결정 사항 (2026-06-18 확정)

| # | 항목 | 결정 |
|---|------|------|
| **D1** | 구매자 신원 검증 수준 | **(a) 여권번호 자기기입** — claim 폼에 여권번호·국적·생년월일 입력만. 활성화코드가 사실상의 인증수단. OCR·딜러사전등록은 후속 강화 여지로 보류 |
| **D2** | 활성화코드 봉인 저장 | **(a) 암호화 저장 + 딜러 복호전달** — `activationCodeEnc`(ENCRYPTION_KEY 봉투암호화) 저장, sell 응답·딜러 재발급 EP로 복호 노출(감사), 활성화 후 소각 |
| D3 | claim 시 결제 확인 | (기본) 딜러-구매자 오프라인 결제 현행 유지. sell `paymentRef`만 기록. G3에서 별도 |
| D4 | 연락처 채널 | (기본) claim 완료·코드전달 통지는 시뮬레이션 SMS/이메일([[dev_simulation_registry]]), 실연동은 운영 전환 |

### 5.1 확정 반영 영향
- D1(여권 자기기입): claim `identity`는 여권번호·국적·이름·생년월일·연락처 자기기입. **여권 중복 시 기존 외국인환자 링크**(passportNo 조회)로 중복생성 방지가 유일한 무결성 장치 → §4.2 멱등과 함께 필수.
- D2(암호화+딜러전달): §3.1 `activationCodeEnc` 컬럼 + §3.2 sell 응답확장·딜러 재발급 EP 그대로 채택. 코드 열람은 **감사 필수**(누가·언제·어느 시리얼).

## 6. 영향 범위·비파괴성
- DDL: `CheckupVoucher.activation_code_enc` 1컬럼(ADD COLUMN, 비파괴). manual SQL 적용(로컬 드리프트로 db push 차단 — [[checkup_voucher_blockchain]] 참고).
- 신규 1 Public EP + 딜러 2 EP + sell 응답 확장. 기존 활성화/상환 흐름 무변경(상위호환).
- PACS·OpenPACS 무관.

## 6.1 구현 결과 (2026-06-18 · 커밋 057c51bd)
- **G1**: `CheckupVoucher.activationCodeEnc`(encryptField AES-256-GCM) 발행 시 저장·활성화 시 null 소각. `sell` 응답에 `activationCode`(decrypt) 포함 + `GET /distributor/vouchers/:serial/activation-code`(본인 보유/판매 한정). 코드 열람은 console 감사로그(정식 AuditService 연계는 후속).
- **G2**: `POST /api/v1/portal/vouchers/claim`(VoucherClaimController·무인증·전역 ThrottlerGuard) → `VoucherService.claim` 오케스트레이션(코드검증→L1→환자 생성/링크→`PatientAuthService.provisionForeignAccount`→`activate`→토큰). **외국인 로그인ID=여권번호**(PatientAccount.phone 대용·스키마 무변경). FE `/voucher-claim` 공개페이지 + 포털 로그인 진입링크.
- **검증**: BE/FE tsc·nest build 통과. 런타임 검증은 서버 배포 후(로컬 voucher 테이블 부재).

## 7. 비범위(후속)
- G3 실결제(PG) 연동 · G4 topup 실청구 닫힌 루프 · 활성화 무차별 대입 잠금(M-2) · MFA · 시리얼 시크릿 fail-fast.
