# Medical Record Copy (의무기록 사본 발급) 기획서
> 작성일: 2026-05-09

## 1. 목적
환자 또는 보호자의 요청에 따라 의무기록 사본을 PDF로 생성하고, 발급 이력을 관리한다.

## 2. 기능 목록
| API | Method | 설명 |
|-----|--------|------|
| `/api/v1/medical-records/generate-pdf` | POST | 의무기록 PDF 생성 (HTML 반환, 클라이언트에서 인쇄) |
| `/api/v1/medical-record-copies` | POST | 사본발급 이력 생성 |
| `/api/v1/patients/:patientId/record-copies` | GET | 환자별 사본발급 이력 조회 |

## 3. 데이터 모델
**MedicalRecordCopy**
| 필드 | 타입 | 설명 |
|------|------|------|
| id | UUID | PK |
| patientId | UUID | 환자 (FK → Patient) |
| requestedBy | VARCHAR(100) | 신청자명 |
| requestorRelation | VARCHAR(50) | 신청자 관계 (본인, 보호자 등) |
| purpose | VARCHAR(200) | 발급 목적 |
| recordTypes | JSONB | 요청 기록 유형 (진료기록, 검사결과 등) |
| dateRange | JSONB | 기간 범위 (nullable) |
| issuedBy | UUID | 발급 직원 (FK → User) |
| issuedAt | TIMESTAMPTZ | 발급일시 |
| copyCount | INT | 사본 부수 |
| notes | TEXT | 비고 (nullable) |

## 4. 프론트엔드
- 환자 상세 페이지 내 사본발급 탭
- 소견서 인쇄 페이지: `apps/web/src/app/(main)/print/opinion/`

## 5. 상태
구현 완료 — 3개 엔드포인트 (DOCTOR, NURSE, ADMIN 권한) + PDF 생성 서비스
