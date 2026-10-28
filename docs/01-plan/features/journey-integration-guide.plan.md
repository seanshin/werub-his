# 환자 여정 이벤트 통합 가이드

> **상태(2026-09-15 코드 대조 갱신)**: 구현됨(일부) — 어휘 정본 `packages/shared/src/journey-event-types.ts:46` JOURNEY_EVENT_NOT_EMITTED(A7 `d6cfef98`) · ORDER_COMPLETED·BILLING_CREATED·CONSENT_REVOKED·ER_TREATMENT_START 배선(A7) · PRESCRIPTION_ADDED 는 기존 발행(오판 교정)·ATTENDING_CHANGE=TRANSFER_CARE 별칭 · 환자 노출 필터·자유 입력 설명 제거(P1 `76772a66`) · 잔여: NURSING_ASSESSMENT·FALL_RISK_ASSESSED·SAFETY_INCIDENT·INFECTION_DETECTED 환자 노출 범위(사람) · ROUND 도메인 없음

## 목적

새로운 기능이 추가될 때 환자 여정 타임라인에 반드시 이벤트를 발행하도록 보장합니다.

> 🔴 **상태(2026-09-14): 아래 "현재 10개"·"미구현 19" 표는 낡았다 — 정본은 코드다.**
> 어휘 정본 `packages/shared/src/journey-event-types.ts`(`JOURNEY_EVENT_TYPES` 발행 유형 · `JOURNEY_EVENT_NOT_EMITTED` 미발행 사유 · `JOURNEY_EVENT_ALIASES` 다른 이름)를
> 가드 `apps/api/test/architecture/journey-event-vocabulary.spec.ts` 가 발행 지점 전수와 기계 대조한다
> (어휘 밖 이름으로 발행 → 실패 · 어휘에 있는데 발행 0 → 실패 · 위치 매핑·타임라인 아이콘 키도 어휘 안).
> - "미구현 19" 중 실제 발행 중이던 것: ORDER_CREATED·PRESCRIPTION_ADDED(리스너 삼항)·LAB_RESULT·IMAGING_RESULT·BILLING_PAID·BED_TRANSFER·CONSENT_SIGNED
> - 다른 이름으로 발행 중: ATTENDING_CHANGE→`TRANSFER_CARE` · FOLLOWUP_SCHEDULED→`APPOINTMENT_BOOKED`
> - 2026-09-14 배선: ORDER_COMPLETED(치료 오더 완료 2경로) · BILLING_CREATED(`billing.patient_pending` 구독) · CONSENT_REVOKED · ER_TREATMENT_START(위치 매핑은 있었는데 발행 0)
> - 발행하지 않음(사유는 정본 파일): ROUND(도메인 없음) · HANDOFF · ALERT(특화 이름 사용) · MEAL_ORDER · 🔴 사람 결정 대기 NURSING_ASSESSMENT·FALL_RISK_ASSESSED·SAFETY_INCIDENT·INFECTION_DETECTED
>   — 여정은 환자 포털 타임라인에 **유형 필터 없이** 나가므로(`portal.service getJourneyTimeline`) 노출 범위 결정이 먼저다.

## 현재 발행 지점 (10개) — 2026-06 시점 기록(낡음, 위 상태줄 참조)

| 서비스 | 메서드 | 이벤트 타입 | 파일 |
|--------|--------|-----------|------|
| WaitingQueueService | addToQueue | RECEPTION_CHECKIN | waiting-queue/waiting-queue.service.ts |
| EncounterService | create | ENCOUNTER_START | encounter/encounter.service.ts |
| EncounterService | sign | ENCOUNTER_SIGNED | encounter/encounter.service.ts |
| EmergencyService | createTriage | ER_ARRIVAL, ER_TRIAGE | emergency/emergency.service.ts |
| EmergencyService | updateEmergencyStatus | ER_DISPOSITION | emergency/emergency.service.ts |
| InpatientService | admit | ADMISSION | inpatient/inpatient.service.ts |
| InpatientService | discharge | DISCHARGE | inpatient/inpatient.service.ts |
| SurgeryService | start | SURGERY_START | surgery/surgery.service.ts |
| SurgeryService | complete | SURGERY_COMPLETE | surgery/surgery.service.ts |

## 미구현 (향후 추가 필요)

### 우선순위 1 — 핵심 워크플로우

| 이벤트 타입 | 발행 시점 | 서비스 | 파일 |
|-----------|----------|--------|------|
| PRESCRIPTION_ADDED | 처방 발행 시 | PrescriptionService | prescription/prescription.service.ts |
| ORDER_CREATED | 오더 생성 시 | OrderService | order/order.service.ts |
| ORDER_COMPLETED | 오더 완료 시 | OrderService | order/order.service.ts |
| LAB_RESULT | 검사결과 도착 시 | LabService | lab/lab.service.ts |
| IMAGING_RESULT | 영상판독 완료 시 | ImagingService | imaging/imaging.service.ts |
| BILLING_CREATED | 수납 생성 시 | BillingService | billing/billing.service.ts |
| BILLING_PAID | 결제 완료 시 | BillingService | billing/billing.service.ts |

### 우선순위 2 — 입원/간호

| 이벤트 타입 | 발행 시점 | 서비스 | 파일 |
|-----------|----------|--------|------|
| BED_TRANSFER | 병실 이동 시 | InpatientService | inpatient/inpatient.service.ts |
| ATTENDING_CHANGE | 담당의 변경 시 | InpatientService | inpatient/inpatient.service.ts |
| ROUND | 회진 기록 시 | InpatientService | inpatient/inpatient.service.ts |
| NURSING_ASSESSMENT | 간호 사정 시 | NursingService | nursing/nursing.service.ts |
| MEAL_ORDER | 급식 주문 시 | NutritionService | nutrition/nutrition.service.ts |
| CONSENT_SIGNED | 동의서 서명 시 | ConsentService | consent/consent.service.ts |
| CONSENT_REVOKED | 동의서 철회 시 | ConsentService | consent/consent.service.ts |

### 우선순위 3 — 안전/품질

| 이벤트 타입 | 발행 시점 | 서비스 | 파일 |
|-----------|----------|--------|------|
| SAFETY_INCIDENT | 안전사건 보고 시 | PatientSafetyService | patient-safety/ |
| FALL_RISK_ASSESSED | 낙상 위험 평가 시 | PatientSafetyService | patient-safety/ |
| INFECTION_DETECTED | 감염 감시 등록 시 | InfectionControlService | infection-control/ |
| ALERT | 이상징후 감지 시 | 각 서비스 | 해당 서비스 |
| FOLLOWUP_SCHEDULED | 추적 예약 생성 시 | ScheduleService | schedule/ |

## 구현 패턴

### 1. 서비스에 JourneyService 주입

```typescript
import { Optional } from '@nestjs/common';
import { JourneyService } from '../journey/journey.service';

@Injectable()
export class MyService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly journey?: JourneyService,
  ) {}
}
```

### 2. 이벤트 발행 (fire-and-forget)

```typescript
this.journey?.emit({
  patientId: '환자ID',
  eventType: 'EVENT_TYPE',       // 위 테이블의 이벤트 타입
  title: '사람이 읽을 수 있는 제목',
  description: '상세 설명 (선택)',
  department: '부서명 (선택)',
  doctorName: '의사명 (선택)',
  severity: 'INFO',              // INFO | WARNING | CRITICAL
  refType: 'encounter',          // 참조 엔티티 (선택)
  refId: 'entity-uuid',          // 참조 ID (선택)
  navUrl: '/patients/xxx',       // 클릭 시 이동 URL (선택)
});
```

### 3. 규칙

- `@Optional()` 필수 — JourneyService가 없어도 비즈니스 로직은 정상 동작
- `this.journey?.emit()` — null-safe 호출
- emit은 비동기 fire-and-forget — 실패해도 비즈니스 로직에 영향 없음
- JourneyModule은 `@Global()` — 별도 import 불필요
- emit 호출은 비즈니스 로직 **완료 후**에 배치 (실패 시 이벤트만 누락)

## 신규 기능 추가 시 체크리스트

새 모듈/기능을 만들 때 아래를 확인하세요:

```
□ 이 기능이 환자와 관련된 행위인가?
  → Yes: 여정 이벤트 발행 필요
  → No: 스킵

□ 어떤 이벤트 타입을 사용할 것인가?
  → 위 테이블에 있으면 해당 타입 사용
  → 없으면 새 타입 정의 (JourneyTab의 TYPE_ICON에도 추가)

□ severity 수준은?
  → INFO: 일반적인 진행 (접수, 진료, 처방 등)
  → WARNING: 주의 필요 (응급, 이상징후)
  → CRITICAL: 즉각 조치 필요 (심정지, 대량출혈)

□ navUrl이 필요한가?
  → 클릭 시 해당 진료/검사/수술 상세로 이동할 수 있으면 설정
```

## 이벤트 타입 등록소

새 이벤트 타입을 추가하면 아래 파일들을 함께 수정하세요:

| 파일 | 수정 내용 |
|------|----------|
| `journey.service.ts` | emit 메서드 (변경 불필요 — 범용) |
| `JourneyTab.tsx` | TYPE_ICON 맵에 아이콘 추가 |
| `seed.ts` | 샘플 여정 이벤트에 추가 (선택) |
| 이 문서 | "현재 발행 지점" 테이블 업데이트 |

## 모니터링

여정 이벤트가 제대로 쌓이고 있는지 확인:

```sql
-- 최근 24시간 이벤트 타입별 건수
SELECT event_type, COUNT(*) 
FROM patient_journey_events 
WHERE event_at > NOW() - INTERVAL '24 hours'
GROUP BY event_type 
ORDER BY COUNT(*) DESC;

-- 이벤트 없는 환자 (입원 중인데 여정 없는 경우)
SELECT a.patient_id, p.family_name, p.given_name
FROM admissions a
JOIN patients p ON p.id = a.patient_id
LEFT JOIN patient_journey_events j ON j.patient_id = a.patient_id
WHERE a.status = 'ADMITTED' AND j.id IS NULL;
```
