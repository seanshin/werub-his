# 병원 운영 시뮬레이터 기획서

## 목적

현재 HIS에 등록된 환자/의료진/예약/입원 데이터를 기반으로, 하루 병원 운영을 **시간 가속 시뮬레이션**하여 `/api/floor/entities`에 실시간 위치 데이터를 자동 생성합니다. Clinic 메타버스 뷰어에서 환자/의료진의 동선을 확인할 수 있습니다.

## 현재 데이터 기반

```
환자 30명 | 의료진 37명 | 예약 8건 | 입원 5건
응급 8건 (대기중) | 대기열 26명 | 진료표 51슬롯
SpaceNode 39개 (1~6층, 32구역)
```

## 시뮬레이션 시나리오

### 하루 일정 (08:00 ~ 18:00)

```
08:00 ── 의료진 출근 배치
08:30 ── 입원 환자 회진 시작
09:00 ── 외래 접수 시작, 진료 시작
09:00~12:00 ── 오전 진료 (예약 + 당일접수)
         ── 검사/영상 의뢰 → 검사실 이동 → 결과 → 복귀
         ── 응급실 환자 도착 (랜덤 간격)
12:00~13:00 ── 점심시간 (진료 중단, 입원 환자 급식)
13:00~17:00 ── 오후 진료
         ── 수술 (예정된 케이스)
         ── 퇴원 처리
17:00~18:00 ── 마무리, 야간 인수인계
```

### 환자 유형별 동선

#### 외래 환자 (20명/시간)
```
1F 정문 도착 (ENTRANCE)
  ↓ 1분
1F 접수 (RECEPTION) — 대기 2~5분
  ↓ 1분
2F 해당과 대기실 (WAITING) — 대기 10~30분
  ↓
2F 진료실 (CLINIC) — 진료 10~20분
  ↓ (검사 필요 시)
2F 채혈실/검사실 (LAB) — 검사 10~15분
  ↓ (영상 필요 시)
2F 영상실 (IMAGING) — 촬영 15~20분
  ↓ 결과 대기 5~10분
2F 진료실 복귀 (CLINIC) — 결과 상담 5~10분
  ↓
1F 수납 (CASHIER) — 2~5분
  ↓
1F 약국 (PHARMACY) — 5~10분
  ↓
1F 로비 퇴원 (LOBBY)
```
**총 소요: 40~90분, 평균 60분**

#### 입원 환자 (5명)
```
병동 병실 (WARD_ROOM) — 기본 위치
  ↓ 회진 시 (08:30~09:30)
병동 내 이동 (NURSE_STATION → WARD_ROOM)
  ↓ 검사 시
2F 검사실 이동 — 30분
  ↓ 복귀
병동 병실 복귀
  ↓ 급식 (12:00, 18:00)
병실 유지
  ↓ 퇴원 시
1F 수납 → 로비 퇴원
```

#### 응급 환자 (2~3명/시간)
```
1F 응급실 입구 (ER)
  ↓ 즉시
1F 트리아지 (TRIAGE) — 2~5분
  ↓
1F 응급 치료실 (ER) — 30~120분
  ↓ (입원 시)
해당 병동 이동 (WARD_ROOM)
  ↓ (퇴원 시)
1F 로비 퇴원
```

#### 수술 환자 (1~2건/일)
```
병동 (WARD_ROOM)
  ↓ 수술 30분 전
1F 수술 대기실
  ↓
1F 수술실 (SURGERY) — 60~180분
  ↓
1F 회복실 (RECOVERY) — 30~60분
  ↓
병동 복귀 (WARD_ROOM)
```

#### 의료진 동선
```
의사:
  진료실 (CLINIC) — 진료 시간 (09~12, 13~17)
  간호스테이션 (NURSE_STATION) — 차트 작성
  병동 (WARD_ROOM) — 회진
  수술실 (SURGERY) — 수술 시

간호사:
  간호스테이션 (NURSE_STATION) — 기본 위치
  병실 (WARD_ROOM) — 라운딩
  처치실 (TREATMENT_ROOM) — 처치
  
약사:
  약국 (PHARMACY) — 조제
  
검사기사:
  검사실 (LAB) — 검사 수행
```

## API 설계

### 시뮬레이터 제어

```
POST /api/v1/simulator/start
Body: {
  "speed": 10,              // 10배속 (1분 실제 = 10분 시뮬)
  "startTime": "08:00",     // 시뮬 시작 시간
  "endTime": "18:00",       // 시뮬 종료 시간
  "patientRate": 20,        // 시간당 외래 환자 수
  "emergencyRate": 3,       // 시간당 응급 환자 수
  "useExistingData": true   // 기존 seed 환자/예약 사용
}

Response:
{
  "ok": true,
  "data": {
    "sessionId": "sim-20260518-001",
    "status": "running",
    "speed": 10,
    "simulatedTime": "08:00",
    "totalEntities": 72
  }
}
```

```
GET /api/v1/simulator/status
→ 현재 시뮬레이션 상태 (시간, 환자 수, 이벤트 수)

POST /api/v1/simulator/pause
POST /api/v1/simulator/resume
POST /api/v1/simulator/stop

PATCH /api/v1/simulator/speed
Body: { "speed": 30 }  // 속도 변경

POST /api/v1/simulator/inject
Body: {
  "type": "emergency",
  "triageLevel": "LEVEL_1",
  "complaint": "급성 심근경색"
}
→ 시뮬 중 이벤트 수동 주입 (응급 환자 추가 등)
```

### 시뮬레이터 → 기존 API 연동

시뮬레이터는 기존 HIS API를 **내부 호출**하여 데이터를 생성합니다:

```
시뮬레이터 타이머
  ↓ (가속 시간에 따라)
WaitingQueueService.addToQueue()     → RECEPTION_CHECKIN 이벤트
EncounterService.create()            → ENCOUNTER_START 이벤트
EncounterService.sign()              → ENCOUNTER_SIGNED 이벤트
EmergencyService.createTriage()      → ER_ARRIVAL + ER_TRIAGE 이벤트
InpatientService.discharge()         → DISCHARGE 이벤트
SurgeryService.start()               → SURGERY_START 이벤트
  ↓ (자동)
JourneyService.emit()                → PatientJourneyEvent 저장
  ↓ (자동)
PatientLocation 갱신                  → /api/floor/entities 반영
```

## 시뮬레이터 엔진 구조

```typescript
// SimulatorService
class SimulatorService {
  private timer: NodeJS.Timeout;
  private simTime: Date;        // 시뮬레이션 내 현재 시간
  private speed: number;        // 배속
  private entities: Map<string, SimEntity>;  // 활성 엔티티

  // 1초마다 실행 (실제 1초 = speed분 시뮬)
  tick() {
    this.simTime += speed * 60000;
    
    // 예약 환자 도착 체크
    this.checkAppointmentArrivals();
    
    // 랜덤 당일접수 환자 생성
    this.generateWalkInPatients();
    
    // 응급 환자 랜덤 생성
    this.generateEmergencyPatients();
    
    // 각 엔티티 상태 진행
    for (const entity of this.entities.values()) {
      this.advanceEntity(entity);
    }
    
    // 의료진 스케줄 업데이트
    this.updateStaffLocations();
  }

  // 엔티티 상태 머신
  advanceEntity(entity: SimEntity) {
    if (entity.waitUntil > this.simTime) return; // 아직 대기 중
    
    switch (entity.currentStep) {
      case 'ARRIVED':
        → emit RECEPTION_CHECKIN, move to RECEPTION
        → set waitUntil = +random(2,5)min
        → next step: CHECKED_IN
        
      case 'CHECKED_IN':
        → move to WAITING (해당 과)
        → set waitUntil = +random(10,30)min
        → next step: WAITING
        
      case 'WAITING':
        → 진료실 빈 자리 확인
        → 있으면: emit ENCOUNTER_START, move to CLINIC
        → 없으면: 대기 계속
        → next step: IN_CONSULTATION
        
      case 'IN_CONSULTATION':
        → set waitUntil = +random(10,20)min
        → 30% 확률로 검사 필요 → next: TO_LAB
        → 20% 확률로 영상 필요 → next: TO_IMAGING
        → 50% 진료 완료 → next: TO_CASHIER
        
      case 'TO_LAB':
        → emit ORDER_CREATED, move to LAB
        → set waitUntil = +random(10,15)min
        → next: LAB_DONE
        
      case 'LAB_DONE':
        → emit LAB_RESULT, move back to CLINIC
        → set waitUntil = +random(5,10)min (결과 상담)
        → next: TO_CASHIER
        
      case 'TO_CASHIER':
        → emit ENCOUNTER_SIGNED, move to CASHIER
        → set waitUntil = +random(2,5)min
        → next: TO_PHARMACY
        
      case 'TO_PHARMACY':
        → emit BILLING_PAID, move to PHARMACY
        → set waitUntil = +random(5,10)min
        → next: DISCHARGED
        
      case 'DISCHARGED':
        → move to LOBBY
        → remove from entities
    }
  }
}
```

## 엔티티 유형

```typescript
interface SimEntity {
  id: string;
  patientId: string;        // DB 환자 ID
  type: 'OUTPATIENT' | 'INPATIENT' | 'EMERGENCY' | 'STAFF';
  name: string;
  department: string;
  currentStep: string;       // 현재 상태 머신 단계
  currentZoneCode: string;   // 현재 위치 SpaceNode code
  waitUntil: Date;           // 이 시간까지 현재 위치 유지
  schedule: SimStep[];       // 남은 일정 (입원/수술 등)
  metadata: any;
}

interface SimStep {
  step: string;
  zoneCode: string;
  durationMin: [number, number]; // [min, max] 랜덤
  nextStep: string;
  probability?: number;          // 다음 단계 확률
}
```

## 시뮬레이션 파라미터

| 파라미터 | 기본값 | 설명 |
|---------|-------|------|
| speed | 10 | 배속 (1초 실제 = N분 시뮬) |
| patientRate | 20 | 시간당 외래 환자 수 |
| emergencyRate | 3 | 시간당 응급 환자 수 |
| labProbability | 0.3 | 진료 후 검사 확률 |
| imagingProbability | 0.2 | 진료 후 영상 확률 |
| consultDuration | [10, 20] | 진료 시간 (분, min~max) |
| waitDuration | [10, 30] | 대기 시간 (분, min~max) |
| labDuration | [10, 15] | 검사 시간 (분) |
| surgeryDuration | [60, 180] | 수술 시간 (분) |
| roundDuration | [5, 10] | 회진 시간 (분/환자) |

## 의료진 시뮬레이션

### 의사 스케줄
```
08:00~08:30  출근 → 진료실 이동
08:30~09:00  입원 환자 회진 (병동 순회)
09:00~12:00  오전 진료 (진료실)
12:00~13:00  점심 (사라짐)
13:00~17:00  오후 진료 (진료실)
             수술 예정 시 → 수술실 이동
17:00~18:00  차트 정리 (간호스테이션)
```

### 간호사 스케줄
```
병동 간호사: 간호스테이션 ↔ 병실 순환 (30분 간격)
외래 간호사: 대기실 → 진료실 보조 → 대기실
응급 간호사: 응급실 상주
```

## 구현 단계

### Phase 1: 기본 엔진 + 외래 시뮬
1. SimulatorService (타이머, 엔티티 관리)
2. 외래 환자 상태 머신 (도착→접수→대기→진료→수납→퇴원)
3. 기존 seed 예약 데이터 기반 환자 생성
4. POST /simulator/start, /stop, /status API
5. JourneyService.emit() → PatientLocation 자동 갱신 확인

### Phase 2: 응급 + 입원 + 수술
6. 응급 환자 랜덤 생성 (KTAS 분포)
7. 입원 환자 회진/검사/퇴원 시뮬
8. 수술 시뮬 (대기→수술→회복→병동)
9. 속도 변경, 일시정지/재개

### Phase 3: 의료진 + 고도화
10. 의사/간호사 위치 시뮬
11. 이벤트 수동 주입 (inject)
12. 시뮬 결과 리포트 (총 환자 수, 평균 대기시간, 병목 구역)
