# 수진자 자격조회(건강보험공단 연계) + 본인확인 의무화 기획서 v1.0

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/prisma/schema.prisma:7115 model EligibilityCheck · apps/web/src/app/(main)/reception/components/EligibilityVerifyModal.tsx · apps/api/src/modules/eligibility/eligibility.controller.ts · 잔여: 공단(NHIS) 실연동(사람)

> **요약**: 의료기관이 진료 시점에 **환자의 건강보험/의료급여 자격을 정부(공단)와 연계해 검증**하고, 그 결과(자격 유무·본인부담 구분·산정특례)를 **수납/영수 계산까지 관통**시킨다. 실연동(공단 API)은 실서버 운영 시점에 하되, **지금은 시뮬레이션 어댑터**로 접수→자격조회→본인부담→영수 전체 흐름을 완성한다. **2024.5.20 본인확인 의무화**(국민건강보험법 §12) 준수 워크플로 포함.
>
> **작성일**: 2026-06-12 / **상태**: Draft
> **배경**: 현재 보험은 접수 시 직원이 수동 분류(InsuranceType)하고 본인부담은 정적 `COPAY_RATES`로 추정. 공단 실시간 자격검증·본인확인 의무화는 미기획(현황 진단 결과).

## 1. 목표 / 비목표

**목표**
- 진료 시점 **수진자 자격조회** — 자격 유무·자격득실일·**본인부담 구분**(건보 30/20%, 의료급여 1종/2종, 차상위, 산정특례)·급여정지 등.
- 자격조회 결과가 **billing copay 계산의 권위 입력**이 되어 수납/영수에 정확 반영(정적 추정 → 자격 기반).
- **본인확인 의무화** 준수 — 접수 시 신분증/모바일 건강보험증 본인확인 기록 + 예외처리(미성년·응급·재진 6개월 내).
- **시뮬레이션/실연동 토글** — 실서버 전까지 스텁, 운영 시 공단 API로 교체(SMS/ERP 패턴 동일).

**비목표**
- 공단/HIRA **실 인증서·보안매체·요양기관 인증** 절차(실서버 행정 요건, 추후).
- EDI 청구(기존 `hira-edi`·`claim` 유지) — 자격조회는 **청구 전 단계**.
- 모바일 건강보험증 앱 자체 구현(QR 수신·검증 인터페이스만).

## 2. 도메인 배경 (정부 연계)

| 제도 | 내용 | 반영 |
|------|------|------|
| **수진자 자격조회** | 공단이 진료시점 자격·본인부담구분 제공(요양기관정보마당/EDI 청구SW) | 자격조회 어댑터 |
| **본인확인 의무화** | 국민건강보험법 §12(2024.5.20) — 진료 전 본인확인(신분증·모바일건보증). 위반 시 부정수급 환수·과태료 | 본인확인 기록 |
| **본인부담 구분** | 건보 외래 30%/입원 20%, 의료급여 1종(외래 1,000~2,000원 정액·입원 0%)/2종(15%), 차상위, **산정특례**(암·희귀난치 0~10%) | copayCategory |
| **자격득실** | 자격 개시/상실일 — 상실자 진료 시 전액 본인부담·환수 | coverageStart/End |

## 3. 기능 요구사항 (FR)

| ID | 요구 | 우선 |
|----|------|------|
| FR-1 | **자격조회 요청** `POST /eligibility/check` — 환자 식별(주민번호 해시·보험번호)로 자격 조회(시뮬레이션). 결과 영속화 | P0 |
| FR-2 | **자격 결과 모델** `EligibilityCheck` — 자격유무·자격득실일·copayCategory·산정특례·source(SIMULATION\|NHIS)·rawResponse | P0 |
| FR-3 | **접수 통합** — 당일/예약 접수(check-in) 시 자격조회 자동 실행 + 본인확인 → 대기열에 상태 표시 | P0 |
| FR-4 | **본인부담 연동** — billing copay 계산이 `EligibilityCheck.copayCategory`를 권위 입력으로 사용(정적 COPAY_RATES → 자격 기반). 의료급여 정액·산정특례·차상위 반영 | P0 |
| FR-5 | **본인확인 의무화** — 접수 시 본인확인(신분증 OCR/모바일건보증 QR/구두) 기록(`PatientIdentificationCheck` 재사용·확장) + 예외(미성년·응급·재진6개월) | P0 |
| FR-6 | **자격 상태 UI** — 접수/대기열/진료/수납 화면에 자격 배지(✅자격확인·⚠️상실·❓미확인·산정특례 표시) | P1 |
| FR-7 | **시뮬레이션 어댑터** — config `eligibility.{enabled,mode,apiUrl,apiKey}`. mode=SIMULATION 시 환자 데이터 기반 결정적 응답. 실연동은 어댑터 교체만 | P0 |
| FR-8 | **자격조회 이벤트·감사** — journey `ELIGIBILITY_CHECKED` + AuditLog. 조회 이력 추적 | P1 |
| FR-9 | **재조회/캐시** — 동일 환자 당일 재접수 시 캐시(유효기간 config), 만료 시 재조회 | P2 |

## 4. 핵심 흐름 (영수까지 관통)

```
[접수] 당일/예약 check-in
   │
   ├─ ① 본인확인(의무화): 신분증 OCR / 모바일건보증 QR / 구두(예외) → PatientIdentificationCheck 기록
   ├─ ② 자격조회(자동): POST /eligibility/check (주민번호 해시·보험번호)
   │      → 시뮬레이션 어댑터 → EligibilityCheck 저장(copayCategory·자격득실·산정특례)
   │      → 대기열 eligibilityStatus 갱신 + journey ELIGIBILITY_CHECKED
   │
[진료] Encounter — 자격 스냅샷(copayCategory) 참조
   │
[수납] billing.createFromEncounter / emitAccrualLine
   │      → copay 계산이 EligibilityCheck.copayCategory 사용
   │         (건보30/20·의료급여1종 정액·2종15%·차상위·산정특례 0~10%)
   │      → patientCopay·insuranceCovered 정확 산정
   │
[영수] 영수증/수납 — 자격 기반 본인부담 반영 ✅ 전체 관통
```

## 5. 데이터 설계 (개요)

**신규 모델 `EligibilityCheck`**(자격조회 결과 — 신규 모델 1)
- patientId·insuranceType·`eligibilityStatus`(VERIFIED\|EXPIRED\|NOT_FOUND\|ERROR)·coverageStartDate·coverageEndDate·**`copayCategory`**(NHI_30\|NHI_INPATIENT_20\|MA_TYPE1\|MA_TYPE2\|NEAR_POOR\|SPECIAL_EXEMPTION 등)·`specialExemption`(산정특례 코드·만료)·source(SIMULATION\|NHIS)·queriedAt·rawResponse(Json)·checkedById.

**기존 모델 확장(최소)**
- `WaitingQueue` — `eligibilityStatus`·`eligibilityCheckId`·`identityVerifiedAt`(본인확인).
- `Encounter` — `eligibilityCheckId`(진료 시점 자격 스냅샷, copay 권위).
- `PatientIdentificationCheck`(실재, §4457) — checkType에 `RECEPTION_IDENTITY` 추가(본인확인 의무화 재사용).

> 본인부담 구분 → copayRate 매핑은 **config-runtime `billing.copay.*`(이미 존재) 확장**(ma1/ma2/차상위/산정특례).

## 6. 시뮬레이션 / 실연동 (SMS·ERP 패턴)

| config 키 | 기본 | 설명 |
|-----------|------|------|
| `eligibility.enabled` | true | 자격조회 기능(off 시 수동 분류 유지) |
| `eligibility.mode` | `SIMULATION` | SIMULATION \| NHIS(실연동) |
| `eligibility.apiUrl` / `apiKey` | '' | 실연동 시 공단/요양기관정보마당 엔드포인트·키 |
| `eligibility.cacheTtlHours` | 24 | 당일 재조회 캐시 |

- **시뮬레이션 어댑터**: 환자 insuranceType·생년월일·보험번호 기반 **결정적 응답**(예: MEDICAID→의료급여 종별, 고령→산정특례 일부, 무효 보험번호→EXPIRED). 실 환자 데이터로 다양한 케이스 재현.
- **실연동 어댑터**: 동일 인터페이스(`EligibilityProvider`), mode=NHIS 시 공단 API 호출(서명·보안매체) — 추후 구현, 본 기획 범위는 인터페이스·스텁까지.

## 7. 재사용 자산 (실측)

| 자산 | 위치 | 용도 |
|------|------|------|
| `COPAY_RATES`·`createFromEncounter` | billing.service.ts:12,126 | copay 연동 target |
| `billing.copay.*` config | config-runtime:61 | 종별 본인부담률(확장) |
| `PatientIdentificationCheck` | schema.prisma:4457 | 본인확인 기록 재사용 |
| 신분증 OCR | medical-ai `/ai/id-ocr` | 본인확인 정보 |
| `nationalIdHash`(HMAC 블라인드인덱스) | Patient | 자격조회 식별키(복호 불요) |
| 시뮬레이션 패턴 | sms-otp·billing erpGet | 외부 미연동 폴백 |
| journey emit | waiting-queue.service:101 | 자격조회 이벤트 |
| config 토글 | erp.enabled 패턴 | eligibility.* |

## 8. 보안·컴플라이언스
- 주민번호 평문 미전송 — **`nationalIdHash`(HMAC) 또는 암호화 채널**로 식별. rawResponse 민감정보 접근통제.
- 본인확인 의무화 위반 리스크(부정수급 환수) → 예외처리 명확화(미성년·응급·의식불명·재진6개월). 미확인 진료 경고.
- 자격조회 전 과정 AuditLog. 시뮬레이션 결과는 `source=SIMULATION` 명시(실 자격으로 오인 금지).

## 9. 구현 순서 (Phase)
1. **P0-스키마**: `EligibilityCheck` 모델 + WaitingQueue/Encounter 확장 + copayCategory enum/허용값.
2. **P0-BE**: `eligibility` 모듈 — `EligibilityProvider`(시뮬레이션 어댑터) + `POST /eligibility/check`·조회 EP + config 키.
3. **P0-연동**: billing copay 계산이 EligibilityCheck.copayCategory 사용(의료급여 정액·산정특례·차상위). 접수 check-in에 자격조회+본인확인 삽입.
4. **P1-FE**: 접수/대기열/수납 자격 배지·본인확인 UI. 자격조회 수동 재조회 버튼.
5. **P1**: journey 이벤트·감사·캐시. **영수 관통 E2E**(접수→자격→진료→수납→영수).
6. **P2(추후)**: NHIS 실연동 어댑터(공단 API·보안매체)·모바일건보증 QR 실검증.

## 10. 미해소 / 확인
- copayCategory ↔ 실제 본인부담률(의료급여 1종 외래 정액 1,000/1,500원, 산정특례 코드별) 상세 매핑 — 임상/원무 검토.
- 본인확인 예외 범위(재진 인정기간·응급 정의) — 법무.
- 실연동 식별키(주민번호 vs 보험증번호) — 공단 인터페이스 확정 시.
