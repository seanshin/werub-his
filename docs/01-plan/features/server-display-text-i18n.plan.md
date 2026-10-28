# 서버 조립 한국어 표시 문장 — `{ k, params }` 전환 기획

> **Feature**: server-display-text-i18n
> **Created**: 2026-09-15 (I1)
> **Status**: 배치 1(go-live)·배치 2(opening·code-master, I2)·배치 3(record-insights, I3)·예외 배치(I4 — 계약+opening·diagnostic-test·쿼리 파이프) 구현 · 잔여 1,692 동결
> **Priority**: Medium
> 선행: `ui-locale-i18n.plan.md`(카탈로그 방식·`<Tf>` 보간) · 가드 `apps/api/test/architecture/server-composed-display-text.spec.ts`

---

## 1. 문제

서버가 `` `입력 ${n} / 필수 ${m}` `` 처럼 **값을 끼워 한국어 문장을 조립해** 내려주면, 화면 언어를 무엇으로 바꿔도 그 줄은 한국어다.
값이 문장 안에 녹아 있어서 **카탈로그로는 고칠 수 없다**(키가 매번 달라진다). 2026-09-10 QI 표본 창 각주에서 처음 드러났고,
가드가 "한글 + `${` 가 든 템플릿 리터럴"을 세어 **1,797**(2026-09-14)에서 동결해 두었다.

🔴 이 수는 **상한이지 결함 수가 아니다.** 예외 메시지·AI 프롬프트·감사 문구·문서 본문이 섞여 있다. 화면에 닿는지는 한 건씩 봐야 안다.

## 2. 분류 — 세 갈래 (전환 대상은 (a) 뿐)

| 갈래 | 무엇 | 처리 | 예 |
|---|---|---|---|
| **(a) 화면 표시 문장** | 응답에 실려 **직원·환자 화면이 그대로 그리는** 사유·근거·요약 | 서버는 `{ k, params }`(shared `ServerMessage`)만 보낸다 → 화면 `<ServerText>`(`<Tf>`)가 카탈로그로 조립 | go-live 항목 사유(배치 1) · 감시자 detail · 준비율 근거 |
| **(b) 로그·감사·내부 기록** | `logger`·AuditLog `detail`·원장에 **저장되는** 문자열·AI 프롬프트 | **범위 밖** — 번역하지 않는다. 저장된 기록은 기록 시점의 사실이고(소급 번역 금지), 프롬프트는 모델 입력이다 | 감사 사유·`GateViolationLog`·프롬프트 조립 |
| **(c) 서버 생성 문서** | PDF·인쇄·법정 서식·내보내기 파일 | **locale 파라미터**로 받는다(요청자가 언어를 고른다). 한국 법정 서식은 한국어 불변(ui-locale §0) | `medical-record-copy/pdf-generation.service.ts` · 증명서 |

판정 기준: "이 문자열은 **누가 어디서 읽는가**" — 화면이 그대로 그리면 (a), 저장·전송되면 (b), 파일로 나가면 (c).
예외 `message`(HTTP 오류)는 (a) 다 — 화면이 토스트·오류 폴백으로 그대로 그린다. 공통 예외 필터 계약이 걸려 있어 **별도 계약**(§3.2 · I4)으로 옮긴다.
🔴 단 **정적 예외 문장**(자리 값 없음 — `항목 이름이 필요합니다`)은 이 배치 대상이 아니다 — 키가 하나로 고정돼 `<T k={message}>`(`QueryErrorFallback`)로 카탈로그에 올릴 수 있다. 옮기는 것은 **값이 녹은** 예외 문장뿐이다.

## 3. 계약 — `ServerMessage`

정본 `packages/shared/src/server-message.ts`.

```ts
interface ServerMessage { k: string; params?: Record<string, string | number | { k: string } | ServerMessage> }
```

- `k` = 카탈로그 키 = **한국어 원문 문장**, 자리표시자 `{이름}`(web `<Tf>` 와 같은 문법 · 이름에 공백 불가).
- 자리 값: 숫자·코드·식별자·경로·오류 메시지 = **그대로**(데이터) / 한국어 낱말 조각(`미설정`·`종합병원`) = `{ k }` → 화면이 번역 / 문장 조각이 통째로 갈리는 자리 = `ServerMessage` 중첩.
- 🔴 **한글 없는 문장은 자리 이름도 ASCII** — `{키}={값}` 은 `<Tf>` 가 한글 키로 보고 `EN×` 를 단다(`{key}={value}` 로 씀 · 가드가 잡는다).
- 🔴 **연결(`'…' + x`)로 가드를 피하지 않는다** — 키에 값을 이어 붙이면 템플릿과 같은 결함이다. 상수끼리도 키를 한 리터럴로 적는다(가드가 소스에서 키를 뽑아 대조하므로).
- 화면 렌더 `apps/web/src/components/ui/server-text.tsx` — `msg` 가 없으면 `fallback` 을 `<Data>` 로(서버 원문·거짓 `EN×` 금지).

### 3.1 종전 문자열 필드 — 당분간 둔다

응답은 `detailMsg`(정본)와 함께 종전 `detail` 을 **같은 정본에서 파생**해 싣는다: `detail = renderServerMessageKo(detailMsg)`.
템플릿 조립이 아니므로 가드에 세지 않는다. 남겨 두는 이유는 **화면 아닌 소비처**다.

| 필드 | 남은 소비처 | 제거 조건 |
|---|---|---|
| go-live `items[].detail` | ~~opening~~(✅ 배치 2 — opening 은 `detailMsg` 만 읽는다) · **`components/golive/GoLiveBriefing.tsx:133`**(개시 브리핑 인쇄 문서 — i18n 미배선 한국어 문서, 분류 (c)) · `/admin/go-live` 의 `fallback`(구 응답용) · 테스트 `go-live/db-backup-probe`·`readiness-honesty`·`server-message-go-live`(derive 결과 `detail`) · 배포 경계의 구 번들 | 브리핑 문서가 `detailMsg` 를 쓰거나 (c) 로 한국어 파생을 명시적으로 받기로 정한 뒤, 테스트를 `detailMsg` 로 옮기고 **한 배포 지나서** 제거 |
| go-live `readiness.basis` | **`components/golive/GoLiveBriefing.tsx:90`**(같은 인쇄 문서) · `/admin/go-live` `fallback` · 테스트 `go-live/readiness-honesty`(`basis` 문구 2곳)·`server-message-go-live` | 위와 같음 — 2026-09-15 I2 전역 grep 에서 소비처가 남아 **제거하지 않았다**(종전 "화면만"은 틀렸다 — 브리핑 문서를 놓쳤다) |
| opening `derived.detail`·`periodLabel` · code-master `notes`·`changes`·`error`·`note`·`warning`·`reason` | 각 화면의 `fallback`(구 응답용) · 기존 단위 테스트(문구 대조) | 새 필드이므로 go-live 와 같은 조건으로 한 배포 뒤 판단 |

🔴 **nullable/제거 전에 그 필드를 읽는 소비처를 전역 grep 으로 먼저 센다**(판정 규칙 §8).

### 3.2 예외 문장 — `msgException` · `error.msg` (2026-09-15 I4)

실측(I4 착수 시):
- 전역 예외 필터(`common/filters/global-exception.filter.ts` — main.ts `useGlobalFilters` + `APP_FILTER` 둘 다 같은 클래스)가 `{ error: { code, message, details }, meta }` 를 만든다.
  `code` 는 본문 `code` → 없으면 Nest `error`(`Bad Request`) · `message` 는 `exception.message` · `details` 는 본문의 나머지 키(구조화 payload 54개소 보존 — 판정 규칙 §8 "details=res.message 만 뽑아 payload 를 버렸다" 봉합분) 또는 문자열 message.
- FE `lib/api-client.ts` `parseError` → `ApiError(code, message, details)` · 표시는 `lib/error-utils.ts` `extractErrorMessage`(전역 `MutationCache.onError` 토스트·`QueryErrorFallback`) 와 화면별 `toast.error(e.message)`.
  `QueryErrorFallback` 은 `<T k={message}>` 로 감싸지만 **값이 녹은 문장은 키가 매번 달라** 번역된 적이 없다.

계약(하위 호환 — 추가만 한다):

| 층 | 무엇 | 하위 호환 |
|---|---|---|
| 서버 | `msgException(status, serverMsg(k, params), extra?)`(`apps/api/src/common/msg-exception.ts`) — 종전 `new XxxException(문자열)` 과 같은 본문(`statusCode`·`message`·`error`)에 `msg` 를 더한다 · `extra` 로 `code`·payload | `message` = `renderServerMessageKo(msg)`(글자 단위 종전 문장) · `code` 동일(`Bad Request` 등) |
| 필터 | 본문 `msg` 가 `ServerMessage` 모양이면 `error.msg` 로 싣는다 · `details` 로 새지 않는다 | msg 없는 응답은 **키 자체가 없다**(모양 불변) · 모양 아닌 msg 는 버린다 |
| FE | `ApiError.msg`(4번째 인자) → `extractErrorMessage(error, locale?)` 가 **현재 화면 언어**로 조립(`lib/server-message-text.ts` `serverMessageText` — `useServerTextAttr` 와 같은 정본) · `QueryErrorFallback`·전역 토스트는 이 함수를 이미 지난다 | msg 없으면 종전 `message` · 모바일·외부 호출자는 `message` 만 읽는다 |

- 화면별 `toast.error(e.message)` 는 **자동으로 바뀌지 않는다** — 옮긴 모듈의 화면만 `extractErrorMessage(e)` 로 배선한다(`/admin/opening` 7곳 · 기초검사 워크스테이션 `errText`). 나머지 화면은 msg 가 와도 종전 한국어 message 를 그린다(퇴행 없음).
- 🔴 자리 값이 **데이터**인 것은 그대로 — 측정 항목 이름(`PTA 우측` — 화면도 원문으로 그린다)·쿼리 키 이름·받은 값·항목 키. 번역되는 것은 문장 틀이다.

## 4. 기준선 운영

- 가드는 **정확 일치**(`count == BASELINE`) — 늘면 실패, 줄었는데 안 내리면 "낡은 기준선"으로 실패(여유 = 신규 위반 흡수).
- 배치를 끝낼 때 기준선을 **실측값으로 내리고** 파일 머리 이력에 `이전 → 이후(날짜 · 모듈 · 자리 수 · 무엇으로)` 한 줄을 남긴다.
- 🔴 (b)·(c) 로 판정한 자리는 **세는 규칙을 바꿔서** 빼지 않는다(예: 감사 문구 제외 정규식 추가는 가드 완화다). 뺄 이유가 확정되면 스캐너 규칙과 이 문서를 같이 고치고 이력에 적는다.
- 배치마다 **재주입 3종**: ① 조립 템플릿 하나 복원 → 기준선 가드 실패 ② 화면을 `{it.detail}` 로 되돌림 → web 배선 가드 실패 ③ 카탈로그 키 하나 삭제 → 등재 가드 실패. 주입 성공(`count == 1`)을 먼저 확인하고 `cp -p` 로 원복.

## 5. 안전 문구 — 규약 불변

간호·BCMA·MAR·고위험·위급값·부분 실패 등 **안전 축 문구의 미등재 규약은 이 기획이 바꾸지 않는다.**
안전 축 모듈(nursing 37 등)의 서버 문장은 `{ k, params }` 로 옮기더라도 **카탈로그 번역 등재는 사람 결정 뒤**다 — 옮기는 것과 번역하는 것은 다른 일이다.

## 6. 배치 계획

| 배치 | 모듈 | 자리 | 상태 |
|---|---|---|---|
| 1 | `go-live`(관리 `/admin/go-live` — 비안전·소비처 1화면 명확) | 스캐너 28자리 → 문장 키 48(보간 33·정적 15) · 등재 47(`{key}={value}` 제외 · `servermsg`) | ✅ 2026-09-15 |
| 2 | `opening`(`/admin/opening` — go-live `detailMsg` 전달 · 결정/위원회 파생 사유 · 주기 라벨) + `code-master`(`/admin/codes` — 고시 반영 미리보기·분류 유도·중복·내보내기 안내·분류 없음·동의어 경고·자동 매핑 사유) | 스캐너 opening 9(18 중 예외 9 제외) + code-master 20(79 중) = 29 → 문장 키 48 등재(`{head} · {tail}` 제외) · go-live `detail`/`basis` 는 소비처 잔존으로 **미제거**(§3.1) | ✅ 2026-09-15 I2 |
| 3 | `record-timeline/record-insights.ts`(환자 기록 '의미찾기' `InsightView` — 묶음 제목·힌트·근거 `titleMsg`/`hintMsg`/`noteMsg` · 항목 `labelMsg`/`detailMsg`) + 화면 크롬 배선(부품 전체 배선 0 이었다) | 스캐너 23자리(모듈 49 중) → servermsg 키 39 등재(한글 없는 `{from} → {to} ({date})`·`{from} ~ {to}` 제외 · 기록 값이 빈 자리의 낱말 `약품`·`기록`·`검사`·`영상`·`수술`은 기존 카탈로그) · 크롬 키 10(chart) · ATTENTION 항목은 이슈 정본 문구라 `*Msg` 없음(원문 `<Data>`) | ✅ 2026-09-15 I3 |
| 이후 | `sentinel/pipe-sweep`(26 · 관리 전용) · `data-quality`(21) · `gld/governance-enactment`(21) | — | 대기 |
| 보류 | `agent-session`(144)·`medical-ai`(88) — 아래 실측 분류 · `nursing`(37) — §5 · `claim`(39) — 청구 원장 문구((b)/(c) 혼재) | — | 사람 결정 먼저 |
| 예외 배치 1 | 계약(§3.2 — `msgException`·필터 `error.msg`·`ApiError.msg`·`extractErrorMessage`) + `opening` 9(기관 항목 추가·수정·삭제 검증 — I2 잔여 전부) + `diagnostic-test` 10(기초검사 워크스테이션 검사값 범위·선택지·자리 설정 — 기사가 입력 중 매일 보는 오류) + 전역 쿼리 파이프 `common/pipes/date-query.pipe.ts` 6(모든 화면의 날짜·페이지 파라미터 400) | 25자리 → servermsg 키 23 등재(diagnostic-test 자리 찾기 2곳 같은 키 · 파이프 정수 2곳 같은 키) · diagnostic-test 잔여 1 = 델타체크 사유(결과에 저장, (b)) | ✅ 2026-09-15 I4 |
| 예외 배치 이후 | 한 줄 예외 템플릿 실측(2026-09-15 · 스캐너 줄 중 `Exception(` 이 같은 줄 — 여러 줄 throw 는 빠진다) 264: voucher 21 · checkup 15 · gld 14 · code-master 12 · inventory 9 · blood-bank 8 · pharmacist-activity 8 … | — | 대기(화면 배선과 한 벌로) |

**배치 2 분류 실측(2026-09-15 I2 · 스캐너 줄을 한 건씩 판정 — 손 분류라 ±수 건 오차 가능)**

| 모듈 | (a) 화면 표시 | 예외 message | (b) 감사·로그·저장 | (b) AI 프롬프트·컨텍스트 | 기타 |
|---|---|---|---|---|---|
| `code-master` 79 | **20 전환** | 20 | 21(감사 원장·로거 이어진 줄·데이터셋 notes 저장·후보 사유 JSON) | 3 | 화면 소비처 없는 가져오기 응답 15(ATC·DRG·기초 데이터 — web 호출부 0) |
| `agent-session` 144 | 환자 챗 응답 약 104 — 🔴 **한국어 전용 대화 채널**(프롬프트가 한국어 응답 지시 · 대화 기록으로 저장돼 AI 에 되먹임) | — | — | 약 15 | 빠른 응답 칩 약 25(사용자 발화로 되돌아와 **파서가 한국어로 읽는다** — 번역하면 파서가 못 읽는다) |
| `medical-ai` 88 | 약물·검사 판정 사유 약 25(DUR·위급 — §5 안전 축 인접) · 기타 표시 약 10 | 약 10 | — | 약 43 | — |

**배치 3 분류 실측(2026-09-15 I3 · 스캐너 줄 한 건씩)**

| 모듈 | (a) 화면 표시 | 예외 message | (b) 감사·로그·저장 | (b) AI 프롬프트·컨텍스트 | 기타 |
|---|---|---|---|---|---|
| `record-timeline` 49 | **record-insights 23 전환** | 1 | — | record-summary 16(규칙 요약 `lines`·`context` — 화면 표시와 **AI 프롬프트 재료 겸용**: 번역하면 프롬프트 언어가 갈라진다) · 프롬프트 1 | record-issues 5(임상 판정 사유 `why` — §5 안전 축 인접 · 요약 응답·의미찾기 ATTENTION·프롬프트 겸용) · 서비스 3(미확인 위급 `{n}건` 값 · 검사 묶음 제목 `검사 N항목` — 시계열 카드 제목 겸 약품 동일성·요약 재료) |
| `checkup` 44 | 결과서 서명 준비 `blockers` 3(**web 소비처 0** — `result-readiness` 호출 화면 없음 · 서명 거부 예외 message 에 이어 붙는다) | 약 17 | 저장되는 알림 제목·기록 본문(`title`·`assessment`·`notes`) 약 10 · 분해입력 값 1 | 약 11(종합 해석·추적 권고 프롬프트·aiUnavailable 사유) | 연동 미구현 안내 1 |
| `gld` 44 | 표준 발효 판정 `reasons` 약 6(**web 렌더 0** — 경로 발효 응답 `governance` 에 실리고 BLOCK 예외 message 에 이어 붙는다) | 약 27 | 게이트 위반 문구(GateViolationLog 저장) 2 · 알림 제목/본문 3 · 로그 이어진 줄 2 · 결정 문구 저장 2 | — | 집행 라벨 1 |

→ checkup·gld 는 (a) 자리가 사실상 없다 — 예외 배치(§2)·화면이 생길 때 다시 본다. record-timeline 의 나머지는 AI 요약 재료와 임상 안전 문구라 (a) 가 아니다.

→ agent-session·medical-ai 는 (a) 방식 일괄 전환 대상이 아니다. 챗 채널 언어 정책(`i18n.unwiredScreenScope`)·안전 문구(`i18n.safetyStringTranslation`) 결정이 먼저다.

잔여 분포(2026-09-15 배치 2 후 · 1,740): agent-session 144 · medical-ai 88 · code-master 59 · record-timeline 49 · checkup 44 · gld 44 · claim 39 · nursing 37 · orchestrator 35 · notification 34.
잔여 분포(2026-09-15 배치 3 후 · 1,717): agent-session 144 · medical-ai 88 · code-master 59 · checkup 44 · gld 44 · claim 39 · nursing 37 · orchestrator 35 · notification 34 · record-timeline 26.

## 7. 사람 결정 — 등록부 키를 가리킨다 (이 표는 정본이 아니다)

| 무엇 | 등록부 키 |
|---|---|
| 서버 문장 키(전량 AI 초안)를 누가 검수하는가 | `i18n.reviewOwnership` |
| 안전 축 서버 문장을 번역 등재할 것인가(§5) | `i18n.safetyStringTranslation` |
| 서버 문장 커버리지가 언어 선택지 기준에 들어가는가 | `i18n.packActivationCriteria` |
| 어느 모듈까지 전환할 것인가(배치 범위) | `i18n.unwiredScreenScope` |

## 8. 가드

- `apps/api/test/architecture/server-composed-display-text.spec.ts` — 총량 정확 일치(1,797 → 1,769 → 1,740 → 1,717).
- `apps/api/test/architecture/server-message-sources.ts` — 배치별 소스 목록·키 추출·등재/형식 검사 공용 부품(새 배치는 `SERVER_MESSAGE_SOURCES` 에 파일을 더한다).
- `apps/api/test/architecture/server-message-batch2.spec.ts` — opening·code-master 소스 키 등재 · 집행 라벨 조각 등재 · **파일별 잔여 조립 줄 수 정확 일치**(되돌림 탐지) · 실제 반환 `*Msg` ↔ 문자열 파생 글자 단위 동일 · opening 이 go-live `detailMsg` 를 읽는다.
- `apps/api/test/architecture/server-message-batch3.spec.ts` — record-insights 소스 키(`orWord` 낱말 조각 포함) 등재 · 잔여 조립 줄 0 · 여섯 묶음 실제 반환의 `*Msg` ↔ 문자열 파생 글자 단위 동일 · ATTENTION 밖 한글 문자열이 메시지 없이 나가지 않음 · 대조군(ATTENTION 항목은 메시지 없음).
- `apps/web/test/ui/insight-view-server-text.spec.tsx` — InsightView en 렌더 한국어 0·`EN×` 0(목록·로딩·실패·빈 상태) · ko 동일 · msg 없는 항목 티 없음 · 원문 직접 렌더 되돌림 탐지.
- `apps/api/test/architecture/server-message-go-live.spec.ts` — 소스 키 전량 en·ja·ar 등재 · derive 결과 `detail == renderServerMessageKo(detailMsg)` · 자리표시자↔params 일치 · 고아(**전 배치 소스 합집합** 기준)/죽은 키 0 · 연결 우회 0 · 대조군.
- `apps/web/test/ui/server-text-render.spec.tsx` — en 렌더 한국어 0·`EN×` 0 · ko 글자 단위 동일 · fallback 대조군 · go-live 화면 배선 · 배치 2 opening·codes 배선 · 속성/토스트 자리 `useServerTextAttr`(같은 규칙).
- `apps/api/test/architecture/server-message-exception.spec.ts`(I4) — `msgException` 본문이 종전 문자열 예외와 같다(+msg) · 🔴 필터가 `error.msg` 보존 · 종전 키 불변 · 대조군(msg 없는 예외는 `msg` 키 없음 · 모양 아닌 msg 버림) · 세 파일 키 등재 · 예외 조립 템플릿 0 · 잔여 정확 일치 · 실제 던지는 예외(파이프 5형·검사값 5형·opening)의 `message` 가 종전 한국어 문장과 글자 단위 동일.
- `apps/web/test/ui/exception-msg-render.spec.tsx`(I4) — `apiClient` 가 `error.msg` → `ApiError.msg`(대조군: 없음·모양 아님) · `extractErrorMessage` en 한국어 0·값 그대로·ko 동일·msg 없으면 종전 · `QueryErrorFallback` en 한국어 0·`EN×` 0 · 화면 배선(opening 7·기초검사 `errText`).
