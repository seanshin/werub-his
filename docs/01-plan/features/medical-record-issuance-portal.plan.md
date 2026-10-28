# 환자요청 의무기록·증명서 발급 워크플로우 기획서 (v2)

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/src/modules/medical-record-issuance/fee-rules.ts · apps/api/src/modules/medical-record-issuance/issuance.service.ts:707 · 잔여: 없음

> **Feature**: medical-record-issuance-portal
> **Version**: 1.0 (Plan)
> **Date**: 2026-06-21
> **Status**: Plan (설계 전 검토 대기)
> **선행/연계**: [medical-record-copy.plan.md](./medical-record-copy.plan.md)(v1 의료진 직접발급) · [document-fidelity-ux.plan.md](./document-fidelity-ux.plan.md)(IssuedDocument·진위·PDF)
> **근거 법령**: 의료법 §21(기록 열람·사본 교부), §21의2(진료기록 송부), §17(진단서·증명서 교부), 시행규칙 §13의3(수수료), 개인정보보호법

---

## 0. 배경 · 목적

의료법 §21은 **환자 본인이 진료기록의 열람·사본 교부를 요청하면 의료기관은 정당한 사유 없이 거부할 수 없다**고 규정한다(의무 제공). 현재 시스템은 의료진이 직접 발급하는 단순 사본 기능(v1)과 발급 인프라(IssuedDocument·PDF·진위)는 있으나, **환자 포털에서 요청 → 의료진이 받아 작성·검토·제공하는 종단 워크플로우와 본인·대리인 자격 검증이 없다.**

**목적**: 환자(또는 적법 대리인)가 포털/모바일에서 의무기록 사본·초진기록지·진단서·소견서 등을 요청하면, 의료진 워크스테이션으로 라우팅되어 **작성·검토·승인·서명**을 거쳐 **정리된 형태로 제공(다운로드/방문/우편/팩스)** 되고, 전 과정이 **발급대장·감사·진위검증**으로 추적되는 법규 준수 기능을 완성한다.

---

## 1. 법적 요건 (설계 시 법무 최종 확인)

| 항목 | 요건 | 시스템 반영 |
|------|------|------------|
| 사본 교부 의무(§21) | 본인 요청 시 정당한 사유 없이 거부 불가 | 거부(REJECTED)는 **사유 필수**, 사유 카테고리 제한 |
| 청구권자 | ①본인 ②법정대리인 ③동의받은 대리인 ④유족 등(별도 요건) | 본인/대리인 **자격 강제 검증**(§3.2) |
| 대리 청구 구비 | 위임장·신분증·관계증명(가족관계·후견 등)·환자 동의 | 첨부·승인 게이트 |
| 진단서·증명서(§17) | **직접 진찰·검안한 의사**가 작성·교부 | 작성 의사 = 진료 담당의 검증 + 전자서명 강제 |
| 수수료(시행규칙 §13의3) | 의료기관이 정함(상한 가이드 존재) | 유형별 수수료 규칙엔진 |
| 처리 기한 | 합리적 기한 내 제공(지연 시 사유) | SLA 타이머·지연 알림 |
| 기록 보존·발급 이력 | 발급 사실 기록(발급대장) | 발급대장 + 감사 + 블록체인 앵커링 |
| 제공 범위 | 요청 범위 내 최소 제공(타인 정보 비식별) | 기간·유형 필터, 제3자 정보 마스킹 검토 |

> ⚠️ 정확한 구비서류·청구권자 범위·수수료 상한은 **법무 검토로 확정**(본 기획은 시스템 구조 제안).

---

## 2. 범위

### 대상 문서 — 2그룹
- **A. 기록 사본(기존 기록 복사·정리)** — 의료진은 *검토·승인*만, 신규 작성 없음
  - 의무기록 사본(진료기록부), 초진기록지, 경과기록, 간호기록, 검사결과지, 영상판독지, 처방전 사본, 입·퇴원 기록, 진료비 영수증/세부내역
- **B. 의사 작성 증명서(작성+서명 필요)** — 의료진이 *작성*
  - 진단서(일반/상해/사망), 소견서, 입원확인서, 통원확인서, 진료확인서

### Out of scope (별도/이연)
- 보험사 직접 전송(§21의2 기관 간 송부)·제증명 EDI — Phase 4+
- 외부 우편 물류사 실연동(초기엔 발송 상태 수기 기록 + 송장번호 저장)
- 수수료 실결제 PG(초기엔 Billing 연계 또는 방문 수납)

---

## 3. 현황 (조사 결과 — 재사용/갭)

### 재사용 자산 (있음)
| 자산 | 위치 | 활용 |
|------|------|------|
| `DocumentRequest` 모델 | schema.prisma | 요청 라이프사이클(REQUESTED→PROCESSING→READY→DELIVERED/REJECTED), type(MEDICAL_RECORD/DIAGNOSIS_CERT/OPINION/RECEIPT/TAX_INVOICE/ADMISSION_CERT), deliveryMethod(VISIT/FAX/MAIL), fee |
| 포털 요청 API | `portal.controller` `POST /portal/documents/request`·`GET /portal/documents/requests[/:id]` | 환자 요청·조회 |
| 의료진 처리 API | `PUT /admin/documents/:id/status`·`GET /admin/documents` | 상태 전환(권한 ADMIN/NURSE) |
| `IssuedDocument` + `document.service` | document 모듈 | 발급번호 채번(동시성)·snapshot 동결·HMAC 해시·진위검증·재발급·headless PDF |
| `medical-record-copy` 모듈 | pdf-generation·verify·fee | 사본 PDF·QR 검증·수수료 |
| 원천 데이터 조회 | `medical-record-search` | Encounter(SOAP)·ProgressNote·NursingNote·DischargeSummary |
| 본인/대리 | PatientGuardian·patient-auth·PortalOrPatientGuard | 보호자 연결·포털 인증 |
| 서명 | document-sign·ConsentForm sign | 진단서 전자서명 통합 |
| 감사·알림·다국어 | AuditService(+앵커링)·Notification(SSE/FCM)·portal-i18n(ko/en/zh/ja) | 추적·알림·다국어 |

### 갭 (신규 구현)
1. **의료진 처리 UI 부재** — API만 있고 워크스테이션/관리자 화면 없음 (요청 큐·검토·작성·승인)
2. **본인·대리인 자격 강제 검증 부재** — PatientGuardian 모델만, 발급 시점 관계·법적근거·유효기간·동의·구비서류 검증 없음
3. **진단서/소견서 "작성+서명" 프로세스 부재** — type만 존재, 의사 작성 폼·담당의 검증·전자서명 강제 없음
4. **발급 시점 스냅샷 자동화 부재** — Encounter SIGNED 상태 자동 동결 미연결(원본 정정돼도 발급본 보존)
5. **한글 PDF** — pdf-lib StandardFonts 한글 미지원 → browserless 경로 통일/폰트 임베드 필요
6. **수수료 규칙엔진** — 고정 1000원 → 유형·부수·감면(의료급여·국가유공 등) 반영
7. **수령/배송 처리** — VISIT(QR)·MAIL(송장)·FAX·포털 다운로드 분기 미구현
8. **환자 알림 연결** — 상태 전환(READY/REJECTED) 시 환자 알림 미발행
9. **발급대장 리포트·QR 포털 노출** — 발급 전용 대장 뷰·진위 QR 표시 없음

---

## 4. 사용자 시나리오

1. **환자 본인** — 포털 로그인 → 서류 발급 → 유형·기간·용도·부수·수령방법 선택 → (필요 시 동의) → 신청 → 상태 추적 → 완료 시 알림 → 포털 다운로드(PDF+진위 QR) 또는 방문/우편 수령.
2. **대리인(보호자/법정대리인)** — 위임 관계 보유 계정 → 구비서류 첨부 → 신청 → **승인 게이트(자격 검증)** 통과 후 처리.
3. **의료진(접수/원무)** — 워크스테이션 "서류 발급" 큐 → 요청 접수·자격 확인 → A그룹은 기록 범위 선택·스냅샷 생성·검토 → 승인·발급.
4. **의료진(담당의)** — B그룹(진단서 등) 큐 → 진료기록 기반 작성 폼 → 내용 작성 → **전자서명** → 발급. (직접 진찰 의사 검증)

---

## 5. 기능 요건 (FR)

### 포털(환자)
- FR-1 서류 발급 신청 폼(유형·기간·용도·부수·수령방법·대리 여부·구비서류 업로드) — 다국어
- FR-2 신청 내역·상태 추적(타임라인) + 완료 시 다운로드(PDF+진위 QR)
- FR-3 본인/대리 구분 신청, 대리 시 구비서류 첨부

### 자격 검증(보안 핵심)
- FR-4 신청자 ↔ 환자 본인 일치 검증(포털 세션 주체)
- FR-5 대리 신청 시 PatientGuardian(관계·legalBasis·expiresAt·accessScope) + 구비서류 + 환자동의 **전부** 충족 시에만 승인 허용
- FR-6 청구권자 외 거부, 거부 사유는 제한된 카테고리(법적 사유)만

### 의료진(워크스테이션)
- FR-7 서류 발급 큐(상태·유형·SLA 필터, 통계, SSE 실시간) — 동의서 워크스테이션 패턴 재사용
- FR-8 요청 상세·자격 확인·구비서류 열람
- FR-9 **A그룹**: 기록 범위 선택 → 해당 SIGNED 기록 **스냅샷 동결** → 검토 → 승인
- FR-10 **B그룹**: 진단서/소견서 작성 폼(진단명·발병일·향후소견 등, 진료기록 자동 채움) → **담당의(직접진찰) 검증** → **전자서명 강제** → 발급
- FR-11 4-eyes(선택): 발급 승인자 ≠ 작성자 옵션(고위험 문서)
- FR-12 반려(사유 필수)·보류·추가서류 요청

### 발급·문서
- FR-13 `IssuedDocument` 발급(발급번호 채번·snapshot·hash) + 한글 PDF(browserless) 생성
- FR-14 공개 진위검증(QR/발급번호, PHI 미노출) — 유효기간 포함
- FR-15 재발급(reissue, status=COPY/REISSUE 추적)

### 수수료·수령·알림
- FR-16 수수료 규칙엔진(유형·부수·감면) + Billing/방문수납 연계
- FR-17 수령: 포털 다운로드 / 방문(수령 QR) / 우편(송장) / 팩스
- FR-18 상태 전환 시 환자 알림(SSE/FCM/이메일), 의료진 신규요청 알림

### 관리·감사
- FR-19 발급대장(기간·유형·담당자·환자 필터) + 현황 리포트
- FR-20 전 단계 감사 기록 + 블록체인 앵커링(기존 AuditService)

---

## 6. 상태 머신 (요청 라이프사이클)

```
REQUESTED ──(자격검증 통과)──► VERIFIED ──► IN_PROGRESS
   │                              │              │ (A:스냅샷·검토 / B:작성·서명)
   │(자격 미달/구비서류)          │              ▼
   ├──► NEEDS_INFO ◄─────────────┘          UNDER_REVIEW
   │       │(보완 제출)                          │ (승인/4-eyes)
   │       ▼                                     ▼
   └──► REJECTED(사유)                        ISSUED ──► READY ──► DELIVERED
                                                 │
                                                 └──► (재발급) REISSUED
```

> 기존 DocumentRequest status(REQUESTED/PROCESSING/READY/DELIVERED/REJECTED)에 VERIFIED/NEEDS_INFO/UNDER_REVIEW/ISSUED 세분 추가(하위호환 매핑).

---

## 7. 데이터 모델 (재사용 확장 + 신규)

### 확장: `DocumentRequest`
- 추가: `requestorAccountId`(신청 계정), `onBehalf`(BOOL 대리), `guardianId`(대리 시), `attachments`(JSON 구비서류), `verifiedBy`/`verifiedAt`, `slaDueAt`, `issuedDocumentId`(발급 결과 FK), `consentSnapshot`(동의 동결)
- status enum 확장(§6)

### 신규: `IssuanceArtifact`(발급 산출물 — A 스냅샷/B 작성본 공통)
- `requestId` FK, `kind`(RECORD_COPY|CERTIFICATE), `documentType`, `snapshotJson`(동결 원천), `authoredJson`(B 작성 내용), `signatureId`(B 서명), `issuedDocumentId`, `pageCount`

### 신규: `IssuanceFeePolicy`(SystemConfig 재사용 가능)
- 유형별 단가·추가부수 단가·감면규칙(의료급여/국가유공/미성년 등)

> `MedicalRecordCopy`(v1)·`IssuedDocument`는 유지하며 IssuanceArtifact가 둘을 연결.

---

## 8. API 설계 (요약)

### 포털
- `POST /portal/documents/request` (확장: 대리·첨부·동의)
- `GET /portal/documents/requests[/:id]` (상태 타임라인)
- `GET /portal/documents/:id/download` (READY·본인/대리 검증 후 PDF+QR)

### 의료진
- `GET /staff/document-requests` (큐·필터·SLA) / `GET /staff/document-requests/stream`(SSE)
- `POST /staff/document-requests/:id/verify` (자격 승인/반려)
- `POST /staff/document-requests/:id/snapshot` (A: 기록 범위 동결)
- `POST /staff/document-requests/:id/author` (B: 진단서/소견서 작성·임시저장)
- `POST /staff/document-requests/:id/sign` (B: 전자서명·담당의 검증)
- `POST /staff/document-requests/:id/issue` (IssuedDocument 발급·PDF)
- `POST /staff/document-requests/:id/deliver` (수령 처리·송장/QR)
- `GET /staff/issuance-ledger` (발급대장·리포트)

### 공개
- `GET /verify/document/:issueNo` (진위, PHI 미노출 — 기존 재사용)

---

## 9. 권한 · 보안

- 포털: `PortalOrPatientGuard` — 본인 또는 승인된 보호자(accessScope 강제). 대리 발급은 verify 게이트 필수.
- 의료진: `RolesGuard` — A그룹 처리 ADMIN/NURSE(원무), B그룹 작성·서명 DOCTOR(담당의), 발급 승인 권한 분리. 기능접근 매트릭스([[feature_access_matrix]]) 연계 검토.
- 진단서 작성 의사 = 해당 Encounter 담당의 검증(임의 의사 발급 차단), 전자서명 필수(document-sign).
- 스냅샷 동결로 원본 정정(AMENDED) 후에도 발급본 불변. 제3자 정보 비식별 검토.
- 전 단계 감사 + 발급대장, 다운로드 토큰 단기 만료.

---

## 10. 비기능 요건
- 의료법·개보법 준수(법무 게이트), 발급 이력 보존(의료기록 준해), 다국어(ko/en/zh/ja), 한글 PDF 정상 렌더, SLA 처리기한 타이머, 진위검증 가용성.

---

## 11. 단계별 로드맵

| 단계 | 범위 | 산출 |
|------|------|------|
| **P0** | A그룹 종단 워크플로우 — 포털 신청 UI + 의료진 큐 UI + 본인검증 + 스냅샷 동결 + IssuedDocument 발급 + 한글 PDF + 포털 다운로드 + 알림 | 사본 발급 MVP |
| **P1** | 대리인 자격 강제 검증 + 구비서류·동의 게이트 + 거부 사유 제한 + 발급대장 | 법규 준수 강화 |
| **P2** | B그룹 진단서/소견서 작성 폼 + 담당의 검증 + 전자서명 + 4-eyes | 증명서 발급 |
| **P3** | 수수료 규칙엔진 + 수령(방문 QR/우편 송장/팩스) + 모바일 포털 + 리포트 | 운영 완성 |

---

## 12. 결정 필요 사항 (설계 전 확인)

1. **대상 문서 범위** — A그룹 전체 + B그룹(진단서/소견서)까지 1차에 포함? 아니면 사본(A)만 P0?
2. **청구권자 범위** — 본인·법정대리인·동의대리·유족 중 1차 지원 범위(법무).
3. **수수료** — 유형별 단가·감면 정책 확정 주체(원무/경영).
4. **수령 기본값** — 포털 PDF 다운로드를 기본으로? 방문/우편/팩스는 어디까지 P0/P3.
5. **본인확인 강도** — 현행 포털(MRN+생년월일) 외 추가 인증(생체/CI) 필요 여부.
6. **결제 연동** — Billing 청구 연계 vs 방문 수납 vs PG.

---

## 13. 리스크
- 법적 청구권자·구비서류 요건 오구현 시 컴플라이언스 위반 → **법무 게이트 선행**.
- 한글 PDF 렌더(폰트) — browserless 경로 통일 필요(pdf-lib 한계).
- 제3자 정보 노출(공동 진료기록) — 비식별/범위 제한 검토.
- 스냅샷-원본 불일치 정책(정정본 재발급 규칙) 명확화.
