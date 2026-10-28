# 검사실 고도화 시스템 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/prisma/schema.prisma:2524 model LabInterfaceResult · apps/api/prisma/schema.prisma:2483 model LabResultAttachment · apps/api/prisma/schema.prisma:2545 model LabWorksheet · 잔여: P6 장비 실시간 인터페이스(ASTM/HL7 MLLP 수신)(CLI); (범위 밖 관찰) 미생물 배양·감수성 층(CLI)

## 현재 상태

### 이미 구현된 것
- 기본 Lab 워크플로우: 의뢰 → 검체접수 → 결과입력 → 보고
- LabResult / LabResultItem 모델 (수동 입력)
- 이상치 자동 플래그 (H/L/N)
- AI 검사 해석 (interpret-lab API)
- 환자 검사 이력 조회

### 부족한 것
- 외부 검사 장비(분석기) 인터페이스 없음
- 검사기록지(Worksheet) 없음
- PDF/파일 기반 결과 수신 구조 없음
- 외부 위탁검사(수탁) 연동 없음
- 세포치료/유전체 검사 지원 없음
- QC(정도관리) 없음
- 바코드/검체 추적 없음

## 목표

검사실의 **실제 운영 환경**을 반영한 고도화:
1. 장비 인터페이스 (HL7/파일/PDF)
2. 검사기록지 (Worksheet)
3. 특수검사 (세포치료, 유전체)
4. 외부 위탁검사
5. 정도관리 (QC)

---

## Phase 1: 장비 인터페이스 + 파일 수신

### 1.1 장비 연동 아키텍처

```
┌─ 검사 분석기 ──────────────────────────────────────────────┐
│                                                             │
│  [혈액분석기]  [생화학분석기]  [면역분석기]  [요검사기]       │
│       │              │              │            │           │
│  HL7/ASTM    CSV/TXT Export   PDF Report   Serial/RS-232   │
└───────┬──────────────┬──────────────┬────────────┬──────────┘
        │              │              │            │
        ▼              ▼              ▼            ▼
┌─ Lab Interface Gateway ─────────────────────────────────────┐
│                                                             │
│  [HL7 Parser]  [File Watcher]  [PDF Parser]  [API Receiver] │
│       │              │              │              │        │
│       └──────────────┴──────┬───────┴──────────────┘        │
│                             ▼                               │
│              LabInterfaceMessage (표준화)                    │
│                             │                               │
│              [Validation + Mapping]                         │
│                             │                               │
│              [LabResult 자동 생성]                           │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
                    Hospital RUN DB
```

### 1.2 데이터 모델

```prisma
// 장비 등록
model LabInstrument {
  id             String   @id @default(uuid()) @db.Uuid
  name           String   @db.VarChar(200)           // "Sysmex XN-1000"
  manufacturer   String   @db.VarChar(200)           // "Sysmex"
  model          String   @db.VarChar(100)           // "XN-1000"
  serialNumber   String?  @map("serial_number")
  category       String   @db.VarChar(50)            // HEMATOLOGY, CHEMISTRY, IMMUNOLOGY, URINALYSIS, COAGULATION
  interfaceType  String   @map("interface_type") @db.VarChar(30)  // HL7, FILE_WATCH, PDF_UPLOAD, API, MANUAL
  interfaceConfig Json?   @map("interface_config") @db.JsonB
  // interfaceConfig 예시:
  // HL7:        { "host": "192.168.1.10", "port": 5000, "version": "2.5.1" }
  // FILE_WATCH: { "watchDir": "/lab-data/sysmex/", "pattern": "*.csv", "encoding": "UTF-8", "delimiter": "," }
  // PDF_UPLOAD: { "uploadDir": "/lab-uploads/", "ocrEnabled": false }
  // API:        { "endpoint": "https://analyzer.local/api/results", "apiKey": "..." }
  location       String?  @db.VarChar(100)           // "검사실 1"
  isActive       Boolean  @default(true)
  lastSyncAt     DateTime? @map("last_sync_at")
  createdAt      DateTime @default(now())

  results        LabInterfaceResult[]
  qcRecords      LabQcRecord[]

  @@map("lab_instruments")
}

// 장비로부터 수신된 원시 결과
model LabInterfaceResult {
  id             String   @id @default(uuid()) @db.Uuid
  instrumentId   String   @map("instrument_id") @db.Uuid
  rawData        Json     @map("raw_data") @db.JsonB     // 원시 데이터 (파싱 전)
  parsedItems    Json?    @map("parsed_items") @db.JsonB  // 파싱된 결과 [{testCode, value, unit, flag}]
  sampleBarcode  String?  @map("sample_barcode")          // 검체 바코드
  matchedOrderId String?  @map("matched_order_id") @db.Uuid
  matchedLabResultId String? @map("matched_lab_result_id") @db.Uuid
  status         String   @default("RECEIVED") @db.VarChar(20) // RECEIVED, MATCHED, APPLIED, REJECTED, ERROR
  errorMessage   String?  @map("error_message")
  receivedAt     DateTime @default(now()) @map("received_at")
  appliedAt      DateTime? @map("applied_at")

  instrument     LabInstrument @relation(fields: [instrumentId], references: [id])

  @@index([sampleBarcode])
  @@index([status])
  @@map("lab_interface_results")
}

// 검사기록지 (Worksheet)
model LabWorksheet {
  id             String   @id @default(uuid()) @db.Uuid
  name           String   @db.VarChar(200)           // "2026-05-19 혈액검사 1번"
  instrumentId   String?  @map("instrument_id") @db.Uuid
  category       String   @db.VarChar(50)            // HEMATOLOGY, CHEMISTRY, etc.
  date           DateTime @db.Date
  technicianId   String   @map("technician_id") @db.Uuid
  status         String   @default("OPEN") @db.VarChar(20) // OPEN, IN_PROGRESS, COMPLETED, SIGNED
  signedBy       String?  @map("signed_by") @db.Uuid
  signedAt       DateTime? @map("signed_at")
  notes          String?  @db.Text
  createdAt      DateTime @default(now())

  items          LabWorksheetItem[]

  @@map("lab_worksheets")
}

model LabWorksheetItem {
  id             String   @id @default(uuid()) @db.Uuid
  worksheetId    String   @map("worksheet_id") @db.Uuid
  orderId        String   @map("order_id") @db.Uuid
  labResultId    String?  @map("lab_result_id") @db.Uuid
  sequence       Int                                   // 워크시트 내 순서
  sampleBarcode  String?  @map("sample_barcode")
  status         String   @default("PENDING") @db.VarChar(20) // PENDING, TESTED, VERIFIED, REJECTED

  worksheet      LabWorksheet @relation(fields: [worksheetId], references: [id])

  @@map("lab_worksheet_items")
}
```

### 1.3 파일 업로드 기반 결과 수신

```
POST /api/v1/lab/interface/upload
Content-Type: multipart/form-data

Body:
  - file: PDF/CSV/TXT/XLS 파일
  - instrumentId: 장비 ID (선택)
  - category: 검사 카테고리

Response:
{
  "data": {
    "id": "uuid",
    "fileName": "result_20260519.csv",
    "parsedCount": 15,
    "matchedCount": 12,
    "unmatchedCount": 3,
    "items": [
      { "sampleBarcode": "S20260519001", "testCode": "CBC", "matched": true, "orderId": "uuid" },
      { "sampleBarcode": "S20260519016", "testCode": "UA", "matched": false, "suggestion": "검체 바코드 미매칭" }
    ]
  }
}
```

### 1.4 PDF 결과 첨부

```
POST /api/v1/lab/result/:labResultId/attachments
Content-Type: multipart/form-data

Body:
  - file: PDF 파일 (외부 기관 보고서, 장비 출력물 등)
  - type: INSTRUMENT_REPORT | EXTERNAL_REPORT | QUALITY_CERT | OTHER
  - description: "Sysmex XN-1000 분석 리포트"

// LabResult에 attachments 필드 추가
model LabResultAttachment {
  id          String   @id @default(uuid()) @db.Uuid
  labResultId String   @map("lab_result_id") @db.Uuid
  fileName    String   @map("file_name")
  fileUrl     String   @map("file_url")
  fileSize    Int      @map("file_size")
  mimeType    String   @map("mime_type")
  type        String   @db.VarChar(30)  // INSTRUMENT_REPORT, EXTERNAL_REPORT, QUALITY_CERT
  description String?
  uploadedBy  String   @map("uploaded_by") @db.Uuid
  uploadedAt  DateTime @default(now()) @map("uploaded_at")

  labResult   LabResult @relation(fields: [labResultId], references: [id])

  @@map("lab_result_attachments")
}
```

### 1.5 API 엔드포인트

| # | Method | Endpoint | 설명 |
|---|--------|----------|------|
| 1 | GET | `/api/v1/lab/instruments` | 장비 목록 |
| 2 | POST | `/api/v1/lab/instruments` | 장비 등록 |
| 3 | PUT | `/api/v1/lab/instruments/:id` | 장비 수정 |
| 4 | POST | `/api/v1/lab/interface/upload` | 파일 업로드 (CSV/PDF/TXT) |
| 5 | POST | `/api/v1/lab/interface/receive` | API 방식 결과 수신 |
| 6 | GET | `/api/v1/lab/interface/pending` | 미매칭 결과 목록 |
| 7 | PATCH | `/api/v1/lab/interface/:id/match` | 수동 매칭 (바코드 → 오더) |
| 8 | PATCH | `/api/v1/lab/interface/:id/apply` | 매칭 결과 적용 (LabResult 자동 생성) |
| 9 | PATCH | `/api/v1/lab/interface/:id/reject` | 결과 거부 |
| 10 | POST | `/api/v1/lab/result/:id/attachments` | PDF 첨부 |
| 11 | GET | `/api/v1/lab/result/:id/attachments` | 첨부파일 목록 |

---

## Phase 2: 검사기록지 (Worksheet)

### 2.1 워크플로우

```
1. 검사기사가 워크시트 생성
   - 날짜, 장비, 카테고리 선택
   - 대기 중인 오더에서 항목 추가 (드래그 or 바코드 스캔)

2. 검체 접수
   - 바코드 스캔 → 워크시트에 자동 추가
   - 검체 상태 확인 (용혈, 지질혈, 양 부족 등)

3. 검사 수행
   - 장비 가동 → 결과 자동 수신 (Phase 1 연동)
   - 또는 수동 입력

4. 결과 검증 + 서명
   - 이상치 자동 검출 (Delta Check, 패닉값)
   - 검사기사 1차 검증
   - 전문의 서명 (필요시)

5. 결과 보고
   - LabResult에 반영 → 의사 조회 가능
   - 긴급(STAT) 결과 자동 알림
```

### 2.2 API

| # | Method | Endpoint | 설명 |
|---|--------|----------|------|
| 1 | GET | `/api/v1/lab/worksheets` | 워크시트 목록 |
| 2 | POST | `/api/v1/lab/worksheets` | 워크시트 생성 |
| 3 | POST | `/api/v1/lab/worksheets/:id/items` | 오더 추가 |
| 4 | DELETE | `/api/v1/lab/worksheets/:id/items/:itemId` | 오더 제거 |
| 5 | PATCH | `/api/v1/lab/worksheets/:id/sign` | 워크시트 서명/완료 |
| 6 | POST | `/api/v1/lab/barcode/scan` | 바코드 스캔 → 검체 매칭 |

---

## Phase 3: 외부 위탁검사 (Send-Out)

### 3.1 위탁검사 흐름

```
의뢰 → 검체 채취 → 위탁기관 발송 → 결과 수신(PDF/API) → 결과 입력 → 보고
```

### 3.2 데이터 모델

```prisma
model LabSendOut {
  id               String   @id @default(uuid()) @db.Uuid
  orderId          String   @map("order_id") @db.Uuid
  referenceLabId   String   @map("reference_lab_id") @db.Uuid
  sentAt           DateTime @map("sent_at")
  trackingNumber   String?  @map("tracking_number")
  expectedDate     DateTime? @map("expected_date")
  resultReceivedAt DateTime? @map("result_received_at")
  resultFileUrl    String?  @map("result_file_url")    // PDF 결과지
  status           String   @default("SENT") @db.VarChar(20) // SENT, IN_TRANSIT, RECEIVED, REPORTED

  referenceLab     ReferenceLab @relation(fields: [referenceLabId], references: [id])

  @@map("lab_send_outs")
}

model ReferenceLab {
  id          String   @id @default(uuid()) @db.Uuid
  name        String   @db.VarChar(200)           // "가상검사재단A", "가상검사재단B"
  code        String   @unique @db.VarChar(20)    // "SCL", "GC-LABS"
  contactInfo Json?    @map("contact_info") @db.JsonB
  apiEndpoint String?  @map("api_endpoint")       // 전자연동 API (있는 경우)
  isActive    Boolean  @default(true)

  sendOuts    LabSendOut[]
  testCatalog LabSendOutCatalog[]

  @@map("reference_labs")
}

model LabSendOutCatalog {
  id             String @id @default(uuid()) @db.Uuid
  referenceLabId String @map("reference_lab_id") @db.Uuid
  testCode       String @map("test_code") @db.VarChar(50)
  testName       String @map("test_name") @db.VarChar(200)
  turnaroundDays Int    @map("turnaround_days")          // 소요일수
  price          Decimal? @db.Decimal(10, 0)
  sampleType     String? @map("sample_type")              // BLOOD, URINE, TISSUE, etc.
  sampleVolume   String? @map("sample_volume")            // "3mL EDTA"
  category       String? @db.VarChar(50)                  // GENETICS, CELL_THERAPY, SPECIAL

  referenceLab   ReferenceLab @relation(fields: [referenceLabId], references: [id])

  @@map("lab_send_out_catalog")
}
```

---

## Phase 4: 세포치료 검사 (Cell Therapy Lab)

### 4.1 개요

세포치료(CAR-T, NK세포, 줄기세포 등)는 기존 검사와 달리:
- **장기간 추적** (세포 배양 7~21일)
- **환경 모니터링** (온도, CO2, 습도)
- **GMP 기준 문서화** (배치 기록, 멸균시험, 세포 계수)
- **규제 보고** (식약처 세포치료제 기준)

### 4.2 데이터 모델

```prisma
model CellTherapyBatch {
  id             String   @id @default(uuid()) @db.Uuid
  patientId      String   @map("patient_id") @db.Uuid
  orderId        String?  @map("order_id") @db.Uuid
  batchNumber    String   @unique @map("batch_number") @db.VarChar(30) // "CT-2026-0519-001"
  cellType       String   @map("cell_type") @db.VarChar(50) // CAR_T, NK, MSC, DC, TIL
  sourceType     String   @map("source_type") @db.VarChar(30) // AUTOLOGOUS, ALLOGENEIC
  collectionDate DateTime @map("collection_date")
  processingStart DateTime? @map("processing_start")
  processingEnd  DateTime? @map("processing_end")
  targetDose     String?  @map("target_dose")               // "1×10^6 cells/kg"
  status         String   @default("COLLECTED") @db.VarChar(20)
  // COLLECTED → PROCESSING → CULTURE → QC_TESTING → RELEASED → ADMINISTERED → COMPLETED

  environmentLogs CellEnvironmentLog[]
  qcTests        CellQcTest[]
  documents      CellBatchDocument[]

  @@map("cell_therapy_batches")
}

model CellEnvironmentLog {
  id          String   @id @default(uuid()) @db.Uuid
  batchId     String   @map("batch_id") @db.Uuid
  temperature Decimal  @db.Decimal(4, 1)          // 37.0°C
  co2Percent  Decimal  @map("co2_percent") @db.Decimal(4, 1)  // 5.0%
  humidity    Decimal? @db.Decimal(4, 1)           // 95.0%
  recordedAt  DateTime @map("recorded_at")
  recordedBy  String?  @map("recorded_by") @db.Uuid
  isAlert     Boolean  @default(false)            // 범위 이탈 시

  batch       CellTherapyBatch @relation(fields: [batchId], references: [id])

  @@map("cell_environment_logs")
}

model CellQcTest {
  id          String   @id @default(uuid()) @db.Uuid
  batchId     String   @map("batch_id") @db.Uuid
  testType    String   @map("test_type") @db.VarChar(50)
  // VIABILITY (생존율), CELL_COUNT (세포수), STERILITY (무균시험),
  // ENDOTOXIN (내독소), MYCOPLASMA (마이코플라즈마),
  // IDENTITY (동일성), POTENCY (역가), KARYOTYPE (핵형)
  result      String   @db.VarChar(200)
  unit        String?  @db.VarChar(50)
  passFail    String   @map("pass_fail") @db.VarChar(10) // PASS, FAIL, PENDING
  testedAt    DateTime @map("tested_at")
  testedBy    String   @map("tested_by") @db.Uuid
  reportUrl   String?  @map("report_url")         // PDF 보고서

  batch       CellTherapyBatch @relation(fields: [batchId], references: [id])

  @@map("cell_qc_tests")
}

model CellBatchDocument {
  id          String   @id @default(uuid()) @db.Uuid
  batchId     String   @map("batch_id") @db.Uuid
  docType     String   @map("doc_type") @db.VarChar(30)
  // BATCH_RECORD (배치기록서), COA (분석성적서), RELEASE_CERT (출하승인서),
  // INFORMED_CONSENT (동의서), PROTOCOL (프로토콜)
  fileName    String   @map("file_name")
  fileUrl     String   @map("file_url")
  uploadedBy  String   @map("uploaded_by") @db.Uuid
  uploadedAt  DateTime @default(now()) @map("uploaded_at")

  batch       CellTherapyBatch @relation(fields: [batchId], references: [id])

  @@map("cell_batch_documents")
}
```

### 4.3 세포치료 워크플로우

```
환자 동의 → 세포 채취 → 배양 시작 → 환경 모니터링 → QC 검사 → 출하 승인 → 투여

Day 0: 말초혈 채취 (Leukapheresis)
Day 1-3: 세포 분리 + 활성화
Day 3-14: 배양 (GMP Clean Room)
  - 매일: 환경 로그 (온도/CO2/습도)
  - 3일마다: 세포 계수 + 생존율
Day 14: QC 최종 검사
  - 무균시험, 내독소, 마이코플라즈마, 핵형, 역가
Day 15-16: 결과 판정 → 출하 승인
Day 17+: 환자 투여
```

### 4.4 API

| # | Method | Endpoint | 설명 |
|---|--------|----------|------|
| 1 | POST | `/api/v1/lab/cell-therapy/batches` | 배치 생성 |
| 2 | GET | `/api/v1/lab/cell-therapy/batches` | 배치 목록 |
| 3 | GET | `/api/v1/lab/cell-therapy/batches/:id` | 배치 상세 |
| 4 | PATCH | `/api/v1/lab/cell-therapy/batches/:id/status` | 상태 변경 |
| 5 | POST | `/api/v1/lab/cell-therapy/batches/:id/environment` | 환경 로그 기록 |
| 6 | POST | `/api/v1/lab/cell-therapy/batches/:id/qc` | QC 검사 기록 |
| 7 | POST | `/api/v1/lab/cell-therapy/batches/:id/documents` | 문서 첨부 |
| 8 | PATCH | `/api/v1/lab/cell-therapy/batches/:id/release` | 출하 승인 |

---

## Phase 5: 유전체 검사 (Genomics Lab)

### 5.1 개요

유전체 검사는:
- **대용량 데이터** (NGS 시퀀싱 수 GB)
- **장기 TAT** (7~30일)
- **전문 분석 파이프라인** (bioinformatics)
- **유전상담 연계** 필수
- **규제 보고** (유전자검사 관리법)

### 5.2 지원 검사 유형

| 검사 | 기술 | TAT | 용도 |
|------|------|-----|------|
| Targeted Panel | NGS (50~500 유전자) | 7~14일 | 암 패널, 유전성 질환 |
| WES (전엑솜) | NGS | 14~21일 | 희귀질환, 진단 미확정 |
| WGS (전게놈) | NGS | 21~30일 | 연구, 정밀의료 |
| Liquid Biopsy | cfDNA NGS | 7~10일 | 암 모니터링 |
| Pharmacogenomics | SNP Array/NGS | 5~7일 | 약물유전체 |
| HLA Typing | NGS/SSO | 3~7일 | 이식, 자가면역 |
| FISH/Karyotype | 형광현미경 | 3~5일 | 염색체 이상 |
| BRCA 1/2 | Sanger/NGS | 7~14일 | 유방암/난소암 |

### 5.3 데이터 모델

```prisma
model GenomicTest {
  id             String   @id @default(uuid()) @db.Uuid
  orderId        String?  @map("order_id") @db.Uuid
  patientId      String   @map("patient_id") @db.Uuid
  testType       String   @map("test_type") @db.VarChar(50)
  // TARGETED_PANEL, WES, WGS, LIQUID_BIOPSY, PHARMACOGENOMICS,
  // HLA_TYPING, FISH, KARYOTYPE, BRCA, SINGLE_GENE
  panelName      String?  @map("panel_name") @db.VarChar(200) // "Oncomine Comprehensive Plus"
  sampleType     String   @map("sample_type") @db.VarChar(30) // BLOOD, TISSUE, FFPE, SALIVA, cfDNA
  referenceLabId String?  @map("reference_lab_id") @db.Uuid   // 위탁 시
  status         String   @default("ORDERED") @db.VarChar(20)
  // ORDERED → SAMPLE_RECEIVED → EXTRACTION → LIBRARY_PREP → SEQUENCING →
  // ANALYSIS → INTERPRETATION → REPORTED → COUNSELED
  orderedAt      DateTime @default(now()) @map("ordered_at")
  reportedAt     DateTime? @map("reported_at")
  counseledAt    DateTime? @map("counseled_at")               // 유전상담 완료

  variants       GenomicVariant[]
  reports        GenomicReport[]

  @@map("genomic_tests")
}

model GenomicVariant {
  id             String   @id @default(uuid()) @db.Uuid
  genomicTestId  String   @map("genomic_test_id") @db.Uuid
  gene           String   @db.VarChar(50)            // "BRCA1", "EGFR", "TP53"
  chromosome     String?  @db.VarChar(10)            // "chr17"
  position       BigInt?                             // 41276045
  refAllele      String?  @map("ref_allele") @db.VarChar(500)
  altAllele      String?  @map("alt_allele") @db.VarChar(500)
  variantType    String   @map("variant_type") @db.VarChar(30) // SNV, INDEL, CNV, FUSION, REARRANGEMENT
  zygosity       String?  @db.VarChar(20)            // HETEROZYGOUS, HOMOZYGOUS, HEMIZYGOUS
  classification String   @db.VarChar(30)            // PATHOGENIC, LIKELY_PATHOGENIC, VUS, LIKELY_BENIGN, BENIGN
  // ACMG/AMP 5-tier classification
  alleleFreq     Decimal? @map("allele_freq") @db.Decimal(6, 4) // VAF: 0.4500
  clinicalSig    String?  @map("clinical_sig") @db.Text          // 임상적 의의
  actionability  String?  @db.VarChar(20)            // TIER_1, TIER_2, TIER_3, TIER_4 (AMP 분류)
  dbSnpId        String?  @map("db_snp_id")          // rs28897743
  cosmicId       String?  @map("cosmic_id")          // COSM6240
  hgvsC          String?  @map("hgvs_c")             // c.5266dupC
  hgvsP          String?  @map("hgvs_p")             // p.Gln1756ProfsTer74

  genomicTest    GenomicTest @relation(fields: [genomicTestId], references: [id])

  @@map("genomic_variants")
}

model GenomicReport {
  id             String   @id @default(uuid()) @db.Uuid
  genomicTestId  String   @map("genomic_test_id") @db.Uuid
  reportType     String   @map("report_type") @db.VarChar(30)
  // PRELIMINARY, FINAL, AMENDED, ADDENDUM
  interpretation String?  @db.Text                   // 종합 해석
  recommendation String?  @db.Text                   // 임상 권고
  reportFileUrl  String?  @map("report_file_url")    // PDF 보고서
  reportedBy     String   @map("reported_by") @db.Uuid // 판독의
  reportedAt     DateTime @map("reported_at")

  genomicTest    GenomicTest @relation(fields: [genomicTestId], references: [id])

  @@map("genomic_reports")
}
```

### 5.4 API

| # | Method | Endpoint | 설명 |
|---|--------|----------|------|
| 1 | POST | `/api/v1/lab/genomics/tests` | 유전체 검사 의뢰 |
| 2 | GET | `/api/v1/lab/genomics/tests` | 의뢰 목록 |
| 3 | GET | `/api/v1/lab/genomics/tests/:id` | 상세 (변이 + 보고서) |
| 4 | PATCH | `/api/v1/lab/genomics/tests/:id/status` | 상태 변경 |
| 5 | POST | `/api/v1/lab/genomics/tests/:id/variants` | 변이 등록 |
| 6 | POST | `/api/v1/lab/genomics/tests/:id/report` | 보고서 작성/첨부 |
| 7 | POST | `/api/v1/lab/genomics/tests/:id/counsel` | 유전상담 기록 |
| 8 | GET | `/api/v1/lab/genomics/patients/:patientId` | 환자 유전체 이력 |

---

## Phase 6: 정도관리 (QC)

### 6.1 정도관리 항목

```prisma
model LabQcRecord {
  id             String   @id @default(uuid()) @db.Uuid
  instrumentId   String   @map("instrument_id") @db.Uuid
  qcMaterialId   String?  @map("qc_material_id")      // QC 물질 LOT
  qcLevel        String   @map("qc_level") @db.VarChar(20) // LEVEL_1, LEVEL_2, LEVEL_3
  testCode       String   @map("test_code") @db.VarChar(50)
  measuredValue  Decimal  @map("measured_value") @db.Decimal(10, 3)
  targetMean     Decimal  @map("target_mean") @db.Decimal(10, 3)
  targetSD       Decimal  @map("target_sd") @db.Decimal(10, 3)
  zScore         Decimal? @map("z_score") @db.Decimal(5, 2)
  westgardRule   String?  @map("westgard_rule") @db.VarChar(20) // 1-2s, 1-3s, 2-2s, R-4s, 4-1s, 10x
  isAccepted     Boolean  @map("is_accepted")
  performedAt    DateTime @map("performed_at")
  performedBy    String   @map("performed_by") @db.Uuid
  notes          String?  @db.Text

  instrument     LabInstrument @relation(fields: [instrumentId], references: [id])

  @@map("lab_qc_records")
}
```

### 6.2 Westgard Rules 자동 판정

| Rule | 기준 | 조치 |
|------|------|------|
| 1-2s | 1개 결과 ±2SD 초과 | 경고 (Warning) |
| 1-3s | 1개 결과 ±3SD 초과 | 거부 (Reject) |
| 2-2s | 연속 2개 같은 방향 ±2SD | 거부 |
| R-4s | 연속 2개 반대 방향 4SD 차이 | 거부 (Random Error) |
| 4-1s | 연속 4개 같은 방향 ±1SD | 경고 (Systematic) |
| 10x | 연속 10개 같은 방향 | 거부 (Systematic Shift) |

---

## 구현 우선순위

### Phase 1 (즉시): 파일 기반 결과 수신 + PDF 첨부
- LabResultAttachment 모델
- 파일 업로드 API
- 결과 PDF 뷰어 (프론트)

### Phase 2 (단기): 검사기록지 + 바코드
- LabWorksheet 모델 + UI
- 바코드 생성/스캔

### Phase 3 (단기): 위탁검사
- ReferenceLab 마스터
- LabSendOut 추적
- PDF 결과 수신

### Phase 4 (중기): 세포치료
- CellTherapyBatch 전체 모델
- 환경 모니터링 대시보드
- GMP 문서 관리

### Phase 5 (중기): 유전체 검사
- GenomicTest + Variant 모델
- 변이 분류 (ACMG/AMP)
- 유전상담 연계

### Phase 6 (장기): 정도관리 + 장비 인터페이스
- QC 자동 판정 (Westgard)
- HL7/ASTM 실시간 연동
- Levey-Jennings 차트

---

## 화면 기획

### 전체 네비게이션 구조

```
검사실 (/lab)
├── 검사 대기열          ← 기존 (개선)
├── 검사기록지           ← 신규
├── 장비 관리            ← 신규
├── 위탁검사             ← 신규
├── 세포치료             ← 신규
├── 유전체검사           ← 신규
└── 정도관리(QC)         ← 신규

관리자 (/admin)
└── 검사실 설정
    ├── 장비 등록/설정
    ├── 수탁기관 관리
    └── QC 물질/기준 관리
```

### 화면 1: 검사실 메인 — 탭 기반 통합 화면 `/lab`

```
┌─ 검사실 ──────────────────────────────────────────────────────────────────┐
│                                                                           │
│  [대기열]  [기록지]  [장비수신]  [위탁검사]  [세포치료]  [유전체]  [QC]    │
│  ─────────────────────────────────────────────────────────────────────     │
│                                                                           │
│  ┌─ 상단 통계 ────────────────────────────────────────────────────────┐   │
│  │ 접수대기: 11  │  진행중: 5  │  결과대기: 3  │  위탁대기: 2  │ QC: ✓ │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  ┌─ 대기열 테이블 ──────────────────────┬─ 상세/결과입력 패널 ──────────┐ │
│  │                                      │                              │ │
│  │  (기존 검사 대기열 테이블)            │  (기존 상세 + 결과 입력)     │ │
│  │                                      │  + [PDF 첨부] 버튼 추가      │ │
│  │                                      │  + 첨부파일 목록              │ │
│  └──────────────────────────────────────┴──────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
```

### 화면 2: 검사기록지 (Worksheet) 탭

```
┌─ 검사기록지 ──────────────────────────────────────────────────────────────┐
│                                                                           │
│  [+ 새 기록지 생성]                                     [날짜 필터 ▼]    │
│                                                                           │
│  ┌─ 기록지 목록 ────────────────────────────────────────────────────────┐ │
│  │ 번호        날짜         장비              카테고리    상태    항목수 │ │
│  │ WS-0519-01  2026-05-19   Sysmex XN-1000   혈액검사    진행중    15   │ │
│  │ WS-0519-02  2026-05-19   Cobas c702       생화학      완료      22   │ │
│  │ WS-0518-03  2026-05-18   Architect i2000  면역검사    서명완료   8   │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ┌─ 기록지 상세 (WS-0519-01) ───────────────────────────────────────────┐ │
│  │                                                                       │ │
│  │  장비: Sysmex XN-1000  │  담당: 문검사  │  날짜: 2026-05-19          │ │
│  │  상태: [진행중]                                                       │ │
│  │                                                                       │ │
│  │  ┌─ 검체 목록 ─────────────────────────────────────────────────────┐ │ │
│  │  │ #   바코드           환자      검사명       검체상태   결과상태 │ │ │
│  │  │ 1   S20260519-001   김OO      CBC          정상       완료 ✓   │ │ │
│  │  │ 2   S20260519-002   박OO      CBC+Diff     정상       완료 ✓   │ │ │
│  │  │ 3   S20260519-003   이OO      CBC          용혈 ⚠    재채취   │ │ │
│  │  │ 4   S20260519-004   최OO      CBC+ESR      정상       대기 ○   │ │ │
│  │  └─────────────────────────────────────────────────────────────────┘ │ │
│  │                                                                       │ │
│  │  [바코드 스캔 추가]  [오더에서 추가]  [기록지 서명]  [PDF 출력]       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
```

### 화면 3: 장비 수신 (Interface) 탭

```
┌─ 장비 수신 ───────────────────────────────────────────────────────────────┐
│                                                                           │
│  [파일 업로드 ↑]  [수동 수신]                    [미매칭만 보기 ☐]       │
│                                                                           │
│  ┌─ 수신 결과 목록 ─────────────────────────────────────────────────────┐ │
│  │ 시간       장비              파일명              매칭  상태          │ │
│  │ 12:30     Sysmex XN-1000   result_0519_01.csv   15/15  적용완료 ✓  │ │
│  │ 12:15     Cobas c702       cobas_batch_42.txt   20/22  미매칭 2건  │ │
│  │ 11:50     (PDF 업로드)      외부결과_SCL.pdf     -      수동매칭   │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ┌─ 미매칭 항목 ────────────────────────────────────────────────────────┐ │
│  │                                                                       │ │
│  │  바코드: S20260519-021                                                │ │
│  │  검사: AST 45 U/L, ALT 62 U/L                                       │ │
│  │  매칭 후보: [검색 입력 ___________]                                   │ │
│  │                                                                       │ │
│  │  → 고재민 (HR-20260506-0031) 간기능검사(AST/ALT)  [매칭 적용]        │ │
│  │  → 권민서75 (HR-20260506-0294) 전해질검사         [매칭 적용]        │ │
│  │                                                                       │ │
│  │  [매칭 건너뛰기]  [거부]                                              │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ┌─ 파일 업로드 모달 ───────────────────────────────────────────────────┐ │
│  │                                                                       │ │
│  │  장비 선택: [Sysmex XN-1000 ▼]  (또는 "수동 업로드")                 │ │
│  │                                                                       │ │
│  │  ┌──────────────────────────────┐                                     │ │
│  │  │                              │                                     │ │
│  │  │   📄 파일을 드래그하거나      │   지원 형식:                       │ │
│  │  │      클릭하여 선택            │   CSV, TXT, PDF, XLS, HL7          │ │
│  │  │                              │                                     │ │
│  │  └──────────────────────────────┘                                     │ │
│  │                                                                       │ │
│  │  [업로드 + 자동 매칭]  [취소]                                         │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
```

### 화면 4: 위탁검사 탭

```
┌─ 위탁검사 ────────────────────────────────────────────────────────────────┐
│                                                                           │
│  [+ 위탁 의뢰]              [수탁기관 ▼] [상태 ▼]  [기간 ▼]             │
│                                                                           │
│  ┌─ 위탁 현황 카드 ─────────────────────────────────────────────────────┐ │
│  │  발송대기: 3  │  운송중: 2  │  검사중: 5  │  결과도착: 1  │  완료: 48 │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ┌─ 위탁 목록 ──────────────────────────────────────────────────────────┐ │
│  │ 의뢰일     환자     검사명             수탁기관    예정일   상태     │ │
│  │ 05-19     김OO     BRCA 1/2           SCL       05-29    검사중   │ │
│  │ 05-18     박OO     약물유전체 패널     녹십자     05-25    운송중   │ │
│  │ 05-17     이OO     HLA Typing         SCL       05-22    결과도착 │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ┌─ 위탁 상세 ──────────────────────────────────────────────────────────┐ │
│  │  환자: 이OO  │  검사: HLA Typing  │  수탁: 가상검사재단A          │ │
│  │  의뢰: 05-17  │  예정: 05-22  │  상태: 결과도착                     │ │
│  │                                                                       │ │
│  │  운송번호: TRK-20260517-003                                           │ │
│  │  검체: EDTA Blood 5mL                                                │ │
│  │                                                                       │ │
│  │  ┌─ 결과 파일 ──────────────────────────────────────────────────┐    │ │
│  │  │  📄 HLA_결과_이OO_20260522.pdf       [보기]  [다운로드]      │    │ │
│  │  └──────────────────────────────────────────────────────────────┘    │ │
│  │                                                                       │ │
│  │  [결과 확인 → LabResult 반영]  [재검사 요청]                          │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ┌─ 위탁 의뢰 모달 ────────────────────────────────────────────────────┐ │
│  │  환자 선택: [환자 검색 _________]                                     │ │
│  │  수탁기관: [가상검사재단A ▼]                                       │ │
│  │  검사 선택: [수탁 카탈로그에서 검색 _________]                         │ │
│  │    → BRCA 1/2 (NGS) — TAT 14일, 검체: EDTA Blood 5mL                │ │
│  │    → HLA Typing — TAT 5일, 검체: EDTA Blood 10mL                    │ │
│  │  검체 유형: [EDTA Blood ▼]  용량: [5mL]                              │ │
│  │  임상 정보: [유방암 가족력, BRCA 검사 의뢰 ___________]               │ │
│  │  [의뢰 등록]  [취소]                                                  │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
```

### 화면 5: 세포치료 탭

```
┌─ 세포치료 ────────────────────────────────────────────────────────────────┐
│                                                                           │
│  [+ 새 배치]                              [상태 ▼]  [세포유형 ▼]        │
│                                                                           │
│  ┌─ 배치 현황 카드 ─────────────────────────────────────────────────────┐ │
│  │  채취완료: 1  │  배양중: 3  │  QC진행: 1  │  출하대기: 1  │ 투여: 2  │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ┌─ 배치 목록 ──────────────────────────────────────────────────────────┐ │
│  │ 배치번호         환자    세포유형   채취일    상태       경과일      │ │
│  │ CT-2026-0515-001 김OO    CAR-T     05-15    배양중 D4   ████░░░   │ │
│  │ CT-2026-0512-002 박OO    NK Cell   05-12    QC진행 D7   █████░░   │ │
│  │ CT-2026-0510-003 이OO    MSC       05-10    출하대기    ███████   │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ┌─ 배치 상세 (CT-2026-0515-001) ───────────────────────────────────────┐ │
│  │                                                                       │ │
│  │  환자: 김OO  │  세포: CAR-T  │  소스: 자가(Autologous)               │ │
│  │  채취: 05-15  │  배양시작: 05-16  │  목표: 1×10^6 cells/kg          │ │
│  │  상태: ████████░░░░░░ 배양 중 (Day 4/14)                             │ │
│  │                                                                       │ │
│  │  ── 환경 모니터링 (최근 24h) ──                                       │ │
│  │  ┌──────────────────────────────────────────────┐                     │ │
│  │  │  🌡 37.0°C ✓   │  💨 CO2 5.0% ✓  │  💧 95% ✓  │                 │ │
│  │  │  ───────────────────────────────────────      │                     │ │
│  │  │  [온도 그래프 (24h)]                          │                     │ │
│  │  │  37.2 ─ ─ ─ ─ ─ 상한                         │                     │ │
│  │  │  37.0 ─────────────────────                   │                     │ │
│  │  │  36.8 ─ ─ ─ ─ ─ 하한                         │                     │ │
│  │  └──────────────────────────────────────────────┘                     │ │
│  │                                                                       │ │
│  │  ── QC 검사 이력 ──                                                   │ │
│  │  │ Day 3: 세포계수 2.5×10^6 ✓  │  생존율 95.2% ✓                    │ │
│  │  │ Day 7: (예정)                                                      │ │
│  │  │ Day 14: 최종 QC (무균/내독소/마이코/핵형/역가)                     │ │
│  │                                                                       │ │
│  │  ── 문서 ──                                                           │ │
│  │  📄 배치기록서_CT-2026-0515-001.pdf    [보기]                         │ │
│  │  📄 동의서_김OO.pdf                   [보기]                         │ │
│  │  📄 프로토콜_CAR-T_v3.2.pdf           [보기]                         │ │
│  │                                                                       │ │
│  │  [환경 로그 기록]  [QC 검사 기록]  [문서 첨부]  [출하 승인]           │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
```

### 화면 6: 유전체 검사 탭

```
┌─ 유전체 검사 ─────────────────────────────────────────────────────────────┐
│                                                                           │
│  [+ 검사 의뢰]                    [검사유형 ▼]  [상태 ▼]  [기간 ▼]      │
│                                                                           │
│  ┌─ 현황 카드 ──────────────────────────────────────────────────────────┐ │
│  │  의뢰: 3  │  추출중: 2  │  시퀀싱: 1  │  분석: 2  │  판독대기: 1    │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ┌─ 검사 목록 ──────────────────────────────────────────────────────────┐ │
│  │ 의뢰일   환자    검사유형          패널           상태      TAT     │ │
│  │ 05-15   김OO    Targeted Panel   Oncomine 564   분석중     D4/14  │ │
│  │ 05-12   박OO    Liquid Biopsy    Guardant 360   판독대기   D7/10  │ │
│  │ 05-10   이OO    BRCA 1/2         -              보고완료   D9/14  │ │
│  │ 05-08   최OO    WES              -              상담대기   D11/21 │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ┌─ 검사 상세 (김OO - Targeted Panel) ──────────────────────────────────┐ │
│  │                                                                       │ │
│  │  환자: 김OO  │  검사: Targeted Panel (Oncomine Comprehensive Plus)    │ │
│  │  검체: FFPE Tissue  │  진행: ████████░░░ 분석 중 (Day 4/14)          │ │
│  │                                                                       │ │
│  │  ── 워크플로우 ──                                                     │ │
│  │  [의뢰 ✓] → [검체수령 ✓] → [DNA추출 ✓] → [Library ✓]               │ │
│  │  → [시퀀싱 ✓] → [분석 ●] → [판독 ○] → [보고 ○] → [상담 ○]         │ │
│  │                                                                       │ │
│  │  ── 변이 결과 (분석 중간 결과) ──                                     │ │
│  │  ┌───────────────────────────────────────────────────────────────┐    │ │
│  │  │ 유전자   변이              분류          VAF    Tier   약물   │    │ │
│  │  │ EGFR    L858R (p.Leu858Arg)                                  │    │ │
│  │  │         🔴 Pathogenic     45.2%   Tier1  Osimertinib ✓       │    │ │
│  │  │ TP53    R175H (p.Arg175His)                                  │    │ │
│  │  │         🔴 Pathogenic     32.1%   Tier2  -                   │    │ │
│  │  │ KRAS    G12C (p.Gly12Cys)                                   │    │ │
│  │  │         🟡 Likely Path.   18.5%   Tier1  Sotorasib ✓         │    │ │
│  │  │ VHL     c.463A>G                                             │    │ │
│  │  │         ⚪ VUS            5.2%    Tier3  -                   │    │ │
│  │  └───────────────────────────────────────────────────────────────┘    │ │
│  │                                                                       │ │
│  │  ── 보고서 ──                                                         │ │
│  │  📄 중간보고서_김OO_20260519.pdf         [보기]                       │ │
│  │                                                                       │ │
│  │  ── 임상 권고 (AI 보조) ──                                            │ │
│  │  EGFR L858R + → Osimertinib (NCCN Category 1)                        │ │
│  │  KRAS G12C + → Sotorasib (NCCN Category 2A)                          │ │
│  │                                                                       │ │
│  │  [변이 추가]  [보고서 작성]  [유전상담 기록]                           │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ┌─ 유전상담 기록 모달 ─────────────────────────────────────────────────┐ │
│  │  상담일: [2026-05-19]  상담의: [홍원장 ▼]                             │ │
│  │  상담 유형: [● 검사 전 상담  ○ 결과 상담  ○ 추적 상담]               │ │
│  │  상담 내용:                                                           │ │
│  │  ┌──────────────────────────────────────────────────────────┐         │ │
│  │  │  EGFR L858R 변이 양성으로 Osimertinib 표적치료 권고.     │         │ │
│  │  │  가족 유전상담: 해당 없음 (체세포 변이)                   │         │ │
│  │  └──────────────────────────────────────────────────────────┘         │ │
│  │  가족력 메모: [_____________________]                                 │ │
│  │  추적 예정일: [2026-08-19]                                            │ │
│  │  [상담 기록 저장]  [취소]                                              │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
```

### 화면 7: 정도관리 (QC) 탭

```
┌─ 정도관리 ────────────────────────────────────────────────────────────────┐
│                                                                           │
│  [+ QC 기록]                              [장비 ▼]  [검사항목 ▼]        │
│                                                                           │
│  ┌─ 오늘 QC 현황 ───────────────────────────────────────────────────────┐ │
│  │  장비               L1 QC    L2 QC    L3 QC    최종판정             │ │
│  │  Sysmex XN-1000    ✓ Pass   ✓ Pass   ✓ Pass   ✅ 적합              │ │
│  │  Cobas c702        ✓ Pass   ⚠ 1-2s   ✓ Pass   ⚠ 경고              │ │
│  │  Architect i2000   미실시   미실시   미실시    ❌ 미실시             │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ┌─ Levey-Jennings Chart ───────────────────────────────────────────────┐ │
│  │  장비: Cobas c702  │  항목: Glucose  │  Level 2                      │ │
│  │                                                                       │ │
│  │  +3SD ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─      │ │
│  │  +2SD ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─●─ ─ ─     │ │
│  │  +1SD                                              ●                  │ │
│  │  Mean ──────●────●────●────●────●────●────●───────────────           │ │
│  │  -1SD          ●                  ●                                   │ │
│  │  -2SD ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─      │ │
│  │  -3SD ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─      │ │
│  │        5/10  5/11  5/12  5/13  5/14  5/15  5/16  5/17  5/18  5/19   │ │
│  │                                                                       │ │
│  │  Westgard 판정: ⚠ 1-2s (5/18) — 경고, 재검사 권고                   │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ┌─ QC 기록 입력 모달 ──────────────────────────────────────────────────┐ │
│  │  장비: [Cobas c702 ▼]                                                 │ │
│  │  QC 물질: [Bio-Rad Lyphochek Level 2 ▼]  LOT: [LOT-2026-05]         │ │
│  │                                                                       │ │
│  │  검사항목        측정값    Target Mean    Target SD    판정            │ │
│  │  Glucose         102.3    100.0          3.5          ✓ Pass          │ │
│  │  BUN             15.8     15.0           1.2          ✓ Pass          │ │
│  │  Creatinine      1.12     1.10           0.08         ✓ Pass          │ │
│  │  AST             38.2     35.0           2.5          ⚠ 1-2s         │ │
│  │  ALT             42.1     40.0           3.0          ✓ Pass          │ │
│  │                                                                       │ │
│  │  전체 판정: ⚠ 경고 (AST 항목 1-2s 위반)                              │ │
│  │  조치: [○ 승인 (결과 보고 가능)  ● 재검사  ○ 장비 교정]              │ │
│  │  비고: [AST QC 재실시 후 정상 확인 _____________]                     │ │
│  │                                                                       │ │
│  │  [QC 기록 저장]  [취소]                                                │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
```

### 화면 8: 관리자 — 검사실 설정 `/admin/lab-settings`

```
┌─ 검사실 설정 ─────────────────────────────────────────────────────────────┐
│                                                                           │
│  [장비 관리]  [수탁기관 관리]  [QC 기준 관리]  [검사코드 매핑]            │
│                                                                           │
│  ── 장비 관리 ──                                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │  장비명              제조사    모델         연동방식    상태         │ │
│  │  Sysmex XN-1000     Sysmex    XN-1000     File Watch  ● 정상      │ │
│  │  Cobas c702         Roche     c702        HL7 v2.5    ● 정상      │ │
│  │  Architect i2000    Abbott    i2000 SR    CSV Export   ○ 미연결    │ │
│  │  [+ 장비 추가]                                                      │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ── 장비 상세 설정 (Sysmex XN-1000) ──                                   │
│  │  연동 방식: [File Watch ▼]                                           │ │
│  │  감시 폴더: [/lab-data/sysmex/]                                      │ │
│  │  파일 패턴: [*.csv]                                                  │ │
│  │  인코딩: [UTF-8 ▼]   구분자: [, ▼]                                  │ │
│  │  검사코드 매핑:                                                       │ │
│  │    장비코드 "WBC" → HIS코드 "L0401" (백혈구 수)                      │ │
│  │    장비코드 "RBC" → HIS코드 "L0402" (적혈구 수)                      │ │
│  │    장비코드 "HGB" → HIS코드 "L0403" (헤모글로빈)                     │ │
│  │  [저장]  [연동 테스트]                                                │ │
│                                                                           │
│  ── 수탁기관 관리 ──                                                      │
│  │  기관명                코드      API 연동    검사 수    상태         │ │
│  │  가상검사재단A      SCL       ● 연동      245       활성          │ │
│  │  가상검사재단B        GC-LABS   ○ 미연동    180       활성          │ │
│  │  가상검사재단C          SAMKWANG  ○ 미연동    120       활성          │ │
│  │  [+ 기관 추가]                                                      │ │
│                                                                           │
│  ── QC 기준 관리 ──                                                       │
│  │  QC 물질              LOT           유효기간    장비              │ │
│  │  Lyphochek Level 1    LOT-2026-05   2026-11    Cobas c702        │ │
│  │  Lyphochek Level 2    LOT-2026-05   2026-11    Cobas c702        │ │
│  │  XN Check Level 1     LOT-2026-04   2026-10    Sysmex XN-1000   │ │
│  │  [+ QC 물질 추가]                                                   │ │
└───────────────────────────────────────────────────────────────────────────┘
```

### 프론트엔드 라우트 요약

| 라우트 | 페이지 | 역할 |
|--------|--------|------|
| `/lab` | 검사실 메인 (7탭) | LAB_TECH, ADMIN |
| `/lab?tab=queue` | 검사 대기열 | LAB_TECH |
| `/lab?tab=worksheet` | 검사기록지 | LAB_TECH |
| `/lab?tab=interface` | 장비 수신 | LAB_TECH |
| `/lab?tab=sendout` | 위탁검사 | LAB_TECH, DOCTOR |
| `/lab?tab=cell-therapy` | 세포치료 | LAB_TECH, DOCTOR |
| `/lab?tab=genomics` | 유전체 검사 | LAB_TECH, DOCTOR |
| `/lab?tab=qc` | 정도관리 | LAB_TECH |
| `/admin/lab-settings` | 검사실 설정 | ADMIN |

## 기대 효과

| 지표 | 현재 | 목표 |
|------|------|------|
| 결과 입력 시간 | 수동 5~10분/건 | 자동 연동 <1분 |
| 위탁검사 TAT 추적 | 불가 | 실시간 |
| QC 판정 | 수동 | Westgard 자동 |
| 세포치료 문서화 | 수기 | 전자 배치기록 |
| 유전체 변이 분류 | 외부 | ACMG 5-tier 자동 |

---

## 보완 사항 (검증 피드백 반영)

### Prisma Relation 보완

기획서의 모든 신규 모델은 아래 relation을 구현 시 반드시 포함:

```prisma
// LabWorksheet
model LabWorksheet {
  // ... 기존 필드 ...
  instrument   LabInstrument? @relation(fields: [instrumentId], references: [id])
  technician   User           @relation("WorksheetTechnician", fields: [technicianId], references: [id])
  signer       User?          @relation("WorksheetSigner", fields: [signedBy], references: [id])
}

// LabWorksheetItem
model LabWorksheetItem {
  // ... 기존 필드 ...
  order      Order      @relation(fields: [orderId], references: [id])
  labResult  LabResult? @relation(fields: [labResultId], references: [id])
}

// LabSendOut
model LabSendOut {
  order        Order        @relation(fields: [orderId], references: [id])
}

// CellTherapyBatch
model CellTherapyBatch {
  patient      Patient      @relation(fields: [patientId], references: [id])
  order        Order?       @relation(fields: [orderId], references: [id])
}

// GenomicTest
model GenomicTest {
  patient      Patient      @relation(fields: [patientId], references: [id])
  order        Order?       @relation(fields: [orderId], references: [id])
  referenceLab ReferenceLab? @relation("GenomicSendOut", fields: [referenceLabId], references: [id])
}

// CellQcTest
model CellQcTest {
  tester       User         @relation("CellQcTester", fields: [testedBy], references: [id])
}

// LabQcRecord
model LabQcRecord {
  performer    User         @relation("QcPerformer", fields: [performedBy], references: [id])
}
```

**기존 모델 역참조 추가:**
```prisma
// LabResult에 추가
model LabResult {
  // 기존 필드 유지
  attachments    LabResultAttachment[]
  worksheetItems LabWorksheetItem[]
}

// Order에 추가
model Order {
  // 기존 필드 유지
  worksheetItems   LabWorksheetItem[]
  sendOut          LabSendOut?
  cellTherapyBatch CellTherapyBatch?
  genomicTest      GenomicTest?
}

// Patient에 추가
model Patient {
  // 기존 필드 유지
  cellTherapyBatches CellTherapyBatch[]
  genomicTests       GenomicTest[]
}

// LabInstrument에 추가
model LabInstrument {
  worksheets     LabWorksheet[]
}
```

### LabResultStatus Enum 확장

```prisma
enum LabResultStatus {
  PENDING        // 의뢰 접수
  COLLECTED      // 검체 채취
  IN_PROGRESS    // 검사 진행
  COMPLETED      // 결과 입력 완료
  VERIFIED       // 검사기사 검증 (신규)
  SIGNED         // 전문의 서명 (신규)
  REJECTED       // 결과 거부/재검사 (신규)
  CANCELLED      // 취소 (신규)
}
```

### 에러 처리

| 에러 코드 | HTTP | 상황 |
|-----------|------|------|
| `LAB_ORDER_NOT_FOUND` | 404 | 존재하지 않는 오더 ID |
| `LAB_ALREADY_COLLECTED` | 409 | 이미 검체 접수된 오더 |
| `LAB_RESULT_EXISTS` | 409 | 이미 결과가 입력된 오더 |
| `LAB_INSTRUMENT_OFFLINE` | 503 | 장비 미연결 상태 |
| `LAB_BARCODE_NOT_MATCHED` | 404 | 바코드에 매칭되는 오더 없음 |
| `LAB_QC_FAILED` | 422 | QC 판정 실패 (Westgard 위반) |
| `LAB_FILE_PARSE_ERROR` | 422 | 업로드 파일 파싱 실패 |
| `LAB_BATCH_RELEASED` | 409 | 이미 출하 승인된 배치 |
| `LAB_CONSENT_REQUIRED` | 403 | 유전자검사 동의서 미취득 |
| `LAB_WORKSHEET_SIGNED` | 409 | 이미 서명 완료된 기록지 |

### 규정 준수

#### 1. 진단검사의학 (KSLM)
- **정도관리**: 대한진단검사의학회 QC 기준, 외부정도관리(EQA) 참여 기록
- **검사실 인증**: 대한진단검사의학회 우수검사실 인증 기준
- **결과 보고**: 검사 결과 보고 시한 기준 (STAT: 1시간, Routine: 당일)
- **Delta Check**: 전후 결과 비교 기준 (검사항목별 임계값)

#### 2. 세포치료 (식약처)
- **근거 법률**: 첨단재생의료 및 첨단바이오의약품 안전 및 지원에 관한 법률 (첨단재생바이오법)
- **필수 기록**: 배치기록서, 멸균시험성적서, 세포계수기록, 환경모니터링기록
- **GMP**: 의약품 제조 및 품질관리 기준 (식약처 고시)
- **추적**: 세포치료제 추적관리 시스템 (제조→유통→투여→경과관찰)

#### 3. 유전자검사 (식약처/복지부)
- **근거 법률**: 생명윤리 및 안전에 관한 법률 제50조 (유전자검사)
- **동의서**: 유전자검사 서면동의 법적 필수 (제51조) → ConsentForm 모듈 연동
- **결과 통보**: 유전자검사 결과 통보 시 유전상담 의무 (제52조)
- **기록 보관**: 유전자검사 기록 10년 보관 의무 (제52조의2)
- **검사기관 인증**: 질병관리청 유전자검사기관 평가 기준

### 바코드 체계

| 항목 | 규격 |
|------|------|
| 포맷 | Code 128 (1D) + QR Code (2D) |
| 생성 규칙 | `S{YYYYMMDD}-{SEQ:3자리}` (예: S20260519-001) |
| 내용 | 검체 ID, 환자 MRN, 검사코드, 채취일시 |
| 라벨 | 30×15mm 열전사 라벨, 검체용기 부착 |
| 중복 방지 | DB unique constraint + Redis 캐시 |

```
POST /api/v1/lab/barcode/generate
Body: { "orderId": "uuid", "patientId": "uuid", "testCodes": ["L0401", "L0501"] }
Response: { "data": { "barcodes": [{ "barcode": "S20260519-001", "qrData": "...", "labelUrl": "/api/v1/lab/barcode/S20260519-001/label" }] } }

POST /api/v1/lab/barcode/scan
Body: { "barcode": "S20260519-001" }
Response: { "data": { "orderId": "uuid", "patient": {...}, "tests": [...], "worksheetId": "uuid" } }

GET /api/v1/lab/barcode/:barcode/label
Response: image/png (30×15mm 라벨 이미지)
```

### Cross-Module 연동

| 연동 | 방식 | 이벤트 |
|------|------|--------|
| **Journey** | 이벤트 발행 | LAB_SAMPLE_COLLECTED, LAB_RESULT_REPORTED, LAB_QC_COMPLETED |
| **ConsentForm** | 동의서 확인 | 유전자검사 의뢰 전 동의서 취득 여부 확인 |
| **Pharmacy** | 약물유전체 알림 | Pharmacogenomics 결과 → 처방 시 DUR 경고 연동 |
| **AI** | 결과 해석 | interpret-lab 확장, 유전체 변이 해석, 세포 이상 감지 |
| **Notification** | 패닉값 알림 | WebSocket + 알림 벨 (TopBar) → 담당의 즉시 통보 |

### Phase 의존성

```
Phase 1 (파일 수신 + PDF 첨부)
    ↓
Phase 2 (검사기록지 + 바코드) ← Phase 1 파일 수신 활용
    ↓
Phase 3 (위탁검사) ← Phase 1 PDF 수신, Phase 2 바코드
    ↓
Phase 4 (세포치료) ← Phase 1 파일 첨부, Phase 2 바코드
Phase 5 (유전체) ← Phase 3 위탁 연동, Phase 1 PDF
    ↓
Phase 6 (QC) ← Phase 1 장비 등록, Phase 2 기록지
```
