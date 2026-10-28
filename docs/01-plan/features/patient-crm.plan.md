# 환자 CRM (Patient CRM) 기획서 v1.1

> **상태(2026-09-15 코드 대조 갱신)**: 구현됨(일부) — `GET campaigns/:id/logs` `apps/api/src/modules/crm/crm.service.ts:275` · `GET automation/reminders` `apps/api/src/modules/crm/crm-reminder-jobs.ts`(R3 `3f6e71cc`) · 예약 대행 4종 예약 정본 경유(`37a0296e`) · 잔여: `POST automation/reminders/run`·발송 크론 4종 설정 게이트·승인(사람 — 대외 발신 3조건); `proxy/checkup-reserve`·`proxy/reception`(사람 — CRM 역할 권한)

> **작성일**: 2026-06-02
> **수정일**: 2026-06-02 (v1.1 — 검진+해외환자 우선, CRM 부서 전용)
> **수준**: Enterprise
> **우선순위**: 높음 (검진 재방문 + 해외환자 유치 + 환자 리텐션)
> **사용 부서**: CRM 부서 (별도 조직, ADMIN 권한)
> **현재 상태**: 기반 인프라 있음 (FCM/SMS/알림/만족도), CRM 전용 모듈 없음

---

## 1. 개요

### 1.1 목적

**CRM 부서**가 전담으로 사용하는 환자 관계 관리 시스템. 건강검진 재방문 유도, 해외환자 유치·관리, 만성질환 리텐션을 **별도 서비스**로 구축한다.

### 1.2 CRM 부서 역할

| 역할 | 업무 |
|------|------|
| **검진 CRM 담당** | 검진 프로그램 마케팅, 재검진 리마인더, 이상 소견 추적 관리 |
| **해외환자 CRM 담당** | 해외환자 유치, 의료관광 패키지, 통역 조율, 사후 관리 |
| **리텐션 담당** | 이탈 환자 감지, 재방문 캠페인, 만성질환 관리 |
| **캠페인 담당** | 멀티채널 캠페인 기획·실행·분석 |

### 1.3 우선순위

```
Phase 1: 검진 CRM + 해외환자 CRM (핵심 매출)
Phase 2: 일반 리텐션 + 만성질환 관리
Phase 3: 캠페인 고도화 + AI 최적화
```

### 1.2 현재 vs TO-BE

| 항목 | 현재 | TO-BE |
|------|------|-------|
| **리마인더** | 수동 (reminderSent 플래그만) | Cron 자동 발송 (SMS/Push/카카오) |
| **재방문 유도** | 없음 | AI 기반 재방문 권고 + 자동 캠페인 |
| **환자 세분화** | tags 필드만 | 행동 기반 자동 세그먼트 (RFM) |
| **캠페인** | 없음 | 템플릿 기반 멀티채널 캠페인 |
| **이탈 감지** | 없음 | 마지막 방문 기준 이탈 위험 점수 |
| **소통 이력** | 분산 (알림/메시지/SMS 각각) | 통합 커뮤니케이션 로그 |
| **동의 관리** | marketingConsent 1필드 | 채널별·유형별 세분화 동의 |
| **분석** | 만족도 NPS만 | 리텐션/이탈/LTV/캠페인 ROI |

### 1.3 핵심 가치

| 가치 | 설명 | KPI |
|------|------|-----|
| **재방문률 향상** | 정기검진/만성질환 관리 리마인더 | 재방문률 +15% |
| **이탈 방지** | 6개월 미방문 환자 자동 감지 + 연락 | 이탈률 -20% |
| **환자 만족** | 진료 후 자동 follow-up + 만족도 조사 | NPS +10 |
| **운영 효율** | 수동 전화 → 자동 캠페인 | 원무 업무 -30% |
| **매출 기여** | 건강검진/예방접종 프로모션 | 검진 예약 +25% |

---

## 2. 기존 인프라 활용

### 2.1 이미 있는 것 (재활용)

| 인프라 | 위치 | CRM 활용 |
|--------|------|---------|
| **FCM 푸시** | `fcm-push.service.ts` + PatientDevice | 캠페인 푸시 발송 |
| **SMS OTP** | `sms-otp.service.ts` + SmsVerification | SMS 캠페인 발송 확장 |
| **알림 모델** | PatientNotification + NotificationSetting | 채널별 수신 설정 |
| **만족도** | `satisfaction.service.ts` + NPS | 진료 후 자동 설문 |
| **환자 태그** | Patient.tags (String[]) | 세그먼트 태깅 |
| **VIP 환자** | VipPatient 모델 | 우선 관리 대상 |
| **검진 추적** | CheckupFollowUp (reminderSent) | 검진 리마인더 |
| **치과 리콜** | DentalRecall (6개월/1년) | 리콜 자동화 |
| **마케팅 동의** | PatientAccount.marketingConsent | 동의 기반 발송 |
| **환자 여정** | PatientJourneyEvent | 행동 추적 |
| **예약 상태** | Appointment (NO_SHOW 추적) | 미방문 감지 |

### 2.2 새로 만들어야 할 것

| 기능 | 설명 |
|------|------|
| **CRM 캠페인 엔진** | 템플릿 + 대상자 + 스케줄 + 발송 + 추적 |
| **환자 세그먼트** | RFM 분석, 행동 기반 자동 분류 |
| **커뮤니케이션 로그** | 모든 채널 소통 통합 이력 |
| **리마인더 자동화** | Cron 기반 예약/검진/투약 리마인더 |
| **이탈 감지** | 마지막 방문 기반 위험 점수 + 알림 |
| **CRM 대시보드** | 리텐션/이탈/캠페인/세그먼트 시각화 |
| **동의 관리** | 채널별·유형별 Opt-in/out 이력 |

---

## 3. 데이터 모델

### 3.1 신규 모델

```prisma
// ── CRM 캠페인 ──

model CrmCampaign {
  id              String    @id @default(uuid()) @db.Uuid
  name            String    @db.VarChar(200)
  type            String    @db.VarChar(30)   // REMINDER, RECALL, PROMOTION, FOLLOW_UP, REENGAGEMENT, SURVEY, ANNOUNCEMENT
  channel         String    @db.VarChar(20)   // SMS, PUSH, PORTAL, EMAIL, WHATSAPP, WECHAT, ALL
  status          String    @default("DRAFT") @db.VarChar(20)  // DRAFT, SCHEDULED, SENDING, COMPLETED, CANCELLED
  
  // 대상
  segmentId       String?   @map("segment_id") @db.Uuid
  targetCount     Int       @default(0) @map("target_count")
  
  // 콘텐츠
  templateId      String?   @map("template_id") @db.Uuid
  subject         String?   @db.VarChar(200)
  content         String    @db.Text
  variables       Json?     @db.JsonB          // {patientName, nextAppointment, ...}
  
  // 스케줄
  scheduledAt     DateTime? @map("scheduled_at") @db.Timestamptz()
  sentAt          DateTime? @map("sent_at") @db.Timestamptz()
  completedAt     DateTime? @map("completed_at") @db.Timestamptz()
  
  // 결과
  sentCount       Int       @default(0) @map("sent_count")
  deliveredCount  Int       @default(0) @map("delivered_count")
  openedCount     Int       @default(0) @map("opened_count")
  clickedCount    Int       @default(0) @map("clicked_count")
  failedCount     Int       @default(0) @map("failed_count")
  
  createdBy       String    @map("created_by") @db.Uuid
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.Timestamptz()

  segment         CrmSegment?     @relation(fields: [segmentId], references: [id])
  template        CrmTemplate?    @relation(fields: [templateId], references: [id])
  logs            CrmCampaignLog[]

  @@index([status, scheduledAt])
  @@map("crm_campaigns")
}

model CrmCampaignLog {
  id            String    @id @default(uuid()) @db.Uuid
  campaignId    String    @map("campaign_id") @db.Uuid
  patientId     String    @map("patient_id") @db.Uuid
  channel       String    @db.VarChar(20)    // SMS, PUSH, KAKAO, EMAIL
  status        String    @db.VarChar(20)    // SENT, DELIVERED, OPENED, CLICKED, FAILED, BOUNCED
  sentAt        DateTime? @map("sent_at") @db.Timestamptz()
  deliveredAt   DateTime? @map("delivered_at") @db.Timestamptz()
  openedAt      DateTime? @map("opened_at") @db.Timestamptz()
  errorMessage  String?   @map("error_message") @db.VarChar(500)
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  campaign      CrmCampaign @relation(fields: [campaignId], references: [id])

  @@index([campaignId, status])
  @@index([patientId])
  @@map("crm_campaign_logs")
}

// ── CRM 템플릿 ──

model CrmTemplate {
  id          String    @id @default(uuid()) @db.Uuid
  name        String    @db.VarChar(200)
  type        String    @db.VarChar(30)    // REMINDER, RECALL, PROMOTION, FOLLOW_UP, SURVEY
  channel     String    @db.VarChar(20)    // SMS, PUSH, KAKAO, EMAIL
  subject     String?   @db.VarChar(200)
  content     String    @db.Text           // {{patientName}}, {{appointmentDate}} 변수 지원
  isActive    Boolean   @default(true) @map("is_active")
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz()

  campaigns   CrmCampaign[]

  @@map("crm_templates")
}

// ── 환자 세그먼트 ──

model CrmSegment {
  id          String    @id @default(uuid()) @db.Uuid
  name        String    @db.VarChar(200)
  description String?   @db.Text
  type        String    @db.VarChar(20)    // MANUAL, AUTO, RFM
  rules       Json      @db.JsonB          // 세그먼트 조건 (lastVisit, department, age, gender, diagnosis...)
  patientCount Int      @default(0) @map("patient_count")
  isActive    Boolean   @default(true) @map("is_active")
  lastRefreshedAt DateTime? @map("last_refreshed_at") @db.Timestamptz()
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz()

  campaigns   CrmCampaign[]

  @@map("crm_segments")
}

// ── 커뮤니케이션 로그 (통합) ──

model PatientCommunicationLog {
  id          String    @id @default(uuid()) @db.Uuid
  patientId   String    @map("patient_id") @db.Uuid
  channel     String    @db.VarChar(20)    // SMS, PUSH, KAKAO, EMAIL, CALL, VISIT
  direction   String    @db.VarChar(10)    // OUTBOUND, INBOUND
  type        String    @db.VarChar(30)    // REMINDER, RECALL, CAMPAIGN, MANUAL, SYSTEM
  subject     String?   @db.VarChar(200)
  content     String?   @db.Text
  status      String    @db.VarChar(20)    // SENT, DELIVERED, READ, FAILED
  campaignId  String?   @map("campaign_id") @db.Uuid
  sentBy      String?   @map("sent_by") @db.Uuid
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  @@index([patientId, createdAt])
  @@index([campaignId])
  @@map("patient_communication_logs")
}

// ── 마케팅 동의 관리 ──

model PatientConsent {
  id          String    @id @default(uuid()) @db.Uuid
  patientId   String    @map("patient_id") @db.Uuid
  channel     String    @db.VarChar(20)    // SMS, PUSH, KAKAO, EMAIL, ALL
  type        String    @db.VarChar(30)    // MARKETING, REMINDER, SURVEY, ANNOUNCEMENT
  consented   Boolean
  consentedAt DateTime? @map("consented_at") @db.Timestamptz()
  withdrawnAt DateTime? @map("withdrawn_at") @db.Timestamptz()
  source      String?   @db.VarChar(30)    // PORTAL, APP, RECEPTION, PHONE
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz()

  @@unique([patientId, channel, type])
  @@map("patient_consents_crm")
}
```

### 3.2 Patient 모델 확장 필드

```prisma
// Patient 모델에 추가
  crmScore        Int?      @default(0) @map("crm_score")          // 0~100 환자 가치 점수
  lastContactAt   DateTime? @map("last_contact_at") @db.Timestamptz()
  churnRisk       String?   @map("churn_risk") @db.VarChar(10)     // LOW, MEDIUM, HIGH
  rfmSegment      String?   @map("rfm_segment") @db.VarChar(20)    // CHAMPION, LOYAL, AT_RISK, LOST...
  preferredChannel String?  @map("preferred_channel") @db.VarChar(20) // SMS, PUSH, KAKAO
```

---

## 4. 검진 CRM (Phase 1-A)

### 4.1 검진 대상자 관리

```
┌─ 검진 CRM 대시보드 ─────────────────────────────────────┐
│                                                          │
│ [검진 대상자]     [프로그램별 현황]   [이상 소견 추적]      │
│                                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ 대상자 분류                                           │ │
│ │                                                      │ │
│ │ 1. 연간 검진 대상 (국가검진 짝수/홀수년)               │ │
│ │ 2. 직장인 검진 (계약 기업 직원)                        │ │
│ │ 3. 재검진 대상 (이상 소견 → 3개월/6개월 후 재검)       │ │
│ │ 4. VIP 검진 (프리미엄 프로그램 고객)                   │ │
│ │ 5. 해외환자 검진 (의료관광 패키지)                     │ │
│ │                                                      │ │
│ │ 필터: 프로그램 | 기간 | 상태 | 이상소견유무             │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 4.2 검진 자동 캠페인

| 캠페인 | 대상 | 시점 | 채널 | 메시지 |
|--------|------|------|------|--------|
| **국가검진 안내** | 짝수/홀수년 대상자 | 매년 1월 | SMS+카카오 | "올해 국가건강검진 대상입니다. 예약하세요." |
| **재검진 리마인더** | 이상 소견 환자 | 추적일 D-14 | SMS+Push | "3개월 전 검진 이상 소견 재검 안내" |
| **직장검진 모집** | 계약 기업 | 매년 3월 | 이메일+전화 | "직원 건강검진 일정 조율" |
| **VIP 검진 갱신** | 프리미엄 고객 | 갱신일 D-30 | 전화+카카오 | "프리미엄 검진 갱신 안내" |
| **검진 만족도** | 검진 완료 환자 | D+3 | Push | "검진 경험 만족도 설문" |
| **검진 결과 안내** | 결과 확정 | 즉시 | Push+SMS | "검진 결과가 나왔습니다. 포털에서 확인하세요." |

### 4.3 이상 소견 추적 관리

```
검진 결과에서 이상 소견 발견
  ↓
자동 CheckupFollowUp 생성 (RECHECK / OUTPATIENT)
  ↓
CRM 부서에 추적 대상자 목록 표시
  ↓
┌─────────────────────────────────────────────┐
│ 추적 관리 워크플로우                          │
│                                             │
│ D+0:  결과 안내 (Push/SMS)                   │
│ D+7:  "이상 소견 관련 외래 예약을 권장합니다"  │
│ D+14: 미예약 시 전화 연락 (CRM 담당)          │
│ D+30: 최종 리마인더                           │
│ D+60: 미방문 → 이탈 위험 → 담당의 알림        │
└─────────────────────────────────────────────┘
```

### 4.4 검진 프로그램 실적 분석

| 지표 | 설명 |
|------|------|
| 프로그램별 예약/완료/취소 건수 | 14개 프로그램 개별 추적 |
| 재검진 전환율 | 이상 소견 → 외래 방문 비율 |
| 기업 계약 현황 | 계약 기업별 직원 검진율 |
| 검진 매출 추이 | 월별/분기별 검진 매출 |
| 고객 유지율 | 작년 검진 → 올해 재방문 비율 |

---

## 5. 해외환자 CRM (Phase 1-B)

### 5.1 해외환자 유형별 관리

| 유형 | patientSource | CRM 전략 |
|------|:---:|------|
| **의료관광객** | FOREIGN_TOURIST | 패키지 안내, 통역 조율, 사후 관리 |
| **거주 외국인** | FOREIGN_RESIDENT | 정기 검진 안내, 보험 안내 |
| **재외동포** | OVERSEAS_KOREAN | 귀국 검진, 한국어 서비스 |
| **원격진료** | REMOTE_INTERNATIONAL | 화상 진료 후 방문 유도 |

### 5.2 해외환자 CRM 워크플로우

```
┌─ 유치 단계 ──────────────────────────────────────────────┐
│                                                          │
│ 1. 문의 접수 (웹폼/이메일/에이전시)                        │
│ 2. CRM 부서 담당자 배정                                   │
│ 3. 상담 기록 (소통 이력 → PatientCommunicationLog)         │
│ 4. 견적 발송 (프로그램+숙박+통역 패키지)                    │
│ 5. 예약 확정 → 비자 서류 발급 안내                         │
│                                                          │
├─ 방문 단계 ──────────────────────────────────────────────┤
│                                                          │
│ 6. 입국 확인 → 픽업 조율                                  │
│ 7. 통역 배정 (interpreterNeeded 기반)                     │
│ 8. 검진/진료 진행 → 실시간 상태 추적                       │
│ 9. 결과 설명 (통역 동반)                                  │
│ 10. 수납 → 보험/여행자보험 청구 안내                       │
│                                                          │
├─ 사후 관리 ──────────────────────────────────────────────┤
│                                                          │
│ 11. D+1: 만족도 설문 (다국어)                              │
│ 12. D+7: 결과 요약 이메일 (영문 소견서 첨부)                │
│ 13. D+30: Follow-up 연락 ("경과 확인")                    │
│ 14. D+180: 재방문 유도 ("정기 검진 안내")                   │
│ 15. 연 1회: 프로모션 안내 (의료관광 패키지)                  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 5.3 해외환자 전용 데이터

```prisma
// CrmForeignPatientCase (해외환자 케이스 관리)
model CrmForeignPatientCase {
  id              String    @id @default(uuid()) @db.Uuid
  patientId       String    @map("patient_id") @db.Uuid
  assignedTo      String    @map("assigned_to") @db.Uuid  // CRM 담당자
  
  // 유입 경로
  source          String    @db.VarChar(30)   // WEBSITE, AGENCY, REFERRAL, EMBASSY, SNS
  agencyName      String?   @map("agency_name") @db.VarChar(200)
  
  // 방문 정보
  arrivalDate     DateTime? @map("arrival_date") @db.Date
  departureDate   DateTime? @map("departure_date") @db.Date
  accommodation   String?   @db.VarChar(200)
  interpreterLang String?   @map("interpreter_lang") @db.VarChar(10) // en, zh, ja, vi, ru
  
  // 패키지
  packageType     String?   @map("package_type") @db.VarChar(30) // CHECKUP_BASIC, CHECKUP_PREMIUM, TREATMENT, SURGERY
  estimatedCost   Decimal?  @map("estimated_cost") @db.Decimal(12,0)
  actualCost      Decimal?  @map("actual_cost") @db.Decimal(12,0)
  
  // 상태
  status          String    @default("INQUIRY") @db.VarChar(20) // INQUIRY, QUOTED, CONFIRMED, ARRIVED, IN_TREATMENT, DISCHARGED, FOLLOW_UP, CLOSED
  
  // 만족도
  satisfactionScore Int?    @map("satisfaction_score") // 1~5
  
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.Timestamptz()

  @@index([patientId])
  @@index([assignedTo, status])
  @@map("crm_foreign_patient_cases")
}
```

### 5.4 해외환자 다국어 커뮤니케이션

| 언어 | 1차 채널 | 2차 채널 | 템플릿 |
|------|---------|---------|--------|
| 영어 (en) | WhatsApp | Email + SMS | 예약 확인, 결과 안내, Follow-up |
| 중국어 (zh) | WeChat | Email | 검진 패키지, 결과 요약 |
| 일본어 (ja) | WhatsApp | Email | 검진 안내, 사후 관리 |
| 베트남어 (vi) | WhatsApp | SMS | 기본 안내 |
| 러시아어 (ru) | WhatsApp | Email | 기본 안내 |

> **WeChat**: 중국 환자 전용 (중국 내 SMS/Push 불가)
> **WhatsApp**: 중국 외 해외환자 공통 채널 (글로벌 커버리지)
> **카카오**: 국내 환자 대상, 백로그 (향후 검토)

다국어 템플릿: CrmTemplate에 `locale` 필드 추가

```prisma
// CrmTemplate 확장
  locale      String    @default("ko") @db.VarChar(5) // ko, en, zh, ja, vi, ru
```

### 5.5 해외환자 CRM 대시보드

| 지표 | 설명 |
|------|------|
| 국적별 환자 분포 | nationality 기반 차트 |
| 유입 경로별 전환율 | WEBSITE/AGENCY/REFERRAL → 예약 확정 비율 |
| 패키지별 매출 | CHECKUP_BASIC/PREMIUM/TREATMENT/SURGERY |
| 에이전시별 실적 | 계약 에이전시별 환자 수/매출 |
| 만족도 추이 | 국적별/패키지별 NPS |
| 재방문율 | 해외환자 재방문 비율 (12개월 기준) |

---

## 6. CRM 부서 전용 접근 체계

### 6.1 역할 및 권한

| 역할 | 접근 범위 | 기능 |
|------|---------|------|
| **CRM 관리자** | CRM 허용 데이터 전체 | 캠페인 생성/발송, 세그먼트, 설정, 분석 |
| **검진 CRM** | 검진 환자 (CRM 뷰) | 검진 대상자 관리, 리마인더, 추적 |
| **해외환자 CRM** | 해외 환자 (CRM 뷰) | 케이스 관리, 견적, 통역, 사후 관리 |
| **캠페인 담당** | 캠페인 | 캠페인 생성/실행, 템플릿 관리, 결과 분석 |

### 6.2 의료법 기반 데이터 접근 제한

CRM 부서는 **비의료 부서**이므로, 의료법에 따라 진료 정보 접근이 엄격히 제한된다.

#### 접근 가능 (CRM 허용 데이터)

| 데이터 | 출처 | 용도 |
|--------|------|------|
| 환자 기본정보 | Patient | 이름, 연락처, 생년월일, 성별 |
| 예약 정보 | Appointment | 예약일, 진료과, 상태 (의사명 제외 가능) |
| 검진 프로그램 | CheckupVisit | 프로그램명, 예약일, 완료 여부 |
| 검진 추적 상태 | CheckupFollowUp | 추적 유형, 기한, 완료 여부 (소견 내용 제외) |
| 수납 정보 | Billing | 수납 금액, 상태 (진단명 제외) |
| 마케팅 동의 | PatientConsent | 채널별 동의 상태 |
| 소통 이력 | PatientCommunicationLog | 발송 이력, 응답 |
| 만족도 | SatisfactionResponse | 점수, 피드백 텍스트 |
| 해외환자 | nationality, patientSource, travelInsurance | 국적, 유입 경로 |
| 방문 이력 (요약) | Encounter (집계만) | 마지막 방문일, 방문 횟수, 방문 진료과 |

#### 접근 불가 (의료법 제21조 제한)

| 데이터 | 법적 근거 | 대응 |
|--------|---------|------|
| **진료 기록 (SOAP)** | 의료법 제21조 (기록 열람 제한) | API에서 필터링 |
| **진단명 (ICD-10)** | 개인정보보호법 (민감정보) | CRM API에 노출 안 함 |
| **검사 결과 (수치)** | 의료법 제21조 | "이상 소견 유무"만 전달 (Y/N) |
| **처방 내역** | 의료법 제21조 | 접근 차단 |
| **수술 기록** | 의료법 제21조 | 접근 차단 |
| **간호 기록** | 의료법 제21조 | 접근 차단 |
| **주민등록번호** | 개인정보보호법 제24조 | 마스킹, CRM 노출 안 함 |
| **영상/병리 결과** | 의료법 제21조 | 접근 차단 |

#### 기술적 구현

```typescript
// CRM 전용 환자 조회 API — 의료 정보 제외
async getCrmPatientProfile(patientId: string) {
  const patient = await this.prisma.patient.findUnique({
    where: { id: patientId },
    select: {
      // ✅ CRM 허용
      id: true, familyName: true, givenName: true, mrn: true,
      dateOfBirth: true, gender: true, phone: true, email: true,
      nationality: true, patientSource: true, tags: true,
      preferredLanguage: true, insuranceType: true,
      
      // ❌ 의료 정보 제외 — select에 포함하지 않음
      // nationalId, allergies, problemList, bloodType 등 제외
    },
  });

  // 방문 이력: 집계만 (진료 내용 없음)
  const visitSummary = await this.prisma.encounter.aggregate({
    where: { patientId },
    _count: true,
    _max: { createdAt: true },
  });

  // 검진: 프로그램명 + 상태만 (결과 수치 제외)
  const checkups = await this.prisma.checkupVisit.findMany({
    where: { patientId },
    select: {
      id: true, scheduledDate: true, status: true,
      program: { select: { name: true } },
      // ❌ items, results, findings 제외
    },
  });

  // 이상 소견: 유무만 (내용 제외)
  const hasAbnormalFindings = await this.prisma.checkupFollowUp.count({
    where: { visit: { patientId }, status: { not: 'COMPLETED' } },
  }) > 0;

  return {
    patient,
    visitCount: visitSummary._count,
    lastVisitAt: visitSummary._max.createdAt,
    checkups,
    hasAbnormalFindings, // true/false만, 소견 내용 없음
  };
}
```

#### CRM API 보안 규칙

```
1. CRM 전용 API 경로: /api/v1/crm/* (일반 의료 API와 분리)
2. CRM 역할 전용 Guard: @Roles(UserRole.CRM_MANAGER, UserRole.CRM_STAFF)
3. 의료 데이터 API 접근 차단: CRM 역할은 /api/v1/encounters, /api/v1/lab-results 등 호출 불가
4. 감사 로그: CRM 부서의 모든 환자 데이터 조회 기록 (AuditLog)
5. 진단명 필터: CRM API 응답에 diagnosis, assessment, subjective 등 필드 절대 포함 안 함
6. BTG(Break-The-Glass) 불가: CRM 역할에는 BTG 권한 미부여
7. 예약/접수 대행: CRM 부서가 환자 대신 예약 생성 가능 (createdBy에 CRM 담당자 기록)
```

### 6.3 예약·접수 대행 기능

CRM 부서는 전화 상담이나 캠페인 응답 시 **환자 대신 예약/접수를 대행**할 수 있다.

#### 대행 가능 범위

| 기능 | 가능 여부 | 비고 |
|------|:--------:|------|
| **예약 생성** | ✅ | 진료과 + 날짜 + 시간 지정 |
| **예약 변경** | ✅ | 기존 예약 날짜/시간 변경 |
| **예약 취소** | ✅ | 사유 기록 필수 |
| **검진 예약** | ✅ | 프로그램 + 날짜 지정 |
| **접수 대행** | ✅ | 당일 방문 접수 (대기열 추가) |
| **진료 기록 조회** | ❌ | 의료법 제한 |
| **처방/검사 오더** | ❌ | 의료 행위 불가 |

#### 대행 워크플로우

```
┌─ CRM 담당자 → 환자 전화 상담 ──────────────────────────┐
│                                                        │
│ 1. 환자 검색 (이름/MRN/전화번호)                         │
│ 2. CRM 프로필 확인 (허용 데이터만)                       │
│ 3. 예약 대행                                            │
│    ├─ 진료과 선택                                       │
│    ├─ 가용 날짜/시간 조회                                │
│    ├─ 예약 생성 (createdBy: CRM 담당자 ID)               │
│    └─ 환자에게 확인 SMS 자동 발송                        │
│ 4. 소통 이력 기록 (PatientCommunicationLog)              │
│    direction: INBOUND, channel: CALL                    │
│    content: "검진 예약 대행 — 6/15 종합검진 프리미엄"      │
│                                                        │
└────────────────────────────────────────────────────────┘
```

#### 대행 이력 추적

```typescript
// 예약 대행 시 감사 추적
interface ProxyBooking {
  appointmentId: string;
  patientId: string;
  bookedBy: string;        // CRM 담당자 ID
  bookedByRole: 'CRM_STAFF' | 'CRM_MANAGER';
  channel: 'CALL' | 'CAMPAIGN_RESPONSE' | 'WALK_IN';
  note?: string;           // "전화 상담 중 검진 예약 대행"
}

// Appointment 모델 활용 (기존 필드)
// createdBy → CRM 담당자 ID
// source → 'CRM_PROXY' (신규 값)
```

#### API

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/v1/crm/proxy/appointment` | 예약 대행 (진료과+날짜+시간) |
| PUT | `/api/v1/crm/proxy/appointment/:id/reschedule` | 예약 변경 대행 |
| DELETE | `/api/v1/crm/proxy/appointment/:id` | 예약 취소 대행 (사유 필수) |
| POST | `/api/v1/crm/proxy/checkup-reserve` | 검진 예약 대행 (프로그램+날짜) |
| POST | `/api/v1/crm/proxy/reception` | 당일 접수 대행 (대기열 추가) |
| GET | `/api/v1/crm/proxy/available-slots` | 가용 시간대 조회 |
| GET | `/api/v1/crm/proxy/patient-search` | 환자 검색 (CRM 허용 데이터만) |

#### FE — CRM 상담 화면

```
┌─ CRM 상담 화면 (/crm/consultation) ──────────────────────┐
│                                                          │
│ [환자 검색] ___김영수___ [검색]                            │
│                                                          │
│ ┌─ 환자 정보 (CRM 뷰) ──┐  ┌─ 예약 대행 ──────────────┐ │
│ │ 김영수 (P2026-0001)    │  │ 진료과: [내과 ▼]          │ │
│ │ 남 / 68세              │  │ 날짜: [2026-06-15 ▼]     │ │
│ │ 📞 010-1234-5678       │  │ 시간: [09:30 ▼]          │ │
│ │                        │  │                          │ │
│ │ 마지막 방문: 2026-05-29 │  │ 사유: [정기 검진_______] │ │
│ │ 방문 횟수: 12회         │  │                          │ │
│ │ 검진 이력: 2건          │  │ [예약 생성]  [검진 예약]  │ │
│ │ 이상 소견: 있음          │  │                          │ │
│ │ 동의: SMS ✅ Push ✅     │  │ ─── 또는 ─────────────  │ │
│ │                        │  │                          │ │
│ │ [소통 이력 보기]        │  │ [당일 접수 대행]          │ │
│ └────────────────────────┘  └──────────────────────────┘ │
│                                                          │
│ ┌─ 소통 이력 ────────────────────────────────────────────┐│
│ │ 06/02 14:30 📞 인바운드 "검진 예약 문의" — 박CRM       ││
│ │ 05/28 10:00 📱 SMS "정기 검진 안내" — 캠페인 자동       ││
│ │ 05/15 09:00 📱 Push "예약 리마인더" — 시스템            ││
│ └────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

### 6.2 사이드바 메뉴

```
CRM (CRM 부서 전용)
  ├─ CRM 대시보드           /crm
  ├─ 검진 CRM
  │   ├─ 검진 대상자        /crm/checkup/targets
  │   ├─ 이상 소견 추적     /crm/checkup/follow-ups
  │   └─ 프로그램 실적      /crm/checkup/analytics
  ├─ 해외환자 CRM
  │   ├─ 케이스 관리        /crm/international/cases
  │   ├─ 에이전시 관리      /crm/international/agencies
  │   └─ 해외환자 실적      /crm/international/analytics
  ├─ 캠페인
  │   ├─ 캠페인 관리        /crm/campaigns
  │   └─ 템플릿             /crm/templates
  ├─ 세그먼트               /crm/segments
  ├─ 소통 이력              /crm/communications
  └─ 자동화 설정            /crm/automation
```

### 6.3 UserRole 확장

```prisma
// UserRole enum에 추가
  CRM_MANAGER   // CRM 부서 관리자
  CRM_STAFF     // CRM 부서 담당자
```

---

## 7. 환자 포털 연동 (Portal Integration)

### 7.1 연동 개요

CRM 부서에서 작성한 콘텐츠가 **환자 포털(/portal)** 과 **모바일 앱**에 직접 노출된다. 환자가 포털에 로그인하면 CRM이 보낸 안내·홍보·설문을 확인할 수 있다.

```
CRM 부서 (발송)                    환자 포털 (수신)
┌──────────────┐                   ┌──────────────────────────┐
│ 안내 메시지   │ ──Push+포털──→    │ 📬 메시지함 (인앱)         │
│ 홍보 배너    │ ──포털 배너──→    │ 🎯 메인 배너/팝업          │
│ 설문 조사    │ ──Push+포털──→    │ 📋 설문 응답 폼            │
│ 공지사항     │ ──포털 게시──→    │ 📢 공지 탭                 │
│ 이벤트      │ ──SMS+포털──→    │ 🎁 이벤트 페이지           │
└──────────────┘                   └──────────────────────────┘
```

### 7.2 포털 메시지함 (인앱 메시지)

CRM이 발송한 메시지를 환자 포털 내 **전용 메시지함**에서 확인.

```
┌─ 포털 메시지함 (/portal/messages) ─────────────────────┐
│                                                        │
│ [전체] [안내] [홍보] [설문] [공지]                       │
│                                                        │
│ ┌─────────────────────────────────────────────────────┐│
│ │ 🔴 NEW                                    6/2 14:30 ││
│ │ 정기 건강검진 안내                                    ││
│ │ 김영수님, 올해 국가건강검진 대상자입니다.               ││
│ │ [검진 예약하기]                                      ││
│ ├─────────────────────────────────────────────────────┤│
│ │                                            5/28     ││
│ │ 진료 만족도 설문                                     ││
│ │ 최근 진료 경험에 대해 알려주세요.                      ││
│ │ [설문 참여하기]                                      ││
│ ├─────────────────────────────────────────────────────┤│
│ │                                            5/15     ││
│ │ 🎁 여름 건강검진 프로모션                              ││
│ │ 프리미엄 검진 20% 할인 (6월 한정)                     ││
│ │ [자세히 보기]                                        ││
│ └─────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────┘
```

### 7.3 포털 배너 / 팝업 관리

CRM 부서가 포털 메인 화면의 **배너와 팝업**을 직접 관리.

| 유형 | 위치 | CRM 관리 | 예시 |
|------|------|---------|------|
| **메인 배너** | 포털 대시보드 상단 슬라이드 | 이미지+링크+기간 설정 | "여름 검진 프로모션" |
| **팝업** | 포털 로그인 시 | 1일 1회/기간 설정 | "국가검진 안내" |
| **인라인 배너** | 포털 각 탭 사이 | 타겟 세그먼트별 | "고혈압 관리 프로그램" |
| **푸시 배너** | 모바일 앱 홈 | 앱 열 때 | "검진 결과 확인하세요" |

```prisma
model CrmPortalBanner {
  id            String    @id @default(uuid()) @db.Uuid
  type          String    @db.VarChar(20)   // MAIN_BANNER, POPUP, INLINE, PUSH_BANNER
  title         String    @db.VarChar(200)
  content       String?   @db.Text
  imageUrl      String?   @map("image_url") @db.VarChar(500)
  linkUrl       String?   @map("link_url") @db.VarChar(500)
  linkType      String?   @map("link_type") @db.VarChar(20) // INTERNAL, EXTERNAL, CHECKUP_RESERVE, SURVEY
  
  // 타겟팅
  segmentId     String?   @map("segment_id") @db.Uuid  // 특정 세그먼트만 노출
  targetAll     Boolean   @default(true) @map("target_all")
  
  // 기간
  publishFrom   DateTime  @map("publish_from") @db.Timestamptz()
  publishUntil  DateTime  @map("publish_until") @db.Timestamptz()
  
  // 노출 규칙
  showOncePerDay Boolean  @default(false) @map("show_once_per_day") // 팝업: 1일 1회
  sortOrder     Int       @default(0) @map("sort_order")
  isActive      Boolean   @default(true) @map("is_active")
  
  // 통계
  impressionCount Int     @default(0) @map("impression_count")
  clickCount    Int       @default(0) @map("click_count")
  
  createdBy     String    @map("created_by") @db.Uuid
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt     DateTime  @updatedAt @map("updated_at") @db.Timestamptz()

  @@index([type, isActive, publishFrom, publishUntil])
  @@map("crm_portal_banners")
}
```

### 7.4 설문 발송 + 포털 응답

CRM 부서가 설문을 생성 → 세그먼트별 발송 → 환자가 포털에서 응답.

```
CRM 부서                                환자 포털
┌──────────────────┐                    ┌──────────────────────────┐
│ 1. 설문 생성      │                    │                          │
│    (만족도/NPS/   │                    │                          │
│     건강설문/     │                    │                          │
│     서비스평가)   │                    │                          │
│                  │                    │                          │
│ 2. 대상 선택      │                    │                          │
│    (세그먼트/전체) │                    │                          │
│                  │                    │                          │
│ 3. 발송          │                    │                          │
│    ├─ Push 알림  │ ──────────────→   │ 📱 "설문에 참여해주세요"   │
│    ├─ SMS       │ ──────────────→   │ 💬 "설문 링크: ..."        │
│    └─ 포털 메시지│ ──────────────→   │ 📬 메시지함에 설문 카드    │
│                  │                    │                          │
│ 4. 결과 수집      │ ←─────────────── │ ✏️ 포털에서 응답 제출      │
│    (실시간 대시보드)│                   │                          │
└──────────────────┘                    └──────────────────────────┘
```

기존 `SatisfactionSurvey` + `SatisfactionResponse` 모델을 재활용하되, CRM 발송 연동 추가:

```typescript
// CRM에서 설문 발송
interface CrmSurveyDispatch {
  surveyId: string;           // 기존 SatisfactionSurvey ID
  segmentId?: string;         // CRM 세그먼트
  channels: ('PUSH' | 'SMS' | 'PORTAL' | 'KAKAO')[];
  scheduledAt?: Date;         // 예약 발송
  message?: string;           // 커스텀 안내 메시지
}
```

### 7.5 포털 연동 API

| Method | Endpoint | 호출자 | 설명 |
|--------|----------|--------|------|
| **CRM 발송용** | | | |
| POST | `/api/v1/crm/portal/message` | CRM | 포털 메시지 발송 (개별/세그먼트) |
| POST | `/api/v1/crm/portal/message/bulk` | CRM | 포털 메시지 대량 발송 |
| CRUD | `/api/v1/crm/portal/banners` | CRM | 배너/팝업 관리 (4 API) |
| POST | `/api/v1/crm/portal/survey/dispatch` | CRM | 설문 발송 |
| GET | `/api/v1/crm/portal/survey/:id/results` | CRM | 설문 결과 조회 |
| | | | |
| **환자 포털용** | | | |
| GET | `/api/v1/portal/crm/messages` | 환자 | 내 메시지함 목록 |
| PATCH | `/api/v1/portal/crm/messages/:id/read` | 환자 | 메시지 읽음 처리 |
| GET | `/api/v1/portal/crm/banners` | 환자 | 현재 노출 배너 목록 |
| POST | `/api/v1/portal/crm/banners/:id/click` | 환자 | 배너 클릭 추적 |
| GET | `/api/v1/portal/crm/surveys/pending` | 환자 | 미완료 설문 목록 |

### 7.6 발송 채널 매트릭스

CRM 콘텐츠가 어떤 채널로 전달되는지:

| 콘텐츠 | Push | SMS | 포털 메시지 | 포털 배너 | 이메일 | WeChat | WhatsApp | 카카오 |
|--------|:----:|:---:|:--------:|:-------:|:-----:|:------:|:--------:|:-----:|
| 예약 리마인더 | ✅ | ✅ | ✅ | - | Phase2 | - | - | 백로그 |
| 검진 안내 | ✅ | ✅ | ✅ | ✅ | Phase2 | - | - | 백로그 |
| 프로모션/이벤트 | ✅ | ✅ | ✅ | ✅ | Phase2 | - | - | 백로그 |
| 만족도 설문 | ✅ | - | ✅ | - | - | - | - | - |
| 검사 결과 알림 | ✅ | ✅ | ✅ | - | - | - | - | - |
| 공지사항 | - | - | ✅ | ✅ | - | - | - | - |
| 해외환자 안내 | - | ✅(국제) | ✅ | - | ✅ | ✅(중국) | ✅(기타) | - |
| 해외환자 사후관리 | - | - | - | - | ✅ | ✅(중국) | ✅(기타) | - |

### 7.7 포털 FE 변경

| 페이지 | 경로 | 변경 |
|--------|------|------|
| **포털 대시보드** | `/portal` | CRM 배너 슬라이드 + 미읽은 메시지 배지 |
| **메시지함** (신규) | `/portal/messages` | CRM 메시지 목록 + 읽음 처리 + 액션 버튼 |
| **설문 응답** (신규) | `/portal/surveys/:id` | 설문 폼 + 제출 |
| **팝업** | 포털 레이아웃 | 로그인 시 CRM 팝업 표시 (1일 1회) |
| **모바일 홈** | 모바일 앱 | 배너 카드 + 메시지 알림 |

---

## 8. 일반 리텐션 CRM (Phase 2)

### 7.1 자동 리마인더 시스템

```
┌─ Cron (매일 09:00) ──────────────────────────────────────┐
│                                                          │
│  1. 예약 리마인더 (D-1)                                    │
│     → 내일 예약 있는 환자 → SMS/Push "내일 09:30 내과 예약" │
│                                                          │
│  2. 검진 리마인더                                          │
│     → CheckupFollowUp.dueDate D-7 → "검진 일주일 전"       │
│     → CheckupFollowUp.dueDate D-1 → "내일 검진"           │
│                                                          │
│  3. 투약 리마인더                                          │
│     → 활성 처방 종료 D-3 → "처방약 재방문 안내"              │
│                                                          │
│  4. 치과 리콜                                              │
│     → DentalRecall 상태 SCHEDULED, dueDate D-14           │
│     → "정기 치과 검진 안내"                                 │
│                                                          │
│  5. 만성질환 관리                                           │
│     → 고혈압/당뇨 환자, 마지막 방문 90일+ → "정기 진료 안내" │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 4.2 환자 세그먼트 (RFM 분석)

| 세그먼트 | R (최근성) | F (빈도) | M (금액) | 행동 |
|---------|:-:|:-:|:-:|------|
| **챔피언** | 최근 | 자주 | 높음 | VIP 관리, 감사 메시지 |
| **충성 환자** | 최근 | 자주 | 중간 | 리워드, 추천 유도 |
| **잠재 충성** | 최근 | 보통 | 높음 | 재방문 유도 캠페인 |
| **이탈 위험** | 3개월+ | 자주→감소 | 중간 | 긴급 리텐션 캠페인 |
| **이탈** | 6개월+ | 감소 | - | 재활성화 캠페인 |
| **신규** | 최근 | 1회 | - | 환영 시퀀스 |

```typescript
// RFM 점수 계산
interface RfmScore {
  recency: number;    // 1~5 (최근 방문일 기준)
  frequency: number;  // 1~5 (방문 횟수 기준)
  monetary: number;   // 1~5 (총 수납액 기준)
  segment: string;    // CHAMPION | LOYAL | POTENTIAL | AT_RISK | CHURNED | NEW
  score: number;      // 0~100
}
```

### 4.3 캠페인 워크플로우

```
┌─ 캠페인 생성 ──────────────────────────────────────────┐
│                                                        │
│  1. 유형 선택: 리마인더 / 리콜 / 프로모션 / 재방문 유도    │
│  2. 대상 선택: 세그먼트 또는 수동 선택                     │
│  3. 채널 선택: SMS / Push / 포털 / 이메일 / WhatsApp / WeChat │
│  4. 템플릿 선택 또는 작성 (변수: {{이름}}, {{날짜}} 등)    │
│  5. 스케줄 설정: 즉시 / 예약 / 반복 (매주/매월)           │
│  6. 미리보기 + 테스트 발송                                │
│  7. 실행 → 발송 → 결과 추적                              │
│                                                        │
└────────────────────────────────────────────────────────┘
         ↓
┌─ 발송 파이프라인 ──────────────────────────────────────┐
│                                                        │
│  대상자 목록 로드                                        │
│    ↓                                                   │
│  동의 확인 (PatientConsent)                              │
│    ├─ 동의 없음 → Skip (로그 기록)                       │
│    └─ 동의 있음 →                                       │
│         ↓                                              │
│  변수 치환 ({{patientName}} → "김영수")                  │
│    ↓                                                   │
│  채널별 발송                                             │
│    ├─ SMS → SmsService.send()                          │
│    ├─ Push → FcmPushService.send()                     │
│    ├─ WhatsApp → WhatsAppService.send() (해외환자)      │
│    ├─ WeChat → WeChatService.send() (중국 환자)         │
│    └─ Email → EmailService.send() (향후)               │
│    ↓                                                   │
│  결과 기록 (CrmCampaignLog + PatientCommunicationLog)    │
│    ↓                                                   │
│  통계 갱신 (sentCount, deliveredCount, ...)              │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### 4.4 이탈 감지 + 재활성화

```
┌─ Cron (매주 월요일 06:00) ──────────────────────────────┐
│                                                         │
│  1. 전체 환자 마지막 방문일 스캔                           │
│                                                         │
│  2. 이탈 위험 분류:                                       │
│     ├─ 90일 미방문 + 만성질환 → HIGH (즉시 연락)           │
│     ├─ 180일 미방문 → MEDIUM (캠페인 대상)                │
│     └─ 365일 미방문 → CHURNED (재활성화 캠페인)            │
│                                                         │
│  3. churnRisk 필드 업데이트                               │
│                                                         │
│  4. HIGH 환자 → 담당의에게 알림                           │
│     "김영수님 (고혈압) 90일 미방문. 진료 권유 필요."        │
│                                                         │
│  5. MEDIUM 환자 → 자동 리텐션 캠페인 발송                  │
│     "건강은 안녕하세요? 정기 진료를 권장합니다."             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 5. API 설계

### 5.1 CRM 캠페인

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/v1/crm/campaigns` | 캠페인 생성 |
| GET | `/api/v1/crm/campaigns` | 캠페인 목록 (필터: status, type) |
| GET | `/api/v1/crm/campaigns/:id` | 캠페인 상세 + 통계 |
| PUT | `/api/v1/crm/campaigns/:id` | 캠페인 수정 (DRAFT만) |
| POST | `/api/v1/crm/campaigns/:id/send` | 캠페인 발송 실행 |
| POST | `/api/v1/crm/campaigns/:id/schedule` | 캠페인 예약 발송 |
| PATCH | `/api/v1/crm/campaigns/:id/cancel` | 캠페인 취소 |
| GET | `/api/v1/crm/campaigns/:id/logs` | 발송 로그 (환자별) |

### 5.2 세그먼트

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/v1/crm/segments` | 세그먼트 생성 (조건 기반) |
| GET | `/api/v1/crm/segments` | 세그먼트 목록 |
| GET | `/api/v1/crm/segments/:id` | 세그먼트 상세 + 환자 목록 |
| POST | `/api/v1/crm/segments/:id/refresh` | 세그먼트 환자 수 갱신 |
| DELETE | `/api/v1/crm/segments/:id` | 세그먼트 삭제 |

### 5.3 템플릿

| Method | Endpoint | 설명 |
|--------|----------|------|
| CRUD | `/api/v1/crm/templates` | 템플릿 CRUD (4 API) |
| POST | `/api/v1/crm/templates/:id/preview` | 변수 치환 미리보기 |

### 5.4 자동화

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/v1/crm/automation/reminders` | 자동 리마인더 현황 |
| POST | `/api/v1/crm/automation/reminders/run` | 수동 리마인더 실행 |
| GET | `/api/v1/crm/automation/churn-analysis` | 이탈 분석 실행 |

### 5.5 대시보드

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/v1/crm/dashboard` | CRM 대시보드 (리텐션/이탈/캠페인/세그먼트) |
| GET | `/api/v1/crm/dashboard/retention` | 코호트별 리텐션율 |
| GET | `/api/v1/crm/dashboard/rfm` | RFM 세그먼트 분포 |

### 5.6 환자 CRM 프로필

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/v1/crm/patients/:id/profile` | 환자 CRM 프로필 (RFM, 이력, 동의) |
| GET | `/api/v1/crm/patients/:id/communications` | 소통 이력 |
| PUT | `/api/v1/crm/patients/:id/consent` | 마케팅 동의 관리 |

---

## 6. FE 페이지

| 페이지 | 경로 | 역할 |
|--------|------|------|
| **CRM 대시보드** | `/crm` | 리텐션율, 이탈 현황, 캠페인 성과, RFM 차트 |
| **캠페인 목록** | `/crm/campaigns` | 캠페인 CRUD + 상태 관리 |
| **캠페인 생성** | `/crm/campaigns/new` | 유형→대상→채널→템플릿→스케줄 위자드 |
| **캠페인 상세** | `/crm/campaigns/:id` | 발송 결과 + 환자별 로그 |
| **세그먼트** | `/crm/segments` | 세그먼트 관리 + 조건 빌더 |
| **템플릿** | `/crm/templates` | 템플릿 CRUD + 변수 미리보기 |
| **환자 CRM** | 환자 차트 탭 | CRM 프로필 (RFM, 소통이력, 동의) |
| **자동화 설정** | `/crm/automation` | 리마인더/이탈감지 Cron 설정 |

---

## 7. 의료법 준수

### 7.1 관련 법규

| 법규 | 조항 | 요구사항 | 대응 |
|------|------|---------|------|
| **개인정보보호법** | 제15조 | 마케팅 목적 개인정보 수집·이용 동의 필수 | PatientConsent 모델로 채널별 동의 관리 |
| **개인정보보호법** | 제22조 | 마케팅 동의는 별도 동의 (필수 동의와 분리) | 진료 동의와 마케팅 동의 별도 수집 |
| **의료법** | 제56조 | 의료광고 규제 (과장/허위 금지) | 템플릿 검수 프로세스 필수 |
| **정보통신망법** | 제50조 | 영리 목적 광고성 메시지 수신 동의 | Opt-in 기반, 수신거부 링크 필수 |
| **정보통신망법** | 제50조의8 | 야간 광고 금지 (21시~08시) | 발송 시간 제한 (08:00~21:00) |

### 7.2 동의 관리 규칙

```
발송 전 확인:
  1. PatientConsent에서 해당 채널+유형 동의 확인
  2. 동의 없으면 발송 차단 + 로그 기록 (status: CONSENT_DENIED)
  3. 발송 시간 확인 (08:00~21:00)
  4. SMS/카카오: "[광고]" 표시 + 수신거부 안내 필수
  5. 의료 목적 리마인더 (예약/검진)는 마케팅 동의 불필요 (진료 목적)
```

---

## 8. 구현 우선순위

| Phase | 내용 | 예상 |
|:-----:|------|:----:|
| **1A-1** | Prisma 모델 (7개: 기본6 + ForeignPatientCase) + Patient 확장 + UserRole | 0.5일 |
| **1A-2** | 검진 CRM — 대상자 관리 + 이상 소견 추적 서비스 | 1일 |
| **1A-3** | 검진 CRM — 자동 캠페인 6종 (Cron) | 1일 |
| **1A-4** | 검진 CRM — FE 대시보드 + 대상자 + 프로그램 실적 | 1.5일 |
| **1B-1** | 해외환자 CRM — 케이스 관리 서비스 (INQUIRY→CLOSED) | 1일 |
| **1B-2** | 해외환자 CRM — 다국어 템플릿 + 사후 관리 자동화 | 1일 |
| **1B-3** | 해외환자 CRM — FE 케이스/에이전시/실적 페이지 | 1.5일 |
| **1C-1** | 캠페인 엔진 — CRUD + 발송 파이프라인 | 1일 |
| **1C-2** | 세그먼트 — RFM 계산 + 조건 빌더 | 1일 |
| **1C-3** | FE — 캠페인 위자드 + 세그먼트 + 사이드바 메뉴 | 1.5일 |
| **1-TEST** | 테스트 + 배포 | 0.5일 |
| | **Phase 1 합계** | **11.5일** |

Phase 2 (일반 리텐션, 만성질환, 이탈감지): +4일
Phase 3 (이메일, WhatsApp/WeChat 연동, AI 최적화, A/B): +5일
백로그: 카카오 알림톡 (국내 환자, 별도 검토)

---

## 9. 성공 지표

| 지표 | 현재 | 6개월 목표 |
|------|------|----------|
| 재방문률 | 측정 불가 | 60%+ (3개월 내 재방문) |
| 예약 No-show | ~15% | <8% (리마인더 효과) |
| 검진 예약 전환 | N/A | 15%+ (프로모션 캠페인) |
| NPS | 측정 중 | 4.0/5.0+ |
| 이탈률 | 측정 불가 | <20% (6개월 기준) |
| 캠페인 전달율 | N/A | 95%+ (SMS+Push) |

---

## 10. 리스크

| 리스크 | 대응 |
|--------|------|
| 마케팅 스팸 인식 | 빈도 제한 (월 4회), 동의 철저, 유용한 콘텐츠 |
| 개인정보 유출 | 마케팅 데이터 익명화, 접근 권한 제한 (ADMIN만) |
| SMS 비용 | 건당 20~30원 — 세그먼트 타겟팅으로 효율 극대화 |
| 환자 불만 | 수신거부 즉시 반영, 불만 접수 시 자동 차단 |
| 의료법 위반 | 광고성 메시지 검수 프로세스, 법무 리뷰 |

---

## 11. 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1.0 | 2026-06-02 | 초안 — 기존 인프라 분석, 6모델, 25+API, 8FE, RFM/캠페인/리마인더/이탈감지, 의료법 |
| v1.1 | 2026-06-02 | 보완 — 검진 CRM(Phase 1A) + 해외환자 CRM(Phase 1B) 우선, CRM 부서 전용 역할/메뉴, CrmForeignPatientCase 모델, 다국어 템플릿, 이상 소견 추적, 에이전시 관리 |
| v1.2 | 2026-06-02 | 의료법 데이터 접근 제한 — CRM 허용 10종 vs 접근 불가 8종, CRM 전용 API, BTG 불가 |
| v1.3 | 2026-06-02 | 예약·접수 대행 — CRM 부서가 환자 대신 예약/접수 생성, 대행 API 7개, CRM 상담 화면, 감사 추적 |
| v1.4 | 2026-06-02 | 환자 포털 연동 — 메시지함/배너/설문 발송, 7채널 매트릭스 |
| v1.5 | 2026-06-02 | 채널 정리 — 카카오→백로그, 해외환자 WeChat(중국)+WhatsApp(글로벌) 추가 |
