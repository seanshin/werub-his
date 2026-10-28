# 언어팩 사람 검수 — 기획서 (전문가가 화면에서 교정·확정한다)

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/web/src/app/(main)/admin/ui-locale/review/page.tsx · apps/api/src/modules/i18n-review/i18n-review.service.ts:87 · 잔여: 검수자 지정(i18n.reviewers 비어 ADMIN 만)(사람)

- 작성 2026-09-09 · 상태 **P0 서버 축 완료(FE·DB 반영 잔여 — §6.1)** · 상위 정본 [`ui-locale-i18n.plan.md`](ui-locale-i18n.plan.md)
- 요구(사용자): "각 언어팩의 내용을 검토·보완하는 기능. **전문 언어지식을 가진 사람**이 판단하고 수정·교정할 수 있어야 한다."

## §0 축 정의 — 무엇이고 무엇이 아닌가

**이것이다**: 코드에 들어 있는 **AI 초안 번역**을 언어 전문가(비개발자)가 화면에서 읽고, 고치고, "검수했다"를 남기는 일. 그 결과가 실제 화면에 반영되고, 코드 정본으로 수렴하는 경로까지.

**이것이 아니다**: 번역을 더 만드는 일(그건 배선 라운드). 원문(한국어 키) 수정(원문이 키다 — 바꾸면 전 화면이 미등록이 된다).

**현재 상태(2026-09-09 실측)**: 카탈로그 키 10,165개가 **전량 AI 초안**이고 `*_VERIFIED` 집합은 전부 비어 있다. 검수는 "커밋으로 남는 사람 행위"로만 정의돼 있어 **개발자만 할 수 있다**. 언어 전문가가 손댈 표면이 없다.

## §1 🔴 이 축의 제1 위험 — 정본이 둘이 된다

카탈로그는 **코드 파일**(`packages/shared/src/i18n/messages/*.ts`, `packs/*.ts`)이 정본이다. 화면에서 고친 값을 DB 에만 두면 같은 사실에 정본이 둘이 되고, 다음 배포가 조용히 되돌린다(이 저장소가 여러 번 겪은 P12).

**설계 원칙**
1. DB 오버레이는 **검수 결과**이고 코드는 **초안**이다. 런타임은 오버레이를 먼저 보되, 화면은 **어느 쪽이 보이는지**를 항상 말한다.
2. 오버레이는 **코드로 수렴한다** — 내보내기(export)가 카탈로그 파일 형식을 그대로 만들고, 그것을 커밋하면 오버레이는 "코드와 같음"이 되어 사라진다.
3. 🔴 **기록 ≠ 적용**: 검수자가 저장한 것과 화면에 나가는 것이 다를 수 있다(승인 전). 그 상태를 화면이 말한다.

## §2 설계

### 2.1 스키마 `TranslationOverride` (신설)

```
id · locale(en|ja|ar|zh|ru|vi|kk|mn|th…) · key(한국어 원문·문맥 키 포함) · area(카탈로그 영역명·파생)
draftValue(검수자가 쓴 값) · baseValue(작성 시점의 코드 값 — 코드가 바뀌면 "원본이 바뀌었다"를 말한다)
status(PROPOSED|APPROVED|REJECTED|MERGED) · note(사유·근거)
proposedBy · proposedAt · reviewedBy · reviewedAt · mergedAt(코드로 내보내 커밋된 시점)
@@unique([locale, key])   // 한 키에 한 제안 — 재수정은 같은 행을 갱신하고 이력은 전이 원장에
```
`TranslationOverrideTransition`(append-only): overrideId · from · to · actorId · at · reason.

🔴 **AI 제안 원장(`AiProposal`)과 같은 모양**이다 — 초안이 있고, 사람이 수락/수정/거부하고, 그 이력이 남는다. 어휘를 새로 만들지 말고 그 규약을 따른다.

### 2.2 런타임 반영

- 서버: `GET /api/v1/i18n/overrides?locale=` → `APPROVED` 만 반환(부하 대비 ETag·캐시).
- FE: 부팅 시 1회 받아 `applyReviewOverlay(locale, entries)`(shared)로 **그 언어 팩 위에 병합**한다. 실패하면 조용히 코드 값으로 — 단 관제 화면이 "오버레이를 불러오지 못했다"를 말한다(실패를 없음으로 번역하지 않는다).
  - 🔴 **`registerCatalog` 로 `CATALOGS` 맨 앞에 넣는 방법은 동작하지 않는다**(초안 기획의 문구를 구현에서 뒤집었다): `tOf()` 는 ①팩 ②빌트인 카탈로그 순으로 보는데 빌트인은 부팅 시 이미 팩으로 조립되므로 ①에서 이겨 **오버레이가 화면에 나오지 않는다**. 근거는 `packages/shared/src/i18n/overlay.ts` 헤더 주석.
- 🔴 `PROPOSED` 는 화면에 반영하지 않는다. 검수 화면에서만 미리보기.

### 2.3 검수 화면 `/admin/ui-locale/review`

워크리스트다 — **줄어드는 목록**(사라지는 알림이 아니라).

| 열 | 내용 |
|---|---|
| 원문(키) | 한국어. 문맥 키는 `원문@문맥` 을 그대로 보여준다(왜 갈렸는지가 검수의 핵심 정보다) |
| 현재 값 | 코드 초안 또는 승인된 오버레이. **출처 배지**(코드 AI 초안 / 검수 완료) |
| 교정 입력 | 검수자가 쓴다. 저장=`PROPOSED` |
| 상태 | 제안·승인·반려·병합됨 |
| 쓰이는 곳 | 그 키를 쓰는 화면 목록(스캐너 파생 — 문맥 없이 번역하면 틀린다) |

필터: 언어 · 영역 · **문맥 결손**(`packContextGaps` — 뜻이 틀린 번역이 나가는 자리) · 미검수 · 제안됨 · 반려됨 · 안전 키(임상·규제).

🔴 **일괄 승인 없음.** 이 저장소에서 무확인 일괄 적용은 이미 사고를 냈다(코드 매핑 `autoConfirm`). 건별 승인이고, 승인자는 제안자와 달라야 한다(4-eyes — 같은 사람이면 그 사실을 화면이 말한다).

### 2.4 안전 키 표시

임상·규제 키(위급값·KTAS·MAR·투약·격리·수가·게이트·결정 층)는 **오역이 위해**다. 배선 라운드가 각 카탈로그 헤더와 보고서에 검수 대상으로 열거했다 — 그 목록을 화면이 배지로 보여주고, 필터로 먼저 처리하게 한다. 🔴 안전 키는 **번역하지 않고 원문+티로 두는 것도 정답**이다(KTAS 등급·MAR 상태 선례). 검수자가 "번역하지 않음"을 선택할 수 있어야 한다(`REJECTED` + 사유).

실물: `POST /api/v1/i18n/review/reject-key` (`RejectKeyDto` — locale·key·**사유 필수**).
🔴 **이 경로가 없는 동안 §2.4 는 실행 불가였다**(2026-09-09 FE 계약 대조에서 발견): 반려는 오버레이 행(id)이 있어야 했고, 행을 만들려면 `ProposeDto.value`(`@MinLength(1)`)에 검수자가 쓰지도 않은 값을 지어내야 했다. "빈 값은 받지 않는다 — 번역하지 않음은 반려로 남긴다"는 주석이 있는데 **그 반려로 가는 길이 없었다.**
🔴 그리고 이 판정은 **기록이지 적용이 아니다** — 반려는 코드 카탈로그의 AI 초안을 지우지 않으므로, 초안이 남아 있으면 화면에는 그 초안이 계속 나간다. 응답 `codeStillShows` 와 통계 `noTranslateButCodeStillShows` 가 그 사실을 분모와 함께 말한다. 원문+티로 실제로 바꾸려면 §2.5 코드 수렴(개발자가 카탈로그에서 그 키를 뺌)이 필요하다.

### 2.5 코드 수렴 — 내보내기

`GET /api/v1/i18n/review/export?locale=&area=`(실물 경로) → 카탈로그 파일 형식 텍스트. 개발자가 파일에 반영·커밋하면 `MERGED` 로 표시. 🔴 **자동 커밋하지 않는다**(코드 변경은 사람의 행위다).

가드: 오버레이가 코드와 같아진 키는 `MERGED` 로 넘어가고, `APPROVED` 인데 코드와 다른 키 수를 관제가 분모와 함께 보여준다("N건이 아직 코드에 없다").

### 2.6 권한

- 언어별 검수자: `i18n.reviewers` 설정(언어→userId 목록). 등록부 결정 `i18n.reviewOwnership` 이 이미 있다 — 그 결정과 연결한다.
- 승인은 검수자, 병합 표시는 ADMIN.
- 🔴 권한이 없으면 **버튼을 숨기지 말고** 왜 못 하는지 말한다(숨김≠권한 회수 규약).

## §3 단계

| 단계 | 내용 | 침습도 |
|---|---|---|
| P0 | 스키마 + 오버레이 조회/제안/승인 API + 런타임 반영(FE 부팅 등록) | 중간(스키마) |
| P1 | 검수 화면(워크리스트·필터·출처 배지·4-eyes·안전 키) | 낮음 |
| P2 | 내보내기 + 병합 관제(코드와 다른 승인분 N건) + `*_VERIFIED` 연동 | 낮음 |
| P3 | 문맥 결손·사용처 파생을 화면에 붙임(`packContextGaps`·스캐너 파생) | 낮음 |

## §4 가드 (재주입 역검증)

| 가드 | 무엇을 막나 | 실물(2026-09-09) |
|---|---|---|
| `overlay-approved-only.spec` | `PROPOSED`/`REJECTED` 가 런타임에 반영되지 않는다(대조군: `APPROVED` 는 반영) | `apps/api/test/architecture/overlay-approved-only.spec.ts` |
| `overlay-origin-visible.spec` | 화면이 값의 출처(코드 초안/검수 완료)를 말한다 — 배지 없이 그리면 실패 | **미작성**(P1 화면과 한 벌 — FE 몫) |
| `no-bulk-approve.spec` | 일괄 승인 EP·버튼 0 | `apps/api/test/architecture/no-bulk-approve.spec.ts` |
| `four-eyes.spec` | 제안자=승인자면 그 사실이 응답·화면에 남는다 | `apps/api/test/architecture/i18n-four-eyes.spec.ts` |
| `overlay-load-failure-honesty.spec` | 오버레이 조회 실패를 "오버레이 없음"으로 번역하지 않는다 | `apps/api/test/architecture/overlay-load-failure-honesty.spec.ts` |
| `export-shape.spec` | 내보낸 텍스트가 카탈로그 파일 형식과 같다(붙여넣으면 컴파일된다) | `apps/api/test/architecture/i18n-export-shape.spec.ts` |

§2.4 "키만으로 반려" 경로의 단언은 `overlay-approved-only.spec`(빈 값 승인 봉쇄·기록≠적용·미등재 키 400·기존 행 보존)과 `no-bulk-approve.spec`(키 하나·사유 필수·`DecisionDto` 는 선택 유지 대조군)에 붙였다.

공용 픽스처 `apps/api/test/architecture/i18n-review-fixture.ts` — 🔴 목은 **Prisma 의 실제 반환 모양**
(`select` 적용·`Date`·`@prisma/client` enum)을 쓰고, 카탈로그 키도 정본(`codeEntriesFor`)에서 꺼낸다.

## §5 사람 결정

| 결정 | 왜 |
|---|---|
| 언어별 검수자 지정 | 등록부 `i18n.reviewOwnership` 과 연결 |
| 승인된 번역을 코드에 언제 반영할지 | 배포 주기와 묶인다 |
| 안전 키를 번역할지 원문으로 둘지 | 임상·규제 판단(KTAS 등급 선례) |
| 부분 번역 언어를 사용자에게 계속 노출할지 | 커버리지 9~21% 인 팩이 ACTIVE 다 |

## §6 진행 기록

- 2026-09-09 기획 작성.
- 2026-09-09 **P0 서버 축 마감**(BE 한정 — 화면·DB 반영은 아래 §6.1 참조).

### P0 에서 실제로 한 것

| 축 | 실물 |
|---|---|
| 스키마 | `TranslationOverride`·`TranslationOverrideTransition` + enum `TranslationOverrideStatus`(`schema.prisma`). **prisma client 생성까지만** — DB 반영은 사람 몫 |
| 모듈 배선 | `I18nReviewModule` 을 `app.module.ts` 에 등록. 🔴 **등록 전까지는 아무도 부르지 않는 죽은 모듈이었다**(파일은 있었고 라우트는 0이었다) |
| 부트 검증 | `nest build` → `dist/app.module` → `NestFactory.create` → `close` 실측 **성공**. 전체 라우트 3,265 · 이 모듈 8 EP 가 실제로 떴다(`GET overrides`·`GET/POST review`·`GET review/stats`·`GET review/export`·`POST review/:id/{approve,reject,merged}`) |
| 코드 초안 읽기 | `catalog-source.ts` — `AREA_CATALOGS`+팩에서 파생. 실측 **en 전집 10,329키 / 영역 38종** |
| 쓰이는 곳 | 웹 소스 `.tsx` 786파일 스캔 → **9,002키**에 화면 경로. 소스가 없으면 `null`+사유(빈 배열로 답하지 않는다) |
| 안전 키 | `safety-keys.ts` 12축 패턴(수기 목록 없음 — 새 키가 자동으로 시야에 든다) |
| 오버레이 | `packages/shared/src/i18n/overlay.ts` — 팩 병합 확장점 사용(`CATALOGS` 앞에 넣어도 조립된 빌트인 팩이 이겨 **화면에 안 나온다**는 사실을 코드 주석에 못박음) |
| 감사 | 별도 배선 없음이 정답 — `/api/v1/i18n/review*` 는 `AUDIT_EXEMPT` 에 없어 **변이 기본 감사 ON** 에 걸린다(resourceType `I18n`·resourceId 는 경로 UUID 또는 `data.id`) |

### P0 검토에서 고친 실결함(구현은 있었으나 검증 없이 중단돼 있었다)

1. **런타임 EP 가 상태를 고를 수 있었다** — `/overrides?status=PROPOSED` 로 **미승인 번역이 나갈 수
   있는 표면**이었다(§2.2 위반). DTO·컨트롤러·서비스에서 인자를 **없앴다**. 미리보기는 `/review` 행의
   `overlayValue` 가 이미 담당한다.
2. **승인·반려 사유가 제안자의 근거를 지웠다** — `note: reason ?? row.note`. 전이 원장에도 옛 note 는
   없어 **되돌릴 수 없는 소실**이었다. `note` 를 덮지 않고, 결정 사유는 전이 원장에서 파생한
   `decisionReason`/`decisionAt` 으로 목록에 싣는다.
3. **check-then-act 경쟁** — 제안 조회가 트랜잭션 **밖**이라 같은 키 동시 제안이
   `@@unique([locale,key])` 위반 500 이 됐다. 조회를 트랜잭션 안으로 넣고 P2002 면 **한 번 재시도**.
4. **분자와 분모의 모집단이 달랐다** — 검수율 분자를 오버레이 **전건**에서 세어, 코드에서 사라진 옛 키의
   기록까지 검수로 셌다(`Math.max(...,0)` 이 그 모순을 가리고 있었다). 카탈로그 교집합으로 세고,
   카탈로그 밖 행은 `orphanOverrides` 로 **따로 드러낸다**.
5. **산출 불가를 `false` 로 그렸다** — 팩이 없어 문맥 결손을 산출할 수 없는데 행마다 `contextGap:false`
   였다("결손 아님"과 구분되지 않는다). `boolean | null` 로 바꿨다.
6. **오버레이 회수가 조용했다** — 팩 등록은 병합이라 승인이 취소된 키의 옛 값이 그대로 남는데 아무도
   그 사실을 몰랐다. `applyReviewOverlay` 가 `staleKeys` 로 답한다(완전한 회수는 새로고침뿐 —
   `verified` 집합을 줄이는 경로가 `pack.ts` 에 없다. **아래 §6.1 잔여**).

### 2026-09-09 후속 — §2.4 실행 경로 개통(FE 계약 대조가 찾은 것)

FE 갈래의 계약 대조가 **§2.4 가 실행 불가**임을 찾아 서버로 넘어왔다. 회수한 것:

| 항목 | 실물 |
|---|---|
| 키만으로 반려 | `POST /api/v1/i18n/review/reject-key` + `RejectKeyDto`(class) — 🔴 **여기서만 사유가 필수**다(교정값이 없어 사유가 곧 내용 · §2.1). `DecisionDto.reason` 은 선택 그대로 두었다(값이 이미 본문이라 강제하면 아무 값이나 골라 거짓이 된다) |
| 기존 행 | `draftValue`·제안자 `note` 를 **덮지 않고** 기존 `decide(..., 'REJECTED')` 경로로 흘려보낸다 |
| 새 행 | `draftValue: ''`(= "번역하지 않음"의 표현)·`status: REJECTED`·`note = 사유`·전이 `null → REJECTED`. 🔴 `proposedBy` 는 **null** — 제안이 없었기 때문이다(판정자를 제안자 칸에 적으면 "제안자=승인자"라는 **없던 4-eyes 위반**이 생긴다) |
| 경합 | `propose` 와 같다 — 트랜잭션 안 조회 + `@@unique` 위반 시 1회 재시도 |
| 🔴 빈 값 승인 봉쇄 | `decide()` 가 `APPROVED` + `draftValue.trim() === ''` 이면 400(`I18N_APPROVE_REQUIRES_VALUE`). 없으면 "번역하지 않음" 행이 나중에 승인돼 **빈 문자열이 화면에 나간다** |
| 목록·통계 정직성 | 행에 `noTranslate`(FE 가 `overlayValue: ''` 를 "값 있음"으로 읽지 않게 서버가 어휘를 준다) · 통계에 `noTranslate` / 🔴 `noTranslateButCodeStillShows`(기록≠적용을 분모와 함께). `translated` 는 **코드 값만** 세므로 검수율 분자는 오염되지 않는다(가드가 부분 번역 언어에서 실측) |

**DB 스키마 변경 없음** — 기존 `TranslationOverride` 컬럼만 쓴다(마이그레이션 불필요).

🔴 **FE 몫으로 남는 것**(FE 소유 파일이라 손대지 않았다): 계약 미러
`apps/web/src/app/(main)/admin/ui-locale/review/contract.ts` 의 `I18N_REVIEW_EP` 와 대조 스펙
`apps/web/test/architecture/i18n-review-contract.spec.ts` 의 `fePaths` 에 `rejectKey` 를 더해야 한다.
지금은 그 스펙의 **양방향 경로 대조 1건이 실패**한다(19개 중 18 통과 — 서버 8 경로 vs FE 7).

### 고치지 않고 남긴 것(판단이 갈리는 자리)

- **읽기(`/review`·`/review/stats`·`/review/export`)는 로그인한 전 직원에게 열려 있다.** 담기는 것은
  화면 문구·제안자 이름뿐이고 PHI 가 아니며, §2.6 이 "권한이 없으면 숨기지 말고 왜 못 하는지 말한다"를
  요구한다(응답 `meta.permission.reason`). 닫을지는 사람 결정이다.
- **`verified` 축소 불가**(위 6번) — `packages/shared/src/i18n/pack.ts` 규약 변경이 필요해 이 라운드
  범위 밖으로 뒀다.

### §6.1 🔴 남은 것 — 사람 몫·다른 축

- **DB 반영(사람 몫)**: `translation_overrides`·`translation_override_transitions` 를 **이 라운드에서
  DB 에 반영하지 않았다**(`prisma db push`·`migrate` 미실행). 없으면 부팅은 정상이고 이 모듈의 조회·쓰기
  EP 만 실패한다.
  - **로컬 개발 DB 실측(2026-09-09, 오케스트레이터)**: `to_regclass` 로 조회한 결과 **두 테이블 모두 없다**(`null`).
    다만 로컬 DB 는 스키마 대비 180 테이블이 밀려 있어 **운영 DB 의 상태를 대변하지 않는다** — 운영은 이 세션에서
    확인하지 않았다(확인하지 않은 것을 "없다"고 적지 않는다).
  - 적용 SQL 을 만들어 뒀다: **`apps/api/prisma/manual/i18n-translation-overrides.sql`**(enum 1·테이블 2·인덱스 5·FK 1,
    전부 additive). 🔴 순서는 저장소 규약대로 **psql 실행 → `prisma/` rsync → `prisma generate` → `nest build`**
    (`deploy.sh --api` 는 `prisma generate` 를 하지 않는다).
- **P1 화면(FE 몫)**: `/admin/ui-locale/review` 워크리스트·출처 배지·4-eyes 표시·안전 키 필터.
  가드 `overlay-origin-visible.spec` 은 그 화면과 한 벌로 작성한다.
- **FE 부팅 오버레이 등록(FE 몫)**: `GET /api/v1/i18n/overrides` → `applyReviewOverlay`. 실패는
  조용한 폴백이 아니라 관제가 말해야 한다(§2.2).
- **사람 결정(§5)**: `i18n.reviewers` 설정이 비어 있어 **현재 쓰기가 가능한 주체는 ADMIN 뿐**이다.
  화면은 그 이유를 문구로 답한다(`설정 i18n.reviewers 에 <언어> 검수자가 아직 지정되지 않았습니다`).
