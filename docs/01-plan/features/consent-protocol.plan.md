# 동의서 연동 프로토콜 (Consent Protocol) Planning Document

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/src/modules/consent/ · apps/api/src/modules/consent/consent.service.ts:51 · apps/web/src/app/portal/_care/CareTab.tsx · 잔여: FR-06 서명 미완료 24h 자동 리마인더(CLI)

> **Summary**: 의사/간호사→환자 동의서 요청-서명-확인 실시간 연동 프로토콜
>
> **Project**: Hospital RUN
> **Date**: 2026-05-29
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

HIS에서 의사/간호사가 동의서를 생성하면, 환자 포털/모바일앱에 실시간 알림이 전달되고,
환자가 전자서명하면 HIS에 즉시 반영되는 **양방향 동의서 프로토콜**을 구축한다.

### 1.2 Background

- BE에 ConsentForm, ConsentTemplate, 블록체인 서명 인프라 완비
- Portal API에 `GET /portal/consents` + `PUT /portal/consents/:id/sign` 존재
- **미구현**: 동의서 생성 → 환자 알림 / 모바일 서명 화면 / 서명 → HIS 실시간 반영

### 1.3 핵심 시나리오

```
시나리오 1: 수술 전 동의서
  의사 → HIS에서 수술 동의서 생성 (PENDING)
  → 환자 앱에 푸시 알림 "수술 동의서 서명이 필요합니다"
  → 환자가 앱에서 내용 확인 + 전자서명
  → 의사 HIS에 실시간 반영 "서명 완료" (SSE)
  → 의사 증인 서명 추가 → 완료

시나리오 2: 입원 동의서 (간호사 주도)
  간호사 → 입원 시 일반 동의서 생성
  → 병실 태블릿 또는 환자 앱으로 서명 요청
  → 환자 서명 → 간호사 확인

시나리오 3: 연구 동의서 (외래)
  의사 → 연구 동의서 생성 + 설명의무 기록
  → 환자 포털에서 확인 + 서명
  → 의사 서명 + 증인 서명 → 3자 서명 완료

시나리오 4: 원격진료 동의서
  원격진료 시작 전 → 자동 동의서 생성
  → 환자 앱에서 즉시 서명
  → 진료 시작 가능
```

---

## 2. Scope

### 2.1 In Scope

- [ ] BE: 동의서 생성 시 PatientNotification + SSE 이벤트 발행
- [ ] BE: 환자 서명 시 HIS 담당 의사/간호사에게 SSE 이벤트 발행
- [ ] BE: 의사/간호사/환자/증인 다중 서명 프로토콜 (순서 제어)
- [ ] FE-HIS: 동의서 상태 실시간 업데이트 (SSE 연동)
- [ ] FE-HIS: "환자에게 서명 요청" 버튼 + 서명 상태 표시
- [ ] FE-Portal: 동의서 서명 화면 (내용 확인 + 서명 패드)
- [ ] FE-Mobile: 동의서 목록 + 서명 화면 (signature pad)
- [ ] 여정 연동: 동의서 요청/서명을 PatientJourneyEvent에 기록

### 2.2 Out of Scope

- 블록체인 서명 개선 (기존 구조 유지)
- 동의서 템플릿 빌더 개선 (기존 구조 유지)
- PDF 생성 개선 (기존 구조 유지)

---

## 3. 프로토콜 설계

### 3.1 상태 머신 (State Machine)

```
                    ┌─────────────┐
                    │   PENDING   │  의사/간호사 생성
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
     ┌────────────┐ ┌──────────┐ ┌──────────┐
     │ PATIENT_   │ │ EXPIRED  │ │ REVOKED  │
     │ SIGNED     │ │ (자동)    │ │ (수동)    │
     └─────┬──────┘ └──────────┘ └──────────┘
           │
     ┌─────┼─────────┐
     ▼     ▼         ▼
  ┌─────┐ ┌────────┐ ┌──────────┐
  │SIGNED│ │DOCTOR_ │ │WITNESS_  │
  │(완료)│ │SIGNED  │ │REQUIRED  │
  └─────┘ └───┬────┘ └────┬─────┘
              │            │
              ▼            ▼
         ┌──────────────────┐
         │     SIGNED       │  모든 서명 완료
         └──────────────────┘
```

### 3.2 서명 순서 제어

| 동의서 유형 | 필수 서명자 | 순서 |
|------------|-----------|------|
| SURGERY | 환자 → 의사 → 증인 | 순차 |
| ANESTHESIA | 환자 → 마취과 의사 | 순차 |
| PROCEDURE | 환자 → 의사 | 순차 |
| TRANSFUSION | 환자 → 간호사 | 순차 |
| RESEARCH | 환자 → 연구 의사 → 증인 | 순차 |
| DNR | 환자/보호자 → 의사 → 증인 | 순차 |
| TREATMENT | 환자 | 단독 |
| GENERAL | 환자 | 단독 |

### 3.3 이벤트 흐름

```
① 의사/간호사 → POST /consent (status: PENDING)
   → emit('consent.created', { consentId, patientId, doctorId, type })
   → NotificationListener: PatientNotification 생성
   → SSE push to patient portal/app
   → JourneyEvent: CONSENT_REQUESTED

② 환자 → PUT /portal/consents/:id/sign (signature: Base64)
   → status: PATIENT_SIGNED (또는 SIGNED if 단독 서명)
   → emit('consent.patient_signed', { consentId, patientId, doctorId })
   → NotificationListener: 의사/간호사 Notification 생성
   → SSE push to HIS
   → JourneyEvent: CONSENT_SIGNED

③ 의사 → PATCH /consent/:id/doctor-sign
   → status: DOCTOR_SIGNED (또는 SIGNED if 증인 불필요)
   → emit('consent.doctor_signed', { consentId })

④ 증인 → PATCH /consent/:id/witness-sign
   → status: SIGNED (최종 완료)
   → emit('consent.completed', { consentId })
   → JourneyEvent: CONSENT_COMPLETED
```

### 3.4 알림 채널

| 수신자 | 이벤트 | 채널 | 내용 |
|--------|--------|------|------|
| 환자 | consent.created | 앱 푸시 + PatientNotification | "수술 동의서 서명이 필요합니다" |
| 환자 | consent.reminder (24h) | 앱 푸시 | "서명 대기 중인 동의서가 있습니다" |
| 의사 | consent.patient_signed | SSE + Notification | "김영수 환자 수술 동의서 서명 완료" |
| 간호사 | consent.patient_signed | SSE + Notification | 동일 |
| 의사 | consent.expired | SSE + Notification | "동의서 유효기간 만료" |

---

## 4. 기존 인프라 활용

| 인프라 | 현황 | 필요 작업 |
|--------|------|----------|
| ConsentForm 모델 | 완비 (다중 서명 필드) | 상태 세분화 (PATIENT_SIGNED 등) |
| ConsentTemplate | 완비 (빌더+버전) | 변경 없음 |
| Portal consents API | GET+PUT sign 존재 | 서명 시 이벤트 emit 추가 |
| Staff consent API | CRUD 완비 | 생성 시 이벤트 emit 추가 |
| NotificationListener | SSE 인프라 존재 | consent 이벤트 리스너 추가 |
| PatientNotification | 모델 완비 | consent 알림 유형 추가 |
| JourneyEvent | 인프라 완비 | CONSENT_* 이벤트 유형 추가 |
| 블록체인 서명 | 선택적 완비 | 변경 없음 |

---

## 5. Requirements

### 5.1 Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01 | 의사가 HIS에서 동의서 생성 시 환자 앱에 실시간 알림 | High |
| FR-02 | 환자 앱/포털에서 동의서 내용 확인 + 전자서명 (signature pad) | High |
| FR-03 | 환자 서명 완료 시 의사 HIS에 실시간 반영 (SSE) | High |
| FR-04 | 다중 서명 순서 제어 (환자→의사→증인) | High |
| FR-05 | 동의서 유형별 서명 요구사항 자동 판별 | Medium |
| FR-06 | 서명 미완료 24시간 후 자동 리마인더 | Medium |
| FR-07 | 여정 이벤트 기록 (CONSENT_REQUESTED → CONSENT_SIGNED) | Medium |
| FR-08 | 모바일 여정 홈에서 대기 중 동의서 배너 표시 | Medium |
| FR-09 | 동의서 철회 시 양방향 알림 | Low |
| FR-10 | 보호자 대리 서명 지원 | Low |

### 5.2 Non-Functional Requirements

| Category | Criteria |
|----------|----------|
| 보안 | 서명 데이터 HTTPS 전송, Base64 + 타임스탬프 |
| 법적 | 의료법 시행규칙 제39조의2 (전자동의서 요건) 준수 |
| 성능 | 서명 → HIS 반영 3초 이내 (SSE) |
| 가용성 | 오프라인 시 서명 대기열 → 온라인 복귀 시 전송 |

---

## 6. 화면 설계

### 6.1 모바일 앱 — 동의서 목록

```
┌─────────────────────────────┐
│ 📋 동의서                    │
│                              │
│  ┌──────────────────────┐   │
│  │ 🔴 서명 필요           │   │
│  │ 전신마취 동의서        │   │
│  │ 김내과 선생님 요청     │   │
│  │ 2026-05-29            │   │
│  │ [서명하기]             │   │
│  └──────────────────────┘   │
│                              │
│  ┌──────────────────────┐   │
│  │ ✅ 서명 완료           │   │
│  │ 수술 동의서            │   │
│  │ 2026-05-28            │   │
│  └──────────────────────┘   │
└─────────────────────────────┘
```

### 6.2 모바일 앱 — 서명 화면

```
┌─────────────────────────────┐
│ ← 수술 동의서                │
│                              │
│  환자: 김영수 (P2026-0001)   │
│  유형: 수술 동의서            │
│  담당의: 김내과               │
│                              │
│  ── 동의 내용 ──             │
│  1. 수술명: 심장 스텐트 삽입  │
│  2. 목적: 관상동맥 협착 치료  │
│  3. 위험성:                  │
│     - 출혈, 감염              │
│     - 혈전, 재협착            │
│  4. 대안: 약물 치료           │
│                              │
│  ☑ 위 내용을 모두 읽고       │
│    이해하였습니다             │
│                              │
│  ┌──────────────────────┐   │
│  │                      │   │
│  │   [서명 패드]         │   │
│  │                      │   │
│  └──────────────────────┘   │
│  [초기화]         [서명 제출] │
└─────────────────────────────┘
```

### 6.3 HIS — 동의서 상태 실시간

```
┌─────────────────────────────────────┐
│ 동의서 상세            김영수 환자   │
│                                     │
│ 유형: 수술 동의서                    │
│ 상태: 🟡 환자 서명 대기              │
│                                     │
│ ┌───────────────────────────────┐   │
│ │ 서명 현황                      │   │
│ │                                │   │
│ │ ☑ 환자 서명    2026-05-29 14:30│   │
│ │ ⬜ 의사 서명    (대기 중)       │   │
│ │ ⬜ 증인 서명    (대기 중)       │   │
│ │                                │   │
│ │ [환자에게 서명 요청 재전송]     │   │
│ │ [의사 서명하기]                 │   │
│ └───────────────────────────────┘   │
└─────────────────────────────────────┘
```

---

## 7. 구현 순서

| Step | 작업 | 규모 |
|:----:|------|:----:|
| 1 | BE: ConsentService에 이벤트 emit 추가 (created, signed) | 소 |
| 2 | BE: NotificationListener consent 이벤트 핸들러 | 소 |
| 3 | BE: Portal API 서명 시 의사 알림 + 여정 이벤트 | 소 |
| 4 | BE: 의사/증인 개별 서명 엔드포인트 | 중 |
| 5 | FE-Mobile: 동의서 목록 화면 | 중 |
| 6 | FE-Mobile: 서명 화면 (서명 패드) | 중 |
| 7 | FE-Mobile: 여정 홈에 동의서 대기 배너 | 소 |
| 8 | FE-HIS: 동의서 상세 실시간 업데이트 (SSE) | 중 |
| 9 | FE-HIS: "환자에게 서명 요청" 버튼 | 소 |
| 10 | 통합 테스트 + 배포 | 중 |

---

## 8. 데이터 흐름 다이어그램

```
┌──────────┐         ┌──────────────┐         ┌──────────────┐
│  HIS     │         │   Server     │         │ Patient App  │
│ (의사)    │         │   (NestJS)   │         │ (Expo)       │
└────┬─────┘         └──────┬───────┘         └──────┬───────┘
     │                      │                        │
     │ POST /consent        │                        │
     │─────────────────────►│                        │
     │                      │ emit('consent.created') │
     │                      │─── PatientNotification──►│ Push 알림
     │                      │─── SSE ─────────────────►│ "서명 필요"
     │                      │─── JourneyEvent ────────►│
     │                      │                        │
     │                      │    PUT /portal/         │
     │                      │    consents/:id/sign    │
     │                      │◄────────────────────────│ 환자 서명
     │                      │                        │
     │ SSE: signed          │ emit('consent.patient_  │
     │◄────────────────────│  signed')               │
     │ "환자 서명 완료"      │                        │
     │                      │                        │
     │ PATCH /consent/      │                        │
     │ :id/doctor-sign      │                        │
     │─────────────────────►│                        │
     │                      │ emit('consent.          │
     │                      │  doctor_signed')        │
     │                      │────────────────────────►│ "의사 서명 완료"
     │                      │                        │
```

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-29 | Initial — 프로토콜 설계, 4개 시나리오, 10단계 구현계획 | AI Assistant |
