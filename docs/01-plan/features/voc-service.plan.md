# VoC(고객의 소리) 서비스 · 관리 기능 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/prisma/schema.prisma:14130 model VocTicket · apps/api/prisma/schema.prisma:14178 model VocMessage · apps/api/src/modules/voc/voc.controller.ts · 잔여: 없음

- **작성일**: 2026-07-24
- **대상 경로**: `/support/voc`(홈페이지 접수) · 포털 `상담실`(실시간) · `/consult`(상담 데스크) · `/admin/voc`(통합 관리)
- **한 줄 요약**: VoC를 **단일 접수창구가 아니라 옴니채널 통합 계층**으로 설계. ①홈페이지 '본인 확인 후 병원에 질문하기'(신규) ②포털 상담실 실시간 채팅(기존 ConsultSession) ③상담 데스크 처리(기존 /consult) — 이 3채널로 들어오는 모든 '고객의 소리'를 **하나의 티켓 체계로 수렴**하고, 배정·답변·종결·통계·개선과제 승격을 통합 관리.

> **범위 확정(사용자 지시 3건 반영)**
> 1. VoC 신청 첫 진입 = **본인 확인 후 병원에 질문하기**(예약과 동일한 MRN+생년월일 인증)
> 2. **포털 상담실**로 들어오는 내용도 VoC에 해당 → 실시간 채널로 흡수
> 3. **`/consult` 상담 데스크**와 연동 필수 + **현재 상담실↔데스크 연결이 끊겨 보이는 문제** 진단·보강 포함(§2)

---

## 0. 현행 실측 (착수 전 재검증)

| 자산 | 현행 | VoC와의 관계 |
|------|------|-------------|
| `/(homepage)/support/voc/page.tsx` | `CmsCategoryPage category="VOC"` — CMS 게시글 **목록만**(정적 안내) | **교체 대상**: 목록 위에 '질문하기' 진입 추가 |
| `satisfaction` 모듈 | 만족도 **설문 발신**(SatisfactionSurvey·SurveyDispatch)+개선과제 `SurveyActionItem` | **발신**이라 VoC(수신)와 별개. `SurveyActionItem`은 VoC→구조개선 승격 재사용 |
| **`consult` 상담실+데스크** | 포털 `상담실`(ConsultChat) ↔ `/consult` 데스크가 **`ConsultSession`/`ConsultMessage` 공유**. 팀(ConsultTeam)·상담원(ConsultAgent)·AI모드·SLA 에스컬레이션·화상·다국어·least-busy 자동배분까지 이미 구현 | **VoC의 실시간 채널로 흡수**(신설 아님). 실시간 문의=ConsultSession, 비동기 접수=VocTicket, 상위 VoC 계층이 둘을 하나로 집계 |
| `portal.authenticate(mrn, dob)` | `POST /api/v1/portal/auth {mrn, dateOfBirth}` → 환자 반환 | **본인 확인 진입 재사용** (예약 `booking/page.tsx`와 동일) |
| `notification.notify()` | `notify(userId, {type,title,message,severity,refType,refId})` | 배정·답변·신규세션 알림 발행 |

**결론**: 상담(ConsultSession)은 **이미 잘 만들어진 실시간 채널**이므로 재구축하지 않는다. VoC는 그 위에 얹는 **집계·비동기 접수·통합 관리 계층**이다. 신규 접수(VocTicket)는 신설하되, 상담실 세션은 VoC 인박스에 **참조로 편입**(중복 저장 금지).

### 0.1 채널 통합 아키텍처

```
                          ┌─────────────────── VoC 통합 계층 (/admin/voc) ───────────────────┐
                          │  인박스 · SLA · 통계 · 개선과제 승격 · 유형/부서 분류            │
                          └───────────────▲───────────────────────────▲────────────────────┘
                                          │ (참조: sessionId)          │ (소유: ticketId)
  ① 홈페이지 /support/voc                  │                            │
     본인확인 → 질문작성 ─────────────────────────────────────────────▶ VocTicket (비동기)
                                          │
  ② 포털 상담실 (ConsultChat)             │
     실시간 채팅 ──▶ ConsultSession ───────┘  (기존 실시간 채널, 그대로 운영)
                         │
  ③ /consult 데스크 (직원)  ◀─────────────┘  상담원이 세션 claim·답변·종결·에스컬레이션
```

- **원칙**: 실시간 대화는 ConsultSession이 정본. VoC 인박스는 ConsultSession을 **읽어 표시**하고, 세션 종료 시 요약을 VocTicket로 **선택 승격**(불만/개선 소지면). 홈페이지 접수는 처음부터 VocTicket.
- 이렇게 하면 "상담실로 들어온 내용도 VoC"가 **자동 성립**하며, 데스크의 기존 배정/SLA 로직을 그대로 활용.

---

## 1. 목표와 범위

### 1.1 사용자 스토리
- **환자/보호자**: "병원에 물어볼 게 있는데 전화 대기 없이, 내 진료 맥락을 아는 채로 질문하고 답을 받고 싶다."
- **원무/QI 담당**: "들어온 소리를 유형·부서별로 자동 분류하고, 담당에게 배정하고, SLA 안에 답변하고, 반복되는 불만은 구조개선 과제로 올리고, 통계로 본다."

### 1.2 접수 유형 (VocType)
| 코드 | 라벨 | 성격 | 기본 SLA(영업일) |
|------|------|------|------|
| `QUESTION` | 질문/문의 | 정보 요청 | 2일 |
| `COMPLAINT` | 불만/민원 | 서비스 결함 | 1일 |
| `SUGGESTION` | 건의/제안 | 개선 아이디어 | 5일 |
| `COMPLIMENT` | 칭찬 | 긍정 피드백 | 3일(감사 회신) |

> 사용자 지시 반영: **VoC 신청의 첫 진입은 '본인 확인 후 병원에 질문하기'**. 즉 유형 무관하게 **본인 확인 → 질문/내용 작성**이 기본 플로우이며, 유형은 작성 단계에서 선택(기본 QUESTION).

### 1.3 범위 밖 (별도 트랙)
- 만족도 설문 발송(satisfaction 소관) · 직원 상담데스크(consult) · 법적 의료분쟁 조정(수기 프로세스) — VoC에서 **에스컬레이션 링크만** 제공.

---

## 2. 접수 플로우 (환자향, `/support/voc`)

예약 페이지(`booking/page.tsx`)의 본인 확인 UI를 **그대로 재사용**하되 목적지를 VoC 접수로 교체.

```
[1] /support/voc 진입
     ├─ 상단: "병원에 질문하기" CTA (본인 확인 카드)
     └─ 하단: 기존 VOC CMS 안내글 목록 유지(FAQ·처리절차 안내)

[2] 본인 확인  ── POST /api/v1/portal/auth { mrn, dateOfBirth }
     ├─ 성공 → 환자 컨텍스트 확보(이름·MRN)
     └─ 실패 → "비회원으로 문의" 폴백(이름·연락처·이메일 수기 — config로 허용/차단)

[3] 질문 작성
     ├─ 유형 선택(질문/불만/건의/칭찬, 기본 질문)
     ├─ 관련 부서/진료과(선택·미지정 시 자동 라우팅)
     ├─ 제목 + 본문
     ├─ 첨부(선택, 이미지/PDF — MediaService)
     ├─ 답변 수신 채널(포털 알림·이메일·SMS 중, config)
     └─ 개인정보 수집·이용 동의(필수)

[4] 접수 완료
     ├─ 접수번호(VOC-2026-000123) + 예상 답변 기한(SLA)
     ├─ 포털 로그인 시 '나의 문의'에서 진행상황·답변 열람
     └─ WeRU.B 즉답(선택): 자주 묻는 질문이면 AI가 1차 안내 + "정확한 답변은 담당자가 확인 후"
```

### 2.0 상담실 ↔ 데스크 연결 진단 (사용자 지적: "제대로 연결 안된 듯")

포털 상담실(ConsultChat)과 `/consult` 데스크는 **같은 `ConsultSession`을 공유하는 배선은 정상**. 그럼에도 환자 화면에 "상담원 연결 대기 중(앞 N명)"만 계속 뜨는 유력 원인 3종(코드 실측):

| # | 원인 | 근거 | 보강안 |
|---|------|------|--------|
| **D1** | **상담원이 ONLINE이 아니면 세션이 큐에 영원히 적체** | `ConsultAgent.status` 기본 `OFFLINE`. claim/자동배분(least-busy)은 `status='ONLINE'`만 대상(`assignWithCapacity`·`autoAssign`) | 데스크 로그인 시 ONLINE 자동 전환 옵션 + **온라인 상담원 0명이면 환자에게 "대기 중" 대신 비동기 전환 안내**("지금은 상담원이 없어 문의로 접수됩니다") |
| **D2** | **영업시간 하드 게이팅** | `serviceOnline()` = 평일 09~18시 서버시각 고정. 시간 외 상담실은 오프라인 표시 | 시간 외/휴일엔 상담실 진입을 **VoC 비동기 접수로 폴백**(끊김이 아니라 접수로 이어짐) |
| **D3** | **신규 세션 인입 시 데스크 알림 부재** | 실측: consult엔 `notifyLead`(팀장 에스컬레이션)만 존재. OPEN 세션 생성 시 팀 상담원 `notify()` **없음** | 세션 OPEN·팀 라우팅 직후 팀 ONLINE 상담원에게 `notify.create(type='CONSULT_NEW')`+`pushNotification` + 데스크 배지 |
| **D4** | **상담 알림 클릭 무반응(딥링크 미매핑)** | 실측: `notification-store.ts hrefForRef()`에 `ConsultSession`/`CONSULT_ESCALATION` 매핑 **없음** → 에스컬레이션 알림 클릭이 알림목록으로만 | `hrefForRef`에 `CONSULTSESSION`/`CONSULT_ESCALATION`/`CONSULT_NEW`→`/consult`, `VOCTICKET`→`/admin/voc` 추가 |
| **D5** | **SLA 에스컬레이션 자동 구동 부재** | 실측: consult에 `@Cron` **전무**. `escalationLevel`·`escalatedAt`·`priority` 필드는 있으나 **수동(팀장 지원 요청)으로만** 채워짐 | VoC SLA 크론 신설 시 **비동기 티켓 `dueAt` 초과 + 실시간 세션 `waitingSec`(첫 PATIENT 메시지 경과) 초과**를 함께 스캔해 승격·알림 |

> **결론**: 연결 배선(같은 ConsultSession 공유)은 살아 있으나 **가용 상담원 상태(D1)·영업시간(D2)·인입 알림(D3)·딥링크(D4)·SLA 자동화(D5)**의 운영 공백으로 "끊긴 것처럼" 보임. VoC 트랙 **P1 최우선**으로 D1~D5 봉합, **끊김 없는 실시간↔비동기 전환**을 확립. (운영 DB `consult_agents` ONLINE 수·큐 적체 실측은 배포 세션에서 확인.)

### 2.1 본인 확인 후 컨텍스트 이점
- 접수 티켓에 `patientId` 바인딩 → 관리자가 **진료 이력·최근 내원·수납 상태**를 티켓 옆에서 즉시 참조(권한 게이트 내).
- 재문의 시 본인 확인만으로 과거 문의 스레드 이어보기.
- **비회원 폴백**은 `voc.allowAnonymous`(기본 ON) config로 통제. 비회원 티켓은 `patientId=null`, 신원 미검증 배지.

---

## 3. 도메인 모델 (신규 Prisma)

```prisma
model VocTicket {
  id            String    @id @default(uuid()) @db.Uuid
  ticketNo      String    @unique @map("ticket_no") @db.VarChar(20)   // VOC-2026-000123 (연도별 시퀀스)
  type          String    @default("QUESTION") @db.VarChar(12)        // QUESTION/COMPLAINT/SUGGESTION/COMPLIMENT
  status        String    @default("RECEIVED") @db.VarChar(12)        // FSM ↓
  severity      String    @default("NORMAL") @db.VarChar(8)           // LOW/NORMAL/HIGH/URGENT
  channel       String    @default("WEB") @db.VarChar(10)             // WEB/PORTAL/PHONE/KIOSK/CONSULT
  consultSessionId String? @map("consult_session_id") @db.Uuid       // 상담실 세션에서 승격 시 참조(중복저장 금지)

  // 신청자
  patientId     String?   @map("patient_id") @db.Uuid                 // 본인 확인 성공 시 바인딩(비회원 null)
  identityVerified Boolean @default(false) @map("identity_verified")
  submitterName String?   @map("submitter_name") @db.VarChar(100)     // 비회원/보호자
  contactPhone  String?   @map("contact_phone") @db.VarChar(30)
  contactEmail  String?   @map("contact_email") @db.VarChar(120)
  replyChannel  String    @default("PORTAL") @db.VarChar(10)          // PORTAL/EMAIL/SMS

  // 내용
  title         String    @db.VarChar(300)
  department    String?   @db.VarChar(60)                             // 관련 부서/진료과(자동 라우팅 결과 포함)
  category      String?   @db.VarChar(40)                             // 세부 분류(예약/수납/시설/의료진/대기…)

  // 배정·SLA
  assigneeId    String?   @map("assignee_id") @db.Uuid
  dueAt         DateTime? @map("due_at") @db.Timestamptz()
  firstResponseAt DateTime? @map("first_response_at") @db.Timestamptz()
  closedAt      DateTime? @map("closed_at") @db.Timestamptz()
  reopenCount   Int       @default(0) @map("reopen_count")

  // 만족도·개선연계
  ratingScore   Int?      @map("rating_score")                        // 종결 후 1~5(답변 만족도)
  actionItemId  String?   @map("action_item_id") @db.Uuid            // SurveyActionItem 승격 시

  consentAt     DateTime? @map("consent_at") @db.Timestamptz()        // 개인정보 수집 동의 시각
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt     DateTime  @updatedAt @map("updated_at") @db.Timestamptz()

  patient       Patient?  @relation(fields: [patientId], references: [id])
  messages      VocMessage[]
  attachments   VocAttachment[]

  @@index([status, dueAt])
  @@index([patientId])
  @@index([type, createdAt])
  @@map("voc_tickets")
}

model VocMessage {
  id         String   @id @default(uuid()) @db.Uuid
  ticketId   String   @map("ticket_id") @db.Uuid
  authorType String   @db.VarChar(10)      // PATIENT/STAFF/AI/SYSTEM
  authorId   String?  @map("author_id") @db.Uuid
  authorName String?  @map("author_name") @db.VarChar(100)
  body       String   @db.Text
  internal   Boolean  @default(false)      // 내부 메모(환자 비노출)
  aiDraft    Boolean  @default(false) @map("ai_draft")   // AI 초안(직원 검토 전)
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz()

  ticket     VocTicket @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  @@index([ticketId, createdAt])
  @@map("voc_messages")
}

model VocAttachment {
  id        String   @id @default(uuid()) @db.Uuid
  ticketId  String   @map("ticket_id") @db.Uuid
  mediaId   String   @map("media_id") @db.Uuid   // MediaService
  fileName  String   @map("file_name") @db.VarChar(255)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz()
  ticket    VocTicket @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  @@map("voc_attachments")
}
```

### 3.1 상태 기계 (VocStatus FSM)
```
RECEIVED ──triage──▶ TRIAGED ──assign──▶ IN_PROGRESS ──reply──▶ ANSWERED ──close──▶ CLOSED
   │                    │                     │                     │                    │
   └──(자동 라우팅)──────┘                     │                     └──환자 재질문───────▶ REOPENED
                                              └──보류────▶ ON_HOLD (정보 대기)          │
   REOPENED ──▶ IN_PROGRESS                                                            └─(rating)
```
- `RECEIVED→TRIAGED`: 자동 분류/라우팅 완료(규칙 또는 AI). `firstResponseAt`은 첫 STAFF 메시지 시각.
- `ANSWERED→CLOSED`: 담당자 종결 or 환자 무응답 N일(config `voc.autoCloseDays`, 기본 7) 자동 종결.
- `CLOSED→REOPENED`: 환자가 답변에 재질문(SLA 재계산·`reopenCount++`).

---

## 4. 관리 기능 (`/admin/voc`)

### 4.1 인박스(리스트)
- 필터: 상태·유형·부서·담당자·심각도·**SLA 임박/초과**·기간. 기본 정렬 = SLA 임박순.
- 각 행: 접수번호·유형칩·제목·신청자(본인확인 배지)·부서·담당·남은 SLA(D-1 주황/초과 빨강)·상태.
- 상단 KPI: 미배정·오늘 마감·SLA 초과·평균 첫응답시간·미종결.

### 4.2 티켓 상세 (2-pane)
- **좌(대화)**: 스레드(환자↔담당), 내부 메모(`internal=true` 회색), AI 초안 배지. 답변 작성 → 채널(포털/이메일/SMS) 발송.
- **우(컨텍스트)**: 신청자 정보 + (본인 확인 시) 진료 요약·최근 내원·미수납·예약 — 권한 게이트 내. 첨부 미리보기. 처리 이력(감사).
- 액션: **배정**(부서/담당)·**분류 변경**·**심각도**·**보류/재개**·**종결**·**개선과제 승격**(→ `SurveyActionItem`)·**에스컬레이션**(민원 상급/법무).

### 4.3 라우팅 규칙 (config `voc.routing`)
- 카테고리→부서 매핑(예: 수납→원무팀, 시설→시설팀, 의료진→QI팀). 미매칭 시 QI 기본 큐.
- 심각도 자동 상향: 본문 키워드(`사고`·`감염`·`낙상`·`오투약`) 매칭 → `URGENT` + 즉시 알림.

### 4.4 통계 대시보드 (`/admin/voc/analytics`)
- 유형·부서별 접수 추이, SLA 준수율, 평균 처리시간, 재오픈율, 답변 만족도(ratingScore), Top 카테고리, 미종결 적체.
- **데이터 품질 관제 연동**: `/admin/data-quality`에 'VoC SLA 초과' 지표 1종 추가(quality-registry).

---

## 5. AI 컨시어지 (WeRU.B, Human-in-loop)

기존 `quality.ai.enabled`·booking enhanced 패턴 준용. **모두 기본 OFF(`voc.ai.enabled`)·초안은 직원 검토 후 발송**.

| 기능 | 동작 | 게이트 |
|------|------|--------|
| **C1 자동 분류** | 접수 본문 → 유형·카테고리·부서·심각도 제안(`TRIAGED` 보조) | `voc.ai.classify` |
| **C2 즉답 초안** | FAQ/정책 기반 1차 안내 초안(`aiDraft=true`, PATIENT 미발송) | `voc.ai.autoReply` |
| **C3 답변 초안 보조** | 담당자 작성 시 톤·정책 근거 초안 제시 | `voc.ai.replyAssist` |
| **C4 다국어** | 외국인 환자 접수/답변 번역(foreign i18n 자산 재사용) | `voc.ai.translate` |
| **C5 유사문의 클러스터** | 반복 불만 군집 → 개선과제 후보 제안 | `voc.ai.cluster` |

- **PHI 경계**: AI에는 최소 컨텍스트만. 진단·처방 판단 금지, 안내·분류·번역에 한정. 모든 AI 산출은 `authorType=AI`·`aiDraft` 표시로 감사.
- **환자 대면 즉답**: `voc.ai.autoReply` ON이어도 "담당자 확인 전 참고 안내" 고지 강제.

---

## 6. 연동·거버넌스

- **알림**: 배정 시 담당자 `notify(type='voc.assigned', refType='VocTicket', refId)`, 답변 시 환자 채널 발송, SLA 임박 크론 알림.
- **저널/여정**: `voc.received`·`voc.answered`·`voc.closed` 여정 이벤트(신규 기능 여정 발행 규약).
- **포털 '나의 문의'**: `GET /api/v1/portal/voc?patientId=` — 본인 티켓 목록/스레드(PortalOrPatientGuard).
- **개인정보**: 수집 동의(`consentAt`) 필수, 비회원 연락처는 보존정책(RetentionPolicy) 대상, 종결 후 N개월 파기 큐.
- **접근권한**: `/admin/voc` = 원무/QI 역할. 진료 컨텍스트 우측 패널은 기존 차트 열람 권한 재사용(무권한 시 마스킹).
- **config 게이트(신규 키)**: `voc.enabled`(기본 ON)·`voc.allowAnonymous`·`voc.autoCloseDays`·`voc.sla.{type}`·`voc.routing`·`voc.ai.*`.

---

## 7. API 초안

**공개/포털(홈페이지 접수 — V1: auth가 JWT 발급 → 이후 포털 토큰 인증)**
- `POST /api/v1/portal/auth {mrn,dateOfBirth}` — (재사용) 본인 확인 → JWT(30분)+환자
- `POST /api/v1/voc/tickets` — 접수 `{type,title,body,department?,replyChannel,consent}` (포털토큰 시 patientId=토큰 sub·위조불가 / 무토큰=비회원 `{submitterName,contactPhone,contactEmail}` + rate-limit)
- `POST /api/v1/voc/tickets/:id/messages` — 환자 재질문(`PortalOrPatientGuard`)
- `GET /api/v1/portal/voc` — 나의 문의(토큰 sub 기준 — patientId 파라미터 금지)

**상담 연결 봉합(D1~D5)**
- `POST /api/v1/consult/agent/online` — 데스크 로그인 시 ONLINE 자동전환(`voc.consult.autoOnlineOnLogin`)
- 세션 OPEN 시 서비스 내부에서 팀 ONLINE 상담원 `notify.create('CONSULT_NEW')+push`(D3)
- `serviceOnline()`=false 또는 ONLINE 0명 → 상담실 진입을 `POST /voc/tickets`(channel=CONSULT)로 폴백(D1/D2)
- `notification-store.ts hrefForRef` 매핑 추가(D4) · SLA 크론(D5, §11-A.3)

**관리(`/admin/voc`, 원무/QI 가드)**
- `GET /admin/voc/inbox` — **ConsultSession(listSessions 재사용) + VocTicket 통합** 리스트(필터·SLA·`sla=overdue`)
- `GET /admin/voc/tickets/:id` · `PATCH /:id`(분류·심각도·상태) · `POST /:id/assign`
- `POST /:id/messages`(답변/내부메모 `internal`) · `POST /:id/close` · `POST /:id/reopen`
- `POST /consult/sessions/:id/promote` — **상담 세션→VocTicket 승격**(consultSessionId 참조·요약)
- `POST /:id/promote-action`(→SurveyActionItem) · `GET /admin/voc/analytics`(3채널 합산) · `GET /admin/voc/config`

---

## 8. 구현 단계 (P0~P3)

| 단계 | 내용 | 산출 |
|------|------|------|
| **P0** | 스키마 3모델(+consultSessionId 참조) + 홈페이지 접수 API + `/support/voc` 본인 확인→질문→접수완료 + 포털 '나의 문의' | 비동기 접수 채널 |
| **P1** | **상담실↔데스크 연결 봉합(D1~D5)** — ONLINE 자동전환·시간외 비동기 폴백·신규세션 알림·딥링크 매핑·SLA 크론. `/admin/voc` 인박스에 ConsultSession + VocTicket **통합 표시**·티켓 상세(2-pane)·배정·답변·상태 FSM·SLA | 옴니채널 통합 관리 |
| **P2** | 상담 세션 종료→VocTicket 승격(불만/개선)·라우팅 규칙·심각도 자동상향·통계 대시보드(3채널 합산)·개선과제 승격·자동 종결·data-quality 지표 | 운영 고도화 |
| **P3** | AI C1~C5(게이트 OFF)·다국어·유사문의 클러스터·만족도 회신 | AI 컨시어지 |

> **P1 우선순위 주의**: 사용자가 지적한 "상담실 연결 문제(D1~D3)"는 실사용 장애이므로 P1 착수 시 **최우선 봉합**. 통합 인박스보다 앞서 진행.

각 단계: 클린 `nest build` + `node dist/main.js` 부팅검증 → deploy.sh → 스모크 → 운영 e2e → PR/머지. 스키마 변경(P0)은 `deploy.sh --schema` + prisma generate 필수(신규 모델).

---

## 9. 리스크·결정 필요

| 항목 | 이슈 | 기본안 |
|------|------|--------|
| 비회원 문의 | 신원 미검증 스팸·악용 | `voc.allowAnonymous` ON + reCAPTCHA/rate-limit + 연락처 필수 |
| 진료 컨텍스트 노출 | 관리자 우측 패널 PHI | 기존 차트 열람 권한 게이트 재사용, 무권한 마스킹 |
| SLA 정의 | 영업일/공휴일 계산 | 병원 운영 캘린더 기준(기존 근무표 자산 참조) |
| AI 즉답 오안내 | 잘못된 정책 안내 | 기본 OFF·초안 검토 발송·"담당자 확인 전 참고" 고지 |
| 법적 민원 | 의료분쟁 조정 | VoC는 접수·라우팅까지, 조정은 수기 프로세스 링크 |

---

## 10. 재사용 자산 요약
- **실시간 채널**: `ConsultSession`/`ConsultMessage`+`/consult` 데스크(팀·상담원·claim·SLA 에스컬레이션·화상·다국어·자동배분) — VoC가 상위 집계, 재구축 없음
- 본인 확인: `portal.authenticate` / `booking/page.tsx` 인증 UI
- 개선과제: `SurveyActionItem`(department·priority·status·assignee)
- 알림: `notification.notify()` (refType='VocTicket' / 'consult.new')
- 첨부: MediaService(self-healing 스캔) / ConsultMessage.attachmentUrl
- AI: `quality.ai`·booking enhanced 파이프라인, foreign i18n 번역, 상담 aiMode(AUTO/OFF/SUGGEST)
- 관제 지표: quality-registry(VoC SLA 초과 1종 추가)

## 11-A. 정밀 검증 결과 (스키마·실코드 대조 교정)

착수 전 기획의 모든 가정을 실코드와 대조. 교정·확정 사항:

| # | 가정 | 실측 | 반영 |
|---|------|------|------|
| V1 | 본인 확인 후 `patientId`만 넘긴다 | `portal.authenticate`는 **JWT 토큰(30분)+PortalSession 생성** 후 환자 반환 | 접수 API는 이 **포털 토큰으로 인증**(`PortalOrPatientGuard`) → `patientId` 위조 불가. 비회원만 무토큰 경로 |
| V2 | `notify()` 단일 호출 | 실제는 `notify.create(userId, {type,title,message,severity,refType,refId})` **+ 별도 `pushNotification(userId, {...})`** 2-step (SSE) | 모든 VoC 알림은 create+push 2-step. `prisma.notification.create` 직접 호출 금지(SSE 누락) |
| V3 | 딥링크 자동 | `hrefForRef()`에 VoC/Consult 미매핑 | D4대로 `notification-store.ts`에 매핑 추가 필수 |
| V4 | ticketNo 단순 count+1 | cssd/cancer는 `count({startsWith})+1`(**동시성 레이스**). consult는 `pg_advisory_xact_lock(hashtext())`로 직렬화 | ticketNo는 **tx 내 advisory lock** 후 `count+1`(중복 방지). 선례=`assignWithCapacity` |
| V5 | 실시간 SLA 신호 없음 | `listSessions`가 이미 `waitingSec`(마지막 메시지가 PATIENT면 경과초)·`priority`·`escalation*` 반환 | VoC 통합 인박스는 이 필드 **그대로 소비**. 실시간 SLA = `waitingSec > 임계` |
| V6 | Patient 관계 자유 추가 | Patient는 이력관리(`validTo` 소프트삭제) 모델 | `VocTicket.patient` 역관계 추가 시 `patient.voc?` 후방관계 선언 + `validTo` 무관(문의는 이력 독립) |
| V7 | journey 발행 임의 | `journey.emit({patientId, type, ..., metadata})` 동기 fire-and-forget(catch) | `voc.received/answered/closed`는 `emit()` 규약대로. patientId 없으면(비회원) 발행 생략 |
| V8 | 첨부 자유 | 실시간=`ConsultMessage.attachmentUrl`, 비동기=MediaService | 채널별 첨부 저장 경로 분리(위 모델 반영) |

### 11-A.1 config DEFAULTS 신규 항목 (config-runtime.service.ts `DEFAULTS`)
```ts
'voc.enabled':        { value: true,  category: 'voc', description: 'VoC 접수 활성' },
'voc.allowAnonymous': { value: true,  category: 'voc', description: '비회원(본인확인 실패) 문의 허용' },
'voc.autoCloseDays':  { value: 7,     category: 'voc', description: 'ANSWERED 후 환자 무응답 자동 종결(일)' },
'voc.sla.QUESTION':   { value: 2,     category: 'voc', description: '질문 SLA(영업일)' },
'voc.sla.COMPLAINT':  { value: 1,     category: 'voc', description: '불만 SLA(영업일)' },
'voc.sla.SUGGESTION': { value: 5,     category: 'voc', description: '건의 SLA(영업일)' },
'voc.sla.COMPLIMENT': { value: 3,     category: 'voc', description: '칭찬 회신 SLA(영업일)' },
'voc.routing':        { value: {},    category: 'voc', description: '카테고리→부서 매핑(JSON)' },
'voc.consult.autoOnlineOnLogin': { value: true, category: 'voc', description: '데스크 로그인 시 상담원 ONLINE 자동전환(D1)' },
'voc.consult.offlineFallback':   { value: true, category: 'voc', description: '온라인 상담원 0명/시간외 → 비동기 접수 폴백(D1/D2)' },
'voc.ai.enabled':     { value: false, category: 'voc', description: 'VoC AI 마스터(기본 OFF)' },
'voc.ai.classify':    { value: false, category: 'voc', description: 'C1 자동 분류' },
'voc.ai.autoReply':   { value: false, category: 'voc', description: 'C2 즉답 초안' },
'voc.ai.replyAssist': { value: false, category: 'voc', description: 'C3 답변 초안 보조' },
'voc.ai.translate':   { value: false, category: 'voc', description: 'C4 다국어' },
'voc.ai.cluster':     { value: false, category: 'voc', description: 'C5 유사문의 클러스터' },
```

### 11-A.2 data-quality 지표 추가 (quality-registry.ts `QualityMetric`)
```ts
{
  key: 'voc.slaOverdue', domain: 'voc', label: 'VoC SLA 초과 미답변',
  compute: async (p) => ({
    value: await p.vocTicket.count({ where: { status: { notIn: ['CLOSED'] }, dueAt: { lt: new Date() }, firstResponseAt: null } }),
    total: await p.vocTicket.count({ where: { status: { notIn: ['CLOSED'] } } }),
  }),
  drillDown: '/admin/voc?sla=overdue', thresholdKey: 'quality.threshold.voc.slaOverdue',
  severityWhenOver: 'WARNING', roles: [UserRole.ADMIN],
}
```

### 11-A.3 SLA 크론 (신규 — consult엔 @Cron 전무, D5)
```
매 N분:
  1) 비동기: VocTicket status∉CLOSED & dueAt<now & firstResponseAt=null
     → severity 승격 + 담당/팀 notify.create+push
  2) 실시간: ConsultSession status∈(OPEN,WAITING) & 마지막 PATIENT 메시지 경과 > 임계(waitingSec)
     → priority/escalationLevel 상향 + 팀 notify (기존 escalation 필드 재사용)
  3) 자동종결: ANSWERED & 환자 무응답 > voc.autoCloseDays → CLOSED(만족도 요청)
영업일 계산 = 근무표/공휴일 자산 기준(§9)
```

## 11-B. 마이그레이션·배포 주의 (신규 모델 3종)
- 신규 Prisma 모델(VocTicket/VocMessage/VocAttachment) → `deploy.sh --schema` + **prisma generate 필수**(deploy.sh --api는 재생성 안 함). rsync+generate+build+restart 순.
- `npx prisma db push`(플래그 없이) 사용, `--accept-data-loss` 금지.
- Patient 역관계 추가는 **관계 필드만**(컬럼 없음) → 데이터 무손실.
- 부팅검증(`node dist/main.js` "successfully started") 후 배포.

## 12. 핵심 설계 판단 (요약)
1. **VoC = 옴니채널 집계 계층**. 상담(실시간)은 ConsultSession 정본 유지, 홈페이지 접수만 VocTicket 신설, 통합 인박스가 둘을 하나로 본다.
2. **"상담실 연결 안됨"은 배선 결함이 아니라 운영 공백**(상담원 OFFLINE·영업시간 게이팅·인입 알림 부재). 실시간↔비동기 **끊김 없는 전환**으로 봉합(D1~D3, P1 최우선).
3. **본인 확인 후 질문하기**가 모든 비동기 접수의 진입(예약과 동일 UX), 비회원은 config 폴백.
4. AI는 전부 기본 OFF·Human-in-loop·PHI 경계(분류·번역·초안까지, 진단 금지).
