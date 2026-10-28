# 거버넌스 안건 워크벤치 — 실 안건 시드 · 상세 확인 · 연계 표면 · AI 영향 평가

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/src/modules/gld/governance.controller.ts:21 · apps/api/src/modules/gld/gld.controller.ts:14 · 잔여: 없음

- **작성**: 2026-08-04 (v3.89.0 직후·라이브 실측 기반)
- **상태**: 기획 v1 — **P0(안건 시드)는 본 기획과 함께 즉시 실행**, P1~P2 미구현
- **선행 정본**: `committee-governance-engine.plan.md`(P0-a~P3 완주·D1~D15) — 본 기획은 그 위의 **운영 활성화 층**
- **화면**: https://his.example.org/admin/governance

---

## 0. 실측 (2026-08-04 라이브)

| 항목 | 실측 | 함의 |
|---|---|---|
| 안건 | **3건 — 전부 검증/시연용 RESOLVED**(GOV-2026-001~003 발번 실증분) | 대장·집행 엔진은 완주됐는데 **실 운영 안건 유입 0** |
| 운영 판단 대기 | 드리프트 31건·formulary 전 영역 OFF·미서명 차트 192건(unsignedStale)·중복 의심 86·언어 갭 7·집행 게이트 OFF·대기 임계 정책 미확정·좌우 키워드 '신' 오매칭 등 | 전부 **시스템 밖**(백로그 메모리·릴리즈 노트)에만 존재 — 위원회가 볼 수 없다 |
| 안건 상세 | FE 안건 탭 행 = 위원회·제목·출처 type·접수일·상태뿐. **클릭 상세 없음** — body(배경·근거)·제안자·배정 회의 비노출 | 상정 버튼이 담아 보낸 근거 스냅샷이 사장됨 |
| 연계 | sourceRef 는 type 텍스트만 표기 — **원 화면 역딥링크 없음**. provenance/⚖배지는 표면→결정 방향만 | 안건에서 근거 데이터로 못 돌아간다 |
| AI | 없음 | 의결 전 영향 파악(어떤 표면·화면·게이트에 닿는지)이 전부 사람 손 |

## 1. 문제

1. **유입 공백**: P3가 [위원회 상정] 버튼 4곳을 열었지만, 이미 쌓여 있던 운영 판단 대기 항목들은 버튼이 생기기 전의 것이라 대장 밖에 있다. 위원회 화면은 비어 보이고, 실제 결정 수요는 문서에 흩어져 있다.
2. **근거 휘발**: 안건 body 에 담긴 실측 근거(위반 통계·지표 값·실측일)가 화면에 안 보인다. 의결 시점에 근거를 다시 찾는 비용.
3. **영향 불투명**: "이 안건이 가결되면 시스템 어디가 바뀌나"(표면·바인딩·화면·게이트 모드)를 의결 전에 구조적으로 보여주는 층이 없다.

## 2. 결정표

| # | 결정 | 근거 |
|---|---|---|
| D1 | **시드 = 실 운영 판단의 안건화. 날조 금지** — 각 안건 body 는 라이브 실측 수치·실측일 인용. 가공 시나리오 없음 | 이들은 데모가 아니라 **진짜 대기 중인 결정**(백로그 §운영 판단 대기와 1:1). 데이터 정합성 스캔 원칙(추정 금지) 준용 |
| D2 | 시드 투입은 **정본 API 경유**(POST /governance/agendas·gld meetings·resolve) — DB 직삽 금지 | proposerId·정족수 검증·GOV 발번이 정본 경로를 타야 대장 무결 |
| D3 | 시드 멱등 = **제목 존재 검사**(동일 제목 있으면 skip) — 재실행 안전 | 안건은 운영 데이터라 upsert 부적절·중복 방지만 |
| D4 | 상세는 **드로어**(목록 맥락 유지·별도 페이지 아님) | 안건 검토는 목록 스캔 중 행위. governance 페이지 관례(모달 흐름) |
| D5 | AI 평가는 **Human-in-loop 브리핑** — 게이트 `governance.ai.enabled`(기본 OFF·DEFAULTS 등재 규약). 판단·권고를 대체하지 않음을 응답에 명시 | quality.ai(C1 브리핑) 선례. 위원회 재량 침범 금지 |
| D6 | AI 입력 컨텍스트는 **서버가 결정적으로 조립** — 표면 매핑(surface-map)·개방 바인딩 카탈로그·위반 통계/지표 현재값·드리프트. LLM 은 요약·영향 서술만 | 환각 최소화. 정책 메타데이터라 PHI 없음(환자 식별자 미포함 가드) |
| D7 | 평가 결과는 안건에 **스냅샷 저장**(`aiAssessment` Json + 시각·모델) — 재생성 시 교체, **의결(RESOLVED) 후 동결** | 의결 근거의 감사 가능성. 앰비언트 provenance 선례 |
| D8 | sourceRef 역딥링크는 type별 고정 매핑 — SAFETY_GATE→/admin/safety-gates·GO_LIVE→/admin/go-live·DATA_QUALITY→/admin/data-quality·FORMULARY_REQUEST→/admin/formulary | 스키마 주석의 4-type 규약 그대로. 신규 type 추가 시 매핑 등재 필수 |

## 3. P0 — 실 안건 시드 10건 (즉시 실행)

전 건이 실측 근거를 body 에 인용한다. 상태 분포: SUBMITTED 8 · SCHEDULED 1(IC 회의 배정) · RESOLVED 1(TRF — 시스템 무변경 MANUAL 확인 안건으로 의결까지 실증).

| 위원회 | 제목 | sourceRef | 근거 실측(2026-08-04) |
|---|---|---|---|
| DTC | DUR 처방 게이트(BLOCK) 운영 현황 정기 검토 | SAFETY_GATE `dur.enforce` | 30일 위반 0건·룰 정본 DurRule 55건(개정 표면 /api/v1/dur/rules) |
| DTC | 포뮬러리 영역별 시행 개시 판단 — 현재 전 영역 OFF | SAFETY_GATE `formulary.enforce` | 7영역 전부 OFF·go-live 목표 WARN·Map 부분 집행은 GOV-2026-003 검증 완료 |
| QPS | 미서명 차트 192건 소화·회수 알림 게이트 ON 판단 | DATA_QUALITY `encounter.unsignedStale` | 지표 192건·크론 구현 완료(기본 OFF·afterHours=0) |
| QPS | DEFAULTS 드리프트 소화 — 등재 vs 정리 | (직접) | 시드 당시 검출 31건 → **2026-08-05 재분류: 오탐 20(동적 키/키자재·헬스체크 수정)·등재 해소 3·실드리프트 8**(소비 0 구키·안건 body 갱신됨) |
| QPS | 외래 대기 표시 임계 확정 — 경고 20/위험 60 vs 종전 30분 | (직접) | v3.89 7화면 수렴·`clinical.queue.*` 즉시 반영 |
| OPS | 집행 게이트(governance.enactment.enabled) 상시 ON | (직접) | 기본 OFF·GOV-2026-002/003으로 경로 검증 완료 |
| SAFE | 좌우구분 키워드 '신' 단독 토큰 오매칭 교정 | (직접) | 33개 중 '신'이 신경/신생아 오매칭 소지·'신장' 별도 등재 — 개정 표면 `surgery.lateralityKeywords` |
| MRC | 외국인 동의서 언어 갭 7건 해소 — 언어판 정비 | DATA_QUALITY `foreign.consentLangGap` | 지표 7건·AI 번역 초안 배포됨(사람 검토 필수) |
| IC | 격리 프로토콜 6종 정기 재검토 (SCHEDULED) | (직접) | P0-a④ 테이블 정본·시드 6종 운영 중 |
| TRF | 교차시험 유효시간 72h 기준 재확인 (RESOLVED) | (직접) | v3.89 표면화 `bloodbank.crossmatchValidHours`=72 — 현행 유지 확인·재검토 1년·MANUAL(SOP 반영) |

## 4. P1 — 안건 상세 드로어 + 연계 표면

- **드로어**(안건 행 클릭): body 전문(근거 스냅샷) · 제안자·접수일 · **출처 딥링크**(D8 — sourceRef key 를 쿼리로 동봉해 해당 화면에서 하이라이트 가능하게) · 배정 회의(일시·참석) · 의결 결과(GOV 번호·표결·actions·집행 상태·signRef 🔏) · [회의·의결] 진입 버튼(기존 모달 재사용)
- **연계 표면 카드**: 담당 위원회의 surface-map 표면 목록 + 각 **현재값**(config 일괄 조회) — "이 위원회가 지금 쥐고 있는 레버"를 안건 맥락에서 표시. 표면 클릭 → provenance(⚖ 체인)
- BE 추가 없음(기존 EP 조합: agendas·surface-map·config·provenance) — FE 전용 작업

## 5. P2 — AI 영향 평가

- **EP**: `POST /governance/agendas/:id/assess` (ADMIN·게이트 `governance.ai.enabled` OFF 기본)
- **서버 조립 컨텍스트**(D6·결정적): ①안건 제목·body ②sourceRef 실데이터(SAFETY_GATE→해당 게이트 모드+위반 통계 / DATA_QUALITY→지표 현재값·임계 / FORMULARY_REQUEST→요청 내용) ③담당 위원회 surface-map 표면+현재값 ④개방 바인딩 kind 카탈로그(이 안건이 가결되면 쓸 수 있는 집행 수단) ⑤드리프트·게이트 수집 갭(관련 시)
- **출력 스키마**(WeRU.B 경유·JSON 강제): `{ scope: 영향 표면·화면·역할 요약, currentState: 현재값 서술, risks: 전환 시 위험(예: BLOCK 승격 시 차단 업무), checklist: 의결 전 확인 항목, bindingSuggestion: 가결 시 바인딩 예(JSON — 의결 모달에 복사 가능), disclaimer: 고정 문구 }`
- **저장**: `CommitteeAgenda.aiAssessment` Json(+ assessedAt·model) — 컬럼 1개 추가(스키마 변경·--schema 배포). 재생성=교체·RESOLVED 후 409
- **FE**: 드로어에 [AI 영향 평가] 버튼 → 카드 렌더(disclaimer 상시 노출·"판단은 위원회 몫")
- PHI 가드: 컨텍스트는 정책 메타데이터만 — 환자 식별자 포함 경로 없음(계약 테스트로 고정)

## 6. Phase

- **P0 시드 10건** — ✅본 기획과 함께 실행(§3·정본 API 경유·멱등)
- **P1 드로어+연계** — ✅**완료(2026-08-04)**: 안건 행 클릭 → 우측 드로어(body 전문·제안자 이름 조인(listAgendas userMap)·출처 딥링크 4-type 고정 매핑(D8)·배정 회의(참석·🔏)·의결 카드(GOV·표결·actions·signRef)·담당 위원회 표면 현재값(config 일괄 조회 매칭)·[회의·의결 진행]). BE 추가는 proposerName 조인뿐 — 나머지 기존 EP 조합
- **P2 AI 평가** — ✅**완료(2026-08-04)**: `CommitteeAgenda.aiAssessment/aiAssessedAt` 컬럼(+--schema 배포)·`POST /governance/agendas/:id/assess`(ADMIN)·`governance.ai.enabled` DEFAULTS 등재(기본 OFF)·컨텍스트 서버 조립(buildAssessContext — 표면+현재값·개방 바인딩·SAFETY_GATE 모드+30일 위반수·드리프트)·WeRU.B llmGenerate(formulary 선례·NDJSON 병합·JSON 추출 폴백)·disclaimer 고정 동봉·FE 드로어 카드(실행/재생성·RESOLVED 동결 표시)·계약 테스트 6건(게이트 거부·동결·파싱 폴백·컨텍스트 키 화이트리스트·PHI 금칙어 0·SAFETY_GATE 결정 데이터)
- **P3 제안 UX 개편(TipTap+사전 검토)** — ✅**완료(2026-08-05)**: ①상정 모달을 **TipTap 리치 에디터**로 개편 — 정본 `components/ui/rich-text-editor`(CMS 검증분·툴바/이미지 포함) 재사용·기존 plain defaultBody 는 단락 HTML 승격·저장은 전역 SanitizePipe 경유(script/on핸들러 제거)·드로어 렌더는 `sanitizeHtml`+prose(구 텍스트 폴백) ②**AI 사전 검토** `POST /governance/agendas/precheck`(전 직원·governance.ai.enabled 게이트·비차단) — 유사/중복 안건(⚠경고 카드·GOV 번호·supersede 안내)·상정 전 보완 질의 3~6·관련 기능/표면·집행 경로 노트. 🔴환각 차단=서버가 제목 토큰 겹침으로 후보를 결정적으로 선별해 컨텍스트 동봉, **LLM 지목 제목은 실제 안건 재매칭분만 반환** ③UX — 위원회 선택 시 담당 표면 chips 미리보기·안내 문구(근거 인용 권장)·유사 안건 확인 후 상정 버튼 라벨 전환·assess 컨텍스트도 HTML strip 대응. 계약 테스트 4건(게이트 거부·환각 제목 차단·HTML strip·파싱 폴백)

## 7. 검증 계획

- [x] P0: 시드 후 /admin/governance 안건 탭 실측 — 13건(기존 3+신규 10)·위원회 분포·SCHEDULED 회의 배정·TRF 의결 GOV 발번+MANUAL 액션 (2026-08-04 실행·GOV-2026-004)
- [x] P1: 드로어 배선·proposerName 라이브 확인('관리자')·sourceRef 4-type 딥링크 매핑(D8)
- [x] P2: **운영 종단 실증(2026-08-04)** — 게이트 OFF 거부 → ON → DUR 안건 실 LLM 평가 생성(scope·risks 2·checklist 3·bindingSuggestion CONFIG_CHANGE 예시·disclaimer) → RESOLVED(TRF) 동결 409 → 스냅샷 저장 확인 → 게이트 OFF 원복. PHI 미포함·컨텍스트 화이트리스트는 계약 테스트로 고정
