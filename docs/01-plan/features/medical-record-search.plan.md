# Medical Record Search (의무기록 검색) 기획서
> 작성일: 2026-05-09

## 1. 목적
전체 의무기록(진료기록, 검사결과, 처방 등)을 키워드로 전문검색(full-text search)하여, 의료진이 환자 이력을 빠르게 조회할 수 있도록 한다.

## 2. 기능 목록
| API | Method | 설명 |
|-----|--------|------|
| `/api/v1/medical-records/search` | GET | 의무기록 전문검색 |

**검색 파라미터:**
- `q` — 검색 키워드 (필수)
- `type` — 기록 유형 필터
- `dateFrom` / `dateTo` — 기간 범위
- `doctorId` — 작성 의사 필터
- `page` / `limit` — 페이지네이션

## 3. 데이터 모델
- 자체 모델 없음
- Encounter, DiagnosticTest, LabResult, Prescription 등 기존 모델을 크로스 검색
- PostgreSQL full-text search 또는 LIKE 쿼리 사용

## 4. 프론트엔드
- 의무기록 검색 페이지 또는 환자 상세 내 검색 기능

## 5. 상태
구현 완료 — 1개 엔드포인트 (DOCTOR, NURSE, ADMIN 권한)
