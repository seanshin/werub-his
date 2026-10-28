# 워크스테이션 환자 검색/추가 기획서 v1.0

> 접수 데스크의 스마트 환자 검색을 워크스테이션에 통합하되,
> **접수 완료/검진 접수 완료 환자를 최우선**으로 표시

---

## 1. 현재 상태

### 1.1 접수 데스크의 PatientSelector (이미 구현)

**컴포넌트**: `apps/web/src/components/ui/PatientSelector.tsx` (223줄)

**기능**:
- 이름/MRN/전화번호 검색
- **스마트 리스트** (검색 전에도 표시):
  - 오늘 내 환자 (my patients)
  - 최근 진료 (recent patients)
  - 담당 입원 (admitted patients)
  - 응급 환자 (emergency patients)
- `context` prop으로 상황별 동작 변경 (`order`, `schedule`, `admission`, `lab`, `diagnostics`, `general`)
- 검색 결과 + 스마트 리스트 통합 표시

**BE API**: `GET /api/v1/patients/smart-list?context={context}&search={search}`

### 1.2 현재 워크스테이션의 PatientAddModal

- 단순 `GET /api/v1/patients?search=` 검색
- 스마트 리스트 없음
- 접수 상태 정보 없음
- 검색 안 하면 아무것도 안 보임

### 1.3 문제점

| 문제 | 영향 |
|------|------|
| 스마트 리스트 없음 | 환자를 찾기 어려움 |
| 접수 상태 미표시 | 이미 접수된 환자인지 모름 |
| 검진 접수 미연동 | 검진 수검자가 어떤 검사실에 와야 하는지 모름 |
| 워크인만 지원 | 기존 오더가 있는 환자도 새로 등록해야 함 |

---

## 2. 개선 설계

### 2.1 워크스테이션 전용 context 추가

PatientSelector에 **`workstation-lab`**, **`workstation-therapy`** context 추가:

```typescript
// PatientSelector context 확장
context: 'order' | 'schedule' | 'admission' | 'lab' | 'diagnostics' | 'general'
       | 'workstation-lab'      // 검사실 워크스테이션
       | 'workstation-therapy'  // 치료실 워크스테이션
       | 'workstation-imaging'  // 영상실 워크스테이션
```

### 2.2 스마트 리스트 우선순위 (워크스테이션 전용)

```
[검색 전 기본 표시]

1순위: 접수 완료 환자 (오늘)
   ← Encounter(status=DRAFT, visitType=OUTPATIENT, today)의 patient
   ← 이미 접수는 했지만 아직 검사/치료 대기 중인 환자
   표시: "접수완료" 뱃지 (파란색)

2순위: 검진 접수 완료 수검자 (오늘)
   ← CheckupVisit(status=CHECKED_IN or IN_PROGRESS, today)의 patient
   ← 검진센터에서 접수 후 각 검사실로 이동해야 하는 환자
   표시: "검진접수" 뱃지 (초록색), 프로그램명

3순위: 진료 대기 환자
   ← WaitingQueue(status=WAITING, today)의 patient
   표시: "대기중" 뱃지

4순위: 입원 환자 (해당 병동)
   ← Admission(status=ADMITTED)의 patient
   표시: "입원" 뱃지, 병동명

5순위: 최근 내원 환자
   ← 최근 7일 내 Encounter가 있는 patient
   표시: 마지막 내원 날짜

[검색 시]
- 위 우선순위 유지 + 검색어 매칭
- 이름/MRN/전화번호로 검색
- 매칭된 환자 중 1~4순위 환자가 상단에 표시
```

### 2.3 환자 선택 후 동작 분기

```
환자 선택
  ↓
기존 오더가 있는가? (오늘, 해당 스테이션)
  ├─ YES → "이미 대기열에 있습니다" 알림 + 해당 오더로 이동
  └─ NO → 작업 등록 폼 표시
           ├─ 검사실: 검사 내용 입력 (또는 템플릿 선택) → Prescription + Order 생성
           └─ 치료실: 치료 내용 선택 → TherapyOrder 생성
```

### 2.4 검진 수검자 특화 표시

검진 접수된 환자의 경우 추가 정보 표시:

```
┌─ 검진 접수 환자 ──────────────────────────────┐
│ 홍길동 P2026-0001  남/45세                     │
│ 🟢 검진접수  기본 종합검진 (CK-BASIC)           │
│ 검사 진행: ████░░░░░░ 3/13 (혈액검사 대기)      │
└───────────────────────────────────────────────┘
```

검사실 담당자가 **이 환자가 어떤 검사를 기다리고 있는지** 바로 확인 가능.

---

## 3. BE API 확장

### 3.1 워크스테이션 스마트 리스트

```
GET /api/v1/workstation/smart-patients?stationId={stationId}&search={search}

Response:
{
  checkedInPatients: [  // 오늘 접수 완료 (Encounter 기준)
    { id, mrn, familyName, givenName, gender, age, checkedInAt, encounterType }
  ],
  checkupPatients: [  // 오늘 검진 접수 (CheckupVisit 기준)
    { id, mrn, familyName, givenName, gender, age, 
      programName, visitStatus, progressPct, pendingTests }
  ],
  waitingPatients: [  // 대기열
    { id, mrn, familyName, givenName, gender, age, queuePosition }
  ],
  admittedPatients: [  // 입원
    { id, mrn, familyName, givenName, gender, age, wardName }
  ],
  searchResults: [  // 검색어 매칭 (위에 없는 환자)
    { id, mrn, familyName, givenName, gender, age, lastVisit }
  ],
}
```

### 3.2 기존 오더 확인

```
GET /api/v1/workstation/patient/{patientId}/pending-orders?stationId={stationId}

Response:
{
  hasExistingOrders: boolean,
  orders: [{ orderId, procedureName, status, createdAt }],
  checkupVisit: { visitId, programName, pendingTests } | null,
}
```

---

## 4. FE 구현

### 4.1 PatientAddModal v2 교체

기존 단순 검색 모달 → **PatientSelector 기반 스마트 검색 모달**로 교체:

```
┌─ 환자 추가 ───────────────────────────────────────┐
│                                                    │
│  🔍 환자 검색 (이름, 등록번호)                       │
│  ┌──────────────────────────────────────────────┐ │
│  │                                              │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│  ■ 접수 완료 환자 (3)                               │
│  ┌──────────────────────────────────────────────┐ │
│  │ 홍길동  P2026-0001  남/45세     접수완료 09:12  │ │
│  │ 이영희  P2026-0003  여/38세     접수완료 09:25  │ │
│  │ 박철수  P2026-0005  남/52세     접수완료 09:40  │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│  ■ 검진 접수 수검자 (2)                              │
│  ┌──────────────────────────────────────────────┐ │
│  │ 김영수  P2026-0008  남/68세                    │ │
│  │ 🟢 검진접수 · 기본 종합검진                     │ │
│  │ 혈액검사 대기 중 (3/13 완료)                    │ │
│  │                                              │ │
│  │ 최수진  P2026-0012  여/29세                    │ │
│  │ 🟢 검진접수 · 여성 특화 검진                    │ │
│  │ 소변검사 대기 중 (5/12 완료)                    │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│  ■ 입원 환자 (1)                                    │
│  ┌──────────────────────────────────────────────┐ │
│  │ 강준서  HR-20260506-0199  남/60세  내과병동     │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│  ────── 또는 직접 검색 ──────                       │
│  ■ 검색 결과 (0)                                    │
│                                                    │
└────────────────────────────────────────────────────┘

[환자 선택 시]
┌──────────────────────────────────────────────────┐
│ ✓ 홍길동  남/45세  P2026-0001  [변경]              │
│                                                    │
│ ⚠ 이미 혈액검사(CBC) 오더가 있습니다.                │
│   → 기존 대기열에서 확인  [대기열로 이동]             │
│                                                    │
│ 또는 추가 검사 등록:                                 │
│ [검사 내용: _______________]                         │
│                              [취소]  [대기열에 추가]  │
└──────────────────────────────────────────────────┘
```

### 4.2 적용 위치

| 페이지 | PatientAddModal 사용 |
|--------|---------------------|
| `/workstation/lab` | stationType='lab' |
| `/workstation/imaging` | stationType='imaging' (추가) |
| `/workstation/diagnostic` | stationType='diagnostic' (추가) |
| `/workstation/therapy` | stationType='therapy' |

---

## 5. 구현 Phase

```
Phase 1  ─── BE: /workstation/smart-patients API + /patient/:id/pending-orders
Phase 2  ─── PatientAddModal v2: PatientSelector 통합 + 스마트 리스트
Phase 3  ─── 검진 수검자 연동 (CheckupVisit 기반 진행상황 표시)
Phase 4  ─── 기존 오더 중복 감지 + 대기열 이동
Phase 5  ─── 영상실/기초검사 워크스테이션에도 적용
```

---

## 6. 수정 파일

| 파일 | 변경 |
|------|------|
| `workstation.service.ts` | getSmartPatients(), getPatientPendingOrders() 추가 |
| `workstation.controller.ts` | smart-patients, patient/:id/pending-orders 엔드포인트 |
| `PatientAddModal.tsx` | v2 전면 교체 (PatientSelector 통합) |
| `workstation/lab/page.tsx` | 이미 적용됨 |
| `workstation/therapy/page.tsx` | 이미 적용됨 |
| `workstation/imaging/page.tsx` | 추가 적용 |
| `workstation/diagnostic/page.tsx` | 추가 적용 |
