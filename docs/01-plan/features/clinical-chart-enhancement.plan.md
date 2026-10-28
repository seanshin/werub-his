# 진료 차트 임상 구조 고도화 기획서 v1.0

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/prisma/schema.prisma:1542 · apps/api/prisma/schema.prisma:1547 · apps/api/prisma/schema.prisma:1720 model Consultation · 잔여: 없음

> 작성일: 2026-05-26 | 상태: 기획 완료
> 관련: 의료법 시행규칙 제14조(진료기록부), EMR 인증 기준, FHIR R4 Encounter/Condition

---

## 1. 현재 상태 진단

### 1.1 AS-IS: SOAP 4필드 체계

```
현재 Encounter 모델:
  subjective   (Text) — S: 주관적 증상 (CC+PI+PMH+ROS 혼합)
  objective    (Text) — O: 객관적 소견 (PE+검사결과 혼합)
  assessment   (Text) — A: 평가
  plan         (Text) — P: 계획
```

| 문제 | 영향 |
|------|------|
| CC(주소)가 S에 매몰됨 | 환자 방문 사유를 한눈에 파악 불가 |
| PMH(과거력)가 매번 다시 기록 | 구조화되지 않아 자동 이월 불가 |
| ROS(계통별 문진)가 자유텍스트 | 체계적 기록 불가, 검색 불가 |
| PE(신체검진)가 O에 혼합 | 활력징후와 이학적 소견 구분 안 됨 |
| 주진단/부진단 UI 미흡 | 진단 코드는 있지만 UI에서 구분 불명확 |
| 식이/활동 처방 없음 | DIET/ACTIVITY 오더 불가 |
| 타과 협진 모델 없음 | Referral→Consultation Reply 흐름 없음 |

### 1.2 TO-BE: 의무기록 표준 구조

```
진료 기록 (Encounter)
│
├─ 1. 환자 이력 (History)
│   ├─ CC (Chief Complaint) — 주소
│   ├─ HPI (History of Present Illness) — 현병력
│   ├─ PMH (Past Medical History) — 과거력 (자동 이월)
│   ├─ FH (Family History) — 가족력
│   ├─ SH (Social History) — 사회력 (음주/흡연/직업)
│   └─ ROS (Review of Systems) — 계통별 문진
│
├─ 2. 신체 검진 (Physical Examination)
│   ├─ General Appearance — 전신 상태
│   ├─ Vital Signs — 활력 징후 (기존 PreVisitVitals 연동)
│   └─ System-specific — 계통별 이학적 소견
│
├─ 3. 평가 (Assessment)
│   ├─ 주진단 (PRIMARY) — ICD-10/KCD-8 코드 + 한글명
│   ├─ 부진단 (SECONDARY) — 복수 등록
│   └─ 감별 진단 (DIFFERENTIAL) — 의심 질환
│
├─ 4. 계획 (Plan)
│   ├─ 약물 처방 (MEDICATION)
│   ├─ 검사 처방 (LAB)
│   ├─ 영상 처방 (IMAGING)
│   ├─ 치료 처방 (THERAPY)
│   ├─ 식이 처방 (DIET) — 신규
│   ├─ 활동 제한 (ACTIVITY) — 신규
│   ├─ 간호 지시 (NURSING) — 신규
│   └─ 타과 협진 의뢰 (REFERRAL) — 신규
│
└─ 5. 부속 기록
    ├─ 검사 결과 (LabResult) — 기존 ✅
    ├─ 영상 결과 (ImagingResult) — 기존 ✅
    ├─ 타과 회신 (ConsultationReply) — 신규
    └─ 경과 기록 (ProgressNote) — 기존 ✅ (입원)
```

---

## 2. 데이터 모델 확장

### 2.1 Encounter 모델 필드 추가

```prisma
model Encounter {
  // 기존 필드 유지
  subjective    String?   @db.Text  // 호환성 유지
  objective     String?   @db.Text
  assessment    String?   @db.Text
  plan          String?   @db.Text

  // ── 신규: 구조화 의무기록 필드 ──
  chiefComplaint          String?   @map("chief_complaint") @db.Text       // CC: 주소
  historyPresentIllness   String?   @map("hpi") @db.Text                   // HPI: 현병력
  pastMedicalHistory      String?   @map("pmh") @db.Text                   // PMH: 과거력
  familyHistory           String?   @map("family_history") @db.Text        // FH: 가족력
  socialHistory           Json?     @map("social_history")                 // SH: {smoking, alcohol, occupation}
  reviewOfSystems         Json?     @map("ros")                            // ROS: {general, heent, cardiovascular, ...}
  physicalExamination     Json?     @map("pe")                             // PE: {general, heent, chest, abdomen, ...}
  
  // 진단 구분 강화 (기존 EncounterDiagnosis.type 활용)
  // → PRIMARY, SECONDARY, DIFFERENTIAL
}
```

### 2.2 EncounterDiagnosis 확장

```prisma
model EncounterDiagnosis {
  // 기존 필드
  type          String    @default("PRIMARY") @db.VarChar(20)  // PRIMARY, SECONDARY, DIFFERENTIAL
  
  // 신규
  rank          Int       @default(1)       // 진단 우선순위 (1=주진단)
  onsetDate     DateTime? @map("onset_date") // 발병일
  resolvedDate  DateTime? @map("resolved_date") // 해소일
  certainty     String?   @db.VarChar(20)   // CONFIRMED, PROVISIONAL, RULE_OUT
}
```

### 2.3 처방 타입 확장

```prisma
enum PrescriptionType {
  MEDICATION
  LAB
  IMAGING
  THERAPY
  DIET        // 신규: 식이 처방
  ACTIVITY    // 신규: 활동 제한
  NURSING     // 신규: 간호 지시
}
```

### 2.4 타과 협진 모델 (신규)

```prisma
model Consultation {
  id                String    @id @default(uuid())
  encounterId       String    @map("encounter_id")
  requestingDoctorId String   @map("requesting_doctor_id")
  toDepartment      String    @map("to_department") @db.VarChar(50)
  toDoctor          String?   @map("to_doctor_id")
  
  reason            String    @db.Text          // 의뢰 사유
  clinicalQuestion  String?   @map("clinical_question") @db.Text  // 임상 질문
  urgency           String    @default("ROUTINE") @db.VarChar(20) // ROUTINE, URGENT, EMERGENT
  
  // 회신
  replyDoctorId     String?   @map("reply_doctor_id")
  replyContent      String?   @map("reply_content") @db.Text
  repliedAt         DateTime? @map("replied_at")
  recommendations   String?   @db.Text           // 권고 사항
  
  status            String    @default("REQUESTED") @db.VarChar(20) // REQUESTED, ACCEPTED, REPLIED, CLOSED
  createdAt         DateTime  @default(now()) @map("created_at")
  
  encounter         Encounter @relation(fields: [encounterId], references: [id])
  requestingDoctor  User      @relation("ConsultRequester", fields: [requestingDoctorId], references: [id])
  replyDoctor       User?     @relation("ConsultReplier", fields: [replyDoctorId], references: [id])
  
  @@map("consultation")
}
```

---

## 3. 프론트엔드 진료 기록 화면 리디자인

### 3.1 진료 기록 입력 화면 (의사용)

```
┌──────────────────────────────────────────────────────────────┐
│  강도현19 (남, 65세)  MRN: HR-20260506-0311                  │
│  내과 · 김내과 교수 · 외래 진료                               │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  [이력] [신체검진] [진단] [처방] [협진] [이전기록]            │
│                                                              │
│  ━━━ 이력 (History) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━           │
│                                                              │
│  CC (주소):                                                  │
│  ┌──────────────────────────────────────────────┐           │
│  │ 두통 및 어지러움 (3일 전 발생)                 │           │
│  └──────────────────────────────────────────────┘           │
│                                                              │
│  HPI (현병력):                                               │
│  ┌──────────────────────────────────────────────┐           │
│  │ 3일 전부터 후두부 두통 발생. 기상 시 악화,     │           │
│  │ 오후에 호전. 구역감 동반. 시야 이상 없음.      │           │
│  └──────────────────────────────────────────────┘           │
│                                                              │
│  PMH (과거력):  [이전 기록에서 자동 이월 ↻]                  │
│  ┌──────────────────────────────────────────────┐           │
│  │ • 고혈압 (2020~ 아모디핀 복용 중)             │           │
│  │ • 2형 당뇨 (2022~ 메트포르민 복용 중)         │           │
│  │ • 충수절제술 (2015)                           │           │
│  └──────────────────────────────────────────────┘           │
│                                                              │
│  SH (사회력):                                                │
│  흡연: [비흡연 ▾]  음주: [사회적 음주 ▾]  직업: [사무직    ] │
│                                                              │
│  ROS (계통별 문진):  [전체 음성 체크 ☑]                      │
│  ┌─ 전신 ─┬─ 두경부 ─┬─ 심혈관 ─┬─ 호흡기 ─┬─ 소화기 ─┐   │
│  │ ☑ 정상 │ ☐ 두통  │ ☑ 정상  │ ☑ 정상  │ ☑ 정상  │   │
│  │        │ ☐ 어지럼│         │         │         │   │
│  └────────┴────────┴─────────┴─────────┴─────────┘   │
│                                                              │
│  ━━━ 신체검진 (PE) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━            │
│                                                              │
│  General: Alert, oriented x3, no acute distress              │
│  HEENT: [정상 ▾]  상세: _______________                     │
│  Chest: [정상 ▾]  상세: _______________                     │
│  Heart: [정상 ▾]  상세: _______________                     │
│  Abdomen: [정상 ▾]  상세: _______________                   │
│  Neuro: [정상 ▾]  상세: _______________                     │
│  Extremity: [정상 ▾]  상세: _______________                 │
│                                                              │
│  ━━━ 진단 (Assessment) ━━━━━━━━━━━━━━━━━━━━━━━━━━           │
│                                                              │
│  주진단: [I10 본태성 고혈압        ] ☑ 확정                  │
│  부진단: [E11.9 2형 당뇨           ] ☑ 확정                  │
│          [R51 두통                 ] ○ 감별                  │
│  [+ 진단 추가]                                               │
│                                                              │
│  ━━━ 계획 (Plan) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━            │
│                                                              │
│  [💊 약물] [🔬 검사] [📷 영상] [🏥 치료] [🍽 식이] [🚶 활동]│
│                                                              │
│  약물 처방:                                                  │
│  • 아모디핀 5mg → 10mg 1일1회 (증량)                        │
│  • 아세트아미노펜 500mg PRN (두통 시)                        │
│                                                              │
│  검사 처방:                                                  │
│  • CBC, BMP, UA                                              │
│                                                              │
│  식이 처방:                                                  │
│  • 저염식 (Na < 2g/day)                                      │
│                                                              │
│  [타과 협진 의뢰] → 신경과 (두통 감별)                       │
│                                                              │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━            │
│  [임시 저장]                              [서명 완료]        │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 진단 입력 UI 개선

```
┌──── 진단 ────────────────────────────────────────────────────┐
│                                                              │
│  🔍 진단코드 검색: [I10 고혈압___________________] [검색]    │
│                                                              │
│  ┌─ 등록된 진단 ─────────────────────────────────────────┐  │
│  │                                                        │  │
│  │  ⭐ 주진단  I10  본태성(원발성) 고혈압                │  │
│  │            확정 · 발병: 2020-03 · 만성                 │  │
│  │                                                        │  │
│  │  ② 부진단  E11.9  상세불명의 2형 당뇨병               │  │
│  │            확정 · 발병: 2022-06 · 만성                 │  │
│  │                                                        │  │
│  │  ③ 감별    R51   두통                                  │  │
│  │            감별진단 · 발병: 2026-05-23                  │  │
│  │                                                        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  [+ 진단 추가]   구분: ○ 주진단  ○ 부진단  ○ 감별진단      │
└──────────────────────────────────────────────────────────────┘
```

### 3.3 타과 협진 의뢰

```
┌──── 타과 협진 의뢰 ──────────────────────────────────────────┐
│                                                              │
│  의뢰 과: [신경과 ▾]   긴급도: ○ 일반  ○ 긴급  ○ 응급     │
│                                                              │
│  의뢰 사유:                                                  │
│  ┌──────────────────────────────────────────────┐           │
│  │ 3일간 지속되는 후두부 두통, 고혈압 환자.       │           │
│  │ 신경학적 원인 감별 요청합니다.                  │           │
│  └──────────────────────────────────────────────┘           │
│                                                              │
│  임상 질문:                                                  │
│  ┌──────────────────────────────────────────────┐           │
│  │ 1. 편두통 vs 긴장형 두통 감별                  │           │
│  │ 2. Brain MRI 필요 여부                         │           │
│  └──────────────────────────────────────────────┘           │
│                                                              │
│  [의뢰서 전송]                                               │
└──────────────────────────────────────────────────────────────┘

┌──── 협진 회신 (신경과 박신경 교수) ──────────── 5/27 14:30 ──┐
│                                                              │
│  회신 내용:                                                  │
│  고혈압성 두통으로 판단됩니다. 신경학적 이상소견 없음.        │
│  혈압 조절 강화 후 경과 관찰 권고합니다.                     │
│                                                              │
│  권고사항:                                                   │
│  1. 항고혈압제 증량 (현재 진행 중)                           │
│  2. Brain MRI: 불필요 (신경학적 국소 징후 없음)              │
│  3. 2주 후 혈압 재평가 시 호전 없으면 재의뢰                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. 기존 SOAP과의 호환성

### 4.1 매핑 전략

신규 필드는 기존 SOAP 필드와 **병행 운영**합니다:

| 기존 SOAP | 신규 구조화 필드 | 매핑 |
|----------|---------------|------|
| subjective | CC + HPI + PMH + FH + SH + ROS | S = CC + HPI (자동 합성) |
| objective | PE (구조화) + Vitals | O = PE 자유텍스트 (자동 합성) |
| assessment | 진단 목록 (PRIMARY/SECONDARY/DIFFERENTIAL) | A = 진단명 자동 나열 |
| plan | 처방 목록 + 협진 | P = 처방 요약 자동 생성 |

### 4.2 하위 호환

- 기존 진료 기록은 SOAP 4필드로 그대로 표시
- 신규 진료 시 구조화 필드 입력 → SOAP에 자동 합성 저장
- 신규 필드가 비어있으면 기존 SOAP 표시 (fallback)

---

## 5. ROS (Review of Systems) 구조화

```json
// reviewOfSystems (Json 필드)
{
  "general": { "normal": true, "findings": "" },
  "heent": { "normal": false, "findings": "두통, 어지러움" },
  "cardiovascular": { "normal": true, "findings": "" },
  "respiratory": { "normal": true, "findings": "" },
  "gastrointestinal": { "normal": true, "findings": "" },
  "genitourinary": { "normal": true, "findings": "" },
  "musculoskeletal": { "normal": true, "findings": "" },
  "neurological": { "normal": false, "findings": "두통" },
  "psychiatric": { "normal": true, "findings": "" },
  "skin": { "normal": true, "findings": "" },
  "endocrine": { "normal": true, "findings": "" },
  "hematologic": { "normal": true, "findings": "" }
}
```

## 6. PE (Physical Examination) 구조화

```json
// physicalExamination (Json 필드)
{
  "generalAppearance": "Alert, oriented, no acute distress",
  "heent": { "normal": true, "findings": "" },
  "neck": { "normal": true, "findings": "" },
  "chest": { "normal": true, "findings": "Clear breath sounds bilaterally" },
  "heart": { "normal": true, "findings": "RRR, no murmur" },
  "abdomen": { "normal": true, "findings": "Soft, non-tender" },
  "extremity": { "normal": true, "findings": "No edema" },
  "neuro": { "normal": true, "findings": "CN II-XII intact" },
  "skin": { "normal": true, "findings": "" }
}
```

---

## 7. 구현 계획

### Phase 1: DB 스키마 확장 + 마이그레이션

| # | 작업 | 예상 |
|---|------|:----:|
| 1-1 | Encounter 모델에 CC/HPI/PMH/FH/SH/ROS/PE 필드 추가 | 1h |
| 1-2 | EncounterDiagnosis에 rank/onsetDate/certainty 추가 | 0.5h |
| 1-3 | PrescriptionType에 DIET/ACTIVITY/NURSING 추가 | 0.5h |
| 1-4 | Consultation 모델 신규 생성 | 1h |
| 1-5 | Prisma migrate + API DTO 업데이트 | 1h |

**Phase 1 합계: 4h**

### Phase 2: 진료 기록 입력 화면 리디자인

| # | 작업 | 예상 |
|---|------|:----:|
| 2-1 | 이력 탭: CC/HPI/PMH/FH/SH 입력 폼 | 2h |
| 2-2 | ROS 체크리스트 UI (12개 계통, 정상/이상 토글) | 1.5h |
| 2-3 | PE 구조화 입력 (계통별 정상/이상 + 자유텍스트) | 1.5h |
| 2-4 | PMH 자동 이월 (이전 진료에서 가져오기) | 1h |
| 2-5 | SOAP 자동 합성 (구조화 → S/O/A/P 변환) | 1h |

**Phase 2 합계: 7h**

### Phase 3: 진단 + 처방 개선

| # | 작업 | 예상 |
|---|------|:----:|
| 3-1 | 진단 UI: 주/부/감별 구분 + 순위 + 확정도 | 2h |
| 3-2 | 식이 처방 (DIET) 입력 UI + API | 1.5h |
| 3-3 | 활동 제한 (ACTIVITY) 입력 UI + API | 1h |
| 3-4 | 간호 지시 (NURSING) 입력 UI + API | 1h |

**Phase 3 합계: 5.5h**

### Phase 4: 타과 협진

| # | 작업 | 예상 |
|---|------|:----:|
| 4-1 | Consultation API (CRUD + 회신) | 2h |
| 4-2 | 협진 의뢰 UI (진료 기록 내) | 1.5h |
| 4-3 | 협진 회신 UI (의뢰받은 의사) | 1.5h |
| 4-4 | 협진 목록/대시보드 | 1h |

**Phase 4 합계: 6h**

### Phase 5: 검사결과 연동 강화

| # | 작업 | 예상 |
|---|------|:----:|
| 5-1 | 진료 기록 내 검사결과 인라인 표시 | 1h |
| 5-2 | 이상수치 자동 하이라이트 | 0.5h |
| 5-3 | 이전 결과 비교 (트렌드) | 1h |

**Phase 5 합계: 2.5h**

**총 예상: 25h (5 Phase)**

---

## 8. 성공 지표

| 지표 | 현재 | 목표 |
|------|------|------|
| 의무기록 필드 | SOAP 4개 | 12개+ (CC/HPI/PMH/FH/SH/ROS/PE/A/P) |
| 진단 구분 | PRIMARY/SECONDARY | + DIFFERENTIAL + rank + certainty |
| 처방 타입 | 4개 | 7개 (+ DIET/ACTIVITY/NURSING) |
| 타과 협진 | 없음 | 의뢰→회신 완전 흐름 |
| ROS | 자유텍스트 | 12계통 구조화 체크리스트 |
| PE | 자유텍스트 | 9영역 구조화 + 자유텍스트 |
| PMH 이월 | 수동 | 이전 기록 자동 이월 |

---

## 9. 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1.0 | 2026-05-26 | 초기 기획 — 의무기록 구조화 + 타과 협진 + 5 Phase 로드맵 (25h) |
