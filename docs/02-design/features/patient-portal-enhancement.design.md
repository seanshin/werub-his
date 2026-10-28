# 환자포털 기능 확장 설계서 — P0·P1 (알림 센터·입원 생활·복약 리마인더·보험 서류·처방 AI 설명)

> **Feature**: patient-portal-enhancement
> **Version**: 1.3 (Design — v1.1: UX/UI 검토(§6 규약) / v1.2: AI 운영 테스트 8건(§5.6)·T-0 해결·AI 표기 표준(§6.5) / **v1.3: 정밀 감사 반영 — BE 사실 교정 7건(알림은 이벤트 리스너 관례·실사용 type 목록·서류 자동발급 부재·medications 응답 id 부재·zip 미설치·슬롯 정본 4종·BillingService export 확인) + 문서 결함 수정(캐시 item_seq 컬럼·잡 소유 검증·발송 대상 규칙 확정·검증 매트릭스 확충·모바일 이연 선언·교차참조 정리)**)
> **Date**: 2026-07-07
> **Status**: Design (구현 전 — 본 세션은 기획·설계까지만 진행하기로 결정)
> **기획**: [patient-portal-enhancement.plan.md](../../01-plan/features/patient-portal-enhancement.plan.md) (v1.5)
> **한 줄**: 신설 최소화 — 기존 자원(patient-auth 알림 API·journey lifecycle·nutrition·ERP interim·IssuedDocument·WeRU.B e약은요/DUR·포뮬러리 비동기 잡 패턴)에 **포털 EP 9개 + FE 컴포넌트(공용 시트 1) + manual SQL 3건**을 배선. 전 기능 config 게이트 기본 OFF. UX는 포털 기존 관례(§6 규약) 준수.

---

## 0. 설계 단계 재검증 발견 (기획 대비 변경)

| 발견 | 근거 | 설계 반영 |
|------|------|----------|
| **입원 히어로·오늘 투약·최근 회진은 기구현** | `_home/HomeTab.tsx` L120~205 — lifecycle(journey/status)의 admission·vitals·todayMedications·recentProgressNotes 카드 렌더 | F-3는 **식단·중간정산 카드 2개 추가**로 축소, 회진 EP 신설 취소 (기획 v1.3 반영) |
| **약물 상호작용 확인은 기존재** | `_health/HealthTab.tsx` L627 `PortalAiDrugInteractions`(WeRU.B `/ai/drug-interactions`, 2종 이상일 때 버튼) | F-7 "쉽게 보기"는 **개별 약 설명** — 상호작용 컴포넌트와 병치(중복 구현 금지) |
| 포털 FE는 `apiClient` + TanStack Query 패턴 | HealthTab `useQuery({queryKey:['portal-medications'], queryFn: apiClient.get(...)})` | 신규 FE 전부 동일 패턴 (포털은 (homepage) 아님 — apiClient 허용) |
| 포뮬러리 AI 비동기 잡은 서비스 내부 private | `formulary.service.ts` `aiJobs Map`·`startAiDraft` (2026-07-07 미커밋 작업) | **공용 유틸로 추출**하지 않음(다른 CLI 작업 충돌 회피) — F-7은 동일 패턴을 **자체 복제**(P2에서 공용화 검토) |
| **헤더에 벨 버튼 껍데기 기존재** | `portal/page.tsx:250` — `aria-label="알림"`·`relative`·**onClick 없음** | F-1은 신규 버튼이 아니라 **기존 버튼에 배선**(배지는 `relative`에 NotificationBadge 즉시 부착 가능) |
| **MealOrder에 메뉴 텍스트 없음** | `MealOrder` = date·mealType(조/중/석/간식)·dietType(당뇨식 등)·allergies·status(ORDERED/PREPARED/DELIVERED) — 음식 메뉴 필드 부재(주간 메뉴는 직원식당용 staff-menu뿐) | F-3 식단 카드는 "메뉴 표"가 아니라 **식이 정보 카드**(식이 종류·끼니별 배송 상태·제한/알레르기)로 설계 변경. 메뉴 텍스트 연동은 영양팀 데이터 확충 후(비목표) |
| **환자 알림 발송 관례 = 이벤트 리스너** (v1.3) | `notification.listener.ts:416` `createPatientPush()`(**private**)가 `patientNotification.create`+`FcmPushService.pushPatientNotification` 처리. `@OnEvent`(patient.called·billing.patient_pending·appointment.reminder 등)로만 진입 | F-2·F-4 알림은 **이벤트 발행 → listener 핸들러 신설**로 합류(관례 준수·private 직접 호출 금지). §3.2·§4.3 |
| **실사용 알림 type 목록** (v1.3) | 발송 실사용: `CALLED·LAB_RESULT·BILLING·ROUND·PHARMACY·APPOINTMENT·CONSENT·CHECKUP_RESULT·MARKETING`. 설정 기본 목록(`APPOINTMENT_REMINDER·DOCUMENT_READY·QUESTIONNAIRE·SYSTEM…`)과 **문자열 불일치(기존 버그성 갭)** — 미등록 type은 설정 무시하고 항상 발송됨 | §1.4 딥링크 표를 실사용 type 기준으로 재작성. 신설 2종(`MEDICATION_REMINDER`·`DOCUMENT_READY`)은 **설정 기본 목록과 동일 문자열**로 발송(정합 회복). 기존 type 정합화는 비목표(회귀 위험) |
| **서류 자동발급은 존재하지 않음** (v1.3) | `requestDocument`는 `documentRequest.create`만. 발급은 전량 직원 워크플로우(medical-record-issuance = 같은 DocumentRequest의 직원측: A그룹 snapshot→issue / B그룹 의사작성). RECEIPT는 발급 대상조차 아님(수납 영수증은 별도 `getReceipt` 렌더) | §4.2 전면 수정 — "자동발급"은 **신규 분기**(선례 없음·A그룹 파이프라인 재사용+자동 트리거 신설)임을 명시, 수수료는 `TYPE_FEES` 맵+`fee_rules` 두 곳 확장 |
| **`GET /portal/medications` 응답에 id 없음** (v1.3) | 반환 = name·code·dosage… (**Prescription.id·medicationCodeId 미포함**, 약품명 dedup까지 수행) | F-7 약 단위 explain 진입을 위해 응답에 `id`(Prescription.id)·`medicationCodeId` **필드 추가**(비파괴·추가만). §5.5 |
| **zip 라이브러리 미설치** (v1.3) | package.json에 archiver/adm-zip 등 없음 | F-4 묶음 다운로드에 `archiver` 의존성 추가 명시(§4.3) |
| 슬롯 문자열 정본 (v1.3) | `parseFrequencySlots` 반환 4종: `아침 식후·점심 식후·저녁 식후·취침 전` | F-2 config 키·DDL slot 값을 이 4종으로 통일(§3.1·§7.1) |

---

## 1. F-1 웹 알림 센터 (P0 · FE only)

### 1.1 컴포넌트

```
portal/page.tsx
├─ 헤더 기존 벨 버튼(page.tsx:250 — 현재 onClick 없는 껍데기) ← 배선 + <NotificationBadge count={unread}/>
│    └─ 클릭 → <NotificationPanel/>   ← 신규: PortalSheet(§6.3) — 모바일 바텀시트/데스크톱 센터
└─ MoreTab '알림 설정'(현 '준비 중') → <NotificationSettings/>  ← 신규
```

| 파일 | 역할 |
|------|------|
| `portal/_shared/NotificationCenter.tsx` (신규) | Panel·Settings + `useUnreadCount` 훅 |
| `portal/_shared/PortalSheet.tsx` (신규 공용 — §6.3) | 바텀시트/모달 셸 (F-1·F-4·F-7 공용) |
| `portal/page.tsx` (수정) | 기존 벨 버튼 onClick 배선 + 배지 |
| `portal/_more/MoreTab.tsx` (수정) | '준비 중' 제거 → Settings 진입 |

**배지 의미 이원화 (기존 유지)**: 모바일 하단 '더보기' 탭 배지는 **할 일 파생 카운트**(미완료 문진표+미수납 — `page.tsx:366`)로 기존 유지, 헤더 벨 배지는 **서버 알림 unread-count** — 서로 다른 의미이므로 합산하지 않음(합치면 읽음 처리 개념이 깨짐).

### 1.2 데이터 배선 (신규 EP 0)

| 용도 | 기존 EP | 폴링 |
|------|---------|------|
| 배지 수 | `GET /api/v1/patient-auth/notifications/unread-count` | 60초 `refetchInterval` (SSE 미사용 — 대기현황 SSE와 채널 분리 유지) |
| 목록 | `GET /api/v1/patient-auth/notifications` | 패널 열릴 때 |
| 읽음 | `PUT .../notifications/:id/read`·`read-all` | 클릭/버튼 |
| 설정 | `GET/PUT .../notifications/settings` | Settings 진입 시 |

### 1.3 가드 분기 (레거시 포털 토큰)

알림 API는 `PatientAccountAuthGuard`(환자계정 JWT) 전용. FE는 **로그인 방식을 이미 알고 있음**(LoginForm: MRN+생년월일=레거시 / 휴대폰+비밀번호=계정):
- 계정 세션 → 알림 센터 정상 렌더
- 레거시 세션 → Bell 대신 **가입 유도 배너**("알림을 받으려면 계정을 만드세요" → 회원가입 플로우). 401 처리로도 이중 방어(unread-count 401 → 배너 폴백).
- **보호자 위임 세션** → 위임은 토큰 스와핑 방식(`localStorage['guardian-mode']`)이라 알림 API가 401/타계정 컨텍스트 — **위임 세션에서는 벨 숨김**(guardian-mode 존재 시 렌더 안 함, 401 폴백과 이중 방어). 알림은 본인 세션 전용.
- BE 가드 확장은 하지 않음(기획 §7-1 열린 결정 유지 — 보안 검토 전 임의 확장 금지).

### 1.4 딥링크 매핑 (v1.3: **실사용 type 전수 기준**으로 재작성 — §0)

`data.route` 우선(모바일 `usePushNotifications` 관례와 동일 키), 없으면 type 폴백:

| PatientNotification.type (실사용) | 이동 |
|---|---|
| `APPOINTMENT` | 진료 > 예약/대기 |
| `CALLED` | 홈(대기 현황) |
| `LAB_RESULT` | 건강 > 검사결과 |
| `PHARMACY` | 건강 > 투약 |
| `BILLING` | 서비스 > 수납 |
| `CONSENT` | 진료 > 동의서 |
| `CHECKUP_RESULT` | 건강 > 건강검진 |
| `ROUND` | 홈(입원 카드군) |
| `MEDICATION_REMINDER` (F-2 신설) | 건강 > 투약 (해당 약 강조 → F-7 설명 진입) |
| `DOCUMENT_READY` (F-4 신설) | 서비스 > 서류발급 |
| `MARKETING`·기타/미매핑 | 패널 내 본문 확장만 |

- 탭 전환은 기존 포털 셸의 탭 상태 setter 재사용(신규 라우팅 없음 — 포털은 단일 페이지 + 탭 상태).
- 신설 2종은 설정 기본 목록(`patient-auth.service.ts:887` defaultTypes)과 **동일 문자열** — 발송 type↔설정 type 불일치(기존 갭, §0)를 신설분부터 정합. 발송 시 `data.route`도 채워 **모바일 푸시 딥링크 자동 호환**(기존 `createPatientPush`는 data 미기입 — 신설 핸들러는 기입).
- 알림 목록 페이지네이션: 기존 EP 파라미터 그대로(추가 없음), 패널은 최근 20건 + "더 보기".

---

## 2. F-3 입원 생활 — 식단·중간정산 (P0)

### 2.1 BE — 포털 EP 2개 (읽기 전용)

`portal.controller.ts`에 추가, `PortalOrPatientGuard`:

```ts
@Get('inpatient/meals')      // 오늘·내일 식단
@Get('inpatient/interim-bill') // 입원비 중간정산(ERP)
```

`portal.service.ts` 로직:

```
getInpatientMeals(patientId):
  adm = admission.findFirst({ patientId, status: 'ADMITTED' })   // 없으면 404 (FE는 카드 미렌더)
  diet = DietOrder(admissionId, isActive)                        // dietType·calorieTarget·restrictions·texture·notes
  meals = MealOrder(admissionId, date in [today, tomorrow])      // mealType(조/중/석/간식)·dietType·status(ORDERED|PREPARED|DELIVERED)·allergies
  return { diet: {dietType, calorieTarget, restrictions, texture},
           meals: [{date, mealType, dietType, status, allergies}] }
  // ⚠️ 메뉴 텍스트(음식명)는 데이터 부재(§0) — "식이 정보 카드"로 표시, 메뉴 표 아님

getInpatientInterimBill(patientId):
  adm = 활성 admission 확인 (없으면 404)
  chartNo = patient.chartNo   // ★ 세션 환자에서 서버 주입 — 쿼리 파라미터 금지(IDOR)
  res = billingService.getErpInvoice({ chartNo, interim: true })  // 기존 재사용
  if (!res.available) return { available: false }                 // FE 섹션 비노출(에러 아님)
  return { available: true, total, items 요약, asOf: now, notice: '확정 금액이 아닙니다' }
```

- 모듈(v1.4 교정 — ⚠️ 운영 장애 반영): meals = **PrismaService 직접 쿼리** / interim-bill = ~~BillingModule import~~ → **ERP 호출 인라인**(configRuntime의 erp.webhookUrl·integrationKey 직접 사용). v1.3의 "순환참조 없음" 판정은 **오판** — 직접 순환은 없으나 `Portal→Billing→Voucher→PatientAuth→Portal` **간접 순환**으로 부트스트랩 실패(2026-07-07 배포 장애 ~13분·핫픽스). 교훈: Nest 모듈 순환은 직접 import만이 아니라 **전이 경로 전체**를 확인해야 하며, PortalModule에 신규 모듈 import 추가는 금지 수준으로 보수적으로.
- 응답 규약: 컨트롤러에서 `{ data: ... }` 래핑(프로젝트 표준). 비입원 시 `NotFoundException('입원 정보가 없습니다')` — FE는 404를 빈 상태로 처리(카드 미렌더·에러 토스트 금지).
- 보호자 위임: 기존 민감정보 필터 경로 통과(encounters와 동일 헬퍼).
- config: `portal.inpatientLife`(기본 false) — false면 두 EP 404·FE 카드 미렌더.

### 2.2 FE — HomeTab 입원 카드군에 2카드 삽입

기존 입원 카드 priority 체계(0=히어로, 0.1=투약, 0.2=회진)에 맞춰:

| 카드 | priority | 내용 |
|------|----------|------|
| 오늘 식사 | 0.15 | **식이 정보 카드**: 식이 종류 배지(당뇨식·저염식 등, 치료식이면 amber) + 끼니별 상태 타임라인(조🍚·중·석 — 배송완료 체크) + 제한/알레르기 주의 문구. 메뉴 텍스트 없음(§0) — 데이터 없으면 미렌더 |
| 진료비 중간정산 | 0.3 | 현재까지 발생액 + "확정 금액이 아닙니다 · 문의: 원무과" 고정 고지 + 기준 시각 |

면회·생활 안내: 카드 하단 링크 → 기존 병원안내(custom page) — 신규 화면 없음.

---

## 3. F-2 복약 리마인더 (P1)

### 3.1 DDL — `medication_check_logs` (manual SQL)

```sql
-- apps/api/prisma/manual/portal-medication-check-log.sql
CREATE TABLE medication_check_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid NOT NULL,
  prescription_id uuid NOT NULL,
  slot_date       date NOT NULL,
  slot            varchar(20) NOT NULL,          -- 정본 4종: 아침 식후|점심 식후|저녁 식후|취침 전 (parseFrequencySlots 반환값 그대로)
  reminded_at     timestamptz,                   -- 발송 시각(발송 기록 겸용)
  taken           boolean,                       -- null=미체크
  checked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prescription_id, slot_date, slot)      -- ★ 멱등 키
);
CREATE INDEX idx_mcl_patient_date ON medication_check_logs (patient_id, slot_date);
```

Prisma 모델 `MedicationCheckLog` — **`@@map("medication_check_logs")` + 전 컬럼 `@map`(snake_case) 필수**(누락 시 다른 테이블 참조), `prisma generate` 동반(**배포 시 서버 generate 필수 규칙**). 행 생성 주체 2곳: ① cron 발송 시 upsert(`reminded_at`) ② 환자 체크 시 upsert(`taken`·`checked_at`) — 순서 무관(먼저 온 쪽이 insert). **보존: 1년 경과분 월 1회 삭제 배치**(개인 복약 이력 — 기획 §7-2 잔여 결정의 기본안, RetentionPolicy 편입은 후속).

### 3.2 Cron — `portal/medication-reminder.cron.ts` (신규, 선례: chronic-recall-cron)

```
@Cron(CronExpression.EVERY_30_MINUTES)  // 관례: CronExpression 상수(chronic-recall-cron 선례). 게이트는 메서드 첫 줄 config 확인(선례엔 없으나 본 기능은 opt-in이라 추가)
  if (!config portal.medicationReminder) return
  slotNow = 현재 시각이 속한 슬롯 (config portal.medicationReminderTimes ± 15분 창)
  if (!slotNow) return
  대상 계정 = NotificationSetting(type='MEDICATION_REMINDER', enabled=true) JOIN PatientAccount
             // ★ opt-in 명시자만 — 기본 미발송(§0: 미등록 type은 항상 발송되는 기존 갭을 재현하지 않음)
  for 환자:
    if (활성 admission 존재) continue          // ★ 입원 중 제외 — 원내 투약은 간호 MAR 소관(이중 알림·혼선 방지)
    if (오늘 발송 수 >= config 일일 상한(기본 6)) continue
    rx = Prescription(status ACTIVE, encounter.patientId)   // 발송 직전 재검증(중단·취소 반영)
    for rx where parseFrequencySlots(rx.frequency) ∋ slotNow:
      upsert MedicationCheckLog(rx.id, today, slotNow) — reminded_at 기존재 시 skip (멱등)
      eventEmitter.emit('portal.medication_reminder', { patientId, prescriptionId, slot })
```

- **발송은 이벤트 발행 → `notification.listener`에 `@OnEvent('portal.medication_reminder')` 핸들러 신설**(§0 관례 — `createPatientPush`는 private이므로 직접 호출 불가). 핸들러가 `PatientNotification(type='MEDICATION_REMINDER', data:{prescriptionId, slot, route:'/(tabs)/medication'})` 생성 + `FcmPushService.pushPatientNotification` — **data.route 기입으로 모바일 푸시 딥링크 자동 호환**.
- **대상 처방 판별(v1.3 확정 — 기획 §7-11 종결)**: ~~scope enum~~ → 판별 필드가 없어 규칙으로 정의: **"활성 admission이 없는 환자의 ACTIVE 처방 전체"**. 입원 환자 제외로 MAR 이중 알림을 막고, 원외 조제 여부는 HIS가 모르므로 알림 문구를 중립으로("복약 확인 시간이에요" — 복용 지시 아님).
- `checkMedication()` 수정: 감사 로그 유지 + `MedicationCheckLog` upsert 추가 — 기존 DTO `{prescriptionId, slot, taken}` 그대로(slot_date는 서버가 오늘로 채움·파라미터 불필요). `getMedicationSchedule()` 응답에 오늘 체크 상태(`taken`) 동봉 → FE 체크박스 초기값.

### 3.3 FE

- 알림 탭(F-1 딥링크) → 건강>투약, 해당 처방 하이라이트 + "복용 완료" 원탭(기존 `medication-check`).
- Settings(F-1)에 '복약 알림' 행 — `NotificationSetting type='MEDICATION_REMINDER'` 행 upsert(**스키마 변경 0**).

---

## 4. F-4 실손보험 청구 서류 패키지 (P1)

### 4.1 DDL (manual SQL)

```sql
ALTER TABLE document_requests ADD COLUMN bundle_id uuid;
CREATE INDEX idx_docreq_bundle ON document_requests (bundle_id) WHERE bundle_id IS NOT NULL;
```

### 4.2 서류 type 2종 신설 + 자동발급 **신규 분기** (⚠️ v1.3 사실 교정)

**v1.3 검증: 현행 파이프라인에 자동발급은 존재하지 않음** — `requestDocument`는 레코드 생성뿐이고, 발급(스냅샷→IssuedDocument→진위QR→지연 PDF)은 전량 직원 워크플로우(medical-record-issuance의 A그룹 `snapshot→issue`/B그룹 의사작성 — DocumentRequest와 **같은 테이블**의 직원측). RECEIPT조차 발급 대상이 아님(수납 영수증은 별도 `getReceipt` 렌더).

따라서 "자동발급" = **본 설계의 신규 분기**: 신청 트랜잭션 안에서 A그룹 파이프라인의 `snapshot→issue`를 **직원 개입 없이 서버가 즉시 수행**(IssuanceService 메서드 재사용·트리거만 신설).

| 신규 type | 생성 방식 | 데이터 소스 |
|---|---|---|
| `DETAILED_BILL` 진료비 세부산정내역서 | **자동발급 분기**(신청 즉시 snapshot→issue→READY) | 영수증 fullCopay 5열 데이터 재사용(항목별 급여/비급여 분해) — 신규 스냅샷 빌더 1개 |
| `ATTENDANCE_CERT` 통원확인서 | **자동발급 분기** | Encounter 내원 이력(기간 내 일자·과·의사) — 신규 스냅샷 빌더 1개 |

- 수수료는 **두 곳 확장 필수**: 신청 시점 간이 맵(`portal.service.ts` `TYPE_FEES` — DETAILED_BILL 1,000·ATTENDANCE_CERT 3,000 제안) + 발급 시점 규칙엔진(`fee-rules.ts` DEFAULT/SystemConfig `medical_record.fee_rules`).
- 기존 type(`RECEIPT`·`ADMISSION_CERT`·`DIAGNOSIS_CERT` 등) 처리 흐름 불변. 세트 내 직원/의사 작성분(진단서 등)은 세트에서 제외·별도 신청 안내 유지.

### 4.3 EP

```ts
// 전부 PortalOrPatientGuard(레거시 포털 토큰 포함 — 기존 documents/request와 동일 접근 수준)
POST /portal/documents/request-bundle
  body: { setType: 'INSURANCE_OUTPATIENT' | 'INSURANCE_INPATIENT', periodFrom, periodTo }
  → 세트 구성 resolve → DocumentRequest N건 생성(bundle_id 공통)
  → 자동발급 분기(§4.2) 즉시 READY / 직원작성분 REQUESTED
  → return { data: { bundleId, requests: [{id, type, status, fee}], totalFee } }

GET  /portal/documents/bundles/:bundleId        // 상태 — bundle 내 전 요청의 patientId=세션 환자 검증(불일치 404)
GET  /portal/documents/bundles/:bundleId/download  // READY분 zip (부분 다운로드 허용) — 동일 소유 검증
```

- 세트 정의는 상수(BE `insurance-doc-sets.ts`): 외래=`DETAILED_BILL+RECEIPT+ATTENDANCE_CERT`, 입원=`DETAILED_BILL+RECEIPT+ADMISSION_CERT`. (RECEIPT는 발급 파이프라인 비대상이므로 세트에서는 기존 `getReceipt` PDF를 zip에 동봉하는 방식 — DocumentRequest 생성 없이 번들 다운로드 시 생성.) 진단서는 세트 제외·별도 신청 안내(유료·의사 작성).
- zip: **`archiver` 의존성 신규 추가**(v1.3 확인: zip 라이브러리 미설치). 개별 PDF 보존(진위QR 각각 유효 — 기획 §7-4는 zip으로 **설계 확정**, 병합 PDF는 QR 진위 개별 검증 불가).
- 전 구성 READY 시 이벤트 발행 → listener 핸들러 신설(§0 관례) → `PatientNotification(type='DOCUMENT_READY', data:{bundleId, route})` — F-1 딥링크·설정 기본 목록 문자열과 정합.
- 수수료: §4.2 두 곳 확장분 합산을 신청 전 고지 모달에 노출.

### 4.4 FE

`_services/ServicesTab.tsx` 서류발급 세그먼트: "실손보험 청구 세트" 카드 → 모달(외래/입원 선택 → 기간 → 구성 미리보기+수수료 → 신청) → 목록에 번들 그룹 렌더(전체/부분 다운로드 버튼).

---

## 5. F-7 처방·투약 AI 쉬운 설명 (P1)

### 5.1 T-0 어댑터 — itemSeq 매핑 ✅ 해결 (2026-07-07 운영 테스트 — §5.6)

**운영 실측으로 해석 체인 확정 — WeRU.B 협의·HIS 스키마 변경·공공 매핑 임포트 전부 불필요**:

```
MedicationCode.insuranceCode → 선행 0 제거 (★함정: '054801360'은 미해석, '54801360'만 해석됨)
  → GET /api/v1/ai/drug-master/{code}      → matches[0].item_code = 품목기준코드 (실측 201900221)
  → GET /api/v1/ai/e-drug-info/{item_code} → found:true 정확 1건
     (efficacy·usage·precaution·side_effect·interaction·warn·storage·update_de + disclaimer 정본 동봉)
```

```ts
// portal/drug-info.resolver.ts — 인터페이스는 유지(향후 WeRU.B 1-hop 지원 시 교체 용이)
interface DrugInfoResolver {
  /** HIS 약품코드 → e약은요 원문 | null(해석 실패 — 폴백) */
  resolve(medicationCodeId: string): Promise<EDrugInfo | null>;
}
// 구현(확정): 위 2-hop 체인. 해석 결과(item_code)는 drug_explain_cache에 함께 저장 → 2회째부터 1-hop
```
- `update_de`(e약은요 개정일) = 캐시 `source_version` 값으로 확정 — 개정 감지 시 재생성.
- 명칭 검색(`e-drug-info/아스피린` — 실측 5건)도 지원되나 **오매칭 위험으로 자동 사용 금지** — 해석 실패는 폴백 문구 원칙 유지.

### 5.2 DDL — `drug_explain_cache` (manual SQL)

```sql
CREATE TABLE drug_explain_cache (
  medication_code_id uuid PRIMARY KEY,
  item_seq           varchar(20),          -- 해석된 품목기준코드(§5.1 2-hop 결과 — 2회째부터 1-hop)
  content            jsonb NOT NULL,       -- {purpose, cautions[], sideEffects[], whenToCall[]} — sideEffects는 UI '⚠️ 주의하세요'에 cautions와 병합 렌더
  source_version     varchar(40),          -- e약은요 update_de(개정일)
  checked_at         timestamptz NOT NULL DEFAULT now(),  -- 마지막 개정 확인 시각
  created_at         timestamptz NOT NULL DEFAULT now()
);
```

- Prisma 모델 `DrugExplainCache` — `@@map("drug_explain_cache")` + 컬럼 `@map` 필수(MedicationCheckLog와 동일 규칙).
- **개정 확인(무효화) 시점**: 캐시 hit여도 `checked_at`이 **30일 경과**면 e약은요 1회 재조회해 `update_de` 대조 — 다르면 재생성, 같으면 `checked_at`만 갱신. 30일 이내 hit는 외부 호출 0(비용·지연 없음).
- ②복용법은 캐시 비대상(처방별 dosage/frequency 템플릿 조립 — LLM 불필요).

### 5.3 EP — 캐시 우선 + 비동기 잡 (포뮬러리 패턴 복제)

```ts
// 전부 PortalOrPatientGuard·응답 { data: ... } 래핑
GET  /portal/medications/:prescriptionId/explain
  → 본인 처방 검증(Prescription→encounter.patientId=세션, 불일치 404) → resolver.resolve()
     null → { status:'UNAVAILABLE' }                       // 폴백 문구(생성 금지)
     캐시 hit → { status:'READY', explain: 캐시 + 용법 조립 }  // LLM 0회
     캐시 miss → { status:'PENDING', jobId }               // LLM 잡 시작(아래)
GET  /portal/medications/explain-jobs/:jobId               // RUNNING|DONE|ERROR 폴링

POST /portal/prescriptions/:encounterId/explain            // "이번 처방 한눈에" — 해당 encounter의 전 처방(=처방전 단위 정의: encounter 1건의 처방 묶음) — 항상 잡
GET  /portal/prescriptions/explain-jobs/:jobId
```

- **잡 소유 검증(PHI)**: 잡 생성 시 `patientId`를 잡 레코드에 바인딩 — 폴링 시 세션 환자와 불일치면 404(jobId 추측으로 타 환자 처방 열람 차단). jobId는 기존 포뮬러리 방식(timestamp+random)이나 검증은 소유 대조가 정본.
- **FE 폴링 규약**: jobId는 `sessionStorage`(`portal-explain-job:{key}`) 보관 — 시트를 닫았다 재열람해도 이어짐. 폴링 3초 간격·최대 5분(초과 시 "잠시 후 다시 시도" 폴백·잡은 서버 30분 GC에 맡김).

- 잡 스토어: formulary와 동일한 인메모리 Map + 30분 GC(pm2 단일 인스턴스 전제 — §0 결정대로 자체 복제).
- 처방전 단위 = 약별 캐시 재사용 + 신규분만 LLM + `dur/check`(기존) 결과 쉬운 말 1회 — 캐시 성숙 후엔 DUR 1회만.
- **DUR 입력은 약 명칭 배열**(실측: EDI 코드는 `resolved:false`, 명칭은 `via:'name'` 해석·70세 아스피린 노인주의 검출) — `MedicationCode.nameKo`에서 괄호 앞 제품명 전달.

### 5.4 LLM 호출 설계 (WeRU.B Ollama qwen2.5:14b)

- **입력**: e약은요 원문(효능·용법·주의·부작용 원문 필드) + 약명. **출력**: JSON 강제 `{purpose, cautions[], sideEffects[], whenToCall[]}` — 번호/원문 인용 기반(포뮬러리 환각 방지 방식 준용).
- 시스템 프롬프트 가드: "원문에 없는 내용 생성 금지 / 진단·효과 판정·용법 변경 권고 금지 / 초등학생도 이해할 쉬운 문장 / **의학 약어·괄호 영어(CABG·PTCA 등)는 풀어 쓰거나 생략**" — 마지막 항목은 실측(§5.6)에서 전문용어가 원문 그대로 남는 것을 확인해 추가.
- **후처리 금칙어 필터**(BE): `진단|복용을 중단|용량을 늘|줄이세요|대신 드세요` 등 패턴 → 해당 문장 drop, 전부 걸리면 UNAVAILABLE 폴백.
- ⚠️ 구현 함정 승계: AI 프록시가 `stream:false` 무시하고 NDJSON 스트리밍 → **라인 병합 후 JSON 파싱**(formulary `extractJson` 방식). 실측에서 **JSON 뒤에 부가 텍스트(자체 면책문)가 붙는 것 확인** — `extractJson`의 first-`{`/last-`}` 추출이 필수임이 실증됨.
- 고정 고지(FE): "식약처 e약은요 공개 정보를 알기 쉽게 정리한 것으로, 복약지도를 대체하지 않습니다. 정확한 복약 상담은 약사에게." + 출처·생성일.

### 5.5 FE

- `_health/HealthTab.tsx` 투약 세그먼트: 각 약 카드에 "쉽게 보기" 버튼 → `<DrugExplainSheet/>`(신규 — 4단 구성: 무슨 약/어떻게 먹나/주의/이런 증상이면 연락). `PortalAiDrugInteractions` 버튼과 병치. **선행 수정**: `GET /portal/medications` 응답에 `id`(Prescription.id)·`medicationCodeId` 필드 추가(v1.3 검증: 현행 응답에 둘 다 없음 — 추가만·비파괴) — 이 id로 explain EP 진입.
- 처방 이력(진료 상세): "이번 처방 한눈에" 버튼 → 잡 폴링 → 표(약별 역할 한 줄 + DUR 쉬운 말 + 복용 스케줄).
- 퇴원약 카드: `dischargeMedications` JsonB는 자동 초안 시 `{code, name, dosage…}` 객체 배열이나 **자유 JSON이라 강제 아님** — 항목에 `code`가 있고 마스터 조회가 되는 경우에만 "쉽게 보기" 노출(없으면 버튼 미렌더).
- config `portal.aiDrugExplain`(기본 false) — OFF면 버튼 자체 미렌더.

---

### 5.6 AI 연동 운영 테스트 결과 (2026-07-07 · 읽기 전용 · his.example.org)

시료: 케이아스피린장용정 — `MedicationCode.code/insuranceCode='054801360'`(중복 행 `'54801360'` 존재), `ingredientCode='111001ATE'`.

| # | 테스트 | 결과 | 설계 반영 |
|---|--------|------|----------|
| ① | `GET /ai/drug-master/054801360` | `found:false` — **선행 0 포함 코드 미해석** | resolver에서 선행 0 strip 필수 |
| ② | `GET /ai/drug-master/54801360` | ✅ `item_code:'201900221'`(품목기준코드)·ATC B01AC06·표준코드 3건 | **T-0 해결**(§5.1) |
| ③ | `GET /ai/e-drug-info/201900221` | ✅ `found:true` 정확 1건 — efficacy·usage·precaution·side_effect·interaction·warn·storage·`update_de` + **disclaimer 정본** | 캐시 source_version=`update_de`·표기(§6.5) |
| ④ | `GET /ai/e-drug-info/아스피린` (명칭) | ✅ 5건 매칭 | 자동 사용 금지(오매칭) — 백업 인지만 |
| ⑤ | `POST /ai/dur/check` drugs=EDI코드 | `resolved:false` — 코드 미해석 | **DUR은 명칭 배열 입력**(§5.3) |
| ⑥ | `POST /ai/dur/check` drugs=명칭·age 70 | ✅ `via:'name'` 해석·**아스피린 노인주의 검출**·8종 점검·disclaimer 동봉 | — |
| ⑦ | LLM 그라운딩 프롬프트(운영 `POST /ai/chat` 경유·e약은요 원문 주입) | ✅ JSON 4단 구조 준수·**환각 0**(전 항목 원문 유래)·4.4초 응답. 단 전문용어(CABG·PTCA) 원문 잔존·JSON 뒤 부가 텍스트 부착 | 프롬프트에 용어 풀어쓰기 지시 추가·extractJson 방어 실증(§5.4) |
| ⑧ | ollama 직접 호출(무인증) | 401 — gpuKey 필수 | 기존 `llmGenerate`(SystemConfig `ai.server.gpuKey`) 경로 확정 |

주의: ⑦은 스태프용 `ai/chat`(qwen2.5:**7b**·RAG sources 동봉) 경유 간접 측정 — F-7 본 구현은 `llmGenerate`(qwen2.5:**14b**·generate) 경로라 품질은 같거나 상회 예상. 약제부 검수 20종은 본 경로로 재실측.

## 6. UX/UI 설계 규약 (전 기능 공통 — 포털 기존 관례 준수)

### 6.1 테마·접근성 (위반 시 다크모드/글씨확대에서 깨짐)

| 규칙 | 근거 | 신규 컴포넌트 적용 |
|------|------|------------------|
| **Tailwind `dark:` variant 금지** — 포털 다크모드는 `<html>.portal-dark` + `globals.css`가 `bg-white`·`text-gray-*`·`border-gray-*` 등을 오버라이드하는 방식(포털 내 `dark:` 사용 0건) | `globals.css:100-125`·`MoreTab.tsx:50-57` | 컨테이너는 `bg-white`+`border-gray-100/200`+`text-gray-900/500` 조합만. 새 색 도입 시 `.portal-dark` 규칙 동반 추가 |
| **글씨 확대 대응 사이즈만 사용**: `text-xs`·`text-sm`·`text-[10px]`·`text-[8px]`·`text-lg`만 `portal-font-lg/xl`에서 확대됨. `text-[9px]`·`text-[11px]`·`text-base`·`text-xl` 지양 | `globals.css:40-57` | 알림 본문·약 설명 본문은 `text-sm`, 보조는 `text-xs`. **F-7 약 설명은 고령 사용자 핵심 대상 — `portal-font-xl`(root 20px·버튼 min-height 48px)에서 시트 레이아웃 검증 필수** |
| i18n: `useT()`(ko/en/zh/ja) 존재하나 실태는 탭 라벨만 적용·화면 문자열은 한글 하드코딩 관행 | `portal-i18n.ts:106`·`page.tsx:302` | 관행 준수(한글 하드코딩 허용). 탭/메뉴에 새 라벨 추가 시에만 CATALOG 등록 |

### 6.2 공용 컴포넌트 재사용 (`_shared/index.tsx` — 신규 제작 금지 대상)

| 용도 | 컴포넌트 | 신규 기능에서의 사용 |
|------|----------|--------------------|
| 로딩 | `SkeletonCard` | F-1 목록·F-3 카드·F-4 번들 목록 로딩 |
| 빈 상태 | `EmptyState`(이모지+title+desc+CTA) | 알림 0건("새 알림이 없습니다")·식단 없음 등 — 기존 문구 톤("~하면 이곳에서 확인하실 수 있습니다") 준수 |
| 배지 | `NotificationBadge`(red·99+·부모 relative) | 헤더 벨(부모 `relative` 기확보) |
| 상태 칩 | `StatusBadge` 매핑 확장 | F-4 번들 상태(READY/REQUESTED)·F-3 끼니 상태 |

### 6.3 `PortalSheet` 공용 시트 신설 (이번 기획의 유일한 공용 UI 신설)

현재 포털엔 공용 모달이 없고 매번 인라인 `fixed` 복제(GuardianManager `MoreTab.tsx:330-464`가 정석 패턴). F-1 패널·F-4 신청 모달·F-7 설명 시트 **3곳이 동시에 필요**하므로 이번에 공용화:

```
<PortalSheet open onClose title footer?>
  fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center   ← 오버레이 클릭 닫기
    └ bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[85vh] overflow-y-auto
        └ sticky top-0 헤더(title + ✕) · 본문 · footer      ← stopPropagation
```
- 모바일=바텀시트·데스크톱=센터 다이얼로그(`items-end sm:items-center`) — 기존 관례 그대로.
- z-index 관례 준수: 헤더 z-10 < 배너/하단탭 z-20 < FAB z-30 < 시트 z-50. **GuardianBanner(sticky 최상단)와 겹침 주의** — 시트는 전체 오버레이라 무관하나, 벨 드롭다운형으로 바꿀 경우 top 오프셋 필요(설계는 시트형이라 회피).

### 6.4 AI 로딩·면책 UX (F-7 — 기존 AI 선례 준수)

| 상황 | 패턴 | 선례 |
|------|------|------|
| 버튼 대기 | 라벨 토글("쉽게 보기" → "설명 준비 중...") + disabled | `PortalAiDrugInteractions`(HealthTab.tsx:649) |
| 잡 폴링(수십 초) | 시트 안: bounce 3점 + 단계 문구("약 정보를 확인하고 있어요 → 쉬운 말로 정리하고 있어요") — 사용자가 닫아도 잡은 계속(재열람 시 결과) | FloatingAiButton bounce(page.tsx:495-508) |
| 에러/UNAVAILABLE | 조용한 폴백 카드("아직 준비되지 않은 약이에요. 약사에게 문의하세요") — 빨간 에러 금지 | PortalAiLabExplain 폴백(HealthTab.tsx:601-603) |
| 면책 | 카드 하단 고정 `text-[8px]` "식약처 e약은요 참고 — 복약지도를 대체하지 않습니다" + AI 결과는 `bg-indigo-50` 계열로 사실 데이터와 시각 구분 | HealthTab.tsx:667·ConsultChat.tsx:163 |

F-7 시트 본문 4단 구성은 아이콘+짧은 제목("💊 무슨 약인가요 / ⏰ 어떻게 먹나요 / ⚠️ 주의하세요 / 🚨 이럴 땐 연락하세요") — 고령자 스캔 가독 우선, 문단 대신 불릿.

### 6.5 AI 표기 표준 (F-7 — 브랜딩·법적 고지·출처)

**표기 4층 구조** — 결과 시트에 항상 함께 렌더:

```
┌ 헤더:  ✨ WeRU.B 쉬운 설명                    ← 브랜드(하단 ①)
│ 본문:  💊/⏰/⚠️/🚨 4단 (bg-indigo-50 계열)     ← AI 생성 영역 시각 구분(§6.4)
│ 출처:  출처: 식약처 e약은요(개정 2026-05-12) · WeRU.B 생성 2026-07-07   ← ③
└ 고지:  본 설명은 인공지능이 생성한 참고 정보로, 복약지도를 대체하지 않습니다.
        복용·중단 등 최종 판단은 반드시 의사·약사와 상의하세요.          ← ②④
```

| # | 규칙 | 근거 |
|---|------|------|
| ① | **화면 표시명은 'WeRU.B'** — 신규 'AI' 단독 라벨 금지(진입 버튼은 브랜드 없는 "쉽게 보기") | 원내 브랜딩 규칙(표시명 AI→WeRU.B 통일, PR#18) |
| ② | **"인공지능이 생성한" 명시** — 생성형 AI 산출물임을 사용자가 인지하도록 고지 | AI기본법(2026-01 시행) 투명성 의무(생성형 AI 사용 사실 고지·산출물 표시). 문구는 법무 게이트(기획 §7-7)에서 최종 확정 |
| ③ | **출처 이중 표기**: 사실 출처(식약처 e약은요 + `update_de` 개정일)와 생성 주체(WeRU.B + 생성일)를 구분 표기 — 캐시 응답도 원 생성일 유지 | 실측 §5.6-③: `update_de` 제공 확인 |
| ④ | **WeRU.B disclaimer 정본 우선**: e약은요·DUR 응답에 disclaimer 문구가 동봉됨(실측 확인) — FE 자체 문구로 대체하지 말고 **서버 동봉 문구를 표시**(HIS·AI서버 간 문구 불일치 방지), 없을 때만 위 기본 문구 폴백 | 실측 §5.6-③⑥ |
| ⑤ | DUR 쉬운 말 카드에는 원 DUR 유형명(노인주의 등)을 배지로 병기 — 쉬운 말이 원 경고의 강도를 희석하지 않게 | §5.3 |

적용 범위: F-7 전 화면(약 단위 시트·처방전 한눈에) + 기존 AI 컴포넌트는 불변(회귀 0 — 단, 기존 `PortalAiDrugInteractions`의 'WeRU.B 참고' 문구는 이미 ① 충족).

### 6.6 보호자 위임·BTG 세션 정책 (전 신규 기능)

위임 = 토큰 스와핑(`guardian-mode` localStorage) + 최상단 배너(amber/BTG red):
| 기능 | 위임 세션 | BTG(긴급) |
|------|----------|-----------|
| F-1 알림 센터 | **숨김**(본인 계정 알림이 아님 — §1.3) | 숨김 |
| F-2 복약 체크 | **읽기 전용**(체크 버튼 비활성 — 대리 체크는 기록 무결성 훼손) | 읽기 전용 |
| F-3 입원 생활 | scope 내 열람 허용(encounters 스코프 준용) | 열람 허용 |
| F-4 서류 신청 | **차단**(서류 신청은 본인 — 대리 발급은 별도 기획·법무 대기) | 차단 |
| F-7 약 설명 | 열람 허용(정보 제공 — 보호자가 복약 도우미인 경우가 오히려 주 사용층) | 열람 허용 |

## 7. 총괄

### 7.1 config 키 (SystemConfig — 전부 기본 OFF/보수값)

| 키 | 형식·기본 | 용도 |
|---|---|---|
| `portal.inpatientLife` | boolean · false | F-3 EP·카드 게이트 |
| `portal.medicationReminder` | boolean · false | F-2 cron 게이트 |
| `portal.medicationReminderTimes` | JSON 객체 · `{"아침 식후":"08:00","점심 식후":"12:30","저녁 식후":"18:30","취침 전":"21:30"}` — **키는 슬롯 정본 4종 그대로**(§0) | 슬롯→발송 시각 |
| `portal.medicationReminderDailyCap` | number · 6 | 계정당 일일 발송 상한 |
| `portal.insuranceDocBundle` | boolean · false | F-4 게이트 |
| `portal.aiDrugExplain` | boolean · false | F-7 게이트 |

- ~~`medicationReminderScope`~~ v1.3 삭제 — 판별 필드 부재로 규칙 대체("활성 admission 없는 환자의 ACTIVE 처방", §3.2).
- SystemConfig 저장은 기존 관례대로 JSON 값(feature-access-matrix와 동일) — 문자열 파싱 자작 금지.
- F-1은 config 불요(FE 배선 — 알림 API는 기 운영). **따라서 P0 게이트는 `portal.inpatientLife` 1종.**

### 7.2 신설·수정 요약

| 구분 | BE | FE | DB(manual SQL) |
|------|----|----|----|
| 공통 | listener 핸들러 2종(`portal.medication_reminder`·번들 READY — §0 관례) | **PortalSheet 공용 시트**(§6.3) | — |
| F-1 | — | NotificationCenter 신규 + page(벨 배선)/MoreTab 수정 | — |
| F-3 | 포털 EP 2(meals=Prisma 직접·interim=BillingModule import) | HomeTab 카드 2 | — |
| F-2 | cron 1 + 이벤트 발행 + checkMedication/schedule 수정 | Settings 행·딥링크 | `medication_check_logs` |
| F-4 | request-bundle·bundles EP 3 + 자동발급 분기(스냅샷 빌더 2) + `TYPE_FEES`/`fee_rules` 확장 + **`archiver` 의존성 추가** | ServicesTab 카드·모달·번들 목록 | `document_requests.bundle_id` |
| F-7 | resolver(2-hop) + explain EP 4(잡 patientId 바인딩) + LLM·금칙어 + `GET /portal/medications` 응답에 id 추가 | DrugExplainSheet + 버튼 2곳(투약·처방 이력) + 퇴원약 조건부 | `drug_explain_cache` |
| 모바일 | — | **P1 범위 외 — 별도 설계로 이연**(웹 검증 후. F-2 푸시 수신·`data.route` 딥링크는 기존 앱 코드로 자동 동작) | — |

배포: manual SQL 3건 → `deploy.sh --schema --api`(자동 백업·`--accept-data-loss` 금지) + 서버 `prisma generate` + `nest build`(기존 규칙).

### 7.3 구현 순서 (문서상 권고 — 구현은 본 세션 범위 외)

1. **P0**: F-1(FE only·즉시 가치) → F-3(EP 2 + 카드 2)
2. **P1-a**: F-2(DDL → cron → FE) — F-1 딥링크 의존
3. **P1-b**: F-4(DDL → type 핸들러 → 번들 EP → FE)
4. **P1-c**: F-7 — ~~T-0 협의 대기~~ **T-0 해결됨(§5.1·§5.6)**: resolver(2-hop 체인) → **해석 커버리지 측정**(상위 처방 빈도 100품목 배치 해석률 — P1 완료 조건, 기획 §5) → 캐시/잡 → FE → 약제부 샘플 검수(범위는 기획 §7-7에서 확정 — 20종은 잠정) → config ON

### 7.4 검증 매트릭스 (기획 §6 구체화)

| 케이스 | 방법 |
|---|---|
| F-1 배지 정합 | 배지 수 = `unread-count` 응답 일치·읽음 처리 시 즉시 감소·전체읽음 0 |
| F-1 설정 왕복 | 설정 변경 → PUT → 재조회 일치·`MEDICATION_REMINDER` 행 생성 확인 |
| F-1 레거시 세션 401 폴백 | MRN+생년월일 로그인 → Bell 미노출·배너 확인 |
| F-2 멱등 | cron 2회 강제 실행 → `medication_check_logs` UNIQUE 위반 없이 skip·알림 1건 |
| F-2 중단 처방·입원 제외 | 처방 CANCELLED / 활성 admission 생성 후 슬롯 도래 → 미발송 |
| F-2 opt-in·일일 상한 | 설정 미등록 계정 미발송·상한 초과분 미발송 |
| F-2 FCM | 기기 등록 계정에 실푸시 수신 + `data.route`로 모바일 투약 화면 진입 |
| F-3 IDOR | 타 환자 세션으로 meals·interim-bill 호출 → 본인 admission 데이터만(경로에 식별자 파라미터 없음 — 세션 주입 확인) |
| F-3 ERP 미구성 | `available:false` → FE 카드 미렌더(콘솔 에러 0) |
| F-4 번들 정합 | 묶음 신청 → 구성 N건 `bundle_id` 일치·자동발급분 즉시 READY·totalFee=구성 합 |
| F-4 부분 READY | 직원작성분 REQUESTED 상태에서 zip → 자동발급분만 포함 + 안내 |
| F-4 진위·알림 | zip 내 각 PDF 진위QR 검증 통과·전 구성 READY 시 `DOCUMENT_READY` 알림 1건 |
| F-4 소유 검증 | 타 환자 bundleId 접근 → 404 |
| F-7 소유 검증 | 타 환자 prescriptionId/jobId 접근 → 404 |
| F-7 매핑 실패 | resolver null 약품 → UNAVAILABLE 폴백 문구·LLM 미호출 |
| F-7 캐시·개정 | 동일 약 2회 조회 → 2회째 LLM 0회 / `checked_at` 30일 경과 후 `update_de` 변경 시 재생성 |
| F-7 장시간 잡 | 처방 10종 encounter 한눈에 → 60초 초과에도 폴링 완주(nginx 무관) |
| F-7 금칙어 | 프롬프트 주입성 원문으로 "복용 중단" 유도 → 문장 drop 확인 |
| F-7 DUR·표기 | DUR 명칭 입력 해석(`via:'name'`)·시트에 서버 disclaimer 정본 렌더(§6.5-④) |
| F-7 커버리지 | 상위 처방 빈도 100품목 배치 해석률 리포트(P1 완료 조건) |
| **UX: 다크모드** | `.portal-dark` 상태에서 신규 컴포넌트 전부 육안 확인(비매핑 색 잔존 0) |
| **UX: 글씨 확대** | `portal-font-xl`(root 20px)에서 F-7 시트·알림 패널 레이아웃 깨짐 없음·버튼 48px |
| **UX: 위임 세션** | guardian-mode에서 벨 미노출·복약 체크 비활성·서류 신청 차단·약 설명은 열람 가능 |
| **UX: 시트 반응형** | 모바일=바텀시트/데스크톱=센터·오버레이 클릭 닫기·내부 스크롤 85vh |
| 회귀 | 전 config OFF → 포털 스냅샷/E2E 현행 동일(기존 벨 버튼은 껍데기라 배선해도 시각 회귀 없음) |
