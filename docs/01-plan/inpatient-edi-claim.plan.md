# [기획] 입원 EDI 청구 트랙 — 입원료 청구 진입 + 이중 계상 해소

- **작성**: 2026-07-23
- **배경**: ERP 정산 개통(v3.58) 과정에서 실측 확정된 갭 — **입원 일당 수가(입원료)가 어느 심사청구에도 포함되지 않음**(claim 모듈 InterimBilling 참조 0). ERP에 "도입 시 사전 통지" 약속됨.
- **성격**: 기획서(구현 전). 수익 무결성 + 심평원 규격 트랙 — 실 수가코드·실전송은 사람/외부 게이트.

## 1. 현행 실측 (2026-07-23 전수조사)

### 청구 파이프라인
- Claim 소스 = **Billing만**(경로A 배치 generateClaims·경로B 개별 — 둘 다 Billing 1건=Claim 1건=encounter 단위). InterimBilling 청구화 경로 부재.
- Claim 모델에 입원 필드 전무. `HiraClaimDocument`만 documentType INPATIENT·treatmentFrom/To·procedures/medications/materials 슬롯 보유(입원 명세서 그릇으로 최적) — 단 생성 로직 부실(존재하지 않는 `billingItems.category` 필터 → 분리 공집합·급여율 0.7 하드코딩·treatment 기간 단일일).
- submit = claimNumber 부여 + ERP outbox 이벤트뿐(심평원 실전송 없음). EDI/XML은 다운로드 파일 생성만.

### 🔴 확정 결함 2건 (트랙과 무관하게 선결 수정 대상)
1. **처방 이중 계상**: 입원 처방이 ①`Billing.items`(encounter.signed 시 ACTIVE 처방 전부) ②`InterimBilling.rxTotal`(같은 처방 재합산) 양쪽에 계상 — 퇴원정산 `totalCharges = enc합 + interim합`이 단순 합산이라 **처방비 2배**. 대사 경고도 이를 감지 못함.
2. **hira-edi 생성 로직 실효 무**: `billingItems.category`(비존재 필드) 필터·`insuranceAmount=total×0.7` 하드코딩·진단코드 소스(`claim.diagnoses`) 비존재 관계 참조.

## 2. 설계 결정 (쟁점 11건에 대한 제안)

| # | 쟁점 | 결정 |
|---|---|---|
| 1 | 명세서 단위 | **입원 명세서 정본 = HiraClaimDocument(INPATIENT) 승격** — 입원 건(Admission) 단위·treatmentFrom/To=재원기간. Claim(Billing 1:1) 구조는 불변(회귀 0)·입원 Claim은 아래 #2의 입원료 Billing에 연결 |
| 2 | 입원료 청구 진입 | **퇴원 확정 시 "입원료 Billing" 생성** — 퇴원 시점 admission의 **퇴원 encounter**에 귀속(Billing.encounterId unique 필수 제약 준수·스키마 무변). BillingItem = 병상등급별 입원료 코드 × 재원일수(days 필드 활용) |
| 3 | 이중 계상 해소 | **처방 SoT = Billing.items** 확정. InterimBilling은 **입원료+중간 수납 전용으로 축소**(rxTotal 제거). 퇴원정산 합산식 자연 정합 |
| 4 | 일당 수가 코드 | procedureCode 마스터에 입원료 코드 슬롯 + config `inpatient.bedRateCodes`({bedClass: procedureCode}) 매핑. **실 심평원 코드(병상등급별 입원료·입원환자관리료) 큐레이션은 사람 게이트** — 데모 코드 시드로 구조 검증 |
| 5 | 급여율 | 하드코딩(0.7/0.8) 제거 → billing.service가 쓰는 `eligibility.copayRateFor(category,'INPATIENT')` 경로 재사용(산정특례·의료급여 종별 반영) |
| 6 | HiraClaimDocument 정합 | `codeType` 기반 procedures/medications/materials 분리 재작성·재원기간·실 days/qty |
| 7 | 진단코드 | `EncounterDiagnosis` 연결(입원 기간 내 encounter들의 확정 진단·주상병 우선) |
| 8 | 전송 채널 | 이번 트랙 범위 밖 — submit=ERP 이벤트 유지·HIRA 문서는 VALIDATED까지. 실전송/반송 파싱은 포맷 확보 후(사람) |
| 9 | 입원/외래 플래그 | Claim 확장 대신 HiraClaimDocument.documentType 활용(#1 결정과 정합)·경로A 배치는 입원료 Billing도 동일 처리(자동 포함) |
| 10 | 경로A/B 병존 | 유지(정책 동일 확인됨) — 입원료 Billing이 생기면 두 경로 모두 자동으로 청구화 |
| 11 | 테스트 공백 | claim·hira-edi·interim 회귀 스펙 신설(P0부터) |

## 3. Phase 계획

### P0 — 이중 계상 해소 (선결·결함 수정)
- `generateInterimBilling`에서 rxTotal 제거 — InterimBilling = `roomCharge`(일당×일수)만. 주석·FE 라벨 '입원료 중간정산' 명확화.
- 기존 데이터: 재계산/소급 없음(수납 감사 보존) — 퇴원정산 대사 경고에 "구 산식 혼재 가능" 안내 1줄.
- 스펙: interim 생성=입원료만·퇴원정산 합산 정합.

### P1 — 입원료 Billing (청구 진입)
- config `inpatient.bedRateCodes` + 데모 입원료 procedureCode 시드(멱등).
- 퇴원 확정 훅에 `createInpatientStayBilling(admissionId)`: 퇴원 encounter 귀속 Billing — BillingItem(입원료 코드·quantity=재원일·unitPrice=등급 일당·insuranceCategory COVERED)·급여율=eligibility 경로. 멱등(기존 입원료 item 존재 시 스킵). InterimBilling 기수납은 Billing.paidAmount에 승계 반영(퇴원 수납 잔액 정합).
- 게이트 `inpatient.stayBilling.enforce`(OFF|WARN|BLOCK 아님 — **enabled true/false**, 기본 OFF → 검증 후 ON).

### P2 — HiraClaimDocument INPATIENT 정합 재작성
- generateDocument: codeType 분리·재원기간·EncounterDiagnosis 진단·급여율 실계산·입원 명세서는 admission 단위(재원 내 전 Billing 합산). validate 보강.

### P3 — 파이프라인 편입·검증
- 경로A/B로 입원료 Billing 청구화 e2e(생성→submit→review→Billing 정산→ERP 이벤트) 스펙.
- ERP 사전 통지 문서 발신(약속 이행): 입원료 Billing이 billing.line_recorded/claim.submitted에 합류하는 시점·중간정산 이벤트와의 관계(코드로 분리 — 이중 인식 없음 재확인).

## 4. 사람/외부 게이트
- 실 입원료 수가코드 큐레이션(병상등급·간호등급 가산) — admin/codes 셀프서비스로 입력 가능
- 심평원 실전송·반송파일 포맷 — 별도 트랙
- P1 게이트 ON 판단(검증 후)

## 5. 리스크
| 리스크 | 대응 |
|---|---|
| 기존 InterimBilling 데이터와 신 산식 혼재 | 소급 없음·대사 경고 안내·릴리즈 노트 명시 |
| 퇴원 encounter 부재 케이스(전원 등) | admission 내 마지막 encounter 폴백·없으면 생성 스킵+경고 |
| 입원료 Billing이 기존 배치(경로A) PAID 조건과 상충(미수납 시 미청구) | 현행 정책 유지(수납완료 후 청구) — 명세서(HiraClaimDocument)는 수납 무관 생성 가능 |


## 6. 실행 결과 (2026-07-23 — P0~P3 완료)

- **P0(PR#645)**: rxTotal 제거·처방 조회 부재 스펙·구 산식 혼재 경고·FE 라벨.
- **P1(PR#646)**: createInpatientStayBilling — 퇴원 encounter 귀속·AB1A0100 폴백(실 HIRA 코드 마스터 기존재)·eligibility 급여율·멱등·게이트 OFF·수동 EP. 운영 e2e 250,000 생성. 기수납 승계 안 함(퇴원정산 이중차감 방지 — 기획 노트 조정).
- **P2(PR#647)**: 명세서 정합 재작성 — codeType 분리·Admission 단위 합산·재원기간·EncounterDiagnosis 주상병·Billing 정본 금액·기관 config·면허=Staff. ediVersion 1.1.
- **P3(PR#648)**: 🔴경로B(insurance-claims)가 **모듈 미등록 dead code였음을 발견·정식 배선**(조사 시 '병렬 파이프라인' 판정 정정). 운영 종단 e2e: 입원료 Billing→Claim→INPATIENT 명세서(재원 6/5~6/10·stayDays 5·EDI AB1A0100·주상병 I10·면허 실값). **ERP 사전 통지 발신**(약속 이행) — 입원료 이중 인식 방지 결정 요청(권고: line_recorded 단일 정본·interim은 현금흐름 전용 강등) 후 게이트 ON.
- 잔여(사람/외부): ERP 회신→stayBilling 게이트 ON·등급별 수가코드 큐레이션·심평원 실전송/반송 포맷.
