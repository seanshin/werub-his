# Hospital RUN

## 한국형 차세대 Enterprise 병원 정보 시스템 (HIS)

---

> 📌 **갱신 안내 (2026-08-05 · v3.91.0)** — 본 소개자료는 초기 설계(v1) 기준으로 작성됐습니다. **시스템 규모(§4)와 요약 수치는 v3.91.0 운영 실측치로 갱신**했으며, 일부 상세 구조 표(§14~16)는 초기 아키텍처를 대표 예시로 유지합니다. 최신 전체 규모·아키텍처·연동은 `README.md` 및 문서 허브(`docs/architecture-hub.html`)를 참조하세요.

### 1. 프로젝트 개요

Hospital RUN은 **한국 의료 환경에 최적화된 오픈소스 기반 종합 병원 정보 시스템**입니다. 글로벌 5개 오픈소스 프로젝트의 핵심 아키텍처를 분석하고, 한국 의료 표준(KCD, EDI, DUR, HIRA, KTAS)과 국제 인증 기준(JCI, FHIR R4, EMR 인증제)을 결합하여 설계했습니다.

외래 진료부터 입원, 수술, 응급, ICU, 약국, 검사, 영상(PACS), 수납, 보험 청구, 경영 대시보드, 인사, 자재, 안전/질관리, 감염관리까지 — **병원 운영에 필요한 전체 영역**을 하나의 통합 플랫폼으로 제공합니다.

#### 핵심 차별점

- **JCI 국제 인증 대응**: IPSG, PCI, QPS, PCC, SQE, FMS 6개 영역 내장
- **EMR 인증제 대응**: 보건복지부 2주기 59개 인증지표 자가 점검 체크리스트
- **FHIR R4 국제 표준**: HL7 FHIR R4 리소스 기반 데이터 교환
- **한국 의료 표준 완전 지원**: KCD-8/ICD-10/ICD-11, EDI, DUR, HIRA, KTAS
- **Clinic(WeRU.B) SSO 연동**: 그룹웨어 통합 인증, 알림, 전자결재, Wiki

---

### 2. 참고 오픈소스 및 채택 요소

| 프로젝트 | 채택 요소 | 라이선스 |
|----------|----------|---------|
| **HospitalRun** | 오프라인 우선 철학, 환자/진료 UI 워크플로우 | MIT |
| **EtherCIS / EHRBase** | openEHR 스타일 bi-temporal 임상 데이터 이력 관리 | Apache 2.0 |
| **Medplum** | FHIR R4 표준 API, Bots 워크플로우 자동화, TypeScript Monorepo | Apache 2.0 |
| **OpenMRS O3** | JSON Form Engine, Extension/Slot 플러그인, Runtime Configuration | MPL 2.0 |
| **한국 의료 표준** | KCD/ICD-10/ICD-11, EDI 수가, DUR, HIRA 청구, KTAS, EMR 인증제 | — |

---

### 3. 기술 스택

| 계층 | 기술 | 비고 |
|------|------|------|
| **Frontend** | Next.js 15 (App Router), Tailwind CSS, Zustand, TanStack Query, React Hook Form + Zod | SSR/SSG, 반응형 UI |
| **Backend** | NestJS, Prisma ORM, PostgreSQL 16, Redis 7 | Enterprise Clean Architecture |
| **인증/보안** | Custom JWT (8h) + RBAC 5역할, AES-256 암호화, 감사 로그 | ADR-001 기반 |
| **의료 표준** | FHIR R4 (Patient, Encounter, MedicationRequest, Observation) | CapabilityStatement |
| **영상(PACS)** | Orthanc DICOM Server + Orthanc Explorer 2, DICOMweb | 환자별 영상 자동 연결 |
| **그룹웨어** | Clinic(WeRU.B) SSO 연동, API Key 인증 | 알림/결재/Wiki/캘린더 |
| **인프라** | Docker Compose, Nginx (SSL), PM2, Turborepo Monorepo | Let's Encrypt HTTPS |
| **아키텍처** | Enterprise Clean Architecture (Presentation → Application → Domain ← Infrastructure) | 모듈러 모놀리스 |

---

### 4. 시스템 규모

| 지표 | 수치 |
|------|:----:|
| 도메인 모듈 (`api/src/modules`) | **201개** |
| API 엔드포인트 | **3,060개** (AI 92개 포함) |
| 데이터 모델 (Prisma) | **512개** |
| Frontend 페이지 (`page.tsx`) | **418개** (홈페이지 46 포함) |
| 사이드바 메뉴 섹션 | **7개 (임상/입원/의무기록/관리/안전질관리/경영진/관리자)** |
| 역할 기반 접근 제어 | **5역할 (Admin, Doctor, Nurse, Pharmacist, Lab Tech)** |
| 등록 테스트 계정 | **43명 (경영진 3, 의사 20, 간호사 5, 약사 2, 검사기사 2, 행정 11)** |

---

### 5. 기능 영역 상세

#### 5.1 외래 진료 (Outpatient)

| 기능 | 설명 |
|------|------|
| **접수/대기관리** | 당일 접수, 자동 배정(최소 대기 의사) + 환자 선택 배정, 진료표 기반 |
| **SOAP 진료 기록** | 과별 진료 템플릿 18종 (내과/외과/소아/산부/응급/정형/신경외과 등) |
| **진단 코드** | KCD-8 (51종) + ICD-10 (10종) + ICD-11 (5종) 검색 및 입력 |
| **처방전달(OCS)** | 의사 처방 → 약국/검사실/영상실 자동 전달, 약속처방(CP) 12종 |
| **DUR 점검** | 병용금기/연령금기/용량초과 등 22개 상호작용 룰 + 실시간 경고 |
| **진료 기록 열람** | 과거 진료 이력 스크롤 뷰, 시간순 타임라인 |

**진료 워크플로우:**

```
예약/접수 → 대기 → 진료(SOAP) → 진단(KCD) → 처방(DUR 점검)
  → OCS 자동 전달 → 약국(조제) / 검사실(결과) / 영상실(판독)
  → 수납(본인부담금) → 건강보험 청구(HIRA)
```

#### 5.2 입원 (Inpatient)

| 기능 | 설명 |
|------|------|
| **입원 관리** | 입원 오더, 병상 자동/수동 배정, 입원 경과 기록 |
| **병상 현황** | 5개 병동 37상 실시간 현황판 (가용/점유/예약/정비) |
| **입원 경과 기록** | SOAP 형식 일별 경과 기록, 의사/간호사 구분 |
| **간호 기록** | 간호 사정, 간호 진단, 간호 계획, I/O 기록, 투약 확인 |
| **퇴원 요약** | 구조화된 퇴원 요약서 (진단/치료경과/퇴원지시) |
| **급식 관리** | 입원 환자 식이 유형 관리, 일괄 급식 생성 |

#### 5.3 수술 (Surgery)

| 기능 | 설명 |
|------|------|
| **수술 스케줄링** | 날짜/시간/수술실 배정, 집도의/마취과/보조 지정 |
| **수술 기록 (Op Note)** | 구조화 15필드 (진단/수술명/소견/합병증/검체/실혈량/삽입물/배액관) |
| **마취 기록** | 마취 방법, 약물, 바이탈 모니터링 |
| **수술 일정 Clinic 동기화** | WeRU.B 캘린더 자동 연동 |

#### 5.4 응급실 (Emergency)

| 기능 | 설명 |
|------|------|
| **KTAS 트리아지** | 한국형 응급환자 분류체계 1~5등급 자동 색상 분류 |
| **응급 진료** | 도착→트리아지→진료→처치→귀가/입원/전원 결정 워크플로우 |
| **ER 병상 관리** | 응급 병상 5상 실시간 현황 |

#### 5.5 중환자실 (ICU)

| 기능 | 설명 |
|------|------|
| **ICU 병상 관리** | MICU 4상 + SICU 4상 = 8상, 실시간 점유/가용 현황 |
| **환자 모니터링** | 바이탈 (HR, BP, SpO2, GCS), 인공호흡기, 격리 표시 |
| **입퇴실 관리** | 입실(중증도/사유) → 바이탈 기록 → 퇴실 워크플로우 |
| **ICU 대시보드** | 점유율, 인공호흡기 수, 중증도별 분포 |

#### 5.6 기초검사 / 생리기능검사 (Diagnostics)

| 기능 | 설명 |
|------|------|
| **검사 유형** | EKG, EEG, PFT(폐기능), Echo(심초음파), 내시경, 골밀도(DEXA) |
| **워크플로우** | 의뢰(ORDERED) → 예정(SCHEDULED) → 진행(IN_PROGRESS) → 완료(COMPLETED) |
| **결과 관리** | 소견, 인상, 결론(Normal/Abnormal/Borderline), 측정값(JSON) |
| **탭 필터** | 검사 유형별 필터, 상태별 집계 |

#### 5.7 약국 (Pharmacy)

| 기능 | 설명 |
|------|------|
| **OCS 약 오더 접수** | 의사 처방 자동 수신, 대기열 관리 |
| **조제/디스펜싱** | 약품별 조제 확인, 조제 완료 처리 |
| **투약 확인** | 바코드 기반 환자-약품 매칭 (향후) |
| **재고 연동** | 약품 재고 실시간 연동, 안전 재고 알림 |

#### 5.8 검사실 (Laboratory)

| 기능 | 설명 |
|------|------|
| **검사 접수** | OCS 검사 오더 자동 수신 |
| **결과 입력** | 검사 항목별 결과값 입력, 참고치 기반 H/L/N 자동 판정 |
| **결과 보고** | 확정 결과 의사 자동 통보 |

#### 5.9 영상/PACS (Imaging)

| 기능 | 설명 |
|------|------|
| **영상 오더** | X-ray, CT, MRI, 초음파 등 오더 입력 |
| **Orthanc DICOM 서버** | DICOM 이미지 저장/조회, DICOMweb API |
| **판독 기록** | 영상 판독 소견서 구조화 입력 |
| **환자별 영상 연결** | MRN 기반 PACS 자동 필터링 (Orthanc Explorer 2) |

---

### 6. 관리 (Administration)

| 기능 | 설명 |
|------|------|
| **수납** | 정액제 + 행위별 수가(FFS) + DRG 포괄수가 자동 산정, 보험유형별 본인부담률 |
| **건강보험 청구** | HIRA 포맷 청구 데이터 생성, 청구/심사/지급/삭감 관리, 삭감률 KPI |
| **병상 관리** | 병동/병실/침상 계층 구조, 실시간 현황판 |
| **인사(HR)** | 직원 등록(의료진/행정/기사/지원 43명), 3교대 근무 스케줄, Clinic 연동 |
| **자재/재고** | 의료소모품 18종 입출고, 안전재고 알림, 거래처 관리 |
| **중앙공급실(CSSD)** | 수술기구 멸균 소독 프로세스, 유효기간 관리 |
| **영양/급식** | 입원 환자 식이 유형 관리 (일반식/저염식/당뇨식/유동식 등) |
| **의료장비** | 장비 대장 12종, 정기 점검/교정 스케줄, 정비 이력 |
| **진료표 관리** | 의사별 요일/오전오후 진료 스케줄, 휴진/대진 관리 |
| **코드 마스터** | 진단코드(66종), 수가코드(36종), 약품코드(33종) 통합 관리 |

---

### 7. 경영진 대시보드 (Executive)

경영진 전용 대시보드로 병원 경영 성과 및 의료 품질을 실시간 모니터링합니다.

#### 7.1 경영 대시보드 (`/executive`)

| 위젯 | 내용 |
|------|------|
| **오늘 경영 실적** | 매출, 미수납, 환자 수, 병상 가동률 (전주 대비 증감) |
| **주간 매출 추이** | 최근 7일 매출 바 차트 |
| **월간 진료 추이** | 최근 5개월 진료건수 트렌드 |
| **부서별 실적** | 진료과별 오늘 진료건수 + 매출 |
| **인력 현황** | 직종별 재직 인원 현황 |
| **보험 청구 현황** | 미청구/심사중/승인, 삭감률 |
| **KPI 지표** | 일평균 외래, 병상 가동률, 재원일수, 수술건수, 삭감률 — 목표 대비 달성률 |
| **경영 알림** | 미수납, 재고 부족, 미완료 차트, 장비 점검 |

#### 7.2 의료 품질 대시보드 (`/executive/clinical`)

| 위젯 | 내용 |
|------|------|
| **오늘 진료 현황** | 진료건수, 외래 대기, 입원 환자, ICU 환자 |
| **의료진별 실적** | 의사별 오늘/주간 진료건수, 대기환자, 미완료차트 |
| **안전/질관리** | 이번달 안전사고 (낙상/투약오류/기타) |
| **감염관리** | 활성 감염, MRSA, 격리환자 |
| **진료과별 주간 추이** | 내과/외과/소아/산부/정형/응급 7일 트렌드 |

#### 7.3 경영진 계정

| 직위 | 이름 | 이메일 | 대시보드 |
|------|------|--------|---------|
| 병원장 | 홍원장 | hong.director@hospitalrun.example | 경영 + 의료 품질 |
| 이사장 | 김이사장 | kim.ceo@hospitalrun.example | 경영 |
| 의료원장 | 박의료원장 | park.cmo@hospitalrun.example | 의료 품질 |

---

### 8. JCI 국제 인증 대응

Hospital RUN은 **JCI (Joint Commission International)** 국제 의료기관 인증 6개 핵심 영역을 시스템에 내장하여, 인증 준비 및 지속적 품질 개선을 지원합니다.

#### 8.1 JCI 인증 영역별 대응 현황

| JCI 영역 | 코드 | 설명 | 대응 기능 | 구현 상태 |
|----------|------|------|----------|:---------:|
| **국제환자안전목표** | IPSG | 환자 식별, 의사소통, 투약 안전, 수술 안전, 낙상 방지, 감염 예방 | 안전사고 보고(유형/심각도), 낙상 위험 평가(Morse Scale), 투약 오류 추적, DUR 점검 | 구현 |
| **감염예방 및 관리** | PCI | 감염 감시, 격리, 보고, 손위생, 항생제 사용 | 감염 감시 대상자, 격리 유형/지시, 원내 감염 통계, KCDC 보고 플래그 | 구현 |
| **질 향상 및 환자안전** | QPS | 질 지표 정의, 측정, 분석, 개선 | QI 지표 7종, 목표치/실적 측정, 달성률 대시보드, 경영진 KPI 연동 | 구현 |
| **환자 및 가족의 권리** | PCC | 사전 동의, 정보 제공, 고충 처리 | 전자 동의서 6종 (수술/마취/수혈/시술/검사/입원), 서명/철회, 버전 관리 | 구현 |
| **직원 자격 및 교육** | SQE | 자격 관리, 필수 교육, 역량 평가 | 교육 프로그램 관리, 이수 추적, 자격 만료 알림, 인사 정보 연동 | 구현 |
| **시설 관리 및 안전** | FMS | 의료장비, 시설 점검, 화재/재난 대비 | 장비 대장 12종, 정기 점검/교정 스케줄, 정비 이력, CSSD 멸균 관리 | 구현 |

#### 8.2 JCI 관련 데이터 모델

```
안전: SafetyIncident (사고 보고), FallRiskAssessment (낙상 위험)
감염: InfectionSurveillance (감염 감시), 격리 유형/해제일
품질: QualityIndicator (지표 정의), QiMeasurement (측정 기록)
동의: ConsentForm (전자 동의서), ConsentTemplate (동의서 템플릿)
교육: EducationProgram (교육 프로그램), EducationCompletion (이수 기록)
장비: Equipment (장비 대장), MaintenanceLog (점검 이력)
CSSD: InstrumentSet (기구 세트), SterilizationLog (멸균 기록)
```

#### 8.3 JCI 대시보드 연동

경영진 의료 품질 대시보드에서 JCI 관련 지표를 실시간 모니터링:
- 이번달 안전사고 건수 (낙상/투약오류/기타)
- 활성 감염 현황 (MRSA/기타균/격리환자)
- QI 지표 달성률
- 필수교육 미이수 현황

---

### 9. EMR 인증제 대응

보건복지부 **전자의무기록시스템 인증제 2주기** 59개 인증지표에 대한 자가 점검 체크리스트를 내장합니다.

| 인증 영역 | 지표 수 | 주요 항목 |
|----------|:-------:|----------|
| 기능성 | 22개 | 진료 기록 입력/조회, 처방전달, 의약품 안전, 진료정보 교류 |
| 상호운용성 | 12개 | FHIR R4, HL7, CDA, 진료정보 교류(HIE) |
| 보안성 | 15개 | 접근 통제, 감사 추적, 암호화, 비밀번호 정책 |
| 사용성 | 10개 | 응답 시간, UI 직관성, 도움말, 장애 대응 |

자가 점검 대시보드: `/admin/emr-cert`

---

### 10. 한국 의료 표준 지원

| 표준 | 내용 | 코드 수 |
|------|------|:-------:|
| **KCD-8** | 한국표준질병사인분류 8차 개정 | 51종 |
| **ICD-10** | WHO 국제질병분류 10차 | 10종 |
| **ICD-11** | WHO 국제질병분류 11차 (차세대) | 5종 |
| **EDI 수가코드** | 건강보험 행위/치료재료 수가 | 36종 |
| **KPIS 약품코드** | 약학정보원 기반 약품 마스터 | 33종 |
| **DUR** | 의약품 안전사용 실시간 점검 (22개 상호작용 룰) | — |
| **HIRA 청구** | 건강보험심사평가원 XML 청구 포맷 생성 | — |
| **KTAS** | 한국형 응급환자 분류체계 (1~5등급) | — |
| **보험 유형** | 건강보험(NHI), 의료급여, 산재, 자보, 자비 — 본인부담률 자동 적용 | 5종 |

---

### 11. Clinic(WeRU.B) 그룹웨어 연동

| Phase | 기능 | 엔드포인트 |
|:-----:|------|:---------:|
| 1 | **SSO 통합 인증** — Clinic → HIS 자동 로그인, 역할 매핑 | 4개 |
| 1 | **직원 동기화** — Pull(Clinic→HIS) + Push(HIS→Clinic) | 4개 |
| 2 | **알림/채널** — 진료 알림, 긴급 알림, 인수인계 노트 | 5개 |
| 3 | **캘린더/근태** — 수술 일정 동기화, 출퇴근, 연차 관리 | 4개 |
| 4 | **전자결재(W.Sign)** — 입원 승인, 수술 승인, 약제 승인 | 2개 |
| 4 | **Wiki(ShareSpace)** — 의료 프로토콜, 가이드라인 공유 | 3개 |
| 5 | **Webhook** — 이벤트 기반 실시간 연동 | 3개 |

현재 직원 매핑: **43/43명 (100%)**

---

### 12. 보안 설계

| 항목 | 구현 | 비고 |
|------|------|------|
| 인증 | Custom JWT (Access 8h + Refresh 7일/Redis) | ADR-001 |
| 인가 | RBAC 5역할 (Admin, Doctor, Nurse, Pharmacist, Lab Tech) | 역할별 사이드바 메뉴 필터링 |
| 암호화 | AES-256-GCM (건강보험증번호), bcrypt cost=12 (비밀번호) | — |
| 감사 | 글로벌 인터셉터 — PHI 접근 자동 기록 | JCI SQE 대응 |
| 세션 | httpOnly + Secure + SameSite=Strict 쿠키 | CSRF 방지 |
| 식별자 | 주민등록번호 미수집 정책 (생년월일+성별 대체) | ADR-002 |
| Rate Limiting | 로그인 5회/분, 일반 API 60회/분 | DDoS 방어 |
| 데이터 분류 | 환자 이름: familyName/givenName 분리 (FHIR 호환) | ADR-002 |

---

### 13. 기술 플랫폼

| 기능 | 설명 |
|------|------|
| **FHIR R4** | Patient, Encounter, MedicationRequest, Observation, CapabilityStatement |
| **JSON Form Engine** | O3 스타일 JSON 스키마 기반 동적 의료 폼 (바이탈, 문진표) |
| **Bots 자동화** | 리소스 변경 트리거 → 서버사이드 자동 실행 (알림, 데이터 변환) |
| **Extension/Slot** | O3 스타일 플러그인 아키텍처, 제3자 UI 컴포넌트 동적 삽입 |
| **Runtime Configuration** | 코드 변경 없이 JSON 설정으로 병원별 커스터마이징 |
| **진료정보교류(HIE)** | 건강정보 고속도로 FHIR 기반 타 기관 진료 정보 전송/수신 |

---

### 14. Frontend 구조

**역할 기반 사이드바 네비게이션** (아래는 초기 7개 섹션 구조 예시 · 현행 전체 418 페이지):

| 섹션 | 페이지 | 접근 역할 |
|------|--------|----------|
| **임상** | 대시보드, 접수, 환자관리, 예약, OCS오더, 약국, 검사실, 영상실, 수술, 응급실, 중환자실, 기초검사 | 역할별 |
| **입원** | 입원환자, 병상현황, 급식 | 의료진 |
| **의무기록** | 동의서, 기록검색, 사본발급 | 의료진/관리자 |
| **관리** | 수납, 보험청구, 자재/재고, 중앙공급, 장비, 인사 | 관리자 |
| **안전/질관리** | 환자안전, 감염관리, QI, 직원교육 | 의료진/관리자 |
| **경영진** | 경영 대시보드, 의료 품질 대시보드 | 경영진(Admin) |
| **관리자** | 직원관리, 약속처방(CP), 진료표, 통계, 시설, 코드마스터, 병원현황, 감사로그, 설정, EMR인증 | 관리자 |

---

### 15. API 구조 (현행 3,060개 엔드포인트 · 아래는 초기 구조 예시)

| 그룹 | 수 | 주요 경로 |
|------|:--:|----------|
| 임상 (진료/처방/OCS/약국/검사/영상/수술/응급/ICU/기초검사) | 73 | `/api/v1/encounters`, `/api/v1/icu`, `/api/v1/diagnostic-tests` |
| 관리 (원무/수납/청구/인사/자재/CSSD/급식/장비) | 49 | `/api/v1/billings`, `/api/v1/hr`, `/api/v1/inventory` |
| 안전/질관리 (IPSG/감염/QI/동의서/교육) | 23 | `/api/v1/safety`, `/api/v1/quality`, `/api/v1/consent` |
| 경영진 (경영 대시보드/의료 품질) | 14 | `/api/v1/executive/overview`, `/api/v1/executive/clinical/*` |
| Clinic 연동 (SSO/동기화/알림/결재/Wiki/Webhook) | 25 | `/api/v1/clinic/*`, `/api/v1/sso/*`, `/api/v1/webhooks/*` |
| 플랫폼 (인증/FHIR/폼/봇/설정/HIE) | 28 | `/api/v1/auth`, `/fhir/R4`, `/api/v1/bots` |
| 기타 (Dashboard/진료표/약속처방) | 3 | `/api/v1/dashboard`, `/api/v1/clinic-schedule` |

---

### 16. 데이터 모델 (현행 512개 Prisma 모델 · 아래는 초기 구조 예시)

```
환자: Patient, PatientHistory, Allergy
진료: Encounter, EncounterDiagnosis, Prescription, Order
       EncounterTemplate, ProblemList
부서: Dispensing, DispensingItem, LabResult, LabResultItem,
      ImagingResult, DiagnosticTest
수납: Billing, BillingItem, Claim
입원: Admission, ProgressNote, Ward, Bed, MealOrder,
      Surgery, EmergencyVisit, DischargeSummary
ICU:  IcuBed, IcuAdmission, IcuRecord
간호: NursingAssessment, NursingDiagnosis, NursingNote,
      IntakeOutput, MedicationAdministration
관리: InventoryItem, InventoryTransaction, InstrumentSet,
      SterilizationLog, Equipment, MaintenanceLog,
      Staff, StaffSchedule, Certificate
코드: DiagnosisCode, ProcedureCode, MedicationCode
폼:   FormSchema, FormSubmission, Questionnaire, QuestionnaireResponse
봇:   Bot, BotExecution
PACS: DicomStudy
안전: SafetyIncident, FallRiskAssessment, InfectionSurveillance,
      QualityIndicator, QiMeasurement, ConsentForm, ConsentTemplate,
      EducationProgram, EducationCompletion
Clinic: ClinicSchedule, ClinicClosure, WaitingQueue,
        ClinicSyncLog, WebhookSubscription
기타: User, AuditLog, AppConfig
```

---

### 17. 아키텍처

#### 모듈러 모놀리스 (현재) → 마이크로서비스 (확장)

```
┌─────────────────────────────────────────────────────────────┐
│                     Client (Browser/PWA)                     │
│  Next.js 15 · Tailwind · Zustand · TanStack Query           │
└───────────────────────┬─────────────────────────────────────┘
                        │ HTTPS
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                  Nginx (SSL Reverse Proxy)                   │
│         his.example.org · Let's Encrypt Certificate          │
└────┬──────────┬──────────┬──────────┬───────────────────────┘
     │          │          │          │
     ▼          ▼          ▼          ▼
  :3000      :4000      :8042    Clinic API
  Next.js    NestJS     Orthanc   example.org
  (Web)      (API)      (PACS)    (SSO/Notify)
     │          │
     │          ▼
     │  ┌──────────────────────────────────────────────────┐
     │  │          NestJS Modular Monolith (45 Modules)    │
     │  │                                                  │
     │  │  ┌────────────────────────────────────────────┐  │
     │  │  │        Presentation Layer                  │  │
     │  │  │  Controllers · DTOs · Guards · Interceptors│  │
     │  │  ├────────────────────────────────────────────┤  │
     │  │  │        Application Layer                   │  │
     │  │  │     Services · Use Cases · Mappers         │  │
     │  │  ├────────────────────────────────────────────┤  │
     │  │  │          Domain Layer                      │  │
     │  │  │  Entities · Enums · Errors · Interfaces    │  │
     │  │  ├────────────────────────────────────────────┤  │
     │  │  │       Infrastructure Layer                 │  │
     │  │  │    Prisma · Redis · External APIs          │  │
     │  │  └────────────────────────────────────────────┘  │
     │  └──────────────────────────────────────────────────┘
     │          │              │              │
     │   ┌─────┴─────┐ ┌─────┴─────┐ ┌──────┴──────┐
     │   │PostgreSQL  │ │  Redis 7  │ │  Orthanc    │
     │   │   16       │ │ (Session/ │ │ (DICOM/     │
     │   │ (55 models)│ │  Cache)   │ │  DICOMweb)  │
     │   └───────────┘ └───────────┘ └─────────────┘
     │
     └──→ PM2 Process Manager (Cluster Mode)
```

---

### 18. 배포 환경

| 항목 | 값 |
|------|-----|
| 서버 | Linode Ubuntu 24.04 LTS (8코어/16GB/315GB) |
| 도메인 | https://his.example.org |
| 프로세스 관리 | PM2 (Cluster Mode) |
| 컨테이너 | Docker Compose (PostgreSQL, Redis, Orthanc, OHIF) |
| SSL | Let's Encrypt (자동 갱신) |
| CI/CD | Git + rsync + Turborepo build |

---

### 19. 개발 방법론 — PDCA 사이클

| Phase | Plan | Design | Do | Check | Report |
|:-----:|:----:|:------:|:--:|:-----:|:------:|
| Phase 1 (환자/예약/FHIR) | 95점 | 94점 | 14단계 | 91% | 완료 |
| Phase 2 (진료/OCS/DUR/수납) | 완료 | 완료 | 10단계 | ~90% | 완료 |
| Phase 3 (약국/검사/영상/청구) | 완료 | 완료 | 완료 | 93% | 완료 |
| Phase 4 (입원/수술/응급/관리/JCI) | 완료 | 완료 | 완료 | — | — |
| Phase 5 (ICU/기초검사/경영진/Clinic) | 완료 | 완료 | 완료 | — | — |

---

### 20. 향후 로드맵

| 우선순위 | 항목 | 설명 |
|:--------:|------|------|
| 1 | 외부 API 실 연동 | HIRA 청구 실전송, DUR API, 보험자격 실시간 조회 |
| 2 | PDF 생성 | 처방전, 영수증, 증명서(진단서/소견서), 동의서 출력 |
| 3 | 전자서명 | 처방/동의서 법적 효력, 공인인증서 연동 |
| 4 | 알림/메시징 | SMS, 카카오톡 예약 알림, 검사 결과 통보 |
| 5 | 바코드/QR | 환자 팔찌, 약품 확인, 검체 라벨 (JCI IPSG.1) |
| 6 | 환자 포탈 | 예약 조회, 검사 결과, 진료비 확인 (모바일) |
| 7 | 통계/BI 고도화 | DRG 분석, 원가 분석, 진료과별 수익성 |
| 8 | JCI 인증 자동화 | 인증 항목별 근거 자료 자동 수집, 인증 준비 리포트 |
| 9 | Kubernetes 배포 | EKS + Terraform + CI/CD 파이프라인 |
| 10 | 오프라인 동기화 | RxDB + Service Worker (HospitalRun 철학) |

---

### 21. 라이선스

MIT License

---

> **Hospital RUN** — 한국 의료 환경에 최적화된 차세대 오픈소스 Enterprise 병원 정보 시스템
>
> 204 모듈 · 3,060 API · 525 모델 · 426 페이지 · 16 전문 진료과 · JCI 6개 영역 · EMR 인증 · FHIR R4 · WeRU.B 의료 AI · 한국 의료 표준 완전 지원  _(v3.91.0 · 2026-08-05 실측)_
