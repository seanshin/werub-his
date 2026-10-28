# AI 에이전트 기반 접수 시스템 + 인터넷 예약 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/src/app.module.ts:106 · apps/api/prisma/schema.prisma:8720 model AgentSession · apps/api/prisma/schema.prisma:8737 model OnlineBooking · 잔여: 없음

> **Summary**: 대화형 AI 에이전트가 접수 전체 워크플로우를 자율 수행하고, 동일 에이전트를 인터넷 예약 페이지에도 활용
>
> **Project**: Hospital RUN
> **Version**: 0.1.0
> **Date**: 2026-05-08

---

## 1. 에이전트 아키텍처

### 1.1 에이전트 컨텍스트 구조

AI가 대화를 통해 **자율적으로 단계를 유추**하려면, 명확한 컨텍스트(상태 머신)가 필요합니다.

```typescript
interface AgentContext {
  // ── 세션 ──
  sessionId: string;
  channel: 'HIS_RECEPTION' | 'WEB_BOOKING' | 'KIOSK' | 'KAKAO' | 'PHONE';
  operatorId?: string;          // HIS: 접수 직원 ID
  startedAt: Date;

  // ── 대화 상태 ──
  state: AgentState;
  stateHistory: AgentState[];   // 이전 상태 이력 (되돌리기용)

  // ── 환자 정보 (점진적 수집) ──
  patient: {
    resolved: boolean;          // 기존 환자 확인 완료 여부
    id?: string;                // 기존 환자 ID (검색 성공 시)
    mrn?: string;
    familyName?: string;
    givenName?: string;
    birthDate?: string;         // YYYY-MM-DD
    gender?: 'MALE' | 'FEMALE';
    phone?: string;
    insuranceType?: string;
    allergies?: string[];
    problemList?: string[];
    lastEncounter?: { date: string; doctor: string; department: string; reason: string };
  };

  // ── 접수 정보 (점진적 수집) ──
  reception: {
    department?: string;
    doctorId?: string;
    doctorName?: string;
    visitType?: 'INITIAL' | 'FOLLOW_UP';
    reason?: string;
    symptoms?: string[];
    urgency?: 'NORMAL' | 'URGENT' | 'EMERGENCY';
    preferredDate?: string;     // 인터넷 예약 시
    preferredTime?: string;     // 인터넷 예약 시
  };

  // ── 추천 결과 ──
  recommendations: {
    departments?: { name: string; reason: string; priority: number }[];
    doctors?: { id: string; name: string; department: string; nextSlot: string }[];
    searchResults?: { id: string; mrn: string; name: string; birth: string; gender: string }[];
  };

  // ── 대화 이력 ──
  messages: { role: 'user' | 'agent' | 'system'; content: string; timestamp: Date; action?: AgentAction }[];

  // ── 완료 결과 ──
  result?: {
    type: 'RECEPTION_COMPLETED' | 'BOOKING_COMPLETED' | 'CANCELLED';
    queueId?: string;
    appointmentId?: string;
    patientId?: string;
  };
}

type AgentState =
  | 'IDLE'                    // 대기
  | 'IDENTIFYING_PATIENT'     // 환자 식별 중
  | 'SEARCH_RESULTS'          // 검색 결과 표시 (선택 대기)
  | 'COLLECTING_PATIENT_INFO' // 신규 환자 정보 수집 중
  | 'REGISTERING_PATIENT'     // 환자 등록 중
  | 'COLLECTING_SYMPTOMS'     // 증상 수집 중
  | 'RECOMMENDING_DEPT'       // 진료과 추천 중
  | 'SELECTING_DOCTOR'        // 의사 선택 중
  | 'SELECTING_TIME'          // 예약 시간 선택 (인터넷 예약)
  | 'CONFIRMING'              // 최종 확인 대기
  | 'COMPLETED'               // 완료
  | 'ERROR';                  // 오류

interface AgentAction {
  type: 'SEARCH_PATIENT' | 'REGISTER_PATIENT' | 'RECOMMEND_DEPT'
      | 'CREATE_QUEUE' | 'CREATE_APPOINTMENT' | 'FETCH_SCHEDULE';
  payload: any;
  result?: any;
}
```

### 1.2 상태 전이 다이어그램

```
                    사용자 입력
                        │
                        ▼
                    ┌──────┐
                    │ IDLE │
                    └──┬───┘
                       │ 이름/MRN/자연어 입력
                       ▼
              ┌────────────────────┐
              │ IDENTIFYING_PATIENT│──→ 검색 API 호출
              └────────┬───────────┘
                       │
              ┌────────┼────────┐
              ▼        ▼        ▼
          1명 발견   N명 발견   0명 발견
              │        │        │
              │   ┌────▼────┐   │
              │   │ SEARCH  │   │
              │   │ RESULTS │   │
              │   └────┬────┘   │
              │     선택│       │
              ▼        ▼        ▼
    patient.resolved  ┌──────────────────────┐
         = true       │ COLLECTING_PATIENT   │
              │       │ _INFO                │
              │       └──────────┬───────────┘
              │                  │ 정보 수집 완료
              │                  ▼
              │       ┌──────────────────────┐
              │       │ REGISTERING_PATIENT  │──→ 등록 API
              │       └──────────┬───────────┘
              │                  │
              ▼                  ▼
        ┌─────────────────────────┐
        │   COLLECTING_SYMPTOMS   │
        └────────────┬────────────┘
                     │ 증상 입력
                     ▼
        ┌─────────────────────────┐
        │   RECOMMENDING_DEPT     │──→ AI 추천
        └────────────┬────────────┘
                     │ 진료과 선택
                     ▼
        ┌─────────────────────────┐
        │   SELECTING_DOCTOR      │──→ 스케줄 조회
        └────────────┬────────────┘
                     │
          ┌──────────┼──────────┐
          ▼                     ▼
    (HIS 접수)           (인터넷 예약)
          │                     │
          │              ┌──────▼──────┐
          │              │SELECTING    │
          │              │_TIME        │
          │              └──────┬──────┘
          │                     │
          ▼                     ▼
        ┌─────────────────────────┐
        │      CONFIRMING         │
        └────────────┬────────────┘
                     │ 확인
                     ▼
        ┌─────────────────────────┐
        │      COMPLETED          │
        └─────────────────────────┘
```

### 1.3 에이전트 유추 규칙

AI가 사용자 입력에서 **자동으로 유추**하는 항목:

| 입력 패턴 | 유추 결과 |
|-----------|----------|
| 한글 2~4글자 | → 이름으로 검색 |
| P2026-XXXX, HR-XXXX | → MRN으로 검색 |
| 010-XXXX-XXXX | → 전화번호로 검색 |
| 숫자 4자리 (1950~2025) | → 출생년도 |
| XX년 X월 X일 / YYYY-MM-DD | → 생년월일 |
| 남/남자/M, 여/여자/F | → 성별 |
| 초진/처음/첫 방문 | → visitType: INITIAL |
| 재진/다시/약 처방 | → visitType: FOLLOW_UP |
| 두통/흉통/복통/기침 등 | → 증상 + 진료과 추천 트리거 |
| 내과/외과/정형외과 등 | → 진료과 직접 지정 |
| 김내과/박내과 등 | → 의사 직접 지정 |
| 급한/응급/심한 통증 | → urgency: URGENT |
| 1번/2번/첫번째 | → 검색 결과에서 선택 |
| 네/예/맞아요/확인 | → 현재 제안 수락 |
| 아니오/취소/다시 | → 이전 상태로 |

---

## 2. 채널별 인터페이스

### 2.1 HIS 접수 데스크 (기존 직원용)

```
┌─────────────────────────────────────────────┐
│ 접수 데스크                                   │
│                                              │
│ ┌──── AI 접수 어시스턴트 ────────────────────┐│
│ │                                           ││
│ │ 🤖 환자 정보를 입력해주세요.               ││
│ │    (이름, MRN, 전화번호 등)                ││
│ │                                           ││
│ │ 직원: 김영수 고혈압                        ││
│ │                                           ││
│ │ 🤖 김영수 검색 → 1명 발견                 ││
│ │    P2026-0001 | 68세 남 | 내과            ││
│ │    알레르기: 페니실린⚠️                    ││
│ │    마지막: 5/7 김내과 (고혈압 재진)        ││
│ │                                           ││
│ │    재진으로 접수할까요? [확인] [수정]       ││
│ │                                           ││
│ │ ┌──────────────────────────────┐          ││
│ │ │ 입력...                      │ [전송]   ││
│ │ └──────────────────────────────┘          ││
│ └───────────────────────────────────────────┘│
│                                              │
│ ┌──── 접수 현황 ─────────────────────────────┐│
│ │ 내과: 대기 3명 | 외과: 대기 1명 | ...      ││
│ └───────────────────────────────────────────┘│
└──────────────────────────────────────────────┘
```

### 2.2 인터넷 예약 페이지 (환자용)

별도 공개 URL: `https://his.example.org/booking`

```
┌─────────────────────────────────────────────┐
│       🏥 Hospital RUN 온라인 예약             │
│                                              │
│  ┌─── AI 예약 도우미 ──────────────────────┐ │
│  │                                         │ │
│  │ 🤖 안녕하세요! Hospital RUN입니다.       │ │
│  │    진료 예약을 도와드리겠습니다.          │ │
│  │                                         │ │
│  │    이름과 증상을 말씀해주세요.            │ │
│  │                                         │ │
│  │ 환자: 홍지은이고요, 두통이 심해요        │ │
│  │                                         │ │
│  │ 🤖 홍지은님, 두통 증상이시군요.          │ │
│  │    생년월일을 알려주세요.                │ │
│  │                                         │ │
│  │ 환자: 95년 3월 15일이요                  │ │
│  │                                         │ │
│  │ 🤖 감사합니다.                          │ │
│  │    두통 진료는 내과 또는 신경과를         │ │
│  │    추천드립니다.                         │ │
│  │                                         │ │
│  │    📅 내과 예약 가능:                    │ │
│  │    • 5/9 (금) 09:00 김내과               │ │
│  │    • 5/9 (금) 10:30 박내과               │ │
│  │    • 5/12 (월) 09:00 김내과              │ │
│  │                                         │ │
│  │    어떤 시간이 좋으신가요?                │ │
│  │                                         │ │
│  │ 환자: 금요일 9시요                       │ │
│  │                                         │ │
│  │ 🤖 예약 확인:                           │ │
│  │    홍지은님 | 5/9(금) 09:00              │ │
│  │    내과 김내과 선생님 | 두통              │ │
│  │    전화번호를 입력해주세요 (본인확인용)    │ │
│  │                                         │ │
│  │ 환자: 010-9999-8888                     │ │
│  │                                         │ │
│  │ 🤖 ✅ 예약 완료!                        │ │
│  │    예약번호: BK-2026-0512               │ │
│  │    5/9(금) 09:00 내과 김내과             │ │
│  │                                         │ │
│  │    ⏰ 예약 10분 전 도착해주세요.          │ │
│  │    📱 예약확인 SMS가 발송됩니다.          │ │
│  │                                         │ │
│  │ ┌───────────────────────────┐           │ │
│  │ │ 입력...                   │ [전송]    │ │
│  │ └───────────────────────────┘           │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  Hospital RUN v0.1.0 | 개인정보처리방침       │
└──────────────────────────────────────────────┘
```

### 2.3 향후 채널 확장

| 채널 | 인터페이스 | 에이전트 동일 |
|------|-----------|:----------:|
| HIS 접수 데스크 | 웹 채팅 (직원용) | ✅ |
| 인터넷 예약 | 공개 웹 채팅 (환자용) | ✅ |
| 키오스크 | 터치 스크린 + 음성 | ✅ |
| 카카오 알림톡 | 카카오 챗봇 연동 | ✅ |
| 전화 ARS | STT + TTS + 에이전트 | ✅ |

**핵심: 동일한 AgentContext + 상태 머신을 모든 채널에서 재사용**

---

## 3. API 설계

### 3.1 에이전트 세션 API

```
# 세션 시작
POST /api/v1/agent/session
body: { channel: 'HIS_RECEPTION' | 'WEB_BOOKING', operatorId?: string }
→ { sessionId, context }

# 메시지 전송 (대화 진행)
POST /api/v1/agent/session/:sessionId/message
body: { message: string }
→ { response: string, context: AgentContext, actions: AgentAction[], ui?: UIDirective }

# 액션 확인 (버튼 클릭)
POST /api/v1/agent/session/:sessionId/action
body: { action: 'CONFIRM_RECEPTION' | 'CONFIRM_BOOKING' | 'SELECT_ITEM', payload?: any }
→ { response, context, result? }

# 세션 상태 조회
GET /api/v1/agent/session/:sessionId
→ { context }

# 세션 종료
DELETE /api/v1/agent/session/:sessionId
```

### 3.2 UIDirective (프론트엔드 제어)

AI 응답에 포함되는 UI 지시사항:

```typescript
interface UIDirective {
  type: 'SHOW_SEARCH_RESULTS' | 'SHOW_PATIENT_CARD' | 'SHOW_DEPT_RECOMMENDATION'
      | 'SHOW_SCHEDULE' | 'SHOW_CONFIRMATION' | 'SHOW_INPUT_FORM'
      | 'AUTO_FILL_FORM' | 'ENABLE_BUTTON' | 'NAVIGATE';
  payload: any;
}

// 예: 검색 결과 표시
{ type: 'SHOW_SEARCH_RESULTS', payload: { patients: [...] } }

// 예: 접수 폼 자동 채움
{ type: 'AUTO_FILL_FORM', payload: { department: '내과', visitType: 'FOLLOW_UP', reason: '고혈압 재진' } }

// 예: 스케줄 표시 (인터넷 예약)
{ type: 'SHOW_SCHEDULE', payload: { slots: [{ date, time, doctor }] } }
```

### 3.3 인터넷 예약 공개 API (인증 불필요)

```
# 예약 세션 시작 (공개)
POST /api/v1/booking/session
→ { sessionId }

# 대화 (공개)
POST /api/v1/booking/session/:sessionId/message
body: { message: string }
→ { response, ui?, bookingStatus }

# 예약 확인 (공개, 전화번호 인증)
POST /api/v1/booking/session/:sessionId/confirm
body: { phone: string, verificationCode?: string }
→ { bookingId, appointmentId }

# 예약 조회 (공개, 전화번호+예약번호)
GET /api/v1/booking/lookup?phone=010...&bookingId=BK-2026-...
→ { appointment }

# 예약 취소 (공개)
DELETE /api/v1/booking/:bookingId?phone=010...
```

---

## 4. 데이터 모델

```prisma
model AgentSession {
  id          String    @id @default(uuid()) @db.Uuid
  channel     String    @db.VarChar(30)        // HIS_RECEPTION, WEB_BOOKING
  operatorId  String?   @map("operator_id") @db.Uuid
  patientId   String?   @map("patient_id") @db.Uuid
  state       String    @db.VarChar(30)
  context     Json      @db.JsonB              // AgentContext 전체
  messages    Json      @db.JsonB              // 대화 이력
  resultType  String?   @map("result_type") @db.VarChar(30)
  resultId    String?   @map("result_id") @db.Uuid  // queueId or appointmentId
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  completedAt DateTime? @map("completed_at") @db.Timestamptz()

  @@index([channel, createdAt])
  @@map("agent_sessions")
}

model OnlineBooking {
  id              String    @id @default(uuid()) @db.Uuid
  bookingNumber   String    @unique @map("booking_number") @db.VarChar(20)  // BK-2026-0001
  sessionId       String?   @map("session_id") @db.Uuid
  patientName     String    @map("patient_name") @db.VarChar(100)
  patientPhone    String    @map("patient_phone") @db.VarChar(20)
  patientBirth    DateTime? @map("patient_birth") @db.Date
  department      String    @db.VarChar(50)
  doctorId        String?   @map("doctor_id") @db.Uuid
  appointmentId   String?   @unique @map("appointment_id") @db.Uuid
  preferredDate   DateTime  @map("preferred_date") @db.Date
  preferredTime   String    @map("preferred_time") @db.VarChar(10)
  reason          String?   @db.Text
  status          String    @default("PENDING") @db.VarChar(20)  // PENDING, CONFIRMED, CANCELLED
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  @@index([patientPhone])
  @@index([bookingNumber])
  @@map("online_bookings")
}
```

---

## 5. 구현 우선순위

```
Phase 1: 에이전트 코어 + HIS 접수 (3일)
  1. AgentContext 타입 정의 + 상태 머신
  2. agent-session 백엔드 모듈 (세션 CRUD + 메시지 처리)
  3. 자연어 파서 (이름/생년/성별/증상/접수유형 유추)
  4. 증상→진료과 매핑 엔진
  5. 접수 페이지 AI 대화형 UI 교체

Phase 2: 인터넷 예약 페이지 (2일)
  6. OnlineBooking 모델 + 공개 API
  7. /booking 공개 페이지 (인증 불필요)
  8. 예약 가능 시간 조회 (의사 스케줄 연동)
  9. 전화번호 인증 (SMS 또는 입력 확인)

Phase 3: 채널 확장 준비 (1일)
  10. 에이전트 세션 로깅 + 분석 대시보드
  11. 카카오 알림톡 웹훅 연동 준비
  12. 키오스크 모드 UI
```

---

## 6. 에이전트 확장 로드맵

```
현재: Rule-based 파서 + WeRU.B AI RAG
  ↓
Phase 2: LLM Function Calling
  - AI가 직접 HIS API 호출 결정
  - 도구: searchPatient(), registerPatient(), createQueue(), getSchedule()
  ↓
Phase 3: Multi-Agent
  - 접수 에이전트 + 진료 에이전트 + 수납 에이전트 협업
  - 접수 에이전트가 진료 에이전트에게 컨텍스트 전달
  ↓
Phase 4: Autonomous Agent
  - 환자 도착 감지 → 자동 접수 → 대기열 배정 → 알림
  - 의사 부재 시 대체 의사 자동 추천
```

---

## 7. Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1.0 | 2026-05-08 | user | 초기 기획서 — 에이전트 컨텍스트 + 인터넷 예약 |
