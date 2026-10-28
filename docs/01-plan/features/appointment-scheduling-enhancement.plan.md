# 외래 예약관리(Appointment Scheduling) 전면 보완 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/src/modules/schedule/schedule.controller.ts:67 · apps/api/src/modules/schedule/schedule.service.ts:101 · 잔여: 없음

- **문서 버전**: v1.1 (2026-07-08 — §13 결정 반영: 부하분산 자동배정·CONFIRMED 2단계·시뮬레이션 알림·시간표 별도)
- **작성**: HIS 개발
- **상태**: 기획(Plan) 확정 — 구현 착수 대기
- **대상 화면**: `/schedule`, `/schedule/new`, `/ai-booking`, 포털 예약, 홈페이지 `care/schedule`
- **관련 모듈**: `schedule`, `clinic-schedule`, `duty-schedule`, `waiting-queue`, `portal`, `concierge`, `notification`, `crm`

---

## 1. 목적 · 배경

현행 예약관리는 **CRUD + 6단계 상태머신 + 의사 시간겹침 중복방지** 중심의 MVP다. 대학병원 외래예약의 필수 요소(진료시간표·휴진·정원 연계, 가용 슬롯 제시, 노쇼 운영, 대기자·반복예약, 환자 셀프예약)가 없거나 미연계이며, AI 예약(`/ai-booking`)은 **존재하지 않는 엔드포인트를 호출해 실제로 동작하지 않는다**.

본 기획은 이 갭을 단계적으로 메워 **실사용 가능한 대학병원급 외래 예약관리**로 완성하는 것을 목표로 한다. 기존 진료·접수·포털 흐름과 config 게이트 기반 **무중단 도입**을 원칙으로 한다.

## 2. 현황 진단 (As-Is)

### 2.1 구현됨
| 영역 | 근거 |
|---|---|
| 예약 CRUD | `schedule.service.ts` create(29)/findAll(54)/findById(79)/update(122) · controller 6라우트 |
| 상태머신 6단계 + 전이검증 | `VALID_TRANSITIONS`(service:14) · changeStatus(158) |
| 의사 시간겹침 중복방지(5분 버퍼) | `validateNoConflict`(service:184) |
| 필터·페이지네이션·주간 캘린더 | buildWhere(214)·getCalendar(91) · `schedule/page.tsx`(week 하드코딩) |
| 취소 감사필드 | Appointment.cancelledAt/By/Reason |
| D-1 리마인더(로그성) | `crm-cron.service.ts:16` · notification.listener `appointment.reminder` |
| 포털 조회/변경/취소 | portal.service rescheduleAppointment(565)/cancelAppointment(582) |
| 접수→진료 연결 | WaitingQueue.checkIn(appointmentId 수용) · CHECKED_IN→IN_PROGRESS→encounter |

### 2.2 갭 (To-Be 필요)
| # | 갭 | 심각도 | 현상 |
|---|---|---|---|
| G1 | **진료시간표·휴진·정원 미연계** | 높음 | `ClinicSchedule`(maxPatients·근무요일/시간)·`ClinicClosure`(휴진)가 있으나 예약 생성 검증(validateNoConflict)에 **미반영** → 휴진일 예약·근무시간 외 예약·정원 초과(오버부킹) 가능 |
| G2 | **가용 슬롯 API·의사/과 선택 부재** | 높음 | 빈 슬롯 조회 엔드포인트 없음. `schedule/new`는 **의사 UUID 수기 입력**(FE 미완성). 예약자가 언제 가능한지 알 수 없음 |
| G3 | **AI 예약 broken** | 버그 | `ai-booking/page.tsx:97` `POST /api/v1/schedules`(미존재) + `{department, scheduledDate}`(doctorId 없음·스키마 불일치) → 확정 불가 |
| G4 | **노쇼 운영 부재** | 중 | NO_SHOW enum·전이만 존재. 처리 UI·자동 노쇼 전환·집계 없음 |
| G5 | **환자 셀프 신규예약 불가** | 중 | 포털은 변경/취소만(신규 POST 없음). 홈페이지 예약은 CMS 안내문뿐 |
| G6 | **대기자명단·반복예약 전무** | 중 | 예약용 waitlist/recurring 모델·로직 없음(waitlist는 장기이식 전용) |
| G7 | **FE 월간/목록/검색/필터·상세 미노출** | 낮음 | BE 일부 지원분(month 범위 등) UI 미연결. 노쇼/리스케줄 UI 없음 |
| G8 | **알림이 실발송 아닌 로그성** | 중 | 리마인더가 PatientCommunicationLog 기록 수준. 실 SMS/카카오/푸시 발송 연동 미흡 |

## 3. 목표 (To-Be)

1. **예약 가능성 검증 일원화**: 시간겹침 + 근무시간(ClinicSchedule) + 휴진(ClinicClosure) + 정원(maxPatients)을 하나의 `validateBookable`로 통합.
2. **가용 슬롯 제시**: 의사·과·날짜 기준 예약 가능 슬롯을 계산·반환하는 API + 슬롯 선택 UI.
3. **AI 예약 정상화**: concierge 추천 → 실제 `/appointments` 확정 경로 복구(과→의사→슬롯).
4. **노쇼·대기자·반복** 운영 기능 추가.
5. **환자 셀프 신규예약**(포털) + 확정/변경/취소 알림 실발송.
6. **FE 완성**: 월/주/목록 뷰·검색·필터·상세·노쇼/리스케줄 액션.

전 기능 **config 게이트(기본 보수적)** + 기존 흐름 회귀 방지.

## 4. 데이터 모델 변경 (Prisma)

> DDL은 `apps/api/prisma/manual/appointment-enhance-*.sql`로 멱등 작성. 신규 모델은 배포 시 `prisma db push`(무손실).

### 4.1 Appointment 필드 추가
```prisma
model Appointment {
  // ... 기존 ...
  departmentName String?  @map("department_name") @db.VarChar(100)  // 예약 시점 과(의사 통해 파생 아닌 명시)
  roomName       String?  @map("room_name") @db.VarChar(100)
  slotPeriod     String?  @map("slot_period") @db.VarChar(10)       // ClinicSchedule.period 연동(오전/오후)
  noShowAt       DateTime? @map("no_show_at") @db.Timestamptz()
  priority       Int?     @default(0)                                // URGENT 우선
  rescheduledFromId String? @map("rescheduled_from_id") @db.Uuid    // 리스케줄 원본 추적
  recurringGroupId  String? @map("recurring_group_id") @db.Uuid     // 반복예약 묶음
  reminderSentAt DateTime? @map("reminder_sent_at") @db.Timestamptz() // 실발송 멱등
  bookedVia      String?  @map("booked_via") @db.VarChar(20)        // STAFF/PORTAL/AI
  confirmedAt    DateTime? @map("confirmed_at") @db.Timestamptz()   // 확정 2단계
  confirmedBy    String?  @map("confirmed_by") @db.Uuid
  @@index([recurringGroupId])
}
```
**`AppointmentStatus`에 `CONFIRMED` 추가(확정)** — 상태 흐름:
```
SCHEDULED(신청) → CONFIRMED(확정) → CHECKED_IN → IN_PROGRESS → COMPLETED
       ↘ CANCELLED / NO_SHOW          ↘ CANCELLED / NO_SHOW
```
- **포털/AI 신청** = `SCHEDULED`(병원 확정 대기). **병원 확정**(§5.8) = `CONFIRMED`.
- **스태프 직접 생성**은 `appointment.staffAutoConfirm`(기본 ON) 시 생성 즉시 `CONFIRMED`.
- `VALID_TRANSITIONS`(service:14) 갱신: SCHEDULED→{CONFIRMED,CANCELLED,NO_SHOW}, CONFIRMED→{CHECKED_IN,CANCELLED,NO_SHOW}. 리마인더·노쇼·접수는 CONFIRMED 기준.

### 4.2 신규 모델 — 예약 대기자
```prisma
model AppointmentWaitlist {
  id            String   @id @default(uuid()) @db.Uuid
  patientId     String   @map("patient_id") @db.Uuid
  doctorId      String?  @map("doctor_id") @db.Uuid
  departmentName String  @map("department_name") @db.VarChar(100)
  preferredFrom DateTime? @map("preferred_from") @db.Timestamptz()
  preferredTo   DateTime? @map("preferred_to") @db.Timestamptz()
  status        String   @default("WAITING") @db.VarChar(20) // WAITING/OFFERED/BOOKED/EXPIRED/CANCELLED
  notifiedAt    DateTime? @map("notified_at") @db.Timestamptz()
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz()
  @@index([doctorId, status])
  @@index([departmentName, status])
  @@map("appointment_waitlists")
}
```
반복예약은 **별도 모델 없이 `recurringGroupId`로 묶고** 생성 시 N건을 일괄 create(규칙은 생성 파라미터로만·저장 안 함) — 스코프 최소화.

## 5. 백엔드 설계

### 5.1 예약 가능성 검증 통합 — `validateBookable`
`validateNoConflict`를 확장(또는 래핑)해 아래를 순차 검증. 각 규칙은 **config 게이트**로 OFF/WARN/BLOCK.

| 규칙 | 소스 | config |
|---|---|---|
| 시간겹침(기존) | 같은 의사 Appointment ±버퍼 | 항상 BLOCK |
| 근무시간 | ClinicSchedule(dayOfWeek·start/endTime·isActive) | `appointment.enforce.workingHours` (기본 WARN) |
| 휴진 | ClinicClosure(date·period·substituteId) | `appointment.enforce.closure` (기본 BLOCK) |
| 정원 | 해당 의사·기간 예약수 ≥ maxPatients | `appointment.enforce.capacity` (기본 WARN) |

- 반환: `{ ok, blocks: Rule[], warnings: Rule[] }`. BLOCK이면 400(코드 `APPOINTMENT_NOT_BOOKABLE`), WARN은 생성하되 응답에 `warnings` 동봉(§포뮬러리 게이트 패턴 재사용).
- 대체의(substituteId) 있으면 휴진이라도 대체의로 예약 안내.

### 5.2 가용 슬롯 API (신규)
```
GET /api/v1/appointments/availability?doctorId=&departmentName=&date=YYYY-MM-DD[&days=N]
→ { data: { date, slots: [{ start, end, period, roomName, remaining, available: bool }] } }
```
- 계산: ClinicSchedule(해당 요일 근무 period·start/end) → duration 단위 슬롯 분할 → 기존 Appointment(취소·노쇼 제외) 차감 → ClinicClosure 제외 → maxPatients로 remaining 산출.
- 과(departmentName)만 주면 해당 과 근무 의사 전원 슬롯 집계.

### 5.3 신규/변경 엔드포인트
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/appointments/availability` | 가용 슬롯(§5.2) |
| POST | `/appointments/:id/confirm` | 예약 확정 SCHEDULED→CONFIRMED(§5.8) |
| POST | `/appointments/:id/no-show` | 노쇼 처리(noShowAt·상태전이) |
| POST | `/appointments/:id/reschedule` | 리스케줄(원본 CANCELLED+신규 생성·rescheduledFromId 링크·재검증) |
| GET | `/appointments/stats` | 노쇼율·과별·기간 집계(대시보드용) |
| POST | `/appointments/waitlist` · GET · DELETE | 대기자 등록/조회/취소 |
| POST(portal) | `/portal/appointments` | 환자 셀프 신규예약(가용 슬롯 내에서만·PortalOrPatientGuard) |

### 5.4 자동 노쇼 크론
- `appointment.autoNoShow.enabled`(기본 OFF) — scheduledAt + grace(기본 30분) 경과·CHECKED_IN 아님·SCHEDULED → NO_SHOW 자동전환. crm/notification 크론에 합류(단일 fork 리더).

### 5.5 접수 연계
- 예약 `CHECKED_IN` 전환 시 **WaitingQueue 엔트리 자동 생성**(appointmentId 연결) — 현재 상태 patch만 하는 흐름 보완. config `appointment.checkinCreatesQueue`(기본 ON, 회귀 시 OFF).

### 5.6 AI 예약 정상화 (G3)
- `ai-booking/page.tsx` `confirmBooking`: `POST /api/v1/schedules` → **`POST /api/v1/appointments`**로 교정.
- payload: concierge 추천 과 → §5.2 availability로 슬롯 해석 + §5.7 부하분산으로 의사 결정 → `{ patientId, doctorId, scheduledAt, type, reason, bookedVia:'AI' }`. status=SCHEDULED(신청·확정 대기).
- 사용자가 특정 의사·슬롯을 고르면 override.

### 5.7 부하분산 자동배정 (`resolveDoctorByLoad`)
- 입력: departmentName + 희망 일시(또는 슬롯). 출력: 배정 의사.
- 로직: 해당 과 `ClinicSchedule.isActive` 근무의 중, 희망 시간대 **가용(휴진·정원 통과)** 의사만 후보 → **잔여 슬롯비율 최대**(= 부하 최소) 의사 선택. 동률이면 예약수 최소 → 랜덤(index 기반).
- config `appointment.autoAssign`(기본 ON). OFF면 의사 필수 지정.
- AI·포털 셀프예약의 "과만 선택" 경로에서 사용. 스태프 폼은 의사 직접선택 우선(자동배정 버튼 제공).

### 5.8 예약 확정 (2단계)
```
POST /api/v1/appointments/:id/confirm   (ADMIN/DOCTOR/NURSE)
→ SCHEDULED → CONFIRMED (confirmedAt/By 기록) + 확정 알림(§8)
```
- 포털/AI 신청(SCHEDULED)을 병원이 검토·확정. 확정 시 §5.1 재검증(그 사이 슬롯 변동 방지).
- 스태프 직접생성은 `appointment.staffAutoConfirm`(ON) 시 생성 트랜잭션에서 즉시 CONFIRMED.
- 미확정(SCHEDULED) 목록을 §6.1 "확정 대기" 탭으로 노출.

## 6. 프론트엔드 설계

### 6.1 `/schedule` (스태프)
- **뷰 토글**: 월/주/목록(day agenda). 월간은 BE month 범위(getCalendar) 활용.
- **필터 바**: 진료과·의사·상태·유형·검색(환자명/MRN).
- **예약 카드 액션**: 접수/취소/진료시작/완료(기존) + **노쇼**·**리스케줄**(드래그 또는 모달) + 상세 모달.
- **정원/근무 표시**: 슬롯에 remaining·휴진 배지.

### 6.2 `/schedule/new` 개편
- 진료과 드롭다운 → 의사 드롭다운(과별 필터·`/public/departments`·의사 목록) → **가용 슬롯 그리드**(§5.2) 선택. UUID 수기 입력 제거.
- 유형·사유·반복(선택: 주1회 N회) 옵션.
- 제출 전 실시간 가용성 표시, WARN 사유 확인 후 진행.

### 6.3 노쇼/대기자
- 노쇼: 카드 액션 + 과거 예약 목록에서 일괄. 노쇼율 뱃지.
- 대기자: 슬롯 만석 시 "대기 등록" → 취소 발생 시 알림(§5.4 연계).

## 7. 환자 포털 셀프 예약 (G5)
- 포털 `POST /portal/appointments`: 본인 patientId 고정, §5.2 가용 슬롯 내에서만 생성(서버 재검증), bookedVia='PORTAL'.
- 포털 화면: 과 선택 → 슬롯 → 확정. 기존 조회/변경/취소와 통합.
- 홈페이지 `care/schedule`: 안내문 + 로그인 유도(비대면/예약 진입점).
- 가드: **PortalOrPatientGuard**(staff JwtAuthGuard 아님 — 포털 규약 준수), 중복 라우트 금지.

## 8. 알림·리마인더 실발송 (G8)
- 확정/변경/취소/노쇼임박 이벤트 → notification.listener → **실 채널(SMS/카카오/푸시) 발송 어댑터**(dev-simulation-registry 토글로 시뮬↔실연동).
- `reminderSentAt` 멱등. D-1 리마인더 크론을 로그성 → 실발송으로 승격(게이트 `appointment.reminder.send`).

## 9. 구현 단계 · config 게이트

| Phase | 범위 | 게이트(기본) |
|---|---|---|
| **P0** | 스키마(4.1·4.2 필드+CONFIRMED) + §5.2 availability + §5.7 부하분산 + §5.8 confirm + G3 AI 예약 수정 + §6.2 과/의사/슬롯 폼 | `appointment.autoAssign`(ON)·`staffAutoConfirm`(ON)·availability 상시 |
| **P1** | G1 validateBookable(근무/휴진/정원) + WARN/BLOCK 게이트 + §6.1 월/목록/필터/상세/확정대기 탭 | `appointment.enforce.*`(closure=BLOCK·나머지 WARN) |
| **P2** | G4 노쇼(수동+자동크론) + §5.5 접수 자동 큐 + 통계 | `appointment.autoNoShow`(OFF)·`checkinCreatesQueue`(ON) |
| **P3a** ✅ | G5 포털 셀프예약 + G6 반복예약(주간 N회) | `portal.selfBooking`(OFF)·`autoAssign` 재사용 |
| **P3b** ✅ | G6 대기자명단(AppointmentWaitlist·CRUD·취소시 자동안내) + G8 알림 이벤트/어댑터(시뮬레이션·@OnEvent) | `appointment.reminder.send`(OFF) |

각 Phase는 독립 PR·배포·회귀검증. FE는 무해한 순증(기존 액션 보존).

## 10. 비범위 (Out of Scope)
- 병상/수술실/장비 리소스 예약(별도 도메인).
- 다기관·의뢰(전원) 예약 연계(전원 모듈 소관).
- 결제 선수납 연동(수납 모듈).
- 복잡한 반복 규칙(RRULE 전체) — 단순 주간 N회만.

## 11. 리스크 · 함정
- **timestamptz/KST 경계**: getDateRange·availability 슬롯 계산은 KST 기준(기존 buildWhere 패턴 준수). integration_outbox류 timestamp-without-tz 혼선 주의.
- **ClinicSchedule.period 문자열**(오전/오후 등) ↔ 슬롯 시간 매핑 규칙 명확화 필요(start/endTime은 "HH:MM" 문자열).
- **정원 카운트 경합**: 동시 예약 시 maxPatients 초과 가능 → 생성 트랜잭션 내 재확인(또는 부분유니크). P1에서 정의.
- **포털 가드**: PortalOrPatientGuard 필수(§포털 규약), staff EP 재사용 금지.
- **AI 예약 자동 의사배정**은 오배정 위험 → P0는 슬롯 수동선택, 자동배정은 후속.
- 기존 예약 데이터에 신규 필드 null 허용(백필 불요).

## 12. 수용 기준 (Acceptance)
1. 휴진일/근무시간 외/정원 초과 예약이 게이트대로 차단(BLOCK)되거나 경고(WARN) 동봉된다.
2. `/schedule/new`에서 UUID 입력 없이 과→의사→가용 슬롯으로 예약 완료된다.
3. `/ai-booking` 확정이 실제 `/appointments`에 예약을 생성한다.
4. 노쇼 수동 처리 + 자동 크론(게이트 ON 시) 동작, 노쇼율 통계 노출.
5. 환자 포털에서 가용 슬롯 내 신규 예약이 생성되고, 확정/변경/취소 알림이 실발송(게이트 ON)된다.
6. 전 기능 config OFF 시 기존 흐름 무변경(회귀 없음).

## 13. 결정 사항 (2026-07-08 확정)
| 질문 | 결정 | 설계 반영 |
|---|---|---|
| 실발송 채널 | **어댑터 + 시뮬레이션**(계약 후 활성) | §8 — 발송 어댑터 구현, 실 SMS/카카오는 dev-simulation-registry 토글·게이트 OFF. 발신번호·계약은 법무 선결 |
| 자동 의사배정 | **부하분산 자동배정** | §5.6·§5.7 — 과 지정 시 해당 과 근무의 중 **예약 최소 부하 의사 자동배정**(가용 슬롯 기준). 사용자 override 허용 |
| 예약 확정 2단계 | **도입(CONFIRMED)** | §4.1·§5.8 — `SCHEDULED(신청)→CONFIRMED(확정)` 2단계. 포털/AI 신청=SCHEDULED, 병원 확정=CONFIRMED. 스태프 직접생성은 자동확정 옵션 |
| 시간표 통합 | **별도 유지(현행)** | duty-schedule는 분리·예약은 clinic-schedule만 참조 |

### 열린 질문(후속·구현 중 확정)
- 부하분산 지표: 당일 예약수 vs 주간 예약수 vs 잔여 슬롯비율(§5.7에서 잔여 슬롯비율 기본).
- 스태프 직접생성 시 자동 CONFIRMED 여부(config `appointment.staffAutoConfirm` 기본 ON).
- 실발송 사업자·발신번호(법무·계약).
