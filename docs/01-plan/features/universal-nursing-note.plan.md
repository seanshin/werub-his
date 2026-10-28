# 범용 간호 노트 시스템 기획서

> 작성일: 2026-05-20 | 상태: 기획 완료

## 1. 문제 정의

### 1.1 현재 구조의 한계

현재 간호 기록 시스템은 **입원(admissionId) 기반**으로만 동작한다.

```
NursingNote       → admissionId (필수)
NursingAssessment → admissionId (필수)
IntakeOutput      → admissionId (필수)
```

이로 인해 **입원이 아닌 환경**에서 간호 기록을 남길 수 없다:

| 환경 | 입원 여부 | 간호 기록 | 문제 |
|------|:--------:|:--------:|------|
| 입원 병동 | ✅ | ✅ 가능 | - |
| ICU | ✅ (입원) | ✅ 가능 | - |
| **응급실** | ❌ | ❌ 불가 | EmergencyVisit에 treatmentNote(단일 텍스트)만 |
| **PACU 회복실** | ❌ | ❌ 불가 | PacuRecord에 notes(단일 텍스트)만 |
| **수술실** | ❌ | ❌ 불가 | 수술 간호 기록 모델 없음 |
| **외래 진료** | ❌ | ❌ 불가 | NurseTask 체크리스트만, 관찰 노트 없음 |
| **검사실/영상실** | ❌ | ❌ 불가 | 처치 후 관찰 기록 없음 |

### 1.2 실제 간호 현장의 기록 필요

```
모든 환자 접점에서 간호 기록이 발생:

[응급실] 트리아지 → 초기 평가 → 경과 관찰 → 투약 → 처치 → 인수인계
[PACU]  입실 → 15분 간격 바이탈 → Aldrete → 통증 관리 → 퇴실
[수술실] 환자 확인 → 체위 → 카운트 → 피부 상태 → 인수인계
[외래]  바이탈 → 환자 교육 → 처방 설명 → 주사 시행 → 관찰
[검사실] 채혈 → 관찰 → 이상반응 → 귀가 안내
```

---

## 2. 해결 방안: 범용 간호 노트 (UniversalNursingNote)

### 2.1 핵심 설계 원칙

1. **Context-Free**: admissionId 의존 제거 → patientId + contextType + contextId로 다형성 참조
2. **구조화 + 자유 텍스트**: SBAR/DAR/Focus Charting 구조 + 자유 텍스트 병행
3. **어디서든 기록**: 응급실, PACU, 수술실, 외래, 검사실 모두 동일 모델 사용
4. **기존 호환**: 기존 NursingNote(입원)는 유지, 새 모델은 범용으로 추가

### 2.2 데이터 모델

```prisma
model UniversalNursingNote {
  id          String   @id @default(uuid()) @db.Uuid
  patientId   String   @map("patient_id") @db.Uuid
  nurseId     String   @map("nurse_id") @db.Uuid

  // 다형성 컨텍스트 — 어디서 작성했는지
  contextType String   @map("context_type") @db.VarChar(30)
  // EMERGENCY | PACU | SURGERY | OUTPATIENT | LAB | IMAGING | ICU | INPATIENT | PROCEDURE
  contextId   String   @map("context_id") @db.Uuid
  // emergencyVisitId | pacuRecordId | surgeryId | encounterId | queueId | admissionId

  // 기록 유형
  noteType    String   @map("note_type") @db.VarChar(30)
  // ASSESSMENT | OBSERVATION | INTERVENTION | EDUCATION | HANDOFF | VITAL_CHANGE | MEDICATION | PROCEDURE_NOTE

  // 구조화 기록 (SBAR)
  situation    String?  @db.Text  // S: 상황 — 무엇이 발생했나
  background   String?  @db.Text  // B: 배경 — 관련 병력/상황
  assessment   String?  @db.Text  // A: 평가 — 간호사의 판단
  recommendation String? @db.Text // R: 권고 — 의사에게 요청/조치

  // 자유 텍스트 (SBAR 안 쓸 때)
  content      String?  @db.Text

  // 바이탈 (관찰 시점의 바이탈)
  vitalSigns   Json?    @map("vital_signs") @db.JsonB
  // { bp: "130/85", hr: 72, rr: 16, spo2: 98, bt: 36.5, painScore: 3 }

  // 심각도
  severity     String?  @db.VarChar(20)
  // NORMAL | CAUTION | WARNING | CRITICAL

  // 메타
  shiftType    String?  @map("shift_type") @db.VarChar(10)
  // DAY | EVENING | NIGHT
  recordedAt   DateTime @map("recorded_at") @db.Timestamptz()
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz()

  patient      Patient  @relation(fields: [patientId], references: [id])
  nurse        User     @relation("UniversalNursingNoteNurse", fields: [nurseId], references: [id])

  @@index([patientId, contextType])
  @@index([contextType, contextId])
  @@index([nurseId, recordedAt])
  @@map("universal_nursing_notes")
}
```

### 2.3 컨텍스트별 활용

| contextType | contextId | noteType 예시 |
|-------------|-----------|--------------|
| EMERGENCY | emergencyVisitId | ASSESSMENT(트리아지), OBSERVATION(경과), INTERVENTION(처치), HANDOFF(인수인계) |
| PACU | pacuRecordId | OBSERVATION(15분 바이탈), VITAL_CHANGE(이상), MEDICATION(진통제), HANDOFF(퇴실) |
| SURGERY | surgeryId | PROCEDURE_NOTE(수술간호), ASSESSMENT(피부상태), OBSERVATION(카운트) |
| OUTPATIENT | encounterId/queueId | EDUCATION(환자교육), MEDICATION(주사), OBSERVATION(관찰) |
| INPATIENT | admissionId | 기존 NursingNote와 동일 (호환) |
| LAB | orderId | PROCEDURE_NOTE(채혈), OBSERVATION(이상반응) |
| IMAGING | orderId | PROCEDURE_NOTE(조영제), OBSERVATION(부작용) |

---

## 3. API 설계

### 3.1 범용 간호 노트 API

| # | Method | Endpoint | 설명 |
|---|--------|----------|------|
| 1 | POST | `/api/v1/nursing-notes` | 간호 노트 작성 |
| 2 | GET | `/api/v1/nursing-notes` | 노트 목록 (contextType, contextId, patientId 필터) |
| 3 | GET | `/api/v1/nursing-notes/:id` | 노트 상세 |
| 4 | PATCH | `/api/v1/nursing-notes/:id` | 노트 수정 |
| 5 | GET | `/api/v1/nursing-notes/patient/:patientId` | 환자별 전체 간호 노트 (모든 컨텍스트) |
| 6 | GET | `/api/v1/nursing-notes/context/:contextType/:contextId` | 특정 컨텍스트의 노트 |
| 7 | GET | `/api/v1/nursing-notes/stats` | 통계 (오늘 작성 건수, 간호사별) |

### 3.2 DTO

```typescript
class CreateNursingNoteDto {
  @IsUUID() patientId: string;
  @IsString() contextType: string; // EMERGENCY | PACU | SURGERY | ...
  @IsUUID() contextId: string;
  @IsString() noteType: string; // ASSESSMENT | OBSERVATION | ...
  @IsOptional() @IsString() situation?: string;
  @IsOptional() @IsString() background?: string;
  @IsOptional() @IsString() assessment?: string;
  @IsOptional() @IsString() recommendation?: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() vitalSigns?: Record<string, unknown>;
  @IsOptional() @IsString() severity?: string;
  @IsOptional() @IsString() shiftType?: string;
}
```

---

## 4. 프론트엔드: 간호 노트 컴포넌트 (재사용)

### 4.1 NursingNotePanel (공유 컴포넌트)

모든 페이지에서 임베드 가능한 재사용 컴포넌트:

```typescript
interface NursingNotePanelProps {
  patientId: string;
  contextType: 'EMERGENCY' | 'PACU' | 'SURGERY' | 'OUTPATIENT' | 'LAB' | 'IMAGING';
  contextId: string;
  patientName?: string;
  compact?: boolean; // 축소 모드 (패널 내 사용)
}
```

```
┌─ 간호 기록 ─────────────────────────────────────────────┐
│                                                          │
│  [+ 간호 노트 추가]                          ← 버튼     │
│                                                          │
│  ── 기록 목록 (최신순) ──                               │
│                                                          │
│  🔴 14:30 [경과 관찰] — 간호사: 조간호                  │
│  S: 환자 호흡곤란 호소, SpO2 92%로 저하                 │
│  B: 30분 전 NS 1L IV 시작, 기저 COPD                    │
│  A: 산소포화도 저하, 산소 요법 필요                      │
│  R: 담당의에게 보고, O2 증량 요청                       │
│  바이탈: BP 140/90 HR 98 RR 24 SpO2 92%                │
│                                                          │
│  🟢 14:00 [투약] — 간호사: 조간호                       │
│  내용: Ketorolac 30mg IV 투여 (통증 NRS 7)              │
│  바이탈: BP 130/85 HR 82 SpO2 97%                      │
│                                                          │
│  🟢 13:30 [초기 평가] — 간호사: 황간호                  │
│  S: 응급실 내원, 급성 흉통                              │
│  A: KTAS 2등급, 심전도 시행 필요                        │
│  바이탈: BP 150/95 HR 88 SpO2 97%                      │
└──────────────────────────────────────────────────────────┘
```

### 4.2 간호 노트 작성 모달

```
┌─ 간호 노트 작성 ────────────────────────────────────────┐
│                                                          │
│  환자: 양지유 (HR-20260506-0005)                        │
│  컨텍스트: 응급실                                        │
│                                                          │
│  기록 유형: [● 경과 관찰  ○ 처치  ○ 투약  ○ 교육       │
│              ○ 인수인계  ○ 평가  ○ 이상 보고]           │
│                                                          │
│  기록 방식: [● SBAR  ○ 자유 텍스트]                     │
│                                                          │
│  ── SBAR 모드 ──                                        │
│  S (상황): [환자가 호흡곤란을 호소_______]              │
│  B (배경): [30분 전 NS 1L IV 시작________]             │
│  A (평가): [산소포화도 저하, O2 필요______]             │
│  R (권고): [담당의 보고, O2 증량__________]             │
│                                                          │
│  ── 바이탈 (선택) ──                                    │
│  BP [140]/[90]  HR [98]  RR [24]  SpO2 [92]  BT [36.5] │
│  통증 NRS: [7]                                           │
│                                                          │
│  심각도: [○ 정상  ○ 주의  ● 경고  ○ 위급]              │
│                                                          │
│  [저장]  [취소]                                           │
└──────────────────────────────────────────────────────────┘
```

### 4.3 페이지별 적용

| 페이지 | 적용 방법 |
|--------|----------|
| **응급실** `/emergency` | 상세 패널에 NursingNotePanel 임베드 (contextType='EMERGENCY') |
| **PACU** `/pacu` | 선택 환자 상세에 NursingNotePanel 임베드 (contextType='PACU') |
| **수술실** `/surgery/[id]` | 수술 상세에 NursingNotePanel 추가 (contextType='SURGERY') |
| **외래** `encounter/new` | 진료 중 간호 관찰 패널 (contextType='OUTPATIENT') |
| **환자 차트** 간호기록 탭 | NursingRecordTab에 범용 노트 통합 표시 |

---

## 5. 기존 시스템 호환

### 5.1 마이그레이션 전략

```
기존 NursingNote (admissionId 기반) → 유지 (변경 없음)
새 UniversalNursingNote            → 추가 (병행 운영)

환자 차트 간호기록 탭:
├── 입원 간호 기록 (기존 NursingNote) — admissionId 기반
└── 범용 간호 기록 (UniversalNursingNote) — contextType 기반
    ├── 응급실 기록
    ├── PACU 기록
    ├── 수술 기록
    ├── 외래 기록
    └── 검사/영상 기록
```

### 5.2 NursingRecordTab 개편

```
┌─ 간호 기록 ─────────────────────────────────────────────┐
│                                                          │
│  [전체] [입원] [응급] [PACU] [수술] [외래]     ← 필터   │
│                                                          │
│  날짜          컨텍스트    유형      내용 요약    간호사  │
│  05/20 14:30  응급실      경과 관찰  호흡곤란...  조간호  │
│  05/20 14:00  응급실      투약      Ketorolac... 조간호  │
│  05/18 09:00  외래(내과)  교육      고혈압 관리  조간호  │
│  05/15 ~      51W 입원   간호일지   DAR 기록    김간호  │
│  05/10 11:00  PACU       퇴실 관찰  Aldrete 9   황간호  │
└──────────────────────────────────────────────────────────┘
```

---

## 6. 구현 우선순위

| Phase | 항목 | 난이도 | 예상 |
|:-----:|------|:------:|:----:|
| 1 | UniversalNursingNote 모델 + API 7개 + DTO | 중간 | 3h |
| 2 | NursingNotePanel 공유 컴포넌트 (노트 목록 + 작성 모달) | 중간 | 4h |
| 3 | 응급실 페이지에 NursingNotePanel 임베드 | 낮음 | 1h |
| 4 | PACU 페이지에 NursingNotePanel 임베드 | 낮음 | 1h |
| 5 | NursingRecordTab 개편 (범용 노트 통합) | 중간 | 2h |
| 6 | 수술실/외래/검사실 임베드 | 낮음 | 2h |

**총 예상: 13시간 (6 Phase)**

---

## 7. 비기능 요구사항

| 항목 | 요구 |
|------|------|
| 실시간성 | 10초 자동 갱신 (응급실/PACU) |
| 권한 | NURSE/ADMIN만 작성, DOCTOR/NURSE/ADMIN 조회 |
| SBAR | 구조화 기록 권장, 자유 텍스트 허용 |
| 심각도 | WARNING/CRITICAL 시 담당의에게 알림 (향후) |
| 감사 | 수정 이력 audit 기록 |
| 인쇄 | 간호 기록 인쇄 가능 |
| 시간 정확성 | recordedAt은 실제 관찰 시간 (createdAt과 별도) |

---

## 8. 연관 시스템

| 시스템 | 연동 포인트 |
|--------|------------|
| emergency | NursingNotePanel 임베드 (contextType=EMERGENCY) |
| pacu | NursingNotePanel 임베드 (contextType=PACU) |
| surgery | 수술 간호 기록 (contextType=SURGERY) |
| nurse-station | 외래 간호 관찰 (contextType=OUTPATIENT) |
| 환자 차트 | NursingRecordTab에 범용 노트 통합 |
| journey | 간호 기록 여정 이벤트 발행 |
| medical-ai | AI 간호 기록 요약 (향후) |

---

## 9. 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1 | 2026-05-20 | 초기 기획 — 범용 모델 + API 7개 + 공유 컴포넌트 + 6 페이지 적용 |
