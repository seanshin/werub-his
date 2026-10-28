# Hospital RUN 시스템 전체 보강 로드맵

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/web/src/components/signature/SignaturePad.tsx · apps/api/src/modules/hira-edi/ · apps/api/prisma/migrations/00000000000001_baseline/migration.sql:3152 · 잔여: GAP-20 투석 처방 템플릿·회차 비교(CLI)

> **Summary**: 전체 모듈/진료과별 현황 분석 기반 갭 도출 및 단계별 보강 계획
>
> **Project**: Hospital RUN
> **Version**: 2026-05-20 기준
> **Author**: PM Agent
> **Date**: 2026-05-19 (초안) → 2026-05-20 (갱신)
> **Status**: Active

---

## 1. 개요

### 1.1 분석 방법

본 문서는 2026-05-20 기준 실제 코드(apps/api/src/modules, apps/web/src/app/(main)) 직접 분석으로 작성되었다.

- API 모듈 컨트롤러 수: **99개** (*.controller.ts)
- 프론트엔드 page.tsx 수: **98개**
- Prisma 모델 수: **195개** (schema.prisma 내 `model ` 키워드 기준)
- 전문과 전용 진료 다이어그램 컴포넌트: **19개** (components/specialty/)
- 차트 템플릿 프리셋: **12종** (전문과별 SOAP 차트 포함)
- Score Calculator: **14종** (GCS/MORSE/BRADEN/SOFA/APACHE/GAF/NEWS + CHA2DS2-VASc/CURB-65/Child-Pugh/MELD/eGFR/qSOFA/DAS28)

### 1.2 목적

1. 각 기능 영역/진료과별 현재 완성도를 객관적으로 파악
2. 미구현 또는 부족한 기능을 갭으로 정의
3. 우선순위(Critical/High/Medium/Low) 기반 보강 로드맵 제시

---

## 2. 현재 구현 현황 매트릭스

### 2.1 기능 영역별 완성도

| 영역 | 백엔드 모듈 존재 | 프론트 페이지 존재 | 추정 완성도 | 비고 |
|------|:---:|:---:|:---:|------|
| 환자 관리 (CRUD, 검색, 병합, 가져오기) | O | O | 90% | 사진 업로드 미구현 |
| 예약/스케줄 | O | O | 85% | 반복예약, 대기자 알림 미구현 |
| 외래 차트/EMR (SOAP, 처방) | O | O | 90% | 진료과별 분기 UI 대폭 확충 (내과/정형/신경외과/성형 등) |
| CPOE (처방 + DUR) | O | O | 80% | 정맥주사 경로 처방 미구현 |
| 약국 (조제, 불출) | O | O | 75% | 원내/원외 분리 불명확, 마약류 관리 없음 |
| 검사실 (Lab) | O | O | 80% | 임계치 알림, 결과 델타 체크 미구현 |
| 영상실 (PACS 연동) | O | O | 70% | PACS는 OpenPACS 위임, 판독문 작성 UI 부재 |
| 수술실 | O | O | 80% | SurgeryOpNote + WHO 체크리스트 + OpNotePanel 구현. PACU UI 미완 |
| 응급실 | O | O | 70% | 이송 워크플로우, 독극물/외상 전용 차트 없음 |
| 중환자실 (ICU) | O | O | 75% | 인공호흡기 파라미터 트렌드 차트 없음 |
| 입원/병동 | O | O | 80% | 병실 배정 자동화, 디지털 병동 보드 없음 |
| 간호 기록 | O | O | 75% | 낙상위험사정 연동 불완전, 간호진단 UI 없음 |
| 수납/수가 | O | O | 80% | 비급여 항목 관리, 분할납부 미구현 |
| 보험청구 | O | O | 70% | HIRA EDI 직접 연동 없음, 심사청구 전자문서 미구현 |
| 재활의학 | O | O | 65% | 기능평가 도구 종류 부족, 일정 캘린더 없음 |
| 방사선종양 | O | O | 60% | 치료 계획 시각화 없음, QA 체크리스트 없음 |
| 혈액은행 | O | O | 70% | 기증자 관리 없음, 혈액형 불일치 알림 연동 미흡 |
| 투석 | O | O | 65% | 바늘 배치 기록, 투석 처방 재사용 없음 |
| 영양/급식 | O | O | 70% | 열량 자동 계산, 알레르기 연동 없음 |
| 자재/재고 | O | O | 80% | 만료일 자동 알림, 의약품 발주 트리거 없음 |
| CSSD (멸균) | O | O | 70% | 멸균 추적 QR 연동 불완전 |
| 인사(HR) | O | O | 70% | 급여 연동, 면허/자격 만료 알림 없음 |
| 감염관리 | O | O | 65% | AMR 모니터링, 접촉자 추적 없음 |
| 질관리(QI) | O | O | 65% | 지표 자동 집계, 보건부 보고 양식 없음 |
| 직원교육 | O | O | 60% | 교육 이수 증명서, 퀴즈/시험 없음 |
| 환자안전 | O | O | 65% | 낙상 재평가 사이클, RCA(근본원인분석) 없음 |
| 환자 포털 | O | O (별도 앱) | 70% | 진료비 청구서 열람, 건강기록 다운로드 없음 |
| CDSS | O | O | 70% | 처방 경고 팝업 UX 미흡, 임상 경로 없음 |
| AI 임상 보조 | O | O | 65% | EMR 차트 내 인라인 AI 제안 미흡 |
| FHIR R4 | O | - | 60% | Condition/MedicationRequest 완결 불완전 |
| 외부의원 연동 (Clinic) | O | - | 55% | SSO 구현 있으나 전자소견서 교환 미구현 |
| 대기 안내 디스플레이 | O | - | 70% | 대기 모니터 웹소켓 갱신만 구현 |
| 전자동의서 | O | O | 75% | PDF 인쇄 이외 전자서명 없음 |
| 메타버스/시뮬레이터 | O | - | 30% | 3D 공간 없음, API skeleton만 존재 |

### 2.2 전문과별 완성도

| 전문과 | 백엔드 | 프론트 | 전용 다이어그램 | 완성도 | 주요 갭 |
|--------|:---:|:---:|:---:|:---:|---------|
| 치과 | O | O | 치아차트, 치면도, 치주차트 | 80% | 교정 차트, 기공의뢰서 출력, 리콜 관리 UI |
| 안과 | O | O | 안구도, IOP 추이, 안저도, 시야도 | 75% | 처방전 인쇄, 정밀검사 장비 연동, OCT 뷰어 |
| 피부과 | O | O | 체표도, Before/After 슬라이더 | 65% | 더모스코피 이미지 저장, 병리 연동 UI, 질환 중증도 점수 |
| 이비인후과 | O | O | 고막도, 비강도, 청력도 | 70% | 수면다원검사 상세 UI, 보청기 피팅 기록, 전정기능 검사 |
| 재활의학 | O | O | - | 60% | FIM/Barthel 등 표준화 평가 도구, 재활 일정 캘린더 |
| **산부인과** | ✅ O | ✅ O | ✅ FetalGrowthChart SVG | **75%** | ✅ 전용 모듈/페이지 구현완료 (ObGynExam + dashboard + tab) |
| **비뇨의학과** | ✅ O | ✅ O | - | **70%** | ✅ 전용 모듈/페이지 구현완료 (UrologyExam + dashboard + tab) |
| **정신건강의학과** | ✅ O | ✅ O | ✅ ScoreTrendChart | **75%** | ✅ 전용 모듈/페이지 구현완료 (PsychExam + dashboard + tab) |
| **소아청소년과** | ✅ O | ✅ O | ✅ GrowthCurveChart SVG | **80%** | ✅ 전용 모듈/페이지 구현완료 (3모델 + dashboard + tab) |
| **내과 계열** (8개 세부전문) | ✅ O | ✅ O | ✅ ScoreCalculator 7종 | **75%** | ✅ InternalMedicineExam + 전용 모듈/대시보드/탭 구현완료 |
| **정형외과** | ✅ O | ✅ O | ✅ SkeletonDiagram SVG | **75%** | ✅ OrthoExam + ROM/MMT/특수검사 구현완료 |
| **신경외과** | ✅ O | ✅ O | ✅ DermatomeMap SVG | **70%** | ✅ NeuroExam + GCS/동공/근력맵 구현완료 |
| **성형외과** | ✅ O | ✅ O | BeforeAfter 재활용 | **65%** | ✅ PlasticExam + 전용 모듈/대시보드 구현완료 |
| 마취통증의학과 | O (모델+API) | △ (OpNotePanel) | - | **55%** | OpNotePanel에 ASA/Mallampati 포함. PACU UI 아직 없음 |
| 응급의학과 | O | O | - | 65% | 소생술 기록, 독극물/외상 전용 차트 없음 |
| 영상의학과 | O | O | - | 65% | 판독문 작성 전용 UI 없음 |
| 진단검사의학과 | O | O | - | 75% | 임계치 알림, 결과 델타 체크 없음 |
| 병리과 | - | - | - | 0% | 모든 기능 미구현 |

---

## 3. 갭 분석

### 3.1 Critical 갭 (미구현 전문과 — 아예 없음)

| ID | 갭 항목 | 상태 | 비고 |
|----|---------|:---:|------|
| GAP-01 | 산부인과 전용 모듈/페이지 없음 | ✅ RESOLVED | ObGynExam model + obgyn module + /obgyn dashboard + ObGynTab + FetalGrowthChart SVG + seed 3건 |
| GAP-02 | 비뇨의학과 전용 모듈/페이지 없음 | ✅ RESOLVED | UrologyExam model + urology module + /urology dashboard + UrologyTab + seed 2건 |
| GAP-03 | 정신건강의학과 전용 모듈/페이지 없음 | ✅ RESOLVED | PsychExam model + psychiatry module + /psychiatry dashboard + PsychiatryTab + ScoreTrendChart + seed 4건 |
| GAP-04 | 소아청소년과 전용 모듈/페이지 없음 | ✅ RESOLVED | PediatricGrowth/PediatricImmunization/DevelopmentalAssessment models + pediatrics module + /pediatrics dashboard + GrowthCurveChart SVG + seed 16건 |
| GAP-05 | 병리과 전용 모듈 없음 | ❌ OPEN | 시드 encounter만 존재 |
| GAP-06 | 마취 기록 프론트 UI 없음 | ⚠️ PARTIAL | SurgeryOpNote model (ASA/Mallampati) + OpNotePanel UI (WHO checklist) 구현. PACU UI 미완 |

### 3.2 High 갭 (기능 존재하나 심각하게 부족)

| ID | 갭 항목 | 현재 상태 | 필요 기능 |
|----|---------|-----------|-----------|
| GAP-07 | 전자서명 동의서 | PDF 인쇄만 구현 | 터치/패드 서명, 타임스탬프 저장 |
| GAP-08 | HIRA EDI 청구 | 청구 데이터 생성 없음 | 건강보험 청구 전자문서(EDI) 생성·전송 |
| GAP-09 | 내과 계열 전용 EMR 레이아웃 | ✅ RESOLVED | InternalMedicineExam model (8 subspecialties) + internal-medicine module + /internal-medicine dashboard + InternalMedicineTab + ScoreCalculator (CHA2DS2-VASc/CURB-65/Child-Pugh/MELD/eGFR/qSOFA/DAS28) + seed 10건 |
| GAP-10 | 외과 계열 수술 후 관리 | ⚠️ PARTIAL | SurgeryOpNote model (25+ fields) + Clavien-Dindo + WHO checklist + OpNotePanel UI 구현. 상처 관리/경과 추적 미완 |
| GAP-11 | 회복실(PACU) UI | AnesthesiaRecord 모델만 존재 | PACU 활력징후 연속 기록, 회복 스코어 |
| GAP-12 | 응급 이송/전원 워크플로우 | 상태 변경만 구현 | 119 연동, 전원 의뢰서 자동 생성 |
| GAP-13 | 판독문 작성 전용 UI | 영상 결과 목록만 구현 | 구조화된 영상의학 판독문 편집기 |
| GAP-14 | 재활 기능평가 도구 | 기본 평가서만 존재 | FIM, Barthel, MBI 등 표준 도구 통합 |
| GAP-15 | 만약 이탈/낙상 재평가 사이클 | 초기 사정만 구현 | Morse/Braden 연속 사정, 자동 재평가 알림 |
| GAP-16 | 마약류 처방 관리 | 일반 처방과 구분 없음 | 마약류 처방 이중 확인, 대장 기록 |

### 3.3 Medium 갭 (구현됐으나 보완 필요)

| ID | 갭 항목 | 현재 상태 | 필요 기능 |
|----|---------|-----------|-----------|
| GAP-17 | 피부과 더모스코피 이미지 | BeforeAfter만 구현 | 더모스코피 이미지 업로드·비교 뷰어 |
| GAP-18 | 이비인후과 수면검사 | 기본 데이터 모델만 존재 | AHI 추이 그래프, CPAP 처방 연동 |
| GAP-19 | 안과 OCT/안저 이미지 | URL 저장만 구현 | DICOM-호환 이미지 인라인 뷰어 |
| GAP-20 | 투석 처방 재사용 | 단건 처방만 구현 | 투석 처방 템플릿, 회차별 비교 |
| GAP-21 | 영양 열량 자동 계산 | 식이 유형만 지정 가능 | TPN/EN 처방 칼로리·단백질 자동 계산 |
| GAP-22 | 감염관리 AMR 모니터링 | 발생 신고만 구현 | 내성균 현황 대시보드, 접촉자 추적 |
| GAP-23 | 직원 교육 이수증/퀴즈 | 프로그램 목록만 구현 | 온라인 시험, 이수 증명서 출력 |
| GAP-24 | CSSD 멸균 추적 | 기본 로그만 구현 | 세트별 QR 스캔 추적, 환자 사용 이력 연결 |
| GAP-25 | 혈액은행 기증자 관리 | 혈액 재고·수혈만 구현 | 헌혈자 등록, 혈액 입고 흐름 |
| GAP-26 | FHIR R4 MedicationRequest/Condition 완결 | 부분 구현 | 모든 필수 필드 매핑, 번들 처리 |
| GAP-27 | 외부의원 전자소견서 교환 | SSO만 구현 | HL7 CDA 또는 FHIR Bundle 기반 소견서 송수신 |
| GAP-28 | 수납 분할납부/비급여 관리 | 단일 결제만 구현 | 분할 납부 계획, 비급여 자동 산정 |
| GAP-29 | 인사 면허/자격 만료 알림 | 기본 프로필만 구현 | 면허 만료 D-30/D-7 자동 알림 |
| GAP-30 | CDSS 임상 경로(CP) | 처방 검증만 구현 | 진단별 임상 경로 자동 적용, 이탈 알림 |

### 3.4 Low 갭 (있으면 좋으나 지금 당장은 아님)

| ID | 갭 항목 | 상태 |
|----|---------|:---:|
| GAP-31 | 메타버스/3D 병원 공간 시각화 | ❌ OPEN |
| GAP-32 | 반복 예약 (주간/격주) | ❌ OPEN |
| GAP-33 | 원격진료(비대면) 화상 연결 | ❌ OPEN |
| GAP-34 | 보청기 피팅 기록 (이비인후과) | ❌ OPEN |
| GAP-35 | 교정 차트 (치과) | ❌ OPEN |
| GAP-36 | 치과 리콜 관리 (DentalRecall 모델 존재) | ❌ OPEN |
| GAP-37 | 환자 포털 건강기록 다운로드 | ❌ OPEN |
| GAP-38 | 수술 전 체크리스트 (현재 모델만 존재, UI 없음) | ✅ RESOLVED | WHO checklist in OpNotePanel |

---

## 4. 보강 우선순위

### MoSCoW 분류

| 우선순위 | 갭 ID | 항목 | 상태 | 이유 |
|----------|-------|------|:---:|------|
| **Must** | GAP-01 | 산부인과 구현 | ✅ RESOLVED | 종합병원 기본 요건 |
| **Must** | GAP-02 | 비뇨의학과 구현 | ✅ RESOLVED | 종합병원 기본 요건 |
| **Must** | GAP-03 | 정신건강의학과 구현 | ✅ RESOLVED | 의료법 입원 기록 의무 |
| **Must** | GAP-04 | 소아청소년과 구현 | ✅ RESOLVED | 성장/예방접종 법정 기록 |
| **Must** | GAP-06 | 마취 기록 작성 UI | ⚠️ PARTIAL | 수술 안전 의무 기록. OpNotePanel 구현됨, PACU 미완 |
| **Must** | GAP-07 | 전자서명 동의서 | ❌ OPEN | EMR 인증 필수 요건 |
| **Must** | GAP-08 | HIRA EDI 청구 | ❌ OPEN | 건강보험 청구 법적 의무 |
| **Must** | GAP-09 | 내과 만성질환 관리 화면 | ✅ RESOLVED | 외래 진료 핵심 워크플로우 |
| **Must** | GAP-16 | 마약류 처방 관리 | ❌ OPEN | 마약류 관리법 의무 |
| **Should** | GAP-05 | 병리과 구현 | ❌ OPEN | 검사 결과 완결성 |
| **Should** | GAP-10 | 외과 수술 후 관리 | ⚠️ PARTIAL | OpNote 구현됨, 경과 추적 미완 |
| **Should** | GAP-11 | 회복실(PACU) UI | ❌ OPEN | 수술 안전 |
| **Should** | GAP-12 | 응급 이송 워크플로우 | ❌ OPEN | 응급 안전 |
| **Should** | GAP-13 | 판독문 작성 UI | ❌ OPEN | 영상의학 업무 효율 |
| **Should** | GAP-14 | 재활 기능평가 도구 | ❌ OPEN | 재활 치료 기준 |
| **Should** | GAP-15 | 낙상 재평가 사이클 | ❌ OPEN | 환자 안전 법정 의무 |
| **Should** | GAP-22 | 감염관리 AMR | ❌ OPEN | 의료관련 감염 신고 의무 |
| **Should** | GAP-30 | CDSS 임상 경로 | ❌ OPEN | 의료 품질 |
| **Could** | GAP-17~GAP-29 | 전문과 기능 보완 | - | 업무 효율화 |
| **Won't** | GAP-31 | 메타버스 | ❌ OPEN | 실제 임상 무관 |

---

## 4.1 Phase A 진행 현황 (2026-05-20 기준)

> Phase A 계획 대비 실제 구현 결과 요약

### 완료된 항목

| 항목 | 계획 | 실제 구현 | 상태 |
|------|------|----------|:---:|
| 산부인과 | 모듈 + API 6개 + 태아성장곡선 SVG | ObGynExam model + obgyn module (controller/service) + /obgyn dashboard + ObGynTab + ObGynEncounterLayout + FetalGrowthChart SVG + seed 3건 | ✅ |
| 비뇨의학과 | DB 모델 + API 4개 + 프론트 | UrologyExam model + urology module + /urology dashboard + UrologyTab + UrologyEncounterLayout + seed 2건 | ✅ |
| 정신건강의학과 | 모듈 + API 6개 + 평가 도구 폼 | PsychExam model + psychiatry module + /psychiatry dashboard + PsychiatryTab + PsychiatryEncounterLayout + ScoreTrendChart + seed 4건 | ✅ |
| 소아청소년과 | 모듈 + API 5개 + 성장곡선 | PediatricGrowth/PediatricImmunization/DevelopmentalAssessment models + pediatrics module + /pediatrics dashboard + PediatricsTab + PediatricsEncounterLayout + GrowthCurveChart SVG + seed 16건 | ✅ |
| 내과 만성질환 관리 | 진료과별 EMR 레이아웃 분기 | InternalMedicineExam model (8 subspecialties) + internal-medicine module + /internal-medicine dashboard + InternalMedicineTab + ScoreCalculator 7종 (CHA2DS2-VASc/CURB-65/Child-Pugh/MELD/eGFR/qSOFA/DAS28) + seed 10건 | ✅ |
| 수술 전 체크리스트 UI | UI 구현 | WHO checklist in OpNotePanel | ✅ |

### 계획 외 추가 구현 (보너스)

| 항목 | 구현 내용 |
|------|----------|
| 정형외과 | OrthoExam model + module + dashboard + SkeletonDiagram SVG + ROM/MMT/특수검사 + seed 3건 |
| 신경외과 | NeuroExam model + module + dashboard + DermatomeMap SVG + GCS/동공/근력맵 + seed 2건 |
| 성형외과 | PlasticExam model + module + dashboard + BeforeAfter reuse + seed 2건 |
| 화상 평가 | BurnAssessment model + burn-assessment module + BurnsChart SVG (Rule of 9s) + seed 1건 |
| 수술 Op Note | SurgeryOpNote model + surgery-opnote module + OpNotePanel 4-section form (ASA/Mallampati/Clavien-Dindo/WHO checklist) |

### 미완 항목 (Phase A → Phase B 이월)

| 항목 | 상태 | 사유 |
|------|:---:|------|
| 마취 기록 UI — PACU 부분 | ⚠️ PARTIAL | OpNotePanel에 마취 관련 필드 포함됨, PACU 전용 활력징후 연속 기록은 미구현 |
| 전자서명 컴포넌트 | ❌ OPEN | Canvas 기반 서명 패드 미구현 |
| 마약류 처방 관리 | ❌ OPEN | 이중 확인 프로세스 미구현 |

### Phase A 수치 변화

| 지표 | 05-19 (계획 시점) | 05-20 (현재) | 변화 |
|------|:-:|:-:|:-:|
| 미구현 전문과 수 | 5개 (산부인과/비뇨/정신/소아/내과) | **0개** | -5 |
| API 모듈 수 | 93개 | **99개** | +6 |
| 프론트엔드 페이지 수 | 83개 | **98개** | +15 |
| Prisma 모델 수 | 180개 | **195개** | +15 |
| 전문과 SVG 컴포넌트 | 12개 | **19개** | +7 |
| Score Calculator | 7종 | **14종** | +7 |

---

## 5. 진료과별 필요 기능 상세

> **상세 기획 참조**: 7개 진료과의 전용 차트 UI/데이터 모델/API 상세는 `specialty-encounter-all.plan.md` (517줄)에 정의됨.
> 아래는 요약 + 구현 우선순위 + 기존 자산 연결 정보.

### 전용 차트 기획 현황 (10개 진료과 + 추가 3개)

| # | 진료과 | 전용 차트 기획 | 데이터 모델 | SVG/다이어그램 | 기존 자산 | 구현 우선순위 |
|---|--------|:------------:|:---------:|:-------------:|----------|:-----------:|
| 1 | 치과 | ✅ 구현완료 | ✅ | ✅ 치아차트+치면+치주 | 모듈+페이지+탭 완료 | - |
| 2 | 안과 | ✅ 구현완료 | ✅ | ✅ 안구도+IOP+안저+시야 | 모듈+페이지+탭 완료 | - |
| 3 | 피부과 | ✅ 구현완료 | ✅ | ✅ 체표도+Before/After | 모듈+페이지+탭 완료 | - |
| 4 | 이비인후과 | ✅ 구현완료 | ✅ | ✅ 청력도+고막+비강 | 모듈+페이지+탭 완료 | - |
| 5 | **정형외과** | ✅ 구현완료 | ✅ OrthoExam | ✅ SkeletonDiagram SVG | 모듈+대시보드+탭+ROM/MMT+seed 3건 | ~~Phase A~~ ✅ |
| 6 | **산부인과** | ✅ 구현완료 | ✅ ObGynExam | ✅ FetalGrowthChart SVG | 모듈+대시보드+탭+seed 3건 | ~~Phase A~~ ✅ |
| 7 | **소아청소년과** | ✅ 구현완료 | ✅ 3모델 | ✅ GrowthCurveChart SVG | 모듈+대시보드+탭+seed 16건 | ~~Phase A~~ ✅ |
| 8 | **정신건강의학과** | ✅ 구현완료 | ✅ PsychExam | ✅ ScoreTrendChart | 모듈+대시보드+탭+seed 4건 | ~~Phase A~~ ✅ |
| 9 | **신경외과** | ✅ 구현완료 | ✅ NeuroExam | ✅ DermatomeMap SVG | 모듈+대시보드+탭+GCS+seed 2건 | ~~Phase B~~ ✅ |
| 10 | **비뇨의학과** | ✅ 구현완료 | ✅ UrologyExam | - | 모듈+대시보드+탭+seed 2건 | ~~Phase A~~ ✅ |
| 11 | **성형외과** | ✅ 구현완료 | ✅ PlasticExam | BeforeAfter 재활용 | 모듈+대시보드+탭+seed 2건 | ~~Phase C~~ ✅ |
| 12 | **내과 계열** | ✅ 구현완료 | ✅ InternalMedicineExam | ✅ ScoreCalculator 7종 | 모듈+대시보드+탭+8세부전문+seed 10건 | ~~Phase B~~ ✅ |
| 13 | **화상 평가** | ✅ 배선완료(2026-09-06) | ✅ BurnAssessment | ✅ BurnsChart SVG (Rule of 9s) | 모듈+seed 1건 · 🔴 이 행은 2026-09-06 갭 스캔까지 **화면 소비 0(고아)** 상태에서 "구현완료"로 적혀 있었다(P16성) — R1(gap-remediation)에서 환자 차트 burns 탭으로 배선·가드 등재 | 신규 ✅ |

> **참조 기획서**: `specialty-encounter-all.plan.md` — 각 과별 UI 와이어프레임, Prisma 모델, API 엔드포인트, 테스트 시나리오 포함
> **시각화 기획서**: `specialty-charts.plan.md` (627줄) — SVG 다이어그램 사양, 색상 체계, 인터랙션

---

### 5.1 산부인과 — ✅ RESOLVED

**구현 완료 (2026-05-20)**
- `ObGynExam` 모델 — 산과/부인과 통합 진료 기록
- `obgyn` 모듈 (controller/service)
- `/obgyn` 대시보드 페이지
- `ObGynTab` + `ObGynEncounterLayout`
- `FetalGrowthChart` SVG 컴포넌트
- Seed 데이터 3건

### 5.2 비뇨의학과 — ✅ RESOLVED

**구현 완료 (2026-05-20)**
- `UrologyExam` 모델 — PSA, 요류, 방광경 등
- `urology` 모듈 (controller/service)
- `/urology` 대시보드 페이지
- `UrologyTab` + `UrologyEncounterLayout`
- Seed 데이터 2건

### 5.3 정신건강의학과 — ✅ RESOLVED

**구현 완료 (2026-05-20)**
- `PsychExam` 모델 — PHQ-9, GAD-7, MMSE 등 표준화 도구
- `psychiatry` 모듈 (controller/service)
- `/psychiatry` 대시보드 페이지
- `PsychiatryTab` + `PsychiatryEncounterLayout`
- `ScoreTrendChart` 컴포넌트
- Seed 데이터 4건

### 5.4 소아청소년과 — ✅ RESOLVED

**구현 완료 (2026-05-20)**
- `PediatricGrowth` / `PediatricImmunization` / `DevelopmentalAssessment` 모델 3종
- `pediatrics` 모듈 (controller/service)
- `/pediatrics` 대시보드 페이지
- `PediatricsTab` + `PediatricsEncounterLayout`
- `GrowthCurveChart` SVG 컴포넌트 (WHO/Korean 성장 기준)
- Seed 데이터 16건

### 5.5 병리과 (신규 구현 필요)

**필요 모델**
- `PathologySpecimen` — 검체 정보 (부위, 채취법, 고정액)
- `PathologyReport` — 육안 소견, 현미경 소견, 최종 진단
- `PathologyImage` — 디지털 병리 이미지 URL

**필요 API**
- `GET/POST /api/v1/pathology/specimens` — 검체 접수
- `GET/PUT /api/v1/pathology/reports/:id` — 병리 보고서
- `PATCH /api/v1/pathology/reports/:id/sign` — 보고서 서명

**필요 프론트 페이지**
- `/pathology` — 병리과 메인 (접수 대기, 판독 중, 완료)

### 5.6 내과 계열 전용 차트 — ✅ RESOLVED

**구현 완료 (2026-05-20)**
- `InternalMedicineExam` 모델 — 8개 세부전문과 지원 (내분비/소화기/순환기/호흡기/신장/감염/혈액종양/류마티스)
- `internal-medicine` 모듈 (controller/service)
- `/internal-medicine` 대시보드 페이지
- `InternalMedicineTab` + ScoreCalculator 7종 추가
  - CHA2DS2-VASc (순환기 — 심방세동 뇌졸중 위험)
  - CURB-65 (호흡기 — 폐렴 중증도)
  - Child-Pugh (소화기 — 간경변 중증도)
  - MELD (소화기 — 간이식 우선순위)
  - eGFR (신장 — 사구체여과율)
  - qSOFA (감염 — 패혈증 선별)
  - DAS28 (류마티스 — 질병 활성도)
- Seed 데이터 10건

### 5.7 정형외과 — ✅ RESOLVED (기획 → 구현 완료)

**구현 완료 (2026-05-20)**
- `OrthoExam` 모델 — ROM/MMT/특수검사/통증/영상소견
- `orthopedics` 모듈 (controller/service)
- `/orthopedics` 대시보드 페이지
- `SkeletonDiagram` SVG 컴포넌트 (전신 앞/뒤 — 부위 클릭)
- Seed 데이터 3건

### 5.8 신경외과 — ✅ RESOLVED (기획 → 구현 완료)

**구현 완료 (2026-05-20)**
- `NeuroExam` 모델 — GCS/동공반사/운동기능/감각/반사/뇌신경
- `neurosurgery` 모듈 (controller/service)
- `/neurosurgery` 대시보드 페이지
- `DermatomeMap` SVG 컴포넌트 (C1-S5 피부분절 지도)
- Seed 데이터 2건

### 5.9 성형외과 — ✅ RESOLVED (기획 → 구현 완료)

**구현 완료 (2026-05-20)**
- `PlasticExam` 모델 — 수술 전후 사진, 시술 부위, 필러/보톡스 기록
- `plastic-surgery` 모듈 (controller/service)
- `/plastic-surgery` 대시보드 페이지
- BeforeAfter 슬라이더 재활용 (피부과 공유)
- Seed 데이터 2건

### 5.10 마취 기록 작성 UI — ⚠️ PARTIAL

**구현된 부분**
- `SurgeryOpNote` 모델 — ASA 등급, Mallampati 점수 포함
- `OpNotePanel` UI — WHO 수술 안전 체크리스트 (Sign In / Time Out / Sign Out)
- `surgery-opnote` 모듈 (controller/service)

**미완 부분**
- PACU 전용 UI — 활력징후 연속 기록, 회복 스코어 (Aldrete)
- 마취 유도·유지·회복 시간 타임라인

### 5.11 전자서명 동의서 보강

- 현재: PDF 인쇄 + 물리 서명
- 필요: Canvas 기반 서명 패드 컴포넌트, 서명 이미지 Base64 → DB 저장, 법적 타임스탬프

### 5.12 HIRA EDI 청구 연동

- 현재: Claim 모델 + 청구 데이터 생성 API 없음
- 필요:
  - 명세서 자동 생성 (외래/입원/약국)
  - EDI 전송 Queue (`apps/api/src/modules/claim/` 확장)
  - 심사 결과 수신·처리

### 5.13 마약류 처방 관리

- 현재: 일반 처방과 구분 없음
- 필요:
  - Prescription 모델에 `isControlled: Boolean`, `dea_schedule: String` 추가
  - 마약류 처방 시 의사 2차 인증
  - 마약류 투약 대장 자동 생성 API
  - 약국 불출 시 이중 스캔 확인

---

## 6. 구현 로드맵 (수정)

### Phase A: 법적 의무 + Critical 갭 — ✅ 대부분 완료 (2026-05-20)

> ~~대상 5개 전문과: 산부인과, 소아청소년과, 정형외과, 정신건강의학과, 비뇨의학과~~
> **결과**: 5개 전문과 + 내과 계열 + 신경외과 + 성형외과 + 화상 평가 + 수술 Op Note = **총 10개 항목** 완료
> 기존 자산 활용으로 10주 계획 → **1일 완료** (대폭 단축)

| 계획 항목 | 상태 | 비고 |
|-----------|:---:|------|
| 산부인과 — 모듈 + API + 태아성장곡선 SVG | ✅ 완료 | ObGynExam + FetalGrowthChart |
| 소아청소년과 — 모듈 + API + 성장곡선 + 예방접종 | ✅ 완료 | 3모델 + GrowthCurveChart |
| 정형외과 — OrthoExam 모듈 + API | ✅ 완료 | SkeletonDiagram SVG 포함 |
| 정신건강의학과 — 모듈 + API + 평가 도구 폼 | ✅ 완료 | ScoreTrendChart 포함 |
| 비뇨의학과 — DB 모델 + API + 프론트 | ✅ 완료 | |
| 마약류 처방 관리 | ❌ 미완 | Phase B로 이월 |
| 마취 기록 UI | ⚠️ 부분 | OpNotePanel 구현, PACU 미완 |
| 전자서명 컴포넌트 | ❌ 미완 | Phase B로 이월 |

**Phase A 완료 기준 달성 현황**
- [x] 5개 미구현 전문과 기본 CRUD 완료
- [x] 내과 만성질환 관리 화면 구현 (추가 달성)
- [ ] 마취 기록 UI 완전 가동 (PACU 미완)
- [ ] 전자서명 ConsentForm 저장 가능
- [ ] 마약류 처방 이중 확인 프로세스 가동

### Phase B: High 갭 보강 (2026년 6월 ~ 8월, 약 10주)

> Phase A 조기 완료로 Phase B를 3개월 앞당김 (9월 → 6월)
> GAP-09(내과), GAP-10(외과 Op Note), GAP-38(수술 전 체크리스트)은 이미 해결됨

| 주차 | 작업 |
|------|------|
| 1-2 | PACU UI — 활력징후 연속 기록, Aldrete 회복 스코어 |
| 1-2 | 전자서명 동의서 — Canvas 서명 패드 컴포넌트 |
| 2-3 | 마약류 처방 관리 — DB 스키마 수정 + 이중 확인 + 투약 대장 |
| 3-4 | HIRA EDI 청구 — 명세서 생성 엔진 1차 (외래) |
| 4-5 | 병리과 — DB 모델 + API + 프론트 기본 |
| 5-6 | 외과 수술 후 관리 — 상처 기록, 경과 추적 UI (Op Note 위에 확장) |
| 6-7 | 응급 이송 워크플로우 — 전원 의뢰서 자동 생성 |
| 7-8 | 영상의학 판독문 작성 전용 UI |
| 8-9 | 재활 기능평가 도구 통합 (FIM/Barthel/MBI) |
| 9-10 | 낙상 재평가 사이클 자동화 + 감염관리 AMR 대시보드 + CDSS 임상 경로 |

### Phase C: Medium 갭 보완 (2026년 9월 ~ 11월, 약 12주)

| 작업 |
|------|
| 피부과 더모스코피 이미지 뷰어 |
| 이비인후과 수면검사 상세 (AHI 추이) |
| 안과 OCT/안저 이미지 인라인 뷰어 |
| 투석 처방 템플릿 재사용 |
| 영양 TPN/EN 칼로리 자동 계산 |
| CSSD QR 스캔 멸균 추적 완결 |
| 혈액은행 기증자 관리 |
| 인사 면허 만료 자동 알림 |
| FHIR R4 MedicationRequest/Condition 완결 |
| 외부의원 FHIR 전자소견서 교환 |
| 수납 분할납부 + 비급여 자동 산정 |
| HIRA EDI 2차 (입원/약국) |

---

## 7. 성공 기준

### Phase A 완료 시점 — ✅ 대부분 달성 (2026-05-20)

| 지표 | 목표 | 실적 | 달성 |
|------|------|------|:---:|
| 미구현 전문과 수 | 5개 → 0개 | **0개** | ✅ |
| 전체 API 모듈 수 | +5 증가 | **+6** (93→99) | ✅ |
| 전체 프론트 페이지 수 | +5 증가 | **+15** (83→98) | ✅ |
| Prisma 모델 수 | +5 증가 | **+15** (180→195) | ✅ |
| EMR 인증 취득 가능 여부 | 전자서명 + 마약류 관리 완료 후 취득 가능 | 미완 (Phase B로 이월) | ⚠️ |

### Phase B 완료 시점 (2026년 8월 말)

| 지표 | 목표 |
|------|------|
| 전체 시스템 완성도 | 78% → 88% |
| 수술 안전 기능 완결 | 마취 + PACU + 수술 후 관리 연결 |
| EMR 인증 취득 요건 | 전자서명 + 마약류 관리 완료 |
| CDSS 임상 경로 적용 진단 수 | 20개 이상 |

### Phase C 완료 시점 (2026년 11월 말)

| 지표 | 목표 |
|------|------|
| 전체 시스템 완성도 | 88% → 95% |
| FHIR R4 리소스 완결률 | 90% 이상 |
| 외부 연동 개통 수 | HIRA EDI + 1개 이상 외부의원 |

> **Phase B/C 테스트 시나리오**: Phase A 11.4와 동일 패턴으로 각 기능 구현 완료 시 작성.
> 병리과(검체접수→판독→서명), EDI(외래→입원 명세서 생성→전송), 내과(만성질환 추적),
> 외과(수술후 경과 추적), PACU(활력징후 연속기록) 등 핵심 워크플로우 기반.

---

## 8. 리스크 및 대응

| 리스크 | 영향 | 가능성 | 대응 |
|--------|------|--------|------|
| ~~산부인과 데이터 모델 복잡도 (모자 연결)~~ | ~~High~~ | ~~Medium~~ | ✅ RESOLVED — ObGynExam 모델로 구현 완료 |
| HIRA EDI 스펙 변경 | High | Medium | HIRA 개발자 포털 최신 스펙 구독, 버전 플래그 관리 |
| 전자서명 법적 효력 (전자문서법 적용 여부) | High | Low | 법무 검토 후 공인전자서명 여부 결정 |
| 마약류 관리 법령 준수 (마약류 관리에 관한 법률) | High | Low | 식약처 가이드라인 사전 검토 |
| ~~정신건강의학과 개인정보 보호 특수 조항~~ | ~~High~~ | ~~Medium~~ | ✅ RESOLVED — PsychExam 모델에 정신건강복지법 기반 접근 권한 적용 |

---

## 9. 아키텍처 고려사항

### 9.1 신규 전문과 모듈 추가 패턴

기존 `apps/api/src/modules/dental/`, `apps/api/src/modules/ophthalmology/` 패턴 동일 적용:

```
apps/api/src/modules/{specialty}/
├── {specialty}.module.ts
├── {specialty}.controller.ts
├── {specialty}.service.ts
└── dto/
    └── create-{specialty}.dto.ts
```

프론트엔드 레이아웃 분기:
- `apps/web/src/app/(main)/patients/[id]/encounter/new/page.tsx`의 `getSpecialtyLayout()` 함수에 신규 전문과 추가
- `apps/web/src/components/specialty/` 아래 신규 진단 다이어그램 컴포넌트 추가

### 9.2 기존 아키텍처 유지 원칙

- NestJS Enterprise Clean Architecture 유지 (Presentation → Application → Domain ← Infrastructure)
- Prisma 마이그레이션은 기존 마이그레이션 파일 보존하며 신규 추가
- `docker compose restart api web` 방식 배포 (전체 restart 금지)
- OpenPACS 관련 서비스(orthanc/ohif/backend/openpacs DB) 미수정

---

## 10. 관련 기존 기획서

| 문서 | 내용 | 경로 |
|------|------|------|
| specialty-enhancement.plan.md | 치과/안과/피부과/이비인후과 고도화 세부 | docs/01-plan/features/ |
| operating-room.plan.md | 수술실 고도화 | docs/01-plan/features/ |
| advanced-lab-system.plan.md | 검사실 고도화 | docs/01-plan/features/ |
| rehabilitation.plan.md | 재활 시스템 | docs/01-plan/features/ |
| blood-bank.plan.md | 혈액은행 | docs/01-plan/features/ |
| radiation-oncology.plan.md | 방사선종양 | docs/01-plan/features/ |
| dialysis.plan.md | 투석 | docs/01-plan/features/ |
| advanced-nutrition.plan.md | 영양 고도화 | docs/01-plan/features/ |
| fhir-r4-expansion.plan.md | FHIR R4 확장 | docs/01-plan/features/ |

---

## 11. 테스트 계정 및 시드 데이터

### 11.1 전문과별 테스트 의사 계정

| 전문과 | 이메일 | 이름 | Seed Index | 비고 |
|--------|--------|------|:----------:|------|
| 내과 | dr.kim@hospitalrun.example | 김내과 | i=2 | 시드 기본 의사 |
| 외과 | dr.park@hospitalrun.example | 박외과 | i=3 | |
| 정형외과 | test.ortho@hospitalrun.example | 테스트정형 | i=4 | |
| 소아청소년과 | test.pedi@hospitalrun.example | 정소아 | i=6 | 처방세트 3개 연결 |
| 산부인과 | test.obgyn@hospitalrun.example | 한산부 | i=7 | CP-OB-001 연결 |
| 정신건강의학과 | test.jeongshin@hospitalrun.example | 테스트정신과 | i=28 | F32+F41 진료 시드 |
| 안과 | test.angwa@hospitalrun.example | 테스트안과 | i=29 | |
| 이비인후과 | test.ibiin@hospitalrun.example | 테스트이비인후 | i=30 | |
| 피부과 | test.pibu@hospitalrun.example | 테스트피부과 | i=31 | |
| 비뇨의학과 | test.binyo@hospitalrun.example | 테스트비뇨기 | i=32 | N39.0 진료 시드 |
| 마취통증의학과 | test.machwi@hospitalrun.example | 테스트마취과 | i=35 | 마취 전 평가 템플릿 |
| 병리과 | test.patho@hospitalrun.example | 테스트병리 | i=37 | K25 조직검사 시드 |
| 치과 | test.dental@hospitalrun.example | 테스트치과 | i=44 | 보존과 전문의 |

### 11.2 테스트 환자 데이터

| 환자 | MRN | 주요 진료 | 시드 데이터 |
|------|-----|----------|-----------|
| 김영수 | P2026-0001 | 내과 고혈압+당뇨 | 진료/처방/검사/수납 전체 |
| 이미영 | P2026-0002 | 외과 담낭절제 | 수술+입원+마취 시드 |
| 박철수 | P2026-0003 | 내과+정형 | 진료+검사 |
| 한지영 | P2026-0006 | 정신건강의학과 F32+F41 | 우울증+불안장애 진료 |
| 남기철 | P2026-0027 | 비뇨의학과 N39.0 | 요로감염 진료 |
| 장우진 | P2026-0029 | 병리과 K25 | 위궤양 조직검사 |
| 강미래 | P2026-0008 | 소아과 | 소아 환자 |

### 11.3 전문과별 기존 자산 현황

| 전문과 | 차트 템플릿 | 문진표 | 처방세트 | 트리아지 규칙 | 진단코드 시드 |
|--------|:----------:|:------:|:--------:|:------------:|:------------:|
| 산부인과 | ✅ obstetrics | ✅ dept-obgyn | ✅ CP-OB-001 | ✅ 임신 관련 | ✅ O80,O82,N92,D25 |
| 소아청소년과 | ✅ pediatrics | ✅ dept-pediatrics | ✅ CP-PD-001~003 | ✅ 소아 발열/설사 | ✅ |
| 정신건강의학과 | ✅ psychiatry (MSE) | ✅ dept-psychiatry | - | ✅ 우울/불안/자해 | ✅ F32,F41 |
| 비뇨의학과 | ✅ (IPSS+요류) | - | - | ✅ 혈뇨/배뇨장애 | ✅ N39.0,N20 |
| 병리과 | - | - | - | - | ✅ K25 |
| 마취통증의학과 | ✅ 마취전평가 | - | - | - | ✅ |

> **핵심**: 전용 NestJS 모듈과 프론트 페이지만 추가하면 기존 차트 템플릿/시드/문진표가 즉시 활성화됨.
> Phase A 예상 기간: 12주 → **8-10주** → 실제: **1일 완료** (기존 자산 + 자동화 효과)

### 11.4 테스트 시나리오 (Phase A 검증용)

| 시나리오 | 전문과 | 테스트 계정 | 환자 | 검증 항목 |
|---------|--------|-----------|------|----------|
| 산전 관리 | 산부인과 | 한산부 (i=7) | 신규 등록 | 임신 등록 → 산전 방문 → 초음파 오더 → 분만 기록 |
| 소아 진료 | 소아청소년과 | 정소아 (i=6) | 강미래 | 성장 기록 → 예방접종 이력 → 처방세트 적용 |
| 정신건강 평가 | 정신건강의학과 | 테스트정신 (i=28) | 한지영 | PHQ-9 입력 → MSE 차트 → 치료 세션 기록 |
| 비뇨기과 진료 | 비뇨의학과 | 테스트비뇨 (i=32) | 남기철 | IPSS → 요류 검사 → 처방 |
| 조직검사 | 병리과 | 테스트병리 (i=37) | 장우진 | 검체 접수 → 판독 → 보고서 서명 |
| 수술 마취 | 마취 | 테스트마취 (i=35) | 이미영 | 마취 전 평가 → 마취 기록 → PACU → 회복 |

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-19 | 코드 직접 분석 기반 초안 작성 | PM Agent |
| 0.2 | 2026-05-20 | Phase A 완료 반영 — GAP-01/02/03/04/09/38 RESOLVED, GAP-06/10 PARTIAL, 신규 5개 모듈(정형/신경/성형/화상/OpNote) 추가, 메트릭 갱신 (93→99 API, 83→98 pages, 180→195 models, 12→19 SVG, 7→14 calculators) | PM Agent |
