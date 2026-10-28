# 병원 내부포털 — 웹 SSO + 패스워드리스(생체인증) 기획서 v1.7

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/src/app.module.ts:220 · apps/api/src/app.module.ts:218 · apps/api/prisma/migrations/00000000000001_baseline/migration.sql:5436 · 잔여: G-1 PACS SSO 실배포 PoC(사람); G-2 생체 step-up 전자서명 효력 법무 자문(사람)

> **요약**: 의료진·행정직 등 병원 내부 관계자가 **브라우저로 한 번(패스키/생체인증)** 로그인하면, HIS 내부의 모든 하위 시스템을 **비밀번호 없이** 이용할 수 있는 내부 통합 인증 포털(Internal IdP).
>
> **프로젝트**: Hospital RUN (한국형 대학병원급 HIS)
> **버전**: v3.7.0 기반
> **작성일**: 2026-06-05
> **우선순위**: P0 (전사 인증 인프라 — 보안/운영성/EMR인증 직결)
> **상태**: Review (기획 성숙 — 설계 착수 대기, G-1/G-2 게이트 선행)
> **규모**: FR 53개(deferred 1 제외 52 활성) · 신규모델 2 · 신규모듈 4 · 6 Phase · 사전게이트 2(G-1 PACS PoC·G-2 법무)
> **전제 자산**: [clinic-integration](clinic-integration.plan.md)(아웃바운드 SSO), [certification-marks](certification-marks.plan.md)(EMR/JCI 인증 기준)

---

## 1. 기획 배경

### 1.1 현재 방식의 한계
- **직원 로그인 = 이메일 + 비밀번호** 단일 방식 (`apps/web/src/app/(auth)/login/page.tsx`).
- 비밀번호 정책은 강함(12자·복잡도·90일 만료, `auth.service.ts`)이나, **현장 의료진에게는 마찰이 큼** — 진료 중 빈번한 재로그인, 90일마다 비밀번호 변경, 공용 단말 공유 로그인.
- HIS는 단일 로그인 후에도 **외부/분리 시스템**(OpenPACS Orthanc/OHIF, Jitsi 화상, Clinic)으로 이동 시 별도 인증 또는 토큰 수동 전달이 필요.
- **WebAuthn 클라이언트 코드는 이미 존재**(`apps/web/src/lib/crypto/webauthn.ts`)하나 "본인확인 게이트" 용도로만 쓰이고, **백엔드 credential 저장/검증이 없어** 실제 로그인 수단으로는 미사용.
- 의료법 §24-2 전자서명·처방 서명 등 **고위험 행위마다** 비밀번호 재입력으로 보호 → 마찰 + 어깨너머 유출 위험.

### 1.2 요구사항 (사용자 요지)
> "의료진과 행정직 등 병원 내부 관계자들의 내부 포털인데, 웹기반 SSO와 패스워드리스로 **한번 브라우저로 로그인**하고, **생체정보 등을 통해서**, HIS 내부의 시스템들을 **패스워드리스로 진행**할 수 있게 하는 병원내부포털."

분해:
1. **패스워드리스** — 비밀번호 대신 패스키(WebAuthn/FIDO2 플랫폼 인증기 = Touch ID / Face ID / Windows Hello / 지문)로 로그인.
2. **웹기반 SSO** — 한 번 로그인하면 HIS 내부의 여러 시스템(워크스테이션/CRM/검진/PACS 뷰어/화상진료 등)에 **재인증 없이** 진입.
3. **내부 포털** — 직원이 자신이 접근 가능한 시스템·업무를 한 화면에서 보고 진입하는 **런처(Launcher) + 인증 허브**.

### 1.3 목표 (한 줄)
```
직원 = 출근 시 단말에서 지문/얼굴 한 번 → HIS와 모든 하위 시스템이 "내 세션"으로 열림.
고위험 행위(서명·처방)만 그 자리에서 생체 재확인(step-up). 비밀번호는 등록·복구용 폴백으로만 존재.
```

### 1.4 관련 표준 / 컴플라이언스
- **FIDO2 / WebAuthn (W3C)** — 피싱 내성 패스워드리스 표준.
- **EMR 인증 / JCI** — 인증·접근통제·감사로그 요구. 기존 AuditLog 재사용·확장.
- **의료법 §24-2** — 전자의무기록 전자서명 (step-up 생체인증으로 본인확인 증빙 강화).
- **개인정보보호법** — 생체정보는 **단말 내 보안영역(Secure Enclave/TPM)에만 저장**, 서버는 **공개키만** 보관(원본 생체 미전송) → 법적 리스크 최소화.

---

## 2. 재사용 vs 신규

### 2.1 재사용 (기존 자산)
| 자산 | 위치 | 활용 |
|------|------|------|
| AuthService (JWT 8h + refresh 7d, Redis 세션, 토큰탈취감지, 동시세션 3) | `apps/api/.../auth/auth.service.ts` | 세션/토큰 발급 코어 그대로 사용, 패스키 검증 후 동일 토큰 발급 |
| WebAuthn 클라이언트 (`registerBiometric`/`authenticateBiometric`) | `apps/web/src/lib/crypto/webauthn.ts` | 등록/인증 ceremony 클라이언트로 재사용·확장 |
| RBAC (UserRole 7종, Permission 61, RolesGuard) | `apps/api/.../auth/rbac/`, `guards/` | SSO 후 권한·런처 노출 제어 그대로 사용 |
| Staff / User 모델 (category, department, employeeNumber) | `prisma/schema.prisma` | 직종별 런처/정책 분기 |
| Clinic SSO 패턴 (아웃바운드 토큰 검증) | `clinic-integration/sso.controller.ts` | **방향 반대(HIS=IdP)** 로 응용 |
| AuditLog | 기존 테이블 | 인증·SSO·step-up 이벤트 감사 |
| Brute force 방어 / Throttle | `auth.service.ts` | 패스키 챌린지 남용 방어에 확장 |
| **동의서 서명기기 QR+인증코드 페어링 패턴** | [consent-signing-device](consent-signing-device.plan.md) (QR 6자리 인증코드·자동/수동 승인·SSE 실시간) | **관리자 검증 디바이스 등록 루틴에 그대로 재사용** |
| **SMART on FHIR OAuth2** (`modules/smart-auth`·`smart-client`) | `/oauth2/authorize`·`/oauth2/token`·SmartClient(client_id/secret·redirectUris·scope)·JWT(token_type='smart',1h)·scope 가드 | **내부 IdP SSO(FR-06/07) 기반으로 재사용** (✅사전조사). 추가 필요: introspection·PKCE·jti/revocation·internal token_type (부록 B) |
| **PACS SSO 인프라** (`modules/pacs-proxy`·nginx·OHIF) | pacs-proxy가 HIS JWT+`X-HIS-User-*` 전달, nginx Authorization passthrough, OHIF가 `?token=`→Bearer 변환, `PACS_SSO_ENABLED=true` | **G-1 거의 구현됨**(✅사전조사). FR-07/08 신규구축 최소화 — 통일·보안보강만 (부록 B) |
| **블록체인 서명 + 의료진 서명이미지** | session 2026-06-05(동의서서명기기) `BlockchainCertificate`·`signatureImage` | step-up→전자서명 결합(FR-10)·인증서 UX(FR-35)의 법적 서명 메커니즘 |
| **Notification 시스템 + SSE 스트림** | `modules/notification/` (service·`@Sse('stream')` `/api/v1/notifications/stream`·FCM) | **호출·긴급알림의 전송 백본으로 재사용** (그룹 타게팅만 확장) |
| **알림 UI(벨/패널/위급값 배너)** | `notification-store.ts`(connectSSE)·`NotificationPanel.tsx`·`CriticalValueAlertBanner.tsx` | 호출·긴급알림 수신 UI로 재사용 (type enum만 추가) |

### 2.2 신규
| # | 항목 | 규모 | 비고 |
|---|------|:----:|------|
| N-1 | **WebAuthnCredential** 모델 (userId, credentialId, publicKey, counter, transports, deviceName, aaguid, createdAt, lastUsedAt) | 소 | 서버는 공개키만 저장 |
| N-2 | **WebAuthn 백엔드** — 등록/인증 챌린지 발급·검증 (`@simplewebauthn/server`) | 중 | 핵심 |
| N-3 | **패스워드리스 First 로그인 플로우** (이메일/사번 → 패스키 → 토큰) + 비밀번호 폴백 | 중 | |
| N-4 | **내부 IdP SSO** — HIS 세션 → 하위 시스템 단기 SSO 토큰 발급/검증 | 중 | OpenPACS·OHIF·Jitsi 대상 |
| N-5 | **Step-up(재인증)** — 고위험 행위 시 생체 재확인 + 단기 step-up 토큰 | 중 | 처방/전자서명 |
| N-6 | **내부 포털(런처) 페이지** — 역할별 시스템 타일 + 인증 상태 + 등록 단말 관리 | 중 | `/staff` (신규) |
| N-7 | **패스키 관리 UI** — 등록/이름변경/삭제, 분실 시 관리자 재설정 | 소 | 직원 마이페이지 + 관리자 |
| ~~N-8~~ | ~~신뢰 단말 + 공용 단말 모드~~ → **별도 사이클로 분리** | - | §3.2 참조 |
| **N-9** | **관리자 검증 디바이스 등록 루틴** — 관리자 화면 QR + 인증번호 발급 → 의료진 디바이스 매칭 → 패스키 등록 바인딩 (consent-signing-device 패턴 재사용) | 중 | §5.6, FR-30 |
| **N-10** | **디바이스 교체/해제** — 분실·기변 시 기존 디바이스 폐기 + 신규 재등록(동일 루틴) | 소 | FR-31 |
| **N-11** | **StaffDevice(검증 디바이스) 모델** + 등록 세션(Redis) | 소 | §5.4 |
| **N-12** | **직원 호출(Staff Call/Paging)** — 개인/역할/부서 대상 호출·응답(수락/확인). Notification+SSE 재사용 | 중 | §5.8, FR-38 |
| **N-13** | **긴급 알림 브로드캐스트 + Code 호출(코드블루 등)** — 그룹 강제 배너·수신확인·미응답 에스컬레이션 | 중 | §5.8, FR-39~40 |
| **N-14** | **SSE 그룹 타게팅 확장** + **스태프 FCM 푸시**(StaffDevice 재사용) | 소 | FR-41~42 |

---

## 3. 범위 (Scope)

### 3.1 In Scope
- [ ] WebAuthn(FIDO2) 백엔드 — 등록/로그인 ceremony, credential 저장(공개키)
- [ ] 패스워드리스 First 로그인 (패스키 우선, 비밀번호 폴백)
- [ ] **관리자 검증 디바이스 등록 루틴** (관리자 QR + 인증번호 매칭 → 의료진 디바이스 등록)
- [ ] **디바이스 교체/해제** (기변·분실 시 재등록)
- [ ] 패스키 **온보딩**: 관리자 검증 등록(권장) 또는 비밀번호 1회 로그인 후 등록
- [ ] HIS 내부 IdP: 하위 시스템용 단기 SSO 토큰 발급/검증 엔드포인트
- [ ] OpenPACS(OHIF/Orthanc) **링크 진입 시 SSO 토큰 전파** (※PACS 서버 자체는 수정 금지 — 토큰 전달/링크 방식만)
- [ ] Jitsi 화상진료 SSO 연계 (기존 self-hosted)
- [ ] Step-up 재인증 (처방 서명·전자서명·민감정보 열람)
- [ ] 내부 포털 런처 `/staff` — 역할별 시스템 타일 + 인증/세션 상태
- [ ] **직원 호출(Staff Call/Paging)** + **긴급 알림 브로드캐스트** + **Code 호출**(기존 Notification/SSE 재사용)
- [ ] 중요차트 — **링크/집약 수준만**(심화통합 제외)
- [ ] 패스키 관리 UI (직원 + 관리자)
- [ ] 감사로그 확장 (등록/로그인/SSO/step-up/실패)

### 3.2 Out of Scope (이번 사이클 제외)
- 외부 IdP 연동(Azure AD / Okta OIDC) — **2차 로드맵** (인터페이스만 확장 가능하게 설계)
- SAML 지원 — 미정
- 모바일 앱(Expo) **패스키 로그인** — 별도 사이클 (웹 우선). ※ 단, 모바일은 **호출·긴급알림 FCM 수신은 대상**(크로스플랫폼) — 인증과 분리
- 하드웨어 보안키(YubiKey 등 cross-platform) — 설계는 허용하되 검증/배포는 2차
- **신뢰 단말 + 공용 단말 모드(병동 공용 PC 빠른 전환·짧은 비활성 타임아웃)** — 사용자 지시에 따라 **별도 사이클로 분리 지정**(이번 범위 제외). 향후 `staff-shared-terminal` 등 별도 기획으로 진행.
- OpenPACS 서버 내부 인증 로직 변경 (CLAUDE.md 금지 규칙 준수)
- **PACS 측 네이티브 토큰 검증** — 무수정 제약상 불가. HIS 리버스 프록시 패턴으로만 한정(§5.2, G-1).
- **비밀번호 폴백의 장기 존치** — 폴백 자체가 피싱 가능 채널. 등록·복구용으로만 두고 사용 조건·빈도를 **단계적으로 축소**(정책 로드맵).

---

## 4. 기능 요구사항 (FR)

> **FR 카테고리 인덱스** (총 53개 + FR-11a, FR-14 deferred 제외 활성 52개). 상세는 각 표/섹션 참조.

| 카테고리 | FR | 위치 | Phase |
|----------|-----|------|:----:|
| 🔑 WebAuthn 코어 | FR-01~03, 20~22, 28 | §4 | P1 |
| 🚪 패스워드리스 로그인/온보딩 | FR-04~05, 25 | §4 | P1~P2 |
| 🪪 디바이스 등록·교체·신원증명 | FR-30~32, 43, 52 | §4·§5.6·§5.9 | P2 |
| 🔗 내부 IdP SSO | FR-06~08, 17, 18 | §4 | P3 |
| ✍️ Step-up·전자서명 | FR-09~10 | §4·§5.3 | P4 |
| 🖥️ 포털 런처·관리 UI | FR-11·11a, 12~13 | §4 | P5 |
| 📣 호출·긴급알림·Code | FR-38~42, 44~50 | §5.8·§5.9 | P5 |
| 🆘 Break-glass(환자안전) | FR-51 | §5.9 | P3 |
| ♻️ 세션·수명주기·복구 | FR-16, 19, 23~24, 27 | §4 | P3~P6 |
| 🎨 UX | FR-33~37 | §5.7 | 전 Phase |
| 🛡️ 감사·정책·컴플라이언스 | FR-15, 26, 29, 50, 53 | §4·§5.9 | P6 |

| ID | 요구사항 | 우선순위 | 상태 |
|----|----------|:--------:|:----:|
| FR-01 | WebAuthnCredential 모델 + 마이그레이션 (서버는 공개키만 저장) | High | Pending |
| FR-02 | 패스키 **등록** ceremony: 챌린지 발급 → 클라이언트 생성 → 서버 검증·저장 | High | Pending |
| FR-03 | 패스키 **로그인** ceremony: 챌린지 발급 → assertion 검증 → 기존 JWT/세션 발급 | High | Pending |
| FR-04 | 패스워드리스 First UI: 식별자 입력 → 패스키 자동 시도 → 실패 시 비밀번호 폴백 | High | Pending |
| FR-05 | 최초 온보딩: **관리자 검증 등록(FR-30, 권장)** 또는 비밀번호 로그인 직후 패스키 등록 권유 | High | Pending |
| FR-06 | 내부 IdP SSO 토큰 발급(`/api/v1/sso/internal/grant`) — **`smart-auth` 재사용**(부록 B). **독립 서명키**·audience exact·≤60s·1회용·**jti(Redis 1회소비)**·**발급세션 바인딩**. 메인 access JWT 재사용 금지. 추가: introspection·revocation | High | Pending |
| FR-07 | SSO 토큰 검증 — **기존 `pacs-proxy`+nginx passthrough 재사용**(부록 B). HIS 프록시가 검증 후 단기 접근 부여. 워크스테이션 `/pacs/` 직접링크를 `getViewerUrl()` 토큰 경유로 **통일** | High | Pending |
| FR-08 | 토큰 전달 — 원칙 **URL query 금지**(redemption code·백채널·`Referrer-Policy`·nginx 마스킹). **단 OHIF는 무수정 제약상 `?token=`만 수용** → PACS 한정 예외: **≤60s·1회용 토큰 + 로그 마스킹 + Referrer-Policy** 보상통제(부록 B, D-9) | High | Pending |
| FR-09 | Step-up 재인증 API — 생체 assertion → step-up 토큰. **(action, resourceId, 요청본문 해시) 바인딩 + jti 1회소비 + 발급세션 바인딩**, ≤5분. 다건 재사용 차단 | High | Pending |
| FR-10 | 처방/전자서명 가드에 step-up 토큰 요구. **생체 step-up = 서명 권한 게이트·본인확인 강화**이며, 법적 전자서명 자체는 기존 인증서/블록체인서명이 수행 — 둘을 감사로그로 명시 연결(어느 assertion이 어느 BlockchainCertificate 서명을 인가했는지) | High | Pending |
| FR-11 | 내부 포털 런처 `/staff` — 역할별 시스템 타일, 세션/인증 상태, 빠른 진입 | High | Pending |
| FR-11a | **(최소 포함)** 런처에 **호출·긴급알림·중요차트** 진입점 노출 — **기존 시스템으로 링크/집약만**(신규 구축·심화통합 제외). 미구현 기능은 진입점 placeholder + 추후 연결 | Medium | Pending |
| FR-12 | 패스키 관리: 등록 단말 목록·이름변경·삭제 (직원 마이페이지) | Medium | Pending |
| FR-13 | 관리자: 직원 패스키 강제 재설정/해제(분실·퇴사), 정책 설정 | Medium | Pending |
| ~~FR-14~~ | ~~신뢰 단말 + 공용 단말 모드~~ → **별도 사이클로 분리** (§3.2) | - | Deferred |
| FR-15 | 감사로그: 등록/로그인/SSO grant/step-up/실패 이벤트 기록 | High | Pending |
| FR-16 | 계정 복구: 패스키 전부 분실 시 비밀번호+관리자 승인 경로 | Medium | Pending |
| FR-17 | Jitsi 화상진료 SSO 연계 — JWT 기반 룸 입장. **룸ID 바인딩·룸별 권한(moderator/참가자)·만료**를 토큰에 묶어 임의 룸 재사용 차단 | Low | Pending |
| **FR-18** | **Single Logout(SLO)** — HIS 세션 폐기 시 발급된 SSO 자식 세션 추적·무효화(백채널 또는 토큰 단명+자식세션 상한 명문화) | High | Pending |
| **FR-19** | **idle timeout 실구현** — `lastActiveAt` 기반 비활성 만료(임상단말 30분 등). ⚠️ 기존 `sessionInactiveTimeout`은 **dead code**(미동작) → 실제 강제하도록 수정 | High | Pending |
| **FR-20** | **WebAuthn 정책 명문화** — `userVerification: 'required'` 고정, discoverable(resident) credential 정책(`residentKey` required/preferred 확정), attestation 정책(일반 none / 고보증 역할은 attestation 수집·AAGUID 허용목록) | High | Pending |
| **FR-21** | **signCount 검증 규칙** — 미증가 시 경고·감사, 역행 시 credential 잠금·재확인. synced credential(`backedUp=true`)은 counter 검증 완화 분기 | Medium | Pending |
| **FR-22** | **RP ID 고정** — 환경변수 기반 운영 등록가능도메인으로 고정. 클라이언트 `rp.id = hostname` 직접 사용 금지(환경별 흔들림 제거) | High | Pending |
| **FR-23** | **계정 수명주기 폐기 훅** — `Staff.status=RESIGNED`/역할변경 시 WebAuthnCredential·**StaffDevice·FCM 토큰** 전량 비활성 + 세션/refresh 전량 폐기 + SSO 자식세션 무효화(트랜잭션·저니이벤트) | High | Pending |
| **FR-24** | **복구 다중통제** — 패스키 전부 분실 시: 관리자 승인 + 대면/사번·신분 확인 + (부서장 2차 등) step-up, 복구 전량 감사·본인 통지, 복구 후 신규 패스키 재등록 강제 | High | Pending |
| **FR-25** | **계정 열거 방어** — 식별자 입력 시 credential 존재 여부와 무관하게 동일 응답·타이밍 | Medium | Pending |
| **FR-26** | **synced passkey 정책** — 클라우드 동기화(iCloud/Google) 자격증명 허용/차단 결정, `backedUp`/attestation 분기. PIA에 반영 | Medium | Pending |
| **FR-27** | **Clinic SSO 컨트롤러 보안 부채 정리** — IdP 재구성 시 평문 refresh 저장·로테이션 부재·bcrypt 10을 `auth.service` 수준(해시저장·로테이션·rounds 12)으로 통일 | High | Pending |
| **FR-28** | **챌린지 강화** — Redis 챌린지에 1회소비·origin·RP ID hash·UV결과 묶어 저장, ceremony 간 재사용 차단 | Medium | Pending |
| **FR-29** | **감사로그 항목 표준화** — actor·action·resource·인증수단(passkey/password/step-up)·AAGUID·credentialId·SSO audience·jti·결과·IP/UA·세션ID. EMR/JCI·개인정보보호법 접속기록 매핑 | High | Pending |
| **FR-30** | **관리자 검증 디바이스 등록** — 관리자 화면에서 의료진 선택 → **QR + 인증번호(6자리)** 발급 → 의료진이 본인 디바이스로 QR 스캔·인증번호 입력 → **관리자-디바이스 매칭 검증** → **등록 확정 직전 관리자 명시 승인(이중확인)** → 패스키 등록 ceremony → 검증된 StaffDevice로 바인딩. SSE 실시간. **신규 등록 시 본인에게 별도 채널 통지**(무단등록 탐지) | High | Pending |
| **FR-31** | **디바이스 교체/해제** — 기변·분실 시 관리자가 기존 StaffDevice·패스키·**FCM 토큰** 폐기(REVOKED/REPLACED) + 신규 QR 발급으로 동일 루틴 재등록. 교체 이력·사유 감사기록 | High | Pending |
| **FR-32** | **인증번호/QR 등록 세션 보안** — 인증번호 1회용·단기 TTL(5분)·**시도 5회 후 세션폐기**·**발급 시 대상 userId 사전 고정**(가로채 사용 금지)·IP/디바이스 throttle. QR 베이스URL 환경변수 고정(임의 redirect 금지) | High | Pending |

### 4.1 비기능 요구사항 (NFR)
| 범주 | 기준 | 측정 |
|------|------|------|
| 보안 | 생체 원본 서버 미전송(공개키만), 챌린지 1회용·만료, SSO 토큰 단기·audience 바인딩 | 코드리뷰 + security-architect |
| 보안 | 피싱 내성(RP ID 바인딩), 토큰 재사용 감지(기존 로직 확장) | 침투테스트 시나리오 |
| 성능 | 패스키 로그인 ≤ 1.5s, SSO grant ≤ 200ms | 측정 로그 |
| 가용성 | 패스키 실패 시 비밀번호 폴백 100% 동작 (락아웃 방지) + **인증 장애 시 Break-glass 경로 보장** | QA 시나리오 |
| 가용성(알림) | **Code블루 전달 p95 ≤ 3s, 전달 실패 발신자 즉시 인지**, SSE 재연결 시 미수신 재전송 | 측정·장애주입 |
| 남용방지 | 강제배너 빈도 상한·중복 억제, 발신 RBAC | 정책·감사 |
| 접근성 | 로그인 화면 WCAG 2.1 AA, 키보드/스크린리더 | 수동 점검 |
| 호환성 | Safari(Touch ID)/Chrome/Edge(Hello) 플랫폼 인증기 | 브라우저 매트릭스 |
| 컴플라이언스 | EMR/JCI 접근통제·감사, 개인정보보호법(생체 로컬 저장) | 인증 체크리스트 |

---

## 5. 아키텍처 / 핵심 설계

### 5.1 인증 흐름 (패스워드리스 First)
```
[최초 온보딩]
  /staff/login → 이메일/사번 + 비밀번호(폴백) 로그인
    → 성공 시 "이 기기에 패스키 등록" 권유
    → FR-02 등록 ceremony → WebAuthnCredential 저장(공개키)

[일상 로그인 (패스워드리스)]
  /staff/login → 식별자 입력(또는 단말 기억 시 자동)
    → 패스키 챌린지 발급(FR-03) → 지문/얼굴 인증 → assertion 서버 검증
    → 기존 AuthService 가 JWT(8h)+refresh(7d)+Redis 세션 발급  ← 코어 재사용
    → /staff 런처로 진입
```

### 5.2 내부 SSO (HIS = IdP)
```
[하위 시스템 진입]
  /staff 런처에서 "PACS 뷰어" 타일 클릭
    → 프론트가 /api/v1/sso/internal/grant?audience=ohif 호출
    → HIS가 단기(≤60s)·1회용 SSO 토큰 발급(독립키·audience·jti·세션바인딩, FR-06)
    → 링크에는 **redemption code(무의미)** 만 부착, 실제 토큰은 **백채널 교환**(URL query 금지, FR-08)
    → **HIS 리버스 프록시가 토큰 검증 후 단기 접근 부여**(하위시스템 직접 verify 아님, FR-07)
  ※ Clinic 아웃바운드 SSO 패턴(sso.controller.ts)을 IdP 방향으로 재구성. 단일도메인 RP ID 제약상 타 오리진(PACS/Jitsi) 직접 재인증 불가 → SSO 토큰 경유 강제
```
> **PACS 제약 준수**: CLAUDE.md — Orthanc/OHIF/nginx PACS 경로·DB 수정 금지. 본 기획은 **프론트 링크에 토큰을 실어 전달**하는 방식만 사용. 토큰 소비(검증)는 PACS 측이 이미 SSO를 수용하는 범위에서만, 아니면 HIS가 검증 후 단기 접근 URL을 반환하는 프록시 패턴 검토.

### 5.3 Step-up 재인증
```
처방 서명/전자서명 시도
  → 클라이언트가 step-up 필요 감지 → 생체 assertion(FR-09)
  → 서버 검증 → 액션 scope·≤5분 step-up 토큰 발급
  → 해당 행위 API 가드가 step-up 토큰 요구(FR-10)
  → 의료법 §24-2 본인확인 증빙 + AuditLog 기록
```

### 5.4 데이터 모델 (신규)
```prisma
model WebAuthnCredential {
  id            String   @id @default(uuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id])
  credentialId  String   @unique          // base64url
  publicKey     Bytes                      // 공개키만 (원본 생체 X)
  counter       BigInt   @default(0)       // 리플레이 방지(signCount)
  transports    String[]                   // platform/internal 등
  aaguid        String?
  backedUp      Boolean  @default(false)   // synced passkey 식별
  deviceId      String?                    // → StaffDevice (검증 디바이스 바인딩)
  status        String   @default("ACTIVE")// ACTIVE/REVOKED/REPLACED
  createdAt     DateTime @default(now())
  lastUsedAt    DateTime?
  @@index([userId])
}

model StaffDevice {                         // 관리자 검증된 의료진 디바이스
  id            String   @id @default(uuid())
  userId        String                      // 소속 의료진(Staff/User)
  deviceName    String                      // "내 아이폰", "병동 노트북"
  status        String   @default("ACTIVE") // ACTIVE/REVOKED/REPLACED
  enrolledBy    String                      // 검증 관리자 userId
  enrollMethod  String                      // ADMIN_QR / SELF
  verifiedAt    DateTime @default(now())
  replacedById  String?                     // 교체된 후속 디바이스
  revokedAt     DateTime?
  revokeReason  String?
  @@index([userId])
}
// 등록 세션(QR·인증번호·challenge)은 Redis 단기 TTL 저장 — 별도 테이블 불필요
//   enroll:{sessionId} = { staffUserId, code(6자리), adminId, expiresAt, attempts, status }
```

### 5.5 프로젝트 레벨 / 기술 결정
- **레벨**: Enterprise (기존 Clean Architecture, NestJS 모듈 그대로)
- **백엔드 라이브러리**: `@simplewebauthn/server` (검증된 FIDO2 구현, 직접 구현 지양)
- **프론트**: `@simplewebauthn/browser`로 기존 `webauthn.ts` 보강 또는 대체 검토
- **세션/토큰**: 기존 JWT+Redis 코어 **재사용** (신규 토큰 체계 X — 일관성)
- **모듈 위치**: `apps/api/src/modules/auth/passkey/`, `auth/sso-idp/`, `auth/device-enroll/` 신규 하위 모듈
- **프론트 신규**: `apps/web/src/app/staff/` (런처/로그인), `apps/web/src/app/(auth)/login` 보강

### 5.6 관리자 검증 디바이스 등록 루틴 (FR-30~32)
> **목적**: 패스워드리스 부트스트랩 신뢰 — "이 디바이스가 정말 그 의료진 것"임을 관리자가 1회 검증 후 패스키를 바인딩. consent-signing-device의 QR+인증코드 페어링 패턴 재사용.
```
[디바이스 등록 — 관리자 검증]
  관리자 화면(/admin/staff-devices) → 의료진 선택 → "기기 등록"
    → 서버가 등록세션 발급: QR(URL) + 인증번호(6자리), Redis 단기 TTL(≤5분)
    → 관리자 화면에 QR + 인증번호 표시 (SSE로 상태 실시간 갱신)
  의료진이 본인 디바이스로:
    → QR 스캔 → 등록 페이지 진입 → 본인 로그인/식별 + 인증번호 입력
    → (관리자 발급코드 == 입력코드) 매칭 검증  ← 관리자 인가 증명
    → WebAuthn 등록 ceremony(지문/얼굴) → WebAuthnCredential 저장(공개키)
    → StaffDevice(status=ACTIVE, enrolledBy=관리자, enrollMethod=ADMIN_QR) 생성·바인딩
    → 관리자/의료진 화면 모두 "등록 완료" 실시간 전환 + 감사기록

[디바이스 교체/해제 — FR-31]
  기변·분실 신고 → 관리자가 기존 StaffDevice·연결 패스키 폐기(REVOKED/REPLACED)
    + 활성 세션 폐기(FR-23 연계) → 신규 QR 발급 → 위 등록 루틴 재수행
    → 교체 사유·이력 감사기록, 본인 통지
```
> **보안(FR-32)**: 인증번호 1회용·단기·시도횟수 제한, **관리자 권한 + 대상 의료진 본인 인증 동시 충족** 시에만 등록 확정(오등록·중간자 방지). 등록/교체/폐기 전량 AuditLog.

### 5.7 UX 설계 원칙 및 주요 흐름 (FR-33~37)
> **핵심 원칙**: 의료 현장은 "한 손·짧은 시간·중단 최소"가 생명. 인증은 **보이지 않게(invisible)**, 서명·인증서 같은 법적 행위만 **명시적으로(explicit)**. 기존 디자인 시스템(shadcn/ui, 포털 UX v2.2 토큰)에 정렬.

**UX 5대 원칙**
| # | 원칙 | 적용 |
|---|------|------|
| U1 | **Progressive disclosure** | 평소엔 생체 1탭, 문제 시에만 폴백/대안 노출 (선택지 폭주 금지) |
| U2 | **항상 탈출구** | 모든 인증 화면에 비밀번호 폴백·"관리자에게 문의" 상시 노출 (락아웃 불안 제거) |
| U3 | **명확한 상태·피드백** | 대기/진행/성공/실패를 SSE 실시간·애니메이션으로. "왜 안 되는지" 행동 가능한 메시지 |
| U4 | **법적 행위는 의식화(ritual)** | 전자서명·인증서 사용은 무엇에·왜 서명하는지 요약 + 명시적 확인. 실수 서명 방지 |
| U5 | **접근성·현장성** | WCAG 2.1 AA, 큰 탭타깃(장갑 착용), 키보드/스크린리더, 고대비, 공용단말 고려(별도) |

**(A) 로그인 UX — 패스워드리스 First (FR-04)**
```
/staff/login
 ┌─────────────────────────────────┐
 │  🏥 위루비병원 내부포털      │
 │  [ 이메일/사번 ]                  │  ← 입력칸 포커스 시 passkey autofill
 │  (•) 지문·얼굴로 로그인  ← 기본·강조  │     (conditional UI, mediation:'conditional')
 │  ───────── 또는 ─────────         │
 │  비밀번호로 로그인 ▸ (접힘, 폴백)    │  ← U1 점진노출
 │  패스키가 없나요? 관리자에게 등록요청 ▸ │  ← U2 탈출구
 └─────────────────────────────────┘
 성공: 생체 프롬프트 → 0.5~1.5s → /staff 런처로 부드럽게 전환(스피너+체크 애니메이션)
 실패: "이 기기에 등록된 패스키가 없어요" → [비밀번호로] / [기기 등록 요청] 명확 제시
```

**(B) 디바이스 등록 UX — 관리자·의료진 양면 (FR-30)**
```
[관리자 화면 /admin/staff-devices]        [의료진 디바이스]
 의료진 검색 → 선택 → "기기 등록"
 ┌───────────────────────┐
 │ 김의사 (내과)            │             QR 스캔 → 등록 페이지
 │   ▣ QR 코드             │  ───스캔──▶  ┌──────────────────┐
 │   인증번호: 4 8 2 9 1 7  │             │ 본인확인 후         │
 │   ⏳ 04:32 남음          │             │ 인증번호 [______]   │
 │   ● 대기 중… (SSE)      │             │ → 지문·얼굴 등록     │
 └───────────────────────┘             └──────────────────┘
 코드 일치 → 양쪽 동시에 "✅ 등록 완료" 실시간 전환 + 디바이스명 표시
```
- 관리자: 만료 카운트다운, 재발급 버튼, 등록 상태 단계 표시(대기→매칭→생체등록→완료)
- 의료진: 단계 progress, 인증번호 오입력 시 남은 시도 횟수, 만료 시 "관리자에게 재발급 요청"

**(C) Step-up + 인증서/전자서명 UX (FR-09/10, U4 의식화)**
```
처방 "서명" 클릭
 ┌─────────────────────────────────┐
 │  ✍️ 전자서명 확인                  │  ← 무엇에 서명하는지 요약(U4)
 │  대상: 홍길동 / 처방 3건           │
 │  ───────────────────────────    │
 │  본인확인: 지문·얼굴 [생체 프롬프트]  │  ← step-up(생체)
 │  서명 인증서: 기관 발급 인증서 ✓     │  ← 인증서 선택/표시(있을 때)
 │  [ 서명하기 ]   [ 취소 ]           │
 └─────────────────────────────────┘
 완료: "서명됨 · 블록체인 기록 #a1b2…" 토스트 + 서명이미지/타임스탬프 표시
```
- 생체(본인확인) → 인증서/블록체인 서명(법적효력)을 **한 모달에서 순차**로, 그러나 각 단계 명시(G-2 결과 반영)
- 인증서가 여러 개면 선택 UI, 만료·갱신 필요 시 사전 안내, 없으면 발급 경로 안내
- step-up이 방금 통과됐으면(≤유효시간) 재프롬프트 생략 — 연속 서명 시 마찰 최소화(단 토큰은 건별 바인딩 FR-09)

**(D) 패스키·디바이스 관리 UX (FR-12, 의료진 마이페이지)**
```
내 보안 설정
 • 내 아이폰    · 마지막 사용 5분 전   [이름변경] [삭제]
 • 병동 노트북  · 마지막 사용 어제      [이름변경] [삭제]
 [ + 이 기기에 패스키 추가 ]   기기를 잃어버렸나요? [교체/해제 요청]
```

**(E) 복구 UX (FR-24, 안전하되 막다른 길 없이)**
```
"로그인할 수 없어요" → 단계 안내:
 1) 다른 등록 기기로 시도  2) 비밀번호 폴백  3) 관리자 검증 재등록(QR 루틴)
 복구 진행 시 본인에게 알림 발송 + 복구 후 새 패스키 재등록 강제
```

**(F) SSO 런처 UX (FR-11)**
```
/staff 런처: 역할별 시스템 타일(EMR·CRM·검진·PACS뷰어·화상진료…)
 타일 클릭 → (백채널 토큰 교환) → 새 탭 진입, 진입 중 로딩 표시
 상단: 현재 세션·인증수단·idle 만료 임박 시 경고 배너(FR-19 연계)
```

| ID | UX 요구사항 | 우선순위 | 상태 |
|----|----------|:--------:|:----:|
| FR-33 | 로그인 conditional UI(passkey autofill) + 폴백 점진노출 + 행동가능 에러 | High | Pending |
| FR-34 | 디바이스 등록 양면 UX(관리자/의료진) — QR·인증번호·SSE 단계 진행·만료/재발급 | High | Pending |
| FR-35 | Step-up+인증서 서명 모달 — 서명 대상 요약·생체→인증서/블록체인 순차·결과 표시(U4) | High | Pending |
| FR-36 | 패스키/디바이스 관리·복구 UX — 상시 탈출구·본인통지·재등록 강제 | High | Pending |
| FR-37 | 접근성·현장성 — WCAG 2.1 AA, 큰 탭타깃, 키보드/스크린리더, idle 경고 배너 | High | Pending |

### 5.8 내부 포털 호출·긴급알림 (FR-38~42, 기존 알림 인프라 재사용)
> **재사용 기반**: `modules/notification/`(service·`@Sse('stream')`·FCM) + 프론트 `notification-store.ts`·`NotificationPanel.tsx`·`CriticalValueAlertBanner.tsx`. **전송 백본·수신 UI는 그대로**, 신규는 (a)그룹 타게팅, (b)호출 응답/에스컬레이션, (c)스태프 FCM 토큰뿐.
```
[직원 호출 — Staff Call]
  /staff 런처 또는 차트에서 "호출" → 대상(개인/역할/부서) + 메시지
    → Notification 생성(type=STAFF_CALL) → SSE 푸시 → 수신자 벨/토스트
    → 수신자 [수락/확인/콜백] → 발신자에게 응답 상태 실시간 반영
[긴급 알림·Code 호출]
  긴급 공지/코드블루 원클릭 → 대상 그룹(부서/역할/전체) 브로드캐스트
    → 수신자 화면 강제 배너(CriticalValueAlertBanner 재사용) + 소리/푸시
    → 수신확인(acknowledge) 집계 → 미응답 시 에스컬레이션(상위/추가대상)
  ※ 백그라운드/오프라인은 StaffDevice(FR-30) 기반 FCM 푸시로 도달
```

| ID | 요구사항 | 우선순위 | 상태 |
|----|----------|:--------:|:----:|
| FR-38 | **직원 호출(Staff Call/Paging)** — 대상(개인/역할/부서) 지정·메시지·발신/수신·**응답(수락/확인/콜백)**. Notification+SSE 재사용 | Medium | Pending |
| FR-39 | **긴급 알림 브로드캐스트** — 부서/역할/전체 대상, severity, **강제 표시 배너**(`CriticalValueAlertBanner` 재사용)·**수신확인** | High | Pending |
| FR-40 | **Code 호출(코드블루 등)** — 원클릭 응급 호출(위치·유형), 팀 즉시 브로드캐스트 + **미응답 에스컬레이션** | Medium | Pending |
| FR-41 | **SSE 그룹 타게팅 확장** — 기존 per-user Subject 맵에 role/department 키 추가(그룹 브로드캐스트) | Medium | Pending |
| FR-42 | **스태프 FCM 푸시** — StaffDevice(FR-30) 재사용 + NotificationListener로 백그라운드/오프라인 푸시 | Medium | Pending |

> **범위 주의**: 호출·긴급알림은 **기존 알림 인프라 위 baseline 기능**으로 포함. 중요차트는 **링크/집약(FR-11a)** 수준만. 심화 임상허브(실시간 차트 위젯·바이탈 스트림 등)는 본 사이클 제외.

### 5.9 2차 보안검토 반영 — 등록 신원증명·호출 권한·전달보장·Break-glass (FR-43~51)
> security-architect 2차 검토(신규영역) + 환자안전 갭(Break-glass) 반영. **재사용한 QR 패턴은 원래 키오스크 등록용**이라 "디바이스=본인" 신원증명이 약함 → 등급 분리 필수.

**(가) 디바이스 등록 신원증명**
| ID | 요구사항 | 우선 | 상태 |
|----|----------|:--:|:--:|
| FR-43 | **등록 신원증명 등급(대면/원격)** — `enrollMode`(IN_PERSON/REMOTE). 고보증 역할(DOCTOR·처방/전자서명 권한자)은 **대면 등록 필수**(관리자 육안 신분·사번 대조 + 인사DB 매칭). 6자리 코드는 "채널 인가"일 뿐 "신원 증명" 아님을 명시. `StaffDevice.enrollMethod`에 `ADMIN_QR_INPERSON` 추가 | High(P0) | Pending |

**(나) 호출·긴급알림 권한·남용·전달보장**
| ID | 요구사항 | 우선 | 상태 |
|----|----------|:--:|:--:|
| FR-44 | **발신 권한 RBAC** — Code호출/전체 브로드캐스트/강제배너를 Permission 게이트(`CODE_CALL_INITIATE`·`STAFF_CALL_BROADCAST`). 전체대상은 당직책임자/관리자 한정, 부서호출은 해당 부서 스코프 | High(P0) | Pending |
| FR-45 | **남용·alarm fatigue 방어** — 발신자별 rate-limit·동일대상 de-dup·severity별 강제표시 거버넌스. 강제배너는 **텍스트+표준액션만**(임의 URL/HTML 금지). 허위 Code 발신 플래그 | High(P1) | Pending |
| FR-46 | **허위호출·취소/철회** — Code 취소는 발신자/책임자만, 취소도 전량 감사 | Medium(P1) | Pending |
| FR-47 | **대상 정확도** — 근무스케줄/활성세션 **교집합 타게팅**(off-shift 노이즈·개인정보 확산 방지). off-shift 도달은 Code 등 명시정책만. **구독 그룹은 서버가 역할/부서로 결정**(클라이언트 자칭 구독 금지) | High(P1) | Pending |
| FR-48 | **Code블루 전달보장** — SSE+FCM **동시 발송**, SSE는 best-effort 전제로 **재연결 시 미수신 큐 재전송**(시퀀스). 수신확인 미수신 시 채널 폴백. **에스컬레이션 타임아웃·상한·실패 가시화**(조용한 실패 금지, 발신자 즉시 인지) | High(P0) | Pending |

**(다) FCM 페이로드·토큰**
| ID | 요구사항 | 우선 | 상태 |
|----|----------|:--:|:--:|
| FR-49 | **푸시 페이로드 비식별** — 잠금화면에 환자명·진단·사유 본문 금지. "긴급 호출 도착, 앱에서 확인"식 + 본문은 **앱 인증 후 fetch(data-only push)**. FCM 토큰 수명주기: StaffDevice REVOKED/REPLACED·퇴사 시 즉시 폐기, **토큰-디바이스-유저 3자 정합** 검증 | High(P0) | Pending |

**(라) 감사·개인정보**
| ID | 요구사항 | 우선 | 상태 |
|----|----------|:--:|:--:|
| FR-50 | **호출/긴급알림 감사** — 발신자·대상·severity·수신확인·에스컬레이션 결과 기록(FR-29 확장). 호출 메시지의 환자참조는 **ID/링크만**(평문 환자정보 금지), 수신측 권한 가드로 열람 제어 | High(P1) | Pending |
| FR-52 | **다중 디바이스 정책** — 사용자당 패스키 최대 N개(정책값)·디바이스명 필수·최소 1개 유지(전부 삭제 차단), 다중 등록 권장(분실 대비) | Medium | Pending |
| FR-53 | **데이터 보존·파기 정책** — 감사로그 의료법/개보법 보존기간 준수, credential·StaffDevice·FCM 토큰은 폐기 시 비활성→보존기간 후 파기. PIA와 정합 | Medium | Pending |

**(마) Break-glass — 응급 접근 (환자안전 P0)**
> **핵심 갭**: 패스워드리스·SSO·네트워크·인증서버 장애 시 **임상의가 환자 진료를 위해 EMR에 접근하지 못하면 환자안전 사고**. 병원 인증의 필수 안전판.
```
[Break-glass 절차]
  정상 인증 불가(장애·패스키 분실·응급) → "응급 접근(Break-glass)" 진입
    → 사유 입력(필수) + 최소 식별(사번 등) + 가능 시 2인 승인/책임자 코드
    → 시간제한 임시 접근 부여(좁은 범위·짧은 만료)
    → 전량 강조 감사 + 실시간 보안팀 알림 + 사후 의무 검토(post-hoc review)
```
| ID | 요구사항 | 우선 | 상태 |
|----|----------|:--:|:--:|
| FR-51 | **Break-glass 응급 접근** — 인증 장애/응급 시 사유입력·최소식별·(2인승인/책임자코드) 기반 시간제한 임시 접근. **전량 강조 감사 + 실시간 보안팀 알림 + 사후 의무 검토**. 남용 방지 위해 좁은 범위·짧은 만료·본인/관리자 통지 | High(P0) | Pending |

---

## 6. 위험 및 완화

| 위험 | 영향 | 가능성 | 완화 |
|------|:----:|:----:|------|
| 패스키 분실로 직원 락아웃 | High | Medium | 비밀번호 폴백 + 관리자 재설정(FR-13/16), 다중 단말 등록 권장 |
| SSO 토큰 탈취/재사용 | High | Low | 독립키·jti·세션바인딩·audience exact, URL 전달 금지(redemption code) |
| ~~PACS verify 불가~~ → **해소(부록 B)** | High | **Low** | 기존 pacs-proxy+nginx+OHIF SSO로 무수정 동작 확인. 잔여는 링크통일·OHIF URL토큰 보상통제(D-9)뿐 |
| **생체 step-up의 §24-2 전자서명 효력 미확정** | High | **High** | 생체 = 서명 게이트·본인확인 강화, 법적 서명은 기존 인증서/블록체인 수행. **법무·인증기관 자문으로 확정**(G-2) |
| **synced passkey 클라우드 복제** | High | Medium | 직원 개인 iCloud/Google에 자격증명 복제됨 — `backedUp`/attestation 분기·정책 결정(FR-26), PIA 반영 |
| **복구 경로 소셜엔지니어링** | High | Medium | 패스워드리스 최대 공격면 — 다중통제·통지·재등록 강제(FR-24) |
| **Clinic SSO 부채 상속** | High | Medium | IdP 재구성 시 약한 경로(평문 refresh·rounds 10) 물려받음 → 통일(FR-27) |
| **인증 장애 시 진료 차단(환자안전)** | High | Medium | **Break-glass 응급 접근**(FR-51) — 시간제한·강조감사·사후검토 |
| **디바이스 등록 신원증명 약함**(키오스크 패턴 재사용) | High | Medium | 대면/원격 등급 분리·고보증 대면필수·이중확인·등록통지(FR-43/30/32) |
| **Code블루 미도달(SSE best-effort)** | High | Medium | SSE+FCM 동시·미수신 큐 재전송·에스컬레이션 실패 가시화(FR-48) |
| **호출/긴급알림 권한 남용·alarm fatigue** | Medium | Medium | 발신 RBAC·rate-limit·severity 거버넌스·취소감사(FR-44~46) |
| **FCM 잠금화면 환자정보 노출** | High | Medium | 비식별 푸시·data-only·앱 인증 후 fetch(FR-49) |
| SSO 토큰 URL 로그 유출 | High | Medium | query 금지·redemption code·Referrer-Policy·nginx 마스킹(FR-08) |
| 브라우저 호환성(구형 단말) | Medium | Medium | 기능감지 + 비밀번호 폴백, 호환 매트릭스 사전 점검 |
| 생체정보 법적 리스크 | High | Low | 서버 공개키만 저장, 원본 미전송 — 보안검토·**PIA 수행**(§9.2) |
| 기존 로그인/리다이렉트 회귀 | Medium | Medium | 기존 `/login` 역할별 리다이렉트 보존, 점진 롤아웃(opt-in) |

### 6.1 사전 게이트 (설계 착수 전 필수 — security-architect 권고)
> 아래 2건은 **설계(`/pdca design`) 착수 전** 해소해야 후속 설계가 무효화되지 않음.

| 게이트 | 내용 | 산출물 | 차단 대상 |
|:----:|------|------|------|
| **G-1** | **PACS SSO PoC** — ✅ **사전조사 완료(부록 B): 실현가능성 높음**. 기존 pacs-proxy+nginx passthrough+OHIF `?token=` 변환으로 **무수정 SSO 이미 동작**. 잔여: 워크스테이션 링크 통일·OHIF URL토큰 보상통제(D-9). 실배포 PoC만 남음 | ✅ 부록 B | FR-07/08, §5.2 |
| **G-2** | **전자서명 법무 자문** — 생체 step-up이 의료법 §24-2/전자서명법상 전자서명을 **대체하지 않음**을 전제로, 기존 BlockchainCertificate·서명이미지와의 **결합 구조**의 법적 효력 확정 | 법무 검토서 | FR-09/10 |

---

## 7. 단계별 구현 계획 (Phase)

| Phase | 내용 | 산출물 |
|:----:|------|------|
| **P1** | WebAuthnCredential/StaffDevice 모델 + 백엔드 등록/로그인 ceremony + WebAuthn 정책(FR-01~03, 20~22) | passkey 모듈, 마이그레이션 |
| **P2** | **관리자 검증 디바이스 등록 루틴(QR+인증번호·SSE·신원증명 등급)** + 교체/해제 + 패스워드리스 First UI/온보딩 (FR-04~05, 30~32, **43**) | `/staff/login`, `/admin/staff-devices`, 등록 플로우 |
| **P3** | 내부 IdP SSO 발급/검증 + PACS/Jitsi 전파 + **Break-glass 응급접근** (FR-06~08, 17, **51**) | sso-idp 모듈, 런처 연동, break-glass |
| **P4** | Step-up 재인증 + 고위험 가드 (FR-09~10) | step-up 가드, 서명 연동 |
| **P5** | 런처 `/staff` + 패스키 관리 + **호출·긴급알림·Code(권한RBAC·전달보장·FCM비식별·타게팅)** (FR-11·11a·12~13, 38~42, **44~50**) | 런처 UI, 호출/알림 UI |
| **P6** | 복구·관리자 정책·감사로그(호출 포함)·QA·보안검토 (FR-13,15,16,24, 50) | 감사 확장, 보안리뷰 |

> 점진 롤아웃: 기존 비밀번호 로그인 유지 → 부서 단위 opt-in 패스키 → 전사 기본화.

---

## 8. 성공 기준

### 8.1 Definition of Done
- [ ] 패스키만으로 로그인 → HIS 진입 → 하위 시스템 1개 이상 SSO 진입 성공
- [ ] 처방/전자서명에서 step-up 생체 재인증 동작 + 감사로그 기록
- [ ] 패스키 분실 시 비밀번호 폴백 + 관리자 재설정 동작
- [ ] PACS 서버 무수정 확인 (설계 검증 통과)
- [ ] 주요 브라우저(Safari/Chrome/Edge) 플랫폼 인증기 동작

### 8.2 품질 기준
- [ ] 백엔드 단위테스트 (ceremony·검증·SSO·step-up)
- [ ] Gap 분석 ≥ 90%
- [ ] security-architect 보안 검토 통과
- [ ] **G-1(PACS PoC)·G-2(법무 자문) 게이트 통과**
- [ ] **PIA(개인정보 영향평가) 수행** — 생체 메타·인증로그 처리
- [ ] **Break-glass 응급접근 경로 검증**(인증 장애 주입 시나리오)
- [ ] lint/build 무오류

### 8.3 테스트 전략 & 운영 지표
- **테스트**: 백엔드 단위(ceremony·SSO·step-up·등록세션) + **zero-script-qa**(로그 기반 인증 흐름) + **브라우저 매트릭스**(Safari/Chrome/Edge 플랫폼 인증기) + **장애주입**(SSE 끊김·FCM 실패 시 Code 전달·Break-glass)
- **관측 지표**: 패스키 로그인 성공률·폴백률, 등록 완료율, SSO grant 지연, Code블루 전달/수신확인 지연·미응답 에스컬레이션율, Break-glass 사용 빈도(이상감지), step-up 마찰(연속서명 재프롬프트율)
- **롤아웃**: 비밀번호 로그인 유지 → 부서 단위 opt-in → 전사 기본화. 단계별 지표 모니터링 + 롤백 기준

---

## 9. 다음 단계
1. [ ] 본 Plan 사용자 확정 — 특히 **§10 결정 필요 사항(D-1~D-8)** 확정
2. [x] security-architect 위협 모델링 (1차 코어 + 2차 신규영역) — **완료, v1.1·v1.5 반영**
3. [x] **G-1 PACS SSO** 사전조사 — **해소(부록 B, 실현가능성 높음)**. 실배포 PoC만 잔여
3b. [x] **SMART OAuth2 재사용성** 사전조사 — **재사용 가능(부록 B)**
4. [ ] **G-2 전자서명 법무 자문** (유일한 미해소 게이트 — 조직 차원)
5. [ ] `/pdca design staff-sso-passwordless` — 상세 설계 (모델·엔드포인트·시퀀스)
6. [ ] P1부터 구현 착수

---

## 10. 결정 필요 사항 (Open Decisions)
> 설계 착수 시 확정 필요. 미확정 시 괄호 안 기본값으로 진행.

| # | 결정 항목 | 옵션 | 기본값(권장) |
|---|----------|------|--------------|
| D-1 | SSO 대상 범위(이번 사이클) | PACS / Jitsi / Clinic 중 선택 | **전부 포함** (PACS는 G-1 결과 의존) |
| D-2 | 패스키 도입 방식 | 전사 강제 / 부서 opt-in 점진 | **부서 opt-in 점진** |
| D-3 | discoverable credential | `residentKey: required` / `preferred` | **preferred** (식별자 입력 폴백 유지) |
| D-4 | synced passkey(iCloud/Google) | 허용 / 차단 / 역할별 분기 | **역할별 분기** (고보증 역할 device-bound 선호, FR-26) |
| D-5 | 사용자당 패스키 최대 수(FR-52) | 숫자 N | **3~5** |
| D-6 | idle timeout 값(FR-19) | 임상/행정 단말별 분 | **임상 30분 / 행정 60분** |
| D-7 | attestation 수집 범위(FR-20) | 전체 none / 고보증 역할만 수집 | **고보증 역할만 수집** |
| D-8 | Break-glass 승인(FR-51) | 1인 사유 / 2인 승인 / 책임자 코드 | **2인 승인 또는 책임자 코드** |
| D-9 | OHIF 토큰 전달(FR-08, 무수정 제약) | URL `?token=`(보상통제) / nginx auth_request 게이트 | **URL `?token=` + ≤60s·1회용·로그마스킹**(OHIF 무수정), 여력 시 auth_request 강화 |

---

## 11. 용어집 (Glossary)
| 용어 | 뜻 |
|------|----|
| **패스키(Passkey)** | WebAuthn/FIDO2 공개키 자격증명. 개인키는 단말 보안영역(Secure Enclave/TPM)에, 서버는 공개키만 보관 |
| **WebAuthn / FIDO2** | 피싱 내성 패스워드리스 인증 W3C/FIDO 표준 |
| **플랫폼 인증기** | Touch ID·Face ID·Windows Hello·지문 등 단말 내장 생체 인증기 |
| **RP ID** | Relying Party ID — 패스키가 바인딩되는 단일 등록가능도메인(FR-22) |
| **discoverable(resident) credential** | 식별자 입력 없이 단말이 자격증명을 찾아 제시(usernameless) |
| **ceremony** | WebAuthn 등록/인증의 챌린지-응답 절차 |
| **signCount** | 인증기 사용 카운터 — 복제 authenticator 감지용(FR-21) |
| **attestation** | 인증기 기종·신뢰성 증명(AAGUID 포함) |
| **synced/backed-up passkey** | iCloud/Google 키체인으로 클라우드 동기화되는 패스키(FR-26) |
| **Step-up 인증** | 고위험 행위 직전 추가 생체 재인증(FR-09) |
| **IdP (Identity Provider)** | 인증 주체 — 본 기획에서 HIS가 내부 IdP 역할 |
| **SSO 토큰 / redemption code** | 하위 시스템 진입용 단기·1회용 토큰. URL엔 무의미 code만, 실제 토큰은 백채널 교환(FR-06/08) |
| **SLO (Single Logout)** | HIS 로그아웃 시 발급된 자식 세션 일괄 무효화(FR-18) |
| **Break-glass** | 인증 장애·응급 시 강한 감사 하에 임시 접근을 허용하는 비상 절차(FR-51) |
| **Code 호출** | 코드블루 등 원클릭 응급 호출(FR-40/48) |
| **PIA** | 개인정보 영향평가 — 생체 메타·인증로그 처리 대상 |

---

## 부록 A. 기존 인증 인프라 현황 (조사 결과 요약)
- AuthController/Service: `/api/v1/auth/login|refresh|logout`, JWT 8h + refresh 7d(쿠키), Redis 세션, refresh 로테이션·**토큰탈취감지**, 동시세션 3, 로그인 실패 10회 15분 락, Throttle 30/60s, bcrypt rounds 12, 비밀번호 12자·90일 만료.
- SSO(아웃바운드): `clinic-integration/sso.controller.ts` — Clinic 토큰 검증→User 생성/매핑, 역할 매핑(OWNER→ADMIN 등), 프론트 `/sso`.
- RBAC: UserRole 7(ADMIN/DOCTOR/NURSE/PHARMACIST/LAB_TECH/CRM_MANAGER/CRM_STAFF), Permission 61, RolesGuard·@RequirePermission.
- WebAuthn: **클라이언트만** 존재(`lib/crypto/webauthn.ts`, RP id=hostname, platform 인증기, userVerification required) — 백엔드 미구현.
- 모델: User(passwordHash·role·department), Staff(category=MEDICAL/TECHNICAL/ADMIN/SUPPORT, employeeNumber, clinicUserId), 1:1.
- 프론트 로그인: `(auth)/login/page.tsx` — 이메일+비번, 역할/부서별 리다이렉트(/crm·/his-checkup·/workstation·/dashboard).

## 부록 B. 설계 전 사전조사 결과 (G-1 PoC + SMART OAuth2 재사용)
> 2026-06-05 코드 기준 조사. **두 게이트 후보 모두 신규구축 최소화 — 설계 위험 크게 감소.**

### B-1. G-1 PACS SSO — **실현가능성 높음 (거의 이미 구현됨)**
| 자산 | 위치 | 상태 |
|------|------|------|
| HIS→PACS SSO 프록시 | `pacs-proxy.service.ts:76-82` | HIS JWT + `X-HIS-User-{Id,Email,Role}` 전달 ✅ |
| nginx passthrough | `nginx/prod.conf:111-137` | `/dicom-web/`·`/wado`·`/pacs-api/` Authorization+헤더 주입 ✅ |
| OHIF 토큰 수용 | `ohif-config.js:31-40` | `?token=` → `Authorization: Bearer` + `X-Auth-Source: his-sso` 변환 ✅ |
| 뷰어 URL 생성 | `pacs-proxy.service.ts:300` `getViewerUrl()` | 토큰 포함 URL 생성 ✅ |
| SSO 플래그 | env `PACS_SSO_ENABLED=true` | 활성 + 서비스계정 폴백 ✅ |

- **결론**: PACS 무수정 SSO는 **이미 동작**. FR-07/08은 신규구축이 아니라 **(a)워크스테이션 `/pacs/` 직접링크를 `getViewerUrl()` 토큰경유로 통일, (b)OHIF가 `?token=`만 수용하는 제약의 보상통제(≤60s·1회용·로그마스킹, D-9)** 만 남음.
- **잔여 위험**: OHIF URL 토큰은 FR-08 원칙(URL 금지)과 충돌하나 무수정 제약상 불가피 → 단기·마스킹으로 완화.

### B-2. SMART OAuth2 재사용 — **중간 (기반 재사용 + 확장)**
| 있음 | 없음(추가 필요) |
|------|------|
| `/oauth2/authorize`·`/oauth2/token`, authorization_code+client_credentials | RFC7662 **introspection** 엔드포인트 |
| SmartClient(client_id/secret·redirectUris·scope·isActive) | **PKCE** (code_challenge/verifier) |
| JWT(`token_type:'smart'`, 1h, AUTH_SECRET), scope 가드 | **jti·revocation**(Redis 블랙리스트) |
| code 1회용(메모리) | 내부 SSO용 `token_type`(예 'internal_sso') 분리 |

- **결론**: 내부 IdP(FR-06/07)는 `smart-auth`를 일반화해 재사용. SmartClient에 하위시스템(OHIF/Jitsi) 클라이언트 등록. introspection·PKCE·jti·독립키를 보강(FR-06 요구와 일치).

## 버전 이력
| 버전 | 날짜 | 변경 | 작성자 |
|------|------|------|--------|
| 0.1 | 2026-06-05 | 최초 초안 (기존 인증 인프라 조사 기반) | Claude (PDCA Plan) |
| 1.0 | 2026-06-05 | 공용단말 별도 분리, a11y 별도 처리 반영 | Claude (PDCA Plan) |
| 1.1 | 2026-06-05 | **security-architect 검토 반영** — FR-18~29 추가(SLO·idle timeout 실구현·WebAuthn 정책·signCount·RP ID 고정·수명주기 폐기·복구 다중통제·계정열거 방어·synced passkey·Clinic SSO 부채·챌린지 강화·감사 표준화), 위험 7건 추가, 사전 게이트 G-1(PACS PoC)·G-2(전자서명 법무) 신설, PIA 명문화 | Claude + security-architect |
| 1.2 | 2026-06-05 | **관리자 검증 디바이스 등록 루틴 추가** — FR-30~32(관리자 QR+인증번호 매칭 등록·디바이스 교체/해제·등록세션 보안), StaffDevice 모델·§5.6 플로우, consent-signing-device 페어링 패턴 재사용 | Claude (사용자 요청) |
| 1.3 | 2026-06-05 | **UX 설계 추가** — §5.7 UX 5대 원칙 + 6개 주요 흐름 와이어프레임(로그인/디바이스등록/step-up+인증서/관리/복구/런처), FR-33~37. SMART OAuth2·블록체인서명 재사용 자산 명시 | Claude (사용자 요청) |
| 1.4 | 2026-06-05 | **호출·긴급알림 baseline 추가** — §5.8 + FR-38~42(직원호출·긴급브로드캐스트·Code호출·SSE그룹타게팅·스태프FCM). 기존 Notification/SSE/CriticalValueAlertBanner 재사용. 중요차트는 링크수준(FR-11a) | Claude (사용자 요청) |
| 1.5 | 2026-06-05 | **2차 보안검토(신규영역) + 환자안전 반영** — §5.9 + FR-43~51: 등록 신원증명 등급(대면/원격)·호출 발신 RBAC·alarm fatigue·Code블루 전달보장·FCM 비식별/토큰수명·호출 감사·**Break-glass 응급접근**. §5.2 모순(토큰 URL부착) 수정, 위험 6건·NFR(알림 가용성) 추가, §8.3 테스트전략/운영지표 신설 | Claude + security-architect |
| 1.6 | 2026-06-05 | **정리·보완** — §4 FR 카테고리 인덱스(네비게이션), §10 결정 필요 사항(D-1~D-8), §11 용어집, FR-52(다중 디바이스 정책)·FR-53(데이터 보존/파기), 모바일 경계 명확화(FCM 수신 대상), 헤더 규모 요약·상태 Review | Claude (사용자 요청) |
| 1.7 | 2026-06-05 | **설계 전 사전조사 반영(부록 B)** — G-1 PACS SSO 해소(기존 pacs-proxy+nginx+OHIF로 무수정 동작, 위험 High→Low), SMART OAuth2 재사용 확정(FR-06/07 신규구축 최소화). FR-06~08 보강, D-9(OHIF 토큰전달) 추가, 잔여 게이트는 G-2 법무뿐 | Claude (코드 사전조사) |
