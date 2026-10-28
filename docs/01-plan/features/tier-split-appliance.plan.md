# Tier 분리 안 C — 로컬 데이터 플레인 어플라이언스 + 클라우드 컨트롤 플레인 (실행 계획)

> 🔴 **관련: `docs/01-plan/features/agent-emr-alignment.plan.md`**(2026-08-18).
> 이 문서의 **사람 결정 #2(GPU 원내 포함 vs WeRU.B 수탁 유지)** 가 2026-07-15부터 미결이며,
> 그 미결이 AgentEMR 설계서 반영의 **최상위 분기**(폐쇄망 vs 위탁+비저장 확인)를 막고 있다.
> 후속 문서 §2 가 두 적법성 논리가 양립하지 않음을 정리했다.


> 작성: 2026-07-15 / 상태: Plan v1.0 (안 C 채택 전제 — 사람 결정 잔여 4건은 §7)
> 한 줄: **코드베이스를 배치 중립(deployment-agnostic) 구조로 만든다** — 향후 원내 전체 설치든, 일부 기능의 클라우드 배치든 **동일 코드로 큰 문제 없이 동작**하는 것이 목적. 이를 위해 "PHI 접촉 컴포넌트는 로컬, 조율·비PHI 기능은 어디든"이라는 경계 계약을 코드에 심는다(INV-* 불변식 10종 충족). 원내 어플라이언스(안 C)는 이 구조의 첫 배치 형태일 뿐, 고정 목표가 아니다.

---

## 1. 배경·현황 (2026-07-15 감사 실사)

### 이미 있는 자산 (재개발 불요)
- **어플라이언스 원형**: `infra/docker/docker-compose.prod.yml` — postgres(외부 미노출)+redis(requirepass)+migrate(일회성)+api(replicas 2)+web+nginx. 실배포만 PM2/rsync 경로(`deploy.sh:95-125`)라 compose 경로는 미검증 상태.
- **런타임 config**: AI 서버 주소가 DB SystemConfig(`ai.server.url`, config-runtime.service.ts:34) — 내부 주소 전환에 코드 변경 0.
- **로컬 인증**: 자체 JWT + WebAuthn(공개키만 저장) — 클라우드 IdP 의존 없음 (INV-AVAIL-01 기충족).
- **PHI CSR-only**: SSR-PHI 0건(web 86% "use client", RSC는 공개 CMS만 publicFetch) — 웹 셸 배치 자유도 확보 (INV-PHI-02 기충족).
- **관측성 격리**: `infra/observability` Prometheus/Grafana 127.0.0.1 바인딩·"비PHI 집계" — 상향 메트릭의 원형.
- **SSRF 가드**: `safeFetch`/`assertEgressUrl` 존재(G2) — 적용 범위만 불완전.

### 갭 (감사 확정 결함 → 본 계획의 작업항목)
| # | 갭 | 근거 | 심각도 |
|---|----|------|--------|
| G1 | **outbox 페이로드에 MRN 원본**(chartNo)+진단코드가 비식별 없이 외부 ERP·웹훅으로 반출 | billing.service.ts:701-741,590-628 · integration-outbox.service.ts:90-159 | 🔴 BLOCKER(INV-NET-01) |
| G2 | **웹훅 등록 URL 검증이 http(s) 정규식뿐** — 내부 IP 지정 시 outbox가 발송(SSRF) + `*` 구독으로 PHI 이벤트 팬아웃 | integration-outbox.service.ts:100-159 | 🔴 |
| G3 | **raw fetch 산재** — safeFetch 미경유 외부 호출 ~10개 모듈(integration-outbox·medical-ai·scribe·clinic-api·concierge·formulary·i18n·twin·drug-explain 등) | 감사 보고서 §5 | 🟡 |
| G4 | **FCM 푸시 본문 비식별 미강제** — title/body가 Google로 원문 전송(주석 권고만) | fcm-push.service.ts:102-197 | 🟡 |
| G5 | ~~**aiFetch 호출 감사로그 부재**~~ **✅ 해소 확인(2026-08-20 실측)** — `AiEgressAudit` 로거가 경계 통과분을 메타만 남긴다(`t:AI_EGRESS · path · method · bytes · timeoutMs` · `medical-ai.service.ts:30,186`) · 차단은 `AI_EGRESS_BLOCKED`(:143). 🔴 **본문은 남기지 않는다**(PHI) — 무엇이 나갔는지는 `Ai*`/`Ai*Outcome` 감사행이 따로 센다 | medical-ai.service.ts:30·143·186 | ✅ |
| G6 | **외부 도메인 하드코딩 기본값** — **부분 해소(2026-08-20 실측)**: 서비스 코드 기본값은 **전부 제거**(`medical-ai.service.ts` P0-6 · `clinic.example.org`·`twin.example.org` 는 소스 **0건**). 🔴 **그러나 `config-runtime.service.ts:62` DEFAULTS 에 `ai.server.url` 기본값이 외부 도메인으로 남아 있다** — env 미설정이어도 **초기 상태에서 외부로 나간다**. 코드 기본값과 달리 관리 화면에 노출·감사되므로 '조용히'는 아니지만, **폐쇄망 전환 시 이 값이 무엇이어야 하는지는 미결**(tier 결정 종속). 🔴 코디네이터 1차 실측이 서비스 코드만 보고 '해소'로 오판할 뻔했다 — 기본값은 **코드·config 두 층**에 있다 | config-runtime.service.ts:62 | 🟡(부분) |
| G7 | **스크라이브 원음→wasabi S3 경로**(기본 OFF·D-9 미완) | scribe-ai.client.ts:47-85 | 🟡 (활성화 전 필수) |
| G8 | **auditLog DB 불변 트리거 미확인** — 앱 레벨 append-only만 | audit.controller.ts:20-84 | 🟢 |
| G9 | 컨트롤 플레인 부재 — 서명 배포·비식별 메트릭 상향·테넌트 레지스트리 없음 | 저장소 전체 | Phase 2~3 |

---

## 2. 목표 아키텍처 (안 C 확정 사항)

```
┌─ 병원 내부망 (데이터 플레인 어플라이언스 = docker compose 스택) ─────────┐
│  nginx ─ web(Next, 셸+CSR) ─ api(NestJS, PHI 전담) ─ postgres/redis    │
│  + PACS(기존 별도스택) + PDF(127.0.0.1) + [GPU 추론 — 사람결정 2]        │
│  브라우저(원내) → nginx → api  (PHI는 이 상자를 절대 벗어나지 않음)        │
└──────────────┬────────────────────────────────────────────────────────┘
               │ 상향: 비식별 메트릭·하트비트만 (INV-NET-01)
               │ 하향: 서명된 이미지/설정 아티팩트만 (INV-NET-02)
┌──────────────┴─ 클라우드 (컨트롤 플레인 — PHI 무접촉) ──────────────────┐
│  릴리즈 레지스트리(서명·체크섬) · 테넌트/라이선스 · 비식별 대시보드          │
│  공개 홈페이지(기존 AWS 유지) · edu/sign 조율                            │
└────────────────────────────────────────────────────────────────────────┘
```

- **웹 셸 위치(초기)**: 어플라이언스 포함 — 오리진 분리(원내 DNS·인증서·CORS) 생략. 멀티테넌트 시점에 재검토.
- **HIS 앱 코드(460모델·2,300EP·FE)는 구조 변경 없음** — 스택이 통째로 이동하므로 LAN 시맨틱 유지.

### 2.1 배치 중립 3원칙 (본 계획의 핵심 — 모든 작업항목의 상위 기준)

어떤 컴포넌트를 원내에 두든 클라우드에 두든 문제가 없으려면, 아래 3가지가 코드 수준에서 보장되어야 한다. Phase 0~2의 작업항목은 전부 이 원칙의 구현이다.

| 원칙 | 내용 | 위반 시 증상 |
|---|---|---|
| **N1. 위치 가정 금지** | 컴포넌트 간 목적지는 전부 config(SystemConfig/env)로만 해석. 코드에 "같은 서버/같은 오리진" 전제나 외부 도메인 하드코딩 기본값 금지 | 배치를 바꾸는 순간 조용히 잘못된 곳으로 송신 (G6) |
| **N2. PHI tier 명시 분류** | 각 모듈을 **PHI-bound**(로컬 필수)와 **location-free**(어디든 가능)로 분류한 tier 매니페스트 유지. location-free 모듈은 PHI 스키마 직접 참조 금지 — PHI가 필요하면 가명/집계 인터페이스 경유 | 클라우드로 옮긴 기능이 몰래 PHI를 적재 (INV-PHI-01) |
| **N3. 경계 게이트 상시화** | 프로세스 밖으로 나가는 모든 데이터는 가명화/비식별 게이트(P0-1)와 egress 가드(safeFetch)를 **배치와 무관하게 항상** 통과 | "지금은 같은 서버니까"로 넘어간 경로가 분리 후 유출구가 됨 (G1~G4) |

이 3원칙이 지켜지면 배치 결정(무엇을 원내에, 무엇을 클라우드에)은 **코드 수정 없이 config·인프라 수준의 결정**이 된다 — 그것이 "큰 문제 없는 구조"의 정의다.

### 2.2 ERP 동시 전환 (2026-07-15 확정 입력)

**ERP(clinic.example.org, 별도 저장소)도 동일 아키텍처(ARCHITECTURE-INVARIANTS)로 검토·수정 예정.** HIS 계획에 미치는 영향:

| 영향 | 내용 |
|---|---|
| B-1 재판정 경로 | ERP 데이터 플레인(청구 SoT·chartNo 수신부)이 병원 로컬 배치로 확정되면 HIS outbox→ERP는 **원내 트래픽**이 되어 INV-NET-01 위반이 구조적으로 해소. 단 **P0-1 가명화는 N3 원칙상 유지**(ERP 클라우드 tier로의 2차 상향 방어) — 우선순위만 P0→P1 조정 가능 |
| 인터페이스 계약 | outbox 이벤트 스키마에 **PHI 등급 태깅**(이벤트별 chartNo/환자 필드 포함 여부)을 명시해 ERP 쪽 tier 매트릭스(N2)와 맞물리게 함. ERP는 PHI 태깅된 이벤트의 수신 컴포넌트를 PHI-bound로 분류해야 함 |
| patientRef 계약 | 가명화 채택 시 HMAC pseudonymKey·토큰 형식을 양측 공용 계약으로 — ERP 회신 필요(핸드오프 문서로 발신) |
| 공용 자산 | ARCHITECTURE-INVARIANTS.md를 양 저장소 공용 명세로, CI 게이트 스크립트·감사 방법론(4트랙: 배포 토폴로지/텔레메트리/AI·생체/egress) 재사용 가능 |
| his_webhooks | ERP 로컬 배치와 무관하게 **임의 URL 팬아웃(G2)은 P0 유지** — ERP 외 구독자가 문제의 본체 |

→ ERP팀 전달 정본: `docs/handoff/HIS_통지_아키텍처불변식_ERP정렬.md`

---

## 3. Phase 0 — 앱 코드 보안 수정 (즉시, 현 서버에서 배포·검증 가능)

### P0-1. outbox MRN 가명화 (G1) 🔴
- `IntegrationOutboxService.enqueue` 앞단에 **egress 가명화 게이트** 신설: 페이로드의 `chartNo`를 `patientRef = HMAC-SHA256(chartNo, integration.pseudonymKey)` 절단 토큰(예: 앞 16 hex)으로 치환.
- config `integration.pseudonymizeChartNo` (기본 **OFF** — ERP 합의 전 기존 동작 유지, 프로젝트 게이트 관례 준수). ON 시 `chartNo` 필드 제거+`patientRef` 대체.
- **전환기 이중발행 금지** — 같은 이벤트에 원본·토큰 동시 포함하면 가명화 무의미. ERP 측 매핑 이관은 별도 배치(1회성 chartNo→patientRef 대사표 전달, 사람결정 3 합의 후).
- 대상 페이로드 열거: `billing.line_recorded`(billing.service.ts:701-741, :590-628) 외 chartNo/환자 식별자 포함 이벤트 전수 grep(`chartNo`가 enqueue 페이로드에 들어가는 지점) 후 계획서 부록에 목록화.
- ⚠️ **함정**: outbox ref 컬럼 VarChar(200) 초과 주의(과거 PR#466 전멸 사고)·enqueue는 구독 없으면 조용히 no-op.

### P0-2. 웹훅 등록 가드 (G2) 🔴
- `createWebhook`(integration 모듈)에 `assertEgressUrl` 적용 — 사설/loopback 차단(기존 G2 유틸 재사용).
- PHI-급 이벤트(chartNo/환자 필드 포함 이벤트 타입 목록)는 **`*` 와일드카드 구독에서 제외**하고 명시적 구독+ADMIN 승인 요구.
- 발송 시점(`integration-outbox.service.ts:159` fetch)에도 방어적 재검증(등록 후 DNS 변경 대비 — DNS rebinding 이력 있음, session_20260615 참조).

### P0-3. safeFetch 일원화 (G3) 🟡
- 대상(감사 확정): integration-outbox, medical-ai, scribe-ai.client, clinic-api, concierge, formulary, i18n/translation, twin.controller, drug-explain + PACS/document는 내부 목적지라 `allowPrivate:true` 옵션으로.
- 기계적 치환이므로 회귀 위험 낮음. 단 **scribe의 위장 UA·스트리밍(SSE) 경로**는 safeFetch가 지원하는지 선확인 — 미지원이면 assertEgressUrl만 선적용.

### P0-4. FCM 본문 비식별 강제 (G4) 🟡
- `pushPatientNotification`(fcm-push.service.ts:197)에 화이트리스트 필터: 제목/본문을 고정 문구("새 알림이 있습니다"+카테고리)로 치환하고 상세는 앱 내 조회 유도(`data`에 리소스 참조 ID만).
- config `push.genericBody` 기본 **ON**(안전 기본값).

### P0-5. aiFetch 감사 로깅 (G5) 🟡
- aiFetch(medical-ai.service.ts:90-122)·ScribeAiClient에 경계 통과 감사 기록: endpoint·목적(기능 키)·userId·deidentify 플래그·바이트 수. **PHI 본문은 기록하지 않음**(감사로그에 PHI 넣으면 자기위반).
- 기존 AuditService 재사용(비-PHI 메타 관례 유지).

### P0-6. 외부 도메인 하드코딩 기본값 제거 (G6) 🟡
- `example.org` 류 코드 기본값을 빈 값으로 바꾸고 **미설정 시 명시적 비활성**(조용한 외부 송신 방지). env.validation.ts에 통합 URL zod 검증 추가.
- ⚠️ 운영 DB SystemConfig에 실값 선시딩 후 배포(순서 바뀌면 AI·ERP 연동 중단).

### Phase 0 검증 기준
- [ ] 가명화 ON 상태에서 `billing.line_recorded` 발행 → 페이로드에 chartNo 부재·patientRef 존재 (운영 유사 환경 실측)
- [ ] 내부 IP 웹훅 등록 시도 → 400 거절
- [ ] FCM 발송 실측 → Google 전송 페이로드에 임상 문구 부재
- [ ] AI 호출 1건 → auditLog 1행(메타만)
- [ ] 기존 테스트 전량 녹색 + `nest build` (BE 수정 후 필수)

---

## 4. Phase 1 — 어플라이언스화 (코드 변경 최소, 검증 중심)

1. **compose 경로 실운영 검증**: docker-compose.prod.yml로 스테이징 기동 — migrate/seed 멱등, self-healing(MediaService 스캔), 업로드 볼륨, PACS 프록시(⚠️ orthanc/ohif 서비스는 OpenPACS 소유 — compose에 추가 금지, 네트워크 연결만).
2. **이미지 빌드 파이프라인**: 소스 rsync 배포 → 버전 태깅된 이미지(api/web) 빌드로 전환. 이미지에 시크릿 미포함(env 주입).
3. **설치 번들**: compose+`.env.template`+초기화 스크립트+백업 cron(기존 deploy.sh --backup 이식)을 단일 아티팩트로.
4. **오프라인 동작 리허설**: 외부망 차단 상태에서 조회·기록·처방·서명 정상 확인 (INV-AVAIL-01 실증).
5. **모듈 tier 매트릭스 (N2 구현)**: 185개 백엔드 모듈을 PHI-bound / location-free로 분류한 매니페스트 작성(docs/05-reference 정본). location-free 후보 예시: config·holiday·hospital-info·i18n·voucher-fx·homepage 계열 / PHI-bound: patient·encounter·prescription·billing·scribe 등 대다수. CI 게이트 ⑧ 신설: location-free 모듈에서 PHI 모델(Patient/Encounter/Prescription 류) prisma 참조 검출 시 차단. **향후 어떤 기능을 클라우드로 옮길지의 판단 기준표가 이 매트릭스다.**
6. **웹 셸 오리진 분리 준비 (N1 구현, 실분리는 나중)**: `NEXT_PUBLIC_API_URL` 경로가 이미 존재하므로, API CORS 화이트리스트를 config화하고 웹 셸을 다른 오리진에서 서빙하는 스테이징 리허설 1회 수행 — 실제 분리 결정 시 코드 변경이 없음을 실증해 둔다.

## 5. Phase 2 — 컨트롤 플레인 MVP (신규·별도 저장소 권장)

1. **서명 배포(INV-NET-02)**: 릴리즈 아티팩트에 서명+체크섬, 어플라이언스 측 검증 후 적용(초기엔 수동 설치 스크립트로 갈음 가능).
2. **비식별 메트릭 상향(INV-NET-01 합치)**: Prometheus remote_write 또는 push — 지표 화이트리스트(가동률·버전·큐 깊이 등)만. 환자 단위 지표 금지. 상향 범위=사람결정 4.
3. **하트비트/라이선스 체크**: 실패해도 임상 기능 무영향(soft-fail, INV-AVAIL-01).

## 6. Phase 3 — 멀티테넌트 (weve 전개 시점에만)

- 테넌트 레지스트리·SSO 조율(INV-TENANT-01: 컨트롤 플레인 DB에 PHI 테이블 금지 — 설계 리뷰 게이트)·자동 업데이트 에이전트·웹 셸 클라우드 분리 재검토(오리진 분리 설계).

## 7. 사람 결정 (착수 전 합의 필요 — 에이전트 판정 금지)

> ✅ **2026-08-25 — 4건 전부 `/admin/decisions`(2415) 에 등재했다.** 이제 문서가 아니라 화면에서
> 근거 문서를 첨부하고 기록한다. 🔴 **등재하지 않으면 결정은 기획서 안에서 늙는다** — #2 는
> 2026-07-15부터 40일+ 미결이었고 그동안 AgentEMR 2단계 전체가 막혀 있었다.
>
> | # | 등재 키 | 층 |
> |---|---|---|
> | 1 | `legal.erpMrn.pseudonymization` | 허가권자 |
> | 2 | `legal.phiBoundary.gpuTier` 🔴 **최상위 분기** | 허가권자 |
> | 3 | `legal.regulatoryAxis.review` | 허가권자 |
> | 4 | `policy.metrics.upstreamScope`(#2 에 종속) | 위원회 |

| # | 결정 | 블로킹 대상 |
|---|------|------------|
| 1 | ERP MRN: 가명화 채택 vs 위수탁계약(DPA)으로 원본 유지 — 재식별 위험 적정성은 법무 | P0-1 config ON 시점 (구현은 OFF로 선행 가능) |
| 2 | GPU 원내 포함 vs WeRU.B 수탁 유지 | Phase 1 어플라이언스 구성·G7(D-9) |
| 3 | 규제 축 법무 확인(의료법 고시·CSAP·N2SF — 비교안 §2) | Phase 2 착수 |
| 4 | 상향 허용 비식별 메트릭 범위 | Phase 2-2 |

## 8. CI 게이트 (재발 방지 — Phase 0과 병행 도입)

감사 보고서 §5의 7종: ① SSR-PHI 스캔 ② outbox 페이로드 PHI 필드 검사 ③ `deidentify:false` grep ④ raw fetch egress lint ⑤ 웹훅 가드 검사 ⑥ 무필터 바디 로깅 grep ⑦ 제3자 SDK 유입 감시.

## 9. Out of Scope

- ARCHITECTURE-INVARIANTS.md 자체의 개정 (안 B 채택 시에만 필요 — 미채택)
- NHIS·HIE·환자 SMS 실연동 (스텁 유지 — 운영 전환 시 본 감사 재수행이 선결)
- 감사로그 외부 체인 앵커링 (INTERNAL 유지, 로드맵)
- 오프라인 동기화 FR-08 (기존 Out of Scope 유지)

## 10. 구현 시 함정 (다른 CLI 인수인계용)

- **멀티 CLI 동시작업**: 격리 worktree에서 작업할 것 (git 인덱스 공유 시 staged 혼입 — feedback_multi_cli_git_index).
- deploy.sh는 **working tree를 rsync**함(미커밋도 배포됨) — Phase 0 배포 시 다른 CLI의 미완성 변경 혼입 주의.
- BE 수정 후 `nest build` 필수(pm2=dist). 신규 모델 시 `prisma generate` 수동(deploy.sh --api는 미실행).
- `npx prisma db push --accept-data-loss` 금지. 신규 unique 인덱스는 db push가 오탐 거부 가능 → 수동 SQL(PR#474 전례).
- DTO 신규 필드는 class-validator 데코 필수(전역 whitelist가 strip).
- outbox enqueue는 timestamptz 함정(+9h 미래 미발송) 전례 있음 — 신규 컬럼 시 timestamptz.
