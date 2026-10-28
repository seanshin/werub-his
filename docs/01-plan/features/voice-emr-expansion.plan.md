# VoiceEMR 세부 계획서 — 앰비언트 스크라이브 → 음성 구동 EMR

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/src/modules/voice-emr/voice-emr.service.ts:23 · apps/api/src/modules/config/config-runtime.service.ts:121 · 잔여: 게이트 ON(파일럿)(사람); Q13 채택 시 DPA 계약 변경(사람)

- **작성일**: 2026-07-28 (v2 세부 재구성)
- **상태**: 기획 (착수 전 — WeRU.B 실시간 STT 계약·GPU 용량 회신 선결)
- **정본 참조**: `ambient-clinical-scribe.plan.md`(스크라이브) · `scribe-stt-adapter-design.md` · `MEDICAL_AI_INTEGRATION_v2.121.0.md` · **AI 요청서 `werub-voice-emr-integration-request-2026-07-28.md`**
- **상세 설계**: `docs/02-design/voice-emr-pipeline-design.md`(STT 어댑터·intent 파서·확인 게이트) · `voice-emr-personalization-design.md`(음성 트레이닝·맞춤 사전) · `voice-emr-implementation-spec.md`(스키마·골든·FE) · `voice-emr-pilot-protocol.md`(파일럿·평가)
- **명령어 사전**: `docs/05-reference/voice-emr-command-lexicon-2026-07-29.md`(폐집합 사전·현업 확장)
- **프로토타입**: `apps/api/src/modules/voice-emr/`(intent 파서·수사 정규화·미배선·골든 24통과·PR#771)
- **한 줄**: 진료 후 **수동 전사→SOAP 초안**에 머무는 스크라이브를, 진료 중 **핸즈프리 조회·구술·오더**로 확장한다 — 스크라이브가 검증한 동의·저장·DRAFT-only·서명 게이트를 그대로 계승하고, 신규는 **명령 레이어 3요소**(실시간 STT 배선·intent 파서·확인 게이트)만.

---

## 1. 배경 · 목표

진료 현장의 병목은 **진료 중** 손이 키보드에 묶이는 것이다. 스크라이브는 진료 *후* 대화를 일괄 전사(수동·후행)할 뿐, 진료 *중* 조회·오더·입력은 여전히 타이핑이다. VoiceEMR은 스크라이브를 대체하지 않고 **능동 음성 명령/구술 레이어**를 더한다.

- **목표**: "지난 검사결과 보여줘"(조회)·"혈압 130에 80"(입력)·"흉부 X-ray 오더"(명령)를 EMR 동작으로 연결.
- **대전제**: 신규 STT 엔진·신규 안전체계를 만들지 않는다. 기존 자산(§2) 위에 명령 레이어만 얹는다.
- **불변 제약**: 음성은 어떤 경로로도 서명·확정을 자동 수행하지 않는다(§7).

---

## 2. 기존 자산 실측 (토대)

### 2.1 앰비언트 스크라이브 — 완성·⏸BACKLOG
- BE `apps/api/src/modules/scribe/`: `scribe.service.ts`(startSession·uploadAudio·transcribe·finalize·draft)·`scribe-ai.client.ts`(S3→`/api/meeting/analyze` diarize→폴링)·`speaker-resolver.ts`·HMAC 오디오 스트리밍.
- FE `apps/web/src/components/scribe/`: `useScribeRecorder.ts`(MediaRecorder webm/opus)·`RecordingConsentGate`·`TranscriptViewer`·`ScribeDraftPanel`. 배선=`patients/[id]/encounter/new/page.tsx`.
- 파이프라인: 동의→캡처→업로드(HMAC·10MB)→diarize 전사→화자확정(A임베딩/C휴리스틱)→`autoRecord`(NER+SOAP)→Encounter **DRAFT**.
- 상태: PR#299~301 배포. **블로커=배치 STT(large-v3+diarize) GPU OOM**. 게이트 `scribe.enabled`·`scribe.transcription.enabled` OFF.

### 2.2 EMR 진료 입력 기능 (음성 확장 후보)
| 기능 | 대표 API | 위험도 |
|---|---|---|
| 차트/결과 조회(읽기) | 각 조회 EP | 최저 |
| 활력징후 | `vitals.controller.ts` POST | 낮음 |
| 진료·SOAP | `encounter.controller.ts`(create·PUT SOAP·PATCH sign) | 중 |
| 간호기록 | `nursing-note.controller.ts` | 중 |
| 진단 | encounter 상세 포함 | 중 |
| 처방/오더 | `order.service.ts`(`order.created` 이벤트) | 최고 |
| 문진/차트템플릿 | `questionnaire`/`chart-template`(AI 추천) | 낮음 |

### 2.3 WeRU.B 능력 (v2.121.0 실측)
- 실시간 STT `POST /api/stt/chunk`(raw PCM·partial/final·conf 0.82·final 번역 통합)·`/chunk/warm`·`/chunk/status` — **동작하나 HIS 미배선**.
- 배치 STT `/api/stt`(diarize·large-v3) — 스크라이브용·GPU OOM.
- NER+SOAP `/api/medical/auto-record`(대화→NER+SOAP+ICD-10+처방·200).
- 공용 클라이언트 `medical-ai.service.ts aiFetch`(런타임키·kill-switch·면책·비식별).

---

## 3. 개념 · 경계 (스크라이브 대비)

| 축 | 스크라이브 | VoiceEMR |
|---|---|---|
| 시점 | 진료 후 일괄 | 진료 중 실시간 |
| 성격 | 수동 받아쓰기 | 능동 명령/구술(intent) |
| STT | 배치 diarize `/api/stt` | 실시간 청크 `/api/stt/chunk` |
| 산출 | SOAP DRAFT | 조회 결과·필드 초안·오더 초안(DRAFT) |
| 신규 | (없음) | intent 파서 + mode별 확인 게이트 |

---

## 4. 아키텍처 상세

### 4.1 파이프라인
```
[마이크] → useVoiceCommand(신규·useScribeRecorder 패턴)
   │ 실시간 raw PCM 청크
   ▼
[HIS STT 어댑터(신규)] ─ aiFetch ─▶ WeRU.B /api/stt/chunk (partial/final·conf)
   │ final 전사
   ▼
[Intent 파서(신규)] ─▶ {mode: read|dictate|command, slots}
   │        (1차 rule grammar + 2차 WeRU.B NER 슬롯 보강)
   ▼
[Mode 라우터 + 확인 게이트(신규)]
   read    → 즉시 실행(조회 EP·화면 포커스)         [오디오 미저장]
   dictate → auto-record → DRAFT 저장 → 검토
   command → read-back → 명시 확정 → 안전게이트 → DRAFT
```

### 4.2 컴포넌트별 책임
| 컴포넌트 | 위치(신규/재사용) | 책임 |
|---|---|---|
| `useVoiceCommand` 훅 | FE 신규(**Web Audio API**·useScribeRecorder는 참고만) | 캡처·청크 전송·partial 표시·mode 상태 |
| STT 청크 어댑터 | BE 신규 `voice-emr/stt-chunk.client.ts`(scribe-ai.client 패턴) | aiFetch로 `/api/stt/chunk` 프록시·세션 |

> 🔴 **오디오 캡처 정정(§14-G1)**: `useScribeRecorder`는 `MediaRecorder`(webm/opus **인코딩**)라 Q1의 **raw PCM 16-bit LE mono** 요구를 충족하지 못한다. VoiceEMR은 **Web Audio API(AudioWorklet)** 로 PCM을 직접 취득해야 한다 — 캡처 계층은 **재사용이 아니라 신규**다(동의·오버레이 UI만 스크라이브 재사용).
| Intent 파서 | BE 신규 `voice-emr/intent-parser.ts` | rule grammar 매칭 + NER 슬롯 → intent/slots |
| Mode 라우터 | BE 신규 `voice-emr.service.ts` | mode별 최소권한 라우팅 |
| 확인 게이트 | FE 신규 `VoiceConfirmCard.tsx` | read-back·명시 확정 UI |
| 명령 오버레이 | FE 신규 `VoiceCommandOverlay.tsx` | partial 자막·mode·상태·중단 |
| 동의 게이트 | 재사용 `RecordingConsentGate` | RECORDING 동의(구술/명령 mode) |
| AI 호출 | 재사용 `aiFetch` | kill-switch·면책·비식별 |

### 4.3 Intent 파서 설계 (rule-first)
- **1차 rule grammar**(결정적·환각 회피 우선): 정규 명령 사전. 예)
  - 조회: `(지난|최근|이전)? {대상} (보여줘|조회|열어)` → `{intent: READ, target}`
  - 활력: `{지표} {값}( (에|하고|,) {값})?` → `{intent: VITAL, metric, values[]}`
  - 오더: `{검사명|촬영|약명} (오더|처방|낼게|추가)` → `{intent: ORDER, orderText}`
- **2차 NER 보강**: rule 미매칭·slot 부족 시 `auto-record` NER(entities.symptoms/orders/icd_codes)로 슬롯 보강. 최종 판단은 확인 게이트에서 사람이 확정.
- **동음이의·오인식 처리**: 표준코드 매핑은 후보 n-best 제시(단일 자동선택 금지).

---

## 5. HIS API 설계 (신규)

| 메서드·경로 | 역할 | 가드 |
|---|---|---|
| `POST /api/v1/voice/session` | 음성 세션 시작(encounterId·mode) | JWT·`loadOwnedEncounter`·RECORDING 동의(구술/명령) |
| `POST /voice/session/:sid/chunk` | raw PCM 청크 → STT partial/final | 세션 소유·kill-switch |
| `POST /voice/session/:sid/parse` | final 전사 → intent/slots | 세션 소유 |
| `POST /voice/session/:sid/confirm` | 확정된 명령 실행(mode별 라우팅) | mode별 게이트(§7) |
| `DELETE /voice/session/:sid` | 세션 종료·오디오 폐기 | 세션 소유 |

- DTO는 **class-validator 필수**(인라인 @Body 금지 — 프로젝트 규약). `mode: 'read'|'dictate'|'command'` enum 검증.
- 응답 `{ data, meta }` 표준.

---

## 6. 데이터 모델 (신규·최소)

- `VoiceCommandSession`: `id·encounterId·userId·mode·status(ACTIVE|CLOSED)·startedAt·closedAt·consentId(구술/명령)`. **오디오는 비상주**(read mode 미저장·구술/명령은 스크라이브 HMAC 저장 정책 준용, 전사 후 원음 파기).
- `VoiceCommandLog`(감사): `sessionId·transcript·intent·slots(json)·resultRef(생성된 DRAFT/조회)·confirmedByUser(bool)·createdAt`. **명령 실행·오더 초안은 감사 대상**(audit.log).
- Encounter 프로비넌스: 스크라이브가 이미 추가한 provenance 컬럼 재사용(음성 출처 표기).
- **개인화(§15)**: `ScribeVoiceProfile`(**재사용**·voiceprint) + 신규 `VoiceUserProfile`(userId 유니크·개인 설정) + `VoiceCustomPhrase`(userId·type=ALIAS|HABIT|VOCAB|MACRO·pattern·action·enabled).

---

## 7. 안전 게이트 (mode별 — P-* 계승 + 신규)

| 원칙 | 내용 |
|---|---|
| **P-1 DRAFT-only 불변** | 음성은 서명·확정을 자동 수행 안 함. `ENCOUNTER_SIGNED`→CASHIER 자동전이 때문에 특히 엄격. |
| **P-6 오더/약품 자동반영 금지** | 약명·용량·오더는 초안 카드로만. 의사 명시 확정 필수(음성 확정 불가). |
| **P-7 동의 계승** | 구술/명령 mode = RECORDING 동의 통과·철회 재검증. read mode = 오디오 미저장 시 완화(법무 확인). |
| **P-신규 read-back** | 쓰기·명령 mode는 실행 전 인식 결과 재확인. 오인식 차단 핵심. |
| **P-신규 환자 신원 고정(G3)** | 모든 write/order 확인 카드에 **환자 이름·MRN 상단 고정** — 오확자(잘못된 차트) 차단. 음성 입력 최대 위험. |
| **P-신규 PTT 캡처(G2)** | **T1(활력)·T3(오더)=Push-to-Talk**(버튼 눌린 동안만·의사 의도 구간 확정)로 타화자(환자·보호자) 오파싱 차단. T2(구술)만 오픈마이크/VAD. |
| **P-신규 mode 최소권한** | read=조회 EP만·dictate=DRAFT write만·command=안전게이트 경유. mode 간 권한 격리. |
| **기존 게이트 경유** | 오더는 DUR·포뮬러리·안전게이트(`/admin/safety-gates`) 그대로 통과. IDOR=`loadOwnedEncounter`. |
| **kill-switch** | `ai.server.enabled` OFF → 503(스크라이브 공유). |

---

## 8. 위험도 티어 — 상세 시퀀스

### T0 · 핸즈프리 조회 (읽기·최저위험·서명 불요·오디오 미저장)
```
발화 "지난 검사결과 보여줘"
→ STT final → parse{intent:READ, target:lab-results}
→ (확인 불요·읽기) 조회 EP 호출 → 화면 포커스/오버레이 표시
```
오발화 영향 = 잘못된 화면 표시뿐(데이터 변이 0). intent 파서 첫 훈련장.

### T1 · 구조화 수치 입력 (낮음·PTT·read-back·DRAFT)
```
[PTT 버튼 누름] 발화 "혈압 백삼십에 팔십" [뗌]
→ 수사 정규화(백삼십→130·G4) → parse{intent:VITAL, metric:BP, values:[130,80]}
→ 단위·범위 검증 → VoiceConfirmCard [환자 홍길동·MRN 표시] "수축기 130 / 이완기 80 — 맞습니까?"
→ 사용자 확정 → vitals POST(DRAFT)
```
PTT로 타화자 배제(G2)·확인 카드에 환자 신원 고정(G3)·한국어 수사 정규화(G4).

### T2 · SOAP·간호 구술 (중·DRAFT·서명 불변)
```
구술(연속) → /api/stt/chunk partial 자막
→ final 누적 → auto-record(NER+SOAP)
→ Encounter/nursing DRAFT 채움 → 의사 검토·기존 서명 경로
```
스크라이브의 실시간판. 서명은 기존 GatedStepUp 경로 그대로.

### T3 · 음성 오더/처방 (최고·다중 게이트)
```
발화 "흉부 X-ray 오더"
→ parse{intent:ORDER, orderText}
→ 표준코드 후보 n-best 매핑(단일 자동선택 금지)
→ VoiceConfirmCard(코드·부위·환자 재확인)
→ DUR/포뮬러리/안전게이트 통과 → 의사 명시 확정 → order.create(DRAFT)
```
약명·용량은 초안 텍스트로만. 자동 반영 금지(P-6).

---

## 9. AI Server(WeRU.B) 계약 — Q1~Q3 확정(2026-07-28·v2.124.41)

요청서 `werub-voice-emr-integration-request-2026-07-28.md` · 회신 `voice-emr-stt-reply-to-his.md` · HIS 수용 `his-voice-emr-reply-to-werub-2026-07-28.md`. **P0 선결 3건 확정** — 착수 게이트 해소.

### Q1 프로토콜 (확정)
- **청크당 POST 1회**(WebSocket 아님)·**raw PCM 16-bit LE mono·WAV 헤더 없음**·헤더 `X-Sample-Rate/X-Lang/X-Mode(partial|final)/X-Session-Id/X-Targets/X-Hotwords`.
- 🔴 **partial = 누적 재인식(replace)** — 자막 UI는 **append 금지**(중복). 30s 슬라이딩·180s TTL·final 시 버퍼 폐기. HIS는 Bearer(aiFetch)라 octet-stream CSRF 415 무영향.

### Q2 용량·지연 (확정·운영 규칙)
- 청크 지연 **127~140ms**(길이 무관)·동시 2/3/5=268/405/661ms(직렬 큐잉·거부 없음). 실발화 300~700ms.
- 🔴 **청크 하한 1.5s**(과세분 금지·비용=호출 횟수) → `voiceEmr.stt.chunkMs` ≥1500. **동시 상한 4~5 진료실**.
- 🔴 **warm 미유지**(워커 ~40분 재생성·콜드 18s) → **진료 시작 직전 `/chunk/warm` 1회**를 세션 시작 훅에 편입. **`/status`의 `loaded`·`idle_seconds`(신규)로 워밍 확인**.
- 스크라이브 배치와 **락 분리**(상호 블로킹 없음)이나 **VRAM 공유가 실측 확정**(2026-07-28 후속·v2.124.43): 상주 LLM + VoiceEMR 실시간(medium 1.96GB) → 여유 3.18GB → **배치 large-v3(3.84GB) CUDA OOM**(07-08 패턴). edu 배치 경로가 큐 50건 접수로 완화되며 GPU 장기 점유 구간 발생.
- ✅ **서버측 완화 배포(진료 우선)**: 배치 STT 시작 직전·OOM 시 실시간 모델 반납·재시도. 단 **활성 세션 있거나 마지막 발화 후 5분(OOM 재시도 1분) 미경과면 반납 안 함** → **진행 중 진료는 중단 안 됨**, 그 경우 배치 잡 실패·큐 재시도. → HIS는 **외래 피크 시간대를 AI팀에 통지**(edu 대량 업로드 겹침 회피)·**대량 배치=야간** 편성.

### Q3 어휘 바이어싱 (WeRU.B 당일 구현·배포)
- `POST /api/stt/chunk/vocab {session_id, terms[]}`(TTL 1h·세션 자동적용)·1회성 `X-Hotwords`.
- 🔴 **상한 200개/600자** → **진료별 shortlist**(환자 활성처방 + 진료과 상위 + 당일 오더예정) ≤200 구성.
- 🔴 **한글 헤더 불가(latin-1)** → **JSON `/vocab` 등록 경로** 사용.
- 🔴 **환각 부작용**(무음/잡음 시 hotword 유도) → **클라이언트 VAD 게이팅 + `conf<0.5` 보류 가드** 필수.

### Q4~Q8·Q12~Q13 확정 (2026-07-29·WeRU.B 회신)
- ✅ **Q5 명령 intent — 하이브리드 확정**: **HIS rule+NER 1차·WeRU.B EP 폴백**(라이브: 고정 명령=rule 0ms 결정적 우위·자연어 변형만 LLM 우위·qwen 14b 상주 489ms/7b 비상주 4721ms). EP 신설 시 **HIS가 intent 스키마를 요청에 실어 보냄**(서버 하드코딩 금지=화면 변경 시 서버 배포 회피). → HIS 프로토타입(rule-first intent-parser·골든70)과 **정합**. EP는 P2 옵션.
- ✅ **Q13 화자 게이팅 — WeRU.B 정정**: voiceprint **1:1 검증은 가능**(ECAPA 6ms/청크·VRAM 0.12GB·지연 무시·앞선 "어렵다"는 diarization 군집화 기준이었음). **단 진짜 관문=비기술**: ①voiceprint=**생체정보**→법적 근거·**Q7 DPA 변경 필요**(현 계약 "미보관"인데 임베딩 보관은 초과) ②**오거부=전사 유실**(마스크/감기/마이크변경)→**fail-open 권고**(전사는 하되 `speaker_verified:false` 라벨만) ③임계값=실녹음으로만. → 🔴**WeRU.B 1순위 권고=마이크 분리**(서버 변경0·생체정보0·정확도 최고).
- ✅ **Q4 VAD**: 실시간=**서버 VAD 없음**(클라 책임·의도된 설계)·배치만 있음. **무음 hotword 환각 원인이 이것**. 서버 VAD 옵션 추가 가능.
- ✅ **Q6 번역**: `X-Targets`+`/api/translate`·conf<0.5 번역 보류. **결정 없이 바로 사용 가능**.
- ✅ **Q7 DPA**: PHI 비저장 확인서 기존재. ⚠️**Q13 채택 시 계약 변경 필요**(Q7·Q13 함께 판단).
- ✅ **Q8 FHIR**: R4 6종 이미 존재·전사 내보내기=`DocumentReference` 후보(후속).
- ✅ **Q12 수사 정규화**: 서버에 없음 → **서버 치환 vs HIS 후처리 택일**. → HIS는 `korean-number`/shared `clinical-text` **이미 구현**(HIS-side 확정).

### 후속 Q9~Q11 확정 (2026-07-29·WeRU.B v2.124.45·Q9·Q11은 WeRU.B 버그 수정)
- ✅ **Q9 장문 구술 전사 누적 — HIS 스티칭 확정**(서버 무상주=PHI 최소화). **WeRU.B 버그 수정**: 30초 초과분을 조용히 폐기하던 것(수 분 SOAP 구술 시 전사 누락) → 응답에 **`dropped_s`·`session_max_s` 추가**(예: 20s+15s→dropped_s 5.0·`dropped_s>0`=앞부분 유실 신호). 🔴 **HIS 스티칭 규약(WeRU.B 권장)**: ①**25초 내 강제 final**(30초 상한−마진) ②**final 텍스트만 append**(partial=누적 재인식이라 저장 시 중복) ③강제 final 경계=직전 오디오 끝 **1초 겹쳐 전송 + 어절 3~5 n-gram 중복 제거** ④🔴**STT 세션 id는 발화 단위로 신규 발급**(180초 TTL·**30초 상한은 발화 단위**) ⑤`dropped_s>0` 감시(전사 누락 경고·G5).
  - ⚠️ **세션 2계층 구분**: HIS `VoiceCommandSession`(§6·**진료 단위**·encounterId 바인딩) ≠ STT `X-Session-Id`(**발화 단위**·강제 final마다 신규). 어댑터는 진료 세션 안에서 발화 세션을 다수 발급·final을 스티칭.
- ✅ **Q10 `X-Targets` = 번역 대상 CSV**(en·ja·zh·es·fr·de·ko)·**final만 동작**·`domain=medical 고정`·`conf<0.5`면 번역 생략 **`translation_held:"low_confidence"`** 반환(오인식의 번역 증폭 차단). → **Q6 통역이 이 경로**.
- ✅ **Q11 vocab 지속성 — WeRU.B 버그 수정**: 인메모리라 워커 재생성마다 소실(TTL 1h 무의미)이던 것 → **sqlite 영속화+자동 복구 → 재등록 불요**(`/status`의 **`vocab_persistent:true`**로 확인). 저장=어휘·프롬프트만(발화·전사 미저장). 단 **`/warm`은 여전히 필요**(어휘 영속 ≠ 모델 상주는 워커 재생성 시 풀림).
- HIS 제공 예정: 대표 발화 스크립트(비식별·실녹음은 법무 후)·동시 진료실/피크 확정치(운영 확인).

### HIS 결정 6건 (WeRU.B 회신 응답·2026-07-29·`his-voice-emr-decisions-2026-07-29.md`)
WeRU.B가 Q4~Q13 회신으로 HIS 결정 6건 대기. HIS 판단(프로토타입/설계 기반):
1. **Q5 EP**: 하이브리드 채택 — **rule+NER 1차(구현됨·골든70)**·EP는 P2 옵션(intent 스키마 HIS 송신).
2. **Q13 화자**: 🔴**마이크 분리 1순위 채택**(WeRU.B 권고·생체정보0·서버변경0·정확도 최고)·PTT 병행. **voiceprint는 P3 옵션 이연**(생체정보→법무·Q7 DPA 변경·fail-open 전제). §15.1 수정.
3. **Q4 VAD**: **클라 VAD/PTT**(의도된 설계·PTT가 명령 mode 범위 확정)·서버 VAD 옵션 불요.
4. **Q12 정규화**: **HIS-side**(korean-number/shared clinical-text 구현됨)·서버 치환 불요.
5. **Q7 DPA**: **현 계약 유지**(voiceprint 이연→임베딩 미보관)·voiceprint 채택 시 재판단.
6. **Q8 FHIR**: **P3 후속**(dictate 산출물→DocumentReference).

---

## 10. 로드맵 (상세)

| Phase | 산출물 | 게이트 | 선결 | 검증 |
|---|---|---|---|---|
| **P0** | STT chunk 어댑터·`useVoiceCommand` 골격·**T0 조회**·세션 모델 | `voiceEmr.enabled` OFF·pilot | WeRU.B Q1·Q2 | 조회 발화→화면 포커스 e2e·오디오 미저장 확인 |
| **P1** | intent 파서(rule+NER)·**T1 활력/문진**·VoiceConfirmCard·감사로그 | `voiceEmr.write.enabled` OFF | P0·Q3·Q4·Q5 | read-back·단위검증·DRAFT·감사 |
| **P2** | **T2 SOAP·간호 구술**(실시간 auto-record) | `voiceEmr.dictate.enabled` OFF | GPU/STT 안정화·Q6 | 구술→DRAFT·서명 불변 |
| **P3** | **T3 음성 오더**(코드매핑·DUR·확정카드) | `voiceEmr.order.enabled` OFF·BLOCK | 안전게이트 통합·임상 검증 | 오더 초안·DUR 경유·자동확정 0 |

각 Phase 독립 배포·config OFF·`pilotUserIds` 파일럿. 스크라이브와 동일 거버넌스.

---

## 11. 테스트 · 관측 전략

- **Intent 파서 유닛**: 명령 사전별 발화→intent/slots 골든 케이스(조회/활력/오더). 오인식·동음이의 케이스.
- **확인 게이트 계약**: 쓰기·명령 mode는 confirm 없이 실행 불가(테스트로 고정). 음성 자동서명 0 검증.
- **STT 어댑터 계약**: partial/final 스키마 파싱 방어(스크라이브 parseTranscription 패턴).
- **관측**: 인식 confidence 분포·intent 매칭률·오더 mode read-back 취소율(오인식 지표)·mode별 세션 통계 → `/admin/ai-settings` 편입.
- **감사**: 명령 실행·오더 초안 생성 audit.log(법정보존).

---

## 12. config · 게이트 (신설)

- `voiceEmr.enabled`(마스터 OFF)·`voiceEmr.write.enabled`·`voiceEmr.dictate.enabled`·`voiceEmr.order.enabled`(기본 BLOCK)
- `voiceEmr.pilotUserIds`·`voiceEmr.audio.retention`(read=none·구술/명령=transcribed)
- `voiceEmr.stt.chunkMs`(**기본 ≥1500** — 과세분 금지)·`voiceEmr.stt.warmOnSessionStart`(**기본 true** — 진료 시작 훅에서 `/chunk/warm` 1회)·`voiceEmr.stt.vocabShortlistMax`(**기본 200** — 초과 truncated)·`voiceEmr.stt.confHold`(**기본 0.5** — 미만 보류)
- `voiceEmr.stt.forceFinalMs`(**기본 ≤25000** — Q9 30초 폐기 방지 강제 final)·`voiceEmr.stt.boundaryOverlapMs`(**기본 1000** — 경계 겹침 후 어절 n-gram 중복 제거)
- 관제 `/admin/ai-settings` 편입.

> **확정 운영 규칙(Q1~Q3·Q9~Q11 반영)**: 자막 UI partial=**replace**(append 금지)·전체 노트=**final만 append**(HIS 스티칭·25초 내 강제 final·1초 겹침·n-gram dedup·**`dropped_s>0` 전사 누락 경고**)·vocab=**JSON `/vocab`**(한글 헤더 불가·**sqlite 영속이라 재등록 불요**)·**클라 VAD 게이팅 필수**·warm은 세션 시작마다 1회(vocab 영속과 별개)·번역(Q6)=`X-Targets` CSV·final만·conf<0.5 `translation_held`.

---

## 13. 미결 · 사람/외부 게이트

> 🔴 **2026-09-22 재검토**: T2 구술이 이 게이트를 **우회**하고 있다(파서 폴백=DICTATE · 확인 카드 없음 · S 덮어쓰기 · `parse()` 가 mode 를 안 봄). 판정·보완은 `voice-emr-ambient-conversation.plan.md` **§13** 에 모았다(요약·정리 충분성 재검토).

- **WeRU.B**(외부): Q1~Q3 회신(프로토콜·용량·정확도)이 P0 실질 게이트. Q5(intent EP 신설 여부).
- **GPU 인프라**: 실시간 스트리밍 자원(스크라이브와 공유).
- **임상**: 명령어 사전·오더 음성확정 워크플로 승인.
- **법무/보안**: 진료 중 상시 캡처 동의 범위(조회 미저장 vs 저장)·PHI.

---

## 14. 설계 검토 — 결함·보완 방향 (2026-07-29 적대적 리뷰)

초안(§1~§13)을 적대적으로 검토해 발견한 과소·누락·위험을 심각도순 정리한다. **🔴=착수 전 반드시 해소, 🟠=Phase 내 해소, 🟡=관측**.

### 🔴 G1. 오디오 캡처 = MediaRecorder ≠ raw PCM (기술 오류)
- `useScribeRecorder`(webm/opus 인코딩) 재사용 불가. **Web Audio API AudioWorklet**로 PCM 직접 취득 필요(다운샘플 16kHz·16-bit LE mono·리샘플링). 캡처 계층 신규 개발 범위 추가(§4.2 정정).

### 🔴 G2. 오픈마이크 vs PTT — 타화자 오인식 (안전·설계 근간)
- 진료실 실시간 마이크는 **환자·보호자 음성까지 포착**한다. 스크라이브는 대화 전체를 원하지만 VoiceEMR **명령/입력 mode는 의사 의도 발화만** 필요. 실시간 chunk STT는 **화자분리 없음**(diarize=배치 전용) → 환자의 "혈압약 먹어요"가 명령으로 오파싱될 수 있다.
- **방어 우선순위(WeRU.B 회신 반영·2026-07-29)**: ①🔴**마이크 분리 1순위**(지향성/헤드셋 마이크로 의사 음성만 물리적 포착 — WeRU.B 권고·**생체정보0·서버변경0·정확도 최고**) ②**PTT**(T1 활력·T3 오더=버튼 눌린 동안만·의도 구간 확정) ③**voiceprint 게이팅=P3 옵션 이연**(ECAPA 1:1 검증은 기술적으로 가능하나 **생체정보→법무·Q7 DPA 변경·fail-open**(오거부=전사 유실 방지 위해 `speaker_verified:false` 라벨만) 전제). "낼게/추가" 트리거 모호성은 PTT로 해소.

### 🔴 G3. 오확자(誤患者) 안전 — 확인 카드에 환자 신원 (전 write mode)
- 세션은 encounterId 바인딩이나, **잘못된 환자 차트를 연 채** "혈압 130에 80"을 말하면 read-back은 값만 확인하고 **환자를 놓친다**. → **모든 write/order 확인 카드에 환자 이름·MRN 상단 고정 표시**(§7에 보편 원칙으로 승격·§8 T1에도 적용). 오확자는 음성 입력의 최대 위험.

### 🟠 G4. 한국어 수사 정규화 (T1 구현 공백)
- "혈압 백삼십에 팔십" → STT가 `130`으로 반환하는가 `백삼십`으로 반환하는가 **미확정**. 후자면 HIS에 **한국어 수사→숫자 정규화기**가 필요(백/천/점/소수·단위 "밀리그램/도/퍼센트" 파싱). → WeRU.B에 **Q12(수사 정규화 정책)** 추가 필요. 그때까지 HIS-side 정규화기 전제.

### 🟠 G5. dropped_s > 0 = 서명 차단 (전사 누락 안전)
- §9 Q9의 `dropped_s>0`을 **경고 노출**로만 뒀으나, T2 임상 기록의 **전사 누락은 문서 불완전=안전 이슈**. → `dropped_s>0`이면 경고 + **해당 노트 '불완전' 표기·전사 누락분 재구술 유도**. forceFinalMs로 예방하되, 발생 시 **누락분 재녹음 전까지 서명 게이트에 경고 배지**.

### 🟠 G6. 청크 전송 복원력 (네트워크 결함)
- 청크 POST가 진료 중 실패하면 **전사 갭**이 생긴다(특히 태블릿/무선). → 청크 시퀀스 번호·실패 시 재전송 큐·연속 실패 시 **자막에 '연결 불안정' 표시 + 로컬 버퍼링**. raw PCM 16kHz=~32KB/s·10분 진료 ~19MB → 대역폭·배터리 관측 항목 추가.

### 🟠 G7. 파일럿 성공·롤백 기준 부재
- §11 관측 지표는 있으나 **임계·중단 트리거가 없다**. → 명시: **T3 오더 mode read-back 취소율 > N% → 자동 비활성**, **명령 오파싱률·오확자 근접사고 0 목표**, Phase 승격 조건(정확도 임계)을 사전 정의. 파일럿은 측정 아니라 **판정**이어야.

### 🟠 G8. 음성 불가 시 폴백·콜드스타트 UX
- kill-switch OFF·GPU 콜드(18s)·연속 저신뢰 시 **UX 미정의**. → **항상 키보드 폴백 병존**(음성은 보조·필수 아님)·warm 미적중 시 첫 청크 18s 로딩 인디케이터·conf<0.5 반복 시 "키보드로 입력하세요" 안내.

### 🟡 G9. read mode도 오디오는 WeRU.B로 전송됨 (동의 정밀화)
- "미저장 시 완화"는 **HIS 미저장**일 뿐, 오디오는 여전히 WeRU.B가 처리(Q11=발화/전사 미저장 확인). 조회 발화도 환자 식별자 포함 가능 → **동의 범위는 read mode도 포함**해야 정확(Q7 DPA에 read mode 명시).

### 🟡 G10. round-trip·intent EP 효율
- §5의 `/chunk`(STT)와 `/parse`(intent) 분리는 왕복 추가. final 반환 시 **서버가 inline parse**해 1왕복 절감 가능. read mode는 저지연이 중요하므로 병합 검토.

### 🟢 시퀀싱 명확화 — T0/T1은 지금 가능, T2/T3은 GPU 게이트
- 실시간 chunk STT(medium)는 **동작 확인**(스크라이브 배치 OOM과 별개) → **T0(조회)·T1(활력)=근시일 착수 가능**. **T2(구술)·T3(오더)=GPU 안정화 + Q4~Q8 회신 선결**. 로드맵의 P0/P1을 **near-term 실deliverable**로 명확히.

### 검토 결론
초안의 **안전 골격·티어링·재사용 전략은 견고**하나, **실시간 오디오의 물리(PCM 캡처·타화자·네트워크)와 임상 안전(오확자·전사 누락)** 이 과소 설계였다. G1~G3(🔴)은 착수 전 반드시 반영, G4~G8(🟠)은 각 Phase 설계에 편입. **PTT 기본화(G2)와 확인 카드 환자 신원(G3)이 가장 임팩트 큰 보완**이다.

### 프로토타입 검증 (2026-07-29·PR#771~772)
intent 파서·수사 정규화·스티처를 **순수 로직 프로토타입**으로 구현(미배선·골든 37통과). 구현이 **문서 검토가 못 잡은 실버그 4건**을 노출 — 프로토타입의 가치 입증:
- 🐛 자릿값 없는 단일 한자어 오변환(`주사`의 `사`=4) → 십/백/천/만 포함 런만 변환.
- 🐛 `보여줘`의 `줘`가 오더 트리거와 겹침 → READ를 ORDER보다 먼저.
- 🐛 스티처 **1어절 겹침** 미제거(중복) → 길이≥3 가드로 dedup.
- 🐛 복합 처방 2건이 1건만·`소변검사`가 `검사` 부분매칭 탈락 → 건별 분절·정확 토큰 제외.
- **교훈**: 파서·정규화는 **한국어 형태 함정**(부분매칭·기능어·경계)이 많아 골든 테스트 없이는 조용히 틀린다.

---

## 15. 개인화 — 의료진 음성 트레이닝 + 맞춤 관리 (2026-07-29 추가)

두 축을 추가한다: **(15.1) 의료진 음성 특정화**(내 목소리만 명령으로) 와 **(15.2) 개인 맞춤 관리**(내 문구·습관·형태 지정). 둘 다 **기존 자산 재사용**이 핵심이며, G2(타화자)·G4(습관)·Q3(개인 어휘)를 직접 개선한다.

### 15.1 의료진 음성 특정화 트레이닝 (voiceprint)

**재사용 자산(이미 구현됨)**: `ScribeVoiceProfile`(doctorId 유니크·`embedding` Json·`sampleCount`·`consentAt` 생체동의·`status`·`revokedAt`·**원음 미저장 P-8**) + `/api/v1/scribe/voice-profile`(enroll/get/revoke·DOCTOR) + `speaker-resolver.resolveByEmbedding(segs, doctorEmbedding, threshold=0.7)`(코사인).

- **트레이닝(등록) UX 강화**: 현행 enroll을 **가이드형 다표본 트레이닝**으로 확장 — 정해진 문구 N개(예: 대표 발화 스크립트 일부) 낭독 → 표본별 임베딩 → 평균/품질검사(`sampleCount`↑·저품질 표본 재요청). 프로파일은 **VoiceEMR·스크라이브 공용**(1인 1프로파일).
- **런타임 화자 게이팅(신규 — G2 근본 대응)**: 실시간 `/chunk`은 **화자분리 없음**(§14 G2)이 문제였다. 등록 임베딩으로 **의사 목소리만 명령/전사에 반영**:
  - **경로 A(권장·서버)**: `/chunk`에 등록 임베딩 전달 → 서버가 **화자 일치 시에만 전사**(또는 speaker-match 신뢰도 반환). → **WeRU.B Q13** 신설(§9).
  - **경로 B(폴백·클라)**: 온디바이스 임베딩 대조(WeRU.B `/api/embed/coreml` 활용 여지) → 불일치 청크 미전송.
- **효과**: 게이팅이 서면 **T2 구술도 오픈마이크로 의사 음성만** 담아 PTT 의존을 낮춘다(PTT는 소음 환경·명령 mode 보수 옵션으로 유지). **G2가 PTT(운영 완화) + voiceprint(근본 해소) 이중 방어**로 강화된다.
- **안전·거버넌스**: 생체정보(임베딩) = `consentAt` 필수·**원음 미저장**·`revoke`로 즉시 파기. 스크라이브 DPA·감사 규약 계승. config `voiceEmr.speakerGate.enabled`(기본 OFF — 미등록 시 PTT로 폴백).

### 15.2 개인 맞춤 관리 — 문구·습관·형태

의사별 **개인 명령 사전·습관 보정·개인 어휘**를 관리하는 self-service 레이어. intent 파서(§4.3)·vocab 바이어싱(Q3)·후처리에 주입된다.

**신규 데이터 모델**:
- `VoiceUserProfile`(userId 유니크·설정: 기본 mode·PTT 여부·speakerGate 사용·언어).
- `VoiceCustomPhrase`(userId·type·pattern·action·enabled·createdAt) — type별:
  | type | 예시(문구) | 동작 |
  |---|---|---|
  | **ALIAS**(맞춤 명령) | "내 고혈압 초진 세트" | 특정 order-set 초안 삽입 |
  | **HABIT**(습관 보정) | "타이레놀"→아세트아미노펜·개인 약어 "당"→FBS | 후처리 텍스트 정규화(final→parse 전) |
  | **VOCAB**(개인 어휘) | 자주 쓰는 약명·검사명 | Q3 shortlist에 우선 병합(≤200 내) |
  | **MACRO/FORM**(형태) | "기본 초진 노트" | 노트 템플릿 골격 삽입(DRAFT) |

**통합 지점**:
- **intent 파서**: **개인 ALIAS를 rule grammar보다 먼저** 매칭(결정적·개인 우선). 미매칭 시 일반 grammar→NER.
- **후처리(HABIT)**: STT `final` → **개인 습관 보정 맵 적용** → 정규화된 텍스트로 parse(G4 수사 정규화와 동일 단계).
- **vocab(VOCAB)**: 진료별 shortlist 구성 시 **개인 어휘를 우선순위 상위**로 병합(환자 활성처방·진료과 상위와 함께 ≤200).

**관리 UI**: self-service `/settings/voice`(본인 CRUD — 문구·습관·어휘·매크로 등록/토글) + 관리 오버사이트 `/admin/ai-settings`(사용 통계·비활성). 신규 화면은 UX 규약(EmptyState 등) 적용.

**🔴 안전 불변(중요)**: 개인 ALIAS/MACRO가 **오더를 생성해도 동일 게이트 통과** — read-back·환자 신원(G3)·DUR/포뮬러리·명시 확정(P-6)을 **우회하지 못한다**. "내 세트"는 초안 삽입까지만, 확정은 항상 사람. 개인 매크로 유발 오더도 **감사 대상**(누가·무슨 매크로로).

### 15.3 로드맵 편입
- **P1**: voiceprint **트레이닝 UX**(enroll 강화) + `VoiceUserProfile`/`VoiceCustomPhrase` 모델 + `/settings/voice` 관리 UI + **HABIT/VOCAB 통합**(저위험·후처리·바이어싱). 화자 게이팅은 Q13 회신 후.
- **P2~P3**: 런타임 **화자 게이팅**(Q13 경로 확정 후·오픈마이크 구술) + **ALIAS/MACRO**(오더 연계는 T3 게이트 위에서).

---

## 부록 A. 재사용 자산 매핑 (신규 개발 최소화)
| 필요 | 기존 자산 | 신규? |
|---|---|---|
| 오디오 캡처 | `useScribeRecorder` | 재사용 |
| 동의 게이트 | `RecordingConsentGate`·`requireRecordingConsent` | 재사용 |
| AI 호출·kill-switch·면책 | `aiFetch` | 재사용 |
| NER+SOAP | `/api/medical/auto-record` | 재사용 |
| IDOR·서명 게이트 | `loadOwnedEncounter`·`GatedStepUpGuard` | 재사용(불변) |
| 실시간 STT | WeRU.B `/api/stt/chunk` | **배선 신규** |
| intent 파서·mode 확인 게이트 | — | **신규** |
| 음성 명령 UI | useScribeRecorder 패턴 | 신규(패턴 재사용) |

## 부록 B. WeRU.B 요청 요약 → §9·요청서 정본
Q1 프로토콜 · Q2 용량 · Q3 정확도/바이어싱(P0) / Q4 VAD · Q5 intent EP · Q6 번역(P1) / Q7 DPA · Q8 FHIR(병렬).
