# CPOE + CDSS 확장 기획서

> **상태(2026-09-14 코드 대조)**: 대체됨 → docs/01-plan/features/cpoe-enhancement.plan.md — docs/01-plan/features/cpoe-enhancement.plan.md · apps/api/src/modules/prescription/prescription.controller.ts

## 현재 상태

### 이미 구현된 것
- **CPOE 기본**: 처방 생성, 복사, 반복, 취소, 오더 자동 생성
- **DUR 기본**: 46개 약물 상호작용 규칙, 연령 금기 5개, 용량 제한 3개, 중복 처방 검증, 알레르기 검증
- **처방 모델**: durChecked, durWarnings (JSON), durOverridden 필드
- **약속처방(CP)**: 26종 CP 세트

### 부족한 것
- CDSS 알림이 UI에 표시되지 않음 (API만 존재)
- 실시간 처방 검증 피드백 없음
- 진단-처방 적합성 검증 없음
- 신기능/간기능 기반 용량 조절 없음
- 임상 가이드라인 권고 없음

## CDSS (Clinical Decision Support System) 확장

### 1. 처방 시점 실시간 검증 (Prescribing Alerts)

처방 입력 모달에서 약물 선택 시 즉시 검증하여 경고를 표시합니다.

```
┌─ 새 처방 입력 ──────────────────────────────────────┐
│                                                      │
│  환자: 김영수 (P2026-0001, 68세 남)                   │
│  진단: I10 고혈압, E11 당뇨                           │
│                                                      │
│  💊 아모디핀 5mg  경구  1일 1회  30일                  │
│                                                      │
│  ┌─ CDSS 검증 결과 ─────────────────────────────────┐ │
│  │ ⚠️ WARNING: 기존 약물과 상호작용                   │ │
│  │   아모디핀 + 심바스타틴 → 횡문근융해증 위험 증가   │ │
│  │   [권고] 심바스타틴 20mg 이하로 감량 고려          │ │
│  │                                                   │ │
│  │ ✅ 알레르기: 해당 없음                             │ │
│  │ ✅ 신기능: eGFR 85 — 용량 조절 불필요              │ │
│  │ ✅ 연령: 적합                                     │ │
│  │ ✅ 중복: 동일 약물 처방 없음                       │ │
│  │ ℹ️ 가이드라인: JNC-8 고혈압 1차 약물 적합           │ │
│  └───────────────────────────────────────────────────┘ │
│                                                      │
│  [처방 추가]  [경고 무시하고 추가 (사유 입력)]          │
└──────────────────────────────────────────────────────┘
```

### 2. CDSS 검증 항목 (7개 영역)

| # | 검증 영역 | 현재 | 확장 목표 | 데이터 소스 |
|---|----------|------|---------|-----------|
| 1 | 약물 상호작용 | ✅ 46규칙 | 100+ 규칙 | DUR 규칙 DB |
| 2 | 알레르기 교차반응 | ✅ 기본 | 성분 기반 교차 | Allergy + ingredient |
| 3 | 연령별 금기 | ✅ 5규칙 | 소아/고령 확대 | 환자 생년월일 |
| 4 | 용량 한계 | ✅ 3규칙 | 체중/신기능 기반 | 환자 체중, eGFR |
| 5 | 중복 처방 | ✅ 기본 | 동일 성분 + 유사 약효군 | 활성 처방 목록 |
| 6 | 진단-처방 적합성 | ❌ | 진단코드 기반 권고 | Encounter 진단 |
| 7 | 임상 가이드라인 | ❌ | 표준 치료 지침 제안 | CP 세트 + 가이드라인 DB |

### 3. API 설계

#### 3.1 실시간 처방 검증

```
POST /api/v1/cdss/check
Body: {
  "patientId": "uuid",
  "medicationCodeId": "uuid",      // 또는 procedureCodeId
  "dosage": "5mg",
  "frequency": "1일 1회",
  "duration": 30,
  "route": "경구",
  "encounterId": "uuid"            // 진단 정보 참조
}

Response:
{
  "data": {
    "level": "WARNING",              // PASS | INFO | WARNING | ERROR
    "passedChecks": 5,
    "totalChecks": 7,
    "checks": [
      {
        "category": "INTERACTION",
        "level": "WARNING",
        "title": "약물 상호작용",
        "message": "아모디핀 + 심바스타틴 → 횡문근융해증 위험 증가",
        "recommendation": "심바스타틴 20mg 이하로 감량 고려",
        "conflictWith": { "name": "심바스타틴 20mg", "prescriptionId": "uuid" },
        "reference": "FDA Drug Interaction Label"
      },
      {
        "category": "ALLERGY",
        "level": "PASS",
        "title": "알레르기 검증",
        "message": "해당 알레르기 없음"
      },
      {
        "category": "RENAL",
        "level": "PASS",
        "title": "신기능 기반 용량",
        "message": "eGFR 85 mL/min — 용량 조절 불필요",
        "patientData": { "eGFR": 85, "creatinine": 1.1 }
      },
      {
        "category": "AGE",
        "level": "PASS",
        "title": "연령 적합성",
        "message": "68세 — 사용 가능"
      },
      {
        "category": "DUPLICATE",
        "level": "PASS",
        "title": "중복 처방",
        "message": "동일/유사 약물 활성 처방 없음"
      },
      {
        "category": "DIAGNOSIS",
        "level": "INFO",
        "title": "진단-처방 적합성",
        "message": "I10(고혈압) — CCB 계열 1차 약물 적합",
        "guideline": "JNC-8 고혈압 치료 가이드라인"
      },
      {
        "category": "GUIDELINE",
        "level": "INFO",
        "title": "임상 가이드라인",
        "message": "고혈압 초진 표준 처방세트(CP-IM-001) 사용 고려",
        "suggestedOrderSet": "CP-IM-001"
      }
    ]
  }
}
```

#### 3.2 처방세트 추천

```
GET /api/v1/cdss/suggest-orderset?diagnosisCode=I10&patientId=uuid
→ 진단 기반 적합한 약속처방 추천
```

```json
{
  "data": {
    "diagnosisCode": "I10",
    "diagnosisName": "본태성 고혈압",
    "suggestedOrderSets": [
      {
        "code": "CP-IM-001",
        "name": "고혈압 초진 기본 처방",
        "matchScore": 95,
        "reason": "I10 진단 + 초진 환자",
        "itemCount": 7
      },
      {
        "code": "CP-IM-002",
        "name": "고혈압 재진 처방",
        "matchScore": 80,
        "reason": "I10 진단 + 기존 처방 이력",
        "itemCount": 2
      }
    ],
    "patientContext": {
      "isFirstVisit": true,
      "existingMedications": ["메트포르민 500mg"],
      "allergies": ["페니실린"],
      "age": 68,
      "eGFR": 85
    }
  }
}
```

#### 3.3 DUR 규칙 관리 (관리자)

```
GET    /api/v1/cdss/rules                    — 규칙 목록
POST   /api/v1/cdss/rules                    — 규칙 추가
PUT    /api/v1/cdss/rules/:id                — 규칙 수정
DELETE /api/v1/cdss/rules/:id                — 규칙 삭제
GET    /api/v1/cdss/rules/stats              — 규칙 적용 통계 (히트 수)
```

### 4. CDSS 규칙 데이터 모델

```prisma
model CdssRule {
  id          String   @id @default(uuid()) @db.Uuid
  category    String   @db.VarChar(30)   // INTERACTION, ALLERGY, AGE, DOSE, DUPLICATE, DIAGNOSIS, GUIDELINE
  level       String   @db.VarChar(10)   // ERROR, WARNING, INFO
  name        String   @db.VarChar(200)
  description String   @db.Text
  
  // 조건
  drugA       String?  @db.VarChar(100)  // 약물/성분 A
  drugB       String?  @db.VarChar(100)  // 약물/성분 B (상호작용 시)
  ageMin      Int?                       // 연령 하한
  ageMax      Int?                       // 연령 상한
  maxDose     String?  @db.VarChar(50)   // 최대 용량
  diagnosisCode String? @db.VarChar(20)  // 관련 진단코드
  
  // 권고
  recommendation String? @db.Text
  reference     String?  @db.VarChar(500) // 근거 문헌
  
  isActive    Boolean  @default(true)
  hitCount    Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@index([category])
  @@index([drugA])
  @@map("cdss_rules")
}
```

### 5. 프론트엔드 UI 통합

#### 5.1 처방 입력 모달에 CDSS 패널 추가

약물 선택 → 즉시 `POST /cdss/check` 호출 → 결과를 처방 추가 버튼 위에 표시

```
[약물 검색 및 선택]
      ↓
[CDSS 검증 결과 패널]
  ✅ 알레르기 통과
  ✅ 신기능 적합
  ⚠️ 약물 상호작용 주의
  ℹ️ 가이드라인 권고
      ↓
[처방 추가] 또는 [경고 무시 (사유 입력)]
```

#### 5.2 경고 레벨별 동작

| 레벨 | UI | 처방 가능 |
|------|-----|---------|
| PASS | ✅ 녹색 | 즉시 가능 |
| INFO | ℹ️ 파랑 | 즉시 가능 (참고) |
| WARNING | ⚠️ 주황 | 가능 (확인 필요) |
| ERROR | 🚫 빨강 | 사유 입력 필수 (durOverridden) |

#### 5.3 처방 목록에 DUR 배지 표시

이미 처방된 약물에 DUR 경고가 있으면 배지로 표시:
```
💊 아모디핀 5mg  ⚠️DUR  1일 1회  30일
```

### 6. 기존 DUR 서비스 → CDSS 서비스 확장

```
현재: DurService (dur.service.ts)
  - checkInteractions()
  - checkAgeContraindications()
  - checkDoseLimits()
  - checkDuplicates()
  - checkAllergies()

확장: CdssService (cdss.service.ts)
  - check()                      ← 통합 검증 (7개 영역)
  - checkDiagnosisAppropriateness()  ← 진단-처방 적합성 (신규)
  - suggestOrderSet()            ← 처방세트 추천 (신규)
  - checkRenalDosing()           ← 신기능 기반 용량 (신규)
  - getGuidelineRecommendation() ← 가이드라인 권고 (신규)
```

### 7. 구현 단계

#### Phase 1: CDSS 통합 검증 API + UI 연결
1. CdssService 생성 (기존 DurService 래핑 + 확장)
2. `POST /api/v1/cdss/check` API
3. 처방 입력 모달에 검증 결과 패널 추가
4. 경고 레벨별 UI (PASS/INFO/WARNING/ERROR)
5. ERROR 시 사유 입력 + durOverridden 처리

#### Phase 2: 진단 기반 권고 + 처방세트 추천
6. 진단-처방 적합성 검증 로직
7. `GET /api/v1/cdss/suggest-orderset` API
8. 처방 모달에 "추천 처방세트" 버튼

#### Phase 3: 규칙 관리 + 고도화
9. CdssRule 테이블 + CRUD API
10. 관리자 규칙 관리 페이지 (/admin/cdss-rules)
11. 신기능 기반 용량 조절 (eGFR → 약물별 조정)
12. 규칙 적용 통계 (히트 수, 무시 비율)

## 기대 효과

| 지표 | 현재 | 목표 |
|------|------|------|
| 처방 오류 감지율 | 수동 확인 | 자동 95% |
| 약물 상호작용 경고 | 46규칙 | 100+ 규칙 |
| DUR 무시 사유 기록 | 미기록 | 100% 기록 |
| 처방세트 활용률 | 수동 선택 | 진단 기반 자동 추천 |
| 가이드라인 준수율 | 측정 불가 | 추적 가능 |
