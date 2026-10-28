# 처방의(책임 처방자) 지정 · 위임 인증 · 담당 의료군 설계서

> **Feature**: prescriber-designation
> **Version**: 1.0 (역작성 — 구현 후 문서화. 코드가 SoT, 충돌 시 코드 우선)
> **Date**: 2026-06-21
> **Status**: Design (배포 완료, code-grounded)
> **구현 커밋**: fda645e7 · cdc8c88d · 1a9b05ad · ba36b4bf · d197ad72 · 192d96ee(W-1)
> **근거 법령**: 의료법 §18(직접 진찰한 의사만 처방), 선택진료제 2018 폐지

---

## 0. 배경 · 문제

기존 처방은 작성자(`createdBy`)가 곧 처방자였다. 그러나 실제 대학병원은:
- **전공의·간호사가 입력**하고 **책임 처방의(주치의·교수)가 책임**지는 위임 구조가 일상적이다.
- 입원 환자는 단일 주치의가 아니라 **담당 의료군**(주치의·협진의·지정의)이 함께 본다(의료법 §18).

→ **책임 처방자(`prescriberId`)를 입력자(`createdBy`)와 분리**하고, 위임 시 책임 처방의의 **인증(폰 생체/PIN step-up)**으로 책임 귀속을 보증한다. 전 기능 **config 기본 OFF(무중단)**.

---

## 1. 핵심 개념

| 용어 | 정의 |
|------|------|
| `createdBy` | 처방을 화면에서 입력한 사용자(전공의·간호사 등) |
| `prescriberId` | **책임 처방자**. 미지정 시 = `createdBy`(본인 처방) |
| 위임/대리처방 | 입력자 ≠ 책임 처방의. 책임 처방의의 step-up 승인 필수 |
| 담당 의료군(care group) | 입원 환자의 합법적 처방 주체 집합 = 주치의 + 입원담당의 + 해당 진료의 + 활성 협진의 + 추가 지정의 |
| 지정의(AdmissionDesignatedDoctor) | 특수환자에 주치의 외 추가 배치하는 책임의(입원별) |

---

## 2. 규칙 모델 (SystemConfig `prescription.prescriberRules`)

관리자 화면 `/admin/prescriber-rules`에서 토글. **기본 전부 OFF / allowedRoles=['DOCTOR']**.

| 규칙 | 기본 | 의미 |
|------|:---:|------|
| `enabled` | false | **마스터 스위치.** OFF면 지정 무시·항상 작성자 본인(아래 §6 사칭 차단) |
| `allowDelegate` | false | 본인 외 지정(위임) 허용 |
| `requireDelegateAuth` | true | 위임 시 책임 처방의 step-up 인증 강제 |
| `allowedRoles` | ['DOCTOR'] | 처방의가 될 수 있는 역할. **화이트리스트=['DOCTOR','ADMIN']로 강제**(의료법: 의사만 처방, ADMIN은 시스템 오버라이드). NURSE/PHARMACIST 등 API 우회 설정 차단 |
| `requireSpecialtyMatch` | false | 처방의 진료과 = 진료 진료과 일치 강제(외래용) |
| `requireAttending` | false | 입원 환자는 담당 의료군만 처방의 지정 가능(care group 모드) |
| `departmentGuidelines` | {} | 진료과별 처방 가이드라인 텍스트(화면 표시) |

---

## 3. 데이터 모델 (Prisma · snake_case @@map)

| 모델 / 컬럼 | 테이블 | 비고 |
|------|------|------|
| `Prescription.prescriberId` | `prescriptions.prescriber_id` (UUID null) | NULL = createdBy. idx_prescriptions_prescriber |
| `StepUpApproval.requesterId` | `step_up_approvals.requester_id` | 위임 입력자(토큰 1회 수령 주체) |
| `StepUpApproval.summary` | `step_up_approvals.summary` (varchar120) | 폰 표시용 약품 요약(approve-blind 방지) |
| `StepUpApproval.bodyHash` | `step_up_approvals.body_hash` | **약품 내용 해시(W-1 부인방지)** |
| `AdmissionDesignatedDoctor` | `admission_designated_doctors` | 입원별 지정의(admission_id, doctor_id, reason, assigned_by, active). uq(admission_id, doctor_id) |

> **적용**: manual SQL(`prescriber-designation.sql`·`stepup-approval-summary.sql`·`admission-designated-doctor.sql`) — 로컬 db push가 procedure_codes 드리프트로 차단되어 서버 직접 적용. **2026-06-21 서버 hospitalrun DB 적용 확인 완료**. ⚠️ to_regclass 점검은 반드시 snake_case로(PascalCase 조회 시 NULL 오판).

---

## 4. 담당 의료군 산출 — `careGroupDoctorIds()`

입원 환자(`admissionId` 有)의 합법적 처방 주체:

```
ids = { 해당 진료의(encounter.doctor) }
  + admission.attendingDoctorId, admittingDoctorId
  + admission_designated_doctors(active)
  + consultation(해당 입원 전체 encounter, status ∈ {ACCEPTED, REPLIED}).toDoctorId/replyDoctorId
→ user.isActive=true 필터(퇴사/비활성 자동 제외)
```

- 협진의는 **타과라도 포함** → care group 모드에선 전문과 일치를 추가 강제하지 않음.
- **성능(W-2)**: admission·encounter·designated 조회는 admissionId만 의존 → `Promise.all` 병렬(입원 1라운드 + consult + user = 3라운드, 외래 2라운드).

---

## 5. 흐름

### 5.1 본인 처방 (위임 아님)
입력자 = 책임 처방의. 규칙 활성 시 자격 검증(역할·담당군/전문과)만, step-up 없음.

### 5.2 위임/대리처방
```
[입력자(전공의·간호사)] 처방 작성 + 책임 처방의 지정
   │ POST /encounters/:id/prescriptions/delegate-request  (서버가 bodyHash·summary 생성)
   ▼
[책임 처방의 폰] FCM 푸시 → 생체(passkey) 또는 데일리 PIN 승인
   │ 서버 검증 후 step-up 토큰 발급(sub=prescriberId, bodyHash 바인딩, jti 1회/5분 TTL)
   ▼
[입력자] GET .../delegate/status/:id 폴링 → 토큰 수령
   │ POST /encounters/:id/prescriptions  (x-prescriber-step-up-token 헤더)
   ▼
[서버] resolvePrescriber: DUR 통과 후 토큰 consume → prescriberId 저장
```

---

## 6. 보안 설계 (방어선)

| # | 위협 | 방어 |
|---|------|------|
| S-1 | 규칙 엔진 부재 시 임의 지정으로 타인 사칭 | **enabled=false면 designated 무시→작성자 본인 강제** (resolvePrescriber 최상단) |
| S-2 | 입력자 토큰으로 위임 우회 | step-up 토큰 **sub=prescriberId 바인딩** — consume 시 sub≠prescriberId 거부 |
| S-3 | 자기위임(self-delegation) | requesterId === prescriberId 거부 |
| S-4 | 토큰 재사용 | jti Redis 1회 소비(del), 5분 TTL |
| S-5 | **승인 후 약품 변조(부인방지, W-1)** | **bodyHash로 약품 내용까지 토큰 바인딩.** 서버가 delegate-request·create 양쪽에서 동일 정규해시(`hashPrescriptionBody`) 계산 → 불일치 시 STEPUP_MISMATCH, 미바인딩 토큰은 STEPUP_BODY_UNBOUND 거부 |
| S-6 | DUR 실패로 1회용 토큰 헛소비 | **DUR 통과 후에** resolvePrescriber 호출 |
| S-7 | FE가 해시 우회(임의 bodyHash 전송) | **서버 권위적**: bodyHash·summary를 서버가 처방 본문으로 계산(FE는 약품 필드만 전송) |
| S-8 | 비처방 역할(NURSE 등) 처방의 설정 | allowedRoles 화이트리스트 ['DOCTOR','ADMIN']로 강제(§2) |
| S-9 | 퇴사 의사가 담당군 잔존 | careGroupDoctorIds가 user.isActive 필터 |

### `hashPrescriptionBody` 정규화
`[type, medicationCodeId, procedureCodeId, dosage, frequency, duration, quantity, route].join('|')` → SHA-256. 키 순서 비의존·결정성. delegate-request와 create가 동일 본문에서 동일 해시 산출해야 일치.

---

## 7. API

| Method · Path | 역할 | 설명 |
|------|------|------|
| GET `/encounters/:id/authorized-prescribers` | DOCTOR/NURSE/ADMIN | 지정 가능 사용자 목록 + 진료과 가이드라인 |
| **POST `/encounters/:id/prescriptions/delegate-request`** | DOCTOR/NURSE/ADMIN | 위임 승인 요청(서버 bodyHash 바인딩) |
| GET `/auth/step-up/push/delegate/status/:id` | (입력자) | 토큰 폴링(본인 요청건만) |
| POST `/encounters/:id/prescriptions` | DOCTOR/ADMIN | 처방 생성(헤더 x-prescriber-step-up-token) |
| DELETE `/prescriptions/:id` | DOCTOR/ADMIN | 취소(책임 처방의·담당군·ADMIN만, 규칙 활성 시) |
| GET/POST/DELETE `/admissions/:id/designated-doctors` | DOCTOR/ADMIN | 지정의 배치·해제(감사 기록) |
| GET/PUT `/prescriptions/prescriber-rules` | ADMIN | 규칙 조회·저장 |

> 구 `POST /auth/step-up/push/delegate/request`(generic)는 FE 미사용. create가 bodyHash 없는 토큰을 거부(S-5)하므로 처방 우회 불가.

---

## 8. 우회 생성 경로의 책임 귀속

처방이 생성되는 모든 경로에서 `prescriberId`를 설정(책임 누락 방지):
- workstation = userId / remote-consultation = doctorId / pre-order = doctorId ?? approvedBy
- copy·repeat = 원본 prescriberId ?? userId

---

## 9. 운영 활성화 (go-live)

- `/admin/prescriber-rules`에서 enabled 토글 + 정책 설정.
- Tier2 step-up 활성 필요: `terminal.stepUpActions`에 `PRESCRIPTION_CREATE` 등록 + pilot 지정([[tier2_stepup_active]]). 책임 처방의는 패스키 또는 데일리 PIN 단말 등록 필요.

---

## 10. 검증 상태 · 잔여

- **테스트 36/36**(prescription.service·controller). W-1: 해시 결정성·서버 권위적 위임요청 자격검증 6건.
- 위임 성공 **E2E(실토큰)는 미검증** — 책임 처방의 패스키/PIN 단말 필요. 401 게이트·care group·자격검증·해시는 검증.
- **잔여(회귀 아님)**:
  - 위임 성공 경로 통합테스트(단말 모킹) 보강.
  - `requireSpecialtyMatch`/`requireAttending` 동시 설정 시 우선순위(현재 requireAttending+admission이 우선, else specialty) 문서화됨 — UX상 상호배타 안내 검토.
