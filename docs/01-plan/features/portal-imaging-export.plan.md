# 환자포털 PACS 영상/판독 내보내기(Export) 기획서 v1.0

> **요약**: 환자가 본인의 영상(DICOM)+판독문을 **Fernet 암호화 패키지(ZIP)로 안전하게 내려받는** 포털측 소비자 기능. PACS(OpenPACS, 별도 프로젝트)가 제공하는 patient-export API(요청→폴링→1회용 다운로드→복호)를 HIS 포털이 소비. PACS 인프라는 **무수정**(CLAUDE.md 준수) — 우리는 호출·복호·환자 UI만 구현.
>
> **작성일**: 2026-06-12 / **상태**: Draft
> **출처 규약**: PACS팀 전달 `portal-export-integration.md`(PACS repo) — API 3종·HS256 토큰·Fernet 패키지·오류코드표

## 1. 배경·구분

- 포털엔 **이미 영상 열람**이 동작(`portal/imaging` → `/pacs-api/.../patients/{mrn}/studies` 목록 + OHIF 뷰어 + 판독 PDF 프록시). **이 기능은 그것과 별개** — 환자가 영상+판독을 **암호화 패키지로 내보내기(다운로드)** 하는 신규 흐름.
- 용도: 타병원 제출(전원/2차 소견), 개인 보관.
- **책임 경계**: PACS=추출 인프라(완료·가동중) / **HIS 포털=환자 UI·세션·본인확인·토큰서명·복호·열람**.

## 2. 목표 / 비목표

**목표**
- 포털 환자가 본인 영상 패키지를 **요청 → 진행상태 확인 → 복호된 ZIP 다운로드**.
- 본인확인은 기존 포털 인증(mrn+생년월일, `PortalOrPatientGuard`) 재사용 — 토큰 `mrn`=DICOM PatientID.
- PACS 서비스 토큰(HS256, scope=patient-export, 짧은 exp)을 **백엔드에서만 서명**(브라우저 미노출).
- Fernet 복호를 **서버측에서 수행** → package_key·download_token이 브라우저에 노출되지 않음(규약 최소요건 초과 강화).

**비목표(범위 밖)**
- PACS 추출 인프라·nginx `/pacs-api/`·orthanc·openpacs DB 수정(금지).
- 새 DICOM 웹뷰어(열람은 기존 OHIF 재사용). 익명화(원본 본인 제공).
- 예비판독 포함(final/addendum만 — PACS측 정책).

## 3. 기능 요구사항 (FR)

| ID | 요구 | 우선 |
|----|------|------|
| FR-1 | 내보내기 **요청**: 포털 환자가 purpose(+선택 studyUids) 지정 → 백엔드가 PACS `POST /patient-export/requests` 호출(서명 토큰), requestId 반환 | P0 |
| FR-2 | **진행상태 폴링**: 포털이 백엔드 `GET export/:id` 폴링(2초/최대5분) → 백엔드가 PACS `GET requests/{id}` 폴링·status 반환. download_token/package_key는 **브라우저 미반환** | P0 |
| FR-3 | **다운로드+복호**: ready 시 백엔드가 1회용 download_token+package_key로 패키지 수령 → **Fernet 서버 복호** → 복호 ZIP을 환자에게 스트림 | P0 |
| FR-4 | **본인확인 신뢰**: 토큰 mrn=로그인 환자 mrn(서버에서 강제). 타인 mrn 요청 불가 | P0 |
| FR-5 | **감사**: 요청·다운로드 전부 `PortalAuditLog`(action=IMAGING_EXPORT_*, detail=purpose·requestId·studyCount) | P0 |
| FR-6 | **포털 UI**: `portal/imaging`에 "내보내기" — purpose 선택·요청·진행바·다운로드 버튼 | P0 |
| FR-7 | **오류 처리**: PACS 오류코드표 매핑(410 재요청 만료, 폴링 타임아웃, 토큰 거부) → 사용자 메시지 | P1 |
| FR-8 | **purpose 코드**: SELF_VIEW·SECOND_OPINION·TRANSFER·PERSONAL_ARCHIVE (감사·동의 기록) | P1 |

## 4. C 결정사항 (PACS 운영자 협의 — 기획 반영안)

| # | 결정 | 기획안 | 회신 필요 |
|---|------|--------|----------|
| C-1 | 공유 시크릿 | `pacs.exportSecret`(config-runtime, 미설정 시 거부). HS256. **실값은 PACS와 동일 설정 필요**(SSO 공유 시 영향 확인) | ⚠️ 운영 합의 |
| C-2 | 포털 egress IP | **198.51.100.73**(his.example.org) — PACS nginx `/portal-export/` allow 등록 요청 | ✅ 제공 |
| C-3 | 포털 보관 TTL | **미보관(스트림 복호 후 즉시 전달)** — 디스크 잔류 0. (PACS 스테이징 24h 자동삭제) | ✅ 권고 채택 |
| C-4 | purpose 코드 | 위 4종(§FR-8) | ✅ 제안 |
| C-5 | 열람 방식 | 다운로드 전용(ZIP). 열람=기존 OHIF 재사용 | ✅ |

## 5. 재사용 자산 (실측)

| 자산 | 위치 | 용도 |
|------|------|------|
| `PortalOrPatientGuard` | patient-auth/guards | 포털 본인 가드(req.portalPatientId) |
| `getPatientMrn(patientId)` | portal.service.ts:794 | 로그인 환자 → mrn(=DICOM PatientID) |
| imaging 프록시 패턴 | portal.controller.ts:403·551 | PACS fetch + 본인 study 검증 패턴 |
| `PACS_API_URL` env | (기존) | PACS 베이스 URL(`/pacs-api` 대응) |
| config-runtime get/set | config/config-runtime.service | `pacs.export*` 키 |
| `PortalAuditLog` | portal.service.ts:436 logAudit | 감사 |
| Node `crypto` | builtin | Fernet(AES128-CBC+HMAC-SHA256) 직접 구현(무 npm 의존) |

## 6. 보안

- 토큰·package_key·download_token **로깅 금지**, 브라우저 미노출(서버측 처리).
- HS256 서명 시크릿 미설정 시 기능 비활성(거부).
- 본인확인: 토큰 mrn=세션 mrn 강제. studyUids 지정 시 본인 study 소유 검증(기존 패턴).
- 전송 TLS, 포털 디스크 미보관(스트림).
- 패키지: final/addendum 판독만(PACS), 원본 DICOM(본인 제공).

## 7. 구현 순서 (Phase)

1. **P0-BE**: `pacs-export` 로직(portal 모듈 확장) — 서명 토큰·요청·폴링·Fernet 복호·스트림. config 키·감사.
2. **P0-FE**: `portal/imaging` 내보내기 UI(purpose·진행·다운로드).
3. **P1**: 오류코드 매핑·UX·검증 하니스 대조(`patient_export_test.py` 흐름).
4. **배포·검증**: config 시크릿 설정 후 스테이징 E2E(요청→복호 다운로드).

## 8. 리스크

- 공유 시크릿(C-1) 미합의 시 실가동 불가 → config 키 준비·placeholder, 합의 후 주입.
- Fernet 구현 정확성 → PACS `patient_export_test.py`·복호 예시로 대조 테스트.
- 폴링 부하 → 백엔드 폴링 상한(5분)·프론트 간격 2초 준수.
