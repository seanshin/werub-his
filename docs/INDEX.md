# Hospital RUN 기획서 인덱스

> 최종 갱신: 2026-08-10 (v3.97.0) — **아래 상태 표는 그 시점 스냅샷이며 이후 축이 반영돼 있지 않습니다.**
>
> 🔴 **최근 문서와 그 상태는 [`00-document-map.md`](00-document-map.md) 가 정본입니다.**
> 이 파일은 초기~중기 핵심 기획서 112건의 상태 스냅샷으로 남깁니다.
>
> 📌 파일 수 실측(2026-08-25): 01-plan 252 · 02-design 34 · 03-analysis 48 · 04-report 192 · 05-reference 140 (`.md` 기준)

## 상태 범례

| 상태 | 의미 | 수량 |
|------|------|------|
| ✅ DONE | 구현 완료 (80%+) | 208 |
| 🔨 PARTIAL | 일부 구현 | 0 |
| 📋 PLANNED | 미착수 | 0 |
| 🗺️ ROADMAP | 장기/전략 계획 | 6 |

---

## docs/ 디렉토리 구조

```
docs/
├── 00-document-map.md          ← 문서 지도(최근 축·상태·정본 안내) · 최신 정본
├── INDEX.md                    ← 이 파일 (초기~중기 스냅샷)
├── DEMO-SCENARIO.md            프로젝트 시연 시나리오
├── DEPLOYMENT.md               배포 가이드
├── Hospital_RUN_소개자료.md     프로젝트 소개
├── OPERATIONS.md               운영 매뉴얼
├── 01-plan/                    기획서 252 (features 218 + integrations 22 + references 2 + 최상위 10)
├── 02-design/                  설계서 34 (features 27 + 최상위 7)
├── 03-analysis/                분석 보고서 48
├── 04-report/                  완료·릴리즈 보고서 192 (RELEASE-v*.md 94 · features 81)
├── 05-reference/               참고/연동 문서 140
├── handoff/                    외부 팀 인계물 13
├── 06-report/ · _archive/ · archive/  구버전·흡수 문서
```
> 파일 수는 2026-08-25 `.md` 실측. 계층별 성격과 대표 정본은 [`00-document-map.md`](00-document-map.md) §1.

---

## 01-plan/features — 기능 기획서 (핵심 스냅샷 112건 · 전체 208건)

### 핵심 시스템 (Core)

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 1 | hospital-run.plan.md | ✅ | 초기 전체 기획 |
| 2 | hospital-run-phase2.plan.md | ✅ | Phase 2 (OCS+DUR+수납+FormEngine 전체 완료) |
| 3 | hospital-run-phase3.plan.md | ✅ | Phase 3 (청구+HIRA+약국+검사+영상 전체 완료) |
| 4 | system-enhancement-roadmap.plan.md | ✅ | 시스템 전체 로드맵 (GAP 30건 해소) |
| 5 | university-hospital-expansion.plan.md | ✅ | 대학병원급 확장 (295모델/140모듈/1860API) |
| 6 | his-gap-analysis.plan.md | ✅ | HIS 갭 분석 (113건 기획 완료) |
| 7 | incomplete-pages.plan.md | ✅ | 미완성 페이지 7건 전체 구현 완료 |
| 8 | emr-certification-checklist.plan.md | ✅ | EMR 인증 체크리스트 |

### 진료/EMR

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 9 | emr-enhancement.plan.md | ✅ | EMR 전면 고도화 |
| 10 | emr-phase-cd.plan.md | ✅ | Phase C/D, 93% 달성 |
| 11 | clinical-workflow-enhancement.plan.md | ✅ | 임상 워크플로우 (응급전환+검사추적) |
| 12 | clinical-chart-enhancement.plan.md | ✅ | 임상 차트 고도화 (ROS/PE/구조화 입력 완비) |
| 13 | chart-editor.plan.md | ✅ | 진료차트 에디터 (EditorView 851줄) |
| 14 | chart-template-v2.plan.md | ✅ | 차트 템플릿 v2 |
| 15 | encounter-template.plan.md | ✅ | 진료 템플릿 |
| 16 | text-macro.plan.md | ✅ | 텍스트 매크로 |

### 처방/CPOE

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 17 | cpoe-enhancement.plan.md | ✅ | CPOE 고도화 (DUR무시사유+CDSS규칙관리) |
| 18 | cpoe-cdss.plan.md | ✅ | CDSS 연동 |
| 19 | cp-preorder.plan.md | ✅ | 사전처방 |
| 20 | order-prescription-enhancement.plan.md | ✅ | 처방 고도화 |
| 21 | order-set-enhancement.plan.md | ✅ | 오더세트 |
| 22 | my-prescription-codes.plan.md | ✅ | 나의 처방코드 (settings/my-codes) |
| 23 | therapy-order-system.plan.md | ✅ | 치료 오더 시스템 (BE+FE+캘린더+환자이력) |

### 환자 관리

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 24 | patient-chart-enhancement.plan.md | ✅ | 환자차트 고도화 |
| 25 | patient-chart-ux-redesign.plan.md | ✅ | 차트 UX 리디자인 |
| 26 | patient-management-enhancement.plan.md | ✅ | 환자관리 고도화 |
| 27 | patient-journey-tracking.plan.md | ✅ | 환자 여정 추적 |
| 28 | patient-safety-enhancement.plan.md | ✅ | 환자안전(IPSG) |
| 29 | patient-waiting-display.plan.md | ✅ | 대기 안내 디스플레이 |
| 30 | smart-patient-selector.plan.md | ✅ | 스마트 환자 선택 (BE API + 12페이지 적용) |
| 31 | deceased-process.plan.md | ✅ | 사망 처리 프로세스 (3Step+사인체인+자동후속) |

### 입원/간호

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 32 | inpatient-enhancement.plan.md | ✅ | 입원 관리 고도화 |
| 33 | attending-doctor-workflow.plan.md | ✅ | 주치의 워크플로우 (WS 4탭) |
| 34 | nurse-station-enhancement.plan.md | ✅ | 간호 스테이션 |
| 35 | universal-nursing-note.plan.md | ✅ | 간호기록 통합 |
| 36 | outpatient-nurse-workflow.plan.md | ✅ | 외래 간호 워크플로우 (WS 283줄) |
| 37 | outpatient-workflow.plan.md | ✅ | 외래 진료 워크플로우 (진료표+대기열+접수) |

### 전문과/특수진료

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 38 | specialty-clinics.plan.md | ✅ | 전문과 클리닉 16 레이아웃 구현 |
| 39 | specialty-enhancement.plan.md | ✅ | 전문과 갭 보강 (3과 서브탭+차트 추가) |
| 40 | specialty-encounter-all.plan.md | ✅ | 전문과 진료 전체 (16 EncounterLayout) |
| 41 | specialty-chart-improvement.plan.md | ✅ | 전문과 차트 품질 (정형3탭+산부3탭+소아발달) |
| 42 | specialty-chart-integration.plan.md | ✅ | 전문과 차트 통합 (16과 탭+ChartRenderer) |

### 워크스테이션

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 43 | clinical-workstation.plan.md | ✅ | 임상 워크스테이션 (24종 WS) |
| 44 | workstation-patient-search.plan.md | ✅ | WS 환자검색 |
| 45 | workstation-emergency-protocol.plan.md | ✅ | WS 응급 프로토콜 (코드블루/레드/화이트) |
| 46 | therapy-workstation-v2.plan.md | ✅ | 치료실 WS v2 (캘린더+항암+투석+7스테이션) |

### 진단/검사

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 47 | advanced-lab-system.plan.md | ✅ | 고급 검사실 시스템 (WS 423줄) |
| 48 | icu-diagnostics.plan.md | ✅ | ICU + 기초검사 |
| 49 | pathology-enhancement.plan.md | ✅ | 병리 고도화 |
| 50 | blood-bank.plan.md | ✅ | 혈액은행 |
| 51 | radiation-oncology.plan.md | ✅ | 방사선 종양학 |
| 52 | dialysis.plan.md | ✅ | 투석 |
| 53 | rehabilitation.plan.md | ✅ | 재활 |
| 54 | operating-room.plan.md | ✅ | 수술실 (WS 399줄) |
| 55 | advanced-nutrition.plan.md | ✅ | 영양관리 고도화 (WS 494줄) |

### 건강검진

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 56 | health-checkup.plan.md | ✅ | 건강검진 전체 v2.0 |

### 약국

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 57 | pharmacy-enhancement.plan.md | ✅ | 약국 고도화 |

### 수납/청구/보험

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 58 | billing-checkout.plan.md | ✅ | 수납 시스템 (분할납부+미수금+캐싱) |
| 59 | billing-detail-enhancement.plan.md | ✅ | 수납 상세 고도화 (영수증4종+미수금탭) |
| 60 | claims-billing-enhancement.plan.md | ✅ | 청구 고도화 (HIRA+분할납부+미수금) |
| 61 | hira-nhi-coverage-analysis.plan.md | ✅ | 건강보험 급여 분석 (HIRA 3API+FE대시보드) |

### 동의서/문진

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 62 | consent-protocol.plan.md | ✅ | 동의서 프로토콜 |
| 63 | consent-template-v2.plan.md | ✅ | 동의서 템플릿 v2 |
| 64 | questionnaire-system.plan.md | ✅ | 문진표 시스템 |

### 의료기록

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 65 | medical-record-copy.plan.md | ✅ | 의무기록 사본 |
| 66 | medical-record-search.plan.md | ✅ | 의무기록 검색 |

### AI/CDSS

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 67 | ai-clinical-assistant.plan.md | ✅ | AI 진료 보조 (진단적용+약물처방+검사추가) |
| 68 | ai-integration-expansion.plan.md | ✅ | AI 연동 확장 (36API+11탭+스트리밍) |
| 69 | ai-patient-concierge.plan.md | ✅ | AI 환자 컨시어지 (401줄 FE 완비) |
| 70 | ai-agent-reception.plan.md | ✅ | AI 에이전트 접수 (AiReceptionChat 121줄) |
| 71 | ai-booking-enhancement.plan.md | ✅ | AI 예약 고도화 (ai-booking 페이지 신규) |
| 72 | ai-booking-portal-integration.plan.md | ✅ | AI 예약-포털 연동 (concierge+agent-session) |
| 73 | medical-ai-integration.plan.md | ✅ | 의료 AI 연동 (v2.48.0 완전 연동) |
| 74 | reception-ai-assistant.plan.md | ✅ | 접수 AI 도우미 |

### 원격진료

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 75 | telehealth-enhancement.plan.md | ✅ | 원격진료 고도화 |
| 76 | telehealth-portal.plan.md | ✅ | 원격진료 포털 |
| 77 | telehealth-role-based-chart.plan.md | ✅ | 역할별 원격차트 (Doctor/Nurse/Pharmacist 3역할) |

### 환자포털/앱

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 78 | patient-portal-v2.plan.md | ✅ | 환자포털 v2 |
| 79 | patient-portal-ux-redesign.plan.md | ✅ | 포털 UX 리디자인 |
| 80 | patient-app.plan.md | ✅ | 환자앱 웹 |
| 81 | mobile-journey-app.plan.md | ✅ | 모바일 앱 (30화면+설정+FCM 완료) |
| 82 | mobile-fcm-push.plan.md | ✅ | 모바일 FCM 푸시 (딥링크+설정화면) |

### 대시보드

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 83 | dashboard-enhancement.plan.md | ✅ | 역할별 대시보드 v2 |
| 84 | dashboard-ux-compact.plan.md | ✅ | 대시보드 컴팩트 UX |
| 85 | dashboard-widget-system.plan.md | ✅ | 위젯 시스템 (@dnd-kit) |
| 86 | executive-dashboard.plan.md | ✅ | 경영진 대시보드 |
| 87 | analytics-dashboard.plan.md | ✅ | 통계 대시보드 (/admin/analytics 514줄) |
| 88 | widget-palette.plan.md | ✅ | 위젯 팔레트 52종 (registry+ext위젯) |
| 89 | widget-pipeline-reinforcement.plan.md | ✅ | 위젯 권한 파이프라인 (Catalog+Wrapper+Forbidden) |
| 90 | component-palette.plan.md | ✅ | 컴포넌트 팔레트 (위젯52종+shadcn/ui) |

### 홈페이지/CMS

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 91 | cms-homepage-management.plan.md | ✅ | CMS 홈페이지 관리 (admin/homepage 14페이지) |
| 92 | hospital-info-management.plan.md | ✅ | 병원정보 CMS |
| 93 | homepage-phase2-improvement.plan.md | ✅ | 홈페이지 Phase 2 (39페이지+SSR+sitemap+JSON-LD) |
| 94 | werubyhosp-homepage-migration.plan.md | ✅ | WERUBYHOSP 홈페이지 이전 (CMS14페이지+콘텐츠관리) |
| 95 | popup-enhancement.plan.md | ✅ | 팝업 고도화 (BE+FE 완료) |

### 재고/ERP

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 96 | inventory-erp.plan.md | ✅ | 자재/재고 관리 |
| 97 | inventory-repack-qr.plan.md | ✅ | 재포장/QR 관리 (BE 모듈 완료) |

### PACS/영상

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 98 | pacs-proxy.plan.md | ✅ | PACS 프록시 |
| 99 | order-pacs-integration.plan.md | ✅ | 오더-PACS 연동 (pacs-portal 228줄) |

### 블록체인/인증서

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 100 | blockchain-medical-certificate.plan.md | ✅ | 블록체인 의료증명서 (FE 1596줄+BE 6파일) |
| 101 | blockchain-cert-system-integration.plan.md | ✅ | 블록체인 시스템 연동 (admin/blockchain-cert) |

### 표준/매핑

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 102 | terminology-mapping.plan.md | ✅ | 의료용어 표준매핑 |
| 103 | terminology-auto-mapping.plan.md | ✅ | AI 자동매핑 v2.0 |
| 104 | fhir-r4-expansion.plan.md | ✅ | FHIR R4 확장 (13리소스 31 endpoints 완료) |

### 보안/성능

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 105 | performance-security-enhancement.plan.md | ✅ | 성능/보안 Phase S1 완료 (CSP+RateLimit4단계+Cookie+Compression) |
| 106 | role-department-access-control.plan.md | ✅ | 역할/부서 접근 제어 |
| 107 | fe-error-handling.plan.md | ✅ | FE 에러 처리 (159페이지 적용) |

### 연동/외부

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 108 | clinic-integration.plan.md | ✅ | Clinic 연동 |
| 109 | journey-integration-guide.plan.md | ✅ | 여정 연동 가이드 |

### 기타

| # | 기획서 | 상태 | 비고 |
|---|--------|------|------|
| 110 | hospital-simulator.plan.md | ✅ | 병원 시뮬레이터 |
| 111 | metaverse-hospital-space.plan.md | ✅ | 메타버스 병원 공간 (BE 5API + FE 평면도뷰어) |
| 112 | metaverse-patient-journey.plan.md | ✅ | 메타버스 환자 여정 (PatientLocation + 동선이력 + 히트맵) |

---

## 02-design — 설계서 (8건)

| 설계서 | 대응 Plan |
|--------|-----------|
| emr-enhancement.design.md | emr-enhancement.plan.md |
| emr-phase-cd.design.md | emr-phase-cd.plan.md |
| hospital-run.design.md | hospital-run.plan.md |
| hospital-run-phase2.design.md | hospital-run-phase2.plan.md |
| hospital-run-phase3.design.md | hospital-run-phase3.plan.md |
| mobile-journey-app.design.md | mobile-journey-app.plan.md |
| patient-app.design.md | patient-app.plan.md |
| questionnaire-system.design.md | questionnaire-system.plan.md |
| scribe-stt-adapter-design.md | ambient-clinical-scribe.plan.md |

## 03-analysis — 분석 보고서 (7건)

| 분석 보고서 | 내용 |
|-------------|------|
| emr-enhancement.analysis.md | EMR 갭 분석 |
| emr-phase-cd.analysis.md | Phase C/D 갭 분석 |
| clinic-his-gap.analysis.md | Clinic↔HIS 갭 분석 |
| dashboard-widget-feasibility.analysis.md | 위젯 시스템 가능성 |
| component-palette-risks.analysis.md | 컴포넌트 팔레트 위험 |
| widget-permission-pipeline.analysis.md | 위젯 권한 파이프라인 |
| widget-pipeline-impact.analysis.md | 위젯 파이프라인 영향도 |

## 04-report — 완료 보고서 (16건)

| 보고서 | 내용 |
|--------|------|
| changelog.md | 변경 이력 |
| emr-enhancement.report.md | EMR 고도화 완료 |
| emr-phase-cd.report.md | Phase C/D 완료 |
| emr-phase-cd-completion-2026-05-14.md | Phase C/D 최종 |
| hospital-run.report.md | 초기 구현 완료 |
| hospital-run-phase2.report.md | Phase 2 완료 |
| session-20260528.report.md | 세션 보고서 |
| checkup-center-review.report.md | 검진센터 검토 |
| dashboard-widget-expansion.report.md | 위젯 확장 보고 |
| page-edit-classification.report.md | 페이지 편집 분류 |
| r0-round.report.md | R0 정적 검증 |
| his-floor-api-response.md | HIS 층 API 응답 |
| his-workgroup-api-response.md | HIS 워크그룹 응답 |
| features/emr-phase-cd.report.md | EMR Phase C/D |
| features/mobile-journey-app.report.md | 모바일 앱 |
| features/session-20260518.report.md | 세션 보고서 |

## 05-reference — 참고/연동 문서 (12건)

| 문서 | 내용 |
|------|------|
| API-REFERENCE.md | API 레퍼런스 |
| CLINIC-HIS-API-REFERENCE.md | Clinic↔HIS API |
| CLINIC-HIS-INTEGRATION-v1.1.0.md | Clinic 연동 원본 |
| clinic-integration-api-spec.md | Clinic API 명세 |
| CLINICAL-TEST-SCENARIOS-v1.0.md | 임상 테스트 시나리오 |
| MEDICAL_AI_INTEGRATION_v2.121.0.md | AI(WeRU.B) 연동 가이드 — v2.121.0 |
| werub-scribe-integration-request-20260707.md | 스크라이브 STT·화자분리 연동 요청서(AI팀) |
| scribe-recording-consent-draft-20260707.md | 진료 녹음·음성등록 동의서 문안 초안(법무) |
| PACS-SEPARATION.md | PACS 분리 공지 |
| PACS-SSO-INTEGRATION-SPEC.md | PACS SSO 스펙 |
| WAITING-DISPLAY-API-SPEC.md | 대기 안내 API |
| TEST-ACCOUNTS.md | 테스트 계정 |
| billing-receipt-format-reference.md | 영수증 서식 참고 |
| blockchain-cert-image-assets.md | 블록체인 이미지 자산 |

## _archive — 보관 (16건)

구버전이거나 다른 기획서에 흡수된 문서들. 참고용으로만 보관.
