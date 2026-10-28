# 블록체인 전자서명 — 시스템 전반 통합 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/web/src/app/(main)/patients/[id]/encounter/new/page.tsx · apps/web/src/components/signature/SignatureBadge.tsx · 잔여: 서명 상태 배지(SignatureBadge·SignatureStatusIndicator) 배선 — 붙일 화면·documentType 가 기획에 없어 2026-09-14 P4 보류(소비처 0 가드 동결)(사람/설계)

> **Feature**: blockchain-cert-system-integration
> **Project**: Hospital RUN
> **Version**: 1.0
> **Date**: 2026-05-20
> **Status**: Draft
> **선행 요건**: `blockchain-medical-certificate` (Phase 1 구현 완료)

---

## 1. 개요

### 1.1 현황 분석

블록체인 전자인증서 시스템(BlockchainCertificate + DocumentSignature + SignedDocument)은 Phase 1 구현이 완료되었으나, **기존 시스템과의 통합이 이루어지지 않은 상태**이다. 현재 각 모듈의 서명 방식이 제각각이다.

| 현재 서명 방식 | 모듈 | 문제점 |
|:---:|------|--------|
| **텍스트 이름** | ConsentForm (`signedBy: VarChar`) | 누구나 위조 가능, 법적 효력 없음 |
| **DateTime만** | Encounter (`signedAt`만 기록) | 누가 서명했는지 불명 |
| **UUID만** | DischargeSummary, PathologyReport, LabWorksheet | 서명 사실은 있으나 위변조 검증 불가 |
| **서명 없음** | Pharmacy 조제 검수 | 약사 확인 추적 불가 |
| **텍스트 표시** | PDF 출력 "(전자서명)" | 시각적 표시만, 실제 서명 없음 |

### 1.2 목표

1. **기존 9개 서명 지점**을 BlockchainCertificate 기반 전자서명으로 통합
2. **하위 호환**: 기존 `signedBy`/`signedAt` 필드는 유지하면서 DocumentSignature를 **추가 연결**
3. **점진적 전환**: 전자인증서 미설정 사용자는 기존 방식 유지, 설정 완료 시 블록체인 서명
4. **PDF 서명 마크**: 서명된 문서의 PDF에 블록체인 검증 마크 + QR 코드 삽입

---

## 2. 통합 대상 분석 (9개 지점)

### 2.1 우선순위 분류

#### RED — 필수 (법적 의무 / 현재 미흡)

| # | 대상 | 모델 | 현재 방식 | 문제 | 관련 법률 |
|---|------|------|----------|------|----------|
| **1** | 진료 서명 | Encounter | `signedAt`만 | 서명자 불명 | 의료법 22조 |
| **2** | 동의서 서명 | ConsentForm | 텍스트 이름 | 위조 가능 | 의료법 24조의2 |
| **3** | 약국 조제 검수 | Dispensing | 서명 없음 | 추적 불가 | 약사법 23조 |
| **4** | 처방전 발급 | Prescription | 서명 없음 | 법적 효력 없음 | 의료법 18조 |

#### YELLOW — 중요 (완결성 향상)

| # | 대상 | 모델 | 현재 방식 | 개선 효과 |
|---|------|------|----------|----------|
| **5** | 퇴원요약 서명 | DischargeSummary | UUID | 블록체인 부인방지 |
| **6** | 병리 판독 서명 | PathologyReport | UUID | 판독 무결성 보장 |
| **7** | 검사기록지 서명 | LabWorksheet | UUID | 검사 결과 신뢰성 |
| **8** | 진단서/소견서 발급 | Certificate | UUID (issuedBy) | 발급 증명 강화 |

#### GREEN — 보완 (UX 개선)

| # | 대상 | 현재 | 개선 |
|---|------|------|------|
| **9** | PDF 서명 마크 | "(전자서명)" 텍스트 | 블록체인 검증 마크 + QR |

---

## 3. 통합 아키텍처

### 3.1 이중 서명 패턴 (Dual-Write)

```
┌─ 기존 방식 (하위 호환) ──────────────────────────────────────────┐
│                                                                   │
│  Encounter.signedAt = new Date()                                  │
│  Encounter.signedBy = userId          ← 기존 필드 유지           │
│                                                                   │
├─ 블록체인 서명 (신규 추가) ──────────────────────────────────────┤
│                                                                   │
│  1. SignedDocument 생성/조회 (documentType='ENCOUNTER', id)       │
│  2. DocumentSignature 생성 (signatureValue, certificateId)       │
│  3. BlockchainAnchor 큐 등록 (배치 앵커링)                       │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘

결과:
  - 기존 signedAt/signedBy → 기존 코드 영향 없음
  - SignedDocument → 블록체인 검증 가능
  - 전자인증서 미설정 → 기존 방식만 동작 (graceful fallback)
```

### 3.2 서명 흐름 (통합 후)

```
사용자 ──→ [서명하기] 클릭
              │
              ▼
       인증서 존재 확인
         ├── 없음 → 기존 방식 (signedAt/signedBy만 기록)
         │          + 온보딩 안내 "전자인증서를 설정하면 법적 효력이 강화됩니다"
         │
         └── 있음 → SignatureModal 표시
                     ├── PIN 입력
                     ├── 개인키 복호화
                     ├── 문서 해시 서명
                     └── API: POST /api/v1/document-sign/sign
                              ├── 기존 필드 업데이트 (signedAt/signedBy)
                              ├── DocumentSignature 생성
                              └── BlockchainAnchor 큐 등록
```

### 3.3 프론트엔드 통합 컴포넌트

```
┌─ SmartSignButton ─────────────────────────────────┐
│                                                    │
│  인증서 있음?                                      │
│    YES → [🔏 전자서명] (SignatureModal 호출)       │
│    NO  → [✍ 서명 완료] (기존 방식) + 안내 배지    │
│                                                    │
│  서명 후 상태:                                     │
│    블록체인 → SignatureBadge "⛓ 블록체인 확인"    │
│    기존     → SignatureBadge "✓ 서명됨 (기본)"    │
└────────────────────────────────────────────────────┘
```

---

## 4. 모듈별 통합 상세

### 4.1 Encounter 서명 (진료 완료)

**현재 코드** (`encounter.service.ts`):
```typescript
async sign(id: string) {
  return this.prisma.encounter.update({
    where: { id },
    data: { status: 'SIGNED', signedAt: new Date() },
  });
}
```

**통합 후**:
```typescript
async sign(id: string, userId: string, blockchainSignature?: {
  certificateId: string;
  signatureValue: string;
  signatureAlgorithm: string;
}) {
  // 1. 기존 업데이트 (하위 호환)
  const encounter = await this.prisma.encounter.update({
    where: { id },
    data: { status: 'SIGNED', signedAt: new Date(), signedBy: userId },
  });

  // 2. 블록체인 서명 (인증서 있을 때만)
  if (blockchainSignature) {
    await this.documentSignService.sign({
      documentType: 'ENCOUNTER',
      documentId: id,
      patientId: encounter.patientId,
      documentHash: hashEncounterContent(encounter),
      ...blockchainSignature,
      signerRole: 'PRIMARY',
      signerType: 'STAFF',
      signerUserId: userId,
    });
  }

  return encounter;
}
```

**스키마 변경**: Encounter에 `signedBy String? @map("signed_by") @db.Uuid` 추가

**프론트엔드 변경**:
- `encounter/new/page.tsx`의 `handleSignAndBill` → SmartSignButton 사용
- 기존: `apiClient.post('/encounter/{id}/sign')`
- 통합: 인증서 있으면 SignatureModal → 서명값 포함 전송

---

### 4.2 ConsentForm 서명 (동의서)

**현재 코드** (`consent/page.tsx`):
```typescript
const name = prompt('서명자 이름을 입력하세요');
apiClient.patch(`/consent/${id}/sign`, { patientSignedBy: name });
```

**통합 후**:
- 의사 서명: SignatureModal (블록체인 키)
- 환자 서명: 포털에서 SignatureModal (환자 블록체인 키) 또는 태블릿 터치 서명
- 증인 간호사: SignatureModal (블록체인 키)

**다중서명 적용**:
```
ConsentForm → SignedDocument (requiredSigners: 3)
  1. 의사     → DocumentSignature (signerRole: PRIMARY, signerType: STAFF)
  2. 환자     → DocumentSignature (signerRole: CONSENT, signerType: PATIENT)
  3. 간호사   → DocumentSignature (signerRole: WITNESS, signerType: STAFF)
  → 3/3 완료 시 status: COMPLETED → 블록체인 앵커링
```

**API 변경**:
- `PATCH /consent/:id/sign` → 기존 유지 (하위 호환)
- `POST /document-sign/sign` → 블록체인 서명 추가 (병렬 호출)

---

### 4.3 Pharmacy 조제 검수 (약사 확인)

**현재**: 서명 필드 없음, `status: VERIFIED`만 변경

**통합 후**:

**스키마 추가** (Dispensing 모델):
```prisma
model Dispensing {
  // 기존 필드 유지...
  verifiedBy    String?   @map("verified_by") @db.Uuid   // 추가
  verifiedAt    DateTime? @map("verified_at") @db.Timestamptz() // 추가
}
```

**서명 적용**:
```
약사 검수 → SmartSignButton
  ├── 인증서 없음 → 기존 status 변경 + verifiedBy/At 기록
  └── 인증서 있음 → DocumentSignature (documentType: 'DISPENSING', signerRole: 'APPROVAL')
```

---

### 4.4 Prescription 처방전

**현재**: 처방 생성 시 `prescribedBy` UUID만 기록, 별도 서명 없음

**통합 후**:
- 처방 확정 시 → SmartSignButton → DocumentSignature
- documentType: `PRESCRIPTION`
- 마약류(ControlledSubstance)인 경우 → 2차 확인자도 서명 필요 (다중서명)

---

### 4.5 DischargeSummary 퇴원요약

**현재**: `signedBy` UUID + `signedAt` DateTime

**통합 후**: 기존 유지 + DocumentSignature 추가
- 의사 서명: PRIMARY
- 환자 퇴원확인: CONFIRM (포털에서)

---

### 4.6 PathologyReport 병리 판독

**현재**: `signedBy` UUID + `signedAt` DateTime + `reportedBy` UUID

**통합 후**: 기존 유지 + DocumentSignature 추가
- 판독의: PRIMARY (보고서 작성)
- 최종 서명: APPROVAL (확인 서명)

---

### 4.7 LabWorksheet 검사기록지

**현재**: `signedBy` UUID + `signedAt` DateTime

**통합 후**: 기존 유지 + DocumentSignature 추가
- 검사자: PRIMARY

---

### 4.8 Certificate 진단서/소견서

**현재**: `issuedBy` UUID + `issuedAt` DateTime

**통합 후**: 기존 유지 + DocumentSignature 추가
- 발급 의사: PRIMARY
- 환자 수령확인: RECEIPT (포털에서)

---

### 4.9 PDF 서명 마크

**현재**: `"(전자서명)"` 텍스트만 표시

**통합 후**:

```
┌─ PDF 서명 영역 (통합 후) ──────────────────────────────┐
│                                                         │
│  ┌─ 서명란 ─────────────────┐  ┌─ 검증 QR ──────────┐ │
│  │                          │  │  ┌──────────┐       │ │
│  │  김내과 의사              │  │  │ QR CODE  │       │ │
│  │  MD-2018-12345           │  │  │          │       │ │
│  │  [서명마크 이미지]        │  │  └──────────┘       │ │
│  │  2026-05-20 11:30 KST   │  │  his.example.org     │ │
│  │  CERT-20260520-A3B7     │  │  /verify?id=xxx     │ │
│  │  ⛓ 블록체인 검증됨      │  │                     │ │
│  └──────────────────────────┘  └─────────────────────┘ │
│                                                         │
│  문서 해시: SHA256:a3b7c2d8...                          │
│  블록체인: Block #12345 · 48 confirmations              │
└─────────────────────────────────────────────────────────┘

미서명 시:
┌─ 서명란 ─────────────────┐
│                          │
│  (서명 없음)             │
│                          │
└──────────────────────────┘
```

**구현**: `/print/` 하위 모든 페이지에 `SignedDocumentFooter` 컴포넌트 추가

---

## 5. 공통 컴포넌트

### 5.1 SmartSignButton

```typescript
interface SmartSignButtonProps {
  documentType: string;     // 'ENCOUNTER' | 'CONSENT' | 'PRESCRIPTION' | ...
  documentId: string;
  label?: string;           // 기본: "서명 완료"
  onSign: () => void;       // 기존 서명 로직 (하위 호환)
  onBlockchainSign?: (sig: BlockchainSignatureData) => void;
  disabled?: boolean;
  variant?: 'primary' | 'small';
}
```

동작:
1. 사용자 인증서 존재 여부 확인 (GET `/api/v1/blockchain-cert/my`)
2. 인증서 있음 → SignatureModal 표시 → 블록체인 서명
3. 인증서 없음 → 기존 `onSign()` 호출 + "인증서 설정 안내" 토스트

### 5.2 SignedDocumentFooter (PDF용)

```typescript
interface SignedDocumentFooterProps {
  documentType: string;
  documentId: string;
}
```

- API로 SignedDocument 조회
- 서명 있으면: 서명자 정보 + 인증서 번호 + 해시 + QR 코드 표시
- 서명 없으면: "(미서명)" 표시

### 5.3 SignatureStatusIndicator (문서 목록용)

```typescript
interface SignatureStatusIndicatorProps {
  documentType: string;
  documentId: string;
  compact?: boolean;  // 목록에서 작은 아이콘만 표시
}
```

- 서명 없음: 🔴 (또는 빈 아이콘)
- 기존 서명만: 🟡 (UUID 서명)
- 블록체인 서명: 🟢 (전자서명 검증됨)
- 블록체인 확인: 🔵 (앵커링 완료)

---

## 6. API 변경 사항

### 6.1 기존 API 확장 (하위 호환)

| API | 현재 | 변경 | 호환성 |
|-----|------|------|:------:|
| `POST /encounter/:id/sign` | body 없음 | body에 `blockchainSignature?` 추가 (옵션) | ✅ |
| `PATCH /consent/:id/sign` | `{ patientSignedBy }` | `blockchainSignature?` 추가 (옵션) | ✅ |
| `POST /discharge-summary/:admissionId/sign` | `{ }` | `blockchainSignature?` 추가 | ✅ |
| `POST /pathology/reports/:id/sign` | `{ }` | `blockchainSignature?` 추가 | ✅ |
| `POST /lab/worksheet/:id/sign` | `{ }` | `blockchainSignature?` 추가 | ✅ |
| `POST /pharmacy/dispense/:id/verify` | `{ }` | `blockchainSignature?` 추가 + `verifiedBy` | ✅ |

**패턴**: 모든 서명 API에 동일한 옵션 파라미터 추가

```typescript
interface BlockchainSignatureParam {
  certificateId: string;
  signatureValue: string;
  signatureAlgorithm: string;
  documentHash: string;
}
```

→ 파라미터가 있으면 블록체인 서명 병행, 없으면 기존 방식만

### 6.2 신규 API

| API | 용도 |
|-----|------|
| `GET /api/v1/document-sign/status/:documentType/:documentId` | 특정 문서의 서명 상태 (배지용) |
| `GET /api/v1/document-sign/pdf-footer/:documentType/:documentId` | PDF 서명 푸터 데이터 (서명자+해시+QR) |

---

## 7. 스키마 변경 (최소)

```prisma
// Encounter 모델에 signedBy 추가
model Encounter {
  // 기존 필드...
  signedBy    String?  @map("signed_by") @db.Uuid  // ← 추가
}

// Dispensing 모델에 검수자 추가
model Dispensing {
  // 기존 필드...
  verifiedBy  String?  @map("verified_by") @db.Uuid  // ← 추가
  verifiedAt  DateTime? @map("verified_at") @db.Timestamptz() // ← 추가
}
```

> 나머지 모델(DischargeSummary, PathologyReport, LabWorksheet, Certificate)은 이미 `signedBy` UUID 필드를 가지고 있으므로 스키마 변경 불필요.

---

## 8. 프론트엔드 변경 지점

### 8.1 서명 버튼 교체

| 파일 | 현재 | 변경 |
|------|------|------|
| `encounter/new/page.tsx` | `handleSignAndBill()` → API 직접 호출 | SmartSignButton 사용 |
| `consent/page.tsx` | `prompt()` → 텍스트 이름 | SmartSignButton + 다중서명 |
| `patients/[id]/components/ConsentTab.tsx` | 동일 | SmartSignButton |
| `pharmacy/page.tsx` | 상태 변경 버튼 | SmartSignButton (약사 검수) |
| `pathology/page.tsx` | 서명 버튼 | SmartSignButton |
| `lab/components/WorksheetTab.tsx` | 서명 버튼 | SmartSignButton |
| `discharge-summary/page.tsx` | 서명 버튼 | SmartSignButton |

### 8.2 PDF 페이지 수정

| 파일 | 변경 |
|------|------|
| `print/consent/[id]/page.tsx` | SignedDocumentFooter 추가 |
| `print/diagnosis/[encounterId]/page.tsx` | SignedDocumentFooter 추가 |
| `print/prescription/[encounterId]/page.tsx` | SignedDocumentFooter 추가 |
| `print/opinion/[encounterId]/page.tsx` | SignedDocumentFooter 추가 |
| `print/receipt/[billingId]/page.tsx` | SignedDocumentFooter 추가 |

### 8.3 환자 포털 변경

| 파일 | 변경 |
|------|------|
| `portal/page.tsx` 문진/동의 탭 | 동의서 전자서명 버튼 추가 (환자 인증서 사용) |
| `portal/page.tsx` 서류 탭 | 발급문서 수령 확인 서명 |

---

## 9. 구현 단계

### Phase 1: Core (1주) — RED 항목

| 작업 | 내용 |
|------|------|
| SmartSignButton 컴포넌트 | 인증서 유무에 따른 분기 |
| Encounter 서명 통합 | signedBy 추가 + DocumentSignature 연동 |
| ConsentForm 서명 통합 | prompt() 제거 → SignatureModal + 다중서명 |
| Pharmacy 검수 통합 | verifiedBy/At 추가 + 약사 서명 |
| Prescription 서명 | 처방 확정 시 서명 |

### Phase 2: Extension (1주) — YELLOW 항목

| 작업 | 내용 |
|------|------|
| DischargeSummary 통합 | 기존 sign + DocumentSignature |
| PathologyReport 통합 | 판독 서명 + DocumentSignature |
| LabWorksheet 통합 | 검사 서명 + DocumentSignature |
| Certificate 통합 | 발급 서명 + 환자 수령확인 |

### Phase 3: PDF + Portal (1주) — GREEN 항목

| 작업 | 내용 |
|------|------|
| SignedDocumentFooter | PDF 서명 마크 + QR 코드 |
| 5개 PDF 페이지 수정 | 서명 푸터 삽입 |
| 환자 포털 동의서 | 전자서명 프로세스 |
| 환자 수령확인 서명 | 진단서/소견서 수령 시 |

---

## 10. 마이그레이션 전략

### 10.1 기존 데이터 처리

```
기존 서명 데이터:
  signedBy: 'user-uuid-123'
  signedAt: '2026-05-15T10:30:00Z'

→ 마이그레이션 하지 않음 (기존 유지)
→ 신규 서명부터 DocumentSignature 병행 생성
→ 검증 시: DocumentSignature 있으면 블록체인 검증, 없으면 기존 방식으로 표시
```

### 10.2 점진적 전환 전략

```
Phase 1 (즉시):
  - 전자인증서 설정한 사용자 → 블록체인 서명
  - 미설정 사용자 → 기존 방식 (signedBy/signedAt만)
  - 두 방식 공존

Phase 2 (3개월 후):
  - 전자인증서 설정 권장 안내 강화
  - 미설정 사용자: 서명 시 "인증서 설정 안내" 팝업

Phase 3 (6개월 후):
  - 의사/약사: 전자인증서 필수화 검토
  - 간호사: 권장 유지
  - 환자: 선택적
```

---

## 11. 성공 기준

| 지표 | Phase 1 (1개월) | Phase 2 (3개월) | Phase 3 (6개월) |
|------|:---:|:---:|:---:|
| 진료 서명 블록체인 비율 | 30% | 60% | 90% |
| 동의서 전자서명 비율 | 20% | 50% | 80% |
| 약국 검수 서명 비율 | 40% | 70% | 95% |
| PDF 서명 마크 적용률 | 100% | 100% | 100% |
| 전자인증서 발급률 (의사) | 50% | 80% | 95% |
| 전자인증서 발급률 (간호사) | 20% | 50% | 70% |

---

## 12. 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 의료인 PIN 입력 부담 | 서명 속도 저하 | 세션 내 PIN 캐시 (5분), 빈번한 서명은 자동 서명 옵션 |
| 기존 코드 호환성 파손 | 시스템 장애 | 블록체인 서명은 옵션 파라미터, 기존 로직 변경 없음 |
| 환자 포털 전자서명 채택률 | 낮은 활용 | 원내 태블릿 대안 제공, 터치 서명 fallback |
| PDF 렌더링 성능 | QR 생성 지연 | QR은 서버에서 사전 생성, 캐시 |

---

## 13. 예상 작업량

| 구분 | 수량 |
|------|:----:|
| 스키마 변경 | 2개 필드 (Encounter.signedBy, Dispensing.verifiedBy/At) |
| 백엔드 API 수정 | 7개 기존 API 확장 + 2개 신규 |
| 프론트 컴포넌트 | 3개 신규 (SmartSignButton, SignedDocumentFooter, SignatureStatusIndicator) |
| 프론트 페이지 수정 | 7개 서명 버튼 교체 + 5개 PDF 수정 + 2개 포털 |
| 테스트 | 기존 서명 테스트 확장 + 통합 테스트 |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-05-20 | 초안 — 9개 통합 지점 분석 + 이중 서명 패턴 + 구현 계획 | PM |
