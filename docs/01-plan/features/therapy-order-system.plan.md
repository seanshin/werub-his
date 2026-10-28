# 치료 오더 시스템 기획서 v1.0

> CPOE에서 치료 처방 → 치료실 워크스테이션 대기 → 일정 관리 전체 워크플로우

---

## 1. 현재 문제

| 문제 | 영향 |
|------|------|
| PrescriptionType에 THERAPY 없음 | 치료 처방을 LAB으로 우회, 검사실과 혼재 |
| OrderDepartment에 THERAPY 없음 | 치료 오더가 LAB 큐에 섞임 |
| CPOE에 치료 처방 UI 없음 | 의사가 물리치료/투석/항암을 처방 불가 |
| 치료 일정 관리 없음 | 치료사가 오늘/내일 일정 확인 불가 |
| 반복 일정 미지원 | 투석(주3회), 방사선(매일) 등 반복 스케줄 필요 |

## 2. 해결 방안

### 2.1 스키마 확장

```prisma
// PrescriptionType에 THERAPY 추가
enum PrescriptionType {
  MEDICATION
  LAB
  IMAGING
  THERAPY    // ← NEW
}

// OrderDepartment에 THERAPY 추가
enum OrderDepartment {
  PHARMACY
  LAB
  IMAGING
  THERAPY    // ← NEW
}
```

### 2.2 치료 오더 모델 (TherapyOrder)

기존 Order를 재사용하되, 치료 특화 필드를 별도 테이블로:

```prisma
model TherapyOrder {
  id              String    @id @default(uuid()) @db.Uuid
  orderId         String    @unique @map("order_id") @db.Uuid
  therapyType     String    @map("therapy_type") @db.VarChar(30)
  // PT_EXERCISE, PT_MODALITY, OT_ADL, ST_SPEECH, HD_SESSION, CHEMO_IV, RT_FRACTION
  scheduledDate   DateTime  @map("scheduled_date") @db.Date
  scheduledTime   String?   @map("scheduled_time") @db.VarChar(10)  // "09:00"
  duration        Int?      // 예상 소요(분)
  therapistId     String?   @map("therapist_id") @db.Uuid
  stationId       String?   @map("station_id") @db.VarChar(30)
  // 반복 스케줄
  isRecurring     Boolean   @default(false) @map("is_recurring")
  recurPattern    String?   @map("recur_pattern") @db.VarChar(50)
  // "MWF" (월수금), "DAILY", "TTS" (화목토), "WEEKLY"
  recurEndDate    DateTime? @map("recur_end_date") @db.Date
  totalSessions   Int?      @map("total_sessions")   // 총 치료 횟수
  sessionNo       Int?      @map("session_no")        // 현재 회차
  // 치료 결과
  resultData      Json?     @map("result_data") @db.JsonB  // 스테이션별 세션 기록
  completedAt     DateTime? @map("completed_at") @db.Timestamptz()
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  order     Order  @relation(fields: [orderId], references: [id])
  therapist User?  @relation("TherapyTherapist", fields: [therapistId], references: [id])

  @@index([scheduledDate, stationId])
  @@index([therapistId, scheduledDate])
  @@map("therapy_orders")
}
```

### 2.3 CPOE 치료 처방 UI

처방(CPOE) 모달에 "치료" 탭 추가:

```
┌─ 새 처방 ──────────────────────────────────────┐
│ [약물] [검사] [영상] [치료]  ← 4번째 탭 추가     │
│                                                  │
│ ■ 치료 유형 선택                                  │
│ ┌─────────────┬─────────────┬──────────────┐     │
│ │ 🏋️ 재활치료  │ 💧 투석      │ 💉 항암       │     │
│ │ 물리/작업/   │ 혈액/복막    │ IV/경구       │     │
│ │ 언어         │             │              │     │
│ └─────────────┴─────────────┴──────────────┘     │
│ ☢️ 방사선     │                                   │
│                                                  │
│ ■ 치료 상세                                       │
│ 세부유형: [운동치료 ▾]                             │
│ 부위: [요추 ▾]                                    │
│ 시간: [30분 ▾]                                    │
│ 횟수: [10회 ▾]  빈도: [주3회(월수금) ▾]            │
│ 시작일: [2026-05-22]                              │
│ 담당 치료사: [고물리치료 ▾] (선택)                  │
│                                                  │
│ ■ 일정 미리보기                                    │
│ 5/22(목) 5/23(금) 5/26(월) 5/28(수) 5/30(금)...  │
│                                                  │
│                    [취소]  [처방]                   │
└──────────────────────────────────────────────────┘
```

### 2.4 치료실 일정 화면

워크스테이션에 **일정 뷰** 추가:

```
┌─ 물리치료실 일정 ──────────────────────────────────┐
│                                                    │
│  [◀ 2026-05-21 ▶]  [오늘] [주간] [월간]             │
│                                                    │
│  08:00  ────────────────────────────               │
│  09:00  홍길동 (운동치료 30분) #3/10  [시작]         │
│  09:30  이영희 (도수치료 20분) #5/10  [시작]         │
│  10:00  박철수 (열전기 30분) #2/15   [시작]          │
│  10:30  ── 빈 슬롯 ──                               │
│  11:00  최수진 (운동치료 30분) #8/10  [시작]         │
│  11:30  ── 빈 슬롯 ──                               │
│  13:00  홍길동 (작업치료 30분) #3/10  [시작]         │
│  13:30  ...                                        │
│                                                    │
│  오늘: 6건 예정 / 3건 완료 / 3건 남음                │
└────────────────────────────────────────────────────┘
```

## 3. 구현 순서

```
Phase 1  ─── PrescriptionType/OrderDepartment에 THERAPY 추가 + TherapyOrder 모델
Phase 2  ─── CPOE 치료 처방 탭 UI + API
Phase 3  ─── 반복 일정 자동 생성 로직
Phase 4  ─── 치료실 일정 뷰 (일간/주간)
Phase 5  ─── 치료사별 스케줄 관리
Phase 6  ─── 기존 RehabSession/DialysisSession 연동
```

## 4. 기존 모델과의 관계

```
의사 CPOE
  → Prescription(type: THERAPY)
    → Order(department: THERAPY)
      → TherapyOrder (치료 특화 필드)
        → scheduledDate/Time (일정)
        → recurPattern (반복)
        → stationId (치료실 배정)
        → resultData (세션 기록)

치료실 워크스테이션
  → TherapyOrder.scheduledDate = today
  → 대기열 표시 + 세션 기록
```
