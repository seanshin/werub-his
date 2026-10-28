# 차트 템플릿 편집·의료차트 확대 기획 (PDCA Plan)

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/web/src/lib/clinical-charts/engine.ts · apps/web/src/lib/clinical-charts/types.ts · apps/web/src/lib/clinical-charts/definitions/ · 잔여: 콘텐츠 임상 검증(사람)

> 작성: 2026-06-30 / 상태: Plan v2.0 (보강: 임상 차트/점수/계산기 라이브러리 — `clinical-charts` 17문서 ~80종 탑재)
> 한 줄: 이미 존재하는 **리치 차트 템플릿 시스템(ChartTemplate + chart-editor + ChartRenderer)** 을 기반으로, ① 전문과 템플릿 확충 ② 편집기 기능 강화 ③ 구형/신형 이중 시스템 통합 ④ 필드정합 전수 검증 + **⑤ 임상 차트/점수/계산기 엔진·콘텐츠 라이브러리 탑재(4 아키타입·SaMD 추적성)** 의 5개 트랙을 단계적으로 수행한다.
>
> **핵심**: "의료차트 확대"의 콘텐츠 원천은 `~/Downloads/clinical-charts/`(00~16, 17문서)이며, `13_차트_템플릿_정의서`의 공통 골격(①~⑧)·4 아키타입(lookup/scoring/tree/formula)을 정의 계층으로 삼는다. 현재 시스템엔 **Scoring 엔진(7종)만 FE 하드코딩**되어 있어, 이를 **데이터 주도 4-아키타입 엔진**으로 일반화하고 콘텐츠를 라이브러리화하는 것이 본 확대의 중심이다.

---

## 1. 배경·현황 (코드 grounded)

차트/템플릿 자산은 **이미 상당히 구축**되어 있다. 이 기획은 신규 구축이 아니라 **확충·정합·통합**이다.

### 1.1 템플릿 시스템 — 두 갈래 병존

| 시스템 | 모델 | 편집 UI | 렌더 | API | 상태 |
|--------|------|---------|------|-----|------|
| **ChartTemplate** (리치, 정식) | `ChartTemplate` · `ChartTemplateVersion` · `UserChartPreference` | `/admin/chart-editor` — `EditorView.tsx`(851줄) + `TemplateListView.tsx`(276줄) | `components/chart/ChartRenderer.tsx`(1417줄, 25종 필드) | `chart-templates` 15라우트(presets·for-me·recommend·versions·rollback·personalize·clone) | **정식**. 사이드바 「차트 에디터」 등록 |
| **EncounterTemplate** (구형, 단순) | `EncounterTemplate` | `/admin/encounter-templates` — 원시 JSON textarea | (진료화면 인라인, 실사용 안 됨) | `encounter-templates` CRUD 4종 | **사실상 고아** |

### 1.2 진료 작성 화면 — 두 갈래 병존

| 화면 | 경로 | 렌더 | 진입 |
|------|------|------|------|
| **신형 (정식)** | `patients/[id]/encounter/new/page.tsx` | `ChartRenderer`(25종 필드) + **16개 전문과 전용 레이아웃** | clinic-queue·schedule·dashboard·inpatient·환자헤더·EncounterHistory 전부 여기로 라우팅 |
| **구형 (레거시)** | `encounters/[appointmentId]/page.tsx`(485줄) | 인라인 단순 렌더(필드 ~8종 폴백) | 직접 라우팅 거의 없음 |

### 1.3 전문과 자산 커버리지 (3계층의 불일치)

- **전문과 전용 레이아웃 (16종)**: 내과·외과·소아·산부인과·정형외과·신경외과·안과·정신·피부·이비인후·재활·성형·비뇨·치과·응급·가정의학
- **차트 탭 (~35종)**: 위 + 신장(투석)·혈액은행·방사선종양·치료이력 등
- **chart-template 프리셋 (12종)**: 내과·외과·소아·산부인과·정형외과·정신·응급·진단검사·간호(2)·ICU·blank
- **→ 갭**: 프리셋이 없는 전문과 = 안과·이비인후과·피부과·신경외과·비뇨의학과·치과·재활·성형·가정의학·신장(투석)·혈액은행·방사선종양. 레이아웃·탭은 있는데 **편집 가능한 템플릿 프리셋은 부재**.

### 1.4 알려진 함정 (기록 기반)

- 🔴 **전문과 차트 필드정합 버그 class**: `getExams`류 BE가 raw Prisma 모델 반환 ↔ FE가 잘못된 필드명 참조 → 임상값 `-`/`[object Object]`/`Invalid Date`/탭 크래시. PR#108·109·137로 다수 교정(2026-06-29 기준 26~36탭 CLEAN)했으나 **신규 탭/시드마다 재발**. 교훈: BE만 보지 말고 **운영 응답 직접 대조** 필수.
- **팔레트 ↔ 렌더러 타입 불일치**: `shared.ts` PALETTE는 23종, `ChartRenderer`는 25종. `procedure-search`가 렌더러엔 있으나 팔레트엔 없어 **편집기로 추가 불가**.
- **에디터 정렬**: 섹션/필드 순서변경이 ▲▼ 버튼식(드래그 없음). RGL은 React 19 비호환 → `@dnd-kit` 사용해야 함(선례 있음).
- **마이그레이션 차단**: `prisma db push` 드리프트 환경 → 신규 컬럼은 manual SQL + 서버 `prisma generate` 절차 필수.

---

## 2. 목표·비목표

**목표**
1. 프리셋 없는 전문과에 **표준 차트 템플릿 프리셋 확충**(레이아웃·탭과 1:1 정합).
2. **편집기 기능 강화** — 팔레트↔렌더러 동기화, 드래그 정렬, 조건부 필드(분기 로직).
3. **이중 시스템 통합** — 구형 `EncounterTemplate`/`encounters/[appointmentId]` 제거 또는 신형으로 일원화.
4. **필드정합 전수 검증** — 전 전문과 탭 BE↔FE를 운영 응답 대조로 감사·교정.

**비목표**
- 새 임상 도메인 모델 신설(필요 최소화). 기존 `ChartTemplate.sections` JsonB 활용.
- 타블렛 셸(별도 기획 완료), 검진 프로토콜(별도) 변경.
- FHIR/openEHR 외부 연동 스키마 변경(매핑 메타만 유지).

---

## 3. 트랙별 기획

### Track 1 — 전문과 템플릿 확충

**대상**: 1.3의 갭 전문과 12종. 각 전문과에 대해 차트 탭(`{Dept}Tab.tsx`)의 실제 필드 + 전용 레이아웃(`{Dept}EncounterLayout.tsx`)의 SOAP 구조를 소스로 삼아 **프리셋 정의 추가**.

**방식**:
- `chart-template.service.ts`의 `PRESETS` 레코드에 키 추가(예: `ophthalmology`, `ent`, `dermatology`, `neurosurgery`, `urology`, `dental`, `rehab`, `plastic`, `family-medicine`, `dialysis`).
- 각 프리셋 = `{ name, department, role, category, layout, sections[] }`. 섹션 필드는 **렌더러 지원 25종 내에서만** 구성(미지원 타입 금지).
- 진단코드→진료과 매핑(`DIAGNOSIS_DEPT_MAP`)에 누락 전문과 보강(H=안과 이미 존재, L=피부과 존재 — 확인 후 정합).
- 멱등 시드 스크립트(기존 `from-preset` 활용 or seed) — 운영 DB에 표준 템플릿 1건씩 생성.

**검증**: `/admin/chart-editor`에서 각 프리셋 렌더 → `/patients/[id]/encounter/new`에서 해당 과 환자로 템플릿 선택 → ChartRenderer 정상 렌더 + SOAP 매핑 동작.

**산출**: BE PRESETS 추가 + (선택)시드. FE 변경 0(에디터·렌더러 재사용).

### Track 2 — 편집기 기능 강화

**2-A. 팔레트↔렌더러 동기화 (P0, 저위험)**
- `shared.ts` PALETTE에 `procedure-search` 추가(의료 카테고리). 렌더러와 `FieldType` 유니온 대조해 누락 0 확인.
- `FieldPropertiesPanel`에 `procedure-search`용 속성(codeSystem 등) 노출.

**2-B. 드래그 정렬 (P1)**
- 섹션·필드 순서변경을 `@dnd-kit`로 전환(현 ▲▼ 버튼 유지하며 보강 또는 대체). React 19 호환 필수.

**2-C. 조건부 필드 / 분기 로직 (P2, 스키마 무변경)**
- `FieldDef`에 `showWhen?: { fieldId, op, value }` 옵션(JsonB 내부라 마이그레이션 불요).
- ChartRenderer가 `showWhen` 평가해 조건부 표시. 에디터 속성패널에 조건 빌더 추가.
- 예: "임신 여부=예"일 때만 "임신주수" 표시.

**검증**: 에디터에서 신규 기능 조작 → 저장 → ChartRenderer 반영 확인. tsc strict + 운영 렌더 대조.

### Track 3 — 이중 시스템 통합

**3-A. EncounterTemplate(구형) 정리**
- 현황: `/admin/encounter-templates` 페이지 + `EncounterTemplateModule`만 참조. 실 진료 렌더에 미사용.
- 방안: ① 기존 `EncounterTemplate` 데이터를 `ChartTemplate`(sections 변환)로 마이그레이션 → ② `/admin/encounter-templates`를 `/admin/chart-editor`로 리다이렉트 → ③ 모듈/페이지 deprecate(삭제는 데이터 이관·검증 후).
- **삭제 전 확인**: 운영 DB `encounter_templates` 행 수·실사용 여부(0이면 단순 제거).

**3-B. 구형 진료화면 `encounters/[appointmentId]` 정리**
- 현황: 신형 `encounter/new`가 정식. 구형은 직접 라우팅 거의 없음.
- 방안: 잔존 진입점 확인 → 신형으로 리다이렉트 → 구형 페이지 deprecate.
- **주의**: 기능 삭제 방지 체크(페이지 240+·모듈 132+) — 구형에만 있는 기능 없는지 대조 후 제거.

**검증**: 모든 진료 진입 경로가 신형으로 수렴. 구형 URL 리다이렉트 200. 데이터 손실 0.

### Track 4 — 필드정합 전수 검증

**대상**: 차트 탭 ~35종 전부(특히 전문과 exam 탭).

**방식** (기록의 PR#108/109/137 패턴 재현):
- 병렬 Explore 에이전트로 각 탭의 BE `getExams`류 반환 필드 ↔ FE 참조 필드명 대조.
- **운영 응답 직접 대조**(BE 코드만 보고 판단 금지 — admitDate vs admissionDate류 재발 방지).
- 발견 버그 class: ① 필드명 불일치(`-`/`[object Object]`) ② JsonB raw 렌더(포맷터 누락) ③ 날짜 Invalid Date 크래시 ④ 카운트↔필터↔빈상태 불일치(백지) ⑤ 동적 Tailwind 클래스(JIT 미emit).
- 발견 즉시 교정 PR(소규모 일괄).

**검증**: 시드 환자(800명+ dept-richness)로 전 탭 렌더 → blank/오류 0건 스캔.

### Track 5 — 임상 차트/점수/계산기 엔진 + 콘텐츠 라이브러리 (★ 의료차트 확대의 중심)

**콘텐츠 원천**: `clinical-charts/` 17문서, ~80종 차트. `13_차트_템플릿_정의서`의 공통 골격(①차트메타 ②환자식별 ③입력 ④판정 ⑤권고 ⑥소견 ⑦서명/책임 ⑧감사)과 4 아키타입을 정의 계층으로 사용.

**현황 갭 (코드 grounded)**:
- 현재 `ChartRenderer.tsx`의 `ScoreCalculatorField`는 **Scoring 아키타입 전용 제네릭 엔진**(`SCORE_DEFINITIONS`: category→options→score 합산 + `getScoreLevel` 밴드).
- **딱 7종**(GCS·NEWS·MORSE·BRADEN_SCALE·SOFA·APACHE_II·GAF), 전부 **FE 하드코딩**. `getScoreLevel`은 if-체인이라 신규 차트 추가 시 코드 수정 필요(데이터 주도 아님).
- **Lookup/Formula/Tree 엔진 부재**. BE 모델/모듈 부재(임상점수가 전부 FE 내장). SaMD 추적성(source·verified·책임귀속) 부재.
- 기존 도메인 모델(`EarlyWarningScore`·`FallRiskAssessment`·`bradenScore`·`apacheScore`·GCS 컬럼 등)은 **개별 산재** — 통합 엔진과 별개.

**5-A. 엔진 일반화 (4 아키타입)**
- `getScoreLevel` if-체인 → **`bands[]` 데이터 주도**(SCORE_DEFINITIONS에 `bands:[{range,label,color,recommendation}]` 추가). 신규 Scoring 차트는 데이터만 추가.
- **Lookup 엔진** 신규: `input(single_select) → category → {attribute, recommendation}`. RADS·분류 전체 커버. ChartRenderer에 `clinical-lookup` 필드타입 + 팔레트 추가.
- **Formula 엔진** 신규: `variables[] → formula → {value, unit}`. **화이트리스트 수식 평가**(eval 금지 — 사칙연산·√·조건 파서). BSA(Mosteller)·Cockcroft-Gault·Calvert·MELD·Naegele·Z-score. `clinical-formula` 필드타입.
- **Tree 엔진**: 항암 레지멘은 별도 복잡도(주기·약물라인·전처치) → **본 트랙은 정의·뷰어까지**, 처방 결선은 후속(처방/오더 모듈 연계).

**5-B. 콘텐츠 라이브러리 + 데이터 모델 (✅결정 반영)**
- **저장소 = 정적 TS 정의 + 멱등 시드** (마이그레이션 회피·git 버전관리). 차트 정의는 `packages/shared` 또는 BE `clinical-charts/definitions/*.ts`에 archetype별 타입안전 정의 → 멱등 시드로 운영 노출. 관리자 런타임 편집은 후속(정의서는 임상검수 대상이라 코드 관리가 적합).
- 정의 스키마(공통): `{ chartId, name, archetype, sourceGuideline, sourceVersion, verified, scope, definition }`. archetype별 `definition` = Scoring(categories+bands) / Lookup(options+recommendation) / Formula(variables+formula+constraints) / Tree(regimen).
- **차트 작성/판정 결과 영속화**: `ClinicalChartResult`(patientId·encounterId·chartId·chartVersion·inputs·result·recommendation·performedBy·signedAt·usedToolVersion). 결과는 영속 필요 → **이 모델만 신규 Prisma**(manual SQL+generate 절차). 정의는 코드, 결과는 DB로 분리.
- **콘텐츠 입력**: 17문서 표 → archetype별 input/result/recommendation 변환(§8 인벤토리, ~80종 전체). 각 차트 `sourceGuideline·sourceVersion` 기입, `verified:false` 초기값(공식 원문 대조 전).

**5-C. SaMD/규제 안전장치 (필수)**
- 모든 임상 차트 판정에 **"최종 임상판단은 의사에게 귀속(보조도구)"** 표기(공통 골격 ⑦).
- `source_guideline·source_version` 추적성 + `used_tool_version` 감사(⑧).
- `verified` 플래그 — false면 UI에 "미검증 참조용" 배지. 운영 노출 전 검증 게이트.
- 자살위험(PHQ-9 9번·C-SSRS)·위급치(Critical value)·NEWS2 고위험 등 **양성 플래그 → 알림/안전 워크플로 연계**(기록의 위급값·EWS 알림 패턴 재사용).

**5-D. 결선 지점 (기존 자산 연계)**
- **편집기**: `score-calculator` 필드의 `calculator` 옵션을 라이브러리 전체로 확장 + `clinical-lookup`/`clinical-formula` 팔레트 추가(Track 2-A와 합류).
- **PACS/영상 탭**: RADS 계열(BI/LI/PI/Lung/O/CAD-RADS·Bosniak·TI-RADS·Fleischner·AAST·TICI 등)은 `ImagingTab`/판독 화면에 Lookup 위젯으로 노출(PACS는 링크만 — CLAUDE.md 규칙 준수, HIS 측 판독 보조 UI만).
- **간호/입원**: NEWS2·Morse·Braden·RASS·CAM-ICU → 기존 `EarlyWarningScore`/`FallRiskAssessment` 모델과 **병행(✅결정)**. 기존 모델은 유지, 신규 엔진은 **기존 모델이 없는 차트만** 담당. 중복 차트는 기존 모델로 라우팅(이중기록 방지) — 정의에 `existingModel` 플래그로 표시, 신규 엔진에서 제외하거나 기존 산재모델 입력 UI로 위임.
- **전문과 프리셋(Track 1)**: 각 과 프리셋에 해당 임상차트 필드 삽입(예: 정신과=PHQ-9·GAD-7·MMSE, 신장내과=KDIGO, 종양내과=ECOG·CTCAE·RECIST, 호흡기=GOLD·mMRC·CAT).

**검증**: 각 아키타입 대표 차트 1종씩 엔진 동작(입력→판정→권고) E2E. 수식 화이트리스트 평가 단위테스트(잘못된 입력·0 division). SaMD 표기·verified 배지 렌더 확인.

**산출**: BE 엔진/모델/시드 + FE 필드타입 3종(lookup/formula + scoring 일반화) + 콘텐츠 라이브러리. 규모상 **단계 세분 필요**(아래 §4 Phase 6~8).

---

## 4. 우선순위·단계

| 순서 | 트랙 | 위험 | 산출 |
|------|------|------|------|
| Phase 1 | **Track 4** 필드정합 전수 검증 | 저(읽기 중심) | 감사 리포트 + 소규모 교정 PR. 확충 전 기반 정합 확보 |
| Phase 2 | **Track 2-A** 팔레트 동기화 | 저 | 편집기 누락 필드타입 0 |
| Phase 3 | **Track 5-A** 엔진 일반화 — Scoring 데이터주도(`bands[]`) | 저~중 | getScoreLevel 제거, 신규 Scoring=데이터만 |
| Phase 4 | **Track 5-B** 콘텐츠 라이브러리 1차 — Scoring ~30종 + SaMD 골격(5-C) | 중 | NEWS2·NIHSS·CHA₂DS₂-VASc·CURB-65·PHQ-9·GAD-7·MMSE 등 + 추적성/책임귀속 |
| Phase 5 | **Track 5-A** Lookup 엔진 + RADS/분류 ~35종 | 중 | 영상 RADS·골절/척추 분류·NYHA·Killip·욕창단계 등 |
| Phase 6 | **Track 5-A** Formula 엔진(화이트리스트) + ~8종 | 중 | BSA·Cockcroft-Gault·Calvert·MELD·Naegele·Z-score |
| Phase 7 | **Track 1** 전문과 프리셋 확충 + 임상차트 삽입(5-D) | 중 | 프리셋 12종 + 과별 임상차트 결선 |
| Phase 8 | **Track 2-B/C** 드래그·조건부 필드 | 중 | 에디터 고도화 |
| Phase 9 | **Track 3** 이중 시스템 통합 | 중(데이터 이관) | 구형 제거·일원화 |
| 후속 | **Track 5** Tree(항암 레지멘) 처방 결선·영상탭 RADS 위젯·기존 EWS 모델 이행 | 고 | 별도 기획 |

> Phase 1 선행: 정합이 깨진 상태에서 확충하면 버그 증식. 기반부터 검증.
> Track 5를 Track 1보다 앞: 전문과 프리셋(Track 1)이 임상차트 필드를 참조하므로 엔진·라이브러리가 선행돼야 함.

## 5. 리스크·완충

| 리스크 | 완충 |
|--------|------|
| 신규 컬럼(조건부 필드 등) 마이그레이션 차단 | `showWhen`은 sections JsonB 내부 → 스키마 무변경. 불가피 시 manual SQL + 서버 prisma generate |
| 구형 제거 시 숨은 기능 소실 | 기능 삭제 방지 체크리스트 — 구형 단독 기능 대조 후 제거, 데이터 이관 선행 |
| 필드정합 BE만 보고 오판 | 운영 응답 직접 대조(기록 교훈) |
| 팔레트↔렌더러 재드리프트 | `FieldType` 유니온 단일 소스화, tsc로 누락 컴파일 에러화 검토 |
| **임상 수치 부정확/구버전 (환자안전)** | 모든 차트 `verified:false` 초기 + "미검증 참조용" 배지. 운영 노출 전 공식 원문(ACR·RECIST·KDIGO·식약처 등) 대조 검증 게이트. `source_version` 추적 |
| **Formula 임의코드 실행** | eval 금지 — 화이트리스트 수식 파서(사칙·√·조건만). 단위테스트로 0-division·범위 검증 |
| **SaMD/의료기기 규제** | 보조도구 명시·최종판단 의사귀속 표기·추적성(source/tool version)·감사. 자동 처방/진단 단정 금지(권고 제시까지) |
| **임상차트 ↔ 기존 모델 중복** | NEWS2/Morse/Braden 등은 EarlyWarningScore·FallRiskAssessment와 충돌 가능 → 설계 시 이행 vs 병행 명시, 이중기록 방지 |

## 6. 검증 공통 원칙

- tsc strict 선통과 ≠ 동작. **운영 응답·렌더 직접 대조** 필수.
- 시드는 추가·멱등(메인 seed 비파괴).
- BE 수정 후 `nest build`. 신규 모델 시 서버 `prisma generate`.
- 배포는 worktree rsync(미커밋도 배포됨) — 격리 주의.

## 7. 오픈 이슈

**✅ 확정(2026-06-30)**
- **임상차트 저장소** = 정적 TS 정의 + 멱등 시드. 정의는 코드(git), 판정 결과(`ClinicalChartResult`)만 신규 Prisma.
- **콘텐츠 범위** = ~80종 전체(§8 인벤토리 전부). 단 `verified:false` 시작 → 검증 게이트 후 운영 노출.
- **기존 점수 모델** = 병행. 기존 EWS/낙상 등은 유지, 신규 엔진은 미보유 차트만 담당(중복 라우팅·이중기록 방지).

**미결(설계 단계에서 확정)**
1. 구형 `EncounterTemplate`/`encounters/[appointmentId]` — 즉시 제거 vs 리다이렉트 유지? (운영 데이터 행 수 확인 후)
2. 전문과 프리셋 확충 — 갭 12종 전부 vs 우선순위 과부터?
3. 드래그 정렬 — 기존 ▲▼ 대체 vs 병행?
4. 조건부 필드 — 이번 범위 포함 vs 후속?
5. **콘텐츠 검증 책임** — `verified` 플래그를 누가 채우나(임상 검수 주체)? 미검증 차트 운영 노출 정책? (환자안전 직결 — 임상 책임자 지정 필요)
6. **아키타입 진행 순서** — Scoring→Lookup→Formula(현 §4 안) vs RADS(Lookup) 우선(PACS 판독 보조 수요 시)?
7. `ClinicalChartResult` 결과를 encounter.sections 포함 vs 독립 모델 단독?

---

## 8. 부록 — 임상 차트 인벤토리 (clinical-charts 17문서)

| 문서 | 주 아키타입 | 차트(요약) |
|------|------------|-----------|
| 01 종양·항암 | Tree+Scoring+Formula | 레지멘(FOLFOX 등)·ECOG·KPS·CTCAE·항구토위험·Cockcroft-Gault·Calvert·BSA·용량조절·누적용량·RECIST·TNM |
| 02 영상판독 | Lookup | BI/LI/PI/Lung/O-RADS·Fleischner·TI-RADS·Bosniak·ASPECTS·(NI/C/CAD-RADS) |
| 03 일반점수 | Scoring | NEWS2·GCS·통증척도(NRS/VAS/FACES/FLACC)·Morse·Braden·CAM-ICU |
| 04 약물·검사 | Lookup+Formula | 신/간기능 용량보정·Child-Pugh·TDM 범위·Critical value·DDI |
| 05 영상추가(근골격) | Lookup | Garden·Weber·Salter-Harris·Neer·AO·Kellgren-Lawrence·Pfirrmann·Modic·Meyerding·Agatston·CAD-RADS·HU |
| 06 중증도·위험 | Scoring+Lookup | CHA₂DS₂-VASc·HAS-BLED·NYHA·Killip·Wells·qSOFA·SOFA·SIRS·CURB-65·NIHSS·mRS·Hunt-Hess·RASS·MELD·Blatchford·Rockall·Ranson·Ottawa·ISS·APGAR·Bishop·Barthel·Beers |
| 07 중환자·마취 | Scoring+Lookup | APACHE II·ASA·Mallampati·Aldrete |
| 08 내분비·혈액·류마티스 | Lookup+Scoring | 당뇨진단·DKA/HHS·BMI·4Ts·DIC·RA(ACR/EULAR)·DAS28 |
| 09 화상·창상·피부 | Formula+Lookup | 9의법칙·Lund-Browder·화상깊이·욕창단계(NPUAP)·Bristol |
| 10 정신과·인지 | Scoring | PHQ-9·GAD-7·MMSE·MoCA·AUDIT·CAGE·C-SSRS(참고) |
| 11 소아·산과·노인 | Formula+Scoring | 성장 Z-score·소아GCS·Tanner·Naegele(EDD)·GA·Lawton IADL·Clinical Frailty·Mini-Cog |
| 12 영상외상 | Lookup | AAST(간·비장·신장)·Tile·Schatzker·TIMI |
| 14 영상·병리추가 | Lookup | T-score(골다공증)·TICI·Gustilo-Anderson·유방밀도(ACR)·Gleason/ISUP·ASIA |
| 15 신장·심장·호흡 | Lookup | KDIGO CKD(G×A)·AKI·ECG기준·TIMI/GRACE·ASCVD·GOLD·mMRC·CAT |
| 16 소화기·중독·소아 | Lookup+Scoring | Forrest·LA분류·CIWA-Ar·PEWS·Ballard·Bhutani |
| 13 **템플릿 정의서** | (정의 계층) | 공통골격 ①~⑧·4 아키타입·UI 컨트롤 매핑·변환 절차 |

> 합계 ~80종. ⚠️ 전 차트 임상수치는 **참조용** — 운영 전 공식 가이드라인 원문 대조·`verified` 확정 필수(13문서 검증 주의).
