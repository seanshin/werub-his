# 검진 프로토콜 정의·관리 기획서 v1.0

> 검진 프로그램·검사별 **판정 룰 · 판독 라우팅 · 검토/서명 단계 · 의사 자격**을 표준화해 정의·관리하는 계층
> 연계: [checkup-result-report.plan.md](./checkup-result-report.plan.md)(결과서 작성·검토·발급) · [health-checkup.plan.md](./health-checkup.plan.md)(검진 시스템) · 환자여정 [[journey_protocol]]
> 작성일 2026-06-30

---

## 1. 개요

### 1.1 배경 — 왜 필요한가
결과서 작성·검토·발급 흐름(검토 게이트·서명·IssuedDocument 발급)은 구축됐으나, **그 흐름이 따르는 "규칙(프로토콜)"이 코드에 흩어져 있거나 표준 정의가 없다.**
- 자동판정(`autoCollectResults`)은 **거칠게 하드코딩**(Lab 결과는 기본 NORMAL) — 참고치 기반 등급 판정·위급값·성별/연령 보정 없음.
- 판독 담당과(`CheckupTestMaster.interpretDept`)는 항목별로 존재하나, **"필수 판독 영역·검토 단계·서명 자격"이 프로토콜로 관리되지 않음**.
- 검진의 서명은 역할/전자서명 검증이 약함([checkup-result-report] §의사 인증 갭).
→ **검진 프로토콜**: 프로그램/검사 단위로 위 규칙을 정의·버전관리하고, 결과 흐름이 이를 **실행**하도록 한다.

### 1.2 목적
- 검진의 **판정·판독·검토·서명** 규칙을 한곳에서 정의(표준화)하고 화면에서 관리(CRUD·버전·발효).
- 결과 자동판정·검토 게이트·의사 인증이 **프로토콜에 근거**해 일관되게 동작.

### 1.3 범위
프로토콜이 정의하는 것: ① 검사 패널·스테이션 순서 ② **항목별 판정 룰**(참고치·등급·위급값) ③ 판독 라우팅(과·자격) ④ 결과서 검토/서명 단계(필수 판독·종합소견·4-eyes·서명 자격) ⑤ 버전·발효.
> 환자여정/동선 단계(체크인→스테이션 이동)는 기존 `ProtocolTemplate(domain=CHECKUP)`·`CheckupStation`과 연계(중복 정의 금지).

### 1.4 현황 분석 (코드 기준)

| 요소 | 현행 | 갭 |
|------|------|----|
| 검사항목 마스터 | `CheckupTestMaster`(code·category·**interpretDept**·**referenceRange**·unit) | 참고치=문자열("70~110")·구조화/등급매핑/위급값 없음 |
| 프로그램 정의 | `CheckupProgram`(items JSON·options·gender/age) | 검사 패널만·판정/검토 규칙 없음 |
| 스테이션 | `CheckupStation`·`CheckupStationLog` | 동선·진행만 |
| 자동판정 | `autoCollectResults`(Lab 기본 NORMAL·Imaging finding 유무) | **룰 기반 아님**(참고치 미적용·등급 미산출) |
| 판독 | `CheckupInterpretation`(department·finding·grade·status) | 필수 판독 영역·자격 미정의 |
| 결과 검토/서명 | `getResultReadiness`(미완료 판독·소견 누락) · `signSummary` | 게이트 항목·서명 자격이 **하드코딩**·프로토콜 미연계 |
| 여정 프로토콜 | `ProtocolTemplate(domain=CHECKUP)`·`ProtocolStep`(gate·ownerRoles·actionType) | 검진 판정/검토와 미연결 |

---

## 2. 프로토콜 개념 모델

```
CheckupProtocol (프로그램·연령·성별 조건에 바인딩되는 규칙 묶음)
├─ 검사 패널          : 포함 CheckupTestMaster[] (+ 스테이션 순서)
├─ 판정 룰(JudgmentRule[]) : 항목별 참고치·등급 매핑·위급값·성별/연령 보정
├─ 판독 라우팅        : 항목/영역 → 담당과(자격) · 필수 판독 여부
├─ 검토/서명 단계     : 판독 완료 게이트 · 종합소견(검진의) · (옵션)4-eyes · 서명 자격
└─ 버전/발효          : DRAFT → ACTIVE → RETIRED (발효본 불변·이력)
```

판정 등급(국가검진 호환): **A 정상 · B 경미이상 · C1 요관찰 · C2 요치료 · D1 정밀검사 · D2 유질환**.

---

## 3. 데이터 모델 (신규)

```prisma
model CheckupProtocol {
  id          String   @id @default(uuid()) @db.Uuid
  code        String   @db.VarChar(40)
  name        String   @db.VarChar(160)
  programId   String?  @map("program_id") @db.Uuid   // 특정 프로그램 바인딩(없으면 공통)
  gender      String   @default("ALL") @db.VarChar(10)
  ageMin      Int?     @map("age_min")
  ageMax      Int?     @map("age_max")
  version     Int      @default(1)
  status      String   @default("DRAFT") @db.VarChar(12) // DRAFT|ACTIVE|RETIRED
  // 검토/서명 단계 정의
  requireAllInterpretations Boolean @default(true) @map("require_all_interpretations") // 미완료 판독 0 게이트
  requireFourEyes           Boolean @default(false) @map("require_four_eyes")          // 작성≠서명 2인
  signerRoles               String[] @default(["DOCTOR"]) @map("signer_roles")          // 서명 자격(역할)
  panelTestCodes            String[] @default([]) @map("panel_test_codes")              // 검사 패널(TestMaster.code)
  publishedAt DateTime? @map("published_at") @db.Timestamptz()
  publishedBy String?   @map("published_by") @db.Uuid
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz()
  rules       CheckupJudgmentRule[]
  @@map("ck_protocols")
}

model CheckupJudgmentRule {
  id          String  @id @default(uuid()) @db.Uuid
  protocolId  String  @map("protocol_id") @db.Uuid
  testCode    String  @map("test_code") @db.VarChar(30)  // CheckupTestMaster.code
  sex         String  @default("ALL") @db.VarChar(10)
  ageMin      Int?    @map("age_min")
  ageMax      Int?    @map("age_max")
  // 수치 판정: [low, high] 정상 + 등급 경계
  normalLow   Float?  @map("normal_low")
  normalHigh  Float?  @map("normal_high")
  // 등급 경계(JSONB): [{op:'>',value:200,grade:'C2'}, {op:'between',min:140,max:159,grade:'C1'}...]
  gradeBands  Json?   @map("grade_bands") @db.JsonB
  panicLow    Float?  @map("panic_low")     // 위급값
  panicHigh   Float?  @map("panic_high")
  interpretDept String? @map("interpret_dept") @db.VarChar(50) // 라우팅 override(없으면 TestMaster)
  requiredInterpretation Boolean @default(false) @map("required_interpretation") // 필수 판독 영역
  protocol    CheckupProtocol @relation(fields: [protocolId], references: [id], onDelete: Cascade)
  @@unique([protocolId, testCode, sex])
  @@map("ck_judgment_rules")
}
```
> `gradeBands`는 JSONB로 가변 룰 표현(임계·구간·등급). 발효(ACTIVE) 시 룰 스냅샷이 결과 판정에 사용되며, 발효본 변경은 신규 버전으로.

---

## 4. 기능 설계

### 4.1 판정 룰 엔진 (P0 핵심)
- `applyJudgment(testCode, value, {sex, age})` → `{ finding: NORMAL|ABNORMAL|CRITICAL, grade: A~D2, panic: bool }`.
- 우선순위: 위급값(panic) → gradeBands 매칭 → normalLow/High 범위 → 기본.
- `autoCollectResults`가 Lab 수치에 룰을 적용해 finding·grade 산출(현행 기본 NORMAL 대체). 룰 없는 항목은 PENDING(판독 대기).

### 4.2 판독 라우팅
- 항목별 `interpretDept`(룰 override 또는 TestMaster) 기준으로 `CheckupInterpretation` 생성·대기열 분배.
- `requiredInterpretation=true` 영역은 **필수 판독**(검토 게이트 대상).

### 4.3 검토/서명 단계 연계
- `getResultReadiness`가 **프로토콜의 게이트 정의**를 반영: `requireAllInterpretations`면 미완료 필수 판독 0 검증.
- `signSummary`가 **프로토콜 `signerRoles`로 서명 자격 검증**(현재 역할 미검증 갭 해소) + `requireFourEyes`면 작성자≠서명자 강제.
- → 앞 [checkup-result-report] §의사 인증 갭(역할 미검증·작성/서명 미분리)이 프로토콜로 해소.

### 4.4 버전·발효
- DRAFT 편집 → ACTIVE 발효(publishedAt/By) → RETIRED. 결과 판정은 visit 시점 ACTIVE 프로토콜 사용(재현성).

---

## 5. 관리 화면

| 화면 | 경로(안) | 기능 |
|------|----------|------|
| 프로토콜 목록 | `/his-checkup/protocols` | 프로그램·버전·상태 목록·발효/폐기 |
| 프로토콜 편집 | `/his-checkup/protocols/[id]` | 검사 패널 선택·판정 룰 표 편집·라우팅·검토/서명 단계·서명 자격 |
| 판정 룰 표 | (편집 내) | 항목별 참고치·등급 경계·위급값·성별/연령 보정 |

기존 검진 관리(<a>프로그램·검사항목 마스터</a>) 옆에 "검진 프로토콜" 탭 추가.

---

## 6. 결과 흐름 연계 (실행)

```
검사 결과 입력/수집 → applyJudgment(프로토콜 룰) → finding·grade·위급값
   → 필수 판독 영역 CheckupInterpretation 분배(라우팅)
   → 판독 완료 → getResultReadiness(프로토콜 게이트) → 종합소견(검진의)
   → signSummary(프로토콜 signerRoles 자격·4-eyes) → 결과서 발급
```

---

## 7. API (신규)

| EP | 설명 |
|----|------|
| `GET/POST/PUT /checkup/protocols` · `/:id` | 프로토콜 CRUD(ADMIN) |
| `POST /checkup/protocols/:id/publish` · `/retire` | 발효·폐기(버전) |
| `GET/PUT /checkup/protocols/:id/rules` | 판정 룰 일괄 편집 |
| `GET /checkup/protocols/resolve?programId=&sex=&age=` | visit에 적용될 ACTIVE 프로토콜 해소 |
| (내부) `applyJudgment` | autoCollect·결과입력에서 호출 |

---

## 8. 단계 (Phase)

| 단계 | 범위 | 상태 |
|------|------|------|
| **P0** | CheckupProtocol·JudgmentRule 모델 + CRUD/발효/폐기 + resolve + `judge` 엔진 + judge-preview | ✅ 구현·배포·검증 |
| **P1** | 검토 게이트·서명 자격(signerRoles)·4-eyes를 프로토콜 기반으로 전환(결과서 흐름 연계) | ✅ 백엔드 구현·검증 / ⏸ 관리 화면(FE) |
| **P2** | 결과 파이프라인 결선·성별/연령 보정·위급값 알림·국가검진 표준 룰 시드·여정 프로토콜 연계 | ✅ addResult 결선·검증 / ⏸ autoCollect(Lab)·위급값알림·국가검진시드 |

> **P2 결선(2026-06-30)**: `CheckupResultItem`에 `testCode`·`grade` 추가. `addResult`가 testCode+value+ACTIVE 프로토콜 매칭 시 `judgeByProtocol`로 finding·grade 자동 산정(입력값보다 우선·미매칭 시 입력값/PENDING). 성별/연령 보정 룰 적용. 검증 FBS=130→CRITICAL/C2·90→NORMAL/A. **autoCollect(Lab) 자동판정은 미결**(검사실 인터페이스의 per-analyte 값·testCode 매핑 선결 — 검사실 모듈 소관). 위급값 알림·국가검진 표준 룰 시드도 후속.

> **P0 구현(2026-06-30)**: `CheckupProtocol`/`CheckupJudgmentRule` 모델·`CheckupProtocolService`(CRUD·publish/retire·resolve·judge 룰엔진: 위급값→gradeBands→정상범위 우선)·`CheckupProtocolController`(`/api/v1/checkup/protocols` + judge-preview). 운영 검증: FBS 90→A·110→C1·130→C2·420→D1(panic). **autoCollect/addResult 자동판정 결선은 결과항목의 testCode 연계 선결**(현 CheckupResultItem은 testName만 보유) → P2.

> P0 스키마 변경 → 마이그레이션(백업·prisma generate 선행). 기존 데이터 무영향(신규 테이블).

## 9. 권한·표준
- 정의·발효=ADMIN/검진센터장. 판정 룰은 임상 검토 후 발효.
- 표준: 건강검진기본법·국가건강검진 판정기준(일반/암)·검사항목 참고치(검사의학회), 의료법 §17(판정·소견 의사 행위).

## 10. Out of Scope
- 검사 장비 원천 결과·참고치 연동(검사실 인터페이스 소관, 룰은 별도)
- 동선/스테이션 물리 배치(기존 CheckupStation)
- 수가/정산(ERP)

## 11. 수용 기준 (P0)
- 프로토콜·판정 룰 CRUD·발효 동작. 발효 프로토콜로 Lab 수치가 등급(A~D2)·위급값 자동 판정.
- visit에 (프로그램·성별·연령) 기준 ACTIVE 프로토콜이 결정적으로 해소.
- 룰 없는 항목은 PENDING(판독 대기)로 안전 처리.
