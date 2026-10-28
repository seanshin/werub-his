# P0 설계서 — 의무기록 사본(A그룹) 발급 종단 워크플로우

> **Feature**: medical-record-issuance-portal (P0)
> **Version**: 1.0 (Design)
> **Date**: 2026-06-21
> **Status**: Design (구현 전)
> **기획**: [medical-record-issuance-portal.plan.md](../../01-plan/features/medical-record-issuance-portal.plan.md)
> **재사용 근거(코드)**: `DocumentRequest`·`portal.service.requestDocument/updateDocumentStatus`·`document.service.issue/generatePdf`·`req.portalPatientId`·AuditService·Notification

---

## 0. P0 범위 · 전제

**포함**: **본인** 신청 + **A그룹(기록 사본)** 종단 — 포털 신청 UI → 의료진 처리 큐 UI → 본인검증 → 기록 범위 **스냅샷 동결** → `IssuedDocument` 발급 → **한글 PDF(browserless)** → 포털 다운로드(+진위 QR) → 상태 알림.

**P0 제외(후속)**: 대리인 자격 검증(P1) · 진단서/소견서 작성·서명(P2) · 수수료 실결제·우편/팩스 물류(P3). P0 수령 = **포털 다운로드 + 방문 표시**만, 수수료 = 계산·표시만(수납은 방문).

**A그룹 P0 대상 recordTypes**: 진료기록부(Encounter SOAP)·초진기록지·경과기록(ProgressNote)·간호기록(NursingNote)·검사결과지(LabResult)·퇴원요약(DischargeSummary)·처방전 사본. (영상판독지는 P0 텍스트 리포트만, DICOM 제외)

---

## 1. 아키텍처 · 재사용 매핑

```
[환자 포털] 신청폼 ─POST /portal/documents/request(확장)─┐
                                                         ▼
                                            DocumentRequest(REQUESTED)
                                                         │ emit document.requested
                                                         ▼
[의료진 워크스테이션] 큐 ◄─GET /staff/document-requests (SSE)
   │ 본인검증 확인 → 기록범위 선택
   ├─POST /staff/document-requests/:id/snapshot ─► IssuanceArtifact(snapshotJson 동결)
   ├─POST /staff/document-requests/:id/issue    ─► document.service.issue() ─► IssuedDocument(WRB-…)
   │                                                                       │ emit document.ready
   ▼                                                                       ▼
status READY ───────────────────────────────────► [환자] 알림 → 포털 다운로드
[공개] GET /verify/document/:issueNo (진위·PHI 미노출, 기존 재사용)
```

| 레이어 | 재사용 | 신규 |
|--------|--------|------|
| 요청/상태 | `DocumentRequest`·requestDocument·updateDocumentStatus·getDocumentRequests | status 세분·필드 확장·snapshot/issue/download 메서드 |
| 발급 | `document.service.issue/generatePdf/verify`·`IssuedDocument` | print 라우트(한글), recordType별 렌더 데이터 |
| 원천조회 | medical-record-search·Encounter/Lab/Nursing/Discharge | snapshot 빌더 |
| 인증 | `req.portalPatientId`·PortalOrPatientGuard·RolesGuard | 다운로드 단기토큰 |
| 부가 | AuditService·Notification(SSE/FCM)·portal-i18n | document.* 이벤트·리스너·워크스테이션 SSE |

---

## 2. 데이터 모델 (최소 확장 + 신규)

> db push 차단(드리프트) → **manual SQL** `medical-record-issuance-p0.sql` 로 서버 적용 + schema.prisma 동기화. 전부 nullable/IF NOT EXISTS(무중단).

### 2.1 `DocumentRequest` 확장 (컬럼 추가)
```
requestor_account_id  UUID NULL      -- 신청 계정(본인=환자 계정). 감사/대리(P1) 대비
issued_document_id    VARCHAR(60) NULL-- 발급 결과 IssuedDocument.issueNo (실제 issueNo=VARCHAR(60), C-3)
record_types          JSONB NULL     -- A그룹 요청 기록유형 배열
sla_due_at            TIMESTAMPTZ NULL  -- P0=컬럼만(표시), 만료 알림 로직은 P1
```
status 값 확장(문자열, 하위호환): `REQUESTED → IN_REVIEW → ISSUED → READY → DELIVERED | REJECTED`
(기존 PROCESSING=IN_REVIEW 매핑, 신규 IN_REVIEW/ISSUED 추가)

### 2.2 신규 `IssuanceArtifact` (발급 산출물·스냅샷 동결)
```
id                UUID PK
request_id        UUID FK → document_requests(id)
record_type       VARCHAR(30)   -- ENCOUNTER|PROGRESS|NURSING|LAB|DISCHARGE|PRESCRIPTION
source_ids        JSONB         -- 동결 원천 PK 목록
snapshot_json     JSONB         -- 발급 시점 SIGNED 데이터 동결(원본 정정돼도 불변)
issued_document_id VARCHAR(60) NULL  -- IssuedDocument.issueNo (C-3)
page_count        INT NULL
created_by        UUID
created_at        TIMESTAMPTZ default now()
@@index(request_id)
```

---

## 3. 상태 전이 (P0)

| from | action(주체) | to | 가드 |
|------|------|------|------|
| REQUESTED | verify+snapshot(원무) | IN_REVIEW | 본인검증 OK·기록 존재 |
| REQUESTED | reject(원무) | REJECTED | 사유 필수(제한 카테고리) |
| IN_REVIEW | issue(원무) | ISSUED→READY | 스냅샷 존재·IssuedDocument 발급 성공 |
| READY | deliver(원무/환자 다운로드) | DELIVERED | 본인. `completedAt` 기록 |

멱등: issue 재호출 시 기존 issued_document_id 있으면 반환(중복 발급 차단). ISSUED는 발급 직후 즉시 READY로 전이(별도 대기 없음 — 포털 다운로드 가능 시점). 발급대장(GET issuance-ledger)은 P0에 **최소 조회(DocumentRequest 필터)** 포함, 통계/리포트 고도화는 P1.

---

## 4. API 설계

### 4.1 포털(환자) — PortalOrPatientGuard
```
POST /api/v1/portal/documents/request        (확장: recordTypes[] 추가)
  body: { type:'MEDICAL_RECORD', recordTypes:string[], purpose, periodFrom?, periodTo?,
          deliveryMethod:'VISIT'|'PORTAL', copies, note }
  → DocumentRequest(REQUESTED) 생성, fee 계산, emit document.requested
GET  /api/v1/portal/documents/requests         (본인 목록·상태 타임라인)
GET  /api/v1/portal/documents/requests/:id     (본인 상세)
GET  /api/v1/portal/documents/:id/download      (READY·본인검증 → 단기 다운로드 토큰 → PDF 스트림)
```

### 4.2 의료진 — RolesGuard(ADMIN/NURSE; 원무)
```
GET  /api/v1/staff/document-requests?status=&type=        (큐·필터·통계)
GET  /api/v1/staff/document-requests/stream               (SSE 실시간)
GET  /api/v1/staff/document-requests/:id                  (상세+환자검증정보+가능 기록 목록)
POST /api/v1/staff/document-requests/:id/snapshot         (recordTypes·기간 → SIGNED 기록 동결 IssuanceArtifact 생성, status IN_REVIEW)
POST /api/v1/staff/document-requests/:id/issue            (IssuedDocument 발급+PDF, status READY, emit document.ready)
POST /api/v1/staff/document-requests/:id/reject           (사유)
GET  /api/v1/staff/issuance-ledger?from=&to=&type=        (발급대장)
```

### 4.3 공개 (재사용)
```
GET /api/v1/documents/verify/:issueNo   (진위, PHI 미노출)
```

---

## 5. 스냅샷 동결 설계

`POST .../snapshot` 시 `record_types`·기간으로 환자 원천을 조회해 `snapshot_json`에 동결. **모델별 sign 상태 컬럼이 다르므로 필터를 모델 실제 스키마에 맞춤**(C-4):
- ENCOUNTER: `status='SIGNED'`만(AMENDED 제외 또는 "정정됨" 표기). SOAP+진단+처방 요약.
- NURSING(NursingNote): `status='SIGNED'`만, 기간 필터.
- **PROGRESS(ProgressNote): status 컬럼 없음** → admission/기간 범위로 전체 포함(서명 워크플로우 없는 기록임을 발급본에 명시). 향후 ProgressNote 서명 도입 시 필터 추가.
- LAB(LabResult): 확정(verified/RELEASED) 결과만.
- DISCHARGE(DischargeSummary): `status='SIGNED'`만.
- PRESCRIPTION: 해당 encounter의 ACTIVE 처방(CANCELLED 제외).

원칙: **발급 시점 동결 → 이후 원본 정정(AMENDED)돼도 발급본 불변**(법적 증빙). snapshot은 `document.service.issue`의 `snapshot`으로도 전달(이중 동결: Artifact + IssuedDocument.snapshotJson 해시).
멱등: `issue`는 `DocumentRequest.issued_document_id` 존재 시 기존 발급 반환(IssuanceService.issue 진입부 체크).

---

## 6. PDF 생성 (한글)

- **browserless 경로 사용**(`document.service.generatePdf` 재사용) — pdf-lib(한글 미지원) 회피.
- **기존 고정 인쇄 라우트 재사용**(C-1): `generatePdf`는 `{FRONTEND_URL}/print/{issueNo}?rt=…`(document.service.ts:98)를 PDF화. **신규 경로 만들지 않고** 기존 `apps/web/src/app/print/[issueNo]/page.tsx` 의 `documentType` 분기를 활용.
- **신규 분기·렌더러 추가**(C-2): 기존 분기는 LAB_REPORT/ENCOUNTER_RECORD/PRESCRIPTION/CERTIFICATE 4종(page.tsx:36-39). 의무기록 사본은 **단일 documentType `MEDICAL_RECORD_COPY`** 로 발급(IssuedDocument.documentType), snapshot에 선택된 record_types를 **번들**로 담고, 신규 컴포넌트 `MedicalRecordCopyDoc`가 섹션별(진료/경과/간호/검사/퇴원/처방) 렌더. → 다중 기록을 1건 발급으로 묶어 IssuedDocument 1개·발급번호 1개.
- 머리말: 병원정보·발급번호(WRB-MEDICAL_RECORD_COPY-…)·발급일·진위확인 QR(verify URL)·"사본" 워터마크. 한글은 기존 print 페이지의 웹폰트(검증된 자산)로 정상 렌더.

---

## 7. 본인검증 · 권한 (P0)

- 신청·조회·다운로드: `req.portalPatientId` == 대상 환자 (본인 한정, 대리는 P1 게이트).
- 다운로드: READY 상태 + 본인 → **단기 다운로드 토큰**(HMAC, 2~5분) 발급 후 스트림(직접 PDF URL 노출 방지).
- 의료진: RolesGuard ADMIN/NURSE. 발급/반려는 감사 기록(AuditService) + 발급대장.
- 전 단계 AuditService.safeLog(resourceType=DocumentRequest/IssuedDocument).

---

## 8. 알림 (이벤트)

- `document.requested` → 의료진 워크스테이션 SSE 큐 갱신 + (선택)원무 알림
- `document.ready` → 환자 Notification(SSE/FCM) + 이메일(가능 시) "서류 발급 완료 — 포털 다운로드"
- `document.rejected` → 환자 알림(사유)

---

## 9. 프론트엔드

### 9.1 환자 포털 — 서류 발급 신청
- `apps/web/src/app/portal/_services/DocumentRequestForm.tsx`(신규) + 신청내역/상태 타임라인.
- 유형=의무기록 사본 선택 → recordTypes 멀티선택·기간·용도·부수·수령(포털/방문)·메모. 다국어(portal-i18n).
- 완료(READY) 시 다운로드 버튼(PDF) + 진위 QR.

### 9.2 의료진 워크스테이션 — 서류 발급
- `apps/web/src/app/(main)/workstation/documents/page.tsx`(신규) — **동의서 워크스테이션 패턴 재사용**(큐 폴링 8s + SSE, 상태/유형 필터, 통계, 상세 패널).
- 상세: 환자·본인검증 표시 → 기록 범위 선택 → "스냅샷 생성" → 미리보기 → "발급" / "반려(사유)".
- 사이드바 메뉴 추가(워크스테이션 그룹, roles ADMIN/NURSE).

---

## 10. 구현 작업 목록

**DDL**: manual SQL(DocumentRequest 4컬럼 + IssuanceArtifact + 인덱스) + schema.prisma 동기화.
**BE**:
- portal.service.requestDocument 확장(recordTypes), getDocumentRequest 다운로드 토큰, download 스트림.
- 신규 `IssuanceService`(snapshot 빌더·issue·reject·ledger) + `staff-document.controller`.
- snapshot 빌더(record_type별 SIGNED 조회), document.service.issue 연계.
- 이벤트(document.requested/ready/rejected) + notification 리스너 + 워크스테이션 SSE.
**FE**:
- 포털 DocumentRequestForm + 상태 타임라인 + 다운로드.
- 워크스테이션 documents 페이지 + 사이드바 메뉴.
- 기존 `print/[issueNo]/page.tsx` 에 `MEDICAL_RECORD_COPY` 분기 + `MedicalRecordCopyDoc`(섹션 렌더러) 추가(신규 라우트 아님, C-1/C-2).
**테스트**:
- snapshot 동결(원본 AMENDED 후 발급본 불변), issue 멱등, 본인 외 다운로드 차단(403), 상태 전이, reject 사유 필수, 진위검증.

---

## 11. 잔여 · 결정
- 영상판독지/DICOM·대리(P1)·진단서(P2)·수수료 실결제·우편(P3) 제외 확정.
- AMENDED 기록 포함/표기 정책(법무): 발급 시점 SIGNED만 동결, 정정 시 재발급 안내.
- 제3자(공동진료) 정보 비식별 범위 — 법무 확인. **P0 기본**: 환자 본인 기록만 동결(타 환자 식별정보 포함 필드 없음 가정), 협진의/작성자 의료진명은 표기.
- 다운로드 토큰 TTL(2~5분)·재발급 횟수 제한.

> **design-validator 반영(v1.1)**: C-1(고정 print 라우트 재사용), C-2(`MEDICAL_RECORD_COPY` 단일 타입+섹션 렌더러), C-3(issued_document_id VARCHAR(60)), C-4(ProgressNote status 부재→범위 포함) 수정 완료.
