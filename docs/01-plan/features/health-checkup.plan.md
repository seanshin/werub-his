# 건강검진 시스템 기획서 v2.0

> 종합건강검진 프로그램 관리 — 예약·접수·검사패키지·결과통합·소견서 발급
> **HIS 내 독립 모듈 — 클리닉 센터 확장 패턴** 적용

---

## 1. 개요

### 1.1 목적
일반 외래 진료와 **분리된 워크플로우**를 가지는 건강검진 전용 모듈을 제공합니다.
검진 프로그램(패키지)을 정의하고, 수검자 예약→당일 접수→검사 진행→결과 통합→소견서 발급까지 **원스톱 관리**합니다.

### 1.2 설계 방향: 클리닉 센터 확장 패턴

건강검진은 **HIS 내 독립 모듈**로 구현합니다.
완전 분리(별도 서버/DB)는 하지 않지만, 모듈 내부는 **독립적으로 동작**하여
향후 다른 클리닉 센터(물리치료센터, 비만클리닉, 통증클리닉 등)도 같은 패턴으로 확장할 수 있도록 합니다.

```
┌──────────────── Hospital RUN (HIS) ─────────────────────────────────┐
│                                                                      │
│  ┌── Core ──────────────┐   ┌── Clinic Centers (독립 모듈) ───────┐ │
│  │                       │   │                                     │ │
│  │  Patient (환자 마스터) │   │  🏥 건강검진센터 ← 이번 구현        │ │
│  │  Encounter (진료)     │   │     CheckupProgram / Visit / Result │ │
│  │  Prescription (처방)  │   │                                     │ │
│  │  Order (오더)         │   │  🦴 (향후) 물리치료센터              │ │
│  │  Lab / Imaging        │   │  🏋️ (향후) 비만클리닉               │ │
│  │  Billing (수납)       │   │  💉 (향후) 통증클리닉               │ │
│  │  Auth (인증)          │   │  🧬 (향후) 유전체클리닉             │ │
│  │                       │   │                                     │ │
│  │  ★ 공유 인프라        │   │  ★ 각 센터는 독립 테이블 + API      │ │
│  │    DB, Redis, JWT     │   │    but HIS Core를 Adapter로 참조    │ │
│  └───────────────────────┘   └─────────────────────────────────────┘ │
│                                                                      │
│  apps/api  (port 4000) — 단일 서버, /api/v1/checkup/* 라우트         │
│  apps/web  (port 3000) — 단일 앱, /checkup/* 페이지                  │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.3 독립 모듈 설계 원칙

| 원칙 | 설명 | 이유 |
|------|------|------|
| **자체 테이블** | `ck_` prefix 전용 테이블 | HIS Core 테이블과 분리, 향후 센터별 prefix 패턴 (`pt_`, `ob_` 등) |
| **Adapter 접근** | HIS 기능은 `ClinicAdapter` 인터페이스 통해 접근 | 모듈 간 직접 import 금지 → 느슨한 결합 |
| **독립 API** | `/api/v1/checkup/*` 독자 라우트 | 다른 HIS 모듈 API에 영향 없음 |
| **독립 페이지** | `/checkup/*` 전용 라우트 그룹 | 사이드바에서 독립 섹션으로 표시 |
| **공유 인프라** | DB/Redis/JWT/Nginx는 HIS와 공유 | 별도 서버 불필요, 운영 단순 |
| **공유 환자** | Patient는 HIS Core가 원본, FK 참조 | 환자 마스터 중복 없음 |

### 1.4 ClinicAdapter — HIS Core 접근 인터페이스

건강검진(및 향후 다른 센터)이 HIS Core 기능을 사용할 때의 표준 인터페이스:

```typescript
// packages/shared/src/clinic-adapter.interface.ts
// 모든 클리닉 센터가 공유하는 HIS 접근 인터페이스

interface ClinicAdapter {
  // ── 환자 ──
  getPatient(patientId: string): Promise<PatientInfo>;
  searchPatients(query: string, limit?: number): Promise<PatientInfo[]>;

  // ── 검사 오더 생성 (센터 → HIS Core) ──
  createEncounter(patientId: string, visitType: string): Promise<{ encounterId: string }>;
  createLabOrder(params: LabOrderParams): Promise<{ orderId: string }>;
  createImagingOrder(params: ImagingOrderParams): Promise<{ orderId: string }>;
  createDiagnosticTest(params: DiagTestParams): Promise<{ testId: string }>;

  // ── 결과 조회 ──
  getLabResults(orderId: string): Promise<LabResultItem[]>;
  getImagingResult(orderId: string): Promise<ImagingResult>;
  getDiagnosticResult(testId: string): Promise<DiagTestResult>;

  // ── 예약 ──
  createAppointment(params: AppointmentParams): Promise<{ appointmentId: string }>;

  // ── 의뢰 ──
  createReferral(params: ReferralParams): Promise<{ referralId: string }>;

  // ── 수납 ──
  createBilling(params: BillingParams): Promise<{ billingId: string }>;
}

// 구현체: 같은 프로세스 내 직접 서비스 호출 (완전 분리 아님)
@Injectable()
class PrismaClinicAdapter implements ClinicAdapter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderService: OrderService,  // HIS Core 서비스 DI
  ) {}

  async createLabOrder(params: LabOrderParams) {
    // HIS Core OrderService를 직접 호출 (같은 NestJS 프로세스)
    const prescription = await this.prisma.prescription.create({ ... });
    return { orderId: prescription.id };
  }
}
```

**핵심**: 완전 분리(REST)가 아닌 **같은 프로세스 내 서비스 DI** — 성능 오버헤드 없음.
단, 인터페이스를 통하므로 향후 분리가 필요하면 구현체만 REST 버전으로 교체 가능.

### 1.5 향후 클리닉 센터 확장 예시

같은 패턴으로 새 센터 추가 시:

```
새 센터: 물리치료센터
  - 테이블: pt_programs, pt_sessions, pt_evaluations (prefix: pt_)
  - API: /api/v1/physio/*
  - 페이지: /physio/*
  - Adapter: 같은 ClinicAdapter 재사용
  - 사이드바: 클리닉 센터 섹션에 추가
```

```
사이드바 구조:
  임상
  ├─ 진료실, 검사실, 영상실...
  │
  클리닉 센터           ← 독립 섹션
  ├─ 🏥 건강검진센터
  ├─ 🦴 물리치료센터 (향후)
  ├─ 🏋️ 비만클리닉 (향후)
  └─ 💉 통증클리닉 (향후)
```

### 1.6 핵심 차별점 (외래 vs 건강검진)

| 구분 | 외래 진료 | 건강검진 |
|------|----------|---------|
| 진입 | 증상 호소 → 진료 | 프로그램 선택 → 예약 |
| 처방 | 의사가 개별 처방 | **패키지에 정의된 검사 일괄 오더** |
| 수검 흐름 | 진료실 → 검사 | **검사 순서표 따라 동선 이동** |
| 결과 | 의사 확인 후 설명 | **자동 집계 → 종합소견서 발급** |
| 수납 | 행위별 수가 | **패키지 정가 (할인 포함)** |
| 소견서 | 없음 | **종합건강검진 결과 보고서** |
| 모듈 | HIS Core | **클리닉 센터 독립 모듈** |

---

## 2. 검진 프로그램 (패키지) 관리

### 2.1 프로그램 구조

```
CheckupProgram
├─ id, code, name, description
├─ category: BASIC | PLUS | PRECISION | PREMIUM | PET_PRECISION | SPECIAL
├─ gender: ALL | MALE | FEMALE
├─ ageRange: { min: 20, max: 80 }
├─ price: 380000   (정가)
├─ discountRate: 10 (단체 등)
├─ duration: 120    (예상 소요시간, 분)
├─ isActive: true
│
├─ items: CheckupProgramItem[]
│  (아래 2.3 표준 검사 항목 참조)
│
└─ options: CheckupOption[]  (선택 추가 항목)
   (아래 2.4 선택 추가 항목 참조)
```

### 2.2 프로그램 라인업

> 참고: 한국건강관리협회(KAHP) 메디체크 기준 + 확장

| 코드 | 프로그램 | 대상 | 가격대 | 소요 | 설명 |
|------|---------|------|--------|------|------|
| CK-BASIC | 기본 종합검진 | 전체 | 남 38만 / 여 43만 | 120분 | 기초검사+혈액+소변+대변+영상+심전도+위장+초음파 |
| CK-PLUS | 플러스 종합검진 | 전체 | 50만대 | 150분 | 기본 + AI평가 + 안과 + 동맥경화 + 호흡기능 |
| CK-PRECISION | 정밀 종합검진 | 전체 | 70만대 | 180분 | 플러스 + 심혈관 + A/B형간염 + 추가 종양표지자 |
| CK-PREMIUM | 프리미엄 종합검진 | 전체 | 120만+ | 240분 | 정밀 + NGS암유전패널 + 심장초음파 + 경동맥초음파 + CT/MRI 선택 |
| CK-PET | PET-CT 정밀종합 | 전체 | 180만+ | 300분 | 프리미엄 + PET-CT 전신 |
| CK-FEMALE | 여성 특화 | 여성 | 50만대 | 150분 | 기본 + 유방촬영 + 자궁경부세포 + 골밀도 + 유방초음파 |
| CK-MALE40 | 40대+ 남성 | 남 40+ | 55만대 | 150분 | 기본 + PSA + 전립선초음파 + 심장CT |

### 2.3 표준 검사 항목 (기본 종합검진 기준)

> 한국건강관리협회 메디체크 기본 종합검진 항목 기반

| seq | 분류 | 검사 영역 | 세부 항목 | category |
|-----|------|----------|----------|----------|
| 1 | **기초검사** | 신체계측 | 신장, 체중, 허리둘레, 체질량지수(BMI), 혈압, 시력, 청력 | PHYSICAL |
| 2 | **체성분** | 체성분/스트레스 | 체성분 분석, 스트레스 검사, 대사생체나이 | PHYSICAL |
| 3 | **심혈관** | 심전도 | 심근경색, 부정맥, 심비대 등 | DIAGNOSTIC |
| 4 | **뇨검사** | 소변검사 (17항목) | 백혈구, pH, 단백, 포도당, 케톤체, 잠혈, 빌리루빈, 유로빌리노겐, 아질산염, 비중, 적혈구, 상피세포, 세균, 원주, 결정체 등 | LAB |
| 5 | **변검사** | 대변검사 | 분변잠혈(정량), 기생충검사 | LAB |
| 6 | **혈액** | 혈액질환검사 (18종) | 헤마토크리트, 혈색소, 백혈구수, 적혈구수, 혈소판, MCV, MCH, MCHC, RDW, WBC differential (호중구/림프구/단핵구/호산구/호염기구), ESR, 혈액형(ABO/Rh) | LAB |
| 7 | **혈액** | 간기능검사 | AST, ALT, γ-GTP, ALP, 총빌리루빈, 직접빌리루빈, 총단백, 알부민, 글로불린, A/G비 | LAB |
| 8 | **혈액** | 당뇨검사 | 공복혈당(FBS), 당화혈색소(HbA1c) | LAB |
| 9 | **혈액** | 고지혈증검사 | 총콜레스테롤, 중성지방(TG), HDL-C, LDL-C | LAB |
| 10 | **혈액** | 신장기능검사 | BUN(요소질소), Creatinine, eGFR | LAB |
| 11 | **혈액** | 간섬유화검사 | FIB-4 index | LAB |
| 12 | **혈액** | 통풍검사 | Uric acid(요산) | LAB |
| 13 | **혈액** | 심혈관위험인자 | hs-CRP | LAB |
| 14 | **혈액** | C형간염검사 | HCV Ab(EIA) | LAB |
| 15 | **혈액** | 종양표지자 | AFP(간암), CA19-9(췌장암), PSA(전립선암, 남성) | LAB |
| 16 | **혈액** | 갑상선기능검사 | TSH, Free T4, T3 | LAB |
| 17 | **영상** | 흉부 X-ray | 폐, 기관지, 심장, 늑골, 횡경막 | IMAGING |
| 18 | **영상** | 위장검사 | 위장조영촬영 또는 일반위내시경 (택 1) | DIAGNOSTIC |
| 19 | **영상** | 상복부 초음파 | 간, 신장, 비장, 췌장, 담낭 | IMAGING |
| 20 | **영상** | 갑상선 초음파 | 갑상선암, 갑상선비대증 | IMAGING |
| 21 | **부인과** | 자궁경부세포검사 (여) | 자궁경부암 조기발견 | DIAGNOSTIC |
| 22 | **부인과** | 유방촬영 (여) | 유방암 조기발견 (Mammography) | IMAGING |
| 23 | **상담** | 결과상담 | 의사 종합소견 + 건강상담 | CONSULT |

### 2.4 상위 프로그램 추가 항목

| 항목 | 플러스 | 정밀 | 프리미엄 | PET정밀 | category |
|------|:------:|:----:|:--------:|:-------:|----------|
| AI 건강평가 | ● | ● | ● | ● | AI |
| 안과검사 (안압, 안저) | ● | ● | ● | ● | DIAGNOSTIC |
| 동맥경화검사 (ABI/PWV) | ● | ● | ● | ● | DIAGNOSTIC |
| 호흡기능검사 (PFT) | ● | ● | ● | ● | DIAGNOSTIC |
| 심혈관검사 (BNP, Homocysteine) | | ● | ● | ● | LAB |
| A형간염 (HAV Ab) | | ● | ● | ● | LAB |
| B형간염 (HBsAg, HBsAb) | | ● | ● | ● | LAB |
| 추가 종양표지자 (CEA, CA125여) | | ● | ● | ● | LAB |
| NGS 암유전 패널 | | | ● | ● | LAB |
| 심장초음파 | | | ● | ● | DIAGNOSTIC |
| 경동맥초음파 | | | ● | ● | IMAGING |
| CT 선택 (두부/요추/경추/흉부) | | | ● | ● | IMAGING |
| 뇌 MRI + MRA | | | ● | ● | IMAGING |
| 척추 MRI | | | ● | ● | IMAGING |
| PET-CT (전신) | | | | ● | IMAGING |

### 2.5 선택 추가 항목 (옵션)

| 항목 | 추가 가격 | 설명 | category |
|------|----------|------|----------|
| 대장내시경 | 8만원 | 용종 제거 포함 시 별도 | DIAGNOSTIC |
| 수면 위내시경 | 5만원 | 수면 마취 추가 | DIAGNOSTIC |
| 수면 대장내시경 | 5만원 | 수면 마취 추가 | DIAGNOSTIC |
| 뇌 MRI + MRA | 35만원 | 뇌혈관 정밀 | IMAGING |
| 심장 CT (관상동맥) | 20만원 | 관상동맥 석회화 | IMAGING |
| 저선량 흉부 CT | 10만원 | 폐암 조기발견 | IMAGING |
| 복부/골반 CT | 15만원 | 복부 장기 정밀 | IMAGING |
| 유방초음파 (여) | 8만원 | 유방 정밀 | IMAGING |
| 전립선초음파 (남) | 8만원 | 전립선 정밀 | IMAGING |
| 골밀도검사 (BMD) | 5만원 | 골다공증 (DEXA) | DIAGNOSTIC |
| HPV 검사 (여) | 5만원 | 인유두종바이러스 | LAB |
| 알레르기검사 (MAST) | 10만원 | 다항목 알레르기 | LAB |
| 비타민D | 3만원 | 25(OH)Vitamin D | LAB |
| 류마티스인자 (RF) | 2만원 | 류마티스 관절염 | LAB |
| 헬리코박터 검사 | 3만원 | 요소호기검사(UBT) | LAB |

---

## 3. 검진 워크플로우

### 3.1 전체 흐름

```
[1] 프로그램 선택·예약
    ↓
[2] 당일 접수 (수납)
    ↓
[3] 검사 순서표 발급 (동선 안내)
    ↓
[4] 검사 진행 (Lab→Imaging→Diagnostic→신체계측)
    ↓
[5] 결과 자동 집계 (정상/이상 판정)
    ↓
[6] 의사 종합소견 작성
    ↓
[7] 결과 보고서 발급 (PDF)
    ↓
[8] 수검자 포털 결과 조회
```

### 3.2 상태 머신 (CheckupVisit)

```
RESERVED → CHECKED_IN → IN_PROGRESS → EXAM_COMPLETE → REVIEW → COMPLETED → DELIVERED
                                                        ↑
                                                   의사 소견 작성
```

| 상태 | 설명 | 트리거 |
|------|------|--------|
| RESERVED | 예약 완료 | 예약 생성 |
| CHECKED_IN | 당일 접수 + 수납 | 접수 처리 |
| IN_PROGRESS | 검사 진행 중 | 첫 검사 시작 |
| EXAM_COMPLETE | 모든 검사 완료 | 마지막 검사 완료 |
| REVIEW | 의사 소견 작성 중 | 의사 검토 시작 |
| COMPLETED | 소견서 서명 완료 | 의사 서명 |
| DELIVERED | 결과 전달 완료 | 수검자 수령/포털 확인 |

### 3.3 검사 순서표 (동선 안내)

접수 시 자동 생성되는 검사 순서표:

```
┌─ 건강검진 순서표 ─────────────────────────────┐
│ 수검자: 홍길동 (M, 45세)                       │
│ 프로그램: CK-STANDARD (표준 검진)               │
│ 날짜: 2026-05-21                               │
│                                                │
│  순서  │  검사          │  장소      │  상태    │
│ ──────┼───────────────┼──────────┼──────── │
│  ①    │  신체계측      │  2층 201호 │  ☐ 대기  │
│  ②    │  채혈          │  2층 203호 │  ☐ 대기  │
│  ③    │  소변검사      │  2층 화장실│  ☐ 대기  │
│  ④    │  흉부 X-ray    │  1층 영상실│  ☐ 대기  │
│  ⑤    │  심전도        │  3층 301호 │  ☐ 대기  │
│  ⑥    │  복부초음파    │  3층 302호 │  ☐ 대기  │
│  ⑦    │  위내시경      │  4층 내시경│  ☐ 대기  │
│  ⑧    │  결과상담      │  5층 503호 │  ☐ 대기  │
│                                                │
│  * 금식 검사(채혈, 내시경)를 먼저 진행합니다     │
└────────────────────────────────────────────────┘
```

---

## 4. 결과 통합 + 판정

### 4.1 결과 자동 집계

각 검사 완료 시 `CheckupResultItem`에 자동 기록:

```
CheckupResultItem
├─ visitId: CheckupVisit
├─ category: LAB | IMAGING | DIAGNOSTIC | PHYSICAL
├─ testName: 'CBC - WBC'
├─ value: '7200'
├─ unit: '/μL'
├─ referenceRange: '4000-10000'
├─ finding: 'NORMAL'  // NORMAL | ABNORMAL | CRITICAL | PENDING
├─ sourceId: LabResultItem.id | ImagingResult.id | DiagnosticTest.id
└─ note: null
```

### 4.2 자동 판정 로직

| 판정 | 조건 | 색상 |
|------|------|------|
| 정상 (A) | 모든 항목 정상 범위 내 | 🟢 |
| 경미한 이상 (B) | 경미한 이탈 (5% 이내) | 🟡 |
| 요관찰 (C1) | 이상 소견, 추적 관찰 필요 | 🟠 |
| 요치료 (C2) | 이상 소견, 치료 필요 | 🔴 |
| 정밀검사 (D1) | 추가 정밀검사 필요 | 🔴 |
| 치료중 (D2) | 이미 치료 진행 중 | 🔵 |

### 4.3 영역별 판정 집계

```
CheckupSummary
├─ visitId
├─ overallGrade: 'C1'  // 최종 등급 (가장 심한 것)
│
├─ sections[]
│  ├─ { area: '혈액검사', grade: 'A', findings: '정상' }
│  ├─ { area: '간기능', grade: 'B', findings: 'AST 약간 상승 (42 U/L)' }
│  ├─ { area: '지질대사', grade: 'C1', findings: 'LDL 150mg/dL — 식이요법 권고' }
│  ├─ { area: '신기능', grade: 'A', findings: '정상' }
│  ├─ { area: '흉부영상', grade: 'A', findings: '이상 없음' }
│  ├─ { area: '심전도', grade: 'A', findings: '정상 동율동' }
│  ├─ { area: '복부초음파', grade: 'B', findings: '경도 지방간' }
│  └─ { area: '위내시경', grade: 'C1', findings: '표재성 위염 — 6개월 후 추적' }
│
├─ doctorOpinion: '경도 지방간과 LDL 상승 소견으로...'
├─ recommendations: ['식이요법', '운동', '6개월 후 재검']
├─ reviewedBy: doctorId
└─ signedAt: DateTime
```

---

## 5. 종합소견서 (PDF)

### 5.1 보고서 구조

```
┌─ 종합건강검진 결과 보고서 ────────────────────────────────┐
│                                                           │
│  Hospital RUN 종합건강검진센터                              │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━           │
│                                                           │
│  수검자: 홍길동 (남, 45세)     검진일: 2026-05-21          │
│  프로그램: CK-STANDARD         판정: C1 (요관찰)           │
│                                                           │
│  ■ 종합 판정                                               │
│  ┌─────────┬──────┬───────────────────────────────────┐   │
│  │  영역    │ 판정 │ 소견                              │   │
│  ├─────────┼──────┼───────────────────────────────────┤   │
│  │ 혈액검사 │  A   │ 정상                              │   │
│  │ 간기능   │  B   │ AST 약간 상승 (42, 참고값 ~40)    │   │
│  │ 지질대사 │  C1  │ LDL 150 — 식이요법·운동 권고      │   │
│  │ 신기능   │  A   │ 정상                              │   │
│  │ 흉부영상 │  A   │ 이상 없음                          │   │
│  │ 심전도   │  A   │ 정상 동율동                        │   │
│  │ 복부초음파│  B   │ 경도 지방간                        │   │
│  │ 위내시경 │  C1  │ 표재성 위염 — 6개월 후 추적        │   │
│  └─────────┴──────┴───────────────────────────────────┘   │
│                                                           │
│  ■ 상세 검사 결과                                          │
│  (혈액, 소변, 영상, 기능 검사 수치 테이블)                  │
│                                                           │
│  ■ 의사 종합소견                                           │
│  경도 지방간과 LDL 콜레스테롤 상승 소견입니다.              │
│  식이요법과 규칙적 운동을 권고드리며, 6개월 후               │
│  위내시경 추적검사를 받으시기 바랍니다.                      │
│                                                           │
│  ■ 추천 사항                                               │
│  • 식이요법 (저지방, 고섬유질)                              │
│  • 주 3회 이상 유산소 운동 (30분+)                          │
│  • 6개월 후 위내시경 추적검사                               │
│  • 1년 후 건강검진 재검                                    │
│                                                           │
│  검진의: 김내과     서명: ________________                 │
│  발급일: 2026-05-25                                        │
└───────────────────────────────────────────────────────────┘
```

---

## 6. 데이터 모델

### 6.1 Prisma Schema

```prisma
// ── 검진 프로그램 ──

model CheckupProgram {
  id            String   @id @default(uuid()) @db.Uuid
  code          String   @unique @db.VarChar(20)     // CK-BASIC
  name          String   @db.VarChar(200)             // 기본 검진
  category      String   @db.VarChar(20)              // BASIC, STANDARD, PREMIUM, VIP, SPECIAL
  description   String?  @db.Text
  gender        String   @default("ALL") @db.VarChar(10) // ALL, MALE, FEMALE
  ageMin        Int?     @map("age_min")
  ageMax        Int?     @map("age_max")
  price         Int                                   // 정가 (원)
  discountRate  Int      @default(0) @map("discount_rate") // %
  duration      Int      @default(120)                // 예상 소요(분)
  items         Json     @db.JsonB                    // CheckupProgramItem[]
  options       Json?    @db.JsonB                    // 선택 추가 항목
  isActive      Boolean  @default(true) @map("is_active")
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  visits CheckupVisit[]

  @@map("checkup_programs")
}

// ── 검진 방문 ──

model CheckupVisit {
  id            String   @id @default(uuid()) @db.Uuid
  patientId     String   @map("patient_id") @db.Uuid
  programId     String   @map("program_id") @db.Uuid
  scheduledDate DateTime @map("scheduled_date") @db.Date
  status        String   @default("RESERVED") @db.VarChar(20)
  // RESERVED → CHECKED_IN → IN_PROGRESS → EXAM_COMPLETE → REVIEW → COMPLETED → DELIVERED
  selectedOptions Json?  @map("selected_options") @db.JsonB  // 추가 선택 항목
  totalPrice    Int      @map("total_price")                  // 최종 결제 금액
  checkedInAt   DateTime? @map("checked_in_at") @db.Timestamptz()
  completedAt   DateTime? @map("completed_at") @db.Timestamptz()
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  patient  Patient        @relation(fields: [patientId], references: [id])
  program  CheckupProgram @relation(fields: [programId], references: [id])
  items    CheckupResultItem[]
  summary  CheckupSummary?

  @@index([patientId])
  @@index([scheduledDate])
  @@index([status])
  // 문진표 연결
  questionnaireId  String?  @map("questionnaire_id") @db.Uuid
  // 국가건강검진
  isNhiScreening   Boolean  @default(false) @map("is_nhi_screening")
  nhiScreeningCode String?  @map("nhi_screening_code") @db.VarChar(10)
  // 단체 계약
  contractId       String?  @map("contract_id") @db.Uuid

  @@map("checkup_visits")
}

// ── 개별 검사 결과 ──

model CheckupResultItem {
  id             String   @id @default(uuid()) @db.Uuid
  visitId        String   @map("visit_id") @db.Uuid
  category       String   @db.VarChar(20)  // LAB, IMAGING, DIAGNOSTIC, PHYSICAL
  testName       String   @map("test_name") @db.VarChar(200)
  value          String?  @db.VarChar(200)
  unit           String?  @db.VarChar(50)
  referenceRange String?  @map("reference_range") @db.VarChar(100)
  finding        String   @default("PENDING") @db.VarChar(20) // NORMAL, ABNORMAL, CRITICAL, PENDING
  sourceType     String?  @map("source_type") @db.VarChar(30) // LAB_RESULT, IMAGING_RESULT, DIAGNOSTIC_TEST
  sourceId       String?  @map("source_id") @db.Uuid
  note           String?  @db.Text
  completedAt    DateTime? @map("completed_at") @db.Timestamptz()
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz()

  visit CheckupVisit @relation(fields: [visitId], references: [id])

  @@index([visitId])
  @@map("checkup_result_items")
}

// ── 종합 소견 ──

model CheckupSummary {
  id              String   @id @default(uuid()) @db.Uuid
  visitId         String   @unique @map("visit_id") @db.Uuid
  overallGrade    String   @map("overall_grade") @db.VarChar(5) // A, B, C1, C2, D1, D2
  sections        Json     @db.JsonB  // { area, grade, findings }[]
  doctorOpinion   String?  @map("doctor_opinion") @db.Text
  recommendations Json?    @db.JsonB  // string[]
  reviewedBy      String?  @map("reviewed_by") @db.Uuid
  signedAt        DateTime? @map("signed_at") @db.Timestamptz()
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  visit  CheckupVisit @relation(fields: [visitId], references: [id])
  doctor User?        @relation("CheckupReviewer", fields: [reviewedBy], references: [id])

  @@map("checkup_summaries")
}
```

---

## 7. API 설계

### 7.1 프로그램 관리 (관리자)

```
GET    /api/v1/checkup/programs                 — 프로그램 목록
POST   /api/v1/checkup/programs                 — 프로그램 생성
GET    /api/v1/checkup/programs/:id             — 프로그램 상세
PUT    /api/v1/checkup/programs/:id             — 프로그램 수정
DELETE /api/v1/checkup/programs/:id             — 프로그램 비활성화
```

### 7.2 검진 예약·접수

```
POST   /api/v1/checkup/visits                   — 검진 예약
GET    /api/v1/checkup/visits                   — 예약 목록 (날짜/상태 필터)
GET    /api/v1/checkup/visits/:id               — 예약 상세
PATCH  /api/v1/checkup/visits/:id/check-in      — 당일 접수 (→ CHECKED_IN)
PATCH  /api/v1/checkup/visits/:id/status        — 상태 변경
GET    /api/v1/checkup/visits/:id/route-sheet    — 검사 순서표 조회
```

### 7.3 결과·소견

```
GET    /api/v1/checkup/visits/:id/results       — 개별 결과 목록
POST   /api/v1/checkup/visits/:id/results       — 결과 수동 입력 (신체계측 등)
PATCH  /api/v1/checkup/visits/:id/auto-collect   — 기존 검사결과 자동 수집
GET    /api/v1/checkup/visits/:id/summary       — 종합소견 조회
POST   /api/v1/checkup/visits/:id/summary       — 종합소견 작성
PATCH  /api/v1/checkup/visits/:id/sign          — 의사 서명 (→ COMPLETED)
GET    /api/v1/checkup/visits/:id/report-pdf    — 소견서 PDF 다운로드
```

### 7.4 판독 요청

```
GET    /api/v1/checkup/interpretations          — 판독 대기열 (department 필터)
POST   /api/v1/checkup/interpretations/:id/complete — 판독 소견 입력
```

### 7.5 외래 의뢰

```
POST   /api/v1/checkup/visits/:id/referrals     — 외래 의뢰 생성 (예약 동시 생성)
GET    /api/v1/checkup/visits/:id/referrals     — 의뢰 목록
```

### 7.6 추적 관리

```
GET    /api/v1/checkup/follow-ups               — 추적 대상 목록 (dueDate 필터)
PATCH  /api/v1/checkup/follow-ups/:id/complete  — 추적 완료 처리
```

### 7.7 단체 검진

```
POST   /api/v1/checkup/contracts                — 단체 계약 등록
GET    /api/v1/checkup/contracts                — 계약 목록
GET    /api/v1/checkup/contracts/:id            — 계약 상세 + 수검자 현황
POST   /api/v1/checkup/contracts/:id/bulk-reserve — 일괄 예약 (CSV)
```

### 7.8 통계 (관리자)

```
GET    /api/v1/checkup/stats                    — 검진 통계 (기간별, 프로그램별)
GET    /api/v1/checkup/stats/abnormal           — 이상소견 통계
GET    /api/v1/checkup/stats/contracts          — 단체 검진 현황
```

---

## 8. 프론트엔드 페이지

### 8.1 페이지 구조

| 경로 | 역할 | 접근 |
|------|------|------|
| `/checkup` | 검진센터 메인 (오늘 일정, 진행현황 대시보드) | 의사, 간호사, 관리자 |
| `/checkup/programs` | 프로그램 관리 (CRUD) | 관리자 |
| `/checkup/schedule` | 예약 캘린더 + 예약 생성 | 접수, 간호사, 관리자 |
| `/checkup/visit/:id` | 개별 수검자 상세 (진행상황, 결과, 소견) | 의사, 간호사 |
| `/checkup/review` | 의사 검토 대기열 (소견 작성) | 의사 |

### 8.2 메인 대시보드 (`/checkup`)

```
┌─ 건강검진센터 ──────────────────────────────────────────────┐
│                                                             │
│  📊 오늘 현황                                                │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐    │
│  │ 예약 12│ │ 접수 8 │ │ 진행 5 │ │ 완료 3 │ │ 소견 2 │    │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘    │
│                                                             │
│  [예약 목록]  [진행 현황]  [소견 대기]  [완료]                │
│                                                             │
│  ┌─────┬────────┬──────────┬────────┬──────┬──────┬──────┐ │
│  │시간 │ 수검자  │ 프로그램  │ 진행률  │ 상태 │ 의사 │ 관리 │ │
│  ├─────┼────────┼──────────┼────────┼──────┼──────┼──────┤ │
│  │08:00│홍길동45M│표준 검진  │ █████░ │진행중│김내과│[상세]│ │
│  │08:30│이영희38F│여성 특화  │ ███░░░ │진행중│박산부│[상세]│ │
│  │09:00│박철수52M│프리미엄   │ ░░░░░░ │접수  │ -   │[상세]│ │
│  │09:30│최수진29F│기본 검진  │ ░░░░░░ │예약  │ -   │[접수]│ │
│  └─────┴────────┴──────────┴────────┴──────┴──────┴──────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 8.3 수검자 상세 (`/checkup/visit/:id`)

```
┌─ 홍길동 (남, 45세) — 표준 검진 ─────────────────────────────┐
│                                                              │
│  [검사 순서] [결과 현황] [종합소견] [보고서]                   │
│                                                              │
│  ■ 검사 순서 + 진행상황                                       │
│  ┌─┬──────────┬──────────┬──────┬──────────────────────────┐ │
│  │①│ 신체계측  │ 2층 201호│ ✅   │ H:175 W:78 BMI:25.5 BP:│ │
│  │②│ 채혈      │ 2층 203호│ ✅   │ CBC, BMP, LFT... 완료   │ │
│  │③│ 소변검사  │ 2층 화장실│ ✅   │ 정상                    │ │
│  │④│ 흉부X-ray │ 1층 영상실│ ✅   │ 이상 없음               │ │
│  │⑤│ 심전도    │ 3층 301호│ ✅   │ 정상 동율동              │ │
│  │⑥│ 복부초음파│ 3층 302호│ 🔄   │ 진행 중                 │ │
│  │⑦│ 위내시경  │ 4층 내시경│ ⏳   │ 대기                    │ │
│  │⑧│ 결과상담  │ 5층 503호│ ⏳   │ 대기                    │ │
│  └─┴──────────┴──────────┴──────┴──────────────────────────┘ │
│                                                              │
│  진행률: ██████████░░░░ 62% (5/8 완료)                       │
└──────────────────────────────────────────────────────────────┘
```

---

## 9. 과별 차트 연동 + 외래 연계

### 9.1 문제 정의

건강검진은 여러 진료과의 검사를 **한꺼번에 수행**하므로 아래 연동이 필수:

| 시나리오 | 설명 | 예시 |
|---------|------|------|
| **검진 → 외래 의뢰** | 이상 발견 시 해당 과 외래 예약 | 위내시경 용종 → 소화기내과 의뢰 |
| **과별 전문 소견** | 특정 검사는 전문과 의사가 판독 | 심장초음파 → 순환기내과, 유방촬영 → 영상의학과 |
| **환자 차트 통합** | 외래 의사가 검진 결과를 차트에서 조회 | 내과 외래에서 과거 검진 혈액결과 확인 |
| **검진 시 기존 이력 참조** | 검진의가 기존 진료 이력 참조 | 고혈압 치료 중인 환자의 약물·검사 이력 |
| **추적 검사 연계** | 검진 권고에 따른 재검 예약 | "6개월 후 위내시경" → 일정 자동 등록 |

### 9.2 해소 방안

#### A. 환자 차트에 "검진 이력" 탭 추가

기존 환자 상세 페이지(`/patients/[id]`)에 **검진 이력 탭** 추가:

```typescript
// 환자 차트 BASE_TABS에 추가
{ key: 'checkup', label: '검진 이력' }
```

```
┌─ 환자 차트 — 홍길동 ────────────────────────────────────────────┐
│ [개요] [문제목록] [검사결과] [영상] ... [검진 이력] [내과] ...    │
├──────────────────────────────────────────────────────────────── │
│ ■ 검진 이력 탭                                                   │
│                                                                  │
│ ┌──────────┬────────────┬────────┬──────┬──────────────────────┐│
│ │ 검진일    │ 프로그램    │ 등급    │ 의사 │ 주요 소견            ││
│ ├──────────┼────────────┼────────┼──────┼──────────────────────┤│
│ │2026-05-21│ 표준 검진   │ C1     │김내과│ 지방간, LDL↑, 위염   ││
│ │2025-05-15│ 기본 검진   │ B      │김내과│ 지방간               ││
│ │2024-05-10│ 기본 검진   │ A      │이내과│ 정상                 ││
│ └──────────┴────────────┴────────┴──────┴──────────────────────┘│
│                                                                  │
│ [2026-05-21 펼침]                                                │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ 영역별 판정: 혈액A 간기능B 지질C1 신기능A 흉부A 심전도A     │  │
│ │              복부초음파B 위내시경C1                          │  │
│ │ 이상 소견: LDL 150↑ / 경도 지방간 / 표재성 위염             │  │
│ │ 권고: 식이요법, 운동, 6개월 후 위내시경                      │  │
│ │                                  [소견서 PDF] [외래 의뢰]    │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ 📈 연도별 추이 (최근 3년)                                        │
│ ┌──────────┬────────┬────────┬────────┐                         │
│ │ 항목      │ 2024   │ 2025   │ 2026   │                         │
│ ├──────────┼────────┼────────┼────────┤                         │
│ │ LDL-C    │ 120    │ 135    │ 150 ↑  │                         │
│ │ HbA1c    │ 5.4    │ 5.6    │ 5.8    │                         │
│ │ AST      │ 28     │ 35     │ 42 ↑   │                         │
│ │ BMI      │ 24.1   │ 24.8   │ 25.5 ↑ │                         │
│ └──────────┴────────┴────────┴────────┘                         │
└──────────────────────────────────────────────────────────────────┘
```

**API**: `GET /api/v1/checkup/visits?patientId={id}` — 해당 환자 검진 이력

#### B. 과별 전문 소견 워크플로우

검진 중 특정 검사는 **해당 과 전문의 판독**이 필요합니다:

```
┌─ 검사별 판독 담당과 매핑 ────────────────────────────────────┐
│                                                               │
│  검사 항목          │  판독 담당과      │  소견 입력 방식       │
│ ──────────────────┼─────────────────┼───────────────────── │
│  위/대장내시경      │  소화기내과       │  내시경 판독 소견     │
│  심장초음파         │  순환기내과       │  에코 리포트          │
│  복부초음파         │  영상의학과       │  초음파 판독 소견     │
│  유방촬영           │  영상의학과       │  BI-RADS 분류        │
│  흉부 X-ray        │  영상의학과       │  판독 소견            │
│  갑상선초음파       │  영상의학과       │  TI-RADS 분류        │
│  심전도 (EKG)      │  순환기내과       │  자동판독 + 확인     │
│  PFT               │  호흡기내과       │  폐기능 판독         │
│  안저/안압          │  안과             │  소견                │
│  골밀도 (BMD)       │  정형외과/내과    │  T-score 판독       │
│  뇌 MRI/MRA        │  신경과           │  영상 판독           │
│  PET-CT            │  핵의학과         │  판독 소견            │
│  자궁경부세포검사   │  산부인과         │  세포병리 결과       │
└───────────────────────────────────────────────────────────────┘
```

**구현 방식**:

```typescript
// CheckupProgramItem에 판독 담당과 추가
interface CheckupProgramItem {
  seq: number;
  category: 'LAB' | 'IMAGING' | 'DIAGNOSTIC' | 'PHYSICAL' | 'CONSULT';
  name: string;
  codes: string[];
  interpretDept?: string;     // 판독 담당 진료과
  interpretRole?: string;     // 'DOCTOR' | 'AUTO'
}

// 예시
{ seq: 6, category: 'IMAGING', name: '복부초음파', codes: ['ABD-US'],
  interpretDept: '영상의학과', interpretRole: 'DOCTOR' }
```

**판독 요청 모델**:

```prisma
model CheckupInterpretation {
  id             String   @id @default(uuid()) @db.Uuid
  visitId        String   @map("visit_id") @db.Uuid
  resultItemId   String   @map("result_item_id") @db.Uuid
  department     String   @db.VarChar(50)              // 판독 요청 과
  requestedAt    DateTime @default(now()) @map("requested_at") @db.Timestamptz()
  interpretedBy  String?  @map("interpreted_by") @db.Uuid
  interpretedAt  DateTime? @map("interpreted_at") @db.Timestamptz()
  finding        String?  @db.Text                     // 전문과 소견
  grade          String?  @db.VarChar(5)               // A/B/C1/C2/D1/D2
  recommendation String?  @db.Text                     // 과별 권고 사항
  status         String   @default("REQUESTED") @db.VarChar(20)
  // REQUESTED → IN_REVIEW → COMPLETED

  visit      CheckupVisit      @relation(fields: [visitId], references: [id])
  resultItem CheckupResultItem @relation(fields: [resultItemId], references: [id])
  doctor     User?             @relation("CheckupInterpreter", fields: [interpretedBy], references: [id])

  @@index([department, status])
  @@map("ck_interpretations")
}
```

**과별 판독 대기열**:

각 진료과 진료실 페이지에서 검진 판독 요청을 확인:

```
┌─ 소화기내과 진료실 ────────────────────────────────────────┐
│                                                            │
│  [대기 환자]  [진료 중]  [🔔 검진 판독 요청 (3)]            │
│                                                            │
│  ■ 검진 판독 대기                                           │
│  ┌──────────┬──────────┬──────────┬──────────┬──────┐     │
│  │ 수검자    │ 검사      │ 검진일    │ 요청시간  │ 관리 │     │
│  ├──────────┼──────────┼──────────┼──────────┼──────┤     │
│  │ 홍길동    │ 위내시경  │ 05-21    │ 10:30    │[판독]│     │
│  │ 이영희    │ 대장내시경│ 05-21    │ 11:15    │[판독]│     │
│  │ 박철수    │ 위내시경  │ 05-21    │ 13:00    │[판독]│     │
│  └──────────┴──────────┴──────────┴──────────┴──────┘     │
└────────────────────────────────────────────────────────────┘
```

#### C. 검진 → 외래 의뢰 연계

이상 발견 시 **원클릭 외래 의뢰** 기능:

```
┌─ 검진 소견서 작성 ───────────────────────────────────────┐
│                                                          │
│  ■ 위내시경: C1 (요관찰) — 표재성 위염, 용종 1개          │
│                                                          │
│  [외래 의뢰] 클릭 →                                       │
│  ┌──────────────────────────────────────────────────┐    │
│  │ 외래 의뢰 생성                                    │    │
│  │                                                    │    │
│  │ 의뢰 과: [소화기내과  ▾]                           │    │
│  │ 의뢰 사유: 검진 위내시경에서 용종 발견,              │    │
│  │           추가 조직검사 및 제거 필요                 │    │
│  │ 첨부: ☑ 검진 결과 자동 첨부                         │    │
│  │ 예약: [2026-06-05 ▾] [오전 ▾]                      │    │
│  │                                                    │    │
│  │                    [취소]  [의뢰 생성 + 예약]        │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

**데이터 모델**:

```prisma
model CheckupReferral {
  id             String   @id @default(uuid()) @db.Uuid
  visitId        String   @map("visit_id") @db.Uuid
  resultItemId   String?  @map("result_item_id") @db.Uuid  // 이상 소견 항목
  toDepartment   String   @map("to_department") @db.VarChar(50)
  reason         String   @db.Text
  urgency        String   @default("ROUTINE") @db.VarChar(20)  // ROUTINE, URGENT
  appointmentId  String?  @map("appointment_id") @db.Uuid      // 외래 예약 연결
  referralId     String?  @map("referral_id") @db.Uuid          // HIS Referral 연결
  status         String   @default("CREATED") @db.VarChar(20)
  // CREATED → APPOINTMENT_MADE → VISITED → CLOSED
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz()

  visit CheckupVisit @relation(fields: [visitId], references: [id])

  @@index([visitId])
  @@map("ck_referrals")
}
```

**구현 로직**:
1. 검진 소견에서 [외래 의뢰] 클릭
2. HIS Referral 생성 (기존 `POST /api/v1/referrals`)
3. 외래 예약 생성 (기존 `POST /api/v1/appointments`)
4. 검진 결과 요약을 의뢰 사유에 자동 첨부
5. CheckupReferral에 연결 기록

#### D. 외래에서 검진 결과 참조

외래 진료 시 해당 환자의 **최근 검진 결과를 자동 표시**:

```
┌─ 내과 진료실 — 홍길동 ───────────────────────────────────────┐
│                                                               │
│ [S] [O] [A] [P] [처방] [검사] [영상]                          │
│                                                               │
│ ┌─ 💡 최근 검진 결과 (2026-05-21) ──────────────────────────┐ │
│ │ 프로그램: 표준 검진 │ 등급: C1                             │ │
│ │ 주요 이상: LDL 150↑ / 경도 지방간 / 표재성 위염            │ │
│ │ 권고: 식이요법, 운동, 6개월 후 위내시경                     │ │
│ │                                          [상세보기] [닫기]  │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                               │
│ ■ 주관적 소견 (S)                                              │
│ 검진에서 콜레스테롤 높다고 해서 왔습니다...                     │
└───────────────────────────────────────────────────────────────┘
```

**구현 방식**:
- 진료 레이아웃(EncounterLayout) 상단에 **검진 알림 배너** 자동 표시
- 조건: 최근 6개월 이내 검진 결과 존재 + 등급 B 이상
- `GET /api/v1/checkup/visits?patientId={id}&recent=true`

#### E. 추적 검사 스케줄 연동

검진 권고사항에서 **추적 검사 자동 일정 등록**:

```
권고사항: "6개월 후 위내시경 추적검사"
    ↓
자동 생성:
  - 리마인더 알림 (5개월 후 SMS/포털 알림)
  - 검진 재예약 제안 (포털에서)
  - 외래 예약 후보일 제안
```

**데이터 모델**:

```prisma
model CheckupFollowUp {
  id             String   @id @default(uuid()) @db.Uuid
  visitId        String   @map("visit_id") @db.Uuid
  patientId      String   @map("patient_id") @db.Uuid
  followUpType   String   @map("follow_up_type") @db.VarChar(30)
  // RECHECK (재검) | OUTPATIENT (외래) | SCREENING (검진 재예약)
  description    String   @db.VarChar(500)              // "위내시경 추적검사"
  dueDate        DateTime @map("due_date") @db.Date     // 권고 시기
  reminderSent   Boolean  @default(false) @map("reminder_sent")
  completedAt    DateTime? @map("completed_at") @db.Timestamptz()
  linkedVisitId  String?  @map("linked_visit_id") @db.Uuid  // 다음 검진 연결
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz()

  visit   CheckupVisit @relation(fields: [visitId], references: [id])
  patient Patient      @relation(fields: [patientId], references: [id])

  @@index([patientId, dueDate])
  @@map("ck_follow_ups")
}
```

### 9.3 과별 차트 연동 요약

```
┌─────────────────────────────────────────────────────────────────┐
│                    과별 차트 연동 전체 흐름                       │
│                                                                  │
│  ┌─ 검진센터 ─┐    ┌─ 과별 판독 ─┐    ┌─ 환자 차트 ──┐         │
│  │ 검사 진행   │───►│ 판독 요청    │───►│ 판독 결과     │         │
│  │ 결과 집계   │    │ 소견 입력    │    │ 검진 이력 탭  │         │
│  │ 종합소견    │    │ 등급 판정    │    │ 연도별 추이   │         │
│  └─────────────┘    └──────────────┘    └──────────────┘         │
│        │                                       │                 │
│        ▼                                       ▼                 │
│  ┌─ 외래 의뢰 ─┐                       ┌─ 외래 진료실 ──┐       │
│  │ 이상→과 의뢰 │                       │ 검진결과 배너   │       │
│  │ 예약 자동    │──────────────────────►│ 의뢰 수신      │       │
│  │ 결과 첨부    │                       │ 치료 시작      │       │
│  └──────────────┘                       └────────────────┘       │
│        │                                       │                 │
│        ▼                                       ▼                 │
│  ┌─ 추적 관리 ─┐                       ┌─ 포털 ─────────┐       │
│  │ 재검 리마인더│                       │ 결과 조회       │       │
│  │ 다음 검진   │                       │ PDF 다운로드    │       │
│  │ 외래 예약   │                       │ 추적 일정 확인  │       │
│  └──────────────┘                       └────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 10. 수납·결제 흐름

### 10.1 검진 수납 vs 외래 수납

| 구분 | 외래 수납 | 검진 수납 |
|------|----------|----------|
| 금액 산정 | 행위별 수가 (FFS/DRG) | **패키지 정가** |
| 할인 | 없음 | 단체할인, 재검할인, 가족할인 |
| 수납 시점 | 진료 후 (후불) | **접수 시 선불** (당일 접수 = 수납) |
| 추가 옵션 | 없음 | 선택 추가 항목 (대장내시경 등) 별도 합산 |
| 영수증 | 진료비 영수증 | **검진 영수증** (패키지명 + 옵션 내역) |

### 10.2 금액 산정 로직

```typescript
// 접수 시 최종 금액 계산
function calculateTotal(program: CheckupProgram, selectedOptions: string[]): number {
  // 기본 가격
  let total = program.price;

  // 할인 적용
  if (program.discountRate > 0) {
    total = Math.round(total * (1 - program.discountRate / 100));
  }

  // 선택 옵션 추가
  const options = program.options as CheckupOption[];
  for (const optId of selectedOptions) {
    const opt = options.find(o => o.id === optId);
    if (opt) total += opt.price;
  }

  return total;
}
```

### 10.3 수납 데이터 모델

검진 수납은 기존 Billing을 재사용하되, `billingType: 'CHECKUP'`으로 구분:

```typescript
// ClinicAdapter.createBilling
await this.clinicAdapter.createBilling({
  patientId: visit.patientId,
  encounterId: checkupEncounter.id,
  billingType: 'CHECKUP',
  totalAmount: totalPrice,
  copayAmount: totalPrice,  // 검진은 100% 자비 (보험 미적용)
  items: [
    { name: program.name, amount: program.price, quantity: 1 },
    ...selectedOptions.map(opt => ({ name: opt.name, amount: opt.price, quantity: 1 })),
  ],
});
```

---

## 11. 사전 안내 + 문진표

### 11.1 예약 확인 + 사전 안내

예약 시 자동 발송 (SMS/포털 알림):

```
┌─ 건강검진 예약 확인 ───────────────────────────┐
│                                                │
│ 홍길동님, 건강검진 예약이 확인되었습니다.        │
│                                                │
│ ■ 일시: 2026-05-21 (수) 08:00                  │
│ ■ 프로그램: 표준 종합검진 (CK-STANDARD)        │
│ ■ 장소: Hospital RUN 건강검진센터 2층           │
│ ■ 소요: 약 120분                               │
│                                                │
│ ■ 준비사항                                      │
│ • 검진 전날 21시 이후 금식 (물 포함)            │
│ • 위내시경 포함 시 아침 약 복용 금지            │
│ • 편한 복장 착용 (원피스/타이즈 불가)           │
│ • 콘택트렌즈 착용 시 안경 지참                  │
│ • 여성: 생리 중 소변/대변검사 불가              │
│                                                │
│ ■ 사전 문진표                                   │
│ 아래 링크에서 사전 문진표를 작성해주세요.        │
│ [문진표 작성하기 →]                             │
│                                                │
│ 문의: 건강검진센터 02-XXX-XXXX                  │
└────────────────────────────────────────────────┘
```

### 11.2 사전 문진표 (CheckupQuestionnaire)

기존 HIS 문진표(Questionnaire) 모듈을 재사용하되, 검진 전용 템플릿 추가:

| 섹션 | 항목 | 타입 |
|------|------|------|
| **기본 정보** | 키, 체중, 혈액형 | 숫자/선택 |
| **병력** | 현재 치료 중인 질환 (복수 선택) | 체크박스 |
| **가족력** | 부모/형제 주요 질환 | 체크박스 |
| **약물** | 현재 복용 중인 약물 | 텍스트 |
| **알레르기** | 약물/음식/조영제 알레르기 | 체크박스+텍스트 |
| **생활습관** | 음주(주 몇 회), 흡연(갑년), 운동(주 몇 회) | 선택/숫자 |
| **여성** | 임신 여부, 마지막 생리일, 경구피임약 | 선택/날짜 |
| **수술력** | 과거 수술 이력 | 텍스트 |
| **증상** | 최근 불편한 증상 (복수 선택) | 체크박스+텍스트 |

```prisma
// CheckupVisit에 문진표 연결
model CheckupVisit {
  ...
  questionnaireId  String?  @map("questionnaire_id") @db.Uuid  // HIS Questionnaire FK
  ...
}
```

**구현**: 기존 `/api/v1/questionnaires` API + 검진용 템플릿 seed 추가

---

## 12. 단체 검진

### 12.1 단체(기업) 계약 관리

```prisma
model CheckupContract {
  id             String   @id @default(uuid()) @db.Uuid
  companyName    String   @map("company_name") @db.VarChar(200)
  contactPerson  String?  @map("contact_person") @db.VarChar(100)
  contactPhone   String?  @map("contact_phone") @db.VarChar(20)
  programId      String   @map("program_id") @db.Uuid
  headcount      Int                                          // 계약 인원
  discountRate   Int      @map("discount_rate")               // 단체 할인율 %
  contractDate   DateTime @map("contract_date") @db.Date
  expiryDate     DateTime @map("expiry_date") @db.Date
  status         String   @default("ACTIVE") @db.VarChar(20)  // ACTIVE, EXPIRED, CANCELLED
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz()

  program CheckupProgram @relation(fields: [programId], references: [id])
  visits  CheckupVisit[] @relation("ContractVisits")

  @@map("ck_contracts")
}
```

### 12.2 단체 일괄 예약

```
POST /api/v1/checkup/contracts                   — 단체 계약 등록
GET  /api/v1/checkup/contracts                   — 계약 목록
POST /api/v1/checkup/contracts/:id/bulk-reserve   — 일괄 예약 (CSV 업로드)
GET  /api/v1/checkup/contracts/:id/visits        — 계약별 수검자 목록
```

CSV 형식:
```
이름,주민번호,성별,생년월일,전화번호,희망일자,추가옵션
홍길동,XXXXXX-1XXXXXX,M,1981-03-15,010-1234-5678,2026-06-15,대장내시경
```

### 12.3 단체 대시보드

```
┌─ 단체검진: ○○기업 (50명) ────────────────────────┐
│ 계약기간: 2026-06 ~ 2026-08 | 할인: 15%          │
│                                                   │
│ 진행현황: ████████░░░░░ 60% (30/50명 완료)         │
│ 예약완료: 45명 | 미예약: 5명 | 검진완료: 30명      │
│                                                   │
│ [미예약자 알림 발송] [결과 일괄 다운로드]            │
└───────────────────────────────────────────────────┘
```

---

## 13. 국가건강검진 연동

### 13.1 국민건강보험공단 1차/2차 검진

| 구분 | 대상 | 주기 | 항목 |
|------|------|------|------|
| **일반건강검진** | 직장가입자, 세대주 | 2년 1회 | 신체계측+혈액+소변+흉부X-ray+구강 |
| **암검진** | 연령별 | 항목별 상이 | 위암(40+), 대장암(50+), 유방암(40+여), 자궁경부암(20+여), 간암(고위험), 폐암(54-74 흡연) |
| **영유아검진** | 생후 14일~72개월 | 월령별 | 발달평가, 건강교육 |
| **생애전환기검진** | 40세, 66세 | 1회 | 일반+추가(B형간염, 골밀도, 정신건강 등) |

### 13.2 국가검진 프로그램 매핑

```typescript
// 국가건강검진 코드와 HIS 검사코드 매핑
const NHI_PROGRAM_MAP = {
  'GE-01': { name: '일반건강검진', hisProgram: 'CK-NHI-GENERAL', nhiFee: true },
  'CA-01': { name: '위암검진 (위내시경)', hisProgram: 'CK-NHI-STOMACH', nhiFee: true },
  'CA-02': { name: '대장암검진 (분변잠혈)', hisProgram: 'CK-NHI-COLON', nhiFee: true },
  'CA-03': { name: '유방암검진 (유방촬영)', hisProgram: 'CK-NHI-BREAST', nhiFee: true },
  'CA-04': { name: '자궁경부암검진', hisProgram: 'CK-NHI-CERVIX', nhiFee: true },
  'CA-05': { name: '간암검진 (초음파+AFP)', hisProgram: 'CK-NHI-LIVER', nhiFee: true },
  'CA-06': { name: '폐암검진 (저선량CT)', hisProgram: 'CK-NHI-LUNG', nhiFee: true },
};
```

### 13.3 국가검진 수납 특이사항

- **공단 부담**: 검진 비용은 건강보험공단이 부담 (수검자 무료)
- **추가 검사**: 국가검진 범위 초과 항목은 자비 부담
- **청구**: 공단에 검진 결과 + 비용 청구 (별도 EDI)
- **결과 보고**: 검진 결과를 공단에 전산 보고 (국가건강검진 결과통보서)

```prisma
// CheckupVisit에 국가검진 여부 추가
model CheckupVisit {
  ...
  isNhiScreening   Boolean  @default(false) @map("is_nhi_screening")  // 국가건강검진 여부
  nhiScreeningCode String?  @map("nhi_screening_code") @db.VarChar(10) // GE-01, CA-01 등
  ...
}
```

---

## 14. 검사 순서 최적화 로직

### 14.1 순서 결정 규칙

```typescript
const ORDERING_RULES = [
  // 1. 금식 필수 검사 최우선 (채혈, 복부초음파, 위내시경)
  { priority: 1, condition: 'FASTING_REQUIRED', items: ['채혈', '복부초음파', '위내시경', '대장내시경'] },

  // 2. 비침습 검사 (금식 해제 전 가능)
  { priority: 2, condition: 'NON_INVASIVE', items: ['신체계측', '심전도', '흉부X-ray', '안과', '청력'] },

  // 3. 초음파 (복부 금식, 갑상선은 무관)
  { priority: 3, condition: 'ULTRASOUND', items: ['갑상선초음파', '경동맥초음파', '유방초음파'] },

  // 4. 소변/대변 (채혈 후)
  { priority: 4, condition: 'SPECIMEN', items: ['소변검사', '대변검사'] },

  // 5. 침습/시간 소요 검사 (마지막)
  { priority: 5, condition: 'INVASIVE', items: ['위내시경', '대장내시경', 'CT', 'MRI', 'PET-CT'] },

  // 6. 결과 상담 (항상 마지막)
  { priority: 99, condition: 'CONSULT', items: ['결과상담'] },
];
```

### 14.2 동선 최적화

```typescript
// 검사실 위치 기반 동선 정렬 (같은 층 → 같은 구역 우선)
interface ExamRoom {
  name: string;
  floor: number;
  zone: string;  // 'A', 'B', 'C'
}

function optimizeRoute(items: CheckupProgramItem[], rooms: ExamRoom[]): CheckupProgramItem[] {
  // 1차: priority 순 정렬
  // 2차: 같은 priority 내에서 floor → zone 순 정렬
  // 금식 검사는 반드시 최상위
}
```

---

## 15. Seed 데이터

### 15.1 검진 프로그램 시딩

구현 Phase 1에서 아래 프로그램을 자동 시딩:

```typescript
const SEED_PROGRAMS = [
  {
    code: 'CK-BASIC', name: '기본 종합검진', category: 'BASIC',
    gender: 'ALL', price: 380000, duration: 120,
    items: [
      { seq: 1, category: 'PHYSICAL', name: '신체계측', codes: ['HEIGHT','WEIGHT','WAIST','BMI','BP','VISION','HEARING'] },
      { seq: 2, category: 'PHYSICAL', name: '체성분/스트레스', codes: ['BODY_COMP','STRESS','META_AGE'] },
      { seq: 3, category: 'DIAGNOSTIC', name: '심전도', codes: ['EKG'] },
      { seq: 4, category: 'LAB', name: '소변검사', codes: ['UA_17'] },
      { seq: 5, category: 'LAB', name: '대변검사', codes: ['FOBT','PARASITE'] },
      { seq: 6, category: 'LAB', name: '혈액검사', codes: ['CBC_18','LFT','FBS','HbA1c','LIPID','BUN_CR','FIB4','URIC','hsCRP','HCV','AFP','CA199','PSA_M','THYROID'] },
      { seq: 7, category: 'IMAGING', name: '흉부 X-ray', codes: ['CHEST_PA'], interpretDept: '영상의학과' },
      { seq: 8, category: 'DIAGNOSTIC', name: '위장검사', codes: ['UGI_OR_EGD'], interpretDept: '소화기내과' },
      { seq: 9, category: 'IMAGING', name: '상복부 초음파', codes: ['ABD_US'], interpretDept: '영상의학과' },
      { seq: 10, category: 'IMAGING', name: '갑상선 초음파', codes: ['THYROID_US'], interpretDept: '영상의학과' },
      { seq: 11, category: 'CONSULT', name: '결과상담', codes: ['CONSULT'] },
    ],
    options: [
      { id: 'opt-colon', name: '대장내시경', price: 80000, category: 'DIAGNOSTIC', codes: ['COLONOSCOPY'] },
      { id: 'opt-sleep-egd', name: '수면 위내시경', price: 50000, category: 'DIAGNOSTIC', codes: ['SLEEP_EGD'] },
      { id: 'opt-brain-mri', name: '뇌 MRI+MRA', price: 350000, category: 'IMAGING', codes: ['BRAIN_MRI','BRAIN_MRA'] },
      { id: 'opt-cardiac-ct', name: '심장 CT', price: 200000, category: 'IMAGING', codes: ['CARDIAC_CT'] },
      { id: 'opt-ldct', name: '저선량 흉부 CT', price: 100000, category: 'IMAGING', codes: ['LDCT'] },
      { id: 'opt-bmd', name: '골밀도검사', price: 50000, category: 'DIAGNOSTIC', codes: ['BMD'] },
    ],
  },
  // CK-PLUS, CK-PRECISION, CK-PREMIUM, CK-PET, CK-FEMALE, CK-MALE40, 국가검진 ...
];
```

### 15.2 검진 문진표 템플릿 시딩

기존 Questionnaire 테이블에 검진용 템플릿 추가 (type: 'CHECKUP').

---

## 16. 기존 모듈 연동 방식

### 10.1 검사 오더 자동 생성

접수(CHECK_IN) 시 프로그램 items를 순회하며 기존 시스템에 오더 생성:

```typescript
async checkIn(visitId: string) {
  const visit = await getVisit(visitId);
  const items = visit.program.items as ProgramItem[];

  // 1. 검진용 Encounter 생성 (visitType: 'CHECKUP')
  const encounter = await this.hisAdapter.createCheckupEncounter(visit.patientId, visit.program.code);

  for (const item of items) {
    if (item.category === 'LAB') {
      // → Prescription(LAB) 생성 → Order 자동 생성
      await this.hisAdapter.createLabOrder({ encounterId: encounter.id, codes: item.codes, checkupVisitId: visitId });
    }
    if (item.category === 'IMAGING') {
      // → Prescription(IMAGING) 생성 → Order → PACS Worklist 등록
      await this.hisAdapter.createImagingOrder({ encounterId: encounter.id, codes: item.codes, checkupVisitId: visitId });
    }
    if (item.category === 'DIAGNOSTIC') {
      // → DiagnosticTest 생성 (EKG, 내시경 등)
      await this.hisAdapter.createDiagnosticTest({ encounterId: encounter.id, codes: item.codes, checkupVisitId: visitId });
    }
    if (item.category === 'PHYSICAL') {
      // → CheckupResultItem 직접 생성 (신체계측은 수동 입력)
      await this.createPhysicalItems(visitId, item);
    }

    // 2. 판독 담당과가 있으면 판독 요청 생성
    if (item.interpretDept) {
      await this.createInterpretationRequest(visitId, item);
    }
  }
}
```

### 10.2 결과 자동 수집

각 검사 완료 시 CheckupResultItem에 반영:
- Lab: `LabResultItem` 완료 → `CheckupResultItem` 생성
- Imaging: `ImagingResult` 판독 완료 → `CheckupResultItem` 생성
- Diagnostic: `DiagnosticTest` 완료 → `CheckupResultItem` 생성
- 방법: **이벤트 기반** (OrderStatus COMPLETED 시) 또는 **수동 수집 버튼**
- 전문과 판독 완료 시: `CheckupInterpretation` → `CheckupResultItem.finding` 갱신

### 10.3 포털 연동

`/api/v1/portal/checkup-results` — 수검자가 포털에서 결과 조회
- 소견서 PDF 다운로드
- 과거 검진 이력 비교 (연도별 추이 차트)
- 추적 검사 일정 확인 + 재예약 신청

---

## 11. 구현 순서

```
Phase 1  ─── DB 모델(ck_ 7+테이블) + ClinicAdapter + Prisma 구현체 + Seed
Phase 2  ─── 프로그램 CRUD API + 관리 페이지
Phase 3  ─── 예약·접수 + 사전안내(SMS) + 문진표 연동 + 수납
Phase 4  ─── 검사 오더 자동생성 + 순서 최적화 + 순서표
Phase 5  ─── 진행현황 대시보드 (실시간 진행률)
Phase 6  ─── 결과 자동수집 + 판정 로직 (A~D2)
Phase 7  ─── 과별 판독 요청/소견 + 차트 연동 (검진이력탭, 검진배너)
Phase 8  ─── 종합소견 작성 + PDF 보고서 + 외래 의뢰 연계
Phase 9  ─── 단체 검진 (계약 관리, 일괄 예약, 단체 대시보드)
Phase 10 ─── 국가건강검진 연동 (공단 프로그램 매핑, 결과 보고)
Phase 11 ─── 포털 연동 + 추적관리 + 통계
```

---

## 12. 프로젝트 구조

```
hospital-run/
├─ packages/shared/
│  └─ src/
│     └─ clinic-adapter.interface.ts     # ClinicAdapter 인터페이스 (공유)
│
├─ apps/api/
│  ├─ prisma/schema.prisma              # ck_ 테이블 추가
│  └─ src/modules/
│     └─ checkup/                       # 건강검진 독립 모듈
│        ├─ checkup.module.ts
│        ├─ checkup.controller.ts       # /api/v1/checkup/*
│        ├─ checkup.service.ts          # 방문 워크플로우
│        ├─ checkup-program.service.ts  # 프로그램 CRUD
│        ├─ checkup-result.service.ts   # 결과 수집/판정
│        ├─ checkup-interpret.service.ts # 과별 판독 관리
│        ├─ checkup-referral.service.ts # 외래 의뢰 연계
│        ├─ dto/
│        │  ├─ create-program.dto.ts
│        │  ├─ create-visit.dto.ts
│        │  └─ create-summary.dto.ts
│        └─ adapters/
│           └─ prisma-clinic.adapter.ts  # ClinicAdapter 구현 (Prisma DI)
│
├─ apps/web/src/app/(main)/
│  ├─ checkup/                          # 건강검진센터 페이지
│  │  ├─ page.tsx                       # 메인 대시보드
│  │  ├─ programs/page.tsx              # 프로그램 관리
│  │  ├─ schedule/page.tsx              # 예약 캘린더
│  │  ├─ visit/[id]/page.tsx            # 수검자 상세
│  │  └─ review/page.tsx                # 소견 대기열
│  │
│  └─ patients/[id]/components/
│     └─ CheckupHistoryTab.tsx          # 환자 차트 검진이력 탭 (신규)
│
└─ apps/web/src/components/layout/
   └─ Sidebar.tsx                       # 클리닉 센터 섹션 추가
```

---

## 13. 사이드바 메뉴 위치

```
임상
├─ 대시보드
├─ 접수
├─ ...
├─ 기초검사
│
클리닉 센터                 ← 새 섹션
├─ 🏥 건강검진센터
├─ 🦴 물리치료센터 (향후)
├─ 🏋️ 비만클리닉 (향후)
│
병원
├─ 입원 환자
├─ ...
```
