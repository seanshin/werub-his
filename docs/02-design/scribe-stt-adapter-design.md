# 스크라이브 STT·화자확정 어댑터 설계 (Track B)

> 작성 2026-07-08 / 근거: [`ambient-clinical-scribe.plan.md`](../01-plan/features/ambient-clinical-scribe.plan.md) §4.4 · 실측(v2.121.0·iMac 토폴로지)
> 목적: **STT 백엔드**와 **화자확정 방식**을 교체 가능한 어댑터로 분리해, iMac diarize 확정(D-2) 전에도 **구현을 시작**하고, 확정 후 무중단으로 A안을 끼운다.

## 0. 설계 원칙
- **어댑터·전략 패턴**: 전사 제공자(Provider)와 화자확정(Resolver)을 인터페이스로 추상화 → 런타임 상태·config로 선택.
- **완전 논블로킹**: 어느 단계 실패도 진료를 막지 않음. 실패 시 다음 티어로 강등, 최후엔 수동.
- **medical-ai.service.ts 미접촉**: 신규 `ScribeModule`이 `MedicalAiService`(aiFetch)·신규 STT 호출을 조합. WeRU.B 호출은 `aiFetch`(런타임키·타임아웃·kill-switch) 경유.
- **화자확정은 HIS 측**: 생체정보(의사 임베딩)를 WeRU.B로 보내지 않음(§P-8).

## 1. 인터페이스

```ts
// 전사 세그먼트(공통 계약)
interface TranscriptSegment {
  speaker: string;        // 원 diarization 라벨(SPEAKER_00…) 또는 'UNKNOWN'
  start: number; end: number;  // 초
  text: string;
  embedding?: number[];   // 화자 임베딩(제공자가 주면) — A안 조건
}
interface TranscriptionResult {
  segments: TranscriptSegment[];
  diarized: boolean;      // 화자분리 수행 여부
  hasEmbeddings: boolean; // 세그먼트 임베딩 유무
  tier: 'IMAC_BATCH' | 'GPU_CHUNK' | 'MANUAL';
  raw?: unknown;
}

// (1) 전사 제공자 — 교체 가능
interface TranscriptionProvider {
  readonly tier: TranscriptionResult['tier'];
  isAvailable(): Promise<boolean>;               // 헬스체크
  transcribe(audio: AudioRef, opts: { language: 'ko'; diarize: boolean }): Promise<TranscriptionResult>;
}

// (2) 화자확정 — 교체 가능(A 임베딩 / C 휴리스틱)
interface SpeakerResolver {
  readonly kind: 'EMBEDDING' | 'HEURISTIC';
  resolve(segs: TranscriptSegment[], ctx: { doctorId: string; micChannels?: MicMap }): Promise<LabeledSegment[]>;
}
type Role = 'DOCTOR' | 'PATIENT' | 'GUARDIAN' | 'OTHER' | 'UNKNOWN';
interface LabeledSegment extends TranscriptSegment { role: Role; confident: boolean; }
```

## 2. 전사 제공자 3-tier (§4.4 폴백)

| tier | 구현 | diarize | 가용성 신호 | 비고 |
|---|---|---|---|---|
| `IMAC_BATCH` | `/api/meeting/analyze`(file_url·options.diarize) → job 폴링 | ✅(iMac 워커) | `/api/imac/status.available` **+ 실제 job 성공** | large-v3·화자분리. **현재 워커 STT 불안정**(연결됐어도 `STT failed` 사례) |
| `GPU_CHUNK` | `/api/stt/chunk`(raw PCM·X-Mode:final) | ❌ | `/api/stt/chunk/status.available` | 상시 가용(GPU medium)·평문 1블록 |
| `MANUAL` | 전사 없음(의사 수기) | ❌ | 항상 | 최후 폴백·무중단 |

> **주의**: `/api/stt`(직접)는 진입 노드 `ane_stt=true`(Apple Silicon)에서만 동작 → example.org(GPU)에선 항상 400. 배치 경로는 `/api/meeting/analyze`(iMac 위임)로만 사용.
> **가용성 판정은 status 플래그만 믿지 말 것**: iMac `available:true`라도 `STT failed(imac-worker)` 발생 실측 → **1회 시도 실패 시 즉시 GPU_CHUNK로 강등**(백오프).

## 3. 화자확정 Resolver

### A. `EmbeddingMatchResolver` (권장·조건부)
- **전제**: `TranscriptionResult.hasEmbeddings === true`(D-2 Q1 확정 시).
- 로직: 각 세그먼트 임베딩 ↔ `ScribeVoiceProfile`(의사) 코사인 유사도. `sim ≥ θ`면 `DOCTOR`. 나머지 화자군에서 발화량 최다 = `PATIENT` 후보.
- θ·재등록: D-8(임계·음성변화). 미등록 의사면 자동 A 불가 → C로.

### C. `HeuristicResolver` (기본·무조건 동작)
- **전제 없음**(임베딩·등록 불필요).
- 신호(가중 합):
  1. **마이크 채널**(가능 시): 의사 근접/헤드셋 채널 = DOCTOR (최강 신호).
  2. 발화 패턴: 질문 주도(의문형 비율)·의학용어 밀도·명령형(처방/오더 어휘) → DOCTOR 경향.
  3. diarize가 있으면 화자군 유지, 없으면(GPU_CHUNK) 단일 블록 → 문장 단위 추정.
- 출력은 항상 `confident` 플래그 → **낮으면 UI에서 의사 수동 라벨**.

### 선택 규칙(런타임)
```
resolver =
  (result.hasEmbeddings && hasVoiceProfile(doctorId)) ? EmbeddingMatchResolver
                                                       : HeuristicResolver
```
→ **A/C 확정 없이도 코드 완성**. Q1이 임베딩 반환으로 확정되면 A가 자동 활성(등록 의사 한정), 아니면 영구 C.

## 4. 오케스트레이션(의사코드)

```ts
async function transcribeAndLabel(session: ScribeSession): Promise<LabeledSegment[]> {
  const audio = session.audioRef;
  const providers = [imacBatch, gpuChunk];       // 우선순위(MANUAL은 암묵 최후)
  let result: TranscriptionResult | null = null;

  for (const p of providers) {
    if (!(await p.isAvailable())) continue;
    try {
      result = await withTimeout(p.transcribe(audio, { language: 'ko', diarize: p.tier==='IMAC_BATCH' }), TIMEOUT[p.tier]);
      if (result?.segments?.length) break;
    } catch (e) {
      audit.safeLog('scribe_transcribe_fail', { tier: p.tier, err: e.code });
      result = null;                              // 다음 티어로 강등(백오프)
    }
  }
  if (!result) return [];                          // → MANUAL(수기), 무중단

  const resolver = (result.hasEmbeddings && await hasVoiceProfile(session.doctorId))
    ? embeddingResolver : heuristicResolver;
  const labeled = await resolver.resolve(result.segments, { doctorId: session.doctorId, micChannels: session.micMap });

  await persist(session, { transcript: labeled, tier: result.tier, resolver: resolver.kind });
  return labeled;                                  // → SOAP 초안 생성 입력(§4.5)
}
```
- `TIMEOUT`: IMAC_BATCH=job 폴링(수 분·비동기), GPU_CHUNK=수십 초. 전 구간 aiFetch·논블로킹.
- 저장: `ScribeSession.transcript`(라벨 포함)·`tier`·`resolverKind`(프로비넌스).

## 5. 상태·프로비넌스
- `ScribeSession.status`: …→`TRANSCRIBING`→`TRANSCRIBED`(tier 기록)→`DRAFTED`.
- 저장 필드(§6 모델): `transcript`(LabeledSegment[])·`sttTier`·`resolverKind`(신규 후보 컬럼) → 품질지표(화자귀속 정확도·자동 라벨률, §11)·감사.

## 6. 테스트 훅(구현 시)
- 제공자별 계약 테스트(가짜 오디오→세그먼트 shape).
- Resolver 단위: 임베딩 매칭(합성 임베딩)·휴리스틱(질문/용어 밀도 픽스처).
- 폴백 시나리오: iMac 실패→GPU 강등→MANUAL, 각 무중단 검증.
- **라이브 계약 검증(대기)**: iMac 워커 정상화 시 `/api/meeting/analyze diarize` 응답으로 `TranscriptSegment` 매핑·`hasEmbeddings` 확정(D-2 Q1) → EmbeddingMatchResolver 활성 조건 확정.

## 7. 열린 값(D 연동)
- `hasEmbeddings` 실제값 = **D-2 Q1**(WeRU.B 회신) → A 활성 여부.
- θ·재등록 = D-8. iMac SLA·GPU diarize 폴백 = D-9(요청서 발신됨).
