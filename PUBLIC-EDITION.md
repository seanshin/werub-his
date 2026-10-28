# HIS — 공개판 안내

**HIS — about this public edition**

> **EN** — This repository is the public edition of HIS v4.130.0. Development continues in a private repository; this edition is its final state with internal working records (reports and replies exchanged with other systems, key-rotation runbooks, server measurements) and operational details removed, licensed under MIT. Operational domains, server addresses and accounts were replaced with example values, and **every password, secret, token and key was emptied to `CHANGE_ME`** — you must set your own before running anything. The table below lists each emptied setting and where it appears.

이 저장소는 **HIS v4.130.0 의 공개판**입니다. 개발은 비공개 저장소에서 계속하고, 공개판은 그 최종 상태에서 다음을 빼거나 바꾼 것입니다(MIT).

| 무엇 | 어떻게 |
|---|---|
| 내부 작업 기록 | 다른 시스템과 주고받은 결함 보고 · 회신, 키 교체 런북, 서버 실측 등 708개 문서를 뺐습니다. 소스 주석이 빠진 문서를 가리키는 곳이 남아 있을 수 있습니다 |
| 운영 정보 | 운영 도메인 · 서버 주소 · 서버 계정을 예시 값(`example.org` · 문서용 IP 대역 · `deploy`)으로 바꿨습니다 |
| 🔴 비밀값 | 비밀번호 · 비밀 · 토큰 · 키 **23곳**을 `CHANGE_ME` 로 비웠습니다. **실행 전에 아래 값을 직접 정하십시오** |

## 직접 설정할 값

| 설정 이름 | 있는 곳 |
|---|---|
| `ADMIN_PASSWORD` | `infra/install/rehearse-container.sh` |
| `API_KEY` | `docs/01-plan/features/patient-waiting-display.plan.md` |
| `DEFAULT_PASSWORD` | `docs/01-plan/features/commercial-release-v1-freeze.plan.md` |
| `MEDICAL_AI_KEY` | `docs/01-plan/features/medical-ai-integration.plan.md` |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | `.env.example`(비어 있음) |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | `.env.example`(비어 있음) |
| `password` | `apps/api/prisma/seeds/patient-portal-test-accounts.json` · `apps/web/.env.development` |
| `PGPASSWORD` | `infra/scripts/deploy.sh` |
| `POSTGRES_PASSWORD` | `infra/install/rehearse-container.sh` |
| `waitingToken` | `docs/01-plan/features/patient-waiting-display.plan.md` |
| 문서 · 예시 속 비밀번호 | `.env.example` · `.github/workflows/ci.yml` · `docs/01-plan/features/commercial-release-v1-freeze.plan.md` · `docs/02-design/features/hospital-run.design.md` · `infra/docker/docker-compose.prod.yml` · `infra/install/rehearse-container.sh` — 접속 문자열 · 예시 명령의 비밀번호를 `CHANGE_ME` 로 비웠습니다. 실제 값으로 바꿔 쓰십시오 |

- 같은 이름이 여러 곳에 있으면 **모두 같은 값**이어야 하는지(서로 맞물리는 연동 비밀) 확인하십시오.
- 값은 길고 무작위로 만드십시오(예: `openssl rand -base64 32`). 저장소에 다시 커밋하지 마십시오.

## 켜기 전에 기관이 정할 보안 설정

아래 기능은 공개판에서 **설정하지 않으면 안전한 쪽으로 멈추거나 꺼져 있습니다.** 기관의 운영 절차에 맞춰 직접 정하십시오.

| 설정 | 무엇을 정하나 |
|---|---|
| `HIS_MODE` | `DEV` · `REHEARSAL` · `REAL`. **설정하지 않으면 `REAL`**(가장 제한적)로 보고, `REAL` 에서는 개발용 비밀 폴백 · 느슨한 스위치가 남아 있으면 **기동을 거부**합니다. 예시 파일(`.env.example`)은 개발용 `DEV` 이니 운영 설치에서는 반드시 바꾸십시오. |
| `AUTH_SECRET · ENCRYPTION_KEY` | 예시 값을 그대로 쓰지 마십시오. `ENCRYPTION_KEY` 는 필드 암호화 키라 **운영 중에 바꾸면 이미 암호화된 값을 읽지 못합니다** — 처음에 정하고 안전하게 보관하십시오. |
| `onboarding.fourEyes(관리 화면 설정)` | 직원 계정 개통에 관리자 승인을 요구합니다. 공개판은 **기본 켬**입니다. 끄려면 기관의 승인 절차를 먼저 정하십시오. |
| `안전 게이트 모드(관리 화면 `/admin/safety-gates`)` | 투약 · 수술 · 검체 · 조제 등 게이트마다 차단 · 경고 · 끔을 정합니다. 설치 직후에는 **꺼진 게이트가 많습니다** — 개원 전에 위원회가 게이트별 모드를 정하고 기록하십시오. |
| `외부 연동 키(ERP · LIS · sign · PACS · edu · AI Server)` | 각 키 · 비밀은 상대 시스템에 넣은 값과 **같아야** 합니다. 연동별 설정 이름과 순서는 생태계 소개 저장소의 구축 가이드를 보십시오. |
| `NEXT_PUBLIC_FIREBASE_*(선택)` | 직원 푸시 알림용 기관 Firebase 프로젝트 값입니다. 비우면 푸시 없이 폴링으로 동작합니다. 정적 파일 `apps/web/public/firebase-messaging-sw.js` 의 같은 값도 함께 바꾸십시오. |
| `공개판에서 바뀐 업무 규칙` | 발행 · 폐기된 **임상 경로는 그 자리에서 고치지 않고** 복제해 새 버전으로 고친 뒤 발행합니다(폐기도 발행과 같은 의결 판정을 거칩니다) · 보유 정책의 **법정 하한은 낮출 수 없습니다** · 조제 취소는 **교부 전까지만** 되고, 조제 품목은 처방 약품이나 **승인된 대체조제** 약품만 됩니다 · 재활 세션은 완료된 것을 다시 시작 · 완료하지 않습니다 · 마약류 재고 불일치 경보의 기본 대상은 약사 · 관리자입니다. 바뀐 동작은 `apps/api/test/public-edition/` 시험이 지킵니다. |

- 코드 안의 개발용 기본값은 운영에서 반드시 환경 변수로 덮어쓰십시오.
- 이 생태계 전체의 소개 · 구축 순서: [werub-his-ecosystem](https://github.com/seanshin/werub-his-ecosystem)
