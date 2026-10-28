# 문서 지도 (Document Map)

> 작성 2026-08-25 · 기준 커밋 `d3bafc0a` (main)
> 범위 = `docs/` 전체 구조 안내 + **2026-08-14 이후 축이 만들었거나 크게 바꾼 문서 전량**

> 🔴 **2026-10-15 덧붙임** — 아래 §1~§5 는 **2026-08-25 스냅샷**이다(문서 개수·"최신 릴리즈" 표기 포함). 그 뒤의 변경은 여기서 다시 세지 않았다.
> 최근 결함 발굴 두 캠페인의 보고서는 `04-report/defect-hunt-2026-10-12/`(서명·문서 · v4.80~v4.87) ·
> `04-report/defect-hunt-2026-10-14-billing/`(수납·청구 · v4.88~v4.92 · 처리 현황 표가 정본).
> 2026-10-15 실측: `04-report` 파일 319 · `RELEASE-v*.md` 181(스냅샷 당시 192·94).

## 0. 이 문서는 무엇인가 — 그리고 무엇이 아닌가

| 이 문서가 하는 일 | 이 문서가 하지 않는 일 |
|---|---|
| `docs/` 의 다섯 계층이 각각 **무엇을 담는 자리**인지 말한다 | 각 문서의 내용을 요약해 **대신 읽어주지 않는다**(요약은 한 줄뿐이다) |
| 최근 축이 손댄 문서를 **경로·정본 성격·상태**로 한 표에 모은다 | 상태를 **추정하지 않는다** — 문서 안 표기나 커밋 로그에서 확인한 것만 적는다 |
| v4.6.0 이후 **릴리즈 문서가 없는 축**을 목록으로 남긴다 | 릴리즈 문서를 대신 만들지 않는다 |

🔴 **수치의 정본은 여기가 아니다.** 시스템 규모(모델·EP·화면·테스트 수)는 `CLAUDE.md`
System Scale 표가 정본이고, 그 표는 `node scripts/system-scale.mjs` 로만 재현한다.
이 문서에 적힌 **문서 개수**는 `docs/` 파일시스템 실측(2026-08-25)이다.

🔴 **기획서 상태 표기가 문서 머리와 본문에서 갈린 것이 둘 있다**(§2 각주). 갱신하는 사람이
머리말을 안 고치기 때문에 생긴다 — **머리말을 믿기 전에 본문 진행 표를 본다.**

---

## 1. docs/ 디렉터리 구조 — 각 계층의 성격

PDCA(Plan → Design → Analysis → Report) + Reference 5계층이다. 파일 수는 2026-08-25 실측.

| 계층 | 파일 수(.md) | 성격 — 무엇이 여기 오는가 | 대표 정본 |
|---|---:|---|---|
| **01-plan** | 252 | **앞으로 할 일과 그 판단 근거.** 착수 전 실측·원칙·단계·사람 게이트를 적는다. 종결돼도 지우지 않고 상태를 갱신한다 | `features/clinical-ux-agent-era.plan.md`(임상 UX 규약) · `features/screen-walkthrough-audit.plan.md`(화면 점검 패턴 P1~P17) · `features/seed-flow-audit.plan.md`(시드 흐름 검사법 A~I) |
| ├ `features/` | 218 (+ .yaml 4) | 기능·축 단위 기획서(`*.plan.md`). LoopSpec 파일럿 산출물 4건은 `.yaml` | — |
| ├ `integrations/` | 22 | **외부 팀과의 왕복 문서**(요청서·회신서). 받은 주장을 실측으로 다시 확인한 뒤 답한 기록 | `ios-native-app-server-response.md` |
| └ `references/` | 2 | 기획이 인용하는 계약 메모 | `ai-processor-phi-nonstorage.md` |
| **02-design** | 34 | **어떻게 만들 것인가.** 스키마·상태기계·파이프라인 설계 | `clinical-chart-engine.design.md` · `voice-emr-pipeline-design.md` |
| **03-analysis** | 48 | **지금 무엇이 어떻게 돼 있는가 — 실측 감사 보고서.** 2026-07 전수검토 캠페인 21축이 여기 있다 | `ux-consistency-review-2026-07.md`(표현 부품 정본) · `audit-coverage-audit-2026-07.md` · `idor-authorization-audit-2026-07.md` |
| **04-report** | 192 | **일어난 일의 기록.** `RELEASE-v*.md` 94건이 릴리즈 정본, `features/` 81건은 축별 완료 보고 | `RELEASE-v4.6.0.md`(최신 릴리즈 정본) · `changelog.md`(포인터) |
| **05-reference** | 140 | **계약·규약·명세·운영 절차.** 바뀌면 코드가 따라야 하는 것들 + 외부 연동 왕복(relay-*·his-*) | `ARCHITECTURE-INVARIANTS.md` · `system-scale-counting-rules.md` · `screen-code-assignment.md` · `human-decision-briefing.md` · `kpi-dictionary.md` · `module-tier-manifest.md` |

### 그 밖에 docs/ 최상위에 있는 것

| 경로 | 성격 |
|---|---|
| `INDEX.md` | 초기~중기 기획서 112건의 상태 스냅샷. **최신 축은 반영돼 있지 않다** — 최근 문서는 이 지도(§2)를 본다 |
| 🔴 `AI-AND-HIS.md` | **AI 도입과 HIS 정본**(2026-09-09 신설 · README 상단) — AI 의 판단을 사람이 소유했음을 증명하는 세 기제(정본/제안 분리·출처 추적·수용 이력 감사) · 질의서 대비 평가(필수 53: A9·B16·C15·D12) · 공백 기획서 `01-plan/features/ai-judgment-governance.plan.md` · 질의서 원문 `05-reference/ai-adoption-his-questionnaire.md` |
| `DEPLOYMENT.md` · `OPERATIONS.md` · `DEMO-SCENARIO.md` | 배포 가이드 · 운영 매뉴얼 · 시연 시나리오 |
| `architecture-hub.html` · `operations-manual.html` · `integration-spec.html` · `portal-lifecycle-guide.html` · `homepage-preview.html` | 사람이 읽는 HTML 허브(문서 허브) |
| `handoff/` (13) | 외부 팀 인계물 |
| `06-report/` (3) · `_archive/` (16) · `archive/2026-06/` | 구버전·흡수된 문서. **현행 판단의 근거로 쓰지 않는다** |
| `.pdca-status.json` | PDCA 상태 데이터. 🔴 현재 파일 안에 **미해소 병합 충돌 표식**(`<<<<<<< Updated upstream`)이 남아 있다 — 이 파일을 읽는 도구가 있다면 깨진다 |

---

## 2. 최근 축이 만들었거나 크게 바꾼 문서 (2026-08-14 ~ 08-25)

`git log --since=2026-08-14 -- docs/` 실측. **상태는 문서 안 표기·커밋 로그에서 확인한 것만** 적었다.

### 2.1 지금 살아 있는 축 — 최근 갱신순

| 경로 | 무엇의 정본인가 | 상태 | 축 / 최종 커밋 |
|---|---|---|---|
| `01-plan/features/input-assist-ux.plan.md` | **입력 보조 UX** — 채워도 되는 값의 3분류(①임상 판단=금지 ②시스템이 아는 값=프리필 정직 ③자주 쓰는 표현=프리셋)와 그 처방 | 본문 §4 기준 **P0~P3 전부 ✅ 완료**(2026-08-24) · 🔴 문서 머리말은 아직 "P0~P3 미착수"로 남아 있다 · §6 사람 게이트 잔여 | 입력 보조 UX · `f1fd04f1`(2026-08-25) |
| `01-plan/features/seed-flow-audit.plan.md` | **시드 흐름 전수 검토** — 검사법 A~I 고정 + 흐름 10개 진행 기록(부록 A~J) + §6 잔여 작업 대장 | **10단계 전부 ✅ 완료** · §6.1 코드·§6.2 스키마 **회수 완료(2026-08-25)** · 남은 것 = §6.3 사람 판단 2 · §6.4 감시 중 6 · §6.5 범위 밖 1 · 🔴 머리말은 "초안·미착수" | 시드 흐름 · `7aa2fbd8`(2026-08-25) |
| `01-plan/integrations/ios-native-app-server-response.md` | **iOS 네이티브 앱 요청서 회신 정본** — 요청서의 모든 사실 주장을 코드·운영 DB 에서 재확인한 결과. 봉합/미구현/보류(외부·사람)를 섞지 않고 나눔 | 회신 완료(2026-08-24) · **P0 7건 봉합 + 배포** · CONTRACT-01 계약 스냅샷 1차 제공(2026-08-25) · 미구현·사람 결정 항목은 문서 안에 분리 등재 | iOS 앱 대응 · `d3bafc0a`(2026-08-25) |
| `05-reference/openapi-mobile.json` | **앱 축 OpenAPI 계약 스냅샷** — 네이티브 앱이 의존하는 EP 의 응답 스키마 | 1차 제공(2026-08-25) · 위 회신 문서 CONTRACT-01 이 참조 | iOS 앱 대응 · `784bdc83`(2026-08-25) |
| `01-plan/features/chart-ai-assistant-agent.plan.md` | **차트 옆 임상 에이전트** — AI 진료 보조 패널(탭 10·EP 12)을 하나의 에이전트로 묶는 실행 설계 | P0 ✅ · P1 ✅ · **P2 🟡 진행 중** · P3 = 사람 게이트(자동실행 범위·폐쇄망 택일) 대기 | AgentEMR/차트 AI · `11956308`(2026-08-20) |
| `01-plan/features/outbound-channel-console.plan.md` | **대외 발신 정책** — 나가는 것의 3조건(구현 + 설정 기본 OFF + 승인)과 관제 `/admin/outbound-channels` | **P0 착수(관제 신설)** · 기관 채널 7종 미구현은 개시 전 대상으로 등재 | 대외 발신 · `d89d00eb`(2026-08-20) |
| `01-plan/features/alert-registry.plan.md` | **경보 등록부·예산·역할 라우팅**(AgentEMR 2-5~2-7) — "경보를 더 단다"가 아니라 **셀 수 있게 만든다** | **P0 1차 적용**(2026-08-19) · P1 이후는 사람 게이트 3건 선행 | AgentEMR 2단계 · `f7de734c`(2026-08-20) |
| `01-plan/features/loop-platform-adoption.plan.md` | **LoopSpec 도입 검토** — 외부 설계서를 이 저장소 실측으로 판정 | L0 역기술 ✅ · L1 표현력 판정 ✅ · **도입 미착수** · 판정 = 보완 후 채택 가능(범위 = AI 루프 한정) | LoopSpec · `2d708515`(2026-08-20) |
| `01-plan/features/loopspec-pilot-*.yaml` (4) | LoopSpec L0/L1 파일럿 산출물 — 검사해석·환자브리핑·약물추천·활력수집 | 파일럿 산출물(재현 실행 기록은 위 기획서 §4) | LoopSpec · `eb158a8d`·`3e7c645f`(2026-08-20) |
| `01-plan/features/ai-phi-audit-coverage.plan.md` | **AI 열람 감사 커버리지** — 환자 지목 AI 조회가 원장에 남지 않던 갭 | **배포 완료 · 운영 실증**(`95c54bd2`) · 🔴 초판의 "PHI 외부 전송" 표현은 문서가 스스로 철회(AI 서버 = 원내 WeRU.B) | AI 감사 · `5ed94c67`(2026-08-20) |
| `01-plan/features/clinical-ux-agent-era.plan.md` | **임상 UX 규약**(구현 기록이 아니라 다음 화면의 기준) — 미측정 폴백 금지·`queryFn` catch 금지·초기값 미선택·가짜 게이트 금지·에이전트 관계 모드 | 규약 문서(상시 유효) · 6축 병렬 검토 반영본 | 전 UI 병렬 검토 · `4b294b2d`(2026-08-20) |
| `01-plan/features/vitals-device-integration.plan.md` | **생체정보 수집 포트 통일** — "받을 자리가 다섯 군데라 없다"를 하나로 | 수집 포트·화면 판정까지 반영(`05807a4e`) · 기기 연동 자체는 미착수 항목 포함 | 활력 수집 · `05807a4e`(2026-08-20) |
| `01-plan/features/tier-split-appliance.plan.md` | **배치 중립 구조(안 C)** — PHI 접촉은 로컬, 조율은 어디든 | Plan v1.0 · 🔴 **사람 결정 #2(GPU 원내 vs 위탁)가 2026-07-15부터 미결**이고 그것이 AgentEMR 최상위 분기를 막는다 | Tier 분리 · `8f51eedd`(2026-08-20) |
| `01-plan/features/agent-emr-alignment.plan.md` | **AgentEMR 설계서 반영 계획** — 🔴 신규 구축이 아니라 **"만들었는데 작동한 적 없는 것"의 회수 계획** | 1단계 13/13 회수 완주(메모리 기록) · 2단계는 폐쇄망 택일 선행 | AgentEMR · `b3e035cc`(2026-08-19) |

### 2.2 규약·명세로 굳은 것 (05-reference)

| 경로 | 무엇의 정본인가 | 상태 | 축 / 최종 커밋 |
|---|---|---|---|
| `05-reference/human-decision-briefing.md` | **사람 결정·개시 설명자료 명세** — `/admin/decisions`·`/admin/go-live`·`/admin/governance` 가 개발자 아닌 사람에게 무엇을 어떻게 말해야 하는가(`statusQuo`·`afterDecision`·`verifyHow`·`goLive`) | 명세 확정 · 코드 정본 `decision.registry.ts` · 가드 `decision-briefing.spec.ts` | 사람 결정 · `a99ff333`(2026-08-21) |
| `05-reference/screen-code-assignment.md` | **화면번호 부여 규칙** — 번호를 치면 열리고, 그 화면은 정상 경로로도 도달한다 | 실측 동결 **정의 288(NAV 258 + OFF_NAV 30) · 중복 0 · 고아 0 · 라우트 부재 0** · CI 게이트 `npm run check:screen-codes` | 화면번호 · `79559fae`(2026-08-21) |
| `05-reference/operating-modes.md` | **운영 모드 개발/리허설/리얼** — 🔴 빌드가 상한·런타임은 좁히기만. 시드 로그인·대외 발신·배너·시드 배지를 지배 | 유효 · 정본 코드 `packages/shared/src/his-mode.ts` · 가드 `no-test-accounts-in-prod.spec.ts` 11항목 | 운영 모드 · `a5c67fdd`(2026-08-25) |
| `05-reference/real-mode-cutover.md` | **리얼 전환 절차** — 토글로는 끝나지 않는다(재배포다) · 전환 전/후 검증 체크리스트 · 모드가 해결하지 않는 것 | 유효 · 판정은 `/admin/go-live` `security.hisMode` | 운영 모드 · v4.8.0(2026-08-25) |
| `05-reference/system-scale-counting-rules.md` | **System Scale 계수 규칙** — 🔴 정본은 이 문서가 아니라 `scripts/system-scale.mjs` | 유효(이 문서와 코드가 어긋나면 코드가 맞다) | 계측 정본화 · `33976a1b`(2026-08-18) |
| `05-reference/data-freshness-check.md` | **시점 정합(freshness) 판정 사용법** — 정본은 `scripts/data-freshness.mjs` | 유효 · 임계값은 그 축의 과거 실측 p95 로 자기교정 | 시드 정합화 · `85c74d13`(2026-08-18) |
| `05-reference/deploy-runbook-deferred-t1-20260818.md` | **이연 회수 T1 스키마 배포 런북** — SQL 만 넣고 `--api` 하면 배포가 중단된다 | 점검 산출물 · 실제 적용은 사람 판단(문서 §7 에 미확인 항목 명시) | 이연 회수 · `c76e797f`(2026-08-18) |
| `05-reference/f7-pharmacy-review-20260707.md` | 처방약 AI 쉬운 설명 — **약제부 검수 자료**(config `portal.aiDrugExplain` 기본 OFF · 검수·법무 통과 전 활성화 금지) | 검수 대기(사람·외부) | AI 표기 병기 반영 · `d263403b`(2026-08-19) |
| `05-reference/manual/w8-access-dept-rollback.sql` | W8 부서 접근제어 시드 잔재 롤백 SQL | 적용 산출물 | 화면 점검 W8 · `97879f5d`(2026-08-14) |

### 2.3 앞선 축이 남긴 기획서(같은 기간에 정정·후속 표기가 붙은 것)

| 경로 | 무엇의 정본인가 | 상태 |
|---|---|---|
| `01-plan/features/screen-walkthrough-audit.plan.md` | **화면 실사용 전수 점검** — 패턴 P1~P17 의 정본 | W0~W9 완주(254화면·실결함 950+) |
| `01-plan/features/patient-safety-enhancement.plan.md` | 환자안전(IPSG) 고도화 v2.0 | 🔴 문서 머리에 **후속·정정판 표기**가 붙어 있다(`agent-emr-alignment.plan.md` 가 방향을 재조정) |
| `01-plan/features/medication-bilingual-naming.plan.md` | 약물 한/영 병용 정본화 | ⚠️ **부분 종결** — 소비처 하나(DUR 판정 술어)가 범위 밖이었음을 문서가 스스로 기록 · 잔여 = 약제팀 재확인(사람) |

### 2.4 릴리즈 문서 (04-report)

| 경로 | 다루는 축 | 배포 |
|---|---|---|
| `04-report/RELEASE-v4.6.0.md` | **최신 릴리즈 정본** — §0~§16. 대외 발신·사람 결정 화면 · 부분 실패 정직성 16 · 화면번호 · 퇴원 미납 게이트 · CMS · 급양 3축 · **시드 흐름 1~4단계까지** | 배포 완료 |
| `04-report/RELEASE-v4.5.0.md` | BE 는 있는데 화면이 안 부르던 안전장치(인증 Ver.5.0 대응) | 배포 완료 |
| `04-report/RELEASE-v4.4.0.md` | 켜져 있는데 통과시키던 게이트(DUR 43룰 매칭 0) | 배포 완료 |
| `04-report/RELEASE-v4.3.0.md` | 검증이 실행되지 않던 곳(ValidationPipe 스킵) | 배포 완료 |
| `04-report/RELEASE-v4.2.0.md` · `v4.1.0.md` | 이연 회수 1·2라운드 | 배포 완료 |
| `04-report/RELEASE-v4.0.0.md` | 화면 실사용 전수 점검 완주 + **운영 DB = 가상 병원 시드 전제 명세화** | 배포 완료 |
| `04-report/RELEASE-v3.99.0.md` | 화면 점검 W4~W6 | 배포 완료 |

---

### 2.5 설치·운영·설정 매뉴얼 (2026-08-25 신설)

| 문서 | 무엇의 정본인가 | 상태 |
|---|---|---|
| `05-reference/installation-guide.md` | 로컬 개발 환경 구축·빌드 순서·포트·자주 나는 문제 10종 | 종결 |
| `05-reference/production-operations.md` | 배포 절차(deploy.sh 플래그별 rsync/재시작 정확표)·롤백·백업·모니터링·금지사항 | 종결 · 🔴 **운영 위험 실측 포함** |
| `05-reference/configuration-manual.md` | 설정 4층(환경변수·외부 자격증명·SystemConfig·안전 게이트) | 종결 |
| `05-reference/backup-and-key-rotation.md` | **백업 크론 등록 절차 · 암호화 키 로테이션 절차**(되돌릴 수 있는 것과 없는 것을 가른다) | 백업 ✅ **복구 완료**(2026-08-25 · `/admin/go-live` 가 매일 실측) · 키 로테이션 🔴 **방안 결정 대기** |

기존 `docs/DEPLOYMENT.md`·`docs/OPERATIONS.md` 는 **보존하되 머리에 포인터**를 달았다 —
내용이 겹치는 부분의 정본은 위 3편이다(구 문서에는 지금 실패하는 명령이 남아 있다).

🔴 **이 3편은 문서화 과정에서 운영 위험을 실측으로 찾아냈다**(§3 참조) — 문서 작업이
감사 역할을 겸한 사례다.

## 3. ✅ v4.6.0 이후 축 — `RELEASE-v4.7.0.md` 로 정리됨 (2026-08-25)

아래 목록은 **`docs/04-report/RELEASE-v4.7.0.md` 가 그대로 목차로 삼아** 작성됐다.
v4.6.0 은 시드 흐름 4단계까지, **v4.7.0 이 5~10단계·§6 회수·입력 보조 축·iOS 대응·문서 축·
NODE_ENV 함정 7건·운영 사고(§7)를 담는다.** 이 표는 그 대응 관계를 남기기 위해 보존한다.

| 축 | 기간 | 근거 커밋 | 기획서 안 기록 위치 |
|---|---|---|---|
| **시드 흐름 5~10단계** (응급·영상·청구수납·검진·간호·안전감염) | 08-21 ~ 08-24 | `a9f681b1` `0a0537e7` `9fe4e977` `823c9b41` `d31f93cd` `d7776aea` `e8623ad0` `933e5c62` `f727a247` | `seed-flow-audit.plan.md` 부록 E~J |
| **시드 흐름 §6 잔여 대장 회수** (처분이 원장 없이 바뀌던 두 경로 외 9건) | 08-25 | `45ed3354` `7aa2fbd8` | 같은 문서 §6.1·§6.2 |
| **iOS 네이티브 앱 서버 대응** (P0 4종 봉합 · redirect 가드 · 네이티브 계약 구현) | 08-24 | `644e5924` `b99cb92d` `0596ef7e` `5f1d5c21` | `ios-native-app-server-response.md` |
| **입력 보조 UX P0~P3** (임상 placeholder 제거 · 부서 콤보 정본 · 사유 프리셋 · 예제 정직화) | 08-24 | `52dca28b` `8f2a59bb` `434bb684` | `input-assist-ux.plan.md` §4 |
| **이비인후과 청력 입력** (측정 안 하면 정상 청력이 저장되던 것 + 입력값 소실) | 08-25 | `f1fd04f1` | `input-assist-ux.plan.md` |
| **앱 축 계약 스냅샷·동의서 정본 통합** (법정 동의서 전문이 포털 화면 코드에 있던 것 · Swagger 응답 스키마 보강) | 08-25 | `cc2e70c8` `784bdc83` `d3bafc0a` | `ios-native-app-server-response.md` CONTRACT-01 · `05-reference/openapi-mobile.json` |


## 3-e. 📋 검토(일부 착수) — 표준 용어 매핑 전체 처리 + 코드 마스터 강화 (2026-08-26)

`01-plan/features/terminology-mapping-coverage.plan.md` — 🔴 **분모를 등재 코드 전체(209,000)로 잡으면
끝나지 않는다**(매핑 139건 = 0.07%). 실제 사용 코드는 진단 37·약품 39·처방집 132 →
**P0(쓰이는 코드) 기준으로 분모를 바꾼다.** 🔴 대조할 표준 코드 사전이 없어 AI 제안은 전부 사람 승인 —
**사전 도입(라이선스)이 이 축 전체를 좌우한다.** §8 = 코드 마스터 강화 9종(F1 고시 개정 일괄 반영 ·
F2 변경 영향 분석 우선). ✅ 상태 5분류·집계 분리·화면의 거짓 약속 제거는 완료.

## 3-d. 📋 검토(일부 착수) — 워크스테이션(자리) × 단말 보안 (2026-08-26)

`01-plan/features/workstation-terminal-binding.plan.md` — 🔴 **자리↔단말 바인딩 0/27**(자동 해석이
개통 이래 성립 불가) · 인쇄가 브라우저 주장(`code`)을 서버가 검증 없이 수용 ·
격리 단말이 자리 기능을 계속 사용. ✅ **전 직군 403 봉합**(14역할 중 9역할이 상시 403)은 완료.
착수 전 사람 결정 4건.

## 3-c. 📋 기획(미착수) — 의료진 작성 문서·기록의 초안 (2026-08-26)

`01-plan/features/clinical-draft-authoring.plan.md` — 병렬 에이전트 5기 실측 + 코디네이터 재실측.
**초안 동작 8 · 저장소는 있는데 화면이 안 부름 7 · 없음 20+** · 개인화 층(`TextMacro`·`UserChartPreference`)은
모델·EP 만 있고 소비처 0 · 실결함 6건(사망진단서 입력 소실 등)을 함께 등재.
착수 전 **사람 결정 9건** 필요.

## 3-b. ✅ v4.8.0 — 운영 모드 축 (2026-08-25)

| 축 | 기간 | 근거 커밋 | 정본 문서 |
|---|---|---|---|
| **운영 모드(개발/리허설/리얼)** — 시드 로그인이 어디에도 없던 것 + 포털·예약이 운영에 노출되던 것 | 08-25 | `a5c67fdd` `f8c32233` `a007ec98` | `05-reference/operating-modes.md` · `05-reference/real-mode-cutover.md` |
| **키 재암호화 스크립트** — 절차 문서가 "없다"로 남겨둔 자리 · 키 파생 두 갈래 발견 | 08-25 | `945cce68` | `05-reference/backup-and-key-rotation.md` §2 |

릴리즈 문서: `docs/04-report/RELEASE-v4.8.0.md`

🔴 위 축들은 **개별 기획서 안에는 실측·결과가 기록돼 있다.** 없는 것은 "여러 축을 한 번에
읽을 수 있는 릴리즈 문서"뿐이다 — 릴리즈 문서를 만들 때 이 표가 목차가 된다.

---

## 4. 정합 점검 결과 (2026-08-25)

`docs/**/*.md` + `README.md` + `CLAUDE.md` 의 상대 링크 전수 대조.

### 고친 것 (8건)

| 파일 | 링크 | 원인 |
|---|---|---|
| `01-plan/features/patient-waiting-display.plan.md` | `../WAITING-DISPLAY-API-SPEC.md` → `../../05-reference/…` | 상위 단계 수 부족 |
| `01-plan/features/regimen-cpoe-bridge.plan.md` | `../02-design/…` → `../../02-design/…` | 같음 |
| `02-design/features/mobile-journey-app.design.md` | `../01-plan/…` → `../../01-plan/…` | 같음 |
| `04-report/hospital-run-phase2.report.md` (2건) | `../../01-plan/…`·`../../02-design/…` → `../…` | 상위 단계 수 과다 |
| `04-report/staff-onboarding-ess.report.md` (3건) | `../../{01-plan,02-design,03-analysis}/…` → `../…` | 같음 |
| `04-report/features/w3.1-erp-response.md` | `../../../../Hospital%20RUN/docs/…` → 같은 폴더 상대경로 | 절대경로가 문서에 박혀 있었다 |
| `05-reference/terminal-zero-trust-production-ops.md` | `05-reference/…` → 같은 폴더 상대경로 | 루트 기준 경로를 상대경로 자리에 씀 |

### 남긴 것 (11건 — 고치지 않은 이유를 적는다)

| 대상 | 왜 남겼나 |
|---|---|
| `CLAUDE.md` → `/admin/go-live` · `ai-booking-portal-integration.plan.md` → `/portal` | **파일 링크가 아니라 화면 경로**다. 깨진 링크가 아니다 |
| `tablet-chart-view.plan.md` → `autosave` · `terminal-zero-trust.design.md` → `§6.8-3` | 문서 내 지시어(앵커 아님). 링크 문법을 강조에 쓴 자리 |
| `hospital-run-phase2.report.md` → `03-analysis/features/hospital-run-phase2-gap.md` | **대상 파일이 저장소에 없다.** 어디로 보내야 하는지 모른다 — 추측해서 다른 문서로 연결하지 않는다 |
| `session-20260528.report.md` 4건 | 메모리 토픽 파일(`triage_ai_api.md` 등)을 가리킨다. 저장소 밖 대상이고 2026-05 세션 기록이라 손대지 않는다 |
| `docs/archive/2026-06/**` 2건 | 아카이브. **현행 판단의 근거가 아니다** |

---

## 5. 이 지도를 갱신하는 규칙

1. **축이 끝나면 §2 에 한 줄** — 경로·그 문서가 무엇의 정본인가·상태.
2. **상태는 확인한 것만.** 문서 안 표기나 커밋에서 못 찾으면 "미확인"이라 적는다.
3. **릴리즈 문서를 쓰면 §3 에서 지운다.** §3 이 길어지는 것은 "릴리즈 문서가 밀렸다"는 신호다.
4. **수치는 여기서 세지 않는다** — 시스템 규모는 `CLAUDE.md` System Scale(계측기 `scripts/system-scale.mjs`),
   문서 개수는 `docs/` 실측. 두 곳에 적으면 갈라진다.
