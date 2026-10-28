# AI 도입과 HIS — 정본 문서 (2026-09-09 개설)

> 이 문서는 Hospital RUN 에서 **AI 가 무엇을 하는가**가 아니라 **AI 의 판단을 사람이 안전하게 소유하고, 그 과정이 증명 가능한가**를 다룬다.
> 근거 없는 주장은 적지 않는다. 각 항목은 코드·문서·화면 경로를 가리키고, 없는 것은 **없다**고 적는다.
> 공백 회수 기획서: [`docs/01-plan/features/ai-judgment-governance.plan.md`](01-plan/features/ai-judgment-governance.plan.md) 

---

## 0. 세 가지 기제 — 모든 질의가 여기로 수렴한다

| 기제 | 뜻 | Hospital RUN 의 현재 규약(정본) |
|---|---|---|
| **정본/제안 분리** | AI 산출물은 정본(법적 진료기록)이 아니다. 사람의 명시적 승인으로만 정본이 된다 | "초안≠확정 · 자동실행 기본 금지" — `docs/01-plan/features/clinical-ux-agent-era.plan.md` · 관계 모드 5종(감시/보조/초안/실행제안/자동실행)을 화면이 밝힌다 |
| **출처 추적** | 값이 어디서 왔는지(사람 / AI / 폴백 / 산출 불가)를 화면과 기록이 말한다 | 출처 3상태 `AI` / `FALLBACK` / `UNAVAILABLE` · AI 표기 병기(AI기본법 §31 · shared `AI_ORIGIN_TEXT`) · "폴백이 값을 지어내지 않는다"(CLAUDE.md §정직성) |
| **수용 이력 감사** | AI 가 무엇을 제안했고 누가 승인/수정/거부했는지 재구성 가능 | 감사 기본 ON(`AUDIT_EXEMPT` 만 면제) · AI 열람은 환자에 귀속(21 EP 봉합·2026-08) · 권한 검사는 AI 호출 **앞**에서 |

🔴 위 셋 중 **정본/제안 분리와 수용 이력 감사는 다른 층의 점수와 무관하게 충족되어야 한다** — 이 두 층이 없으면 "사람이 최종 책임진다"를 증명할 수 없다(질의서 §12).

---

## 1. Hospital RUN 의 AI 표면 — 확정된 사실 (CLAUDE.md System Scale 기준)

| 항목 | 사실 | 출처 |
|---|---|---|
| AI 엔드포인트 | 66 (경로 세그먼트 `ai` 기준 · `node scripts/system-scale.mjs`) | CLAUDE.md System Scale |
| 추론 서버 | 외부 서버 **WeRU.B**(`MEDICAL_AI_URL` · 런타임 `ai.server.url`) — 2026-09-09 이전 후 HIS 와 **같은 ML 서버**(RTX 5080)에서 돈다. 외부 SaaS LLM 호출은 없다(조사 §5 에서 재확인) | `.env` · 메모리 `triage_ai_api` |
| AI 표기 | 모든 AI 산출 화면에 `AI(WeRU.B)` 병기 — AI기본법 §31 | shared `AI_ORIGIN_TEXT` |
| 증빙 판독 | `ai.evidenceExtract.enabled` **기본 OFF** · 초안만 · `FALLBACK` 없음 | `modules/evidence/evidence-extract.service.ts` |
| 자동실행 | 관계 모드 "자동실행"은 **기본 금지** | `clinical-ux-agent-era.plan.md` §에이전트 |
| 프롬프트 정직성 | 빈 목록을 AI 에게 "없음"이라 말하지 않는다(`promptList` / `allergyPromptLine` 3상태) | CLAUDE.md §정직성 |
| 음성·생체 | VoiceEMR 성문 등록·`VoiceBiometricConsent` 별도 동의·철회 감사 | `modules/voice-emr` |

---

## 2. 질의서 대비 평가 결과 (2026-09-09 · 코드·문서 실측)

> 방법: 저장소를 5개 층으로 나눠 병렬 조사(구조·AI서비스 / 정본·제안 / 맥락·보호 / 감독·UI / 거버넌스). 모든 등급은 **파일:행 근거**를 갖는다. 운영 DB 는 조회하지 않았다(코드·문서·과거 실측 기록 기준). 등급 A 구현+즉시 확인 · B 부분/설정 · C 미구현·계획 있음 · D 미구현·계획 없음.
> 🔴 질의서의 필수 항목 수는 §3 이 **9건**(3.1.1~3.1.3·3.2.1~3.2.4·3.3.1~3.3.2)이라 총 **53건**이다. 질의서 §12 시트의 "10"·"54" 는 계수 오류로 본다.

### 2.1 종합 판정 시트

| 레이어 | 필수 | A | B | C | D | N/A | 판정 |
|---|---:|---:|---:|---:|---:|---:|---|
| 1. 전체 구조 | 5 | 2 | 2 | 1 | 0 | | 모놀리식 모듈+외부 추론(HTTP) · 비침습 계약(FHIR·SMART·웹훅) 있음 · SaMD 경계 선언 없음 |
| 2. 정본 레이어 | 4 | 1 | 3 | 0 | 0 | | 서명·해시체인·TSA·amend 는 A · provenance 는 **간호기록 1종만 완성** · 승인 없는 정본 write **2경로** |
| 3. 제안 레이어 | 9 | 1 | 0 | 5 | 3 | | 🔴 **제안 레코드가 일급 개념이 아니다** — 전용 테이블·상태기계·보존정책 없음, 4갈래(세션 JSON·정본 내장·감사행·Redis) |
| 4. 맥락 조립 | 6 | 1 | 4 | 1 | 0 | | FHIR R4 17리소스·SMART scope·접근 원장 3종 · KR Core 0 · 목적(purpose) 필드 없음 |
| 5. AI 서비스 | 13 | 1 | 2 | 4 | 5 | 1 | 🔴 모델 레지스트리·버전·롤백·변경관리 **전무** · 3상태 정직성은 A · 외부 SaaS 0 |
| 6. 감독·감사 | 5 | 0 | 1 | 2 | 2 | | 거부 축 없음 · 드리프트·PMS·이상알림 없음 · 감사 앵커가 `changes` 를 덮지 않음 |
| 7. 워크플로우/UI | 6 | 1 | 2 | 2 | 1 | | AI 없이 직접 입력 A · AI 표기 정본 111파일 · diff 화면 없음 · 위험등급 차등 없음 |
| 8. 데이터 보호 | 3 | 2 | 0 | 0 | 1 | | AI 동의·생체 동의 A · **학습 미사용을 증명할 근거 없음** |
| 9. 연동/확장 | 2 | 0 | 2 | 0 | 0 | | 계약은 있고 절차서 없음 · PACS AI 는 상태기계 밖 패스스루 |
| **합계** | **53** | **9** | **16** | **15** | **12** | **1** | **A 17%** |

**질의서 §12 기준 판정**: ① 필수 D 12건 → "도입 보류 또는 시정 조건" ② A 비율 17% < 70% → **단계 0~1(파사드+제안 레이어·감사 원장)을 원내 주도로 선행 구축 후 재평가** ③ 무관 충족 요건인 2·3·6 층 중 **3(제안)·6(감사) 미충족**. 결론: **"AI 가 무엇을 하는가"는 넓고(66 EP·10 모듈), "그 판단을 사람이 소유했음을 증명하는 층"은 얇다.** 공백 회수는 §3 기획서.

### 2.2 조사에서 새로 드러난 실질 위험 (질의서 밖 · 즉시 조치 대상)

| # | 사실 | 근거 |
|---|---|---|
| R1 | 🔴 **AI 호출이 운영 모드(개발/리허설/리얼)와 무관하게 외부로 나간다.** `allowsOutboundSend` 호출부는 문자·메일·기관 웹훅 2곳뿐, AI egress 0곳 · **P0-A(09-09)**: 전송 감사 라인에 `mode` 기록(빌드 상한값) — 모드 기반 차단은 D6 결정 뒤(기획서 §2.5) | `packages/shared/src/his-mode.ts:100-115` · `common/util/ai-egress-fetch.ts` |
| R2 | ✅ **P0-B(09-09) 봉합**: MDT auto-summary 는 초안 응답만(`AI`/`UNAVAILABLE`·FALLBACK 없음), 저장은 사람이 `DraftBanner` 아래서 · 의뢰서 초안은 협진을 만들지 않고 **서명 시** 정본 `ConsultationService.create` 재사용 · 가드 `ai-write-requires-proposal.spec.ts` | `modules/mdt/mdt.service.ts` · `modules/referral-letter/referral-letter.service.ts` |
| R3 | 🔴 운영 DB 에 AI 임상 기능 **6개가 켜진 채**(`ai.server.enabled`·`scribe.enabled`·`voiceEmr.*`·`nursing.aiAssist.enabled`) — 누가·어떤 근거로 켰는지 기록 없음(2026-08-28 실측 인용) | `decision.registry.ts:1246-1252` |
| R4 | ✅ **P0-A(09-09) 봉합**: 허용 목록이 비면 공개 호스트 전송을 **차단**(`AI_EGRESS_HOSTS_UNSET`·부팅 1회 ERROR) · 운영 `.env` 에 `example.org` 등재 · 종전엔 경고만 하고 통과했다 | `common/util/ai-egress-url.ts` · `test/medical-ai/ai-egress-hosts-failclosed.spec.ts` |
| R5 | 🔴 감사 머클 앵커의 `dataHash` 가 `changes` 를 포함하지 않는다 → AI 이벤트 페이로드(모델·프롬프트버전·편집거리)는 변조 탐지 밖. 해시체인은 in-memory | `modules/audit/audit.service.ts:269,293` |
| R6 | AI API 키 401 시 **하드코딩 조직정보로 자동 재발급**·메모리 저장·무감사 | `modules/medical-ai/medical-ai.service.ts:908-928` |
| R7 | 컨시어지 키워드 폴백이 `SkillEnvelope` 없이 답을 낸다(호출자가 AI/FALLBACK 구분 불가) · 진료 AI 패널 스트리밍 폴백이 `confidence: 0.7` 을 **지어낸다** | `concierge.service.ts:289,336-348` · `AiAssistantPanel.tsx:568` |
| R8 | 자동매핑 "제안 전체 적용"이 `autoConfirm:true`·확인창 없음(청구 직결) | `admin/codes/auto-mapping-dashboard.tsx:1049-1067` |
| R9 | "의료기기·AI 거버넌스 위원회"는 등록부 `authority` **문자열로만 5회** 존재 — 위원회 엔진 9종 시드에 없다. AI 결정 5건의 의결 주체가 실체 없음 | `gld/governance.service.ts:41-50` · `decision.registry.ts:449,520,543,588,1254` |
| R10 | go-live 의 AI 항목 13건 **전부 `isBlocking:false`** ↔ 등록부 4건은 `REQUIRED_BEFORE`. 두 관제가 다른 무게를 말한다 · 안전 게이트 관제(28종)에 AI 게이트 0 | `go-live.registry.ts:120-149` · `safety-gate.service.ts:331-403` |
| R11 | 감사 로그 보존이 문서 3곳에서 **5년 / 1년+ / 3년(legalMin 1년)** 으로 다르다 | `docs/OPERATIONS.md:348` · `security-governance-master.plan.md:45` · `seed.ts:11552` |
| R12 | 죽은 정본: `ScribeSession.aiModel/aiPromptVersion` writer 0 · `ScribeSessionStatus.APPLIED` 대입 0 · `scribe.transcript.retention=90` 읽는 코드 0(전사 무기한 보존) · `Encounter.aiEditDistance` writer 0 | `schema.prisma:1613,1638-1639,1574` · `config-runtime.service.ts:114` |

### 2.3 항목별 등급·근거 (필수 53)

| # | 항목 | 등급 | 사실·근거 |
|---|---|---|---|
| 1.1 | 배포 단위 | A | HIS API 내부 모듈 + 외부 추론 WeRU.B(`https://example.org/ollama`) HTTP · 10모듈 전부 `aiEgressFetch` 단일 경로 · 다이어그램 `docs/HIS_TECH_WHITEPAPER.md:30-47` |
| 1.2 | 정본/제안 저장 분리 | B | 별도 테이블 다수(ScribeSession·AgentSession·AiFeedback·CheckupInterpretation…) 그러나 `ReferralLetter.content` 에 초안 그대로·`NursingNote` 정본 안에 AI 5컬럼 · Encounter 일반화는 결정 대기 `go-live.registry.ts:123-131` |
| 1.3 | AI 의 정본 직접 write | B | medical-ai 모듈 정본 write 0 · 예외 4곳(MDT·Referral→Consultation·committeeAgenda.aiAssessment·예약 에이전트 patient/appointment) — R2 |
| 1.4 | 비침습 삽입 지점 | A | FHIR R4 read 17종+write · SMART authorize/token/launch/jwks · HisWebhook HMAC+IntegrationOutbox · journey 이벤트는 인프로세스 · "오더 단일 게이트웨이" 명명 컴포넌트 없음 |
| 1.5 | SaMD 경계 명시 | C | 전사 선언서 없음 · 도메인 1건 `checkup-explainer-regulatory-review.md` · `agent-emr-alignment.plan.md:72-104`(S4 ≈25개 의료기기 해당 자인) · `guardrail.ts` |
| 2.1 | 정본 provenance 필드 | B | 간호기록만 완전(`aiAssisted/aiModel/aiPromptVersion/aiSourceSnapshot/aiEditDistance` 6896-6900) · Encounter 3컬럼 중 `aiEditDistance` writer 0 · 판독문·검사·오더·퇴원요약·동의서 **없음** |
| 2.2 | 원본 제안 역추적 | B | 간호(`aiSourceSnapshot.draftText`+HMAC sig)·의뢰서(`aiDraftContent`) 완전 · Encounter 는 포인터(FK 미선언·덮어쓰기) · SOAP/퇴원요약/동의서는 `AiDraftApply` 에 `textLength` 만 |
| 2.3 | 승인자·시각 불변 | A | signedAt/By 전 정본 · SIGNED→AMENDED 재서명 · 간호 append-only 정정 · `OrderSignLog` 해시체인+TSA · 블록체인 앵커 · 4-eyes(`CheckupSummary`·`LabResult`) |
| 2.4 | 명시 승인만 write | B | 규약 §7.6 "초안≠확정" · VoiceEMR T1 킬스위치 매-write 재확인·T3 handoff·스크라이브 DRAFT-only · **예외 2건 R2** |
| 3.1.1 | review-pending 영역 | C | 일급 테이블 없음 — 세션 JSON(`draftSnapshot`)·정본 내장 스냅샷·감사행·Redis 24h(`patient-brief.service.ts:166`) 4갈래 |
| 3.1.2 | 제안 메타데이터 | C | 프롬프트 버전 3곳·입력 스냅샷 해시 **간호 1곳**만(`sig`+`evidence`) · 신뢰도 미저장(응답에만) · 모델 ID 대부분 하드코딩 또는 미기록 |
| 3.1.3 | 제안 불변성 | C | `ScribeSession.draftSnapshot` 재생성 시 덮어쓰기(이전 초안 소실) · 선례 있음: `CheckupExplainerContent` version+1·`OrderSignLog update:{}`·`VoiceUtterance` 원문/수정본 분리 |
| 3.2.1 | 상태기계 정의 | C | 6상태 모델 없음 · `ScribeSessionStatus` 는 세션 생명주기 · `APPLIED` 대입 0 · 선례 `CheckupExplainerContent` DRAFT→IN_REVIEW→APPROVED/REJECTED·`PendingMapping` |
| 3.2.2 | 전이마다 행위자·시각·사유 | D | 상태 전이 이력 테이블 없음(`status` 1컬럼+`updatedAt`) |
| 3.2.3 | presented 기록 | D | 노출 사실 기록 0 · `analyze` 는 READ 건수만 |
| 3.2.4 | edited diff 저장 | C | Levenshtein 거리(1500자 캡)만 · 본문·diff 미저장(PHI 규약) · `draft-outcome` 배선 화면 **1곳** |
| 3.3.1 | write-back 경로 재사용 | A | `VitalsService.record()` 재사용·실패를 실패라 말함 · T3 handoff 로 정본 CPOE 층이 DUR·step-up 강제 · 간호 `createNote` 재사용 |
| 3.3.2 | write-back 일관성 | D | `applySuggestion`·`confirm` 트랜잭션 없음 · 보상·재시도 큐 없음(`OrderSignLog` 만 예외) · 승인 시점 입력 변경 감지 없음(`contentHash` 선례만) |
| 4.1 | 맥락 표준 API | B | FHIR R4 4.0.1 17리소스·CapabilityStatement(수기)·SMART 디스커버리 · 🔴 KR Core 0·`meta.profile` 없음·ImagingStudy 없음 |
| 4.2 | HL7 v2/통합엔진 | C | v2 리스너·MLLP·Mirth 0 · LIS=SMART Backend+FHIR(라이브)·PACS=REST 워크리스트 · 카탈로그 없음 |
| 4.3 | 읽기 전용 분리 | B | 쓰기 4계열 존재(Patient·LIS 스테이징·Bundle·트윈 write-back 4중 게이트) · read-only 는 `SmartClient.scopes` 설정으로만 |
| 4.4 | AI별 목적 제한 | B | 클라이언트별 리소스·동작 scope · 프롬프트 항목 열거·상한·근거 게이트(`ai-grounding.ts`) · 🔴 purpose 필드 없음 · 시드 scope 소문자 dead |
| 4.5 | 접근 로그 | B | 3원장(AuditLog `Fhir*` returned=N · SmartAccessLog · `@AuditAiRead` 23 EP 환자 귀속 실증) · 목적·데이터 항목 미기록 · 월 1회 점검 산출물 없음 |
| 4.6 | 동의 조회·강제 | A | `PatientAiConsent` 강제 5곳·철회 즉시·`GET /twin/consent` recorded 구분 · FHIR Consent 리소스는 없음 |
| 5.1.1 | 의료기기 해당 판단·근거 | C | 자기진단(S4 ≈25개 해당·3개 자동저장) 있으나 판단 결과 문서·유권해석 없음(결정 `legal.ai.deviceClassification` 미결) |
| 5.1.2 | 인증 등급·허가번호 | D | 인증된 AI 없음·intended use 선언 없음 |
| 5.1.3 | 의료기기/비의료기기 동일 배포 단위 | C | 같은 프로세스·같은 egress 에 묶임 · 인증 범위 영향 분석 없음 |
| 5.1.4 | HIS 경계 밖 증명 계약 | C | FHIR·SMART·SkillEnvelope 계약은 있으나 경계 데이터 흐름도 없음 |
| 5.1.5 | 제조자↔HIS 책임 분계 | C | 위탁 관계 문서 1건 `ai-processor-phi-nonstorage.md` · 책임 분계 미정 |
| 5.2.1 | 모델 레지스트리 | D | 없음 · model 기록 3곳 중 진짜 1곳(`referral-letter.service.ts:51`) · 계측 `outcomeMeta` 에 model 없음 |
| 5.2.2 | 변경 관리 절차 | D | ISO 13485/IEC 62304 저장소 0 · 변경 영향 분석 템플릿 없음 |
| 5.2.3 | 자동 업데이트 차단 | B | 모델 태그가 코드 상수(12곳)라 배포 없이는 바뀌지 않음 · 그러나 절차·통제 문서 없음 · `ai.model` 소비처 번역 1곳(관리 화면 문구 과장) |
| 5.2.4 | 롤백 절차 | D | `production-operations.md:324` "롤백 스크립트는 없다" |
| 5.2.5 | 기간별 모델 버전 사후 조회 | D | 레지스트리·계측 없음 |
| 5.3.1 | 추론 위치·반출 | B | 퍼블릭 FQDN `example.org/ollama` · 백서 "온프레미스" ↔ 불변식 감사 INV-PHI-03 **FAIL**(사람 결정 승격) · 2026-09-09 이전 후 HIS 와 같은 ML 서버 · 외부 SaaS 0 |
| 5.3.2 | graceful degradation | A | 3상태 `AI/FALLBACK/UNAVAILABLE` 타입·검증·표시 관통 · 임상 스킬은 지어내지 않음(`checkup`·`telehealth`·`pharmacy`·`imaging` UNAVAILABLE) · 예외 R7 |
| 5.3.5 | 외부 SaaS 국외이전·위탁·ISMS-P | N/A | 외부 SaaS LLM 호출 0(패키지·import 확인) · 단 WeRU.B 위탁 여부는 D6 미결 · ISMS-P 는 "지향" 1행 |
| 6.1 | 수용/수정/거부 집계 | C | 수용 `AiDraftApply`·수정 `AiDraftOutcome`(감사행 얹기) · 🔴 거부 축 없음(`onReject` 로컬 상태만) · 축은 resourceType 만 · `/admin/ai-settings` 카드 3종 |
| 6.2 | 모델 드리프트 | D | `DriftRecorderService` 는 FE↔서버 계약 드리프트 · `AiFeedback.model` 항상 null |
| 6.3 | PMS export | D | CSV/FHIR export 0 · `14971`·`PMS` 저장소 0 |
| 6.4 | 환자별 단일 화면 재구성 | C | 재료(환자 귀속 감사행) 있음 · `/admin/audit` 는 `changes` 미렌더 · 타임라인 11트랙에 AI 없음 · 제안 본문 미저장 |
| 6.5 | 감사 불변 저장 | B | 수정/삭제 API 0 · 머클 앵커 매시간 · 보존 정책+4-eyes · 🔴 DB 트리거·권한 분리 없음 · 앵커가 `changes` 미포함(R5) |
| 7.1 | diff 중심 화면 | D | 어떤 AI 화면에도 diff 없음 · `VoiceConfirmCard` 는 되읽기 |
| 7.2 | 원클릭 일괄 승인 | C | 임상 축 없음 · 🔴 코드 매핑 `autoConfirm:true` 1건(R8) |
| 7.3 | 위험등급별 마찰 차등 | C | step-up 은 처방 생성·진료 서명 2곳·기본 OFF·파일럿 0 · AI 산출물이라서 마찰이 오르는 코드 없음 · ISO 14971 0 |
| 7.4 | AI 제안 시각 구분 | B | `AI_ORIGIN_TEXT` 111파일·가드 전 범위 0건 동결 · 3상태 부품(`AiSuggestionPanel`·`DraftBanner`) 소비 5파일뿐 |
| 7.6 | AI 없이 직접 입력 | A | 패널 기본 접힘·접힘 시 LLM 미호출·모든 AI 기능 config 기본 OFF·규칙 기반 요약 항상 산출 |
| 7.8 | 사용자별 on/off·권한 | B | 마스터 스위치·`pilotUserIds`·병동·`@Roles` 53/53 · 🔴 관계 모드 5종 코드 0(web 로컬 4종 어휘만) · `UserRole` 에 전공의 없음 |
| 8.1 | 환자 고지·동의·철회 | A | `PatientAiConsent` + 게이트 + 철회 즉시 + `ai.disclaimer`(AI기본법 §31) · 목적·유효기간·버전 필드 없음 |
| 8.2 | 생체정보 별도 동의·분리 | A | `VoiceUserProfile` §23 별도 동의(위탁 WeRU.B 명시)·원음 미보관·즉시 파기·fail-open(불이익 없음) |
| 8.3 | 학습 활용·옵트아웃 | D | 자체 학습 코드 0(계획 Phase 5+) · 🔴 외부 제공자 no-training 계약 근거 없음 · 학습 옵트아웃 개념 없음 |
| 9.1 | HIS 수정 없는 통합 절차서 | B | 계약(FHIR·SMART·웹훅·SkillEnvelope) 있음 · 절차서 없음 · provider 어댑터는 설계서만 |
| 9.2 | 부서 AI 동일 상태기계 | B | PACS AI 는 `pacs-proxy ai/inference` 패스스루·SkillEnvelope 미적용·FE 첫 모델 임의 선택 · 판독 웹훅은 서명·fail-closed |

### 2.4 권장·참고 항목 중 근거가 뚜렷한 것

| # | 항목 | 등급 | 근거 |
|---|---|---|---|
| 2.5 | provenance 의 HL7v2/FHIR/EDI 영향 | D | FHIR `Provenance` 리소스 미구현 · 아웃바운드에 `aiAssisted` 0 → **내보내면 AI 관여 사실이 사라진다** |
| 2.6 | 전자서명이 AI 무관 동일 적용 | A | 서명 경로에 AI 분기 0 · 간호 AI 초안에는 HMAC 검증이 추가로 있음 |
| 3.1.4 | 제안 보존·삭제 | D | `RetentionPolicy` 5건 중 AI 제안 0 · `scribe.transcript.retention` 무효(R12) |
| 3.2.5~3.2.7 | 거부 사유·expired·복수 제안 | D/D/C | 거부 전무 · expired 없음 · `SoapSuggestion[]` 응답만 |
| 4.7 | 표준 코드 | B | KCD-8↔ICD-10 18,199 · LOINC 마스터 26/26·과거 결과 1,840건 0(이름 매칭 금지) · SNOMED 69행(사전 라이선스 미결) |
| 4.8 | 성능 SLA | C | 문서 없음 · APM 인메모리·500ms 하드코딩 · Throttler 4버킷 A |
| 4.9 | 비식별화 경로 | C | `ai-phi-redact.ts` 정본(스스로 "비식별 아님" 명시) · 9 클라이언트 중 3 적용 · `ANONYMIZE` 핸들러 미구현 |
| 5.2.7 | 외부 LLM 핀 고정 | B | 태그 상수 · 무통보 변경 대응 없음 |
| 5.3.3/5.3.4 | 격리·모니터링 | B | 타임아웃 3단·kill switch·egress 감사+가드 3스펙 · 서킷 0·감시자에 AI 프로브 0 |
| 6.6~6.8 | 위원회 지표·이상알림·검토시간 | C/D/D | QI 대시보드 AI 0 · `AnomalyDetection` 은 PHI 열람만 · `presentedAt` 없음 |
| 7.5 | 신뢰도 표시·IEC 62366 | C | 화면마다 다름 · R7 하드코딩 · 62366 0 |
| 7.7/7.9 | 편향 완화·교육 강제 | C/D | 기본 접힘·기본 OFF 는 있음 · 지연 노출 0 · 자격 강제 0 |
| 8.4~8.6 | 보존 법률검토·라이선스·키/인젝션 | C/D/B·D | `legalConfirmed` 전부 false·보존 3값 충돌(R11) · 모델 라이선스 검토 0 · 시크릿 fail-closed B / 프롬프트 인젝션 입력 필터 1곳(consent) D |

## 3. 부족한 부분 → 기획서

공백은 이 문서에 나열하지 않고 **하나의 기획서**로 모은다: [`ai-judgment-governance.plan.md`](01-plan/features/ai-judgment-governance.plan.md).
기획서는 저장소 관례(§0 축 정의 → §1 실측 → §2 설계 → §3 단계 → §5 가드(재주입) → §6 사람 결정 표)를 따르며, 사람 결정은 문서가 아니라 **결정 등록부(`decision.registry.ts` · `/admin/decisions`)에 등재**한다 — 문서에 있는 동안엔 아무도 고를 수 없다.

---

## 4. 사람이 결정해야 할 지점 (질의서 §11 D1~D9) — 결정 등록부 대조

정본 `decision.registry.ts` 56건 중 AI 축 6 + 프라이버시 축 2 = **8건이 AI 관련**. 아래 표의 "등록부에 없음"은 **신설 대상**이다(문서에 있는 동안엔 아무도 고를 수 없다).

| # | 결정 | 등록부 대응 | 상태 |
|---|---|---|---|
| D1 | 거부된 AI 제안 보관 | **없음** (`draft.retention` 은 초안 일반) | 거부는 코드에도 흔적이 없다(§2.3 6.1) → 신설 |
| D2 | 책임 귀속 규정 | **없음** (간접: `legal.ai.deviceClassification` legalReview 1줄) | 코드 규약은 있음(AI 는 저자 아님·`signedBy` 불변) → 결정 항목 신설 |
| D3 | 모델 교체 시 재검증 | **없음** (인접 `policy.aiQualityThreshold` UNSET) | 모델 레지스트리 자체가 없어 결정해도 집행 불가 → P1 뒤 신설 |
| D4 | 환자 고지 범위 | **없음** | `ai.disclaimer`·`AI_ORIGIN_TEXT` 물증은 있으나 "어디까지 고지"는 미결 → 신설 |
| D5 | 자동 승인 허용 범위 | **있음** `policy.ai.autonomyScope`(IC/AI · 선행 `legal.ai.deviceClassification`) | 현행 `NONE`·statusQuo "자동실행 기본 금지" · 선행 미결이라 의결해도 미적용 |
| D6 | 추론 위치 | **있음** `legal.phiBoundary.gpuTier` + `legal.aiEgress.transferScope`(LH) | 🔴 2026-07-15 부터 미결(최장기) · INV-PHI-03 FAIL |
| D7 | 원내 데이터 학습 활용 | **없음** | 문서 1줄(Phase 5+) · no-training 계약 근거 없음 → 신설 |
| D8 | AI 승인 권한자 | **부분** — 항목 없음, 각 결정의 `authority` 문자열만 | 🔴 "의료기기·AI 거버넌스 위원회"는 엔진 시드에 없음(R9) · `UserRole` 에 전공의 없음 |
| D9 | 신설 구성요소 운영 주체 | **부분** — `CommitteeSurfaceMap` 시드로 AI 표면 6건 → QPS 담당 등재 | "담당 등재는 결정이 아니다"(코드 주석) → 신설 |

## 5. 진행 기록

- 2026-09-09 문서 개설 · 질의서 등재 · 층별 조사 5건 착수
- 2026-09-09 **P0 배포**(`8d114c2c` · 기획서 §3 P0 8건 전부 · 4기 병렬·재주입 역검증) — 운영 실측: egress 허용 목록 적용(부팅 ERROR 없음)·전송 로그 `mode:REHEARSAL`·감사 앵커 v2 8건(`verify` hashVersion 2)·컨시어지 응답에 `source` 실림 · MDT 는 운영 `mdt_cases` 0행이라 라이브 실측 불가(단위+가드) · 🔴 부산물: AI 서버에 `gemma3:12b` 가 없어(이전 후) 컨시어지가 상시 FALLBACK — 하드코딩 모델 태그의 실제 피해 · api 11,136·web 1,581·스모크 29 통과
- 2026-09-09 조사 5건 완료 → §2 판정 시트(필수 53: A9·B16·C15·D12·N/A1)·항목별 등급·실질 위험 R1~R12·D1~D9 대조 등록 · 공백 기획서 `ai-judgment-governance.plan.md` 작성
