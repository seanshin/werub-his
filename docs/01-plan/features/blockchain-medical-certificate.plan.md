# 블록체인 기반 의료인 인증서 발급·서명·문서관리 시스템

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/prisma/schema.prisma:10330 model BlockchainCertificate · apps/api/prisma/schema.prisma:10377 model SignedDocument · apps/api/prisma/schema.prisma:10490 model BlockchainAnchor · 잔여: 없음

> **Feature**: blockchain-medical-certificate
> **Project**: Hospital RUN
> **Version**: 1.0
> **Author**: PM
> **Date**: 2026-05-20
> **Status**: Draft

---

## 1. 개요

### 1.1 배경

현재 Hospital RUN의 의료 문서(진단서, 소견서, 동의서, 처방전 등)는 단순 DB 저장 + PDF 출력 방식으로 관리된다. 의료인의 서명은 `signedBy` 텍스트 필드에 이름만 기록되며, **위변조 검증·부인 방지·이력 추적**이 불가능하다.

의료법 제17조(진단서 등의 교부)와 전자문서법에 따라, 의료 문서의 **법적 효력을 보장**하려면 공인전자서명 또는 이에 준하는 전자서명 체계가 필요하다.

### 1.2 목적

1. **블록체인 기반 의료인 인증서(PKI)** 발급·관리 체계 구축
2. **전자서명**: 의료인 개인키로 문서에 서명 → 블록체인에 해시 기록
3. **문서 무결성**: 서명된 문서의 위변조 감지·검증
4. **이력 관리**: 서명 이력·인증서 갱신·폐기 전체 라이프사이클 추적
5. **규정 준수**: 의료법, 전자문서법, 개인정보보호법 기반 설계

### 1.3 핵심 용어

| 용어 | 정의 |
|------|------|
| **의료인 인증서** | 의사/간호사/약사 등 의료인의 신원을 증명하는 전자인증서 (X.509 기반) |
| **개인키 (Private Key)** | 의료인 본인만 소유하는 서명용 키 (로컬 보관, 절대 서버 전송 안 함) |
| **공개키 (Public Key)** | 서명 검증용 키 (블록체인에 등록) |
| **문서 해시** | 서명 대상 문서의 SHA-256 해시값 |
| **블록체인 앵커링** | 문서 해시를 블록체인 트랜잭션에 기록하여 타임스탬프 부인 방지 |
| **서명 봉투 (Signature Envelope)** | 원본 문서 + 서명값 + 인증서 + 타임스탬프를 묶은 패키지 |

> **용어 혼동 주의**: 기존 `Certificate` 모델은 **의료 문서**(진단서/소견서)를 의미하고,
> 본 기획의 `BlockchainCertificate`는 **전자서명 인증서**(PKI)를 의미한다.
> 코드/문서에서 반드시 구분하여 사용할 것.
> - 의료 문서 인증서: `Certificate` (진단서, 소견서, 입퇴원확인서)
> - 전자서명 인증서: `BlockchainCertificate` (공개키 기반 PKI 인증서)

---

## 2. 시스템 아키텍처

### 2.1 전체 구조

```
┌─────────────────────────────────────────────────────────────────┐
│                    Hospital RUN Web (Next.js)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ 인증서 관리   │  │ 문서 서명     │  │ 서명 검증/이력 조회  │  │
│  │ - 발급 신청   │  │ - 문서 선택   │  │ - 해시 검증         │  │
│  │ - 갱신/폐기   │  │ - PIN 입력    │  │ - 블록체인 조회     │  │
│  │ - 키 백업     │  │ - 서명 실행   │  │ - 서명 이력         │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                  │                      │              │
│  ┌──────┴──────────────────┴──────────────────────┴───────────┐ │
│  │           Web Crypto API (브라우저 내 키 관리)              │ │
│  │  - KeyPair 생성 (RSA-2048 또는 ECDSA P-256)                │ │
│  │  - 개인키: IndexedDB 암호화 저장 (AES-256-GCM + PIN)       │ │
│  │  - 서명: SubtleCrypto.sign()                               │ │
│  └────────────────────────────┬────────────────────────────────┘ │
└───────────────────────────────┼──────────────────────────────────┘
                                │ HTTPS
┌───────────────────────────────┼──────────────────────────────────┐
│                    Hospital RUN API (NestJS)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Certificate   │  │ Signature    │  │ Blockchain           │   │
│  │ Module        │  │ Module       │  │ Anchor Module        │   │
│  │               │  │              │  │                      │   │
│  │ - 인증서 CRUD │  │ - 서명 검증  │  │ - 해시 앵커링        │   │
│  │ - CSR 처리    │  │ - 문서 봉투  │  │ - 트랜잭션 조회      │   │
│  │ - CRL 관리    │  │ - 이력 기록  │  │ - 체인 선택          │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                  │                      │               │
│  ┌──────┴──────────────────┴──────────────────────┴────────────┐ │
│  │                     PostgreSQL                               │ │
│  │  medical_certificates / signed_documents / signature_logs    │ │
│  └──────────────────────────┬───────────────────────────────────┘ │
└─────────────────────────────┼────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │   Blockchain       │
                    │  (Hyperledger /    │
                    │   Polygon PoS /    │
                    │   Private Chain)   │
                    └───────────────────┘
```

### 2.2 키 관리 원칙

```
┌─ 개인키 생명주기 ─────────────────────────────────────────────────┐
│                                                                   │
│  [생성] → [암호화 저장] → [사용(서명)] → [갱신] → [폐기]         │
│     │         │              │              │          │          │
│   브라우저   IndexedDB     PIN 입력       새 키쌍     CRL 등록    │
│   Web Crypto  AES-256     SubtleCrypto   이전키폐기  블록체인기록 │
│                            .sign()                                │
│                                                                   │
│  ⚠ 개인키는 절대 서버로 전송하지 않음 (Zero-Knowledge)            │
│  ⚠ 서버는 공개키만 보유 → 서명 검증만 가능                       │
└───────────────────────────────────────────────────────────────────┘
```

### 2.3 블록체인 선택 기준

| 옵션 | 장점 | 단점 | 적합성 |
|------|------|------|:------:|
| **Hyperledger Fabric** | 프라이빗, 의료 규정 친화적, 허가형 | 운영 복잡, 노드 필요 | ⭐⭐⭐ |
| **Polygon PoS** | 저렴, 퍼블릭 검증, 이더리움 호환 | 데이터 공개, 가스비 | ⭐⭐ |
| **자체 Private Chain** | 완전 통제, 규정 최적화 | 개발 비용, 신뢰성 낮음 | ⭐ |
| **Merkle Tree + TimestampServer** | 블록체인 없이 유사 효과, 저비용 | 자체 서버 의존 | ⭐⭐ |

**권장**: Phase 1은 **Merkle Tree + 자체 앵커링** (블록체인 의존 없이), Phase 2에서 Hyperledger 또는 Polygon 연동.

---

## 3. 데이터 모델

### 3.1 Prisma 스키마

```prisma
// ── 전자인증서 (의료인 + 환자 통합) ──

model BlockchainCertificate {
  id              String   @id @default(uuid()) @db.Uuid
  // 소유자 — 의료인(User) 또는 환자(Patient) 중 하나
  ownerType       String   @map("owner_type") @db.VarChar(10)           // STAFF, PATIENT
  userId          String?  @map("user_id") @db.Uuid                     // 의료인일 때
  patientId       String?  @map("patient_id") @db.Uuid                  // 환자일 때
  // 인증서 정보
  serialNumber    String   @unique @map("serial_number") @db.VarChar(64)
  subjectDn       String   @map("subject_dn") @db.VarChar(500)
  // 의료인: CN=김내과,O=Hospital RUN,OU=내과,L=Seoul,C=KR
  // 환자:   CN=김영수,O=Hospital RUN,OU=Patient,L=Seoul,C=KR
  publicKey       String   @map("public_key") @db.Text
  algorithm       String   @db.VarChar(30)                                // ECDSA-P256, RSA-2048
  // 유효기간
  issuedAt        DateTime @map("issued_at") @db.Timestamptz()
  expiresAt       DateTime @map("expires_at") @db.Timestamptz()
  // 상태
  status          String   @default("ACTIVE") @db.VarChar(20)            // PENDING, ACTIVE, SUSPENDED, REVOKED, EXPIRED
  revokedAt       DateTime? @map("revoked_at") @db.Timestamptz()
  revokeReason    String?  @map("revoke_reason") @db.VarChar(200)
  // 의료인 전용 필드 (ownerType=STAFF)
  licenseNumber   String?  @map("license_number") @db.VarChar(50)       // 의사면허번호
  licenseType     String?  @map("license_type") @db.VarChar(30)         // DOCTOR, NURSE, PHARMACIST, DENTIST, LAB_TECH
  department      String?  @db.VarChar(100)
  specialty       String?  @db.VarChar(100)
  // 환자 전용 필드 (ownerType=PATIENT)
  patientMrn      String?  @map("patient_mrn") @db.VarChar(50)          // 환자 MRN (인증서에 포함)
  identityVerified Boolean? @map("identity_verified")                    // 본인인증 완료 여부 (NICE CI)
  // 블록체인 앵커링
  certHash        String   @map("cert_hash") @db.VarChar(64)
  blockchainTxId  String?  @map("blockchain_tx_id") @db.VarChar(128)
  blockchainAnchoredAt DateTime? @map("blockchain_anchored_at") @db.Timestamptz()
  // 갱신 체인
  previousCertId  String?  @map("previous_cert_id") @db.Uuid
  // 메타
  fingerprint     String   @db.VarChar(64)
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz()

  user            User?    @relation("UserBlockchainCerts", fields: [userId], references: [id])
  patient         Patient? @relation("PatientBlockchainCerts", fields: [patientId], references: [id])
  previousCert    BlockchainCertificate?  @relation("CertRenewalChain", fields: [previousCertId], references: [id])
  renewedBy       BlockchainCertificate[] @relation("CertRenewalChain")
  signatures      DocumentSignature[]

  @@index([ownerType, userId])
  @@index([ownerType, patientId])
  @@index([serialNumber])
  @@index([fingerprint])
  @@map("blockchain_certificates")
}

// ── 서명된 문서 ──

model SignedDocument {
  id              String   @id @default(uuid()) @db.Uuid
  // 원본 문서 참조
  documentType    String   @map("document_type") @db.VarChar(50)
  // CERTIFICATE(진단서/소견서), CONSENT(동의서), PRESCRIPTION(처방전),
  // DISCHARGE_SUMMARY(퇴원요약), OP_NOTE(수술기록), ORDER(처방오더),
  // LAB_REPORT(검사결과), IMAGING_REPORT(판독문)
  documentId      String   @map("document_id") @db.Uuid                  // 원본 문서 ID (Certificate.id, ConsentForm.id 등)
  patientId       String?  @map("patient_id") @db.Uuid                   // 관련 환자
  // 문서 해시
  documentHash    String   @map("document_hash") @db.VarChar(64)         // SHA-256 of document content
  documentVersion Int      @default(1) @map("document_version")
  // 서명 상태
  status          String   @default("PENDING") @db.VarChar(20)           // PENDING, SIGNED, MULTI_SIGN_PENDING, COMPLETED, VOIDED
  requiredSigners Int      @default(1) @map("required_signers")          // 필요 서명 수
  completedSigners Int     @default(0) @map("completed_signers")         // 완료 서명 수
  // 블록체인 앵커링
  merkleRoot      String?  @map("merkle_root") @db.VarChar(64)
  blockchainTxId  String?  @map("blockchain_tx_id") @db.VarChar(128)
  blockchainAnchoredAt DateTime? @map("blockchain_anchored_at") @db.Timestamptz()
  // 봉투 (원본+서명+인증서 패키지)
  envelopeUrl     String?  @map("envelope_url") @db.VarChar(500)         // 서명 봉투 파일 URL
  // 메타
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  patient         Patient? @relation(fields: [patientId], references: [id])
  signatures      DocumentSignature[]

  @@index([documentType, documentId])
  @@index([patientId])
  @@index([status])
  @@map("signed_documents")
}

// ── 개별 서명 기록 ──

model DocumentSignature {
  id              String   @id @default(uuid()) @db.Uuid
  signedDocumentId String  @map("signed_document_id") @db.Uuid
  certificateId   String   @map("certificate_id") @db.Uuid
  // 서명 데이터
  signatureValue  String   @map("signature_value") @db.Text             // Base64 encoded signature
  signatureAlgorithm String @map("signature_algorithm") @db.VarChar(30) // SHA256withRSA, SHA256withECDSA
  // 서명 시점
  signedAt        DateTime @map("signed_at") @db.Timestamptz()
  // 서명 역할
  signerRole      String   @map("signer_role") @db.VarChar(30)
  // 의료인: PRIMARY(주 서명), WITNESS(확인자), CO_SIGN(공동서명), COUNTER_SIGN(대서명), APPROVAL(승인)
  // 환자:   CONSENT(동의), RECEIPT(수령확인), CONFIRM(퇴원확인)
  // 보호자: GUARDIAN(법정대리인/보호자 확인)
  // 시스템: SYSTEM_ANCHOR(블록체인 자동 타임스탬프)
  // 서명 컨텍스트
  ipAddress       String?  @map("ip_address") @db.VarChar(45)
  userAgent       String?  @map("user_agent") @db.VarChar(500)
  // 검증
  isValid         Boolean  @default(true) @map("is_valid")
  verifiedAt      DateTime? @map("verified_at") @db.Timestamptz()

  signedDocument  SignedDocument      @relation(fields: [signedDocumentId], references: [id])
  certificate     BlockchainCertificate @relation(fields: [certificateId], references: [id])
  // 서명자 — 의료인 또는 환자
  signerType      String   @map("signer_type") @db.VarChar(10)          // STAFF, PATIENT
  signerUserId    String?  @map("signer_user_id") @db.Uuid              // 의료인
  signerPatientId String?  @map("signer_patient_id") @db.Uuid           // 환자
  signerUser      User?    @relation("UserDocSignatures", fields: [signerUserId], references: [id])
  signerPatient   Patient? @relation("PatientDocSignatures", fields: [signerPatientId], references: [id])

  @@index([signedDocumentId])
  @@index([signerUserId, signedAt])
  @@index([signerPatientId, signedAt])
  @@map("document_signatures")
}

// ── 블록체인 앵커 기록 ──

model BlockchainAnchor {
  id              String   @id @default(uuid()) @db.Uuid
  // 앵커 대상
  anchorType      String   @map("anchor_type") @db.VarChar(30)          // CERTIFICATE, DOCUMENT, REVOCATION, BATCH
  referenceId     String   @map("reference_id") @db.Uuid                // 대상 레코드 ID
  // 해시
  dataHash        String   @map("data_hash") @db.VarChar(64)
  merkleRoot      String?  @map("merkle_root") @db.VarChar(64)          // 배치 앵커링 시
  merkleProof     Json?    @map("merkle_proof") @db.JsonB                // 머클 증명 경로
  // 블록체인 트랜잭션
  chainType       String   @map("chain_type") @db.VarChar(30)           // INTERNAL_MERKLE, HYPERLEDGER, POLYGON, ETHEREUM
  txHash          String?  @map("tx_hash") @db.VarChar(128)
  blockNumber     Int?     @map("block_number")
  confirmations   Int?     @default(0)
  // 상태
  status          String   @default("PENDING") @db.VarChar(20)          // PENDING, CONFIRMED, FAILED
  anchoredAt      DateTime? @map("anchored_at") @db.Timestamptz()
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz()

  @@index([anchorType, referenceId])
  @@index([txHash])
  @@map("blockchain_anchors")
}

// ── 인증서 이벤트 로그 (감사 추적) ──

model CertificateAuditLog {
  id              String   @id @default(uuid()) @db.Uuid
  certificateId   String?  @map("certificate_id") @db.Uuid
  // 행위자 — 의료인 또는 환자
  actorType       String   @map("actor_type") @db.VarChar(10)             // STAFF, PATIENT, SYSTEM
  userId          String?  @map("user_id") @db.Uuid                       // 의료인일 때
  patientId       String?  @map("patient_id") @db.Uuid                    // 환자일 때
  // 이벤트
  eventType       String   @map("event_type") @db.VarChar(30)
  // ISSUED, RENEWED, SUSPENDED, REVOKED, RESTORED, KEY_BACKUP, KEY_RESTORE,
  // SIGN_SUCCESS, SIGN_FAILED, VERIFY_SUCCESS, VERIFY_FAILED,
  // PIN_FAILED, PIN_LOCKED, CERT_APPROVED, CERT_REJECTED
  eventDetail     Json?    @map("event_detail") @db.JsonB
  ipAddress       String?  @map("ip_address") @db.VarChar(45)
  // PIN 실패 추적 (서버 측)
  pinFailCount    Int?     @map("pin_fail_count")
  // 타임스탬프
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz()

  @@index([certificateId, createdAt])
  @@index([userId, eventType])
  @@index([patientId, eventType])
  @@map("certificate_audit_logs")
}
```

### 3.2 기존 모델 확장 (역관계 필드 추가)

```prisma
// ── User 모델에 추가할 필드 ──
model User {
  // ... 기존 필드 유지 ...
  blockchainCerts    BlockchainCertificate[] @relation("UserBlockchainCerts")
  docSignatures      DocumentSignature[]     @relation("UserDocSignatures")
}

// ── Patient 모델에 추가할 필드 ──
model Patient {
  // ... 기존 필드 유지 ...
  blockchainCerts    BlockchainCertificate[] @relation("PatientBlockchainCerts")
  signedDocuments    SignedDocument[]
  docSignatures      DocumentSignature[]     @relation("PatientDocSignatures")
}
```

### 3.3 관계 다이어그램

```
                    ┌──── User (의료인)
                    │       │
                    │       ├── (*) BlockchainCertificate (ownerType=STAFF)
                    │       └── (*) DocumentSignature (signerType=STAFF)
                    │
BlockchainCertificate ──── (*) DocumentSignature
  (갱신 체인)               │
  previousCert ←────────── │
                    │
                    │       ┌── (*) BlockchainCertificate (ownerType=PATIENT)
                    │       ├── (*) DocumentSignature (signerType=PATIENT)
                    └──── Patient (환자)
                            └── (*) SignedDocument

BlockchainAnchor ──── referenceId(다형성) → Certificate / Document / Revocation
CertificateAuditLog ──── actorType(STAFF/PATIENT/SYSTEM) → 전체 이벤트 감사
```

---

## 4. 핵심 워크플로우

### 4.1 인증서 발급 흐름

```
의료인 ──→ [인증서 발급 신청]
              │
              ▼
       브라우저 Web Crypto API
         ├── RSA-2048 또는 ECDSA P-256 KeyPair 생성
         ├── 개인키 → PIN(6자리)으로 AES-256-GCM 암호화 → IndexedDB 저장
         └── 공개키 + CSR(Certificate Signing Request) → API 전송
              │
              ▼
       API: Certificate Module
         ├── 의료인 정보 검증 (면허번호, 소속 확인)
         ├── 인증서 생성 (X.509 구조)
         │    Subject: CN=김내과, O=Hospital RUN, OU=내과, L=Seoul, C=KR
         │    Serial: 랜덤 64-bit
         │    Validity: 2년
         ├── 인증서 해시 → BlockchainAnchor 기록
         └── CertificateAuditLog: ISSUED
              │
              ▼
       [인증서 발급 완료]
         ├── 인증서 ID: cert-xxxxx
         ├── 유효기간: 2026-05-20 ~ 2028-05-19
         ├── 지문: 3A:B7:C2:...
         └── 블록체인 Tx: 0x...
```

### 4.2 문서 서명 흐름

```
의료인 ──→ [문서 작성 완료] (진단서, 처방전, 수술기록 등)
              │
              ▼
       [서명하기] 클릭
         ├── 문서 콘텐츠 → SHA-256 해시 생성
         ├── PIN 입력 모달
         ├── IndexedDB에서 개인키 복호화 (AES-256-GCM + PIN)
         ├── Web Crypto SubtleCrypto.sign(privateKey, hash)
         └── 서명값(Base64) + 인증서ID + 문서해시 → API 전송
              │
              ▼
       API: Signature Module
         ├── 인증서 유효성 확인 (ACTIVE + 미만료)
         ├── 공개키로 서명 검증 (SubtleCrypto.verify)
         ├── SignedDocument 생성/업데이트
         ├── DocumentSignature 기록
         ├── 문서 해시 → BlockchainAnchor (배치 또는 즉시)
         ├── CertificateAuditLog: SIGN_SUCCESS
         └── 서명 봉투(Envelope) 생성
              │
              ▼
       [서명 완료]
         ├── 서명 ID: sig-xxxxx
         ├── 서명 시각: 2026-05-20 11:30:45 KST
         ├── 문서 해시: SHA256:a3b7c2...
         ├── 블록체인 앵커: pending → confirmed
         └── PDF에 서명 마크 삽입 (🔒 전자서명 됨)
```

### 4.3 서명 검증 흐름

```
검증자 ──→ [서명 검증] (누구나 가능)
              │
              ▼
       검증 입력
         ├── 문서 ID 또는 문서 파일 업로드
         └── → API: 검증 요청
              │
              ▼
       API: Verification
         ├── 1. 문서 해시 재계산 → 저장된 해시와 비교 (무결성)
         ├── 2. 공개키로 서명값 검증 (진본성)
         ├── 3. 인증서 유효기간 확인 (서명 시점 기준)
         ├── 4. CRL(인증서 폐기 목록) 확인
         ├── 5. 블록체인 앵커 확인 (타임스탬프 부인 방지)
         └── 6. 검증 결과 반환
              │
              ▼
       [검증 결과]
         ├── ✅ 문서 무결성: 원본과 일치
         ├── ✅ 서명 유효: 김내과 의사 (면허 MD-2018-12345)
         ├── ✅ 서명 시점: 2026-05-20 11:30:45 KST
         ├── ✅ 인증서 상태: ACTIVE (만료: 2028-05-19)
         └── ✅ 블록체인 확인: Block #12345, Tx 0x...
```

### 4.4 다중 서명 (Multi-Sign)

```
수술 동의서 서명 예시:

  [수술 동의서 작성]
        │
        ▼
  필요 서명자 3명 설정:
    1. 집도의 (PRIMARY) — 필수
    2. 환자/보호자 (CONSENT) — 필수
    3. 보호자 (GUARDIAN) — 환자 대리 또는 확인
        │
        ├── 집도의 서명 (블록체인 키)    → completedSigners: 1/3
        ├── 환자 서명 (터치/패드)        → completedSigners: 2/3
        └── 보호자 서명 (터치 또는 블록체인) → completedSigners: 3/3
                                          → 시스템: 블록체인 자동 타임스탬프
                                          → status: COMPLETED
                                          → 블록체인 최종 앵커링
```

### 4.5 다중 서명 타임아웃 정책

| 정책 | 값 | 설명 |
|------|-----|------|
| 기본 타임아웃 | 72시간 | 마지막 서명 후 72시간 내 다음 서명 필요 |
| 수술 동의서 | 24시간 | 수술 전까지 완료 필수 |
| 리마인더 | 12시간/6시간/1시간 | 미서명자에게 포털/앱 알림 |
| 만료 처리 | VOIDED | 타임아웃 시 문서 무효화, 재작성 필요 |
| 관리자 연장 | 가능 | ADMIN이 타임아웃 연장 (최대 7일) |

### 4.6 PIN 실패 추적 (서버 하이브리드)

```
PIN 입력 시:
  1. 클라이언트: IndexedDB에서 개인키 복호화 시도
  2. 실패 시:
     ├── 클라이언트: 로컬 실패 카운트 증가 (UX 즉시 반영)
     └── 서버: POST /api/v1/blockchain-cert/pin-fail
              → CertificateAuditLog(PIN_FAILED) 기록
              → 서버 측 pinFailCount 증가
              → 5회 도달 시: 10분 잠금 (서버 타임스탬프 기준)
              → 10회 도달 시: 인증서 자동 SUSPENDED + 관리자 알림
  3. 성공 시:
     └── 서버: POST /api/v1/blockchain-cert/pin-success
              → pinFailCount 리셋

효과: 공격자가 여러 브라우저에서 시도해도 서버 합산으로 잠금
```

---

## 5. API 엔드포인트

### 5.1 인증서 관리 (`/api/v1/blockchain-cert`)

| # | Method | Endpoint | 설명 | 권한 |
|---|--------|----------|------|------|
| 1 | POST | `/issue` | 인증서 발급 (공개키+CSR 수신) | 본인 |
| 2 | GET | `/my` | 내 인증서 목록 | 본인 |
| 3 | GET | `/:id` | 인증서 상세 | 본인/ADMIN |
| 4 | POST | `/:id/renew` | 인증서 갱신 (새 키쌍) | 본인 |
| 5 | POST | `/:id/suspend` | 인증서 일시정지 | 본인/ADMIN |
| 6 | POST | `/:id/revoke` | 인증서 폐기 | 본인/ADMIN |
| 7 | POST | `/:id/restore` | 인증서 복원 (일시정지 해제) | ADMIN |
| 8 | GET | `/crl` | 인증서 폐기 목록 (CRL) | 공개 |
| 9 | GET | `/verify/:fingerprint` | 인증서 유효성 확인 | 공개 |
| 10 | GET | `/audit-log` | 인증서 감사 로그 | ADMIN |

### 5.2 문서 서명 (`/api/v1/document-sign`)

| # | Method | Endpoint | 설명 | 권한 |
|---|--------|----------|------|------|
| 1 | POST | `/sign` | 문서 서명 (서명값+인증서ID+해시) | 서명자 |
| 2 | POST | `/verify` | 서명 검증 | 공개 |
| 3 | GET | `/document/:documentType/:documentId` | 서명된 문서 조회 | 관련자 |
| 4 | GET | `/history/:userId` | 서명 이력 조회 | 본인/ADMIN |
| 5 | POST | `/multi-sign/init` | 다중 서명 초기화 | 문서 작성자 |
| 6 | GET | `/multi-sign/:id/status` | 다중 서명 진행 현황 | 서명자 |
| 7 | GET | `/envelope/:signedDocumentId` | 서명 봉투 다운로드 | 관련자 |
| 8 | POST | `/batch-anchor` | 배치 블록체인 앵커링 (Cron) | SYSTEM |

### 5.3 환자 전용 (`/api/v1/patient-portal/certificate`)

> 환자 포털 인증(PatientAccount JWT) 기반. HIS User JWT와 분리.

| # | Method | Endpoint | 설명 | 인증 |
|---|--------|----------|------|------|
| 1 | POST | `/issue` | 환자 인증서 발급 (본인인증 CI 기반, 자동 승인) | PatientAccount |
| 2 | GET | `/my` | 내 인증서 조회 | PatientAccount |
| 3 | POST | `/sign` | 환자 서명 (동의서/수령확인) | PatientAccount |
| 4 | GET | `/signed-docs` | 내가 서명한 문서 목록 | PatientAccount |
| 5 | GET | `/issued-docs` | 나에게 발급된 문서 목록 (의료인 서명 포함) | PatientAccount |
| 6 | POST | `/:id/suspend` | 인증서 일시정지 | PatientAccount |
| 7 | POST | `/key-backup` | 키 백업 메타 기록 (파일은 클라이언트 저장) | PatientAccount |
| 8 | GET | `/envelope/:signedDocumentId` | 서명 봉투 다운로드 | PatientAccount |

### 5.4 블록체인 앵커 (`/api/v1/blockchain-anchor`)

| # | Method | Endpoint | 설명 | 권한 |
|---|--------|----------|------|------|
| 1 | GET | `/:txHash` | 트랜잭션 조회 | 공개 |
| 2 | GET | `/verify/:dataHash` | 해시 앵커 검증 | 공개 |
| 3 | GET | `/stats` | 앵커링 통계 | ADMIN |
| 4 | POST | `/qr-code/:signedDocumentId` | 검증 QR 코드 생성 | 서명자/ADMIN |

---

## 6. 역할별 UI 설계

> 본 시스템은 **세 가지 완전히 다른 사용자 경험**으로 나뉜다.
> - **의료인 (개인)**: 자신의 키 생성·관리·서명 — 개인 설정 영역
> - **환자**: 포털에서 키 생성·동의서 서명·발급문서 열람 — 환자 포털
> - **관리자 (ADMIN)**: 전체 인증서 현황·정책·폐기 — 관리 대시보드

### 6.0 역할별 접근 권한 매트릭스

| 기능 | 의료인 (본인) | 환자 (본인) | ADMIN | 비고 |
|------|:---:|:---:|:---:|------|
| 개인키 생성 | ✅ | ✅ | ❌ | 브라우저에서만 생성, 서버 전송 없음 |
| PIN 설정/변경 | ✅ | ✅ | ❌ | 본인만 알 수 있음 |
| 인증서 발급 신청 | ✅ | ✅ | ❌ | 의료인: 면허 기반 / 환자: 본인인증(NICE CI) 기반 |
| 인증서 발급 승인 | ❌ | ❌ | ✅ (의료인만) | 환자는 본인인증 완료 시 자동 발급 |
| 내 인증서 조회 | ✅ `/settings` | ✅ `/portal` | ❌ | 각자 영역에서 |
| 전체 인증서 목록 | ❌ | ❌ | ✅ | 관리자 전용 |
| 키 백업/복원 | ✅ | ✅ | ❌ | 암호화 파일 본인 관리 |
| 문서 서명 | ✅ | ✅ (동의서/수령확인) | ❌ | PIN 입력 필수 |
| 내 서명 이력 | ✅ | ✅ | ❌ | 본인 서명만 |
| 전체 서명 이력 | ❌ | ❌ | ✅ | 감사 목적 |
| 서명된 문서 열람 | ✅ (담당 문서) | ✅ (내 문서) | ✅ | 환자: 포털에서 발급 문서 열람 |
| 서명 봉투 다운로드 | ✅ | ✅ | ✅ | 법적 증빙용 |
| 인증서 일시정지 | ✅ (본인) | ✅ (본인) | ✅ (타인) | 긴급 시 |
| 인증서 폐기 | ✅ (본인) | ✅ (본인) | ✅ (타인) | 비가역 |
| 인증서 복원 | ❌ | ❌ | ✅ | 관리자만 가능 |
| CRL 관리 | ❌ | ❌ | ✅ | 폐기 목록 |
| 블록체인 앵커 현황 | ❌ | ❌ | ✅ | 시스템 모니터링 |
| 정책 설정 | ❌ | ❌ | ✅ | 유효기간, 알고리즘, 자동폐기 |
| 서명 검증 | ✅ | ✅ | ✅ | 누구나 공개 검증 가능 |

### 6.0.1 환자 인증서 vs 의료인 인증서 차이

| 항목 | 의료인 인증서 | 환자 인증서 |
|------|:---:|:---:|
| 발급 근거 | 면허번호 (의사/간호사/약사) | 본인인증 CI (NICE/PASS) |
| 발급 승인 | 관리자 수동 승인 필요 | 본인인증 완료 시 **자동 발급** |
| SubjectDN | `CN=김내과,OU=내과,O=Hospital RUN` | `CN=김영수,OU=Patient,O=Hospital RUN` |
| 서명 대상 | 진단서, 처방전, 수술기록, 판독문 등 | 동의서(환자서명), 진료기록 수령확인, 퇴원확인서 |
| 유효기간 | 2년 (기본) | 1년 (기본, 재인증 필요) |
| 키 저장 | HIS 웹 브라우저 IndexedDB | 환자포털 웹 브라우저 IndexedDB |
| signerRole | PRIMARY, WITNESS, CO_SIGN, APPROVAL | CONSENT, RECEIPT, CONFIRM |

---

### 6.1 의료인 — 개인키 생성 & 인증서 발급 (`/settings/my-certificate`)

> 사이드바 「설정 > 내 인증서」 또는 최초 로그인 시 온보딩으로 유도

#### Step 1: 개인키 생성 (브라우저 내, 서버 전송 없음)

```
┌─ 전자 인증서 설정 ─────────────────────────────────────────────────┐
│                                                                     │
│  현재 상태: ⚠ 인증서 없음                                          │
│                                                                     │
│  ┌─ Step 1/3: 개인키 생성 ──────────────────────────────────────┐  │
│  │                                                              │  │
│  │  🔐 개인키는 이 브라우저에서만 생성되며,                     │  │
│  │     서버로 절대 전송되지 않습니다.                            │  │
│  │                                                              │  │
│  │  알고리즘 선택:                                              │  │
│  │  ● ECDSA P-256 (권장, 빠른 서명)                            │  │
│  │  ○ RSA-2048 (호환성 우선)                                   │  │
│  │                                                              │  │
│  │  ┌─ 보안 안내 ────────────────────────────────────────────┐ │  │
│  │  │ • 개인키는 이 기기의 브라우저에만 저장됩니다            │ │  │
│  │  │ • 브라우저 초기화/삭제 시 키가 사라집니다               │ │  │
│  │  │ • 반드시 Step 3에서 키 백업을 수행하세요                │ │  │
│  │  │ • 다른 기기에서 서명하려면 키 복원이 필요합니다         │ │  │
│  │  └────────────────────────────────────────────────────────┘ │  │
│  │                                                              │  │
│  │                          [키 생성하기]                        │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

#### Step 2: PIN 설정 (개인키 암호화용)

```
┌─ Step 2/3: PIN 설정 ──────────────────────────────────────────────┐
│                                                                    │
│  개인키를 보호할 PIN 6자리를 설정하세요.                           │
│  서명할 때마다 이 PIN을 입력해야 합니다.                           │
│                                                                    │
│  PIN 입력:                                                         │
│  ┌─────────────────────────────────┐                              │
│  │  ● ● ● ● ○ ○                  │                              │
│  │                                 │                              │
│  │  [1]  [2]  [3]                  │                              │
│  │  [4]  [5]  [6]                  │                              │
│  │  [7]  [8]  [9]                  │                              │
│  │       [0]       [←]            │                              │
│  └─────────────────────────────────┘                              │
│                                                                    │
│  PIN 확인:                                                         │
│  ┌─────────────────────────────────┐                              │
│  │  ○ ○ ○ ○ ○ ○                  │                              │
│  └─────────────────────────────────┘                              │
│                                                                    │
│  ⚠ PIN을 분실하면 키를 복구할 수 없습니다.                        │
│     (키 백업 파일 + PIN 모두 필요)                                 │
│                                                                    │
│  [이전]                        [PIN 설정 완료]                     │
└────────────────────────────────────────────────────────────────────┘
```

> **기술 상세**: PIN 입력 → `PBKDF2(PIN, salt, 100000)` → AES-256-GCM 키 생성 →
> 개인키를 AES-256-GCM으로 암호화 → IndexedDB `hospital-run-keystore` 저장

#### Step 3: 인증서 발급 + 키 백업

```
┌─ Step 3/3: 인증서 발급 신청 + 키 백업 ────────────────────────────┐
│                                                                    │
│  ✅ 개인키 생성 완료                                               │
│  ✅ PIN 설정 완료                                                  │
│                                                                    │
│  ── 인증서 정보 (자동 입력) ──                                    │
│  이름:      김내과                                                 │
│  면허번호:  MD-2018-12345                                          │
│  면허종류:  의사                                                   │
│  소속:      Hospital RUN · 내과                                    │
│  알고리즘:  ECDSA P-256                                            │
│  공개키:    04:A3:B7:C2:D8:... (자동)                              │
│                                                                    │
│  ── 키 백업 (필수 권장) ──                                        │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  🔑 키 백업 파일을 안전한 곳에 보관하세요                    │ │
│  │                                                              │ │
│  │  [키 백업 파일 다운로드 (.hrkb)]                             │ │
│  │                                                              │ │
│  │  파일명: hospitalrun-key-김내과-20260520.hrkb                │ │
│  │  ※ .hrkb = Hospital Run Key Backup (AES-256 암호화)         │ │
│  │  ※ 복원 시 이 파일 + PIN이 모두 필요합니다                  │ │
│  │                                                              │ │
│  │  ☑ 키 백업 파일을 다운로드했습니다                           │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  [이전]                        [발급 신청]                         │
│                                                                    │
│  ⓘ 발급 신청 후 관리자 승인이 필요합니다 (면허 확인)              │
└────────────────────────────────────────────────────────────────────┘
```

> **흐름**: [발급 신청] 클릭 → 공개키 + CSR을 서버 전송 →
> 관리자 승인 대기 → 승인 시 인증서 활성화 (ACTIVE)

#### 발급 완료 후: 내 인증서 대시보드

```
┌─ 내 전자 인증서 ───────────────────────────────────────────────────┐
│                                                                     │
│  ┌─ 인증서 카드 ─────────────────────────────────────────────────┐ │
│  │  🟢 ACTIVE                                 만료: D-730      │ │
│  │                                                              │ │
│  │  ┌────────┐  김내과 (MD-2018-12345)                         │ │
│  │  │  🔒    │  Hospital RUN · 내과                             │ │
│  │  │  KEY   │  ECDSA P-256                                     │ │
│  │  └────────┘  일련번호: CERT-2026-0520-A3B7                  │ │
│  │              지문: 3A:B7:C2:D8:E9:F0:11:22                  │ │
│  │              발급: 2026-05-20 ~ 2028-05-19                  │ │
│  │                                                              │ │
│  │  [서명 테스트]  [키 백업]  [PIN 변경]  [갱신]  [정지 ⚠]    │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ 키 상태 ─────────────────────────────────────────────────────┐ │
│  │  개인키 저장: ✅ 이 브라우저 (Chrome · macOS)                │ │
│  │  마지막 백업: 2026-05-20 11:30                               │ │
│  │  PIN 실패 횟수: 0/5                                          │ │
│  │  [다른 기기에서 키 복원하기]                                  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ 내 서명 이력 (최근 20건) ─────────────────────────────────────┐│
│  │  날짜         문서 유형     환자       상태     블록체인      ││
│  │  05-20 11:30  진단서        김영수     ✅ 서명  ✅ 확인      ││
│  │  05-20 10:15  처방전        이미영     ✅ 서명  ⏳ 대기      ││
│  │  05-19 16:45  수술기록      박철수     ✅ 서명  ✅ 확인      ││
│  │  05-19 14:20  동의서(3인)   한지영     ✅ 서명  ✅ 확인      ││
│  │                              [전체 이력 보기 →]              ││
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ 인증서 갱신 이력 ─────────────────────────────────────────────┐│
│  │  v3 [현재] 2026-05-20 ~ 2028-05-19  ● ACTIVE                ││
│  │  v2         2024-05-20 ~ 2026-05-19  ○ EXPIRED (갱신됨)      ││
│  │  v1         2022-05-20 ~ 2024-05-19  ○ EXPIRED (갱신됨)      ││
│  └──────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

#### 키 복원 화면 (다른 기기/브라우저 초기화 후)

```
┌─ 키 복원 ──────────────────────────────────────────────────────────┐
│                                                                     │
│  이 브라우저에 개인키가 없습니다.                                   │
│  기존 키 백업 파일로 복원하거나, 새 키를 생성하세요.               │
│                                                                     │
│  ── 방법 1: 키 백업 파일로 복원 ──                                │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  [📎 .hrkb 파일 선택]                                       │ │
│  │                                                              │ │
│  │  선택된 파일: hospitalrun-key-김내과-20260520.hrkb           │ │
│  │                                                              │ │
│  │  PIN 입력: ○ ○ ○ ○ ○ ○                                     │ │
│  │                                                              │ │
│  │  [복원하기]                                                  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ── 방법 2: 새 키 생성 (기존 인증서 폐기) ──                      │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  ⚠ 새 키를 생성하면 기존 인증서가 폐기됩니다.               │ │
│  │  기존 서명은 유효하지만, 새 서명에는 새 인증서가 필요합니다. │ │
│  │                                                              │ │
│  │  [새 키 생성 + 기존 인증서 폐기]                             │ │
│  └──────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 6.1.1 환자 — 인증서 설정 & 서명 (환자 포털 `/portal`)

> 환자 포털 내 「내 인증서」 섹션. 본인인증(NICE CI) 기반 자동 발급.
> 의료인과 동일한 Web Crypto API + IndexedDB + PIN 구조.

#### 환자 인증서 발급 흐름

```
환자 포털 로그인
     │
     ▼
  인증서 존재 확인 → 있으면 → 인증서 카드 표시
     │
     ▼ (없으면)
  ┌─ 전자 인증서 설정 ──────────────────────────────────────────────┐
  │                                                                  │
  │  🔐 전자 인증서를 만들면 동의서에 직접 전자서명할 수 있고,       │
  │     진료기록·발급문서를 위변조 없이 안전하게 보관할 수 있습니다. │
  │                                                                  │
  │  ── Step 1: 본인인증 ──                                         │
  │  ┌────────────────────────────────────────────────────────────┐ │
  │  │  본인인증이 완료되어야 인증서를 발급받을 수 있습니다.      │ │
  │  │                                                            │ │
  │  │  ✅ 본인인증 완료 (NICE CI: 2026-05-20 10:30)            │ │
  │  │  이름: 김영수 · MRN: P2026-0001                           │ │
  │  └────────────────────────────────────────────────────────────┘ │
  │                                                                  │
  │  ── Step 2: PIN 설정 ──                                         │
  │  서명할 때 사용할 PIN 6자리를 설정하세요.                       │
  │  ┌─────────────────────┐                                        │
  │  │  ○ ○ ○ ○ ○ ○       │                                        │
  │  │  [숫자 패드]         │                                        │
  │  └─────────────────────┘                                        │
  │                                                                  │
  │  ── Step 3: 인증서 발급 + 키 백업 ──                            │
  │  [📥 키 백업 파일 다운로드 (.hrkb)]                             │
  │  ☑ 키 백업 파일을 다운로드했습니다                              │
  │                                                                  │
  │  [인증서 발급하기]                                               │
  │                                                                  │
  │  ⓘ 환자 인증서는 본인인증 완료 시 즉시 발급됩니다 (관리자 승인 불필요) │
  └──────────────────────────────────────────────────────────────────┘
```

#### 환자 포털 — 내 인증서 & 서명된 문서

```
┌─ 환자 포털: 내 전자 인증서 ────────────────────────────────────────┐
│                                                                     │
│  ┌─ 인증서 ──────────────────────────────────────────────────────┐ │
│  │  🟢 ACTIVE                                    만료: D-365   │ │
│  │  김영수 · P2026-0001                                         │ │
│  │  ECDSA P-256 · 발급: 2026-05-20                             │ │
│  │  [키 백업]  [PIN 변경]  [정지]                               │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ 내가 서명한 문서 ─────────────────────────────────────────────┐│
│  │  날짜         문서 유형       내용             블록체인       ││
│  │  05-20 11:32  수술 동의서     우측 서혜부 탈장  ✅ 확인       ││
│  │  05-18 14:10  입원 동의서     내과 입원         ✅ 확인       ││
│  │  05-15 09:30  검사 동의서     위내시경          ✅ 확인       ││
│  │  05-10 16:00  개인정보동의    포털 가입         ✅ 확인       ││
│  │                                                              ││
│  │  [서명 봉투 📦] [검증 🔍] — 각 문서 우측                    ││
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ 나에게 발급된 문서 (의료인 서명 포함) ─────────────────────────┐│
│  │  날짜         문서 유형       발급자         블록체인         ││
│  │  05-20 11:30  진단서          김내과 의사    ✅ 확인          ││
│  │  05-19 16:45  수술기록        김내과 의사    ✅ 확인          ││
│  │  05-18 09:00  처방전          김내과 의사    ✅ 확인          ││
│  │  05-15 14:20  검사결과 보고   문검사 병리사  ✅ 확인          ││
│  │                                                              ││
│  │  [원본 확인 🔍] [서명 검증 ✅] [PDF 다운로드 📄] — 각 문서  ││
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ⓘ 모든 문서는 블록체인에 기록되어 위변조가 불가능합니다.         │
└─────────────────────────────────────────────────────────────────────┘
```

#### 환자 서명 모달 (포털에서 동의서 서명 시)

```
┌─ 전자서명 ─────────────────────────────────────────────────────────┐
│                                                                     │
│  📄 수술 동의서 — 우측 서혜부 탈장 교정술                          │
│  담당의: 김내과 · 수술 예정일: 2026-05-21                          │
│                                                                     │
│  ── 동의 내용 확인 ──                                              │
│  ☑ 수술의 목적과 방법을 설명받았습니다                             │
│  ☑ 예상되는 합병증과 위험을 이해했습니다                           │
│  ☑ 대안적 치료 방법에 대해 설명받았습니다                          │
│  ☑ 질문할 기회가 충분히 주어졌습니다                               │
│                                                                     │
│  ── 서명 ──                                                        │
│  문서 해시: SHA256: c4d5e6f7...                                    │
│  내 인증서: 김영수 (P2026-0001, ECDSA P-256)                      │
│                                                                     │
│  PIN 입력: ○ ○ ○ ○ ○ ○                                            │
│  [숫자 패드]                                                        │
│                                                                     │
│  [취소]                        [동의하고 서명하기 🔏]               │
└─────────────────────────────────────────────────────────────────────┘
```

#### 환자 — 발급문서 수령 확인 서명

```
의료인이 진단서/소견서 발급
     │
     ▼
  환자 포털 알림: "진단서가 발급되었습니다"
     │
     ▼
  ┌─ 문서 수령 확인 ──────────────────────────────────────────────┐
  │                                                                │
  │  📄 진단서 — 김내과 의사 발급                                  │
  │  발급일: 2026-05-20 · 환자: 김영수                             │
  │                                                                │
  │  [문서 원본 보기 📄]                                           │
  │                                                                │
  │  의료인 서명: ✅ 김내과 (MD-2018-12345) — 블록체인 확인       │
  │                                                                │
  │  ── 수령 확인 서명 ──                                         │
  │  이 문서를 수령했음을 전자서명으로 확인합니다.                 │
  │                                                                │
  │  PIN 입력: ○ ○ ○ ○ ○ ○                                       │
  │                                                                │
  │  [수령 확인 서명 🔏]                                           │
  │                                                                │
  │  서명 후: 의료인 서명 + 환자 수령서명 → 블록체인 최종 앵커링  │
  └────────────────────────────────────────────────────────────────┘
```

---

### 6.2 관리자 — 인증서 관리 대시보드 (`/admin/blockchain-cert`)

> ADMIN 전용 페이지. 전체 의료인 인증서 현황 + 승인/폐기 + 정책 관리.

#### 관리자 대시보드 메인

```
┌─ 인증서 관리 (관리자) ─────────────────────────────────────────────┐
│                                                                     │
│  ── 현황 카드 ──                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ 전체      │  │ 활성      │  │ 승인대기  │  │ 폐기/정지 │          │
│  │   56      │  │   48     │  │    3      │  │    5     │          │
│  │ 인증서    │  │ ACTIVE   │  │ PENDING   │  │ REVOKED  │          │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘          │
│                                                                     │
│  ── 승인 대기 (PENDING) ──                                         │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  ⏳ 이수술실간호 · RN-2019-50002 · 간호사 · 수술실          │ │
│  │     신청: 2026-05-20 10:30   알고리즘: ECDSA P-256          │ │
│  │     [면허 확인]  [✅ 승인]  [❌ 반려]                        │ │
│  │─────────────────────────────────────────────────────────────│ │
│  │  ⏳ 박산부인과간호 · RN-2020-50003 · 간호사 · 산부인과      │ │
│  │     신청: 2026-05-20 09:15   알고리즘: ECDSA P-256          │ │
│  │     [면허 확인]  [✅ 승인]  [❌ 반려]                        │ │
│  │─────────────────────────────────────────────────────────────│ │
│  │  ⏳ 테스트검사 · MT-TEST-021 · 임상병리사 · 진단검사         │ │
│  │     신청: 2026-05-19 16:00   알고리즘: RSA-2048             │ │
│  │     [면허 확인]  [✅ 승인]  [❌ 반려]                        │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ── 전체 인증서 목록 ──                                            │
│  검색: [이름/면허번호 _________]  상태: [전체 ▼]  직종: [전체 ▼] │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  이름       면허         직종     소속       상태    만료     │ │
│  │  김내과     MD-2018-123  의사     내과       🟢     D-730   │ │
│  │  박외과     MD-2019-456  의사     외과       🟢     D-680   │ │
│  │  조간호     RN-2015-100  간호사   내과병동   🟢     D-540   │ │
│  │  임약사     PH-2017-500  약사     약제과     🟡정지  -      │ │
│  │  문검사     MT-2018-600  병리사   진검과     🔴폐기  -      │ │
│  │                                                              │ │
│  │  [인증서 상세] → 클릭 시 상세 모달                           │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ── 만료 예정 알림 ──                                              │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  ⚠ D-30 이내 만료 예정: 2건                                 │ │
│  │  • 오정형 (MD-2020-789) — 만료: 2026-06-19 (D-30)           │ │
│  │  • 한산부 (MD-2021-012) — 만료: 2026-06-25 (D-36)           │ │
│  │  [갱신 안내 메일 발송]                                       │ │
│  └──────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

#### 관리자 — 인증서 상세 모달

```
┌─ 인증서 상세 ──────────────────────────────────────────────────────┐
│                                                                     │
│  ── 인증서 정보 ──                                                 │
│  일련번호:  CERT-2026-0520-A3B7                                    │
│  소유자:    김내과 (MD-2018-12345)                                  │
│  소속:      Hospital RUN · 내과                                     │
│  알고리즘:  ECDSA P-256                                             │
│  공개키:    04:A3:B7:C2:D8:E9:F0:... (64 bytes)                    │
│  지문:      3A:B7:C2:D8:E9:F0:11:22:33:44:55:66                   │
│  발급일:    2026-05-20                                              │
│  만료일:    2028-05-19                                              │
│  상태:      🟢 ACTIVE                                               │
│  블록체인:  Tx 0xA3B7... (Block #12345, 6 confirmations)           │
│                                                                     │
│  ── 서명 통계 ──                                                   │
│  총 서명 수: 142건 | 이번 달: 23건 | 오늘: 3건                     │
│  마지막 서명: 2026-05-20 11:30 (진단서)                            │
│                                                                     │
│  ── 감사 로그 ──                                                   │
│  2026-05-20 11:30  SIGN_SUCCESS  진단서 서명 (김영수)              │
│  2026-05-20 10:15  SIGN_SUCCESS  처방전 서명 (이미영)              │
│  2026-05-20 09:00  KEY_BACKUP    키 백업 수행                      │
│  2026-05-20 08:30  ISSUED        인증서 발급 (관리자 승인)         │
│                                                                     │
│  ── 관리자 액션 ──                                                 │
│  [일시정지]  [폐기 (비가역)]  [갱신 강제]                          │
│                                                                     │
│  [닫기]                                                             │
└─────────────────────────────────────────────────────────────────────┘
```

#### 관리자 — 정책 설정 탭

```
┌─ 인증서 정책 설정 ─────────────────────────────────────────────────┐
│                                                                     │
│  ── 인증서 유효기간 ──                                             │
│  기본 유효기간: [2년 ▼]  (1년/2년/3년/5년)                        │
│                                                                     │
│  ── 허용 알고리즘 ──                                               │
│  ☑ ECDSA P-256 (권장)                                              │
│  ☑ RSA-2048                                                        │
│  ☐ RSA-4096                                                        │
│  ☐ Ed25519 (실험적)                                                │
│                                                                     │
│  ── PIN 정책 ──                                                    │
│  PIN 길이: [6자리 ▼]  (4/6/8)                                     │
│  실패 잠금 횟수: [5회 ▼]                                           │
│  잠금 시간: [10분 ▼]                                               │
│  자동 정지 횟수: [10회 ▼]                                          │
│                                                                     │
│  ── 자동 만료 정책 ──                                              │
│  ☑ 만료 D-90 알림 메일                                             │
│  ☑ 만료 D-30 갱신 안내 메일                                       │
│  ☑ 만료 D-7 긴급 알림                                             │
│  ☑ 만료 시 자동 EXPIRED 전환                                      │
│                                                                     │
│  ── 블록체인 앵커링 ──                                             │
│  앵커링 주기: [1시간 ▼]  (즉시/30분/1시간/6시간/1일)              │
│  앵커링 방식: [● 내부 Merkle Tree  ○ Hyperledger  ○ Polygon]     │
│                                                                     │
│  ── 직종별 서명 필수 문서 ──                                       │
│  의사: ☑ 진단서 ☑ 처방전 ☑ 수술기록 ☑ 퇴원요약                  │
│  간호사: ☑ 동의서(확인자 가능) ☑ 간호기록                                │
│  약사: ☑ 조제확인                                                  │
│  검사자: ☑ 검사결과 보고                                           │
│                                                                     │
│  [저장]                                                             │
└─────────────────────────────────────────────────────────────────────┘
```

#### 관리자 — 블록체인 앵커 모니터링

```
┌─ 블록체인 앵커 현황 ───────────────────────────────────────────────┐
│                                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ 총 앵커   │  │ 확인됨   │  │ 대기 중   │  │ 실패      │          │
│  │  1,247    │  │  1,240   │  │    5      │  │    2     │          │
│  │ anchors  │  │ CONFIRMED│  │ PENDING   │  │ FAILED   │          │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘          │
│                                                                     │
│  ── 최근 배치 ──                                                   │
│  배치 #127  2026-05-20 11:00  87건  Merkle Root: 8F3A...  ✅      │
│  배치 #126  2026-05-20 10:00  52건  Merkle Root: C2D8...  ✅      │
│  배치 #125  2026-05-20 09:00  34건  Merkle Root: A1B2...  ✅      │
│                                                                     │
│  ── 실패 항목 ──                                                   │
│  ❌ 배치 #121  timeout (재시도 대기 중)  [수동 재시도]             │
│  ❌ 배치 #118  gas insufficient         [수동 재시도]             │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 6.3 공통 컴포넌트 — 서명 모달 (SignatureModal)

> 진단서/처방전/동의서 등 문서 작성 완료 시 호출되는 공통 모달

```
┌─ 전자서명 ─────────────────────────────────────────────────────────┐
│                                                                     │
│  📄 진단서 — 김영수 (P2026-0001)                                   │
│                                                                     │
│  ── 서명 대상 문서 ──                                              │
│  문서 유형: 진단서                                                  │
│  문서 해시: SHA256: a3b7c2d8e9f01122...                             │
│  해시 시각: 2026-05-20 11:30:42 KST                                │
│                                                                     │
│  ── 서명 인증서 ──                                                 │
│  🔒 김내과 (CERT-2026-0520-A3B7)                                   │
│  ECDSA P-256 · 만료: 2028-05-19 (D-730)                            │
│  면허: MD-2018-12345 · 내과                                        │
│                                                                     │
│  ── PIN 입력 ──                                                    │
│  ┌─────────────────────────────────┐                               │
│  │  ● ● ● ○ ○ ○                  │                               │
│  │                                 │                               │
│  │  [1]  [2]  [3]                  │                               │
│  │  [4]  [5]  [6]                  │                               │
│  │  [7]  [8]  [9]                  │                               │
│  │       [0]       [←]            │                               │
│  └─────────────────────────────────┘                               │
│  실패 횟수: 0/5                                                    │
│                                                                     │
│  ☑ 위 문서의 내용을 확인하였으며, 전자서명에 동의합니다.           │
│                                                                     │
│  [취소]                                [서명하기 🔏]                │
│                                                                     │
│  ─── 서명 후 ───                                                   │
│  ✅ 서명 완료                                                      │
│  서명 ID: SIG-2026-0520-1130-A3B7                                  │
│  블록체인 앵커: ⏳ 다음 배치에 포함 예정 (최대 1시간)              │
│  [확인]                                                             │
└─────────────────────────────────────────────────────────────────────┘
```

#### 서명 모달 — 인증서 없는 경우

```
┌─ 전자서명 ─────────────────────────────────────────────────────────┐
│                                                                     │
│  ⚠ 전자 인증서가 설정되지 않았습니다.                              │
│                                                                     │
│  전자서명을 하려면 먼저 인증서를 발급받아야 합니다.                │
│                                                                     │
│  [인증서 발급 시작 →]     [기존 서명 방식 사용 (서명 없음)]        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 서명 모달 — 다중 서명 (수술 동의서 예시)

```
┌─ 전자서명 (다중 서명) ─────────────────────────────────────────────┐
│                                                                     │
│  📄 수술 동의서 — 박철수 (P2026-0003)                              │
│  수술명: 우측 서혜부 탈장 교정술                                   │
│                                                                     │
│  ── 서명 진행 현황 (2/3 완료) ──                                   │
│                                                                     │
│  1. 집도의 (PRIMARY)                                               │
│     ✅ 김내과 · 2026-05-20 11:30:45 · SIG-001                     │
│                                                                     │
│  2. 환자/보호자 (CONSENT)                                          │
│     ✅ 박철수(본인) · 2026-05-20 11:32:10 · 터치 서명              │
│                                                                     │
│  3. 보호자 (GUARDIAN) ← 현재                                  │
│     ⏳ 조간호 대기 중                                              │
│     [PIN 입력 → 서명하기 🔏]                                       │
│                                                                     │
│  ── 완료 후 ──                                                     │
│  모든 서명 완료 시 블록체인 최종 앵커링 실행                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 6.4 공개 검증 페이지 (`/verify`)

> 로그인 없이 누구나 접근 가능한 공개 페이지

```
┌─ 문서 서명 검증 ──────────────────────────────────────────────────┐
│                                                                    │
│  Hospital RUN 전자서명 검증 서비스                                 │
│                                                                    │
│  ── 검증 방법 선택 ──                                             │
│  ● 문서 ID로 검증    ○ 파일 업로드로 검증    ○ QR 코드 스캔     │
│                                                                    │
│  문서 ID: [SDOC-2026-0520-A3B7______]  [검증하기]                │
│                                                                    │
│  ═══════════════════════════════════════════════════════════════   │
│                                                                    │
│  ── 검증 결과 ──                                                  │
│                                                                    │
│  ✅ 문서 무결성    해시 일치 (SHA256: a3b7c2d8...)                │
│  ✅ 서명 유효      김내과 의사 (면허: MD-2018-12345)              │
│  ✅ 서명 시각      2026-05-20 11:30:45 KST                      │
│  ✅ 인증서 유효    ACTIVE (만료: 2028-05-19)                     │
│  ✅ 블록체인 확인  Block #12345 · 48 confirmations               │
│  ✅ 위변조 없음    서명 후 문서 변경 없음                        │
│                                                                    │
│  ── 서명 체인 (3인 서명) ──                                       │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  #  역할          서명자              시각           상태   │ │
│  │  1  집도의(PRIMARY) 김내과(MD-2018-1) 11:30:45 KST  ✅     │ │
│  │  2  환자(CONSENT)   박철수(본인)      11:32:10 KST  ✅     │ │
│  │  3  보호자(GUARDIAN)  박보호자(환자가족) 11:33:22 KST  ✅     │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  [서명 봉투 다운로드 📦]  [검증 보고서 PDF 🖨]  [QR 코드 📱]    │
│                                                                    │
│  ⓘ 이 검증 결과는 법적 효력을 위한 참고 자료입니다.              │
│  ⓘ Hospital RUN v1.1.0 · 블록체인 전자서명 검증 서비스           │
└────────────────────────────────────────────────────────────────────┘
```

---

### 6.5 기존 문서 UI 연동 — 서명 배지 컴포넌트

> 진단서/처방전/동의서 등 기존 문서 목록에 표시되는 인라인 서명 상태 배지

```
서명 전:   [📝 서명 필요]     (빨강 배지, 클릭 → 서명 모달)
서명 중:   [⏳ 서명 대기 2/3]  (노랑 배지, 다중서명 진행 중)
서명 완료: [🔒 전자서명 됨]    (초록 배지, 클릭 → 서명 상세)
블록확인:  [⛓ 블록체인 확인]   (파랑 배지, 블록체인 앵커링 완료)
```

#### 서명 상세 팝오버 (배지 클릭 시)

```
┌─ 서명 정보 ──────────────────────┐
│  서명자: 김내과 (MD-2018-12345)  │
│  서명일: 2026-05-20 11:30:45     │
│  인증서: CERT-2026-0520-A3B7     │
│  블록체인: Block #12345 ✅       │
│  [검증 페이지로 →]               │
└──────────────────────────────────┘
```

---

### 6.6 온보딩 플로우 (최초 로그인 시)

```
의료인 최초 로그인
     │
     ▼
  인증서 존재 확인 → 있으면 → 정상 진입
     │
     ▼ (없으면)
  온보딩 배너 표시:
  ┌──────────────────────────────────────────────────────────────┐
  │  🔐 전자 인증서를 설정하세요                                 │
  │  의료 문서에 법적 효력이 있는 전자서명을 하려면               │
  │  인증서 설정이 필요합니다.                                   │
  │                                                              │
  │  [지금 설정하기]                      [나중에 하기]          │
  └──────────────────────────────────────────────────────────────┘
     │                                         │
     ▼                                         ▼
  /settings/my-certificate                  배너 유지 (3일 후 재표시)
  (Step 1→2→3 진행)
```

---

## 7. 보안 설계

### 7.1 개인키 보호

| 위협 | 대응 |
|------|------|
| 키 탈취 (XSS) | IndexedDB는 Same-Origin, CSP 헤더 적용 |
| 키 탈취 (물리) | AES-256-GCM + PIN 암호화, 브라우저 종료 시 메모리 해제 |
| 키 분실 | 키 백업 (암호화 파일 다운로드) + 복원 기능 |
| PIN 무차별 대입 | 5회 실패 시 10분 잠금, 10회 실패 시 인증서 자동 정지 |
| 중간자 공격 | HTTPS/TLS 1.3 필수, 공개키 핀닝 |

### 7.2 서명 무결성

| 단계 | 검증 항목 |
|------|----------|
| 서명 시 | 인증서 ACTIVE 확인 + 만료 전 확인 + 서명 알고리즘 일치 |
| 저장 시 | 문서 해시 + 서명값 + 인증서 스냅샷 저장 |
| 검증 시 | 해시 재계산 + 서명 검증 + CRL 확인 + 블록체인 타임스탬프 |

### 7.3 블록체인 앵커링 전략

```
┌─ 배치 앵커링 (비용 최적화) ────────────────────────┐
│                                                     │
│  매 1시간마다 Cron:                                 │
│    1. 미앵커 해시 수집 (최대 1000건)                │
│    2. Merkle Tree 구성                              │
│    3. Merkle Root만 블록체인에 기록 (1 Tx)          │
│    4. 각 해시에 Merkle Proof 저장                   │
│                                                     │
│  검증 시:                                           │
│    해시 + Merkle Proof → Merkle Root 재계산          │
│    → 블록체인의 Root와 비교                          │
│                                                     │
│  효과: 1000건 = 1 Tx (가스비 1/1000)                │
└─────────────────────────────────────────────────────┘
```

---

## 8. 법적 준거

### 8.1 관련 법령

| 법령 | 조항 | 요구사항 | 대응 |
|------|------|---------|------|
| 의료법 제17조 | 진단서 교부 | 의사 직접 서명 | 블록체인 인증서 기반 전자서명 |
| 의료법 제22조 | 진료기록부 | 서명 또는 기명날인 | 전자서명 + 타임스탬프 |
| 전자문서법 제2조 | 전자서명 정의 | 서명자 확인 + 무결성 | PKI + 해시 검증 |
| 전자서명법 제3조 (2020 개정) | 전자서명 효력 | 공인전자서명 제도 폐지 → 모든 전자서명 동등 효력, **신뢰성 입증** 필요 | 블록체인 앵커링 + PKI 구조로 신뢰성 확보 |
| 개인정보보호법 | 의료정보 보호 | 암호화, 접근통제 | AES-256 + RBAC |
| 의료기관 인증기준 | EMR 인증 | 전자서명 체계 | 본 시스템으로 충족 |

### 8.2 EMR 인증 충족 항목

| 인증 항목 | 요구사항 | 충족 방식 |
|----------|---------|----------|
| 진료기록 서명 | 의료인 전자서명 필수 | 블록체인 인증서 기반 서명 |
| 기록 무결성 | 위변조 방지 | SHA-256 해시 + 블록체인 앵커 |
| 부인 방지 | 서명 사실 증명 | 블록체인 타임스탬프 |
| 감사 추적 | 서명 이력 관리 | CertificateAuditLog |
| 접근 통제 | 인가된 사용자만 서명 | PIN + 인증서 상태 확인 |

---

## 9. 기존 시스템 연동

### 9.1 서명 대상 문서 매핑

| 기존 모델 | documentType | 의료인 서명 | 환자 서명 | 다중서명 |
|----------|-------------|:----------:|:--------:|:--------:|
| Certificate (진단서/소견서) | CERTIFICATE | ✅ 담당의 (PRIMARY) | ✅ 수령확인 (RECEIPT) | ✅ 2인 |
| ConsentForm (동의서) | CONSENT | ✅ 담당의 (PRIMARY) | ✅ 환자 (CONSENT) | ✅ 3인 |
| Prescription (처방전) | PRESCRIPTION | ✅ 처방의 (PRIMARY) | ❌ | 단일 |
| SurgeryOpNote (수술기록) | OP_NOTE | ✅ 집도의 (PRIMARY) + 마취의 (CO_SIGN) | ❌ | ✅ 2인 |
| DischargeSummary (퇴원요약) | DISCHARGE_SUMMARY | ✅ 담당의 (PRIMARY) | ✅ 환자 퇴원확인 (CONFIRM) | ✅ 2인 |
| LabResult (검사결과) | LAB_REPORT | ✅ 판독의/검사자 (PRIMARY) | ❌ | 단일 |
| ImagingResult (영상판독) | IMAGING_REPORT | ✅ 판독의 (PRIMARY) | ❌ | 단일 |

### 9.1.1 환자 서명이 필요한 문서 상세

| 문서 | 환자 서명 역할 | 서명 시점 | 서명 채널 |
|------|:---:|------|------|
| **동의서** (수술/검사/입원) | CONSENT | 시술 전 | 포털 또는 원내 태블릿 |
| **진단서/소견서 수령** | RECEIPT | 발급 후 | 포털에서 수령 확인 |
| **퇴원확인서** | CONFIRM | 퇴원 시 | 포털 또는 원내 |
| **개인정보 동의** | CONSENT | 포털 가입 시 | 포털 |
| **진료기록 사본 수령** | RECEIPT | 사본 발급 후 | 포털 |

> **의미**: 환자 서명이 블록체인에 기록되면, 환자가 해당 문서를 확인·동의·수령한 사실이 부인 불가능하게 증명된다. 의료 분쟁 시 양측 서명이 모두 블록체인에 존재하므로 법적 증거력이 강화된다.

### 9.2 기존 서명 필드 마이그레이션

```
현재: ConsentForm.signedBy (텍스트) → 향후: SignedDocument + DocumentSignature
현재: Certificate.issuedBy (UUID)   → 향후: SignedDocument + 블록체인 앵커
현재: Encounter.signedAt (DateTime) → 향후: DocumentSignature.signedAt + 검증
```

---

## 10. 구현 단계

### Phase 1: 기반 구축 (2주)

| 항목 | 내용 |
|------|------|
| Prisma 모델 | BlockchainCertificate, SignedDocument, DocumentSignature, BlockchainAnchor, CertificateAuditLog |
| API 모듈 | blockchain-cert, document-sign, blockchain-anchor |
| 키 생성 | Web Crypto API + IndexedDB 암호화 저장 |
| 내부 앵커링 | Merkle Tree + PostgreSQL (블록체인 없이) |

### Phase 2: 서명 통합 (2주)

| 항목 | 내용 |
|------|------|
| 서명 모달 | PIN 입력 → 개인키 복호화 → 서명 → API 전송 |
| 문서 연동 | 기존 진단서/동의서/처방전에 서명 버튼 추가 |
| 다중 서명 | 수술 동의서 3인 서명 워크플로우 |
| 검증 페이지 | 공개 검증 URL + 서명 봉투 다운로드 |

### Phase 3: 블록체인 연동 (2주)

| 항목 | 내용 |
|------|------|
| 체인 선택 | Hyperledger Fabric 또는 Polygon PoS |
| 배치 앵커링 | Cron 1시간 → Merkle Root → 블록체인 Tx |
| 검증 강화 | 블록체인 트랜잭션 조회 + 확인 수 표시 |

### Phase 4: 관리·운영 (1주)

| 항목 | 내용 |
|------|------|
| 관리자 대시보드 | 인증서 현황, 서명 통계, 앵커링 상태 |
| 키 백업/복원 | 암호화 파일 다운로드 + QR 코드 |
| CRL 관리 | 인증서 폐기/정지/복원 |
| 감사 로그 | 전체 이벤트 타임라인 |

---

## 11. 예상 작업량

| 항목 | 수량 |
|------|:----:|
| Prisma 모델 | 5개 |
| API 엔드포인트 | ~21개 |
| 프론트 페이지 | 3개 (인증서 관리, 서명 검증, 관리자) |
| 공통 컴포넌트 | 2개 (서명 모달, 인증서 배지) |
| 서비스 로직 | 해시 계산, Merkle Tree, 서명 검증, 배치 앵커링 |

---

## 12. 리스크

| 리스크 | 영향 | 가능성 | 대응 |
|--------|------|--------|------|
| Web Crypto API 브라우저 호환성 | High | Low | 주요 브라우저(Chrome/Edge/Safari) 모두 지원 |
| 개인키 분실 (브라우저 초기화) | High | Medium | 키 백업 필수 안내 + 복원 기능 |
| 블록체인 네트워크 장애 | Medium | Low | 내부 Merkle 선행 → 블록체인은 배치 후순위 |
| 법적 효력 인정 여부 | High | Medium | 법무 검토 + 공인전자서명 연동 가능 설계 |
| PIN 무차별 공격 | Medium | Medium | 실패 횟수 제한 + 인증서 자동 정지 |

---

## 13. 프론트엔드 페이지/컴포넌트 목록

### 13.1 페이지

| 경로 | 역할 | 접근 권한 |
|------|------|----------|
| `/settings/my-certificate` | 의료인 본인 키 생성·인증서 관리 | 본인 (DOCTOR/NURSE/PHARMACIST/LAB_TECH) |
| `/portal` (인증서 탭) | 환자 본인 키 생성·인증서 관리·서명 문서 열람 | 환자 (PatientAccount) |
| `/admin/blockchain-cert` | 관리자 인증서 대시보드 (승인/폐기/정책) | ADMIN |
| `/admin/blockchain-cert/policy` | 관리자 정책 설정 (탭 또는 별도 페이지) | ADMIN |
| `/admin/blockchain-cert/anchors` | 블록체인 앵커 모니터링 | ADMIN |
| `/verify` | 공개 서명 검증 (로그인 불필요) | 공개 |

### 13.2 공통 컴포넌트

| 컴포넌트 | 용도 | 사용 위치 |
|----------|------|----------|
| `SignatureModal` | PIN 입력 → 서명 실행 | 진단서/처방전/동의서/수술기록 등 |
| `MultiSignatureModal` | 다중 서명 진행 | 수술 동의서 (3인), 수술기록 (2인) |
| `SignatureBadge` | 서명 상태 인라인 배지 | 문서 목록/상세 페이지 |
| `SignaturePopover` | 서명 상세 팝오버 | 배지 클릭 시 |
| `PinPad` | 숫자 PIN 입력 패드 | SignatureModal, 키 복원 |
| `CertificateCard` | 인증서 정보 카드 | 내 인증서, 관리자 목록 |
| `KeySetupWizard` | 키 생성 3단계 위저드 | /settings/my-certificate |
| `KeyRestoreDialog` | 키 복원 다이얼로그 | /settings/my-certificate |
| `OnboardingBanner` | 인증서 설정 유도 배너 | 대시보드 상단 (의료인) |
| `PatientCertSetup` | 환자 인증서 설정 위저드 (본인인증→PIN→발급) | 환자 포털 |
| `PatientSignedDocs` | 환자 서명 문서 + 발급 문서 목록 | 환자 포털 |
| `DocumentReceiptSign` | 발급 문서 수령 확인 서명 | 환자 포털 |

### 13.3 클라이언트 유틸리티 (lib/)

| 모듈 | 역할 |
|------|------|
| `lib/crypto/key-manager.ts` | Web Crypto API 래퍼: 키 생성, PIN 암호화/복호화, IndexedDB CRUD |
| `lib/crypto/signer.ts` | 문서 해시 생성 (SHA-256), 서명 실행, 서명 봉투 조립 |
| `lib/crypto/key-backup.ts` | .hrkb 파일 생성/파싱, 키 백업/복원 |

---

## 14. 에러 코드 정의

> Hospital RUN 표준 응답 형식: `{ error: { code, message, details }, meta }`

| 코드 | HTTP | 메시지 | 상황 |
|------|:----:|--------|------|
| `CERT_NOT_FOUND` | 404 | 인증서를 찾을 수 없습니다 | 존재하지 않는 인증서 ID |
| `CERT_EXPIRED` | 403 | 인증서가 만료되었습니다 | 유효기간 경과 |
| `CERT_REVOKED` | 403 | 인증서가 폐기되었습니다 | 폐기된 인증서로 서명 시도 |
| `CERT_SUSPENDED` | 403 | 인증서가 일시정지 상태입니다 | 정지된 인증서로 서명 시도 |
| `CERT_PENDING` | 403 | 인증서 승인 대기 중입니다 | 미승인 인증서로 서명 시도 |
| `CERT_DUPLICATE` | 409 | 이미 활성 인증서가 존재합니다 | 중복 발급 시도 |
| `PIN_INVALID` | 401 | PIN이 올바르지 않습니다 | PIN 불일치 |
| `PIN_LOCKED` | 423 | PIN 실패 횟수 초과로 잠금되었습니다 | 5회 실패 후 10분 잠금 |
| `PIN_AUTO_SUSPENDED` | 423 | PIN 실패 10회 초과로 인증서가 정지되었습니다 | 10회 실패 자동 정지 |
| `SIGNATURE_INVALID` | 400 | 서명 검증에 실패했습니다 | 공개키로 서명 검증 실패 |
| `HASH_MISMATCH` | 400 | 문서 해시가 일치하지 않습니다 | 위변조 감지 |
| `ANCHOR_FAILED` | 502 | 블록체인 앵커링에 실패했습니다 | 체인 네트워크 오류 |
| `ANCHOR_PENDING` | 202 | 블록체인 앵커링 대기 중입니다 | 배치 앵커링 큐 |
| `MULTI_SIGN_TIMEOUT` | 408 | 다중 서명 타임아웃이 만료되었습니다 | 72시간 내 미완료 |
| `MULTI_SIGN_INCOMPLETE` | 400 | 아직 모든 서명이 완료되지 않았습니다 | 필요 서명 수 미달 |
| `IDENTITY_NOT_VERIFIED` | 403 | 본인인증이 완료되지 않았습니다 | 환자 CI 미인증 상태 |
| `KEY_NOT_FOUND` | 404 | 이 브라우저에 개인키가 없습니다 | IndexedDB에 키 없음 |
| `BACKUP_REQUIRED` | 400 | 키 백업을 먼저 수행하세요 | 백업 없이 갱신/폐기 시도 |

---

## 15. 비기능 요구사항

| 항목 | 목표 | 비고 |
|------|------|------|
| 키 생성 시간 | < 3초 | ECDSA P-256 기준 |
| 서명 실행 시간 | < 2초 | PIN 입력 후 서명 완료까지 |
| 서명 검증 시간 | < 500ms | 서버 측 공개키 검증 |
| 블록체인 앵커링 지연 | < 1시간 | 배치 주기 기본값 |
| 동시 서명 처리량 | 50 TPS | 동시 50명 서명 처리 |
| 인증서 저장 용량 | < 5KB/건 | 공개키 + 메타데이터 |
| 키 백업 파일 크기 | < 10KB | .hrkb 파일 |
| IndexedDB 용량 | < 100KB | 키쌍 + 암호화 메타 |
| PIN 잠금 정확도 | 100% | 서버 추적 기준 |
| 가용성 | 99.9% | 서명/검증 서비스 |
| PBKDF2 iterations | 600,000 | OWASP 2023 권장치 |

---

## 16. 테스트 계획

### 16.1 단위 테스트

| 모듈 | 테스트 항목 | 예상 케이스 |
|------|-----------|:-----------:|
| key-manager.ts | KeyPair 생성, PIN 암호화/복호화, IndexedDB CRUD | 15 |
| signer.ts | SHA-256 해시, ECDSA/RSA 서명, 서명 봉투 조립 | 12 |
| key-backup.ts | .hrkb 파일 생성, 파싱, 키 복원 | 8 |
| blockchain-cert.service | 인증서 CRUD, CRL 관리, 승인/폐기 | 20 |
| document-sign.service | 서명 기록, 검증, 다중서명 상태 전이 | 18 |
| blockchain-anchor.service | Merkle Tree 구성, 앵커 기록, 배치 처리 | 12 |
| burn-assessment.service | TBSA 계산 (이미 구현, 참고) | 5 |

### 16.2 통합 테스트

| 시나리오 | 검증 항목 |
|---------|----------|
| 서명/검증 라운드트립 | 키 생성 → 서명 → 서버 검증 → 결과 일치 |
| PIN 실패 잠금 | 5회 실패 → 잠금 → 10분 후 해제 → 10회 실패 → 자동 정지 |
| 인증서 갱신 체인 | v1 발급 → v2 갱신 → v1 서명 검증 (과거 공개키) |
| Merkle Tree 앵커링 | N건 해시 → Tree 구성 → Root 앵커 → 개별 Proof 검증 |
| 환자 자동 발급 | 본인인증 완료 → 자동 ACTIVE → 동의서 서명 가능 |

### 16.3 E2E 테스트

| 시나리오 | 워크플로우 |
|---------|----------|
| 의료인 전체 흐름 | 키 생성 → PIN → 발급 신청 → 관리자 승인 → 진단서 서명 → 검증 |
| 환자 전체 흐름 | 포털 로그인 → 본인인증 → 키 생성 → 동의서 서명 → 발급문서 수령서명 |
| 수술 동의서 3인 | 담당의 서명 → 환자 서명(포털) → 보호자 서명 → 블록체인 자동 앵커 |
| 키 분실 복원 | 브라우저 초기화 → .hrkb 복원 → PIN → 서명 정상 작동 |
| 인증서 폐기 후 검증 | 폐기 → 기존 서명 유효(서명 시점 < 폐기 시점) 확인 |

---

## 17. 성공 기준 (KPI)

| 지표 | Phase 1 목표 | Phase 2 목표 | Phase 3 목표 |
|------|:---:|:---:|:---:|
| 의료인 인증서 발급률 | 50% | 80% | 95% |
| 진단서 전자서명 비율 | 30% | 60% | 90% |
| 동의서 환자 전자서명 비율 | 10% | 40% | 70% |
| 서명 검증 성공률 | 100% | 100% | 100% |
| 블록체인 앵커링 성공률 | 95% | 99% | 99.9% |
| PIN 관련 지원 문의 수 | < 20건/월 | < 10건/월 | < 5건/월 |
| 키 백업 수행률 | 70% | 90% | 95% |
| 평균 서명 소요 시간 | < 5초 | < 3초 | < 2초 |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-05-20 | 초안 작성 | PM |
| 1.1 | 2026-05-20 | UI 상세화 — 역할별(의료인/관리자) 분리, 키 생성 3단계 위저드, 온보딩, 컴포넌트 목록 | PM |
| 1.2 | 2026-05-20 | 환자 인증서 추가 — 모델 통합(BlockchainCertificate), 환자 포털 UI, 동의서/수령확인 서명, 발급문서 열람 | PM |
| 1.3 | 2026-05-20 | 검증 피드백 반영 — RED 3건(인덱스/역관계/AuditLog) + YELLOW 9건(에러코드/테스트/비기능/KPI/PIN서버추적/다중서명타임아웃/용어/법령/환자API) 수정 | PM |
