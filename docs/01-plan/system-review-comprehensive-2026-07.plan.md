# 전체 기능 검토 및 보완 기획서 (2026-07)

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — apps/api/src/modules/patient-auth/patient-profile.controller.ts:136 · apps/api/src/modules/safety-gate/safety-gate.service.ts · 잔여: 바코드·라벨프린터(ZPL) 하드웨어(사람); G 외부 게이트(NIMS/KIDS·HIRA 원천·SMS 계약·sign EXTERNAL/HSM·STT GPU)(사람); §4 부록 TODO 12건(SMS/카카오 어댑터·WhatsApp/WeChat 스텁 등)(사람)

> 작성: 2026-07-15 / HIS 개발팀 · 기준 버전 v3.51.0 (모델 469·모듈 188·컨트롤러 258·페이지 409·spec 303)
> **갱신: 2026-07-27 · 현행 v3.67.0 (모델 511·도메인 모듈 201·컨트롤러 274·서비스 289·엔드포인트 2,976·페이지 418·spec 378)**
> 방법: 3축 병렬 코드 스카우트(①게이트 OFF·미완 기능 인벤토리 ②임상 흐름 10종 깊이 판정 ③비기능 잔재) + 누적 세션 갭 인벤토리 종합. **모든 항목은 파일 근거 기반**(추정 항목은 표기).
> 결론 한 줄: 외래·검사·수혈·수술·응급·영양 축은 대학병원급으로 견고하다. 보완의 중심은 **① bedside 폐쇄루프(투약·수혈) ② 기록 완결도(HIM) ③ 항암·퇴원·심사 흐름 심화 ④ 감사·검증 커버리지**다.

---

## 0. 갱신 현황 (2026-07-27) — v3.51.0 → v3.67.0 진행 반영

본 카탈로그(v3.51.0 기준) 이후 다수 과제가 종결됐고, 카탈로그에 없던 신규 트랙이 추가로 완주됐다. **아래는 실측(모듈 존재·PR) 기반 현행 상태.**

**✅ 카탈로그 항목 종결/진척:**
- **A-3 DUR 조제 게이트 시행 전환** — 강제 게이트 ON·`/admin/safety-gates` 관제 10종(DUR 처방·조제 포함)·GateViolationLog (v3.57 #620)
- **C-4 telehealth 하드코딩 키 제거** — 소스 무매칭 확인(제거됨)
- **D-4 `--web` 무중단 배포** — `.next-build` 원자 스왑·무결성 검증 후 reload (#535·#538 근본수정)
- **B-1 의무기록 미비(HIM) 모듈 신설** — `modules/him`·`/admin/him/deficiencies` worklist+독촉 (카탈로그 "전무" → 구축됨)
- **B-2 항암(chemo) 모듈** — `modules/chemo` 신설 (카탈로그 "스칼라뿐" → 구축됨)
- **B-3 퇴원요약(discharge-summary) 모듈** — `modules/discharge-summary` 신설
- **B-4 심사 삭감 사유코드** — `claim` 모듈에 reasonCode·삭감 라인 반영
- **E 활성화 진척** — ESS 급여 릴레이 운영(R-3)·Tier2 생체승인 ON 등 다수 config 플립

**🆕 카탈로그 외 신규 완주 트랙 (v3.52~3.67):**
- **VoC 고객의 소리 옴니채널** (v3.65 #695~699) — 홈페이지 접수·포털 상담실·`/consult` 데스크 통합·SLA 크론·AI C1~C5(게이트 OFF)
- **운영 전환(Go-Live) 통합 관제** (v3.66 #700~714) — `/admin/go-live` 7영역 24항목·준비도 점수·크리티컬 패스
- **파이프라인 심층검토 경쟁상태 봉합** (v3.66) — 예약·입원·수술OR·접수큐·검체·위급값·원격DUR 등 8건 + `withAdvisoryLock` 채번 헬퍼
- **청구·수납 재무결함 6건 봉합** (v3.64 #688~693) — 입원료 이중계상·비급여 과다청구·과다환불·심사 이원화·결제 lost-update
- **데이터 품질 10도메인 25지표 관제** (v3.63 #663~686) — `/admin/data-quality`·레지스트리·AI C1~C5
- **알림 전면검토 15건** (v3.63) — IDOR·보존 크론·severity 정본화·FCM
- **당직·근무표 완비** (v3.53~57) — DutyEntry 단일화·LeaveRequest 파생
- **외국인 다국어 동의서**·**안전 스카우트 26+항목**·**전문과 입력 UI 3종** 등
- **엔드포인트 배선 전수 검토** (#719~720) — GET 388 + 변이 700 대조, 404 결함 13건 봉합(전문과 진료기록 저장 5과·일회성 액션 5종·FE 오타 2)

**✅ P0 안전 코어 — 실측 재감사(2026-07-27, PR#723): 3종 모두 백엔드 구축 완료.** (당초 이 표에서 잔여로 표기했으나 실측 결과 R2 작업으로 이미 종결 — 정정)
- **A-1 BCMA/eMAR** — `nursing.service.administerMed` 5-Rights 기계대조(BCMA_PATIENT/MED_MISMATCH)+게이트 `nursing.bcma.enforce`·모델 스캔필드 존재. 유일 결함=`workstation/nursing` MAR의 라우팅 404(우회) → BCMA 게이트 엔드포인트+스캔 재배선(inpatient·tablet·workstation·nurse-station 통일).
- **A-2 수혈 bedside** — `verifyTransfusion(scans)` 손목밴드·혈액백 대조(불일치 항상 BLOCK)+`bloodBank.bedsideScan.enforce`·FE 스캔 전송 완비.
- **A-4 마취전평가** — `PreAnesthesiaEvaluation`+sign-in 게이트 `surgery.preAnesthesiaGate`(COMPLETED 필수).

**⏳ 잔여(순수 하드웨어·외부·정책 게이트):**
- 바코드 스캐너·라벨프린터(ZPL) 하드웨어 도입(로직·UX 완비, 스캐너=키보드 입력으로 즉시 동작)
- G 외부 게이트(NIMS/KIDS·HIRA 원천·SMS 계약·sign EXTERNAL/HSM·STT GPU·ERP 컷오버 법무) — 재개 트리거 대기

> **원 카탈로그(§1~§4)는 히스토리 보존을 위해 원문 유지.** 각 항목의 현행 상태는 본 §0을 우선한다.

---

## 1. 현황 요약 — 강점 (손댈 필요 낮음)

| 축 | 근거 |
|---|---|
| 외래 전 여정(예약→접수→진료→처방→수납) | 상태기계·서명 게이트·발생주의 청구, 접수/여정 SSE |
| 검사 | 검체 바코드·독립 2단계 검증(자가검증 차단)·정정 재검증·기준치 마스터 자동판정 |
| 혈액은행 | 불출 안전게이트(ABO/Rh·교차·항체·유효기간 BLOCK)·2인 수혈확인·MTP·부작용 보고 |
| 수술 | WHO 3단계 체크리스트(required 강제)·PACU·마취기록·수술기록 |
| 응급 | KTAS 룰·재평가·disposition 상태·golden pathway |
| 약제 | DUR(성분코드·임부금기)·고위험약 2인확인(BLOCK 기본 ON)·마약류 잔량 정합·무균조제 체인(MAR·청구까지) |
| 연동 | LIS 폴링/reflex/병리 전 수명주기 PASS·개통 게이트 보드(구조화 결재)·PACS 컷오버 준비 완결 |
| 오더 아키텍처 | 생성 게이트웨이 단일화·FSM 실무 정합·시행자 스탬프(v3.50~51에서 종결) |

## 2. 보완 과제 카탈로그

우선순위: **P0=환자안전 직결 / P1=규제·수익·신뢰성 / P2=운영 성숙도 / P3=편의·구조**. 규모: S(≤1일)·M(2~3일)·L(1주+).

### A. 임상 안전 (P0 트랙)

| # | 과제 | 근거 | 규모 |
|---|---|---|---|
| A-1 | **BCMA/eMAR 투약 폐쇄루프** — 병동 투약 시점 환자 손목밴드+약품 바코드 대조. MedicationAdministration에 스캔 필드·검증 게이트 신설, 조제 스캔(pharmacy scanBarcode)과 연결 | 현재 verifiedBy만 존재 — 오투약 방지 최우선 공백 | L |
| A-2 | **수혈 bedside 바코드 대조** — verifyTransfusion(nurse1/nurse2 육안)에 손목밴드·혈액백 바코드 스캔 필수화 | blood-bank.service.ts:270 — ABO 부적합은 sentinel event | M |
| A-3 | **DUR 조제 게이트 시행 전환** — `pharmacy.durGate.enforce` OFF→ON(WARN 경유 권장). 로직 완비, 게이트만 꺼짐 | pharmacy.service.ts:108 · 규제 §37 | S(정책 결정) |
| A-4 | **마취전평가 독립 게이트** — ASA·기도·NPO·심폐위험(RCRI)·술전검사 리뷰를 수술 확정 전 필수 단계로 분리(현재 AnesthesiaRecord inline) | surgery-advanced.service.ts:107 | M |

### B. 임상 흐름 심화 (P1 트랙)

| # | 과제 | 근거 | 규모 |
|---|---|---|---|
| B-1 | **의무기록 미비기록(완결도) 관리 모듈 신설** — 퇴원 후 N일 미완결 차트·미서명 기록·사망요약 지연 worklist + 서명 독촉. 의료질 인증 필수인데 **전무** | 전 소스 무매칭 — 서명 게이트만 산재 | L |
| B-2 | **항암 프로토콜 사이클 엔진** — regimen day-based 오더셋(전처치·수액·G-CSF)·BSA/용량감량·nadir 랩 게이트·사이클 지연. 무균조제(CHEMO)·치료일정 템플릿과 연결 | cancer-registry는 스칼라뿐 — 종양내과 핵심 | L |
| B-3 | **퇴원 프로세스 상태기계화** — DC오더→퇴원계획(퇴원약·교육·f/u 예약)→정산 게이트→퇴실. AdmissionStatus 4값 확장, 병상 CLEANING 회전 KPI 연동 | enum AdmissionStatus | M |
| B-4 | **심사 삭감 line-item·사유코드 + EDI 반송 자동화** — 청구 라인 단위 삭감·HIRA 조정 사유코드·반송파일 파싱→재작업 큐→재청구 루프. 수익누수 가시성 | claim.service.ts:130~ (총액만) | L |
| B-5 | **전과(attending 변경) 정식 기록** — 현재 병상이동만 존재. ChargeOfCare 확장으로 전과 이벤트·책임 이관 기록 | 흐름 스카우트 #9 | S |

### C. 보안·감사 (P1 트랙)

| # | 과제 | 근거 | 규모 |
|---|---|---|---|
| C-1 | **감사 화이트리스트 확장** — psychiatry·blood-bank·transplant·hospice·research·crm 라우트가 AuditInterceptor 패턴 밖(민감 PHI mutating 미기록) | audit.interceptor.ts:20~51 | S |
| C-2 | **무검증 Record 바디 DTO화(단계)** — research/education/hospice/crm 등 mutating EP부터 class-validator DTO. 장기적으로 forbidNonWhitelisted 검토 | main.ts:88 · 인터페이스 body는 whitelist 미적용(양날 — order-set codeId 사건의 역방향 위험) | M(단계) |
| C-3 | **onboarding-public Throttle** — 토큰 claim/passkey 등록 브루트포스 방어 | onboarding-public.controller.ts:15 | S |
| C-4 | **telehealth recordings 하드코딩 API 키 제거** | apps/web .../telehealth/recordings/page.tsx:10 `wch_CHANGE_ME…` | S |
| C-5 | 포털 프로필 변경 비밀번호 재확인(TODO 잔존) | patient-profile.controller.ts:118 | S |

### D. 성능·운영 (P2 트랙)

| # | 과제 | 근거 | 규모 |
|---|---|---|---|
| D-1 | CRM 캠페인 N+1 — 최대 5,000명 순차 동의조회를 `findMany({in})` 배치로 | crm.service.ts:159~172·1087 | S |
| D-2 | 무제한 findMany 페이징 — patientHistory·contacts·백필 등 성장형 조회에 take/커서 (전수 1,181건 추정치는 개별 확인 필요 — 대표부터) | patient.service.ts:343 등 | M(점진) |
| D-3 | **크론 33종·outbox 디스패처 분산 락** — 멀티 레플리카 대비(현재 3개만 advisory lock). 단일 인스턴스 운영 중엔 잠재 | integration-outbox.service.ts:72 | M |
| D-4 | **`--web` 무중단 배포** — 별도 디렉터리 빌드→원자 스왑(현재 배포마다 2~5분 화면 깨짐 창) | deploy.sh·2026-07-15 실측 | S~M |
| D-5 | agent config 조회·검진 imaging 업데이트 등 소형 N+1 배치화 | agent-session:1405·checkup:774 | S |

### E. 활성화 대기 — 구현 완료·게이트 OFF (정책 결정만)

| config | 기능 | 권장 |
|---|---|---|
| `portal.selfBooking` | 포털 셀프 예약(조회·생성·취소 완비) | **ON 권장** — 외부 의존 없음 |
| `pharmacy.durGate.enforce` | DUR 미해결 조제 차단 | A-3 — WARN→BLOCK 단계 ON |
| `portal.aiDrugExplain`·`portal.medicationReminder` | AI 복약설명·복약 리마인더 | ON 권장(opt-in 설계 완료) |
| `portal.insuranceDocBundle` | 실손 서류 번들 | ON 권장 |
| `treatmentSchedule.reminder` | 치료일정 D-1 리마인더 | ON 권장 |
| `portal.inpatientLife`·`billing.copayCap.preCoverageEnabled`·`onboarding.fourEyes`·`preOrder.autoActivation` | 각 영역 완비 | 부서 합의 후 ON |

⚠️ 플립 금지(전제 미충족): `sign.mode=EXTERNAL`(서명코어 스텁)·`eligibility.mode=NHIS`(provider 미구현)·`scribe.transcription`(DPA/GPU)·`retention.purgeEnabled`(파기 핸들러 미구현).

### F. 품질 (P2 트랙)

- **e2e 0건** — 핵심 여정 1~2개(외래 접수→처방→조제→수납 / reflex 왕복) 스모크 e2e 신설 권장 (M).
- 대형 서비스 spec 밀도 — portal(2,713줄/3)·agent-session(2,547/2)·checkup(2,091/2)·nursing(1,432/2)은 라인 대비 얕음, **crm은 0**. 핵심 경로부터 점진 보강 (M·점진).
- 교훈 규범화(금번 세션 실증): 클린 빌드 검증(증분 캐시 은폐)·파이프 exit code 함정·"조용한 성공 ack 금지"·"오답 확정은 미해석보다 위험".

### G. 외부 게이트 대기 (엔지니어링 준비 완료 — 재개 조건 명시)

| 항목 | 대기 사유 | 재개 트리거 |
|---|---|---|
| NIMS·KIDS 실전송 | 인증서·기관 계약 | 채널 온보딩 완료 |
| HIRA DUR 공고·임부 카테고리 전량·maxDailyDose 데이터 | 식약처/심평원 원천 임포트 | 데이터 확보(로직은 자동 활성) |
| SMS/알림톡(알리고·카카오) | 발신번호·계약 | 계약 — schedule:720·sms-otp:43 어댑터 지점 준비됨 |
| sign EXTERNAL·HSM | 파일럿 공동 게이트·법무 | P1 게이트 해제 |
| ZPL 라벨 실인쇄 | 라벨프린터 하드웨어(한글 폰트) | 장비 도입 |
| 앰비언트 스크라이브 STT | WeRU.B GPU(large-v3 OOM)·DPA | GPU 증설 |
| A-1~3 실결재·병리과 EDI 세트·CP 48건 | 조직 결정 | 보드 4단계 절차·config 조정 |
| FR-08 오프라인 PWA | 로드맵 이연 | Phase 4+ |

## 3. 권장 로드맵

| 페이즈 | 범위 | 소요(추정) |
|---|---|---|
| **R1 즉효** (게이트·소형) | E 활성화 5종(부서 합의 병행) + C-1·C-3·C-4·C-5 + D-1·D-5 + B-5 | 2~3일 |
| **R2 안전 코어** | A-2 수혈 bedside → A-4 마취전평가 → A-1 BCMA(모델→워크스테이션→태블릿 순 3단계) | 2주 |
| **R3 흐름 심화** | B-3 퇴원 상태기계 → B-1 미비기록 모듈 → B-4 삭감 line-item | 2~3주 |
| **R4 대형** | B-2 항암 사이클 엔진(치료일정·무균조제 연결) + F e2e/spec 보강 + D-2·D-3 | 3주+ |

- 병행 원칙: 각 페이즈 완료 시 릴리즈·라이브 실측·문서 정본 갱신(기존 관례 유지). R2~R4의 신규 게이트는 전부 config 기본 OFF로 출고.

## 4. 부록 — 소형 잔재 전수 (스카우트 원본 기준)

- TODO 12건: SMS/카카오 어댑터 2·WhatsApp/WeChat 스텁 2·device-enroll 후속 2·비번 재확인 1·알림톡 1·web 하드코딩 키 1·blockchain @deprecated 3.
- dead/미배선: `useWerub` 훅(정의만)·blockchain-cert deprecated 3종·CRM 해외채널 SIM 스텁.
- 조사 원본: 3축 스카우트 결과는 세션 기록 보존(추정 표기 항목은 개별 확인 후 착수).
