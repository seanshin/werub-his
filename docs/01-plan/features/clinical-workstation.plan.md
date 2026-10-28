# 임상 검사실/영상실 워크스테이션 기획서 v1.0

> 검사실·영상실·기초검사실 현장 직원을 위한 전용 작업 화면
> **검진센터 워크스테이션 패턴(`/checkup/station`)을 임상 전체로 확장**

---

## 1. 배경 및 목적

### 1.1 현재 상태

| 모듈 | 현재 화면 | 문제점 |
|------|----------|--------|
| **검사실 (Lab)** | `/lab` 단일 페이지, 오더 목록+결과입력 | 채혈실/혈액검사/화학검사/미생물검사/병리 구분 없음 |
| **영상실 (Imaging)** | `/imaging` 70줄짜리 미완성 | Worklist 없음, PACS 연동만 링크 |
| **기초검사 (Diagnostics)** | `/diagnostics` 단일 페이지 | 심전도/폐기능/청력/시력 등 구분 없음 |

### 1.2 검진센터에서 증명된 패턴

검진센터 워크스테이션(`/checkup/station`)이 다음을 성공적으로 구현:
- **스테이션별 탭** 전환 → 해당 검사만 필터
- **대기 환자 자동 표시** (8초 갱신)
- **결과 입력 모달** (값+단위+참고범위+판정)
- **자동 상태 전환** (첫 완료→진행중, 전체 완료→완료)
- **전용 계정** (검사실별 dept-access)

### 1.3 목표

동일 패턴을 **임상 전체**에 적용하여:
1. 각 검사실 현장 직원이 **자기 스테이션의 대기 환자만** 확인
2. **결과 직접 입력** (의사 확인 전 1차 결과)
3. **Worklist 기반** 업무 흐름 (FIFO + 긴급 우선)
4. 영상실은 **PACS Worklist + 판독 요청** 연동
5. 전용 계정으로 **필요한 메뉴만** 노출

---

## 2. 스테이션 정의

### 2.1 검사실 (Lab) 스테이션

| ID | 스테이션 | 담당 검사 | 주요 입력 항목 |
|----|---------|----------|---------------|
| `lab-phlebotomy` | 채혈실 | 채혈, 검체 접수 | 채혈 완료 확인, 검체 바코드 스캔 |
| `lab-hematology` | 혈액검사실 | CBC, ESR, 응고검사 | WBC, RBC, Hb, Hct, PLT, PT, aPTT |
| `lab-chemistry` | 생화학검사실 | LFT, RFT, 전해질, 지질, 당 | AST, ALT, BUN, Cr, Na, K, Glucose, HbA1c |
| `lab-urinalysis` | 소변검사실 | UA, 현미경, 임신 | UA 17항목, 잠혈, 단백 |
| `lab-microbiology` | 미생물검사실 | 배양, 항생제 감수성 | 균종, MIC, 감수성 결과 |
| `lab-bloodbank` | 혈액은행 | 교차시험, 수혈 | ABO/Rh, 교차적합 |
| `lab-pathology` | 병리검사실 | 조직, 세포병리 | 병리 소견, 등급 |

### 2.2 영상실 (Imaging) 스테이션

| ID | 스테이션 | 담당 장비 | 주요 기능 |
|----|---------|----------|----------|
| `img-xray` | 일반촬영실 | X-ray, 투시 | DICOM 촬영→PACS 전송, Worklist |
| `img-ct` | CT실 | CT (조영/비조영) | 조영제 동의서 확인, 촬영 프로토콜 |
| `img-mri` | MRI실 | MRI | 금속물질 체크리스트, 촬영 프로토콜 |
| `img-ultrasound` | 초음파실 | US (복부/심장/갑상선/유방) | 실시간 판독 메모 |
| `img-mammography` | 유방촬영실 | Mammography | BI-RADS 분류 입력 |
| `img-intervention` | 중재시술실 | Angio, 조직검사 | 시술 기록, 합병증 |
| `img-nuclear` | 핵의학 | PET-CT, 뼈스캔, 갑상선 | 방사성 동위원소 투여 기록 |

### 2.3 기초검사 (Diagnostics) 스테이션

| ID | 스테이션 | 담당 검사 | 주요 입력 항목 |
|----|---------|----------|---------------|
| `diag-ecg` | 심전도실 | 12-lead ECG, Holter, ABPM | 자동 판독 + 의사 확인, 리듬, 축 |
| `diag-pft` | 폐기능검사실 | PFT, 메타콜린, DLCO | FVC, FEV1, FEV1/FVC, DLCO |
| `diag-eeg` | 뇌파검사실 | EEG, 수면뇌파 | 뇌파 소견, 이상파 |
| `diag-emg` | 근전도검사실 | EMG, NCS | 신경전도 속도, 근전도 소견 |
| `diag-hearing` | 청력검사실 | PTA, ABR, DPOAE | 주파수별 역치 (250~8000Hz) |
| `diag-endoscopy` | 내시경실 | 위/대장내시경, ERCP, EUS | 소견, 용종, 조직검사 부위 |
| `diag-cardiac` | 심장검사실 | 심초음파, 운동부하 | EF, 판막 기능, 운동 내성 |

---

## 3. 공통 워크스테이션 UI

### 3.1 공통 화면 구조

```
┌─ [스테이션명] 워크스테이션 ────────────────────────────────────┐
│                                                                │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ [Worklist] 대기: 8 │ 진행중: 2 │ 완료: 15 │ 긴급: 1   │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                │
│  ┌─ 대기 환자 ───────────────────────────────────────────┐    │
│  │ 🔴 1. 홍길동 (남/45) P2026-0001  STAT  ← 긴급 강조    │    │
│  │    처방: CBC, BMP, LFT  │  접수: 09:12  │  [결과입력]   │    │
│  │                                                         │    │
│  │ 🟢 2. 이영희 (여/38) P2026-0003                        │    │
│  │    처방: CBC, ESR  │  접수: 09:25  │  [결과입력]         │    │
│  │                                                         │    │
│  │ 🟢 3. 박철수 (남/52) P2026-0005                        │    │
│  │    처방: Glucose, HbA1c  │  접수: 09:40  │  [결과입력]   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                │
│  ┌─ 결과 입력 모달 ──────────────────────────────────────┐    │
│  │  홍길동 — CBC                                          │    │
│  │  ┌──────────┬──────┬──────┬────────┬──────┐            │    │
│  │  │ 항목      │ 결과  │ 단위 │ 참고범위 │ 판정 │            │    │
│  │  ├──────────┼──────┼──────┼────────┼──────┤            │    │
│  │  │ WBC      │ 7200 │ /μL  │ 4000-  │ 정상 │            │    │
│  │  │ RBC      │ 4.8  │ M/μL │ 4.2-5.4│ 정상 │            │    │
│  │  │ Hb       │ 14.2 │ g/dL │ 13-17  │ 정상 │            │    │
│  │  │ PLT      │ 85   │ K/μL │ 150-400│ 이상 │ ← 색상 강조 │    │
│  │  └──────────┴──────┴──────┴────────┴──────┘            │    │
│  │                          [취소]  [검증]  [결과 저장]     │    │
│  └─────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────┘
```

### 3.2 주요 기능

| 기능 | 설명 |
|------|------|
| **Worklist** | Order 상태 기반 자동 대기열 (ORDERED→접수대기, RECEIVED→진행가능) |
| **긴급(STAT) 우선** | STAT 처방은 빨간색 강조 + 목록 최상단 |
| **바코드 스캔** | 검체 바코드 → 환자+처방 자동 매칭 |
| **결과 테이블 입력** | 검사 코드별 항목 테이블 (자동 참고범위 표시) |
| **자동 판정** | 참고범위 기반 정상/이상/위험 자동 표시 |
| **검증(Validation)** | 결과 저장 전 참고범위 벗어나는 항목 경고 |
| **델타 체크** | 이전 결과와 비교하여 급변 항목 알림 |
| **결과 전송** | 저장 → Order 상태 COMPLETED로 자동 전환 |

### 3.3 스테이션별 차별화

#### 영상실 추가 기능

```
┌─ 영상실 Worklist ──────────────────────────────────────────┐
│                                                             │
│  환자: 홍길동 │ 오더: Chest PA │ STAT                       │
│                                                             │
│  ┌─ 촬영 전 ─────────────────────────────────────────┐     │
│  │ ☑ 환자 확인 (이름+생년월일+팔찌)                     │     │
│  │ ☑ 조영제 동의서 확인 (CT 조영 시)                    │     │
│  │ ☑ 임신 여부 확인 (가임기 여성)                       │     │
│  │ ☑ 금속물질 체크 (MRI 시)                            │     │
│  └───────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ 촬영 후 ─────────────────────────────────────────┐     │
│  │ DICOM Study UID: 1.2.840...                        │     │
│  │ [PACS에서 보기] [영상 품질 확인]                     │     │
│  │ 품질: ● 양호  ○ 재촬영 필요                          │     │
│  │ 메모: ____________________________                  │     │
│  │                                                     │     │
│  │               [촬영 완료 → 판독 요청]                │     │
│  └───────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ 판독 (영상의학과 의사용) ─────────────────────────┐     │
│  │ [PACS 뷰어 열기]                                    │     │
│  │ 소견: ________________________________________       │     │
│  │ 결론: ________________________________________       │     │
│  │ 권고: ________________________________________       │     │
│  │                           [임시저장]  [판독 완료]     │     │
│  └───────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

#### 내시경실 추가 기능

```
┌─ 내시경실 ─────────────────────────────────────────────────┐
│                                                             │
│  ┌─ 시술 전 ─────────────────────────────────────────┐     │
│  │ ☑ 금식 확인 (8시간 이상)                            │     │
│  │ ☑ 동의서 서명 확인                                   │     │
│  │ ☑ 항응고제 중단 확인                                 │     │
│  │ ☐ 수면 마취 선택 → 마취과 연락                       │     │
│  └───────────────────────────────────────────────────┘     │
│                                                             │
│  ┌─ 소견 입력 ───────────────────────────────────────┐     │
│  │ 부위: [식도] [위체부] [위전정부] [십이지장]          │     │
│  │ 소견: ☑ 정상  ☐ 위염  ☐ 궤양  ☐ 용종  ☐ 종양       │     │
│  │ 조직검사: [부위 선택] [검체 수: __]                   │     │
│  │ 이미지: [캡처 이미지 첨부] (최대 20장)               │     │
│  │ H.pylori: ☐ 양성  ☐ 음성  ☐ 미시행                  │     │
│  │                                                     │     │
│  │ Sydney 분류: 위축 __/3  장상피화생 __/3              │     │
│  └───────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. 데이터 모델

### 4.1 기존 모델 활용

기존 Order → Lab/Imaging/Diagnostic 모델을 그대로 사용:

```
Prescription(LAB/IMAGING) → Order(ORDERED→RECEIVED→IN_PROGRESS→COMPLETED)
  → LabResult / ImagingResult / DiagnosticTest
```

### 4.2 워크스테이션 스테이션 설정 (신규)

```prisma
model WorkstationConfig {
  id          String   @id @default(uuid()) @db.Uuid
  stationId   String   @unique @map("station_id") @db.VarChar(30)
  label       String   @db.VarChar(100)
  category    String   @db.VarChar(20)  // LAB, IMAGING, DIAGNOSTIC
  department  String   @db.VarChar(50)  // 진단검사의학과, 영상의학과 등
  orderCodes  Json     @map("order_codes") @db.JsonB  // 이 스테이션에서 처리하는 procedureCode 목록
  location    String?  @db.VarChar(100) // "2층 201호"
  isActive    Boolean  @default(true) @map("is_active")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz()

  @@map("workstation_configs")
}
```

### 4.3 검사 항목 템플릿 (신규)

```prisma
model LabTestTemplate {
  id              String   @id @default(uuid()) @db.Uuid
  procedureCode   String   @map("procedure_code") @db.VarChar(20)
  testName        String   @map("test_name") @db.VarChar(200)
  items           Json     @db.JsonB
  // items: [{ name: 'WBC', unit: '/μL', refRange: '4000-10000', decimalPlaces: 0 }, ...]
  stationId       String   @map("station_id") @db.VarChar(30)
  isActive        Boolean  @default(true) @map("is_active")

  @@unique([procedureCode])
  @@map("lab_test_templates")
}
```

---

## 5. API 설계

### 5.1 공통 워크스테이션 API

```
GET    /api/v1/workstation/stations                  — 스테이션 목록
GET    /api/v1/workstation/:stationId/queue          — 대기 환자 (Worklist)
GET    /api/v1/workstation/:stationId/queue?stat=true — 긴급만
PATCH  /api/v1/workstation/:stationId/receive/:orderId — 검체 접수 (ORDERED→RECEIVED)
```

### 5.2 검사실 API

```
GET    /api/v1/workstation/lab/:orderId/template     — 입력 템플릿 (항목+참고범위)
POST   /api/v1/workstation/lab/:orderId/results      — 결과 입력 (다수 항목 일괄)
GET    /api/v1/workstation/lab/:orderId/delta-check   — 델타 체크 (이전 결과 비교)
PATCH  /api/v1/workstation/lab/:orderId/verify        — 결과 검증 완료
```

### 5.3 영상실 API

```
POST   /api/v1/workstation/imaging/:orderId/pre-check   — 촬영 전 체크리스트
PATCH  /api/v1/workstation/imaging/:orderId/acquired     — 촬영 완료 (ACQUIRED)
POST   /api/v1/workstation/imaging/:orderId/reading      — 판독 소견 입력
PATCH  /api/v1/workstation/imaging/:orderId/report        — 판독 완료 (REPORTED)
GET    /api/v1/workstation/imaging/reading-queue          — 판독 대기열
```

### 5.4 기초검사 API

```
GET    /api/v1/workstation/diagnostic/:testId/form   — 입력 폼 (검사별 맞춤)
POST   /api/v1/workstation/diagnostic/:testId/result — 결과 입력
```

---

## 6. 프론트엔드 페이지

### 6.1 페이지 구조

| 경로 | 역할 | 접근 |
|------|------|------|
| `/workstation` | 워크스테이션 메인 (스테이션 선택) | LAB_TECH, NURSE, DOCTOR |
| `/workstation/lab` | 검사실 워크스테이션 | LAB_TECH |
| `/workstation/imaging` | 영상실 워크스테이션 | LAB_TECH, DOCTOR(영상의학과) |
| `/workstation/diagnostic` | 기초검사 워크스테이션 | NURSE, LAB_TECH |
| `/workstation/reading` | 판독 대기열 (영상의학과) | DOCTOR(영상의학과) |

### 6.2 기존 페이지와의 관계

| 기존 | 역할 | 워크스테이션과의 관계 |
|------|------|---------------------|
| `/lab` | 오더 목록 + 결과 입력 | **→ `/workstation/lab`으로 대체** (기존은 관리자 뷰로 유지) |
| `/imaging` | 미완성 목록 | **→ `/workstation/imaging`으로 대체** |
| `/diagnostics` | 기초검사 목록 | **→ `/workstation/diagnostic`으로 대체** |

---

## 7. 전용 계정 설계

### 7.1 계정 목록

| 계정 | 부서 | 역할 | 보이는 메뉴 |
|------|------|------|------------|
| `ws.phlebotomy@hospitalrun.example` | 검사실(채혈) | NURSE | /workstation/lab |
| `ws.hematology@hospitalrun.example` | 검사실(혈액) | LAB_TECH | /workstation/lab |
| `ws.chemistry@hospitalrun.example` | 검사실(생화학) | LAB_TECH | /workstation/lab |
| `ws.urinalysis@hospitalrun.example` | 검사실(소변) | LAB_TECH | /workstation/lab |
| `ws.microbiology@hospitalrun.example` | 검사실(미생물) | LAB_TECH | /workstation/lab |
| `ws.xray@hospitalrun.example` | 영상실(일반촬영) | LAB_TECH | /workstation/imaging |
| `ws.ct@hospitalrun.example` | 영상실(CT) | LAB_TECH | /workstation/imaging |
| `ws.mri@hospitalrun.example` | 영상실(MRI) | LAB_TECH | /workstation/imaging |
| `ws.ultrasound@hospitalrun.example` | 영상실(초음파) | LAB_TECH | /workstation/imaging |
| `ws.nuclear@hospitalrun.example` | 영상실(핵의학) | LAB_TECH | /workstation/imaging |
| `ws.ecg@hospitalrun.example` | 기초검사(심전도) | NURSE | /workstation/diagnostic |
| `ws.pft@hospitalrun.example` | 기초검사(폐기능) | NURSE | /workstation/diagnostic |
| `ws.endoscopy@hospitalrun.example` | 기초검사(내시경) | NURSE | /workstation/diagnostic |

### 7.2 부서별 접근 권한

```typescript
'검사실(채혈)': ['/workstation', '/workstation/lab'],
'검사실(혈액)': ['/workstation', '/workstation/lab'],
'검사실(생화학)': ['/workstation', '/workstation/lab'],
'영상실(일반촬영)': ['/workstation', '/workstation/imaging'],
'영상실(CT)': ['/workstation', '/workstation/imaging'],
'기초검사(심전도)': ['/workstation', '/workstation/diagnostic'],
```

---

## 8. 기존 모듈과의 차이

### 8.1 검진센터 vs 임상 워크스테이션

| 구분 | 검진센터 (`/checkup/station`) | 임상 (`/workstation`) |
|------|----------------------------|---------------------|
| 오더 소스 | CheckupVisit → ResultItem | Prescription → Order → LabResult/ImagingResult |
| 대기열 | 검진 프로그램 items 기반 | Order 상태(ORDERED/RECEIVED) 기반 |
| 결과 저장 | CheckupResultItem | LabResultItem / ImagingResult / DiagnosticTest |
| 상태 전환 | CheckupVisit 상태 | Order 상태 (ORDERED→COMPLETED) |
| 판독 | CheckupInterpretation | ImagingResult.reading |
| 긴급도 | 없음 (검진은 예약) | STAT/ROUTINE/PRN |
| 바코드 | 미지원 | 검체 바코드 스캔 |

### 8.2 검진센터 스테이션 재사용

검진센터 워크스테이션의 UI 패턴(스테이션 탭, 대기 카드, 결과 입력 모달)을 **공유 컴포넌트**로 분리하여 임상 워크스테이션에서도 사용:

```
components/workstation/
├── StationTabs.tsx        — 스테이션 탭 전환
├── PatientQueue.tsx       — 대기 환자 카드 목록
├── ResultInputModal.tsx   — 결과 입력 모달 (단일 항목)
├── ResultTableInput.tsx   — 결과 입력 테이블 (다수 항목)
├── StatCountBar.tsx       — 대기/진행/완료 카운트 바
└── PreCheckList.tsx       — 촬영 전 체크리스트
```

---

## 9. 구현 순서

```
Phase 1  ─── WorkstationConfig + LabTestTemplate 모델 + Seed
Phase 2  ─── Workstation 공통 API (queue, receive, complete)
Phase 3  ─── /workstation/lab — 검사실 워크스테이션 (채혈→혈액→생화학)
Phase 4  ─── /workstation/imaging — 영상실 워크스테이션 (Worklist+PACS+판독)
Phase 5  ─── /workstation/diagnostic — 기초검사 워크스테이션 (ECG+PFT+내시경)
Phase 6  ─── 판독 대기열 (/workstation/reading)
Phase 7  ─── 전용 계정 Seed + dept-access
Phase 8  ─── 공유 컴포넌트 분리 (검진센터 스테이션과 통합)
Phase 9  ─── 바코드 스캔 + 델타 체크 + 자동 참고범위
Phase 10 ─── 기존 /lab, /imaging, /diagnostics 페이지를 워크스테이션으로 리다이렉트
```

---

## 10. 사이드바 메뉴 위치

```
임상
├─ 대시보드, 접수, 환자 관리...
│
워크스테이션                    ← 신규 섹션
├─ 🧪 검사실
├─ 📷 영상실
├─ 💓 기초검사
├─ 📋 판독 대기
│
클리닉 센터
├─ 🏥 건강검진센터
├─ ...
```

---

## 11. 검진센터 ↔ 임상 통합 시나리오

### 검진 수검자가 임상 검사실을 이용하는 경우

```
검진 접수 (CheckupVisit)
  ↓
ClinicAdapter.createLabOrder()  ← 실제 Prescription+Order 생성
  ↓
임상 검사실 워크스테이션에 대기 표시
  ↓
검사 완료 → Order COMPLETED
  ↓
이벤트 → CheckupResultItem 자동 반영 (autoCollect)
  ↓
검진센터 순서표에서 진행률 업데이트
```

이를 위해 Phase 4(검사 오더 자동생성)에서 placeholder로 남긴 ClinicAdapter의
`createLabOrder`, `createImagingOrder` 메서드를 **실제 Prescription 생성으로 연동**해야 합니다.

---

## 12. 프로젝트 구조

```
hospital-run/
├─ apps/api/src/modules/
│  └─ workstation/                    ← 신규 모듈
│     ├─ workstation.module.ts
│     ├─ workstation.controller.ts    # /api/v1/workstation/*
│     ├─ workstation.service.ts       # Worklist 관리
│     ├─ lab-station.service.ts       # 검사실 결과 입력
│     ├─ imaging-station.service.ts   # 영상실 촬영+판독
│     ├─ diagnostic-station.service.ts # 기초검사 입력
│     └─ dto/
│
├─ apps/web/src/
│  ├─ app/(main)/workstation/
│  │  ├─ page.tsx                     # 메인 (스테이션 선택)
│  │  ├─ lab/page.tsx                 # 검사실 워크스테이션
│  │  ├─ imaging/page.tsx             # 영상실 워크스테이션
│  │  ├─ diagnostic/page.tsx          # 기초검사 워크스테이션
│  │  └─ reading/page.tsx             # 판독 대기열
│  │
│  └─ components/workstation/         # 공유 컴포넌트
│     ├─ StationTabs.tsx
│     ├─ PatientQueue.tsx
│     ├─ ResultInputModal.tsx
│     ├─ ResultTableInput.tsx
│     └─ PreCheckList.tsx
```

---

## 13. 기대 효과

| 구분 | Before | After |
|------|--------|-------|
| 검사 결과 입력 | 의사가 EMR에서 수동 입력 | 검사 기사가 현장에서 직접 입력 |
| 영상 판독 | 별도 PACS에서만 판독 | HIS 내 판독 대기열 + PACS 연동 |
| 대기 현황 | 확인 불가 | 실시간 Worklist (환자·검사실 양쪽) |
| 긴급 처리 | 전화 연락 | STAT 자동 최상단 + 알림 |
| 검진↔임상 연동 | 수동 결과 확인 | 자동 수집 (Order→CheckupResultItem) |
