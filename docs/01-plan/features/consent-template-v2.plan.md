# 동의서 템플릿 관리 v2 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/src/modules/consent-template/consent-template.controller.ts:72 · apps/api/src/modules/consent-template/consent-template.service.ts:106 · 잔여: 없음

## 현재 문제점

| 항목 | 현황 | 문제 |
|------|------|------|
| 템플릿 생성 | JSON 직접 입력 | 비개발자가 사용 불가능 |
| 섹션 편집 | 없음 | 설명문/서명란/체크박스 등 시각적 편집 불가 |
| 미리보기 | 없음 | 실제 출력물 확인 불가 |
| 버전 관리 | version 필드만 존재 | 이전 버전 이력/비교 없음 |
| 템플릿 수정/삭제 | API만 존재, UI 없음 | 생성만 가능 |
| 필수항목 설정 | JSON 배열 직접 입력 | 직관적이지 않음 |
| 복제 | 없음 | 유사 템플릿 재활용 불가 |
| 카테고리 | 8개 고정 | 병원별 커스텀 유형 추가 불가 |

## 목표

관리자가 **코딩 없이** 동의서 템플릿을 시각적으로 설계·편집·미리보기·버전관리할 수 있는 세련된 관리 도구

## 기능 정의

### 1. 시각적 템플릿 빌더 (Visual Template Builder)

```
┌──────────────────────────────────────────────────────┐
│  동의서 템플릿 편집기                    [미리보기] [저장]  │
├──────────┬───────────────────────────────────────────┤
│ 컴포넌트  │                                           │
│          │  ┌─────────────────────────────────────┐   │
│ ☐ 제목    │  │  [수술 동의서]           v2.1        │   │
│ ☐ 설명문  │  │                                     │   │
│ ☐ 구분선  │  │  § 수술 정보                         │   │
│ ☐ 입력필드 │  │  ┌─ 수술명: [____________]          │   │
│ ☐ 체크박스 │  │  ├─ 수술일: [____-__-__]           │   │
│ ☐ 서명란  │  │  └─ 집도의: [____________]          │   │
│ ☐ 날짜    │  │                                     │   │
│ ☐ 테이블  │  │  § 설명 사항                         │   │
│ ☐ 이미지  │  │  ┌─ 합병증 설명 ▾                   │   │
│           │  │  │  [여러 줄 텍스트 영역]            │   │
│           │  │  └─ ☑ 필수항목                      │   │
│           │  │                                     │   │
│           │  │  § 환자 확인                         │   │
│           │  │  ☐ 설명을 충분히 들었습니다          │   │
│           │  │  ☐ 질문할 기회가 주어졌습니다        │   │
│           │  │  ☐ 동의 거부 시 불이익이 없음을 인지 │   │
│           │  │                                     │   │
│           │  │  [환자 서명란]  [보호자 서명란]       │   │
│           │  │  [설명 의사 서명란]                   │   │
│           │  └─────────────────────────────────────┘   │
└──────────┴───────────────────────────────────────────┘
```

**컴포넌트 유형:**

| 컴포넌트 | 설명 | 속성 |
|----------|------|------|
| heading | 섹션 제목 | text, level(h2/h3) |
| paragraph | 설명문 (리치텍스트) | html, variables[] |
| divider | 구분선 | style(solid/dashed) |
| text_input | 텍스트 입력 | label, placeholder, required, mappedField |
| textarea | 여러 줄 입력 | label, rows, required |
| date_input | 날짜 입력 | label, required |
| checkbox | 체크박스 | label, required |
| checkbox_group | 체크박스 그룹 | label, options[], minRequired |
| radio_group | 라디오 그룹 | label, options[], required |
| signature | 서명란 | label, role(patient/guardian/doctor/witness) |
| table | 테이블 | columns[], rows(dynamic/fixed) |
| image | 이미지/도해 | src, caption, alt |
| spacer | 여백 | height |

### 2. 드래그 앤 드롭 섹션 관리

- 왼쪽 팔레트에서 컴포넌트를 드래그하여 캔버스에 배치
- 캔버스 내 컴포넌트 순서 드래그로 변경
- 각 컴포넌트 클릭 시 우측에 속성 편집 패널 표시
- 섹션(§) 단위로 그룹핑, 접기/펼치기

### 3. 실시간 미리보기

- 편집기 옆 또는 전체화면으로 PDF 스타일 미리보기
- A4 용지 비율 렌더링
- 병원 로고/헤더 자동 삽입
- 인쇄 미리보기 모드

### 4. 버전 관리

| 기능 | 설명 |
|------|------|
| 자동 버전 증가 | 저장 시 마이너 버전 자동 증가 (1.0 → 1.1) |
| 메이저 버전 | 관리자가 수동으로 메이저 업 (1.x → 2.0) |
| 버전 이력 | 모든 버전 목록, 날짜, 수정자, 변경 요약 |
| 버전 비교 | 두 버전 간 diff 표시 (추가/삭제/변경된 항목) |
| 버전 복원 | 이전 버전을 현재 버전으로 복원 |
| 활성 버전 | 버전별로 활성/비활성 토글 |

### 5. 템플릿 목록 개선

```
┌───────────────────────────────────────────────────────────────┐
│  동의서 템플릿 관리                              [+ 새 템플릿] │
├───────────────────────────────────────────────────────────────┤
│  🔍 검색...        [유형 ▾]  [상태 ▾]  [정렬: 최신순 ▾]       │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ 📋 수술 동의서                                          │  │
│  │ 수술  v2.1  ● 활성   사용 47건   최종수정 2026-05-10     │  │
│  │                                                         │  │
│  │ 수술명, 합병증, 대안적 치료법, 마취, 수혈 동의 포함       │  │
│  │                                                         │  │
│  │ [편집]  [복제]  [미리보기]  [버전이력]  [⋮ 더보기]        │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ 📋 마취 동의서                                          │  │
│  │ 마취  v1.3  ● 활성   사용 32건   최종수정 2026-05-08     │  │
│  │                                                         │  │
│  │ 마취 방법 선택, 위험요인, 부작용, 금식 안내              │  │
│  │                                                         │  │
│  │ [편집]  [복제]  [미리보기]  [버전이력]  [⋮ 더보기]        │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

**추가 기능:**
- 사용 건수 표시 (해당 템플릿으로 생성된 동의서 수)
- 최종 수정일/수정자
- 설명(description) 필드 추가
- 검색 (이름/유형)
- 더보기 메뉴: 비활성화, 삭제, 내보내기(JSON), 가져오기

### 6. 템플릿 복제

- 기존 템플릿을 기반으로 새 템플릿 생성
- 이름에 "(사본)" 자동 추가
- 복제 후 편집기로 바로 이동

### 7. 변수 시스템 (Template Variables)

동의서 내 동적 값을 자동 채움:

| 변수 | 설명 | 예시 |
|------|------|------|
| `{{patient.name}}` | 환자 성명 | 김영수 |
| `{{patient.birthDate}}` | 생년월일 | 1958-03-15 |
| `{{patient.mrn}}` | 등록번호 | P2026-0001 |
| `{{doctor.name}}` | 담당의 | 이외과 |
| `{{doctor.license}}` | 면허번호 | 의-12345 |
| `{{hospital.name}}` | 병원명 | Hospital RUN |
| `{{today}}` | 오늘 날짜 | 2026-05-14 |
| `{{surgery.name}}` | 수술명 | 복강경 담낭절제술 |
| `{{surgery.date}}` | 수술일 | 2026-05-20 |

### 8. 법적 요구사항 체크리스트

템플릿 생성/저장 시 자동 검증:

- [ ] 환자 서명란 포함 여부
- [ ] 설명 의사 서명란 포함 여부
- [ ] 날짜 필드 포함 여부
- [ ] 필수 설명 항목 (합병증, 대안, 거부 시 불이익) 포함 여부
- [ ] 환자 확인 체크박스 (설명 청취, 질문 기회, 자발적 동의) 포함 여부

미충족 시 경고 표시 (저장은 가능하되 경고)

## DB 스키마 변경

```prisma
model ConsentTemplate {
  // 기존 필드 유지
  id             String   @id @default(uuid()) @db.Uuid
  type           String   @db.VarChar(50)
  name           String   @unique @db.VarChar(200)
  version        String   @db.VarChar(20)
  content        Json     @db.JsonB       // 컴포넌트 배열
  requiredFields Json?    @db.JsonB

  // 추가 필드
  description    String?  @db.VarChar(500)
  components     Json?    @db.JsonB       // 시각적 빌더 컴포넌트 배열
  variables      Json?    @db.JsonB       // 사용된 변수 목록
  legalChecks    Json?    @db.JsonB       // 법적 요구사항 충족 여부
  thumbnail      String?  @db.Text        // 미리보기 썸네일 (base64 또는 URL)
  usageCount     Int      @default(0)
  lastEditedBy   String?  @db.Uuid
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  // 버전 관리
  parentId       String?  @db.Uuid        // 이전 버전 참조
  isLatest       Boolean  @default(true)
  changeLog      String?  @db.Text        // 변경 내역
}
```

## API 추가/수정

| Method | Endpoint | 설명 |
|--------|----------|------|
| PUT | /api/v1/consent-templates/:id | 템플릿 수정 |
| POST | /api/v1/consent-templates/:id/clone | 템플릿 복제 |
| GET | /api/v1/consent-templates/:id/versions | 버전 이력 |
| POST | /api/v1/consent-templates/:id/restore | 버전 복원 |
| PATCH | /api/v1/consent-templates/:id/toggle | 활성/비활성 토글 |
| DELETE | /api/v1/consent-templates/:id | 삭제 (soft) |
| GET | /api/v1/consent-templates/:id/preview | HTML 미리보기 |
| POST | /api/v1/consent-templates/import | JSON 가져오기 |
| GET | /api/v1/consent-templates/:id/export | JSON 내보내기 |
| POST | /api/v1/consent-templates/:id/validate | 법적 요구사항 검증 |

## 구현 우선순위

| Phase | 항목 | 난이도 |
|-------|------|--------|
| 1 | 템플릿 목록 개선 (검색, 사용건수, 더보기 메뉴) | 낮음 |
| 1 | 템플릿 수정/삭제/복제 API + UI | 낮음 |
| 1 | 설명(description) 필드 추가 | 낮음 |
| 2 | 시각적 템플릿 빌더 (컴포넌트 기반) | 높음 |
| 2 | 드래그 앤 드롭 섹션 관리 | 중간 |
| 2 | 컴포넌트 속성 편집 패널 | 중간 |
| 3 | 실시간 미리보기 (A4 렌더링) | 중간 |
| 3 | 변수 시스템 | 중간 |
| 3 | 법적 요구사항 자동 검증 | 낮음 |
| 4 | 버전 관리 (이력/비교/복원) | 중간 |
| 4 | JSON 가져오기/내보내기 | 낮음 |

## 참고

- 기존 JSON 기반 content 구조는 하위호환 유지
- 새 `components` 필드로 시각적 빌더 데이터 저장
- components가 없으면 기존 content를 fallback으로 사용
