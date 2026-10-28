# 약속처방(CP) + Pre-Order 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/prisma/schema.prisma:12265 model ClinicalPathway · apps/api/prisma/schema.prisma:8762 model PreOrder · apps/api/prisma/schema.prisma:8808 model PreOrderRevision · 잔여: 없음

> **Summary**: 의사별/질환별 약속처방(Clinical Pathway) 및 사전오더(Pre-Order) 시스템 구축
>
> **Project**: Hospital RUN
> **Version**: 0.1.0
> **Author**: user
> **Date**: 2026-05-08
> **Status**: Draft

---

## 1. Overview

### 1.1 배경

현재 Hospital RUN에서 의사가 진료 시마다 처방을 일일이 입력해야 합니다. 실제 병원에서는:
- **약속처방(CP)**: 특정 질환/시술에 대해 미리 정의된 처방 묶음을 한 번에 오더
- **Pre-Order**: 수술 전/입원 시 사전에 정해진 오더셋을 자동 적용

이 두 가지로 처방 시간을 90% 이상 단축하고 표준화된 진료를 보장합니다.

### 1.2 용어 정의

| 용어 | 영문 | 설명 |
|------|------|------|
| **약속처방** | Order Set / Clinical Pathway (CP) | 질환별 표준 처방 묶음 (약/검사/영상 조합) |
| **Pre-Order** | Pre-Admission Order / Standing Order | 입원/수술 전 사전 오더 (수술 전 검사, 금식 지시 등) |
| **개인 즐겨찾기** | Favorite / Quick Order | 의사 개인이 자주 쓰는 처방 조합 |
| **SmartSet** | (Epic 용어) | 진단코드 기반 자동 추천 처방 묶음 |

---

## 2. Scope

### 2.1 In Scope

| ID | Requirement | Priority |
|----|-------------|----------|
| CP-01 | **약속처방 템플릿** — 질환별 표준 처방 묶음 정의 (ADMIN/DOCTOR) | High |
| CP-02 | **진료 시 약속처방 적용** — 처방 입력 시 CP 선택 → 일괄 처방 | High |
| CP-03 | **개인 즐겨찾기** — 의사별 자주 쓰는 처방 조합 저장/적용 | High |
| CP-04 | **Pre-Order (수술 전)** — 수술 예약 시 사전 오더셋 자동 적용 | Medium |
| CP-05 | **Pre-Order (입원 시)** — 입원 접수 시 기본 오더셋 적용 | Medium |
| CP-06 | **진단코드 기반 추천** — KCD 코드 입력 시 관련 CP 자동 제안 | Low |

### 2.2 Out of Scope

- CDSS 규칙 엔진 (약속처방과 별개의 의사결정 지원)
- AI 기반 처방 추천 → 별도 Phase

---

## 3. Functional Requirements

### 3.1 CP-01: 약속처방 템플릿

**데이터 모델:**
```
OrderSet (약속처방 템플릿)
├── id
├── name: String              // "고혈압 초진 기본 처방"
├── department: String?       // 진료과 (내과, 외과 등)
├── category: String          // DISEASE | PROCEDURE | ADMISSION | SURGERY_PRE | CUSTOM
├── diagnosisCode: String?    // KCD 코드 연결 (I10 → 고혈압 처방)
├── description: String?
├── items: Json               // 처방 항목 배열 (아래 구조)
├── isShared: Boolean         // 병원 공용 vs 개인
├── createdBy: String → User
├── isActive: Boolean
├── createdAt, updatedAt

OrderSet.items 구조:
[
  {
    type: "MEDICATION",
    medicationCode: "M001",
    medicationName: "아모디핀 5mg",
    dosage: "5mg",
    frequency: "1일 1회",
    duration: 30,
    route: "PO",
    instructions: "아침 식후"
  },
  {
    type: "LAB",
    procedureCode: "L001",
    procedureName: "CBC (전혈구검사)",
    instructions: "공복"
  },
  {
    type: "IMAGING",
    procedureCode: "I001",
    procedureName: "흉부 X-ray",
    instructions: "PA view"
  }
]
```

**기본 제공 약속처방 (시딩):**

| 분류 | CP명 | 내용 |
|------|------|------|
| **내과 질환** | 고혈압 초진 | 아모디핀 5mg + CBC + BMP + 지질검사 + ECG + 흉부X-ray |
| | 고혈압 재진 | 아모디핀 리필 + BMP |
| | 당뇨 초진 | 메트포르민 500mg + HbA1c + FBS + 지질 + 신기능 + 소변검사 |
| | 당뇨 재진 | 메트포르민 리필 + HbA1c + FBS |
| | 감기/URI | 아세트아미노펜 + 항히스타민 (증상 기반) |
| | 요로감염 | 시프로플록사신 + 소변검사 + 소변배양 |
| **외과** | 수술 전 기본검사 | CBC + BMP + PT/aPTT + 혈액형 + 흉부X-ray + ECG |
| | 충수절제 후 | 항생제(세파졸린) + PCA + 금식→유동식→일반식 |
| **정형외과** | 골절 초기 | X-ray + NSAIDs + 석고고정 |
| | 관절염 재진 | 트라마돌 + 아세트아미노펜 + 물리치료 |
| **소아과** | 소아 발열 | 이부프로펜 시럽 + CBC + CRP + 소변검사 |
| **입원 기본** | 입원 시 기본오더 | CBC + BMP + 흉부X-ray + 소변검사 + 활력징후 1일4회 |

### 3.2 CP-02: 진료 시 약속처방 적용

**워크플로우:**
```
진료 작성 (encounter/new)
    │
    ├── [처방] 탭
    │   ├── 직접 입력 (기존)
    │   ├── [약속처방] 버튼 클릭
    │   │   ├── 병원 공용 CP 목록
    │   │   ├── 내 즐겨찾기 목록
    │   │   └── 진단코드 추천 CP
    │   │
    │   └── CP 선택 → 처방 항목 일괄 추가
    │       ├── 개별 항목 수정/삭제 가능
    │       └── DUR 점검은 동일하게 수행
    │
    └── [서명] → 처방 확정 → OCS 전달
```

### 3.3 CP-03: 개인 즐겨찾기

```
FavoriteOrder (즐겨찾기)
├── id
├── userId: String → User     // 의사 본인
├── name: String              // "내 고혈압 세트", "감기 처방"
├── items: Json               // OrderSet.items와 동일 구조
├── useCount: Int             // 사용 횟수 (자동 정렬용)
├── createdAt
```

**기능:**
- 처방 완료 후 "즐겨찾기 저장" 버튼
- 현재 처방 항목들을 즐겨찾기로 저장
- 다음 진료 시 즐겨찾기에서 바로 적용
- 사용 빈도 기반 자동 정렬

### 3.4 CP-04: 수술 전 Pre-Order

```
수술 예약 시:
    │
    ├── 수술 유형 선택 (충수절제, TKR 등)
    │
    ├── 자동으로 "수술 전 기본검사" CP 적용
    │   ├── CBC, BMP, PT/aPTT, 혈액형/교차시험
    │   ├── 흉부 X-ray, ECG
    │   └── 마취과 의뢰
    │
    ├── 수술별 추가 오더
    │   ├── 정형외과: 수술 부위 X-ray/MRI
    │   ├── 심장수술: 심초음파, 관상동맥 CT
    │   └── 전신마취: 폐기능검사
    │
    └── 수술 전일 오더
        ├── 금식 지시 (자정부터)
        ├── 항생제 예방적 투여 시간 지정
        └── 관장/피부 준비
```

### 3.5 CP-05: 입원 시 Pre-Order

```
입원 접수 시:
    │
    ├── "입원 시 기본오더" CP 자동 적용
    │   ├── 기본 검사 (CBC, BMP, UA, CXR)
    │   ├── 활력징후 측정 빈도 (1일 4회)
    │   ├── 식이 지시 (일반식/특수식)
    │   ├── 활동 제한 (자유/침상안정)
    │   └── 낙상 예방 지시
    │
    ├── 질환별 추가 오더
    │   ├── 심부전 입원: BNP, 흉부X-ray, 심초음파, 수분제한
    │   ├── 폐렴 입원: 객담배양, 혈액배양, PCT, 항생제
    │   └── 당뇨 입원: HbA1c, 혈당 1일4회, 인슐린 프로토콜
    │
    └── 의사 확인 후 오더 확정
```

### 3.6 CP-06: 진단코드 기반 추천

```
진단코드 입력 (Assessment)
    │
    ├── KCD: I10 (고혈압)
    │   └── 추천: "고혈압 초진 CP", "고혈압 재진 CP"
    │
    ├── KCD: E11 (당뇨)
    │   └── 추천: "당뇨 초진 CP", "당뇨 재진 CP"
    │
    └── 복수 진단 시 관련 CP 모두 표시
        └── I10 + E11 → "고혈압+당뇨 복합 CP"
```

---

## 4. API Specification

```
# 약속처방 템플릿
POST   /api/v1/order-sets                    (ADMIN, DOCTOR)
GET    /api/v1/order-sets                    ?category=&department=&diagnosisCode=
GET    /api/v1/order-sets/:id
PUT    /api/v1/order-sets/:id               (ADMIN)
DELETE /api/v1/order-sets/:id               (ADMIN)

# 개인 즐겨찾기
POST   /api/v1/favorite-orders
GET    /api/v1/favorite-orders               (본인 것만)
DELETE /api/v1/favorite-orders/:id

# 진료 시 CP 적용
POST   /api/v1/encounters/:encounterId/apply-order-set
       body: { orderSetId: string, modifications?: any[] }

# 진단코드 기반 추천
GET    /api/v1/order-sets/recommend          ?diagnosisCodes=I10,E11

# Pre-Order (수술)
POST   /api/v1/surgery/:surgeryId/pre-order
       body: { orderSetId?: string }         // 없으면 기본 수술전 CP

# Pre-Order (입원)
POST   /api/v1/admissions/:admissionId/pre-order
       body: { orderSetId?: string }
```

---

## 5. 데이터 모델

```prisma
model OrderSet {
  id             String   @id @default(uuid()) @db.Uuid
  name           String   @unique @db.VarChar(200)
  department     String?  @db.VarChar(50)
  category       String   @db.VarChar(30)        // DISEASE, PROCEDURE, ADMISSION, SURGERY_PRE, CUSTOM
  diagnosisCode  String?  @map("diagnosis_code") @db.VarChar(20)
  description    String?  @db.Text
  items          Json     @db.JsonB              // 처방 항목 배열
  isShared       Boolean  @default(true) @map("is_shared")
  createdBy      String   @map("created_by") @db.Uuid
  isActive       Boolean  @default(true) @map("is_active")
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt      DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  creator User @relation("OrderSetCreator", fields: [createdBy], references: [id])

  @@index([category])
  @@index([department])
  @@index([diagnosisCode])
  @@map("order_sets")
}

model FavoriteOrder {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  name      String   @db.VarChar(200)
  items     Json     @db.JsonB
  useCount  Int      @default(0) @map("use_count")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz()

  user User @relation("UserFavoriteOrders", fields: [userId], references: [id])

  @@index([userId, useCount])
  @@map("favorite_orders")
}
```

---

## 6. UI 설계

### 6.1 진료 작성 페이지 (encounter/new)

```
┌─────────────────────────────────────────────────┐
│  처방 입력                                       │
│                                                  │
│  [약 처방] [검사] [영상]  ▶ [약속처방] [즐겨찾기]  │
│                                                  │
│  ┌─────────────────────────────────────────┐     │
│  │ 약속처방 선택                              │     │
│  │                                          │     │
│  │ 🏥 병원 공용                              │     │
│  │  ├ 고혈압 초진 (6항목)          [적용]     │     │
│  │  ├ 당뇨 초진 (7항목)           [적용]     │     │
│  │  └ 감기/URI (3항목)            [적용]     │     │
│  │                                          │     │
│  │ ⭐ 내 즐겨찾기                            │     │
│  │  ├ 내 고혈압 세트 (4항목)       [적용]     │     │
│  │  └ 내 감기 세트 (2항목)         [적용]     │     │
│  │                                          │     │
│  │ 💡 추천 (I10 기반)                        │     │
│  │  └ 고혈압 초진 CP               [적용]     │     │
│  └─────────────────────────────────────────┘     │
│                                                  │
│  적용된 처방 목록:                                 │
│  ☑ 아모디핀 5mg 1일1회 30일   [수정] [삭제]       │
│  ☑ CBC                       [수정] [삭제]       │
│  ☑ BMP                       [수정] [삭제]       │
│  ☑ 지질검사                    [수정] [삭제]       │
│  ☑ 흉부 X-ray                 [수정] [삭제]       │
│                                                  │
│  [현재 처방을 즐겨찾기 저장]                        │
└─────────────────────────────────────────────────┘
```

### 6.2 관리자 약속처방 관리 (admin/order-sets)

```
┌─────────────────────────────────────────────────┐
│ 약속처방 관리                         [+ 새 CP]   │
│                                                  │
│ [질환별] [수술전] [입원시] [전체]                   │
│                                                  │
│ ┌──────────────────────────────────────────┐    │
│ │ 고혈압 초진 기본 처방     내과  DISEASE    │    │
│ │ 아모디핀 5mg + CBC + BMP + 지질 + ECG     │    │
│ │ KCD: I10                    6항목  [편집]  │    │
│ ├──────────────────────────────────────────┤    │
│ │ 수술 전 기본검사           공용  SURGERY_PRE│    │
│ │ CBC + BMP + PT + 혈액형 + CXR + ECG      │    │
│ │                             6항목  [편집]  │    │
│ └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

---

## 7. 구현 우선순위

```
Phase 1 (High Priority):
  1. OrderSet + FavoriteOrder 모델 추가 — 1일
  2. OrderSet API (CRUD) + 시딩 (12개 기본 CP) — 1일
  3. 진료 작성 페이지 "약속처방" 버튼 + 패널 — 2일
  4. FavoriteOrder API + UI — 1일

Phase 2 (Medium Priority):
  5. 수술 Pre-Order 연동 — 1일
  6. 입원 Pre-Order 연동 — 1일
  7. 관리자 약속처방 관리 페이지 — 1일

Phase 3 (Low Priority):
  8. 진단코드 기반 CP 추천 — 1일
  9. 사용 통계 대시보드 — 1일
```

---

## 8. 기대 효과

| 항목 | Before | After |
|------|--------|-------|
| 고혈압 초진 처방 시간 | 약 3-5분 (6건 개별 입력) | **10초** (CP 1클릭) |
| 수술 전 검사 오더 | 6건 개별 입력 | **자동 적용** (수술 예약 시) |
| 입원 기본 오더 | 5건 개별 입력 | **자동 적용** (입원 접수 시) |
| 처방 표준화 | 의사마다 다름 | **병원 표준 CP** |
| 처방 누락 | 빈번 | **CP에 포함되어 누락 방지** |

---

## 9. Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1.0 | 2026-05-08 | user | 초기 기획서 작성 |
