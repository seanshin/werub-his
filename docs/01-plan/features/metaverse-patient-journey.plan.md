# 메타버스 환자 동선 데이터 API 기획서

## 개요

HIS는 환자의 접수부터 퇴원까지 전 과정의 위치/상태/동선 데이터를 수집·관리하고, **외부 메타버스 뷰어에 API로 제공**합니다. 화면 구성은 별도 프로젝트에서 처리하며, HIS는 데이터 레이어만 담당합니다.

```
┌─────────────┐     API (REST/SSE)     ┌──────────────────┐
│  HIS (API)  │ ──────────────────────→ │  메타버스 뷰어    │
│             │                         │  (별도 프로젝트)   │
│ - 병원 구조  │  GET /metaverse/...     │  - 3D 렌더링      │
│ - 환자 위치  │  SSE /metaverse/stream  │  - 동선 애니메이션 │
│ - 동선 이력  │                         │  - 히트맵         │
│ - 실시간 현황 │                         │  - VR/AR         │
└─────────────┘                         └──────────────────┘
```

## 데이터 범위

HIS가 제공하는 전체 환자 여정 데이터:

```
접수 대기 → 접수 → 진료 대기 → 진료 → 처방 → 검사/영상 → 결과 확인 →
수납 → 약국 → 퇴원
                  ↓ (입원 시)
            입원 → 병실 배정 → 회진 → 검사 → 수술 → 간호 → 퇴원
                  ↓ (응급 시)
            ER 도착 → 트리아지 → 응급 치료 → 입원/퇴원/전원
```

## DB 스키마

### HospitalZone (병원 공간 정보)

```prisma
model HospitalZone {
  id          String  @id @default(uuid()) @db.Uuid
  name        String  @db.VarChar(100)       // "내과 1진료실"
  floor       Int                             // 층
  zoneType    String  @db.VarChar(30)         // LOBBY, RECEPTION, CLINIC, WAITING, LAB, IMAGING, PHARMACY, CASHIER, WARD, SURGERY, ER, ICU, ELEVATOR
  department  String? @db.VarChar(50)         // "내과", "외과"
  wardId      String? @db.Uuid               // Ward 연결 (병동일 때)
  roomNumber  String? @db.VarChar(20)        // "301", "OR-1"
  capacity    Int?                            // 수용 인원
  coordinates Json?   @db.JsonB               // { x, y, width, height } 평면도 좌표
  adjacentTo  Json?   @db.JsonB               // ["zone-id-1", "zone-id-2"] 인접 구역
  sortOrder   Int     @default(0)
  isActive    Boolean @default(true)
  metadata    Json?   @db.JsonB               // 추가 속성 (장비, 색상, 아이콘 등)
  createdAt   DateTime @default(now()) @db.Timestamptz()
  updatedAt   DateTime @updatedAt @db.Timestamptz()

  @@index([floor])
  @@index([zoneType])
  @@map("hospital_zones")
}
```

### PatientLocation (환자 위치 이력)

```prisma
model PatientLocation {
  id         String    @id @default(uuid()) @db.Uuid
  patientId  String    @db.Uuid
  zoneId     String    @db.Uuid
  status     String    @db.VarChar(30)        // MOVING, WAITING, IN_CONSULTATION, IN_LAB, IN_IMAGING, IN_SURGERY, RESTING, DISCHARGED
  enteredAt  DateTime  @default(now()) @db.Timestamptz()
  leftAt     DateTime? @db.Timestamptz()
  duration   Int?                             // 체류 시간 (분, leftAt 설정 시 계산)
  eventType  String?   @db.VarChar(50)        // JourneyEvent 타입
  eventId    String?   @db.Uuid               // PatientJourneyEvent 연결
  metadata   Json?     @db.JsonB

  @@index([patientId])
  @@index([zoneId])
  @@index([enteredAt])
  @@map("patient_locations")
}
```

## 이벤트→위치 자동 매핑

JourneyService.emit() 호출 시 PatientLocation이 자동 업데이트됩니다:

| Journey 이벤트 | 추정 위치 (zoneType) | 상태 (status) |
|---------------|--------------------|----|
| RECEPTION_CHECKIN | RECEPTION (1F 접수) | WAITING |
| RECEPTION_CALLED | WAITING (해당과 대기실) | WAITING |
| ENCOUNTER_START | CLINIC (해당 진료실) | IN_CONSULTATION |
| ENCOUNTER_SIGNED | CLINIC → CASHIER 이동 | MOVING |
| PRESCRIPTION_ADDED | CLINIC | IN_CONSULTATION |
| ORDER_CREATED (LAB) | LAB (검사실) | IN_LAB |
| ORDER_CREATED (IMAGING) | IMAGING (영상실) | IN_IMAGING |
| LAB_RESULT | LAB → CLINIC 복귀 | MOVING |
| IMAGING_RESULT | IMAGING → CLINIC 복귀 | MOVING |
| BILLING_CREATED | CASHIER (수납) | WAITING |
| BILLING_PAID | PHARMACY (약국) | WAITING |
| ADMISSION | WARD (해당 병실) | RESTING |
| BED_TRANSFER | WARD → WARD 이동 | MOVING → RESTING |
| ROUND | WARD (병실) | RESTING |
| SURGERY_START | SURGERY (수술실) | IN_SURGERY |
| SURGERY_COMPLETE | SURGERY → WARD 복귀 | MOVING → RESTING |
| ER_ARRIVAL | ER (응급실) | WAITING |
| ER_TRIAGE | ER | IN_CONSULTATION |
| ER_TREATMENT_START | ER | IN_CONSULTATION |
| ER_DISPOSITION | ER → (입원/퇴원/전원) | MOVING |
| DISCHARGE | LOBBY (1F 로비) | DISCHARGED |

## API 설계

### 1. 병원 구조 (Hospital Structure)

```
GET /api/v1/metaverse/structure
```
전체 병원 구조를 한 번에 반환. 메타버스 뷰어 초기화 시 호출.

```json
{
  "data": {
    "hospitalName": "Hospital RUN",
    "floors": [
      {
        "floor": 1,
        "name": "1층 로비/응급",
        "zones": [
          { "id": "z1", "name": "로비", "zoneType": "LOBBY", "coordinates": { "x": 0, "y": 0, "w": 200, "h": 100 }, "capacity": 50 },
          { "id": "z2", "name": "접수", "zoneType": "RECEPTION", "coordinates": { "x": 200, "y": 0, "w": 80, "h": 60 }, "capacity": 4 },
          { "id": "z3", "name": "응급실", "zoneType": "ER", "coordinates": { "x": 300, "y": 0, "w": 200, "h": 150 }, "capacity": 20 },
          { "id": "z4", "name": "수술실 1", "zoneType": "SURGERY", "roomNumber": "OR-1", "coordinates": { "x": 500, "y": 0, "w": 100, "h": 100 } },
          { "id": "z5", "name": "수술실 2", "zoneType": "SURGERY", "roomNumber": "OR-2", "coordinates": { "x": 500, "y": 100, "w": 100, "h": 100 } },
          { "id": "z6", "name": "ICU", "zoneType": "ICU", "coordinates": { "x": 600, "y": 0, "w": 150, "h": 100 }, "capacity": 6 }
        ]
      },
      {
        "floor": 2,
        "name": "2층 외래",
        "zones": [
          { "id": "z10", "name": "내과 대기실", "zoneType": "WAITING", "department": "내과", "capacity": 30 },
          { "id": "z11", "name": "내과 1진료실", "zoneType": "CLINIC", "department": "내과", "roomNumber": "201" },
          { "id": "z12", "name": "내과 2진료실", "zoneType": "CLINIC", "department": "내과", "roomNumber": "202" },
          { "id": "z13", "name": "외과 1진료실", "zoneType": "CLINIC", "department": "외과", "roomNumber": "203" },
          { "id": "z14", "name": "검사실", "zoneType": "LAB", "capacity": 10 },
          { "id": "z15", "name": "영상실", "zoneType": "IMAGING", "capacity": 5 },
          { "id": "z16", "name": "약국", "zoneType": "PHARMACY", "capacity": 5 },
          { "id": "z17", "name": "수납", "zoneType": "CASHIER", "capacity": 4 }
        ]
      },
      {
        "floor": 3, "name": "3층 내과병동",
        "zones": [
          { "id": "z20", "name": "간호스테이션", "zoneType": "WARD", "department": "내과" },
          { "id": "z21", "name": "301-A", "zoneType": "WARD", "roomNumber": "301", "capacity": 1 },
          { "id": "z22", "name": "301-B", "zoneType": "WARD", "roomNumber": "301", "capacity": 1 }
        ]
      }
    ]
  }
}
```

### 2. 전체 환자 실시간 위치

```
GET /api/v1/metaverse/patients/active
```
현재 병원 내 모든 활성 환자의 위치와 상태. 폴링(10초) 또는 SSE로 사용.

```json
{
  "data": {
    "timestamp": "2026-05-18T10:30:00Z",
    "patients": [
      {
        "patientId": "uuid",
        "mrn": "P2026-0001",
        "name": "김영수",
        "gender": "MALE",
        "age": 68,
        "currentZone": {
          "zoneId": "z21",
          "zoneName": "301-A",
          "zoneType": "WARD",
          "floor": 3
        },
        "status": "RESTING",
        "category": "INPATIENT",
        "severity": "INFO",
        "stayMinutes": 480,
        "lastEvent": { "type": "ROUND", "title": "회진", "at": "2026-05-18T09:00:00Z" },
        "admitInfo": { "days": 8, "doctor": "김내과", "diagnosis": "고혈압 급성 악화" }
      },
      {
        "patientId": "uuid",
        "mrn": "P2026-0009",
        "name": "조건우",
        "gender": "MALE",
        "age": 47,
        "currentZone": { "zoneId": "z3", "zoneName": "응급실", "zoneType": "ER", "floor": 1 },
        "status": "IN_CONSULTATION",
        "category": "EMERGENCY",
        "severity": "CRITICAL",
        "stayMinutes": 15,
        "lastEvent": { "type": "ER_TRIAGE", "title": "KTAS 1급", "at": "2026-05-18T10:15:00Z" },
        "triageInfo": { "level": "LEVEL_1", "complaint": "급성 심근경색 의심" }
      },
      {
        "patientId": "uuid",
        "mrn": "P2026-0002",
        "name": "이미숙",
        "gender": "FEMALE",
        "age": 60,
        "currentZone": { "zoneId": "z11", "zoneName": "내과 1진료실", "zoneType": "CLINIC", "floor": 2 },
        "status": "IN_CONSULTATION",
        "category": "OUTPATIENT",
        "severity": "INFO",
        "stayMinutes": 10,
        "lastEvent": { "type": "ENCOUNTER_START", "title": "진료 시작", "at": "2026-05-18T10:20:00Z" }
      }
    ],
    "summary": {
      "total": 45,
      "byCategory": { "OUTPATIENT": 15, "INPATIENT": 12, "EMERGENCY": 8, "SURGERY": 2, "ICU": 3, "WAITING": 5 },
      "byFloor": { "1": 12, "2": 18, "3": 5, "4": 4, "5": 3, "6": 3 },
      "byStatus": { "WAITING": 12, "IN_CONSULTATION": 5, "IN_LAB": 3, "RESTING": 15, "IN_SURGERY": 2, "MOVING": 8 }
    }
  }
}
```

### 3. 개별 환자 동선 이력

```
GET /api/v1/metaverse/patient/:patientId/trail?date=2026-05-18
```
특정 환자의 하루 동선 전체.

```json
{
  "data": {
    "patient": { "id": "uuid", "name": "이미숙", "mrn": "P2026-0002" },
    "date": "2026-05-18",
    "trail": [
      { "seq": 1, "time": "09:00", "zoneId": "z2", "zoneName": "접수", "floor": 1, "zoneType": "RECEPTION", "status": "WAITING", "duration": 3, "event": "RECEPTION_CHECKIN" },
      { "seq": 2, "time": "09:03", "zoneId": "z10", "zoneName": "내과 대기실", "floor": 2, "zoneType": "WAITING", "status": "WAITING", "duration": 17, "event": "RECEPTION_CALLED" },
      { "seq": 3, "time": "09:20", "zoneId": "z11", "zoneName": "내과 1진료실", "floor": 2, "zoneType": "CLINIC", "status": "IN_CONSULTATION", "duration": 20, "event": "ENCOUNTER_START" },
      { "seq": 4, "time": "09:40", "zoneId": "z14", "zoneName": "검사실", "floor": 2, "zoneType": "LAB", "status": "IN_LAB", "duration": 15, "event": "ORDER_CREATED" },
      { "seq": 5, "time": "09:55", "zoneId": "z15", "zoneName": "영상실", "floor": 2, "zoneType": "IMAGING", "status": "IN_IMAGING", "duration": 20, "event": "ORDER_CREATED" },
      { "seq": 6, "time": "10:15", "zoneId": "z11", "zoneName": "내과 1진료실", "floor": 2, "zoneType": "CLINIC", "status": "IN_CONSULTATION", "duration": 10, "event": "LAB_RESULT" },
      { "seq": 7, "time": "10:25", "zoneId": "z17", "zoneName": "수납", "floor": 2, "zoneType": "CASHIER", "status": "WAITING", "duration": 5, "event": "ENCOUNTER_SIGNED" },
      { "seq": 8, "time": "10:30", "zoneId": "z16", "zoneName": "약국", "floor": 2, "zoneType": "PHARMACY", "status": "WAITING", "duration": 10, "event": "BILLING_PAID" },
      { "seq": 9, "time": "10:40", "zoneId": "z1", "zoneName": "로비", "floor": 1, "zoneType": "LOBBY", "status": "DISCHARGED", "duration": 0, "event": "DISCHARGE" }
    ],
    "stats": {
      "totalDuration": 100,
      "waitingTime": 25,
      "consultationTime": 30,
      "labTime": 35,
      "movingTime": 10,
      "floorsVisited": [1, 2],
      "zonesVisited": 8
    }
  }
}
```

### 4. 개별 환자 현재 위치

```
GET /api/v1/metaverse/patient/:patientId/location
```

```json
{
  "data": {
    "patientId": "uuid",
    "name": "김영수",
    "mrn": "P2026-0001",
    "currentZone": { "zoneId": "z21", "zoneName": "301-A", "zoneType": "WARD", "floor": 3 },
    "status": "RESTING",
    "enteredAt": "2026-05-10T14:00:00Z",
    "stayMinutes": 11430,
    "lastEvent": { "type": "ROUND", "title": "회진", "at": "2026-05-18T09:00:00Z" },
    "nextScheduled": { "type": "LAB", "title": "추적 혈액검사", "at": "2026-05-18T14:00:00Z" }
  }
}
```

### 5. 구역별 현황

```
GET /api/v1/metaverse/zones/status
```
각 구역의 현재 점유 상태. 히트맵 데이터로 활용.

```json
{
  "data": {
    "timestamp": "2026-05-18T10:30:00Z",
    "zones": [
      { "zoneId": "z3", "zoneName": "응급실", "floor": 1, "zoneType": "ER", "currentCount": 8, "capacity": 20, "occupancy": 0.4, "avgWaitMinutes": 25 },
      { "zoneId": "z10", "zoneName": "내과 대기실", "floor": 2, "zoneType": "WAITING", "currentCount": 12, "capacity": 30, "occupancy": 0.4, "avgWaitMinutes": 18 },
      { "zoneId": "z14", "zoneName": "검사실", "floor": 2, "zoneType": "LAB", "currentCount": 5, "capacity": 10, "occupancy": 0.5, "avgWaitMinutes": 15 },
      { "zoneId": "z4", "zoneName": "수술실 1", "floor": 1, "zoneType": "SURGERY", "currentCount": 1, "capacity": 1, "occupancy": 1.0, "inUse": true }
    ]
  }
}
```

### 6. 실시간 이벤트 스트림 (SSE)

```
GET /api/v1/metaverse/stream
Accept: text/event-stream
```
환자 위치 변경 시 즉시 이벤트 전송. 메타버스 뷰어가 구독.

```
event: patient-moved
data: {"patientId":"uuid","from":{"zoneId":"z10","floor":2},"to":{"zoneId":"z11","floor":2},"status":"IN_CONSULTATION","event":"ENCOUNTER_START","at":"2026-05-18T10:20:00Z"}

event: patient-moved
data: {"patientId":"uuid","from":{"zoneId":"z3","floor":1},"to":{"zoneId":"z21","floor":3},"status":"RESTING","event":"ADMISSION","at":"2026-05-18T10:25:00Z"}

event: zone-updated
data: {"zoneId":"z3","currentCount":7,"occupancy":0.35}

event: alert
data: {"patientId":"uuid","type":"CRITICAL","message":"KTAS 1급 환자 응급실 도착","zoneId":"z3"}
```

### 7. 구역 관리 (관리자)

```
GET    /api/v1/metaverse/zones              — 전체 구역 목록
POST   /api/v1/metaverse/zones              — 구역 추가
PUT    /api/v1/metaverse/zones/:id          — 구역 수정 (좌표, 이름 등)
DELETE /api/v1/metaverse/zones/:id          — 구역 삭제
POST   /api/v1/metaverse/zones/bulk-import  — 구역 일괄 등록 (JSON)
```

## API 요약

| Method | Endpoint | 용도 | 인증 |
|--------|----------|------|------|
| GET | /metaverse/structure | 병원 전체 구조 (초기 로드) | Bearer |
| GET | /metaverse/patients/active | 전체 환자 실시간 위치 | Bearer |
| GET | /metaverse/patient/:id/trail | 개별 환자 동선 이력 | Bearer |
| GET | /metaverse/patient/:id/location | 개별 환자 현재 위치 | Bearer |
| GET | /metaverse/zones/status | 구역별 점유 현황 | Bearer |
| GET | /metaverse/stream | SSE 실시간 스트림 | Bearer |
| CRUD | /metaverse/zones | 구역 관리 (관리자) | Bearer+ADMIN |

## 외부 뷰어 연동 가이드

### 인증
```
Authorization: Bearer {HIS_ACCESS_TOKEN}
```
SSO 또는 별도 API 키 방식. 메타버스 뷰어에서 HIS 로그인 후 토큰을 받아 사용.

### 초기화 순서
```
1. GET /metaverse/structure → 병원 구조 로드
2. GET /metaverse/patients/active → 초기 환자 위치
3. GET /metaverse/zones/status → 구역 점유 현황
4. SSE /metaverse/stream 구독 → 실시간 변경 수신
```

### 동선 재생
```
1. GET /metaverse/patient/:id/trail?date=YYYY-MM-DD
2. trail 배열을 시간순으로 재생
3. 각 seq의 zoneId 좌표로 마커 이동 + duration만큼 대기
```

## 구현 단계

### Phase 1: 스키마 + 핵심 API
1. HospitalZone, PatientLocation 테이블 생성
2. 병원 구역 seed 데이터 (1~6층)
3. JourneyService → PatientLocation 자동 매핑 로직
4. GET /structure, GET /patients/active, GET /patient/:id/trail API
5. GET /patient/:id/location, GET /zones/status API

### Phase 2: 실시간 + 관리
6. SSE /metaverse/stream 엔드포인트
7. 구역 관리 CRUD API
8. 구역 일괄 등록 (bulk-import)

### Phase 3: 고도화
9. 히트맵 시간대별 통계 API
10. 병목 분석 API (대기 시간 긴 구역)
11. 환자 예상 동선 (다음 이동 예측)
12. 외부 뷰어용 API 키 발급 시스템
