# 외래 진료 워크플로우 기획서 (v2)

> **상태(2026-09-15 코드 대조 갱신)**: 구현됨 — apps/api/src/modules/waiting-queue · 휴진 영향 예약 `apps/api/src/modules/clinic-schedule/clinic-schedule.controller.ts:82` affected/:date(A5) · 반일 휴진 예약 판정 공용화 `apps/api/src/modules/schedule/schedule.service.ts:21` classifyClosureImpact(P3) · 직원 예약 변경도 validateBookable·의사 락(S1 `424fcd59`) · 잔여: 없음

## 1. 현황 분석

### 현재 시스템
- 예약 등록 → 접수(체크인) → 진료(SOAP) → 처방 → 수납
- **문제점**: 당일 직접 방문(walk-in) 부재, 진료표 없음, 대기열 없음, 휴진 관리 없음

### 한국 병원 외래 진료 현실
- 예약 환자 50% + **당일 접수(walk-in) 50%**
- **진료표**: 의사별 요일/오전·오후 진료 스케줄 (주간 단위)
- **환자 선택**: 접수 시 환자가 원하는 의사를 직접 선택 가능
- **자동 배정**: 환자가 의사를 선택하지 않으면 균등 배정
- **휴진**: 의사 부재 시 같은 과 다른 의사로 자동 대체
- 접수 → 대기 → 호출 → 진료 → 수납 → 약국

---

## 2. 진료표 (Clinic Schedule) 설계

### 2-1. 진료표 개념

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        Hospital RUN 외래 진료표                                │
├──────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬────┤
│      │   월요일  │   화요일  │   수요일  │   목요일  │   금요일  │   토요일  │    │
├──────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼────┤
│      │ 오전│오후 │ 오전│오후 │ 오전│오후 │ 오전│오후 │ 오전│오후 │ 오전│    │    │
├──────┼─────┼────┼─────┼────┼─────┼────┼─────┼────┼─────┼────┼─────┼────┤
│내  과│     │    │     │    │     │    │     │    │     │    │     │    │
│ 김내과│  ●  │ ●  │  ●  │    │  ●  │ ●  │  ●  │    │  ●  │ ●  │  ●  │    │
│ 박내과│  ●  │    │  ●  │ ●  │     │ ●  │  ●  │ ●  │  ●  │    │     │    │
├──────┼─────┼────┼─────┼────┼─────┼────┼─────┼────┼─────┼────┼─────┼────┤
│외  과│     │    │     │    │     │    │     │    │     │    │     │    │
│ 이외과│  ●  │ ●  │     │ ●  │  ●  │ ●  │     │ ●  │  ●  │ ●  │     │    │
│ 최외과│     │ ●  │  ●  │ ●  │  ●  │    │  ●  │ ●  │     │ ●  │  ●  │    │
├──────┼─────┼────┼─────┼────┼─────┼────┼─────┼────┼─────┼────┼─────┼────┤
│소아과│     │    │     │    │     │    │     │    │     │    │     │    │
│ 정소아│  ●  │ ●  │  ●  │ ●  │  ●  │    │  ●  │ ●  │  ●  │ ●  │  ●  │    │
├──────┼─────┼────┼─────┼────┼─────┼────┼─────┼────┼─────┼────┼─────┼────┤
│산부과│     │    │     │    │     │    │     │    │     │    │     │    │
│ 한산부│  ●  │    │  ●  │ ●  │  ●  │    │  ●  │ ●  │  ●  │    │     │    │
├──────┼─────┼────┼─────┼────┼─────┼────┼─────┼────┼─────┼────┼─────┼────┤
│정형과│     │    │     │    │     │    │     │    │     │    │     │    │
│ 오정형│  ●  │ ●  │  ●  │    │  ●  │ ●  │  ●  │    │  ●  │ ●  │     │    │
└──────┴─────┴────┴─────┴────┴─────┴────┴─────┴────┴─────┴────┴─────┴────┘
● = 진료  (빈칸 = 비진료/수술/연구일)
```

### 2-2. 진료표 데이터 모델

```prisma
// 주간 진료표 (반복 패턴)
model ClinicSchedule {
  id            String   @id @default(uuid()) @db.Uuid
  doctorId      String   @map("doctor_id") @db.Uuid
  departmentName String  @map("department_name") @db.VarChar(100)
  roomName      String   @map("room_name") @db.VarChar(100)    // "내과 1진료실"
  dayOfWeek     Int      @map("day_of_week")                    // 0=일, 1=월, ..., 6=토
  period        String   @db.VarChar(10)                        // "AM", "PM", "ALL"
  startTime     String   @map("start_time") @db.VarChar(5)     // "09:00"
  endTime       String   @map("end_time") @db.VarChar(5)       // "12:30"
  maxPatients   Int      @default(20) @map("max_patients")     // 오전/오후 최대 접수 수
  isActive      Boolean  @default(true) @map("is_active")
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  doctor User @relation("DoctorClinicSchedules", fields: [doctorId], references: [id])

  @@unique([doctorId, dayOfWeek, period])
  @@index([departmentName])
  @@map("clinic_schedules")
}

// 휴진/대체 (특정 날짜)
model ClinicClosure {
  id            String    @id @default(uuid()) @db.Uuid
  doctorId      String    @map("doctor_id") @db.Uuid
  date          DateTime  @db.Date
  period        String?   @db.VarChar(10)                      // "AM", "PM", null=종일
  reason        String    @db.VarChar(200)                     // "학회 참석", "개인 사유", "연차"
  substituteId  String?   @map("substitute_id") @db.Uuid       // 대체 의사 (null이면 진료 중단)
  notifyPatients Boolean  @default(true) @map("notify_patients")
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  doctor      User  @relation("DoctorClosures", fields: [doctorId], references: [id])
  substitute  User? @relation("SubstituteClosures", fields: [substituteId], references: [id])

  @@unique([doctorId, date, period])
  @@index([date])
  @@map("clinic_closures")
}
```

### 2-3. 휴진 처리 흐름

```
1. 관리자가 휴진 등록
   - 김내과, 2026-05-10 (수요일), 오전 휴진
   - 사유: "학회 참석"
   - 대체: 박내과

2. 해당일 접수 시
   - 김내과 오전 → "휴진" 표시, 접수 불가
   - 대신 "박내과 (대체진료)" 선택 가능
   - 기존 예약 환자 → 자동으로 박내과에게 이관 알림

3. 환자에게 안내
   - "김내과 선생님은 5/10 오전 휴진입니다."
   - "박내과 선생님이 대체 진료합니다."
   - "다른 날짜로 변경하시겠습니까?"
```

---

## 3. 접수 워크플로우 (개정)

### 3-1. 전체 흐름

```
환자 도착
  │
  ├─ 예약 있음? ─── Yes ──▶ 예약 확인 → [접수] → 대기열
  │                          (진료과/의사 이미 정해짐)
  │
  └─ 예약 없음 ─── Walk-in ──▶ 접수 데스크
                                │
                                ├─ 1. 환자 확인 (기존/신환)
                                ├─ 2. 진료과 선택
                                ├─ 3. 의사 선택 ◀── 핵심!
                                │    ├─ 환자가 직접 선택 (원하는 의사)
                                │    ├─ 원무 직원이 추천/배정
                                │    └─ 자동 배정 (의사 미선택 시)
                                ├─ 4. 초진/재진 선택
                                └─ 5. [접수 완료] → 대기열
```

### 3-2. 의사 선택 화면 (접수 시)

```
┌──────────────────────────────────────────────────┐
│  진료과: [내과 ▼]                                  │
│                                                    │
│  오늘 내과 진료 의사                                │
│  ┌────────────────────────────────────────────┐    │
│  │ ● 김내과 전문의                              │    │
│  │   오전 진료 (09:00~12:30) | 오후 진료 (14:00~17:30) │
│  │   현재 대기: 3명 | 진료실: 내과 1진료실 (201호)  │    │
│  │   [선택]                                     │    │
│  ├────────────────────────────────────────────┤    │
│  │ ● 박내과 전문의                              │    │
│  │   오전 비진료 | 오후 진료 (14:00~17:30)        │    │
│  │   현재 대기: 1명 | 진료실: 내과 2진료실 (202호)  │    │
│  │   [선택]                                     │    │
│  ├────────────────────────────────────────────┤    │
│  │ ⚠️ 참고: 오전은 김내과만 진료합니다.            │    │
│  └────────────────────────────────────────────┘    │
│                                                    │
│  ○ 의사 선택 안 함 (자동 배정)                       │
│                                                    │
│  접수 유형: ○ 초진  ● 재진                          │
│  접수 사유: [기침, 발열____________]                 │
│                                                    │
│  [접수 완료]                                        │
└──────────────────────────────────────────────────┘
```

### 3-3. 의사 배정 로직 (자동)

```python
def assign_doctor(department, current_time):
    # 1. 진료표에서 오늘/현재 시간대 진료 가능한 의사 조회
    period = "AM" if current_time.hour < 13 else "PM"
    day_of_week = current_time.weekday() + 1  # 1=월~6=토, 0=일
    
    available = ClinicSchedule.filter(
        department=department,
        day_of_week=day_of_week,
        period__in=[period, "ALL"],
        is_active=True
    )
    
    # 2. 휴진 제외
    closures = ClinicClosure.filter(date=today, period__in=[period, None])
    available = [a for a in available if a.doctor_id not in closures]
    
    # 3. 대체 의사 추가 (휴진 의사의 대체)
    for closure in closures:
        if closure.substitute_id:
            available.append(substitute_schedule)
    
    # 4. 최대 접수 수 초과 제외
    available = [a for a in available if a.current_count < a.max_patients]
    
    # 5. 대기 수가 가장 적은 의사 선택
    return min(available, key=lambda a: a.waiting_count)
```

---

## 4. 대기열 관리

### 4-1. 대기열 상태

```
WAITING ──▶ CALLED ──▶ IN_CONSULTATION ──▶ COMPLETED
   │           │              │
   └── CANCELLED / NO_SHOW ◀──┘
```

### 4-2. 대기열 데이터 모델

```prisma
model WaitingQueue {
  id              String   @id @default(uuid()) @db.Uuid
  patientId       String   @map("patient_id") @db.Uuid
  doctorId        String   @map("doctor_id") @db.Uuid
  departmentName  String   @map("department_name") @db.VarChar(100)
  roomName        String?  @map("room_name") @db.VarChar(100)
  queueNumber     Int      @map("queue_number")           // 당일 순번
  type            String   @default("WALK_IN") @db.VarChar(20)  // APPOINTMENT, WALK_IN
  visitType       String   @default("INITIAL") @db.VarChar(20)  // INITIAL, FOLLOW_UP
  reason          String?  @db.Text
  status          String   @default("WAITING") @db.VarChar(20)
  appointmentId   String?  @unique @map("appointment_id") @db.Uuid
  encounterId     String?  @unique @map("encounter_id") @db.Uuid
  checkedInAt     DateTime @default(now()) @map("checked_in_at") @db.Timestamptz()
  calledAt        DateTime? @map("called_at") @db.Timestamptz()
  startedAt       DateTime? @map("started_at") @db.Timestamptz()
  completedAt     DateTime? @map("completed_at") @db.Timestamptz()
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz()

  patient  Patient @relation(fields: [patientId], references: [id])
  doctor   User    @relation("DoctorWaitingQueue", fields: [doctorId], references: [id])

  @@index([status])
  @@index([doctorId, status])
  @@index([departmentName, status])
  @@index([checkedInAt])
  @@map("waiting_queue")
}
```

---

## 5. API 설계

### 5-1. 진료표 관리
```
GET    /api/v1/clinic-schedule                // 전체 진료표 조회
GET    /api/v1/clinic-schedule/today          // 오늘 진료 가능 의사 (진료과별)
GET    /api/v1/clinic-schedule/week           // 주간 진료표
POST   /api/v1/clinic-schedule               // 진료표 등록 (관리자)
PUT    /api/v1/clinic-schedule/:id            // 진료표 수정
DELETE /api/v1/clinic-schedule/:id            // 진료표 삭제
```

### 5-2. 휴진 관리
```
GET    /api/v1/clinic-closure                 // 휴진 목록
POST   /api/v1/clinic-closure                 // 휴진 등록 (+ 대체 의사)
DELETE /api/v1/clinic-closure/:id             // 휴진 취소
GET    /api/v1/clinic-closure/affected/:date  // 특정일 휴진 영향 환자
```

### 5-3. 접수/대기열
```
POST   /api/v1/queue/check-in                 // 접수 (예약 or walk-in)
  body: { patientId, doctorId?, departmentName, visitType, reason?, appointmentId? }
  - doctorId 없으면 자동 배정
  - appointmentId 있으면 예약 접수

GET    /api/v1/queue                          // 대기열 조회
  query: department, doctorId, status, date

GET    /api/v1/queue/my                       // 내 대기열 (의사용)
PATCH  /api/v1/queue/:id/call                 // 환자 호출 (WAITING → CALLED)
PATCH  /api/v1/queue/:id/start                // 진료 시작 (CALLED → IN_CONSULTATION) + Encounter 자동 생성
PATCH  /api/v1/queue/:id/complete             // 진료 완료 (→ COMPLETED)
PATCH  /api/v1/queue/:id/cancel               // 접수 취소
PATCH  /api/v1/queue/:id/no-show              // 미방문
GET    /api/v1/queue/stats                    // 대기 통계
```

---

## 6. UI 설계

### 6-1. 접수 데스크 페이지 (`/reception`)

**3개 탭**: 예약 접수 | 당일 접수 | 대기 현황

#### 당일 접수 탭
- 환자 검색
- 진료과 선택 (드롭다운)
- **의사 선택 카드**: 오늘 진료 가능 의사 목록
  - 의사명, 전문의, 진료 시간(오전/오후), 진료실
  - **현재 대기 수** 실시간 표시
  - **휴진 표시** (대체 의사 안내)
  - 선택 or "자동 배정" 옵션
- 초진/재진, 접수 사유
- [접수 완료] 버튼

#### 대기 현황 탭
- 진료과별 필터
- 테이블: 순번, 환자, 진료과, 의사, 접수시간, 대기시간, 상태
- 호출/취소 액션 버튼

### 6-2. 진료표 관리 (`/admin/clinic-schedule`)

- 주간 캘린더 그리드 (요일 × 의사)
- 오전/오후 토글로 진료일 설정
- 진료실 배정
- 최대 접수 수 설정
- 휴진 등록 (날짜, 사유, 대체 의사)

### 6-3. 의사 대시보드 위젯

```
┌──────────────────────────────┐
│  내 대기 환자 (3명)            │
│  진료실: 내과 1진료실 (201호)    │
│  ─────────────────────────── │
│  #12 김영수 (재진) 대기 15분    │  [호출]
│  #13 이민정 (초진) 대기 8분     │
│  #14 박지훈 (재진) 대기 2분     │
│  ─────────────────────────── │
│  오늘: 진료 18명 / 대기 3명     │
│  [다음 환자 호출]              │
└──────────────────────────────┘
```

---

## 7. 진료과 마스터

| 코드 | 진료과 | 의사 | 진료실 | 비고 |
|------|--------|------|--------|------|
| IM | 내과 | 김내과, 박내과 | 201호, 202호 | 2명 교대 |
| GS | 외과 | 이외과, 최외과 | 203호, 204호 | 2명 교대 |
| PD | 소아청소년과 | 정소아 | 205호 | 1명 |
| OG | 산부인과 | 한산부 | 206호 | 1명 |
| OS | 정형외과 | 오정형 | 207호 | 1명 |
| EM | 응급의학과 | 강응급 | 응급실 | 24시간 |

---

## 8. 샘플 진료표

### 김내과 (내과)
| 요일 | 오전 (09:00~12:30) | 오후 (14:00~17:30) |
|------|:--:|:--:|
| 월 | ● 진료 | ● 진료 |
| 화 | ● 진료 | - (수술 참관) |
| 수 | ● 진료 | ● 진료 |
| 목 | ● 진료 | - (연구일) |
| 금 | ● 진료 | ● 진료 |
| 토 | ● 진료 | - |

### 박내과 (내과)
| 요일 | 오전 | 오후 |
|------|:--:|:--:|
| 월 | ● 진료 | - |
| 화 | ● 진료 | ● 진료 |
| 수 | - (학회) | ● 진료 |
| 목 | ● 진료 | ● 진료 |
| 금 | ● 진료 | - |
| 토 | - | - |

**포인트**: 내과는 김내과/박내과가 오전·오후를 서로 보완하여 항상 1명 이상 진료

---

## 9. 구현 순서

### Phase 1: 진료표 + DB (1시간)
1. ClinicSchedule, ClinicClosure 모델 → Prisma 스키마
2. WaitingQueue 모델 → Prisma 스키마
3. DB push + 시드 (6개과 진료표 데이터)

### Phase 2: 백엔드 API (1시간)
4. ClinicScheduleModule (CRUD + 오늘 진료 조회)
5. ClinicClosureModule (휴진 등록/삭제)
6. WaitingQueueModule (접수, 대기열, 호출, 자동 배정)

### Phase 3: 프론트엔드 (2시간)
7. 진료표 관리 페이지 (`/admin/clinic-schedule`)
8. 접수 데스크 페이지 (`/reception`)
9. 의사 대시보드 대기열 위젯

### Phase 4: 연동 (30분)
10. 예약 → 접수 연결
11. 호출 → Encounter 자동 생성
12. 휴진 시 기존 예약 이관

---

## 10. 기대 효과

| 항목 | 현재 | 개선 후 |
|------|------|---------|
| 당일 방문 접수 | 불가 | 진료과/의사 선택 후 즉시 접수 |
| 의사 선택 | 불가 | 환자가 원하는 의사 직접 선택 |
| 진료표 | 없음 | 주간 진료표 (요일/오전·오후) |
| 휴진 관리 | 없음 | 휴진 등록 + 대체 의사 자동 배정 |
| 대기열 | 없음 | 실시간 순번 + 대기 시간 |
| 접수 제한 | 없음 | 오전/오후 최대 접수 수 |
| 의사 부하 분산 | 없음 | 대기 수 기반 자동 배정 |
