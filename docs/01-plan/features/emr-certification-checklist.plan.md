# EMR 인증 보안 체크리스트 v1.0

> **상태(2026-09-14 코드 대조)**: 구현됨(일부) — infra/scripts/backup.sh:51 gpg 암호화 · infra/scripts/lib/backup-files.sh 파일 아카이브 · 잔여: BR-4 재해 복구 계획(DRP)(사람); EMR 인증 획득 자체(사람)

> 근거: 의료법 시행규칙 제16조, 전자의무기록 시스템 인증 기준 (보건복지부 고시 제2023-205호)
> 작성일: 2026-05-28 | 대상: Hospital RUN HIS

---

## 1. 접근 통제 (Access Control)

| # | 요구사항 | 현재 상태 | 구현 위치 | 비고 |
|---|---------|:--------:|----------|------|
| AC-1 | 사용자 식별 및 인증 (ID/PW) | ✅ | auth.service.ts | JWT + bcrypt |
| AC-2 | 역할 기반 접근 제어 (RBAC) | ✅ | roles.guard.ts | 7개 역할 |
| AC-3 | 세션 자동 만료 (30분 비활동) | ✅ | auth.service.ts | Sprint 3 구현 |
| AC-4 | 동시 접속 제한 | ✅ | auth.service.ts | 3개 세션 제한 |
| AC-5 | 로그인 실패 시 계정 잠금 | ✅ | auth.service.ts L27-35 | 10회 실패 시 잠금 |
| AC-6 | 비밀번호 복잡성 규칙 | ✅ | auth.service.ts | 12자+대소문자+숫자+특수 |
| AC-7 | 비밀번호 주기적 변경 (90일) | ✅ | auth.service.ts | passwordChangedAt 기반 |
| AC-8 | 환자 정보 접근 권한 분리 | ✅ | FieldMaskInterceptor | 역할별 필드 마스킹 |
| AC-9 | 긴급 접근 (Break the Glass) | ✅ | btg.guard.ts | 긴급 접근 로그 기록 |

## 2. 감사 추적 (Audit Trail)

| # | 요구사항 | 현재 상태 | 구현 위치 | 비고 |
|---|---------|:--------:|----------|------|
| AT-1 | 생성/수정/삭제 이력 기록 | ✅ | audit.interceptor.ts | 16개 리소스 타입 |
| AT-2 | 조회 이력 기록 (PHI) | ✅ | audit.interceptor.ts | PHI READ 패턴 7건 |
| AT-3 | 기록 변조 방지 | ⚠️ | AuditLog 모델 | DB 레벨, 블록체인 옵션 |
| AT-4 | 감사 로그 보관 (5년) | ⚠️ | - | 아카이빙 정책 미수립 |
| AT-5 | 사용자별 접근 이력 조회 | ✅ | audit.controller.ts | 관리자 조회 API |
| AT-6 | 비정상 접근 탐지 | ⚠️ | anomaly-detection.service.ts | 기본 구현 |

## 3. 데이터 보호 (Data Protection)

| # | 요구사항 | 현재 상태 | 구현 위치 | 비고 |
|---|---------|:--------:|----------|------|
| DP-1 | 전송 중 암호화 (HTTPS/TLS) | ✅ | nginx | Let's Encrypt SSL |
| DP-2 | 저장 시 암호화 (민감 데이터) | ✅ | encryption.service.ts | AES-256-GCM |
| DP-3 | 주민등록번호 마스킹 | ✅ | encryption.service.ts | 720108-1****** |
| DP-4 | 입력 데이터 검증 | ✅ | ValidationPipe + SanitizePipe | whitelist + XSS 방지 |
| DP-5 | SQL Injection 방지 | ✅ | Prisma ORM | 파라미터 바인딩 |
| DP-6 | XSS 방지 | ✅ | SanitizePipe + DOMPurify | 글로벌 적용 |
| DP-7 | 보안 헤더 (CSP/HSTS) | ✅ | helmet + CSP | A+ 등급 |
| DP-8 | API 응답 압축 | ✅ | compression | gzip, 1KB↑ |

## 4. 전자서명 (Digital Signature)

| # | 요구사항 | 현재 상태 | 구현 위치 | 비고 |
|---|---------|:--------:|----------|------|
| DS-1 | 처방전 전자서명 | ✅ | document-sign/ | 블록체인 앵커링 |
| DS-2 | 진단서 전자서명 | ✅ | blockchain-cert/ | 인증서 기반 |
| DS-3 | 서명 위변조 검증 | ✅ | blockchain-anchor/ | SHA-256 해시 |
| DS-4 | 서명자 본인 확인 | ✅ | consent/ | 동의서 + 서명 |

## 5. 백업 및 복구 (Backup & Recovery)

| # | 요구사항 | 현재 상태 | 구현 위치 | 비고 |
|---|---------|:--------:|----------|------|
| BR-1 | 정기 백업 (일 1회) | ⚠️ | - | 수동 pg_dump |
| BR-2 | 백업 암호화 | ❌ | - | 미구현 |
| BR-3 | 복구 절차 문서화 | ❌ | - | 미수립 |
| BR-4 | 재해 복구 계획 (DRP) | ❌ | - | 미수립 |

## 6. 시스템 관리 (System Management)

| # | 요구사항 | 현재 상태 | 구현 위치 | 비고 |
|---|---------|:--------:|----------|------|
| SM-1 | 시스템 가용성 (99.5%+) | ⚠️ | pm2 | 모니터링 없음 |
| SM-2 | 환경 분리 (개발/운영) | ⚠️ | .env | 단일 서버 |
| SM-3 | 변경 관리 절차 | ✅ | git + PDCA | 커밋 이력 |
| SM-4 | 보안 업데이트 절차 | ⚠️ | - | npm audit만 |

---

## 종합 점수

| 영역 | 항목 수 | 충족 | 미충족 | 충족률 |
|------|:------:|:----:|:-----:|:-----:|
| 접근 통제 | 9 | 9 | 0 | **100%** |
| 감사 추적 | 6 | 4 | 2 | **67%** |
| 데이터 보호 | 8 | 8 | 0 | **100%** |
| 전자서명 | 4 | 4 | 0 | **100%** |
| 백업/복구 | 4 | 0 | 4 | **0%** |
| 시스템 관리 | 4 | 1 | 3 | **25%** |
| **합계** | **35** | **26** | **9** | **74%** |

## 미충족 항목 개선 우선순위

| 우선순위 | 항목 | 작업 |
|:--------:|------|------|
| P0 | BR-1 | pg_dump cron 자동 백업 |
| P0 | BR-2 | GPG 암호화 백업 |
| P1 | BR-3 | 복구 절차 문서화 |
| P1 | AT-4 | 감사 로그 5년 아카이빙 정책 |
| P2 | BR-4 | 재해 복구 계획 (DRP) 수립 |
| P2 | SM-1 | APM 모니터링 (P3-4) |
| P2 | SM-2 | 스테이징 환경 구축 |
| P2 | AT-3 | 블록체인 감사 로그 앵커링 |
| P3 | SM-4 | 보안 업데이트 자동화 |
