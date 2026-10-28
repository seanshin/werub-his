# 약물명 한/영 병용 정본화 — 검색·표시·DUR·문서 전 영역 수렴

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/src/common/medication-search.ts:28 · apps/api/src/modules/doctor-code/doctor-code.service.ts · 잔여: 한글 ingredient 386건 수기 확인·영문 상품명 소스(사람)

- **작성**: 2026-08-05 (전수 실측 기반·미구현)
- **상태**: ⚠️ **부분 종결(2026-08-05) — 소비처 하나가 남아 있었다**
  - 🔴 **2026-08-18 실측**: 이 축이 정리한 한/영 어휘를 **DUR 룰 매칭이 쓰지 않고 있었다.**
    `dur.service.ts` 는 `ingredient`(영문) 단일 필드에 **한글 룰 문자열**을 `includes` 로 찾아
    **55룰 중 43룰이 개통 이래 매칭 0**(차단 ERROR 21건 전량)이었다. BEERS 13룰만 hay 3원이라 살아 있었다.
    → 검색 정본(`common/medication-search`)의 3원 매칭을 전 룰 타입으로 승격해 당일 회수(사멸 4/55).
  - 🔴 **교훈**: 어휘 정본을 만든 것과 **모든 소비처가 그것을 쓰는 것**은 다른 일이다.
    이 축은 검색·표시·FHIR·DUR hay 를 정리했으나 **DUR 판정 술어는 범위 밖에 있었다.**
  - 원래 종결 범위: P0~P3 + 백필(GOV-2026-017) + 한글 성분 시드 정비(§0.98) — P0~P3 + 백필(GOV-2026-017) + 한글 성분 시드 정비(§0.98)까지. 잔여=실 서비스 전 약제팀 재확인(의결 조건부)·임포트분 영문 상품명(소스 확보 시)
- **요구**: 약물의 한글명(nameKo)·영문명(nameEn)을 **둘 다 입력·검색 가능하고 함께 처리**되도록 — 코드와 실사용 영역 전반에서 공용 규약으로.

---

## 0. 전수 실측 결론 (2026-08-05)

> **현재 한/영 병용은 규약이 아니라 우연이다.** 스키마(nameKo·nameEn·ingredient)는 준비돼 있으나 ①실사용 주경로가 nameEn 을 안 보고 ②운영 데이터의 nameEn 이 사실상 비어 있으며 ③표시 폴백이 화면마다 제각각이다.

### 0.1 검색 경로 (nameEn 포함 여부)

| EP | 용도 | nameEn |
|---|---|---|
| `GET /code-search?type=MEDICATION` (`doctor-code.service.ts:201`) | **처방 입력 주경로**(useCodeSearch) | **X** |
| `GET /codes/medication` (`code-master.service.ts:277`) | useCodeSearch **폴백**·TopBar·오더셋 등 | O |
| voice(`voice-emr:114`)·terminology(:177)·formulary AI(:341)·order-set(:262)·agent(:1750)·FHIR(:2577)·포털 약설명(:187) | 각 특수 경로 | 전부 **X** |

→ 같은 화면에서 영문 검색이 **폴백 EP 발동 시에만 우연히** 동작. 매칭 규약도 EP 마다 다름(insensitive 유무·code startsWith vs contains·orderBy 3종).

### 0.2 데이터 실태 (24,022품목)

- `import-drug-master.ts`(대량 임포트)·`drug-prices-20260706.sql`(운영 백필) 모두 **name_en 미기입** — nameEn 보유는 시드/스크립트 유래 ≈250건 이하
- `ingredient` 는 **한글(시드)/영문(HIRA 백필)/null(임포트분) 3중 혼재**
- 진단(KCD)·간호 코드는 name_en 백필 SQL 이 있는데 **약물만 없음**

### 0.3 DUR — 설계 의도와 데이터 불일치

- Beers 룰은 "영문 성분+한글 표시명 병행 매칭" 설계(`dur-rules.defaults.ts:76` 주석)인데 매칭 hay(`dur.service.ts:155`)에 **nameEn 미포함** + ingredient 3중 혼재 → 임포트 24k 품목에선 영문·한글 키워드 **양쪽 다 안 걸림**
- 병용·연령금기 룰은 전부 한글 성분명 → ingredient 가 영문/null 인 품목 미매칭

### 0.4 표시 — 공용 부품 부재

- `PatientName`·`StaffName`·`Money`·`KDate` 는 정본 부품이 있는데 **`DrugName` 없음** — 조제·MAR·인쇄·포털·모바일 전부 인라인 폴백 체인이며 순서 제각각(`nameKo` 단독 / `nameKo ?? nameEn` / 인쇄는 nameEn 5순위)
- 검색 드롭다운(`order-entry.tsx:204`)의 nameEn 표시가 `!myDefaults && !deptGuide` 가드로 **자주 쓰는 약일수록 안 보임**
- 영문 진단서(`foreign-patient.service.ts`)에 **투약 섹션 자체가 없음** · FHIR Medication 의 nameEn coding 은 존재하지 않는 `atcCode` 참조로 **사장된 코드**(`fhir.controller.ts:2610`)

### 0.5 인프라

- trgm 인덱스는 name_ko 만(수동 SQL·2026-07-30 적용). name_en·ingredient 는 없음 → nameEn 정식 지원 시 seq scan 위험

## 0.9 P0 재실측 보정·실행 기록 (2026-08-05 — 운영 DB 정밀 계수)

**기획 0.2/0.5 를 뒤집는 실측 3건**:
1. **영문 성분명은 이미 있다** — `ingredient` 21,981건 중 **영문 21,595(90%)**·한글 386·null 2,041. HIRA 백필분이 "thiotepa   15mg" 형 소문자 영문. → **영문 '검색'은 외부 백필 없이 P1(빌더에 ingredient 포함)만으로 실현된다.** 갭의 실체는 null 2,041 과 영문 상품명(nameEn 51건)뿐.
2. **WeRU.B drug_master(305K)는 영문명 소스가 아니다** — 실측 스키마에 영문 컬럼 없음(한글상품명·ingr_code·ATC 크로스워크만). D1 의 1순위 소스 전제 기각. 로컬 clinic_codes.db 400건(D-코드 영문 INN)도 HIS 코드체계(M-·EDI 9자리)와 결속 불가.
3. **medication_codes 에 trgm 인덱스가 전무였다**(pg_trgm 확장은 설치) — 0.5 의 name_ko 적용 기록은 타 테이블 건.

**실행(CLI 가능분)**:
- trgm 3본 적용 완료(name_ko·name_en·ingredient·CONCURRENTLY) — `manual/medication-bilingual-p0-20260805.sql`.
- **코드 결속 전파 후보 1,606건 산출**(null ingredient 행 ← 동일 ingredient_code 의 영문 성분·동일 코드 내 명칭 상이 0건 실측 = 추정 아님). 검토 쿼리·적용 쿼리 동봉 — **적용은 약제팀 게이트(주석 봉인)**.
- 잔여 사람 몫(§H): ①한글 ingredient 386건(시드 계열·결속 소스 없음) 수기 확인 ②영문 상품명 공신력 소스 실존 여부(로마자 자동 변환 금지).

## 0.95 P1 실행 기록 (2026-08-05)

- **`common/medication-search.ts` 신설**(D2): `buildMedicationSearchWhere`(OR 4항 — code startsWith 대문자·nameKo/nameEn/ingredient contains insensitive)·`medicationSearchOrTerms`(합성용)·`MEDICATION_SEARCH_ORDER`(nameKo asc).
- **8개 경로 교체**: 처방 주경로(doctor-code — 브라우징만 category 정렬 유지)·code-master(기존 규약이 정본으로 승격된 형태)·voice(+**fuzzy 동의어에 nameEn·ingredient 주입** D9)·medical-terminology·order-set(AI 초안 영문 약물명 매칭)·agent-session·formulary(OR 항+category 합성)·FHIR Medication(name 파라미터). 포털 약설명은 **완전일치 유지**(오매칭 방지 설계 — 기획 그대로 별도 판단).
- **계약 테스트 14건**: 빌더 규약 4 + EP 채택 소스 스캔 8 + voice 동의어 + 포털 완전일치 불변.
- **라이브 검증**: 주경로 영문 질의 meropenem 30건·thiotepa 9건·amox 30건(아목시실린+타목시펜 — ingredient 매칭), 한글 타이레놀 3건·뉴로페넴 2건(회귀 0). **P0 재실측 예측 그대로 — nameEn 백필 없이 영문 검색 실현**(ingredient 영문 21,595건이 실탄).
- 동반: bed 스펙 1건 신계약 갱신(available 응급 제외 — ER 축 D1 봉합의 스펙 반영 누락분).

## 0.97 P2·P3 실행 기록 (2026-08-05 — 코드 축 종결)

- **P2 표시 정본(D3·D5·D6)**: `components/ui/display` 에 `<DrugName>`(nameKo→nameEn→code→'-'·`bilingual` 병기)+`drugNameOf`(문자열 맥락) 신설. 이관 5곳 — 투약 이력 탭·진료 이력 탭·수납 탭·**인쇄 처방전(bilingual 병기)**·처방 드롭다운 **nameEn 조건부 가드 제거**(자주 쓰는 약일수록 영문명이 사라지던 역설 해소). lab 페이지는 검사 코드라 비대상.
- **P3 DUR(D4)**: Beers hay 3원(`ingredient+nameKo+nameEn`) — 기존 매칭 불변(OR 확장만)·기존 DUR 스펙 90건 통과로 회귀 확인.
- **P3 영문 진단서(D6)**: 투약 섹션 신설 — 동일 encounters 의 약물 처방, name=nameEn 우선→영문 ingredient→한글명+`(Korean name — no English name on file)` 정직 표기(로마자 변환 금지). 라이브 실출력 "Cisplatin Inj 50mg | 1정 | 1일 3회".
- **P3 FHIR(D7)**: 죽은 atcCode 분기 제거 → nameEn coding 추가. 라이브 실증 coding 2본(리피토정/Lipitor Tab).
- 모바일 이관은 화면 실측상 인라인 체인 부재(대상 0)로 소거.

## 0.98 한글 성분 시드 정비 (2026-08-05 — 사용자 지시 "시드 데이터로 처리")

- 🔎 **"한글 성분 386건"은 오분류 다수** — 정규식 `[가-힣]` 이 영문 성분의 한글 단위·주석("…mg/**정**"·"(A**액**456mL**중**)"·"50μg/**회**")까지 잡은 것. **진짜 한글 시작 성분은 80건**: 시드 M코드 51(전부 nameEn 보유)+한방 생약 복합 24+특수 5.
- **46건 영문 통일 적용**(운영 DB+seed.ts 동기): clinic_codes 사전 완전일치·염 접미 정규화 35 + **WHO INN 표준 표기 수기 11**(darbepoetin alfa·carboplatin 등 — 국제 표준명이라 추정 아님). `manual/medication-bilingual-seed-ingredient-20260805.sql`.
- **의도적 미변경 34건**: 한방 생약 복합 24(영문 INN 부재가 사실 — herbal)·혈액제제(적혈구·혈소판·혈장·응고인자)·세포치료제·복합전해질 — 빈 곳은 빈 대로(날조 금지).
- 최종 커버리지: ingredient 23,587/24,022(**98.2%**)·라틴 시작 23,503. 라이브 실증: `gabapentin` 주경로 검색 30건(종전 0 — 시드 정비 효과).
- **영문 상품명(nameEn)**: 시드 계열 51/51 보유 = **시드 범위 갭 0**. 임포트 24k 는 공신력 소스 확보 시(로마자 변환 금지 유지). → **약제팀 대기 2건 모두 시드 데이터 수준에서 종결**(실 서비스 전 재확인은 GOV-2026-017 조건부로 존속).

## 1. 결정표

| # | 결정 | 근거 |
|---|---|---|
| D1 | **데이터가 로직보다 먼저다** — nameEn·ingredient 백필(P0)이 선행. 백필 소스 1순위 = **WeRU.B drug-master(305,522행)** 성분/영문명 대조, 2순위 = 식약처 주성분코드집(ingredientCode 보유 24k 전량 매핑 가능) | 검색·표시를 고쳐도 값이 없으면 무효(실측 0.2). **오매칭 금지 — 자동 채움은 코드 결속(ingredientCode·표준코드) 매칭만, 이름 유사도 추정 금지**(데이터 정합성 원칙) |
| D2 | 검색 정본 = **공용 `buildMedicationSearchWhere(q)`** 하나 — `OR:[nameKo·nameEn·ingredient contains(insensitive), code startsWith(upper)]` + 정렬 규약 단일(nameKo asc·정확도 우선은 후속). 6개 EP 전부 이 빌더로 교체 | EP 간 비결정적 UX 해소(실측 0.1). 위치=`common/` 또는 code-master 서비스 export |
| D3 | 표시 정본 = **`<DrugName>` 공용 부품**(components/ui/display 관례) — 기본 `nameKo`(폴백 nameEn→code→'-'), `bilingual` 옵션 시 `nameKo (nameEn)` 병기. 인라인 폴백 체인 전면 이관 | PatientName/StatusBadge 수렴 선례. 폴백 순서 단일화 |
| D4 | DUR hay = `ingredient + nameKo + nameEn` 3원 + **ingredient 정규화 백필**(영문 통일·한글 성분은 병기 컬럼이 아니라 룰 키워드가 흡수) | Beers 설계 의도 복원(실측 0.3). 룰 개정은 DTC 표면(DurRule) |
| D5 | 드롭다운 nameEn **상시 병기**(조건부 가드 제거) — 내 목록·과 카탈로그 포함 | 자주 쓰는 약일수록 영문명이 사라지는 역설 해소 |
| D6 | 인쇄·대외 문서: 처방전 약물명 `nameKo (nameEn)` 병기(값 있을 때)·**영문 진단서에 투약 섹션 신설**(nameEn 우선·없으면 nameKo+로마자 없음 표기) | 외국인 환자 대응(언어 갭 축과 연결) |
| D7 | FHIR Medication: 죽은 atcCode 분기 제거 → nameEn 있으면 두 번째 coding(display=nameEn)·text 는 nameKo 유지 | 표준 상호운용 정합 |
| D8 | 인덱스 동반: `name_en`·`ingredient` gin_trgm 수동 SQL 추가(기존 manual/search-trgm 패턴·deploy.sh 미실행이므로 적용 런북 명기) | 24k seq scan 방지(실측 0.5) |
| D9 | `fuzzyCodeSearch`(shared)는 `getSynonyms` 에 nameEn 주입으로 확장(시그니처 무변경) — 음성·후속 화면 공용 | 기존 유틸 재사용·초성/오타 내성은 한글 경로 유지 |
| D10 | 재고(InventoryItem 단일 name)·브랜드 표시명 정본 레이어는 **비범위**(별도 판단) | 마스터 통합은 다른 축 |

## 2. Phase

- **P0 — 데이터 백필(선행·사람 검토 동반)**: ①WeRU.B drug-master 대조 스크립트(ingredientCode/표준코드 결속 매칭만·추정 금지) → nameEn·ingredient(영문 통일) 백필 후보 산출 ②약제팀 검토 후 manual SQL 적용(+적용 런북) ③trgm 인덱스 2본(D8). **커버리지 목표: ingredientCode 보유분 전량·상품 영문명은 소스 있는 만큼(무리한 로마자 변환 금지)**
- **P1 — 검색 정본 수렴**: `buildMedicationSearchWhere` 신설 → 주경로(code-search)·voice·terminology·formulary·order-set·agent·FHIR·포털 약설명(완전일치→contains 승격은 별도 판단) 교체·정렬 규약 단일·계약 테스트(EP 간 동일 질의 동일 집합)
- **P2 — 표시 정본**: `<DrugName>` 신설 + 조제·MAR·인쇄·포털(서버 조립 문자열은 BE 에서 병기)·모바일 이관 · 드롭다운 가드 제거(D5)
- **P3 — DUR·문서·FHIR**: DUR hay 3원화+판정 회귀 테스트(기존 판정 불변 확인·왕복 대조 선례) · 처방전 병기·영문 진단서 투약 섹션 · FHIR coding 수리
- 비범위: 재고 마스터 통합·브랜드 표시명 레이어·처방 화면 초성/오타 내성 확대(별도 축)

## 3. 위험·주의

- **백필 오매칭 = 임상 위험**: 영문명이 다른 약에 붙으면 DUR·표시가 오염된다 — 코드 결속 매칭만, 이름 유사도 자동 채움 금지, 약제팀 검토 게이트(D1)
- 검색 결과 집합이 넓어짐(영문 OR) → 정렬·상위 노출 규약이 없으면 처방 UX 저하 — P1 에서 정렬 규약 함께
- DUR hay 확장은 **판정 변화 가능**(더 잘 걸리게) — WARN/BLOCK 운영 중이므로 회귀 테스트로 "기존 걸리던 것 불변+신규 매칭만 추가" 확인
- trgm 수동 SQL 은 deploy.sh 미실행 — 적용 누락 시 성능 저하 조용히 발생(런북·go-live 항목 검토)

## 4. 검증 계획

- [ ] P0: 백필 후 커버리지 실측(nameEn 보유율·ingredient 영문 통일율) 보고 — 24,022 분모
- [ ] P1: 동일 질의('아목시', 'amox', 'AMX', 초성) EP 6종 결과 집합 일치 계약 테스트 · 영문 질의로 처방 입력 주경로에서 검색 성공
- [ ] P2: `<DrugName>` 채택 화면 목록·인라인 폴백 grep 0(대상 화면 한정) · 드롭다운 내 목록 항목에 영문명 표시
- [ ] P3: DUR 골든(기존 판정 전수 불변+영문명 매칭 신규 케이스) · 영문 진단서 투약 섹션 실출력 · FHIR Medication coding 2본
