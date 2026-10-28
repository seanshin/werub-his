# Design: 사전문진표 시스템 고도화 (questionnaire-system)

> Created: 2026-05-18
> Plan: [questionnaire-system.plan.md](../../01-plan/features/questionnaire-system.plan.md)
> Phase 1 (P1 핵심) 상세 설계

---

## 1. DB 스키마

### 1-1. 신규: DepartmentFormMapping

```prisma
model DepartmentFormMapping {
  id             String   @id @default(uuid()) @db.Uuid
  departmentName String   @map("department_name") @db.VarChar(50)
  formSchemaId   String   @map("form_schema_id") @db.Uuid
  visitType      String   @default("ALL") @map("visit_type") @db.VarChar(20)
  // INITIAL | FOLLOW_UP | PRE_OP | ALL
  priority       Int      @default(1)
  isActive       Boolean  @default(true) @map("is_active")
  createdBy      String   @map("created_by") @db.Uuid

  formSchema FormSchema @relation(fields: [formSchemaId], references: [id])
  createdAt  DateTime   @default(now()) @map("created_at") @db.Timestamptz()

  @@unique([departmentName, formSchemaId, visitType])
  @@index([departmentName])
  @@map("department_form_mappings")
}
```

### 1-2. 확장: QuestionnaireToken

```prisma
// 기존 필드 유지 + 추가
model QuestionnaireToken {
  // ... 기존 필드 ...
  status          String    @default("SENT") @db.VarChar(20)
  // SENT | OPENED | IN_PROGRESS | COMPLETED | EXPIRED
  sentVia         String?   @map("sent_via") @db.VarChar(20)
  // CHAT | SMS | KAKAO | QR | MANUAL
  openedAt        DateTime? @map("opened_at") @db.Timestamptz()
  reviewedBy      String?   @map("reviewed_by") @db.Uuid
  reviewedAt      DateTime? @map("reviewed_at") @db.Timestamptz()
  reminderSentAt  DateTime? @map("reminder_sent_at") @db.Timestamptz()

  reviewer User? @relation("QuestionnaireReviewer", fields: [reviewedBy], references: [id])
  @@index([status])
  @@index([patientId, status])
}
```

### 1-3. 확장: FormSchema

```prisma
model FormSchema {
  // ... 기존 필드 ...
  category         String  @default("QUESTIONNAIRE") @db.VarChar(30)
  // QUESTIONNAIRE | SCORING | CONSENT | CUSTOM
  estimatedMinutes Int?    @map("estimated_minutes")
  description      String? @db.VarChar(500)

  departmentMappings DepartmentFormMapping[]
}
```

---

## 2. API 상세 설계

### 2-1. 진료과-양식 매핑 CRUD

**Controller**: `QuestionnaireAdminController` (`api/v1/admin/questionnaire`)

```
GET    /mappings                     진료과-양식 매핑 목록
GET    /mappings?department=내과     진료과별 필터
POST   /mappings                     매핑 생성
PUT    /mappings/:id                 매핑 수정
DELETE /mappings/:id                 매핑 삭제 (soft)
```

**DTO**:
```typescript
class CreateMappingDto {
  departmentName: string;   // "내과"
  formSchemaId: string;     // UUID
  visitType?: string;       // "INITIAL" | "FOLLOW_UP" | "PRE_OP" | "ALL"
  priority?: number;        // 1 (기본)
}
```

**Response** (GET /mappings):
```json
{
  "data": [
    {
      "id": "uuid",
      "departmentName": "내과",
      "visitType": "INITIAL",
      "priority": 1,
      "formSchema": { "id": "uuid", "name": "초진 문진표", "category": "QUESTIONNAIRE" }
    }
  ]
}
```

### 2-2. 문진표 통계/현황

```
GET /admin/questionnaire/stats           전체 통계
GET /admin/questionnaire/pending         미작성 목록
GET /admin/questionnaire/pending?date=today  당일 미작성
POST /admin/questionnaire/send           수동 발송
POST /admin/questionnaire/resend/:id     재발송
```

**Stats Response**:
```json
{
  "data": {
    "total": { "sent": 150, "completed": 98, "pending": 42, "expired": 10 },
    "completionRate": 65.3,
    "byDepartment": [
      { "department": "내과", "sent": 50, "completed": 38, "rate": 76 },
      { "department": "외과", "sent": 30, "completed": 15, "rate": 50 }
    ],
    "today": { "sent": 12, "completed": 5, "pending": 7 }
  }
}
```

**Pending Response**:
```json
{
  "data": [
    {
      "id": "token-uuid",
      "patient": { "familyName": "김", "givenName": "영수", "mrn": "P2026-0001", "phone": "010-1234-5678" },
      "formSchema": { "name": "초진 문진표" },
      "appointment": { "scheduledAt": "2026-05-20T10:00:00", "department": "내과" },
      "status": "SENT",
      "sentVia": "CHAT",
      "createdAt": "2026-05-18T...",
      "expiresAt": "2026-05-20T...",
      "hoursUntilExpiry": 36
    }
  ]
}
```

### 2-3. 환자 문진표 현황 (간호사/의사용)

```
GET /patients/:id/questionnaire-status   환자별 문진표 목록+상태
POST /patients/:id/questionnaire/send    특정 환자에게 수동 발송
PUT /questionnaires/:id/review           검토 완료 처리
```

**Send DTO**:
```typescript
class SendQuestionnaireDto {
  formSchemaId?: string;    // 생략 시 진료과+예약유형으로 자동 선택
  appointmentId?: string;
  sentVia?: string;         // "MANUAL" (기본)
}
```

### 2-4. 공개 API 확장

```
GET  /questionnaires/:token          폼 조회 (기존) + status→OPENED 자동 갱신
POST /questionnaires/:token/submit   폼 제출 (기존) + status→COMPLETED
PUT  /questionnaires/:token/save     임시저장 (P2)
```

**getByToken 변경**: 최초 조회 시 `status=OPENED`, `openedAt` 자동 기록

### 2-5. 예약 시 자동 문진표 선택 로직

```
generateForAppointment(patientId, appointmentId)
  ↓
  1. appointment에서 department, visitType 조회
  ↓
  2. DepartmentFormMapping에서 매칭 양식 조회
     WHERE departmentName = dept
     AND (visitType = type OR visitType = 'ALL')
     ORDER BY priority ASC
  ↓
  3. 매핑 있으면 → 해당 양식으로 토큰 생성
     매핑 없으면 → 기본 '사전문진표'로 폴백
  ↓
  4. 복수 양식이면 각각 토큰 생성 (배열 반환)
```

---

## 3. 프론트엔드 설계

### 3-1. 관리자: 양식 관리 보강 (`/admin/forms`)

**현재**: 읽기 전용 목록
**보강**:

```
┌─────────────────────────────────────────────────┐
│ 문진표 양식 관리                    [+ 양식 생성] │
├─────────────────────────────────────────────────┤
│ 탭: [양식 목록] [진료과 매핑] [통계]              │
├─────────────────────────────────────────────────┤
│                                                 │
│ ┌──────────┬────────┬────────┬──────┬─────────┐ │
│ │ 양식명    │ 카테고리 │ 버전   │ 상태  │ 관리    │ │
│ ├──────────┼────────┼────────┼──────┼─────────┤ │
│ │ 초진문진표 │ 문진표  │ 1.0   │ 활성  │ 편집|복제│ │
│ │ PHQ-9    │ 평가도구 │ 1.0   │ 활성  │ 편집|복제│ │
│ │ 수술전문진 │ 문진표  │ 1.0   │ 활성  │ 편집|복제│ │
│ └──────────┴────────┴────────┴──────┴─────────┘ │
│                                                 │
│ [양식 편집 슬라이드]                               │
│ ┌─────────────────────────────────────┐         │
│ │ 양식명: [초진 문진표        ]        │         │
│ │ 카테고리: [문진표 ▾]                 │         │
│ │ 예상 시간: [5] 분                    │         │
│ │ ─────────────────────              │         │
│ │ 필드 목록:                          │         │
│ │  ☰ 주요 증상 (textarea) [필수]      │         │
│ │  ☰ 증상 시작 시기 (select) [필수]    │         │
│ │  ☰ 과거 병력 (textarea) [선택]      │         │
│ │  [+ 필드 추가]                      │         │
│ │ ─────────────────────              │         │
│ │ [미리보기]        [저장] [취소]       │         │
│ └─────────────────────────────────────┘         │
└─────────────────────────────────────────────────┘
```

### 3-2. 진료과 매핑 탭

```
┌─────────────────────────────────────────────────┐
│ 진료과별 문진표 배정               [+ 매핑 추가]  │
├─────────────────────────────────────────────────┤
│                                                 │
│ ▼ 내과                                          │
│   초진 → 초진 문진표, 생활습관 문진표              │
│   재진 → 재진 문진표                              │
│                                                 │
│ ▼ 정신건강의학과                                  │
│   초진 → 초진 문진표, PHQ-9, GAD-7               │
│   재진 → 재진 문진표, PHQ-9                       │
│                                                 │
│ ▼ 정형외과                                       │
│   초진 → 초진 문진표                              │
│   수술전 → 수술전 문진표                           │
│                                                 │
│ (매핑 없는 진료과: 기본 '사전문진표' 자동 적용)     │
└─────────────────────────────────────────────────┘
```

### 3-3. 문진표 현황 대시보드 (`/admin/questionnaire-dashboard`)

```
┌─────────────────────────────────────────────────┐
│ 문진표 현황                                      │
├─────────────────────────────────────────────────┤
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐    │
│ │ 발송   │ │ 완료   │ │ 미작성  │ │ 만료    │    │
│ │  150   │ │   98   │ │   42   │ │   10   │    │
│ │        │ │  65.3% │ │  28.0% │ │  6.7%  │    │
│ └────────┘ └────────┘ └────────┘ └────────┘    │
│                                                 │
│ 오늘 예약 환자 문진표 (12명)                       │
│ ┌──────┬──────────┬─────────┬──────┬──────────┐ │
│ │ 환자  │ 예약시간   │ 진료과   │ 상태  │ 관리     │ │
│ ├──────┼──────────┼─────────┼──────┼──────────┤ │
│ │ 김영수 │ 10:00    │ 내과    │ ✅완료│ [보기]   │ │
│ │ 박철수 │ 11:00    │ 외과    │ 📨발송│ [재발송] │ │
│ │ 강미래 │ 14:00    │ 소아과   │ ⏳미발│ [발송]   │ │
│ └──────┴──────────┴─────────┴──────┴──────────┘ │
└─────────────────────────────────────────────────┘
```

### 3-4. EMR 진료 화면 연동 (`/encounter/:id`)

```
┌─────────────────────────────────────────────────┐
│ 환자: 김영수 (P2026-0001)                        │
├─────────────────────────────────────────────────┤
│ [SOAP] [오더] [검사] [📋 문진표]                   │
├─────────────────────────────────────────────────┤
│                                                 │
│ 📋 사전 문진표 (2026-05-18 작성)                   │
│ ┌─────────────────────────────────────┐         │
│ │ 주요 증상: 두통, 3일 전부터 지속       │         │
│ │ 증상 정도: 보통                       │         │
│ │ 과거 병력: 고혈압 (2020~)             │         │
│ │ 현재 약물: 아스피린 100mg             │         │
│ │ 알레르기: 페니실린                    │         │
│ └─────────────────────────────────────┘         │
│                                                 │
│ [SOAP에 반영] ← 주요 증상→S, 과거병력→PMH         │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 3-5. 환자 모바일 폼 (`/questionnaire/:token`) 개선

```
┌──────────────────────┐
│ Hospital RUN          │
│ 사전 문진표            │
│ ━━━━━━━━━━━━ 3/8     │  ← 진행률 바
│                      │
│ 주요 증상 *           │
│ ┌──────────────────┐ │
│ │ 어디가 어떻게     │ │
│ │ 불편하신지 ...    │ │
│ └──────────────────┘ │
│                      │
│ 증상 시작 시기 *      │
│ ○ 오늘               │
│ ● 2~3일 전           │  ← 라디오/셀렉트
│ ○ 1주일 전           │
│ ○ 2주 이상           │
│                      │
│ [이전]        [다음 →]│  ← 스텝 네비게이션
│                      │
│ 예상 소요: 약 5분      │
└──────────────────────┘
```

---

## 4. 구현 순서 (Phase 1)

### Step 1: DB 스키마 확장
1. FormSchema에 `category`, `estimatedMinutes`, `description` 추가
2. QuestionnaireToken에 `status`, `sentVia`, `openedAt`, `reviewedBy`, `reviewedAt` 추가
3. DepartmentFormMapping 모델 생성
4. `prisma db push` + generate

### Step 2: 진료과-양식 매핑 백엔드
5. QuestionnaireAdminController + Service 생성
6. 매핑 CRUD API (4개)
7. 기본 시드 데이터 (내과/외과/정신과/정형외과/소아과)
8. `generateForAppointment` 리팩터링 (매핑 기반)

### Step 3: 통계/현황 백엔드
9. stats API (전체/진료과별 작성률)
10. pending API (미작성 목록)
11. 수동 발송/재발송 API
12. getByToken에 OPENED 상태 자동 업데이트

### Step 4: 관리자 프론트엔드
13. `/admin/forms` 보강 (3탭: 양식목록/진료과매핑/통계)
14. 양식 편집 슬라이드 패널 (필드 추가/수정/삭제/순서)
15. 진료과 매핑 설정 UI
16. 양식 미리보기

### Step 5: 문진표 대시보드
17. `/admin/questionnaire-dashboard` 새 페이지
18. 통계 카드 + 당일 미작성 목록
19. 재발송 버튼

### Step 6: EMR 진료 연동
20. encounter 페이지에 문진표 탭/패널 추가
21. 문진표 응답 표시
22. SOAP S항목 자동 채움 버튼

---

## 5. 시드 데이터: 진료과-양식 매핑

| 진료과 | 초진 | 재진 | 수술전 |
|--------|------|------|--------|
| 내과 | 초진문진표 | 재진문진표 | - |
| 외과 | 초진문진표 | 재진문진표 | 수술전문진표 |
| 정형외과 | 초진문진표 | 재진문진표 | 수술전문진표 |
| 소아청소년과 | 초진문진표 | 재진문진표 | - |
| 산부인과 | 초진문진표 | 재진문진표 | 수술전문진표 |
| 정신건강의학과 | 초진문진표 + PHQ-9 + GAD-7 | 재진문진표 + PHQ-9 | - |
| 재활의학과 | 초진문진표 + FIM | 재진문진표 + FIM | - |
| 비뇨의학과 | 초진문진표 + IPSS | 재진문진표 + IPSS | - |
| 신경과 | 초진문진표 + MMSE | 재진문진표 | - |
| 가정의학과 | 초진문진표 | 재진문진표 | - |

---

## 6. 파일 구조

```
apps/api/src/modules/
├── questionnaire/
│   ├── questionnaire.module.ts        (기존 + QuestionnaireAdminController)
│   ├── questionnaire.controller.ts    (기존)
│   ├── questionnaire-admin.controller.ts  [신규] 관리자 API
│   ├── questionnaire-admin.service.ts     [신규] 매핑/통계/발송
│   └── questionnaire.service.ts       (기존 확장)
├── form-engine/
│   ├── form-engine.controller.ts      (기존)
│   └── form-engine.service.ts         (기존)

apps/web/src/app/
├── (main)/admin/
│   ├── forms/page.tsx                 [보강] 3탭 구조
│   └── questionnaire-dashboard/page.tsx [신규]
├── (main)/encounter/[id]/
│   └── (기존 페이지에 문진표 탭 추가)
└── questionnaire/[token]/page.tsx     [보강] 모바일 스텝 폼
```

---

## 7. 의존성

- 기존: Prisma, NestJS, Next.js
- 신규 없음 (Phase 1에서는 외부 의존성 추가 안 함)
- Phase 2에서: SMS/카카오 발송 시 외부 API 필요
