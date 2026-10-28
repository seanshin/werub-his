# 데이터 품질 대시보드 전면 확장 + AI 컨시어지 기획서 (v2 — 상세 검증판)

- **일자**: 2026-07-24 (v1 당일 상세 검토·보완 — 전 지표 소스 필드 스키마 실측 검증 완료)
- **발단**: 환자 관리 '데이터 품질 대시보드'(6지표)의 전 도메인 반영 검토 + AI 컨시어지 결합
- **상태**: 🔴 **P0~P3 구현 완료(계획 초과) — 2026-08-31 재실측 정정**. 이 문서는 10도메인 25지표
  기획이었으나 실제 구현은 **17도메인·46+지표**(2026-08 시드 흐름 전수 검토로 emergency·surgery·
  imaging·checkup·nursing·safety·master·voc 도메인 추가). 실제 경로는 `/api/v1/data-quality`.
  C1 브리핑·C2 스코어링·C3 아웃리치·C4 정규화 구현. **C5(medical-ai ToolRegistry 도구 2종)만 미확인**.
  후속 갭은 `patient-management-quality-enhancement-2026-08.plan.md`(Track B) 참조.

## 1. 현행 실측

`GET /patients/quality-dashboard` (ADMIN 한정) — 환자 6지표: 전화 미등록 825 · 보험 미확인 873 · 주소 미등록 865 · 1년 미내원 0 · 중복 의심 81 · 사진 미등록 873.

**현행 결함 (P0 수리 대상)**:
| # | 결함 | 근거 |
|---|------|------|
| L1 | 카운트 전용·드릴다운 없음 | QualityCard 표시 전용 — PR#669 서버 필터와 미연동 |
| L2 | 미내원 판정=`updatedAt`(수정만 있어도 내원 간주 → 0명 오판정) | patient.service.ts:930 |
| L3 | 중복=이름+생일 완전일치만(로마자/한글 변형·오탈자 미탐지) | $queryRaw GROUP BY |

## 1.5 v2 검증 결과 — 사실 교정 3건 + 확정 자산

스키마·모듈 실측으로 v1 가정을 전수 검증한 결과:

| # | v1 가정 | 실측 | 교정 |
|---|---------|------|------|
| 교정1 | 면허 만료 소스=Staff.licenseNumber | Staff에는 **만료일 없음**. 정본=**StaffCredential**(type LICENSE·`expiresAt`·status VALID/EXPIRED·`@@index([expiresAt])` 기존재) | 지표 소스를 StaffCredential로 교체 — 인덱스까지 준비돼 있어 즉시 산출 가능 |
| 교정2 | '병상등급 미지정' 지표 | Bed.bedClass는 `@default("GENERAL")` NOT NULL — **미지정 상태가 존재 불가** | 지표 폐기 → 대체: **입원료 기본코드 폴백 사용률**(BillingItem→procedureCode.code=`inpatient.stayBilling.defaultCode` 비율 — bedRateCodes 미매핑 등급의 실사용 관측) |
| 교정3 | C5=concierge 모듈에 도구 등록 | concierge에는 도구 구조 없음(상담 에스컬레이션 전용). **medical-ai `ToolRegistry`**(builtin+enterprise tools·`register(tool)`) 가 정본 통합점 | C5를 ToolRegistry 도구 2종(quality_summary·quality_worklist) 등록으로 재설계 |

**확정 자산(실측)**: 위급값 read-back=`CriticalValueAlert.status(PENDING/ACKNOWLEDGED)+readBackConfirmed` 전용 모델 기존재 · 병합=`POST /patients/merge` 실존(C2는 후보 공급만) · 아웃리치 수신동의=`PatientAccount.marketingConsent`(계정 단위 — §3 C3 경계에 반영) · Appointment enum에 NO_SHOW 기존재.

## 2. 지표 명세 (도메인 10종 — 전 지표 판정 기준·딥링크·임계 확정)

표기: **판정** = where 조건(스키마 실측 필드) / **링크** = 워크리스트 딥링크 / **임계** = 기본 경고 기준(`quality.threshold.*` config·% 또는 건수).

### 2.1 환자 (현행 6 + 개선 2)
| 지표 | 판정 | 링크 | 임계 |
|------|------|------|------|
| 전화/주소/사진/보험 미등록 | 현행 유지(null 판정) | `/patients?quality=noPhone` 등 — **quality 파라미터 신설**(buildWhere 확장) | 20% |
| 미내원 1년↑ **(L2 수리)** | `encounters.none({ createdAt: { gte: -365d } })` — updatedAt 폐기 | `/patients?quality=dormant` | 정보성 |
| 중복 의심 **(L3 개선)** | 1차=완전일치(현행) + P2에서 C2 후보쌍(§3) | `/patients?quality=dupSuspect`(후보쌍 목록 모달) | 건수>0 |
| 국적 불일치 의심(신규) | nationality IN (KR,null) AND 이름 전체가 비한글(정규식) | `/patients?quality=nationalitySuspect` | 정보성 |

### 2.2 진료기록
| 지표 | 판정 | 링크 | 임계 |
|------|------|------|------|
| 미서명 방치 | Encounter.status=DRAFT AND createdAt < now-48h | `/encounters?status=DRAFT`(담당의별 집계 동봉) | 10건 |
| 진단코드 없는 서명 진료 | status IN (SIGNED,AMENDED) AND diagnoses.none() | 동일 목록 필터 | 5% |

### 2.3 처방/오더
| 지표 | 판정 | 링크 | 임계 |
|------|------|------|------|
| 오더 접수 방치 | Order.status=ORDERED AND receivedAt=null AND createdAt < now-24h | `/orders?dept필터` | 10건 |
| DUR 오버라이드 사유 부실 | durOverrideReason NOT NULL AND length<10 | 처방 목록 | 건수>0 |

### 2.4 검사
| 지표 | 판정 | 링크 | 임계 |
|------|------|------|------|
| 위급값 미확인 | CriticalValueAlert.status=PENDING (기존 인덱스 [status, notifiedAt]) | `/lab`(위급값 탭) | **1건(CRITICAL)** |
| read-back 미확인 | ACKNOWLEDGED AND readBackConfirmed=false AND 24h↑ | 동일 | 건수>0 |

### 2.5 입원 · 2.6 청구 · 2.7 외국인 · 2.8 동의서 · 2.9 직원 · 2.10 예약
| 지표 | 판정 | 링크 | 임계 |
|------|------|------|------|
| 퇴원요약 미완(퇴원 후) | Admission DISCHARGED AND DischargeSummary(status=DRAFT or 부재) | 입원 목록 | 5건 |
| 재원 주치의 미지정 | ADMITTED AND attendingDoctorId=null | 입원 목록 | 건수>0 |
| 입원료 폴백코드 사용률(교정2) | 입원료 라인 중 code=defaultCode 비율(최근 30일) | `/admin/codes` | 50% |
| 이행 후 미청구 | Billing PAID/PARTIAL AND claim 부재 AND 30일↑ | `/claims` | 정보성 |
| 여권 만료 임박/경과 | passportExpiry < now+90d (foreigner) | `/patients?foreigner=Y&quality=passportExpiring` | 건수>0 |
| 언어판 동의서 갭 | 외국인 preferredLanguage에 해당 language ConsentTemplate 부재 | `/admin/consent-templates` | 정보성 |
| 동의서 의사서명 누락 | patientSignedAt NOT NULL AND doctorSignedAt=null AND 72h↑(DOCTOR_CONSENT_TYPES 한정) | 동의서 목록 | 5건 |
| 동의서 만료 임박 | expiresAt < now+7d AND status=SIGNED | 동일 | 정보성 |
| 면허/자격 만료(교정1) | StaffCredential.expiresAt < now+60d OR status=EXPIRED | `/hr`(자격 탭) | **1건(EXPIRED)** |
| 보고라인 없는 직원 | Staff.managerStaffId=null AND status=ACTIVE(결재 불가 유발 — ess 실장애 사례) | `/hr` | 건수>0 |
| 노쇼율(30일) | NO_SHOW / 전체 예약 | `/schedule` | 15% |
| 연락처 없는 예약 | 미래 예약 AND patient.phone=null(리마인드 불가) | `/schedule` | 건수>0 |

## 2.5+ 아키텍처 (구현 계약)

```ts
// data-quality 모듈 — 지표 레지스트리(코드 등록제·안전게이트 관제 패턴)
interface QualityMetric {
  key: string;              // 'patient.noPhone'
  domain: string;           // 'patient' | 'encounter' | ...
  label: string;
  compute: (prisma) => Promise<{ value: number; total?: number }>;
  drillDown: string;        // FE 딥링크(워크리스트 필수 규약)
  thresholdKey?: string;    // config quality.threshold.<key> (기본값 DEFAULTS 등록)
  severityWhenOver: 'INFO' | 'WARNING' | 'CRITICAL';
  roles: UserRole[];        // 노출 대상(P1 ADMIN·P2 도메인 역할)
}
```

- **EP**: `GET /data-quality/summary?domain=` → `{ domains: [{ domain, metrics: [{ key,label,value,total,threshold,over,drillDown }] }] }` / `GET /data-quality/trend?key=&days=` (스냅샷)
- **스냅샷**: 모델 1개 `QualityMetricSnapshot { id, metricKey, value, total, capturedOn @db.Date }` — 일일 크론 **06시**(보존정리 5시·자동종결 4시와 분산). @@unique([metricKey, capturedOn]) 멱등. **숫자만 저장(개인정보 0)**·보존 365일(동일 크론에서 삭제)
- **config**: `quality.domains`(노출 도메인 배열) · `quality.threshold.*`(지표별) · `quality.ai.enabled`(OFF) · `quality.snapshot.retentionDays`(365)
- **FE**: `/admin/data-quality`(도메인 탭·임계 초과 강조·추이 스파크라인·전 카드 딥링크) + 환자 페이지 기존 카드 유지(딥링크만 연결). 신규 화면은 CLAUDE.md UX 규약(KDate·StatusBadge·pollMs) 적용

## 3. AI 컨시어지 (WeRU.B) — 입출력 계약 확정

거버넌스 공통: `quality.ai.enabled` OFF 기본 · aiFetch 단일 경로(kill switch·disclaimer·AI_EGRESS 감사) · **쓰기 0(전부 초안/제안)** · 진단·임상 판단 금지.

| # | 기능 | AI 입력(전달 허용) | AI 출력 | PHI 경계 |
|---|------|--------------------|---------|----------|
| C1 | 품질 브리핑 | 지표 스냅샷 JSON(key·value·threshold·7일 델타) **만** | 우선순위 3건+조치 순서 문단(disclaimer 동봉) | 환자 식별자 0 — 집계 숫자만 |
| C2 | 중복 스코어링 | 후보쌍 필드: 이름(정규화 후)·생일·성별·전화 뒤4자리 — **MRN/주소/주민번호 금지** | `{ pairId, score 0~1, reason }` — score≥0.8만 병합 후보 노출 | 후보쌍 생성은 코드(초성·로마자 정규화·생일±0), AI는 판별 보조. 병합 확정=사람(`POST /patients/merge` 기존) |
| C3 | 아웃리치 초안 | 유형(리콜/정보갱신/여권만료)·언어코드·병원명 — **환자명 미전달(치환 토큰 `{{name}}`)** | 언어별 메시지 초안(치환 토큰 포함) | 대상=PatientAccount.marketingConsent=true 한정(실측 필드). 발송=상담데스크 사람. 무계정/미동의 환자는 목록만 제공(연락은 사람 판단) |
| C4 | 정규화 제안 | 원값·목표 형식(전화 E.164·국적 ISO3) | `{ id, before, after }` 목록 | 적용=관리 화면 diff 일괄 승인(원본 감사 보존). 주소 구조화는 P3 후순위(오적용 위험) |
| C5 | 챗 도구(교정3) | medical-ai **ToolRegistry**에 `quality_summary`·`quality_worklist` 등록 | 기존 챗 응답 규약 | 도구 내부에서 요청자 역할 검증(§2 roles) — 권한 밖 도메인 거부 |

**실패 폴백**: AI 불가(kill switch/타임아웃) 시 C1=규칙 기반 요약(임계 초과 나열)·C2=완전일치만·C3~C5=기능 비노출(빈 상태 안내) — 대시보드 본체는 AI 무관 동작.

## 4. Phase (파일 수준)

| Phase | 내용 | 주요 파일 | 게이트 |
|-------|------|----------|--------|
| **P0** (1일) | L1 드릴다운(`quality=` 파라미터 buildWhere 확장)·L2 encounter 기준 수리·registry 골격+환자 지표 이식 | patient.service/dto·data-quality.module/service(신규)·patients/page.tsx | 없음(수리) |
| **P1** (2일) | 도메인 4종(진료·오더·입원·외국인)+`/admin/data-quality`+스냅샷 모델·크론(--schema) | data-quality providers 4·admin/data-quality/page.tsx·schema+DEFAULTS | `quality.domains` |
| **P2** (2일) | 도메인 6종 잔여+C1 브리핑+C2 스코어링(후보쌍 생성기+병합 화면 연동) | providers 6·quality-ai.service·중복 후보 모달 | `quality.ai.enabled` OFF |
| **P3** (2일) | C3 아웃리치(다국어)·C4 정규화 diff 승인·C5 ToolRegistry 2종 | outreach/normalize service·medical-ai tools | 개별 게이트 OFF |

## 5. 결정 사항 — v2 권고 확정

1. **노출 권한**: P1=ADMIN 한정 → P2에서 §2 roles로 도메인 역할 확장(예: 검사 지표=LAB_TECH) ✅권고 확정
2. **C3 발송**: 초안 생성까지만 — 발송 채널(알림톡/SMS)은 dev-simulation 레지스트리 스텁 관례로 P3 이후 별도 트랙 ✅
3. **C2 병합**: 기존 merge EP 재사용 확정(실측) — C2는 후보 공급자만 ✅
4. **스냅샷**: 365일·숫자만·[metricKey, capturedOn] 멱등 ✅
5. (신규) **여권 만료 등 외국인 지표**는 외국인등록 화면(/patients/foreign 계열)에도 임베드 — 담당 부서(국제진료) 시야 확보

## 6. 재사용 자산 맵 (v2 확정)

안전 게이트 관제(레지스트리+관제 UI) · PR#669 서버 필터+filter-options(드릴다운) · aiFetch 거버넌스(kill switch·disclaimer·AI_EGRESS) · **medical-ai ToolRegistry(C5 통합점 — 교정3)** · `POST /patients/merge`(C2) · PatientAccount.marketingConsent(C3 경계) · CriticalValueAlert 모델(2.4 그대로) · StaffCredential expiresAt 인덱스(2.9) · i18n 번역(C3) · dev-simulation(발송 스텁) · KDate/StatusBadge/pollMs(FE 규약)

## 7. 리스크·함정 (기존 교훈 반영)

- **$queryRaw**: uuid IN 시 `::text` 캐스팅·raw는 snake_case 실컬럼(기존 함정 메모리) — 중복 후보쌍 쿼리 해당
- **집계 성능**: 지표 대부분 count(인덱스 有)이나 encounters.none(-365d)류는 EXPLAIN 확인·필요 시 인덱스 추가는 수동 DDL(Prisma unique 함정 관례)
- **크론 시간 분산**: 04시 응급자동종결·05시 알림보존·**06시 품질 스냅샷** — 겹침 회피
- **데모 롤포워드**: 전 타임스탬프 +1d 시프트라 상대시간 지표(방치 N일) 왜곡 없음 — 확인됨. 단 스냅샷 capturedOn은 롤포워드 대상 제외 필요(dev-demo 시프트 테이블 목록에서 제외 등록)
- **ConfigRuntimeModule 비글로벌**(기존 함정) — data-quality 모듈에 명시 import
- **schema 변경**은 P1 1회(QualityMetricSnapshot)만 — `--schema` 배포·자동 백업
- C2 이름 정규화는 한글↔로마자 왕복이 아니라 **정규화 키 비교**(초성열·소문자 로마자 제거형) — 완전 변환 시도는 오탐 원천이라 금지
