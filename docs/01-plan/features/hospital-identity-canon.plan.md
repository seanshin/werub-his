# 기관 정체성 정본 — 병원명·기관 정보 하드코딩 회수

- 작성: 2026-09-11 · 상태: **P-무결정분 착수(같은 날) · P0~P5 는 사람 결정 대기**
- 근거: 읽기 전용 전수 실측(678행 분류 · 운영 DB SELECT) — 산출물은 세션 scratchpad `research-hospname/`
- 관련: `docs/01-plan/features/ui-locale-i18n.plan.md` §12-C(병원명 하드코딩) · 결정 등록부 `/admin/decisions`

## 1. 왜 — 한 줄

🔴 **법정 발급 서식 11종이 설정을 전혀 읽지 않고 데모 상수를 찍는다** — 요양기관기호 `WRB-DEMO-0001` ·
사업자번호 `000-00-00000` · 대표자 `대표원장` · `(데모 주소)`. 서버 PDF(browserless)가 같은 페이지를 렌더하므로
**포털 다운로드·전자서명 경로도 같은 값**을 받는다(운영 발급 11건). 여기에 병원명이 코드 115파일(한국어명 기준)에
박혀 있어, 이 제품은 **다른 기관(UAE 포함)에 설치할 수 없는 상태**다.

## 2. 실측 (2026-09-11)

### 2.1 표기가 하나가 아니다

- 한국어명 `위루비병원` 외에 **영문명 4종**: `Weruby Hospital`(en·international) ·
  `Weruby Hospital`(hospital-facts·homepage Footer) · `Weruby Hospital`
  (번역 카탈로그 AI 초안) · 운영 설정값 `WERUBYHOSP (Weruby Hospital)`. 일문·중문·약칭 `WERUBYHOSP` 도 있다.

| 워크스페이스 | 병원명 리터럴 | 파일 | 한국어명만(파일) |
|---|---:|---:|---:|
| apps/api/src | 23 | 12 | 7 |
| apps/web/src | 135(HIS 59 · 홈페이지 그룹·en/ja/zh 76) | 81 | 68 |
| packages/shared/src | 7 | 4 | 4 |
| apps/homepage/src | 77 | 44 | 36 |
| apps/mobile | 0 | 0 | 0 |

### 2.2 성격별(도메인·연락처 포함 678행 · 규칙 분류라 경계는 사람 재확인)

- **B 인쇄·법정(가장 위험)**: 서식 11종 `DEV_HOSPITAL_PROFILE`(`components/document/lib/hospitalProfile.ts`) · 발급 원장 스냅샷에 기관 정보 없음 ·
  진위검증 응답 하드코딩 · 웹 인쇄(PrintLayout·동의서 `{{hospital.name}}` 를 **상수로** 치환·소견서 "병원 병원" 이중 표기·접수증·팔찌·인쇄 워터마크) ·
  API 문서(의뢰서 HTML · 기록사본 PDF 가 `Hospital RUN Medical Center · Seoul Teheran-ro 123` 날조 · 영문 영수증 `hospitalNameEn` 상수 · 검진권 발행자).
  설정을 읽는 곳도 미설정이면 `'Hospital RUN 병원'` 등으로 **폴백**(3상태 아님).
- **C AI 프롬프트**: 컨시어지 `SYSTEM_PROMPT` 상수(진료시간 "09:00~18:00" 이 CMS 정본 17:30 과 다름) · agent-session 프롬프트 2곳 · 고정 응답 10여 곳.
- **A HIS 화면**: 로그인·포털·Sidebar·토큰 화면(verify·문진·설문·동의기기)·메타·세션·관리 화면(i18n 키 자체에 병원명 — `admin4`).
  `facility-info` 의 "서울시 강남구" 는 가상 주소와 모순(날조 후보 — 사람 확인).
- **G 식별자**: passkey rpName · TOTP 발행자 · 메일 발신자/제목 · 인증서 `O=` · DUR 발신자 `WERUBYHOSP-HIS`. `'Hospital RUN'` 폴백 18곳(FHIR Organization 포함).
- **D 시드·테스트**: 정당(다만 seed 가 드리프트 키 `general.hospital.name` 에 '가상대학교병원' 을 upsert — 읽는 곳 0).

### 2.3 정본이 셋이다(P12)

`system_configs hospital.*` · `organizations`(isSelf — 전원·HIE 가 읽음) · CMS `GENERAL/directions`(포털 오시는 길).
운영 설정은 **6키뿐**(name·nameEn·address·addressEn·city·phone) — 요양기관기호·사업자번호·대표자·국가·진료시간은 행이 없어 기본값(플레이스홀더)으로 떨어진다.
공개(무인증) EP 가 `hospital.*` 을 주지 않아 로그인·포털 로그인·verify·토큰 화면은 **지금 이름을 받을 길이 없다**.

## 3. 사람 결정 — 🔴 정본은 결정 등록부다(이 절은 키를 가리킬 뿐)

| 등록부 키 | 무엇 | 층 |
|---|---|---|
| `identity.legalNameSplit` | 법정 서식 명칭 — 등록 명칭(`hospital.legalName` 신설)과 표시명을 나눌 것인가 | 허가권자 |
| `identity.documentSnapshot` | 발급 서식의 기관 정보 — 발급 당시 스냅샷 vs 현재값 | 원내 위원회 |
| `identity.canonSource` | 기관 정체성 정본 위치 — 설정 / organizations / 용도별 | 원내 위원회 |
| `identity.foreignNames` | 공식 영·일·중 명칭(기관이 확정 — 지어내지 않는다) | 허가권자 |
| `identity.unsetIssuance` | 기관 정보 미설정 시 법정 서식 발급을 막는가 | 원내 위원회 |

🔴 **콘텐츠 날조 — 정본 키가 없어 남은 것**(2026-09-12 실측 · 기관이 값을 정해야 한다):
포털 기본 공지·챗 폴백의 주차(지하 B1~B3·**320대**·최초 2시간 무료)·구내식당 가격·편의점 영업시간·**장례식장 문의 `02-1234-5670`**.
🔴 장례식장 번호는 **환자에게 나가는 지어낸 전화번호**다(P15). 설정 키가 없어 코드가 상수로 들고 있다 —
`hospital.parking.*`·`hospital.funeral.phone` 류를 신설할지, 해당 안내를 **아예 내리는지**가 사람 결정이다(내리는 쪽이 기본).

등재하지 않고 여기 남기는 것(성격상 결정이 아니라 확인·후속): DUR 발신자 ID·인증서 `O=` 변경의 대외 영향(대외 등록 확인) ·
공개 사이트 기관명 주입 방식(빌드 env vs 런타임) · `facility-info` 서울 주소 · seed `general.hospital.name` 제거.

## 4. 단계

| 단계 | 내용 | 선행 |
|---|---|---|
| **P-무결정분** | 기록사본 PDF 헤더 날조 → 같은 파일의 `hospitalIdentity()` · 영문 영수증 `hospitalNameEn` 상수 → 설정 · 컨시어지·agent-session 프롬프트 → `getHospitalContext()`(진료시간은 정본에 없으면 말하지 않는다) | 없음(2026-09-11 착수) |
| P0 정본 접근자 | 서버 `getHospitalIdentity()`(필드별 출처 3상태·플레이스홀더 표시) · 공개 EP `GET /api/v1/public/hospital-identity`(화이트리스트) · 웹 `useHospitalIdentity()`(`hospital-contact.ts` 흡수 · 로딩 중 옛 이름 금지 · 미설정은 "기관명 미설정") | `identity.canonSource` |
| P1 법정 서식 | 발급 시 기관 정보 스냅샷(결정 시) → `DEV_HOSPITAL_PROFILE` 삭제 · 11 서식·DocHeader props · 웹 인쇄·API 문서·폴백 3상태화 | `identity.legalNameSplit` · `identity.documentSnapshot` · `identity.unsetIssuance` |
| P2 AI 프롬프트 잔여 | 고정 응답 대표번호 등 identity 에서 | P0 |
| P3 HIS 화면 | §2.2-A 전부 · i18n 키의 병원명을 보간(`<Tf>`)으로 | P0 · `identity.foreignNames` |
| P4 식별자 | rpName·TOTP·메일·인증서는 신규 발급분부터 | 대외 영향 확인 |
| P5 공개 사이트 | apps/homepage 44파일 · web (homepage) 그룹 · en/ja/zh | 주입 방식 결정 |

## 5. 가드(설계)

- `test/architecture/hospital-name-literal-guard.spec.ts` — `readdirSync` 재귀(🔴 `fs.globSync` 는 Node 22+) · 도메인·이메일·자산경로를 먼저 걷고
  표기 변형 정규식으로 셈 · **파일별 정확 기준선**(많아도 적어도 실패 · 고칠 때마다 낮춤) · 정당 잔존은 사유가 붙은 ALLOW 만 ·
  스캔 파일 수 하한 · 재주입 `<p>위루비병원</p>` 1건 잡힘 / 대조군 `x@hospital.example.org` 0건.
- 보조: `DEV_HOSPITAL_PROFILE` import 수 0 동결(P1 후) · `'Hospital RUN'` 폴백 동결.
