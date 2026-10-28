# 병원 내부포털 — 웹 SSO + 패스워드리스 설계서 v1.2

> **요약**: 패스키(WebAuthn) 패스워드리스 로그인 + HIS 내부 IdP SSO + step-up 전자서명 게이트 + 관리자 검증 디바이스 등록 + 호출/긴급알림 + Break-glass의 상세 설계.
>
> **프로젝트**: Hospital RUN (한국형 대학병원급 HIS, v3.7.0)
> **작성일**: 2026-06-05
> **상태**: Draft
> **Plan 문서**: [staff-sso-passwordless.plan.md](../../01-plan/features/staff-sso-passwordless.plan.md) (v1.7, FR-01~53)
> **사전조사**: Plan 부록 B — G-1 PACS(기존 pacs-proxy/nginx/OHIF 재사용) ✅ · SMART OAuth2(smart-auth 재사용) ✅
> **미해소 게이트**: G-2 전자서명 법무(FR-09/10만 영향 → "법무 대기"로 표시)

---

## 1. 개요

### 1.1 설계 목표
- 기존 `auth`(JWT+Redis)·`smart-auth`(OAuth2)·`pacs-proxy`·`notification` 자산을 **최대 재사용**하고 신규는 최소화.
- 생체 원본 비전송(공개키만), 피싱 내성(RP ID 바인딩), 토큰 단기·1회용·바인딩으로 **보안 기본값** 확보.
- 패스키 실패·인증장애에도 진료 연속성(폴백·Break-glass)으로 **가용성** 보장.

### 1.2 설계 원칙
- **재사용 우선**: 신규 토큰체계 금지 — 기존 JWT/세션 코어 위에 패스키 검증만 추가.
- **모듈 경계**: `auth` 하위에 `passkey`·`device-enroll`·`sso-idp`·`step-up` 하위 모듈, 호출/알림은 `notification` 확장.
- **보안 기본값(secure by default)**: UV required, 토큰 jti·세션 바인딩, 페이로드 최소화.
- **점진 롤아웃**: 비밀번호 로그인 보존 → 부서 opt-in → 전사.

---

## 2. 아키텍처

### 2.1 컴포넌트 다이어그램
```
┌────────────── apps/web (Next.js) ──────────────┐
│  /staff/login  /staff(런처)  /admin/staff-devices │
│  @simplewebauthn/browser · notification-store(SSE)│
└───────────┬──────────────────────────┬──────────┘
            │ REST /api/v1             │ SSE /notifications/stream
┌───────────▼──────────────────────────▼──────────┐
│              apps/api (NestJS)                    │
│  auth/                                            │
│   ├─ passkey/      (FR-01~03,20~22,28)            │
│   ├─ device-enroll/(FR-30~32,43)                  │
│   ├─ sso-idp/      (FR-06~08,17,18) ← smart-auth  │
│   ├─ step-up/      (FR-09~10) ← blockchain-sign   │
│   └─ break-glass/  (FR-51)                        │
│  notification/ (확장: 호출·긴급·Code FR-38~50)     │
│  auth.service(JWT+Redis 재사용) · RBAC · AuditLog  │
└───────┬───────────────┬───────────────┬──────────┘
        │ Prisma        │ Redis         │ 리버스프록시(nginx)
   PostgreSQL      세션/챌린지/jti   OpenPACS(OHIF/Orthanc)·Jitsi
```

### 2.2 모듈 의존
| 모듈 | 의존(재사용) | 신규 |
|------|------|------|
| passkey | auth.service, RBAC, AuditLog | WebAuthnCredential, ceremony |
| device-enroll | passkey, SSE, AuditLog | StaffDevice, 등록세션(Redis) |
| sso-idp | **smart-auth**, pacs-proxy, auth.service | introspection·jti·revocation·internal token_type |
| step-up | passkey, **blockchain-sign**, AuditLog | step-up 토큰·가드 |
| break-glass | auth.service, AuditLog, notification | 비상 접근 발급·승인 |
| notification(확장) | 기존 service·SSE·FCM | 그룹 타게팅·호출 응답·에스컬레이션·StaffDevice FCM |

### 2.3 데이터 흐름 (핵심)
```
패스키로그인: 식별자→challenge(Redis)→assertion→검증→auth.service.issueTokens()→세션
SSO진입: 런처→sso-idp.grant(audience)→단기토큰(jti)→redemption→프록시검증→하위시스템
Step-up: 행위→challenge→assertion→step-up토큰(action·resource·bodyHash)→가드→blockchain서명
```

---

## 3. 데이터 모델

### 3.1 신규 Prisma 모델
```prisma
model WebAuthnCredential {
  id            String   @id @default(uuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id])
  credentialId  String   @unique           // base64url
  publicKey     Bytes                       // 공개키만(원본 생체 X)
  counter       BigInt   @default(0)        // signCount, 복제감지(FR-21)
  transports    String[]
  aaguid        String?
  backedUp      Boolean  @default(false)    // synced passkey(FR-26)
  deviceId      String?                     // → StaffDevice(FK)
  device        StaffDevice? @relation("DeviceCredentials", fields: [deviceId], references: [id])
  status        String   @default("ACTIVE") // ACTIVE/REVOKED/REPLACED/LOCKED(FR-21 signCount 역행)
  createdAt     DateTime @default(now())
  lastUsedAt    DateTime?
  @@index([userId])
}

model StaffDevice {
  id            String   @id @default(uuid())
  userId        String
  user          User     @relation("UserStaffDevices", fields: [userId], references: [id])  // 양방향
  deviceName    String
  status        String   @default("ACTIVE") // ACTIVE/REVOKED/REPLACED
  credentials   WebAuthnCredential[] @relation("DeviceCredentials")  // 역방향
  // 등급: enrollChannel(방식) × enrollMode(대면/원격) — 의미 분리(중복 제거). Plan FR-43 ADMIN_QR_INPERSON = channel=ADMIN_QR ∧ mode=IN_PERSON
  enrollChannel String   @default("ADMIN_QR") // SELF / ADMIN_QR
  enrollMode    String   @default("REMOTE")   // IN_PERSON / REMOTE (FR-43, 고보증=IN_PERSON 필수)
  enrolledBy    String                        // 검증 관리자(userId, 비관계 참조)
  fcmToken      String?                       // 스태프 푸시(FR-42/49)
  fcmTokenAt    DateTime?
  verifiedAt    DateTime @default(now())
  replacedById  String?
  revokedAt     DateTime?
  revokeReason  String?
  @@index([userId])
}
// ⚠️ User 모델에 역방향 추가 필요:
//   webauthnCredentials WebAuthnCredential[]
//   staffDevices        StaffDevice[] @relation("UserStaffDevices")

model BreakGlassAccess {                     // FR-51
  id          String   @id @default(uuid())
  userId      String                         // 접근 주체(최소 식별)
  reason      String                          // 사유(필수)
  approvers   String[]                        // 2인 승인/책임자(복수, D-8)
  approvalKind String                         // TWO_PERSON / SUPERVISOR_CODE
  scope       String                          // 부여 범위(좁게)
  grantedAt   DateTime @default(now())
  expiresAt   DateTime                        // 짧은 만료
  reviewedBy  String?                         // 사후 검토자
  reviewedAt  DateTime?
  @@index([userId])
}

model StaffCall {                            // FR-38~40,48,50 (영속·감사·미응답추적)
  id           String   @id @default(uuid())
  type         String                         // STAFF_CALL / BROADCAST / CODE
  severity     String   @default("NORMAL")    // NORMAL / URGENT / CRITICAL
  senderId     String
  targetKind   String                         // USER / ROLE / DEPARTMENT / ALL
  targetRef    String?                         // userId/role/deptId (ALL이면 null)
  message      String?                         // 환자참조는 ID/링크만(FR-50)
  patientRef   String?                         // 환자 ID(평문정보 금지)
  status       String   @default("OPEN")      // OPEN / ACKED / ESCALATED / CANCELLED / CLOSED
  location     String?                         // Code 위치(FR-40)
  cancelledBy  String?
  escalatedAt  DateTime?
  createdAt    DateTime @default(now())
  acks         StaffCallAck[]
  @@index([senderId])
  @@index([targetKind, targetRef])
  @@index([status])
}
model StaffCallAck {
  id        String   @id @default(uuid())
  callId    String
  call      StaffCall @relation(fields: [callId], references: [id])
  userId    String
  response  String                            // ACCEPT / CONFIRM / CALLBACK / ACK
  ackedAt   DateTime @default(now())
  @@unique([callId, userId])
}
```
- **AuditLog 확장(FR-29/50)**: 기존 AuditLog의 `metadata`(JSON)에 표준 키 적재 — `authMethod`(passkey/password/step-up/break-glass)·`credentialId`·`aaguid`·`ssoAudience`·`jti`·`callId`·`severity`·`result`·`ip`·`ua`·`sessionId`. 신규 컬럼 없이 JSON 메타 표준화. EMR/JCI 매핑표는 부록으로(P6).
- **SmartClient 확장(재사용)**: 하위시스템(ohif/jitsi) 클라이언트 등록에 기존 `SmartClient`(clientId/secret/redirectUris/scope) 사용. **`kind` 컬럼('smart'|'internal_sso') 추가 확정** — introspect에서 audience/종류 분기에 필요(P3 선행).
- **User 관계**: `User.webauthnCredentials WebAuthnCredential[]`, `User.staffDevices StaffDevice[]` 역방향 추가.

### 3.2 Redis 키 구조 (단기 상태)
```
webauthn:reg:{userId}      = {challenge, rpId, ts}            TTL 5m  (FR-28)
webauthn:auth:{sessionId}  = {challenge, rpId, ts}            TTL 5m
enroll:{sessionId}         = {staffUserId, code, adminId, enrollMode, attempts, status} TTL 5m (FR-30~32)
sso:jti:{jti}              = consumed flag                    TTL 60s (FR-06)
sso:redeem:{code}          = {token, audience}                TTL 60s (FR-08)
sso:children:{sessionId}   = Set<jti>  자식세션 추적           (FR-18 SLO — 로그아웃 시 전량 revoke)
stepup:jti:{jti}           = consumed flag                    TTL 5m  (FR-09)
sso:revoked:{jti}          = revocation                       (FR-06)
sse:group:{role|dept}      = Set<sessionId>  서버결정 그룹구독  (FR-41/47, 클라이언트 자칭 금지)
session:{sid}.lastActiveAt = ts  (FR-19 idle timeout — 요청마다 갱신, 만료 검사)
```
- **FR-19 idle timeout**: 기존 `auth.service` dead code(`sessionInactiveTimeout`) 활성화 — 모든 인증요청에서 `session:{sid}` 의 `lastActiveAt` 갱신, 임상단말 30m·행정 60m(D-6) 초과 시 세션 무효. JwtAuthGuard에 검사 추가.

### 3.3 관계도
```
User 1──N WebAuthnCredential N──1 StaffDevice
User 1──N StaffDevice (검증 관리자=enrolledBy→User)
User 1──N BreakGlassAccess
SmartClient(audience=ohif/jitsi) ── sso-idp 토큰
```

---

## 4. API 명세

### 4.1 엔드포인트 목록
| Method | Path | 설명 | 인증 | FR |
|--------|------|------|------|----|
| POST | /api/v1/auth/passkey/register/options | 등록 챌린지 발급 | 세션/등록세션 | 02 |
| POST | /api/v1/auth/passkey/register/verify | 등록 검증·저장 | 세션/등록세션 | 02 |
| POST | /api/v1/auth/passkey/login/options | 로그인 챌린지(식별자/discoverable) | 공개 | 03,25 |
| POST | /api/v1/auth/passkey/login/verify | assertion 검증→토큰 발급 | 공개 | 03 |
| GET | /api/v1/auth/passkey | 내 패스키 목록 | 세션 | 12 |
| PATCH/DELETE | /api/v1/auth/passkey/:id | 이름변경/삭제(최소1개 유지) | 세션 | 12,52 |
| POST | /api/v1/admin/staff-devices/enroll/start | 등록세션 생성(QR+코드) | ADMIN | 30,43 |
| GET | /api/v1/admin/staff-devices/enroll/:id/stream | 등록 상태 SSE | ADMIN | 30 |
| POST | /api/v1/admin/staff-devices/enroll/:id/confirm | 관리자 명시 승인(이중확인) | ADMIN | 30 |
| POST | /api/v1/staff-devices/enroll/:id/claim | 의료진 코드입력→패스키등록 | 등록세션 | 30,32 |
| GET | /api/v1/admin/staff-devices | 디바이스 목록 | ADMIN | 31 |
| POST | /api/v1/admin/staff-devices/:id/revoke | 폐기(패스키·FCM·세션 연계) | ADMIN | 31,23 |
| POST | /api/v1/sso/internal/grant | SSO 토큰 발급(audience) | 세션 | 06 |
| POST | /api/v1/sso/internal/redeem | redemption code→토큰 교환(백채널) | 클라이언트 | 08 |
| POST | /api/v1/sso/internal/introspect | 토큰 검증(RFC7662 유사) | **client_credentials(SmartClient) — pacs-proxy/HIS 프록시가 호출**, OHIF 직접 아님 | 07 |
| POST | /api/v1/admin/staff/:userId/passkey/reset | 관리자 패스키 강제 재설정(전량 폐기+재등록 강제) | ADMIN | 13 |
| GET/PUT | /api/v1/admin/auth-policy | 정책 설정(max devices·idle·attestation·synced) | ADMIN | 13 |
| POST | /api/v1/auth/recovery/request | 복구 요청(패스키 전부 분실) — 사번/신분 식별 | 공개(제한) | 16,24 |
| POST | /api/v1/admin/recovery/:id/approve | 관리자+부서장 다중 승인(2차 step-up) | ADMIN/책임자 | 24 |
| POST | /api/v1/auth/recovery/:id/complete | 승인 후 비밀번호 폴백 1회 + 신규 패스키 재등록 강제 | 복구토큰 | 16,24 |
| POST | /api/v1/auth/logout (확장) | SLO — 자식세션 무효화 | 세션 | 18 |
| POST | /api/v1/auth/step-up/options | step-up 챌린지 | 세션 | 09 |
| POST | /api/v1/auth/step-up/verify | assertion→step-up 토큰 | 세션 | 09 |
| POST | /api/v1/staff-calls | 호출 발신(개인/역할/부서) | 세션+RBAC | 38,44 |
| POST | /api/v1/staff-calls/:id/respond | 수락/확인/콜백 | 세션 | 38 |
| POST | /api/v1/staff-calls/broadcast | 긴급 브로드캐스트 | RBAC(BROADCAST) | 39,44 |
| POST | /api/v1/staff-calls/code | Code 호출(코드블루) | RBAC(CODE_INITIATE) | 40,48 |
| POST | /api/v1/staff-calls/:id/ack | 수신확인 | 세션 | 39,48 |
| POST | /api/v1/staff-calls/:id/cancel | Code 취소/철회 | 발신자/책임자 | 46 |
| POST | /api/v1/devices/fcm-token | FCM 토큰 등록(3자 정합) | 세션+StaffDevice | 42,49 |
| POST | /api/v1/auth/break-glass | 비상 접근 요청 | 최소식별+승인 | 51 |
| GET | /api/v1/admin/break-glass | 비상 접근 감사/검토 | ADMIN/보안 | 51 |

### 4.2 상세 예시
#### `POST /api/v1/auth/passkey/login/verify`
```jsonc
// Request
{ "sessionId": "uuid", "assertion": { /* PublicKeyCredential JSON */ } }
// Response 200 — 기존 auth 응답과 동일 형식
{ "data": { "accessToken": "...", "user": { "id","role","department" } }, "meta": {} }
// refreshToken은 httpOnly 쿠키(기존 동일). 실패: 401 { error:{ code:"PASSKEY_INVALID" } }
```
#### `POST /api/v1/sso/internal/grant`
```jsonc
// Request  { "audience": "ohif" }
// Response { "data": { "redemptionCode": "opaque" }, "meta": {} }  // 실토큰은 redeem로 백채널 교환(FR-08)
```
#### `POST /api/v1/auth/step-up/verify`
```jsonc
// Request { "assertion": {...}, "action":"PRESCRIPTION_SIGN", "resourceId":"rx_123", "bodyHash":"sha256.." }
// Response { "data": { "stepUpToken": "jwt(action,resourceId,bodyHash,jti,exp5m)" } }
```

---

## 5. 시퀀스 (핵심 흐름)

### 5.1 패스워드리스 로그인 (FR-03/04)
```
FE: login/options(식별자 또는 conditional UI)
API: challenge 생성 → Redis(webauthn:auth) → allowCredentials 반환
FE: navigator.credentials.get() → 생체 → assertion
API: login/verify → challenge 1회소비 → 공개키로 서명검증 → signCount 검사(FR-21)
     → auth.service.issueTokens()(JWT8h+refresh7d+세션) → 응답
FE: /staff 런처
```

### 5.2 관리자 검증 디바이스 등록 (FR-30/32/43)
```
ADMIN: enroll/start(staffUserId, enrollMode) → {sessionId, QR(URL+sessionId), code 6자리} (Redis 5m, userId 사전고정)
ADMIN 화면: SSE 구독, 카운트다운
의료진: QR스캔 → claim(code) → (code 일치, attempts<5) → 본인확인:
         · IN_PERSON(고보증 역할 필수): 관리자 육안 신분·사번 대조
         · REMOTE(일반 역할): 인사DB 매칭(사번+생년월일) + 본인 휴대폰 OTP 1회
       → passkey register/options → 생체 → register/verify → WebAuthnCredential+StaffDevice
ADMIN: enroll/:id/confirm (이중확인) → 등록 확정 → 양쪽 SSE "완료" → 본인 통지 → AuditLog
```

### 5.3 SSO 진입 (FR-06~08, 부록 B 재사용) — audience별 토큰 전달 분기
```
공통: 런처 grant(audience) → sso-idp(smart-auth 재사용) 단기토큰(jti,세션바인딩, sso:children에 등록)

[경로 A — OHIF/PACS] (무수정 제약, D-9)
  grant가 ≤60s·1회용 토큰을 직접 발급 → OHIF URL=getViewerUrl()+?token=...
  nginx Authorization passthrough → pacs-proxy/HIS 프록시가 introspect 검증 → 단기 접근
  보상통제: 토큰 ≤60s·1회용, Referrer-Policy:no-referrer, nginx 로그 마스킹
[경로 B — Jitsi/Clinic 등 제어가능 클라이언트] (FR-08 정석)
  grant → redemptionCode(URL) → 하위시스템이 /sso/internal/redeem 백채널 교환 → 실토큰
  Jitsi(FR-17): 토큰 claim에 roomId·role(moderator/참가자)·exp 바인딩 → 임의 룸 재사용 차단

SLO(FR-18): 로그아웃 시 sso:children:{sessionId} 전량 순회 → sso:revoked:{jti} 등록 + 자식세션 만료
```

### 5.4 Step-up 전자서명 (FR-09/10, G-2 법무 대기)
```
처방 서명 클릭 → step-up/options → 생체 → step-up/verify(action,resourceId,bodyHash)
→ stepUpToken(jti, 5m, 바인딩) → 서명 API 가드가 토큰+bodyHash 일치 검증
→ 기존 blockchain-sign 호출(법적 전자서명) → AuditLog에 assertion↔BlockchainCertificate 연결
```

### 5.5 Code 블루 전달보장 (FR-48)
```
code 발신(RBAC) → 대상=근무∩활성세션(FR-47) → Notification + SSE + FCM 동시
→ 수신확인 수집(call:ack) → 미응답 타임아웃 → 에스컬레이션(상위/추가) → 실패 시 발신자 즉시 표시
재연결 시 미수신 큐 재전송(시퀀스)
```

### 5.6 Break-glass (FR-51)
```
인증 불가/응급 → break-glass 요청(사유 필수+최소식별) → 2인승인/책임자코드
→ 시간제한·좁은범위 임시 접근 + 실시간 보안팀 알림 + 본인/관리자 통지
→ BreakGlassAccess 기록 → 사후 의무 검토(reviewedBy)
```

### 5.7 계정 복구 (FR-16/24) — 패스키 전부 분실
```
recovery/request(사번·신분 식별) → 복구건 생성(상태 PENDING)
→ admin/recovery/:id/approve: 관리자 승인 + 부서장 2차 + (2차 step-up) → 상태 APPROVED
   본인에게 복구 진행 통지(이상 시 차단 가능)
→ recovery/:id/complete: 비밀번호 폴백 1회 허용 → 즉시 신규 패스키 재등록 강제
   → 기존 분실 패스키 전량 REVOKED, 세션 초기화 → AuditLog(강조)
※ Break-glass(응급 진료접근)와 별개: 복구는 자격증명 재발급, Break-glass는 임시 진료접근
```

---

## 6. 에러 처리
| 코드 | 상황 | 처리 |
|------|------|------|
| 401 PASSKEY_INVALID | assertion 검증 실패 | 비밀번호 폴백 안내(U2) |
| 401 NO_CREDENTIAL | 등록 패스키 없음 | "기기 등록 요청" 안내 |
| 409 SIGN_COUNT_REGRESS | signCount 역행(복제 의심) | credential 잠금+재확인(FR-21) |
| 400 ENROLL_CODE_INVALID | 인증번호 불일치 | 남은 시도 표시, 5회 시 세션폐기 |
| 410 ENROLL_EXPIRED | 등록세션 만료 | 관리자 재발급 |
| 401 SSO_TOKEN_INVALID | jti 소비/만료/audience 불일치 | 재진입 |
| 403 STEPUP_REQUIRED | step-up 토큰 없음/불일치 | step-up 모달 트리거 |
| 403 BROADCAST_FORBIDDEN | 발신 권한 없음 | 권한 안내 |
- 응답 형식: `{ error: { code, message, details }, meta }` (프로젝트 표준).

---

## 7. 보안 설계 체크리스트
- [ ] 생체 원본 비전송 — 공개키만 저장, RP ID 환경변수 고정(FR-22)
- [ ] UV required, attestation 정책(고보증 역할 수집, FR-20), discoverable 정책(D-3)
- [ ] 챌린지 1회소비·origin·RP ID hash 바인딩(FR-28), signCount 검사(FR-21)
- [ ] SSO 토큰 독립키·jti·세션바인딩·audience exact·≤60s(FR-06), URL토큰은 PACS 한정+마스킹(FR-08,D-9)
- [ ] step-up 토큰 action·resourceId·bodyHash·jti 바인딩(FR-09)
- [ ] 등록: userId 사전고정·5회 제한·이중확인·등록통지(FR-30/32), 대면/원격 등급(FR-43)
- [ ] 호출/Code 발신 RBAC·rate-limit·취소감사(FR-44~46), 서버측 그룹구독(FR-47)
- [ ] FCM 페이로드 비식별·data-only·토큰 3자정합·폐기연계(FR-49/23)
- [ ] 수명주기 폐기 훅(패스키·StaffDevice·FCM·세션, FR-23), Clinic SSO 부채정리(FR-27)
- [ ] Break-glass 강조감사·실시간알림·사후검토(FR-51)
- [ ] 감사 표준화(인증+호출, FR-29/50), 보존정책(FR-53), PIA

---

## 8. 테스트 계획
| 유형 | 대상 | 도구 |
|------|------|------|
| 단위 | ceremony·SSO grant/introspect·step-up·등록세션·break-glass | Jest |
| 통합 | 엔드포인트(passkey·sso-idp·staff-calls) | Supertest |
| 로그기반 | 인증 흐름 검증 | zero-script-qa |
| 브라우저 | Safari/Chrome/Edge 플랫폼 인증기 | 매트릭스 수동 |
| 장애주입 | SSE 끊김·FCM 실패→Code 전달, 인증장애→Break-glass | 시나리오 |

핵심 케이스:
- [ ] 패스키 로그인 성공 → /staff → SSO 1건 진입
- [ ] 패스키 실패 → 비밀번호 폴백 100%
- [ ] 등록 코드 5회 오입력 → 세션폐기 / 만료 → 재발급
- [ ] step-up 토큰 타 행위 재사용 거부(바인딩)
- [ ] Code 블루 SSE 끊김 시 FCM 도달 + 에스컬레이션
- [ ] 퇴사 처리 → 패스키·StaffDevice·FCM·세션 일괄 폐기

---

## 9. Clean Architecture 레이어 배치 (NestJS)
| 컴포넌트 | 레이어 | 위치 |
|----------|--------|------|
| passkey/device-enroll/sso-idp/step-up/break-glass Controller | Presentation | `apps/api/src/modules/auth/*/` |
| *Service (ceremony·grant·verify·enroll) | Application | 동 모듈 service |
| WebAuthnCredential·StaffDevice·BreakGlass 엔티티/타입 | Domain | Prisma schema, shared types |
| Prisma·Redis·@simplewebauthn/server·smart-auth·pacs-proxy·FCM | Infrastructure | `lib/`, 기존 모듈 |
| /staff·/staff/login·/admin/staff-devices | Presentation(FE) | `apps/web/src/app/staff/`, `admin/` |
| webauthn 클라이언트·notification-store | Infrastructure(FE) | `lib/crypto/webauthn.ts`, `stores/` |

- 의존 규칙: 하위시스템 SSO는 sso-idp(Application)가 smart-auth(Infra 재사용) 호출. Presentation은 service만 의존.

---

## 10. 컨벤션
- 파일 kebab-case, 컴포넌트 PascalCase, 함수 camelCase, DB snake_case(Prisma map).
- API `/api/v1/`, 응답 `{data,meta}`/`{error,meta}`.
- 환경변수: `AUTH_SSO_SIGNING_KEY`(SSO 독립키), `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `ENROLL_QR_BASE_URL`(QR 베이스URL 고정, FR-32), `FCM_*`(기존).
- BE 수정 후 `nest build` 필수, 브라우저 `NEXT_PUBLIC_API_URL=''` 상대경로.

### 10.5 적용 결정값 (Plan §10 D-1~D-9 — 설계 확정값, 미합의 시 기본값)
| # | 항목 | 설계 확정값 |
|---|------|------------|
| D-1 | SSO 대상 | OHIF(경로A)·Jitsi·Clinic(경로B) 전부 |
| D-2 | 도입 방식 | 부서 opt-in 점진 (비밀번호 로그인 보존) |
| D-3 | residentKey | `preferred` (식별자 입력 폴백 유지) |
| D-4 | synced passkey | 역할별 분기 — 고보증 역할 device-bound 선호(backedUp 검사) |
| D-5 | 최대 패스키/인 | **3** (register options에서 초과 차단, FR-52) |
| D-6 | idle timeout | 임상 30m / 행정 60m (FR-19) |
| D-7 | attestation | 고보증 역할만 수집(AAGUID 허용목록), 그 외 none |
| D-8 | Break-glass 승인 | 2인 승인 또는 책임자 코드(`approvalKind`) |
| D-9 | OHIF 토큰 | URL `?token=` ≤60s·1회용·로그마스킹(경로A) |
> 위 값은 조직 합의로 변경 가능. 변경 시 본 표만 갱신하면 구현 반영.

---

## 10.6 구현 정합 노트 (실제 구현이 설계와 다른 부분 — 의도된 단순화)
> 갭검증(Match 90%) 반영. 아래는 구현이 더 단순/통합된 방향으로, 설계를 구현에 맞춰 기록.
| 항목 | 설계 | 실제 구현 | 사유 |
|------|------|----------|------|
| idle timeout 키 | `session:{sid}.lastActiveAt`(세션 단위) | `idle:{userId}`(사용자 단위, 역할별·fail-open) | access JWT에 sid 미포함 → 사용자 단위로 단순화(다중세션 개별만료 미지원) |
| 호출/알림 모듈 위치 | `notification/` 확장 | 독립 모듈 `modules/staff-call/`(NotificationService 재사용) | 관심사 분리 |
| 호출 수신확인 | `/staff-calls/:id/ack` 별도 | `/staff-calls/:id/respond`로 통합(response=ACK 포함) | 엔드포인트 단순화 |
| 디바이스 등록 | `claim` 1단계 | `claim`(옵션발급)+`register`(검증) 2단계 | 보안상 더 안전 |
| Break-glass 모델 | `BreakGlassAccess` | `AuthEmergencyAccess`(`auth_emergency_access`) | 기존 `BreakTheGlassAccess`(환자기록BTG)와 명칭 충돌 회피 |
| 복구 모델 | (명시 없음) | `AccountRecovery` 신설(FR-16/24) | 복구 상태머신 영속 |
| 정책/폐기 | auth-policy GET/PUT | `lifecycle` 모듈(정책 Redis·패스키재설정·deprovision 폐기훅) | FR-13/23 통합 |
| API 경로 | break-glass `/auth/break-glass` 등 | `/admin/break-glass/grant`·`/admin/recovery/*`·`/admin/staff/:id/{passkey/reset,deprovision}`·`/devices/fcm-token`·`/staff-calls/:id/escalate` | 관리자 주도·실제 라우트 |

## 11. 구현 가이드

### 11.1 파일 구조(신규)
```
apps/api/src/modules/auth/
├── passkey/ (controller, service, dto)
├── device-enroll/ (controller, service, enroll-session.ts)
├── sso-idp/ (controller, service ← smart-auth 확장)
├── step-up/ (controller, service, step-up.guard.ts)
└── break-glass/ (controller, service)
apps/api/src/modules/notification/ (확장: staff-call.service, group-target.ts, escalation.ts)
apps/web/src/app/staff/ (login/, page.tsx 런처)
apps/web/src/app/(main)/admin/staff-devices/
packages/shared/ (types: passkey, staff-device, sso, staff-call)
```

### 11.2 구현 순서 (Plan Phase 매핑)
1. [ ] **P1** — Prisma(WebAuthnCredential·StaffDevice) + 마이그레이션 + passkey ceremony(@simplewebauthn) + 정책(FR-01~03,20~22,28)
2. [ ] **P2** — device-enroll(QR+코드·SSE·신원증명 등급) + 교체/해제 + 패스워드리스 First UI/온보딩(FR-04~05,30~32,43)
3. [ ] **P3** — sso-idp(smart-auth 확장·introspect·jti·revocation) + pacs-proxy 링크통일 + Break-glass(FR-06~08,17,18,51)
4. [ ] **P4** — step-up + 고위험 가드 + blockchain-sign 연결(FR-09~10, G-2 법무 대기)
5. [ ] **P5** — /staff 런처(중요차트 링크) + 패스키 관리 + 호출/긴급/Code(RBAC·전달보장·FCM비식별·타게팅)(FR-11~13,38~50)
6. [ ] **P6** — 복구·정책·감사(호출 포함)·보존·QA·보안검토·PIA(FR-15,16,24,29,50,53)

### 11.3 의존 패키지
- `@simplewebauthn/server`(BE), `@simplewebauthn/browser`(FE), `firebase-admin`(기존, 스태프 FCM 확장)

---

## 버전 이력
| 버전 | 날짜 | 변경 | 작성자 |
|------|------|------|--------|
| 1.0 | 2026-06-05 | Plan v1.7 기반 최초 설계 — 모듈·모델·API·시퀀스·보안·레이어·구현순서 | Claude (PDCA Design) |
| 1.1 | 2026-06-05 | **design-validator 검증(82→) 반영** — StaffCall/StaffCallAck 모델 신설, 복구 플로우(API+§5.7), 관리자 정책/패스키 재설정 API(FR-13), OHIF 토큰 경로A/B 분기(모순 해소), enroll 필드 정규화+relation, BreakGlass 다중승인, Redis 키(SLO 자식세션·그룹구독·idle), AuditLog 확장, D-1~D-9 확정값(§10.5) | Claude + design-validator |
| 1.2 | 2026-06-05 | **재검증(91/100) 반영** — StaffDevice.user 양방향 relation+relation name, WebAuthnCredential LOCKED 상태(FR-21), StaffCall @@index 문법 정정, REMOTE 본인확인 정책(인사DB+OTP) 구체화, SmartClient.kind 확정, ENROLL_QR_BASE_URL 환경변수, Plan FR 카운트 정정 | Claude + design-validator |
