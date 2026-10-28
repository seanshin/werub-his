# VoiceEMR 개인화 상세 설계 — 음성 트레이닝 + 맞춤 사전

- **작성일**: 2026-07-29
- **상위**: `docs/01-plan/features/voice-emr-expansion.plan.md` §15
- **범위**: (A) 의료진 음성 특정화 트레이닝 · (B) 개인 맞춤 사전 관리 — UX 흐름·데이터 모델·EP·런타임 통합·안전.
- **현행 실측**: `enrollVoiceProfile`은 **placeholder**(동의+sampleCount만 저장·**임베딩 추출 미구현**). `ScribeVoiceProfile.embedding`(Json·null)·`speaker-resolver.resolveByEmbedding(threshold 0.7)`는 소비 준비됨. 본 설계가 그 공백(임베딩 추출·게이팅)을 채운다.

---

# A. 의료진 음성 특정화 트레이닝

## A.1 등록 상태기계
```
NONE ──(생체 동의)──▶ CONSENTED ──(표본 수집)──▶ ENROLLING(n<최소)
                                                     │
                                       (n≥최소·품질통과) ▼
                                                   ACTIVE ◀──(증분 표본·적응)
                                                     │
                                       (revoke·임베딩 파기) ▼
                                                   REVOKED
```
- `ScribeVoiceProfile.status`(ACTIVE/REVOKED) 재사용 + 파생 상태(ENROLLING = ACTIVE 전 `sampleCount < voiceEmr.enroll.minSamples`).
- 최소 표본 `voiceEmr.enroll.minSamples`(기본 3)·권장 5~8.

## A.2 가이드형 다표본 트레이닝 흐름
1. **생체 동의 게이트**: `dto.consent=true` + `consentAt`(현행 유지). 문안=`docs/05-reference/scribe-recording-consent-draft` 준용·"음성 특징벡터만 저장·원음 미저장·언제든 철회" 명시.
2. **가이드 낭독**: 정해진 문구 세트(N개)를 순차 제시 → 각 낭독을 **Web Audio PCM(§14 G1)** 캡처.
   - 문구 세트 = 대표 발화 스크립트(`voice-emr-utterance-scripts`) 중 음소 다양성 높은 것 + 명령/구술 대표(예: "혈압 백삼십에 팔십"·"메트포르민 오백 밀리그램"·"환자분 오늘 어떠세요").
3. **표본 품질 게이팅**(표본별): 길이(≥1.5s)·에너지/SNR·임베딩 노름 검사 → 미달 시 **재낭독 유도**(조용한 곳·마이크 근접 안내). 통과분만 `sampleCount++`.
4. **임베딩 집계**: 표본별 임베딩 → **중심(centroid) 평균** 저장(`embedding` Json). 이상치(저유사) 표본 제외.
5. **검증 단계**: 등록 후 "아무 말이나 해보세요" → 실시간 speaker-match 점수 표시(코사인) → 임계(0.7) 이상이면 **ACTIVE 확정**.
6. **증분·적응**(선택): 운영 중 고신뢰 발화를 표본으로 추가(환경 변화·마스크 착용 대응). `sampleCount` 상한·centroid 갱신.
7. **철회**: `revoke` → `embedding=null`·status=REVOKED·감사 기록.

## A.3 임베딩 추출 경로 (Q13 회신 의존)
| 경로 | 방법 | 비고 |
|---|---|---|
| **A(권장)** | 낭독 오디오 → WeRU.B **`/api/embed/coreml`**(또는 `/chunk` 화자 임베딩) → 특징벡터 | 서버 임베딩·HIS는 벡터만 저장 |
| **B(폴백)** | 배치 diarize 임베딩(스크라이브 A안·`resolveByEmbedding`) | 배치 경로라 트레이닝 전용엔 과함 |
- **Q13**에서 `/chunk` 화자 게이팅 + 임베딩 획득 경로를 확정한다. 확정 전까지 A.2의 1~3(수집·동의)까지 구현, 4~5(임베딩)는 Q13 후.

## A.4 런타임 화자 게이팅 (오픈마이크 구술)
- **경로 A(서버)**: `/chunk` 요청에 등록 임베딩(또는 프로파일 세션키) 전달 → 서버가 **화자 일치 청크만 전사**·불일치는 빈 결과/낮은 speaker-conf. (Q13)
- **경로 B(클라)**: 온디바이스 임베딩 대조 → 불일치 청크 미전송(대역폭↓). 브라우저 임베딩 부담이라 A 우선.
- **폴백**: 게이팅 미가용/미등록 → **PTT로 자동 폴백**(G2 이중방어). `voiceEmr.speakerGate.enabled`(기본 OFF).
- **오검 관측**: speaker-match 분포·게이팅 오탈락률(의사 발화가 배제된 비율) → `/admin/ai-settings`.

## A.5 UX — 음성 등록 카드 (`/settings/voice` 첫 탭)
```
┌─ 내 음성 등록 ───────────────────────────────┐
│ 상태: ● 등록됨(표본 5)   [다시 등록] [철회]    │
│ ─────────────────────────────────────────── │
│ (미등록 시) 생체정보 등록 동의 ☐              │
│  진료 중 내 목소리만 명령으로 인식하기 위해    │
│  음성 특징벡터를 저장합니다(원음 저장 안 함).  │
│                                              │
│ 3/8  "혈압 백삼십에 팔십"    🎙️ [녹음]        │
│  ▁▂▅▇▅▂▁ (파형)   품질: 좋음 ✓  [재녹음]     │
│ ─────────────────────────────────────────── │
│ 검증: "아무 말이나 해보세요"  일치도 0.83 ✓   │
└──────────────────────────────────────────────┘
```

## A.6 거버넌스
- 생체정보(임베딩) = 개인정보 민감정보. **동의·원음 미저장·즉시 철회·감사**(등록/철회 audit.log·법정보존). 스크라이브 DPA·Q7 연장. `/admin/ai-settings`에서 등록률·철회 통계(개별 벡터 비노출).

---

# B. 개인 맞춤 사전 관리

## B.1 데이터 모델 (Prisma DDL 초안)
```prisma
model VoiceUserProfile {
  userId            String   @id @db.Uuid
  defaultMode       String   @default("read")   // read|dictate|command
  pttEnabled        Boolean  @default(true)      // 명령/활력 PTT(G2)
  speakerGateEnabled Boolean @default(false)     // A.4 게이팅
  language          String   @default("ko")
  updatedAt         DateTime @updatedAt
  @@map("voice_user_profiles")
}

model VoiceCustomPhrase {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @db.Uuid
  type      String                              // ALIAS|HABIT|VOCAB|MACRO
  pattern   String   @db.VarChar(200)           // 발화(정규화 키)
  action    Json                                // type별 타깃(아래)
  enabled   Boolean  @default(true)
  priority  Int      @default(100)
  hitCount  Int      @default(0)
  createdAt DateTime @default(now())
  @@unique([userId, type, pattern])             // 사용자·타입 내 중복 방지
  @@index([userId, type, enabled])
  @@map("voice_custom_phrases")
}
```
- `action` 스키마(type별): ALIAS→`{kind:'order-set'|'template'|'query', ref}` · HABIT→`{canonical, code?}` · VOCAB→`{term, code?}`(action 최소) · MACRO→`{templateBody}`.

## B.2 EP 계약 (self-service·JWT DOCTOR)
| 메서드·경로 | 역할 |
|---|---|
| `GET /api/v1/voice/profile` | 내 설정 조회 |
| `PATCH /api/v1/voice/profile` | 설정(defaultMode·ptt·speakerGate) |
| `GET /api/v1/voice/phrases?type=` | 내 문구 목록(타입 필터) |
| `POST /api/v1/voice/phrases` | 추가(DTO class-validator·type enum·pattern 검증) |
| `PATCH /api/v1/voice/phrases/:id` | 수정·토글(enabled) |
| `DELETE /api/v1/voice/phrases/:id` | 삭제 |
| `POST /api/v1/voice/phrases/:id/test` | 테스트(발화 샘플→매칭 결과 미리보기) |
- 관리 오버사이트: `GET /api/v1/admin/voice/usage`(사용 통계·ADMIN).

## B.3 관리 화면 (`/settings/voice`)
```
[음성 등록] [맞춤 명령] [습관 보정] [개인 어휘] [매크로] [설정]
─────────────────────────────────────────────────────────
맞춤 명령(ALIAS)                               [+ 추가]
┌──────────────┬────────────────────┬──────┬─────┐
│ 발화          │ 동작                │ 사용 │ on  │
├──────────────┼────────────────────┼──────┼─────┤
│ 내 고혈압 세트 │ 오더셋: HTN-초진    │ 42   │ ●   │
│ 늘 쓰는 소견   │ 템플릿: 정상소견     │ 17   │ ●   │
└──────────────┴────────────────────┴──────┴─────┘
⚠ 오더 연계 명령도 실행 시 환자 확인·DUR·명시 확정이 필요합니다.
```

## B.4 타입별 에디터
- **ALIAS**: `발화` + `동작 선택`(오더셋/템플릿/조회 picker) → 오더셋 선택 시 **경고 배지**(게이트 우회 불가). 
- **HABIT**: `들리는 말` → `표준어/코드` 매핑 테이블(예: 타이레놀→아세트아미노펜). 
- **VOCAB**: 용어 리스트 + **shortlist 예산 표시**(개인 어휘 n / 200 슬롯 — Q3 상한 가시화).
- **MACRO**: 이름 + 템플릿 본문(에디터). 삽입=DRAFT.

## B.5 런타임 통합 (파서·바이어싱·후처리)
```
STT final
 → [HABIT 정규화 + 한국어 수사(G4)]   (후처리·final→text)
 → [ALIAS 매칭(개인·우선)]  hit? → action(초안)  : ↓
 → [일반 rule grammar(§4.3)]         match? : ↓
 → [WeRU.B NER 슬롯 보강]
 → mode 라우터 + 확인 게이트
```
- **우선순위**: 개인 ALIAS > 일반 grammar > NER. `priority`로 사용자 내 순서.
- **VOCAB 병합**: 진료별 shortlist = 개인 VOCAB(상위) ∪ 환자 활성처방 ∪ 진료과 상위 → **≤200**.
- **hitCount**: 매칭 시 증가 → 저사용 문구 정리·튜닝 신호.

## B.6 🔴 안전 규칙 (불변)
- **게이트 우회 불가**: ALIAS/MACRO가 오더·처방을 생성해도 **read-back·환자 신원(G3)·DUR/포뮬러리·명시 확정(P-6)** 을 반드시 통과. "내 세트"=초안 삽입까지, 확정은 항상 사람.
- **안전어 shadowing 금지**: ALIAS `pattern`이 취소·중단·서명 등 **시스템 예약 명령을 가리지 못하게** 검증(등록 시 거부).
- **감사**: 개인 문구 유발 동작은 `VoiceCommandLog`에 `phraseId`·type 기록(누가·무슨 매크로로).
- **격리**: 문구는 **본인만** CRUD·본인 세션에만 적용(타 사용자 무영향).

## B.7 로드맵 (§15.3 상세)
- **P1(저위험 먼저)**: 모델·EP·`/settings/voice`·**HABIT/VOCAB**(후처리·바이어싱만·쓰기 없음) + 음성 등록 수집(A.2 1~3).
- **P2**: 임베딩·화자 게이팅(A.3~A.4·Q13 후)·**MACRO**(템플릿 삽입).
- **P3**: **ALIAS→오더셋**(T3 게이트 위·최고 위험·임상 승인).

---

## 부록 · 신규 config
`voiceEmr.enroll.minSamples`(3) · `voiceEmr.speakerGate.enabled`(OFF) · `voiceEmr.speakerGate.threshold`(0.7) · `voiceEmr.phrases.maxPerUser`(타입별 상한) · `voiceEmr.vocab.personalReserve`(개인 VOCAB 예약 슬롯).
