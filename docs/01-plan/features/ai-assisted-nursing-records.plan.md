# 간호기록 AI 보조 — 기획서 (Assistive-First Nursing Documentation)

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/web/src/components/ai/NursingAiDraftPanel.tsx · apps/api/src/modules/nursing/dto/create-nursing-note.dto.ts:82 · 잔여: 없음

> 작성: 2026-06-29 / 상태: Plan v1.3 (보완: §8 **간호차트 UI/UX 구현 명세** 확장 — 화면별 통합점·신규/재사용 컴포넌트·초안패널·근거칩·검토확인 게이트·상태기계·mockup / v1.2: §10 JCI 인증 정합(IPSG·AOP재평가·MOI.11.1.1 통제·SQE·GLD/QPS) / v1.1: 그라운딩·출력계약·지연·위급값·SaMD·DoD)
> 한 줄: 간호기록을 **AI가 대체하지 않는다**. 구조화된 임상 데이터(활력징후·EWS·낙상·투약·오더·직전 기록)를 근거로 **초안·요약·간호진단 제안·품질검사**를 생성해 간호사에게 제시하고, **간호사가 검토·수정·서명**하는 _Human-in-the-Loop_ 보조 시스템을 표준화·확장한다. 법적 작성·서명 책임은 100% 간호사(의료법 §22).

---

## 0. 핵심 원칙 (이 문서 전체를 지배)

| # | 원칙 | 의미 | 코드/강제점 |
|---|------|------|------------|
| P-1 | **보조 우선(Assistive-First)** | AI는 초안·제안·요약·검사만. **확정/서명은 항상 간호사.** 자동 서명·자동 확정 금지. | AI 경로는 `draft:true`로만 생성, `sign` 엔드포인트 미호출 |
| P-2 | **법적 무결성 불변** | 간호기록=법정 의무기록(의료법 §22). `status(DRAFT/SIGNED/AMENDED)·signedBy·signedAt`·"작성 간호사만 서명" 규약 **그대로**. | `nursing.service.ts:249 signNote`(nurseId 검증) |
| P-3 | **근거 기반(Grounded)·환각 차단** | AI 초안은 **주입된 실데이터만** 근거. 데이터 없는 임상사실 생성 금지. 각 항목에 **출처 표기**. | §4.2 그라운딩 규약·출력계약 검증 |
| P-4 | **출처·프로비넌스(Provenance)** | AI가 손댄 기록은 **AI 보조 표시**(모델·프롬프트버전·근거 스냅샷·수정량) 보관 → 감사·투명성. | §6 모델 컬럼·§9 감사 |
| P-5 | **점진·옵트인** | 신규 동작은 **config 게이트(기본 OFF)**. 병동/직군 파일럿 → 확대. | 직전 임상무결성 백로그 패턴 |
| P-6 | **안전 게이트** | 위급값·고위험 판단은 AI가 **단정 금지·플래그만**. 임상 결정 자동적용 0. 기존 위급값/EWS 경보 경로 **무간섭**. | §4.4 위급값 상호작용 |

> **불변식(invariant)**: _SIGNED 간호기록의 의학적 진실성·법적 책임은 서명 간호사에게 있으며, AI는 그 책임을 대신하거나 줄이지 않는다._ 본 기획의 모든 기능은 이 불변식을 깨지 않는 선에서만 동작한다.

---

## 1. 배경·문제

- 간호사 업무 중 **기록 작성 비중 과중**: 입원 병동 간호기록(SOAP/DAR/DARE/NARRATIVE), 인수인계(SBAR), 간호초기평가, 간호과정(NANDA-NIC-NOC), 투약확인(MAR), I/O — 교대마다 반복 서술.
- 데이터는 이미 **구조화 저장**(활력징후·EWS·낙상·투약·오더)되어 있는데 간호사가 **다시 손으로 서술**(이중 입력).
- HIS엔 이미 **부분 AI 보조**가 산발적으로 존재 → 통합·표준화 필요:
  - `suggestNandaDiagnosis()` NANDA 추천 (`nursing.service.ts:23`, `clinicalQa` 호출)
  - `summarizeHandoff()` 인수인계 요약 (`nursing.service.ts:40`, `autoSoap` 호출)
  - `chartQa()` 기록 품질·일관성 검사 (`medical-ai.service.ts:953`)
  - `autoSoap()`(`:754`)·`realtimeDdx()`(`:671`) — 구조화 JSON 출력 패턴 보유
- 핵심 자산: medical-ai가 이미 **"근거 프롬프트 → JSON 출력 → confidence·references"** 패턴(`autoSoap:776`)을 쓴다. 간호 초안도 동일 패턴으로 안전하게 확장 가능.

**결정(요구사항)**: 간호기록 **대체가 아니라 보조**. AI 초안→간호사 검토·수정·서명. 무결성/서명 규약 불변, 신규 동작은 config 게이트.

---

## 2. 목표·비목표

**목표(측정 가능)**
- 초안 **채택률** ↑ / **수정량(edit distance)** 적정 / **작성시간** ↓(파일럿 A/B, §11).
- **근거 기반 초안 자동 생성**: 구조화 데이터 → SOAP/DAR 초안(O·일부 A 자동, 출처 부착).
- 간호과정(NANDA-NIC-NOC) **제안 고도화** + NOC 성과 평가 보조.
- 교대 **SBAR 인수인계 자동 요약**, 미서명/지연 브리핑.
- 모든 AI 산출물에 **출처·프로비넌스** 부착, 감사 가능.

**비목표(명시)**
- AI 자동 서명·자동 확정 — **절대 안 함**(P-1).
- 임상 의사결정 자동적용(투약/오더 변경·생성) — 안 함.
- NursingNote↔UniversalNursingNote **통합** — 별개 용도라 통합 안 함(백로그 #10 재평가 유지). 보조는 각각 적용(§4.6).
- 음성 받아쓰기(STT) 실시간 입력 — 장기(§12 후순위).
- 오프라인(FR-08) 미포함.

---

## 3. 현황 — 재사용할 AI 빌딩블록 (신규 최소화)

| 기능 | 현재 위치 | 입출력 | 보조용 확장 |
|------|----------|--------|------------|
| LLM 호출 | `medical-ai.service.ts` `chatLlm`→`/api/chat`(gpuKey Bearer·30s config 캐시) | messages→answer | 그대로 |
| 구조화 출력 패턴 | `autoSoap:754`(프롬프트→`{assessment,plan,confidence,references}` JSON) | S/O→A/P JSON | **간호 초안 출력계약의 원형**(§4.3) |
| NANDA 추천 | `suggestNandaDiagnosis:23`(`clinicalQa`, `source:'AI'\|'FALLBACK'`) | assessment→NANDA | 복수안·R/T·신뢰도·NIC/NOC 연계(§4.5) |
| 인수인계 요약 | `summarizeHandoff:40`(최근10 S/O/A→autoSoap) | notes→A/P | SBAR·shift 경계(§4.6) |
| 품질검사 | `chartQa:953`(룰+AI→`{score,grade,issues}`) | S/O/A/P→issues | 간호룰 추가(§4.7) |
| 무결성/서명 | `createNote:223`·`signNote:249`(작성자만)·`amendNote:262`(addendum) | — | **불변** |
| 입력 데이터원 | PreVisitVitals·ProgressNote.vitalSigns·EarlyWarningScore·FallRiskAssessment·MedicationAdministration·Prescription/Order·직전 NursingNote | — | 초안 근거(§5) |

→ **신규 모델/엔드포인트 최소**. 기존 자산을 간호 작성 UX에 통합 + 그라운딩·프로비넌스·게이트가 본 기획의 실제 작업.

---

## 4. 기능 설계 — AI 보조 카탈로그

각 기능 단일 패턴: **(근거 집계) → AI 초안(JSON) → 검증·출처부착 → DRAFT 저장 → 간호사 검토·수정 → 서명**. AI는 DRAFT만.

### 4.1 F-1. 근거 기반 간호기록 초안 (핵심)
- **대상 노트타입**(NursingNote 실제 필드와 1:1):
  - **SOAP** → `subjective`(간호사 입력 유도) · `objective`(자동: vitals·MAR·EWS 서술) · `assessment`(위험 요약 초안, 단정 아님) · `plan`(오더/간호계획 근거)
  - **DAR/DARE** → `focus` · `data`(객관 자동) · `action` · `response` (`education`=DARE-E)
  - **NARRATIVE** → `content` 시계열 서술 초안
- **자동 채움 우선순위**: O(객관)는 데이터에서 **결정적으로** 생성(LLM 의존 최소·환각 위험 0), A/P는 LLM 초안 + 출처. S는 간호사 몫.
- **저장**: `createNote(draft:true)` → `status='DRAFT'`(기본값 SIGNED이므로 **draft 플래그 필수**), `aiAssisted=true`.

### 4.2 그라운딩 규약 (환각 차단의 핵심)
1. **데이터 우선**: 객관 항목(vitals·투약시각·EWS 점수)은 **코드로 직접 서술**(템플릿), LLM에 "생성"시키지 않음.
2. **시스템 프롬프트 규칙**(autoSoap 패턴 강화):
   - "제공된 데이터에 **없는 임상 사실을 만들지 마라**. 모르면 비워라."
   - "각 Assessment/Plan 문장은 제공 데이터의 **근거 id를 인용**하라."
   - "JSON만 출력. 한국어. 간호 표준 용어."
3. **출력 검증(서버)**: 근거 id가 없는 A/P 문장은 **드롭 또는 '검토 필요' 표시**. `confidence < 임계`면 초안 표시 약화.
4. **온도 낮춤**(temperature ~0.3, autoSoap는 0.4) — 창의성 억제.

### 4.3 출력 계약 (structured)
```jsonc
// ai-draft 응답(서버가 medical-ai 결과를 검증·정규화 후 반환)
{
  "noteType": "SOAP",
  "draft": {
    "subjective": null,                 // 간호사 입력 유도(자동 생성 안 함)
    "objective": "14:00 BP 150/95, HR 92, SpO2 96%, BT 37.8℃; NEWS2 5(MEDIUM); ...",
    "assessment": "활력징후 상승 추세, 낙상 고위험(Braden 14).",
    "plan": "4시간 간격 V/S 재측정; 낙상 예방중재 유지; 통증 재평가."
  },
  "citations": [                         // 문장↔근거 매핑(UI 칩)
    { "field": "objective", "text": "BP 150/95", "source": "VitalSign", "refId": "vs_...", "at": "14:00" },
    { "field": "assessment", "text": "낙상 고위험", "source": "FallRiskAssessment", "refId": "fr_..." }
  ],
  "confidence": 0.72,
  "model": "weru-b:...", "promptVersion": "nursing-soap-v1",
  "source": "AI"                         // AI 실패 시 "FALLBACK"(빈 구조 템플릿)
}
```
- 파싱 실패/타임아웃 → `source:'FALLBACK'` + 빈 구조 템플릿(간호사 수동, 무중단).

### 4.4 위급값·EWS 상호작용 (안전)
- AI 초안은 **기존 위급값(critical value)·EWS 경보 워크플로를 대체·억제하지 않는다**. 경보는 그대로 발생.
- `priority=CRITICAL` 판단은 AI가 **자동 설정 금지** → 간호사 확정. AI는 "위험 신호 있음(근거 표기)"만 제시.
- AI 초안 생성 실패가 위급 상황 대응을 막지 않도록 **완전 논블로킹**.

### 4.5 F-2. 간호과정(NANDA-NIC-NOC) 제안 고도화
- `suggestNandaDiagnosis` 확장: NANDA **복수 후보 + 관련요인(R/T) + 신뢰도**. 선택 시 `NursingCode` 마스터에서 **연관 NIC/NOC 후보** 제시.
- NOC **성과 평가 보조**: baseline/target 대비 데이터 추이로 `currentScore` 후보 제안 → 간호사 확정(`evaluatedBy`).

### 4.6 F-3. 교대 인수인계 SBAR 요약 / F-5 스테이션 브리핑
- `summarizeHandoff` 확장: shift 경계 기준 미서명·고위험·투약지연·미해결 간호진단을 **SBAR** DRAFT로. (UniversalNursingNote 컨텍스트 노트에 적용 — 법적 NursingNote와 분리)
- F-5: 스테이션 진입 시 한 문단 브리핑(읽기 보조), 행동은 기존 보드 링크.

### 4.7 F-4. 기록 품질·일관성 검사 / F-6 정정문 보조
- `chartQa`에 간호룰 추가: 통증 재평가·낙상중재·투약후 관찰 누락, 활력징후-서술 불일치 경고. **서명 전** 실행, WARNING이면 수정 유도(차단 아님).
- F-6: SIGNED 정정 시 변경점 요약 초안 → `amendNote` 사유로 검토·확정(원본 보존 불변).

---

## 5. 데이터 흐름·입력원

```
[구조화 데이터원]                       [집계·스냅샷]      [AI 보조]        [간호사]              [법적기록]
VitalSign/PreVisitVitals ─┐
EarlyWarningScore ────────┤  근거 수집     ┌──────────┐  초안+출처  ┌──────────┐ 검토·수정 ┌───────────┐
FallRiskAssessment ───────┼─────────────▶ │ grounded │ ─────────▶ │DRAFT 노트 │ ────────▶ │ signNote  │
MedicationAdmin(MAR) ─────┤  (값+refId)    │ medical- │  JSON계약  │+프로비넌스 │ +검토확인 │ →SIGNED   │
Prescription/Order ───────┤                │   ai     │            └──────────┘           │ signedBy= │
직전 NursingNote(N건) ────┘                └──────────┘                                      │ 간호사    │
                                  객관(O)=코드 서술(LLM無)  ·  A/P=LLM+근거(환각차단)         └───────────┘
```

| 데이터 | 모델 | 간호기록 매핑 | LLM 처리 |
|--------|------|--------------|----------|
| 활력징후 | PreVisitVitals·ProgressNote.vitalSigns | O | 코드 서술(생성 無) |
| EWS | EarlyWarningScore(totalScore·riskLevel) | A 근거 | 코드 서술 |
| 낙상 | FallRiskAssessment(score·riskLevel) | A 근거 | 코드 서술 |
| 투약 | MedicationAdministration(시각·상태) | O | 코드 서술 |
| 오더 | Prescription/Order | P 근거 | 코드 서술 |
| 직전 노트 | NursingNote(N건) | 맥락 | LLM 요약(출처표기) |

- **PHI 최소화**: medical-ai 전송 시 직접식별자(성명) 불필요 항목은 **연령/성별/익명 ref**로 축약 가능(현 autoSoap는 성명 포함 — 보조 도입 시 최소화 옵션 검토). 전송은 **내부 GPU(example.org) 경유**, 외부 유출 0.

---

## 6. 데이터 모델 변경 (최소·additive·비파괴)

`NursingNote`(필요 시 `NursingDiagnosis`)에 **AI 프로비넌스** 컬럼 추가:

| 필드 | 타입 | 의미 |
|------|------|------|
| `aiAssisted` | Boolean @default(false) | AI 초안에서 출발 |
| `aiModel` | String? | 모델/버전 |
| `aiPromptVersion` | String? | 프롬프트 템플릿 버전(재현성) |
| `aiSourceSnapshot` | Json? | 초안 근거(집계 데이터 ref·값) + 초안 원문 |
| `aiEditDistance` | Int? | 간호사 수정량(서명 시 계산, §11) |

- **서명·무결성 필드 불변**. 프로비넌스는 감사·품질지표·법적 투명성용.
- 적용: **manual SQL(ADD COLUMN IF NOT EXISTS)** + 배포 시 서버 `prisma generate` 필수(신규 필드).
- 롤백: additive라 컬럼 잔존 무해, 동작은 config OFF로 즉시 회귀.

---

## 7. API 설계 (신규 최소·게이트·검증)

```
POST /api/v1/admissions/:admissionId/nursing-notes/ai-draft
  body: { noteType, shiftType }
  → 근거 집계 → grounded 초안(§4.3 계약) → DRAFT NursingNote 생성(aiAssisted=true·snapshot)
  → 응답: 초안 + citations + confidence  (서명 안 함)

POST /api/v1/admissions/:admissionId/nursing/careplan/ai-suggest   (F-2)
GET  /api/v1/admissions/:admissionId/nursing/handoff/ai-summary     (F-3·summarizeHandoff 래핑)
POST /api/v1/nursing-notes/:noteId/ai-qa                            (F-4·chartQa 간호룰)
```
- 전부 **config 게이트**(`nursing.aiAssist.enabled` 기본 OFF) + `@Roles(NURSE)` + DTO class-validator(전역 whitelist 대비 데코레이터 필수).
- **타임아웃**(예 8s)·실패 시 FALLBACK. medical-ai 지연(과거 504 사례) 대비 **논블로킹·비동기 UX**(§8).
- 감사: `AuditService.safeLog`로 `ai_draft_generated`(actor·admissionId·model·promptVersion) 기록.

---

## 8. FE UX — 간호차트 UI/UX 구현 명세 (구현 가능 수준)

> 본 절은 **기존 간호차트 화면·컴포넌트에 AI 보조를 끼워넣는 실제 명세**다. 신규 화면을 만들지 않고, 검증된 통합점에 컴포넌트를 더한다. 모든 라벨은 **WeRU.B**(브랜드 규약·신규 'AI' 라벨 금지). RHF+Zod·shadcn/Tailwind·toast-store·StatusBadge 기존 패턴 준수.

### 8.0 통합 대상 화면(실측)
| 화면 | 파일 | AI 보조 |
|------|------|--------|
| 입원 간호기록 작성 | `inpatient/[admissionId]/nursing/notes/page.tsx`(SOAP/DAR 폼·상태배지·서명/정정) | **F-1 초안·F-4 품질·F-6 정정**(주전장) |
| 간호 워크스테이션 | `workstation/nursing/page.tsx`(VitalPanel/MarPanel/AssessmentPanel/HandoffPanel) | **F-2 간호과정·F-3 인수인계**(HandoffPanel 확장) |
| 간호 스테이션 보드 | `nursing-station/page.tsx`(30s 폴링·EWS/낙상/미서명) | **F-5 브리핑**(읽기 보조) |
| 초기평가 | `nursing/assessment/page.tsx`(Braden/Morse) | F-2 진단 제안 진입점 |

### 8.1 신규/재사용 컴포넌트 인벤토리
| 컴포넌트 | 신규/재사용 | 위치 | 역할 |
|---|---|---|---|
| `NursingAiDraftPanel` | **신규**(AiSuggestionPanel 응용) | `components/ai/` | F-1 초안 생성·표시·적용/무시 |
| `CitationChips` | **신규** | `components/ai/` | 문장↔근거(출처) 칩 렌더·클릭 시 원본 강조 |
| `AiProvenanceBadge` | **신규**(StatusBadge 응용) | `components/ai/` | "WeRU.B 보조" 배지(노트 카드·작성기) |
| `ReviewConfirmGate` | **신규** | `components/ai/` | "간호사 검토 확인" 체크 → 서명 활성 |
| `AiSuggestionPanel` | 재사용 | `components/ai/AiSuggestionPanel.tsx`(amber·적용/무시·data unwrap) | F-2/F-4 제안 표시 베이스 |
| `StatusBadge` | 재사용 | `ui/StatusBadge.tsx` | DRAFT/SIGNED/AMENDED |
| `FreshnessBadge` | 재사용 | `components/dashboard/FreshnessBadge.tsx` | 근거 데이터 신선도 |
| toast-store | 재사용 | 적용/실패 토스트 |

### 8.2 F-1 작성기 통합 — `notes/page.tsx` (주전장)

**삽입점**: 폼 헤더(noteType/shiftType 선택 아래)에 **「WeRU.B 초안」** 버튼, 저장 버튼 영역 위에 `NursingAiDraftPanel`. 본문 textarea 각 섹션 하단에 `CitationChips`.

```
┌─ 간호기록 작성 ─────────────────────────────[WeRU.B 보조 ●]┐  ← AiProvenanceBadge(초안 출처일 때)
│ [DAR] [SOAP] [DARE] [NARRATIVE]   근무: [DAY▼]              │
│ ┌──────────────────────────────────────────────────────┐ │
│ │  ✦ WeRU.B 초안 생성   [생성]  ← 비동기·논블로킹        │ │  ← 8.3 패널 헤더
│ │  (생성 중) ◴ 근거 수집·작성 중…           [취소]       │ │
│ └──────────────────────────────────────────────────────┘ │
│ S 주관적   [ 환자 호소 입력… (간호사 작성) ]                │  ← S는 자동생성 안 함
│ O 객관적   [ 14:00 BP 150/95, HR 92…(자동) ]              │
│            📎BP 150/95·V/S 14:00  📎NEWS2 5  ← CitationChips│
│ A 간호판단 [ 활력징후 상승·낙상 고위험(Braden14) ]          │
│            📎FallRisk  ⚠검토 필요(근거 약함)               │  ← 근거 약한 문장 표시
│ P 계획     [ 4시간 V/S 재측정… ]   📎Order                  │
│ ─────────────────────────────────────────────────────────│
│ ⚠ 품질검사: 통증 재평가 누락(권고)  [무시] [반영]           │  ← 8.5 F-4 인라인
│ ☐ 위 기록을 검토했으며 간호사 책임으로 서명합니다 (필수)     │  ← 8.4 ReviewConfirmGate
│                                  [임시저장]  [서명] (비활성)│  ← 검토 체크 전 서명 비활성
└───────────────────────────────────────────────────────────┘
```

- **버튼 흐름**: 「생성」 → 비동기 호출(작성기 **잠그지 않음**, 다른 필드 입력 가능) → 완료 시 O/A/P 필드 **채움(전부 편집 가능)** + 칩 렌더 + 패널에 적용/무시.
- **적용/무시**: AiSuggestionPanel 패턴(적용=폼 prefill·`aiAssisted=true`·snapshot 보관 / 무시=초안 폐기, 폼 유지).
- **S(주관)는 자동 채움 안 함**(§4.1) — placeholder로 간호사 입력 유도.

### 8.3 `NursingAiDraftPanel` 명세
- **Props**: `{ admissionId, noteType, shiftType, onApply(draft, citations, provenance), onDismiss }`.
- **상태**: `idle → generating → ready(draft·citations·confidence) → applied | dismissed | error(FALLBACK)`.
- **호출**: `apiClient.post('/api/v1/admissions/:id/nursing-notes/ai-draft', {noteType, shiftType})` (8s 타임아웃·AbortController로 취소).
- **표시**: confidence 낮으면 "초안 신뢰도 낮음 — 면밀 검토" 경고색. `source:'FALLBACK'`이면 "AI 미사용 — 빈 템플릿"으로 표시(무중단).
- **디자인**: AiSuggestionPanel의 amber 액센트·별 아이콘 재사용(일관성).

### 8.4 근거 칩 `CitationChips` + 검토확인 게이트 `ReviewConfirmGate`
- **CitationChips**: 응답 `citations[]`(§4.3)를 필드별로 렌더. 칩 = `source`(VitalSign/EWS/FallRisk/MAR/Order) + 값 + 시각. **클릭** 시 우측 데이터 패널에서 원본 강조(추적성). 근거 없는 A/P 문장은 `⚠검토 필요` 칩.
- **ReviewConfirmGate**: 서명 버튼 위 **체크박스 1개**("검토했으며 간호사 책임으로 서명"). `aiAssisted` 초안일 때 **필수**(미체크 시 `signMutation` 버튼 `disabled`). 수동 작성은 기존대로(선택). → MOI.11.1.1 blind acceptance 차단(§10.2).

### 8.5 F-4 품질검사 인라인
- 서명 직전 `POST /nursing-notes/:id/ai-qa`(chartQa 간호룰) → 결과 `issues[]`를 폼 하단 **인라인 경고**(WARNING=amber, INFO=gray). **차단 아님**(권고). 항목별 [무시]/[반영(해당 필드로 스크롤)].

### 8.6 에디터 상태기계(작성기)
```
빈폼 ─[생성]→ AI생성중 ─완료→ 초안적용(편집가능) ─[검토☑]→ 서명가능 ─[서명]→ SIGNED
  │             │ 실패/타임아웃→ FALLBACK(빈템플릿·수동)                    └ SIGNED 후 [정정]→ AMENDED(F-6)
  └ 수동입력 ──────────────────────────────────────────────→ 검토(선택)→ 서명
```

### 8.7 F-2 간호과정 제안 UI — `workstation/nursing` AssessmentPanel + 초기평가
- 초기평가 저장 후 **「WeRU.B 진단 제안」** → `AiSuggestionPanel`에 **NANDA 복수 후보(체크박스) + 관련요인(R/T) + 신뢰도**. 선택 시 연관 **NIC/NOC 후보** 자동 노출 → 간호사 선택분만 `createDiagnosis`/care-plan 확정.
- NOC 평가: `currentScore` 후보 제안(슬라이더 prefill) → 간호사 확정(`evaluatedBy`).

### 8.8 F-3/F-5 인수인계·브리핑 — `workstation/nursing` HandoffPanel 확장 / 스테이션
- HandoffPanel(기존 "AI I-PASS 생성" 버튼·5단계 표시)을 **SBAR DRAFT**로 확장: shift 경계 미서명·고위험·투약지연·미해결 진단 요약 → 인계 노트 DRAFT(UniversalNursingNote, 법적 노트 분리). 인계 간호사 검토 후 확정.
- F-5 스테이션 브리핑: `nursing-station` 상단에 **한 문단 요약 카드**(읽기 보조·FreshnessBadge). 행동은 기존 행 링크.

### 8.9 상태·로딩·에러·빈 상태
- **로딩**: 스켈레톤/스피너(AiSuggestionPanel 27-38행 패턴). 작성기 비잠금.
- **에러/타임아웃**: 토스트 + FALLBACK 빈 템플릿. "다시 시도" 1회.
- **빈 근거**: 데이터 없으면 해당 필드 "기록 없음" + 칩 없음(생성 금지·§4.2).
- **오프라인/AI OFF**: config OFF면 버튼 미표시(완전 회귀) — 기존 작성 흐름 그대로.

### 8.10 접근성·타블렛·국제화
- **타블렛**(`app/tablet` 별도 기획 정합): 터치 타깃 ≥44px, 「생성」·체크박스·칩 큰 히트영역. 회진 중 초안 검토.
- **접근성**: 칩·경고 색상에 텍스트/아이콘 병기(색맹 대비), 키보드 포커스 순서(생성→필드→검토체크→서명).
- **국제화**: 한국어 우선·NANDA-I 한글명. 라벨 WeRU.B.

### 8.11 디자인 토큰(기존 재사용)
- AI 액센트 **amber**(AiSuggestionPanel)·상태색(DRAFT 회색/SIGNED emerald/AMENDED amber)·EWS 톤(rose/amber/yellow/emerald)·배지 `px-2 py-0.5 rounded-full text-xs`. **신규 토큰 최소.**

---

## 9. 법적·안전·규제·윤리 가드레일

| 영역 | 규약 |
|------|------|
| 의료법 §22(기록·서명·보존) | 작성·서명 책임=간호사. AI=보조 도구로 문서에 명시(프로비넌스). 자동 서명 0. 보존연한·정정(addendum) 규약 불변. |
| **규제 분류(SaMD)** | 본 시스템은 **비자율(non-autonomous)·Human-in-the-Loop 임상 결정 보조(CDS)** — 진단·처방을 **확정하지 않고 제안만**, 간호사 검토·서명 필수. 자율판단·자동확정이 없어 **고위험 의료기기 SW 분류를 회피**하는 설계. (식약처 CDS SW 가이드라인 관점 — 자율성·위해도 낮춤이 분류 핵심.) 도입 전 **규제 자문 1건**(분류 확인). |
| EMR 인증 | 전자의무기록 인증 항목(작성자·서명·변경이력) 영향 없음 — 무결성 필드 불변, 프로비넌스는 추가 정보. |
| 책임 소재 | SIGNED 시점부터 서명 간호사 책임. "검토 확인" 게이트로 미검토 서명 방지. |
| 환각/오류 | 근거 없는 사실 생성 금지(§4.2)·출처 표기·위급값 단정 금지(§4.4)·chartQa 교차검증. |
| 프라이버시 | 전송 데이터 최소화·내부 GPU 경유·PHI 외부유출 0. |
| 투명성 | 환자/감사 요청 시 "AI 보조 여부·근거" 제시(aiAssisted·snapshot). |
| 거버넌스 | 프롬프트 **버전 관리**(promptVersion)·정기 품질 검증(채택률·오류율)·프롬프트 변경은 파일럿 재검증. |

---

## 10. JCI 인증 정합 (Joint Commission International)

> HIS는 이미 JCI 주요 챕터를 **운영화한 모듈**을 보유: 환자안전목표(IPSG, `patient-safety`/`ipsg-summary`), 상태기반 재평가(AOP, `risk-reassessment` — Morse 기반 위험도별 간격 **2/4/8h**, `risk-reassessment.service.ts:71-76`), 직원자격(SQE, `staff-qualification`), 질·안전(QPS, `qi`), 감염관리(PCI, `infection-control`). 간호기록 AI 보조는 이 JCI 프로그램을 **우회하지 않고 그 안에서** 동작한다.

### 10.1 표준 매핑 (JCI Hospital Standards 챕터)

| JCI 표준(챕터) | 간호기록 요구 | 본 기획 충족·가드 |
|---|---|---|
| **MOI.9 / MOI.11** (의료정보·기록 완전성) | 각 기재에 **작성자·일시 식별**, 완전·정확·적시 | AI는 **저자 아님** — `signedBy`=간호사·`signedAt` 불변(P-2). `aiAssisted`는 **도구 표기**(메타). |
| **MOI.11.1.1** (복사·자동완성 auto-population 통제) ★핵심 | copy-paste·자동입력의 **오류 전파·구식정보** 방지, 저자 능동검토 | AI 초안=auto-population → ①**현재 데이터만**(stale 차단) ②근거 없는 문장 드롭(§4.2) ③**"검토 확인" 게이트** 없이 서명 불가 ④수정량 추적(과신 탐지). _AI 문서화의 핵심 통제점_(§10.2) |
| **MOI.11.1** (표준 용어·약어) | 표준 진단/용어, **금지약어(Do-Not-Use) 미사용** | AI 출력 **NANDA-I 표준 용어**·승인 용어집 준수, 금지약어 필터(F-4 룰) |
| **AOP.1 / AOP.1.4** (초기 간호평가·자격자·기한 내) | 자격 간호사가 정해진 시간 내 평가·문서화 | AI는 평가 **보조만**, 수행·서명=자격 간호사(SQE). 기한은 기존 정책 |
| **AOP.2** (상태기반 재평가 간격) | 위험도별 재평가·문서화 | 기존 `risk-reassessment`(Morse 2/4/8h)와 연계 — AI는 due/overdue·초안 **제시**, 재평가는 간호사 수행. AI가 "재평가됨" **가장(假裝) 금지**(§4.4) |
| **COP.2 / COP.2.1** (통합 간호계획 문서화) | 간호계획 수립·기록 | F-2 NANDA-NIC-NOC **제안**, 계획 확정·소유=간호사 |
| **IPSG.2 / .2.2** (정확한 의사소통·인수인계) | 표준화 핸드오버(SBAR)·위급결과 보고 | F-3 SBAR **보조**, 인계 간호사 검증. 위급값 경보 경로 **무간섭**(§4.4) |
| **IPSG.6** (낙상 위험 감소) | 낙상평가·재평가·중재 기록 | FallRiskAssessment·재평가 연계, AI 단정 금지·플래그만 |
| **IPSG.3** (고위험약물) | 투약확인(MAR) 기록 | MAR 객관 서술, 임상결정 자동적용 0 |
| **SQE.3 / SQE.14** (직원 자격·역량) | 자격자만 기록, 도구 역량 | `staff-qualification` 자격 보증 + **AI 도구 사용 역량교육**(파일럿 전) |
| **GLD.7 / GLD.11** (기술·CDS 거버넌스) | 신규 임상기술 도입 평가·승인·모니터 | **도입 전 평가·승인**(간호부·QI)·프롬프트 버전 거버넌스(§9)·지속 모니터(§12) |
| **QPS** (질·안전 측정) | 지표 측정·개선 | §11 지표(채택률·수정량·품질·안전) → QPS 프로그램 편입 |
| **PFR/PFE** (환자권리·교육) | 기록 투명성·AI 사용 고지(필요 시) | 프로비넌스로 "AI 보조 여부·근거" 제시(투명성) |

### 10.2 핵심 통제 — MOI.11.1.1 (Auto-population) 상세
JCI는 **복사·자동완성으로 인한 오류 전파**를 의료기록 무결성의 핵심 위험으로 본다. AI 초안은 본질적으로 auto-population이므로 다음 통제를 **필수**로 둔다:
1. **신선도**: 초안은 항상 **현재 시점 데이터**로 생성(직전 노트 복사·캐시 stale 금지). `aiSourceSnapshot`에 근거 시각 기록.
2. **저자 책임**: 기재 저자=**간호사**(signedBy). AI는 도구 — 기록은 "간호사가 검토·승인한 것".
3. **능동 검토 강제**: **"간호사 검토 확인" 게이트** 없이 서명 불가(blind acceptance 차단).
4. **변경 추적**: `aiEditDistance`로 무수정 서명(과신) 모니터 → 교육·정책 환류.
5. **오류 비전파**: 근거 없는 문장 드롭(§4.2) — 이전 기록 오류를 AI가 답습하지 않게.

### 10.3 기록 검토(Record Review) 편입
- JCI 정기 **개방/폐쇄 기록 검토**(완전성·적시성·저자식별)에 **AI 보조 기록을 표본 포함**, `aiAssisted`로 **층화 분석**(AI 보조군 vs 수동군 품질 비교).
- 검토 결과를 프롬프트·룰 개선(§9 거버넌스)으로 환류.

### 10.4 JCI 도입 전제(체크리스트)
- (J-1) 간호부·QI **AI 도구 도입 승인**(GLD) + SOP(정책) 문서화.
- (J-2) **AI 도구 사용 역량교육**(SQE) — 한계·검토 책임 포함.
- (J-3) **금지약어/표준용어 목록**을 AI 출력 룰에 반영(MOI.11.1).
- (J-4) 기록 검토 프로그램에 AI 보조 항목 추가(MOI).
- (J-5) §14 결정필요(D-1 규제자문)과 통합 — JCI 심사 대응 자료화(추적 가능성·통제 증빙).

---

## 11. 품질·효과 지표 + 측정 방법

| 지표 | 정의 | 측정 |
|------|------|------|
| 채택률 | AI 초안 → 서명 도달 비율 | aiAssisted SIGNED / ai-draft 생성 수 |
| **수정량(edit distance)** | 초안 대비 최종 서명본 변경량 | 서명 시 `aiSourceSnapshot.draft` ↔ 최종 텍스트 Levenshtein/토큰 diff → `aiEditDistance`. **낮을수록 초안 적합, 너무 0이면 과신 의심**(양방향 해석) |
| 작성시간 | 초안 ON/OFF 작성 소요 | 파일럿 A/B(같은 병동 교대 단위) |
| 품질 | chartQa 평균 등급·필수요소 누락률 | F-4 집계 |
| 안전(회귀) | 위급값 누락·오기 0 유지 | 위급값 워크플로 무간섭 모니터 |

**평가 방법론(파일럿)**: ① 도입 전 **baseline 2주**(작성시간·품질) → ② 1개 병동 게이트 ON 2~4주 → ③ 지표 비교·간호사 설문(유용성·신뢰)·안전 사건 0 확인 → ④ 임계 충족 시 확대. 미충족/이상 시 **게이트 OFF 즉시 회귀**.

---

## 12. 단계별 로드맵 + 완료 정의(DoD)

| 단계 | 범위 | 산출 | DoD |
|------|------|------|-----|
| **P0** 기반 | 프로비넌스 모델·config 게이트·chartQa 간호룰(F-4) | manual SQL·`nursing.aiAssist.enabled`·QA 룰 | 게이트 OFF 시 무변경(회귀 0)·단위테스트·서명 흐름 불변 검증 |
| **P1** 핵심 | F-1 근거기반 SOAP/DAR 초안·출력계약·근거칩·검토 게이트 | `ai-draft` EP·작성기 버튼·FALLBACK | DRAFT만 생성(서명 안 됨)·근거 없는 A/P 드롭·타임아웃 FALLBACK·1병동 파일럿 측정 |
| **P2** 간호과정 | F-2 NANDA-NIC-NOC 제안·NOC 평가 보조 | suggest 확장·NIC/NOC 연계 | 복수안·신뢰도·간호사 확정 경로·환각 0 |
| **P3** 교대·브리핑 | F-3 SBAR 요약·F-5 브리핑·F-6 정정 보조 | handoff/summary EP | UniversalNursingNote에 적용(법적 노트 분리)·읽기 보조 |
| **장기** | 음성 STT·실시간 회진 입력·다국어 | 별도 기획 | 범위 밖 |

**권고 착수 순서**: P0(저위험 기반) → P1(효과 큰 초안) → P2 → P3.

---

## 13. 리스크·완화

| 리스크 | 완화 |
|--------|------|
| 초안 과신(미검토 서명) | "검토 확인" 게이트·수정량 양방향 모니터·교육 |
| 환각/오기 | 근거 기반·O는 코드서술(LLM無)·출처표기·위급값 플래그·chartQa 교차 |
| 법적 책임 모호 | 프로비넌스로 "보조" 명시·서명 간호사 책임 불변·규제 자문 |
| AI 서버 장애/지연(504) | FALLBACK 무중단·타임아웃·논블로킹 UX·게이트 OFF 즉시 회귀 |
| 행동 변경 회귀 | config 게이트 OFF 기본·병동 파일럿·additive 스키마 |
| PHI 노출 | 전송 최소화·내부 GPU·외부 0 |
| 위급 대응 저해 | AI 초안과 위급값/EWS 경보 경로 완전 분리(무간섭) |

---

## 14. 결정 필요(Open Questions)
- (D-1) **규제 분류 자문**: CDS SaMD 비해당/저위험 확인 1건(도입 전).
- (D-2) **PHI 최소화 범위**: medical-ai 전송 시 성명 제거 여부(현 autoSoap는 포함).
- (D-3) 파일럿 **대상 병동·기간·성공 임계**(채택률/시간단축 목표치).
- (D-4) 프롬프트 **거버넌스 주체**(간호부 검수·버전 승인).
- (D-5) 수정량 지표의 **운영 해석 기준**(과신 탐지 임계).

## 15. 범위 밖(명시)
- AI 자동 서명/확정 · 임상 의사결정 자동적용 · 음성 STT 실시간 · 오프라인(FR-08) · NursingNote↔UniversalNursingNote 통합 · 외화/청구(타 도메인).

---

## 부록 — 근거 파일(검증됨)
- 간호 서비스/AI: `apps/api/src/modules/nursing/nursing.service.ts`(`suggestNandaDiagnosis:23`·`summarizeHandoff:40`·`createNote:223`·`signNote:249`·`amendNote:262`)
- AI 코어: `apps/api/src/modules/medical-ai/medical-ai.service.ts`(`realtimeDdx:671`·`autoSoap:754`(JSON 출력계약 원형 `:776`)·`chartQa:953`·`clinicalQa:1093`·`chatLlm`→`/api/chat`)
- 모델 필드: `NursingNote`(subjective/objective/assessment/plan·focus/data/action/response·education·content·shiftType·priority(NORMAL/URGENT/CRITICAL)·status 기본 `SIGNED`→DRAFT는 `draft:true` 필수·signedAt/signedBy)·`NursingDiagnosis/Intervention/Outcome`·`NursingCode`(NANDA/NIC/NOC 마스터)·EarlyWarningScore·FallRiskAssessment·MedicationAdministration·PreVisitVitals
- 컨텍스트 노트: `apps/api/src/modules/nursing-note/nursing-note.service.ts`(UniversalNursingNote·SBAR)
- FE(검증): 작성기 `apps/web/src/app/(main)/inpatient/[admissionId]/nursing/notes/page.tsx`(SOAP/DAR 폼·상태배지·서명/정정/정정배너)·`nursing/assessment/page.tsx`(Braden/Morse) · 워크스테이션 `workstation/nursing/page.tsx`(VitalPanel NEWS2·MarPanel·AssessmentPanel·HandoffPanel "AI I-PASS") · 보드 `nursing-station/page.tsx`(30s 폴링·EWS/낙상/미서명)
- FE 재사용 컴포넌트: `components/ai/AiSuggestionPanel.tsx`(amber·적용/무시·data unwrap)·`ui/StatusBadge.tsx`·`components/dashboard/FreshnessBadge.tsx`·toast-store · 신규 `components/ai/{NursingAiDraftPanel,CitationChips,AiProvenanceBadge,ReviewConfirmGate}`
- 연관: `tablet-chart-view.plan.md`(회진 작성 셸)·임상무결성 백로그(#10 이중노트 재평가·#11 간호 서명UI)
- DTO 규약: `create-nursing-note.dto.ts`(`draft?:boolean`·noteType/shiftType enum)
