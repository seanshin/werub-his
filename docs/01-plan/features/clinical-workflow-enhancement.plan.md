# 임상 워크플로우 고도화 — 주치의·차트 연결·입퇴원 흐름

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/prisma/schema.prisma:9063 model ClinicalHandoff · apps/api/prisma/schema.prisma:9094 model BedAssignment · apps/api/prisma/schema.prisma:9111 model Round · 잔여: 없음

> **Feature**: clinical-workflow-enhancement
> **Created**: 2026-05-08
> **Status**: Draft
> **Priority**: Critical

---

## 1. 개요

응급실→입원, 외래→입원, 입원 중 주치의 변경, 진료 차트 연결 등
**실제 병원 운영에 필수적인 임상 워크플로우**가 다수 누락되어 있다.

### 1.1 현재 상태 vs 필요 상태

```
[현재]                              [필요]
                                    
응급실 ─── admissionId ──→ 입원     응급실 ─── 핸드오프 기록 ──→ 입원
  (doctorId 1명 고정)                 (ER 의사 → 주치의 인수인계)
                                    
외래 진료 ──── (끊김) ──── 입원     외래 진료 ──── 차트 연결 ──── 입원
  (Encounter)    (Admission)          (Encounter ←→ Admission 연결)
                                    
입원 ──── 주치의 1명 고정           입원 ──── 주치의 교대/변경 이력
  (admittingDoctorId 불변)            (ChargeOfCare 히스토리)
                                    
병상 ──── 현재만 기록              병상 ──── 이동 이력 전체
  (bedId 덮어쓰기)                   (BedAssignment 히스토리)
                                    
회진 ──── 없음                     회진 ──── 회진 기록 + 스케줄
  (ProgressNote만)                   (Round 모델)
```

### 1.2 Gap 분석 요약

| 영역 | 현재 | 필요 | 심각도 |
|------|------|------|--------|
| **주치의 설정/변경** | 입원 시 1회 설정, 변경 불가 | 교대/변경 이력 + 핸드오프 | 🔴 Critical |
| **응급실 주치의** | ER doctorId 1명 고정 | 담당의 배정 + 교대 | 🔴 Critical |
| **차트 연결** | Encounter ↔ Admission 단절 | 외래→입원 차트 연속성 | 🔴 Critical |
| **ER→입원 인수인계** | admissionId만 연결 | 핸드오프 기록 (인계자/인수자/요약) | 🟡 High |
| **병상 이동 이력** | bedId 덮어쓰기 | BedAssignment 히스토리 | 🟡 High |
| **회진 기록** | ProgressNote (비구조화) | Round 모델 (아침/저녁/야간) | 🟡 High |
| **입원 오더 연결** | Order→Prescription→Encounter (외래) | 입원 중 오더 직접 연결 | 🟡 High |
| **약물 조정** | 없음 | 입원 시 약물 목록 확인/조정 | 🟠 Medium |
| **ICU 연동** | 별도 모듈 (IcuAdmission) | 일반병동 ↔ ICU 전환 | 🟠 Medium |
| **수술→입원 연동** | Surgery.admissionId (선택) | 수술 오더→입원 워크플로우 | 🟠 Medium |

---

## 2. 기능 요구사항

### 2.1 주치의(Attending Physician) 관리

| ID | 기능 | 설명 | 우선순위 |
|----|------|------|----------|
| AP-01 | 입원 시 주치의 지정 | 입원 생성 시 주치의 설정 (기존 admittingDoctorId) | P0 |
| AP-02 | 주치의 변경 | 입원 중 주치의 교체 (사유 기록) | P0 |
| AP-03 | 주치의 이력 | ChargeOfCare 테이블 — 누가 언제부터 언제까지 | P0 |
| AP-04 | 현재 주치의 조회 | 환자/입원 단위 현재 주치의 빠른 조회 | P0 |
| AP-05 | 진료팀 설정 | 주치의 외 담당 전공의/간호사 배정 | P1 |
| AP-06 | 자동 배정 | 병동/과별 당직표 기반 주치의 자동 추천 | P2 |

**주치의 교대 흐름:**
```
입원 (Day 1)
  주치의: 김내과 선생님 (ChargeOfCare #1: assignedAt=Day1 09:00)
    │
Day 3 — 김내과 부재 (학회)
  주치의 변경: 박내과 선생님
  ChargeOfCare #1: releasedAt=Day3 08:00, reason="학회 참석"
  ChargeOfCare #2: assignedAt=Day3 08:00
    │
Day 5 — 김내과 복귀
  주치의 변경: 김내과 선생님
  ChargeOfCare #2: releasedAt=Day5 09:00
  ChargeOfCare #3: assignedAt=Day5 09:00
    │
퇴원 (Day 7)
  ChargeOfCare #3: releasedAt=Day7 10:00
  
이력: 김내과(Day1~3) → 박내과(Day3~5) → 김내과(Day5~7)
```

### 2.2 응급실 주치의/담당의

| ID | 기능 | 설명 | 우선순위 |
|----|------|------|----------|
| ER-01 | ER 담당의 배정 | 응급 환자에 담당의 배정 | P0 |
| ER-02 | ER 담당의 교대 | 당직 교대 시 담당의 변경 + 인계 | P0 |
| ER-03 | ER→입원 핸드오프 | ER 의사 → 입원 주치의 인수인계 기록 | P0 |
| ER-04 | ER 당직표 연동 | 응급실 당직 스케줄 기반 자동 배정 | P1 |

**ER→입원 핸드오프:**
```
┌─ 응급실 ─────────────────────────────────────────┐
│ 환자: 김영수  |  KTAS 2  |  담당의: 강응급         │
│ 진단: 급성 복통 r/o 충수염                         │
│                                                    │
│  [입원 의뢰] ────────────────────────────────────  │
│  ├─ 입원 사유: 충수염 의심, 수술 필요               │
│  ├─ 인계 내용:                                     │
│  │   - VS: BP 130/80, HR 90, BT 38.2              │
│  │   - 진통제 투여 중 (케토롤락 30mg IV)            │
│  │   - CT 결과 대기 중                              │
│  │   - NPO 상태                                    │
│  ├─ 인계 의사: 강응급 (ER)                          │
│  └─ 인수 의사: 이외과 (GS)                          │
│                                                    │
│  인수 확인: [이외과 서명]  →  입원 생성              │
└────────────────────────────────────────────────────┘
```

### 2.3 차트 연결 (Encounter ↔ Admission)

| ID | 기능 | 설명 | 우선순위 |
|----|------|------|----------|
| CL-01 | 외래→입원 연결 | Encounter에서 입원 전환 시 차트 연결 | P0 |
| CL-02 | 입원 중 진료 기록 | Admission 하위에 Encounter 생성 가능 | P0 |
| CL-03 | 통합 차트 뷰 | 환자 기준 외래+입원+ER 차트 통합 타임라인 | P0 |
| CL-04 | 컨설트 연결 | 타과 의뢰 시 Encounter 생성 + Admission 연결 | P1 |
| CL-05 | 수술 연결 | Surgery ↔ Admission ↔ Encounter 3자 연결 | P1 |

**통합 차트 타임라인:**
```
환자: 김영수 (P2026-0001)
──────────────────────────────────────────────────────
2026-05-01  외래 (내과 — 김내과)          Encounter #1
            S: 복통 2일간, A: r/o 충수염
            → CT 오더, 혈액검사

2026-05-01  응급실 방문 (KTAS 2)          EmergencyVisit #1
            담당: 강응급 → CT 결과: 충수염 확진
            → 입원 의뢰

2026-05-01  입원 (외과 — 이외과)          Admission #1
            ├─ ChargeOfCare: 이외과 (05/01~05/05)
            ├─ Encounter #2 (입원 초진)
            ├─ 수술 (05/02)              Surgery #1
            ├─ Encounter #3 (수술 후 경과)
            ├─ Round (05/03 아침) — 이외과
            ├─ Round (05/04 아침) — 이외과
            └─ 퇴원 (05/05)

2026-05-10  외래 재진 (외과 — 이외과)     Encounter #4
            → 수술 부위 확인, 발사
──────────────────────────────────────────────────────
```

### 2.4 병상 이동 이력

| ID | 기능 | 설명 | 우선순위 |
|----|------|------|----------|
| BA-01 | 병상 배정 기록 | 입원/전동 시 BedAssignment 생성 | P0 |
| BA-02 | 이동 이력 조회 | 입원 기간 중 병상 이동 전체 이력 | P0 |
| BA-03 | ICU 전환 | 일반 병동 → ICU 전환 기록 | P1 |

### 2.5 회진 관리

| ID | 기능 | 설명 | 우선순위 |
|----|------|------|----------|
| RD-01 | 회진 기록 | 아침/저녁/야간 회진 기록 | P1 |
| RD-02 | 회진 스케줄 | 병동별 회진 시간 설정 | P2 |
| RD-03 | 회진 팀 | 주치의 + 전공의 + 간호사 팀 | P2 |

### 2.6 입원 오더 연결

| ID | 기능 | 설명 | 우선순위 |
|----|------|------|----------|
| IO-01 | 입원 오더 | Admission에서 직접 오더 생성 (Encounter 불필요) | P1 |
| IO-02 | Standing 오더 | 입원 기간 중 반복 오더 (매일 혈당 체크 등) | P1 |
| IO-03 | 약물 조정 | 입원 시 기존 투약 목록 확인/조정 | P2 |

---

## 3. 데이터 모델 변경

### 3.1 신규 모델

```prisma
// 주치의 이력 (Charge of Care)
model ChargeOfCare {
  id           String    @id @default(uuid()) @db.Uuid
  admissionId  String    @map("admission_id") @db.Uuid
  doctorId     String    @map("doctor_id") @db.Uuid
  role         String    @default("ATTENDING") @db.VarChar(30) // ATTENDING, RESIDENT, CONSULTANT
  assignedAt   DateTime  @map("assigned_at") @db.Timestamptz()
  releasedAt   DateTime? @map("released_at") @db.Timestamptz()
  reason       String?   @db.VarChar(200) // 변경 사유
  handoffNote  String?   @map("handoff_note") @db.Text // 인계 내용
  assignedBy   String?   @map("assigned_by") @db.Uuid

  admission    Admission @relation(fields: [admissionId], references: [id])
  doctor       User      @relation("ChargeOfCareDoctor", fields: [doctorId], references: [id])

  @@index([admissionId, releasedAt])
  @@index([doctorId])
  @@map("charge_of_care")
}

// ER→입원 인수인계
model ClinicalHandoff {
  id              String   @id @default(uuid()) @db.Uuid
  type            String   @db.VarChar(30) // ER_TO_ADMISSION, SHIFT_CHANGE, ICU_TRANSFER
  patientId       String   @map("patient_id") @db.Uuid
  fromDoctorId    String   @map("from_doctor_id") @db.Uuid
  toDoctorId      String   @map("to_doctor_id") @db.Uuid
  emergencyVisitId String? @map("emergency_visit_id") @db.Uuid
  admissionId     String?  @map("admission_id") @db.Uuid
  summary         String   @db.Text // 인계 요약
  vitalSigns      Json?    @map("vital_signs") @db.JsonB
  pendingItems    Json?    @map("pending_items") @db.JsonB // 대기 중 검사/결과
  acknowledgedAt  DateTime? @map("acknowledged_at") @db.Timestamptz() // 인수 확인
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz()

  patient      Patient @relation(fields: [patientId], references: [id])
  fromDoctor   User    @relation("HandoffFrom", fields: [fromDoctorId], references: [id])
  toDoctor     User    @relation("HandoffTo", fields: [toDoctorId], references: [id])

  @@index([patientId])
  @@index([admissionId])
  @@map("clinical_handoffs")
}

// 병상 배정 이력
model BedAssignment {
  id           String    @id @default(uuid()) @db.Uuid
  admissionId  String    @map("admission_id") @db.Uuid
  bedId        String    @map("bed_id") @db.Uuid
  assignedAt   DateTime  @map("assigned_at") @db.Timestamptz()
  releasedAt   DateTime? @map("released_at") @db.Timestamptz()
  reason       String?   @db.VarChar(200) // ADMISSION, TRANSFER, ICU_TRANSFER, DISCHARGE

  admission    Admission @relation(fields: [admissionId], references: [id])
  bed          Bed       @relation(fields: [bedId], references: [id])

  @@index([admissionId])
  @@index([bedId, releasedAt])
  @@map("bed_assignments")
}

// 회진 기록
model Round {
  id           String   @id @default(uuid()) @db.Uuid
  admissionId  String   @map("admission_id") @db.Uuid
  doctorId     String   @map("doctor_id") @db.Uuid
  roundType    String   @map("round_type") @db.VarChar(20) // MORNING, EVENING, NIGHT, AD_HOC
  roundedAt    DateTime @map("rounded_at") @db.Timestamptz()
  notes        String?  @db.Text
  assessment   String?  @db.Text // 상태 평가
  plan         String?  @db.Text // 치료 계획 변경
  vitalSigns   Json?    @map("vital_signs") @db.JsonB
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz()

  admission    Admission @relation(fields: [admissionId], references: [id])
  doctor       User      @relation("RoundDoctor", fields: [doctorId], references: [id])

  @@index([admissionId, roundedAt])
  @@map("rounds")
}
```

### 3.2 기존 모델 변경

```prisma
// Encounter — 입원 연결 필드 추가
model Encounter {
  // 기존 필드 유지
  admissionId  String? @map("admission_id") @db.Uuid  // 입원 연결
  visitType    String? @map("visit_type") @db.VarChar(30)
  // OUTPATIENT, INPATIENT, ER_CONSULT, INPATIENT_CONSULT
}

// Admission — 현재 주치의 + 관계 추가
model Admission {
  // 기존 필드 유지
  attendingDoctorId String? @map("attending_doctor_id") @db.Uuid // 현재 주치의 (캐시)
  
  chargeOfCare   ChargeOfCare[]
  bedAssignments BedAssignment[]
  rounds         Round[]
  encounters     Encounter[]     // 입원 중 진료 기록
  handoffs       ClinicalHandoff[]
}

// EmergencyVisit — 담당의 이력
model EmergencyVisit {
  // 기존 필드 유지
  handoffs ClinicalHandoff[]
}
```

---

## 4. API 설계

### 4.1 주치의 관리

```
GET    /api/v1/inpatient/:admissionId/attending        현재 주치의 조회
PATCH  /api/v1/inpatient/:admissionId/attending        주치의 변경
GET    /api/v1/inpatient/:admissionId/care-team        진료팀 전체 (이력 포함)
POST   /api/v1/inpatient/:admissionId/care-team        진료팀 멤버 추가
```

### 4.2 인수인계

```
POST   /api/v1/handoffs                                인수인계 생성
GET    /api/v1/handoffs/patient/:patientId              환자별 인수인계 이력
PATCH  /api/v1/handoffs/:id/acknowledge                 인수 확인 (서명)
GET    /api/v1/handoffs/pending                         미확인 인수인계 목록
```

### 4.3 차트 연결

```
POST   /api/v1/encounters (기존) + admissionId 파라미터  입원 중 진료 기록 생성
GET    /api/v1/patients/:id/timeline                    통합 차트 타임라인
       → Encounter + Admission + EmergencyVisit + Surgery 통합
```

### 4.4 병상 이력

```
GET    /api/v1/inpatient/:admissionId/bed-history       병상 이동 이력
```

### 4.5 회진

```
POST   /api/v1/inpatient/:admissionId/rounds            회진 기록 추가
GET    /api/v1/inpatient/:admissionId/rounds             회진 이력
GET    /api/v1/rounds/today                              오늘 회진 대상 목록
```

---

## 5. 핵심 워크플로우 개선

### 5.1 응급실→입원 전체 흐름 (개선)

```
[1] 응급실 도착 → 트리아지 (KTAS)
        │
[2] ER 담당의 배정
    ChargeOfCare: 강응급 (ER)
        │
[3] 검사/처치 → 입원 결정
        │
[4] 입원 의뢰 + 핸드오프 생성
    ClinicalHandoff {
      type: ER_TO_ADMISSION
      from: 강응급 (ER)
      to: 이외과 (GS)
      summary: "충수염 의심, NPO, 진통제 투여중"
      pendingItems: ["CT 결과 대기"]
    }
        │
[5] 입원 주치의 인수 확인
    handoff.acknowledgedAt = now()
        │
[6] Admission 생성
    ├─ attendingDoctorId: 이외과
    ├─ ChargeOfCare #1: 이외과 (assignedAt: now)
    ├─ BedAssignment #1: 외과 301호
    ├─ Encounter #입원초진 (admissionId 연결)
    └─ EmergencyVisit.status = ADMISSION_COMPLETED
```

### 5.2 입원 중 주치의 변경

```
PATCH /api/v1/inpatient/:admissionId/attending
Body: {
  newDoctorId: "박내과-uuid",
  reason: "학회 참석으로 인한 주치의 교체",
  handoffNote: "현재 투약 유지, 내일 혈액검사 예정"
}

내부 처리:
1. 현재 ChargeOfCare.releasedAt = now()
2. 새 ChargeOfCare 생성 (assignedAt = now)
3. Admission.attendingDoctorId = newDoctorId
4. ClinicalHandoff 생성 (type: SHIFT_CHANGE)
```

### 5.3 통합 차트 타임라인

```
GET /api/v1/patients/:id/timeline

Response: {
  data: {
    timeline: [
      { type: "ENCOUNTER", date: "2026-05-01", doctor: "김내과", dept: "내과",
        summary: "복통, r/o 충수염", encounterId: "..." },
      { type: "EMERGENCY", date: "2026-05-01", doctor: "강응급",
        ktas: 2, disposition: "ADMISSION", emergencyVisitId: "..." },
      { type: "ADMISSION", date: "2026-05-01", doctor: "이외과", ward: "외과 301호",
        admissionId: "..." },
      { type: "SURGERY", date: "2026-05-02", surgeon: "이외과",
        procedure: "충수절제술", surgeryId: "..." },
      { type: "ROUND", date: "2026-05-03", doctor: "이외과",
        roundType: "MORNING", notes: "경과 양호" },
      { type: "DISCHARGE", date: "2026-05-05",
        summary: "충수절제술 후 경과 양호하여 퇴원" },
      { type: "ENCOUNTER", date: "2026-05-10", doctor: "이외과", dept: "외과",
        summary: "수술 부위 확인, 발사", encounterId: "..." },
    ]
  }
}
```

---

## 6. 구현 우선순위

### Phase 1: 주치의 + 차트 연결 (Critical)

```
1. ChargeOfCare 모델 + 마이그레이션
2. ClinicalHandoff 모델 + 마이그레이션
3. Encounter.admissionId, Admission.attendingDoctorId 필드 추가
4. 주치의 변경 API (PATCH /inpatient/:id/attending)
5. 인수인계 API (POST /handoffs, PATCH /acknowledge)
6. 통합 타임라인 API (GET /patients/:id/timeline)
7. 기존 입원 시 ChargeOfCare 자동 생성
8. ER dispose(ADMISSION) 시 핸드오프 자동 생성
```

### Phase 2: 병상 이력 + 회진 (High)

```
1. BedAssignment 모델 + 마이그레이션
2. Round 모델 + 마이그레이션
3. 병상 이동 이력 API
4. 회진 기록 API
5. 기존 transfer/admit 시 BedAssignment 자동 생성
6. 오늘 회진 대상 목록 API
```

### Phase 3: UI + 고도화 (Medium)

```
1. 입원 상세 페이지에 주치의 변경 UI
2. 인수인계 화면
3. 통합 차트 타임라인 UI
4. 회진 기록 UI
5. 병상 이동 이력 표시
6. ICU ↔ 일반 병동 전환
7. 입원 약물 조정
```

---

## 7. 구현 순서 (Journey Tracking 연관)

```
[1단계] clinical-workflow Phase 1 (주치의 + 차트연결 + 핸드오프)
    ├─ ChargeOfCare, ClinicalHandoff 모델
    ├─ Encounter.admissionId, Admission.attendingDoctorId
    └─ 주치의 변경, 인수인계, 타임라인 API
         │
[2단계] patient-journey-tracking Phase 1 (이벤트 로깅)
    ├─ PatientJourneyEvent 모델
    ├─ JourneyService (이벤트 발행)
    └─ 기존 모듈 + 1단계 신규 모듈에 발행 코드 삽입
         │
[3단계] clinical-workflow Phase 2 (병상이력 + 회진)
    ├─ BedAssignment, Round 모델
    └─ Journey 이벤트 자동 발행 포함
         │
[4단계] patient-journey-tracking Phase 2 (질관리 지표)
    ├─ QI 지표 API (원본 테이블 직접 집계)
    └─ /admin/qi 대시보드
         │
[5단계] 통합 UI (Phase 3)
    ├─ 환자 여정 타임라인 (네비게이션)
    ├─ 입원 상세 주치의/회진/병상 UI
    └─ 질관리 보고서 생성
```

> **중요**: GET /patients/:id/timeline은 Journey 이벤트 테이블에서 조회.
> QI 지표는 원본 테이블(WaitingQueue, Admission 등)에서 직접 집계.

---

## 8. 영향 범위

| 모듈 | 변경 사항 |
|------|-----------|
| `inpatient` | 주치의 변경, BedAssignment 이력, Round |
| `emergency` | 핸드오프 생성, 담당의 교대 |
| `encounter` | admissionId 필드, visitType |
| `admission` | attendingDoctorId 캐시, 관계 추가 |
| `surgery` | Admission 연결 강화 |
| `patient` | 통합 타임라인 API |
| `prisma/schema` | 4개 신규 모델, 3개 기존 모델 변경 |
