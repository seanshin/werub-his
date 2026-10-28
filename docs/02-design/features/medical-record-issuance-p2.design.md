# P2 설계서 — 진단서·소견서(B그룹) 작성·전자서명·발급

> **Feature**: medical-record-issuance-portal (P2)
> **Version**: 1.0 (Design)
> **Date**: 2026-06-21
> **Status**: Design (구현 전)
> **기획**: [medical-record-issuance-portal.plan.md](../../01-plan/features/medical-record-issuance-portal.plan.md)
> **선행**: P0(A그룹 사본) 운영 라이브 — IssuanceService·워크스테이션·발급 인프라 재사용
> **근거**: 의료법 §17(직접 진찰한 의사만 진단서·증명서 교부)

---

## 0. 범위 · 전제

**포함**: 환자 요청(DIAGNOSIS_CERT/OPINION/ADMISSION_CERT) → 의료진 큐 → **담당의(직접 진찰) 검증** → 진료기록 기반 **작성(author)** → **전자서명(sign 강제)** → 발급(IssuedDocument) → 한글 PDF → 포털 다운로드.

**제외(후속)**: 외부 sign 서비스 EXTERNAL 경로(P1 공동게이트 의존 — P2는 내부 SIMULATION 서명 기록) · 대리인 자격검증(P1) · 상해진단서 특수서식·사망진단서(별도).

**문서 유형(B그룹)**: DIAGNOSIS_CERT(진단서)·OPINION(소견서)·ADMISSION_CERT(입퇴원확인서).

---

## 1. 재사용 (조사 결과) vs 신규

| 재사용(있음) | 위치 |
|------|------|
| 환자 요청·상태머신 | `DocumentRequest`(type DIAGNOSIS_CERT/OPINION/ADMISSION_CERT, fee 20000/10000/3000) |
| 발급 종단·워크스테이션 | P0 `IssuanceService`·`/workstation/documents`·`StaffDocumentController`·포털 다운로드 |
| 진단서 렌더러 | `CertificateDoc.tsx`(CertificateData: diagnoses[]·onsetDate·diagnosedDate·treatmentOpinion·purpose·doctor) + print `/print/[issueNo]` documentType **CERTIFICATE** 분기(기존) |
| 진단 원천 | `Encounter.doctorId`·`EncounterDiagnosis`(type/certainty/onsetDate)·`DiagnosisCode`(KCD-8) |
| 발급 | `document.service.issue`(documentType별 채번·snapshot·hash·QR)·generatePdf(browserless) |
| 서명 인프라 | `sign-integration.service`(SIMULATION 현행)·`DocumentSignature`·`BlockchainCertificate`·`User.signCertSerial` |

| 신규(갭) | 비고 |
|------|------|
| 담당의(직접진찰) 검증 강제 | author = encounter.doctorId 또는 DOCTOR+사유(감사) |
| 작성(author) 폼·API | 진료기록 자동채움 + 의사 편집(진단명·발병일·향후소견·용도) |
| 전자서명 게이트 | 서명 없이는 발급 불가(SIGNED 강제) |
| 소견서/입퇴원확인서 렌더러 | `OpinionDoc`·`AdmissionCertDoc`(CertificateDoc 패턴) |
| IssuanceArtifact 확장 | authoredJson·signedBy·signedAt(B그룹 작성·서명 기록) |

---

## 2. 데이터 모델 (확장)

> manual SQL(db push 차단) + schema 동기화. nullable/IF NOT EXISTS·무중단.

### `IssuanceArtifact` 확장 (A·B 공용)
```
authored_json  JSONB NULL      -- B그룹 의사 작성 내용(진단명·발병일·향후소견 등)
signed_by      UUID NULL       -- 전자서명 의사
signed_at      TIMESTAMPTZ NULL
signature_ref  VARCHAR(120) NULL -- DocumentSignature/sign 참조(SIMULATION=내부 ref)
```
- B그룹은 `record_type='CERTIFICATE'`(또는 OPINION/ADMISSION), `source_ids`=근거 encounter/admission, `snapshot_json`=발급 시점 진단 동결, `authored_json`=의사 작성본.

> 신규 모델 추가 시 **서버 `prisma generate` 필수**([[feedback_deploy_prisma_generate]]). 본 P2는 컬럼 추가만(모델 신규 없음)이라 generate 후 build.

---

## 3. 상태 전이 (B그룹)

```
REQUESTED ──(담당의 검증·접수)──► IN_REVIEW(작성중)
   │                                  │ author(작성·임시저장, 반복 가능)
   │                                  ▼
   │                              AUTHORED
   │                                  │ sign(전자서명·담당의)
   │                                  ▼
   │                               SIGNED ──issue──► READY ──► DELIVERED
   └──► REJECTED(사유)
```
- **서명 게이트**: SIGNED 가 아니면 issue 거부. issue 멱등(issuedDocumentId).
- A그룹(P0)은 IN_REVIEW→issue 직행(서명 없음). B그룹만 AUTHORED→SIGNED 경유.

---

## 4. API (IssuanceService·StaffDocumentController 확장)

```
POST /staff/document-requests/:id/author    (DOCTOR) — 담당의 검증 + 작성/임시저장 → AUTHORED
POST /staff/document-requests/:id/sign       (DOCTOR) — 작성자 본인 전자서명 → SIGNED(signedBy/At/ref)
POST /staff/document-requests/:id/issue       (기존, B면 SIGNED 게이트) — documentType=CERTIFICATE/OPINION/ADMISSION_CERT
GET  /staff/document-requests/:id/draft       — 진료기록 기반 작성 초안(자동채움)
```
- `author` body: { encounterId?, diagnoses[], onsetDate, diagnosedDate, treatmentOpinion, purpose, content? }
- 담당의 검증: DIAGNOSIS_CERT는 encounterId 필요 → `encounter.doctorId === userId` 강제(아니면 403 + 사유 오버라이드는 P2 제외).

---

## 5. 담당의 검증 (의료법 §17)

- 작성·서명자는 `role=DOCTOR` + (DIAGNOSIS_CERT 한정) **해당 진료의 encounter.doctorId 일치**.
- 서명자 = 작성자 동일(진단서 책임 일치). signCertSerial 보유 권장(없으면 SIMULATION 내부 서명 기록).
- 발급 문서에 작성 의사명·면허번호 표기(CertificateData.doctor).

---

## 6. 전자서명 (P2 = SIMULATION 내부 기록)

- `sign` 호출 시: 작성본(authored_json) + snapshot 의 documentHash(SHA-256) 계산 → `DocumentSignature` 기록(signerUserId=담당의, signerRole=PRIMARY) 또는 IssuanceArtifact.signature_ref 에 내부 ref. signedAt/signedBy 설정.
- EXTERNAL(sign-integration submitSignRequest)은 P1 공동게이트 해제 후 토글로 전환(스캐폴드 존재).
- 서명 후 author 재호출 차단(서명 무효화 없이 재작성하려면 sign 취소 필요 — P2는 단순화: SIGNED 후 수정 불가, 반려 후 재요청).

---

## 7. PDF / 렌더러

- 진단서: 기존 `CertificateDoc`(documentType CERTIFICATE) 재사용. issue 시 documentType=CERTIFICATE, snapshot=CertificateData 형태.
- 소견서/입퇴원확인서: `OpinionDoc`·`AdmissionCertDoc` 신규(CertificateDoc 패턴), print `/print/[issueNo]` 분기 추가(documentType OPINION/ADMISSION_CERT).
- browserless 한글 OK(기존 print 라우트).

---

## 8. 프론트엔드

- 워크스테이션 `/workstation/documents`(기존) 확장: B그룹 요청은 **작성 패널**(진단 자동채움·편집) + **서명 버튼** + 발급. A/B 분기 UI.
- 담당의만 author/sign 노출(role=DOCTOR). 원무(NURSE)는 B그룹 접수·라우팅까지.
- 포털: 기존 ServicesTab 서류발급에서 DIAGNOSIS_CERT/OPINION 선택 가능(이미 type 옵션 존재) + 완료 시 다운로드(P0 경로 재사용).

---

## 9. 권한·보안
- author/sign: RolesGuard DOCTOR + 담당의 검증. issue: DOCTOR/ADMIN.
- 서명 강제(SIGNED 게이트), 작성·서명 감사(AuditService), 발급대장 공통.
- 본인 다운로드 검증(P0 patientDownloadIssueNo 재사용).

---

## 10. 구현 작업
**DDL**: IssuanceArtifact 4컬럼(authored_json·signed_by·signed_at·signature_ref) manual SQL + schema.
**BE**: IssuanceService.authorCertificate/signCertificate/draft + issue B그룹 분기(documentType 매핑·SIGNED 게이트) + 담당의 검증. StaffDocumentController author/sign/draft 라우트(DOCTOR).
**FE**: 워크스테이션 작성·서명 패널 + OpinionDoc/AdmissionCertDoc 렌더러 + print 분기.
**테스트**: 담당의 검증(타 의사 403)·서명 게이트(미서명 issue 거부)·issue 멱등·작성 임시저장.

---

## 11. 잔여·결정
- EXTERNAL 서명/HSM(P1 게이트), 상해·사망진단서 특수서식 제외.
- SIGNED 후 수정정책(P2=반려 후 재요청).
- 수수료 실결제(P3).
