# 수치 표시·반올림 정책 통합 (Numeric Format & Rounding Policy)

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — packages/shared/src/numeric-policy.ts · packages/shared/test/numeric-policy.spec.ts · apps/api/test/architecture/numeric-format-guard.spec.ts · 잔여: §9.4 본인부담 10원 절사 이원화(사람); toFixed 잔여(CLI · 기준선 동결)

- 작성: 2026-08-06
- 상태: 기획(Plan) — 전체 검토·분석 반영
- 관련 규약: `docs/03-analysis/ux-consistency-review-2026-07.md`(FE 표현 단위), CLAUDE.md §Conventions FE 표현 단위
- 관련 정본(선행 완료): `formatTemp`/`tempStatus`(vital-ranges) · `ageOf`/`ageInMonths`/`formatAge`/`stayDays`(shared/age) · `Money`/`KDate`(display) · `EligibilityService.resolveCopayRate` · Decimal 직렬화 봉합(date-serializer.interceptor)

---

## 1. 배경 — 왜 필요한가

수치(측정치·금액·계산 파생값)의 **자릿수·반올림 방식·단위·정상범위**가 화면·모듈마다 제각각 하드코딩돼 있다. 2026-08-06 하루에만 정본 우회로 인한 실결함이 연달아 발견됐다:

| 발견 | 근본 | 유형 |
|---|---|---|
| 체온 `38.199999999999996℃` | Decimal 직렬화 곱셈 재구성(전역) | 정밀도 |
| 나이 `365.25일` 근사 32곳 | 만나이 경계 1살 오차(소아 용량·수가) | 반올림 정의 |
| 재원일 `floor`/`ceil`/`max0` 혼재 13곳 | 장기재원 누락·청구 불일치 | 반올림 모드 |
| 본인부담 `Math.round`만 vs 원단위 절사 | 경로별 반올림 상이 | 반올림 모드 |
| BMI `toFixed(1)` 로컬 계산 | 정본 `calcBmi` 우회 | 정밀도·산식 |

이들은 **개별 봉합**했으나, 근본 구조는 "수치 규칙이 코드에 흩어져 있고 중앙 정의가 없다"는 것이다. 규칙을 바꾸려면(예: "체온은 소수 2자리로") 수십 곳을 찾아 고쳐야 하고, 새 화면은 또 제각각 하드코딩한다.

### 실측 (2026-08-06)

- **FE `toFixed` 산발**: `toFixed(0)` 9 · `toFixed(1)` 42 · `toFixed(2)` 30 = **81곳**. 도메인별 자릿수가 호출부마다 하드코딩(BMI 1자리·검사 2자리·BSA 2자리·백분율 0/1자리·금액 만원 0자리…).
- **BE 반올림 산발**: `Math.round` 287 · `Math.floor` 94 · `Math.ceil` 27 = **408곳**. 반올림 모드(반올림/올림/버림)가 도메인 의미와 무관하게 코드에 박혀 있다.
- **기존 중앙화 범위**: `ui.dateStyle`·`ui.currencyStyle`(SystemConfig ui.*) 2키 — **표기 스타일만** 다루고, **정밀도·반올림은 미포함**. `components/ui/display.tsx`(Money·KDate 등)·`lib/ui-settings.tsx`(useUiSettings)가 인프라로 이미 존재.

**결론**: 표기 스타일(날짜/통화)은 중앙화됐으나 **수치의 정밀도·반올림 정책은 중앙 정의가 없다**. 이 기획은 그 빈 자리를 채운다.

---

## 1.5 의료 표준 검토 (Standards Review)

수치·생체정보를 "임의로" 정의하지 않고 **국제 의료 표준에 정렬**한다. 프로젝트는 이미 FHIR R4·LOINC·openEHR 패턴을 참조하므로(CLAUDE.md), 정책 레지스트리를 이 표준 위에 얹는다.

### 표준 매핑

| 표준 | 무엇을 규정 | 이 기획에의 반영 |
|---|---|---|
| **UCUM** (Unified Code for Units of Measure, Regenstrief/NLM) | 단위의 기계가독 코드·차원분석 변환. 예: 체온 `Cel`·혈압 `mm[Hg]`·심박 `/min`·체중 `kg`·검사 `mg/dL` | 각 정책에 `ucumUnit` 필드. 표시 단위(℃)와 교환 단위(Cel) 분리. 단위 검증·변환은 `@lhncbc/ucum-lhc`(오픈, §5.3) |
| **FHIR R4 Vital Signs / US Core** | Observation.valueQuantity = { value(decimal, **implicit precision**), unit, system=`http://unitsofmeasure.org`, code=UCUM }. 각 vital 은 LOINC 코드 | 정책에 `loincCode`·`ucumSystem`. FHIR 출력 시 정책의 단위/정밀도 사용 |
| **LOINC** | 측정 항목 식별 코드. 체온 `8310-5`·심박 `8867-4`·수축기BP `8480-6`·이완기BP `8462-4`·SpO₂ `59408-5`·체중 `29463-7`·신장 `8302-2`·BMI `39156-5` | 정책 키를 LOINC 에 정렬(부록 C) |
| **openEHR `DV_QUANTITY`** | magnitude + units(UCUM) + **precision(소수 자릿수)** 를 데이터 타입에 내장. archetype 별(혈압·체온·체중) 정의 | 정책의 `decimals` 는 openEHR precision 과 1:1 대응. 내부 저장 모델(openEHR 패턴)과 정합 |
| **CLSI (검사 정밀도·유효숫자)** | 결과는 **소스 데이터와 같은 정밀도**로 보고. 파생 파라미터 관행 **3 유효숫자**. 수동입력/육안검토는 4자리 제한 권고. EP05/EP15 정밀도 가이드 | 검사수치는 **유효숫자(significant figures)** 개념 도입 — 항목별 `reference-range` 가 정밀도 override |

### 핵심 통찰: "유효숫자(significant figures)" ≠ "표시 소수 자릿수(display decimals)"

- FHIR decimal 은 **implicit precision** — `36.5` 와 `36.50` 은 의미가 다르다(측정 정밀도). 검사수치는 소수 자릿수 고정이 아니라 **유효숫자**로 다뤄야 정확하다(예: `0.05` 3자리 vs `1250` 4자리).
- 따라서 정책은 두 모드를 지원한다:
  - `decimals`(고정 소수 자릿수) — 체온·활력·금액 등 대다수.
  - `sigFigs`(유효숫자) — 검사수치처럼 크기에 따라 자릿수가 달라지는 값. CLSI 정합.
- 이는 UCUM Functional Test 조차 "유효숫자 반올림" 2건이 어렵다고 남긴 영역 — **표준적으로도 까다로우니 도메인별 명시가 필요**하다.

### 결론

수치 정책 레지스트리(§3.1)는 **UCUM 단위 코드 + LOINC 식별 + openEHR precision + CLSI 유효숫자**를 필드로 흡수한다. "임의 반올림 규칙"이 아니라 "표준에 정렬된 정책"을 관리한다.

---

## 2. 목표

1. 모든 수치의 **정밀도(소수 자릿수)·반올림 모드·단위·정상범위·표기 스타일**을 **도메인 단위로 한 곳(레지스트리)에서 정의**한다.
2. 그 정의를 **공통 포맷 함수/컴포넌트**로 표면화해 화면이 하드코딩 대신 `<Num domain="temperature" />` 로 쓰게 한다.
3. 관리자가 **관리 화면에서 규칙을 조정**할 수 있게 한다(예: "체온 소수 2자리 반올림" → config 한 줄). SystemConfig `ui.*` 확장.
4. **BE 저장·계산과 FE 표시가 같은 정책**을 공유한다(shared 레지스트리) — 화면·저장·청구가 어긋나지 않는다.
5. **법정·안전 제약이 있는 수치**(청구 원단위 절사·검사 유효숫자·용량)는 정책에 **잠금(locked) 표시**해 임의 변경을 막는다.
6. **국제 의료 표준에 정렬**(FHIR Vital Signs·UCUM·LOINC·openEHR·CLSI) — "임의 규칙"이 아니라 표준 정책으로 정의하고, 단위 검증·변환은 오픈 자원(`@lhncbc/ucum-lhc`)을 재사용한다(§1.5·§3.6).
7. **관리 기능으로 전체를 중앙 제어**하고, 모든 변경은 충실한 로그 + **전자서명(sign) 봉인**으로 남긴다. 법정·안전 정책은 **거버넌스 위원회 의결**로만 변경하고, 초기 시스템 설정 시 기준선을 함께 봉인한다(§3.7).
8. **현재 적용 기준·표준을 명확히 표기**한다 — 어떤 수치가 어떤 자릿수·반올림·표준(FHIR/UCUM/CLSI)으로 표시·계산되는지 관리 화면·응답 메타·화면 표기에서 확인할 수 있다(§3.8).

### 비목표 (Out of Scope)

- 408곳 `Math.round`를 일괄 치환하는 것(대부분 통계·내부 계산이라 표시 정책과 무관). **표시·저장·청구에 노출되는 수치**만 대상.
- 통화·환율 변환 로직(별도 ERP 트랙).
- 차트 축 눈금 포맷(차트 라이브러리 자체 기능으로 충분).

---

## 3. 설계

### 3.1 수치 정책 레지스트리 (단일 정본)

`packages/shared/src/numeric-policy.ts` — 도메인별 정책의 정본. FE·BE 공유.

```ts
export type RoundMode = 'round' | 'floor' | 'ceil' | 'bankers'; // 반올림 | 올림 | 버림 | 은행가반올림
export interface NumericPolicy {
  key: string;              // 'temperature' | 'money' | 'bmi' | 'labValue' | ...
  label: string;            // 관리 화면 표시명 (예: '체온')
  decimals?: number;        // 고정 소수 자릿수 (예: 체온 1)
  sigFigs?: number;         // 유효숫자 (검사수치 등 — CLSI 정합·decimals 와 택일)
  mode: RoundMode;          // 반올림 모드
  displayUnit?: string;     // '℃' | '%' | 'mmHg' | 'kg' | '원' — 화면 표시 단위
  ucumUnit?: string;        // 'Cel' | 'mm[Hg]' | '/min' | 'kg' — UCUM 교환 단위(FHIR/openEHR)
  loincCode?: string;       // '8310-5' 등 — 측정 식별(FHIR Observation)
  step?: number;            // 반올림 단위(예: 금액 원단위 절사=10, mode=floor)
  min?: number; max?: number; // 정상범위(참고·경고 — vital-ranges 통합)
  locked?: boolean;         // 법정·안전 제약 — 관리 화면에서 변경 금지
  standard?: string;        // 근거 표준 태그 (예: 'FHIR/UCUM', 'CLSI', '건보법')
  note?: string;            // 근거(법령·임상 기준·표준 코드)
}

export const NUMERIC_POLICIES: Record<string, NumericPolicy> = {
  // "체온은 소수 2자리 반올림" 규칙은 decimals: 2 로 이 한 줄(또는 config)만 바꾸면 전 화면 반영된다.
  temperature: { key: 'temperature', label: '체온', decimals: 1, mode: 'round', displayUnit: '℃', ucumUnit: 'Cel', loincCode: '8310-5', min: 36.0, max: 37.5, standard: 'FHIR/UCUM' },
  heartRate:   { key: 'heartRate', label: '심박수', decimals: 0, mode: 'round', displayUnit: 'bpm', ucumUnit: '/min', loincCode: '8867-4', min: 60, max: 100, standard: 'FHIR/UCUM' },
  systolicBp:  { key: 'systolicBp', label: '수축기혈압', decimals: 0, mode: 'round', displayUnit: 'mmHg', ucumUnit: 'mm[Hg]', loincCode: '8480-6', min: 90, max: 140, standard: 'FHIR/UCUM' },
  spo2:        { key: 'spo2', label: 'SpO₂', decimals: 0, mode: 'round', displayUnit: '%', ucumUnit: '%', loincCode: '59408-5', min: 95, max: 100, standard: 'FHIR/UCUM' },
  weight:      { key: 'weight', label: '체중', decimals: 1, mode: 'round', displayUnit: 'kg', ucumUnit: 'kg', loincCode: '29463-7', standard: 'FHIR/UCUM' },
  bmi:         { key: 'bmi', label: 'BMI', decimals: 1, mode: 'round', displayUnit: 'kg/m²', ucumUnit: 'kg/m2', loincCode: '39156-5', standard: 'FHIR/UCUM' },
  bsa:         { key: 'bsa', label: '체표면적', decimals: 2, mode: 'round', displayUnit: 'm²', ucumUnit: 'm2', locked: true, standard: 'Mosteller', note: '항암 용량=BSA×용량/m²' },
  labValue:    { key: 'labValue', label: '검사수치(기본)', sigFigs: 3, mode: 'round', locked: true, standard: 'CLSI', note: '파생값 3 유효숫자·항목별 reference-range override' },
  percent:     { key: 'percent', label: '백분율', decimals: 1, mode: 'round', displayUnit: '%', ucumUnit: '%' },
  money:       { key: 'money', label: '금액', decimals: 0, mode: 'round', displayUnit: '원', locked: true, standard: '통화', note: '통화 최소단위=원' },
  copay:       { key: 'copay', label: '본인부담금', decimals: 0, mode: 'floor', step: 10, displayUnit: '원', locked: true, standard: '건보법', note: '10원 미만 절사(국민건강보험법 시행령)' },
  stayDays:    { key: 'stayDays', label: '재원일수', decimals: 0, mode: 'ceil', min: 1, locked: true, standard: '입원료청구', note: 'max(1,ceil)' },
  age:         { key: 'age', label: '만나이', decimals: 0, mode: 'floor', displayUnit: '세', locked: true, standard: '만나이', note: '연·월·일 비교(ageOf)' },
  // … 도메인 카탈로그(§4)·표준 참조표(부록 C) 전량
};
```

- `displayUnit`(표시·℃)와 `ucumUnit`(교환·Cel)를 분리해 **화면은 사람이 읽는 단위, FHIR/openEHR 출력은 UCUM** 을 쓴다.
- `decimals`(고정)와 `sigFigs`(유효숫자)는 택일 — 검사수치는 sigFigs(CLSI), 그 외 대부분 decimals.

### 3.2 공통 포맷 함수 (shared)

```ts
/** 정책대로 반올림(값 계산용 — 저장·청구·비교) */
export function roundBy(value: number, policyKey: string): number;
/** 정책대로 표시 문자열(단위 포함·null 안전) */
export function formatNum(value: number | null | undefined, policyKey: string, opts?: { unit?: boolean }): string;
```

- `formatTemp`·`stayDays`·`calcBmi` 등 **기존 정본은 이 레지스트리를 참조하도록 리팩터**(값은 불변, 정의 출처만 중앙화). 하위호환 별칭 유지.
- **런타임 오버라이드**: config `ui.precision.<key>` 가 있으면 레지스트리 기본을 덮는다(잠금 정책 제외).

### 3.3 공통 컴포넌트 (FE)

`components/ui/display.tsx` 에 추가:

```tsx
/** 정책 기반 수치 표시 — <Num value={t} domain="temperature" /> → "38.2℃"(단위 0.5em) */
export function Num({ value, domain, unit = true, className }: {...});
```

- 내부에서 `useUiSettings()` 로 config 오버라이드 반영 + `formatNum` 호출.
- `Money`·`Unit`·`StayDays` 는 `Num` 의 특수화로 재정의(호출부 의도 보존).
- 정상범위(min/max) 벗어나면 자동 경고색 옵션(`warn` prop) — vital-ranges 의 isAbnormal* 을 정책으로 통합.

### 3.4 관리 화면 (Admin UI) — 상세 기획

기존 시스템 설정(`/admin/config` 읽기전용 표 + AI 설정 페이지의 카테고리 탭·per-key input/select·`PUT /api/v1/config/:key` 편집) 패턴을 계승해, **수치 정책 전용 관리 화면** `/admin/numeric-policy` 를 신설한다(단순 key-value 편집으로는 도메인×속성 표를 다루기 어렵다).

#### 화면 구성

```
┌─ 수치 표시·반올림 정책 ─────────────────────────────── [표준 정합 ✓ FHIR/UCUM] ┐
│  ⓘ 여기서 바꾼 규칙은 전 화면·저장·FHIR 출력에 즉시 반영됩니다.                 │
│                                                                                │
│  [ 활력·생체 ] [ 검사 ] [ 금액·청구 ] [ 계산 파생 ] [ 전체 ]   ← 그룹 탭        │
│                                                                                │
│  도메인       표시명   자릿수  반올림   단위(표시/UCUM)  정상범위  표준   미리보기 │
│  ─────────────────────────────────────────────────────────────────────────── │
│  temperature  체온     [1▾]   [반올림▾] ℃ / Cel        36–37.5  FHIR   38.19→38.2│
│  heartRate    심박수   [0▾]   [반올림▾] bpm / /min      60–100   FHIR   96       │
│  labValue     검사수치 [유효3▾][반올림▾]  (항목별)       —       CLSI🔒 1250→1250 │
│  copay        본인부담 🔒0     🔒버림10  원              —        건보법🔒 12,347→12,340│
│  ─────────────────────────────────────────────────────────────────────────── │
│  🔒 = 법정·안전 잠금(변경 불가·근거 표시)          [변경 저장]  [기본값 복원]     │
└────────────────────────────────────────────────────────────────────────────┘
```

#### 기능 요건

1. **그룹 탭**: 활력·생체 / 검사 / 금액·청구 / 계산 파생 / 전체 — 도메인이 많아 그룹핑(AI 설정 카테고리 탭 패턴).
2. **인라인 편집**: 자릿수(select 0~4 또는 '유효 N'), 반올림 모드(반올림/올림/버림/은행가), 표시 단위. per-row 저장(dirty 표시·저장 완료 토스트 — 기존 saved 패턴).
3. **실시간 미리보기**: 각 행에 **샘플값 변환 결과**(예: `38.199→38.2`, `12,347→12,340`)를 즉시 렌더 — 변경 효과를 저장 전에 확인. 오늘 발견한 부동소수점 같은 착시를 방지.
4. **잠금(🔒) 표시**: 법정·안전 도메인(금액·본인부담·검사 유효숫자·BSA·재원일·만나이)은 편집 컨트롤 비활성 + 근거 note(호버) + 표준 태그. 변경하려면 코드+검토 게이트(관리 화면 우회 불가).
5. **표준 참조 컬럼**: 각 도메인의 `standard`(FHIR/UCUM·CLSI·건보법)·`loincCode`·`ucumUnit` 표시 — "임의 규칙"이 아니라 "표준 정렬"임을 화면에서 드러낸다. LOINC 코드 클릭 시 loinc.org 링크.
6. **기본값 복원**: 도메인별/전체 레지스트리 기본으로 되돌리기(오버라이드 제거).
7. **감사·이력·서명(§3.7)**: 변경은 3층 기록 — AuditLog + `NumericPolicyChange` 이력 + **sign 해시체인 봉인**(entryHash·prevHash·TSA). 변경 이력 서브패널에 서명자·GOV 번호·직전 해시 표시.
8. **권한·거버넌스**: 일반 정책은 ADMIN 조정, **잠금 정책은 위원회 안건→의결→집행으로만**(관리 화면엔 "위원회 상정" 버튼만 노출, 직접 편집 불가). ADMIN 도 화면에서 잠금 변경 불가.
9. **현재 기준 표기(§3.8)**: '현재 기준' 컬럼에 적용 정책·표준·LOINC/UCUM·마지막 변경(GOV/서명)을 노출 — 기본값과 다르면 오버라이드 배지.

#### config 배선

- SystemConfig 키: `ui.precision.<domain>`(예: `ui.precision.temperature=2`)·`ui.roundMode.<domain>`·`ui.displayUnit.<domain>`. DEFAULTS 등재(미등재 시 관리 화면 미노출 규약 — 오늘 config 축 교훈).
- 잠금 도메인은 config 키를 만들되 `locked` 이면 API(`PUT /config/:key`)가 거부(서버측 이중 방어 — 화면 비활성만으론 부족).
- 오버라이드 없으면 레지스트리 기본 사용. `useUiSettings()` 가 병합해 컴포넌트에 전달.

### 3.5 BE 저장·계산 반영

- 저장 시점 반올림이 필요한 도메인(체온·활력·BMI·본인부담)은 서비스가 `roundBy(value, key)` 로 정규화(오늘 vitals/nurse-station 체온 반올림을 이 함수로 수렴).
- **Decimal 직렬화 근본 봉합은 완료**(date-serializer) — 이 기획은 그 위에서 "정책적 자릿수"를 얹는다.
- **FHIR/openEHR 출력 정합**: Observation.valueQuantity 생성 시 정책의 `ucumUnit`·`decimals`(=openEHR precision)를 사용 → 내부 표시와 외부 교환이 같은 정책을 공유.

### 3.6 오픈 프로젝트 활용 (Build vs Reuse)

단위·표준은 자체 구현하지 않고 검증된 오픈 자원을 재사용한다.

| 오픈 프로젝트 | 라이선스/출처 | 용도 | 도입 판단 |
|---|---|---|---|
| **@lhncbc/ucum-lhc** | NLM/Lister Hill(미 정부·오픈) | UCUM 단위 **검증·차원분석 변환**(예: `[degF]`↔`Cel`, `g/dL`↔`g/L`). npm·ES6+CJS+browser | **도입** — 관리 화면에서 단위 입력 검증, ℉↔℃ 변환(오늘 부동소수점의 근원인 단위변환을 표준 라이브러리로). ~수백KB, lazy import |
| **LOINC** | Regenstrief(등록 후 무료) | 측정 항목 코드 정본 | **매핑만** — 활력/검사 정책 키를 LOINC 에 정렬(부록 C). 전체 DB 적재는 불요(이미 reference-range·procedureCode 에 loincCode 보유) |
| **FHIR Vital Signs / US Core profile** | HL7(오픈 사양) | valueQuantity 구조·단위 규칙 | **사양 준수** — 이미 fhir 모듈이 Observation 출력. 정책의 ucumUnit/decimals 연결 |
| **openEHR DV_QUANTITY** | openEHR(오픈 사양) | magnitude+units+precision 데이터 타입 | **패턴 정합** — 내부 저장 모델(프로젝트가 openEHR 패턴 참조)과 precision 필드 1:1 |

- **핵심 재사용**: `@lhncbc/ucum-lhc` 로 ①단위 문자열 검증(관리 화면에서 잘못된 UCUM 코드 입력 차단) ②단위 변환(℉ 입력 → ℃ 저장 시 **표준 변환**으로 오늘 같은 부동소수점 잔차 원천 차단). 변환 결과는 정책의 `decimals` 로 `roundBy`.
- 자체 구현하는 것: 도메인 정책 레지스트리·`<Num>` 컴포넌트·관리 화면(도메인 특화라 범용 라이브러리 없음).

---

### 3.7 변경 거버넌스 — 위원회·서명 봉인·초기 설정

정책은 **관리 기능을 통해 전체를 중앙 제어**하되, 변경의 무게에 따라 통제 수위를 나눈다. 모든 변경은 충실히 기록되고 **전자서명(sign)으로 봉인**된다.

#### 3층 통제 (변경 권한)

| 등급 | 대상 도메인 | 통제 경로 |
|---|---|---|
| **A. 일반** | 표시 자릿수·표시 단위 등 **비법정** | ADMIN 이 `/admin/numeric-policy` 에서 조정 → 즉시 반영. AuditLog + 변경이력 + **sign 봉인** |
| **B. 잠금(법정·안전)** | 청구·본인부담·검사 유효숫자·용량(BSA)·재원일·만나이 | **거버넌스 위원회 안건**으로만 변경(gld 엔진). 관리 화면 직접 변경은 서버가 거부(3.4 이중 방어) |
| **C. 초기 설정** | 전 도메인 기준선(baseline) | 설치·셋업 시 정책 기본값 **seed 등재 + 최초 위원회 베이스라인 승인**(초기 정책 세트를 GOV 안건으로 봉인) |

#### B. 위원회 처리 (거버넌스 엔진 `gld` 편입)

잠금 정책 변경은 기존 위원회 워크플로우를 그대로 탄다([[governance_engine_plan]]):

```
안건 상정(POST /gld/agendas) → AI 사전검토(precheck·유사안건 재매칭)
  → 의결(resolve) → 결정(decision) → 집행(enact)
  → 바인딩이 numeric-policy config 반영 → sign 봉인
```

- **바인딩 추가**: gld 집행 바인딩에 `numeric-policy` 종을 추가(기존 6종에 +1). 의결→집행 시 config 를 반영하며, **비멱등 toggle 금지**·파기 제외(거버넌스 바인딩 패턴). 미배선 시 `BINDING_NOT_WIRED` 로 의결 거부(부팅은 되게·실패는 보이게).
- **카테고리**: 청구=재무(FIN)·검사=품질(QPS)·용량=안전(SAFE) 위원회로 라우팅. 안건에 before→after·근거·영향(AI assess) 첨부.

#### 충실한 로그 3층 + 서명 봉인

정책 변경은 **되돌릴 수 없는 append-only 기록**으로 남긴다:

1. **AuditLog** — 누가·언제·무엇을(도메인·키)·before→after. 변이는 기본 감사 ON.
2. **정책 변경 이력** `NumericPolicyChange`(신규 테이블) — 도메인·이전값·새값·근거·안건 링크(잠금은 GOV 번호)·집행 시각.
3. 🔴 **sign 해시체인 봉인** — 변경 스냅샷을 `sign-integration` 으로 봉인: `sha256(스냅샷)` → **`entryHash`·`prevHash` 체인 + TSA 앵커**(order-sign-log 와 동일 원장 패턴). 각 변경이 직전 변경과 해시로 연결돼 **소급 위변조를 탐지**한다. 잠금 정책 변경은 서명 **필수**(책임 귀속) — 청구·임상에 영향을 주는 변경이므로 서명자·시각이 원장에 남는다.

#### C. 초기 시스템 설정 (Setup)

- 설치/셋업 스크립트가 `NUMERIC_POLICIES` 기본값을 SystemConfig DEFAULTS 로 등재(미등재 시 관리 화면 미노출 규약).
- **최초 위원회 베이스라인 승인**: 초기 정책 세트 전체를 한 건의 GOV 안건("수치 정책 기준선 v1")으로 상정·의결·서명 봉인 → 이후 모든 변경은 이 **기준선 대비 diff** 로 추적된다. 초기 설정 시점에 표준(FHIR/UCUM/CLSI) 정렬 여부를 위원회가 확인·기록한다.

### 3.8 현재 적용 기준·표준의 명확한 표기 (투명성)

"지금 이 수치가 **어떤 기준·표준으로** 표시·계산되는가"를 언제나 확인할 수 있어야 한다.

- **관리 화면 '현재 기준' 컬럼**: 각 도메인의 현재 적용 정책(자릿수/유효숫자·반올림 모드·단위·표준 태그·LOINC/UCUM·마지막 변경 GOV/서명)을 한 줄로 노출. 기본값과 다르면(오버라이드) 배지 표시.
- **데이터 응답 메타**: 수치 응답에 정책 메타를 선택 동봉 —
  `{ value: 38.2, unit: '℃', policy: { decimals: 1, mode: 'round', standard: 'FHIR/UCUM', loincCode: '8310-5', ucumUnit: 'Cel' } }`. 소비처(외부 앱·리포트)가 표시 근거를 알 수 있다.
- **화면 표기**: `<Num>` 이 현재 정책을 `title`/`aria-label` 로 노출(예: "체온 · 소수 1자리 반올림 · FHIR/UCUM Cel"). 필요 화면은 표준 배지(FHIR·CLSI·건보법) 인라인 표시.
- **문서·인쇄물**: 검사 결과지·청구서 등 법적 출력물에는 적용 기준(유효숫자·반올림·근거 표준)을 각주로 명기 가능.

---

## 4. 도메인 카탈로그 (규칙표)

전 검토로 도출한 수치 도메인과 규칙 초안. 임상·청구 기준은 잠금.

| 도메인 | 자릿수 | 모드 | 단위 | 잠금 | 근거 |
|---|---|---|---|---|---|
| temperature 체온 | 1 | 반올림 | ℃ | | 임상 관행(요청 시 2자리) |
| bp/hr/spo2/rr 활력 | 0 | 반올림 | mmHg·bpm·%·/min | | 정수 측정 |
| weight 체중 | 1 | 반올림 | kg | | |
| height 신장 | 1 | 반올림 | cm | | |
| bmi | 1 | 반올림 | | | calcBmi 정본 |
| bsa 체표면적 | 2 | 반올림 | m² | 🔒 | 항암 용량 |
| labValue 검사수치 | 항목별 | 반올림 | 항목별 | 🔒 | reference-range 유효숫자 |
| money 금액 | 0 | 반올림 | 원 | 🔒 | 통화 최소단위 |
| copay 본인부담 | 0 | 버림(step10) | 원 | 🔒 | 건보법 시행령 10원 절사 |
| percent 백분율 | 1 | 반올림 | % | | |
| rate 증감률 | 1 | 반올림 | % | | +/- 부호 |
| age 나이 | 0 | 만나이 | 세 | 🔒 | ageOf(연월일) |
| ageMonths 개월 | 0 | 버림 | 개월 | 🔒 | 영유아 기준치 |
| stayDays 재원일 | 0 | 올림(min1) | 일 | 🔒 | 입원료 청구 |
| dose 용량 | 약물별 | 반올림/밴딩 | mg 등 | 🔒 | compounding 밴딩·상한 |
| incomeDecile 소득분위 | 0 | — | 분위 | 🔒 | NHIS 정수 |
| ewsScore/painScore | 0 | — | 점 | | 정수 척도 |
| 금액(만원 요약) | 0 | 반올림 | 만원 | | 대시보드 표기 |

(도메인별 임상·법령 근거는 각 정책의 `note` 에 인라인)

---

## 5. Phase 계획

| Phase | 범위 | 산출 |
|---|---|---|
| **P0** 레지스트리·정본 | `numeric-policy.ts`(shared·LOINC/UCUM/decimals/sigFigs 필드)+`roundBy`/`formatNum`+계약 테스트. 기존 정본(formatTemp·stayDays·calcBmi)을 레지스트리 참조로 리팩터(값 불변) | 중앙 정의·표준 정렬·회귀 0 |
| **P1** 공통 컴포넌트 | `<Num domain>` + Money/Unit/StayDays 재정의. useUiSettings 오버라이드 배선 | FE 표준 표시 부품 |
| **P2** 마이그레이션 | toFixed 81곳 → `<Num>`/`formatNum` 점진 치환(도메인 매핑·정확값 대조). 표시·저장·청구 노출 수치 우선 | 하드코딩 소진 |
| **P3** 관리 화면·config | `/admin/numeric-policy`(§3.4)+`ui.precision.*`·`ui.roundMode.*`·`ui.displayUnit.*` DEFAULTS 등재+미리보기+'현재 기준' 컬럼(§3.8). 잠금 정책 읽기전용·서버측 거부 | 운영 조정 가능 |
| **P3.5** 거버넌스·서명·초기설정 | 잠금 정책 변경을 gld 위원회 안건→의결→집행 바인딩(§3.7)+`NumericPolicyChange` 이력+**sign 해시체인 봉인**(sign-integration). 초기 셋업 시 기준선 seed+최초 위원회 승인 | 중앙 제어·변조불가 기록 |
| **P4** BE 저장·표준 출력 | 저장 반올림(활력·BMI·본인부담)을 `roundBy` 로 통일 + FHIR Observation.valueQuantity 가 정책 ucumUnit/decimals 사용 | 저장=표시=청구=FHIR 일치 |
| **P5** 단위 검증·변환 | `@lhncbc/ucum-lhc` 도입 — 관리 화면 UCUM 입력 검증·℉↔℃ 등 표준 변환(부동소수점 잔차 원천 차단) | 단위 표준 준수 |
| **P6** 가드 | 신규 toFixed/Math.round 직접 사용 차단 lint 규칙(표시·저장 경로 한정)·계약 테스트 | 재발 방지 |

---

## 6. 리스크·주의

- 🔴 **청구·검사·용량은 값이 바뀌면 실무 영향**(과오납·오판독·투약). 잠금 정책은 관리 화면에서 변경 불가로 고정하고, 변경은 코드+검토 게이트로만. "표시 정밀도 조정"과 "계산 반올림 변경"을 명확히 분리한다.
- **정확값 대조 필수**: toFixed 치환 시 기존 출력과 1:1 대조(오늘 재원일 축의 "정확 문자열 단언" 교훈). 부분 문자열 단언 금지.
- **통계·내부 계산의 Math.round(408곳 다수)는 대상 아님** — 표시·저장·청구에 노출되는 것만. 무분별 치환은 평균 왜곡(재원일 축의 LOS 평균 raw 유지 교훈).
- **하위호환**: 기존 `formatTemp`·`Money` 시그니처 유지(내부만 레지스트리 경유).
- **성능**: 레지스트리 조회는 O(1) 객체 접근, config 오버라이드는 useUiSettings 캐시.

---

## 7. 판정 기준 (완료 정의)

- [x] `numeric-policy.ts` 정본 + `roundBy`/`formatNum` 계약 테스트(도메인별 정확값)
- [ ] `<Num>` 컴포넌트 + Money/StayDays 재정의(회귀 0)
- [ ] "체온 소수 2자리" 를 config 한 줄로 전 화면 반영 시연(수용 기준 예시)
- [ ] 관리 화면에서 비잠금 도메인 정밀도 편집 + AuditLog + 이력 + **sign 봉인**(해시체인 검증)
- [ ] 잠금 정책(청구·검사·용량)은 관리 화면 직접 변경 차단 → **위원회 안건→의결→집행**으로만 반영
- [ ] 초기 셋업 시 기준선 seed + 최초 위원회 베이스라인 승인(GOV 봉인)
- [ ] '현재 기준' 표기 — 관리 화면 컬럼 + 응답 메타 + `<Num>` title/aria 로 적용 정책·표준 확인
- [ ] toFixed 표시 경로 마이그레이션(잔여는 점진 백로그)

---

## 8. HIS 초기 세팅 가이드라인 통합

수치 정책은 단발 기능이 아니라 **신규 병원 HIS 도입(초기 세팅)의 표준 절차**로 편입된다. 처음부터 표준 정렬 + 위원회 승인 + 서명 봉인으로 기준선을 세운다. 기존 초기 세팅·전환 레지스트리([[dev_simulation_registry]] `dev-simulation-production-switchover.md`)에 한 항목으로 등재한다.

### 8.1 초기 세팅 체크리스트 (Setup Checklist)

| # | 단계 | 산출/게이트 |
|---|---|---|
| 1 | **정책 기본값 seed** | `NUMERIC_POLICIES` 를 SystemConfig DEFAULTS 로 등재(`ui.precision.*`·`ui.roundMode.*`·`ui.displayUnit.*`). 미등재 시 관리 화면 미노출 규약 준수 |
| 2 | **표준 정렬 검증** | 활력=FHIR Vital Signs LOINC/UCUM 매핑 확인 · 검사=CLSI 유효숫자 · 단위=UCUM 코드 유효성(`@lhncbc/ucum-lhc`) |
| 3 | **기관·지역 특화 조정** | 통화(원·`[KRW]`)·언어 로케일(소수점·천단위 기호)·기관 관행 단위. 비잠금 도메인만 |
| 4 | **검사 항목별 유효숫자 큐레이션** | `reference-range` 마스터의 항목별 unit·정밀도(labValue 기본을 override) — 검사실·약제 협의 |
| 5 | **잠금 정책 확인** | 청구 원단위 절사(건보법)·재원일 청구산식·만나이·BSA 용량 — 법정·안전 기준 검증(변경 아님·확인) |
| 6 | 🔏 **최초 위원회 베이스라인 승인** | 초기 정책 세트 전체를 GOV 안건 "수치 정책 기준선 v1" 으로 상정→의결→**sign 봉인**. 이후 변경은 이 기준선 대비 diff |
| 7 | **현재 기준 표기 활성화** | 관리 화면 '현재 기준' 컬럼·응답 메타·`<Num>` title 노출 확인(투명성) |

### 8.2 개발 모드 → 실 운영 전환 시

- switchover 레지스트리에 **"수치 정책 기준선"** 항목 추가: 개발 모드는 seed 기본값으로 동작하고, 실 서비스 전 위원회가 기준선을 **재확인/supersede**(거버넌스 append-only 원칙).
- 표준 데이터(LOINC·UCUM·KCD-8·약가)는 실 표준이므로 정책 매핑은 그대로, **기관 특화 조정분만** 실값으로 확정.
- go-live 체크리스트(`go-live-checklist-security.md` 계열)에 "수치 정책 기준선 승인·서명 완료" 게이트 편입.

### 8.3 원칙

- **표준 우선**: 초기값은 임의 설정이 아니라 FHIR/UCUM/LOINC/CLSI 정렬값. 기관은 비잠금 도메인만 조정.
- **날조 금지 정합**: 기관 미정 항목(예: 특수 단위)은 시드 상태를 명시하고 실값 입력 전까지 표준 기본 유지(기존 `hospital.code` 플레이스홀더 원칙과 동일).
- **기준선은 서명된 기록**: 초기 세팅 완료 = "수치 정책 기준선 v1" 이 위원회 의결+sign 봉인된 상태. 감사·인증(JCI 등) 시 근거로 제시 가능.

---

## 부록 A. 수용 기준 예시 (사용자 요청 반영)

> "체온은 소수점 이하 2자리까지 반올림 처리한다"

1. 관리자가 `/admin/numeric-policy` → 활력·생체 탭 → 체온 자릿수를 `2` 로 변경(미리보기 `38.199→38.20` 확인)하고 저장(또는 `ui.precision.temperature=2`).
2. 저장 즉시 개요·바이탈 탭·진료 화면·간호 기록의 체온이 `38.20℃` 로 일괄 반영(공통 `<Num domain="temperature">` 경유).
3. BE 저장 반올림도 `roundBy(t,'temperature')` 로 2자리 정규화(신규 측정분). FHIR Observation 출력도 동일 정밀도.
4. 변경 이력은 감사 로그에 기록.

---

## 부록 B. 의료 표준 참조표 (도메인 ↔ LOINC/UCUM)

정책 레지스트리가 정렬하는 표준 코드. 관리 화면 '표준' 컬럼과 FHIR 출력의 근거.

| 도메인 | LOINC | UCUM(교환) | 표시 | 표준 근거 |
|---|---|---|---|---|
| 체온 temperature | 8310-5 | `Cel` | ℃ | FHIR Vital Signs |
| 심박수 heartRate | 8867-4 | `/min` | bpm | FHIR Vital Signs |
| 수축기혈압 | 8480-6 | `mm[Hg]` | mmHg | FHIR Vital Signs |
| 이완기혈압 | 8462-4 | `mm[Hg]` | mmHg | FHIR Vital Signs |
| SpO₂ | 59408-5 | `%` | % | FHIR Vital Signs |
| 호흡수 respRate | 9279-1 | `/min` | /min | FHIR Vital Signs |
| 체중 weight | 29463-7 | `kg` | kg | FHIR Vital Signs |
| 신장 height | 8302-2 | `cm` | cm | FHIR Vital Signs |
| BMI | 39156-5 | `kg/m2` | kg/m² | FHIR Vital Signs |
| 검사수치 lab | (항목별) | (항목별) | (항목별) | LOINC + CLSI 유효숫자 |

- **검사수치는 항목별 override**: reference-range 마스터의 loincCode·unit·정밀도를 우선(labValue 정책은 기본값). CLSI "소스 정밀도 유지·파생 3 유효숫자".
- **단위 변환**: `@lhncbc/ucum-lhc` 가 UCUM 코드 간 차원분석 변환(℉ `[degF]` → ℃ `Cel` 등)을 담당.

---

## 부록 C. 표준 출처 (Sources)

- UCUM / ucum-lhc: [LHNCBC/ucum-lhc (GitHub)](https://github.com/lhncbc/ucum-lhc) · [@lhncbc/ucum-lhc (npm)](https://www.npmjs.com/package/@lhncbc/ucum-lhc) · [UCUM-LHC (NLM)](https://ucum.nlm.nih.gov/ucum-lhc)
- FHIR Vital Signs / Body Temperature: [FHIR R4 Vital Signs](https://hl7.org/fhir/R4/observation-vitalsigns.html) · [US Core Body Temperature](https://www.hl7.org/fhir/us/core/StructureDefinition-us-core-body-temperature.html)
- openEHR DV_QUANTITY: [openEHR Data Structures IM](https://specifications.openehr.org/releases/RM/latest/data_structures.html)
- 검사 유효숫자/정밀도: [Significant figures (Acute Care Testing)](https://acutecaretesting.org/en/articles/significant-figures) · [CLSI EP15-A3 (Westgard)](https://westgard.com/essays/guest-essay/clsi-ep15a3.html)

---

## 9. P4 실행 결과 (2026-08-10 · "저장=표시=청구=FHIR 일치")

P4-a(활력 저장 `roundBy`)는 v3.96.0 창에서 종결됐고, 이번은 **P4-b = FHIR 출력 정합**.

### 9.1 정본 신설 — `packages/shared/src/fhir-quantity.ts`

- `fhirQuantity(value, { policyKey | unit })` · `toUcumCode(displayUnit)` · `ucumOf(policyKey)` · 계약 16건.
- 🔴 **규약: `system: 'http://unitsofmeasure.org'` 은 UCUM 을 확인했을 때만 붙인다.** 모르면 `unit`(사람이 읽는 표시)만 내보낸다. FHIR Quantity 는 unit 단독을 허용한다.
- 🔴 `policyKey` 없는 호출(외부 보고값)은 **재반올림하지 않는다** — LIS 가 보고한 검사값을 반올림하면 보고값 변조다. 정책 반올림은 HIS 가 산출하는 값(활력·BMI)에만 적용.
- 함정 2건을 정본에서 막았다: ①Prisma `Decimal` 객체를 그대로 받으면 참조범위가 **조용히 사라진다** → String 경유 수용 ②`Number('') === 0` 이라 빈 문자열이 **0 으로 둔갑** → 명시 차단.

### 9.2 봉합한 실결함

| # | 결함 | 영향 | 봉합 |
|---|------|------|------|
| 1 | 🔴 **활력징후 FHIR 미노출** — `Observation?category=vital-signs` 가 GCS·의식수준만 반환. 체온·혈압·맥박·SpO₂·호흡수·체중·신장·BMI 는 **0건** | 외부 SMART 앱·트윈이 "활력 기록 없음"으로 읽는다. 값 오류보다 **조용한 부재**가 위험 | `mapVitalsToObservations` 신설 — 외래(PreVisitVitals)·입원(FlowSheetEntry) 양 소스. LOINC·UCUM·정밀도 전부 `NUMERIC_POLICIES` 경유. 혈압은 프로파일대로 패널(85354-9)+component 2종, 통증은 survey(72514-3) |
| 2 | 🔴 **UCUM 허위 표기** — 검사 Observation 이 표시 단위를 `system=unitsofmeasure.org` 의 `code` 자리에 그대로 실어보냄 | `/μL`·`mmHg`·`IU/L`·`mEq/L`·`sec` 는 UCUM 코드가 **아니다**(공식 ucum-lhc 파싱 실패 실측 — 정본은 `/uL`·`mm[Hg]`·`[IU]/L`·`meq/L`·`s`). 외부가 파싱 실패하거나 다른 단위로 읽는다 — 위급값 격하 전달과 같은 계열 | `fhirQuantity` 경유. `referenceRange.low/high` 동일 적용 |
| 3 | **폼 응답 valueQuantity 오용** — `fhir-full` 이 FormSubmission 값을 종류 불문 `valueQuantity.value` 로 실음 | 선택지·서술·체크 응답이 들어가면 Quantity.value(decimal) 규격 위반 → 외부 파서가 리소스를 통째로 버린다 | 수치=Quantity·불리언=boolean·그 외=string 분기 |
| 4 | **`code=8480-6` 질의 무응답** — 혈압을 패널+component 로 내보내면 최상위 code 만 보는 필터에 안 걸림 | 표준 코드로 수축기혈압을 조회하는 외부 앱이 0건 | 필터가 `component.code` 까지 본다 |

### 9.3 결함 아님(실측 판정)

- **specialty-exam·pediatrics 의 `dto.bmi` 무검증 저장** — BMI 컬럼이 전부 `Decimal(4,1)` 이라 **DB 가 정책(소수1)을 강제**한다. 코드 반올림은 cosmetic → 치환하지 않음.
- `calcBmi` 만 레지스트리 경유로 수렴(`Math.round(x*10)/10` → `roundBy(x,'bmi')`, 값 동일). 정책 자릿수를 바꿔도 여기만 남는 드리프트를 차단.

### 9.4 ⏳ 사람 게이트 — 본인부담 산정 이원화 (금액=잠금 도메인, 코드 무변경)

`GET /billing/calculate/:encounterId`(수납 자동 계산 **미리보기**)와 실제 `Billing` 생성(`createFromEncounter`)이 **서로 다른 산식**이다.

| | 미리보기 `calculateBilling` | 실청구 `createFromEncounter` |
|---|---|---|
| 급여율 | 보험유형 단일율(config) | **라인별** `copayRate` |
| 의료급여 정액 | 없음 | 1·2종 외래 정액 적용 |
| 본인부담상한제 | 없음 | `applyCopayCap` 사전급여 |
| 원단위 절사 | **적용**(`billing.rounding`=10) | **미적용**(1원 단위) |

**운영 DB 실측(2026-08-10)**: 본인부담 있는 청구 81건 중 **31건(38%)이 10원 배수가 아님**(잔여 합계 131원·최대 9원). 즉 환자에게 보여준 견적보다 실제 청구가 최대 9원 높다.

🔴 **코드를 고치지 않았다** — `copay` 는 잠금(법정) 도메인이라 산식 변경은 §3.7 대로 **위원회 의결**로만 반영한다.

**→ 안건 상정 완료(2026-08-10)**: 운영위원회(OPS) · 안건 `3fcdebe3-159e-4603-88d8-5e8c02d40af3` · status=SUBMITTED · AI 영향평가 첨부(바인딩 제안 `CONFIG_CHANGE`/`billing.rounding`). 사전검토상 유사 안건 없음. 판단 필요 항목:
1. 국민건강보험법 시행령상 10원 미만 절사를 **실청구**에도 적용할 것인가(적용 시 소급 범위 포함)
2. 아니면 미리보기의 절사를 제거해 실청구와 맞출 것인가
3. 미리보기가 의료급여 정액·상한제를 반영하지 않는 것(=취약계층 견적이 실제와 더 크게 벌어짐)의 처리

### 9.5 P5·P6 — 재발 방지 가드 (2026-08-10)

- **P5 UCUM 기계 검증**: `@lhncbc/ucum-lhc`(NLM/LHNCBC 공식 구현) **devDependency** 도입 — 런타임 의존성이 아니라 계약 테스트 전용이라 배포·번들 영향 0. `UCUM_BY_DISPLAY` 전량 + `NUMERIC_POLICIES[*].ucumUnit` 전량을 전수 파싱 검증한다. 손으로 적은 표는 대소문자·대괄호 오타를 눈으로 못 잡는다(`[IU]`·`mm[Hg]`·`meq/L`).
- 🔎 **실측이 가정을 뒤집은 건 1개**: `10^3/uL` 은 **유효한 UCUM 이다**(UCUM 은 지수 표기로 `10*` 와 `10^` 를 모두 허용). "표시형이면 UCUM 이 아니다"는 틀렸다 — 그래서 검증을 사람 눈이 아니라 공식 파서에 맡긴 것이다. 대응표는 정규형 `10*3/uL` 로 계속 보낸다(외부 구현별 편차 축소).
- **P6 구조 가드**: `apps/api/test/architecture/numeric-format-guard.spec.ts` — `toFixed` **기준선 동결**(52파일 95건). 신규 파일·증가분은 실패, 치환으로 줄면 기준선을 낮추라고 알린다. 전면 금지가 아닌 이유 = 잔여 대부분이 통계·경고 문자열이고 무분별 치환은 평균을 왜곡한다(§6). `Math.round`(408곳)는 같은 이유로 전면 스캔 대상이 아니다. 프로브 파일로 실차단 역검증 완료.
