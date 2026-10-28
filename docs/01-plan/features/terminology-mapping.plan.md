# 의료 용어 표준 매핑 기획서 v1.0

> **상태(2026-09-14 코드 대조)**: 대체됨 → docs/01-plan/features/terminology-auto-mapping.plan.md, docs/01-plan/features/terminology-mapping-coverage.plan.md

> Hospital RUN HIS — 국제 의료 용어 표준 매핑 체계 구축  
> 작성일: 2026-05-22  
> 목적: 기존 내부 코드 마스터에 국제 표준 용어 매핑을 추가하여 상호운용성 확보

---

## 1. 현황 분석

### 1.1 현재 코드 마스터 (AS-IS)

| 코드 체계 | 건수 | 표준 매핑 |
|---------|------|---------|
| DiagnosisCode (KCD-8) | 68건 | ICD-10 ✓, ICD-11 부분 ✓ |
| ProcedureCode (EDI) | 81건 | 없음 |
| MedicationCode | 52건 | 보험코드 부분 ✓ |
| LabTestCode | 26건 | LOINC ✓ |
| MedicationRoute | 18건 | SNOMED 필드 있으나 미매핑 |
| DepartmentCode | 36건 | 없음 |
| SurgeryAnesthesiaCode | 21건 | 없음 |

### 1.2 추가 필요한 국제 표준

| 표준 | 용도 | 필요 이유 |
|------|------|---------|
| **SNOMED CT** | 임상 용어 통합 | FHIR R4 Coding.system 필수, 진단/증상/소견/시술 통합 코딩 |
| **LOINC** | 검사/관찰항목 | 검사결과 교환 표준 (이미 LabTestCode에 부분 매핑) |
| **ICNP/NANDA** | 간호 진단/중재 | 간호기록 표준화, EMR인증 요건 |
| **ICD-10-PCS** | 시술/수술 분류 | 입원 시술 코딩, 보험 청구 정밀화 |
| **ICF** | 기능/장애 분류 | 재활의학 기능 평가, 장애 등급 판정 |
| **MedDRA** | 약물 부작용 분류 | 부작용 보고 표준 (KFDA/EMA/FDA 호환) |

---

## 2. 아키텍처 설계

### 2.1 테이블 구조

```
기존 코드 테이블           신규 매핑 테이블                 신규 용어 테이블
─────────────           ─────────────                 ─────────────
DiagnosisCode ──┐
ProcedureCode ──┤
MedicationCode ─┤      TerminologyMapping              NursingCode
LabTestCode ────┤      ┌─────────────────┐             ┌──────────────────┐
SurgeryCode ────┘      │ id              │             │ id               │
                       │ sourceTable     │             │ codeSystem       │
                       │ sourceId        │←── FK       │ code             │
                       │ targetSystem    │             │ nameKo           │
                       │ targetCode      │             │ nameEn           │
                       │ targetDisplay   │             │ category         │
                       │ equivalence     │             │ definition       │
                       │ mapSource       │             │ isActive         │
                       │ validFrom       │             └──────────────────┘
                       │ isActive        │
                       └─────────────────┘

targetSystem 값:
  SNOMED_CT, LOINC, ICD10PCS, ICF,
  MedDRA, ICNP, NANDA_I, NIC, NOC
```

### 2.2 스키마 설계

#### TerminologyMapping (통합 매핑 테이블)

모든 내부 코드에서 외부 표준 코드로의 매핑을 하나의 테이블에서 관리.

```prisma
model TerminologyMapping {
  id            String   @id @default(uuid()) @db.Uuid
  
  // 원본 (내부 코드)
  sourceTable   String   @map("source_table") @db.VarChar(30)
  // diagnosis_codes, procedure_codes, medication_codes,
  // lab_test_codes, surgery_anesthesia_codes, nursing_codes
  sourceId      String   @map("source_id") @db.Uuid
  sourceCode    String   @map("source_code") @db.VarChar(20)
  
  // 대상 (외부 표준)
  targetSystem  String   @map("target_system") @db.VarChar(20)
  // SNOMED_CT, LOINC, ICD10PCS, ICF, MedDRA, ICNP, NANDA_I, NIC, NOC
  targetCode    String   @map("target_code") @db.VarChar(30)
  targetDisplay String   @map("target_display") @db.VarChar(500)
  targetVersion String?  @map("target_version") @db.VarChar(20)
  
  // 매핑 메타
  equivalence   String   @default("equivalent") @db.VarChar(20)
  // equivalent(동등), wider(포함), narrower(포함됨), 
  // relatedto(관련), inexact(부정확)
  mapSource     String   @default("MANUAL") @map("map_source") @db.VarChar(20)
  // MANUAL(수동), AUTO(AI매핑), OFFICIAL(공식매핑표), IMPORTED(외부가져오기)
  confidence    Decimal? @db.Decimal(3, 2) // AI 매핑 시 신뢰도 (0.00~1.00)
  notes         String?  @db.Text
  
  validFrom     DateTime @default(now()) @map("valid_from") @db.Date
  validTo       DateTime? @map("valid_to") @db.Date
  isActive      Boolean  @default(true) @map("is_active")
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz()
  createdBy     String?  @map("created_by") @db.Uuid
  
  @@unique([sourceTable, sourceId, targetSystem, targetCode])
  @@index([sourceTable, sourceId])
  @@index([targetSystem, targetCode])
  @@map("terminology_mappings")
}
```

#### NursingCode (간호 용어 코드)

```prisma
model NursingCode {
  id          String  @id @default(uuid()) @db.Uuid
  codeSystem  String  @map("code_system") @db.VarChar(10)
  // NANDA_I: 간호진단
  // NIC: 간호중재 분류
  // NOC: 간호결과 분류
  // ICNP: 국제간호실무분류
  code        String  @db.VarChar(20)
  nameKo      String  @map("name_ko") @db.VarChar(200)
  nameEn      String? @map("name_en") @db.VarChar(200)
  domain      String? @db.VarChar(50)    // 영역 (예: 안전, 영양, 활동)
  class       String? @db.VarChar(50)    // 분류
  definition  String? @db.Text           // 정의
  indicators  Json?   @db.JsonB          // 관련지표/중재항목 (NIC/NOC)
  sortOrder   Int     @default(0) @map("sort_order")
  isActive    Boolean @default(true) @map("is_active")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz()
  
  @@unique([codeSystem, code])
  @@index([codeSystem])
  @@index([domain])
  @@map("nursing_codes")
}
```

---

## 3. 표준별 매핑 계획

### 3.1 SNOMED CT

**적용 범위**: 진단코드, 수가코드, 약품코드, 검사코드 전체

| 내부 코드 | SNOMED CT 예시 |
|---------|---------------|
| KCD J06.9 (급성 상기도감염) | 54150009 \| Upper respiratory infection |
| KCD I10 (본태성 고혈압) | 59621000 \| Essential hypertension |
| KCD E11 (2형 당뇨) | 44054006 \| Diabetes mellitus type 2 |
| EDI E6541 (CBC) | 26604007 \| Complete blood count |
| MED 타이레놀 | 387517004 \| Paracetamol |
| Route PO | 26643006 \| Oral route |

**매핑 전략**:
1. 주요 진단코드 68건 → SNOMED CT 1:1 매핑 (KCD↔SNOMED 공식 매핑표 활용)
2. 수가코드 81건 → SNOMED CT Procedure 매핑
3. 약품코드 52건 → SNOMED CT Substance/Product 매핑
4. 투여경로 18건 → SNOMED CT Route 매핑 (공식 코드 존재)

**구현 Phase**: Phase 1 (1주)

**시드 데이터 예시**:
```json
[
  { "sourceTable": "diagnosis_codes", "sourceCode": "I10", "targetSystem": "SNOMED_CT", "targetCode": "59621000", "targetDisplay": "Essential hypertension", "equivalence": "equivalent" },
  { "sourceTable": "diagnosis_codes", "sourceCode": "E11", "targetSystem": "SNOMED_CT", "targetCode": "44054006", "targetDisplay": "Diabetes mellitus type 2", "equivalence": "equivalent" },
  { "sourceTable": "medication_routes", "sourceCode": "PO", "targetSystem": "SNOMED_CT", "targetCode": "26643006", "targetDisplay": "Oral route", "equivalence": "equivalent" },
  { "sourceTable": "medication_routes", "sourceCode": "IV", "targetSystem": "SNOMED_CT", "targetCode": "47625008", "targetDisplay": "Intravenous route", "equivalence": "equivalent" }
]
```

---

### 3.2 LOINC (검사항목)

**적용 범위**: LabTestCode 26건 + 추가 검사항목

**현재 상태**: LabTestCode.loincCode 필드에 부분 매핑 완료

**추가 작업**:
- 매핑 테이블에 정식 등록 (TerminologyMapping)
- LOINC Part 정보 (Component/Property/Timing/System/Scale/Method) 추가
- 패널 코드 매핑 (CBC → 58410-2, BMP → 24320-4)

| 내부 코드 | LOINC Code | LOINC Component |
|---------|-----------|----------------|
| L0001 (CBC) | 26464-8 | Complete blood count |
| L0101 (Creatinine) | 2160-0 | Creatinine |
| L0105 (Glucose) | 2345-7 | Glucose |
| L0301 (PT) | 5902-2 | Prothrombin time |
| L0601 (TSH) | 3016-3 | Thyroid stimulating hormone |

**구현 Phase**: Phase 1 (기존 loincCode 필드 → TerminologyMapping 이관)

---

### 3.3 ICNP / NANDA-I / NIC / NOC (간호 용어)

**적용 범위**: 간호진단, 간호중재, 간호결과 표준화

#### NANDA-I (간호진단) — 핵심 30건

| 영역 | 간호진단 | 코드 |
|------|---------|------|
| **안전** | 낙상 위험 | 00155 |
| **안전** | 욕창 위험 (피부통합성 장애 위험) | 00047 |
| **안전** | 감염 위험 | 00004 |
| **안전** | 출혈 위험 | 00206 |
| **활동** | 신체 기동성 장애 | 00085 |
| **활동** | 활동 지속성 장애 | 00298 |
| **활동** | 자가간호 결핍: 목욕 | 00108 |
| **활동** | 자가간호 결핍: 옷입기 | 00109 |
| **활동** | 자가간호 결핍: 식사 | 00102 |
| **영양** | 영양 불균형: 필요량 이하 | 00002 |
| **영양** | 체액 부족 위험 | 00028 |
| **영양** | 전해질 불균형 위험 | 00195 |
| **배설** | 배뇨 장애 | 00016 |
| **배설** | 변비 | 00011 |
| **배설** | 설사 | 00013 |
| **호흡** | 비효과적 호흡양상 | 00032 |
| **호흡** | 비효과적 기도 청결 | 00031 |
| **호흡** | 가스교환 장애 | 00030 |
| **순환** | 심박출량 감소 | 00029 |
| **순환** | 비효과적 말초조직 관류 | 00204 |
| **인지** | 급성 혼동 | 00128 |
| **인지** | 지식 부족 | 00126 |
| **통증** | 급성 통증 | 00132 |
| **통증** | 만성 통증 | 00133 |
| **심리** | 불안 | 00146 |
| **심리** | 공포 | 00148 |
| **심리** | 슬픔 | 00136 |
| **피부** | 피부통합성 장애 | 00046 |
| **체온** | 고체온증 | 00007 |
| **체온** | 저체온증 | 00006 |

#### NIC (간호중재) — 핵심 25건

| 영역 | 간호중재 | 코드 |
|------|---------|------|
| 기본간호 | 활력징후 모니터링 | 6680 |
| 기본간호 | 체위 변경 | 0840 |
| 기본간호 | 산소요법 | 3320 |
| 기본간호 | 흡인 간호 | 3160 |
| 투약 | 약물 투여: 경구 | 2304 |
| 투약 | 약물 투여: 정맥 | 2314 |
| 투약 | 수혈 관리 | 4120 |
| 통증 | 통증 관리 | 1400 |
| 통증 | 비약물적 통증 완화 | 1380 |
| 안전 | 낙상 예방 | 6490 |
| 안전 | 욕창 예방 | 3540 |
| 안전 | 억제대 적용 | 6580 |
| 안전 | 감염 관리 | 6540 |
| 상처 | 상처 간호 | 3660 |
| 상처 | 드레싱 관리 | 3440 |
| 영양 | 영양 모니터링 | 1160 |
| 영양 | 식이 상담 | 5246 |
| 배설 | 배뇨 관리 | 0590 |
| 배설 | 장 관리 | 0430 |
| 호흡 | 기도 관리 | 3140 |
| 교육 | 환자 교육: 질병 과정 | 5602 |
| 교육 | 퇴원 계획 | 7370 |
| 심리 | 불안 감소 | 5820 |
| 수술 | 수술 전 간호 | 2930 |
| 수술 | 수술 후 간호 | 2870 |

**구현 Phase**: Phase 2 (2주)

---

### 3.4 ICD-10-PCS (시술/수술 분류)

**적용 범위**: SurgeryAnesthesiaCode, ProcedureCode 중 수술/시술

| 내부 코드 | ICD-10-PCS | 설명 |
|---------|-----------|------|
| Q2861 (충수절제술) | 0DTJ4ZZ | Resection of Appendix, Percutaneous Endoscopic |
| R4507 (제왕절개) | 10D00Z1 | Extraction, Products of Conception, Classical |
| N0601 (대퇴골 골절 정복) | 0QS60ZZ | Reposition Upper Femur, Open |
| O7031 (AVF 조성) | 031C0JF | Bypass Upper Arm Vein to Upper Arm Vein |
| HD013 (IMRT) | DB22DZZ | Stereotactic Body Radiation, Lung |

**PCS 7자리 구조**: Section-Body System-Root Operation-Body Part-Approach-Device-Qualifier

**구현 Phase**: Phase 3 (1주, 주요 수술 30건 매핑)

---

### 3.5 ICF (국제 기능/장애/건강 분류)

**적용 범위**: 재활의학 기능 평가

| ICF 코드 | 분류 | 설명 | HIS 연동 |
|---------|------|------|---------|
| **b730** | 신체기능 | 근력 기능 | MMT 평가 |
| **b710** | 신체기능 | 관절운동범위 | ROM 평가 |
| **b735** | 신체기능 | 근긴장 기능 | 경직 평가 |
| **b760** | 신체기능 | 수의운동 조절 기능 | 운동조절 |
| **d450** | 활동/참여 | 걷기 | 보행 평가 |
| **d410** | 활동/참여 | 자세 변경 | 체위변환 |
| **d510** | 활동/참여 | 씻기 | ADL-목욕 |
| **d540** | 활동/참여 | 옷입기 | ADL-옷입기 |
| **d550** | 활동/참여 | 먹기 | ADL-식사 |
| **d530** | 활동/참여 | 배변 | ADL-배변 |
| **s750** | 신체구조 | 하지 구조 | 하지 평가 |
| **s720** | 신체구조 | 어깨 구조 | 견관절 평가 |
| **e120** | 환경인자 | 이동보조기구 | 보조기기 |

**ICF 등급자**: 0(장애없음), 1(경도), 2(중등도), 3(중증), 4(완전), 8(미상), 9(비해당)

**구현 Phase**: Phase 3 (재활 평가 모듈과 연동)

---

### 3.6 MedDRA (의약품 부작용 용어)

**적용 범위**: 약물 부작용 보고, DUR 체크, 수혈 부작용

#### 5계층 구조

| 계층 | 약어 | 예시 |
|------|------|------|
| SOC (System Organ Class) | SOC | 위장관 장애 |
| HLGT (High Level Group Term) | HLGT | 오심 및 구토 증상 |
| HLT (High Level Term) | HLT | 오심 및 구토 NEC |
| PT (Preferred Term) | PT | 오심 (Nausea) - 10028813 |
| LLT (Lowest Level Term) | LLT | 구역감 |

#### 핵심 PT 코드 (50건)

| MedDRA PT Code | PT 명칭 (KO) | PT 명칭 (EN) | SOC |
|---------------|-------------|-------------|-----|
| 10028813 | 오심 | Nausea | 위장관 장애 |
| 10047700 | 구토 | Vomiting | 위장관 장애 |
| 10012735 | 설사 | Diarrhoea | 위장관 장애 |
| 10019211 | 두통 | Headache | 신경계 장애 |
| 10013573 | 어지러움 | Dizziness | 신경계 장애 |
| 10037844 | 발진 | Rash | 피부/피하조직 장애 |
| 10037087 | 소양증 | Pruritus | 피부/피하조직 장애 |
| 10046735 | 두드러기 | Urticaria | 피부/피하조직 장애 |
| 10002198 | 아나필락시스 | Anaphylactic reaction | 면역체계 장애 |
| 10016558 | 발열 | Pyrexia | 전신장애 |
| 10016256 | 피로 | Fatigue | 전신장애 |
| 10012378 | 기침 | Cough | 호흡기/흉곽 장애 |
| 10013968 | 호흡곤란 | Dyspnoea | 호흡기/흉곽 장애 |
| 10020772 | 저혈압 | Hypotension | 혈관 장애 |
| 10020112 | 고혈압 | Hypertension | 혈관 장애 |
| 10000486 | 복통 | Abdominal pain | 위장관 장애 |
| 10012727 | 변비 | Constipation | 위장관 장애 |
| 10022891 | 불면증 | Insomnia | 정신 장애 |
| 10002855 | 식욕부진 | Decreased appetite | 대사/영양 장애 |
| 10048580 | 혈소판감소증 | Thrombocytopenia | 혈액/림프계 장애 |
| 10033661 | 호중구감소증 | Neutropenia | 혈액/림프계 장애 |
| 10002034 | 빈혈 | Anaemia | 혈액/림프계 장애 |
| 10001367 | ALT 증가 | ALT increased | 검사 이상 |
| 10003481 | AST 증가 | AST increased | 검사 이상 |
| 10005364 | 크레아티닌 증가 | Blood creatinine increased | 검사 이상 |
| 10030124 | 부종 | Oedema | 전신장애 |
| 10047461 | 체중감소 | Weight decreased | 검사 이상 |
| 10019233 | 두근거림 | Palpitations | 심장 장애 |
| 10042772 | 구내염 | Stomatitis | 위장관 장애 |
| 10001760 | 탈모 | Alopecia | 피부/피하조직 장애 |

**수혈 부작용 PT 코드**:

| MedDRA PT Code | 부작용 | 설명 |
|---------------|-------|------|
| 10044655 | 수혈 반응 (Transfusion reaction) | 일반 수혈 부작용 |
| 10016558 | 발열성 비용혈성 수혈반응 (FNHTR) | 가장 흔한 수혈 부작용 |
| 10002199 | 아나필락시스 반응 | 중증 알레르기 |
| 10040047 | 용혈성 수혈반응 (HTR) | 혈액형 부적합 |
| 10044653 | 수혈관련 급성폐손상 (TRALI) | 중증 호흡기 합병증 |
| 10044290 | 수혈관련 순환과부하 (TACO) | 체액 과부하 |
| 10072268 | 수혈관련 이식편대숙주병 (TA-GvHD) | 면역 합병증 |

**구현 Phase**: Phase 2 (부작용 보고 시스템과 연동)

---

## 4. API 설계

### 4.1 매핑 CRUD

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/v1/codes/mappings` | 매핑 검색 (sourceTable, sourceCode, targetSystem 필터) |
| GET | `/api/v1/codes/mappings/:sourceTable/:sourceId` | 특정 코드의 모든 표준 매핑 조회 |
| POST | `/api/v1/codes/mappings` | 매핑 추가 (Admin) |
| PATCH | `/api/v1/codes/mappings/:id` | 매핑 수정 |
| DELETE | `/api/v1/codes/mappings/:id` | 매핑 비활성화 |
| POST | `/api/v1/codes/mappings/bulk` | 벌크 매핑 추가 (CSV/JSON 업로드) |
| POST | `/api/v1/codes/mappings/ai-suggest` | AI 자동 매핑 제안 (SNOMED/LOINC) |

### 4.2 간호 코드

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/v1/codes/nursing` | 간호코드 검색 (codeSystem, domain 필터) |
| GET | `/api/v1/codes/nursing/:codeSystem/:code` | 간호코드 상세 (관련 중재/결과 포함) |
| POST | `/api/v1/codes/nursing` | 간호코드 추가 |
| GET | `/api/v1/codes/nursing/nanda-to-nic/:diagCode` | NANDA 진단 → NIC 중재 추천 |
| GET | `/api/v1/codes/nursing/nanda-to-noc/:diagCode` | NANDA 진단 → NOC 결과 추천 |

### 4.3 AI 자동 매핑

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/v1/codes/ai/map-snomed` | 한글 진단명 → SNOMED CT 자동 매핑 |
| POST | `/api/v1/codes/ai/map-loinc` | 검사항목명 → LOINC 자동 매핑 |
| POST | `/api/v1/codes/ai/map-meddra` | 부작용 증상 → MedDRA PT 자동 매핑 |

---

## 5. FE 관리 UI 설계

### 5.1 코드 마스터 페이지 확장

```
코드 마스터
├── 진단코드 (KCD/ICD)     ← 기존
├── 수가코드 (EDI)          ← 기존
├── 약품코드                ← 기존
├── 검사항목 (LOINC)        ← 기존
├── 투여경로                ← 기존
├── 진료과                  ← 기존
├── 수술/마취               ← 기존
├── **표준 매핑**           ← 신규
│   ├── SNOMED CT 매핑
│   ├── LOINC 매핑
│   ├── ICD-10-PCS 매핑
│   ├── ICF 매핑
│   └── MedDRA 매핑
├── **간호 코드**           ← 신규
│   ├── NANDA-I (간호진단)
│   ├── NIC (간호중재)
│   ├── NOC (간호결과)
│   └── ICNP
└── **매핑 관리**           ← 신규
    ├── 매핑 현황 대시보드
    ├── AI 자동 매핑
    └── 벌크 가져오기
```

### 5.2 매핑 뷰 (코드 상세 페이지)

```
┌──────────────────────────────────────────────────────────┐
│ KCD J06.9 — 급성 상기도감염, 상세불명                       │
│ Acute upper respiratory infection, unspecified              │
│ 분류: 호흡기계 질환 | ICD-10: J06.9 | ICD-11: CA07.Y       │
├──────────────────────────────────────────────────────────┤
│ 📋 표준 매핑                                               │
│                                                          │
│ SNOMED CT  54150009  Upper respiratory infection   동등    │
│ ICD-10    J06.9     Acute URI, unspecified        동등    │
│ ICD-11    CA07.Y    Acute URI, other specified    포함    │
│                                                          │
│ [+ 매핑 추가]  [AI 자동 매핑]                               │
├──────────────────────────────────────────────────────────┤
│ 🩺 관련 간호진단 (NANDA-I)                                  │
│                                                          │
│ 00032  비효과적 호흡양상                                    │
│ 00007  고체온증                                            │
│ 00132  급성 통증                                           │
│                                                          │
│ 💊 관련 간호중재 (NIC)                                      │
│                                                          │
│ 3140   기도 관리                                           │
│ 6680   활력징후 모니터링                                    │
│ 2304   약물 투여: 경구                                     │
└──────────────────────────────────────────────────────────┘
```

### 5.3 매핑 대시보드

```
┌────────────────────────────────────────────────┐
│ 매핑 현황 대시보드                               │
│                                                │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │
│ │SNOMED│ │ LOINC│ │PCS   │ │ ICF  │ │MedDRA│  │
│ │45/68 │ │26/26 │ │12/30 │ │13/20 │ │30/50 │  │
│ │ 66%  │ │100%  │ │ 40%  │ │ 65%  │ │ 60%  │  │
│ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘  │
│                                                │
│ 미매핑 코드: 45건 | AI 매핑 제안 가능: 38건      │
│ [AI 일괄 매핑 실행]                             │
└────────────────────────────────────────────────┘
```

---

## 6. 구현 로드맵

| Phase | 기간 | 내용 | 산출물 |
|-------|------|------|--------|
| **1** | 1주 | TerminologyMapping 스키마 + SNOMED CT/LOINC 매핑 시드 | 매핑 100건+ |
| **2** | 2주 | NursingCode 스키마 + NANDA/NIC/NOC 시드 + MedDRA 시드 | 간호코드 55건 + MedDRA 50건 |
| **3** | 1주 | ICD-10-PCS + ICF 매핑 + 매핑 관리 UI | PCS 30건 + ICF 13건 |
| **4** | 1주 | AI 자동 매핑 (SNOMED/LOINC/MedDRA) + 벌크 가져오기 | AI 매핑 엔진 |
| **5** | 1주 | FHIR R4 Coding 연동 + 간호기록 표준화 | FHIR Bundle 매핑 |

---

## 7. 기대 효과

| 지표 | 현재 | 목표 |
|------|------|------|
| 국제 표준 매핑률 | ICD-10만 부분 | **SNOMED+LOINC+PCS 90%+** |
| 간호기록 표준화 | 자유 텍스트 | **NANDA/NIC/NOC 코드 기반** |
| 부작용 보고 | 자유 텍스트 | **MedDRA PT 코드 기반** |
| FHIR 교환 | AI 래퍼만 | **네이티브 Coding 시스템** |
| EMR 인증 | 미준비 | **인증 용어 요건 충족** |
| 재활 기능 평가 | Barthel/FIM만 | **ICF 기반 종합 평가** |

---

## 8. 기술 고려사항

### 8.1 성능
- TerminologyMapping 테이블 인덱스: sourceTable+sourceId, targetSystem+targetCode 복합 인덱스
- 매핑 조회 캐싱: Redis TTL 1시간 (코드 매핑은 변경 빈도 낮음)
- SNOMED CT 전체 로드 불필요 → 필요한 개념만 매핑 테이블에 저장

### 8.2 데이터 품질
- equivalence 필드로 매핑 정확도 명시 (equivalent > wider > narrower > relatedto)
- mapSource 필드로 매핑 출처 추적 (OFFICIAL > AUTO > MANUAL)
- AI 매핑 시 confidence 점수 저장 → 0.8 미만은 수동 검증 필요

### 8.3 유지보수
- 표준 업데이트 시 validFrom/validTo로 버전 관리
- 벌크 가져오기 API로 CSV/JSON 일괄 매핑 업데이트
- AI 자동 매핑으로 신규 코드 추가 시 자동 제안

### 8.4 라이선스
- SNOMED CT: SNOMED International 라이선스 (한국 NRC 무료 제공)
- LOINC: Regenstrief Institute 무료 라이선스
- MedDRA: MedDRA MSSO 라이선스 (유료, 기관 단위)
- ICF: WHO 무료 공개
- ICD-10-PCS: CMS 무료 공개
- NANDA-I: Thieme 출판사 라이선스 (도서 구매)
