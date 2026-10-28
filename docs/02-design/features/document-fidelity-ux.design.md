# 설계서 — 문서 충실도(Document Fidelity) UX

> 기획서 `docs/01-plan/features/document-fidelity-ux.plan.md`(v1.3)의 구현 설계.
> 작성일: 2026-06-10 · 상태: Design v1.1 (검토 보완) · 대상: P0(검사성적서·진료기록지·처방전) 우선.
> 대원칙: **기존 화면 무변경 + "문서 보기" 탭 추가(비파괴)**, **화면=인쇄=PDF 단일 템플릿**.

---

## 1. 아키텍처 개요

```
[기존 페이지(탭/폼) — 무변경]
        └─ + 탭 "문서 보기" ──> <DocumentView documentType patient sourceId>
                                     └─ <DocumentFrame>            (A4 캔버스·머리글/꼬리글·페이지분할·액션바)
                                          ├─ <DocHeader/>          (병원 법정정보·로고)
                                          ├─ <{Xxx}Doc data/>      (양식 본문: LabReportDoc 등)
                                          ├─ <SignatureBlock/>     (의료진 서명·직인)
                                          ├─ <IssueStamp/>         (발급번호·QR)
                                          └─ <DocFooter/>          (페이지 n/N·발급정보)
        [인쇄] window.print() + @media print        [PDF] GET /api/v1/documents/{type}/{id}/pdf (서버, 동일 HTML)
```

- **단일 템플릿 원칙**: 양식 컴포넌트는 화면 미리보기에 쓰는 것과 **동일 마크업**을 서버 PDF 렌더에도 사용(§7).
- 데이터는 **기존 read API에서 조회만**. 쓰기·기존 컴포넌트 변경 없음.

---

## 2. 프론트엔드 컴포넌트 API

### 2.1 공통 프레임
```ts
// components/document/DocumentFrame.tsx
interface DocumentFrameProps {
  title: string;                 // 문서 제목(예: "검사 성적서")
  meta: DocumentMeta;            // 발급정보(§5)
  size?: 'A4';                   // 기본 A4
  watermark?: 'COPY' | 'REISSUE' | 'VOID' | 'DRAFT' | null;
  onDownloadPdf?: () => void;    // 미지정 시 서버 PDF 기본 동작
  children: React.ReactNode;     // 양식 본문
}
```
- A4: `210mm × 297mm` 캔버스(px 환산 `96dpi → 794×1123`), 인쇄 시 실측 mm.
- 자동 페이지 분할: 본문이 1페이지 초과 시 `.doc-page` 반복, 머리글/꼬리글 매 페이지 표시(CSS `position: running()` 대안: JS measure 또는 표 단위 분할).
- 액션바(`.doc-no-print`): 인쇄·PDF·옵션(글자크기/언어). 인쇄 시 숨김.

### 2.2 신뢰요소 컴포넌트
```ts
<DocHeader hospital={HospitalProfile} logoUrl />          // 병원명·요양기관기호·주소·전화
<DocFooter pageNo n totalN issuedAt issuedBy />
<SignatureBlock signer={{name, license, signatureImageUrl}} stampUrl />
<IssueStamp issueNo qrUrl />                                // 발급번호 + QR(진위검증)
```

### 2.3 양식 컴포넌트(P0) — 데이터 주입형
```ts
<LabReportDoc data={LabReportData} />
<EncounterRecordDoc data={EncounterRecordData} />
<PrescriptionDoc data={PrescriptionData} />
```
- 순수 표현 컴포넌트(side-effect 없음) → 서버 렌더 재사용 가능.

### 2.4 탭 통합 패턴(비파괴)
```tsx
// 기존 탭 배열에 append만. 기존 분기 불변.
const TABS = [ ...기존, { key: 'document', label: '📄 문서 보기' } ];
...
{tab === 'document' && <DocumentView documentType="LAB_REPORT" sourceId={resultId} />}
```
- 탭이 없던 단일 화면: 상단 토글 `[작업] [문서 보기]` 추가(기존 본문은 '작업'에 그대로).

---

## 3. 문서별 데이터 스키마 (실 모델 매핑)

### 3.1 검사 성적서 (LAB_REPORT) — `LabResult`+`LabResultItem`
```ts
interface LabReportData {
  patient: { name; mrn; sex; birth };
  order:   { orderedAt; department; doctorName };
  specimen:{ collectedAt; completedAt; technicianName };
  items: Array<{ testName; value; unit; normalMin; normalMax; flag /* H|L|Panic|N */ }>;
  // 출처: LabResultItem(testName,value,unit,normalMin,normalMax,flag) + LabResult(collectedAt,completedAt,technician)
}
```
- flag 시각화: H(▲ 적색)·L(▼ 청색)·Panic(굵게/배경). 참고치 `normalMin–normalMax unit`.

### 3.2 진료기록지 (ENCOUNTER_RECORD) — `Encounter`+`EncounterDiagnosis`
```ts
interface EncounterRecordData {
  patient; visitType;            // OUTPATIENT/INPATIENT/...
  soap: { subjective; objective; assessment; plan };
  cc; hpi; pmh; familyHistory; socialHistory; ros; pe;  // Encounter 필드 그대로
  diagnoses: Array<{ kcdCode; name; type; rank; certainty }>;  // EncounterDiagnosis
  doctor: { name; license }; signedAt;
}
```

### 3.3 처방전 (PRESCRIPTION) — `Prescription`+`MedicationCode`+`Order`+`Encounter.diagnoses`
```ts
interface PrescriptionData {
  patient: { name; rrn /* 주민번호: 권한별 마스킹 */ };
  hospital: HospitalProfile;     // 요양기관기호 등(§6)
  diagnoses: Array<{ kcdCode; name }>;        // 질병분류기호
  prescriber: { name; licenseType; licenseNumber; signatureImageUrl };
  issueNo; issuedAt;             // 교부번호·교부연월일
  dispensingType: 'INTERNAL'|'EXTERNAL'; rxValidUntil;   // 원외/사용기간
  drugs: Array<{ name; ingredient; dosageForm; doseOnce; freqPerDay; days; route; instructions; copayCode? }>;
  // 출처: Prescription(dosage,frequency,duration,quantity,route,rxValidUntil,dispensingType) + MedicationCode(nameKo,ingredient,dosageForm)
}
```
- 법정 필드(§기획 12.1): 환자 성명·주민번호, 질병분류기호, 본인부담 구분기호, 요양기관기호, 면허번호, 교부번호/일, 1회량·1일횟수·총일수·용법, 사용기간.

---

## 4. 인쇄 CSS 스펙

```css
/* globals 또는 document.css — 전역, 단 .doc-* 스코프 한정 */
@media print {
  body * { visibility: hidden; }                 /* 앱 크롬 숨김 */
  .doc-print-root, .doc-print-root * { visibility: visible; }
  .doc-print-root { position: absolute; inset: 0; }
  .doc-no-print { display: none !important; }
  .doc-page { page-break-after: always; }
  .doc-page:last-child { page-break-after: auto; }
  tr, .doc-row { break-inside: avoid; }          /* 행 잘림 방지 */
  thead { display: table-header-group; }         /* 표 머리글 페이지 반복 */
  .doc-stamp, .doc-watermark { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
@page { size: A4; margin: 15mm 14mm; }
```
- 미리보기 화면도 동일 `.doc-*` 클래스 → WYSIWYG.
- 브라우저 매트릭스(Chrome/Edge/Safari) 테스트(§기획 18).

---

## 5. 발급 메타 / 진위검증

```ts
interface DocumentMeta {
  documentType; sourceId; patientId;
  issueNo;          // WRB-{TYPE}-{YYYYMMDD}-{seq}
  issuedAt; issuedBy;
  status: 'ORIGINAL'|'COPY'|'REISSUE'|'VOID';
  hash;             // 발급본 내용 해시
  qrUrl;            // /verify/document/{issueNo}
}
```
- 발급 시 **스냅샷 동결**(발급 시점 데이터·서식 보존) → **신규 `IssuedDocument` 모델**에 저장(트윈 `TwinDocumentReference` 오염 회피·C-3). 필요 시 FHIR `DocumentReference`로 노출. → 상세 §12.3.
- 진위검증: `GET /verify/document/{issueNo}`(공개=발급정보·유효성만, PHI 비노출). 해시/블록체인 서명 연계.

---

## 6. 병원 법정정보 마스터 (HospitalProfile)

```ts
interface HospitalProfile {
  name; ykiho /*요양기관기호*/; businessNumber; ceo; address; tel; fax; logoUrl; stampUrl;
}
```
- 저장: `SystemConfig` 키군(`hospital.profile.*`) 또는 신규 `HospitalProfile` 1행.
- **개발 단계: 데모 상수 주입**(요양기관기호 `WRB-DEMO-0001` 등) — 실값은 배포 시 교정(`deployment-readiness.plan.md` DOC-1).

---

## 7. 백엔드 — 공통 문서 서비스 / PDF

```
modules/document/
  document.controller.ts   GET /api/v1/documents/:type/:id (메타·미리보기 데이터)
                           GET /api/v1/documents/:type/:id/pdf  (PDF, 권한·감사)
                           GET /verify/document/:issueNo        (공개 진위검증)
  document.service.ts      발급번호 생성·스냅샷 동결·해시·DocumentReference 등록·재발급 이력
  renderers/               양식 HTML 렌더(프론트 양식과 동일 마크업 공유 or 미러)
```
- **PDF 엔진(확정·C-1)**: P0 3종은 **헤드리스 HTML→PDF로 단일화**(미리보기와 동일 마크업). **pdf-lib는 P0 문서 금지** — 좌표 드로잉이라 React 양식과 마크업 공유 불가→미리보기/PDF 갈라짐(KPI 99% 구조적 불가). pdf-lib는 **레거시(제증명·동의서) 구 경로 유지에만** 한정(폴백 아님·미통합 레거시). P1~P2 PDF 필요 시 **클라이언트 print-to-PDF(동일 HTML)** 잠정 사용. → 상세 §12.1.
- 권한: `SmartAuthGuard`/`JwtAuthGuard` + 역할 매트릭스(기획 §16) + **PHI 감사로그**(AuditService). 포털은 `PortalOrPatientGuard` 본인 한정.
- 폰트: 한글 임베드(Pretendard/나눔 OFL).

---

## 8. 파일 구조 (신규, 기존 무변경)
```
apps/web/src/components/document/
  DocumentFrame.tsx  DocHeader.tsx  DocFooter.tsx  SignatureBlock.tsx  IssueStamp.tsx
  DocumentView.tsx   (type→양식 매핑)
  forms/  LabReportDoc.tsx  EncounterRecordDoc.tsx  PrescriptionDoc.tsx
  document.css       (인쇄 CSS)
  lib/  documentMeta.ts  hospitalProfile.ts (dev 상수)
apps/api/src/modules/document/   (BE 공통 서비스·PDF·진위검증)
```
- 기존 페이지에는 **탭 항목 1줄 + 조건 렌더 1줄**만 추가.

---

## 9. 구현 순서 (플랜 Phase 매핑)
1. **P1**: `DocumentFrame`+`document.css`(인쇄)+`DocHeader/Footer/SignatureBlock/IssueStamp`+`hospitalProfile`(dev 상수)+폰트.
2. **P2**: `LabReportDoc`·`EncounterRecordDoc`·`PrescriptionDoc` + 각 화면에 "문서 보기" 탭 추가 + 미리보기/인쇄.
3. **P3**: BE `document` 서비스(발급번호·스냅샷·DocumentReference)+서버 PDF(헤드리스)+진위검증+감사.
4. **P4**: 진단서·제증명·영수증·동의서 공통화. **P5**: 의뢰서/CDA·MAR·i18n.

---

## 10. 테스트
- **시각 회귀**: 미리보기 vs 서버 PDF 스냅샷 diff(≥99%).
- **인쇄 매트릭스**: Chrome/Edge/Safari `@page`·페이지분할·표 반복.
- **회귀 가드**: 기존 탭/화면 스모크(탭 추가 영향 0), 기존 PDF(동의서·제증명) 출력 동일.
- **권한/감사**: 역할별 접근·다운로드 감사로그·포털 본인한정.

---

## 11. 오픈 이슈(기획 §21 연계)
- PDF 엔진 헤드리스 도입(인프라) · 표준 폰트 확정 · 발급 스냅샷 저장소(TwinDocumentReference 확장 vs 신규) · QR 공개검증 범위.

---

## 12. 검토 보완 (v1.1 — design-validator 반영, 68→보강)

### 12.1 [C-1] 단일 템플릿 ↔ PDF 엔진 모순 해소 (확정)
- **P0 3종 = 헤드리스 HTML→PDF 단일화.** pdf-lib는 P0 **금지**(마크업 공유 불가 → 미리보기/PDF 분기 → KPI 99% 구조적 불가).
- pdf-lib = **레거시 제증명·동의서 구 경로 유지에만**(미통합 레거시, 폴백 아님). P4에서 헤드리스로 점진 흡수.
- **PDF 미제공 구간(P1~P2) 잠정 수단 = 클라이언트 print-to-PDF**(브라우저 인쇄→PDF, 동일 HTML). 서버 PDF는 P3 헤드리스로 도입.

### 12.2 [C-2] 양식 컴포넌트 서버 공유 — 구체 파이프라인 (확정)
- **양식 컴포넌트 순수성 규칙**: `LabReportDoc`/`EncounterRecordDoc`/`PrescriptionDoc`은 **props만 받는 순수 함수형**(훅·fetch·TanStack Query·전역상태 **금지**). 데이터는 상위에서 주입.
- **서버 렌더 파이프라인(1안 확정)**: `renderToStaticMarkup(<XxxDoc data={snapshot}/>)` → `document.css`(인쇄 규칙) + **임베드 폰트 @font-face(base64)** 결합한 **단일 HTML** → Playwright `page.setContent(html)` → `page.pdf({format:'A4', printBackground:true})`.
- 설계 전반의 **"or 미러" 표현 폐기**(이중구현 금지 — 동일 컴포넌트 재사용만).

### 12.3 [C-3] 발급문서 저장 모델 — 신규 `IssuedDocument` (확정)
```prisma
model IssuedDocument {
  issueNo     String  @id            // WRB-{TYPE}-{YYYYMMDD}-{seq}
  documentType String @db.VarChar(40)
  sourceId    String  @db.Uuid       // 원천(LabResult/Encounter/Prescription...)
  patientId   String  @db.Uuid
  snapshotJson Json                  // 발급 시점 데이터 동결
  formVersion String                 // 서식 버전
  hash        String                 // 내용 해시(진위)
  status      String                 // ORIGINAL|COPY|REISSUE|VOID
  reissueOf   String?                // 재발급 원본 issueNo
  issuedBy    String  @db.Uuid
  issuedAt    DateTime @default(now())
  @@index([patientId]) @@index([documentType, sourceId])
}
```
- 트윈 `TwinDocumentReference`는 **트윈 write-back 전용 유지**(오염 회피). 일반 발급문서는 `IssuedDocument`. 필요 시 FHIR DocumentReference로 노출.

### 12.4 [W-1] 페이지 분할 전략 (단일화)
- **컴포넌트가 의미 단위로 `.doc-page`를 명시적으로 끊는다**(검사항목 N행/페이지, 기록 섹션 단위). 같은 끊김에 `page-break-after: always` 부여 → **화면 미리보기와 인쇄가 동일 분할점 공유**.
- **JS auto-measure 분할 비권장**(분할점 비결정 → 화면≠인쇄 페이지수). 머리글/꼬리글은 각 `.doc-page`에 컴포넌트로 반복 삽입(`position: running()` 미지원 대비).

### 12.5 [W-2] 인쇄 격리 보강
- **`.doc-print-root`는 React Portal로 `document.body` 직하 마운트**(조상 `transform`/`overflow` 영향 차단).
- §4 규칙을 다음으로 보강:
```css
@media print {
  body > *:not(.doc-print-root) { display: none !important; }   /* visibility보다 견고(빈 페이지 방지) */
  .doc-print-root { position: static; }
  [data-portal], [data-radix-portal], .toast, [role="dialog"] { display: none !important; }
}
```

### 12.6 [W-3] 주민번호/PHI 마스킹 정책 (BE 적용)
> ✅ 적용(v1.1): 처방전이 patient.service의 서비스단 마스킹(복호→maskNationalId) 결과 사용. 법정 인쇄 시 전체표기(의사/약사 unmask)는 감사 동반 민감작업으로 배포 시점 처리(deployment-readiness).
- **마스킹은 BE document API가 컨텍스트·역할 기준으로 적용해 전달**(FE는 표시만). 포맷 `880101-1******`.
| 컨텍스트 | 의사/약사 | 간호/검사 | 원무 | 포털(본인) |
|---|---|---|---|---|
| 화면 미리보기 | 마스킹 | 마스킹 | 마스킹 | 마스킹 |
| 인쇄/PDF(법정 처방전 등 전체표기 필요) | unmask | — | unmask(영수/제증명) | **마스킹 유지** |
- 기존 접수 모듈 주민번호 암호화/마스킹 자산 연계.

### 12.7 [W-4] 발급 가드 / 상태 전이
- **미서명 문서**(Encounter.signedAt 없음·Prescription 미승인): 정식 issueNo 미부여 + `DRAFT` 워터마크(또는 발급 거부). **`VOID`**: 신규 PDF 발급 차단(검증 페이지에서만 무효 표기).
- 상태 전이: `DRAFT → ORIGINAL → (REISSUE | VOID)`. document.service에 발급 전제조건 검증 추가.

### 12.8 [W-5] 발급번호 동시성
- seq 채번: `@@unique([documentType, dateKey, seq])` + 트랜잭션(또는 Postgres sequence). `issueNo` unique index. 충돌 시 재시도(최대 3회).

### 12.9 [W-6] 포털 엔드포인트 분리
- 포털 전용: **`GET /portal/documents/:type/:id` (`PortalOrPatientGuard`)**, staff `GET /api/v1/documents/...`(`JwtAuthGuard`)와 **라우트 분리**(staff 라우트를 포털이 호출하면 401·중복 금지 — 프로젝트 규칙). 포털: 발급(서명)×, **본인 sourceId 소유권 검증**, 마스킹 강제(법정 전체표기 예외도 포털 미적용).

### 12.10 [NFR·I] 성능·접근성·테스트·마스터
- **성능**: 헤드리스 **워커 풀 + 브라우저 인스턴스 재사용**(콜드스타트 회피), 발급본 PDF **캐시**(동결 스냅샷이라 불변) → <3s 목표. 미리보기는 클라이언트 렌더 <1s.
- **접근성(I-2)**: 헤드리스 HTML→PDF는 텍스트 레이어 유지(이미지화 금지). QR·직인 이미지에 `alt`.
- **시각회귀(I-3)**: **Playwright `toHaveScreenshot`/pixelmatch**로 미리보기 vs 서버 PDF(동일 96dpi 기준) diff ≥99%. CI 야간 잡 권장.
- **HospitalProfile 저장(I-4)**: P3 전 **신규 `HospitalProfile` 1행**으로 확정(SystemConfig 키군 대신 — 직인/로고 바이너리 참조·검증 용이). 개발은 dev 상수.
- **언어 토글(I-1)**: P5 전까지 **비활성/숨김**.

### 12.11 매핑 보완
- NFR 성능 목표 → §12.10 반영. §16 권한 매트릭스 세분(간호 PDF 일부 등) → §12.6/12.9 + BE 가드에서 역할별 분기.

> 결론(검증): P1~P2(미리보기·인쇄) 착수 가능. **C-1/C-2/C-3 해소 완료** → P3(서버 PDF·발급·진위) 진입 조건 충족.

---

> 다음: 본 설계(v1.1) 승인 → P1 구현 착수(`DocumentFrame` + 전역 인쇄 CSS(§12.5 보강) + Portal 인쇄루트 + dev HospitalProfile).
