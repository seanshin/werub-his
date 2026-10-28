# 의료용어 한/영 표시 토글 + 어시스턴트·검색 통합

작성 2026-09-04 · 발단: 사람 요청 3건(캡처 3장) · 실측: 병렬 에이전트 3기 + 운영 DB 충전율 직접 실측

> 🔴 이 문서의 수치·파일 근거는 전부 2026-09-04 실측이다. 추측은 (추측)으로 표기했다.

## 0. 요청과 실측이 정정한 전제

| 사람 요청 | 실측이 확인/정정한 것 |
|---|---|
| ① 의료용어(영어)↔한글 토글이 **전체적으로** 필요 | 데이터가 이를 지지하는 도메인과 아닌 도메인이 갈린다(§1.1) — "전체"를 한 번에 켜면 없는 번역을 지어내게 된다 |
| ② 토글은 캡처의 "+" 버튼 자리(어두운 상단바)에 | 🔴 그 버튼은 상단바가 아니라 **사이드바 헤더(slate-900)의 AI 어시스턴트 토글**이다(`Sidebar.tsx:722` · aria-label "AI(WeRU.B) 어시스턴트 열기"). 토글의 관례상 자리는 **TopBar 우측 블록**(WorkstationBadge 옆 · `TopBar.tsx:214-232`) — 상시 접근이라는 취지는 동일하게 충족 |
| ③ 어시스턴트는 통합 검색창이 확장되는 것이 맞지 않나 | 현재 **검색↔어시스턴트 연결 0**. 게다가 검색이 두 벌(TopBar 인라인 + Cmd+K 모달) 병존. 요청 방향(옴니박스)이 정확히 현 구조의 공백을 짚었다(§2.4) |

## 1. 실측 요약

### 1.1 한/영 쌍 데이터가 실재하는 곳 (운영 DB 2026-09-04 직접 실측)

| 도메인 | 마스터 | 영문명 충전율 | 토글 판정 |
|---|---|---:|---|
| **진단 KCD-8** | `DiagnosisCode.nameKo/nameEn` | **18,199/18,199 = 100%** | ✅ 즉시 가능 — 최대 효과 지점. 🔴 그런데 진단 입력 화면(`DiagnosisInput.tsx`)은 타입에 `nameEn` 필드조차 없다(서버가 줘도 못 받음) |
| **검사 마스터** | `LabTestCode` | 35/35 = 100% (표본 작음) | ✅ 피커·오더 화면 가능 |
| **검사 결과** | `LabResultItem.testName` **단일 필드** | 3,093/3,188 = **97%가 영문 저장**(`WBC`·`aPTT`…) | ⚠️ 쌍이 없다 — 마스터/매핑 조인으로 한글을 **붙이는** 문제(P1). 환자 포털에도 영문 약어가 그대로 노출 중 |
| **약품** | `MedicationCode` | 상품명 `nameEn` **51/24,022(0.2%)** · `ingredient` 23,587(98.2%·대부분 영문) | ✅ 단, 영문 표시 = **성분(ingredient)** 기반. 상품명 로마자 자동변환 금지(기존 결정 유지 — `medication-bilingual-naming.plan.md`) |
| 진료과/수술·마취/간호 | `DepartmentCode` 36 · `SurgeryAnesthesiaCode` 21 · `NursingCode` 167 | 각 100% | ✅ 가능하나 현 소비처 거의 0 — 배선 과제 |
| 처치(오더) | `ProcedureCode` | **영문명 필드 자체가 없음** | ❌ 범위 외 — 데이터 확보가 선행(사람 결정). `OrderTrackingTab.tsx:49` 의 `nameEn` 타입 선언은 사문 |
| 알레르기 | `Allergy.allergen` 자유 텍스트 | 쌍 없음 | ❌ 범위 외 |
| IPSG.4·WHO·Sign-In 등 | 인증 표준 식별자 | — | ❌ **용어가 아니라 표준 ID** — 토글 대상에서 명시적으로 제외(캡처 ①의 "수술 안전 (IPSG.4)" 가 이 부류) |

### 1.2 표시 인프라 현황

- **용어 정본 부품이 약품 하나뿐**: `DrugName({nameKo,nameEn,code,bilingual})`(`display.tsx:498`) — 소비 4곳, `bilingual` 을 켠 곳은 **처방전 인쇄 1곳뿐**. `<Term>`/`<DiagnosisName>`/`<TestName>` 류는 없음 — 진단·검사·마취는 화면마다 인라인.
- **주입 패턴 정본은 `<Num>`**: 정본 컴포넌트가 훅(`useUiSettings`)으로 설정을 읽고 화면은 domain 만 준다 — 새 토글이 따라야 할 형태.
- 병기 선례: 처방 검색 드롭다운(`order-entry.tsx:211` — nameKo 위·nameEn 아래 회색), 외국인 영문 진단서(없으면 `(Korean name — no English name on file)` 정직 표기).
- 랩 결과 `testName` 을 원문(영문) 그대로 찍는 화면 20+ 파일(환자 포털 포함).

### 1.3 선호 저장 인프라

- **사용자 단위 표시 선호의 현행 정본 = localStorage**(수기 접근 관례 · `patient-tab-config`·`dashboard-config` 등). zustand persist 미사용.
- `ui.*` SystemConfig 는 **병원 단위**(간호부·위원회가 정함) — "의사 A 는 EN, 간호사 B 는 한글"을 담을 수 없다.
- `User` 모델에 preferences JSON 없음. `UserChartPreference` 는 살아 있으나(EP 7·web 6파일 — 과거 "죽어 있음" 기록은 stale) 차트 템플릿/보드 전용.
- 직원 화면 i18n 전무(`useT` 소비 0) — 포털 전용 4개 언어. 직원 HIS 는 다국어 기획에서 **명시적 범위 외**였다(`multilingual-i18n.plan.md:20`).
- 🔴 선례 경보: `emr.locale` 처럼 "키만 만들고 소비처 0"은 가드가 잡는다(`unwired-config-baseline.spec.ts`) — **토글은 렌더러 배선까지가 한 벌**.

### 1.4 어시스턴트·검색 현 구조 (+ 곁가지 실결함 3)

- 어시스턴트: 진입점 전 앱에 **1개**(사이드바 로고 버튼) → `AiChatBar`(400px 고정 패널·`left-[232px]` 하드코딩·ESC 닫기 없음). EP `POST /ai/chat` 슬래시 커맨드 16종. 열림 상태가 layout 로컬 `useState` 라 **외부에서 열 수 없다**.
- 검색: **두 벌 병존** — (a) TopBar 인라인(단축키 없음·화살표 없음) (b) `Cmd+K` SmartSearchBar(화면 레지스트리 포함). 어시스턴트와의 연결 0.
- 🔴 실결함: ① 어시스턴트 퀵칩 `/진단` 은 서버에 없는 명령(서버는 `/감별`) → RAG 로 빠지며 화면은 "감별진단" 라벨 ② SmartSearchBar 에서 **Enter 가 이동하지 않음**(닫기만) ③ 어시스턴트 버튼은 전 역할 노출인데 EP 는 `@Roles(DOCTOR, NURSE)` → 약사·원무는 열면 403.

## 2. 설계

### 2.1 용어 표시 정본 — shared 어휘 + `<Term>` 부품 + 사용자 스토어

**shared `packages/shared/src/term-display.ts`**
```ts
TERM_LANG_MODES = ['KO', 'EN', 'BOTH']  // 기본 'KO' = 현행 유지(기본값이 동작을 바꾸지 않는다)
TERM_LANG_LABEL = { KO: '한글', EN: 'EN', BOTH: '병기' }
```

**web `components/ui/term.tsx` — `<Term nameKo nameEn />`** (+ 문자열형 `termText`)
- 모드는 훅(`useTermLang`)으로 읽는다 — `<Num>` 패턴. 화면은 이름 쌍만 준다.
- 렌더 규칙(정직성):
  - `KO`: nameKo → 없으면 nameEn(있는 언어를 그대로 — 조용한 공백 금지)
  - `EN`: nameEn → **없으면 nameKo + '영문명 미등록' 티**(title+시각 표시). 🔴 기계번역·로마자 변환 금지 — 지어낸 번역이 임상에서 제일 위험하다
  - `BOTH`: `nameKo (nameEn)` — 인쇄 처방전·검색 드롭다운의 기존 병기 관례
- **약품은 `DrugName` 유지·확장**: 모드 소비 시 EN = `nameEn ?? (라틴 시작 ingredient) ?? nameKo+미등록 티`. 기존 `bilingual` prop(인쇄용 강제 병기)은 그대로 둔다.
- 🔴 **인쇄·대외 출력물(`print/*`·발급 문서·FHIR)은 토글의 영향을 받지 않는다** — 개인 표기 선호가 저장 값·집계·대외 문서를 바꾸지 않는다(기존 규칙). 가드로 동결.

**저장**: zustand + localStorage `term.lang`(포털 locale 스토어와 같은 수법 — 현행 사용자 단위 관례). 서버 동기화(기기 간)는 P2 사람 결정. 검색·저장·집계는 **불변**(검색은 이미 한/영/성분 동시 — `medicationSearchOrTerms`).

### 2.2 토글 UI — TopBar 우측

- 자리: `TopBar.tsx` 우측 블록(WorkstationBadge 옆·`hidden md:flex` 관례). 형태: 3단 세그먼트(한글·EN·병기) 또는 순환 버튼 — **세그먼트**로(현재 상태가 보이는 쪽이 정직). `aria-pressed`·44px.
- 모바일(md 미만)에서는 숨김(TopBar 보조 요소 관례) — 값은 유지된다.

### 2.3 적용 범위 — 단계 (전부 켜지 않는다)

**P0 (이번 개발)** — 쌍이 100% 실재하는 곳 + 정본 부품:
1. shared 어휘 + `<Term>`/`termText` + `useTermLang` 스토어 + TopBar 세그먼트
2. **진단**: `DiagnosisInput`(타입에 nameEn 추가·드롭다운 병기는 유지·선택 후 표시를 `<Term>`) · encounter 진단 리스트 · 환자 차트 진단 표시 주요 지점
3. **약품**: `DrugName` 모드 소비(위 규칙) — 기존 소비 4곳이 자동으로 따라온다
4. **검사 피커/오더**(마스터 기반 화면) — `LabTestCode` 쌍 소비
5. 가드: 미배선 방지(스토어 소비처 기계 대조) · EN 미등록 정직 폴백 · print 제외 · 기본값 KO
- 곁가지 실결함 3건 회수(§1.4): `/진단`→`/감별` 정합(칩↔서버 기계 대조 가드) · SmartSearchBar Enter 이동 · 어시스턴트 버튼 역할을 EP 에 맞춤(nav 를 API 에 맞춘다)

**P1 — ✅ 완료(2026-09-04 같은 날 · 사람 지시 "P1도 진행")**:
- **랩 결과 한/영 병기** — 운영 재실측: 어휘 **66종**이고 🔴 **데이터 자신이 병기 쌍을 담고 있었다**
  (`WBC (백혈구)`·`공복혈당 (FBS)`·`칼륨` 혼재). 매핑 조인 대신 **shared `lab-term.ts` 사전 정본**
  (시드·데이터에서 수확한 쌍+확립 어휘만·AST/LDL 류는 한국 임상 관례상 **의도적 미등재** — 원문 유지).
  `parseLabTerm` 이 세 저장형을 전부 분해. `<LabTerm>`(직원·모드 연동)·`<PortalLabTerm>`(포털·항상
  한글 우선) — 검사결과 탭·개요·간호 레일·진단검사 WS·포털 3곳 배선. 저장 testName 불변(가드).
- **검색 두 벌 통합** — TopBar 인라인 검색 구현 제거 → SmartSearchBar(⌘K) 열기 위임
  (`smart-search-store` 승격). 자체 검색 부활 방지 가드.
- **진료과·수술마취·간호 배선 — 하지 않음(정직한 판단)**: 실측상 세 마스터의 화면 소비처가 사실상 0
  (진료과 표시는 로컬 하드코딩·마취는 shared `anesthesia.ts` 한글 정본이 이미 처리) — 소비처 없는 배선은
  죽은 코드다. **신규 화면이 이 마스터를 소비할 때 `<Term>` 을 쓰는 것을 규약으로** 남긴다.

**P2 (2026-09-06 · 사람 지시 "P2도 진행")**:
- ✅ **선호 서버 동기화 구현** — `user_ui_preferences`(명시 컬럼만·termLang·null=미설정) +
  `GET/PUT /api/v1/users/me/ui-preferences`(자기 스코프·EVERY_STAFF_ROLE 파생·me 를 :id 앞에).
  스토어 2층(로컬 즉시+서버) — 🔴 서버 저장 실패는 "이 기기에만 저장됨" 토스트(조용히 안 삼킴)·
  하이드레이션은 서버 우선·되쓰기 없음·서버 null 을 KO 선택으로 안 접음.
- 📋 **약품 영문 상품명 소스 — 조사 결과(2026-09-06)**: 후보 = 식약처 「의약품 제품 허가정보」
  OpenAPI(https://www.data.go.kr/data/15095677/openapi.do · 식의약 데이터 포털 https://data.mfds.go.kr).
  🔴 **영문 제품명 필드 존재 여부는 페이지에서 확인 불가**(출력 필드 명세가 이미지 가이드 뒤 —
  원문 미확인). API 키 신청·명세 열람·수입 승인 = **사람 몫**. 로마자 자동변환 금지 결정 유지.
- `ProcedureCode` 영문명: 공신력 소스 미확인 — 보류 유지.
- `CodeSynonym` ENGLISH 종 승인: 운영(사람 몫) 그대로.

### 2.4 어시스턴트 ↔ 검색 통합 (요청 ③)

방향: **검색을 어시스턴트의 입구로**(옴니박스) — "+" 버튼은 유지하되 유일 입구를 해소한다.
- P0: ① 어시스턴트 열림 상태를 zustand 스토어로 승격(외부에서 열 수 있게 — 현 로컬 state 해소) ② SmartSearchBar(Cmd+K)와 TopBar 검색 결과 하단에 **"AI(WeRU.B) 어시스턴트에게 묻기: {질의}"** 행 추가 → 패널 열림+질의 전달(AI 표기 병기·역할 게이트는 EP 와 동일하게 — 권한 검사는 AI 호출 앞) ③ §1.4 실결함 3건.
- P1(제안): 검색 두 벌 통합 시 옴니박스를 Cmd+K 하나로 수렴 · `AiChatBar` 의 `left-[232px]` 하드코딩·ESC 미지원 등 패널 UX 정비.
- (범위 외 명시) 어시스턴트 기능 자체의 확장(agent-session 통합 등)은 이 축이 아니다.

### 2.5 사람 결정 필요 (개발 전 차단 아님 — 기본값으로 진행하되 등재)

| # | 결정 | P0 기본값(뒤집기 쉬움) |
|---|---|---|
| 1 | 기본 모드 | `KO`(현행 유지) — 뒤집으려면 병원 단위 기본값 config 신설 필요 |
| 2 | 병기(BOTH) 포함 여부 | 포함(임상 안전상 중간값·기존 병기 관례 존재) |
| 3 | 선호 서버 동기화(기기 간) | P0 은 localStorage — P2 에서 결정 |
| 4 | 약품 영문 상품명 소스 | 기존 보류 결정 유지(성분 기반 표시) |
| 5 | 어시스턴트 EP 역할 확대(약사·원무) | P0 은 버튼을 EP(의사·간호)에 맞춤 — 확대는 임상 AI 성격이라 사람 몫 |
| 6 | 포털(환자) 적용 방식 | P1 — 일반인은 한글 기본이 자연스러움(별도 판단) |

## P3 — 전 메뉴 확산 기획 v2 (2026-09-06 · 초안을 스스로 검토·보완한 판)

> 🔴 v1 검토에서 잡힌 것: ① 계수가 JSX·템플릿·편집 폼 value 를 섞어 세었다(68 은 혼합치)
> ② **간접 렌더(변수 경유 폴백 체인) 9파일이 계수에서 통째로 빠져 있었다** — MAR·주치의 WS·
> 진료 대기열 등 임상 고빈도 ③ W3 의 코드마스터류는 검수·편집 화면이라 토글 제외가 정답.

### P3.0 확산 대상 전수 실측 v2 (grep 정밀 계수 — 이 표가 범위 정본)

| 표면 | 지점/파일 | 처리 |
|---|---|---|
| 진단·코드명 JSX 직접 렌더 `{x.nameKo}` | **52지점** | 배선 대상(기준선) |
| 검사 항목명 JSX 직접 렌더 `{x.testName}` | **31지점** | 배선 대상(기준선) |
| 템플릿 리터럴 `${x.nameKo}` 류 | 13+1지점 | 🔴 **원문 유지** — confirm·토스트·AI 프롬프트·문자열 조립(표시 정본 아님) |
| 편집 폼 `<input value={…nameKo}>` | 3지점 | 🔴 **절대 비변경** — 표시가 아니라 저장 경로(오염 위험) |
| 간접 렌더(변수 경유 `= x.nameKo ??/||` 체인) | **9파일** | 배선 대상 — attending WS·입원 MAR·clinic-queue·LabTech/Pharmacist 대시보드·lab 2·homepage booking·기타 |
| 태블릿·staff·print 그룹 | 0 | 범위 밖 확인 |
| `window.print` 화면(print/ 밖) 3곳 | 용어 렌더 0 | 현재 무해 — **용어 부품 금지 가드**로 미래 동결 |
| 모바일(apps/mobile) | 미계수 | **범위 외**(deploy 무관·스토어 경로) — 별도 축 |

🔴 **grep 계수는 하한이다** — 간접 렌더가 실제로 빠졌었다. 웨이브 착수 시 파일 단위로 열어
확인하고, 가드 휴리스틱을 넓히면 기준선을 재실측한다(44px 에서 겪은 것).

### P3.1 확산 원칙 (P0~P2 유지 + 검토로 추가된 4)

1. **정본 부품 3종만** — `<Term>` / `<DrugName>` / `<LabTerm>`. 대량 목록(1,000행급)은 문자열형
   (`termTextOf`·`labTermText`+훅 1회)로 렌더 비용을 고정해도 된다(모드 변경은 드물어 전체
   리렌더 1회 — 허용).
2. 🔴 **데이터 없는 도메인 배선 금지** — 처치(ProcedureCode)·알레르기. 가드 계수에서 "데이터
   대기"로 분리 집계.
3. 🔴 **검수·편집 화면은 토글 제외가 정답** — admin/codes 4종·drug-mapping·reference-ranges 는
   한/영 병렬 컬럼+편집 폼(원본 확인이 목적). 토글을 붙이면 원본 확인성이 죽고 value 오염
   위험만 생긴다. 제외 목록으로 가드에 명시.
4. 불변 경계(재확인): 검색·정렬·저장·인쇄·**템플릿 리터럴(confirm·토스트·프롬프트)**·
   `<input value>`·집계·대외 문서·표준 식별자.
5. 🔴 **서버 select 사전 대조가 웨이브 첫 단계** — 배선 파일→EP→select 표를 먼저 만든다
   (오더 EP 실측: 안 실으면 EN 전부 미등록 티). 기확인: prescriptions/patient(전체 포함)·
   orders(확장 완료)·codes/*(전체 행). 미확인: problem-list·family-history·MAR·care-plan·
   pre-order·telehealth 차트 EP — W1/W2 착수 시 실호출 확인.
6. `window.print` 화면(PatientHeader·ReceptionTicket·QrTab)에 용어 부품 금지 — 화면 인쇄에
   표기 선호가 실리면 안 된다.

### P3.2 배선 웨이브 v2

| 웨이브 | 파일 | 비고 |
|---|---|---|
| **W1 임상 고빈도 (20)** | 기존 15(patients 4·pharmacy 3·lab 4·diagnostics 2·imaging·inpatient care-plan) + 🔴 검토 추가 5: **workstation/attending·inpatient MAR·clinic-queue·LabTechDashboard·PharmacistDashboard**(간접 렌더 파일) | MAR 는 투약 안전 표면 — 배선 후 EN 모드 실증 필수 |
| **W2 진료 특수 (9)** | telehealth 4·remote-consult·psychiatry·his-checkup 2·workstation/templates·AiAssistantPanel(JSX 표시부만) | AI 패널 프롬프트 조립은 템플릿 리터럴 = 원문(가드가 JSX 만 세므로 자동 구분) |
| **W3 임상 규칙·개인 (6)** | order-sets·treatment-templates·formulary·checkup-explainer·settings/my-codes·drug-explain | 코드마스터·매핑·기준치 3+2종은 **검수 화면 제외**(P3.1-3) |
| **W4 enum 용어 (1)** | 마취: EN=정본 코드 그대로(`GENERAL` — 이미 영문)·BOTH=`전신마취 (GENERAL)` — shared `anesthesia.ts` 확장·소비처 1곳 | 상태 라벨 40+는 UI 어휘 — 대상 아님 |

### P3.3 신규 위반 차단 — 기준선 가드 (spec: `term-display.spec.tsx` 확장)

- 계수 휴리스틱: **JSX 직접 렌더만**(`{expr.nameKo}`·`{expr.testName}` — `${…}` 템플릿·
  `value={…}` 제외) + 간접 렌더는 파일 목록 핀(휴리스틱이 못 세는 것을 목록으로 동결).
- 기준선 **52·31 동결 → 웨이브마다 하향**. 처치(`procedureCode.nameKo`)는 분리 집계.
- 검수 화면 제외 목록·window.print 금지·재주입 역검증(배선 1곳 제거→실패) 필수.

### P3.4 검증 (웨이브 공통)

서버 select 실호출 → 배선 → 재계수(기준선 하향) → 재주입 → 운영 실증(EN 모드 대표 화면
2~3곳 — W1 은 **MAR 필수**) → tsc·전체 스위트·로컬 next build → 배포(스모크).

### P3.5 데이터 트랙 (사람 몫 — 배선 선행 조건)

| 무엇 | 상태 |
|---|---|
| ProcedureCode 영문명 | 소스 미확인 — 확보 전 배선 금지 |
| 약품 영문 상품명(ITEM_ENG_NAME) | 식약처 허가정보 OpenAPI 명세 열람(API 키 신청) 필요 — 확보 시 EN 표시가 성분→상품명 승격 |
| 검사 사전(lab-term) 확장 | 미등재 유입 시 수확 원칙으로 추가 |

### P3.6 사람 결정 추가 (#7)

| # | 결정 | 기본값 |
|---|---|---|
| 7 | **EN 모드에서 정렬·검색 언어** — 현행은 표시만 영문·정렬/검색은 한글 기준 유지(불변 원칙). 표시 언어를 따르게 할지 | 현행 유지(한글 기준) — 정렬까지 바꾸면 화면 간 순서 불일치·검색 인덱스 영향 |

### P3.7 하지 않을 것 (확산이어도)

UI 문구·상태 라벨·메뉴명 번역(직원 i18n — v2.0 폐기 결정 존중) · 기계번역·로마자 폴백 ·
표준 식별자 번역 · 프롬프트/저장/인쇄/편집 폼 변경 · 검수 화면 토글.

## 3. P0 구현 파일 계획

| 무엇 | 파일 |
|---|---|
| shared 어휘 | `packages/shared/src/term-display.ts`(+index export) |
| 스토어+훅 | `apps/web/src/stores/term-lang-store.ts`(zustand·localStorage `term.lang`·포털 locale 수법) |
| 정본 부품 | `apps/web/src/components/ui/term.tsx`(`Term`·`termText`) · `display.tsx` 의 `DrugName` 모드 소비 확장 |
| 토글 UI | `components/layout/TopBar.tsx` 우측 세그먼트 |
| 진단 배선 | `DiagnosisInput.tsx`(DxCode 타입 nameEn·표시) · `encounter/new/page.tsx` 진단 리스트 · `patients/[id]` 진단 표시 지점 |
| 검사 배선 | 검사 피커(마스터 기반) 화면 |
| 어시스턴트 | `stores/ai-chat-store.ts` 승격 · `layout.tsx`/`Sidebar.tsx` 소비 전환 · `SmartSearchBar.tsx`+TopBar 검색에 "묻기" 행·Enter 이동 · `AiChatBar.tsx` 퀵칩 `/감별` |
| 가드 | `apps/web/test/ui/term-display.spec.tsx`(모드 렌더·미등록 티·print 제외·소비처 대조) · 칩↔서버 커맨드 대조(BE) · SmartSearchBar Enter |

## 4. 가드 계획 (재주입 역검증 포함)

1. **미배선 방지**: `useTermLang`/`<Term>` 소비 파일 수 하한(기계 대조) — emr.locale 선례 재발 방지
2. **정직 폴백**: EN 모드 + nameEn null → nameKo 렌더 + '영문명 미등록' 표시가 있다(제거 재주입 → 실패)
3. **print 불변**: `print/` 라우트가 `useTermLang` 을 소비하지 않는다
4. **기본값 KO**: 스토어 초기값이 KO(현행 유지) — 저장 없는 사용자 화면이 오늘과 같다
5. **칩↔서버 대조**: `AiChatBar` 퀵칩 명령이 서버 switch 케이스에 전부 존재(기계 대조)
6. 기존 가드 준수: 44px(토글·묻기 행)·수치/날짜 정본·산출 불가 정본

## 5. 하지 않을 것

- **기계번역·로마자 자동변환으로 영문명을 만드는 것** — 없는 번역은 없다고 말한다(외국인 진단서 관례).
- 표준 식별자(IPSG·WHO·KTAS·LOINC 코드)를 번역 대상으로 삼는 것.
- 저장 값·검색 인덱스·집계·대외 문서를 표기 선호로 바꾸는 것.
- 직원 화면 전면 i18n(UI 문구 번역) — 이 축은 **의료용어 표기**만 다룬다(다국어 기획 v2.0 폐기 결정 존중).
- `ProcedureCode`·알레르기 등 쌍 데이터가 없는 도메인을 P0 에 끼워 넣는 것.

## 관련

- 실측: 병렬 에이전트 3기 보고(용어 표면·TopBar/검색/어시스턴트·선호 저장) + 운영 DB 충전율(2026-09-04)
- 선행 정본: `medication-bilingual-naming.plan.md`(약품 축 — 로마자 금지·성분이 실탄) · `multilingual-i18n.plan.md`(직원 HIS 범위 외 결정) · `display.tsx` `DrugName` · `packages/shared/src/anesthesia.ts`(마취 한/영 정본 선례)
