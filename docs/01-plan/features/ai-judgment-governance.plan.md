# AI 판단 거버넌스 — 기획서 (정본/제안 분리 · 출처 추적 · 수용 이력 감사)

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/src/modules/ai-call-log/ · apps/web/src/app/(main)/admin/ai-oversight/page.tsx · apps/api/src/modules/ai-oversight/ai-oversight.controller.ts:73 · 잔여: P3 정본 6종 aiProposalId provenance(사람); P4 SaMD 선언서·ISO 14971·IEC 62304·no-training 계약(사람); §6 D6 추론 위치·PHI 경계(사람)

- 이 문서는 질의서 대비 평가(필수 53: A9·B16·C15·D12)에서 드러난 **공백을 하나로 모은 회수 계획**이다. 등급·근거 원문은 상위 정본 §2 에 있고 여기서 반복하지 않는다.
- 🔴 사람 결정은 이 문서가 아니라 **결정 등록부(`decision.registry.ts` · `/admin/decisions`)에 등재**한다. §6 표는 등재 대상 목록이다.

---

## §0 축 정의 — 무엇이고 무엇이 아닌가

**이것이다**: AI 산출물이 정본이 되기까지의 **경로를 기록·증명**하는 층. ① 제안(review-pending)을 일급 레코드로 ② 상태 전이(generated→presented→accepted/edited/rejected/expired)를 원장으로 ③ 모델·프롬프트·입력 스냅샷을 제안에 ④ 정본에 provenance ⑤ 그 전부를 사람·위원회가 지표로 보는 화면.

**이것이 아니다**: 새 AI 기능·새 스킬·모델 성능 개선. 자동실행 허용 범위를 넓히는 일(그건 `policy.ai.autonomyScope` 의결 몫). SaMD 인허가 신청 자체(문서 준비까지만).

**이미 있어 다시 만들지 않는 것**(상위 정본 §2 의 A·B): 서명·해시체인·TSA·amend(2.3) · 3상태 `AI/FALLBACK/UNAVAILABLE`(`ai-verify.ts`·`ai-grounding.ts`) · `AI_ORIGIN_TEXT` 표기·가드 · `PatientAiConsent`·생체 동의 · FHIR R4·SMART scope·접근 원장 3종 · `@Roles` 53/53 · 간호기록 provenance 6컬럼+HMAC(**이 축의 유일한 완성형 — 일반화의 선례**) · `CheckupExplainerContent` 상태기계·version+1·contentHash(**제안 상태기계의 선례**).

## §1 실측 요약 (2026-09-09 · 코드·문서 기준 · 운영 DB 미조회)

| 층 | 핵심 사실 | 등급 |
|---|---|---|
| 제안 레이어 | 제안 전용 테이블 없음 — 산출물이 세션 JSON·정본 내장·감사행·Redis 4갈래 · 상태기계 없음(`APPLIED` 는 죽은 enum) · presented·rejected·expired 0 · 보존정책 0 | C5·D3 |
| 모델 관리 | 레지스트리 없음 · 모델 태그 코드 상수 12곳 · model 기록 3곳 중 진짜 1곳 · 롤백 절차 없음 | D5 |
| 감독 | 거부 축 없음 · 축은 resourceType 만 · 드리프트·PMS·이상알림·검토시간 0 · 감사 앵커가 `changes` 미포함 | C2·D2 |
| 정본 provenance | 간호기록만 완성 · Encounter 3컬럼 중 1 죽음 · 판독·검사·오더·퇴원요약·동의서 0 · FHIR Provenance 0(내보내면 AI 흔적 소실) | B |
| 경계·규제 | SaMD 전사 선언 없음(자기진단 S4 ≈25) · ISO 14971·IEC 62304 저장소 0 · 의료기기·AI 위원회 실체 없음 · 학습 미사용 증명 없음 · 모델 라이선스 검토 0 | C4·D5 |
| 즉시 위험 | R1 AI egress 가 운영 모드 무시 · R2 승인 없는 정본 write 2경로 · R3 AI 기능 6개 근거 없이 ON · R4 egress 호스트 제한 미설정 · R5~R12 | — |

## §2 설계

### 2.1 제안 레코드 정본 — `AiProposal` (신설 · 일급 개념)

```
AiProposal
  id · kind(SOAP_DRAFT|NURSING_DRAFT|DISCHARGE_DRAFT|CONSENT_DRAFT|REFERRAL_DRAFT|MDT_SUMMARY|LAB_INTERPRET|RX_WARNING|CODE_MAPPING|…)
  targetType · targetId(정본 참조 · @db.Uuid · 없으면 ZERO_UUID+targetKey)  · patientId
  modelRef(→AiModelRelease) · promptVersion · inputSnapshotHash(sha256) · inputSnapshotRef(선택·PHI 미포함 요약)
  contentHash · contentEnc(초안 본문 — 필드 암호화 · 보존정책 대상) · confidence(모델 자기보고 · null 허용 — 지어내지 않음)
  source(AI|FALLBACK|UNAVAILABLE) · reasonCode
  status(GENERATED|PRESENTED|ACCEPTED|EDITED|REJECTED|EXPIRED|SUPERSEDED) · version · supersedesId
  createdAt · presentedAt · decidedAt · decidedBy · rejectReason · expiresAt
AiProposalTransition (append-only · 전이마다 1행)
  proposalId · from · to · actorId · at · reason · editDistance · clientContext
```

규약: **제안은 불변** — 수정은 `SUPERSEDED`+새 버전(선례 `CheckupExplainerContent`). `PRESENTED` 는 화면이 실제로 렌더한 시점에 FE 가 1회 보고(노출≠거부 구분 — 질의서 3.2.3). `REJECTED` 는 사유 선택지+자유 입력(강제 아님 — "필수로 강제하면 거짓 데이터"). `EXPIRED` 조건 = `expiresAt` 경과 · 입력 스냅샷 해시 변경 · 모델 릴리즈 폐기. 정본 반영은 **기존 정본 서비스 재사용**(현행 A)이고 `ACCEPTED/EDITED` 전이는 정본 쓰기와 **같은 트랜잭션**(3.3.2 회수). 승인 시점에 `inputSnapshotHash` 재계산이 다르면 **경고하고 막지 않는다**(사람이 재확인·사유 기록).

이관: 현행 4갈래(ScribeSession.draftSnapshot · NursingNote.aiSourceSnapshot · AuditLog AiDraftApply/Outcome · Redis 브리핑)는 **읽기 호환을 유지**하고 신규 생성부터 `AiProposal` 로 쓴다. 간호기록 `aiSourceSnapshot` 은 `AiProposal` 참조(`aiProposalId`)를 추가하되 기존 컬럼은 유지(소비처 6곳 확인 후 이연 제거).

### 2.2 모델 레지스트리 — `AiModelRelease`

`id · provider(WeRU.B) · modelTag(qwen2.5:14b…) · digest · deployedAt · retiredAt · approvedBy · approvalRef(→결정 등록부 키) · notes`. 모든 AI 호출은 `aiEgressFetch` 단일 경로를 지나므로 **거기서** 요청 모델 태그와 응답 `model_used` 를 `AiCallLog(PHI 없음: skill·modelRef·latency·source·reason·verifyFailed·proposalId)` 에 남긴다(현행 `outcomeMeta` 확장). 코드 상수 12곳의 태그는 `ai.model.<skillGroup>` 설정으로 수렴하되 **미설정=현행 상수 유지·화면에 "코드 고정" 고지**(기존 `ai-settings` 고지 문화 유지). 롤백 = 설정값 되돌리기 + `AiModelRelease.retiredAt` + 감사행. 자동 업데이트 없음을 **문서가 아니라 `AiCallLog` 로 증명**(기간별 modelRef 분포 = 5.2.5).

### 2.3 감독 화면 — `/admin/ai-oversight` (신설 · 화면번호는 `OFF_NAV_SCREENS` 규약)

- 수용/수정/거부/만료 비율 × 기간·부서·사용자·modelRef·kind — **분모 병기·표본 0=산출 불가**(폴백 금지).
- 검토 소요시간(presentedAt→decidedAt) 분포 · "무검토 승인 의심"(하위 5% 백분위 미만·연속) · 거부율 급변(자기 이력 p95×2 — 감시자 임계 규약) → 감시자(sentinel) 실시간 축에 지표 2종 추가(알림은 신규/재발만).
- 환자별 재구성: `record_timeline` 12번째 트랙 `AI_PROPOSAL`(제안·전이·누가 승인/수정/거부·원본 해시). 정본 `TIMELINE_TRACKS` 에만 추가.
- PMS export: `AiProposal`+`Transition`+`AiCallLog` 를 **CSV·FHIR Bundle(Provenance+DocumentReference)** 로 기간 내보내기 — 4-eyes 승인·감사행·PHI 는 가명(`aiPseudonymousId`).
- 위원회 보고 지표 세트: 위 지표의 월간 스냅샷을 `CommitteeAgenda.sourceRef=AI_OVERSIGHT` 안건으로 자동 생성(초안·의결은 사람).

### 2.4 정본 provenance 일반화 (사람 결정 `ai.draftProvenanceSchema` 뒤)

간호기록 6컬럼 모양을 정본으로 **`Encounter·DischargeSummary·ConsentForm·ImagingResult·LabResult·Order`** 에 `aiProposalId`(nullable) 하나만 추가(6컬럼 복제가 아니라 참조 — 정본이 둘이 되지 않게). FHIR 아웃바운드에 `Provenance` 리소스(agent=Device(modelRef)·activity·entity=AiProposal) + 정본 리소스 `meta.tag=machine-assisted` — 내보내도 AI 관여가 남는다(2.5 회수). `nullable` 추가 전 널 아님으로 읽는 소비처 grep(CLAUDE.md §8).

### 2.5 경계·운영 안전 (코드로 닫는 것)

- **R1/R4** ✅ P0-A(2026-09-09): `AI_EGRESS_ALLOWED_HOSTS` 가 비면 공개 호스트 전송 **차단**(fail-closed·부팅 1회 ERROR·사설/loopback 은 통과) · 전송 감사 라인에 `mode` 기록. 운영 `.env` 에 `example.org` 등재(AI 서버가 같은 기계). 🔴 **모드 기반 일괄 차단(REAL 아니면 외부 전송 금지)은 채택하지 않았다** — 운영이 REHEARSAL 이고 DB 가 시드라 지금 막으면 보호되는 실환자 없이 시연만 죽는다. 리허설에 실환자 데이터가 들어오는 시점(D6·리얼 전환 절차)에 `ai.egress.nonRealBlock` 게이트로 다시 결정한다. 로그의 `mode` 는 빌드 상한이라 실효 모드(런타임 토글)와 다를 수 있음을 주석에 명시.
- **R2** ✅ P0-B(2026-09-09): MDT auto-summary 는 응답 초안만(저장 0)·사람이 편집 후 `PATCH /mdt/cases/:id` 로 저장(`DraftBanner`·`recordDraftApplied`) · 의뢰서 초안은 협진을 만들지 않고 `sign()`/`signAndSend()` 에서 정본 `ConsultationService.create` 재사용(협진 생성 실패는 서명을 되돌리지 않고 `consultationId:null` 로 말함 — 서명 롤백 여부는 사람 판단). P1 에서 `AiProposal(MDT_SUMMARY)` 로 승격.
- **R5** 감사 앵커 `dataHash` 에 `changes` 포함(기존 앵커와 호환: `hashVersion=2`) · 해시체인 `prevHash` 를 컬럼으로 영속(선택·P2).
- **R6** `refreshApiKeyIfNeeded` 자동 재발급 제거 — 401 은 `UNAVAILABLE(AUTH)` 로 말하고 사람이 키를 교체.
- **R7** 컨시어지 폴백을 `SkillEnvelope` 로 · `AiAssistantPanel` `confidence:0.7` 하드코딩 제거(미보고=null).
- **R8** 코드 매핑 "전체 적용" `autoConfirm` 제거 → 미리보기+건별 확인(정본은 `/mapping-review`).
- **R10** go-live AI 항목 ↔ 등록부 `REQUIRED_BEFORE` 4건을 **한 정본에서 파생**(개원 축 규약: 항목은 상태를 갖지 않고 decisionKey 로 파생) · 안전 게이트 관제 분류기가 `ai.*`·`consult.ai.autoReply`·`scribe.enabled` 등 **AI 스위치를 별도 섹션으로 노출**(게이트가 아니라 "켜진 AI 기능"으로 — 실제보다 안전하게 말하지 않는다).
- **R12** `ScribeSession.aiModel/aiPromptVersion` 실제 기록 · `APPLIED` 전이 배선 또는 enum 제거 · `scribe.transcript.retention` 소비 또는 "미배선" 고지 · `Encounter.aiEditDistance` writer 배선.

## §3 단계

| 단계 | 내용 | 침습도 | 선행 |
|---|---|---|---|
| **P0 즉시 위험**(1주) | R1·R4 모드/호스트 차단 · R2 승인 게이트 · R5 앵커 changes · R6 자동 재발급 제거 · R7 폴백 정직성 · R8 autoConfirm 제거 · R12 죽은 정본 · R3 운영 6개 ON 을 화면(`/admin/ai-settings`)에 "근거 없는 ON" 으로 표기 | 낮음 | 없음 |
| **P1 제안 일급화**(3주) | `AiProposal`·`Transition`·`AiModelRelease`·`AiCallLog` 스키마(`--schema` 배포·백업) · `aiEgressFetch` 계측 · SOAP·간호·퇴원요약·동의서·의뢰서·MDT 6 kind 신규 생성부터 적용 · PRESENTED FE 보고 · REJECTED UI · 보존정책 `AI_PROPOSAL` 등재(값은 D1 결정 뒤 · 그전엔 REPORT_ONLY) | 중간 | P0 |
| **P2 감독**(3주) | `/admin/ai-oversight` · 타임라인 `AI_PROPOSAL` 트랙 · 감시자 지표 2종 · PMS export · 위원회 월간 안건 자동 생성 | 낮음 | P1 |
| **P3 provenance 일반화**(2주) | 정본 6종 `aiProposalId` · FHIR Provenance · KR Core `meta.profile` 선언은 별도 트랙 | **높음**(스키마) | **사람 결정 `ai.draftProvenanceSchema`** |
| **P4 경계 문서·사람**(병행) | SaMD 경계 선언서(S4 ≈25 목록을 intended use 별로) · ISO 14971 위험관리 파일·IEC 62304 변경관리 템플릿 초안 · 모델 라이선스 검토표 · no-training 계약 확인 · 보존기간 정본 단일화 · 위원회 신설 | 없음 | 사람 |

질의서 §10 단계와의 대응: 질의서 0(파사드)=이미 있음 · 1(제안+감사 별도 DB)=P1 · 2(비의료기기 AI 검증)=P2 지표가 실제로 수집되는지로 판정 · 3(SaMD 투입)=P4 문서 뒤 · 4(정본 provenance)=P3.

## §4 병렬 에이전트 실행 설계 (P1·P2 · 사람 지시 시)

- 공통: 파일 소유권으로 분할(스키마 1기 선행 → 서비스/컨트롤러 기당 kind 1~2종 → FE 기당 화면 1) · 목은 정본 실제 반환 모양 · 가드는 재주입 역검증 · `git add -A` 금지 · 트리 전체 git 금지.
- P1 5기: ①스키마+마이그레이션+`AiProposalService` 코어 ②SOAP·퇴원요약 ③간호·동의서 ④의뢰서·MDT(R2 동반) ⑤`aiEgressFetch` 계측+`AiModelRelease`. P2 4기: ①oversight API ②oversight 화면 ③타임라인 트랙+감시자 지표 ④PMS export.
- 검증 프로토콜: 각 kind 마다 **실제 EP 를 눌러** `AiProposal` 행+전이 행이 생기는지 운영(리허설) 실측 · 0행이면 쓰기 경로부터 의심.

## §5 가드 (전부 재주입 역검증 · `assert count==1`)

| 가드 | 무엇을 막나 |
|---|---|
| `ai-egress-mode-guard.spec` | `aiEgressFetch` 외 AI 호스트 fetch 0 · REAL 아닌 모드에서 외부 호스트 전송 0(대조군: 원내 호스트는 통과) |
| `ai-proposal-immutability.spec` | `aiProposal.update` 로 `contentEnc/contentHash` 변경 0 · 전이는 `Transition` create 만 |
| `ai-write-requires-proposal.spec` | AI 응답을 정본(`mdtCase.clinicalSummary`·`consultation.create`·`referralLetter.content`) 에 바로 쓰는 코드 0 |
| `ai-call-log-model.spec` | `aiEgressFetch` 경유 호출마다 `AiCallLog.modelRef` 기록(하드코딩 태그 상수 신규 추가 0 — 기준선 12 동결) |
| `audit-anchor-covers-changes.spec` | `dataHash` 입력에 `changes` 포함(재주입: 제외하면 실패) |
| `ai-confidence-not-invented.spec` | FE 에서 `confidence:` 리터럴 상수 0 |
| `ai-oversight-denominator.spec` | 비율 응답에 분모 필수·표본 0 은 `null`+`산출 불가`(대조군: 표본 있으면 값) |
| `timeline-tracks-canon.spec` | `TIMELINE_TRACKS` 에 `AI_PROPOSAL` 등재·FE 필터 집합 일치 |
| `ai-switch-visible.spec` | 안전 게이트 관제 응답에 `ai.*` 스위치 섹션 존재·운영 ON 목록이 등록부 `policy.ai.clinicalFeatureScope` 와 집합 일치 |

## §6 사람 결정 표 (★ 착수 차단 / 🧑 병행) — **전부 결정 등록부에 등재한다**

| # | 결정 | 층 | 등록부 | 막는 것 |
|---|---|---|---|---|
| ★ | 추론 위치·PHI 경계(D6) | LH | 있음 `legal.phiBoundary.gpuTier` · `legal.aiEgress.transferScope` — **2026-07-15 부터 미결** | P0 R1 의 "원내 호스트 예외" 정의 · 모든 외부 전송 |
| ★ | 운영 ON 6개 기능의 근거 확인(R3) | IC | 있음 `policy.ai.clinicalFeatureScope` | 그대로 켜둘지·끌지 |
| ★ | provenance 스키마 일반화(P3) | IC | go-live `ai.draftProvenanceSchema` → 등록부 키로 승격 | P3 전체 |
| 🧑 | 거부된 제안 보관(D1) | IC | **신설** `policy.aiProposal.retention` | `AI_PROPOSAL` 보존 값 |
| 🧑 | 책임 귀속 규정(D2) | LH | **신설** `legal.ai.accountability` | 승인 UI 문구·서명 규정 |
| 🧑 | 모델 교체 재검증 범위(D3) | IC | **신설** `policy.aiModel.revalidation` | `AiModelRelease.approvalRef` 요구 수준 |
| 🧑 | 환자 고지 범위(D4) | LH | **신설** `legal.ai.patientDisclosure` | 진료기록 AI 표기·동의서 문구 |
| 🧑 | 원내 데이터 학습(D7) | LH | **신설** `legal.ai.trainingUse` | no-training 계약·옵트아웃 |
| 🧑 | AI 승인 권한자(D8) | IC | **신설** `policy.ai.approverRoles` (+`UserRole` 전공의 신설 여부) | 7.8 역할 차등 |
| 🧑 | 운영 주체(D9) | IC | **신설** `policy.ai.componentOwnership` | 레지스트리·oversight 운영 |
| 🧑 | 의료기기·AI 거버넌스 위원회 신설(R9) | IC | 위원회 엔진 시드 추가 + 등록부 `authority` 실체화 | AI 결정 5건 의결 |
| 🧑 | SaMD 해당 판정·유권해석(5.1.1) | LH | 있음 `legal.ai.deviceClassification` | `policy.ai.autonomyScope`·기능 범위 |
| 🧑 | 감사 로그 보존 정본(R11) | LH | **신설** `legal.auditLog.retention` | RetentionPolicy `legalConfirmed` |
| 🧑 | SNOMED CT·KR Core 채택 | IC | 기존 용어 트랙 | 4.1·4.7 |

## §7 진행 기록

- 2026-09-09 기획서 작성(조사 5건·필수 53 등급 완료) · 착수 전 · P0 는 사람 결정 없이 가능(단 R1 의 원내 호스트 정의는 D6 미결 시 "외부 호스트 전부 차단·원내 예외 없음"이 안전측 기본값)
