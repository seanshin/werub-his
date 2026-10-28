# 병원 정보 콘텐츠 관리 시스템 (Hospital Info CMS) 기획서

> **상태(2026-09-15 코드 대조 갱신)**: 구현됨(일부) — 예약 챗 주차·식당·장례식장·층별 안내가 CMS 공개 행만 읽음 `apps/api/src/modules/agent-session/agent-session.service.ts` cmsGuide · 공개 조건 정본 `apps/api/src/modules/hospital-info/hospital-info.service.ts:432` publicVisibilityWhere(A3 `9e43e96b`) · 챗 규칙 응답 근거 없는 상수 제거(P1) · 포털 기본 공지 지어낸 시설 사실 제거(`3d215b12`) · 잔여: 층별 안내 예시(FLOORS)·직원 식당 문구 철거 여부(사람)

> 작성일: 2026-05-22
> 목적: 환자포털·AI예약도우미에서 응답하는 병원 정보를 관리자가 직접 수정·삭제·관리할 수 있는 데이터 기반 시스템
> 근거: 의료법 시행규칙 제40조 (의료기관 시설·인력 정보 공개), 환자의 알 권리

---

## 1. 현황 분석

### 1.1 현재 구조 (문제점)

| 정보 유형 | 현재 위치 | 문제 |
|----------|----------|------|
| 병원 기본정보 (이름, 주소, 전화) | `SystemConfig` DB | **양호** — 이미 관리 가능 |
| 진료시간 | `SystemConfig` DB | **양호** |
| 주차장 안내 | `agent-session.service.ts` 하드코딩 | **수정 시 코드 배포 필요** |
| 식당/카페 메뉴 | `agent-session.service.ts` 하드코딩 | **수정 시 코드 배포 필요** |
| 장례식장 | `agent-session.service.ts` 하드코딩 | **수정 시 코드 배포 필요** |
| 층별 시설 안내 | `facility-info/page.tsx` 하드코딩 | **수정 시 코드 배포 필요** |
| 진료과 소개 | DB (`User.department`) | 이름만 있고 **소개글 없음** |
| 의사 소개 | DB (`User`) | 기본정보만, **전문분야/경력/학력 없음** |
| 편의시설 운영시간 | 하드코딩 | **관리 불가** |

### 1.2 의료법상 공개 의무 항목

| 항목 | 근거 | 필수 |
|------|------|------|
| 의료기관 명칭·주소·전화 | 의료법 §33 | 필수 |
| 진료과목 | 의료법 §43 | 필수 |
| 진료시간 | 의료법 시행규칙 §40 | 필수 |
| 의료인 인적사항 (면허번호, 전문과목) | 의료법 §42 | 필수 |
| 비급여 진료비 | 의료법 §45 | 필수 (별도 관리) |
| 환자 권리·의무 | 의료법 §4 | 필수 |
| 시설 현황 | JCI/EMR 인증 | 권장 |

---

## 2. 설계: HospitalInfoContent 모델

### 2.1 핵심 데이터 모델

```
HospitalInfoContent {
  id          UUID      PK
  category    String    // FACILITY, DEPARTMENT, DOCTOR, PARKING, DINING, FUNERAL, GENERAL, FAQ
  slug        String    // unique 식별자 (예: "parking-guide", "dept-internal-medicine")
  title       String    // 표시 제목
  content     Text      // 마크다운 또는 일반 텍스트 본문
  metadata    JSON      // 카테고리별 구조화 데이터 (아래 참조)
  sortOrder   Int       // 같은 카테고리 내 정렬 순서
  isActive    Boolean   // 비활성화 가능 (삭제 대신)
  imageUrl    String?   // 대표 이미지
  tags        String[]  // 검색 키워드 (AI 매칭용)
  
  createdBy   UUID      // 작성자
  updatedBy   UUID?     // 수정자
  createdAt   DateTime
  updatedAt   DateTime
  
  @@unique([category, slug])
  @@index([category, isActive])
}
```

### 2.2 카테고리별 metadata 구조

#### PARKING (주차장)
```json
{
  "totalSpaces": 320,
  "floors": ["B1", "B2", "B3"],
  "freeHours": 2,
  "ratePerHalfHour": 1000,
  "dailyMax": 15000,
  "disabledSpaces": 10,
  "evChargers": 4,
  "operatingHours": "24시간",
  "nightClosed": ["B2", "B3"],
  "valetParking": false,
  "contact": "내선 9"
}
```

#### DINING (식당/카페/편의점)
```json
{
  "type": "cafeteria|cafe|convenience|foodcourt",
  "location": "B1층",
  "operatingHours": { "open": "07:00", "close": "20:00" },
  "menus": [
    { "name": "A코스 (한식)", "price": 6000, "description": "된장찌개+불고기+3찬+밥" },
    { "name": "B코스 (양식)", "price": 7000, "description": "돈까스/함박+샐러드+수프" }
  ],
  "staffDiscount": { "price": 4500, "note": "사번 확인" },
  "contact": "내선 8500"
}
```

#### FUNERAL (장례식장)
```json
{
  "location": "별관 1층",
  "rooms": [
    { "name": "1호 빈소", "capacity": 100, "pricePerDay": 1200000 },
    { "name": "2호 빈소", "capacity": 60, "pricePerDay": 800000 }
  ],
  "services": ["수의·관·제단 기본", "조문객 식사 15,000원", "운구차량 서울 무료"],
  "operatingHours": "24시간",
  "contact": "02-1234-5670",
  "parkingSpaces": 50
}
```

#### DEPARTMENT (진료과)
```json
{
  "code": "IM",
  "nameKo": "내과",
  "nameEn": "Internal Medicine",
  "location": "2층 201~202호",
  "phone": "내선 2100",
  "operatingHours": { "weekday": "09:00~18:00", "saturday": "09:00~13:00" },
  "specialties": ["순환기", "호흡기", "소화기", "내분비"],
  "services": ["만성질환 관리", "건강검진", "내시경"],
  "doctors": ["김내과", "박내과"]  // 또는 doctorIds 참조
}
```

#### DOCTOR (의사 소개)
```json
{
  "userId": "uuid",
  "nameKo": "김내과",
  "department": "내과",
  "specialty": "순환기내과",
  "position": "과장",
  "licenseNumber": "의사-12345",
  "education": ["서울대 의학과", "가상대병원 내과 전문의"],
  "career": ["가상대병원 순환기내과 전임의", "미국 Example Clinic (US) 연수"],
  "certifications": ["내과 전문의", "순환기내과 분과 전문의"],
  "research": ["심부전 치료 가이드라인 공저"],
  "languages": ["한국어", "영어"],
  "scheduleNote": "화·목 오후 부재 (수술)",
  "photoUrl": "/photos/dr-kim.jpg"
}
```

#### FACILITY (층별 시설)
```json
{
  "floor": "2층",
  "name": "외래 진료실",
  "rooms": [
    { "name": "내과 1진료실", "room": "201호", "note": "김내과 선생님" },
    { "name": "외과 1진료실", "room": "203호", "note": "" }
  ],
  "icon": "🩺"
}
```

#### GENERAL (일반 안내)
```json
{
  "type": "visiting_hours|patient_rights|emergency_guide|transport",
  "detail": { ... }
}
```

#### FAQ (자주 묻는 질문)
```json
{
  "question": "진단서는 어디서 발급받나요?",
  "answer": "1층 원무과에서 발급 가능합니다. 본인 신분증 필요.",
  "relatedCategory": "GENERAL"
}
```

---

## 3. API 설계

### 3.1 관리자 API (CRUD — 급양/원무/행정)

| Method | Path | 설명 | 권한 |
|--------|------|------|------|
| GET | `/api/v1/hospital-info` | 전체 조회 (카테고리별 필터) | ALL |
| GET | `/api/v1/hospital-info/:slug` | 단건 조회 | ALL |
| POST | `/api/v1/hospital-info` | 등록 | ADMIN |
| PUT | `/api/v1/hospital-info/:id` | 수정 | ADMIN |
| PATCH | `/api/v1/hospital-info/:id/toggle` | 활성/비활성 | ADMIN |
| DELETE | `/api/v1/hospital-info/:id` | 삭제 | ADMIN |
| POST | `/api/v1/hospital-info/bulk` | 일괄 등록 (초기 데이터) | ADMIN |

### 3.2 공개 API (환자포털·AI 도우미)

| Method | Path | 설명 | 인증 |
|--------|------|------|------|
| GET | `/api/v1/public/hospital-info` | 활성 콘텐츠 전체 | 불필요 |
| GET | `/api/v1/public/hospital-info/:category` | 카테고리별 조회 | 불필요 |
| GET | `/api/v1/public/hospital-info/search?q=주차` | 키워드 검색 | 불필요 |
| GET | `/api/v1/public/departments` | 진료과 목록 (환자용) | 불필요 |
| GET | `/api/v1/public/doctors` | 의사 목록 (환자용) | 불필요 |
| GET | `/api/v1/public/doctors/:id` | 의사 상세 | 불필요 |

### 3.3 AI 도우미 연동

현재 `handleFacilityQuestion()`의 하드코딩 응답을 **DB 조회로 교체**:

```typescript
// Before (하드코딩)
if (/주차/.test(t)) {
  return { response: '🅿️ 주차 안내\n\n...(하드코딩)...' };
}

// After (DB 기반)
if (/주차/.test(t)) {
  const info = await this.getHospitalInfo('PARKING', 'parking-guide');
  return { response: this.formatInfoResponse(info), skipOrchestrator: true };
}
```

**formatInfoResponse()**: metadata의 구조화 데이터를 자연어 응답으로 변환하는 포매터.

---

## 4. 관리 화면 설계

### 4.1 관리자 페이지 (`/admin/hospital-info`)

```
┌─────────────────────────────────────────────────────────┐
│  병원 정보 관리                                [+ 새 콘텐츠]│
├─────────────────────────────────────────────────────────┤
│ [전체] [시설] [진료과] [의사] [주차] [식당] [장례] [FAQ]     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────────────────────────────────────┐       │
│  │ 🅿️ 주차장 안내              [편집] [비활성화]   │       │
│  │ parking-guide · 수정: 2026-05-22 · 관리자      │       │
│  │ 태그: 주차, 주차장, 요금, 전기차, 장애인         │       │
│  └──────────────────────────────────────────────┘       │
│  ┌──────────────────────────────────────────────┐       │
│  │ 🍚 구내식당 "한우리"         [편집] [비활성화]   │       │
│  │ dining-cafeteria · 수정: 2026-05-22 · 급양과    │       │
│  │ 태그: 식당, 밥, 점심, 메뉴, 가격                │       │
│  └──────────────────────────────────────────────┘       │
│  ...                                                    │
└─────────────────────────────────────────────────────────┘
```

### 4.2 편집 모달

```
┌───────────────────────────────────────────────┐
│ 콘텐츠 편집                            [저장]  │
├───────────────────────────────────────────────┤
│ 카테고리: [PARKING ▼]  슬러그: parking-guide   │
│ 제목: 주차장 안내                              │
│ 정렬순서: 1       활성: [✓]                    │
│                                               │
│ 본문 (텍스트):                                 │
│ ┌─────────────────────────────────────────┐   │
│ │ 📍 지하 주차장 (B1~B3, 총 320대)        │   │
│ │ • 진료 환자: 최초 2시간 무료             │   │
│ │ • 이후 30분당 1,000원...                │   │
│ └─────────────────────────────────────────┘   │
│                                               │
│ 구조화 데이터 (JSON):                          │
│ ┌─────────────────────────────────────────┐   │
│ │ { "totalSpaces": 320,                   │   │
│ │   "freeHours": 2, ... }                 │   │
│ └─────────────────────────────────────────┘   │
│                                               │
│ 검색 태그: [주차] [주차장] [요금] [+추가]       │
│ 대표 이미지: [파일 선택]                        │
└───────────────────────────────────────────────┘
```

### 4.3 의사 소개 관리

**기존 User 모델**에는 `department`, `specialty`만 있음.
→ `HospitalInfoContent(DOCTOR)` 또는 **User 모델 확장**(별도 DoctorProfile 모델)으로 경력/학력/자격 관리.

**권장: DoctorProfile 분리 모델**

```
DoctorProfile {
  id              UUID PK
  userId          UUID UNIQUE → User
  position        String?     // 과장, 교수, 전문의
  education       Json        // ["서울대 의학과", ...]
  career          Json        // ["가상대병원 전임의", ...]
  certifications  Json        // ["내과 전문의", ...]
  research        Json?       // 논문/연구
  languages       String[]    // ["한국어", "영어"]
  introduction    Text?       // 의사 소개 자유문
  photoUrl        String?     // 프로필 사진
  scheduleNote    String?     // "화·목 오후 수술"
  isPublic        Boolean     // 공개 여부
  createdAt, updatedAt
}
```

---

## 5. 데이터 흐름

```
┌──────────────────────────────────────────────────────────┐
│                     관리자 (Admin)                        │
│  /admin/hospital-info                                    │
│  → CRUD: HospitalInfoContent                             │
│  → 의사소개: DoctorProfile                               │
│  → 식단: StaffMealMenu (기존)                             │
└──────────┬───────────────────────────────┬───────────────┘
           │                               │
           ▼                               ▼
┌──────────────────┐         ┌──────────────────────────────┐
│ Public API       │         │ AI 예약 도우미                 │
│ /public/          │         │ handleFacilityQuestion()      │
│ hospital-info     │         │                              │
│ departments       │         │ DB 조회 → 자연어 포매팅        │
│ doctors           │         │ tags 매칭 → 가장 적합한 콘텐츠  │
└──────┬───────────┘         └──────────┬───────────────────┘
       │                                │
       ▼                                ▼
┌────────────────────────────────────────────────────────────┐
│                      환자 접점                              │
│                                                            │
│  환자 포털 (/portal)          AI 예약 (/booking)            │
│  ├─ 시설 안내 페이지           ├─ "주차 안내해줘"             │
│  ├─ 진료과/의사 소개           ├─ "내과 의사 누구?"           │
│  ├─ FAQ                      ├─ "식당 메뉴 알려줘"           │
│  └─ 오시는 길                 └─ "장례식장 안내"              │
└────────────────────────────────────────────────────────────┘
```

---

## 6. 초기 데이터 (시드)

### 6.1 필수 콘텐츠 목록

| # | 카테고리 | slug | 제목 | 의료법 |
|---|----------|------|------|--------|
| 1 | GENERAL | hospital-overview | 병원 소개 | §33 |
| 2 | GENERAL | operating-hours | 진료 시간 안내 | §40 |
| 3 | GENERAL | directions | 오시는 길 | - |
| 4 | GENERAL | visiting-hours | 면회 안내 | - |
| 5 | GENERAL | patient-rights | 환자 권리·의무 | §4 |
| 6 | GENERAL | emergency-guide | 응급실 이용 안내 | - |
| 7 | PARKING | parking-guide | 주차장 안내 | - |
| 8 | DINING | dining-cafeteria | 구내식당 "한우리" | - |
| 9 | DINING | dining-foodcourt | 푸드코트 | - |
| 10 | DINING | dining-cafe | 카페 메디치노 | - |
| 11 | DINING | dining-convenience | CU 편의점 | - |
| 12 | FUNERAL | funeral-guide | 장례식장 안내 | - |
| 13 | FACILITY | floor-b1~b3 | 지하층 시설 | - |
| 14 | FACILITY | floor-1 ~ floor-8 | 1~8층 시설 | - |
| 15 | FACILITY | floor-annex | 별관 시설 | - |
| 16~30 | DEPARTMENT | dept-im, dept-gs... | 각 진료과 소개 (15개) | §43 |
| 31~60+ | DOCTOR | doctor-xxx | 의사별 소개 | §42 |
| 61~70 | FAQ | faq-xxx | 자주 묻는 질문 10건 | - |

### 6.2 FAQ 예시

| # | 질문 | 답변 | 태그 |
|---|------|------|------|
| 1 | 진단서는 어디서 발급받나요? | 1층 원무과, 본인 신분증 필요, 수수료 3,000원 | 진단서, 발급, 서류 |
| 2 | 주차 무료 시간은? | 진료 환자 2시간 무료, 수납 시 확인 | 주차, 무료, 할인 |
| 3 | 보험 적용이 안 되는 항목은? | 비급여 항목은 원무과 안내, 홈페이지 비급여 목록 참조 | 보험, 비급여, 가격 |
| 4 | 예약 변경/취소 방법은? | 포털에서 직접 변경, 또는 02-1234-5678 전화 | 예약, 취소, 변경 |
| 5 | 야간/주말 진료 가능한가요? | 응급실 24시간, 토요일 09~13시, 일/공휴일 휴진 | 야간, 주말, 응급 |
| 6 | 건강검진 예약 방법은? | 포털 또는 전화 예약, 검진센터 1층 접수 | 검진, 예약, 건강검진 |
| 7 | 입원 시 준비물은? | 신분증, 보험카드, 세면도구, 편한 옷, 실내화 | 입원, 준비물 |
| 8 | 외래 진료 순서는? | 접수→대기→진료→검사→수납→약국 | 외래, 진료, 순서 |
| 9 | Wi-Fi 사용 가능한가요? | 전 층 무료 Wi-Fi (SSID: HospitalRUN-Guest) | 와이파이, 인터넷 |
| 10 | 장례식장 조화 보내는 방법은? | 장례식장 사무실(02-1234-5670) 또는 1층 접수 | 장례, 조화, 조문 |

---

## 7. AI 도우미 연동 상세

### 7.1 키워드 → 콘텐츠 매칭 로직

```typescript
async handleFacilityQuestion(input: string): Promise<Response | null> {
  // 1. 입력 키워드 추출
  const keywords = extractKeywords(input);
  
  // 2. HospitalInfoContent에서 tags 매칭
  const matches = await prisma.hospitalInfoContent.findMany({
    where: {
      isActive: true,
      tags: { hasSome: keywords },
    },
    orderBy: { sortOrder: 'asc' },
    take: 3,
  });
  
  // 3. 가장 관련도 높은 콘텐츠 선택
  const best = rankByRelevance(matches, keywords);
  
  // 4. metadata 기반 자연어 응답 생성
  return formatResponse(best);
}
```

### 7.2 카테고리별 응답 포매터

| 카테고리 | 포맷 | 예시 |
|----------|------|------|
| PARKING | 아이콘 + 요금표 + 안내 | 🅿️ 지하 B1~B3... |
| DINING | 메뉴 카드형 | 🍚 A코스 6,000원... |
| DEPARTMENT | 진료과 소개 + 의사 목록 | 🩺 내과: 순환기/호흡기... |
| DOCTOR | 프로필 카드 | 👨‍⚕️ 김내과 (순환기)... |
| FAQ | Q&A 형식 | Q: 진단서는? A: 1층 원무과... |
| FACILITY | 층별 목록 | 🏥 2층: 외래 진료실... |

---

## 8. 구현 우선순위

### Phase 1 (필수 — 1~2일)
1. `HospitalInfoContent` 모델 + 마이그레이션
2. CRUD API (관리자 + 공개)
3. 초기 시드 데이터 (20건)
4. AI 도우미 `handleFacilityQuestion()` DB 연동

### Phase 2 (의사 소개 — 1일)
5. `DoctorProfile` 모델 + API
6. 의사 소개 공개 페이지
7. 시드 데이터 (주요 의사 10명)

### Phase 3 (관리 UI — 1일)
8. `/admin/hospital-info` 관리 페이지
9. 콘텐츠 편집 모달 (카테고리별 폼)
10. 환자 포털에 시설 안내 탭 추가

### Phase 4 (고도화)
11. 이미지 업로드
12. 버전 이력 (변경 추적)
13. 다국어 지원 (영어/중국어)
14. 비급여 항목 관리 연동

---

## 9. 기대 효과

| Before | After |
|--------|-------|
| 정보 변경 시 코드 수정 + 배포 필요 | **관리자가 웹에서 즉시 수정** |
| AI 도우미 응답 고정 | **DB 변경 즉시 반영** |
| 의사 소개 없음 | **전문분야·경력·학력 공개** |
| FAQ 하드코딩 | **자주 묻는 질문 동적 관리** |
| 환자 정보 접근 제한적 | **포털에서 자유롭게 조회** |

---

## 10. 보완 사항

### 10.1 부서별 편집 권한

관리자(ADMIN) 전체 접근 외에, 부서별 편집 범위를 제한한다.

| 부서 | 편집 가능 카테고리 | 비고 |
|------|------------------|------|
| 급양과 | DINING | 식당 메뉴·운영시간 |
| 원무과 | GENERAL, PARKING, FAQ | 진료시간, 주차, 접수 안내 |
| 행정과 | FACILITY, FUNERAL | 시설 배치, 장례식장 |
| 의무기록과 | DEPARTMENT, DOCTOR | 진료과/의사 소개 (의료법 §42) |
| 홍보팀 | 전체 (열람) + GENERAL | 병원 소개, 오시는 길 |

→ `HospitalInfoContent`에 `editableDepts: String[]` 필드 추가 또는 기존 `access-control` 모듈 연동.

### 10.2 비급여 항목 관리 (의료법 §45 — 필수)

비급여 진료비는 법적 공개 의무 항목. 별도 카테고리 추가:

```
카테고리: NON_COVERED (비급여)
```

```json
// metadata
{
  "type": "procedure|material|room|other",
  "items": [
    { "name": "MRI (뇌)", "price": 500000, "note": "조영제 별도" },
    { "name": "상급 병실 (1인실)", "pricePerDay": 200000, "note": "일반 병실 대비 차액" },
    { "name": "제증명 (진단서)", "price": 3000, "note": "영문 5,000원" },
    { "name": "예방접종 (독감)", "price": 30000, "note": "65세 이상 무료" }
  ],
  "lastUpdated": "2026-05-22",
  "note": "의료법 제45조에 의거 공개"
}
```

→ 환자 포털에 **비급여 항목 목록** 페이지 필수 (검색·정렬 지원).

### 10.3 임시 공지 (계절·일시 변경)

정규 콘텐츠 외에 기간 한정 공지가 필요한 경우:

| 예시 | 기간 |
|------|------|
| 추석 연휴 진료 안내 | 9/15~9/18 |
| 주차장 B3 공사 안내 | 6/1~6/30 |
| 식당 임시 휴무 | 5/25 (하루) |
| 신규 의사 부임 안내 | 상시 |

→ `HospitalInfoContent`에 추가 필드:

```
publishFrom   DateTime?   // 게시 시작일 (null = 즉시)
publishUntil  DateTime?   // 게시 종료일 (null = 무기한)
isPinned      Boolean     // 상단 고정
```

AI 도우미가 기간 내 공지를 우선 응답:
```typescript
// 현재 유효한 공지 먼저 확인
const notices = await prisma.hospitalInfoContent.findMany({
  where: {
    isActive: true,
    publishFrom: { lte: now },
    OR: [{ publishUntil: null }, { publishUntil: { gte: now } }],
    isPinned: true,
  },
});
```

### 10.4 변경 이력 (Audit Trail)

의료법상 공개 정보 변경 시 추적 필요.

```
HospitalInfoAudit {
  id            UUID
  contentId     UUID → HospitalInfoContent
  action        String   // CREATE, UPDATE, DELETE, TOGGLE
  fieldChanged  String?  // "content", "metadata.price", "isActive"
  oldValue      Text?
  newValue      Text?
  changedBy     UUID → User
  changedAt     DateTime
  reason        String?  // 변경 사유
}
```

→ Phase 4에서 구현하되, **삭제는 soft-delete(isActive=false)로 기본 적용**.

### 10.5 AI 응답 Fallback 전략

DB에서 매칭되는 콘텐츠가 없을 때:

```
1순위: tags 완전 매칭 → 해당 content 응답
2순위: tags 부분 매칭 (1개 이상) → 상위 3건 요약 + "더 자세한 내용은..."
3순위: 카테고리 추론 (키워드→카테고리) → 카테고리 전체 목록
4순위: FAQ 검색 → 유사 질문 제안
5순위: 기본 응답 → "원무과(02-1234-5678)로 문의해주세요"
```

### 10.6 환자 포털 UI 통합

`/portal` 페이지에 새 탭/섹션 추가:

```
┌─────────────────────────────────────────┐
│  환자 포털                               │
│                                         │
│  [내 진료] [예약] [검사결과] [서류발급]    │
│  [병원안내] [의사소개] [비급여]           │  ← 추가
│                                         │
│  병원안내 탭:                             │
│  ├─ 시설 안내 (층별)                     │
│  ├─ 주차 안내                            │
│  ├─ 식당·편의시설                        │
│  ├─ 오시는 길 (지도 연동)                │
│  ├─ 진료시간                             │
│  └─ FAQ                                │
│                                         │
│  의사소개 탭:                             │
│  ├─ 진료과별 필터                        │
│  ├─ 의사 카드 (사진+전문분야+경력)       │
│  └─ 진료 일정 + 바로 예약                │
│                                         │
│  비급여 탭:                               │
│  ├─ 카테고리별 필터 (시술/재료/병실/기타) │
│  ├─ 검색                                │
│  └─ 가격 목록 (정렬 가능)               │
└─────────────────────────────────────────┘
```

### 10.7 DoctorProfile ↔ ClinicSchedule 연동

의사 소개에서 **진료 일정 확인 + 바로 예약** 연결:

```
DoctorProfile
  ├─ userId → User → ClinicSchedule (진료 요일/시간대)
  │                 → ClinicClosure (휴진일)
  └─ scheduleNote   // 텍스트 보충 ("화·목 오후 수술")

환자 포털 흐름:
  의사 상세 → [이 의사에게 예약] → /booking?doctorId=xxx
```

### 10.8 SystemConfig 중복 방지

기존 `SystemConfig`에 이미 있는 데이터(`hospital.name`, `hospital.phone` 등)와 `HospitalInfoContent`가 중복되지 않도록:

| 데이터 | 마스터 | 참조 |
|--------|--------|------|
| 병원명, 주소, 전화 | **SystemConfig** | HospitalInfoContent가 조회 시 참조 |
| 진료시간 | **SystemConfig** | AI 포매터가 config에서 읽어 응답 생성 |
| 주차 상세, 식당 메뉴 등 | **HospitalInfoContent** | 신규 |
| 의사 기본정보 | **User 모델** | DoctorProfile이 확장 |

→ `HospitalInfoContent`의 `content` 필드에서 `{{hospital.phone}}` 같은 **변수 치환** 지원:
```
"대표전화: {{config:hospital.phone}}"
→ 렌더링: "대표전화: 02-1234-5678"
```

### 10.9 접근 통계 (Analytics)

어떤 정보를 환자가 가장 많이 조회하는지 추적:

```
HospitalInfoView {
  id          UUID
  contentId   UUID → HospitalInfoContent
  channel     String  // PORTAL, AI_CHAT, PUBLIC_API
  viewedAt    DateTime
  sessionId   String? // AI 세션 ID (연관 분석용)
}
```

→ 관리자 대시보드에서 **인기 콘텐츠 Top 10**, **AI 미응답 키워드** 분석.

### 10.10 수정된 모델 (최종)

```
HospitalInfoContent {
  id            UUID      PK
  category      String    // FACILITY, DEPARTMENT, DOCTOR, PARKING, DINING,
                          // FUNERAL, GENERAL, FAQ, NON_COVERED ← 추가
  slug          String    // unique 식별자
  title         String
  content       Text      // 본문 ({{config:key}} 변수 치환 지원)
  metadata      JSON      // 카테고리별 구조화 데이터
  sortOrder     Int
  isActive      Boolean   @default(true)
  imageUrl      String?
  tags          String[]  // AI 매칭용 키워드

  // 게시 기간 (임시 공지용)
  publishFrom   DateTime? // null = 즉시
  publishUntil  DateTime? // null = 무기한
  isPinned      Boolean   @default(false)

  // 편집 권한
  editableDepts String[]  @default([]) // 빈 배열 = ADMIN만

  // 감사
  createdBy     UUID
  updatedBy     UUID?
  createdAt     DateTime
  updatedAt     DateTime

  @@unique([category, slug])
  @@index([category, isActive])
  @@index([publishFrom, publishUntil])
}
```

---

## 11. 수정된 구현 우선순위

### Phase 1 (필수 — 2일)
1. `HospitalInfoContent` 모델 (최종 버전, publishFrom/Until 포함)
2. `DoctorProfile` 모델
3. 관리자 CRUD API + 공개 API
4. 초기 시드 데이터 (30건 + 비급여 10건 + FAQ 10건)
5. AI 도우미 `handleFacilityQuestion()` DB 연동

### Phase 2 (환자 접점 — 1일)
6. 환자 포털 탭 추가 (병원안내/의사소개/비급여)
7. 의사 소개 공개 페이지 + 예약 연결
8. 비급여 항목 목록 페이지

### Phase 3 (관리 UI — 1일)
9. `/admin/hospital-info` 관리 페이지
10. 콘텐츠 편집 모달 (카테고리별 폼)
11. 부서별 편집 권한
12. 임시 공지 관리

### Phase 4 (고도화 — 추후)
13. 변경 이력 (HospitalInfoAudit)
14. 접근 통계 (HospitalInfoView)
15. 이미지 업로드
16. 다국어 지원
17. {{config:key}} 변수 치환 엔진

---

## 부록: 의료법 관련 조항

### 의료법 제42조 (의료인 공개사항)
> 의료기관의 장은 환자가 요청하는 경우 진료를 담당하는 의료인의 면허종별, 전문과목 등을 안내하여야 한다.

### 의료법 제45조 (비급여 진료비)
> 의료기관은 비급여 항목과 그 비용을 환자가 알 수 있도록 원내 게시하여야 한다.

### 의료법 시행규칙 제40조 (시설 정보)
> 의료기관은 시설, 인력, 장비 등에 관한 현황 정보를 공개하여야 한다.
