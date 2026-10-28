# 환자여정 프로토콜 — QR 기반 역할별 다음단계 체크 UX 기획

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/src/modules/protocol/protocol.controller.ts:16 · apps/api/src/app.module.ts:233 · 잔여: P3 모바일 네이티브 스캔(CLI) — 카메라 스캐너 의존성 0 재확인

> 작성: 2026-06-23 / 상태: Plan v1.2 (검토 보완: 미결 쟁점·아키텍처 결정 — §13)
> 한 줄: **환자 QR을 스캔하면**, 그 환자의 **프로토콜 현재 단계**와 **스캔한 사람의 역할**을 해석해 "지금 내가 해야 할 것"(체크리스트·질관리 게이트)과 **관련 차트**가 자동으로 뜨고, 중요 게이트(특히 **수술전 체크**)는 통과 전 다음 진행을 차단한다.

연계 기존 기획: [hospital-dashboards](./hospital-dashboards.plan.md)(역할 라우팅)·[tablet-chart-view](./tablet-chart-view.plan.md)(타블렛 셸)·[journey-integration](../../05-reference) 패턴.

---

## 1. 배경·문제

- 현재 환자여정은 **사후 기록형**: `PatientJourneyEvent.emit()`으로 이벤트를 쌓고 타임라인·관제(`journey-console`)로 본다(`apps/api/src/modules/journey/journey.service.ts:31`). **다음에 무엇을 해야 하는지(전향적)**·**역할별 할 일**·**진행 게이트**는 없다.
- 질관리 체크는 모듈별로 분산: 수술 IPSG.4 Sign-In/Time-Out/Sign-Out 게이트(`surgery-advanced.service.ts:196`), 간호 체크리스트(`NursingChecklist` SHIFT_HANDOFF·PRE_OP 등), 낙상(`FallRiskAssessment`), NEWS2. **단계 진행 전 "반드시 통과해야 하는 체크"가 한 흐름으로 묶여 있지 않다.**
- 현장(병동·수술실·외래)에서 **QR 스캔은 위치 체크인**까지만(`patient-flow.checkin` + `QrScanModal` BarcodeDetector). 스캔이 **역할 컨텍스트의 할 일·차트**로 이어지지 않는다.

**핵심 요구**: QR 스캔 → (환자 × 프로토콜 단계 × 내 역할) → **해야 할 체크 + 차트 자동 표시** + **게이트 통과 전 진행 차단**(수술전 등).

## 2. 목표·비목표

**목표**
- 프로토콜(외래·입원·수술·응급)을 **단계 상태기계**로 정형화하고, 각 단계에 **역할·액션·게이트·차트뷰**를 매핑.
- 환자 QR 스캔 → **역할별 "다음 할 일" 보드**(스마트폰·타블렛) + 차트 컨텍스트 자동.
- **다음 단계 예측**(due now / upcoming / blocked)과 게이트 미충족 시 진행 차단·알림.
- **수술전 체크**를 하드 게이트로(금식·약물·검사·동의·부위표시·마취평가 + Sign-In/Time-Out).

**비목표**
- BPMN 범용 워크플로우 엔진 도입 아님(경량 단계 상태기계).
- 기존 모듈(수술·간호·청구) 로직 대체 아님 — **오케스트레이션 레이어**로 묶기.
- FCM 신규 인프라 구축 아님(기존 firebase-admin·SSE 재사용).

## 3. 정보모델·아키텍처

### 3.1 신규 모델(오케스트레이션 레이어)
```
ProtocolTemplate            // 프로토콜 정의(외래/입원/수술/응급/검진 …)
  id, code(unique), name, domain(OPD|IPD|SURGERY|ER|CHECKUP), version, status, description
  steps: ProtocolStep[]

ProtocolStep                // 단계(상태기계 노드)
  id, templateId, key, title, sortOrder, phase(8단계 참조),
  ownerRoles(String[] — DOCTOR|NURSE|ANESTH|PHARMACIST|LAB|RADIO|RECEPTION|TRANSPORT …),
  actionType(CHECK|ORDER|SIGN|MOVE|EDUCATE|VERIFY),
  gate(boolean),             // true면 통과 전 다음 진행 차단(질관리 게이트)
  checklistRef,              // NursingChecklist 템플릿/ SurgicalChecklist 단계 참조
  chartView,                 // 스캔 시 자동 표시 차트뷰(summary|vitals|preop|orders|nursing …)
  precondRefs(String[]),     // 선행 조건(예: 검사완료·동의서·금식) — 실데이터 평가
  slaMinutes,                // 예상 소요(예측·지연 판정)
  pathwayMilestoneRef?,      // ClinicalPathway 콘텐츠 참조(중복정의 금지, §13.1)
  transitions: ProtocolTransition[]  // 다음 단계(들) + 분기 조건 ← 예측의 핵심 소스

ProtocolTransition          // 단계 전이(분기) — 예측 엔진이 이 정의를 그대로 평가
  id, fromStepId, toStepId,
  condition(expr|null),      // 분기 조건(예: ktas<=2 / disposition=ADMIT / cancelled). null=무조건
  priority,                  // 동시 만족 시 우선순위(결정적 선택 보장)
  autoAdvance(boolean)       // 조건 충족 시 자동 진행 여부(아니면 역할 액션 대기)

ProtocolInstance            // 환자별 진행 인스턴스
  id, templateId, patientId, encounterId?, admissionId?, surgeryId?,
  currentStepId, status(ACTIVE|BLOCKED|DONE|CANCELLED), startedAt, completedAt

ProtocolStepState           // 단계별 진행 상태
  id, instanceId, stepId, status(PENDING|IN_PROGRESS|DONE|BLOCKED|SKIPPED),
  completedBy, completedAt, blockedReason, checklistInstanceId?
```

### 3.2 재사용 자산(중복 구현 금지)
| 영역 | 재사용 | 위치 |
|------|--------|------|
| 여정 이벤트 | `journey.emit()`·getLocationMapping·timeline | `journey/journey.service.ts:31` |
| QR 토큰·스캔 | `PatientLocToken`·`LocationStation`·`QrScanModal`(BarcodeDetector)·`patient-flow.checkin` | `patient-flow/*`, `workstation/front-desk/QrScanModal.tsx` |
| 환자 팔찌 QR | `PatientHeader` JSON({t:PATIENT,mrn,n,dob,g}) | `patients/[id]/components/PatientHeader.tsx` |
| 수술 체크리스트·게이트 | `SurgicalChecklist` Sign-In/Time-Out/Sign-Out·`assertChecklistReadyForStart` | `surgery/surgery-advanced.service.ts:196` |
| 간호 체크리스트 | `NursingChecklist`(PRE_OP·SAFETY_IPSG 등)·toggleChecklistItem | `nursing/nursing.service.ts:674` |
| 임상경로 | `ClinicalPathway`·`PathwayMilestone`(day 기반 콘텐츠 — **참조만**, 경계 §13.1) | schema:8799 |
| 오더셋 | `OrderSet`(단계별 표준 오더) | `order-set/*` |
| 역할·권한 | `UserRole`·`ROLE_PERMISSIONS`·RolesGuard·RequirePermission | `auth/rbac/permission.types.ts:79` |
| 알림·SSE | `notification.service` SSE·listener·firebase-admin | `notification/*` |
| 타블렛 셸 | `app/tablet`(독립 셸·KioskLock·세그먼트) | `app/tablet/*` |

### 3.3 갭(신규 구현)
- 프로토콜 단계 상태기계(위 모델) + **역할 다음단계 엔진**.
- **QR 스캔 → 역할 컨텍스트 해석 → 액션보드** 진입(스캔 후 라우팅).
- 수술전 체크 **하드 게이트**를 프로토콜 단계로 통합.
- 8단계(Phase) 정형화 + 프로토콜 매핑.
- 다음단계 트리거→수신자 알림 매핑.

---

## 4. ① 환자여정 프로토콜 전체 흐름 분석·관리

### 4.1 생애주기 8 Phase(정형화)
`접수(INTAKE) → 사정(ASSESS) → 계획(PLAN) → 시행(ACT) → 모니터(MONITOR) → 처치/시술(PROCEDURE) → 퇴원·종결(DISCHARGE) → 추적(FOLLOWUP)`
- 각 ProtocolStep는 phase를 참조. 기존 `PatientJourneyEvent.eventType`(RECEPTION_CHECKIN·ENCOUNTER_START·SURGERY_START …)을 phase로 집계.

### 4.2 대표 프로토콜 흐름(상태기계)
**수술(SURGERY)** — 게이트 강조(▣=하드 게이트):
```
[예약 확정] →(NURSE)[수술전 준비 ▣ PRE_OP]
   ├ 금식 확인 · 약물 중단(항응고제 등) · 수술전 검사 완료 · 동의서 · 부위 표시 · 마취 전 평가
 →(NURSE)[입실·신원확인 ▣ Sign-In] →(팀)[Time-Out ▣]
 →(SURGEON)[수술 시작] →(SURGEON)[Sign-Out ▣ 기구·거즈 계수]
 →[회복(PACU) 모니터] →(NURSE)[병동 이송] →[경과·퇴원계획]
```
**외래(OPD)**: 접수→대기→진료(SOAP)→오더(처방/검사)→수납→귀가/예약.
**입원(IPD)**: 입원사정→케어플랜(NANDA-NIC-NOC)→일차 회진·투약·I/O→경과→퇴원요약.
**응급(ER)**: 도착→KTAS 트리아지→처치→재평가→입원/귀가 disposition.

### 4.3 관리 콘솔(`/admin/protocols`) — 예측을 저작하는 곳
- **프로토콜 편집기(그래프)**: 단계 노드 + **전이(엣지)·분기 조건**·역할·게이트·체크리스트·차트뷰·SLA 저작(ClinicalPathway 편집 UX 확장). → **여기서 저작한 정의가 곧 §4.5의 예측 소스.**
- **발행 검증·시뮬레이션**: 막다른 단계·비결정 분기·미지정 역할/게이트 누락 검증(§4.5.3) + what-if 경로 미리보기 후 **버전 발행**.
- **인스턴스 모니터**: 진행 중 환자 × 현재 단계 × 지연(SLA 초과)·게이트 차단 현황(`journey-console` 보드 확장).
- **이탈/지연 분석**: 단계별 평균 소요·게이트 실패율·역할 병목 → 프로토콜 정의 개선 피드백 루프.

---

## 4.5 프로토콜 정의 ↔ 다음단계 예측 연결 (핵심 — 단일 소스)

**원칙: 다음단계 예측은 별도 규칙이 아니라 "관리에서 저작한 프로토콜 정의(ProtocolTemplate)"를 그대로 평가한 결과다.** 관리(저작) ↔ 예측(실행)이 같은 정의를 공유해야 변경이 즉시 예측에 반영되고 불일치가 없다.

```
[관리 콘솔 저작]                         [실행: 다음단계 예측]
ProtocolTemplate(steps·transitions·       ──평가──▶  next-steps 엔진
 gate·precond·ownerRoles·SLA)                         (due-now/upcoming/blocked)
        │ version 발행(immutable)                          ▲
        ▼                                                  │ 실데이터 평가
ProtocolInstance.templateVersion 고정 ───────────────────┘ (체크리스트·검사·동의·시간)
```

### 4.5.1 단일 소스(SSOT)·버전 바인딩
- 예측 엔진은 **하드코딩 분기 없이** 인스턴스가 가리키는 **ProtocolTemplate(steps + transitions)** 만 평가.
- `ProtocolInstance.templateVersion`에 **저작 시점 버전을 고정**(immutable) → 진행 중 환자는 정의 변경에 흔들리지 않음. 신규 환자만 최신 버전 적용.
- 관리에서 단계/전이/게이트/SLA를 바꾸면 → **다음 발행 버전부터 예측이 자동으로 바뀜**(코드 변경 0).

### 4.5.2 예측 = 정의 평가 알고리즘
1. 인스턴스의 `currentStep` + `ProtocolStepState`로 현재 위치 파악.
2. `currentStep.transitions`를 **조건(condition)** 으로 평가(실데이터: 체크리스트 충족·검사완료·동의·KTAS·disposition·경과시간).
3. 충족된 전이의 `toStep` → **upcoming**(예측). gate 미충족이면 **blocked**(+ 누가 무엇을). 현재 단계 ownerRoles ∋ 호출자 역할이면 **due-now**.
4. SLA 타이머·선행조건 충족도로 "곧 진행 가능/지연" 산출. → §5 엔진이 이 결과를 역할 관점으로 반환.

### 4.5.3 관리가 "예측 가능"하려면 저작해야 하는 것(편집기 필수 입력)
- 각 단계의 **전이(다음 단계들)와 분기 조건**(빈 전이=종료). ownerRoles·gate·checklistRef·chartView·precondRefs·slaMinutes.
- 편집기 저장 시 **검증(validation)**: ① 도달 불가 단계·**막다른 단계**(종료 외 전이 0) ② **비결정적 분기**(동일 조건 다중·priority 누락) ③ 순환(의도된 재평가 외) ④ gate 단계의 checklistRef 누락 ⑤ ownerRole 미지정 단계. 위반 시 발행 차단.
- **시뮬레이션/what-if**: 샘플 데이터로 경로를 미리 흘려 예측 경로·게이트·SLA를 검증(발행 전).

### 4.5.4 실시간 재평가(이벤트 구동)
- 체크리스트 토글·검사 완료(`lab.result`)·동의 서명·`journey.emit` 등 **도메인 이벤트 발생 시 해당 인스턴스 재평가** → due-now/blocked 갱신 + 다음 ownerRole 알림(SSE/FCM). 폴링 아님.

### 4.5.5 관리 콘솔 ↔ 예측 화면 일관성
- 관리 콘솔의 단계 그래프(노드=단계·엣지=전이·게이트 표시)와 현장 액션보드의 "현재·다음"이 **같은 정의를 렌더** → 기획자가 본 흐름 = 현장이 보는 다음단계.

---

## 5. ② 역할별 다음단계 예측

### 5.1 역할 다음단계 엔진(`POST /protocols/next-steps`)
입력: `patientId`(또는 instanceId) + 호출자 역할(JWT). 출력:
- **due-now**: 내 역할이 지금 해야 할 단계(현재 단계 ownerRoles ∋ 내 역할 & PENDING/IN_PROGRESS).
- **upcoming**: 곧 내 차례인 단계(선행 단계 진행률·SLA 기반 예측).
- **blocked**: 게이트 미충족으로 막힌 단계 + 차단 사유(누가 무엇을 해야 풀리는지).
- 각 항목에 `chartView`·체크리스트·예상소요·CTA(체크/서명/오더/이송).

### 5.2 역할 × 단계 액션 매트릭스(수술 예시)
| 단계 | 의사(SURGEON) | 마취과(ANESTH) | 간호사(NURSE) | 스탭(이송/원무) |
|------|---------------|----------------|---------------|------------------|
| 수술전 준비 ▣ | 수술 동의·부위표시 확인 | 마취 전 평가·동의 | 금식·약물·검사 체크리스트 | 이송 준비 |
| Sign-In ▣ | — | 마취 안전점검 | 신원·부위·알레르기 확인 | — |
| Time-Out ▣ | 수술명·부위 구두확인 | 항생제 투여 확인 | 팀 소개·계수 시작 | — |
| 수술/Sign-Out ▣ | OP note·계수 확인 | 마취기록 | 거즈·기구 계수 | — |
| 회복·이송 | 회복지시 | 발관·이송기준 | PACU 모니터·이송 | 병동 이송 |

### 5.3 예측 로직 (관리 정의를 평가 — §4.5)
- **소스**: 인스턴스의 고정 버전 ProtocolTemplate의 `steps`+`transitions`. 코드 분기 없음 → 관리에서 바꾸면 예측이 바뀜.
- **선행조건 충족도**: precondRefs(검사완료·동의·금식)를 실데이터로 평가 → 충족 시 "곧 진행 가능", 미충족이 게이트면 blocked.
- **분기 선택**: transitions의 condition 평가 → priority로 결정적 다음단계 선택(예측 경로).
- **SLA 타이머**: slaMinutes 초과 시 지연 플래그·에스컬레이션.
- **푸시 트리거**: 단계 완료/재평가 → 다음 ownerRoles 사용자에게 알림(`notification`/SSE/FCM). 과알림 방지(게이트·지연만).

---

## 6. ③ QR 스캔 → 질관리 체크(스마트폰·타블렛), 특히 수술전

### 6.1 스캔 흐름
1. 현장 사용자(폰/타블렛)가 **환자 QR 스캔**(`QrScanModal` BarcodeDetector 재사용). QR = 환자 팔찌(JSON mrn) 또는 PatientLocToken.
2. 서버가 토큰/MRN → 환자 + 활성 ProtocolInstance 해석. **위치 체크인 이벤트도 동시 발행**(기존 checkin 재사용).
3. **호출자 역할**(JWT)로 다음단계 엔진 호출 → **역할별 액션보드** 진입.
4. 보드: 환자 헤더(이름·나이·알레르기·현재 단계) + **내 할 일(due-now)** + **차트 컨텍스트**(step.chartView 자동) + 게이트 상태.

### 6.2 화면(폰/타블렛)
**스마트폰(세로, 현장 빠른 체크)**
```
┌───────────────────────────┐
│ 강미래 5/여 NKDA  수술전준비 │
├───────────────────────────┤
│ ▣ 수술전 체크 (간호사)     │
│  ☑ 8h 금식 확인           │
│  ☑ 항응고제 중단(48h)     │
│  ☐ 수술전 검사 완료 ←미충족│
│  ☑ 동의서 서명            │
│  ☐ 수술 부위 표시 ←미충족 │
│  ☑ 마취 전 평가           │
│  진행률 4/6 · 게이트 미통과 │
├───────────────────────────┤
│ [차트 보기]  [다음 진행 ✕] │ ← 게이트 미충족 시 비활성
└───────────────────────────┘
```
**타블렛(가로, 병상 옆/수술실)**: 좌 체크리스트(게이트) / 우 차트 컨텍스트(preop 뷰: 검사·동의·바이탈·약물) 동시. (타블렛 독립 셸 `app/tablet` 재사용 — `/tablet/scan` 또는 `/tablet/patients/[id]?step=…`)

### 6.3 수술전 체크 게이트(상세)
- **PRE_OP 체크리스트(간호)**: 8h 금식 / 항응고·항혈소판 중단 / 수술전 검사(CBC·전해질·PT/aPTT·심전도·흉부X) 완료 / 수혈 준비(혈액형·교차) / 동의서(수술·마취·수혈) / **수술 부위 표시(IPSG.4)** / 보철·장신구 제거 / 마취 전 평가(ASA).
- **Sign-In/Time-Out(IPSG.4)**: 기존 `SurgicalChecklist` 게이트 그대로 연계(`assertChecklistReadyForStart`).
- **하드 게이트**: PRE_OP 필수항목 + Sign-In + Time-Out 미충족 시 `[수술 시작]`/`[다음 진행]` 차단(서버 검증 + UI 비활성). 4-eyes(간호 체크 → 의사/마취 확인) 옵션.
- **미충족 항목**은 누가 무엇을 해야 풀리는지 표시 + 담당 역할에 알림.

---

## 7. 보안·권한·감사

- **역할 검증**: 다음단계 엔진·체크/서명은 RolesGuard + Permission. 신규 권한 `protocol:step:complete`·`protocol:gate:override`(override는 ADMIN/지정의·감사기록).
- **QR 토큰**: PatientLocToken(만료·revoke) 재사용. 팔찌 MRN 스캔은 staff 인증 필수(PHI 게이트).
- **게이트 오버라이드**: 응급 시 사유·4-eyes·감사(AuditAction). 무단 진행 차단.
- **PHI 최소노출**: 액션보드는 역할별 필요한 차트뷰만. 키오스크/폰 화면잠금(타블렛 `KioskLock` 재사용).
- **서명**: 게이트 통과·수술 시작은 기존 서명/step-up(Tier2) 연계.

## 8. 단계(P0~P3)

- **P0 — 프로토콜 코어 + 수술전 게이트(가치 집중)**: ProtocolTemplate/Step/Instance/StepState 모델 + 수술 프로토콜 1종(PRE_OP·Sign-In·Time-Out·Sign-Out) + 다음단계 엔진 + **QR 스캔→역할 액션보드(폰/타블렛)** + 수술전 하드 게이트(기존 SurgicalChecklist 연계). **수술전 체크 시나리오 end-to-end.**
- **P1 — 역할별 다음단계 예측·알림**: due-now/upcoming/blocked + SLA 지연·트리거 알림(SSE/FCM). 외래·입원 프로토콜 추가.
- **P2 — 관리 콘솔**: 프로토콜 편집기·인스턴스 모니터·이탈/지연 분석(journey-console 확장).
- **P3 — 예측 고도화·응급**: ER/검진 프로토콜, 선행조건 자동평가 고도화, 8 Phase 집계 리포트.

## 9. 측정 지표
- 수술전 게이트 미충족 적발률·게이트 통과 소요, 단계 SLA 준수율, 다음단계 알림→처리 시간, QR 스캔→액션 진입률, 프로토콜 이탈/지연 건수, 부작용(부위오류·금식미준수) 0 목표.

## 10. 리스크·대응
| 리스크 | 대응 |
|--------|------|
| 오케스트레이션이 기존 모듈과 **이중 상태** | 단계 완료는 기존 모듈 실데이터를 **소스로 평가**(체크리스트·검사·동의 상태 조회), 별도 중복 저장 최소화 |
| 게이트가 응급 진행을 **막음** | override(사유·4-eyes·감사) + 응급 프로토콜 분기 |
| QR 스캔 호환성 | BarcodeDetector 미지원 기기 폴백(수동 MRN·기존 스캐너), 팔찌/위치 토큰 양립 |
| 과알림 | 게이트·지연만 트리거, 역할 수신자 한정 |
| PHI 노출(공용 단말) | 역할별 차트뷰 최소화·KioskLock·토큰 만료 |

## 11. 재사용/갭 요약
- **재사용**: journey.emit·QR 토큰/스캔·SurgicalChecklist 게이트·NursingChecklist·ClinicalPathway·OrderSet·RBAC·SSE/FCM·타블렛 셸.
- **신규**: Protocol 상태기계 모델·역할 다음단계 엔진·QR 스캔 라우팅(역할 컨텍스트)·수술전 하드 게이트 통합·8 Phase 정형화·관리 콘솔.

---

# 13. 검토 보완 — 미결 쟁점·아키텍처 결정 (v1.2)

자체 검토에서 드러난 약점과 결정. **착수 전 합의 필요 항목은 [G] 표시.**

### 13.1 ClinicalPathway vs ProtocolTemplate 경계 (★ 핵심 모호성 해소)
- **문제**: §2에서 `ClinicalPathway`/`PathwayMilestone`를 "재사용"이라 했는데 신규 `ProtocolTemplate/Step`도 도입 → **두 모델이 겹친다**(둘 다 "단계").
- **결정**: 두 모델은 **패러다임이 다르다 — 공존, 역할 분리**.
  - `ClinicalPathway`(기존) = **일차(day) 기반 표준 케어 콘텐츠**(N일차에 무슨 오더·교육·목표). 임상 콘텐츠 SoT.
  - `ProtocolTemplate`(신규) = **상태(state) 기반 진행·게이트·역할 다음단계**(이벤트/조건 구동 상태기계). 오케스트레이션 SoT.
  - **연결**: ProtocolStep는 필요 시 `pathwayMilestoneRef`로 ClinicalPathway 콘텐츠를 **참조만**(중복 정의 금지). 즉 "지금 단계(상태)"는 Protocol, "이 단계에서 권장 오더(콘텐츠)"는 ClinicalPathway.
- (대안 검토: ClinicalPathway에 role/gate/transition을 얹어 단일화 — 기각: day 기반 모델에 상태기계·분기를 억지로 넣으면 복잡·둘 다 망가짐.)

### 13.2 인스턴스 생애주기·다중 인스턴스 [G]
- **생성 트리거**: 입원 생성→IPD, 수술 예약→SURGERY, 외래 접수→OPD, ER 도착→ER 인스턴스 자동 생성(도메인 이벤트 구독). 수동 배정도 허용(관리).
- **다중 동시 인스턴스**: 한 환자가 IPD + SURGERY 동시 가능 → **QR 스캔 시 컨텍스트로 1개 선택**: 위치(LocationStation: 수술실=SURGERY)·역할(마취과=SURGERY)·시간(임박 수술)·없으면 사용자 선택. 차트는 공통.
- **취소·역행**: 수술 취소·악화 시 `transitions`에 **회귀/취소 전이**(예: PreOp→Cancelled, PACU→Ward 재입). 인스턴스 status CANCELLED/재평가.
- **종료**: 종료 전이(빈 transitions) 도달 시 DONE. 여정 이벤트 발행.

### 13.3 단계 완료의 권위 — 파생 우선(이중 상태 방지)
- **원칙**: 단계 DONE은 가능하면 **기존 도메인 실데이터에서 파생**(체크리스트 100%·`surgery.status=IN_PROGRESS`·검사 completed·동의 signed). `ProtocolStepState`는 **캐시/오버레이**(파생 결과·누가·언제)이며 별도 진실 저장 최소화.
- 파생 불가한 순수 절차 단계(예: 이송 시작)만 **명시적 완료**(역할 액션). 멱등(중복 완료 무해).
- 재평가는 도메인 이벤트 구독으로(§4.5.4). → 두 곳에 상태가 갈라지지 않음.

### 13.4 조건식(condition) 안전·결정성 [G]
- `ProtocolTransition.condition`은 **임의 코드 금지** — **화이트리스트 변수 + 제한 연산자**의 안전한 표현식(예: `checklist('PRE_OP').complete && consent('SURGERY').signed`, `ktas <= 2`).
- 변수 카탈로그(평가 컨텍스트): 체크리스트 충족·검사 상태·동의·KTAS·disposition·경과시간·바이탈 임계 등 **사전 정의된 셀렉터만**. 파서는 sandbox(예: 안전식 평가기), 부작용 없음·결정적.
- 발행 검증에서 **조건 변수 유효성·중복/모순 분기** 차단(§4.5.3).

### 13.5 알림 수신자 해석 [G]
- 다음단계 알림은 **역할 풀 전체가 아니라 담당자 우선**: ① 배정자(attending/담당 간호사·집도의) → ② 없으면 해당 병동/수술실 **근무 중 역할 풀** → ③ on-call. 과알림 방지(게이트·지연만, 중복 억제 윈도우 dedup).
- 채널: 인앱 SSE + FCM(기존). 수신/처리 추적(읽음·완료까지 시간).

### 13.6 채널 — 스마트폰/타블렛 범위
- **P0 = 웹**: 스마트폰은 **모바일 브라우저(반응형 액션보드)**, 타블렛은 **독립 셸 `app/tablet`**. QR 스캔은 웹 `QrScanModal`(BarcodeDetector) 재사용. 신규 BE/모델 외 추가 인프라 없음.
- **후속**: `apps/mobile`(Expo) 네이티브 스캔·푸시는 P3+(네이티브 카메라·FCM 백그라운드). P0~P2는 웹으로 완결.

### 13.7 환자 안전 — 오스캔·미스매치·오프라인
- **오스캔 방지**: 스캔 결과 환자와 현재 보던 컨텍스트 불일치 시 경고·재확인(IPSG.1 신원 2-식별자). 게이트 항목 "신원 확인"은 필수.
- **오프라인**(FR-08 범위 외지만 안전 게이트): 네트워크 단절 시 **게이트 통과를 낙관적 진행 금지**(서버 검증 필수). 단절 표시·재시도. 수술 시작 같은 하드 게이트는 서버 `assert` 성공 없이는 불가.
- **부위·측 오류 방지**: 부위 표시 체크는 사진/서명 근거 첨부(타블렛 펜 첨부 P3.1 재사용 가능).

### 13.8 감사·의료법(게이트=법적 기록)
- 게이트 통과·서명·override는 **누가·언제·무엇을** 감사(AuditAction). 수술 안전(IPSG.4)·동의는 법적 보존.
- **override**(응급 진행)는 사유 필수·4-eyes·별도 감사 이벤트·사후 검토 큐.

### 13.9 journey-console 정합(단일 권위)
- 기존 `journey-console`의 "현재 stage"(WaitingQueue/Admission 파생)와 **충돌 금지**: 프로토콜 인스턴스가 있으면 **현재 단계의 권위는 ProtocolInstance**, 없으면 기존 파생 유지(점진 적용). 콘솔은 둘을 합산 표기(프로토콜 우선).

### 13.10 시드·롤아웃
- 초기 프로토콜 시드: **수술(P0)** 1종 우선, 이후 OPD·IPD·ER. 관리 콘솔 발행 또는 seed 스크립트(멱등).
- 롤아웃: 수술실 1곳 파일럿 → 병동 → 외래. config 게이트로 점진 활성.

### 13.11 그 외 보완
- **권한 매트릭스 반영**: 신규 `protocol:step:complete`·`protocol:gate:override`·`protocol:author`(ADMIN/QI)를 `ROLE_PERMISSIONS`에 추가(설계 시).
- **성능**: 재평가는 **해당 인스턴스만**(이벤트→instanceId 스코프). 전수 스캔 금지.
- **측정 baseline**: §9 지표는 도입 전 baseline 수집 후 개선폭 비교.

---

## 부록 — 핵심 시나리오(수술전, 역할 흐름)
1. 간호사가 병상에서 환자 팔찌 **QR 스캔**(폰) → "강미래 · 수술전 준비 · 내 할 일" 보드.
2. PRE_OP 체크리스트(금식·약물·검사·동의·부위표시·마취평가) 진행 → 미충족(검사·부위표시) 표시.
3. 검사 완료·부위표시 후 6/6 → 게이트 통과 → `[다음 진행]` 활성 → 수술실 이송 알림(이송 스탭).
4. 수술실에서 **타블렛**으로 환자 QR 스캔 → Sign-In(간호·마취) → Time-Out(팀) 게이트 → `[수술 시작]` 활성(서버 `assertChecklistReadyForStart` 검증).
5. 각 단계 완료 시 다음 ownerRole에 알림, 여정 이벤트 발행(SURGERY_START 등).
