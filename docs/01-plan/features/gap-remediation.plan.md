# 공백·반쪽 기능 회수 기획 (Gap Remediation)

작성 2026-09-06 · 원천: `docs/03-analysis/his-feature-gap-scan-2026-09-06.md`(병렬 3축 실측) ·
사람 지시 "반쪽과 없는 부분을 디테일하게 구성 가능하도록"

> 🔴 원칙(이 저장소에서 나온 것 그대로): 만든 것 ≠ 소비처가 쓰는 것 — **배선까지가 한 벌** ·
> 잔여 작업의 정본 표현은 워크리스트(줄어드는 목록) · 가짜 게이트 금지(막으면 서버에 남는다) ·
> 신설 화면은 화면번호 freeze·nav 소분류·44px·QueryErrorFallback·정직 3상태 규약 즉시 적용 ·
> 제거는 관측 후(호출 0 실측이 있어도 배포 후 관측 기간을 둔다).

---

## §1 반쪽 회수 트랙 R — EP·모델은 있고 화면/배선만 없는 것 (전부 CLI 가능)

### R1. 화상 평가 배선 ⭐ (다 만들어져 있음 — 잇기만)

**현재 실측**: 모델 `BurnAssessment` + 서비스(Rule of Nines 표) + EP 5종
(`GET patients`·`GET :patientId`·`POST`·`POST calculate-tbsa`·`POST calculate-parkland`) +
화면 부품 `components/specialty/BurnsChart.tsx`(372행 SVG · props `regions/isChild/onRegionClick/mode`)
— **import 0**. 로드맵 문서는 "✅ 구현완료" 주장(P16성 — 문서 정정 포함).

**설계**:
1. 진입: 환자 차트에 '화상 평가' 구획 — 기존 전문과 레이아웃 패턴(EnT·안과 Layout)과 같은 방식으로
   `encounter/new` 특수 구획 + 환자 차트 조회 탭. 응급·외과 계열 우선.
2. 입력 흐름: `BurnsChart mode="edit"` 로 부위 클릭 → 깊이 선택 → `POST calculate-tbsa`(서버 계산 —
   FE 재계산 금지) → TBSA·Parkland(`calculate-parkland` — 체중 입력, 🔴 미측정 체중을 기본값으로
   채우지 않음) 표시 → `POST` 저장. 소아는 `isChild`(나이는 shared `ageOf`).
3. 조회: `GET :patientId` 이력 목록 + `BurnsChart mode="view"`.
4. 가드: `BurnsChart` import ≥1 + `v1/burn-assessments` FE 소비 grep ≥1(재주입) · 로드맵 문서
   "구현완료" 행을 실상태로 정정.

### R2. Break-the-Glass 사후검토 화면 ⭐ (규정 표면)

**현재**: `GET /api/v1/admin/break-glass`(감사 목록)·`POST :id/review`(의무검토)·`POST grant` — 화면 0.
긴급열람이 부여되어도 사후검토를 할 곳이 없다(환자 포털 BTG 는 별개 도메인).

**설계**: `/admin/break-glass` 신설(nav '기록·감사·감시' 소분류·화면번호 freeze 등재).
- 워크리스트: **미검토 우선**(줄어드는 목록) — 부여자·대상 환자(마스킹 정본)·사유·시각·경과시간(사실만).
- 검토 완료: 검토 소견 필수 입력 → `POST :id/review`(44px·실패 사유 표시).
- 부여(grant)는 응급 상황 UI 라 별도 — **이 화면은 검토 전용**(부여 동선 신설은 사람 결정 —
  현재 부여 경로가 어디서 쓰이는지 실측 후).
- 가드: 미검토 0건과 조회 실패를 다르게 그림 · EP 소비 grep.

### R3. 마약류 사전승인 상신함 ⭐ (게이트 켜기 전 선행 조건)

**현재**: 승인자 화면(결재 대시보드 `PRE_AUTH` 카테고리)은 있는데 **상신하는 의사 화면이 0**.
`POST /pre-auth/orders`·`GET mine`·`POST :id/cancel` 고아. 게이트 `preauth.enforce.NARCOTIC_RX` 는
배선돼 있고 기본 OFF — BLOCK 으로 켜는 순간 의사는 차단당하고 갈 곳이 없다.

**설계**:
1. 처방 화면(CPOE·encounter 처방) 게이트 차단 응답에 **"사전승인 상신" 동선** — 차단 사유+상신
   폼(대상 처방 스냅샷·사유 필수)을 그 자리에서. 🔴 상신 성공≠처방 발행(승인 시 발행 — EP 계약 그대로).
2. '내 상신 목록': `/ess` 결재 흐름 옆이 아니라 **처방 문맥**에 — encounter 처방 패널에 '상신 중'
   배지+`GET mine` 목록(취소 가능). 알림 라우팅(`PRE_AUTH`→`/ess`)은 기존재 — 승인/반려 결과가 온다.
3. 게이트 운영 규약 명시: **이 화면 배포 전 `NARCOTIC_RX: BLOCK` 설정 금지**(가드로 순서 동결은
   불가하니 go-live 레지스트리에 선행조건 등재).
4. 가드: 차단 응답 분기가 상신 동선을 그림(재주입) · `v1/pre-auth` FE 소비 ≥2.

### R4. Code Blue / RRT 기록·통계

**현재**: 발생기록·경과(팀도착/CPR/ROSC/제세동)·통계·RRT 활성화/응답/SLA EP 7종 전 고아.

**설계**: 두 표면 —
- **기록**: 응급/간호 문맥 `/code-blue`(또는 nurse-station 진입) — 이벤트 생성·타임스탬프 경과 입력
  (🔴 시각은 사실 입력 — 자동 now 채움은 버튼별 "지금" 명시 클릭만)·종결.
- **통계/SLA**: `/admin/qi` 옆 질·안전 문맥 — RRT 응답 SLA 목록(분모 병기·표본 없으면 산출 불가).
- 가드: EP 소비·미종결 이벤트 워크리스트 존재.

### R5. UDI 기기 추적 (입력+리콜 역추적)

**현재**: 바코드 파싱·삽입기록·리콜 역추적·환자별 이력 EP 4종 — 입력도 목록도 화면 0.

**설계**: ① 수술기록/시술 화면에 '삽입 기기' 구획 — UDI 바코드 입력→파싱 EP→확인 후 기록
(GS1 파서는 shared `gs1.ts` 기존재 — 정본 재사용) ② `/admin/device-recall` — 기기/LOT 로 환자
역추적(결과 0 과 조회 실패 구분). nav '의료질·안전'.

### R6. 보유/파기(Retention) 관제 화면

**현재**: 정책·DRY-RUN·4-eyes 승인 대기 EP 7종 화면 0. 고위험 purge 핸들러는 의도적 미구현(403).

**설계**: `/admin/retention` — 정책 목록·DRY-RUN 실행(결과=건수 표)·승인 대기(4-eyes) 큐.
🔴 **화면이 현 상태를 정직 표기**: "AUDIT_LOG 등 고위험 파기는 핸들러 미구현(법무 승인 대기) —
DRY-RUN 만 가능" — 실행 버튼을 그리지 않는다(가짜 게이트 금지의 역: 없는 능력을 약속하지 않음).

### R7. 소형 배선 묶음 (각 반나절 이하)

| 항목 | 설계 한 줄 |
|---|---|
| 병리 6 EP | `/pathology` 화면에 처리단계 타임라인(고정·포매·박절·염색)·슬라이드 목록·QC/TAT 통계 탭 추가 |
| DUR 룰 CRUD | `/admin/cdss-rules` 에 'DUR 룰(55)' 탭 — 목록·수정(개정 사유 필수·감사) |
| 계정복구 요청/완료 | 로그인 화면 "패스키 분실" 동선 → `POST auth/recovery/request`·승인 후 `complete`(관리자 큐는 기존 identity 화면) |
| 다중서명(multi-sign) | 동의서/기록 서명 흐름에서 다중 서명자 초기화·상태 표시(소비처: 동의서 상세) |
| 인증정책·일괄무효화 | `/admin/identity` 확장 — 정책 조회/변경·퇴사/역할변경 일괄 무효화(4-eyes 성격 — 사유 필수) |
| 권한위임(grant) | `/admin/identity` 확장 — SECURITY_ADMIN/AUDITOR 위임 부여/회수 목록 |
| DRG 계산 2 EP | `/admin/billing-calc` 에 DRG 포괄수가 탭 |

### R8. 병렬 중복 표면 정리 (제거는 관측 후)

| 표면 | 판단 | 단계 |
|---|---|---|
| `medical-terminology` 15 EP | 같은 테이블을 `code-master` 가 서빙 — 검증 3 EP(interactions·dur·contraindications)만 유효 후보 | ① 컨트롤러에 deprecated 주석+감사 관측 ② 30일 호출 0 확인 ③ 검증 3 EP 를 code-master 로 이관 후 모듈 제거(🧑 제거 승인) |
| `insurance-claim` 8 EP | web 은 `claim` 모듈만 사용 — 기능 대조 후 이관/제거 | 동일 3단계 |
| `blockchain-anchor` 5 EP | cert 화면에 앵커 통계 배선 **또는** 제거 — 통계는 관제 가치 있음 → 배선 우선 | `/admin/blockchain-cert` 에 앵커 통계 카드 |

### R9. 미배선 config 회수(보안·임상 6종 우선)

`clinical.vitals.criticalAlert`·`clinical.lab.criticalNotify`(위급 임계 — 위급값 판정 정본
`lab_critical_flag` 경로에 주입) · `security.session.timeoutMinutes`(세션 만료 정본에)·
`security.password.minLength/requireSpecial`(비밀번호 정책 — 🔴 기존 실측 "비밀번호 정책 넷에 각자"
와 함께 정본 수렴)·`security.audit.retentionDays`(R6 화면에 표기+집행 잡). 각 배선 시
unwired-config 기준선 48 하향.

---

## §2 공백 신설 트랙 N — 층이 없는 것 (설계 포함)

### N1. 미생물 검사 (최대 신설 — P0/P1/P2)

**현재**: 모델 0·탭 라벨만. 감수성이 notes 텍스트로 유실(코드 자인). ASP·MDRO·내성률의 분모 부재.

**모델 설계(P0)**:
```prisma
model MicrobiologyResult {  // 검체 1건 = 1행
  id, labResultId String? // 기존 LabResult(오더·검증 흐름)와 연결 — 오더 체계 재사용
  specimenType/source, collectedAt, receivedAt
  status: RECEIVED | INCUBATING | PRELIMINARY | FINAL | NEGATIVE  // 중간보고가 1급 상태
  gramStain String?  // 도말 중간보고
  reportedAt, verifiedBy/At  // 기존 검증 규약 준용
}
model OrganismIsolate { microResultId FK, isolateNo, organismName/code, quantity }
model AntimicrobialSusceptibility {
  isolateId FK, antibioticName/code, mic String?,  // 보고값 재반올림 금지(외부 보고값 규칙)
  interpretation: S | I | R, method
}
```
**워크플로(P0)**: 기존 LAB 오더 → 미생물 접수 큐(워크스테이션 '미생물' 탭 실체화) →
도말/그람염색 **중간보고**(PRELIMINARY — 🔴 중간을 최종처럼 그리지 않음) → 배양·동정 →
감수성 패널 입력(S/I/R+MIC) → 최종 검증(위급값: 혈액배양 양성 = 기존 위급값 통보 경로 연결).
**조회(P0)**: 환자 차트 검사결과 탭에 미생물 구획(균·감수성 표 — S/I/R 색+글자).
**연계(P1)**: FINAL 시 MDRO 해당 균 **등재 제안**(자동 등재 금지 — 숨기는 방향이 아니어도
감염관리 판단 존중·제안+확인) · 감수성 분모 공급으로 **내성률 산출 가능**해짐 ·
antibiogram(원내 감수성 집계 — 분모 병기·표본 미달 시 산출 불가) 화면(질·안전).
**P2**: LIS 인터페이스(HL7) 매핑 — 기존 `LabInterfaceResult` 경로 확장.
**사람 결정**: 항생제 패널 구성·보고 서식(진단검사의학과) · 균 코드 체계(SNOMED vs 원내).

### N2. 사망진단서·검안서 발급 서식 (가장 작은 신설 — 데이터 기존재)

`DeceasedModal` 이 사인체인(가~라)·사망일시·장소·종류를 이미 저장한다. 남은 것:
1. `DEFAULT_FEE_RULES`+`TYPE_FEES` 에 `DEATH_CERT` 추가(🔴 **두 곳 동시 확장 규약 기존재** —
   fee-rules 주석) — 수수료 금액은 원내 정책(🧑·기본 미설정 표기).
2. print 서식(의료법 시행규칙 서식 — 문구·항목은 🧑 법무/원무 확인, 조사한 것만 적는다) —
   기존 발급 게이트(직접 진찰 의사·전자서명 — `issuance.service.ts` §17 게이트) **재사용**.
3. 검안서(외인사)는 요건이 달라 별건 — 🧑 법무 확인 선행.

### N3. 출생증명서 — N2 와 동일 패턴(`DeliveryRecord`·`NewbornRecord` 기존재·`BIRTH_CERT` 타입+서식).

### N4. 자보·산재 청구 — 단계 분리

① **payerType 축 신설**(스키마: `Claim.payerType NHIS|AUTO|INDUSTRIAL` + 분리 집계·화면 구분 배지)
— 스키마 승인 🧑 후 CLI. ② 전용 서식(자보 지급보증 확인·산재 요양급여신청) — 서식 문안 🧑 법무.
③ 기관 전송(심평원 자보 위탁·근로복지공단) — 외부 채널 🔌(기존 outbound-channel 레지스트리 규약:
구현+설정 OFF+승인). **CLI 선착수 가능 범위는 ① 준비까지.**

### N5. 의료사회복지 — 의뢰 모듈

조직 신설이 선행(🧑 원무/간호부) — 결정 후: `SocialWorkReferral`(의뢰과·분류: 경제/학대·방임 신고
연계/퇴원 지역자원·상담기록·연계 결과) — 기존 `Consultation`(협진) 패턴 재사용·워크리스트 필수.
🔴 학대 신고 연계는 신고자 보호 규약(환자안전 §17 선례) 적용.

### N6. 얇음 보강 백로그 (각 1줄 설계 — 우선순위 후순)

| 항목 | 설계 | 선행 |
|---|---|---|
| 퇴원계획 | `DischargePlan`(다학제 평가·교육 체크·기관 연계) + 퇴원예정 워크리스트 | 간호부 항목 정의 🧑 |
| 내시경 소독 추적 | 스코프 자산화(장비 모듈 확장)+세척·소독 로그(CSSD 패턴 재사용) | 내시경실 운영 🧑 |
| DUR 수유부금기 | DurRule ruleType 확장+데이터(공신력 소스 🧑) | 데이터 |
| 응급 DOA | disposition 어휘 확장(DOA)+변사체 신고 기록(전송 아님 — LOCAL_RECORDED) | 어휘 승인 🧑 |
| KDCA 접종 연동 | 외부 채널 규약으로(조회 전용) | 🔌 기관 |

---

## §3 우선순위 웨이브

| 웨이브 | 내용 | 근거 |
|---|---|---|
| **R-W1** | R1 화상 + R2 BTG 검토 + R3 상신함 | 안전·규정 표면 + 즉효(화상은 잇기만) |
| **R-W2** | R4 CodeBlue + R5 UDI + R6 retention 화면 + R9 config 6종 | 질·안전/보안 |
| **N-W1** | N2 사망진단서(+N3 출생) 서식 | 최소 신설·데이터 기존재 — 수수료·문안만 사람 |
| **R-W3** | R7 소형 묶음 + R8 중복 정리(관측 개시) | 부채 정리 |
| **N-W2** | N1 미생물 P0(모델+입력+조회) | 최대 갭 — 스키마라 `--schema` 배포·패널 구성 사람 협의 병행 |
| 이후 | N1 P1/P2 · N4~N6 | 사람·외부 진행에 따름 |

## §4 공통 규약 (전 항목)

신설 화면: 화면번호 freeze 등재·nav 소분류·역할은 EP 와 정합(nav 를 API 에 맞춘다)·44px·
QueryErrorFallback·빈/실패/미판정 3상태·워크리스트는 줄어드는 목록. 배선 가드: EP 소비 grep +
재주입 역검증. 스키마 신설: `--schema` 배포·소비처 없는 모델 금지(만들면 화면까지 한 벌).

## §5 사람 결정 표 (착수 차단만 ★)

| # | 결정 | 차단 대상 |
|---|---|---|
| 1★ | N1 항생제 패널 구성·보고 서식(진검과) | N-W2 입력 폼 확정 |
| 2★ | N2 사망진단서 수수료·서식 문안(원무·법무) | N-W1 발행 |
| 3 | R8 모듈 제거 승인(관측 후) | R8 3단계 |
| 4 | R3 게이트 BLOCK 승격 시점(약제위) | 화면 배포 후에만 |
| 5 | N4 payerType 스키마 승인 | N4 ① |
| 6 | N5 사회사업 조직·분류 체계 | N5 전체 |
| 7 | R2 BTG 부여 동선 신설 여부 | R2 확장분만 |

---

## §6 검토 보완 v2 (2026-09-06 · 사람 지시 "디테일하게 추가 검토 + 필요 데이터 검색")

### 6.1 코드 재검증이 교정한 것 (v1 의 부정확·누락)

| 항목 | 실측 | 설계 영향 |
|---|---|---|
| `DocumentRequest.type` | **VarChar(30) 문자열 — enum 아님**(schema:8539) | 🔴 N2 가 더 작아진다: `DEATH_CERT` 추가에 **스키마 변경 불필요** — fee-rules+서식+화면만 |
| `TYPE_FEES` 위치 | `portal.service.ts:1457`(포털 신청 수수료). 🔴 모바일 주석이 기록한 함정 실재: 키 불일치 시 `?? 0` 으로 **수수료 전부 0원 기록**(`apps/mobile/app/(tabs)/documents.tsx:30`) | N2 확장 시 fee-rules·TYPE_FEES **두 곳 동시** + 모바일 키 대조 가드 |
| burn EP prefix | `api/v1/burn-assessment`(**단수**) | R1 가드 grep 은 단수로 |
| pre-auth 상신 DTO | `SubmitOrderPreAuthDto { type·encounterId·approverUserId?(미지정=과장 해소)·draft(CreatePrescriptionDto 스냅샷)·prescriberId? }` | R3 상신 폼 필드 확정 — 처방 초안을 그대로 draft 로 싣는다(승인 시 발행 계약) |
| `LabTestCode.category` 운영 실측 | 8종(생화학·혈액·응고·전해질·내분비·심장표지자·혈액가스·분자진단) — **'미생물' 없음** | 🔴 N1 유입 분류의 정본 = **category '미생물' 신설 + 검사 코드 등재**(오더는 기존 LAB 타입 그대로 — 코드 목록은 진검과 🧑) |
| 위급값 경로 | `lab.service` 의 CriticalValueAlert 재사용 가능 확인 | N1 혈액배양 양성 연결 지점 확정 |

### 6.2 필요 데이터·표준 조사 결과 (출처 명기 — 원문 확인 여부 포함)

**N2 사망진단서·검안서** — 설계를 바꾸는 사실:
- 서식 근거 = **의료법 시행규칙 별지 제6호**(국가법령정보센터 law.go.kr — 원문 서식 열람 가능). 🔴 **사망진단서와 시체검안서는 같은 서식 한 장**이다 — 발급 시 한쪽 표제를 지우고 쓴다 → **서식 1종으로 둘 다 커버**(발급 화면에서 종류 선택).
- 구분 기준: 최종 진료 후 **48시간 이내 사망 = 진단서**, 그 외/미진찰 검안 = 검안서 → 시스템은 마지막 진료 시각 실측으로 **종류를 제안만**(확정은 의사 — 자동 단정 금지).
- 발급권자 의사·치과의사·한의사 — 기존 §17 게이트와 정합.

**N1 미생물 — antibiogram·판정 표준**:
- 원내 감수성 집계(antibiogram) 표준 = **CLSI M39**: 연 1회 이상 · **진단 목적 분리주만**(감시 배양 제외) · 환자당 중복 균주 제거 규칙 → P1 antibiogram 집계 요건으로 등재(분모 병기 규약과 결이 같다).
- S/I/R 판정 기준은 **CLSI vs EUCAST 선택이 결과를 바꾼다**(EUCAST 가 대체로 감수성률 낮음) → 🧑 진검과 결정 항목에 "판정 기준 체계" 추가(§5 표 갱신).

**N4 자보·산재 — 채널 성격 정정** 🔴:
- 자동차보험 진료수가는 **2013-07 부터 심평원 위탁심사** — 청구 경로가 **기존 요양기관업무포털/진료비청구포털과 동일 계열**이다 → 설계 수정: 자보는 별도 기관 채널이 아니라 **기존 HIRA 채널의 명세서 유형 확장**(payerType=AUTO 축 + 자보수가 기준). 산재만 근로복지공단 **토탈서비스**(별도 채널·전자신고).
- 자보수가 기준·심의사례는 심평원 발간물로 공개(2024·2025 PDF 확인).

**R5 UDI — 공공 API 실재 확인** ✅:
- 식약처 **의료기기 UDI/EDI 정보 조회 OpenAPI**(data.go.kr/data/15138675) + **UDI 표준코드 조회**(15073874) — UDI-DI 로 제품명·등급·제조/수입사·**급여 EDI 코드**까지 조회 가능. UDI 포털 공개 API 는 OAuth2.
- → R5 보강: 스캔한 UDI-DI 를 공공 API 로 검증·제품명 자동 채움(수기 오타 제거). API 키 신청 🧑.

**KDCA 예방접종 연계**: 이번 조사에서 의료기관 전산 연계 사양 미확인 — "확인 못 함" 유지(지어내지 않음).

### 6.3 §5 사람 결정 표 갱신분

| # | 추가 결정 | 차단 대상 |
|---|---|---|
| 8 | N1 감수성 판정 기준 체계(CLSI vs EUCAST — 진검과) | N-W2 입력 폼의 S/I/R 해석 표기 |
| 9 | R5 UDI 공공 API 키 신청 | R5 자동 채움(수기 입력은 키 없이 가능) |
| 10 | N4 산재 토탈서비스 전자신고 개통(외부) | N4 ③ |

### 6.4 출처

- [의료법 시행규칙 별지 제6호 — 사망진단서(시체검안서)](https://www.law.go.kr/lsLawLinkInfo.do?lsJoLnkSeq=900518283) · [대한병원협회 발급 유의사항](https://www.kha.or.kr/kha_home/notice_list.do?mode=view&articleNo=18006)
- [CLSI M39 (누적 AST 데이터 분석·표시)](https://nms.go.ug/wp-content/uploads/2025/12/CLSI_M39Ed5E-standard_Analysis-and-Presentation-of-Cumulative-AST-data1.pdf) · [CLSI/EUCAST 판정 일치도 분석](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10149341/)
- [HIRA 자동차보험 심사위탁 법적근거](https://biz.hira.or.kr/contents/html/MP00000902.html) · [자보수가 기준·심의사례 2025](https://www.hira.or.kr/ebooksc/2025/06/BZ202506251782630.pdf) · [고용·산재 토탈서비스 전자신고 핸드북](http://www.kacpta.or.kr/data/Board/BoardInfoNotice/%C0%FC%C0%DA%BD%C5%B0%ED%C7%DA%B5%E5%BA%CF(0).pdf)
- [식약처 UDI/EDI 조회 OpenAPI](https://www.data.go.kr/data/15138675/openapi.do) · [UDI 표준코드 OpenAPI](https://www.data.go.kr/data/15073874/openapi.do) · [UDI 포털 공개 API 안내(OAuth2)](https://udiportal.mfds.go.kr/brd/view/P01_01?ntceSn=38&pageNum=1)

## §7 진행 기록

### R-W1 완료 (2026-09-06)

| 항목 | 결과 |
|---|---|
| R1 화상 평가 배선 | 환자 차트 **burns 탭**(`BurnsTab.tsx`) 신설 — 이력 GET·부위 클릭 편집(깊이 4종·범위 명시선택)·TBSA 서버 재산정(3상태)·Parkland(weightSource 표기)·저장. `BurnsChart` export 정리(`BURN_REGIONS`·`BurnRegion`·`RegionDef`) |
| R2 BTG 사후검토 | `/admin/break-glass`(**3406**·nav '기록·감사·감시'·ADMIN) — 미검토 워크리스트+검토 완료(확인 다이얼로그)+검토 완료 목록. 🔴 대상은 **로그인 응급접근**(authEmergencyAccess) — 환자열람 BTG 와 별개임을 화면이 명시. 절단(최근 100건) 정직 표기. **EP 에 소견 필드 없음** — "검토자·시각만 남는다"를 화면이 밝힘(소견 저장은 스키마 필요 — 후속) |
| R3 사전승인 상신 | orders 화면 — `PREAUTH_REQUIRED` 차단 분기(신규·강제처방 재전송 양쪽)→상신 다이얼로그(승인의 선택·미지정=과장 자동해소·**상신≠발행** 명시)+'상신 중' 목록(`GET mine`·PENDING 취소). 유형은 게이트 판별과 같은 축(약=NARCOTIC_RX·영상=HIGH_COST_IMAGING) |
| 가드 | `test/architecture/gap-remediation-w1.spec.ts` 10케이스 — **재주입 역검증 3축 완주**(주입 count assert → 3축 실패 확인 → 복원 → 10/10·잔재 0). 재주입이 가드 결함 1건을 먼저 잡음: 접미사 치환(`<BurnsChartX`)이 `/<BurnsChart/` 에 무동작 통과 → `[\s/>]` 경계로 조임 |
| 문서 정정 | `system-enhancement-roadmap.plan.md` #13 "화상 평가 ✅ 구현완료" → **배선완료(2026-09-06)** + 고아였던 이력(P16성) 명기 |

🔴 잔여 규약(§5 유지): **상신함 배포 전 `preauth.enforce.NARCOTIC_RX: BLOCK` 승격 금지** — 이번 배포로 상신함이 살았으므로 승격은 이제 **운영 판단**(사람 몫)이다. BTG 검토 소견 필드는 스키마 변경 필요 — R-W2 이후 후보.

### R-W2 완료 (2026-09-06)

| 항목 | 결과 |
|---|---|
| R4 Code Blue/RRT | `/code-blue`(**1305**·nav '수술/중환자'·CLINICAL) — 3탭(코드블루·RRT·통계). 시각은 "지금" 명시 클릭만·미종결 워크리스트·음수 SLA "시간 역전 기록" 표기·200건 절단 표기. **API 보정 2**: ① GET 3종 `@Roles` 누락 봉합(전 직군이 심정지 기록 열람 가능했다) ② stats 표본 0 → roscRate `null`(0% 아님)+ongoing/transfer/arrivalsN 분모 병기. 잔여 등재: 상태 전이·시간 순서 서버 무강제, RRT 격상→코드블루 자동 연계 없음(화면이 안내), 알림 0(스태프콜 CODE 별도 계통 — staffCallId 잇는 코드 없음) |
| R5 UDI 기기 추적 | `/surgery/[id]` 에 삽입 기기 패널(스캔 미리보기→기록·체크디지트 불일치 표기·`Surgery.implants` 자유텍스트와 별개 원장 명시·환자 연결 없으면 정직 비활성) + `/admin/device-recall`(**3407**·'의료질·안전') — AND 결합 명시·절단(truncated) 표기·0건≠해당없음(서버 caveat 표시). 잔여 등재: byPatient 200건 절단 신호 없음(화면이 문구로 보완)·usedAt 소급 입력 불가·udiDi/attachments 죽은 컬럼 |
| R6 Retention 관제 | `/admin/retention`(**3408**·'기록·감사·감시') — 정책 표(법무 확정 대기 배지)·DRY-RUN 버튼(🔴 GET 이지만 lastRunAt 쓰기 부작용 — 마운트 자동 실행 금지·가드)·supported=false 는 "세지 않음(핸들러 없음)"(0 아님)·4-eyes 큐(RETENTION_PURGE 만 분리 — 서버 목록 무필터 실측·반려는 identity 안내)·**실행 버튼 없음**(고위험 핸들러 의도적 미구현을 배너로 정직 표기) |
| R9 config 6종 | **배선 4**: ①vitals.criticalAlert·②lab.criticalNotify(둘 다 fail-open — 명시적 false 만 통보 억제·기록은 유지·억제 로그)·③session.timeoutMinutes(로그인+회전 발급·5~1440 클램프·binding 우선)·④password.minLength(강화 전용 max(12,설정)·DEFAULTS 8→12 정정·**update() 뒷문 봉합**). **제거 2**: ⑤requireSpecial(완화 스위치 성립 불가 — 선언 기준의 일부)·⑥audit.retentionDays(RetentionPolicy.AUDIT_LOG 와 중복 정본). unwired 기준선 48→**42**·미배선 고지 6키 제거(낡은 "8자 고정" 문구 포함) |
| 가드 | web `gap-remediation-w2.spec.ts` 14 + api `wired-config-r9.spec.ts` 9 — **재주입 6축 완주**(주입 count assert→5/6 검출→미검출 1건(toContain 접미사 함정 재발)을 경계 정규식으로 조임→6/6→tar 복원·잔재 0). user.service update 정책 거부 스펙 추가 |
| 잔여(등재만) | 환자·바우처 비밀번호 자체 규칙 4곳(직원 정책과 다른 게 정당할 수 있음 — 사람 판단)·~~touchSession 미배선(서버 idle 만료 집행 부재)~~ → 2026-09-14 해소: idle 만료는 `jwt.strategy` `idle:` 키가 이미 집행(표기가 틀렸다)·세션 `lastActiveAt` 은 `session-activity.ts`(sid 단위·KEEPTTL·60초 스로틀)로 배선·PACU VITAL_ALERT 는 게이트 밖(별도 발화점)·~~code-blue DTO 부재(inline-body 가드 허용목록 4)~~ → 2026-09-14 해소: `apps/api/src/modules/code-blue/dto/code-blue.dto.ts`(P2 `7ae39583`) |

### N-W1 완료 (2026-09-06)

| 항목 | 결과 |
|---|---|
| N2 사망진단서 | B그룹 편입(DEATH_CERT — 작성·서명·발급·면허표기·멱등·감사 무상 승계). **§17 게이트 신설**: 사망 기록 필수(DEATH_RECORD_REQUIRED)+작성 자격=진료 이력 또는 사망 확인 의사(NOT_ATTENDING_DEATH)+직접 사인(가) 필수. **48시간 규칙은 제안만**(suggestedKind — 최종 진료 부재 시 null "판정 불가"·확정은 의사·검안서는 certKind 전환으로 같은 서식 한 장). print 서식 `DeathCertificateDoc`(별지 제6호 준거·원인별 기간/부검 소견은 원천 부재로 공란 — 지어내지 않음) |
| N3 출생증명서 | 동일 패턴(BIRTH_CERT). 원천=DeliveryRecord/NewbornRecord(관계 없음 — 수동 조회). 다태아는 **순번 지정 필수**(단태아만 자동)·주수 "39+2" 원문 그대로. 부(父)·신생아 성명은 공란 정직 표기. 포털 신청 가능(산모 본인 — CERT_TYPES 등재) |
| 창구 접수 | `POST /staff/document-requests` 신설 — **사망진단서는 포털 신청이 성립 불가**(사망자 본인 계정)라 접수 경로 없으면 죽은 기능. requesterType='STAFF'·신분/관계 확인은 창구 대면 책임(시스템 미검증 — 화면 고지)·수수료는 규칙엔진 정본(TYPE_FEES 중복표 미사용·미지 종류=400). 포털 select 에서 DEATH_CERT 제외 |
| 수수료 | fee-rules+portal TYPE_FEES **두 곳 동시 확장**(사망 10,000·출생 3,000 — 기존 표와 같은 제증명수수료 상한 고시 계열·원내 확정은 config 개정=사람). 가드가 양쪽 금액을 기계 대조 |
| 실측이 잡은 함정 | §17 게이트가 type 문자열 하드코딩(B_GROUP 만 추가하면 아무 의사나 작성 — OPINION/ADMISSION_CERT 가 현재 그 상태)·TYPE_FEES 키 부재=조용한 0원(모바일 사고 선례)·전자서명은 SIMULATION(sha256 ref) |
| 가드 | api `death-birth-cert.spec.ts` 10 + web `gap-remediation-n1.spec.ts` 9 — **재주입 4축 완주**(게이트 무력화·수수료 한쪽 누락·디스패치 접미사·다태아 자동 단정 → 4/4 검출·tar 복원·잔재 0) |

🔴 잔여(사람 몫·§5 유지): 서식 문안·수수료 원내 확정(법무/원무) · 검안서 별건 요건(법무) · OPINION/ADMISSION_CERT 의 §17 무게이트(기존 동작 — 별도 판단) · 사망 원인별 기간·수술/부검 소견 원천 스키마(입력 UI 없음 — 필요 시 신설).
