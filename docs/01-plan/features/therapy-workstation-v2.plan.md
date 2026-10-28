# 치료실 워크스테이션 실사용 기획서 v2.0

> 기존 재활/투석/방사선 모듈의 풍부한 기능을 워크스테이션으로 통합하여 실제 운용 가능한 수준 구현

---

## 1. 현재 상태 분석

### 1.1 이미 잘 구현된 것 (재사용 대상)

| 모듈 | 모델 | BE API | FE 페이지 | 핵심 기능 |
|------|------|--------|----------|----------|
| **재활** | RehabAssessment + RehabPlan + RehabSession | 12+ API | 3탭 | Barthel/FIM/MMT/ROM 평가, 치료 계획, 세션 기록, 치료사 스케줄, 환자 진행 추적 |
| **투석** | DialysisOrder + DialysisSession + DialysisMachine | 15+ API | 3탭 | HD/PD 처방, **세션 자동생성**, Kt/V 자동계산, 투석중 바이탈, 기기 관리 |
| **방사선** | RadiationPlan + RadiationFraction + RadiationToxicity | 15+ API | 3탭 | 치료계획 승인, **Fraction 자동생성**, 선량 누적 자동계산, 독성 추적 |

### 1.2 치료실 워크스테이션의 문제점

| 문제 | 원인 |
|------|------|
| **데이터 안 보임** | TherapyOrder가 기존 RehabSession/DialysisSession과 연결 안 됨 |
| **CPOE 연결 없음** | 의사 처방 → 치료 오더 변환 경로 없음 |
| **기존 기능 미사용** | 투석 Kt/V, 방사선 Fraction 등 풍부한 기능이 워크스테이션에 없음 |
| **이중 관리** | /rehab, /dialysis, /radiation 페이지와 /workstation/therapy가 별개 |

### 1.3 핵심 전략: **통합, 새로 만들지 않음**

기존 재활/투석/방사선 API를 **워크스테이션에서 호출**하여 통합 뷰 제공.
각 전문 모듈의 API는 그대로 두고, 워크스테이션은 **통합 대기열 + 세션 기록 진입점** 역할.

---

## 2. 치료실별 통합 설계

### 2.1 물리·작업·언어치료 (tx-pt / tx-ot / tx-st)

**데이터 소스**: `RehabPlan` → `RehabSession`

```
워크스테이션 대기열
  ← GET /api/v1/rehab/sessions?date=today&therapistId=me&status=SCHEDULED
  
세션 시작
  → PATCH /api/v1/rehab/sessions/:id/start
  
세션 기록 + 완료
  → PATCH /api/v1/rehab/sessions/:id/complete
    body: { activities, vitals, progress, duration }
```

**대기열 표시 정보**:
- 환자명, 나이, 진단
- 치료 유형 (운동/도수/열전기/인지/ADL/언어)
- 예약 시간, 소요 예상
- 세션 번호 (#3/10)
- 치료 계획의 주 빈도 (주3회)
- 최근 Barthel/FIM 점수

**세션 기록 모달** (기존 RehabSession 필드 활용):
- 활동 내용 (activities JSON)
- 바이탈 (vitals JSON) 
- 진행 메모 (progress notes)
- 시작/종료 시간 → 자동 duration 계산

### 2.2 투석 (tx-dialysis)

**데이터 소스**: `DialysisOrder` → `DialysisSession`

```
워크스테이션 대기열
  ← GET /api/v1/dialysis/sessions?date=today&shift=AM&status=SCHEDULED
  
세션 시작 (투석 전 기록)
  → PATCH /api/v1/dialysis/sessions/:id/start
    body: { preWeight, preTemp, preBpSystolic, preBpDiastolic, preHr, machineId, nurseId, shift }

투석 중 바이탈 추가
  → POST /api/v1/dialysis/sessions/:id/vitals
    body: { time, bpSystolic, bpDiastolic, hr, ufRate, bloodFlow }

세션 완료 (투석 후 기록)
  → PATCH /api/v1/dialysis/sessions/:id/complete
    body: { postWeight, postTemp, postBpSystolic, postBpDiastolic, postHr, actualUf, actualDuration }
    ← 자동 Kt/V 계산 반환
```

**워크스테이션 특화 UI**:
- **Shift 뷰**: 오전/오후/야간 탭
- **기기 배정**: DialysisMachine 상태 + 환자 매핑
- 투석 전: 체중, 혈압, 체온, 심박수 입력
- 투석 중: 30분 간격 바이탈 모니터링 테이블
- 투석 후: 체중, 혈압 + 자동 Kt/V 표시
- 합병증 체크리스트: 저혈압/근경련/구역/두통

### 2.3 항암치료 (tx-chemo)

**데이터 소스**: 기존 `MedicationAdministration` 모델 재활용 + 항암 프로토콜

```
워크스테이션 대기열
  ← 오늘 항암 처방이 있는 환자 (Prescription type=MEDICATION, priority=STAT or 항암약)
  
투여 기록
  → POST /api/v1/med-admin (기존 투약관리 API)
    + 항암 특화 필드 (cycle, day, premedication, adverse event)
```

**워크스테이션 특화 UI**:
- 프로토콜명 + Cycle/Day 표시
- 투여 전 V/S 체크
- 약물별 투여 시작/종료 시간
- 부작용 CTCAE 등급 기록 (Grade 0~4)
- 관찰 시간 타이머

### 2.4 방사선치료 (tx-radiation)

**데이터 소스**: `RadiationPlan` → `RadiationFraction`

```
워크스테이션 대기열
  ← GET /api/v1/radiation/today-fractions
  
Fraction 전달
  → PATCH /api/v1/radiation/fractions/:id/deliver
    body: { deliveredDose, setupVerified, coneBeamCT }
    ← 자동 cumulativeDose 계산
```

**워크스테이션 특화 UI**:
- Fraction # / 총 Fraction (진행률 바)
- 금일 선량 + 누적 선량
- Setup 확인 + CBCT 확인 체크
- 피부 반응 Grade 기록
- 치료 기기/Room 표시

---

## 3. 통합 워크스테이션 UI 구조

```
/workstation/therapy
├── 스테이션 탭: [물리] [작업] [언어] [투석] [항암] [방사선]
│
├── 일정 뷰 (상단)
│   ← 물리/작업/언어: GET /rehab/sessions?date=
│   ← 투석: GET /dialysis/sessions?date=
│   ← 방사선: GET /radiation/today-fractions
│
├── 대기열 (중앙)
│   오늘 예정 중 미완료 건, 시간순 정렬
│   각 카드: 환자 + 치료정보 + 세션번호 + 호출/접수/시작/기록 버튼
│
└── 세션 기록 모달 (스테이션별 맞춤)
    ← 물리/작업/언어: 활동 + 바이탈 + 진행메모
    ← 투석: Pre/Post 체중·혈압 + 투석중 바이탈 + Kt/V
    ← 방사선: 선량 + Setup + 누적 + 독성
```

---

## 4. 구현 Phase

### Phase 1: API 통합 계층 (BE)
- WorkstationService에 각 모듈 API 호출 래퍼 추가
- `getTherapyQueue(stationId)`: 스테이션별로 적절한 모듈 API 호출
  - tx-pt/ot/st → RehabService.getSessions()
  - tx-dialysis → DialysisService.getSessions()
  - tx-radiation → RadiationService.getTodayFractions()
- `startTherapySession(stationId, id)`: 모듈별 start 분기
- `completeTherapySession(stationId, id, data)`: 모듈별 complete 분기

### Phase 2: 대기열 통합 (FE)
- 워크스테이션 therapy 페이지 전면 교체
- 스테이션 선택 시 해당 모듈 API 호출
- 카드에 모듈별 핵심 정보 표시

### Phase 3: 세션 기록 모달 고도화 (FE)
- 물리/작업/언어: RehabSession 필드 기반
- 투석: Pre/Post + 투석중 바이탈 테이블 + Kt/V
- 방사선: Fraction 전달 + 선량 + 독성

### Phase 4: 일정 관리 통합 (FE)
- 날짜 선택 → 모듈별 일정 조회
- 주간 뷰 (선택)

### Phase 5: CPOE 치료 처방 탭
- 재활: RehabPlan 생성 → RehabSession 자동 생성
- 투석: DialysisOrder 생성 → DialysisSession 자동 생성
- 방사선: RadiationPlan 생성 → Fraction 자동 생성

---

## 5. 수정 대상 파일

| 파일 | 변경 |
|------|------|
| `workstation.module.ts` | RehabModule, DialysisModule, RadiationModule import |
| `workstation.service.ts` | 모듈별 래퍼: getTherapyQueue, start, complete 분기 |
| `workstation.controller.ts` | 치료실 전용 엔드포인트 정리 |
| `workstation/therapy/page.tsx` | 전면 교체: 모듈별 API 호출 + 맞춤 UI |
| `seed.ts` | RehabSession + DialysisSession 오늘 일정 시딩 |

---

## 6. 테스트 데이터 요구

| 모듈 | 시드 내용 |
|------|----------|
| 재활 | RehabPlan 3건 + RehabSession 오늘 6건 (물리3/작업2/언어1) |
| 투석 | DialysisOrder 2건 + DialysisSession 오늘 3건 (AM shift) |
| 방사선 | RadiationPlan 2건 + RadiationFraction 오늘 2건 |

---

## 7. 기대 효과

| Before | After |
|--------|-------|
| 워크스테이션 빈 화면 | 실제 예정 환자 대기열 표시 |
| 기존 /rehab, /dialysis와 별개 | 동일 데이터를 워크스테이션 뷰로 제공 |
| 투석 Kt/V 등 전문 기능 미사용 | 워크스테이션에서 전문 기능 직접 사용 |
| 치료사가 여러 페이지 이동 | 워크스테이션 하나로 통합 |
