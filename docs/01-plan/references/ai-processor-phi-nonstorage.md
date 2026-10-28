# AI 서버(위탁사) PHI 비저장 확인 — HIS 컴플라이언스 기록

> 작성: 2026-06-10 · 목적: HIS가 임상정보(PHI)를 외부 AI(WeRU.B Medical AI, example.org/ollama)로 전송하는 **개인정보 처리위탁** 관계의 비저장 보장 기록.
> 원본 확인서: AI팀 레포 `docs/01-plan/references/his-phi-nonstorage-confirmation.md`(커밋 846acdc).

## 위탁 개요
- 위탁자: Hospital RUN(HIS) · 수탁자: AI 서버(WeRU.B Medical AI)
- 위탁 내용: 진료 보조 AI(요약·감별진단·SOAP초안·검사해석·번역 등) — 프롬프트에 PHI 포함 가능
- 전송 경로: HIS → `https://example.org/ollama` (`/api/medical/*` X-Medical-Key, `/api/chat` Bearer)

## 비저장 확인 내역 (AI팀 구현·배포·라이브 검증 완료, 2026-06-10)
| 항목 | 보장 |
|------|------|
| 진료 입력/출력 전문 | **비저장** |
| 감사 요약(요청 텍스트) | **미보존** |
| 테넌트 격리 | **적용** |
| 기존 저장분(medical_consultations 98행 / audit 103건) | **파기 완료** |
| 서버 로그 본문 | 미저장 |

## ✅ RAG 테넌트 격리 — 완료(2026-06-10)
- **RAG 지식베이스 테넌트 격리 적용 완료**(전 검색 경로 5종 post-filter `_kb_tenant_ok`) — 타 병원 비공개 지식문서가 검색에 미혼입. 공유·레거시·자기 테넌트만 노출. (AI팀 커밋 bb6cb9b)
- 실누출 없었음(현재 medical_knowledge 156건 전건 공유 tenant_id NULL·검색이 SQL 폴백) → 향후 비공개 색인 대비 예방 하드닝.
- **→ PHI 비저장 확인서 전 항목 완료.**
- (AI팀 백로그) 의료 RAG 이중 store(색인 chromadb_data vs 검색 client.rag) 통합은 별도 과제.

## 키 관리(연계)
- AI 서버 키 로테이션 완료(2026-06-10): 구키 `med-bc98`/`his_ac54` 폐기(401 검증), 신키 DB SystemConfig 관리·코드 하드코딩 제거. → [[session_20260609_erp_twin_review]] C-2.
- HIS API 응답에서 AI 키 마스킹(C-1).

## 결론
- AI 수탁사 **PHI 비저장 보장 확인서 수령(전 항목 완료)** → HIS 위탁 적법성 근거 확보.
- 진료 input/output 비저장·감사 미보존·테넌트 격리·RAG 격리·기존분 파기 모두 구현·배포·라이브 검증 완료.
