# Encounter Template (진료 템플릿) 기획서

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/prisma/schema.prisma:7159 · apps/api/src/modules/encounter-template/encounter-template.controller.ts:14 · 잔여: 없음
> 작성일: 2026-05-09

## 1. 목적
진료과별 SOAP(Subjective/Objective/Assessment/Plan) 기반 진료기록 템플릿을 관리하여, 의사가 진료 시 구조화된 양식을 즉시 활용할 수 있도록 한다.

## 2. 기능 목록
| API | Method | 설명 |
|-----|--------|------|
| `/api/v1/encounter-templates` | POST | 진료기록 템플릿 생성 |
| `/api/v1/encounter-templates` | GET | 템플릿 목록 조회 (department 필터) |
| `/api/v1/encounter-templates/:id` | GET | 템플릿 상세 조회 |
| `/api/v1/encounter-templates/:id` | PUT | 템플릿 수정 (ADMIN만) |

## 3. 데이터 모델
**EncounterTemplate**
| 필드 | 타입 | 설명 |
|------|------|------|
| id | UUID | PK |
| department | VARCHAR(50) | 진료과 |
| name | VARCHAR(200) | 템플릿명 (Unique) |
| description | TEXT | 설명 (nullable) |
| soapSections | JSONB | SOAP 섹션 정의 (S/O/A/P별 필드 구성) |
| version | VARCHAR(20) | 버전 |
| isActive | BOOLEAN | 활성 여부 |
| createdBy | UUID | 생성자 |
| createdAt | TIMESTAMPTZ | 생성일시 |
| updatedAt | TIMESTAMPTZ | 수정일시 |

## 4. 프론트엔드
- 진료 화면에서 템플릿 선택 시 SOAP 양식 자동 로드
- 관리자 설정에서 템플릿 CRUD

## 5. 상태
구현 완료 — 4개 엔드포인트 (DOCTOR, NURSE, ADMIN 권한)
