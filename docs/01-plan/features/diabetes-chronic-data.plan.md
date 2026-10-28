# 만성질환(당뇨) 측정수치 시드 · 추이 데이터 구조 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/src/modules/chronic/chronic-sync.service.ts · apps/api/src/modules/chronic/chronic.service.ts · apps/api/prisma/schema.prisma:12655 model FlowSheetEntry · 잔여: 없음

> **Feature**: diabetes-chronic-data
> **Version**: 1.0 (Plan)
> **Date**: 2026-06-21
> **Status**: Plan (설계 전 검토)
> **근거 조사**: LabResult/LabResultItem(혈당·HbA1c 저장) · LabResultsTab TrendSparkline(추이) · ProblemList/EncounterDiagnosis(E11 당뇨) · seed.ts(현재 환자 30명)

---

## 0. 목적
현재 환자들에게 **당뇨 측정수치 시계열 시드**를 배치하고(당뇨 환자 ~30%, 각자 5~30회 측정), 그 **변화 추이를 차트에서 확인**할 수 있도록 **정제(쿼리) 가능한 데이터 구조**를 정의한다.

---

## 1. 현황 (조사 결과)
| 자산 | 상태 | 비고 |
|------|------|------|
| `LabResult` + `LabResultItem` | ✅ | testName·value·unit·normalMin/Max·flag·collectedAt/completedAt — **혈당·HbA1c 시계열 저장 적합** (단 LabResult.orderId @unique = Order 필요) |
| `ProblemList`·`EncounterDiagnosis`·`DiagnosisCode`(E11) | ✅ | 당뇨 진단 연결(제2형 당뇨 E11) |
| 추이 차트 | ✅(부분) | `LabResultsTab`의 `TrendSparkline`(SVG)·`TREND_PANELS`(Metabolic: HbA1c/Glucose/LDL). recharts 미사용 |
| `VitalSign` 전용 모델 | ❌ | 혈압/체중/BMI는 Encounter.objective 텍스트·Nursing/Checkup JSON에 산재 → 추이 쿼리 불가 |
| 당뇨 시드 | △ | 환자 2~3명만 FBS/HbA1c 단발. 시계열·30% 미달 |
| 환자 수 | 30명 | 30% ≈ **9명**을 당뇨로 배치 |

---

## 2. 데이터 구조 (정제 가능 = 정규화 시계열 + 추이 API)

### 2.1 저장 — 2계층
- **A. 검사실 기반 수치(HbA1c·공복/식후혈당)** → 기존 **LabResult/LabResultItem** 재사용.
  - 시드 시 합성 Order + LabResult(측정일 completedAt) + Item(testName/value/unit/normalMin/Max/flag).
- **B. 비검사 시계열(자가혈당 SMBG·혈압·체중·BMI)** → **신규 정규화 모델 `ChronicObservation`** 제안.
  - Order 없이 가볍게 시계열 저장. 자가측정·외래 vital·가정 모니터링 포함 가능.

### 2.2 신규 모델 `ChronicObservation` (정규화·인덱스·쿼리 최적)
```prisma
model ChronicObservation {
  id          String   @id @default(uuid()) @db.Uuid
  patientId   String   @map("patient_id") @db.Uuid
  code        String   @db.VarChar(20)   // FBS|PPG|HBA1C|SBP|DBP|WEIGHT|BMI (정규 코드)
  value       Decimal  @db.Decimal(8,2)
  unit        String   @db.VarChar(10)   // mg/dL|%|mmHg|kg|kg/m2
  measuredAt  DateTime @map("measured_at") @db.Timestamptz
  source      String   @default("CLINIC") @db.VarChar(12) // CLINIC|SMBG|CHECKUP|DEVICE
  normalMin   Decimal? @db.Decimal(8,2)
  normalMax   Decimal? @db.Decimal(8,2)
  flag        String?  @db.VarChar(2)    // N|H|L
  encounterId String?  @map("encounter_id") @db.Uuid
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz()

  patient Patient @relation(fields: [patientId], references: [id])
  @@index([patientId, code, measuredAt])  // 추이 쿼리 핵심 인덱스
  @@map("chronic_observations")
}
```
- **정제 가능 핵심**: `(patientId, code, measuredAt)` 복합 인덱스 → "환자×지표×기간" 추이 쿼리가 O(log n)+range. 코드 정규화로 testName 문자열 파싱 불필요(LabResult는 testName 한글 문자열이라 집계 취약).
- manual SQL(db push 차단 환경) + 서버 prisma generate.

> **대안(무스키마)**: A·B 모두 LabResultItem에 담을 수도 있으나, 혈압/체중까지 "검사결과"로 넣으면 의미 왜곡 + testName 문자열 집계 취약. **정제 가능 구조 목표상 ChronicObservation 신설 권장.**

### 2.3 추이 API (정제 레이어)
```
GET /api/v1/patients/:id/chronic-observations?codes=FBS,HBA1C,SBP&from=&to=&limit=
→ { [code]: [{ value, unit, measuredAt, flag }] }  // 코드별 시계열(측정일 오름차순)
```
- codes·기간·limit 필터로 차트가 필요한 지표만 정제 조회. LabResult 기반 지표(HbA1c 등)도 동일 응답 형태로 합쳐 반환(통합 trend 서비스).

---

## 3. 시드 전략

### 3.1 당뇨 환자 선정 (~30%)
- 전체 환자 중 **30%(30명 기준 9명)** 를 당뇨로 지정.
  - `ProblemList`(E11, ACTIVE) + `EncounterDiagnosis`(E11) 부여(기존 2명 포함, 7명 추가).
  - 당뇨 유형 분포: 양호관리(HbA1c<7) / 경계(7~8) / 조절불량(>8) 3군으로 다양화.

### 3.2 측정 시계열 (각 5~30회)
- 환자별 **5~30회**(랜덤) 측정을 **과거 기간에 분산**(예: 최근 12~24개월, HbA1c는 ~3개월 간격, 혈당·혈압·체중은 더 잦게).
- 지표·간격:
  | 코드 | 지표 | 간격 | 정상범위 |
  |------|------|------|----------|
  | HBA1C | 당화혈색소 | ~3개월 | 4.0–6.5 % |
  | FBS | 공복혈당 | 외래마다/SMBG | 70–100 mg/dL |
  | PPG | 식후2h혈당 | 일부 | <140 mg/dL |
  | SBP/DBP | 혈압 | 외래마다 | <120/<80 |
  | WEIGHT/BMI | 체중/BMI | 외래마다 | BMI 18.5–23 |
- **추이 시뮬레이션**: 환자별 시나리오(개선↓ / 악화↑ / 등락) 적용해 값 생성 → 차트에서 의미 있는 변화가 보이도록. flag(H/L)는 정상범위로 자동 판정.

### 3.3 멱등·안전
- 시드 키: `chronic:<patientId>:<code>:<measuredAt>` 또는 결정적 id로 upsert(재실행 무해). 기존 seed 패턴 계승.
- 별도 시드 파일 `seed-diabetes-chronic.ts`(독립 실행), 운영 적용 시 db push 차단 → manual SQL/스크립트.

---

## 4. 차트(추이 확인) 설계
- `LabResultsTab` 또는 신규 **"만성질환 관리" 패널**:
  - **당뇨 관리 패널**: HbA1c·FBS·PPG·혈압·체중 시계열 라인(기존 TrendSparkline 확장 또는 recharts 도입 검토).
  - **목가상읍(target)**: 당뇨 관리 목표(HbA1c<7%, FBS<130) 가이드라인 라인 표시 + 정상범위 음영.
  - 기간 토글(3/6/12/24개월), 코드 멀티선택 — 추이 API 필터와 연동.
- 환자 차트 진입 시 **최근값 + Δ(직전 대비 변화)** 요약 카드(예: HbA1c 7.8→7.2 ↓).

---

## 5. 단계
| 단계 | 범위 |
|------|------|
| **P0** | (무스키마) LabResult 기반 HbA1c/혈당 시계열 시드(9명·5~30회) + LabResultsTab 당뇨 패널·목가상읍. 즉시 차트 확인 |
| **P1** | `ChronicObservation` 모델 + 추이 API(코드·기간 필터) + 혈압/체중/BMI·SMBG 시계열 시드 + 통합 추이 차트(목가상읍·기간토글·Δ요약) |
| **P2** | 자가측정(SMBG)·기기 연동(source=DEVICE), 만성질환 대시보드(고혈압·이상지질 확장), CDSS 경고 |

---

## 6. 결정 필요
1. **저장 모델**: LabResult만(무스키마, P0) vs ChronicObservation 신설(정제 최적, P1) — 권장: **P0 즉시 + P1 구조화 병행**.
2. 당뇨 환자 비율 30% 고정 vs 조정. 측정 횟수 5~30 범위 확정.
3. 차트: 기존 SVG sparkline 확장 vs **recharts 도입**(목가상읍·툴팁·기간토글에 유리).
4. 혈압/체중 추이 포함 범위(당뇨만 vs 만성질환 일반).

---

## 7. 리스크
- LabResult는 Order @unique 의존 → 시계열 시드 시 합성 Order 대량 생성(정합 주의). ChronicObservation은 이 부담 없음.
- testName 문자열 집계 취약 → 코드 정규화 필요(ChronicObservation의 code).
- PHI: 시드는 가상 환자만. 실데이터 혼입 금지.
