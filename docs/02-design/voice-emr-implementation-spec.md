# VoiceEMR 구현 착수 스펙 — 스키마 · 골든 테스트 · FE 컴포넌트

- **작성일**: 2026-07-29
- **상위**: `voice-emr-expansion.plan.md` · `voice-emr-pipeline-design.md` · `voice-emr-personalization-design.md`
- **주의**: **착수 준비 스펙**(미승인·WeRU.B Q4~Q8/Q12/Q13 대기). 스키마 실추가·마이그레이션은 **승인 후**. 여기선 드롭인 초안·테스트·컴포넌트 설계만.

---

# A. Prisma 스키마 초안 + 마이그레이션

> 컨벤션: `ScribeSession` 준용 — encounterId=스칼라 Uuid+index(느슨 결합)·enum 분리·Json·snake_case `@map`·`@db.Timestamptz()`.

```prisma
// ── VoiceEMR ─────────────────────────────────────────────
enum VoiceSessionStatus { ACTIVE CLOSED ABORTED }
enum VoiceMode          { READ DICTATE COMMAND }
enum VoicePhraseType    { ALIAS HABIT VOCAB MACRO }

/// 음성 세션 — 진료 단위(발화 세션 X-Session-Id는 비영속·클라 UUID)
model VoiceCommandSession {
  id             String             @id @default(uuid()) @db.Uuid
  encounterId    String             @map("encounter_id") @db.Uuid
  patientId      String             @map("patient_id") @db.Uuid
  doctorId       String             @map("doctor_id") @db.Uuid
  mode           VoiceMode          @default(READ)
  status         VoiceSessionStatus @default(ACTIVE)
  consentId      String?            @map("consent_id") @db.Uuid   // RECORDING 동의(구술/명령·P-7)
  audioRetention String             @default("none") @map("audio_retention") @db.VarChar(16) // none|transcribed
  startedAt      DateTime           @default(now()) @map("started_at") @db.Timestamptz()
  closedAt       DateTime?          @map("closed_at") @db.Timestamptz()
  createdAt      DateTime           @default(now()) @map("created_at") @db.Timestamptz()
  logs           VoiceCommandLog[]
  @@index([encounterId])
  @@index([doctorId])
  @@map("voice_command_sessions")
}

/// 명령/입력 감사 — 명령 실행·오더 초안은 audit.log 대상(법정보존)
model VoiceCommandLog {
  id              String              @id @default(uuid()) @db.Uuid
  sessionId       String              @map("session_id") @db.Uuid
  session         VoiceCommandSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  utteranceSid    String?             @map("utterance_sid") @db.VarChar(64) // STT 발화 세션(비영속·추적용)
  transcript      String?             @db.Text
  intent          String?             @db.VarChar(24)  // READ|VITAL|ORDER|DICTATE
  sub             String?             @db.VarChar(24)  // LAB|IMAGING|RX …
  slots           Json?
  nbest           Json?               // 코드매핑 후보(선택 이력)
  phraseId        String?             @map("phrase_id") @db.Uuid // 개인 ALIAS/MACRO 유발 시
  resultKind      String?             @map("result_kind") @db.VarChar(24) // query|vital_draft|order_draft|note_draft
  resultRef       String?             @map("result_ref") @db.VarChar(64)
  confirmedByUser Boolean             @default(false) @map("confirmed_by_user")
  droppedS        Float?              @map("dropped_s") // Q9 전사 누락(>0=경고)
  confidence      Float?
  createdAt       DateTime            @default(now()) @map("created_at") @db.Timestamptz()
  @@index([sessionId])
  @@map("voice_command_logs")
}

/// 개인 설정
model VoiceUserProfile {
  userId             String   @id @map("user_id") @db.Uuid   // 1인 1프로파일
  defaultMode        VoiceMode @default(READ) @map("default_mode")
  pttEnabled         Boolean  @default(true) @map("ptt_enabled")       // G2
  speakerGateEnabled Boolean  @default(false) @map("speaker_gate_enabled") // A.4
  language           String   @default("ko") @db.VarChar(8)
  updatedAt          DateTime @updatedAt @map("updated_at") @db.Timestamptz()
  @@map("voice_user_profiles")
}

/// 개인 맞춤 문구(문구·습관·어휘·매크로)
model VoiceCustomPhrase {
  id        String          @id @default(uuid()) @db.Uuid
  userId    String          @map("user_id") @db.Uuid
  type      VoicePhraseType
  pattern   String          @db.VarChar(200)  // 발화(정규화 키)
  action    Json                              // type별 타깃(설계 §B.1)
  enabled   Boolean         @default(true)
  priority  Int             @default(100)
  hitCount  Int             @default(0) @map("hit_count")
  createdAt DateTime        @default(now()) @map("created_at") @db.Timestamptz()
  @@unique([userId, type, pattern], map: "uq_voice_phrase")
  @@index([userId, type, enabled])
  @@map("voice_custom_phrases")
}
// ScribeVoiceProfile 는 재사용(voiceprint) — 신규 모델 없음.
```

### 마이그레이션 절차
1. 위 5블록을 `schema.prisma`에 추가(**승인 후**). `npx prisma validate` → `npx prisma migrate dev`(로컬) → manual SQL(`apps/api/prisma/manual/voice-emr-p1-YYYYMMDD.sql`) 준비.
2. **배포 함정**(스크라이브 교훈): 신규 모델 → **서버 `prisma generate` 필수**·`deploy.sh --schema`(자동 백업)·`db push --accept-data-loss` 금지.
3. config 시드(전부 OFF): `voiceEmr.enabled`·`voiceEmr.write/dictate/order.enabled`·`voiceEmr.pilotUserIds`·`voiceEmr.stt.*`(chunkMs·forceFinalMs·confHold·warmOnSessionStart·vocabShortlistMax·boundaryOverlapMs)·`voiceEmr.speakerGate.*`·`voiceEmr.enroll.minSamples`.
4. **추가 규모**: 모델 512→**516**(+4). 릴리즈 시 System Scale 갱신.

---

# B. Intent 파서 골든 테스트 케이스

형식: 발화 → 정규화 → 기대 `{intent, sub?, slots}` → 비고. `test/voice-emr/intent-parser.spec.ts`.

| # | 발화 | 정규화 | 기대 파싱 | 비고 |
|---|---|---|---|---|
| 1 | 지난 검사 결과 보여줘 | (동일) | READ{target:lab} | T0 |
| 2 | 최근 당화혈색소 알려줘 | | READ{target:lab,term:당화혈색소} | 용어 하이라이트 |
| 3 | 복용 중인 약 보여줘 | | READ{target:medication} | |
| 4 | 혈압 백삼십에 팔십 | 혈압 130에 80 | VITAL{metric:BP,values:[130,80]} | 한자어 수사·2값 |
| 5 | 체온 삼십육점팔 | 체온 36.8 | VITAL{metric:TEMP,values:[36.8]} | 소수 |
| 6 | 산소포화도 구십팔 퍼센트 | …98% | VITAL{metric:SPO2,values:[98]} | 단위 |
| 7 | 맥박 칠십둘 | 맥박 72 | VITAL{metric:HR,values:[72]} | |
| 8 | 공복 혈당 백사십육 | …146 | VITAL{metric:FBS,values:[146]} | |
| 9 | 혈압 백삼십 말고 백사십에 구십 | 130 말고 140에 90 | VITAL{metric:BP,values:[140,90]} | **자기정정** |
| 10 | 어 혈압 그 백삼십에 팔십 | 혈압 130에 80 | VITAL{…130,80} | **필러 제거** |
| 11 | 혈압 130에 80 하고 체온 36.5 | | [VITAL BP·VITAL TEMP] | **복합→분절** |
| 12 | 흉부 엑스레이 오더 낼게 | | ORDER/IMAGING{modality:XR,bodyPart:흉부} | |
| 13 | 상복부 시티 처방 | 상복부 CT 처방 | ORDER/IMAGING{modality:CT,bodyPart:상복부} | 동음이의(시티=CT) |
| 14 | 당화혈색소하고 크레아티닌 나가고 소변검사 추가 | | ORDER/LAB{labs:[당화혈색소,크레아티닌,소변검사]} | 다중 lab |
| 15 | 메트포르민 오백 밀리그램 하루 두 번 | …500mg bid | ORDER/RX{drug:메트포르민,dose:500,unit:mg,freq:bid} | |
| 16 | 아모잘탄 한 알 아침 식후 | …1정 | ORDER/RX{drug:아모잘탄,dose:1,unit:tab,freq:qAM,meal:pc} | 고유어 수사 |
| 17 | 리피토 이십 밀리그램 취침 전 | …20mg hs | ORDER/RX{drug:리피토→아토르바스타틴,dose:20,freq:hs} | 상품명→성분 n-best |
| 18 | 라식스 이십 정맥주사 한 번 | …20 IV 1회 | ORDER/RX{drug:라식스,dose:20,route:IV,freq:x1} | 경로 |
| 19 | 메트포르민 처방 | | ORDER/RX{drug:메트포르민,dose:null} | **용량 누락→확인서 보완** |
| 20 | 흉부 엑스레이 낼까요 | | (명령 아님·의문) | **PTT면 미발화·오픈마이크면 트리거 없음** |
| 21 | 타이레놀 오백 하루 세 번 | (HABIT:타이레놀→아세트아미노펜) | ORDER/RX{drug:아세트아미노펜,dose:500,freq:tid} | **개인 HABIT** |
| 22 | 내 고혈압 초진 세트 | (ALIAS) | ALIAS{action:order-set:HTN-초진} | **개인 ALIAS→초안** |
| 23 | 크레스토 처방 | | ORDER/RX{drug:크레스토→로수바스타틴 n-best} | 상품명 |
| 24 | 서방정으로 메트포르민 오백 | | ORDER/RX{nbest:[서방정,일반정]} | **n-best 구분 필요** |
| 25 | (잡음) | conf 0.32 | HOLD(재발화 요청) | **저신뢰 보류** |
| 26 | 취소 | | SYSTEM{cancel} | 예약어(ALIAS shadowing 금지) |

- **검증 불변**: 4·5·9(수사/정정)·11(복합 분절)·17·24(n-best)·21·22(개인)·25(보류)·26(예약어)는 필수 통과. 오더 케이스는 **자동 실행 0**(전부 확인 게이트).

---

# C. FE 컴포넌트 트리 · 상태

## C.1 컴포넌트 계층
```
<VoiceEmrProvider>                       // context: session·mode·status·profile
  <VoiceCommandOverlay>                   // 하단 고정 오버레이(진료 화면 위)
    <VoiceModeIndicator/>                 // read|dictate|command 배지
    <VoiceLiveCaption/>                   // partial 자막(replace)·dropped 배지
    <VoiceMicButton/>                     // PTT(누름/뗌)·오픈마이크 토글
    <VoiceStatusChip/>                    // warm/cold·연결·conf
  <VoiceConfirmLayer>                      // 확인 카드(모드별)
    <VitalConfirmCard/>  | <OrderConfirmCard/>(n-best) | <DictatePreview/>
  </VoiceConfirmLayer>
</VoiceEmrProvider>

/settings/voice (독립)
  <VoiceSettingsTabs>
    <VoiceEnrollmentTab/>   // A.5 등록(다표본·검증)
    <AliasEditor/> <HabitEditor/> <VocabEditor/> <MacroEditor/> <VoicePrefsTab/>
```

## C.2 훅 · 상태기계 (`useVoiceCommand`)
```
state: 'idle'|'warming'|'listening'|'capturing'|'parsing'|'confirming'|'executing'|'error'
전이:
  idle → (세션 시작·/warm) → warming → (loaded) → listening
  listening → (PTT down/VAD onset) → capturing
  capturing → (chunk 송신·partial 갱신) → capturing
  capturing → (final·스티칭) → parsing
  parsing → intent → (read) executing / (write·command) confirming
  confirming → (사용자 확정) → executing → (DRAFT 반영) → listening
  confirming → (취소) → listening
  * error(kill-switch·연속실패) → 키보드 폴백 안내(G8)
```

## C.3 Zustand 스토어 (`voice-store`)
```
{ session:{id,encounterId,mode,status},
  capture:{state,utteranceSid,seq,partial,noteText,dropped},
  parse:{intent,slots,nbest,confidence},
  confirm:{open,card,patient:{name,mrn,sexAge}},   // 환자 신원 항상 포함(G3)
  profile:{pttEnabled,speakerGateEnabled,enrolled},
  actions:{ startSession, pushChunk, onFinal, parse, confirm, cancel, endSession } }
```
- **환자 신원(`confirm.patient`)은 세션 시작 시 encounter에서 로드**해 모든 확인 카드에 주입(G3).
- `useVoiceCommand`가 AudioWorklet·청크 POST·상태기계 소유. UI는 스토어 구독만.

## C.4 접근성·폴백
- 음성은 **항상 보조**(키보드 병존·G8). 오버레이는 `prefers-reduced-motion` 존중·자막 aria-live. PTT 버튼 키보드 포커스·스페이스 홀드.

---

## 로드맵 대응 (P1 우선 구현 순서)
1. 스키마 4모델+config(OFF) → 2. `useVoiceCommand`+STT 어댑터+오버레이 → 3. **T0 조회**(확인 불요·저위험 e2e) → 4. intent 파서(골든 B) + **T1 활력**(PTT·확인 카드) → 5. `/settings/voice`(HABIT/VOCAB·enroll 수집). T2/T3·게이팅·ALIAS는 후속 Phase.
