# 표준 매핑 자동화 기획서 v2.0

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/prisma/schema.prisma:1398 model PendingMapping · apps/api/prisma/schema.prisma:1461 model MappingAuditLog · apps/api/prisma/schema.prisma:1353 model TerminologyMapping · 잔여: Phase 6 외부 변환표 자동 업데이트(SNOMED/LOINC 릴리스)(사람)

> Hospital RUN HIS — AI 기반 의료 용어 자동 매핑 시스템  
> 작성일: 2026-05-22 (v2.0 보완)  
> 선행 문서: TERMINOLOGY-MAPPING-PLAN-v1.0.md, TERMINOLOGY-AUTO-MAPPING-PLAN-v1.0.md  
> 변경 사항: 오류 시나리오 보완, 성능 최적화 설계, UI 와이어프레임 상세화

---

## 1. v1.0 보완 사항

### 1.1 추가된 고려사항

| 항목 | v1.0 | v2.0 보완 |
|------|------|---------|
| 오류 처리 | 미정의 | AI 서버 장애, 타임아웃, 잘못된 매핑 복구 전략 |
| 성능 | 벌크 rate limit만 | 캐싱 전략, 큐 기반 비동기, 점진적 로딩 |
| 다국어 | 한국어만 | 한글→영문 자동 번역 후 매핑 (정확도 향상) |
| 매핑 충돌 | 미정의 | 1:N 매핑 처리, 동일 코드 다중 표준 충돌 해결 |
| 감사/규정 | 기본만 | EMR 인증 요건 매핑 추적 로그, 변경 이력 |
| 롤백 | 미정의 | 잘못된 벌크 매핑 일괄 롤백 기능 |

### 1.2 오류 시나리오 및 대응

| 시나리오 | 발생 조건 | 대응 |
|---------|---------|------|
| AI 서버 장애 | WeRU.B 503/타임아웃 | Stage 1(규칙) 결과만 반환 + "AI 미사용" 표시 |
| 잘못된 매핑 확정 | confidence 0.95지만 실제 오류 | 관리자가 매핑 취소 → 롤백 + 블랙리스트 등록 |
| 1:N 매핑 충돌 | 하나의 KCD에 SNOMED 2건 이상 | 모든 후보 저장 + 주(Primary) 매핑 표시 |
| 벌크 매핑 중 중단 | 서버 재시작, 네트워크 끊김 | 진행 상태 Redis 저장 + 재개(Resume) 지원 |
| 표준 업데이트 충돌 | SNOMED 버전 업데이트로 코드 변경 | 기존 매핑 validTo 설정 + 신규 버전 매핑 생성 |

### 1.3 성능 최적화 설계

```
매핑 캐시 전략:
┌─────────────────────────────────────────────────────────┐
│ L1: 인메모리 (Map)                                       │
│   - ICD-10→SNOMED 공식 변환표 (~13,000건)                 │
│   - 기동 시 1회 로드, 무기한 유지                          │
│   - 조회: O(1), 메모리: ~2MB                              │
├─────────────────────────────────────────────────────────┤
│ L2: Redis 캐시                                           │
│   - AI 매핑 결과 캐시 (key: sourceTable:sourceCode:targetSystem) │
│   - TTL: 7일 (동일 코드 반복 매핑 방지)                    │
│   - 벌크 매핑 진행 상태 (key: bulk-mapping:{jobId})        │
├─────────────────────────────────────────────────────────┤
│ L3: DB (TerminologyMapping)                              │
│   - 확정된 매핑 영구 저장                                  │
│   - 인덱스: sourceTable+sourceId, targetSystem+targetCode  │
└─────────────────────────────────────────────────────────┘
```

---

## 2. 3단계 파이프라인 (보완)

### 2.1 Stage 1: 규칙 기반 매핑 (0초, 동기)

```
입력: sourceTable, sourceId, targetSystem
처리:
  1. L1 캐시에서 공식 변환표 조회
  2. 기존 TerminologyMapping에서 동일 sourceCode 패턴 조회
     (예: J06.9가 매핑됨 → J06.0도 유사 매핑 가능)
  3. 코드 접두어 규칙:
     - J**: 호흡기 → SNOMED CT "Respiratory" hierarchy
     - I**: 순환기 → SNOMED CT "Circulatory" hierarchy
     - C**: 신생물 → SNOMED CT "Neoplasm" hierarchy

결과:
  - 매핑 찾음 → { targetCode, confidence: 0.95, method: 'RULE_OFFICIAL' }
  - 유사 매핑 → { targetCode, confidence: 0.80, method: 'RULE_SIMILAR' }
  - 없음 → null (Stage 2로 진행)
```

### 2.2 Stage 2: AI LLM 매핑 (3~8초, 비동기)

```
입력: 코드 정보 (code, nameKo, nameEn, category, 추가 컨텍스트)
처리:
  1. L2 Redis 캐시 확인 (이전 AI 결과 존재 시 재사용)
  2. 매핑 대상별 최적 프롬프트 선택
  3. WeRU.B AI 호출:
     a. /api/medical/code/kcd (KCD DB 469건 검색) → 1차 후보
     b. /api/chat/enhanced (medical 도메인) → 2차 검증
     c. /api/medical/reference (RAG) → 3차 교차 검증
  4. 다중 소스 교차 검증:
     - 3개 소스 중 2개 이상 일치 → confidence +0.10
     - 모든 소스 일치 → confidence +0.15
  5. 한글→영문 자동 번역:
     - 한글 진단명만 있을 때 /api/medical/clinical/translate 호출
     - 영문명으로 SNOMED CT 검색 정확도 향상

결과: candidates[] (최대 3건, confidence 내림차순)
```

**프롬프트 템플릿 (표준별)**:

```
=== SNOMED CT 매핑 프롬프트 ===
당신은 의료 용어 전문가입니다.
다음 한국어 진단명에 가장 정확한 SNOMED CT 코드를 찾아주세요.

진단명: {nameKo}
영문명: {nameEn}
KCD코드: {code}
분류: {category}

요구사항:
1. SNOMED CT International Edition 기준
2. Clinical Finding 또는 Disorder 계층에서 검색
3. 최대 3개 후보를 신뢰도 순으로 반환
4. 각 후보의 선택 근거를 한 줄로 설명

응답 형식 (JSON만, 설명 없이):
{"candidates":[
  {"code":"숫자코드","display":"영문명","confidence":0.0~1.0,"reason":"근거"}
]}

=== LOINC 매핑 프롬프트 ===
다음 검사항목에 정확한 LOINC 코드를 찾아주세요.

검사명: {nameKo}
영문명: {nameEn}
검체: {specimen}
단위: {unit}
참고범위: {refRange}

LOINC 6축 구조 포함:
Component / Property / Timing / System / Scale / Method

응답 형식 (JSON만):
{"candidates":[
  {"code":"LOINC코드","display":"Component명","confidence":0.0~1.0,
   "axes":{"component":"...","property":"...","timing":"...","system":"...","scale":"...","method":"..."}}
]}

=== MedDRA 매핑 프롬프트 ===
다음 약물 부작용 증상에 해당하는 MedDRA PT 코드를 찾아주세요.

증상: {symptom}
관련 약물: {drugName} (있는 경우)
심각도: {severity} (있는 경우)

MedDRA 5계층 포함: SOC > HLGT > HLT > PT > LLT

응답 형식 (JSON만):
{"candidates":[
  {"ptCode":"8자리숫자","ptName":"영문PT명","ptNameKo":"한글명",
   "soc":"SOC명","confidence":0.0~1.0}
]}
```

### 2.3 Stage 3: 검증 + 확정 (보완)

```
Confidence 임계값 (조정 가능한 설정):
┌───────────────────────────────────────┐
│ SYSTEM_CONFIG.autoMapping             │
│                                       │
│ autoConfirmThreshold: 0.90            │
│ pendingThreshold: 0.70                │
│ rejectThreshold: 0.50                 │
│ maxCandidates: 3                      │
│ bulkRateLimit: 5/sec                  │
│ pendingExpiryDays: 30                 │
│ aiTimeoutMs: 10000                    │
│ enableAutoMap: true                   │
└───────────────────────────────────────┘

검증 규칙:
1. confidence ≥ 0.90 + 교차검증 일치 → AUTO_CONFIRMED
2. confidence ≥ 0.90 + 교차검증 불일치 → PENDING (검증 필요)
3. 0.70 ≤ confidence < 0.90 → PENDING
4. 0.50 ≤ confidence < 0.70 → LOW_CONFIDENCE (참고만)
5. confidence < 0.50 → REJECTED (매핑 불가)

추가 검증:
- 동일 targetCode에 이미 다른 sourceCode 매핑 존재 → 경고
- SNOMED CT 코드 유효성 (숫자 + checksum)
- LOINC 코드 형식 (NNNNN-N)
- MedDRA PT 코드 형식 (8자리 숫자)
```

---

## 3. 데이터 모델 (보완)

### 3.1 PendingMapping 모델

```prisma
model PendingMapping {
  id            String    @id @default(uuid()) @db.Uuid
  sourceTable   String    @map("source_table") @db.VarChar(30)
  sourceId      String    @map("source_id") @db.Uuid
  sourceCode    String    @map("source_code") @db.VarChar(20)
  sourceName    String    @map("source_name") @db.VarChar(500)
  targetSystem  String    @map("target_system") @db.VarChar(20)
  
  // 후보 목록 (최대 3건)
  candidates    Json      @db.JsonB
  // [{ targetCode, targetDisplay, confidence, reason, method, crossValidated }]
  
  bestCandidate String?   @map("best_candidate") @db.VarChar(30)
  bestConfidence Decimal?  @map("best_confidence") @db.Decimal(3, 2)
  
  // 상태 관리
  status        String    @default("PENDING") @db.VarChar(20)
  // PENDING → CONFIRMED | REJECTED | EXPIRED | ROLLBACK
  
  // 검토 정보
  reviewedBy    String?   @map("reviewed_by") @db.Uuid
  reviewedAt    DateTime? @map("reviewed_at") @db.Timestamptz()
  reviewNotes   String?   @map("review_notes") @db.Text
  selectedCode  String?   @map("selected_code") @db.VarChar(30)
  // 관리자가 후보 중 선택한 코드 (bestCandidate와 다를 수 있음)
  
  // 매핑 메타
  mappingId     String?   @map("mapping_id") @db.Uuid
  // CONFIRMED 시 생성된 TerminologyMapping.id
  batchId       String?   @map("batch_id") @db.Uuid
  // 벌크 매핑 시 배치 ID
  
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  expiresAt     DateTime  @map("expires_at") @db.Timestamptz()
  
  @@index([status])
  @@index([sourceTable, sourceId])
  @@index([batchId])
  @@map("pending_mappings")
}

// 벌크 매핑 작업
model MappingBatchJob {
  id            String   @id @default(uuid()) @db.Uuid
  sourceTable   String   @map("source_table") @db.VarChar(30)
  targetSystem  String   @map("target_system") @db.VarChar(20)
  filter        String   @db.VarChar(50) // unmapped, all, category:xxx
  
  totalCodes    Int      @map("total_codes")
  processedCodes Int     @default(0) @map("processed_codes")
  confirmedCount Int     @default(0) @map("confirmed_count")
  pendingCount  Int      @default(0) @map("pending_count")
  failedCount   Int      @default(0) @map("failed_count")
  
  status        String   @default("QUEUED") @db.VarChar(20)
  // QUEUED → RUNNING → COMPLETED | FAILED | CANCELLED
  
  startedAt     DateTime? @map("started_at") @db.Timestamptz()
  completedAt   DateTime? @map("completed_at") @db.Timestamptz()
  createdBy     String   @map("created_by") @db.Uuid
  errorLog      String?  @map("error_log") @db.Text
  
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz()
  
  @@map("mapping_batch_jobs")
}

// 매핑 변경 이력 (감사 로그)
model MappingAuditLog {
  id            String   @id @default(uuid()) @db.Uuid
  mappingId     String   @map("mapping_id") @db.Uuid
  action        String   @db.VarChar(20)
  // CREATED, CONFIRMED, REJECTED, ROLLBACK, UPDATED, EXPIRED
  previousData  Json?    @map("previous_data") @db.JsonB
  newData       Json?    @map("new_data") @db.JsonB
  reason        String?  @db.Text
  performedBy   String?  @map("performed_by") @db.Uuid
  performedAt   DateTime @default(now()) @map("performed_at") @db.Timestamptz()
  
  @@index([mappingId])
  @@map("mapping_audit_logs")
}
```

---

## 4. UI 와이어프레임 상세

### 4.1 매핑 대시보드 (admin/codes → 표준매핑 탭 확장)

```
┌──────────────────────────────────────────────────────────────────────┐
│ 표준 매핑 관리                                                       │
│                                                                      │
│ ┌─── 매핑 현황 요약 ──────────────────────────────────────────────┐  │
│ │                                                                  │  │
│ │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │  │
│ │  │ 전체 코드 │ │ 매핑 완료 │ │ 승인 대기 │ │ 미매핑   │           │  │
│ │  │   302    │ │   202    │ │    8     │ │   92    │           │  │
│ │  │          │ │  67%     │ │  2.6%    │ │  30.4%  │           │  │
│ │  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │  │
│ │                                                                  │  │
│ │  표준별 매핑률:                                                   │  │
│ │  SNOMED CT  ████████████░░░░ 80/91  (88%)                       │  │
│ │  LOINC      ████████████████ 26/26  (100%)                      │  │
│ │  ICD-10-PCS ████░░░░░░░░░░░  5/15  (33%)                       │  │
│ │  MedDRA     ████████████░░░░ 34/50  (68%)                       │  │
│ │  ICF        ████████████████ 13/13  (100%)                      │  │
│ │                                                                  │  │
│ └──────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│ ┌─── 액션 ────────────────────────────────────────────────────────┐  │
│ │                                                                  │  │
│ │  [🤖 미매핑 AI 일괄 매핑]  [📋 승인 대기 검토 (8)]               │  │
│ │  [📊 매핑 이력 보기]       [⚙️ 매핑 설정]                        │  │
│ │                                                                  │  │
│ └──────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│ ┌─── 최근 매핑 활동 ──────────────────────────────────────────────┐  │
│ │                                                                  │  │
│ │  🤖 J06.9 → SNOMED 54150009 (자동확정, 0.95)       2분 전      │  │
│ │  ✓  K59.0 → SNOMED 14760008 (관리자 승인)          15분 전     │  │
│ │  ⏳ M79.3 → SNOMED ? (AI 분석 중...)               방금 전      │  │
│ │  ✕  G47.0 → SNOMED (거부됨, 부정확)                1시간 전     │  │
│ │                                                                  │  │
│ └──────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 AI 일괄 매핑 실행 모달

```
┌──────────────────────────────────────────────────────────────┐
│ 🤖 AI 일괄 매핑                                              │
│                                                              │
│ 소스 코드 체계:                                               │
│ ┌─────────────────────────────────────────────────────┐      │
│ │ [● 진단코드 (KCD)]  [○ 수가코드]  [○ 약품코드]       │      │
│ │ [○ 검사항목]        [○ 전체]                         │      │
│ └─────────────────────────────────────────────────────┘      │
│                                                              │
│ 대상 표준:                                                    │
│ ┌─────────────────────────────────────────────────────┐      │
│ │ [☑ SNOMED CT]  [☑ LOINC]  [□ ICD-10-PCS]           │      │
│ │ [□ MedDRA]     [□ ICF]                              │      │
│ └─────────────────────────────────────────────────────┘      │
│                                                              │
│ 필터:                                                        │
│ (●) 미매핑 코드만     ○ 전체 (재매핑 포함)                    │
│                                                              │
│ 자동 확정:                                                    │
│ [☑] Confidence ≥ 0.90인 매핑 자동 확정                       │
│ [☑] 교차 검증 일치 시에만 자동 확정                           │
│                                                              │
│ ┌────────────────────────────────────────────────────┐       │
│ │ 📊 예상 처리                                        │       │
│ │                                                    │       │
│ │ 대상 코드: 23건                                     │       │
│ │ 예상 소요: 약 2분 (5건/초)                          │       │
│ │ AI 서버 상태: ✓ 정상 (응답시간 1.2초)               │       │
│ └────────────────────────────────────────────────────┘       │
│                                                              │
│  [일괄 매핑 시작]                              [취소]         │
└──────────────────────────────────────────────────────────────┘
```

### 4.3 일괄 매핑 진행 화면

```
┌──────────────────────────────────────────────────────────────┐
│ 🤖 AI 매핑 진행 중...                                        │
│                                                              │
│ ████████████████████░░░░░░░░░░░░  15/23 (65%)               │
│                                                              │
│ ⏱ 경과: 1분 32초 │ 예상 남음: 48초                            │
│                                                              │
│ ┌────────────────────────────────────────────────────────┐   │
│ │ 실시간 결과                                             │   │
│ │                                                        │   │
│ │ ✅ I10   → SNOMED 59621000  Essential hypertension 0.95│   │
│ │ ✅ E11   → SNOMED 44054006  Diabetes type 2       0.93│   │
│ │ ⏳ J45   → SNOMED ...       (AI 분석 중)              │   │
│ │ ⚠️ K59.0 → SNOMED 14760008  Constipation          0.85│   │
│ │    └─ 승인 대기 (confidence < 0.90)                    │   │
│ │ ❌ G47.9 → 매핑 실패 (confidence 0.42)                │   │
│ └────────────────────────────────────────────────────────┘   │
│                                                              │
│ 현재 통계:                                                    │
│ ✅ 자동 확정: 10  ⚠️ 승인 대기: 3  ❌ 실패: 2                 │
│                                                              │
│  [일시정지]  [중단]                                           │
└──────────────────────────────────────────────────────────────┘
```

### 4.4 승인 대기 검토 화면 (상세)

```
┌──────────────────────────────────────────────────────────────────────┐
│ 📋 매핑 승인 대기                                     8건 │ 일괄 처리 │
│                                                                      │
│ ┌─── 필터 ──┐                                                       │
│ │ [전체 8] [진단 5] [약품 2] [시술 1]  │  정렬: [신뢰도 높은순 ▼]    │
│ └───────────┘                                                       │
│                                                                      │
│ ┌────────────────────────────────────────────────────────────────┐   │
│ │  1.  KCD K59.0 변비                                            │   │
│ │      Constipation                                              │   │
│ │      ─────────────────────────────────────────────────         │   │
│ │                                                                │   │
│ │      SNOMED CT 후보:                                           │   │
│ │                                                                │   │
│ │      (●) 14760008 Constipation                     ██████ 85% │   │
│ │          "변비의 일반적 SNOMED CT 매핑. 급성/만성 구분 없음"    │   │
│ │                                                                │   │
│ │      (○) 236069009 Chronic constipation             ████░ 72% │   │
│ │          "만성 변비 특화 코드. 기간이 명시된 경우 적합"        │   │
│ │                                                                │   │
│ │      (○) 300393006 Constipation symptom              ███░░ 65% │   │
│ │          "증상으로서의 변비. 기저질환 동반 시 적합"            │   │
│ │                                                                │   │
│ │      💡 AI 의견: KCD K59.0은 기능적 변비로, SNOMED CT에서     │   │
│ │      14760008(Constipation)이 가장 정확한 매핑입니다.          │   │
│ │      만성 여부를 구분해야 하면 236069009를 권장합니다.         │   │
│ │                                                                │   │
│ │      검토 메모: [________________________]                     │   │
│ │                                                                │   │
│ │      [✅ 선택 승인]  [✏️ 직접 입력]  [❌ 거부]  [⏭ 건너뛰기]   │   │
│ │                                                                │   │
│ └────────────────────────────────────────────────────────────────┘   │
│                                                                      │
│ ┌────────────────────────────────────────────────────────────────┐   │
│ │  2.  MED M040501 클로피도그렐 (플라빅스)                       │   │
│ │      Clopidogrel                                               │   │
│ │      ─────────────────────────────────────────────────         │   │
│ │                                                                │   │
│ │      (●) 386952008 Clopidogrel                     ██████ 92% │   │
│ │                                                                │   │
│ │      [✅ 승인]  [❌ 거부]                                      │   │
│ └────────────────────────────────────────────────────────────────┘   │
│                                                                      │
│ 하단:  [◀ 이전]  2 / 8  [다음 ▶]  │  [전체 승인 (92%↑)]  [완료]   │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.5 코드 추가 시 실시간 매핑 제안

```
┌──────────────────────────────────────────────────────────────┐
│ + 진단코드 추가                                              │
│                                                              │
│ 코드 *     [K59.0        ]                                   │
│ 한글명 *   [변비          ]   ← 입력 후 1초 뒤 AI 매핑 시작  │
│ 영문명     [Constipation  ]                                   │
│ 분류       [소화기계 질환 ▼]                                  │
│ ICD-10     [K59.0         ]                                   │
│                                                              │
│ ┌─── 🤖 AI 표준 매핑 제안 (자동) ──────────────────────────┐ │
│ │                                                          │ │
│ │  SNOMED CT                                               │ │
│ │  ✓ 14760008 Constipation                         95%    │ │
│ │  □ 수동 입력: [____________]                             │ │
│ │                                                          │ │
│ │  ICD-10 (입력한 코드에서 자동)                            │ │
│ │  ✓ K59.0 Constipation                            100%   │ │
│ │                                                          │ │
│ │  MedDRA                                                  │ │
│ │  ✓ 10012727 Constipation                          92%   │ │
│ │                                                          │ │
│ │  ⏳ LOINC 해당 없음 (진단코드)                           │ │
│ │                                                          │ │
│ │  [✓ 제안 전체 적용]  [선택 적용]  [매핑 없이 추가]       │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ [코드 추가 + 매핑 적용]                           [취소]      │
└──────────────────────────────────────────────────────────────┘
```

### 4.6 코드 상세 — 매핑 탭

```
┌──────────────────────────────────────────────────────────────────────┐
│ KCD-8  J06.9  급성 상기도감염, 상세불명                               │
│ Acute upper respiratory infection, unspecified                        │
│ 분류: 호흡기계 질환  │  챕터: X                                       │
│                                                                      │
│ [개요]  [📋 표준 매핑]  [🩺 관련 처방]  [📊 통계]                    │
│                                                                      │
│ ┌─── 표준 매핑 (3건) ──────────────────────────────────────────────┐ │
│ │                                                                  │ │
│ │  ┌──────────────────────────────────────────────────────────┐   │ │
│ │  │ SNOMED CT                                                │   │ │
│ │  │ 54150009  Upper respiratory infection                    │   │ │
│ │  │ 등가: 동등 │ 출처: OFFICIAL │ 신뢰도: 0.95               │   │ │
│ │  │ 매핑일: 2026-05-22 │ 검증: ✓ 교차검증 완료              │   │ │
│ │  │ [수정]  [삭제]                                           │   │ │
│ │  └──────────────────────────────────────────────────────────┘   │ │
│ │                                                                  │ │
│ │  ┌──────────────────────────────────────────────────────────┐   │ │
│ │  │ ICD-10                                                   │   │ │
│ │  │ J06.9  Acute upper respiratory infection, unspecified    │   │ │
│ │  │ 등가: 동등 │ 출처: AUTO │ 신뢰도: 1.00                   │   │ │
│ │  └──────────────────────────────────────────────────────────┘   │ │
│ │                                                                  │ │
│ │  ┌──────────────────────────────────────────────────────────┐   │ │
│ │  │ ICD-11                                                   │   │ │
│ │  │ CA07.Y  Acute URI, other specified                      │   │ │
│ │  │ 등가: 포함 │ 출처: OFFICIAL                               │   │ │
│ │  └──────────────────────────────────────────────────────────┘   │ │
│ │                                                                  │ │
│ │  미매핑: MedDRA, ICD-10-PCS                                     │ │
│ │  [+ 매핑 추가]  [🤖 AI 자동 매핑]                                │ │
│ │                                                                  │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ┌─── 관련 간호 진단 (NANDA-I) ──────────────────────────────────┐   │
│ │                                                                │   │
│ │  00032  비효과적 호흡양상  (Ineffective breathing pattern)     │   │
│ │  00007  고체온증  (Hyperthermia)                               │   │
│ │  00132  급성 통증  (Acute pain)                                │   │
│ │                                                                │   │
│ │  [+ 간호진단 연결]                                             │   │
│ └────────────────────────────────────────────────────────────────┘   │
│                                                                      │
│ ┌─── 매핑 이력 ──────────────────────────────────────────────────┐   │
│ │                                                                │   │
│ │  2026-05-22 14:30  CREATED   SNOMED 54150009 (OFFICIAL)       │   │
│ │  2026-05-22 14:30  CREATED   ICD-10 J06.9 (AUTO)             │   │
│ │  2026-05-22 15:10  CREATED   ICD-11 CA07.Y (OFFICIAL)        │   │
│ │                                                                │   │
│ └────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.7 매핑 설정

```
┌──────────────────────────────────────────────────────────────┐
│ ⚙️ 매핑 설정                                                │
│                                                              │
│ 자동 매핑 설정                                                │
│ ──────────────────────────────────────                       │
│ 자동 매핑 활성화       [✓ ON]                                 │
│ 코드 추가 시 자동 제안  [✓ ON]                                │
│                                                              │
│ 신뢰도 임계값                                                 │
│ ──────────────────────────────────────                       │
│ 자동 확정 기준         [0.90] ←──────────○──── 0.95          │
│ 승인 대기 기준         [0.70] ←────○────────── 0.90          │
│ 매핑 불가 기준         [0.50] ←─○──────────── 0.70           │
│                                                              │
│ 교차 검증                                                     │
│ ──────────────────────────────────────                       │
│ 교차 검증 필수 (자동 확정 시)  [✓ ON]                         │
│ 최소 일치 소스 수              [2 ▼] (2개 이상 일치 시 확정)  │
│                                                              │
│ 벌크 매핑                                                     │
│ ──────────────────────────────────────                       │
│ 초당 처리 건수          [5 ▼] 건/초                           │
│ AI 타임아웃             [10] 초                               │
│ 승인 대기 만료 기간     [30] 일                               │
│                                                              │
│ AI 서버 연결                                                  │
│ ──────────────────────────────────────                       │
│ 서버 상태: ✅ 정상 (1.2초)                                    │
│ 사용 API: code/kcd, chat/enhanced, reference                 │
│                                                              │
│  [저장]  [기본값 복원]                                        │
└──────────────────────────────────────────────────────────────┘
```

### 4.8 매핑 이력/감사 로그

```
┌──────────────────────────────────────────────────────────────────────┐
│ 📊 매핑 이력                                          [내보내기 CSV] │
│                                                                      │
│ 기간: [2026-05-01] ~ [2026-05-22]  │  유형: [전체 ▼]  │  [검색]    │
│                                                                      │
│ ┌──────┬──────┬──────────┬──────────┬─────────┬──────┬──────────┐   │
│ │ 시간  │ 액션 │ 내부코드  │ 표준코드  │ 신뢰도  │ 방법 │ 수행자   │   │
│ ├──────┼──────┼──────────┼──────────┼─────────┼──────┼──────────┤   │
│ │15:10 │생성  │J06.9     │SNOMED    │ 0.95    │OFFIC │ 시스템   │   │
│ │      │      │          │54150009  │         │      │          │   │
│ │15:08 │승인  │K59.0     │SNOMED    │ 0.85    │AI    │ 관리자   │   │
│ │      │      │          │14760008  │         │      │          │   │
│ │15:05 │거부  │G47.9     │SNOMED    │ 0.42    │AI    │ 관리자   │   │
│ │      │      │          │-         │         │      │메모:부정확│   │
│ │14:30 │벌크  │진단 23건  │SNOMED    │ 평균0.88│AI    │ 관리자   │   │
│ │      │시작  │          │          │         │      │배치#a1b2 │   │
│ │14:32 │벌크  │진단 23건  │SNOMED    │ 15/6/2  │완료  │ 시스템   │   │
│ │      │완료  │          │          │확/대/실  │      │          │   │
│ │14:00 │롤백  │M79.3     │SNOMED    │ 0.92    │AI    │ 관리자   │   │
│ │      │      │          │22253000  │         │      │메모:오류 │   │
│ └──────┴──────┴──────────┴──────────┴─────────┴──────┴──────────┘   │
│                                                                      │
│ [◀ 이전]  1 / 5  [다음 ▶]                                           │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 5. API 설계 (보완)

### 5.1 자동 매핑

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| POST | `/api/v1/codes/auto-map` | 단건 자동 매핑 | ADMIN |
| POST | `/api/v1/codes/auto-map/bulk` | 벌크 일괄 매핑 (비동기) | ADMIN |
| GET | `/api/v1/codes/auto-map/bulk/:jobId` | 벌크 작업 상태 조회 | ADMIN |
| POST | `/api/v1/codes/auto-map/bulk/:jobId/cancel` | 벌크 작업 취소 | ADMIN |
| POST | `/api/v1/codes/auto-map/suggest` | AI 매핑 후보 제안 (저장 안 함) | ADMIN, DOCTOR |

### 5.2 승인 대기 관리

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| GET | `/api/v1/codes/pending-mappings` | 승인 대기 목록 (필터/정렬) | ADMIN |
| GET | `/api/v1/codes/pending-mappings/:id` | 승인 대기 상세 | ADMIN |
| POST | `/api/v1/codes/pending-mappings/:id/confirm` | 매핑 승인 (후보 선택) | ADMIN |
| POST | `/api/v1/codes/pending-mappings/:id/reject` | 매핑 거부 | ADMIN |
| POST | `/api/v1/codes/pending-mappings/bulk-confirm` | 일괄 승인 (고신뢰도) | ADMIN |

### 5.3 매핑 이력

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| GET | `/api/v1/codes/mapping-audit` | 매핑 변경 이력 조회 | ADMIN |
| POST | `/api/v1/codes/mappings/:id/rollback` | 매핑 롤백 (이전 상태 복원) | ADMIN |
| GET | `/api/v1/codes/mapping-stats` | 매핑 현황 통계 | ADMIN, DOCTOR |

---

## 6. 구현 로드맵 (보완)

| Phase | 기간 | 내용 | 산출물 | 의존성 |
|-------|------|------|--------|--------|
| **1** | 1주 | PendingMapping/BatchJob/AuditLog 스키마 + AutoMapperService 기본 | Stage 1 엔진 + 모델 | 없음 |
| **2** | 1주 | AI 매핑 엔진 (WeRU.B 3종 API 연동) + 교차검증 | Stage 2 엔진 | Phase 1 |
| **3** | 1주 | 매핑 대시보드 + 승인 대기 UI + 벌크 매핑 UI | FE 5개 화면 | Phase 1,2 |
| **4** | 1주 | 코드 추가 시 실시간 제안 + 코드 상세 매핑 탭 | 실시간 연동 | Phase 1,2 |
| **5** | 1주 | 매핑 이력/감사 + 설정 UI + 주기적 검증 스케줄 | 감사 추적 | Phase 1~4 |
| **6** | 별도 | 외부 변환표 자동 업데이트 (SNOMED/LOINC 릴리스) | 자동 업데이트 | Phase 1~5 |

---

## 7. 기대 효과 (보완)

| 지표 | 현재 | Phase 2 완료 | Phase 5 완료 |
|------|------|-------------|-------------|
| 전체 매핑률 | 67% (202/302) | **85%+** | **95%+** |
| SNOMED CT | 88% (80/91) | **95%+** | **98%+** |
| 신규 코드 매핑 시간 | 수동 10분 | **5초 (자동)** | **5초 + 검증 30초** |
| 관리자 부담 | 100% 수동 | **20%** (승인만) | **5%** (예외만) |
| 매핑 정확도 | 미측정 | **90%+** | **95%+ (피드백 학습)** |
| 감사 추적 | 없음 | 기본 | **완전 추적 + 롤백** |
| EMR 인증 | 미준비 | 부분 | **충족** |
