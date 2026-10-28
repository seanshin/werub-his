# 제로 트러스트 단말 보안 & 초고속 사용자 전환 설계서 v1.0 (Plan §6)

> Plan: [security-governance-master.plan.md](../../01-plan/features/security-governance-master.plan.md) (v1.1) §6 단말 보안 트랙
> 연계: [staff-onboarding-ess](../../01-plan/features/staff-onboarding-ess.plan.md)(FR-F7 동의)·[staff-sso-passwordless](../../01-plan/features/staff-sso-passwordless.plan.md)(패스키·step-up)
> 작성일: 2026-06-14 / 상태: Draft (설계 착수)
> 핵심: **단말 mode(어디서) × 직군 role(누가)로 보안 프로파일 동적 결정** + 기존 인증/감사/암호화 자산 재사용 + **외부 게이트(BLE·앱·법무) 항목은 인터페이스만, 구현은 게이트 해제 후**.

---

## 0. 설계 원칙 & 재사용 우선

본 트랙은 **신규 인증수단이 아니라** 기존 자산 위 **단말 컨텍스트·근접성·세션풀 계층 추가**(Plan §6 머리말). 신뢰 4원칙(Plan §6.0): ①HSM 키 클라우드 최소화 ②블록체인 Root of Trust ③포털 발급 인증코드 ④무마찰.

### 0.1 실측 기반 — 기존 자산 분석 (재사용 / 격리 판정, 2026-06-14 Explore 확정)

**✅ 재사용 (그대로 또는 확장):**
| 자산 | 위치 | 본 설계 활용 |
|------|------|--------------|
| `StaffDevice`(+`fcmToken` 스태프 푸시·WebAuthnCredential.deviceId) | schema:5358 / device-enroll.service.ts | **기기 앵커** — TerminalRegistry·데일리PIN·푸시(FIDO/Kill-Switch) 모두 이 모델에 연결 |
| `device-enroll.service`(QR 6자리·5분 TTL·ADMIN_QR/SELF) | auth/device-enroll | **마스터 QR 현장 오버라이드 패턴** 재사용 |
| `AttendanceRecord`+`ess.clock(userId,type,method)` | schema:9524 / ess.service.ts:51 | **출근 clock-in에 데일리 PIN 발급 통합**(중복 신설 금지) — method에 `PIN` 추가 |
| step-up(`getOptions/verify/consume`, StepUpClaims) | auth/step-up | 고위험 step-up·PIN 발급 생체 봉인(action=`daily_pin_issue`) |
| SLO `revokeAllForUser` | sso-idp.service.ts:94 | Kill-Switch(분실 격리) |
| AuditService `log()`·`anchorAuditLogs()` | audit.service.ts:27,62 | 블록체인 Root of Trust 적재 |
| EncryptionService `encrypt/decrypt`(AES-256-GCM) | patient-auth:19 | Atomic Draft 암호화 |
| break-glass `grant()` | break-glass.service.ts:47 | 응급 예외 경로 |
| config-runtime `get/set` | config-runtime.service.ts | 타임아웃·platform 토글(**새 네임스페이스** ↓) |
| mobile `usePushNotifications`·Expo push | apps/mobile | 환자앱 푸시 인프라 — 직원앱 푸시는 `StaffDevice.fcmToken` 별도 |

**🚫 격리 (혼용 금지 — 도메인 다름, 충돌 확인됨):**
| 기존 PIN/자산 | 실제 용도 | 본 데일리 PIN과 |
|---------------|-----------|------------------|
| config `blockchain.pin*` | **블록체인 전자인증서 서명 PIN** 실패추적(BlockchainCertificate.pinFailCount, blockchain-cert.service) | **재사용 금지** → 데일리 PIN은 **신규 `terminal.pin.*` config 네임스페이스** |
| `PatientAccount.pinHash`·mobile `loginWithPin`·`/patient-auth/login/pin` | **환자 포털 앱** 간편로그인(bcrypt·phone+deviceId) | 무관(환자≠직원) — 별도 저장소, 충돌 없음 |

> ✅ **§10-1 해소**: 기존 PIN 2종(환자 로그인 PIN·인증서 서명 PIN)은 모두 **대상·용도가 달라 데일리 단말 PIN과 충돌 없음**. 단 config 키는 `blockchain.pin*` 재사용 금지 → `terminal.pin.length/lockAttempts/lockMinutes` 신설. PIN 자체는 Redis HMAC(휘발), 발급 사실만 AttendanceRecord/감사.

### 0.2 게이트-지연 (인터페이스만 설계, 구현 보류)
BLE 근접·안면 liveness·전용 앱 네이티브·위치정보(법무·노사)·비콘 인프라 → **추상 인터페이스 + 시뮬레이션 어댑터**로 설계(production-service-integration 토글 패턴). 게이트 해제 후 실구현 주입.

---

## 1. 아키텍처

```
[단말 부팅/접속]  X-Device-UUID + IP
        │  GET /api/v1/terminal/context
        ▼
[terminal 모듈]  TerminalContextService.resolve()
   ├ TerminalRegistry 조회(deviceUuid|ip) → mode(PUBLIC/PRIVATE)·dedicatedUserId
   ├ 로그인 user.role 결합 → effectiveProfile = f(mode, role)   ← Plan §6.1.1
   └ SecurityProfile 반환(공용/전용 × 의료진/스탭 4시나리오 + 타임아웃·step-up 강도)
        │
        ▼
[프론트(Next.js)]  Zustand sessionPool + activeUserId
   ├ GNB(액티브 배지·대기 세션탭)  ├ 이중 게이트 잠금화면(z-50)
   ├ profile 따라 BLE/안면 컴포넌트 교체 렌더(무새로고침)
   └ 전환 = activeUserId 교체 + 토큰 체인 교체(reload 금지, <0.5s)
        │
        ▼  (보안 이벤트마다)
[AuditService.log() → anchorAuditLogs()]  블록체인 Root of Trust

[개인 생체인증 포털(운영=전용앱/개발=웹)]  ← 데일리 PIN·인증코드 발급 원천(생체 봉인)
[근접/이탈]  BLE RSSI AND 네트워크(Dual-Safe) → 잠금 ← 페일모드·BTG 예외
```

### 1.1 신규 모듈
- `terminal`(NestJS) — TerminalRegistry CRUD·context resolve·override·daily-pin·session·draft·kill-switch.
- 프론트 `useTerminalStore`(Zustand) — sessionPool·activeProfile·lockState.
- mobile `terminal-portal`(Expo 확장) — PIN 발급·BLE 광고·FIDO 푸시(게이트).

---

## 2. 데이터 설계

### 2.1 신규 모델 `TerminalRegistry` (Prisma)
```prisma
model TerminalRegistry {
  id              String   @id @default(uuid()) @db.Uuid
  deviceUuid      String   @unique @map("device_uuid") @db.VarChar(128)  // X-Device-UUID
  ipAddress       String?  @map("ip_address") @db.VarChar(45)            // 고정 IP(보조키)
  macAddress      String?  @map("mac_address") @db.VarChar(32)
  mode            String   @default("PUBLIC") @db.VarChar(8)             // PUBLIC | PRIVATE
  dedicatedUserId String?  @map("dedicated_user_id") @db.Uuid           // PRIVATE 전담(기본세션, 물리차단X)
  location        String?  @db.VarChar(120)                             // 간호스테이션/진료실
  label           String?  @db.VarChar(120)
  beaconId        String?  @map("beacon_id") @db.VarChar(64)            // BLE 비콘(게이트)
  status          String   @default("ACTIVE") @db.VarChar(16)           // ACTIVE|QUARANTINED|RETIRED
  lockTimeoutSec  Int?     @map("lock_timeout_sec")                     // null=프로파일 기본(§6.7.1)
  registeredById  String?  @map("registered_by_id") @db.Uuid
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz()
  dedicatedUser   User?    @relation("TerminalDedicated", fields: [dedicatedUserId], references: [id])
  @@index([deviceUuid])
  @@index([ipAddress])
  @@map("terminal_registry")
}
```

### 2.2 신규 모델 `StaffConsent` (FR-T11·온보딩 동의 게이트)
```prisma
model StaffConsent {
  id               String    @id @default(uuid()) @db.Uuid
  userId           String    @unique @map("user_id") @db.Uuid
  locationConsent  Boolean   @default(false) @map("location_consent")    // 위치정보법
  biometricConsent Boolean   @default(false) @map("biometric_consent")   // 개보법§23 안면
  passkeyConsent   Boolean   @default(false) @map("passkey_consent")
  consentDocId     String?   @map("consent_doc_id") @db.Uuid             // IssuedDocument 봉인 참조
  consentedAt      DateTime? @map("consented_at") @db.Timestamptz()
  revokedAt        DateTime? @map("revoked_at") @db.Timestamptz()
  updatedAt        DateTime  @updatedAt @map("updated_at") @db.Timestamptz()
  user             User      @relation(fields: [userId], references: [id])
  @@map("staff_consent")
}
```

### 2.3 휘발성 상태 — Redis (모델 미생성, §6.0-1 키 최소화)
| 키 | 값 | TTL | 용도 |
|----|----|----|------|
| `daily_pin:{yyyymmdd}:{userId}` | **HMAC-SHA256(pin, serverKey)** | 자정/24h | PIN 검증(평문 비저장, §6.5) |
| `daily_active_pins:{yyyymmdd}` | Set\<HMAC\> | 자정 | 유일성 검사 |
| `terminal:pool:{deviceUuid}` | Set\<userId\> | 세션 | 멀티세션풀 |
| `terminal:session:{deviceUuid}:{userId}` | {tokenRef, lastActiveAt} | idle | 세션 컨텍스트 |
| `draft:{userId}` | **encrypt(snapshot)** | 짧음(전환/잠금 후 소거) | Atomic Draft(§6.4.1) |
| `terminal:lock:{deviceUuid}` | {state, reason, since} | — | 잠금 레이어 |

> PIN은 **HMAC만**(복원불가)·`daily_pin.issued` 이벤트만 감사 적재(평문/changes 금지, §6.5). draft는 EncryptionService 암호화. PIN 실패잠금은 신규 `terminal.pin.lockAttempts/lockMinutes` config(블록체인 인증서 PIN과 별개) + Redis `daily_pin_fail:{date}:{userId}` 카운터.

### 2.4 기존 모델 확장 (additive·비파괴)
- `User` — relation `TerminalRegistry?`(전담), `StaffConsent?`. (컬럼 추가 없음)
- `StaffDevice`(기존, schema:5358) — **직원 인증앱 기기 앵커로 재사용**. 기존 `fcmToken`으로 FIDO 푸시·Kill-Switch 알림(신규 푸시 인프라 불요). BLE `beaconId` 매핑은 게이트(D5).
- `AttendanceRecord`(기존, schema:9524) — `method` 열거값에 **`PIN` 추가**(QR|BIO|MANUAL|PIN). **출근 PIN 발급 = `ess.clock(userId, 'CLOCK_IN', 'PIN')` 호출과 통합**(별도 출근 흐름 신설 금지) → 기존 ERP `staff.attendance_recorded` webhook 자동 연동.
- ⚠️ `blockchain.pin*`·`PatientAccount.pinHash`는 **건드리지 않음**(§0.1 격리).

### 2.5 신규 권한 (permission.types.ts, CRED_* 패턴 따름)
```
TERMINAL_MANAGE    // 단말 등록·모드 변경 (보안담당자/ADMIN)
TERMINAL_OVERRIDE  // 현장 오버라이드·격리
TERMINAL_KILL      // 분실 Kill-Switch
```
ROLE_PERMISSIONS: ADMIN 전부, 보안담당자 역할(또는 CRED_* 보유자)에 grant. **신규 역할 신설 없이**(기존 패턴).

---

## 3. 프로파일 결정 로직 (effectiveProfile = f(mode, role))

```ts
// TerminalContextService.resolve(deviceUuid, ip, user)
mode = registry.mode ?? PUBLIC                  // 미등록 단말 = 보수적 PUBLIC
roleClass = isClinician(user.role) ? 'CLINICIAN' : 'STAFF'   // DOCTOR/NURSE/PHARMACIST/LAB_TECH = CLINICIAN
profile = {
  ui: mode==='PUBLIC' ? ['BLE_PROXIMITY','MULTI_SESSION_POOL','DAILY_PIN']
                      : ['FACE_TRACKING'],            // §6.1
  clinicalFeatures: roleClass==='CLINICIAN',          // 스탭=임상 비노출(§6.1.1-B)
  stepUpHighRisk: roleClass==='CLINICIAN',            // 처방·서명·마약류 단말무관 step-up
  lockTimeoutSec: registry.lockTimeoutSec ?? (mode==='PUBLIC' ? 180 : 600),  // §6.7.1 공용3분/전용10분
  selfScopeOnly: roleClass==='STAFF' && mode==='PRIVATE',  // §6.1.1-D
}
if (mode==='PRIVATE' && user.id !== registry.dedicatedUserId)
   audit.log(WARN '전용단말 비전담 로그인') + adminNotify   // §6.1.1
```
- **단말 mode = UI 동작 지배 / 직군 role = 기능 노출·step-up 강도 지배**(Plan §6.1.1 확정).
- 4시나리오(A 공용·의료진 / B 공용·스탭 / C 전용·의료진 / D 전용·스탭) = 위 조합 산출.

---

## 4. API 설계 (terminal 모듈)

| Method · Path | 가드 | 설명 |
|---------------|------|------|
| `GET /api/v1/terminal/context` | JwtAuth | X-Device-UUID/IP → SecurityProfile(§3) |
| `POST /api/v1/terminal/registry` | TERMINAL_MANAGE | 단말 등록/수정(mode·dedicatedUser) |
| `POST /api/v1/terminal/override` | TERMINAL_OVERRIDE | 현장 오버라이드 → **Redis evict** + 감사 |
| `POST /api/v1/terminal/daily-pin` | JwtAuth + **step-up(생체)** | PIN 생성(유일성)·생체 봉인·`daily_pin.issued` 적재 |
| `POST /api/v1/terminal/daily-pin/verify` | (공개·복합검증) | `[deviceUuid]+[사번]+[pin]` HMAC 매칭 → 세션 |
| `POST /api/v1/terminal/session/switch` | JwtAuth | activeUserId 교체·토큰 체인 교체(<0.5s) |
| `POST /api/v1/terminal/draft` / `GET …/draft` | JwtAuth | Atomic Draft 저장(암호화)/복원 |
| `POST /api/v1/terminal/lock` / `unlock` | JwtAuth | 잠금 레이어 상태 |
| `POST /api/v1/terminal/kill-switch` | TERMINAL_KILL | 분실 → `revokeAllForUser` + 토큰 삭제 |
| `GET /api/v1/terminal/registry` | TERMINAL_MANAGE | 단말 목록·상태 |

- daily-pin 발급은 **step-up.verify로 생체 봉인**(action=`daily_pin_issue`) → §6.5 "승인=생체 서명".
- override는 모드/전담 변경 후 `terminal:*:{deviceUuid}` **evict** → 프론트 재fetch.

---

## 5. 세션 생명주기 상태머신

```
[출근] 포털 생체(FIDO) ──► ess.clock(CLOCK_IN,'PIN') + generateDailyPin(step-up 봉인) ──► [ACTIVE]
       └ 기존 출퇴근(AttendanceRecord)·ERP webhook 통합, PIN 발급은 clock-in의 부수효과
   │                                                            │
   │ 전환(switch) activeUserId 교체 ◄──────────────┐           │
   ▼                                               │           ▼
[멀티세션풀] 대기 세션 ──PIN/생체──► ACTIVE 복귀 ──┘   이탈(BLE/안면 상실)·미입력
   │                                                            ▼
   │                                                       [LOCKED] (Atomic Draft 캡처·PHI 소거)
   │                                                       복귀: 근접 자동 / PIN / 빠른전환
   ▼
[자정 23:59:59 또는 24h] TTL ──► DATE_CHANGED_EXPIRED ──► [PIN 재설정·연장 모달] ──► ACTIVE(익일)
   │
   ▼
[미퇴근 방치] 새벽 Cron + Redis TTL ──► 무효화 ──► [FIDO 출근 인증 강제복귀]

[응급] Break-glass 발동 ──► 잠금·PIN 게이트 일시 우회(전체 감사·사후승인) ──► [BTG-ACTIVE]
[네트워크 단절] BLE 강신호 단독 ──► grace(작업지속·로컬보존) / Redis 장애 ──► fail-secure(고위험)·grace(저위험)
```

### 5.1 자정 만료·연속 근무 (§6.8)
- 데일리 PIN Redis TTL = **다음 자정**(또는 발급+24h, 짧은 쪽). 차트 저장 API가 만료 감지 시 `DATE_CHANGED_EXPIRED` 시그널 → 프론트 [재설정·연장] 모달(무손실).
- 미퇴근 Cron(`@Cron` 새벽) — `daily_pin:*`·`terminal:session:*` 스윕, 단말 status 점검. **근태 무결성 보정은 §5.3**.

### 5.3 미퇴근(No Clock-out) 해소책 — 보안 + 근태 무결성

> ⚠️ 출근 PIN 발급을 `ess.clock(CLOCK_IN)`에 통합(§2.4)했으므로, **CLOCK_IN만 있고 CLOCK_OUT이 없는 상태**(퇴근 서명 누락)를 반드시 해소해야 한다. **보안 세션 정리**와 **근태 무결성(급여·ERP)** 두 축을 분리 처리.

#### 5.3.1 3-경우 판별 (`lastActiveAt` 기준)
새벽 Cron(또는 자정 TTL 만료 시점)이 미마감 세션을 **마지막 활동시각으로 분기**:

| 경우 | 판별 | 처리 |
|------|------|------|
| **A. 연속근무**(야간 당직) | `lastActiveAt`가 최근(임계 내, 예: 30분) — 실제 사용 중 | §6.8-2 **연장**: `DATE_CHANGED_EXPIRED` → [PIN 재설정·연장] 모달 → 익일 자정까지 연장. **퇴근 미발생은 정상**(근무 지속), 근태 보정 없음. |
| **B. 미퇴근 방치** | `lastActiveAt` 오래됨(무활동) — 퇴근했으나 미체크 | ① 보안 정리 ② 근태 보정(↓ 5.3.2) |
| **C. 강제복귀 후 재출근** | 무효화 후 같은 날 재접속 | **중복 `CLOCK_IN` 방지** — 당일 미마감 CLOCK_IN 존재 시 신규 출근 대신 세션 복원(기존 출퇴근 토글 §qr.service CLOCK 로직 정합). |

#### 5.3.2 미퇴근 방치(B) — 근태 무결성 보정
1. **보안(즉시)**: Cron이 `daily_pin:*`·`terminal:session:*` 무효화 → 단말 [FIDO 출근 인증 강제복귀](§6.8-3). 방치 단말로의 무단 접근 차단.
2. **추정 퇴근(provisional CLOCK_OUT)**: AttendanceRecord에 `type=CLOCK_OUT, method='AUTO', at=lastActiveAt, correctionOf=<출근레코드>` 생성. **급여 확정 불가 — `provisional=true` 플래그**(추가 컬럼, additive). 시각은 **마지막 활동시각**(보수적, 임의 정규시각 금지).
3. **근태 정정 연동(기존 ESS 재사용)**: 다음 로그인/근무일에 본인에게 ESS 알림 "전일 퇴근 누락 — 실제 퇴근시각 확인" → **기존 `ess` FR-D2 근태정정 신청** 흐름(출퇴근 누락 정정·부서장 승인) → 확정 시 provisional 해제·ERP 재송신.
4. **ERP 정합**: 추정 퇴근의 `staff.attendance_recorded` webhook은 **`provisional` 마킹**으로 송신 → ERP 급여는 확정분만 반영. 정정 확정 후 갱신 webhook.

#### 5.3.3 모델 확장 (additive)
```prisma
// AttendanceRecord 확장 (기존 schema:9524)
provisional   Boolean   @default(false) @map("provisional")        // 추정 퇴근(보정 대기)
autoClosedAt  DateTime? @map("auto_closed_at") @db.Timestamptz()   // Cron 자동마감 시각
```
- `method` 열거값에 `AUTO` 추가(기존 QR|BIO|MANUAL|PIN + AUTO).
- ⚠️ **추정 퇴근은 절대 급여 확정 입력 아님** — `provisional` 클램프, 본인 확인·부서장 승인 후에만 확정(근로기준법 근태 정확성).

### 5.2 잠금 ≠ 로그아웃 ≠ 세션만료 (3계층, §6.7.1)
| 계층 | 트리거 | 동작 |
|------|--------|------|
| 잠금 | 근접 이탈(5초 유예)/미입력(공용180s/전용600s) | 레이어 + Draft 캡처(로그인 유지) |
| 세션만료 | idle 30/60분(기존 `security.session.timeoutMinutes`) | 로그아웃 |
| 자정만료 | TTL | PIN 재설정 |

---

## 6. 프론트엔드 설계 (Next.js)

### 6.1 `useTerminalStore` (Zustand, 기존 auth-store 패턴)
```ts
interface TerminalState {
  profile: SecurityProfile | null;        // GET /terminal/context
  sessionPool: SessionEntry[];            // 인증컨텍스트만(토큰ref·표시메타) — PHI 미보유(§6.4.1)
  activeUserId: string | null;
  lock: { state: 'OPEN'|'LOCKED'; reason?: string };
  switchUser(userId): Promise<void>;      // 토큰체인 교체, reload 금지
  refreshProfile(): Promise<void>;        // override 후 evict 재fetch
}
```
- **PHI 격리(§6.4.1)**: sessionPool 엔트리는 `{userId, name, role}` 최소 메타만. **비활성 세션 차트/검사 PHI는 메모리·DOM 비잔존**(전환 시 언마운트·캐시 purge).

### 6.2 컴포넌트
- `GnbActiveBadge` — 액티브 유저 이름·과 강조(`● [외래] 김닥터 교수(내과)`).
- `SessionPoolTabs` — 대기 세션 타일(최소 식별정보), 클릭→PIN 팝업.
- `DoubleGateLock`(z-50) — 좌: 데일리 PIN 패드 / 우: 대기 타일 + [+신규 FIDO].
- 프로파일 따라 `BleProximity`(게이트=시뮬) / `FaceTracking`(게이트=시뮬) 교체 렌더.

### 6.3 토큰 체인 전환
- 기존 `apiClient.setToken` + localStorage 다중 슬롯(`accessToken:{userId}`) → activeUserId 교체 시 헤더만 스왑. reload 없음.

---

## 7. 재사용 매핑 (구현 시 주입)

| 본 설계 기능 | 재사용 자산 | 호출 |
|--------------|-------------|------|
| PIN 발급 생체 봉인 | step-up | `getOptions`→`verify(action='daily_pin_issue')` |
| 고위험 step-up(의료진) | step-up | `consume(token, userId, action, {bodyHash})` |
| Kill-Switch(분실) | sso-idp | `revokeAllForUser(userId)` + WebAuthnCredential status=REVOKED |
| 보안 이벤트 적재 | audit | `log({action, resourceType:'TERMINAL', resourceId, changes})` → `anchorAuditLogs()` |
| Draft 암호화 | encryption | `encrypt(JSON)` / `decrypt` |
| 응급 예외 | break-glass | `grant(approverId, {staffUserId, reason, scope, minutes})` |
| 타임아웃·PIN·platform 토글 | config-runtime | `terminal.lock.publicSec`·`terminal.pin.lockAttempts`·`staffPortal.platform` (신규 네임스페이스) |
| 기기 앵커·마스터 QR | StaffDevice/device-enroll | WebAuthnCredential.deviceId 연결, QR 6자리 패턴 |
| 출근 통합 | ess.clock | `ess.clock(userId,'CLOCK_IN','PIN')` → AttendanceRecord + ERP webhook |
| 푸시(FIDO·Kill-Switch) | StaffDevice.fcmToken | 직원앱 푸시(기존 필드, 신규 인프라 불요) |

---

## 8. 보안 설계 결정 (검토 반영, Plan §6.5·6.7.2·6.7.3·6.4.1)

1. **PIN 비밀**: Redis `HMAC(pin, serverKey)`만, 평문·복원가능 금지. 감사는 `issued` 사실만. AuditInterceptor PIN 필드 마스킹 등록. brute force = 기존 `blockchain.pinLockAttempts` 슬롯 재사용(잠금).
2. **PHI 격리(§6.4.1)**: 비활성 세션 PHI 메모리 소거·draft 암호화/짧은 TTL·풀 타일 최소정보.
3. **페일모드(§6.7.2)**: 네트워크 단절+BLE 강신호=grace, Redis 장애=고위험 fail-secure/저위험 grace. (최종값 §9)
4. **응급 BTG(§6.7.3)**: BTG>잠금, 잠금·PIN 게이트 우회하되 BTG 자체 인증·전체 감사·사후승인 유지.
5. **안면 liveness**: 단독 해제는 liveness 통과 시만, 고위험은 안면+step-up.
6. **키 최소화**: PIN serverKey·session은 Redis/config-runtime 슬롯, HSM 키 비보유(서명코어 외부 sign).

---

## 9. Phase 계획

| Phase | 내용 | 게이트 |
|-------|------|--------|
| **D1 (게이트 무관)** ✅구현 | TerminalRegistry·StaffConsent 모델·terminal 모듈(context resolve §3·registry·override)·TERMINAL_* 권한·감사 배선·AttendanceRecord provisional 컬럼·DDL(manual/terminal-zero-trust-d1.sql). nest build 0에러 | 없음 |
| **D2** ✅구현 | 데일리 PIN(HMAC·유일성·복합검증·실패잠금·**ess.clock 출근통합**)·Atomic Draft(AES-256-GCM·TTL)·config `terminal.*` 슬롯·**시드 5단말**·운영ops 문서. nest build 0에러·운영배포·라우트 401·5단말 시드·**E2E 검증 통과**(context 공용/전용·PIN 발급→검증·오답/미등록 403·Draft 왕복·출근 method=PIN). (step-up 봉인·세션풀 zero-reload는 D3 연계) | 없음(웹 시뮬) |
| **D3** ✅구현 | useTerminalStore(세션풀 PHI격리)·lib/terminal(X-Device-UUID·context/PIN/draft)·GnbBadge·DoubleGateLock(z-50)·admin/terminal-security 데모. 웹빌드·배포·페이지200. (운영 전역 마운트는 앱·법무 게이트 후) | 없음 |
| **D4** ✅구현 | Kill-Switch(SLO revokeAllForUser+패스키폐기+PIN/draft제거)·응급 BTG 우회(emergencyBypass)·페일모드(health·config). 운영배포·E2E(health·BTG bypass·Kill-Switch). | 페일모드 최종값 확정(§9) |
| **D5 (게이트)** | BLE 근접·안면 liveness·전용 앱 네이티브·비콘 — 시뮬 어댑터→실구현 | 법무·노사·모바일앱·하드웨어 |
| **D6 (게이트)** | 온보딩 [단말 보안 동의 단계] 실연동(staff-onboarding-ess 정합) | 동의서·법무 |

> D1~D4는 **웹 시뮬레이션으로 즉시 개발 가능**(BLE/안면=토글 스텁). D5~D6은 외부 게이트.

---

## 9.1 gap-detector 검증 (2026-06-14) — Match 92% (D1~D4 게이트 무관)

설계↔구현 일치 92%·핵심결정 7중 6 준수·격리(blockchain.pin* 미사용) 100%. D1~D4 **조건부 종결 가능**. 드리프트성 결함 없음(불일치 대부분 설계에 명시된 의도적 지연).

**잔여과제(설계엔 있으나 코드 골격/없음 — 게이트·연계로 분리 트래킹):**
| # | 항목 | 상태 | 게이트/연계 |
|---|------|------|------------|
| R1 | 미퇴근 자동마감 Cron | ✅ **해소**(terminal-cron.service, 4AM, provisional) | — |
| R2 | PIN 발급 step-up(생체) 봉인 | 미적용(JwtAuth만) | **APP 플랫폼 게이트**(§6.11 — WEB 개발은 생체 부재, 전용앱 전환 시 활성) |
| R3 | 세션풀 토큰체인 실제 스왑 | 골격(activeUserId만) | 운영 전역 마운트 시 배선 |
| R4 | BTG 우회 집행 경로 | 플래그(emergencyBypass)만 | 운영 전역 마운트(잠금 집행부)와 함께 |
| R5 | override Redis evict | 로그만 | 서버측 context 캐시 도입 시(현재 무캐시라 무의미) |
| R6 | session/switch·lock·unlock EP | 프론트 Zustand만 | 운영 전역 마운트 시 |

> R2~R6은 모두 **운영 전역 마운트(D5/D6 게이트)·APP 플랫폼 전환**과 함께 처리. 게이트 무관 핵심(D1~D4)은 운영 배포·E2E 완료.

## 10. 미해소 (Plan §9 상속 + 설계 특정)
1. ~~기존 PIN 연결 확인~~ ✅ **해소(2026-06-14)**: `blockchain.pin*`=인증서 서명PIN·`PatientAccount.pinHash`=환자로그인 — **둘 다 데일리 단말PIN과 도메인 무관, 충돌 없음**. config는 `terminal.pin.*` 신설, 출근은 `ess.clock` 통합, 기기는 `StaffDevice` 앵커. (§0.1 확정)
2. 페일모드 fail-secure/open 최종값·grace 길이(임상부서·보안).
3. 응급 BTG 우회 범위·사후승인 SLA(§3.1 정합).
4. 안면 liveness 엔진·온디바이스 처리 설계.
5. 전용 앱 스토어·MDM·iOS BLE 백그라운드 제약(모바일앱 팀).
6. SecOps: 마스터 QR 보유·분실 SLA.
7. 위치정보법 신고의무·노사 의결(시행 게이트, Plan §6.9).
8. `staffPortal.platform` 전환 게이트(앱 배포 후 웹 발급 봉쇄).

> ⚠️ 모든 신규 모델은 additive DDL(`npx prisma db execute`, db push 금지 — procedure_codes 드리프트). 기존 가드/감사/암호화 비파괴.
