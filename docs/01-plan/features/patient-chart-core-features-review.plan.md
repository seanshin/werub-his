# 환자 차트 핵심 기능 검토·보완 계획

> 작성: 2026-07-05 / 상태: Plan v1.1 (v1.0 자체검토 반영 — 근거 재검증·조치 정정·리스크/검증/추정 추가)
> 성격: 환자 차트의 4개 기능 영역(①오더세트 ②주상병 입력 ③바이탈 표시 ④가족관계)을 **코드베이스에 그라운딩**해 검토하고, **빠진 부분(갭)만** 단계적으로 보완. 재작성이 아니라 델타 보완.
> 한 줄: 4개 영역 모두 **모델·BE는 상당 부분 구축**돼 있으나 갭이 **FE 입력·검증·청구/소스 연동**에 집중. 특히 **주상병은 진료화면이 구조화 진단을 저장하지 않아 EDI 청구 정합성 미충족**(최우선).
>
> **v1.1 정정 요지**: (a) G2-4 — billing은 이미 `PRIMARY 먼저·rank 순` 정렬함(과장 정정, 진짜 갭은 명시 필드·claim 미참조·기본값 연쇄). (b) G3-1 SpO2 — `spo2`(소문자)는 10여 화면이 정상 사용 중이므로 **API 개명 금지**(정상 화면 파손), 깨진 3개 FE만 소문자 통일.

---

## 0. 배경 — 이미 견고한 것 (재작업 금지)
- **오더세트**: `OrderSet`·`OrderSetUsage`·`FavoriteOrder` 모델, 11 EP(CRUD·승인·버전·복제·통계·추천), `admin/order-sets` 빌더(드래그·약물자동완성·CDSS). → 성숙.
- **주상병**: `EncounterDiagnosis.type`(PRIMARY/SECONDARY/DIFFERENTIAL)·`rank`·`certainty` 필드 + 문서/출력에서 '주/부' 매핑 표시.
- **바이탈**: `PreVisitVitals`·`ProgressNote.vitalSigns`·`EarlyWarningScore`·`ChronicObservation` + `VitalsTab`·`OverviewTab`·전문과 레이아웃.
- **가족관계**: `PatientContact`(보호자/응급)·`PatientRelation`(환자↔환자)·`PatientFamily`(포털)·`PatientGuardian`(포털 위임) 4모델 + `PatientInfoTab` 내 보호자/가족연결 UI + 포털 위임(Guardian JWT·BTG·감사) 배포 완료.
→ 위를 다시 만들지 않는다. 아래 **갭만** 다룬다.

---

## 1. 오더세트 관리·설정

### 현황
모델 `OrderSet`(`schema:6139`, items=JsonB·version·승인·useCount·evidenceLevel), `OrderSetUsage:6174`, `FavoriteOrder:6188`. BE `modules/order-set/`(11 EP·상태전이 검증). FE 관리 `admin/order-sets/page.tsx`(빌더·CDSS·승인), 적용 `orders/page.tsx`(실 처방+`/use`)·`encounter/new/components/OrderSetPanel.tsx`.

### 갭
| ID | 갭 | 근거 |
|----|----|------|
| G1-1 | **적용 경로 불일치**: `encounter/new` OrderSetPanel은 items를 **로컬 state 복사만**(실 처방·`/use` 미기록). `orders/page`만 완전. 동일명 컴포넌트 2벌 | `encounter/new/page.tsx:1598` vs `orders/page.tsx:980` |
| G1-2 | **itemsModified 항상 0 하드코딩** → 수정률 통계 부정확 | `orders/page.tsx:1005` |
| G1-3 | **금기·대상연령 안전장치 부재**: `OrderSet.ageGroup`·`contraindications` 필드/UI 없음 | schema grep 0 |
| G1-4 | **DTO `items: unknown`** — 서버 항목 검증 없음 | `dto/order-set.dto.ts:9` |
| G1-5 | `/order-sets/recommend`·`/stats` **FE 미사용**(진단 추천·통계 API 방치) | controller 50·42 |
| G1-6 | **item별 필수/CDSS 대상 플래그** 미구현(기획서 명시) | order-set-enhancement.plan §149 |

### 조치
- **✅ G1-1(구현 2026-07-06)**: 빌더가 약품 선택 시 `medicationCodeId`·code 저장(신규 세트 실 처방 코드 보유) + `encounter/new` 적용이 코드 보유 항목은 `addPrescription`으로 **실 처방 생성**(orders 화면과 동일 경로)·`/order-sets/:id/use` **사용통계 기록**(그간 누락분 해소)·레거시 코드미보유 항목은 이름 표시(수동 해석). e2e로 useCount 증가 검증. **잔여**: 두 OrderSetPanel 컴포넌트 완전 병합(동작은 정합)·레거시 세트 codeId 백필.
- **P1**: G1-2 itemsModified 실측.
- **✅ G1-3(구현 2026-07-06)**: `ageGroup`·`contraindications`(JsonB·manual SQL) + 빌더 입력(연령군·금기) + 적용 시 환자나이·금기 경고. e2e 저장 검증. **✅ G1-4(구현 2026-07-06)**: OrderSetItemDto+ValidateNested 검증 — 무데코레이터 items가 whitelist에서 strip돼 **빌더 오더세트 생성이 INTERNAL_ERROR로 깨져있던 버그 수정**(전 필드 데코레이트로 유실 방지). e2e 생성·보존 검증.
- **✅ G1-5/6(구현 2026-07-06)**: 진단코드 기반 추천 배너(`/recommend` FE·`RecommendedOrderSets`·공용 apply 재사용) + item별 필수/CDSS 플래그(DTO·빌더). **G1-2**(itemsModified 실측)·CP시드+codeId백필은 측정난이도/매칭리스크로 보류(관리자 큐레이션 권장).

---

## 2. 진단·처방 — 주상병 입력  🔴 최우선

### 현황
`EncounterDiagnosis.type`·`rank`·`certainty` 모델 존재(`schema:1232`). BE `encounter.service`가 `diagnoses[]` 수신 시 저장. 문서/출력(`print/diagnosis`·`EncounterRecordDoc:64`)은 `type`→'주/부' 표시. **그러나 이 표시는 seed 데이터에만 채워짐** — 실 진료 입력이 이를 생성하지 않음.

> **검증(v1.1)**: `useEncounters.ts` 업데이트 payload에 `diagnoses` 필드 **부재 확정**. web 전체에서 `diagnoses` 보간 지점(emergency·certificates 등)은 모두 **문서용 텍스트 배열**(예: `diagnoses:[chiefComplaint]`)로 `EncounterDiagnosis`를 생성하지 않음 → 정규 진료 UI의 구조화 진단 생성 경로는 **실질적으로 없음**(seed만 채움).

### 갭 (심각)
| ID | 갭 | 근거 |
|----|----|------|
| G2-1 | **🔴 진료화면이 구조화 진단을 저장하지 않음**: `encounter/new`가 진단을 **SOAP 'A' 자유텍스트로만** 받고, 저장 시 `diagnoses[]` 배열을 **전혀 전송 안 함** → `EncounterDiagnosis` 미생성(=청구 상병코드 미생성) | `encounter/new/page.tsx:1534,742`·`useEncounters.ts:12` |
| G2-2 | **주상병 지정 UI 전면 부재**: PRIMARY/SECONDARY 라디오·주상병 배지 없음(전 web grep 0) | — |
| G2-3 | **주상병 유일성 미보장**: DB 유니크·BE 검증 없음. `type` 생략 시 **전량 PRIMARY 저장** 결함 | `encounter.service.ts:33,122` |
| G2-4 | **명시적 주상병 필드·정식 청구 반영 부재**(정정): billing→ERP outbox는 **이미 `PRIMARY 먼저·rank 순` 정렬**해 `diagnosisCodes` 동봉(`:576,684` 주석 포함)이나 — ① **명시 `principalDiagnosisCode` 플래그 없이 순서 관례에만 의존**(하위에서 재정렬 시 주·부 소실) ② **`claim`/`insurance-claim` 모듈은 진단 자체를 미참조**(정식 청구 레코드에 상병 없음) ③ **G2-3(전량 PRIMARY 기본값)이면 이 정렬이 무의미**(연쇄 결함) | `billing.service.ts:576,684`·`claim.service.ts:98` |
| G2-5 | **DTO 협소**: `rank`·`certainty`·`DIFFERENTIAL` 미수용(rank 항상 1) | `create-encounter.dto.ts:5` |

> 참고: `clinical-chart-enhancement.plan.md`가 **이 갭을 이미 문서화**(진단 구분 라디오 `:259`·주진단 배지·Phase 1~4)했으나 **미구현**. 본 계획이 그 구현을 우선순위로 승격.

### 조치
- **P0(최우선·무점검창)**:
  - G2-1/2 `encounter/new`에 **구조화 진단 입력 블록** — KCD 검색·선택 + **주상병 라디오(단일)** + 부상병/감별 + certainty. 저장 시 `diagnoses[]` 전송(SOAP 'A' 병행 유지·비파괴).
  - G2-3 BE 검증: **주상병 정확히 1개**(없으면 rank 최소를 주상병 승격, 복수 PRIMARY 거부). `type` enum화(기본값 남용 제거).
  - G2-4 billing/EDI 페이로드에 **`principalDiagnosisCode` 명시 필드** 추가(기존 정렬 배열은 유지·순서 의존 제거) + **`claim`/`insurance-claim`에 주상병 반영**(정식 청구 레코드). ※ G2-3 선결 없이는 정렬이 무의미하므로 **G2-1→2-3→2-4 순서 준수**.
- **✅ G2-5(구현 2026-07-06)**: Prescription에 `diagnosisCodeId`(manual SQL·관계) — 처방 추가 시 주상병 자동 연결(SOAP A↔P 근거). DTO rank·certainty·DIFFERENTIAL은 기수용(주상병 P0).

> **상병 구분·확실도·KCD 표현법 검토 (2026-07-05)**
> - **KCD 정합(정정 완료)**: `diagnosis_codes`에 동일 질병이 KCD-8(I10)·ICD-10(I10)·ICD-11(BA00) 3중 존재. `/codes/diagnosis` 무필터 + `code asc` 정렬로 **ICD-11(BA00)이 먼저 반환·저장**되던 결함 → **주상병 검색을 `codeSystem=KCD-8`로 제한**(EDI 상병코드는 KCD). e2e로 I10 반환 확인.
> - **구분 표현(type)**: 주상병=PRIMARY·부상병=SECONDARY·감별=DIFFERENTIAL — 모델·UI 구현.
> - **확실도 표현(certainty·구현 완료)**: KCD 코드 자체는 확진/의증을 구분하지 않으므로 **상병 부가속성**으로 표현이 정석 → `certainty` 확진(CONFIRMED)·의증(PROVISIONAL)·R/O(RULE_OUT) UI 추가·저장·KCD 표기(의증·R/O). e2e 검증.
> - **✅ 배제 확정(EXCLUDED·구현 완료)**: certainty에 EXCLUDED(배제) 추가(확진→의증→R/O→배제 순환) — VarChar라 스키마 무변경. FE 취소선 표기. e2e 검증.
> - **✅ 청구 certainty 전달(구현 완료)**: billing ERP outbox에 `diagnosisDetails`(code·type·certainty) 동봉(하위호환·기존 `diagnosisCodes` 유지). **배제(EXCLUDED) 상병은 청구 상병코드에서 제외**(배제=청구 대상 아님).
> - **✅ 문서 표기(구현 완료)**: 진단서 print·진료기록지(EncounterRecordDoc)·의무기록 발급(issuance)에 "상병명 의증"/"(R/O)"/"(배제·취소선)" 표기 + 감별 유형 보정.
> - **✅ type↔certainty 직교화(구현)**: 감별(DIFFERENTIAL)·배제(EXCLUDED)는 청구 상병코드에서 제외(주/부 & 확진/의증/R-O만), diagnosisDetails엔 전체 기록 + UI 가이드.
> - **✅ 의증 청구 안전장치(구현)**: 서명 시 의증/R-O 주상병 경고(삭감 방지). ※ 청구 자동 재발행(정정 propagation)은 미시행 처방 라인 생성 위험 → billing/ERP 협의로 분리(수동 reemit EP는 certainty 반영됨).
> - **✅ KCD 시드 확충(구현)**: 다빈도 외래 상병 51종 추가(운영 KCD-8 76→127건). 멱등 standalone `kcd-expand.ts`. **잔여**: 실 KCD ~2만 전량은 공공데이터 임포트 필요(대량 시드 별도).

---

## 3. 바이탈 사인 표시 영역

### 현황
소스 **최소 5개 정형 + 10여 개 JSON 필드로 파편화**(통합 `VitalSign` 모델 없음):
- `PreVisitVitals`(`schema:8087`, 외래 간호 측정)·`FlowSheetEntry`(`9815`, 입원 간호·별개 저장소)·`EarlyWarningScore`(`4867`, NEWS2·바이탈 3중 중복저장)·`ChronicObservation`(`1797`, 만성 SBP/DBP/WT/BMI 시계열)·`ProgressNote.vitalSigns`+10여 모델의 `vitalSigns Json?`.
- FE: `VitalsTab.tsx`는 **PreVisitVitals(외래)만** 조회(`:98`)·자체 SVG 차트. 입원 타임라인은 별도 `VitalTrendChart`(Chart.js). `OverviewTab` 최신 카드(`:400`)·진료화면 바이탈 카드(`encounter/new:334`)·NEWS2(`workstation/nursing`)가 각기 다른 소스·필드.

### 갭
| ID | 갭 | 근거 |
|----|----|------|
| G3-1 | **🐛 SpO2 케이싱 불일치(실 버그 추정)**: `PreVisitVitals.spo2`(소문자)·API raw 반환(리네이밍 없음)인데 FE는 **`spO2`(대문자 O)** 로 읽음 → **SpO2 항상 `-` 표시·경고 미동작 가능** | `schema:8097`·`nurse-station.service.ts:388`·`VitalsTab.tsx:118`·`OverviewTab.tsx:424`·`encounter/new:359` |
| G3-2 | **통합 타임라인 부재**: `VitalsTab`이 외래 PreVisitVitals만 → **입원 FlowSheetEntry·EWS·만성 누락**(입원 중 바이탈이 "바이탈" 탭에 안 보임) | `VitalsTab.tsx:98` |
| G3-3 | **추이 API·차트 이원화**: 서버 시계열 API는 `chronic`(SBP/DBP/WT/BMI)뿐 — **HR·체온·SpO2·호흡·통증 추이 API 없음**. 차트도 `VitalsTab`(SVG) vs `VitalTrendChart`(Chart.js) 병존·인터페이스 불일치(`measuredAt/spO2` vs `recordedAt/spo2`) | `chronic.service.ts:18`·두 컴포넌트 |
| G3-4 | **정상범위·경고 임계값 화면마다 하드코딩·상이**: 정상범위 밴드는 VitalsTab **혈압에만**(HR/SpO2/체온 없음). BP 임계 `<90/>140`(VitalsTab) vs `≥180/≤80`(recordVitals) vs `≥140`(Overview) 제각각 | `VitalsTab:122`·`nurse-station.service:194`·`OverviewTab:416` |
| G3-5 | **미러링 누락**: 외래/입원 간호 측정 혈압·체중·BMI가 `ChronicObservation`으로 자동 미러링 안 됨(LAB·EWS-SBP만) → 만성 추이 공백 | `chronic-sync.service.ts:76` |

### 조치
> **✅ 구현(2026-07-06)**: G3-2 통합 바이탈 EP(`GET /patients/:id/vitals-timeline` — 외래·입원·EWS 소스병합, VitalsTab 소비·소스배지·EWS점수, e2e 11건 병합 검증). G3-4 정상범위 단일정책(`lib/vital-ranges.ts` 공용, VitalsTab·OverviewTab 통일). G3-1 SpO2는 앞서 완료.
- **P0**: G3-1 **SpO2 케이싱 버그 수정** — **깨진 3개 FE 파일(VitalsTab·OverviewTab·encounter/new, 총 17곳)을 소문자 `spo2`로 통일**. ⚠️ **API `serializeVitals` 개명(`spo2→spO2`) 금지** — `spo2`(소문자)를 정상 소비 중인 workstation(icu/triage/nursing/post-op)·inpatient 등 10여 화면이 파손됨(소비자 감사 완료). 즉시·저위험·임상 안전(SpO2 경고 복구). G3-2 **통합 바이탈 조회 EP**(`GET /patients/:id/vitals?source=all`) — PreVisitVitals·FlowSheetEntry·EWS·chronic을 **소스 태그와 시계열 병합**(신규 모델 없이 어댑터·읽기전용), VitalsTab이 소비.
- **P1**: G3-4 **정상범위·임계값 단일 정책**(공용 상수) + 표준 추이 컴포넌트 1벌(`VitalTrend`, 항목별 정상범위 밴드·EWS 배지) — VitalsTab/입원 타임라인 공용화. G3-3 HR/체온/SpO2/호흡/통증 시계열 지원.
- **✅ G3-3/5(구현 2026-07-06)**: G3-3 VitalsTab 전 바이탈 정상범위 밴드 통일(SparkLine·MultiLineChart 제거). G3-5 외래 간호 바이탈(혈압·체중·BMI)→`vitals.recorded`→ChronicObservation 미러링(chronic-sync 확장).

---

## 4. 가족관계 확인·설정

### 현황
- **행정(구현됨)**: `PatientContact`(`625` 스태프 보호자/응급)·`PatientRelation`(`650` 환자↔환자·양방향 조회 `reverseRelationship`)·`PatientFamily`(`6655` 포털 자가입력)·`PatientGuardian`(`6676` 포털 위임·accessScope·승인·BTG). FE `PatientInfoTab`의 보호자/응급 섹션(`:444`) + `PatientFamilyRelations`(`:223` 환자검색→연결→해제) + `EditPatientModal` 보호자 탭 + `patients/new` contacts. 포털/모바일 보호자 관리 포함. `guardian-proxy-access` 배포 완료(Match ~97%).
- **임상 가족력(부분)**: `Encounter.familyHistory`(`1074` 자유텍스트)·`PatientFamily.medicalHistory`(500자)만.

### 갭
| ID | 갭 | 근거 |
|----|----|------|
| G4-1 | **모델 4중 파편화**: `PatientContact`/`PatientRelation`/`PatientFamily`/`PatientGuardian`이 상호 비동기 → 한 가족 정보 중복·불일치 | 4모델 |
| G4-2 | **환자관계→위임접근 미연계**: 스태프가 확인한 친자(`PatientRelation`)가 `PatientGuardian` 법적 보호자 근거로 이어지지 않음 | patient vs portal 계층 |
| G4-3 | **관계 타입 협소**: PARENT/CHILD/SPOUSE/SIBLING 4종만. 조부모·손자·직계존속(의료법 §21 대상) 미지원 | `reverseRelationship` |
| G4-4 | **🔴 임상 가족력 비구조화**: `FamilyHistory` 모델·EP·차트 확인 탭 전무. 질환(KCD)·친등(1/2도)·발병연령 구조화 없음 → 검색·CDSS·유전위험 불가. 진료마다 재입력, 시계열 누적 UI 없음 | `schema:1074`·차트탭 44종에 부재 |
| G4-5 | **가족단위 통합조회·소아 연령특례 부재**: 가족 전체 한 화면 조회 없음, 14세 미만 자동권한 등 미구현 | — |

### 조치
> **✅ 구현(2026-07-06)**: G4-4 가족력 확인 탭(`GET /patients/:id/family-history` — 과거 encounter familyHistory 시계열, 환자차트 '가족력' 탭). G4-3 관계타입 확장(조부모↔손자녀·법정대리인↔피후견인, DTO·reverseRelationship·FE).
- **P0**: ~~G4-4 가족력 확인 탭~~ ✅.
- **✅ G4-2(구현 2026-07-06)**: 구조화 `FamilyHistory` 모델(관계+KCD 연결+발병연령+생존, manual SQL) + CRUD EP + 가족력 탭 구조화 섹션(KCD 검색·추가·삭제, 기존 텍스트 병행). e2e CRUD 검증.
- **P2**: G4-1/2 모델 정합(가족 단위 통합 뷰·`PatientRelation`↔`PatientGuardian` 연계), G4-5 가족단위 조회·소아 연령특례.

---

## 5. 우선순위·단계

| Phase | 범위 | 규모 | 게이트 |
|-------|------|------|--------|
| **즉시(버그)** | G3-1 SpO2 케이싱 수정(FE 3파일) | S(반나절) | 없음 |
| **P0**(무점검창·안전/정합) | G2-1~4 주상병 입력·검증·EDI(최우선) · G1-1/2 오더세트 적용 통합 · G3-2 통합 바이탈 조회 EP · G4-4 가족력 확인 탭(읽기) | L(주상병 M~L·나머지 S~M) | 없음 |
| **P1** | G1-3/4 금기·연령·DTO · G2-5 DTO·처방연결 · G3-3/4 바이탈 추이·정상범위 표준 · G4-4 구조화 가족력·G4-3 관계확장 | M~L(스키마+UI) | 스키마 변경(manual SQL) |
| **P2** | G1-5/6 · G3-5 미러링 · G4-1/2/5 모델정합·연계 | M | — |

> 규모: S=1일 이내·M=2~4일·L=1주+. 주상병 P0는 FE 입력 블록(M)+BE 검증·청구 반영(M)으로 area 중 최대.

**최우선(🔴/🐛)**:
1. **G2-1~4** — 진료화면이 구조화 진단을 저장하지 않아 **주상병이 청구에 실리지 않음**(EDI 심사 정합성). 4영역 통틀어 가장 치명적.
2. **G3-1(🐛 즉시)** — SpO2가 케이싱 불일치로 **화면에 표시·경고되지 않을 가능성**(임상 안전). 단일 파일 수정으로 즉시 해소 가능.
3. **G4-4** — 임상 가족력 비구조화(대학병원 HIS 핵심 정보 사장).

## 6. 운영 제약(준수)
- **db push 차단** → 신규 필드(ageGroup·contraindications·FamilyHistory·principalDiagnosisCode)는 **manual SQL + 서버 prisma generate**.
- **BE 수정 후 `nest build`**·배포=worktree rsync.
- 신규 모델 최소화 — 바이탈은 어댑터(읽기), 주상병은 기존 `EncounterDiagnosis` 활용.
- **비파괴**: 기존 SOAP·청구·차트 회귀 금지(주상병 정렬·검증은 default 안전값·SOAP 'A' 병행 유지).

## 7. 사람/조직 게이트
- EDI 청구 주상병 서식·심사 규칙 확인(billing/ERP 정합) · 가족력 구조화 항목셋(임상 합의) · 관계↔위임 연계 정책(법무·guardian-proxy).

## 8. 리스크·완화
| 리스크 | 완화 |
|--------|------|
| **주상병 입력 블록이 기존 SOAP 진료 흐름을 저해**(의사 입력 부담↑) | SOAP 'A' 자유텍스트 **병행 유지**, 진단 블록은 선택적·assessment KCD 자동추출(`:1082`)로 후보 제안. 단계적 롤아웃(전문과 파일럿) |
| **주상병 검증(1개 강제)이 기존 seed·레거시 데이터와 충돌**(복수/0개 PRIMARY 기존행) | 검증은 **저장 시점만** 적용(기존행 비파괴), 조회 시 rank 최소를 주상병 폴백. 마이그레이션은 리포트 후 수동 |
| **SpO2 FE 통일이 또 다른 대문자 소비자를 놓침** | 수정 전 `spO2` 전수 grep(현재 3파일 확정)·수정 후 회귀 확인. 통합 바이탈 EP에서 필드명 표준 1회 고정 |
| **billing `principalDiagnosisCode` 추가가 ERP 수신측 스키마와 불일치** | 기존 `diagnosisCodes` 배열 **유지한 채 필드 추가**(하위호환)·ERP 계약 회신 후 활성 |
| **통합 바이탈 EP 성능**(4소스 병합) | 읽기 전용·take 상한·소스별 인덱스(`patientId,measuredAt` 등 기존) 활용·필요 시 캐시 |
| **가족력 구조화 마이그레이션**(자유텍스트→코드) | 신규 `FamilyHistory` 병행·기존 텍스트 보존(비파괴)·소급 파싱은 후순위 |

## 9. 성공 기준·검증
- **주상병(P0)**: 진료화면에서 진단 선택→주상병 지정→서명 시 `EncounterDiagnosis`가 **type/rank로 실제 생성**되고, 서명 청구에서 `principalDiagnosisCode`가 채워지는지 **운영 e2e**(1건 진료→청구 payload 확인). "주상병 정확히 1개" 위반 시 422 차단.
- **SpO2(즉시)**: VitalsTab·Overview·진료화면에서 SpO2 실값 표시·이상치(<95) 경고 **재현**(현재 `-` → 수치). 소문자 소비 화면 10여 종 **회귀 무**.
- **오더세트(G1-1)**: `encounter/new`에서 오더세트 적용 시 실제 처방 생성 + `order_set_usages` 행·`use_count` 증가 확인(현재 미기록).
- **바이탈 통합(G3-2)**: `?source=all`이 외래+입원+EWS 바이탈을 **시각적으로 한 타임라인**에 표시(입원환자로 확인).
- **가족력 탭(G4-4)**: 과거 진료 `familyHistory`가 시계열로 누적 표시.

## 10. 테스트 요구
- **BE 단위**: 주상병 유일성 검증(0개→승격·복수→거부), billing `principalDiagnosisCode` 산출(정렬·기본값 케이스), 통합 바이탈 병합 어댑터(소스별 정규화).
- **회귀**: SpO2 소문자 소비 화면 스냅샷/필드 접근, 오더세트 적용 경로(로컬 vs 실처방) 통합 후 단일 동작.
- 신규 EP는 JwtAuthGuard+RolesGuard·환자 스코프 타 차트 EP 기준 정합(perf-security §3-A 규범).
- **여정 이벤트**: 주상병 확정·가족력 갱신 등 신규 임상 이벤트는 `JourneyService.emit` 발행 검토(저장소 규약).

---

## 11. 추가 요구사항 반영 (2026-07-05)

사용자 지정 3건. 조사 결과 **인프라(모델·BE)는 대부분 존재**하고 갭은 **FE·연동**. 각 기존 절에 편입.

### 11.1 진료기록 이미지 첨부·다운로드 (신규 영역 — 기존 §에 없던 항목)
**현황**: `EncounterAttachment` 모델 존재(`schema:1112` — `kind` SKETCH|IMAGE|FILE·`url`·`mimeType`·`note`·`uploadedBy`), `Encounter.attachments[]` 관계. BE EP **완비**: `POST/GET/DELETE /encounters/:id/attachments`(`encounter.controller.ts:107·118·125`). 업로드 저장소 EP 존재: `POST /upload/image`(multer diskStorage)·`POST /media/upload`(10MB). → **"다양하게 등록"은 kind 3종으로 이미 지원**.
**갭**:
| ID | 갭 | 근거 |
|----|----|------|
| G5-1 | **🔴 진료화면 이미지 첨부 FE 전무**: 업로드·갤러리·미리보기·다운로드 UI 없음(encounter 하위 grep 0). BE·모델은 있으나 사장 | `encounter/new` grep 0 |
| G5-2 | **다중 업로드·프리뷰 미지원**(단건 `POST /upload/image` → attachment 연결 흐름을 FE가 오케스트레이션해야) | upload.controller |
| G5-3 | **다운로드/뷰어**: url 기반 개별 다운로드·이미지 라이트박스 부재 | — |
**조치**:
- **P0**: `encounter/new`(및 차트 조회 탭)에 **이미지 첨부 블록** — 다중 파일 선택 → `POST /media/upload`(또는 upload/image) → 반환 url로 `POST /encounters/:id/attachments`(kind=IMAGE/FILE) → **썸네일 갤러리 + 다운로드 + 삭제**. mimeType 검증(이미지·PDF), 용량(기존 10MB) 준수.
- **P1**: 라이트박스 뷰어·SKETCH(캔버스 스케치)·서명본/외부검사지 kind별 배지. 다운로드는 서버 인증 경유(PHI, portal-imaging-export 선례의 토큰 방식 참고).

### 11.2 주상병 코드·설명 + 오더세트 관리·시드 (기존 §1·§2 확장)
**현황**: 주상병 = §2(G2-1~5). 오더세트 = §1 + **시드 이미 존재**(`seed.ts:2998` orderSets 배열 — `CP-IM-001 고혈압 초진` 등 dept/cat/`dx`(진단코드 I10)/items 포함). `DiagnosisCode`는 `nameKo`·ICD 매핑 보유(`schema:735`).
**갭(추가분)**:
| ID | 갭 | 근거 |
|----|----|------|
| G2-6 | **진단 선택 시 코드 설명(nameKo) 표시·검색 UI 부재**(주상병 입력 블록 G2-1의 필수 구성) | §2 |
| G1-8 | **오더세트-주상병 연동 미흡**: 시드에 `dx`(I10) 있으나 진료화면에서 **확정 주상병 기반 오더세트 추천**(`/recommend`) 미연결(G1-5와 동일) | seed `dx`·controller:50 |
| G1-9 | **시드 커버리지 점검**: 주요 진료과·상병별 CP 시드 충실도(현 내과 위주 추정) 확대 필요 | `seed.ts:2998` |
**조치**:
- **P0**: G2-6 주상병 입력 블록(§2 G2-1)에 **KCD 검색+코드/한글명 표시** 포함(DiagnosisCode.nameKo). G1-8 확정 주상병→`/recommend` 오더세트 배너(§1 G1-5 통합).
- **P1**: G1-9 과별·다빈도 상병 CP **시드 확장**(추가·멱등 standalone 시드, 메인 seed 비파괴 — dept-richness 선례).

### 11.3 오더세트에서 서류(진단서 등) 발급 (기존 §1 확장)
**현황**: 발급 인프라 존재 — `Certificate` 모델(`schema:3515`·type "진단서/소견서/입퇴원확인서"·content JSON)·`IssuedDocument`(`9996`)·`medical-record-issuance`·`document` 모듈·헤드리스 PDF(browserless). 오더세트 items type은 현재 **MEDICATION/LAB/IMAGING/ORDER**만.
**갭**:
| ID | 갭 | 근거 |
|----|----|------|
| G1-10 | **🔴 오더세트에 서류 발급 item type 부재**: 진단서·소견서 등을 오더세트 항목으로 담아 적용 시 **발급 흐름 트리거** 불가 | OrderSet items 4종 |
| G1-11 | **발급 연동**: 적용 시 `Certificate`/`IssuedDocument` 생성(주상병·처방 자동 프리필)·서명 게이트 연계 없음 | Certificate·sign |
**조치**:
- **P1**: OrderSet item에 **`DOCUMENT` type**(certType: 진단서/소견서/입퇴원확인서) 추가(items JsonB·DTO 확장). 빌더에서 서류 항목 편집.
- **P1**: 오더세트 적용 시 DOCUMENT item → **발급 초안 생성**(Certificate/IssuedDocument·환자·주상병(§2 연동)·담당의 프리필) → 기존 서명·발급 워크플로우로 인계(진단서는 §17 담당의 검증·전자서명 게이트 준수, medical-record-issuance 선례). 헤드리스 PDF 재사용.
- **게이트**: 진단서 서식·법정 요건(의료법 §17)·서명은 기존 발급 트랙 규칙 준수(신규 우회 금지).

### 우선순위 반영(§5 갱신)
- **P0 추가**: G5-1 이미지 첨부 FE(자립·BE 완비라 저위험 고효용) · G2-6 주상병 코드·설명(주상병 P0에 포함).
- **P1 추가**: G1-10/11 오더세트 서류 발급 · G1-9 시드 확장 · G5-2/3 뷰어.
- 권장 착수 순: **① SpO2(즉시)** → **② 이미지 첨부 FE(G5-1, 자립·빠른 가치)** → **③ 주상병 P0(G2·G2-6)** → **④ 오더세트 서류발급(G1-10/11)**.
