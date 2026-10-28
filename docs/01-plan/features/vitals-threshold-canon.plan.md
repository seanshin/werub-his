# 활력 이상 판정 임계 — 화면·서버 전수 수렴 (2026-10-01)

> 요청: "다른 화면 임계 하드코딩 전수 진행해". 선행 작업은 간호 스테이션 수렴(`nurse-station-shift-handover.plan.md` §4)이다.

## 1. 실측 — 같은 측정치를 화면마다 다른 숫자로 판정했다
| 위치 | 이 화면만의 기준 | 함께 드러난 결함 |
|---|---|---|
| 간호 스테이션 | SBP>140·HR>100·BT>38·SpO2<95 | 체온·SpO2 필드명이 달라 늘 '-'(09-30에 봉합) |
| 진료 작성(간호 측정 바이탈) | `warnIf(v >= 140)`·HR>100/<60·SpO2<95·BT≥37.5 | — |
| 입원 상세 요약 | SBP≥140/<90·HR≥100·BT≥38·SpO2<94·RR>24 | — |
| 입원 상세 타일 | DBP≥90/<60·BT<36(정본에 없는 기준) | 측정된 0 을 '—' 로 버림(`val > 0`) |
| 간호 플로시트 | SBP>160·HR>120·SpO2<92 | 🔴 **혈압 칸에 "120/80" 문자열을 넘겨 어떤 혈압도 이상 표시가 안 됐다** |
| 응급 차트 | HR>100·RR>20·BT<36·SpO2<95 | — |
| ICU 워크스테이션 | HR>130·SBP>180·SpO2<90 | 🔴 `hr && …` 이라 **HR 0 에 경보가 없었다**·체온은 판정 안 함 |
| 환자 차트(개요·활력 탭) | FE `VITAL_RANGES`("단일 정책"이라 이름 붙은 또 하나의 정본)·RR 12–20 | 참고 범위 문구도 따로 적음 |
| 공개 예약(AI 응답의 바이탈) | SBP≥140·SpO2<94 | `?? 0` 로 미측정을 정상으로 접음 |
| 서버 — 의사 담당 환자 상태 | HR>140 위급·SBP>160 불안정·SpO2<94 | 알림(HR≥130 위급)과 다른 판정 · `v.spo2 &&` 로 SpO2 0 무시 |

🔴 **더 근본적인 결함**: `VitalsModule` 이 `ConfigRuntimeModule` 을 import 하지 않았다. 그래서 `@Optional() config` 가 조용히 undefined 였고, 환자안전위 임계 개정(`clinical.vitals.thresholds`)과 위급 알림 억제(`clinical.vitals.criticalAlert`)가 **개통 이래 서버 알림에도 반영된 적이 없다**.
- 부트 후 DI 를 스캔하니 같은 결함이 3곳 더 있었다.
  - UserModule: 비밀번호 최소 길이 `security.password.minLength`
  - OpeningModule: 기관 국가 `hospital.country`(UAE 로 설정해도 KR)
  - NutritionModule: 급양 워크리스트 기준
- 운영 DB 에는 이 키들의 행이 없었다(2026-10-01 실측). 그래서 지금 당장 판정이 바뀌는 것은 없다. 앞으로 넣는 설정이 비로소 먹는다.

## 2. 설계
- **임계 정본은 shared `vitals-thresholds.ts` 하나**(API `vitals-evaluate` 에서 이동했고, API 는 재수출만 한다): `VITALS_THRESHOLDS`·`mergeVitalsThresholdsDetailed`·`vitalItemFlags`(위급/주의/정상/미측정)·`worseVitalFlag`·`vitalNormalRangeText`·`temperatureStatus`.
- 서버: `GET /api/v1/vitals-thresholds` 는 코드 기본값에 개정을 병합한 값·출처(`CONFIGURED`/`DEFAULT`)·버려진 개정 키를 준다. 로그인한 모든 직원이 읽을 수 있다. 판정 기준이지 임상 정보가 아니다. 클래스 `@Roles` 가 핸들러를 덮기 때문에 별도 컨트롤러로 두었다.
- 화면: `@/lib/vital-flags` 의 `useVitalsThresholds()` + `flagsWith()` 를 쓰고 색은 `vitalFlagText/Bg`(위급 빨강·주의 주황)로 칠한다. 공용 부품 `VitalsRuleNote` 가 기준의 출처를 한 줄로 밝힌다.
  - 조회 실패: 코드 기본값으로 **판정은 계속**한다(경보가 사라지는 쪽보다 안전). "확인하지 못했습니다"라고 말한다.
  - 공개 화면(예약): 직원 EP 를 부르지 않고 shared 코드 기본값으로 판정한다.
- 서버 담당 환자 상태: 위급 역치는 CRITICAL, 주의 역치는 UNSTABLE 이다. 통증은 종전처럼 넣지 않는다.
- 판정 변화(정본이 원래 정한 기준으로 맞춰진 것):
  - 의사 센서스에서 HR 130~140 이 불안정에서 **위급**으로 바뀐다.
  - 주의 역치(SBP≥140·HR≥100·BT≥37.5·SpO2≤95·RR≥22)는 불안정으로 잡힌다.
  - 화면 경계는 정본 규칙(≤/≥ 포함)을 따른다.

## 3. 대상 밖(임계가 아닌 숫자 — 가드 허용 목록에 이유와 함께 동결)
- 통증 NRS 중증도 구간 4·7(척도 정의) · 고혈압 **조절 목표** 140/90(만성질환) · 전자간증 중증 고혈압 160/110 · 태아 심박 110–160
- 채점 도구(Aldrete·CURB-65·qSOFA·APACHE) · 세포치료 투여 적격 기준 · 간호진단 제안 근거(경보 아님)
- **PACU 밀착감시**: 정본보다 의도적으로 더 엄격하다. 함수 주석에 두 벌임을 밝혀 두었다. 기준을 설정으로 열지는 회복실 결정(배치 Q)의 후속이다.

## 4. 가드
- `test/ui-structure/vitals-threshold-literal-guard.spec.ts`: web·api 의 활력 비교 숫자를 허용 목록과 **정확히** 대조한다. `warnIf(v >= N)` 형태와 `VITAL_RANGES` 의 재등장도 막는다.
- `test/architecture/optional-config-di.spec.ts`: ConfigRuntimeService 를 받는 provider 의 모듈이 ConfigRuntimeModule 을 import(재수출 사슬 포함)하는지 확인한다. 배선을 고친 뒤 **카탈로그 기본값을 "원내 확정"으로 읽지 않는지**(급양 정책·기관 국가)도 확인한다.
- `test/vitals/threshold-canon-convergence.spec.ts`: 의사 센서스 상태 판정과 임계 EP 를 확인한다.

## 5. 후속 — 모든 `@Optional()` 의존 배선 전수(2026-10-01)
- 부트 후 DI 를 전수 스캔했다(`@Optional` 생성자 파라미터 281개·143개 클래스, 인스턴스별). 대상은 **앱에는 있는데 그 모듈에서는 undefined 인 의존**이다.
- 스캐너는 재주입으로 검증했다(VitalsModule 배선을 끊으면 잡힌다). 처음 판에는 클래스 단위로 중복을 제거해 같은 서비스의 다른 인스턴스를 놓쳤고, 생성자 주석 속 괄호 때문에 파라미터 파싱이 깨졌다. 둘 다 고친 뒤 결과다.
  - 🔴 **CdssModule → DurService.allergyService**: AllergyModule 을 import 하지 않아 CDSS 경로(`/cdss` 점검·CPOE `cdss.enforce` 게이트)의 DUR 이 **구조화 알레르기 원장(Allergy)을 보지 못했다**. 레거시 `patients.allergies` JSON 만 봤다.
    - 운영 실측: 구조화 알레르기 13건(12명)이 **전부** 레거시 JSON 에 없다(페니실린·아스피린·이부프로펜·땅콩·갑각류 등).
    - 처방 저장 경로의 DUR(PrescriptionModule 인스턴스)은 AllergyModule 을 import 하고 있어 정상이었다. 같은 클래스의 두 인스턴스가 서로 다르게 동작했다.
  - FormularyService.config 는 오탐이다. 필드로 저장하지 않고 폴백 구성에만 넘기며, 실제 쓰는 FormularyGateService 는 주입이 정상이다.
- 가드 `test/architecture/optional-di-wiring.spec.ts`: 모든 `@Optional()` 클래스 의존이 등록 모듈에서 보여야 한다(같은 모듈 provide·import 재수출 사슬·@Global·프레임워크 전역). 코드 속 `@Optional` 277개를 전부 파싱하는지 확인했고, 재주입하면 실패한다(Cdss·Vitals).

## 6. 후속 — PACU 활력 경보 기준 설정화(2026-10-01)
- 회복실 밀착감시 임계는 코드 상수(SpO2 92 미만·HR 50/120·RR 8/24·SBP 90/180·BT 35/38.5)였다. 이것을 config `pacu.vitalAlertThresholds`(JSON 부분 덮어쓰기)로 열었다. 기본값은 `PACU_ALERT_DEFAULTS` 이고 병동 활력 정본보다 의도적으로 엄격하다.
- 정규화:
  - 미상 키·범위 밖(오타·단위 착오)·JSON 이 아닌 문자열 숫자는 버린다.
  - 짝(low<high)이 역전되면 둘 다 기본값으로 되돌린다.
  - 버린 키는 `alertDroppedKeys` 로 밝힌다.
- 출처 `alertSource`:
  - `CONFIG` 는 적용된 키가 하나라도 있을 때다. 전부 버려졌으면 CONFIG 가 아니다.
  - `DEFAULT`(미설정)과 `UNAVAILABLE`(조회 실패)을 가른다. 조회에 실패해도 기본값으로 감시는 계속한다.
- 소견 문구에서 숫자를 뺐다("저산소(SpO2 기준 미만)"). 기준이 바뀌면 숫자 박힌 문구가 거짓이 되기 때문이다. 적용 기준값은 화면이 설정 응답으로 함께 보인다(`PacuAlertRule`). 이미 저장된 소견은 소급하지 않는다.
- 저체온 중증 구분(`hypothermiaSeverity` SEVERE)도 같은 임계(`tempLow`)를 쓴다.
- 사람 결정: `pacu.vitalAlertThresholds`(배치 Q · 현행 기본값 / 원내 값 설정). 값을 정하면 설정만 바꾸면 된다.
- 서버 활력 숫자 가드의 허용 목록에서 PACU 를 뺐다(비교 숫자 0).
