# 첫 상용 패키지 릴리즈 — 정리정돈·고정(Release Freeze) 기획

- 작성: 2026-09-13 · 상태: **Phase 1 CLI 몫 완료(2026-09-13 · §8 진행 결과) · Phase 0 사람 결정·Phase 2 RC 는 대기**
- 갱신: 2026-09-14 원장 교정 — §3 게이트 현재값 · §4 스냅샷 참고치 · T2-7·T3-3·T4-5·T9 · §8 남은 것 · **§8-신규 N1~N21** (코드 기준 `ef1dd424`)
- 근거: 읽기 전용 실측 3갈래(R1 버전·배포 · R2 패키지화 · R3 품질 게이트) — 수치마다 출처를 붙였다. ⚠ 는 추정.
- 기준 트리: `main` `08fe6869`(날짜 병행 3갈래 병합 직후) · 운영 `his.example.org` 은 **REHEARSAL** 모드 · 운영 DB 는 가상 병원 시드
- 관련: `go-live-cutover-command.plan.md` · `hospital-identity-canon.plan.md` · `docs/05-reference/real-mode-cutover.md` ·
  `service-launch-settings.md` · 결정 등록부 `/admin/decisions`

---

## 0. 한 줄

🔴 **지금 이 시스템은 "한 병원에서 운영되는 서비스"로는 동작하지만, "다른 병원에 설치해 파는 패키지"는 아니다.**
패키지가 되려면 세 가지가 고정돼야 한다 — ① **무엇을** 파는지(범위) ② **어떤 코드를** 파는지(버전·산출물)
③ **어떻게** 설치·업그레이드되는지(재현성). 셋 다 지금은 고정돼 있지 않다.

| 무엇이 안 고정돼 있나 | 실측 한 줄 | 출처 |
|---|---|---|
| 버전 | 표시 버전 `v4.19.0` 인데 `main` 은 그 뒤로 **20커밋 이상** · `package.json` 6개가 제각각(1.0.0·1.5.0·0.1.0) · git 태그는 **v3.46.0 에서 멈춤**(v4.* 0개) | R1 §1·§2 |
| 산출물 ↔ 커밋 | 배포 원천이 **로컬 working tree rsync** — 미커밋 변경도 나가고 커밋 해시 기록이 없다 | `deploy.sh:19` |
| 설치 | 운영 DB 에 `_prisma_migrations` **없음** · 스키마는 `db push` + 순서 불명 SQL 128개 · 약품 마스터는 수동 CSV | R1 §6 · R2 §2 |
| 기관 | 법정 서식 11종이 데모 요양기관기호 `WRB-DEMO-0001` · `hospital.*` 설정 키 18개 중 운영 DB 행 **6개** | R2 §1 |
| 범위 | 한국 전용 개념 `KR_ONLY` 2,081줄인데 국가 미결 · 기관 전송 7종(HIRA 청구 포함) **전부 미구현** | R2 §3·§5 |

---

## 1. Phase 0 — 무엇을 파는가(범위 선언) · 🧑 사람 결정이 먼저다

🔴 **범위가 안 정해지면 게이트가 정해지지 않는다.** 예: AI 임상 기능을 넣으면 SaMD 판단이 차단 게이트가 되고, 빼면 기능 끄기 목록이 게이트가 된다.
아래 결정은 **이 문서가 정본이 아니다** — 결정 등록부(`decision.registry.ts`)에 키로 등재한 뒤 이 표는 키만 가리킨다(CLAUDE.md §사람결정화면).

| # | 결정 | 선택지 | 무엇이 달라지나 | 등록부 상태 |
|---|---|---|---|---|
| S1 | **판매 국가** | KR 전용 / KR+AE | AE 는 개원 항목 48개뿐 — 청구·서식·보험자가 한국 규칙(국가 인지 파일 6 vs KR 전용 화면 68) | `country.institutionProfile` 있음(REQUIRED_BEFORE) |
| S2 | **배포 형태** | 고객 설치형(온프렘) / 운영 대행(SaaS·단일 테넌트) | 설치형이면 T2(설치 재현성)가 **차단**, 대행이면 권장 | `release.deploymentForm` 등재(2026-09-13 · 미결) |
| S3 | **AI 임상 기능 포함** | 포함 / 제외(끄고 판매) | 포함 시 SaMD·MFDS 판단 + WeRU.B 서버 의존이 차단 · 제외 시 켜진 6개 기능 끄기 | `policy.ai.clinicalFeatureScope` 있음 |
| S4 | **기관 전송 범위** | HIRA 청구 포함 / 제외(원내 기록만) | 한국 병원 상용에서 청구 전송 미구축은 치명적 — 제외 시 "청구 파일 생성까지"로 선언 | `release.externalTransmitScope` 등재(미결) |
| S5 | **EMR 인증 제품 여부** | 인증 취득 전제 / 비인증 | `/admin/emr-cert` 관제만 있고 취득 기록 없음 | `release.emrCertification` 등재(미결) |
| S6 | **첫 상용 버전 번호** | `v5.0.0`(권장 — 표시 버전 v4.x 와 끊는다) / `v1.0.0`(제품명 기준) | 태그·package.json·릴리즈 문서 번호 체계 | `release.versionScheme` 등재(미결 · 등록부는 권고하지 않는다) |
| S7 | **i18n 판매 언어** | ko 만 / ko+en(AI 초안 고지) | 사람 검수 **0**(14,227키 전량 AI 초안 · 2026-09-14 `claude-md-facts` 대조) — en 을 팔면 검수가 차단 | `release.saleLanguages` 등재(미결) |

---

## 2. 트랙 — 병행 가능하게 나눈다

각 트랙은 **파일 경계가 겹치지 않게** 잘랐다(병행 에이전트로 돌릴 수 있다). 🔴 = 차단 · 🟡 = 권장 · ⚪ = 후속.
"S1~S7 에 따라" 표시는 Phase 0 결정 뒤 차단 여부가 바뀐다.

### T1. 버전·릴리즈 고정 — 🔴 차단 · CLI

| # | 할 일 | 지금 | 산출물 |
|---|---|---|---|
| T1-1 | **버전 정본 하나로** — `HIS_VERSION`(shared) → 워크스페이스 `package.json` 6개 동기 스크립트 + 가드 | 1.0.0·1.5.0·0.1.0 제각각 | `scripts/sync-version.mjs` · 가드 |
| T1-2 | **git 태그 복구** — v4.0~v4.19 릴리즈 문서의 커밋에 사후 태그(정확한 커밋은 릴리즈 문서·메모리에서 대조) · 이후 릴리즈마다 태그 필수 | 마지막 v3.46.0 | 태그 · 태그 누락 가드 |
| T1-3 | **CHANGELOG** — 릴리즈 문서(108개)에서 상용 형식 요약 생성: 변경·호환성·마이그레이션·알려진 제한 | 없음 | `CHANGELOG.md` · 생성 스크립트 |
| T1-4 | 🔴 **산출물 ↔ 커밋 고정** — `deploy.sh` 가 ① dirty tree 거부(`--allow-dirty` 명시 시만) ② `git rev-parse HEAD` 를 산출물에 기록 ③ `/health` 가 버전+커밋 반환 | rsync·해시 기록 0 | deploy.sh · `BUILD_COMMIT` |
| T1-5 | **공개 버전 경로** — 외부에서 확인 가능한 `GET /api/v1/public/version`(버전·커밋·빌드 시각·운영 모드만 · 화이트리스트) | `/health` 는 웹 HTML · API 는 내부 `:4000` 만 | EP + 스모크 항목 |
| T1-6 | **릴리즈 이후 커밋 드리프트 가드** — "마지막 태그 이후 커밋이 있는데 버전이 같다"를 릴리즈 절차에서 잡는다 | `login-facts-freshness` 는 문서 번호만 봄 | 릴리즈 체크 스크립트 |

### T2. 설치·업그레이드 재현성 — 🔴 차단(S2=설치형) / 🟡(S2=대행) · CLI + 🧑 일부

| # | 할 일 | 지금 | 산출물 |
|---|---|---|---|
| T2-1 | 🔴 **migrate 기준선 도입** — 현 `schema.prisma` 를 `0_baseline` 마이그레이션으로 고정 · 운영 DB 에 `migrate resolve --applied` · 이후 스키마 변경은 migrate 만 | `_prisma_migrations` 없음 · `db push` | `prisma/migrations/0_baseline` · deploy `--schema` 경로 교체 |
| T2-2 | **수동 SQL 128개 분류·순서화** — ① 스키마 부속(MRN 시퀀스·GIN 인덱스·MV)은 마이그레이션으로 흡수 ② 백필은 버전별 1회성 스크립트로 이관 ③ 데모 시드는 T2-3 으로 | 순서 불명 혼재 | 분류 표 · 이관 |
| T2-3 | 🔴 **시드 3분할** — `seed-masters`(약품·KCD·수가 등 필수 마스터) / `seed-institution`(기관 초기값 — 빈 값으로 두고 T3 설치 체크가 막는다) / `seed-demo`(가상 병원 — **REAL 빌드에서 실행 불가**) | `seed.ts` 11,629줄·`seed-*` 38·`seeds/` 20 한 덩어리 | 분할 + 모드 가드 |
| T2-4 | 🔴 **필수 마스터 출처 고정** — 약품(심평원 약가마스터 CSV·버전일)·KCD 18,184(⚠ 저장소에서 원천 확인 못 함)·수가 419,024·검사 코드 — 각각 **출처·기준일·적재 스크립트**를 패키지에 동봉하거나 적재 절차 문서화 | 수동 CSV · KCD 원천 불명 | 마스터 매니페스트 🧑(데이터 라이선스) |
| T2-5 | **빈 DB 설치 스크립트** — 빈 PostgreSQL 16 → migrate → 부속 → 필수 마스터 → 기관 초기화 → 관리자 1명 생성 → REAL 모드 부팅 | 없음 | `infra/install/` · 리허설 설치 1회(Phase 2) |
| T2-6 | **의존성·Node 재현성** — 서버 빌드 `npm ci`(lockfile 강제) · `.nvmrc`=22 · `engines` `>=22 <23` · CI 도 22 | 서버 `npm ci` 없음 · Node 25/22/20/`>=20` 네 갈래 | deploy.sh · `.nvmrc` · ci.yml |
| T2-7 | 🔴 **CI 신호 복구** — ~~self-hosted 러너가 서버 이전 뒤 미실행~~ → 🔴 원인은 러너가 아니라 **워크플로 수동 비활성화**(`disabled_manually` 09-08 · `d8026f01`) · 실패 20회는 실제 테스트 실패(globSync·Node 20) · hosted 러너 전환·TZ=Asia/Seoul(`76920261`) | 수동 비활성화 · 재활성화 🧑 | ci.yml(배포는 넣지 않는다 — 규칙 유지) |
| T2-8 | ⚪ 업그레이드 절차 — `vN → vN+1`: 백업 → migrate → 1회성 백필 → 스모크 → 롤백 경로 | 정의 불가(이력 없음) | 업그레이드 가이드 |
| T2-9 | ⚪ DB 이식성(String[] 31·pg_trgm GIN 16·advisory lock 25) — **PostgreSQL 16 전용으로 선언**하고 넘어간다 | 메모리 `db_portability_audit` | 요구사항 문서 |

### T3. 기관 독립화 — 🔴 차단 · 🧑 결정 5건 뒤 CLI

| # | 할 일 | 지금 | 선행 |
|---|---|---|---|
| T3-1 | 🔴 **법정 서식 데모 상수 제거** — `DEV_HOSPITAL_PROFILE`(12파일 import) → 기관 정체성 정본 접근자 | `WRB-DEMO-0001`·`000-00-00000` | `identity.canonSource` · `legalNameSplit` · `documentSnapshot` · `unsetIssuance` |
| T3-2 | 🔴 **설치 필수 키 체크** — `hospital.*` 18키 중 필수(name·bizNo·ceo·code·license·country·address·phone·emergency·hours.*)가 비면 **법정 서식 발급·REAL 전환을 막는다**(go-live 게이트 신설) | DB 행 6개 · 나머지는 개발 기본값으로 떨어짐 | `identity.unsetIssuance` |
| T3-3 | **병원명 리터럴 회수** — api 3·web 67·shared 6·homepage 36(주석 포함) + 영문명 3가지 → 정본 경유 | 112파일 → 기준선 가드 **124파일·217건** 파일별 동결(2026-09-14 `c0335bdf` · 테스트·주석 제외 계측) · 회수는 `identity.*` 결정 뒤 | `identity.foreignNames` |
| T3-4 | **웹 상수 → 설정** — `lib/hospital-contact.ts`·`components/homepage/hospital-facts.ts` 가 설정을 읽게(공개 EP 필요) | 코드 상수 | T3-1 정본 접근자 |
| T3-5 | **배포 스크립트 서버 종속 변수화** — `deploy.sh` IP·경로 10곳 · `infra/scripts/*.sh` `/home/deploy` 16곳 → 설치 대상 환경 파일 | 한 서버에 박힘 | 없음(CLI 즉시 가능) |
| T3-6 | 🟡 제품명 — 모바일 `app.json` `"Hospital RUN"` · `'Hospital RUN'` 폴백 9곳 | 개발명 | 🧑 제품명 |

### T4. 보안 기본값 — 🔴 차단 · CLI 즉시 가능

| # | 할 일 | 실측 | 근거 |
|---|---|---|---|
| T4-1 | 🔴 **공개된 개발용 비밀 폴백 제거** — REAL 빌드에서 값이 없으면 **부팅 거부** | `PDF_SERVICE_TOKEN`·`PDF_RENDER_SECRET`·`DOC_DOWNLOAD_SECRET` 폴백 체인·`AI_PROVENANCE_SECRET` 4곳 | `document.service.ts:65,66,86` · `nursing.service.ts:105` |
| T4-2 | 🔴 **`NODE_ENV === 'production'` 안전 분기 7곳** → `HIS_MODE` 기준으로(운영에 NODE_ENV 가 없어 위험한 쪽으로 열린다) | 7곳 | 메모리 `env_gate_nodeenv_trap` |
| T4-3 | **`ALLOW_*` 느슨한 스위치 5종 — REAL 에서 거부** | `ALLOW_INSECURE_ENCRYPTION_KEY`·`ALLOW_INSECURE_COOKIES`·`ALLOW_DEV_VOUCHER_SECRET`·`IDENTITY_ALLOW_LOCAL_FAKE`·`APP_ATTEST_ALLOW_DEVELOPMENT` | `env.validation.ts:46` 외 |
| T4-4 | 🔴 **`.env.example` 전 키 문서화** — 필수/선택/기본값/비밀 여부 + **코드↔예시 기계 대조 가드** | 예시 8키 ↔ 코드가 읽는 42키 | R2 §4 |
| T4-5 | 🟡 백업 패스프레이즈 없으면 **평문 진행 → REAL 에서 거부** | 경고만 하고 평문(2026-09-14 재확인 · OPEN 유지) · 운영은 패스프레이즈가 있어 최근 정기 백업 4건 `.gpg`(읽기) · 파일 아카이브(`lib/backup-files.sh`)는 평문을 만들지 않음 | `backup.sh:51-52` |

### T5. 품질 고정(동결) — 🔴 차단 · CLI

| # | 할 일 | 지금 |
|---|---|---|
| T5-1 | 🔴 **릴리즈 게이트 체크 스크립트 하나로** — `scripts/release-gate.mjs`: tsc 3층 0 · 테스트 **전체 수**(api 는 include 기준 — `vitest run test` 함정 금지) · 부트 검증(`NestFactory.create`) · `next build` · 동결형 가드 전부 통과 · System Scale `--check` · 태그/버전 일치 · 워크트리 0 · dirty 0 | 항목이 CLAUDE.md·메모리·배포 스크립트에 흩어짐 |
| T5-2 | **릴리즈 스냅샷 파일** — 게이트 통과 시점의 수치를 `release-snapshot/v5.0.0.json` 에 동결(아래 §4 표) · 다음 릴리즈가 **비교 기준**으로 쓴다 | System Scale lock 만 있음 |
| T5-3 | **CLAUDE.md 낡은 수치 교정** — 안전 게이트 "wired 12"→**28** · 무결성 "67불변식"→**71**(조사 R3 의 76 은 interval 문자열까지 센 오답 — W4 재실측) · 펄스 "7지표"→**9** · web 테스트 "1,980"→**2,043** · 문서 "사람 결정 21"→**66**(Phase 0 등재 후) | 🔴 릴리즈 문서에 그대로 옮기면 거짓 |
| T5-4 | 계측 오염 차단 유지 — System Scale `.claude` 제외(`08fe6869` 완료) · 🔴 **동결은 워크트리 0 에서만** | 병행 작업 중 3,325 오염 실측 |
| T5-5 | 🟡 등록부 필드 모순 교정 — `identity.foreignNames` `dueBy=BEFORE_GO_LIVE` ↔ `goLive=CAN_FOLLOW` + 두 필드 일치 가드 | 1건 |

### T6. 정책 기본값·사람 결정 — 🔴 차단 · 🧑

| # | 할 일 | 실측 |
|---|---|---|
| T6-1 | 🔴 **개시 전 필수 결정 15건 기록** — 목록은 등록부 `goLive=REQUIRED_BEFORE`(=`dueBy=BEFORE_GO_LIVE` · 두 필드 일치 가드 신설) · 🔴 초판의 "16"은 두 필드를 섞은 수였다(`identity.foreignNames` 필드 모순 교정으로 15=15) | 15건 · 운영 DB 판정 상태는 ⚠ 미확인(09-08 기준 기록 0) |
| T6-2 | 🔴 **안전 게이트 상용 기본값** — 28종 중 **기본 OFF 18**. 특히 환자 확인 3(`nursing.bcma.enforce`·`bloodBank.bedsideScan.enforce`·`obgyn.newbornId.enforce`)·수술 안전 3 은 "설치 직후 꺼져 있음"을 제품이 **말해야** 한다 | `safety-gate.service.ts:331` |
| T6-3 | 판매본 개시 설정 — `dev.demoDateRoll=false` · 데모 픽스처 파기 · 음성 EMR·앰비언트·스크라이브 DECIDE | `service-launch-settings.md` §1 |
| T6-4 | 🟡 SMS 제공자 계약 + `legal.sms.entrustment`(환자 OTP 가 지금 로그에만 남는다) | 제공자 코드 없음 |

🔴 **T6-2 의 원칙**: 게이트를 기본 ON 으로 바꾸는 것은 제품 결정이지만, **어떤 기본값이든 "지금 꺼져 있다"를 설치 관리자에게 숨기지 않는다**(판정 규칙 §1 — P17 근거 없이 안심시킴). 설치 체크리스트·`/admin/safety-gates` 에 OFF 목록을 첫 화면으로.

### T7. 법무·규제 패키지 — 🔴 차단 · 🧑 + CLI 보조

| # | 할 일 | 실측 |
|---|---|---|
| T7-1 | 🔴 **LICENSE / EULA** — 루트 LICENSE 없음 · `"private": true` · 패키지 `license` 필드 0 | 🧑 |
| T7-2 | **서드파티 고지(NOTICE)** — 설치본 1,341 패키지: MIT 1,102 · Apache-2.0 125 · BSD 45 · ISC 42 · MPL-2.0 3 · LGPL(`sharp-libvips` 동적) · 강한 카피레프트 사실상 0 · UNKNOWN 1 | CLI 생성 가능 |
| T7-3 | 🔴 **참고 오픈소스 차용 실측** — CLAUDE.md 머리 "HospitalRun + EtherCIS + Medplum 참고" → 코드 차용분·라이선스 확인(⚠ 미확인) | CLI 실측 + 🧑 판단 |
| T7-4 | 🔴 **SaMD / 의료기기 판단** — S3 에 종속. 문서 6건이 경계를 서술하나 인허가 판단 기록 미확정 | 🧑 |
| T7-5 | ⚪ 개인정보·의료법 장치 목록을 **설치 요구사항 문서**로 — 감사 기본 ON · BTG · 신고자 보호 · 보존 · AI기본법 §31 표기(130파일) | 문서화 |

### T8. 문서 패키지 — 🔴 차단 · CLI

| # | 문서 | 지금 |
|---|---|---|
| T8-1 | 🔴 **고객 설치 가이드** — 요구사항(PostgreSQL 16·Redis 7·Node 22·PDF 렌더러) · T2-5 스크립트 · 필수 입력(T3-2) · REAL 전환 | `installation-guide.md` 는 **로컬 개발용**이라고 스스로 밝힘 |
| T8-2 | **운영 매뉴얼** — 백업·복원·키 로테이션(`rotate-encryption-key.mjs`)·업그레이드(T2-8)·감시자·안전 게이트 | `production-operations.md` 는 단일 서버 기준 |
| T8-3 | **상용 릴리즈 노트 형식** — 현 릴리즈 문서(서술형·"무엇이 틀렸나")에 호환성·마이그레이션·설치 요구사항·**알려진 제한** 절을 추가한 템플릿 | 형식에 없음 |
| T8-4 | 🔴 **알려진 제한 목록**(판매 문서에 명시) — 아래 §5 | 흩어짐 |

### T10. 국가별 의료정보 보존·아카이빙 — 🔴 차단(실운영) · 🧑 결정 선행 + CLI

2026-09-13 사용자 지적("각 나라별 의료정보 보호기준에 따른 별도 아카이빙 기능이 빠졌다")을 실측으로 확인했다. **맞다.**
🔴 저장소 규칙: 법령 수치·조문은 레지스트리·시드에 박지 않는다 — 아래는 기획 근거이고, 구현은 **기관 설정 + 출처 URL + `legalConfirmed`** 로 둔다.

**있는 것** — 보존/파기 **틀**(`modules/retention` · `RetentionPolicy` · DRY-RUN · 3중 게이트 · 4-eyes 파기 승인) · 삭제 방어(환자 soft delete · 임상기록 있는 외국인 환자 하드 삭제 거부 · 스크라이브 `legalHold`) ·
감사 해시체인(`audit.service.ts:87`) · 열람 기록 환자 귀속 · 정기 백업 매일 03:00 `.gpg`(운영 실측 09-11~13).

| # | 빠진 것 | 실측 | 기준(출처) |
|---|---|---|---|
| T10-1 | 🔴 **아카이빙 자체가 없다** — 보존기간 경과 후 동작이 파기/익명화뿐이고, 운영 DB 에서 떼어 **별도 저장소로 옮겨 보존**하는 경로가 코드에 0. v3.16.0 부터 "G4 감사 아카이빙(S3)"으로 계획·이연만 반복 | `retention.service.ts:76` 주석 "파기 대신 아카이빙(G4) 대상. 여기선 count만" · `RELEASE-v3.16.0.md:56`·`v3.33.0.md:36` | — |
| T10-2 | 🔴 **국가 차원이 없다** — `RetentionPolicy` 에 국가 필드 없음 · 운영 `hospital.country` 행 없음 · 운영 정책 5건 값이 한국 기준(3650·1825·730일)이고 **전부 `legal_confirmed=false`** | 운영 DB `retention_policy` 5행 | KR: [의료법 시행규칙 제15조](https://www.law.go.kr/lumLsLinkPop.do?lspttninfSeq=61681) · UAE: [Federal Law No.2/2019](https://www.lw.com/en/insights/2019/06/new-uae-law-regulates-healthcare-data) Art.20 **마지막 진료일로부터 최소 25년**(2차 출처) — 기간뿐 아니라 **기산점이 다르다** |
| T10-3 | 🔴 **보존 대상 분류가 법정 분류와 다르다** — 정책 4종(MEDICAL_RECORD·PRESCRIPTION·CONSENT_FORM·AUDIT_LOG) ↔ 시행규칙 제15조 9종(환자명부 5·진료기록부 10·처방전 2·수술기록 10·검사소견 5·방사선사진/소견서 5·간호기록부 5·조산기록부 5·진단서 부본 3년). 수술·간호·검사·영상·진단서 부본 구분 없음. 🔴 **MEDICAL_RECORD·PRESCRIPTION·CONSENT_FORM 은 핸들러 자체가 없어** 세지도 않는다 | `retention.service.ts` `handlers()` = AUDIT_LOG·SMART_ACCESS_LOG(count)·PRE_BOARD_ACCOUNT | 위 제15조 |
| T10-4 | 🔴 **데이터 소재지(residency) 제어 0** — 저장 위치·국외 이전 판정 코드 0파일. 국외로 나갈 수 있는 경로: FCM 푸시(Google) · 외부 AI(결정 `legal.aiEgress.transferScope`) | grep `residency·국외 이전·cross-border` 0 | UAE 국내 저장·처리 원칙 + 예외 10종 · 아부다비 ADHICS 클라우드 제한 · 두바이 별도 정책([trade.gov 2024-01](https://www.trade.gov/market-intelligence/united-arab-emirates-regulations-limit-cross-border-health-data-flows)) |
| T10-5 | 🔴 **백업은 아카이브가 아니다** — 백업 파일이 **DB 와 같은 디스크**(`/dev/nvme0n1p2`) · 네트워크 연결 상태 · 보관일 지나면 삭제(`backup.sh:54`) · 원격/오프라인 복사 없음 | 운영 `df` 실측 | 시행규칙 제16조 "네트워크에 연결되지 아니한 백업저장시스템"(⚠ 2차 출처 · 원문 미대조 — law.go.kr 조회 필요) · [시설·장비 기준 고시](https://law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000232676) |
| T10-6 | 🔴 **휴·폐업 이관 경로 없음** — 폐업 시 진료기록부 등을 보건소장에게 넘기거나 진료기록보관시스템으로 전자 이관. 기관 전체를 표준 형식으로 반출하는 경로가 없다(사본 발급은 환자 단위) | `medical-record-copy` 환자 단위 · `PatientBulkExport` 는 감사 리소스명만 확인(목적 미확인) | [의료법 제40조·제40조의2](https://casenote.kr/%EB%B2%95%EB%A0%B9/%EC%9D%98%EB%A3%8C%EB%B2%95/%EC%A0%9C40%EC%A1%B0%EC%9D%982) · [복지부 이관 고시](https://mohw.go.kr/board.es?act=view&bid=0026&list_no=1484899&mid=a10409020000) |
| T10-7 | 법적 보존명령(legal hold) — 스크라이브 세션 1곳뿐. 진료기록 전반에 소송·분쟁 보존 표시 없음 | `scribe.service.ts:221` | — |
| T10-8 | 접속기록 보존 — 제16조 개정으로 **열람 기록도** 별도 보관(보관 기간은 고시 확인 필요) · 우리 감사 로그 정책은 `AUDIT_LOG` 1095일(법정 클램프 365)·파기 핸들러 없음 | 운영 정책 행 | [간호사신문(개정 보도)](https://www.nursenews.co.kr/news/articleView.html?idxno=44048) |
| T10-9 | ⚪ 영상(방사선사진 5년)은 OpenPACS 소관 — HIS 보존 정책이 닿지 않는다(범위 선언 필요) | CLAUDE.md PACS 분리 | 제15조 |
| T10-10 | 🟡 작은 정직성 결함 — `/admin/retention` 정책 목록이 **핸들러 없는 정책에 "후보 0건"** 을 그린다(`report()` 가 미지원도 `lastCandidates=0` 저장 · 운영 5행 전부 0) | `admin/retention/page.tsx:158` ↔ `retention.service.ts` report | 판정 규칙 §1 P1 |

**🧑 사람 결정(등록부 등재 필요)** — ① 국가 프로파일(S1 선행) ② 기록 종류별 보존 기간·기산점 **법무 확정**(`legalConfirmed`) ③ 아카이브 저장소 형태(원내 오프라인 매체 / 원내 별도 서버 / 국내 클라우드 — UAE 는 국외 불가) ④ 보존 경과 후 처리(파기 / 익명화 / 계속 보존) ⑤ 휴·폐업 이관 형식.

**CLI 설계 방향(결정 뒤)** — 국가 프로파일별 보존 규칙표(기관 설정 · 출처 URL · 확정 여부) → 기록 종류를 법정 분류로 매핑 → 아카이브 작업(운영 DB → 암호화·해시 매니페스트·WORM/오프라인 대상 · 원본 삭제는 검증 후 4-eyes) → 아카이브 조회·복원 경로 → 휴·폐업 이관 반출 → 소재지 판정(국외 전송 경로 목록화·차단) → 가드(보존기간 안쪽 파기 0 · 국외 경로 0 · 아카이브 해시 재검증).

**✅ 결정 전 가능분 완료(2026-09-13 · 병행 4갈래 A1~A4 + 본선 연결)** — 🔴 차단(국외 전송 막기·보존 경과 후 파기·아카이브 이동)은 결정 뒤. 이번엔 **보이게 하고 동결**까지.

| 항목 | 한 것 | 남은 것 |
|---|---|---|
| T10-10 | `/admin/retention` 이 핸들러 없는 정책을 "후보 0건" → `null`·"세지 않음(핸들러 없음)" | — |
| T10-3 | 법정 기록 종류 어휘 `retention-record-kinds.ts`(KR 9종·AE 1종 · **기간 값 없음** · 출처 `sourceVerified=false`) · KR 6종 모델 매핑 · 3종 법무 확인 필요(방사선 사진 원본·조산기록부·진단서 부본) · 임상 3종 **집계 핸들러**(파기 없음) · 🔴 기산점 결정 대기라 **작성일·마지막 진료일 두 기준 모두** 집계 · `GET /api/v1/retention/legal-kinds` | 기간·기산점 법무 확정 🧑 |
| T10-7 | `LegalHold`·`LegalHoldRelease`(append-only · DB 트리거 · 해제 4-eyes·사유 필수 · 조회 실패 fail-closed) · `/admin/legal-hold`(3412) · 🔴 **파기 입구 연결**: 환자 귀속 파기 핸들러는 보존명령 제외를 선언하지 않으면 거부 · 조회 실패 시 거부 | 스크라이브 `legalHold` 불리언 통합 판단 |
| T10-4 | 외부 전송 경로 전수 스캔 **63 호출·33 경로**(PHI 14 · 가명 2 · 비PHI 11 · 불명 6) → `egress-inventory.ts` 정본 + `/admin/outbound-channels` "외부 전송 경로" · 🔴 미등재 새 외부 호출·등재 코드 소멸 시 실패하는 가드 · 원외 고정 호스트 PHI/불명: `email.resend`(PHI)·`push.fcm`(불명 — 자유 문구) | 국가별 허용/금지 판정 🧑(S1) · env 목적지 운영값이 원내인지 확인 🖥 |
| T10-5 | `backup-copy.sh`(암호문만·sha256 대조·**대상 없으면 매번 "2차 사본 없음"**·같은 장치 사본은 2차로 인정 안 함) · `backup-verify.sh`(무결성 기본·복원은 임시 DB 만·운영 URL 거부) · `backup-status.json` · 감시자 파이프 2항목(상태 파일 없으면 **관측 불가**) | ✅ 서버 동기화·1회 실행 확인(09-13 10:43 · 상태 파일 `NOT_CONFIGURED`·무결성 PASS CREATE TABLE 564) · 🔴 이후에도 배포가 `infra/scripts` 를 안 보낸다 · 사본 대상 매체 🧑(③) · 복원 검증 크론 · ~~업로드 파일은 어느 백업에도 없다~~ → 파일 아카이브(`e8a0a9d4`)·감시자 `filesArchive`(`f1ecddc2`) 코드 완료 · 서버 반영은 실운영 전환 때(개발 중 생략 결정) |
| T10-6 | `record-transfer-inventory.md` — 🔴 `PatientBulkExport` 는 이관 경로가 아니다(명부 일부 열 CSV·5,000명 절단·진료기록 0) · FHIR `$export`·`$everything` 없음 · 형식 후보 A~E 별로 빠지는 것 | 이관 형식 🧑(⑤) |

### T9. 진행 중 작업 마감(정리정돈) — 🟡 · CLI

코드 동결 **전에** 닫거나, 닫지 않을 것은 "알려진 제한"으로 옮긴다. 🔴 **동결 이후에 이 목록을 계속 줄이지 않는다**(RC 이후 변경은 §6 규칙).

| 항목 | 지금 | 처리 |
|---|---|---|
| 날짜 원시 호출 잔여 | ~~파일 27 · 호출 87(`08fe6869`)~~ → 호출 기준선 **15**(`date-locale-literal-guard.spec.ts:85` · `b4217937`) · 초 단위·두 자리 연도 모드 신설(`1664c0ae`) · ko 오전/오후 정본(`95a91ca9`) | 남은 15 회수 또는 알려진 제한 |
| i18n 배선 0 화면 | 141 = (homepage) 61 · tablet 23(결정 대기) · display 7 · print 5 · onboarding 5 · 기타 27 · 🔴 ext 위젯 13 은 스캐너 오탐 | S7 결정에 따라 |
| 포털 `timeAgo`(`방금 전`·`N분 전`) 미번역 | F3 발견 | 회수 |
| 수가 영문명(`ProcedureCode` 에 `nameEn` 컬럼 없음 · `ProcedureFee` 95.8%) | 스키마 결정 | S7=ko 면 알려진 제한 |
| 마취 마스터 코드(GA/SA ↔ 저장 GENERAL/한글) | 마이그레이션 | 알려진 제한 |
| 시설 정보 예시값 | 주차·식당·장례식장은 CMS 공개 행 3상태(`9e43e96b`) · 예약 챗 근거 없는 위치·시간 제거(`76772a66`) · 포털 기본 공지 상수 제거(`3d215b12`) · **층별 안내 예시·직원 식당 운영시간/가격만 남음** | 🧑 D15(`policy.facilityInfo.floorGuide` 초안) |
| 공개 사이트 SSM 문서 · Jitsi `/meet` · `/pacs-api/` 404 | 인프라(HIS 코어 밖) | 판매 범위 밖으로 선언 |

---

## 3. 릴리즈 게이트 — 통과해야 RC 태그를 붙인다

`scripts/release-gate.mjs`(T5-1)가 기계로 판정할 것과 사람이 서명할 것을 **가른다**(판정 규칙 — 기록 ≠ 적용 · 자가신고와 실검증을 합치지 않는다).

| 게이트 | 판정 | 기계/사람 | 현재 |
|---|---|---|---|
| G1 범위 선언 S1~S7 등록부 기록 | 기록됨 7/7 | 🧑 | 0/7 |
| G2 개시 전 필수 결정 15건 기록 | 기록됨 15/15 | 🧑(기계가 셈) | ⚠ 미확인 · 🔴 등록부 개시 전 필수가 **31건**으로 늘었다(2026-09-15 사람 결정 60건 등재 · `claude-md-facts --json` `decisions.requiredBefore`) — 판정 기준을 31 로 다시 셀지는 🧑 |
| G3 tsc 3층 0 · 전체 테스트 통과(수치 스냅샷) | 0 오류 · 실패 0 | 기계 | api 12,135(114 skip) · web 2,232 · shared 344 · tsc 3층 0(2026-09-15 병합 트리 `acb70464`) |
| G4 부트 검증 + `next build` 성공 | 성공 | 기계 | G4-boot 로컬 PASS(2026-09-15 `acb70464` 트리 · `ALLOW_DEV_VOUCHER_SECRET=true HIS_MODE=DEV` — node 직접 실행은 `.env` 미로드) · `next build` 는 운영 배포 빌드(`acb70464` 배포)로 확인 |
| G5 동결형 가드 62종 전부 통과 | 실패 0 | 기계 | ⚠ 62 는 키워드 근사 |
| G6 System Scale `--check` · 워크트리 0 · dirty 0 | 일치 | 기계 | scale PASS · worktree·dirty FAIL(2026-09-15 `--quick` — 병행 워크트리 5·측정 워크트리의 링크 · 본선에는 세션 밖 untracked 1 `docs/ecosystem-notice-2026-09-14.md`) |
| G7 버전 정본·package.json·태그·CHANGELOG 일치 | 일치 | 기계 | PASS(버전·CHANGELOG) — 태그는 G8 |
| G8 산출물 커밋 해시 = RC 태그 커밋 | 일치 | 기계 | 산출물 커밋 기록 있음(배포 `BUILD_INFO` · 설치 3상태 `25bd6542`) · HEAD 태그 없음 FAIL(번호 🧑 `release.versionScheme`) |
| G9 migrate 기준선 · 빈 DB 설치 리허설 1회 성공 | 성공 + 스모크 29 | 기계 + 🧑 확인 | ⚠ 로컬 컨테이너 리허설 성공(2026-09-14 · API 까지 · §8 G9) · 🧑 실제 서버 확인·스모크 29·웹 빌드 미완 |
| G10 보안 기본값 T4-1~4 · REAL 빌드에서 개발 비밀 부팅 거부 | 거부됨 | 기계(재주입) | PASS — 재주입 기록 `424d1902`·`0a218fb4`·`8f09574b`·`2796b189`(alias·재수출) |
| G11 법정 서식 데모 상수 0 · 필수 기관 키 체크 동작 | 0 · 차단 동작 | 기계 | ❌ `WRB-DEMO-0001` |
| G12 REAL 산출물 시드 문자열 0(`real-mode-cutover.md` §3) | 0건 | 기계 | `release-gate.mjs --artifact apps/web/.next,apps/api/dist` · 바늘은 시드 로그인 정본 파생 · 🔴 첫 실행 FAIL 10 → 누수 2건 교정(`3203b1cd`) → **재실행 FAIL 3**(웹 0 · API 시드 생년월일 2 · Clinic 공용 비밀번호 1 — `34ddb26d` · 아래 §8) → R6 시드 데이터 분리 후 **api 산출물 FAIL 1**(Clinic 공용 비밀번호 — 결정 대기 `policy.integration.clinicAccountIssuance` · 웹은 재빌드 안 함) |
| G13 LICENSE·NOTICE·EULA · SaMD 판단(S3 종속) | 존재 · 서명 | 🧑 | ❌ |
| G14 고객 설치 가이드·운영 매뉴얼·알려진 제한 | 존재 | 🧑 검토 | 문서 존재 · 🧑 검토 미완 |
| G15 CI 가 RC 커밋에서 초록 | 성공 | 기계 | ❌ 원인: 워크플로 수동 비활성화(`d8026f01`) · 재활성화·과금 확인 🧑 |

🔴 **게이트가 초록인 이유를 확인한다** — 판정 규칙 §3: 통과하는 가드가 아무것도 보증하지 않을 수 있다. G5·G10·G11·G12 는 **재주입으로 실패하는 것을 확인한 기록**이 있어야 통과로 센다.

---

## 4. 릴리즈 시점에 스냅샷으로 고정할 수치

RC 태그 커밋에서 `release-snapshot/<버전>.json` 에 동결한다(T5-2). **지금 값은 참고치**다 — 동결은 워크트리 0·dirty 0 에서만.

| 축 | 항목 | 현재(2026-09-15 `acb70464` · 참고치) | 출처 |
|---|---|---|---|
| 테스트 | web · shared · api | 2,232 · 344 · 12,135(114 skip) | 병합 트리 실행 |
| 테스트 파일 | web · api(include) | 237 · 942 | `system-scale.lock.json` |
| 가드 기준선 | 날짜 정본 미사용 파일 · 원시 호출 | 26 · 15 | `clinical-ux-rules.spec.ts:101` · `date-locale-literal-guard.spec.ts:85` |
| 〃 | 쓰기 버튼 44px 미달 | 328 | `clinical-ux-rules.spec.ts:224` |
| 〃 | 인라인 @Body | 359 | `inline-body-dto-guard.spec.ts:267` |
| 〃 | 서버 조립 한국어 문장 | 1,797 | `server-composed-display-text.spec.ts:78` |
| i18n | 코어 키 · 사람 검수 · 배선 0 화면 | 14,417 · **0** · 141(09-13 값 · 미재측) | `claude-md-facts --json` `i18n.coreKeys` · 스캐너 |
| 안전 | 게이트 wired · 기본 OFF | 28 · 18 | `safety-gate.service.ts:331` |
| 감시 | 무결성 불변식 · 실시간 펄스 | 75 · 9 | `data-integrity-scan.sql` · `pulse-registry.ts` |
| 결정 | 등록부 · 개시 전 필수 · `release.*` | 126 · 31 · 6 | `decision.registry.ts` + 증분 `decision.registry.batch-2026-09-{a,b,c}.ts`(`claude-md-facts --json` `decisions.*`) |
| 규모 | Prisma 모델 · API EP · SSE | 567 · 3,286 · 16 | `node scripts/system-scale.mjs`(lock 2026-09-15) |
| 규모 | System Scale 표 전체 | lock 2026-09-15 | `scripts/system-scale.lock.json` |
| 의존성 | 설치 패키지 · 라이선스 분포 | 1,341 · §T7-2 | R2 §6 |

---

## 5. 알려진 제한 — 판매 문서에 명시할 것(초안)

🔴 **모르는 것을 아는 척하지 않는다**는 판정 규칙이 판매 문서에도 적용된다. 아래는 S1~S7 결정에 따라 빠지거나 더해진다.

1. **UI 번역은 전량 AI 초안이다**(사람 검수 0 · 화면에 AI 초안 표식이 붙는다). 태블릿 23화면은 안전 문구 결정 전까지 한국어.
2. **기관 전송 7종(HIRA 청구·감염병 신고 등)은 원내 기록까지**이며 외부 기관으로 전송하지 않는다(`LOCAL_RECORDED`).
3. **SMS 발송 미지원**(제공자 계약 전) — 환자 OTP 등은 대체 경로 필요.
4. **안전 게이트 18종은 설치 직후 꺼져 있다** — 기관이 켜야 한다(목록 동봉).
5. **한국 의료 제도 전용**(S1=KR 이면) — 청구·서식·보험자 규칙.
6. **PostgreSQL 16 전용**(배열 타입·pg_trgm·advisory lock).
7. 수가 명칭 영문 표기 없음 · 마취 마스터 코드 체계 불일치 · 시설 안내는 기관 입력 전 예시값.
8. 영상(PACS)·화상 진료(Jitsi)·AI 서버(WeRU.B)·PDF 렌더러는 **별도 구성 요소**.

---

## 6. 단계와 코드 동결 규칙

| Phase | 내용 | 병행 | 끝나는 조건 |
|---|---|---|---|
| **0 범위 선언** | S1~S7 등록부 등재·기록 | 🧑 | G1 |
| **1 동결 전 정리** | T1·T2·T3(결정분)·T4·T5·T8 · T9 마감 | 🔀 트랙별 병행(파일 경계 분리) | G3~G12 기계 게이트 초록 |
| **2 RC** | `release/v5.0` 브랜치 · `v5.0.0-rc.1` 태그 · **빈 서버에 설치 리허설** · REAL 모드 부팅 · 스모크 | 🧑 확인 | G9·G13·G14·G15 |
| **3 GA** | `v5.0.0` 태그 · 스냅샷 동결 · CHANGELOG · 릴리즈 노트 · 운영(REHEARSAL) 반영 여부는 별도 | 🧑 서명 | 전 게이트 |

**코드 동결 규칙(RC 이후)**
- `release/v5.0` 에는 **게이트를 깨는 결함 수정만** 들어간다(기능·리팩터링·i18n 확장·기준선 감축은 `main` 으로).
- 수정은 `main` 에 먼저 커밋 → `release/v5.0` 으로 cherry-pick → `rc.N+1` 태그 → 게이트 재실행.
- 🔴 **배포는 태그에서만** — RC 이후 `deploy.sh` 는 태그 체크아웃 트리가 아니면 거부(T1-4 확장).
- 운영 `his.example.org`(가상 병원·REHEARSAL)은 개발 계속 반영 대상이며 **판매 산출물과 분리**한다.

---

## 7. 이 기획이 하지 않는 것

- 범위 결정(S1~S7)을 대신하지 않는다 — 선택지와 결과만 적었다(판정 규칙 §6 "시스템은 권고하지 않는다" · 단 S6 은 번호 체계 기술 판단이라 권장을 표시).
- 법률·인허가 판단(LICENSE 조항·SaMD·EMR 인증)을 하지 않는다.
- 운영 DB(가상 병원 시드)를 정리하지 않는다 — 판매본은 T2-3 의 빈 설치에서 출발한다.
- 기관 정체성 P0~P5 의 설계는 `hospital-identity-canon.plan.md` 가 정본이다(여기는 게이트로만 참조).

## 부록 A. 조사 실측 원문

세션 조사 R1(버전·릴리즈·배포) · R2(패키지화) · R3(품질 게이트) — 수치·파일:줄 근거는 위 표에 옮겼다.
조사 중 드러나 **즉시 고친 것**: System Scale 이 병행 워크트리(`.claude/worktrees`)를 세서 `orphanTestFiles` 가 0 → 3,325 로 오염되던 계측 결함(`08fe6869`).

---

## 8. 진행 결과 — Phase 1 CLI 몫(2026-09-13 · 병행 6갈래 병합)

🔴 **"CLI 몫 완료"는 "릴리즈 가능"이 아니다.** 사람 결정·서명·서버 리허설이 남아 있고, 그것들은 코드로 대신할 수 없다.
검증: 병합 트리 **api 11,561(114 skip) · web 2,052 · shared 344 · 실패 0 · tsc 3층 0** · System Scale `--freeze`(2026-09-13 · 21지표 일치) · 모든 갈래 재주입 역검증 기록 있음.

| 트랙 | 한 것 | 산출물 | 남은 것(🧑=사람 · 🖥=서버) |
|---|---|---|---|
| T1 버전 | 버전 정본 동기(package.json 6 + lock) · 태그 매핑(특정 11·문서기준 10) · CHANGELOG v4.0~v4.19 · deploy.sh dirty 거부·`BUILD_INFO.json`(빌드 확인 후 기록)·lock 지문·Node 22 확인 · `GET /api/v1/public/version` | `sync-version.mjs` · `tag-releases.mjs` · `CHANGELOG.md` · `release-freeze-guard.spec.ts` | 문서기준 태그 10건 적용 판단 🧑 · 버전 번호 `release.versionScheme` 🧑 |
| T2 설치 | migrate 기준선(테이블 562·인덱스 1,039·외래키 566) · 🔴 migrate 가 **원래 끝까지 못 도는 구조**였던 것 3건 교정 · 기준선에서 빠지던 정합성 객체 마이그레이션(ER 베드 동시 배정 방지 유니크 — **SQL 파일이 아예 없었다**) · SQL 129 분류 · 시드 진입점 49곳 REAL 가드 · `install.sh` · `.nvmrc` 22 · CI hosted 러너 | `migrations/00000000000001_baseline`·`20260913000001_ancillary_constraints` · `sql-inventory.md` · `infra/install/` · `install-reproducibility.spec.ts` | 🖥 **운영 적용 순서**: 백업 → `migrate diff --from-url` → 부속 객체 대조·중복 GIN 판단 → ~~`migrate resolve --applied` 4건~~ → 🔴 **2026-09-14 판정 도구(`18c22a47`) 결과 APPLIED 는 baseline·legal_hold 만** · PARTIAL 3(mrn 시퀀스·gin 11·ancillary 4)은 결정(D11·D12) 선행 · 09-14 SQL 직접 적용 2건(진단검사 전이·위급값 상태)도 이력 없음 → **그 뒤에** `deploy.sh --schema` 를 `migrate deploy` 로 · 🖥 G9 빈 서버 설치 리허설 · KCD·수가·검사 마스터 원천 확인 🧑 · 시드 3분할(미착수) |
| T3-2·T3-5 | go-live `data.hospitalInfo` 를 DB 행 기준 DB_PROBE 로(필수 13·선택 5 · 가짜 기본값 행은 입력으로 안 셈) · deploy/backup/postgres-watch 서버 종속 → `deploy.env`(없으면 종전 값) | `go-live.registry.ts` · `deploy.env.example` | T3-1·3·4 는 `identity.*` 결정 5건 뒤 🧑 |
| T4 보안 | REAL 부팅 거부(공개 비밀 폴백·개발 스위치 6·all-zeros 키) · `NODE_ENV` 실행 분기 0(쿠키 secure·Swagger·오류 details → 모드 기준) · `.env.example` **92키**(api 82·web 10) + 코드 대조 가드 | `common/release-security.ts` · `env-keys-scan.mjs` · 가드 3종 | 🔴 **REAL 전환 전 `ENCRYPTION_KEY` 로테이션**(과거 운영 키 all-zeros) · `DOC_DOWNLOAD_SECRET`·`AI_PROVENANCE_SECRET` 운영 미설정 · ~~web `api/revalidate/route.ts:6` 공개 폴백 1건~~ 제거(`424d1902`) |
| T5 품질 | `release-gate.mjs`(기계 게이트 15 · SKIP≠PASS · `--snapshot` 은 전 PASS 일 때만) · CLAUDE.md 낡은 수치 교정 · 등록부 goLive↔dueBy 일치 가드 · System Scale 동결 | `release-gate.mjs` · `release-gate.spec.ts` | 스냅샷은 RC 에서 |
| T6·Phase 0 | 결정 등록부 **66**(`release.*` 5건 등재 · 권고 없음 · 개시 필수로 올리지 않음 — 막는 것은 판매 게이트지 이 기관의 개시가 아니다) | `decision.registry.ts` | S1~S7 결정 🧑 · 개시 전 필수 15 🧑 · 안전 게이트 기본값(OFF 18) 🧑 |
| T7·T8 문서 | 서드파티 고지(lock 1,808 · 배포물 기준 LGPL 14·MPL 12·선택형 GPL 1·강한 카피레프트 0) · OSS 차용 흔적 조사(`schema.prisma:491` EtherCIS 주석 1건 · 이름 지운 복사는 grep 으로 증명 불가) · 설치 가이드·운영 매뉴얼·알려진 제한 28·릴리즈 노트 템플릿 | `THIRD-PARTY-NOTICES.md` · `NOTICE` · `docs/05-reference/{customer-install-guide,operations-manual,known-limitations,oss-provenance-audit}.md` | LICENSE·EULA 🧑 · 초기 코드 출처 확인 🧑 · SaMD·EMR 인증 🧑 · 백업 복원 확인 여부가 문서끼리 모순(운영 매뉴얼에 기록) |
| T9 마감 | 날짜 원시 호출 **파일 26 · 호출 31**(시작 시 75·163) · 초 단위·두 자리 연도 모드 · 포털 날짜 정본·알림 경과 번역 | `ui-settings.tsx` · `portal-date.ts` · 가드 | display·(homepage)·print 축 결정 대기 |

**🔴 이 라운드가 드러낸 운영 결함(이미 고침)**
- `deploy.sh` 감시자 재시작이 `${PM2_ENV} pm2 describe && pm2 restart` 모양이라 **환경 변수가 describe 에만 붙었다** — 운영 실측 his-api `HIS_MODE=REHEARSAL` ↔ his-sentinel **없음**. restart·start 양쪽에 붙이고 실패를 가리던 `|| pm2 start` 폴백 제거.
- System Scale 이 병행 워크트리를 세서 고아 테스트 0 → 3,325 오염.
- 병행 갈래가 각자 자기 트리 실측으로 기준선을 박아 병합 순간 틀림 — 기준선은 합친 트리에서 한 번만 잰다.

**다음 순서(권장)**: ① Phase 0 결정(`/admin/decisions` `release.*`) 🧑 → ② 운영 DB migrate 표시(위 순서 · 🖥) → ③ 빈 서버 설치 리허설 G9 🖥 → ④ `release-gate.mjs` 전 PASS → ⑤ `release/v5.0` 브랜치·RC 태그.

**G9 로컬 컨테이너 리허설(2026-09-14) · 결과 · 🧑 사람 확인 미완** — `node:22-bookworm`(8GB) · `postgres:16-alpine` · `redis:7-alpine` · `git archive HEAD` 사본으로
고객 설치 가이드대로 진행. **빈 DB → install.sh 7단계(REAL 부팅 · 서버 응답 `mode=REAL`)까지 약 2분 성공**(병합 트리 `d3391ec1` 기준 재실행 포함 3회).
멈춘 곳 10건을 스크립트·가이드에 반영(`customer-install-guide.md` §7.1) — 🔴 가장 위험했던 것: 부팅 확인이 **앞 실행의 고아 API 응답을 성공으로 읽었다**
(서브셸 `$!` 라 kill 이 node 를 못 죽임 · 새 서버는 EADDRINUSE 로 사망) → 포트 선점 거부·생존 확인 추가, 포트 점유 재현으로 거부 확인.
REAL 부팅 거부(all-zeros 키 · PDF 비밀 4종 미설정)는 실부팅으로 확인. 🔴 **G9 로 세지 않는 것**: 실제 빈 서버 아님 · 마스터는 합성 3행 CSV(진단·수가·검사 빈 상태) ·
웹 `next build` 는 8GB 에서 137 강제 종료(미성공 · 이후 컨테이너 한도 실측 **6GB·힙 3~6GB 성공**·설치 스크립트 가용 메모리 판정 `3e36d515` · 8GB 137 원인은 미확인) · 설치 환경 스모크 29 미실행 · ~~설치 경로는 `BUILD_INFO.json` 을 만들지 않는다~~ → 3상태 기록(`25bd6542` · 재리허설에서 `commitSource: release` 확인).

**G12 첫 실제 실행(2026-09-14 · 로컬 REAL 상한 빌드) · 결과 FAIL 10 · 앱 코드 몫** — 종전 G12 는 수기 바늘 3개였고 `--artifact` 를 준 적이 없어 한 번도 돌지 않았다.
바늘을 시드 로그인 정본(`lib/test-accounts.ts` 이메일 전부 · `lib/test-patients.ts` 생년월일 · `.env.development` 딜러 계정 — REAL 빌드가 stub 으로 치환하는 모듈)에서 **파생 88종**으로 바꾸고
(`TEST_PASSWORD` 는 관리자 초기 비밀번호 기본값과 같은 문자열이라 사유와 함께 제외) · `.next/cache`·소스맵 제외 수 기록 · `BUILD_ID` 없는 `.next` 는 판정 거부 · 못 읽은 파일은 FAIL.
웹 `NEXT_PUBLIC_HIS_MODE` 미설정(=REAL) `next build` 131초(16GB 로컬 · 부모 RSS 2.9GB) · api `nest build`. 적중:
- 🔴 **(a) 웹 번들 누수 8** — `app/(main)/crm/page.tsx:137-153` 'CRM 테스트 계정' 카드가 **조건 없이** CRM 시드 계정 4개와 `비밀번호: Password1234! (테스트용)` 을 그린다(서버·클라이언트 청크 양쪽). 스태프 로그인 후 도달 가능 · stub 치환 대상 모듈 밖이라 빌드 상한이 못 막는다 → ✅ 카드 삭제로 교정(`3203b1cd` · 재실행 웹 누수 0).
  **종전 수기 바늘이었다면 PASS** 였다(이 이메일이 목록에 없었다).
- 🔴 **(a) API 산출물 2** — `patient-auth.service.ts:252` `seedTestAccounts()`(생년월일 2종 적중 · 비밀번호 `CHANGE_ME`) · `POST /api/v1/patient-auth/seed-test-accounts` 는 ADMIN 만 막고 **운영 모드 검사가 없다** → REAL 에서 관리자가 알려진 비밀번호의 환자 계정 5개를 만들 수 있다. api 는 빌드 상한이 없으니 런타임 `HIS_MODE` 거부가 해법 → ✅ EP 모드 게이트 교정(`3203b1cd`) · 데이터 문자열 2종은 산출물에 잔존(재실행 참조).
- 바늘 밖 후보 실측(판정 아님 · 참고): `위루비병원` static 54·server 816·api 3(기관 정체성 B1~B3) · `WRB-DEMO-0001` static·server·api 각 1(G11) · `staff1234!` static 2(관리자 초기 비밀번호 기본값 + i18n 카탈로그 공용 청크 — 전 사용자에게 내려감) · `P2026-0001` static 7(MRN 입력 예시 placeholder 가 시드 환자 MRN) · `00000000-0000-4000-` static 1(shared `isSeedUuid` 정규식 — 정당) · `02-1234-56` static 1(장비 등록 placeholder) · `hispdf-fixedtoken-dev` api 1(`release-security.ts` 정본 — 정당).
재주입 4종(적중 버림 · 수기 바늘 · BUILD_ID 검사 제거 · 캐시 훑기) 모두 스펙 실패 확인(`test/release/release-gate-g12-seed-artifact.spec.ts`).

**G12 재실행(2026-09-14 P6 · 본선 `cf02d5a5`(P1~P5 병합) 기준 · 로컬 REAL 상한 빌드 web 152초·api 49초) · 결과 FAIL 3(첫 실행 10)**
- ✅ **웹 번들 누수 8 → 0** — CRM 테스트 계정 카드 삭제(`3203b1cd`)가 산출물에 반영됐다. P4 가 바늘에 넣은 `TEST_PASSWORD`(`staff1234!`)도 web static 0.
- 🔴 **API 산출물 2 잔존(시드 데이터)** — `patient-auth.service.js` `seedTestAccounts()` 가 시드 환자 생년월일 2종을 **문자열로 들고 있다**. EP 는 REAL 에서 403(런타임 게이트)이지만 api 는 빌드 상한이 없어
  **데이터가 산출물에 남는다** — 게이트는 "부를 수 없다"를 막고 G12 는 "들어 있다"를 센다. 해소 방향: 시드 데이터를 서비스에서 떼어 시드 스크립트로(앱 코드 · T2-3 시드 분할과 같은 축).
  → ✅ **R6 해소** — 데이터를 `apps/api/prisma/seeds/patient-portal-test-accounts.json` 으로 옮기고 호출 시점 로드(`portal-seed-accounts.ts`). 로컬 `nest build` 후 `--artifact apps/api/dist` **FAIL 3 → 1**(남은 1 = 아래 Clinic).
- 🔴 **API 산출물 1 신규 적중(분류: 실제 누수 — REAL 도달 가능)** — `clinic-integration.controller.ts:222` `pushStaff()` 의 `DEFAULT_PASSWORD = 'CHANGE_ME'` —
  `POST .../push-staff`(ADMIN)가 **활성 직원 전원을 같은 하드코딩 비밀번호로 Clinic 에 등록**한다. 시드가 아니라 운영 기능 경로의 공개 비밀번호라 G12 바늘(P4 추가) 이전에는 보이지 않았다. 코드 수정은 이 묶음 범위 밖(보고만).
- 게이트 전체(같은 실행)는 워크트리라 G6(워크트리·dirty)·G8 태그 등이 본선 판정과 달라 G12 줄만 인용한다.

**T4-5 재확인(2026-09-14 P6 · 코드·운영 읽기)** — `infra/scripts/backup.sh:51-52` 는 패스프레이즈 파일이 없으면 **여전히 평문으로 진행**한다(경고 로그만 · REAL 거부 없음) → 원장 판정 OPEN 유지가 맞다.
운영 서버는 패스프레이즈가 있어 정기 백업 최근 4건이 전부 `.sql.gz.gpg`(읽기 전용 `ls`) — **현재 운영이 평문이라는 뜻은 아니다**. 파일 아카이브(`lib/backup-files.sh`)는 이미 평문을 만들지 않는다. 서버 반영은 개발 중 생략 결정.

**설치 컨테이너 재리허설(2026-09-14 P6 · `infra/install/rehearse-container.sh` · git archive `3397108d` · node 22.23.2·PG16·Redis7) · install.sh 종료 0 · 187초(npm ci 75초 포함)**
- 산출물 기록 `commitSource: release` · `dirty: null` → 공개 버전 EP `buildInfo: file`·`commit` 일치·`mode: REAL` · install.sh 가 "서버가 보고한 커밋이 기록과 같다" 확인.
- 메모리 판정: 가용 6,078MB · API 최소 4,096MB 통과 · 힙 `--max-old-space-size=4558` 자동 · 웹 6,144MB 미만 경고 출력(막지 않음) — v 갈래 추가분이 컨테이너 전체 설치로 **처음** 확인됐다.
- 미확인 마스터 3종(진단·수가·검사) 빈 상태 경고 · 약가는 합성 3행(실제 원천 아님). 🔴 G9(실제 서버·사람 확인)는 여전히 미완.

**운영 반영(2026-09-13 10:38~10:44)** — `pre-deploy_20260913_103847` 백업 → 🔴 `db push` 미리보기가 **트라이그램 인덱스 DROP**을 예고해 `--schema` 를 쓰지 않고
`20260913000002_legal_hold` SQL 만 단일 트랜잭션 적용(테이블 2·트리거 2 확인 · 인덱스 보존 확인) → 서버 `prisma generate` → `--api --web` 배포(스모크 29) →
공개 버전 커밋 `6de4f867` · 새 EP 401 확인 → 백업 스크립트 서버 동기화 후 1회 실행·무결성 검증 PASS.

---

### §8-신규. 원장에 없던 세션 신규 항목(2026-09-13~14 · 원장 대조 `docs/04-report/remaining-2026-09-14/1-release-ledger.md` §3 편입)

상태는 **2026-09-14 본선 `ef1dd424` 코드 기준**으로 다시 판정했다(대조 시점 이후 P1~P6 반영). 🧑 사람 결정은 **2026-09-15 등록부에 등재**됐다(초안 D번호 → 등록부 키 · N36) — 남은 것 칸의 `결정 대기 <키>` 가 `/admin/decisions` 항목이다. 상태는 2026-09-15 `acb70464` 기준으로 다시 판정했다.

| # | 항목 | 근거 커밋 | 상태 | 남은 것 |
|---|---|---|---|---|
| N1 | 🔴 운영 DB 에 `mrn_daily_seq` 가 없다 — 발번은 늘 count 폴백(이제 warn 기록) | `b43c4260` | PARTIAL | 결정 대기 `policy.mrn.numbering`(시퀀스 생성·setval·일일 리셋) |
| N2 | 🔴 저장소에 정의만 있고 운영에 없는 인덱스 15(gin·trgm 11 · 보조 4) · 약품·진단·수가 검색 순차 스캔 · trgm 만 걸면 계획 불변(`code LIKE` OR 항) | `5f9a4e06` · `1da5b69e` | OPEN_HUMAN | 결정 대기 `policy.db.unappliedIndexes` |
| N3 | 마이그레이션 적용 판정 도구 · 09-14 마이그레이션 2건(진단검사 3컬럼 `20260914000001` · 위급값 5컬럼 `20260914000002`)은 운영에 **SQL 직접 적용 — `_prisma_migrations` 이력 없음** · 🔴 판정 도구가 `ADD COLUMN` 을 파싱하지 못해 두 건을 UNPARSEABLE 로 낸다(컬럼은 실재) | `18c22a47` · `3ca27cb4` · `85254d14` | PARTIAL | 도구 `ADD COLUMN` 보강(CLI) → 재판정 → resolve 🖥 |
| N4 | G12 첫 실행 누수(CRM 시드 계정 카드 · 환자 시드 EP 모드 게이트) 교정 → 재실행 FAIL 3 | `7679c4f9` · `3203b1cd` · `34ddb26d` | PARTIAL | ~~API 시드 생년월일 2~~(R6 시드 데이터 분리로 해소 — api dist FAIL 1) · Clinic 공용 비밀번호 1(N19 · 결정 대기 `policy.integration.clinicAccountIssuance`) |
| N5 | Linux Node 22 가 ko-KR 오전/오후를 AM/PM 으로 낸다 — shared `locale-time` 정본 · API 17 · web 21 · 공개 사이트 1 · 가드 | `95a91ca9` · `b4217937` · `8c871d81` | DONE(운영 서버 Node 로 `오후 03:30` 확인) | — |
| N6 | 설치본 `BUILD_INFO` 3상태 · 빌드 메모리 실측(웹·API 6GB 한도 · 힙 3~6GB) · 설치 스크립트 가용 메모리 판정 · 컨테이너 재리허설 성공 | `25bd6542` · `3e36d515` · `b549335f` · `3397108d` | PARTIAL | 🧑 G9 실제 서버 확인 |
| N7 | 파일 저장소 백업(DB+FILES 짝 아카이브) · 감시자 `pipe.backup.filesArchive` | `e8a0a9d4` · `f1ecddc2` | PARTIAL | 서버 반영은 실운영 전환 때(개발 중 생략 결정) · 녹음 원음 포함 여부 결정 대기 `legal.recordArchive.policy` |
| N8 | 환자↔담당의 메시지 직원 측 수신·답변(완료 주장 미동작 해소) · 환자 푸시 `MESSAGE` 기본 OFF | `cd4833d6` | DONE(코드·운영 EP 응답 확인) | 푸시 켜기는 설정 🧑 |
| N9 | 위급값 경보 상태기계·ESCALATED 크론(허용시간 미설정=무발동) · `criticalOverdue` 30분 하드코딩 → 같은 config 정본·미설정은 `-` | `85254d14` · `e0840d8c` | PARTIAL | 결정 대기 `policy.criticalValue.escalation`(허용시간·상향 수신자) |
| N10 | 진단검사 취소·보류 전이(사유가 위험소견 칸을 덮어쓰던 결함) · 휴진 영향 예약 · 예약 검증 반일 휴진 사각지대(휴진 판정 정본 하나) | `3ca27cb4` · `e0840d8c` | DONE | 판정 불명은 막지 않고 경고(설계) |
| N11 | 🔴 환자 포털 여정이 직원 내부 이벤트를 돌려줬다 → 노출 유형 필터(fail-closed) · 🔴 노출 유형 설명에 직원 자유 입력(오더 메모·주호소·판독 소견 등 9곳) → 발행 제거 + 포털 설명 안전 유형만 · `journey/status` 도 같은 결함 교정 | `b301ed45` · `76772a66` | PARTIAL | 🧑 D14 간호평가·낙상·환자안전·감염·진단검사 취소/보류·위급 경보 노출 · 검사 결과 설명의 "위급값" 표기 |
| N12 | 지어낸 시설 사실 제거(예약 챗 주차·식당·장례식장 · 면회시간·원무과/응급실 위치 · 포털 기본 공지 4) | `9e43e96b` · `3d215b12` · `76772a66` | PARTIAL | 결정 대기 `policy.facilityInfo.floorGuide`(층별 안내 예시·직원 식당 운영시간/가격) · 공개 사이트 챗봇·검진센터 상수는 `7b513538` 로 제거 |
| N13 | 권한·검증 구멍 — 원격진료 환자 대리 EP 역할 · 비동기 본문 DTO · 코드블루/RRT 본문 DTO | `de115b61` · `c0335bdf` · `7ae39583` | DONE | — |
| N14 | 실패 은폐 교정(API 5 · web queryFn 4 · web 헬퍼 3 · 여정 위치 갱신) + 목록 동결 가드 | `e9ef544c` · `3bc67ad9` · `47831dff` · `14e4a69d` · `e0840d8c` | DONE(목록 동결 — 정당 판정분은 남음) | — |
| N15 | 검증 층 — G10 사각지대(지역 상수·import·alias·재수출) · CLAUDE.md 서술 수치 55 대조 가드 · phantom-endpoint 시간초과 · 역할×EP 스캐너 nav 전개식 해석(19화면 편입) | `0a218fb4` · `8f09574b` · `2796b189` · `4f69bc9c` · `4f1db213` · `34be9693` | DONE | — |
| N16 | 기획서 247 전수 검토 — 완료 주장 미동작 1(N8) · 등록부 미등재 사람 결정 → 신규 초안 50 · 낡은 상태줄 HIGH 85건 적용 | `86b436f2` · `1f283b21` | DONE(초안 50 + 세션 신규 10 등재 `286ad84a`·`f7459ad5`·`966281a9` · 상태줄 MED 56 적용 `3d69f4c5`) | 등재된 결정의 선택은 🧑 |
| N17 | 직원 상세·내 정보가 쓰기 끊긴 `StaffSchedule` 을 싣던 것 → 근무 정본(DutyEntry+승인 휴가)에서 조립 | `c0335bdf`(발견) · `e0840d8c` | DONE | 옛 `staff_schedules` 테이블 제거는 운영 행 수 확인 뒤 |
| N18 | 공용 초기 비밀번호 기본값 `staff1234!`(10자·대문자 없음 — 서버 하한 12자·대소문자 정책(`password-policy.ts`)에 걸린다는 P4 보고) → 서버 일회용 발급·1회 표시 · 시드 실값 placeholder(MRN·장비 전화) 회수 | `ad28ab8f` | PARTIAL | 🔴 첫 로그인 비밀번호 변경 강제가 화면에 없다(`GET /auth/password-status` 를 부르는 web 0) |
| N19 | 🔴 **Clinic 연동 `push-staff` 가 활성 직원 전원을 같은 하드코딩 비밀번호로 등록**(`clinic-integration.controller.ts:222`) — G12 재실행 적중 | `34ddb26d`(발견) | OPEN | 결정 대기 `policy.integration.clinicAccountIssuance`(REQUIRED_BEFORE) |
| N20 | 검진 화면 3곳(EP 4)이 사이드바에서는 의사에게 열리는데 서버는 403 — 역할×EP 스캐너 편입으로 드러남(기준선 동결 · 미교정) | `34be9693` | OPEN | 결정 대기 `policy.rbac.checkupScreensForDoctor` |
| N21 | 🔴 예약 일 뷰 드래그 이동을 기획 게이트 `schedule.grid.dnd`(기본 OFF) 뒤로 — **2026-09-14 `ef1dd424` 운영 배포로 운영에서도 꺼졌다** | `ca33c6e5` | DONE | 쓰려면 관리자가 설정 켬 |
| N22 | 🔴 달력에 없는 날짜(`2026-13-40`)가 400 대신 다음 달로 굴러 조회 — `common/day-range.ts` parseLocalDate 연·월·일 되읽기 | `8335dd4a` | DONE | 운영 400 확인(09-15) |
| N23 | 🔴 CRM 예약 대행 4종이 예약 정본 우회(휴진·세션·충돌 검증 없음·가용 시간대 09~17시 고정 16칸 지어냄) → ScheduleService 경유·DTO | `37a0296e` | DONE | — |
| N24 | 직원 예약 변경(`ScheduleService.update`)이 휴진·세션 검증 없이 충돌만·락 밖 → validateBookable·의사 락 원자화 | `424fcd59` | DONE | — |
| N25 | 🔴 원격진료 화면이 창 미열림·닫힘에도 초록 "진행 중" → 연결 상태 사실 표시·품질 측정 불가 | `df6f0655` | DONE | Jitsi 영상 서버 운영 부재(`/meet` 404) — 보류(09-15 사용자) |
| N26 | 비밀번호 변경 화면이 없었다(EP 만) → `/settings/password`·변경 필요 배너 | `908d6b7c` | PARTIAL | 결정 대기 `policy.security.firstLoginPasswordChange` · 연속 실패 잠금 `policy.security.passwordChangeLockout` · 입력 오류 400 교정 `cc2e99a2` |
| N27 | CRM 자동 연락 크론 4종에 설정 스위치·승인 게이트 없음(운영 모드로만 차단) — 현황 조회만 신설 | `3f6e71cc` | OPEN | 결정 대기 `policy.crm.automatedOutreach`(REQUIRED_BEFORE · 대외 발신 3조건) · 검진 대행 권한 `policy.crm.checkupProxyScope` |
| N28 | 분납 회차 조회 EP 2개·권한 상이(billing vs installment) · 납부일 UTC 절단 교정·잔액/예정일 경과 표시 | `d65ed6fd` | PARTIAL | 결정 대기 `policy.billing.installmentViewRoles`(정본 EP·권한) · `policy.billing.installmentRules`(연체 기준·조정·생성 규칙) |
| N29 | 여정 타임라인 조회가 환자 열람 감사에서 빠져 있었다 → `audit-routes.ts` 등재(타임라인·기간 보고서·rx-guide) | `dedc92e3` | DONE | — |
| N30 | 스키마 추가 운영 반영 2회(09-14 진단검사 전이·위급값 상태 · 09-15 상담 템플릿·CSSD 기구 개체) — 백업·diff 미리보기·단일 트랜잭션 SQL · `db push` 미사용 | `2345286a` · `7327b1c6` | DONE | `_prisma_migrations` 표시 결정 대기 `policy.db.migrationHistoryAdoption`(선행 `policy.mrn.numbering`·`policy.db.unappliedIndexes`) · 판정 도구 교정 `caf9540a` |
| N31 | 🔴 대량 할당·검증 부재 쓰기 49 핸들러 → class DTO — 사용자 수정 `passwordHash` 덮어쓰기·이식 기증자 승인 우회·사전의료의향서 상태 주입·기관 SMART 비밀키·ESAS 문자열 합산·Morse 문자열 참(인라인 @Body 409→359) | `6c06b664` · `bfc371e0` | DONE(남은 인라인 359 동결) | 마약류 처방자 본문 수신은 결정 대기 `policy.controlledSubstance.prescriberSource` |
| N32 | 본인 비밀번호 변경 입력 오류 401 → 400·사유 코드 · 90일 정본 하나 | `cc2e99a2` | DONE | 연속 실패 잠금 결정 대기 `policy.security.passwordChangeLockout` |
| N33 | 🔴 공개 사이트 진료시간 상수가 병원 사실로 나감(앱 fallback 표시 소비처 0 · web 사본 CMS 조회 없음) · 챗봇 주차 무료·면회 시각·층별 배치 · 검진센터 시각·내선 · 공개 조회 실패 "없음" 16곳 · 4개 언어 랜딩 구문 오류 | `17ddc5bb` · `7b513538` · `c0da8473` · `4c49cdd1` · `70aab774` | PARTIAL | 🧑 hospital.example.org 재빌드·발행(발행 전 미반영) |
| N34 | 🔴 공개 `/health`·`/.well-known`(SMART discovery) 404 — 09-09 이전 Caddy 규칙 누락 회귀 · 스모크 공개 엣지 확인 | `88ecc355` · `b3ab8461` | DONE(사용자 승인 반영 · 스모크 31) | — |
| N35 | 감시자 정합성 불변식 71→75(휴진 예약·분납 합계·기초검사 전이 사유·폐기 기구 연결) | `a8e11b64` | DONE | 위급값 잔존은 기준 결정 뒤(`policy.criticalValue.escalation`) |
| N36 | 🔴 사람 결정 60건 등록부 등재(초안 D01~D50 + 세션 N1~N10 → 등록부 키 · 등재≠결정) — 등록부 66→126 · 개시 전 필수 15→31 · CLAUDE.md 대조가 증분 배치를 못 세던 사각지대 교정 | `286ad84a` · `f7459ad5` · `966281a9` · `bc8191a5` · `acb70464` | DONE | 🧑 `/admin/decisions` 에서 선택 · G2 판정 기준 재산정 |
| N37 | 차트 내 검색·직전 방문 대비 · 예약 히트맵 · 문진 검토 상태 교정·상담 이관/템플릿 · CSSD 기구 수명·포뮬러리 CSV · 간호 처방 가이드·관제 SSE·여정 기간 보고서 · 원격진료 연결 상태 · 분납 summary | `c5a004d5` · `b4b0426b` · `b817fc87` · `6aa6a759` · `dedc92e3` · `df6f0655` · `d65ed6fd` | DONE | 영상 서버(Jitsi) 보류(09-15 사용자) |

N19~N21 은 원장 대조(09-14 오전) 이후 병행 묶음 P2·P4·P6 에서 새로 드러난 것이다.
