# PACS Proxy 기획서
> 작성일: 2026-05-09

## 1. 목적
OpenPACS(DICOMweb) 서버와 HIS 간의 영상의학 연동 프록시 — Study/Series 조회, Worklist 관리, 판독 리포트, AI 추론, 뷰어(OHIF) 연결을 제공한다.

## 2. 기능 목록
| API | Method | 설명 |
|-----|--------|------|
| `/api/v1/pacs/studies` | GET | Study 목록 조회 (patientId, studyDate, modality 필터) |
| `/api/v1/pacs/studies/:uid/series` | GET | Study 내 Series 목록 |
| `/api/v1/pacs/worklist` | GET | Worklist 목록 (scheduledDate, status, modality 필터) |
| `/api/v1/pacs/worklist` | POST | Worklist 항목 생성 |
| `/api/v1/pacs/orders` | POST | 영상 오더 생성 |
| `/api/v1/pacs/orders/:accession/status` | GET | 오더 상태 조회 |
| `/api/v1/pacs/reports` | GET | 판독 리포트 목록 (patientId, studyUid, status 필터) |
| `/api/v1/pacs/reports` | POST | 판독 리포트 생성 |
| `/api/v1/pacs/reports/:id` | GET | 리포트 상세 조회 |
| `/api/v1/pacs/reports/:id` | PATCH | 리포트 수정 |
| `/api/v1/pacs/reports/:id/sign` | POST | 리포트 서명 (예비/최종) |
| `/api/v1/pacs/patients/:pid/reports` | GET | 환자별 리포트 목록 |
| `/api/v1/pacs/ai/models` | GET | AI 모델 목록 |
| `/api/v1/pacs/ai/inference` | POST | AI 추론 요청 |
| `/api/v1/pacs/ai/jobs/:jobId` | GET | AI 작업 상태 조회 |
| `/api/v1/pacs/dashboard/today` | GET | 오늘 영상의학 통계 |
| `/api/v1/pacs/dashboard/reading-queue` | GET | 판독 대기열 |
| `/api/v1/pacs/templates` | GET | 리포트 템플릿 목록 |
| `/api/v1/pacs/health` | GET | PACS 서버 헬스체크 |
| `/api/v1/pacs/viewer/:studyUid` | GET | OHIF 뷰어 URL 반환 |

## 3. 데이터 모델
- 자체 DB 모델 없음 (프록시 패턴)
- OpenPACS DICOMweb API를 HTTP로 중계
- 인증/인가는 HIS JWT + RBAC Guard 사용

## 4. 프론트엔드
- 영상의학과 관련 페이지에서 PACS API 호출
- OHIF Viewer는 외부 URL로 리다이렉트

## 5. 상태
구현 완료 — 20개 엔드포인트 (DOCTOR, LAB_TECH, ADMIN 권한)
