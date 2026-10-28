# 약속처방(CP/Order Set) 관리 고도화 기획서

## 현재 상태

### 구현된 것
- OrderSet 모델: name, diagnosisCode, category, items(JSON), isActive
- 시드: 26개 CP (입원시, 질환별, 수술전후)
- 프론트: 목록 조회 + 카테고리 필터 + 항목 펼침
- 진료 입력 화면에서 CP 적용 (항목 → 처방 목록 복사)

### 부족한 것
- CP 생성/수정 UI 없음 (시드 데이터만)
- 버전 관리 없음 (수정 시 이력 추적 불가)
- 복사/복제 기능 없음
- 항목 드래그 정렬 없음
- 진료과별/의사별 커스텀 CP 없음
- CP 사용 통계 없음
- 승인 워크플로우 없음 (누구나 수정 가능)
- CP 검색 (약물명/진단코드로) 없음

## 기능 설계

### 1. CP 생성/수정 빌더

```
┌─ 약속처방 편집기 ─────────────────────────────────────────────────────────┐
│                                                                           │
│  CP 코드: [CP-IM-NEW]     이름: [고혈압 초진 기본 처방 ________]          │
│  카테고리: [질환별 ▼]     진료과: [내과 ▼]    진단코드: [I10 ▼]          │
│  상태: [초안 ▼]                                                          │
│                                                                           │
│  ── 처방 항목 ──────────────────────────────────────────────────────────  │
│                                                                           │
│  ☰ 1. [MEDICATION ▼] [아모디핀 5mg ______] [5mg 1일 1회 __] [비고 __]   │
│  ☰ 2. [MEDICATION ▼] [아스피린 100mg ____] [100mg 1일 1회 _] [비고 __]  │
│  ☰ 3. [LAB ▼]        [일반혈액검사(CBC) __] [____________] [비고 __]    │
│  ☰ 4. [LAB ▼]        [신장기능검사 _______] [____________] [비고 __]    │
│  ☰ 5. [ORDER ▼]      [혈압 모니터링 ______] [____________] [지속 __]    │
│                                                                           │
│  [+ 항목 추가]    [약물 검색으로 추가]    [기존 CP에서 가져오기]          │
│                                                                           │
│  ── 적용 조건 ──                                                          │
│  적용 시점: [○ 입원 시  ● 질환별  ○ 수술 전  ○ 수술 후]                 │
│  대상 연령: [전체 ▼]     대상 성별: [전체 ▼]                              │
│  금기 조건: [신부전 eGFR<30 시 메트포르민 제외 _________]                  │
│                                                                           │
│  [저장 (초안)]  [승인 요청]  [미리보기]  [취소]                            │
└───────────────────────────────────────────────────────────────────────────┘
```

### 2. 데이터 모델 확장

```prisma
// 기존 OrderSet 모델 확장
model OrderSet {
  // 기존 필드 유지
  id             String   @id @default(uuid()) @db.Uuid
  name           String   @db.VarChar(300)
  diagnosisCode  String?  @map("diagnosis_code") @db.VarChar(20)
  category       String?  @db.VarChar(50)
  items          Json     @db.JsonB
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())

  // 신규 필드
  code           String?  @db.VarChar(30)           // CP-IM-001
  department     String?  @db.VarChar(50)           // 진료과
  version        Int      @default(1)               // 버전
  status         String   @default("DRAFT") @db.VarChar(20) // DRAFT, PENDING_APPROVAL, APPROVED, DEPRECATED
  description    String?  @db.Text                  // 상세 설명
  applicableTo   String?  @map("applicable_to") @db.VarChar(30) // ADMISSION, DISEASE, PRE_OP, POST_OP, DISCHARGE
  ageGroup       String?  @map("age_group") @db.VarChar(20) // ALL, PEDIATRIC, ADULT, GERIATRIC
  contraindications Json? @db.JsonB                 // 금기 조건
  evidenceLevel  String?  @map("evidence_level") @db.VarChar(10) // A, B, C, D
  guidelineRef   String?  @map("guideline_ref") @db.VarChar(200) // 근거 가이드라인
  createdBy      String?  @map("created_by") @db.Uuid
  approvedBy     String?  @map("approved_by") @db.Uuid
  approvedAt     DateTime? @map("approved_at") @db.Timestamptz()
  useCount       Int      @default(0) @map("use_count") // 사용 횟수
  lastUsedAt     DateTime? @map("last_used_at") @db.Timestamptz()
  parentId       String?  @map("parent_id") @db.Uuid // 복제 원본
  updatedAt      DateTime @updatedAt @map("updated_at") @db.Timestamptz()
}

// CP 사용 이력
model OrderSetUsage {
  id           String   @id @default(uuid()) @db.Uuid
  orderSetId   String   @map("order_set_id") @db.Uuid
  encounterId  String   @map("encounter_id") @db.Uuid
  patientId    String   @map("patient_id") @db.Uuid
  usedBy       String   @map("used_by") @db.Uuid
  usedAt       DateTime @default(now()) @map("used_at") @db.Timestamptz()
  itemsApplied Int      @map("items_applied") // 적용된 항목 수
  itemsModified Int     @map("items_modified") // 수정된 항목 수

  @@map("order_set_usages")
}
```

### 3. API

| # | Method | Endpoint | 설명 | 권한 |
|---|--------|----------|------|------|
| 1 | GET | `/api/v1/order-sets` | 목록 (카테고리/진료과/상태 필터) | ALL |
| 2 | GET | `/api/v1/order-sets/:id` | 상세 | ALL |
| 3 | POST | `/api/v1/order-sets` | CP 생성 | DOCTOR, ADMIN |
| 4 | PUT | `/api/v1/order-sets/:id` | CP 수정 | DOCTOR, ADMIN |
| 5 | POST | `/api/v1/order-sets/:id/clone` | CP 복제 (새 버전) | DOCTOR, ADMIN |
| 6 | PATCH | `/api/v1/order-sets/:id/status` | 상태 변경 (승인 등) | ADMIN |
| 7 | PATCH | `/api/v1/order-sets/:id/deprecate` | CP 폐기 | ADMIN |
| 8 | GET | `/api/v1/order-sets/search` | 약물명/진단코드로 검색 | ALL |
| 9 | POST | `/api/v1/order-sets/:id/use` | 사용 기록 | DOCTOR |
| 10 | GET | `/api/v1/order-sets/stats` | 사용 통계 | ADMIN |
| 11 | GET | `/api/v1/order-sets/:id/history` | 버전 이력 | ALL |

### 4. 화면 개선

```
약속처방 관리 (/admin/order-sets)
├── 목록 (기존 + 상태 배지 + 사용횟수 + 진료과)
├── CP 빌더 (생성/수정)
│   ├── 기본 정보 (코드/이름/카테고리/진료과/진단코드)
│   ├── 항목 편집기 (타입/약물/검사/오더, 드래그 정렬)
│   ├── 적용 조건 (시점/연령/금기)
│   └── 근거 (가이드라인/근거수준)
├── 승인 관리 (DRAFT→PENDING→APPROVED)
├── 사용 통계 (사용률, 수정률, 진료과별)
└── 버전 이력
```

#### CP 빌더 항목 편집
```
┌─ 항목 ──────────────────────────────────────────────────────┐
│  ☰  타입: [MEDICATION ▼]                          [✕ 삭제]  │
│                                                             │
│  약물: [아모디핀 5mg ___________] [🔍 검색]                  │
│  코드: E-AMO-005                                            │
│                                                             │
│  용법: [5mg ___]  횟수: [1일 1회 ___]  경로: [경구 ▼]       │
│  일수: [30일 __]                                            │
│  비고: [식후 30분 복용 _________________]                    │
│                                                             │
│  ☐ 필수 항목 (적용 시 반드시 포함)                           │
│  ☐ CDSS 검증 대상                                           │
└─────────────────────────────────────────────────────────────┘
```

#### 사용 통계
```
┌─ CP 사용 통계 ────────────────────────────────────────────────┐
│                                                               │
│  TOP 10 사용 CP                    진료과별 사용 현황          │
│  1. 흉통 응급 프로토콜    156회    내과: 45%                   │
│  2. 입원 시 기본오더      142회    응급: 28%                   │
│  3. 고혈압 초진           98회     외과: 15%                   │
│  4. 당뇨 추적             87회     기타: 12%                   │
│  5. ICU 입실              76회                                │
│                                                               │
│  수정률: 32% (적용 후 항목 변경)                               │
│  평균 적용 항목: 8.5개                                        │
└───────────────────────────────────────────────────────────────┘
```

## 구현 우선순위

1. **CP 생성/수정 빌더** — 항목 추가/삭제/정렬, 기본정보
2. **CP 복제** — 기존 CP 기반 새 버전 생성
3. **승인 워크플로우** — DRAFT→PENDING→APPROVED
4. **사용 통계** — 사용 횟수, 진료과별, 수정률
5. **검색 강화** — 약물명/진단코드로 CP 검색
