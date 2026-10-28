# Hospital RUN 대학병원급 확장 기획서 v2.0

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/prisma/schema.prisma:12265 model ClinicalPathway · apps/api/src/modules/mdt/ · apps/api/prisma/schema.prisma:12419 model CancerRegistry · 잔여: 중앙암등록본부 보고(대외 전송)(사람); IRB 실운영(위원회 구성)(사람)

> **작성일**: 2026-05-22
> **대상**: 500병상+ 대학병원 / 상급종합병원
> **현재 규모**: 118모듈, 1,440 API, 254 모델
> **v2.0 변경**: 신규 모듈 우선 (운영 전이므로 인프라는 후순위)

---

## 1. 우선순위 전략

실제 운영 전이므로 **기능 완성도**를 최우선으로 한다.
인프라/보안/성능 강화는 운영 직전(Go-Live 8주 전)에 집중한다.

```
[즉시]  Phase A (6주) — 대학병원 핵심 신규 모듈 5개
[이후]  Phase B (4주) — 기존 모듈 대학병원급 고도화 5개
[이후]  Phase C (4주) — 연구/교육/행정 모듈 4개
[운영전] Phase D (4주) — 인프라/보안/성능 (v1.0 기획서 Phase 1~4)
```

---

## 2. 현재 갭 분석 요약

| 모듈 | 상태 | 필요 작업량 |
|------|------|------------|
| **임상경로 (Clinical Pathway)** | 미구현 | 신규 |
| **다학제 진료 (Tumor Board/MDT)** | 미구현 | 신규 |
| **암 등록 (Cancer Registry)** | 미구현 | 신규 |
| **임상 연구 (IRB/CDM/OMOP)** | 미구현 | 신규 |
| **원가 분석 (ABC Costing)** | 미구현 | 신규 |
| ICU 고도화 | 기본 구현 (10 API) | 확장 |
| 장기이식 고도화 | 기본 구현 (11 API) | 확장 |
| 레지던트 교육 | 직원교육만 (5 API) | 대폭 확장 |
| 당직/근무 스케줄링 | Workgroup 내 3 API | 분리 + 확장 |
| 환자 만족도 | Portal 내 2 API | 분리 + 분석 확장 |

---

## 3. Phase A — 핵심 신규 모듈 (6주)

### A1. 임상경로 (Clinical Pathway)

> 표준화된 진료 프로토콜 정의 → 환자 적용 → 변이 추적 → 결과 분석

#### 데이터 모델

```prisma
model ClinicalPathway {
  id            String   @id @default(uuid()) @db.Uuid
  code          String   @unique @db.VarChar(30)   // "CP-AMI-001"
  name          String   @db.VarChar(200)           // "급성심근경색 표준경로"
  department    String   @db.VarChar(50)
  targetDrg     String?  @map("target_drg") @db.VarChar(20)
  version       Int      @default(1)
  status        String   @default("DRAFT") @db.VarChar(20) // DRAFT, ACTIVE, RETIRED
  totalDays     Int      @map("total_days")         // 예상 재원일수
  description   String?  @db.Text
  createdBy     String   @map("created_by") @db.Uuid
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  milestones    PathwayMilestone[]
  assignments   PathwayAssignment[]

  @@index([department, status])
  @@map("clinical_pathways")
}

model PathwayMilestone {
  id          String   @id @default(uuid()) @db.Uuid
  pathwayId   String   @map("pathway_id") @db.Uuid
  day         Int                                     // 경로 내 일차 (Day 0, 1, 2...)
  category    String   @db.VarChar(30)                // ASSESSMENT, ORDER, MEDICATION, DIET, EDUCATION, DISCHARGE
  title       String   @db.VarChar(200)
  detail      Json?    @db.JsonB                      // 오더 템플릿, 교육 체크리스트 등
  isRequired  Boolean  @default(true) @map("is_required")
  sortOrder   Int      @default(0) @map("sort_order")

  pathway     ClinicalPathway @relation(fields: [pathwayId], references: [id])
  outcomes    MilestoneOutcome[]

  @@index([pathwayId, day])
  @@map("pathway_milestones")
}

model PathwayAssignment {
  id          String   @id @default(uuid()) @db.Uuid
  pathwayId   String   @map("pathway_id") @db.Uuid
  patientId   String   @map("patient_id") @db.Uuid
  encounterId String   @map("encounter_id") @db.Uuid
  startDate   DateTime @map("start_date") @db.Date
  status      String   @default("ACTIVE") @db.VarChar(20) // ACTIVE, COMPLETED, DEVIATED, CANCELLED
  deviations  Int      @default(0)
  actualDays  Int?     @map("actual_days")
  note        String?  @db.Text
  assignedBy  String   @map("assigned_by") @db.Uuid
  createdAt   DateTime @default(now()) @map("created_at")
  completedAt DateTime? @map("completed_at")

  pathway     ClinicalPathway @relation(fields: [pathwayId], references: [id])
  outcomes    MilestoneOutcome[]

  @@index([patientId])
  @@index([status])
  @@map("pathway_assignments")
}

model MilestoneOutcome {
  id            String   @id @default(uuid()) @db.Uuid
  assignmentId  String   @map("assignment_id") @db.Uuid
  milestoneId   String   @map("milestone_id") @db.Uuid
  actualDay     Int      @map("actual_day")
  status        String   @db.VarChar(20)             // DONE, SKIPPED, DELAYED, DEVIATED
  variance      String?  @db.Text                    // 변이 사유
  performedBy   String?  @map("performed_by") @db.Uuid
  performedAt   DateTime @default(now()) @map("performed_at")

  assignment    PathwayAssignment @relation(fields: [assignmentId], references: [id])
  milestone     PathwayMilestone @relation(fields: [milestoneId], references: [id])

  @@index([assignmentId])
  @@map("milestone_outcomes")
}
```

#### API 설계 (16개)

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | /pathways | 경로 목록 (부서별 필터) |
| POST | /pathways | 경로 생성 |
| GET | /pathways/:id | 경로 상세 (마일스톤 포함) |
| PATCH | /pathways/:id | 경로 수정 |
| POST | /pathways/:id/publish | DRAFT → ACTIVE 발행 |
| POST | /pathways/:id/retire | ACTIVE → RETIRED 폐기 |
| POST | /pathways/:id/clone | 경로 복사 (새 버전) |
| POST | /pathways/:id/milestones | 마일스톤 추가 |
| PATCH | /pathways/milestones/:id | 마일스톤 수정 |
| DELETE | /pathways/milestones/:id | 마일스톤 삭제 |
| POST | /pathways/:id/assign | 환자에게 경로 적용 |
| GET | /pathways/assignments | 적용 현황 목록 |
| GET | /pathways/assignments/:id | 적용 상세 + 진행률 |
| POST | /pathways/assignments/:id/outcome | 마일스톤 완료/변이 기록 |
| PATCH | /pathways/assignments/:id/cancel | 경로 적용 취소 |
| GET | /pathways/analytics | 경로별 변이율/재원일수/완수율 통계 |

#### FE 화면 (4개)

| 화면 | 설명 |
|------|------|
| 경로 관리 목록 | 부서별 경로 카드, 상태 필터, 생성/복제 |
| 경로 편집기 | Day별 타임라인 + 마일스톤 드래그&드롭 편집 |
| 환자 경로 현황 | 진행 중 경로 목록 + 일차별 체크리스트 |
| 경로 분석 대시보드 | 완수율/변이율/재원일수 차트 |

---

### A2. 다학제 진료 (Tumor Board / MDT Conference)

> 암/중증 환자에 대해 여러 진료과가 합동으로 치료 계획을 결정하는 회의 시스템

#### 데이터 모델

```prisma
model MdtConference {
  id              String   @id @default(uuid()) @db.Uuid
  title           String   @db.VarChar(200)          // "유방암 다학제 #43"
  conferenceType  String   @map("conference_type") @db.VarChar(30) // TUMOR_BOARD, MORBIDITY_MORTALITY, CASE_CONFERENCE
  department      String   @db.VarChar(50)
  scheduledAt     DateTime @map("scheduled_at")
  location        String?  @db.VarChar(100)          // 회의실/화상링크
  status          String   @default("SCHEDULED") @db.VarChar(20) // SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED
  chairpersonId   String   @map("chairperson_id") @db.Uuid
  notes           String?  @db.Text                  // 회의 전체 메모
  recordingUrl    String?  @map("recording_url") @db.Text
  createdAt       DateTime @default(now()) @map("created_at")

  cases           MdtCase[]
  attendees       MdtAttendee[]

  @@index([department, scheduledAt])
  @@map("mdt_conferences")
}

model MdtCase {
  id            String   @id @default(uuid()) @db.Uuid
  conferenceId  String   @map("conference_id") @db.Uuid
  patientId     String   @map("patient_id") @db.Uuid
  presenterId   String   @map("presenter_id") @db.Uuid
  primaryDiag   String   @map("primary_diag") @db.VarChar(200)
  tnmStage      String?  @map("tnm_stage") @db.VarChar(30) // T2N1M0 등
  clinicalSummary String? @map("clinical_summary") @db.Text
  imagingSummary  String? @map("imaging_summary") @db.Text
  pathologySummary String? @map("pathology_summary") @db.Text
  labSummary      String? @map("lab_summary") @db.Text
  proposedPlan    String? @map("proposed_plan") @db.Text    // 발표자 제안
  decision        String? @db.Text                          // 합의된 결정
  decisionCategory String? @map("decision_category") @db.VarChar(30) // SURGERY, CHEMO, RADIATION, COMBINED, PALLIATIVE, OBSERVATION
  followUp        String? @map("follow_up") @db.Text
  sortOrder       Int     @default(0) @map("sort_order")

  conference    MdtConference @relation(fields: [conferenceId], references: [id])

  @@index([conferenceId])
  @@index([patientId])
  @@map("mdt_cases")
}

model MdtAttendee {
  id            String   @id @default(uuid()) @db.Uuid
  conferenceId  String   @map("conference_id") @db.Uuid
  userId        String   @map("user_id") @db.Uuid
  department    String   @db.VarChar(50)
  role          String   @db.VarChar(20)             // CHAIR, PRESENTER, DISCUSSANT, OBSERVER
  attended      Boolean  @default(false)

  conference    MdtConference @relation(fields: [conferenceId], references: [id])

  @@unique([conferenceId, userId])
  @@map("mdt_attendees")
}
```

#### API 설계 (14개)

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | /mdt/conferences | 회의 목록 (부서/상태 필터) |
| POST | /mdt/conferences | 회의 생성 |
| GET | /mdt/conferences/:id | 회의 상세 (케이스/참석자 포함) |
| PATCH | /mdt/conferences/:id | 회의 수정 |
| POST | /mdt/conferences/:id/start | 회의 시작 |
| POST | /mdt/conferences/:id/complete | 회의 종료 + 결과 확정 |
| POST | /mdt/conferences/:id/cases | 케이스 등록 |
| PATCH | /mdt/cases/:id | 케이스 수정 (결정사항 기록) |
| DELETE | /mdt/cases/:id | 케이스 제거 |
| POST | /mdt/cases/:id/auto-summary | AI 임상 요약 자동 생성 |
| POST | /mdt/conferences/:id/attendees | 참석자 추가 |
| PATCH | /mdt/attendees/:id | 참석 여부 업데이트 |
| GET | /mdt/patient/:patientId | 환자별 MDT 이력 |
| GET | /mdt/stats | 회의/결정 통계 |

#### FE 화면 (4개)

| 화면 | 설명 |
|------|------|
| 회의 캘린더 | 주간/월간 일정, 진료과 필터 |
| 회의 상세 | 케이스 리스트 + 참석자 + 결정사항 입력 |
| 케이스 발표 뷰 | 환자 요약(영상/병리/검사) + 치료 결정 폼 |
| MDT 이력/통계 | 환자별 이력, 부서별 회의 통계 |

---

### A3. 암 등록 (Cancer Registry)

> 암 진단/치료/추적 데이터의 체계적 등록 + 중앙암등록본부 보고

#### 데이터 모델

```prisma
model CancerRegistry {
  id                String   @id @default(uuid()) @db.Uuid
  patientId         String   @map("patient_id") @db.Uuid
  registrationNo    String   @unique @map("registration_no") @db.VarChar(20) // CR-2026-00001
  diagnosisDate     DateTime @map("diagnosis_date") @db.Date
  primarySite       String   @map("primary_site") @db.VarChar(10)  // ICD-O-3 Topography (C50.9)
  morphology        String   @db.VarChar(10)                        // ICD-O-3 Morphology (8500/3)
  behavior          String   @db.VarChar(5)                         // /0, /1, /2, /3
  grade             String?  @db.VarChar(5)                         // G1~G4, GX
  laterality        String?  @db.VarChar(10)                        // LEFT, RIGHT, BILATERAL, NA
  diagnosisBasis    String   @map("diagnosis_basis") @db.VarChar(20) // HISTOLOGY, CYTOLOGY, IMAGING, CLINICAL
  icdCode           String   @map("icd_code") @db.VarChar(10)       // KCD C50.1
  tnmClinical       String?  @map("tnm_clinical") @db.VarChar(20)   // cT2N1M0
  tnmPathological   String?  @map("tnm_pathological") @db.VarChar(20) // pT2N1M0
  ajccStage         String?  @map("ajcc_stage") @db.VarChar(10)     // IIA, IIIB
  ajccEdition       Int?     @map("ajcc_edition")                    // 8
  firstTreatment    String?  @map("first_treatment") @db.VarChar(30)  // SURGERY, CHEMO, RADIATION, COMBINED
  firstTreatmentDate DateTime? @map("first_treatment_date") @db.Date
  recurrenceDate    DateTime? @map("recurrence_date") @db.Date
  recurrenceSite    String?  @map("recurrence_site") @db.VarChar(100)
  vitalStatus       String   @default("ALIVE") @map("vital_status") @db.VarChar(20) // ALIVE, DEAD_CANCER, DEAD_OTHER, LOST
  lastContactDate   DateTime? @map("last_contact_date") @db.Date
  deathDate         DateTime? @map("death_date") @db.Date
  causeOfDeath      String?  @map("cause_of_death") @db.VarChar(10)
  registrarId       String   @map("registrar_id") @db.Uuid
  status            String   @default("REGISTERED") @db.VarChar(20) // REGISTERED, VERIFIED, REPORTED, CLOSED
  reportedToKccr    Boolean  @default(false) @map("reported_to_kccr") // 중앙암등록본부 보고 여부
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  treatments        CancerTreatment[]
  followUps         CancerFollowUp[]

  @@index([patientId])
  @@index([primarySite])
  @@index([status])
  @@map("cancer_registries")
}

model CancerTreatment {
  id            String   @id @default(uuid()) @db.Uuid
  registryId    String   @map("registry_id") @db.Uuid
  treatmentType String   @map("treatment_type") @db.VarChar(30) // SURGERY, CHEMOTHERAPY, RADIATION, HORMONE, IMMUNOTHERAPY, TARGETED, TRANSPLANT
  startDate     DateTime @map("start_date") @db.Date
  endDate       DateTime? @map("end_date") @db.Date
  regimen       String?  @db.VarChar(200)               // FOLFOX, AC-T 등
  cycles        Int?
  response      String?  @db.VarChar(20)                 // CR, PR, SD, PD (RECIST)
  surgeryType   String?  @map("surgery_type") @db.VarChar(100)
  radiationDose String?  @map("radiation_dose") @db.VarChar(50) // 60Gy/30fr
  note          String?  @db.Text

  registry      CancerRegistry @relation(fields: [registryId], references: [id])

  @@index([registryId])
  @@map("cancer_treatments")
}

model CancerFollowUp {
  id              String   @id @default(uuid()) @db.Uuid
  registryId      String   @map("registry_id") @db.Uuid
  followUpDate    DateTime @map("follow_up_date") @db.Date
  status          String   @db.VarChar(20)               // NED, AWD, DOD, DOC, LOST
  recurrence      Boolean  @default(false)
  metastasisSite  String?  @map("metastasis_site") @db.VarChar(100)
  performanceStatus String? @map("performance_status") @db.VarChar(10) // ECOG 0~4
  note            String?  @db.Text
  recordedBy      String   @map("recorded_by") @db.Uuid

  registry        CancerRegistry @relation(fields: [registryId], references: [id])

  @@index([registryId])
  @@map("cancer_follow_ups")
}
```

#### API 설계 (16개)

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | /cancer-registry | 등록 목록 (부위/병기/상태 필터) |
| POST | /cancer-registry | 신규 등록 |
| GET | /cancer-registry/:id | 상세 (치료/추적 포함) |
| PATCH | /cancer-registry/:id | 수정 |
| POST | /cancer-registry/:id/verify | 검증 완료 |
| POST | /cancer-registry/:id/treatments | 치료 이력 추가 |
| PATCH | /cancer-registry/treatments/:id | 치료 이력 수정 |
| POST | /cancer-registry/:id/follow-ups | 추적 기록 추가 |
| GET | /cancer-registry/:id/timeline | 진단→치료→추적 타임라인 |
| GET | /cancer-registry/patient/:patientId | 환자별 암 등록 이력 |
| GET | /cancer-registry/stats | 통계 (부위별, 병기별, 생존율) |
| GET | /cancer-registry/stats/survival | 생존 분석 (Kaplan-Meier 데이터) |
| POST | /cancer-registry/report/kccr | 중앙암등록본부 보고 데이터 생성 |
| GET | /cancer-registry/report/kccr/preview | 보고 미리보기 |
| GET | /cancer-registry/overdue-followups | 추적 누락 환자 목록 |
| POST | /cancer-registry/:id/auto-stage | AI TNM 병기 자동 산정 |

#### FE 화면 (5개)

| 화면 | 설명 |
|------|------|
| 등록 목록 | 부위/병기/상태 필터, 검색, 페이지네이션 |
| 등록 양식 | ICD-O-3 코드 선택, TNM 입력, AJCC 자동 산정 |
| 환자 타임라인 | 진단→치료→추적 시각화 |
| 통계 대시보드 | 부위별 분포, 병기별 분포, 5년 생존율 |
| KCCR 보고 | 보고 대상 목록, 미리보기, 일괄 보고 |

---

### A4. 임상 연구 (Clinical Research / IRB / CDM)

> IRB 관리 + 연구 대상자 관리 + OMOP CDM 데이터 추출

#### 데이터 모델

```prisma
model ResearchStudy {
  id            String   @id @default(uuid()) @db.Uuid
  studyNo       String   @unique @map("study_no") @db.VarChar(30) // IRB-2026-001
  title         String   @db.Text
  piUserId      String   @map("pi_user_id") @db.Uuid             // 연구책임자
  department    String   @db.VarChar(50)
  studyType     String   @map("study_type") @db.VarChar(30)      // INTERVENTIONAL, OBSERVATIONAL, RETROSPECTIVE
  phase         String?  @db.VarChar(10)                           // I, II, III, IV
  sponsor       String?  @db.VarChar(200)
  irbStatus     String   @default("SUBMITTED") @map("irb_status") @db.VarChar(20) // SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED, AMENDMENT, CLOSED
  irbApprovalDate DateTime? @map("irb_approval_date") @db.Date
  irbExpiryDate   DateTime? @map("irb_expiry_date") @db.Date
  targetEnroll  Int?     @map("target_enroll")
  currentEnroll Int      @default(0) @map("current_enroll")
  startDate     DateTime? @map("start_date") @db.Date
  endDate       DateTime? @map("end_date") @db.Date
  description   String?  @db.Text
  protocol      Json?    @db.JsonB                                 // 프로토콜 요약 구조화
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  subjects      ResearchSubject[]
  documents     ResearchDocument[]
  amendments    IrbAmendment[]

  @@index([department, irbStatus])
  @@map("research_studies")
}

model ResearchSubject {
  id            String   @id @default(uuid()) @db.Uuid
  studyId       String   @map("study_id") @db.Uuid
  patientId     String   @map("patient_id") @db.Uuid
  subjectNo     String   @map("subject_no") @db.VarChar(20)      // S001
  consentDate   DateTime @map("consent_date") @db.Date
  status        String   @default("ENROLLED") @db.VarChar(20)     // SCREENING, ENROLLED, COMPLETED, WITHDRAWN, EXCLUDED
  withdrawDate  DateTime? @map("withdraw_date") @db.Date
  withdrawReason String? @map("withdraw_reason") @db.Text
  armGroup      String?  @map("arm_group") @db.VarChar(50)        // 시험군/대조군
  enrolledBy    String   @map("enrolled_by") @db.Uuid

  study         ResearchStudy @relation(fields: [studyId], references: [id])

  @@unique([studyId, patientId])
  @@index([studyId, status])
  @@map("research_subjects")
}

model ResearchDocument {
  id          String   @id @default(uuid()) @db.Uuid
  studyId     String   @map("study_id") @db.Uuid
  docType     String   @map("doc_type") @db.VarChar(30) // PROTOCOL, CONSENT_FORM, CRF, SAE_REPORT, PROGRESS_REPORT
  version     String   @db.VarChar(10)
  fileName    String   @map("file_name") @db.VarChar(200)
  fileUrl     String   @map("file_url") @db.Text
  uploadedBy  String   @map("uploaded_by") @db.Uuid
  uploadedAt  DateTime @default(now()) @map("uploaded_at")

  study       ResearchStudy @relation(fields: [studyId], references: [id])

  @@index([studyId])
  @@map("research_documents")
}

model IrbAmendment {
  id          String   @id @default(uuid()) @db.Uuid
  studyId     String   @map("study_id") @db.Uuid
  amendmentNo Int      @map("amendment_no")
  reason      String   @db.Text
  changes     Json     @db.JsonB                      // 변경 사항 구조화
  status      String   @default("SUBMITTED") @db.VarChar(20) // SUBMITTED, APPROVED, REJECTED
  submittedAt DateTime @default(now()) @map("submitted_at")
  reviewedAt  DateTime? @map("reviewed_at")
  reviewNote  String?  @map("review_note") @db.Text

  study       ResearchStudy @relation(fields: [studyId], references: [id])

  @@index([studyId])
  @@map("irb_amendments")
}
```

#### API 설계 (20개)

| Method | Endpoint | 설명 |
|--------|----------|------|
| **연구 관리** | | |
| GET | /research/studies | 연구 목록 (부서/상태/유형 필터) |
| POST | /research/studies | 연구 등록 (IRB 신청) |
| GET | /research/studies/:id | 연구 상세 |
| PATCH | /research/studies/:id | 연구 수정 |
| POST | /research/studies/:id/approve | IRB 승인 |
| POST | /research/studies/:id/close | 연구 종료 |
| **대상자 관리** | | |
| POST | /research/studies/:id/subjects | 대상자 등록 |
| GET | /research/studies/:id/subjects | 대상자 목록 |
| PATCH | /research/subjects/:id | 대상자 상태 변경 |
| POST | /research/subjects/:id/withdraw | 대상자 철회 |
| **문서 관리** | | |
| POST | /research/studies/:id/documents | 문서 업로드 |
| GET | /research/studies/:id/documents | 문서 목록 |
| **변경 심의** | | |
| POST | /research/studies/:id/amendments | 변경 심의 신청 |
| PATCH | /research/amendments/:id | 변경 심의 결과 |
| **데이터 추출** | | |
| POST | /research/studies/:id/extract | EMR 데이터 추출 (비식별) |
| POST | /research/cdm/convert | OMOP CDM v5.4 변환 |
| GET | /research/cdm/tables | CDM 테이블 목록 + 건수 |
| **통계** | | |
| GET | /research/stats | 연구 현황 통계 |
| GET | /research/studies/:id/enrollment-chart | 등록 추이 |
| GET | /research/irb/calendar | IRB 심의 일정 |

#### FE 화면 (5개)

| 화면 | 설명 |
|------|------|
| 연구 목록 | 부서/상태/유형 필터, IRB 상태 배지 |
| 연구 상세 | 프로토콜 요약, 대상자 등록 추이, 문서 |
| IRB 심의 | 신청서 폼, 심의 일정, 결과 기록 |
| 대상자 관리 | 등록/철회, 동의서 상태, CRF 링크 |
| CDM 데이터 추출 | 조건 설정 → 비식별 추출 → 다운로드 |

---

### A5. 원가 분석 (Activity-Based Costing)

> 부서별/진료행위별 원가 산정 + 수익성 분석 + 경영 의사결정 지원

#### 데이터 모델

```prisma
model CostCenter {
  id          String   @id @default(uuid()) @db.Uuid
  code        String   @unique @db.VarChar(20)        // CC-CARD-01
  name        String   @db.VarChar(100)               // 심장내과 외래
  type        String   @db.VarChar(20)                // DIRECT_CARE, SUPPORT, ADMIN
  parentId    String?  @map("parent_id") @db.Uuid     // 상위 원가 센터
  department  String   @db.VarChar(50)
  isActive    Boolean  @default(true) @map("is_active")

  allocations CostAllocation[]

  @@map("cost_centers")
}

model CostDriver {
  id          String   @id @default(uuid()) @db.Uuid
  code        String   @unique @db.VarChar(20)        // CD-LABOR-01
  name        String   @db.VarChar(100)               // 의사 인건비
  category    String   @db.VarChar(20)                // LABOR, MATERIAL, EQUIPMENT, OVERHEAD, INDIRECT
  unit        String   @db.VarChar(20)                // HOUR, COUNT, SQMETER
  unitCost    Decimal  @map("unit_cost") @db.Decimal(12,2)
  period      String   @db.VarChar(10)                // 2026-Q1
  note        String?  @db.Text

  @@index([category, period])
  @@map("cost_drivers")
}

model CostAllocation {
  id            String   @id @default(uuid()) @db.Uuid
  costCenterId  String   @map("cost_center_id") @db.Uuid
  costDriverId  String?  @map("cost_driver_id") @db.Uuid
  period        String   @db.VarChar(10)              // 2026-Q1
  amount        Decimal  @db.Decimal(14,2)
  quantity      Decimal? @db.Decimal(10,2)
  allocatedAt   DateTime @default(now()) @map("allocated_at")
  source        String   @db.VarChar(20)              // MANUAL, AUTO, IMPORT

  costCenter    CostCenter @relation(fields: [costCenterId], references: [id])

  @@index([costCenterId, period])
  @@map("cost_allocations")
}

model ProcedureCost {
  id            String   @id @default(uuid()) @db.Uuid
  procedureCode String   @map("procedure_code") @db.VarChar(20)
  procedureName String   @map("procedure_name") @db.VarChar(200)
  period        String   @db.VarChar(10)
  directCost    Decimal  @map("direct_cost") @db.Decimal(12,2)    // 직접비
  indirectCost  Decimal  @map("indirect_cost") @db.Decimal(12,2)  // 간접비
  totalCost     Decimal  @map("total_cost") @db.Decimal(12,2)
  revenueAvg    Decimal  @map("revenue_avg") @db.Decimal(12,2)    // 평균 수익
  margin        Decimal  @db.Decimal(8,4)                          // 수익률
  volumeCount   Int      @map("volume_count")

  @@unique([procedureCode, period])
  @@map("procedure_costs")
}
```

#### API 설계 (14개)

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | /cost/centers | 원가 센터 목록 (트리) |
| POST | /cost/centers | 원가 센터 생성 |
| PATCH | /cost/centers/:id | 원가 센터 수정 |
| GET | /cost/drivers | 원가 동인 목록 |
| POST | /cost/drivers | 원가 동인 등록 |
| PATCH | /cost/drivers/:id | 원가 동인 수정 |
| POST | /cost/allocations | 비용 배분 (수동) |
| POST | /cost/allocations/auto | 자동 배분 (기간별) |
| GET | /cost/allocations | 배분 내역 조회 |
| GET | /cost/procedure-costs | 행위별 원가 목록 |
| POST | /cost/procedure-costs/calculate | 기간별 행위 원가 산출 |
| GET | /cost/analytics/department | 부서별 원가/수익 분석 |
| GET | /cost/analytics/profitability | 수익성 분석 (행위/DRG별) |
| GET | /cost/analytics/trend | 기간별 원가 추이 |

#### FE 화면 (4개)

| 화면 | 설명 |
|------|------|
| 원가 센터 관리 | 트리 구조, CRUD |
| 비용 배분 | 기간 선택 → 자동/수동 배분 → 결과 확인 |
| 행위별 원가 | 수가코드별 원가/수익/마진율 테이블 |
| 경영 대시보드 | 부서별 수익성, 추이 차트, 손익분기 |

---

## 4. Phase B — 기존 모듈 대학병원급 고도화 (4주)

### B1. ICU 고도화

| 추가 기능 | API | 설명 |
|-----------|-----|------|
| APACHE II/IV 자동 계산 | POST /icu/:id/apache | 입실 24시간 데이터 기반 |
| SOFA 점수 자동 계산 | POST /icu/:id/sofa | 매일 자동, 추이 그래프 |
| NEWS2 조기 경보 | GET /icu/alerts/news2 | 실시간 바이탈 기반 |
| 패혈증 번들 체크리스트 | POST /icu/:id/sepsis-bundle | 1h/3h 번들 항목 |
| VAP/CLABSI 번들 | POST /icu/:id/infection-bundle | 감염 예방 번들 |
| 진정/통증 평가 | POST /icu/:id/sedation | RASS, BPS, CAM-ICU |
| CRRT 관리 | POST /icu/:id/crrt | 투석액/유량/항응고 기록 |
| ECMO 관리 | POST /icu/:id/ecmo | 회로/설정/합병증 추적 |
| 인공호흡기 이탈 프로토콜 | POST /icu/:id/weaning-trial | SBT 결과 + 이탈 판정 |

**추가 API**: 9개 (기존 10 → 총 19개)

### B2. 장기이식 고도화

| 추가 기능 | API | 설명 |
|-----------|-----|------|
| KONOS 대기자 등록 | POST /transplant/konos/register | 국립장기이식관리센터 연동 |
| MELD/PELD 자동 계산 | GET /transplant/:id/meld | 검사 결과 기반 자동 |
| HLA 타이핑 기록 | POST /transplant/:id/hla | HLA-A/B/DR 항원 입력 |
| 교차 적합 시험 | POST /transplant/:id/crossmatch | CDC/FCXM 결과 |
| 면역억제제 TDM | POST /transplant/:id/tdm | 약물 농도 모니터링 |
| 이식 후 추적 | POST /transplant/:id/follow-up | 주기별 추적 기록 |
| 이식편 생존 분석 | GET /transplant/graft-survival | Kaplan-Meier 데이터 |

**추가 API**: 7개 (기존 11 → 총 18개)

### B3. 레지던트/전공의 교육 확장

| 추가 기능 | API | 설명 |
|-----------|-----|------|
| 수련 로그북 | POST /education/logbook | 시술/수술 기록 |
| 로그북 조회 | GET /education/logbook/:userId | 기간별/유형별 |
| EPA 역량 평가 | POST /education/epa | 지도전문의 평가 |
| EPA 현황 | GET /education/epa/:userId | 역량별 달성도 |
| 전공의 로테이션 | GET /education/rotations | 부서별 배정 현황 |
| 로테이션 배정 | POST /education/rotations | 전공의-부서 배정 |
| 증례 발표 등록 | POST /education/cases | 증례 등록 |
| 증례 목록 | GET /education/cases | 부서별 증례 목록 |
| 수련 통계 | GET /education/stats/:userId | 전공의 개인 대시보드 |

**추가 API**: 9개 (기존 5 → 총 14개)

### B4. 당직/근무 스케줄링 (독립 모듈 분리)

| 기능 | API | 설명 |
|------|-----|------|
| 당직표 조회 | GET /duty/schedule | 월별/부서별 |
| 당직 자동 생성 | POST /duty/auto-generate | 제약 조건 기반 최적화 |
| 당직 수동 배정 | POST /duty/assign | 수동 배정 |
| 당직 교환 요청 | POST /duty/swap-request | 교환 신청 |
| 교환 승인/거부 | PATCH /duty/swap-request/:id | 관리자 처리 |
| 근무시간 추적 | GET /duty/hours/:userId | 주간 근무시간 집계 |
| 근무시간 위반 알림 | GET /duty/violations | 80시간/주 초과 목록 |
| 콜 스케줄 | GET /duty/on-call | 당일 당직 의사 조회 |
| 휴가 관리 | POST /duty/leave | 휴가 신청 |
| 휴가 승인 | PATCH /duty/leave/:id | 승인/거부 |
| 당직 통계 | GET /duty/stats | 부서별/개인별 당직 횟수 |
| 공정성 리포트 | GET /duty/fairness | 당직 분배 공정성 지표 |

**신규 API**: 12개 (Workgroup에서 분리 + 확장)

### B5. 환자 만족도 확장 (독립 모듈 분리)

| 기능 | API | 설명 |
|------|-----|------|
| 설문 템플릿 관리 | GET/POST /satisfaction/templates | 설문 양식 CRUD |
| 자동 발송 | POST /satisfaction/dispatch | 퇴원/외래 후 자동 발송 |
| 설문 응답 | POST /satisfaction/responses | 환자 응답 저장 |
| 부서별 통계 | GET /satisfaction/stats/department | NPS + 항목별 점수 |
| 추이 분석 | GET /satisfaction/stats/trend | 월별/분기별 추이 |
| 텍스트 분석 | GET /satisfaction/stats/sentiment | AI 감성 분석 |
| 벤치마크 | GET /satisfaction/benchmark | 전국 평균 대비 |
| 개선 과제 관리 | POST /satisfaction/actions | 개선 조치 등록 |

**신규 API**: 8개 (Portal에서 분리 + 확장)

---

## 5. Phase C — 연구/교육/행정 부가 모듈 (4주)

### C1. OMOP CDM 변환 엔진

> 임상 연구 모듈(A4)과 연동하여 EMR → OMOP CDM v5.4 자동 변환

| CDM 테이블 | EMR 소스 | 변환 |
|-----------|----------|------|
| PERSON | patients | MRN→person_id, 성별/생년 |
| VISIT_OCCURRENCE | encounters | 외래/입원/응급 |
| CONDITION_OCCURRENCE | diagnosis (KCD) | KCD→SNOMED (기존 매핑 활용) |
| DRUG_EXPOSURE | prescriptions | 약품코드→RxNorm |
| PROCEDURE_OCCURRENCE | orders (시술) | EDI→SNOMED (기존 매핑 활용) |
| MEASUREMENT | lab_results | LOINC (기존 매핑 활용) |
| OBSERVATION | vitals, nursing_notes | LOINC |
| DEATH | patients (사망) | 사인 ICD-10 |

**API**: 5개 (변환 실행, 상태 조회, 테이블별 건수, 품질 리포트, 추출 다운로드)

### C2. 약사 임상 활동 기록

> 대학병원 약사의 처방 검토/중재/TDM/ADR 보고 등 임상 활동 추적

| 기능 | 설명 |
|------|------|
| 처방 검토 | 부적절 처방 발견 → 중재 기록 |
| 중재 기록 | 유형(용량/상호작용/중복), 의사 수용 여부 |
| TDM 요청/결과 | Vancomycin 등 약물 농도 모니터링 |
| ADR 보고 | 약물이상반응 보고 (KAERS 연동) |
| 항균제 관리 | 항균제 사용 승인/모니터링 (ASP) |
| 활동 통계 | 약사별/유형별 임상 활동 대시보드 |

**API**: 12개

### C3. 감염 관리 고도화

> 기존 `infection-control` 모듈에 대학병원 수준 기능 추가

| 추가 기능 | 설명 |
|-----------|------|
| HAI 감시 (KONIS 연동) | 의료관련감염 전국 감시체계 보고 |
| 항균제 내성 감시 | 내성균 발생 추적 + 항생제 감수성 패턴 |
| 격리 관리 | 격리실 배정, 해제 기준, PPE 관리 |
| 직원 감염 관리 | 직원 노출 사고, 예방접종, 건강 검진 |
| 멸균 추적 | CSSD 연동, 수술 기구 추적 |

**API**: 10개

### C4. 의료 질 지표 관리 (QI Advanced)

> 기존 `qi` 모듈에 대학병원 필수 지표 + 평가 인증 대비

| 추가 기능 | 설명 |
|-----------|------|
| 적정성 평가 지표 | HIRA 적정성 평가 10개 질환군 자동 수집 |
| 환자 안전 지표 | PSI (Patient Safety Indicators) 자동 산출 |
| 사망률 분석 | HSMR (표준화 사망비) 산출 |
| 재입원율 | 30일 재입원율 자동 추적 |
| 의료기관 인증 | JCI/KoHIAS 인증 기준 체크리스트 |
| 지표 대시보드 | 월별 추이, 벤치마크 비교, 목표 달성률 |

**API**: 10개

---

## 6. Phase D — 인프라/보안 (운영 직전, 4주)

> v1.0 기획서의 Phase 1~4 내용을 Go-Live 직전에 집중 수행

| 주차 | 작업 |
|------|------|
| D-1 | 백업 자동화 (pgBackRest → S3) + 모니터링 (Prometheus/Grafana) |
| D-2 | PgBouncer + Redis Sentinel + Bull Queue (EventEmitter 교체) |
| D-3 | MFA (TOTP) + ABAC + 감사 로그 무결성 |
| D-4 | 부하 테스트 + DR 훈련 + Go-Live 체크리스트 |

*상세 내용은 v1.0 기획서 Phase 1~4 참조*

---

## 7. 전체 수치 요약

### 신규/확장 모듈 수

| Phase | 모듈 | 신규 API | 신규 모델 | FE 화면 |
|-------|------|---------|-----------|---------|
| A (6주) | 5 신규 | 80 | 16 | 22 |
| B (4주) | 5 고도화 | 46 | 5 | 15 |
| C (4주) | 4 부가 | 37 | 3 | 12 |
| **합계** | **14** | **163** | **24** | **49** |

### Phase A 이후 전체 시스템 규모

| 항목 | 현재 | Phase A 후 | 전체 완료 후 |
|------|------|-----------|-------------|
| 모듈 | 118 | 123 | 132 |
| API | 1,440 | 1,520 | 1,603 |
| Prisma 모델 | 254 | 270 | 278 |

---

## 8. 구현 우선순위 (Phase A 내부)

```
Week 1~2: A1 임상경로 (Clinical Pathway)
          - 대학병원 진료 표준화의 기반
          - 다른 모듈(MDT, 암등록)과 연동점 많음

Week 2~3: A2 다학제 진료 (Tumor Board/MDT)
          - 대학병원의 핵심 차별화 기능
          - 암등록과 직접 연동

Week 3~4: A3 암 등록 (Cancer Registry)
          - MDT 결정 → 치료 기록 → 추적 → KCCR 보고
          - MDT와 함께 암센터 패키지

Week 4~5: A4 임상 연구 (IRB/CDM)
          - 대학병원 존재 이유 (연구 중심)
          - CDM은 Phase C에서 엔진 구현

Week 5~6: A5 원가 분석 (ABC Costing)
          - 경영진 의사결정 지원
          - 기존 billing 데이터 활용
```

---

## 9. 기존 코드 활용 매핑

| 신규 모듈 | 기존 활용 자산 |
|-----------|---------------|
| 임상경로 | `encounter`, `order-set` (오더 템플릿), `form-engine` |
| 다학제 진료 | `patient`, `imaging`, `pathology`, `lab`, `medical-ai` (요약) |
| 암 등록 | `code-master` (ICD-O-3/TNM), `terminology-mapping`, `lab` |
| 임상 연구 | `patient`, `consent`, `upload`, `cdm`→`terminology-mapping` |
| 원가 분석 | `billing`, `billing-advanced`, `hr`, `inventory`, `operational-stats` |
| ICU 고도화 | `icu`, `cdss`, `medical-ai` (악화 예측), `nurse-station` |
| 장기이식 | `transplant`, `blood-bank`, `lab`, `pharmacy` |
| 레지던트 교육 | `education`, `surgery-opnote` (로그북), `encounter` |
| 당직 스케줄링 | `workgroup` (기존 3 API), `hr`, `schedule` |
| 환자 만족도 | `portal` (기존 2 API), `notification`, `medical-ai` (감성 분석) |

---

## 10. 리스크 및 의존성

| 리스크 | 영향 | 대응 |
|--------|------|------|
| OMOP CDM 변환 정확도 | 연구 데이터 신뢰성 | 기존 SNOMED/LOINC 매핑 213건 활용, 부족분 점진 보강 |
| KCCR 보고 양식 변경 | 암 등록 포맷 불일치 | 보고 모듈을 JSON 기반 템플릿으로 유연하게 설계 |
| MDT AI 요약 품질 | 임상 의사결정 신뢰도 | WeRU.B Medical AI 기존 연동 활용, 요약은 참고용으로만 |
| 원가 데이터 부재 | ABC 모델 정확도 | 초기엔 표준 원가 기반, 실제 데이터 축적 후 보정 |
| Phase D 인프라 병목 | Go-Live 지연 | Phase B/C 중 기본 인프라(백업, 모니터링)만 선행 |

---

## 부록: 인프라/보안 상세 (Phase D)

> v1.0 기획서 (UNIVERSITY-HOSPITAL-EXPANSION-PLAN-v1.0.md) 참조
> - Phase 1: K8s, Redis HA, 모니터링, CDN
> - Phase 2: PgBouncer, Read Replica, 파티셔닝, 전문검색, 백업
> - Phase 3: MFA, SSO, ABAC, 암호화, 감사 무결성
> - Phase 4: Redis Streams, Bull Queue, SSE→Pub/Sub, CQRS
