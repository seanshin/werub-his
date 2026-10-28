# 공지/팝업 관리 고도화 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/web/src/app/(main)/admin/homepage/popups/page.tsx:80 · apps/api/src/modules/homepage-popup/homepage-popup.service.ts:35 · 잔여: 없음

> **Feature**: popup-enhancement
> **Priority**: P1
> **Estimated**: 4~5시간
> **Author**: CTO
> **Date**: 2026-05-28

---

## 1. 현황 분석

### 현재 구현

| 항목 | 상태 |
|------|:----:|
| 팝업 CRUD (생성/수정/삭제/토글) | ✅ |
| 4가지 유형 (모달/띠배너/플로팅/페이지배너) | ✅ |
| 기간 설정 (시작일/종료일) | ✅ |
| "오늘 하루 안 보기" | ✅ |
| 대상 페이지 필터링 | ✅ |
| 정렬 순서 | ✅ |
| **이미지 직접 업로드** | ❌ URL 수동 입력 |
| **실시간 미리보기** | ❌ |
| **템플릿 시스템** | ❌ |
| **클립아트/아이콘 라이브러리** | ❌ |
| **WYSIWYG 에디터** | ❌ textarea만 |
| **리치 콘텐츠 (배경색, 버튼 스타일링)** | ❌ |

### 문제점

1. 이미지를 URL로 수동 입력 → 미디어 라이브러리 연동 필요
2. 팝업 모양을 생성 전에 확인 불가 → 실시간 미리보기 필요
3. 매번 처음부터 작성 → 빈번한 유형별 템플릿 필요
4. 텍스트만 입력 가능 → 아이콘/클립아트로 시각적 효과 필요
5. 본문이 plain text → HTML/마크다운 또는 구조화 에디터 필요

---

## 2. 고도화 목표

### 핵심 기능 (Must-Have)

| # | 기능 | 설명 |
|:--:|------|------|
| F1 | **이미지 업로드** | 드래그&드롭 + 미디어 라이브러리 선택 |
| F2 | **실시간 미리보기** | 모달/띠배너/플로팅 각 유형별 미리보기 |
| F3 | **템플릿 시스템** | 7+ 프리셋 템플릿 (공지/이벤트/검진/휴진 등) |
| F4 | **클립아트 라이브러리** | 병원 전용 SVG 아이콘 30+ 종 |
| F5 | **리치 콘텐츠 에디터** | 배경색, 텍스트 색상, 버튼 스타일링 |

### 부가 기능 (Nice-to-Have)

| # | 기능 | 설명 |
|:--:|------|------|
| F6 | 복제 기능 | 기존 팝업을 복사하여 수정 |
| F7 | 다국어 지원 | 한/영 동시 관리 |
| F8 | A/B 테스트 | 두 버전 비교 (CTR 추적) |

---

## 3. 상세 설계

### F1. 이미지 업로드

**요구사항**:
- 팝업 폼 내 이미지 필드에 드래그&드롭 업로드 영역
- 기존 미디어 라이브러리에서 선택 가능 (모달 팝업)
- 업로드 시 자동 리사이즈 (최대 1200x800)
- 지원 포맷: PNG, JPG, WebP (최대 5MB)
- 업로드 후 미리보기 썸네일 표시

**구현**:
```
[드래그&드롭 영역] [미디어 라이브러리에서 선택] [URL 직접 입력]
        ↓                    ↓                      ↓
  /api/v1/homepage/     미디어 라이브러리          수동 입력
  media/upload          모달 팝업
        ↓                    ↓
     imageUrl 자동 설정
```

### F2. 실시간 미리보기

**유형별 미리보기**:

| 유형 | 미리보기 모양 |
|------|-------------|
| MODAL | 중앙 모달 (450x600, 어두운 배경) |
| STRIP | 상단 띠배너 (전체 너비, 높이 48px) |
| FLOATING | 우측 하단 플로팅 (320x400) |
| PAGE_BANNER | 상단 전체 배너 (전체 너비, 높이 200px) |

**미리보기 영역**:
- 폼 우측에 고정 패널 (sticky)
- 유형 변경 시 실시간 반영
- 이미지/텍스트/배경색 실시간 적용
- 모바일 미리보기 토글

### F3. 템플릿 시스템

**기본 제공 템플릿 (7종)**:

| # | 템플릿 | 유형 | 배경색 | 아이콘 |
|:--:|--------|:----:|--------|--------|
| T1 | 일반 공지 | MODAL | #FFFFFF | 📢 megaphone |
| T2 | 긴급 공지 | STRIP | #FEF2F2 (red-50) | 🚨 alert |
| T3 | 건강검진 이벤트 | MODAL | #EFF6FF (blue-50) | 🩺 stethoscope |
| T4 | 휴진 안내 | MODAL | #FFF7ED (amber-50) | 🏥 hospital |
| T5 | 신규 의료진 소개 | MODAL | #F0FDF4 (green-50) | 👨‍⚕️ doctor |
| T6 | 시설/장비 안내 | PAGE_BANNER | #EEF2FF (indigo-50) | 🔬 microscope |
| T7 | 계절 건강 정보 | FLOATING | #ECFDF5 (emerald-50) | 🌿 leaf |

**템플릿 구조**:
```typescript
interface PopupTemplate {
  id: string;
  name: string;
  category: string;       // 공지/이벤트/안내/건강
  type: 'MODAL' | 'STRIP' | 'FLOATING' | 'PAGE_BANNER';
  thumbnail: string;      // SVG 미리보기
  defaultContent: {
    title: string;
    content: string;
    bgColor: string;
    textColor: string;
    buttonText: string;
    buttonColor: string;
    clipartId: string;
  };
}
```

### F4. 클립아트 라이브러리

**병원 전용 SVG 클립아트 (30종)**:

| 카테고리 | 아이콘 |
|----------|--------|
| 의료 (10종) | 청진기, 주사기, 알약, 심장, 구급차, 체온계, 현미경, 혈압계, 의료차트, DNA |
| 병원 (6종) | 병원건물, 병실, 수술실, 접수대, 병원침대, 의료기기 |
| 사람 (6종) | 의사, 간호사, 환자, 가족, 노인, 어린이 |
| 자연/건강 (4종) | 나뭇잎, 태양, 하트, 별 |
| UI (4종) | 체크마크, 달력, 시계, 전화기 |

**서빙 방식**: Next.js static asset (`apps/web/public/clipart/`) — API 호출 없이 직접 참조
- 경로: `/clipart/{category}/{name}.svg`
- 인덱스: `/clipart/index.json` (카테고리별 목록)
- API `/api/v1/homepage/cliparts`는 인덱스 JSON을 프록시 (FE에서 직접 fetch도 가능)

### F5. 리치 콘텐츠 에디터

**추가 필드**:
```typescript
interface PopupStyle {
  bgColor: string;        // 배경색 (#hex)
  textColor: string;      // 텍스트 색상
  buttonText: string;     // CTA 버튼 텍스트
  buttonColor: string;    // 버튼 색상
  buttonUrl: string;      // 버튼 링크
  clipartId: string;      // 클립아트 ID
  clipartPosition: 'top' | 'left' | 'right' | 'background';
  overlayOpacity: number; // 배경 오버레이 투명도 (0-100)
  borderRadius: number;   // 모서리 둥글기
  fontSize: 'sm' | 'md' | 'lg';
}
```

---

## 4. 구현 계획

### Phase 1: BE API 확장 (30분)
- HomepagePopup 모델에 스타일 필드 추가 (bgColor, textColor, buttonText 등)
- 템플릿 API (GET /templates, GET /cliparts)

### Phase 2: 클립아트 SVG 생성 (40분)
- 30종 SVG 아이콘 생성
- `/public/clipart/` 디렉토리 구조
- `clipart-index.json` 인덱스 파일

### Phase 3: FE 폼 고도화 (60분)
- 이미지 업로드 (드래그&드롭 + 미디어 라이브러리 연동)
- 리치 스타일 에디터 (배경색, 텍스트색, 버튼)
- 클립아트 선택 패널
- 템플릿 선택 그리드

### Phase 4: 실시간 미리보기 (40분)
- 우측 미리보기 패널 (유형별)
- 모바일/데스크톱 토글
- 실시간 스타일 반영

### Phase 5: 테스트 + 배포 (20분)
- 빌드 확인
- 서버 배포

---

## 5. 데이터 모델 변경

### HomepagePopup 확장 필드

```prisma
// 기존 필드 유지 + 추가
model HomepagePopup {
  // ... 기존 필드 ...

  // 스타일 (신규)
  bgColor         String?  @map("bg_color") @db.VarChar(20)
  textColor       String?  @map("text_color") @db.VarChar(20)
  buttonText      String?  @map("button_text") @db.VarChar(100)
  buttonColor     String?  @map("button_color") @db.VarChar(20)
  clipartId       String?  @map("clipart_id") @db.VarChar(50)
  clipartPosition String?  @map("clipart_position") @db.VarChar(20)
  overlayOpacity  Int?     @map("overlay_opacity")
  borderRadius    Int?     @map("border_radius")
  fontSize        String?  @map("font_size") @db.VarChar(10)
  templateId      String?  @map("template_id") @db.VarChar(50)
}
```

**기존 필드 정리**:
- `linkUrl` → CTA 버튼 링크로 재사용 (buttonUrl 역할 겸용, 별도 필드 불필요)
- `linkText` → `buttonText`로 대체 (linkText는 deprecated, 기존 데이터는 마이그레이션)
- `imageUrl` → 유지 (드래그&드롭 업로드 시 자동 설정)
```

---

## 6. API 설계

### 신규 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/v1/homepage/popup-templates` | 템플릿 목록 |
| GET | `/api/v1/homepage/cliparts` | 클립아트 목록 |
| GET | `/api/v1/homepage/cliparts/:id` | 클립아트 SVG |

### 수정 엔드포인트

| Method | Path | 변경 |
|--------|------|------|
| POST | `/api/v1/homepage/popups` | 스타일 필드 추가 |
| PATCH | `/api/v1/homepage/popups/:id` | 스타일 필드 추가 |
| POST | `/api/v1/homepage/popups/:id/clone` | 팝업 복제 |

### API 응답 형식

**GET /popup-templates**:
```json
{
  "data": [
    {
      "id": "notice-general",
      "name": "일반 공지",
      "category": "공지",
      "type": "MODAL",
      "thumbnail": "/clipart/ui/megaphone.svg",
      "defaults": {
        "bgColor": "#FFFFFF",
        "textColor": "#111827",
        "buttonText": "자세히 보기",
        "buttonColor": "#2563EB",
        "clipartId": "megaphone",
        "fontSize": "md"
      }
    }
  ]
}
```

**GET /cliparts**:
```json
{
  "data": {
    "categories": [
      {
        "id": "medical",
        "name": "의료",
        "icons": [
          { "id": "stethoscope", "name": "청진기", "path": "/clipart/medical/stethoscope.svg" }
        ]
      }
    ],
    "total": 30
  }
}
```

### 이미지 업로드 전략

- **기존 Media 모듈 재사용**: `POST /api/v1/homepage/media/upload` (folder: `/popup`)
- **크기 제한 통일**: 기존 10MB → 5MB로 팝업용 제한 (FE에서 체크)
- **리사이즈**: 클라이언트 사이드 (canvas API) — 서버 의존성 최소화
  - 최대 1200x800px, JPEG 품질 85%
  - 원본은 그대로 저장, 썸네일만 리사이즈

---

## 7. 성공 지표

| 지표 | 목표 |
|------|------|
| 클립아트 종류 | 30+ 종 |
| 템플릿 종류 | 7+ 종 |
| 이미지 업로드 | 드래그&드롭 + 미디어 라이브러리 |
| 미리보기 유형 | 4종 (모달/띠/플로팅/배너) |
| 빌드 에러 | 0건 |

---

## 8. 위험 요소

| 위험 | 대응 |
|------|------|
| SVG 클립아트 렌더링 호환성 | 기본 SVG만 사용 (filter/mask 제외) |
| 미리보기 성능 (실시간 렌더링) | debounce 적용 (300ms) |
| 기존 팝업 데이터 호환 | 새 필드 모두 nullable, 기본값 제공 |
| 이미지 업로드 실패 | FE에서 재시도 + 에러 토스트 |
| 대용량 SVG 번들 | 클립아트 lazy loading (필요 시만 로드) |

---

## 9. FE 기본값 매핑 (nullable 필드 fallback)

| 필드 | 미지정 시 기본값 |
|------|-----------------|
| bgColor | `#FFFFFF` (흰색) |
| textColor | `#111827` (gray-900) |
| buttonText | `자세히 보기` |
| buttonColor | `#2563EB` (blue-600) |
| clipartId | null (표시 안 함) |
| clipartPosition | `top` |
| overlayOpacity | 0 (투명) |
| borderRadius | 16 (px) |
| fontSize | `md` |
| templateId | null |

---

## 10. 테스트 계획

| # | 시나리오 | 검증 항목 |
|:--:|---------|----------|
| T1 | 기존 팝업 하위 호환 | 새 필드 없는 기존 데이터가 기본값으로 정상 렌더링 |
| T2 | 이미지 업로드 검증 | 5MB 초과 거부, PNG/JPG/WebP만 허용, 업로드 후 URL 자동 반영 |
| T3 | 미리보기 정합성 | 모달/띠/플로팅/배너 4종 미리보기가 실제 홈페이지 표시와 일치 |
| T4 | 템플릿 적용 | 템플릿 선택 시 폼 필드 자동 채움 (제목/내용/색상/아이콘) |
| T5 | 클립아트 렌더링 | 30종 SVG 모두 정상 표시 (크기/색상 반영) |
| T6 | 팝업 복제 | 기존 팝업 복제 후 제목에 "(복사본)" 접미사 |
| T7 | 빌드 | TypeScript 에러 0건, next build 성공 |

---

## 11. 본문 콘텐츠 범위

- **현재 Scope**: 본문은 plain text 유지, 스타일링은 별도 필드로 제어
- **향후**: WYSIWYG 에디터 도입 시 `content` 필드를 HTML로 전환 (Phase 2 로드맵)
- **이유**: 복잡한 에디터 도입은 별도 Sprint로 분리 (현재는 시각 효과 중심)
