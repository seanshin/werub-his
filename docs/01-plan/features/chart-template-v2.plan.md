# 차트 템플릿 고도화 (Chart Template v2) 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/src/modules/chart-template/chart-template.controller.ts · apps/web/src/components/specialty/ScoreCalculator.tsx · apps/api/prisma/seed-clinical-tool-templates.ts:7 · 잔여: Phase5 병원 간 내보내기/가져오기(CLI)

> **Summary**: 기존 15 API + 12 프리셋 + 기본 편집기 구조에서, 드래그앤드롭 편집기 고도화 / 필드 타입 확장 / 버전 관리 / AI 자동 추천까지 갖춘 Enterprise 급 차트 템플릿 플랫폼으로 확장
>
> **Project**: Hospital RUN
> **Version**: 2.0.0
> **Author**: user
> **Date**: 2026-05-19
> **Status**: Draft

---

## 1. 개요

### 1.1 목적

차트 템플릿 시스템을 단순한 레이아웃 저장소에서 **클리니션이 실제로 매일 의존하는 지능형 문서화 플랫폼**으로 격상한다. 현재 편집기(335줄, 기본적인 드래그앤드롭)의 UX 한계, 필드 타입 렌더러 미완성, 버전 이력 부재 등 임상 현장 사용에 걸림돌이 되는 요소들을 제거한다.

### 1.2 배경 및 현재 상태 평가

#### 백엔드 완성도

| 항목 | 구현 상태 | 평가 |
|------|----------|------|
| API 엔드포인트 15개 | 완전 구현 | 운영 가능 |
| 프리셋 12종 (internal-outpatient / surgery-opnote / pediatrics / emergency / nursing-assessment / nursing-note-dar / icu-record / lab-result / psychiatry / orthopedics / obstetrics / blank) | 완전 구현 | 운영 가능 |
| DB 10종 시드 데이터 (중복 정리 완료) | 완전 구현 | 운영 가능 |
| 개인화/복제/즐겨찾기/기본 설정 | 완전 구현 | 운영 가능 |
| 버전 번핑 (`bumpVersion`) | 단순 카운터만 | 히스토리 없음 — 개선 필요 |
| 버전 이력 저장 | 미구현 | 개선 필요 |
| 감사 추적 (누가 언제 무엇을 변경했는지) | 미구현 | 개선 필요 |

#### 프론트엔드 완성도

| 항목 | 구현 상태 | 평가 |
|------|----------|------|
| TemplateListView (188줄) — 목록/필터/프리셋/즐겨찾기 | 기능적으로 완성 | 운영 가능 |
| EditorView (147줄) — 기본 드래그앤드롭 | 기초만 구현 | 개선 필요 |
| 필드 속성 패널 — 레이블/placeholder/required/rows/options | 부분 구현 | 개선 필요 |
| 미리보기 모드 — toggle은 있으나 실제 렌더링 없음 | 토글만 있음 | 개선 필요 |
| 섹션 간 필드 이동 | 미구현 | 개선 필요 |
| 섹션 순서 변경 | 미구현 | 개선 필요 |
| AI 타입별 속성 (aiAssist, autoLoad, calculator 등) | 설정 UI 없음 | 개선 필요 |

#### 진료 차트 연동 완성도 (encounter/new/page.tsx)

| 항목 | 구현 상태 | 평가 |
|------|----------|------|
| ChartTemplateSelector — 템플릿 선택 | 구현됨 | 운영 가능 |
| ChartRenderer — sections 렌더링 | 구현됨 | 운영 가능 |
| mappedTo → SOAP 자동 동기화 | 구현됨 (subjective/objective/assessment/plan) | 운영 가능 |
| 사용 기록 (`/:id/use`) | 구현됨 | 운영 가능 |
| 특수 필드 타입 렌더러 (vitals / diagnosis-search / prescription / pain-scale / body-diagram / score-calculator / growth-chart / timeline 등) | ChartRenderer 내부 구현 여부 별도 확인 필요 | 검증 필요 |

### 1.3 관련 문서

- 기존 기획서: `docs/01-plan/features/chart-template.plan.md`
- 비교 분석: `docs/01-plan/의료차트_비교분석_기획서.md` (국내외 12개 시스템)
- 진료과 요구사항: `docs/01-plan/진료과별_차트요구사항_상세.md` (13개 진료과)
- 백엔드: `apps/api/src/modules/chart-template/chart-template.service.ts`
- 프론트엔드: `apps/web/src/app/(main)/admin/chart-editor/`
- 진료 차트: `apps/web/src/app/(main)/patients/[id]/encounter/new/page.tsx`
- DB 스키마: `apps/api/prisma/schema.prisma` (ChartTemplate / UserChartPreference)

---

## 2. 범위 (Scope)

### 2.1 포함 범위

- [ ] Phase 1: 편집기 UX 고도화 — 드래그앤드롭 완성, 실시간 미리보기, 섹션 재정렬, AI 속성 설정 패널
- [ ] Phase 2: 필드 타입 확장 — 현재 12종 → 추가 8종 (총 20종), 타입별 렌더러 완성 검증
- [ ] Phase 3: 버전 관리 — ChartTemplateVersion 모델, 히스토리 UI, 롤백
- [ ] Phase 4: AI 연동 — 진단코드 기반 템플릿 자동 추천, AI 필드 자동 채움 (WeRU.B 연동)
- [ ] Phase 5 (선택): 템플릿 공유 — 병원 간 내보내기/가져오기 (JSON 패키지)

### 2.2 제외 범위

- 진료과 전용 특수 모듈 (ICU 플로우시트, 소아 성장차트, 산전기록): 별도 기획서에서 다룸 (`의료차트_비교분석_기획서.md` Phase 1 항목)
- 오프라인 PWA 동기화: FR-08로 Phase 4+ 이연 (CLAUDE.md Out of Scope)
- SmartLink 토큰 치환 (`@환자명@`, `@바이탈@`): 별도 Epic-SmartLink 기획으로 분리
- PACS/Orthanc 연동: OpenPACS 프로젝트 영역

---

## 3. 문제점 및 개선 요구사항

### 3.1 편집기 UX 문제점

**현재 상태:**
```
EditorView (147줄)
├── 팔레트 드래그 → 섹션으로 드롭 ✅
├── 필드 내 순서 변경 (동일 섹션 내) ✅
├── 섹션 간 필드 이동 ❌
├── 섹션 순서 변경 (드래그) ❌
├── 미리보기 — toggle만 있고 실제 필드 렌더링 없음 ❌
├── 필드 속성 패널 — label/placeholder/required/rows/options만 ⚠
│   └── aiAssist / mappedTo / autoLoad / calculator / codeSystem 등 없음 ❌
├── 섹션 columns 설정 (1/2/3) ❌
└── 섹션 collapsible / icon 설정 ❌
```

### 3.2 필드 타입 렌더러 검증 필요

PRESETS에서 선언된 고급 타입들이 ChartRenderer에서 실제 동작하는지 확인이 필요하다. 아래 타입은 렌더러 구현 여부를 Phase 2에서 검증하고 미구현 시 추가한다.

| 필드 타입 | PRESETS 선언 | ChartRenderer 렌더러 | 우선순위 |
|-----------|-------------|---------------------|---------|
| `vitals` | ✅ 6개 프리셋 | 검증 필요 | Must |
| `diagnosis-search` | ✅ 5개 프리셋 | 검증 필요 | Must |
| `prescription` | ✅ 6개 프리셋 | 검증 필요 | Must |
| `pain-scale` | ✅ 3개 프리셋 | 검증 필요 | Must |
| `body-diagram` | ✅ 2개 프리셋 | 검증 필요 | Should |
| `score-calculator` | ✅ ICU/간호 | 검증 필요 | Should |
| `growth-chart` | ✅ 소아 | 검증 필요 | Could |
| `timeline` | ✅ 응급 | 검증 필요 | Could |
| `lab-reference` | ✅ 2개 프리셋 | 검증 필요 | Should |
| `photo-capture` | ✅ 정형외과 | 검증 필요 | Could |
| `slider` | ✅ 정신과 GAF | 검증 필요 | Could |

### 3.3 버전 관리 부재

현재 `update()` 서비스는 sections 변경 시 `bumpVersion()`으로 버전 번호만 올리고, 이전 버전 데이터를 보존하지 않는다. 의사가 템플릿을 수정한 뒤 되돌리거나 이전 시점으로 복원할 방법이 없다.

### 3.4 AI 연동 미구현

진료 차트에서 진단코드(KCD) 입력 시 관련 템플릿을 자동으로 추천하는 기능이 없다. 또한 WeRU.B Medical AI API (example.org/ollama)가 이미 연동되어 있으나 차트 템플릿과의 연결이 없다.

### 3.5 진료과별 스코어링 필드 부재

`진료과별_차트요구사항_상세.md` 분석 결과, 13개 진료과에서 공통적으로 요구하는 스코어링 도구(GCS, APACHE II, SOFA, PHQ-9, GAD-7, MMSE, K-WOMAC, FIM, DAS28 등)가 `score-calculator` 타입으로 선언만 되어 있고, 실제 계산 로직이 없다.

---

## 4. 기능 요구사항

### 4.1 Phase 1: 편집기 UX 고도화 (Must)

| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| FR-01 | 섹션 간 필드 드래그 이동 (cross-section drop) | Must |
| FR-02 | 섹션 순서 드래그 재정렬 | Must |
| FR-03 | 미리보기 모드에서 실제 필드 렌더링 (입력 가능한 폼 형태) | Must |
| FR-04 | 필드 속성 패널 확장 — `aiAssist`, `mappedTo`, `autoLoad`, `calculator`, `codeSystem`, `multiple`, `durCheck` 설정 | Must |
| FR-05 | 섹션 설정 패널 — `columns(1/2/3)`, `collapsible`, `defaultOpen`, `icon` 선택 | Should |
| FR-06 | 키보드 단축키 — Ctrl+Z 실행 취소, Ctrl+Y 재실행 (편집 히스토리, 세션 내 로컬) | Should |
| FR-07 | 저장 자동화 — 변경 후 30초 자동 저장 (dirty state 표시) | Should |
| FR-08 | 템플릿 내보내기/가져오기 — JSON 파일 다운로드/업로드 | Could |

### 4.2 Phase 2: 필드 타입 확장 및 렌더러 검증 (Must)

| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| FR-09 | 기존 특수 필드 타입 렌더러 완성 검증 (vitals / diagnosis-search / prescription / pain-scale 4종 우선) | Must |
| FR-10 | `score-calculator` 타입에 계산기 로직 추가 — GCS, APACHE II, SOFA, PHQ-9, GAD-7, MMSE 6종 우선 | Must |
| FR-11 | `checklist` 타입 렌더러 (소아 발달 체크 등) | Should |
| FR-12 | `body-diagram` 타입 — SVG 인체 도식 + 통증 부위 마킹 인터랙션 | Should |
| FR-13 | `time-series` 타입 — ICU 플로우시트용 시간축 그리드 (초기 버전) | Could |
| FR-14 | `signature` 타입 — 동의서/확인용 전자 서명 캔버스 | Could |
| FR-15 | 필드 조건부 표시 — 다른 필드 값에 따라 show/hide (예: 통증 > 5이면 세부 통증 필드 표시) | Could |

### 4.3 Phase 3: 버전 관리 + 감사 추적 (Should)

| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| FR-16 | `ChartTemplateVersion` 모델 — 수정 시 이전 버전 JSON 스냅샷 저장 (sections, changedBy, changeNote, createdAt) | Should |
| FR-17 | 버전 히스토리 목록 API — `GET /api/v1/chart-templates/:id/versions` | Should |
| FR-18 | 버전 롤백 API — `POST /api/v1/chart-templates/:id/versions/:versionId/restore` | Should |
| FR-19 | 편집기 내 버전 히스토리 패널 — diff 뷰 (추가/삭제 필드 강조) | Could |
| FR-20 | 변경 노트 입력 — 저장 시 "변경 이유" 메모 입력 (선택) | Could |

### 4.4 Phase 4: AI 연동 (Should)

| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| FR-21 | 진단코드 기반 템플릿 추천 — 진료 차트에서 KCD 코드 입력 시 관련 템플릿 상위 3개 제안 | Should |
| FR-22 | 추천 로직 — 1) 진단코드→진료과 매핑 2) 진료과+role 기반 템플릿 필터링 3) usageCount 가중치 | Should |
| FR-23 | AI 필드 자동 채움 — `aiAssist: true` 필드를 WeRU.B summarize API 응답으로 pre-fill | Could |
| FR-24 | 스마트 템플릿 생성 — 진료과/카테고리 입력 시 AI가 섹션/필드 초안 자동 생성 | Won't (Phase 5+) |

---

## 5. 비기능 요구사항

| 카테고리 | 기준 | 측정 방법 |
|---------|------|---------|
| 성능 | 템플릿 저장 API 응답 < 300ms | k6 부하테스트 |
| 성능 | 편집기 로딩 (100개 필드 기준) < 1초 | Lighthouse |
| 성능 | 버전 히스토리 조회 (최근 20개) < 200ms | API 응답 시간 측정 |
| 접근성 | 편집기 키보드 네비게이션 지원 | WCAG 2.1 AA |
| 보안 | 개인 템플릿은 소유자만 수정 (기존 ForbiddenException 유지) | 권한 테스트 |
| 보안 | 버전 히스토리 조회는 템플릿 접근 권한과 동일하게 적용 | 권한 테스트 |
| 호환성 | 기존 sections JSONB 구조와 하위 호환 유지 (v1 프리셋 12종 그대로 동작) | 통합 테스트 |

---

## 6. 데이터 모델 변경사항

### 6.1 신규 모델: ChartTemplateVersion

```prisma
model ChartTemplateVersion {
  id           String        @id @default(uuid()) @db.Uuid
  templateId   String        @map("template_id") @db.Uuid
  versionTag   String        @db.VarChar(20)    // "1.0", "1.1", "2.0"
  sections     Json          @db.JsonB           // 해당 버전 섹션 스냅샷
  changeNote   String?       @db.VarChar(500)    // 변경 이유 메모
  changedBy    String        @map("changed_by") @db.Uuid
  createdAt    DateTime      @default(now()) @map("created_at") @db.Timestamptz()

  template     ChartTemplate @relation(fields: [templateId], references: [id])
  changer      User          @relation(fields: [changedBy], references: [id])

  @@index([templateId])
  @@map("chart_template_versions")
}
```

### 6.2 ChartTemplate 모델 확장 필드 (선택적)

```prisma
// ChartTemplate에 추가
tags         String[] @default([])         // 검색용 태그 (내과, SOAP, 수술기록 등)
thumbnailUrl String?  @db.VarChar(500)     // 편집기 미리보기 이미지
isPublic     Boolean  @default(false)      // 공개 공유 여부 (Phase 5)
```

### 6.3 인덱스 추가

```prisma
// ChartTemplate
@@index([isActive, department, role])     // 공용 템플릿 목록 쿼리 최적화
@@index([usageCount])                     // 인기 순 정렬 최적화
@@index([isPersonal, ownerId])            // 개인 템플릿 조회 최적화
```

---

## 7. API 변경사항

### 7.1 신규 API (Phase 3)

| Method | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | `/api/v1/chart-templates/:id/versions` | 버전 히스토리 목록 | 인증 필요 |
| GET | `/api/v1/chart-templates/:id/versions/:versionId` | 특정 버전 상세 (섹션 스냅샷) | 인증 필요 |
| POST | `/api/v1/chart-templates/:id/versions/:versionId/restore` | 특정 버전으로 롤백 | DOCTOR, ADMIN |

### 7.2 신규 API (Phase 4)

| Method | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | `/api/v1/chart-templates/recommend` | 진단코드 기반 추천 (`?icdCode=J18.1&role=DOCTOR`) | 인증 필요 |

### 7.3 기존 API 변경 (Phase 1)

| API | 현재 | 변경 |
|-----|------|------|
| PUT `/:id` | sections 변경 시 version 번핑만 | ChartTemplateVersion 스냅샷 저장 추가 |
| PUT `/:id` | body에 changeNote 없음 | `changeNote?: string` 파라미터 추가 |

---

## 8. UI/UX 설계 방향

### 8.1 편집기 3-Panel 레이아웃 (현재 유지, 기능 확장)

```
┌─────────────────────────────────────────────────────────────────┐
│  [헤더] 템플릿명 | 진료과 | 역할 | 레이아웃 | [버전히스토리] [미리보기] [저장]  │
├──────────────┬─────────────────────────────┬────────────────────┤
│  팔레트       │  섹션 캔버스                  │  속성 패널          │
│  (기본 타입)  │                              │                    │
│  text        │  [섹션1] ≡ (드래그핸들)        │  [필드 선택 시]     │
│  textarea    │  ┌──────────────────────┐    │  레이블:           │
│  number      │  │ 필드A ≡  필드B ≡     │    │  타입: [diagnosis] │
│  select      │  │ 필드C ≡              │    │  mappedTo:         │
│  ...         │  └──────────────────────┘    │  required: □       │
│              │  + 섹션 추가                   │  aiAssist: □       │
│  (특수 타입)  │                              │  코드시스템:        │
│  vitals      │  [섹션2] ≡                    │  KCD/ICD-10/ICD-11 │
│  diagnosis   │  ...                          │                    │
│  prescription│                              │  [섹션 선택 시]     │
│  pain-scale  │                              │  columns: 1/2/3    │
│  ...         │                              │  collapsible: □    │
│              │                              │  icon: [선택]      │
└──────────────┴─────────────────────────────┴────────────────────┘
```

### 8.2 실시간 미리보기

편집 모드 토글 시, 실제 입력 가능한 폼을 렌더링한다. 현재는 토글만 있고 `previewMode` 분기에서 별도 렌더러 없이 필드 정보만 텍스트로 표시하는 수준이다. ChartRenderer 컴포넌트를 편집기 미리보기에 재사용한다.

### 8.3 버전 히스토리 패널

템플릿 편집기 헤더에 "버전 히스토리" 버튼 추가 → 사이드 패널로 펼침.

```
버전 히스토리
────────────────────────────────
v2.3  2026-05-19  김철수 의사
      "통증 NRS 필드 추가"       [이 버전으로 복원]

v2.2  2026-05-15  김철수 의사
      "산부인과 섹션 제거"        [이 버전으로 복원]

v2.1  2026-05-10  관리자
      (변경 노트 없음)            [이 버전으로 복원]

v2.0  2026-05-09  시스템 생성     [이 버전으로 복원]
────────────────────────────────
```

---

## 9. 진료과별 추가 프리셋 계획

`의료차트_비교분석_기획서.md` 및 `진료과별_차트요구사항_상세.md` 분석 결과, 현재 12종 프리셋에서 아래를 추가한다.

| 프리셋 키 | 진료과 | 핵심 추가 필드 | Phase |
|-----------|--------|-------------|-------|
| `cardiology` | 순환기내과 | NYHA 분류, CHA2DS2-VASc 스코어, LVEF%, 심전도 소견 | 2 |
| `neurology` | 신경과 | GCS, 뇌신경 12쌍, NIHSS, 운동/감각 맵 | 2 |
| `rehabilitation` | 재활의학과 | FIM 스코어, Barthel Index, ROM 테이블 | 2 |
| `opthalmology` | 안과 | 시력(교정/나안), 안압(IOP), 세극등 소견 | 3 |
| `dermatology` | 피부과 | ABCDE 병변 기술, Body Map, PASI 점수 | 3 |
| `pulmonology` | 호흡기내과 | PFT 결과표 (FEV1/FVC/DLCO), mMRC, CAT Score | 2 |
| `oncology` | 혈액종양내과 | ECOG PS, TNM 병기, CTCAE 이상반응 | 3 |
| `anesthesia` | 마취과 | ASA 분류, Mallampati, 마취기록 시간축 | 3 |

현재 12종 프리셋은 그대로 유지하고, 위 항목을 Phase별로 추가한다.

---

## 10. 성공 지표 (Success Metrics)

### 10.1 완료 기준 (Definition of Done)

- [ ] Phase 1: 편집기에서 섹션 간 필드 이동, 섹션 재정렬, 실시간 미리보기 모두 동작
- [ ] Phase 1: 모든 필드 속성 (aiAssist/mappedTo/calculator 등) 편집기에서 설정 가능
- [ ] Phase 2: vitals / diagnosis-search / prescription / pain-scale 4종 렌더러 진료 차트에서 정상 동작 검증
- [ ] Phase 2: score-calculator 6종 계산기 (GCS/APACHE II/SOFA/PHQ-9/GAD-7/MMSE) 동작
- [ ] Phase 3: 템플릿 수정 시 ChartTemplateVersion 스냅샷 저장, 롤백 API 동작
- [ ] Phase 4: KCD 코드 입력 시 진료 차트에서 관련 템플릿 추천 팝업 표시

### 10.2 품질 기준

- [ ] 기존 12종 프리셋 하위 호환 — v1 sections JSON 구조 그대로 진료 차트에서 렌더링
- [ ] API 응답 시간 목표 충족
- [ ] 편집기 관련 통합 테스트 추가 (최소 5개 케이스)

---

## 11. 위험 및 완화

| 위험 | 영향도 | 발생 가능성 | 완화 방안 |
|------|--------|------------|----------|
| ChartRenderer 특수 필드 렌더러 미구현이 광범위할 경우 Phase 2 범위 급증 | 높음 | 중간 | Phase 2 시작 전 ChartRenderer 전체 코드 리뷰로 실제 구현 여부 확인 후 범위 재조정 |
| ChartTemplateVersion 테이블 추가 시 마이그레이션 영향 | 중간 | 낮음 | 기존 ChartTemplate 데이터에 영향 없는 신규 테이블 추가이므로 안전 |
| 버전 히스토리 데이터 누적으로 DB 용량 증가 | 중간 | 높음 | 보존 기간 정책 (최근 20개 버전 유지) + 오래된 버전 아카이빙 |
| AI 추천 정확도 낮을 경우 임상 신뢰도 저하 | 높음 | 중간 | 추천은 "제안"으로만 표시, 의사가 무시할 수 있는 UI 설계. 강제 자동 선택 없음 |
| WeRU.B API 응답 지연으로 AI 필드 채움 UX 저하 | 중간 | 중간 | 로딩 스피너 + 타임아웃 3초 설정. AI 실패 시 빈 필드로 fallback |
| 섹션 간 드래그 이동 구현 시 React 상태 복잡도 증가 | 중간 | 중간 | dnd-kit 라이브러리 도입 검토 (현재 native HTML5 DnD 사용 중) |

---

## 12. 고도화 로드맵

### Phase 1: 편집기 UX 고도화 (2-3일)
- 섹션 재정렬 드래그앤드롭
- 섹션 간 필드 이동
- 실시간 미리보기 (ChartRenderer 재사용)
- 필드 속성 패널 확장 (aiAssist / mappedTo / calculator / codeSystem)
- 섹션 설정 패널 (columns / collapsible / icon)

### Phase 2: 필드 타입 완성 (2-3일)
- vitals / diagnosis-search / prescription / pain-scale 렌더러 검증 및 완성
- score-calculator 6종 계산기 로직 (GCS / APACHE II / SOFA / PHQ-9 / GAD-7 / MMSE)
- 추가 프리셋 2종 (cardiology / pulmonology)

### Phase 3: 버전 관리 (1-2일)
- ChartTemplateVersion 모델 + 마이그레이션
- 버전 히스토리 API 3개
- 편집기 버전 히스토리 패널

### Phase 4: AI 연동 (1-2일)
- 진단코드 → 템플릿 추천 API
- 진료 차트 내 추천 팝업 컴포넌트
- WeRU.B summarize API → aiAssist 필드 pre-fill

### Phase 5: 템플릿 공유 (옵션, 별도 기획)
- JSON 내보내기/가져오기
- 병원 간 템플릿 교환 포맷 (메타데이터 포함)

---

## 13. 아키텍처 고려사항

현재 프로젝트는 **Enterprise Clean Architecture** (CLAUDE.md 기준)를 따르므로:

- `ChartTemplateVersion` 서비스 메서드는 `chart-template.service.ts`에 통합
- 버전 롤백은 트랜잭션으로 처리 (현재 버전 교체 + 버전 스냅샷 생성이 원자적)
- AI 추천은 `chart-template.service.ts` 내 `getRecommendations(icdCode, role)` 메서드로 추가
- WeRU.B 연동은 기존 `ai` 모듈 패턴을 따라 분리된 서비스 호출
- 프론트엔드 편집기 드래그앤드롭 복잡도 증가 시 `dnd-kit` 라이브러리 도입 (현재 native HTML5 DnD 사용)

---

## 14. 다음 단계

1. [ ] 이 기획서 CTO 검토/승인
2. [ ] Phase 1 Design 문서 작성 (`chart-template-v2.design.md`)
3. [ ] ChartRenderer 소스 코드 리뷰 — 특수 필드 타입 렌더러 현황 파악 (Phase 2 범위 확정)
4. [ ] dnd-kit 라이브러리 도입 여부 결정 (복잡도 vs 의존성 트레이드오프)
5. [ ] Phase 1 구현 시작

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-19 | 초안 — 현재 상태 분석, 4개 Phase 로드맵, 신규 API 4개, 데이터 모델 변경 | user |
