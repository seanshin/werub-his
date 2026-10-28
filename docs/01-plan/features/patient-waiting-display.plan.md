# 환자 대기 안내 시스템 — HIS 측 API 제공 기획

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/src/modules/waiting-queue/display-key-stream.guard.ts · apps/api/src/modules/waiting-queue/waiting-queue.module.ts:8 · 잔여: Webhook 호출 알림(DisplayWebhookLog)(CLI — 필요성 미확인) — 2026-09-14 grep 0 재확인

> **Feature**: patient-waiting-display
> **Created**: 2026-05-08
> **Status**: Draft
> **Priority**: High

---

## 1. 개요

**환자 대기 안내 시스템은 별도 독립 시스템**이며, Hospital RUN HIS와 **REST API로 연동**된다.
Hospital RUN은 대기 데이터를 제공하는 **API Provider** 역할에 집중하고,
디스플레이 UI·TTS·키오스크 등은 외부 대기 안내 시스템이 자체 구현한다.

### 1.1 시스템 경계

```
┌─ Hospital RUN (HIS) ─────────────────────────────────────────┐
│                                                               │
│  접수 데스크 ──▶ WaitingQueue ◀── 의사 대시보드               │
│  AI 접수 ──────▶  Service    ◀── 진료 차트                   │
│                       │                                       │
│              ┌────────▼────────┐                              │
│              │  Queue Public   │                              │
│              │  REST API       │                              │
│              │  (JWT 불필요)    │                              │
│              └────────┬────────┘                              │
│                       │                                       │
└───────────────────────┼───────────────────────────────────────┘
                        │ HTTPS REST API
          ┌─────────────┼─────────────────┐
          ▼             ▼                 ▼
┌─────────────┐ ┌─────────────┐  ┌──────────────┐
│ 대기 안내    │ │ 번호표      │  │ 환자 모바일   │
│ 디스플레이   │ │ 키오스크    │  │ 대기 확인     │
│ (별도 시스템) │ │ (별도 시스템) │  │ (별도 시스템)  │
└─────────────┘ └─────────────┘  └──────────────┘
   TV/모니터        프린터/태블릿      스마트폰 웹
```

### 1.2 역할 분담

| 구분 | Hospital RUN (HIS) | 대기 안내 시스템 (외부) |
|------|-------------------|----------------------|
| **접수/체크인** | ✅ 담당 | — |
| **대기번호 채번** | ✅ 담당 (queueNumber) | — |
| **환자 호출** | ✅ 담당 (call API) | — |
| **상태 전환** | ✅ 담당 (WAITING→CALLED→진료중→완료) | — |
| **대기 데이터 API** | ✅ 제공 | 소비 (Polling/SSE) |
| **호출 이벤트 API** | ✅ 제공 | 소비 → TTS/배너 |
| **번호표 데이터 API** | ✅ 제공 | 소비 → 프린트/QR |
| **디스플레이 UI** | — | ✅ 자체 구현 |
| **TTS 음성 호출** | — | ✅ 자체 구현 |
| **번호표 프린트** | — | ✅ 자체 구현 |
| **모바일 대기 화면** | — | ✅ 자체 구현 |
| **키오스크 UI** | — | ✅ 자체 구현 |

### 1.3 현재 상태 (AS-IS)

| 구분 | 상태 |
|------|------|
| WaitingQueue 모델 | ✅ 구현 완료 (queueNumber, status, calledAt 등) |
| 접수 데스크 (reception) | ✅ 체크인/호출/상태전환 기능 |
| 의사 대시보드 | ✅ 내 대기환자 위젯 (호출/진료시작) |
| 내부 Queue API (JWT 필요) | ✅ CRUD + 상태전환 |
| **Public Display API** | ❌ 미구현 |
| **번호표/토큰 API** | ❌ 미구현 |
| **SSE 실시간 스트림** | ❌ 미구현 |
| **Webhook 호출 알림** | ❌ 미구현 |

---

## 2. Hospital RUN 제공 API 설계

### 2.1 API 개요

외부 대기 안내 시스템이 소비하는 **공개 API** (JWT 불필요, API Key 인증).

```
Base URL: https://his.example.org/api/v1/queue/public

인증: X-Display-Key 헤더 (API Key 기반, 병원 단위 발급)
CORS: 대기 안내 시스템 도메인 허용
Rate Limit: 60 req/min per key
```

### 2.2 API 엔드포인트 목록

| Method | Path | 용도 | 실시간성 |
|--------|------|------|----------|
| `GET` | `/display` | 과별 대기 현황 전체 조회 | Polling 5초 |
| `GET` | `/display/stream` | SSE 실시간 스트림 | 실시간 Push |
| `GET` | `/display/call-events` | 최근 호출 이벤트 목록 | Polling 3초 |
| `GET` | `/ticket/:queueId` | 대기번호표 데이터 | 1회 |
| `GET` | `/waiting/:token` | 환자 개별 대기 상태 | Polling 10초 |
| `GET` | `/stats` | 과별 통계 (대기인원, 평균시간) | Polling 30초 |
| `GET` | `/departments` | 오늘 운영중인 진료과 목록 | Polling 5분 |

---

### 2.3 상세 API 명세

#### (1) 과별 대기 현황 — `GET /display`

대기 안내 디스플레이의 메인 데이터. 과별로 그룹핑된 대기 목록 반환.

```
GET /api/v1/queue/public/display
    ?departments=내과,외과           # 과 필터 (쉼표 구분, 생략 시 전체)
    &statuses=WAITING,CALLED        # 상태 필터 (기본: WAITING,CALLED,IN_CONSULTATION)
    &limit=20                       # 과별 최대 건수 (기본: 20)

Headers:
    X-Display-Key: {api-key}

Response 200:
{
  "data": {
    "departments": [
      {
        "name": "내과",
        "queues": [
          {
            "queueNumber": 23,
            "status": "CALLED",
            "patientName": "김○수",         // 마스킹 처리됨
            "roomName": "진료실 3",
            "doctorName": "이○희",           // 마스킹
            "type": "WALK_IN",
            "visitType": "FOLLOW_UP",
            "checkedInAt": "2026-05-08T09:00:00Z",
            "calledAt": "2026-05-08T09:15:00Z",
            "waitMinutes": 15,
            "callCount": 1
          },
          {
            "queueNumber": 24,
            "status": "WAITING",
            "patientName": "박○영",
            "roomName": "진료실 3",
            "doctorName": "이○희",
            "type": "APPOINTMENT",
            "visitType": "INITIAL",
            "checkedInAt": "2026-05-08T09:05:00Z",
            "calledAt": null,
            "waitMinutes": 20,
            "callCount": 0
          }
        ],
        "stats": {
          "waiting": 5,
          "called": 1,
          "inConsultation": 2,
          "completed": 12,
          "avgWaitMinutes": 18
        }
      }
    ],
    "lastCall": {
      "departmentName": "내과",
      "queueNumber": 23,
      "patientName": "김○수",
      "roomName": "진료실 3",
      "calledAt": "2026-05-08T09:15:00Z",
      "ttsText": "내과 23번 김○수님, 3번 진료실로 오세요"
    },
    "timestamp": "2026-05-08T09:15:05Z"
  }
}
```

#### (2) SSE 실시간 스트림 — `GET /display/stream`

호출·상태변경 즉시 Push. 디스플레이가 Long-lived 연결 유지.

```
GET /api/v1/queue/public/display/stream
    ?departments=내과,외과

Headers:
    X-Display-Key: {api-key}
    Accept: text/event-stream

Response: text/event-stream

--- 이벤트 종류 ---

event: queue_update
data: {
  "type": "CALLED",                       // CHECKED_IN, CALLED, STARTED, COMPLETED, CANCELLED
  "departmentName": "내과",
  "queueNumber": 23,
  "patientName": "김○수",
  "roomName": "진료실 3",
  "calledAt": "2026-05-08T09:15:00Z",
  "ttsText": "내과 23번 김○수님, 3번 진료실로 오세요",
  "callCount": 1
}

event: queue_update
data: {
  "type": "CHECKED_IN",                   // 신규 접수
  "departmentName": "외과",
  "queueNumber": 12,
  "patientName": "이○수",
  "status": "WAITING"
}

event: stats_update
data: {
  "departments": [
    { "name": "내과", "waiting": 5, "called": 1, "avgWaitMinutes": 18 },
    { "name": "외과", "waiting": 3, "called": 0, "avgWaitMinutes": 12 }
  ]
}

event: heartbeat
data: { "timestamp": "2026-05-08T09:15:30Z" }
```

#### (3) 최근 호출 이벤트 — `GET /display/call-events`

SSE 미사용 시 Polling으로 최근 호출 확인. 디스플레이의 TTS/배너 트리거용.

```
GET /api/v1/queue/public/display/call-events
    ?since=2026-05-08T09:10:00Z         # 이 시각 이후 호출만
    &departments=내과,외과

Response 200:
{
  "data": {
    "events": [
      {
        "eventType": "CALLED",
        "departmentName": "내과",
        "queueNumber": 23,
        "patientName": "김○수",
        "roomName": "진료실 3",
        "calledAt": "2026-05-08T09:15:00Z",
        "callCount": 1,
        "ttsText": "내과 23번 김○수님, 3번 진료실로 오세요"
      },
      {
        "eventType": "CALLED",
        "departmentName": "외과",
        "queueNumber": 8,
        "patientName": "박○진",
        "roomName": "진료실 5",
        "calledAt": "2026-05-08T09:12:00Z",
        "callCount": 2,
        "ttsText": "외과 8번 박○진님, 5번 진료실로 오세요 (재호출)"
      }
    ],
    "serverTime": "2026-05-08T09:15:05Z"
  }
}
```

#### (4) 대기번호표 데이터 — `GET /ticket/:queueId`

접수(check-in) 완료 후 번호표 출력에 필요한 데이터.

```
GET /api/v1/queue/public/ticket/{queueId}

Response 200:
{
  "data": {
    "queueId": "uuid-...",
    "queueNumber": 23,
    "departmentName": "내과",
    "doctorName": "이영희",               // 번호표는 마스킹 없음 (본인용)
    "roomName": "진료실 3",
    "patientName": "김영수",              // 본인용이므로 풀네임
    "type": "WALK_IN",
    "visitType": "FOLLOW_UP",
    "checkedInAt": "2026-05-08T09:00:00Z",
    "waitingAhead": 3,
    "estimatedWaitMinutes": 15,
    "waitingToken": "CHANGE_ME",    // 모바일 대기확인용 토큰
    "waitingUrl": "https://his.example.org/api/v1/queue/public/waiting/abc123def456",
    "hospitalName": "Hospital RUN",
    "notice": "3회 호출 후 미응답 시 접수가 취소됩니다"
  }
}
```

#### (5) 환자 개별 대기 확인 — `GET /waiting/:token`

QR 스캔 → 환자가 자신의 대기 상태를 확인. 토큰 기반 (JWT 불필요).

```
GET /api/v1/queue/public/waiting/{waitingToken}

Response 200:
{
  "data": {
    "queueNumber": 23,
    "departmentName": "내과",
    "roomName": "진료실 3",
    "status": "WAITING",
    "waitingAhead": 2,
    "estimatedWaitMinutes": 10,
    "checkedInAt": "2026-05-08T09:00:00Z",
    "calledAt": null,
    "callCount": 0,
    "type": "WALK_IN",
    "visitType": "FOLLOW_UP",
    "statusFlow": [
      { "step": "checked_in", "label": "접수 완료", "at": "2026-05-08T09:00:00Z", "done": true },
      { "step": "waiting", "label": "대기중", "at": null, "done": true, "current": true },
      { "step": "called", "label": "호출", "at": null, "done": false },
      { "step": "consultation", "label": "진료", "at": null, "done": false }
    ]
  }
}

Response 404 (만료/무효):
{
  "error": { "code": "QUEUE_NOT_FOUND", "message": "대기 정보를 찾을 수 없습니다." }
}
```

#### (6) 과별 통계 — `GET /stats`

```
GET /api/v1/queue/public/stats
    ?departments=내과,외과

Response 200:
{
  "data": {
    "departments": [
      {
        "name": "내과",
        "waiting": 5,
        "called": 1,
        "inConsultation": 2,
        "completedToday": 28,
        "avgWaitMinutes": 18,
        "maxWaitMinutes": 35,
        "doctors": [
          { "name": "이○희", "roomName": "진료실 3", "waiting": 3, "status": "진료중" },
          { "name": "김○호", "roomName": "진료실 4", "waiting": 2, "status": "진료중" }
        ]
      }
    ],
    "total": {
      "waiting": 12,
      "called": 3,
      "inConsultation": 6,
      "completedToday": 85
    },
    "timestamp": "2026-05-08T09:15:00Z"
  }
}
```

#### (7) 운영중 진료과 — `GET /departments`

```
GET /api/v1/queue/public/departments

Response 200:
{
  "data": {
    "departments": [
      {
        "name": "내과",
        "doctors": [
          { "name": "이○희", "roomName": "진료실 3", "period": "ALL", "startTime": "09:00", "endTime": "17:00" }
        ],
        "isOpen": true
      },
      {
        "name": "외과",
        "doctors": [...],
        "isOpen": true
      }
    ],
    "date": "2026-05-08",
    "dayOfWeek": "THURSDAY"
  }
}
```

---

### 2.4 Webhook (선택 — 양방향 연동)

대기 안내 시스템이 Webhook 수신 서버를 운영할 경우, HIS에서 이벤트를 Push.

```
Hospital RUN 관리자 설정:
  Webhook URL: https://display.hospital.kr/webhook
  Events: CHECKED_IN, CALLED, STARTED, COMPLETED, CANCELLED, NO_SHOW

POST → Webhook URL
Headers:
  Content-Type: application/json
  X-HIS-Signature: sha256=...       // HMAC 서명 (위변조 방지)

Body:
{
  "event": "CALLED",
  "timestamp": "2026-05-08T09:15:00Z",
  "data": {
    "queueId": "uuid-...",
    "departmentName": "내과",
    "queueNumber": 23,
    "patientName": "김○수",
    "roomName": "진료실 3",
    "callCount": 1,
    "ttsText": "내과 23번 김○수님, 3번 진료실로 오세요"
  }
}
```

---

## 3. 인증 및 보안

### 3.1 API Key 인증

```
# JWT가 아닌 API Key 기반 (외부 시스템용)
# 병원 단위 발급, 관리자 페이지에서 생성/폐기

X-Display-Key: dpk_a1b2c3d4e5f6...

- 키 길이: 32자 이상 (UUID + prefix)
- 유효기간: 무기한 (수동 폐기)
- 권한: 읽기 전용 (대기 데이터 조회만)
- Rate Limit: 60 req/min
```

### 3.2 개인정보 보호

| 항목 | Public API (디스플레이) | Ticket API (번호표) | Waiting API (모바일) |
|------|----------------------|--------------------|--------------------|
| 환자명 | **마스킹** (김○수) | 풀네임 (본인용) | 미노출 (번호만) |
| 의사명 | **마스킹** (이○희) | 풀네임 | 마스킹 |
| MRN | 미노출 | 미노출 | 미노출 |
| 생년월일 | 미노출 | 미노출 | 미노출 |

### 3.3 토큰 정책

| 항목 | 정책 |
|------|------|
| waitingToken 생성 | check-in 시 자동 (crypto.randomUUID) |
| 유효기간 | 당일 자정까지 |
| 접근 제한 | 토큰 소유자만 (URL 비추측) |
| HTTPS | 필수 |

---

## 4. 데이터 모델 변경 (Hospital RUN 측)

### 4.1 WaitingQueue 필드 추가

```prisma
model WaitingQueue {
  // ... 기존 필드 유지 ...

  // 신규 필드 (외부 연동용)
  waitingToken    String?   @unique @map("waiting_token") @db.VarChar(64)
  callCount       Int       @default(0) @map("call_count")
  priorityOrder   Int?      @map("priority_order")           // 순서 끼워넣기
}
```

### 4.2 API Key 관리 모델

```prisma
model DisplayApiKey {
  id          String    @id @default(uuid()) @db.Uuid
  key         String    @unique @db.VarChar(100)            // dpk_xxxxx
  name        String    @db.VarChar(100)                    // "1층 로비 디스플레이"
  isActive    Boolean   @default(true)
  permissions String[]  @db.VarChar(50)                     // ["display", "ticket", "waiting"]
  webhookUrl  String?   @map("webhook_url") @db.VarChar(500)
  webhookSecret String? @map("webhook_secret") @db.VarChar(100)
  lastUsedAt  DateTime? @map("last_used_at") @db.Timestamptz()
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  createdBy   String    @map("created_by") @db.Uuid

  @@map("display_api_keys")
}
```

### 4.3 Webhook 이벤트 로그 (선택)

```prisma
model DisplayWebhookLog {
  id          String   @id @default(uuid()) @db.Uuid
  apiKeyId    String   @map("api_key_id") @db.Uuid
  event       String   @db.VarChar(30)                     // CALLED, CHECKED_IN, ...
  payload     Json     @db.JsonB
  statusCode  Int?     @map("status_code")                 // Webhook 응답 코드
  error       String?  @db.Text
  sentAt      DateTime @default(now()) @map("sent_at") @db.Timestamptz()

  @@index([apiKeyId, sentAt])
  @@map("display_webhook_logs")
}
```

---

## 5. 기존 API 수정사항

### 5.1 check-in 시 토큰 생성

| API | 변경 |
|-----|------|
| `POST /api/v1/queue/check-in` | `waitingToken` 자동 생성, Response에 추가 |

```typescript
// waiting-queue.service.ts — checkIn() 수정
const waitingToken = crypto.randomUUID().replace(/-/g, '');
const queue = await this.prisma.waitingQueue.create({
  data: { ...dto, waitingToken },
});

// + Webhook 발송 (CHECKED_IN)
await this.sendWebhook('CHECKED_IN', queue);
```

### 5.2 호출 시 이벤트 발송

| API | 변경 |
|-----|------|
| `PATCH /api/v1/queue/:id/call` | `callCount++`, ttsText 생성, Webhook 발송 |

```typescript
// waiting-queue.service.ts — callNext() 수정
const queue = await this.prisma.waitingQueue.update({
  where: { id },
  data: {
    status: 'CALLED',
    calledAt: new Date(),
    callCount: { increment: 1 },
  },
  include: { patient: true },
});

const ttsText = `${queue.departmentName} ${queue.queueNumber}번 ` +
  `${this.maskName(queue.patient)}님, ${queue.roomName}로 오세요`;

// + Webhook 발송 (CALLED)
await this.sendWebhook('CALLED', { ...queue, ttsText });
```

### 5.3 상태 변경 시 Webhook

| API | 이벤트 |
|-----|--------|
| `check-in` | `CHECKED_IN` |
| `call` | `CALLED` |
| `start` | `STARTED` |
| `complete` | `COMPLETED` |
| `cancel` | `CANCELLED` |
| `no-show` | `NO_SHOW` |

---

## 6. 연동 시나리오

### 6.1 Polling 방식 (기본)

```
┌──────────────┐                    ┌──────────────┐
│ 대기 안내     │                    │ Hospital RUN │
│ 디스플레이    │                    │ API Server   │
└──────┬───────┘                    └──────┬───────┘
       │                                    │
       │  GET /display?dept=내과,외과        │
       │──────────────────────────────────▶│
       │         200 { departments: [...] } │
       │◀──────────────────────────────────│
       │                                    │
       │  (5초 후)                          │
       │  GET /display?dept=내과,외과        │
       │──────────────────────────────────▶│
       │         200 { departments: [...] } │
       │◀──────────────────────────────────│
       │                                    │
       │  (lastCall 변경 감지)              │
       │  → TTS 재생 + 배너 표시            │
       │                                    │
```

### 6.2 SSE 방식 (실시간)

```
┌──────────────┐                    ┌──────────────┐
│ 대기 안내     │                    │ Hospital RUN │
│ 디스플레이    │                    │ API Server   │
└──────┬───────┘                    └──────┬───────┘
       │                                    │
       │  GET /display/stream               │
       │──────────────────────────────────▶│
       │  (SSE 연결 유지)                   │
       │                                    │
       │         event: queue_update        │
       │         data: { type: "CALLED" }   │
       │◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
       │                                    │
       │  → 즉시 TTS + 배너                 │
       │                                    │
       │         event: heartbeat           │
       │◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
       │                                    │
```

### 6.3 Webhook 방식 (서버 Push)

```
┌──────────────┐                    ┌──────────────┐
│ Hospital RUN │                    │ 대기 안내     │
│ (접수 호출)   │                    │ Webhook 서버 │
└──────┬───────┘                    └──────┬───────┘
       │                                    │
       │  (의사가 "호출" 클릭)              │
       │                                    │
       │  POST /webhook                     │
       │  { event: "CALLED", data: {...} }  │
       │──────────────────────────────────▶│
       │                       200 OK       │
       │◀──────────────────────────────────│
       │                                    │
       │                   → TTS + 배너     │
       │                                    │
```

### 6.4 번호표 발급 흐름

```
환자 접수
    │
    ▼
┌──────────┐  POST /check-in  ┌──────────────┐
│ 접수 데스크│───────────────▶│ Hospital RUN │
│ (HIS)     │                 │ → queueNumber│
│           │◀───────────────│ → waitingToken│
└──────┬───┘  { queueId, ... }└──────────────┘
       │
       │ queueId 전달
       ▼
┌──────────┐  GET /ticket/{id} ┌──────────────┐
│ 키오스크  │───────────────▶│ Hospital RUN │
│ (프린터)  │                  │ 번호표 데이터  │
│           │◀────────────────│              │
└──────────┘  { queueNumber,   └──────────────┘
               doctorName,
               qrUrl, ... }
       │
       ▼
   🖨️ 번호표 출력
   (QR 코드 포함)
       │
       ▼
   📱 환자 QR 스캔
       │
       ▼
┌──────────┐  GET /waiting/{token} ┌──────────────┐
│ 환자 폰  │─────────────────────▶│ Hospital RUN │
│ (브라우저) │                      │ 대기상태 조회  │
│           │◀─────────────────────│              │
└──────────┘  { status, ahead,     └──────────────┘
               estimatedWait }
```

---

## 7. 구현 우선순위 (Hospital RUN 측)

### Phase 1: 핵심 Public API (P0)

```
1. DisplayApiKey 모델 + API Key 인증 미들웨어
2. GET /api/v1/queue/public/display (과별 대기현황, 마스킹)
3. GET /api/v1/queue/public/display/call-events (호출 이벤트)
4. GET /api/v1/queue/public/stats (통계)
5. GET /api/v1/queue/public/departments (운영 과목)
6. WaitingQueue.callCount 필드 추가
7. 이름 마스킹 유틸리티
8. CORS 설정 + Rate Limiting
```

### Phase 2: 번호표 + 토큰 API (P1)

```
1. WaitingQueue.waitingToken 필드 추가
2. check-in 시 waitingToken 자동 생성
3. GET /api/v1/queue/public/ticket/:queueId (번호표)
4. GET /api/v1/queue/public/waiting/:token (모바일 대기)
5. 토큰 만료 정책 (당일 자정)
```

### Phase 3: SSE + Webhook (P2)

```
1. GET /api/v1/queue/public/display/stream (SSE)
2. Webhook 발송 로직 (CALLED, CHECKED_IN 등)
3. DisplayWebhookLog 모델
4. 관리자 페이지: API Key 관리, Webhook URL 설정
5. WaitingQueue.priorityOrder (순서 변경)
```

---

## 8. 외부 대기 안내 시스템 연동 가이드

Hospital RUN API를 소비하는 외부 시스템 개발자를 위한 가이드.

### 8.1 Quick Start

```bash
# 1. API Key 발급 (Hospital RUN 관리자에게 요청)
API_KEY="CHANGE_ME"

# 2. 대기 현황 조회
curl -H "X-Display-Key: $API_KEY" \
  "https://his.example.org/api/v1/queue/public/display?departments=내과,외과"

# 3. 호출 이벤트 (최근 5분)
curl -H "X-Display-Key: $API_KEY" \
  "https://his.example.org/api/v1/queue/public/display/call-events?since=2026-05-08T09:10:00Z"

# 4. SSE 스트림 (실시간)
curl -H "X-Display-Key: $API_KEY" -H "Accept: text/event-stream" \
  "https://his.example.org/api/v1/queue/public/display/stream"
```

### 8.2 디스플레이 구현 권장사항

| 항목 | 권장 |
|------|------|
| 동기화 방식 | SSE 우선, fallback으로 Polling 5초 |
| TTS | 호출 이벤트 수신 → `ttsText` 필드 사용 |
| 호출 배너 | `lastCall` 또는 `call-events` 기반, 10초 표시 후 fade-out |
| 연결 끊김 | 자동 재연결 (exponential backoff), 마지막 상태 캐시 유지 |
| 풀스크린 | 키오스크 모드, 마우스 커서 숨김, 화면보호기 비활성화 |
| 레이아웃 | 16:9 TV 기준, 과별 컬럼 구분, 큰 글씨 (6m 가독성) |

### 8.3 번호표 키오스크 구현 권장사항

| 항목 | 권장 |
|------|------|
| 프린터 | 58mm/80mm 열감지 (ESC/POS 또는 브라우저 print) |
| QR 코드 | `waitingUrl` 필드 → QR 생성 |
| 번호표 내용 | queueNumber, departmentName, doctorName, roomName, checkedInAt, notice |
| 연동 | HIS 접수 완료 → queueId 전달 → `/ticket/:queueId` 호출 → 출력 |

---

## 9. 에러 코드

| 코드 | HTTP | 설명 |
|------|------|------|
| `INVALID_API_KEY` | 401 | API Key 유효하지 않음 |
| `API_KEY_DISABLED` | 403 | API Key 비활성화됨 |
| `RATE_LIMIT_EXCEEDED` | 429 | 요청 제한 초과 |
| `QUEUE_NOT_FOUND` | 404 | 대기 정보 없음 |
| `TOKEN_EXPIRED` | 410 | 대기 토큰 만료 |
| `DEPARTMENT_NOT_FOUND` | 404 | 존재하지 않는 진료과 |

---

## 10. 성능 요구사항

| 항목 | 기준 |
|------|------|
| Display API 응답 | ≤ 200ms |
| SSE 이벤트 지연 | ≤ 1초 (호출 → 이벤트 전송) |
| Webhook 발송 | ≤ 3초 (비동기, 재시도 3회) |
| 동시 SSE 연결 | 50개 이상 |
| 동시 Polling 클라이언트 | 100개 이상 |
| API Key 인증 | ≤ 10ms (Redis 캐시) |

---

## 11. 참고: 기존 WaitingQueue 상태 흐름

```
  접수 (check-in) → waitingToken 생성, Webhook: CHECKED_IN
       │
       ▼
   ┌────────┐        ┌────────┐        ┌────────────────┐        ┌──────────┐
   │WAITING │──호출──▶│ CALLED │──진료──▶│IN_CONSULTATION │──완료──▶│COMPLETED │
   └────┬───┘        └────┬───┘        └────────────────┘        └──────────┘
        │     Webhook:    │     Webhook:                  Webhook:
        │     CALLED      │     STARTED                   COMPLETED
        │     +ttsText    │
        ▼                 ▼
   ┌─────────┐      ┌─────────┐
   │CANCELLED│      │ NO_SHOW │
   └─────────┘      └─────────┘
   Webhook:          Webhook:
   CANCELLED         NO_SHOW

   외부 시스템이 수신하는 데이터:
   ─────────────────────────────
   WAITING          → { queueNumber, patientName(마스킹), dept, room }
   CALLED           → { + calledAt, callCount, ttsText }
   IN_CONSULTATION  → { + startedAt }
   COMPLETED        → { + completedAt }  → 목록에서 제거
```
