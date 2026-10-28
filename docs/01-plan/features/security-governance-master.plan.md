# 보안 거버넌스 통합 기획서 v1.0 — 인증·인가 / 개인정보·의료정보 보호 / 외부연동 보안

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/src/modules/terminal/daily-pin.guard.ts · apps/api/src/modules/retention/ · apps/api/src/modules/legal-hold/ · 잔여: G4 감사로그 아카이빙/보존(CLI); G5 mTLS/egress allowlist(사람)

> **요약**: 현재 Hospital RUN HIS에 **이미 구현된 보안 자산**(인증/인가·암호화·감사·Webhook HMAC 등)을 3대 영역으로 정리해 **단일 보안 거버넌스 기준선(Security Baseline)** 을 확립하고, 컴플라이언스(개인정보보호법·의료법·위치정보법·EMR인증/JCI)에 매핑한 뒤, 미충족 **갭 7건**을 단계적으로 메우는 통합 기획. 더해 **§6 신규 기능 트랙 — 초고속 사용자 전환 & 제로 트러스트 단말 보안**(공용/전용 단말 세그멘테이션·BLE 근접·안면인식·데일리 PIN·제로배지·이중검증 이탈판별·자정만료 세션·위치정보법 Opt-in)을 포함. 현 자산의 거버넌스화 + 잔여 갭 보강 + 단말 보안 트랙 + 운영 전환 게이트 명문화에 초점.
>
> **프로젝트**: Hospital RUN (한국형 대학병원급 HIS)
> **버전**: v3.15.0 기반
> **작성일**: 2026-06-14 / **버전**: v1.1(design-validator 검토 반영) / **상태**: 기획(Plan) — 현황 조사(코드 grounded) 완료, 갭 보강 설계 대기
> **검토 반영(v1.1)**: FR 표 절번호순 재정렬 · 타임아웃 SoT 통일(§6.7.1) · PIN 평문 적재 금지(§6.5) · 네트워크 페일모드(§6.7.2) · 응급 BTG 예외(§6.7.3) · 멀티세션 PHI 격리(§6.4.1) · 생체정보 컴플(§2) · 안면 liveness · 미해소 6건 추가(§9)
> **우선순위**: P0 (PHI 취급 시스템 — 법적·인증 직결)
> **선행/연계 기획서**:
>   - [performance-security-enhancement](performance-security-enhancement.plan.md) — OWASP Top10 보강(2026-05-28, 일부 항목 이후 구현 완료)
>   - [staff-sso-passwordless](staff-sso-passwordless.plan.md) — 패스워드리스 SSO/WebAuthn(v1.7)
>   - [production-service-integration](production-service-integration.plan.md) — 외부연동 어댑터/토글/게이트(v1.0)
>   - [certification-marks](certification-marks.plan.md) — EMR/JCI 인증 기준

---

## 1. 기획 배경

### 1.1 왜 "통합 거버넌스"인가
HIS는 그동안 기능별로 보안을 견고하게 쌓아왔으나(아래 §3 기준선 참조), **분산된 보안 자산을 하나의 기준선·정책·컴플라이언스 매핑으로 묶은 문서가 없다**. 그 결과:
- 무엇이 이미 보호되는지(예: 주민번호 AES-256-GCM, 감사로그 해시체인+블록체인 앵커링)가 **인증 심사·법무 검토 시 한눈에 제시되지 않음**.
- 신규 모듈 추가 시 **어떤 가드/마스킹/감사를 의무 적용해야 하는지** 규범이 코드 곳곳에 흩어져 있음.
- 운영 전환(시뮬레이션→실연동) 시 보안 활성화 **게이트가 연동별로만 존재**(production-service-integration).

본 기획서는 이를 **3대 영역의 단일 기준선 + 신규 모듈 적용 규범 + 잔여 갭 보강 로드맵**으로 통합한다.

### 1.2 범위 (사용자 지정 3영역)
1. **인증/인가 (AuthN/AuthZ)** — JWT·세션·RBAC·포털가드·WebAuthn·Break-glass·Step-up·Throttling
2. **개인정보/의료정보 보호 (PHI/PII)** — 암호화·마스킹·감사로그·위임열람·보유/파기
3. **외부연동 보안** — Webhook HMAC·OIDC/JWKS·SSRF·mTLS·시크릿 관리·SSO replay 방지
4. **(신규 트랙 §6) 단말 보안 & 초고속 사용자 전환** — 공용/전용 단말 세그멘테이션·근접성 검증·문맥 전환·세션 생명주기 — 위 1·2 영역의 현장 적용 계층

### 1.3 비범위 (Out of Scope)
- 신규 인증 수단 도입(예: 새 IdP) — staff-sso-passwordless 기획서 관할.
- 인프라 계층(WAF·DDoS·네트워크 분리) 신규 구축 — 별도 인프라 로드맵.
- OpenPACS(별도 프로젝트) 내부 보안 — 경계(Webhook/SSO 토큰)만 본 문서 관할.

---

## 2. 컴플라이언스 매핑 (목표 프레임워크)

| 규준 | 핵심 요구 | 본 기획 대응 영역 |
|------|-----------|-------------------|
| **개인정보보호법** | 안전성 확보조치(암호화·접근통제·접근기록 보관·파기) | §3.2 암호화·마스킹·감사 / §4 갭2·갭7 파기·아카이빙 |
| **개인정보 안전성확보조치 기준** | 고유식별정보(주민번호) 암호화, 접속기록 1년 이상 보관·위변조 방지 | 주민번호 AES-256-GCM / 감사 해시체인·블록체인 앵커링 / 갭7 |
| **의료법 §21~23** | 진료기록 열람·교부 제한, 전자의무기록 보존, 접근 추적 | PortalOrPatientGuard·위임열람·AuditInterceptor |
| **위치정보법** | 위치정보 수집·이용 동의, 궤적 비저장, 자기결정권 | §6 단말보안 — BLE 근접검증 Opt-in·동의징구·**궤적 비저장(휘발성)**·Fallback. ※위치정보**사업** 신고/허가 해당여부 §9-7 법무확정 대기 |
| **개보법 §23 민감정보(생체인식)** | 안면·지문 등 생체인식정보 별도 처리근거·동의 | §6.10 온보딩 생체 동의·**온디바이스 처리(서버 미전송)**·§9-9 / 안면 liveness §6.7.3 |
| **EMR 인증/JCI(추가)** | 대리행위 방지·세션 격리·인력 신원(SQE) | §6 단말보안(직군×단말 step-up·멀티세션 PHI 격리) → 환자안전·SQE 입증 강점 |
| **의료법 시행규칙 §15** | 의무기록 보존기간(진료기록 10년, 처방전 2년 등) | **갭1 데이터 보유/파기 정책** (현재 미구현) |
| **EMR 인증(전자의무기록 시스템 인증)** | 접근권한 관리·감사로그·백업·무결성 | RBAC 권한매트릭스·AuditLog·해시체인 |
| **JCI / 환자안전** | 최소권한·Break-the-Glass 통제·감사 | RolesGuard·break-glass(2계층 승인)·필드마스킹 |
| **ISMS-P(지향)** | 위험관리·접근통제·암호·로그·외부자 통제 | 전 영역 + 외부연동 mTLS(갭5)·시크릿회전 |

> 목표: 본 기준선 + 갭 보강 완료 시, 위 규준을 **문서 한 건으로 매핑·입증** 가능.

---

## 3. 현황 기준선 (Security Baseline — 코드 grounded, 2026-06-14)

> ✅구현 / ⚠️부분 / ❌없음. 핵심 파일은 §7 부록.

### 3.1 인증/인가 (AuthN/AuthZ)

| 항목 | 상태 | 근거 |
|------|:----:|------|
| Access Token(JWT, 8h) + Bearer 검증 | ✅ | `auth.service.ts`, `jwt.strategy.ts` |
| Refresh Token(7d, Redis, **토큰 회전·재사용 도난감지**) | ✅ | `auth.service.ts` (refresh:used 세트) |
| 동시세션 제한(최대 3) + Idle Timeout(역할별 30/60분) | ⚠️ 동시세션 ✅ · **유휴 만료 사실상 미동작**(2026-09-28 재현 — 아래 G7 정정) | `auth.service.ts`, `jwt.strategy.ts` |
| RBAC 9역할(ADMIN/DOCTOR/NURSE/PHARMACIST/LAB_TECH/CRM_*/READ/EXECUTIVE) | ✅ | `permission.types.ts` |
| RolesGuard + 30+ 권한매트릭스(CRED_*/PACS_*/PATIENT_*/BILLING_*) | ✅ | `roles.guard.ts`, `permission.types.ts` |
| PortalOrPatientGuard(앱/포털/보호자위임 3-way) + 섹션별 scope | ✅ | `portal-or-patient.guard.ts` |
| WebAuthn/패스키(등록·인증·signCount 역행감지·기기 최대3) | ✅ | `passkey.service.ts` |
| Step-up 재인증(action/resourceId/bodyHash 토큰 바인딩) | ✅ | `step-up.service.ts` |
| Break-glass(SUPERVISOR 1인 또는 TWO_PERSON 2인 승인·시간제한·감시알림) | ✅ | `break-glass.service.ts` |
| 비밀번호 정책(12자·복잡도·90일 만료·brute force 잠금) | ✅ | `auth.service.ts` |
| Throttling(조회600/쓰기120/인증100/민감30 per분, 전역) | ✅ | `app.module.ts` |
| HttpOnly 쿠키 토큰 저장 | ⚠️→✅ | **refreshToken·his_sso는 httpOnly+secure(prod)+sameSite+path scope 쿠키**(auth.controller). access만 Bearer(localStorage). 정정: 단순 Bearer 단독 아님 |

### 3.2 개인정보/의료정보 보호 (PHI/PII)

| 항목 | 상태 | 근거 |
|------|:----:|------|
| AES-256-GCM 암호화(IV/authTag/ciphertext, scrypt KDF, ENCRYPTION_KEY 필수) | ✅ | `encryption.service.ts` |
| 주민번호/민감연락처 암호화 저장 | ✅ | (필드 단위 적용) |
| FieldMaskInterceptor(역할별 주민번호 마스킹·assessment/plan 제외) | ✅ | `field-mask.interceptor.ts` |
| AuditLog(user/action/resource/changes/ip/ua) + 전역 AuditInterceptor | ✅ | `audit.service.ts`, `audit.interceptor.ts` |
| PHI READ 감시(/patients·/encounters·/lab·/medical-records GET 기록) | ✅ | `audit.interceptor.ts` |
| 감사 무결성(SHA-256 prevHash 체인 + 블록체인 Merkle 앵커링 + verifyIntegrity) | ✅ | `audit.service.ts` |
| 보호자 위임열람(PatientGuardian·범위선택·승인/만료·GUARDIAN_* 감사) | ✅ | `portal.service.ts` |
| 위임 BTG(응급 24h·billing/documents/sensitive 제외) | ✅ | `portal.service.ts` |
| **암호화 필드 자동 적용(Prisma 미들웨어/@encrypted 메타)** | ⚠️ | 수동 적용 — 누락 위험 |
| **데이터 보유기간/파기 정책 코드** | ❌ | 미구현 (법정 보존·접속기록 보관 직결) |
| **감사로그 장기 아카이빙(S3/콜드)** | ⚠️ | 블록체인 앵커링만, TTL/아카이브 미정 |

### 3.3 외부연동 보안

| 항목 | 상태 | 근거 |
|------|:----:|------|
| rawBody + Webhook HMAC-SHA256 + timingSafeEqual | ✅ | `main.ts`, `sign-integration.service.ts` |
| Webhook 시크릿 **무중단 회전**(현재/이전 dual-secret 수용) | ✅ | `sign-integration.service.ts` |
| Webhook eventId 멱등(1회 소비) | ✅ | `sign-integration.service.ts` |
| sign OIDC: JWKS(RS256 공개키)·staff-token(aud=sign·10분·cert_serial) | ✅ | `sign-integration.service.ts` |
| SMART on FHIR OAuth2(client_credentials·scope·PKCE S256·patient 바인딩 IDOR차단) | ✅ | `smart-auth.service.ts` |
| ERP SSO(aud=erp-sso·**jti replay 방지**·60초·SLO 일괄무효화) | ✅ | `auth.service.ts`, `sso-idp.service.ts` |
| 내부 SSO(OHIF/PACS/Jitsi/Clinic·60초·경로A URL/경로B redemption) | ✅ | `sso-idp.service.ts` |
| config-runtime 시크릿 슬롯(값 미노출·configured 여부만·키쌍 lazy) | ✅ | `config-runtime.service.ts` |
| Helmet + CSP(default/script/style/font/img/connect/frame/object-src) | ✅ | `main.ts` |
| ValidationPipe(whitelist) + SanitizePipe(XSS) | ✅ | `main.ts`, `sanitize.pipe.ts` |
| **SSRF 방지(외부 URL IP/포트 화이트리스트 검증)** | ❌ | 미구현 (Webhook/AI/sign/ERP 호출부) |
| **mTLS / egress 통제** | ❌ | 미구현 (sign·NHIS·ERP 운영 전환 시 필요) |
| ValidationPipe `forbidNonWhitelisted` | ⚠️ | 현재 false — 미선언 필드 strip만(거부 아님) |

---

## 4. 갭 분석 & 보강 계획 (Gap → Phase)

> 기준선이 견고하므로 본 기획의 실질 작업은 **잔여 갭 7건 + 거버넌스 규범화**다. 영향/난이도/법적가중치로 우선순위화.

| # | 갭 | 영역 | 위험/근거 | 우선 | Phase |
|---|----|------|-----------|:----:|:----:|
| G1 | **데이터 보유기간·파기 정책** ✅프레임워크 | PHI | RetentionPolicy+DRY-RUN+3중 게이트(커밋 2e9c1ea6). 실파기는 법무 보존기간 확정(§9-1)·전역 활성 후 — 데이터손실 0 | P0 | S1 |
| G2 | **SSRF 방지 유틸** ✅해소 | 외부연동 | safeFetch/assertEgressUrl + FHIR 호출 4곳 적용·E2E(커밋 32b88fff). config-runtime URL 검증은 P2 잔여 | P0 | S1 |
| G3 | **암호화 필드 자동화** ✅헬퍼 | PHI | 멱등 field-encryption 헬퍼+레지스트리(커밋 6705aa36). 전역 미들웨어 자동화는 필드별 백필 게이트(이중암호화 회피) | P1 | S2 |
| G4 | **감사로그 아카이빙/보존정책** | PHI | 접속기록 법정 보관(1년+)·장기 비용 | P1 | S2 |
| G5 | **mTLS / egress allowlist** | 외부연동 | 운영 실연동(sign/NHIS/ERP) 신뢰경로 | P1 | S2(게이트) |
| G6 | **4-eyes 승인 일반화** ✅해소 | AuthN/Z | ApprovalService(기존 엔진) ApprovalAction 확장·retention purge에 4-eyes 적용(커밋 a9de44ef) | P2 | S3 |
| G7 | **쿠키/세션 정책 명문화** ✅검증 | AuthN/Z | 코드 검증 완료(이미 준수): refreshToken httpOnly·secure(prod NODE_ENV)·sameSite=strict·path=/api/v1/auth·7d / his_sso httpOnly·secure·sameSite=lax·/erp·60s / idle timeout 30·60분(jwt.strategy). ~~코드 갭 없음~~ 🔴 **정정(2026-09-28)**: 유휴 만료는 설정만 있고 사실상 동작하지 않는다 — idle 키 TTL 이 `ttl+60` 초라 판정은 30~31분 사이 60초 창에서만 걸리고, 걸리면 키를 지워 다음 요청이 통과하며, 31분을 넘기면 키가 이미 없어 그냥 통과한다. 6월 기획 `staff-sso-passwordless.plan.md` FR-19 가 이미 "dead code"로 적어 두었는데 이 표는 ✅ 였다(같은 사실에 문서 둘). 켜면 전 클라이언트에 강제 로그아웃이 생기므로 사람 결정 대기 | P2 | S3 |

### Phase S1 — 법적·즉시(P0)
- **G1 데이터 보유/파기**:
  - `RetentionPolicy`(모델 또는 config) — 리소스별 보존기간(진료기록 10년·처방 2년·접속기록 1년+·임시계정 N일·동의서 등).
  - 파기 배치(`retention.cron`) — 만료 대상 **소프트삭제→하드파기** 2단계, 파기 이력 감사기록. PHI는 익명화/완전삭제 구분.
  - ⚠️ **삭제 비파괴 원칙**: 법정 보존기간 내 데이터는 절대 조기 파기 금지(클램프). 운영 적용 전 DRY-RUN 리포트.
- **G2 SSRF 방지**:
  - `safeFetch`/`assertEgressUrl` 공용 유틸 — 외부 호출 전 호스트 화이트리스트·사설 IP(10/172.16/192.168/127/169.254/::1) 차단·리다이렉트 검증.
  - 적용지점: sign webhook 송신·AI 서버 호출·NHIS 프록시(callNhis/callPatriot)·ERP webhook·PACS 프록시.

### Phase S2 — 보강(P1)
- **G3 암호화 자동화**: Prisma 미들웨어 또는 `@Encrypted` 메타 + DTO 직렬화 훅으로 지정 필드 자동 암복호. 기존 수동 호출과 병행 → 점진 이관(비파괴).
- **G4 감사 아카이빙**: AuditLog TTL/파티셔닝 + 콜드 스토리지(예: S3) 이관 배치. 블록체인 앵커는 유지(무결성 증빙). 접속기록 최소 보관기간 보장.
- **G5 mTLS/egress(게이트)**: config-runtime에 클라이언트 인증서 슬롯 + egress allowlist. **활성화는 외부측(sign/NHIS/ERP) 운영급 후** — production-service-integration 게이트와 연동. **HSM 키 자료는 HIS 클라우드 비보유**(§6.0-1 키 최소화) → 서명코어 HSM은 외부 sign 위임, HIS는 공개키 검증·mTLS 클라이언트 인증서만.

### Phase S3 — 표준화(P2)
- **G6 4-eyes 일반화**: 기존 break-glass TWO_PERSON·AdminApproval(CRED_*) 패턴을 `@RequireDualApproval` 데코레이터로 추상화 → 고위험 설정(시크릿 회전·권한 부여·대량 파기)에 일관 적용.
- **G7 쿠키/세션 정책**: HttpOnly/Secure/SameSite=Strict 정책 문서화 + main.ts 쿠키 옵션 명시·검증 테스트. (Bearer 유지하되 정책 명문화)

---

## 5. 신규 모듈 적용 규범 (거버넌스 — 코드 변경 무 / 규범 문서)

> 신규 컨트롤러/모듈 추가 시 **의무 체크리스트**. 본 기준선을 "기본값"으로 강제.

1. **인증 가드 필수**: staff EP → `JwtAuthGuard`+`RolesGuard`(또는 `@RequirePermission`). portal EP → `PortalOrPatientGuard`(staff 가드 사용 금지 — 401). 공개 EP는 `@Public`+`SkipThrottle` 명시.
2. **PHI 응답**: 환자 민감필드 노출 시 `FieldMaskInterceptor` 적용 역할 확인. 주민번호 등 고유식별정보는 마스킹 기본.
3. **감사**: PHI READ/쓰기 EP는 AuditInterceptor 경로 패턴에 포함(누락 시 명시 추가).
4. **저장 암호화**: 신규 고유식별정보 필드는 암호화 대상 등록(G3 자동화 전까지 수동 호출 필수).
5. **외부 호출**: 외부 URL 호출 시 `safeFetch`(G2) 경유. 시크릿은 config-runtime 슬롯만(repo·env 평문 금지).
6. **Webhook 수신**: HMAC + timingSafeEqual + eventId 멱등 + rawBody. 공개 컨트롤러 분리.
7. **운영 전환**: 시뮬레이션 토글·게이트(production-service-integration) 준수 — 가짜→실데이터 오인 방지.

---

## 6. 신규 기능 트랙 — 초고속 사용자 전환 & 제로 트러스트 단말 보안

> 📐 **설계서**: [terminal-zero-trust.design.md](../../02-design/features/terminal-zero-trust.design.md) v1.0 — 데이터모델(TerminalRegistry·StaffConsent)·API·프로파일 결정 로직·상태머신·재사용 매핑·Phase(D1~D6, D1~D4 게이트무관 즉시개발).

> **목적**: 의료기관 내 **멀티 유저 공유 단말**(간호 스테이션·전공의 의국·회진 태블릿)과 **1:1 전용 단말**(교수 진료실)에서 **대리 처방 방지·의료사고 차단·초고속 문맥 전환(<0.5초)·개인정보/위치정보법 준수**를 동시 달성. 기존 staff-sso-passwordless(WebAuthn·step-up)·passkey.service·auth(세션/Redis)·audit(블록체인 앵커링) 자산을 **재활용·확장**하는 신규 트랙.
>
> **스택 매핑**: 원 사양서는 stack-agnostic(Python FastAPI 예시) 작성 — HospitalRUN 실제 스택으로 매핑: **백엔드=NestJS(@Module)** · **인메모리/세션=Redis(기존 RedisService)** · **프론트=Next.js + Zustand 세션풀** · **감사=AuditService(해시체인+블록체인)**. (Python/FastAPI 표현은 NestJS 등가로 해석)

### 6.0 신뢰 모델 & 운영 원칙 (Trust Model — 설계 기준)

> 본 트랙 전체를 지배하는 4대 신뢰 원칙. 모든 하위 절(6.1~6.11)은 이 원칙을 따른다.

1. **HSM/키 자료 클라우드 최소화 (Key Minimization)**
   - 생체·서명 **개인키 등 민감 키 자료는 단말 보안영역(Secure Enclave/TPM)·온디바이스**에 보관. **클라우드/서버는 공개키·검증자료·최소 시크릿(config-runtime 슬롯)만** 보유.
   - **HSM 의존(서명코어·PAdES/TSA)은 외부 sign 서비스로 위임**(§5·G5 게이트) — HIS 클라우드는 HSM 키를 **직접 보유하지 않음**. 클라우드 키 표면(attack surface) 최소화.
   - config-runtime 시크릿도 최소 슬롯·값 미노출·무중단 회전(기존 dual-secret) 유지.
2. **블록체인 인증 기준 운영 (Blockchain-anchored Trust)**
   - 인증·서명·세션전환·현장 오버라이드·감사의 **무결성 기준점(Root of Trust)을 블록체인 앵커링**(기존 AuditService 해시체인+Merkle 앵커)으로 **단일화**.
   - **주요 보안 이벤트**(출근 PIN 발급·승인·세션 전환·잠금/복귀·고위험 step-up·Kill-Switch·현장 오버라이드·BTG 우회)는 해시체인+블록체인에 적재 → **사후 부인방지(non-repudiation)**. "블록체인 인증을 기준으로 서비스가 운영" = 신뢰의 루트가 블록체인 무결성 증빙에 고정. (적재 시 PIN 등 비밀은 §6.5 평문 금지 규정 준수)
3. **개인 생체인증 포털 = 인증코드 발급 원천 (Portal-issued Codes)**
   - 데일리 PIN·일회성 인증코드는 **개인 스탭 생체인증 포털(ESS) 내 생체(FIDO) 인증된 세션에서만 생성**. 서버가 임의 발급하지 않음 → **본인 생체 확인 후 본인이 생성·소유**.
   - 발급 프로세스는 staff-onboarding-ess(생체 로그인)·staff-sso-passwordless(패스키) 자산 위에서 운용 → 별도 채널 불요.
4. **자연스러운 일상 흐름 (Frictionless Daily Ritual)**
   - 출근 = **포털 생체 한 번 → PIN 생성·승인 → 종일 빠른 전환**. 마찰 최소화가 보안 채택률을 좌우 → 절차는 1동작(생체)에 수렴, 추가 입력은 PIN 6자리 설정뿐.

### 6.1 단말 세그멘테이션 & 자동 판별 (Terminal Segmentation)

- **단말 자산 레지스트리**: `TerminalRegistry`(신규 모델) — 단말별 `deviceUuid`(X-Device-UUID 헤더)·고정 IP·MAC·`mode`(PUBLIC/PRIVATE)·`dedicatedUserId`(전용 시)·소속(스테이션/진료실). 기존 PatientLocation/자산 패턴 참조.
- **런타임 프로파일 동적 바인딩**: 클라이언트 최초 접속 시 `X-Device-UUID`/IP를 레지스트리와 대조 → `SystemContext`를 `PUBLIC_MODE` | `PRIVATE_MODE`로 런타임 할당, 프론트로 보안 프로파일 하향.
  - **PUBLIC_MODE**(공용): BLE RSSI 근접 이탈감지 + GNB 멀티세션 탭(Multi-Session Pool) + 데일리 PIN 빠른전환 모달 **필수 가동**.
  - **PRIVATE_MODE**(전용): 전면 카메라 AI 안면인식(Face Engagement Tracking) 단독 — 멀티세션 풀 UI 비활성 가능. **안면 단독 해제는 liveness(사진·영상 스푸핑 방어) 통과 시만**, 오인식 대비 **고위험 화면은 안면+step-up**(§6.7.3). 처리는 온디바이스(§6.10-1).

#### 6.1.1 직군 × 단말 교차 매트릭스 (의료진 / 스탭)

> 단말 유형(공용/전용)과 **사용 직군(의료진/스탭)**은 **독립 축**이다. `TerminalRegistry.mode`(장소·하드웨어)와 로그인 사용자의 `UserRole`(직군)을 **조합**해 보안 프로파일을 최종 확정한다. 단말은 "어디서"를, 직군은 "누가/무엇을"을 결정.

| 시나리오 | 단말 mode | 대표 장소 | 사용 직군 | 보안 프로파일 |
|----------|:--------:|-----------|-----------|---------------|
| **A. 공용 — 의료진** | PUBLIC | 간호 스테이션·전공의 의국·응급실 | DOCTOR/NURSE 다수 교대 | BLE 근접 + 멀티세션풀 + 데일리 PIN + **고위험(처방·서명·마약류)은 FIDO step-up 필수** |
| **B. 공용 — 스탭** | PUBLIC | 원무·접수·행정 공용 데스크 | RECEPTIONIST/CRM 등 | BLE 근접 + 멀티세션풀 + 데일리 PIN + **임상기능 비노출(ESS/행정 only)** |
| **C. 전용 — 의료진** | PRIVATE | 교수 진료실·단독 검실(iMac) | 단일 DOCTOR 독점 | 안면인식(Face Tracking) 단독 + 멀티세션풀 비활성 + **고위험 step-up 유지** |
| **D. 전용 — 스탭** | PRIVATE | 행정실 단독 PC·인사/원무 개인석 | 단일 스탭 독점 | 안면인식 또는 미입력 타임아웃(§6.7.1 전용 10분) + 멀티세션풀 비활성 + **본인 self-scope 행정만** |

- **직군 차등 원칙**:
  - **의료진**(DOCTOR/NURSE/PHARMACIST): 처방·전자서명·마약류·검사오더 등 **고위험 행위 = 단말 무관 step-up(FIDO/생체) 필수**(기존 step-up.service 재활용). 공용 단말에서는 PIN 전환만으로 고위험 행위 불가 → 그 자리 생체 재확인.
  - **스탭**(RECEPTIONIST/CRM_*/행정): ESS·원무·행정 기능 중심, **임상기능은 RBAC로 원천 비노출**(§6.3 GNB에서도 미표시). 고위험은 인사수정·증명발급·정산 등 → step-up.
- **전담 유저(dedicatedUserId) 의미 차등**: 전용 단말의 `dedicatedUserId`는 **기본 활성 세션**일 뿐, 타 직원 로그인을 물리 차단하지 않음(공용 전환 가능). 단, **전용 단말에서 비전담 유저 로그인 시 감사 경고(AuditService) + 관리자 알림**.
- **확정 로직**: `effectiveProfile = f(TerminalRegistry.mode, user.role)` — 단말이 PRIVATE라도 비전담 의료진이 로그인하면 step-up 정책은 직군 기준 적용. 단말 mode는 **UI 동작(멀티세션풀/안면)**, 직군 role은 **기능 노출·step-up 강도**를 지배.

### 6.2 현장 단말 제어 & 관리자 오버라이드 (On-site Override)

- **현장 인증 게이트**(중앙 콘솔 불요, 보안담당자 물리 현장 방문):
  - PC/Mac: 잠금화면 우하단 또는 단축키(`Ctrl+Shift+A`)로 보안담당자 전용 현장 인증창.
  - 모바일/태블릿: 유동 IP 리스크 방어 위해 `X-Device-UUID` 기준 통제 + 특수 물리키 조합 또는 **관리자 일회성 마스터 QR** 스캔으로 설정 팝업.
- **런타임 강제 동기화(Cache Eviction)**: 모드 전환·전담 유저 변경 저장 즉시 → NestJS가 DB 단말속성 업데이트 + **해당 기기 Redis 캐시 강제 휘발(evict)**. Next.js는 새로고침 없이 프로파일 재fetch → 안면인식/BLE 멀티세션풀 컴포넌트 실시간 교체 렌더. **모든 오버라이드는 AuditService(블록체인 앵커링)에 실시간 적재**.

### 6.3 프론트엔드 UI/UX (Next.js)

- **상단 GNB**:
  - **액티브 유저 배지**: 화면 주권 의료인 이름·과 강조 상시노출(`● [외래진료] 김닥터 교수 (내과)`) — 공용 단말 의료진 오인 차단.
  - **세션 대기 리스트 탭**: 당일 인증 후 백그라운드 대기 세션풀 나열(`[이간호 RN]` `[박전공 MD]`) → 클릭 시 무새로고침 데일리 PIN 팝업 분기.
- **이중 게이트 잠금화면(Double-Gate Lock, `z-index:50`)**: 물리적 이탈(BLE/안면 상실) 또는 명시적 전환 시 전체 덮음.
  - 좌: 기존 액티브 유저 복귀 — 6자리 데일리 PIN 대형 패드.
  - 우: 명시적 빠른전환 — 메모리 잔존 대기 의료진 타일 + `[+ 신규 사용자 로그인]`(FIDO 스마트폰 최초 인증 연동).

### 6.4 고속 세션 & 데이터 유실 방어 (NestJS + Redis)

- **Zero-Reload 문맥 전환**: `window.location.reload()` **엄격 금지**. Zustand 다중 유저 세션풀 유지 + `activeUserId`만 교체, 백엔드는 HTTP 헤더 토큰 체인만 교체 → **전환 <0.5초** 인메모리 아키텍처.
- **자각 없는 원자적 임시저장(Atomic Draft Caching)**: 사용자 전환·BLE 이탈·잠금 동시에, 작성 중 차트 Snapshot을 **RDBMS 아닌 Redis `draft:{userId}`로 원자적 동기화** → 교대 중 처방/진료 데이터 유실 전면 방어. (기존 chart draft 패턴과 정합)

#### 6.4.1 멀티세션풀 PHI 격리·소거 (공용 단말 핵심 노출 벡터)

> ⚠️ 공용 단말 브라우저 메모리·Redis에 **복수 의료진의 PHI(차트 draft)가 동시 상주** → 세션풀이 "유지"되는 만큼 노출 표면 증가. 의료 HIS 공용단말의 최대 PHI 위험.

1. **비활성 세션 PHI 메모리 소거**: Zustand 세션풀은 **인증 컨텍스트(토큰·activeUserId·표시메타)만 유지**, **비활성(화면 주권 없는) 세션의 PHI 본문(차트·검사·환자상세)은 메모리에서 제거/마스킹**. 전환 시 이전 사용자 PHI가 DOM·메모리에 잔존 금지(devtools·화면캡처 노출 차단).
2. **`draft:{userId}` 보호**: Redis draft는 **암호화 저장(§3.2 encryption.service) + 짧은 TTL(세션·자정 만료 연동) + 전환/잠금 시 평문 비잔존**. draft는 소유자(userId) 외 접근 불가(가드).
3. **렌더 차단**: 멀티세션풀에서 비활성 세션 타일은 **이름·과 등 최소 식별정보만**(PHI 미표시). 백그라운드 탭 PHI 프리렌더 금지.

### 6.5 당일 임시 PIN 체계 (Daily PIN) — 포털 발급·생체 승인

- **발급 원천 = 개인 생체인증 포털(§6.0-3)**: PIN은 서버 임의 발급이 아니라 **개인 스탭 생체인증 포털(ESS)에서 본인 생체(FIDO/패스키) 인증 후 본인이 생성**. 발급·승인 단일 동작에 수렴.
- **출근 일상 흐름(자연스러움, §6.0-4)**:
  ```
  출근 → 포털 접속 → 생체 1회(FIDO/패스키) → [6자리 PIN 생성] →
    실시간 유일성 검증(통과) → 생체 서명으로 '승인'(발급 봉인) → 종일 빠른 전환 사용
  ```
  - **승인(Approve) = 생체 서명**: PIN 생성 직후 그 자리 생체(FIDO)로 **발급 자체를 서명·봉인** → 블록체인 앵커링(§6.0-2)에 `daily_pin.issued` 적재. 별도 관리자 승인 불요(셀프, 무마찰). 단, **고위험 직군(의료진) 마약류/처방 행위는 PIN과 별개로 행위 시점 step-up**(§6.1.1).
- **6자리 강제**(000000~999999): 생일역설 충돌확률 최소화 — 4자리 전면 금지.
- **실시간 유일성 검증**: PIN 생성 시 Redis Set(`daily_active_pins`) 조회로 실시간 중복검사, 충돌 시 재생성 가이드.
- **다중 키 복합 검증**: 공용 단말 PIN 검증은 PIN 단독 금지 → 반드시 **`[단말 IP/UUID] + [선택 유저 사번] + [입력 PIN]` 복합 컨텍스트**로 세션 매칭(보안 오염 차단).
- **PIN의 역할 경계**: PIN은 **공용 단말 빠른 전환(저위험 컨텍스트 복귀)용 편의 수단** — 1차 신원은 아침 생체(포털)·세션 풀에 이미 확립. PIN 단독으로 신규 로그인·고위험 행위 불가(생체/FIDO 필수). 자정 만료(§6.8)와 연동.
- **통제축 분리(셀프 vs 관리자)**: **PIN 발급·승인은 본인 셀프**(생체)이되, **단말 등록·모드 전환·현장 오버라이드는 §6.2 관리자(보안담당자) 권한** — 별개 통제축. 본인은 자기 인증코드만 생성, 단말 속성은 관리자만 변경.
- **🔒 PIN 비밀 보관(필수, §6.0-2 정합)**: PIN은 **감사로그·블록체인 앵커·`changes`/`body`에 평문·복원가능 형태 적재 절대 금지**. 적재 대상은 **발급 사실(`daily_pin.issued` 이벤트 메타)만**, 검증은 **salted-hash/HMAC 비교**(Redis 저장도 해시). 6자리(10^6)는 무차별 대입 취약 + 감사로그는 장기보존·불변 적재이므로 평문 유출 시 영구 노출. AuditInterceptor가 무심코 PIN을 `changes`에 기록하지 않도록 **마스킹 필드 등록 필수**(field-mask 패턴).

### 6.6 모바일 제로배지(Zero-Badge) & FIDO 연동

- **Zero-Touch Auth**: 사원증 태깅 배제 → 의료진 스마트폰 '병원 공식 인증 앱'의 **BLE 광고 패킷**을 단말(PC)이 수신해 세션 자동 활성.
- **모바일 2차 인증(FIDO 2.0)**: 고위험 처방/데이터 접근 시 PIN 없이 스마트폰 FIDO(생체) 푸시 승인 — 기본값. (기존 step-up.service 확장)
- **Kill-Switch(분실 격리)**: 스마트폰 분실 시 관리자 콘솔에서 `X-Device-UUID`에 '세션 파기' 명령 → Redis 내 해당 사용자 토큰 즉시 삭제(기존 SLO `revokeAllForUser` 재활용).
- **전력 효율(Background)**: 고정 비콘↔모바일 신호주기 유연 조정 동적 스캔(Dynamic Scanning).

### 6.7 물리적 이탈 판별 — 이중 검증(Dual-Safe)

- **이중 검증 원칙**: 화면 잠금 '이탈 판별'은 단일 지표(Wi-Fi) 의존 금지 → **[BLE RSSI] AND [원내 네트워크 접속]** 논리곱 결합.
- **오작동 가드레일**: BLE 일시 불안정+Wi-Fi 유지 시 즉시잠금 금지(5초 안정화 유예) / Wi-Fi 끊김+BLE 3m이내 강신호 시 라우팅 오류로 간주 잠금 유예.
- **사용자 설정**: 엄격(하나라도 끊기면 잠금) ↔ 유연(둘 다 끊겨야 잠금) 선택 제공.

#### 6.7.1 이탈 잠금 타임아웃 정책 (3계층 — "PC 이탈 시 몇 분?")

> 잠금(Lock)은 **화면 보호 레이어**(§6.3 이중 게이트)이지 로그아웃이 아니다. 3계층을 분리해 오인 방지. **본 표가 타임아웃 단일 기준(SoT)** — 다른 절(§6.1.1-D·§6.9-4·§6.10-3·연계 FR-F7)의 "Fallback 잠금"은 모두 본 표의 ②계층 값을 인용한다.

| 계층 | 트리거 | 단말 유형별 값 | 동작 |
|------|--------|----------------|------|
| **① 근접 이탈(즉시)** | BLE 신호 상실 / 안면(Face) 이탈 | 공용·전용 공통 | **5초 안정화 유예 후 즉시 잠금**(§6.7 가드레일) |
| **② 미입력 Fallback** | BLE 미사용·동의철회 시 키/마우스 무입력 | **공용 3분 / 전용 10분** | 잠금 레이어 가동(데일리 PIN 복귀) |
| **③ 세션 만료(별개)** | 전체 비활동 | 기존 idle(ADMIN/CRM 60분·기타 30분) | **로그아웃**(jwt.strategy 기존) |

- **기본값·조정**: 위 값은 **기본(default)** — `config-runtime` 및 의료인 개인설정(§6.7 엄격/유연)으로 조정 가능. 공용은 PHI 노출·교대 리스크로 **짧게(3분)**, 전용은 진료 중 참조·독점이라 **길게(10분)**.
- **고위험 화면 가중**: 처방·마약류·전자서명 등 고위험 화면 표시 중에는 미입력 타임아웃을 **더 짧게(예: 공용 1분)** 적용하거나 행위 직전 step-up 재요구(§6.1.1 의료진).
- **잠금 ≠ 데이터 유실**: 잠금 가동과 동시에 Atomic Draft(§6.4) 캡처 → 복귀 시 무손실 재개.
- **복귀**: ① 근접 복귀 시 BLE/안면 재확인으로 자동 해제 가능, ② 미입력 잠금은 데일리 PIN(같은 사용자) 또는 빠른 전환(다른 사용자) — §6.3 이중 게이트.

#### 6.7.2 네트워크 단절 · Redis 장애 페일모드 (임상 연속성)

> ⚠️ **충돌 인지**: §6.7 이탈판별이 "[BLE] **AND** [원내 네트워크]"이므로 **네트워크 단절 시 AND 조건상 항상 잠금** → 회진 중 Wi-Fi 음영지역에서 강제 잠금 폭주·차트 작성 중단 위험. CLAUDE.md FR-08(오프라인=비범위, 온라인 운영 전제)이 단말잠금에는 역으로 작용. 의료 안전성 직결 → **페일모드 정책 필수**.

1. **네트워크 단절 grace**: 원내 Wi-Fi 단절 시, **BLE 강신호(3m 이내) 단독 유지되면** 즉시 잠금 금지 — 라우팅 오류로 간주(§6.7 가드레일 확장)하고 **grace-period(기본 미입력 ②계층 타임아웃) 동안 작업 지속** 허용. 그동안 Atomic Draft(§6.4)로 로컬 보존.
2. **Redis 장애**: 세션풀/PIN 검증 백엔드(Redis) 장애 시 **fail-secure vs fail-open 결정** — 권고: **고위험(처방·서명·마약류)=fail-secure**(차단), **저위험 조회=기존 세션 grace 유지**(임상 연속성). 복구 시 draft 동기화·세션 재검증.
3. **로컬 보존·복구**: 단절 중 작성분은 단말 로컬(암호화)+Redis 복구 시 동기화. 네트워크 복귀 후 **세션 재검증(생체/토큰)** 통과해야 확정 저장.
4. ⚠️ **미해소(§9 편입)**: fail-secure/open 최종 결정·grace 길이는 임상부서·보안 공동 확정 필요.

#### 6.7.3 응급 Break-glass ↔ 단말 잠금 예외 경로 (생명 우선)

> ⚠️ **충돌 인지**: 코드블루 등 응급 시 데일리 PIN 미발급자(타과 지원)·BLE 폰 미소지자가 공용단말 접근 시, §6.5(PIN 단독 신규로그인 불가·생체 필수)·미입력 잠금이 **응급 접근을 차단** → BTG(생명 우선)와 zero-trust 단말통제 정면 충돌.

1. **BTG 예외**: §3.1 Break-glass 발동 시 **단말 미입력 타임아웃·PIN 게이트 일시 우회**(응급 접근 경로 개방). 단 **전체 BTG 감사(§3.1)·사후 승인** 필수 — 우회는 기록·시간제한(기존 BTG 30/120분)·사후검토 대상.
2. **우선순위**: 응급 BTG > 단말 잠금. 단 BTG 자체 인증(승인자 권한/2인)은 유지 → "통제 완전 해제"가 아니라 "단말 마찰만 우회".
3. **고위험 행위와의 경계**: BTG 우회 중에도 처방·마약류 서명(§6.1.1 의료진 step-up)은 가능한 범위에서 생체 확인 유지, 불가 시 사후 검증·승인으로 보완.

### 6.8 세션 생명주기 — 자정 만료 & 연속 근무 (Overnight Session)

- **자정 만료(Midnight Expiration)**: 데일리 인증·6자리 PIN 세션은 생성시점 무관 **당일 자정(23:59:59) 또는 출근서명 후 최대 24h** TTL → Redis 자동 소멸.
- **연속 근무 연장(Continuous Session Shift)**: 야간 당직이 자정 통과 시, 차트 저장 API가 `DATE_CHANGED_EXPIRED` 시그널 반환 → Next.js가 데이터 유실 없이 [당일 PIN 재설정·연장] 모달 즉시 렌더 → 새 PIN 입력 시 무새로고침 익일 자정까지 연장.
- **장기 미퇴근 격리**: 퇴근서명 누락 방치 단말은 새벽 일괄 스케줄러(Cron) + Redis TTL로 원천 무효화 → **무조건 [최초 스마트폰 FIDO 출근 인증]으로 강제 복귀(Fallback)**.
- **미퇴근 근태 무결성 해소(필수)**: 출근 PIN을 출퇴근(`ess.clock`)에 통합하므로 **CLOCK_IN만 있고 CLOCK_OUT 없는 상태**를 반드시 해소. **`lastActiveAt`로 3경우 판별** — ① 연속근무(활동 지속)=정상 연장, ② 미퇴근 방치(무활동)=보안 무효화 + **추정 퇴근(provisional CLOCK_OUT, 마지막 활동시각)** 생성 후 기존 ESS **근태정정(부서장 승인)** 으로 확정, ③ 강제복귀 후 재출근=중복 CLOCK_IN 방지. ⚠️ **추정 퇴근은 급여 확정 입력 아님**(provisional 클램프, 본인 확인·승인 후 확정 — 근로기준법). ERP webhook은 provisional 마킹. (설계 §5.3)

### 6.9 법적 리스크 회피 — 위치정보법·개보법 (필수 정책)

> 🚧 **시행 게이트**: §6.9 BLE 근접·위치 기능은 **위치정보법 신고의무 법무확정(§9-7)·노사 의결(§9-8) 전까지 게이트-잠금**(구현 대기). 이 게이트 해제 전에는 Fallback(§6.7.1)만 가동.

1. **자기결정권 Opt-in**: BLE RSSI 근접잠금·위치인식은 전체 강제 금지 → 의료인 환경설정 **'선택 옵션(Opt-in)'**.
2. **동의서 연동**: 스마트폰/웨어러블 연동 토글 ON 시점에 [위치정보법 표준 동의서] 팝업 강제·명시적 서명 징구.
3. **궤적 저장 금지**: 의료인 위치 이동 궤적(Track Log) **DB 절대 비적재** — '근접성 검증' 목적 **실시간 휘발성 데이터로만** 처리.
4. **보안 Fallback**: BLE 비활성/동의철회 시 통제 중단 금지 → **'미입력 타임아웃 잠금(§6.7.1 ②계층: 공용 3분/전용 10분)'** 또는 **'카메라 안면 매핑'**으로 즉시 대체 가동(물리 공백 방지).
5. **절차적 정당성**: 전면 도입 전 **병원 노사협의회 정식 안건 상정** → 근로자대표 공식 의결('면허·환자정보 보호 안전장치') 후 시행.

### 6.10 신규 입사자 온보딩 동의 편입 (전 직원 — 스탭·의료진 공통)

> **핵심**: §6.9의 위치정보·안면인식(생체정보) 동의는 **개인 토글 시점의 일회성 팝업에 그치지 않고**, **신규 입사자 온보딩 절차의 표준 동의 항목으로 편입**한다. 대상은 **스탭(행정직)·의료진 전원**. 연계 기획: [staff-onboarding-ess](staff-onboarding-ess.plan.md)(신규입사자관리·생체등록·4-eyes 활성화).

1. **온보딩 동의 패키지**: 입사 절차(임시계정 PRE_BOARD → 생체등록 → 4-eyes 승인 활성화) 내 **[단말 보안 동의 단계]** 신설. 항목:
   - **위치정보 수집·이용 동의**(위치정보법 표준) — BLE 근접성 검증 목적·궤적 비저장 고지.
   - **생체인식정보(안면) 처리 동의**(개보법) — PRIVATE 단말 Face Engagement·**온디바이스 처리(서버 미전송)** 고지.
   - **WebAuthn/패스키 등록 동의** — 기존 온보딩 생체등록과 통합.
2. **동의 영속·증빙**: 동의는 ConsentForm/IssuedDocument 패턴으로 서명·봉인(SHA-256) + AuditService 적재. 입사자별 `staffConsent.{location,biometric,passkey}` 상태 보관 → 단말 기능 활성 전 **동의 게이트 검증**.
3. **미동의·철회 처리**: 온보딩에서 위치/안면 동의를 거부해도 입사·계정활성은 진행(분리) → 해당자는 §6.9-4 **Fallback(미입력 타임아웃 잠금, §6.7.1 ②계층)** 로 자동 대체. 철회는 ESS(행정 셀프서비스)에서 언제든 가능, 철회 즉시 BLE/안면 비활성·Fallback 전환.
4. **재직 중 정책 변경**: 신규 도입·약관 개정 시 **기존 재직자도 ESS를 통해 동의 갱신** 징구(온보딩과 동일 항목·증빙). 노사 의결(§6.9-5) 후 일괄 안내.
5. **역할 무관 공통 적용**: 의료진(처방·서명 고위험)·스탭(행정) 모두 동일 동의 절차 — 단, 단말 기능 활성 범위는 RBAC·단말 모드(PUBLIC/PRIVATE)에 따라 차등.

### 6.11 스탭 생체인증 포털 플랫폼 — 전용 앱(운영) / 웹(개발 중)

> **결정**: 인증코드(데일리 PIN) 발급 원천인 **개인 스탭 생체인증 포털(§6.0-3)은 운영 시 전용 앱(네이티브)으로 운용**한다. **웹은 개발 중에만** 한시적으로 사용.

1. **운영 = 전용 앱(Native)**: 의료진·스탭 개인 스마트폰의 **'병원 공식 인증 앱'**(기존 mobile=Expo SDK 56 확장)이 생체인증 포털 본체. 이유:
   - **키 자료 온디바이스 보관(§6.0-1)**: 패스키·생체키를 단말 Secure Enclave/TPM에 격리 — 네이티브 앱이라야 안전 보관·접근.
   - **BLE 광고/근접(§6.6·6.7)**: Zero-Badge BLE 패킷 방출·백그라운드 스캔은 **네이티브 권한** 필수(웹 불가).
   - **FIDO 푸시·Kill-Switch**: 고위험 step-up 푸시·분실 격리(§6.6)는 앱 채널.
2. **개발 중 = 웹(한시)**: 비콘/앱 배포 전 개발·검증 단계에서는 **웹 포털로 PIN 생성·생체(WebAuthn) 흐름을 시뮬레이션**. BLE 근접·푸시는 웹에서 **시뮬레이션 토글**(§5 운영 전환 게이트 패턴)로 대체. ⚠️ 웹 경로는 **운영 비활성**(전용 앱 배포 후 차단) — 시뮬레이션이 실데이터로 처리되지 않도록 production-service-integration 토글 준수.
3. **전환 게이트**: 전용 앱 스토어 배포·MDM 등록·BLE 비콘 인프라 완료 후 `staffPortal.platform=APP`로 전환, 웹 발급 경로 봉쇄. (개발↔운영 동일 인터페이스, 발급부만 격리 — §5 어댑터 원칙)
4. **데스크톱(PC) 측**: PC는 포털이 아니라 **소비자**(세션 수신·잠금 레이어). PC Next.js는 앱이 발급·승인한 세션/PIN을 검증만 — 발급은 항상 개인 앱.

> ⚠️ **영역 정합**: 본 트랙은 §1.3 비범위(신규 IdP)와 구분 — 신규 인증수단이 아니라 **기존 WebAuthn/세션/감사 위에 단말 컨텍스트·근접성 계층을 추가**. step-up·SLO·Redis세션·AuditService 재활용. 본 트랙 도입 시 §5 신규모듈 규범 + §6.9 위치정보 Opt-in 게이트 준수.

---

## 7. 기능 요구사항 (FR) 요약

### 7.1 갭 보강 (§4)

| FR | 내용 | 영역 | Phase |
|----|------|------|:----:|
| FR-S1 | RetentionPolicy 모델·리소스별 보존기간 정의 | PHI | S1 |
| FR-S2 | 파기 cron(2단계·DRY-RUN·감사기록·법정클램프) | PHI | S1 |
| FR-S3 | safeFetch/assertEgressUrl SSRF 차단 유틸 | 외부 | S1 |
| FR-S4 | 외부호출 5지점 safeFetch 적용 | 외부 | S1 |
| FR-S5 | Prisma 암호화 미들웨어/@Encrypted | PHI | S2 |
| FR-S6 | 감사로그 아카이빙 배치·보존정책 | PHI | S2 |
| FR-S7 | config-runtime mTLS 인증서 슬롯·egress allowlist | 외부 | S2 |
| FR-S8 | @RequireDualApproval 데코레이터·고위험 적용 | AuthN/Z | S3 |
| FR-S9 | 쿠키/세션 보안정책 명문화·검증 | AuthN/Z | S3 |
| FR-S10 | 보안 기준선 컴플라이언스 매핑 문서(본 §2~§3) | 거버넌스 | 완료 |

### 7.2 단말 보안 트랙 (§6)

| FR | 내용 | 영역 | 참조 |
|----|------|------|------|
| FR-T0 | **신뢰 모델 원칙**: HSM 키 클라우드 최소화·블록체인 앵커링 Root of Trust·포털 발급 인증코드·무마찰 일상 | 거버넌스 | §6.0 |
| FR-T1 | TerminalRegistry 모델 + X-Device-UUID/IP 대조·SystemContext 동적 바인딩 | 단말 | §6.1 |
| FR-T1b | **직군×단말 교차 프로파일**(공용/전용 × 의료진/스탭 4시나리오)·effectiveProfile=f(mode,role)·전용 비전담 로그인 감사경고 | 단말×직군 | §6.1.1 |
| FR-T2 | 현장 오버라이드(Ctrl+Shift+A / 마스터 QR) + Redis 캐시 evict + 감사 적재 + **Next.js 무새로고침 프로파일 재fetch·컴포넌트 실시간 리렌더** | 단말 | §6.2 |
| FR-T3 | GNB 액티브 배지 + 세션 대기 리스트 탭 + 이중 게이트 잠금화면 | UI | §6.3 |
| FR-T4 | Zero-Reload 문맥전환(Zustand 세션풀·토큰체인 교체·<0.5초) + **비활성 세션 PHI 메모리 소거·격리** | 세션 | §6.4 |
| FR-T5 | Atomic Draft Caching(Redis `draft:{userId}` **암호화·짧은 TTL·전환 시 평문 비잔존**) | 데이터유실 | §6.4 |
| FR-T6 | 데일리 PIN(6자리·유일성 Set·복합컨텍스트 검증) + **포털 생체 발급·생체 승인 봉인·블록체인 적재(PIN 평문/복원가능 형태 금지)** | 인증 | §6.5 |
| FR-T7 | 제로배지 BLE Zero-Touch + FIDO 2차 푸시 + Kill-Switch(SLO재활용) + **동적 스캔(배터리 NFR)** | 모바일 | §6.6 |
| FR-T8 | Dual-Safe 이탈판별(BLE RSSI AND 네트워크·5초유예·사용자설정) | 근접 | §6.7 |
| FR-T8b | **이탈 잠금 타임아웃 3계층(SoT)**(근접 즉시 5초유예 / 미입력 공용3분·전용10분 / 세션 30·60분 로그아웃)·고위험 가중·config | 근접 | §6.7.1 |
| FR-T8c | **네트워크 단절·Redis 장애 페일모드**(BLE 강신호 단독 grace·Atomic Draft 로컬보존·fail-secure/open 결정) | 가용성 | §6.7.2 |
| FR-T8d | **응급 Break-glass 예외 경로**(BTG 발동 시 단말 잠금·PIN 게이트 일시 우회·전체 감사·사후승인) | 응급 | §6.7.3 |
| FR-T9 | 자정 만료 TTL + 연속근무 연장(DATE_CHANGED_EXPIRED) + 미퇴근 Cron 격리 | 세션생명주기 | §6.8 |
| FR-T9b | **미퇴근 근태 무결성 해소**: lastActiveAt 3경우 판별·추정 퇴근(provisional)·ESS 근태정정 연동·중복 CLOCK_IN 방지·ERP provisional 마킹 | 근태 | §6.8·설계§5.3 |
| FR-T10 | 위치정보 Opt-in·동의징구·궤적비저장·Fallback·노사의결 | 법적 | §6.9 |
| FR-T11 | 온보딩 동의 패키지(위치·생체안면·패스키) 편입·전직원(스탭/의료진)·게이트검증·ESS 철회·재직자 갱신 | 온보딩 | §6.10 |
| FR-T12 | **스탭 포털 플랫폼 정책**: 운영=전용 앱(Native·온디바이스 키·BLE·푸시) / 개발중=웹(시뮬레이션·운영 비활성)·`staffPortal.platform` 게이트 | 플랫폼 | §6.11 |

---

## 8. 부록 — 핵심 파일 인용

```
인증/인가
  apps/api/src/modules/auth/auth.service.ts            JWT·세션·토큰회전·비번정책·ERP SSO
  apps/api/src/modules/auth/strategies/jwt.strategy.ts  idle timeout·account stage
  apps/api/src/modules/auth/guards/roles.guard.ts       RBAC
  apps/api/src/modules/auth/rbac/permission.types.ts    권한 매트릭스
  apps/api/src/modules/auth/passkey/passkey.service.ts  WebAuthn
  apps/api/src/modules/auth/step-up/step-up.service.ts  step-up
  apps/api/src/modules/auth/break-glass/break-glass.service.ts
  apps/api/src/modules/auth/sso-idp/sso-idp.service.ts  내부 SSO·SLO
  apps/api/src/modules/patient-auth/guards/portal-or-patient.guard.ts

개인정보/의료정보
  apps/api/src/modules/patient-auth/services/encryption.service.ts  AES-256-GCM
  apps/api/src/common/interceptors/field-mask.interceptor.ts        마스킹
  apps/api/src/modules/audit/audit.service.ts                       감사·해시체인·블록체인
  apps/api/src/modules/audit/audit.interceptor.ts                   PHI 감시
  apps/api/src/modules/portal/portal.service.ts                     위임열람·BTG

외부연동/인프라
  apps/api/src/modules/sign-integration/sign-integration.service.ts Webhook HMAC·OIDC/JWKS
  apps/api/src/modules/smart-auth/smart-auth.service.ts             SMART OAuth2
  apps/api/src/modules/config/config-runtime.service.ts             시크릿 슬롯
  apps/api/src/common/pipes/sanitize.pipe.ts                        XSS
  apps/api/src/main.ts                                              Helmet·CSP·CORS·rawBody
  apps/api/src/app.module.ts                                       Throttler
```

---

## 9. 미해소 / 확인 필요

### 9.1 갭 보강
1. **법정 보존기간 확정**(G1): 의료법 시행규칙 §15 항목별(진료기록부 10년·처방전 2년·검사소견 5년·간호기록 5년·동의서 등) 매핑 — 법무 검토 필요.
2. **파기 vs 익명화 경계**: 통계·연구 목적 비식별 데이터 보존 정책 — 개보법 가명정보 처리와 정합.
3. **mTLS 게이트(G5)**: sign/NHIS/ERP 각 외부측 운영급(인증서 발급체계) 준비 시점 — production-service-integration 게이트와 공동 해제.
4. **HttpOnly 쿠키 전환 여부(G7)**: 현 Bearer 패턴 유지 vs 이중 저장 — XSS 노출면 vs CSRF 면 트레이드오프 결정.
5. **감사 아카이빙 스토리지(G4)**: S3 등 외부 스토리지 가용성 — 인프라 협의.

### 9.2 단말 보안 트랙(§6)
6. **BLE 비콘/스마트폰 앱 인프라**(FR-T7/T8): 고정형 비콘 설치·'병원 공식 인증 앱'(BLE 광고·FIDO 푸시) 가용성 — 모바일앱(Expo) 확장 범위·하드웨어 조달 협의.
7. **위치정보사업 법적 지위**(FR-T10): 위치정보법상 '위치정보 수집' 해당 여부·신고/허가 필요성 — 법무 확정(궤적 비저장·휘발성 처리로 회피 가능성 검토). → **동의 자체는 신규 입사 온보딩 항목으로 편입(FR-T11)**, 법적 지위(신고의무)만 법무 확정 잔여.
8. **노사협의회 의결**(§6.9-5): 도입 전 근로자대표 공식 의결 절차 — 운영/인사 협의. 의결 후 재직자 동의 갱신(FR-T11-4) 일괄 안내.
9. **안면인식 정보 처리**(FR-T1 PRIVATE): 카메라 Face Engagement Tracking이 개보법 '생체인식정보' 처리 해당 — **온보딩 생체 동의(FR-T11)로 징구**, 온디바이스 처리(서버 미전송) 설계 확정 필요.
10. **단말 자산 레지스트리 소스**(FR-T1): TerminalRegistry 초기 데이터(고정 IP/MAC/UUID 매핑) 자산관리 시스템 연계 방식.
11. **온보딩 동의 ↔ 단말 기능 게이트 정합**(FR-T11): staff-onboarding-ess의 PRE_BOARD→활성화 플로우에 [단말 보안 동의 단계] 삽입 위치·동의 미충족 시 Fallback 자동전환 검증 — staff-onboarding-ess 기획서와 정합 필요.
12. **모바일앱(Expo) 팀 — critical path**(FR-T12): §6.11에서 전용 네이티브 앱이 **PIN 발급 SoT(인증 원천)**로 격상 → 앱 스토어 심사·MDM 등록·**iOS BLE 백그라운드 스캔 제약**·푸시 인프라가 별도 합류점·일정 리스크. 모바일앱 팀과 범위·일정 확정.
13. **보안운영(SecOps) 합류점**: §6.2 현장 오버라이드(마스터 QR 보유자)·§6.6 Kill-Switch(분실 격리 콘솔) 운영 주체·절차(분실신고 SLA·마스터 QR 관리)·교대 정의 필요.
14. **네트워크/Redis 페일모드 결정**(FR-T8c, §6.7.2): fail-secure(고위험 차단) vs fail-open(저위험 grace)·grace 길이 — 임상부서·보안 공동 확정.
15. **응급 BTG ↔ 단말 통제 우선순위**(FR-T8d, §6.7.3): BTG 우회 범위·사후승인 SLA — §3.1 Break-glass 정책과 정합.
16. **안면 liveness 기준**(F-5, §6.1·6.7.3): 스푸핑 방어 수준·온디바이스 라이브니스 엔진 선정.
17. **ValidationPipe `forbidNonWhitelisted`**(§3.3 ⚠️): 현재 false(strip만) → 미선언 필드 거부(reject) 전환 여부 — 호환성 영향 평가 후 결정(작지만 입력검증 강화).

> ⚠️ 본 기획은 **기존 보안 자산을 훼손하지 않는다**(비파괴 원칙). 모든 갭 보강은 additive — 기존 가드/암호화/감사 제거·약화 금지.
