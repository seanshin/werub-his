# 루프 플랫폼(LoopSpec) 도입 검토·보완 — 기획서

> 작성 2026-08-20 · 상태 **L0 역기술 완료 · L1 표현력 판정 완료(§4-L1) · 도입 미착수** · 정본 위치는 §0.
> 판정 = **보완 후 채택 가능 · 범위 = AI 루프에 한정 · L2~L3, L4 는 조건부**(§4-L1 (5)).
> 외부 설계서 `루프_플랫폼_설계.md` + `loopspec.schema.json`(2026-08-20 수령, 저장소 밖)에 대한
> **이 저장소의 실측 기반 검토**와, 그것을 받아들이기 위해 **먼저 고쳐야 할 것**을 적는다.
>
> 🔴 이 문서는 "루프 플랫폼을 만들자"가 아니다. **이미 조각으로 존재하는 것을 세어 보고**, 선언형이
> 그 조각들보다 나은지, 어떤 조건에서 나은지를 판정하는 문서다. 조각을 세지 않고 플랫폼을 만들면
> 이 저장소가 여러 번 저지른 실수(정본이 둘·문서와 배선 불일치)를 **자동 생성으로 증폭**한다.

## 0. 이 문서의 위치 — 정본이 둘이 되지 않게

| 축 | 정본 | 이 문서와의 관계 |
|---|---|---|
| 외부 설계서 원문(LoopSpec v1 스키마·12종 산출물·22 lint) | `루프_플랫폼_설계.md` · `loopspec.schema.json`(**저장소 밖**) | 원문을 복사하지 않는다. **불일치와 보완만** 적는다 |
| 역기술 파일럿 산출물 | `loopspec-pilot-interpret-lab.yaml`(L0) · `-recommend-drugs.yaml`(L1 A) · `-vitals-ingest.yaml`(L1 B) · `-patient-brief.yaml`(L1 C) | **실물에서 읽은 값만** · 하드락·미보유 필드는 비운다 · 검증 = `scripts/loopspec-validate.mjs` |
| 에이전트 관계 모드·출처 3상태·초안≠확정·분모 병기 | `clinical-ux-agent-era.plan.md` §2·§7 | LoopSpec 이 이 규약을 **표현할 수 있는지**가 채택 조건 |
| 차트 진료 보조 실측(스킬·검증층·하이브리드) | `chart-ai-assistant-agent.plan.md` §1.4~§1.6·§4.4 | 이 문서의 실측 근거 대부분이 여기서 온다 |
| 경보 등록부·예산·라우팅 | `alert-registry.plan.md` | LoopSpec `budgets.alerts` 의 현실 대응물 |
| AgentEMR 자율성·S1~S4·감사 | `agent-emr-alignment.plan.md` | LoopSpec `risk.tier`·`samd_assessment` 의 현실 대응물 |
| 폐쇄망 vs 위탁·외부전송 경계 | `tier-split-appliance.plan.md` | `risk.privacy.external_model_transfer` 의 선결 조건 |
| 코드 정본(툴·검증·브리핑·경보·게이트) | §5 매핑표 | LoopSpec 블록이 **이미 무엇에 대응하는지** |

---

## 1. 실측 — 우리는 이미 무엇을 갖고 있나

🔴 **선언형의 이점은 "없는 것을 만든다"가 아니라 "흩어진 것을 한 곳에 모은다"이다.** 그러므로 먼저 흩어진 것을 센다.
아래는 2026-08-19~20 이 저장소에서 **직접 계측**한 값이다(추정 없음).

| LoopSpec 블록 | 이 저장소의 현재 대응물 | 상태 |
|---|---|---|
| `spec.tools` | `modules/orchestrator/tool-registry.ts` | **있음**(선언은 코드) |
| `spec.verification.rules` | `medical-ai/ai-verify.ts` — **9규칙**(2026-08-20 재실측: `grep -c "^export function check" ai-verify.ts` = 9 → `KOREAN`·`MIXED_SCRIPT`·`LAB_DIRECTION`·`ONLY_PROVIDED_TESTS`·`SEX_AGE`·`FORBIDDEN_ADVICE`·`DRUGS_RESOLVABLE`·`DRUG_NAME_SCRIPT`·`NON_EMPTY:<필드>`) | **있음**(2026-08-19~20 신설 · 종전 이 표의 "6규칙"은 §4-L1 재실측으로 정정) |
| **정본 재검증 층**(대응 블록 없음) | `medical-ai/drug-verdict.ts` — 약가마스터 특정(`EXACT/INGREDIENT_GROUP/AMBIGUOUS/NONE`) → `DurService.checkInteractions` → `durVerdict` | **있음 · LoopSpec 에 자리 없음**(§4-L1 N1) |
| `spec.context.resources` | `medical-ai/patient-brief.service.ts`(배치 A·결정론) + 스킬별 직접 조회 | **부분**(화이트리스트 아님·`purpose` 없음) |
| `spec.context.precompute` | 같은 파일(야간 크론·이벤트 무효화·`ai.brief.batch.enabled`) | **있음** |
| `reasoning.on_insufficient_evidence` | `medical-ai/ai-grounding.ts` — `UNAVAILABLE`(부르지 않음) 4 사유코드 | **있음** |
| `output.presentation.show_coverage_note` | 스킬 봉투의 `groundedOn`(무엇만 봤는지) | **있음** |
| `output.write_back` (unsigned 고정) | `<DraftBanner>` + `POST /ai/draft-applied`(감사 원장) | **부분**(스키마 프로비넌스 부재 — 사람 게이트) |
| `budgets.alerts` | `notification/alert-registry.ts` — **66종 등재·전부 UNAPPROVED** | **있음**(P0 인구조사 완료) |
| `budgets.latency` | 스킬 봉투 `latencyMs` + `skill-metrics` p50/p95 | **있음**(측정만·강제 없음) |
| `rollout.kill_switch.auto_trip` | `ai.skill.quality.{minAiRate,minCalls,action}` 3상 게이트 | **있음**(2026-08-20 신설·기본 OFF) |
| `evaluation.gates` | `skill-metrics`·`draft-metrics`(무수정 승인율) | **부분**(CI 차단 배선 없음) |
| `risk.ai_disclosure` | shared `AI_ORIGIN_TEXT` + config `ai.disclaimer` | **있음** |
| `audit.record` | `AuditLog` + `Ai*`/`Ai*Outcome`/`AiDraftApply`/`AiDraftOutcome` | **있음**(루프별 테이블은 없음) |
| `audit.access_log_identity`(AI 열람) | `@AuditAiRead(<resourceType>)` — **2026-08-20 신설 · 23 EP 배선**(재실측: `grep -rn "@AuditAiRead(" apps/api/src \| grep -v spec \| wc -l` = 23). 인터셉터가 READ 1행 + `patientBound=true\|false` 를 남긴다(`audit.interceptor.ts:103,127-133`) | **있음**(🔴 크론·서버-서버 경로는 `user.id` 가 없어 여전히 탈락 — `:117`) |
| `metadata.approvals` | `/admin/go-live` 레지스트리 + 거버넌스 엔진(GOV 발번·의결) | **있음** |
| `spec.eligibility` | 없음(스킬마다 인라인 조건) | **없음** |
| `metadata.lifecycle`(shadow→limited→general) | 없음(config on/off 뿐) | **없음** |
| Capability Catalog 전 8종 | 없음 | **없음** |

**판정**: 12종 산출물 중 **8종의 재료가 이미 코드에 있다.** 없는 것은 ① 선언(YAML) ② 라이프사이클 ③ 카탈로그 ④ 컴파일러다.
🔴 그러므로 이 저장소에서 LoopSpec 의 실익은 **"안전장치를 새로 만든다"가 아니라 "이미 만든 안전장치가 루프마다 빠지지 않게 한다"** 에 있다.
실제로 오늘 그 누락이 반복 관측됐다 — 검증층은 약물추천에만 있었고, 분모 병기는 화면마다 달랐고, `assertAiServerUrl` 은 9곳이 부른다는 주석과 달리 **2곳만** 불렀다.

---

## 2. 스키마 ↔ 설계서 불일치 (채택 전 정정 필요)

원문을 그대로 쓰면 **문서가 보장한다고 말한 것을 스키마가 강제하지 않는** 상태로 시작한다. 이 저장소가 반복해서 다친 지점이다.

| # | 불일치 | 위치 | 수정 제안 |
|---|---|---|---|
| **A1** | 🔴 **JSON Schema 의 `default` 는 값을 주입하지 않는다**(주석일 뿐). 문서는 `determinism.threshold_evaluation`(L06 근거)·`optional:false`·`opt_out_respected`·`version_pinning`·`require_unexpired` 를 보장처럼 서술한다. 게다가 **`reasoning` 블록 자체가 optional** 이라 통째로 없으면 L06 이 검사할 대상조차 없다 | schema `$defs.Reasoning`·`Rollout` | 기본값 의존 금지 — 컴파일러가 **정규화 단계에서 명시 주입**하고, 주입 결과를 산출물에 기록한다 |
| **A2** | `allOf[1]` 설명은 *"알림 예산과 **PPV 기준**이 필수"* 인데 실제 요구는 `budgets.alerts` 뿐. `min_ppv` 는 optional → **스키마가 실제보다 안전하게 말한다** | schema `Spec.allOf[1]` | 설명을 사실에 맞추거나 `min_ppv` 를 `then` 에 넣는다 |
| **A3** | `write_back` 에 `required` 가 없어 `write_back: {}` 통과. `status` **부재**가 L04 위반인지 불명 | schema `Output.write_back` | `target` 이 `none` 이 아니면 `status`·`signature_by` 필수 |
| **A4** | `tools` 블록이 optional. `resources: []` 는 "누락이 아니라 주장"이라 명시했는데 **툴에는 같은 규칙이 없다** | schema `Spec.properties` | `tools` 필수화 + `allow: []` 를 "툴 없음" 주장으로 |
| **A5** | 🔴 **버전 형식이 변경 유형을 표현 못 한다.** §7 은 patch/minor/**major** 를 구분하는데 `version` 은 `YYYY.MM.N`(증분 슬롯 1개) | schema `Metadata.version` | `change_class`(patch/minor/major) 필드 분리 또는 semver 채택 |
| **A6** | 🔴 **하드락(§6.2)을 스키마가 표현 못 한다.** `authoring.generated_by` 는 **문서 단위**라 `llm_draft_human_edited` 가 되는 순간 "이 `risk.tier` 를 누가 채웠는가"를 알 수 없다. L22 는 `reviewed_by` 유무만 본다 | schema `Metadata.authoring` | **필드 단위 출처** 또는 하드락 필드를 **별도 서명 오버레이**로 분리(LLM 산출물에는 부재가 강제) |

---

## 3. 🔴 이 저장소 실측이 요구하는 보완 (가장 중요)

아래는 **오늘 실제로 봉합한 결함**이 LoopSpec 에 그대로 재발할 수 있음을 보여준다. 채택 시 **선결 조건**으로 다룬다.

| # | 보완 | 실측 근거(이 저장소) |
|---|---|---|
| **B1** | 🔴 **`verification.on_fail` enum 에서 `drop_silently` 제거** | 제1규칙("실패는 실패라고 말한다") 정면 충돌. 오늘 고친 것이 정확히 이것 — 감별진단 `catch {}` 침묵으로 15~23초 뒤 빈 화면이 "아직 안 눌렀다"처럼 보였고, PACS 프록시가 401 을 `{count:0}` 으로 덮었다 |
| **B2** | 🔴 **`budgets.latency.on_timeout` 기본값을 `fallback_message` 로** | `fallback_silent` 를 **기본값**으로 두면 침묵 폴백이 설계에 박힌다. "EMR 동작을 막지 않는다"와 "사용자에게 알리지 않는다"는 다른 문제다 |
| **B3** | **`eligibility.consent.on_missing: skip_silently` 는 감사 필수** | 동의가 없어 건너뛴 사실을 아무도 모르면 분모가 사라진다(§B6 와 같은 축) |
| **B4** | 🔴 **`audit.access_log_identity: agent_only` 는 lint ERROR 후보** | 의료법 §23④ 접속기록. 우리는 무인증 채널을 담을 원장이 없어 `PublicAccessLog` 를 신설해야 했다(AuditLog.userId 가 User FK) |
| **B5** | 🔴 **입력 측 "없음"의 3상태를 선언할 자리가 없다** | `on_insufficient_evidence` 는 **출력** 쪽만 다룬다. 실측: 프롬프트 조립 층 **26곳**이 `list.join() \|\| '없음'` 이라 **미문진 환자를 "알레르기 없음"으로 AI 에게 전제**시켰다 → `promptList`/`allergyPromptLine` 로 봉합. `resources[]` 에 **결측 표현 방식**(없음 확인/미문진/조회 실패) 선언 필드가 필요하다 |
| **B6** | 🔴 **`Kpi` 에 분자·분모가 없다** | 오늘 하루의 주제. **분모 0이면 완결률은 100%가 된다.** 표본 0을 0%로 읽어 "수술 취소 없음"·"ICU 여유 있음"으로 표시하던 것 **7건 봉합**. Metric Catalog 에 분자·분모 정의가 없으면 자동 생성 대시보드가 같은 거짓말을 한다 |
| **B7** | **`min_ppv` 를 요구하려면 baseline 이 선행돼야 한다** | 실측: override 는 **절대 건수만** 있고 분모가 없다. `GateViolationLog` 는 **1행**이었다(탐지기가 죽어 있었음). 경보 66종 전부 `UNAPPROVED`·읽음률 8.6% |
| **B8** | **`eligibility` 부재를 명시 선언으로** (`all_patients: true` + 근거) | `resources: []` 를 "주장"으로 다룬 것과 같은 논리. 우리는 야간 배치 대상을 "내일 예약+재원"으로 좁혀야 했다(전 환자 금지·PHI 최소) |
| **B9** | **루프별 감사 테이블 DDL 대신 공통 테이블 + 루프별 뷰** | 이 병원에서 스키마 변경은 사람 게이트이고 **지금도 4개 축이 그것 때문에 막혀 있다**(생체정보·환자설명 검수 큐·AI 초안 프로비넌스·알림 아카이브). 루프마다 DDL 이면 게이트가 N배. 오늘 우리는 스키마 없이 감사 원장에 **수치만** 넣어 우회했다(`AiDraftOutcome`) |
| **B10** | **산문 안의 PHI 방어가 약하다** | `redaction.tokenize` 는 구조화 필드(`patient_name`·`mrn`)만 가정한다. 실제 유출은 *"김영수님, 1958년생 남자분이시죠. 페니실린과 땅콩 알레르기가…"* 같은 **LLM 산문**이었다. 이를 잡을 `second_model.check: pii_leak` 은 **optional·기본 false** |
| **B11** | **루프 간 상호작용 규칙 부재** | L21(같은 훅 5개 초과 WARN)뿐. A 루프 초안을 B 루프가 읽는 순환, **같은 사실에 정본이 둘**(P12 — 이 저장소에서 반복 발생)을 감지할 규칙이 없다 |
| **B12** | **미서명 산출물의 소유권** | `version_pinning` 은 실행 중 워크플로만 다룬다. 루프가 `retired` 될 때 **이미 write-back 된 미서명 초안·미해결 에스컬레이션**의 처리 규칙이 없다 |
| **B13** | **`human_sampling_rate` 하한 부재** | shadow=1.0 강제는 좋으나 `limited`/`general` 에서 **0 도 유효**하다 |
| **B14** | 🔴 **카탈로그의 신선도(재실측) 개념이 없다** | L11 이 "카탈로그에 없는 ref 는 컴파일 실패"로 환각을 막지만, **카탈로그 자체가 틀리면 그 오류가 전 루프로 퍼진다.** 오늘 하루에만 카탈로그성 오류 3건: `ingredientCode` 가 성분이 아니라 **성분+염+함량+제형**(그래서 성분 그룹 판정이 구조적으로 0/10) · `assertAiServerUrl` 주석은 "9곳"인데 실제 **2곳** · 검색 파라미터가 `q` 인데 문서에 없어 **내 프로브가 3번 거짓말**했다. 카탈로그 항목에 **최근 검증일·검증 방법**을 필수 필드로.<br>🔴 **2026-08-20 추가 실증(§4-L1)**: 경보 등록부(`notification/alert-registry.ts`)의 `emitters` 줄번호가 **같은 날 드리프트했다** — `VITAL_ALERT` 가 가리키는 `vitals/vitals.service.ts:124` 는 실제로는 `extras: { bmi … }` 줄이다(발행은 `:156`→`:186`). 활력 수집 포트를 도입하며 파일이 바뀐 것이 원인이다. **카탈로그는 손으로 유지되는 순간부터 코드보다 늦는다** → `threshold_basis`(상수의 출처·계측 방법·교체 조건 · N10)도 같은 필수 필드로 |

---

## 4. 도입 경로 — 컴파일러가 아니라 **역기술 파일럿**부터

원 설계서 로드맵은 P0 스키마 → P1 카탈로그 → P2 컴파일러 → P3 런타임+루프 1개 순이다.
🔴 **이 저장소에서는 순서를 바꾸는 편이 안전하다.** 이유: §1 실측대로 재료 8종이 이미 코드에 있어, 카탈로그를 백지에서 채우는 것보다
**돌아가는 것을 LoopSpec 어휘로 되받아 적는 것**이 카탈로그 품질을 훨씬 빨리 올린다. 그리고 그 과정에서 §2·§3 의 결함이 즉시 드러난다.

| 단계 | 내용 | 산출물 | 게이트 |
|---|---|---|---|
| **L0 역기술 파일럿(권장 시작점)** | **이미 배포돼 돌고 있는 스킬 1개**를 LoopSpec 으로 역기술한다. 후보: `interpret-lab`(검사해석 — 검증층 5규칙·브리핑 주입·캐시·3상태 봉투가 전부 실재). YAML 을 **손으로** 쓰고 컴파일러는 만들지 않는다 | 루프 정의 1건 + **표현 불가 목록**(LoopSpec 으로 적을 수 없는 우리 규약) | 없음(CLI) |
| **L1 표현력 판정** ✅ **완료(§4-L1)** | 🔴 **L0 하나로는 판정할 수 없어 축 3개를 더 역기술했다**(A 약물추천·B 활력 수집 포트·C 환자 브리핑). 결과: L0 의 U1~U21 중 **L0 특유는 0건**(전부 구조적) · 신규 표현 불가 **16건** · 역방향 손실 **13건 추가** · 🔴 **비-AI 루프(B)는 대상 밖으로 판정** | §4-L1 + 파일럿 YAML 3건 | — |
| **L2 카탈로그 씨앗** | 파일럿이 실제로 참조한 것만 등재 — Tool(현 `tool-registry`)·Rule(`ai-verify` **9규칙** — §4-L1 재실측)·Resource(브리핑 8축)·Metric(**분자·분모 포함**·B6)·Event(무효화 6종). 🔴 등재 시 **최근 검증일·검증 방법 필수**(B14) | 카탈로그 4종 최소 세트 | 🔴 **착수 조건은 §4-L1 (6)** — S1~S4 선행 · Tool Tier2 등재는 위원회 |
| **L3 lint 먼저, 컴파일러 나중** | 22 lint 중 **우리 실측이 뒷받침하는 것부터** 구현(L05 서명·오더 툴 금지 · L06 임계를 LLM 에 위임 금지 · L07 알림 순증 금지 · L10 purpose 필수 · L11 카탈로그 참조 · L15 검증 없는 write-back 금지). 컴파일러 산출물 생성은 아직 안 한다 | `loopc lint` 만 | — |
| **L4 산출물 생성 2종** | 실익이 가장 큰 것부터: **거버넌스 문서 팩(3.12)** 과 **알림 예산 등록(3.11)**. 우리는 심의 문서를 손으로 쓰고 있고, 경보 66종이 등재만 되고 예산이 없다 | 문서 팩 · 예산 레지스트리 배선 | 🔴 **조건부(§4-L1 (5) 3번)** — 자동 생성 문서가 **실물보다 안전하게 말하는 경로 2건 확인**(R17 최소수집 근거표 · R22 규제 매핑). "생성 → 사람이 실물과 대조 → 서명"이 게이트 |
| **L5 런타임** | 그 다음. 🔴 **런타임을 먼저 만들면 기존 스킬과 정본이 둘이 된다**(이 저장소가 가장 많이 다친 방식) | — | 🔴 L0 결과 **채택 부적합** — 생성물이 현행보다 약하다(§4-L0 (3) R1·R6) |

**L0 파일럿의 성공 기준**(미리 못박는다): ① 검사해석 루프가 **지금 코드가 하는 것과 같은 것**을 선언으로 표현하는가 ② 표현 불가 항목이 몇 개인가 ③ 그중 §3 보완으로 해결되는 것과 **LoopSpec 구조상 불가능한 것**을 가른다.

### 4-L0. 역기술 파일럿 결과 (interpret-lab · 2026-08-20)

> 산출물 ① 루프 정의 = `docs/01-plan/features/loopspec-pilot-interpret-lab.yaml`
> 산출물 ② 검증 스크립트 = `scripts/loopspec-validate.mjs` (스키마 원본은 저장소 밖 — 복사하지 않았다)
> 대상 코드(전량 통독): `medical-ai.service.ts`(`interpretLab`/`interpretLabRun`/`skillContext`/`withSkillCache`/`chatLlm`/`aiFetch`/`skillMetrics`/`skillQuality`) ·
> `ai-verify.ts` · `ai-grounding.ts` · `patient-brief.service.ts` · `common/ai-skill-quality.ts` ·
> `common/util/ai-egress-{fetch,url}.ts` · `medical-ai.controller.ts` · `lab.{controller,service}.ts` ·
> `test/medical-ai/skill-contract-guard.spec.ts` · FE `AiAssistantPanel.tsx` · `ai-skill-modes.ts`
>
> 🔴 **작성 규칙**: 실물에서 읽은 값만 적고, 하드락(설계서 §6.2)·실물 미보유 필드는 **비웠다.**
> 그래서 파일은 스키마 검증에 **의도적으로 실패**한다 — 실패 목록이 곧 "우리가 못 채우는 필수 필드"다.

#### (0) 기계 검증 결과 — 실행 재현 가능

```
node scripts/loopspec-validate.mjs
# ajv 8.18.0 (draft 2020-12, allErrors) + ajv-formats 3.0.1 + js-yaml — 전부 저장소 node_modules
```

| run | 대상 | 결과 |
|---|---|---|
| **A** | 파일 그대로(하드락·미보유 필드 비움) | 🔴 **FAIL 6건** — `metadata.version` · `metadata.owners` · `spec.risk.tier` · `spec.context.auth.mode` · `spec.budgets.latency.p95_ms` · `spec.rollout.kill_switch.auto_trip[0].threshold` (전부 `must have required property`) |
| **B** | A + 자리표시 오버레이(값은 전부 가짜) | **PASS** — 나머지 역기술은 형식상 스키마와 맞는다 |

**run A 의 6건이 말하는 것**: 이 스킬은 배포돼 돌고 있는데 **버전도·오너도·tier 판정도·권한 모드도·지연 예산도·자동정지 임계도 실물에 없다.**
그중 `risk.tier` 와 `auto_trip[].threshold` 는 설계서 §6.2 **하드락**(LLM 이 채우면 컴파일러가 거부)인데 스키마는 **required** 다 —
🔴 **하드락과 required 가 교집합을 가져서, LLM 초안은 원리적으로 스키마 검증을 통과할 수 없다.** (설계서 §6.1 6단계 "loopc lint 자가수정 최대 3회"가 성립하지 않는다.)

#### (1) 담긴 것 — 깨끗이 표현된 부분

| 실물 | LoopSpec 필드 | 비고 |
|---|---|---|
| 야간 배치 크론 `@Cron('0 2 * * *')` (`patient-brief.service.ts:192`) | `triggers[].type: schedule` + `cron` | 유일하게 손실 없이 담긴 트리거 |
| 브리핑 무효화 이벤트 6종(`@OnEvent` lab.result.completed/verified · dispensing.completed · admission.created · encounter.signed · vitals.recorded) | `context.precompute.invalidate_on[]` | 6개 전부 1:1 |
| 브리핑 TTL 24h | `context.precompute.ttl: P1D` | |
| 리소스 4축(문제목록 30 · 활성처방 50 · 최근검사 P30D/10 · 인구학) | `context.resources[]` + `purpose`/`lookback`/`limit` | `purpose` 강제는 우리에게 **없던 규율**이다(§1 "purpose 없음") — 실익 |
| 툴 미사용 | `tools.allow: []` | |
| write-back 없음 | `output.write_back.target: none` | |
| 사이드패널·비침습 표시 | `output.presentation.surface/intensity` | |
| `groundedOn`("무엇만 봤는지")·잘림 고지 | `presentation.show_sources`/`show_coverage_note: true` | |
| 타임아웃 시 정직한 폴백 메시지 | `budgets.latency.on_timeout: fallback_message` | **우리가 이미 B2 권고대로 하고 있다**(스키마 기본값이 우리보다 나쁘다) |
| `num_predict: 800` | `budgets.cost.max_tokens_per_invocation` | 출력 토큰 상한 ↔ 호출당 총 토큰 — **근사 매핑** |
| 킬스위치 2단(`ai.server.enabled` · `ai.skill.quality.action`) | `rollout.kill_switch.granularity: [global, loop]` | |
| 감사 주체 = 호출한 임상의 | `audit.access_log_identity: clinician_of_record` | |
| 검증 규칙 **이름** 6종 | `verification.rules[]` | 이름만 — 아래 U6 참조 |
| AI 고지 필요 | `risk.ai_disclosure.required: true` | 문구 자체는 담기지 않는다(U13) |

#### (2) 🔴 못 담은 것 — ⓐ실물 ⓑ왜 못 담나 ⓒ어떻게 고치면 담기나

세는 단위는 **"스키마 필드 또는 블록 1개"**. YAML 안에서 `🔴` 로 표시한 자리를 묶어 **21건**으로 정리했다(원문 표시 56회 = 중복 설명 포함).

| # | 항목 | ⓐ 실물(근거) | ⓑ 왜 표현 불가 | ⓒ 스키마 수정안 |
|---|---|---|---|---|
| **U1** | **사용자 행위 트리거** | 사람이 패널을 펼치고 버튼을 눌러야 LLM 이 불린다(`AiAssistantPanel.tsx:339` 기본 접힘 · `:573` `handleInterpretLab`) | `Trigger.hook` enum 9종에 "이 버튼을 눌렀다"가 없다. `note-open` 은 **거짓**(접힌 상태에서는 부르지 않는다), `inbound/EMR_QUERY_BOX` 는 질의창 | `type: user_action` 신설(`surface`·`control_id`) 또는 `hook` 에 `explicit-invoke` 추가 |
| **U2** | **한 스킬 = 세 진입경로** | ①POST `/ai/interpret-lab` ②야간 배치 ③GET `/lab/orders/:id/ai-interpret`(`lab.controller.ts:384` · **호출 화면 0건** — `grep -rn "ai-interpret" apps/web/src apps/mobile` = 0) | `lane`·`audience.roles`·`budgets`·`audit` 이 **루프당 1개**다. ②는 async·60초 예산·감사 없음, ③은 LAB_TECH·ADMIN 까지 열려 있고 ~~감사행이 아예 안 남는다~~ → ✅ **2026-08-20 회수**(`@AuditAiRead('AiLabInterpret')` · `lab.controller.ts:385`). 🔴 다만 회수 방식이 **EP 단위 데코레이터**라 U2 의 지적은 오히려 강화됐다 — 같은 스킬의 두 경로가 서로 **다른 resourceType**(`AiInterpretLab` vs `AiLabInterpret`)으로 남아 계측 분모가 갈린다 | `triggers[]` 항목별 `overrides:{lane,roles,budgets,audit}` 허용, 또는 진입경로마다 루프를 쪼개고 `shared_spec_ref` 로 묶기 |
| **U3** | **권한 모드** | 컨트롤러가 역할만 확인하고(`@Roles` `medical-ai.controller.ts:412`), 서비스는 **서버 자격**으로 Prisma 직접 조회(`:1236-1242`) | `auth.mode` enum 둘 다 거짓 — `on_behalf_of`(토큰 교환·권한 교집합) 아니고 `service_account_minimal`(최소 스코프) 도 아니다. 🔴 L03 은 hook 트리거에 `on_behalf_of` 를 **강제**하므로, 적으면 **없는 통제를 있다고 선언**하게 된다 | `role_gated_service`(역할 게이트 후 서비스 자격) 값 추가 + 컴파일러가 "권한 교집합 미적용"을 산출물에 명시 |
| **U4** | **출처 3상태 봉투** | 모든 응답에 `source`(AI/FALLBACK/UNAVAILABLE)·`reason`·`verify.{passed,failed}`·`latencyMs`·`groundedOn`·`cached/cachedAt` 가 붙는다(`ai-verify.ts:13-26`). 화면이 이걸로 분기(`AiAssistantPanel.tsx:241-266`) | `output` 블록에 봉투 슬롯이 없다. `kind`·`schema_ref`·`presentation` 은 **본문**만 다룬다 | `output.envelope: {origin_states[], reason_codes_ref, expose_verification: true}` 신설 — 정본은 이미 shared 에 있다 |
| **U5** | **검증 실패 시 동작** | 본문을 **지우지 않고** `FALLBACK` + `VERIFY_REJECTED:<규칙>` 으로 표시, 화면이 실패 규칙을 나열하고 적용 버튼을 막는다(`ai-verify.ts:216-243`) | `on_fail` enum 4값 중 없음 — `handoff`(사람 큐 없음)·`block`(본문 삭제)·`regenerate_once_then_handoff`(재생성 안 함)·`drop_silently`(**침묵 — §3 B1 이 제거를 요구한 값**) | `label_and_degrade` 추가 + `drop_silently` **제거**(B1 확인됨) |
| **U6** | **검증 규칙의 실체** | `KOREAN` 임계 0.3(`ai-verify.ts:38`) · `LAB_DIRECTION`/`ONLY_PROVIDED_TESTS` 는 **입력 ↔ 출력 대조**(`:59-79`) · 전 규칙 평가 후 **실패 집합 전체**를 낸다(`:228-232`) | `rules: [string]` 은 이름만. 파라미터 슬롯 없음. 입력 대조 슬롯은 `numeric_crosscheck`(boolean·수치 전용) 하나뿐 — "flag 방향 반전"·"보내지 않은 검사 언급"은 수치 대조가 아니다. 설계서 §3.8 은 "순서대로" 체인이라 실패 집합 개념이 없다 | `rules[]` 를 객체로(`ref`·`params`·`inputs[]`·`severity`) + `evaluate: all`(집합 보고) 옵션 |
| **U7** | **근거 부족 시 동작** | 3상태 — 부르지 않음(`aiUnavailable` `lab.service.ts:93-100`) / 불렀으나 실패해 **규칙 결과를 내되 "AI 소견 아님"이라 말함**(`medical-ai.service.ts:1315-1348`) / 통과 | `on_insufficient_evidence` enum(omit_with_reason/handoff/return_empty)에 "결정론 폴백 + 출처 강등"이 없다. `return_empty` 는 이 저장소가 명시적으로 금지한 동작(`skill-contract-guard.spec.ts:35` "빈 배열은 성공이 아니다") | `deterministic_fallback_labeled` 추가 · `return_empty` 를 lint WARN 이상으로 |
| **U8** | 🔴 **입력 측 "없음" 3상태** (§3 B5 **확인됨**) | 프롬프트에 `promptList()` 가 들어간다 — 비면 `"기록 없음(등록 항목 0건 — '없음'으로 확인된 것은 아님)"`(`ai-grounding.ts:55-61`). 검사해석 프롬프트가 실제로 이걸 쓴다(`medical-ai.service.ts:1270`) | `resources[].optional` 은 boolean(진행 vs handoff)뿐. **"결측을 프롬프트에 어떻게 말하는가"** 선언 슬롯이 없다. `on_insufficient_evidence` 는 출력 쪽만 다룬다 | `resources[].on_missing: {declare_as: unrecorded\|confirmed_none\|query_failed, prompt_text_ref}` |
| **U9** | 🔴 **Kpi 의 분모** (§3 B6 **확인됨**) | `aiRate = aiOk/calls`, **calls 0 이면 `null`**(0 아님 · `ai-skill-quality.ts:121-122`), 표본 20 미만이면 판정 보류(`:136`) | `Kpi` = `{id, direction, target, baseline, dashboard}` — 분자·분모·표본하한·"표본 0의 값" 규약이 없다. 자동 생성 대시보드는 **표본 0을 0%로 그린다** | `Kpi.numerator`/`denominator`/`min_sample`/`no_sample_value: null` 필수화 · Metric Catalog 등재 시 분모 정의 필수 |
| **U10** | 🔴 **자동정지의 표본 하한** (§3 B7 축) | `judgeSkillQuality` 는 `calls < minCalls`(기본 20) 면 **어떤 조치도 하지 않는다**(`ai-skill-quality.ts:136`) | `auto_trip` = `{metric, operator, threshold, window}` 넷뿐 → **호출 1건에도 자동 정지가 걸린다**(거짓 경보가 진짜 경보를 죽인다) | `auto_trip[].min_sample` 추가 + 미달 시 상태를 `INSUFFICIENT_SAMPLE` 로 내보내기 |
| **U11** | 🔴 **하드락 ∩ required** (§2 A6 인접) | 설계서 §6.2 는 `risk.tier`·`samd_assessment.status`·`approvals`·`auto_trip[].threshold`·`audit.retention.*` 를 LLM 이 **비워야** 한다고 못박음 | 그중 `risk.tier`·`auto_trip[].threshold`·`audit.retention.audit_log` 는 스키마 **required** → run A FAIL 3건이 정확히 이것 | 하드락 필드를 **별도 서명 오버레이 문서**로 분리(`Loop` 는 `overlay_ref` 만 갖고, 오버레이 부재 시 lifecycle 상한 `draft`) |
| **U12** | 🔴 **출처가 문서 단위** (§2 A6 **확인됨**) | 이 YAML 에서 `cron`·`invalidate_on` 은 코드 실측, `lifecycle: general`·역할 매핑은 **내 판단**이다 | `authoring.generated_by` 는 문서 하나에 하나. 필드 단위 출처가 없어 `# 근거:` **주석**이 그 역할을 대신하는데 **주석은 컴파일러가 읽지 않는다** | `provenance: {<json-pointer>: {source: code\|human\|llm, ref}}` 맵 신설 |
| **U13** | 🔴 **`default` 미주입** (§2 A1 **확인됨** — 3자리에서 실제로 물었다) | ① `privacy.external_model_transfer` 비움 → 문서상 `TOKENIZED_ONLY` 로 읽히나 **실물엔 토큰화가 없다** ② `on_timeout` 비웠으면 `fallback_silent`(우리는 message) ③ `version_pinning`·`opt_out_respected`·`require_unexpired` 동일 | JSON Schema `default` 는 값을 주입하지 않는다 — **비운 자리가 "안전한 기본값"으로 읽힌다**(가장 위험한 형태의 침묵) | 컴파일러 정규화 단계에서 **명시 주입 + 주입 사실을 산출물에 기록**, 안전 계열(`on_timeout`·`external_model_transfer`)은 `default` 제거하고 **required** 로 |
| **U14** | **외부 전송 상태** | `ai.server.url`(런타임 config)로 임상 텍스트가 실제로 나간다(`ai-egress-fetch.ts:111`). `AI_EGRESS_ALLOWED_HOSTS` **미설정이면 호스트 제한이 걸리지 않는다**(`ai-egress-url.ts:18-19,45-54`) | enum 3값 중 없음 — FORBIDDEN(아님)·TOKENIZED_ONLY(토큰화 없음)·ALLOWED_IN_REGION(리전 확인된 적 없음) | `ALLOWED_UNVERIFIED`(+`allowlist_enforced: bool`) 추가. 값이 이것이면 lifecycle 상한 `limited` |
| **U15** | **주 입력이 리소스가 아니다** | 해석 대상 검사는 요청 본문 `results[]` 로 온다(`dto/medical-ai.dto.ts:264-266` — `@IsArray()` 뿐, 항목 검증 없음) | `context.resources` 는 서버측 조회 화이트리스트다. **호출자가 실어 보내는 임상 데이터**를 선언할 자리가 없다 — 그런데 과거 사고가 정확히 여기서 났다(`results:[{testName:<주호소>, value:'pending'}]` · `ai-grounding.ts:6-8`) | `context.inputs[]`(스키마·근거 게이트·거부 조건) 신설 |
| **U16** | **캐시가 둘** | 브리핑(`ai:brief:<pid>` TTL 24h)과 실시간 응답 캐시(`ai:skill:interpretLab:<sha256>` TTL 600s, **`source:'AI'` 만 저장** `medical-ai.service.ts:974,985-1003`) | `precompute` 는 `ttl` 1개·`invalidate_on` 1벌. "실패·폴백은 캐시하지 않는다"라는 안전 규약을 적을 자리가 없다 | `caches[]` 배열화(`key_shape`·`ttl`·`store_only_when`·`invalidate_on`) |
| **U17** | **`enabled` 가 boolean 이 아니다** | 예열 스위치가 config 두 개(`ai.brief.batch.enabled` · `ai.brief.llm.enabled`) 이고 **둘 다 기본 OFF**(`patient-brief.service.ts:194-199`) | `precompute.enabled: boolean` — true/false 어느 쪽도 배포 상태와 어긋난다. `lifecycle` 도 같은 문제(실물의 "켜짐"은 config 3개의 곱) | 게이트 값을 `config_ref`(키 + 기본값 + 현재값 조회 경로)로 받기 |
| **U18** | **자유 텍스트 방어** (§3 B10 **확인됨**) | `clinicalContext` = 의사가 타이핑한 `soap.subjective` 가 **그대로** 프롬프트로(`AiAssistantPanel.tsx:600` → `medical-ai.service.ts:1268`). `redactIdentifiers` 는 이 경로가 부르지 않는다(파일 내 호출 1회, 영상 판독 전용 `:2283-2287`) | `redaction.tokenize` 는 구조화 필드 enum 6종. "자유 텍스트 필드가 무검사로 나간다"를 적을 수 없다 | `redaction.free_text_fields[]` + `on_unredactable: block\|warn\|allow_with_note` |
| **U19** | **부재의 주장** (§3 B8 **확인됨**) | scope 제한 없음 · exclude 없음 · **환자 동의 확인 0건**(`grep aiConsent\|AI_CONSENT\|ai.consent` in medical-ai = 0) · 지식베이스 없음 · 원시 대화 미저장 | `resources: []` 만 "누락이 아니라 주장"으로 인정된다. 나머지 블록은 **생략 = 누락과 구분 불가**. 특히 `consent` 를 빈 객체로 두면 "동의 요건 없음"으로 읽혀 **실물보다 안전하게 들린다** | 각 블록에 `asserted_absent: {reason}` 또는 문서 수준 `assertions[]` |
| **U20** | **모델·프롬프트 정체** | 모델은 **상류가 고른다**(`quality_check:true` · `medical-ai.service.ts:530-549`), 실패 시 `qwen2.5:14b` 하드코딩 폴백(`:561`). 실제 모델은 debug 로그에만(`:546`) — **감사에 없다**. 프롬프트는 **인라인 템플릿 리터럴**(`:1268-1278`) | `model_class` enum 에 "상류 위임 — 알 수 없음"이 없다. `prompt_template` 은 레지스트리 ID 만 받는데 우리에겐 레지스트리가 없다 | `model_class: delegated_upstream` 추가 + `model_id_recorded: bool` 로 감사 가능 여부를 **드러내기** |
| **U21** | **역할 어휘** | `@Roles(DOCTOR, NURSE)` (2번째 경로는 `LAB_TECH, ADMIN` 까지) | enum 10종에 `ADMIN` 이 없고, 우리 `DOCTOR` 하나가 ATTENDING·RESIDENT·PA 를 덮는다 → 매핑이 **실물보다 세분화된 척**(허위 정밀도)한다 | `roles` 를 병원 RBAC 카탈로그 참조(`ref`)로 — 어휘를 스키마에 박지 않기 |

**§2·§3 지목분 확인 결과**: A1 **물었다**(U13·3자리) · A6 **물었다**(U12) · B1 **물었다**(U5 — `drop_silently` 가 우리 동작 자리를 차지하고 있다) ·
B2 **반대로 물었다**(U13② — 우리는 이미 `fallback_message` 인데 **스키마 기본값이 우리를 후퇴시킨다**) · B5 **물었다**(U8) · B6 **물었다**(U9) · B8 **물었다**(U19) · B10 **물었다**(U18) ·
A3(`write_back` required 부재)은 이 루프가 `target: none` 이라 **이번엔 물지 않았다**(초안 계열 루프에서 재검증 필요) · A4(`tools` optional)는 `allow: []` 로 우회했으나 그것이 "주장"인지 스키마 문언상 **불명확한 채로 남았다**.

#### (3) 역방향 손실 — 이 LoopSpec 으로 컴파일하면 실물보다 **덜 안전해지는** 지점

🔴 이것이 §4 L5(런타임)를 미루라고 한 이유의 실증이다. 아래는 전부 "산출물이 현행 코드보다 약해지는" 방향이다.

| # | 손실 | 결과 |
|---|---|---|
| **R1** | `verification.rules[]` 가 **이름만** 남는다 | `LAB_DIRECTION`(flag ↔ 해석 방향 대조)·`ONLY_PROVIDED_TESTS`(보내지 않은 검사 언급)는 **입력을 봐야** 하는데 생성된 파이프라인에 입력이 없다. `KOREAN` 임계 0.3 도 사라진다 → 🔴 **"K 5.9(H) 를 저하라고 말함"·"미입력 WBC 언급" 두 실측 결함이 그대로 재현된다**(`skill-contract-guard.spec.ts:78-88` 이 가드하는 바로 그것) |
| **R2** | `on_fail` 에 우리 동작이 없다 | 넷 중 무엇을 골라도 후퇴한다 — `block`(본문 삭제 → 의사가 왜 막혔는지 모름) · `handoff`(받을 큐가 없다) · `drop_silently`(침묵 = B1 이 제거를 요구한 값) |
| **R3** | `on_timeout` 기본값 `fallback_silent` | 현행은 "AI 소견으로 쓸 수 없음 — 규칙 기반 대체"를 화면에 띄운다. 기본값에 맡기면 **조용히 사라진다** |
| **R4** | `auto_trip` 에 표본 하한이 없다 | 호출 1건의 폐기율로 스킬이 자동 정지된다(현행은 표본 20 미만이면 판정 보류). 반대로 threshold 가 하드락이라 비어 있으면 **아무 것도 안 한다** — 둘 다 현행보다 나쁘다 |
| **R5** | `Kpi` 분모 소실 | 대시보드가 **표본 0을 0%** 로 그린다(현행은 `null` + "산출 불가"). 이 저장소가 7건 봉합한 거짓말이 자동 생성으로 되돌아온다 |
| **R6** | `audit.record` enum 에 `source`·`reason`·`latencyMs` 가 없다 | 이 3키가 `skillMetrics`·`skillQuality`·킬스위치의 **유일한 재료**다(`medical-ai.controller.ts:232-235` → `medical-ai.service.ts` `skillMetrics`(:2687·:2699)·`skillQuality`(:2714)). 감사 DDL 이 자동 생성되면 **계측 전체가 무력화**된다 |
| **R7** | `auth.mode: on_behalf_of` 를 적으라는 L03 | 없는 권한 교집합을 있다고 선언한다 — 권한 번들(§3.2)이 "계산된 최소 스코프"를 출력하지만 런타임은 여전히 서버 자격으로 읽는다. **문서가 실물보다 안전하게 말한다** |
| **R8** | 표현 가능한 트리거가 하나뿐 | 컴파일러가 배선하는 것은 **기본 OFF 인 야간 배치**뿐이고, 실사용 경로(버튼)와 고아 EP 는 산출물 밖에 남는다 |
| **R9** | `UNAVAILABLE` ↔ `FALLBACK` 구분 소실 | 화면이 "산출 불가(부르지 않았다)"와 "믿을 수 없다(불렀으나 실패)"를 같게 그린다 — `ai-grounding.ts:19-20` 이 명시적으로 금지한 것 |
| **R10** | 프롬프트가 레지스트리로 이동 | `promptList`/`allergyPromptLine` 의 **3상태 규약이 템플릿 밖에** 남는데 선언 슬롯이 없다(U8) → 템플릿 작성자가 `|| '없음'` 으로 되돌리는 것을 막을 장치가 사라진다 |

#### (4) 🔴 판정

> ## 🔴 판정 = **보완 후 채택 가능**
> 단 아래 **차단 조건 6건**이 스키마에 반영되기 전에는 **어떤 루프도 `shadow` 를 넘길 수 없다.**

근거: run B 가 PASS 했다는 것은 **구조(블록 구성)는 우리 실물에 맞다**는 뜻이고, U1~U21 은 대부분 **필드·enum 값 추가**로 해결된다(구조 변경 없음).
반면 하드락 ∩ required(U11)와 "한 루프 = 한 레인/한 감사"(U2)는 **스키마 자체를 고쳐야** 하는 항목이다 — 그래서 무조건 채택이 아니다.

**차단 조건(이것이 §4 L1 표현력 판정의 입력이다)**

1. **U11 하드락 분리** — 하드락 필드를 서명 오버레이로 빼고 `Loop` 본문에서 required 해제. (안 하면 LLM 초안 파이프라인 §6 이 성립하지 않는다)
2. **U5 `on_fail` 에 `label_and_degrade` 추가 + `drop_silently` 제거** (§3 B1)
3. **U9/U10 분모 강제** — `Kpi.numerator/denominator/min_sample/no_sample_value` · `auto_trip[].min_sample` (§3 B6·B7)
4. **U13 안전 계열 `default` 제거 → required** — `on_timeout`·`external_model_transfer` (§2 A1·§3 B2)
5. **U4 출력 봉투 슬롯** — 출처 3상태·검증 결과·근거 노출을 `output` 에 선언 가능하게. 없으면 R9 가 확정된다
6. **U3 `auth.mode` 에 실물 값 추가** — 없는 통제를 선언하게 만드는 필드는 lint(L03)와 함께 **거짓 증적 생성기**가 된다

**채택 범위 제한(무조건)**

- ✅ **L2 카탈로그 · L3 lint · L4 문서팩까지만.** 특히 §3.12 거버넌스 문서 팩은 지금 손으로 쓰는 것을 대체하므로 실익이 가장 크다.
- 🔴 **L5 런타임과 §3.8 검증 파이프라인 자동 생성은 채택하지 않는다.** R1·R6 대로 **생성된 것이 현행보다 약하다.**
  `ai-verify.ts` 와 `ai-skill-quality.ts` 는 **정본으로 남기고**, LoopSpec 은 그것을 **참조**만 한다(정본이 둘이 되지 않게).
- ~~🔴 `risk.privacy.external_model_transfer`(U14)는 폐쇄망 vs 위탁 결정 종속~~ →
  **2026-08-20 사람 결정: AI 서버는 원내(WeRU.B).** 제3자 LLM 사업자 위탁이 아니다.
  🔴 다만 **비워 두면 안 된다** — U13(§2 A1) 대로 `default` 는 값을 주입하지 않으므로,
  비운 자리는 "안전한 기본값"(`TOKENIZED_ONLY`)으로 오독된다.
  ~~**명시적으로 `false` 를 적는다.**~~ → 🔴 **정정(2026-08-20 · §4-L1 (0) 기계 검증)**:
  이 필드의 enum 은 `FORBIDDEN|TOKENIZED_ONLY|ALLOWED_IN_REGION` **문자열 3값뿐**이라
  `false` 는 **스키마 위반**이다(축 A·C 의 run A/B 가 실제로 이 줄에서 실패했다).
  즉 **"원내 처리"를 정직하게 적을 값이 지금은 없다** — enum 에 `INTERNAL_ONLY` 를 추가하는 것이
  L2 착수 조건 S3(사람 결정)이고, 그 전까지 이 필드는 **비우지도 채우지도 못한다.**
  관측 사실 하나(전제를 뒤집지 않음): 현재 `ai.server.url`(`example.org`)은 **Cloudflare 를 경유**한다
  (`198.51.100.20`·`2606:4700::`). 모델 호스트가 원내라도 **전송 경로는 제3자 CDN 을 지난다** —
  폐쇄망(air-gap) 요건을 따로 따질 때 이 사실이 필요하다.

**이 파일럿에서 부수적으로 드러난 실물 결함**(LoopSpec 과 무관 · 별도 회수 대상)

| 실물 | 근거 | 성격 |
|---|---|---|
| ~~`GET /api/v1/lab/orders/:orderId/ai-interpret` 가 **감사행을 남기지 않는다**~~ → ✅ **2026-08-20 회수됨** — `@AuditAiRead('AiLabInterpret')` 배선(같은 커밋에서 23 EP 일괄). 인터셉터가 READ 1행 + `patientBound` 를 남긴다 | `lab.controller.ts:385` · `audit/no-audit.decorator.ts:35` · `audit.interceptor.ts:103,127-133` | 🔴 회수는 **EP 마다 데코레이터**로 이루어졌다 — 즉 감사 정체성은 **진입점 단위**이고, LoopSpec 의 `audit` 블록은 **루프 단위**다(§4-L1 U2 재확인) |
| 같은 EP 를 부르는 **화면이 없다**(고아 EP) | `grep -rn "ai-interpret" apps/web/src apps/mobile` = 0건 | 도달 불가 |
| `interpretLab` 이 `familyName`·`givenName` 을 조회하고 **쓰지 않는다** | `medical-ai.service.ts:1239` select | 과다조회(최소수집) |
| `skillContext` 가 `allergyLine` 을 만들지만 **검사해석 프롬프트에 넣지 않는다** | `:936` vs `:1268-1278` | 조회했는데 목적 없음 |
| `AiInterpretLabDto.results` 가 `@IsArray()` 뿐 — **항목 검증 없음**(`@ValidateNested`/`@Type` 부재) | `dto/medical-ai.dto.ts:264-266` | §4.3 축(ValidationPipe 스킵)과 같은 계열 |
| `security.audit.retentionDays`(365) 를 **읽는 코드가 없다** | `grep -rn "security.audit.retentionDays" apps/api/src apps/web/src` = 선언 1행 | 보존기간 선언만 있고 집행 잡 없음 |

**확인하지 못한 것(정직하게 남긴다)**

- 운영 실측 호출량·`aiRate`·p50/p95 를 **재지 않았다**(운영 DB 조회 안 함). 그래서 `budgets.latency.p95_ms`·`Kpi.baseline` 을 비웠다.
- `interpret-lab` 이 실제로 `AI`/`FALLBACK` 어느 비율로 나가는지 모른다 — 코드 주석의 "지연 12~32초"(`patient-brief.service.ts:14`)는 **범위 서술**이지 p95 가 아니다.
- 외부 설계서의 예제 3종(`doc.progress-note` 등)은 **동봉받지 못했다**(설계서가 참조만 함) — "세 예제 모두 스키마 검증 통과"는 검증하지 못했다.
- ~~다른 3스킬(`realtimeDdx`·`autoSoap`·`recommendDrugs`)로 역기술을 반복하지 않았다.~~ →
  **§4-L1 에서 `recommendDrugs` 를 역기술했다**(축 A). `realtimeDdx`·`autoSoap` 은 여전히 미실시.
  A3(`write_back` required)은 `draft_note` 계열(`autoSoap`)에서 **아직 재검증하지 못했다** — L1 의 세 축은 모두 `target: none` 이다.

---

### 4-L1. 표현력 판정 — 폭으로 본 결과 (2026-08-20)

> L0 은 스킬 **하나**(`interpret-lab` — "AI 조회 → 초안 반환")만 봤다. 그 하나로는
> **LoopSpec 이 우리 루프 전반을 담는가**를 판정할 수 없다. 성격이 일부러 다른 실물 **3개를 더** 역기술했다.
>
> | 축 | 대상 | L0 과 다른 점 | 산출물 |
> |---|---|---|---|
> | **A** | `recommendDrugs` (`medical-ai.service.ts:1360-1529` · `drug-verdict.ts`) | AI 출력을 **정본 서비스(약가마스터·DUR)로 재검증**해 `EXACT/INGREDIENT_GROUP/AMBIGUOUS/NONE` 판정을 붙인다. `write_back` 은 없는데 **판정이 화면 동작을 바꾼다** | `loopspec-pilot-recommend-drugs.yaml` |
> | **B** | `VitalsIngestService` (`vitals-ingest.service.ts` + `vitals.service.record` + `meta.ingest`) | **AI 가 아니다.** 결정론 파이프라인 · `STORED/DUPLICATE/PENDING`·`timeFlags`·`dedupeChecked` | `loopspec-pilot-vitals-ingest.yaml` |
> | **C** | `PatientBriefService` (`patient-brief.service.ts`) | **배치+실시간 하이브리드.** 야간 크론 · Redis TTL · 이벤트 무효화 · 예산 · **다른 루프를 부르고 다른 루프에게 먹힌다** | `loopspec-pilot-patient-brief.yaml` |
>
> 🔴 작성 규칙은 L0 과 같다 — 실물에서 읽은 값만, 모르는 값·하드락은 **비운다**, 표현 손실은 `# 🔴` 로 남긴다.

#### (0) 기계 검증 결과 — 재현 가능

```
node scripts/loopspec-validate.mjs ~/Downloads/loopspec.schema.json docs/01-plan/features/loopspec-pilot-<이름>.yaml
# ajv 8.18.0 (draft 2020-12, allErrors) + ajv-formats 3.0.1 + js-yaml 4.1.1 — 전부 저장소 node_modules
```

| 파일럿 | run A(실물 근거만) | run B(자리표시 오버레이) |
|---|---|---|
| **L0 `interpret-lab`**(재현 확인) | FAIL 6 — `metadata.version`·`metadata.owners`·`risk.tier`·`context.auth.mode`·`budgets.latency.p95_ms`·`auto_trip[0].threshold` | **PASS** |
| **A `recommend-drugs`** | 🔴 **FAIL 8** — L0 의 6건 **전부** + `risk.privacy.external_model_transfer`(enum 위반) + `triggers` **0건**(`minItems:1` 위반) | 🔴 **FAIL 2** — `external_model_transfer` · `triggers` |
| **B `vitals-ingest`** | FAIL 7 — `version`·`owners`·`risk.tier`·`triggers` **0건**·`auth.mode`·`budgets.latency` 부재·`spec` allOf[0] `then` 위반(= L02 sync SLA) | FAIL 4 — `triggers` + **오버레이 아티팩트 3** |
| **C `patient-brief`** | FAIL 6 — `version`·`owners`·`risk.tier`·`external_model_transfer`·`auth.mode`·`budgets.latency.p95_ms` | FAIL 4 — `external_model_transfer` + **오버레이 아티팩트 3** |

🔴 **run B 가 실패했다는 것이 L1 의 첫 산출물이다.** L0 에서 run B 가 PASS 했기 때문에 "구조는 우리 실물에 맞다"고 적었는데,
폭을 보니 **가짜 값을 다 넣어도 스키마를 통과시킬 수 없는 루프가 있다.** 오버레이로 메울 수 없는 실패는 둘뿐이고 둘 다 같은 성격이다 —
**정직하게 적을 값이 enum·최소개수에 아예 없다:**

1. `triggers` **0건**(A·B) — `minItems: 1` 인데 실물 진입점을 표현할 `Trigger` 종류가 하나도 없다.
   L0 은 야간 배치(`schedule`)가 우연히 있어 채웠을 뿐이다. **R8("표현 가능한 트리거가 하나뿐")은 낙관이었다.**
2. `risk.privacy.external_model_transfer`(A·C) — §4-L0 은 사람 결정에 따라 **"명시적으로 `false` 를 적는다"** 고 지시했는데,
   이 필드의 enum 은 `FORBIDDEN|TOKENIZED_ONLY|ALLOWED_IN_REGION` **문자열 3값뿐**이다.
   🔴 **§4-L0 의 그 지시는 실행 불가다**(기계 검증으로 확인 — 아래 §문서 정정 ④).

**B·C 의 run B 실패 4건 중 3건은 오버레이 아티팩트다**(스크립트가 `auto_trip[0].threshold` 를 주입하는데
두 루프에는 `auto_trip` 이 없어 `metric`·`operator`·`window` 결손이 생긴다). 🔴 **내 검증 도구가 만든 오탐이므로 산출물에서 뺀다.**

#### (1) L0 의 U1~U21 재검 — **구조적인가 국소적인가**

🔴 **구조적인 것만이 스키마를 고칠 근거다.** 축 3개에서 다시 나오면 구조, L0 에서만 나왔으면 국소.

| L0 항목 | A(약물추천) | B(활력포트) | C(브리핑) | 판정 |
|---|:--:|:--:|:--:|---|
| **U1** 사용자 행위 트리거 | ● 버튼 | ● 폼 저장 | ○ `patient-view` 가 **맞다** | **구조**(3/4) — 단 화면 진입 훅은 실제로 맞는 자리가 있다 |
| **U2** 한 루프 = 여러 진입경로(레인·역할·예산·감사가 갈림) | ●● 역할 교집합이 `ADMIN` 하나 · 감사 방식이 서로 다름 | ● 4호출부·역할 다름 | ●● sync/batch 로 **감사 유무가 갈림** | 🔴 **구조 · 최상위** |
| **U3** `auth.mode` 에 실물 값 없음 | ● | ● | ●● 배치엔 세션이 없어 L03 과 충돌 | 🔴 **구조**(4/4) |
| **U4** 출력 봉투(3상태·검증결과·근거) | ● +항목 판정 | ● `status/timeFlags/dedupeChecked` | ● `trigger/computedAt/basis/unavailable` | 🔴 **구조**(4/4 · 봉투 모양은 축마다 다르다) |
| **U5** `on_fail` 에 `label_and_degrade` 없음 | ● | — 검증층 없음 | — | **구조(AI 루프 한정)** |
| **U6** 규칙의 파라미터·입력·집합보고 | ● 임계가 **런타임 config** | — | — | **구조(AI 루프 한정)** · A 에서 더 심함(입력이 툴 결과 → N1) |
| **U7** 근거 부족 시 동작 | ● `EMPTY_RESULT` | ● `PENDING` | ●● **축 단위** 부분 결측 → N12 | 🔴 **구조**(4/4) |
| **U8** 입력 측 "없음" 3상태 | ●● 클라 입력이 3상태를 덮는다 → N6 | ● 결측은 `null`(0 아님) | ● 알레르기 3상태가 산출물 | 🔴 **구조**(4/4) |
| **U9** `Kpi` 분자·분모 | ● 분모가 "특정 시도 수" | ● 분모 없음 | ●● 분모가 **7분류** | 🔴 **구조**(4/4) |
| **U10** `auto_trip` 표본 하한 | ● 같은 `judgeSkillQuality` | — | — | **구조(AI 스킬 루프 한정)** |
| **U11** 하드락 ∩ required | ● | ●● `tier` enum 자체가 비-AI 를 못 담음 | ● | 🔴 **구조**(4/4 · 스키마 구조 변경) |
| **U12** 출처가 문서 단위 | ● | ● | ● | 🔴 **구조**(4/4) |
| **U13** `default` 미주입 | ● | ●● 모델을 안 쓰는데 "토큰화 후 전송"으로 읽힘 | ● 조건부 전송 | 🔴 **구조**(4/4) |
| **U14** 외부 전송 상태 | ● enum 에 "원내" 없음 | ○ 해당 없음(그리고 그걸 적을 값도 없음) | ● **조건부** 전송 | **구조(AI 루프)** + "해당 없음"도 못 적는다 |
| **U15** 주 입력이 리소스가 아님 | ●● `diagnosis`+`patientContext` 무검증 | ●●● **입력이 전부** 호출자 관측값 | ○ 없음(순수 서버 조회) | 🔴 **구조**(3/4) |
| **U16** 캐시가 둘 | ● 600초 응답 캐시 | — | ●● 브리핑 24h × 응답 600s | **구조**(3/4) |
| **U17** `enabled` 가 boolean 이 아님(config 곱) | ● 3키 | ○ config 없음(상수) | ●●● **5키** | 🔴 **구조**(3/4) |
| **U18** 자유 텍스트 방어 | ● `diagnosis` → 프롬프트 **+ 감사 원장 평문** | — | — | **구조(AI 루프 한정)** |
| **U19** 부재의 주장(`asserted_absent`) | ● | ●● 같은 `tokenize: []` 가 정반대 사실 | ● 동의 없음 | 🔴 **구조**(4/4) |
| **U20** 모델·프롬프트 정체 | ● 상류 위임 + 인라인 | — | ● 절반만 추론 | **구조(AI 루프 한정)** |
| **U21** 역할 어휘 | ● `ADMIN` 없음 | ● | ● | 🔴 **구조**(4/4) |

**L0 특유(국소)로 판정된 것: 0건.**
🔴 이것이 L1 의 두 번째 산출물이다 — **L0 이 찾은 21건은 하나도 그 스킬의 사정이 아니었다.**
다만 **적용 범위가 갈린다**: U5·U6·U10·U14·U18·U20 은 **AI 루프에만** 나타난다(B 에서는 해당 자체가 없다).
그 사실이 아래 (3) 비-AI 루프 판정의 근거가 된다.

**그리고 하나는 반증됐다** — U1 의 "`hook` enum 이 우리 트리거를 못 담는다"는 **부분적으로만** 참이다.
C 의 `patient-view` 는 실제로 맞다(화면 마운트가 트리거이기 때문 · `AiAssistantPanel.tsx:349-364`).
문제는 "버튼을 눌렀다"(A·L0)와 "폼을 저장했다"(B)이지 훅 개념 자체가 아니다.

#### (2) 🔴 신규 표현 불가 — ⓐ실물이 무엇을 하는가 ⓑ왜 안 되는가 ⓒ어떻게 고치면 담기나

| # | 항목 | ⓐ 실물(근거) | ⓑ 왜 표현 불가 | ⓒ 스키마 수정안 |
|---|---|---|---|---|
| **N1** | 🔴 **정본 재검증 층**(축 A · **이 라운드 최대 산출물**) | LLM 응답을 받은 뒤 **항목마다** ①약가마스터 검색(`resolveMedicationCode` `drug-verdict.ts:377-430`) ②DUR 정본(`checkInteractions` `:489`)을 돌려 `durVerdict`/`resolution` 을 붙인다. LLM 이 적은 `cdssCheck:"PASS"` 는 판정에서 제거하고 `modelNote` 로 강등한다(`medical-ai.service.ts:1461`) | 툴은 **모델에게 주입되는 것**이고(설계서 §3.3) `tools.allow: []` 는 여기서 참이다. `Verification` 은 `rules`(문자열)·`numeric_crosscheck`(boolean)·`citation_required`·`second_model` 뿐 — **"모델이 말한 것을 정본 서비스로 되받아 판정하는 단계"가 없다.** 설계서 §3.8 검증 체인에도 없다 | `verification.resolvers[]`: `{ref, applies_to(json-pointer), attaches(field), on_error: label_null_not_pass}` 신설. 결과가 `rules[]` 의 **입력**이 될 수 있어야 한다 |
| **N2** | 🔴 **항목 단위 판정 어휘 + "모른다" 3종** | `durVerdict: PASS\|WARNING\|BLOCK\|UNRESOLVED\|null` × `resolution: EXACT\|INGREDIENT_GROUP\|AMBIGUOUS\|NONE\|(부재)`. 뜻이 전부 다르다 — `UNRESOLVED`=약을 특정 못 함 · `null`=**재검증 자체 실패(PASS 아님)**(`drug-verdict.ts:32,463,507`) · `resolution` 부재=어디까지 갔는지도 모름(`:24`) | `output.kind: card` 아래에 항목 판정 어휘를 선언할 자리가 없다. `schema_ref` 는 페이로드 모양만 가리킨다 → 자동 생성 UI 는 **세 가지 "모른다"를 구분해 그릴 수 없다** | `output.item_verdict: {vocab_ref, unknown_states[]}` — 어휘는 카탈로그 참조(스키마에 박지 않기) |
| **N3** | 🔴 **판정이 액션을 잠근다** | `blocked = durVerdict === 'BLOCK' \|\| 'UNRESOLVED'` → '처방 폼에 채우기' 버튼 비활성 + 사유를 `title` 로 말함(`AiAssistantPanel.tsx:1229-1240`) | `presentation.actions[]` = `{label, tool_ref, style}` — `enabled_when`/`reason_text` 슬롯이 없다. 그리고 `tool_ref` 는 Tool Registry ID 를 요구하는데 이건 **화면 상태 전이**(탭 전환+검색어 프리필)라 툴이 아니다 | `actions[].gate: {when, effect: disable\|hide, reason_ref}` + `tool_ref` 를 `action_ref`(툴 또는 UI 전이)로 넓히기 |
| **N4** | 🔴 **규칙별 조건부 재호출 · 시간 예산 · 호출 횟수** | ①`KOREAN` 단독 실패 && 경과<20초 → 교정 system 으로 1회 재호출(`:1503-1506`) ②`DRUGS_RESOLVABLE` 실패 && <20초 → **매칭 실패한 성분명을 이름으로 알려주고** 1회 재호출, **후보는 제안하지 않는다**(`:1507-1522`) ③재호출은 `source==='AI'` 일 때만 채택(`:1505,1520`) | `on_fail` 은 루프당 **단일 enum**. 규칙별 분기도, 시간 예산 조건도, 재호출 프롬프트 규약도 없다. `regenerate_once_then_handoff` 를 적으면 **모든 실패에 무조건 재생성** — 실측상 게이트웨이 60초를 넘겨 504 를 만든 그 동작이다(`:1502` 주석). `max_steps` 는 추론 단계이지 **모델 호출 횟수**(최대 3회)가 아니다 | `verification.on_fail_by_rule[]`: `{rule, action, max_retries, within_ms, feedback_template_ref, accept_only_if}` + `budgets.cost.max_model_calls_per_request` |
| **N5** | **프롬프트 출력 필드 계약 ↔ 검증 규칙의 결합** | `ingredient`(영문 INN 1개·상품명/함량/염 금지) 요구를 **system 으로 올려야** 모델이 지킨다(실측 5진단 0/5 → 12/12 · `:1434-1436`). 그 필드가 없으면 성분 경로 특정이 통째로 약해진다 | `prompt_template` 은 불투명한 레지스트리 ID 하나. "이 템플릿은 필드 X 를 보장해야 하고 그 보장은 규칙 Y 가 검사한다"를 적을 수 없다 → 템플릿 교체가 검증을 조용히 무력화한다 | `reasoning.prompt_contract: {required_fields[], enforced_by_rule_ref[]}` + 템플릿 교체 시 재평가 강제(§7 minor) |
| **N6** | 🔴 **호출자 입력이 서버 정본을 덮는다(precedence)** | `clientAllergies.length ? clientAllergies.join(', ') : ctx.allergyLine`(`:1395-1396`) · `patientContext.currentMedications ?? ctx.activeMedications`(`:1399`). 클라가 1건이라도 보내면 서버 **알레르기 3상태 정본이 평문 목록으로 교체**되고 "미문진"과 "없음 확인"의 구분이 사라진다 | `context.resources` 는 "무엇을 볼 수 있는가"만 말한다. **"무엇이 그것을 덮는가"** 를 적을 슬롯이 없다 | `resources[].overridable_by: {input_ref, precedence, on_override: preserve_state_semantics}` |
| **N7** | 🔴 **확정 임상기록 write-back 대상이 없다**(축 B · 범위 판정의 근거) | 포트가 `preVisitVitals.create`/`flowSheetEntry.create`/`icuRecord.create` 로 **법정 임상기록을 만든다**(`vitals-ingest.service.ts:464-548`) | `write_back.target` = `none\|staging_draft\|task_queue\|worklist` — **`clinical_record` 가 없다.** `status` 는 `const: "unsigned"`. 즉 **"AI 는 확정 기록을 만들지 않는다"가 스키마 구조로 못박혀 있다** | 🔴 **고치지 않는다.** 대신 문서가 **적용 범위를 명시**한다 — (3) 참조 |
| **N8** | **멱등·중복 판정** | 멱등 키 = (환자/재원, 측정시각 정확일치, 활력 6값 정확일치)(`:410-439`). 🔴 측정 시각을 모르면 **판정하지 않는다**(`dedupeChecked=false` = "중복 없음"이 아니라 "판정 불가" · `:184-187,274`) | 설계서 §1 표는 `triggers` 에서 "멱등키 규칙"이 생성된다고 적었으나 **스키마에 `idempotency` 블록이 없다**. "판정 불가"를 담을 자리도 없다 | `idempotency: {key_fields[], scope, on_undeterminable: declare_unchecked}` |
| **N9** | 🔴 **받았지만 담을 컬럼이 없는 것** | `unstored: {reason:'SCHEMA_PENDING', fields:[source,deviceId,deviceSerial,reliability,rawRef,receivedAt], source, receivedAt}` 를 반환값이 그대로 실어 보낸다 — "저장한 척하지 않기 위해"(`:163-172,222-223`) | `write_back.excluded_fields` 는 **자동 생성 금지 필드**(모델이 만들어도 드롭)라 정반대 뜻이다. "받았고, 버리지 않았고, 담을 곳이 없어 호출자에게 되돌려준다"를 적을 자리가 없다 | `write_back.unstorable_fields: [{field, reason, returned_to_caller: true}]` — 전송 정직성(`LOCAL_RECORDED`)의 **저장판** |
| **N10** | 🔴 **임계 상수의 출처와 교체 조건** | 미래 허용오차 2분 = "1ms 역전 32건 오탐을 흡수하되 사람의 오타는 걸러지는 폭"(`:195-200`) · 과도 소급 24시간 = "🔴 이 값은 통계가 아니다 — 기기 축이 없어 p95×2 를 뽑을 분포가 없다. 임상 운영 규칙에서 왔고 **기기 축이 생기면 대체한다**"(`:202-209`) | Rule Catalog 는 룰을 담지만 **상수의 출처·계측 방법·교체 조건**을 담는 필드가 없다. 이 저장소의 교훈("임계값은 감이 아니라 그 축의 과거 실측에서")이 카탈로그에 남지 않는다 | 카탈로그 항목에 `threshold_basis: {method: measured_p95x2\|clinical_policy\|unset, measured_at, sample_n, replace_when}` 필수화(§3 B14 와 한 벌) |
| **N11** | 🔴 **루프 합성 — 부르고, 먹힌다**(축 C · **구조 변경 필요**) | 배치 B 가 `this.labInterpreter(pid, brief)` 로 **다른 루프**(L0 `interpret-lab`)를 부르고 그 **출력 봉투를 그대로** 싣는다(`patient-brief.service.ts:214,220`). 반대로 L0·A 의 `skillContext` 는 **이 루프의 출력을 컨텍스트로** 쓰고 신선도를 `groundedOn: 브리핑(<trigger> <computedAt>)` 로 이어받는다(`medical-ai.service.ts:930-950`) | `tools.allow[].ref` 는 툴, `context.resources[].ref` 는 쿼리 ID — **루프 참조가 없다.** 프로비넌스 이전(`computedAt`·`basedOn`)도 담기지 않는다 → **루프 그래프가 전 산출물에서 사라진다**(§3 B11 이 무는 자리) | `spec.composition: {calls[]: {loop_ref, accept_when, budget}, consumed_by[]}` + `context.resources[].kind: loop_output` |
| **N12** | 🔴 **부분 가용성 — 축 단위 결측** | 8개 축을 `Promise.all` 로 **각자 실패**시키고 실패한 축 이름을 `unavailable[]` 에 담아 낸다(`:109,114-128,161`). 그 목록이 상위 루프의 `groundedOn` 으로 **전파**된다(`medical-ai.service.ts:944`) | `resources[].optional` 은 boolean 이고 뜻은 "false 면 실패 시 handoff" — **전부-아니면-전무**. "그 축만 빼되 뺐다고 말한다"를 적을 값이 없다 | `resources[].on_failure: proceed_and_declare` + `output.envelope.declared_missing[]`(U4 봉투와 한 벌) |
| **N13** | **대상당 예산 · 동시성 · "미계산이라 적기"** | `withBudget(labInterpreter(...), budgetSec*1000)`(`:214` · 기본 60초 `:201`) — 초과하면 기다리지 않고 다음 환자로 가며 `unavailable.push('… 예산 60초 초과 — 미계산')`(`:215`). 동시성 3(`:200`) | `Budgets.latency` 는 sync 요청 1건의 p95/timeout 이다. `per_target_ms`·`concurrency`·`on_budget_exceeded: declare_uncomputed` 가 없다(`budgets.alerts.on_budget_exceeded` 는 알림 강도 강등이라 다른 축) | `budgets.batch: {per_target_ms, concurrency, on_exceeded: declare_uncomputed}` |
| **N14** | **무효화 이벤트의 페이로드 결속** | `@OnEvent` 6종 → `invalidate(p?.patientId)` — **`patientId` 가 없으면 조용히 아무 일도 하지 않는다**(`:172-182`). 실측: 6종 전부 싣지만 `lab.service.ts:412` 는 `order.prescription?.encounter?.patientId` 로 옵셔널 체이닝 2단을 지난다 | `invalidate_on: [토픽 문자열]` 에 **페이로드 필드 바인딩도, 결속 실패 시 동작도** 없다. 무효화가 조용히 걸리지 않으면 stale 브리핑이 남는다 | `invalidate_on[]` 을 객체로: `{event, bind: <payload path>, on_unbound: warn\|full_flush}` |
| **N15** | **구조 불변식을 CI 게이트로 못 적는다** | 이 저장소에서 가장 잘 작동해 온 방어는 **구조 가드**다 — "포트 밖에서 활력 저장소 3종을 `create` 하면 실패"를 여유 0으로 동결(`test/architecture/vitals-ingest-port-guard.spec.ts:50-76`) | `evaluation.gates[]` = `{metric, operator, threshold}`(수치) — **불변식 게이트를 담지 못한다** | `evaluation.invariants[]: {ref, baseline: 0, allow_growth: false}` |
| **N16** | **"끌 수 없어야 맞는 루프"·"끌 수 없는 경로"** | B: 킬스위치가 없고 **없는 것이 맞다**(활력 기록을 끄면 임상이 멈춘다). C: 배치는 config 로 끄지만 **lazy 경로는 코드 배포 말고 끌 방법이 없다** | `kill_switch.granularity: []` 가 "끌 수 없음(끄면 안 됨)"이라는 주장인지 문언상 불명확(A4 축). "일부 경로는 끌 수 없다"를 적을 자리도 없다 | `kill_switch.not_killable: {reason}` + `granularity` 항목별 대상 경로 명시 |

**축별 새 관측 요약(교차 실측 1건)** — C 의 `latestVitals` 는 **외래 저장소(PreVisitVitals)만** 읽고,
B 의 포트는 `vitals.recorded` 를 **외래 경로에서만** 발행한다(`EMIT_RECORDED_ROUTES` `vitals-ingest.service.ts:212-220`).
두 사실이 맞물려 무효화가 정합하지만 🔴 **어느 쪽 선언에도 그 의존이 적혀 있지 않다.**
입원 활력을 브리핑에 넣는 날 무효화가 조용히 깨진다. LoopSpec 에 루프 간 불변식을 적을 자리가 없다는 것(N11·B11)의 **구체 사례**다.

#### (3) 🔴 비-AI 루프 판정 — **활력 수집 포트는 LoopSpec 의 대상 밖이다**

> ## 🔴 판정 = **대상 밖(out of scope). 억지로 담지 않는다.**

근거는 **적을 값이 없어서**가 아니라 **스키마가 지키려는 불변식을 깨야 담기기 때문**이다.

| 근거 | 실물 | 스키마가 하는 말 |
|---|---|---|
| **① write-back 이 확정 임상기록이다** | `preVisitVitals`/`flowSheetEntry`/`icuRecord` 를 만든다(`:464-548`) | `write_back.target` 에 `clinical_record` 가 **없고** `status` 는 `const: "unsigned"` — "AI 는 확정 기록을 만들지 않는다"를 **구조로** 못박은 것이다. 여기에 값을 추가하면 **그 불변식이 사라진다** |
| **② `risk.tier` enum 이 비-AI 를 못 담는다** | 사람이 관측한 사실을 법정기록에 쓴다 | `0=확정 사실 전달 / 1=정보 수집·정리(초안) / 2=임상적 판단` — 전부 **AI 자율성 등급**이다. 그런데 required |
| **③ `risk.ai_disclosure.required` 가 required** | AI 가 없다 | 비-AI 루프도 "AI 고지 여부"를 반드시 선언해야 한다 |
| **④ `reasoning`·`verification`·`tools` 가 공허** | 모델도 프롬프트도 출력 검증도 없다 | 실물의 검사는 **출력 검증이 아니라 입력·시각·중복 검사**다. `Verification` 은 스스로를 "출력 검증 레이어"라 정의한다 |
| **⑤ `context.resources: []` 가 실물보다 안전하게 말한다** | 조회는 0건이 맞다. 그러나 **입력이 33개 임상 필드**다(`VitalsObservation` `:121-141`) | 빈 배열은 "환자 데이터를 일절 조회하지 않음"이라는 유효한 **주장**(설계서 §1) → 최소수집 근거표에 "조회 리소스 0건"으로 출력되고 **실제로 오가는 임상 필드는 심의 문서에 나타나지 않는다** |
| **⑥ `output.kind` 에 해당 값이 없다** | 기록을 만들고 판정을 호출자에게 돌려준다 | enum 8종 중 없다. `none` 은 거짓이다 |
| **⑦ 루프 경계가 정해지지 않는다** | 이상 활력이면 `VITAL_ALERT`(CRITICAL)를 팬아웃한다 — 그런데 그 발행은 **포트가 아니라 호출자**(`vitals.service.ts:156,163-201`)에 있다 | 경계를 어디에 긋느냐에 따라 `output.kind` 가 `none` 도 `alert` 도 된다. `alert` 를 고르면 L06·L07·L09 가 전부 문다. **LoopSpec 에 루프 경계 규칙이 없다** |

**그래서 문서가 해야 할 일은 필드 추가가 아니라 범위 명시다.**

> **적용 범위(채택 시 §0 에 못박을 문언)**
> LoopSpec 은 **AI 루프**를 위한 스펙이다 — 모델이 생성한 것을 사람이 확인해 쓰는 루프.
> 아래는 **대상 밖**이며, 대상 밖인 것을 담으려 하면 스키마의 안전 불변식이 무너진다:
> · **사람·기기가 확정 임상기록을 만드는 결정론 파이프라인**(활력 수집 포트·MAR·오더 실행 등)
> · **AI 가 관여하지 않는 배치·크론**
> 🔴 다만 **그 루프들이 지켜 온 정직성 규약**(3상태 판정 봉투 · 분모 병기 · "판정 불가"를 값으로 만들지 않기 ·
> `unstored`/`LOCAL_RECORDED` · 임계 상수의 출처)은 **AI 루프에도 그대로 필요하다** —
> 위 N4·N8·N9·N10·N12 는 그 규약을 AI 루프 쪽으로 **가져오자는 제안**이지 비-AI 루프를 담자는 제안이 아니다.

#### (4) 역방향 손실 확장 — 이 스펙으로 컴파일하면 **현행보다 약해지는** 지점

L0 의 R1~R10 에 더한다. 전부 "생성물이 현행 코드보다 약해지는" 방향이다.

| # | 축 | 손실 | 결과 |
|---|---|---|---|
| **R11** | A | **정본 재검증 층이 사라진다**(N1) | 컴파일된 파이프라인에는 약가마스터 조회도 DUR 재검증도 없다 → 화면에 남는 판정은 **LLM 이 적은 `cdssCheck:"PASS"`** 뿐이다. 🔴 우리가 2026-08-20 에 정확히 그 상태에서 봉합했다(`drug-verdict.ts:4-7`) |
| **R12** | A | **액션 게이트가 사라진다**(N3) | 생성된 카드에 **BLOCK 약을 처방 폼에 채우는 버튼**이 활성으로 나온다. 처방 폼의 DUR 게이트가 최종 방어이긴 하나, 화면 정직성(“차단 약은 프리필도 하지 않는다”)이 사라진다 |
| **R13** | A | `on_fail: regenerate_once_then_handoff` | **모든 검증 실패에 무조건 재생성** → 실측상 게이트웨이 60초를 넘겨 504(`medical-ai.service.ts:1502`). 현행은 규칙별·20초 예산 안에서만 재호출한다 |
| **R14** | A | **세 가지 "모른다"가 하나로 접힌다**(N2) | `UNRESOLVED`(특정 실패)·`null`(재검증 실패)·`resolution` 부재가 같은 회색 배지가 된다 → 🔴 `null` 이 "문제 없음"으로 읽히는 것이 이 저장소가 반복해서 다친 형태다 |
| **R15** | A | `Kpi` 분모 소실이 여기서 더 나쁘다(U9) | `미매칭 n/N` 의 N 은 **"특정을 시도한 추천 수"** 이지 추천 총수가 아니다(`ai-verify.ts:137-141`). 자동 대시보드는 추천 총수로 나눠 **다른 지표**를 그린다 |
| **R16** | B | `write_back.target: none` (다른 값이 없다) | 컴파일러가 저장 어댑터를 만들지 않는다 → **아무것도 저장하지 않는 루프**가 생성된다 |
| **R17** | B | `context.resources: []` | 최소수집 근거표가 "조회 리소스 0건"을 출력 → **실제로 오가는 33개 임상 필드가 심의 문서에서 사라진다.** 🔴 문서가 실물보다 안전하게 말한다 |
| **R18** | B | `unstored` 소실(N9) | "받았지만 담을 컬럼이 없다"가 사라져 **저장된 것처럼** 읽힌다 — 전송 정직성(`LOCAL_RECORDED`)의 저장판 결함 |
| **R19** | C | `lane` 단일 | 컴파일러가 **절반만** 배선한다(설계서 §3.5 가 여기서 실행 엔진을 고른다). sync 를 고르면 야간 배치가, async 를 고르면 lazy 경로가 산출물 밖에 남는다 |
| **R20** | C | 배치 B 의 **7분류 분모**가 하나로(N12·U9) | `eligible/computed/budgetSkipped/rejected/noInterpreter/error/noLabs`(`:203`) 중 `noLabs` 는 **근거 게이트가 정상 작동한 것**이다. 하나로 접히면 정상 동작이 미달로 그려진다 |
| **R21** | C | **루프 그래프 소실**(N11) | 브리핑 신선도(`groundedOn: 브리핑(BATCH 2026-…)`)와 프로비넌스 이전(`computedAt`·`basedOn`)이 하위 루프 산출물에서 사라진다 → 화면이 "언제 계산된 근거인지" 말할 수 없다 |
| **R22** | A·C | `external_model_transfer` 에 "원내"가 없다 | 셋 중 무엇을 골라도 거짓이다. **거버넌스 문서 팩(§3.12)이 규제 매핑 체크리스트에 그 거짓을 그대로 출력한다** — 심의 자료 자동 생성의 실익이 정확히 그 지점에서 위험이 된다 |
| **R23** | 전축 | **감사 계측이 트리거별로 갈린 것을 하나로** | A 의 두 경로는 resourceType 이 다르고(`AiRecommendDrugs` vs `AiPharmacyReview`) 기록 방식도 다르다(컨트롤러 2행 vs 인터셉터 1행). C 의 배치 경로는 **감사행이 아예 없다**(`audit.interceptor.ts:117` `if (!user?.id) return`). 하나로 접으면 **분모가 조용히 바뀐다** |

#### (5) 🔴 최종 판정 재확인 — 유지하되 **범위가 좁아지고 차단 조건이 늘어난다**

> ## 🔴 판정 = **보완 후 채택 가능 · 범위 = AI 루프에 한정 · L2~L3, L4 는 조건부**
> (L0: "보완 후 채택 가능 · 범위 L2~L4" → **L4 문서팩에 조건이 붙었다**)

**유지되는 것**: 구조(블록 구성)는 AI 루프에 맞다. 신규 16건 중 **14건은 필드·enum 추가로 해결된다.**

**바뀐 것 셋** — 근거와 함께:

1. 🔴 **적용 범위를 문서가 명시해야 한다.** L0 은 이 질문 자체를 만나지 않았다(스킬 하나만 봤으므로).
   축 B 는 **담을 수 없고, 담으면 안 된다**((3) 참조). 범위를 좁히는 것도 판정이다.
2. 🔴 **차단 조건 6 → 9.** 신규 3건은 전부 축 A 에서 나왔고, 셋 다 **없으면 생성물이 현행보다 위험하다**(R11·R12·R13).
3. 🔴 **L4 거버넌스 문서 팩이 무조건 실익은 아니다.** L0 은 "지금 손으로 쓰는 것을 대체하므로 실익이 가장 크다"고 적었다.
   그러나 R17·R22 대로 **자동 생성 문서가 실물보다 안전하게 말하는 경로가 두 개 확인됐다**(최소수집 근거표·규제 매핑).
   → 문서팩은 채택하되 **"생성 → 사람이 실물과 대조 → 서명"** 을 게이트로 둔다. 대조 없는 자동 제출은 채택하지 않는다.

**차단 조건(갱신 — 이것이 L2 의 입력이다)**

| # | 조건 | 출처 | 성격 |
|---|---|---|---|
| 1 | **하드락 분리** — 하드락 필드를 서명 오버레이로 빼고 `Loop` 본문에서 required 해제 | U11(4/4 축) | 🔴 **구조 변경** |
| 2 | `on_fail` 에 `label_and_degrade` 추가 + `drop_silently` 제거 | U5·B1 | enum |
| 3 | **분모 강제** — `Kpi.numerator/denominator/min_sample/no_sample_value` · `auto_trip[].min_sample` | U9·U10·B6·B7 | 필드 |
| 4 | 안전 계열 `default` 제거 → required — `on_timeout`·`external_model_transfer` | U13·A1·B2 | 필드 |
| 5 | **출력 봉투 슬롯** — 출처 3상태·검증 결과·근거·**declared_missing** | U4·N12 | 필드 |
| 6 | `auth.mode` 에 실물 값(`role_gated_service`) 추가 | U3(4/4 축) | enum |
| 7 | 🔴 **`verification.resolvers[]`** — 정본 재검증 층 | **N1** | 블록 신설 |
| 8 | 🔴 **`actions[].gate`** — 판정이 액션을 잠그는 것 | **N3** | 필드 |
| 9 | 🔴 **`on_fail_by_rule[]` + `max_model_calls_per_request`** | **N4** | 필드 |

**구조 변경이 필요한 것(= 필드 추가로 안 되는 것) 3건** — 이것이 "무조건 채택"이 아닌 이유다:

- **U11** 하드락 ∩ required(위 1번)
- **U2** 한 루프 = 한 레인/한 역할/한 예산/한 감사 → `triggers[].overrides{lane,roles,budgets,audit,eligibility}` 또는 루프 분할 + `shared_spec_ref`
- 🔴 **N11 루프 합성** — `spec.composition`. L0 에서는 보이지 않았고 축 C 에서 처음 드러났다

**`triggers` 최소개수 문제(신규)**: A·B 는 표현 가능한 트리거가 **0개**다.
`Trigger` 에 `user_action`(surface·control_id)과 `screen-enter`(패널·상세 진입) 계열을 넣기 전에는
**`minItems: 1` 을 정직하게 채울 수 없다.** 훅 지점 신설은 설계서 §8 이 사람 판단으로 남긴 항목이므로 **사람 게이트**다.

#### (6) L2 착수 조건 — 카탈로그 씨앗에 필요한 선행 조건

🔴 **L1 은 조건부 통과다.** 아래가 갖춰지기 전에 카탈로그를 채우면 §3 B14 가 무는 자리(카탈로그 자체가 틀린 채 전 루프로 퍼짐)로 곧장 간다.

**S. 스키마·문언(선행)**

| # | 조건 | 결정 주체 |
|---|---|---|
| S1 | 차단 조건 9건 반영(그중 구조 변경 3건은 **스키마 v1.1 개정**) | 설계 원저자 + 플랫폼팀 |
| S2 | **적용 범위 문언 확정** — "AI 루프만 · 확정 임상기록 write-back 루프는 대상 밖"((3)) · `write_back.target` 에 `clinical_record` 를 **넣지 않는다**는 결정 포함 | 위원회 |
| S3 | 🔴 `external_model_transfer` 에 **원내 처리 값**(`INTERNAL_ONLY` 등) 추가 여부 — 넣기 전에는 어떤 루프도 이 필드를 정직하게 채울 수 없다(기계 검증 2건) | 위원회 + 설계 원저자 |
| S4 | `Trigger` 에 `user_action`/화면 진입 계열 추가 — 없으면 A·B 는 `minItems:1` 을 정직하게 못 채운다 | EMR 개발팀(훅 지점 신설 = 사람 게이트) |

**C. 카탈로그(L2 의 본체) — 등재 대상은 파일럿이 실제로 참조한 것만**

| 카탈로그 | 씨앗(재실측한 것만) | 선행 조건 |
|---|---|---|
| **Rule** | `ai-verify.ts` **9규칙**(2026-08-20 재실측: `KOREAN`·`MIXED_SCRIPT`·`LAB_DIRECTION`·`ONLY_PROVIDED_TESTS`·`SEX_AGE`·`FORBIDDEN_ADVICE`·`DRUGS_RESOLVABLE`·`DRUG_NAME_SCRIPT`·`NON_EMPTY:<필드>`) | 🔴 **파라미터·입력·심각도 스키마 확정**(U6). 임계는 리터럴이 아니라 **config 키 참조**여야 한다(`ai.skill.quality.maxUnresolvedDrugRatio` · `KOREAN` 0.3) · `threshold_basis` 필수(N10) |
| **Tool** | `modules/orchestrator/tool-registry.ts` | 🔴 **재검증 서비스 2종**(약가마스터 검색 · `DurService.checkInteractions`)을 **툴로 등재할지 `resolvers` 로 뺄지 결정**(N1). 툴로 등재하면 "모델에 주입되는 것"이라는 정의가 깨진다 |
| **Resource Query** | 브리핑 8축(`prisma.patient/allergy/prescription/problemList/labResult/preVisitVitals/encounter/admission`) + `orderSet.active` | 🔴 `brief.*` 는 **쿼리가 아니라 루프 출력**이다(N11) → **루프 참조 방식 결정이 선행**. 그 전에는 파일럿 YAML 의 `brief.*` 표기가 미등재 참조(L11 ERROR) |
| **Metric** | `ai_pass_rate` · `verify_rejected_by_rule` · `skill_latency_p95_ms` · `drugs_unresolved_ratio` · `brief_unavailable_axes` · `batch_b_computed_ratio` | 🔴 **분자·분모·표본하한·"표본 0의 값(null)" 필수**(B6/U9). 🔴 뒤 둘은 **데이터 소스가 로그뿐**이다(`patient-brief.service.ts:226`) — 적재 경로 없이 등재하면 존재하지 않는 소스를 가리킨다 |
| **Event** | 무효화 6종 + `vitals.recorded` | 🔴 **페이로드 필드 바인딩 필수**(N14). `vitals.recorded` 는 **외래 경로만 발행**한다는 사실을 등재해야 한다(`EMIT_RECORDED_ROUTES`) |
| **Hook** | — | 🔴 **현 enum 9종으로는 실물 트리거를 하나도 담지 못한다**(A·B 0개). S4 선행 |
| **Prompt Template** | — | 🔴 **레지스트리 자체가 없다**(전부 인라인). 이것은 역기술 대상이 아니라 **채택 시 신설**이다 |

**P. 사람 게이트(L2 와 병행 가능하나 L3 lint 전에 닫혀야 함)**

| # | 항목 | 근거 |
|---|---|---|
| P1 | **오너 지정** — 4루프의 임상/엔지니어링 오너(CODEOWNERS 파일 부재 · L0 실측) | `metadata.owners` required · run A 4/4 실패 |
| P2 | 🔴 약물추천의 **오너가 둘로 갈린다**(약제위원회=DUR·포뮬러리 / 진료부=추천 프롬프트) → `owners.clinical` 단일 문자열 확장 여부 | 축 A |
| P3 | **하드락 값 결정** — `risk.tier` ×4루프 · `samd_assessment` · `auto_trip[].threshold`+`min_sample` · `audit.retention` · `budgets.alerts`·`min_ppv` | 설계서 §6.2 |
| P4 | 🔴 **`min_ppv`·`baseline` 은 실측이 선행**(§3 B7) — 현재 경보 66종 전부 `UNAPPROVED`(`alert-registry.ts` 재실측 2026-08-20 · `code:` 66건) | L08 |
| P5 | 🔴 **`audit.retention` 을 카탈로그에 등재하면 문서가 "365일 보존"을 주장한다 — 집행 잡이 없다**(3축 공통 재실측: `security.audit.retentionDays` 를 읽는 코드 = 선언 1행뿐) | L13·§3 B9 |

#### (7) 이 라운드에서 드러난 실물 결함(LoopSpec 과 무관 · 별도 회수 대상)

| # | 실물 | 근거 | 성격 |
|---|---|---|---|
| 1 | 🔴 **약국 화면이 검증 탈락 결과를 "AI" 로 표시한다** — `reviewPrescriptionAI` 가 봉투와 무관하게 `source: 'AI'` 를 **무조건** 붙이고, 화면이 그 값을 `AiSuggestionPanel source=` 로 그대로 그린다. 검증층이 폐기한 응답(`FALLBACK`)도 약국에서는 "AI 검증 통과"로 보인다 | `pharmacy/pharmacy.service.ts:48` → `(main)/pharmacy/page.tsx:620` · `(main)/workstation/pharmacy/page.tsx` | P15/P17 — **정직성 정본 우회** |
| 2 | 🔴 **FE 가 `encounterId` 를 갖고 있으면서 약물추천에 넘기지 않는다** → DUR 재검증이 보는 진료가 **현재 진료가 아니라 환자의 최근 진료**가 된다(임신 여부·현 진료 처방 점검의 기준이 과거 진료) | `AiAssistantPanel.tsx:616-619`(전달 안 함) vs `:635`(chart-qa 에는 전달) · `drug-verdict.ts:449-454` | 계약 누락 |
| 3 | 🔴 **활력 수집 판정 문구가 서버 어휘와 하나도 맞지 않는다** — FE `TIME_FLAG_TEXT` 키는 `FUTURE`·`UNKNOWN_MEASURED_AT`·`FAR_PAST` 인데 서버가 내는 값은 `MEASURED_AT_UNKNOWN`·`MEASURED_AT_DEFAULTED_TO_RECEIPT`·`FUTURE_MEASURED_AT`·`EXCESSIVE_BACKDATE` — **교집합 0**. 전건이 폴백 문구(`측정 시각 확인 필요(<코드>)`)로 떨어진다 | `apps/web/src/lib/vitals-ingest-notice.ts:31-35` vs `vitals-ingest.service.ts:147-155` | **P11**(FE↔서버 계약 불일치) · 오늘 신설된 정본에서 발생 |
| 4 | **경보 등록부의 `emitters` 줄번호가 드리프트했다** — `VITAL_ALERT` 는 `vitals/vitals.service.ts:124` 를 가리키는데 그 줄은 `extras: { bmi … }` 다(실제 발행은 `:156` → `:186`). `PACU_VITAL_ALERT` 의 `pacu/pacu.service.ts:147` 은 `const flags = …`(실제 `:165`) | `notification/alert-registry.ts` · 총 emitter 참조 75건 중 **수기 확인한 2건이 드리프트**(나머지는 기계 판정 불가) | 🔴 **§3 B14 의 실증** — 오늘 파일을 고치자 같은 날 카탈로그가 틀렸다 |
| 5 | `AiRecommendDrugsDto.patientContext` 에 **항목 검증이 없다**(`@IsOptional()` 뿐 · `@ValidateNested`/`@Type` 부재) — `eGFR` 이 무검증으로 용량 판단 프롬프트에 들어간다 | `dto/medical-ai.dto.ts:287-294` | §4.3 축(ValidationPipe 스킵)과 같은 계열 · L0 의 `results[]` 와 동형 |
| 6 | 진단 자유 텍스트가 **감사 원장에 평문**으로 들어간다(`{ diagnosis: dto.diagnosis }` → `egressSummary` → `AuditLog.changes.egress.new`) | `medical-ai.controller.ts:428` · `:86-110` | 최소수집 — 판단 필요(감사 가치 vs PHI) |

#### (7-a) 회수 판정 — 2026-08-27 (7일 뒤 재실측)

§(7) 의 실물 결함 6건이 실제로 회수됐는지 코드로 확인했다.

| # | 실물 | 2026-08-27 상태 |
|---|---|---|
| 1 | 약국이 검증 탈락을 "AI" 로 표시 | ✅ 회수 — `const source = result?.source ?? 'FALLBACK'`(출처를 지어내지 않는다) |
| 2 | FE 가 `encounterId` 를 약물추천에 안 넘김 | ✅ 회수 — `AiAssistantPanel.tsx:620` 에서 전달 |
| 3 | 활력 판정 문구 어휘 교집합 0 | ✅ 회수 — 값·문구 정본이 shared 하나로 |
| 4 | **emitter 줄번호 드리프트** | 🔴 **미회수였다 → 오늘 회수**(아래) |
| 5 | `patientContext` 무검증 | ✅ 회수 — 클래스 + `@ValidateNested` |
| 6 | 진단 자유 텍스트가 감사 원장에 평문 | ⏳ **그대로** — 최소수집 vs 감사 가치의 **사람 판단**(`medical-ai.controller.ts:430`) |

##### #4 — "오라클이 없다"고 남긴 자리에 오라클을 만들었다

§(8) 이 **"emitter 참조 75건 중 줄번호 정합을 기계로 판정하지 못했다(오라클이 없다).
수기로 확인한 2건만 드리프트로 적었다 — 더 많을 수 있으나 세지 않았다"**고 남겼다. 세어보니:

| | |
|---|--:|
| 대상(PATIENT_PUSH 4 제외) | **66** |
| 🔴 실제 발행 지점과 어긋남 | **41** |
| 일치 | 25 |
| 등재됐는데 발행 코드 없음 | **0** |

리스너 항목들이 **일제히 +52줄 밀려** 있었다 — 파일이 자랐는데 등록부가 안 따라갔다.
`emitters` 는 `/admin/safety-gates` 경보 패널에 **사람에게 표시**되므로, 틀린 줄번호는
"여기서 발행된다"는 거짓말이었고 **아무도 확인할 방법이 없었다.**

- 도출 정본 `scripts/alert-emitters.mjs`(`npm run alert:emitters` · `--check` · `--write`)
- 가드 `test/notification/alert-emitters-drift.spec.ts` — **스크립트와 같은 함수**를 쓴다(판정 정본이 둘이 되지 않게)
- 🔴 **오라클을 다섯 번 고쳤다.** 첫 판정은 77/81 "어긋남"이었는데 **대부분 내 오탐**이었다
  (`emitters` 는 `.emit()` 만이 아니라 알림 생성 지점도 가리킨다 · `type:` 자리가 아닌
  대문자 리터럴을 전부 주웠다 · `type:` 과 값이 여러 줄에 걸친 호출 · 3글자 코드 `EDU` ·
  `static readonly NOTIFICATION_TYPE` 상수 경유). **관례가 네 가지로 섞여 있었기 때문에
  "오라클이 없다"는 진단이 옳았다** — 없는 것을 만든 것이지, 있는 것을 못 본 것이 아니다.
- 재주입 2/2 — 등록부 줄번호 편집 · 발행 코드를 위로 밀어내기. 🔴 첫 재주입은 **삽입 위치가
  대상 줄보다 아래라 아무것도 밀리지 않아 통과**했다(내 재주입이 틀렸던 것이다).

#### (8) 확인하지 못한 것(정직하게 남긴다)

- **운영 실측을 하지 않았다**(운영 DB 조회 없음). 그래서 `budgets.latency.p95_ms`·`Kpi.baseline`·`min_ppv` 를 세 파일 모두 비웠다.
- `realtimeDdx`·`autoSoap` 은 여전히 역기술하지 않았다. 🔴 **A3(`write_back` required)은 이번에도 검증하지 못했다** — L1 의 세 축이 전부 `target: none` 이다. `draft_note` 계열(SOAP 초안·퇴원요약)은 **다음 라운드가 필요하다**.
- 외부 설계서의 예제 3종은 여전히 **동봉받지 못했다** — "세 예제 모두 스키마 검증 통과"는 확인하지 못했다.
- 경보 등록부 emitter 참조 75건 중 **줄번호 정합을 기계로 판정하지 못했다**(오라클이 없다). 수기로 확인한 2건만 드리프트로 적었다 — 🔴 **더 많을 수 있으나 세지 않았다.**
- 축 B 의 "PACU·원격진료 활력은 포트 밖"은 구조 가드의 대상 범위(`vitals-ingest-port-guard.spec.ts:24-28`)와 `pacu.service.ts:143-162` 로 확인했다. **다른 활력 저장 경로가 더 있는지는 전수 조사하지 않았다.**

---

## 5. 코드 자산 매핑 (L0·L1 파일럿의 입력 · 2026-08-20 재실측)

| LoopSpec | 이 저장소 정본 | 비고 |
|---|---|---|
| `spec.tools.allow` | `modules/orchestrator/tool-registry.ts` | 툴 시그니처는 있으나 Tier·사후조건 없음 |
| `spec.verification.rules[]` | `medical-ai/ai-verify.ts` — **9규칙** | `KOREAN`·`MIXED_SCRIPT`·`LAB_DIRECTION`·`ONLY_PROVIDED_TESTS`·`SEX_AGE`·`FORBIDDEN_ADVICE`·`DRUGS_RESOLVABLE`·`DRUG_NAME_SCRIPT`·**`NON_EMPTY:<필드>`**(파라미터형 — 종전 이 표에서 누락) |
| **(대응 블록 없음)** 정본 재검증 층 | `medical-ai/drug-verdict.ts` | 🔴 §4-L1 **N1** — `tools`(모델 주입)도 `verification`(출력 검증)도 아니다. `verification.resolvers[]` 신설이 차단 조건 7 |
| `spec.verification.on_fail` | `finalizeSkill`/`failedSkill` 봉투(`source`/`reason`) | `drop_silently` 대응물 **없음**(의도적). 🔴 §4-L1 **N4** — 실물은 **규칙별 조건부 재호출 + 20초 예산**이라 단일 enum 으로 접히지 않는다 |
| `spec.context.resources` | `medical-ai/patient-brief.service.ts` | `purpose` 필드 없음 → 파일럿에서 신설 |
| `spec.context.precompute` | 같은 파일 야간 크론 + 이벤트 무효화 6종 | `ai.brief.batch.enabled` 기본 OFF |
| `reasoning.on_insufficient_evidence` | `medical-ai/ai-grounding.ts` `aiUnavailable()` | 사유코드 4종 |
| `output.write_back` | `<DraftBanner>` + `POST /ai/draft-applied` | 스키마 프로비넌스는 사람 게이트 |
| `budgets.alerts` | `notification/alert-registry.ts`(**66종** — 2026-08-20 재실측 `code:` 66건) | 전부 `UNAPPROVED`·라우팅 미승인. 🔴 `emitters` 줄번호가 **같은 날 드리프트**했다(§3 B14 실증) |
| `budgets` (배치) | `patient-brief.service.ts` — 환자당 `patientBudgetSec`(60) · `concurrency`(3) · 초과분은 `unavailable` 에 "미계산"으로 적음 | 🔴 §4-L1 **N13** — `Budgets` 에 `per_target_ms`·`concurrency`·`declare_uncomputed` 슬롯 없음 |
| **(대응 블록 없음)** 루프 합성 | `patient-brief.service.ts:214,220`(브리핑 → `interpret-lab` 호출·프로비넌스 이전) ↔ `medical-ai.service.ts:930-950`(스킬 → 브리핑 소비) | 🔴 §4-L1 **N11** — 루프 참조 슬롯 없음(구조 변경 필요) |
| **(대응 블록 없음)** 판정 봉투(비-AI) | `vitals/vitals-ingest.service.ts:174-191` → `vitals.service.ts:22-32` → 응답 `meta.ingest`(`vitals.controller.ts:25`) → FE 정본 `lib/vitals-ingest-notice.ts` | 2026-08-20 신설. 🔴 §4-L1 (3) — 이 루프 자체는 **LoopSpec 대상 밖**이나, `dedupeChecked`("판정 불가"≠"중복 없음")·`unstored` 규약은 AI 루프에도 필요하다(N8·N9) |
| **(대응 블록 없음)** 전송 3상태 | `hira-edi/hira-transmission.ts`(`HIRA_CHANNEL.implemented` · `LOCAL_RECORDED`/`SEND_FAILED`/`SUBMITTED`) · 같은 형태 `infection-control/external-reporting.ts` · 소비처 `claim/claim.service.ts:123-170` | "없는 연동을 흉내내지 않는다"의 정본. 🔴 `write_back`·`audit` 어느 쪽에도 "나가지 않았다"를 적을 자리가 없다(N9 와 같은 축) |
| `budgets.latency` | 스킬 봉투 `latencyMs` · `GET /ai/skill-metrics` | 강제는 없음(측정만) |
| `rollout.kill_switch.auto_trip` | `ai.skill.quality.action`(OFF/WARN/BLOCK) | 2026-08-20 신설·기본 OFF |
| `evaluation.gates` | `skill-metrics`·`draft-metrics`(무수정 승인율) | CI 차단 배선 없음 |
| `risk.ai_disclosure` | shared `AI_ORIGIN_TEXT` · config `ai.disclaimer` | AI 병기 정책(2026-08-19) |
| `risk.privacy.external_model_transfer` | `common/util/ai-egress-fetch.ts` · `assertAiServerUrl` | 🔴 `AI_EGRESS_ALLOWED_HOSTS` **미설정이면 호스트 제한 미작동** |
| `metadata.approvals` | `/admin/go-live` 레지스트리 · 거버넌스 엔진 | 승인 만료 감시는 이미 있음 |
| `audit.access_log_identity`(AI 열람) | `@AuditAiRead` — **23 EP**(`audit/no-audit.decorator.ts:35` · `audit.interceptor.ts:103,127-133`) | 2026-08-20 신설. `patientBound=true\|false` 를 원장이 밝힌다(모르는 것을 patientId 인 척 넣지 않는다). 🔴 **크론·서버-서버는 여전히 탈락**(`:117` `if (!user?.id) return`) — 브리핑 야간 배치가 그 자리다 |
| `evaluation.gates` (구조 불변식) | `test/architecture/*.spec.ts` — 예: `vitals-ingest-port-guard.spec.ts`(여유 0 동결) | 🔴 §4-L1 **N15** — `gates[]` 는 `{metric, operator, threshold}`(수치)라 **불변식 게이트를 담지 못한다.** 이 저장소에서 가장 잘 작동해 온 방어가 스키마에 자리가 없다 |

---

## 5-a. 🔴 L2 는 지금 착수할 수 없다 — 무엇에 막혀 있는가 (2026-08-20 정리)

L1 이 끝나면서 남은 것은 **거의 전부 사람 결정**이다. 코드로 밀어붙일 수 있는 부분이 없다 —
카탈로그를 시드해도 **오너가 없고**(CODEOWNERS 부재), Hook 은 현 enum 으로 **0개**가 나오며,
Prompt Registry 는 **개념 자체가 없다**. 그래서 "L2 잔여"의 정직한 정리는
**막고 있는 결정을 등록부로 올리는 것**이다.

🔴 이 결정들은 이제 문서가 아니라 **`/admin/decisions`(2415)** 에 있다 —
문서에만 적힌 게이트는 운영자가 볼 수 없고, 결정해도 근거가 남지 않는다.

| 막고 있는 결정 | 층 | 없으면 무엇이 안 되나 |
|---|---|---|
| `policy.loopspec.adopt` | 원내 위원회 | **L2 전체**. 채택 여부·범위가 정해지지 않았다 |
| `policy.loopspec.lifecycleAuthority` | 원내 위원회 | shadow 를 벗어날 근거가 없다(개념 자체가 저장소에 없다) |
| `policy.catalogOwnership` | 원내 위원회 | 카탈로그를 시드해도 **드리프트가 방치**된다 · Metric 분모 정의 주체 부재 |
| `legal.aiEgress.transferScope` | 허가권자 | `external_model_transfer` 를 정직하게 적을 값이 없다(S3) · air-gap 요건 여부 |
| `policy.aiQualityThreshold` | 원내 위원회 | `min_ppv` baseline 이 없어 품질 임계를 감으로 정하게 된다 |

**스키마 개정(S1·S2·S4)** 은 외부 스키마 소유자 몫이라 이 저장소가 결정하지 못한다 —
§4-L1 (6) 의 차단 조건 9건이 그 입력이다.

🔴 **"L2 를 착수했다"고 적지 않는다.** 위 결정 중 하나라도 미결이면 카탈로그를 만들어도
**관리되지 않는 목록**이 하나 더 생길 뿐이다(이 저장소가 반복해서 다친 방식).

## 6. 사람·외부 게이트

1. 🔴 **채택 여부 자체** — ✅ **L1 완료(§4-L1)**. 판정 = **보완 후 채택 가능 · 범위 = AI 루프 한정 · L2~L3, L4 조건부.**
   남은 사람 결정은 §4-L1 (6) 의 **S1~S4 · P1~P5** 다. 특히 S2(적용 범위 문언)와 S3(원내 전송 값)는
   **어느 루프도 그 전엔 정직하게 작성될 수 없다**(기계 검증으로 확인).
2. ⚠️ **부분 해소(2026-08-20)** — `risk.privacy.external_model_transfer` 는 **AI 서버 = 원내(WeRU.B)** 전제다.
   종전엔 "폐쇄망 vs 위탁" 미결에 묶여 어떤 루프도 `general` 로 갈 수 없었다.
   🔴 **그러나 그 전제를 스키마에 적을 값이 없다** — enum 3값 중 어느 것도 "원내 처리"가 아니다(§4-L1 (0)).
   → **S3(사람 결정)**: enum 에 `INTERNAL_ONLY` 를 추가할지, 아니면 이 필드를 required 로 올리며 값 집합을 다시 정할지.
   🔴 그리고 남는 것은 **폐쇄망(air-gap) 여부**다 — 현재 전송이 Cloudflare 를 경유하므로,
   air-gap 을 요건으로 삼는다면 그건 **별도 판단**이다(모델 소재지와 전송 경로는 다른 사실이다)
3. Tool Registry Tier 2 등재 기준(위원회) · Rule Catalog 소유(임상팀) · Metric Catalog **분모 정의**(데이터팀)
4. 라이프사이클(shadow/limited/general) 승격 권한과 절차 — 지금 저장소에는 이 개념 자체가 없다
5. `budgets.alerts` 값(알림 관제) — 경보 등록부 P1 라우팅 표 승인과 같은 게이트

---

## 7. 검증 규칙(이 문서가 스스로 지킬 것)

- §1·§3 의 모든 수치는 **날짜와 계측 방법**을 함께 적는다. 원 설계서에서 인용한 값은 인용임을 밝힌다
- 🔴 **파일럿 없이 "LoopSpec 이 우리 문제를 푼다"고 적지 않는다.** L0 의 표현 불가 목록이 나오기 전까지 이 문서의 §4 이후는 **제안**이다
- 채택하더라도 **기존 정본을 지우지 않는다** — 런타임을 새로 만들면 정본이 둘이 된다(§4 L5 의 경고)
- 카탈로그에 등재하는 값은 **재실측한 것만**. 문서에 적힌 값을 그대로 옮기지 않는다(B14 — 오늘 3건이 그렇게 틀렸다)
