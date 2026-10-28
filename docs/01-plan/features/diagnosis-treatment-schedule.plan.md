# 진단 기반 치료일정·전체 스케줄 관리 기획 (Diagnosis-Driven Treatment Schedule)

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/prisma/schema.prisma:7787 · apps/web/src/app/portal/_care/TreatmentScheduleSegment.tsx · 잔여: 없음

> 작성: 2026-07-14 / 상태: Plan v1.0 (승인 대기 — 구현 착수 전 검토 필요)
> 관련: [diagnosis-order-set-management](diagnosis-order-set-management.plan.md) · [pre-prescription-enhancement](pre-prescription-enhancement.plan.md) · schedule-timegrid-and-scale.plan.md
> 한 줄: 주상병·부상병 확정 시 **치료일정 템플릿**이 환자별 스케줄로 전개되고, 예약·검사·수술·투약·경로 마일스톤을 **환자 단위 통합 캘린더** 하나로 조회·관리한다.

---

## 1. 배경·현황 (2026-07-14 실사)

### 이미 있는 것 (분산 자산)
| 자산 | 위치 | 비고 |
|------|------|------|
| 외래 예약 `Appointment` | schema:705, schedule.service.ts | 반복(recurringGroupId, 주단위 1~12주)·가용슬롯·타임그리드·대기자명단 |
| 임상경로 `ClinicalPathway` | schema:10237 | Pathway→Milestone(day별)→Assignment(환자 배정, startDate)→MilestoneOutcome(variance). **진단 연결 없음** |
| MAR 스케줄 | nursing.service.ts:889 generateSchedule | frequency 파싱("1일 3회"→시각) × duration일 자동생성. **항상 오늘 시작**(미래 시작일 미지원) |
| 수술일정 `OrSchedule` | schema:2512 | 방·일자·시각 |
| 환자여정 `PatientJourneyEvent` | schema:7777, journey.service | 과거 이벤트 로그(타임라인) — **미래 일정 아님** |
| record-timeline | record-timeline.service | 진료+간호 병합 시계열 (2소스만) |
| 재평가 주기 `RiskReassessmentSchedule` | schema:9296 | intervalHours+nextDueAt 패턴 (참고 모델) |
| 사전 오더 `PreOrder.scheduledDate` | schema:7481 | 미래 예정 처방 (→ 사전처방 기획) |

### 갭
| # | 갭 |
|---|----|
| G1 | **환자 단위 통합 일정 뷰 부재** — 예약·검사·수술·투약·경로가 각 도메인에 분산, 한 화면/한 API로 못 봄 (record-timeline은 과거 기록 2소스, journey는 과거 이벤트) |
| G2 | **진단→일정 연결 부재** — ClinicalPathway가 유일한 "계획" 모델이나 diagnosisCode 매핑이 없어 수동 배정만 가능 |
| G3 | **미래 일정 전개 엔진 부재** — "진단 확정 → D+7 재진, D+14 채혈, 주1회 처치 4주" 같은 시간축 전개가 없음. 항암 레지멘도 텍스트+cycle 카운트뿐 |
| G4 | **일정 변경 관리 부재** — 지연/취소 시 후속 일정 전파(shift)·사유 기록 없음 (PathwayMilestone deviation은 있으나 개별 도메인 미연동) |

## 2. 목표·비목표

**목표**
1. **치료일정 템플릿**: 진단코드(주/부상병)에 매핑된 일정 템플릿(D-day 오프셋 기반 이벤트 목록) 정의·관리.
2. **환자별 전개**: 진단 확정 시 추천 → 의사 확정 → 환자 스케줄 인스턴스 생성(기존 도메인 객체와 연결: Appointment/PreOrder/OrSchedule 초안).
3. **통합 캘린더**: 환자 단위 미래+과거 일정을 병합 조회하는 단일 API + 차트 내 캘린더/타임라인 화면.
4. **변경 관리**: 항목 지연·취소·완료 처리, 후속 일정 일괄 shift, deviation 사유 기록, 알림.

**비목표**
- 항암 레지멘 주기 엔진(regimen-cpoe-bridge 후속에서 본 기획의 전개 엔진을 재사용하는 방향 — 이번 범위 아님).
- 자원(방·장비·인력) 예약 최적화 — 기존 schedule 가용슬롯 로직 재사용만.
- 자동 확정(모든 전개는 의사/코디네이터 확정 후 생성).

## 3. 핵심 설계

### 3.1 데이터 모델

**(a) `TreatmentScheduleTemplate` — 진단 매핑 일정 템플릿**
```prisma
model TreatmentScheduleTemplate {
  id            String @id @default(uuid())
  name          String                    // "제2형 당뇨 초진 관리 12주"
  department    String?
  status        String @default("DRAFT")  // OrderSet과 동일 승인 상태머신
  version       Int    @default(1)
  parentId      String?
  totalDays     Int                       // 전체 기간
  diagnoses     TreatmentTemplateDiagnosis[]  // 진단 매핑 (OrderSetDiagnosis와 동형)
  items         TreatmentTemplateItem[]
}
model TreatmentTemplateItem {
  id            String @id @default(uuid())
  templateId    String
  dayOffset     Int                        // D+N (확정일 기준)
  timeOfDay     String?                    // "09:00"
  itemType      String                     // VISIT|LAB|IMAGING|PROCEDURE|MEDICATION_CYCLE|EDUCATION|NURSING|ASSESSMENT
  refCodeId     String?                    // procedureCode/medicationCode 등 (해석 강제 — 유령 방지)
  title         String
  repeatEvery   Int?                       // 반복 간격(일) — 주1회=7
  repeatCount   Int?                       // 반복 횟수
  isDefault     Boolean @default(true)     // 전개 모달 기본 체크
  linkedOrderSetId String?                 // 해당 일자에 적용할 약속처방 (연계)
}
```

**(b) `PatientTreatmentSchedule` — 환자별 인스턴스**
```prisma
model PatientTreatmentSchedule {
  id           String @id @default(uuid())
  patientId    String
  encounterId  String?                      // 확정 시점 진료
  templateId   String?                      // null=수동 생성
  anchorDate   DateTime                     // D0 (진단 확정일 or 지정일)
  status       String @default("ACTIVE")    // ACTIVE|COMPLETED|CANCELLED
  createdBy    String
  items        PatientScheduleItem[]
}
model PatientScheduleItem {
  id           String @id @default(uuid())
  scheduleId   String
  plannedAt    DateTime                     // anchorDate + dayOffset 계산 결과
  itemType     String
  title        String
  status       String @default("PLANNED")   // PLANNED|LINKED|COMPLETED|DELAYED|CANCELLED
  refType      String?                      // 'Appointment'|'PreOrder'|'OrSchedule'|'Order' — 실 도메인 객체 연결
  refId        String?
  deviationReason String?
  @@index([scheduleId, plannedAt])
}
```
- **설계 원칙**: PatientScheduleItem은 "계획 레이어". 실행은 기존 도메인(예약/사전오더/수술)이 담당하고 refType/refId로 연결. 이중 SoT를 만들지 않음 — 상태 동기화는 이벤트 리스너(appointment 완료 → item COMPLETED)로 단방향 반영.

### 3.2 전개 흐름

```
진료화면: 주상병 확정 저장
  → 추천 배너 "이 진단의 치료일정 템플릿 N건" (TreatmentTemplateDiagnosis 매칭 — 약속처방 추천 엔진 §3.2와 동일 로직 공유)
  → [일정 전개] 클릭 → 전개 검토 모달:
     ├ anchorDate 선택 (기본=오늘)
     ├ 항목 목록: plannedAt 미리계산 표시, isDefault 자동체크, 반복 항목은 회차 전개 표시
     ├ 항목별 수정(일자 조정)·제외
     └ 충돌 검사: 기존 예약·수술과 같은 날 겹침 경고
  → [확정] → 트랜잭션:
     ├ PatientTreatmentSchedule + items 생성
     ├ itemType별 실 객체 초안 생성(선택적):
     │   VISIT → Appointment(SCHEDULED, 가용슬롯 확인) / LAB·IMAGING → PreOrder(scheduledDate)
     │   PROCEDURE·EDUCATION·NURSING → PatientScheduleItem만(PLANNED, 해당일 워크리스트 노출)
     └ journey.emit('TREATMENT_SCHEDULE_CREATED')
```

### 3.3 통합 캘린더 API + 화면

**`GET /api/v1/patients/:id/schedule?from=&to=&sources=`** (신규 read-only 집계 — journey-console 패턴)
- 병합 소스: Appointment / PatientScheduleItem / OrSchedule(수술) / MedicationAdministration(투약, 일 단위 집계) / PreOrder(scheduledDate) / PathwayMilestone(배정분).
- 응답: `[{date, source, refType, refId, title, status, navUrl}]` — PatientJourneyEvent와 동형 유지(과거=journey, 미래=schedule로 자연 연결).

**FE**
1. **환자차트 탭 "치료일정"**: 월 캘린더 + 주 리스트 겸용. 과거(여정 이벤트)와 미래(계획)를 한 축에. 항목 클릭 → navUrl 이동.
2. **board(큰 화면)** 패널 추가: 멀티패널에 치료일정 위젯.
3. **환자포털 노출**(P3): 예약·검사 예정만 필터(내부 항목 비노출), 포털 가드(PortalOrPatientGuard) 준수.

### 3.4 변경 관리

- `PATCH schedule-items/:id` — 일자 변경(사유 필수→deviationReason), 취소.
- **일괄 shift**: 항목 지연 시 "이후 종속 항목 N건을 함께 +N일" 옵션(체크 선택식·자동 전파 아님).
- 동기화 리스너: `appointment.completed/cancelled`, `order.completed` → 연결 item 상태 갱신(fire-and-forget, journey.emit 패턴).
- 알림: 예정일 D-1 환자 알림(기존 알림 SLA 인프라 재사용)·미이행(plannedAt 경과+PLANNED) 익일 담당의 워크리스트 배지.

## 4. 단계

| 단계 | 내용 | 산출 |
|------|------|------|
| P0 | 통합 캘린더 API + 환자차트 치료일정 탭 (기존 소스 병합 read-only — 신규 모델 없이 즉시 가치) | 환자 전체 일정 한눈에 |
| P1 | 템플릿 모델 + admin 관리 화면 + 진단 매핑 (승인 상태머신은 OrderSet 패턴 이식) | 템플릿 정의 |
| P2 | 전개 모달 + PatientTreatmentSchedule 인스턴스 + 실 객체 초안 생성(Appointment/PreOrder) + 동기화 리스너 | 진단→일정 전개 |
| P3 | 변경 관리(일괄 shift·deviation) + 알림 + 포털 노출 + board 위젯 | 운영 완성 |

## 5. 리스크·가드

- **이중 SoT 금지**: 계획(PatientScheduleItem)과 실행(도메인 객체)을 분리하고 ref 연결만. 실행 객체 없는 계획 항목은 워크리스트 참고용.
- **자동 생성 남발 방지**: 실 예약 자동 생성은 가용슬롯 검증 통과 시에만, 실패 시 PLANNED로 남기고 수동 예약 유도.
- **journey.emit fire-and-forget** 특성상 전개 직후 조회 시 여정 이벤트 미반영 가능(기존 함정과 동일 — FE는 schedule API 기준).
- **MAR 미래 시작일 미지원**(nursing.service.ts:902)은 사전처방 기획의 활성화 시점 문제와 함께 해결(→ pre-prescription P2).
