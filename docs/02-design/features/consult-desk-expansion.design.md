# 상담데스크 확장 설계서 v1.2

- **작성**: 2026-06-16 (v1.1 검증 C-1~3·W-1~9 → v1.2 구현레벨 2차검토 D-1~8 §15 반영)
- **Plan**: `docs/01-plan/features/consult-desk-expansion.plan.md` v1.2
- **대상 모듈**: `apps/api/src/modules/consult` 확장 + `apps/web` 상담 데스크/팀장/관리 화면
- **범위**: P1(팀 세팅·역할·수동배정·AI토글) + P2(에스컬레이션 협업·SSE·콘솔). P3(AI SUGGEST·자동배분·분석)는 인터페이스만 예약.

---

## 0. 선결 4건 — 확정

| # | 항목 | 결정 |
|---|------|------|
| 1 | category 분류 | **환자 선택 드롭다운**(세션 오픈 시) + 상담원 사후 변경. AI 자동분류=P3 |
| 2 | ConsultAgentGuard 백필 | 마이그레이션에서 **기존 `ConsultSession.assigneeId` DISTINCT → AGENT 자동 백필** + 기본팀 1개 시드. 이후 ADMIN이 명단 관리 |
| 3 | AuditAction | **enum 확장 안 함**(검증 C-1). 기존 코드 관례대로 `AuditAction.UPDATE` + `changes:{ op:{ new:'CONSULT_ASSIGN'|... } }` JSON 매핑. enum은 CREATE/READ/UPDATE/DELETE 4개 유지 |
| 4 | 큐 정렬 우선순위 | **팀장 에스컬(leadEscalatedAt) > SLA(priority·escalationLevel) > 대기시간** 내림차순 |

---

## 1. 아키텍처

```
환자(포털 _consult) ──open(category,locale)──▶ openSession → routeTeam() → teamId
      │ message                                         │
      ▼                                                 ▼
 ConsultService.patientMessage ──aiGate(aiMode)──▶ processAsync(번역+AI?)
                                                         │
직원 ─ JwtAuthGuard + ConsultAgentGuard(role) ─┐         ▼ SSE(staff/patient 분리)
  ├ AGENT 데스크: claim/reply/note/escalate/aiMode/close
  ├ LEAD 콘솔  : queue/assign/join/transfer/resolve-escalation
  └ ADMIN      : teams CRUD / members
```

- 신규 서비스 분리: `ConsultTeamService`(팀·멤버·라우팅), `ConsultAgentService`(프로필·상태·부하). 기존 `ConsultService`는 세션/메시지/AI/SSE 유지하되 aiGate·visibility·escalation 분리 반영.
- 가드: `ConsultAgentGuard`(JwtAuthGuard 뒤단, `ConsultAgent` 조회 → `req.consultAgent` 주입, `@ConsultRole('LEAD'|'ADMIN')` 데코레이터로 분기).

---

## 2. 데이터 설계 (Prisma)

### 2.1 신규 `ConsultTeam`
```prisma
model ConsultTeam {
  id            String  @id @default(uuid()) @db.Uuid
  name          String  @db.VarChar(40)
  description   String? @db.VarChar(200)
  categories    Json?                       // ["GENERAL","INTERNATIONAL","CHECKUP","BILLING"]
  locales       Json?                       // ["ko","en","zh"]
  defaultAiMode String  @default("AUTO") @db.VarChar(8)
  isDefault     Boolean @default(false) @map("is_default")
  active        Boolean @default(true)
  agents        ConsultAgent[]
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")
  @@map("consult_teams")
}
```

### 2.2 신규 `ConsultAgent`
```prisma
model ConsultAgent {
  id            String  @id @default(uuid()) @db.Uuid
  userId        String  @unique @map("user_id") @db.Uuid
  teamId        String? @map("team_id") @db.Uuid
  team          ConsultTeam? @relation(fields: [teamId], references: [id])
  role          String  @db.VarChar(8)      // AGENT|LEAD|ADMIN
  status        String  @default("OFFLINE") @db.VarChar(8) // ONLINE|AWAY|BUSY|OFFLINE
  skills        Json?                        // {langs:[],categories:[]}
  maxConcurrent Int     @default(5) @map("max_concurrent")
  updatedAt     DateTime @updatedAt @map("updated_at")
  @@index([teamId])
  @@map("consult_agents")
}
```

### 2.3 `ConsultSession` 확장
```prisma
  teamId           String?   @map("team_id") @db.Uuid
  category         String?   @db.VarChar(20)            // 기존 컬럼 재사용(라우팅 키)
  aiMode           String    @default("AUTO") @db.VarChar(8)
  escalatedToId    String?   @map("escalated_to_id") @db.Uuid
  leadEscalatedAt  DateTime? @map("lead_escalated_at")
  escalationReason String?   @map("escalation_reason") @db.VarChar(300)
  firstResponseAt  DateTime? @map("first_response_at")
  @@index([teamId])
```
> `escalationLevel`·`priority`·`escalatedAt`(기존) = **SLA 전용 유지**. 팀장 에스컬은 `leadEscalatedAt`/`escalatedToId`.

### 2.4 `ConsultMessage` 확장
```prisma
  senderId   String? @map("sender_id") @db.Uuid           // 발신 직원(다중 구분·환자 미반환)
  visibility String  @default("PATIENT") @db.VarChar(10)   // PATIENT|INTERNAL
```
sender VarChar 값에 `LEAD` 추가(스키마 변경 없음).

### 2.5 감사 — enum 확장 안 함 (검증 C-1 반영)
- 실제 `enum AuditAction`은 **CREATE/READ/UPDATE/DELETE 4개뿐**(`schema.prisma:57-62`). 코드베이스 9개 모듈이 세부동작을 **`changes.op` JSON**에 기록(예: cert-admin `UPDATE + {op:'ISSUE'}`).
- 본 기능도 동일 관례: `AuditService.log({ userId, action: 'UPDATE', resourceType:'ConsultSession'|'ConsultTeam', resourceId, changes:{ op:{ old:null, new:'CONSULT_ASSIGN' }, ...상세 } })`.
- `AuditService.log` 시그니처(`audit.service.ts:13-21`): `changes?: Record<string,{old,new}>` — op·대상 필드를 `{old,new}` 형태로 채움. **enum 마이그레이션 불필요.**

### 2.6 마이그레이션 (R11)
- `prisma db push`(무플래그) → 신규 모델/컬럼/enum 적용. **`--accept-data-loss` 금지**.
- 시드(`db execute`):
  1. 기본팀 `ConsultTeam{ name:'일반상담', isDefault:true, categories:["GENERAL"], defaultAiMode:'AUTO' }`.
  2. `INSERT ConsultAgent(userId, role='AGENT', teamId=기본팀) SELECT DISTINCT assignee_id FROM consult_sessions WHERE assignee_id IS NOT NULL`.
  3. 기존 세션 `teamId=기본팀` 백필, `aiMode` 기본 AUTO(자동 적용).
- LEAD/ADMIN 지정: 운영자가 ADMIN 1명 수동 승격(시드 또는 관리화면).

---

## 3. 라우팅 — `routeTeam(category, locale)`
```
teams = ConsultTeam.findMany({active:true})
match = teams.find(t => t.categories.includes(category) && (t.locales?.length? t.locales.includes(locale): true))
return (match ?? teams.find(t=>t.isDefault) ?? null).id
```
- **category 표준 코드값(검증 W-1 단일 확정)**: 영문 enum `GENERAL|INTERNATIONAL|CHECKUP|BILLING`(`ConsultTeam.categories`·`ConsultSession.category` 동일 값). FE는 라벨만 한글 표기. routeTeam은 정확 일치 매칭이므로 한/영 혼용 금지. **기존 `consult_sessions.category` 컬럼 현재값 점검 → 비표준값은 백필 시 `GENERAL` 정규화.**
- `openSession(patientId, locale, category?)` 시그니처 확장(R4). **`OpenDto`에 `@IsOptional() @IsIn(['GENERAL','INTERNATIONAL','CHECKUP','BILLING']) category?: string` 추가**(검증 W-8 — 데코레이터 없으면 whitelist ValidationPipe가 strip). 미선택 시 `GENERAL`.
- 상담원/팀장이 세션 category 변경 → `routeTeam` 재실행(재배정 시 팀 큐 이동).

**활성 세션 카운트 / 동시성(검증 W-9)**: `activeCount = count(ConsultSession where assigneeId=userId AND status='ACTIVE')`. claim/assign은 **트랜잭션 내** `activeCount < maxConcurrent` 검증 후 배정(경쟁 시 재검증) — 초과면 `CONSULT_AGENT_FULL` 거부. assignee 미존재 행만 claim 가능(이중 claim 방지: `updateMany where assigneeId=null`).

---

## 4. AI 게이트 — aiMode (R1)

`patientMessage` 흐름 분기(`session.aiMode` 우선순위: 세션 > 팀 > 전역 AUTO):

| aiMode | 동작 | 단계 |
|--------|------|------|
| AUTO | `processAsync`에서 번역 + **AI 응답 자동 저장·전송**(현행) | **P1** |
| OFF | AI 미호출. 번역만 | **P1** |
| SUGGEST | `processAsync`는 **번역만**. AI 초안을 Redis `consult:draft:{sid}`(TTL 1h)에 저장 → 데스크 "AI 초안" 패널, 상담원이 검토 후 `reply` 전송(미전송 상태) | **P3** |

- **P1 범위 정합(검증 W-7)**: 기획서 §12와 일치하도록 **P1은 AUTO/OFF 토글만**. `aiMode` 컬럼은 SUGGEST 값을 수용하되, **SUGGEST 처리(Redis 초안·`/ai-draft`·FE 초안 패널)는 P3**. → P1 구현에 RedisService 신규 의존 불필요(기존 사용처만).
- `PATCH /sessions/:id/ai-mode {mode}` → 세션 aiMode 변경(P1: AUTO|OFF, P3: +SUGGEST) + SSE `ai_mode`.
- 안전: AI 응답 면책 고지 prefix 유지, sender='AI'.

---

## 5. 에스컬레이션 상태기계 (R2)

```
[배정됨] ──escalate(reason)──▶ [팀장에스컬] (leadEscalatedAt set, escalatedToId=teamLead)
   ▲                               │
   │ resolve-escalation            ├─ join(note)      → 내부노트(visibility=INTERNAL) — 상태 유지
   └───────────────────────────────┼─ join(co-reply)  → LEAD가 환자 응답(assignee 유지)
                                    └─ transfer        → assigneeId=LEAD (escalation clear)
```
- **SLA 리셋 실제 코드 지점(검증 W-3)**: `claim`(consult.service.ts:196 `staffReply` 포함)·`checkEscalations` cron(225행)이 `escalationLevel=0/priority=NORMAL/escalatedAt=null` 리셋. → 이 3곳 모두 **`leadEscalatedAt/escalatedToId`는 절대 건드리지 않도록** 코드 리뷰 체크. `firstResponseAt`는 staffReply에서 첫 STAFF/LEAD 응답 시 set(§W-4 정합: AI 응답은 제외).
- SLA cron/`claim`/`staffReply`의 리셋은 `escalationLevel/priority/escalatedAt`만 — **lead 필드 불간섭**(R2 핵심).
- `escalate`: AGENT만, 본인 담당 세션. `escalatedToId`=세션 팀의 LEAD. **복수 LEAD면 첫 ONLINE LEAD, ONLINE LEAD 없으면 `escalatedToId=null`로 두고 `leadEscalatedAt`만 set → 팀 전체 LEAD 큐에 노출**(검증 D-5).
- **🔴 join(co-reply)는 `assigneeId` 보존(검증 D-2)**: 현행 `staffReply`가 `assigneeId=staffId`로 덮어쓰므로, 공동응답은 **`replyAs(...,{reassign:false})`** 별도 경로 사용. `firstResponseAt` 미설정 시 co-reply(LEAD)도 STAFF성 응답으로 set(검증 D-3, AI는 제외).
- `resolve-escalation`/`transfer`/`join`: LEAD/ADMIN만.
- 알림: 팀장 ONLINE→staff SSE 신호, OFFLINE→**`NotificationService.create()`(인앱) + `pushNotification()`(FCM)** 재사용(메서드 확인됨).

---

## 6. 내부노트 격리 + 환자 표기 정규화 (R3·검증 C-3/W-2 — 보안)
- **유일 방어선은 환자 `listMessages`**(consult.service.ts:89): `where visibility:'PATIENT'` 서버 강제. `getSessionInfo`는 메시지 미반환이라 대상 아님(검증 정정).
- **SSE는 신호만**(현행 `{t:Date.now()}`) — 내용 미전송, 환자는 신호 후 `listMessages` 재조회. 따라서 SSE 채널 격리 불필요, **재조회 엔드포인트 격리가 전부**. (§8의 "채널 분리"는 staff 부가신호용이며 환자 SSE 구조 변경 없음.)
- **환자 sender 정규화(서버)**: 환자 `listMessages` 반환 시 `sender` ∈ {STAFF, LEAD} → **`'STAFF'`로 정규화**(FE 라벨='상담팀'), `AI`→그대로(FE='AI 도우미'). `senderId`/직원명 **미반환**. → 'LEAD' 토큰 노출 차단(W-2).
- 직원 `staffMessages`: INTERNAL 포함, sender 원본(LEAD 구분) + senderId→직원명 조인 표시.
- `POST /sessions/:id/note {content}`: AGENT(담당)/LEAD → ConsultMessage{visibility:'INTERNAL', sender: role, senderId}. staff SSE 신호만.

---

## 7. API 계약

### 7.1 ADMIN — 팀/멤버 (`/consult/teams`, ConsultRole=ADMIN)
| 메서드 | 경로 | DTO |
|--------|------|-----|
| GET | `/consult/teams` | — → `[{...team, memberCount}]` |
| POST | `/consult/teams` | `CreateTeamDto{name, description?, categories[], locales[], defaultAiMode, isDefault?}` |
| PATCH | `/consult/teams/:id` | `UpdateTeamDto`(부분) |
| DELETE | `/consult/teams/:id` | active=false(소프트). isDefault 팀 삭제 거부 |
| GET | `/consult/teams/:id/members` | → `[{userId,name,role,status,maxConcurrent,activeCount}]` |
| POST | `/consult/teams/:id/members` | `UpsertMemberDto{userId, role, maxConcurrent?}` |
| DELETE | `/consult/teams/:id/members/:userId` | — |

### 7.2 상담원/팀장 공통 (`/consult/agents`)
| GET | `/consult/agents/me` | → `{role, status, team, maxConcurrent, activeCount}` |
| PATCH | `/consult/agents/me/status` | `{status}` (ONLINE/AWAY/BUSY) |

### 7.3 상담원 데스크 (확장, ConsultAgentGuard)
| GET | `/consult/staff/sessions?scope=mine|team|unassigned` | 팀 스코프 필터 |
| POST | `/consult/staff/sessions/:id/claim` | maxConcurrent 검증(R7) |
| POST | `/consult/staff/sessions/:id/reply` | 기존 + **firstResponseAt**(첫 STAFF/LEAD 응답 시만, AI 제외·검증 W-4) |
| POST | `/consult/staff/sessions/:id/note` | INTERNAL 노트 |
| POST | `/consult/staff/sessions/:id/escalate` | `{reason}` (AGENT) |
| PATCH | `/consult/staff/sessions/:id/ai-mode` | `{mode}` (P1: AUTO\|OFF) |
| GET | `/consult/staff/sessions/:id/ai-draft` | SUGGEST 초안 조회 **(P3)** |
| PATCH | `/consult/staff/sessions/:id/category` | 재분류→재라우팅 |

### 7.4 팀장 콘솔 (`/consult/lead`, ConsultRole=LEAD)
| GET | `/consult/lead/queue` | 팀 큐(§0-4 정렬) + 상담원 보드(부하) |
| POST | `/consult/lead/sessions/:id/assign` | `{agentUserId}` (maxConcurrent 검증) |
| POST | `/consult/lead/sessions/:id/join` | `{mode:'note'|'coreply', content}` |
| POST | `/consult/lead/sessions/:id/transfer` | 담당=본인 |
| POST | `/consult/lead/sessions/:id/resolve-escalation` | lead 필드 clear |

- 모든 변경 endpoint → `AuditService.log`(§2.5 액션) + 해당 SSE 이벤트.

---

## 8. SSE 이벤트 (확장)
- **🔴 현행 구조 결함(검증 D-1)**: `streams = Map<sessionId, Subject>` **단일 Subject를 환자(consult.controller.ts:79)·직원(consult-staff.controller.ts:69)이 공유**. `emit(id)`는 양쪽 모두에 전달 → 직원 전용 신호에 type을 실으면 환자도 수신. 단일 Subject로 "type 화이트리스트" **불가**.
- **해소 — Subject 2분리**: `streams`(환자) + **`staffStreams`(직원)** 신규 Map. `emit(id, scope)`:
  - `scope='both'` → message·status (환자+직원)
  - `scope='staff'` → note·assigned·escalated·escalation_resolved·lead_joined·ai_mode·transferred·상담원 status (직원만)
  - 직원 SSE 엔드포인트는 `getStaffStream(id)` 구독. 환자 엔드포인트는 기존 `getStream(id)` 유지.
- **신호는 여전히 내용 미전송**(`{t, type}`) — 환자는 신호 후 `listMessages`(visibility 격리) 재조회. 보안은 listMessages 필터가 보장, 2분리는 **불필요 재조회·type 누출 제거** 목적.

---

## 9. 가드/권한 (R6·검증 W-5/W-6)
- **가드 교체(결정)**: 기존 `@UseGuards(JwtAuthGuard, RolesGuard) @Roles(ADMIN,NURSE,DOCTOR)`(consult-staff.controller.ts:17-18) → **`@UseGuards(JwtAuthGuard, ConsultAgentGuard)`로 교체**. 접근 자격을 "직무 역할"이 아닌 **"상담원 등록(ConsultAgent 존재)"** 으로 전환. 등록은 ADMIN이 관리(명시적·최소권한).
- `ConsultAgentGuard`: JwtAuthGuard 뒤 `ConsultAgent.findUnique({userId})` → 없으면 **403 CONSULT_NOT_ENROLLED**(기획서 R6의 "401"은 403으로 통일 — 인증은 됐고 인가 실패).
- `@ConsultRole('LEAD'|'ADMIN')` 메타데이터 → role 검증. AGENT 기본 통과, LEAD는 AGENT 권한 포함, ADMIN은 전체.
- **ADMIN 역할 모델(W-6 결정)**: `ConsultAgent.role` ∈ {AGENT, LEAD, **ADMIN**} 3값. ADMIN 행은 **`teamId=null`(전팀 관리 의미)**.
- **🔴 부트스트랩(검증 D-4)**: 팀/멤버 API가 ConsultRole=ADMIN을 요구하는데 최초엔 ConsultAgent ADMIN 행이 없어 **아무도 팀 세팅 불가**(chicken-and-egg). → `@ConsultRole('ADMIN')` 판정 시 **`ConsultAgent.role='ADMIN'` OR 시스템 `UserRole.ADMIN` 폴백** 허용. 시스템 관리자가 최초 팀·ConsultAgent ADMIN을 생성 후 운영은 ConsultAgent ADMIN으로 이관. (LEAD/AGENT는 ConsultAgent 등록 필수, 폴백 없음.)
- 세션 소유 검증: AGENT의 claim/reply/escalate는 `assigneeId===me` 또는 미배정·동일 teamId. LEAD/ADMIN은 팀 내(ADMIN 전체).
- 백필(§2.6)로 기존 데스크 사용자 ConsultAgent(AGENT) 생성 → 403 회피. **NURSE/DOCTOR였지만 미백필자는 접근 불가**(의도된 최소권한; 필요 시 ADMIN이 추가 등록).

---

## 10. FE 화면
1. **상담원 데스크**(`/consult`): 좌측 탭 `내 상담(mine)`/`팀 큐(team)`/`미배정(unassigned)` + 상태 토글(ONLINE/AWAY/BUSY) + 대화창(내부노트 음영·접힘) + **AI 토글(AUTO/OFF·P1)** + `팀장 요청(에스컬)` 버튼. *(AI 초안 패널은 SUGGEST=P3)*
2. **팀장 콘솔**(`/consult/lead`): 상담원 보드(상태·activeCount/max·평균응답) + 큐(에스컬 상단 빨강) + 배정 드롭다운 + 세션 합류(내부노트/공동응답/이관/해제).
3. **팀 관리**(`/consult/admin` 또는 설정 내, ADMIN): 팀 CRUD·멤버 배정(role)·기본 AI모드·카테고리·언어·기본팀·maxConcurrent.
4. **환자 `_consult`**: AI=`AI 도우미`, 직원=`상담팀`(locale별 현지화·R10). 내부노트 비노출. 변경 최소.

---

## 11. 이벤트·감사
- 배정/에스컬/해제/이관/합류/AI모드/팀·멤버 변경 → `AuditService.log({action:'UPDATE', resourceType, resourceId, changes:{op:{old:null,new:'CONSULT_*'}, ...}})`(§2.5). 해시체인·블록체인 앵커링 기존 cron 자동 포함.
- 만족도(rating)·firstResponseAt → 팀장 분석(P3) 원천.

## 12. 테스트
- 단위: routeTeam(매칭/기본팀/미매칭), aiGate(AUTO/SUGGEST/OFF), 에스컬 필드분리(SLA 리셋이 lead 불간섭), visibility 필터(환자 INTERNAL 차단), maxConcurrent 초과 거부.
- 통합: open→route→claim→reply(firstResponseAt)→escalate→join(note)→transfer→close, 권한(AGENT가 lead endpoint 403).
- 회귀: 기존 포털 환자 채팅·AI 자동응답(aiMode AUTO 기본) 무변화.

## 13. 구현 순서
0. **ConsultModule.imports += [AuditModule, NotificationModule]**(검증 C-2 — 현재 `[I18nModule, PatientAuthModule, PortalModule]`만). AuditModule은 `exports:[AuditService]` 확인됨, NotificationModule export 확인.
1. 스키마(ConsultTeam/Agent/세션·메시지 컬럼) + `db push`(무플래그) + 시드/백필(§2.6). **AuditAction enum 변경 없음**(§2.5).
2. `ConsultAgentGuard`/`@ConsultRole`(ADMIN 폴백 D-4) + ConsultTeamService/ConsultAgentService
3. routeTeam + openSession category + **aiGate**: `patientMessage`(142행)는 `processAsync` 무조건 호출 → **processAsync 내부에서 번역은 항상, AI 블록(sender=AI 저장·스트리밍 299행)만 `aiMode==='AUTO'`일 때 실행**(검증 D-6). OFF=AI skip, SUGGEST(P3)=Redis 초안.
4. 상담원 데스크 API(scope·note·escalate·ai-mode·claim maxConcurrent·firstResponseAt) + **`listSessions`(155행)에 teamId/scope 필터 추가**(검증 D-7) + **`replyAs(reassign:false)`**(D-2)
5. 팀장 콘솔 API(queue·assign·join·transfer·resolve) + **SSE 2-Subject 분리**(staffStreams·D-1)
6. ADMIN 팀/멤버 API
7. FE: 관리(팀세팅)→데스크→팀장콘솔→환자 라벨
8. nest build + 테스트 + 배포(deploy.sh --schema --api)

## 14. 미해소(P3/후속)
- **상담원 OFFLINE/이탈 시 고아세션 처리(R8)** — P2 말 또는 후속: 상태 OFFLINE 전환·일정시간 무응답 시 세션 **팀 큐 반환(unassign)** 또는 팀장 알림. (본 설계 P1/P2 미포함.)
- AI 자동 상담원 배분(least-busy), category AI 자동분류, SUGGEST(AI 초안), 상담 분석 대시보드(해결율·AI비중), 다팀 동시소속, 외부 메신저 연동.

---

## 15. 검토 보완 2차 — 구현레벨 코드 정합 (2026-06-16, v1.1)

> v1.0 설계를 기존 `consult.service`/SSE/Notification 코드로 재대조해 발견한 **구현레벨 결함**. 1차(C/W)가 못 본 것.

| ID | 이슈 (코드 출처) | 해소 | 심각도 |
|----|------------------|------|--------|
| **D-1** | SSE `streams` **단일 Subject를 환자·직원 공유**(service:15, patient ctrl:79, staff ctrl:69) → 직원 전용 type가 환자에 누출 | **Subject 2분리**(`streams`/`staffStreams`) + `emit(id,scope)`. 신호는 내용 미전송 유지 — §8 | 🔴 |
| **D-2** | `staffReply`(service:196)가 매 답변 `assigneeId=staffId` 덮어씀 → **팀장 공동응답 시 담당 탈취** | 공동응답은 **`replyAs(...,{reassign:false})`** 별도 경로 — §5/§7.3 | 🔴 |
| **D-3** | `firstResponseAt`는 staffReply만 set → co-reply(LEAD) 누락 가능 | co-reply도 STAFF성 응답으로 set, AI 제외 — §5 | 🟡 |
| **D-4** | 팀 API가 ConsultRole=ADMIN 요구하나 **최초 ConsultAgent ADMIN 없음**(부트스트랩 불가) | `@ConsultRole('ADMIN')`에 **시스템 `UserRole.ADMIN` 폴백** — §9 | 🔴 |
| **D-5** | `escalatedToId` 단일 UUID — ONLINE LEAD 부재 시 대상 모호 | `escalatedToId=null` + `leadEscalatedAt`만 → 팀 전체 LEAD 큐 — §5 | 🟡 |
| **D-6** | `patientMessage`(142)가 `processAsync` 무조건 호출(AI 강제) | processAsync 내부 **번역=항상, AI 블록만 aiMode='AUTO'** 게이트 — §13.3 | 🟡 |
| **D-7** | `listSessions`(155)는 status 필터만 — 팀 스코프 없음 | teamId + scope(mine/team/unassigned) 필터 추가 — §13.4 | 🟡 |
| **D-8** | routeTeam 매칭·기본팀 모두 없을 때 | `teamId=null` → 글로벌 unassigned 큐(방어). 백필이 기본팀 보장 — §3 | 🟢 |

확인된 코드 출처: `consult.service.ts`(15 streams·142 patientMessage·155 listSessions·196 staffReply·278 processAsync), `consult.controller.ts:79`/`consult-staff.controller.ts:69`(공유 Subject), `notification.service.ts`(create·pushNotification 존재, 모듈 export 확인).

**구현 착수 가능** — 🔴 3건(D-1·D-2·D-4) 설계 반영 완료. 잔여는 구현 시 코드리뷰 체크포인트.
