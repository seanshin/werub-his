# Plan: 사전문진표 시스템 고도화 (questionnaire-system)

> **상태(2026-09-15 코드 대조 갱신)**: 구현됨(일부) — 검토 EP 는 기존 존재(09-14 'grep 0' 판정은 오판) · 제출 전 검토 409·첫 검토자 보존 `apps/api/src/modules/questionnaire/questionnaire-admin.service.ts:337`(R4 `b817fc87`) · 진료 화면 문진 검토 버튼 · 잔여: patients/:id/questionnaire-status(CLI — grep 0)

> Created: 2026-05-18
> Status: Draft
> Priority: High

---

## 1. 배경 및 목표

### 현재 상태
- FormSchema / FormSubmission / QuestionnaireToken 모델 존재
- 시드 양식 9종 (초진/재진/수술전 문진 + PHQ-9/GAD-7/MMSE 등 평가도구)
- 공개 폼 렌더링 (`/questionnaire/{token}`) 동작
- 예약 완료 시 자동 토큰 생성 (booking → questionnaire 연결 완료)
- 관리자 목록 페이지 존재 (읽기 전용)
- form-engine 백엔드 CRUD API 존재

### 부족한 점
| 영역 | 현재 | 필요 |
|------|------|------|
| 양식 관리 | 시드 데이터 의존, 편집 불가 | 진료과별 양식 배정, 편집기 UI |
| 발송 체계 | 예약 완료 시 자동만 | 수동 발송, 재발송, SMS/카카오 알림 |
| 작성 추적 | 완료 여부만 | 미작성 추적, 리마인더, 만료 관리 |
| 진료 연동 | 없음 | 작성 결과 → EMR/차트 자동 반영 |
| 통계 | 없음 | 작성률, 진료과별 현황, 응답 분석 |
| 모바일 UX | 기본 | 모바일 최적화, 임시저장, 진행률 표시 |

### 목표
환자가 내원 전 모바일에서 문진표를 편리하게 작성하고, 의료진이 진료 시 즉시 활용할 수 있는 **엔드투엔드 문진표 시스템** 구축.

---

## 2. 요구사항

### FR-01. 양식 관리 (관리자)

| ID | 요구사항 | 우선순위 |
|----|---------|:--------:|
| FR-01-1 | 문진표 양식 CRUD (생성/수정/삭제/복제) | P1 |
| FR-01-2 | 진료과별 기본 양식 배정 (내과→초진문진, 정신과→PHQ-9 등) | P1 |
| FR-01-3 | 필드 타입: text, textarea, select, radio, checkbox, date, number, scale | P1 |
| FR-01-4 | 조건부 필드 (예: 흡연→흡연량 표시) | P2 |
| FR-01-5 | 양식 버전 관리 (활성/비활성) | P2 |
| FR-01-6 | 양식 미리보기 | P1 |
| FR-01-7 | JSON 스키마 직접 편집 (고급) | P3 |

### FR-02. 진료과별 양식 배정

| ID | 요구사항 | 우선순위 |
|----|---------|:--------:|
| FR-02-1 | 진료과 → 기본 문진표 매핑 테이블 | P1 |
| FR-02-2 | 예약 유형별 양식 (초진→초진문진, 재진→재진문진, 수술→수술전문진) | P1 |
| FR-02-3 | 복수 양식 배정 (내과 초진 = 초진문진 + 생활습관) | P2 |
| FR-02-4 | 의사별 추가 양식 오버라이드 | P3 |

### FR-03. 발송 체계

| ID | 요구사항 | 우선순위 |
|----|---------|:--------:|
| FR-03-1 | 예약 완료 시 자동 발송 (현재 구현됨 - 토큰 생성) | ✅ |
| FR-03-2 | 문진표 URL을 SMS/카카오톡으로 발송 | P2 |
| FR-03-3 | 수동 발송 (간호사가 특정 환자에게) | P1 |
| FR-03-4 | 재발송 (미작성 시) | P2 |
| FR-03-5 | QR 코드 생성 (대기실 안내용) | P3 |

### FR-04. 환자 작성 경험

| ID | 요구사항 | 우선순위 |
|----|---------|:--------:|
| FR-04-1 | 모바일 최적화 폼 렌더링 | P1 |
| FR-04-2 | 진행률 표시 (1/8 페이지) | P1 |
| FR-04-3 | 임시저장 (로컬스토리지) | P2 |
| FR-04-4 | 다국어 지원 (한국어/영어) | P3 |
| FR-04-5 | 음성 입력 (접근성) | P3 |

### FR-05. 처리 워크플로우

| ID | 요구사항 | 우선순위 |
|----|---------|:--------:|
| FR-05-1 | 상태 관리: 발송됨 → 작성중 → 완료 → 검토됨 | P1 |
| FR-05-2 | 미작성 추적 대시보드 (간호사용) | P1 |
| FR-05-3 | 만료 임박 알림 (24시간 전) | P2 |
| FR-05-4 | 내원 당일 미작성 → 태블릿 현장 작성 안내 | P2 |
| FR-05-5 | 작성 완료 → 담당의 알림 | P2 |

### FR-06. 진료 연동

| ID | 요구사항 | 우선순위 |
|----|---------|:--------:|
| FR-06-1 | EMR 차트에 문진표 응답 표시 (읽기) | P1 |
| FR-06-2 | 문진표 → SOAP 주관적 소견(S) 자동 채움 | P1 |
| FR-06-3 | 평가도구(PHQ-9 등) → 점수 자동 계산 + 차트 기록 | P2 |
| FR-06-4 | 알레르기/약물 응답 → 환자 정보 자동 업데이트 | P2 |

### FR-07. 통계/대시보드

| ID | 요구사항 | 우선순위 |
|----|---------|:--------:|
| FR-07-1 | 전체 작성률 (발송 대비 완료) | P1 |
| FR-07-2 | 진료과별/양식별 작성률 | P1 |
| FR-07-3 | 평균 작성 소요 시간 | P2 |
| FR-07-4 | 미작성 환자 목록 (당일/주간) | P1 |

---

## 3. DB 스키마 변경

### 신규 테이블

```
DepartmentFormMapping (진료과-양식 매핑)
├── id: UUID
├── departmentName: string      // "내과", "정신건강의학과"
├── formSchemaId: FK → FormSchema
├── visitType: INITIAL | FOLLOW_UP | PRE_OP | ALL
├── priority: int               // 복수 양식 시 순서
├── isActive: boolean
└── createdBy: FK → User
```

### 기존 테이블 확장

```
QuestionnaireToken (확장)
├── + status: SENT | OPENED | IN_PROGRESS | COMPLETED | EXPIRED
├── + sentVia: EMAIL | SMS | KAKAO | QR | CHAT | null
├── + openedAt: DateTime?       // 최초 열람 시각
├── + reminderSentAt: DateTime? // 리마인더 발송 시각
├── + reviewedBy: FK → User?    // 검토한 의료진
├── + reviewedAt: DateTime?
```

```
FormSchema (확장)
├── + category: QUESTIONNAIRE | SCORING | CONSENT | CUSTOM
├── + estimatedMinutes: int?    // 예상 작성 시간 (분)
├── + departmentMappings: DepartmentFormMapping[]
```

---

## 4. API 설계

### 관리자 API

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/v1/admin/questionnaire/mappings` | 진료과-양식 매핑 목록 |
| POST | `/api/v1/admin/questionnaire/mappings` | 매핑 생성 |
| PUT | `/api/v1/admin/questionnaire/mappings/:id` | 매핑 수정 |
| DELETE | `/api/v1/admin/questionnaire/mappings/:id` | 매핑 삭제 |
| GET | `/api/v1/admin/questionnaire/stats` | 통계 대시보드 |
| GET | `/api/v1/admin/questionnaire/pending` | 미작성 목록 |
| POST | `/api/v1/admin/questionnaire/send` | 수동 발송 |
| POST | `/api/v1/admin/questionnaire/resend/:tokenId` | 재발송 |

### 간호사/의료진 API

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/v1/patients/:id/questionnaire-status` | 환자 문진표 현황 |
| POST | `/api/v1/patients/:id/questionnaire/send` | 특정 환자에게 발송 |
| PUT | `/api/v1/questionnaires/:id/review` | 문진표 검토 완료 표시 |

### 공개 API (확장)

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/api/v1/questionnaires/:token` | 폼 조회 (기존) |
| POST | `/api/v1/questionnaires/:token/submit` | 폼 제출 (기존) |
| PUT | `/api/v1/questionnaires/:token/save` | 임시저장 (신규) |
| GET | `/api/v1/questionnaires/:token/status` | 상태 조회 (신규) |

---

## 5. 화면 설계

### 5-1. 관리자: 양식 관리 (`/admin/forms`)
- 양식 목록 (카드/테이블 뷰)
- 양식 생성/편집 폼 빌더
- 진료과별 매핑 설정
- 양식 미리보기

### 5-2. 관리자: 문진표 현황 (`/admin/questionnaire-dashboard`)
- 전체 통계 카드 (발송/작성/미작성/만료)
- 진료과별 작성률 차트
- 미작성 환자 목록 + 재발송 버튼
- 당일 예약 환자 문진표 상태

### 5-3. 간호사: 환자별 문진표 (`/patients/:id/questionnaire`)
- 환자 문진표 이력 (타임라인)
- 발송/재발송 버튼
- 작성 결과 열람
- 검토 완료 표시

### 5-4. 의사: 진료 화면 연동 (`/encounter/:id`)
- 사이드 패널: 문진표 응답 요약
- SOAP S항목에 자동 채움 버튼
- 평가도구 점수 차트

### 5-5. 환자: 문진표 작성 (`/questionnaire/:token`)
- 모바일 최적화 스텝 폼
- 진행률 바
- 임시저장/제출 버튼
- 완료 확인 화면

---

## 6. 구현 로드맵

### Phase 1 (P1 — 핵심) `~3일`
1. DB 스키마 확장 (DepartmentFormMapping, QuestionnaireToken 상태)
2. 진료과-양식 매핑 CRUD API + 시드
3. 관리자 양식 관리 UI 보강 (생성/편집/미리보기)
4. 미작성 추적 API + 간호사 대시보드
5. EMR 차트에 문진표 응답 표시
6. 문진표 → SOAP 자동 채움

### Phase 2 (P2 — 운영) `~2일`
7. SMS/카카오톡 발송 연동
8. 리마인더 자동 발송 (cron)
9. 임시저장 기능
10. 평가도구 점수 자동 계산
11. 알레르기/약물 자동 업데이트
12. 진행률 표시 + 모바일 UX 개선

### Phase 3 (P3 — 고도화) `~2일`
13. 조건부 필드 로직
14. QR 코드 생성
15. 다국어 지원
16. 양식 버전 관리 UI

---

## 7. 기술 고려사항

### 양식 스키마 구조
```json
{
  "title": "초진 문진표",
  "category": "QUESTIONNAIRE",
  "estimatedMinutes": 5,
  "sections": [
    {
      "title": "기본 정보",
      "fields": [
        {
          "id": "chief_complaint",
          "type": "textarea",
          "label": "주요 증상",
          "required": true,
          "placeholder": "..."
        },
        {
          "id": "smoking",
          "type": "select",
          "label": "흡연 여부",
          "options": ["비흡연", "현재 흡연", "과거 흡연"],
          "conditional": {
            "showIf": { "field": "smoking", "value": "현재 흡연" },
            "fields": [
              { "id": "smoking_amount", "type": "text", "label": "하루 흡연량" }
            ]
          }
        }
      ]
    }
  ],
  "scoring": null  // 평가도구일 경우 점수 계산 로직
}
```

### 보안
- 토큰 48시간 만료 유지
- 환자 본인 확인 (생년월일) 옵션
- 제출 후 수정 불가 (의무기록 무결성)
- HTTPS 필수

### 성능
- 폼 스키마 캐시 (변경 빈도 낮음)
- 임시저장은 로컬스토리지 (서버 부하 없음)
- 통계는 Redis 캐시 (5분)

---

## 8. 성공 지표

| 지표 | 목표 |
|------|------|
| 사전 문진표 작성률 | 예약 환자 중 60% 이상 |
| 평균 작성 소요 시간 | 5분 이내 |
| 진료 시간 단축 | 초진 평균 2분 단축 |
| 진료과별 양식 커버리지 | 주요 10개 진료과 배정 완료 |

---

## 9. 관련 문서

- 기존 코드: `apps/api/src/modules/questionnaire/`, `apps/api/src/modules/form-engine/`
- 시드 양식: `apps/api/prisma/seed.ts` (9종)
- 환자 폼: `apps/web/src/app/questionnaire/[token]/page.tsx`
- 관리자 페이지: `apps/web/src/app/(main)/admin/forms/page.tsx`
