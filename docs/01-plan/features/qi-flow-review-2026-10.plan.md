# 의료질관리(QI) 흐름 종단 검토·보완 기획서

> **문서번호**: PLAN-QI-FLOW-001
> **버전**: v1.0
> **작성일**: 2026-10-08
> **상태**: Draft (코드 실측 완료 · 구현 전)
> **선행 문서**: [`patient-management-quality-enhancement-2026-08.plan.md`](./patient-management-quality-enhancement-2026-08.plan.md)(질관리 3축 경계 선언 · Track B) · [`committee-governance-engine.plan.md`](./committee-governance-engine.plan.md)(QPS 의결·집행 — 구현됨) · [`patient-safety-enhancement.plan.md`](./patient-safety-enhancement.plan.md)(IPSG — 일부 구현) · [`infection-control-enhancement.plan.md`](./infection-control-enhancement.plan.md)
> **관련 메모**: `clinical_quality_flow_review`(2026-09-02 손위생 98.48% ↔ 관찰 0건) · `cpoe_quality_2026_10_07`(CPOE 지표·SPC·PDCA·안건 — 유일하게 완결된 고리) · `nursing_review_2026_10_07`(간호 지표 자동 산출 없음)

🔴 **실측 전제** — 운영 DB 는 가상 병원 시드 데이터다(CLAUDE.md). 아래 "운영 실측" 수치는 그 전제 위에서만 읽는다.

---

## 0. 이 문서의 위치 — "지표를 더 만드는" 기획이 아니다

질관리 **부품은 거의 다 있다**: 지표 등록부(25지표 · 방향·배율 정본 `indicator-policy.ts`), 측정 원장(`QiMeasurement` 무효화 이력·지표×기간 유일), 사고 보고·RCA·기한 경보, 감염 감시·손위생 관찰, 데이터 완결성 탐지기(17도메인 · 매일 스냅샷), 위원회 엔진(QPS 안건→의결→집행 바인딩 `quality-indicator`), 그리고 CPOE 지표 한 영역에서는 **층화·p 관리도·PDCA·효과 확인·안건 상정까지 완결된 고리**가 돈다.

🔴 **끊어진 것은 부품 사이의 고리다.** 종단 실측(2026-10-08 · 병렬 3갈래 + 직접 대조) 결론:

| 단계 | CPOE 지표(16) | 일반 QI 지표(25 · 낙상·욕창·감염·만족도…) |
|------|:---:|:---:|
| ① 지표 정의·방향 | ✅ shared 정본 | ✅ 원장+등재표 |
| ② 목표 설정 | ✅ 안건 → QPS 의결 → 집행 | 🔴 ADMIN 이 화면에서 직접 수정(위원회 우회) · 시드가 되돌림 |
| ③ 측정(분자·분모) | ⚠ 서버 재집계 — **버튼을 눌러야** 기록 | 🔴 **전부 수기 입력** · 사건·감염·관찰 원장과 연결 0 · 출처 구분 없음 |
| ④ 분석(층화·관리도) | ✅ 진료 유형·진료과 · p 관리도 | 🔴 없음(최신값 1개) |
| ⑤ 판정 | ✅ | ✅(방향 있을 때) — 단 **무효 측정이 두 화면에 섞임** |
| ⑥ 경보 | — | 🔴 목표 미달 경보 없음 |
| ⑦ 개선(PDCA)·효과 확인 | ✅ 원장+서버 재집계 | 🔴 **CPOE 키만 허용** — 낙상 지표로는 활동을 열 수 없다 |
| ⑧ 보고·환류 | ⚠ 안건 상태 조회 | 🔴 보고서 EP 는 JSON 반환뿐 · 부르는 화면 0 · 회의록 연결 0 |

즉 **같은 병원 안에 "완결된 질 관리 고리"와 "엑셀을 DB 로 옮긴 수기 표"가 나란히 있다.** 이 기획은 CPOE 에서 이미 검증된 고리를 **일반 지표·사건 보고·감염·간호 지표로 넓히고**, 세 화면이 같은 사실을 다르게 말하는 자리를 닫는 것이다.

### 0.1 질관리 3축 경계는 유지한다(선행 기획 §1.2)

`data-quality`(기록되지 않은 것을 세는 탐지기) · `qi`(운영지표·인증·PSI/HSMR) · `quality`(QI 지표 등록·측정·판정 정본) — **합치지 않는다.** 본 기획이 손대는 것은 **`quality` 원장을 중심으로 한 고리**이고, `qi` 의 운영지표·`data-quality` 탐지기는 그 고리의 **공급원**으로만 연결한다.

---

## 1. 현행 종단 실측 (2026-10-08 · 코드 확인 기준)

### 1.1 지표 정의·목표

| 항목 | 실측 | 근거 |
|------|------|------|
| 지표 원장 | `QualityIndicator` 25행 · `name` 유일 · `direction`·`unit`·`valueScale` 컬럼(nullable=미등재·판정 불가) | `schema.prisma:6495` |
| 방향 정본 | 컬럼 → 코드 등재표 → 미등재(판정 불가) 우선순위 한 곳 · CPOE 지표 10종도 등재 | `quality/indicator-policy.ts` |
| 목표 | `targetValue Decimal(5,2)` **한 값** — 기간별·병동별 목표 없음 · 벤치마크 없음 | `schema.prisma:6500` · `qi.service.ts:624-642`(benchmark `[]`) |
| 🔴 목표 출처 셋 | ① `targetValue` ② config `qi.targets.*`(응급 도어투트리아지·외래 대기 등 **운영 임계** — QI 목표가 아님) ③ 재입원 `target: 5.0` 하드코딩 | `config-runtime.service.ts:230-243` · `qi.service.ts:405` |
| 🔴 위원회 우회 | `POST/PATCH /quality/indicators` 가 ADMIN 에게 열려 있어 QPS 의결 없이 목표·정의 변경 가능 · 안건 경로는 CPOE 만(`SCREEN_AGENDA_SOURCES = ['ORDER_ATTENTION','CPOE_QI']`) | `quality.controller.ts:43-57` · `order-governance/committee-agenda.service.ts:7` |
| 🔴 시드가 목표를 되돌림 | 시드 upsert 의 `update` 에 `targetValue` 포함 → 재시드 시 위원회 의결 목표가 카탈로그 값으로 덮임 | `prisma/seed.ts:1236-1238` |

### 1.2 측정

| 항목 | 실측 | 근거 |
|------|------|------|
| 쓰기 경로 | ① 화면 수기 입력(`MeasurementPanel` → `POST /quality/measurements`) ② 시드 12개월 ③ CPOE `recordMonth`(서버 재집계 → `addMeasurement`) — **버튼으로만**, 크론 없음 | `MeasurementPanel.tsx:160` · `seed.ts:5283` · `cpoe-quality.service.ts:302` · `OrderQualityPanel.tsx:121` |
| 🔴 출처 구분 없음 | `QiMeasurement` 에 `source`·`createdBy` 없음 — 수기/자동/시드가 같은 모양 | `schema.prisma:6514-6540` |
| 🔴 일반 지표 자동 산출 0 | 낙상·욕창·투약오류(사고 원장)·병원감염·CLABSI/CAUTI/VAP(HaiCase)·손위생(관찰 원장)·만족도(설문)·필수교육 — 전부 원장이 있는데 **측정 원장으로 쓰는 코드가 없다** | `indicator-ledger.ts:34-88`(읽기만) |
| 🔴 분모 없음 | 재원일수(patient-days)·기구일수(device-days) 산출 코드 **없음** · KONIS 통계 `deviceDays: null · rate: null`("분모 미집계") · `HaiCase.deviceDays` 는 건별 자유 입력 | `infection-control.service.ts:620-655` · `schema.prisma` HaiCase |
| 층화 | 측정은 병원 전체 한 값 — 병동·진료과·연령군 없음(CPOE 만 진료 유형·진료과) | `schema.prisma:6514` |
| 대조 근거 | `indicator-ledger` 10지표에 원장 건수 병기 — 🔴 **전 기간 건수**라 월 측정과 대조가 안 됨 · 분모 없음 | `indicator-ledger.ts:29` |

### 1.3 분석·판정·경보

| 항목 | 실측 | 근거 |
|------|------|------|
| 관리도 | shared `pChart` 는 CPOE 만 사용 · `/quality`·`/admin/qi` 추이는 최신값·12개월 나열 | `cpoe-quality.service.ts:259` |
| 🔴 무효 측정 누수 | `/quality` 는 `voidedAt: null` 로 거르나(`quality.service.ts:461`), **`/admin/qi` 지표 대시보드·`/qi/report`·`/safety-quality-board`·상황판 safetyQuality 섹션은 거르지 않는다**(`qi/` 모듈에 `voidedAt` 0건) | `qi.service.ts:566-569` · `safety-quality-board.service.ts:27-33` |
| 🔴 같은 표를 세 화면이 다르게 읽음 | `/quality/dashboard`(최신 1건·무효 제외) · `/qi/indicator-dashboard`(12건·무효 포함) · `/safety-quality-board`(최근 300행·무효 포함·정수 반올림) | 위 |
| 목표 미달 경보 | 없음 — 경보 등록부 77종에 QI 목표·인증 기한·정책 재검토 경보 없음(만성질환 "목표 미달"만 별개) | `notification/alert-registry.ts` |
| 중복 산출 | 손위생 3벌(반올림 다름) · 재입원 3벌 · 사고 건수 4벌(창·별칭 접기 다름) · DUR 2벌 | 감염 `:1241`·보드 `:74`·안전 `:885` / `qi.service.ts:158,355`·`journey.service.ts:683` / 안전 `:352`·보드 `:16`·경영 `:651`·원장대조 `:43` |

### 1.4 사고 보고 → 검토 → 개선

| 항목 | 실측 | 근거 |
|------|------|------|
| 보고 | `SafetyIncident` — `type`·`severity`·`status`·`location` 전부 자유 문자열 · 보고자 권한 `safety:incident:report` · 읽기에서 `reporterId` 전 경로 차단(익명성) | `schema.prisma:6302` · `patient-safety.select.ts` |
| 🔴 상태기계 없음 | `UpdateIncidentStatusDto.status` 는 `@IsString` — 어떤 문자열도 저장 · 화면에만 REPORTED/INVESTIGATING/RESOLVED/CLOSED 라벨 | `dto/patient-safety.dto.ts:113-117` · `safety/page.tsx:90` |
| 🔴 우회 경로 | 워크그룹 알림 확인이 `alert-safety-<id앞부분>` 접두 매칭으로 사고 상태를 RESOLVED/INVESTIGATING 으로 바꿈 — 클래스 역할(ADMIN·DOCTOR·NURSE)만, `safety:incident:review` 미검사 | `workgroup.service.ts:637-643` |
| 🔴 필드 공백 | 병동 FK · POA(입원 시 존재) · 위해 정도(harm level) · 검토 시각·종결 시각 · 담당자 · 위원회 검토 단계 **없음** → 낙상 "병동별 1,000재원일당" 산출 불가 · PSI 산출 불가 | `schema.prisma:6302` · `qi.service.ts:293` |
| 익명 보고 | `reporterId NOT NULL` — 완전 익명 불가(환자안전법 §14 자율보고 취지와 어긋남) | `schema.prisma:6305` |
| RCA | 1:1 · 기한 45일 기본 · 매일 08시 `rca.overdue` 경보 · 승인 시 `rcaCompleted` | `patient-safety.service.ts:104-210` |
| 검토 소요 | 첫 검토까지 시간 미측정(보드는 `oldestOpenAt` 만) | `safety-quality-board.service.ts:126` |
| 🔴 KOPS 보고 | 환자안전보고학습시스템 송신 **코드 없음** · 감염 축의 `LOCAL_RECORDED` 같은 정직 표식도 없음 | grep 0 |
| 사고→지표 | 사고 원장이 측정 원장에 쓰지 않음 · 원장대조만(전 기간·분모 없음) | `indicator-ledger.ts:43-55` |

### 1.5 감염·간호·수술·응급·환자경험 공급원

| 공급원 | 산출 위치 | 저장 | 측정 원장 연결 |
|--------|----------|:---:|:---:|
| 손위생 수행률 | `infection-control.service.ts:1241`(역할·순간·부서 층화 · 표본 0 = null) | ✗ | ✗ |
| HAI(CLABSI·CAUTI·VAP) | `getKonisStats` — 건수만 · 분모 null | ✗ | ✗ |
| 낙상·욕창 재평가 준수 | `risk-reassessment` overdue·stats | ✗ | ✗ |
| Braden | `NursingAssessment.bradenScore` 단일 컬럼 · 원장 없음 | — | ✗ |
| 보호대 점검 | 30분 크론 · 점검 원장 | ✓ | ✗ |
| 수술 질(수술실·기록·회복실) | `surgery-monitor.service.ts:204` 요청 시 산출 | ✗ | ✗ |
| PACU 질(PONV·저체온·호흡기 사건) | `pacu.service.ts:1025` 최근 100건 | ✗ | ✗ |
| 응급(도어투닥터·6h 초과·입원율) | `qi.service.ts:100-138` · 도어투트리아지 `journey-analytics:179` · LWBS **없음** | ✗ | ✗ |
| 검사 TAT·위급값 확인 소요 | `cpoe-quality.compute.ts:152/169`(중앙값·p90) · 진단 보드·병리 각자 | ✗ | 원장 키 아님 |
| 재입원 30일 | 3벌 | ✗ | ✗(목표 5.0 하드코딩) |
| HSMR·PSI | `available:false`(사망 처분 필드 없음 · POA 없음) — **정직** | — | — |
| 사망 집담회 기록 | 없음(MDT·호스피스 회의만) | — | — |
| 만족도·NPS | `SatisfactionSurvey` · 🔴 `npsFrom` 이 응답 0 에 **0** 반환(null 아님) | ✓ | ✗ |
| VoC | `COMPLAINT` 건수만 원장대조 · SurveyActionItem 승격은 QI 와 무관 | ✓ | ✗ |
| 데이터 완결성 | 17도메인 · 매일 06시 `QualityMetricSnapshot` — **유일한 자동 영속화** · 안건 상정 연결 | ✓ | ✗(성격이 다름 — 연결 안 함) |

### 1.6 위원회·보고·인증·역할

| 항목 | 실측 | 근거 |
|------|------|------|
| QPS 바인딩 | `MASTER_DATA:quality-indicator`(create/update) 집행 가능 · 표면 매핑 QPS | `governance-enactment.service.ts:62,227-243` |
| 보고서 | `POST /qi/report` JSON 즉석 조립 · 미보존·미버전·PDF 없음 · **부르는 화면 0** · 회의록 봉인(`seal-minutes`)에 QI 첨부 없음 | `qi.service.ts:691-745` · `gld.controller.ts:83` |
| 경영 화면 | `/executive` 는 사고·감염 테이블을 직접 읽고 QI 원장은 읽지 않음 | `executive.service.ts:646-721` |
| 인증 | `AccreditationItem` 8항목 카탈로그 · 상태 4종 · 자유 텍스트 `evidence` · **ME 수준·점수·첨부·이력·담당·기한 없음** · 갱신은 덮어쓰기 | `schema.prisma:6342` · `qi.service.ts:441-551` |
| 인증↔지표·정책 연결 | 결정 근거 `{legal, accreditation, evidence}` 자유 문자열 · FK 없음 | `shared/decision-basis.ts:37` |
| 적정성 평가(HIRA) | `available:false`(결과 원천 미등록) — 지표 세트·추출·제출 없음 | `qi.service.ts:269-283` |
| 역할 | QI 전담 역할 없음 — `qi:measure:write` ADMIN·NURSE, `qi:measure:void` ADMIN · 지표 정의 ADMIN · 부서·위원 스코프 없음 | `permission.types.ts:124-125,229,297` |
| 감시 | 데이터 완결성 탐지기에 **QI 측정 누락**(지표×기간 미입력) 항목 없음 · 감시자 불변식에 qi/safety 0건 | `data-quality/quality-registry.ts` · `data-integrity-scan.sql` |

---

## 2. 갭 정리 — 종류를 가른다

🔴 **확정 결함**(화면이 사실과 다르게 말하거나 안전장치가 비어 있음 — 즉시 봉합)

| # | 결함 | 피해 | 근거 |
|---|------|------|------|
| D1 | 무효 측정이 `/admin/qi`·보고서·안전보드·상황판에 섞임 | 무효화한 값이 달성률·추이에 남는다 — "지우지 않고 무효화" 설계가 두 화면에서 무력 | `qi.service.ts:566` · `safety-quality-board.service.ts:27` |
| D2 | 사고 상태 자유 문자열 + 워크그룹 우회 | 검토 권한 없이 사고가 RESOLVED 로 닫힘 · 어휘 밖 상태 저장 | `dto:113` · `workgroup.service.ts:637` |
| D3 | 시드 upsert 가 `targetValue` 를 되돌림 | 위원회 의결 목표가 재시드에 소실 — "시드가 정책을 정한다" 함정 그 자체 | `seed.ts:1238` |
| D4 | `npsFrom` 응답 0 → 0 | 표본 부재를 "NPS 0" 으로 말한다(P1) | `satisfaction.service.ts:415` |
| D5 | 원장대조가 전 기간 건수 | 월 측정 옆에 "낙상 12건(전 기간)" — 대조가 아니라 혼동 | `indicator-ledger.ts:29` |
| D6 | 재입원 목표 5.0 하드코딩 ≠ 원장 목표 | 원장 목표를 바꿔도 `/admin/qi` 는 5.0 으로 판정 | `qi.service.ts:405` |

🟠 **공백**(있어야 할 고리가 없음 — 설계·구현)

| # | 공백 | 선행 조건 |
|---|------|----------|
| G1 | 측정 출처(`source`)·기록자·산출 근거 없음 | 스키마 변경(nullable 추가) |
| G2 | 일반 지표 자동 산출 0 · 분모(재원일수·기구일수) 산출 없음 | 🧑 집계 기준 결정(§6 Q1·Q2) — **기준 없이 자동화하면 더 그럴듯한 거짓** |
| G3 | 층화 없음(병동·진료과) | G1·G2 와 함께(측정 행에 `stratum`) |
| G4 | 관리도·추이가 CPOE 만 | shared `pChart` 재사용 — 선행 없음 |
| G5 | PDCA 가 CPOE 키만 | `indicatorKey` → 지표 FK 또는 키 네임스페이스 확장 · 기준선 재집계 공급원 추상화 |
| G6 | 목표 미달·측정 누락·인증 기한 경보 없음 | 경보 등록부 등재(승인 UNAPPROVED → 사람) |
| G7 | 보고서 미보존·미출력·회의록 미연결 | 보고 스냅샷 원장 · 회의 안건 첨부 |
| G8 | 사고 원장 필드(병동·POA·위해 정도·검토/종결 시각·담당) | 스키마 변경 · 🧑 위해 등급 어휘(§6 Q4) |
| G9 | KOPS 보고 표식 없음 | 송신은 허가권자 결정 — 먼저 `LOCAL_RECORDED` 정직 표식 |
| G10 | 인증 ME·점수·첨부·이력·지표 연결 | 🧑 인증 체계 선택(§6 Q6) |
| G11 | QI 전담 역할·스코프 없음 | 🧑 역할 모델(§6 Q7) |
| G12 | 중복 산출(손위생 3·재입원 3·사고 4·DUR 2) | 공급원 함수 정본 하나로 수렴 |

🧑 **사람 결정**(시스템이 정하지 않는다 — §6)

---

## 3. 설계 — 고리를 잇는다

### 3.1 핵심 원칙

1. **측정 원장 하나(`QiMeasurement`)가 정본** — 모든 화면(`/quality`·`/admin/qi`·보드·상황판·경영·보고서)은 **같은 읽기 함수**(`QualityService.readMeasurements`: 무효 제외·기간 창·층 선택)를 거친다. 각자 Prisma 를 부르지 않는다.
2. **자동 산출은 "공급원 함수 → 측정 행"** 이고, 쓰기 전에 **분모가 0 이면 쓰지 않는다**(`null` 측정은 없다 — 행이 없는 것이 "산출 불가"다).
3. **출처를 적는다** — `source: MANUAL | AUTO | SEED | CPOE` · `computedBy`(함수 키·버전) · `evidence`(분자·분모의 원장 쿼리 요약). 자동 행은 수기로 덮지 못하고 **무효화+재산출**만.
4. **기록 ≠ 적용** — 위원회가 목표를 의결해도 반영은 집행 엔진(`quality-indicator` 바인딩)만. 화면은 **안건으로만** 올린다(CPOE 와 같은 길). ADMIN 직접 수정 EP 는 **기록 사유 필수 + QPS 사후 통지**로 좁힌다(막지는 않는다 — 막으면 수기 운영이 멈춘다).
5. **CPOE 고리를 일반화한다** — `CpoeQualityService.countPeriod` 같은 "기간·층 → {분자,분모}" 인터페이스를 **지표 공급원(`IndicatorSupplier`)** 으로 추상화하고, PDCA·SPC·월 기록·안건은 공급원이 있는 모든 지표에 같은 코드로 붙는다.

### 3.2 Track A — 측정 원장 정본화 (P0)

- **A1 무효 제외 수렴(D1)**: `qi.service.getIndicatorDashboard`·`generateQiReport`·`safety-quality-board`·상황판이 `QualityService.readMeasurements()` 를 쓴다. 가드: `qi/` 모듈 안의 `qiMeasurement.findMany` 직접 호출 0(구조 가드).
- **A2 `source`·`computedBy`·`stratum`** 컬럼(nullable · 기존 행은 `MANUAL`, 시드는 `SEED` 로 백필 — 시드 생성기도 함께 고친다). `@@unique([indicatorId, period])` → `[indicatorId, period, stratumKey]`(병원 전체 = `''`).
- **A3 시드 보호(D3)**: upsert `update` 에서 `targetValue` 제거(정의 변경은 위원회 경로). 가드: 시드 파일에 `targetValue` 가 `update` 블록에 없음.
- **A4 목표 정본 하나(D6)**: 재입원 등 `qi.service` 운영지표가 판정할 때 `QualityIndicator.targetValue` 를 읽는다(없으면 판정 없음 · 5.0 삭제). `qi.targets.*` 는 **운영 임계**로 이름을 바꾸지 않되 문서에서 QI 목표와 구분한다.
- **A5 원장대조 기간화(D5)**: `indicator-ledger` 카운터에 `period` 를 넘겨 그 달 건수만 — 분모가 있는 지표는 A6 이후 자동 산출로 대체되고, 대조는 **수기 입력에만** 남는다.
- **A6 NPS 정직(D4)**: 응답 0 → `null` + 분모 병기.

### 3.3 Track B — 자동 산출·분모·층화 (P1 · 🧑 Q1·Q2 선행)

- **B1 분모 원장**: 월×병동 **재원일수**(`Admission.admitDate~dischargeDate` ∩ 월 · 병동은 `BedAssignment` 이력으로 — 전동 반영) · 월×병동 **기구일수**(🧑 Q2: `HaiCase.deviceInsertedAt`·제거 시각 원장이 없다 → 기구 삽입/제거 기록 신설 전까지는 **산출 불가로 둔다**. 수기 분모 입력을 허용하되 `source=MANUAL`). 재원일수는 매일 자정 스냅샷(`PatientDaySnapshot` — 재계산 가능하되 봉인된 달은 고정).
- **B2 공급원 등록부 `indicator-suppliers.ts`**: 지표 키 → `{numerator(period, stratum), denominator(period, stratum), unit, caveat}`. 1차 등재(원장 어휘 실측 확정분만): 낙상·투약오류·욕창(사고 원장 · 분모 재원일수) · 손위생(관찰 원장) · 필수교육 · 환자불만 · 만족도 · CPOE 16(기존 `countPeriod` 래핑). **매핑 없는 지표는 등재하지 않는다**(VAP/CLABSI 는 기구일수 전까지 침묵).
- **B3 월 마감 크론**: 매월 1일 06:30 전월분을 공급원이 있는 지표 전부 `AUTO` 로 기록(분모 0 은 기록 안 함 + 운영자 알림 "산출 불가 n지표"). 이미 수기 행이 있으면 **덮지 않고** 보고서에 "수기·자동 병기(차이 Δ)" 로 보여 준다 — 어느 쪽이 맞는지 시스템이 판단하지 않는다.
- **B4 층화**: 병동(`Ward`)·진료과(`User.department` 또는 `Admission` 파생) · 응급/외래/입원 구분. 측정 행에 `stratumKey`(`ward:<id>` 등). 화면은 병원 전체 기본, 층 펼치기.
- **B5 중복 산출 수렴(G12)**: 손위생·재입원·사고 건수·DUR 은 B2 공급원 함수 하나를 부른다. 가드: 각 중복 자리의 자기 쿼리 제거(파일별 동결).

### 3.4 Track C — 분석·판정·경보 (P1)

- **C1 관리도 일반화**: shared `pChart` 를 `/quality` 지표 상세에 — 완결 달 중심선·±3σ·한계 밖·8점 연속(CPOE 와 같은 규칙) · 분모 작은 달은 표식.
- **C2 목표 미달 경보**(G6): 경보 등록부 `QI_TARGET_MISSED`(tier 2 · 대상 ROLE QPS 위원·지표 담당자 · 월 마감 때 1회 · dedup 지표×기간) · `QI_MEASUREMENT_MISSING`(공급원 없는 지표가 전월 미입력 — 담당자) · `ACCREDITATION_REVIEW_DUE`(G10 이후). 전부 `approvedBy: UNAPPROVED` 로 등재 → 사람 승인.
- **C3 데이터 완결성 탐지기에 `qi.measurementMissing`**(지표×전월 미입력 수 — 수기 지표만 분모).

### 3.5 Track D — 개선(PDCA)·보고·환류 (P1~P2)

- **D1 PDCA 일반화(G5)**: `QiImprovementAction.indicatorKey` 를 `indicatorId FK`(QualityIndicator) 로 — CPOE 지표도 원장에 등재돼 있으므로 키→id 매핑으로 이관. 기준선·효과 확인 재집계는 **공급원이 있는 지표만** 서버가 하고, 공급원 없는 지표는 **수기 기준선 입력**(출처 MANUAL 표식) 허용. 전이 어휘·CHECK→ACT 효과 확인 필수·종결 사유는 그대로.
- **D2 보고서 원장 `QiReportSnapshot`**(G7): 기간·생성 시각·생성자·본문 JSON·**읽은 측정 행 id 목록**(재현성) · 상태 DRAFT→SUBMITTED(회의 안건 첨부 시)→SEALED(회의록 봉인과 함께 sha256). `POST /qi/report` 는 스냅샷을 만들고, 화면(`/quality` 보고 탭)이 목록·열람·인쇄(`/print/qi-report/:id`)를 제공. 회의 안건 `sourceRef{type:'QI_REPORT'}` 추가.
- **D3 지표 담당자**(`QualityIndicator.ownerId`·`committeeCode`) — 경보·PDCA 기본 담당·보고서 환류 대상.
- **D4 경영 화면**: `/executive` 질 섹션은 측정 원장 읽기 함수 경유(직접 테이블 읽기 제거).

### 3.6 Track E — 사고 보고 흐름 (P0 결함 → P1 확장)

- **E1 상태기계(D2)**: shared `INCIDENT_STATUS = REPORTED → UNDER_REVIEW → ACTION_PLANNED → RESOLVED → CLOSED`(+`REJECTED` 사유) · DTO `@IsIn` · 서비스 전이표 · 조건부 `updateMany`(동시 409) · `reviewedAt/By`·`closedAt/By` 기록. 워크그룹 알림 확인은 **사고 상태를 바꾸지 않는다**(확인 기록만).
- **E2 필드 보강(G8)**: `wardId`(FK) · `harmLevel`(🧑 Q4 어휘 — 결정 전엔 nullable·미기록) · `poa`(🧑 Q5) · `reviewerId`. 입력 폼 초기값 미선택.
- **E3 검토 소요 지표**: 보고→첫 검토 중앙값·p90(측정 원장 지표 "사고 검토 소요시간" 등재 후보 — 🧑 목표).
- **E4 익명 보고**(🧑 Q3): `reporterId` nullable + `anonymous` 플래그 — 익명이면 본인 조회도 불가함을 보고 시 고지.
- **E5 KOPS(G9)**: 송신 코드가 없다는 사실을 화면에 — 사고 상세 "KOPS 보고: 미구축(원내 기록만)" · `externalReport{status:'LOCAL_RECORDED', at:null}` 정직 표식(감염 축 `external-reporting.ts` 어휘 재사용). 송신 채널은 허가권자 결정(§6 Q8).
- **E6 위원회 검토**: 중대(SENTINEL) 사고는 자동으로 QPS/SAFE 안건 후보 생성(`sourceRef{type:'SAFETY_INCIDENT'}`) — 올리기는 사람.

### 3.7 Track F — 인증·대외·역할 (P2 · 🧑 선행)

- **F1 인증(G10)**: `AccreditationStandard`(체계·장·기준·ME) · `AccreditationAssessment`(항목×주기 · 점수·판정·근거 텍스트·첨부(`EvidenceAttachment` 재사용)·담당·기한 · 이력 append) · 지표 연결 `indicatorIds[]` · 정책 연결. 🧑 Q6 체계(KOIHA 4주기 / JCI) 결정 후 카탈로그 적재 — **조문·점수표를 코드에 박지 않는다**(조사한 것만 · 출처 URL · 시드는 카탈로그 골격만).
- **F2 적정성 평가**: 지표 세트 등재·추출은 **평가 항목별 사람 결정**(🧑 Q9) — 기획 범위에서는 "자료 원천 미등록" 정직 유지 + 등재 틀만.
- **F3 역할(G11)**: 🧑 Q7 — ① `UserRole` 에 `QI_STAFF` 신설 vs ② 권한 키(`qi:indicator:write`·`qi:report:write`·`safety:incident:review`) + 위원회 위원 스코프. 권고 없음 — 선택지와 결과만(§6).

---

## 4. 데이터 모델 변경 요약

| 모델 | 변경 | 손실 | Track |
|------|------|:---:|------|
| `QiMeasurement` | +`source` VarChar(10) · +`computedBy` · +`evidence` Json · +`stratumKey` VarChar(80) default `''` · +`createdBy` · 유일키 확장 | 없음(추가·기본값) | A2·B4 |
| `QualityIndicator` | +`ownerId` · +`committeeCode` · +`supplierKey`(공급원 등재 키 · nullable) | 없음 | D3·B2 |
| `PatientDaySnapshot`(신설) | `date`·`wardId`·`patientDays`·`computedAt` · 유일 `[date, wardId]` | — | B1 |
| `QiImprovementAction` | `indicatorKey` → `indicatorId` FK(이관 스크립트 · 키 보존 컬럼 유지) | 없음 | D1 |
| `QiReportSnapshot`(신설) | 기간·본문·측정 행 id·상태·sha256·생성자 | — | D2 |
| `SafetyIncident` | +`wardId` · +`harmLevel` · +`poa` · +`reviewerId`·`reviewedAt` · +`closedAt/By` · `reporterId` nullable(🧑) · `status` 어휘 가드 | 없음 | E1·E2·E4 |
| `AccreditationStandard`·`AccreditationAssessment`(신설) · `AccreditationItem` 이관 | 🧑 Q6 후 | — | F1 |
| 시드 | upsert `update` 에서 `targetValue` 제거 · 측정 시드 `source='SEED'` · 사고 시드 상태 어휘 정본 | — | A3 |

🔴 전부 **추가·nullable·기본값** — `prisma migrate diff` 미리보기 → 해당 SQL 만 백업 후 적용(CLAUDE.md 배포 규칙). `reporterId` nullable 은 널 아님으로 읽는 소비처(`patient-safety.select.ts` 경로)를 같은 배포에 넣는다.

## 5. API·화면 변경 요약

| 구분 | 변경 |
|------|------|
| API | `GET quality/measurements`(기간·층·출처 필터 · 모든 화면 공용) · `GET quality/indicators/:id/spc` · `POST quality/indicators/:id/agenda`(목표·정의 변경 안건 — CPOE 와 같은 길) · `GET/POST quality/reports`·`GET quality/reports/:id`·`POST .../submit` · `POST quality/improvements`(지표 FK 일반화 — CPOE 경로는 호환 유지) · `PATCH safety/incidents/:id/status`(전이 검증) · `GET quality/patient-days` |
| 크론 | 월 마감 자동 산출(1일 06:30) · 재원일수 일일 스냅샷(00:10) |
| 화면 | `/quality` — 지표 상세(관리도·층·출처 배지·수기/자동 병기)·보고 탭·PDCA 탭(CPOE 패널 재사용) · `/admin/qi` — 지표 대시보드는 `/quality` 읽기 함수로(중복 축소) · `/safety` — 상태 전이 버튼·병동·위해 정도·KOPS 표식 · `/safety-quality-board`·상황판·`/executive` — 공용 읽기 |
| 가드 | `qi/`·`executive/`·`command-center/` 에 `qiMeasurement.findMany` 직접 호출 0 · 시드 `targetValue` update 0 · 사고 상태 어휘 밖 저장 0 · 중복 산출 자리 파일별 동결 · 공급원 등록부 ↔ 지표 원장 이름 기계 대조 |

## 6. 사람 결정 — 결정 등록부 등재(2026-10-08 · `decision.registry.batch-2026-10-d.ts`)

🔴 **이 표는 정본이 아니다**(CLAUDE.md) — 정본은 등록부다. 키 이름은 등록부 그대로 적는다(초안의 `qi.autoVsManualConflict`·`qi.targetChangePath` 는 등재 시 `qi.autoManual.precedence`·`qi.indicator.directEdit` 가 됐다). 시스템은 **권고하지 않는다** — 선택지와 결과만.

**집행 경로(사람 몫을 별도 기능으로 분리)** — 위원회 결정은 선택지마다 `enact: { kind: 'CONFIG_CHANGE', target: { key, newValue } }` 를 든다. 결정 화면 → 위원회 안건(선택지 상속) → 의결 → 집행 엔진(`GovernanceEnactmentService`)이 설정을 바꾸고, 기능은 **설정만 읽는다**. 설정 키는 `DEFAULTS` 와 위원회 표면(`config:<key>` → QPS·IC·SAFE)에 등재돼 있고, 셋의 일치는 `qi-flow-p1.spec.ts` 가 기계 대조한다. 화면은 `GET /api/v1/quality-flow/settings` 로 "정해짐 / 아무도 정하지 않아 기본값 / 읽기 실패"를 가른다.

| 등록부 키 | 층 | 바인딩 설정 | 결정 전(기본) 동작 |
|-----------|----|-------------|--------------------|
| `qi.autoMeasure.denominator` | 위원회(QPS) | `qi.autoMeasure.incidentDenominator` | 사고율 공급원 `available:false`(DENOMINATOR_UNSET) · 분자만 대조 근거 |
| `qi.autoMeasure.enable` | 위원회(QPS) | `qi.autoMeasure.enabled` | 월 마감 크론 미실행(관리자 수동 마감은 가능 — 사람의 행위) |
| `qi.deviceDays.source` | 위원회(IC) | `qi.deviceDays.source` (+ 운영 사실 `qi.deviceLedger.coverageFrom`) | 기구일수 입력 닫힘 · CLABSI/CAUTI/VAP 율 산출 불가 · DEVICE_LEDGER 선택 시 원장 전수 기록 시작일 이후 달만 |
| `qi.autoManual.precedence` | 위원회(QPS) | `qi.autoManual.precedence` | BOTH(수기 정본·자동 병기) |
| `qi.indicator.directEdit` | 위원회(QPS) | `qi.indicator.directEdit` | ALLOW_WITH_REASON · AGENDA_ONLY 면 직접 수정 409 |
| `safety.anonymousReport` | 위원회(SAFE) | `safety.incident.anonymous` | 익명 체크 미노출(비공개 보고만) |
| `safety.harmLevelScale` | 위원회(SAFE) | `safety.harmLevelScale` | 위해 정도 미기록(입력 시 400) |
| `accreditation.framework` | 경영 | `accreditation.framework` | 인증 기준 등록 409 |
| `safety.poaFlag` | 위원회(MRC) | (코드 변경) | PSI 산출 불가 유지 |
| `qi.staffRoleModel` | 경영 | (코드 변경) | 기존 역할 유지 |
| `safety.kopsTransmit` | 허가권자 | (바인딩 없음) | `LOCAL_RECORDED` 표식 · 송신 코드 없음 |
| `qi.hiraIndicatorSet` | 위원회(QPS) | (항목별 등재) | 적정성 평가 `available:false` 유지 |

## 7. 판정 규칙 준수 (CLAUDE.md) — 이 기획이 지킬 것

- **표본 부재 = 행 없음·`null` · 0 아님** — 분모 0 은 측정을 쓰지 않는다 · NPS 0 → null · 관리도는 완결 달만.
- **기준 없이 자동화하지 않는다** — Q1·Q2 결정 전 분모 산출 코드는 만들되 **기록 크론은 켜지 않는다**(config `qi.autoMeasure.enabled` 기본 OFF · 결정 집행 바인딩).
- **기록 ≠ 적용** — 목표 변경은 안건·의결·집행 엔진 경유 · 화면은 안건만.
- **수기 입력이 틀렸다고 단정하지 않는다** — 자동값은 **병기**(Δ) 하고 판단은 위원회(Q10).
- **같은 사실에 정본 하나** — 측정 읽기 함수 하나 · 공급원 함수 하나 · 가드로 직접 호출 0 동결.
- **가짜 게이트 금지** — 사고 상태 전이는 서버가 검증·기록한다(화면 라벨만 있는 지금은 게이트가 아니다).
- **시드 생성기를 고친다** — 목표 되돌림·상태 어휘는 시드에서 고친다.
- **조사한 것만 적는다** — 인증 조문·점수표·KOPS 서식은 코드에 넣지 않는다(출처 URL · 카탈로그 골격만).
- **재주입으로 가드를 검증한다** — 무효 누수·시드 되돌림·상태 우회 셋은 재주입 실패를 확인하고 기준선을 동결한다.

## 8. 우선순위 로드맵

| 단계 | 내용 | 선행 |
|------|------|------|
| **P0 (결함 봉합 · 즉시)** | A1 무효 제외 수렴 · A3 시드 보호 · A4 재입원 목표 정본 · A5 원장대조 기간화 · A6 NPS · E1 사고 상태기계+워크그룹 우회 봉합 · E5 KOPS 정직 표식 · 결정 등록부 11키 등재 | 없음 |
| **P1 (고리 잇기)** | A2 출처·층 컬럼 · B1 재원일수 스냅샷 · B2 공급원 등록부(실측 확정분) · B3 월 마감 크론(기본 OFF) · B5 중복 수렴 · C1 관리도 · C2 경보 등재(승인 대기) · C3 측정 누락 탐지 · D1 PDCA 일반화 · D3 담당자 · E2 사고 필드(어휘 결정분만) | Q1(분모) 결정 → 크론 ON |
| **P2 (보고·환류)** | D2 보고서 스냅샷·인쇄·회의 첨부 · D4 경영 화면 공용 읽기 · E3 검토 소요 지표 · E6 중대 사고 안건 후보 · B4 층화 화면 | Q10 |
| **P3 (인증·대외·역할)** | F1 인증 모델·카탈로그 · F2 적정성 틀 · F3 역할 · E4 익명 보고 · B1 기구일수 | Q3·Q6·Q7·Q2 |

## 9. 범위 밖

- HSMR·PSI 실산출 — 사망 처분 필드·POA 가 없다(정직 `available:false` 유지 · Q5 뒤 재검토).
- 전국 벤치마크 — 외부 데이터 계약(사람).
- KOPS·KONIS 실송신 — 허가권자 결정·채널 구축 후(§대외발신 3조건).
- `data-quality` 탐지기와 `quality` 측정 원장 통합 — 성격이 다르다(선행 기획 §1.2 유지).
- 간호 지표 전용 모듈 신설 — 본 기획의 공급원 등록부(B2)에 간호 지표(낙상·욕창·재평가 준수·초기평가 24h)를 등재하는 것으로 갈음한다. 별도 모듈은 만들지 않는다(옆에 약한 것을 만들지 않는다).

## 10. 구현 결과 (2026-10-08 · P0 `e8320d42f` + P1~P3 이번 커밋)

**고리 상태** — 정의 → 목표 → 측정 → 분석 → 판정 → 경보 → 개선 → 보고 8단계가 일반 지표에서도 이어진다. 사람 결정에 걸린 칸은 "결정 전" 상태로 **닫혀 있고 그 사실을 말한다**(값을 지어내지 않는다).

| 단계 | 구현 | 사람 몫(분리) |
|------|------|---------------|
| 정의 | 지표 담당·위원회·공급원 컬럼 · 화면 직접 수정은 사유 5자+QPS 통지(`QI_DEFINITION_CHANGED`) | `qi.indicator.directEdit` |
| 목표 | 화면은 바꾸지 않는다 — 후보 1~3 + "정하지 않음"을 QPS 안건으로(`MASTER_DATA quality-indicator` 집행) | 위원회 의결 |
| 측정 | 출처 칸(`source`·`sourceKey` MANUAL/AUTO 나란히·`computedBy`·`evidence`) · 지표 공급원(`IndicatorSupplierService`: 사고율·손위생·기구 관련 감염·불만) · 재원일수 일일 스냅샷(덮은 날 수 확인 · 0명 날도 기록) · 기구일수 월 입력 | 분모·기구일수 원천·자동 크론 |
| 분석 | 관리도 p/u(지표 종류대로 · u 는 한계를 [0,1]로 자르지 않는다) | — |
| 판정·경보 | 월 마감이 그 달 정본 행으로 판정 → `QI_TARGET_MISSED`(담당+QPS 위원+정책 역할)·`QI_MEASUREMENT_MISSING` · 산출 불가는 경보 없음 | 정본 규칙(`precedence`) |
| 개선 | PDCA 를 일반 지표로(공급원 있으면 서버 재집계 · 없으면 사람이 센 수 · 출처 '수기') | — |
| 보고 | 보고서 원장(본문·읽은 측정 행 id·sha256·인증 자체 평가 요약) · 인쇄 `/print/qi-report/[id]` · QPS 안건 제출(DRAFT 선점·실패 시 되돌림) | 위원회 접수·조치 요구 |
| 사고 | 병동·위해 정도·익명(결정 게이트) · 첫 검토/종결 시각 · 검토 소요(중앙값·p90·n·대기) · SAFE 검토 안건(식별정보·서술 본문 제외) · 보고 폼 유형·중증도 미선택 시작·로컬 시각 | 익명·척도·KOPS 송신 |
| 인증 | 기준·자체 평가 원장(덧붙이기 · 부분/미충족 근거 필수 · 평가자 본인 확인 불가) · 기준 문구는 원문 보고 입력(시드 없음) | 체계 선택 |

**남은 것(구현하지 않은 것과 이유)**
- POA·QI 역할·KOPS 송신·적정성 평가 항목 — 코드 변경·허가권자 결정 선행(§6).
- 운영: 마이그레이션 `20261008000001_qi_flow` 적용 후 재원일수 과거 기간 재계산(관리자 `이 달 다시 세기`·`POST patient-days/rebuild`)이 있어야 재원일수 분모가 찬다.

### 10.1 남은 몫 마무리 (2026-10-09)

- **기구 삽입·제거 원장**(`DeviceLine` · 입원 상세 '삽입 기구' 패널 · `quality-flow/device-lines` 4 EP) — 결정 선택지 DEVICE_LEDGER 에 `CONFIG_CHANGE` 집행 대상을 달았다. 원장 기구일수는 **자정 규약**(재원일수와 같음)으로 세고, 감염관리실이 선언하는 전수 기록 시작일(`qi.deviceLedger.coverageFrom` · IC 표면) 전이거나 미설정이면 산출 불가로 남는다(일부만 기록된 원장을 분모로 쓰면 감염률이 부풀려진다). 기록 자체는 결정과 무관한 임상 사실이라 받는다.
- **병동 층** — 사고율 분모가 재원일수이고 그 달 스냅샷이 다 찼을 때만 병동별(`stratumKey` = 병동 id)로 기록한다. 병동이 비어 있는 사고는 어느 병동에도 넣지 않고 수만 센다. 판정·경보는 병원 전체 칸만 쓴다(층은 분석용). 층 기록 실패는 병원 전체 칸을 "산출 불가"로 바꾸지 않는다.
- **인증 정본 하나로** — `/admin/qi` 인증 탭이 새 원장을 먼저 보이고, 이전 체크리스트(덮어쓰기·이력 없음)는 이전 방식이라고 밝힌다(지우지 않음).

### 10.2 사람 몫의 경로 (2026-10-09)

사람이 할 일을 대신하지 않고, 사람이 끝까지 할 수 있게 경로를 점검·보완했다.
- **결정 의결** — 결정 화면 → 위원회 상정(선택지·집행 대상 상속) → 의결 → 집행 엔진 → 설정. 배치 10-D 선택지 22개가 엔진 검증과 실제 소비 코드까지 먹는지 기계 대조(미설정과 같은 동작 0).
- 🔴 **범용 설정 저장이 값을 검사하지 않았다** — 기능이 모르는 값도 "정해짐"으로 저장됐다 → shared 규칙 하나로 설정 저장·집행 엔진 양쪽에서 거른다. 결정 현황은 **위원회 의결 반영 / 관리자 직접 변경**을 가른다(막지 않고 드러낸다).
- **기록 시작일 선언**(`qi.deviceLedger.coverageFrom`) — 관리자 설정 화면 '품질' 분류에서 입력(형식·미래 검사).
- **경보 승인** — 코드 상수뿐이던 승인을 원장(`AlertApproval`)으로: 근거 필수·그때 값 snapshot·코드가 바뀌면 재승인 필요·철회는 사유.

### 10.3 결정 선행 몫 (2026-10-09)

- **POA** — 결정 `safety.poaFlag` 를 설정(`safety.poa.required`, MRC 표면)에 묶었다. 퇴원요약에 진단별 POA(입원 기간 진단 코드별) · 필수일 때만 서명이 빈 진단을 말하며 거부. 🔴 PSI 는 지표별 코드셋·제외 기준(외부 원문) 등재 전까지 산출 불가 유지. 퇴원요약 서명 실패에 처리가 없던 결함도 함께 봉합.
- **KOPS** — 자동 송신은 허가권자 결정·채널 사양 선행이라 만들지 않았다. KONIS 와 같은 규약으로 **사람이 KOPS 웹에 직접 보고한 접수번호·시각**을 기록(MANUAL_REPORTED · 기관 접수는 시스템이 확인하지 않음). 🔴 익명 사고를 전담인력도 열지 못하던 조회 결함(10-08 익명 도입 때 생김) 봉합.
- **적정성 평가** — 산출하지 않고 등재된 것을 보인다: '적정성 평가' 분류 질 지표와 최신 측정 · 측정 입력에 '외부 기관 통보 결과'(출처 EXTERNAL · 통보 문서·번호 필수) — 결정 `qi.hiraIndicatorSet` 의 두 선택지 운영 경로.
- **QI 역할(`qi.staffRoleModel`)은 만들지 않았다** — 선택지 ①(새 역할)은 역할 정본·nav·API 전수 배선이 필요한 횡단 변경이고, ②(권한 키+위원 스코프)는 기존 권한 체계로 이미 가능하다. 어느 쪽인지 정해진 뒤에 한다.

**여전히 남은 것(사람)** — 결정 12건 의결 · 기록 시작일 선언 · 경보 승인 기록 · 실화면 확인(운영 로그인은 사람) · PSI 코드셋·KOPS 채널 사양·적정성 항목 산식 원문.

