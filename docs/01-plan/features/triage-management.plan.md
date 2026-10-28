# 트리아지 데이터 관리 시스템

> **Feature**: triage-management
> **Created**: 2026-05-08
> **Status**: Draft
> **Priority**: High

---

## 1. 개요

증상→진료과 매핑 데이터를 코드 하드코딩에서 **DB 기반 관리**로 분리하여,
관리자/의료진이 직접 트리아지 규칙을 추가·수정·비활성화할 수 있도록 한다.

### 1.1 현재 문제점

```
[현재 구조]

agent-session.service.ts
├── SYMPTOM_DEPT_MAP (하드코딩 43개)    ← 수정 시 코드 변경 + 재배포
├── SYMPTOM_ALIAS (하드코딩 30개)       ← 수정 시 코드 변경 + 재배포
└── medicalAi.triage() (WeRU.B API)    ← 외부 의존, 응답 불안정 가능

문제:
1. 매핑 추가/수정 → 개발자 필요, 배포 필요
2. 의료진이 자율적으로 관리 불가
3. 병원마다 진료과 구성이 다름 (커스터마이즈 불가)
4. AI fallback 시 로컬 데이터 품질 관리 어려움
5. 증상 별칭 데이터가 코드에 묻혀 있음
```

### 1.2 목표 구조

```
[개선 구조]

┌──────────────────────────────────────────────────────────┐
│                   트리아지 관리 시스템                      │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ 증상 마스터   │  │ 증상→진료과   │  │ 증상 별칭      │  │
│  │ (Symptom)    │  │ 매핑 (Rule)  │  │ (Alias)       │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬────────┘  │
│         │                 │                  │           │
│         └─────────────────┼──────────────────┘           │
│                           │                              │
│                    ┌──────▼───────┐                      │
│                    │ Triage API   │                      │
│                    │ (DB 기반)    │                      │
│                    └──────┬───────┘                      │
│                           │                              │
│              ┌────────────┼────────────┐                 │
│              ▼            ▼            ▼                 │
│      ┌────────────┐ ┌─────────┐ ┌──────────┐           │
│      │ 접수 AI     │ │ Booking │ │ WeRU.B   │           │
│      │ Agent      │ │ Agent   │ │ AI 보강   │           │
│      └────────────┘ └─────────┘ └──────────┘           │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 관리 UI (/admin/triage)                           │   │
│  │ - 증상 CRUD / 매핑 CRUD / 별칭 CRUD              │   │
│  │ - 응급 키워드 관리 / 우선순위 설정                  │   │
│  │ - 매핑 통계 (히트 수) / AI vs 로컬 비교            │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

---

## 2. 데이터 모델

### 2.1 증상 마스터 (TriageSymptom)

```prisma
model TriageSymptom {
  id          String   @id @default(uuid()) @db.Uuid
  name        String   @unique @db.VarChar(50)    // "두통", "복통", "흉통"
  category    String?  @db.VarChar(50)             // "신경계", "소화기", "순환기", "근골격"
  description String?  @db.VarChar(200)            // "머리 부위의 통증"
  isEmergency Boolean  @default(false)             // 응급 키워드 여부
  emergencyMsg String? @map("emergency_msg") @db.Text  // 응급 시 표시 메시지
  isActive    Boolean  @default(true)
  sortOrder   Int      @default(0) @map("sort_order")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  rules       TriageRule[]
  aliases     TriageAlias[]

  @@index([category])
  @@map("triage_symptoms")
}
```

### 2.2 증상→진료과 매핑 (TriageRule)

```prisma
model TriageRule {
  id             String   @id @default(uuid()) @db.Uuid
  symptomId      String   @map("symptom_id") @db.Uuid
  departmentName String   @map("department_name") @db.VarChar(100)
  priority       Int      @default(1)              // 1순위, 2순위, 3순위
  confidence     Int      @default(70)             // 신뢰도 (%)
  reason         String?  @db.VarChar(200)         // "일반 두통", "편두통/만성 두통"
  condition      String?  @db.VarChar(200)         // 조건: "만성", "급성", "소아" 등
  isActive       Boolean  @default(true)
  hitCount       Int      @default(0) @map("hit_count") // 매핑 사용 횟수
  createdBy      String   @map("created_by") @db.Uuid
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  symptom        TriageSymptom @relation(fields: [symptomId], references: [id])

  @@unique([symptomId, departmentName])
  @@index([departmentName])
  @@map("triage_rules")
}
```

### 2.3 증상 별칭 (TriageAlias)

```prisma
model TriageAlias {
  id          String   @id @default(uuid()) @db.Uuid
  symptomId   String   @map("symptom_id") @db.Uuid
  alias       String   @unique @db.VarChar(50)     // "머리가 아파", "머리아파"
  isActive    Boolean  @default(true)
  hitCount    Int      @default(0) @map("hit_count")
  createdAt   DateTime @default(now()) @map("created_at")

  symptom     TriageSymptom @relation(fields: [symptomId], references: [id])

  @@index([alias])
  @@map("triage_aliases")
}
```

---

## 3. API 설계

### 3.1 트리아지 실행 API (기존 Agent에서 사용)

```
POST /api/v1/triage/evaluate
  Body: { text: "머리가 아프고 열이 나요" }
  Response: {
    data: {
      symptoms: ["두통", "발열"],
      recommendations: [
        { department: "내과", priority: 1, confidence: 85, reason: "일반 두통+발열" },
        { department: "신경과", priority: 2, confidence: 70, reason: "편두통 감별" }
      ],
      emergency: false,
      source: "DB"          // "DB", "AI", "HYBRID"
    }
  }

흐름:
1. 입력 텍스트에서 별칭 매핑으로 증상 키워드 추출
2. 추출된 증상으로 DB TriageRule 조회
3. DB 결과 있으면 → 반환 (source: "DB")
4. DB 결과 없으면 → WeRU.B AI API 호출 (source: "AI")
5. 둘 다 있으면 → 가중 병합 (source: "HYBRID")
```

### 3.2 증상 관리 API

```
GET    /api/v1/triage/symptoms              전체 증상 목록 (?category, ?isActive)
POST   /api/v1/triage/symptoms              증상 추가
PATCH  /api/v1/triage/symptoms/:id          증상 수정
DELETE /api/v1/triage/symptoms/:id          증상 비활성화
```

### 3.3 매핑 규칙 관리 API

```
GET    /api/v1/triage/rules                 매핑 규칙 목록 (?symptomId, ?department)
POST   /api/v1/triage/rules                 규칙 추가
PATCH  /api/v1/triage/rules/:id             규칙 수정
DELETE /api/v1/triage/rules/:id             규칙 비활성화
GET    /api/v1/triage/rules/stats           매핑 통계 (히트 수 Top 20)
```

### 3.4 별칭 관리 API

```
GET    /api/v1/triage/aliases               별칭 목록 (?symptomId)
POST   /api/v1/triage/aliases               별칭 추가
POST   /api/v1/triage/aliases/bulk          별칭 일괄 추가
DELETE /api/v1/triage/aliases/:id           별칭 삭제
```

### 3.5 초기 데이터 마이그레이션 API

```
POST   /api/v1/triage/migrate-from-code     하드코딩된 데이터를 DB로 마이그레이션
```

---

## 4. 트리아지 실행 흐름 (개선)

```
사용자 입력: "머리가 아프고 열이 나요"
        │
        ▼
[1단계] 별칭 매핑 (DB: triage_aliases)
        "머리가 아프" → "두통"    (alias hit_count++)
        "열이 나"     → "발열"    (alias hit_count++)
        추출 결과: ["두통", "발열"]
        │
        ▼
[2단계] 응급 체크 (DB: triage_symptoms.isEmergency)
        "두통" → isEmergency: false
        "발열" → isEmergency: false
        응급 아님 → 계속
        │
        ▼
[3단계] 매핑 조회 (DB: triage_rules)
        "두통" → [내과(1순위,85%), 신경과(2순위,70%)]
        "발열" → [내과(1순위,80%), 소아청소년과(2순위,60%)]
        │
        ▼
[4단계] 점수 병합
        내과: 85 + 80 = 165 (최고)
        신경과: 70
        소아청소년과: 60
        │
        ▼
[5단계] AI 보강 (선택, WeRU.B API 가용 시)
        AI 추천과 DB 추천을 가중 병합
        DB 70% + AI 30% 가중치
        │
        ▼
[결과] { department: "내과", confidence: 85%, reason: "두통+발열" }
       { department: "신경과", confidence: 70%, reason: "편두통 감별" }
       rule hit_count++
```

---

## 5. 관리 UI

### 5.1 트리아지 관리 페이지 (/admin/triage)

```
┌─ 트리아지 관리 ─────────────────────────────────────────────┐
│                                                              │
│  ┌────────┬─────────┬────────┬────────┐                     │
│  │ 증상   │ 매핑규칙 │ 별칭   │ 통계   │                     │
│  └────────┴─────────┴────────┴────────┘                     │
│                                                              │
│  [+ 증상 추가]  카테고리: [전체▼]                             │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 🔴 흉통  (순환기)           응급                      │   │
│  │    → 응급의학과 (1순위, 90%) | 내과 (2순위, 85%)      │   │
│  │    별칭: 가슴아파, 가슴이 아파, 가슴 답답 (+3)        │   │
│  │    히트 수: 156회                          [편집]     │   │
│  │ ──────────────────────────────────────────────────── │   │
│  │    두통  (신경계)                                     │   │
│  │    → 내과 (1순위, 85%) | 신경과 (2순위, 70%)          │   │
│  │    별칭: 머리아파, 머리가 아퍼, 머리 (+5)              │   │
│  │    히트 수: 247회                          [편집]     │   │
│  │ ──────────────────────────────────────────────────── │   │
│  │    복통  (소화기)                                     │   │
│  │    → 내과 (1순위, 80%) | 외과 (2순위, 65%)            │   │
│  │    별칭: 배아파, 배가 아퍼, 속이 아파 (+4)             │   │
│  │    히트 수: 189회                          [편집]     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ 통계 요약 ─────────────────────────────────────────┐    │
│  │ 등록 증상: 43개 | 매핑 규칙: 86개 | 별칭: 78개       │    │
│  │ 이번 달 트리아지: 1,247건 (DB: 89%, AI: 11%)         │    │
│  │ 매핑 적중률: 94.2%                                   │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 증상 편집 모달

```
┌─ 증상 편집: 두통 ─────────────────────────────────┐
│                                                    │
│  이름: [두통]           카테고리: [신경계▼]         │
│  설명: [머리 부위의 통증]                           │
│  응급: [ ] 응급 키워드                              │
│                                                    │
│  ── 진료과 매핑 ──                                 │
│  1순위: [내과▼]       신뢰도: [85%]                │
│         사유: [일반 두통]                            │
│  2순위: [신경과▼]     신뢰도: [70%]                │
│         사유: [편두통/만성 두통]                     │
│  [+ 3순위 추가]                                     │
│                                                    │
│  ── 별칭 (자연어 매핑) ──                           │
│  머리가 아파 [×]  머리아파 [×]  머리 [×]            │
│  머리가 아퍼 [×]  두통이 [×]                        │
│  [+ 별칭 추가: ________ ]                           │
│                                                    │
│              [취소]  [저장]                          │
└────────────────────────────────────────────────────┘
```

---

## 6. 초기 데이터 마이그레이션

현재 하드코딩된 `SYMPTOM_DEPT_MAP`(43개)과 `SYMPTOM_ALIAS`(30개)를 DB로 자동 이전:

```
POST /api/v1/triage/migrate-from-code

실행 내용:
1. SYMPTOM_DEPT_MAP 순회 → TriageSymptom + TriageRule 생성
   예: '두통': { depts: ['내과','신경과'] }
   → TriageSymptom { name: '두통', category: '신경계' }
   → TriageRule { symptom: '두통', dept: '내과', priority: 1, confidence: 85 }
   → TriageRule { symptom: '두통', dept: '신경과', priority: 2, confidence: 70 }

2. SYMPTOM_ALIAS 순회 → TriageAlias 생성
   예: '머리가 아파' → '두통'
   → TriageAlias { alias: '머리가 아파', symptom: '두통' }

3. 마이그레이션 완료 후 코드의 하드코딩 데이터를 fallback으로만 유지
```

---

## 7. Agent 서비스 연동 변경

```typescript
// 변경 전 (하드코딩)
const deptRecs = this.recommendDepartments(symptoms);  // 로컬 Map

// 변경 후 (DB + AI 하이브리드)
const triageResult = await this.triageService.evaluate(input);
// triageResult.source === 'DB' | 'AI' | 'HYBRID'
// DB 없으면 AI, AI 없으면 로컬 fallback
```

---

## 8. 구현 우선순위

### Phase 1: DB 분리 + API (P0)
```
1. TriageSymptom, TriageRule, TriageAlias 모델 생성
2. TriageService (evaluate, CRUD)
3. 마이그레이션 API (하드코딩 → DB)
4. AgentSessionService에서 TriageService 호출로 변경
5. 초기 시드 데이터
```

### Phase 2: 관리 UI (P1)
```
1. /admin/triage 관리 페이지
2. 증상/매핑/별칭 CRUD UI
3. 통계 대시보드 (히트 수, 적중률)
```

### Phase 3: AI 하이브리드 (P2)
```
1. DB + AI 가중 병합 로직
2. AI 추천 학습 → DB 자동 제안
3. 매핑 적중률 분석 리포트
```
