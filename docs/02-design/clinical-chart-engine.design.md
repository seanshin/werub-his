# 임상차트 엔진 설계 (Clinical Chart Engine)

> 작성: 2026-06-30 / 상태: Design v1.0
> 상위 기획: `docs/01-plan/features/chart-template-expansion.plan.md` Track 5
> 콘텐츠 원천: `clinical-charts/` 17문서 ~80종 / 정의 계층: `13_차트_템플릿_정의서`(공통골격 ①~⑧·4 아키타입)

## 1. 목표

데이터 주도(코드 정의 + 멱등) **4 아키타입 임상차트 엔진**을 구축한다. 현재 `ChartRenderer.ScoreCalculatorField`의 Scoring 7종 하드코딩(`getScoreLevel` if-체인)을 일반화하고, Lookup/Formula/(Tree)로 확장하며, SaMD 추적성·책임귀속·양성플래그 알림을 공통화한다.

## 2. 아키타입 4종 (입력 → 판정 → 권고)

| 아키타입 | 입력 | 판정 | 예 |
|----------|------|------|-----|
| **Scoring** | 항목별 선택지 점수 | 합산 → 밴드(구간) | NEWS2·GCS·NIHSS·CHA₂DS₂-VASc·PHQ-9·CURB-65 |
| **Lookup** | 단일/다중 소견 선택 | 카테고리 직접 매핑 | BI-RADS·Bosniak·NYHA·Killip·욕창단계·Garden |
| **Formula** | 변수 수치 입력 | 화이트리스트 수식 계산 | BSA·Cockcroft-Gault·Calvert·MELD·Naegele |
| **Tree** | 계층 선택 | 하위 구성 전개 | 항암 레지멘 (후속) |

## 3. 데이터 모델 (정의 = 코드, 결과 = DB)

### 3.1 공통 메타 (SaMD 봉투)
```ts
interface ClinicalChartMeta {
  chartId: string;            // 'NEWS2', 'BIRADS', 'CALVERT'
  name: string;               // 한글명
  category: string;           // '응급'|'신경'|'영상'|'종양' ...
  archetype: 'scoring' | 'lookup' | 'formula' | 'tree';
  sourceGuideline: string;    // 'RCP NEWS2', 'ACR BI-RADS'
  sourceVersion: string;      // '2017', '5th ed'
  verified: boolean;          // 공식 원문 대조 완료 여부 (초기 false)
  scope?: string;             // 적용 대상/부위
  note?: string;              // 해석 주의
}
```
> 모든 차트 판정 UI에 **"보조도구 · 최종 임상판단은 의사 귀속"** 표기, `verified:false` 면 **"미검증 참조용"** 배지.

### 3.2 아키타입별 정의 (요약)
```ts
// Scoring
interface ScoringDef extends ClinicalChartMeta {
  archetype: 'scoring';
  categories: { key: string; label: string; options: { label: string; score: number }[] }[];
  bands: { min: number; max: number; label: string; level: Risk; recommendation?: string }[];
  range: string;              // '0-20' 표시용
}
// Lookup
interface LookupDef extends ClinicalChartMeta {
  archetype: 'lookup';
  options: { code: string; label: string; level: Risk; attribute?: string; recommendation?: string }[];
}
// Formula
interface FormulaDef extends ClinicalChartMeta {
  archetype: 'formula';
  variables: { key: string; label: string; unit?: string; min?: number; max?: number }[];
  expr: string;               // 화이트리스트 수식 (예: 'sqrt(height*weight/3600)')
  resultUnit?: string;
  bands?: { min: number; max: number; label: string; level: Risk }[]; // 선택
  constraints?: string[];
}
type Risk = 'normal' | 'low' | 'moderate' | 'high' | 'critical';
```

### 3.3 결과 영속 (후속 증분 — 신규 Prisma)
```prisma
model ClinicalChartResult {
  id String @id @default(uuid()) @db.Uuid
  patientId String; encounterId String?
  chartId String; chartVersion String
  inputs Json; result Json; recommendation String?
  performedBy String; signedAt DateTime?; usedToolVersion String
  createdAt DateTime @default(now())
}
```
> db push 차단 환경 → manual SQL + 서버 prisma generate. **1차 증분에서는 미포함**(엔진·콘텐츠·계산기 UI 먼저, 영속은 차트 결선 시).

## 4. 엔진 (순수 함수, 클라이언트 계산)

```
computeScoring(def, selections: Record<key, score>) → { total, band }
evaluateLookup(def, code) → { option }
computeFormula(def, vars: Record<key, number>) → { value, band? }
```
- **Formula 안전**: `eval` 금지. 화이트리스트 파서 — 토큰(숫자·변수·`+ - * / ( )`·함수 `sqrt|min|max|round|ln`)만 허용. 미허용 토큰 → throw. 0-division·NaN 가드.
- 양성플래그: 정의에 `alertWhen`(band.level==='critical' 또는 chartId별 규칙, 예 PHQ-9 9번>0) → 호출측이 알림 워크플로 연계.

## 5. 저장 위치 & 통합

- **1차**: `apps/web/src/lib/clinical-charts/`(types·engine·definitions·registry) — 클라이언트 계산. BE 결과검증 필요 시 `@hospital-run/shared`로 승격.
- **통합 지점(증분 순)**:
  1. (이번) 독립 **임상도구 페이지** `/clinical-tools` — 목록 + 실행(계산기). 사이드바 진입.
  2. 편집기 `score-calculator` 필드 `calculator` 옵션을 레지스트리 전체로 확장 + `clinical-lookup`/`clinical-formula` 팔레트(Track 2-A 합류).
  3. 영상 RADS → ImagingTab/판독 보조(Lookup 위젯, PACS 링크 규칙 준수).
  4. 결과 영속(`ClinicalChartResult`) + encounter 결선 + SaMD 감사.
- **기존 모델 병행(✅결정)**: NEWS2/Morse/Braden 등은 `EarlyWarningScore`·`FallRiskAssessment` 유지. 신규 엔진은 **참조 계산기**로 제공, 정의에 `existingModel` 표기해 이중기록 혼선 방지.

## 6. 단계 (증분)

| 증분 | 내용 |
|------|------|
| **1 (이번)** | 타입·엔진(Scoring+Lookup+Formula) + Scoring 콘텐츠 ~20종 + /clinical-tools 계산기 + SaMD UI |
| 2 | Lookup 콘텐츠(RADS·분류 ~35) + 영상 연계 |
| 3 | Formula 콘텐츠(~8) + 변수 입력 UI |
| 4 | 결과 영속(ClinicalChartResult) + 편집기 필드 통합 + encounter 결선 |
| 5 | Tree(항암 레지멘) + 처방 결선 |

## 7. 검증·안전

- 엔진 순수함수 단위검증(합산·밴드 경계·수식 0division/허용토큰).
- 전 콘텐츠 `verified:false` 시작 → 임상검수 후 true. UI 배지로 미검증 명시.
- 환자안전 플래그(critical 밴드·자살문항·위급치) → 알림 연계(후속).
- tsc strict. 운영 렌더 대조.
