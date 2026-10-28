# 직원 ESS 급여 기초정보 관리 기획

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/prisma/schema.prisma:5621 model StaffDependent · apps/api/prisma/schema.prisma:5640 model StaffDocument · apps/api/src/modules/ess/ess.controller.ts:228 · 잔여: P1 ERP 릴레이 보안채널(사람); P2 연말정산 연계·변경이력·만료알림(CLI)

- **버전**: v0.1 (2026-07-08·초안·경계 결정 대기)
- **목표**: 재직 직원이 본인 **계좌번호·주민등록번호·부양가족·입사서류**를 직접 등록/관리(취업 시 수집정보의 셀프 관리 surface). 급여 처리 SoT는 ERP.
- **위치**: `/ess`(직원 셀프서비스) 내 "급여 기초정보" 탭 (+ `/staff` 런처 타일)

## 1. 현황(조사 결과)
- **현행 방침**: 주민번호·계좌를 **HIS가 구조화 저장 안 함** — 서류(ID_CARD/BANKBOOK 암호화 이미지)로만 수집, **ERP가 서류 열람 후 입력**(`schema.prisma:10768`·onboarding profile 주석). 급여 산정/지급·확정 인사 = **ERP SoT**.
- **재사용 자산(풍부)**: `EncryptionService`(AES-256-GCM·`maskNationalId`·`validateNationalId`), patient HMAC 블라인드인덱스, 온보딩 `saveEncryptedDocument`/`readDocumentFile`(암호화+감사), `OnboardingProfile.dependents`(Json), ESS `@CurrentUser` 본인 스코프, `/hr/me`.
- **미존재**: Staff에 계좌/주민/부양/서류 필드 없음 → 신규 모델 필요.

## 2. 설계 경계 결정 (⚠️ 선결)
| 옵션 | 계좌·주민번호 | 장점 | 단점 |
|---|---|---|---|
| **A. 서류만(현행 유지)** | HIS 미보관·이미지만·ERP 입력 | 규제 노출 최소·경계 불변 | 셀프 "관리" UX 약함(수정=재업로드) |
| **B. 릴레이만(HIS 미보관)** | HIS 폼 입력→암호화→ERP 전송·**HIS 미저장**(마스킹 표시는 ERP 조회) | 셀프입력 UX·HIS 보관책임 회피 | ERP 실시간 조회/수신 EP 필요 |
| **C. 암호화 저장+릴레이(권장)** | HIS **암호화 저장**(masking+감사)+ERP 릴레이·ERP=처리 SoT | 셀프 조회/수정 UX 완전·오프라인 확인 | HIS 주민번호 보관→규제강화(암호화·접근통제·보관근거·파기정책 필수) |

**권장 = C**(사용자 의도 "여기서 관리"에 부합). 단 주민번호 보관은 개인정보보호법 강규제 → 암호화·마스킹·최소열람·감사·보관근거·파기 필수. **부양가족·서류는 어느 옵션이든 HIS 구조화 저장**(민감도 낮음·단 부양가족 주민번호는 동일 보호).

## 3. 데이터 모델(옵션 C 기준·신규)
```
model StaffPayrollProfile {         // 직원 1:1
  staffId            (unique·FK)
  bankName           String?
  bankAccountEnc     String?        // AES-256-GCM 암호문
  bankAccountMasked  String?        // ***-**-**1234 표시용
  bankHolder         String?        // 예금주(본인확인)
  residentIdEnc      String?        // 주민번호 암호문
  residentIdHash     String?        // HMAC 블라인드인덱스(중복/검증)
  residentIdMasked   String?        // 720108-1******
  relayedToErpAt     DateTime?      // ERP 릴레이 시각
  updatedBy/updatedAt
}
model StaffDependent {              // 부양가족 N
  staffId (FK)
  name, relation(배우자/자녀/부/모…), birthDate
  residentIdEnc/Hash/Masked?        // 인적공제용(동일 보호)
  isDependent Boolean               // 인적공제 대상 여부
  disabled/senior 등 공제구분?
}
model StaffDocument {               // 입사/급여 서류 N (온보딩 패턴 복제)
  staffId (FK)
  category(BANKBOOK|ID_CARD|FAMILY_CERT|…), fileKey(암호화), sensitive, status
}
```
- 암호화=`EncryptionService` 주입·`ENCRYPTION_KEY`. 서류=`saveEncryptedDocument`/`readDocumentFile` 재직자 복제(uploads/staff).

## 4. API(본인 스코프·ESS)
- `GET /ess/payroll-profile` — 본인 급여기초(마스킹 반환·평문 미노출)
- `PUT /ess/payroll-profile` — 계좌/주민 등록·수정(서버 암호화·validateNationalId·감사)
- `GET/POST/DELETE /ess/dependents` — 부양가족 CRUD
- `GET/POST /ess/documents` + `GET /ess/documents/:id/file` — 서류 업/다운(암호화·감사)
- (옵션 C) `POST /ess/payroll-profile/relay` 또는 저장 훅에서 ERP 릴레이 이벤트 발행
- 전부 `@CurrentUser('id')`→Staff 본인 매칭(IDOR 차단). 관리자 열람은 별도 HR EP+감사.

## 5. 보안·컴플라이언스(옵션 C)
- 저장: 암호문만. 응답: **항상 마스킹**(평문 반환 EP 없음). 수정 시 전체 재입력(부분노출 금지).
- 감사: 모든 읽기/쓰기 PII 접근 로그(온보딩 패턴). 접근=본인+ERP릴레이+HR최소열람.
- 보관근거·파기: 퇴사 후 보관기간·파기 정책(법정). **법무 확인 게이트**.
- 전송: ERP 릴레이는 보안채널(§9 오픈이슈) — 아래 ERP 요청서.

## 6. 단계
- **P0**: 모델+ESS 급여기초 탭(부양가족·서류=저위험 먼저) + 계좌/주민(옵션 확정 후)
- **P1**: ERP 릴레이(보안채널 합의 후) + 관리자 열람(HR·감사)
- **P2**: 연말정산 연계·변경이력·서류 만료알림

## 7. ERP 요청서(별첨) → `docs/03-analysis/his-erp-payroll-intake-requests.md`
