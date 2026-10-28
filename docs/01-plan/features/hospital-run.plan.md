# Hospital RUN Planning Document

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/src/modules/cssd/ (40 핸들러) · apps/api/src/modules/hie/hie.controller.ts (5 핸들러 — 검토의 HIE 66 은 틀림) · 🔴 modules/workflow 없음(검토의 workflow 22 는 틀림) · 잔여: EMR 인증제 59지표(사람); 진료정보교류 실연동(사람)

> **Summary**: HospitalRun 오픈소스를 기반으로 최신 스택(Next.js, Kubernetes)으로 한국형 Enterprise급 병원 정보 시스템(HIS) 리빌드
>
> **Project**: Hospital RUN
> **Version**: 0.8.0
> **Author**: user
> **Date**: 2026-05-06
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

개발도상국 병원을 위해 만들어진 HospitalRun 오픈소스 프로젝트가 종료(Archived)됨에 따라, 이를 참고하여 최신 기술 스택으로 **한국형** Enterprise급 병원 정보 시스템(HIS)을 새롭게 구축한다. 한국 의료 환경에 맞는 건강보험 청구, 처방전달시스템(OCS), 전자의무기록(EMR) 인증제 준수, 진료정보교류(FHIR) 등을 핵심 요구사항으로 포함한다.

### 1.2 Background

- **HospitalRun** (https://github.com/HospitalRun/hospitalrun): React + Node.js + CouchDB 기반 오프라인 우선 HIS
  - 프로젝트 종료(Archived) → 최신 스택으로 리빌드 필요
  - 채택: 오프라인 우선 철학, PWA 접근, 저자원 환경 지원
- **EtherCIS / EHRBase** (https://github.com/ethercis/ethercis): Java + PostgreSQL 기반 openEHR CDR
  - openEHR 표준 기반 임상 데이터 저장소, AQL(Archetype Query Language) 지원
  - EtherCIS → EHRBase로 후속 이관, bi-temporal tables로 이력 관리
  - 채택: openEHR 템플릿 기반 임상 데이터 구조화, 유연한 EMR 스키마 확장 패턴
- **Medplum** (https://github.com/medplum/medplum): Full-stack TypeScript + PostgreSQL 기반 FHIR R4 플랫폼
  - FHIR R4 표준 API, OAuth/SMART-on-FHIR 인증, Bots(서버사이드 워크플로우)
  - Monorepo 구조 (20+ 패키지), AWS CDK 인프라, Apache 2.0 라이선스
  - 채택: FHIR R4 표준 API 설계, Bots 워크플로우 패턴, TypeScript Monorepo 아키텍처
- **OpenMRS O3** (https://github.com/openmrs/openmrs-esm-core): React Microfrontend 기반 오픈소스 EMR
  - single-spa + Webpack Module Federation 기반 마이크로프론트엔드 아키텍처
  - Extension/Slot 시스템 — 플러그인 방식으로 UI 컴포넌트를 동적 삽입
  - JSON Form Engine — JSON 스키마 기반 동적 의료 폼 (유효성 검사, 조건부 렌더링, 다국어)
  - Configuration System — 코드 변경 없이 런타임 설정으로 UI/기능 조정
  - Patient Chart — 모듈별 독립 임상 뷰 (바이탈, 알레르기, 처방 등)
  - 채택: JSON Form Engine(임상 템플릿 FR-13), Extension/Slot 플러그인 패턴, 런타임 Configuration

### 1.3 Reference Projects Comparison

| 항목 | HospitalRun | EtherCIS/EHRBase | Medplum | OpenMRS O3 |
|------|-------------|------------------|---------|------------|
| 의료 표준 | 없음 | openEHR | FHIR R4 | HL7/FHIR |
| 언어 | JS/TS | Java | TypeScript | React/TS |
| DB | CouchDB | PostgreSQL | PostgreSQL | MySQL/PG |
| 오프라인 | PouchDB 동기화 | 미지원 | 미지원 | 부분 지원 |
| 인증 | 기본 | 기본 | OAuth/SMART-on-FHIR | Spring Security |
| 워크플로우 | 없음 | 없음 | Bots (서버사이드) | 없음 |
| UI 아키텍처 | 모놀리식 React | - | React SPA | **Microfrontend** |
| 폼 엔진 | 없음 | Template(ADL) | 없음 | **JSON Form Engine** |
| 플러그인 | 없음 | 없음 | 없음 | **Extension/Slot** |
| 상태 | Archived | → EHRBase 이관 | Active | **Active** |

### 1.4 Related Documents

- Reference: [HospitalRun GitHub](https://github.com/HospitalRun/hospitalrun)
- Reference: [HospitalRun Official Site](https://hospitalrun.io/)
- Reference: [EtherCIS GitHub](https://github.com/ethercis/ethercis)
- Reference: [EHRBase GitHub](https://github.com/ehrbase/ehrbase)
- Reference: [Medplum GitHub](https://github.com/medplum/medplum)
- Reference: [Medplum Docs](https://www.medplum.com/docs)
- Reference: [보건복지부 EMR 인증제](https://emrcert.mohw.go.kr/)
- Reference: [한국보건의료정보원](https://k-his.or.kr/)
- Reference: [건강보험심사평가원 HIRA](https://www.hira.or.kr/)
- Reference: [OpenMRS O3 Docs](https://o3-docs.openmrs.org/)
- Reference: [OpenMRS O3 Core GitHub](https://github.com/openmrs/openmrs-esm-core)
- Reference: [OpenMRS Form Engine](https://github.com/openmrs/openmrs-esm-form-engine-lib)

---

## 2. Scope

### 2.1 In Scope

- [ ] 환자 관리 (Patient Management) — 등록, 조회, 이력 관리
- [ ] 진료 기록 (Clinical Records / EMR) — 진료 노트, 진단, 처방
- [ ] 예약 관리 (Scheduling) — 외래 예약, 캘린더
- [ ] 약국 관리 (Pharmacy) — 처방전 관리, 재고
- [ ] 검사실 관리 (Laboratory) — 검사 요청, 결과 기록
- [ ] 영상 관리 (Imaging) — 영상 요청, 결과 조회
- [ ] 사용자/권한 관리 (RBAC) — 의사, 간호사, 관리자 등 역할별 접근 제어
- [ ] 오프라인 동기화 (Offline-first) — PWA + 로컬 DB 동기화
- [ ] 대시보드/리포트 — 통계, 차트, 보고서 생성
- [ ] FHIR R4 API (from Medplum) — 표준 의료 데이터 교환 인터페이스
- [ ] Bots/워크플로우 엔진 (from Medplum) — 서버사이드 자동화 (알림, 데이터 변환)
- [ ] 임상 데이터 템플릿 (from EtherCIS) — openEHR 스타일 유연한 EMR 스키마
- [ ] **처방전달시스템 (OCS)** — 의사 처방 → 약국/검사실/영상실 자동 전달
- [ ] **건강보험 청구** — HIRA 심사평가원 청구 포털 연동, 진료비 명세서 생성
- [ ] **DUR 점검** — 의약품 안전사용 서비스(Drug Utilization Review) 연동
- [ ] **진료비 수납** — 본인부담금 계산, 수납/미수 관리, 영수증 발행
- [ ] **진료정보교류** — 건강정보 고속도로 연동, FHIR R4 기반 타 의료기관 정보 공유
- [ ] **EMR 인증제 준수** — 보건복지부 2주기 EMR 인증 59개 지표 충족
- [ ] **한국 의료 용어 표준** — KCD(한국표준질병분류), EDI 코드, 약품 코드 연동
- [ ] **원무 고도화** — 접수 체계화, 보험자격 조회, 증명서 발급
- [ ] **입원/퇴원 관리** — 입원 오더, 병상 배정, 입원 경과, 퇴원 요약
- [ ] **수술 관리** — 수술 스케줄링, 수술/마취 기록, 동의서
- [ ] **응급실** — KTAS 트리아지, 응급 진료/처방, 전원/입원 결정
- [ ] **병상 관리** — 병동/병실/침상, 실시간 현황판
- [ ] **자재/재고 관리** — 의료소모품 입출고, 발주, 안전재고 알림
- [ ] **중앙공급실(CSSD)** — 멸균 소독, 수술기구 세트 추적
- [ ] **영양/급식** — 입원 환자 식이, 식단 배분
- [ ] **의료장비 관리** — 장비 대장, 점검 스케줄

### 2.2 Out of Scope

- PACS 연동 (외부 시스템 연동은 Phase 3 이후)
- 모바일 네이티브 앱 (PWA로 우선 대응, 추후 React Native 고려)
- AI 진단 보조 (추후 확장)
- 완전한 openEHR 서버 구현 (패턴만 차용, 전체 스펙 구현은 아님)
- 해외 보험 청구 (한국 건강보험 우선, 해외는 플러그인으로 확장)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 환자 CRUD (등록/조회/수정/삭제) + 검색 | High | Pending |
| FR-02 | 진료 기록 작성 및 이력 조회 (SOAP 노트) | High | Pending |
| FR-03 | 역할 기반 접근 제어 (Admin, Doctor, Nurse, Pharmacist, Lab Tech) | High | Pending |
| FR-04 | 외래 예약 생성/수정/취소 + 캘린더 뷰 | High | Pending |
| FR-05 | 처방전 생성 및 약국 디스펜싱 워크플로우 | Medium | Pending |
| FR-06 | 검사 요청/결과 입력 워크플로우 | Medium | Pending |
| FR-07 | 영상 요청/결과 조회 | Medium | Pending |
| FR-08 | 오프라인 모드 + 온라인 복귀 시 자동 동기화 | High | Pending |
| FR-09 | 대시보드 (환자 통계, 진료 현황, 약국 재고) | Medium | Pending |
| FR-10 | 감사 로그 (Audit Trail) — 의료 기록 변경 추적 | High | Pending |
| FR-11 | FHIR R4 API — Patient, Encounter, Observation 등 핵심 리소스 CRUD | High | Pending |
| FR-12 | Bots 워크플로우 — 리소스 변경 시 트리거되는 서버사이드 자동화 | Medium | Pending |
| FR-13 | **JSON Form Engine** — O3 스타일 JSON 스키마 기반 동적 의료 폼 (유효성 검사, 조건부 렌더링, 다국어) + openEHR 데이터 구조 | Medium | Pending |
| FR-14 | **처방전달시스템(OCS)** — 의사 처방 입력 → 약국/검사실/영상실 자동 전달 워크플로우 | High | Pending |
| FR-15 | **건강보험 청구** — HIRA 청구 포털 연동, 수가 계산, 진료비 명세서, 청구/심사/지급 관리 | High | Pending |
| FR-16 | **DUR 점검** — 처방 시 약물 상호작용/중복/금기 실시간 점검 (HIRA DUR API 연동) | High | Pending |
| FR-17 | **진료비 수납** — 본인부담금 자동 계산, 수납/미수 관리, 영수증/세금계산서 발행 | High | Pending |
| FR-18 | **진료정보교류** — 건강정보 고속도로 연동, FHIR R4 기반 타 의료기관 진료 기록 조회/전송 | Medium | Pending |
| FR-19 | **EMR 인증제 준수** — 보건복지부 2주기 59개 인증지표 충족, 상호운용성 기준 | High | Pending |
| FR-20 | **한국 의료 용어/코드** — KCD(질병분류), EDI 수가코드, 약품코드(KPIS) 마스터 데이터 관리 | High | Pending |
| FR-21 | **Extension/Slot 플러그인 시스템** (from O3) — UI 컴포넌트를 슬롯에 동적 삽입, 제3자 모듈 확장 지원 | Medium | Pending |
| FR-22 | **Runtime Configuration** (from O3) — 코드 변경 없이 JSON 설정으로 UI/기능 조정 (병원별 커스터마이징) | Medium | Pending |
| FR-23 | **원무 고도화** — 접수 워크플로우 체계화, 보험자격 실시간 조회, 증명서(진단서/소견서) 발급 | High | Pending |
| FR-24 | **입원 관리** — 입원 오더, 병상(Bed) 배정/이동, 입원 경과기록, 퇴원 요약, 식이 관리 | High | Pending |
| FR-25 | **수술 관리** — 수술 스케줄링, 수술 기록(Op Note), 마취 기록, 수술 동의서 | Medium | Pending |
| FR-26 | **응급실** — KTAS 트리아지(1~5등급), 응급 진료/처방, 전원/입원/귀가 결정 워크플로우 | High | Pending |
| FR-27 | **병상 관리** — 병동/병실/침상 계층 구조, 실시간 현황판, 입퇴원 예정 보드 | High | Pending |
| FR-28 | **자재/재고 관리** — 의료소모품 입출고, 약품 재고(약국 연동), 발주/입고, 안전재고 알림, 거래처 관리 | High | Pending |
| FR-29 | **중앙공급실(CSSD)** — 멸균 소독 프로세스, 수술기구 세트 추적, 소독 이력/유효기간 관리 | Medium | Pending |
| FR-30 | **영양/급식 관리** — 입원 환자 식이 유형, 식단 배분, 알레르기/금기 식이 연동 | Medium | Pending |
| FR-31 | **의료장비 관리** — 장비 대장, 정기 점검/교정 스케줄, 고장 신고/수리 이력 | Low | Pending |
| FR-32 | **인사관리(HR)** — 직원 등록(의료진/행정/기사/지원), 부서/직위, 면허번호, 근무 스케줄(3교대), 퇴직 관리 | High | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Performance | API 응답 시간 < 200ms (P95) | k6 부하 테스트 |
| Performance | 동시 사용자 500명 지원 | k6 스트레스 테스트 |
| Security | OWASP Top 10 준수 | 보안 스캔 (SAST/DAST) |
| Security | 의료 데이터 암호화 (AES-256 at rest, TLS in transit) | 보안 감사 |
| Availability | 99.9% 가용성 (연간 8.7시간 다운타임) | 모니터링 (Prometheus/Grafana) |
| Accessibility | WCAG 2.1 AA | Lighthouse, axe-core |
| Compliance | 개인정보보호법 + 의료법 준수 | 법률 체크리스트 감사 |
| Compliance | **보건복지부 EMR 인증제 2주기** 59개 지표 충족 | EMR 인증 심사 |
| Interoperability | FHIR R4 Conformance — 핵심 리소스 CRUD 통과 | FHIR Validator |
| Interoperability | **HIRA 청구 포털** 연동 정상 동작 | 청구 데이터 검증 |
| Interoperability | **건강정보 고속도로** 진료정보교류 연동 | 표준 전송 테스트 |
| Offline | 오프라인 상태에서 핵심 기능(환자 조회, 진료 기록) 사용 가능 | PWA 오프라인 테스트 |

---

## 4. Success Criteria

### 4.1 Definition of Done

**Phase별 완료 기준:**

| Phase | FR 범위 | DoD |
|-------|---------|-----|
| MVP (Phase 1) | FR-01, FR-03, FR-04, FR-10(기본), FR-11(Patient), FR-20 | 환자 CRUD + RBAC + 예약 + FHIR Patient + 코드 마스터 + 감사 기본 |
| Phase 2 | FR-02, FR-14, FR-16, FR-17(정액제 기본), FR-13 | OCS + 진료 + 기본 수납 (한국형 핵심) |
| Phase 3 | FR-05, FR-06, FR-07, FR-15, FR-09 | 부서별 기능 + 건강보험 청구 + 대시보드 |
| Phase 4 | FR-12, FR-18, FR-11(전체), FR-19 | 자동화 + 상호운용성 + EMR 인증 |
| Phase 5 | FR-08, FR-10(고도화) | 오프라인 동기화 + 감사로그 고도화 |

**전체 프로젝트 완료 기준:**

- [ ] 모든 기능 요구사항(FR-01~FR-31) 구현 완료
- [ ] 단위 테스트 및 통합 테스트 작성 완료
- [ ] E2E 테스트 주요 워크플로우 커버
- [ ] 코드 리뷰 완료
- [ ] API 문서(OpenAPI/Swagger + FHIR CapabilityStatement) 작성 완료
- [ ] 배포 파이프라인 구축 완료

### 4.2 Quality Criteria

- [ ] 테스트 커버리지 80% 이상
- [ ] ESLint/Prettier 에러 0건
- [ ] Lighthouse Performance 90+ / Accessibility 90+
- [ ] Docker 빌드 성공
- [ ] 보안 스캔 Critical/High 이슈 0건

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| 오프라인 동기화 충돌 | High | High | CRDT 또는 Last-Write-Wins + 충돌 해결 UI 제공. RxDB/WatermelonDB 등 기존 라이브러리 우선 검토 |
| 의료 데이터 보안 사고 | High | Medium | 암호화, RBAC, 감사 로그, 정기 보안 스캔 |
| 마이크로서비스 복잡성 증가 | Medium | High | Phase 1~2는 모듈러 모놀리스, Phase 3 이후 점진적 서비스 분리 |
| 오프라인/PWA 브라우저 호환성 | Medium | Medium | 주요 브라우저(Chrome, Edge, Safari) 타겟팅 |
| 프로젝트 규모 과대 | High | Medium | MVP 우선 접근 — Phase별 DoD 기준으로 점진 구현 |
| **의료 규제 준수 (HIPAA/개인정보보호법)** | High | High | 타겟 국가별 규제 체크리스트 작성, 법률 자문 확보, PHI 데이터 분류 및 처리 기준 정의 |
| **openEHR + FHIR 이중 표준 복잡성** | High | High | FHIR R4를 외부 인터페이스 표준으로, openEHR 스타일을 내부 임상 데이터 저장 패턴으로 역할 분리. 두 표준 간 매핑 레이어 설계 |
| **팀 리소스 부족** | High | High | Phase별 기능 축소 가능하도록 설계. 핵심 도메인에 집중하고 비핵심은 오픈소스/외부 서비스 활용 |
| **의료 도메인 지식 부족** | High | Medium | 의료 전문가(SME) 자문 확보, 참고 오픈소스 워크플로우 분석, FHIR 리소스 표준 문서 활용 |
| **HIRA 연동 규격 변경** | Medium | Medium | HIRA API 버전 관리, 어댑터 패턴으로 연동 레이어 분리, 청구 규격 변경 모니터링 |
| **수가/코드 체계 복잡성** | High | High | KCD, EDI, 약품코드 마스터 데이터를 별도 관리 모듈로 분리, 정기 업데이트 자동화 파이프라인 구축 |
| **EMR 인증 기준 충족** | High | Medium | 2주기 59개 지표를 Phase별 매핑 체크리스트(`docs/01-plan/emr-cert-checklist.md`)로 관리, 각 Phase에서 자연 충족 + Phase 4에서 미충족 지표 집중 대응 |
| **수납 로직 복잡성** | High | High | 한국 수가 체계(행위별 수가, 포괄수가 DRG, 본인부담률 차등)가 매우 복잡. Phase 2에서는 **정액제 기본 수납**만 구현, 수가 기반 정밀 계산은 Phase 3(건강보험 청구)와 연계하여 구현 |
| **한국식 환자 식별자 처리** | High | High | 주민등록번호는 수집하지 않고 생년월일+성별로 대체, 건강보험증번호는 암호화 저장(AES-256). 개인정보보호법 민감정보 처리 기준 준수 |

---

## 6. Architecture Considerations

### 6.1 Project Level Selection

| Level | Characteristics | Recommended For | Selected |
|-------|-----------------|-----------------|:--------:|
| **Starter** | Simple structure | Static sites, portfolios | ☐ |
| **Dynamic** | Feature-based modules, BaaS | Web apps, SaaS MVPs | ☐ |
| **Enterprise** | Strict layer separation, DI, microservices | High-traffic, complex systems | ☑ |

### 6.2 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| Frontend Framework | Next.js / React / Vue | **Next.js 15 (App Router)** | SSR/SSG, 오프라인 PWA, 풍부한 생태계 |
| State Management | Context / Zustand / Redux | **Zustand + TanStack Query** | 경량 + 서버 상태 관리 분리 |
| API Client | fetch / axios / react-query | **TanStack Query + fetch** | 캐싱, 오프라인 지원, 자동 재시도 |
| Form Handling | react-hook-form / formik | **React Hook Form + Zod** | 성능 + 타입 안전 유효성 검사 |
| Styling | Tailwind / CSS Modules | **Tailwind CSS + shadcn/ui** | 빠른 개발, 일관된 디자인 시스템 |
| Testing | Jest / Vitest / Playwright | **Vitest + Playwright** | 빠른 유닛 테스트 + 크로스 브라우저 E2E |
| Backend | Custom Server / BaaS | **NestJS (Node.js)** | 엔터프라이즈 구조, DI, 모듈 시스템 |
| Database | PostgreSQL / CouchDB | **PostgreSQL + Prisma ORM** | ACID, 관계형, 감사 로그에 적합 |
| Offline Sync | PouchDB / RxDB / Custom | **RxDB (IndexedDB 기반) + Service Worker** | 검증된 오프라인 동기화 + PostgreSQL 플러그인 지원, 필요 시 Custom 확장 |
| Auth | NextAuth / Custom JWT | **Custom JWT + RBAC Guard** | 5역할 퍼미션 매트릭스 + SMART-on-FHIR 확장성 (ADR-001 참조) |
| Container | Docker / Podman | **Docker + Docker Compose** | K8s 배포 준비 |
| Orchestration | K8s / ECS | **Kubernetes (EKS)** | Enterprise 스케일링, 자동 복구 |
| IaC | Terraform / Pulumi | **Terraform** | 업계 표준, 풍부한 AWS 프로바이더 |
| CI/CD | GitHub Actions / GitLab CI | **GitHub Actions** | GitHub 기반 워크플로우 |
| API Gateway | Kong / Nginx / Traefik | **Nginx (초기) → Kong (Phase 3+)** | 초기 경량화, 점진적 확장 |
| Cache/Session | Redis / Memcached | **Redis** | 세션 스토어, 캐시, Pub/Sub (Bots 이벤트) |
| Monitoring | Datadog / Prometheus | **Prometheus + Grafana** | 오픈소스, K8s 네이티브 |
| Offline Sync PoC | RxDB / WatermelonDB | **RxDB** | Design 초반 PoC로 확정, PostgreSQL replication plugin 활용 |

### 6.3 Clean Architecture Approach

```
Selected Level: Enterprise

Folder Structure Preview:
┌─────────────────────────────────────────────────────────┐
│  apps/                                                  │
│    web/                    ← Next.js Frontend (App Router)│
│      src/                                               │
│        presentation/       ← UI Components, Pages       │
│        application/        ← Use Cases, State           │
│        domain/             ← Entities, Value Objects     │
│        infrastructure/     ← API Clients, Storage        │
│    api/                    ← NestJS Backend              │
│      src/                                               │
│        presentation/       ← Controllers, DTOs           │
│        application/        ← Services, Use Cases         │
│        domain/             ← Entities, Repositories(IF)  │
│        infrastructure/     ← DB, External APIs           │
│  packages/                                              │
│    shared/                 ← 공유 타입, 유틸리티          │
│    ui/                     ← 공유 UI 컴포넌트 (shadcn)    │
│  infra/                                                 │
│    terraform/              ← AWS 인프라 정의              │
│    k8s/                    ← Kubernetes 매니페스트        │
│    docker/                 ← Dockerfiles                 │
└─────────────────────────────────────────────────────────┘

Monorepo Tool: Turborepo
```

### 6.4 System Architecture Diagram

**Phase 1~2: 모듈러 모놀리스 (초기)**

```
┌─────────────────────────────────────────────────────────────┐
│                      Client (Browser/PWA)                   │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌───────────┐ │
│  │ Next.js  │  │ Service  │  │ IndexedDB │  │  Zustand  │ │
│  │   App    │←→│ Worker   │←→│ (RxDB)    │  │  + Query  │ │
│  └────┬─────┘  └────┬─────┘  └───────────┘  └───────────┘ │
└───────┼──────────────┼──────────────────────────────────────┘
        │              │ (Background Sync)
        ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                       Nginx (Reverse Proxy)                  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              NestJS Modular Monolith                         │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐ │
│  │  Auth  │ │Patient │ │Schedule│ │  FHIR  │ │   Bots   │ │
│  │ Module │ │ Module │ │ Module │ │ Module │ │  Module  │ │
│  └────────┘ └────────┘ └────────┘ └────────┘ └──────────┘ │
└────────────────────────┬────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   ┌────────────┐ ┌────────────┐ ┌───────────┐
   │ PostgreSQL │ │   Redis    │ │    S3     │
   │ (Primary)  │ │(Session/   │ │ (Files/   │
   │            │ │ Cache/PubSub│ │  Images)  │
   └────────────┘ └────────────┘ └───────────┘
```

**Phase 3+: 마이크로서비스 (목표)**

```
┌─────────────────────────────────────────────────────────────┐
│                      Client (Browser/PWA)                   │
└───────────────────────┬─────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                 API Gateway (Kong)                           │
└────────────────────────┬────────────────────────────────────┘
                         │
    ┌────────────┬───────┼───────┬────────────┐
    ▼            ▼       ▼       ▼            ▼
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐
│  Auth  │ │Patient │ │Schedule│ │  FHIR  │ │   Bots   │
│  Svc   │ │  Svc   │ │  Svc   │ │Router  │ │ Engine   │
│(OAuth/ │ │(NestJS)│ │(NestJS)│ │(R4 API)│ │(Workflow)│
│ SMART) │ │        │ │        │ │        │ │          │
└───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └────┬─────┘
    │          │          │          │            │
    ▼          ▼          ▼          ▼            ▼
┌─────────────────────────────────────────────────────────────┐
│                   PostgreSQL (Primary)                       │
│  ┌──────────────────┐  ┌──────────────────────────────────┐│
│  │ Clinical Data    │  │ FHIR Resources (Patient,         ││
│  │ (openEHR-style   │  │  Encounter, Observation,         ││
│  │  templates,      │  │  MedicationRequest, etc.)        ││
│  │  bi-temporal)    │  │                                  ││
│  └──────────────────┘  └──────────────────────────────────┘│
│  + Redis (Cache/PubSub) + S3 (Files) + Read Replicas       │
└─────────────────────────────────────────────────────────────┘
```

### 6.5 의료 표준 공존 전략 (openEHR + FHIR)

```
┌─────────────────────────────────────────────────────────┐
│                    External Systems                      │
│          (타 병원, 보험사, 공공기관, 연구기관)              │
└────────────────────────┬────────────────────────────────┘
                         │ FHIR R4 API (외부 인터페이스)
                         ▼
┌─────────────────────────────────────────────────────────┐
│                  FHIR Mapping Layer                       │
│     Internal Domain ←→ FHIR Resources 변환               │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              Internal Domain Model                       │
│   openEHR 스타일 템플릿 기반 임상 데이터 구조               │
│   - 동적 폼 정의 (Archetype 패턴)                         │
│   - bi-temporal 이력 관리 (valid_from/valid_to + tx_time) │
│   - 내부 REST API (/api/v1/*)                            │
└─────────────────────────────────────────────────────────┘
```

| 표준 | 역할 | 적용 범위 |
|------|------|----------|
| **FHIR R4** | 외부 인터페이스 | 타 시스템 연동, 데이터 교환, 표준 리소스 CRUD |
| **openEHR 패턴** | 내부 데이터 모델 | 임상 데이터 저장, 템플릿 기반 동적 폼, 이력 추적 |

### 6.6 Reference Architecture Mapping

| 레이어 | HospitalRun 참고 | EtherCIS 참고 | Medplum 참고 |
|--------|-----------------|---------------|-------------|
| **Frontend** | 환자/진료 UI 워크플로우 | - | React 컴포넌트 라이브러리 |
| **API** | REST 엔드포인트 구조 | AQL 쿼리 패턴 | FHIR R4 라우터, Subscription |
| **Business Logic** | 약국/검사실 워크플로우 | 템플릿 기반 데이터 구조화 | Bots 자동화 엔진 |
| **Data** | 오프라인 동기화 | bi-temporal 이력 관리 | FHIR 리소스 모델 |
| **Auth** | 기본 RBAC | - | OAuth2/SMART-on-FHIR |
| **Infra** | - | - | AWS CDK, ECS 패턴 |

---

## 7. Convention Prerequisites

### 7.1 Existing Project Conventions

- [x] `CLAUDE.md` has coding conventions section
- [ ] `docs/01-plan/conventions.md` exists (Phase 2 output)
- [ ] ESLint configuration (`.eslintrc.*`)
- [ ] Prettier configuration (`.prettierrc`)
- [x] TypeScript configuration (`tsconfig.json`)

> ⚠️ 신규 프로젝트 — 모든 컨벤션 새로 정의 필요

### 7.2 Conventions to Define/Verify

| Category | Current State | To Define | Priority |
|----------|---------------|-----------|:--------:|
| **Naming** | Missing | PascalCase(컴포넌트), camelCase(함수/변수), kebab-case(파일) | High |
| **Folder structure** | Missing | Enterprise Clean Architecture (presentation/application/domain/infrastructure) | High |
| **Import order** | Missing | builtin → external → internal → relative | Medium |
| **Environment variables** | Missing | NEXT_PUBLIC_ prefix 규칙, .env.local 관리 | Medium |
| **Error handling** | Missing | Custom Error 클래스, Result 패턴 | Medium |
| **API Convention** | Missing | RESTful, /api/v1/ prefix, JSON:API 스타일 응답 | High |
| **Git Convention** | Missing | Conventional Commits, PR 템플릿 | Medium |

### 7.3 Environment Variables Needed

| Variable | Purpose | Scope | To Be Created |
|----------|---------|-------|:-------------:|
| `NEXT_PUBLIC_API_URL` | Backend API endpoint | Client | ☐ |
| `DATABASE_URL` | PostgreSQL 연결 문자열 | Server | ☐ |
| `AUTH_SECRET` | JWT 서명 키 (min 32 chars) | Server | ☐ |
| `REDIS_URL` | 세션/캐시 스토어 | Server | ☐ |
| `S3_BUCKET` | 의료 영상/파일 저장소 | Server | ☐ |
| `ENCRYPTION_KEY` | 의료 데이터 암호화 키 | Server | ☐ |

### 7.4 Pipeline Integration

| Phase | Status | Document Location | Command |
|-------|:------:|-------------------|---------|
| Phase 1 (Schema) | ☐ | `docs/01-plan/schema.md` | `/phase-1-schema` |
| Phase 2 (Convention) | ☐ | `docs/01-plan/conventions.md` | `/phase-2-convention` |

---

## 8. Target Users & Region

### 8.1 타겟 사용자

| 역할 | 주요 기능 | 우선순위 |
|------|----------|---------|
| 의사 (Doctor) | 진료 기록, 처방, 검사 요청 | High |
| 간호사 (Nurse) | 환자 등록, 바이탈 기록, 스케줄 관리 | High |
| 약사 (Pharmacist) | 처방전 확인, 약품 디스펜싱, 재고 관리 | Medium |
| 검사실 기사 (Lab Tech) | 검사 접수, 결과 입력 | Medium |
| 병원 관리자 (Admin) | 사용자 관리, 대시보드, 시스템 설정 | High |

### 8.2 타겟 지역 및 언어

| 항목 | 1차 타겟 | 2차 확장 |
|------|---------|---------|
| 지역 | **한국** (1차 병의원, 중소 병원) | 영어권, 개발도상국 (HospitalRun 철학 계승) |
| 언어 | **한국어** (기본) | 영어, i18n 구조로 다국어 확장 가능 |
| 규제 | **개인정보보호법**, **의료법**, **EMR 인증제 2주기** | HIPAA (미국) 등 국가별 플러그인 |
| 보험 | **국민건강보험** (HIRA 청구 포털 연동) | 실손보험 청구 (추후) |
| 코드 체계 | KCD, EDI 수가코드, 약품코드(KPIS) | ICD-10, SNOMED CT |

### 8.3 한국형 HIS 핵심 연동 시스템

| 연동 대상 | 설명 | 프로토콜 |
|----------|------|---------|
| **HIRA 청구 포털** | 건강보험 진료비 청구/심사/지급 | HIRA API (XML/JSON) |
| **DUR 시스템** | 의약품 안전사용 실시간 점검 | HIRA DUR API |
| **건강정보 고속도로** | 타 의료기관 간 진료정보 교류 | HL7 FHIR R4 |
| **약학정보원 (KPIS)** | 의약품 정보 마스터 데이터 | 약학정보원 API |
| **KCD 코드** | 한국표준질병·사인분류 (KCD-8) | 코드 마스터 DB |
| **EDI 수가코드** | 건강보험 행위/치료재료/약제 수가 | HIRA 수가 파일 |

---

## 9. MVP Strategy (Phase 1 Delivery)

MVP에서는 핵심 기능에 집중하여 빠르게 검증:

| Phase | Features | Target | 예상 기간 |
|-------|----------|--------|----------|
| **MVP (Phase 1)** | FR-01 환자관리, FR-03 RBAC, FR-04 예약, FR-10 감사로그(기본), FR-11 FHIR Patient, FR-20 코드 마스터 | 핵심 워크플로우 + FHIR 기본 + 한국 코드 체계 | 10~12주 |
| **Phase 2** | FR-02 진료기록, FR-14 OCS, FR-16 DUR, FR-17 수납(정액제 기본), FR-13 임상 템플릿 | OCS + 진료 + 기본 수납 (한국형 핵심) | 10~12주 |
| **Phase 3** | FR-05 약국, FR-06 검사실, FR-07 영상, FR-15 건강보험 청구, FR-09 대시보드 | 부서별 기능 + HIRA 청구 연동 | 12~14주 |
| **Phase 4** | FR-23 원무고도화, FR-24 입원관리, FR-27 병상관리 | 원무 + 입원 + 병상 (입원환자 워크플로우) | 12~14주 |
| **Phase 5** | FR-25 수술, FR-26 응급실, FR-28 자재/재고, FR-29 CSSD | 수술 + 응급 + 자재 + 중앙공급 | 12~14주 |
| **Phase 6** | FR-30 영양/급식, FR-31 의료장비, FR-12 Bots, FR-21 Extension/Slot | 급식 + 장비 + 자동화 + 플러그인 | 10~12주 |
| **Phase 7** | FR-18 진료정보교류, FR-11 FHIR 전체, FR-19 EMR 인증 | 상호운용성 + 인증 | 12~14주 |
| **Phase 8** | FR-08 오프라인, FR-22 Runtime Config, FR-10 감사(고도화) | 오프라인 + 커스터마이징 + 고도화 | 8~10주 |

### 9.1 Phase 간 의존성

```
Phase 1 (MVP — 기반)
  FR-01 환자관리 ──────┐
  FR-03 RBAC ─────────┤
  FR-04 예약 ─────────┤
  FR-10 감사로그(기본) ─┤
  FR-11 FHIR Patient ─┤
  FR-20 코드 마스터 ───┘  ← KCD, EDI, 약품코드 기초 데이터
         │
         ▼
Phase 2 (한국형 핵심 — OCS + 진료 + 수납)
  FR-02 진료기록(SOAP) ←── FR-01(환자) + FR-20(코드) 필요
  FR-14 OCS ←────────────── FR-02(처방) 필요
  FR-16 DUR 점검 ←──────── FR-14(처방) + FR-20(약품코드) 필요
  FR-17 수납 ←───────────── FR-02(진료) + FR-20(수가코드) 필요
  FR-13 임상 템플릿 ←────── FR-02(진료기록) 필요
         │
         ▼
Phase 3 (부서 + 보험 청구)
  FR-05 약국 ←────── FR-14(OCS 처방 전달) 필요
  FR-06 검사실 ←──── FR-14(OCS 검사 오더) 필요
  FR-07 영상 ←────── FR-14(OCS 영상 오더) 필요
  FR-15 건강보험 청구 ←── FR-17(수납) + FR-20(수가코드) 필요
  FR-09 대시보드 ←── 전체 데이터 필요
         │
         ▼
Phase 4 (원무 + 입원 + 병상)
  FR-23 원무 고도화 ←────── Phase 3(수납) 기반
  FR-24 입원 관리 ←──────── FR-02(진료기록) + FR-27(병상) 필요
  FR-27 병상 관리 ←──────── 독립 구현 가능
         │
         ▼
Phase 5 (수술 + 응급 + 자재 + 중앙공급)
  FR-25 수술 관리 ←──────── FR-24(입원) + FR-04(스케줄링) 필요
  FR-26 응급실 ←─────────── FR-01(환자) + FR-14(OCS) + FR-24(입원 연계)
  FR-28 자재/재고 관리 ←─── FR-05(약국 재고) 확장
  FR-29 중앙공급실(CSSD) ←─ FR-25(수술 기구) 연계
         │
         ▼
Phase 6 (급식 + 장비 + 자동화)
  FR-30 영양/급식 ←──────── FR-24(입원 식이) 연동
  FR-31 의료장비 관리 ←──── 독립 구현
  FR-12 Bots 워크플로우 ←── 알림/자동화 엔진
  FR-21 Extension/Slot ←── 플러그인 아키텍처
         │
         ▼
Phase 7 (상호운용성 + 인증)
  FR-18 진료정보교류 ←───── FR-11(FHIR) 기반
  FR-11 FHIR 전체 ←──────── 전체 리소스 매핑
  FR-19 EMR 인증 ←──────── 전체 기능 + 상호운용성 확보 후
         │
         ▼
Phase 8 (오프라인 + 고도화)
  FR-08 오프라인 동기화 ←── 전체 기능 안정화 후
  FR-22 Runtime Config ←── 병원별 커스터마이징
  FR-10 감사로그(고도화) ←─ 파티셔닝, 분석 리포트
```

---

## 10. Next Steps

1. [ ] Design 문서 작성 (`hospital-run.design.md`)
2. [ ] Schema 정의 (Phase 1 — 환자, 사용자, 예약 엔티티)
3. [ ] Convention 정의 (Phase 2 — 코딩 규칙, 폴더 구조)
4. [ ] 프로젝트 초기화 (Turborepo + Next.js + NestJS)
5. [ ] CI/CD 파이프라인 구축

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-06 | Initial draft — HospitalRun 리빌드 기획 | user |
| 0.2 | 2026-05-06 | EtherCIS/Medplum 참고 프로젝트 추가, FHIR R4/Bots/임상 템플릿 FR 추가 | user |
| 0.3 | 2026-05-06 | 검토 반영 — DoD 수정, 의료 규제 리스크 추가, 타임라인/의존성 추가, 아키텍처 초기/목표 구분, 타겟 사용자/지역 정의, 이중 표준 전략 상세화 | user |
| 0.4 | 2026-05-06 | **한국형 HIS 전환** — OCS, 건강보험 청구, DUR, 수납, 진료정보교류, EMR 인증, 한국 의료코드 등 FR-14~FR-20 추가. Phase 5단계 재구성, HIRA/한국보건의료정보원 연동 명시, 한국 규제/코드 리스크 추가 | user |
| 0.5 | 2026-05-06 | 통합 검토 반영 — DoD에 FR-20 추가, 수납 복잡성/식별자 처리 리스크, EMR 인증 추적 메커니즘 보강 | user |
| 0.6 | 2026-05-06 | **OpenMRS O3 참고 추가** — JSON Form Engine(FR-13 강화), Extension/Slot 플러그인(FR-21), Runtime Configuration(FR-22), 비교 테이블 O3 컬럼 추가 | user |
| 0.7 | 2026-05-06 | **원무/입원/수술/응급/병상 추가** — FR-23~27 추가, Phase 7단계 재구성, 입원환자+응급 워크플로우 반영 | user |
| 0.8 | 2026-05-06 | **자재/CSSD/급식/장비 추가** — FR-28~31 추가, Phase 8단계로 확장 (자재+중앙공급+영양+장비) | user |
