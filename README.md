# Hospital RUN

한국형 Enterprise 대학병원급 정보 시스템(HIS). HospitalRun · EtherCIS · Medplum 을 참고해 만든
모노레포이며, 외래·입원·응급부터 약국·검사·영상·수술·간호·급양·청구·검진·포털·환자 앱까지를
하나의 코드베이스에서 다룬다.

- 🔴 **AI 도입과 HIS**: [`docs/AI-AND-HIS.md`](docs/AI-AND-HIS.md) — AI 의 판단을 사람이 안전하게 소유하는가(정본/제안 분리 · 출처 추적 · 수용 이력 감사). 질의서 대비 평가와 공백 기획서가 여기서 갈라진다
- 운영 인스턴스: https://his.example.org

---

## 🔴 먼저 읽을 것 — 운영 DB 는 실환자 데이터가 아니다

`his.example.org` 의 데이터베이스는 **개발·시연용으로 생성된 가상 병원의 시드 데이터**다.
이 시스템은 **아직 실환자를 받은 적이 없다.** 병원명 `위루비병원`, 환자 874명 중
830명이 결정적 시드 UUID이며, `dev.demoDateRoll` 이 축마다 다른 속도로 날짜를 다시 쓴다.

그래서 이 저장소의 문서·보고서에서 "실측"이라 적힌 수치는 **그 전제 위에서만** 읽어야 한다.
특히 **"데이터 0행"은 ①시드에 없다 ②기능이 미배선이다 ③쓰기 경로가 막혀 있다** 중 무엇인지
눌러보기 전에는 알 수 없다(③을 ①로 오판한 사례가 이 저장소에서 3건 나왔다).


---

## System Scale

`node scripts/system-scale.mjs` 로만 재현한다. 손으로 세지 않는다 — 세는 규칙(포함/제외)이

아래는 2026-10-14(v4.92.0) 동결값 중 **대표 수치 발췌**다.

| 지표 | 수량 |
|------|-----:|
| Prisma Models | 596 |
| Backend Modules (도메인) | 228 |
| Controllers / Services | 328 / 385 |
| API Endpoints (HTTP 메서드 데코레이터) | 3,478 (+ `@Sse` 16) |
| AI Endpoints (경로 세그먼트 `ai` 기준) | 75 |
| Frontend Pages (apps/web 전체) | 471 (main 369 · `(homepage)` 46 · 기타 56) |
| Homepage App Pages (별도 앱 `apps/homepage`) | 50 |
| Admin / Workstation Pages | 127 / 29 |
| Mobile Screens | 32 |
| Test Files (BE / web / shared) | 1,257 / 402 / 51 · **고아 테스트 0** |
| Plan Documents (`*.plan.md`) | 275 |
| 결정 등록부(사람 결정) | 232 |

운영 DB 행 수(의약품 코드 24,022 · KCD-8 상병 18,184)와 "통과 테스트 수"는 파일시스템 계측
범위 밖이라 CLAUDE.md 표에서 출처를 따로 밝힌다.

계측값은 `scripts/system-scale.lock.json` 에 동결돼 있고 `node scripts/system-scale.mjs --check`
가 **많아도 적어도** 실패한다. 변경이 실제 증감이면 CLAUDE.md 표를 갱신하고 `--freeze` 한다.

통과 테스트 수(2026-10-14 v4.92.0 릴리즈 트리): BE 15,213 · web 3,405 · shared 490 · tsc 0.

---

## 최근 릴리즈 (2026-10-12 ~ 10-14) — 결함 발굴 두 캠페인

| 캠페인 | 릴리즈 | 보고서 | 남은 것 |
|---|---|---|---|

🔴 운영 수치(실피해)는 **가상 병원 시드** 위의 실측이다 — 실데이터에서 재검증한다.

---

## Architecture

- **Architecture**: Enterprise Clean Architecture (Presentation → Application → Domain ← Infrastructure)
- **Frontend**: Next.js 15 (App Router), Tailwind CSS, shadcn/ui, Zustand, TanStack Query, React Hook Form + Zod
- **Backend**: NestJS, Prisma ORM, PostgreSQL 16, Redis 7
- **Mobile**: Expo SDK 56 (React Native)
- **Auth**: Custom JWT + RBAC Guard (ADR-001) · UserRole 14종
- **Medical Standards**: FHIR R4 (외부 표면), openEHR 패턴 (내부), KCD-8/ICD-10, EDI, DUR
- **Monorepo**: Turborepo + npm workspaces (`apps/*`, `packages/*`)
- **API Prefix**: `/api/v1/` (internal) · `/fhir/R4/` (FHIR)
- **Response Format**: `{ data, meta }` / `{ error: { code, message, details }, meta }`

### 모노레포 구조

```
hospital-run/
├── apps/web/          # Next.js 15 (App Router) — 스태프/포털/전광판 프론트엔드
├── apps/homepage/     # Next.js — 공개 병원 홈페이지 (web 의 (homepage) 그룹과 별개)
├── apps/api/          # NestJS — Backend API
├── apps/mobile/       # Expo SDK 56 (React Native) — 환자 앱
├── packages/shared/   # 공용 타입·상수·정본(상태 라벨·수치 정책·역할 목록 등)
├── infra/docker/      # Docker Compose, Nginx
├── scripts/           # 운영·계측 스크립트 (system-scale.mjs = System Scale 계측 정본)
└── docs/              # PDCA 문서 (Plan/Design/Analysis/Report/Reference)
```

🔴 `apps/web` 안의 `(homepage)` 라우트 그룹과 **별도 앱 `apps/homepage`** 는 다른 것이다.
실제 공개 사이트는 후자이고, 격리 빌드라 workspace 패키지를 쓸 수 없다
(공용 정본은 기계 대조 사본 + `npm run sync:cms-style` + 드리프트 가드로 맞춘다).

### RBAC

UserRole 14종 — 임상 4(DOCTOR·NURSE·PHARMACIST·LAB_TECH) + 지원 최소권한 9(RECEPTIONIST·
NUTRITION·ADMIN_STAFF·MEDICAL_RECORDS·CHECKUP·CRM×2·EXECUTIVE·READ) + ADMIN.

🔴 **nav 에서 숨긴 것은 권한을 회수한 것이 아니다.** API 측 판정은 `RolesGuard` 의 `user.role`
이므로 화면에서 메뉴를 감춰도 EP 는 열려 있을 수 있다. 반대로 전역 컴포넌트는
**최소 권한 직군 기준으로** 검증한다(레이아웃이 부르는 EP 가 임상 전용이면 지원 직군은
모든 화면에서 403 배너를 본다 — 실제로 14역할 중 9역할이 그랬다).

---

## Quick Start

```bash
npm install
npm run docker:up        # PostgreSQL + Redis
npm run db:migrate       # Prisma migrations
npm run db:seed          # Seed initial data
npm run dev              # Start all services (turbo)
```

| 포트 | 서비스 | 소유 |
|------|--------|------|
| 3000 | HospitalRun Web | HospitalRun |
| 4000 | HospitalRun API | HospitalRun |
| 5432 | PostgreSQL | 공유 |
| 6379 | Redis | 공유 |
| 3001 / 4242 / 8001 / 8042 | OHIF / Orthanc / FastAPI | **OpenPACS** |

## Tests & Checks

```bash
npm run test                                  # turbo — 전체 워크스페이스
npm run test --workspace=apps/api             # BE (vitest)
npm run test --workspace=apps/web             # web (vitest)
npm run test --workspace=packages/shared      # shared (vitest)
npm run check:screen-codes --workspace=apps/web   # 화면번호 레지스트리 CI 게이트

node scripts/system-scale.mjs --check         # System Scale 동결값 대조
node scripts/data-freshness.mjs               # 시드 시점 정합 판정
```

테스트 파일 수의 정본은 각 앱의 `vitest.config.ts` 의 `include` 다(사람이 `test/` 만 세거나
`src/` 만 세서 값이 갈린 적이 있다). 🔴 **통과하는 테스트가 아무것도 보증하지 않을 수 있다** —
이 저장소에서 "가드가 다른 이유로 통과한" 사례가 반복해서 나왔다. **가드는 결함을 재주입해
실패해야 가드다.**

---

## Deployment

```bash
./infra/scripts/deploy.sh --api          # API만
./infra/scripts/deploy.sh --web          # Web만
./infra/scripts/deploy.sh --schema --api # 스키마 변경 + API (자동 백업)
./infra/scripts/deploy.sh --all          # 전체 배포
./infra/scripts/deploy.sh --backup       # DB 백업만
```

- 🔴 **금지**: `npx prisma db push --accept-data-loss` — 런타임 데이터 소실 위험.
  플래그 없는 `npx prisma db push` 는 데이터 손실 시 스스로 거부한다
- 🔴 **빌드 시** `NEXT_PUBLIC_API_URL=''` 필수 — 브라우저는 상대경로를 쓴다
- 🔴 **BE 수정 후** `nest build` 필수 — pm2 가 `dist/main.js` 를 실행한다
- 🔴 `(homepage)` 경로에서는 `apiClient` 금지 → `fetch()` 직접 사용(HIS JWT 자동 첨부로 401)
- 배포는 실행된 디렉터리를 `rsync --delete` 로 서버에 민다 — **미커밋 변경도 배포되고,
  두 곳에서 동시에 배포하면 서로를 지운다**
- 운영: pm2 (api + web) + Docker (Jitsi, PACS) · DB `PostgreSQL localhost:5432/hospitalrun`

### PACS (OpenPACS 분리)

PACS 는 별도 프로젝트다 → https://github.com/seanshin/openpacs

- **금지**: `docker-compose.yml` 의 orthanc/ohif/backend 서비스 수정·삭제 ·
  Nginx `/pacs-api/`·`/dicom-web/`·`/wado`·`/pacs/`·`/viewer/` 경로 수정 ·
  PostgreSQL `openpacs` DB 접근 · `hospital` 사용자 비밀번호 변경(OpenPACS 와 공유)
- **허용**: 프론트엔드에서 `/pacs/` URL 로 Orthanc/OHIF 에 링크 제공 · postgres·redis 서비스 수정
- 🔴 HIS 화면이 PACS 를 **직접 호출하지 않는다.** HIS 프록시를 거친다
  (직접 호출이 상시 "영상 없음"을 만든 이력이 있다)

---

## 문서 안내

문서는 PDCA 5계층이다. **어디에 무엇이 있고 무엇이 최근에 바뀌었는지는
[`docs/00-document-map.md`](docs/00-document-map.md) 가 정본**이다.

| 계층 | 성격 |
|---|---|
| [`docs/01-plan/`](docs/01-plan/) | 앞으로 할 일과 그 판단 근거(`*.plan.md`) · `integrations/` 는 외부 팀 왕복 |
| [`docs/02-design/`](docs/02-design/) | 어떻게 만들 것인가 — 스키마·상태기계·파이프라인 |
| [`docs/03-analysis/`](docs/03-analysis/) | 지금 어떻게 돼 있는가 — 실측 감사 보고서(2026-07 전수검토 21축) |
| [`docs/04-report/`](docs/04-report/) | 일어난 일 — `RELEASE-v*.md` 가 릴리즈 정본 |
| [`docs/05-reference/`](docs/05-reference/) | 계약·규약·명세·운영 절차 |

자주 찾는 정본 몇 가지:

- 임상 UX 규약 — [`docs/01-plan/features/clinical-ux-agent-era.plan.md`](docs/01-plan/features/clinical-ux-agent-era.plan.md)
- 화면 점검 패턴 P1~P17 — [`docs/01-plan/features/screen-walkthrough-audit.plan.md`](docs/01-plan/features/screen-walkthrough-audit.plan.md)
- 시드 흐름 검사법 A~I — [`docs/01-plan/features/seed-flow-audit.plan.md`](docs/01-plan/features/seed-flow-audit.plan.md)

---

## Conventions

- **Naming**: PascalCase(컴포넌트) · camelCase(함수) · kebab-case(파일/폴더) · snake_case(DB 컬럼)
- **Patient Names**: `familyName`/`givenName` (ADR-002, FHIR 호환)
- **Import Order**: builtins → external → internal(`@/`) → relative → types → styles
- **표현 단위**: 상태 라벨·색은 shared 정본 + `StatusBadge domain`(로컬 `Record` 재정의 금지) ·
  날짜/금액/환자명/빈상태는 `components/ui/display`(KDate·Money·PatientName·EmptyState) ·
  폴링은 `pollMs()`/`usePollInterval` — 전부 SystemConfig `ui.*` 반영
- **수치·단위**: 자릿수/반올림/단위는 shared `NUMERIC_POLICIES` 하나. 표시 `<Num domain>`,
  계산·저장 `roundBy`, FHIR 출력 `fhirQuantity`. `toFixed`/`Math.round` 직접 호출은 구조 가드가 막는다
- **인쇄**: `sanctionedPrint()` 또는 `/print/*` 만. `window.print()` 직접 호출 금지

### 🔴 이 저장소가 반복해서 배운 것 (신규 코드에도 그대로 적용)

전수검토 21축 · 화면 실사용 점검 W0~W9(254화면·실결함 950+) · 시드 흐름 10단계에서
가장 자주 나온 것만 옮긴다.

- **아는 것과 모르는 것을 뒤바꿔 말하지 않는다** — 표본 부재의 정답은 폴백이 아니라
  빈 목록/`null` + "산출 불가"다. `0` 은 다른 사실이다
- **`.catch(() => 기본값)` 은 "실패"를 "없음"으로 번역하는 코드다** — 조회 실패는 전파하거나
  3상태로 말한다. `queryFn` 안의 침묵 폴백은 에러 UI 를 도달 불가 코드로 만든다
- **조건식에서 미측정을 폴백하지 않는다** — `(spo2 ?? 100) < 95` 는 활력을 하나도 안 잰
  환자를 "정상"으로 판정한다
- **전송을 흉내내지 않는다** — 대외 발신 3조건 = 구현 + 설정(기본 OFF) + 승인.
  나가지 않았으면 시각도 성공도 남기지 않는다
- **정본을 만든 것과 모든 소비처가 그것을 쓰는 것은 다른 일이다** — 개념을 쓰는 곳 전역 grep
- **EP 를 만들면 부르는 화면까지가 한 벌이다** · **"데이터 0행"을 믿기 전에 쓰기 경로를 눌러본다**
- **화면이 실제보다 덜 안전하게 말하는 것도 사실이 아니다** — 거짓 경보는 진짜 경보를 죽인다
- **미구현이 곧 결함은 아니다** — 다만 없는 것을 있는 것처럼 말하지 않는다

## Architecture Decisions

| ADR | 결정 |
|-----|------|
| ADR-001 | Custom JWT + RBAC Guard |
| ADR-002 | `familyName`/`givenName` (FHIR compatible) |
| ADR-003 | MRN identifier system |
| ADR-004 | JSON schema Form Engine |

## Out of Scope

| ID | 항목 | 사유 | 로드맵 |
|----|------|------|--------|
| FR-08 | 오프라인 동기화 (PWA Service Worker + IndexedDB) | 현재 온라인 환경 운영, 네트워크 안정성 확보됨 | Phase 4+ 로 이연 |

## References

- [HospitalRun](https://hospitalrun.io) · [EtherCIS/EHRBase](https://ethercis.org) ·
  [Medplum](https://medplum.com) · [OpenMRS O3](https://openmrs.org)
- [OpenPACS](https://github.com/seanshin/openpacs) — PACS 별도 프로젝트
- [Hospital Jitsi](https://github.com/seanshin/hospital-jitsi) — WebRTC 서버 별도 프로젝트

## License

🔴 **이 저장소의 라이선스는 아직 정해지지 않았다.** 루트에 `LICENSE` 파일이 없고 `package.json` 은 `"private": true` 다.

- 제3자 구성 요소 고지: [`NOTICE`](NOTICE) → [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)(`node scripts/third-party-notices.mjs` 로 자동 생성)
- `apps/mobile/THIRD-PARTY-NOTICES.md` 는 Expo 템플릿이 남긴 **650 Industries(Expo) 의 MIT 원문**이지 이 앱의 라이선스가 아니다(종전 파일명 `LICENSE` 가 그렇게 읽혀 개명).
