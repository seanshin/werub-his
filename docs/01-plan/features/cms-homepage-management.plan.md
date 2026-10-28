# CMS 홈페이지 관리 고도화 기획서 v1.1

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/prisma/schema.prisma:8194 model HomepagePopup · apps/api/prisma/schema.prisma:8134 model HospitalInfoContent · apps/api/src/modules/hospital-info/hospital-info.controller.ts:139 · 잔여: 없음

> **작성일**: 2026-05-28
> **수정일**: 2026-05-28 (v1.1 — 카테고리/메뉴 동적 관리 추가)
> **우선순위**: 높음
> **현재 상태**: 병원 정보(CMS) 단일 메뉴 → 홈페이지 관리 분리 + 기능 확장

---

## 1. 개요

### 1.1 목적
현재 `병원 정보(CMS)` 메뉴에 158건의 콘텐츠가 혼재되어 관리 효율이 낮음. **홈페이지 관리**를 별도 카테고리로 분리하고, 공지사항 팝업, 배너 관리, 메뉴 편집, 페이지 미리보기 등 홈페이지 운영에 필요한 기능을 추가.

### 1.2 현재 문제

| 문제 | 설명 |
|------|------|
| **혼재** | 진료과(22), 센터(20), 뉴스(10), 건강정보(10), 갤러리(31), FAQ(10) 등이 한 화면에 158건 |
| **카테고리 구분 부족** | 탭 필터만 제공, 하위 그룹핑 없음 |
| **팝업 관리 없음** | 공지사항 팝업을 코드에서 직접 관리 |
| **배너 관리 미흡** | 배너 3건이 CMS에 있지만, 이미지 업로드/순서/기간 관리 불가 |
| **미리보기 없음** | 콘텐츠 수정 후 홈페이지 반영 결과를 확인할 수 없음 |
| **예약 스케줄** | 공지사항/배너의 노출 시작/종료일 설정 불가 |
| **이미지 관리** | 이미지 URL 직접 입력, 파일 업로드 UI 없음 |

### 1.3 TO-BE

```
┌─ 사이드바 메뉴 ─────────────────────────────────┐
│                                                  │
│  관리자                                           │
│  ├─ 직원 관리                                     │
│  ├─ ...                                          │
│  ├─ 병원 정보(CMS)  ← 기존 (내부 정보만)           │
│  │   ├─ 일반안내 (인사말/연혁/조직도)               │
│  │   ├─ 시설 안내                                 │
│  │   ├─ 비급여 항목                                │
│  │   └─ FAQ                                      │
│  │                                               │
│  ├─ 홈페이지 관리  ← [신규 메뉴]                   │
│  │   ├─ 📢 공지/팝업 관리                          │
│  │   ├─ 🖼️ 배너 관리                              │
│  │   ├─ 📰 뉴스/소식                              │
│  │   ├─ 🏥 진료과 소개                             │
│  │   ├─ 🔬 전문센터 소개                           │
│  │   ├─ 👨‍⚕️ 의료진 프로필                          │
│  │   ├─ 📸 갤러리                                 │
│  │   ├─ 💚 사회공헌                               │
│  │   ├─ 🎬 건강TV                                 │
│  │   ├─ 📋 건강정보                               │
│  │   ├─ 💼 채용정보                               │
│  │   └─ 🔍 SEO/메타데이터                         │
│  │                                               │
│  └─ ...                                          │
└──────────────────────────────────────────────────┘
```

---

## 2. 신규 기능 상세

### 2.1 공지사항/팝업 관리

#### 2.1.1 공지 유형

| 유형 | 위치 | 설명 |
|------|------|------|
| **띠배너** | 홈페이지 최상단 | 한 줄 텍스트 + 링크 (현재 구현됨, CMS 연동) |
| **팝업** | 홈페이지 진입 시 모달 | 이미지 + 텍스트 + 링크 (신규) |
| **플로팅 배너** | 우측 하단 | 작은 카드형 배너 (신규) |
| **페이지 내 공지** | 특정 페이지 상단 | 페이지별 안내 배너 (신규) |

#### 2.1.2 팝업 관리 UI

```
┌─ 팝업 관리 ──────────────────────────────────────┐
│                                                  │
│ [+ 새 팝업 추가]                                  │
│                                                  │
│ ┌────────────────────────────────────────────┐   │
│ │ 📢 여름 진료시간 변경 안내          [활성] 🟢  │   │
│ │                                            │   │
│ │ 유형: 팝업 모달                              │   │
│ │ 기간: 2026-07-01 ~ 2026-08-31              │   │
│ │ 대상: 전체 방문자                             │   │
│ │ "오늘 하루 안 보기" 옵션: ☑                   │   │
│ │                                            │   │
│ │ [미리보기] [편집] [비활성화] [삭제]             │   │
│ └────────────────────────────────────────────┘   │
│                                                  │
│ ┌────────────────────────────────────────────┐   │
│ │ 🎉 건강 페스티벌 안내              [예약] 🟡  │   │
│ │                                            │   │
│ │ 유형: 팝업 모달                              │   │
│ │ 기간: 2026-07-10 ~ 2026-07-15              │   │
│ │ 이미지: festival-popup.png                   │   │
│ │                                            │   │
│ │ [미리보기] [편집] [비활성화] [삭제]             │   │
│ └────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

#### 2.1.3 팝업 데이터 모델

```prisma
model HomepagePopup {
  id          String    @id @default(uuid()) @db.Uuid
  title       String    @db.VarChar(200)
  type        String    @db.VarChar(20) // MODAL, STRIP, FLOATING, PAGE_BANNER
  content     String?   @db.Text
  imageUrl    String?   @map("image_url") @db.VarChar(500)
  linkUrl     String?   @map("link_url") @db.VarChar(500)
  linkText    String?   @map("link_text") @db.VarChar(100)
  targetPages String[]  @map("target_pages") // ['/home', '/checkup'] or ['*']
  startDate   DateTime  @map("start_date") @db.Timestamptz()
  endDate     DateTime  @map("end_date") @db.Timestamptz()
  isActive    Boolean   @default(true) @map("is_active")
  hideToday   Boolean   @default(true) @map("hide_today") // "오늘 하루 안 보기"
  sortOrder   Int       @default(0) @map("sort_order")
  createdBy   String    @map("created_by") @db.Uuid
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz()

  @@index([isActive, startDate, endDate])
  @@map("homepage_popups")
}
```

### 2.2 배너 관리

#### 2.2.1 배너 유형

| 유형 | 위치 | 현재 | TO-BE |
|------|------|:----:|:-----:|
| **히어로 배너** | 메인 이미지 그리드 | 코드 하드코딩 | CMS 관리 |
| **띠배너** | 최상단 | CMS (isPinned) | 전용 UI |
| **중간 배너** | 섹션 사이 | 없음 | CMS 추가 |
| **사이드 배너** | 서브페이지 우측 | 없음 | CMS 추가 |

#### 2.2.2 배너 편집 UI

```
┌─ 배너 편집 ──────────────────────────────────────┐
│                                                  │
│ 제목: [여름 진료시간 변경 안내              ]      │
│                                                  │
│ 유형: [히어로 ▼]  위치: [메인 슬라이더 ▼]          │
│                                                  │
│ ┌─ 이미지 업로드 ──────────────────────────┐      │
│ │                                          │      │
│ │  [이미지 드래그 또는 클릭하여 업로드]       │      │
│ │                                          │      │
│ │  권장 크기: 1920×800px                    │      │
│ │  최대 용량: 5MB                           │      │
│ │  형식: JPG, PNG, WebP                     │      │
│ └──────────────────────────────────────────┘      │
│                                                  │
│ 링크 URL: [/checkup                        ]      │
│ 링크 텍스트: [검진 프로그램 보기             ]      │
│                                                  │
│ 배경색: [#047857    ] 🎨                          │
│ 텍스트색: [#ffffff   ] 🎨                          │
│                                                  │
│ 노출 기간                                         │
│ 시작: [2026-07-01] ~ 종료: [2026-08-31]           │
│ ☑ 기간 무제한                                     │
│                                                  │
│ 표시 순서: [1 ▲▼]                                 │
│ 상태: ○ 활성  ○ 비활성  ○ 예약                     │
│                                                  │
│ [미리보기]        [취소]  [저장]                    │
└──────────────────────────────────────────────────┘
```

### 2.3 콘텐츠 에디터 개선

#### 2.3.1 리치 텍스트 에디터

현재 `<textarea>`만 제공 → WYSIWYG 에디터로 교체:

| 기능 | 현재 | TO-BE |
|------|:----:|:-----:|
| 볼드/이탤릭/밑줄 | ❌ | ✅ |
| 제목 (H1~H3) | ❌ | ✅ |
| 리스트 (번호/점) | ❌ | ✅ |
| 이미지 삽입 | URL 수동 | ✅ 드래그 업로드 |
| 테이블 | ❌ | ✅ |
| 링크 삽입 | ❌ | ✅ |
| HTML 직접 편집 | ❌ | ✅ (토글) |
| 미리보기 | ❌ | ✅ 실시간 |

**추천 라이브러리**: Tiptap (React, 가벼움, 확장성)

#### 2.3.2 이미지 관리

```
┌─ 이미지 관리 ─────────────────────────────────────┐
│                                                   │
│ 📁 미디어 라이브러리                               │
│                                                   │
│ [📤 업로드] [📁 폴더 생성]      검색: [         🔍]│
│                                                   │
│ 폴더: 전체 > 배너 > 2026                          │
│                                                   │
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐        │
│ │     │ │     │ │     │ │     │ │     │        │
│ │ img │ │ img │ │ img │ │ img │ │ img │        │
│ │     │ │     │ │     │ │     │ │     │        │
│ ├─────┤ ├─────┤ ├─────┤ ├─────┤ ├─────┤        │
│ │hero │ │hero │ │hero │ │ban..│ │fac..│        │
│ │-001 │ │-002 │ │-003 │ │ner │ │ili │        │
│ │2.1MB│ │1.8MB│ │946K │ │4.4M│ │1.2M│        │
│ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘        │
│                                                   │
│ 사용량: 46MB / 500MB                               │
└───────────────────────────────────────────────────┘
```

### 2.4 예약 게시 (스케줄 발행)

모든 CMS 콘텐츠에 적용:

```typescript
interface PublishSchedule {
  publishAt?: Date;    // 자동 게시 시작
  unpublishAt?: Date;  // 자동 게시 종료
  status: 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'ARCHIVED';
}
```

| 상태 | 설명 |
|------|------|
| DRAFT | 작성 중 (미공개) |
| SCHEDULED | 예약 발행 (시작일 대기) |
| PUBLISHED | 공개 중 |
| ARCHIVED | 보관 (비공개) |

### 2.5 미리보기

```
┌─ 콘텐츠 편집 ─────────────────────────────────────┐
│                                                   │
│ [편집] [미리보기] [이력]                            │
│                                                   │
│ ┌─────────────────┬───────────────────────────┐   │
│ │                 │                           │   │
│ │  편집 영역       │   실시간 미리보기          │   │
│ │                 │                           │   │
│ │  제목: [...]     │   ┌─────────────────────┐│   │
│ │  내용: [...]     │   │ 홈페이지에 표시될    ││   │
│ │                 │   │ 실제 모습            ││   │
│ │                 │   │                     ││   │
│ │                 │   └─────────────────────┘│   │
│ └─────────────────┴───────────────────────────┘   │
│                                                   │
│ 기기: [🖥 데스크톱] [📱 모바일] [📱 태블릿]         │
└───────────────────────────────────────────────────┘
```

### 2.6 콘텐츠 이력 관리

```
┌─ 수정 이력 ───────────────────────────────────────┐
│                                                   │
│ 📋 "여름 진료시간 변경 안내" 수정 이력              │
│                                                   │
│ v3  2026-05-28 10:15  관리자  — 내용 수정           │
│ v2  2026-05-27 14:30  관리자  — 이미지 추가          │
│ v1  2026-05-27 09:00  관리자  — 최초 작성            │
│                                                   │
│ [v3과 v2 비교]  [v2로 되돌리기]                     │
└───────────────────────────────────────────────────┘
```

---

## 3. 데이터 모델 변경

### 3.1 기존 모델 확장

```prisma
model HospitalInfoContent {
  // 기존 필드 유지 +
  status       String    @default("PUBLISHED") @db.VarChar(20) // DRAFT, SCHEDULED, PUBLISHED, ARCHIVED
  publishAt    DateTime? @map("publish_at") @db.Timestamptz()
  unpublishAt  DateTime? @map("unpublish_at") @db.Timestamptz()
  viewCount    Int       @default(0) @map("view_count")
  // revision 관리는 별도 테이블
}

model HospitalInfoRevision {
  id          String   @id @default(uuid()) @db.Uuid
  contentId   String   @map("content_id") @db.Uuid
  title       String   @db.VarChar(200)
  content     String   @db.Text
  metadata    Json?    @db.JsonB
  imageUrl    String?  @map("image_url") @db.VarChar(500)
  version     Int
  changedBy   String   @map("changed_by") @db.Uuid
  changedAt   DateTime @default(now()) @map("changed_at") @db.Timestamptz()
  changeNote  String?  @map("change_note") @db.VarChar(200)

  content_ref HospitalInfoContent @relation(fields: [contentId], references: [id], onDelete: Cascade)

  @@index([contentId, version])
  @@map("hospital_info_revisions")
}
```

### 3.2 신규 모델

```prisma
// 팝업 (위 2.1.3 참고)
model HomepagePopup { ... }

// 미디어 라이브러리
model MediaFile {
  id          String   @id @default(uuid()) @db.Uuid
  fileName    String   @map("file_name") @db.VarChar(255)
  originalName String  @map("original_name") @db.VarChar(255)
  mimeType    String   @map("mime_type") @db.VarChar(50)
  fileSize    Int      @map("file_size") // bytes
  url         String   @db.VarChar(500)
  folder      String   @default("/") @db.VarChar(200)
  width       Int?     // 이미지 너비
  height      Int?     // 이미지 높이
  alt         String?  @db.VarChar(200)
  uploadedBy  String   @map("uploaded_by") @db.Uuid
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz()

  @@index([folder])
  @@map("media_files")
}
```

---

## 4. API 설계

### 4.1 홈페이지 관리 API

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | `/api/v1/homepage/popups` | 팝업 목록 | ADMIN |
| POST | `/api/v1/homepage/popups` | 팝업 생성 | ADMIN |
| PATCH | `/api/v1/homepage/popups/:id` | 팝업 수정 | ADMIN |
| DELETE | `/api/v1/homepage/popups/:id` | 팝업 삭제 | ADMIN |
| GET | `/api/v1/public/popups/active` | 활성 팝업 (공개) | ALL |
| POST | `/api/v1/homepage/media/upload` | 이미지 업로드 | ADMIN |
| GET | `/api/v1/homepage/media` | 미디어 목록 | ADMIN |
| DELETE | `/api/v1/homepage/media/:id` | 미디어 삭제 | ADMIN |
| GET | `/api/v1/homepage/content/:id/revisions` | 수정 이력 | ADMIN |
| POST | `/api/v1/homepage/content/:id/revert/:version` | 이전 버전 복원 | ADMIN |
| POST | `/api/v1/homepage/content/:id/preview` | 미리보기 생성 | ADMIN |

### 4.2 기존 API 확장

| API | 확장 내용 |
|-----|----------|
| `GET /public/hospital-info` | `status=PUBLISHED` + 날짜 범위 필터 자동 적용 |
| `POST /hospital-info` | revision 자동 생성 + status/publishAt 지원 |
| `PATCH /hospital-info/:id` | revision 자동 생성 |

---

## 5. FE 페이지 구조

### 5.1 사이드바 메뉴 변경

```
관리자
├─ ... (기존 메뉴)
├─ 병원 정보(CMS)          ← 기존 유지 (내부 정보)
│   └─ 일반안내/시설/비급여/FAQ
│
├─ 홈페이지 관리            ← [신규]
│   ├─ /admin/homepage                  대시보드 (통계 + 빠른 편집)
│   ├─ /admin/homepage/popups           공지/팝업 관리
│   ├─ /admin/homepage/banners          배너 관리
│   ├─ /admin/homepage/news             뉴스/소식
│   ├─ /admin/homepage/departments      진료과 소개
│   ├─ /admin/homepage/centers          전문센터 소개
│   ├─ /admin/homepage/doctors          의료진 프로필
│   ├─ /admin/homepage/gallery          갤러리
│   ├─ /admin/homepage/csr              사회공헌
│   ├─ /admin/homepage/health-tv        건강TV
│   ├─ /admin/homepage/health-info      건강정보
│   ├─ /admin/homepage/recruit          채용정보
│   ├─ /admin/homepage/media            미디어 라이브러리
│   └─ /admin/homepage/seo              SEO/메타데이터
```

### 5.2 홈페이지 관리 대시보드

```
┌─ 홈페이지 관리 대시보드 ──────────────────────────┐
│                                                  │
│ 📊 오늘 홈페이지 현황                              │
│                                                  │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │
│ │ 158  │ │  3   │ │  2   │ │ 1.2K │ │  5   │   │
│ │ 콘텐츠│ │활성팝업│ │예약발행│ │오늘조회│ │미디어GB│   │
│ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘   │
│                                                  │
│ 📋 최근 수정                    🔔 예약 발행 대기  │
│ ┌──────────────────────┐ ┌──────────────────┐   │
│ │ 여름 진료시간 (배너)   │ │ 건강페스티벌 팝업  │   │
│ │ 10분 전 · 관리자      │ │ 7/10 자동 게시    │   │
│ │                      │ │                  │   │
│ │ 세포치료센터 (센터)    │ │ 가을 채용 공고    │   │
│ │ 1시간 전 · 관리자     │ │ 9/1 자동 게시     │   │
│ └──────────────────────┘ └──────────────────┘   │
│                                                  │
│ 🔗 빠른 편집                                      │
│ [배너 관리] [팝업 관리] [뉴스 작성] [갤러리 추가]    │
└──────────────────────────────────────────────────┘
```

---

## 6. 구현 우선순위

| Phase | 작업 | 예상 |
|:-----:|------|:----:|
| **1** | 사이드바 "홈페이지 관리" 메뉴 분리 + 대시보드 | 0.5일 |
| **2** | 팝업 관리 (CRUD + 프론트 렌더링) | 1.5일 |
| **3** | 배너 관리 (이미지 업로드 + 순서/기간) | 1일 |
| **4** | 예약 발행 (status + publishAt/unpublishAt) | 1일 |
| **5** | 미디어 라이브러리 (업로드 + 폴더 + 검색) | 1.5일 |
| **6** | 리치 텍스트 에디터 (Tiptap) | 1.5일 |
| **7** | 콘텐츠 이력/버전 관리 | 1일 |
| **8** | 미리보기 (데스크톱/모바일) | 0.5일 |
| **9** | SEO 메타데이터 편집기 | 0.5일 |
| | **합계** | **9일** |

---

## 7. 홈페이지 팝업 프론트 렌더링

### 7.1 팝업 모달

```
┌─ 팝업 모달 ──────────────────────────────────────┐
│                                               ✕  │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │                                          │    │
│  │         [팝업 이미지]                     │    │
│  │                                          │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  여름 진료시간 변경 안내                           │
│                                                  │
│  7~8월 평일 진료시간이 08:30~17:30으로             │
│  변경됩니다.                                      │
│                                                  │
│  [자세히 보기]                                    │
│                                                  │
│  ☐ 오늘 하루 안 보기                              │
│                                                  │
└──────────────────────────────────────────────────┘
```

### 7.2 홈페이지 레이아웃 통합

```typescript
// (homepage)/layout.tsx에 팝업 렌더러 추가
<GNB />
<PopupRenderer /> {/* 활성 팝업 자동 표시 */}
<main>{children}</main>
<Footer />
```

---

## 8. 권한 설계

| 역할 | 홈페이지 관리 | 병원 정보(CMS) |
|------|:-----------:|:------------:|
| ADMIN | ✅ 전체 | ✅ 전체 |
| DOCTOR | ❌ | ❌ |
| NURSE | ❌ | ❌ |

> 향후 확장: `EDITOR` 역할 추가 → 홈페이지 관리만 허용 (CTO/홍보팀)

---

---

## 9. 카테고리 동적 관리 (v1.1 추가)

### 9.1 현재 문제

| 문제 | 설명 |
|------|------|
| **카테고리 하드코딩** | DEPARTMENT, CENTER, NEWS 등이 코드에 고정 |
| **카테고리 추가 불가** | 새 카테고리(예: "진료후기", "의료장비") 추가 시 개발자 수정 필요 |
| **표시 순서 고정** | 카테고리 순서를 관리자가 변경 불가 |
| **아이콘/색상 변경 불가** | 카테고리별 아이콘/색상이 코드에 하드코딩 |

### 9.2 카테고리 관리 UI

```
┌─ 카테고리 관리 ──────────────────────────────────┐
│                                                  │
│ [+ 새 카테고리 추가]                               │
│                                                  │
│ ≡ 1. 진료과 (DEPARTMENT)          22건  [편집] ⋮  │
│ ≡ 2. 전문센터 (CENTER)            20건  [편집] ⋮  │
│ ≡ 3. 뉴스/소식 (NEWS)            10건  [편집] ⋮  │
│ ≡ 4. 건강정보 (HEALTH_INFO)      10건  [편집] ⋮  │
│ ≡ 5. 건강TV (HEALTH_VIDEO)        6건  [편집] ⋮  │
│ ≡ 6. 건강검진 (CHECKUP_INFO)      6건  [편집] ⋮  │
│ ≡ 7. 갤러리 (GALLERY)            31건  [편집] ⋮  │
│ ≡ 8. 사회공헌 (CSR)               8건  [편집] ⋮  │
│ ≡ 9. FAQ                         10건  [편집] ⋮  │
│ ≡ 10. 채용 (RECRUIT)              3건  [편집] ⋮  │
│ ≡ 11. 배너 (BANNER)               3건  [편집] ⋮  │
│ ≡ 12. 시설 (FACILITY)             6건  [편집] ⋮  │
│ ≡ 13. 비급여 (NON_COVERED)        5건  [편집] ⋮  │
│ ≡ 14. 고객의소리 (VOC)            2건  [편집] ⋮  │
│ ≡ 15. 일반 (GENERAL)              4건  [편집] ⋮  │
│                                                  │
│ ≡ = 드래그로 순서 변경                             │
│ ⋮ = 숨기기 / 삭제 / 하위 카테고리                   │
└──────────────────────────────────────────────────┘
```

### 9.3 카테고리 편집 모달

```
┌─ 카테고리 편집 ──────────────────────────────────┐
│                                                  │
│ 카테고리 코드: [DEPARTMENT          ] (영문 대문자)│
│ 표시 이름: [진료과                    ]           │
│ 설명: [진료과 소개 콘텐츠             ]           │
│                                                  │
│ 아이콘: [🏥 ▼]  색상: [#3b82f6 🎨]               │
│                                                  │
│ 표시 위치:                                        │
│ ☑ 홈페이지 메인                                   │
│ ☑ 홈페이지 서브페이지                              │
│ ☐ HIS 내부 (관리 전용)                            │
│                                                  │
│ 홈페이지 렌더링 모드:                              │
│ ○ 카드 그리드  ● 리스트  ○ 아코디언  ○ 타임라인    │
│                                                  │
│ 하위 카테고리:                                     │
│ ┌────────────────────────────────────────────┐   │
│ │ [+ 하위 카테고리 추가]                       │   │
│ │                                            │   │
│ │ ≡ 순환기내과  ≡ 호흡기내과  ≡ 소화기내과     │   │
│ │ ≡ 내분비내과  ≡ 신장내과                     │   │
│ └────────────────────────────────────────────┘   │
│                                                  │
│ 상태: ○ 활성  ○ 비활성  ○ 숨김                     │
│                                                  │
│ [취소]                    [저장]                   │
└──────────────────────────────────────────────────┘
```

### 9.4 카테고리 데이터 모델

```prisma
model CmsCategory {
  id            String    @id @default(uuid()) @db.Uuid
  code          String    @unique @db.VarChar(30)  // DEPARTMENT, CENTER, NEWS...
  name          String    @db.VarChar(50)          // 진료과, 전문센터, 뉴스...
  description   String?   @db.VarChar(200)
  icon          String?   @db.VarChar(10)          // 이모지 or 아이콘 코드
  color         String?   @db.VarChar(20)          // hex color
  parentId      String?   @map("parent_id") @db.Uuid
  sortOrder     Int       @default(0) @map("sort_order")
  isActive      Boolean   @default(true) @map("is_active")
  showOnHome    Boolean   @default(false) @map("show_on_home")
  showOnSubpage Boolean   @default(true) @map("show_on_subpage")
  renderMode    String    @default("cards") @db.VarChar(20)  // cards, list, accordion, timeline
  metadata      Json?     @db.JsonB  // 추가 설정 (슬러그 패턴, 이미지 필수 등)
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt     DateTime  @updatedAt @map("updated_at") @db.Timestamptz()

  parent        CmsCategory?  @relation("CategoryTree", fields: [parentId], references: [id])
  children      CmsCategory[] @relation("CategoryTree")

  @@index([parentId])
  @@index([sortOrder])
  @@map("cms_categories")
}
```

---

## 10. 메뉴 동적 관리 (v1.1 추가)

### 10.1 현재 문제

| 문제 | 설명 |
|------|------|
| **GNB 메뉴 하드코딩** | `GNB.tsx`에 메뉴 배열이 코드에 고정 |
| **메뉴 추가/삭제** | 새 메뉴 추가 시 개발자가 코드 수정 필요 |
| **메뉴 순서 변경** | 배포 없이 메뉴 순서 변경 불가 |
| **사이드바 메뉴도 하드코딩** | HIS 사이드바도 코드에 고정 |
| **메뉴별 권한 관리 불가** | 역할별 메뉴 표시/숨김을 코드에서 관리 |

### 10.2 메뉴 관리 UI

```
┌─ 메뉴 관리 ──────────────────────────────────────┐
│                                                  │
│ [홈페이지 GNB ▼]  [HIS 사이드바]  [푸터 메뉴]      │
│                                                  │
│ ┌─ 홈페이지 GNB 메뉴 ──────────────────────────┐ │
│ │                                              │ │
│ │ [+ 메뉴 추가]                                │ │
│ │                                              │ │
│ │ ≡ 우리들 이야기                     [편집] ⋮  │ │
│ │   ├─ 인사말·비전         /about/hospital-..  │ │
│ │   ├─ 시설 안내           /about/facility     │ │
│ │   ├─ 오시는 길           /about/directions   │ │
│ │   └─ 갤러리              /about/gallery      │ │
│ │                                              │ │
│ │ ≡ 진료과/의료진                     [편집] ⋮  │ │
│ │   ├─ 진료과 소개         /care/departments   │ │
│ │   ├─ 의료진 소개         /care/doctors       │ │
│ │   └─ 진료시간·예약       /care/schedule      │ │
│ │                                              │ │
│ │ ≡ 특성화 센터                       [편집] ⋮  │ │
│ │   ├─ 세포치료 센터       /care/centers/...   │ │
│ │   ├─ 유전자분석 센터     /care/centers/...   │ │
│ │   ├─ ... (9개)                               │ │
│ │                                              │ │
│ │ ≡ 건강증진 센터                     [편집] ⋮  │ │
│ │ ≡ 이용안내                          [편집] ⋮  │ │
│ │ ≡ 건강정보                          [편집] ⋮  │ │
│ │ ≡ 병원소식                          [편집] ⋮  │ │
│ │ ≡ 고객참여                          [편집] ⋮  │ │
│ │                                              │ │
│ │ ≡ = 드래그로 순서 변경                        │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ [미리보기]              [초기화]  [저장 + 적용]     │
└──────────────────────────────────────────────────┘
```

### 10.3 메뉴 편집 모달

```
┌─ 메뉴 항목 편집 ─────────────────────────────────┐
│                                                  │
│ 메뉴 이름: [특성화 센터               ]           │
│ URL 경로: [/care/centers              ]           │
│                                                  │
│ 메뉴 유형:                                        │
│ ● 내부 링크 (사이트 내 페이지)                     │
│ ○ 외부 링크 (새 탭으로 열기)                       │
│ ○ CMS 카테고리 연결                               │
│                                                  │
│ CMS 카테고리 연결: [CENTER ▼]                     │
│ → 하위 메뉴 자동 생성 (CMS 콘텐츠 기반)            │
│                                                  │
│ 아이콘: [없음 ▼]                                  │
│ 표시 대상: ☑ 전체  ☐ 로그인 사용자만               │
│                                                  │
│ 하위 메뉴:                                        │
│ [+ 하위 메뉴 추가]                                │
│ ≡ 세포치료 센터    /care/centers/cell-therapy     │
│ ≡ 유전자분석 센터  /care/centers/genomic-analysis │
│ ≡ 뇌과학 센터      /care/centers/neuroscience    │
│ ...                                              │
│                                                  │
│ 상태: ● 표시  ○ 숨김                              │
│                                                  │
│ [취소]                    [저장]                   │
└──────────────────────────────────────────────────┘
```

### 10.4 메뉴 데이터 모델

```prisma
model CmsMenu {
  id          String    @id @default(uuid()) @db.Uuid
  menuGroup   String    @map("menu_group") @db.VarChar(30)  // GNB, SIDEBAR, FOOTER, MOBILE_NAV
  label       String    @db.VarChar(50)
  href        String?   @db.VarChar(200)
  icon        String?   @db.VarChar(30)
  parentId    String?   @map("parent_id") @db.Uuid
  sortOrder   Int       @default(0) @map("sort_order")
  isActive    Boolean   @default(true) @map("is_active")
  isExternal  Boolean   @default(false) @map("is_external")  // 새 탭
  categoryCode String? @map("category_code") @db.VarChar(30) // CmsCategory 연결 → 하위 자동 생성
  roles       String[]  // ['ALL'] or ['ADMIN', 'DOCTOR']
  metadata    Json?     @db.JsonB
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz()

  parent      CmsMenu?  @relation("MenuTree", fields: [parentId], references: [id])
  children    CmsMenu[] @relation("MenuTree")

  @@index([menuGroup, sortOrder])
  @@index([parentId])
  @@map("cms_menus")
}
```

### 10.5 메뉴 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/v1/cms/menus?group=GNB` | 메뉴 트리 조회 |
| POST | `/api/v1/cms/menus` | 메뉴 항목 추가 |
| PATCH | `/api/v1/cms/menus/:id` | 메뉴 수정 |
| DELETE | `/api/v1/cms/menus/:id` | 메뉴 삭제 |
| PATCH | `/api/v1/cms/menus/reorder` | 순서 일괄 변경 |
| GET | `/api/v1/public/menus?group=GNB` | 공개 메뉴 (홈페이지용) |

### 10.6 GNB 동적 렌더링

```typescript
// 현재 (하드코딩):
const MENU = [
  { label: '우리들 이야기', href: '/about', children: [...] },
  ...
];

// TO-BE (API 기반):
const { data: menuData } = useQuery({
  queryKey: ['gnb-menu'],
  queryFn: () => fetch('/api/v1/public/menus?group=GNB').then(r => r.json()),
  staleTime: 5 * 60 * 1000, // 5분 캐싱
});
const MENU = menuData?.data ?? FALLBACK_MENU; // 폴백: 현재 하드코딩 메뉴
```

---

## 11. 내부 관리 확장 (v1.1 추가)

### 11.1 사이드바 메뉴 동적 관리

HIS 사이드바도 `CmsMenu` (menuGroup = 'SIDEBAR')로 관리:

| 현재 | TO-BE |
|------|-------|
| `Sidebar.tsx`에 하드코딩 | DB에서 동적 로드 |
| 역할별 필터링은 코드 | `roles` 필드로 DB 관리 |
| 메뉴 추가 시 배포 필요 | 관리 UI에서 즉시 변경 |
| 아이콘 변경 불가 | 아이콘 선택 UI |

### 11.2 시스템 설정 통합

카테고리/메뉴 관리를 기존 `시스템 설정` 하위에 통합:

```
관리자
├─ ... (기존)
├─ 시스템 설정
│   ├─ 일반 설정 (기존)
│   ├─ 카테고리 관리      ← [신규]
│   ├─ 메뉴 관리          ← [신규]
│   │   ├─ 홈페이지 GNB
│   │   ├─ HIS 사이드바
│   │   ├─ 푸터 메뉴
│   │   └─ 모바일 내비게이션
│   └─ 테마/디자인 설정    ← [신규] (향후)
│
├─ 홈페이지 관리 (기존 v1.0)
│   ├─ 공지/팝업
│   ├─ 배너
│   └─ ... (콘텐츠별)
```

### 11.3 구현 우선순위 보강

| Phase | 작업 | 예상 |
|:-----:|------|:----:|
| **10** | 카테고리 관리 (CRUD + 드래그 순서 + 하위) | 1.5일 |
| **11** | 메뉴 관리 — 홈페이지 GNB | 1.5일 |
| **12** | 메뉴 관리 — HIS 사이드바 | 1일 |
| **13** | GNB/사이드바 동적 렌더링 (API 기반) | 1일 |
| | **추가 합계** | **5일** |
| | **전체 합계 (v1.0 9일 + v1.1 5일)** | **14일** |

---

---

## 12. 콘텐츠 복제/템플릿 (v1.2 추가)

### 12.1 콘텐츠 복제

기존 콘텐츠를 복제하여 새 콘텐츠를 빠르게 생성:

```
┌─ 콘텐츠 목록 ─────────────────────────────────────┐
│                                                   │
│ 세포치료 센터                    [편집] [복제] [⋮]  │
│                                                   │
│ → "복제" 클릭 시:                                  │
│   제목: "세포치료 센터 (사본)" 으로 DRAFT 생성       │
│   내용/메타데이터/태그 동일 복사                     │
│   이미지 URL 동일 참조 (파일 복사는 안 함)          │
└───────────────────────────────────────────────────┘
```

### 12.2 콘텐츠 템플릿

카테고리별 기본 템플릿을 제공하여 일관된 콘텐츠 작성:

| 카테고리 | 템플릿 필드 |
|---------|-----------|
| DEPARTMENT | 진료과명, 소개, 주요질환, 검사, 시술, 장비, 하이라이트, 진료시간, 위치, 전화 |
| CENTER | 센터명, 소개, 주요서비스, 참여 진료과, 위치, 전화 |
| NEWS | 제목, 유형(공지/보도/행사/수상), 본문, 중요도, 작성자 |
| GALLERY | 제목, 유형(시설/행사/수상/건축), 날짜, 이미지(필수) |
| RECRUIT | 포지션, 부서, 고용형태, 자격요건, 우대사항, 복리후생, 마감일, 상태 |

---

## 13. 일괄 작업 (v1.2 추가)

### 13.1 일괄 상태 변경

```
┌─ 콘텐츠 목록 ─────────────────────────────────────┐
│                                                   │
│ ☑ 전체 선택 (5건 선택됨)                            │
│                                                   │
│ ☑ 세포치료 센터          전문센터  2026-05-27       │
│ ☑ 유전자분석 센터        전문센터  2026-05-27       │
│ ☑ 뇌과학 센터            전문센터  2026-05-27       │
│ ☐ 항노화 센터            전문센터  2026-05-27       │
│ ☑ 내시경 센터            전문센터  2026-05-27       │
│ ☑ 당뇨/내분비 센터       전문센터  2026-05-27       │
│                                                   │
│ 일괄 작업: [상태 변경 ▼] [카테고리 변경 ▼] [삭제]    │
│                                                   │
│ 상태 변경:                                         │
│ ○ 공개  ○ 비공개  ○ 보관  ○ 예약발행               │
│                                   [적용]           │
└───────────────────────────────────────────────────┘
```

### 13.2 일괄 작업 목록

| 작업 | 설명 |
|------|------|
| 상태 변경 | 여러 콘텐츠를 한번에 공개/비공개/보관 |
| 카테고리 이동 | 콘텐츠를 다른 카테고리로 이동 |
| 태그 추가/제거 | 선택된 콘텐츠에 태그 일괄 적용 |
| 일괄 삭제 | 확인 후 삭제 (휴지통으로 이동) |
| 내보내기 | CSV/JSON 형식으로 내보내기 |

---

## 14. 휴지통 & 복원 (v1.2 추가)

### 14.1 소프트 삭제

콘텐츠 삭제 시 즉시 영구 삭제하지 않고 휴지통으로 이동:

```prisma
model HospitalInfoContent {
  // 기존 필드 +
  deletedAt    DateTime? @map("deleted_at") @db.Timestamptz()  // 소프트 삭제
  deletedBy    String?   @map("deleted_by") @db.Uuid
}
```

| 상태 | 설명 |
|------|------|
| `deletedAt = null` | 정상 콘텐츠 |
| `deletedAt = 날짜` | 휴지통 (30일 보관 후 자동 영구 삭제) |

### 14.2 휴지통 UI

```
┌─ 휴지통 ──────────────────────────────────────────┐
│                                                   │
│ 🗑 휴지통 (5건) — 30일 후 자동 삭제                  │
│                                                   │
│ ☐ 이전 배너 (배너)         삭제일: 5/25  [복원] [영구삭제] │
│ ☐ 테스트 뉴스 (뉴스)       삭제일: 5/20  [복원] [영구삭제] │
│ ☐ ...                                             │
│                                                   │
│ [선택 복원] [선택 영구삭제] [휴지통 비우기]             │
└───────────────────────────────────────────────────┘
```

---

## 15. 콘텐츠 분석/통계 (v1.2 추가)

### 15.1 조회수 추적

```prisma
model ContentView {
  id         String   @id @default(uuid()) @db.Uuid
  contentId  String   @map("content_id") @db.Uuid
  viewedAt   DateTime @default(now()) @map("viewed_at") @db.Timestamptz()
  source     String?  @db.VarChar(20)  // HOME, SUBPAGE, SEARCH, DIRECT
  userAgent  String?  @map("user_agent") @db.VarChar(300)
  referer    String?  @db.VarChar(500)

  @@index([contentId, viewedAt])
  @@map("content_views")
}
```

### 15.2 통계 대시보드

```
┌─ 콘텐츠 통계 ─────────────────────────────────────┐
│                                                   │
│ 📊 이번 주 콘텐츠 성과                              │
│                                                   │
│ ┌─ 인기 콘텐츠 TOP 5 ──────────────────────────┐  │
│ │ 1. 고혈압 관리 가이드 (건강정보)     1,234조회  │  │
│ │ 2. 세포치료 센터 (전문센터)           987조회  │  │
│ │ 3. 여름 진료시간 (공지)               856조회  │  │
│ │ 4. 건강검진 완벽 가이드 (건강TV)      743조회  │  │
│ │ 5. 의료봉사 활동 (사회공헌)           621조회  │  │
│ └──────────────────────────────────────────────┘  │
│                                                   │
│ ┌─ 카테고리별 조회수 ─┐ ┌─ 일별 추이 ──────────┐  │
│ │ 건강정보   3,450    │ │    ╱╲                 │  │
│ │ 전문센터   2,890    │ │   ╱  ╲  ╱╲           │  │
│ │ 뉴스       2,150    │ │  ╱    ╲╱  ╲          │  │
│ │ 갤러리     1,820    │ │ ╱          ╲         │  │
│ │ 검진       1,540    │ │월 화 수 목 금 토 일   │  │
│ └────────────────────┘ └─────────────────────┘  │
│                                                   │
│ 📈 검색 키워드 TOP 10                               │
│ 건강검진(45) 예약(38) 내과(32) 진료시간(28) ...     │
└───────────────────────────────────────────────────┘
```

---

## 16. 다중 사용자 편집 충돌 방지 (v1.2 추가)

### 16.1 편집 잠금

```
┌─ 콘텐츠 편집 ─────────────────────────────────────┐
│                                                   │
│ ⚠ 이 콘텐츠를 현재 "관리자(admin)"님이 편집 중입니다  │
│   (10분 전부터)                                    │
│                                                   │
│ [읽기 전용으로 보기]  [편집 잠금 해제 요청]           │
└───────────────────────────────────────────────────┘
```

### 16.2 편집 잠금 모델

```prisma
model ContentLock {
  id         String   @id @default(uuid()) @db.Uuid
  contentId  String   @unique @map("content_id") @db.Uuid
  lockedBy   String   @map("locked_by") @db.Uuid
  lockedAt   DateTime @default(now()) @map("locked_at") @db.Timestamptz()
  expiresAt  DateTime @map("expires_at") @db.Timestamptz()  // 30분 자동 만료

  @@map("content_locks")
}
```

---

## 17. 리스크 분석 (v1.2 추가)

| 리스크 | 영향 | 확률 | 대응 |
|--------|------|:----:|------|
| 메뉴 동적화 시 렌더링 지연 | 홈페이지 로딩 느려짐 | 중 | 5분 캐싱 + FALLBACK_MENU 폴백 |
| 관리자 실수로 메뉴 전체 삭제 | 홈페이지 네비게이션 장애 | 낮 | 삭제 확인 + 폴백 메뉴 + 휴지통 |
| WYSIWYG 에디터 XSS | 보안 취약점 | 중 | DOMPurify 서버 사이드 정화 + CSP |
| 이미지 업로드 용량 초과 | 서버 디스크 부족 | 중 | 용량 제한(500MB) + WebP 자동 변환 + CDN |
| 동시 편집 충돌 | 데이터 손실 | 중 | ContentLock + revision 기반 복원 |
| 예약 발행 cron 실패 | 콘텐츠 미게시 | 낮 | NestJS @Cron + 실패 알림 + 수동 발행 |
| 카테고리 삭제 시 콘텐츠 고아 | 데이터 정합성 | 중 | 삭제 전 콘텐츠 이동 강제 + 소프트 삭제 |

---

## 18. 벤치마크 (v1.2 추가)

| CMS | 참고점 |
|-----|--------|
| **WordPress** | 카테고리/태그 체계, 미디어 라이브러리, 예약 발행, revision |
| **Strapi** | API-first CMS, 콘텐츠 타입 빌더, 역할 기반 권한 |
| **Sanity** | 실시간 미리보기, 구조화된 콘텐츠, 이미지 CDN |
| **Contentful** | 다국어 지원, 웹훅, 콘텐츠 모델 관리 |
| **네이버 스마트에디터** | 한국형 WYSIWYG, 이미지 업로드 UX |
| **카페24 관리자** | 쇼핑몰 CMS, 배너/팝업 관리, 템플릿 |

---

## 19. 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1.0 | 2026-05-28 | 초안 — 메뉴 분리, 팝업/배너, 에디터, 미디어, 예약발행, 이력관리 |
| v1.1 | 2026-05-28 | 보완 — 카테고리 동적 관리, 메뉴 동적 관리 (GNB+사이드바), 시스템 설정 통합 |
| v1.2 | 2026-05-28 | 검토 보완 — 복제/템플릿, 일괄작업, 휴지통, 콘텐츠 통계, 편집 잠금, 리스크, 벤치마크 |
