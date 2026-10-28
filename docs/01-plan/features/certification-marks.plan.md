# 인증마크 시스템 + 의료 인증 갭 체크리스트 기획서 v1.0

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/src/modules/prescription/dur/dur.service.ts · apps/api/prisma/schema.prisma:3073 model SurgicalChecklist · apps/api/prisma/schema.prisma:10985 model HandHygieneObservation · 잔여: P1 의무기록 아카이빙(10년)(사람)

> **작성일**: 2026-06-05
> **목적**: ① 기능별 의료 인증 표준(인증마크) 부여, ② 화면 우하단 인증마크 표시, ③ 인증 준비도 갭 점검
> **표준**: EMR 인증(보건복지부), JCI(Joint Commission International), 의료기관평가인증원(ACI), 의료법, 개인정보보호법
> **근거**: code-analyzer/Explore 4개 영역 코드베이스 전수 조사 (의료질관리·환자안전·인증·JCI)

---

## 1. 인증마크 시스템 (구현됨)

### 1.1 구성
- **레지스트리**: `apps/web/src/lib/certification-marks.ts` — 표준 카탈로그 + 경로→마크 매핑
- **UI**: `apps/web/src/components/CertificationBadge.tsx` — 화면 **우하단 고정** 칩, 클릭 시 상세 패널
- **마운트**: `apps/web/src/app/(main)/layout.tsx` (전 HIS 화면 공통)

### 1.2 카테고리 (5종)
| 카테고리 | 색상 | 의미 |
|---------|------|------|
| EMR 인증 | 파랑 | 보건복지부 전자의무기록시스템 인증 |
| JCI | 호박 | JCI 국제인증 (IPSG·챕터) |
| 인증평가 | 초록 | 의료기관평가인증원 |
| 의료법 | 회색 | 법적 근거 조항 |
| 개인정보보호 | 보라 | 개인정보보호법·보안 |

### 1.3 동작
- 현재 경로(pathname)를 가장 구체적인 prefix로 매칭 → 해당 마크 집합 표시
- 접힌 칩(🛡️ 인증 N + 카테고리 색점) → 클릭 시 카테고리별 인증 근거 상세
- 세션 내 숨김 가능, 인쇄 시 비표시(print:hidden)

---

## 2. 기능별 인증마크 매핑 (마크 부여)

| 화면/기능(경로) | 부여 인증마크 |
|----------------|-------------|
| 환자(`/patients`) | EMR 의무기록 · JCI AOP · JCI MOI · 의료법 §22 |
| 진료기록(`/encounter`) | EMR 의무기록 · JCI COP · 의료법 §22 |
| 처방/CPOE(`/prescription`,`/cpoe`) | EMR 처방전달 · JCI MMU · IPSG.3 |
| 약국(`/pharmacy`) | JCI MMU · IPSG.3 |
| 마약류(`/admin/controlled-substance`) | JCI MMU · IPSG.3 |
| 수술/수술실(`/surgery`,`/operating-room`) | JCI ASC · IPSG.4 |
| 환자안전(`/safety`) | JCI QPS · IPSG.1·2·6 |
| 질관리(`/quality`,`/admin/qi`) | JCI QPS · 의료기관 인증 |
| 만족도(`/satisfaction`) | JCI PFR · QPS |
| 동의서(`/consent`) | JCI PFR · 의료법 §24-2 · EMR 전자서명 |
| 감사/접근통제(`/admin/audit`,`/access-control`) | EMR 접근통제 · 개인정보보호 · MOI |
| VIP 환자(`/admin/vip-patients`) | EMR 접근통제 · 개인정보보호 |
| 의무기록 사본(`/medical-records`) | 의료법 §21 · MOI · EMR 의무기록 |
| 수혈/혈액은행(`/blood-bank`) | JCI COP · IPSG.1 |
| 입원/퇴원/응급/전원(`/admission`,`/discharge`,`/emergency`,`/triage`,`/transfer`) | JCI ACC |
| 간호(`/nursing`) | JCI AOP · COP · IPSG.6 |
| 감염관리(`/infection`) | JCI PCI · IPSG.5 |
| 비대면진료(`/remote-consult`) | 의료법 §34 · JCI COP |
| 검사/영상/병리(`/lab`,`/imaging`,`/pathology`) | JCI AOP (검사 IPSG.2) |
| HIRA-EDI / HIE(`/hira-edi`,`/admin/hie-dashboard`) | JCI MOI · 의료법 §21 |

> 신규 기능 추가 시 `certification-marks.ts`의 `ROUTE_MARKS`에 경로→마크를 등록한다.

---

## 3. 의료 인증 갭 체크리스트 (현황 점검 결과)

### 3.1 EMR 인증 (준비도 ~68%)
| 항목 | 상태 |
|------|:----:|
| RBAC(7역할)·필드마스킹·AES-256 암호화·접근감사 | ✅ |
| Break-the-Glass·VIP·이상접근탐지(기본) | ✅ |
| CPOE/OCS·DUR(23규칙·연령금기·용량)·알레르기 연동 | ✅ |
| 동의서(8유형·다중서명·블록체인 전자서명) | ✅ |
| 진단/수가코드(KCD·EDI)·표준매핑(SNOMED/LOINC)·FHIR | ✅ |
| 간호기록(Morse/Braden/NANDA/MAR) 서비스 구현 | ⚠️ 스키마만 |
| 블록체인 서명 9개 지점 통합 | ⚠️ 부분 |
| 의무기록 5/10년 아카이빙 정책 | ❌ |
| 이상접근 실시간 알림 | ❌ |
| 의료기관평가인증원(ACI) 추적 시스템 | ❌ |
| 백업 암호화·재해복구계획(DRP) | ❌ |

### 3.2 환자안전 IPSG (평균 ~73%)
| 목표 | 비율 | 부족분 |
|------|:----:|--------|
| IPSG.1 환자확인 | 70% | 식별오류 통계 대시보드 |
| IPSG.2 의사소통 | 60% | I-PASS UI, **위급검사값 자동통보**, 구두처방 24h 서명 알림 |
| IPSG.3 고위험약물 | 50% | **처방 시 고위험/LASA 경고 UI**, ISMP 분류 |
| IPSG.4 수술안전 | 60% | 수술 체크리스트 UI, 미완료 시작 차단 |
| IPSG.5 감염예방 | 85% | **손위생 모니터링·준수율** |
| IPSG.6 낙상예방 | 90% | 낙상방지 체크리스트 UI |
| 안전사고 보고/RCA | 95% | RCA 상세 기록 |
| 신체보호대(restraint) | ❌ | 모듈 자체 없음 |
| 통증평가 | 부분 | 위치·중재·추이 차트 |

### 3.3 JCI 챕터 커버리지
| 강함 | 보통 | 약함 |
|------|------|------|
| ACC·AOP·COP·ASC·MMU·MOI | PFR·PCI·FMS | **GLD(거버넌스)·SQE(직원자격)** |

- **PFR**: 불만/고충 처리 전담 프로세스 부족
- **PCI**: 손위생·항생제 스튜어드십 전담 모듈 부족
- **GLD**: 위원회 의사록·정책관리·거버넌스 문서 **전무**
- **SQE**: 자격증 관리·필수교육 이수추적·면허 유효성 자동확인 **부족**
- **FMS**: 의료기기 보정·유지보수·시설 안전감사 기록 체계 미흡

### 3.4 의료 질관리(QPS)
| 항목 | 상태 |
|------|:----:|
| 환자만족도(NPS·감성분석·벤치마크) | ✅ |
| 안전사고/RCA 워크플로우 | ✅ |
| 분석 대시보드(외래/응급/입원/수술/안전) | ✅ |
| 질지표(QualityIndicator/QiMeasurement) | ⚠️ 기초 |
| QI 고도화(HIRA 적정성·PSI·HSMR·재입원율) | ⚠️ Mock |
| QI 위원회/활동 관리 | ❌ |

---

## 4. 우선순위 보강 권고 (인증 취득 핵심)

| 우선 | 항목 | 영역 | 규모 |
|:----:|------|------|:----:|
| P0 | 처방 시 고위험/LASA 약물 경고 UI | IPSG.3 | 중 |
| P0 | 위급검사값(Critical Value) 자동통보 | IPSG.2 | 중 |
| P0 | 수술 안전 체크리스트 UI + 미완료 차단 | IPSG.4 | 중 |
| P1 | 손위생 모니터링·준수율 | IPSG.5/PCI | 중 |
| P1 | 간호기록 서비스 구현(스키마→로직) | EMR/AOP | 대 |
| P1 | 의무기록 아카이빙(10년)·DRP 정책 | EMR/MOI | 중 |
| P2 | SQE 자격·교육 이수추적, GLD 위원회 관리 | JCI 운영 | 대 |
| P2 | QI 고도화 실데이터 연동(HIRA/PSI/HSMR) | QPS | 대 |
| P2 | 신체보호대(restraint) 관리 모듈 | 환자안전 | 중 |

---

## 5. 변경 이력
| 버전 | 날짜 | 내용 |
|------|------|------|
| v1.0 | 2026-06-05 | 인증마크 시스템(레지스트리+우하단 배지) 구현 + 5표준 매핑 + 4영역 갭 체크리스트 |
