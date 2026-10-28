# 수진자 자격조회 + 본인확인 의무화 설계서 v1.0

> Plan: [patient-eligibility-verification.plan.md](../../01-plan/features/patient-eligibility-verification.plan.md) (v1.0)
> 작성일: 2026-06-12 / 상태: Draft
> 핵심: 자격조회 결과(copayCategory)를 **billing copay 계산의 권위 입력**으로 연결 → 접수~영수 관통. 실연동은 어댑터 교체(시뮬레이션 우선).

## 1. 아키텍처

```
[접수 FE] 본인확인 + 자격조회
   │  POST /api/v1/eligibility/check {patientId, visitType}
   ▼
[eligibility 모듈]
   EligibilityService.check()
     → EligibilityProvider(인터페이스)
         ├ SimulationProvider (mode=SIMULATION) — 환자데이터 기반 결정적
         └ NhisProvider (mode=NHIS) — 공단 API(추후, 스텁)
     → EligibilityCheck 저장(copayCategory·자격득실·산정특례)
     → WaitingQueue.eligibility* 갱신 + journey ELIGIBILITY_CHECKED + Audit
   ▼
[billing] resolveCopay(eligibility, visitType, procedureCopayRate)
     → config billing.copay.* 기반 본인부담률 → patientCopay
   ▼
[수납/영수] 자격 기반 본인부담 정확 반영
```

## 2. 데이터 설계

### 2.1 신규 모델 `EligibilityCheck`
```prisma
model EligibilityCheck {
  id               String    @id @default(uuid()) @db.Uuid
  patientId        String    @map("patient_id") @db.Uuid
  insuranceType    InsuranceType @map("insurance_type")
  status           String    @db.VarChar(16)              // VERIFIED|EXPIRED|NOT_FOUND|ERROR
  copayCategory    String    @map("copay_category") @db.VarChar(24) // §2.2 허용값
  coverageStartDate DateTime? @map("coverage_start_date") @db.Timestamptz()
  coverageEndDate  DateTime? @map("coverage_end_date") @db.Timestamptz()
  specialExemption String?   @map("special_exemption") @db.VarChar(40)  // 산정특례 코드(V027 등)|null
  exemptionExpiry  DateTime? @map("exemption_expiry") @db.Timestamptz()
  source           String    @db.VarChar(12)             // SIMULATION|NHIS
  visitType        String?   @map("visit_type") @db.VarChar(12)  // OUTPATIENT|INPATIENT
  rawResponse      Json?     @map("raw_response")
  message          String?   @db.VarChar(200)
  checkedById      String?   @map("checked_by_id") @db.Uuid
  queriedAt        DateTime  @default(now()) @map("queried_at") @db.Timestamptz()
  patient          Patient   @relation(fields: [patientId], references: [id])
  @@index([patientId, queriedAt])
  @@map("eligibility_checks")
}
```

### 2.2 `copayCategory` 허용값 ↔ 본인부담률(config 기반)
| copayCategory | 의미 | 외래율 | 입원율 | 비고 |
|---------------|------|:---:|:---:|------|
| `NHI` | 건강보험 | `billing.copay.nhi.outpatient`(30) | `billing.copay.nhi.inpatient`(20) | 기본 |
| `MA_TYPE1` | 의료급여 1종 | `billing.copay.ma1.outpatient`(0) | 0 | 정액(외래 1차 1,000원 등 추후 정밀) |
| `MA_TYPE2` | 의료급여 2종 | `billing.copay.ma2.outpatient`(15) | 10 | |
| `NEAR_POOR` | 차상위 | `billing.copay.nearpoor.outpatient`(14) | 14 | 신규 키 |
| `SPECIAL_EXEMPTION` | 산정특례 | `billing.copay.exemption.rate`(10) | 동일 | 암 5%·희귀 10% 등(코드별, 단일율로 시작) |
| `INDUSTRIAL`/`AUTO` | 산재/자보 | 0 | 0 | 제3자 |
| `SELF_PAY` | 자비 | 100 | 100 | |

> 신규 config 키: `billing.copay.nearpoor.outpatient`(14)·`billing.copay.exemption.rate`(10)·`billing.copay.ma1.inpatient`(0)·`billing.copay.ma2.inpatient`(10). 기존 `billing.copay.*` 재사용. **현재 미사용이던 config를 실제 사용으로 전환**(정적 COPAY_RATES → config+자격 기반).

### 2.3 기존 모델 확장
- `WaitingQueue` + `eligibilityStatus`(String? — VERIFIED\|EXPIRED\|NOT_CHECKED\|ERROR)·`eligibilityCheckId`(Uuid?)·`identityVerifiedAt`(Timestamptz?).
- `Encounter` + `eligibilityCheckId`(Uuid? — 진료시점 자격 스냅샷, copay 권위).
- `PatientIdentificationCheck`(실재) — checkType에 **`RECEPTION_IDENTITY`** 추가, method에 `ID_CARD`·`MOBILE_INSURANCE`·`VERBAL_EXCEPTION` 사용(스키마 String이라 마이그레이션 불요).

## 3. EligibilityProvider (어댑터)
```ts
interface EligibilityResult {
  status: 'VERIFIED'|'EXPIRED'|'NOT_FOUND'|'ERROR';
  copayCategory: string; coverageStartDate?: string; coverageEndDate?: string;
  specialExemption?: string|null; exemptionExpiry?: string|null;
  message?: string; raw?: unknown;
}
interface EligibilityProvider { check(input: { patient, visitType }): Promise<EligibilityResult>; }
```
- **SimulationProvider**(mode=SIMULATION): 환자 `insuranceType`·생년월일·`insuranceNumber` 기반 **결정적**.
  - MEDICAID → MA_TYPE1/2 교번(보험번호 해시 짝홀), 무효 보험번호(없음)→ `NOT_FOUND`.
  - NHI + 고령(만 65세↑) 또는 특정 해시 → `SPECIAL_EXEMPTION`(예 암 V027) 일부.
  - 보험번호 특정 패턴 → `EXPIRED`(자격상실 시나리오, 전액 본인부담 검증용).
  - 기본 → NHI VERIFIED. `source=SIMULATION` 명시.
- **NhisProvider**(mode=NHIS): config `eligibility.apiUrl/apiKey`로 공단 호출(서명·보안매체) — **스텁**(미설정 시 ERROR/시뮬레이션 폴백). 추후 실구현.

## 4. API (`/api/v1/eligibility`, JwtAuthGuard + 원무/임상 역할)
```
POST /eligibility/check          # {patientId, visitType?, queueId?} → EligibilityCheck (자동 영속·대기열 갱신)
GET  /eligibility/patient/:id    # 최신 자격(캐시 유효 시 재사용)
POST /eligibility/queue/:id/verify-identity  # {method, verifiedItems, exception?} → PatientIdentificationCheck(RECEPTION_IDENTITY)
```
- config 미설정/`eligibility.enabled=false` → 503 `ELIGIBILITY_DISABLED`(수동 분류 폴백). 전역필터 정합(`HttpException({error:code})`).

## 5. billing 연동 (핵심 — 영수 관통)
`billing.service.ts`에 `resolveCopayRate` 도입:
```ts
// 우선순위: 항목별 procedureCode.copayRate > 자격(copayCategory) > 정적 COPAY_RATES(폴백)
private async resolveCopayRate(patientId, insuranceType, visitType): Promise<number> {
  const elig = await prisma.eligibilityCheck.findFirst({ where:{patientId}, orderBy:{queriedAt:'desc'} });
  if (elig?.status === 'VERIFIED') return rateOf(elig.copayCategory, visitType); // config 기반
  if (elig?.status === 'EXPIRED' || elig?.status === 'NOT_FOUND') return 1.0;     // 자격없음=전액
  return COPAY_RATES[insuranceType] ?? 0.3;                                       // 미조회 폴백
}
```
- `createFromEncounter`(line 148)·`emitAccrualLine`(line 358)의 `copayRate` 산정을 `resolveCopayRate`로 대체. 항목별 `procedureCode.copayRate`는 그대로 우선(비급여·특정행위).
- `rateOf(category, visitType)`는 config-runtime `billing.copay.*`(%)→소수. **자격조회가 billing의 권위 입력**이 되어 의료급여 정액·산정특례·차상위·상실자 전액이 수납/영수에 반영.

## 6. 접수 통합 (FE)
- `reception` 당일/예약 check-in 후(또는 신규환자 등록 후) **자격조회 자동 호출** + 본인확인 모달.
- 본인확인 모달: 방법 선택(신분증 OCR 기존 재사용·모바일건보증 QR(스텁)·구두(예외사유)) → `verify-identity`.
- 대기열/접수 카드에 **자격 배지**(✅자격확인·⚠️자격상실·❓미확인·🏷️산정특례) + 본인확인 ✓.
- 수동 재조회 버튼. 자격 상실/미확인 시 수납 화면 경고.

## 7. 이벤트·감사
- journey `ELIGIBILITY_CHECKED`(refType=ELIGIBILITY, severity=상실 시 warning).
- AuditLog: 자격조회·본인확인 전부(action READ/CREATE, resourceType ELIGIBILITY_CHECK / IDENTITY_CHECK).
- `source=SIMULATION` 결과는 UI에 "시뮬레이션" 표기(실 자격 오인 방지).

## 8. 구현 순서
1. 스키마(`EligibilityCheck` + WaitingQueue/Encounter 필드) + config 키(nearpoor·exemption·ma 입원) → `prisma db push`.
2. `eligibility` 모듈(provider·service·controller) + 시뮬레이션 어댑터.
3. billing `resolveCopayRate` 연동(createFromEncounter·emitAccrualLine).
4. 접수 FE(자격조회·본인확인·배지) — 최소 동작.
5. journey·감사·캐시. **영수 관통 E2E**(접수→자격→진료→수납→영수, 의료급여/산정특례/상실 케이스).

## 9. 테스트
| 영역 | 케이스 |
|------|--------|
| 시뮬레이션 | NHI 정상·의료급여 1/2종·차상위·산정특례·자격상실(EXPIRED)·미발견 |
| billing 연동 | copayCategory별 patientCopay 정확(의료급여 0/정액·산정특례 10%·상실 100%), 항목 copayRate 우선 |
| 본인확인 | 신분증/구두예외 기록, 미성년·응급 예외, 미확인 경고 |
| 영수 관통 | 접수→자격→진료→수납→영수 본인부담 일치 |
| 폴백 | eligibility.enabled=false 시 기존 정적 동작 유지(무중단) |

## 10. 미해소
- 의료급여 1종 외래 정액(1,000/1,500원) — 현재 율(%) 모델. 정액은 후속(정액 플래그).
- 산정특례 코드별 차등율 — 단일율 시작, 코드 테이블 후속.
- NHIS 실연동 어댑터·모바일건보증 QR 실검증(P2).
