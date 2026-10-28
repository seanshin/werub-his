# 실서비스 외부연동 전환 통합 기획·설계 v1.0

> **요약**: 개발 중 **시뮬레이션/샘플/스텁**으로 동작하는 외부연동을, 운영 시 **실서비스로 전환**하기 위한 통합 기획·설계. 모든 외부연동을 **어댑터(프록시) 패턴 + config 토글**로 통일해, 데이터 흐름·화면·DTO는 실연동과 동일하게 유지하고 **외부 호출부만 격리**한다. 운영 배포 시 본 문서의 전환 작업·게이트를 수행하면 실연동으로 바뀐다.
>
> **작성일**: 2026-06-12 / **상태**: Design (proxy 시드 구현 완료, 실연결 대기)

## 1. 설계 원칙 (공통 어댑터/프록시)

1. **동일 인터페이스**: 시뮬레이션과 실연동(프록시)은 같은 인터페이스를 구현. 호출 측(서비스·화면·DTO)은 무변경.
2. **외부 호출부만 격리**: 외부 API·인증/보안매체·웹훅 등 "경계"만 어댑터에 둔다.
3. **config 토글**: `*.mode`(SIMULATION/실연동) + 엔드포인트·시크릿 슬롯(config-runtime, repo 비저장).
4. **미구성 시 안전 실패**: 실연동 모드인데 시크릿/엔드포인트 미구성이면 **명확히 503/501**(가짜 데이터가 실 데이터로 처리되는 것 방지). 시뮬레이션 폴백 금지.
5. **출처 마커**: 결과에 `source=SIMULATION` 등 식별자. 실 데이터 오인 방지.
6. **게이트**: 외부 측이 운영급이 된 후에만 활성화(특히 법적 효력·금전·PHI 외부전송).

## 2. 대상 외부연동 — 전환 매트릭스

| # | 연동 | 현재 | 어댑터/프록시 | 토글 | 운영 전환 작업 | 상태 |
|---|------|------|--------------|------|----------------|------|
| 1 | **수진자 자격조회(공단)** | SIMULATION | `EligibilityProvider`(Simulation/Nhis) | `eligibility.mode` | 공단 자격조회 API·공인인증서/보안매체·요양기관 인증 → `callNhis` 구현, `apiUrl/apiKey` 주입 | **프록시 시드 완료** |
| 2 | **보훈(국가유공자) 자격** | 미연동 | NhisProvider 내 `callPatriot` | `eligibility.mode`+`eligibility.patriotApiUrl` | 보훈처/위탁 자격검증 → copayCategory=PATRIOT 매핑 | **데이터경로 완료**(자격검증 자리만 stub) |
| 3 | **외부 서명서비스(sign)** | 내부서명(SIMULATION) | `SignIntegrationService` | `sign.mode` | 서명코어 CMS/PAdES·HSM·mTLS(sign측) + JWKS·Webhook(HIS측) | **P0 완료**(§5) |
| 4 | **휴가 전자결재(Clinic W.Sign)** | SIMULATION(자동승인≤5일) | ess leaveApprovalMode | `ess.leaveApprovalMode` | Clinic 결재선 실배선·콜백 라우팅 | 콜백 EP 완료 |
| 5 | **심사 의료진 알림 릴레이** | SAMPLE EP | `/integration/claims/review-callback` | (실 스펙 확정) | 심사 인바운드 실 스펙(필드·트리거) 확정 | 샘플 완료 |
| 6 | **MEDRLT(검사성적서 표준)** | 합성샘플 | — | (HIRA 운영 후) | HIRA 운영데이터로 적중률·캘리브레이션 | 대기 |
| 7 | **약품 보험코드** | HIRA 자체매칭+ERP close-loop+**AI 약가마스터** | drug-master/substitution(AI) | — | 약제팀 실제품 확정(`/admin/drug-mapping`) | 데이터 실, 확정 사람 |
| 8 | **SMS OTP** | SIMULATION(로그) | sms-otp.service | `SMS_API_KEY` | 알리고 등 연동 | stub |
| 9 | **이메일** | SMTP 미설정 시 시뮬 | crm-channel | `smtp.config` | SMTP 설정/대면전달 | stub |
| 10 | **모바일 건보증 QR** | 기록만 | PatientIdentificationCheck | (인터페이스 확정) | QR 실검증 | stub |
| 11 | **ERP 진료비/HR** | 실연동(개발 URL) | IntegrationOutbox/webhook | `erp.webhookUrl` | 운영 ERP URL 교체 | 실연동(URL만) |
| 12 | **백필 직원 사번** | 임시 BF-* | — | (ERP 회신) | ERP `erpEmployeeCode` 저장·면허 정밀화 | 대기 |

## 3. 환자 자격(공단·보훈) — 프록시 설계 (구현 완료)

```
EligibilityService.check()
  └ provider() ── eligibility.mode ──┬─ SIMULATION → SimulationEligibilityProvider (결정적)
                                     └─ NHIS       → NhisEligibilityProvider (프록시 시드)
                                                       ├ callPatriot()  ← 보훈 국비대상(미구현 자리)
                                                       └ callNhis()     ← 공단 자격조회(미구현 자리)
```
- **인터페이스**: `EligibilityProvider{ source, check(input)→EligibilityResult }` (시뮬/실연동 공용).
- **NhisEligibilityProvider**(`nhis.provider.ts`): 운영 자리. `apiUrl/apiKey` 미구성 시 `503 ELIGIBILITY_NHIS_NOT_CONFIGURED`, 구현 전엔 `503 ELIGIBILITY_NHIS_NOT_IMPLEMENTED`. 실연동 시 `callNhis/callPatriot`만 채우면 됨.
- **보훈(PATRIOT)**: `CopayCategory`에 추가, 본인부담률 fixed 0(국비). billing이 `copayCategory=PATRIOT` 라인을 **ERP `coverage=PATRIOT`** 로 발송(ERP 수용 준비 완료분) → 국비 면제 자동적용.
  - ⚠️ **자격검증(누가 보훈 대상인가)** 은 운영 시 보훈처 연계로 결정. 현재는 검증 자리만 stub(데이터 경로·copay·ERP 발송은 가동).
- **운영 전환 체크리스트**: ① `eligibility.apiUrl/apiKey`(+`patriotApiUrl`) 주입 ② 공인인증서/보안매체 핸드셰이크 ③ 응답 매핑(자격구분→CopayCategory, 산정특례 V코드) ④ `eligibility.mode=NHIS`.

## 4. 보훈 본인부담 세분화 (운영 시 보강)

PATRIOT 기본 0%(국비 전액)로 시드. 실제 보훈 감면은 등급별 차등(국비 100%/일부 본인부담 등) → 운영 시 보훈처 자격구분 수신 후 `billing.copay.patriot.*` 정액/율 config로 세분화. (의료급여 종별 정액 모델과 동일 패턴)

## 5. 외부 서명서비스(sign) — P0~P3 (P0 구현 완료)

### 책임 경계
- **HIS**: 동의서 봉인(documentHash=SHA-256), 서명요청 발행, 의료진 SSO(OIDC JWT+JWKS), Webhook 수신, ConsentForm 반영.
- **sign**: 인증서 발급(PASS+CI/면허), 서명 클라이언트, PAdES/RFC3161 TSA, 감사인증서.

### 토글·스캐폴드 (P0 — 완료, sign팀 승인 A)
- `sign.mode`: SIMULATION(기본·현행 내부서명 무변경) | EXTERNAL(sign 서비스, 현재 501 스텁).
- `SignIntegrationService`(+`GET /api/v1/sign-integration/status`): 모드·시크릿 슬롯 구성여부(값 미노출).
- **비파괴 컬럼**(additive DDL 적용): `ConsentForm.{signProvider default SIMULATION, signatureRequestId, signStatus, signParticipantId, signCertSerial, auditCertUri}`, `Patient/User.signCertSerial`.
  - ⚠️ **명명 충돌**: sign팀 명세의 `signMode`는 기존 `ConsentForm.signMode`(서명기기 TABLET/PC/PORTAL/PAPER)와 충돌 → **`signProvider`** 로 명명(회신 반영 요청).
- `blockchainSignature`(74참조): **미변경**(deprecate=읽기전용, 삭제·백필 금지 — P3 게이트).

### 합의 필요 (B — 시크릿/규칙)
`sign.url`·`sign.apiKey`(SIGN_API_KEY)·`sign.webhookSecret`(HMAC)·`sign.jwksIssuer` + documentHash 규칙(=HIS 봉인 SHA-256) + 본인인증 사업자·원외 범위·mTLS. **config-runtime 슬롯**으로만 보관.

### 병행 구현 (HIS측, P0와 동시 가능)
- JWKS EP + 서명용 JWT(RS256) 발행 — **smart-auth 재활용**.
- Webhook 수신 EP(HMAC 검증·eventId 멱등·ConsentForm 반영) — **IntegrationOutbox 패턴 재활용**.

### 게이트 (C — sign 운영급 후 공동 해제)
EXTERNAL 활성화 / **P1 파일럿(동의서 1종 EXTERNAL)** / blockchainSignature 백필·제거(P3). 해제 조건: sign 서명코어 CMS/PAdES 일원화 + Prisma-live + HSM/mTLS/시크릿회전.

## 6. 운영 배포 전 통합 체크리스트
1. `eligibility.mode=NHIS` + 공단 API/인증(+보훈 `patriotApiUrl`) — §3
2. `sign.mode=EXTERNAL`(게이트 해제 후) + 시크릿/JWKS/Webhook — §5
3. `ess.leaveApprovalMode=CLINIC` + Clinic 결재 실배선
4. 심사 인바운드 실 스펙 반영
5. `erp.webhookUrl` 운영 ERP URL
6. `SMS_API_KEY`·`smtp.config`
7. 약제팀 보험코드 확정(`/admin/drug-mapping`, AI 대체품·표준코드 조회 지원)
8. 백필 직원 ERP 매핑·면허 정밀화

> ⚠️ 시뮬레이션 토글을 끄지 않고 운영하면 가짜 자격/결재/서명이 실 데이터로 처리될 수 있음. 전환 시 위 체크리스트·게이트 필수.

## 7. 미해소 / 확인
- 보훈 감면 등급 세분화 산식(보훈처 자격구분) — 운영 데이터 후.
- sign `signProvider` 명명(충돌 회피) sign팀 회신 반영.
- documentHash 봉인 범위 정합(HIS 동의서 본문 SHA-256 ↔ sign 서명대상).
- AI 약가마스터(drug-master/substitution)는 **후보·표준코드 제공**까지, 실제품 확정은 ERP/약사.
