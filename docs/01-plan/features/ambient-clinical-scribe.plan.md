# 앰비언트 진료 스크라이브 — 기획서 (Ambient Clinical Documentation)

> 작성: 2026-07-07 / **상태: 구현 완료·⏸ BACKLOG(WeRU.B STT GPU 자원 확보 후 전사 활성화 — §16 재개 조건)** · PR#299/#300/#301 머지·배포 / v1.7 (**v3.45.0 코드 재조정**: 다른 세션 PR#294~298이 aiFetch 일원화·AI 거버넌스(PHI 비식별·disclaimer·감사·kill-switch·타임아웃)를 구현 → 스크라이브가 이를 **재사용**으로 격하·라인참조 전량 갱신(autoSoap 850·chatLlm 399·getLlmHeaders 삭제→aiFetch 90·autoRecord 1592·meetingAnalyze 1836·chartQa 1072) / v1.6: STT 3단 폴백 설계: iMac 배치(diarize)→GPU chunk(무diarize+휴리스틱 화자)→수동 / iMac 다운 시 GPU diarization 폴백은 WeRU.B 서버측 요청(D-9) / v1.5: sk-키 라이브 실호출 검증: 인증·한국어 STT 실동작 확인 / STT·화자분리 배치는 **iMac(Metal) 워커 의존**·당시 오프라인→diarize 임베딩 형태 미확정·재검증 필요 / STT 토폴로지(iMac 배치 vs GPU chunk)·워커 가용성 리스크 반영 / v1.4: AI 서버 v2.121.0 라이브 카탈로그 반영: auto-record=NER+SOAP·FHIR DocumentReference·Medical Law 자동검사 재사용 추가 / 특정화자 인식 A·C로 좁힘(B=WeRU.B 전용 EP 없음) / v1.3: `/api/stt` diarize·ko·large-v3 실측·특정화자 3안 / v1.2: 참조정합·IDOR·오디오 청크·at-rest·STT약명안전·원음=의무기록아님·동석자동의 / v1.1: 별도 동의서·화자분리 필수화·특정화자 인식)
> 한 줄: 진료 장면의 **의사·환자 대화를 녹음**하고, **음성전사(STT)·화자분리**로 텍스트화한 뒤, 이를 근거로 **SOAP 진료노트 초안**을 생성해 의사에게 제시하고, **의사가 검토·수정·서명**하는 _Human-in-the-Loop_ 문서화 보조를 도입한다. AI는 진료기록을 **대체하지 않는다**. 법적 작성·서명 책임은 100% 의사(의료법 §22)이며, 녹음은 **전용 별도 동의서 없이는 시작조차 하지 않는다**. 화자분리는 **필수**이며, 의료진은 **본인 동의 하 음성 프로파일을 등록**해 자기 발화를 특정화자로 앵커링함으로써 분리 정확도를 높인다(환자는 등록하지 않는다).

---

## 0. 핵심 원칙 (이 문서 전체를 지배)

간호기록 AI 보조([`ai-assisted-nursing-records.plan.md`](./ai-assisted-nursing-records.plan.md))의 6원칙을 **그대로 계승**하고, 녹음이라는 새 위험표면에 대해 2원칙(P-7·P-8)을 추가한다.

| # | 원칙 | 의미 | 코드/강제점 |
|---|------|------|------------|
| P-1 | **보조 우선(Assistive-First)** | AI는 초안·요약·제안만. **확정/서명은 항상 의사.** 자동 서명 금지. | AI 경로는 Encounter `status='DRAFT'`로만 생성, `sign` 미호출 |
| P-2 | **법적 무결성 불변** | 진료기록=법정 의무기록(의료법 §22). `status(DRAFT/SIGNED/AMENDED)·signedBy·signedAt`·정정(AMENDED 재서명) 규약 **그대로**. | `encounter.service.ts:236 sign`·`:192 update`(SIGNED→AMENDED) |
| P-3 | **근거 기반(Grounded)·환각 차단** | SOAP 초안은 **전사된 대화 + 주입된 실데이터만** 근거. 대화에 없는 임상사실 생성 금지. 각 문장에 **전사 근거(발화 타임스탬프)** 표기. | §4.5 그라운딩 규약·출력계약 |
| P-4 | **출처·프로비넌스(Provenance)** | AI가 손댄 기록은 **AI 보조 표시**(모델·프롬프트버전·전사 스냅샷·수정량) 보관 → 감사·투명성. | §6 프로비넌스 컬럼 |
| P-5 | **점진·옵트인** | 신규 동작은 **config 게이트(기본 OFF)**. 진료과/의사 파일럿 → 확대. | `scribe.enabled` 기본 OFF |
| P-6 | **안전 게이트** | 위급값·고위험 판단은 AI가 **단정 금지·플래그만**. 임상 결정 자동적용 0. 기존 처방/오더 경로 무간섭. | §4.6 안전 상호작용 |
| **P-7** | **동의 우선(Consent-First)** ★신규 | **유효한 전용 별도 동의서 없이는 녹음 시작 불가.** 두 동의를 각각 별도로 취득: ①**환자 녹음 동의서**(RECORDING) ②**의료진 음성 프로파일 등록 동의**(생체정보·의사 opt-in). 철회 시 즉시 중단·삭제 경로 제공. | §4.1 동의 게이트·녹음/등록 API가 동의 검증 선행 |
| **P-8** | **PHI·생체정보 봉쇄(Containment)** ★신규 | 오디오·전사는 **최고위험 PHI**, 의료진 음성 임베딩은 **생체정보**. 무인증 정적 경로 밖 `storage/`에 저장, HMAC 단기토큰 스트리밍, 내부 GPU 경유, 짧은 보존·전사 후 원음 파기 옵션. 음성 임베딩은 원음 아닌 **특징벡터만** 저장. | §6·§9 저장·전송·보존 규약 |

> **불변식(invariant)**: _SIGNED 진료기록의 의학적 진실성·법적 책임은 서명 의사에게 있으며, AI·녹음은 그 책임을 대신하거나 줄이지 않는다. 녹음은 환자의 유효한 동의 위에서만 존재한다._ 본 기획의 모든 기능은 이 불변식을 깨지 않는 선에서만 동작한다.

---

## 1. 배경·문제

- 의사 진료시간의 상당 부분이 **화면·키보드 기록**에 소모(문서화 부담) → 환자 눈맞춤·대면 소통 저하, 진료 후 기록 밀림.
- HIS는 이미 **SOAP 저장·서명·정정** 체계와 **AI SOAP 초안** 골격을 갖췄으나, 입력이 **의사가 타이핑한 텍스트**에 머문다:
  - `autoSoap()` — S/O 입력 → A/P 초안 JSON(`medical-ai.service.ts:850`·v3.45.0)
  - `autoRecord()` — **대화 텍스트** → SOAP+ICD-10+처방추천(`:1592`), FE `AutoRecordTab`가 이미 배선(`AiAssistantPanel.tsx:1217`)
  - 즉 "대화 → SOAP"의 **뒷단은 존재**하나, **앞단(대화 오디오 캡처·전사·화자분리)이 비어 있음**. 의사가 대화를 손으로 옮겨 적어야 함(이중 입력).
- 근접 자산: WeRU.B AI 서버가 화상회의 녹화용 **`/api/meeting/analyze`(STT+요약+액션아이템, 비동기 job+callback)**를 이미 제공(`medical-ai.service.ts:1836`, Whisper/ffmpeg는 서버측 `meetingStatus:1855`). STT를 자체 구현하지 않고 이 경로를 **진료 오디오용으로 확장**할 수 있다.

**결정(요구사항)**: 진료기록 **대체가 아니라 보조**. 녹음→전사→SOAP 초안→**의사 검토·수정·서명**. 무결성/서명 규약 불변, 녹음은 동의 게이트, 신규 동작은 config 게이트.

---

## 2. 목표·비목표

**목표(측정 가능)**
- 진료당 **문서화 시간 ↓**(파일럿 A/B, §11), 초안 **채택률 ↑** / **수정량(edit distance)** 적정.
- **대화 근거 SOAP 초안 자동 생성**: 전사 텍스트 → S/O/A/P 초안(발화 인용·출처 부착).
- **화자분리 필수**(의사/환자)로 S(주관=환자 발화)·O/A/P(의사 발화·판단) 정확 매핑. 옵션 아님.
- **의료진 특정화자 인식**: 의사가 **본인 동의 하 음성 프로파일을 등록**하면, 전사 세그먼트를 의사 음성 임베딩과 대조해 **의사 채널을 확정 앵커링** → 나머지 화자=환자/보호자. 분리 정확도·자동 라벨링 향상(환자는 등록하지 않음, §4.4).
- 모든 AI 산출물·녹음에 **동의·출처·프로비넌스** 부착, 감사 가능.
- 녹음 **동의(전용 별도 동의서)·보존·파기** 전 과정 규정 준수(무동의 녹음 0건).

**비목표(명시)**
- AI 자동 서명·자동 확정 — **절대 안 함**(P-1).
- 임상 의사결정 자동적용(처방/오더 생성·변경) — 안 함(추천은 기존 `autoRecord` 경로로 제시만).
- **상시(always-on) 녹음** — 안 함. 진료 단위 명시적 시작/종료·동의 기반만.
- **실시간 스트리밍 STT/자막** — **P1 범위 밖**(P1은 진료 후 일괄 전사 우선). 단 WeRU.B `/api/stt/chunk`(실시간 청크 STT·partial/final)가 **실재**하므로 후속 단계에서 실현 가능(§12에서 "장기 별도기획"이 아니라 **P3+ 후속 옵션**으로 승격).
- **환자 성문 신원식별** — 안 함. 환자는 음성 프로파일을 등록하지 않으며, 화자분리에서 "비(非)의사 화자"로만 상대구분(누가 환자/보호자인지 세부 신원식별 안 함). ↔ **의료진 특정화자 인식은 목표**(본인 동의 하 등록, §4.4·§2 목표).
- 원격진료 **Jitsi 화상 녹화 통합** — 별개 경로(외부 `/meet-api`). 본 기획은 **대면 진료 오디오** 우선(§15).
- 오프라인(FR-08) 미포함.

---

## 3. 현황 — 재사용할 빌딩블록 (신규 최소화)

| 기능 | 현재 위치 | 입출력 | 스크라이브 확장 |
|------|----------|--------|----------------|
| SOAP 저장·서명·정정 | `Encounter`(SOAP 4필드·`status`·`signedBy/At`) `schema.prisma:1092` / `encounter.service.ts` `create:117`·`update:192`(SIGNED→AMENDED)·`sign:236` | — | **불변**(초안은 DRAFT로만) |
| SOAP 초안(A/P) | `autoSoap:850`(S/O→`{assessment,plan,confidence,references}` JSON·`deidentify` 옵션) | S/O→A/P | 입력을 **전사 텍스트**로 확장(§4.5) |
| 대화→기록(NER+SOAP) | `autoRecord:1592`→WeRU.B `/api/medical/auto-record`(실측 설명 **"진료 대화 → 자동 의무기록 (NER + SOAP)"**·stream판 존재) / FE `AutoRecordTab:1217` | 텍스트→구조화 | **앞단(오디오·전사)만 신설**, 뒷단 재사용(NER 엔티티도 활용) |
| SOAP 요약·초안(대안) | WeRU.B `/api/medical/summarize`(SOAP format·stream)·`/api/medical/draft`(record draft) | 텍스트→SOAP | autoRecord 대안·교차 |
| FHIR 포장 | WeRU.B `/api/fhir/DocumentReference`(실측 **"자동 의무기록 → FHIR DocumentReference (SOAP + NER)"**) | 자동기록→FHIR | 외부 FHIR R4 교환 시(§4.5) |
| 의무기록 법적검사 | WeRU.B **Medical Law**(`/api/medical-law/check/record`·`/check/consent`·`/check/privacy`·`/guide/retention`·`/auto-check`) | SOAP→법적 이슈 | §9 가드레일 자동검사 선택지 |
| **STT·화자분리(라이브 스펙 실측)** | WeRU.B `POST /api/stt`(faster-whisper) — `file`(mp3/mp4/wav/m4a)\|`file_url`·**`diarize:bool`**·**`language:"ko"` 기본**·**`model:…large-v3`**. 실시간판 `POST /api/stt/chunk`(partial/final). `POST /api/translate`(domain=medical). `meetingAnalyze:1836`는 비동기 job 래퍼 | 오디오→전사(+화자분리) | **`/api/stt`를 HIS가 신규 호출**(현재 미배선). 진료 오디오→전사 |
| 품질검사 | `chartQa:1072`(룰+AI 하이브리드 `{score,grade,issues}`) | S/O/A/P→issues | 서명 전 게이트 재사용 |
| **공용 AI 클라이언트(v3.45.0)** | **`aiFetch:90`** — 런타임키+Bearer/X-Medical-Key·**타임아웃(조회15s/LLM120s/스트림180s)**·**kill-switch `ai.server.enabled`→503**·config 캐시 `getAiConfig:51` | endpoint→응답 | **스크라이브 STT/초안 호출도 이 경로 표준화**(신규 fetch 금지) |
| **AI 거버넌스(v3.45.0·PR#296)** | PHI 비식별(`autoSoap.deidentify` 기본 true·`stripAiIdentifiers`·[환자명] 후치환)·disclaimer 자동(`withDisclaimer:153`)·AI 감사(patient-context AuditService)·입력 100KB 가드 | — | **스크라이브가 재사용**(신규 구현 불필요, §5·§7·§9) |
| PHI HMAC 스트리밍 | `encounter-attachment-file.controller.ts:18`(무JWT·HMAC 토큰)·`attToken:354`·`attSignedUrl:361`·`readAttachmentFile:402`·저장 `storage/encounter-attachments/`(정적 밖) | 서명URL→파일 | **오디오 확장자·range 스트리밍**으로 확장(§6) |
| e-서명·step-up | `PATCH /encounters/:id/sign`+`GatedStepUpGuard`+`@RequireStepUp('ENCOUNTER_SIGN')` `encounter.controller.ts:81`·블록체인 `SmartSignButton.tsx` | — | **불변**(초안 서명도 동일 게이트) |
| 진료 lifecycle | `WaitingQueue`(WAITING→CALLED→**IN_CONSULTATION**(encounterId 생성)→COMPLETED) `waiting-queue.service.ts:282` | — | 녹음 세션을 진료중 상태에 연결(§5) |
| 동의 | `ConsentForm`·`ConsentType`(SURGERY/…/GENERAL, **녹음 없음**) `schema.prisma:5076`·`consent.service.ts`(create/sign/revoke) | — | **RECORDING 유형·템플릿 신규**(§6) |
| 감사 | `AuditService`(`safeLog:131`·법정경로는 `log()` throw·인터셉터 `/encounters` 자동감사 `audit.interceptor.ts:25`) | — | 녹음 접근/삭제는 `log()`(§9) |
| config 게이트 | `ConfigRuntimeService`(`get:233`·`DEFAULTS`+DB 오버레이·`terminal.stepUpActions:112`) | — | `scribe.*` 키 신설(§7) |
| FE 진료 작성기 | `patients/[id]/encounter/new/page.tsx`(`handleSignAndBill:871`·`SmartSignButton:2587`)·`AiAssistantPanel.tsx`(autorecord 탭 `:117`·`handleAutoSoap:239`) | — | **녹음 탭·전사 뷰어·SOAP 적용** 추가 |

→ **뒷단(SOAP 초안·서명·감사)은 대부분 존재**. 본 기획의 실제 작업은 **앞단(오디오 캡처·저장·전사·화자분리)** + **동의·프로비넌스·게이트** + **전사↔SOAP 배선**이다.

**갭(신규 구축 필요, 실측)**: ①오디오 캡처(MediaRecorder/getUserMedia — 코드베이스 전무) ②오디오 PHI 저장·스트리밍(현 미디어는 이미지/문서 전용) ③**`/api/stt` HIS 배선**(엔진은 존재하나 HIS가 호출 안 함 — 현재 `/api/meeting/analyze`만 프록시) ④**의료진 특정화자 인식**(음성 등록·매칭·`ScribeVoiceProfile`) — `diarize`는 화자를 **분리**하나 "등록된 의사와 대조" 방식은 미확정(D-2) ⑤녹음 동의 유형(ConsentType에 없음) ⑥스크라이브 세션 모델(녹음↔전사↔초안↔Encounter 연결).

> **AI 서버 능력 실측(2026-07-07, `example.org/ollama/openapi.json` 직접 확인)**: (a)한국어 STT ✅·(b)화자분리 `diarize` ✅·(c)실시간 청크 STT ✅·(d)의료 도메인 번역 ✅ **모두 실재**. 이전 "미확인 가정" 서술은 정정됨. **미확정 잔여 1건**=`diarize` 응답이 화자별 임베딩을 노출하는지(HIS측 대조 가능 여부) — 무타입 응답이라 실오디오 테스트로만 확정(D-2). 브라우저 UA 필요(Python UA 403).

---

## 4. 기능 설계 — 스크라이브 파이프라인

전체 단일 흐름: **(동의) → 녹음 → 업로드(PHI 저장) → 전사·화자분리(비동기) → SOAP 초안(전사 근거) → 검증·출처부착 → Encounter DRAFT 반영 → 의사 검토·수정 → 서명**. AI·녹음은 DRAFT까지만.

### 4.1 F-1. 녹음 동의 게이트 — 전용 별도 동의서 (Consent-First·최우선)
녹음은 **범용/포괄 동의에 끼워넣지 않고, 전용 별도 동의서**로만 취득한다(규제 대응의 1차 방어선·D-3 결정).

**(1) 환자 녹음 동의서** — `ConsentType.RECORDING`
- **선행 조건**: 녹음 시작 API는 해당 환자·진료의 **유효한 RECORDING 동의**를 먼저 검증. 없으면 `RECORDING_CONSENT_REQUIRED`(400) 반환, 녹음 불가(P-7).
- **동의 취득**: `ConsentType.RECORDING` 신설 + **전용 `ConsentTemplate`**(목적·녹음/전사/AI 활용 범위·보존기간·원음 파기·제3자 미제공·철회권·거부 시 불이익 없음 명시). 대면 태블릿 서명(기존 `ConsentSignSession`) 또는 진료 시작 화면 내 전용 서명 다이얼로그. **다른 동의서와 분리**된 독립 문서로 서명·보존.
- **철회**: `consent.service.ts:449 revoke` 재사용. 철회 시 진행 중 녹음 즉시 중단 + 해당 세션 원음·전사 **삭제 큐** 등록(§9).
- **고지**: 녹음 중 화면에 **상시 표시**(빨간 점·"녹음 중"), 환자가 인지 가능하도록. (통신비밀보호법상 대화 당사자 동의 + 개인정보보호법 민감정보 별도 동의 근거.)

**(2) 의료진 음성 프로파일 등록 동의** — 생체정보(§4.4 특정화자 인식 전제)
- 의사가 음성 프로파일을 **등록할 때 1회 별도 동의**(생체정보 수집·이용·보존·철회). 미동의 의사는 프로파일 없이 일반 화자분리로 동작(등록은 opt-in, 강제 아님).
- 등록 철회 시 음성 임베딩 즉시 파기. 직원 생체 동의 거버넌스(SQE·개인정보보호법 민감정보)와 정합(§9·§10).

### 4.2 F-2. 오디오 캡처 (신규 FE)
- 진료 작성기(`encounter/new`)에 **녹음 탭** 추가: `getUserMedia`(마이크) → `MediaRecorder`(webm/opus 권장, 저용량) → 진료 단위 **시작/일시정지/종료**.
- **DRAFT Encounter 선행**: 세션 시작 API는 **유효한 encounterId를 요구**한다. 없으면 진료 시작(`POST /encounters`, DRAFT) 후 그 id로 세션 생성 — 스크라이브가 Encounter를 임의 생성하지 않음(무결성). `WaitingQueue.IN_CONSULTATION` 진료중 상태와 정렬(§5).
- **청크·용량**: 진료 10~20분 opus 녹음 ≈ 5~20MB로 기존 업로드 5MB 제한(`upload.controller.ts:14`)을 초과 → **청크(resumable) 업로드**로 설계(chunk N개 → 서버 병합). NestJS body/multipart 한도·`MAX_UPLOAD_MB` config 상향(오디오 전용 경로만). 브라우저 메모리·네트워크 실패 대비 청크 재시도.
- **브라우저 잔존 금지**: 업로드 성공 확인 후 로컬 Blob 폐기, 종료·이탈 시 미전송 청크 폐기(`beforeunload`).
- **완전 논블로킹**: 녹음 실패가 진료·처방·기존 작성 흐름을 막지 않음(수동 작성 그대로).

### 4.3 F-3. PHI 오디오 저장·스트리밍 (신규 BE, 기존 패턴 확장)
- 저장 경로: `storage/scribe/<encounterId>/<sessionId>.webm` — **무인증 정적(`/uploads`) 밖**, encounter attachment와 동일 격리(P-8). 파일명은 traversal 차단 화이트리스트(예 `^scribe-\d+-[a-f0-9]+\.(webm|ogg|m4a|wav)$`)로 강제.
- 접근: **HMAC 단기토큰 스트리밍** 패턴(`attToken:354`·`attSignedUrl:361`·`readAttachmentFile:402`) 재사용하되 **파일명 화이트리스트 정규식에 오디오 확장자 추가**(`ATT_FNAME_RE:349`는 현재 `png|jpg`) + **HTTP Range 스트리밍**(현재 전체 버퍼 `res.send` → 대용량 오디오는 `fs.createReadStream`+Range 필수).
- **소유 검증(IDOR 차단)**: 서명URL 발급·스트리밍은 **담당의(=`encounter.doctorId`) 본인 + 감사권한 롤**만. HMAC 토큰은 인증을 대체하지 않음 — 발급 시점에 RBAC/소유 검증 선행(단순 토큰 소지 ≠ 열람권).
- **at-rest 보호**: 오디오는 최고위험 PHI → 디스크 저장 시 **암호화 옵션**(`scribe.audio.encryptAtRest`, `ENCRYPTION_KEY` 활용) 검토. 최소한 파일시스템 권한·백업 대상에서 정적 서빙 완전 배제.
- 응답 헤더 `Cache-Control: private, no-store`(기존 `:29`).
- 감사: 재생·다운로드·삭제는 **`log()`(throw, 법정 보존)** — `safeLog` 아님(`audit.service.ts:129` 자체 권고). 단, `/scribe/voice-profile` 등 `/encounters` 밖 경로는 인터셉터 자동감사 미적용 → **명시적 감사 호출** 필요.

### 4.4 F-4. 전사·화자분리·의료진 특정화자 인식 (STT, 핵심)
화자분리는 **필수 기능**이다(옵션·폴백 아님). SOAP의 S(환자 발화)와 O/A/P(의사 발화·판단) 매핑이 화자분리 정확도에 직결되기 때문.

**(1) 전사(STT) — 실호출로 확인된 토폴로지(2026-07-07)**: WeRU.B STT는 **두 백엔드**로 나뉜다:
- **배치 STT+화자분리 = iMac(Metal) 워커**: `POST /api/stt`(faster-whisper·`diarize`·`language:ko`·`model:large-v3`·`file|file_url`)와 `POST /api/meeting/analyze`(비동기 job)는 **모두 STT를 `imac-worker`에 위임**. 실호출 시 iMac 오프라인이면 `/api/stt`=400("iMac(Metal) 전용")·meeting job=`STT failed (imac-worker)`. **화자분리는 이 경로에만 존재** → **iMac 워커 가용성이 스크라이브 전제**(§13 리스크).
- **실시간 STT = GPU(NVIDIA)**: `POST /api/stt/chunk`(faster-whisper medium·raw PCM·partial/final)는 GPU에서 상시 가용(실측 한국어 전사 성공). **단 화자분리 없음**.
- **STT 3단 폴백(설계 확정)**: iMac 가용성에 진료가 멈추지 않도록 계층화한다.
  1. **iMac 배치**(`/api/stt` large-v3 + `diarize`) — 기본·최상(전사+화자분리).
  2. **iMac 다운 → GPU STT**(`/api/stt/chunk`, faster-whisper·**diarize 없음**) + **휴리스틱/마이크 채널 화자추정(특정화자 인식 C안)** → SOAP 초안은 계속 생성, 화자 라벨만 의사 확정. *HIS가 오늘 바로 구현 가능(엔드포인트 전환만).*
  3. **둘 다 실패 → 수동**(FALLBACK, 전사 없이 수기·무중단).
- **라우팅 판단**: 세션 시작/전사 시 `/api/imac/status`·`/api/meeting/status`로 워커 가용 확인 → 단계 선택. **논블로킹**(진료 진행 무간섭).
- **서버측 개선 요청(WeRU.B)**: "iMac 다운 시 **GPU 노드에서도 diarization** 수행(또는 `/api/stt` 자동 GPU 라우팅)"을 협의하면 2단에서도 화자분리 유지 가능 — HIS API로는 강제 불가·서버 config/capability 사안(D-9).
- **오디오 전달**: `/api/stt`는 `file` multipart push 또는 `file_url`. `/api/meeting/analyze`는 **`file_url` 필수**(multipart 불가) → HIS가 서명 URL 제공 또는 S3 업로드(WeRU.B `/api/image/s3/upload-raw`가 오디오 raw도 수용·presigned URL 반환, 실측). push/URL은 nginx UA 필터(Python UA 403) 주의.
- **호출은 `aiFetch`(v3.45.0) 경유**: 스크라이브의 WeRU.B STT/초안 호출은 신규 fetch를 만들지 않고 **공용 `aiFetch:90`**(런타임키·타임아웃·kill-switch)를 사용. STT는 대용량 오디오·장시간 job이므로 **`timeoutMs`를 넉넉히 지정**(스트림/비동기 정책 준용).

**(2) 화자분리(diarization) — `diarize:true` 실측 지원**: `/api/stt`에 `diarize:true`로 화자 분리 세그먼트 수신·저장. **화자분리 엔진은 WeRU.B에 이미 존재**(pyannote 별도 배치 불필요 — 이전 서술 정정). 다만 **응답 정확 형태(화자 라벨·타임스탬프·임베딩 포함 여부)는 무타입이라 실오디오 1건 테스트로 확정**(D-2).
- **다자 화자(2인 초과)**: 진료실엔 의사·환자 외 보호자·간호사·학생 가능. diarization은 화자 수를 고정하지 않고 발견되는 만큼 라벨(`SPEAKER_00..n`). 의사 앵커(아래 3) 외 나머지는 **모두 "비의사"**로 묶되, 주 화자(발화량 최다 비의사)를 `PATIENT` 후보로 제시 → 의사가 확정.

**(3) 의료진 특정화자 인식(speaker identification) — 정확도 앵커·구현 3안**:
`diarize`는 화자를 **분리**(SPEAKER_00/01)하나, "이 화자가 **등록된 이 의사**"라고 확정하려면 별도 대조가 필요. **라이브 스펙 실측 결과 WeRU.B에 전용 화자등록/식별(voiceprint enrollment) 엔드포인트는 없음**(화자 기능=`/api/stt`의 `diarize`뿐) → 현실적 경로는 A·C, B는 WeRU.B 신규 EP 요청 전제(D-2에서 택1):
- **A. HIS측 임베딩 대조(권장·생체정보 봉쇄 최선)**: WeRU.B `diarize` 응답에 **세그먼트별 화자 임베딩**을 포함하도록 협의 → HIS가 저장된 의사 프로파일(`ScribeVoiceProfile`)과 코사인 유사도 대조. 의사 임베딩은 WeRU.B로 전송 안 함(반경 최소). **전제=diarize 응답에 임베딩 노출**(D-2 실테스트로 확인).
- **C. 휴리스틱 폴백(등록 없이도 동작·임베딩 미노출 시)**: **HIS 자체 마이크 채널 분리**(의사 헤드셋/근접 마이크) 또는 발화 패턴(질문 주도·의학용어 밀도)으로 의사 채널 추정 → 의사 확정. 등록 불필요.
- **B. WeRU.B측 화자 식별(현재 미지원)**: 전용 등록/식별 EP를 WeRU.B에 **신규 요청**해야 성립 — 생체정보가 WeRU.B에 상주(DPA 강화). 우선순위 낮음.
- **등록(enrollment)**: A안(B도 해당)은 의사가 본인 동의(§4.1(2)) 하 짧은 음성 샘플(수십 초) 등록 → **음성 임베딩(특징벡터)** 저장(원음 미저장, P-8). C안은 등록 불필요.
- **효과**: 다자 대화·중첩·짧은 발화에서도 **의사 채널 앵커링** → S/O/A/P 매핑 오류↓·자동 라벨링(의사 수동 개입↓).
- **폴백**: 프로파일 없거나 매칭 실패 시 → 무라벨 화자(A/B)만 제시, 의사가 UI에서 라벨 확정(무중단).
- **환자 미등록**: 환자는 프로파일을 만들지 않음(프라이버시). "비의사 화자"로만 구분, 세부 신원식별 안 함(§2 비목표).

**(4) 원음 보존 정책**: 전사·매칭 완료 후 원음 **즉시 파기 옵션**(config `scribe.audio.retention`) — 전사 텍스트만 보관 시 PHI 표면 축소(D-4). 의사 음성 임베딩은 등록 철회 전까지 보관(생체정보 정책). WeRU.B가 임시 보관한 오디오도 job 종료 시 파기 협약(DPA, D-9).

### 4.5 F-5. SOAP 초안 생성 (전사 근거·환각 차단)
- **입력 확장**: 기존 `autoSoap`/`autoRecord`의 입력을 **화자분리 전사**로. 매핑 원칙:
  - **S(주관)** = 환자 발화 요약(호소·증상·경과) — 전사 근거. `Encounter.chiefComplaint`·`historyPresentIllness`(구조화 필드)에도 함께 초안 매핑 가능.
  - **O(객관)** = 진료 중 언급된 소견·측정치 + **구조화 데이터**(활력징후·검사) 병합. 측정치는 코드 서술(LLM 생성 최소).
  - **A(평가)·P(계획)** = 의사 발화·판단 근거 LLM 초안 + 출처.
- **STT 수치·약명 안전(중요)**: 전사에서 나온 **약명·용량·수치는 STT 오인식 위험이 큼**(예 "5mg"↔"15mg"). 이런 값은 **초안 텍스트로만 제시하고 처방/오더에 자동 반영 절대 금지**(P-6) — 의사가 기존 처방 검색·DUR 경로에서 직접 확정. 초안 내 수치는 `⚠전사 확인` 플래그.
- **생성 경로(실측)**: 전사→SOAP는 WeRU.B `/api/medical/auto-record`(**NER+SOAP**·엔티티 추출 포함)를 1차로, `autoSoap`(A/P)·`/api/medical/summarize`(SOAP)를 대안으로. NER 엔티티(증상·약물·진단)는 근거칩·구조화 필드 매핑에 활용하되 **확정은 의사**.
- **FHIR 연계(선택)**: 필요 시 `/api/fhir/DocumentReference`로 초안을 FHIR R4 DocumentReference(SOAP+NER)로 포장 — 외부 교환·상호운용(HIS 내부는 openEHR 패턴이므로 **내부 저장은 Encounter, 외부 교환 시에만** FHIR).
- **출력 계약(structured)**:
```jsonc
{
  "encounterId": "enc_...",
  "draft": {
    "subjective": "환자: 3일 전부터 우상복부 통증, 식후 악화 …",
    "objective": "RUQ 압통(+), Murphy sign 언급; V/S 14:10 BP 128/80 …",
    "assessment": "담낭염 의심 (전사 근거·단정 아님)",
    "plan": "복부 초음파, 금식, 통증 시 진통제 고려"
  },
  "citations": [
    { "field": "subjective", "text": "우상복부 통증", "source": "TRANSCRIPT", "speaker": "PATIENT", "at": "00:02:14" },
    { "field": "objective", "text": "BP 128/80", "source": "VitalSign", "refId": "vs_...", "at": "14:10" }
  ],
  "confidence": 0.71,
  "model": "weru-b:...", "promptVersion": "scribe-soap-v1",
  "source": "AI"                          // 실패 시 "FALLBACK"(전사 원문만·빈 SOAP)
}
```
- **그라운딩 규약**(autoSoap 패턴 강화): ①전사·데이터에 없는 임상사실 생성 금지 ②각 A/P 문장은 발화 타임스탬프/데이터 refId 인용 ③근거 없는 문장은 드롭 또는 `⚠검토 필요` ④온도 낮춤(~0.3) ⑤JSON만·한국어·표준용어.
- **폴백**: 파싱 실패/타임아웃 → `source:'FALLBACK'` + 전사 원문 표시(의사 수동, 무중단).

### 4.6 F-6. 안전·처방 상호작용
- SOAP 초안·처방추천(`autoRecord`)은 **기존 처방/오더/DUR/위급값 워크플로를 대체·억제하지 않음**. 추천은 "제시"만, 확정·서명은 의사.
- `A`의 진단 확정도(certainty)·주상병은 AI **자동 설정 금지** → 의사 확정(기존 진단 입력 경로).
- AI/녹음 실패가 진료 진행을 막지 않도록 **완전 논블로킹**.

### 4.7 F-7. 품질검사·정정·법적검사 보조
- 서명 직전 `chartQa:1072`(룰+AI) 재사용 — 전사↔SOAP 불일치·필수요소 누락 경고(**차단 아님·권고**). 기존 `handleSignAndBill:871(chart-QA :897)`이 이미 chart-QA 호출.
- **법적 적합성 자동검사(실측 신규·선택)**: WeRU.B **Medical Law**(`/api/medical-law/check/record` 의무기록 적합성·`/auto-check` 통합검사·`/guide/retention` 보존기간)로 초안의 법적 이슈를 **권고 수준**으로 표시. AI 법적판단은 **참고용**·차단 아님·최종책임 의사(§9 거버넌스).
- SIGNED 정정 시 변경점 요약 초안 → `update`(SIGNED→AMENDED) 재서명(원본 보존 불변, `encounter.service.ts:195`).

---

## 5. 데이터 흐름·상태

```
[동의]        [캡처]         [저장·PHI]        [전사·화자분리]     [초안]          [의사]              [법적기록]
RECORDING ─검증→ MediaRecorder ─업로드→ storage/scribe/ ─file_url→ WeRU.B ─세그먼트→ grounded ─초안+출처→ 검토·수정 ─서명→ Encounter
동의(P-7)       (webm/opus)    (HMAC·정적밖)   /meeting/analyze  SOAP JSON  DRAFT Encounter          status=SIGNED
   │                                (P-8)      (비동기 job)     (환각차단)  +프로비넌스+citations    signedBy=의사
   └ 철회→ 녹음중단·삭제큐                                                    step-up(ENCOUNTER_SIGN)+블록체인
```

- **진료 lifecycle 정렬**: `WaitingQueue` `IN_CONSULTATION`(진료중, encounterId 생성) 구간에서만 녹음 활성. `COMPLETED` 시 녹음 세션 종료.
- **화자 라벨링**: WeRU.B `/api/stt`가 `diarize`로 화자 분리(전사·세그먼트) 반환 → **의사 확정(특정화자 인식)은 §4.4(3) 구현안(A HIS측 대조·최선)**. A안이면 흐름 `WeRU.B(분리+임베딩) → [HIS: 의사 대조·앵커] → grounded 초안`.
- **PHI 최소화(v3.45.0 재사용)**: WeRU.B 전송은 **내부 GPU(example.org) 경유** + **PR#296 거버넌스 재사용** — `autoSoap.deidentify` **기본 true**(성명 미전송)·`stripAiIdentifiers`·[환자명] 후치환으로 문서 품질 유지. 전사 텍스트에도 동일 비식별 적용. **A안 채택 시 의사 음성 임베딩은 미전송**. 외부 유출 0.

---

## 6. 데이터 모델 변경 (최소·additive·비파괴)

### 6.1 신규 모델 `ScribeSession` (녹음↔전사↔초안 연결)
| 필드 | 타입 | 의미 |
|------|------|------|
| `id` | Uuid | PK |
| `encounterId` | Uuid | 진료 연결(FK) |
| `patientId` / `doctorId` | Uuid | 주체 |
| `consentId` | Uuid? | RECORDING 동의 참조(P-7 강제) |
| `status` | Enum | `RECORDING/UPLOADED/TRANSCRIBING/TRANSCRIBED/DRAFTED/APPLIED/FAILED/DELETED` |
| `audioPath` | String? | `storage/scribe/…`(원음, 파기 시 null) |
| `audioDeletedAt` | DateTime? | 원음 파기 시각(보존정책) |
| `legalHold` | Boolean @default(false) | 보존명령 — 파기에 우선(§9) |
| `transcript` | Json? | 화자분리 세그먼트 `[{speaker,start,end,text}]`. `speaker` = `DOCTOR`(특정화자 인식)·`PATIENT`·`GUARDIAN`·`OTHER`·`UNKNOWN`(미확정) |
| `jobId` | String? | WeRU.B 전사 job |
| `draftSnapshot` | Json? | 생성 SOAP 초안 원문·citations |
| `aiModel`/`aiPromptVersion` | String? | 재현성 |
| `createdAt`/`updatedAt` | DateTime | — |

> **관계**: `Encounter 1—N ScribeSession`(재녹음·분할 대비). `Encounter.scribeSessionId`(§6.2)는 **초안이 적용된 세션**을 가리키는 포인터(1:1 표기용). 순환참조 아님 — 세션→인카운터는 FK, 인카운터→세션은 nullable 포인터.

### 6.2 `Encounter` 프로비넌스 컬럼 (additive)
| 필드 | 타입 | 의미 |
|------|------|------|
| `aiScribed` | Boolean @default(false) | 스크라이브 초안에서 출발 |
| `scribeSessionId` | Uuid? | 근거 세션 |
| `aiEditDistance` | Int? | 초안 대비 서명본 수정량(§11) |

- **서명·무결성 필드 불변**. 프로비넌스는 감사·품질지표·법적 투명성용.
- 적용: **manual SQL(ADD COLUMN/CREATE TABLE IF NOT EXISTS)** + 배포 시 서버 `prisma generate` 필수(신규 모델·필드 — 안 하면 크래시).
- 롤백: additive·config OFF로 즉시 회귀.

### 6.3 신규 모델 `ScribeVoiceProfile` (의료진 특정화자 인식)
| 필드 | 타입 | 의미 |
|------|------|------|
| `id` | Uuid | PK |
| `doctorId` | Uuid @unique | 의사(1인 1프로파일) |
| `embedding` | Json/Bytes | 음성 임베딩(특징벡터) — **원음 미저장**(P-8) |
| `sampleCount` | Int | 등록 샘플 수(품질) |
| `consentAt` | DateTime | 생체정보 등록 동의 시각(§4.1(2)) |
| `status` | Enum | `ACTIVE/REVOKED` |
| `revokedAt` | DateTime? | 철회 시 임베딩 파기 |
| `createdAt`/`updatedAt` | DateTime | — |

- opt-in·1인 1프로파일. 철회 시 임베딩 즉시 파기. 생체정보이므로 접근·삭제 감사는 `log()`(throw).

### 6.4 동의 확장
- `ConsentType`에 **`RECORDING`** 추가(`schema.prisma:5076`) — **환자 녹음 전용 별도 `ConsentTemplate`**(버전관리) 1종(다른 동의서와 분리).
- 의료진 음성 등록 동의는 `ScribeVoiceProfile.consentAt`로 기록(직원 생체 동의 — 환자 ConsentForm과 별개 트랙, SQE 거버넌스).
- 미디어: `MediaFile`은 이미지/문서 전용이므로 **사용 안 함**. 오디오는 `ScribeSession.audioPath`+`storage/` 격리(P-8, MediaService 정적 public 폴더 금지).

---

## 7. API 설계 (신규·게이트·검증)

```
# 진료 스크라이브 세션
POST   /api/v1/encounters/:id/scribe/consent        # RECORDING 동의 확인/생성(없으면 시작 차단)
POST   /api/v1/encounters/:id/scribe/session        # 세션 시작(동의 검증 선행) → sessionId
POST   /api/v1/encounters/:id/scribe/:sid/audio      # 오디오 업로드(청크/완료) → storage/
GET    /api/v1/encounters/:id/scribe/:sid/audio/file # HMAC 토큰 스트리밍(Range)·log() 감사
POST   /api/v1/encounters/:id/scribe/:sid/transcribe # 전사+화자분리+의사 특정화자 매칭 요청(WeRU.B job) → jobId
GET    /api/v1/encounters/:id/scribe/:sid            # 세션 상태·전사(화자라벨)·초안 조회(폴링)
POST   /api/v1/encounters/:id/scribe/:sid/draft      # 전사→SOAP 초안(grounded) 생성
DELETE /api/v1/encounters/:id/scribe/:sid            # 원음/세션 삭제(철회·보존만료)·log() 감사

# 의료진 음성 프로파일(특정화자 인식·본인만)
POST   /api/v1/scribe/voice-profile                  # 등록(생체 동의 선행)·샘플 업로드→임베딩 → ACTIVE
GET    /api/v1/scribe/voice-profile                  # 본인 프로파일 상태(등록여부·품질)
DELETE /api/v1/scribe/voice-profile                  # 철회·임베딩 파기·log() 감사
```
- **이중 게이트**: `scribe.enabled`(기본 OFF·`ConfigRuntimeService.get`) **+ v3.45.0 kill-switch `ai.server.enabled`**(false면 aiFetch가 503) — WeRU.B 장애 시 스크라이브 자동 차단. + **DTO class-validator**(전역 whitelist 대비 데코레이터 필수).
- **RBAC·소유 검증(IDOR 차단)**: 세션·오디오·전사·초안은 **담당의(=`encounter.doctorId`) 본인**만(`@Roles(DOCTOR)` + 리소스 소유 확인 — 롤만으로 부족, 다른 의사의 세션 접근 차단). 동의 취득(`/scribe/consent`)은 접수/간호 참여 가능(별도 롤 허용). `voice-profile`은 **본인만**(userId 일치). 감사권한 롤은 열람 전용.
- 전사·초안 호출은 **`aiFetch`(v3.45.0) 경유** — 타임아웃·kill-switch 자동 적용(스크라이브 STT는 `timeoutMs` 넉넉히). **논블로킹·FALLBACK**(WeRU.B 지연/장애 대비).
- 초안 생성은 Encounter를 **DRAFT로만** 반영(서명 안 함) — 서명은 기존 `PATCH /encounters/:id/sign`(step-up+블록체인) 그대로. AI 산출물엔 **`withDisclaimer` 면책 자동 동봉**(v3.45.0).
- 감사: 세션 생성·전사·초안은 `safeLog`(+ **PR#296 patient-context AuditService 패턴 재사용**), **오디오 접근·삭제·음성 프로파일 등록/철회는 `log()`(throw)**. `/encounters/*`는 인터셉터 자동감사(`audit.interceptor.ts:25`)이나 **`/scribe/voice-profile`은 인터셉터 밖 → 명시적 감사**.

---

## 8. FE UX — 진료 작성기 통합 (구현 명세)

> 신규 화면을 만들지 않고, 검증된 `encounter/new` 작성기와 `AiAssistantPanel`에 녹음·전사·적용을 끼워넣는다. 라벨은 **WeRU.B**(브랜드 규약·신규 'AI' 라벨 금지). RHF+Zod·shadcn/Tailwind·toast-store·StatusBadge 준수.

### 8.0 통합 대상(실측)
| 화면 | 파일 | 스크라이브 |
|------|------|-----------|
| 진료 작성기(메인) | `patients/[id]/encounter/new/page.tsx`(SOAP·처방·`handleSignAndBill:871`·`SmartSignButton:2587`) | **주전장**: 녹음·전사·SOAP 적용·서명 |
| AI 어시스턴트 패널 | `components/AiAssistantPanel.tsx`(autorecord 탭 `:117`·`AutoRecordTab:1217`·`handleAutoSoap:239`) | 녹음 탭 신설·전사 뷰어·초안 적용 |
| 태블릿 진료 작성기 | `tablet/patients/[id]/encounter/page.tsx` | 회진/베드사이드 녹음(터치 타깃) |

### 8.1 컴포넌트 인벤토리
| 컴포넌트 | 신규/재사용 | 역할 |
|---|---|---|
| `ScribeRecorderPanel` | **신규** | 마이크 권한·녹음 시작/정지/종료·상시 "녹음 중" 표시·업로드 |
| `RecordingConsentGate` | **신규** | 녹음 전 **전용 별도 RECORDING 동의서** 확인/서명(미동의 시 녹음 버튼 disabled) |
| `TranscriptViewer` | **신규** | 화자분리 전사(의사/환자 색 구분)·**의사 자동라벨(특정화자 인식 매칭 시 배지)**·타임스탬프·라벨 수동 확정 |
| `VoiceProfileEnroll` | **신규**(직원 설정) | 의사 음성 프로파일 등록/철회·생체 동의·품질 표시(진료화면 아닌 개인설정) |
| `ScribeDraftPanel` | **신규**(`AutoRecordTab` 응용) | SOAP 초안·citations·"S/O/A/P에 적용"/무시 |
| `CitationChips` | **재사용/신규**(간호 기획 정의) | 문장↔전사발화/데이터 근거 칩 |
| `SmartSignButton` | 재사용 | 블록체인 서명·step-up(`ENCOUNTER_SIGN`) |
| `AiSuggestionPanel`·`StatusBadge`·toast-store | 재사용 | 제안·상태·토스트 |

### 8.2 작성기 통합(주전장) — 목업
```
┌─ 진료 작성 ───────────────────────────────[WeRU.B 스크라이브 ●]┐
│ ● 녹음 중 00:03:12   [일시정지] [종료]   ← 상시 표시(환자 인지)  │
│ ☑ 녹음 동의 확인됨(RECORDING)            ← RecordingConsentGate  │
│ ┌─ 전사(화자분리) ──────────────────────────────────────────┐ │
│ │ 🟦환자 00:02:14  "3일 전부터 우상복부가 아파요…"            │ │
│ │ 🟩의사✓ 00:02:40  "식사하고 나면 더 심한가요?"            │ │  ← 의사=특정화자 인식 자동확정(✓)
│ │   (✓=음성프로파일 매칭·미매칭 시 화자A/B로 표시→수동라벨)  │ │  ← TranscriptViewer
│ └────────────────────────────────────────────────────────────┘ │
│ ┌─ WeRU.B SOAP 초안 ──────────────────────[생성]  적용/무시 ─┐ │
│ │ S 환자: 우상복부 통증, 식후 악화   📎00:02:14              │ │
│ │ O RUQ 압통(+); V/S BP 128/80       📎VitalSign             │ │  ← ScribeDraftPanel
│ │ A 담낭염 의심   ⚠검토 필요(단정 아님)                     │ │
│ │ P 복부 초음파·금식               📎00:05:03                │ │
│ └────────────────────────────────────────────────────────────┘ │
│ [S][O][A][P] 폼(편집가능·초안 prefill)                          │
│ ⚠ 품질검사: 통증 재평가 계획 누락(권고) [무시][반영]           │  ← chartQa
│                                   [임시저장]  [서명완료]        │  ← SmartSignButton
└─────────────────────────────────────────────────────────────────┘
```
- **흐름**: 동의☑ → 녹음 → 종료 시 업로드·전사(비동기, 작성기 잠그지 않음) → 전사 도착 → 「생성」 → SOAP 초안 → **적용**(폼 prefill·`aiScribed=true`·snapshot) → 의사 수정 → 서명.
- **S 자동생성 허용**(간호 기획과 차이): 대화에 환자 호소가 있으므로 S도 전사 근거로 초안 생성(단, 편집 가능·출처 필수).
- **미동의/OFF**: config OFF거나 동의 없으면 녹음 UI 미표시·비활성 → 기존 작성 흐름 완전 회귀.

### 8.3 상태·에러·접근성
- 상태기계: `동의 → 녹음 → 업로드 → 전사중 → 전사완료 → 초안 → 적용(편집) → 서명(SIGNED) → [정정]AMENDED`. 실패는 각 단계 `FALLBACK`(수동 진행).
- 로딩: 전사중 진행표시(작성기 비잠금)·"다시 시도" 1회. 빈 근거: 대화 없으면 초안 생성 금지·"기록 없음".
- 타블렛/접근성: 터치 ≥44px, 녹음/종료 큰 히트영역, 전사 색+아이콘 병기(색맹), 키보드 포커스 순서.

---

## 9. 법적·안전·규제·윤리 가드레일

| 영역 | 규약 |
|------|------|
| **녹음 동의(핵심)** | 통신비밀보호법(당사자 대화 녹음)·개인정보보호법(민감정보·음성 별도 동의) → **전용 별도 RECORDING 동의서 없이는 녹음 불가**(P-7·§4.1(1)). 포괄동의에 끼워넣지 않음. 목적·보존·전사·AI활용·철회권·거부 시 불이익 없음 고지. 녹음 중 상시 표시. 철회 즉시 중단·삭제. |
| **의료진 음성 등록(생체정보)** | 개인정보보호법 민감정보(생체인식정보) → **별도 등록 동의**(§4.1(2))·opt-in·본인만. 원음 미저장·임베딩(특징벡터)만·철회 즉시 파기. 목적=진료 문서화 화자분리 앵커링에 한정, 근태·감시 등 타목적 전용 금지. |
| 의료법 §22(기록·서명·보존) | 작성·서명 책임=의사. AI·녹음=보조 도구로 문서에 명시(프로비넌스). 자동 서명 0. 정정(AMENDED 재서명) 불변. |
| **PHI·생체 봉쇄(P-8)** | 오디오·전사=최고위험 PHI, 음성 임베딩=생체정보. 정적 무인증 경로 밖 `storage/` 저장·HMAC 단기토큰·내부 GPU 경유·외부 0. **원음 파기 옵션**(전사 후)으로 표면 축소. 임베딩은 특징벡터만. |
| **원음=의무기록 아님(보존 프레이밍)** | 법정 의무기록은 **서명된 SOAP(Encounter)**. 원음·전사는 그 **작성 근거(source material)**이지 의무기록 자체가 아님 → 의무기록 10년 보존의무를 원음에 그대로 적용할 필요 없음 → **전사 후 원음 단기 파기 정당화**. 단 분쟁·수사 등 **법적 보존명령(legal hold) 시 파기 보류**(D-4). |
| 보존·파기 | `scribe.audio.retention`·`scribe.transcript.retention` 정책. 파기는 `RetentionPolicy` 패턴(DRY-RUN·3중 게이트)·`log()` 감사. legal hold 플래그가 파기에 우선. |
| **동석자(보호자·제3자) 동의** | 진료실 동석자 발화도 녹음됨 → 녹음 동의서에 **동석자 녹음·처리 고지 포함**, 동석자 거부 시 녹음 중단 또는 미동석 안내. 미성년·대리 동의는 기존 보호자 동의 체계 준용. |
| **규제 분류(SaMD)** | 비자율·Human-in-the-Loop 문서화 보조(CDS) — 진단·처방을 **확정하지 않고 제안만**, 의사 검토·서명 필수. 자율판단·자동확정 없음 → 고위험 SW 분류 회피 설계. **도입 전 규제 자문 1건**(식약처 CDS SW·전사SW 분류, D-1). |
| EMR 인증 | 작성자·서명·변경이력 항목 영향 없음(무결성 필드 불변). 프로비넌스는 추가정보. |
| **자동 법적검사(보조)** | WeRU.B Medical Law(`check/record`·`check/consent`·`guide/retention`·`auto-check`)로 초안 법적 이슈 **권고 표시**(§4.7). AI 판단은 참고용·차단 아님·최종책임 의사. 프롬프트/룰 거버넌스는 §거버넌스 준용. |
| 환각/오류 | 근거 없는 사실 생성 금지(§4.5)·전사 발화 인용·A 단정 금지·chartQa 교차·위급값 경로 무간섭. |
| 투명성·면책 | 환자/감사 요청 시 "녹음·AI 보조 여부·근거·전사" 제시(`aiScribed`·`ScribeSession`). AI 초안엔 **v3.45.0 `withDisclaimer` 면책 자동 동봉**(재사용). |
| 거버넌스 | 프롬프트 **버전 관리**(promptVersion)·정기 품질검증(채택률·오류율)·프롬프트 변경 시 파일럿 재검증. |

---

## 10. JCI 인증 정합 (Joint Commission International)

간호 AI 기획서 §10의 매핑을 계승. 스크라이브 특유 통제점:

| JCI 표준 | 요구 | 본 기획 충족·가드 |
|---|---|---|
| **MOI.11.1.1** (auto-population 통제) ★핵심 | 자동입력의 오류전파·구식정보 방지, 저자 능동검토 | 초안=전사 근거 auto-population → ①현재 진료 대화만(stale 차단) ②근거 없는 문장 드롭 ③**검토·서명 게이트** 없이 서명 불가 ④`aiEditDistance` 추적(무수정 서명=과신 모니터) |
| **MOI.9 / MOI.11** (기록 완전성·저자식별) | 작성자·일시 식별, 완전·정확·적시 | AI는 저자 아님 — `signedBy`=의사·`signedAt` 불변. `aiScribed`=도구 표기 |
| **MOI.11.1** (표준 용어·금지약어) | 표준 진단/용어, Do-Not-Use 미사용 | 출력 표준용어·금지약어 필터(chartQa 룰) |
| **PFR** (환자권리·프라이버시) | 프라이버시 보호·고지 | 전용 별도 녹음 동의서·상시고지·PHI 봉쇄·철회권(§9) |
| **SQE** (직원 자격·생체정보 거버넌스) | 직원 데이터·역량 관리 | 의료진 음성 등록=직원 생체정보 별도 동의·opt-in·목적한정·철회(§4.1(2))·역량교육 |
| **IPSG.2** (정확한 의사소통) | 표준 소통·위급결과 | 전사는 보조, 위급값 경보 경로 무간섭 |
| **AOP.1** (자격자 평가·문서화) | 자격 의사가 문서화 | 서명=자격 의사(SQE). AI는 초안만 |
| **GLD.7 / GLD.11** (기술·CDS 거버넌스) | 신규 임상기술 도입 평가·승인·모니터 | 도입 전 평가·승인(의무기록위·QI)·프롬프트 버전 거버넌스·지속 모니터 |
| **QPS** (질·안전 측정) | 지표 측정 | §11 지표 → QPS 편입 |

**도입 전제(체크리스트)**: (J-1) 의무기록위·QI **도입 승인**+SOP. (J-2) **전용 별도 녹음 동의서·전사 SOP**·환자 고지문. (J-3) **AI 도구 사용 역량교육**(한계·검토 책임). (J-4) 기록 검토 프로그램에 스크라이브 표본 층화(AI 보조군 vs 수동군). (J-5) §14 D-1 규제자문 통합. (J-6) **의료진 음성 등록 생체정보 SOP**(동의·목적한정·철회·파기).

---

## 11. 품질·효과 지표

| 지표 | 정의 | 측정 |
|------|------|------|
| 채택률 | 스크라이브 초안 → 서명 도달 비율 | aiScribed SIGNED / draft 생성 |
| **수정량(edit distance)** | 초안 대비 서명본 변경량 | `draftSnapshot` ↔ 최종 SOAP diff → `aiEditDistance`(너무 0이면 과신 의심·양방향) |
| 문서화 시간 | 스크라이브 ON/OFF 진료당 기록시간 | 파일럿 A/B(같은 진료과·의사) |
| 전사 정확도 | STT 오류율(WER) | 표본 수동 검수 |
| **화자귀속 정확도** | 세그먼트 화자 정답률(의사/환자) | 등록군 vs 미등록군 비교(특정화자 인식 효과 검증) |
| 자동 라벨률 | 의사 수동 라벨 개입 없이 확정된 비율 | 특정화자 매칭 성공/전체 |
| 품질 | chartQa 등급·필수요소 누락률 | F-7 집계 |
| 안전(회귀) | 위급값·처방 오기 0 유지 | 기존 워크플로 무간섭 모니터 |
| **동의 준수** | 무동의 녹음 건수 | **항상 0**(게이트 강제) |

**파일럿**: baseline 2주 → 1개 진료과 게이트 ON 2~4주 → 지표·의사 설문·안전사건 0 → 임계 충족 시 확대. 미충족/이상 시 **게이트 OFF 즉시 회귀**.

---

## 12. 단계별 로드맵 + 완료 정의(DoD)

| 단계 | 범위 | 산출 | DoD |
|------|------|------|-----|
| **P0** 기반·동의 ✅**구현(PR#299)** | `ScribeSession`·`ScribeVoiceProfile` 모델·프로비넌스 컬럼·`RECORDING` **전용 별도 동의서**·config 게이트·오디오 저장/HMAC 스트리밍 | manual SQL·`scribe.enabled`·동의 템플릿·`storage/scribe` | 게이트 OFF 시 무변경(회귀 0)·무동의 시 녹음 차단·서명 흐름 불변·오디오 정적 밖 저장 검증. **실측: prisma validate·tsc·DB 마이그레이션·HMAC 라운드트립·UNIQUE 제약 통과. FE 캡처 셸(MediaRecorder·동의 게이트) tsc 통과.** 잔여=HTTP E2E(병합 후)·전사/초안(P1) |
| **P1** 캡처·전사·화자 🟡**진행(PR#299)** | F-2 녹음·F-3 저장·**F-4 전사+화자분리+특정화자 인식** | `ScribeRecorderPanel`(✅)·전사 EP(✅)·`SpeakerResolver`(A/C ✅) | FE 캡처 셸·소유검증·비동기 전사 오케스트레이션·화자 Resolver **구현·tsc 통과**. **잔여=전사 라이브(WeRU.B STT 백엔드 대기·D-2)·diarize 파서 정본화·임베딩 등록(A)·`VoiceProfileEnroll`/`TranscriptViewer` FE** |
| **P2** 초안·서명 🟡**부분(PR#299)** | F-5 SOAP 초안·근거칩·적용·F-7 품질 | `ScribeDraftPanel`·draft EP | draft EP **구현·실측(auto-record NER+SOAP 200)**. 잔여=`ScribeDraftPanel` FE·근거칩·chartQa 게이트·encounter 배선·파일럿 |
| **P3** 정정·태블릿·보존 | F-7 정정·원음 파기 정책·태블릿 회진 녹음 | retention cron·태블릿 통합 | 원음 파기·전사 보존 정책·AMENDED 재서명 불변 |
| **P3+ 후속** | **실시간 자막**(`/api/stt/chunk` 실재)·**진료 중 다국어 통역**(`/api/translate` domain=medical)·특정화자 인식 고도화 | 실시간 STT 배선 | 후속 옵션(별도 기획 아님·엔진 실재) |

**권고 착수 순서**: P0(동의·저장 기반·저위험) → P1(캡처·전사) → P2(초안·효과) → P3.

---

## 13. 리스크·완화

| 리스크 | 완화 |
|--------|------|
| **무동의 녹음(법적)** | 전용 별도 동의서 검증 선행·미동의 차단·상시 고지·철회 즉시삭제(P-7·§4.1) |
| **PHI 오디오 유출** | 정적 밖 저장·HMAC 스트리밍·내부 GPU·원음 파기 옵션·`log()` 감사(P-8) |
| **의료진 음성(생체정보) 오남용** | 별도 동의·opt-in·목적한정(근태/감시 금지)·임베딩만(원음無)·철회 파기·`log()` 감사 |
| 초안 과신(미검토 서명) | 검토·서명 게이트·`aiEditDistance` 모니터·교육 |
| 전사 오류·화자 오분류 | **의료진 특정화자 인식으로 의사 채널 앵커링**·화자 라벨 의사 확정·근거칩(발화 추적)·chartQa 교차·FALLBACK 원문 |
| **STT 약명·용량 오인식** | 수치·약명은 초안 텍스트로만·처방/오더 자동반영 금지(P-6)·`⚠전사 확인` 플래그·의사 처방검색 확정 |
| **IDOR(타 세션·오디오 열람)** | 담당의 소유 검증(롤+`encounter.doctorId`)·HMAC 토큰≠열람권·발급 전 RBAC·`log()` 감사 |
| **동석자 프라이버시** | 동의서에 동석자 녹음 고지·거부 시 중단·미성년 대리동의 준용(§9) |
| 환각/오기 | 전사 근거·O는 데이터 코드서술·A 단정 금지·출처표기 |
| AI 서버 장애/지연(504) | 비동기 job·타임아웃·FALLBACK 무중단·게이트 OFF 회귀 |
| **STT/화자분리 워커(iMac) 오프라인** | 실측: 배치 STT·diarize가 iMac(Metal) 워커 의존 → 다운 시 전사 실패. 완화=워커 상태 헬스체크·오프라인 시 전사 대기/수동 폴백(진료 무중단)·워커 이중화 협의·GPU chunk 대체(무 diarize·수동 라벨). SLA·모니터를 WeRU.B와 합의(D-2·D-9) |
| 오디오 저장 폭증 | webm/opus 저용량·전사 후 원음 파기·보존정책 |
| 행동 변경 회귀 | config 게이트 OFF 기본·1과 파일럿·additive 스키마 |
| 위급 대응 저해 | 녹음/AI와 위급값·처방 경로 완전 분리(무간섭·논블로킹) |

---

## 14. 결정 필요(Open Questions)
- (D-1) **규제 분류 자문**: 전사SW·CDS SaMD 비해당/저위험 확인 1건(도입 전).
- (D-2) **STT/화자분리 연동 스펙 확정**(2026-07-07 sk-키 **실호출** 후 갱신):
  - ✅ **인증·STT 실동작 확인**: GPU 실시간 `/api/stt/chunk`(faster-whisper medium)로 한국어 진료 대화 전사 성공(confidence 0.82·7.2s→2.2s). STT 능력 실재.
  - 🔴 **STT/화자분리 배치 경로는 iMac(Metal) 워커 의존**: `/api/stt`·`/api/meeting/analyze` 모두 STT를 **`imac-worker`에 위임**하는데 실호출 시점에 **iMac 노드 오프라인**(`/api/imac/status → available:false`) → job이 `STT failed (imac-worker)`로 실패. **`diarize` 응답의 임베딩/화자라벨 형태는 아직 미확정**(워커 다운으로 캡처 불가).
  - ⓐ **재검증 필요**: iMac 워커 온라인 시 `/api/stt diarize:true` 응답에 **세그먼트별 임베딩 노출 여부** 확인 → A안 성립 조건.
  - ⓑ **STT 아키텍처 결정(신규)**: 진료 오디오 STT를 (i) iMac 워커 배치(diarize 지원·가용성 리스크) vs (ii) GPU 실시간 chunk(가용·**diarize 없음**) 중 어디로 태울지 — **가용성·화자분리 필요성 트레이드오프**(§4.4·§13).
  - ⓒ 특정화자 인식 **A(임베딩 노출 시 HIS 대조·권장) / C(휴리스틱·마이크 채널)** 택1 — **B(WeRU.B 화자식별)는 전용 EP 없음**.
- (D-4) **원음 보존 정책**: 전사·임베딩 매칭 후 파기 vs 법정보존(의료법 보존연한 대비)·전사 텍스트 보존기간·의사 임베딩 보존.
- (D-5) **파일럿 대상 진료과·기간·성공 임계**(문서화 시간 단축·화자귀속 정확도·수정량 해석 기준).
- (D-6) **PHI 최소화 범위**: WeRU.B 전송 시 성명·식별자 제거(autoSoap `deidentify` 준용) 여부·정도.
- (D-7) 프롬프트 **거버넌스 주체**(의무기록위 검수·버전 승인).
- (D-8) **특정화자 인식 임계·재등록 정책**: 코사인 유사도 임계값·오탐/미탐 트레이드오프·음성 변화(감기 등) 시 재등록 주기.

## 15. 범위 밖(명시)
- AI 자동 서명/확정 · 임상 의사결정 자동적용 · **상시(always-on) 녹음** · 실시간 스트리밍 자막 · **환자 성문 신원식별**(의료진 특정화자 인식은 범위 내·본인 동의) · 음성 등록의 **근태/감시 등 타목적 전용** · **Jitsi 원격진료 화상 녹화 통합**(외부 `/meet-api` 별개) · 오프라인(FR-08) · 외화/청구(타 도메인).

---

## 16. 백로그 · 재개 조건 (⏸ GPU 성능 확보 대기)

> **상태(2026-07-08): 구현 완료·전사 활성화만 대기(BACKLOG)**. HIS 측은 준비 끝, WeRU.B AI 서버의 **STT 컴퓨트 여력(GPU VRAM)** 확보 후 재개.

### 16.1 완료 (main 반영·배포)
- **코드**: P0(모델·세션·오디오 HMAC 스트리밍·음성 프로파일)·P1(전사/화자분리 오케스트레이션·`ScribeAiClient`·`SpeakerResolver` A/C·draft=autoRecord NER+SOAP 재사용)·FE(캡처·전사뷰어·초안패널)·**encounter 배선**(`EncounterScribeSection`). **PR#299·#300·#301 머지·CI 통과.**
- **배포**: his.example.org 서버 스키마(scribe 테이블2·enum·Encounter 컬럼3·자동백업)·api/web 재시작 완료. `ai.server.gpuKey` 서버 존재(인증 준비).
- **실측 확인**: draft 경로(`/api/medical/auto-record` NER+SOAP 200)·경량 STT(`/api/stt/chunk` medium 한국어 conf 0.82)·HMAC·DB 제약.

### 16.2 🔴 블로커 (재개 트리거)
- **WeRU.B STT 배치 경로 자원 부족**: `meeting/analyze`의 **large-v3 + diarize가 GPU CUDA OOM**(RTX 5080 16GB VRAM 경합)·iMac(Metal) 오프로드 노드 불안정. → 전사 자체가 안 나옴.
- **재개 트리거 = 아래 중 하나 확보 시**: ①GPU VRAM 여력(다른 모델 언로드/전용 배정/오프피크) ②iMac(Metal) 워커 안정화(STT를 Apple Silicon 오프로드) ③배치도 경량 모델(medium) 타협(정확도·diarize 여부 확인).

### 16.3 재개 시 남은 작업 (STT 살면 수 시간)
1. **서버 config 플립**: `scribe.enabled=true`·`scribe.transcription.enabled=true`·`scribe.pilotUserIds`(테스트 의사). *(현재 DB 미설정=기본 OFF)*
2. **diarize 응답 정본화**: 실오디오 1건으로 `/api/meeting/analyze diarize` 응답 캡처 → `ScribeAiClient.parseTranscription`(방어적 추정) 실스키마 확정 = **D-2 종결**.
3. **화자확정**: C(휴리스틱)로 즉시 완주 가능. A(임베딩)는 diarize 임베딩 반환(Q1) 확정 + 임베딩 추출 실구현 시.
4. **E2E**: 녹음→업로드→전사→화자분리→초안→SOAP 적용.
5. (운영 전환) 오디오 전달을 외부 wasabi S3→**내부 스토리지**(HIS 서명URL fetch·D-9)로.

### 16.4 병행 진행 가능(STT 무관)
- 스크라이브 모듈 유닛 테스트(게이트·IDOR·HMAC·resolver 휴리스틱).
- AI팀 요청서(Q1/Q2/Q5)·법무 동의서·D-1 규제자문.

---

## 부록 — 근거 파일(검증됨)
- **AI 코어(v3.45.0 갱신·PR#294~296 리팩터 반영)**: `apps/api/src/modules/medical-ai/medical-ai.service.ts` — **공용 클라이언트 `aiFetch:90`(런타임키+Bearer/X-Medical-Key·타임아웃 조회15s/LLM120s/스트림180s·`ai.server.enabled` kill-switch 503)**·`getAiConfig:51`(enabled+timeoutMs)·`getDisclaimer:136`/`withDisclaimer:153`(disclaimer 자동 동봉)·`autoSoap:850`(**`deidentify` 기본 true**·`:856`)·`autoRecord:1592`·`chatLlm:399`(**`getLlmHeaders` 삭제→aiFetch 흡수**)·`realtimeDdx:762`·`chartQa:1072`·`meetingAnalyze:1836`·`meetingJobStatus:1842`·`meetingStatus:1855` / 컨트롤러 `medical-ai.controller.ts`(auto-soap·auto-record·chart-qa·meeting·**AuditService 주입 PR#296**)
- **진료 모델·서명**: `apps/api/prisma/schema.prisma`(`Encounter:1092`·SOAP `:1099-1102`·`status:1111`·`signedAt:1112`·`signedBy:1113`·`EncounterStatus:1044-1048`) / `encounter.service.ts`(`create:117`·`update:192`(SIGNED→AMENDED `:195`)·`sign:236`·`attToken:354`·`attSignedUrl:361`·`readAttachmentFile:402`·`ATT_FNAME_RE:349`) / `encounter.controller.ts`(`create:51`·`update:70`·`sign:81`(`@RequireStepUp('ENCOUNTER_SIGN'):83`)) / PHI 스트리밍 `encounter-attachment-file.controller.ts:18`
- **동의**: `schema.prisma`(`ConsentForm:5094`·`ConsentType:5076`(RECORDING 신규)·`ConsentSignSession:5170`·`PatientConsent:6664`) / `consent.service.ts`(create·sign·`revoke:449`)
- **미디어·저장**: `media.service.ts`(`MEDIA_DIR:8`·`SUPPORTED_EXTENSIONS:10`(오디오 없음)·`syncFilesystemToDb:44`) — **오디오엔 미사용**, `storage/` 격리 필요 / 정적서빙 `main.ts:31`
- **step-up·서명**: `auth/step-up/gated-step-up.guard.ts`(게이트 `:41`·fail-safe `:62`)·`config-runtime.service.ts`(`terminal.stepUpActions:112`·`get:233`·`set:239`) / FE `components/signature/SmartSignButton.tsx`·`BlockchainCertificate schema.prisma:8260`
- **감사**: `audit/audit.service.ts`(`safeLog:131`·법정경로 `log()` throw 권고 `:129`)·`audit.interceptor.ts:25`(`/encounters` 자동감사)
- **lifecycle**: `waiting-queue.service.ts`(`IN_CONSULTATION:282`·encounterId 생성) / `journey.service.ts:86`(ENCOUNTER_SIGNED→수납)
- **FE 진료 작성기**: `apps/web/src/app/(main)/patients/[id]/encounter/new/page.tsx`(`handleSignAndBill:871`·chart-QA `:897`·`SmartSignButton:2587`) / `components/AiAssistantPanel.tsx`(autorecord 탭 `:117`·`AutoRecordTab:1217`·`handleAutoSoap:239`) / 태블릿 `tablet/patients/[id]/encounter/page.tsx`
- **WeRU.B AI 서버 능력(라이브 스펙 실측 2026-07-07, `https://example.org/ollama/openapi.json`·브라우저 UA 필요)**:
  - `POST /api/stt`(tags: System) — faster-whisper·`file|file_url`·**`diarize:bool`**·`language:"ko"`·`model: tiny|base|small|medium|large-v3`. **화자분리·한국어 STT 실재 확인**(응답 무타입 → 형태 실테스트 필요)
  - `POST /api/stt/chunk` — 실시간 청크 STT(raw PCM·X-Mode partial|final)·`{text,lang,confidence,ms,is_final,translation}`. `POST /api/stt/chunk/warm`(모델 워밍)·`GET /api/stt/chunk/status`
  - `POST /api/translate` — 실시간 번역·`domain:[general,medical,legal]`("호스트 STT 파이프라인 연동 계약")
  - `POST /api/meeting/analyze`(비동기 job·202)·`GET /api/meeting/job/{id}`·`/status` — 요약/액션아이템 래퍼(`options` 객체로 diarize 전달 가능성). HIS 프록시 `medical-ai.service.ts:1836`
  - `POST /api/medical/auto-record`(+`/stream`) — **"진료 대화 → 자동 의무기록 (NER + SOAP)"**(Medical-Advanced AI). `POST /api/medical/summarize`(SOAP)·`/api/medical/draft`(record draft)
  - `POST /api/fhir/DocumentReference` — **"자동 의무기록 → FHIR DocumentReference (SOAP + NER)"**. `POST /api/fhir/Condition/search`·`/DiagnosticReport` 등 FHIR 6종
  - **Medical Law 18종**: `/api/medical-law/check/record`·`/check/consent`·`/check/privacy`·`/guide/retention`·`/auto-check`·`/review`(위험밴드+근거인용) — 스크라이브 SOAP 법적검사 오프로드
  - HIS 현재 상태: `/api/meeting/analyze`만 프록시(admin/ai-meeting 수동 URL 입력·`admin/ai-meeting/page.tsx`), **`/api/stt`·FHIR·Medical Law 일부는 미배선**. `autoRecord`는 텍스트 입력(오디오 아님)
  - **화자등록(voiceprint) 전용 EP는 없음** → 특정화자 인식은 A(diarize 임베딩)·C(휴리스틱) 경로(§4.4(3))
  - **버전**: 라이브 `example.org/ollama` = **v2.121.0**(554 path/583 op). 리포 가이드 `docs/05-reference/MEDICAL_AI_INTEGRATION_v2.121.0.md`로 갱신 완료
  - **라이브 실호출 검증(2026-07-07, sk-키)**: 인증 OK. `/api/stt/chunk`(GPU faster-whisper medium) 한국어 진료대화 전사 성공(conf 0.82). `/api/stt`·`/api/meeting/analyze`는 **iMac(Metal) 워커 의존**이며 당시 **오프라인**(`/api/imac/status:available=false`)이라 batch STT/diarize job 실패(`STT failed (imac-worker)`) → **diarize 응답 임베딩 형태 미확정**(워커 온라인 시 재검증). `/api/meeting/status`=whisper large-v3·`/api/image/s3/upload-raw`가 오디오 raw 수용(presigned URL)
- **연관 기획**: [`ai-assisted-nursing-records.plan.md`](./ai-assisted-nursing-records.plan.md)(Human-in-Loop·프로비넌스·JCI 매핑 계승)·[`tablet-chart-view.plan.md`](./tablet-chart-view.plan.md)(회진 셸)
