# 경보 등록부 · 예산 · 역할 라우팅 — 기획서 (AgentEMR 2단계 2-5·2-6·2-7)

> 작성 2026-08-19 · 상태 **P0 1차 적용(같은 날 저녁)** · P1 부터 사람 게이트 3건 선행 · 정본 위치는 §0.
> 이 문서는 "경보를 더 단다"가 아니라 **경보를 셀 수 있게 만든다**는 문서다. 세지 못하는 것은 예산을 정할 수 없고,
> 예산이 없는 경보는 읽히지 않는다(실측 읽음률 8.6%).

## 0. 이 문서의 위치 — 정본이 둘이 되지 않게

| 축 | 정본 | 이 문서와의 관계 |
|---|---|---|
| 경보 UX 규약(3요소·줄어드는 목록·억제·라우팅) | `clinical-ux-agent-era.plan.md` §5 | 그 규약을 **구조(등록부)** 로 강제하는 실행 계획 |
| AgentEMR 2단계 항목 2-5(등록부)·2-6(예산)·2-7(라우팅) | `agent-emr-alignment.plan.md` §2단계 | 그 세 항목의 상세 설계. 완료 시 그 표를 갱신한다 |
| 안전 게이트 관제(`GateDef`·3상·위반 통계·자동수집 분류기) | `modules/safety-gate/safety-gate.service.ts` · `/admin/safety-gates` | 🔴 **새로 만들지 않는다.** 등록부는 `GateDef` 와 같은 자리에서 시작한다(§3.1) |
| 알림 정본(발화·심각도 3단계·dedupWithinHours) | `modules/notification/notification.service.ts`·`notification.listener.ts` | 발화 경로는 그대로 두고 **등재 조회**를 앞에 끼운다 |
| 위급값 통보(read-back·확인 원장) | `CriticalValueAlert` 모델 · IPSG.2 | 등록부의 tier 1 선례. 건드리지 않는다 |
| 루프 플랫폼(LoopSpec) `budgets.alerts` | `loop-platform-adoption.plan.md` §3-B7 | 선언형이 요구하는 `min_ppv` 는 **이 등록부의 baseline 이 선행**돼야 한다 |

## 1. 실측 — 무엇이 얼마나 있는가 (2026-08-19 · 기계 계측)

계측 방법(재현 가능): `apps/api/src/modules` 에서 `notify*/create(` 호출 뒤 600자 안의 `type: '…'` 을 추출 + `notification.listener.ts` 의 `@OnEvent` 수.

| 지표 | 실측 | 의미 |
|---|---|---|
| 직접 발화 지점(`notify`·`create` 호출) | **56곳 · 유형 41종**(`type` 미검출 12곳 = 변수/상수로 넘김) | "59종"(AgentEMR 실측)과 같은 크기의 산재 — **목록이 코드에만 있다** |
| 이벤트 경유 발화(`@OnEvent`) | **31핸들러**(위급값·EWS·낙상·자살위험·신생아·구속·RCA·자간전증·태아곤란·호스피스 통증…) | 임상 안전 경보의 본체. tier·역할·억제가 핸들러마다 다르다 |
| 중복 억제(`dedupWithinHours`) | 직접 발화 **0곳** · 리스너 **3곳** | 크론 반복 경보 대부분이 억제 없음 |
| tier / target_role / embedded_action 필드 | **없음**(`Notification` = type·title·message·severity·refType/refId) | 4계층 중 2계층(severity)만 표현 가능 · "무엇을 하면 꺼지는가"가 없다 |
| 역할 라우팅 | 임상 경보 전량 **주치의(attending) 직행** — 약사·RRT·전담간호사 우선 라우팅 0 | 주치의가 무뎌진다(§5.4) |
| baseline | `GateViolationLog` 1행 · notifications 348행 중 **읽음 8.6%**(CRITICAL 93 중 2건) · 미확인 알림은 180일 뒤 크론 **삭제** | 예산을 정할 분모가 **없다** — 탐지기가 살아 있는지부터(v4.4.0 교훈) |
| 억제·강등 근거(override율·확인 소요) | DUR override 는 절대 건수만 · 확인 소요시간 미계측 | 자동 강등 규칙을 세울 수 없다 |

🔴 판정: **등록부가 없어서 경보가 많은 것이 아니라, 등록부가 없어서 몇 개인지·누구에게 가는지·꺼지는 조건이 무엇인지를 아무도 모른다.** 첫 단계는 예산이 아니라 **인구조사**다.

## 2. 목표 · 비목표

**목표**
1. **등재돼야 발화** — 모든 임상 경보가 코드 한 곳(등록부)에 있고, 발화 시 등록부를 조회한다. 미등재는 막지 않되 **표식·자동수집**된다(거짓 경보를 죽이는 쪽으로 오작동하면 안 된다).
2. 경보마다 **tier·대상 역할·억제 창·내장 액션·승인자·재검토일** 이 있다(§3.1).
3. **분모가 있는 계측** — 코드별 발화·읽음·확인 소요·override(분모=발화) 를 관제 화면이 `n / N` 으로 낸다(`<Ratio>` 정본).
4. **역할 라우팅** — 등록부의 target_role 이 발화 대상을 정한다. 주치의는 "마지막" 이지 "기본"이 아니다.
5. 예산·One-in-One-out·자동 강등은 **baseline 30일 이후**에만 켠다(§4 P2).

**비목표**
- 새 알림 채널·새 모델 대량 신설(× — `Notification`·`GateViolationLog`·`CriticalValueAlert` 를 그대로 쓴다)
- 경보를 늘리는 것 · LLM 이 경보를 만드는 것(폐쇄망/위탁 결정과 무관하게 이 문서는 LLM 을 쓰지 않는다)
- 환자 대면 알림(포털·모바일 리마인더)은 이 등록부 밖(별도 어휘)

## 3. 설계

### 3.1 `AlertDef` — `GateDef` 옆에서 시작한다(새로 만들지 않는다)

```ts
// modules/notification/alert-registry.ts (코드 정본 — 값은 여기 복사하지 않는다 · 순수 데이터라 safety-gate 에서도 import 가능)
interface AlertDef {
  code: string;                 // = Notification.type / 이벤트명 (기존 어휘 그대로 등재 — 어휘를 바꾸지 않는다)
  label: string;
  domain: 'LAB' | 'MED' | 'NURSING' | 'ER' | 'OR' | 'OB' | 'PSY' | 'SAFETY' | 'INFECTION' | 'ADMIN' | 'BILLING' | 'CRM';
  tier: 1 | 2 | 3 | 4;          // 1 즉시·확인 필수(read-back) · 2 당일 조치 · 3 근무 내 · 4 정보
  targetRoles: UserRole[];      // 라우팅 정본 — 비어 있으면 등재 불가(발화 대상 없음이 곧 경보다 §5.4)
  fallbackRole?: UserRole;      // 대상 역할에 온콜/담당이 없을 때(주치의는 여기로 내려온다)
  dedupHours: number | null;    // 같은 대상·유형·refId 재발송 억제 창(null=억제 없음 — 이유를 note 에)
  embeddedAction: { label: string; href?: string; api?: { method: 'POST'|'PATCH'; path: string } } | null; // 없으면 등재 불가(§5.1 3번)
  escalation?: { afterMinutes: number; to: UserRole[] };
  approvedBy: string;           // 위원회/부서 (없으면 'UNAPPROVED' — 관제가 표시)
  reviewDue: string;            // ISO date — 지나면 관제 배지
  budgetClass: 'SAFETY' | 'WORKFLOW' | 'INFO'; // 예산 계급(§3.4)
  thresholds?: { minPpv?: number; maxNne?: number }; // 자동 강등 근거(§3.4 · P2 전에는 미사용)
  note?: string;
}
```

규칙
- **어휘는 기존 것을 등재한다**(`CRITICAL_VALUE`·`lab.critical.value`…). 이름을 바꾸면 소비처가 갈라진다(v4.4 교훈 "어휘 정본≠전 소비처 사용").
- 등재 조건 3개가 전부 있어야 한다: `targetRoles` 비어 있지 않음 · `embeddedAction` 있음 · `tier`. **셋 중 하나가 없으면 등재 자체가 실패**(구조 가드).
- 🔴 **미등재 코드의 발화를 막지 않는다.** `NotificationService.create` 는 등록부에 없으면 `meta.unregistered=true` 로 그대로 보내고, 관제가 미등재 코드를 **자동 수집**한다(안전 게이트 분류기 `classifyGateEntry` 선례). 막으면 방치된다.

### 3.2 발화 경로 — 앞에 조회 하나만 끼운다

- `NotificationService.create/notify` → `AlertRegistry.lookup(type)` → 있으면 `severity`(tier→severity 매핑)·`dedupHours`·`targetRoles` 를 **기본값**으로 채운다(호출자가 준 값이 있으면 호출자 우선 — 회귀 0).
- 리스너 31핸들러는 손대지 않는다. 등록부에 코드만 등재하고, 등재 여부는 관제가 보여준다.
- 라우팅 전환은 **코드별로**(P1) — `targetRoles` 로 보내고 주치의는 `fallbackRole`. 전량 일괄 전환 금지(경보 유실 위험).

### 3.3 계측 — 분모부터

관제(`/admin/safety-gates` 옆 탭 "경보 등록부") 가 코드별로 낸다:
- 발화 N(30일) · 읽음 n/N · 읽음까지 중앙값(분) · 확인 소요(tier1 = read-back 원장) · override n/N(있는 코드만) · 대상 없음(라우팅 실패) 건수
- 미등재 코드 목록(자동수집) · 승인 없음 · reviewDue 경과
- 🔴 분모 0이면 `산출 불가`(정본 `<Ratio>`). "읽음 100%" 는 발화 0 의 다른 이름일 수 있다.
- 🔴 미확인 알림 180일 삭제 크론은 **원장을 지운다** — 삭제 전 코드별 집계 스냅샷을 남기든지, 삭제를 아카이브로 바꾼다(P0 에서 결정).

### 3.4 예산 · One-in-One-out · 자동 강등 (P2 — baseline 30일 후)

- 예산 = `budgetClass` 별 **사용자 1인·1근무 발화 상한**(값은 baseline 실측 p95 에서 — 감으로 정하지 않는다).
- One-in-One-out: 새 코드 등재 PR 은 같은 `budgetClass` 에서 **무엇을 강등/삭제하는지** 를 `note` 에 적어야 가드를 통과한다(가드 = 등록부 diff 검사).
- 자동 강등 후보: 30일 읽음률 < 5% **이고** override율 > 80% **이고** N ≥ 30 인 코드 → tier 하향 **제안**(자동 실행 금지 — 위원회 승인·§7.3 자동실행 범위 미결).

### 3.5 역할 라우팅 표 (초안 — 사람 게이트 §5)

| 경보 계열 | 1차 | 2차(에스컬레이션) | 마지막 |
|---|---|---|---|
| 위급 검사값 | 담당 간호사(read-back) | 당직의 | 주치의 |
| DUR·고위험약·용량 초과 | 약사 | 주치의 | — |
| EWS·활력 악화 | RRT/전담간호사 | 당직의 | 주치의 |
| 낙상·욕창·자살위험 재평가 | 담당 간호사 | 수간호사 | 주치의 |
| 사고 보고 CRITICAL·RCA 기한 | 환자안전 담당 | QI 위원장 | — |
| 마약류 불일치 | 마약류 관리자 | 약제부장 | — |

## 4. 단계

| 단계 | 내용 | 규모 | 게이트 |
|---|---|---|---|
| **P0 인구조사** | **✅ 2026-08-19 1차** — `modules/notification/alert-registry.ts` 등록부 **62종 등재**(현행 그대로·전부 `UNAPPROVED`·발화 지점 file:line 동봉) · `NotificationService.create` 앞 `lookupAlert`(severity 기본값=tier·**미등재는 막지 않고 메모리 관찰+DB 대조**) · `GET /api/v1/notifications/registry`(코드별 30일 발화 N·읽음 n·읽음 중앙값·24h+ 미확인·미등재·보존 창) · `/admin/safety-gates` 하단 "경보 등록부" 패널(읽기 전용·`<Ratio>` 분모 병기) · 가드 `api/test/notification/alert-registry-guard.spec.ts`(등재 3조건·**등록부 ⊇ 실제 발화 리터럴**(재주입 실패 확인)·미등재 비차단·tier 기본값) + `web/test/architecture/alert-registry-actions.spec.ts`(액션 화면 존재). **미확인 삭제 크론은 그대로**(아카이브는 스키마 → §5-4) — 관제가 보존 창을 함께 표시. baseline 30일 계측 시작(reviewDue 2026-09-18) | 중 | 없음(CLI) |
| **P1 라우팅·액션** | 코드별 `targetRoles`·`embeddedAction` 확정 → 발화 대상 전환(코드별·회귀 가드) · 대상 없음=경보 | 중 | 🔴 라우팅 표 승인(진료부·간호부·약제) |
| **P2 예산·강등** | 예산 상한(p95)·One-in-One-out 가드·자동 강등 **제안** 크론 | 중 | 🔴 tier 배정 승인 · 자동실행 범위 결정(§7.3) |
| P3 | KOPS 주의경보 적재(2-9)와 연결·경보 등록부의 외부 근거 링크 | 소 | 폐쇄망/위탁 결정(LLM 사용 시에만) |

## 5. 사람·외부 게이트

1. 🔴 tier 배정 원칙(무엇이 tier 1인가) — 환자안전위
2. 🔴 역할 라우팅 표(§3.5) 승인 — 진료부·간호부·약제부
3. 🔴 자동 강등의 자동실행 허용 여부 — §7.3 자동실행 범위 결정에 종속(미결)
4. 미확인 알림 180일 삭제 → 아카이브 전환(보존 정책·개인정보) — 정보보호
5. 🔴 **대기자 슬롯 개방 안내(`appointment.waitlist.offered`)의 환자 통보 채널** — 진료부·원무과
   · 2026-08-20 실측: 수신자 `onAppointmentNotify` 는 **있지만**
     `APPOINTMENT_NOTIFY_ADAPTER.implemented === false` 라 로그만 남기고 반환한다(발송 경로 없음).
     `appointmentWaitlist.notifiedAt` 을 읽는 화면도 없다. 그런데 코드는 `notifiedAt: new Date()` 를
     찍고 있었다 — 환자는 아무것도 받지 못하는데 원장은 "이 시각에 안내했다"고 말했다(P16).
   · 🔴 **1차 조사는 "수신자 0"이라 적었고 그것은 틀렸다** — 수신자가 발행과 같은 파일에 있어
     `grep -v <발행파일>` 이 지웠다. 결론(통보 안 됨)은 같았지만 근거가 달랐다.
     **수신자 유무가 아니라 그 수신자가 무엇을 하는지를 본다.**
   · 조치: 통보하지 않았으므로 **시각을 남기지 않도록** 고쳤다(`notifiedAt: null` + 직접 연락 필요 WARN).
     슬롯 선점(OFFERED) 의미는 종전 동작을 유지했다.
   · **미결**: `APPOINTMENT_NOTIFY_ADAPTER`(예약 알림 SMS/카카오)를 실제 구현할 것인가 — 대외
     발신이라 사람 결정. 이 어댑터는 예약 확정·취소·노쇼 안내도 함께 막고 있다. 구현하는 날
     `notifiedAt` 은 **발송에 성공했을 때만** 채운다. 가드 `test/schedule/waitlist-offer-honesty.spec.ts`
     는 그때 지우는 게 아니라 그 조건으로 바꾼다.
   · 함께 필요: 이 알림의 등록부 코드(tier·라우팅) 배정 — 현재 등록부에 대기자 항목이 **없다**.
6. 🔴 **`AI_EGRESS_ALLOWED_HOSTS` · `EAPPROVAL_CALLBACK_HOSTS` 미설정** — 인프라·정보보호
   · 2026-08-20 운영 `.env` 실측 **0건**. 허용 호스트 목록이 비어 있으면 호스트 제한이 걸리지 않는다
     (`allowPrivate:true` 라 사설 대역 차단도 적용되지 않는다).
   · 배포 후 첫 AI 전송에서 `AiEgressPolicy` WARN 이 이 사실을 프로세스당 1회 말한다 — 없는 통제를
     있다고 적지 않기 위한 것이지, 통제가 생긴 것은 아니다.

## 5-a. 구독자 0 이벤트 15종 — **판정 완료(2026-08-20) · 실결함 0건**

🔴 **구독자 0 은 그 자체로 결함이 아니다.** 결함이 되는 조건은 하나다 —
**발행부가 "그 다음 일이 일어났다"고 기록·표시하는가.** 대기자 안내가 정확히 그랬다
(`notifiedAt` 을 찍었다). 아래 15종은 그 조건으로 아직 판정하지 않았다.

계측 방법(재현): 버스 발행(`<events|eventEmitter…>.emit('x')`) 63종 vs
구독 5형태(`@OnEvent` · `.on` · `fromEvent` · `once` · `waitFor`/`addListener`) 59종.
🔴 **세 번 틀린 자리다** — ① 발행 파일을 `grep -v` 로 빼면 같은 파일 수신자를 놓친다
② 버스가 아닌 `emit`(`VoucherBillingService.emit(lineType,…)` 등 9종)을 빼야 한다
③ `fromEvent` 를 빼면 SSE 소비를 놓친다(`queue.changed` 가 그랬다 — 16종으로 잘못 셌다).

| 이벤트 | 발행 | 먼저 볼 이유 |
|---|---|---|
| `psych.seclusion.started` / `.released` | psychiatry | 격리·강박은 법정 통보·기록 요건이 있다 |
| `handoff.created` | inpatient | 인수인계 도달 여부가 환자안전에 직결 |
| `emergency.billing_failed` | emergency | 실패를 아무도 받지 않으면 미수납이 조용히 남는다 |
| `consent.doctor_signed` · `registration.consent.{collected,signed,portal_requested}` | consent·registration-consent | 동의 절차의 다음 단계가 자동으로 이어지는지 |
| `document.delivered` · `document.rejected` | medical-record-issuance | 발급 결과 통지 |
| `dispensing.issued` · `chemo.cycle.started` | pharmacy·chemo | 투약·항암 후속 |
| `encounter.amended` · `encounter.drafts_purged` · `billing.amend_review_needed` | encounter·billing | 수정 이력 검토 흐름 |

### 5-a-1. 판정 결과 — 13종 전부 **결함 아님** (코드 변경 0)

판정 기준(발행부가 "그 다음 일이 일어났다"고 기록·표시하는가)으로 13종을 전수 확인한 결과
**한 건도 걸리지 않았다.** 공통 이유는 셋이다:
1. **발행 직전에 실제로 일어난 일을 적는다** — `chemo.cycle.started`(조제 오더 실제 생성),
   `encounter.drafts_purged`(`deleteMany` 가 돌려준 count), `consent.doctor_signed`(방금 한 서명)
2. **정본 통지가 이벤트가 아니라 옆에 있다** — `handoff.created` 는 바로 위
   `notifications.notify(CLINICAL_HANDOFF)` 가 실제 인앱 알림을 만든다.
   `billing.amend_review_needed`·`encounter.amended` 는 같은 블록에서 **저니 이벤트를 INSERT** 하고
   그것을 화면이 읽는다(`emergency.billing_failed` 와 동형)
3. **조작자 확약이다** — `dispensing.issued`·`document.delivered` 는 사람이 실물을 주고 누른 것이고,
   우편·팩스는 송장/수신번호가 **필수**(`REF_REQUIRED`)다. 시스템이 "보냈다"고 주장하지 않는다

**유일한 조치**: `registration.consent.signed` 의 주석이 **"SSE 이벤트 → HIS 실시간 반영"**이라
없는 통로를 있다고 적고 있었다(SSE 채널도 구독자도 없고 원무는 폴링) → 주석을 실측으로 교체.
🔴 **DB·화면에 거짓이 남지 않으므로 결함은 아니다** — 주석을 코드로 읽지 않는다.

🔴 **결함 0건도 유효한 결과다.** 억지 가드를 만들지 않았다(재주입할 결함이 없다).

### 5-a-2. 🔴 역갭 — **발행자가 0인 구독자 7종** (신규 발견 · 미착수)

같은 스캔을 뒤집으니 더 큰 것이 나왔다. 아래는 **구독 1 · 발행 0**(코디네이터 재확인):

| 이벤트 | 핸들러가 만들려던 환자 푸시 |
|---|---|
| `patient.called` | "진료 호출 — 진료실로 이동해주세요" |
| `prescription.ready` | "약 조제 완료 — 약국에서 수령해주세요" |
| `lab.patient_result_ready` | "검사 결과 완료 — 앱에서 확인하세요" |
| `billing.patient_pending` | "수납 대기 — 수납 창구를 방문해주세요" |
| `admission.round_scheduled` | "회진 예정" |
| `appointment.reminder` | "예약 알림" |
| `lab.result_completed` | (동일 계열) |

전부 `notification.listener.ts:716~747` 의 **환자 FCM 푸시 핸들러**이고 `createPatientPush` 가
유일 경로다. 즉 **이 알림들은 개통 이래 한 번도 발화한 적이 없다.**

- ✅ **거짓말은 아니다** — "환자에게 알림을 보냈다"고 적거나 표시하는 화면이 **없다**(전수 확인).
  이것은 **기능 갭**이지 정직성 결함이 아니다.
- 🔴 **핸들러는 완성돼 있다** — 문구·타입·페이로드가 다 있고 **발행 지점만 없다.**
  배선 자체는 작다(대기열 호출·조제 완료·검사 확정·수납 대기 등에 `emit` 한 줄).
- 🔴 **그러나 배선하면 환자에게 실제로 푸시가 나간다 — 대외 발신이므로 사람 결정**(§5 게이트).
  켜는 날 필요한 것: 발화 지점 확정 · 알림 등록부 tier/라우팅 배정 · 야간 억제 창 ·
  환자 수신 동의 확인. **켜기 전에 등록부에 등재한다**(P0 규약).

**부수**: `psychiatry.service.ts:452` 자동 해제 경로는 같은 `RELEASED` 전이를 하면서
`psych.seclusion.released` 를 내지 않는다. 지금은 무소비라 영향 0이지만 **구독자를 붙이는 날
두 경로를 맞춰야 한다.**

## 6. 검증 규칙(이 문서가 스스로 지킬 것)

- 등록부 가드: 등재 3조건 없는 항목 → 테스트 실패 · 코드 어휘가 `notify` 호출과 어긋나면 실패(등록부 코드 ⊆ 실제 발화 코드, 그 역도 관제에서 표시)
- **재주입**: 미등재 코드로 발화하면 **막히지 않고** `unregistered` 표식이 붙는지(막히면 실패) · 억제 창 안 재발화가 실제로 생략되는지
- 관제 수치는 전부 분모와 함께 · baseline 없이 예산 수치를 적지 않는다(P2 전에는 "산출 불가")
- 실측 없이 "개선됐다"고 적지 않는다 — 모든 수치에 날짜·방법
