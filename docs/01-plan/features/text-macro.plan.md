# Text Macro (텍스트 매크로) 기획서
> 작성일: 2026-05-09

## 1. 목적
의료진이 자주 사용하는 문구(소견, 처방 메모 등)를 단축어로 등록하고, 입력 시 자동 확장하여 차트 작성 속도를 높인다.

## 2. 기능 목록
| API | Method | 설명 |
|-----|--------|------|
| `/api/v1/text-macros` | POST | 텍스트 매크로 생성 |
| `/api/v1/text-macros` | GET | 매크로 목록 조회 (category 필터, 본인+공유 매크로) |
| `/api/v1/text-macros/expand/:shortcut` | GET | 단축어 확장 (shortcut → content 반환) |
| `/api/v1/text-macros/:id` | DELETE | 매크로 삭제 (본인 소유만) |

## 3. 데이터 모델
**TextMacro**
| 필드 | 타입 | 설명 |
|------|------|------|
| id | UUID | PK |
| userId | UUID | 소유자 (FK → User) |
| category | VARCHAR(20) | 분류 (진단, 처방, 소견 등) |
| shortcut | VARCHAR(50) | 단축어 |
| content | TEXT | 확장 내용 |
| isShared | BOOLEAN | 공유 여부 (기본 false) |
| createdAt | TIMESTAMPTZ | 생성일시 |

## 4. 프론트엔드
- 진료 화면(차트 에디터) 내 매크로 확장 기능으로 사용
- 별도 매크로 관리 화면은 설정 페이지에 포함

## 5. 상태
구현 완료 — 4개 엔드포인트 (DOCTOR, NURSE, ADMIN 권한)
