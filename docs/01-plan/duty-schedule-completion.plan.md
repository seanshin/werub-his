# [기획] 당직·근무표(duty-schedule) 완비

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/prisma/schema.prisma:11651 · apps/api/prisma/schema.prisma:11670 · apps/api/prisma/schema.prisma:11688 · 잔여: 없음

- **작성**: 2026-07-19
- **대상**: `/admin/duty-schedule` — 대학병원급 당직/근무표 관리 완비
- **성격**: 기획서(구현 전). Phase별 착수 단위 정의.

## 1. 배경 — 현황과 핵심 문제

### 🔴 두 개의 병렬 시스템 (근본 문제)
동일 목적의 백엔드·화면이 2벌 존재하며, **관리자 화면이 약한 쪽에 연결**되어 있어 이미 구현된 강한 기능이 사장됨.

| | 강한 시스템 | 약한 시스템 |
|---|---|---|
| 백엔드 | `DutyScheduleService` `/api/v1/duty/*`(12 EP) | `WorkgroupService` `/api/workgroup/duty/*` |
| 모델 | `DutyEntry`(+Swap/Leave 전용) | `StaffSchedule` |
| 기능 | 자동편성(연속야간 제약)·통계·공정성·주52/80h 위반·교대(실제 교환)·시간조회·당직조회 | 조회·단순 자동배정(제약 無)·교대(SystemConfig 저장·미반영 껍데기) |
| 연결 화면 | `/duty-schedule`(일반, 4탭) | **`/admin/duty-schedule`(관리자)** ← 완비 대상 |

→ **관리자가 통계·공정성·근로시간 위반을 전혀 못 봄.** 자동편성도 제약 없는 약한 로직을 씀.

### 이미 구현된 것(강한 계열·미노출)
공정성 리포트(표준편차 fairnessIndex)·주52/80h 위반 탐지(직군별·config 오버라이드)·연속야간 제한·부서/개인 통계·교대 실제 교환(트랜잭션)·휴가→OFF 자동반영/원복·ESS 팀 캘린더(부서장·understaffed 경고)·초과근무 승인분 시간 합산·ERP duties 프록시(개인포털).

## 2. 목표
1. 관리자 화면을 강한 백엔드로 통합해 **기존 기능 즉시 활용**.
2. 규칙기반 편성(오프 자동·전이규칙·인력기준)으로 **간호 3교대 실무 수준** 달성.
3. 당직표(on-call) 개념·근로시간 사전차단·교대 전자결재 워크플로 완결.
4. 모델 이원화(StaffSchedule↔DutyEntry) 정합성 해소.

## 2.5 규제·직군 체계 (편성 제약의 근거)

### 직군별 근무 체계 (분리 설계 필수)
| 직군 | 체계 | 모델(현행) | Phase |
|---|---|---|---|
| **간호** | 3교대(D/E/N/off)·야간전담·병동 단위 | DutyEntry·StaffSchedule | P0·P1 |
| **의사(전공의/전문의)** | 과별 on-call(당직) 1st/2nd·응급 콜 | OnCallSchedule(신규) | P2 |
| **기타(약사·기사 등)** | 부서 근무·당직 | DutyEntry | P1 |

→ 자동편성·규칙·통계를 **직군별로 분리**해야 함(간호 3교대 규칙을 의사 당직에 적용 불가).

### 규제 준수 (편성 hard/soft 제약의 법적 근거)
- **근로기준법**: 주 52시간, 주휴·연장 한도, 근무간 최소 휴게.
- **전공의 특별법**: 주 80시간(교육 8h 포함 88h)·연속근무 36시간(응급 40h)·근무간 최소 10시간·응급실 주 60시간·당직 주 3회 이내. → 전공의 편성은 별도 한도(P1 config).
- **간호인력 기준**: 간호관리료 차등제(병상당 간호사 수 등급)·야간전담간호사·나이트 개수 상한·연속 나이트 제한. → 인력기준(DutyStaffingRule)에 간호등급·야간 규칙 반영(P1).
- 위반은 **탐지→사전 차단/경고**(P1). 강제 수준은 config(OFF/WARN/BLOCK)로 병원 정책에 맞춤.

> 현행 위반 탐지(`duty-schedule.service.ts:176`)는 직군별 한도(config 오버라이드)를 이미 갖췄으나 **전공의법 세부(연속36h·근무간10h)·간호 야간규칙은 미반영** — P1에서 보강.

## 3. Phase별 계획

### P0 — 관리자 화면 강한 백엔드 재배선 + 이원화 통합 뷰 (최우선)
목표: `/admin/duty-schedule`를 `/api/workgroup/duty/*`(StaffSchedule) → `/api/v1/duty/*`(DutyScheduleService)로 교체. 이미 있는 통계·공정성·위반·시간·교대를 관리자에 노출.

> ⚠ **재배선 함정(반드시 처리)**: 휴가 OFF는 `StaffSchedule`(ess.service 휴가승인→OFF upsert), 당직은 `DutyEntry`에 기록된다. 관리자를 DutyEntry 전용으로 재배선하면 **휴가 OFF가 화면에서 사라진다**. 따라서 P0는 단순 교체가 아니라 **두 소스를 병합한 조회 뷰**가 전제다.
> - **통합 조회 계층**: `getSchedule(month, dept)`가 DutyEntry(근무·당직) + StaffSchedule(OFF·휴가) + LeaveRequest(승인 휴가)를 날짜·직원 기준 병합해 반환(읽기 전용 조인 — 모델 통합은 P3, P0는 뷰만). 충돌(같은 날 근무+OFF)은 경고 표시.
> - ess 팀 캘린더(`ess.service.ts:604`)가 이미 DutyEntry+LeaveRequest 병합 패턴을 가지므로 그 로직 재사용.

- FE: 관리자 페이지에 탭 추가(당직표·통계·공정성·근무시간/위반·교대승인). 일반 `/duty-schedule` 4탭 컴포넌트 재사용.
- 자동편성 버튼 → `POST /api/v1/duty/auto-generate`(연속야간 제약 있는 강한 로직)로 교체. 약한 `auto-assign` 관리자 노출 제거.
- 수동 배정 → `/api/v1/duty/assign`. 부서 필터 UI 추가(백엔드 이미 지원).
- OFF·휴가·근무·당직 통합 표시(위 조회 뷰)·오늘 당직·월 이동 유지.
- 게이트: 없음(화면 재배선). 약한 WorkgroupService duty EP는 하위호환 유지(제거는 P3).
- 검증: 관리자에서 통계/공정성/위반 노출·강한 자동편성·**휴가 OFF가 당직표에 함께 표시**·충돌 경고.

### P1 — 규칙기반 편성 + 근로시간 준수 강제
목표: 자동편성을 실무 규칙 반영으로 강화, 위반 "탐지"→"사전 차단/경고".

> ⚠ **자동편성 현실성**: 완전 자동 최적 편성은 제약만족(CSP·NP-hard)으로, 모든 규칙·선호·인력기준을 동시 만족하는 해가 없거나 계산이 비쌀 수 있다. **완전 자동을 목표하지 않는다** — (a)규칙 위반을 **최소화한 초안 생성**(greedy+공정성 정렬, 현 로직 확장), (b)**위반·미달을 명시 표시**하고 수간호사/의국이 **수동 조정**, (c)조정 시 실시간 규칙 재검증(hard=차단·soft=경고). "초안 자동 + 사람 조정 + 규칙 가드"가 현실적 목표.
- **근무 전이 규칙**: Night→Day 금지, 연속근무일수 제한, 근무간 최소 인터벌(11h), 연속야간 후 필수 OFF(N-off-D 패턴). `duty-schedule.service.ts` autoGenerate에 제약 추가(현 maxConsecutiveNights 확장).
- **인력기준(min staffing)**: shift·부서·요일별 최소 인원 마스터. 신규 모델 `DutyStaffingRule`(부서·shift·dayType·minCount·간호등급). 편성이 이 기준 충족·미달 경고.
- **오프 자동계산**: 주간 근로시간·연속근무 기반 OFF 자동 배치.
- **사전 차단(hard/soft)**: assign·auto-generate 시 주52h·연속근무·인터벌 위반이면 BLOCK(hard) 또는 WARN(soft). config `duty.constraint.enforce`(OFF/WARN/BLOCK).
- 신규 모델: `DutyStaffingRule`(additive), 근무규칙은 config.
- 검증: 규칙 위반 편성 차단·인력미달 경고·오프 자동.

### P2 — 당직표(on-call) + 교대 워크플로 완결
목표: 3교대와 별개인 당직(on-call) 개념 도입, 교대/대체 신청을 전자결재로 완결.
- **당직표(on-call)**: 신규 모델 `OnCallSchedule`(과별·날짜·1st/2nd call·담당의). 3교대 shift와 분리. 과별·요일별 로테이션 자동생성. 응급 호출 체계(1st→2nd) 표현.
- **교대/대체 신청 완결**: 약한 계열 SystemConfig 껍데기 제거. 강한 `DutySwapRequest`를 **ESS 전자결재선(EApprovalRelay docType=HR_DUTY_SWAP)** 에 연동 — 상대 직원·부서장 승인 → 승인 시 DutyEntry 실제 교환(기존 handleSwap 트랜잭션 재사용). 관리자/직원 승인 UI.
- 근무 교환이 근로시간 규칙(P1) 재검증 후 반영.
- 검증: 당직 로테이션·교대 전자결재 승인→실제 교환·규칙 재검증.

### P3 — 인쇄/공유/알림/선호신청 + 모델 정합성
- **인쇄/내보내기**: 근무표 PDF·엑셀·인쇄 레이아웃(월/주·부서별). 팀 공유.
- **알림**: 배정 완료·교대 요청·위반 발생·근무 D-1 리마인더 푸시(기존 notification).
- **개인 선호/기피 신청(request-off·wish)**: 편성 전 직원 희망 수집 → 자동편성이 우선 반영. 신규 모델 `DutyPreference`.
- **모델 정합성 해소**: StaffSchedule(휴가OFF·FK·unique)와 DutyEntry(당직·비정규화) 이원화로 통합 뷰 깨짐. 방안 — (a)단일 모델 통합 또는 (b)조회 계층에서 조인 뷰 제공. 마이그레이션 신중(운영 데이터·db push 금지).

## 4. 모델·API 변경 요약
- 신규(additive): `DutyStaffingRule`(P1)·`OnCallSchedule`(P2)·`DutyPreference`(P3). 전부 nullable/신규 테이블.
- docType 추가(P2): `HR_DUTY_SWAP`(전자결재 교대 승인) — 기존 DocTypeRegistry 확장 1건.
- config 게이트: `duty.constraint.enforce`(P1)·`duty.onCall.enabled`(P2) 기본 OFF.
- 기존 `/api/v1/duty/*` 재사용·확장. 약한 `/api/workgroup/duty/*`는 하위호환 후 P3 정리.

## 5. 제약·원칙
- 운영 데이터 보존: 근무표·휴가OFF 데이터 손실 금지(모델 통합 시 마이그레이션 백업). `db push --accept-data-loss` 금지.
- 전자결재 재사용: 교대 승인은 기존 EApprovalRelay/DocTypeRegistry 백본 확장(새 엔진 금지).
- 게이트 기본 OFF·점진 활성화. 근로시간 사전차단은 WARN부터.
- 휴가·근태·초과근무 연계 정합(ESS 단일화 `ess.leave.unified` 존중).

## 6. 검증 포인트
- P0: 관리자 통계/공정성/위반 노출·강한 자동편성.
- P1: 규칙 위반 차단·인력미달 경고·오프 자동·주52h 사전차단.
- P2: 당직 로테이션·교대 전자결재 승인→실제 교환·규칙 재검증.
- P3: 인쇄·알림·선호 반영·통합 뷰 정합.

## 7. 우선순위 권고
**P0(재배선+통합뷰)이 압도적 우선** — 코드 대부분이 이미 있고 화면 연결+조인 뷰만 하면 통계·공정성·위반이 즉시 관리자에 노출됨(저비용·고효과). P1(규칙편성)이 실무 완성도의 핵심. P2(당직·교대전자결재)·P3(인쇄·알림)는 순차.

## 8. 리스크·완화
| 리스크 | 완화 |
|---|---|
| **모델 이원화 통합(P3) 마이그레이션** — 운영 근무표·휴가OFF 데이터 손실 | P3 지연·백업 필수·db push --accept-data-loss 금지. P0~P2는 조인 뷰로 통합 없이 진행(통합은 최후) |
| **P0 조인 뷰 성능** — 대규모 직원×월 병합 | 부서·월 범위 제한·FK 인덱스. 팀 캘린더 병합 패턴이 이미 부서장 단위로 검증됨 |
| **자동편성 수용성** — "완전 자동" 기대 시 실망 | 기획·UI에서 "초안 자동+수동 조정+규칙 가드" 명확히(§P1). 완전 최적화 미약속 |
| **약한 계열(WorkgroupService duty) 제거(P3) 시 타 사용처 영향** | P0에서 제거 않고 하위호환 유지. 제거 전 사용처 전수 확인(grep) |
| **규제 게이트 오설정** — BLOCK 과하면 편성 불가·응급 마비 | 기본 OFF→WARN→BLOCK 점진. 응급 우회(사전승인 패턴 재사용). 병원 정책 config |
| **전공의법 세부 미반영 리스크** — 연속36h·근무간10h 누락 시 규제 위반 방치 | P1에서 전공의 직군 별도 한도 config·검증 스펙 |

## 9. 참고 — 재사용 가능한 기존 자산
- 강한 백엔드 12 EP(`/api/v1/duty/*`): 자동편성·통계·공정성·위반·시간·교대(트랜잭션)·당직조회 — P0에서 즉시 활용
- ess 팀 캘린더 병합 로직(`ess.service.ts:604`) — P0 조인 뷰 기반
- 전자결재 백본(EApprovalRelay·DocTypeRegistry) — P2 교대 승인(HR_DUTY_SWAP)
- 휴가 OFF 연계(`ess.service.ts:1198·524`)·초과근무 시간 합산(`duty-schedule.service.ts:189`)
- 일반 `/duty-schedule` 4탭 FE 컴포넌트 — P0 관리자 재사용
