# EMR 의무기록 강화 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/prisma/schema.prisma:6867 model NursingNote · apps/api/prisma/schema.prisma:6745 model DischargeSummary · apps/api/prisma/schema.prisma:6544 model ProblemList · 잔여: 없음

> **Summary**: 기존 SOAP 기반 진료기록을 확장하여, 간호기록/퇴원요약/동의서/문제목록/알레르기 관리 등 EMR 2주기 인증 완전 충족 수준의 의무기록 체계 구축
>
> **Project**: Hospital RUN
> **Version**: 0.2.0
> **Author**: user
> **Date**: 2026-05-07
> **Status**: Draft
> **Prerequisites**: Phase 2 완료 (SOAP + OCS + DUR + 수납)

---

## 1. Overview

### 1.1 배경 및 목적

Hospital RUN은 Phase 2까지 외래 진료기록(SOAP), OCS, DUR, 수납의 핵심 워크플로우를 구현하였다. 그러나 실제 병원 운영에서 요구되는 **의무기록의 깊이와 다양성**이 부족한 상태이다.

**현재 구현된 의무기록:**
| 기록 유형 | 모델 | 상태 |
|-----------|------|------|
| 외래 진료기록 (SOAP) | Encounter | 기본 구현 (텍스트 기반) |
| 입원 경과기록 | ProgressNote | 기본 구현 (텍스트 + 바이탈) |
| 수술기록 | Surgery (opNote) | 스키마만 존재 |
| 응급 기록 | EmergencyVisit | 스키마만 존재 |
| 증명서 | Certificate | 기본 구현 |
| 동적 폼 | FormSubmission | 엔진만 구현 |

**부족한 영역:**
- 간호기록 (간호평가, 간호계획, I/O 기록, 투약기록)
- 퇴원요약 (구조화된 퇴원 문서)
- 동의서 관리 (수술동의서, 시술동의서, 연구동의서)
- 문제목록 (Problem List) 관리
- 알레르기/부작용 이력 관리 (현재 JSON 배열만)
- 의무기록 템플릿 시스템 (진료과별 특화 템플릿)
- 의무기록 사본 발급/출력
- 의무기록 열람 및 감사 강화

### 1.2 목표

1. **간호기록 체계** — 간호과정(사정→진단→계획→수행→평가) 전자화
2. **퇴원요약** — 구조화된 퇴원문서 + 진료정보교류 연계
3. **동의서 관리** — 전자서명 기반 동의서 작성/보관/조회
4. **문제목록** — 환자별 활성 문제 관리 (Chronic/Active/Resolved)
5. **알레르기/ADR** — 알레르기/약물이상반응 구조화 관리 + DUR 연동
6. **템플릿 시스템** — 진료과별 특화 기록 템플릿 (기존 Form Engine 확장)
7. **의무기록 출력** — PDF 생성 + 사본발급 이력 관리
8. **EMR 인증 완전 충족** — 59개 지표 중 의무기록 관련 지표 100% PASS

---

## 2. Scope

### 2.1 In Scope (FR)

| ID | Requirement | Priority | 의존성 |
|----|-------------|----------|--------|
| EMR-01 | **간호기록** — 간호평가, 간호진단, 간호계획, I/O 기록, 투약확인 | High | Admission, Encounter |
| EMR-02 | **퇴원요약** — 입원경과, 최종진단, 투약이력, 추적관찰 계획 | High | Admission, Encounter |
| EMR-03 | **동의서 관리** — 수술/시술/연구 동의서 전자서명 + 보관 | High | Patient, Surgery |
| EMR-04 | **문제목록** — 환자별 활성/만성/해결 문제 관리 | High | Patient, DiagnosisCode |
| EMR-05 | **알레르기/ADR 관리** — 약물/식품/환경 알레르기 구조화 + DUR 연동 | High | Patient, DUR |
| EMR-06 | **진료기록 템플릿** — 진료과별 특화 SOAP 템플릿 (Form Engine 확장) | Medium | FormSchema, Encounter |
| EMR-07 | **의무기록 출력/사본발급** — PDF 생성, 사본발급 이력, 워터마크 | Medium | Encounter, Admission |
| EMR-08 | **의무기록 열람 감사** — PHI 접근 상세 로깅 + 비정상 접근 탐지 | Medium | AuditLog |
| EMR-09 | **초진/재진 문진표** — 내원 전 환자 자가 기입 문진 폼 | Low | FormEngine, Patient |
| EMR-10 | **의무기록 검색** — 전문검색(Full-text Search) + 필터 | Low | Encounter, ProgressNote |

### 2.2 Out of Scope

- AI 기반 음성인식 기록 (STT) → 별도 Phase
- 임상의사결정지원(CDSS) 고도화 → 별도 Phase
- 원격의료/비대면진료 기록 → 별도 Phase
- 의무기록 장기보관 아카이빙 → 인프라 Phase

---

## 3. Functional Requirements Detail

### 3.1 EMR-01: 간호기록

**간호과정 5단계:**
```
사정(Assessment) → 진단(Diagnosis) → 계획(Planning)
    → 수행(Implementation) → 평가(Evaluation)
```

**기록 유형:**

| 기록 | 설명 | 빈도 |
|------|------|------|
| 간호초기평가 | 입원 시 신체사정, 낙상위험, 통증, 영양상태 | 입원 시 1회 |
| 간호진단/계획 | NANDA 간호진단, 기대결과, 중재계획 | 문제 발생 시 |
| 간호일지 | Focus Charting (D-A-R: Data-Action-Response) | 매 근무조 |
| I/O 기록 | 수액/경구 섭취량, 배뇨/배액량 | 매 시간/교대 |
| 투약확인 | 5 Rights 확인 (환자, 약물, 용량, 경로, 시간) | 투약 시마다 |
| 바이탈사인 | 체온/맥박/호흡/혈압/SpO2 | 1일 3-4회 |
| 낙상위험평가 | Morse Fall Scale | 입원 시 + 상태변화 시 |
| 욕창위험평가 | Braden Scale | 입원 시 + 주 1회 |

**데이터 모델 (신규):**

```
NursingAssessment (간호초기평가)
├── admissionId → Admission
├── nurseId → User
├── consciousness: String          // 의식수준 (Alert/Verbal/Pain/Unresponsive)
├── mobility: String               // 활동정도
├── painScore: Int                 // 통증점수 (NRS 0-10)
├── painLocation: String?
├── nutritionStatus: String        // 영양상태
├── skinIntegrity: String          // 피부상태
├── fallRiskAssessmentId? → FallRiskAssessment  // ★ 기존 모델 FK 참조 (중복 방지)
├── bradenScore: Int?              // Braden Scale (욕창은 별도 모델 없으므로 인라인)
├── allergyConfirmed: Boolean      // 알레르기 확인 여부 (상세는 Allergy 모델 참조)
├── additionalData: Json           // 기타 사정항목 (JsonB)
├── assessedAt: DateTime

NursingDiagnosis (간호진단)
├── assessmentId → NursingAssessment
├── nurseId → User
├── nandaCode: String              // NANDA-I 진단코드
├── nandaName: String              // 진단명
├── relatedFactors: String?        // 관련요인
├── definingCharacteristics: String? // 정의특성
├── expectedOutcome: String        // 기대결과
├── status: ACTIVE | RESOLVED

NursingNote (간호일지 - Focus Charting)
├── admissionId → Admission
├── nurseId → User
├── noteType: FOCUS | NARRATIVE | DAR
├── focus: String?                 // 초점 (문제/상태)
├── data: String?                  // D: 자료 (주관적/객관적)
├── action: String?                // A: 간호중재
├── response: String?              // R: 반응/평가
├── content: String?               // 서술식 기록
├── shiftType: DAY | EVENING | NIGHT
├── recordedAt: DateTime

IntakeOutput (I/O 기록)
├── admissionId → Admission
├── nurseId → User
├── recordedAt: DateTime
├── intakeType: ORAL | IV | OTHER
├── intakeAmount: Int              // mL
├── intakeDetail: String?          // "NS 1L", "물 200ml"
├── outputType: URINE | DRAIN | EMESIS | OTHER
├── outputAmount: Int              // mL
├── outputDetail: String?

MedicationAdministration (투약확인)
├── prescriptionId → Prescription  // 원본 처방
├── orderId? → Order               // OCS 오더 (약국 수령 후 투약 시)
├── dispensingId? → Dispensing      // 조제 완료건 (약국 확인 후 투약 시)
├── nurseId → User
├── patientId → Patient
├── scheduledAt: DateTime          // 예정시간
├── administeredAt: DateTime?      // 실제 투약시간
├── status: SCHEDULED | ADMINISTERED | HELD | REFUSED | MISSED
├── holdReason: String?            // 보류사유
├── route: String                  // PO, IV, IM, SC 등
├── dose: String                   // 실제 투여량
├── verifiedBy: String?            // 더블체크 간호사
├── notes: String?
│
│  ★ MAR 데이터 흐름:
│  Prescription → Order(PHARMACY) → Dispensing(조제완료)
│      → MedicationAdministration(간호사 투약확인)
│  - 외래: Prescription만 참조 (약국 직접 수령)
│  - 입원: Order→Dispensing→MAR 전체 체인 추적
```

**주요 기능:**
- 간호초기평가 입력 (입원 시 필수)
- NANDA-I 간호진단 코드 검색/선택
- Focus Charting (DAR) 형식 간호일지 작성
- I/O 기록 시간대별 입력 + 24시간 집계
- 투약확인(MAR) — 처방 기반 투약 스케줄 자동 생성 + 확인 기록
- 바이탈사인 차트 (트렌드 그래프)
- 낙상/욕창 위험도 자동 계산 및 알림

**★ FallRiskAssessment 기존 모델과의 관계:**
> 기존 스키마에 `FallRiskAssessment` 모델(score, riskLevel, factors, interventions)이 이미 존재한다.
> NursingAssessment는 낙상위험 점수를 자체 저장하지 않고, `fallRiskAssessmentId`로 기존 모델을 FK 참조한다.
> 간호초기평가 작성 시 FallRiskAssessment를 함께 생성하고, NursingAssessment에 연결하는 방식.
> 기존 FallRiskAssessment의 독립 사용(외래 등)도 유지된다.

**RBAC:**
- 간호사(NURSE): 전체 간호기록 CRUD
- 의사(DOCTOR): 간호기록 조회(READ)
- 약사(PHARMACIST): 투약확인 기록 조회

---

### 3.2 EMR-02: 퇴원요약 (Discharge Summary)

**기존 상태:** Admission 모델에 `dischargeSummary: String?` 텍스트 필드만 존재

**강화 방향:** 구조화된 퇴원요약 문서로 분리

```
DischargeSummary (퇴원요약)
├── admissionId → Admission (unique)
├── doctorId → User
├── admitDate: DateTime
├── dischargeDate: DateTime
├── admitDiagnosis: String           // 입원 시 진단
├── dischargeDiagnosis: String       // 퇴원 시 진단
├── diagnosisCodes: Json             // KCD 코드 목록
├── hospitalCourse: String           // 입원경과 (Text)
├── procedures: String?              // 시행된 시술/수술
├── significantFindings: String?     // 주요 검사결과
├── conditionAtDischarge: String     // 퇴원 시 상태
├── dischargeMedications: Json       // 퇴원약 목록
├── followUpPlan: String             // 추적관찰 계획
├── followUpDate: DateTime?          // 외래 예약일
├── dietaryInstructions: String?     // 식이요법 지시
├── activityRestrictions: String?    // 활동제한 사항
├── patientEducation: String?        // 환자교육 내용
├── status: DRAFT | SIGNED
├── signedAt: DateTime?
├── signedBy: String?
```

**기능:**
- 입원 중 데이터 자동 프리필 (진단, 처방, 검사결과, 수술이력)
- 퇴원약 목록 자동 생성 (활성 처방 기반)
- 의사 전자서명 후 확정
- FHIR DocumentReference 매핑 (진료정보교류)
- PDF 출력 (환자용 퇴원안내문 포함)

---

### 3.3 EMR-03: 동의서 관리

**기존 상태:** ConsentForm 모델이 스키마에 존재하지만, 기본 구조만 정의되어 있고 실제 서비스 미구현

**★ 기존 ConsentForm 스키마 (현재):**
```
ConsentForm (기존)
├── id, patientId
├── type: String @db.VarChar(50)           // 자유텍스트
├── templateName: String                   // 인라인 문자열
├── content: Json                          // 동의서 내용
├── signedBy: String? @db.VarChar(100)     // 서명자 이름(텍스트)
├── signedAt: DateTime?
├── witnessId: String?
├── expiresAt: DateTime?                   // 유효기간
├── isValid: Boolean @default(true)        // 유효여부
├── createdAt: DateTime
```

**★ 마이그레이션 전략: 기존 모델 확장 (ALTER, NOT REPLACE)**

기존 ConsentForm 테이블을 DROP하지 않고, 필드를 추가/변경하는 방식으로 진행한다.
기존 데이터가 있을 경우 안전하게 보존된다.

```
ConsentForm (확장 후)
├── [유지] id, patientId, content, witnessId, createdAt
├── [유지] type: String @db.VarChar(50)    // 기존 freetext 유지 (하위호환)
├── [유지] signedAt: DateTime?
├── [유지] isValid: Boolean                // 유효여부 유지
├── [유지] expiresAt: DateTime?            // 유효기간 유지
├── [변경] templateName → templateId? → ConsentTemplate  // nullable FK로 전환
│          ※ 마이그레이션: 기존 templateName 값은 ConsentTemplate 시딩 후 매핑
│          ※ templateName 컬럼은 deprecated 마킹 후 다음 Phase에서 제거
├── [변경] signedBy: String? → patientSignedBy: String?  // 이름 명확화
├── [추가] consentType: Enum?              // SURGERY|PROCEDURE|ANESTHESIA|RESEARCH|TRANSFUSION|DNR|TREATMENT|GENERAL
│          ※ 기존 프론트엔드의 TREATMENT/GENERAL 포함, nullable로 하위호환
├── [추가] encounterId? → Encounter
├── [추가] surgeryId? → Surgery
├── [추가] risks: String?                  // 설명된 위험/부작용
├── [추가] alternatives: String?           // 대안 치료법
├── [추가] patientSignature: String?       // Base64 서명 이미지 (암호화)
├── [추가] patientSignedAt: DateTime?
├── [추가] witnessSignedAt: DateTime?
├── [추가] doctorId: String?               // 설명 의사
├── [추가] doctorSignedAt: DateTime?
├── [추가] status: PENDING|SIGNED|EXPIRED|REVOKED @default(PENDING)
│          ※ 기존 isValid=true → SIGNED, isValid=false → REVOKED 매핑
├── [추가] revokedAt: DateTime?            // 철회 시점 (기존 isWithdrawn 대신 status 기반)
├── [추가] revokedReason: String?

ConsentTemplate (신규 모델)
├── id
├── type: String                     // 동의서 유형
├── name: String                     // "전신마취 동의서"
├── version: String
├── content: Json                    // 템플릿 JSON
├── requiredFields: Json             // 필수 입력 항목
├── isActive: Boolean
```

**마이그레이션 순서:**
1. `ConsentTemplate` 모델 생성 + 기본 템플릿 시딩
2. `ConsentForm`에 신규 필드 추가 (모두 nullable)
3. 기존 데이터 매핑 SQL 실행:
   - `templateName` → `ConsentTemplate` 매칭하여 `templateId` 채움
   - `signedBy` → `patientSignedBy`로 복사
   - `isValid=true` + `signedAt IS NOT NULL` → `status='SIGNED'`
   - `isValid=false` → `status='REVOKED'`
   - `isValid=true` + `signedAt IS NULL` → `status='PENDING'`
4. 프론트엔드 동의서 페이지 점진적 전환 (기존 type 값 TREATMENT/GENERAL 유지)
5. 다음 Phase에서 `templateName`, `signedBy` 컬럼 제거

**기능:**
- 동의서 템플릿 관리 (수술, 마취, 수혈, 시술, 연구참여, DNR, 치료, 일반)
- 태블릿/웹 기반 전자서명 캡처 (Canvas API)
- 환자/보호자/의사/입회인 서명 관리
- 동의서 철회(Revocation) — status 기반 워크플로우
- 동의서 이력 타임라인 조회
- PDF 출력 + 원본보관

---

### 3.4 EMR-04: 문제목록 (Problem List)

**기존 상태:** 진단은 Encounter 단위로만 연결 (진료건별), 환자 레벨 문제목록 없음

```
ProblemList (문제목록)
├── patientId → Patient
├── diagnosisCodeId → DiagnosisCode
├── description: String              // 문제 설명
├── status: ACTIVE | CHRONIC | RESOLVED | INACTIVE
├── severity: MILD | MODERATE | SEVERE
├── onsetDate: DateTime?             // 발병일
├── resolvedDate: DateTime?          // 해결일
├── addedBy: String → User           // 등록 의사
├── addedEncounterId: String?        // 등록된 진료건
├── notes: String?
├── createdAt: DateTime
├── updatedAt: DateTime
```

**기능:**
- 진료 시 진단 추가 → 문제목록 자동 반영 여부 선택
- 환자 차트 상단에 활성 문제목록 상시 표시
- 만성질환(CHRONIC) 별도 관리 (고혈압, 당뇨 등)
- 문제 상태 변경 이력 추적
- 문제목록 기반 진료 연속성 지원

---

### 3.5 EMR-05: 알레르기/ADR 관리

**기존 상태:** Patient 모델에 `allergies: Json @default("[]")` (비구조화 JSON 배열)

**★ 기존 Patient.allergies JSON 구조 (현재):**
```json
// Patient.allergies 필드 (JsonB)
[
  { "name": "페니실린", "severity": "high" },
  { "name": "아스피린", "severity": "medium" }
]
```
→ 비표준 구조, DUR 연동 불가, 이력추적 불가

```
Allergy (알레르기/부작용) — 신규 모델
├── patientId → Patient
├── type: DRUG | FOOD | ENVIRONMENTAL | LATEX | OTHER
├── allergen: String                 // 원인물질명
├── allergenCode: String?            // 약품코드/성분코드
├── reaction: String                 // 반응/증상
├── severity: MILD | MODERATE | SEVERE | LIFE_THREATENING
├── onsetDate: DateTime?
├── verificationStatus: CONFIRMED | UNCONFIRMED | REFUTED | ENTERED_IN_ERROR
├── reportedBy: String               // 보고자 (환자/의사)
├── recordedBy: String → User
├── notes: String?
├── isActive: Boolean @default(true)
├── createdAt: DateTime
├── updatedAt: DateTime
```

**★ Patient.allergies → Allergy 모델 마이그레이션 전략:**

**Phase 1 (공존기):** Allergy 모델 생성 + Patient.allergies 필드 유지
1. `Allergy` 모델 생성, Patient에 `allergies` relation 추가
2. 마이그레이션 스크립트로 기존 JSON 데이터 → Allergy 행 변환:
   ```sql
   -- 기존 JSON 배열의 각 항목을 Allergy 행으로 변환
   INSERT INTO allergies (id, patient_id, type, allergen, severity, ...)
   SELECT
     gen_random_uuid(),
     p.id,
     'DRUG',                                          -- 기존 JSON에 type 없으므로 기본값
     elem->>'name',                                   -- "페니실린"
     CASE elem->>'severity'
       WHEN 'high' THEN 'SEVERE'
       WHEN 'medium' THEN 'MODERATE'
       WHEN 'low' THEN 'MILD'
       ELSE 'MODERATE'
     END,
     ...
   FROM patients p,
        jsonb_array_elements(p.allergies) AS elem
   WHERE jsonb_array_length(p.allergies) > 0;
   ```
3. 신규 알레르기 등록은 Allergy 모델 사용
4. 기존 코드(프론트엔드 환자 상세, DUR 서비스)는 두 소스 모두 확인하도록 어댑터 계층 추가

**Phase 2 (전환 완료):** Patient.allergies 컬럼 deprecated
1. 모든 읽기/쓰기가 Allergy 모델 경유 확인
2. Patient.allergies 컬럼에 `@deprecated` 주석 추가
3. 다음 마이너 릴리즈에서 `Patient.allergies` 컬럼 DROP

**영향받는 코드:**
- `apps/api/src/modules/prescription/dur/dur.service.ts` — Allergy 모델 조회로 전환
- `apps/web/src/app/(main)/patients/[id]/page.tsx` — 알레르기 표시 소스 전환
- `apps/web/src/app/(main)/patients/[id]/encounter/new/page.tsx` — 알레르기 배너

**기능:**
- 알레르기 구조화 등록 (유형, 원인물질, 반응, 중증도)
- **DUR 연동** — 처방 시 알레르기 약물 자동 경고 (allergenCode ↔ MedicationCode 매칭)
- 차트 상단 알레르기 배너 상시 표시 (빨간색 경고)
- FHIR AllergyIntolerance 리소스 매핑
- 알레르기 이력 변경 추적 (확인/반증/오류)
- 약물 성분(ingredient) 기반 교차반응 검사

---

### 3.6 EMR-06: 진료기록 템플릿

**기존 상태:** FormEngine 구현되어 있으나 일반적인 폼만 존재

**확장 방향:** 진료과별 특화 SOAP 템플릿

```
진료과별 템플릿 예시:
├── 내과 초진 템플릿 (ROS 체크리스트 포함)
├── 외과 수술 전 평가 템플릿
├── 정형외과 신체검사 템플릿 (관절별 ROM)
├── 안과 시력검사 템플릿
├── 이비인후과 문진 템플릿
├── 산부인과 산전검사 템플릿
├── 소아과 성장발달 평가 템플릿
├── 정신건강의학과 정신상태검사(MSE) 템플릿
├── 재활의학과 기능평가 템플릿
└── 응급의학과 KTAS 트리아지 템플릿
```

**기능:**
- 기존 FormSchema를 활용한 진료과별 템플릿 등록
- SOAP 작성 시 템플릿 선택 → 구조화 입력 필드 자동 생성
- 템플릿 버전관리 (v1, v2 등)
- 자주 쓰는 문구(Macro) 등록/삽입
- 음성입력 가이드 (추후 STT 연동 준비)

---

### 3.7 EMR-07: 의무기록 출력/사본발급

```
MedicalRecordCopy (사본발급 이력)
├── patientId → Patient
├── requestedBy: String              // 신청자 (환자/보호자/기관)
├── requestorRelation: String        // 관계 (본인/배우자/직계/기관)
├── purpose: String                  // 발급목적
├── recordTypes: Json                // 발급 대상 기록 유형
├── dateRange: Json?                 // 기간 범위
├── issuedBy: String → User          // 발급 담당자
├── issuedAt: DateTime
├── copyCount: Int                   // 발급 부수
├── fee: Int                         // 발급 수수료
├── notes: String?
```

**기능:**
- 의무기록 PDF 생성 (진료기록, 퇴원요약, 검사결과, 영상판독)
- 병원 헤더/워터마크 자동 삽입
- 사본발급 이력 관리 (의료법 시행규칙 준수)
- 발급 수수료 자동 계산
- 환자 본인 확인 절차 (개인정보보호법)

---

### 3.8 EMR-08: 의무기록 열람 감사 강화

**기존 상태:** AuditLog로 기본 접근 로깅 구현

**강화 방향:**

```
EMR 접근 감사 강화:
├── Break-the-Glass 기능 — 비담당 환자 기록 접근 시 사유 입력 필수
├── 비정상 접근 탐지 — 대량 열람, 비근무 시간 접근, VIP 환자 접근
├── 환자 열람 이력 조회 — 환자 본인이 누가 기록을 열람했는지 확인 가능
├── 감사 대시보드 — 접근 통계, 이상 패턴 시각화
└── 자동 알림 — 비정상 접근 감지 시 관리자 알림
```

---

### 3.9 EMR-09: 초진/재진 문진표

**기존 FormEngine 활용:**

```
문진표 유형:
├── 초진 문진표 — 과거력, 가족력, 사회력, ROS
├── 재진 문진표 — 증상 변화, 투약 순응도
├── 수술 전 문진표 — 마취력, 금식여부, 복용약
└── 진료과별 특화 문진표
```

**기능:**
- QR 코드/URL 기반 환자 사전 입력 (모바일 지원)
- 작성된 문진 데이터 → SOAP Subjective 자동 연동
- 대기실 키오스크 연동 가능

---

### 3.10 EMR-10: 의무기록 검색

**기능:**
- PostgreSQL Full-text Search (tsvector/tsquery) 기반
- 한국어 형태소 분석 지원 (pg_bigm 또는 mecab)
- 검색 대상: Encounter(SOAP), ProgressNote, NursingNote, DischargeSummary
- 필터: 날짜범위, 진료과, 의사, 기록유형, 진단코드
- 검색 결과 하이라이트 표시

---

## 4. 비기능 요구사항

### 4.1 성능
- 환자 차트 로딩 (문제목록 + 알레르기 + 최근 진료 5건): < 500ms
- 의무기록 PDF 생성: < 3초
- 의무기록 전문검색: < 1초

### 4.2 보안
- 의무기록 접근 시 100% 감사 로깅
- Break-the-Glass 접근 시 사유 기록 필수
- 의무기록 출력 시 워터마크 + 발급자 정보 포함
- 전자서명 이미지 암호화 저장

### 4.3 규정 준수
- 의료법 시행규칙 제14조 (의무기록 보존: 10년)
- 개인정보보호법 (최소수집, 접근통제, 열람권)
- EMR 인증제 2주기 59개 지표 (의무기록 관련 지표 100%)

---

## 5. 기존 시스템과의 통합

### 5.1 기존 모듈 연동

| 기존 모듈 | 연동 방식 |
|-----------|----------|
| **Encounter** | SOAP 작성 시 문제목록 연동, 알레르기 경고 표시 |
| **Prescription + DUR** | 알레르기 약물 DUR 규칙 추가, 투약확인(MAR) 연결 |
| **Admission** | 간호기록/퇴원요약 연결, I/O 기록 연결 |
| **Surgery** | 동의서 연결, 수술기록 구조화 |
| **FormEngine** | 진료과별 템플릿, 문진표 폼 정의 |
| **AuditLog** | Break-the-Glass, 비정상 접근 탐지 확장 |
| **FHIR** | AllergyIntolerance, DocumentReference 리소스 추가 |
| **EmrCert** | 의무기록 관련 인증지표 PASS 업데이트 |

### 5.2 스키마 변경 영향

| 변경 유형 | 대상 | 영향 | 마이그레이션 전략 |
|-----------|------|------|------------------|
| 신규 모델 | NursingAssessment, NursingDiagnosis, NursingNote, IntakeOutput, MedicationAdministration, DischargeSummary, ProblemList, Allergy, ConsentTemplate, MedicalRecordCopy | Prisma migration | CREATE TABLE (안전) |
| 모델 확장 (ALTER) | ConsentForm — 신규 필드 추가 (consentType, signatures, status 등) | 기존 행 보존 | nullable 필드 추가 → 데이터 매핑 SQL → deprecated 컬럼 점진 제거 (§3.3 참조) |
| 관계 전환 | Patient.allergies (Json) → Allergy (모델) | 기존 JSON 데이터 보존 | 공존기(2소스) → 마이그레이션 스크립트 → JSON 컬럼 DROP (§3.5 참조) |
| FK 참조 추가 | NursingAssessment → FallRiskAssessment | 기존 모델 활용 | 기존 FallRiskAssessment 독립 사용 유지 + nullable FK (§3.1 참조) |
| 인덱스 추가 | Full-text search 인덱스, 복합 인덱스 | DB 성능 | CREATE INDEX CONCURRENTLY (무중단) |

### 5.3 마이그레이션 실행 순서

```
Step 1: 신규 모델 생성 (CREATE TABLE — 안전, 기존 데이터 영향 없음)
  └── ConsentTemplate, Allergy, ProblemList, DischargeSummary,
      NursingAssessment, NursingDiagnosis, NursingNote,
      IntakeOutput, MedicationAdministration, MedicalRecordCopy

Step 2: 기존 모델 ALTER (nullable 필드 추가)
  └── ConsentForm: consentType, templateId, encounterId, surgeryId,
      patientSignature, patientSignedAt, doctorId, doctorSignedAt,
      status, revokedAt, revokedReason 등
  └── NursingAssessment: fallRiskAssessmentId FK

Step 3: 데이터 마이그레이션 스크립트 실행
  └── Patient.allergies JSON → Allergy 행 변환 (§3.5 SQL 참조)
  └── ConsentForm.templateName → templateId 매핑
  └── ConsentForm.isValid → status 매핑
  └── ConsentForm.signedBy → patientSignedBy 복사

Step 4: 애플리케이션 코드 전환
  └── DUR 서비스: Patient.allergies → Allergy 모델 조회
  └── 동의서 서비스: 신규 필드 활용
  └── 프론트엔드: 두 소스 어댑터 → 신규 모델 단일 소스

Step 5: (다음 릴리즈) deprecated 컬럼 제거
  └── Patient.allergies JSON 컬럼 DROP
  └── ConsentForm.templateName, signedBy 컬럼 DROP
```

---

## 6. 구현 우선순위 및 단계

### Phase A: 핵심 의무기록 강화 (High Priority)

```
1. EMR-04: 문제목록 (Problem List) — 1-2일
   └── 환자 차트의 기본 뼈대, 다른 기능의 기반

2. EMR-05: 알레르기/ADR 관리 — 1-2일
   └── DUR 연동으로 환자 안전 직결

3. EMR-02: 퇴원요약 — 2-3일
   └── 입원 프로세스 완결, 진료정보교류 핵심

4. EMR-03: 동의서 관리 — 2-3일
   └── 법적 필수 문서, 수술 프로세스 연계
```

### Phase B: 간호기록 체계 (High Priority)

```
5. EMR-01: 간호기록 전체 — 3-5일
   ├── 간호초기평가 + 간호진단
   ├── 간호일지 (Focus Charting)
   ├── I/O 기록
   └── 투약확인 (MAR)
```

### Phase C: 부가 기능 (Medium Priority)

```
6. EMR-06: 진료기록 템플릿 — 2-3일
7. EMR-07: 의무기록 출력/사본발급 — 2-3일
8. EMR-08: 열람 감사 강화 — 1-2일
```

### Phase D: 확장 기능 (Low Priority)

```
9. EMR-09: 초진/재진 문진표 — 1-2일
10. EMR-10: 의무기록 검색 — 2-3일
```

---

## 7. EMR 인증 지표 매핑

| 인증 지표 | 현재 상태 | 이번 강화 후 |
|-----------|----------|-------------|
| 진료기록 작성/조회 | PASS | PASS (템플릿 강화) |
| 간호기록 작성/조회 | FAIL | **PASS** (EMR-01) |
| 퇴원요약 작성 | PARTIAL | **PASS** (EMR-02) |
| 동의서 관리 | FAIL | **PASS** (EMR-03) |
| 환자 알레르기 관리 | PARTIAL | **PASS** (EMR-05) |
| 문제목록 관리 | FAIL | **PASS** (EMR-04) |
| 의무기록 사본발급 | FAIL | **PASS** (EMR-07) |
| 의무기록 접근통제 | PASS | PASS (EMR-08 강화) |
| 의무기록 감사추적 | PASS | PASS (EMR-08 강화) |
| 투약관리(5 Rights) | PARTIAL | **PASS** (EMR-01 MAR) |

---

## 8. 기술 고려사항

### 8.1 PDF 생성
- **라이브러리**: `@react-pdf/renderer` (프론트엔드) 또는 `puppeteer` (백엔드)
- 병원 로고/헤더 템플릿 기반 생성
- 워터마크: "사본" 표시 + 발급일시 + 발급자

### 8.2 전자서명
- HTML Canvas API → Base64 PNG 캡처
- AES-256 암호화 저장
- 서명 무결성 해시(SHA-256) 저장

### 8.3 Full-text Search
- PostgreSQL `tsvector` + `GIN` 인덱스
- 한국어: `pg_bigm` 확장 (바이그램 기반)
- 검색 성능: 100만 건 기준 < 500ms 목표

### 8.4 FHIR 확장
- `AllergyIntolerance` 리소스 (EMR-05)
- `DocumentReference` 리소스 (퇴원요약, 동의서)
- `Condition` 리소스 (문제목록)
- `MedicationAdministration` 리소스 (투약확인)

---

## 9. 참고 오픈소스

| 시스템 | 참고 영역 |
|--------|----------|
| HospitalRun | 간호기록 UI 패턴 |
| OpenMRS (O3) | 문제목록, 알레르기 관리, Form Engine |
| Medplum | FHIR 리소스 매핑, 퇴원요약 구조 |
| GNU Health | 간호평가, I/O 기록 |
| LibreHealth | 동의서 관리, 의무기록 출력 |

---

## 10. 성공 기준

| 항목 | 기준 |
|------|------|
| EMR 인증 의무기록 지표 | 100% PASS |
| 간호기록 입력 완결성 | 입원환자 간호초기평가 100% 작성 가능 |
| 퇴원요약 자동 프리필률 | 70% 이상 자동 채움 |
| 알레르기-DUR 연동 | 약물 알레르기 100% 경고 표시 |
| 의무기록 PDF 생성 | 주요 기록 유형 5종 이상 출력 가능 |
| 전자서명 동의서 | 수술/마취 동의서 100% 전자화 |

---

## 11. Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1.0 | 2026-05-07 | user | 초기 기획서 작성 (10개 EMR 요구사항) |
| 0.2.0 | 2026-05-07 | user | Critical 이슈 3건 반영: C-1 ConsentForm ALTER 기반 마이그레이션 전략, C-2 FallRiskAssessment FK 참조로 중복 제거, C-3 Patient.allergies→Allergy 공존기 마이그레이션 전략. MAR→Order/Dispensing 체인 명확화. 버전 이력 추가 |
