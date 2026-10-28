# 성능·보안 검토·보완 계획 (2026 H2)

> 작성: 2026-07-04 / 상태: Plan v1.0
> 성격: 기존 [performance-security-enhancement.plan](performance-security-enhancement.plan.md)(2026-05)·[security-governance-master.plan](security-governance-master.plan.md)(G1~G7)의 **델타 갱신 + 신규 자산 검토 + 잔여 백로그 종결**. 기준선 재수립이 아니라 **미검토분 감사 + 열린 항목 마감**.
> 한 줄: 최근 확장(임상차트 엔진·검진해석·CPOE·RADS 등 신규 모델/엔드포인트)을 성능·보안 관점에서 감사하고, 이미 식별된 잔여 백로그를 운영 제약(공용 DB·db push 차단·OpenPACS·pm2) 내에서 단계적으로 닫는다.

---

## 0. 배경 — 이미 견고한 것 (재작업 금지)
- **보안 기준선**: Helmet·CORS·JWT(HttpOnly refresh)·RBAC·ThrottlerGuard(전역)·ValidationPipe(whitelist)·AES-256-GCM(주민번호 등)·감사 해시체인·Webhook HMAC. G1(파기 프레임)·G2(SSRF safeFetch)·G3(암호화 헬퍼) **해소**.
- **성능**: N+1 다수 제거·groupBy·FK 인덱스(CONCURRENTLY)·GIN(pg_trgm)·Redis 캐시.
→ 본 계획은 **위를 다시 하지 않는다.** 아래 ①미검토 신규자산 ②열린 백로그만 다룬다.

## 1. 미검토 신규 자산 (2026-06~07 확장 · 감사 필요)
최근 세션에서 추가돼 성능·보안 정식 검토를 아직 안 받은 것:
- 임상차트 엔진: `ClinicalChartResult`·`ClinicalChartVerification`(신규 모델·EP)·`/clinical-tools`·RADS 패널·편집기.
- 검진해석: `CheckupExplainerContent`·`CheckupExplainerReview`(신규 모델)·감수 콘솔·가드레일.
- CPOE 결선: 레지멘→처방 초안 생성 경로.
- 전문과 프리셋·필드정합 교정·감사보류 EP(therapy patient·vitals nurse).

## 2. 성능 트랙

### 2-A DB (운영 제약 = 공용 postgres 5DB·db push 차단)
| 항목 | 상태/조치 |
|------|-----------|
| **pg_stat_statements 활성화** | ⏳ 점검창 대기(preload·재시작 = openpacs·shuttlepass 공유 영향). 활성 후 상위 쿼리 프로파일 → 인덱스/재작성 근거 확보 |
| **MV·manual SQL 미적용분** | ✅ **운영 대조 완료(2026-07-05)** — 아래 박스 참조. 신규 인덱스·GIN·최근 manual SQL **전부 반영**, MV 3종만 미적용(무참조·영향 0) |
| **GIN 인덱스 테이블명 버그** | ✅ **해소 확인** — 운영에 `idx_patients_family_trgm`·`idx_patients_given_trgm`·`idx_{diagnosis,medication,procedure}_codes_nameko_trgm`·encounters/notes 등 **snake_case·gin_trgm_ops 9종 반영**(PR#264). pg_trgm 확장 존재. 과거 PascalCase 버그 재발 없음 |
| **신규 모델 인덱스 검증** | ✅ 운영 반영: ccr(idx_ccr_patient_chart·idx_ccr_encounter·idx_ccr_patient_performed)·ccv(idx_ccv_chart_created)·explainer_contents(idx_cec_status+unique test_code)·explainer_reviews(idx_cer_content_created) |
| **Redis maxmemory·eviction** | ⚠️ **운영 점검 완료(2026-07-05)** — 실행 config **드리프트**: `maxmemory 0`(무제한)·`noeviction`. compose 의도(`512mb·allkeys-lru`)와 불일치(prod.yml 미적용). 아래 박스 참조. **공유 인스턴스라 점검창 필요** |

> **✅ DB 운영 대조 완료 (2026-07-05 · `docker exec docker-postgres-1 psql -d hospitalrun` read-only)**
> | 자산 | 기대 | 운영 실측 | 판정 |
> |------|------|-----------|------|
> | 신규 4테이블(ccr·ccv·explainer_contents·explainer_reviews) | 존재 | 전부 존재 | ✅ |
> | 신규 인덱스(perf 포함 6종) | manual SQL | 6종 전부 생성(`idx_ccr_patient_performed` 등) | ✅ |
> | 검색 GIN/pg_trgm(환자명·코드명·SOAP·노트) | snake_case | 9종 + pg_trgm 확장 반영 | ✅ 버그 해소 |
> | 최근 07-04/05 manual SQL 인덱스 | 11종(egp·dr·pacu·nb·lpr·path) | 11종 전부 생성 | ✅ manual 적용 규율 정상 |
> | 경영 MV(mv_monthly_revenue·mv_department_monthly·mv_daily_bed_occupancy) | materialized_views.sql | **0건(미적용)** | ⚠️ 단 **코드 참조 0**(대시보드 라이브 쿼리) → 런타임 영향 없음·지연 최적화(pgss 점검창 백로그와 일치) |
>
> **결론**: 인덱스·GIN·신규 테이블은 **완전 반영**(db push 차단 환경에서도 manual SQL 적용 규율 건전). 미적용은 **경영 MV 3종뿐이며 무참조라 무해** — 필요 시 P3 점검창에서 생성 + `REFRESH … CONCURRENTLY` cron 배선. **긴급 조치 불요.**

> **⚠️ Redis 운영 점검 (2026-07-05 · `docker exec docker-redis-1 redis-cli` read-only)**
> - **실행 config 드리프트**: HIS 접속 인스턴스(`docker-redis-1`, `REDIS_URL=redis://localhost:6379`)는 `maxmemory=0`(무제한)·`maxmemory-policy=noeviction`. compose(`docker-compose.yml`/`.prod.yml`)의 `--maxmemory 512mb --maxmemory-policy allkeys-lru`가 **미적용**(prod.yml 미적용 = 알려진 배포 방식과 일치, pm2 운영).
> - **공유 인스턴스**: 키 구성 = HIS(`session:`·`refresh:sess:`·`sessions:`·`cache:`·`audit:pending`) + **OpenPACS**(`pacs:governance:*`·`pacs:vrt:*`) + **Celery계열**(`celery-task-meta-*`·`_kombu.binding.*`). → CLAUDE.md "6379 Redis 공유"·OpenPACS 도메인 포함. **단독 변경 금지 → 점검창+합의 필요**(pgss와 동일 등급).
> - **현재 실측 위험 = 낮음**: `used_memory 2.65M`·`DBSIZE 1120`·`evicted_keys 0`. 키 **거의 전부 TTL 보유**(session/refresh 1~7일·cache setex·celery task 수시간·무TTL은 kombu 바인딩 11개뿐) → 무제한이라도 TTL 만료로 사실상 자기제한, OOM 미발생.
> - **잠재 위험**: 상한 부재 → 특정 컴포넌트가 무TTL 키 누수 시 OOM, `noeviction`이라 **쓰기 실패**(신규 세션·캐시 write 거부) = 인증/캐시 부분 장애.
> - **권고(점검창 적용)**: `maxmemory 512mb` **상한 부여**(폭발반경 제한) + 정책은 **`volatile-lru` 권장**(compose의 `allkeys-lru`보다 안전 — TTL 없는 키는 절대 evict 안 함 → HIS 세션·PACS 거버넌스 키 보호). compose 주석도 allkeys-lru의 세션 evict 위험을 스스로 경고 → **compose/prod.yml도 `volatile-lru`로 교정** 권장(재시작 시 재발 방지). 무중단 적용은 `CONFIG SET`(비파괴)이나 공유자원이라 **합의 후**.
> - **결론**: 즉시 장애 위험 없음(현재 tiny·TTL 자기제한). **상한 부재는 정정 대상이나 공유 인스턴스라 단독 변경 불가** → P3 DB 점검창(OpenPACS·shuttlepass 합의)에 **Redis `maxmemory 512mb`+`volatile-lru` 설정 + compose 교정** 동반 처리.

### 2-B API (N+1·페이로드)
- **신규 EP N+1 스윕**: clinical-chart-result·checkup-explainer(findAll이 contents+reviews 로드·소량이나 성장 대비 페이지네이션)·RADS 패널·CPOE 조회. `include` 과다/누락 대조.
- **응답 페이로드·페이지네이션**: take 상한(현재 100/200/50 혼재) 일관화·큰 목록 커서/페이지 검토.
- **ThrottlerGuard 튜닝**: 현 전역 200/분. 신규 저작/검색 EP·AI 호출 개별 한도 재검토.

> **✅ N+1 스윕 완료 (2026-07-05) — 신규 자산 결함 없음**:
> - `checkup-explainer.findAll`: contents(take 500) → reviews를 `contentId in [ids]` **단일 배치 쿼리**(take 5000) + 인메모리 Map 그룹핑 → **N+1 아님**(올바른 패턴). contents는 testCode당 1건 curated set이라 실제 카디널리티 «500.
> - `clinical-chart-verification.getSummary`: 전건 1쿼리(take 20000·안전상한 주석) + 인메모리 chartId 그룹핑 → N+1 아님. `findHistory` take 200 단일.
> - `clinical-chart-result.findByPatient`: take 100 단일. RADS/CPOE는 별도 BE 표면 없음(FE 영속).
> - **결론**: take 상한은 데이터 카디널리티 대비 안전. 페이지네이션은 curated 소량이라 지연 가능. **코드 변경 불요**(take 상한 일관화는 미관 개선 백로그).

### 2-C FE
- 번들/지연로딩: 신규 페이지(clinical-tools·admin 콘솔)·ChartRenderer·RADS 패널 dynamic import 점검. lib/clinical-charts 89종 정의 트리셰이킹·초기 로드 영향.
- 반복 렌더/쿼리 캐시: useChartVerifications 등 공유 캐시 staleTime 적정성.

## 3. 보안 트랙

### 3-A 인가·PHI 스코프 (신규 EP 집중)
- **신규 엔드포인트 authz 스윕**: clinical-chart-result·verification·checkup-explainer 전부 JwtAuthGuard+RolesGuard 확인(✅ 설계상). **환자 스코프**: `GET /clinical-chart-results?patientId=`가 임의 환자 조회 가능한지(교차열람·BTG·동의 정책 정합) — 타 차트 EP와 동일 기준인지 대조.
- **감수 콘텐츠 소비자 미노출** 재확인(explainer는 직원 가드만·포털 EP 0).

> **✅ authz 스윕 완료 (2026-07-05)** — 신규 자산 3종 컨트롤러 감사 결과 **취약점 없음·전부 규범 정합**:
> | EP | 가드 | 역할 | 판정 |
> |----|------|------|------|
> | `clinical-chart-result` (GET/POST) | JwtAuthGuard+RolesGuard·`@Public` 0 | DOCTOR/NURSE/ADMIN (READ 제외) | ✅ `GET ?patientId=`는 per-patient 스코프 없으나 **`nursing-note`·`encounter` 등 타 차트 EP와 동일 규범**(광역 임상열람·감사 보상통제). BTG guard는 dead code(어느 컨트롤러에도 미적용 — [btg-care-team-scope](btg-care-team-scope.plan.md) 지적과 일치)라 이 EP만 다르게 강제할 근거 없음. **변경 불요** |
> | `clinical-chart-verification` (GET summary/history) | JwtAuthGuard+RolesGuard | +READ 허용 | ✅ 대상이 **차트 템플릿 메타(chartId=템플릿)**·환자 PHI 아님 → READ 허용 무방 |
> | `checkup-explainer` (전 EP) | JwtAuthGuard+RolesGuard | DOCTOR/ADMIN | ✅ 저작/감수 콘텐츠(환자 PHI 아님)·**포털/소비자 EP 0**(규제 게이트 준수). 소비자 노출은 별도 EP에서 APPROVED 연결 예정 |
>
> RADS 패널·clinical-tools는 별도 BE 컨트롤러 없음(FE가 `clinical-chart-result`로 영속) → 신규 authz 표면 아님.
> **결론: 코드 변경 없음.** 환자 스코프 강화가 필요하면 이는 이 EP 국소 이슈가 아니라 **전 임상 EP 공통 정책 변경**(교차열람 게이트·BTG 재활성)으로 다뤄야 함 → [btg-care-team-scope](btg-care-team-scope.plan.md) 트랙.

### 3-B 입출력 안전
- **XSS 전체 적용**(기존 ⚠️: CMS만): 신규 저작 콘텐츠(explainer plain*·차트 정의 표시)·사용자 입력 렌더 경로 sanitize 확대.
- **가드레일 강건화**: checkup-explainer guardrail은 방어적 휴리스틱 — 정규식 우회 케이스·다국어 확대 검토(1차 안전은 감수/RAG 유지).
- **Formula/불린 파서**: eval 미사용(✅)·입력 상한 확인.

> **✅ XSS 스윕·교정 완료 (2026-07-05)**
> - **신규 저작 콘텐츠(explainer·chart verification·clinical-tools)**: FE에서 **`dangerouslySetInnerHTML` 미사용**(React 자동 이스케이프) → **XSS 표면 없음**. sanitize 확대 불요.
> - **🔴 발견·교정 — 문서 HTML 생성기 저장형 XSS**(사용자/DB 필드를 이스케이프 없이 HTML 보간 → FE가 `dangerouslySetInnerHTML`/`document.write`/`text/html` 로 무sanitize 렌더). **API 내 `<html>` 생성기 전수 감사**:
>   | 파일 | 벡터 | 렌더 경로 | 조치 |
>   |------|------|-----------|------|
>   | `referral-letter.service.ts` `generateHtml` | 환자명·MRN·과명·의사명(본문 content는 기이스케이프) | ReferralTab/consultations `previewHtml` dsih + 인쇄 `document.write` | 전 필드 이스케이프 |
>   | `portal.service.ts` `getCheckupResultHtml` | doctorOpinion·recommendations·testName·환자명(**환자 대면**) | portal `checkup-visits/:id/result-pdf` `res.send(text/html)` | 전 필드 |
>   | `registration-consent.service.ts` `generatePrintHtml` | 환자명(sections는 정적 상수라 안전) | consent `print` `res.send(text/html)` | `esc(patientName)` |
>   | `medical-record-copy/pdf-generation.service.ts` `renderHtml` | 환자명·MRN(sections는 기이스케이프) | encounter/discharge/lab/checkup 기록 `res.send(text/html)` | 환자정보 라인 이스케이프 |
> - **이미 안전**(변경 없음): 같은 파일의 `renderConsentHtml`은 이미 `esc()` 전면 적용·`medical-records/search`는 `sanitizeHtml`·checkup PDF는 `renderHtml` 경유(커버). `document.service`(헤드리스 browserless)는 위 인쇄페이지 URL을 렌더 → 소스 이미 교정, 헤드리스는 세션 무관.
> - **범위 외**(다른 리스크 클래스): `crm/crm-channel.service.ts` `renderEmailTemplate`은 **staff 저작 마케팅 이메일 HTML**(외부 메일 클라이언트·샌드박스, 앱 DOM/세션 아님)·리치 포맷 의도 → 블랭킷 이스케이프 부적합. 통제는 저작 시점 sanitize(별도).
> - **공용 유틸 추출**: `common/util/html-escape.ts`(`escapeHtml`) 신설, 4개 생성기의 인라인 `esc` 중복 제거(`escapeHtml as esc` 별칭 import). `pdf-generation`의 기존 `function esc`도 통합.
> - **신규 저작 콘텐츠(explainer·chart·clinical-tools)**: FE `dangerouslySetInnerHTML` 미사용(React 자동 이스케이프) → XSS 표면 없음.
> - **tsc 통과**. **배포**: 1차 3종 `07bff553`→`deploy.sh --api` 반영. 2차(renderHtml + 공용 유틸)는 후속 배포.

### 3-C 거버넌스 잔여 갭 (security-governance-master G4~G7)
| 갭 | 상태 | 조치 |
|----|------|------|
| G3 암호화 필드 **자동화(미들웨어)** | ⚠️ 헬퍼만 | 필드별 백필 게이트 후 전역화(이중암호화 회피) |
| G4 **감사로그 장기 아카이빙**(S3/콜드·TTL) | ⚠️ 앵커링만 | 보존/아카이브 정책 코드화(법정 접속기록 1년+) |
| G5 **mTLS/egress 통제** | ❌ | sign·NHIS·ERP 운영전환 선결 |
| G6 4-eyes | 부분 | 신규 검수(임상차트·검진해석) 이미 4-eyes 골격 — 재무/파기 등 확대 |
| G7 쿠키 | ✅(refresh httpOnly) | access localStorage 잔여 위험 재평가 |

### 3-D 외부연동 (ERP 하드닝 잔여)
- S-2 재무 웹훅 본문 HMAC+ts·S-3 대상별 인가(IDOR) — 미완분 점검·마감.

### 3-E 시크릿·키
- HSM 키 수탁(별도 기획)·ENCRYPTION_KEY SPOF·JWKS RS256 평문(P0 기록) 상태 재확인.

## 4. 방법·단계
| Phase | 내용 | 산출 | 게이트 |
|-------|------|------|--------|
| P1 감사(읽기) | 신규 자산 성능(N+1·인덱스·페이로드)·보안(authz·PHI·XSS) 병렬 감사 | 리포트 + 심각도 순위 | 없음 |
| P2 저위험 교정 | 페이지네이션·XSS 확대·인덱스 운영대조·throttler 튜닝·페이로드 슬림 | PR(무점검창) | 없음 |
| P3 DB 점검창 | pgss 활성→프로파일→인덱스/MV 적용 | 쿼리 프로파일·인덱스 | **점검창(공용DB 합의)** |
| P4 거버넌스 마감 | G4 아카이빙·암호화 자동화·ERP S-2/S-3 | PR·정책 | 법무/인프라 |
| P5 mTLS/HSM | G5·키수탁 | — | 인프라 조달·별도 기획 |

## 5. 운영 제약(준수)
- **공용 postgres 5DB**(openpacs·shuttlepass 포함) → pgss·튜닝·재시작은 **점검창+합의** 선결. `hospital`/`secret` 비번 불변.
- **db push 차단** → 인덱스/스키마는 manual SQL + 서버 prisma generate.
- **OpenPACS 경로/서비스 수정 금지**·`docker compose restart api web`만.
- **배포=worktree rsync**·BE 후 nest build.

## 6. 리스크
| 리스크 | 대응 |
|--------|------|
| pgss/튜닝 점검창 지연 | P1·P2(점검창 무관)를 선행·병렬 |
| PHI 스코프 과대(임의 환자 조회) | authz 스윕 최우선·타 차트 EP 기준 정합 |
| 가드레일 우회 | 1차 안전(감수/RAG) 유지·필터는 보조·케이스 확장 |
| 이중암호화(자동화) | 필드별 백필 게이트 |

## 7. 사람/조직 게이트
- DB 점검창 합의(OpenPACS·shuttlepass) · 법정 보존기간 확정(파기/아카이빙) · HSM 조달 · mTLS 인증서.
