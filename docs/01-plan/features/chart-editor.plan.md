# 진료차트 에디터 기획서

> 작성일: 2026-05-09
> 대상: 의사, 간호사, 임상병리사, 관리자

---

## 1. 배경

### 1-1. 현재 시스템

| 항목 | 현재 | 한계 |
|------|------|------|
| **EncounterTemplate** | 과별 SOAP 템플릿 18종 | JSON 하드코딩, 의료진이 수정 불가 |
| **FormSchema** | JSON 스키마 기반 동적 폼 | 개발자만 편집 가능, 비주얼 에디터 없음 |
| **진료 기록** | SOAP 4섹션 고정 | 과별 특성 반영 불가, 커스텀 필드 추가 불가 |

### 1-2. 의료진별 차트 요구사항

| 직종 | 차트 유형 | 특성 |
|------|----------|------|
| **내과 의사** | SOAP + 문제목록 + 약물이력 | 만성질환 추적, 검사결과 트렌드 |
| **외과 의사** | Op Note + 수술전평가 + 상처관리 | 구조화 수술기록 15필드, 이미지 첨부 |
| **소아과 의사** | 성장발달 + 예방접종 + 수유 | 성장 곡선 차트, 월령별 발달 체크 |
| **정신과 의사** | 정신상태검사(MSE) + 치료계획 | 자유기술 + 구조화 동시, 장기 추적 |
| **응급의학과** | KTAS + 처치기록 + 시간기록 | 시간순 타임라인, 다중 처치 동시 |
| **재활의학과** | 기능평가 + 치료목표 + 진행도 | ROM 측정, 점수 스케일 |
| **간호사** | 간호사정 + DAR/SBAR + I/O + MAR | Focus Charting, 바이탈 트렌드 |
| **임상병리사** | 검사결과 + QC + 장비기록 | 참고치 비교, 이상값 플래그 |

---

## 2. 차트 에디터 설계

### 2-1. 핵심 개념

```
ChartTemplate (차트 템플릿)
├── 기본 정보 (이름, 과, 직종, 버전)
├── 레이아웃 (섹션 배치, 탭 구성)
└── 섹션들 (Section[])
    ├── 섹션 1: "주관적 증상" (SOAP-S)
    │   ├── 필드 1: textarea (자유기술)
    │   ├── 필드 2: checklist (증상 체크)
    │   └── 필드 3: select (통증 부위)
    ├── 섹션 2: "검사 소견" (SOAP-O)
    │   ├── 필드 1: vitals (바이탈 그룹)
    │   ├── 필드 2: textarea (이학적 소견)
    │   └── 필드 3: labResults (검사결과 참조)
    └── 섹션 3: "처방" (SOAP-P)
        ├── 필드 1: prescription (약 처방)
        └── 필드 2: order (검사/영상 오더)
```

### 2-2. 필드 유형 (Field Types)

#### 기본 필드

| 유형 | 설명 | 예시 |
|------|------|------|
| `text` | 단일행 텍스트 | 주호소, 진단명 |
| `textarea` | 다중행 텍스트 | 소견, 경과기록 |
| `number` | 숫자 입력 | 체중, 수치 |
| `select` | 단일 선택 | 상태, 분류 |
| `multiselect` | 다중 선택 | 증상 목록, 부위 |
| `checkbox` | 체크박스 | 확인 항목 |
| `radio` | 라디오 버튼 | 예/아니오 |
| `date` | 날짜 | 발생일 |
| `time` | 시간 | 투약 시간 |
| `slider` | 슬라이더 | 통증 점수 (NRS 0~10) |
| `image` | 이미지 첨부/그리기 | 상처 사진, 해부도 마킹 |

#### 의료 전용 필드

| 유형 | 설명 | 자동 기능 |
|------|------|----------|
| `vitals` | 바이탈 그룹 (HR/BP/SpO2/RR/BT) | 정상범위 자동 표시 |
| `diagnosis-search` | KCD/ICD 코드 검색 | 자동완성, 최근 사용 |
| `medication-search` | 약품 검색 + 용법 | DUR 자동 체크 |
| `procedure-search` | 수가코드 검색 | EDI 코드 연결 |
| `lab-reference` | 최근 검사결과 참조 | 이상값 강조, 트렌드 |
| `body-diagram` | 인체 해부도 마킹 | 부위 클릭 → 메모 |
| `pain-scale` | 통증 스케일 (NRS/VAS) | 시각적 슬라이더 |
| `growth-chart` | 성장 곡선 (소아) | 백분위 자동 계산 |
| `score-calculator` | 임상 점수 계산 | APACHE, GCS, SOFA, Morse |
| `timeline` | 시간순 이벤트 기록 | 응급실 타임라인 |
| `prescription` | 처방 입력 컴포넌트 | OCS 자동 전달 |
| `order` | 오더 입력 (검사/영상) | OCS 자동 전달 |
| `signature` | 전자 서명 | 서명 캔버스 |
| `photo-capture` | 사진 촬영/업로드 | 카메라 연동 |

### 2-3. 레이아웃 옵션

```
레이아웃 유형:
├── tabs         — 탭 형태 (기본, 섹션이 많을 때)
├── accordion    — 아코디언 형태 (펼침/접기)
├── single-page  — 단일 페이지 스크롤
├── side-by-side — 좌우 분할 (소견 좌 + 처방 우)
└── timeline     — 시간순 배치 (응급)

컬럼 배치:
├── 1-column     — 전체 너비
├── 2-column     — 2열 분할
├── 3-column     — 3열 분할
└── mixed        — 섹션별 다른 열 수
```

---

## 3. 데이터 모델

### 3-1. ChartTemplate

```prisma
model ChartTemplate {
  id            String   @id @default(uuid()) @db.Uuid
  name          String   @db.VarChar(200)              // "내과 외래 진료"
  department    String   @db.VarChar(50)               // "내과"
  role          String   @db.VarChar(30)               // DOCTOR, NURSE, LAB_TECH
  category      String   @db.VarChar(50)               // OUTPATIENT, INPATIENT, EMERGENCY, SURGERY, NURSING
  description   String?  @db.Text
  layout        String   @default("tabs") @db.VarChar(20)  // tabs, accordion, single-page
  sections      Json     @db.JsonB                     // Section[]
  isDefault     Boolean  @default(false)               // 과별 기본 템플릿
  isActive      Boolean  @default(true)
  version       String   @db.VarChar(20)
  createdBy     String   @db.Uuid
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  // 사용 통계
  usageCount    Int      @default(0)
  lastUsedAt    DateTime?

  @@unique([department, name])
  @@index([department, role])
  @@map("chart_templates")
}
```

### 3-2. Section 구조 (JSON)

```json
{
  "sections": [
    {
      "id": "s1",
      "title": "주관적 증상 (S)",
      "icon": "chat",
      "columns": 1,
      "collapsible": true,
      "defaultOpen": true,
      "fields": [
        {
          "id": "f1",
          "type": "textarea",
          "label": "주호소 (Chief Complaint)",
          "placeholder": "환자가 호소하는 증상...",
          "required": true,
          "rows": 3,
          "mappedTo": "subjective",
          "aiAssist": true
        },
        {
          "id": "f2",
          "type": "multiselect",
          "label": "동반 증상",
          "options": ["발열", "기침", "두통", "구토", "설사", "호흡곤란", "흉통"],
          "mappedTo": "symptoms"
        },
        {
          "id": "f3",
          "type": "slider",
          "label": "통증 강도 (NRS)",
          "min": 0, "max": 10,
          "step": 1,
          "labels": {"0": "없음", "5": "중등도", "10": "극심"},
          "mappedTo": "painScore"
        }
      ]
    },
    {
      "id": "s2",
      "title": "객관적 소견 (O)",
      "icon": "stethoscope",
      "columns": 2,
      "fields": [
        {
          "id": "f4",
          "type": "vitals",
          "label": "활력징후",
          "fields": ["hr", "systolicBp", "diastolicBp", "spo2", "rr", "bt"],
          "mappedTo": "vitals"
        },
        {
          "id": "f5",
          "type": "textarea",
          "label": "이학적 소견",
          "rows": 4,
          "mappedTo": "objective"
        },
        {
          "id": "f6",
          "type": "lab-reference",
          "label": "최근 검사결과",
          "autoLoad": true,
          "highlightAbnormal": true
        }
      ]
    },
    {
      "id": "s3",
      "title": "평가/진단 (A)",
      "fields": [
        {
          "id": "f7",
          "type": "diagnosis-search",
          "label": "진단코드",
          "codeSystem": "KCD",
          "multiple": true,
          "mappedTo": "assessment"
        },
        {
          "id": "f8",
          "type": "score-calculator",
          "label": "중증도 평가",
          "calculator": "APACHE_II",
          "visible": {"when": "category", "equals": "ICU"}
        }
      ]
    },
    {
      "id": "s4",
      "title": "치료계획 (P)",
      "fields": [
        {
          "id": "f9",
          "type": "prescription",
          "label": "약 처방",
          "durCheck": true,
          "orderSets": true
        },
        {
          "id": "f10",
          "type": "order",
          "label": "검사/영상 오더",
          "departments": ["LAB", "IMAGING"]
        },
        {
          "id": "f11",
          "type": "textarea",
          "label": "치료계획 메모",
          "mappedTo": "plan"
        }
      ]
    }
  ]
}
```

### 3-3. 과별 기본 필드 매핑

```json
// 외과 — Op Note 필드
{
  "id": "opNote",
  "type": "group",
  "title": "수술 기록",
  "fields": [
    {"type": "text", "label": "수술명", "mappedTo": "procedureName"},
    {"type": "textarea", "label": "수술 전 진단", "mappedTo": "preOpDiagnosis"},
    {"type": "textarea", "label": "수술 후 진단", "mappedTo": "postOpDiagnosis"},
    {"type": "textarea", "label": "수술 소견", "mappedTo": "opNote"},
    {"type": "number", "label": "추정 실혈량 (mL)", "mappedTo": "ebl"},
    {"type": "text", "label": "검체", "mappedTo": "specimens"},
    {"type": "text", "label": "삽입물", "mappedTo": "implants"},
    {"type": "text", "label": "배액관", "mappedTo": "drains"},
    {"type": "time", "label": "절개 시간", "mappedTo": "incisionTime"},
    {"type": "time", "label": "봉합 시간", "mappedTo": "closureTime"}
  ]
}

// 소아과 — 성장발달
{
  "id": "growth",
  "type": "group",
  "title": "성장 발달",
  "fields": [
    {"type": "number", "label": "체중 (kg)", "mappedTo": "weight"},
    {"type": "number", "label": "신장 (cm)", "mappedTo": "height"},
    {"type": "number", "label": "두위 (cm)", "mappedTo": "headCircumference"},
    {"type": "growth-chart", "label": "성장 곡선"},
    {"type": "checklist", "label": "발달 체크", "items": ["목 가누기", "뒤집기", "앉기", "기기", "걷기", "말하기"]}
  ]
}

// 간호사 — 간호사정
{
  "id": "nursingAssessment",
  "type": "group",
  "title": "간호초기사정",
  "fields": [
    {"type": "select", "label": "의식 수준", "options": ["Alert", "Verbal", "Pain", "Unresponsive"]},
    {"type": "select", "label": "이동능력", "options": ["독립", "부분보조", "완전보조", "침상안정"]},
    {"type": "slider", "label": "통증 (NRS)", "min": 0, "max": 10},
    {"type": "body-diagram", "label": "통증 부위"},
    {"type": "score-calculator", "label": "낙상 위험 (Morse)", "calculator": "MORSE_FALL"},
    {"type": "score-calculator", "label": "욕창 위험 (Braden)", "calculator": "BRADEN"},
    {"type": "select", "label": "영양 상태", "options": ["양호", "불량", "영양실조 위험"]},
    {"type": "select", "label": "피부 상태", "options": ["정상", "건조", "발적", "상처", "욕창"]}
  ]
}
```

---

## 4. 에디터 UI 설계

### 4-1. 차트 에디터 페이지 (`/admin/chart-editor`)

```
┌──────────────────────────────────────────────────────────────────────┐
│ 차트 템플릿 에디터                              [미리보기] [저장]      │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ ┌─ 템플릿 설정 ─────────────────────────────────────────────────┐   │
│ │ 이름: [내과 외래 진료]  과: [내과▼]  직종: [의사▼]             │   │
│ │ 레이아웃: ○ 탭  ○ 아코디언  ○ 단일  ○ 좌우분할                │   │
│ └────────────────────────────────────────────────────────────────┘   │
│                                                                      │
│ ┌─ 좌: 섹션 편집기 ─────────────────┐ ┌─ 우: 미리보기 ──────────┐   │
│ │                                    │ │                          │   │
│ │ [+ 섹션 추가]                      │ │  ┌─ 주관적 증상 (S) ──┐ │   │
│ │                                    │ │  │ 주호소: [________]  │ │   │
│ │ ▼ 주관적 증상 (S)  [↕] [×]         │ │  │ 증상: □발열 □기침   │ │   │
│ │   📝 주호소 (textarea, 필수)      │ │  │ 통증: ──●──── 5/10  │ │   │
│ │   ☑ 동반증상 (multiselect)        │ │  └────────────────────┘ │   │
│ │   🎚 통증 NRS (slider, 0~10)      │ │                          │   │
│ │   [+ 필드 추가]                    │ │  ┌─ 객관적 소견 (O) ──┐ │   │
│ │                                    │ │  │ 바이탈: HR BP SpO2  │ │   │
│ │ ▼ 객관적 소견 (O)  [↕] [×]         │ │  │ 소견: [________]    │ │   │
│ │   ♡ 바이탈 (vitals)               │ │  │ 검사: 자동 로딩...   │ │   │
│ │   📝 이학적 소견 (textarea)        │ │  └────────────────────┘ │   │
│ │   🔬 검사결과 참조 (lab-reference) │ │                          │   │
│ │   [+ 필드 추가]                    │ │  ┌─ 평가 (A) ──────── │  │   │
│ │                                    │ │  │ 진단: [KCD 검색]    │ │   │
│ │ ▼ 평가/진단 (A)  [↕] [×]           │ │  └────────────────────┘ │   │
│ │   🏷 진단코드 (diagnosis-search)   │ │                          │   │
│ │   [+ 필드 추가]                    │ │                          │   │
│ │                                    │ │                          │   │
│ │ ▼ 치료계획 (P)  [↕] [×]            │ │                          │   │
│ │   💊 약 처방 (prescription)        │ │                          │   │
│ │   📋 검사 오더 (order)             │ │                          │   │
│ │   [+ 필드 추가]                    │ │                          │   │
│ └────────────────────────────────────┘ └──────────────────────────┘   │
│                                                                      │
│ ── 필드 추가 패널 ──────────────────────────────────────────────     │
│ 기본: [텍스트] [텍스트영역] [숫자] [선택] [체크] [날짜] [슬라이더]   │
│ 의료: [바이탈] [진단검색] [약품검색] [검사참조] [인체도] [통증스케일] │
│ 고급: [처방] [오더] [서명] [사진] [타임라인] [점수계산기]            │
└──────────────────────────────────────────────────────────────────────┘
```

### 4-2. 필드 속성 편집기

```
필드를 클릭하면 속성 편집 패널 표시:

┌─ 필드 속성 ─────────────────────┐
│ 유형: textarea                   │
│ 라벨: [주호소 (Chief Complaint)] │
│ Placeholder: [증상을 입력...]    │
│ 필수: ☑                         │
│ 행 수: [3]                      │
│ SOAP 매핑: [subjective▼]        │
│ AI 보조: ☑ (AI 자동 요약)       │
│                                  │
│ 조건부 표시:                     │
│  조건 필드: [______]             │
│  값 일치: [______]              │
│                                  │
│ [적용] [취소]                    │
└──────────────────────────────────┘
```

### 4-3. 프리셋 (Preset) — 과별 기본 세트

```
프리셋 목록:
├── 내과 외래 (기본 SOAP)
├── 외과 외래 (SOAP + 상처 관리)
├── 외과 수술 (Op Note 15필드)
├── 소아과 (SOAP + 성장발달)
├── 산부인과 (산전 관리)
├── 정신과 (MSE + 치료계획)
├── 응급실 (KTAS + 타임라인)
├── ICU (바이탈 + I/O + 인공호흡기)
├── 간호 초기사정 (Morse + Braden + AVPU)
├── 간호 일지 (DAR/SBAR)
├── 검사실 (결과 입력 + QC)
└── 빈 템플릿 (자유 구성)
```

---

## 5. 드래그 & 드롭 에디터 상세 설계

### 5-1. 전체 인터랙션 구조

```
┌──────────────────────────────────────────────────────────────────────┐
│                         차트 에디터                                    │
│                                                                      │
│  ┌─ A. 필드 팔레트 ──┐  ┌─ B. 캔버스 (편집영역) ─┐  ┌─ C. 속성 ──┐ │
│  │                    │  │                         │  │            │ │
│  │ 📝 기본 필드       │  │  [섹션 1: 주관적 증상]  │  │ 필드 속성  │ │
│  │  ┌──────────┐     │  │  ┌─────────────────┐   │  │ 편집 패널  │ │
│  │  │ 텍스트   │ ←──drag──→ │ 📝 주호소      │   │  │            │ │
│  │  │ 텍스트영역│     │  │  │ ☑ 동반증상     │   │  │ 라벨:      │ │
│  │  │ 숫자    │     │  │  │ 🎚 통증 NRS     │   │  │ [____]    │ │
│  │  │ 선택    │     │  │  │                  │   │  │ 필수: ☑   │ │
│  │  │ 체크박스 │     │  │  │ ···드롭 영역··· │   │  │ 크기: [3열]│ │
│  │  │ 날짜    │     │  │  └─────────────────┘   │  │ 매핑: [S]  │ │
│  │  └──────────┘     │  │                         │  │            │ │
│  │                    │  │  [섹션 2: 객관적 소견]  │  │            │ │
│  │ 🏥 의료 필드       │  │  ┌─────────────────┐   │  │            │ │
│  │  ┌──────────┐     │  │  │ ♡ 바이탈        │   │  │            │ │
│  │  │ 바이탈   │     │  │  │ 📝 이학적 소견  │   │  │            │ │
│  │  │ 진단검색 │     │  │  │                  │   │  │            │ │
│  │  │ 약품검색 │     │  │  │ ···드롭 영역··· │   │  │            │ │
│  │  │ 검사참조 │     │  │  └─────────────────┘   │  │            │ │
│  │  │ 인체도  │     │  │                         │  │            │ │
│  │  │ 통증스케일│     │  │  [+ 섹션 추가] ← 클릭  │  │            │ │
│  │  │ 성장곡선 │     │  │                         │  │            │ │
│  │  └──────────┘     │  │                         │  │            │ │
│  │                    │  │                         │  │            │ │
│  │ ⚡ 고급 필드       │  │                         │  │            │ │
│  │  ┌──────────┐     │  │                         │  │            │ │
│  │  │ 처방    │     │  │                         │  │            │ │
│  │  │ 오더    │     │  │                         │  │            │ │
│  │  │ 서명    │     │  │                         │  │            │ │
│  │  │ 사진촬영 │     │  │                         │  │            │ │
│  │  │ 타임라인 │     │  │                         │  │            │ │
│  │  │ 점수계산 │     │  │                         │  │            │ │
│  │  └──────────┘     │  │                         │  │            │ │
│  └────────────────────┘  └─────────────────────────┘  └────────────┘ │
│                                                                      │
│  [미리보기]  [되돌리기 ↩]  [다시실행 ↪]  [프리셋 불러오기]  [저장]    │
└──────────────────────────────────────────────────────────────────────┘
```

### 5-2. 드래그 & 드롭 동작 정의

#### (1) 필드 팔레트 → 캔버스 드래그

```
동작: 팔레트에서 필드를 끌어다 캔버스의 섹션 안에 놓기
시각: 드래그 중 반투명 고스트 + 드롭 영역 하이라이트 (파란 점선 테두리)

┌─ 팔레트 ─┐                    ┌─ 캔버스 섹션 ─────────────┐
│           │                    │                            │
│ [텍스트]──┤── 드래그 ──────→  │  기존 필드 1               │
│           │   👆 고스트:       │  ┌─────────────────────┐   │
│           │   "텍스트 필드"    │  │ ··· 여기에 놓기 ··· │   │ ← 드롭 인디케이터
│           │                    │  └─────────────────────┘   │
│           │                    │  기존 필드 2               │
└───────────┘                    └────────────────────────────┘

드롭 시:
1. 기본 속성으로 필드 생성 (라벨: "새 텍스트 필드", 타입: text)
2. 속성 편집 패널 자동 열림
3. 캔버스에 즉시 반영
```

#### (2) 캔버스 내 필드 순서 변경

```
동작: 섹션 내에서 필드를 위/아래로 드래그하여 순서 변경

┌─ 섹션: 주관적 증상 ──────────┐
│  📝 주호소          [≡ 핸들]  │ ← 핸들을 잡고 드래그
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │ ← 이동 위치 표시선
│  ☑ 동반증상         [≡]      │
│  🎚 통증 NRS        [≡]      │ ← 이 필드를 위로 이동
└──────────────────────────────┘

핸들(≡): 좌측 6점 격자 아이콘, 호버 시 cursor: grab
드래그 중: 배경 살짝 어둡게 + 드래그 중인 필드 하이라이트
위치 표시: 파란 수평선 (2px solid blue-500)
```

#### (3) 섹션 순서 변경

```
동작: 섹션 헤더를 잡고 위/아래로 드래그

[≡ 섹션 1: 주관적 증상 (S)]  ──────  드래그 핸들 (섹션 좌측)
[≡ 섹션 2: 객관적 소견 (O)]
[≡ 섹션 3: 평가/진단 (A)]    ← 이 섹션을 1번으로 이동
[≡ 섹션 4: 치료계획 (P)]

드래그 중: 전체 섹션 블록이 반투명으로 따라감
드롭 인디케이터: 섹션 사이 파란 수평선
```

#### (4) 필드 섹션 간 이동

```
동작: 필드를 한 섹션에서 다른 섹션으로 드래그

┌─ 섹션 1: 증상 ────┐     ┌─ 섹션 2: 소견 ────┐
│  📝 주호소         │     │  ♡ 바이탈          │
│  🎚 통증 ──────────┤──→  │  ─ ─ ─ ─ ─ ─     │ ← 다른 섹션으로 이동
│                    │     │  📝 이학적 소견    │
└────────────────────┘     └────────────────────┘

다른 섹션 위에 드래그 시: 해당 섹션 테두리 파란색 하이라이트
```

### 5-3. 필드 조작 인터랙션

#### 선택/편집

```
┌─────────────────────────────────────────┐
│  📝 주호소 (Chief Complaint)             │ ← 클릭: 선택 (파란 테두리)
│  [텍스트를 입력하세요...]               │     더블클릭: 인라인 라벨 편집
│                                         │
│  [≡ 이동] [📋 복제] [🗑 삭제] [⚙ 속성]  │ ← 호버 시 액션 버튼 표시
└─────────────────────────────────────────┘

선택 상태: border-2 border-blue-500 + 파란 배경 살짝
미선택: border border-gray-200
호버: border border-blue-200 + 액션 버튼 페이드인
```

#### 크기 조절 (2열/3열 레이아웃)

```
┌─ 섹션 (2열 레이아웃) ──────────────────────┐
│                                             │
│  ┌─ 50% ──────┐  ┌─ 50% ──────┐           │
│  │ 📝 주호소   │  │ ☑ 동반증상  │           │
│  └─────────────┘  └─────────────┘           │
│                                             │
│  ┌─ 100% (전체 너비) ─────────────────┐    │
│  │ 📝 이학적 소견 (한 줄 차지)         │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─ 33% ──┐  ┌─ 33% ──┐  ┌─ 33% ──┐      │
│  │ HR     │  │ BP     │  │ SpO2   │      │
│  └─────────┘  └─────────┘  └─────────┘      │
└─────────────────────────────────────────────┘

필드 속성에서 "너비" 선택:
  ○ 1/3 (33%)  ○ 1/2 (50%)  ○ 2/3 (67%)  ● 전체 (100%)
```

### 5-4. 섹션 관리

#### 섹션 추가

```
[+ 섹션 추가] 클릭 시 모달:

┌─ 섹션 추가 ─────────────────────────────┐
│                                          │
│  빈 섹션:                                │
│  [📄 빈 섹션 생성]                       │
│                                          │
│  프리셋 섹션:                            │
│  ┌────────┐ ┌────────┐ ┌────────┐      │
│  │ SOAP-S │ │ SOAP-O │ │ SOAP-A │      │
│  │ 주관적 │ │ 객관적 │ │ 평가   │      │
│  └────────┘ └────────┘ └────────┘      │
│  ┌────────┐ ┌────────┐ ┌────────┐      │
│  │ SOAP-P │ │ 바이탈 │ │ Op Note│      │
│  │ 계획   │ │ 그룹   │ │ 수술기록│      │
│  └────────┘ └────────┘ └────────┘      │
│  ┌────────┐ ┌────────┐ ┌────────┐      │
│  │ 간호   │ │ I/O    │ │ 성장   │      │
│  │ 사정   │ │ 기록   │ │ 발달   │      │
│  └────────┘ └────────┘ └────────┘      │
│                                          │
│ [취소]                                   │
└──────────────────────────────────────────┘
```

#### 섹션 헤더 인라인 편집

```
┌─ ▼ 주관적 증상 (S) ──────── [⚙] [📋] [🗑] ─┐
│   │                                            │
│   └─ 클릭: 접기/펼치기                         │
│                                                │
│   ⚙ : 섹션 설정 (컬럼 수, 조건부 표시)         │
│   📋: 섹션 복제                                │
│   🗑 : 섹션 삭제 (확인 다이얼로그)              │
│                                                │
│   제목 더블클릭 → 인라인 편집 모드              │
│   ┌─────────────────────────────────┐          │
│   │ [주관적 증상 (S)             ] │← 커서     │
│   └─────────────────────────────────┘          │
└────────────────────────────────────────────────┘
```

### 5-5. 되돌리기/다시실행 (Undo/Redo)

```
모든 편집 동작은 히스토리 스택에 저장:

히스토리 스택:
├── [0] 초기 상태
├── [1] 필드 추가: "주호소"
├── [2] 필드 이동: "통증" → 2번째
├── [3] 섹션 추가: "객관적 소견"    ← 현재
├── [4] (redo 가능)
└── ...

단축키:
  Ctrl+Z  → 되돌리기
  Ctrl+Y  → 다시실행
  Ctrl+S  → 저장
  Delete  → 선택된 필드 삭제
  Ctrl+D  → 선택된 필드 복제

툴바:
  [↩ 되돌리기(3)] [↪ 다시실행(1)] — 스택 깊이 표시
```

### 5-6. 미리보기 모드

```
[미리보기] 버튼 클릭 시:

에디터 모드 ←→ 미리보기 모드 토글

미리보기 모드에서는:
- 드래그&드롭 비활성화
- 실제 입력 가능 (텍스트, 선택, 슬라이더)
- 의료 전용 필드 작동 (진단 검색, 바이탈 입력)
- 레이아웃 확인 (탭/아코디언/좌우분할)
- 모바일/태블릿 반응형 확인 (뷰포트 전환)

┌─ 미리보기 ──────────────────────────────────┐
│                                              │
│ 뷰포트: [🖥 데스크톱] [📱 모바일] [📋 태블릿]│
│                                              │
│ ┌─ 탭1: 주관적 증상 | 탭2: 소견 | 탭3: ... ┐│
│ │                                           ││
│ │  주호소 *                                 ││
│ │  [실제로 입력할 수 있는 텍스트 필드      ]││
│ │                                           ││
│ │  동반 증상                                ││
│ │  ☑ 발열  □ 기침  □ 두통  ☑ 구토          ││
│ │                                           ││
│ │  통증 강도                                ││
│ │  없음 ────────●──── 극심   7/10           ││
│ │                                           ││
│ └───────────────────────────────────────────┘│
│                                              │
│ [에디터로 돌아가기]                           │
└──────────────────────────────────────────────┘
```

### 5-7. 기술 구현

#### 라이브러리

```
@dnd-kit/core       — 드래그&드롭 코어
@dnd-kit/sortable   — 리스트 정렬 (필드/섹션 순서)
@dnd-kit/utilities  — 유틸리티 (CSS 트랜스폼)

선택 이유:
- react-beautiful-dnd는 유지보수 중단 (Atlassian)
- @dnd-kit은 활발한 유지보수 + React 18 호환
- 접근성(a11y) 내장 (키보드 드래그)
- 가볍고 성능 좋음
```

#### 상태 관리

```typescript
// 에디터 상태 (Zustand)
interface EditorState {
  template: ChartTemplate;
  selectedFieldId: string | null;
  selectedSectionId: string | null;
  history: ChartTemplate[];      // undo 스택
  future: ChartTemplate[];       // redo 스택
  isDirty: boolean;
  previewMode: boolean;

  // 액션
  addSection: (preset?: string) => void;
  removeSection: (id: string) => void;
  moveSection: (from: number, to: number) => void;
  addField: (sectionId: string, field: FieldDef) => void;
  removeField: (sectionId: string, fieldId: string) => void;
  moveField: (fromSection: string, toSection: string, fromIdx: number, toIdx: number) => void;
  updateField: (sectionId: string, fieldId: string, updates: Partial<FieldDef>) => void;
  selectField: (fieldId: string | null) => void;
  undo: () => void;
  redo: () => void;
  save: () => Promise<void>;
}
```

#### 드래그 컨텍스트 설정

```tsx
// 3가지 드래그 소스:
// 1. 팔레트 → 캔버스 (새 필드 추가)
// 2. 캔버스 내 필드 정렬
// 3. 섹션 정렬

<DndContext
  sensors={[useSensor(PointerSensor, { activationConstraint: { distance: 5 } })]}
  collisionDetection={closestCenter}
  onDragStart={handleDragStart}
  onDragOver={handleDragOver}
  onDragEnd={handleDragEnd}
>
  <PalettePanel />         {/* 드래그 소스 */}
  <CanvasPanel />          {/* 드롭 타겟 + 정렬 */}
  <PropertiesPanel />      {/* 속성 편집 */}

  <DragOverlay>
    {activeField && <FieldPreview field={activeField} />}
  </DragOverlay>
</DndContext>
```

---

## 6. API 설계

### 5-1. 차트 템플릿 CRUD (8개)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/v1/chart-templates` | 목록 (과/직종 필터) |
| POST | `/api/v1/chart-templates` | 생성 |
| GET | `/api/v1/chart-templates/:id` | 상세 |
| PUT | `/api/v1/chart-templates/:id` | 수정 |
| DELETE | `/api/v1/chart-templates/:id` | 삭제 |
| POST | `/api/v1/chart-templates/:id/clone` | 복제 |
| GET | `/api/v1/chart-templates/presets` | 프리셋 목록 |
| POST | `/api/v1/chart-templates/from-preset` | 프리셋에서 생성 |

### 5-2. 차트 데이터 (진료 시 사용) (3개)

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/v1/encounters/:id/chart-data` | 차트 데이터 조회 |
| PUT | `/api/v1/encounters/:id/chart-data` | 차트 데이터 저장 |
| GET | `/api/v1/chart-templates/for-me` | 내 역할/과에 맞는 템플릿 |

---

## 6. 구현 우선순위

### Phase 1: 기반 (2시간)
1. ChartTemplate Prisma 모델
2. API CRUD (8 엔드포인트)
3. 프리셋 12종 시드 데이터

### Phase 2: 에디터 UI (3시간)
4. `/admin/chart-editor` 페이지 (좌우 분할)
5. 섹션 드래그&드롭 정렬
6. 필드 추가/편집/삭제 패널
7. 실시간 미리보기

### Phase 3: 진료 연동 (2시간)
8. 진료 화면에서 차트 템플릿 선택
9. 동적 폼 렌더링 엔진
10. 차트 데이터 저장/로딩
11. SOAP 매핑 자동 연결

### Phase 4: 고급 필드 (2시간)
12. 인체 해부도 마킹
13. 성장 곡선 차트
14. 임상 점수 계산기 (GCS, APACHE, Morse, Braden)
15. AI 보조 (필드별 자동 요약/추천)

---

## 7. 기술 고려사항

| 항목 | 설계 |
|------|------|
| **드래그&드롭** | react-beautiful-dnd 또는 @dnd-kit/sortable |
| **폼 렌더링** | JSON → React 컴포넌트 동적 생성 |
| **버전 관리** | 템플릿 수정 시 version 자동 증가 |
| **호환성** | 기존 EncounterTemplate → ChartTemplate 마이그레이션 |
| **성능** | 대용량 JSON 렌더링 최적화 (가상화) |
| **접근 권한** | 의사: 본인 과 템플릿 편집, 관리자: 전체 관리 |
| **감사 로그** | 템플릿 변경 이력 자동 기록 |

---

> **진료차트 에디터** — 의료진이 직접 차트 레이아웃을 디자인하는 비주얼 에디터
>
> ChartTemplate + 20개 필드 유형 + 12개 프리셋 + 드래그&드롭 + 실시간 미리보기
