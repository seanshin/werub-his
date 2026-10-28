# VoiceEMR 코어 파이프라인 상세 설계 — STT 어댑터 · Intent 파서 · 확인 게이트

- **작성일**: 2026-07-29
- **상위**: `voice-emr-expansion.plan.md`(§4·§8·§9) · `voice-emr-personalization-design.md`(개인화)
- **범위**: 신규 3요소의 구현 수준 상세 — (1) STT 청크 어댑터(캡처·발화 세션·스티칭·복원력·게이팅), (2) Intent 파서(한국어 정규화·문법·n-best·정정), (3) 확인 게이트(mode별 카드).
- **계약 전제**: Q1(청크 POST·PCM·partial=replace)·Q2(≥1.5s·warm 미유지)·Q9(발화 단위 세션·25s 강제 final·dropped_s)·Q11(vocab_persistent).

---

# 1. STT 청크 어댑터

## 1.1 오디오 캡처 (Web Audio·§14 G1)
```
getUserMedia(audio) → AudioContext(sampleRate 48k)
  → AudioWorkletNode('pcm-downsampler')     // Float32 → 16kHz 다운샘플
  → Int16 LE mono 링버퍼
  → chunkMs(≥1500)마다 flush → POST 청크
```
- MediaRecorder(webm/opus) **사용 안 함**. 리샘플링(48k→16k)·Int16 변환은 워클릿에서.
- 청크 크기 ≈ 16000 × 2byte × 1.5s ≈ **48KB/청크**.

## 1.2 캡처 모드 (G2)
| mode | 캡처 방식 |
|---|---|
| **T1 활력·T3 오더** | **PTT** — 버튼 down~up 구간만. up 시 즉시 final·세션 종료 |
| **T2 구술** | **오픈마이크** — VAD onset~offset(또는 화자 게이팅 A.4). 무음 endpointing으로 발화 분절 |
| **T0 조회** | PTT 또는 짧은 오픈마이크(1발화) |

## 1.3 발화 세션 수명주기 (Q9 ④ — 2계층)
```
[진료 세션 VoiceCommandSession] (encounterId 바인딩·§6)
  └─ [발화 세션 utteranceSid] (client UUID·강제 final마다 신규)
        chunk(partial)…  →  강제/자연 final  →  close
```
상태:
```
IDLE ─(PTT down / VAD onset)→ CAPTURING
CAPTURING ─(chunkMs)→ send(partial, X-Session-Id=sid) → CAPTURING
CAPTURING ─(경과 25s)→ send(final, 1s overlap) → 스티칭 → 신규 sid → CAPTURING   // 강제 final(연속 구술)
CAPTURING ─(PTT up / VAD offset / silence)→ send(final) → 스티칭 → close → IDLE
```
- **강제 final 타이머**: `forceFinalMs`(25000·30s 상한−마진). 초과 전 반드시 final flush → 새 sid로 이어감(폐기 방지·G5).
- 각 발화 세션은 180s TTL·30s 상한(발화 단위).

## 1.4 스티칭 알고리즘 (final만 append·중복 제거)
```
// HIS-side 진료 세션 상태
noteText = ""          // 누적 전문
onFinal(f):            // f: {text, dropped_s, session_max_s, confidence}
  if f.confidence < confHold(0.5): promptRepeat(); return          // 저신뢰 보류
  if f.dropped_s > 0: insertGapMarker(f.dropped_s); flagIncomplete()  // G5
  t = f.text
  if noteText != "":
     t = stripOverlap(noteText, t)      // 1초 겹침분 제거
  noteText = noteText=="" ? t : noteText + " " + t

// 경계 중복 제거: noteText의 말미 어절 n-gram(3~5)이 t의 머리와 일치하면 t에서 제거
stripOverlap(prev, cur):
  prevW = words(prev); curW = words(cur)
  for n in [5,4,3]:
     if prevW.slice(-n) == curW.slice(0,n): return words.join(curW.slice(n))
  return cur
```
- **partial**은 절대 append 안 함 — **라이브 자막 replace 전용**(누적 재인식이라 중복).
- `flagIncomplete()`: 노트에 "⚠ 전사 일부 누락" 배지 → **재구술 전까지 서명 게이트 경고**(G5).

## 1.5 복원력 (G6)
- 청크에 `seq` 부여. POST 실패 → 지수 백오프 재시도(≤3). 연속 실패 >N → **자막 "연결 불안정" + 로컬 버퍼링**.
- 재연결 시: 버퍼가 30s 상한 근접이면 **강제 final flush 후 새 sid**(stale 창 방지). 갭 발생분은 `insertGapMarker`.
- 관측: 청크 실패율·재전송율·평균 청크 지연 → `/admin/ai-settings`.

## 1.6 warm·게이팅
- **세션 시작 훅**: `POST /chunk/warm` 1회 → `GET /status` 폴링(`loaded==true`·`idle_seconds` 소). cold면 18s 로딩 인디케이터(G8).
- **화자 게이팅(A.4·Q13)**: `speakerGate.enabled`+프로파일 ACTIVE면 임베딩 참조 전달 → 서버 `speaker_conf` 낮은 청크 드롭(환자 음성). 미가용 → PTT 폴백.

---

# 2. Intent 파서

## 2.1 파이프라인 (final text 1건)
```
final.text
 → (2.2) HABIT 정규화(개인) + 한국어 수사/단위 정규화
 → (2.3) ALIAS 매칭(개인·우선)         hit → {intent, action}      : ↓
 → (2.4) 문법 매칭(intent별 rule)       match → {intent, slots}     : ↓
 → (2.5) NER 보강(auto-record entities) 미충족 슬롯 채움
 → (2.6) 정정·복합·신뢰도 처리
 → {mode, intent, slots, nbest, confidence}
```

## 2.2 한국어 수사·단위 정규화 (G4·Q12 대비)
- **한자어 수사**: 영~구·십·백·천·만 자릿값 접기. `"백삼십"→130` · `"삼십육점오"→36.5`(점=소수).
- **고유어 수사**(횟수·개수): 하나~열·한/두/세 → `"한 알"→1정` · `"두 번"→2회(bid)`.
- **단위 사전**: 밀리그램→mg·마이크로그램→mcg·도→℃·퍼센트→%·정/알→tab·회/번→times·시시→cc.
- **구현**: 토크나이즈 → 수사 토큰 run 감지 → 자릿값 폴딩 → 인접 단위 결합. WeRU.B가 이미 숫자로 반환(Q12)하면 이 단계 축소.

## 2.3 ALIAS 매칭 (개인 사전)
- 정규화 텍스트를 사용자 `VoiceCustomPhrase(type=ALIAS)` `pattern`과 대조(정확→퍼지 임계). hit=`action`으로 분기(오더셋/템플릿/조회). `hitCount++`.
- **안전어 shadowing 금지**(§B.6): 예약 명령(취소/중단/서명/확정) 가리는 ALIAS 등록 거부.

## 2.4 문법 (intent별 rule·슬롯)
```
READ:    (지난|최근|이전)? <TARGET:검사결과|약|처방|활력|영상|진단|바이탈> (보여줘|조회|열어|알려줘)
         → {intent:READ, target}
VITAL:   <METRIC:혈압|체온|맥박|호흡|산소포화도|체중|신장|혈당> <NUM> ((에|하고|,|슬래시) <NUM>)?
         → {intent:VITAL, metric, values[]}   // 혈압=2값(SBP/DBP)·그외 1값
ORDER_LAB:   (<LABTERM>+ (하고|,)?)+ (검사|나가|추가|오더|처방)
             → {intent:ORDER, sub:LAB, labs[]}
ORDER_IMG:   <BODYPART>? <MODALITY:엑스레이|시티|초음파|엠알아이|피에이|씨티> (오더|처방|촬영|낼게|추가)
             → {intent:ORDER, sub:IMAGING, modality, bodyPart}
ORDER_RX:    <DRUG> <NUM><UNIT>? (<FREQ:하루 N번|아침|점심|저녁|취침 전|식후|식전|prn>)? (처방|줘|낼게|추가)?
             → {intent:ORDER, sub:RX, drug, dose, unit, freq}
```
- `<TARGET/METRIC/MODALITY/FREQ>`=폐집합 사전. `<LABTERM/DRUG/BODYPART>`=마스터+개인 VOCAB 대조(2.7).
- 미매칭 → intent=DICTATE(자유 구술)로 폴백(T2).

## 2.5 NER 보강
- 문법 슬롯 미충족·intent 모호 시 `auto-record`의 `entities`(symptoms·orders·icd_codes)로 슬롯 채움. 최종은 **확인 게이트에서 사람 확정**(자동 실행 없음).

## 2.6 정정·복합·신뢰도
- **자기 정정**: `아니|말고|정정|다시` 마커 → 후행 값 채택(`"130 말고 140"→140`).
- **필러 제거**: `어|음|그|저기` 스킵.
- **복합 명령**: `하고|그리고|및`로 분절 → 다중 intent(각각 확인). 단 **오더 복합은 건별 개별 확인**(일괄 확정 금지).
- **신뢰도**: STT `conf<0.5`→보류·재발화 요청. 파서 매칭 불확실→자유 텍스트로 수동 입력 전환(G8).

## 2.7 코드 매핑 n-best (오더·약품)
```
term(정규화) → 마스터+개인VOCAB 퍼지매칭(음소/자모 유사·동의어) → top-K 후보(score)
if score[0] - score[1] > Δ && score[0] > τ:  pre-select(top1) but 확인 필수
else:  후보 리스트 제시(단일 자동선택 금지·§4.3)
```
- 마스터: 약품(24,022)·검사코드·상병(KCD)·영상 프로토콜. 동음이의(엑스레이/X-ray·시티/CT)는 표기 정규화 후 매칭.

---

# 3. 확인 게이트 (mode별 read-back 카드)

## 3.1 공통 불변
- **환자 신원 고정(G3)**: 모든 write/order 카드 **상단에 이름·MRN·성별/나이** 고정(오확자 차단).
- **명시 확정만 실행**(P-1/P-6)·취소·수정(재발화/키보드) 병존.

## 3.2 T0 READ — 확인 불요
`{intent:READ,target}` → 조회 EP → 결과 오버레이 포커스. 오디오 미저장. (오발화=화면 표시뿐)

## 3.3 T1 VITAL
```
┌ [홍길동 · MRN 00012345 · M/64]  혈압 입력 확인 ┐
│  수축기 130 · 이완기 80 mmHg                    │
│  (정상범위 내)                                  │
│  [확정→DRAFT]  [수정]  [취소]                    │
└─────────────────────────────────────────────┘
```
- 범위 이탈 시 값 강조(위급치=적색). 확정→`vitals POST`(DRAFT).

## 3.4 T2 DICTATE
- 라이브 자막(partial replace) → 발화 종료·스티칭 완료 시 **누적 노트 diff 미리보기** → SOAP/간호 DRAFT에 적용. `dropped_s>0`면 누락 배지+재구술 유도. 서명=기존 GatedStepUp.

## 3.5 T3 ORDER (다중 게이트)
```
┌ [홍길동 · MRN 00012345 · M/64]  처방 확인 ⚠고위험 ┐
│  약품:  ◉ 메트포르민정 500mg   (마스터 A00123)   │
│         ○ 메트포르민서방정 500mg (A00456)        │  ← n-best 선택
│  용량:  500mg   1일 2회(bid)  식후                │
│  DUR:   ✓ 병용금기 없음   ✓ 포뮬러리 등재          │
│  ─────────────────────────────────────────────  │
│  [처방 확정→DRAFT]   [수정]   [취소]              │
└──────────────────────────────────────────────────┘
```
- n-best **라디오 선택**(단일 자동선택 금지)·DUR/포뮬러리 배지 실시간·고위험군(고알러트 약물)은 **2단 확인**. 확정→`order.create`(DRAFT). 약명/용량 오인식은 확정 전 텍스트 수정 가능.

---

# 4. 테스트 매트릭스 (§11 확장)
| 대상 | 케이스 |
|---|---|
| 수사 정규화 | 백삼십/삼십육점오/한 알/두 번·경계(천이백) |
| 스티칭 | 25s 강제 final 경계 중복 제거·dropped_s>0 갭·partial 미append |
| 문법 | intent별 골든 + 오인식·동음이의·복합·자기정정 |
| n-best | 약품 동의어·서방정 구분·미등재 폴백 |
| 확인 게이트 | confirm 없이 실행 불가·환자 신원 표시·고위험 2단·자동서명 0 |
| 화자 게이팅 | 타화자 배제·의사 발화 오탈락률·폴백 PTT |
| 복원력 | 청크 실패 재시도·연속 실패 버퍼·재연결 flush |

## 관측 지표·롤백(§14 G7)
- 오더 read-back **취소율 > N% → order mode 자동 비활성**. 명령 오파싱률·오확자 근접사고 **0 목표**. Phase 승격=정확도 임계 충족 시.
