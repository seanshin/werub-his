# 오더 연동 종합 기획서 — 처방→오더→실행→결과→PACS

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/src/modules/pacs-proxy/pacs-webhook.controller.ts · apps/api/src/modules/integration/integration-auth.service.ts:57 · 잔여: 없음

> 작성일: 2026-05-20 | 수정일: 2026-05-20 | 상태: 기획 완료 (검토 반영)

## 1. 현재 상태

### 1.1 오더 흐름 (현재)

```
[의사: 처방 생성]
    ↓ Prescription + Order DB 저장
    ↓ 오더 상태: ORDERED
    
[각 파트: 수동 확인]
    ↓ 영상실/검사실/약국 대기열 페이지에서 오더 확인
    ↓ 오더 접수: RECEIVED
    ↓ 실행: IN_PROGRESS
    ↓ 완료: COMPLETED

[결과 반환]
    ↓ 검사실: LabResult 저장
    ↓ 영상실: ImagingResult 저장 + 판독
    ↓ 약국: Dispensing 완료
```

### 1.2 PACS 연동 (현재)

```
HIS ──→ PACS
  ├── pacs/studies (Study 조회)
  ├── pacs/worklist (워크리스트)
  ├── pacs/orders (오더 생성/상태)
  ├── pacs/reports (판독 보고서)
  ├── pacs/his/* (11개 HIS 연동 API — 방금 추가)
  └── pacs/ai/* (AI 추론)

PACS ──→ HIS
  └── ❌ 없음 (콜백/웹훅 미구현)
```

### 1.3 문제점

| # | 문제 | 영향 |
|---|------|------|
| P-1 | **처방→PACS 워크리스트 자동 등록 없음** | 방사선사가 HIS 오더와 PACS 워크리스트를 별도 확인 |
| P-2 | **PACS→HIS 콜백 없음** | 촬영/판독 완료되어도 HIS 오더 상태가 수동 업데이트 |
| P-3 | **영상실 UI에서 HIS API 미호출** | 재촬영/추가촬영/긴급판독 버튼이 없음 |
| P-4 | **처방→검사실 자동 접수 없음** | 검사실 직원이 대기열에서 수동 접수 |
| P-5 | **결과→의사 알림 없음** | 검사/영상 결과 나와도 의사에게 알림 없음 |
| P-6 | **오더 전체 추적 불가** | 환자 차트에서 오더 진행 상태를 한눈에 볼 수 없음 |

---

## 2. 목표 흐름

### 2.1 영상 오더 (처방→PACS→결과)

```
[의사: 영상 처방] ← encounter/new 영상 탭
    ↓ (자동)
┌──────────────────────────────────────────────────────┐
│ 1. Prescription 생성 (type=IMAGING)                  │
│ 2. Order 생성 (department=IMAGING, status=ORDERED)   │
│ 3. ImagingResult 생성 (status=ORDERED)               │
│ 4. PACS 워크리스트 자동 등록                          │
│    → POST /api/v1/pacs/worklist                      │
│    → POST /api/v1/pacs/orders (accession number)     │
│ 5. 임상 정보 자동 전송                               │
│    → POST /api/v1/pacs/his/clinical-info             │
│ 6. 여정 이벤트: IMAGING_ORDERED                      │
└──────────────────────────────────────────────────────┘
    ↓
[영상실: 대기열 확인] ← /imaging 촬영 대기 탭
    ↓ [접수] 버튼
    Order: ORDERED → RECEIVED
    ↓ [촬영 시작] 버튼
    Order: RECEIVED → IN_PROGRESS
    ImagingResult: ORDERED → ACQUIRED
    ↓ 촬영 완료
    ImagingResult: ACQUIRED → COMPLETED
    ↓
[PACS: 영상 수신] ← Orthanc DICOM Store
    ↓ (웹훅 콜백)
┌──────────────────────────────────────────────────────┐
│ PACS → HIS 웹훅:                                    │
│ POST /api/v1/pacs/webhook/study-received             │
│ → ImagingResult.acquiredAt 자동 업데이트             │
│ → Order status → IN_PROGRESS                        │
└──────────────────────────────────────────────────────┘
    ↓
[영상의학과: 판독] ← /imaging 판독 탭 또는 PACS 뷰어
    ↓ 판독 완료
┌──────────────────────────────────────────────────────┐
│ PACS → HIS 웹훅:                                    │
│ POST /api/v1/pacs/webhook/report-completed           │
│ → ImagingResult.finding/impression 저장              │
│ → Order status → COMPLETED                          │
│ → 처방의에게 알림: "영상 판독 완료"                  │
│ → 여정 이벤트: IMAGING_REPORTED                     │
└──────────────────────────────────────────────────────┘
    ↓
[의사: 결과 확인] ← 환자 차트 영상 탭 + PACS 뷰어 링크
```

### 2.2 검사 오더 (처방→검사실→결과)

```
[의사: 검사 처방] ← encounter/new 검사 탭
    ↓ (자동)
    Prescription + Order (LAB) + LabResult 생성
    ↓
[검사실: 대기열] ← /lab 검사 대기 탭
    ↓ [채혈/접수] → RECEIVED
    ↓ [검사 시작] → IN_PROGRESS
    ↓ [결과 입력] → COMPLETED
    ↓ (자동)
    → 처방의에게 알림: "검사 결과 완료"
    → 이상치 있으면 CRITICAL 알림
    → 여정 이벤트: LAB_COMPLETED
    ↓
[의사: 결과 확인] ← 환자 차트 검사 탭
```

### 2.3 약 처방 (처방→약국→불출)

```
[의사: 약 처방] ← encounter/new 약 탭
    ↓ (자동)
    Prescription + Order (PHARMACY) 생성
    ↓ DUR 체크
    ↓
[약국: 대기열] ← /pharmacy 조제 대기 탭
    ↓ [조제 시작] → DISPENSING
    ↓ [검수 완료] → VERIFIED
    ↓ [불출] → COMPLETED
    ↓ (자동)
    → 환자 호출 (수납 후 약국)
    → 여정 이벤트: PHARMACY_DISPENSED
```

---

## 3. 구현 계획

### Phase 1: 처방→PACS/검사실 자동 연동 (핵심)

> **의존성 설계**: PrescriptionService에서 PacsProxyService를 직접 주입하면 순환 의존 발생.
> BillingListener 패턴과 동일하게 **EventEmitter2 이벤트 기반**으로 구현.

**1-1. 처방 생성 시 이벤트 발행:**

```typescript
// prescription.service.ts — create() 메서드 마지막에 추가
this.eventEmitter.emit('order.created', {
  orderId: order.id,
  type: dto.type, // MEDICATION | LAB | IMAGING
  patientId: encounter.patientId,
  patientMrn: encounter.patient.mrn,
  patientName: `${encounter.patient.familyName}${encounter.patient.givenName}`,
  procedureCodeId: dto.procedureCodeId,
  priority: dto.priority ?? 'ROUTINE',
  notes: dto.notes,
  encounterId,
  userId,
});
```

**1-2. PACS 연동 리스너 (새 파일):**

```typescript
// pacs-proxy/pacs-integration.listener.ts
@Injectable()
export class PacsIntegrationListener {
  @OnEvent('order.created')
  async handleOrderCreated(payload) {
    if (payload.type !== 'IMAGING') return;
    
    // Accession Number 생성 (DICOM 호환)
    const accNo = `ACC-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${payload.orderId.slice(0,8)}`;
    
    // 1. PACS 워크리스트 등록
    await this.pacsProxy.createWorklistItem({
      patient_id: payload.patientMrn,
      patient_name: payload.patientName,
      accession_number: accNo,
      modality: detectModality(payload.procedureCode),
      scheduled_date: new Date().toISOString(),
      referring_physician: payload.userId,
      priority: payload.priority === 'STAT' ? 'STAT' : 'ROUTINE',
    });
    
    // 2. 임상 정보 전송
    await this.pacsProxy.clinicalInfo({ accessionNumber: accNo, ... });
    
    // 3. Order에 accession number 저장
    await this.prisma.order.update({
      where: { id: payload.orderId },
      data: { result: { accessionNumber: accNo } },
    });
  }
}
```

> **ImagingResult 생성 시점**: 기존대로 영상실 acquire() 시점에 생성 유지.
> 처방 생성 시에는 Order만 생성, ImagingResult는 촬영 시작 시 생성.

> **검사실/약국도 동일 이벤트 활용**: `order.created` 이벤트로 검사실/약국 대기열에 알림 발행 가능.

**1-3. Accession Number 형식:**

```
ACC-20260520-a1fe9ef0  (ACC-날짜-OrderID 앞8자리)
```

> UUID를 DICOM accession으로 직접 사용하면 호환성 문제.
> PACS에서 Study를 찾을 때 accession number로 매칭.

### Phase 2: PACS→HIS 웹훅 수신

**새 엔드포인트:**

| # | Method | Endpoint | 설명 |
|---|--------|----------|------|
| 1 | POST | `/api/v1/pacs/webhook/study-received` | 영상 수신 알림 (촬영 완료) |
| 2 | POST | `/api/v1/pacs/webhook/report-completed` | 판독 완료 알림 |
| 3 | POST | `/api/v1/pacs/webhook/study-updated` | Study 상태 변경 알림 |

**웹훅 인증**: OpenPACS에서 `X-Webhook-Secret` 헤더로 전송, HIS에서 환경변수 `PACS_WEBHOOK_SECRET`과 비교 검증.

```typescript
// 웹훅 수신 시:
@Post('webhook/study-received')
async onStudyReceived(
  @Headers('x-webhook-secret') secret: string,
  @Body() body: { accession_number: string; study_uid: string; modality: string }
) {
  this.validateWebhookSecret(secret); // 인증 검증
  // 1. accession_number로 Order 조회
  // 2. ImagingResult가 있으면 acquiredAt 업데이트
  // 3. Order 상태 → IN_PROGRESS
  // 4. 여정 이벤트: IMAGING_ACQUIRED
}

@Post('webhook/report-completed')
async onReportCompleted(
  @Headers('x-webhook-secret') secret: string,
  @Body() body: { accession_number: string; findings: string; impression: string; radiologist: string }
) {
  this.validateWebhookSecret(secret);
  // 1. ImagingResult 업데이트 (finding, impression, reportedAt)
  // 2. Order 상태 → COMPLETED
  // 3. 처방의에게 알림 (EventEmitter2: imaging.report_completed)
  // 4. 여정 이벤트: IMAGING_REPORTED
}
```

**오더 취소 시 PACS 동기화:**

```typescript
// order.service.ts — cancel() 메서드에 추가
this.eventEmitter.emit('order.cancelled', {
  orderId, department, accessionNumber
});

// PacsIntegrationListener:
@OnEvent('order.cancelled')
async handleOrderCancelled(payload) {
  if (payload.department !== 'IMAGING') return;
  await this.pacsProxy.cancelOrder({
    accessionNumber: payload.accessionNumber,
    reason: 'HIS에서 오더 취소',
  });
}
```

### Phase 3: 영상실 UI에 HIS API 버튼 추가

**영상실 페이지 (`/imaging`) 각 오더에 액션 버튼:**

```
┌─ 촬영 대기 ────────────────────────────────────────┐
│  복부 초음파 — 강태윤52 (HR-20260506-0328)          │
│  상태: 판독 대기  │  우선순위: 일반                  │
│                                                      │
│  [PACS 뷰어]  [긴급 판독 요청]  [추가 촬영]          │
│  [재촬영 요청]  [검사 취소]  [임상 정보 전송]         │
└──────────────────────────────────────────────────────┘
```

### Phase 4: 결과 알림 시스템

> **Notification 모델**: 현재 스키마에 없음 → 신규 추가 필요.
> 향후 WebSocket 실시간 알림의 기반이 됨.

**4-1. Notification 모델:**

```prisma
model Notification {
  id         String    @id @default(uuid()) @db.Uuid
  userId     String    @map("user_id") @db.Uuid
  type       String    @db.VarChar(30)
  // LAB_RESULT | IMAGING_REPORT | ORDER_STATUS | CRITICAL_VALUE | SYSTEM
  title      String    @db.VarChar(200)
  message    String    @db.Text
  severity   String    @default("INFO") @db.VarChar(20)
  // INFO | WARNING | CRITICAL
  refType    String?   @map("ref_type") @db.VarChar(30)
  refId      String?   @map("ref_id") @db.Uuid
  isRead     Boolean   @default(false) @map("is_read")
  readAt     DateTime? @map("read_at") @db.Timestamptz()
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  user       User      @relation(fields: [userId], references: [id])

  @@index([userId, isRead])
  @@index([createdAt])
  @@map("notifications")
}
```

**4-2. EventEmitter2 기반 알림 이벤트:**

```
imaging.report_completed
  → Notification 생성 (userId=처방의, type=IMAGING_REPORT)
  → "복부 초음파 판독 완료 — 소견: 정상"

lab.result_completed
  → Notification 생성 (type=LAB_RESULT)
  → 이상치 있으면 severity=CRITICAL

lab.result_critical
  → Notification 생성 (severity=CRITICAL)
  → 패닉 값 알림
```

**4-3. 검사실 패닉 값 (Critical Values):**

| 검사 | 패닉 하한 | 패닉 상한 | 단위 |
|------|:--------:|:--------:|------|
| K+ | <2.5 | >6.5 | mEq/L |
| Na+ | <120 | >160 | mEq/L |
| Glucose | <40 | >500 | mg/dL |
| Hb | <7.0 | - | g/dL |
| PLT | <20,000 | - | /μL |
| WBC | <2,000 | >30,000 | /μL |
| Cr | - | >10.0 | mg/dL |
| Troponin-I | - | >2.0 | ng/mL |
| INR | - | >5.0 | - |

> 패닉 값 감지 시 처방의 + 담당 간호사에게 동시 알림.

### Phase 5: 오더 추적 UI (환자 차트)

**환자 차트에 오더 추적 탭 또는 개요에 오더 현황 카드:**

```
┌─ 진행 중인 오더 ──────────────────────────────────┐
│                                                    │
│  📷 Chest X-ray   ORDERED → [접수] → 촬영 → 판독 │
│  🩸 CBC + LFT     ORDERED → [접수] → 진행 → 완료 │
│  💊 아모디핀 5mg   ORDERED → 조제중 → 검수 → 불출  │
│                                                    │
│  모든 오더 추적 가능 (실시간)                      │
└────────────────────────────────────────────────────┘
```

---

## 4. 신규 API

| # | Method | Endpoint | 설명 | Phase |
|---|--------|----------|------|:-----:|
| 1 | POST | `/api/v1/pacs/webhook/study-received` | 영상 수신 웹훅 (X-Webhook-Secret 인증) | 2 |
| 2 | POST | `/api/v1/pacs/webhook/report-completed` | 판독 완료 웹훅 | 2 |
| 3 | POST | `/api/v1/pacs/webhook/study-updated` | Study 상태 변경 웹훅 | 2 |
| 4 | GET | `/api/v1/orders/patient/:patientId/active` | 환자 진행 중 오더 | 5 |
| 5 | GET | `/api/v1/notifications` | 알림 목록 (userId 기반) | 4 |
| 6 | PATCH | `/api/v1/notifications/:id/read` | 알림 읽음 처리 | 4 |
| 7 | GET | `/api/v1/notifications/unread-count` | 안 읽은 알림 수 | 4 |

### 기존 API 수정

| API | 수정 내용 | Phase |
|-----|----------|:-----:|
| `POST prescriptions` | order.created 이벤트 발행 (EventEmitter2) | 1 |
| `PATCH orders/:id/cancel` | order.cancelled 이벤트 발행 → PACS 취소 동기화 | 1 |
| `POST lab/result/:orderId` | 결과 완료 시 알림 이벤트 + 패닉 값 체크 | 4 |
| `POST imaging/:orderId/report` | 판독 완료 시 알림 이벤트 발행 | 4 |

### 신규 모델

| 모델 | 설명 | Phase |
|------|------|:-----:|
| Notification | 알림 (userId, type, severity, refType/refId, isRead) | 4 |

---

## 5. 구현 우선순위

| Phase | 항목 | 난이도 | 예상 |
|:-----:|------|:------:|:----:|
| 1 | EventEmitter2 이벤트 + PacsIntegrationListener + accession 생성 + 취소 동기화 | 중간 | 4h |
| 2 | PACS→HIS 웹훅 3개 (인증 포함) + Order/ImagingResult 자동 업데이트 | 중간 | 3h |
| 3 | 영상실 UI HIS API 버튼 (재촬영/추가/긴급/취소) + STAT 우선순위 | 낮음 | 2h |
| 4 | Notification 모델 + 알림 API 3개 + 패닉 값 체크 + 알림 패널 UI | 중간 | 4h |
| 5 | 오더 추적 UI (환자 차트 + 대시보드) | 중간 | 3h |

**총 예상: 16시간 (5 Phase)**

---

## 6. Modality 자동 감지

```typescript
function detectModality(procedureCode: string): string {
  if (code.startsWith('HA') || code.includes('CT')) return 'CT';
  if (code.startsWith('HE') || code.includes('MR')) return 'MR';
  if (code.startsWith('HC') || code.includes('초음파')) return 'US';
  if (code.startsWith('G') || code.includes('X-ray')) return 'CR';
  if (code.includes('PET')) return 'PT';
  if (code.includes('핵의학')) return 'NM';
  if (code.includes('유방')) return 'MG';
  return 'OT'; // Other
}
```

---

## 7. 비기능 요구사항

| 항목 | 요구 |
|------|------|
| PACS 연동 실패 시 | 처방은 유지, PACS 등록은 재시도 큐 (향후) |
| 웹훅 인증 | HMAC 서명 또는 API Key 검증 |
| 알림 | 대시보드 알림 패널 + 향후 WebSocket 실시간 |
| 이력 | 모든 PACS 연동 요청/응답 audit 로그 |

---

## 8. 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1 | 2026-05-20 | 초기 기획 — 처방→PACS 자동 + 웹훅 + UI + 알림 + 오더 추적 |
| v2 | 2026-05-20 | 검토 반영 — EventEmitter2 방식, Accession Number 형식, ImagingResult 생성 시점 정정, Notification 모델 추가, 패닉 값 정의, 웹훅 인증(X-Webhook-Secret), 오더 취소 PACS 동기화, STAT 우선순위 |
