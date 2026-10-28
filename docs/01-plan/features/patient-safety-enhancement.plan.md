# 환자안전(IPSG) 고도화 기획서 v2.0

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/web/src/app/(main)/workstation/attending/page.tsx:32 · apps/api/prisma/schema.prisma:9063 · 잔여: 후속·정정 정본 agent-emr-alignment.plan.md · 검토 초안의 "ClinicalHandoff I-PASS 필드 미구현"은 틀림(schema I-PASS 5필드 존재)

> 🔴 **후속·정정판: `docs/01-plan/features/agent-emr-alignment.plan.md`**(2026-08-18).
> 이 문서의 법규 참조표에 **「환자안전법」이 없고**(R13 의무보고·R14 보고자 비밀보장 미다룸),
> KOPS 는 Out of Scope 다. 또한 방향이 **"경보를 더 단다"** 인데, 근거상 그 방향은 효과가 없거나
> 역효과다(DDI override 율 90%·메타분석에서 환자 결과 개선 없음·hard stop RCT 는 IRB 조기 중단).
> 후속 문서가 **경보 예산제**와 **루프 추적**으로 재조정한다.


> JCI 국제환자안전목표(IPSG 1~6) 기반 전면 보강

## 1. 현황 분석

### 완성된 기능
| IPSG | 항목 | 구현 | 모델/모듈 |
|------|------|:----:|-----------|
| 5 | 감염 관리 | ✅ | InfectionSurveillance, infection-control 모듈 (감시/격리/접촉자추적/발병알림) |
| 6 | 낙상 관리 | ✅ | FallRiskAssessment, NursingAssessment (점수/등급/중재/배지) |
| - | 안전 사고 보고 | ✅ | SafetyIncident (유형/중증도/RCA/상태추적) |
| - | 수술 체크리스트 | ✅ | SurgicalChecklist (SignIn/TimeOut/SignOut 22개 항목) |
| - | SBAR 간호 기록 | ✅ | UniversalNursingNote (situation/background/assessment/recommendation) |
| - | VS 이상 알림 | ✅ | SSE 실시간 CRITICAL 알림 (이번 세션 구현) |
| - | 마약류 관리 | ✅ | ControlledSubstanceLog (처방→확인→불출→투약→폐기) |
| - | 인수인계 | ✅ | ClinicalHandoff + 대시보드 작성 모달 |

### 부족한 기능
| ID | IPSG | 항목 | 현황 |
|----|------|------|------|
| FR-01 | 1 | 환자 식별 체크리스트 | 팔찌 인쇄만 있음, 식별 절차 프로토콜 없음 |
| FR-02 | 1 | 식별 오류 사건 자동 연결 | SafetyIncident.type=IDENTIFICATION이 있으나 환자별 통계 없음 |
| FR-03 | 2 | 인수인계 체크리스트 (I-PASS) | ClinicalHandoff에 summary만 있고 구조화된 체크리스트 없음 |
| FR-04 | 2 | 위급상황 보고 체계 (RRS) | 조기경보점수(EWS) 자동 계산 없음 |
| FR-05 | 3 | 고위험 약물 플래그 | MedicationCode에 highAlertFlag 없음 |
| FR-06 | 3 | LASA(유사명칭) 약물 경고 | 처방 시 LASA 경고 없음 |
| FR-07 | 3 | 고위험 약물 이중확인 | 바코드 double-check는 있으나 약물 등급별 강제 아님 |
| FR-08 | 4 | 수술 체크리스트 UI | SurgicalChecklist 모델 있으나 FE 미구현 |
| FR-09 | - | 안전 사고 페이지 UI 개선 | 유형 한글화, 보고일 표시, 상세/조사/RCA 기능 없음 |
| FR-10 | - | 안전 대시보드 통계 | 사고 유형별/월별 통계, 추이 차트 없음 |
| FR-11 | 6 | Morse Fall Scale 자동 계산 | 수동 점수만, 항목별 자동 합산 없음 |
| FR-12 | - | 조기경보점수(NEWS2) | VS 기록 시 NEWS2 자동 계산 + 등급별 대응 |
| FR-13 | 2 | 구두/전화 처방 Read-back | 구두처방 수신→기록→읽어주기 확인→서명 |
| FR-14 | 3 | ISMP 고위험 약물 분류 보완 | 혈전용해제, IV 강심제, TPN 추가 |

---

## 2. IPSG.1 — 환자 식별 강화

### 2.1 환자 식별 체크리스트

```
새 모델: PatientIdentificationCheck
  id, patientId, encounterId?, admissionId?, surgeryId?
  checkType: ADMISSION | PROCEDURE | MEDICATION | TRANSFUSION | SPECIMEN
  method: WRISTBAND | VERBAL | BARCODE | TWO_IDENTIFIER
  verifiedItems: Json  // {name: bool, dob: bool, mrn: bool}
  verifiedBy: String (userId)
  verifiedAt: DateTime
  result: PASS | FAIL
  failureReason: String?

API:
  POST /api/v1/safety/identification-check
  GET  /api/v1/safety/identification-check/patient/:patientId
```

### 2.2 식별 오류 통계
- SafetyIncident(type=IDENTIFICATION) 기반 환자별/부서별 통계
- 안전 대시보드에 식별 오류율 추이 표시

---

## 3. IPSG.2 — 효과적 의사소통 강화

### 3.1 I-PASS 인수인계 체크리스트

```
ClinicalHandoff 확장:
  + illness: String?         (I: 질병 심각도 — 안정/불안정/위중)
  + patientSummary: String?  (P: 환자 요약)
  + actionList: Json?        (A: 조치 목록 [{action, status, deadline}])
  + situationAwareness: String? (S: 상황 인식 — 주의사항)
  + synthesis: String?       (S: 종합 — 인수자 확인)
```

### 3.2 조기경보점수 (NEWS2)

```
새 모델: EarlyWarningScore
  id, patientId, nurseId, recordedAt
  // NEWS2 파라미터
  respiratoryRate: Int
  spO2: Int
  supplementalO2: Boolean
  systolicBp: Int
  heartRate: Int
  consciousness: String    (ALERT/CONFUSION/VOICE/PAIN/UNRESPONSIVE — ACVPU)
  temperature: Decimal
  spO2Scale: Int @default(1) (Scale 1=일반, Scale 2=COPD/산소요법 환자)
  // 계산
  totalScore: Int           (자동 계산)
  riskLevel: LOW | LOW_MEDIUM | MEDIUM | HIGH
  // 대응
  escalationRequired: Boolean
  escalationNotified: Boolean?
  escalationNotifiedAt: DateTime?

NEWS2 계산 로직 (NHS 공식 2017 개정판 준수):
  RR: 12-20=0, 9-11=1, 21-24=2, ≤8=3, ≥25=3
  SpO2 Scale 1 (일반): ≥96=0, 94-95=1, 92-93=2, ≤91=3
  SpO2 Scale 2 (COPD): 88-92=0, 93-94=1(+), 95-96=2(+), ≥97=3(+), 86-87=1, 84-85=2, ≤83=3
  보충산소 사용: supplementalO2=true → +2점 (Scale 1에서 SpO2≥97이어도 가산)
  BP (수축기): 111-219=0, 101-110=1, 91-100=2, ≤90=3, ≥220=3
  HR: 51-90=0, 41-50=1, 91-110=1, 111-130=2, ≤40=3, ≥131=3
  Temp: 36.1-38.0=0, 35.1-36.0=1, 38.1-39.0=1, ≥39.1=2, ≤35.0=3
  Consciousness (ACVPU): Alert=0, Confusion/Voice/Pain/Unresponsive=3

대응 프로토콜 (NHS NEWS2 공식):
  0점: 12시간 간격 모니터링
  1-4 (Low): 4-6시간 간격
  개별 파라미터 3점 (Low-Medium): 1시간 간격 + 담당 간호사 판단
  5-6 (Medium): 1시간 간격 + 담당의 즉시 보고
  ≥7 (High): 즉시 RRS(신속대응팀) 호출 + SSE CRITICAL 알림

API:
  POST /api/v1/safety/ews/calculate
    → VS 데이터 → NEWS2 점수 자동 계산 + 저장
  GET  /api/v1/safety/ews/patient/:patientId
    → 환자별 EWS 추이

연동:
  - nurse-station recordVitals 시 EWS 자동 계산
  - HIGH 시 SSE CRITICAL 알림 (기존 VS 알림에 통합)
```

### 3.3 구두/전화 처방 Read-back (FR-13)

```
Prescription 확장:
  + orderSource: WRITTEN | VERBAL | TELEPHONE   (처방 경로)
  + readBackConfirmedAt: DateTime?               (Read-back 확인 시간)
  + readBackConfirmedBy: String?                 (확인자 userId)

워크플로우:
  1. 의사가 구두/전화로 처방 전달
  2. 간호사가 처방 내용 기록 (orderSource: VERBAL/TELEPHONE)
  3. 간호사가 기록 내용을 의사에게 읽어줌 (Read-back)
  4. 의사가 확인 → readBackConfirmedAt 기록
  5. 24시간 이내 의사 서명 필요 (미서명 시 알림)

API:
  PATCH /api/v1/prescriptions/:id/read-back-confirm
    → readBackConfirmedAt, readBackConfirmedBy 기록
```

---

## 4. IPSG.3 — 고위험 약물 관리 강화

### 4.1 고위험 약물 플래그

```
MedicationCode 확장:
  + highAlertFlag: Boolean @default(false)     (고위험 약물)
  + highAlertCategory: String?                 (HAM 분류)
  + lasaGroup: String?                         (유사명칭 그룹)
  + maxSingleDose: Decimal?                    (1회 최대용량)
  + maxDailyDose: Decimal?                     (1일 최대용량)

고위험 약물 분류 (HAM):
  - 항응고제 (Anticoagulants)
  - 인슐린 (Insulin)
  - 마약성 진통제 (Opioids)
  - 근이완제 (Neuromuscular blocking agents)
  - 항부정맥제 (Antiarrhythmics)
  - 고농도 전해질 (Concentrated electrolytes)
  - 세포독성 약물 (Cytotoxic agents)
  - 혈전용해제 (Thrombolytics)
  - 경정맥 강심제 (IV inotropes — dopamine, dobutamine)
  - 총비경구영양 (TPN)
```

### 4.2 LASA 약물 경고

```
처방 생성 시:
  1. 약품 검색 → LASA 그룹 동일 약물 존재 시 경고 표시
  2. "외형 유사(Look-alike)" / "발음 유사(Sound-alike)" 분류
  3. DUR 경고와 함께 표시

API:
  GET /api/v1/codes/medication/lasa-check?code=...
    → 유사명칭 약물 목록 + 경고 메시지
```

### 4.3 용량 범위 검증

```
처방 생성 시:
  - dosage > maxSingleDose → WARNING
  - 1일 총량 > maxDailyDose → ERROR
  - DUR 점검에 통합
```

---

## 5. IPSG.4 — 수술 안전 체크리스트 UI

```
기존 모델: SurgicalChecklist (SignIn 5항목/TimeOut 5항목/SignOut 4항목)

WHO 필수 항목 보완 (기존 모델 확장):
  SurgicalChecklist 추가 필드:
    // Sign In 추가 (WHO 필수)
    + signInPulseOximeter: Boolean?      (맥박산소측정기 부착)
    + signInExpectedBloodLoss: Boolean?   (예상 출혈량 >500ml 확인)
    + signInDifficultAirway: Boolean?     (어려운 기도관리/흡인 위험)
    // Time Out 추가 (WHO 필수)
    + timeOutCriticalEvents: Boolean?     (예상 주요 사건 공유)
    + timeOutImagingDisplayed: Boolean?   (필수 영상 게시 확인)
    // Sign Out 추가 (WHO 필수)
    + signOutEquipmentIssues: Boolean?    (장비 문제 기록)

FE 구현:
  1. 수술 상세 페이지에 3단계 체크리스트 UI (아코디언)
  2. 각 단계별 체크 + 완료자/완료 시간 기록
  3. 미완료 항목 경고 (수술 시작 전 SignIn 필수)
  4. 체크리스트 완료율 통계

API (기존 모델 확장):
  GET  /api/v1/surgery/:id/checklist
  PATCH /api/v1/surgery/:id/checklist/sign-in
  PATCH /api/v1/surgery/:id/checklist/time-out
  PATCH /api/v1/surgery/:id/checklist/sign-out
```

---

## 6. 환자안전 페이지 UI 전면 개선

### 6.1 현재 문제
- 유형이 영문 (NEEDLE_STICK, MEDICATION_ERROR) → 한글 부족
- 보고일이 "-" → occurredAt/createdAt 매핑 오류
- 상세 조회/조사/RCA 기능 없음
- 통계/대시보드 없음

### 6.2 개선 내용

```
탭 구성:
  1. 대시보드 — 사고 유형별 통계, 월별 추이, 중증도 분포
  2. 사고 목록 — 필터(유형/중증도/상태/기간) + 상세 모달
  3. 사고 보고 — 신규 보고 폼 (유형 선택 → 상세 입력)
  4. EWS 모니터링 — 조기경보점수 환자 목록 + 추이
  5. 식별 체크 — 환자 식별 체크 이력

유형 한글 매핑 확장:
  FALL: '낙상', MEDICATION: '투약', MEDICATION_ERROR: '투약오류',
  IDENTIFICATION: '환자확인', INFECTION: '감염', PRESSURE_INJURY: '욕창',
  NEEDLE_STICK: '주사침상해', EQUIPMENT: '장비', PROCEDURE: '시술',
  TRANSFUSION: '수혈', COMMUNICATION: '의사소통', OTHER: '기타'

보고일 수정:
  occurredAt → reportedAt 대신 createdAt 사용 (SafetyIncident.createdAt)

상세 모달:
  - 사고 상세 정보 (환자, 보고자, 장소, 일시)
  - 조치 내역 (actionTaken)
  - 상태 변경 이력
  - RCA 완료 여부 + RCA 보고서 링크
```

---

## 7. 구현 우선순위

### Phase 1a: UI 전면 개선 (2일)
- [ ] 환자안전 페이지 전면 리디자인 (5탭)
- [ ] 유형 한글화 12종 + 보고일(createdAt) 수정
- [ ] 사고 보고 폼 + 상세 모달 + RCA 상태
- [ ] 사고 통계 대시보드 (유형별/월별/추이 차트)

### Phase 1b: EWS 조기경보 (2일)
- [ ] EarlyWarningScore 모델 + NEWS2 계산 API (Scale 1+2, ACVPU)
- [ ] VS 기록 시 EWS 자동 계산 연동
- [ ] EWS HIGH 시 SSE CRITICAL 알림
- [ ] EWS 모니터링 탭 (환자 목록 + 추이)

### Phase 2: 고위험 약물 + 수술 체크리스트 (2~3일)
- [ ] MedicationCode에 highAlertFlag/lasaGroup/maxDose 추가
- [ ] 처방 시 고위험 약물 경고 + LASA 경고 + 용량 검증
- [ ] SurgicalChecklist WHO 항목 6개 추가 (모델 확장)
- [ ] 수술 체크리스트 FE (3단계 아코디언 UI)
- [ ] 체크리스트 API (sign-in/time-out/sign-out)

### Phase 3: 식별 + 인수인계 + Read-back (2일)
- [ ] PatientIdentificationCheck 모델 + API
- [ ] ClinicalHandoff I-PASS 필드 확장
- [ ] 구두/전화 처방 Read-back 워크플로우
- [ ] Morse Fall Scale 자동 계산

---

## 8. 비기능 요구사항

| 항목 | 기준 |
|------|------|
| EWS 계산 | VS 기록 후 < 1초 이내 |
| HIGH EWS 알림 | < 3초 이내 SSE 도달 |
| 고위험 약물 경고 | 처방 입력 시 즉시 표시 |
| 수술 체크리스트 | 미완료 시 수술 시작 차단 |
| 사고 보고 | 익명 보고 옵션 지원 |

---

## 9. Out of Scope

| 항목 | 사유 | 로드맵 |
|------|------|--------|
| 환자안전 교육 콘텐츠 | 별도 LMS 영역 | Phase 4+ |
| 외부 보고 자동화 (KOPS) | 한국환자안전보고학습시스템 API 미공개 | 수동 보고 유지 |
| AI 기반 사고 예측 | 운영 데이터 축적 필요 | Phase 5+ |

---

## 10. 관련 시스템 연동

| 시스템 | 연동 내용 |
|--------|-----------|
| nurse-station | VS 기록 → EWS 자동 계산 → SSE 알림 |
| pharmacy | 고위험 약물 플래그 → CPOE 경고 |
| surgery | SurgicalChecklist → 체크리스트 UI |
| prescription | LASA 경고, 용량 검증 |
| notification | EWS HIGH → CRITICAL 알림 |
| controlled-substance | 마약류 = 고위험 약물 자동 매핑 |

---

## 11. 법규/표준 참조

| 표준 | 용도 |
|------|------|
| **JCI IPSG 1~6** | 국제환자안전목표 |
| **NEWS2** | National Early Warning Score (영국 NHS) |
| **Morse Fall Scale** | 낙상 위험 평가 도구 |
| **WHO Surgical Safety Checklist** | 수술 안전 체크리스트 |
| **I-PASS** | 인수인계 구조화 프레임워크 |
| **ISMP 고위험 약물 목록** | 고위험 약물 분류 기준 |

---

*작성일: 2026-05-21*
*버전: v2.0 (검증 피드백 반영 — NEWS2 Scale2/ACVPU, WHO 체크리스트 보완, Read-back, ISMP 보완)*
*상태: Phase 1a 우선 진행 권장*
