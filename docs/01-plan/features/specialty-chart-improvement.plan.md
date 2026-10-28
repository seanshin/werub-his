# 전문과 차트 개선안 기획서 v1.0

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/web/src/app/(main)/patients/[id]/encounter/new/components/ObGynEncounterLayout.tsx · apps/web/src/app/(main)/patients/[id]/encounter/new/components/EmergencyEncounterLayout.tsx · apps/web/src/app/(main)/patients/[id]/encounter/new/components/EncounterActionBar.tsx · 잔여: CollapsibleSoapNote 공용 추출(CLI); 대형 컴포넌트 분할·탭 lazy·label 접근성(CLI)

> 코드 품질 분석(62점) 기반 — 구조 개선 + 의료 도구 보강 + 성능 최적화

## 1. 현황 (16개 전문과 레이아웃 완성)

### 잘 된 부분
- 16개 전문과 모두 특화 레이아웃 구현 (총 ~7,200줄)
- 7개 핵심 과(안과/피부/치과/정형/산부/소아/이비) — 전용 DB + API + 시각 도구
- SOAP 기본 구조 위에 전문과별 추가 입력 필드
- 차트 템플릿 시스템 (JSON 기반 동적 폼 + AI 추천)

### 발견된 이슈 (코드 분석 62/100)

| 우선순위 | 이슈 | 영향 |
|---------|------|------|
| CRITICAL | ~~응급/가정의학/재활 3개 과 API 저장 누락~~ | **수정 완료** |
| CRITICAL | SOAP 데이터가 전문과 저장에 미포함 (안과/피부/치과/이비) | 진료 노트 유실 가능 |
| WARNING | 공통 코드 ~1,000줄 중복 (Props, ActionBar, CSS) | 유지보수 비용 |
| WARNING | unused props (`_onStartEncounter`, `_patient`) 16회 | 코드 정리 |
| WARNING | label-input 접근성 (`htmlFor`/`id`) 전무 | 접근성 미달 |
| INFO | 대형 컴포넌트 분할 필요 (Surgery 693줄) | 성능 |

---

## 2. 구조 개선 (코드 품질)

### 2.1 공용 타입/컴포넌트 추출

```
새 파일: components/encounter/shared.ts
  - BaseEncounterLayoutProps 인터페이스 (8필드)
  - inputCls, selectCls, labelCls 공용 CSS 상수

새 파일: components/encounter/EncounterActionBar.tsx
  - 저장(임시) + 서명완료 버튼 + 상태 바
  - saveMutation 연동 지원
  - 16개 파일에서 ~20줄씩 절약 = ~320줄 절감

새 파일: components/encounter/CollapsibleSoapNote.tsx
  - S/O/A/P 접이식 패널 (공용)
  - 5개 과에서 동일 패턴 → 1개로 통합
```

### 2.2 unused props 정리

```
16개 파일에서:
  patientId: _patientId → patientId (실제 사용으로 전환 — 저장 API에 필요)
  onStartEncounter: _onStartEncounter → 제거 또는 실제 연동
  patient: _patient → 제거 또는 헤더에 표시
```

### 2.3 SOAP 데이터 저장 통합

```
안과/피부과/치과/이비인후과에서:
  전문과 검사 저장 시 SOAP 데이터도 함께 전송
  saveMutation payload에 soap: { subjective, objective, assessment, plan } 포함
```

---

## 3. 의료 도구 보강 (과별)

### Phase 1: 핵심 누락 도구 (우선)

| 과 | 누락 도구 | 구현 내용 |
|----|----------|---------|
| 산부인과 | 분만/산후 탭 | LABOR/POSTPARTUM 탭 실구현 (현재 placeholder) |
| 성형외과 | 사진 업로드 | 수술 전후 사진 업로드 + 비교 뷰어 (현재 placeholder) |
| 신경외과 | 감각검사 | Sensory exam (Light touch, Pinprick) 각 레벨별 |
| 응급의학과 | ABCDE 세부 필드 | 기도 상태, SpO2 값, 순환 평가 등 별도 입력 |

### Phase 2: 보조 도구 추가

| 과 | 추가 도구 | 설명 |
|----|----------|------|
| 안과 | Schirmer test, 색각검사 | 건성안 평가 + 색각 이상 선별 |
| 피부과 | 사진 첨부, 조직검사 기록 | 병변 사진 + Biopsy 위치/방법 |
| 치과 | 치주검사 (Pocket depth, BOP) | Periodontal charting |
| 정형외과 | 골절 분류 (AO), X-ray 소견 | 분류 선택기 + 영상 소견 |
| 재활의학과 | 삼킴장애 평가, VAS 통증 | Swallowing assessment + Visual Analog Scale |
| 내과 | CRP/ESR 감염 마커 | 염증 지표 빠른 입력 + 추이 |

---

## 4. 성능 최적화

### 4.1 대형 컴포넌트 분할

```
Surgery (693줄) → SurgerySOAP + SurgeryBooking + SurgeryOpNote + SurgeryTimeline
InternalMedicine (529줄) → InternalSOAP + SubspecialtyPanel + LabPanel
```

### 4.2 탭 내부 Lazy 렌더링

```
재활의학과: Barthel + FIM + MMT + ROM 4개 큰 grid
  → 활성 탭만 렌더링, 비활성 탭은 null

React.lazy + Suspense 또는 조건부 렌더링
```

### 4.3 RHF 전환 (해당 과)

```
정형외과 ROM/MMT 테이블 (10x3 셀):
  useState → useForm + useFieldArray
  → 리렌더링 범위 축소
```

---

## 5. 구현 우선순위

### Phase 1: Critical 수정 + SOAP 통합 (1일)
- [x] 응급/가정의학/재활 API 저장 추가 ✅
- [ ] 안과/피부/치과/이비 SOAP 데이터 저장 통합
- [x] 공용 타입 `BaseEncounterLayoutProps` 추출

### Phase 2: 의료 도구 핵심 보강 (2일)
- [ ] 산부인과 분만/산후 탭 구현
- [ ] 성형외과 사진 업로드 연동
- [ ] 응급의학과 ABCDE 세부 필드

### Phase 3: 구조 리팩토링 (2일)
- [ ] EncounterActionBar 공용 컴포넌트 추출
- [ ] CollapsibleSoapNote 공용 컴포넌트 추출
- [ ] unused props 정리
- [ ] 대형 컴포넌트 분할

### Phase 4: 보조 도구 + 성능 (2일)
- [ ] 과별 보조 도구 추가 (섹션 3 Phase 2)
- [ ] 탭 Lazy 렌더링
- [ ] label-input 접근성 보강

---

## 6. Out of Scope

| 항목 | 사유 |
|------|------|
| 전문과별 독립 DB 모듈 추가 (8개 과) | 현재 JSON 저장으로 충분, 운영 후 필요 시 |
| AI 기반 차트 자동 완성 | 별도 AI 프로젝트 |
| 음성 인식 차트 입력 | 별도 기획 필요 |
| 영상 판독 뷰어 통합 | PACS(OpenPACS) 별도 프로젝트 |

---

*작성일: 2026-05-21*
*버전: v1.0*
*상태: Phase 1 Critical 수정 완료, Phase 2~4 이연*
