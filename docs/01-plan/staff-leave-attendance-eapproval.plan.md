# 내부포털 휴가·근태 × 전자결재 통합 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/src/modules/ess/ess.service.ts:302 · apps/api/prisma/schema.prisma:8331 model HolidayCalendar · 잔여: P3-3 결재 인프라 ERP 합의(사람); ESS 휴가 실상신(Clinic W.Sign) · PoC 7건 ERROR(사람)

- **작성**: 2026-07-16 (v3.52.0 기준) · **v1.2** 적대검토+그룹웨어 운영 실측 반영
- **대상**: `/staff` 내부포털 · `/ess` ESS · `/duty-schedule` 당직관리 · EApprovalRelay(전자결재)
- **원칙**: 인사·급여 SoT=ERP(코드에 확립된 원칙 준수) — HIS는 **신청·결재·표시**를 담당하고 확정 데이터는 이벤트로 ERP에 전달. 신규 게이트는 config 기본 OFF 출고.

---

## 1. 현황 진단 (자산 스카우트 + 코드 검증)

### 이미 있는 것 (재사용 자산)
| 영역 | 자산 | 상태 |
|---|---|---|
| 근태 기록 | `AttendanceRecord`(QR/생체/PIN, 미퇴근 자동마감 `provisional`·`autoClosedAt`, 정정 `correctionOf`) + ESS `POST attendance/clock` | ✅ 운영 |
| 휴가 신청 | `LeaveRequest`(+`eApprovalRef`)·`LeaveBalance`·상신/철회 EP·승인 콜백 멱등 처리 | ✅ 운영 |
| 전자결재 백본 | **`EApprovalRelay`**(docType·approvalLine JSON·멱등·W.Sign 릴레이·ERP 콜백 HMAC) — `HR_LEAVE`만 실사용 | ✅ 확장 가능 |
| 당직/근무표 | `duty-schedule` 모듈(자동생성·교대요청·주간시간 위반·공정성 리포트)·`StaffSchedule`·`DutyEntry` | ✅ 운영 |
| 보고라인 | `Staff.managerStaffId`(self-relation)+`PATCH staff/:id/manager` | ✅ 있음 |
| 공휴일 | `HolidayCalendar`(isHoliday) — **영업일 계산에 재사용 가능(현재 휴가와 미연결)** | ✅ 있음 |
| 포털 노출 | `/staff` 타일 런처·`/staff/dashboard`(근무상태·당직표 위젯)·`/staff/ess` | ✅ 있음 |
| ERP 인사 이벤트 | `IntegrationOutbox`+`his_webhooks`(`staff.created/changed`·`staff.attendance_recorded`) | ✅ 배선 |

### 그룹웨어(W-Channel wsign) 연동 실태 — v1.2 운영 실측 (2026-07-16)

| 경로 | 구현 | 운영 상태 |
|---|---|---|
| ERP→HIS→W.Sign 상신 릴레이(`/erp/eapproval/submit`, TEMPLATE_MAP: leave 등 4종) | ✅ 완성(멱등·SSRF 차단·HMAC 콜백) | 🔴 **2026-06-09 PoC 7건 전부 ERROR** — Clinic W.Sign submit 실패(Clinic 측 미완, "C-3" 대기). 이후 시도 없음 |
| ESS 휴가 상신 → 그룹웨어 | ⚠️ **릴레이 레코드만 생성** — 실상신(`erp-eapproval/submit`) 호출은 코드 주석상 "Clinic C-3 연동 시점에 수행" | 운영은 SIMULATION 모드(config `ess.leaveApprovalMode` 미설정=기본값). 6/12 자동결재 2건(승인1·반려1)이 전부 |
| W.Sign 결과 수신 웹훅(`/api/v1/webhooks/clinic`→`handleWsignResult`) | ✅ 배선 | 실수신 이력 없음 |
| 결재선 추천(`approvers`) | ✅ 배선 | **Clinic 조직도 API 위임** — Clinic 미완이면 빈 결재선 폴백 |
| 접속 설정 | `CLINIC_API_URL=https://clinic.example.org`·API 키 서버 env 설정됨 | ✅ |
| ESS 급여신원 릴레이 | `ess.payrollRelay.enabled` | ✅ **운영 ON**(true) |

**시사점**: 그룹웨어 실결재는 Clinic 측 완성(C-3) 대기 상태라, **INTERNAL 결재 모드(P0)가 그룹웨어 완성 전에도 실제 부서장 결재를 가능하게 하는 유일한 경로**다. CLINIC 전환 시 기존 릴레이·웹훅·결재선 추천이 그대로 재사용되므로 P0 설계는 CLINIC 규격과 호환되게(P3-1 변환 어댑터) 간다.

### 문제 (기획의 출발점 — 전부 코드로 확인)
1. **🔴 휴가 신청 이원화**: ESS `LeaveRequest`(전자결재 연동) vs 당직관리 `DutyLeaveRequest`(자체 PENDING 승인, `POST /duty/leave-request` + FE 사용 중) — 같은 휴가가 두 창구·두 데이터로 분산. 연차 차감은 ESS 경로만 수행.
2. **🔴 HIS 내부 결재 단계가 없음**: 현행 `HR_LEAVE` 결재는 ①SIMULATION(일수 기준 **자동** 승인/반려 — `ess.leaveApprovalMode`) ②CLINIC(외부 W.Sign 위임) 두 모드뿐. **부서장이 HIS에서 직접 승인하는 화면·EP가 존재하지 않음** → "결재함"은 조회 UI가 아니라 **INTERNAL 결재 모드 신설**이 본체.
3. **`/staff/approvals`의 실체는 step-up 생체인증 승인함**(`/auth/step-up/push/*`) — HR 결재함이 아님. HR 수신함/상신함은 신설이며, 기존 step-up 섹션과 명확히 분리 표기해야 함.
4. **서버 검증 부재**: 휴가 `days`가 **클라이언트 입력값 그대로 저장** — 영업일 계산 없음(HolidayCalendar 미연결)·잔여 초과 검증 없음·기간 겹침(중복 신청) 검증 없음·fromDate>toDate 미검증.
5. **근태 셀프서비스 미완**: 출퇴근 기록만 존재 — 정정(`correctionOf` 필드만 있음)·초과근무·미퇴근 소명의 결재 흐름 없음.
6. **승인 확정의 후속 부재**: 승인 → 근무표(`DutyEntry`) 반영·인력공백 경고·ERP 근태산정 이벤트 없음. 차감도 ANNUAL 유형만.
7. **근로시간 기준 단일화 오류**: `MAX_WEEKLY = 80` 하드코딩 — **전공의(80h) 기준만 있고 일반직(주52h: 40+연장12) 기준 부재**.
8. **결재선 비정형**: `approvalLine`이 `[{clinic_user_id, step}]` — HIS staffId가 아닌 Clinic ID 기반이라 INTERNAL 모드에 그대로 못 씀.

---

## 2. 목표 IA — 내부포털에 표현할 기능

```
/staff (홈 런처)
 ├─ [위젯] 내 근태 오늘: 출근시각·퇴근버튼·미퇴근 경고(provisional)
 ├─ [위젯] 이번주 근무시간(직군별 기준 게이지: 일반 52h/전공의 80h) · 다가오는 당직
 ├─ [위젯] 연차 잔여 n일(ERP) · [휴가 신청] 바로가기
 ├─ [배지] 결재함: 내가 승인할 문서 n건 (HR 결재 + step-up 합산, 섹션 구분)
 └─ 타일: 내 행정(ESS) · 결재함 · 당직표 · (기존 임상 타일)

/staff/ess (내 행정 — 탭 재편)
 ├─ 근태: 출퇴근 이력 · 정정 신청(결재) · 초과근무 신청(결재) · 미퇴근 소명
 ├─ 휴가: 신청(연차/반차/병가/경조 — 서버 일수계산·잔여검증·증빙 첨부) · 잔여(ERP) · 이력 · 철회
 ├─ 증명서 · 급여 · 자격/교육 (기존 유지)
 └─ 각 신청 = EApprovalRelay 상신 → 결재선 단계 타임라인 인라인 표시

/staff/approvals (결재함 — 재편)
 ├─ [신설] HR 수신함: 내가 결재할 차례(휴가·근태정정·초과근무) — 승인/반려(사유 필수)
 ├─ [신설] 상신함: 내 문서 진행상태(결재선 타임라인) · 승인 후 취소(회수 결재) 요청
 ├─ [기존] 본인인증 승인(step-up push) — 섹션 분리 유지
 └─ 관리승인(4-eyes AdminApproval)은 기존 관리자 화면 유지(혼용 금지)

/staff/team (부서장 전용 — 신설)
 ├─ 팀 캘린더: 부서 휴가+당직 통합 월뷰(인력공백 하이라이트)
 ├─ 팀 근태: 오늘 출근현황·미퇴근·주간근무시간 초과자(직군별 기준)
 └─ 승인 화면 컨텍스트: 같은 날 휴가자 수·최소인력 경고(듀티 제약 재사용)
```

---

## 3. 로드맵

### P0 — INTERNAL 결재 모드 + 휴가 단일화 + 서버 검증 【M】
1. **`ess.leaveApprovalMode=INTERNAL` 신설** (본체): 상신 시 결재선을 HIS 내부에서 해석(`approvalLine: [{staffId, order, role}]` — 기안자의 `managerStaffId` 1단계 기본) → 부서장 수신함 EP(`GET /ess/approvals/inbox`)·승인/반려 EP(`POST /ess/approvals/:relayId/decide`, 반려 사유 필수) → 기존 `leaveCallback` 재사용(멱등 유지). SIMULATION·CLINIC 모드는 보존(전환은 config).
2. **서버 검증 도입**: 일수 서버 계산(HolidayCalendar 영업일·주말 제외, 반차 0.5)·잔여 초과 400(ERP 잔여 조회 실패 시 로컬 폴백, 검증 불가 시 경고 동봉 진행)·기간 겹침(기존 REQUESTED/APPROVED와 교차) 400·역순 날짜 400. `days` 클라이언트 값은 참고치로만.
3. **휴가 경로 단일화**: 당직관리 화면의 휴가 신청을 ESS 경로로 위임(`DutyLeaveRequest` 신규 생성 중단·기존 데이터 읽기 전용 보존·서비스 로직 보존, 오더 게이트웨이 방식). 승인 창구를 결재함 하나로.
4. **/staff 홈 위젯 보강**: 원탭 출퇴근·연차 잔여·결재 배지(HR+step-up 합산)·주간 근무시간(직군별 기준선).
5. **승인→근무표 반영 1차**: 승인 콜백에서 해당 기간 `DutyEntry` 자동 OFF + 당직 겹침 시 부서장 알림(FCM 재사용).

### P1 — 근태 셀프서비스 완결 + 근로시간 기준 정비 【M】
1. **근태 정정 결재**: 정정 신청(누락·시각 오류) → `EApprovalRelay(docType: HR_ATTENDANCE_CORRECTION)` → 승인 시 `AttendanceRecord(correctionOf)` 신규 레코드(원본 불변). 미퇴근 자동마감(`autoClosedAt`) 건은 소명 사유 필수.
2. **초과근무 신청·승인**: 신규 `OvertimeRequest`(연장/야간/휴일·사전/사후 구분) → `HR_OVERTIME` 결재 → 승인분만 주간 근무시간 집계 반영. 사후 신청은 실근태(AttendanceRecord)와 대조 표시.
3. **직군별 근로시간 기준**: `MAX_WEEKLY=80` 하드코딩 → config `duty.maxWeeklyHours.resident(80)/general(52)` + Staff.category 기반 적용. 위반 목록·게이지 모두 직군별로.
4. **승인 확정 ERP 이벤트**: outbox `hr.leave_approved`·`hr.attendance_corrected`·`hr.overtime_approved`(멱등키=relayId) — ERP 근태산정·급여 반영은 ERP 소관. **이벤트 스키마 3종 ERP 합의 선결.**
5. **결재 알림·SLA**: 수신 시 FCM+Notification, N일 미결 시 리마인더·`managerStaffId` 체인 상위 에스컬레이션(config).

### P2 — 휴가 고도화 + 팀 뷰 【M】
1. **휴가 유형·증빙**: 경조/병가 증빙 첨부(`StaffDocument` 암호화 재사용·**민감정보라 열람권한 본인+결재선 한정, 감사로그**)·반차(0.5)/시간단위 연차(근로기준법 §62 시간단위 허용 — ERP 정책 합의 후)·`LeaveBalance` 유형별 차감 정밀화(현재 ANNUAL만 차감).
2. **승인 후 취소(회수)**: 승인 완료 건 취소는 **새 결재 문서**(`HR_LEAVE_CANCEL`)로 — 승인 시 차감 복원+근무표 원복+ERP 취소 이벤트. 원문서 직접 수정 금지(감사 보존).
3. **팀 캘린더(/staff/team)**: 부서 휴가+당직 월뷰·같은 날 휴가자 수·최소인력 경고(듀티 제약 함수 재사용). 승인 화면에 컨텍스트 동봉.
4. **대결(위임)**: 부서장 부재 시 결재 위임(기간·대상 지정, `managerStaffId` 체인 폴백)·위임 이력 감사.

### P3 — 결재 인프라 정식화 【M~L】 — ✅P3-1/P3-2 완료(2026-07-18, `approval-registry.ts`) · P3-3 ERP 합의 대기
1. **채널 어댑터 계층**: 공통 인터페이스(`submitDoc/getStatus/recommendApprovers/normalizeWebhook`) + 채널별 구현(CLINIC=기존 clinicApi 래핑·WCHANNEL=신규·INTERNAL=HIS 내장) — 결재선 표현 변환(INTERNAL `[{staffId, order, role}]` ↔ CLINIC `[{clinic_user_id, step}]` ↔ W-Channel 규격) 포함. 모드 전환 시 데이터 호환.
2. **결재 문서 타입 레지스트리**: docType별 필수필드·기본 결재선 템플릿·**결재 채널 라우팅**(문서 타입마다 다른 그룹웨어 지정 가능)·승인 후 훅(근무표 반영·차감·ERP 이벤트) 선언적 등록.
3. **조직 정규화 검토**: `department` 문자열 → 코드마스터 FK 승격 여부 — **ERP 조직도가 SoT이므로 HIS는 스냅샷 캐시 방식 권장**(ERP 합의 선결).

---

## 4. 데이터·연동 설계 원칙

| 항목 | 결정 | 근거 |
|---|---|---|
| 휴가 정본 | `LeaveRequest`(HIS 신청·결재 상태) + 연차 잔여는 ERP read·로컬 폴백 | 기존 ESS 설계 유지 |
| 결재 채널 | **최종(7/17 3차 결정): HR 라우팅 = W.Sign(wsign) 유지 + HIS→W.Sign 조직도 동기화 선결**. 앞선 "조직도 체계 상이" 사유를 채널 변경이 아니라 **조직도 싱크로 해소**. `ApprovalChannel = SIMULATION \| INTERNAL \| WCHANNEL(현 wsign 경로) \| CLINIC(향후 후보)`. 파킹했던 wsign 리허설은 싱크 후 재개(검증 자산 유효). 조직도 싱크 방식은 A(pull 디렉터리API)/B(push 어댑터·권장)/C(웹훅 구독) 중 W.Sign 회신으로 확정 — `relay-wsign-org-sync-request.md`. EApprovalRelay는 채널 무관 단일 백본 | 조직도 싱크가 더 싼 해법(사용자 3차 결정) |
| AdminApproval | 고위험 관리작업 4-eyes 전용 유지 · step-up push 승인함과도 분리 표기 | 용도 3분리 |
| 근태 원본 | `AttendanceRecord` 불변 — 정정은 `correctionOf` 신규 레코드 | 의무기록 정정 관례와 동형 |
| 일수 계산 | 서버 단일 계산(HolidayCalendar 영업일) — 클라이언트 값 불신 | 검증 규범 |
| 차감 시점 | 승인 콜백 시 차감(현행 유지) + 신청 시 잔여 검증으로 초과 예방. 동시 신청 경합은 콜백 멱등+잔여 재검증 | 가차감 복잡도 회피 |
| ERP 반영 | 승인 확정만 outbox 이벤트(멱등키=relayId). ERP 미연동 항목은 SIMULATION 즉시콜백 | 배치중립·SoT |
| 개인정보 | 병가 증빙=민감정보(열람 최소화·암호화·감사)·클록 위치정보(lat/lng)는 수집 고지 문구 포털 표기 | 개인정보보호법 |
| 게이트 | `ess.leave.unified`·`ess.attendanceCorrection.enabled`·`ess.overtime.enabled`·`ess.teamView.enabled` — 기본 OFF, 데모 ON | 관례 |

## 5. 비범위 (Out of Scope)

- 급여 계산·연차 부여/촉진 정책 엔진(ERP 소관 — HIS는 잔여 표시·촉진 대상 표시까지만)
- 조직도 편집·인사발령(ERP 소관)
- 근태 전용 하드웨어 단말(현행 QR/생체/PIN 유지)
- 52시간제 법적 "판정"(위반 표시까지만 — 판정·조치는 사람)
- 교대근무(간호 3교대) 패턴 편성 엔진 — 기존 duty-schedule 자동생성 유지, 본 기획은 신청·결재 흐름만

## 6. 사람 게이트 (선결 합의)

| # | 항목 | 상대 |
|---|---|---|
| G-1 | ERP 이벤트 스키마 3종(leave_approved·attendance_corrected·overtime_approved) | ERP 팀 |
| G-2 | 결재선 기본 템플릿(부서별 1차 결재자)·대결 규정 | 행정 |
| G-3 | 시간단위 연차·유형별 차감 정책(반차 처리 등) | 행정+ERP |
| G-4 | 클록 위치정보 수집 고지 문안 | 법무/행정 |
| G-5 | **W.Sign 조직도 동기화 방식 회신(A pull/B push/C 웹훅)+매핑키·신규계정·재직상태 정책** — 확정 후 백필→결재선 추천 검증→리허설 재개(§4 일정). 요청서 `relay-wsign-org-sync-request.md` | W.Sign 팀 |
| G-6 | ~~Clinic 자체 전자결재 연동~~ → **철회(7/17 3차 결정 — W.Sign+조직도 싱크로 해소)**. `relay-clinic-eapproval-request.md`는 미발신 폐기, 향후 채널 필요 시 재활용 | — |

## 7. 검증 계획

- 각 페이즈: 스펙 + `smoke-e2e.sh` 항목 추가(수신함·클록·잔여 EP) + 운영 실측
- **P0 실측 시나리오**: ①간호사(yoon.ganho) 연차 상신(서버 일수계산 — 공휴일 낀 기간으로 검증) → ②잔여 초과 신청 400 → ③기간 겹침 400 → ④부서장 수신함 승인 → 차감·DutyEntry OFF·타임라인 반영 → ⑤반려 사유 필수 확인 → ⑥SIMULATION 모드 회귀(기존 데모 무영향)
- 회귀 유의: `leaveCallback` 멱등(APPROVED 재수신)·기존 `eapproval-callback`(X-Integration-Key) 경로 보존

## 8. 적대 리뷰 하드닝 (2026-07-18, PR#530)

P0~P3 신규 결재 코드 3축 적대 리뷰 → 확정 5건 수정·회귀 스펙:
- **[HIGH] teamCalendar 인가 우회**: `department` OR 조건이 평사원·부서=null 계정에 전 부서/전 조직 휴가 노출 → 부서장 판정을 실제 직속 보고자(`managerStaffId=me.id`) 존재로 재정의
- **[HIGH] 콜백 멱등 TOCTOU**: leaveCallback·applyLeaveCancel·applyCorrectionDecision·applyOvertimeDecision이 read-then-write라 동시 콜백 이중 차감/복원·정정 이중 생성 → 조건부 `updateMany(where status=전이전)` 원자 claim. 운영 실측: 승인 콜백 5개 동시 발사에도 차감 1회
- **[MED] HALF 우회**: 반차를 장기 기간+0.5일 차감으로 근무표 OFF 장기 점유 → 당일(from=to) 강제
- SIMULATION 자동승인 판정을 서버 computedDays 기준으로
- 결재/위임/회수/증빙 IDOR·수신함 스코프는 견고 확인(우회 경로 없음)
