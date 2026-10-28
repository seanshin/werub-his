# 주치의 워크플로우 고도화 기획서 v1.1

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/prisma/schema.prisma:9010 model ChargeOfCare · apps/api/prisma/schema.prisma:9063 model ClinicalHandoff · apps/api/prisma/schema.prisma:9111 model Round · 잔여: 없음

> **작성일**: 2026-05-27
> **수정일**: 2026-05-27 (v1.1 — 검토 보완)
> **수준**: Enterprise (대학병원급)
> **우선순위**: 높음

---

## 1. 개요

### 1.1 목적
주치의(Attending Physician)가 담당 환자를 체계적으로 관리할 수 있는 통합 워크플로우 구축.
현재 BE에 ChargeOfCare/Round/Handoff/ProgressNote API가 구현되어 있으나,
의사 관점의 **통합 FE 경험**이 부재하여 실제 임상 업무 흐름과 괴리 발생.

### 1.2 핵심 가치
| 가치 | 설명 |
|------|------|
| **환자 안전** | 담당 환자 전체를 한눈에 파악하여 누락 방지 |
| **업무 효율** | 회진/인수인계/오더 확인을 하나의 대시보드에서 처리 |
| **연속성** | 인수인계 구조화(I-PASS)로 정보 손실 최소화 |
| **실시간성** | 검사 결과/간호 알림을 실시간으로 주치의에게 전달 |
| **협업** | 간호사 기록 실시간 공유 + 타과 협진 요청 연동 |

### 1.3 대상 사용자
| 역할 | 설명 | 현재 | TO-BE |
|------|------|:----:|:-----:|
| **주치의 (Attending)** | 입원환자 담당의. 최종 의사결정 | ✅ 배정 | ✅ 센서스+회진+인수인계 |
| **당직의 (On-call)** | 야간/주말 대리 담당 | ⚠️ Mock 당직표 | ✅ 실당직 연동 |
| **전공의 (Resident)** | 회진 보조, 경과기록 작성 | ❌ 역할 없음 | ⬜ Phase 2+ |
| **펠로우 (Fellow)** | 전문분야 자문 | ❌ 역할 없음 | ⬜ Phase 2+ |
| **협진의 (Consultant)** | 타과 협진 요청 수신 | ⚠️ API만 | ✅ 알림+기록 |

### 1.4 범위
**포함**: 입원 환자 관리, 회진, 인수인계, 경과기록, 검사 알림, 주치의 변경
**미포함 (v2)**: 전공의 교육, 수술 스케줄링, 외래 예약 관리, 퇴원 계획 워크플로우

---

## 2. 현재 상태 분석

### 2.1 구현 완료 (BE)

| 기능 | 모델 | API | FE | 비고 |
|------|------|-----|:--:|------|
| 주치의 배정 | ChargeOfCare | PATCH /inpatient/:id/attending | ❌ | 변경 시 Handoff 자동 생성 |
| 회진 기록 | Round | POST/GET /inpatient/:id/rounds | ⚠️ | 입원 상세 탭에 표시만 |
| 인수인계 | ClinicalHandoff | POST/GET/PATCH handoffs | ❌ | I-PASS 구조, 확인 API 있음 |
| 경과 기록 | ProgressNote | POST /inpatient/:id/progress-note | ⚠️ | 입원 상세 탭에 표시만 |
| 담당 환자 조회 | - | GET /patients/smart-list | ⚠️ | admittingDoctor만, ChargeOfCare 미포함 |
| 의사 프로필 | DoctorProfile | GET/PUT /doctors/profile | ✅ | 홈페이지/내부 표시 |
| 알림 | Notification + SSE | GET/SSE /notifications | ✅ | 실시간 스트림 |
| 타과 협진 | Referral | POST/GET /referrals | ⚠️ | 기본 CRUD만 |

### 2.2 미구현 (갭 분석)

| # | 기능 | 갭 유형 | 임상 영향 | 우선순위 |
|---|------|---------|----------|:--------:|
| G1 | 담당 환자 센서스 | FE 전무 | 환자 누락 위험 | 🔴 높음 |
| G2 | 회진 대시보드 | FE 전무 | 회진 효율 저하 | 🔴 높음 |
| G3 | 인수인계 수신 UI | FE 전무 | 정보 손실 | 🔴 높음 |
| G4 | 검사→주치의 알림 | BE 트리거 없음 | 결과 확인 지연 | 🟡 중간 |
| G5 | 주치의 변경 UI | FE 전무 | 절차 미준수 | 🟡 중간 |
| G6 | 회진 진행률 추적 | 없음 | 관리 어려움 | 🟡 중간 |
| G7 | 당직표 실연동 | Mock 데이터 | 실제 운영 불가 | 🟡 중간 |
| G8 | 간호→주치의 알림 | 연결 없음 | 상태 변화 인지 지연 | 🟡 중간 |
| G9 | 협진 결과 알림 | 없음 | 회신 확인 누락 | ⚪ 낮음 |
| G10 | 경과기록 템플릿 | 자유텍스트만 | 기록 품질 편차 | ⚪ 낮음 |

---

## 3. 주치의 하루 워크플로우 (TO-BE)

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│  07:00  출근 → 대시보드 확인                                 │
│         ├─ 📊 담당 환자 센서스 (8명: 안정5/불안정2/위급1)      │
│         ├─ 📨 미확인 인수인계 (야간→주간) — 2건               │
│         ├─ 🔬 미확인 검사 결과 — 5건                         │
│         └─ ⚠️ 간호 보고 대기 — 1건 (BP 상승)                 │
│                                                            │
│  07:30  인수인계 확인                                        │
│         ├─ I-PASS 구조 확인 (야간 불안정 환자 2명)            │
│         ├─ Action List 검토 → 오늘 조치 계획                  │
│         └─ [인계 확인 완료] → acknowledgedAt 기록              │
│                                                            │
│  08:00  회진 시작 (회진 대시보드)                              │
│         ├─ 오늘 대상: 8명 (미회진 우선 정렬)                   │
│         ├─ 환자별 순회:                                      │
│         │   ├─ 간호 타임라인 확인 (야간 바이탈/노트/I·O)       │
│         │   ├─ 바이탈 트렌드 차트 확인                        │
│         │   ├─ 검사 결과 확인 (미확인 표시)                    │
│         │   ├─ 간호사와 구두 인계 (침상 옆)                   │
│         │   └─ 빠른 회진 기록 (상태/평가/계획)                 │
│         └─ 진행률: ████████░░ 6/8 (75%)                     │
│                                                            │
│  09:00  외래 진료 (진료실)                                    │
│         ├─ 대기 환자 → SOAP → 처방 → 서명                    │
│         ├─ 입원 필요 시 → 입원 오더 + 주치의 자동 배정         │
│         └─ 🔔 입원 환자 검사 결과 알림 (SSE 배너)             │
│                                                            │
│  12:00  오더 추적 & 경과기록                                  │
│         ├─ 🔔 검사 결과 알림 확인 (대시보드 배지)              │
│         ├─ 위급값 → 즉시 대응 (전화/오더 변경)                 │
│         ├─ 경과기록 작성 (오늘 주요 변화)                      │
│         └─ 추가 오더 (검사/약물/협진/영상)                     │
│                                                            │
│  14:00  오후 회진 (선택)                                      │
│         ├─ 불안정/위급 환자만 재회진                           │
│         └─ 협진 회신 확인 (타과 의견 반영)                     │
│                                                            │
│  16:00  퇴원 계획 검토                                        │
│         ├─ 안정 환자 퇴원 가능성 평가                          │
│         ├─ 퇴원 교육 지시 (간호사에게)                         │
│         └─ 퇴원 요약 작성 (또는 지시)                          │
│                                                            │
│  17:00  인수인계 작성 → 야간 당직의                            │
│         ├─ I-PASS 구조화 인계서:                              │
│         │   ├─ I: 각 환자 중증도 (안정/불안정/위급)            │
│         │   ├─ P: 주요 진단/경과 요약                         │
│         │   ├─ A: 대기 중인 조치 목록 (검사/오더/모니터링)      │
│         │   ├─ S: 주의 사항 (알러지/낙상위험/격리 등)          │
│         │   └─ S: 종합 & 다음 조치                           │
│         ├─ 불안정 환자는 구두 인계 추가                        │
│         └─ 당직의에게 전달 → 알림 발송                         │
│                                                            │
│  17:30  퇴근                                                │
│                                                            │
│  ── 야간 (당직의) ──                                         │
│  22:00  야간 알림 수신 (위급값/간호 보고)                      │
│  03:00  응급 상황 → 주치의에게 전화 연락 (시스템 외)            │
│  06:30  야간 경과 → I-PASS 인수인계 작성                      │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 4. 기능 상세 설계

### 4.1 담당 환자 센서스 (My Patient Census)

**위치**: `/dashboard` 의사 대시보드 최상단

**데이터 소스**:
```
ChargeOfCare (releasedAt IS NULL, role = 'ATTENDING')
  → Admission (status = 'ADMITTED')
    → Patient (기본 정보 + 아바타)
    → 최근 바이탈 (FlowSheetEntry ORDER BY recordedAt DESC LIMIT 1)
    → 미확인 검사 (Order WHERE status='COMPLETED' AND acknowledgedAt IS NULL)
    → 간호 알림 (NursingNote WHERE priority='URGENT' AND createdAt > 최근 24시간)
    → 마지막 회진 시간 (Round ORDER BY roundedAt DESC LIMIT 1)
    → 오늘 간호 노트 수 (NursingNote WHERE createdAt = today)
    → 입원 일수 (DATEDIFF NOW() - admitDate)
```

**환자 카드 구성**:
```
┌─ 환자 카드 ──────────────────────────────────┐
│                                              │
│ [아바타] 김영수 (M/68)           ✅ 안정     │
│ 3내 301-A | 입원 16일 | 일반식              │
│ Dx: 급성심근경색 (I21) — 고혈압 (I10)       │
│                                              │
│ ┌─ 바이탈 (2시간 전) ──────────────────────┐ │
│ │ BP 125/80  HR 72  BT 36.5  SpO2 98%     │ │
│ │ ▲ 트렌드: 안정 ━━━━━━━━                  │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ 📋 회진: 오늘 08:15 (3시간 전)               │
│ 🔬 미확인 검사: 0건                          │
│ 📝 간호 노트: 3건 (오늘)                     │
│ 💊 활성 처방: 5건                            │
│                                              │
│ [회진 기록] [차트 보기] [오더] [경과기록]      │
└──────────────────────────────────────────────┘
```

**상태 분류 알고리즘**:
```typescript
function classifyStatus(patient: CensusPatient): PatientStatus {
  const v = patient.latestVitals;
  
  // 위급 (Critical)
  if (v?.systolicBp > 180 || v?.systolicBp < 80) return 'CRITICAL';
  if (v?.heartRate > 140 || v?.heartRate < 40) return 'CRITICAL';
  if (v?.spo2 < 90) return 'CRITICAL';
  if (patient.admission.ward?.includes('ICU')) return 'CRITICAL';
  if (patient.urgentAlerts.length > 0) return 'CRITICAL';
  
  // 불안정 (Unstable)
  if (v?.systolicBp > 160 || v?.systolicBp < 90) return 'UNSTABLE';
  if (v?.heartRate > 120 || v?.heartRate < 50) return 'UNSTABLE';
  if (v?.spo2 < 94) return 'UNSTABLE';
  if (v?.temperature > 38.5) return 'UNSTABLE';
  if (patient.pendingLabCount > 0 && hasAbnormalLab) return 'UNSTABLE';
  
  // 신규 (New) — 입원 24시간 이내
  if (patient.admission.daysAdmitted <= 1) return 'NEW';
  
  // 퇴원예정 (Discharge Planned)
  if (patient.admission.dischargePlanned) return 'DC_PLAN';
  
  // 안정 (Stable)
  return 'STABLE';
}
```

**상태별 UI**:
| 상태 | 배지 | 카드 테두리 | 정렬 우선순위 |
|------|------|-----------|:------------:|
| 🔴 위급 (Critical) | 빨강 + 펄스 애니메이션 | `border-red-500` | 1 (최상위) |
| ⚡ 불안정 (Unstable) | 주황 | `border-orange-400` | 2 |
| 🆕 신규 (New) | 파랑 | `border-blue-400` | 3 |
| ✅ 안정 (Stable) | 초록 | `border-gray-200` | 4 |
| 📤 퇴원예정 (DC Plan) | 보라 | `border-purple-300` | 5 |

**BE API**:
```
GET /api/v1/doctors/my-census
Authorization: Bearer {token}

Query: ?sortBy=status|ward|admitDate

Response:
{
  data: {
    doctorInfo: { id, name, department, specialty },
    totalPatients: 8,
    byStatus: { critical: 1, unstable: 2, new: 0, stable: 4, dcPlan: 1 },
    patients: [
      {
        patient: { id, familyName, givenName, mrn, gender, dateOfBirth, photoUrl },
        admission: { id, admitDate, ward, room, bed, dietType, daysAdmitted, admitReason },
        status: 'STABLE',
        primaryDiagnosis: '급성심근경색 (I21)',
        latestVitals: { systolicBp, diastolicBp, heartRate, temperature, spo2, recordedAt },
        vitalTrend: 'STABLE', // IMPROVING, STABLE, WORSENING
        lastRoundAt: '2026-05-27T08:15:00+09:00',
        lastRoundType: 'MORNING',
        pendingLabCount: 2,
        pendingLabItems: ['CBC', 'BMP'],
        todayNursingNotes: 3,
        activeRxCount: 5,
        urgentAlerts: [
          { type: 'VITAL_ABNORMAL', message: 'BP 148/92', severity: 'WARNING', at: '...' }
        ]
      }
    ]
  }
}
```

### 4.2 회진 대시보드 (Rounding Dashboard)

**위치**: `/dashboard` 내 탭 또는 사이드바 `/rounds`

**핵심 기능**:
1. **오늘 회진 대상**: 담당 환자 전체 (미회진 → 불안정 → 신규 → 안정 순)
2. **빠른 회진 기록**: 환자 카드에서 바로 기록 (페이지 이동 없이)
3. **회진 진행률**: 전체/완료/미완료 시각화
4. **간호 요약 인라인**: 회진 전 간호 노트 / 바이탈 빠른 확인
5. **회진 시트 인쇄**: A4 회진 기록지 인쇄 지원

**회진 카드**:
```
┌─ 회진 대상 ─────────────────────────────────┐
│                                              │
│ ⏳ 오대한 (M/71)  4외 401-A     ⚡ 불안정    │
│ Dx: HTN, DM — 담낭절제술 예정                │
│                                              │
│ [최근 바이탈] BP 148/92 HR 88 (2시간 전)     │
│ [간호 보고] BP 상승 → 주치의 보고 대기        │
│ [미확인 검사] BMP (어제 오후)                  │
│                                              │
│ ┌─ 빠른 회진 ──────────────────────────┐     │
│ │ 상태: ○안정 ●불안정 ○위급             │     │
│ │ 평가: [HTN 조절 불량. 증량 검토      ]│     │
│ │ 계획: [amlodipine 10mg. 2시간 BP     │     │
│ │        모니터링. 내일 BMP 재확인      ]│     │
│ │ [회진 완료 ✓]                         │     │
│ └──────────────────────────────────────┘     │
│                                              │
├──────────────────────────────────────────────┤
│                                              │
│ ✅ 김영수 (M/68)  3내 301-A     ✅ 안정      │
│ 회진 완료: 08:15 — 퇴원 준비 시작             │
│                                              │
└──────────────────────────────────────────────┘
```

**회진 진행률**:
```
오늘 회진: ██████████░░░░ 6/8 (75%)
   위급: ██ 1/1 ✓    불안정: █░ 1/2    안정: ████░ 4/5
```

### 4.3 인수인계 (Handoff)

#### 4.3.1 인수인계 수신 (배너)
**위치**: `/dashboard` 최상단 (미확인 건 있을 때)

```
┌─ 🔔 미확인 인수인계 2건 ────────── [모두 확인] ─┐
│                                                │
│ 야간→주간 | 강응급 → 김내과                      │
│ 환자 2명: 오대한(⚡불안정), 박철수(✅안정)       │
│                                                │
│ [상세 확인]                                     │
└────────────────────────────────────────────────┘
```

#### 4.3.2 인수인계 상세 (I-PASS)
```
┌─ 인수인계 상세 ──────────────────────────────┐
│                                              │
│ 인계: 강응급 (야간 당직) → 김내과 (주간 주치의)│
│ 시간: 2026-05-27 06:30                       │
│                                              │
│ ── 환자 1: 오대한 (M/71) ──                  │
│                                              │
│ I (중증도): ⚡ UNSTABLE                      │
│                                              │
│ P (환자 요약):                               │
│   HTN/DM 환자. 담낭절제술 예정.               │
│   야간 BP 148/92 상승. 두통 호소.             │
│   진통제 투여 후 NRS 4→2 호전.                │
│                                              │
│ A (조치 목록):                               │
│   ☐ 오전 혈압 재측정 → 약제 조정 결정         │
│   ☐ BMP 결과 확인 (어제 오후 오더)            │
│   ☐ 수술 전 심전도 예약                       │
│                                              │
│ S (상황 인식):                               │
│   새벽 3시 두통 호소. 진통제 투여.             │
│   6시 이후 BP 130/82로 안정화.                │
│   알러지: NKDA | 낙상위험: 중                  │
│                                              │
│ S (종합):                                    │
│   오전 회진 시 BP 재평가 필요.                 │
│   혈압약 증량 검토. 수술일정 재확인.            │
│                                              │
│ [인계 확인 완료 ✓]                            │
│                                              │
│ ── 환자 2: 박철수 ... ──                     │
└──────────────────────────────────────────────┘
```

#### 4.3.3 인수인계 작성
```
┌─ 인수인계 작성 (I-PASS) ─────────────────────┐
│                                              │
│ 대상 환자: [전체 담당 환자 8명 ▼]  또는 개별   │
│ 인수자: [강응급 (야간 당직) ▼]                 │
│                                              │
│ 불안정/위급 환자만 상세 작성:                   │
│                                              │
│ ── 오대한 (M/71) ⚡불안정 ──                  │
│                                              │
│ I: ○안정  ●불안정  ○위급                      │
│                                              │
│ P: [자동 입력: 최근 경과기록 + 진단 요약      ]│
│    [수정 가능                                ]│
│                                              │
│ A: 조치 목록                                  │
│    ☐ [바이탈 2시간 간격 모니터링              ]│
│    ☐ [BP>160 시 주치의 전화 연락              ]│
│    ☐ [내일 아침 BMP 재확인                    ]│
│    [+ 조치 추가]                              │
│                                              │
│ S: [혈압 변동 주의. 두통 재발 시 진통제 투여.  ]│
│    [수술 전 검사 진행 중.                     ]│
│                                              │
│ S: [혈압 안정 시 수술일정 확정 예정.           ]│
│                                              │
│ ── 안정 환자 일괄 인계 ──                     │
│ 김영수, 최순자, ... 6명 — 특이사항 없음        │
│                                              │
│ [인수인계 전달]                                │
└──────────────────────────────────────────────┘
```

### 4.4 검사 결과 → 주치의 자동 알림

**트리거 포인트**:
```
[검사 결과 confirm / 영상 판독 완료]
  ↓
[해당 환자의 현재 주치의 조회]
  ← ChargeOfCare WHERE releasedAt IS NULL AND role='ATTENDING'
  ← 없으면: Admission.admittingDoctorId 폴백
  ↓
[Notification 생성]
  type: 위급값 → 'LAB_CRITICAL' / 정상 → 'LAB_COMPLETED'
  severity: 위급값 → 'CRITICAL' / 이상 → 'WARNING' / 정상 → 'INFO'
  refType: 'LAB_RESULT' | 'IMAGING_RESULT'
  refId: 결과 ID
  ↓
[SSE 스트림으로 실시간 전달]
  ↓
[대시보드 → 미확인 검사 배지 갱신]
```

**위급값 알림 기준**:
| 검사 | 위급값 기준 | 알림 | 추가 조치 |
|------|-----------|------|----------|
| K+ | <2.5 또는 >6.5 mEq/L | 🔴 CRITICAL | 즉시 전화 |
| Glucose | <40 또는 >500 mg/dL | 🔴 CRITICAL | 즉시 전화 |
| Hb | <7.0 g/dL | 🔴 CRITICAL | 수혈 검토 |
| Plt | <20,000 /μL | 🔴 CRITICAL | 출혈 위험 |
| INR | >4.0 | 🟡 WARNING | 항응고제 조정 |
| WBC | >30,000 /μL | 🟡 WARNING | 감염 평가 |
| Cr | 2배 이상 상승 | 🟡 WARNING | AKI 평가 |
| Troponin | 양성 | 🔴 CRITICAL | ACS 평가 |

**간호 → 주치의 알림 (추가)**:
| 트리거 | 알림 | 조건 |
|--------|------|------|
| 바이탈 위급값 | 🔴 CRITICAL | BP>180/HR>140/SpO2<90 |
| 의식 변화 | 🔴 CRITICAL | GCS 2점 이상 감소 |
| 낙상 발생 | 🟡 WARNING | SafetyIncident |
| 통증 NRS ≥ 7 | 🟡 WARNING | FlowSheetEntry |
| 수술 후 출혈 | 🔴 CRITICAL | 배액량 급증 |

### 4.5 주치의 변경 UI

**위치**: `/inpatient/[admissionId]` → 주치의/진료팀 탭

**현재 주치의 표시**:
```
┌─ 담당 의료진 ────────────────────────────────┐
│                                              │
│ 주치의                                       │
│ ┌──────────────────────────────────────────┐ │
│ │ [아바타] 김내과 교수                       │ │
│ │ 순환기내과 | 내선 2150                     │ │
│ │ 배정일: 2026-05-11                        │ │
│ │                          [주치의 변경]     │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ 진료팀 이력                                   │
│ 2026-05-11~현재  김내과 (순환기내과) — 주치의  │
│ 2026-05-11       이외과 (일반외과) — 입원의    │
│                                              │
│ 인수인계 이력                                  │
│ 2026-05-26 17:00  김내과→강응급 (야간 당직)    │
│ 2026-05-27 07:00  강응급→김내과 (주간 복귀)    │
└──────────────────────────────────────────────┘
```

**변경 모달**:
```
┌─ 주치의 변경 ────────────────────────────────┐
│                                              │
│ 현재: 김내과 교수 (순환기내과)                 │
│                                              │
│ 새 주치의: [이름/전문과 검색...           🔍] │
│   > 박호흡 교수 (호흡기내과)                   │
│   > 정소화 교수 (소화기내과)                   │
│                                              │
│ 변경 사유: [전과 ▼]                          │
│   전과 / 퇴직 / 장기부재 / 환자요청 / 기타     │
│                                              │
│ 인수인계 노트 (선택):                         │
│ [환자 상태 안정. 특별 주의사항 없음.          ]│
│                                              │
│ ☑ 자동 인수인계 생성                          │
│ ☑ 이전 주치의에게 알림                        │
│ ☑ 새 주치의에게 알림                          │
│                                              │
│ [취소]                    [주치의 변경]        │
└──────────────────────────────────────────────┘
```

---

## 5. 데이터 모델

### 5.1 기존 모델 활용 (변경 불필요)
- `ChargeOfCare` — 주치의 배정/변경 이력 완전
- `ClinicalHandoff` — I-PASS 구조 포함 완전
- `Round` — 회진 기록 완전 (roundType, notes, assessment, plan, vitalSigns)
- `ProgressNote` — 경과 기록 완전
- `Notification` — 알림 시스템 + SSE 완전

### 5.2 보강 필요
```prisma
// Order 모델에 주치의 확인 필드 추가
model Order {
  // ... 기존 필드
  acknowledgedBy   String?   @map("acknowledged_by") @db.Uuid
  acknowledgedAt   DateTime? @map("acknowledged_at") @db.Timestamptz()
}
```

### 5.3 신규 모델 (선택)
```prisma
// 회진 일정 — 자동 생성용 (입원 시 매일 MORNING 자동 생성)
model RoundSchedule {
  id            String   @id @default(uuid()) @db.Uuid
  admissionId   String   @map("admission_id") @db.Uuid
  doctorId      String   @map("doctor_id") @db.Uuid
  scheduledDate DateTime @map("scheduled_date") @db.Date
  roundType     String   @map("round_type") @db.VarChar(20)
  completed     Boolean  @default(false)
  roundId       String?  @map("round_id") @db.Uuid
  createdAt     DateTime @default(now()) @map("created_at")

  admission Admission @relation(fields: [admissionId], references: [id])
  doctor    User      @relation("RoundScheduleDoctor", fields: [doctorId], references: [id])

  @@unique([admissionId, scheduledDate, roundType])
  @@index([doctorId, scheduledDate, completed])
  @@map("round_schedules")
}
```

---

## 6. API 설계

### 6.1 신규 API

| 메서드 | 경로 | 설명 | 권한 | 비고 |
|--------|------|------|------|------|
| GET | `/api/v1/doctors/my-census` | 담당 환자 센서스 | DOCTOR, ADMIN | ChargeOfCare 기반 |
| GET | `/api/v1/rounds/today` | 오늘 회진 대상+진행률 | DOCTOR, ADMIN | 미회진 우선 정렬 |
| POST | `/api/v1/rounds/quick` | 빠른 회진 기록 | DOCTOR | 상태+바이탈+노트+계획 |
| GET | `/api/v1/handoffs/pending` | 미확인 인수인계 | DOCTOR, ADMIN | 기존 API |
| POST | `/api/v1/handoffs/batch` | 일괄 인수인계 작성 | DOCTOR | 안정 환자 일괄 |
| PATCH | `/api/v1/handoffs/:id/acknowledge` | 인계 확인 | DOCTOR, ADMIN | 기존 API |
| PATCH | `/api/v1/orders/:id/acknowledge` | 검사 결과 확인 | DOCTOR | 신규 |

### 6.2 기존 API 보강

| API | 보강 내용 |
|-----|----------|
| `GET /patients/smart-list` | `attendingPatients` 추가 (ChargeOfCare 기반) |
| `POST /lab/results/:id/confirm` | 주치의 자동 알림 트리거 |
| `POST /nursing-notes` | priority='URGENT' 시 주치의 알림 |
| `POST /flow-sheet-entries` | 위급값 시 주치의 알림 |
| `PATCH /inpatient/:id/attending` | 양방향 알림 + I-PASS 자동생성 강화 |

---

## 7. FE 페이지 구조

```
/dashboard
  ├── DoctorDashboard.tsx (기존 대폭 확장)
  │   ├── PendingHandoffBanner   ← [신규] 미확인 인수인계 배너
  │   ├── MyCensusPanel          ← [신규] 담당 환자 센서스
  │   │   ├── CensusPatientCard  ← 환자별 카드 (상태/바이탈/알림)
  │   │   └── QuickRoundInline   ← 인라인 빠른 회진
  │   ├── RoundingProgress       ← [신규] 회진 진행률
  │   ├── PendingLabBadge        ← [신규] 미확인 검사 배지
  │   ├── TodaySchedule          ← [기존] 오늘 일정
  │   └── IncompleteCharts       ← [기존] 미서명 차트

/rounds
  ├── RoundingDashboard.tsx      ← [신규] 전용 회진 페이지
  │   ├── RoundTargetList        ← 오늘 대상 (미회진 우선)
  │   ├── QuickRoundForm         ← 빠른 회진 기록 폼
  │   ├── RoundProgressBar       ← 진행률
  │   └── RoundPrintSheet        ← 인쇄용 회진 시트

/handoffs
  ├── HandoffDashboard.tsx       ← [신규] 인수인계 전용 페이지
  │   ├── PendingHandoffList     ← 미확인 인수인계 목록
  │   ├── HandoffDetailModal     ← I-PASS 상세 보기
  │   ├── HandoffWriteForm       ← 인수인계 작성 (개별/일괄)
  │   └── HandoffHistory         ← 인수인계 이력

/inpatient/[admissionId]
  └── CareTeamTab (기존 확장)
      ├── AttendingDoctorCard     ← 현재 주치의 + 변경 버튼
      ├── ChangeAttendingModal    ← [신규] 주치의 변경 모달
      ├── CareTeamHistory        ← 진료팀 이력
      └── HandoffHistory         ← 인수인계 이력
```

---

## 8. 구현 우선순위

| Phase | 작업 | BE 작업 | FE 작업 | 예상 |
|:-----:|------|---------|---------|:----:|
| **1** | 담당 환자 센서스 | my-census API | 대시보드 센서스 카드 | 1일 |
| **2** | 회진 대시보드 + 빠른 기록 | rounds/today API | 회진 대시보드 페이지 | 1일 |
| **3** | 인수인계 수신 배너 + 상세 UI | (기존 API 활용) | 배너 + I-PASS 모달 | 0.5일 |
| **3.5** | 인수인계 작성 폼 | handoffs/batch API | 작성 폼 (개별/일괄) | 0.5일 |
| **4** | 검사→주치의 알림 | lab confirm 트리거 | 대시보드 배지 | 1일 |
| **4.5** | 간호→주치의 알림 | nursing 트리거 | SSE 연동 | 0.5일 |
| **5** | 주치의 변경 UI | (기존 API 활용) | 변경 모달 | 0.5일 |
| | **합계** | | | **5일** |

---

## 9. 품질 기준 (KPI)

| 항목 | 목표 | 측정 방법 |
|------|------|----------|
| 센서스 로딩 | ≤ 2초 | API 응답 시간 |
| 회진 기록 | ≤ 3클릭 | UX 플로우 |
| 인수인계 확인 | 1클릭 | UI |
| 알림 지연 | ≤ 5초 | SSE 이벤트 시간차 |
| 모바일 대응 | PDA 사용 가능 | 반응형 테스트 |
| 회진 완료율 추적 | 일별 통계 | RoundSchedule |
| 인수인계 확인율 | 100% 목표 | acknowledgedAt 비율 |

---

## 10. 리스크 & 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| ChargeOfCare 미배정 환자 | 센서스 누락 | admittingDoctorId 폴백 |
| SSE 연결 끊김 | 알림 지연 | 폴링 폴백 (30초) + 재연결 |
| 당직표 미입력 | 인수인계 대상 불명 | 수동 지정 허용 |
| 위급값 알림 과다 | 알림 피로 | 중복 제거 (1시간 쿨다운) |
| 회진 기록 누락 | 의료법 위반 | 미회진 경고 + 관리자 알림 |

---

## 11. 참고: 유사 시스템

| 시스템 | 기능 | 참고점 |
|--------|------|--------|
| Epic Hyperspace | Storyboard (환자 요약) | 한 화면에 모든 정보, 상태 색상 |
| Cerner PowerChart | MPage (대시보드) | 역할별 커스텀 뷰, 빠른 오더 |
| MEDITECH Expanse | Patient Census | 워드별 센서스, 상태 분류 |
| OpenMRS | Patient Dashboard | 오픈소스 참고 구조 |
| I-PASS Institute | I-PASS Handoff | 구조화 인수인계 표준 |

---

## 12. 변경 이력

| 버전 | 날짜 | 변경 내용 |
|------|------|----------|
| v1.0 | 2026-05-27 | 초안 작성 |
| v1.1 | 2026-05-27 | 검토 보완: 상태 분류 알고리즘, 간호→주치의 알림, 인수인계 작성 폼, 협진의 역할, 퇴원계획 워크플로우, 리스크 분석, API 응답 구조 상세화, Order.acknowledgedBy 필드, 일괄 인수인계 API |
