# 신규입사 온보딩 + 직원 행정 셀프서비스 포털 기획서 v1.4

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/prisma/schema.prisma:85 · apps/web/src/app/onboarding/[token]/welcome/page.tsx · apps/api/prisma/schema.prisma:13464 model OnboardingContract · 잔여: P6 입사서류 보존/파기 cron(CLI); 오픈이슈 1·2·2-1 ERP 근태 정합·Clinic 결재 라우팅(사람); 오픈이슈 9 노비스 네이밍(사람)

<!-- 개정이력: v1.0 신설 → v1.1 사이드바 '신규 입사자 관리' 시작점 → v1.2 SMS제거·생체우선 → v1.3 입사 개인정보 입력 → v1.4 환영/회사소개 페이지 + 재검증 정정(모델10·FR44·accountStage) -->


> **요약**: 신규 직원·의료진의 **입사 전 온보딩(초대 링크 → 서류 제출 → 전자계약 → 계정 부팅)**부터, 입사 후 **비밀번호 없이(생체/패스키)** 근태·휴가·증명서·인사정보 등 **행정 업무만 가볍게 처리**하는 직원 셀프서비스(ESS) 포털을 신설한다. 기존 직원 패스워드리스 SSO·QR 페어링·ERP 인사연동 자산을 **재사용**하고 새 화면만 비파괴로 추가한다.
>
> **프로젝트**: Hospital RUN (한국형 대학병원급 HIS)
> **버전**: v3.10.0 기반
> **작성일**: 2026-06-10
> **우선순위**: P1 (입사 운영성 + 직원 행정 경험 — HR/근태 컴플라이언스 직결)
> **상태**: Draft (기획 착수)
> **규모(예상)**: FR 44개 · 신규모델 10(+SystemConfig/HospitalInfoContent 재사용) · 신규모듈 3 · 6 Phase · **P1 선행: `User.accountStage` 신규필드 + 온보딩 인증 스코프**(설계 §5.6)

---

## 1. 기획 배경

### 1.1 현재의 빈틈
| 영역 | 현재 상태 | 빈틈 |
|------|-----------|------|
| 신규입사 처리 | 관리자가 `/admin`에서 직원(Staff/User)을 **수기 생성** | 입사 전 **본인 서류 제출·계약 서명 채널 없음**, 계정 발급이 전부 관리자 부담 |
| 입사 서류 | 이메일·종이로 통장사본·자격증·서약서 수집 | 보안·추적·보존 미흡(개인정보·근로기준법 위반 리스크) |
| 계정 발급("부팅") | 관리자가 ID/임시PW 수기 통보 | 최초 로그인→비번변경→패스키 등록까지 **연결 흐름 없음** |
| 직원 행정 | HIS 본체(307페이지)에 행정 기능이 진료 화면과 **섞여 있음** | 비임상 직원·신규자가 "근태·휴가·증명서"만 **가볍게** 쓸 단일 화면 부재 |
| 출퇴근(근태) | HIS는 근무 스케줄(`schedule_changed`)만 ERP에 전달 | **실 출퇴근 체크(타임클럭) 수단 없음** |
| 인증 | 직원 SSO(패스키)는 **재직자**만 대상 | **미발령 입사예정자(계정 전 단계)** 인증 채널 없음 |

### 1.2 요구사항 (사용자 요지)
> "신입직원·신규의료진 계약 시 **노비스 가입 단계 링크**로 입사 서류를 등록하게 하고, **ID/PW 등 입사 부팅 프로세스**와, 직원이 **노패스워드로 인사·근태·행정 업무를 보는 웹**을 만든다. 현재 HIS의 행정 기능 중 **편하게 쓰는 것만** 담고, **특정 화면 QR코드 인증**과 **기존 스텝용 생체로그인**을 사용한다."

분해:
1. **온보딩 초대 링크(노비스 가입 단계)** — 계정 없는 입사예정자가 토큰 링크로 들어와 본인확인 후 서류 제출.
2. **입사 서류 등록** — 신분증·통장사본·자격/면허·서약서·건강검진 등 카테고리별 업로드·검증.
3. **전자계약** — 근로/위촉 계약서 전자서명(기존 동의서/서명 엔진 재사용).
4. **계정 부팅 프로세스** — 입사예정자 단계에 임시계정(PRE_BOARD)+스마트폰 생체등록 → 승인 시 계정 활성화(사번·권한 부여) → 같은 생체로 패스워드리스 로그인(임시비번·SMS 없음).
5. **행정 셀프서비스(ESS) 웹** — 근태·휴가·증명서/급여·인사/교육/자격 **조회·신청 중심**의 가벼운 포털.
6. **QR 인증** — 출퇴근 체크, 공용단말 빠른 로그인, 서류제출 본인확인, 교육/회의 출석, 문서 수령.
7. **패스워드리스** — 기존 직원 패스키(WebAuthn/생체) 로그인 그대로 사용.

### 1.3 목표 (한 줄)
```
입사예정자: 초대 링크 한 번 → 서류·계약 끝 → 출근 첫날 생체등록으로 "내 계정 부팅".
재직자: 비밀번호 없이 ESS 한 화면에서 출퇴근·휴가·증명서·내 정보만 빠르게. 고위험만 QR/생체 step-up.
```

### 1.4 SoT(정보주체) 경계 — 사용자 확정
- **온보딩·계정·근태원천·입사서류 = HIS 소유.**

### 1.5 컴플라이언스
- **근로기준법** — 근태(출퇴근) 기록 보존(임금명세 관련 3년), 근로계약서 서면 교부(전자교부 인정).
- **전자문서법/전자서명법** — 근로계약 전자서명 효력, 타임스탬프·서명자 본인확인 증빙.
- **개인정보보호법** — 입사서류(주민번호·계좌·면허)는 **암호화 저장·접근통제·보존기간 후 파기**. 생체정보는 단말 보안영역(Secure Enclave/TPM)에만, 서버는 **공개키만**. **안면인식(Face Tracking)은 '생체인식정보' 처리 → 온보딩 동의·온디바이스 처리**(FR-F7).
- **위치정보법** — BLE 근접성 검증용 위치정보는 온보딩 Opt-in 동의·**궤적 비저장(휘발성)**(FR-F7). 단말 보안 트랙 상세: [security-governance-master](security-governance-master.plan.md) §6.
- **EMR 인증/JCI(SQE)** — 인력 자격·면허 관리, 접근통제, 감사로그.

---

## 2. 재사용 vs 신규

### 2.1 재사용 (기존 자산)
> ★ **실측 audit(설계 §0-Y·§2.3)**: `hr`·`staff-qualification` 모듈이 인사 핵심을 이미 구현 → 아래 다수는 **신규 아님**.

| 자산 | 위치/근거 | 활용 |
|------|-----------|------|
| **`hr` 모듈** | `/hr/staff`(CRUD)·**`/hr/me`(ESS 내 정보)**·`/hr/schedule`·`/hr/departments` + **ERP outbox 자동발행**(`hr.service.emitStaff`: staff.created/changed/resigned/schedule_changed) | Staff CRUD·ESS 내 정보·근무표·ERP 송신 **그대로 재사용**, 온보딩 활성화가 `hr.service.create` 호출 |
| **`staff-qualification` 모듈** | `/staff-qualification` credentials(verify)·education·dashboard (`StaffCredential`·`StaffEducation`) | **면허/자격·의무교육 입력·검증·조회 재사용**(온보딩 면허→credential 행) |
| 패스키/WebAuthn | `auth/passkey`(register/login·verify) + `WebAuthnCredential` | **생체등록(로그인정보 등록)+ESS 로그인** |
| AuthService(JWT 8h·refresh 7d·Redis 세션·동시세션) | `apps/api/.../auth/auth.service.ts` | ESS 세션·토큰 발급 동일 코어 |
| RBAC(UserRole·Permission·RolesGuard) | `auth/rbac/`·`guards/` | ESS는 **신규 경량 권한(ESS_*)**, 행정 화면 노출 제어 |
| **QR 6자리 페어링·자동/수동 승인·SSE 실시간** | [consent-signing-device](consent-signing-device.plan.md) | **공용단말 로그인·출퇴근·서류제출·출석 QR 전부 이 패턴 재사용** |
| 디바이스 등록(StaffDevice·device-enroll QR) | `staff-devices` 모듈 | 근태 단말/키오스크 등록에 재사용 |
| 전자서명/동의서 엔진(서명패드·PDF·블록체인 로그) | consent-* / `BlockchainCertificate` | **근로계약 전자서명·서류 본인서명** 재사용 |
| Staff/User(employeeNumber·category·department·status·hireDate) | `prisma/schema.prisma` | 계정 부팅 결과물, ESS 신원 |
| **W3 HR outbox**(staff.*·schedule_changed·qualification_changed) | W3 명세 + `/admin/erp` | 입사확정·근태·자격을 ERP로 송신 |
| ERP 읽기(급여/인사 매핑) | `/api/v1/integration/hr/staff/*` | ESS에서 **급여명세·발령** 표시 |
| SQE(자격·교육) | `/admin/sqe` | 면허·자격·의무교육 이수현황 ESS 노출 |
| AuditLog | 기존 | 온보딩·서류·계약·근태·QR 전 이벤트 감사 |
| Self-healing MediaService(파일 스캔 복구) | CLAUDE.md | 서류 파일 무결성 |

### 2.2 신규 구축
| 항목 | 사유 |
|------|------|
| **온보딩 모듈**(초대·서류·계약·부팅) | 계정 전(前) 단계 신원·플로우는 기존에 없음 |
| **ESS 모듈**(근태·휴가·증명서·내 정보) | 직원 셀프서비스 단일 진입점 신규 |
| **근태(타임클럭) 모듈** | HIS에 실 출퇴근 체크 수단 없음(스케줄만 존재) |
| **OnboardingInvite Guard**(토큰 기반, 계정 전 인증) | 재직자 JwtAuthGuard로 커버 불가 |

---

## 3. 용어 정의

| 용어 | 정의 |
|------|------|
| **노비스(Novice) 온보딩** | 입사예정자가 계정 발급 전 거치는 셀프 가입·서류·계약 단계 |
| **온보딩 초대(OnboardingInvite)** | HR이 발급하는 1회성 토큰 링크(만료·재발급·상태기계) |
| **계정 부팅/활성화(Account Boot)** | 임시계정(PRE_BOARD)+생체등록(온보딩 단계)→HR 승인 시 활성화(ACTIVE·사번·ESS권한)→같은 생체로 패스워드리스 로그인 |
| **ESS(Employee Self-Service)** | 직원이 본인 행정 업무만 처리하는 경량 포털(`/ess`) |
| **타임클럭(TimeClock)** | 출퇴근 체크 단말/벽면 QR + 개인 단말 스캔 |
| **step-up** | 고위험 행위(계약서명·정보수정) 시 생체/QR 추가확인 |

---

## 4. 페르소나 & 핵심 여정

### 4.1 페르소나
- **입사예정자(Candidate)**: 계정 없음. 휴대폰/개인 PC로 초대 링크 접속.
- **신규 의료진(위촉)**: 면허·자격 검증 비중 높음.
- **재직 행정직/간호/의료진**: 매일 출퇴근·가끔 휴가/증명서.
- **HR 담당자**: 초대 발급·서류 검토·계약·부팅 승인.
- **부서장**: 휴가/근태정정 승인.

### 4.2 온보딩→부팅 여정 (Happy Path)
```
[HR] 입사예정자 등록 → 초대 발급(이메일 + QR 이미지 + 링크, 동일 토큰)
   ↓
[Candidate] 링크/QR 진입 → 생년월일 확인 → 임시계정 → 스마트폰 생체등록(로그인정보 등록)
   ↓
   환영 페이지(회사 소개·미션/비전·문화·복지·시설·온보딩 가이드·행동강령 숙지)
   ↓ 체크리스트
   인적사항(개인정보) 입력(기본/주소/비상연락처/계좌/학력·경력·면허/병역·부양·동의)
   → 서류 업로드(신분증·통장·면허·서약서·건강검진)
   ↓
   근로/위촉 계약서 검토 → 전자서명(생체 step-up) → PDF 교부
   ↓
[HR] 인적사항·서류(신분증 대조)·계약 검토 + 4-eyes 승인 → "계정 활성화"
   ↓ 자동
   임시계정(PRE_BOARD) 활성화 + employeeNumber 채번 + ESS_* 권한
   → 핵심 인적사항 User 매핑 + 전체 W3: staff.created → ERP 송신(확정 인사 SoT=ERP)
   ↓
[직원] 출근 첫날: 온보딩 때 등록한 스마트폰 생체로 바로 로그인 (임시비번·SMS 없음)
   ↓
   이후 ESS·HIS 모두 패스워드리스 (기존 SSO)
```
> **로그인 정보 등록 = 입사자가 폰에서 하는 생체등록**. 입사예정자 단계에 임시계정(PRE_BOARD)을 만들어 기존 패스키 백엔드(`auth/passkey`, 실작동)로 생체를 등록하고, 승인 시 그 계정을 활성화하므로 **같은 생체가 그대로 직원 로그인 자격**이 된다(SMS/임시비번 제거 — SMS는 현재 시뮬레이션이라 실발송 불가).

### 4.3 일상 ESS 여정
```
출근: 벽면/단말 QR 스캔(또는 개인폰 QR 제시) → 출근 체크 → "오늘 근무 09:00–18:00"
휴가신청: 연차 잔여 확인 → 신청 → 부서장 승인(알림) → 근태 반영 → ERP
증명서: 재직증명 발급 → PDF(직인·QR 진위) 즉시 다운로드
퇴근: QR 퇴근 체크 → 근태 outbox → ERP 급여산정
```

---

## 5. 기능 요구사항 (FR)

### A. 온보딩 초대 & 본인확인 (계정 전 단계)

> **기능의 시작점 = 관리자/행정과 전용 사이드바 메뉴 `신규 입사자 관리`(`/admin/onboarding`).** 모든 초대 발급(이메일·QR 이미지·1회용 링크)은 이 메뉴에서 출발한다. 별도 진입 경로는 만들지 않는다(단일 진입점).

| ID | 요구사항 | 우선 |
|----|----------|------|
| FR-A0 | **사이드바 `신규 입사자 관리` 메뉴 신설** — `관리자` 그룹 내 `직원 관리`(`/admin/staff-management`) 인접 배치, 권한 `ADMIN`/`HR_MANAGER`. 이 화면이 온보딩 기능의 **유일한 시작점** | P0 |
| FR-A1 | `신규 입사자 관리`에서 입사예정자 등록(**성·이름 분리**·생년월일·연락처·직종·부서·입사예정일·계약유형) + 목록/상태 추적. ※성/이름·생년월일은 임시계정 생성·본인확인 필수(설계 §5.7) | P0 |
| FR-A2 | 등록 즉시 **1회성 초대 발급 — 3가지 전달수단**: ① 이메일 자동발송(링크+QR 첨부) ② **QR 이미지 다운로드/인쇄**(대면 전달용) ③ 링크 복사. 만료(기본 14일)·재발급·폐기·발송이력 | P0 |
| FR-A3 | 링크/QR 진입 시 **본인확인 = 생년월일 대조 + 스마트폰 생체등록(패스키)**. SMS OTP 미사용(실발송 불가·시뮬레이션). 최종 신원보증은 HR 신분증 서류 대조(승인 단계) | P0 |
| FR-A4 | 온보딩 상태기계: `INVITED→VERIFIED→DOC_SUBMITTED→CONTRACT_SIGNED→APPROVED→BOOTED→(EXPIRED/REVOKED)`, `신규 입사자 관리`에서 실시간 추적(SSE) | P0 |
| FR-A5 | 초대 링크 남용 방어(Throttle·1회용 토큰·IP/디바이스 기록·발송 감사) | P0 |

### B. 입사 개인정보 입력 & 서류 제출
| ID | 요구사항 | 우선 |
|----|----------|------|
| FR-B0 | **입사 개인정보(인적사항) 입력폼** — 직원이 직접 입력. 항목: ① 기본(한글/한자/영문성명·생년월일·성별·국적·휴대폰·이메일·사진) ② 주소(우편번호·기본·상세, 다음 주소검색 재사용) ③ 비상연락처(성명·관계·전화) ④ 학력 ⑤ 경력(의료진) ⑥ **면허/자격**(종류·번호·취득일·발급기관, 의료진 필수) ⑦ 병역 ⑧ 부양가족(4대보험·연말정산). ※**주민번호·급여계좌는 입력폼에서 제외** — 서류(신분증·통장사본)로만 제출, ERP가 서류 보고 입력(§9.5.1 req4) | P0 |
| FR-B0a | **주민번호·계좌는 HIS 구조화 수집 안 함**(PII 부담 감소). 신분증·통장사본은 서류로 받고, **ERP에 해당 서류 보안 열람 경로 제공**(req4-b). 직종별 필수/선택 동적 | P0 |
| FR-B0b | **민감/고유식별정보 수집 별도 동의**(개인정보보호법 §23·§24) — 목적·항목·보존기간 명시, 미입사자 파기 | P0 |
| FR-B1 | 서류 카테고리 정의(신분증·통장사본·면허/자격증·경력증명·서약서·건강검진·사진 등), 직종별 **필수/선택 동적** | P0 |
| FR-B2 | 업로드(이미지/PDF, 다중·재업로드), 미리보기, 진행률 체크리스트(인적사항+서류 통합) | P0 |
| FR-B3 | 민감서류 **암호화 저장**·접근통제·보존기간·파기 정책 | P0 |
| FR-B4 | HR 인적사항·서류 검토(반려 사유·재요청), 면허는 **자격 검증(SQE 연계)** | P1 |
| FR-B5 | 신분증 OCR로 인적사항 자동 채움(원본 저장 안 함, 기존 접수 OCR 패턴 재사용) | P2 |
| FR-B6 | 활성화 시 핵심 인적사항 **User 매핑** + 전체 **W3 staff.created로 ERP 전송**(확정 인사 SoT=ERP) | P0 |

### C. 전자계약 & 계정 부팅
| ID | 요구사항 | 우선 |
|----|----------|------|
| FR-C1 | 근로/위촉 계약서 템플릿 → 변수 바인딩 → **전자서명(step-up)** → PDF 교부·보존 | P0 |
| FR-C2 | HR 신분증 서류 대조 + 최종 승인(**4-eyes**) → 트랜잭션으로 **임시계정(PRE_BOARD) 활성화**·employeeNumber 채번 | P0 |
| FR-C3 | **로그인 정보 등록은 입사예정자 단계의 스마트폰 생체등록으로 이미 완료** → 활성화 시 같은 생체가 직원 로그인 자격. **임시비번/SMS 발급 없음**(SMS 시뮬레이션이라 제외) | P0 |
| FR-C4 | 활성화 시 **기본 권한(ESS_*) 자동 부여**, 직종별 기본 역할 매핑(임시계정은 활성화 전 로그인·권한 0) | P0 |
| FR-C5 | 활성화 결과 **W3 `staff.created`** outbox 송신(ERP 인사 동기화) | P0 |
| FR-C6 | 활성화 사가(사전조건 검증·트랜잭션 롤백·채번 충돌 재시도·감사), 폰 교체 시 생체 재등록 | P1 |

### D. 행정 셀프서비스(ESS) — 사용자 확정 4영역
| ID | 요구사항 | 우선 |
|----|----------|------|
| FR-D1 | **근태**: 출퇴근 체크(QR/생체), 내 근무표·교대 조회, 출퇴근 이력 | P0 |
| FR-D2 | **휴가·연차·근태정정 신청**: 잔여 조회, 신청→부서장 승인 워크플로우, 출퇴근 누락 정정 | P0 |
| FR-D3 | **증명서·급여명세**: 재직/경력 증명 발급(PDF·직인·QR 진위), 급여명세 조회(ERP 연동), 원천징수 | P0 |
| FR-D4 | **인사·교육·자격 조회**: 내 인사 기본정보 조회/일부 수정요청, 면허/자격 만료, 의무교육 이수(SQE) | P1 |
| FR-D5 | ESS 홈 대시보드(오늘 근무·미결 알림·잔여연차·만료 임박 자격) | P1 |
| FR-D6 | **행정 기능만 노출** — 진료/처방/차트 등 임상 기능은 ESS에서 **제외**(HIS 본체로 분리) | P0 |

### E. QR 인증 — 사용자 확정 5상황
| ID | 요구사항 | 우선 |
|----|----------|------|
| FR-E1 | **출퇴근 체크**: 벽면/단말 QR(회전식 단기 토큰) 스캔 또는 직원 QR 단말 제시 → 위치/시각 기록 | P0 |
| FR-E2 | **공용단말 빠른 로그인**: 공용 PC 화면 QR → 개인폰 생체확인 → 세션 전송(SSE 페어링, 동의서 기기 패턴) | P0 |
| FR-E3 | **온보딩 서류제출 링크/본인확인**: 초대 QR + 제출 시 본인확인 매칭 | P0 |
| FR-E4 | **교육·회의 출석**: 출석 QR 체크인(중복·위치 검증) | P1 |
| FR-E5 | **문서 수령 확인**: 발급문서 수령 QR 서명 | P2 |
| FR-E6 | QR 보안: 단기 회전 토큰·1회성·재생공격 방어·SSE 만료, 모든 스캔 감사 | P0 |

### F. 권한·보안·감사 (공통)
| ID | 요구사항 | 우선 |
|----|----------|------|
| FR-F1 | ESS 경량 권한 `ESS_VIEW_SELF`·`ESS_ATTENDANCE`·`ESS_LEAVE_REQUEST`·`ESS_CERT_ISSUE` 등. ※RBAC는 `UserRole` enum+**코드 상수**(Permission DB 모델 없음) → 권한은 코드 추가, 접근통제는 role/가드+`accountStage`(설계 §4.4) | P0 |
| FR-F2 | **본인 데이터 격리** — ESS는 항상 `self` 스코프, 타인 조회 불가(RLS 동치 가드) | P0 |
| FR-F3 | 고위험(계약·인사수정·증명발급) step-up 생체/QR | P0 |
| FR-F4 | 온보딩 Guard(토큰) ↔ 재직 JwtAuthGuard 분리, **라우트 중복 금지** | P0 |
| FR-F5 | 전 이벤트 AuditLog(초대·서류·계약·부팅·근태·QR·증명발급) | P0 |
| FR-F6 | 입사서류·근태 보존기간·파기 cron(법정 보존 후) | P1 |
| FR-F7 | **단말 보안 동의 패키지**(전 직원·스탭/의료진 공통) — 온보딩 절차에 [단말 보안 동의 단계] 신설: ① 위치정보 수집·이용(위치정보법, BLE 근접검증·궤적 비저장 고지) ② 생체인식정보(안면) 처리(개보법, PRIVATE 단말 Face Tracking·온디바이스) ③ 패스키 등록(기존 생체등록과 통합). ConsentForm/IssuedDocument 봉인+감사, `staffConsent.{location,biometric,passkey}` 상태 게이트. **미동의/철회 시 입사·활성은 진행하되 단말기능은 Fallback(미입력 타임아웃 잠금, security-governance §6.7.1 공용3분/전용10분)으로 자동 대체**, ESS에서 철회·재직자 갱신 징구 | P1 |

### G. 입사자 환영 · 회사소개/문화 페이지
| ID | 요구사항 | 우선 |
|----|----------|------|
| FR-G1 | **입사자 환영 페이지** — 생체등록 직후 첫 화면. 섹션: ① 환영 인사(병원장 메시지·영상) ② 병원 소개(연혁·규모·진료과) ③ **미션·비전·핵심가치** ④ **조직문화·인재상·근무방식** ⑤ 복지·베네핏(교육지원·휴가) ⑥ 시설·근무환경 투어 ⑦ 온보딩 가이드(첫 출근·준비물·연락처·FAQ) ⑧ **행동강령·윤리(필수 숙지)** | P1 |
| FR-G2 | **HR이 콘텐츠 편집** — `신규 입사자 관리`의 `환영·회사소개 편집` 탭에서 섹션 추가/정렬/다국어 입력 + 이미지/영상 업로드. 기존 CMS 패턴(`SystemConfig`+media) 재사용, **신규 모델 0** | P1 |
| FR-G3 | **다국어(ko/en)** — 외국인 의료진/위촉의 대상 | P1 |
| FR-G4 | **열람·필수숙지 확인** — 행동강령 등 필수 섹션 읽음 확인(`welcomeViewedAt`), 체크리스트 반영 | P1 |
| FR-G5 | 재직자도 ESS에서 `회사 소개·문화` 재열람(읽기 전용) | P2 |

---

## 6. 데이터 모델 (신규 Prisma)

> 기존 Staff/User/WebAuthnCredential/EncryptionService/AdminApproval/EApprovalRelay/AuditLog는 재사용. **환영·회사소개 콘텐츠는 `SystemConfig`(key `onboarding.welcome`, config-runtime)/`HospitalInfoContent`+media 재사용 → 신규 모델 0**(설계서 §4-W). **+ `User.accountStage`(PRE_BOARD/ACTIVE) 신규필드 필수**(§5.6). 아래 **10개** 신규(상세는 설계서 §4).

| 모델 | 핵심 필드 | 비고 |
|------|-----------|------|
| `OnboardingInvite` | id, tokenHash, **candidateFamilyName/GivenName**, email, phone, birthDate, jobCategory, department, hireDate, contractType, status, provisionalUserId, welcomeViewedAt, expiresAt, … | 1회성 링크·상태기계 |
| `OnboardingSend` | id, inviteId, channel(EMAIL/QR_IMAGE/LINK), sentById, meta, sentAt | 발송 이력(3채널) |
| `OnboardingProfile` | id, inviteId, 성별, 국적, 사진, 주소, 비상연락처, 학력/경력/면허(JSON), 병역, 부양가족, sensitiveConsent | **입사 개인정보**(주민번호·계좌 제외 — 서류로만, ERP 입력) |
| `OnboardingDocument` | id, inviteId, category, fileKey(암호화), status(PENDING/APPROVED/REJECTED), reviewerId, rejectReason, sensitive | 서류·검토 |
| `OnboardingContract` | id, inviteId, templateId, pdfKey, signedAt, signerHash, signatureImageKey, blockchainTxId | 전자계약 |
| `AttendanceRecord` | id, userId, type(CLOCK_IN/OUT), method(QR/BIO/MANUAL), at, deviceId, lat/lng(opt), correctionOf(nullable) | 타임클럭 |
| `LeaveRequest` | id, userId, type(ANNUAL/SICK/…), from, to, days, status(REQUESTED/APPROVED/REJECTED), approverId, reason | 휴가·근태정정 |
| `LeaveBalance` | id, userId, year, type, granted, used, remaining | 연차 잔여(ERP 동기화/캐시) |
| `EmploymentCertificate` | id, userId, kind(EMPLOYMENT/CAREER), pdfKey, issuedAt, verifyCode(QR 진위), revoked | 증명서 발급·진위 |

`QrSession`(공용단말/출석/페어링)은 **범용 신규 모델**(consent 페어링 코어 추출 — 실측상 `QrSession` 미존재, consent 페어링은 consent 강결합이라 신설 필요. 설계 §4.1·C-3).

**재사용 데이터 출처(신규모델 0)**: 인사 SoT=**`Staff`**(employeeNumber·hireDate·**status**·category·position) / 면허·자격=**`StaffCredential`** / 의무교육=**`StaffEducation`** / 근무표=**`StaffSchedule`**(staffId) / 의사프로필=**`DoctorProfile`** / 계약템플릿=`ConsentTemplate` / 급여·인사=ERP 읽기 / 직종별 필수항목=`SystemConfig`. (설계 §0-Y audit·§4.4)

> ⚠️ **기존 인사자료 실측(설계 §0-Y)**: HIS는 이미 **`hr` 모듈**(`/hr/staff`·`/hr/me`·`/hr/schedule`·ERP)과 인사 모델군을 보유 → 온보딩/ESS는 **신설이 아니라 `hr` 확장**. 고용상태는 **`Staff.status`(`ONBOARDING` 값 추가)** 사용(`User.accountStage` 철회). `OnboardingProfile`은 Staff에 없는 **민감 intake 전용**으로 축소. **기존 User≈105 vs Staff≈6 → 기존 직원 Staff 백필 선행 필요**.

---

## 7. API 설계 (요약)

**온보딩(공개/토큰 가드 `/onboarding`)**
```
POST /api/v1/onboarding/invites                  # (HR) 초대 발급
POST /api/v1/onboarding/invites/:id/revoke|resend
GET  /api/v1/onboarding/:token                    # 링크 진입(토큰 가드)
POST /api/v1/onboarding/:token/verify             # 본인확인(OTP/QR)
POST /api/v1/onboarding/:token/documents          # 서류 업로드(presigned)
POST /api/v1/onboarding/:token/contract/sign      # 전자서명(step-up)
POST /api/v1/onboarding/invites/:id/approve-boot  # (HR, 4-eyes) 계정 부팅
```
**ESS(재직, `/ess`, JwtAuthGuard + self 스코프)**
```
GET  /api/v1/ess/me                               # 대시보드
POST /api/v1/ess/attendance/clock                 # 출/퇴근(QR/BIO)
GET  /api/v1/ess/attendance?from=&to=
POST /api/v1/ess/leave                            # 휴가/정정 신청
GET  /api/v1/ess/leave/balance
POST /api/v1/ess/leave/:id/approve                # (부서장)
GET  /api/v1/ess/certificates                     # 급여명세(ERP)·발령
POST /api/v1/ess/certificates/employment          # 재직/경력 증명 발급
GET  /api/v1/ess/profile  | POST /ess/profile/change-request
GET  /api/v1/ess/qualifications                   # 면허·교육(SQE)
```
**QR 인증(`/qr`)**
```
POST /api/v1/qr/sessions            # 화면 QR 생성(용도별, 단기토큰)
GET  /api/v1/qr/sessions/:id/stream # SSE 페어링 상태
POST /api/v1/qr/scan                # 스캔 처리(로그인/출퇴근/출석/수령)
```
> `/onboarding/*`는 **OnboardingTokenGuard**, `/ess/*`·`/qr/scan`은 JwtAuthGuard(self). 라우트 중복 금지(가드 혼선 방지).

---

## 8. 화면 설계 (신규 페이지)

| 경로 | 화면 | 대상 |
|------|------|------|
| `/onboarding/[token]` | 온보딩 대시보드(체크리스트) | 입사예정자 |
| `/onboarding/[token]/profile` | **입사 개인정보(인적사항) 입력폼** | 입사예정자 |
| `/onboarding/[token]/documents` | 서류 업로드 | 입사예정자 |
| `/onboarding/[token]/contract` | 계약서 검토·전자서명 | 입사예정자 |
| `/onboarding/[token]` (진입) | 생년월일 확인 → **스마트폰 생체등록(로그인정보 등록)** | 입사예정자 |
| `/onboarding/[token]/welcome` | **환영·회사소개/문화 페이지**(생체등록 직후 첫 화면) | 입사예정자 |
| `/onboarding/boot` | 활성화 안내(생체 이미 등록 — 임시비번 없음) | 신규 직원 |
| `/admin/onboarding` | **신규 입사자 관리** — [입사자] 등록·발급·검토·승인 + **[환영·회사소개 편집]** 탭(콘텐츠·다국어·미디어) (온보딩 **시작점**) | 관리자/행정과(HR) |
| `/ess` | ESS 홈(오늘 근무·알림·잔여연차) | 재직자 |
| `/ess/attendance` | 출퇴근·근무표·이력 | 재직자 |
| `/ess/leave` | 휴가/근태정정 신청·승인 | 재직자/부서장 |
| `/ess/certificates` | 증명서 발급·급여명세 | 재직자 |
| `/ess/profile` | 내 인사·교육·자격 | 재직자 |
| `/kiosk/clock` | 벽면 출퇴근 QR 단말 | 공용 단말 |

> ESS는 **별도 경량 레이아웃**(진료 사이드바 미노출) — 행정 기능만. HIS 본체 사이드바에 ESS 진입 링크만 추가(비파괴).

**사이드바 등록(비파괴 추가)** — `apps/web/src/components/layout/Sidebar.tsx`
- `관리자` 그룹에 `{ href: '/admin/onboarding', label: '신규 입사자 관리', icon: HrIcon, roles: ADMIN_ONLY }` 추가 → `직원 관리` 인접. (온보딩 기능 **시작점**)
- ESS 진입은 사용자 메뉴/프로필 드롭다운에 `내 행정(ESS)` 링크로 노출(전 직원), 사이드바 진료 메뉴는 변경하지 않음.

---

## 9. ERP / W3 연동 정합

| HIS 이벤트 | ERP 용도 | 비고 |
|------------|----------|------|
| `staff.created`(부팅 완료) | Employee 동기화 | 기존 outbox |
| `staff.schedule_changed` | 근태→급여 | 기존 |
| **`staff.attendance_recorded`**(신규 이벤트) | 출퇴근→근태집계→급여 | W3 명세 확장 제안 |
| `staff.qualification_changed` | 자격수당·면허 | 기존 |
| ERP 읽기 `/integration/hr/staff/*` | 급여명세·발령 표시 | ESS `certificates` |

> 급여 **산정은 ERP**, HIS는 **원천(출퇴근/서류/계약)** 제공. 근태 정합은 `ref` 멱등(기존 규칙).

---

## 10. Phase 계획

| Phase | 범위 | 산출 |
|-------|------|------|
| **P1** | **선행: `User.accountStage`+온보딩 인증스코프(§5.6)** → 데이터모델 10종 + 온보딩 모듈(초대·QR 로컬생성·토큰가드·생년월일확인·**임시계정(PRE_BOARD)+생체등록**) | 마이그레이션·발급/생체등록 |
| **P2** | **환영·회사소개 페이지(SystemConfig+HR편집)** + **인적사항 입력폼(주민번호·계좌 암호화)** + 서류 제출·HR 검토 + 전자계약(생체 서명) | 환영/개인정보/서류/계약 E2E |
| **P3** | 계정 활성화(PRE_BOARD→ACTIVE 사가·채번·W3 송신, **임시비번/SMS 없음**) | 활성화 완주 |
| **P4** | ESS 근태(타임클럭)·휴가·증명서·내 정보 + 경량 권한(ESS_*) | ESS MVP |
| **P5** | QR 5상황(출퇴근·공용로그인·서류·출석·수령) + SSE·보안 | QR 통합 |
| **P6** | 감사·보존/파기 cron·ERP 정합·접근통제 보안 점검 + 배포 | 운영준비 |

---

## 11. 비범위 (Out of Scope)

| 항목 | 사유 | 로드맵 |
|------|------|--------|
| 급여 **산정/지급** | ERP 소유(SoT) | ERP |
| 인사 발령·평가·성과 | ERP 소유 | ERP |
| 임상 기능(진료·처방·차트) ESS 노출 | ESS는 **행정 전용** | HIS 본체 유지 |
| 채용(공고·면접·합격) 전(前) 단계 | 온보딩은 **합격 이후**부터 | 추후 |
| 오프라인 근태(네트워크 단절) | 현재 온라인 운영(FR-08 동기화 정책) | Phase 4+ |

---

## 12. 오픈 이슈

1. **ERP 근태 정합** — 출퇴근 원천을 HIS(타임클럭)로 단일화할지, groupware와 병행할지 → W3 후속 합의 필요.
2. **`staff.attendance_recorded` 이벤트 신설** — ERP 수신 어댑터 합의(W3 명세 v1.1 개정 제안).
2-1. **Clinic 팀 협의(설계 §9.6)** — 출퇴근·휴가 결재는 **Clinic(디렉터리/계정·전자결재 라우팅) 경유**. 신규자 `clinicUserId` 매핑, HR_LEAVE 결재선 등록·상신/결과 콜백, 근태 신원·원천(groupware) 정합. ERP·Clinic **양측 합의 선행**.
3. **위촉의(외부) 계정 수명주기** — 단기계약 만료 시 자동 비활성/패스키 폐기 연계(staff-credential-admin lifecycle).
4. **입사서류 보존기간** — 채용 탈락/미입사자 서류 파기 기준(개인정보 최소수집·보존) 법무 확인.
5. **이메일 SMTP 설정** — 발송 실작동 위해 `smtp.config` 필수(미설정 시 시뮬레이션). 미구성 시 QR/링크 대면전달로 운용. (SMS는 시뮬레이션이라 채널에서 제외)
6. **임시계정(PRE_BOARD) 격리** — `User`에 `status` 없음·`isActive`만 있고 패스키 로그인이 isActive 검사 → **`accountStage` 신규필드 + 온보딩 인증스코프**로 격리(설계 §5.6, P1 선행). 직원 통계·시드 쿼리에 `accountStage=ACTIVE` 조건 추가.
7. **QR 서버 로컬 생성** — `qrcode` npm 도입(외부 api.qrserver.com 미사용, 토큰 외부유출 차단).
8. **주민번호 ERP 전송** — `staff.created` outbox에서 제외, 별도 보안채널 합의(W3 확장).
9. **노비스 네이밍** — 대외 표기("온보딩"/"노비스") 확정.
10. **단말 보안 동의 정합(FR-F7)** — [security-governance-master](security-governance-master.plan.md) §6.10의 [단말 보안 동의 단계]를 본 온보딩 부팅 플로우(PRE_BOARD→생체등록→4-eyes) **어느 지점에 삽입할지**(생체등록 직후 권장)·동의 미충족 시 단말기능 Fallback 자동전환·`staffConsent` 모델 위치 확정. 잔여 법무: 위치정보법 신고의무 여부·안면 온디바이스 설계·노사협의회 의결.

---

## 13. 성공지표 (KPI)

| 지표 | 목표 |
|------|------|
| 입사 행정 처리시간(초대→부팅) | 평균 3일 → **1일 이내** |
| 신규자 계정 발급 관리자 공수 | 건당 30분 → **5분 이내**(자동화) |
| ESS로 처리되는 행정요청 비율 | 근태·휴가·증명 요청의 **80%+** 셀프처리 |
| 비밀번호 의존 로그인 | 재직자 **0%**(폴백 제외) |
| 입사서류 누락/반려 재요청 | **50%↓** (체크리스트·검증) |

---

> **다음 단계**: 오픈이슈 1·2(ERP 근태/이벤트), 4(서류 보존 법무) 선합의 → `/pdca design staff-onboarding-ess`로 설계 착수(데이터모델·가드·QR 토큰 스펙·서류 암호화 키관리 상세).
