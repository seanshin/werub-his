# VoiceEMR 앰비언트 대화 스트림 → SOAP 분석 유입 기획서

- **작성**: 2026-07-30 (v3.82.0 기준)
- **재검토**: 2026-09-22 — §13 "요약·정리가 충분한가" **아니다**(구술 게이트 우회·동의 쓰기 경로 없음·비식별 없음·보존 미배선·요약 정본 미연결). 보완 D1~D9 · 사람 결정 6
- **발단**: 진료 화면에서 의사·환자 대화가 **타과협진 아래에 텍스트 노트(대화 스트림)로 실시간 나열**되고, 그 내용이 **분석되어 SOAP 노트에 유입**되어야 한다는 요구.
- **한 줄 정의**: VoiceHub에 3번째 모드 **"대화 기록(앰비언트)"**을 신설 — 오픈마이크 라이브 전사를 우측 컬럼 대화 패널에 발화 단위로 쌓고, 규칙 NER+AI 하이브리드 분석이 SOAP 필드별 **DRAFT 제안 카드**를 만들며, 의사의 명시 확정으로만 SOAP에 반영한다.

---

## 1. 현행 실측 — 무엇이 있고 무엇이 없는가

| 구성요소 | 현행 | 판정 |
|---|---|---|
| 라이브 STT | `voice-emr/stt-chunk.client.ts` — /api/stt/chunk·partial 누적 재인식·25s 강제 final | ✅재사용 |
| 스티칭 | `voice-emr/transcript-stitcher.ts` — final만 append·1s 겹침 n-gram dedup·dropped_s 갭마커 | ✅재사용 |
| 클라 VAD | `pcmHasSpeech`(에너지 게이트·골든9) — 무음 청크 미전송 | ✅재사용 |
| 임상 NER | `scribe/clinical-ner.ts` — `extractClinicalEntities`(활력·약물·증상[부정]·계획)+`entitiesToSoap` | ✅재사용 |
| AI 분석 | `MedicalAiService.autoRecord`(NER+SOAP)·scribe draft 파이프라인(AI 부가·미가용 시 규칙 저하) | ✅재사용 |
| 동의 게이트 | `RecordingConsentGate`(ConsentType.RECORDING·PIPA) | ✅재사용 |
| 세션 영속 | `ScribeSession`(전사·draft 저장) | ✅재사용(확장) |
| **대화 캡처 모드** | 스크라이브=**녹음 파일 사후 배치**(webm 업로드→meeting/analyze), VoiceEMR=**PTT 명령**(발화 1건씩) | ❌**갭 — 오픈마이크 라이브 대화 없음** |
| **대화 스트림 UI** | 전사는 스크라이브 완료 후 `TranscriptViewer`로만·진료 중 실시간 노출 없음 | ❌**갭 — 타과협진 아래 패널 신설** |
| **SOAP 유입 회로** | 스크라이브 draft→`onApplySoap`(전체 세팅) 1회성 | ⚠️**부분 — 필드별·증분·출처 추적 없음** |
| 실시간 화자분리 | /api/stt/chunk에 diarize 없음(Q13)·voiceprint P3 이연 | ❌외부 제약 — §5에서 휴리스틱+사후정정으로 우회 |

**결론**: 신규 개발은 ①대화 캡처 모드(오픈마이크·연속) ②대화 스트림 패널 ③증분 분석·SOAP 제안 회로 3가지. 나머지는 조립.

## 2. 목표 / 비목표

**목표**
- G-1. 진료 중 대화가 **발화(utterance) 단위 텍스트 노트로 실시간 나열**된다(타과협진 아래·시각·화자 추정·신뢰도).
- G-2. 대화에서 임상 정보(증상·부정·활력·약물·계획)가 추출되어 **SOAP 필드별 제안**으로 나타난다.
- G-3. 제안은 **의사 확정(탭)으로만** SOAP 텍스트에 반영되고, 반영 문장은 **출처 발화로 역추적**된다(provenance).
- G-4. 전 과정이 동의·감사·서명 게이트 안전 불변을 지킨다.

**비목표**
- 자동 서명·자동 처방(절대 금지 — 여정 ENCOUNTER_SIGNED 자동전이 때문. 기존 불변 유지).
- 실시간 화자분리 정확도 보장(외부 제약 — 추정+사후 정정 모델로 설계).
- 진단(상병) 자동 확정 — A필드에는 **후보 텍스트만**, KCD 코드 확정은 기존 n-best+수동 검색 유지.
- 원음(오디오) 영속 저장 — 전사 텍스트만 영속(§7 프라이버시).

## 3. UX 설계

### 3.1 진입 — VoiceHub 3모드화
헤더 VoiceHub(현행: 음성 명령·스크라이브)에 **"대화 기록"** 추가:
```
🎤 음성  [ 명령(PTT) | 구술 | 대화 기록 ● ]   ← ● = 캡처 중 라이브 인디케이터
```
- 시작 조건: RECORDING 동의(게이트 재사용) + `voiceEmr.ambient.enabled` + 세션 warm(`/chunk/warm`).
- 캡처 중 헤더에 **상시 붉은 점 + "대화 기록 중" 배지**(몰래 녹음 방지 — 화면 명시 의무). 일시정지/종료 버튼.
- 명령(PTT)과 공존: PTT 누르는 동안 대화 캡처는 일시 중단(오디오 스트림 단일 소유) → 명령 종료 시 자동 재개.

### 3.2 대화 스트림 패널 (우측 컬럼·타과협진 아래)
`encounter/new/page.tsx` 우측 컬럼(처방 입력→타과 협진) 아래에 `<ConversationStreamPanel>` 신설:

```
┌ 💬 진료 대화 (음성)  ● 기록 중 · 12발화 · VAD 드롭 8 ────────┐
│ 09:12  [의사↔]  "어디가 불편해서 오셨어요?"                │
│ 09:12  [환자↔]  "3일 전부터 기침이 심하고 밤에 열이 나요"   │
│        └ 🔎 증상: 기침·발열(야간)          [S에 반영]      │
│ 09:13  [환자↔]  "가슴 통증은 없어요"                       │
│        └ 🔎 증상: 흉통 [부정]              [S에 반영]      │
│ 09:14  [의사↔]  "혈압 130에 85, 청진상 우하엽 수포음"       │
│        └ 🔎 활력: BP 130/85 · 소견        [O에 반영]      │
│ ⚠ 09:15  전사 누락 2.1초 (네트워크) — 서명 전 확인 필요     │
│ 09:16  [의사↔]  "흉부 엑스레이 찍고 항생제 3일 처방할게요"  │
│        └ 🔎 계획: CXR·항생제 3일          [P에 반영]      │
├──────────────────────────────────────────────────────────┤
│ [▶ 전체 분석 → SOAP 초안]   [∥ 일시정지]   [■ 종료]      │
└──────────────────────────────────────────────────────────┘
```

- **발화 카드**: 시각·화자 배지(의사/환자/미상 — **탭으로 수동 토글** 가능·↔ 표시=추정임을 명시)·전사 텍스트·저신뢰(conf<0.5) 흐림 처리·인라인 수정(연필)·삭제(잡담/제3자 발화 마스킹).
- **라이브 줄**: 최하단에 partial 자막(회색 이탤릭·replace 갱신) → final 확정 시 카드로 승격.
- **NER 칩**: 발화 확정 즉시 규칙 NER(`extractClinicalEntities` — 동기·수 ms)이 붙인 엔티티 칩 + **[S/O/P에 반영]** 단건 버튼.
- **갭 마커**: `dropped_s>0`·연속 청크 실패 시 경고 행(G5 — §7 서명 게이트 연동).
- **접기**: 패널 헤더 클릭으로 접기(대화가 길어지면 최근 20발화+스크롤).

### 3.3 SOAP 유입 — 2경로
**경로 A. 단건 반영(진료 중·즉시)**: 발화 카드의 [S에 반영] 탭 → 해당 필드 **말미에 append**(기존 텍스트 보존·줄바꿈)+출처 마커. 낮은 마찰·의사가 흐름 중 골라 담기.

**경로 B. 전체 분석(수시/종료 시)**: [전체 분석 → SOAP 초안] → 하이브리드 분석(§6) → **필드별 diff 제안 카드**:
```
┌ 🤖 SOAP 초안 제안 (대화 14발화 분석 · WeRU.B) ──────────┐
│ S  + "3일 전부터 기침·야간 발열. 흉통은 부정."  [반영][편집][건너뛰기] │
│ O  + "BP 130/85. 청진 우하엽 수포음."          [반영][편집][건너뛰기] │
│ A  + (제안) 지역사회획득 폐렴 의증 — R/O 급성기관지염 [반영]…       │
│ P  + "흉부 X-ray. 항생제 3일. 3일 후 f/u."      [반영][편집][건너뛰기] │
│               [모두 반영]  [닫기]                                    │
└──────────────────────────────────────────────────────┘
```
- 각 제안 행에 **출처 발화 번호**(호버/탭 시 해당 카드 하이라이트 스크롤).
- 반영은 항상 **append**(기존 수기 입력 덮어쓰기 금지). 세션 종료 시 미분석 발화가 있으면 자동으로 경로 B 카드 1회 제시(강제 아님·닫기 가능).
- 기존 `EncounterScribeSection.onApplySoap`(전체 세팅)과 달리 **필드별·증분** — 스크라이브 사후 draft와 회로 통일(§9 마이그레이션).

### 3.4 화자 표시 원칙
- 실시간은 **추정**(§5) — 배지에 ↔ 아이콘으로 "추정·탭하여 정정" 명시. 오귀속이 임상 왜곡(환자 발화를 의사 소견 O로)으로 이어지지 않게 **S 반영은 화자 무관 허용·O 반영은 의사 발화만 기본 제안**(환자 발화를 O로 반영 시 1회 확인).

## 4. 파이프라인 아키텍처

```
[오픈마이크] getUserMedia → AudioWorklet → pcmHasSpeech(VAD)
   │ 무음 프레임 드롭(전송 0·환각 차단)                     ← 배포됨
   ▼
ChunkScheduler (partial ≥1.5s · 25s 강제 final · sid 순환)   ← 배포됨
   ▼ POST /api/stt/chunk (warm 선행·Bearer gpuKey)          ← 배포됨
TranscriptStitcher (final append·1s 겹침 dedup·갭마커)       ← 배포됨
   ▼ 발화 확정(utterance)
┌─ 즉시(동기): extractClinicalEntities → NER 칩·단건 반영     ← NER 재사용
└─ 수시/종료(비동기): 전체 전사 → autoRecord(AI)             ← scribe draft 재사용
       ├ AI 가용: NER+SOAP+감별 → 필드별 제안 카드
       └ AI 미가용: entitiesToSoap 규칙 저하(동일 카드·"규칙" 배지)
   ▼ 의사 확정(필드별 [반영])
SOAP setSoap append + provenance 저장 + 감사
   ▼ (사후·선택) meeting/analyze 배치 diarize 가용 시 화자 재귀속 정정
```

**발화 경계 확정 규칙**: ①25s 강제 final ②VAD 무성 1.2s 지속 시 조기 final(대화 턴 교대 감지 — ChunkScheduler에 `silenceFinalizeMs` 옵션 추가) ③PTT 명령 개입 시 즉시 final. 짧은 턴 교대가 많은 진료 대화 특성상 ②가 실질 경계.

## 5. 화자 귀속 — 3단 전략 (외부 제약 우회)

/api/stt/chunk는 화자분리가 없다(Q13 실측). 단계별로:

| 단계 | 방식 | 정확도 | 상태 |
|---|---|---|---|
| **A. 휴리스틱(P1)** | 기존 C안 재사용+대화 특화: 질의형("~세요?"·"~나요?")=의사 경향·1인칭 증상("아파요"·"~해요")=환자 경향·직전 턴 교대 가정·**신뢰 낮으면 '미상'**(억지 귀속 금지) | 낮음~중 | 즉시 가능 |
| **B. 배치 diarize 정정(P2)** | 세션 종료 후 `/api/meeting/analyze`(스키마 확정 요청 발신됨·회신 대기)로 화자 재귀속 — 패널·provenance 소급 갱신(이미 반영된 SOAP 텍스트는 불변·출처 라벨만 갱신) | 높음 | 외부 대기 |
| **C. voiceprint 게이팅(P3)** | ScribeVoiceProfile 임베딩 1:1(ECAPA) — 법무(생체)·DPA 변경 선결 | 최고 | 이연(기존 결정 유지) |

수동 토글(§3.4)이 모든 단계의 최종 정정 수단. **화자 귀속은 UX 라벨이지 안전 판정 근거가 아니다** — 안전은 §7 확정 게이트가 담당.

## 6. 분석·SOAP 매핑 규칙

| 추출 | 대상 필드 | 규칙 |
|---|---|---|
| 증상(부정 포함) | **S** | 환자 발화 우선. 부정은 "흉통은 부정" 형태로 보존(놓치면 임상 왜곡) |
| 활력·검사 수치·신체소견 | **O** | 의사 발화 기본. `korean-number` 수사 정규화("백삼십에 팔십오"→130/85) |
| 진단 가설·감별 | **A** | **"(제안)" 접두 필수**·확진 표현 금지. 상병 코드는 미확정(기존 진단 검색 위젯으로 유도만) |
| 검사·처방·f/u 의도 | **P** | 텍스트만. **처방 입력창 자동 채움 금지**(오더는 기존 T3 확인카드 경로만) |
| 잡담·비임상 | 제외 | NER 무매치 발화는 제안에 미포함(스트림에는 남음·의사가 삭제 가능) |

- AI 경로(autoRecord)와 규칙 경로 모두 **동일 제안 카드 스키마**로 수렴(`{field, text, sourceUtteranceIds[], engine: 'AI'|'RULE', confidence}`).
- conf<0.5 발화는 분석 입력에서 제외(환각 유입 차단)·패널에 흐림 표시.

## 7. 안전·프라이버시 불변 (기존 골격 계승)

1. **동의 선행**: RECORDING 동의 없으면 모드 진입 불가(게이트 재사용). 철회 시 세션 전사 파기.
2. **오디오 미저장**: 청크는 STT 후 휘발·**전사 텍스트만 영속**(PIPA 최소화). WeRU.B도 발화 미저장(Q11 확정).
3. **DRAFT-only**: 대화·분석·제안 어느 것도 자동으로 기록을 확정하지 않음. SOAP 반영=의사 탭. **자동 서명 절대 금지**.
4. **G5 서명 게이트**: 갭 마커(dropped_s) 미확인 시 서명 차단 배너(기존 canSignNote 확장 — "대화 전사 누락 구간 확인 필요").
5. **G3 환자 신원**: 패널 헤더에 환자명·MRN 고정 표기. 세션은 encounterId 결속(타 환자 화면 전환 시 자동 종료).
6. **가시성**: 캡처 중 상시 인디케이터. 환자 요청 시 즉시 중지·해당 구간 삭제(발화 카드 삭제=분석 입력에서도 제외).
7. **감사**: 세션 시작/종료/반영/삭제 전량 AuditLog(기본 감사 ON 규약·resourceId=patientId 열람 규약 준수).
8. **환각 방어**: 클라 VAD(배포됨)+`no_speech_prob` 서버 신호(WeRU.B 회신 대기 — 오면 드롭 임계 0.6 배선).

## 8. 데이터 모델·API (초안 — 실추가는 착수 승인 후)

**모델**: `ScribeSession` 재사용(source='AMBIENT' 구분 컬럼 추가) + 신설 1:
```prisma
model VoiceUtterance {  // voice_utterances
  id            String   @id @default(uuid())
  sessionId     String   // ScribeSession
  seq           Int      // 발화 순번
  startedAt     DateTime
  text          String   // 확정(final·스티칭 후)
  editedText    String?  // 의사 수정본(원문 보존)
  speaker       String   // DOCTOR | PATIENT | UNKNOWN
  speakerSource String   // HEURISTIC | DIARIZE | MANUAL
  confidence    Float?
  deleted       Boolean  @default(false)  // 마스킹(소프트)
  droppedSec    Float?   // 직전 갭
  @@unique([sessionId, seq])
}
```
- SOAP provenance: Encounter 프로비넌스 3컬럼(기구현) + 반영 이력은 AuditLog changes에 `{field, sourceUtteranceIds}` 기록(신규 테이블 불요).

**EP**(scribe 모듈 확장·DOCTOR/NURSE·DTO class-validator):
| EP | 용도 |
|---|---|
| `POST /scribe/ambient/session` | 세션 시작(동의·config 게이트·warm) |
| `POST /scribe/ambient/:sid/utterance` | 발화 확정 저장(스티칭은 FE·서버는 영속+NER 응답) |
| `PATCH /scribe/ambient/:sid/utterance/:seq` | 수정·화자 토글·삭제 |
| `POST /scribe/ambient/:sid/analyze` | 전체 분석(AI/규칙)→제안 카드 |
| `POST /scribe/ambient/:sid/close` | 종료(+배치 diarize 큐잉·가용 시) |

STT 청크 자체는 기존 voice-emr `/voice/session/:sid/chunk` 재사용(스로틀 제외 기적용).

## 9. 기존 스크라이브와의 관계 (중복 방지)

- **스크라이브(녹음 파일 사후)**: 유지 — 네트워크 불안·긴 상담 등 배치가 맞는 경우의 폴백. VoiceHub에서 "대화 기록(라이브)"과 "녹음(사후)"을 한 지붕 아래 명확히 구분 표기.
- **draft 회로 통일**: 경로 B 제안 카드를 정본으로 하고, 스크라이브 사후 draft도 동일 카드 UI로 수렴(EncounterScribeSection의 전체 세팅 → 필드별 증분으로 교체). 분석 코드는 양쪽이 동일 함수 사용(이미 scribe 모듈 공유).
- 장기적으로 스크라이브×VoiceEMR 전략 계획서(기반공유·각자발전)의 "기반공유" 실현체가 이 회로.

## 10. Config 게이트

| key | 기본 | 의미 |
|---|---|---|
| `voiceEmr.ambient.enabled` | **false** | 대화 모드 전역(파일럿: pilotUserIds 재사용) |
| `voiceEmr.ambient.silenceFinalizeMs` | 1200 | 무성 조기 final 경계 |
| `voiceEmr.ambient.confidenceFloor` | 0.5 | 분석 제외·흐림 임계 |
| `voiceEmr.ambient.autoAnalyzeOnClose` | true | 종료 시 제안 카드 1회 자동 제시 |
| `voiceEmr.ambient.aiDraft.enabled` | false | AI 경로(OFF=규칙만) |

## 11. Phase 계획

| Phase | 내용 | 규모 | 선결 |
|---|---|---|---|
| ~~**P0 대화 스트림**~~ | ✅**배포 완료(2026-07-30·`b7bbb2a0`)** — 오픈마이크 캡처(무성 1.2s 조기 final)·발화 카드 패널(수정/삭제/화자↔토글)·영속(VoiceUtterance+EP5)·동의/인디케이터/감사. 테스트 32·프로브 3종 | — | ✅ |
| ~~**P1 SOAP 유입**~~ | ✅**배포 완료(2026-07-30·`be2768aa`)** — 경로 A 단건 반영(append only·환자 발화 O/P 확인)·경로 B 제안 카드(출처 역추적·건너뛰기·모두 반영·종료 시 자동 1회)·provenance(aiScribed+감사)·G5 서명 차단. 테스트 31·프로브 4종. **동반 봉합=NER 실결함 3건**(수사 계사 오변환 142→140·공백 미스매치·구어 증상 12종) | — | ✅ |
| **P2 정확도** | AI 경로 ON(파일럿)·배치 diarize 화자 정정·no_speech_prob 드롭 배선 | 1일+ | WeRU.B 회신 2건(meeting/analyze 스키마·no_speech_prob) |
| **P3 화자 게이팅** | voiceprint 1:1(오픈마이크 중 의사/환자 자동 판별) | — | 법무(생체)·DPA — 기존 이연 결정 유지 |

**파일럿 프로토콜**: 기존 `voice-emr-pilot-protocol.md` 준용 — PA-0(자기 진료실 1인)→확대. 롤백=config OFF 즉시. 성공 지표: 발화 수정률<20%·제안 채택률>50%·오귀속으로 인한 O 오반영 0.

## 12. 리스크·미결

| # | 리스크 | 대응 |
|---|---|---|
| R1 | 오픈마이크 장시간 = STT 동시성 점유(상한 4~5 진료실) | 파일럿 소수·VAD로 무음 미전송(실전송량은 발화 시간만)·피크 시간 통지 기준수 준수 |
| R2 | 화자 오귀속 → O 오반영 | §3.4 O는 의사 발화만 기본 제안+확인·수동 토글·P2 정정 |
| R3 | 환각 문장이 제안에 유입 | VAD(배포)+conf 플로어+no_speech_prob(대기)·제안은 항상 사람 확정 |
| R4 | 제3자(보호자) 발화 프라이버시 | UNKNOWN 화자 기본 분석 제외 옵션 검토·삭제권·동의 안내문에 명시(법무 확인 항목) |
| R5 | 패널이 진료 흐름 방해(우측 컬럼 길이) | 접기 기본·최근 20발화·처방 입력과 시각적 분리 |
| 미결 | 보호자 동석 시 동의 범위(법무)·`no_speech_prob`/`meeting/analyze` 회신(WeRU.B)·A필드 제안의 SaMD 경계(D-1 자문 범위 재확인) | B절 게이트 등재 |

---

관련: `docs/01-plan/features/voice-emr-expansion.plan.md`·`docs/02-design/voice-emr-pipeline-design.md`·스크라이브×VoiceEMR 전략 계획서·[[ambient_clinical_scribe]]

---

## 13. 재검토 — "음성(VoiceEMR)으로 진료기록 요약·정리가 충분히 되는가" (2026-09-22 · 코드 실측)

> 발단: 사람 요청("voiceEMR 기반으로 진료기록 요약과 정리가 충분하게 진행될 수 있는지 재검토").
> 방법: 기획서 4종(`voice-emr-expansion`·본 문서·`ambient-clinical-scribe`·`clinical-draft-authoring`)과
> **HEAD 코드**(api `voice-emr/`·`scribe/`·`record-timeline/`·web `components/voice-emr/`·`scribe/`·진료 화면)를 한 줄씩 대조.
> 🔴 아래 결함은 **코드 읽기로 확정**한 것이고 **런타임 재현은 하지 않았다**(운영 DB 읽기 불가). 재현이 필요한 항목은 그렇게 적었다.

### 13.0 한 줄 판정

**아니다.** 대화를 **텍스트로 남기고**(L1) **조각을 뽑아**(L2) **S/O/P 에 붙이는**(L3) 데까지는 배선돼 있으나,
① **정리**는 "붙이기"이지 정리가 아니고(A·주호소·요약 문장 없음 · 붙인 뒤 정돈 없음),
② **요약 정본**(`record-timeline` 시계열 요약·의미찾기)은 **대화를 한 줄도 보지 못하며**(트랙 없음),
③ 구술(T2)은 **게이트를 우회해 S 를 덮어쓰고** 있고,
④ 동의·비식별·보존 세 층이 **문서에는 있고 코드에는 없다**.
그리고 운영은 `voiceEmr.ambient.enabled=true` 다(2026-09-15 결정 설명자료 실측 · `legal.voiceRecording.basis` 미결).

### 13.1 실측 — 요약·정리의 네 층으로 다시 나눈다

"요약"을 한 단어로 두면 있는 것과 없는 것이 섞인다. 네 층으로 갈라 잰다.

| 층 | 뜻 | 현행 | 판정 |
|---|---|---|---|
| **L1 원문 보존** | 발화가 텍스트로 남는가 | `VoiceUtterance`(원문 `text`·수정 `editedText`·화자·신뢰도·누락초) · 종료 시 `ScribeSession.transcript` 스냅샷 | ✅ 있음 — 단 **보존기간 설정이 어디에도 안 읽힘**(13.2 P1-4) |
| **L2 구조화** | 발화에서 임상 조각을 뽑는가 | `clinical-ner.ts` — 활력 6종·증상 39+구어 12·약(용량 앵커)·계획 6종 · 부정 인식 · 절 분할 | ⚠️ 부분 — **과거력·알레르기·신체진찰 소견·복약 이력·사회력 0** · A(평가) 규칙 미제안(의도) |
| **L3 기록 유입** | 조각이 SOAP 에 들어가는가 | 경로 A 칩 단건 append · 경로 B `analyze` 제안 카드(규칙 항상 · AI 는 `aiDraft.enabled` 시 부가) · 반영은 append only · provenance(`aiScribed`·`appliedFields`) · 서명 시 편집거리 | ⚠️ 부분 — **"정리"가 아니라 "붙이기"**: 같은 증상이 세 번 나오면 세 줄·시간 순서 없음·**주호소(CC)·경과·요약 문장 없음** · 🔴 구술(T2)은 append 규약 밖(13.2 P0-1) |
| **L4 진료기록 요약** | 환자 단위·시계열 요약이 대화를 반영하는가 | `record-timeline.service` `summarize()`·`insights()` — 12 트랙(`TIMELINE_TRACKS`) | ❌ **없음** — 대화·스크라이브 트랙이 없다. 요약 정본은 **의사가 SOAP 에 붙인 결과만** 본다(그건 이미 진료기록이니 당연하고, 대화 자체는 요약 재료가 아니다). 그리고 그게 **맞는 설계**다(13.3) |

**실측 수치**: BE 스펙 voice-emr 10파일 125 it · scribe 5파일 49 it · web 7파일 63 it. 7월 30일 이후 이 축의 **기능 변경은 2건**(8-07 확정 쓰기 하드닝 · 8-27 확인 카드 크래시·고위험 판정) — 나머지는 i18n·정직성 횡단.

### 13.2 결함 — 코드 실측(재현 전) · 위험순

#### 🔴 P0-1. 구술(T2)이 게이트를 우회해 **S 를 덮어쓴다** — 자유 발화 전부가 기록으로 들어간다
- `intent-parser.ts:143` — 어떤 규칙에도 안 걸린 발화는 **전부 `DICTATE`**(폴백). `:109` 의문형도 `DICTATE`.
- `orchestrator.ts:96` — `dictate` outcome 은 **`needsConfirm` 없음·환자 신원 없음**("오더/입력은 전부 needsConfirm+환자 신원" 주석의 예외).
- `voice-emr.service.ts:51` — `voiceEmr.dictate.enabled` 는 **세션 시작 mode=DICTATE 일 때만** 본다. `parse()` 는 mode 를 다시 보지 않는다.
- `VoiceEmrLauncher.tsx:75` — 세션을 **`'read'` 로 시작**하고 `:52` — `dictate` 를 받으면 **확인 카드 없이** `onApplySoap('subjective', text)`.
- `encounter/new/page.tsx:1565` — VoiceHub 의 `onApplySoap` 은 `setSoap(prev => ({...prev,[field]: text}))` = **덮어쓰기**(앰비언트의 `appendSoap` 규약 밖).
- 결과: 운영에서 `dictate.enabled=false` 인데, 의사가 "🎤 음성"을 켜고 **아무 말이나 하면**(환자의 말·잡담 포함 — PTT 라도 마이크는 방을 듣는다) **S 가 그 문장으로 교체**되고, 아무 곳에도 provenance 가 남지 않으며(`markSoapDraftApplied` 는 스크라이브 경로만), 시드 판정 규칙 §4 "가짜 게이트"·§2 "정본 둘"(append vs replace) 에 동시에 걸린다.
- 🔴 이 경로는 **어떤 테스트도 보지 않는다**(`dictate` 를 다루는 스펙은 파서 빈 입력 1건·게이트 목 1건뿐).

#### 🔴 P0-2. RECORDING 동의를 **만들 화면이 없다** — 기능이 켜져 있어도 국내 환자는 시작조차 못 한다
- 서버는 `ConsentForm(consentType=RECORDING, isValid)` 행을 요구한다(`ambient.service.ts requireRecordingConsent`·스크라이브 동일).
- 동의서 워크스테이션 `workstation/consent/page.tsx:41-44` `CONSENT_TYPES` 에 **RECORDING 이 없다**. web 전체에서 RECORDING 을 고를 수 있는 곳은 **외국인 환자 등록 화면 하나**(`patients/register/foreign/page.tsx:54`). 태블릿·모바일·시드 0.
- `RecordingConsentGate.tsx` 는 **클라이언트 체크박스**다(동의서를 만들지 않는다 — 주석이 그렇게 적고 있다).
- 결과: 패널은 "동의 접수 후 다시 시작하세요"라 하는데 **접수할 곳이 없다**. "데이터 0행"의 세 번째 뜻(쓰기 경로가 막혀 있다)이다.

#### 🔴 P0-3. 대화 원문이 **비식별 없이** AI 서버로 나간다 — 기획서·메모의 "PHI 비식별" 표기는 사실이 아니다
- `scribe.service.ts:350`·`ambient.service.ts analyze()` → `medicalAi.autoRecord({conversation})` → `request()` → `aiFetch`. **scribe 모듈에 `redact*` 호출 0.**
- 정본 `common/util/ai-phi-redact.ts`(`redactForAiEgress(text,{patientNames,staffNames})`·`redactIdentifiers`)는 있고 `agent-session`·`data-quality` 두 소비처는 쓴다 — 이 축은 안 쓴다. egress 가드는 **목적지 호스트**만 본다(내용 아님).
- 환자가 말한 이름·전화·주민번호·타인 이름이 그대로 간다. 원내 GPU 라도 **"외부로 제공되지 않습니다"**(게이트 문안)는 설치 형태에 따라 거짓이 된다(§14 G9).

#### 🟠 P1-1. 스크라이브 초안 "적용"이 덮어쓴다 — §9 "draft 회로 통일" 미이행
`ScribeDraftPanel` → VoiceHub `onApplySoap` → 위 P0-1 과 같은 `setSoap` 교체. A(평가)에 "(제안)" 접두 강제도 앰비언트 경로(`aiSuggestionsFrom`)만 있다. 스크라이브 전사는 OFF 라 지금은 잠자고 있지만, 켜지는 날 그대로 산다.

#### 🟠 P1-2. 패널의 서버 쓰기 3자리가 실패를 삼킨다 — 프라이버시 삭제가 "지워진 척"할 수 있다
`ConversationStreamPanel.tsx:231`(화자 토글) `:236`(**삭제**) `:244`(**반영 provenance**) 전부 `.catch(() => {})`.
삭제는 화면에서 사라지지만 서버 `deleted=false` 로 남을 수 있고(환자가 "이 부분 지워 주세요" 한 구간), 반영은 텍스트가 SOAP 에 들어갔는데 `aiScribed`·`appliedFields` 가 없어 **서명 시 편집거리가 영원히 null**(과신 모니터 공백). CLAUDE.md §1 "`.catch(() => 기본값)`".

#### 🟠 P1-3. T0 "핸즈프리 조회"는 **토스트**다
`VoiceEmrLauncher.tsx:51` — `read` outcome 은 `toast.info('조회: lab')` 로 끝난다. 아무것도 조회하지 않는다. 안내문("조회·활력 기록·오더 등을 지시합니다 … 현재 조회 중심")과 go-live `flag.voiceEmrEnabled`("음성 EMR(조회) 개방")가 **없는 동작을 있다고** 말한다(P16). READ 는 전 의료진에게 열려 있다.

#### 🟠 P1-4. 보존기간 설정이 **어디에도 안 읽힌다**
`scribe.transcript.retention`(90일)·`scribe.audio.retention` 소비처 **0**(`config-runtime.service.ts:137,139` 선언만). 전사·발화는 영구 보존이고 파기 크론·불변식·감시자 항목 없음(`sentinel/`·`data-integrity-scan.sql` 에 scribe 0건). 결정 설명자료가 "보관 기간·파기 규정은 정해진 적이 없다"고 적은 그 자리 — 정해져도 **먹을 다이얼이 없다**.

#### 🟡 P2. 정리 품질 자체
- 규칙 제안은 **중복만 제거**하고 시간·인과·경과를 모른다("3일 전부터 기침" → `기침 호소.`).
- `analyze` 결과에 **분모가 없다** — "12발화 중 규칙이 읽은 발화 N·아무 조각도 못 뽑은 발화 M" 이 없어 "제안 3건"이 대화의 얼마를 덮었는지 모른다(CLAUDE.md §1 분모 병기).
- 스크라이브 `TranscriptViewer` 화자 재라벨은 **로컬 상태만**(`scribe-api` 에 PATCH 없음) — `draft()` 는 DB `transcript` 를 읽어 재라벨이 초안에 반영되지 않는다.
- 붙인 텍스트는 **"저장(임시)" 를 누를 때까지 React 상태**(자동저장 0 · `clinical-draft-authoring` L1 유실방어 미착수) — 대화 20발화를 붙이고 새로고침하면 사라진다.

### 13.3 판정 — 무엇이 "충분"인가 (설계 원칙 3)

1. **대화는 진료기록이 아니다.** 요약 정본(`record-timeline`)이 대화 원문을 요약 재료로 삼으면 **의사가 채택하지 않은 말**이 환자 요약에 섞인다. 그래서 L4 가 대화를 안 보는 것은 **결함이 아니라 원칙**이다. 채워야 할 것은 "대화 → 기록" 유입(L3)의 **정리 품질**과, 요약이 **"이 기록의 어느 부분이 대화에서 왔는가"**(provenance) 를 아는 것이다.
2. **정리 = 붙이기 + 정돈.** 붙인 조각을 시간순·중복 병합·주호소 승격·부정 증상 분리로 **한 번 정돈한 초안**을 의사가 보고 확정해야 "정리"다. 지금은 조각을 필드 끝에 줄 단위로 쌓는다.
3. **모든 음성 쓰기는 같은 문**(확인 카드·환자 신원·append·provenance·게이트)을 지난다 — 구술이 그 문 밖에 있는 것이 P0-1 이다.

### 13.4 보완 설계 — 신설은 최소, 정본은 하나

| # | 항목 | 어디를 | 무엇을 |
|---|---|---|---|
| **D1** | 구술(T2) 정상화 | `orchestrator.ts` · `voice-emr.service.parse()` · `VoiceEmrLauncher` · VoiceHub `onApplySoap` | `dictate` 에 `needsConfirm:true`+`patient` 부여 → **확인 카드**(환자 신원 고정·**필드 선택 S/O/A/P**·편집) → 확정 시 **append**(`appendSoap` 정본 하나로 · VoiceHub 의 `setSoap` 교체 삭제) → `applySuggestion` 과 같은 provenance(`engine:'DICTATE'`). 서버 `parse()` 가 **세션 mode ≠ DICTATE 이면 dictate outcome 을 `hold`(사유 `DICTATE_OFF`)로 바꾼다**(게이트를 시작 시점에만 두지 않는다). |
| **D2** | 정돈 초안 | `ambient-soap.ts` 신규 `consolidate()` | 발화 seq 순으로 ① 첫 증상 발화 → **주호소** ② 같은 증상 반복 병합(최초 seq 유지) ③ 부정 증상 별도 문장 ④ 활력은 최신값·이전값 괄호 ⑤ 계획은 종류별 묶음. **A 는 여전히 규칙 미제안.** 출력에 **분모** `{utterances, withEntities, noEntities, lowConfidence, skipped}` 동봉 — 카드 머리글이 "12발화 중 7발화에서 제안"으로 말한다. |
| **D3** ✅2026-09-27 | 요약 정본과의 연결 | `record-timeline` `TIMELINE_TRACKS` +`CONVERSATION`(본문 **미포함** — 세션 시각·발화 수·반영 필드·엔진·누락초만) · `summarize()` 는 `Encounter.aiScribed` 인 진료에 "대화 유래 초안에서 출발(편집거리 N)" 한 줄 | 요약이 **출처를 알되 원문은 들지 않는다**(정본 둘 금지 · `AI_PROPOSAL` 트랙과 같은 규약). |
| **D4** | 동의 쓰기 경로 | `workstation/consent/page.tsx` `CONSENT_TYPES` + RECORDING · 템플릿(법무 초안 `scribe-recording-consent-draft-20260707.md` A 절 → **법무 확정 전엔 "검토 전" 표시**) · 패널 오류에 **접수 화면 링크** | `RecordingConsentGate` 는 "확인" 게이트로 남기되 문안을 **설치 형태에 따라** 말한다("외부로 제공되지 않습니다" 단정 삭제 — AI 서버 위치는 설정이다). |
| **D5** | PHI 비식별 | `scribe.service.draft()` · `ambient.service.analyze()` | `autoRecord` 전 `redactForAiEgress(conversation,{patientNames:[환자 성명], staffNames:[의사 성명]})` + `redactIdentifiers`. 치환 건수를 `analyze` 응답 `redacted:{names,ids}` 로 돌려 카드가 말한다. 가드: scribe 모듈에서 `autoRecord(` 를 부르는 모든 자리가 `redactForAiEgress` 를 지난다(호출 단위 — 이름만 보지 않는다). |
| **D6** | 보존·파기 | ✅ **2026-09-23 착수** — 신규 크론 대신 **기존 보존 엔진**(`retention.service.ts`) 핸들러 `SCRIBE_TRANSCRIPT` · 불변식 **+2**(72 🟡·72b ⚪) · 화면은 `/admin/retention` 기존 자리 | **한 것**: `scribe.transcript.retention` 첫 소비처(정책 행 retentionDays 는 쓰지 않음·출처 병기) · 집계(후보+분모: 전사 남은 종료 세션·보존명령 제외·미반영 대기) · 파기 = 발화 삭제·`transcript=null`·(`scribe.audio.retention≠keep`) 잔존 원음 · `draftSnapshot` **보존** · 감사(종류·건수·세부·cutoff·일수). **일부러 안 한 것**: 자동 파기(크론)는 만들지 않았다 — 법무 미결(`policy.scribe.transcriptRetentionDays`)이라 게이트 전부 닫힘: 전역 `retention.purgeEnabled=false` · 정책 REPORT_ONLY·법무 미확정(시드) · **설정 출처 default/unset 이면 거부**(기본값은 정책 아님) · 4-eyes · 보존명령 제외(조회 실패=거부). 켜는 것은 사람 몫. 72 는 설정 행이 없으면 0(평가 안 됨)이라 72b 가 그 상태를 센다. `deleteSession()` 이 전사·발화를 남기는 것(오디오만 삭제)은 **손대지 않았다**(사람 판단). 정본 `docs/05-reference/sentinel-invariants-2026-09-23.md` |
| **D7** | 삼킴 제거 | `ConversationStreamPanel.tsx:231,236,244` | 실패 시 **되돌리고 말한다**(삭제 실패 = 카드 복원 + "서버에 남아 있습니다" · 반영 실패 = 텍스트는 그대로 두되 "출처 기록 실패 — 서명 시 편집거리 산출 불가" 배너·재시도). |
| **D8** | 스크라이브 초안 통일 | `ScribeDraftPanel`·VoiceHub | 적용 = 경로 B 카드와 같은 함수(append·"(제안)" 접두·provenance). §9 이행. 재라벨은 서버 PATCH 로 영속(없으면 초안이 재라벨을 모른다). |
| **D9** ✅2026-09-27(ⓑ 정직화만 · ⓐ 개방은 등록부 `policy.voice.readOpen`) | T0 정직화 | `VoiceEmrLauncher`·VoiceHub 안내·go-live `flag.voiceEmrEnabled` note | 두 갈래 중 하나(**사람 결정 H3**): ⓐ 조회를 실제로 연다(해당 탭 전환+검색 프리필 — 처방 `onOrderDraft` 와 같은 패턴) ⓑ 열기 전까지 안내를 "명령 인식 시험 중(조회 결과는 표시하지 않습니다)"로 고친다. 지금처럼 "조회 개방"이라 말하지 않는다. |

**하지 않는 것**: 대화 원문을 요약 정본에 넣는 것 · A(평가)를 규칙으로 만드는 것 · 대화 전체를 자동으로 SOAP 에 넣는 것(항상 사람 확정) · 오디오 저장(현행 미저장 유지).

### 13.5 순서 — 운영이 켜져 있으니 막는 것부터

1. **즉시(코드 · 사람 결정 불요)**: D1 의 **서버 한 줄**(`parse()` 가 mode≠DICTATE 이면 dictate→hold) + D7 + D5. 이 셋은 "지금 새는 것"이다.
2. **D4** — 동의 없이는 기능이 존재하지 않는 것과 같다(그리고 사람 결정 `legal.voiceRecording.basis` 가 `SUSPEND_UNTIL_REVIEW` 면 `ambient.enabled` OFF 가 먼저다 — 그건 이 문서가 정하지 않는다).
3. **D1 나머지·D2·D8** — "정리"의 실체. 골든은 **실제 대화문**으로(7-30 골든이 NER 결함 3건을 드러낸 방식).
4. **D3·D6·D9**.

### 13.6 사람이 정해야 하는 것 (🔴 **이 표는 정본이 아니다** — 정본은 결정 등록부다.
2026-09-27 에 미등재 5건을 `decision.registry.batch-2026-09-g.ts` 로 등재했고, 아래 표는 그 키를 가리킨다.
표와 등록부가 어긋나면 **등록부가 맞다** — 선택지·현상·확인 경로는 등록부가 코드를 다시 읽고 적은 것이다.)

| 제안 키 | 질문 | 선택지 | 층 |
|---|---|---|---|
| `legal.voiceRecording.basis` (**등재됨**) | 녹음·보관 적법 근거 | NOT_REVIEWED / CLEARED_WITH_CONSENT / SUSPEND_UNTIL_REVIEW | 허가권자 |
| `policy.voice.dictateWriteScope` (**등재됨** 09-27) | 구술이 쓸 수 있는 필드 | S 만 / S·O·P / 전 필드(A 포함·"(제안)" 강제) | 위원회 |
| `policy.voice.readOpen` (**등재됨** 09-27) (H3) | T0 조회를 실제로 열 것인가 | 연다(탭·검색 프리필) / 안내만 고치고 닫아 둔다 | 위원회 |
| `policy.scribe.transcriptRetentionDays` (**등재됨** 09-27) | 전사 보존 기간·기산점 | 90일(현 기본) / 진료기록 보존기간과 동일 / 즉시 파기(반영 후) | 위원회(법무 선행) |
| `policy.voice.guardianSpeech` (**등재됨** 09-27) | 보호자·제3자 발화 취급 | UNKNOWN 분석 제외 기본 / 포함 / 동의 범위에 명시 | 위원회(법무) |
| `policy.voice.aiDraftOn` (**등재됨** 09-27) | 대화 AI 경로(`aiDraft.enabled`) 개방 | 규칙만 / 파일럿 / 전체 | 위원회(`policy.ai.clinicalFeatureScope` 뒤) |

### 13.7 가드 (착수 시 함께 — 전부 결함 재주입으로 검증)

- 구술 outcome 은 `needsConfirm`·`patient` 를 갖는다(오케스트레이터 픽스처) · 서버 `parse()` 는 READ 세션의 dictate 를 hold 로 바꾼다 · 진료 화면의 음성 쓰기 소비처가 **`setSoap(...[field]: text)` 교체를 쓰지 않는다**(소스 가드 · append 정본 하나).
- scribe 모듈에서 `autoRecord(` 호출 전 `redactForAiEgress(` 가 **같은 함수 안에** 있다(호출 단위 · import 만으로 통과하지 않게 — 2026-09-22 `config-env-override-consumers` 가드가 다른 이유로 통과한 전례).
- 동의서 워크스테이션 유형 목록이 shared `ConsentType` 과 **집합 일치**(RECORDING 누락 재발 방지 · 시드 시각화).
- ✅ `scribe.transcript.retention` 소비처 ≥1(`retention-scribe-transcript.spec.ts` ①-b · 게이트 OFF 면 삭제 쿼리 0 · legalHold 제외 · `draftSnapshot` 보존 · 기본값으로 파기 거부 — 재주입 9종) · 패널 소스에 `ambientApi.*.catch(() => {})` 0(미착수).
- `analyze` 응답에 분모 필드가 있고 카드가 그것을 그린다(0 이면 "산출 불가").

### 13.8 확인하지 못한 것 (넓혀 말하지 않는다)

- 운영 DB 의 `voiceEmr.*`·`scribe.*` 현재 값과 `scribe_sessions`·`voice_utterances` 행 수 — 읽지 못했다(운영 읽기 차단). `ambient.enabled=true` 는 2026-09-15 자료의 실측을 인용한 것이다.
- P0-1 을 **브라우저에서 재현하지 않았다**(코드 경로 확정). 재현 절차: 🎤 음성 → 명령·구술 → "오늘 날씨가 좋네요" 발화 → S 필드가 그 문장으로 바뀌는지.
- WeRU.B `/api/stt/chunk` 의 현재 가용성(7월 실측 conf 0.82 이후 미재확인)·`meeting/analyze` diarize 스키마(D-2 미결 그대로).
- 규칙 NER 의 **실제 대화 표본 정확도** — 골든은 합성 발화다. 파일럿 전엔 수치가 없다(지어내지 않는다).

관련: `voice-emr-expansion.plan.md` §13·§14 · `ambient-clinical-scribe.plan.md` §16 · `clinical-draft-authoring.plan.md` L1 · 결정 설명자료 `docs/04-report/release-blocking-decisions-2026-09-15.md` `legal.voiceRecording.basis`·`policy.ai.clinicalFeatureScope`
