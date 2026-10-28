# 의뢰서/회신서 AI 자동작성 기획서 v1.1

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/web/src/app/(main)/consultations/letters/ · apps/web/src/app/(main)/patients/[id]/components/ReferralTab.tsx:89 · apps/api/src/modules/referral-letter/ · 잔여: 없음

> **작성일**: 2026-06-02
> **수정일**: 2026-06-02 (v1.1 — 검토 보완: 모델 관계, 권한, 워크플로우, 알림, 법적 근거)
> **수준**: Enterprise
> **우선순위**: 높음 (임상 업무 효율화 직결)
> **현재 상태**: 협진 데이터 구조 있음, 문서 생성/AI 작성 없음

---

## 1. 개요

### 1.1 목적

의사가 협진/전원/검사 의뢰 시, 환자의 진료 기록(SOAP, 진단, 검사, 처방)을 AI가 자동 수집·요약하여 **의뢰서 초안을 즉시 생성**. 의사는 검토·수정만 하면 되므로 문서 작성 시간을 80% 이상 단축.

### 1.2 현재 vs TO-BE

| 항목 | 현재 | TO-BE |
|------|------|-------|
| **협진 의뢰** | 사유 텍스트만 수동 입력 | AI가 SOAP+진단+검사 기반 의뢰서 초안 자동 생성 |
| **협진 회신** | reply 필드 수동 입력 | AI가 의뢰 내용+환자 데이터 기반 회신서 초안 생성 |
| **전원 의뢰** | FHIR Bundle만 (비구조 문서) | 한글 전원 의뢰서 PDF + FHIR Bundle |
| **검사 의뢰** | Order 생성만 | 검사 사유·임상 정보 자동 기재 |
| **문서 형식** | 없음 | 병원 서식 PDF (로고, 직인, QR 검증) |
| **문서 이력** | 없음 | 생성/수정/출력 감사 로그 |

---

## 2. 대상 의뢰서 6종

### 2.1 유형별 정의

| # | 유형 | 발신 | 수신 | 주요 내용 | 빈도 |
|---|------|------|------|----------|------|
| 1 | **협진 의뢰서** | 주치의 | 타과 전문의 | 의뢰 사유, 임상 질문, 환자 요약 | 매우 높음 |
| 2 | **협진 회신서** | 타과 전문의 | 주치의 | 소견, 권고 사항, 추가 검사 제안 | 매우 높음 |
| 3 | **전원 의뢰서** | 현 기관 | 타 기관 | 전원 사유, 임상 요약, 진단/투약/알레르기 | 중간 |
| 4 | **검사 의뢰서** | 주치의 | 검사실/영상의학과 | 검사 사유, 임상 정보, 주의사항 | 높음 |
| 5 | **외래 의뢰서** | 검진센터 | 외래 진료과 | 검진 이상 소견, 추가 검사 필요, 의뢰 사유 | 중간 |
| 6 | **진료 소견서** | 주치의 | 환자/보험사 | 진단, 치료 경과, 향후 계획, 소견 | 높음 |

### 2.2 우선순위

```
Phase 1: 협진 의뢰서 + 협진 회신서 (가장 빈도 높음)
Phase 2: 전원 의뢰서 + 검사 의뢰서
Phase 3: 외래 의뢰서 + 진료 소견서
```

---

## 3. AI 자동작성 파이프라인

### 3.1 전체 흐름

```
┌──────────────────────────────────────────────────────────┐
│                    의사 → "협진 의뢰" 클릭                   │
└────────────────────────┬─────────────────────────────────┘
                         ▼
              ┌─────────────────────┐
              │  ① 데이터 자동 수집    │
              │  (환자 컨텍스트)       │
              └──────────┬──────────┘
                         ▼
              ┌─────────────────────┐
              │  ② AI 초안 생성       │
              │  (Enhanced Chat)     │
              └──────────┬──────────┘
                         ▼
              ┌─────────────────────┐
              │  ③ 의사 검토/수정     │
              │  (편집 폼)           │
              └──────────┬──────────┘
                         ▼
              ┌─────────────────────┐
              │  ④ 저장 + PDF 생성   │
              │  (병원 서식)          │
              └──────────┬──────────┘
                         ▼
              ┌─────────────────────┐
              │  ⑤ 전달 + 알림       │
              │  (수신과 알림)        │
              └─────────────────────┘
```

### 3.2 ① 데이터 자동 수집

의뢰서 작성 시 AI가 자동으로 수집하는 환자 데이터:

```typescript
interface ReferralContext {
  // 환자 기본
  patient: {
    name: string;          // 강미래
    mrn: string;           // P2026-0008
    age: number;           // 5세
    gender: string;        // 여
    allergies: string[];   // ["페니실린"]
  };
  
  // 현재 진료 (SOAP)
  currentEncounter: {
    date: string;
    department: string;    // 내과
    doctor: string;        // 김내과
    subjective: string;    // 주관적 호소
    objective: string;     // 객관적 소견
    assessment: string;    // 평가
    plan: string;          // 계획
  };
  
  // 진단
  diagnoses: {
    code: string;          // J06.9
    name: string;          // 급성 상기도 감염
    type: 'PRIMARY' | 'SECONDARY';
  }[];
  
  // 최근 검사 (이상 소견 우선)
  labResults: {
    testName: string;
    value: string;
    flag: 'H' | 'L' | 'N';
    date: string;
  }[];
  
  // 현재 투약
  medications: {
    name: string;
    dosage: string;
    frequency: string;
  }[];
  
  // 활력징후 (최근)
  vitals?: {
    systolicBp: number;
    diastolicBp: number;
    heartRate: number;
    temperature: number;
    spo2: number;
    measuredAt: string;
  };
  
  // 입원 정보 (입원 환자인 경우)
  admission?: {
    admitDate: string;
    ward: string;
    room: string;
    bed: string;
    dietType: string;
  };
  
  // 과거력/문제 목록
  problemList: string[];
}
```

### 3.3 ② AI 초안 생성

**Enhanced Chat (medical 도메인)** 사용 — 3모델 파이프라인:

```
시스템 프롬프트:
"당신은 한국 병원의 의무기록 작성 보조 AI입니다.
 아래 환자 데이터를 기반으로 {문서유형} 초안을 작성하세요.

 [작성 규칙]
 - 한국어 의학 용어 사용 (영어 병명은 괄호 안에 병기)
 - 간결하고 객관적인 의무기록 문체
 - 주관적 판단 배제, 사실 기반 기술
 - 의뢰 사유와 임상 질문을 명확히 구분
 - 200~400자 이내

 [환자 데이터]
 {ReferralContext JSON}

 [{문서유형}] 초안:"
```

**문서유형별 프롬프트 차이:**

| 문서 | AI 지시 핵심 |
|------|-----------|
| 협진 의뢰서 | "의뢰 사유, 현재까지의 경과, 타과에 묻고 싶은 임상 질문을 명확히 기술" |
| 협진 회신서 | "의뢰 내용에 대한 소견, 권고 사항, 추가 검사 필요 여부를 기술" |
| 전원 의뢰서 | "전원 사유, 환자 상태 요약, 이송 시 주의사항을 기술" |
| 검사 의뢰서 | "검사 목적, 임상 의심 진단, 환자 주의사항(알레르기/금식 등)을 기술" |

### 3.4 ③ 의사 검토/수정

```
┌─ 협진 의뢰서 작성 ────────────────────────────────────┐
│                                                      │
│ 환자: 강미래 (P2026-0008) | 5세 여                     │
│ 의뢰과: 내과 김내과 → 이비인후과                         │
│                                                      │
│ ┌─ AI 초안 (수정 가능) ──────────────────────────────┐ │
│ │                                                    │ │
│ │ [의뢰 사유]                                         │ │
│ │ 상기 환자는 2주간 지속되는 비루(rhinorrhea)와           │ │
│ │ 후비루(post-nasal drip)를 주소로 내원한 5세 여아로,      │ │
│ │ 경험적 항생제 치료(아목시실린 7일) 후에도 증상            │ │
│ │ 호전이 없어 이비인후과 협진을 의뢰합니다.                │ │
│ │                                                    │ │
│ │ [임상 질문]                                         │ │
│ │ 1. 부비동염 가능성 평가 및 추가 영상 검사 필요 여부       │ │
│ │ 2. 아데노이드 비대 감별 필요 여부                       │ │
│ │                                                    │ │
│ │ [현재 상태]                                         │ │
│ │ • 진단: 급성 비인두염 (J06.9)                        │ │
│ │ • 투약: 아목시실린 250mg tid 7일 (반응 불량)           │ │
│ │ • 검사: CBC 정상, CRP 0.8mg/dL                     │ │
│ │ • 알레르기: 페니실린 (두드러기)                        │ │
│ └────────────────────────────────────────────────────┘ │
│                                                      │
│ [AI 재생성]  [직접 수정]  [저장 + PDF]  [전송]          │
└──────────────────────────────────────────────────────┘
```

### 3.5 ④ PDF 생성 (병원 서식)

```
┌─────────────────────────────────────────────────┐
│          위루비병원                         │
│            협 진 의 뢰 서                          │
│─────────────────────────────────────────────────│
│ 문서번호: REF-2026-0602-001                       │
│ 작성일시: 2026-06-02 11:20                        │
│─────────────────────────────────────────────────│
│ [환자 정보]                                       │
│ 성명: 강미래    등록번호: P2026-0008                │
│ 성별/나이: 여/5세   생년월일: 2021-xx-xx            │
│─────────────────────────────────────────────────│
│ [의뢰 정보]                                       │
│ 의뢰과: 내과        의뢰의: 김내과                  │
│ 수신과: 이비인후과                                  │
│ 긴급도: ○일반  ●긴급  ○응급                        │
│─────────────────────────────────────────────────│
│ [의뢰 사유]                                       │
│ (AI 생성 + 의사 수정 내용)                          │
│─────────────────────────────────────────────────│
│ [현재 진단]    J06.9 급성 비인두염                   │
│ [현재 투약]    아목시실린 250mg tid                  │
│ [검사 결과]    CBC 정상, CRP 0.8                   │
│ [알레르기]     페니실린 (두드러기)                    │
│─────────────────────────────────────────────────│
│                                                 │
│ 의뢰의: 김내과 (전자서명)     [QR 검증코드]         │
│                                                 │
│ 위루비병원 | 02-000-0000                   │
└─────────────────────────────────────────────────┘
```

---

## 4. 기존 모델과의 관계

### 4.1 역할 분리 원칙

```
Consultation (기존)         = 협진 업무 데이터 (Source of Truth)
TransferRecord (기존)       = 전원 업무 데이터 (Source of Truth)
ReferralLetter (신규)       = 문서화 레이어 (PDF 렌더링 + 감사 추적)
```

| 구분 | 기존 모델 | ReferralLetter |
|------|---------|---------------|
| **역할** | 업무 처리 (상태 관리, 데이터 저장) | 문서 생성 (AI 초안, PDF, 서명) |
| **관계** | 1:N — 하나의 협진에 여러 버전 의뢰서 가능 | N:1 — 의뢰서는 반드시 원본 업무에 연결 |
| **데이터** | reason, clinicalQuestion, replyContent | content (AI 초안 마크다운), PDF |
| **동기화** | 의뢰서 저장 시 Consultation.reason 자동 갱신 | patientSnapshot은 생성 시점 스냅샷 (갱신 안 함) |

### 4.2 상태 전이도

```
                    ┌─────────┐
                    │  DRAFT  │ ← AI 초안 생성
                    └────┬────┘
                         │ 의사 서명
                         ▼
                    ┌─────────┐
             ┌──────│ SIGNED  │
             │      └────┬────┘
             │           │ 전송
             │           ▼
             │      ┌─────────┐     수신과 거절     ┌──────────┐
             │      │  SENT   │──────────────────▶│ REJECTED │
             │      └────┬────┘                   └──────────┘
             │           │ 수신 확인
             │           ▼
             │      ┌──────────┐
             │      │ RECEIVED │
             │      └────┬─────┘
             │           │ 회신 완료 / 30일 경과
             │           ▼
             │      ┌──────────┐
             │      │ ARCHIVED │
             │      └──────────┘
             │
             │ 서명 후 취소
             ▼
        ┌─────────┐
        │ VOIDED  │
        └─────────┘
```

**만료 정책**: SENT 상태에서 30일 무응답 시 EXPIRED 처리 (Cron 자동)

---

## 5. 권한 설계 (RBAC)

### 5.1 유형별 × 역할별 권한 매트릭스

| 기능 | DOCTOR (의뢰의) | DOCTOR (수신의) | DOCTOR (기타) | NURSE | ADMIN |
|------|:-:|:-:|:-:|:-:|:-:|
| 의뢰서 **생성** | ✅ | - | - | - | - |
| AI 초안 **생성** | ✅ | - | - | - | - |
| 의뢰서 **수정** (DRAFT) | ✅ | - | - | - | - |
| 의뢰서 **서명** | ✅ | - | - | - | - |
| 의뢰서 **열람** | ✅ | ✅ | 같은 과만 | ✅ | ✅ |
| 회신서 **작성** | - | ✅ | - | - | - |
| 의뢰서 **거절** | - | ✅ | - | - | - |
| PDF **다운로드** | ✅ | ✅ | - | ✅ | ✅ |
| 의뢰서 **무효화** | ✅ | - | - | - | ✅ |
| 진료 소견서 **환자 열람** | - | - | - | - | - | 포털 제한 열람 |

### 5.2 데이터 접근 범위

- 의사: 본인 작성 의뢰서 + 본인 과 수신 의뢰서
- 간호사: 본인 과 의뢰서 (읽기 전용)
- 관리자: 전체 (감사 목적)
- 환자: 진료 소견서만 (포털에서 열람)

---

## 6. 알림 연동

### 6.1 알림 유형

| 이벤트 | 수신자 | 채널 | 긴급도 |
|--------|--------|------|--------|
| 협진 의뢰 도착 | 수신과 의사 | SSE + 대시보드 배지 | 일반/긴급 |
| 협진 회신 완료 | 의뢰의 | SSE + 대시보드 배지 | 일반 |
| 의뢰 거절 | 의뢰의 | SSE | 일반 |
| 응급 의뢰 | 수신과 전체 + 간호사 | SSE + FCM 푸시 | 응급 |
| 의뢰 만료 임박 (D-3) | 수신과 의사 | SSE | 일반 |

### 6.2 기존 시스템 연동

```typescript
// Notification 모델 활용
await this.notificationService.create({
  userId: toDoctorId,
  type: 'REFERRAL_RECEIVED',
  title: `${fromDepartment} 협진 의뢰`,
  message: `${patientName}님 의뢰서가 도착했습니다.`,
  refType: 'REFERRAL_LETTER',
  refId: letterId,
  priority: urgency === 'EMERGENT' ? 'HIGH' : 'NORMAL',
});
```

---

## 7. 법적 근거

### 7.1 관련 법규

| 법규 | 조항 | 요구사항 | 대응 |
|------|------|---------|------|
| **의료법 제22조** | 진료기록부등 | 진료의뢰서는 진료기록부의 일부 | ReferralLetter를 의무기록으로 보관 (5년) |
| **의료법 제21조** | 기록 열람 | 환자 요청 시 사본 제공 의무 | PDF 다운로드 + 환자 포털 열람 |
| **의료법 시행규칙 제14조** | 진료의뢰서 서식 | 별지 제9호의3 서식 | PDF 서식을 법정 서식에 맞춤 |
| **국민건강보험법 시행규칙** | 요양급여의뢰서 | 건강보험 환자 의뢰 시 별지 서식 | 건보 의뢰서 서식 별도 지원 |
| **의료법 제23조의2** | 전자의무기록 | 전자서명 + 수정 이력 보존 | 서명 시각 기록 + AuditLog |

### 7.2 서식 준수

Phase 1: 병원 자체 서식 (로고 + 기본 구성)
Phase 2: 의료법 시행규칙 별지 제9호의3 서식 준수 + 건보 의뢰서 서식

### 7.3 전자서명 로드맵

| Phase | 방식 | 법적 효력 |
|-------|------|----------|
| Phase 1 | 의사명 + 서명 시각 + 서버 해시 | 병원 내부 효력 |
| Phase 2 | 공동인증서(구 공인인증서) 연동 | 법적 전자서명 |
| Phase 3 | 블록체인 감사 (기존 BlockchainAudit 모델 활용) | 위변조 방지 |

---

## 8. 데이터 모델

### 8.1 신규 모델

```prisma
model ReferralLetter {
  id              String    @id @default(uuid()) @db.Uuid
  type            String    @db.VarChar(30)   // CONSULTATION_REQUEST, CONSULTATION_REPLY, TRANSFER, LAB_ORDER, CHECKUP_REFERRAL, MEDICAL_OPINION
  
  // 연결
  consultationId  String?   @map("consultation_id") @db.Uuid
  transferId      String?   @map("transfer_id") @db.Uuid
  encounterId     String?   @map("encounter_id") @db.Uuid
  patientId       String    @map("patient_id") @db.Uuid
  
  // 발신/수신
  fromDepartment  String    @map("from_department") @db.VarChar(50)
  fromDoctorId    String    @map("from_doctor_id") @db.Uuid
  toDepartment    String    @map("to_department") @db.VarChar(50)
  toDoctorId      String?   @map("to_doctor_id") @db.Uuid
  
  // 내용
  content         String    @db.Text          // 의뢰서 본문 (마크다운)
  aiDraftContent  String?   @map("ai_draft") @db.Text  // AI 초안 원본 (비교용)
  aiModel         String?   @map("ai_model") @db.VarChar(50)
  editedByDoctor  Boolean   @default(false) @map("edited_by_doctor")
  
  // 환자 데이터 스냅샷 (의뢰 시점)
  patientSnapshot Json?     @map("patient_snapshot") @db.JsonB
  
  // 상태
  status          String    @default("DRAFT") @db.VarChar(20) // DRAFT, SIGNED, SENT, RECEIVED, REJECTED, VOIDED, EXPIRED, ARCHIVED
  signedAt        DateTime? @map("signed_at") @db.Timestamptz()
  signedBy        String?   @map("signed_by") @db.Uuid
  rejectionReason String?   @map("rejection_reason") @db.Text
  expiresAt       DateTime? @map("expires_at") @db.Timestamptz()  // SENT 후 30일
  
  // PDF
  pdfUrl          String?   @map("pdf_url") @db.VarChar(500)
  letterNumber    String?   @map("letter_number") @db.VarChar(30) // REF-2026-0602-001
  
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.Timestamptz()

  patient         Patient   @relation(fields: [patientId], references: [id])
  fromDoctor      User      @relation("LetterFromDoctor", fields: [fromDoctorId], references: [id])
  toDoctor        User?     @relation("LetterToDoctor", fields: [toDoctorId], references: [id])
  consultation    Consultation? @relation(fields: [consultationId], references: [id])

  @@index([patientId, type])
  @@index([fromDoctorId, status])
  @@index([toDepartment, status])
  @@map("referral_letters")
}
```

---

## 5. API 설계

### 5.1 엔드포인트

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/v1/referral-letters/generate` | AI 초안 생성 (의뢰서 유형 + 컨텍스트) |
| POST | `/api/v1/referral-letters` | 의뢰서 저장 (초안 → 확정) |
| GET | `/api/v1/referral-letters/:id` | 의뢰서 조회 |
| PUT | `/api/v1/referral-letters/:id` | 의뢰서 수정 |
| PATCH | `/api/v1/referral-letters/:id/sign` | 전자서명 |
| GET | `/api/v1/referral-letters/:id/pdf` | PDF 다운로드 |
| GET | `/api/v1/referral-letters/patient/:patientId` | 환자별 의뢰서 목록 |
| GET | `/api/v1/referral-letters/pending` | 수신 대기 의뢰서 (내 과) |

### 5.2 AI 생성 요청

```typescript
// POST /api/v1/referral-letters/generate
interface GenerateRequest {
  type: 'CONSULTATION_REQUEST' | 'CONSULTATION_REPLY' | 'TRANSFER' 
      | 'LAB_ORDER' | 'CHECKUP_REFERRAL' | 'MEDICAL_OPINION';
  patientId: string;
  encounterId?: string;        // 현재 진료 기준
  consultationId?: string;     // 회신 시 원본 의뢰
  toDepartment: string;
  urgency?: 'ROUTINE' | 'URGENT' | 'EMERGENT';
  additionalNote?: string;     // 의사가 추가로 강조할 내용
}

// 응답 (프로젝트 컨벤션: { data, meta })
// { data: GenerateResponse, meta: { aiModel, generatedAt } }
interface GenerateResponse {
  draftContent: string;        // AI 초안 (마크다운)
  patientSnapshot: object;     // 수집된 환자 데이터
  suggestions: string[];       // AI 추가 제안 (검사 추천 등)
}
// meta: { aiModel: 'qwen2.5:14b', generatedAt: '2026-06-02T11:20:00Z' }
```

---

## 6. FE 변경

### 6.1 신규 컴포넌트

| 컴포넌트 | 위치 | 역할 |
|---------|------|------|
| `ReferralLetterForm` | 환자 차트 내 | 의뢰서 작성 폼 (AI 초안 + 수정) |
| `ReferralLetterPreview` | 모달 | PDF 미리보기 |
| `ReferralLetterList` | 환자 차트 탭 | 의뢰서 이력 목록 |
| `PendingReferrals` | 워크스테이션 | 수신 대기 의뢰서 알림 |

### 6.2 기존 페이지 수정

| 페이지 | 변경 |
|--------|------|
| `patients/[id]/components/ReferralTab.tsx` | AI 자동작성 버튼 추가 |
| `transfer/request/page.tsx` | 전원 의뢰서 자동 생성 연동 |
| `workstation/*/page.tsx` | 수신 의뢰서 알림 배지 |

---

## 7. 구현 우선순위

| Phase | 내용 | 예상 |
|:-----:|------|:----:|
| **1-1** | `ReferralLetter` Prisma 모델 + 마이그레이션 | 0.3일 |
| **1-2** | `referral-letter.service.ts` — 데이터 수집 (`buildContext`) | 0.5일 |
| **1-3** | AI 초안 생성 (`generateDraft`) — Enhanced Chat 연동 | 0.5일 |
| **1-4** | CRUD API + 컨트롤러 | 0.5일 |
| **1-5** | PDF 생성 (병원 서식) | 0.5일 |
| **1-6** | FE — 의뢰서 작성 폼 + 미리보기 | 1일 |
| **1-7** | FE — ReferralTab에 AI 버튼 통합 | 0.5일 |
| **1-8** | 테스트 + 배포 | 0.5일 |
| | **Phase 1 합계** | **4.3일** |

Phase 2 (전원/검사 의뢰서): +3일
Phase 3 (외래 의뢰서/소견서): +2일

---

## 8. 성공 지표

| 지표 | 현재 | 목표 |
|------|------|------|
| 의뢰서 작성 시간 | ~10분 (수동) | ≤ 2분 (AI 초안 + 검토) |
| AI 초안 채택률 | N/A | ≥ 70% (수정 없이 또는 소폭 수정) |
| 의뢰서 완성도 | 텍스트만 | PDF + 전자서명 + QR 검증 |
| 문서 추적 | 없음 | 100% (생성→서명→전달→수신 추적) |

---

## 9. 리스크

| 리스크 | 대응 |
|--------|------|
| AI 초안 의학적 오류 | 의사 검토 필수, AI 초안 태그 표시, 면책 고지 |
| 환자 데이터 민감 정보 | AI에 식별정보 최소 전달, 진단/검사만 전송 |
| PDF 한글 깨짐 | HTML → PDF 방식 (pdf-lib 한글 미지원 회피) |
| LLM 응답 지연 | 타이핑 인디케이터 + 15초 타임아웃 + 수동 작성 폴백 |

---

## 10. 감사 로그 (Audit Log)

### 10.1 추적 대상 액션

| 액션 | 설명 | 기록 내용 |
|------|------|----------|
| `REFERRAL_CREATE` | 의뢰서 생성 (AI 초안) | type, patientId, fromDept, toDept |
| `REFERRAL_UPDATE` | 의사 수정 | 변경 필드 diff |
| `REFERRAL_SIGN` | 전자서명 | signedBy, signedAt |
| `REFERRAL_SEND` | 수신과 전송 | toDept, toDoctorId |
| `REFERRAL_REJECT` | 수신과 거절 | rejectionReason |
| `REFERRAL_VOID` | 무효화 | voidReason |
| `REFERRAL_PDF` | PDF 다운로드/출력 | downloadedBy |

### 10.2 기존 AuditLog 모델 연동

```typescript
await this.prisma.auditLog.create({
  data: {
    userId, action: 'REFERRAL_SIGN',
    resourceType: 'REFERRAL_LETTER', resourceId: letterId,
    details: { type, patientId, toDepartment },
  },
});
```

---

## 11. 테스트 시나리오

### 11.1 AI 생성

| # | 시나리오 | 기대 결과 |
|---|---------|---------|
| T1 | 협진 의뢰 — 내과→이비인후과, SOAP 데이터 있음 | AI 초안 200자+, 진료과명/진단 포함 |
| T2 | 협진 의뢰 — SOAP 데이터 없음 (빈 차트) | 빈 양식 폴백, AI 실패 알림 |
| T3 | AI 서버 다운 | 15초 타임아웃 → 수동 작성 폼 표시 |
| T4 | "다시 생성" 클릭 | 새 초안 생성, 이전 초안 보존 |

### 11.2 워크플로우

| # | 시나리오 | 기대 결과 |
|---|---------|---------|
| T5 | 정상 흐름: DRAFT→SIGNED→SENT→RECEIVED→ARCHIVED | 상태 전이 정상, 알림 발송 |
| T6 | 수신과 거절 | REJECTED 상태, 사유 기록, 의뢰의 알림 |
| T7 | 서명 후 무효화 | VOIDED 상태, 사유 기록 |
| T8 | 30일 무응답 | Cron에 의해 EXPIRED 처리 |
| T9 | 동시 다과 의뢰 (A→B, A→C) | 각각 독립 의뢰서, 환자 차트에서 통합 뷰 |

### 11.3 권한

| # | 시나리오 | 기대 결과 |
|---|---------|---------|
| T10 | 타과 의사가 의뢰서 열람 시도 | 403 Forbidden |
| T11 | 간호사가 의뢰서 열람 | 읽기만 가능, 수정/서명 불가 |
| T12 | 환자가 포털에서 소견서 열람 | 진료 소견서만 표시 |

### 11.4 PDF

| # | 시나리오 | 기대 결과 |
|---|---------|---------|
| T13 | PDF 생성 — 한글 정상 렌더링 | 깨짐 없음, 서식 정확 |
| T14 | PDF — 전자서명 + QR 코드 표시 | 서명 영역 정상, QR 스캔 가능 |

---

## 12. 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1.0 | 2026-06-02 | 초안 — 6종 의뢰서 식별, AI 파이프라인, 데이터 모델, API, FE, 우선순위 |
| v1.1 | 2026-06-02 | 검토 보완: 기존 모델 관계 정의, 상태 전이도, RBAC 권한 매트릭스, 알림 연동, 법적 근거(의료법), 감사 로그, ReferralContext에 vitals/admission, 테스트 시나리오 14건 |
