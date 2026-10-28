# 환자 여정 모델 — 문헌·표준 대조로 논리 구조 다지기

- 작성: 2026-10-01
- 상태: **P0 구현·배포(2026-10-01)** · P1~P3 미착수. P0 결과는 §6 "P0 구현 결과"
- 보완(2026-10-01 검토 라운드): §2.9 실측 보강(운영 시드 읽기 전용 집계·초안 표 정정) · §4.11~4.16 추가 결함 · §5.8 트랙별 상태기계 · §5.9 사건 카탈로그 전수 · §5.10 지표 정의서 · §5.11 검증 시나리오 · §5.12 감시자 SQL 초안 · §5.13 데이터 품질 점검표 · §6 수용 기준·이중 읽기·되돌리기 · §7 D9~D12
- 관련 정본: 어휘 `packages/shared/src/journey-event-types.ts` · 발행 `apps/api/src/modules/journey/journey.service.ts` · 관제 정본 `apps/api/src/modules/journey-console/flow-canon.ts`
- 관련 기획: `patient-journey-tracking.plan.md`(최초 설계) · `journey-integration-guide.plan.md`(발행 규약) · `journey-console-redesign.plan.md`(관제) · `patient-journey-protocol-qr.plan.md`(프로토콜 상태기계) · `metaverse-patient-journey.plan.md`(위치)
- 🔴 운영 DB 는 **가상 병원 시드**다. 초안은 운영 DB 를 조회하지 않았고, 검토 라운드에서 **읽기 전용 집계만** 했다(§2.9). 아래의 "결함"은 코드 구조로 확인한 것이고, 시드 집계는 "구조가 실제로 그렇게 동작한다"는 근거일 뿐 실피해 규모가 아니다.

---

## 1. 요청·배경

요청: "환자 여정과 관련된 논문이나 표기법을 찾아 환자 여정을 더 논리적으로 탄탄하게 구성할 수 있게 기획서 작성."

현행 환자 여정은 `patient_journey_events` 한 테이블에 쌓이는 **타임라인 기록**이다. 처음 설계(2026-05)는
"모듈별로 흩어진 시각을 한 줄로 모아 보여주고, 클릭하면 해당 화면으로 간다"가 목적이었다
(`patient-journey-tracking.plan.md` §1). 이후 여정은 용도가 늘었다.

- 환자 포털 타임라인(환자에게 그대로 노출)
- 기간 보고서의 간격 지표(응급 체류·입원→수술·수술 시간)
- 위치 원장 추정(이벤트 → 구역)
- 관제 SSE 갱신 힌트

**타임라인으로 시작한 기록이 지표와 분석의 원천으로 쓰이기 시작했다.** 타임라인은 "대충 이 순서였다"로 충분하지만,
지표는 "언제 시작해서 언제 끝났는가·어느 방문의 일인가·빠진 것은 없는가"가 정확해야 한다.
이 차이를 문헌·표준이 이미 정리해 두었는지 찾아보고, 현행 모델이 어디서 어긋나는지 판정한 뒤 단계별로 다지는 안을 낸다.

---

## 2. 현행 실측 (코드 근거)

### 2.1 저장 모델

`apps/api/prisma/schema.prisma:9318-9340` `PatientJourneyEvent`

| 필드 | 뜻(현행) | 비고 |
|---|---|---|
| `patientId` | 환자 | **유일한 필수 귀속.** 방문·입원·응급 방문 같은 사례(case) 키가 없다 |
| `eventType` VarChar(50) | 활동 이름 | 어휘는 shared 정본(아래 2.2) |
| `eventAt` timestamptz | "이벤트 시각" | 🔴 `emit()` 이 **항상 `new Date()`** 로 채운다(2.4) — 기록 시각이다 |
| `title`·`description` | 표시 문장 | 환자 포털 노출 시 설명은 안전 유형만 통과 |
| `department`·`doctorId`·`doctorName` | 자원 | 선택 |
| `refType`·`refId`(uuid) | 원 기록 포인터 | 선택. **어휘 정본 없음**(2.5) |
| `navUrl`·`severity`·`metadata` | 화면 이동·심각도·기타 | `severity` 대소문자 혼재(`'warning'`·`'WARNING'`) |
| `createdAt` | 행 생성 시각 | `eventAt` 과 사실상 같은 값 |

인덱스: `(patientId, eventAt)`·`(eventType)`·`(refType, refId)`. **유니크 제약·멱등 키 없음.** 수정·삭제 이력 없음.

### 2.2 어휘

`packages/shared/src/journey-event-types.ts`

- `JOURNEY_EVENT_TYPES`(14-38) — 외래·오더/결과/조제·수납/청구·응급·입원/수술·동의서·검진/만성·VOC·메시지·진단검사 상태 전이. **활동 이름에 생명주기 단계가 섞여 있다**(`SURGERY_START`/`SURGERY_COMPLETE`, `PACU_ADMISSION`/`PACU_DISCHARGE`, `DIAGNOSTIC_ON_HOLD`/`DIAGNOSTIC_RESUMED`). 시작만 있고 끝이 없는 활동(`ENCOUNTER_START` ↔ 끝은 `ENCOUNTER_SIGNED` — 서명은 "진료 끝"과 다른 사실)이 있다.
- `JOURNEY_EVENT_NOT_EMITTED`(46-57) — 이름은 있으나 발행하지 않는 것과 사유. 간호 평가·낙상 위험·안전사건·감염은 **환자 포털 노출 범위 결정 전이라 발행 안 함**.
- `JOURNEY_EVENT_PATIENT_HIDDEN`(75-94)·`JOURNEY_PATIENT_DESCRIPTION_SAFE`(112-121) — 환자 노출은 fail-closed.
- 가드 `apps/api/test/architecture/journey-event-vocabulary.spec.ts` — 발행 리터럴 ⊂ 어휘, 어휘 중 발행 0 이면 실패.

🔴 어휘 하나가 **세 역할**을 겸한다: (a) 분석용 활동 이름 (b) 환자에게 보이는 문장의 분류 (c) 위치 추정 키. 노출 결정이 안 된 사실(간호 평가 등)은 (a) 분석에서도 빠진다 — "환자에게 보여도 되는가"가 "기록할 것인가"를 결정하고 있다.

### 2.3 발행 경로

- 정본 발행기 `JourneyService.emit()` `journey.service.ts:43-54` — fire-and-forget. 저장 실패는 `logger.warn` 한 줄(53). 저장 후 SSE 힌트(47)·위치 추정(50).
- 구독 브리지 `journey.listener.ts` — `order.created`(33-55)·`dispensing.completed`(58-69)·`order.completed`(77-109, 치료만)·`billing.patient_pending`(117-128)·`consent.revoked`(131-142).
- 직접 서비스 호출 `this.journey?.emit(...)` — `grep` 기준 23개 파일.
- 🔴 **정본 발행기를 거치지 않는 직접 쓰기** `prisma.patientJourneyEvent.create` — 9개 파일:
  `portal/portal.service.ts:964`(CONSENT_SIGNED, refId 없음, `.catch(() => {})`) ·
  `notification/notification.listener.ts:710,750,768`(동의서 3종) ·
  `pathology/pathology.service.ts:217` · `mdt/mdt.service.ts:271` ·
  `billing/billing.service.ts:1771`(BILLING_PAID, **refType·refId 없음**) · `billing/billing.listener.ts:49,73` ·
  `claim/claim.service.ts:316` · `patient-auth/patient-auth.service.ts:333,587`(데모 시나리오).
  이 경로들은 SSE 힌트·위치 추정·향후 넣을 공통 검증을 **모두 우회**한다.
- 🔴 **삭제 경로**: `patient-auth/patient-auth.service.ts:501` `patientJourneyEvent.deleteMany({ patientId, eventAt >= 오늘 })` — 데모 재실행용이나 원장이 append-only 가 아님을 보여준다.
- 시뮬레이터는 2026-09-28 이후 실원장에 쓰지 않는다(`simulator/simulator.service.ts:5-14` 주석).
- 시드: `prisma/seed.ts:6606`·`prisma/seeds/recent-clinical-activity.ts:577` 이 `eventAt` 을 직접 지정해 upsert.

### 2.4 시각 — 발생 시각과 기록 시각

`journey.service.ts:45` `data: { ...event, eventAt: new Date() }` — `JourneyEvent` 인터페이스(10-23)에 **시각 필드가 아예 없다.**
발행자가 "그 일이 실제로 언제 일어났는지" 알아도 넘길 방법이 없다.

구체 사례(응급 등록) `emergency/emergency.service.ts`:
- 232 `const triagedAt = new Date()` · 236 `claimedArrival = dto.arrivalAt` · 248 `arrivalAt: claimedArrival ?? triagedAt` — **원 기록은 사용자가 주장한 도착 시각을 정본으로 저장**한다.
- 262-271 같은 요청 안에서 `ER_ARRIVAL` 과 `ER_TRIAGE` 를 연달아 발행 — 둘 다 `eventAt = 지금`. 도착이 30분 전이었어도 여정은 "도착=트리아지=지금"이다. 두 이벤트의 시각이 같은 밀리초일 수 있어 **순서도 보장되지 않는다**(`orderBy: eventAt` 만, 보조 정렬 키 없음 — `journey.service.ts:157`).

반면 시드·직접 쓰기 일부는 `eventAt` 을 과거 값으로 넣는다. 즉 **같은 컬럼이 행마다 다른 의미**(기록 시각 / 발생 시각)를 갖는다.

### 2.5 사례(case) 식별과 에피소드 경계

여정 이벤트에는 방문·입원·응급 방문을 가리키는 전용 키가 없고, `refType/refId` 가 그 역할을 우연히 일부 맡는다. 실측(발행 지점 리터럴):

| 이벤트 | refType/refId | 근거 |
|---|---|---|
| `RECEPTION_CHECKIN`·`RECEPTION_CALLED` | `WAITING_QUEUE` / queue.id | `waiting-queue.service.ts:190-192,408-410` |
| `ENCOUNTER_START`(접수 경로) | `ENCOUNTER` / encounter.id | `waiting-queue.service.ts:469-471` |
| `ADMISSION`·`BED_TRANSFER` | `ADMISSION` / admission.id | `admission.service.ts:72-74` · `inpatient.service.ts:70-72,316-318` · `bed-transfer.service.ts:119-120` |
| `TRANSFER_CARE` | `CHARGE_OF_CARE` / 담당 기록 id | `admission.service.ts:116-118` |
| `DISCHARGE` | **없음** | `inpatient.service.ts:179-182` (전원도 같은 유형, 제목만 '전원') |
| `ADMISSION_CANCELLED` | **없음** | `inpatient.service.ts:302` |
| `ER_ARRIVAL`·`ER_TRIAGE` | **없음** | `emergency.service.ts:262-271` |
| `ER_TREATMENT_START` | `EmergencyVisit` / visit.id | `emergency.service.ts:104-106` |
| `ER_DISPOSITION`(최초·변경 둘 다)·`ER_CHECKOUT` | **없음** | `emergency.service.ts:395-399,819-826,846-850` |
| `SURGERY_START/COMPLETE` | ~~`SURGERY`~~ → **START 는 없음**, COMPLETE 만 `SURGERY`(검토 정정 §2.9③) | `surgery.service.ts:298,351-354` |
| 오더·조제·청구 | `Order`·`Dispensing`·`Billing` | `journey.listener.ts` |
| `LAB_RESULT`·`IMAGING_RESULT` | `LabResult`·`ImagingResult` | `lab.service.ts:414` · `imaging.service.ts:235` |
| `BILLING_PAID` | **없음** | `billing.service.ts:1771` |
| `PROTOCOL_STEP`·`CHRONIC_ALERT` | `protocol`·`chronic`(소문자) | `protocol.service.ts:566` · `chronic.service.ts:115` |

관찰:
1. refType 표기 규칙이 셋이다 — 대문자 스네이크(`ADMISSION`)·파스칼(`EmergencyVisit`)·소문자(`protocol`). 같은 개념(응급 방문)이 `EmergencyVisit` 과 refId 없음으로 갈린다.
2. 응급 방문 하나의 이벤트 5개 중 **1개만** 그 방문에 묶인다. 같은 환자가 같은 날 응급실을 두 번 오면 여정만으로는 어느 도착이 어느 퇴실과 짝인지 알 수 없다.
3. 에피소드 간 연결은 도메인 테이블에만 있다: `Encounter.admissionId`(`schema.prisma:1561`) · `EmergencyVisit.admissionId`(4736) · `WaitingQueue.encounterId`(7233) · `ProtocolInstance` 의 surgery/encounter/admission/emergencyVisit 4키(14237-14250). 여정 이벤트는 이 연결을 싣지 않는다.

### 2.6 상태(state)와 사건(event)이 두 정본

- 관제 보드 `journey-console/journey-console.service.ts:150-230` 는 **여정 이벤트를 읽지 않는다.** 단계를 도메인 테이블 상태에서 파생한다 — 외래 `WaitingQueue.status`(155-160) · 입원 `Admission.status`+`dischargeSummary 존재 여부`+`재원 1일 미만`(185-187) · 응급 `EmergencyVisit` 시각 필드 유무(205-215).
- 흐름 분석 `journey-analytics.service.ts:88,144,191` 도 도메인 테이블.
- 타임라인·기간 보고서·환자 포털은 여정 이벤트.

→ "지금 어느 단계인가"와 "어떤 일이 있었나"가 **서로 대조되지 않는 두 원천**이다. 보드는 "진료 중"인데 타임라인엔 `ENCOUNTER_START` 가 없는 상태(발행 유실·직접 상태 변경)를 아무도 감지하지 않는다.
- 입원 단계 `DISCHARGE_PLANNED` 는 퇴원요약 **텍스트가 있느냐**로 정한다(186) — 결정 사건이 아니라 문서 존재로 상태를 추정한다.

### 2.7 지표와 보고서

- 기간 보고서 `journey-report.ts` — 간격은 양 끝이 모두 있을 때만, 없으면 `null`(4-7, 24-29). 이 규약은 옳다. 그러나
  - `erStayMinutes = firstInterval('ER_ARRIVAL', ['ER_CHECKOUT','ER_DISPOSITION'])`(77) — 끝점에 **처분(결정)** 을 넣었다. 결정≠퇴실(ER 베드 보드 규약). 또 사례 키가 없어 기간 안에 응급 방문이 둘이면 첫 도착과 **아무 방문의** 첫 끝을 잇는다.
  - `admitToSurgeryMinutes`(78)도 같은 구조 — 입원 이전 외래 수술이 기간 안에 있으면 엉뚱한 짝.
- 질관리 지표 `journey.service.ts:197-306` `getMetrics`
  - 외래 대기만 `null`+표본 수(216-223). 🔴 **응급 체류(236)·재원일수(254)·30일 재입원율(286-288)은 표본 0 이면 `0`** — 화면(`apps/web/src/app/(main)/journey/page.tsx:14-16`)은 "0시간·0일·0%"를 사실로 그린다(P1).
  - 🔴 응급 체류를 `Admission.admitReason` 에 'ER' 문자열이 **포함된 입원**으로 센다(226-233) — 응급 방문(`EmergencyVisit.arrivalAt→퇴실`)이 아니라 입원 기간이다. 모집단·정의가 지표 이름과 다르다.
  - 재입원 판정이 퇴원 건마다 쿼리(272-284, N+1) — 정확성 문제는 아니나 기간이 길면 느리다.
- 날짜 경계 `getTimeline` `journey.service.ts:150-151`·`getMetrics` 198-199 — `new Date(from)`(UTC 자정=KST 09시)·`to + 'T23:59:59Z'`(KST 다음날 08:59). KST 기준으로 앞 9시간이 빠지고 뒤 9시간이 더해진다. 정본 `common/day-range.ts` `dayRange` 는 보고서(182)만 쓴다(판정 규칙 §날짜밀림).

### 2.8 이미 있는 좋은 장치(유지)

- 간격은 양 끝이 있을 때만(보고서) · 표본 수 동반(외래 대기) · 목표값 출처 `CONFIG/FALLBACK`(`flow-canon.ts:113-150`)
- 위치 원장은 출처(`OBSERVED_STATION`·`INFERRED_EVENT`·`SIMULATED`)·해상도(ZONE/FLOOR)를 밝힌다(`journey.service.ts:56-114`, `schema.prisma:9498-9516`) — **여정 이벤트 자체에는 이런 출처 구분이 없다**는 점과 대비된다.
- 지연 확인 `JourneyDelayAck`(`schema.prisma:9200-9225`) — 확인이 지연을 숨기지 않고 만료된다.
- 프로토콜 상태기계(`ProtocolTemplate/Instance/StepState`) — 정의와 인스턴스가 분리돼 있고 버전이 고정된다.

### 2.9 보완 실측 — 검토 라운드(2026-10-01)

> 초안이 운영 DB 를 보지 않았으므로 검토 때 **읽기 전용 집계만** 했다. 운영 DB 는 가상 병원 시드이므로 아래 수치는 "구조가 실제로 그렇게 동작한다"는 근거이지 실피해 규모가 아니다.

**① 원장 전체(운영 시드, 2026-10-01 조회)**

| 항목 | 값 | 읽는 법 |
|---|---:|---|
| 여정 행 수 | 2,390 | 기간 2026-05-22 ~ 2026-09-30 |
| 환자당 최다 행 | 147 · 69 · 51 · 40 · 38 | 직원 타임라인 상한(200) 안이지만 실운영에선 넘는다(§4.13) |
| `created_at` 과 `event_at` 이 60초 넘게 다른 행 | **1,973 (83%)** | `emit()` 은 둘을 같은 순간에 찍는다. 그런데도 다르다는 것은 시드·롤포워드(`dev.demoDateRoll`)가 `event_at` 을 **다시 썼다**는 뜻이다. "같은 컬럼이 행마다 다른 뜻"(§2.4)이 실측으로 확인된다 |
| 같은 환자·같은 유형·같은 밀리초 묶음 | **299** | 이중 발행인지, 같은 순간의 서로 다른 사실인지 원장만으로 가를 수 없다(§4.12) |
| 어휘에 없는 이름으로 저장된 행 | `ROUND` 15 | 제목이 `입원 중 (3층 내과병동 301)` 같은 형식이다. 어휘 가드는 **발행 지점**만 보므로 저장된 값의 어휘 이탈은 못 잡는다(§4.11). 어느 경로가 썼는지는 원장에 출처가 없어 **확인 불가**다 |

**② 유형별 refId 누락(운영 시드)**

| eventType | 행 | refId 없음 |
|---|---:|---:|
| `ENCOUNTER_START` | 417 | 251 |
| `ENCOUNTER_SIGNED` | 178 | **178(전부)** |
| `BILLING_PAID` | 150 | **150(전부)** |
| `RECEPTION_CHECKIN` | 57 | 40 |
| `RECEPTION_CALLED` | 36 | 28 |
| `ADMISSION` | 11 | 6 |
| `ER_ARRIVAL`·`ER_TRIAGE` | 9·9 | 9·9 |
| `ER_BED_ASSIGNED` | 8 | 8 |
| `DISCHARGE` | 5 | 5 |
| `ORDER_COMPLETED` | 5 | 5 |
| `ORDER_CREATED`·`LAB_RESULT` | 493·455 | 14·13 |
| `DISPENSED` | 234 | 0 |

코드상 refId 를 싣는 발행 지점(예: `ER_TREATMENT_START`)의 행에도 누락이 있다. 이는 시드나 과거 코드가 쓴 행이다. **과거 행의 누락은 코드를 고쳐도 남는다** — 그래서 §5.7 "방문 미지정" 묶음이 필요하다.

**③ 초안 표(§2.5) 정정 — 발행 지점을 다시 읽음**

| 초안 기재 | 실제 | 근거 |
|---|---|---|
| `SURGERY_START/COMPLETE` → `SURGERY` | **`SURGERY_START` 는 refId 없음**. COMPLETE 만 `SURGERY` | `surgery.service.ts:297-300` · `351-354` |
| `ENCOUNTER_START`(접수 경로)만 표기 | 진료 **직접 생성 경로**(`encounter.service.ts:193-197`)는 refId 없음. `ENCOUNTER_SIGNED`(390)·`ENCOUNTER_AMENDED`(312)도 없음 | 위 운영 계수와 일치 |
| — | PACU 2종은 refType **`PACU`**(`pacu.service.ts:314`·`796`) — 네 번째 표기 규칙 | |
| — | 응급 베드 3종(`er-bed.service.ts:392·431·455`) refId 없음 | |
| — | `CHECKUP_COMPLETE` 의 ref 는 방문이 아니라 **`CheckupSummary`**(`checkup.service.ts:1525-1530`). 같은 검진 방문의 사건들이 서로 다른 객체(`CheckupVisit`·`CheckupStationLog`·`CheckupSummary`)를 가리킨다 | 방문 단위 귀속은 객체 관계표(§5.4)로만 풀린다 |
| — | 데모 시나리오 발행(`patient-auth.service.ts:322-341·577-587`)은 refId 없음. REAL 모드에서는 막혀 있지만(`patient-auth.controller.ts:56-60`) **원장에 출처 표식이 없다** — 리허설 데이터에 데모 사건이 섞이면 원장만으로 가를 수 없다 | §7-D12 |

**④ refType 표기 전수 — 27가지, 규칙 4종 혼재**

`WAITING_QUEUE`·`ENCOUNTER`·`ADMISSION`·`CHARGE_OF_CARE`·`SURGERY`·`PACU`·`CLAIM`·`PATHOLOGY_REPORT`·`MDT_CASE`(대문자 스네이크) /
`Appointment`·`Order`·`LabResult`·`ImagingResult`·`Dispensing`·`MedicationAdministration`·`BloodTransfusion`·`Billing`·`EmergencyVisit`·`ConsentForm`·`CheckupVisit`·`CheckupStationLog`·`CheckupSummary`·`VocTicket`·`PatientMessage`(파스칼) /
`protocol`·`chronic`(소문자) / `diagnostic_test`(소문자 스네이크).
같은 개념이 다른 표기로 저장된다(접수 `WAITING_QUEUE` ↔ 오더 `Order`). 읽는 쪽 매핑표(§5.4) 없이는 객체 유형별 집계가 갈라진다.

**⑤ 발생 시각의 원천 후보 — 도메인 시각 필드(스키마 실측)**

| 모델 | 시각 필드 | 여정에 쓸 수 있는가 |
|---|---|---|
| `WaitingQueue` | `checkedInAt`·`calledAt`·`startedAt`·`completedAt`·`identityVerifiedAt` | 외래 접수·호출·진료 시작·종료의 **유일한 시각 원천**이다. `Encounter` 에는 시작 시각 필드가 없다(`createdAt`·`signedAt` 뿐) |
| `EmergencyVisit` | `arrivalAt`(사용자 주장 가능)·`triagedAt`·`treatmentStartedAt`·`dispositionAt` | 🔴 **퇴실 시각 필드가 없다**. 퇴실(`checkout`)은 상태만 바꾼다(`emergency.service.ts:844`). 응급 베드 배정 `releasedAt`(`releaseReason='DISPOSITION'`)이 같은 요청에서 찍히지만, 병상 해제와 환자 퇴실은 다른 사실이다(§7-D9) |
| `Admission` | `admitDate`·`dischargeDate`·`expectedDischargeDate` | 입원·퇴원 |
| `BedAssignment` | `assignedAt`·`releasedAt` | 전실 |
| `ChargeOfCare` | `assignedAt`·`releasedAt` | 담당의 변경 |
| `Surgery` | `scheduledAt`·`startedAt`·`endedAt`·**`incisionTime`·`closureTime`** | 🔴 수술 시각이 둘이다 — `startedAt` 은 "시작" 버튼을 누른 순간(`surgery.service.ts:296` `new Date()`), `incisionTime` 은 절개 시각(기록값). "수술 시간" 지표가 어느 쪽인지 정해야 한다(§7-D10) |
| `PacuRecord` | `arrivalTime`·`dischargeTime` | PACU 체류 |
| `LabResult` | `collectedAt`·`completedAt`·`verifiedAt` | 결과 사건의 발생 시각 = 확인(`verifiedAt`)? 완료(`completedAt`)? 정의가 필요하다 |
| `ImagingResult` | `acquiredAt`·`reportedAt` | 판독 |
| `Dispensing` | `dispensedAt`·`secondCheckAt`·`verifiedAt`·`issuedAt` | 조제·불출 |
| `MedicationAdministration` | `scheduledAt`·`administeredAt`·`bcmaScanAt` | 투약 |
| `Billing` | `paidAt`·`refundedAt` | 수납 |
| `CheckupVisit` | `scheduledDate`·`checkedInAt`·`completedAt` | 검진 방문 경계 |
| `CheckupStationLog` | `arrivedAt`·`startedAt`·`completedAt` | 검진 스테이션 |
| `ConsentForm` | `patientSignedAt`·`doctorSignedAt`·`witnessSignedAt`·`signedAt`·`revokedAt`·`supersededAt` | 동의 생명주기 |
| `Appointment` | `scheduledAt`·`confirmedAt`·`cancelledAt`·`noShowAt` | 예약(계획 시각 = `plannedAt`) |

→ 대부분의 사건은 **이미 도메인에 발생 시각이 있다.** 여정이 그 값을 못 받는 이유는 발행 인터페이스(§2.4)뿐이다. 반대로 **응급 퇴실**과 **외래 종료(`WaitingQueue.completedAt` 의 뜻)** 는 도메인에도 정본이 흐리다. 이 둘은 여정이 아니라 도메인 쪽 결정이 먼저다.

---

## 3. 조사 결과

> 출처 표기: **[원문]** = 원문 페이지·PDF 를 열어 해당 부분을 확인 · **[요약 도구]** = 원문 페이지를 열었으나 요약 도구를 거쳐 읽음(문장 인용은 도구 출력 기준이라 원문과 자구가 다를 수 있다) · **[초록]** = 초록·서지 페이지만 · **[2차]** = 검색 결과·백과 요약만. 상세는 §8.

### 3.1 환자 여정 지도(Patient Journey Mapping)

- **무엇**: 환자·보호자가 서비스에 들어오고·이동하고·경험하고·나가는 과정을 문서화해 시각·서술 지도로 만드는 환자 지향 연구 방법. Davies 등(2023, J Adv Nurs) 범위 고찰은 81편을 포함했고, 시각 형식은 서술만 34.5%·흐름도 19.7%·도식 19.7%·타임라인 8.6% 등으로 **표준 표기법이 없다**고 보고했다. 보고 지침 인용은 6/72(8.3%)뿐 [요약 도구].
- Voorheis 등(2025, J Diabetes Sci Technol) 범위 고찰: 여정 지도 25편·서비스 청사진 3편, "행·열 형식이 제각각이고 표준화되지 않았다" [요약 도구].
- **빌릴 것**: "들어오고·이동하고·나간다(enter/navigate/exit)"는 **경계가 있는 여정**이라는 관점. 그리고 이 분야 스스로가 표기 표준이 없다고 말한다는 사실 — 여정 지도는 **경험 연구 도구**이지 기록 모델의 정본이 될 수 없다.
- **한계**: 질적·설계 도구. 사건 의미론·시각·완결성을 규정하지 않는다.

### 3.2 PaJMa(Patient Journey Modeling Architecture)

- **무엇**: McGregor·Curry·Percival 등이 제안한 의료 특화 여정 모델링. 직원 역할·과정·정보 생성/이동·HIT·IT 기반·환자 요구/지침/정책·지표를 **층(layer)** 으로 함께 그린다. Percival & McGregor(2016, JMIR Hum Factors) 정신건강 실무자 17명 파일럿에서 IDEF-0·DFD·흐름도·VSM 대비 역할·정보 흐름 이해가 낫다고 보고 [요약 도구]. 저자 스스로 "작은 파일럿"이라 밝힘.
- **빌릴 것**: 한 단계에 **역할·정보(어떤 기록이 생기나)·지침·지표**를 함께 붙이는 층 구조 — 우리 어휘 항목마다 "누가·어떤 원 기록·어떤 지표에 쓰이나"를 메타데이터로 둘 근거.
- **한계**: 표기는 사람이 읽는 도식이다. 실행 의미론·교환 형식이 없다. 근거 표본이 작다.

### 3.3 서비스 청사진(Service Blueprint)

- **무엇**: 고객 행동·전면(frontstage) 행위·후면(backstage) 행위·지원 과정·증거(evidence)를 층으로 놓고, **상호작용선·가시선(line of visibility)·내부 상호작용선**으로 가른다(NN/g, Gibbons 2017) [원문]. (Shostack 1984 기원설은 이번에 원문을 확인하지 못했다.)
- **빌릴 것**: 🔴 **가시선** 개념이 이 저장소의 실제 문제와 정확히 맞는다. 현행 어휘는 "환자 포털 노출 여부"를 이벤트 기록 여부와 한 축으로 다룬다(§2.2). 청사진은 "기록되는 일"과 "고객에게 보이는 일"을 **다른 축**으로 둔다 — 간호 평가는 후면 행위로 **기록하되 보이지 않게** 할 수 있다.
- **한계**: 설계 도식. 시각·사례 키를 다루지 않는다.

### 3.4 임상경로·케어 경로(Clinical/Care Pathway)

- **정의**: 유럽 경로 협회(E-P-A) — "잘 정의된 환자군에 대해 잘 정의된 기간 동안 상호 의사결정과 진료 과정을 조직하는 복합 중재". 특징 중 하나로 **"변이(variance)와 결과의 문서화·모니터링·평가"** 를 명시 [원문]. De Bleser 등(2006)은 263편 중 82편에서 84개의 서로 다른 정의를 찾았다 [2차 — 원문 미열람]. Kinsman 등(2010, BMC Med) 5기준 정의는 원문 접근 실패 [미확인].
- **빌릴 것**: ① 경로는 **환자군과 기간이 정의된** 것이다 → 여정에도 "어느 경로·어느 기간의 일인가" 귀속이 필요. ② **변이 기록**은 경로의 구성 요소다 → 프로토콜 인스턴스의 건너뜀·차단·조건 분기를 "변이"로 남기는 근거.
- **한계**: 내용(무엇을 해야 하나) 표준이지 사건 기록 형식이 아니다.

### 3.5 BPMN · CMMN · DMN (OMG)

- **BPMN 2.0.2**(OMG, 2014) — 흐름도형 과정 표기·교환 형식 [원문 개요]. **CMMN 1.1**(2016) — 사례(case)·재량 항목(discretionary)·센트리(진입/종료 조건)·단계·마일스톤 [원문 개요].
- Gartner 등(2026, JMIR) 체계적 고찰 61편: BPMN 은 궤적 시각화·표준화에 유용하나 **시간 조건·지속시간 표현이 약하고, 약하게 구조화된·지식 집약적 과정과 다중이환 확장성에 한계**. 78.7%가 확장(DMN·CMMN·FHIR·BPMN4CP)을 썼다. 포함 연구 75.4%가 방법론적으로 약함 [요약 도구].
- Iglesias 등(2022, JMIR) 카테터 관련 혈류감염 경로: BPMN 확장으로 표현한 논리를 openEHR Task Planning 기본 요소로 더 적은 우회로 표현 — 환자 반응 불확실성·투약 시간 제약·공유 자원·실행 중 변경 [요약 도구].
- **빌릴 것**: ① 우리 프로토콜 상태기계(`ProtocolTemplate`)는 BPMN 보다 **CMMN 쪽**(게이트=센트리, 단계 완료=마일스톤, 재량 단계)에 가깝다 — 어휘를 그쪽으로 맞추면 분기·건너뜀을 설명할 말이 생긴다. ② 조건식 DSL(`condition-dsl.ts`)은 DMN 의 "결정을 과정에서 분리" 원칙과 같은 방향.
- **한계**: 셋 다 **정의(모델) 표기**다. "실제로 무슨 일이 있었나"를 기록하는 형식은 아니다 — 그건 아래 3.6·3.7 의 몫. 고찰 자체가 근거 품질이 낮다고 말한다.

### 3.6 프로세스 마이닝 — 이벤트 로그 요건

- **프로세스 마이닝 선언문**(IEEE 프로세스 마이닝 태스크포스, 2011) [원문]:
  - GP1 "이벤트 데이터를 일급 시민으로" — 이벤트는 **신뢰할 수 있고**(기록된 일이 실제로 일어났고 속성이 맞다), **완전하고**(주어진 범위에서 빠진 이벤트가 없다), **의미가 잘 정의되고**, **안전해야**(사생활·보안) 한다.
  - 로그 성숙도 5단계: ★★★★★ 신뢰·완전·의미 정의(온톨로지) · ★★★★ 자동·체계적·신뢰·완전, **사례와 활동이 명시적** · ★★★ 자동이나 비체계적, 신뢰하나 완전하지 않을 수 있음 · ★★ 부산물로 자동 기록, 범위 비체계적, **정보시스템을 우회할 수 있어 누락 가능** · ★ 수기·현실과 불일치 가능. "★★ 이하 로그 분석은 대개 문제가 있고 결과를 믿기 어렵다."
  - 용어: 이벤트 = 특정 사례(process instance)에 대한 활동의 **시작·완료·취소 등**. 즉 활동과 생명주기 단계는 별개 속성이다.
- **Bose·Mans·van der Aalst(2013)** "Wanna improve process mining results?" — 이벤트 로그 품질 문제 **27범주**(시각 문제·부정확한 활동 이름·누락 이벤트 등)와 과정 특성 문제 4범주(이벤트 세분도·사례 이질성). 처방은 체계적 기록·복구 기법·분석 기법 [초록]. 선언문은 날짜만 있고 시각이 없으면 순서를 알 수 없다는 예를 든다(`28-9-2011:h11m28s` vs `28-9-2011`) [원문].
- **Rojas 등(2016, J Biomed Inform)** 의료 프로세스 마이닝 문헌 고찰(74편) — 서지만 확인 [초록 미열람].
- **빌릴 것**: 현행 로그를 이 성숙도에 대어 보는 것 자체가 판정 도구다 → §4.1.
- **한계**: 분석 관점의 요건이라 환자 노출·법정 기록 같은 의료 고유 요구는 다루지 않는다.

### 3.7 XES(IEEE 1849)와 OCEL 2.0 — 교환 형식

- **XES**: IEEE 1849-2016, 2023 개정. 로그–트레이스(사례 하나)–이벤트 3층 + 표준 확장(concept 이름·**lifecycle 전이**·org 자원/역할·time 시각·cost·identity 등). 생명주기 참조 모델에 schedule·assign·start·complete·abort 등 전이 [2차 — Wikipedia·검색 요약. 표준 원문(유료) 미열람].
- **객체 중심 프로세스 마이닝**(van der Aalst, "Object-Centric Process Mining: An Introduction") [원문 PDF]:
  - 전통 로그는 이벤트마다 **사례 객체가 정확히 하나**라고 가정한다. 실제 과정은 여러 유형의 객체가 공유 활동으로 얽힌다.
  - 객체 중심 로그를 한 객체 유형으로 **평탄화(flattening)** 하면 세 문제: **결핍**(그 유형 객체가 없는 이벤트가 사라짐) · **수렴**(객체가 여럿인 이벤트가 복제돼 "3번 일어난 것이 6번"으로 보임 → 비용·재작업·평균 소요 KPI 왜곡) · **발산**(같은 사례·활동의 이벤트를 구분 못 해 인과가 사라지고 가짜 루프가 생김).
- **OCEL 2.0**(ocel-standard.org): 이벤트·객체·활동·객체 유형·**이벤트–객체 관계와 객체–객체 관계**·관계의 **한정자(qualifier, 예: 역할)**·시간에 따라 변하는 객체 속성 [원문 개요 — 명세서 본문 미열람].
- **빌릴 것**: 🔴 환자 여정은 전형적인 객체 중심 상황이다. 이벤트 하나("검사 결과 확정")가 환자·방문·오더·검체·담당자에 동시에 걸린다. "환자"를 사례로 평탄화한 현행 로그는 **발산**(같은 날 응급 방문 두 번)과 **수렴**(한 이벤트가 여러 방문에 걸칠 때)을 피할 수 없다. 이벤트–객체 관계표가 해법.
- **한계**: 교환·분석 형식이다. 내부 저장을 꼭 OCEL 모양으로 할 필요는 없다(반출 계약만 맞추면 된다).

### 3.8 HL7 FHIR — 경계·흐름을 나타내는 자원

[모두 원문 페이지, 요약 도구 경유]

| 자원 | 핵심 | 여정 모델에 주는 것 |
|---|---|---|
| **Encounter**(R4) | 상태 planned·arrived·triaged·in-progress·onleave·finished·cancelled·**entered-in-error**·**unknown**("최후의 수단"). `statusHistory`·`classHistory`(응급→입원 같은 분류 변화). `period`. **`partOf`** 로 입원 아래 개별 진료를 묶음. `hospitalization`(admitSource·dischargeDisposition). `location[]` 마다 상태·기간 | 방문 경계·중첩 · "모름"을 명시 값으로 · 잘못 입력의 별도 상태 |
| **Encounter**(R5) | 상태 planned·in-progress·on-hold·**discharged**("임상적으로 끝나 퇴원, 환자가 떠났을 수 있음")·**completed**·cancelled·**discontinued**("시작했으나 완료 못 함")·entered-in-error·unknown. `actualPeriod` 와 `plannedStartDate/EndDate` 분리 | 🔴 **임상 종료와 행정 종료의 분리**(discharged≠completed) · 계획 시각과 실제 시각 분리 · 중단을 별개 결말로 |
| **EncounterHistory**(R5) | 상태·분류·실제 기간·위치의 이력을 별도 자원으로. 정보가 늦게 들어오거나 청구·코딩 정정으로 **소급(back-dated)** 될 수 있음을 전제 | 이력은 본체와 분리·소급 정정이 정상 업무임을 인정 |
| **EpisodeOfCare**(R4) | 환자–기관 간 **책임 기간**. "Encounter 는 활동의 기록, EpisodeOfCare 는 문제·이슈를 위해 여러 Encounter 를 잇는 용기". 진료가 없는 기간에도 존재. 상태 planned·waitlist·active·onhold·finished·cancelled + statusHistory | 만성질환·암 등록·검진 추적처럼 **방문을 넘는 여정** |
| **Provenance**(R4) | **`occurred[x]`(활동이 일어난 기간)** 와 **`recorded`(기록된 순간, 필수)** 를 따로. agent(누가·어떤 참여) | 🔴 발생 시각/기록 시각 분리의 표준 근거 |
| **Task**(R4) | 워크플로 상태기계(requested·accepted·ready·in-progress·on-hold·completed·failed·cancelled 등)와 **businessStatus**(도메인 고유 단계, 예 "검체 채취됨") 분리. executionPeriod·authoredOn·partOf·basedOn | 형식 상태와 업무 단계 분리 · 할 일 큐 |
| **PlanDefinition**(R4) | **엄격히 정의 자원** — "어떤 행위의 의도도, 행해진 사실도 나타내지 않는다". relatedAction(before·after·concurrent 등+오프셋), condition. `$apply` → CarePlan/RequestGroup | 정의–인스턴스–사실의 3층 분리 |

### 3.9 openEHR

- **현실 시간과 시스템 시간을 구분**한다. EVENT_CONTEXT 의 시작(필수)·종료(선택) 시각은 진료·활동의 시각이며, "의사가 밤에 기록을 입력하는 것처럼 사건 훨씬 뒤에 추가돼도" 그대로 쓴다. 커밋 시각은 버전 감사(AUDIT_DETAILS `time_committed`)에 따로 남는다 [EHR IM 원문 요약 도구 · AUDIT_DETAILS 는 검색 요약만].
- 기록 범주: **사건(event) 기록**·**지속(persistent) 기록**(문제·약·알레르기)·**에피소드(episodic) 기록**(임신·입원처럼 정해진 기간에만 단일 정본으로 유지) [요약 도구].
- **빌릴 것**: 상태(지속/에피소드)와 사건을 다른 범주로 두는 설계 — §2.6 의 두 정본 문제를 "의도된 두 범주 + 대조 규칙"으로 바꾸는 근거.

### 3.10 OMOP CDM v5.4

- `VISIT_OCCURRENCE`(사람이 보건의료 체계와 일정 기간 관계를 맺는 사건) · `VISIT_DETAIL`(방문 안의 하위 단위, 1:n — 병동 전동 등) · `preceding_visit_occurrence_id`(직전 방문) · `admitted_from`/`discharged_to` · 경계가 불분명한 **"응급실 및 입원" 통합 방문 개념** · **`OBSERVATION_PERIOD`** = "임상 사건이 기록되며, **기록이 없으면 그 사건이 없었다고 볼 수 있는** 기간" [원문 요약 도구].
- **빌릴 것**: 🔴 "부재 = 없음"은 **관측 기간 안에서, 관측되는 사건 유형에 한해서만** 성립한다는 명시적 정의. 우리 원칙(표본 부재 ≠ 0)을 모델의 1급 개념으로 올릴 수 있다. 응급→입원 경계를 하나로 볼지 둘로 볼지는 **선택**이라는 선례.

### 3.11 한국 제도 맥락

- **환자경험평가**(건강보험심사평가원): 상급종합·종합병원 1일 이상 입원 만 19세 이상, 퇴원 후 2~56일 모바일웹 조사. 간호사·의사·투약 및 치료과정·정서적 지지·환자 안전과 병원 환경·환자권리보장·전반적 평가 영역, 5등급 [원문 요약 도구]. → 여정의 **입원 에피소드 종료(퇴원)** 가 조사 대상 선정의 기준점이다. 회진 정보·퇴원 후 주의사항 설명 같은 문항은 현행 어휘에 대응 사건이 없다(ROUND 미발행, 교육 기록은 별도 원장).
- **의료기관 인증**(보건복지부): 급성기병원 4개 영역 중 환자진료체계에 "진료전달체계와 평가" [원문]. 4주기 세부(외래·응급 등록·입원·중환자실 입실·진료 연속성·퇴원·전원 절차)는 검색 요약으로만 확인 [2차 — 기준집 원문 미열람]. → 여정의 **전이 지점(입원·전동·전원·퇴원)** 이 인증 조사 대상과 겹친다.

---

## 4. 현행 모델의 논리적 결함·모호점 (문헌 대조 판정)

판정 표기: **결함** = 지표·화면이 사실과 다르게 말할 수 있는 구조 · **모호** = 의미가 정의되지 않아 해석이 갈림 · 실피해는 전부 **미측정**(운영 DB 미조회·시드 데이터).

### 4.1 로그 성숙도 판정 — ★★ 와 ★★★ 사이

선언문 기준(§3.6)에 대면:
- 자동 기록이다(★★ 이상).
- **사례가 명시적이지 않다**(★★★★ 미달) — §2.5.
- **정보시스템을 우회할 수 있다**(★★ 특징) — 직접 쓰기 9파일, 발행 실패 시 warn 로그만, 상태를 바꾸지만 이벤트를 안 내는 경로 존재 가능.
- **완전성을 잴 방법이 없다**(★★★ 미달 여부조차 판정 불가) — 원 기록 대비 이벤트 대조가 상시로 없다. 2026-07 감사에서 오더 4%·검사 결과 5%·처방 1%만 여정에 있었던 이력(`docs/03-analysis/journey-event-coverage-audit-2026-07.md`)이 그 위험을 보여준다.

→ 결론: **타임라인으로는 쓸 만하나, 간격·비율 지표의 원천으로 쓰기엔 요건 미달.** 이 문서의 P0~P2 는 ★★★★ (사례 명시·체계적·완전성 측정 가능) 도달을 목표로 한다.

### 4.2 [결함] 발생 시각과 기록 시각이 한 컬럼에서 섞인다

- 근거: §2.4. `emit()` 은 기록 시각을 강제, 시드·일부 직접 쓰기는 발생 시각을 넣음.
- 문헌: FHIR Provenance `occurred` vs `recorded` · openEHR 현실 시간 vs 시스템 시간 · 선언문 "속성이 맞아야 신뢰".
- 영향: 응급 도착을 30분 늦게 등록하면 체류가 30분 짧게 나온다. 늦은 기록(간호 늦은 기록 유예가 원내 규정으로 생긴 상황 — 2026-09 nurse-station 커밋)이 늘수록 간격 지표가 체계적으로 짧아진다. 동시각 이벤트의 순서 미보장.

### 4.3 [결함] 사례 식별·에피소드 경계가 없다

- 근거: §2.5. refId 없는 이벤트·표기 3종·응급 방문 이벤트 5개 중 1개만 귀속.
- 문헌: 선언문 ★★★★ "사례가 명시적" · OCEL 발산/수렴 · FHIR Encounter `partOf`/EpisodeOfCare · OMOP visit/visit_detail.
- 영향: 기간 보고서 `firstInterval` 이 다른 방문의 시작과 끝을 잇는다(§2.7). 외래 진료 중 응급 이송·입원 중 다른 과 협진처럼 **한 환자의 동시 에피소드**를 구분하지 못한다.

### 4.4 [결함] 완결성 — 여정의 시작·끝과 "빠진 것"을 정의하지 않았다

- 근거: 종료 사건이 트랙마다 다르고 일부는 정의가 흐림 — 외래 종료(`ENCOUNTER_SIGNED`? `BILLING_PAID`? `DISPENSED`?)가 없다. 응급 종료 후보가 둘(`ER_DISPOSITION`·`ER_CHECKOUT`). 입원 `DISCHARGE` 에 전원 포함(제목만 다름).
- 문헌: 여정 지도 "들어오고·나간다" · FHIR R5 `discharged`(임상 종료)≠`completed`(전체 종료)·`discontinued` · OMOP observation period.
- 영향: "열린 여정"·"끝난 여정"을 판정할 수 없다. 종료 사건이 유실되면 영원히 진행 중으로 보이거나, 반대로 사건이 없다는 이유로 "끝났다"로 볼 수 있다.

### 4.5 [결함] 표본 부재를 0 으로 · 지표 정의가 이름과 다르다

- 근거: §2.7 `getMetrics` 의 응급 체류·재원일수·재입원율 0 폴백, 응급 체류 모집단이 `admitReason` 문자열.
- 문헌: OMOP — 부재가 "없음"인 것은 관측 기간 안에서뿐 · 선언문 "의미가 잘 정의된" 이벤트.
- 영향: 화면이 "응급실 평균 체류 0시간"을 말할 수 있다(P1·P17). 응급 체류가 실제로는 "ER 이 사유에 적힌 입원의 재원 기간"이다.

### 4.6 [결함] 상태와 사건이 서로 대조되지 않는 두 정본이다

- 근거: §2.6. 관제·분석은 도메인 상태, 타임라인·보고서·포털은 이벤트.
- 문헌: openEHR 사건/지속/에피소드 기록 범주 · FHIR Task status vs businessStatus · EncounterHistory 분리.
- 판정: 두 원천 자체는 문헌상 정상이다(상태=현재, 사건=이력). 결함은 **둘이 어긋날 때 아무도 모른다**는 점. 또 입원 `DISCHARGE_PLANNED` 를 문서 존재로 추정하는 것은 사건 없이 상태를 지어내는 것이다(P1 경계).

### 4.7 [모호] 활동 이름에 생명주기·정정이 섞여 있다

- 근거: `SURGERY_START/COMPLETE`·`PACU_ADMISSION/DISCHARGE` 는 시작/완료 쌍 · `ER_DISPOSITION` 이 최초 결정과 **변경**(`emergency.service.ts:819-826`) 모두 · `ENCOUNTER_AMENDED` 는 정정 · `ADMISSION_CANCELLED` 는 취소. 활동(무엇)·전이(시작/완료/취소/정정)·결과(전원/퇴원)가 이름 하나에 들어 있다.
- 문헌: 선언문 용어(이벤트=활동의 시작·완료·취소) · XES lifecycle 확장 · FHIR `entered-in-error`.
- 영향: "응급 처분 횟수"를 세면 변경까지 세어 수렴 문제와 같은 과대 계수. 정정과 사실이 같은 줄에 있어 잘못 입력을 지울 방법(표준의 entered-in-error)이 없다 → 실제로는 `deleteMany` 로 지우는 코드가 생겼다(§2.3).

### 4.8 [모호] 기록할 것인가 ≠ 보여줄 것인가

- 근거: §2.2 — 노출 결정 대기 4종이 **기록조차 안 됨**.
- 문헌: 서비스 청사진 가시선.
- 영향: 간호 평가·낙상 위험 같은 후면 사건이 분석·완결성 측정에서도 빠진다. 노출 결정은 사람 몫이지만, 기록 자체는 그 결정과 무관하게 할 수 있다(노출은 fail-closed 로 이미 막혀 있다).

### 4.9 [결함] 날짜 경계가 UTC 다

- 근거: §2.7 `getTimeline`·`getMetrics` 의 `new Date(from)`·`'T23:59:59Z'`. 판정 규칙 §날짜밀림의 같은 함정.

### 4.10 [모호] 경로(정의)와 여정(사실)의 대응이 느슨하다

- 근거: 프로토콜은 `PROTOCOL_STEP` 한 유형으로 "어떤 단계가 완료됨"만 남긴다(`protocol.service.ts:566`). 건너뜀·차단·조건 분기(변이)는 여정에 없다.
- 문헌: E-P-A "변이의 문서화·모니터링" · PlanDefinition(정의)↔CarePlan/RequestGroup(의도)↔사실 3층.
- 영향: 경로 준수율·변이율을 산출할 근거가 없다.

### 4.11 [결함] 저장된 값의 어휘 이탈을 아무도 보지 않는다

- 근거: §2.9① `ROUND` 15행. 어휘 가드(`journey-event-vocabulary.spec.ts`)는 **코드의 발행 리터럴**만 대조한다. 시드·과거 코드·시뮬레이터가 이미 쓴 행은 대상 밖이다.
- 문헌: 선언문 "의미가 잘 정의된" 이벤트 · Bose 등 "부정확한 활동 이름" 범주.
- 영향: 화면 아이콘·필터가 모르는 이름은 "기타"로 떨어지거나 사라진다. 환자 포털은 fail-closed 라 숨긴다(안전). 하지만 분석은 그 행을 셀지 말지 정의가 없다.
- 처방: 감시자 불변식 "어휘 밖 저장값 수"(§5.12 Q5) — 고치지 않고 **센다**(소급 수정 금지).

### 4.12 [결함] 같은 순간의 사건과 이중 발행을 가를 수 없다

- 근거: §2.9① 같은 환자·유형·밀리초 299묶음. 멱등 키가 없다(§2.1). 정렬 보조 키도 없다.
- 문헌: Bose 등 "중복 이벤트" · 선언문 "신뢰(기록된 일이 실제로 일어났다)".
- 영향: 결과 건수·처방 건수 같은 계수가 부풀 수 있고, 줄일 근거도 없다. 반대로 같은 밀리초에 정당하게 생긴 두 사건(여러 검사 결과 동시 확정)을 중복으로 지우면 사실이 사라진다.
- 처방: 신규 행은 멱등 키(§5.4 `idempotency_key`)로 막는다. 과거 행은 **중복 의심 수**로만 보인다(§5.12 Q4).

### 4.13 [결함] 직원 타임라인이 오래된 것부터 자르고, 잘랐다고 말하지 않는다

- 근거: `journey.service.ts:155-159` `orderBy: eventAt asc · take 200`. 커서·`truncated` 표식이 없다. 환자 포털(`portal.service.ts:2826~`)은 `desc · take ≤100` 이라 최신부터다 — **같은 원장을 두 화면이 반대 방향으로 자른다.**
- 영향: 행이 200건을 넘는 장기 재원 환자의 직원 타임라인에서 **최근 사건이 보이지 않는다.** 운영 시드 최다는 147건이라 아직 발생하지 않았지만, 실운영 장기 재원(하루 오더·결과 수십 건)에서는 수일 안에 넘는다.
- 판정 규칙: "자르면 잘랐다고 말한다"(§1 정직성).
- 처방: P0 — 최신부터(desc)·커서(`<recordedAt>|<id>` 복합 — 저장소 시각 커서 규약)·`truncated` 를 응답에 싣는다.

### 4.14 [결함] 응급 퇴실 시각의 정본이 없다

- 근거: §2.9⑤. `EmergencyVisit` 에 퇴실 시각 필드가 없다. 여정의 `ER_CHECKOUT` 은 기록 시각이고, refId 도 없다(§2.5).
- 영향: 응급 체류(ED LOS)·처분→퇴실(boarding) 지표의 **끝점이 존재하지 않는다**. 지금 이 지표를 내는 곳은 모두 대용값(입원 기간·처분 시각·여정 기록 시각)을 쓴다. P0-2 가 "산출 불가"로 두는 이유다.
- 처방: 도메인에 `departedAt`(발생 시각·출처 포함)을 두는 것은 응급 도메인 결정이다(§7-D9). 여정은 그 값을 받기만 한다.

### 4.15 [모호] 한 활동에 시각 원천이 둘이다(수술·검사 결과)

- 근거: §2.9⑤ — 수술 `startedAt`(버튼) ↔ `incisionTime`(절개) · 검사 결과 `completedAt` ↔ `verifiedAt`.
- 영향: 같은 "수술 시간"이 화면마다 다른 원천이면 갈라진다(P12). 수술실 효율 지표(OR time)·마취 시간·절개~봉합 시간은 문헌·실무에서 **서로 다른 지표**로 쓰인다(구체 정의 문헌은 이번 조사에서 원문 미확인).
- 처방: 활동을 쪼갠다 — `OR_STAY`(입실~퇴실, 현행 시작/완료 버튼) · `SURGICAL_PROCEDURE`(절개~봉합) · `RESULT_VERIFIED`·`RESULT_COMPLETED`. 지표 정의서(§5.10)가 각 지표의 원천을 고정한다(§7-D10).

### 4.16 [모호] 데모·시드·실제 사건이 같은 원장에 출처 구분 없이 있다

- 근거: §2.9③ 데모 시나리오 발행 · §2.9① 롤포워드로 바뀐 `event_at` · 위치 원장은 출처(`SIMULATED`)를 갖지만 여정 원장은 없다(§2.8).
- 영향: 리허설 모드에서 데모 사건이 지표에 섞여도 원장만으로 걸러낼 수 없다. 실서비스 전환 때 "시드 전량 제거"(CLAUDE.md)를 여정 원장에 적용할 기준 컬럼이 없다.
- 처방: `data_origin`(`LIVE`·`SEED`·`DEMO`·`IMPORTED`) 추가(§5.4). 과거 행은 시드 UUID 패턴·데모 경로로 **판정 가능한 것만** 채우고, 나머지는 `UNKNOWN` 으로 둔다(추정 금지 · §7-D12).

---

## 5. 제안 모델

### 5.1 개념 (용어 정의)

| 개념 | 정의 | 문헌 근거 | 현행 대응 |
|---|---|---|---|
| **사건(Event)** | 한 번 일어난 일. 바뀌지 않는다(정정은 새 사건) | 선언문·OCEL | `PatientJourneyEvent` 행 |
| **활동(Activity)** | 사건의 종류("수술", "응급 처분") | XES concept·OCEL activity | `eventType` 의 앞부분 |
| **전이(Transition)** | 활동의 생명주기 단계: `REQUESTED`·`SCHEDULED`·`STARTED`·`COMPLETED`·`CANCELLED`·`DISCONTINUED`·`REVISED`·`ENTERED_IN_ERROR` | XES lifecycle·FHIR status | 이름에 섞여 있음 |
| **발생 시각(occurredAt)** | 그 일이 실제로 일어난 시각. **모르면 null** | Provenance.occurred·openEHR 현실 시간 | 없음 |
| **기록 시각(recordedAt)** | 시스템이 알게 된 시각. 항상 있음 | Provenance.recorded·openEHR 커밋 | 현행 `eventAt` 의 실제 의미 |
| **시각 출처(occurredAtSource)** | `DOMAIN_FIELD`(원 기록의 시각 필드) · `USER_CLAIMED`(사용자가 주장) · `SAME_AS_RECORDED`(발생=기록으로 간주 — 즉시 행위) · `UNKNOWN` | 위치 원장 출처 규약(내부 선례) | 없음 |
| **객체(Object)** | 사건이 관여하는 실체: 환자·방문 단위·오더·검체·병상 등 | OCEL object | `patientId` + `refType/refId`(하나) |
| **사건–객체 관계** | 사건 1 : 객체 N, **한정자**(`subject`·`episode`·`focus`·`location`·`performer`) | OCEL E2O qualifier | 없음 |
| **방문 단위(Encounter-unit)** | 원내에서 한 번의 연속된 진료 관계 — 외래 접수 1건 · 응급 방문 1건 · 입원 1건 · 수술 1건 · 검진 방문 1건. **새로 만들지 않고 기존 도메인 행을 가리킨다** | FHIR Encounter·OMOP visit | `WaitingQueue`·`EmergencyVisit`·`Admission`·`Surgery`·`CheckupVisit` |
| **연결(Link)** | 방문 단위 간 관계: `partOf`(입원 안의 수술) · `precededBy`(응급→입원 전환) | FHIR partOf·OMOP preceding_visit | 도메인 FK 에만 존재 |
| **돌봄 에피소드(Episode of care)** | 방문을 넘는 책임 기간(만성질환 관리·암 추적·검진 주기) — **P3 이후, 도메인 정본이 있을 때만** | FHIR EpisodeOfCare·openEHR episodic | 없음 |
| **관측 범위(Observation scope)** | 어떤 활동이 **언제부터 체계적으로 발행되었는가**의 등록부. 이 범위 밖의 부재는 "모름" | OMOP observation period | 없음(가이드 문서에 서술만) |
| **가시성(Visibility)** | 환자 노출 여부 — **기록 여부와 독립** | 서비스 청사진 가시선 | 어휘가 겸함 |

### 5.2 불변식 (가드·감시자로 기계 검사할 것)

- **I1 사건 불변** — 여정 행은 UPDATE·DELETE 하지 않는다. 정정은 `ENTERED_IN_ERROR`/`REVISED` 전이의 새 행 + `supersedesId`. (예외: DEMO 모드 정리 도구 — 운영 모드 가드 뒤에만.)
- **I2 시각 정직성** — `occurredAt` 은 출처가 `UNKNOWN` 이면 null. `occurredAt > recordedAt` 금지(미래 사건 금지 — 단 `SCHEDULED` 전이는 예정 시각이므로 별도 필드 `plannedAt`). 지표는 `occurredAt` 만 쓰고, null 이면 그 표본은 **산출에서 빠지며 빠진 수를 함께 낸다**.
- **I3 사례 귀속** — 방문 단위 트랙(외래·응급·입원·수술·검진)의 사건은 **방문 단위 객체 관계가 정확히 1개**(`qualifier=episode`). 0개면 발행 거부(개발)·경고 기록(운영). 2개 이상은 `partOf` 관계로만.
- **I4 단일 발행 경로** — `patientJourneyEvent.create` 는 정본 발행기 안에서만(구조 가드). 직접 쓰기 9파일 이관.
- **I5 상태–사건 대조** — 방문 단위가 상태 X 에 있으면 X 에 도달하는 전이 사건이 있어야 한다(예: `EmergencyVisit.treatmentStartedAt != null` ⇒ `ER_TREATMENT·STARTED` 사건 존재). 어긋남은 감시자 불변식으로 **세고 보여준다**(자동 교정 금지 — 소급하지 않는다).
- **I6 종료 일관성** — 방문 단위가 종결 상태면 종료 전이 사건이 정확히 하나(정정 제외). 종료 사건 뒤 같은 방문 단위의 `STARTED` 사건 금지.
- **I7 관측 범위** — 어휘 항목마다 `observedSince`(체계적 발행 시작일)를 둔다. 그 이전 기간의 부재는 화면·지표가 "기록 범위 밖"으로 말한다.
- **I8 가시성 분리** — 기록 여부는 어휘 등재로, 환자 노출은 `JOURNEY_EVENT_PATIENT_HIDDEN`(현행 fail-closed 유지)로. 노출 미결정 유형도 **기록은 할 수 있다**(사람 결정 §7-D3).

### 5.3 어휘 재구성 원칙 (저장된 이름은 소급 변경하지 않는다)

현행 규약("이미 쌓인 이벤트 이름은 소급 변경하지 않는다")을 지킨다. 새 컬럼 `activity`·`transition` 을 **추가**하고, 현행 `eventType` 에서 결정적으로 파생하는 매핑표를 shared 에 둔다.

| 현행 eventType | activity | transition | 비고 |
|---|---|---|---|
| `SURGERY_START` / `SURGERY_COMPLETE` | `SURGERY` | `STARTED` / `COMPLETED` | |
| `PACU_ADMISSION` / `PACU_DISCHARGE` | `PACU_STAY` | `STARTED` / `COMPLETED` | |
| `ER_ARRIVAL` | `ER_VISIT` | `STARTED` | 발생 시각 = `EmergencyVisit.arrivalAt` |
| `ER_DISPOSITION`(최초) / (변경) | `ER_DISPOSITION_DECISION` | `COMPLETED` / `REVISED` | 🔴 현행은 두 경우가 같은 이름 — 과거 행은 제목 패턴으로도 확정할 수 없으면 `UNKNOWN` 으로 둔다(추정 금지) |
| `ER_CHECKOUT` | `ER_VISIT` | `COMPLETED` | 응급 체류의 끝점은 이것뿐 |
| `ADMISSION` / `ADMISSION_CANCELLED` / `DISCHARGE` | `INPATIENT_STAY` | `STARTED` / `CANCELLED` / `COMPLETED` | 퇴원·전원은 `outcome` 속성(사망 등 포함)로. 과거 행은 제목('전원'/'퇴원')에서 파생 가능 |
| `ENCOUNTER_START` / `ENCOUNTER_SIGNED` / `ENCOUNTER_AMENDED` | `CONSULTATION` / `CONSULT_NOTE` / `CONSULT_NOTE` | `STARTED` / `COMPLETED` / `REVISED` | 서명은 진료 종료가 아니라 **기록 완료** — 활동을 분리 |
| `DIAGNOSTIC_ON_HOLD` / `DIAGNOSTIC_RESUMED` / `DIAGNOSTIC_CANCELLED` | `DIAGNOSTIC_TEST` | `SUSPENDED` / `RESUMED` / `CANCELLED` | |
| `CONSENT_REQUESTED` / `SIGNED` / `COMPLETED` / `REVOKED` | `CONSENT` | `REQUESTED` / (`businessStatus=SIGNED_BY_PATIENT`) / `COMPLETED` / `REVOKED` | FHIR Task businessStatus 방식 |

전이 어휘에 `SUSPENDED`·`RESUMED`·`REVOKED` 를 두는 것은 사람 결정이 아니라 기술 정리다(문헌 어휘 대응). **어휘 확정 시 shared 정본 + 기존 가드에 활동·전이 매핑 완전성 검사를 더한다.**

### 5.4 이벤트 로그 계약 (저장 v2 · 추가 전용)

`patient_journey_events` 에 **추가 컬럼만**(기존 컬럼·행 불변):

| 컬럼 | 형 | 기본 | 뜻 |
|---|---|---|---|
| `recorded_at` | timestamptz | `now()` | 기록 시각(현행 `event_at` 과 같은 값으로 시작) |
| `occurred_at` | timestamptz **null** | null | 발생 시각 — 모르면 null |
| `occurred_at_source` | varchar(20) | 신규 행은 **기본값 없음**(발행자가 밝혀야 컴파일) | §5.1 |
| `occurred_at_precision` | varchar(10) null | null | `INSTANT`·`MINUTE`·`DAY` — 날짜만 아는 사건(선언문 예시) |
| `activity`·`transition` | varchar | null(과거 행) | §5.3 |
| `outcome` | varchar null | null | 퇴원·전원·사망 등 |
| `supersedes_id` | uuid null | null | 정정 대상 |
| `idempotency_key` | varchar null, **유니크(부분)** | null | 같은 사실의 이중 발행 방지(`<activity>:<transition>:<episodeId>`) |
| `emitter` | varchar(60) | — | 발행 지점 식별(모듈.메서드) — 완결성 진단용 |
| `data_origin` | varchar(10) | 신규 행 필수 | `LIVE`·`SEED`·`DEMO`·`IMPORTED`·`UNKNOWN`(과거 행 판정 불가) — §4.16·§7-D12 |
| `planned_at` | timestamptz null | null | `SCHEDULED` 전이의 예정 시각(예약·검진 예정) — 발생 시각과 섞지 않는다(I2) |

새 테이블 `patient_journey_event_objects`(OCEL E2O):
`event_id` · `object_type`(shared 정본 어휘 — `WaitingQueue`·`Encounter`·`EmergencyVisit`·`Admission`·`Surgery`·`CheckupVisit`·`Order`·`LabResult`·`ImagingResult`·`Dispensing`·`Billing`·`ConsentForm`·`ProtocolInstance`·`Bed` …, **표기 한 가지**) · `object_id` · `qualifier`(`episode`·`focus`·`location`·`performer`·`partOf`).
기존 `refType/refId` 는 읽기 호환용으로 남기고, 새 행은 관계표를 정본으로 쓴다. `refType` 표기 3종은 **읽는 쪽 매핑**으로만 정규화(저장값 불변).

발행 API(정본 하나):
```ts
journey.record({
  patientId, activity, transition,
  occurredAt: Date | null, occurredAtSource,  // 둘 다 필수 인자(값은 null 가능)
  episode: { type: 'EmergencyVisit', id },     // 방문 단위 트랙이면 필수
  objects?: [{ type, id, qualifier }],
  outcome?, supersedesId?, idempotencyKey?,
  title, description?, department?, ...
})
```
- 🔴 유실 방지: 현행 fire-and-forget 을 **도메인 커밋 후 아웃박스**로 바꿀지(§7-D5)는 사람·운영 판단이 섞인다. 최소한 발행 실패를 원장(`journey_emit_failures` 또는 기존 감시자 판정 원장)에 **세어** 완결성 분모에 넣는다.

### 5.5 반출 계약 — XES / OCEL 2.0

내부 저장은 위 계약, **반출은 변환**으로(내부를 표준 모양에 맞추지 않는다).

| XES 속성 | 출처 | 규칙 |
|---|---|---|
| trace = 사례 | 반출 시 선택한 객체 유형(예: `EmergencyVisit`) | 🔴 평탄화 경고 동봉 — 결핍(그 유형 관계 없는 사건 수)·수렴(관계 2개 이상 사건 수)을 **메타에 숫자로** |
| `concept:name` | `activity` | 과거 행은 매핑표 파생, 매핑 불가 = 사건 제외하고 제외 수 기재 |
| `lifecycle:transition` | `transition` | XES 표준 생명주기 이름으로 대응(start/complete/withdraw 등 — 대응표는 표준 원문 확인 후 확정, **현재 미확인**) |
| `time:timestamp` | `occurred_at` | null 이면 **사건을 빼고** 제외 수 기재. `recorded_at` 으로 대체하지 않는다(대체는 별도 옵션 + 표식) |
| `org:group`·`org:role` | `department`·performer 역할 | 직원 개인 식별자는 기본 제외(§7-D6) |

OCEL 2.0: events(= 행) · objects(= 관계표의 객체, 속성은 반출 시점 스냅샷이 아니라 **사건 시점 값**을 알 수 있을 때만) · E2O(qualifier 그대로) · O2O(`partOf`·`precededBy` — 도메인 FK 에서 파생).

🔴 반출은 **대외 발신**이다 — 3조건(구현+설정 기본 OFF+승인) · 비식별화 · 운영 모드(리얼에서 시드 섞임 금지). 연구 반출 허용 자체가 §7-D4.

### 5.6 FHIR 대응표

| 우리 개념 | FHIR R4 | FHIR R5 | 비고 |
|---|---|---|---|
| 외래 접수 1건(`WaitingQueue`+`Encounter`) | Encounter class=AMB, status arrived→in-progress→finished | in-progress→discharged→completed | 접수 대기=arrived(R4), R5 엔 arrived 없음 → `businessStatus` 류 확장 필요(미확인) |
| 응급 방문(`EmergencyVisit`) | Encounter class=EMER, triaged 상태 사용 | 같은 class, status 축소 | 처분 결정=`hospitalization.dischargeDisposition`, 퇴실=period.end |
| 입원(`Admission`) | Encounter class=IMP, `hospitalization`, `location[]`(병상 기간 = `BedAssignment`) | `admission`, EncounterHistory | |
| 응급→입원 전환 | 두 Encounter + 입원 쪽 `hospitalization.admitSource=emd` 또는 `partOf` | 같음 | OMOP 은 통합 방문 개념도 허용 — 경계 선택은 §7-D2 |
| 입원 중 수술 | Procedure(encounter=입원) 또는 하위 Encounter `partOf` | 같음 | |
| 상태 이력 | `statusHistory`·`classHistory` | **EncounterHistory** | 여정 사건에서 파생 가능 |
| 여정 사건의 시각 이중성 | **Provenance** `occurred[x]`·`recorded` | 같음 | 사건별 Provenance 는 과함 — 반출 시 묶음 단위 |
| 정정·잘못 입력 | status `entered-in-error` | 같음 | §5.2 I1 |
| 프로토콜 정의 / 인스턴스 / 단계 | PlanDefinition / CarePlan(또는 RequestGroup) / Task(status+businessStatus) | 같음 | 게이트=condition, 단계 순서=relatedAction |
| 만성·암·검진 추적 | **EpisodeOfCare** | 같음 | 도메인 정본 생긴 뒤(P3) |
| 지연 확인(`JourneyDelayAck`) | Flag(기간·작성자) 후보 | 같음 | **후보일 뿐 — 대응 근거 미검토** |
| 모르는 상태 | status `unknown`("최후의 수단") | 같음 | 화면 3상태와 대응 |

### 5.7 화면이 "모름"을 말하는 방식

| 상황 | 화면 문장(예) | 하지 말 것 |
|---|---|---|
| 발생 시각 미상(`occurredAt=null`) | 시각 자리에 "기록 {recordedAt} · 발생 시각 미상" | 기록 시각을 발생처럼 표시 |
| 시각 출처가 사용자 주장 | 작은 표식 "입력된 도착 시각" | 관측처럼 표시 |
| 간격 지표 표본 0 | "산출 불가 (표본 0)" | `0`·`-` |
| 일부 표본만 산출 | "평균 42분 · 표본 18 / 대상 25 (7건 시각 미상)" | 분모 생략 |
| 관측 범위 밖 기간 | "이 기간에는 {활동} 기록이 체계화되지 않았다" | 빈 타임라인을 "이력 없음"으로 |
| 사례 귀속 없는 과거 행 | 타임라인엔 표시, 방문별 묶음에선 "방문 미지정" 묶음 | 가장 가까운 방문에 추정 귀속 |
| 상태–사건 불일치 | 관제 카드에 "여정 기록 누락" 표식(운영자용) | 자동으로 사건을 만들어 메움 |
| 종료 사건 없음 + 도메인은 종결 | "종료 기록 없음" | "진행 중" 또는 "완료"로 단정 |
| 조회 실패 | `QueryErrorFallback` | `.catch(() => [])` 로 빈 타임라인 |
| 로딩 중 | 로딩 | "확인 불가" |

환자 포털: 발생 시각을 아는 사건만 시각을 보이고, 모르면 날짜 단위 또는 "기록일"로(문구는 §7-D3).

### 5.8 트랙별 상태기계 — 방문 단위마다 "시작·끝·열림"을 정의한다

> 원칙: **상태의 정본은 도메인 테이블**이고 여정은 전이의 이력이다(openEHR 사건/에피소드 구분 · FHIR Encounter.status vs statusHistory). 각 트랙에 대해 아래를 고정한다. 종료 사건 후보가 둘 이상인 곳은 사람 결정으로 넘긴다.

**T1 외래(방문 단위 = `WaitingQueue` 1건, 진료 기록 `Encounter` 는 `focus` 객체)**

```
(예약 Appointment ─plannedAt─▶) CHECKIN ─▶ CALLED ─▶ CONSULTATION.STARTED ─▶ CONSULTATION.COMPLETED ─▶ [수납·조제·종료]
                                  │          │               │
                                  └─CANCELLED / NO_SHOW(되돌리기 = REVISED)
```

| 전이 | 현행 eventType | 발생 시각 원천 | 종결? |
|---|---|---|---|
| 접수 | `RECEPTION_CHECKIN` | `WaitingQueue.checkedInAt` | |
| 호출 | `RECEPTION_CALLED` | `WaitingQueue.calledAt` | |
| 진료 시작 | `ENCOUNTER_START` | `WaitingQueue.startedAt`(접수 경로). 직접 생성 경로는 원천이 `Encounter.createdAt` 뿐이다 → `SAME_AS_RECORDED` | |
| 진료 종료 | (없음) | `WaitingQueue.completedAt` — 🔴 이 값이 "진료 종료"인지 "외래 전체 종료"인지 도메인 정의부터 필요 | §7-D8 |
| 기록 완료 | `ENCOUNTER_SIGNED` | `Encounter.signedAt` | **종결 아님**(기록 활동) |
| 취소·미방문 | (여정 없음) | 대기열 상태 | 종결(결말 = 취소) |

- 열림 판정: 접수 사건이 있고, 같은 방문 단위의 종결 사건이 없으면 열림. **종결 사건이 정의되기 전까지는 "외래 열림" 지표를 내지 않는다**(정의 없는 열림 수는 거짓 경보다).
- 동시성: 같은 날 다른 과 접수 2건 = 방문 단위 2개. 같은 과 재접수(되돌리기 EP)는 같은 방문 단위의 `REVISED`.

**T2 응급(방문 단위 = `EmergencyVisit`)**

```
ARRIVAL ─▶ TRIAGE ─▶ TREATMENT.STARTED ─▶ DISPOSITION.DECIDED(→REVISED*) ─▶ DEPARTURE
                                               └─ 입원이면 T3 시작(precededBy)
```

| 전이 | 현행 | 발생 시각 원천 | 비고 |
|---|---|---|---|
| 도착 | `ER_ARRIVAL` | `EmergencyVisit.arrivalAt`(입력값이면 `USER_CLAIMED`) | |
| 트리아지 | `ER_TRIAGE` | `triagedAt` | 도착과 같은 요청이면 둘의 기록 시각이 같다 → 순서는 발생 시각으로 |
| 진료 시작 | `ER_TREATMENT_START` | `treatmentStartedAt` | |
| 처분 결정 | `ER_DISPOSITION`(최초·변경 혼재) | `dispositionAt` | 변경은 `REVISED` |
| 퇴실 | `ER_CHECKOUT` | 🔴 **원천 없음**(§4.14) | §7-D9 |
| 병상 배정·이동·해제 | `ER_BED_*` | `EmergencyBedAssignment.assignedAt/releasedAt` | `location` 객체 사건 — 방문 단위의 하위 |

- 종결: 퇴실 사건 하나. 처분 결정은 **종결이 아니다**(결정≠퇴실 — ER 베드 보드 규약과 같다).
- 응급→입원: T2 는 퇴실로 닫히고 T3 가 `precededBy=EmergencyVisit` 로 열린다. 한 방문으로 볼지는 §7-D2.

**T3 입원(방문 단위 = `Admission`)**

```
ADMISSION.STARTED ─▶ (BED_TRANSFER* · TRANSFER_CARE* · 수술 T4 partOf) ─▶ ADMISSION.COMPLETED(outcome)
        └─ CANCELLED(입원 취소)
```

- 종결: `DISCHARGE` 하나. 결말(`outcome`)은 퇴원·전원·사망·자의퇴원으로 나눈다. 현행은 제목('퇴원'/'전원')에만 있어, 과거 행은 제목 패턴이 확정되는 것만 파생하고 나머지는 `UNKNOWN`.
- `DISCHARGE_PLANNED`(관제)는 사건이 아니라 **상태 추정**이다(§2.6). 사건으로 바꾸려면 "퇴원 결정" 행위가 도메인에 있어야 한다. 없으면 관제 단계 이름을 "퇴원요약 작성됨"으로 정직하게 바꾼다.

**T4 수술·회복(방문 단위 = `Surgery`, 상위 `partOf` = 입원 또는 외래)**

```
SCHEDULED(plannedAt) ─▶ OR_STAY.STARTED ─▶ (SURGICAL_PROCEDURE: incision ─▶ closure) ─▶ OR_STAY.COMPLETED ─▶ PACU_STAY.STARTED ─▶ PACU_STAY.COMPLETED(destination)
```

- 종결: PACU 퇴실(회복실을 거치면) 또는 수술 완료(거치지 않으면). PACU 퇴실의 목적지(병상·전실·ICU·귀가)는 `outcome`.

**T5 검진(방문 단위 = `CheckupVisit`)**

`RESERVED(plannedAt) → CHECKIN → STATION.ARRIVE/COMPLETE* → COMPLETE(판정 서명) | CANCELLED`
- 스테이션 사건은 `focus=CheckupStationLog`, 종합판정은 `focus=CheckupSummary` 이고, 방문 단위는 모두 같은 `CheckupVisit`(§2.9③).

**T6 비방문 흐름(방문 단위 없음 — `subject` 만)**

동의서 · VOC · 환자 메시지 · 만성 경보 · 진단검사 상태 · CSSD 회수 · 암등록 후보 · MDT.
이들은 **방문에 묶일 수도, 안 묶일 수도 있다.** I3(사례 귀속 필수)의 대상이 아니다. 대신 `focus` 객체는 필수다(동의서 = `ConsentForm`).

### 5.9 사건 카탈로그 전수(현행 63종 → 활동·전이·객체·시각 원천)

> 범례: **E** = 방문 단위(episode) 객체 · **F** = focus 객체 · 시각 원천 `SR` = 기록 시각과 같다고 간주(즉시 행위) · 가시성 = 현행 환자 포털 노출(●보임 · ○숨김). "현행 ref" 는 발행 지점 코드 기준이다(§2.9③ 정정 반영).

| 현행 eventType | 발행 지점 | 현행 ref | activity · transition | E / F | 발생 시각 원천 | 가시성 |
|---|---|---|---|---|---|---|
| `RECEPTION_CHECKIN` | waiting-queue.service.ts:190 | WAITING_QUEUE | OUTPATIENT_VISIT · STARTED | E=WaitingQueue | checkedInAt | ● |
| `RECEPTION_CALLED` | waiting-queue.service.ts:408 | WAITING_QUEUE | OUTPATIENT_CALL · COMPLETED | E=WaitingQueue | calledAt | ● |
| `ENCOUNTER_START` | waiting-queue.service.ts:469 · encounter.service.ts:194 | ENCOUNTER · **없음** | CONSULTATION · STARTED | E=WaitingQueue(직접 생성은 없음→"방문 미지정") / F=Encounter | WaitingQueue.startedAt · 직접 생성은 SR | ● |
| `ENCOUNTER_SIGNED` | encounter.service.ts:390 | **없음** | CONSULT_NOTE · COMPLETED | E=WaitingQueue 또는 Admission / F=Encounter | Encounter.signedAt | ● |
| `ENCOUNTER_AMENDED` | encounter.service.ts:312 | **없음** | CONSULT_NOTE · REVISED | 〃 | SR | ● |
| `APPOINTMENT_BOOKED` | schedule.service.ts:146 | Appointment | APPOINTMENT · SCHEDULED | F=Appointment (plannedAt=scheduledAt) | SR | ● |
| `PRESCRIPTION_ADDED` | journey.listener.ts:47 | Order | MEDICATION_ORDER · REQUESTED | E=Encounter의 방문 / F=Order | Order.createdAt(=SR) | ● |
| `ORDER_CREATED` | journey.listener.ts:47 | Order | ORDER · REQUESTED | 〃 | SR | ● |
| `ORDER_COMPLETED` | journey.listener.ts:100 | Order | ORDER · COMPLETED(치료) | 〃 | 오더 완료 시각 | ● |
| `LAB_RESULT` | lab.service.ts:410 | LabResult | LAB_RESULT · COMPLETED | F=LabResult | verifiedAt ? completedAt (§4.15) | ● |
| `IMAGING_RESULT` | imaging.service.ts:231 | ImagingResult | IMAGING_REPORT · COMPLETED | F=ImagingResult | reportedAt | ● |
| `DISPENSED` | journey.listener.ts:63 | Dispensing | DISPENSING · COMPLETED | F=Dispensing | dispensedAt | ● |
| `MEDICATION_ADMINISTERED` | nursing.service.ts:1511 | MedicationAdministration | MED_ADMIN · COMPLETED | E=Admission / F=MedicationAdministration | administeredAt | ● |
| `TRANSFUSION_COMPLETED` | blood-bank.service.ts:578 | BloodTransfusion | TRANSFUSION · COMPLETED | F=BloodTransfusion | 수혈 종료 시각 | ● |
| `CANCER_REGISTRY_CANDIDATE` | pathology.service.ts:220 (직접 쓰기) | PATHOLOGY_REPORT | CANCER_REGISTRY_SCREEN · COMPLETED | F=PathologyReport | SR | ○ |
| `MDT_DECISION` | mdt.service.ts:274 (직접 쓰기) | MDT_CASE | MDT · COMPLETED | F=MdtCase | 회의 시각 | ○ |
| `PROTOCOL_STEP` | protocol.service.ts:566 | protocol | PROTOCOL_STEP · COMPLETED(+SKIPPED·BLOCKED 신설) | F=ProtocolInstance | SR | ○ |
| `BILLING_CREATED` | journey.listener.ts:122 | Billing | BILLING · REQUESTED | E=방문 / F=Billing | SR | ● |
| `BILLING_PAID` | billing.service.ts:1774 (직접 쓰기) | **없음** | BILLING · COMPLETED | F=Billing | paidAt | ● |
| `BILLING_AMEND_REVIEW` | billing.listener.ts:52 (직접) | ENCOUNTER | BILLING_REVIEW · REQUESTED | F=Encounter | SR | ○ |
| `BILLING_CREATE_FAILED` | billing.listener.ts:76 (직접) | ENCOUNTER | BILLING · FAILED | F=Encounter | SR | ○ |
| `CLAIM_REVIEW` | claim.service.ts:319 (직접) | CLAIM | CLAIM_REVIEW · COMPLETED | F=Claim | SR | ○ |
| `ER_ARRIVAL` | emergency.service.ts:263 | **없음** | ER_VISIT · STARTED | E=EmergencyVisit | arrivalAt (USER_CLAIMED 가능) | ● |
| `ER_TRIAGE` | emergency.service.ts:269 | **없음** | ER_TRIAGE · COMPLETED | E=EmergencyVisit | triagedAt | ● |
| `ER_TREATMENT_START` | emergency.service.ts:104 | EmergencyVisit | ER_TREATMENT · STARTED | E=EmergencyVisit | treatmentStartedAt | ● |
| `ER_DISPOSITION` | emergency.service.ts:396 · 820 | **없음** | ER_DISPOSITION_DECISION · COMPLETED(396) / REVISED(820) | E=EmergencyVisit | dispositionAt | ● |
| `ER_CHECKOUT` | emergency.service.ts:847 | **없음** | ER_VISIT · COMPLETED | E=EmergencyVisit | 🔴 원천 없음(§4.14) | ● |
| `ER_BILLING_FAILED` | emergency.service.ts:184 | 없음 | BILLING · FAILED | E=EmergencyVisit | SR | ○ |
| `ER_BED_ASSIGNED`·`MOVED`·`RELEASED` | er-bed.service.ts:392·431·455 | **없음** | ER_BED_OCCUPANCY · STARTED / REVISED / COMPLETED | E=EmergencyVisit / location=ErBed | assignedAt / releasedAt | ○ |
| `GOLDEN_PATHWAY_ACTIVATED` | emergency-pathway.service.ts:75 | 없음 | EMERGENCY_PATHWAY · STARTED | E=EmergencyVisit | SR | ○ |
| `ADMISSION` | admission.service.ts:72 · inpatient.service.ts:70 · bed-transfer.service.ts:120 · pacu.service.ts:792 | ADMISSION | INPATIENT_STAY · STARTED | E=Admission | admitDate | ● |
| `ADMISSION_CANCELLED` | inpatient.service.ts:302 | **없음** | INPATIENT_STAY · CANCELLED | E=Admission | SR | ● |
| `BED_TRANSFER` | inpatient.service.ts:316 · bed-transfer.service.ts:119 · pacu.service.ts:789 | ADMISSION | WARD_BED_OCCUPANCY · REVISED | E=Admission / location=Bed | BedAssignment.assignedAt | ● |
| `TRANSFER_CARE` | admission.service.ts:116 | CHARGE_OF_CARE | ATTENDING · REVISED | E=Admission / F=ChargeOfCare | ChargeOfCare.assignedAt | ● |
| `DISCHARGE` | inpatient.service.ts:180 | **없음** | INPATIENT_STAY · COMPLETED (outcome) | E=Admission | dischargeDate | ● |
| `SURGERY_START` | surgery.service.ts:298 | **없음** | OR_STAY · STARTED | E=Surgery (partOf 입원) | Surgery.startedAt | ● |
| `SURGERY_COMPLETE` | surgery.service.ts:351 | SURGERY | OR_STAY · COMPLETED | E=Surgery | Surgery.endedAt | ● |
| `PACU_ADMISSION` | pacu.service.ts:314 | PACU | PACU_STAY · STARTED | E=Surgery / F=PacuRecord | arrivalTime | ● |
| `PACU_DISCHARGE` | pacu.service.ts:796 | PACU | PACU_STAY · COMPLETED (outcome=목적지) | E=Surgery / F=PacuRecord | dischargeTime | ● |
| `NEWBORN_CRITICAL` | obgyn.service.ts:285 | 없음 | NEWBORN_ALERT · COMPLETED | E=Admission(산모) | SR | ○ |
| `CONSENT_REQUESTED` | notification.listener.ts:713 (직접) | 없음 | CONSENT · REQUESTED | F=ConsentForm | SR | ● |
| `CONSENT_SIGNED` | notification.listener.ts:753 · portal.service.ts:965 (직접) | 없음 | CONSENT · (businessStatus=SIGNED_BY_PATIENT) | F=ConsentForm | patientSignedAt | ● |
| `CONSENT_COMPLETED` | notification.listener.ts:771 (직접) | 없음 | CONSENT · COMPLETED | F=ConsentForm | signedAt | ● |
| `CONSENT_REVOKED` | journey.listener.ts:136 | ConsentForm | CONSENT · REVOKED | F=ConsentForm | revokedAt | ● |
| `CHECKUP_RESERVED` | checkup.service.ts:319 · 389 | CheckupVisit | CHECKUP_VISIT · SCHEDULED | E=CheckupVisit (plannedAt=scheduledDate) | SR | ● |
| `CHECKUP_CHECKIN` | checkup.service.ts:646 | CheckupVisit | CHECKUP_VISIT · STARTED | E=CheckupVisit | checkedInAt | ● |
| `CHECKUP_STATION_ARRIVE`·`COMPLETE` | checkup-station.service.ts:95 · 201 | CheckupStationLog | CHECKUP_STATION · STARTED / COMPLETED | E=CheckupVisit / F=CheckupStationLog | arrivedAt / completedAt | ● |
| `CHECKUP_CRITICAL` | checkup-station.service.ts:214 | CheckupStationLog | CHECKUP_ALERT · COMPLETED | E=CheckupVisit | SR | ○ |
| `CHECKUP_COMPLETE` | checkup.service.ts:1525 | CheckupSummary | CHECKUP_VISIT · COMPLETED | E=CheckupVisit / F=CheckupSummary | CheckupVisit.completedAt | ● |
| `CHECKUP_CANCELLED` | checkup.service.ts:1692 | CheckupVisit | CHECKUP_VISIT · CANCELLED | E=CheckupVisit | SR | ● |
| `CHRONIC_ALERT` | chronic.service.ts:115 | chronic | CHRONIC_ALERT · COMPLETED | (방문 없음) | 측정 시각 | ○ |
| `CSSD_RECALL` | cssd-package.service.ts:387 | 없음 | DEVICE_RECALL_TRACE · COMPLETED | F=SterilePackage | SR | ○ |
| `voc.received`·`answered`·`closed` | voc.service.ts:150 · voc-admin.service.ts:172·185 | VocTicket | VOC · REQUESTED / REVISED / COMPLETED | F=VocTicket | SR | ● |
| `PATIENT_MESSAGE_SENT`·`REPLIED` | patient-message.listener.ts:32 · patient-message.service.ts:179 | PatientMessage | PATIENT_MESSAGE · REQUESTED / COMPLETED | F=PatientMessage | SR | ● |
| `DIAGNOSTIC_CANCELLED`·`ON_HOLD`·`RESUMED` | diagnostic-test.service.ts:328 | diagnostic_test | DIAGNOSTIC_TEST · CANCELLED / SUSPENDED / RESUMED | F=DiagnosticTest | SR | ○ |

검토에서 드러난 것:
- 응급 관련 10종(`ER_*`·`GOLDEN_PATHWAY_ACTIVATED`) 중 **9종**이 refId 없이 발행된다(있는 것은 `ER_TREATMENT_START` 하나). 입원 관련 6종 중 3종(`ADMISSION_CANCELLED`·`DISCHARGE`·`NEWBORN_CRITICAL`)도 없다.
- 직접 쓰기 9종(카탈로그의 "(직접)")은 정본 발행기를 우회한다. 이관 단위는 파일이 아니라 **이 9개 사건 유형**으로 센다(P0-6).
- `PRESCRIPTION_ADDED` 와 `ORDER_CREATED` 는 같은 발행 지점(리스너 삼항)이 오더 종류로 갈라 낸다. 활동은 하나(ORDER)이고 종류는 속성(`orderKind`)으로 두는 것이 문헌(활동=무엇·속성=어떤 것)에 맞다.

### 5.10 지표 정의서 — 이름·모집단·끝점·분모를 고정한다

> 각 지표는 **하나의 정의**만 갖는다. 정의가 둘 이상 필요하면 이름을 둘로 나눈다(같은 이름에 두 값 금지 — §7-D2 (c) 의 경고). 모든 지표는 `{ value | null, n, excluded: { reason: count }, definitionVersion }` 으로 낸다.

| 지표 | 모집단(사례) | 시작 → 끝 | 제외(제외 수를 낸다) | null 규칙 | 현행 구현 | 차이 |
|---|---|---|---|---|---|---|
| 외래 접수→호출 | 기간 안 접수된 `WaitingQueue`(취소·미방문 제외) | checkedInAt → calledAt | 호출 없음 · 시각 역전 | 표본 0 → null | getMetrics(외래 대기) | 정의 같음 — 유지 |
| 외래 접수→진료 시작 | 〃 | checkedInAt → startedAt | 진료 없음 | 〃 | 관제 흐름 분석 | 여정 원장 기준으로 옮기지 않는다(도메인이 정본) |
| 외래 체류 | 〃 | checkedInAt → **외래 종료**(§7-D8) | 종료 사건 정의 전 | 정의 전 **지표 미제공** | 없음 | 신설 보류 |
| 응급 도착→트리아지 | 기간 안 도착 `EmergencyVisit` | arrivalAt → triagedAt | 트리아지 없음 | 〃 | flow-canon(KTAS 목표) | 유지 |
| 응급 도착→진료(door-to-doctor) | 〃 | arrivalAt → treatmentStartedAt | 진료 없음 | 〃 | 관제 | 유지 |
| **응급 체류(ED LOS)** | 〃 · 퇴실한 방문만 | arrivalAt → **departedAt**(§4.14·§7-D9) | 퇴실 시각 미상 · USER_CLAIMED 도착(§7-D7) | **원천 생기기 전 null** | getMetrics(입원 기간 대용) · 보고서(처분까지) | 🔴 둘 다 다른 것을 잰다 → P0-1·P0-2·P0-3 |
| 응급 처분→퇴실(boarding) | 처분 있고 퇴실한 방문 | dispositionAt → departedAt | 〃 | 〃 | 없음 | 원천 생긴 뒤 |
| 재원일수(LOS) | 기간 안 퇴원한 `Admission`(취소 제외) | admitDate → dischargeDate | — | 표본 0 → null | getMetrics(0 폴백) | 🔴 P0-1 · 계산은 정본 `stayDays`(수치 정책 잠금 도메인) |
| 입원→수술 | 입원 중 수술(`Surgery partOf Admission`) | admitDate → 수술 시작(§7-D10) | 입원 전 수술 | 〃 | 보고서(첫 사건 짝짓기) | 🔴 사례 귀속으로 바꾼다(P1-4) |
| 수술 시간 | `Surgery` 완료건 | §7-D10 (startedAt→endedAt 또는 incisionTime→closureTime) | 시각 누락 | 〃 | 보고서(여정 기록 시각) | 🔴 기록 시각이 아니라 도메인 시각 |
| PACU 체류 | `PacuRecord` 퇴실건 | arrivalTime → dischargeTime | — | 〃 | PACU 화면 | 유지(도메인) |
| 30일 재입원율 | 기간 안 퇴원(사망·전원 제외 여부 §7-D11) | 퇴원 → 30일 안 재입원 | 계획 재입원(§7-D11) | 분모 0 → null | getMetrics(0 폴백·N+1) | 🔴 P0-1 · 정의 결정 |
| 검진 체류 | `CheckupVisit` 완료건 | checkedInAt → completedAt | — | 〃 | 검진 화면 | 유지 |

- **여정 원장은 지표의 정본이 아니다**(제안). 시각의 정본은 도메인 필드다. 여정 원장은 ① 타임라인 ② 사례 간 연결(전환·partOf) ③ 프로세스 마이닝 반출의 원천이다. 지표가 여정 원장을 쓰려면 P1 이후 `occurred_at` 이 도메인 값과 같아야 한다(대조 Q3).
- 표본 하한: 표본이 작은 지표(예: 한 주 응급 퇴실 3건)는 값을 내되 `n` 을 함께 보인다. 표본 하한으로 숨길지는 지표마다 정하지 않는다 — 감시자 운영 지표의 "표본 0 = 산출 불가"와 같은 규약만 쓴다.

### 5.11 검증 시나리오(픽스처) — 문헌이 지적한 결함을 재현하는 사례

| # | 시나리오 | 기대(제안 모델) | 현행이 틀리는 지점 |
|---|---|---|---|
| S1 | 같은 환자가 같은 날 응급실을 두 번 방문(09시 도착→11시 퇴실 · 20시 도착→23시 퇴실) | 방문 2개 · ED LOS 120분·180분 | 보고서 `firstInterval` 이 첫 도착과 아무 퇴실을 잇는다(발산) |
| S2 | 30분 전 도착을 지금 등록 | occurredAt=30분 전(USER_CLAIMED) · recordedAt=지금 | 여정은 도착=지금, ED LOS 30분 짧음 |
| S3 | 응급 → 처분(입원) → 처분 변경(전원) → 퇴실 | 처분 COMPLETED 1 + REVISED 1 · 종결 1 | `ER_DISPOSITION` 2건 = "처분 2회"로 계수 |
| S4 | 응급 → 입원 → 수술 → PACU → ICU → 병동 → 퇴원 | 방문 단위: EmergencyVisit →(precededBy) Admission ⊃(partOf) Surgery · PACU 결말=ICU · 전실 2 | 사건이 환자에 평탄화되어 관계 소실 |
| S5 | 입원 취소 | INPATIENT_STAY · CANCELLED · 재원일수 모집단에서 제외 | refId 없음 — 어느 입원의 취소인지 원장만으론 모름 |
| S6 | 외래 진료 중 같은 날 다른 과 접수 | 방문 2개 동시 열림 | 구분 불가 |
| S7 | 발행 실패(DB 일시 오류) | 실패 1건이 완결성 분모에 잡힘 · 감시자 I5 불일치 1 | warn 로그만 — 0 건으로 보임 |
| S8 | 데모 시나리오 실행(리허설 모드) | `data_origin=DEMO` · 지표 제외 수에 표시 | 실제 사건과 구분 불가 |
| S9 | 간호사가 2시간 늦게 투약 기록 | occurredAt=투약 시각(administeredAt) · 늦은 기록 표식 | 여정 시각=기록 시각 |
| S10 | 장기 재원 환자 사건 250건 | 직원 타임라인 최신 200 + `truncated: true` + 커서 | 오래된 200 만 보이고 최근이 사라짐(§4.13) |
| S11 | 결과 3건이 같은 밀리초에 확정 | 3건 모두 보존(멱등 키가 서로 다름) | 중복과 구분 불가 |
| S12 | 표본 0 기간의 응급 체류 | `{value:null, n:0}` · 화면 "산출 불가" | 0시간 |

**재주입 규칙:** 각 시나리오의 가드는 결함을 되돌렸을 때 실패해야 한다. 예를 들어 S1 은 방문 귀속을 빼면, S12 는 0 폴백을 되살리면, S10 은 asc 로 되돌리면 실패해야 한다.

### 5.12 감시자 불변식 초안(SQL — 읽기 전용, 수를 센다)

> 감시자 데이터 정합성 축(`infra/scripts/data-integrity-scan.sql`)에 추가할 후보다. **자동 교정은 하지 않는다.** 아래 SQL 은 스키마 v2(§5.4) 기준 초안이며, 적용 전에 실제 컬럼명으로 대조한다.

```sql
-- Q1 (I3) 방문 단위 트랙 사건인데 episode 관계가 없는 신규 행
SELECT e.event_type, count(*) FROM patient_journey_events e
WHERE e.activity IN ('ER_VISIT','ER_TRIAGE','ER_TREATMENT','ER_DISPOSITION_DECISION','INPATIENT_STAY','OR_STAY','PACU_STAY','OUTPATIENT_VISIT','CHECKUP_VISIT')
  AND e.recorded_at >= :p1_cutover
  AND NOT EXISTS (SELECT 1 FROM patient_journey_event_objects o WHERE o.event_id = e.id AND o.qualifier = 'episode')
GROUP BY 1;

-- Q2 (I5) 상태–사건 대조: 진료 시작 시각이 있는데 진료 시작 사건이 없는 응급 방문
SELECT count(*) FROM emergency_visits v
WHERE v.treatment_started_at IS NOT NULL AND v.treatment_started_at >= :observed_since_er_treatment
  AND NOT EXISTS (SELECT 1 FROM patient_journey_event_objects o JOIN patient_journey_events e ON e.id = o.event_id
                  WHERE o.object_type = 'EmergencyVisit' AND o.object_id = v.id AND e.activity = 'ER_TREATMENT' AND e.transition = 'STARTED');

-- Q3 발생 시각 ≠ 도메인 시각(원천이 DOMAIN_FIELD 인데 값이 다름 — 발행 버그)
SELECT count(*) FROM patient_journey_events e JOIN patient_journey_event_objects o ON o.event_id = e.id AND o.object_type = 'EmergencyVisit'
JOIN emergency_visits v ON v.id = o.object_id
WHERE e.activity = 'ER_VISIT' AND e.transition = 'STARTED' AND e.occurred_at_source IN ('DOMAIN_FIELD','USER_CLAIMED')
  AND e.occurred_at IS DISTINCT FROM v.arrival_at;

-- Q4 중복 의심(과거 행 포함 — 지우지 않는다)
SELECT count(*) FROM (SELECT patient_id, event_type, event_at FROM patient_journey_events GROUP BY 1,2,3 HAVING count(*) > 1) x;

-- Q5 어휘 밖 저장값
SELECT event_type, count(*) FROM patient_journey_events WHERE event_type <> ALL(:journey_event_types) GROUP BY 1;

-- Q6 (I6) 종결 사건이 둘 이상인 방문 단위(정정 제외)
SELECT o.object_type, count(*) FROM patient_journey_event_objects o JOIN patient_journey_events e ON e.id = o.event_id
WHERE o.qualifier = 'episode' AND e.transition = 'COMPLETED' AND e.activity IN ('ER_VISIT','INPATIENT_STAY','CHECKUP_VISIT')
  AND e.supersedes_id IS NULL
GROUP BY o.object_type, o.object_id HAVING count(*) > 1;
```

- 각 질의는 **관측 범위(`observedSince`) 이후**만 센다. 그 전의 부재는 결함이 아니라 "기록 범위 밖"이다.
- 판정 원장(`sentinel_judgments`)에 올리는 단위는 불변식 번호다. 판정 이후 증가는 "재판정 필요"로 되돌린다(감시자 규약).

### 5.13 데이터 품질 점검표 — Bose 등 범주와 이 원장의 대응

> 범주명은 Bose·Mans·van der Aalst(2013) 초록에서 확인한 큰 묶음(시각·활동 이름·누락·중복·사례)만 썼다. 27개 세부 범주 원문은 미확인이다(§8 S5 [초록]).

| 품질 문제 | 이 원장의 사례 | 측정 | 처방 단계 |
|---|---|---|---|
| 부정확한 시각 | 발생=기록 강제(§2.4) · 롤포워드가 `event_at` 재작성(§2.9① 83%) | `created_at`≠`event_at` 비율 · Q3 | P1 |
| 시각 정밀도 | 날짜만 아는 사건(예약일·검진 예정일) | `occurred_at_precision` 분포 | P1 |
| 동시각 순서 | 도착·트리아지 같은 밀리초(§2.4) | 같은 방문 단위·같은 시각 쌍 수 | P1-6 |
| 활동 이름 중의 | `ER_DISPOSITION`(최초/변경) · `DISCHARGE`(퇴원/전원) | 제목 패턴별 계수 | P2 |
| 활동 이름 동의 | `PRESCRIPTION_ADDED`·`ORDER_CREATED` · `ATTENDING_CHANGE`↔`TRANSFER_CARE` | 별칭표 | P2(매핑) |
| 어휘 이탈 | `ROUND` 15행 | Q5 | P0(감시만) |
| 누락 사건 | 발행 실패 warn · 직접 쓰기 실패 삼킴 · 상태 변경만 하는 경로 | 실패 계수 · Q2 | P0·P2 |
| 중복 사건 | 같은 밀리초 299묶음 | Q4 | P2(멱등 키) |
| 사례 귀속 누락 | §2.9② | Q1 · 유형별 refId 없음 비율 | P0-5·P1-4 |
| 출처 혼재 | 데모·시드·실제 | `data_origin` 분포 | P1(§7-D12) |

---

## 6. 단계별 실행안

원칙: **추가 전용**(컬럼·테이블 추가, 기존 행 수정 없음) · 과거 행 소급 없음(필요 시 별도 사람 결정) · 각 단계는 가드 재주입으로 검증 · 배포는 `migrate diff` 미리보기 후 해당 SQL 만(CLAUDE.md 배포 규칙).

### P0 — 지금 거짓을 말하는 곳 봉합 (스키마 변경 없음)

| # | 작업 | 검증 |
|---|---|---|
| P0-1 | `getMetrics` 응급 체류·재원일수·재입원율 → `{value:null, n}` · 화면 "산출 불가"(외래 대기와 같은 규약) | 표본 0 픽스처 → null. **재주입**: 0 폴백 되돌리면 실패 |
| P0-2 | 응급 체류 정의를 `EmergencyVisit.arrivalAt → 퇴실`로 교체(퇴실 시각 원천 확인 선행 — 현재 `checkout()` 은 상태만 바꾸고 시각 필드를 안 남긴다(`emergency.service.ts:844`) → **퇴실 시각 정본이 없으면 산출 불가로 둔다**). `admitReason` 문자열 판정 제거 | 같은 기간 관제 분석(`journey-analytics`)과 수치 대조 |
| P0-3 | 기간 보고서 `erStayMinutes` 끝점에서 `ER_DISPOSITION` 제거(결정≠퇴실) | 처분만 있고 퇴실 없는 픽스처 → null |
| P0-4 | `getTimeline`·`getMetrics` 날짜 경계 → `dayRange` | KST 00:30 사건이 그날에 포함 · 재주입 |
| P0-5 | refId 누락 발행 보강: `ER_ARRIVAL`·`ER_TRIAGE`·`ER_DISPOSITION`·`ER_CHECKOUT`→`EmergencyVisit` · `DISCHARGE`·`ADMISSION_CANCELLED`→`ADMISSION` · `BILLING_PAID`→`Billing` · 포털 `CONSENT_SIGNED`→`ConsentForm` | 가드: 방문 단위 트랙 유형은 refId 리터럴 필수(정규식이 아니라 AST/블록 단위 — 재주입 함정 §재주입) |
| P0-6 | 직접 쓰기 9파일 → 정본 발행기 경유(데모 시나리오 제외 시 사유 명시) · 구조 가드 `patientJourneyEvent.create` 는 journey 모듈만 | 가드 재주입: 한 곳에 직접 create 를 되살리면 실패 |
| P0-7 | 포털 `CONSENT_SIGNED` 의 `.catch(() => {})` → warn 기록(판정 규칙 §부분실패) | |
| P0-8 | 직원 타임라인 최신순·커서(`<eventAt>` + `<id>` 복합 키)·`truncated`(§4.13) | 250건 픽스처(S10) — asc 로 되돌리면 실패 |
| P0-9 | 감시자 Q4(중복 의심)·Q5(어휘 밖 저장값) 추가 — 수만 센다 | 표본을 일부러 남긴 픽스처(`ROUND` 1행) |
| P0-10 | refId 보강 범위 정정: 초안 표에 빠진 `SURGERY_START`·`ENCOUNTER_START`(직접 생성)·`ENCOUNTER_SIGNED/AMENDED`·`ER_BED_*`·`GOLDEN_PATHWAY_ACTIVATED`·`NEWBORN_CRITICAL` 포함(§2.9③·§5.9) | 카탈로그 표의 "없음" 전부 가드 대상 |

#### P0 구현 결과(2026-10-01)

| # | 결과 | 비고 |
|---|---|---|
| P0-1 | `getMetrics` 응급 체류·재원일수·재입원율 → 표본 0 이면 `null` + 표본 수(`erVisitSampleN`·`admissionSampleN`·`dischargeSampleN`) · 화면은 "산출 불가"와 표본 각주 | 재원일수 계산식(일 단위 소수 평균)은 그대로 두었다. 정본 `stayDays`(잠금 도메인)로 바꾸는 것은 값이 바뀌는 정의 변경이라 P1 지표 정의서 확정 때 함께 한다 |
| P0-2 | 응급 체류 = 응급 방문 도착→퇴실. 퇴실 시각 정본이 없으므로 **항상 `null`** + `erStayUnavailableReason: NO_DEPARTURE_TIME_SOURCE`. `admitReason` 'ER' 문자열로 입원을 고르던 질의는 삭제 | §7-D9 결정 전까지 산출 불가 |
| P0-3 | 보고서 응급 체류 끝점은 `ER_CHECKOUT` 만(처분 제외) · 양 끝이 원 기록을 가지면 **같은 원 기록끼리만** 짝짓는다 | 과거 행(포인터 없음)은 종전 규칙. 추정 귀속은 하지 않는다 |
| P0-4 | `getTimeline`·`getMetrics` 날짜 경계를 `dayRange`(KST)로 | |
| P0-5·P0-10 | refType·refId 보강: 응급 9종·`DISCHARGE`·`ADMISSION_CANCELLED`·`SURGERY_START`·`ENCOUNTER_START`(직접 생성)·`ENCOUNTER_SIGNED/AMENDED`·`BILLING_PAID`·동의서 4종·`NEWBORN_CRITICAL`(`DeliveryRecord`)·`CSSD_RECALL`(사용 진료)·`GOLDEN_PATHWAY_ACTIVATED`(방문이 있을 때만) | 가드 `journey-p0-guards.spec.ts`. refType 표기는 객체마다 기존에 쓰던 문자열을 그대로 써서 읽는 쪽이 갈라지지 않게 했다. 표기 통일은 P1 객체 관계표에서 한다 |
| P0-6·P0-7 | 직접 쓰기 7파일 10곳을 정본 발행기(`JourneyService.emit`)로 이관(포털 `.catch(() => {})` 삼킴 포함). 남은 직접 쓰기는 데모 시나리오(`patient-auth`, REAL 차단)뿐 | 구조 가드 |
| P0-8 | 직원 타임라인: **최신 N건**(기본 200·최대 500)을 시간순으로 · `meta.truncated`·`olderCursor` · `before=<ISO>\|<id>` 커서 · 환자 여정 탭 "이전 기록 더 보기" · 여정 대시보드 잘림 고지 · 대시보드가 서버에 없는 `timestamp`·`summary` 를 읽어 **제목이 늘 '-'** 이던 것도 `eventAt`·`title` 로 | |
| P0-9 | 감시자 불변식 75(같은 환자·유형·밀리초 묶음)·76(어휘 밖 저장값 — 목록은 shared 어휘와 기계 대조) | 수만 센다 · 운영 시드 기준 299·15 예상 |

### P1 — 시각 이중화와 사례 관계 (추가 스키마)

| # | 작업 | 검증 |
|---|---|---|
| P1-1 | 컬럼 추가 `recorded_at`·`occurred_at`·`occurred_at_source`·`occurred_at_precision`·`emitter` · 과거 행: `recorded_at=event_at`, `occurred_at=null`, 출처 `UNKNOWN`(소급 백필은 §7-D1) | 마이그레이션 미리보기 · 과거 행 수 불변 |
| P1-2 | `journey.record()` 신설 — `occurredAt`·`occurredAtSource` 필수 인자 · `emit()` 은 `SAME_AS_RECORDED` 로 위임(호환) | 타입: 출처 미지정 컴파일 실패 |
| P1-3 | 발생 시각을 아는 발행 지점부터 전환: 응급 도착(`arrivalAt`, 주장이면 `USER_CLAIMED`) · 트리아지(`triagedAt`) · 입원(`admitDate`) · 수술(`startedAt/endedAt`) · 검사 결과 확정 시각 | 픽스처: 30분 전 도착 → occurredAt 이 30분 전 · recordedAt 은 지금 |
| P1-4 | `patient_journey_event_objects` + `object_type` shared 어휘(표기 1종) · 신규 발행은 episode 관계 필수(방문 단위 트랙) | 불변식 I3 가드 · 같은 날 응급 2회 픽스처에서 보고서가 방문별로 짝지음 |
| P1-5 | 보고서·지표를 `occurred_at` 기준으로 · null 은 제외+제외 수 | 분모 병기 계약 테스트 |
| P1-6 | 정렬 보조 키(`recorded_at`, `id`) — 동시각 순서 결정 | |

#### P1 구현 결과(2026-10-01)

| 항목 | 결과 |
|---|---|
| 시각 이중화 | 기록 시각은 **기존 `created_at`** 을 정본으로 썼다(새 `recorded_at` 컬럼 없음 — 같은 뜻의 컬럼을 둘 두지 않는다). 추가: `occurred_at`(모르면 null)·`occurred_at_source`(DOMAIN_FIELD/USER_CLAIMED/SAME_AS_RECORDED/UNKNOWN)·`occurred_at_precision`·`planned_at`·`emitter`·`data_origin`. 과거 행은 기본값 `UNKNOWN` — **UPDATE 0행**(소급 없음) |
| 관계표 | `patient_journey_event_objects`(OCEL qualifier episode/focus/location/performer). 정본 함수 `journeyObjectLinks` — refType 이 방문 단위면 episode, 원 기록이면 focus+명시 episode. uuid 아닌 refId 는 싣지 않는다(@db.Uuid — 넣으면 사건 저장 전체가 실패) |
| 어휘 | shared `journey-objects.ts` — 객체 유형 27·방문 단위 5·`JOURNEY_EPISODE_REQUIRED` 25유형·옛 refType 매핑(저장값 불변 · 읽는 쪽 매핑) |
| 발행 지점 | 도메인 시각 14유형이 원장 시각을 넘긴다(응급 도착은 직원 입력이면 `USER_CLAIMED` · 입원은 입력 날짜면 `DAY` 정밀도). 방문 단위를 별도로 밝힌 곳: PACU 입·퇴실(수술)·전과(입원)·검진 스테이션/완료(검진 방문)·대기열 진료 시작(접수). 검진 예약은 `planned_at` |
| 보고서 | 간격은 `occurred_at` 으로만 — 모르는 행은 빼고 `excludedUnknownTime` 으로 센다(기록 시각으로 대신하지 않는다). 🔴 **P0 짝짓기 규칙 부작용 봉합**: 입원(ADMISSION)→수술(SURGERY)처럼 종류가 다른 원 기록은 포인터 비교가 늘 '다름'이라 `admitToSurgeryMinutes` 가 P0 배포 이후 영원히 null 이었다 |
| 화면 | 여정 탭 — 발생 시각 표시·늦은 기록(5분 초과)이면 기록 시각 병기·`USER_CLAIMED` 는 "입력된 시각"·발생 시각 미상은 "기록 시각" 표식. 보고서 패널 — 제외 건수 안내 |
| 출처 | 정본 발행기 `LIVE` · 시드 `SEED` · 데모 `DEMO`. 데모 초기화는 **DEMO 행만** 지운다(종전엔 그 환자의 오늘 이후 사건을 출처 무관하게 지웠다) |
| 감시자 | 77(방문 단위 귀속 없는 LIVE 행)·78(응급 도착 발생 시각 ≠ 방문 원장 도착 시각) — LIVE 행만 센다. 77 목록은 shared 와 기계 대조 |
| 가드 | `test/journey/journey-p1.spec.ts` — 방문 단위·도메인 시각 구조 가드는 재주입(PACU 입실의 episode·occurredAt 제거, 전과 episode 제거)으로 실패 확인 |
| 남은 것 | 포털 시각 표시(§7-D3 문구 결정 대기) · 과거 행 백필(D1) · 응급 퇴실 시각 원천(D9) · ~~재원일수 `stayDays` 정본 전환~~ → 아래 |
| 재원일수 정본 수렴(2026-10-01 · `cb59e3b94`) | 🔴 "평균 재원일수"를 **다섯 곳**(여정 지표·의료질·운영 통계·흐름 분석·경영 KPI)이 각자 소수 일로 계산했다 — 환자 화면 재원일수(`stayDays` max(1,ceil))와 갈렸다(P12). shared `summarizeStayDays`(개별 = stayDays · 평균 = 정책 `stayDaysMean` 소수 1 · 퇴원<입원·날짜 없음은 빼고 센다 · 표본 0 = null)로 수렴. 여정 지표 모집단을 §5.10(기간 안 **퇴원**)으로 — 종전 기간 안 입원(장기 재원 퇴원이 빠짐) · 제외 수를 응답·화면 각주로. 🔴 운영 통계는 분자·분모가 다른 집합이었고 표본 0 이면 `0` 이었다. 다른 화면(의료질 — 기간 안 입원 코호트)의 **모집단**은 그 화면의 정의라 바꾸지 않았다(계산만 수렴). 운영 영향(시드): 전 기간 퇴원 28건 평균 6.8 → 7.0일 · 9월 퇴원 0건 · 퇴원<입원 0건. 가드 `journey-los-canon.spec.ts`(재주입 2종 실패 확인) |

### P2 — 활동/전이·정정·완결성 측정

| # | 작업 | 검증 |
|---|---|---|
| P2-1 | `activity`·`transition`·`outcome`·`supersedes_id`·`idempotency_key` 추가 + shared 매핑표(§5.3) + 가드(어휘 전 항목이 매핑됨) | 매핑 누락 재주입 |
| P2-2 | `ER_DISPOSITION` 변경 경로를 `REVISED` 로 · 정정 UI 는 새 사건 · 데모 `deleteMany` 는 DEMO 모드 가드 뒤로 | 운영 모드 REAL 에서 deleteMany 경로 차단 테스트 |
| P2-3 | **완결성 감시**: 감시자 불변식 추가 — (a) 상태–사건 대조 I5 (b) 종료 일관성 I6 (c) 발행 실패 계수. 판정은 **수와 분모**, 자동 교정 없음 | 표본을 일부러 남긴 픽스처(정상 전건이면 탐지기 작동을 알 수 없다) |
| P2-4 | 관측 범위 등록부 `observedSince`(어휘 항목별) — 근거는 발행 지점 커밋일(git 이력에서 사람이 확인해 기재, **추정 금지**) · 화면 §5.7 문장 | |
| P2-5 | 관제 카드 "여정 기록 누락" 표식(운영자 전용) | |

#### P2 구현 결과(2026-10-01)

| 항목 | 결과 |
|---|---|
| 스키마(추가 전용) | `activity`·`transition`·`outcome`·`supersedes_id`·`idempotency_key`(유니크 — NULL 다중 허용 = 부분 유니크) + `(activity, transition)` 인덱스. 과거 행은 null(소급 없음) |
| 매핑 정본 | shared `journey-activity.ts` — `JOURNEY_ACTIVITY_MAP`(어휘 63종 전부 · `Record<JourneyEventType, …>` 라 빠지면 컴파일 실패 + 가드) · 전이 어휘 13 · `once`(한 번만 일어나는 전이 = 멱등 키 `<activity>:<transition>:<refId>`) · 동의서 서명은 `IN_PROGRESS`+`outcome=SIGNED_BY_PATIENT`(Task businessStatus) |
| 멱등·정정 | 키 충돌(P2002)은 **억제**로 세고 실패에 섞지 않는다. `REVISED` 는 같은 활동·같은 원 기록의 직전 사건을 `supersedes_id` 로 가리킨다(없으면 null — 가까운 것에 추정 귀속 안 함). 전이를 덮으면(처분 변경) 키를 만들지 않는다 |
| 🔴 응급 처분 | **정본 EP(`POST visits/:id/disposition`)의 최초 결정이 여정에 남지 않았다** — 변경만 `reviseDisposition` 이 발행했다. 구 경로(`updateEmergencyStatus`)는 결과와 무관하게 한 번 더 발행해 같은 결정 재클릭도 사건이 됐고 변경이면 이중이었다. 이제 최초=COMPLETED 한 번·재클릭=사건 없음·변경=REVISED(앞 결정을 가리킴) |
| 결과 속성 | 퇴원(`DISCHARGED`/`TRANSFERRED`)·PACU 퇴실 목적지·응급 퇴실 처분·처분 값 |
| I1 사건 불변 | 여정 행 갱신·삭제는 데모 정리 도구(`patient-auth.service.ts`)에만 — 구조 가드. 데모 정리 EP 는 REAL 에서 403(가드 + DEV 대조군) |
| 관측 범위 등록부 | `JOURNEY_OBSERVED_SINCE` — 59종은 `git log --reverse -S "eventType: '<유형>'" -- apps/api/src` 첫 커밋(시각·해시), 4종(`PRESCRIPTION_ADDED`·`DIAGNOSTIC_*` — 리스너 삼항·상태 맵으로 발행)은 **미확인 null**. 🔴 커밋 시각 ≠ 배포 시각. `JOURNEY_REF_ATTACHED_SINCE` 는 원 기록 귀속까지 갖춘 시점(diff 로 확인한 2종만) |
| 감시자 | 79 응급 진료 시작 사건 누락 · 80 퇴원 사건 누락(I5 · 경계 = 귀속 시작 등록부와 기계 대조) · 81 종결 사건 중복(I6 · 정정 제외) — 수만 센다 |
| 화면 | 기간 보고서 — 기간 시작 뒤에야 기록되기 시작한 간격 사건을 "그 전 기간은 기록 범위 밖"으로 밝힌다(확인 못 한 것은 그렇다고). 관제 — 운영자 전용 "여정 기록 상태" 카드(발행 저장·실패·이중 억제·방문 단위 누락 · **프로세스 시작 이후 수**라고 밝힘 · 상태–사건 불일치는 감시자 화면이 정본) |
| 가드 | `test/journey/journey-p2.spec.ts` — 재주입 5종(최초 결정 발행 제거·REVISED 표식 제거·매핑 항목 제거·P2002 억제 제거·구 경로 이중 발행 복원) 전부 실패 확인 |
| 🔴 운영 첫 측정 | 79 = **21/21**(09-14 이후 진료 시작 시각이 있는 응급 방문 전부) — 원인은 데모 생성기(`dev-demo.service.ts` 응급 재실 채우기)가 도착·분류·진료 시작 시각을 쓰면서 여정 사건을 **하나도** 남기지 않은 것(도착+정확히 30분·처치 메모 없음 모양으로 확인). 데이터는 고치지 않고 생성기가 정본 발행기로 `DEMO` 사건을 남기게 했다 — 기존 21건은 그대로 세진다(소급 없음). 80 = 0(경계 이후 퇴원 없음). 처분 원장 144건 대 `ER_DISPOSITION` 사건 2건 — 시드가 원장에 직접 쓴 행과 구분할 수 없어 실피해 수로 말하지 않는다 |
| 남은 것 | 발행 실패의 **영속** 계수(현재 프로세스 메모리 — 아웃박스·실패 원장은 §7-D5 사람 결정) · 과거 행 activity 백필(D1) · 응급 퇴실 시각 원천(D9) · P3 |
| P2 확장(2026-10-01 · `bc8dcbcd8`) | **I5 상태–사건 대조를 응급 도착·입원·수술·PACU 로** — 감시자 82(응급 도착)·83(입원)·84(수술 시작/종료)·85(PACU 입/퇴실). 경계는 귀속 시작 등록부에 6유형 추가(`git log -S` 첫 커밋 — 현재 문자열 기준이라 실제보다 늦을 수 있다 = 덜 센다). 구조 가드 `journey-i5-extension.spec.ts` — 상태를 만드는 메서드(같은 파일 도우미 1단계 포함)가 그 사건을 발행한다(재주입: 입원 발행 제거 → 실패). 🔴 운영 첫 측정 82=0·83=12·84=32·85=3 — **전부 시드**(시드 UUID·감사 기록 없음 · 시드가 상태만 쓰고 사건을 남기지 않는다). 코드 경로는 전부 발행한다. 데이터는 고치지 않는다. 발행 시각 전수 점검: 시각을 넘기지 않는 46지점은 대부분 발행 직전 `new Date()` 로 도메인 시각을 찍어 `SAME_AS_RECORDED` 가 참 · 예약 접수에 `plannedAt` 추가(종전 설명 글자에만) · 감시자 소관 ADMIN |
| 남은 것(P2 확장 후) | D5(영속 계수/아웃박스)·D1(백필)·D9(퇴실 시각) — 사람 결정 · 검사 결과·투약 외 시각 입력 경로(늦게 입력된 결과 등)가 생기면 그 지점은 `occurredAt` 을 넘겨야 한다(구조 가드 `journey-p1`) |

### P3 — 반출·경로 대응·에피소드

| # | 작업 | 전제 |
|---|---|---|
| P3-1 | XES·OCEL 2.0 반출(관리자, 비식별, 평탄화 경고 수치 동봉) | §7-D4 결정 · 대외 발신 3조건 · XES 생명주기 대응표는 표준 원문 확인 후 |
| P3-2 | 프로토콜 변이 사건(`SKIPPED`·`BLOCKED`·조건 분기)을 여정에 · 경로 준수/변이율(분모 병기) | §7-D3 노출 결정(직원 내부 기본 숨김) |
| P3-3 | FHIR Encounter 반출에 `partOf`·`statusHistory`(R4) 파생 | FHIR 매퍼 유령 필드 규약(모델에 있는 필드만) |
| P3-4 | 돌봄 에피소드(EpisodeOfCare) — 만성·암·검진 도메인 정본이 생긴 뒤 | 정본 없이 여정으로 에피소드를 추정해 만들지 않는다 |

#### P3 구현 결과(2026-10-01) — 결정 대기 항목은 열지 않고, 열 수 있는 것만

| 항목 | 결과 |
|---|---|
| 사람 결정 D1~D12 등재 | `decision.registry.batch-2026-10-a.ts` — §7 표는 키로 등록부를 가리킨다(기계 대조). 반출 허용(`journey.exportMode`)은 **허가권자 층**. 코드가 이미 한쪽을 사실상 고른 것(D7 입력 시각 포함·D10 수술실 체류·D12 같은 원장+출처)은 statusQuo 에 그대로 밝혔다(결정한 것처럼 적지 않음) |
| P3-1 반출 | **반출 경로·변환 엔진은 만들지 않았다**(D4 미결). 관리자 전용 "여정 반출 준비도"(`GET journey/export-readiness` · 관제 카드) — 집계만: 시각 미상(반출 시 빠짐)·매핑 불가·사례 수·평탄화 결핍/수렴·출처별. XES 생명주기 대응표는 표준 원문 미확인이라 두지 않았다 |
| P3-2 프로토콜 변이 | 미착수 — D3(`journey.unexposedRecording`) 결정 전 |
| P3-3 FHIR Encounter | 정본 `common/fhir-encounter.ts` — 🔴 정정 진료가 한 반출 경로에선 **R4 값 목록에 없는 `amended`**, 다른 경로에선 `in-progress` 로 나갔다(같은 진료가 두 값 · P12) → 둘 다 `finished`. 분류는 늘 외래(AMB)였다 → 기록된 방문 유형·입원 연결로 IMP/EMER. `statusHistory` 는 원장 시각(생성·서명)에서만 파생. `partOf` 는 싣지 않는다 — 입원을 FHIR Encounter 로 제공하지 않아 가리킬 곳이 없는 참조가 된다 |
| P3-4 돌봄 에피소드 | 미착수 — 도메인 정본 없음(추정으로 만들지 않는다) |
| 🔴 재입원율 | 30일 재입원 분자가 **취소된 입원까지** 셌다 — 정의 결정(D11)과 무관한 결함이라 봉합 |

#### 표시 UX 검토·반영(2026-10-01 · 사람 요청 "세련된 UX로 충분하게")

화면 5곳(직원 여정 탭·여정 대시보드·관제 드릴다운·보고서·모바일 타임라인)을 검토했다. 결함 9건, 정제 10건이 나왔다.

| 구분 | 무엇이 있었나 → 무엇으로 |
|---|---|
| 🔴 표시 정본 | 대시보드 로컬 유형 표 15키 중 **10키가 어휘에 없는 이름**이라 실제 칩이 `RECEPTION_CHECKIN` 같은 코드로 보였다. 탭 아이콘은 26/63 유형만 있었고, 모바일 아이콘엔 발행되지 않는 `ROUND` 가 있었다 → shared `journey-display.ts`(`Record<JourneyEventType,…>` — 어휘 전 항목 강제 · 라벨 등재 가드) |
| 🔴 대시보드 | 타임라인을 자기 마크업으로 따로 그렸다 → **직원 탭 부품을 그대로**(정본 하나) · 지표 실패가 페이지 전체를 오류로 덮던 것 → 지표 카드 안에서만 · 환자 검색 실패를 "결과 없음"으로 보이던 것 |
| 🔴 "기록 시각" 표식 | 과거 행의 `eventAt`(롤포워드가 다시 쓴 값)에 "기록 시각" 라벨을 달았다 → "발생 미상" + 표시 시각(출처 확인 불가라고 밝힘) · 늦은 기록 병기는 정본 `createdAt` |
| 직원 탭 | 오래된 순·평면 나열·줄 순서와 찍힌 시각 불일치 → 최신순·날짜 묶음·"발생 시각 기준(모르면 표시 시각)" 명시 · 트랙 필터(서버 `types` — 잘림 판정이 필터 기준) · 방문 칩 → "이 방문만"(불러온 범위 안이라고 밝힘) · 정정/취소/철회 표식 · 정정 대상이 범위 밖이면 그렇다고 · 데모/시드 표식(과거 UNKNOWN 행엔 붙이지 않음) · 예정 시각 병기 · 첫 페이지 재조회 때 이어 받은 이전 기록을 비움(틈 방지) · 로딩≠없음 |
| 🔴 관제 드릴다운 | 로딩 중 "여정 이벤트 없음" · 날짜 없이 시각만(여러 날이 같은 '09:12') · 최신이 스크롤 맨 아래 · 잘림 고지 없음 → 넷 다 봉합 · 최근 20건 + "전체 여정 보기"(환자 차트 여정 탭) |
| 보고서 | 유형·관측 범위를 원 코드로 → 라벨 · 날짜 `aria-label="from"` → 화면 언어 · 시작>종료면 부르지 않고 그 자리에서 말함 · 간격 "산출 불가"에 필요한 양 끝을 밝힘 |
| 🔴 모바일·포털 | 설명 안전 목록 밖 유형은 설명이 null 인데 제목도 안 실어 **행 대부분이 빈 문장** → 서버가 정본 라벨·트랙을 싣는다 · 조회 실패를 "없음"으로 → 오류 상태 · "전체"가 365일·100건 무고지 절단 → "1년" + `meta.truncated` · 날짜 경계 UTC → `dayRange`(KST) · 응급 퇴실 설명에 처분 코드(`처분: ADMISSION`)가 환자에게 → 환자 문구(사망·어휘 밖은 설명 생략) · 발생 시각 미상은 날짜만 "기록일" |
| 남은 것 | ~~방문 묶음 머리(과·시작~끝·종료 기록 없음)는 도메인 조인이 필요 — 별도 EP 후보~~ → 아래 방문 묶음 · 포털 시각 문구는 §7-D3 · 서버 정렬을 발생 시각 기준으로 바꾸는 것은 커서 형식 변경이 따른다(현재는 페이지 안에서 재정렬하고 기준을 밝힌다) · 모바일 실기기 화면 미확인 · LEAVE_AMA 환자 문구("퇴실(자의 퇴원)")는 임상 확인 대상 |

#### 방문 묶음·서버 방문 거르기(2026-10-01 · `5dc34d220` · P3 표시 잔여)

| 항목 | 결과 |
|---|---|
| 방문 묶음 EP | `GET journey/:patientId/episodes` — 외래·응급·입원·수술·검진 방문을 **도메인 원장**에서 요약(여정 원장 아님 · 유형별 최근 30 · 잘린 유형 고지 · 환자 지목 열람 감사) |
| 🔴 끝을 지어내지 않는다 | 외래 끝(D8 미결)·응급 퇴실(D9 미결)은 끝 `null` + 이유(`OUTPATIENT_END_UNDEFINED`·`NO_DEPARTURE_TIME_SOURCE`). 대기열 완료·응급 처분 시각을 끝으로 그리지 않는다 — 처분은 결정 시각(milestone `DISPOSITION`). 퇴원 상태인데 퇴원일이 없는 입원·모르는 상태값은 `UNKNOWN`(추정 안 함) · 예정 수술·검진 예약은 `PLANNED` |
| 상태 어휘 | 운영 저장값 전수 대조(외래 5·응급 6·입원 3·수술 3·검진 10종) — 검진 생애주기는 검진 원장 전이표 그대로(검사완료·부분완료·판정 중 = 진행 중 · 완료·통보 = 끝) |
| 서버 방문 거르기 | 타임라인 `episodeType`·`episodeId` — 관계표(P1 이후 행) **또는** 옛 refType·refId(P1 전 행). 🔴 종전 "이 방문만"은 화면이 불러온 범위 안에서만 걸러 잘린 앞부분의 그 방문 기록이 보이지 않았다 |
| 화면 | 타임라인 위 방문 묶음 띠(상태·기간·끝 기준 없음 이유) · 고른 방문 요약 배너(행 칩으로 골라도 받아 둔 목록에서 요약) · milestone 은 코드(kind)로 내려 화면이 라벨(서버 조립 한국어 문장 가드) |
| 가드 | `journey-episodes.spec.ts`(재주입: 응급 완료를 끝남으로 → 실패 · 옛 refType 분기 제거 → 실패) · web `journey-visits` |
| 서버 정렬(2026-10-01 · `1ea32923b`) | 타임라인 정렬·잘림·커서·기간 = `COALESCE(occurred_at, event_at)`(화면 `placedAt` 과 같은 정의). 🔴 종전엔 표시 시각으로 자르고 화면이 페이지 안에서만 다시 줄 세워, 늦게 입력된 사건이 첫 페이지에 들고 발생상 더 최근 사건이 다음 페이지로 밀릴 수 있었다. id 선택만 매개변수 SQL · 행은 Prisma · 커서 모양 그대로(화면 무변경) · 식 인덱스 없음(db push 가 지운다) — 최다 환자 147행 0.7ms. 운영 영향 실측: 발생≠표시 행 0 → 첫 페이지 변화 0/129(앞으로의 늦은 입력부터). 배포 후 서버에서 실코드 읽기 검증(정렬·커서 2쪽 겹침 0·경계) |
| 남은 것 | 모바일 실기기 · D8·D9 가 정해지면 끝 시각을 채운다 |

#### 의료진 관점 여정 · 임상 시계열 분석(2026-10-01 사람 요청)

**진료 관점(처방·오더·질관리)** — 환자 여정 탭의 두 번째 관점 · `GET journey/:patientId/clinical-lens` · 정본 `journey/clinical-lens.ts`.
근거는 여정 원장이 아니라 **도메인 원장의 단계 시각 필드**(Order·LabResult·ImagingResult·Dispensing·MedicationAdministration·CriticalValueAlert·Prescription).

| 무엇 | 근거 필드 · 규칙 |
|---|---|
| 오더 단계 줄 | 검사 발행→접수→채취→결과→검증→의사 확인 · 영상 발행→접수→촬영→판독→의사 확인 · 약제 발행→접수→조제→검증→불출 · 치료 발행→접수→시행→완료 · 취소는 끝에. 시각 없으면 빈 점(기록 없음 — 추정 없음) |
| 결과 의사 확인 | 결과 확인함과 **같은 조건**(검사·영상·COMPLETED·`acknowledgedAt` 없음·취소 아님) — 수/분모 + 결과→확인 중앙값(표본 수) |
| 소요 시간 | 오더→결과·결과→확인·위급값 알림→확인·예정→투약 — **양 끝이 있을 때만**, 중앙값+표본 수(표본 0 = null) |
| 처방 | 투여 상태(정본 `dosingWindow`)·DUR 점검/경고/무시·구두·전화 처방 복창→사후 확인·중단/갱신·퇴원약 · 투약(예정 지난 것 중 기록/기록 없음·보류·거부·누락) |
| 판정 없음 | "지연" 임계는 원내 정책이라 두지 않는다 — 수·분모·중앙값만 |
| 🔴 밝힌 한계 | 검체 채취 시각은 검사실 접수 순간과 같은 값으로 찍힌다(병동 채취 시각 없음) · 처방 취소는 시각 필드가 없다 · 위급값 `notifiedAt` 은 탐지 시각(도달 아님) |
| ✅ 채취 시각 분리(2026-10-01 후속) | 오더에 `specimenCollectedAt`·채취자·기록 시각·출처(POINT_OF_CARE/ENTERED_LATER) · `PATCH workstation/order/:id/specimen-collection`(미래·발행 전·접수 뒤 400 · 이미 기록 409 · 조건부 갱신) · 병동 채혈 대기 `GET workstation/specimen-collection/pending`(간호 워크스테이션 패널) · 채혈실·검사실 큐에 채취 표시·버튼 · 🔴 접수 4경로(워크스테이션 접수·검사실 접수·장비 수신·결과 입력)가 **접수 순간을 채취로 찍던 것** 제거 — 기록된 채취를 옮겨 적거나 null · 진료 관점에 "검체 채취 기록 n/N"·채취→접수 중앙값 · 과거 행은 그대로(소급 없음 · 화면이 '과거 경로'라고 밝힘) · 종전 단위 테스트 1건이 접수=채취를 **계약으로 못박고** 있었다 |

**임상 시계열 분석** — 통합 시계열의 "분석" 보기 · `GET patients/:patientId/record-timeline/analytics` · 정본 `record-timeline/record-analytics.ts`.

| 무엇 | 규칙 |
|---|---|
| 항목 묶기 | LOINC → 원 코드 → 이름(정규화) — 종전 의미찾기는 이름 문자열만 봤다 |
| 항목 통계 | 처음→최근·변화·변화율·최소/최대/중앙값·30일당 기울기(최소제곱 · 3점·하루 이상) · 참고 범위 안 비율(**결과마다 자기 범위** — 범위 개정 소급 없음 · 범위 없으면 플래그) · 범위 이동(범위 안 유지/밖→안/안→밖/밖 유지) |
| 정직성 | "호전·악화" 어휘 없음(화면이 밝힘) · `<5`·문자 결과·다른 단위는 계산에서 빼고 수를 밝힘(단위 환산 없음) · **보고값 원값 그대로**, 파생값만 `roundBy('labValue')` |
| 처방 | 처방 기간 레인(그래프와 같은 시간축 · 끝을 모르면 흐린 막대) · 처방 시작 전·후 90일 평균은 **양쪽 2점 이상일 때만**, "관련성 판단 아님" 병기 |
| 활력 | 외래 사전 측정 + 병동 플로시트 · 범위는 활력 판정 정본(환자안전위 개정 병합 · 미설정이면 기본값이라고 밝힘) |
| 검사 범위 | 예비(COMPLETED)·검증(VERIFIED) 모두 — 종전 AI 추세는 COMPLETED 만 봐 검증된 결과를 뺐다 |

### 단계별 수용 기준·변경 범위(검토 보완)

| 단계 | 수용 기준(전부 만족해야 완료) | 변경 파일(예상) | 스키마 | 되돌리기 |
|---|---|---|---|---|
| P0 | ① 지표 3종이 표본 0 에서 `null`+n · 화면 "산출 불가" ② ED LOS 는 퇴실 원천이 생기기 전까지 `null`(대용값 없음) ③ 보고서 끝점에서 처분 제거 ④ 날짜 경계 KST(재주입 통과) ⑤ refId 보강 9종 · 가드 ⑥ 직접 쓰기 0(데모 제외 · 사유 주석) ⑦ 직원 타임라인 최신순·커서·`truncated`(§4.13) ⑧ 감시자 Q4·Q5 추가(수만 센다) | `journey.service.ts` · `journey-report.ts` · `emergency.service.ts` · `inpatient.service.ts` · `surgery.service.ts` · `encounter.service.ts` · `er-bed.service.ts` · 직접 쓰기 9파일 · `journey/page.tsx` · 직원 여정 탭 · 감시자 SQL | 없음 | 코드만 되돌리면 된다 |
| P1 | ① 신규 행 100%가 `occurred_at_source` 를 가진다(컴파일 강제) ② §5.11 S1·S2·S9 픽스처 통과 ③ 과거 행 수·값 불변(마이그레이션 전후 count·checksum) ④ Q1·Q3 가 0 에서 시작(신규 행 기준) ⑤ `data_origin` 신규 행 채움 | 스키마(추가) · `journey.service.ts`(`record()`) · 발행 지점 전수 · shared 객체 유형 어휘 · 보고서 | 컬럼 6 · 테이블 1(관계표) · 인덱스 3 | 컬럼은 남기고 읽는 쪽만 되돌린다(추가 전용이라 데이터 손실 없음) |
| P2 | ① 어휘 전 항목 activity·transition 매핑(가드) ② `REVISED`·`CANCELLED` 사용처 전환 ③ 감시자 Q2·Q6 운영 ④ `observedSince` 등록부 + 화면 문장 ⑤ 데모 `deleteMany` REAL 차단 테스트 | shared 매핑표 · 감시자 · 관제 카드 | 컬럼 4 · 부분 유니크 1 | 〃 |
| P3 | 사람 결정 D4 이후에만 착수 | 반출 모듈 · FHIR 매퍼 | — | 반출 기능 끄기(설정 기본 OFF) |

**이중 읽기 기간(P1 → P2):** 읽는 쪽은 `occurred_at ?? (출처 UNKNOWN 표식과 함께) recorded_at` 을 쓰지 **않는다**. 지표는 `occurred_at` 이 있는 행만 쓰고 나머지는 제외 수로 낸다. 타임라인은 두 시각을 모두 보이되, 정렬은 `occurred_at` → 없으면 `recorded_at` 이고 그 사실을 표식으로 밝힌다(§5.7).

**마이그레이션 이름(제안):** `2026XXXX_journey_v2_time_and_origin`(P1 컬럼) · `2026XXXX_journey_event_objects`(관계표) · `2026XXXX_journey_v2_activity_transition`(P2). 배포는 CLAUDE.md 규칙대로 `migrate diff` 미리보기 후 해당 SQL 만 적용한다. 인덱스 후보: `(patient_id, occurred_at)` · `(object_type, object_id)`(관계표) · `idempotency_key` 부분 유니크.

**환자 포털 영향:** 포털은 제목·시각만 보인다. P1 이후 시각 표시는 `occurred_at` 이 있으면 그것을 쓰고, 없으면 **날짜만**("기록일") 보인다(§7-D3 문구 결정). 가시성 목록(`JOURNEY_EVENT_PATIENT_HIDDEN`)·설명 안전 목록은 바꾸지 않는다.

**규모 감각(상대):** P0 은 기존 파일 수정과 가드만 있다(하루 작업 단위 여러 개). P1 은 스키마 추가와 발행 지점 전수 전환이다(발행 지점 69곳(데모 제외)). P2 는 감시자·매핑·화면 문장이다. P3 은 결정 대기다.

### 공통 검증 규약

- 모든 가드는 결함 재주입으로 실패를 확인(주입 성공 `count==1` 먼저).
- 목(mock)은 정본의 실제 반환 모양으로.
- web 만 고쳐도 api 전체 스위트(web 을 스캔하는 가드가 api 에 있다).
- 배포 전 부트 검증.
- 운영 실측은 시드 위에서의 동작 확인일 뿐 — 실피해 규모로 읽지 않는다.

---

## 7. 사람 결정 필요 항목 (선택지와 결과만 — 권고하지 않는다)

2026-10-01 등록부 등재 — `decision.registry.batch-2026-10-a.ts`(화면 `/admin/decisions` 에서 고른다). **이 표는 정본이 아니다** — 아래 키로 등록부를 가리킨다(`test/decision-registry/journey-decisions-registered.spec.ts` 가 기계 대조).

| ID | 등록부 키 |
|---|---|
| D1 | `journey.backfillOccurredAt` |
| D2 | `journey.erToAdmissionBoundary` |
| D3 | `journey.unexposedRecording` |
| D4 | `journey.exportMode` |
| D5 | `journey.emitDurability` |
| D6 | `journey.performerObjects` |
| D7 | `journey.userClaimedInMetrics` |
| D8 | `journey.outpatientEnd` |
| D9 | `emergency.departureTimeSource` |
| D10 | `surgery.durationDefinition` |
| D11 | `quality.readmission30Definition` |
| D12 | `journey.demoSeparation` |

아래는 기획 당시의 설명 표다(선택지·결과의 최신본은 등록부).

| ID | 질문 | 선택지 → 결과 |
|---|---|---|
| D1 | 과거 행의 발생 시각을 원 기록에서 **백필**하는가 | (a) 안 한다 → 과거 행 `occurredAt=null`, 과거 기간 간격 지표는 "산출 불가"가 늘어난다 · (b) 원 기록 시각 필드가 1:1 로 확정되는 유형만 백필(`DOMAIN_FIELD`) → 과거 지표 일부 복원, 매핑이 틀리면 과거 수치가 바뀐다(소급) · (c) 전 유형 백필 → refId 없는 행은 짝을 추정해야 하므로 추정값이 사실처럼 남는다 |
| D2 | 응급→입원 전환을 **한 방문으로 볼지 둘로 볼지** | (a) 둘 + 연결 → 응급 체류·재원일수가 따로 나온다, 재원일수가 응급 시간을 포함하지 않는다 · (b) 하나(OMOP 통합 개념처럼) → 입원 재원 시작이 응급 도착으로 당겨진다, 청구·병상 기준 재원일과 다른 수가 된다 · (c) 둘 다 산출해 화면에 정의를 밝힌다 → 같은 지표명에 두 값이 생긴다 |
| D3 | 노출 미결정 4종(간호 평가·낙상 위험·안전사건·감염)과 프로토콜 변이를 **기록만** 할 것인가 | (a) 기록+환자 숨김 → 분석·완결성에 들어간다, 포털에는 안 나간다(현행 fail-closed 유지) · (b) 계속 기록 안 함 → 노출 결정과 분석이 계속 묶인다 · ※ 안전사건은 보고자 보호(환자안전법 §17) — 기록하더라도 보고자 식별을 사건·객체 관계에 싣지 않는 조건이 따로 필요 |
| D4 | 연구·외부 분석용 XES/OCEL **반출을 허용**하는가 | (a) 불허 → P3-1 미착수 · (b) 원내 분석 도구로만(파일이 원외로 안 나감) → 저장 위치·접근 감사 필요 · (c) 비식별 반출 허용 → 대외 발신 3조건·IRB 등 원내 절차가 필요(허가권자/위원회 층은 이 문서가 정하지 않는다) |
| D5 | 여정 발행 유실을 **막을지(아웃박스) 셀지(계수)** | (a) 계수만 → 구현 작음, 유실은 남되 분모로 드러난다 · (b) 커밋 후 아웃박스 → 유실이 거의 없어지나 임상 트랜잭션 경로에 쓰기가 늘고 재시도 중 이중 발행 방지(멱등 키)가 필수 |
| D6 | 사건–객체 관계에 **직원(수행자)** 을 싣는가 | (a) 싣는다 → 자원 관점 분석(누가 병목인가)이 가능, 직원 개인 성과 감시로 쓰일 수 있다 · (b) 부서·역할까지만 → 개인 식별 없음, 인수인계 지연 원인 추적은 원 기록으로만 |
| D7 | `USER_CLAIMED` 시각(사용자가 입력한 과거 시각)을 지표에 **넣는가** | (a) 넣는다 → 늦은 등록이 지표를 왜곡하지 않는다, 입력 오류·의도적 조정이 그대로 반영된다 · (b) 뺀다 → 늦은 등록 건이 표본에서 빠져 분모가 줄어든다 · (c) 넣되 비율 병기 |
| D8 | 외래 여정의 **종료 사건**을 무엇으로 정의하는가 | (a) 진료 기록 완료 · (b) 수납 완료 · (c) 조제/수령 완료 · (d) 셋 다 별도 활동으로 두고 "외래 종료"를 정의하지 않음 → 지표마다 끝점을 밝힌다. 각 선택은 외래 체류 시간 수치를 다르게 만든다 |
| D9 | 응급 **퇴실 시각의 원천**을 무엇으로 하는가(§4.14) | (a) `EmergencyVisit.departedAt` 신설·퇴실 화면에서 입력(기본 = 누른 시각, 과거 시각 입력 허용 시 `USER_CLAIMED`) → ED LOS·boarding 산출 가능, 스키마 추가 · (b) 응급 병상 해제 시각(`releaseReason='DISPOSITION'`)을 퇴실로 간주 → 추가 없음, 병상 없이 진료한 방문은 산출 불가이고 "병상 해제 = 퇴실"이라는 가정이 지표에 박힌다 · (c) 정하지 않음 → ED LOS 계속 산출 불가 |
| D10 | "수술 시간"을 무엇으로 정의하는가(§4.15) | (a) 수술실 체류 `startedAt→endedAt`(버튼) · (b) 절개~봉합 `incisionTime→closureTime`(기록값) · (c) 둘 다 이름을 달리해 제공 → 수술실 효율과 술기 시간이 갈린다. 각 선택은 수치가 다르다(기록값 누락 시 (b) 표본이 줄어든다) |
| D11 | 30일 재입원의 **분자·분모 정의** | 분모에서 사망·전원 퇴원을 뺄지 · 분자에서 계획 재입원(항암 주기 등)을 뺄지 · 같은 진료과만 볼지. 계획 여부를 원장이 모르면 (뺀다)를 고를 때 판별 원천이 먼저 필요하다 — 없는 판별을 추정으로 만들지 않는다 |
| D12 | 데모·시드 사건을 **같은 원장에 출처 컬럼으로** 둘지 **분리**할지(§4.16) | (a) 같은 테이블 + `data_origin` → 쿼리마다 필터 필요, 빠뜨리면 섞인다(가드로 막는다) · (b) 데모는 별도 테이블 → 실원장은 깨끗하나 데모 화면이 두 원천을 읽어야 한다 · 과거 행의 출처는 판정 가능한 것만 채우고 나머지 `UNKNOWN`(공통) |

---

## 8. 출처 목록

읽은 범위: **[원문]** 원문을 직접 열어 해당 부분 확인 · **[요약 도구]** 원문 페이지를 열었으나 요약 도구를 거쳐 읽음 · **[초록]** 초록·서지 페이지만 · **[2차]** 검색 결과 요약·백과만. DOI 는 열어본 페이지에 표시된 것만 적었다.

| # | 출처 | URL | 읽은 범위 |
|---|---|---|---|
| S1 | IEEE Task Force on Process Mining, *Process Mining Manifesto* (2011) | https://www.tf-pm.org/upload/1580737614108.pdf | [원문] PDF 텍스트 추출 — GP1·성숙도 표·용어집 |
| S2 | van der Aalst, W.M.P., *Object-Centric Process Mining: An Introduction* (RWTH) | https://www.vdaalst.rwth-aachen.de/publications/p1398.pdf | [원문] PDF 텍스트 추출 — 초록·§3.7 수렴/발산/결핍 |
| S3 | OCEL 2.0 공식 사이트 | https://www.ocel-standard.org/ | [요약 도구] 개요 페이지만 — 명세서 본문 미열람 |
| S4 | IEEE 1849 (XES) — Wikipedia | https://en.wikipedia.org/wiki/IEEE_1849 | [2차] 표준 원문(유료) 미열람 — 생명주기 전이 목록은 미확인 |
| S5 | Bose, Mans, van der Aalst (2013) *Wanna improve process mining results?* BPM reports 1302 | https://research.tue.nl/en/publications/wanna-improve-process-mining-results-its-high-time-we-consider-da/ | [초록] |
| S6 | Rojas, Munoz-Gama, Sepúlveda, Capurro (2016) *Process mining in healthcare: A literature review*, J Biomed Inform 61 | https://bibbase.org/network/publication/rojas-munozgama-seplveda-capurro-processmininginhealthcarealiteraturereview-2016 (서지) · https://www.sciencedirect.com/science/article/pii/S1532046416300296 (미열람) | [초록 아님 — 서지만] 74편 규모는 검색 요약 |
| S7 | Davies 등 (2023) *Reporting and conducting patient journey mapping research in healthcare: A scoping review*, J Adv Nurs | https://pmc.ncbi.nlm.nih.gov/articles/PMC10099758/ | [요약 도구] |
| S8 | Percival, McGregor (2016) *An Evaluation of Understandability of Patient Journey Models in Mental Health*, JMIR Hum Factors | https://pmc.ncbi.nlm.nih.gov/articles/PMC4981695/ | [요약 도구] |
| S9 | Voorheis 등 (2025) *Using Journey Mapping and Service Blueprinting to Design Digital Health Behavior Change Innovations: A Scoping Review*, J Diabetes Sci Technol 19(5) | https://pmc.ncbi.nlm.nih.gov/articles/PMC12061902/ | [요약 도구] |
| S10 | Gibbons (2017) *Service Blueprints: Definition*, Nielsen Norman Group | https://www.nngroup.com/articles/service-blueprints-definition/ | [원문] (Shostack 기원은 이 문서에 없음 — 미확인) |
| S11 | European Pathway Association, *About care pathways* | https://e-p-a.org/care-pathways/ | [원문] |
| S12 | De Bleser 등 (2006) *Defining pathways*, J Nurs Manag | https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1365-2934.2006.00702.x | [2차] 검색 요약만 — 84개 정의 수치 원문 미확인 |
| S13 | Kinsman 등 (2010) *What is a clinical pathway?*, BMC Med | https://link.springer.com/article/10.1186/1741-7015-8-31 | 접근 실패 — 내용 인용 안 함 |
| S14 | OMG BPMN 2.0.2 | https://www.omg.org/spec/BPMN/ | [요약 도구] 사양 개요 페이지 |
| S15 | OMG CMMN 1.1 | https://www.omg.org/spec/CMMN/ | [요약 도구] 사양 개요 페이지 |
| S16 | Gartner 등 (2026) *The Implementation of a Business Process Model and Notation for Modeling Patient Health Care Trajectories: Systematic Review*, JMIR, doi:10.2196/78506 | https://pmc.ncbi.nlm.nih.gov/articles/PMC13249068/ | [요약 도구] |
| S17 | Iglesias, Juarez, Campos (2022) *BPMN and openEHR Task Planning for Clinical Pathway Standards in Infections: Critical Analysis*, JMIR, doi:10.2196/29927 | https://pmc.ncbi.nlm.nih.gov/articles/PMC9523526/ | [요약 도구] |
| S18 | HL7 FHIR R4 Encounter | https://hl7.org/fhir/R4/encounter.html | [요약 도구] |
| S19 | HL7 FHIR R4 EncounterStatus 값 집합 | https://hl7.org/fhir/R4/valueset-encounter-status.html | [요약 도구] 코드·정의 전량 |
| S20 | HL7 FHIR R5 Encounter | https://hl7.org/fhir/R5/encounter.html | [요약 도구] |
| S21 | HL7 FHIR R5 EncounterStatus 값 집합 | https://hl7.org/fhir/R5/valueset-encounter-status.html | [요약 도구] 코드·정의 전량 |
| S22 | HL7 FHIR R5 EncounterHistory | https://hl7.org/fhir/R5/encounterhistory.html | [요약 도구] |
| S23 | HL7 FHIR R4 EpisodeOfCare | https://hl7.org/fhir/R4/episodeofcare.html | [요약 도구] |
| S24 | HL7 FHIR R4 Provenance | https://hl7.org/fhir/R4/provenance.html | [요약 도구] |
| S25 | HL7 FHIR R4 Task | https://hl7.org/fhir/R4/task.html | [요약 도구] |
| S26 | HL7 FHIR R4 PlanDefinition | https://hl7.org/fhir/R4/plandefinition.html | [요약 도구] |
| S27 | openEHR EHR Information Model (RM latest) | https://specifications.openehr.org/releases/RM/latest/ehr.html | [요약 도구] · AUDIT_DETAILS(Common IM)는 [2차] |
| S28 | OHDSI OMOP CDM v5.4 | https://ohdsi.github.io/CommonDataModel/cdm54.html | [요약 도구] |
| S29 | 건강보험심사평가원 환자경험평가 | https://www.hira.or.kr/ra/eval/asmInfo.do?evlCd=30&pgmid=HIRAA030004000000 | [요약 도구] |
| S30 | 보건복지부 의료기관인증제 | https://www.mohw.go.kr/menu.es?mid=a10702030200 | [요약 도구] — 4주기 세부 기준(외래·응급 등록·입원·퇴원·전원 절차)은 [2차] 검색 요약, 기준집 PDF 는 403 |

미확인으로 남긴 것: XES 표준 생명주기 전이 전체 목록 · OCEL 2.0 명세 본문(형식·필드) · Shostack(1984) 원문 · Kinsman(2010) 5기준 · 의료기관 인증 4주기 기준 번호 · R5 외래 접수 대기(arrived 부재)의 공식 표현 방식.
