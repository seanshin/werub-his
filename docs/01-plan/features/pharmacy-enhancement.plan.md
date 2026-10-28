# 약국 시스템 고도화 기획서 v2.0

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/prisma/schema.prisma:2238 model MedicationBatch · apps/api/prisma/schema.prisma:2263 model DispensingCounsel · apps/api/prisma/schema.prisma:2289 model GenericSubstitution · 잔여: 분할조제 스키마·유효기간 근거(사람)

> 원내/원외 약국 구분 + 기기 연동 + 워크플로우 확장 + 법적 필수사항

## 1. 현황 분석

### 완성된 기능
- 조제 워크플로우 (접수→조제→검수→불출)
- DUR 점검 + CDSS 연동 (처방 시 자동 점검)
- 블록체인 전자서명 (검수 시)
- 약품코드 관리 (보험코드, 가격, EDI)
- 조제 취소/품목 수정
- 마약류 관리 (`controlled-substance` 모듈 — 처방/확인/불출/투약/폐기/반납/일일원장)
- HIRA EDI 청구 (`hira-edi` 모듈)
- 재고 관리 기본 (`inventory` 모듈)

### 누락된 기능
| ID | 항목 | 현황 | 영향 |
|----|------|------|------|
| FR-01 | 원내/원외 약국 구분 | 미구현 | 모든 처방이 원내 조제로만 처리 |
| FR-02 | 처방전 법정 양식 출력 | 미구현 | 원외 처방전 발급 불가 |
| FR-03 | 원외 처방전 유효기간 (3일) | 미구현 | 만료 관리 불가 |
| FR-04 | 대체조제 워크플로우 | 미구현 | 동일성분 대체 시 프로세스 없음 |
| FR-05 | 복약지도(투약상담) 기록 | 미구현 | 약사법상 의무 기록 미관리 |
| FR-06 | 약품 바코드 스캔 | 미구현 | 수기 확인만 가능 |
| FR-07 | 자동조제기(ATC) 연동 | 미구현 | 수동 조제만 가능 |
| FR-08 | 약품 로트/유효기간 관리 | 미구현 | 유효기간 추적 불가 |
| FR-09 | 라벨 인쇄 | 미구현 | 약봉지 라벨 수기 작성 |
| FR-10 | ADR(약물이상반응) 보고 | 미구현 | 약사법상 보고 의무 미충족 |
| FR-11 | 입원/외래/퇴원약 구분 | 미구현 | UD 포장 등 미지원 |
| FR-12 | 수납 연동 (조제료 vs 처방료) | 미구현 | 원내/원외 수가 구분 불가 |
| FR-13 | 마약류-약국 통합 | 미연동 | controlled-substance 모듈과 분리 |
| FR-14 | 분할조제 | 미구현 | 재고 부족 시 일부 조제 불가 |

---

## 2. 원내/원외 약국 구분

### 2.1 데이터 모델

```
Prescription 확장:
  + dispensingType: INTERNAL | EXTERNAL        (원내/원외)
  + rxValidUntil: DateTime?                    (원외 처방전 유효기간, 발행일+3일)

Order 확장:
  + pharmacyType: INTERNAL | EXTERNAL

MedicationCode 확장:
  + controlSchedule: String?                   (마약류 등급: I/II/III/IV/V, null=일반)
  + barcode: String?                           (GS1-128 또는 KD코드)
  + barcodeType: GS1 | KD | CUSTOM | null
  + storageCondition: ROOM | COLD | FROZEN     (보관 조건)

SystemConfig 추가:
  + pharmacy.defaultType: 'INTERNAL'           (기본 조제 유형)
  + pharmacy.externalEnabled: true             (원외 처방 허용 여부)
  + pharmacy.rxValidDays: 3                    (원외 처방전 유효일수)
```

### 2.2 워크플로우 분기

```
처방 생성 시 (CPOE)
├─ 원내(INTERNAL) → 약국 조제 워크플로우
│   접수 → [마약류 체크] → 조제 → [바코드 확인] → 검수 → 불출 → [복약지도] → 투약확인
│
└─ 원외(EXTERNAL) → 처방전 발급 워크플로우
    처방전 생성 → DUR 결과 포함 → 출력(법정양식 PDF) → 유효기간 관리(3일)
    ├─ 환자에게 처방전 출력 (별지 9호 서식)
    ├─ 포털에서 처방전 조회/다운로드
    └─ 유효기간 만료 시 자동 EXPIRED 처리 (스케줄러)
```

### 2.3 원외 처방전 법정 양식 (별지 9호 서식)

```
필수 항목:
  - 요양기관기호 (hospital.code)
  - 환자 성명, 주민등록번호 (또는 생년월일)
  - 질병분류기호 (ICD-10/KCD)
  - 처방의약품: 약품명, 1회투약량, 1일투여횟수, 총투여일수, 용법
  - 처방전 사용기간 (발행일로부터 3일)
  - 의사 서명/날인 (블록체인 전자서명 활용)
  - 의사 면허번호
  - 발행 연월일

API:
  POST /api/v1/pharmacy/prescription/print
    { prescriptionId } → PDF (법정양식)
  GET  /api/v1/pharmacy/prescription/:id/pdf
    → 생성된 PDF 다운로드
```

### 2.4 원외 처방전 유효기간 관리

```
- 발행 시: rxValidUntil = 발행일 + 3일 (약사법 시행규칙)
- 스케줄러: 매일 00:00 만료된 원외 처방전 status → EXPIRED
- 만료 임박(D-1) 환자 포털 알림
```

### 2.5 수납 연동

```
원내 조제:
  - 조제료(약국관리료) + 약품비 → BillingItem 자동 생성
  - 조제 완료 시 billing 모듈로 이벤트 발행
    event: 'dispensing.completed' → { dispensingId, items, totalCost }

원외 처방:
  - 처방료만 청구, 약품비 제외
  - 처방전 발행 시 billing 모듈로 이벤트 발행
    event: 'prescription.external' → { prescriptionId }

보험/비보험 구분:
  - MedicationCode.insuranceCode 존재 → 보험 약품
  - insuranceCode 없음 → 비보험 (100% 본인부담)
  - BillingItem에 insuranceType 반영
```

---

## 3. 복약지도 및 대체조제

### 3.1 복약지도(투약상담) 기록

```
새 모델: DispensingCounsel
  id, dispensingId, pharmacistId, patientId
  counselType: INITIAL | REFILL | DISCHARGE    (초회/반복/퇴원)
  content: Text                                 (상담 내용)
  drugInteractions: Text?                       (약물 상호작용 안내)
  sideEffects: Text?                            (부작용 주의사항)
  foodInteractions: Text?                       (음식 상호작용)
  storageInstructions: Text?                    (보관 방법)
  counseledAt: DateTime
  duration: Int?                                (상담 시간, 분)

API:
  POST /api/v1/pharmacy/counsel
  GET  /api/v1/pharmacy/counsel/dispensing/:dispensingId
```

### 3.2 대체조제 워크플로우

```
새 모델: GenericSubstitution
  id, originalPrescriptionId, substituteMedicationCodeId
  reason: String                                (대체 사유)
  pharmacistId, requestedAt
  doctorNotified: Boolean                       (의사 통보 여부)
  doctorApproved: Boolean?                      (의사 승인)
  patientConsent: Boolean                       (환자 동의)
  status: REQUESTED | APPROVED | REJECTED

워크플로우:
  약사 대체조제 요청 → 의사 통보 → 의사 승인/거부
  → 환자 동의 → 대체 약품으로 조제 진행
  → 기록 보관 (약사법)

API:
  POST  /api/v1/pharmacy/substitution
  PATCH /api/v1/pharmacy/substitution/:id/approve
  PATCH /api/v1/pharmacy/substitution/:id/reject
```

### 3.3 입원/외래/퇴원약 구분

```
Dispensing 확장:
  + careType: OUTPATIENT | INPATIENT | DISCHARGE   (외래/입원/퇴원)
  + packagingType: STANDARD | UNIT_DOSE | BLISTER  (포장 유형)

입원(INPATIENT): 일일투약분(UD) 포장, 병동별 불출
퇴원(DISCHARGE): 퇴원약 일괄 조제, 복약지도 필수
외래(OUTPATIENT): 기본 조제 (원내) 또는 처방전 (원외)
```

### 3.4 분할조제(Split Dispensing)

```
약사법 근거: 재고 부족 등으로 전량 조제 불가 시 일부만 조제하고
             잔여분을 추후 조제할 수 있음

Dispensing 확장:
  + splitSeqNo: Int @default(1)                 (분할 순번, 1=첫 조제)
  + splitOfId: String?                          (원본 Dispensing ID, 분할 시 참조)
  + totalPrescribedQty: Int?                    (전체 처방 수량)
  + partialQty: Int?                            (이번 조제 수량)
  + remainingQty: Int?                          (잔여 수량)

워크플로우:
  1. 조제 시 재고 부족 → "분할조제" 선택
  2. 현재 가능한 수량만 조제 (partialQty)
  3. 원본 Dispensing에 remainingQty 기록
  4. 잔여분 입고 시 → 새 Dispensing(splitSeqNo=2, splitOfId=원본ID) 자동 생성
  5. 환자/포털에 분할조제 안내 (잔여분 수령 일정)

API:
  POST  /api/v1/pharmacy/dispense/:id/split
    { partialQty: number }                      (분할 조제 시작)
  GET   /api/v1/pharmacy/dispense/:id/splits
    → 분할 이력 조회 (splitOfId 기준)
```

---

## 4. ADR(약물이상반응) 보고

```
새 모델: AdverseReactionReport
  id, patientId, reporterId (약사/의사)
  reportType: INITIAL | FOLLOWUP
  // 의심 약물
  suspectedDrugName: String
  suspectedDrugCode: String?
  // 이상반응
  reactionDescription: Text
  onsetDate: DateTime
  severity: MILD | MODERATE | SEVERE | FATAL
  outcome: RECOVERED | RECOVERING | NOT_RECOVERED | FATAL | UNKNOWN
  // 인과관계
  causalityAssessment: CERTAIN | PROBABLE | POSSIBLE | UNLIKELY | UNASSESSABLE
  naranjoScore: Int?                            (Naranjo 알고리즘 점수)
  // 보고
  kidsReported: Boolean                         (한국의약품안전관리원 보고 여부)
  kidsReportDate: DateTime?
  kidsReportNumber: String?
  // 조치
  actionTaken: WITHDRAWN | REDUCED | UNCHANGED | UNKNOWN
  status: DRAFT | SUBMITTED | REVIEWED
  createdAt, updatedAt

API:
  POST /api/v1/pharmacy/adr
  GET  /api/v1/pharmacy/adr?patientId=...
  GET  /api/v1/pharmacy/adr/stats                (약품별 ADR 통계)
  PATCH /api/v1/pharmacy/adr/:id/submit          (KIDS 보고)

연동:
  - 환자 알레르기 정보 자동 크로스체크
  - 약품코드별 ADR 이력 조회 (처방 시 경고)
  - DUR 점검 시 ADR 이력 참고
```

---

## 5. 기기 연동

### 5.1 약품 바코드 시스템

```
DispensingItem 확장:
  + scannedBarcode: String?                    (스캔한 바코드)
  + scannedAt: DateTime?
  + barcodeVerified: Boolean @default(false)

API:
  POST /api/v1/pharmacy/scan
    { barcode: string, dispensingId: string }
    → MedicationCode 매칭 → DispensingItem 자동 확인
    → 마약류(controlSchedule != null) 시 double-check 트리거

구현 방식:
  - 외장 스캐너: HID(키보드 에뮬레이션) → input 포커스 캡처
  - 웹캠: quagga2 또는 @nickvdh/zxing-browser 라이브러리
  - 응답 시간 목표: < 200ms

UI 흐름:
  1. 조제 화면에서 바코드 입력 필드 포커스
  2. 스캔 → 자동 매칭 → 녹색 체크 (일치) / 빨간 경고 (불일치)
  3. 마약류 스캔 시 → 이중확인 모달 표시
```

### 5.2 자동조제기(ATC) 연동

```
새 모델: PharmacyDevice
  id, name, type: ATC | COUNTER | PACKAGER | LABEL_PRINTER
  status: ONLINE | OFFLINE | ERROR | MAINTENANCE
  connectionType: TCP | SERIAL | USB | API
  connectionConfig: Json                        (host, port, baudRate 등)
  location: String?
  lastHeartbeatAt: DateTime?

새 모델: AtcDispenseJob
  id, dispensingId, deviceId
  status: QUEUED | PROCESSING | COMPLETED | FAILED
  medications: Json                             ([{code, qty, slot}])
  startedAt, completedAt, errorMessage
  retryCount: Int @default(0)

API:
  GET  /api/v1/pharmacy/devices                 (연결된 기기 목록)
  POST /api/v1/pharmacy/devices/:id/dispense    (자동조제 요청)
  GET  /api/v1/pharmacy/atc-jobs/:id/status     (작업 상태)
  POST /api/v1/pharmacy/devices/:id/heartbeat   (상태 체크)

주의:
  - 마약류(controlSchedule I~II) → ATC 제외, 수동 조제 강제
  - ATC 벤더별 어댑터 패턴 (JVM, Omnicell 등 프로토콜 상이)
  - 네트워크 단절 시 → 수동 조제 fallback + 알림

모니터링:
  - SSE 기반 작업 상태 실시간 업데이트
  - heartbeat 30초 간격, 3회 실패 시 OFFLINE
```

### 5.3 라벨 프린터

```
API:
  POST /api/v1/pharmacy/print/label
    { dispensingId, format: MEDICATION_LABEL | PRESCRIPTION }
    → ZPL/ESC-POS 데이터 생성

인쇄 아키텍처:
  - 서버: ZPL(Zebra) 또는 ESC-POS 형식 데이터 생성
  - 클라이언트: window.print() 또는 WebUSB API 활용
  - fallback: 브라우저 Print API (A4 레이아웃)

라벨 내용:
  - 환자명, 생년월일
  - 약품명, 용량, 용법
  - 복용 시간 아이콘 (아침/점심/저녁/취침)
  - 주의사항 (냉장보관, 차광보관 등)
  - 바코드 (조제 추적용)
  - 약국명, 약사명
```

### 5.4 약품 분배기(Pill Counter)

```
POST /api/v1/pharmacy/devices/:id/count
  { medicationCodeId, requestedQty }
  → 정제 계수기 작동 → 결과 수신
  → DispensingItem.dispensedQty 자동 업데이트
```

---

## 6. 약품 재고/로트 관리

```
새 모델: MedicationBatch
  id, medicationCodeId
  lotNumber: String
  expirationDate: DateTime
  quantity: Int                                 (입고 수량)
  remainingQty: Int                             (잔여 수량)
  manufacturer: String?
  receivedAt: DateTime
  storageCondition: ROOM | COLD | FROZEN
  isControlled: Boolean @default(false)         (마약류 여부)

DispensingItem 확장:
  + batchId: String?
  + lotNumber: String?

API:
  GET  /api/v1/pharmacy/inventory               (재고 현황)
  GET  /api/v1/pharmacy/inventory/expiring       (유효기간 임박, 기본 30일)
  GET  /api/v1/pharmacy/inventory/low-stock      (안전재고 미달)
  POST /api/v1/pharmacy/inventory/receive        (입고)
  POST /api/v1/pharmacy/inventory/adjust         (재고 조정)

마약류 재고:
  - isControlled=true인 배치는 별도 승인 워크플로우
  - 재고 조정 시 사유 + 증인(witnessId) 필수
  - controlled-substance 모듈 일일원장과 연동
```

---

## 7. 마약류(Controlled Substance) 통합

```
기존 모듈: controlled-substance
  - ControlledSubstanceLog 모델 (처방→확인→불출→투약→폐기/반납)
  - 바코드 스캔 필드(dispenseScanCode) 이미 존재

통합 포인트:
  1. MedicationCode.controlSchedule 필드 추가
     → 처방 시 마약류 자동 감지
  2. 바코드 스캔 시 마약류 → double-check 트리거
     → ControlledSubstanceLog 자동 생성
  3. ATC 자동조제에서 마약류(I~II급) 제외
  4. MedicationBatch 입고 시 마약류 → 별도 승인
  5. 일일원장(daily-ledger)에 배치 로트번호 연동
```

---

## 8. 구현 우선순위

### Phase 1a: 데이터 모델 + CPOE 토글 (1~2일)
- [ ] Prescription에 dispensingType, rxValidUntil 추가
- [ ] Order에 pharmacyType 추가
- [ ] MedicationCode에 controlSchedule, barcode, storageCondition 추가
- [ ] Dispensing에 careType, packagingType 추가
- [ ] CPOE 처방 입력 시 원내/원외 토글

### Phase 1b: 처방전 PDF + 약국 페이지 분리 (2~3일)
- [ ] 원외 처방전 법정양식 PDF 생성 API
- [ ] 약국 조제 페이지 탭: 원내 조제 / 원외 처방전
- [ ] 원외 처방전 유효기간 만료 스케줄러
- [ ] 수납 연동 (조제료 vs 처방료)
- [ ] 환자 포털 처방전 조회/다운로드

### Phase 2: 바코드 + 로트 기본 (2~3일)
- [ ] MedicationBatch 모델 + 기본 API
- [ ] 바코드 스캔 API + 조제 화면 스캔 UI
- [ ] 마약류 바코드 스캔 → double-check 통합
- [ ] 유효기간 임박 알림

### Phase 3: 복약지도 + 대체조제 + ADR (2~3일)
- [ ] DispensingCounsel 모델 + API + UI
- [ ] GenericSubstitution 모델 + 워크플로우
- [ ] AdverseReactionReport 모델 + API + UI
- [ ] 환자 알레르기 크로스체크

### Phase 4: ATC + 라벨 + 재고 UI (3~4일)
- [ ] PharmacyDevice, AtcDispenseJob 모델
- [ ] 기기 관리 API + 관리자 UI
- [ ] ATC 자동조제 + SSE 모니터링
- [ ] 라벨 프린터 API + ZPL 생성
- [ ] 재고 관리 UI (입고/조정/유효기간)
- [ ] 마약류 배치 승인 워크플로우

---

## 9. 비기능 요구사항

| 항목 | 기준 |
|------|------|
| 바코드 스캔 응답 | < 200ms |
| ATC 작업 타임아웃 | 120초 (초과 시 FAILED) |
| 동시 조제 처리 | 10건/초 이상 |
| 처방전 PDF 생성 | < 3초 |
| ATC heartbeat | 30초 간격, 3회 실패 → OFFLINE |
| 재고 데이터 정합성 | 트랜잭션 보장 (조제-차감 원자성) |
| 마약류 이중확인 | 2인 이상 확인 필수 (약사법) |

---

## 10. Out of Scope (현재 제외)

| ID | 항목 | 사유 | 로드맵 |
|----|------|------|--------|
| OOS-01 | TPN(경정맥영양) 무균 조제 | 클린룸 기반 별도 워크플로우 | Phase 5+ |
| OOS-02 | 항암제 혼합 조제 | 안전 캐비닛 + 별도 프로토콜 | Phase 5+ |
| OOS-03 | 임상시험약(IND) 관리 | IRB 연동 + 별도 재고 관리 | 별도 모듈 |
| OOS-04 | 한약 조제 | 한약재 DB + 별도 처방 체계 | 별도 모듈 |
| OOS-05 | 약국 자동화 로봇(ROWA 등) | 대형 장비, 별도 프로젝트 | Phase 6+ |

---

## 11. 관련 시스템 연동

| 시스템 | 연동 내용 | 기존 모듈 |
|--------|-----------|-----------|
| CPOE (처방) | 원내/원외 구분 전달 | orders |
| DUR | 원외 처방 시 DUR 점검 결과 포함 | cdss, dur |
| 수납 | 조제료 vs 처방료, 보험/비보험 구분 | billing |
| HIRA 청구 | 원외 처방전 EDI 데이터 | hira-edi |
| 환자 포털 | 처방전 조회/다운로드, ADR 보고 | portal |
| 재고 관리 | 조제 시 자동 차감 | inventory |
| 블록체인 인증서 | 검수/처방전 서명 | blockchain-cert |
| 마약류 관리 | 바코드→이중확인→일일원장 | controlled-substance |
| 환자 안전 | ADR → 알레르기 크로스체크 | patient-safety |

---

## 12. 한국 의약 법규/표준

| 표준 | 용도 |
|------|------|
| **별지 9호 서식** | 원외 처방전 법정 양식 |
| **약사법 시행규칙 12조** | 처방전 유효기간 3일 |
| **약사법 11조** | 복약지도 의무 |
| **약사법 44조** | 대체조제 요건 (의사 통보, 환자 동의) |
| **KD코드** | 한국의약품안전관리원 약품식별코드 |
| **GS1-128** | 국제 의약품 바코드 표준 |
| **KIDS** | 약물이상반응 자발적보고 시스템 |
| **마약류관리법** | 마약류 처방/조제/보관/폐기 규정 |
| **건강보험심사평가원** | DUR, 전자청구, 처방전 전송 |

---

*작성일: 2026-05-21*
*버전: v2.0 (검증 피드백 반영)*
*상태: Phase 1a 우선 진행 권장*
