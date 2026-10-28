# 환자포털 PACS 영상/판독 내보내기 설계서 v1.0

> Plan: [portal-imaging-export.plan.md](../../01-plan/features/portal-imaging-export.plan.md) (v1.0)
> 작성일: 2026-06-12 / 상태: Draft
> 핵심: PACS patient-export API(요청→폴링→1회용 다운로드→Fernet 복호)를 **백엔드에서만** 소비. 토큰·키 브라우저 미노출. 포털 디스크 미보관(스트림).

## 1. 아키텍처

```
[환자 브라우저] portal/imaging "내보내기"
   │  (포털 JWT, PortalOrPatientGuard)
   ▼
[HIS API] portal 모듈 — PacsExportService
   │  ① 서명: HS256 JWT(scope:patient-export, mrn, exp 10m, pacs.exportSecret)
   │  ② POST /pacs-api/api/v1/patient-export/requests        → requestId
   │  ③ GET  /pacs-api/api/v1/patient-export/requests/{id}   → status(폴링)
   │  ④ ready → download_token+package_key 수령
   │  ⑤ GET  /portal-export/{download_token} (1회용) → Fernet ZIP
   │  ⑥ Fernet 복호(package_key, Node crypto) → 평문 ZIP
   ▼  (스트림, 디스크 미보관)
[환자 브라우저] ZIP 다운로드
```
> PACS(OpenPACS) 인프라 무수정. `PACS_API_URL`(기존 env)로 베이스 접근. `/pacs-api`·`/portal-export` 경로는 PACS 소유.

## 2. 데이터 — 신규 모델 0

상태는 PACS가 보유(요청 status). HIS는 무저장(스트림). 감사만 기존 `PortalAuditLog` 재사용.
- (선택) 진행상태를 클라가 폴링하므로 HIS 서버 세션/캐시 불필요 — requestId를 클라가 보관, 매 폴링에 mrn 검증.

## 3. config-runtime 키 (신규)

| key | 기본 | 설명 |
|-----|------|------|
| `pacs.exportEnabled` | `false` | 내보내기 기능 토글 |
| `pacs.exportSecret` | `''` | HS256 공유 시크릿(미설정 시 503 거부) — C-1, PACS와 동일값 |
| `pacs.exportBaseUrl` | `''` | PACS 베이스(미설정 시 `PACS_API_URL` env 폴백) |

## 4. API (포털, PortalOrPatientGuard, prefix `/api/v1/portal`)

| 메서드·경로 | 설명 | 응답 |
|-------------|------|------|
| `POST imaging/export/request` | body `{purpose, studyUids?}` → PACS 요청 생성 | `{requestId, status:'pending'}` |
| `GET imaging/export/:requestId` | 진행상태 폴링(서버가 PACS 폴링 1회) | `{status:'pending'\|'ready'\|'expired'\|'error', progress?}` (token·key **미포함**) |
| `GET imaging/export/:requestId/download` | ready 시 1회용 수령+복호+스트림 | `200 application/zip`(첨부) 또는 `{error}` |

### 4.1 서명 토큰 (서버 내부, 매 PACS 호출마다 신규)
```ts
jwt.sign({ scope: 'patient-export', mrn, purpose }, pacsExportSecret, { algorithm: 'HS256', expiresIn: '10m' })
```
- mrn = `getPatientMrn(req.portalPatientId)` — **세션에서만 도출**(클라 입력 mrn 불신).
- studyUids 지정 시 본인 study 소유 검증(기존 `imaging/report/:studyUid/pdf` 패턴 재사용).

### 4.2 오류코드 매핑 (PACS 오류표 → 포털)
| PACS | 포털 error.code | 메시지 |
|------|----------------|--------|
| 401/403 토큰 | `EXPORT_AUTH` | 인증 오류(재시도) |
| 410 1회용 만료 | `EXPORT_CONSUMED` | 다운로드 만료 — 다시 요청 |
| 404 | `EXPORT_NOT_FOUND` | 요청을 찾을 수 없음 |
| 폴링 타임아웃(5m) | `EXPORT_TIMEOUT` | 준비 지연 — 잠시 후 재시도 |
| 503(설정 미비) | `EXPORT_DISABLED` | 기능 비활성 |

## 5. Fernet 복호 (Node crypto, 무 npm 의존)

Fernet 토큰 구조: `base64url( 0x80 | ts(8) | iv(16) | ciphertext | hmac(32) )`, key=base64url(32B)= `signingKey(16) || encKey(16)`.
```ts
// fernet.util.ts
function fernetDecrypt(token: string, key: string): Buffer {
  const k = b64urlToBuf(key);                 // 32B
  const signKey = k.subarray(0,16), encKey = k.subarray(16,32);
  const data = b64urlToBuf(token);
  const mac = data.subarray(data.length-32);
  const body = data.subarray(0, data.length-32);
  // HMAC-SHA256(signKey, body) === mac (timingSafeEqual)
  const iv = body.subarray(9, 25);
  const ct = body.subarray(25);
  // AES-128-CBC decrypt(encKey, iv, ct) → PKCS7 unpad
}
```
- 버전 0x80·HMAC 검증 실패 시 거부(`EXPORT_DECRYPT`). TTL 미적용(패키지는 즉시 복호).
- 패키지가 클(수백MB) 수 있어 스트림 고려하나, Fernet은 단일 토큰 단위 → PACS가 ZIP 전체를 1 Fernet 토큰으로 주면 메모리 1회 복호 후 스트림. (대용량 시 청크 협의 — P1)

## 6. 포털 UI (`portal/imaging/page.tsx` 확장)

- 상단 "내보내기" 버튼 → 모달: purpose 선택(SELF_VIEW·SECOND_OPINION·TRANSFER·PERSONAL_ARCHIVE) + (선택)study 체크 → 요청.
- 요청 후 진행바: `GET export/:id` 2초 폴링(최대 5분), status 표시.
- ready → "다운로드" → `GET export/:id/download` → 브라우저 ZIP 저장(Blob).
- 오류 시 코드별 안내. 미보관 안내 문구("받은 파일은 안전히 보관·삭제하세요").

## 7. 감사 (PortalAuditLog 재사용)

| 시점 | action | detail |
|------|--------|--------|
| 요청 | `IMAGING_EXPORT_REQUEST` | `purpose=..; studies=N; requestId=..` |
| 다운로드 | `IMAGING_EXPORT_DOWNLOAD` | `requestId=..; bytes=..` |
- 토큰·package_key·download_token **미기록**(보안).

## 8. 보안 (Plan §6 구체화)

- 시크릿/키 로깅 금지, 브라우저 미노출(서버 처리). HS256 시크릿 미설정 시 503.
- mrn=세션 도출. studyUids 본인 소유 검증.
- 전송 TLS, 포털 디스크 미보관(메모리 스트림).
- Throttle: `export/request`에 `@Throttle`(분당 제한) — 폴링은 제외/완화.

## 9. 구현 순서

1. `fernet.util.ts`(복호) + 단위 검증(PACS 예시 토큰 대조).
2. `PacsExportService`(서명·요청·폴링·복호) + config 키 3종.
3. portal.controller export EP 3종 + 감사.
4. `portal/imaging` UI 확장.
5. 빌드·배포(config 시크릿은 PACS 합의 후 주입, 그 전까지 `pacs.exportEnabled=false`).

## 10. 테스트

| 영역 | 케이스 |
|------|--------|
| Fernet | PACS `patient_export_test.py` 산출 토큰 복호 일치, HMAC 위변조 거부 |
| 본인확인 | 타 mrn studyUid 요청 403, 세션 mrn 강제 |
| 흐름 | 요청→pending→ready→복호 ZIP, 410 재요청 안내, 타임아웃 |
| 보안 | 응답/로그에 token·key 부재 확인 |
| 비활성 | 시크릿 미설정 시 503 |

## 11. 미해소(운영 합의)

- C-1 `pacs.exportSecret` 실값(PACS와 동일·SSO 영향).
- C-2 PACS nginx `/portal-export/` egress allow에 198.51.100.73 등록.
- 대용량 패키지 Fernet 청크/스트림 협의(P1).
