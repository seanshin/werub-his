# 계획서 — 실 배포 준비 (Deployment Readiness / Go-Live)

> **상태(2026-09-15 코드 대조 갱신)**: 구현됨(일부) — infra/scripts/backup-verify.sh · SEC-2 기본 비밀번호 → 서버 일회용 임의 발급 `apps/api/src/modules/auth/password-policy.ts:65` generateCompliantPassword(P4 `ad28ab8f`) · 첫 로그인 변경 안내 배너·변경 화면 `apps/web/src/app/(main)/settings/password/page.tsx`(S3 `908d6b7c`, 강제 없음) · 잔여: SEC-1 git secret purge(사람); SEC-3 운영 시크릿(사람 — REAL 전 ENCRYPTION_KEY 교체); Clinic 동기화 공용 하드코딩 비밀번호 `clinic-integration.controller.ts`(사람); 첫 로그인 변경 강제 여부(사람 — 등록부·초안 미등재); DOC-1·DOC-2(사람) 외 2

> 개발 단계에서 **임시값·데모 데이터·완화 설정**으로 진행한 항목을, **실 서비스 배포 시점에 실데이터·운영설정으로 교정**하기 위한 일괄 작업 계획.
> 작성일: 2026-06-10 · 상태: Plan (living checklist) · 분류: 운영/보안/인프라/데이터

---

## 0. 목적 / 배경
현재는 **개발·기능검증 단계**로, 정확성보다 구현·UX 검증을 우선해 다수 항목을 임시값/데모/완화로 운영한다. 본 문서는 그 **기술부채·운영 선결 항목을 한 곳에 모아** 실 배포 직전 누락 없이 교정하기 위한 **Go-Live 체크리스트**다.
> ⚠️ 이 문서의 항목은 "개발 중에는 패스 OK, **실 배포 전 필수**"로 합의된 것.

---

## 1. 🔴 보안 (실배포 필수)

| ID | 항목 | 현재(개발) | 배포 시 조치 |
|----|------|-----------|-------------|
| SEC-1 | **AI 서버 키 git 히스토리 노출**(구 `med-bc98…`) | 신키 로테이션·코드 하드코딩 제거 완료, 단 **git 히스토리엔 잔존** | git 히스토리 secret purge(BFG/filter-repo) 또는 저장소 재생성 |
| SEC-2 | **Clinic 직원 일괄등록 기본비밀번호**(H-4) | 고정 기본비번 | 랜덤 발급 + 최초 로그인 변경 강제 |
| SEC-3 | **각종 운영 시크릿**(.env) | 개발 키/공유 시크릿 | 운영 전용 시크릿·로테이션·시크릿 매니저 |
| SEC-4 | READ 서비스계정/토큰 스코프(H-2) | 동의·환자스코프 게이트로 완화 | 토큰 스코프 최소권한 재점검 |
| SEC-5 | sudo/서버 접근 비밀번호 | 세션 내 사용 | 운영 계정 분리·키 기반·감사 |

---

## 2. 🟠 문서/법정정보 마스터 (문서충실도 연계)

| ID | 항목 | 현재 | 배포 시 |
|----|------|------|--------|
| DOC-1 | **병원 법정정보 마스터**(요양기관기호·사업자번호·대표자·주소·전화) | 데모 상수(`WRB-DEMO-…`) | **실 요양기관기호·법정정보 입력**(처방전·영수증 머리글 법정 필수) |
| DOC-2 | 병원 **직인/로고 이미지** | 데모 이미지 | 실 직인·로고 자산 등록 |
| DOC-3 | 의료진 **면허번호/서명 이미지** | 일부 데모 | 실 면허·서명 자산 검증 |
| DOC-4 | 발급번호 체계 | 규칙 적용(데모데이터) | 운영 일련/리셋 정책 확정 |
> 참조: `document-fidelity-ux.plan.md` §13.1.

---

## 3. 🟡 인프라 / 빌드

| ID | 항목 | 현재 | 배포 시 |
|----|------|------|--------|
| INF-1 | **docker 이미지 미선언 의존성**(`dompurify` 등) | CI docker 비차단(continue-on-error) | apps/web `package.json`에 선언 + lockfile + 도커 빌드 green |
| INF-2 | **PDF 엔진(헤드리스)** | ✅ **도입 완료**(browserless/chrome 격리 컨테이너 `infra/pdf`, 127.0.0.1:3505, mem 1.5G) | 실서버에 `docker compose up`(infra/pdf) + `PDF_TOKEN` 운영값 + 부팅 자동기동 확인 |
| INF-2b | **qrcode 의존성**(API, QR 생성) | dev 서버 **수동 설치**(`npm i qrcode -w @hospital-run/api`) — deploy가 dep 미설치 | 실서버 npm 의존성 설치 절차에 포함(INF-1과 동일 이슈) |
| INF-2c | **문서충실도 PDF env** | dev `.env`(`PDF_SERVICE_URL/TOKEN`, `PDF_RENDER_SECRET`) | 운영 시크릿(PDF_TOKEN·RENDER_SECRET 강화) |
| INF-2d | **IssuedDocument 테이블** | dev db push 완료 | 실서버 스키마 반영(`deploy --schema`) |
| INF-3 | **한글 폰트 번들/라이선스** | 미정 | Pretendard/나눔(OFL) 번들 임베드 확정 |
| INF-4 | SMART **issuer/도메인 운영값** | `https://his.example.org` | 운영 도메인·TLS·`FHIR_ISS` 확정 |
| INF-5 | nginx 라우팅(/.well-known·/oauth2·/fhir) | 적용됨 | 운영 nginx 재확인(스테일 백업 정리) |
| INF-6 | deploy.sh PM2_ENV | 스테일키 제거 완료 | 운영 시크릿은 서버 .env 일원화 유지 |

---

## 4. 🟢 데이터 / 기능 갭

| ID | 항목 | 현재 | 배포 시 |
|----|------|------|--------|
| DAT-1 | **시드/데모 데이터 → 실데이터 전환** | 데모 환자·동의·DicomStudy·수가 등 | 데모 정리 + 실 마스터 적재 |
| DAT-2 | **cost/dashboard 엔드포인트 부재**(QA 발견) | 원가분석 대시보드 탭 미동작 | BE 집계 엔드포인트 신설 또는 탭 정리 |
| DAT-3 | 트윈 데모 자산(동의 환자·launch) | 데모 | 실 환자 동의·운영 정책 |
| DAT-4 | AI **비저장 모드** 운영 확인 | AI팀 적용 | 실 운영 비저장 재확인 + 확인서 보관 |

---

## 5. 🔵 운영/품질 (권장)

| ID | 항목 | 배포 시 |
|----|------|--------|
| OPS-1 | **smoke-test 자동화** | deploy.sh post-deploy에 통합(라우트/500 자동 점검) |
| OPS-2 | 모니터링/알람 | 트윈 W.Channel 발신 운영화 + HIS 핵심지표 |
| OPS-3 | 백업/복구 리허설 | DB 백업·복원 검증 |
| OPS-4 | 브라우저 인쇄 매트릭스 | 문서충실도 출력 QA(Chrome/Edge/Safari) |

---

## 6. 외부 의존 (회신 대기)
- **ERP**: consumer(procurement) · 비급여 가격표 · 매핑표 · push 결과 검증
- **Clinic**: W.Sign 직원 동기화(clinicUserId) · 전자결재 운영 전환
- **Twin**: A4 launch 종단 검증 마무리 · DocumentReference 운영
> 상세: `docs/04-report/features/external-team-requests.md`

---

## 7. Go-Live 체크리스트 (요약)
- [ ] SEC-1 git secret purge · SEC-2 기본비번 랜덤 · SEC-3 운영 시크릿
- [ ] DOC-1 실 요양기관기호/법정정보 · DOC-2 직인·로고
- [ ] INF-1 docker deps · INF-2 browserless 컨테이너 기동 · INF-2b qrcode 설치 · INF-2c PDF env · INF-2d IssuedDocument 스키마 · INF-3 폰트
- [ ] DAT-1 데모→실데이터 · DAT-2 cost/dashboard
- [ ] OPS-1 smoke 자동화 · OPS-3 백업 리허설
- [ ] 외부팀 연동 운영 전환 확인

---

## 8. 갱신 이력
- v1.0(2026-06-10): 최초 — 세션 누적 부채(보안 C-2/H-4·docker deps·요양기관기호·cost/dashboard·폰트/PDF엔진·smoke 자동화 등) 일괄 정리. 개발 중 임시값 진행 + 배포 시 교정 방침.
- v1.1(2026-06-10): 문서충실도 UX 구현 반영 — INF-2(browserless 헤드리스 PDF 컨테이너 도입 완료)·INF-2b(qrcode 서버 설치)·INF-2c(PDF env)·INF-2d(IssuedDocument 스키마) 추가. 실서버 배포 시 컨테이너 기동·의존성 설치·스키마 반영 필요.
