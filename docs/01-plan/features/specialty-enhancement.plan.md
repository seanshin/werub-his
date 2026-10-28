# 전문과 고도화 보강 계획

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/prisma/schema.prisma:4121 model EyePrescription · apps/api/prisma/schema.prisma:4146 model DentalLabOrder · apps/api/prisma/schema.prisma:4171 model SleepStudy · 잔여: 9 안과 당뇨망막병증 등급(CLI)

## 현재 완성도

| 과 | 완성도 | 핵심 갭 |
|----|:------:|---------|
| 치과 | 85% | 기공의뢰, 교정, 리콜 |
| 안과 | 70% | 처방 UI, 사진뷰어, 질환등급 |
| 피부과 | 65% | 병리연동, 더모스코피, 질환점수 |
| 이비인후과 | 75% | 수면검사모델, 보청기, 전정기능 |

---

## Phase 1: 핵심 갭 해소 (즉시)

### 1.1 안과 — 안경/콘택트 처방 UI

API는 이미 존재 (`prescribeGlasses`, `prescribeContacts`). 프론트엔드 탭만 추가.

```
안과 페이지 탭 추가: [처방전]

┌─ 안경 처방전 ──────────────────────────────────────────────┐
│                                                             │
│  ┌─ 우안 (OD) ──────────┬─ 좌안 (OS) ──────────┐          │
│  │ SPH: -2.50           │ SPH: -2.00           │          │
│  │ CYL: -0.75           │ CYL: -0.50           │          │
│  │ AXIS: 180°           │ AXIS: 170°           │          │
│  │ ADD: +1.50           │ ADD: +1.50           │          │
│  └──────────────────────┴──────────────────────┘          │
│  PD: 63.0mm                                                │
│  처방일: 2026-05-19  │  유효기간: 6개월                     │
│  [처방전 출력]  [콘택트 처방 전환]                            │
└─────────────────────────────────────────────────────────────┘
```

**Prisma 추가:**
```prisma
model EyePrescription {
  id              String  @id @default(uuid()) @db.Uuid
  patientId       String  @map("patient_id") @db.Uuid
  prescriptionType String @map("prescription_type") @db.VarChar(20) // GLASSES, CONTACTS
  odSphere        Decimal? @map("od_sphere") @db.Decimal(5, 2)
  odCylinder      Decimal? @map("od_cylinder") @db.Decimal(5, 2)
  odAxis          Int?     @map("od_axis")
  odAdd           Decimal? @map("od_add") @db.Decimal(4, 2)
  osSphere        Decimal? @map("os_sphere") @db.Decimal(5, 2)
  osCylinder      Decimal? @map("os_cylinder") @db.Decimal(5, 2)
  osAxis          Int?     @map("os_axis")
  osAdd           Decimal? @map("os_add") @db.Decimal(4, 2)
  pd              Decimal? @db.Decimal(4, 1) // Pupillary Distance
  // 콘택트 전용
  baseCurve       Decimal? @map("base_curve") @db.Decimal(4, 2)
  diameter        Decimal? @db.Decimal(4, 1)
  brand           String?  @db.VarChar(100)
  prescribedBy    String   @map("prescribed_by") @db.Uuid
  prescribedAt    DateTime @default(now()) @map("prescribed_at") @db.Timestamptz()
  patient         Patient  @relation(fields: [patientId], references: [id])
  @@map("eye_prescriptions")
}
```

### 1.2 피부과 — 더모스코피 표시 + 질환 점수

현재 `dermoscopy` JSON 필드는 저장만 되고 표시 안 됨. UI 추가.

```
병변 상세에 더모스코피 섹션 추가:

┌─ 더모스코피 ────────────────────────────────────────────────┐
│  패턴: Reticular (망상)                                      │
│  색상: 갈색, 흑색                                            │
│  구조: 색소 네트워크, 점                                     │
│  ABCDE Score: 3/8 — ⚠ 추적 관찰 권고                        │
│                                                             │
│  ┌─ ABCDE 시각화 ──────────────────────────────────────┐    │
│  │ A ■□□  B ■□□  C ■■□  D ■□□  E □□□  = 3점           │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

**질환별 점수 시스템:**

| 질환 | 점수 도구 | 범위 | 모델 필드 |
|------|---------|------|---------|
| 건선 | PASI (Psoriasis Area Severity Index) | 0-72 | `pasiScore` |
| 아토피 | SCORAD | 0-103 | `scoradScore` |
| 여드름 | GAGS (Global Acne Grading System) | 0-44 | `gagsScore` |
| 흑색종 | Breslow thickness + Clark level | mm / I-V | `breslowThickness`, `clarkLevel` |

```prisma
// SkinLesion에 추가 필드
model SkinLesion {
  // 기존 필드 유지
  pasiScore        Decimal? @map("pasi_score") @db.Decimal(4, 1)
  scoradScore      Decimal? @map("scorad_score") @db.Decimal(5, 1)
  gagsScore        Int?     @map("gags_score")
  breslowThickness Decimal? @map("breslow_thickness") @db.Decimal(4, 2) // mm
  clarkLevel       Int?     @map("clark_level") // I-V
  tnmStage         String?  @map("tnm_stage") @db.VarChar(20) // "T1aN0M0"
}
```

### 1.3 치과 — 기공의뢰 모델

```prisma
model DentalLabOrder {
  id            String    @id @default(uuid()) @db.Uuid
  patientId     String    @map("patient_id") @db.Uuid
  planId        String?   @map("plan_id") @db.Uuid
  tooth         String    @db.VarChar(5)
  orderType     String    @map("order_type") @db.VarChar(30)
  // CROWN (크라운), BRIDGE (브릿지), INLAY (인레이), ONLAY (온레이),
  // DENTURE (의치), VENEER (라미네이트), IMPLANT_ABUTMENT (임플란트 지대주),
  // ORTHODONTIC (교정장치), NIGHT_GUARD (나이트가드), RETAINER (유지장치)
  material      String    @db.VarChar(50) // 지르코니아, PFM, 골드, e.max, PMMA
  shade         String?   @db.VarChar(10) // A1, A2, A3, B1, C2
  labName       String?   @map("lab_name") @db.VarChar(100) // "서울치과기공소"
  impression    String?   @db.VarChar(30) // DIGITAL_SCAN, ALGINATE, SILICONE
  dueDate       DateTime? @map("due_date") @db.Date
  sentAt        DateTime? @map("sent_at") @db.Timestamptz()
  receivedAt    DateTime? @map("received_at") @db.Timestamptz()
  status        String    @default("ORDERED") @db.VarChar(20)
  // ORDERED, IMPRESSION_TAKEN, SENT, IN_FABRICATION, RECEIVED, FITTED, CEMENTED
  fittingNotes  String?   @map("fitting_notes") @db.Text
  cost          Decimal?  @db.Decimal(10, 0)
  orderedBy     String    @map("ordered_by") @db.Uuid
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  patient       Patient   @relation(fields: [patientId], references: [id])
  @@map("dental_lab_orders")
}
```

### 1.4 이비인후과 — 수면검사 모델

```prisma
model SleepStudy {
  id                String   @id @default(uuid()) @db.Uuid
  patientId         String   @map("patient_id") @db.Uuid
  studyType         String   @map("study_type") @db.VarChar(30) // PSG, HSAT, MSLT
  studyDate         DateTime @map("study_date") @db.Date
  ahi               Decimal  @db.Decimal(5, 1) // Apnea-Hypopnea Index
  oxygenSatMin      Int?     @map("oxygen_sat_min")
  oxygenSatAvg      Int?     @map("oxygen_sat_avg")
  sleepEfficiency   Decimal? @map("sleep_efficiency") @db.Decimal(5, 1)
  totalSleepTime    Int?     @map("total_sleep_time") // 분
  remPercent        Decimal? @map("rem_percent") @db.Decimal(4, 1)
  supineAhi         Decimal? @map("supine_ahi") @db.Decimal(5, 1)
  severity          String?  @db.VarChar(20) // NORMAL(AHI<5), MILD(5-15), MODERATE(15-30), SEVERE(>30)
  diagnosis         String?  @db.VarChar(200)
  cpapRecommended   Boolean? @map("cpap_recommended")
  cpapPressure      Decimal? @map("cpap_pressure") @db.Decimal(4, 1)
  reportUrl         String?  @map("report_url") @db.VarChar(500)
  interpretedBy     String   @map("interpreted_by") @db.Uuid
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz()

  patient           Patient  @relation(fields: [patientId], references: [id])
  @@map("sleep_studies")
}
```

---

## Phase 2: 워크플로우 강화 (단기)

### 2.1 치과

| 기능 | 설명 | API |
|------|------|-----|
| 리콜 스케줄링 | 정기검진 알림 (6개월/1년) | POST /dental/recall |
| 교정 기록 | 와이어 교체, 브라켓 탈락 기록 | POST /dental/ortho/records |
| 임시 보철 | 임시 크라운/의치 추적 | PATCH /dental/plans/:id/provisional |
| 재료 라이브러리 | 레진/시멘트/본딩 DB | GET /dental/materials |

### 2.2 안과

| 기능 | 설명 | API |
|------|------|-----|
| 안저 사진 뷰어 | 이미지 업로드 + 좌우 비교 | POST /ophthalmology/fundus-photo |
| 당뇨망막병증 등급 | NPDR/PDR 분류 | PATCH /ophthalmology/exam/:id/dr-grade |
| 수술 후 굴절 추적 | 목표 굴절 vs 실제 | GET /ophthalmology/surgery/:id/refraction-outcome |
| 시야 심각도 | MD 기반 단계 분류 | (자동 계산) |
| OCT 비교 | RNFL 추이 차트 | GET /ophthalmology/oct-trend/:patientId |

### 2.3 피부과

| 기능 | 설명 | API |
|------|------|-----|
| 병리 연동 | 조직검사→병리과→결과 반환 | PATCH /dermatology/lesions/:id/pathology |
| 패치 테스트 | 48/96시간 판독, 알레르겐 DB | POST /dermatology/patch-test |
| 전신 약물 | 아이소트레티노인, MTX 추적 | (기존 처방 모듈 연동) |
| 사진 프로토콜 | 표준 촬영 각도/조명 가이드 | (UI 가이드) |
| 흑색종 병기 | TNM + Breslow + Clark | (SkinLesion 필드 추가) |

### 2.4 이비인후과

| 기능 | 설명 | API |
|------|------|-----|
| 보청기 처방 | 모델/타입/적합 | POST /ent/hearing-aid |
| 전정기능검사 | VNG/ENG, Dix-Hallpike | POST /ent/vestibular |
| 음성분석 | Jitter/Shimmer/NHR | POST /ent/voice-analysis |

---

## Phase 3: 고급 기능 (중기)

### 3.1 치과
- 3D 치아 모델 뷰어 (STL/OBJ)
- 디지털 인상 연동 (iTero, TRIOS)
- 교합 분석 (T-Scan)
- 파노라마/CBCT 주석 뷰어

### 3.2 안과
- 각막 지형도 (Pentacam 연동)
- IOL 계산기 (SRK/T, Barrett, Hill-RBF)
- 전방각경검사 (Gonioscopy)
- AI 안저 분석 (당뇨망막병증, 녹내장)

### 3.3 피부과
- AI 병변 분석 (양성/악성 분류)
- Fitzpatrick 피부타입 연동
- 레이저 파라미터 DB (기기별 설정)
- 피부 3D 스캔 (Vectra)

### 3.4 이비인후과
- 청능재활 추적
- 인공와우 프로그래밍 기록
- 수면 원격 모니터링 (CPAP 데이터)

---

## 구현 우선순위

| 순위 | 항목 | 난이도 | 영향도 |
|:----:|------|:------:|:------:|
| 1 | 안과 처방 UI (프론트만) | 낮음 | 높음 |
| 2 | 피부과 더모스코피 표시 UI | 낮음 | 중간 |
| 3 | 치과 기공의뢰 모델+UI | 중간 | 높음 |
| 4 | 피부과 질환 점수 (PASI/SCORAD) | 중간 | 중간 |
| 5 | 이비인후과 수면검사 모델 | 중간 | 중간 |
| 6 | 안과 안저사진 뷰어 | 중간 | 중간 |
| 7 | 치과 리콜 스케줄링 | 중간 | 중간 |
| 8 | 피부과 병리 연동 | 높음 | 높음 |
| 9 | 안과 당뇨망막병증 등급 | 낮음 | 중간 |
| 10 | 이비인후과 보청기 처방 | 중간 | 낮음 |

## 예상 작업량

| Phase | 모델 | API | 프론트 | 예상 |
|-------|:----:|:---:|:-----:|------|
| Phase 1 | 3 | 8 | 탭 4개 | 즉시 |
| Phase 2 | 2 | 15 | 화면 6개 | 단기 |
| Phase 3 | - | - | 컴포넌트 8개 | 중기 |
