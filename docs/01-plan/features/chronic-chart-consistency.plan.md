# 만성질환 환자 의료차트 일관 구현 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/src/modules/chronic/chronic-sync.service.ts:56 · apps/api/prisma/schema.prisma:2460 model ChronicObservation · apps/api/src/modules/medical-record-issuance/issuance.service.ts · 잔여: 없음

> **Feature**: chronic-chart-consistency
> **Version**: 1.2 (Plan, 검토 보완)
> **Date**: 2026-06-22
> **Status**: Plan (설계 전 검토)
> **계기**: 검사 추이 분석 카드가 "이전 결과와 비교 불가"를 반환(단발 LabResult만 참조) + 동일 지표가 여러 모델에 분산되어 만성질환 탭에 일관되게 모이지 않음.
> **v1.1 보완**: 급성/만성 맥락 구분, LabResult 코드매핑·단위파싱, 교차소스 dedup, 코드셋 확장(이상지질·CKD), FHIR 정합, 관측가능성·백필 결정(§3.1·§3.5·§4·§9).
> **v1.2 보완**: 환자 **의무기록(공식 기록·발급본)** 에 별도 표현되는 만성질환 정합 — 퇴원요약·의무기록 사본 스냅샷·진단서/소견서가 ChronicObservation SoT와 일치(§10).
> **v1.3 보완**: **참고문헌·오픈소스 벤치마크(§11)** — 현 차트 유지 + 별도 종단 레이어 접근이 학계·OSS(OpenMRS/Bahmni·Medplum SMART·KNAVE·FHIR) 합의와 정합함을 근거화. 환자포털 종단 뷰 정합(§10.6)·사용성 가드레일·LOINC 표준키 채택 명시.

---

## 0. 목적
만성질환(당뇨·고혈압·이상지질 등) 환자의 **측정·진단·목표·평가·조치**가 의료차트에서 **하나의 일관된 종단(longitudinal) 구조**로 추적되도록 데이터·UI·연계를 정렬한다. 핵심은 **"같은 지표는 한 곳에서, 같은 코드·단위·정상범위로, 어느 입력 경로든 동일하게 추적"**.

---

## 1. 현황 — 무엇이 일관적이고 무엇이 분산되어 있나

### 1.1 이미 일관(추적 backbone) ✅
- **`ChronicObservation`**(정규 시계열): code(HBA1C·FBS·PPG·SBP·DBP·WEIGHT·BMI)·value·unit·measured_at·source·flag·normalMin/Max, `@@index([patientId,code,measuredAt])`.
- 기록 `POST /chronic-observations`(flag·정상범위 서버 자동) · 추이 `getTrend` · 코호트 `getDashboard`(CDSS) · 만성질환 탭 `ChronicTrendPanel`.

### 1.2 분산(일관성 갭) ❌
| 지표 | 분산 저장처 | 문제 |
|------|-------------|------|
| 혈압(SBP/DBP) | `EarlyWarningScore`(NEWS2)·`Encounter.objective`(텍스트)·간호 flowsheet·`ChronicObservation` | 만성질환 탭은 ChronicObservation만 → EWS/외래에서 잰 혈압이 추이에 안 보임 |
| 혈당·HbA1c | `LabResult`/`LabResultItem`·`ChronicObservation` | **검사 추이 카드는 LabResult 단발만 참조 → "비교 불가"**(이번 버그의 근본). 시계열 미연결 |
| 체중·BMI | 외래 vital·간호·`ChronicObservation` | 입력 경로별 산재 |
| 진단(E11/I10) | `ProblemList` | 목표(target)·측정과 느슨하게 연결 |

→ **결과**: 동일 환자·동일 지표인데 입력 경로에 따라 다른 모델에 들어가, 차트에서 "끊긴" 추이로 보인다. 검사 추이 분석이 단발만 보고 비교 불가를 답한 것이 대표 증상.

---

## 2. 일관 구현 원칙 (4대 정렬)

1. **단일 관측 모델(SoT)** — 추적 대상 만성지표는 **`ChronicObservation`으로 수렴**. 다른 모델에 입력돼도 **자동 미러링**으로 동일 시계열에 합류.
2. **단일 코드·단위·정상범위** — 코드 정규화 + `CODE_SPEC`(서버) 단일 정의로 flag/목표를 한 곳에서 판정. FE 상수 중복 제거.
3. **문제중심(problem-oriented)** — `ProblemList`(E11·I10·E78 등) ↔ 관리목표(target) ↔ 지표 ↔ 추이 ↔ CDSS를 **진단 단위로 묶어** 표시.
4. **폐루프(care loop)** — 진단→목표→측정→평가(CDSS)→조치(처방·교육·재검)→재측정 추적.

---

## 3. 설계

### 3.1 측정 자동 미러링(수렴 레이어) — 갭의 핵심 해소
입력 경로가 어디든 만성지표가 ChronicObservation에 모이도록 **이벤트/동기화 미러**:
- **LabResult 완료 시** → HbA1c·공복/식후혈당·LDL 등 매핑 코드가 있으면 ChronicObservation upsert(`source='LAB'`, dedupe key=`LAB:<labResultItemId>`).
- **EarlyWarningScore 기록 시** → SBP/DBP/HR을 upsert(`source='EWS'`) — **단, §3.1.2 맥락 필터 적용**.
- **외래 vital/간호 flowsheet 입력 시** → 혈압·체중·BMI upsert(`source='CLINIC'/'NURSING'`).
- 구현: 도메인 이벤트 리스너(`lab.result.completed`·`ews.recorded` 등) → `ChronicSyncService.mirror()`. **비동기**(이벤트 핸들러, 원천 트랜잭션 비차단). 원천은 그대로 두고 **읽기 일관성만** 확보(원천 SoT 침해 없음).

#### 3.1.1 dedup — 2단(멱등 + 교차소스 중복)
- **동일 소스 멱등**: `ChronicObservation += sourceId`, `@@unique([source, sourceId])`(sourceId 존재 시) → 재처리·재이벤트에도 1건.
- **교차 소스 중복 억제**: 같은 측정이 LAB+수기처럼 두 경로로 들어올 때 → `(patientId, code, measuredAt 분 단위 버킷)` 근접 중복 감지 시 **우선순위(LAB > DEVICE > CLINIC > NURSING > EWS > 수기)** 로 1건 유지/표시(원본은 보존, 추이 집계에서만 dedup). 표시에 source 배지.

#### 3.1.2 급성/만성 맥락 분리 (중요 — 추이 오염 방지)
**문제**: EWS는 ICU·응급에서 시간당 다회 기록 → 그대로 미러하면 만성 혈압 추이가 급성 모니터링값으로 오염·왜곡.
**해소**:
- ChronicObservation `source`에 맥락 내포(EWS=급성성격) + **추이/대시보드 기본 필터는 만성 맥락**(CLINIC·CHECKUP·SMBG·DEVICE·LAB) 우선. EWS/NURSING(입원 급성)은 **옵트인 토글**("입원 측정 포함")로만 표시.
- 또는 미러 시 `context`(CHRONIC|ACUTE) 태깅 — 외래/검진/자가=CHRONIC, 입원중 EWS=ACUTE. 만성질환 탭 기본=CHRONIC.
- 빈도 throttle: 동일 환자·코드·동일일(day) 다회 EWS는 **대표값(일 1~2건, 예: 최저/최근)**만 미러(원천 보존).

### 3.2 문제중심 차트(만성질환 탭 재구성)
- `ProblemList`(만성 진단)에 **관리목표 매핑**: 진단코드→권장 지표·목표(예: E11→HbA1c<7·FBS<130 / I10→BP<140/90 / E78→LDL<100). 목표는 **서버 가이드라인 테이블**(코드↔지표↔목표)로 단일화(FE 상수 제거).
- 만성질환 탭을 **진단 카드 단위**로: 각 활성 만성 진단마다 [관련 지표 추이 + 목가상읍 + 최신/Δ + CDSS 경고 + 관련 처방/교육]을 묶어 표시.

### 3.3 검사 추이 분석 정합(이번 버그 연계)
- `lab/ai-trend`가 **단발 LabResult가 아니라 ChronicObservation 시계열**(또는 동일 코드의 LabResult 이력)을 입력으로 받아 추세를 산출 → "비교 불가" 제거.
- (FE 즉시 수정 완료: `AiSuggestionPanel`이 중첩 `trend.answer` 추출·개행 복원. 본 기획은 데이터 입력 측 정합.)

### 3.4 입력 일관성
- 측정 입력은 **만성질환 탭 빠른입력폼 단일 진입** + 자동 미러로 흡수. 수기·자가측정(SMBG)·기기(DEVICE)·검사(LAB)·외래(CLINIC) 모두 동일 코드·단위·flag.

---

### 3.5 LabResult → 정규코드 매핑·단위 파싱 (구체화)
- LabResult/Item은 한글 `testName` + 문자열 `value`("5.2", "5.2 %") → **매핑 테이블**(testName/LOINC ↔ ChronicObservation.code) 필요.
  - 1차 매핑(예): `당화혈색소|HbA1c|HBA1C→HBA1C`, `공복혈당|FBS|Glucose,fasting→FBS`, `식후2시간혈당|PP2→PPG`, `LDL콜레스테롤→LDL`, `중성지방|TG→TG`, `크레아티닌|Cr→CR`, `eGFR→EGFR`.
  - LOINC 매핑을 우선 키로(있으면), 없으면 testName 정규화(공백·괄호 제거·소문자) 보조.
- **단위 파싱**: value 문자열 → 숫자 추출(`parseFloat`), 단위 분리·검증(코드 기대단위와 불일치 시 미러 보류+로그). 비수치(정성)·범위표기는 미러 제외.
- **미매핑 로깅**: 매핑 없는 testName은 카운터·샘플 로그 → 매핑표 보강 루프(은닉 누락 방지).

## 4. 스키마 변경(최소·추가형)
- `ChronicObservation += sourceId String?`(원천 추적·미러 dedupe), `+ context String? @default('CHRONIC')`(CHRONIC|ACUTE, §3.1.2), 부분 유니크 `@@unique([source, sourceId])`(sourceId 있을 때) + `@@index([patientId, code, context, measuredAt])`.
- **코드셋 확장**(CODE_SPEC 단일 정의에 추가): 이상지질 `LDL`(<100)·`HDL`·`TG`(<150)·`TC`, CKD `CR`·`EGFR`(≥60)·`UACR`. 단위·정상범위 서버 1곳.
- (신규) `ChronicTarget`(or 가이드라인 상수 테이블): diagnosisCode↔code↔targetValue·comparator. — 1차는 서버 상수 맵으로 단일화 후 P2에서 테이블화.
- 전부 manual SQL(ADD COLUMN/인덱스, db push 차단 환경). 신규 컬럼 추가 시 [[feedback_deploy_prisma_generate]] 절차(서버 prisma generate) 준수.

---

## 5. 단계
| 단계 | 범위 |
|------|------|
| **P0(즉시)** | 검사 추이 카드 표시 버그 수정(완료) + `AiSuggestionPanel` 중첩/개행 정합(완료) |
| **P1** | **측정 자동 미러링** — LabResult·EarlyWarningScore→ChronicObservation 동기화(sourceId·dedupe) → 만성질환 탭에 모든 경로 측정 합류 |
| **P2** | **문제중심 차트** — 진단↔목표 가이드라인 단일화(서버) + 만성질환 탭 진단카드 재구성 + CDSS를 목표 기반으로 |
| **P3** | care loop(목표 미달→조치 추적), SMBG/DEVICE 실인입, 이상지질·CKD 등 만성질환 확장, 대시보드 연계 |

---

## 6. 일관성 체크리스트(수용 기준)
- [ ] 외래·간호·검사·자가측정 어디서 입력해도 동일 지표가 **만성질환 탭 한 추이선**에 나타난다.
- [ ] 동일 지표의 코드·단위·정상범위·목표가 **서버 단일 정의** 1곳에서 온다(FE 중복 0).
- [ ] 검사 추이 분석이 시계열 기반으로 추세(안정/개선/악화)를 답한다("비교 불가" 제거).
- [ ] 미러링이 멱등(재처리해도 중복 집계 0, `(source,sourceId)`).
- [ ] 진단(ProblemList)별로 지표·목표·추이·CDSS가 묶여 표시된다.

---

## 7. 리스크
- 미러링 이중기록 → `(source,sourceId)` 멱등으로 차단. 원천 SoT는 변경 않고 **읽기 일관성만** 확보(중복 진실원 방지).
- 코드 매핑 누락(LabResult testName→정규코드) → 매핑 테이블·미매핑 로깅.
- 과거 데이터 백필 범위/비용 — P1은 신규부터, 백필은 선택.

---

## 8. 연계
- 데이터 backbone [[chronic_diabetes_data]] · 대시보드 [[hospital_dashboards_plan]] · raw 추출 교훈 [[feedback_prisma_queryraw_uuid]].

## 9. 검토 보완(v1.1) — 추가 결정·표준·운영

### 9.1 표준 정합 (FHIR/openEHR)
- ChronicObservation은 사실상 **FHIR Observation**(code=LOINC·value+unit·effectiveDateTime·status) 패턴. 코드 매핑을 **LOINC 기준**으로 두면 외부 FHIR(`/fhir/R4/Observation`) 노출·교환과 자연 정합(CLAUDE.md FHIR R4 외부·openEHR 내부 원칙 부합).
- 향후 FHIR Observation export 시 ChronicObservation을 1차 소스로(중복 모델 신설 금지).

### 9.2 관측가능성(미러링 신뢰)
- 미러 성공/실패/미매핑 카운터 + 미매핑 testName 샘플 로그. 일배치 정합 점검(원천 건수 vs 미러 건수 추이).
- 멱등 위반·단위 불일치는 경고 로그(은닉 실패 방지).

### 9.3 백필 결정
- P1은 **신규 이벤트부터** 미러(안전). 과거 LabResult/EWS 백필은 **별도 1회 스크립트**(ts-node, dedup 키 동일)로 옵션 — 데모/연속성 필요 시. 범위·부하 사전 합의.

### 9.4 검증(필수)
- tsc≠런타임: 미러·추이·대시보드는 **운영 실DB 호출 검증**([[feedback_prisma_queryraw_uuid]] 교훈). 미러 멱등(재실행 중복 0)·맥락 필터(입원 EWS 제외 시 추이 안정) 회귀 확인.

### 9.5 비범위(명시)
- 외화·정산 등은 ERP 트랙([[foreign_currency_separate_track]]). 본 기획은 임상 측정·추적만.
- 실기기(BLE/앱) 물리 연동은 P3 이후(인프라 게이트).

### 9.6 P0 즉시수정 반영(완료)
- AiSuggestionPanel 중첩 answer 추출 + 개행 복원(PR #36) — 카드 raw JSON 노출 해소. 단, **근본(검사 추이가 시계열을 못 봄)** 은 P1 미러링으로 해소.

---

## 10. 의무기록(공식 기록·발급본) 표현 정합 — "별도 표현되는 부분"

만성질환 측정·진단은 라이브 차트(만성질환 탭)뿐 아니라 **공식 의무기록과 발급물에도 별도로 표현**된다. 이들이 ChronicObservation/ProblemList **SoT와 어긋나면**(자유텍스트 재입력·발급본 불일치) 법적·임상 신뢰가 깨진다. → **공식 표현도 동일 SoT에서 파생**.

### 10.1 별도 표현 지점 인벤토리
| 표현 지점 | 모델 | 현재 표현 | 정합 리스크 |
|-----------|------|-----------|-------------|
| 진료기록 SOAP | `Encounter.objective`(텍스트) | 혈압·혈당 자유텍스트 | 구조화 미연동 → 추이 불일치 |
| 경과기록 | `ProgressNote` | 텍스트 | 동상 |
| 간호기록/플로우시트 | `NursingNote` | 텍스트/JSON | 동상 |
| **퇴원요약** | `DischargeSummary` | 만성 problem·경과 수기 | 추세 수기 재작성 → 차트와 괴리 |
| **의무기록 사본(발급)** | `IssuanceArtifact` 스냅샷(ENCOUNTER/PROGRESS/NURSING/DISCHARGE/PRESCRIPTION) | 원천 SIGNED 동결 | 만성 **측정 추이** 자체는 발급 유형에 없음 |
| **진단서·소견서(B그룹)** | DIAGNOSIS_CERT·OPINION·ADMISSION_CERT | 의사 작성+서명 | 만성 진단·대표값 수기 → 차트와 불일치 가능 |

### 10.2 정합 원칙
1. **공식 표현 = SoT 파생**: 퇴원요약·진단서의 만성 측정/추세는 ChronicObservation·ProblemList에서 **자동채움/대조**(수기 재입력 지양, 의사 수정은 허용하되 출처 표기).
2. **발급 = 시점 동결(as-of)**: 법적 무결성상 발급본은 동결(snapshotJson). 단 **동결 시점에 SoT에서 캡처** → 같은 날 발급본과 라이브 차트가 일치·재현(진위검증).
3. **구조화 우선·텍스트 보조**: 발급 렌더는 구조화 측정(ChronicObservation)을 1차로, 자유텍스트는 보조. Encounter 자유텍스트 vitals는 §3.1 미러로 구조화에 합류.

### 10.3 구체 반영
- **의무기록 사본에 만성 추이 발급 유형 추가**: `ISSUANCE_RECORD_TYPES`에 `CHRONIC`(또는 `OBSERVATION`) 추가 → 환자가 "검사수치/혈압 추이" 사본 요청 가능(의료법 §21 사본교부). `buildSnapshot('CHRONIC')`이 기간 내 ChronicObservation을 동결.
- **퇴원요약 만성 섹션 자동초안**: 활성 만성 problem별 [최근값·기간 추세·목표 달성]을 ChronicObservation에서 생성해 `DischargeSummary` 초안에 주입(의사 검토·수정·서명).
- **진단서/소견서 자동채움 확장**: `certificateDraft`가 만성 진단(ProblemList)+대표 측정값(ChronicObservation 최신/대표)을 채움 → 차트·증명서 일관. 작성 의사 서명은 기존 §17 강제 유지.
- **발급대장 일원화**: 만성 추이 사본도 IssuedDocument·발급대장·진위검증(QR) 동일 경로(기존 인프라 재사용).

### 10.4 단계 반영(§5 보강)
- **P2**: 퇴원요약 만성 섹션 자동초안 + 진단서/소견서 만성 자동채움.
- **P3**: 의무기록 사본 `CHRONIC` 발급 유형(스냅샷 동결·발급대장).

### 10.5 수용 기준 추가
- [ ] 같은 날 발급한 의무기록 사본의 만성 측정이 라이브 차트와 **일치**(as-of).
- [ ] 퇴원요약·진단서의 만성 수치가 ChronicObservation에서 파생(수기 불일치 0).
- [ ] 발급본은 동결·진위검증 가능(스냅샷 무결성).

### 10.6 환자포털 종단 뷰 정합 (또 다른 "별도 표현")
- 만성 측정은 **환자포털**(`/portal` HealthTab)에도 별도 표현됨 → 동일 ChronicObservation SoT에서 노출해 **차트·발급본·포털 3면 일치**. 환자 자가측정(SMBG) 입력은 포털→ChronicObservation(`source='SMBG'`)로 합류(§3.1).
- 근거: 환자대면 종단 시각화의 자가관리 효과(Halyos·당뇨 포털 사용성 연구, §11).

---

## 11. 참고문헌·오픈소스 벤치마크 (현 차트 유지 + 별도 종단 레이어 근거)

> 결론: **본 차트는 그대로 두고 만성질환을 별도 종단·문제중심 레이어로 표현**하는 우리 방향은 OSS·학계 합의와 정합. 표준(FHIR)으로 못박으면 외부교환까지 일관.

### 11.1 설계 ↔ 선례 대조
| 우리 구성 | 표준/선례 | 시사점 |
|-----------|-----------|--------|
| `ChronicObservation`(정규 시계열·LOINC키) | **FHIR `Observation`**, Medplum SMART 데모(혈압 추세) | 외부 FHIR 노출 정합·중복모델 금지 |
| `ProblemList`(E11/I10) | **FHIR `Condition`**(problem-list-item, US Core)·SNOMED/KCD | 문제중심 표준 |
| 관리목표·care loop | **FHIR `CarePlan`**, MccCareplan/patientsmartapp | 목표↔측정↔평가 루프 |
| 만성질환 탭(종단)+위젯 대시보드 | **OpenMRS/Bahmni** 모듈형 대시보드·종단기록 | 본 차트 유지 + 위젯 레이어 추가 방식 동일 |
| 추세(안정/개선/악화) 판정 | **KNAVE-II/IDAN/ALMA** temporal abstraction | P3 추세 자동판정 고도화 경로(옵션) |
| sparkline·목가상읍·30초 뷰 | PGHD 대시보드 스코핑 리뷰 합의(line+trend·단순·기존호환) | 시각화 단순 유지 가드레일 |

### 11.2 사용성 가드레일(문헌 합의 — 과설계 방지)
- 종단 뷰는 **line + 목가상읍/정상범위, 30초 내 파악, 기존 EHR와 호환되는 단순성** 우선. 고급 추상화(temporal abstraction)는 **P3 옵션**(기본 뷰를 복잡화하지 않음).

### 11.3 표준 키 채택
- 관측 코드 **canonical = LOINC**(매핑 1차 키), 진단 = KCD/SNOMED. → §3.5 매핑·§9.1 FHIR export와 일원화.

### 11.4 레퍼런스
- OpenMRS / Bahmni(모듈형 종단 대시보드·NCD) — openmrs.org, bahmni.org
- Medplum SMART on FHIR demo(혈압 추세·Condition problem-list) — github.com/medplum/medplum-smart-on-fhir-demo
- MccCareplan/patientsmartapp(다중 만성 CarePlan) — github.com/MccCareplan/patientsmartapp
- KNAVE-II/IDAN(시간지향 임상데이터 지능형 시각화·temporal abstraction) — PMC1560450
- "Leveraging EHR for chronic disease management: need for temporal data views"(EHR 종단표현 갭)
- Visualization of PGHD: 스코핑 리뷰(PMC10665122) / Halyos 환자대면 종단(biorxiv 597583) / 당뇨 포털 대시보드 사용성
