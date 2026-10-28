# 검진 결과서 작성·검토·발급 기획서 v1.0

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/prisma/schema.prisma:12164 · apps/api/src/modules/checkup/checkup.service.ts · apps/api/src/modules/checkup/checkup-protocol.service.ts · 잔여: AI 초안 provenance/검토체크(사람)

> 종합건강검진 완료 후 **결과서(종합소견서)를 작성 → 검토 → 전자서명 → 발급·배포**하는 워크플로우 표준화·보강
> 상위 기획: [health-checkup.plan.md](./health-checkup.plan.md) (건강검진 시스템 v2.0) §4~5 결과 통합·종합소견서
> 작성일 2026-06-30 · 범위: 검진 "결과서 작성" 구간(검사 완료 이후)

---

## 1. 개요

### 1.1 목적
검진 검사가 모두 끝난 뒤, 흩어진 검사 결과를 **하나의 결과서(종합소견서)**로 만들어 수검자에게 제공하는 과정을 표준화한다.
- 영역별 자동 판정 → 판독의 소견 → 검진의 종합소견 → **검토·전자서명** → **결과서 발급·배포**까지 단일 흐름.
- 국가건강검진 판정 체계(A·B·C·D)와 병원 종합검진 판정을 모두 수용.
- AI 보조(종합 해석·추적 권고)는 **초안 생성**까지만, 확정·서명은 의료진 책임(검토 게이트).

### 1.2 현행 분석 (코드 기준, 보강 대상)

| 구성 | 현행 구현 | 상태 |
|------|-----------|------|
| 검사 결과 적재 | `CheckupResultItem`(testName·value·unit·referenceRange·note) + `autoCollectResults`(자동 수집)·`addResult`(수동) | ✅ |
| 영역/항목 판정 | `CheckupInterpretation`(resultItemId·department·**finding·grade·recommendation**·interpretedBy/At) + `completeInterpretation` | ✅ |
| 판독 대기열 | `GET /interpretations`(status=REQUESTED) | ✅ |
| 영역별 자동 판정 집계 | `GET /visits/:id/grade-summary`(`generateGradeSummary` — **동적 계산**) | ✅ |
| 종합소견 | `CheckupSummary`(**doctorOpinion·reviewedBy·signedAt 만**) + `POST /visits/:id/summary` | ⚠️ 부분 |
| 결과서 출력 | `GET /visits/:id/result-pdf?format=html\|pdf`(`generateCheckupResultPdf`) | ✅ |
| AI 보조 | `GET /visits/:id/ai-interpret`(종합 해석)·`ai-followup`(추적 권고) | ✅ |
| 상태 흐름 | `EXAM_COMPLETE`·`PARTIAL_COMPLETE` → `REVIEW` → `COMPLETED` | ✅ |
| 화면 | `/his-checkup/review`(소견 대기·판독)·`/his-checkup/visit/[id]`(방문 상세) | ✅ |

> **정정(2026-06-30 코드 재확인)**: 아래 갭#1은 **사실과 다름** — `CheckupSummary` 모델은 이미 `overallGrade·sections(JSONB)·recommendations(JSONB)`를 보유하고 `createSummary`가 영속 저장한다. `signSummary`(서명→COMPLETED + HIS Encounter/Condition 동기 + journey 이벤트)도 구현돼 있음. **실제 남은 갭은 검토/서명 게이트(아래 #2)** 이며, 이를 P0로 우선 구현했다(✅ 하단 구현 상태).

**🔴 핵심 갭(보강 필요)**
1. ~~종합소견 영속성 불완전~~ → **정정: 이미 영속화됨**(overallGrade·sections·recommendations 컬럼 존재·createSummary 저장). 보강 불요.
2. **검토/서명 게이트 부재**: `signSummary`가 미완료 판독·소견 누락을 검증하지 않고 무조건 서명·COMPLETED 전환. 4-eyes(작성≠검토자) 미강제. **← P0 구현 완료**
3. **결과서 발급·배포 단계 부재**: PDF 생성은 있으나 "발급(IssuedDocument)·배포(포털/우편/단체기관)·발급 이력·진위확인" 체계가 결과서엔 미연결(진료 의무기록 발급 체계와 분리).
4. **AI 초안 검토 추적 부재**: AI 해석을 종합소견에 반영할 때 검토 게이트·AI provenance 미기록(간호 F-4 패턴 미적용).
5. **국가검진 판정 서식 미분리**: 일반검진/암검진 공단 통보 판정코드·서식과 병원 종합검진 결과서가 구분되지 않음.

---

## 2. 목표 워크플로우

```
[검사 완료] EXAM_COMPLETE / PARTIAL_COMPLETE
   │
   ├─ (1) 결과 수집·정규화 ── autoCollectResults: Lab/Imaging/Diagnostic → CheckupResultItem
   │        · 참고치 대비 자동 플래그(정상/이상/경계) 산출
   │
   ├─ (2) 영역·항목 판독(소견) ── CheckupInterpretation (판독의/검사과)
   │        · finding(소견) · grade(A~D2) · recommendation
   │        · 판독 대기열에서 처리 → 모든 필수 영역 완료 게이트
   │
   ├─ (3) 자동 판정 집계 ── generateGradeSummary
   │        · 영역별 등급 + overallGrade(최악값) 제시(초안)
   │
   ├─ (4) 종합소견 작성(검진의) ───────── status: REVIEW
   │        · overallGrade 확정 · sections[] 확정 · doctorOpinion · recommendations[]
   │        · AI 종합해석/추적권고 = 초안 보조(검토 게이트·provenance 기록)
   │
   ├─ (5) 검토·전자서명 ──────────────── 게이트: 미완료 판독 0 · 작성자 서명
   │        · (옵션) 4-eyes: 2차 검토자 승인
   │        · signedAt 기록 · status: COMPLETED
   │
   └─ (6) 결과서 발급·배포 ──────────── IssuedDocument(발급번호·진위 QR)
            · 환자 포털 게시 · (단체검진) 기관 일괄 · 우편/방문
            · 추적관리(follow-up) 대상 자동 등록
```

핵심 원칙: **(5) 서명 전에는 결과서 미확정**(DRAFT), 서명 후 발급본은 불변(정정은 amend 이력). 자동판정은 **제안**, 확정은 검진의.

---

## 3. 데이터 모델 보강

### 3.1 CheckupSummary 확장 (영속성 — 🔴 P0)
```prisma
model CheckupSummary {
  id              String    @id @default(uuid()) @db.Uuid
  visitId         String    @unique @map("visit_id") @db.Uuid
  // ── 신규: 결과서 본문 영속화 ──
  overallGrade    String?   @map("overall_grade") @db.VarChar(5)   // A|B|C1|C2|D1|D2
  sections        Json?     @db.JsonB                              // [{area, grade, findings}]
  recommendations String[]  @default([])                          // 권고사항
  doctorOpinion   String?   @map("doctor_opinion") @db.Text
  // ── 신규: 검토/서명 라이프사이클 ──
  status          String    @default("DRAFT") @db.VarChar(12)      // DRAFT|REVIEW|SIGNED|AMENDED
  authoredBy      String?   @map("authored_by") @db.Uuid           // 작성 검진의
  reviewedBy      String?   @map("reviewed_by") @db.Uuid           // 검토(4-eyes)
  signedBy        String?   @map("signed_by") @db.Uuid
  signedAt        DateTime? @map("signed_at") @db.Timestamptz()
  amendedFromId   String?   @map("amended_from_id") @db.Uuid       // 정정 원본
  aiProvenance    Json?     @map("ai_provenance") @db.JsonB        // AI 초안 사용 추적
  issuedDocumentId String?  @map("issued_document_id") @db.Uuid    // 발급본 연결
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.Timestamptz()
}
```
> `sections`는 JSONB(영역 가변)로 영속화해 발급 시점 결과를 **고정(snapshot)**한다 — 추후 마스터 변경에도 발급본 재현 가능.

### 3.2 판정 코드 표준 (국가검진 호환)
| 등급 | 의미 | 비고 |
|------|------|------|
| A | 정상 | |
| B | 경미한 이상(정상B) | 생활습관 관리 |
| C1 | 요관찰 | 추적 관찰 |
| C2 | 요치료 | 치료 필요 |
| D1 | 정밀검사(유질환 의심) | 추가 검사 |
| D2 | 유질환(치료중) | |
> 일반검진/암검진은 공단 통보용 별도 판정 필드(`nhiJudgment`)를 `CheckupVisit.isNhiScreening=true` 건에 한해 추가(P2).

---

## 4. 기능 설계

### 4.1 결과 수집·자동 플래그 (P0)
- `autoCollectResults` 보강: 각 `CheckupResultItem`에 참고치(referenceRange) 파싱 → **flag(NORMAL/ABNORMAL/BORDERLINE)** 산출(성별·연령 보정 룰 적용 가능 시).
- 수치 미해석 항목은 PENDING으로 두어 판독 대기열로.

### 4.2 판독(소견) 처리 (현행 + 게이트)
- `/his-checkup/review` 판독 대기열에서 영역/항목별 `finding·grade·recommendation` 입력(현행).
- **게이트**: 종합소견 서명 전 "필수 판독 영역 미완료 = 0" 검증. 미완료 시 서명 차단·목록 표시.

### 4.3 종합소견 작성 (P0)
- 화면: 좌측 영역별 자동판정(grade-summary) + 판독 소견, 우측 종합소견 편집.
- 입력: `overallGrade`(자동 최악값 제안·수정 가능)·`sections[]`(영역별 등급/소견 확정)·`doctorOpinion`·`recommendations[]`.
- 저장 시 `CheckupSummary` 영속(3.1) — status=REVIEW.

### 4.4 AI 보조 + 검토 게이트 (P1)
- `ai-interpret`(종합 해석)·`ai-followup`(추적 권고)을 **초안**으로 종합소견/권고에 삽입.
- 삽입 시 `aiProvenance`(모델·프롬프트버전·스냅샷) 기록 + **검토 확인 체크박스**("AI 보조 초안을 검토했으며 검진의 책임으로 확정") 통과 후에만 서명 가능(간호 F-4 동일 패턴).

### 4.5 검토·전자서명 (P0)
- 서명 게이트: ① 미완료 판독 0 ② 작성자 = 검진의(자격) ③ (옵션 config `checkup.result.requireFourEyes`) 2차 검토자 승인.
- 서명 = `status=SIGNED`·`signedBy/signedAt`·`CheckupVisit.status=COMPLETED`. 기존 진료 전자서명(SmartSign/sign 연계) 재사용.
- 정정: 서명 후 수정은 `amend` → 신규 SIGNED + 원본 AMENDED(원본·이력 보존, 진료차트 amend 패턴 동일).

### 4.6 결과서 발급·배포 (P1)
- 서명 완료 시 `generateCheckupResultPdf` 본문으로 **IssuedDocument 발급**(documentType=`CHECKUP_RESULT`·발급번호·진위 QR·해시) — 의무기록 발급 체계 재사용([medical-record-issuance], document.service headless PDF).
- 배포 채널: ① **환자 포털** 게시(다운로드) ② **단체검진** 계약기관 일괄(`CheckupContract` 연계) ③ 우편/방문(수령 이력).
- 발급 이력·SLA·수수료(해당 시)는 의무기록 발급 리포트와 동일 체계.

### 4.7 추적관리 연계 (P2)
- overallGrade C1/C2/D1 또는 recommendations에 추적 항목 포함 시 `/his-checkup/follow-ups` 추적 대상 자동 등록 + CRM 리콜 캠페인 연계([crm]).

---

## 5. 화면 설계

| 화면 | 경로 | 보강 |
|------|------|------|
| 소견/판독 대기 | `/his-checkup/review`(현행) | 미완료 판독 게이트 표시·필수영역 강조 |
| 결과서 작성 | `/his-checkup/visit/[id]`(현행 확장) 또는 신규 `/his-checkup/visit/[id]/report` | 좌(자동판정·판독) / 우(종합소견 편집·AI초안·검토체크·서명) |
| 결과서 미리보기/발급 | 결과서 작성 화면 내 | HTML 미리보기 → 서명 → 발급 → 포털 게시 |
| 검진 통계 | `/his-checkup/stats`(현행) | 판정 분포·발급 SLA |

작성 화면 구성(우측 패널):
```
[종합 등급]  A · B · C1 · C2 · D1 · D2   (자동 제안: C1)
[영역별 판정]  표(영역·등급·소견) — 판독에서 자동 채움·수정
[의사 종합소견]  textarea  [✦ AI 종합해석 초안]
[권고 사항]  목록 추가  [✦ AI 추적권고 초안]
[☑ AI 보조 초안을 검토했으며 검진의 책임으로 확정합니다]  (AI 사용 시 필수)
[임시저장]            [검토 요청]   [전자서명·발급]
```

---

## 6. API 설계

### 6.1 현행 재사용
- `GET /api/v1/checkup/visits/:id/results` · `POST .../results`
- `GET .../grade-summary` (자동 판정 집계)
- `GET /api/v1/checkup/interpretations` · `POST /interpretations/:id/complete`
- `GET .../summary` · `POST .../summary` (보강)
- `GET .../result-pdf?format=html|pdf`
- `GET .../ai-interpret` · `.../ai-followup`

### 6.2 신규/보강
| EP | 설명 |
|----|------|
| `POST /checkup/visits/:id/summary` (보강) | overallGrade·sections·recommendations·doctorOpinion 영속 저장(status=REVIEW) |
| `POST /checkup/visits/:id/summary/sign` | 검토 게이트 통과 후 전자서명 → SIGNED·COMPLETED |
| `POST /checkup/visits/:id/summary/amend` | 서명 후 정정(원본 AMENDED·신규 SIGNED) |
| `GET /checkup/visits/:id/readiness` | 서명 가능 여부(미완료 판독·필수영역·검토자) 점검 |
| `POST /checkup/visits/:id/issue-result` | 결과서 IssuedDocument 발급(서명 선결) |
| `POST /checkup/visits/:id/distribute` | 포털 게시·단체기관·우편/방문 배포 + 수령 이력 |

---

## 7. 권한·보안·법적 근거

- **권한**: 판독=판독의/검사과, 종합소견 작성·서명=검진의(DOCTOR), 발급·배포=원무/검진센터. RBAC + (옵션) 4-eyes.
- **법적 근거**: 건강검진기본법·국가건강검진(일반/암) 판정·통보 의무, 의료법 §17(소견서)·§21(기록 열람), 개인정보보호법(민감정보·결과 통보 동의).
- **보존·진위**: 발급본 불변·해시·진위 QR(IssuedDocument), 정정 amend 이력 보존, 조회·발급 감사 로그.
- **AI 안전**: AI는 초안 보조만, provenance 기록 + 검토 게이트 필수(자동 확정 금지).

---

## 8. 단계 (Phase)

| 단계 | 범위 | 핵심 |
|------|------|------|
| **P0** | 결과서 영속·작성·서명 | CheckupSummary 확장(마이그레이션)·summary 영속·서명 게이트(미완료 판독 0)·정정 amend·자동 플래그 |
| **P1** | AI 검토 게이트 + 발급/배포 | AI 초안 provenance+검토체크·IssuedDocument 발급(CHECKUP_RESULT)·포털 게시 |
| **P2** | 단체·국가검진·추적 | 단체검진 기관 일괄 배포·국가검진 판정/통보 서식·follow-up·CRM 리콜 |

> P0의 스키마 변경은 마이그레이션 필요(배포 시 `prisma generate`·백업 선행 — deploy 규칙 준수).

## 9. Out of Scope (현 기획 제외)
- 검사 장비 인터페이스 원천 결과 수집(검사실 모듈 소관)
- 외화/수수료 정산(ERP 담당)
- 공단 EDI 실연동(시뮬레이션 → 실연동 어댑터 전환 별도)

---

## 9-1. 구현 상태 (2026-06-30)

- ✅ **검토 완료 게이트(P0 핵심)**: `getResultReadiness(visitId)` + `GET /checkup/visits/:id/result-readiness` — 차단 사유(NO_RESULTS·PENDING_INTERPRETATION·NO_SUMMARY·NO_GRADE·NO_SECTIONS·ALREADY_SIGNED) 반환. `signSummary`는 `force` 미지정 시 readiness 미충족이면 `RESULT_NOT_READY`로 서명 차단(ADMIN은 `{force:true}`로 우회·기록). 스키마 변경 없음. 운영 검증 완료.
- ✅ **결과서 정식 발급(P1)**: 서명 완료 시 `IssuedDocument`(documentType=`CHECKUP_RESULT`·발급번호 `WRB-CHECKUP_RESULT-YYYYMMDD-NNNN`·hash·진위 QR `/verify/document/{issueNo}`·동결 snapshot) 자동 발급. 멱등(visit당 1건 재사용)·best-effort(서명 무영향). `signSummary` 반환에 `issueNo` 포함. DocumentModule 주입. 운영 검증.
- ⏸ 후속(미구현): 4-eyes 2차 검토자·AI 초안 provenance/검토체크·포털 결과서 다운로드 전용 EP·단체검진 일괄 배포·국가검진(공단) 서식(§4.4·4.6·8 P1~P2).

## 10. 수용 기준 (P0)
- 종합소견 저장 후 재조회 시 overallGrade·sections·recommendations가 **DB에서 그대로 재현**(동적 재계산 비의존).
- 미완료 판독이 있으면 서명 차단(readiness=false), 0이면 서명 가능.
- 서명 후 결과서 PDF의 판정·소견이 **서명 시점으로 고정**(이후 마스터 변경 무영향).
- 서명 후 수정은 amend로만 가능(원본 보존).
