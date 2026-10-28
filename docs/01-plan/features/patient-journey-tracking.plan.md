# 환자 여정 추적 시스템 (Patient Journey Tracking)

> **상태(2026-09-15 코드 대조 갱신)**: 구현됨(일부) — apps/api/src/modules/journey/journey.controller.ts:35 기간 보고서 :patientId/report(S4 `dedc92e3`, 경로는 journey 모듈 아래) · 여정 타임라인·보고서 열람 감사 등재(S4) · 잔여: 보고서의 진단명·병동·담당의·문서 목록(여정 이벤트로 산출 불가 — 설계 필요)

> **Feature**: patient-journey-tracking
> **Created**: 2026-05-08
> **Status**: Draft
> **Priority**: High
> **연관**: clinical-workflow-enhancement (주치의/차트연결)

---

## 1. 개요

환자의 **접수→진료→검사→입원→수술→퇴원→외래재진** 전 과정을 추적하고,
각 단계의 시간/담당자/결과를 기록하여 **네비게이션, 보고서, 질관리(QI)** 에 활용한다.

### 1.1 목적

```
┌─────────────────────────────────────────────────────────────┐
│                 환자 여정 추적 시스템                          │
│                                                              │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐                │
│  │ 추적      │   │ 네비게이션│   │ 보고서/QI │                │
│  │ (Logging) │   │ (UI)     │   │ (Report) │                │
│  └─────┬────┘   └─────┬────┘   └─────┬────┘                │
│        │              │              │                       │
│  환자별 이벤트    클릭→해당 화면    재원일수, 대기시간        │
│  자동 기록        즉시 이동         감염률, 재입원율 등       │
│  타임라인 표시    컨텍스트 유지     기간별 통계/차트          │
│                                                              │
│  활용:                                                       │
│  1. 의료진: 환자 현재 상태 파악, 이전 이력 빠른 조회         │
│  2. 간호사: 환자 위치/상태 추적, 인수인계 참고               │
│  3. 관리자: 병원 운영 지표, 질관리 보고서, EMR 인증 대응     │
│  4. 질관리: 재원일수, 응급실 체류시간, 수술 대기시간 분석    │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 현재 상태

| 데이터 | 존재 여부 | 문제 |
|--------|----------|------|
| 접수 (WaitingQueue) | ✅ | checkedInAt, calledAt, startedAt 존재 |
| 진료 (Encounter) | ✅ | createdAt, signedAt 존재 |
| 처방 (Prescription) | ✅ | createdAt 존재 |
| 오더 (Order) | ✅ | 상태별 타임스탬프 존재 |
| 응급 (EmergencyVisit) | ✅ | arrivalAt, dispositionAt 존재 |
| 입원 (Admission) | ✅ | admitDate, dischargeDate 존재 |
| 수술 (Surgery) | ✅ | scheduledAt, startedAt, endedAt 존재 |
| **통합 추적** | ❌ | **각 모듈별 분산, 통합 뷰 없음** |
| **이벤트 로그** | ❌ | **상태 변경 이력이 개별 필드에만 존재** |
| **네비게이션** | ❌ | **이벤트 클릭→해당 화면 이동 불가** |
| **질관리 지표** | ❌ | **집계/분석 API 없음** |

---

## 2. 데이터 모델

### 2.1 환자 이벤트 로그 (PatientJourneyEvent)

모든 임상 이벤트를 단일 테이블에 기록. 기존 모듈에서 자동 발행.

```prisma
model PatientJourneyEvent {
  id           String   @id @default(uuid()) @db.Uuid
  patientId    String   @map("patient_id") @db.Uuid
  eventType    String   @map("event_type") @db.VarChar(50)
  eventAt      DateTime @map("event_at") @db.Timestamptz()
  
  // 이벤트 상세
  title        String   @db.VarChar(200)         // "내과 접수", "CBC 검사 완료"
  description  String?  @db.Text                  // 상세 설명
  department   String?  @db.VarChar(100)          // 관련 진료과
  doctorId     String?  @map("doctor_id") @db.Uuid
  doctorName   String?  @map("doctor_name") @db.VarChar(100)
  
  // 연결 (어떤 엔티티에서 발생했는지)
  refType      String?  @map("ref_type") @db.VarChar(30)
  // WAITING_QUEUE, ENCOUNTER, PRESCRIPTION, ORDER,
  // EMERGENCY_VISIT, ADMISSION, SURGERY, LAB_RESULT,
  // IMAGING_RESULT, DISCHARGE, HANDOFF, ROUND
  refId        String?  @map("ref_id") @db.Uuid   // 해당 엔티티 ID
  
  // 네비게이션
  navUrl       String?  @map("nav_url") @db.VarChar(300)  // 클릭 시 이동할 URL
  
  // 메타
  severity     String?  @db.VarChar(20)           // INFO, WARNING, CRITICAL
  metadata     Json?    @db.JsonB                 // 추가 데이터 (시간, 수치 등)
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz()

  patient      Patient  @relation(fields: [patientId], references: [id])

  @@index([patientId, eventAt])
  @@index([eventType])
  @@index([refType, refId])
  @@map("patient_journey_events")
}
```

### 2.2 이벤트 타입 정의

| eventType | 발생 시점 | title 예시 | refType | navUrl |
|-----------|----------|------------|---------|--------|
| `RECEPTION_CHECKIN` | 접수 | "내과 접수 (대기 #23)" | WAITING_QUEUE | /reception |
| `RECEPTION_CALLED` | 호출 | "내과 진료실 3 호출" | WAITING_QUEUE | /reception |
| `ENCOUNTER_START` | 진료 시작 | "내과 김내과 진료 시작" | ENCOUNTER | /patients/{id}/encounter/new |
| `ENCOUNTER_SIGNED` | 진료 완료 | "내과 진료 완료 (서명)" | ENCOUNTER | /patients/{id} |
| `PRESCRIPTION_ADDED` | 처방 | "아세트아미노펜 500mg 처방" | PRESCRIPTION | /patients/{id}/encounter/new |
| `ORDER_CREATED` | 오더 생성 | "CBC 검사 오더" | ORDER | /orders |
| `ORDER_COMPLETED` | 오더 완료 | "CBC 검사 결과 완료" | ORDER | /lab |
| `LAB_RESULT` | 검사 결과 | "CBC: WBC 8.2, Hb 13.5" | LAB_RESULT | /lab |
| `IMAGING_RESULT` | 영상 결과 | "Chest X-ray 판독 완료" | IMAGING_RESULT | /imaging |
| `ER_ARRIVAL` | 응급실 도착 | "응급실 도착 (KTAS 2)" | EMERGENCY_VISIT | /emergency |
| `ER_TRIAGE` | 트리아지 | "KTAS 2 분류, 복통" | EMERGENCY_VISIT | /emergency |
| `ER_TREATMENT_START` | ER 치료 시작 | "응급의학과 강응급 치료 시작" | EMERGENCY_VISIT | /emergency |
| `ER_DISPOSITION` | ER 귀결 | "입원 결정 (외과)" | EMERGENCY_VISIT | /emergency |
| `ADMISSION` | 입원 | "외과 병동 301호 입원" | ADMISSION | /inpatient/{id} |
| `ATTENDING_CHANGE` | 주치의 변경 | "주치의: 김내과→박내과" | ADMISSION | /inpatient/{id} |
| `BED_TRANSFER` | 병상 이동 | "301호→305호 전동" | ADMISSION | /inpatient/{id} |
| `SURGERY_START` | 수술 시작 | "충수절제술 시작" | SURGERY | /surgery/{id} |
| `SURGERY_COMPLETE` | 수술 완료 | "충수절제술 완료 (45분)" | SURGERY | /surgery/{id} |
| `ROUND` | 회진 | "아침 회진 (이외과)" | ADMISSION | /inpatient/{id} |
| `HANDOFF` | 인수인계 | "ER→외과 인수인계" | ADMISSION | /inpatient/{id} |
| `DISCHARGE` | 퇴원 | "퇴원 (재원 5일)" | ADMISSION | /inpatient/{id} |
| `FOLLOWUP_SCHEDULED` | 외래 예약 | "2주 후 외래 재진 예약" | APPOINTMENT | /schedule |
| `ALERT` | 알림 | "DUR 경고: 약물 상호작용" | — | — |

---

## 3. API 설계

### 3.1 여정 타임라인

```
GET /api/v1/patients/:patientId/journey
    ?from=2026-05-01                  // 기간 필터
    &to=2026-05-08
    &types=ENCOUNTER,ADMISSION,SURGERY // 이벤트 타입 필터
    &limit=100

Response: {
  data: {
    patient: { id, mrn, name },
    events: [
      {
        id: "uuid",
        eventType: "RECEPTION_CHECKIN",
        eventAt: "2026-05-01T09:00:00Z",
        title: "내과 접수 (대기 #23)",
        department: "내과",
        doctorName: "김내과",
        severity: "INFO",
        refType: "WAITING_QUEUE",
        refId: "uuid",
        navUrl: "/reception",
        metadata: { queueNumber: 23, waitMinutes: 15 }
      },
      {
        eventType: "ENCOUNTER_START",
        eventAt: "2026-05-01T09:15:00Z",
        title: "내과 김내과 진료 시작",
        ...
      },
      ...
    ],
    summary: {
      totalEvents: 24,
      firstEvent: "2026-05-01T09:00:00Z",
      lastEvent: "2026-05-05T10:00:00Z",
      totalDays: 5,
      departments: ["내과", "외과", "응급의학과"],
      doctors: ["김내과", "강응급", "이외과"]
    }
  }
}
```

### 3.2 질관리 지표 API

```
GET /api/v1/qi/metrics
    ?from=2026-05-01&to=2026-05-31
    &department=내과

Response: {
  data: {
    period: { from: "2026-05-01", to: "2026-05-31" },
    
    // 접수/외래
    outpatient: {
      totalVisits: 1247,
      avgWaitMinutes: 18,
      maxWaitMinutes: 65,
      waitOver30Min: 89,              // 30분 초과 대기 건수
      waitOver30MinRate: 7.1,         // %
    },
    
    // 응급실
    emergency: {
      totalVisits: 312,
      avgStayHours: 4.2,             // 평균 체류시간
      stayOver6Hours: 45,            // 6시간 초과
      stayOver6HoursRate: 14.4,      // %
      admissionRate: 28.5,           // 입원 전환율 %
      ktasDistribution: {
        level1: 8, level2: 42, level3: 156, level4: 89, level5: 17
      },
      doorToDoctor: 12,              // 도착→의사 진료 평균 시간(분)
    },
    
    // 입원
    inpatient: {
      totalAdmissions: 189,
      avgLengthOfStay: 5.8,          // 평균 재원일수
      medianLengthOfStay: 4.0,
      longStay: 23,                   // 14일 이상 재원
      readmission30Days: 12,          // 30일 내 재입원
      readmissionRate: 6.3,           // %
      bedOccupancyRate: 78.5,         // 병상 가동률 %
      unplannedIcuTransfer: 4,        // 비계획 ICU 전환
    },
    
    // 수술
    surgery: {
      totalSurgeries: 87,
      avgOpTime: 95,                  // 평균 수술시간(분)
      cancelledSurgeries: 5,          // 수술 취소
      cancellationRate: 5.7,          // %
      sameDay: 62,                    // 당일 수술
      avgWaitDays: 3.2,              // 수술 대기일수
    },
    
    // 처방/안전
    safety: {
      durAlerts: 234,                 // DUR 경고 건수
      durOverridden: 18,              // DUR 무시 건수
      statOrders: 56,                 // STAT 오더 건수
      medicationErrors: 0,            // 투약 오류
    },
  }
}
```

### 3.3 질관리 보고서 생성

```
POST /api/v1/qi/reports
Body: {
  type: "MONTHLY",                    // MONTHLY, QUARTERLY, ANNUAL, CUSTOM
  period: { from: "2026-05-01", to: "2026-05-31" },
  department: "전체",                 // 또는 특정 과
  sections: [                         // 포함할 섹션
    "outpatient", "emergency", "inpatient", "surgery", "safety"
  ]
}

Response: {
  data: {
    reportId: "uuid",
    title: "2026년 5월 질관리 보고서",
    generatedAt: "2026-06-01T10:00:00Z",
    metrics: { ... },                 // 위 metrics와 동일 구조
    trends: {                         // 전월 대비 추세
      avgWaitMinutes: { current: 18, previous: 22, change: -18.2 },
      readmissionRate: { current: 6.3, previous: 7.1, change: -11.3 },
      ...
    },
    alerts: [                         // 기준 초과 항목
      { metric: "stayOver6HoursRate", value: 14.4, threshold: 10, severity: "WARNING" },
    ]
  }
}
```

### 3.4 개별 환자 보고서

```
GET /api/v1/patients/:patientId/journey/report
    ?admissionId=uuid                 // 특정 입원 기간

Response: {
  data: {
    patient: { id, mrn, name, dob, gender },
    admission: {
      admitDate, dischargeDate, lengthOfStay,
      attendingDoctors: [{ name, period }],
      ward: "외과 301호",
      diagnosis: "급성 충수염",
    },
    timeline: [ ... ],                // 전체 이벤트
    metrics: {
      erStayHours: 3.5,
      admitToSurgeryHours: 12,
      surgeryDuration: 45,
      totalLengthOfStay: 5,
      prescriptionCount: 12,
      labCount: 8,
      imagingCount: 3,
    },
    documents: [
      { type: "DISCHARGE_SUMMARY", id: "uuid", signedAt: "..." },
      { type: "OP_NOTE", id: "uuid", surgeryId: "..." },
      { type: "CONSENT", id: "uuid" },
    ]
  }
}
```

---

## 4. 이벤트 발행 (자동 기록)

각 모듈의 상태 변경 시 자동으로 `PatientJourneyEvent`를 생성.

### 4.1 JourneyService (이벤트 발행기)

```typescript
@Injectable()
export class JourneyService {
  async emit(event: {
    patientId: string;
    eventType: string;
    title: string;
    description?: string;
    department?: string;
    doctorId?: string;
    doctorName?: string;
    refType?: string;
    refId?: string;
    navUrl?: string;
    severity?: string;
    metadata?: any;
  }) {
    return this.prisma.patientJourneyEvent.create({
      data: { ...event, eventAt: new Date() },
    });
  }
}
```

### 4.2 발행 위치

| 모듈 | 메서드 | 이벤트 |
|------|--------|--------|
| `WaitingQueueService.checkIn()` | 접수 완료 시 | RECEPTION_CHECKIN |
| `WaitingQueueService.callNext()` | 호출 시 | RECEPTION_CALLED |
| `WaitingQueueService.startConsultation()` | 진료 시작 시 | ENCOUNTER_START |
| `EncounterService.sign()` | 서명 시 | ENCOUNTER_SIGNED |
| `PrescriptionService.create()` | 처방 시 | PRESCRIPTION_ADDED |
| `OrderService.createFromPrescription()` | 오더 생성 시 | ORDER_CREATED |
| `OrderService.changeStatus(COMPLETED)` | 오더 완료 시 | ORDER_COMPLETED |
| `EmergencyService.register()` | ER 등록 시 | ER_ARRIVAL |
| `EmergencyService.startTreatment()` | ER 치료 시 | ER_TREATMENT_START |
| `EmergencyService.dispose()` | ER 귀결 시 | ER_DISPOSITION |
| `InpatientService.admit()` | 입원 시 | ADMISSION |
| `InpatientService.discharge()` | 퇴원 시 | DISCHARGE |
| `InpatientService.transfer()` | 전동 시 | BED_TRANSFER |
| `SurgeryService.start()` | 수술 시작 시 | SURGERY_START |
| `SurgeryService.complete()` | 수술 완료 시 | SURGERY_COMPLETE |

---

## 5. UI 설계

### 5.1 환자 여정 타임라인 (/patients/:id/journey)

```
┌─ 환자 여정: 김영수 (P2026-0001) ───────────────────────────────┐
│                                                                  │
│  기간: [2026-05-01] ~ [2026-05-10]   필터: [전체▼]              │
│                                                                  │
│  ━━━━━━━━━━━━ 타임라인 ━━━━━━━━━━━━                              │
│                                                                  │
│  05/01 09:00  ○ 내과 접수 (대기 #23)              [접수→]        │
│               │  대기 15분                                       │
│  05/01 09:15  ● 내과 김내과 진료 시작              [진료→]       │
│               │                                                  │
│  05/01 09:30  ○ CBC, 전해질, 간기능 검사 오더      [오더→]       │
│  05/01 09:30  ○ 복부 CT 오더                       [오더→]       │
│  05/01 09:45  ○ 아세트아미노펜 500mg 처방          [처방→]       │
│  05/01 10:00  ● 내과 진료 완료 (서명)              [차트→]       │
│               │                                                  │
│  05/01 14:00  🔴 응급실 도착 (KTAS 2)              [응급→]       │
│               │  급성 복통                                       │
│  05/01 14:05  ○ KTAS 2 분류                                     │
│  05/01 14:15  ● 강응급 치료 시작                                 │
│  05/01 16:00  ○ CT 결과: 충수염 확진                             │
│  05/01 16:30  🟡 입원 결정 (외과)                  [입원→]       │
│               │  ER→외과 인수인계                                │
│               │                                                  │
│  05/01 17:00  ● 외과 301호 입원                    [입원→]       │
│               │  주치의: 이외과                                   │
│               │                                                  │
│  05/02 08:00  ○ 아침 회진 (이외과)                               │
│  05/02 09:00  🔴 충수절제술 시작                    [수술→]       │
│  05/02 09:45  ● 충수절제술 완료 (45분)              [수술→]       │
│               │                                                  │
│  05/03 08:00  ○ 아침 회진 — 경과 양호                            │
│  05/04 08:00  ○ 아침 회진 — 식이 진행                            │
│               │                                                  │
│  05/05 10:00  ● 퇴원 (재원 5일)                    [퇴원→]       │
│               │  퇴원 요약서 작성                                 │
│               │                                                  │
│  05/10 10:00  ○ 외래 재진 (외과 이외과)            [진료→]       │
│               │  수술 부위 확인, 발사                             │
│                                                                  │
│  ━━━━━━━━━━━━ 요약 ━━━━━━━━━━━━                                  │
│  총 이벤트: 18건  |  기간: 10일  |  진료과: 내과, 응급, 외과     │
│  ER 체류: 2.5시간 | 재원: 5일 | 수술: 1건 (45분)                 │
│                                                                  │
│              [보고서 생성]  [PDF 내보내기]                        │
└──────────────────────────────────────────────────────────────────┘
```

### 5.2 질관리 대시보드 (/admin/qi)

```
┌─ 질관리 지표 ──────────────────────────────────────────────────┐
│                                                                 │
│  기간: [2026년 5월▼]   과: [전체▼]   [보고서 생성]              │
│                                                                 │
│  ┌───────────┬───────────┬───────────┬───────────┐             │
│  │ 외래       │ 응급       │ 입원       │ 수술       │             │
│  │ 1,247건    │ 312건      │ 189건      │ 87건       │             │
│  │ 대기 18분  │ 체류 4.2h  │ 재원 5.8일 │ 95분       │             │
│  │ ▼4분 ↓     │ ▼0.3h ↓   │ ▲0.2일 ↑  │ ▼5분 ↓    │             │
│  └───────────┴───────────┴───────────┴───────────┘             │
│                                                                 │
│  ⚠️ 주의 지표                                                    │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ 🔴 응급실 6시간 초과 체류: 14.4% (기준: 10%)         │      │
│  │ 🟡 30일 내 재입원율: 6.3% (기준: 5%)                 │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                 │
│  ┌─ 추세 차트 ──────────────────────────────────────────┐      │
│  │  평균 대기시간 (월별)                                 │      │
│  │  25 ┤                                                 │      │
│  │  20 ┤    ──*──                                       │      │
│  │  15 ┤          ──*──*──                               │      │
│  │  10 ┤                                                 │      │
│  │      Jan  Feb  Mar  Apr  May                          │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                 │
│  ┌─ 부서별 현황 ────────────────────────────────────────┐      │
│  │ 내과    │ 523건 │ 대기 22분 │ 재원 4.2일 │           │      │
│  │ 외과    │ 312건 │ 대기 15분 │ 재원 6.8일 │           │      │
│  │ 정형외과 │ 189건 │ 대기 12분 │ 재원 8.1일 │           │      │
│  └──────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. 구현 우선순위

> **전제**: clinical-workflow-enhancement Phase 1 완료 후 진행
> (ChargeOfCare, ClinicalHandoff 모델이 먼저 존재해야 Journey 이벤트 발행 가능)

### Phase 1: 이벤트 로깅 + 타임라인 (P0)

```
1. PatientJourneyEvent 모델 + DB 테이블
2. JourneyService (이벤트 발행)
3. 기존 모듈에 이벤트 발행 코드 삽입 (10개 모듈)
4. GET /patients/:id/journey API (타임라인) ← /patients/:id/timeline 통합
5. 환자 상세 페이지에 여정 탭 추가
```

### Phase 2: 질관리 지표 (P0)

```
1. GET /qi/metrics API (원본 테이블 직접 집계 — Journey 테이블 미사용)
   ※ QI 정확도를 위해 WaitingQueue, Admission, Surgery 등 원본에서 집계
2. POST /qi/reports API (보고서 생성)
3. /admin/qi 대시보드 페이지
4. 기간별/부서별 필터
5. 기준 초과 자동 알림
```

### Phase 3: 네비게이션 + 보고서 (P1)

```
1. 타임라인 이벤트 클릭 → navUrl 이동
2. 개별 환자 보고서 (GET /patients/:id/journey/report)
3. PDF 내보내기
4. 추세 차트 (월별 비교)
5. EMR 인증 대응 보고서 양식
```

## 6-1. 데이터 관리 정책

```
PatientJourneyEvent 테이블 볼륨 관리:
- 예상: 환자 400명 × 방문당 20이벤트 × 월 3회 = 24,000건/월
- 1년: ~290,000건 (관리 가능)
- 3년 이상: 아카이빙 정책 필요
  → 퇴원 후 1년 지난 이벤트 → archive 테이블 이동
  → 또는 partitioned table (연도별)
```

---

## 7. 질관리 지표 정의

### 7.1 외래

| 지표 | 계산 | 기준 | 출처 |
|------|------|------|------|
| 평균 대기시간 | AVG(startedAt - checkedInAt) | < 30분 | WaitingQueue |
| 30분 초과 대기율 | COUNT(>30분) / 전체 | < 10% | WaitingQueue |
| 진료 완료율 | SIGNED / 전체 Encounter | > 95% | Encounter |
| DUR 경고 발생률 | DUR 건수 / 처방 건수 | 모니터링 | Prescription |

### 7.2 응급실

| 지표 | 계산 | 기준 | 출처 |
|------|------|------|------|
| 평균 체류시간 | AVG(dispositionAt - arrivalAt) | < 4시간 | EmergencyVisit |
| 6시간 초과 체류율 | COUNT(>6h) / 전체 | < 10% | EmergencyVisit |
| Door-to-Doctor | AVG(treatmentStartedAt - arrivalAt) | < 15분 | EmergencyVisit |
| 입원 전환율 | ADMISSION / 전체 | 참고 | EmergencyVisit |
| KTAS 1-2 비율 | COUNT(level≤2) / 전체 | 참고 | EmergencyVisit |

### 7.3 입원

| 지표 | 계산 | 기준 | 출처 |
|------|------|------|------|
| 평균 재원일수 | AVG(dischargeDate - admitDate) | 과별 상이 | Admission |
| 14일 이상 장기 재원 | COUNT(>14일) | 최소화 | Admission |
| 30일 내 재입원율 | 재입원 / 전체 퇴원 | < 5% | Admission |
| 병상 가동률 | 사용병상 / 전체병상 | 80~90% | Bed + Admission |
| 비계획 ICU 전환 | 응급 ICU 이동 건수 | 최소화 | IcuAdmission |

### 7.4 수술

| 지표 | 계산 | 기준 | 출처 |
|------|------|------|------|
| 수술 취소율 | CANCELLED / 전체 | < 5% | Surgery |
| 평균 수술시간 | AVG(endedAt - startedAt) | 술식별 상이 | Surgery |
| 수술 대기일수 | AVG(startedAt - scheduledAt) | < 7일 | Surgery |
| 수술 후 감염률 | 감염 건수 / 수술 건수 | < 2% | Surgery + Infection |

---

## 8. EMR 인증 대응

질관리 보고서는 **EMR 인증 기준**의 다음 항목에 대응:

| EMR 인증 항목 | 대응 지표 |
|--------------|----------|
| 진료 기록 완결성 | Encounter 서명 완료율 |
| 처방 안전 | DUR 경고/무시 건수 |
| 응급 진료 | Door-to-Doctor, 체류시간 |
| 감염 관리 | 수술 후 감염률, 항생제 사용 |
| 환자 안전 | 투약 오류, STAT 오더 |
| 퇴원 관리 | 재입원율, 퇴원 요약서 작성률 |
