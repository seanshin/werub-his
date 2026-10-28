# 응급 프로토콜 + 워크스테이션 고도화 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/homepage/src/app/guide/emergency/page.tsx · apps/web/src/app/(main)/workstation/emergency/page.tsx · 잔여: 없음

> 응급 접수→퇴원 전체 프로토콜 구현 + B등급 워크스테이션 14종 고도화

- **작성일**: 2026-05-29
- **상태**: Plan (검토 완료, 68→85점)
- **관련**: emergency.service.ts, workstation/ 23종
- **검토**: design-validator 68점 → 12건 보완 반영

## 1. 현재 상태 분석

### 워크스테이션 등급 현황 (22종)

| 등급 | 수량 | 워크스테이션 |
|:----:|:----:|------------|
| **A** (완전) | 8 | 메인, 응급(메인+WS), 검사실, 영상, 판독, 기초검사, 치료실, 템플릿 |
| **B** (부분) | 15 | 약국, 간호, 접수, 트리아지, 입퇴원, 수술준비, 혈액은행, 감염관리, 퇴원, 영양, 재활, ICU, 장비, CSSD, **수술후(post-op)** |

### B등급 공통 문제
- 기본 3단계 워크플로우만 (대기→접수→완료)
- 상세 입력폼 없음
- 부서 특화 체크리스트/프로토콜 없음
- AI 연동 없음

## 2. 응급 프로토콜 전체 워크플로우

### 2.1 응급 환자 흐름 (KTAS 기반)

```
① 도착/접수 (/workstation/emergency)
   ├─ 기존 환자 검색 | 신규 환자 등록
   ├─ AI 증상 상담 → KTAS 자동 분류
   └─ 바이탈 측정 → 접수 확정
       ↓
② 트리아지 평가 (/workstation/triage)
   ├─ KTAS 1-2: 즉시 소생실 이동
   ├─ KTAS 3: 응급 진료 대기
   ├─ KTAS 4-5: 경증 진료 대기
   ├─ 간호 초기평가 (ABC, GCS, 통증)
   └─ 의사 배정
       ↓
③ 응급 진료 (/emergency)
   ├─ 의사 초기 평가 (SOAP)
   ├─ 오더: 검사/영상/약물/시술
   ├─ AI 감별진단 + CDSS
   ├─ 모니터링 (바이탈 재측정)
   └─ 치료 (처치/시술/수술)
       ↓
④ 재평가 & 경과 관찰
   ├─ KTAS 재분류 (AI 제안)
   ├─ 검사결과 확인
   ├─ 바이탈 트렌드
   └─ 상태 변화 기록
       ↓
⑤ 처분 결정 (Disposition)
   ├─ 퇴원 (귀가 지침 + 외래 예약)
   ├─ 입원 (병동 배정 → 입원 연동)
   ├─ 전원 (전원 소견서 생성)
   ├─ 수술 (수술 연동)
   ├─ 관찰실 이동 (4-6시간 관찰)
   └─ 자의퇴원 (AMA 동의서)
       ↓
⑥ 응급 퇴원 (/workstation/discharge)
   ├─ 퇴원 요약서
   ├─ 처방전 발행 (외래약)
   ├─ 귀가 지침서
   ├─ 외래 예약 생성
   └─ 보호자 교육
```

### 2.2 누락된 기능 (응급 프로토콜)

| 단계 | 기능 | 현재 | 필요 |
|------|------|:----:|:----:|
| ① 접수 | 신규 환자 등록 | ✅ | - |
| ① 접수 | AI 증상 상담 | ✅ | - |
| ② 트리아지 | 간호 초기평가 (ABC/GCS/통증) | ❌ | 폼 추가 |
| ② 트리아지 | 의사 자동 배정 | ❌ | 로직 추가 |
| ③ 진료 | AI 감별진단 | ✅ | - |
| ③ 진료 | 오더 연동 (검사/영상) | ❌ | 오더 패널 |
| ④ 재평가 | KTAS 재분류 | ✅ (AI) | 수동 변경 UI |
| ④ 재평가 | 바이탈 재측정 타이머 | ❌ | KTAS별 자동 알림 |

### 2.3 KTAS 재평가 간격 (한국응급의학회 기준)

| KTAS | 등급 | 재평가 간격 | 바이탈 재측정 |
|:----:|------|:---------:|:-----------:|
| 1 | 소생 | 연속 모니터링 | 연속 |
| 2 | 긴급 | 15분 | 15분 |
| 3 | 응급 | 30분 | 30분 |
| 4 | 준응급 | 60분 | 60분 |
| 5 | 비응급 | 120분 | 120분 |

### 2.4 응급 환자 상태 흐름 (세분화)

```
접수 → PENDING_TRIAGE → TRIAGED → PENDING_DOCTOR → IN_TREATMENT
  → PENDING_RESULT → UNDER_OBSERVATION → PENDING_DISPOSITION → 처분
```

| 상태 | 의미 | 트리거 |
|------|------|--------|
| PENDING_TRIAGE | 트리아지 대기 | 접수 완료 시 |
| TRIAGED | 트리아지 완료 | 간호 초기평가 완료 시 |
| PENDING_DOCTOR | 의사 배정 대기 | 트리아지 후 의사 미배정 |
| IN_TREATMENT | 진료/처치 중 | 의사 초기 평가 시작 |
| PENDING_RESULT | 검사 결과 대기 | 오더 발행 후 |
| UNDER_OBSERVATION | 관찰 중 (4~6시간) | 1차 판단 후 경과 관찰 |
| PENDING_DISPOSITION | 처분 대기 | 결과 확인 후 처분 결정 전 |
| DISCHARGED/ADMITTED/... | 최종 처분 | 의사 처분 결정 |

### 2.5 비응급 환자 (KTAS 5) 프로세스

> 응급의료에관한법률 제6조: 접수 거부 불가

| 단계 | 시스템 동작 |
|------|-----------|
| 접수 | KTAS 5 선택 시 **"비응급 판정 — 외래 진료 권고"** 알림 표시 |
| 안내 | **비급여 본인부담 안내** 팝업 (응급의료관리료 미청구 고지) |
| 대기 | 120분 대기 안내 (KTAS 5 기준) |
| 기록 | 비응급 판정 기록 → 건보 심사 근거 자동 저장 |
| 처분 | 외래 예약 연동 ("외래 진료가 적절합니다" 안내) |

### 2.6 누락 기능 (처분 + 퇴원)

| 단계 | 기능 | 현재 | 필요 |
|------|------|:----:|:----:|
| ⑤ 처분 | 퇴원 (귀가지침) | ❌ | 퇴원 폼 |
| ⑤ 처분 | 입원 전환 | ✅ (API) | FE 연동 |
| ⑤ 처분 | 전원 소견서 | ❌ | PDF 생성 |
| ⑤ 처분 | 관찰실 이동 | ❌ | 상태 추가 |
| ⑤ 처분 | 자의퇴원 (AMA) | ❌ | 동의서 (아래 상세) |
| ⑥ 퇴원 | 퇴원 요약서 | ❌ | 자동 생성 |
| ⑥ 퇴원 | 외래 예약 연동 | ❌ | 예약 API |

### 2.5 자의퇴원 (AMA) 동의서 요건

| 필드 | 필수 | 설명 |
|------|:----:|------|
| 퇴원 사유 | O | 환자가 직접 기술 |
| 위험 고지 | O | 퇴원 시 발생 가능한 위험 설명 기록 |
| 의사 설명 내용 | O | 설명한 의사가 기록 |
| 환자 서명 | O | 전자 서명 |
| 증인 서명 | O | 간호사 또는 보호자 |
| 서명 일시 | O | 자동 기록 |

## 3. B등급 워크스테이션 고도화 상세

### 3.1 약국 (pharmacy) — B→A

| 추가 기능 | 설명 |
|----------|------|
| 처방 상세 표시 | 약물명, 용량, 빈도, 일수 |
| DUR 경고 인라인 | 처방 옆에 상호작용 경고 |
| 바코드 스캔 연동 | GS1/KD 바코드 확인 |
| 조제 체크리스트 | 5R 확인 (Right patient/drug/dose/route/time) |
| AI 복약지도 | amber 패널 (이미 API 구현) |
| 조제 완료 서명 | SmartSignButton 연동 |

### 3.2 간호 (nursing) — B→A

| 추가 기능 | 설명 |
|----------|------|
| 바이탈 입력 폼 | 6항목 + NEWS2 자동 계산 |
| 투약 관리 (MAR) | 시간대별 투약 체크 |
| 간호 평가 도구 | Morse Fall, Braden, NEWS2 |
| 인수인계 (I-PASS) | AI 요약 + 구조화 양식 |
| 환자 라운딩 체크리스트 | 시간별 확인 항목 |

### 3.3 접수 (reception) — B→A

| 추가 기능 | 설명 |
|----------|------|
| PatientSelector 연동 | 실시간 검색 |
| 진료과 선택 + 의사 배정 | 드롭다운 |
| 대기번호 발급 | QR코드 포함 |
| 보험 확인 | 보험 유형 선택 |
| 기존 접수 페이지 연동 | /reception 의 WalkInTab 재사용 |

### 3.4 입퇴원 (admission) — B→A

| 추가 기능 | 설명 |
|----------|------|
| 입원 경로 선택 | 응급/외래/전원/계획 |
| 병동/병실/침상 선택 | 실시간 빈 침상 조회 |
| 주치의 배정 | 의사 목록 |
| 입원 동의서 | 동의서 연동 |
| 입원 안내 출력 | PDF 안내문 |

### 3.5 수술 준비 (surgery-prep) — B→A

| 추가 기능 | 설명 |
|----------|------|
| WHO 수술 안전 체크리스트 | Sign In(8) + Time Out(7) + Sign Out(5) |
| 마취 전 평가 | ASA 등급, 금식 확인 |
| 수술 동의서 확인 | 동의서 상태 표시 |
| 수혈 동의서 확인 | 혈액형 + 교차시험 |
| AI 위험도 | amber 패널 (이미 API) |

### 3.6 혈액은행 (blood-bank) — B→A

| 추가 기능 | 설명 |
|----------|------|
| 교차시험 의뢰 접수 | 혈액형 + 항체 선별 |
| 혈액 제제 출고 | 이중 확인 (환자ID + 혈액번호) |
| 수혈 모니터링 | 15분 단위 반응 체크 |
| 수혈 부작용 보고 | 즉시 보고 양식 |

### 3.7 퇴원 (discharge) — B→A

| 추가 기능 | 설명 |
|----------|------|
| 퇴원 요약서 | AI 자동 초안 (autoSoap) |
| 퇴원 약 처방 | 외래 처방전 |
| 교육 자료 | 질환별 귀가 지침 |
| 외래 예약 | 추적 진료 예약 생성 |
| 수납 확인 | 미수납 체크 |

### 3.8 트리아지 (triage) — B→A

| 추가 기능 | 설명 |
|----------|------|
| 간호 초기평가 폼 | ABC(기도/호흡/순환), GCS, 통증 척도 |
| KTAS 자동 제안 | AI amber 패널 연동 |
| 의사 배정 로직 | KTAS 1-2: 시니어, 3-5: 당직 |

### 3.9 감염관리 (infection-control) — B→A

| 추가 기능 | 설명 |
|----------|------|
| 격리 유형 선택 | 접촉/비말/공기/보호/엄격 5종 |
| 접촉자 추적 | 환자/직원 접촉자 목록 |
| 발병 알림 | 집단 발생 시 자동 알림 |
| 감시 배양 결과 | 내성균 모니터링 |

### 3.10 영양 (nutrition) — B→A

| 추가 기능 | 설명 |
|----------|------|
| 영양 선별 검사 (NRS-2002) | 입원 24시간 내 평가 |
| 식이 처방 | 일반식/치료식/특수식 |
| 약물-식이 상호작용 | AI 경고 |
| 경장/정맥 영양 관리 | TPN/EN 모니터링 |

### 3.11 재활 (rehab-station) — B→A

| 추가 기능 | 설명 |
|----------|------|
| 기능 평가 | Barthel Index, FIM |
| 치료 계획 | PT/OT/ST 목표 설정 |
| 치료 기록 | 세션별 진행 기록 |
| 퇴원 시 평가 | 입원 대비 개선도 |

### 3.12 ICU (icu) — B→A

| 추가 기능 | 설명 |
|----------|------|
| 실시간 모니터링 대시보드 | 바이탈 트렌드 차트 |
| 인공호흡기 설정 | 모드/FiO2/PEEP/TV |
| APACHE II / SOFA | 중환자 중증도 점수 |
| 진정/통증 평가 | RASS, BPS |

### 3.13 장비/CSSD (equipment, cssd) — B→A

| 추가 기능 | 설명 |
|----------|------|
| 장비 대출/반납 | 바코드 스캔 |
| 멸균 추적 | 세척→포장→멸균→보관 |
| 유효기간 관리 | 만료 알림 |
| 장비 점검 이력 | 정기 점검 기록 |

### 3.14 수술후 (post-op) — B→A

| 추가 기능 | 설명 |
|----------|------|
| PACU 모니터링 | 마취 회복 (Aldrete 점수) |
| 통증 관리 | PCA/VAS 기록 |
| 합병증 감시 | 출혈/감염/DVT 체크리스트 |
| 병동 전실 기준 | Aldrete ≥ 9점 |

## 4. 구현 우선순위

### P0 (필수, 1~2주)

| # | 작업 | 대상 |
|---|------|------|
| 1 | 응급 프로토콜 ②~⑥ | 트리아지 평가 → 처분 → 퇴원 전체 |
| 2 | 약국 고도화 | 처방 상세 + DUR + 5R 체크리스트 |
| 3 | 퇴원 고도화 | 퇴원 요약서 + 외래 예약 + 교육 |

### P1 (중요, 2~4주)

| # | 작업 | 대상 |
|---|------|------|
| 4 | 간호 고도화 | 바이탈 + MAR + 평가도구 + I-PASS |
| 5 | 입퇴원 고도화 | 경로선택 + 침상배정 + 동의서 |
| 6 | 수술 준비 고도화 | WHO 체크리스트 + 마취 평가 |
| 7 | 접수 고도화 | PatientSelector + 대기번호 |

### P2 (개선, 1~2개월)

| # | 작업 | 대상 |
|---|------|------|
| 8 | 혈액은행 고도화 | 교차시험 + 출고 + 수혈 모니터링 |
| 9 | 트리아지 고도화 | 간호 초기평가 폼 |
| 10 | 감염관리 고도화 | 격리 유형 + 접촉자 추적 |
| 11 | 영양 고도화 | 영양 평가 + 식이 처방 |

### P3 (장기, 2개월+)

| # | 작업 | 대상 |
|---|------|------|
| 12 | 재활 고도화 | Barthel/FIM + 치료 계획 |
| 13 | ICU 고도화 | 모니터링 대시보드 |
| 14 | 장비/CSSD 고도화 | 장비 관리 + 멸균 추적 |

## 5. 기술 아키텍처

### 공통 패턴 (B→A 업그레이드)

```typescript
// B등급 (현재): 90줄, 기본 상태 전환만
const receive = useMutation({ mutationFn: (id) => apiClient.patch(`/order/${id}/receive`) });

// A등급 (목표): 300~500줄, 상세 입력 + AI + 체크리스트
// 1. 상세 정보 패널 (우측)
// 2. 부서 특화 입력 폼
// 3. 체크리스트 (해당 시)
// 4. AI amber 패널 (해당 시)
// 5. 서명 연동 (해당 시)
```

### BE API

**신규 필요 (3건)**:

| API | 모듈 | 용도 |
|-----|------|------|
| `POST /api/v1/emergency/visits/:id/reassess` | emergency | KTAS 재분류 + 재평가 기록 |
| `POST /api/v1/emergency/visits/:id/disposition` | emergency | 처분 결정 (퇴원/입원/전원/관찰) |
| `POST /api/v1/emergency/visits/:id/discharge` | emergency | 응급 퇴원 (귀가지침 + 외래예약) |

**기존 활용 (변경 불필요)**:

| API | 모듈 | 용도 |
|-----|------|------|
| `GET /api/v1/beds?status=AVAILABLE` | bed | 빈 침상 조회 (이미 존재) |
| `POST /api/v1/admissions/:id/discharge-summary` | inpatient | 퇴원 요약서 (이미 존재) |
| `PUT /api/v1/emergency/visits/:id/status` | emergency | 상태 변경 (PUT, PATCH 아님) |

## 6. 데이터 모델 변경

### Prisma 스키마 추가/변경

```prisma
// EmergencyVisit — 상태 enum에 OBSERVATION 추가
// 현재: WAITING, TRIAGE, TREATMENT, DISCHARGED, ADMITTED, TRANSFERRED, DECEASED, LEFT_AMA
// 추가: OBSERVATION (관찰실)

model EmergencyReassessment {
  id              String   @id @default(uuid()) @db.Uuid
  visitId         String   @map("visit_id") @db.Uuid
  previousLevel   String   @map("previous_level") @db.VarChar(10)
  newLevel        String   @map("new_level") @db.VarChar(10)
  reason          String   @db.Text
  assessedBy      String   @map("assessed_by") @db.Uuid
  assessedAt      DateTime @default(now()) @map("assessed_at") @db.Timestamptz()
  vitals          Json?    @db.JsonB

  visit EmergencyVisit @relation(fields: [visitId], references: [id])
  assessor User @relation("ReassessmentAssessor", fields: [assessedBy], references: [id])
  @@index([visitId])
  @@map("emergency_reassessments")
}

model EmergencyDispositionRecord {
  id            String   @id @default(uuid()) @db.Uuid
  visitId       String   @unique @map("visit_id") @db.Uuid
  disposition   String   @db.VarChar(20)  // DISCHARGE, ADMIT, TRANSFER, OBSERVATION, SURGERY, AMA
  decidedBy     String   @map("decided_by") @db.Uuid
  decidedAt     DateTime @default(now()) @map("decided_at") @db.Timestamptz()
  // 퇴원 시
  dischargeInstructions String? @map("discharge_instructions") @db.Text
  followUpAppointmentId String? @map("followup_appointment_id") @db.Uuid
  // 입원 시
  admissionId   String?  @map("admission_id") @db.Uuid
  // 전원 시
  transferTo    String?  @map("transfer_to") @db.VarChar(200)
  transferReason String? @map("transfer_reason") @db.Text

  visit EmergencyVisit @relation(fields: [visitId], references: [id])
  doctor User @relation("DispositionDoctor", fields: [decidedBy], references: [id])
  @@map("emergency_dispositions")
}

// 간호 초기평가 (응급 트리아지용)
model EmergencyNursingAssessment {
  id        String   @id @default(uuid()) @db.Uuid
  visitId   String   @map("visit_id") @db.Uuid
  airway    String   @db.VarChar(20)   // PATENT, COMPROMISED, OBSTRUCTED
  breathing String   @db.VarChar(20)   // NORMAL, LABORED, ABSENT
  circulation String @db.VarChar(20)  // STABLE, UNSTABLE, ABSENT
  gcsEye    Int?     @map("gcs_eye")   // 1-4
  gcsVerbal Int?     @map("gcs_verbal") // 1-5
  gcsMotor  Int?     @map("gcs_motor")  // 1-6
  painScale Int?     @map("pain_scale") // 0-10 (NRS)
  painLocation String? @map("pain_location") @db.VarChar(100)
  assessedBy String  @map("assessed_by") @db.Uuid
  assessedAt DateTime @default(now()) @map("assessed_at") @db.Timestamptz()

  visit EmergencyVisit @relation(fields: [visitId], references: [id])
  nurse User @relation("EmergencyNurseAssessor", fields: [assessedBy], references: [id])
  @@index([visitId])
  @@map("emergency_nursing_assessments")
}
```

## 7. 워크플로우별 RBAC 권한

| 액션 | DOCTOR | NURSE | ADMIN | PHARMACIST |
|------|:------:|:-----:|:-----:|:----------:|
| 응급 접수 | O | O | O | - |
| KTAS 분류/변경 | O | O | O | - |
| 간호 초기평가 | - | O | O | - |
| 의사 초기 평가 | O | - | O | - |
| 오더 (검사/영상/약물) | O | - | O | - |
| 처분 결정 (퇴원/입원/전원) | O | - | O | - |
| AMA 동의서 서명 | O | O (증인) | O | - |
| 퇴원 요약서 | O | - | O | - |
| 약국 조제/검수 | - | - | O | O |
| 수술 체크리스트 | O | O | O | - |

## 8. 마이그레이션 전략

| 단계 | 내용 |
|------|------|
| 1 | `prisma db push` — 3개 신규 테이블 생성 (기존 테이블 무관) |
| 2 | EmergencyVisit 상태 enum — String 타입이므로 마이그레이션 불필요 |
| 3 | 배포 후 기존 데이터 영향 없음 (신규 테이블만 추가) |
| 4 | 롤백: 테이블 DROP만으로 원복 가능 |

## 9. 에러 처리

| 시나리오 | 폴백 |
|----------|------|
| API 서버 다운 | "시스템 점검 중 — 수동 접수로 전환" 안내 + 종이 차트 |
| KTAS 1-2 접수 중 네트워크 끊김 | 로컬 캐시에 임시 저장 → 복구 후 동기화 |
| AI 트리아지 실패 | 의료진 수동 분류 (AI는 보조 역할) |
| 빈 침상 조회 실패 | 수동 병동 연락 안내 |
| 퇴원 요약서 생성 실패 | 텍스트 폴백 (자동생성 없이 수동 작성) |

## 10. 테스트 계획

### P0 테스트

| 대상 | 테스트 유형 | 시나리오 |
|------|-----------|---------|
| 응급 접수→퇴원 | E2E | KTAS 3 환자: 접수→트리아지→진료→퇴원 전체 흐름 |
| KTAS 재분류 | 통합 | KTAS 3→2 변경 시 알림 발생 확인 |
| 약국 고도화 | 단위 | 5R 체크리스트 전항목 체크 후 조제 완료 |
| 퇴원 고도화 | 통합 | 퇴원 요약서 AI 생성 + 외래 예약 연동 |
| 기존 A등급 | 회귀 | 검사실/영상/치료실 기존 워크플로우 정상 동작 |

### P1~P3 테스트
각 워크스테이션 고도화 완료 시 해당 부서 워크플로우 E2E 1건씩

## 11. 비기능 요구사항 (NFR)

| 항목 | 목표 |
|------|------|
| 응급실 화면 응답 시간 | < 500ms (P95) |
| 대기열 갱신 주기 | 10초 (KTAS 1-2 실시간) |
| 동시 접속자 | 20명 (응급실 의료진) |
| 오프라인 대응 | "수동 접수 전환" 안내 표시 |
| 데이터 보존 | 응급 기록 10년 (의무기록 보존) |

## 12. JCI/IPSG 매핑

| IPSG | 항목 | 워크스테이션 적용 |
|------|------|------------------|
| IPSG.1 | 환자 확인 | 접수 시 2가지 식별자(이름+MRN) 확인 |
| IPSG.2 | 효과적 의사소통 | I-PASS 인수인계, Read-back 구두처방 |
| IPSG.3 | 고위험 약물 | 약국 5R 체크리스트 + DUR 경고 |
| IPSG.4 | 수술 안전 | WHO 체크리스트 (수술준비 WS) |
| IPSG.5 | 감염 감시 | 감염관리 WS 격리/접촉자 추적 |
| IPSG.6 | 낙상 위험 | 간호 WS Morse Fall Scale |

## 13. 범위 외 (Out of Scope)

| 항목 | 사유 |
|------|------|
| 재난 대응 (MCI) | 별도 프로젝트 필요 (대량환자 트리아지 START) |
| 구급대 연동 (119) | 외부 시스템 연동, Phase 4+ |
| 정신과 응급 | 별도 프로토콜 필요 (자/타해 위험 평가) |
| 소아 응급 | 별도 KTAS-P (소아 트리아지) 적용 필요 |

## 14. 성공 지표

| 지표 | P0 완료 시 | 최종 목표 |
|------|:---------:|:---------:|
| A등급 워크스테이션 | 11/23 (48%) | 19/23 (83%) |
| 응급 프로토콜 | 6단계 전체 | 유지 |
| 평균 줄 수 (B→A) | 약국/퇴원 300줄+ | 전체 300줄+ |
| AI 패널 적용 | 8/23 | 16/23 |

## 15. 제약사항

- 기존 A등급 워크스테이션 회귀 방지 (regression test)
- B등급 고도화 시 기존 API 먼저 확인 (신규 BE 최소화)
- 응급 프로토콜은 KTAS 가이드라인 기반
- 체크리스트 항목은 JCI/IPSG 기준
