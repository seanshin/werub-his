# Clinic SSO 토큰 재설계 — 선택지와 결과 (제안서 · 코드 변경 없음)

- 작성: 2026-10-01
- 상태: **제안서 · 미착수** — 선택지만 적는다. 고르지 않는다(시스템은 권고하지 않는다).
- 출발점: 외부 점검 회신 `docs/04-report/ecosystem-notice-reply-2026-09-21.md` "저희가 찾았지만 이번에 고치지 않은 것"
  — "Clinic SSO 토큰이 URL 쿼리에 실리고 `sid`·`aud` 가 없어 로그아웃으로 끊을 수 없음(재설계 필요)".
  상세는 `docs/04-report/ecosystem-notice-reply-2026-09-21-H-appendix.md` B2(#47-3).
- 선행 기록: `docs/01-plan/integrations/ios-native-app-server-response.md` 5·6 "`/sso?accessToken=` 폐기 — 🔴 보류(외부 계약)"·§5 D16
  ("Clinic 팀 합의 필요 — 일방 폐기하면 그쪽 로그인이 끊긴다").
- 관련 정본: 세션 발급 `apps/api/src/modules/auth/auth.service.ts` `issueSession` · 토큰 검증 `apps/api/src/modules/auth/strategies/jwt.strategy.ts`
  · 내부 IdP `apps/api/src/modules/auth/sso-idp/sso-idp.service.ts`
- 🔴 운영 DB 는 가상 병원 시드이고 이 문서는 운영에 접근하지 않았다. 아래는 **저장소 코드로 확인한 구조**이며,
  실제로 Clinic 이 어느 진입점을 부르는지·운영에서 이 경로가 쓰이는지는 **미확인**이다(§6 질문).
- 🔴 이 문서의 "사람 결정" 표는 정본이 아니다 — 착수 시 `decision.registry` 에 키로 등재하고 그 키를 가리킨다.

---

## 1. 현행 실측 (근거 file:line · HEAD `021b67589` 기준)

### 1.1 흐름 — 진입점이 둘이다

Clinic 이 발급한 SSO 토큰(이하 **Clinic 토큰**)을 HIS 가 받아 Clinic 서버에 검증하고, **HIS 가 자기 JWT 를 새로 발급**한다.

| 단계 | 경로 A — API 랜딩 | 경로 B — 웹 페이지 |
|---|---|---|
| 진입 | `GET /sso?token=<Clinic 토큰>` (API · `sso.controller.ts:82-87`) | `GET /sso?token=<Clinic 토큰>` (Next · `apps/web/src/app/sso/page.tsx:25,35-36`) |
| Clinic 검증 | `clinicApi.verifySsoToken` (`sso.controller.ts:96`) | 페이지가 `POST /api/v1/sso/verify` 본문으로 전달(`page.tsx:60-65`) → `sso.controller.ts:152-163` |
| HIS 발급 | `jwt.sign` access + 7일 토큰(`:107-111`) | 같음(`:175-179`) |
| 전달 | 🔴 **`302 {FRONTEND_URL}/sso?accessToken=<access>&expiresIn=28800`** (`:133-135`) + `refreshToken` 쿠키(`:122-131`) | JSON 본문 `{accessToken, refreshToken, expiresIn}` (`:191-195`) — 🔴 **7일 토큰이 본문에 실린다** |
| 브라우저 저장 | `page.tsx:29-30` Case 1 → `completeAuth` → `sessionStorage`·`apiClient.setToken`(`page.tsx:47-51`) → `localStorage`(`apps/web/src/lib/api-client.ts:22-25`) | 같음(`page.tsx:73-75`) |

- 공개 라우팅(`docs/05-reference/production-operations.md` §1.4-b, 2026-09-14 실측 표): `/api/*`·`/fhir/*`·`/oauth2/*`·`/uploads/*` 만 API(:4000)로 가고
  **그 밖은 Next(:3000)** 다. API 는 전역 접두가 없고(`apps/api/src/main.ts` 에 `setGlobalPrefix` 없음) 랜딩은 `@Get('sso')` 라
  **공개 도메인의 `/sso` 는 경로 B(Next)로 간다**고 읽힌다. 경로 A 가 다른 호스트·내부 경로로 도달 가능한지는 **미확인**(Caddyfile 은 저장소 밖).
- 경로 B 의 `page.tsx:29-32` Case 1 은 **어디서 왔든** URL 의 `accessToken` 을 그대로 세션으로 넣는다(경로 A 의 리다이렉트를 받으려고 둔 분기).

### 1.2 HIS 가 발급하는 토큰

| 항목 | 실측 | 근거 |
|---|---|---|
| 서명 키 | `AUTH_SECRET`(메인 access 와 같은 키) | `clinic-integration.module.ts:18-26` |
| access 수명 | 8시간(모듈 기본 `expiresIn: '8h'`) · 응답에 `28800` 을 손으로 적음 | `clinic-integration.module.ts:24` · `sso.controller.ts:135,195` |
| access 클레임 | `{ sub, email, role }` 뿐 — **`aud`·`sid`·`jti` 없음** | `sso.controller.ts:107,175` |
| "refresh" 토큰 | 같은 페이로드·**같은 `AUTH_SECRET`**·7일 · Redis `refresh:${userId}`(레거시 키) | `sso.controller.ts:109-119,177-187` |
| 비교: 정본 세션 | `aud:'his'`·`sid`·refresh 는 `AUTH_REFRESH_SECRET` · Redis `session:${sid}`·`sessions:${userId}` · 감사 `LOGIN` · `security.session.timeoutMinutes`·동시 세션 상한 적용 | `auth.service.ts:222-284`(서명 `:248-255`, Redis `:258-268`, 상한 `:271`, 감사 `:273`) |

- 🔴 SSO 의 "refresh" 토큰은 `/auth/refresh` 에서 **쓸 수 없다** — 그 EP 는 `AUTH_REFRESH_SECRET` 으로 검증한다(`auth.service.ts:70,300-303`).
  대신 `aud` 가 없고 `AUTH_SECRET` 으로 서명돼 **메인 API Bearer 로 7일간 통과한다**(`jwt.strategy.ts:26-28,45,51` — 무aud 는 레거시 호환으로 통과).
  `jwt.strategy.ts:28` 주석이 이 잔여를 이미 적어 두었다("무aud 내부 토큰(clinic SSO refresh·SMART 등)은 이 단계에선 통과").

### 1.3 로그아웃·폐기가 닿는가

| 끊는 수단 | SSO access(8h) | SSO 7일 토큰 | 근거 |
|---|---|---|---|
| `POST /auth/logout`(그 기기) | ❌ — `sid` 가 없어 세션 검사를 건너뛴다 | ❌ | `jwt.strategy.ts:77-90`(`if (payload.sid)`) |
| 로그아웃의 "전 세션" 분기 | ❌ — `revokeAllTokens` 는 Redis 키만 지우고 토큰 자체를 거부하는 장치가 없다 | ❌ | `auth.service.ts:502-513,411-423` |
| 계정 비활성(`isActive=false`) | ✅ | ✅ | `jwt.strategy.ts:61-63` |
| 역할 변경 | ✅(역할은 DB 에서 다시 읽는다 · 클레임 `role` 은 쓰지 않음) | ✅ | `jwt.strategy.ts:55-59,113-120` |
| 유휴 만료 | 키가 `idle:${userId}` 로 갈리나, 회신 문서가 **유휴 만료가 사실상 작동하지 않음**을 재현으로 적었다(이 문서에서 재실측 안 함) | 같음 | `jwt.strategy.ts:95-110` · 회신 문서 "고치지 않은 것" 첫 항목 |

- 부수 효과: SSO 사용자의 웹 로그아웃은 refresh 쿠키가 없거나(경로 B 는 쿠키를 굽지 않는다) `AUTH_SECRET` 서명이라
  `sid` 를 못 읽는다 → **"sid 불명 → 전 세션 로그아웃" 분기**로 간다(`auth.service.ts:504-513`). 같은 사람이 다른 기기에서
  정본 로그인한 세션은 끊기고, **정작 SSO 토큰은 살아 있다**(추론 — 코드 경로로 확인, 실호출 안 함).

### 1.4 무엇이 어디에 남는가

| 대상 | 남는 것 | 근거 |
|---|---|---|
| HIS 앱 로그 | Clinic 토큰 **앞 8자**(`Verifying SSO token (prefix: …)`) · 경로 B 성공 시 이메일+clinicUserId | `clinic-api.service.ts:79` · `sso.controller.ts:189` |
| 감사(AuditLog) | 🔴 **SSO 로그인은 남지 않는다** — `issueSession` 을 지나지 않아 `auditSession('LOGIN')` 이 없고, 전역 감사 인터셉터는 무인증 요청을 버린다 | `auth.service.ts:218-221,273` · `apps/api/src/modules/audit/audit.interceptor.ts:160` |
| 경로 A 성공 로그 | 없음(실패만 남긴다) | `sso.controller.ts:94-145` |
| URL(엣지·브라우저) | 경로 B: Clinic 토큰이 `/sso?token=` 쿼리 · 경로 A: 그에 더해 HIS access 가 `/sso?accessToken=` 쿼리 | `page.tsx:24-25` · `sso.controller.ts:135` |
| Cloudflare·Caddy 접근 로그에 쿼리가 남는가 | **미확인**(Caddyfile·Tunnel 로그 설정은 저장소 밖) | — |
| 브라우저 기록 | 페이지는 성공 시 `router.replace('/dashboard')`(`page.tsx:54`) — 세션 기록 항목은 교체되나, 방문 기록 DB 에 원 URL 이 남는지는 브라우저별 **미확인** | — |
| Referer | web 응답 헤더 `Referrer-Policy: strict-origin-when-cross-origin`(`apps/web/next.config.ts:81`) — 교차 출처로는 출처만 간다. 동일 출처 요청에는 전체 URL 이 갈 수 있다(표준 동작 · 실측 안 함) | — |

### 1.5 그 밖의 관찰

- 공개 쓰기 스로틀 기준선에 `POST api/v1/sso/verify` 가 **스로틀 없는 공개 쓰기**로 동결돼 있다(`apps/api/test/architecture/public-write-throttle.baseline.json:12`). 요청마다 Clinic 서버를 부른다.
- `verifySsoToken` 주석은 Clinic 토큰을 "one-time" 이라 부르지만(`clinic-api.service.ts:75`) **HIS 는 1회성·수명·aud 를 확인하지 않는다** — Clinic 응답 `{valid, user}` 만 본다(`:93-101`). Clinic 토큰의 성질은 **미확인**.
- HIS 는 검증 요청에 `service: 'his'` 를 싣는다(`clinic-api.service.ts:83`) — Clinic 이 이 값으로 대상을 묶는지는 **미확인**.
- 정본 세션 정책(`security.session.timeoutMinutes`·동시 세션 상한)이 SSO 세션에는 적용되지 않는다(§1.2 비교).
- 기존 테스트 `apps/api/test/clinic-integration/sso-token-gate.spec.ts` 는 "검증 실패면 발급 안 함"만 본다 — 발급된 토큰의 모양(aud·sid)은 가드가 없다.

---

## 2. 위험 — 구체 시나리오

| # | 시나리오 | 조건 | 위험도 |
|---|---|---|---|
| W1 | **로그아웃 후에도 쓰이는 토큰** — 공용 PC 에서 SSO 로 들어온 직원이 로그아웃한다. `localStorage` 의 access(`api-client.ts:25`)는 서버가 거부하지 않으므로, 같은 PC 의 다음 사용자가(또는 저장소를 읽은 스크립트가) 만료(최대 8h)까지 그 직원 권한으로 API 를 부른다 | 로그아웃이 토큰을 지우는 것은 브라우저 쪽 정리뿐 · 유휴 만료 미작동(회신 문서) | **중** |
| W2 | **7일 Bearer** — `POST /api/v1/sso/verify` 응답 본문의 `refreshToken` 이 메인 API 를 7일간 통과한다. 화면은 이 값을 버리지만 응답(브라우저 개발자 도구·HAR·프록시 캡처)에 남는다 | 응답을 본 누구나 · 계정 비활성 전까지 | **중** |
| W3 | **로그인 고정(fixation)** — 공격자가 자기 계정으로 얻은 HIS access 를 `https://<HIS>/sso?accessToken=<공격자 토큰>` 링크로 피해자에게 보낸다. 피해자 브라우저가 **공격자 신원으로** 로그인돼 입력한 기록이 공격자 계정에 귀속된다(`page.tsx:29-30`) | 공격자가 유효 HIS 토큰을 가진 직원 | **중**(귀속 오류는 임상 기록 신뢰에 닿는다) |
| W3' | 같은 고정이 Clinic 토큰(`?token=`)으로도 가능한가 — IdP 시작형 SSO 는 상태(state) 결합이 없으면 구조상 열려 있다 | Clinic 토큰이 1회용인지·HIS 가 시작하지 않은 로그인을 거를 수단이 있는지 **미확인** | **미확인** |
| W4 | **URL 의 HIS access** — 경로 A 가 도달 가능하면 8시간 토큰이 엣지 접근 로그·브라우저 방문 기록에 남는다 | 경로 A 도달 여부 **미확인**(§1.1) | 도달 시 **중** · 미도달이면 잠재 |
| W5 | **URL 의 Clinic 토큰** — `/sso?token=` 이 엣지 로그에 남고, 그 토큰이 재사용 가능하면 로그를 읽은 사람이 HIS 세션을 새로 연다 | Clinic 토큰 수명·1회성 **미확인** · 엣지 로그 설정 **미확인** | **미확인** |
| W6 | **접속기록 공백** — SSO 로그인은 `AuditLog` 에 남지 않는다. "누가 언제 로그인했나"를 감사에서 물으면 SSO 사용자는 비어 있다(앱 로그 한 줄뿐 · 경로 A 는 그것도 없음) | 항상 | **중**(감사 축) |
| W7 | **세션 정책 우회** — 원내가 세션 시간·동시 세션 상한을 바꿔도 SSO 세션에는 반영되지 않는다 | 항상 | **하** |

---

## 3. 참고 패턴 — 이 저장소 안의 두 선례

### 3.1 R31(ERP SSO) — 방향은 HIS → ERP

외부 점검 봉합(`1c6e7cd98`, 회신 문서 `:247`·`:486`):

- `POST /api/v1/auth/erp-sso-token` — `JwtAuthGuard` + `assertErpAccess`(쿠키 방식과 같은 게이트) 뒤에서 발급(`apps/api/src/modules/auth/auth.controller.ts:95-106`).
- 토큰: **전용** `{ sub, email, role, aud:'erp-sso', jti }` · **60초**(`auth.service.ts:210-216`). `aud` 가 달려 메인 API 는 거부한다(`jwt.strategy.ts:51-53`).
- 발급 사실을 서버 로그에 `handoff=<id>` 로 남긴다(`auth.controller.ts:103-104`).
- 화면은 이 60초 토큰만 URL 에 싣는다 — **메인 access 는 싣지 않는다**(`apps/web/src/components/layout/ErpLauncher.tsx:75-84`).
- 쿠키 방식(`POST /auth/erp-sso`)은 URL 에 토큰이 없다(`/erp` 스코프 60초 httpOnly · `auth.controller.ts:110-126`). 로그아웃 때 그 쿠키도 지운다(`:195-198`).
- 🔴 R31 은 **URL 전달을 없앤 것이 아니라 URL 에 실리는 것을 바꾼 것**이다(8h 범용 → 60초·aud·jti 전용). 남은 한계: 서명 키가 메인 `AUTH_SECRET` 이라는 점은 회신 문서가 별도 잔여로 적었다(`:596`).

### 3.2 내부 IdP 경로 B — 1회용 코드 + 백채널 교환

`sso-idp.service.ts`(HIS → 하위 시스템, 허용 aud 에 `'clinic'` 포함 `:10`):

- 독립 서명 키 `AUTH_SSO_SIGNING_KEY`(미설정 시 `AUTH_SECRET + ':sso'` 폴백 `:33-36`) · 60초 · `jti` 1회 소비(`:41-56,76-91`).
- 경로 B: 브라우저에는 **불투명 redemption code** 만 가고, 하위 시스템이 서버 간 `POST /api/v1/sso/internal/redeem` 으로 교환 — 1회 소비(`:61-73`).
- 로그아웃 연동: 사용자의 자식 토큰을 `sso:children:${userId}` 로 추적해 `revokeAllForUser`(`:94-102`, 호출 `auth.service.ts:513`).
- 방향이 반대(HIS=IdP)라 Clinic→HIS 에 그대로 쓰지는 못하지만, **"URL 에는 1회용 불투명 코드만 · 교환은 서버 간"** 모양의 선례다.

### 3.3 두 선례에서 Clinic SSO 로 옮길 수 있는 것 / 없는 것

| 성질 | HIS 만으로 가능 | Clinic 합의 필요 |
|---|---|---|
| HIS 가 발급하는 토큰을 정본 세션(`issueSession`: aud·sid·refresh 비밀 분리·감사)으로 | ✅ | — |
| HIS 토큰을 URL 에 싣지 않음 | ✅(단, Clinic 이 `?accessToken=` 을 직접 쓰지 않는다는 확인 필요 — §6 Q1) | 확인만 |
| Clinic 토큰의 1회성·단명·aud 결합 | ❌ | ✅ |
| Clinic 토큰을 URL 대신 POST 로(form_post) | ❌ | ✅ |
| Clinic 로그아웃 → HIS 세션 종료 | ❌(Clinic 이 알려주지 않으면 HIS 는 모른다) | ✅ |
| 로그인 고정 차단(state 결합) | 부분(Case 1 제거로 HIS 토큰 고정은 막힘) | Clinic 토큰 고정은 ✅ |

---

## 4. 선택지 — 결과만 적는다

> 고르지 않는다. 각 선택지는 "무엇이 바뀌고 무엇이 깨지는가"만 적는다. 선택지는 배타적이지 않다(옵션 1 은 2·3 의 앞단계가 될 수 있다).

### 옵션 0 — 현행 유지 + 완화

| 항목 | 내용 |
|---|---|
| HIS 변경 | `page.tsx` 가 토큰을 읽은 직후 URL 에서 지움(`history.replaceState`) · 앱 로그의 토큰 앞 8자 제거 · `/sso/verify` 에 스로틀 |
| Clinic 변경 | 없음 |
| 로그아웃 의미 | **바뀌지 않는다** — W1·W2 그대로 |
| 호환 기간 | 불필요 |
| 깨지는 것 | 없음 |
| 남는 것 | W1·W2·W3·W6·W7 전부. 엣지 로그에 이미 남은 URL 은 지우지 못한다(iOS 회신 문서가 "완화이지 해결이 아니다"로 적은 그 한계) |

### 옵션 1 — HIS 단독: 발급을 정본 세션으로, HIS 토큰은 URL 밖으로

| 항목 | 내용 |
|---|---|
| HIS 변경 | ① `SsoController` 발급을 `AuthService.issueSession` 으로(aud `his`·`sid`·refresh 는 `AUTH_REFRESH_SECRET`·감사 `LOGIN` 에 `method:'CLINIC_SSO'` 같은 구분 — 구분 어휘는 착수 시 정함) ② `/sso/verify` 응답에서 `refreshToken` 제거, 대신 정본과 같은 httpOnly 쿠키 ③ 경로 A 의 `?accessToken=` 리다이렉트 제거 — 대체는 (a) 경로 A 폐기, 또는 (b) HIS 1회용 코드(Redis 60초·1회 소비)를 URL 에 싣고 웹이 POST 로 교환 ④ `page.tsx` Case 1(`?accessToken=` 수락) 제거 ⑤ 가드: SSO 발급 토큰에 `aud`·`sid` 가 있음을 고정(재주입 역검증) |
| Clinic 변경 | **없음 — 단, 확인 1건**: Clinic(또는 다른 클라이언트)이 `/sso?accessToken=` 이나 API 의 `GET /sso` 를 직접 쓰지 않는가(§6 Q1·Q2) |
| 로그아웃 의미 | HIS 로그아웃이 **그 기기 SSO 세션을 즉시 끊는다**(`jwt.strategy.ts:78-90` 이 `sid` 로 거부). 정본 세션 정책·동시 세션 상한이 SSO 에도 적용. **Clinic 로그아웃은 여전히 HIS 에 닿지 않는다** |
| 호환 기간 | 새 발급분은 배포 즉시. **이미 나간 무sid 토큰**(access 8h·7일 토큰)은 별도 처리 필요 — §5 D3 |
| 깨지는 것 | ③④: `?accessToken=` 으로 들어오는 클라이언트가 있다면 그 로그인이 끊긴다(있는지 **미확인**) · SSO 사용자의 세션 수명이 원내 세션 설정을 따르게 된다(지금보다 짧거나 길 수 있음) · 동시 세션 상한에 SSO 세션이 포함되어 가장 오래된 다른 세션이 정리될 수 있다(`auth.service.ts:271`) |
| 남는 것 | W3'·W5(Clinic 토큰 성질) · Clinic→HIS 로그아웃 전파 없음 |

### 옵션 2 — 옵션 1 + Clinic 토큰을 "1회용 코드"로 계약

| 항목 | 내용 |
|---|---|
| HIS 변경 | 옵션 1 전부 + Clinic 검증 응답에서 받은 계약 필드(예: 대상 `aud`·발급 시각·코드 1회 소비 여부)를 **확인하고 어긋나면 거부** · 선택: HIS 가 로그인을 시작(`state` 를 HIS 쿠키에 두고 Clinic 으로 보냄)해 돌아온 `state` 를 대조 — W3' 차단 |
| Clinic 변경(합의 필요) | ① SSO 토큰을 **불투명 1회용 코드**로(서버 간 verify 1회 소비 · 단명 — 수치는 합의) ② verify 가 대상(`service:'his'`, `clinic-api.service.ts:83`)을 결합 확인 ③ 선택: URL 쿼리 대신 `form_post`(자동 제출 폼)로 전달 ④ 선택: `state` 왕복 지원 |
| 로그아웃 의미 | 옵션 1 과 같음. 엣지 로그에 남은 코드는 이미 소비돼 재사용 불가(W5 해소 — Clinic 이 1회 소비를 보장할 때만) |
| 호환 기간 | 양쪽 동시 배포가 아니면 HIS 가 일정 기간 구 토큰·신 코드를 둘 다 받아야 한다. 구분 수단(필드·접두)은 합의 |
| 깨지는 것 | HIS 가 계약 필드를 강제하는 순간, 그것을 싣지 않는 Clinic 버전의 로그인은 실패한다 → 강제 시점은 Clinic 배포 확인 뒤여야 한다 · `state` 를 쓰면 **Clinic 화면에서 바로 여는 링크(IdP 시작형)는 HIS 를 한 번 거쳐야** 한다(사용자 동선 변화) |
| 남는 것 | Clinic 로그아웃 → HIS 전파 없음 |

### 옵션 3 — 표준 OIDC(Clinic = IdP · Authorization Code + PKCE · 로그아웃 전파)

| 항목 | 내용 |
|---|---|
| HIS 변경 | OIDC RP 구현(인가 요청·`state`/`nonce`/PKCE·코드 교환·`id_token` 검증: `iss`·`aud`·`exp`·`nonce`·`sid`) · 성공 후 옵션 1 의 정본 세션 발급 · Clinic `sid` ↔ HIS `sid` 매핑 저장 · 백채널 로그아웃 수신 EP(Clinic `sid` 로 HIS 세션 폐기) |
| Clinic 변경(합의 필요) | OIDC Provider: 인가·토큰 EP·서명 키 공개(JWKS)·`id_token` 에 `sid` · 백채널 로그아웃 발신 · 클라이언트 등록(HIS) |
| 로그아웃 의미 | HIS 로그아웃 → HIS 세션 종료 · **Clinic 로그아웃 → HIS 세션 종료**(백채널을 Clinic 이 보낼 때) · HIS 로그아웃 → Clinic 세션 종료는 별도(RP 시작 로그아웃 — 범위 합의) |
| 호환 기간 | 가장 길다. 현행 `/sso?token=` 을 OIDC 가동 확인 때까지 병행 |
| 깨지는 것 | Clinic 에서 바로 HIS 로 가는 동선이 "HIS 가 Clinic 으로 인가 요청 → 돌아옴" 왕복이 된다 · 서명 키 회전·시계 오차 같은 운영 의존이 생긴다 · 양쪽 구현량이 가장 크다(규모 **미산정**) |
| 남는 것 | 백채널이 실패할 때의 처리(재시도·실패 기록)는 별도 설계 |

### 4.1 한눈 대조

| | W1 로그아웃 | W2 7일 Bearer | W3 HIS 토큰 고정 | W3' Clinic 토큰 고정 | W4 URL HIS 토큰 | W5 URL Clinic 토큰 | W6 감사 | Clinic→HIS 로그아웃 | Clinic 작업 |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 남음 | 남음 | 남음 | 미확인 | 줄어듦(브라우저만) | 줄어듦(브라우저만) | 남음 | 없음 | 없음 |
| 1 | 해소 | 해소(새 발급분) | 해소 | 미확인 | 해소 | 남음 | 해소 | 없음 | 확인 1건 |
| 2 | 해소 | 해소 | 해소 | `state` 쓰면 해소 | 해소 | 1회 소비 보장 시 해소 | 해소 | 없음 | 중 |
| 3 | 해소 | 해소 | 해소 | 해소 | 해소 | 해소(코드+PKCE) | 해소 | 백채널 시 있음 | 대 |

"해소"는 설계상 그렇다는 뜻이다 — 구현 뒤 재주입 역검증 전까지 판정이 아니다.

---

## 5. 사람 결정 항목 (등록부 미등재 — 착수 시 등재)

| ID | 결정 | 층(누가) | 선택지와 결과 |
|---|---|---|---|
| D1 | 옵션 0~3 중 무엇으로 갈 것인가 | 원내 — 정보보호 책임 주체(구체 직책·위원회는 원내가 지정 · 이 문서는 지정하지 않는다) + **Clinic 운영 주체와 합의**(옵션 2·3) | §4 |
| D2 | 경로 A(`GET /sso` → `?accessToken=`)를 없앨 것인가, HIS 1회용 코드로 바꿀 것인가 | 원내 + Clinic 확인(Q1·Q2) | 없애면 코드 단순·그 경로 사용자 있으면 끊김 / 코드로 바꾸면 호환 유지·Redis 키 하나 더 |
| D3 | 이미 발급된 무sid SSO 토큰(최대 7일)을 어떻게 끊을 것인가 | 원내(자동으로 끊는 방향 = 사람 판단) | (a) 자연 만료까지 기다림 — 최대 7일 잔존 (b) `jwt.strategy.ts:28` 의 strict 플립(무aud 거부) — **SMART 등 다른 무aud 토큰도 함께 끊긴다**(영향 범위 **미확인**) (c) "발급 시각이 T 이전인 무sid 토큰 거부" 같은 새 규칙 — 정본 로그인의 레거시 토큰도 걸릴 수 있음 (d) `AUTH_SECRET` 교체 — **전 직원 일괄 로그아웃** |
| D4 | SSO 세션에 원내 세션 시간·동시 세션 상한을 적용할 것인가 | 원내 | 적용 — 정책 하나 · SSO 사용자 체감 변화 / 미적용 — 별도 수명 정책을 따로 정해야 함(정본이 둘) |
| D5 | Clinic 로그아웃을 HIS 로 전파할 것인가 | 원내 + Clinic 합의 | 전파 — 옵션 3 또는 별도 폐기 EP(인증 수단·Clinic 측 발신 구현 필요) / 미전파 — Clinic 에서 로그아웃해도 HIS 는 열려 있음을 사용자 안내로 밝힘 |
| D6 | 호환 기간 길이와 강제 시점 | 원내 + Clinic | 짧게 — 미전환 클라이언트 로그인 실패 위험 / 길게 — 그동안 구 경로 위험 지속 |

- 🔴 **추기(2026-10-01)**: D1 → 등록부 `integration.clinicSsoRedesign`, D3 → `integration.clinicSsoLegacyTokenCutoff` 로 등재했다
  (`apps/api/src/modules/decision-registry/decision.registry.batch-2026-10-b.ts` · 화면 `/admin/decisions`). D2·D4·D5·D6 은 아직 미등재다.

---

## 6. Clinic 팀에 보낼 질문

1. **Q1** HIS 로 사용자를 보낼 때 어떤 URL 을 씁니까? `https://<HIS>/sso?token=…`(웹 페이지) · API 의 `GET /sso` 직접 · `/sso?accessToken=…` 중 무엇입니까? 다른 호스트·포트로 보내는 경우가 있습니까?
2. **Q2** `/sso?accessToken=` 형태를 Clinic 이나 Clinic 이 아는 다른 클라이언트(앱 등)가 쓰고 있습니까? 없다면 HIS 가 그 분기를 걷어도 됩니까?
3. **Q3** Clinic SSO 토큰의 성질: 수명(초), 1회용 여부(verify 1회 뒤 무효인가), 형식(불투명/JWT), 사용자·세션과의 결합 방식.
4. **Q4** `POST /api/clinic/sso/verify` 가 HIS 가 보내는 `service:'his'` 를 확인합니까? 다른 서비스용 토큰을 HIS 가 내면 거부합니까?
5. **Q5** verify 응답에 토큰 발급 시각·대상(aud)·Clinic 세션 식별자(sid)를 실어줄 수 있습니까?
6. **Q6** Clinic 쪽 접근 로그·리다이렉트 경로에 SSO 토큰이 쿼리로 남습니까? 토큰을 쿼리 대신 POST(자동 제출 폼)로 보낼 수 있습니까?
7. **Q7** 로그인 시작을 HIS 가 하도록(HIS 가 `state` 를 붙여 Clinic 으로 보내고 Clinic 이 돌려줌) 바꾸는 것이 가능합니까? Clinic 화면에서 바로 HIS 를 여는 동선을 유지해야 합니까?
8. **Q8** Clinic 에서 로그아웃하면 HIS 세션도 끝나기를 기대합니까? 그렇다면 OIDC 백채널 로그아웃 또는 별도 통지 중 어느 쪽을 구현할 수 있습니까?
9. **Q9** OIDC Provider(인가 코드 + PKCE · `id_token` · JWKS) 구현 계획이나 이미 있는 구현이 있습니까?
10. **Q10** 전환 기간 동안 구·신 방식을 함께 받는 구간이 필요하다면, 구분 수단(필드·접두)과 종료 일정을 어떻게 정하겠습니까?

---

## 7. 착수 시 점검(구현이 아니라 판정 조건)

- 발급 토큰 모양 가드: SSO 발급분에 `aud='his'`·`sid` 가 있고 refresh 가 `AUTH_REFRESH_SECRET` 서명임 — **결함 재주입(sid 제거)으로 가드가 실패하는지 먼저 확인**.
- 로그아웃 대조군: SSO 로그인 → 로그아웃 → 같은 access 로 API 호출이 401 `SESSION_REVOKED` · 정본 로그인 경로는 불변.
- 감사: SSO 로그인이 `AuditLog` 에 `LOGIN` 으로 남고, 정본 로그인과 구분된다.
- `?accessToken=` 제거 시 Next 빌드(`next build`)까지 확인 · `api` 전체 스위트(웹을 스캔하는 가드가 api 쪽에 있다).
- 운영 반영 전 Q1·Q2 회신 확인 — 회신 없이 경로를 걷으면 "일방 폐기"(iOS 회신 문서 D16)가 된다.
