# 미검토 안전영역 스카우트 P2 — 모델 신설 기획서 (검증 반영본 v2)

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/prisma/schema.prisma:4520 · apps/api/prisma/schema.prisma:7516 model CodeBlueEvent · apps/api/prisma/schema.prisma:7540 model RrtActivation · 잔여: 잔여 P3 9건(ICU/ER SBAR·ER NEWS2·KTAS 재평가주기·QI 실집계·호스피스 마약 연동·파(CLI)

> 2026-07-20 · 6도메인 병렬 스카우트 HIGH 19건 중 **P0+P1 8건 배포완료**(PR#559~563).
> 본 문서는 **신규 Prisma 모델/필드 신설이 필요한 P2 8건**의 설계·게이트·마이그레이션·시드·검증이며,
> **4개 검증 에이전트의 코드/스키마 정밀 대조 결과(2026-07-20)를 반영**했다. 【검증】= 확정, 【정정】= 원안 수정.
> 원칙: `db push --accept-data-loss` 금지 · 배포 `deploy.sh --schema --api`(자동백업) · 신규 모델/nullable 필드만(무손실) · 게이트 config 기본 OFF.
> 🔴 **공통 함정**: 공용 `gateMode()`(common/gate-mode.ts)는 **fail-closed** — config 미등록 시 BLOCK. "기본 OFF" 게이트는 반드시 레지스트리에 `value:'OFF'` 등록 또는 `gateMode(raw,'OFF')` fallback 인자 명시.

관련 메모리: `safety_scout_2026_07`, `pharmacy_safety_gaps`, `isolation_involuntary_admission`.

---

## 우선순위·마이그레이션 위험도 (검증 반영)

| 순 | 항목 | 유형 | 치명도 | 🔴 마이그레이션 위험 |
|----|------|------|--------|---------------------|
| 1 | P2-A+D 수술 laterality+계수 | 필드추가 | ★★★ | 없음(nullable) |
| 2 | P2-C 코드블루/RRT | 신모델2 | ★★★ | 없음(가산) |
| 3 | P2-E 이식 TDM/HLA/추적 | 신모델3 | ★★ | 없음(가산) |
| 4 | P2-G 적신호 RCA+emit | 신모델+DTO enum | ★★ | 없음(DB) · ⚠API 계약강화 |
| 5 | P2-F ASP+제한항생제 게이트 | 신모델+마커+게이트 | ★★ | 없음(가산) |
| 6 | P2-B 신생아 모아식별 | 필드+unique | ★★★ | 낮음(확인쿼리) |
| 7 | **P2-H 예방접종 검증** | 제약+마스터 | ★★ | 🔴🔴 **시드버그로 db push 실패 — 선행 필수** |

> **순서 변경 사유(검증 반영)**: 원안은 신생아(B)·예방접종(H)을 상위에 뒀으나, 둘 다 `@@unique` 추가라 마이그레이션 위험이 있어 **후순위로 이동**. 특히 **H는 현 시드에 중복행이 있어 unique 인덱스 생성이 실패→db push 전체 중단→신규 필드까지 미반영**되므로 시드 수정 선행 없이는 절대 배포 불가. 무위험 항목(A·D·C·E)을 먼저 배포.

---

## P2-A. 오부위수술 방지 — laterality/부위 구조화

- **현황【검증】**: `Surgery`(schema `3917-3967`)에 `procedureName`·`procedureCode`만, `site`/`laterality` 부재 확정. **주의: `signInSiteMarked`/`timeOutSite`는 Surgery가 아니라 `SurgicalChecklist`(schema `2613,2626`) 소속**(원안 문구 정정).
- **변경(필드 추가·nullable)**: `Surgery`에 `bodySite String?`, `laterality Laterality?` — enum `{ LEFT, RIGHT, BILATERAL, MIDLINE, NA }`.
  - 【검증】 `enum Laterality` 미존재→신규 안전. 단 `CancerRegistry.laterality`(String, `10738`)가 별도 존재 → **통합 안 함, 표현 별개**임을 명시(혼선 차단).
  - 【정정】 적재 지점 **3곳 모두** 수정: `CreateSurgeryDto`(dto/surgery.dto.ts) + `SurgeryService.schedule()` 인자 타입 + `schedule()` 내 화이트리스트 create 매핑(`surgery.service.ts:90-99`).
- **게이트**: Sign-In 시 laterality 미기재+좌우구분 술식이면 차단. 지점=`updateChecklist()` signIn 분기(`surgery-advanced.service.ts:332-341`) 또는 `assertChecklistReadyForStart(:359)`.
  - 🔴【정정】 config `surgery.siteVerify.enforce`는 **레지스트리 미등록** → 신규 등록 시 **`value:'OFF'` 명시**(fail-closed 함정). 안 하면 의도와 반대로 BLOCK.
  - 【정정】 좌우구분 술식 판별: `ProcedureCode` 마스터는 존재하나 **laterality 속성 없음**, `Surgery.procedureCode`도 FK 아닌 자유문자열 → **초기 상수셋 + bodySite/술식명 병행 판별**(procedureCode 단독 키는 정합성 낮음).
- **마이그레이션【검증】**: nullable+enum 추가 = 무손실·비차단.

## P2-D. 수술 계수 실제 대조 *(A와 동일 PR)*

- **현황【검증】**: `SurgicalChecklist.signOutInstrumentCount Boolean?`(`2632`). `assertChecklistReadyForClose`(`surgery-advanced.service.ts:375-388`)는 signOut required 불리언 전부 true인지만 확인.
- **변경(필드 추가)**: `countItems Json?`(`[{item,initial,final,status}]`), `countStatus String?`, `countDiscrepancyNote String?`.
- 🔴【정정】 **게이트 실행조건**: `assertChecklistReadyForClose`는 **`gateMode(surgery.signOutEnforce)==='BLOCK'`일 때만 호출**(`surgery.service.ts:141-143`). 계수 MISMATCH BLOCK을 이 함수에만 넣으면 signOutEnforce가 OFF/WARN이면 MISMATCH도 통과. → **계수 대조를 signOutEnforce와 독립**(항상 검사)하거나 **별도 config `surgery.countEnforce`**로 분리. 결정: 별도 config 권장(계수는 signOut 진행도와 성격 다름).
- 【정정】 `computeProgress`는 `cl[field]===true` boolean 가정 → `countStatus`(String)/`countItems`(Json)는 progress 배열에 끼우지 말고 **별도 분기**로 판정.
- **마이그레이션【검증】**: nullable 추가 무손실.

## P2-C. 코드블루/RRT

- **현황【정정】**: "심정지·RRT 기록 전무"는 부분 부정확 — **코드블루 *알림*은 이미 `StaffCall(type=CODE, severity=CRITICAL)`으로 DB 영속·SSE/FCM 발송**(`staff-call.service.ts:165`). 없는 것은 **CPR/ROSC/제세동/팀도착 등 임상 소생 경과 기록**. (RRT는 실제 0건 — `CRRT`(icu recordCrrt)는 신대체요법으로 무관, `\brrt\b`로 재확인.)
- **신설 모델**:
  - `CodeBlueEvent` — patientId(필수), `staffCallId String?`(발령 알림 결속 — 기동시간 이중입력 방지), location(필수), recognizedAt, teamArrivedAt, cprStartedAt, roscAt, endedAt, defibrillationCount, medicationsJson, outcome(ROSC/DEATH/TRANSFER), recordedBy, `admissionId String?`(범용 `Admission` 참조로 명시).
  - `RrtActivation` — patientId, trigger(NEWS2/DIRECT_CALL/FAMILY), activatedAt, respondedAt(SLA), responderTeam, outcome(WARD_STAY/ICU_TRANSFER/CODE_BLUE), `ewsId String?`(→EarlyWarningScore.id).
- **연동【검증】**: EWS 트리거는 **HIGH가 아니라 `escalationRequired`(HIGH/MEDIUM/단일3점, `patient-safety.service.ts:157`)**. 신규 리스너 불요 — 기존 **`ews.recorded` 이벤트 구독**으로 RRT 제안 알림.
- **마이그레이션【검증】**: 신모델 가산+back-relation 가상필드(`Patient.codeBlueEvents/rrtActivations`, `EarlyWarningScore.rrtActivations`) = DB 무손실.
- **시드**: CodeBlue 1~2건·RRT 몇 건.

## P2-E. 이식 TDM/HLA/추적관찰 영속화

- **현황【검증】**: `recordTdm(:344)`/`recordHla(:292)`/`recordFollowUp(:366)` 모두 `prisma.create` 없이 계산객체 반환(휘발). controller 200 반환→"기록됨" 오인.
- **신설 모델(FK 확정·필드 보존)**:
  - `TransplantHla` — **`waitlistId`→TransplantWaitlist.id**(HLA=대기자 귀속, 라우트 `waitlist/:id/hla`). classI{A,B,C}/classII{DR,DQ,DP}/method/pra/antibodies/lab/testedAt. ⚠ `TransplantWaitlist.hlaTyping Json?`·`pra`(`3195-96`) 기존재 → **기존=최신 스냅샷 / 신모델=검사 이력** 역할분리 명시.
  - `TransplantTdm` — **`transplantId`→TransplantRecord.id**(이식 후). drug, troughLevel, **peakLevel**, targetLow, targetHigh, inRange, **doseAdjustment**, **sideEffects Json**, sampledAt, recordedBy. (현행 반환 필드 보존 — 원안 누락분 추가.)
  - `TransplantFollowUp` — `transplantId`→TransplantRecord.id. visitDate, **postOpDay**, graftFunction, **labResults Json**, **complications Json**, **infections Json**, biopsyResult, rejectionSigns, immunosuppressionRegimen(명칭통일), **nextFollowUp**, **notes**, recordedBy.
- **게이트**: TDM trough 목표범위 이탈 시 주치의 경고 알림.
- **마이그레이션【검증】**: 신모델3 가산+back-relation(`TransplantRecord.tdms/followUps`, `TransplantWaitlist.hlaRecords`) 무손실.

## P2-G. 적신호사건 에스컬레이션 + RCA

- **현황【검증】**: `SafetyIncident`(`5336-5353`) type/severity 자유문자열(enum 아님)→`getIncidentStats` groupBy 오염. `reportIncident`(`patient-safety.service.ts:36`) emit 없음(낙상·보호대는 emit 보유).
- **변경**:
  - 신설 `RcaReport` — incidentId(→SafetyIncident.id, 역relation 신설), findings, contributingFactors Json, actionPlan Json, owner, dueAt(45일), status, approvedBy?, approvedAt?.
  - `SafetyIncident` severity/type **DTO `@IsEnum`** 검증(dto `15-23`). `UpdateIncidentStatusDto.status`(`113-117`)도 enum·상태집합 정의.
  - 【정정】 emit는 **service `reportIncident` 내부**(create 직후)에 추가 — SENTINEL/CRITICAL이면 `incident.critical` emit.
  - notification.listener: 주치의 통지는 `notifyAttendingDoctor`(dedup 재사용, refId=incidentId). **경영진/질관리 통지는 `handleControlledDiscrepancy`(`:320`) ADMIN 브로드캐스트 패턴 — 이 경로는 dedup 미보유라 별도 dedup 조회 추가.**
- **마이그레이션【검증】**: 신모델·enum(VarChar 유지) DB 무손실. ⚠**API 계약 강화** — 기존 프론트/시드가 enum 외 값 전송 시 신규 400. **호출측·기존 시드 문자열 정합 확인 선행**.

## P2-F. ASP 영속 + 제한항생제 조제 게이트

- **현황【검증】**: `pharmacist-activity.aspRequests`(`:179`, mock `:148`)=인메모리(재시작 소실). `mockTdmRequests`도 인메모리(ADR은 이미 Prisma 영속). 【정정】 **`staffExposures`/`resistanceSurveillance`는 pharmacist가 아닌 `infection-control` 모듈 소재**(`infection-control.service.ts:488/374`), 후자는 배열저장도 없는 **순수 휘발**.
- **신설 모델**:
  - `AspRequest` — patientId, `prescriptionId? @unique`(승인-투약 1:1, →Prescription.id)/encounterId?, antibiotic, restrictedLevel, indication, requestedBy, status(PENDING/APPROVED/REJECTED), reviewedBy?, reviewedAt?, reviewComment?, durationDays?.
  - (후속·infection-control) `StaffExposureIncident`, `ResistanceSurveillance`.
- **제한항생제 마커【정정】**: `MedicationCode`(`873-912`)에 restricted/antibiotic 마커 **없음**(controlSchedule=마약류, highAlertFlag=ISMP만). `FormularyItem.note`는 자유서술. → **`MedicationCode.aspRestrictedLevel String?` 신설**(nullable 무손실) 또는 ingredient 기반 상수 마스터(초기 최소셋). 게이트 판별 근거 확보 선결.
- **게이트 2지점【정정】**:
  - `prescription.service.create`(`:391`) — DUR 통과 후·`assertPreAuthForOrder`(`:460`) 인접에 ASP 승인확인(경고·기록). config `asp.enforce`.
  - `pharmacy.service.startDispensing`(`:91`) — **실질 차단**. 기존 `configRuntime.get('pharmacy.durGate.enforce')`+`durGateDecision`+BLOCK 패턴(`:108-118`) 그대로 재사용. `order.prescription.medicationCode` 이미 include(`:94`)라 마커 조회 무비용.
- **마이그레이션【검증】**: 신모델·nullable 마커 가산 무손실.

## P2-B. 신생아 모아식별

- **현황【검증】**: `NewbornRecord`(`8508-8532`) `patientId String?`·`idBandNo String?`(`@unique` 없음). `addNewborn`(`obgyn.service.ts:174-218`) 밴드 없이 등록 가능. `verifyMotherBabyMatch` 미존재.
- 【정정·중요】 **이미 `@@unique([deliveryId, birthOrder])`(`8529`) 존재** + FOR UPDATE 행잠금(다태아 순번 오식별 backstop). 신규 축은 밴드번호.
- **변경**:
  - `motherBandNo String?` 신설(산모 밴드 페어). `idBandNo`에 `@@unique([idBandNo])`.
  - 🔴【정정】 **`idBandNo` NULL 백필 불필요** — Postgres plain unique는 NULL을 distinct 취급, 시드 신생아 2건 모두 NULL이라 위반 없음. **위험은 non-null 중복뿐**(현 시드에 없음). 배포 전 확인쿼리만: `select id_band_no,count(*) from newborn_records where id_band_no is not null group by 1 having count(*)>1`.
  - 밴드없이 등록거부는 unique가 아니라 **서비스 필수화 + config `obgyn.newbornId.enforce`(OFF/WARN/BLOCK) BLOCK**로 달성.
  - `verifyMotherBabyMatch(newbornId, scannedMotherBand, scannedBabyBand)` — 불일치 차단(수유·투약 전).
- **마이그레이션**: 확인쿼리 수준(백필 스크립트 불요). 시드에 밴드번호 유일 부여.

## P2-H. 예방접종 스케줄 검증  🔴🔴 배포 선행 필수

- **현황【검증】**: `PediatricImmunization`(`8575-8594`) `vaccineCode String?`·`doseNumber Int`·`lotNumber String?`·`nextDueDate Date?`. 유니크 없음. `createImmunization`(`pediatrics.service.ts:75-100`) 표준일정 대조 없이 straight create.
- 🔴🔴【정정·최우선】 **`@@unique([patientId, vaccineCode, doseNumber])`는 현 시드에서 반드시 db push 실패**:
  - `prisma/seeds/dept-richness.ts:37-42` VAX(HepB m0/1/6, DTaP m2/4/6)를 루프(`115-118`)가 **전부 `doseNumber:1` 하드코딩** → 소아마다 `(pid,'HepB',1)`·`(pid,'DTaP',1)` 각 3중복. `createMany({skipDuplicates})`는 현재 유니크 없어 못 거름.
  - `deploy.sh:84` `prisma db push`의 CREATE UNIQUE INDEX가 중복행에 실패 → **push 전체 중단(85행 WARNING만), 신규 필드 전부 미반영, API 구스키마 부팅 불일치**.
  - **선행**: ① `dept-richness.ts`를 doseNumber를 VAX 항목별 차수로 수정 ② 기존 DB 중복정리 SQL(`row_number()`로 차수 재부여 or 최신본만 잔존) → **그 후** unique.
- **변경**:
  - 【정정】 unique 키 `(patientId, **vaccineName**, doseNumber)` — vaccineCode는 nullable이라 NULL이 unique 무력화. vaccineName은 required. 또는 vaccineCode 필수화.
  - 표준 접종일정 **정적 상수**(기존 관행 — `ImmunizationScheduleMaster` 신모델 불요). 차수/간격/연령 서버 검증, nextDueDate 자동산출, lotNumber 필수화, 알레르기·금기 게이트. config `immunization.enforce`.
  - 【정정】 **범용 `Vaccination` 모델(`8339-8358`, 성인·범용) 별도 존재** — `PediatricImmunization`과 이원화. 검증·unique를 **어느 모델에 적용할지 정책 명시**(한쪽만 커버 시 우회 가능). 결정: 소아 경로=PediatricImmunization에 적용, Vaccination은 후속.
- **마이그레이션**: 🔴 시드 수정 + 중복정리 **필수 선행**(무시 시 배포 실패). unique는 정리 후.

---

## 배포 배치 계획 (검증 반영 — 무위험 먼저)

| PR | 묶음 | 스키마 | 선행 |
|----|------|--------|------|
| P2-1 | A+D 수술(laterality+계수) | 필드추가·enum | config value:'OFF' 등록·별도 countEnforce |
| P2-2 | C 코드블루/RRT | 신모델2+back-relation | staffCallId 결속·ews.recorded 구독 |
| P2-3 | E 이식 TDM/HLA/추적 | 신모델3+back-relation | FK(waitlist/record) 구분·필드보존 |
| P2-4 | G 적신호 RCA+emit | 신모델+DTO enum | ⚠호출측/시드 enum값 정합 확인 |
| P2-5 | F ASP+게이트 | 신모델+MedicationCode 마커 | 제한항생제 마스터·2지점 게이트 |
| P2-6 | B 신생아 모아식별 | 필드+unique(idBandNo) | 확인쿼리(non-null 중복) |
| P2-7 | **H 예방접종** | 제약+상수마스터 | 🔴🔴 **시드 doseNumber 수정+중복정리 SQL 선행 필수** |

각 PR: schema → `deploy.sh --schema --api`(자동백업) → 로컬 `node dist/main.js` 부팅검증 → 스모크 → 시드 → 스펙. **P2-7은 시드/중복정리 선행 없이 배포 시 db push 전체 실패**하므로 반드시 마지막·선행작업 확인 후.

## 잔여 P3 (본 기획 범위 밖·별도)
ICU/ER 전동 SBAR 게이트, ER 활력 이력화+NEWS2, KTAS 재평가주기, QI 지표 실집계(mock상수 대체), 호스피스 마약류 ControlledSubstanceLog 연동, 파토그램 FHR·전자간증 경보, 방사선 IGRT게이트, 투석액 조성/UF율 게이트, CSSD InstrumentSet BI/CI 게이트.
