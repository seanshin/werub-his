# 스마트 환자 선택기 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/src/modules/patient/patient.controller.ts:114 · apps/web/src/components/layout/SmartSearchBar.tsx · apps/web/src/app/(main)/ai-booking/page.tsx:7 · 잔여: 없음

## 문제점

현재 7개 페이지에서 환자 선택 UI가 각각 다른 방식으로 구현되어 있으며, 공통적으로 다음 문제가 있습니다:

| 문제 | 설명 |
|------|------|
| 맥락 없는 목록 | 전체 환자 목록만 표시 — 현재 예약/진행 중인 환자가 우선 표시되지 않음 |
| 일관성 없는 UI | select, 검색 드롭다운, 직접 입력 등 7가지 다른 구현 |
| 의사 맥락 미반영 | 로그인 의사의 오늘 예약 환자, 담당 입원 환자가 우선되지 않음 |
| 검색 한계 | 이름/MRN만 검색 가능, 부서/상태/진단 검색 불가 |
| 최근 환자 없음 | 방금 진료한 환자를 다시 찾으려면 처음부터 검색 |

## 영향 범위 (7개 페이지)

| 페이지 | 현재 방식 | 파일 |
|--------|----------|------|
| 기초검사 의뢰 | `<select>` 전체 목록 (limit=50) | diagnostics/page.tsx |
| 예약 생성 | 검색 드롭다운 | schedule/new/page.tsx |
| 오더(OCS) 신규 처방 | 검색 드롭다운 | orders/page.tsx |
| 접수 당일 접수 | 검색 테이블 | reception/components/WalkInTab.tsx |
| 입원 접수 | 검색 드롭다운 + select | inpatient/page.tsx |
| 영상 검사 | 텍스트 직접 입력 | imaging/components/StudiesTab.tsx |
| 환자 관계 등록 | 검색 드롭다운 | patients/[id]/components/PatientInfoTab.tsx |

## 목표

**의사가 로그인했을 때, 환자 선택 시 가장 관련 있는 환자가 먼저 보이는** 통합 스마트 환자 선택 컴포넌트를 만들어 모든 페이지에서 일관되게 사용합니다.

## 기능 설계

### 1. 스마트 환자 선택 컴포넌트 (`PatientSelector`)

```
┌─────────────────────────────────────────────┐
│ 🔍 환자 검색 (이름, MRN, 전화번호)          │
├─────────────────────────────────────────────┤
│                                             │
│ 📋 오늘 내 환자 (3)                         │
│ ┌─────────────────────────────────────────┐ │
│ │ 김영수  P2026-0001  내과  10:00 예약     │ │
│ │ 이미숙  P2026-0002  내과  10:30 진료중   │ │
│ │ 조건우  P2026-0009  내과  입원 3일째     │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ 🕐 최근 진료 환자                            │
│ ┌─────────────────────────────────────────┐ │
│ │ 박철수  P2026-0003  30분 전 진료         │ │
│ │ 홍길동  P2026-0017  1시간 전 진료        │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ 🏥 오늘 예약 대기                            │
│ ┌─────────────────────────────────────────┐ │
│ │ 최순자  P2026-0004  11:00 예약          │ │
│ │ 정민호  P2026-0005  11:30 예약          │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ 🚨 응급실 환자 (2)                           │
│ ┌─────────────────────────────────────────┐ │
│ │ 한지영  P2026-0006  KTAS 3급  복통      │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ─ 전체 환자 검색 ─                           │
│ (검색어 입력 시 표시)                         │
└─────────────────────────────────────────────┘
```

### 2. 환자 우선순위 로직

로그인 사용자의 역할과 부서에 따라 환자 목록 우선순위가 달라집니다:

#### 의사 (DOCTOR)
```
1순위: 현재 진료 중인 환자 (내 encounter, status=DRAFT)
2순위: 오늘 예약 환자 (내 appointment, status=SCHEDULED/CHECKED_IN)
3순위: 내 담당 입원 환자 (admittingDoctorId = me)
4순위: 최근 진료 환자 (최근 7일 encounter)
5순위: 응급실 현재 환자 (disposition=null)
6순위: 전체 환자 (검색 시)
```

#### 간호사 (NURSE)
```
1순위: 내 병동 입원 환자 (department 기반)
2순위: 오늘 접수 환자 (waiting queue)
3순위: 응급실 현재 환자
4순위: 전체 환자 (검색 시)
```

#### 약사 (PHARMACIST)
```
1순위: 현재 조제 대기 환자 (dispensing status=PENDING)
2순위: 오늘 처방 환자
3순위: 전체 환자 (검색 시)
```

#### 검사 기사 (LAB_TECH)
```
1순위: 현재 검사 대기 환자 (lab/diagnostic status=ORDERED)
2순위: 진행 중 검사 환자
3순위: 전체 환자 (검색 시)
```

### 3. API 설계

#### 새 엔드포인트
```
GET /api/v1/patients/smart-list
  ?role=DOCTOR           ← 현재 사용자 역할 (자동)
  &department=내과        ← 현재 사용자 부서 (자동)
  &q=검색어              ← 선택적 검색어
  &context=order|schedule|admission|lab|diagnostics  ← 사용 맥락
```

#### 응답 구조
```json
{
  "data": {
    "myPatients": [
      { "id": "...", "mrn": "P2026-0001", "familyName": "김", "givenName": "영수",
        "context": "오늘 10:00 예약", "contextType": "appointment" }
    ],
    "recentPatients": [
      { "id": "...", "mrn": "P2026-0003", "familyName": "박", "givenName": "철수",
        "context": "30분 전 진료", "contextType": "encounter" }
    ],
    "waitingPatients": [
      { "id": "...", "mrn": "P2026-0004", "familyName": "최", "givenName": "순자",
        "context": "11:00 예약 대기", "contextType": "appointment" }
    ],
    "emergencyPatients": [
      { "id": "...", "mrn": "P2026-0006", "familyName": "한", "givenName": "지영",
        "context": "KTAS 3급 · 복통", "contextType": "emergency" }
    ],
    "searchResults": []  // q 파라미터 있을 때만
  }
}
```

### 4. 컴포넌트 Props

```typescript
interface PatientSelectorProps {
  value?: string;                    // 선택된 환자 ID
  onChange: (patientId: string, patient: PatientInfo) => void;
  context?: 'order' | 'schedule' | 'admission' | 'lab' | 'diagnostics' | 'general';
  placeholder?: string;             // 기본: "환자 검색 (이름, MRN)"
  showEmergency?: boolean;          // 응급실 환자 표시 여부 (기본: true)
  showAdmitted?: boolean;           // 입원 환자 표시 여부 (기본: true)
  autoFocus?: boolean;
  disabled?: boolean;
}
```

### 5. UI 상세

#### 기본 상태 (포커스 전)
```
┌──────────────────────────────────────┐
│ 🔍 환자 검색 (이름, MRN, 전화번호)    │
└──────────────────────────────────────┘
```

#### 포커스 시 (검색 전)
- 즉시 "오늘 내 환자" + "최근 진료" + "응급실" 표시
- API 호출: `/api/v1/patients/smart-list` (검색어 없이)

#### 검색 입력 시
- 300ms 디바운싱 후 검색
- "오늘 내 환자" 중 매칭 → "최근 진료" 중 매칭 → 전체 검색 결과 순서로 표시
- 매칭 글자 하이라이트

#### 환자 선택 후
```
┌──────────────────────────────────────┐
│ 김영수 (P2026-0001)  내과 10:00 예약  │  ✕
└──────────────────────────────────────┘
```

### 6. 맥락별 동작 차이

| 맥락 | 특수 동작 |
|------|----------|
| `order` | 처방 생성 시 → 진행 중인 encounter 자동 매핑 |
| `schedule` | 예약 생성 시 → 기존 예약 충돌 경고 표시 |
| `admission` | 입원 접수 시 → 이미 입원 중인 환자 경고 |
| `lab` | 검사 의뢰 시 → 미완료 동일 검사 중복 경고 |
| `diagnostics` | 기초검사 의뢰 시 → 동일 검사 대기 중 경고 |

### 7. 키보드 접근성

| 키 | 동작 |
|-----|------|
| ↑↓ | 목록 항목 이동 |
| Enter | 선택 |
| Esc | 드롭다운 닫기 |
| Tab | 다음 입력 필드로 이동 |
| Ctrl+K | 어디서든 환자 검색 열기 (글로벌) |

## 구현 계획

### Phase 1: 공통 컴포넌트 + API
1. `GET /api/v1/patients/smart-list` API 구현
2. `PatientSelector` 공통 컴포넌트 생성 (`components/ui/PatientSelector.tsx`)
3. 기초검사 페이지에 먼저 적용

### Phase 2: 전체 페이지 교체
4. 예약 생성 → PatientSelector 교체
5. 오더(OCS) → PatientSelector 교체
6. 접수 → PatientSelector 교체
7. 입원 → PatientSelector 교체

### Phase 3: 고도화
8. 영상검사 → PatientSelector 교체
9. 환자 관계 → PatientSelector 교체
10. 글로벌 Ctrl+K 환자 검색
11. 맥락별 경고 (중복 검사, 예약 충돌 등)

## 기대 효과

- **의사**: 환자 선택 시간 70% 단축 (검색 → 클릭 1회)
- **간호사**: 내 병동 환자만 바로 보임
- **약사**: 조제 대기 환자가 먼저
- **일관된 UX**: 7개 페이지 동일한 환자 선택 경험
