# 상담데스크 확장 — 팀 운영·에스컬레이션 협업·AI 토글 기획서

> **상태(2026-09-15 코드 대조 갱신)**: 구현됨(일부) — 부서 큐 수동 이관 `apps/api/src/modules/consult/consult-staff.controller.ts:190` lead/sessions/:id/route · 빠른답변 템플릿 `apps/api/src/modules/consult/consult-template.service.ts`(R4 `b817fc87`, 자동 전송 없음·시드 문구 없음) · 잔여: 자동 상담원 배분(결정② 수동 기반 유지)

- **버전**: v1.2 (2026-06-16) — 기존 코드 정합성 검토 보완(§15, 정합성 12건·🔴 3건) 반영
- **이력**: v1.1 결정 5건 반영 → v1.2 코드 대조 검토(에스컬 필드분리·AI게이트·visibility필터 등)
- **대상**: `/consult` 통합상담실(직원 데스크) 확장
- **목적**: 상담원 다수 운영 + **팀장의 배정** + **상담원↔팀장 에스컬레이션 협업(같은 대화방에서 합류)** + **AI 답변 on/off**.
- **원칙**: 기존 `ConsultSession`·`ConsultMessage`·claim·escalation·AI 1차응답·번역·Jitsi·SSE·만족도를 **재사용**하고 팀/협업/AI토글만 얹는다.

---

## 1. 현황 (재사용 기반)

| 자산 | 내용 |
|------|------|
| `ConsultSession` | patientId·status(OPEN/WAITING/ACTIVE/CLOSED)·locale·category·**assigneeId**·**priority**(NORMAL/HIGH/URGENT)·**escalationLevel(0/1/2)**·escalatedAt·jitsiRoom·rating |
| `ConsultMessage` | sender(PATIENT/AI/STAFF)·content·**contentKo**(한국어)·attachmentUrl·lang·readAt |
| 엔드포인트 | 환자: open·message(→번역·**AI 1차응답**)·video·rate / 직원: sessions 인박스·**escalations(SLA)**·reply(번역)·video(모더레이터)·**claim**·close·**SSE** |
| 기능 | AI 자동 1차응답, 공유 번역엔진(다국어), Jitsi 1:1 화상, SSE 실시간, 만족도, SLA 에스컬레이션 |

→ 데이터(담당·우선순위·에스컬레이션 레벨)와 실시간·번역·AI 호출 골격은 **이미 존재**. 신규는 **팀 구조·배정 권한·내부 협업 채널·AI 토글** 4가지.

---

## 2. 목표 & 핵심 시나리오

```
환자 문의 → 큐(대기) → ① 팀장이 상담원에 배정 (또는 상담원 self-claim, 또는 자동 라우팅)
상담원 ↔ 환자 대화 (AI 토글: 자동/제안/수동)
상담원이 막히면 → ② 팀장에게 에스컬레이션
   → 팀장이 같은 대화방에 합류:
      (a) 내부 노트로 상담원에게 조언(환자 비노출) 또는
      (b) 환자에게 직접 응답(공동 담당) 또는
      (c) 이관(상담원→팀장 담당 전환)
종료 → 만족도 → 상담 이력/감사
```

---

## 3. 역할 & 팀 구조 (다팀 + 팀 세팅)

| 역할 | 권한 |
|------|------|
| **상담 관리자(ADMIN)** | **팀 생성/편집·멤버 배정·팀 기본설정(AI모드·카테고리)** — 팀 세팅 전반 |
| **팀장(LEAD)** | 소속 팀 큐 조회·**상담원에 배정/재배정**·에스컬레이션 수신·모든 세션 합류/이관·상담원 상태·팀 통계 |
| **상담원(AGENT)** | 배정/claim 한 세션 응대·환자 대화·**팀장 에스컬레이션**·종료 |
| **상담원 상태** | ONLINE / AWAY / BUSY / OFFLINE + **동시 상담 상한**(maxConcurrent) |

- **다팀 구조**(결정①): 부서·언어·분야별 복수 팀 운영. 세션은 카테고리/언어로 팀에 귀속 → 해당 팀 큐에 노출.
- 신설 모델 `ConsultTeam`(팀) + `ConsultAgent`(직원의 상담 프로필: role·status·skills·maxConcurrent·**teamId**).
- 역할은 RBAC 신규 없이 `ConsultAgent.role` 로 분리(기존 직원 계정 위에 상담 프로필 부여). 팀 세팅은 ADMIN 권한.

### 3-1. 팀 세팅 기능 (신규 — 결정①)
- **팀 CRUD**: 팀명·설명·담당 카테고리(예: 국제진료/검진/일반)·담당 언어·활성 여부.
- **멤버 배정**: 직원을 팀에 LEAD/AGENT 로 편성(한 직원 다팀 가능 여부는 1차 단일팀 소속 권장).
- **팀 기본설정**: **기본 AI 모드(AUTO/SUGGEST/OFF·결정③)**, 동시상담 상한 기본값, 운영시간(선택).
- **라우팅 규칙(수동 기반·결정②)**: 세션의 category/locale → 매칭 팀 큐로 인입. 미매칭 시 기본팀(default team)으로.

---

## 4. 배정 & 라우팅

> 결정②: **배정은 수동만**. 상담원 자동 배분은 P3 선택 항목으로 이연.

1. **세션 → 팀 인입(수동 라우팅 규칙)**: category/locale 매칭으로 담당 팀 큐에 노출(자동 상담원 배분 아님).
2. **팀장 수동 배정**: 팀 큐의 세션을 특정 상담원에게 배정/재배정.
3. **상담원 self-claim**(기존 claim 재사용): 미배정 세션을 직접 가져감(팀 정책으로 on/off).
4. **부하 가시화**: 상담원별 활성 세션 수·평균 응답시간(팀장 콘솔) — 팀장이 보고 수동 배정.
5. ~~자동 상담원 배분(least-busy·round-robin)~~ → **P3 선택**(결정②로 1차 제외).

---

## 5. 에스컬레이션 & 협업 (핵심 신규)

**에스컬레이션 2종 구분(R2 — 중요)**:
- **SLA 에스컬레이션(시스템·시간)**: 기존 `escalationLevel(0/1/2)`·`priority`·`escalatedAt` + cron. STAFF/AI 응답 시 **자동 리셋**(현행 유지).
- **팀장 에스컬레이션(상담원 수동·인적)**: 신규 `leadEscalatedAt`·`escalatedToId`·`escalationReason`. **SLA 리셋 로직과 무관** — 내부노트/팀장응답으로 지워지지 않음. 해제는 **명시적 endpoint**만.

- **에스컬레이션 트리거**: 상담원이 "팀장 요청"(사유 입력) → `leadEscalatedAt=now·escalatedToId=팀장·escalationReason`, SSE로 팀장에 알림(오프라인 시 푸시).
- **팀장 합류 3모드**:
  - **(a) 내부 노트(권장 기본)**: `ConsultMessage.visibility=INTERNAL` — **환자에게 안 보이는** 상담원↔팀장 측면 대화/조언. 같은 방, 다른 표시.
  - **(b) 공동 응답**: 팀장이 sender=LEAD 로 환자에게 직접 응답(상담원 유지). 환자에겐 "상담팀"으로 표기(개인정보 최소).
  - **(c) 이관**: assigneeId=팀장 으로 담당 전환(상담원 관전/해제).
- **에스컬레이션 해제**: 팀장이 "상담원에게 반환" → `leadEscalatedAt/escalatedToId` 클리어, 담당 복귀(SLA 필드 불간섭).
- **감사**: 에스컬레이션/이관/합류 이벤트 로그(누가·언제·사유).

---

## 6. AI 답변 on/off & 모드

기존 "환자 메시지 → AI 1차응답"을 **토글·모드화**.

| 모드 | 동작 |
|------|------|
| **AUTO(자동)** | 환자 메시지에 AI가 즉시 자동응답(현행). 야간·대기·간단 문의 |
| **SUGGEST(제안)** | AI가 **초안만 생성** → 상담원이 검토·수정·전송(반자동). 품질·안전 균형 |
| **OFF(수동)** | AI 미개입, 상담원 전담 |

- **기본모드 설정(결정③)**: 세션 생성 시 **팀 기본 AI모드**(`ConsultTeam.defaultAiMode`)를 상속 → 대화 중 상담원/팀장이 세션별 override(on/off). 팀 미지정 시 전역 기본 `consult.defaultAiMode`(기본값 AUTO).
- **우선순위**: 세션 override > 팀 기본 > 전역 기본.
- **범위**: 세션별 토글(상담원/팀장이 대화 중 on/off).
- **데이터**: `ConsultSession.aiMode`(AUTO/SUGGEST/OFF), `ConsultTeam.defaultAiMode`, 전역 `consult.defaultAiMode` config.
- **안전**: AI 응답엔 면책 고지, 의료적 판단은 의료진 연결로 유도(기존 disclaimer 재사용). AI 발화는 sender=AI 로 구분·감사.
- **AI 인입**: 기존 공유 AI(gpuKey·Ollama) 재사용. 상담 컨텍스트(최근 N메시지·카테고리) 주입.

---

## 7. 데이터 모델 변경 (최소)

```prisma
model ConsultTeam {                  // 상담 팀(다팀)
  id            String @id @default(uuid()) @db.Uuid
  name          String @db.VarChar(40)
  description   String? @db.VarChar(200)
  categories    Json?                            // 담당 카테고리 ["국제진료","검진",...]
  locales       Json?                            // 담당 언어 ["ko","en",...]
  defaultAiMode String @default("AUTO") @db.VarChar(8) // 팀 기본 AI 모드
  isDefault     Boolean @default(false) @map("is_default") // 미매칭 세션 수용 기본팀
  active        Boolean @default(true)
  agents        ConsultAgent[]
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")
  @@map("consult_teams")
}

model ConsultAgent {                 // 상담 프로필(직원 위에 부여)
  id            String @id @default(uuid()) @db.Uuid
  userId        String @unique @map("user_id") @db.Uuid
  teamId        String? @map("team_id") @db.Uuid           // 소속 팀
  team          ConsultTeam? @relation(fields: [teamId], references: [id])
  role          String @db.VarChar(8)            // LEAD|AGENT
  status        String @default("OFFLINE") @db.VarChar(8) // ONLINE|AWAY|BUSY|OFFLINE
  skills        Json?                            // {langs:[],categories:[]}
  maxConcurrent Int    @default(5) @map("max_concurrent")
  updatedAt     DateTime @updatedAt @map("updated_at")
  @@index([teamId])
  @@map("consult_agents")
}
```
`ConsultSession` 에 `teamId String?`(귀속 팀) 추가 — category/locale 라우팅 결과 저장, 팀 큐 필터에 사용.
`ConsultSession` 추가:
```
teamId          String?  @map("team_id") @db.Uuid         // 귀속 팀(라우팅 결과)
aiMode          String   @default("AUTO") @db.VarChar(8)  // AUTO|SUGGEST|OFF (기존 자동응답 보존=AUTO)
escalatedToId   String?  @map("escalated_to_id") @db.Uuid // 팀장 에스컬레이션 대상
leadEscalatedAt DateTime? @map("lead_escalated_at")       // 팀장 에스컬레이션 시각(SLA와 분리)
escalationReason String? @map("escalation_reason") @db.VarChar(300)
firstResponseAt DateTime? @map("first_response_at")       // 첫 직원응답(평균응답 지표)
```
> ⚠️ **`escalationLevel`/`priority`/`escalatedAt`(기존)는 SLA 미응답 에스컬레이션 전용으로 유지** — 팀장(수동) 에스컬레이션은 위 `leadEscalatedAt`/`escalatedToId` 별도 필드 사용(§15 R2).
`ConsultMessage` 추가:
```
senderId   String? @map("sender_id") @db.Uuid          // 발신 직원(다중 상담원 구분)
visibility String  @default("PATIENT") @db.VarChar(10) // PATIENT|INTERNAL(직원전용 노트)
```
- sender enum 값에 **LEAD** 추가(VarChar라 값만). AI SUGGEST 초안은 별도 저장 안 하고 전송 시 sender=STAFF.

---

## 8. API 설계 (신규/확장)

| 메서드 | 경로 | 설명 | 역할 |
|--------|------|------|------|
| GET/POST | `/consult/teams` | 팀 목록 / 생성 | ADMIN |
| PATCH/DELETE | `/consult/teams/:id` | 팀 수정(기본AI모드·카테고리·기본팀)/비활성 | ADMIN |
| GET | `/consult/teams/:id/members` | 팀 멤버(LEAD/AGENT) | ADMIN/LEAD |
| POST/DELETE | `/consult/teams/:id/members` | 멤버 배정/해제(role 지정) | ADMIN |
| GET | `/consult/agents/me` | 내 상담 프로필·상태·소속팀 | AGENT/LEAD |
| PATCH | `/consult/agents/me/status` | 내 상태(ONLINE/AWAY/BUSY) | AGENT/LEAD |
| GET | `/consult/lead/queue` | 팀 큐·상담원 부하·SLA | LEAD |
| POST | `/consult/lead/sessions/:id/assign` | 상담원 배정/재배정 | LEAD |
| POST | `/consult/staff/sessions/:id/escalate` | 팀장 에스컬레이션(사유) | AGENT |
| POST | `/consult/staff/sessions/:id/join` | 팀장 합류(co-handle) | LEAD |
| POST | `/consult/staff/sessions/:id/transfer` | 이관(담당 전환) | LEAD |
| POST | `/consult/staff/sessions/:id/note` | 내부 노트(visibility=INTERNAL) | AGENT/LEAD |
| PATCH | `/consult/staff/sessions/:id/ai-mode` | AI 모드(AUTO/SUGGEST/OFF) | AGENT/LEAD |
| POST | `/consult/staff/sessions/:id/ai-suggest` | AI 초안 생성(SUGGEST) | AGENT/LEAD |
| (확장) | `/consult/staff/sessions` | 인박스에 `scope`(mine/team/unassigned) 필터 | AGENT/LEAD |
| (재사용) | reply·claim·close·video·SSE | 기존 그대로 | |

- **SSE 이벤트 확장**: `assigned`·`escalated`·`lead_joined`·`note`·`ai_mode`·`transferred` 타입 추가 → 상담원/팀장 데스크 실시간 갱신.

---

## 9. 화면(UX)

1. **상담원 데스크**(`/consult`): 내 세션 탭(mine) / 큐(unassigned·claim) / 대화창(환자 메시지 + **내부 노트는 음영/접힘**) + **AI 토글·AI 초안 버튼** + **팀장 요청(에스컬레이션)** 버튼 + 화상.
2. **팀장 콘솔**(`/consult/lead`): 소속 팀 큐·상담원 보드(상태·부하·평균응답) · 에스컬레이션 인박스(빨강) · 배정/재배정 · 세션 합류(내부노트/공동응답/이관).
3. **팀 관리 콘솔**(`/consult/admin` 또는 관리자 설정 내, ADMIN): 팀 CRUD · 멤버 배정(LEAD/AGENT) · 팀 기본 AI모드·카테고리·언어·기본팀 지정 · 동시상담 상한.
4. **환자**(포털 `_consult`): 변화 최소 — 응답 직원은 **'상담팀'으로 일원화 표기**(개인명 비노출·결정⑤), **AI 응답은 'AI 도우미' 등으로 구분 표시**(투명성·결정④), 내부노트는 비노출.

---

## 10. 권한·보안·감사

- 역할: `ConsultAgent.role`(LEAD/AGENT)로 라우트 가드. 팀장만 배정/합류/이관.
- **내부 노트 격리**: visibility=INTERNAL 은 환자 API(listMessages)에서 **항상 제외**(서버 강제) — PHI/내부 의견 노출 방지.
- AI 발화 구분(sender=AI)·면책 고지, 의료 판단은 의료진 연결 유도.
- 감사: 배정·에스컬레이션·이관·AI모드 변경·내부노트 작성 = AuditLog(누가·언제·세션).
- 만족도/상담 이력은 환자별 조회 권한 내.

---

## 11. 기능 요구사항 (FR)

- FR-0 **팀 세팅**: 팀 CRUD·멤버 배정(LEAD/AGENT)·팀 기본설정(AI모드·카테고리·언어·기본팀)
- FR-1 상담 프로필(LEAD/AGENT)·상태·동시상한·소속팀
- FR-2 팀장 큐(소속 팀)·상담원 부하 보드
- FR-3 팀장 **수동** 배정/재배정 + 상담원 self-claim
- FR-4 세션→팀 수동 라우팅(category/locale 매칭, 미매칭=기본팀) / 자동 상담원 배분은 P3 선택
- FR-5 상담원→팀장 에스컬레이션(사유·SSE 알림)
- FR-6 팀장 합류 3모드: 내부노트·공동응답·이관
- FR-7 내부 노트(환자 비노출, 서버 격리)
- FR-8 AI 모드 토글(AUTO/SUGGEST/OFF) 세션·전역
- FR-9 AI 초안 생성(SUGGEST) → 상담원 검토 전송
- FR-10 SSE 이벤트 확장(배정·에스컬·합류·노트·AI모드)
- FR-11 감사·만족도·상담 이력
- FR-12 환자 측 투명성(AI/상담팀 표기), 내부노트 비노출

---

## 12. Phase 로드맵

| Phase | 범위 |
|-------|------|
| **P1** | **팀 세팅(ConsultTeam CRUD·멤버 배정·팀 기본설정)** + ConsultAgent(역할·상태·소속팀), 팀장 큐·**수동 배정/재배정**, 세션→팀 라우팅, 상담원 데스크 mine/unassigned, **AI 토글(AUTO/OFF)·팀 기본모드 상속** |
| **P2** | **에스컬레이션→팀장 합류**(내부노트·공동응답·이관), SSE 확장, 팀장 콘솔 보드(부하·SLA), 환자측 'AI/상담팀' 표기 |
| **P3** | **AI SUGGEST(초안→검토)**, (선택)자동 상담원 배분(least-busy), 상담 분석(응답시간·해결율·AI비중) |

---

## 13. Out of Scope (1차)
- 그룹/다자 화상(현 1:1 Jitsi 유지)
- 외부 메신저(카카오·웹챗) 연동 — Phase 4+
- 챗봇 단독 자동완결(AI는 보조·제안, 최종 책임은 상담원)

---

## 14. 검토 포인트 — **확정됨 (2026-06-16)**
1. ✅ **다팀** 구성 + **팀 세팅 기능 추가**(팀 CRUD·멤버 배정·팀 기본설정) — §3-1
2. ✅ 배정은 **수동**(세션→팀 라우팅 + 팀장 수동 배정). 자동 상담원 배분은 P3 선택 — §4
3. ✅ AI는 **기본모드 설정** 방식: 팀 기본(`defaultAiMode`) 상속 → 세션 override. 전역 기본 AUTO — §6
4. ✅ 환자에게 **AI/직원 구분 표기**(AI 응답은 'AI 도우미'로 명시·투명성) — §9
5. ✅ 직원 응답은 개인명 대신 **'상담팀'으로 일원화 표기** — §9

### 잔여 확정(설계 시)
- 한 직원의 **다팀 소속** 허용 여부(1차: 단일팀 권장)
- 팀 세팅 권한자(ADMIN) — 기존 어느 역할에 매핑할지(상담 운영 관리자)

---

## 15. 검토 보완 — 기존 코드 정합성 (2026-06-16)

> 기존 `consult.service` 구현을 대조해 발견한 정합성 이슈와 해소 방안. **설계·구현 시 필수 반영.**

| ID | 이슈 (현행 코드) | 해소 방안 |
|----|------------------|-----------|
| **R1** | `processAsync`가 환자 메시지마다 **AI 1차응답을 무조건 생성**(백그라운드) | **`aiMode`로 게이트**: AUTO=현행대로 자동전송 / SUGGEST=초안만 생성·상담원 대기열에 표시(미전송) / OFF=AI 미호출. 기본 AUTO로 두면 **현 동작 보존**. |
| **R2** 🔴 | `checkEscalations` cron·`claim`이 STAFF/AI 응답 시 `escalationLevel=0·priority=NORMAL·escalatedAt=null`로 **자동 리셋** | **필드 분리**(§7): SLA(시스템·시간)는 기존 3필드 유지. **팀장(수동) 에스컬레이션은 `leadEscalatedAt`/`escalatedToId`** 사용 → 리셋 로직이 건드리지 않음. 팀장 에스컬 해제는 **명시적 endpoint**(`/resolve-escalation`). 미수정 시 내부노트·팀장응답이 수동 에스컬을 지워버림. |
| **R3** 🔴 | 환자 `listMessages`에 **visibility 필터 없음** → 내부노트 추가 시 환자에게 노출 위험 | 환자 `listMessages`·환자 SSE는 **`visibility='PATIENT'`만 반환**(서버 강제). 직원 API만 INTERNAL 포함. |
| **R4** | `openSession(patientId, locale)`만 받음 — **`category` 미설정**(라우팅 키 부재) | 세션 오픈/초기에 **category 캡처**(환자 선택 or AI 분류 or 상담원 지정). P1은 **locale+category→팀 매칭**, 미매칭=기본팀. category UI(환자/상담원) 필요. |
| **R5** | `AuditService.log` 의 `action`은 **Prisma `AuditAction` enum** — 임의 문자열 불가 | 스키마 `enum AuditAction`에 **CONSULT_ASSIGN·ESCALATE·TRANSFER·JOIN·AIMODE·TEAM_UPDATE** 추가(마이그레이션) 또는 기존 일반 액션 매핑. |
| **R6** | 기존 staff 상담 endpoint는 **JwtAuthGuard만**(아무 직원 claim 가능) | **`ConsultAgentGuard`** 신설(ConsultAgent.role 조회) → AGENT/LEAD/ADMIN 분기. 배포 시 **기존 데스크 사용 직원 ConsultAgent 백필** 필요(미백필 시 401). |
| **R7** | claim/배정에 **maxConcurrent 미검증** | 배정/claim 시 상담원 활성 세션 수 < maxConcurrent 검증. 도달 시 자동 **status=BUSY** 표시. |
| **R8** | 상담원 OFFLINE/이탈 시 **세션 고아화**(assignee 남음) | 상담원 OFFLINE 전환·일정시간 무응답 시 → 세션 **팀 큐로 반환(unassign)** 또는 팀장 알림. |
| **R9** | 평균 응답시간 지표 **원천 데이터 없음** | `firstResponseAt`(첫 STAFF 메시지 시 기록) 추가(§7). 팀장 보드·분석에 활용. |
| **R10** | 환자 표기 **'상담팀'·'AI 도우미'** 다국어 | 환자 `locale` 기준 라벨 현지화(번역 엔진 재사용). 표기는 FE 라벨(메시지 sender 기반), 직원 개인정보 미반환. |
| **R11** | 마이그레이션 — 기존 세션엔 `teamId`/`aiMode` 없음 | `db execute`로 **기본팀 시드 + 기존 세션 teamId 백필**, `aiMode` 기본 AUTO(현 동작 유지). `prisma db push`(무플래그) 사용·`--accept-data-loss` 금지. |
| **R12** | 포털 환자 플로우 호환 | 환자측 `_consult` 변경 최소. 기존 AI 자동응답=기본(aiMode AUTO)으로 **회귀 없음**. |

### 보완 반영 결과
- §5 에스컬레이션: SLA(시스템) vs 팀장(수동) **2종 구분** 명시 → 필드·해제 로직 분리(R2).
- §6 AI: `aiMode` 게이트가 `processAsync`를 감쌈(R1), SUGGEST=미전송 초안(R1).
- §7 데이터: `teamId·leadEscalatedAt·escalatedToId·escalationReason·firstResponseAt` 추가.
- §9/§10 보안: 환자 API visibility 필터(R3), 환자 표기 현지화·개인정보 비노출(R10).
- 신규: `ConsultAgentGuard`(R6) + `AuditAction` enum 확장(R5) + 마이그 백필(R11).

### P1 착수 전 선결(설계에서 확정)
1. **category 분류 방식**: 환자 선택 드롭다운 vs AI 자동분류 vs 상담원 사후지정 (P1은 환자 선택 권장)
2. **ConsultAgentGuard 백필 범위**: 현재 상담 데스크 사용 직원 명단
3. **AuditAction enum 확장 vs 일반액션 매핑** 결정
4. SLA 에스컬레이션과 팀장 에스컬레이션 **동시 발생 시 우선순위 표기**(팀장 큐 정렬)
