# 외래 간호 워크플로우 + 의료팀 편성 기획서

> **상태(2026-09-15 코드 대조 갱신)**: 구현됨(일부) — #17 `apps/api/src/modules/nurse-station/nurse-station.controller.ts:158` rx-guide/:encounterId(S4, 처방·약품 마스터 값만) · 잔여: 없음(CLI)

> 작성일: 2026-05-20 | 수정일: 2026-05-20 | 상태: 기획 완료 (검토 반영)

## 1. 문제 정의

### 1.1 현재 상태

현재 시스템은 **의사 중심의 진료 흐름**만 존재하며, 외래 간호사의 역할이 시스템에 반영되어 있지 않다.

**구현된 간호 기능 (입원 전용):**
- 간호초기평가 (NursingAssessment)
- 간호일지 (NursingNote — Focus Charting)
- I/O 기록 (IntakeOutput)
- 투약확인 MAR (MedicationAdministration)
- 간호진단 (NursingDiagnosis)
- 인수인계 (ClinicalHandoff) — 입원 환자 대상

**누락된 외래 간호 기능:**
| # | 기능 | 설명 |
|---|------|------|
| G-1 | 의사-간호사 팀 편성 | 어떤 간호사가 어떤 의사의 외래를 담당하는지 모름 |
| G-2 | 진료 전 간호 업무 | 바이탈 측정, 문진 확인, 동의서 준비 → 의사에게 전달 |
| G-3 | 진료 중 간호 보조 | 의사 옆에서 처치 보조, 검체 채취, 기록 보조 |
| G-4 | 진료 후 간호 업무 | 환자 교육, 처방 설명, 동의서 서명, 후속 예약, 수납 안내 |
| G-5 | 간호사 전용 워크스테이션 | 담당 의사의 환자 목록 + 각 환자별 진행 상태 |
| G-6 | 팀 기반 대기열 관리 | 간호사가 환자 호출, 순서 변경, 우선순위 조정 |

### 1.2 실제 외래 진료 흐름 (현실)

```
[접수] → [간호사: 바이탈 측정] → [간호사: 문진표 확인] → [간호사: 동의서 준비]
                                                            ↓
                                            [간호사 → 의사: "다음 환자 준비 완료"]
                                                            ↓
                                                    [의사: 진료 (SOAP)]
                                                            ↓
                                            [의사 → 간호사: "처방 설명해주세요"]
                                                            ↓
                    [간호사: 환자 교육] → [간호사: 동의서 서명] → [간호사: 후속 예약]
                                                            ↓
                                                    [간호사: 수납 안내]
```

### 1.3 현재 시스템의 흐름 (비교)

```
[접수] → [대기] → [의사: 진료] → [서명] → [수납] → [약국]
         ^^^^^^                  ^^^^^^
         간호사 개입 없음          간호사 개입 없음
```

---

## 2. 목표

### 2.1 핵심 목표

1. **의사-간호사 팀(페어) 편성** 시스템 구축
2. **외래 간호 워크스테이션** 제공 (간호사 전용 화면)
3. **진료 전/중/후** 간호 업무를 시스템 흐름에 통합
4. **환자별 진행 상태 추적** (간호사가 각 단계 체크)

### 2.2 목표 워크플로우

```
[접수]
  ↓
[간호사 워크스테이션 — 대기 환자 표시]
  ↓
[간호사: 환자 호출] ← 순서 관리, 우선순위 조정
  ↓
┌─ 진료 전 (Pre-Visit) ───────────────────────────────┐
│  ① 바이탈 측정 (BP/HR/BT/SpO2/Weight/Height)       │
│  ② 문진표 확인 (포털에서 제출한 것 리뷰)            │
│  ③ 알레르기/복용약 확인                              │
│  ④ 동의서 준비 (필요시 — 시술/수술/검사)            │
│  ⑤ 진료 준비 완료 → 의사에게 알림                   │
└──────────────────────────────────────────────────────┘
  ↓
[의사: 진료 (SOAP + 처방)] ← 간호사가 측정한 바이탈 자동 반영
  ↓
[의사: 서명 완료]
  ↓
┌─ 진료 후 (Post-Visit) ──────────────────────────────┐
│  ⑥ 처방 설명 (약물 복용법, 주의사항)                │
│  ⑦ 검사 안내 (채혈/소변 → 검사실 위치 안내)         │
│  ⑧ 동의서 서명 수집 (시술/수술 동의)                │
│  ⑨ 환자 교육 (질환 관련 생활수칙, 인쇄물)           │
│  ⑩ 후속 예약 (다음 방문일 예약)                     │
│  ⑪ 수납 안내 → 수납 대기열 이동                     │
└──────────────────────────────────────────────────────┘
```

---

## 3. 데이터 모델

### 3.1 CareTeam (의료팀 편성)

> 참고: 기존 `ChargeOfCare`는 입원 전용 (admissionId 기반). 외래 팀 편성은 별도 모델 필요.
> 1명 간호사가 복수 의사를 담당 가능 (다대다 관계).

```prisma
model CareTeam {
  id             String   @id @default(uuid()) @db.Uuid
  doctorId       String   @map("doctor_id") @db.Uuid
  nurseId        String   @map("nurse_id") @db.Uuid
  departmentName String   @map("department_name") @db.VarChar(100)
  teamType       String   @default("OUTPATIENT") @map("team_type") @db.VarChar(20)
  // OUTPATIENT (외래) | INPATIENT (입원) | EMERGENCY (응급)
  isPrimary      Boolean  @default(true) @map("is_primary")
  // 주 담당 여부 (간호사 1명이 복수 의사 담당 시 구분)
  isActive       Boolean  @default(true) @map("is_active")
  effectiveFrom  DateTime @default(now()) @map("effective_from") @db.Date
  effectiveTo    DateTime? @map("effective_to") @db.Date
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz()

  doctor         User     @relation("CareTeamDoctor", fields: [doctorId], references: [id])
  nurse          User     @relation("CareTeamNurse", fields: [nurseId], references: [id])

  @@unique([doctorId, nurseId, teamType])
  @@index([nurseId])
  @@index([departmentName])
  @@map("care_teams")
}
```

**간호사 복수 의사 담당 예시:**
```
간호사 A → 의사 김내과 (isPrimary: true)
간호사 A → 의사 박내과 (isPrimary: false)
간호사 B → 의사 이외과 (isPrimary: true)
```

### 3.2 NurseTask (간호 업무 체크리스트)

```prisma
model NurseTask {
  id           String    @id @default(uuid()) @db.Uuid
  encounterId  String?   @map("encounter_id") @db.Uuid
  patientId    String    @map("patient_id") @db.Uuid
  nurseId      String?   @map("nurse_id") @db.Uuid
  queueId      String?   @map("queue_id") @db.Uuid
  phase        String    @map("phase") @db.VarChar(20)
  // PRE_VISIT | DURING_VISIT | POST_VISIT
  taskType     String    @map("task_type") @db.VarChar(30)
  // VITALS | QUESTIONNAIRE_REVIEW | ALLERGY_CHECK | CONSENT_PREP
  // RX_EDUCATION | LAB_GUIDE | CONSENT_SIGN | PATIENT_EDUCATION
  // FOLLOW_UP_BOOKING | BILLING_GUIDE
  status       String    @default("PENDING") @map("status") @db.VarChar(20)
  // PENDING | IN_PROGRESS | COMPLETED | SKIPPED | NOT_APPLICABLE
  notes        String?   @db.Text
  completedAt  DateTime? @map("completed_at") @db.Timestamptz()
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  patient      Patient   @relation(fields: [patientId], references: [id])

  @@index([encounterId])
  @@index([nurseId, status])
  @@index([queueId])
  @@map("nurse_tasks")
}
```

### 3.3 PreVisitVitals (진료 전 바이탈)

> Encounter 모델에 바이탈 전용 필드가 없음 (objective는 자유 텍스트).
> 별도 모델로 관리하되, encounterId로 encounter 생성 시 자동 연결.
> 의사 화면에서는 objective 영역 상단에 읽기 전용 카드로 표시.

```prisma
model PreVisitVitals {
  id           String   @id @default(uuid()) @db.Uuid
  queueId      String?  @map("queue_id") @db.Uuid
  // Optional — 예약 환자가 접수 전 바이탈 측정하는 경우도 있음
  encounterId  String?  @map("encounter_id") @db.Uuid
  // encounter 생성 시 자동 연결
  patientId    String   @map("patient_id") @db.Uuid
  nurseId      String   @map("nurse_id") @db.Uuid
  systolicBp   Int?     @map("systolic_bp")
  diastolicBp  Int?     @map("diastolic_bp")
  heartRate    Int?     @map("heart_rate")
  temperature  Decimal? @db.Decimal(4, 1)
  spo2         Int?
  weight       Decimal? @db.Decimal(5, 1)
  height       Decimal? @db.Decimal(5, 1)
  bmi          Decimal? @db.Decimal(4, 1)
  painScore    Int?     @map("pain_score")
  respiratoryRate Int?  @map("respiratory_rate")
  notes        String?  @db.Text
  isAbnormal   Boolean  @default(false) @map("is_abnormal")
  // 위험 수치 자동 판정 (BP>180, SpO2<90 등)
  measuredAt   DateTime @default(now()) @map("measured_at") @db.Timestamptz()

  patient      Patient  @relation(fields: [patientId], references: [id])

  @@index([queueId])
  @@index([encounterId])
  @@index([patientId, measuredAt])
  @@map("pre_visit_vitals")
}
```

**바이탈 이상 자동 판정 규칙:**
```
위험 (isAbnormal = true):
├── BP ≥ 180/110 또는 ≤ 80/50
├── HR ≥ 130 또는 ≤ 40
├── SpO2 < 90%
├── BT ≥ 38.5℃ 또는 ≤ 35.0℃
├── RR ≥ 30 또는 ≤ 8
└── painScore ≥ 7
→ 이상 감지 시 의사에게 즉시 알림 (EventEmitter2)
```

---

## 4. API 설계

### 4.1 CareTeam (의료팀 편성) API

| # | Method | Endpoint | 설명 | 권한 |
|---|--------|----------|------|------|
| 1 | GET | `/api/v1/care-teams` | 팀 목록 (부서별/의사별) | ADMIN |
| 2 | POST | `/api/v1/care-teams` | 팀 편성 | ADMIN |
| 3 | PATCH | `/api/v1/care-teams/:id` | 팀 수정 | ADMIN |
| 4 | DELETE | `/api/v1/care-teams/:id` | 팀 해제 | ADMIN |
| 5 | GET | `/api/v1/care-teams/my` | 내 팀 조회 (로그인 간호사/의사) | ALL |
| 6 | GET | `/api/v1/care-teams/doctor/:doctorId` | 의사의 담당 간호사 | DOCTOR, ADMIN |

### 4.2 NurseStation (간호 워크스테이션) API

| # | Method | Endpoint | 설명 | 권한 |
|---|--------|----------|------|------|
| 7 | GET | `/api/v1/nurse-station/queue` | 담당 의사의 대기 환자 목록 | NURSE |
| 8 | GET | `/api/v1/nurse-station/tasks/:queueId` | 환자별 간호 업무 목록 | NURSE |
| 9 | POST | `/api/v1/nurse-station/tasks/:queueId/generate` | 간호 업무 자동 생성 | NURSE |
| 10 | PATCH | `/api/v1/nurse-station/tasks/:taskId/complete` | 업무 완료 처리 | NURSE |
| 11 | PATCH | `/api/v1/nurse-station/tasks/:taskId/skip` | 업무 건너뛰기 | NURSE |
| 12 | GET | `/api/v1/nurse-station/stats` | 오늘 업무 통계 | NURSE |

### 4.3 PreVisitVitals (진료 전 바이탈) API

| # | Method | Endpoint | 설명 | 권한 |
|---|--------|----------|------|------|
| 13 | POST | `/api/v1/nurse-station/vitals/:queueId` | 바이탈 측정 기록 | NURSE |
| 14 | GET | `/api/v1/nurse-station/vitals/:queueId` | 바이탈 조회 | NURSE, DOCTOR |

### 4.4 PostVisit (진료 후 간호) API

| # | Method | Endpoint | 설명 | 권한 |
|---|--------|----------|------|------|
| 15 | POST | `/api/v1/nurse-station/educate/:encounterId` | 환자 교육 기록 | NURSE |
| 16 | POST | `/api/v1/schedule` | 후속 예약 생성 (기존 API 재활용 — NURSE 권한 추가) | NURSE, DOCTOR, ADMIN |
| 17 | GET | `/api/v1/nurse-station/rx-guide/:encounterId` | 처방 설명 가이드 (기존 `/api/v1/ai/patient-education` 활용) | NURSE |
| 18 | PATCH | `/api/v1/consent/:id/sign` | 동의서 서명 수집 (witnessId에 간호사 ID 자동 기록) | NURSE, DOCTOR |

> **후속 예약**: 별도 API 신규 생성 불필요 — 기존 `POST /api/v1/schedule`에 NURSE 권한만 추가.
> **처방 설명**: 기존 `POST /api/v1/ai/patient-education` API로 약물별 교육 자료 생성 가능.
> **동의서**: 기존 ConsentForm.witnessId 필드 활용 — 간호사가 서명 수집 시 자동 기록.

---

## 5. 프론트엔드 설계

### 5.1 간호사 워크스테이션 (`/nurse-station`)

```
┌─ 외래 간호 워크스테이션 ─────────────────────────────────────────────┐
│                                                                      │
│  담당 의사: 김내과 (내과)  │  오늘 예약: 18명  │  완료: 5/18         │
│                                                                      │
│  ── 환자 대기열 ──────────────────────────────────────────────────── │
│                                                                      │
│  #  환자명     예약시간   상태           진행률        작업           │
│  1  강도현    09:00    ⬜ 바이탈 대기    0/5         [호출] [준비]   │
│  2  박영수    09:15    🟡 바이탈 완료    2/5         [진료 전달]     │
│  3  이순자    09:30    🟢 진료중         3/5          -              │
│  4  최미영    09:45    ⬜ 접수 완료      0/5         [호출] [준비]   │
│  5  홍길동    10:00    🔵 진료 후 교육   4/5         [교육] [예약]   │
│                                                                      │
│  ── 선택 환자: 박영수 ──────────────────────────────────────────── │
│                                                                      │
│  ┌─ 진료 전 (Pre-Visit) ────────────────────────────────────────┐   │
│  │  ✅ ① 바이탈 측정  BP 130/85, HR 72, BT 36.5, SpO2 98%    │   │
│  │  ✅ ② 문진표 확인  포털 제출 완료 (2026-05-20)              │   │
│  │  ⬜ ③ 알레르기 확인  [확인 완료]                             │   │
│  │  ⬜ ④ 동의서 준비  위내시경 동의서 필요 [준비 완료]          │   │
│  │  ⬜ ⑤ 진료 준비 완료  [의사에게 전달]                       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─ 진료 후 (Post-Visit) — 의사 서명 후 활성화 ────────────────┐   │
│  │  ⬜ ⑥ 처방 설명  아모디핀 5mg: 1일 1회, 아침 식후           │   │
│  │  ⬜ ⑦ 검사 안내  CBC + LFT → 1층 검사실                    │   │
│  │  ⬜ ⑧ 동의서 서명  위내시경 동의서 [서명 수집]               │   │
│  │  ⬜ ⑨ 환자 교육  고혈압 생활수칙 [교육 완료]                │   │
│  │  ⬜ ⑩ 후속 예약  [예약 생성] — 4주 후 재진                  │   │
│  │  ⬜ ⑪ 수납 안내  [수납 대기열 이동]                          │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2 바이탈 측정 모달

```
┌─ 바이탈 측정 — 박영수 ──────────────────┐
│                                          │
│  혈압:    [130] / [85]  mmHg             │
│  맥박:    [72]  bpm                      │
│  체온:    [36.5] ℃                       │
│  산소포화도: [98]  %                      │
│  체중:    [68.5] kg                       │
│  신장:    [172]  cm    BMI: 23.2          │
│  통증점수: [○○○●○○○○○○] 3/10            │
│                                          │
│  메모: [____________________]            │
│                                          │
│  [저장]  [취소]                           │
└──────────────────────────────────────────┘
```

### 5.3 처방 설명 가이드 (AI 생성)

```
┌─ 처방 설명 가이드 — 박영수 ─────────────────────────────┐
│                                                          │
│  📋 약물 처방 (2건)                                      │
│                                                          │
│  1. 아모디핀 5mg                                         │
│     복용법: 1일 1회, 아침 식후 30분                      │
│     주의사항: 어지러움 발생 시 운전 주의                  │
│     부작용: 발목 부종, 안면홍조 (일시적)                  │
│                                                          │
│  2. 아토르바스타틴 20mg                                   │
│     복용법: 1일 1회, 저녁 식후                            │
│     주의사항: 근육통 발생 시 즉시 내원                    │
│     부작용: 근육통, 간수치 상승 (정기 검사 필요)          │
│                                                          │
│  🔬 검사 안내 (1건)                                      │
│     CBC + LFT → 1층 검사실 (채혈)                        │
│     공복 불필요, 10분 소요                                │
│                                                          │
│  [인쇄]  [환자 포털 전송]  [교육 완료 체크]              │
└──────────────────────────────────────────────────────────┘
```

### 5.4 후속 예약 패널

```
┌─ 후속 예약 — 박영수 ──────────────────────────┐
│                                                │
│  진료과: 내과  │  담당의: 김내과               │
│  방문유형: [● 재진  ○ 검사 후 재진]            │
│                                                │
│  예약일: [2026-06-17]  (4주 후 추천)           │
│  예약시간: [09:00 ▼]                           │
│                                                │
│  메모: 혈액검사 결과 확인 + 혈압 모니터링       │
│                                                │
│  [예약 생성]  [취소]                            │
└────────────────────────────────────────────────┘
```

### 5.5 사이드바 메뉴 추가

```
임상
├── 대시보드
├── 환자 관리
├── 예약
├── 간호 워크스테이션  ← 신규 (NURSE, ADMIN)
├── 처방(CPOE)
├── ...
```

### 5.6 의사 진료 화면 연동

의사 encounter/new 페이지에서:
- **진료 전 바이탈**: 간호사가 측정한 바이탈 자동 표시 (Objective 섹션)
- **간호사 메모**: 문진표 리뷰 결과, 특이사항 배너로 표시
- **준비 상태 표시**: "간호사 준비 완료 ✅" 배지

---

## 6. NurseTask 자동 생성 규칙

### 6.1 PRE_VISIT 태스크 (접수 시 자동 생성)

| taskType | 항상 생성 | 조건부 생성 | 조건 |
|----------|:--------:|:---------:|------|
| VITALS | ✅ | - | 모든 외래 환자 |
| QUESTIONNAIRE_REVIEW | - | ✅ | 포털 문진표 제출 이력 있을 때 |
| ALLERGY_CHECK | ✅ | - | 모든 환자 (알레르기 확인 의무) |
| CONSENT_PREP | - | ✅ | 시술/수술/특수검사 예약 시 |
| READY_NOTIFY | ✅ | - | 모든 환자 (진료 준비 완료 알림) |

### 6.2 POST_VISIT 태스크 (의사 서명 후 자동 생성)

| taskType | 항상 생성 | 조건부 생성 | 조건 |
|----------|:--------:|:---------:|------|
| RX_EDUCATION | - | ✅ | 약물 처방 있을 때 |
| LAB_GUIDE | - | ✅ | 검사 처방 있을 때 |
| CONSENT_SIGN | - | ✅ | 미서명 동의서 있을 때 |
| PATIENT_EDUCATION | - | ✅ | 만성질환/신규 진단 시 |
| FOLLOW_UP_BOOKING | - | ✅ | 의사가 "재진 필요" 표시 시 |
| BILLING_GUIDE | ✅ | - | 모든 환자 (수납 안내) |

### 6.3 진료과별 특수 태스크 (템플릿)

| 진료과 | 추가 PRE_VISIT 태스크 |
|--------|---------------------|
| 안과 | VISUAL_ACUITY (시력측정), IOP_CHECK (안압측정) |
| 이비인후과 | HEARING_TEST (청력검사) |
| 피부과 | PHOTO_RECORD (병변 사진 촬영) |
| 소아청소년과 | GROWTH_MEASURE (성장 측정 — 두위/체중/신장) |
| 산부인과 | URINE_TEST (소변검사), WEIGHT_CHECK (체중 측정) |
| 내과 | BLOOD_SUGAR (혈당 측정 — 당뇨 환자) |
| 정형외과 | XRAY_CONFIRM (영상 촬영 여부 확인) |

> 진료과별 템플릿은 관리자 설정에서 커스터마이즈 가능.

---

## 7. 이벤트 연동

### 7.1 EventEmitter2 이벤트 흐름

```
queue.checked_in
  → NurseTask 자동 생성 (PRE_VISIT 5개 항목)

nurse.vitals_completed
  → WaitingQueue 상태 → VITALS_DONE
  → 의사 화면에 바이탈 데이터 표시
  → isAbnormal=true 시 의사에게 즉시 알림 (nurse.vitals_abnormal 이벤트)

nurse.pre_visit_ready
  → WaitingQueue 상태 → READY_FOR_DOCTOR
  → 의사에게 "다음 환자 준비 완료" 알림

encounter.signed
  → NurseTask 추가 생성 (POST_VISIT 6개 항목)
  → 간호 워크스테이션에 "진료 후 업무" 활성화

nurse.post_visit_completed
  → WaitingQueue 상태 → CASHIER_WAITING
  → 수납 대기열 이동
```

### 7.2 WaitingQueue 상태 확장

```
현재:
WAITING → CALLED → IN_CONSULTATION → CASHIER_WAITING → ...

확장:
WAITING
  → NURSE_CALLED (간호사 호출)
  → VITALS_DONE (바이탈 측정 완료)
  → READY_FOR_DOCTOR (진료 준비 완료)
  → CALLED (의사 호출)
  → IN_CONSULTATION (진료 중)
  → POST_VISIT_NURSING (진료 후 간호)
  → CASHIER_WAITING (수납 대기)
  → ...
```

---

## 8. 구현 우선순위

| Phase | 항목 | 난이도 | 예상 | 의존성 |
|:-----:|------|:------:|:----:|--------|
| 1 | CareTeam 모델 + API (팀 편성 CRUD) | 낮음 | 2h | - |
| 2 | NurseTask + PreVisitVitals 모델 + API | 중간 | 3h | Phase 1 |
| 3 | 간호 워크스테이션 페이지 (대기열 + 체크리스트) | 중간 | 4h | Phase 2 |
| 4 | 바이탈 측정 → 의사 encounter에 자동 반영 | 중간 | 2h | Phase 2 |
| 5 | 진료 후 간호 (처방 설명/교육/후속 예약) | 중간 | 3h | Phase 3 |
| 6 | EventEmitter2 이벤트 연동 + 상태 흐름 | 중간 | 2h | Phase 2 |
| 7 | 관리자 팀 편성 UI + 간호사 대시보드 개편 | 낮음 | 2h | Phase 1 |

**총 예상: 18시간 (7 Phase)**

---

## 9. 비기능 요구사항

| 항목 | 요구 |
|------|------|
| 실시간성 | 대기열 + 업무 상태 10초 자동 갱신 |
| 권한 | 간호 워크스테이션은 NURSE/ADMIN만 접근 |
| 팀 바인딩 | 간호사 로그인 시 담당 의사 환자만 표시 |
| 바이탈 연동 | PreVisitVitals → encounter 화면 상단 읽기 전용 카드 (objective 자동 삽입 아님) |
| 바이탈 알림 | isAbnormal=true 시 의사에게 즉시 알림 (nurse.vitals_abnormal 이벤트) |
| AI 연동 | 처방 설명 가이드 → 기존 `/api/v1/ai/patient-education` API 활용 |
| 동의서 | 간호사 서명 수집 시 ConsentForm.witnessId에 자동 기록 |
| 후속 예약 | 기존 `/api/v1/schedule` API 재활용 (NURSE 권한 추가) |
| 감사 | NurseTask 완료/건너뛰기 기록 audit |
| 인쇄 | 환자 교육 자료, 처방 설명서 인쇄 가능 |

---

## 10. 연관 시스템

| 시스템 | 연동 포인트 |
|--------|------------|
| waiting-queue | 간호사 호출 + 상태 전이 (NURSE_CALLED → VITALS_DONE → READY_FOR_DOCTOR) |
| encounter | 바이탈 자동 반영, 서명 후 간호 업무 생성 |
| consent | 동의서 준비 + 서명 수집 연동 |
| schedule | 후속 예약 생성 |
| questionnaire | 문진표 제출 여부 확인 |
| billing | 진료 후 수납 안내 → 수납 대기열 |
| medical-ai | 처방 설명 가이드 AI 생성 |
| portal | 환자 교육 자료 포털 전송 |
| journey | 여정 이벤트 발행 (간호 단계 추적) |

---

## 11. 운영 모드 (간호사 부재 대응)

> 모든 외래가 간호사를 배정하는 것은 아님. 간호사 없이 운영하는 외래도 존재.

### 11.1 팀 모드 (기본)
- CareTeam 편성된 외래 → 간호 워크스테이션 활성화
- 모든 간호 업무 체크리스트 적용

### 11.2 솔로 모드 (간호사 부재)
- CareTeam 미편성 외래 → 기존 흐름 유지 (접수 → 의사 → 서명 → 수납)
- NurseTask 자동 생성 안 함
- 바이탈은 의사가 직접 입력 (encounter objective)

### 11.3 판정 로직
```typescript
// 환자 접수 시
const careTeam = await getCareTeamByDoctor(doctorId, 'OUTPATIENT');
if (careTeam) {
  // 팀 모드 → NurseTask 생성 + 간호 워크스테이션 표시
  await generateNurseTasks(queueId, careTeam.nurseId);
} else {
  // 솔로 모드 → 기존 흐름 (NurseTask 없이 바로 의사 대기)
}
```

---

## 12. 향후 확장

| 항목 | 설명 |
|------|------|
| 입원 팀 편성 | CareTeam.teamType = 'INPATIENT' — 주치의 + 담당간호사 + 전공의 |
| 간호 인수인계 | 외래 간호사 간 교대 시 인수인계 |
| 간호 업무량 분석 | 간호사별 일/주/월 업무 통계 |
| 환자 만족도 연동 | 간호 서비스 만족도 별도 수집 |
| 간호사 알림 | 실시간 알림 (WebSocket) — 의사 서명 완료, 환자 도착 등 |
| 대기열 우선순위 변경 | 간호사가 환자 순서 조정 (응급/노약자 우선 등 규칙 기반) |
| 진료과별 템플릿 관리 | 관리자 페이지에서 진료과별 간호 체크리스트 커스터마이즈 |

---

## 13. 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1 | 2026-05-20 | 초기 기획 — 7 Phase, API 17개 |
| v2 | 2026-05-20 | 검토 반영 — 복수 의사 담당, 바이탈 이상 알림, 진료과별 템플릿, 솔로 모드, 기존 API 재활용, 동의서 witnessId 연동, NurseTask 생성 규칙 매트릭스 |
