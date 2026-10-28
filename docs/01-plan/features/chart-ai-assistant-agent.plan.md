# 차트 진료 보조 → 동작하는 임상 에이전트 — 검토·보완 기획서

> 작성 2026-08-19 · 상태 **P0·P1·P2 완료(2026-08-25 재실측 확인) · P3 은 사람 게이트 대기** · 대상 화면 `patients/[id]/encounter/new` 하단 "AI(WeRU.B) 진료 보조" 패널
> (`components/AiAssistantPanel.tsx` 1,326줄 · 탭 10개 · EP 12개).
> 이 문서는 "기능을 더 단다"가 아니라 **왜 지금 가동되지 않는지를 실측으로 밝히고, 하나의 에이전트로 다시 묶는** 문서다.

## 0. 이 문서의 위치 — 정본이 둘이 되지 않게

| 축 | 정본 | 이 문서와의 관계 |
|---|---|---|
| 에이전트 관계 모드(감시/보조/초안/실행제안/자동실행)·표기·출처 3상태·초안≠확정 | `clinical-ux-agent-era.plan.md` §7 | 그 규약을 **이 패널에 적용**하는 실행 설계 |
| AI 근거(grounding) 계약 · `UNAVAILABLE` | `medical-ai/ai-grounding.ts` | 스킬 호출 앞 게이트로 그대로 쓴다 |
| 프롬프트 "없음" 3상태 · AI 표기 병기 | `promptList`/`allergyPromptLine` · shared `AI_ORIGIN_TEXT` | 이미 적용됨(2026-08-19) — 여기서 되풀이하지 않는다 |
| 초안 적용 프로비넌스 | `<DraftBanner>` · `POST /api/v1/ai/draft-applied` | 스킬 "적용" 액션의 프로비넌스 경로 |
| AgentEMR 정렬(자율성 L0~L3·S1~S4·감사 테이블·human_edit_ratio) | `agent-emr-alignment.plan.md` 3단계 | 이 문서의 P3 자율성 상향은 그 결정에 종속 |
| 경보 등록부 | `alert-registry.plan.md` | 에이전트가 **경보를 만들지 않는다**(제안 배지는 경보가 아니라 화면 상태) |
| 루프 플랫폼(LoopSpec) 도입 검토 | `loop-platform-adoption.plan.md` | 이 문서의 실측(§1.4~§1.6·§4.4)이 그 검토의 근거다. **선언형 채택 여부는 그쪽에서 판정**한다 |
| DUR·포뮬러리 게이트 | `dur.enforce`·`formulary.enforce` 정본 | 약물추천 스킬은 이 게이트로 **재검증**된 결과만 낸다 |

## 1. 실측 — 왜 "가동되고 있지 않은가" (2026-08-19 14:5x · 운영 `his.example.org` · 시드 환자 51세 여성)

재현: `infra/scripts/probe-chart-ai.py`(같은 입력으로 12 EP 를 부른다 — 이 표는 그 출력이다).
AI 서버 상태: `connected:true` · `https://example.org/ollama` · `qwen2.5:14b`(quality_check 통과) · 지식베이스 156건. **서버는 살아 있다.**

| 탭 | 트리거(현행) | EP | 지연 | 실측 결과 | 출처 표기 |
|---|---|---|---|---|---|
| **감별진단(기본 탭)** | S/O 입력 2초 디바운스 자동(패널 열려 있을 때) | `realtime-ddx` | **15~23s** | 🔴 `differentials: []` — LLM 은 답했으나(로그 `quality=true`) JSON 이 비었거나 파싱 실패. 화면은 **"S/O 입력 시 자동으로 감별진단이 표시됩니다"** 그대로(실패를 침묵·`catch {}`) | 없음(`source` 필드 자체가 없다) |
| SOAP초안 | 버튼 | `auto-soap` | 12s | 🔴 **영어**("Acute Coronary Syndrome…") · **임상 오류**("avoiding aspirin due to bleeding risk in ACS" — ACS 에서 아스피린은 금기가 아니라 1차) · plan 6항목 | 없음 |
| 검사해석 | 버튼(최근 결과 자동 로드) | `interpret-lab` | 5~11s | 🔴 **방향 반전** — K 5.9(H) 를 보냈는데 "K 수치는 **저하**" · 보내지 않은 WBC 언급 · 51세 **여성**에게 "전립선 질환 등 내분비계 질환 의심" · confidence 0.8 | 없음 |
| 약물추천 | 버튼 | `recommend-drugs` | 14s | 영어 · 추천 2건(ramipril·amlodipine) · `cdssCheck: PASS` 문자열(어느 정본이 판정했는지 응답에 없음) · orderSet null | 없음 |
| 기록품질 | 버튼 | `chart-qa` | — | `encounterId` 필수 → **새 진료(저장 전)에서는 400** — 패널은 `if (!encounterId) return` 으로 조용히 아무 일도 안 함 | — |
| 환자설명 | 버튼 | `patient-education` | **32s** | 응답 있음(sections 1) | 없음 |
| 추론 | 버튼 | `reasoning/chain` | 0.5s | 🔴 **500 INTERNAL_ERROR** | — |
| 자동기록 | 텍스트 붙여넣기+버튼 | `auto-record` | 7s | 응답 있음(entities·completeness 70) — 앰비언트와 별개 경로 | 없음 |
| AI질문 | 질문 입력 | `clinical-qa` | **31s** | 답변 861자 · references 있음 | 없음 |
| 지식검색 | 검색 | `knowledge/search` | 4s | 10건(로컬 KB) | mode 필드 |
| 인지 배지 | 패널 열림 시 | `patient-context` | — | "복용약물 2" 만 표시. 알레르기 3상태·문제목록·최근 검사는 서버 프롬프트에만 들어가고 화면은 말하지 않는다 | — |

**사용 실적(감사 원장 `Ai*` resourceType, 개통 이래)**: `AiRealtimeDdx 2 · AiAutoSoap 2 · AiInterpretLab 2 · AiRecommendDrugs 2`(전부 이 실측의 프로브) · `AiChartQa 0 · AiClinicalQa 0 · AiPatientEducation 0`. **실사용 0.**

### 1.1-b 🔴 재실측에서 나온 것 — `EMPTY_RESULT` 는 파싱 실패가 아니었다 (2026-08-25)

P2 잔여를 확인하러 `probe-chart-ai.py` 를 다시 돌렸더니 **운영 계측이 결함 하나를 드러냈다.**

| 실측 | 값 |
|---|---|
| `RealtimeDdx` 30일 계측 | 호출 16 · **FALLBACK 10** · 그중 **`EMPTY_RESULT` 9건** |
| 서버 형태 로그 | `extracted=true keys=__array diffs=n/a` — **추출은 성공했는데 항목이 0** |
| 재현(3회) | `EMPTY_RESULT` 1 · `MIXED_SCRIPT`(키릴 `имер` 혼입) 1 · `AI` 1 |

🔴 **원인은 파서가 아니라 이름 키였다.** P0 에서 `{ {…},{…} }` 형태와 잘린 답변은 이미 봉합했는데,
모델이 진단명을 `name` 이 아닌 **다른 키**(`diagnosis`·`condition`·`disease`·`진단명`)로 내는 경우가 남아 있었다.
`String(d.name ?? '')` 가 빈 문자열이 되어 **검사 어휘 판정도, 이름 표시도 못 했고** 결과가 0건이 됐다.

**봉합**: 이름 후보를 넓혀 읽고 `name` 으로 정규화(`nameOf`). 🔴 **모델의 출력 어휘는 우리가 강제할 수
없으므로 읽는 쪽이 유연해야 한다** — 단 **지어내지 않는다**(후보가 전부 비면 빈 이름 그대로 두고
`checkNonEmpty` 가 잡는다). 진단 로그에 `__array` 길이를 남겨 다음에 같은 증상이 나면 원인을 바로 가른다.

**봉합 후 재실측(2026-08-25 · 배포 직후 · 4회)**: **4/4 `AI` · 감별 3건 · 검사 2건 · 빈 결과 0건.**

가드 `ddx-name-keys.spec.ts` 5종 — 양방향 재주입 확인(이름 후보 축소 시 실패 · 폴백 문구 주입 시 실패).
🔴 첫 가드는 `/unknown/i` 로 스캔해 **내 타입 `Record<string, unknown>` 을 오탐**했다 — 문자열 리터럴만 보게 고쳤다.

### 1.2 P0 적용 후 재실측 (2026-08-19 저녁 · 같은 프로브 · 배포 후 갱신)

| 항목 | 적용 | 재실측 |
|---|---|---|
| 출력 계약 | 감별진단·SOAP·검사해석·약물추천·추론 5스킬이 `source/reason/latencyMs/verify/groundedOn` 봉투를 낸다(`ai-verify.ts` `finalizeSkill`) · 빈 배열=`FALLBACK/EMPTY_RESULT` | **배포 후 재실측(16:00·같은 프로브·3회)**: 감별진단 `AI` 3~7건(8~40s — 상류 부하 편차) · SOAP `AI` 한국어(4~18s) · 검사해석 `AI`(12s · flag 방향 검증 통과) · 약물추천 1회 `AI`/1회 `FALLBACK:KOREAN`(16s · 영어 답변 · 20초 예산 안 재시도만) · 추론 `AI` 5단계(상류 `patient_text`·타임아웃 확대) · 기록품질 encounterId 없이 동작(6~17s) |
| 🔴 빈 감별진단의 실제 원인 | 형태 진단 로그(문자 마스킹)로 확인: 모델이 배열을 **`{ {…},{…} }` 로 감싸고 토큰 상한에 잘려** 균형이 안 맞아 탐욕 정규식·JSON.parse 가 전부 실패 → 규칙 폴백 → 빈 배열 | `extractJsonObject`(균형 스캔·후행 콤마·브레이스 집합→`__array`·잘린 답변은 완결 항목만+`truncated`) + 감별 집합에 섞인 검사 어휘 → suggestedTests 분리 |
| 검증층 | 한국어 비율·flag↔해석 방향·미입력 검사 언급·성별/연령 부적합·금칙 조언·빈 결과 — 실측 3결함 재주입 테스트가 전부 잡는다(`skill-contract-guard.spec.ts`) | — |
| 검사해석 입력 | DTO 에 `flag` 추가 · FE 가 LIS flag 를 보낸다 · 프롬프트에 ↑/↓ 명시 · "전달된 검사만" 지시 | — |
| 추론 500 | 상류 계약 드리프트(`patient_text` 필수) — 합성해 함께 전송 · 실패는 `FALLBACK/UPSTREAM_ERROR` | — |
| 기록품질 | `encounterId` 선택 — 저장 전 폼 값으로도 실행 | — |
| 약물추천 | LLM `cdssCheck:"PASS"` → `modelNote` 로 격하 · `durVerdict:null`+근거("DUR 정본 재검증 미배선 P1") — 초록 배지 금지 | — |
| FE 정직화 | DDx `catch{}` 침묵 제거·20초 타임아웃·오류/재시도 표시 · 5탭 `SkillNotice`(AI 검증 통과·지연 / FALLBACK 사유·실패 규칙 / UNAVAILABLE) · **검증 실패 초안은 적용 버튼 비활성** | — |
| 계측 | `Ai*Outcome` 감사행(source·latency·verifyFailed) + `GET /api/v1/ai/skill-metrics` + `/admin/ai-settings` "스킬 계측" 표(`<Ratio>`·`seconds` 정책) | — |
| 하이브리드 P0 | `PatientBriefService`(배치 A·결정론·Redis 24h·이벤트 무효화 6종·야간 크론=내일 예약+재원·config `ai.brief.batch.enabled` 기본 OFF·go-live H 등재) + `GET /api/v1/ai/brief/:patientId` + 패널 헤더(기준 시각·알레르기 3상태·검사 이상 n/N·활력·못 센 축) | — |
| 가드 | `ai-verify.spec` 8 · `skill-contract-guard.spec` 8 · `patient-brief.spec` 4 · web `ai-assistant-panel-honesty.spec` 5 | — |

### 1.3 P1 적용 후 (2026-08-19 저녁 · 병렬 에이전트 2기 → 코디네이터 통합)

| 축 | 구현 | 계약(정확한 이름) |
|---|---|---|
| 컨텍스트 빌더 | 4스킬이 `PatientBriefService.get()` 브리핑을 주입(없으면 종전 직접 조회) | `groundedOn` `'브리핑(<trigger> <computedAt>)'` · 미계산 축 `'⚠️ 브리핑 미계산 축: …'` |
| 실시간 응답 캐시 | Redis `ai:skill:<skill>:<sha256(patientId+입력)>` TTL 600s · **`source==='AI'` 만** | `cached:true`·`cachedAt`·`latencyMs` 원본 유지 (miss 면 필드 없음) |
| 약물추천 DUR 정본 | `drug-verdict.ts`: 약가마스터 매칭(`buildMedicationSearchWhere`·1건/정확일치만 ONE·다건=UNRESOLVED) → `DurService.checkInteractions`(진료 없으면 최근 진료→ZERO_UUID·임부검사 생략 명시) | `durVerdict PASS/WARNING/BLOCK/UNRESOLVED/null` · `durVerdictBasis` · `durWarnings[]` · `medicationCodeId` · `resolvedName` · 입력 `encounterId?` |
| 배치 B | 야간 크론에서만 · `ai.brief.llm.enabled`(기본 OFF·go-live H) · 검사 있는 환자만(근거 게이트) · 검증층 통과분만 저장 · 환자당 예산 `ai.brief.patientBudgetSec`(60) · 미계산 사유는 `unavailable` | `PatientBrief.skills.labInterpretation`(interpretLab 봉투 + `computedAt`·`basedOn[]`) · `nightly()` 반환 `llm:{eligible,computed,budgetSkipped,rejected,…}` |
| FE 관계 모드 | 10탭 배지 정본 `ai-skill-modes.ts`(자동실행 없음) | — |
| FE 감시 제안 | 접힌 헤더 `제안 N`(결정론만: 검사 이상·알레르기 미문진·감별 대기·약물추천 가능) · 접힌 상태 LLM 호출 0(브리핑 GET 만) | — |
| FE 사전 해석 | 검사해석 탭 상단 "사전 해석(야간 배치 hh:mm 기준)" + 지금 다시 해석 · 캐시 표기 | — |
| FE DUR 배지 | PASS/WARNING/BLOCK/UNRESOLVED/미검증 5상태 · BLOCK·UNRESOLVED 는 `처방 추가` 비활성(처방 파이프 DUR 는 그대로) | — |
| FE 서명 전 기록품질 | 서명과 **병렬**(비차단·15s) `PreSignQaChecklist` — 종전엔 chart-qa 를 await 해 서명이 6~17초 지연되고 toast 로 소실 | — |
| 관리자 | `/admin/ai-settings` 하이브리드 스위치 카드(4키·H 등재) + 스킬 계측 표 | — |
| 가드 | api `skill-brief-injection` 12 · `drug-verdict` 15 · `patient-brief` +5 · web honesty 11 · `ai-skill-mode-badge` 19 — 재주입 역검증(캐시 flag 제거·FALLBACK 저장·WARNING→PASS·다건→첫 건·서명 await 재주입 등) 실패 확인 | — |
| 판정 유의 | 약가마스터 다건 매칭이 흔해 `UNRESOLVED` 비율이 높을 수 있다(정확 상품명만 ONE) — P2 에서 성분 단위 판정 검토 | — |

### 1.4 P2 배포 후 재실측 (2026-08-20 08:48 배포·스모크 29 · 같은 프로브)

| 항목 | 결과 |
|---|---|
| `draft-metrics` | 가동 — `applied 1 · outcomes 0 · median null`(**산출 불가**, 0% 아님). 서명 보고가 들어오기 전까지 이 값이 정상이다 |
| 스킬 계측(누적) | AutoSoap 7/8 · RecommendDrugs 5/7 · RealtimeDdx 5/14 · InterpretLab 2/9 (AI 통과/호출) |
| 🔴 **성분 단위 DUR 적중 = 0/6** | 진단 5종 프로브: `EXACT 0 · INGREDIENT_GROUP 0 · AMBIGUOUS 2 · NONE 4` |
| ↳ 원인 ①(4건) | **약명이 마스터에 없다** — `나이아즈올`(존재하지 않는 약·환각) · `로바statin`(한글+라틴 혼입) · `파разォ린`(키릴+가나 — MIXED_SCRIPT 가 잡아 FALLBACK) · `Rosiglitazone`(국내 마스터 부재) |
| ↳ 원인 ②(1건) | `Metformin` **후보 200건 초과 절단** — 성분 동일 여부를 확인할 수 없어 UNRESOLVED(설계대로 안전측) |
| ↳ 원인 ③(1건) | `ramipril` 후보 7건이 **성분 5종** — 검색이 다른 성분을 끌어온다 |

🔴 **가장 큰 것은 DUR 판정률이 아니다**: 약물추천이 **존재하지 않는 약을 내면서 `source:'AI'` 로 나갔다**(검증 통과로 표시). 기획서 §4.4 규칙 6 `drugsResolvable` 이 **절반만 구현**돼 있었다(`durVerdict` 는 됐고 해석 가능성 검증은 없었다).
→ 후속: 검증층 `DRUGS_RESOLVABLE`(미매칭 비율 임계) + `DRUG_NAME_SCRIPT`(한 토큰 안 한글+라틴 혼입) 추가 · **모델 품질 임계를 운영 다이얼로그로**(§6-1 사람 게이트를 화면으로 내림 — 기본 미설정·OFF, 위원회가 실측을 보고 값을 넣는다).

### 1.5 성분 단위 DUR 판정 — 운영 재현 결과 **효과 없음**(2026-08-20 · 코디네이터 직접 실측)

`GET /api/v1/codes/medication?q=<약명>&limit=100`(정본 `buildMedicationSearchWhere`)로 10개 약명을 재현:

| 약명 | 후보 | 성분키 | 판정 |
|---|---:|---:|---|
| 암로디핀 / 메트포르민 / 로수바스타틴 / Metformin | 100(절단) | 56 / 57 / 19 / 48 | AMBIGUOUS |
| 아스피린 | 54 | 5 | AMBIGUOUS |
| ramipril / 라미프릴 | 7 / 5 | 5 / 3 | AMBIGUOUS |
| 나이아즈올 · 로바statin · Rosiglitazone | 0 | — | NONE |

🔴 **INGREDIENT_GROUP 적중 0/10.** 이유는 절단이 아니라 **성분명 부분일치가 복합제·유사명을 대량으로 끌어오기 때문**이다(암로디핀 100건에 성분 56종). 성분 그룹 판정은 설계대로 안전측(모르면 UNRESOLVED)이라 해롭지 않지만 **운영에서 거의 발동하지 않는다.**

정직한 결론 — 이 축은 "성분명 검색 → 성분 그룹"으로 풀리지 않는다. 후속 선택지(P3, 미착수):
1. LLM 에게 **약명 대신 성분코드/ATC** 를 내게 한다(프롬프트·스키마 계약 변경)
2. 추천을 **마스터의 실제 후보 목록에서 고르게** 한다(약속처방 `setCatalog` 선례 — 이미 orderSet 에서 그렇게 한다)
3. 그대로 두고 처방 폼에서 사람이 특정(현재 동작 · UI 는 이미 `DUR 미검증`/`약가마스터 미매칭`을 정직하게 표시)

🔴 이 실측을 얻기까지 **내 프로브가 세 번 거짓말했다**: ① 파라미터를 `search=` 로 써서(정본은 `q`) whitelist 가 지운 채 전체 목록 첫 5건을 "검색 결과"로 읽음 ② `meta.total` 부재를 0건으로 읽음 ③ `limit=200` 이 400(상한 100)인데 오류를 빈 배열로 삼킴. **계측 도구부터 오류를 드러내게 만들지 않으면 실측이 아니다.**

### 1.6 약물추천 성분 해석 재설계 — 원인 규명과 결과 (2026-08-20 · 병렬 에이전트)

🔴 **§1.5 의 `INGREDIENT_GROUP` 적중 0/10 은 후보 절단 때문이 아니었다.** 운영 마스터(활성 22,713행) 전수 계수로 밝힌 진짜 원인:
`ingredientCode`(예 `107601ATB`·9자리)는 **성분이 아니라 성분+염+함량+제형** 식별자다. 그래서 amlodipine **단일제만으로도 코드접두 15종**으로 흩어지고, **같은 성분이 구조적으로 한 키에 모일 수 없었다.**

| 마스터 실측 | 값 |
|---|---|
| `ingredient` 표기 | 최상위 **콤마 구분** 성분 목록 · 단일제 17,157 / 복합제 5,556 / 없음 387 |
| 괄호 안 콤마 | 74행(`(as EPA …, DHA …)`) → 콤마 분해는 **괄호 깊이**를 봐야 한다 |
| 염 표기 | `metformin` 정확일치 단일제 **1건** vs `metformin hydrochloride` **127건** |
| 대표(최소 code) 적중 순위 | 중앙 1 · p95 5 · p99 38 → **200 초과는 0.24%**(상한의 근거) |

**해법** = 프롬프트 계약 + 데이터 기반 2단 해석. LLM 이 제품명 대신 **INN 성분명**(`ingredient`)을 내고, 서버가 활성 본체 **정확일치** → **행마다 단일제 검증** → 대표(최소 code). 접미(에스터·프로드러그)는 사전으로 벗기지 않고 **데이터에 물어** 후보가 하나일 때만 특정한다(`olmesartan`→`olmesartan medoxomil` 특정 / `tenofovir` 는 alafenamide·disoproxil 로 갈려 **특정하지 않음**).
🔴 **프롬프트는 user 메시지에 적으면 안 먹혔다** — qwen2.5:14b 가 `ingredient` 키를 통째로 빼먹었다(5진단 **0/5**). system 메시지로 올리고 JSON 예시의 첫 키로 두니 **12/12 준수**(실측 후 채택).

| 판정(같은 15종·운영 마스터 대고 실행) | 개선 전 | 후(약명만) | 후(INN 힌트) |
|---|---:|---:|---:|
| INGREDIENT_GROUP | **0** | 5 | **12** |
| AMBIGUOUS | 12 | 7 | 0 |
| NONE | 3 | 3 | 3 |

**종단(실제 LLM 2회 · 편차가 커서 둘 다 싣는다)**: 판정 가능 **1/20(5%) → 21/27(78%)**. 남은 NONE 은 `sulfonylurea`(약효군)·`colesevelam`(국내 마스터 부재)·`paracetamol`(마스터 어휘는 `acetaminophen`) — 전부 **정직한 NONE**이고 없는 약을 만들지 않았다.
개선 전 LLM 출력 실례: `메토프로롤`(당뇨에 베타차단제 — **임상 오류**)·`시글리타프`·`로세바스`·`에나르プリ` — 대부분 존재하지 않는 약.

🔴 **기존 가드 5건이 결함을 계약으로 못박고 있었다**(`ingredientCode` 를 성분 키로 단언) — 교체. 목(mock)이 `orderBy`/`take` 를 무시했다면 "대표 선택 비결정성" 재주입이 통과했을 것이라 목을 실제 Prisma 처럼 만들었다.
**미해소(다음 축)**: 동의어(`paracetamol`↔`acetaminophen`) — 손으로 사전을 적는 것은 근거 없이 만드는 쪽이라 하지 않았다(NONE 이 안전측 정답).

### 1.1 판정 — 다섯 가지가 겹쳐 있다

1. **정직하지 않다** — 빈 결과·실패·타임아웃을 화면이 "아직 안 눌렀다"처럼 그린다(§7.9 위반). 출처 3상태(`AI/FALLBACK/UNAVAILABLE`)를 이 패널의 EP 12개 중 **0개**가 낸다.
2. **틀린다** — 검사해석이 입력값과 **반대 방향**을 말하고, SOAP 이 위험한 조언을 하고, 영어로 답한다. 결정론적 검증층이 없다(보낸 값 vs 답한 방향, 언어, 성별-질환 부적합).
3. **느리다** — 12~32초. 진료 흐름 안에서 기다릴 수 없는 시간인데 부분 결과·진행 표시가 없다(§7.9 스트리밍 규약).
4. **도구 상자지 에이전트가 아니다** — 탭 10개를 사용자가 골라 눌러야 한다. 진료 단계(S→O→A→P→오더)를 따라 **스스로 무엇을 볼지 정하고 제안 유무를 알리는** 루프가 없다. 관계 모드(감시/보조/초안/실행제안)를 화면이 말하지 않는다.
5. **끝까지 이어지지 않는다** — "검사 오더 추가"·"약 오더" 훅은 있으나 프리필 뒤 DUR·처방 파이프와의 연결·프로비넌스·계측(적용률·무수정 승인율)이 없다.

## 2. 목표 · 비목표

**목표**
1. 패널의 모든 산출물이 **정직**하다 — 출처 3상태·지연·실패·부분 결과를 화면이 말한다.
2. **검증층**을 통과한 것만 보인다 — 방향 대조·언어·스키마·DUR 재검증·성별/연령 부적합 필터. 통과 못 하면 `FALLBACK`(사유) 로 낸다.
3. 탭 10개를 **스킬 10개**로 재정의하고, 진료 단계에 따라 **감시 모드**로 스스로 돌며 "제안 있음" 배지를 낸다(패널이 접혀 있어도).
4. 제안 → **실행제안**(오더 프리필·진단 적용·SOAP 적용·환자설명 발행)까지 한 벌 · 프로비넌스·계측(적용률·무수정 승인율·폐기율).
5. 자율성은 **L1(사람 승인) 고정** — L2 이상은 사람 결정(§6).

**비목표**
- 새 모델·새 AI 서버(폐쇄망 vs 위탁은 별도 결정) · 환자 대면 에이전트(포털 챗은 별도 축) · 앰비언트 스크라이브(별도 정본)
- 자동 오더·자동 서명·자동 전송(§7.3 자동실행 범위 미결)

## 3. 목표 그림 — "차트 옆 에이전트" 한 바퀴

```
[진료 화면 상태]  S/O 입력 · A 입력 · P/오더 · 최근 결과 도착 · 저장/서명 시도
        │ (이벤트)
        ▼
[컨텍스트 빌더]  정본만: 알레르기 3상태(NKA) · 활성약 · 문제목록 · 최근 검사(값+flag) · 활력 · 기존 진단 · 오늘 S/O/A/P
        │
        ▼
[스킬 라우터]    단계별로 어떤 스킬을 돌릴지 결정(§4.2 표) — 감시 모드는 가벼운 스킬만, 무거운 것은 사용자가 연다
        │
        ▼
[그라운딩 게이트] 입력이 없으면 부르지 않는다 → UNAVAILABLE(사유)   (정본 ai-grounding.ts)
        │
        ▼
[실행]           LLM(WeRU.B) 또는 규칙 — 타임아웃 · 부분 결과 스트리밍
        │
        ▼
[검증층]         스키마 · 한국어 · 방향 대조 · 성별/연령 부적합 · DUR/포뮬러리 재검증 · 금칙 조언 → 실패 = FALLBACK(사유)
        │
        ▼
[출력 계약]      { source: AI|FALLBACK|UNAVAILABLE, reason?, latencyMs, model, promptVersion, citations[], confidence?, disclaimer, items[] }
        │
        ▼
[제안 카드]      모드 배지(감시/보조/초안/실행제안) · 근거 앵커 · [적용] [오더 프리필] [무시] · 적용=프로비넌스(DraftBanner + draft-applied)
        │
        ▼
[계측·피드백]    호출 N · 성공/FALLBACK/UNAVAILABLE · 지연 p50/p95 · 적용률 · 무수정 승인율 · 👍👎 · 검증층 폐기 사유별
```

## 4. 설계

### 4.1 출력 계약 — 모든 스킬이 같은 봉투를 쓴다

- `source` 3상태는 **서버가** 결정한다(FE 가 빈 배열을 보고 추측하지 않는다). 빈 결과는 `source:'AI', items:[]` 가 아니라 **`FALLBACK`(사유: 'EMPTY_RESULT' | 'PARSE_FAILED' | 'VERIFY_REJECTED:<rule>' | 'TIMEOUT' | 'UPSTREAM_ERROR')** 로 낸다.
- `latencyMs`·`model`·`promptVersion` 동봉(감사·재현) — 이미 `auditAiEgress` 가 남기는 것과 같은 값.
- `citations[]`: 무엇을 근거로 했는지(검사 결과 id·문제목록 id·지식베이스 id). 없으면 빈 배열이 아니라 **`citations:null` + `groundedOn:['S/O 텍스트만']`** 처럼 무엇만 봤는지 말한다.
- FE 공용 부품 `AiSuggestionPanel`(2026-08-19 3상태 계약) 을 이 패널의 **모든 탭이 쓴다**(지금은 자기 렌더).

### 4.2 스킬 사양표

| 스킬(현 탭) | 관계 모드 | 트리거 | 입력(컨텍스트) | 출력 | 검증층(결정론) | 액션 | 지연 SLA |
|---|---|---|---|---|---|---|---|
| **감별진단** | 감시→보조 | S/O ≥ 20자 · 2s 디바운스 · **패널 접혀도 배지** | S/O·나이·성별·알레르기 3상태·문제·최근 검사 | differentials[{code,name,prob,urgency,reasoning,keyFindings}]·suggestedTests·redFlags | JSON 스키마 · KCD 코드 형식 · 한국어 · 빈 배열=FALLBACK · redFlag 는 **응급 어휘 사전**과 교차(트리아지 정본) | 진단 적용(A 에 `[코드] 명`) · 검사 오더 프리필 | 부분 결과 3s 내 · 20s 타임아웃 |
| SOAP 초안 | 초안 | 버튼(+ A 비어 있고 S/O 있으면 배지) | S/O·DDx 결과·활성약 | assessment·plan[]·references | **한국어 강제**(한글 비율 < 30% → FALLBACK) · 금칙 조언 사전(예: "ACS 아스피린 회피") · plan 항목에 약물이 있으면 DUR 재검증 | SOAP 적용(프로비넌스) | 스트리밍 |
| 검사해석 | 보조 | 결과 도착 시 배지 · 버튼 | 최근 결과(값·단위·flag·기준치)·문제·활성약 | summary·findings[{test,interpretation,severity}]·implication·actions | 🔴 **방향 대조**: flag H 인데 '저하/낮'·flag L 인데 '상승/높' → 폐기 · 언급된 test 가 입력에 없으면 폐기 · **성별/연령 부적합 진단어**(여성-전립선 등) → 폐기 · 위급값은 해석이 아니라 정본 경보 링크 | 검사 오더 프리필 · 문제목록 제안 | 10s |
| 약물추천 | 실행제안 | A 입력 시 배지 · 버튼 | 진단·알레르기 3상태·활성약·eGFR·최근 검사·활성 약속처방 목록 | recommendations[{name,dosage,reason,guideline,**durVerdict**}]·contraindicated·orderSet | 약명은 **약가마스터 매칭**(미매칭=표시하되 오더 불가) · `durVerdict` 는 서버 DUR 정본 결과(문자열 PASS 금지) · 포뮬러리 게이트 | 처방 폼 프리필(승인 토큰·DUR 은 처방 파이프가 강제) | 15s |
| 기록품질 | 감시 | **저장/서명 시도 전** 자동 · 버튼 | S/O/A/P·진단·처방(encounterId 없어도 폼 값으로) | issues[{category,level,message,suggestion}]·grade | 스키마 | 서명 전 체크리스트에 issues 표시(막지 않는다 — 기록만) | 10s |
| 환자설명 | 초안 | 버튼(진단·처방 있을 때 배지) | 진단·처방·검사 | title·sections·precautions·followUp | 한국어 · 금칙(진단 확정 표현·중단 권유) | 포털 문서 초안 발행(검수 후) | 스트리밍 |
| 추론(체인) | 보조 | 버튼 | 증상·소견 | steps[] | 스키마 · **현재 500 — 수리 전까지 탭 숨김이 아니라 "사용 불가(오류)" 표시** | — | 20s |
| 자동기록 | 초안 | 붙여넣기 | 대화 텍스트 | SOAP·entities·completeness | 스키마 | SOAP 적용(프로비넌스·앰비언트와 같은 표식) | 10s |
| AI 질문 | 보조 | 질문 | 질문·환자 컨텍스트(선택) | answer·evidenceLevel·references | 한국어 · references 없으면 evidenceLevel 'UNKNOWN' | 없음(읽기) | 스트리밍 |
| 지식검색 | 보조 | 검색 | 질의 | KB 결과 | — | 근거 링크 | 5s |

### 4.3 트리거·감시 모드 규약

- 감시 모드는 **가벼운 스킬 3개**(감별진단·검사해석·기록품질)만 자동으로 돌고, 결과는 **패널 헤더 배지**("제안 3 · 검사 1")로만 알린다. 접힌 상태에서 PHI 를 보내는 문제(2026-08 실측)는 **환자 컨텍스트가 이미 서버에 있는 스킬만** 자동 허용하고, 사용자가 연 뒤에 본문을 그린다.
- 무거운 스킬(SOAP·약물추천·환자설명·질문)은 사용자가 연다. 배지는 "지금 돌릴 근거가 있다"만 뜻한다(A 가 비었으면 약물추천 배지 없음).
- **지연**: 3초 넘으면 부분 결과·진행 표시, 20초 넘으면 `TIMEOUT` 으로 **실패라고 말한다**. 조용한 빈 화면은 없다.
- **권한 검사는 호출 앞**(§7 규약) — 스킬별 역할(약물추천=DOCTOR·PHARMACIST).

### 4.4 검증층 — LLM 을 믿지 않는다(결정론 규칙 목록·정본 파일 하나)

`medical-ai/ai-verify.ts`(신설 · 순수 함수 · 규칙마다 테스트):
1. `koreanRatio(text) ≥ 0.3` — 한국어 출력 강제(영어 SOAP 실측)
2. `labDirectionConsistent(input, output)` — flag 와 해석 어휘 대조(K 5.9 H → '저하' 폐기)
3. `mentionsOnlyProvidedTests` — 입력에 없는 검사명 언급 폐기
4. `sexAgeAppropriate` — 성별/연령 부적합 질환 사전(전립선·자궁·소아 등)
5. `forbiddenAdvice` — 금칙 조언 사전(응급 표준 치료 회피 문구 등 · 위원회가 관리)
6. `drugsResolvable` — 약명 약가마스터 매칭 · `durVerdict` 는 DUR 정본 호출 결과만
7. `schemaValid` — 스킬별 JSON 스키마(빈 배열은 스키마 통과가 아니라 EMPTY_RESULT)
실패는 **폐기 사유 코드**로 `FALLBACK` 에 실린다 → 계측(폐기율 사유별)이 모델·프롬프트 개선의 분모가 된다.

### 4.5 실행 연결(실행제안 L1)

- 검사 오더 프리필: `onOrderTest` → 오더 폼에 코드 매칭 결과만(미매칭은 검색어 프리필) · 실행은 사람이.
- 처방 프리필: `onOrderDrug` → 처방 폼(승인 토큰·DUR·step-up 은 처방 파이프 정본이 강제 — 우회 금지).
- 진단 적용·SOAP 적용: 이미 `<DraftBanner>`+`draft-applied` 로 프로비넌스. **무수정 승인율**은 서명 시 초안 대비 편집 거리로(간호기록 `aiEditDistance` 선례) — 스키마는 사람 게이트(§6).
- 환자설명 발행: 포털 "쉽게 보기" 검수 큐(drug-explain 선례) 로 — 자동 노출 금지.

### 4.6-a 🔴 하이브리드 실행 모델 — 배치 사전계산 + 실시간 호출 (2026-08-19 추가)

**왜**: 실측 지연 12~32초의 대부분은 진료 **전에** 알 수 있는 데이터(검사 결과·활성약·문제목록·활력 추이·과거 진료)를 진료 **중에** 다시 끌어와 LLM 에 넣기 때문이다. 오늘 S/O 에 의존하는 것만 실시간으로 남기고, 나머지는 **환자별 배치 브리핑**으로 미리 만든다.

| 층 | 무엇을 | 언제 | 어디에 | 무효화 |
|---|---|---|---|---|
| **배치 A — 결정론 브리핑**(LLM 없음·항상 가능) | 알레르기 3상태 · 활성약(+DUR 정본 상호작용 매트릭스) · 활성 문제 · 최근 검사(값·flag·기준치·추이 방향) · 활력 추이 · 기존 진단 · 마지막 진료 요약(정본 필드) | 야간 크론(다음날 예약·재원 환자) + **이벤트 즉시**(검사 확정·조제 완료·입원·서명·활력) + 진료 진입 시 없으면 lazy | Redis `ai:brief:<patientId>`(TTL 24h·`computedAt`·`basis`) — 스키마 없이 시작. 영속 원장은 P2(사람 게이트) | 이벤트 → 삭제·재계산 큐 |
| **배치 B — LLM 사전 스킬**(선택·config) | 최근 확정 검사 **해석**(검증층 통과분만) · 활성약 기반 상호작용 서술 · 만성질환 추이 서술 | 야간 크론 · 대상 = **다음날 예약 + 재원**(전 환자 ×) · 동시성 상한 · 환자당 시간 예산 | 같은 Redis 키의 `skills.*`(각각 `source`·`computedAt`) | 근거 데이터 이벤트 → stale 표시 → 재계산 |
| **실시간** | 오늘 S/O/A/P 에 의존하는 스킬(감별진단·SOAP·기록품질·약물추천의 진단 반영·질문) | 진료 화면 이벤트 | 응답 캐시 `ai:skill:<skill>:<inputHash>`(TTL 짧게·같은 입력 재호출 방지) | 입력 해시가 다르면 새 호출 |
| **하이브리드** | 검사해석 = 배치 B 사전해석 + **새 결과 도착 시 증분** · 약물추천 = 배치 A DUR 매트릭스 + 실시간 진단 반영 · 감별진단 = 배치 A 컨텍스트 주입(재조회 없음) + 실시간 S/O | — | — | — |

규칙
- 화면은 **배치 기준 시각**을 값과 함께 낸다("브리핑 08-19 02:10 기준 · 그 뒤 검사 2건 확정 — 갱신 중")(§3.3 최신성). stale 인데 갱신 실패면 그렇게 말한다.
- 배치는 **LLM 부하 예산** 안에서만(동시 2·환자당 60초·야간 창) — 예산 초과분은 "미계산(예산)"으로 남기고 실시간으로 넘긴다. 조용히 건너뛰지 않는다(계측에 남긴다).
- 배치 B 는 실시간과 **같은 검증층·같은 출력 계약**을 통과한다 — 층이 둘이어도 정본은 하나.
- 배치 결과의 프로비넌스: 화면 적용 시 `draft-applied` 에 `source:'GENERATOR'`·`skill`·`computedAt` 동봉(배치인지 실시간인지가 남는다).
- 대상 선정은 예약·재원 정본에서(시드 병원 874명 전 환자 야간 배치 금지 — 예산·PHI 최소 전송).
- config: `ai.brief.batch.enabled`(기본 OFF · H 등재)·`ai.brief.llm.enabled`(기본 OFF)·`ai.brief.concurrency`·`ai.brief.patientBudgetSec`.

### 4.6 계측(§9 UX 계측과 합친다)

관제(`/admin/ai-settings` 피드백 대시보드 확장): 스킬별 호출 N · `AI/FALLBACK/UNAVAILABLE` 비율(분모 N) · 지연 p50/p95 · 폐기 사유별 · 제안→적용률 · 무수정 승인율 · 👍👎. 전부 `<Ratio>`(분모 0=산출 불가). 이 표의 첫 행이 오늘 실측(§1)이다 — 개선은 이 표로만 말한다.

## 5. 단계

| 단계 | 내용 | 규모 | 게이트 |
|---|---|---|---|
| **P0 정직화·수리(CLI)** | **✅ 1차 적용 2026-08-19 저녁(아래 §1.2 재실측)** — ① EP 12개 출력 계약 통일(`source` 3상태·`latencyMs`·빈 결과=FALLBACK+사유) ② 검증층 `ai-verify.ts` 규칙 1~4·7 + 테스트 ③ FE: `catch {}` 침묵 제거·타임아웃/진행 표시·`AiSuggestionPanel` 로 통일·"사용 불가(오류)" 표시 ④ 추론 500 수리 · 기록품질 encounterId 없이도 폼 값으로 ⑤ 한국어 강제(system prompt+검증) ⑥ 관제 계측 표(스킬별 N·3상태·지연·폐기 사유) ⑦ 실측 프로브 스크립트 등재 ⑧ **하이브리드 P0 = 배치 A(결정론 브리핑·Redis·이벤트 무효화·야간 대상 선정·lazy) + 패널 "브리핑" 섹션(기준 시각 표기)** | 중 | 없음 |
| **P1 에이전트 루프** | **✅ 1차 적용(2026-08-19 16:4x · 병렬 2기·코디네이터 통합·아래 §1.3 재실측)** — BE: 컨텍스트 빌더 = 배치 A 브리핑 주입 · 실시간 응답 캐시(입력 해시·AI 만·10분) · 약물추천 `durVerdict` = DurService 정본 재검증(약가마스터 매칭→PASS/WARNING/BLOCK/UNRESOLVED) · 배치 B(야간·`ai.brief.llm.enabled` 기본 OFF·환자당 예산) / FE: 관계 모드 배지 10탭 · 감시 제안(접힌 헤더·결정론만·LLM 자동호출 없음) · 사전 해석 표시(기준 시각) · DUR 배지 정본화·BLOCK/UNRESOLVED 처방 추가 비활성 · 서명 전 기록품질 체크리스트(비차단) | 중 | 약물추천 DUR 게이트 모드(약제위) · 배치 B ON(운영·PHI 최소 전송 확인) |
| **P2 실행 연결·계측** | **✅ 완료(2026-08-19 적용 · 2026-08-25 코디네이터 재실측으로 확인)** — 표기가 🟡 였으나 항목이 전부 랜딩돼 있었다(프리필 P16 봉합·draft-outcome/metrics EP·성분 단위 DUR resolution·환자설명 발행 부재 표기). 🔴 그 재실측이 §1.1-b 결함을 찾아냈다 — 🔴 **오더/처방 프리필 P16 봉합**(실측: 패널이 `처방 추가` 성공 토스트를 띄우는데 page.tsx 는 `처방 탭에서 검색하세요` 안내만 — **아무것도 추가되지 않는다**. VoiceHub 프리필 선례로 탭 전환+검색 프리필·문구 정직화) · 무수정 승인율 `POST /api/v1/ai/draft-outcome`(**스키마 없이 감사 원장** — 본문 미저장·수치만 · `GET /api/v1/ai/draft-metrics` 분모=outcomes) · 성분 단위 DUR 판정(`resolution: EXACT/INGREDIENT_GROUP/AMBIGUOUS/NONE` — 운영 UNRESOLVED 편중 완화) · 환자설명 **발행 경로 부재를 화면이 말한다**(가짜 '발행' 버튼 금지·복사만) · ~~서명 전 기록품질~~ P1 완료 | 중 | 환자설명 **검수 큐**는 스키마·사람 게이트(§6-6) |
| P3 자율성 상향 | 감시→실행제안 확대 · L2 후보 선정 | — | 🔴 자동실행 범위 결정 · 폐쇄망/위탁 · S4 규제 포지션 |

## 6. 사람·외부 게이트

1. 🔴 모델 품질 기준(한국어·정확도) — 검증층 폐기율이 X% 넘는 스킬은 **탭에서 내린다** 는 임계(AI팀·진료부). **2026-08-20: 회신을 기다리지 않고 운영 다이얼로그로 내렸다**(`/admin/ai-settings` 모델 품질 임계 · config 맵 `ai.skill.quality.{minAiRate,minCalls,action}` · **기본 미설정·OFF** — 값은 위원회가 실측을 보고 넣는다. 임계를 개발자가 감으로 박으면 거짓 경보가 된다). 남은 사람 몫 = **값 자체**
2. 금칙 조언 사전·성별/연령 부적합 사전 — 누가 관리하는가(진료부·약제)
3. 약물추천의 DUR 게이트 모드(WARN/BLOCK) — 약제위(기존 항목)
4. 자율성 등급표·자동실행 범위 — 진료부·환자안전위(기존 §L 대기)
5. 폐쇄망 vs 위탁(PHI 외부 전송) — 기존 미결(2026-07-15부터)
6. **환자설명 검수 큐**(포털 발행 전 검수) — `DrugExplainCache`(approvedBy/approvedAt) 선례는 있으나 환자설명을 담을 모델이 없다. 스키마 승인 전까지 **발행 버튼을 만들지 않는다**(화면이 부재를 밝히고 복사만 제공)

## 7. 검증 규칙(이 문서가 스스로 지킬 것)

- §1 표는 `probe-chart-ai.py` 로 **재현 가능**해야 한다 — 개선 후 같은 스크립트로 다시 재고 표를 갱신한다(날짜·시각).
- 가드(재주입 실패 확인): 빈 배열이 `source:'AI'` 로 나가면 실패 · 영어 SOAP 이 통과하면 실패 · 방향 반전 해석이 통과하면 실패 · FE 가 `catch {}` 로 실패를 삼키면 실패(clinical-ux 가드 확장).
- 실측 없이 "개선됐다"고 적지 않는다.
