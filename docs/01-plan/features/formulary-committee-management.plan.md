# 원내 처방집(포뮬러리)·위원회 코드 관리 기획

> **상태(2026-09-15 코드 대조 갱신)**: 구현됨(일부) — CSV 일괄 등재(미리보기→확정·행 판정·정확 일치만) `apps/api/src/modules/formulary/formulary.controller.ts:41` import-csv(R5) · 프리셋 키 정본 shared FORMULARY_PRESETS · 잔여: 4-eyes 심의 옵션(사람); ERP 이벤트(대외 발신); 처방 화면 프리셋 formulary 로드 전환 §3.3(CLI)

> 작성: 2026-07-07 / 상태: **v1.2 — 구현 완료·운영 라이브** (릴리즈 v3.43.0 · PR #277~278 · docs/04-report/RELEASE-v3.43.0.md)
> 구현 범위: P0 전체 + P1~P2 핵심(시행 게이트 OFF/WARN/BLOCK·AI 체크리스트·코드마스터 상호반영 §3.6-b/c). 잔여: 4-eyes 심의 옵션·CSV 일괄·ERP 이벤트·프리셋 formulary 로드 전환(§3.3).
> 성격: 처방 입력의 7개 영역(약처방·검사·영상·치료·식이·활동·간호지시) 코드에 대해 **병원 위원회가 결정한 '사용 가능 영역'(원내 처방집)** 과 **'별도 추가 요청 영역'(등재 요청 워크플로우)** 을 관리하고, 그 결정이 **처방 화면에 즉시 반영**되는 체계. 코드베이스 그라운딩 기반.
> 한 줄: 현재 처방 검색은 **전체 마스터(약 2.4만·수가 16.7만·상병 1.8만)를 무제한 노출** — 실제 병원은 약사위원회(DC)·진료재료위원회 등이 심의한 **원내 사용 승인 목록** 안에서 처방하고, 목록 밖 코드는 **등재 요청→위원회 심의→반영** 절차를 거친다. 이 거버넌스 계층을 추가한다.

---

## 0. 배경 — 이미 있는 것 (재사용·재작업 금지)

| 자원 | 내용 | 본 기획에서의 역할 |
|------|------|------------------|
| **`DepartmentCodeCatalog`** | 과 단위 코드 카탈로그(codeType·기본용법·guideNote·isActive) + code-search에서 `DEPT_CATALOG` 배지 | **원내 처방집의 하위 계층**(병원 승인 → 과 프리셋)으로 위치 재정의 |
| `DoctorCodeList` | 의사 개인 즐겨찾기(MY_LIST) | 최하위 계층(개인) — 불변 |
| **code-search 우선순위** | `MY_LIST > DEPT_CATALOG > ALL` 정렬(`doctor-code.service`) | `ALL` 앞에 **`FORMULARY`(원내 승인)** 계층 삽입 지점 |
| **`AdminApproval`** | 4-eyes 승인 워크플로우(PENDING/APPROVED/REJECTED/EXECUTED·기한) | 등재 요청 승인 모델의 **선례**(전용 모델 신설 시 상태기계 차용) |
| **`OrderSet` 상태 전이** | DRAFT→PENDING_APPROVAL→APPROVED→ACTIVE(+감사) | 위원회 심의 상태기계 선례 |
| 기능 접근 매트릭스 | SystemConfig 기반 역할×기능 중앙관리 | 위원회 권한(심의자 지정)에 재사용 |
| 마스터 데이터 | 약품 24,022(약가·분류·고위험)·수가 166,744·상병 18,184·NIC 50 | 포뮬러리가 참조하는 **전체 후보 풀** |

→ 신설은 **원내 승인 목록 1테이블 + 등재 요청 1테이블 + 관리 화면**이 핵심. 나머지는 기존 계층·선례 재사용.

---

## 1. 문제 (갭)

| ID | 갭 | 현재 상태 | 리스크 |
|----|----|----------|--------|
| F-1 | **원내 사용 승인 개념 부재** | 처방 검색이 마스터 전체 노출(약 2.4만 전부 선택 가능) | 원내 미보유 약 처방→조제 불가·비계약 검사 오더·재고/구매 통제 불가 |
| F-2 | **위원회 의사결정 기록 부재** | 어떤 코드를 왜 쓰기로 했는지(DC 심의) 시스템 밖(문서) | 감사 추적 불가·JCI/인증 대응 취약 |
| F-3 | **등재 요청 경로 부재** | 목록 밖 코드가 필요한 의사가 요청할 공식 채널 없음 | 구두/메일 요청→누락·비표준 |
| F-4 | 치료·활동·간호지시 프리셋 하드코딩 | FE 상수(치료 18·활동 17) + NIC 50(DB) | 위원회가 항목을 늘리려면 배포 필요 |
| F-5 | 과 카탈로그와 원내 승인의 관계 미정의 | DEPT_CATALOG가 사실상 유일한 큐레이션 | 병원 계층 없이 과가 임의 등록 |

---

## 2. 목표

1. **원내 처방집(Formulary)**: 영역별(7종) "병원이 사용 승인한 코드 집합"을 위원회가 관리 — 처방 화면은 기본적으로 **이 집합 안에서** 검색·브라우즈.
2. **별도 추가 요청**: 목록 밖 코드가 필요하면 처방 화면에서 **바로 등재 요청**(사유 포함) → 위원회 심의(승인/반려) → 승인 즉시 처방집 반영.
3. **정책 유연성**: 영역·병원 사정에 따라 **차단 모드**(목록 밖 선택 불가) / **경고 모드**(선택 가능하되 비승인 표기+요청 유도) 선택 — config 게이트(무중단 도입).
4. **감사 추적**: 등재/제외/요청/심의 전 이력(누가·언제·왜) 기록.
5. **비파괴**: 도입 전 동작(전체 검색)은 경고 모드 OFF 상태와 동일 — 점진 활성화.

**비목표**: 구매/재고 시스템, 보험 급여 심사 로직(기존), 위원회 회의체 운영(기록만).

---

## 3. 설계

### 3.1 데이터 모델 (신설 2)

```prisma
/// 원내 처방집 — 위원회가 승인한 사용 가능 코드(영역별)
model FormularyItem {
  id           String   @id @default(uuid()) @db.Uuid
  domain       String   @db.VarChar(20)   // MEDICATION | LAB | IMAGING | THERAPY | DIET | ACTIVITY | NURSING
  codeType     String   @db.VarChar(30)   // MEDICATION_CODE | PROCEDURE_CODE | NURSING_CODE | PRESET(치료/활동 프리셋 키)
  codeId       String?  @db.Uuid          // 마스터 FK(프리셋은 null)
  presetKey    String?  @db.VarChar(40)   // PRESET용 키(PT_EXERCISE 등)
  status       String   @default("ACTIVE") @db.VarChar(20) // ACTIVE | SUSPENDED(일시중지) | REMOVED
  note         String?  @db.Text          // 위원회 결정 메모(제한 조건 등)
  committee    String?  @db.VarChar(60)   // 결정 위원회(약사위원회/진료재료위원회…)
  decidedAt    DateTime?                  // 위원회 결정일
  decidedBy    String?  @db.Uuid          // 기록자
  createdAt/updatedAt
  @@unique([domain, codeType, codeId, presetKey])
  @@index([domain, status])
}

/// 코드 등재 요청 — 목록 밖 코드의 사용 요청(위원회 심의)
model FormularyRequest {
  id           String   @id @default(uuid()) @db.Uuid
  domain       String   @db.VarChar(20)
  codeType     String   @db.VarChar(30)
  codeId       String?  @db.Uuid          // 마스터에 있으면 FK
  freeText     String?  @db.VarChar(300)  // 마스터에도 없는 신규(예: 신약)
  reason       String   @db.Text          // 임상 사유(필수)
  urgency      String   @default("ROUTINE") @db.VarChar(10) // ROUTINE | URGENT
  requestedBy  String   @db.Uuid
  department   String?  @db.VarChar(100)
  status       String   @default("PENDING") @db.VarChar(20) // PENDING | APPROVED | REJECTED | WITHDRAWN
  decision     String?  @db.Text          // 심의 결과 메모
  decidedBy    String?  @db.Uuid
  decidedAt    DateTime?
  createdAt
  @@index([status, domain])
}
```
- **AdminApproval 상태기계 차용**(PENDING→APPROVED/REJECTED), OrderSet처럼 전이 검증.
- 프리셋 영역(치료·활동)은 `presetKey`로 포함 — F-4의 하드코딩을 **DB 관리로 승격**(FE는 formulary에서 로드, 없으면 현 상수 폴백).

### 3.2 정책 게이트 (SystemConfig — 무중단 도입)

```
formulary.enforce = { MEDICATION: 'WARN', LAB: 'OFF', ... }   // OFF | WARN | BLOCK (영역별)
```
| 모드 | 검색/브라우즈 | 선택 | 처방 추가 |
|------|--------------|------|-----------|
| OFF(기본) | 전체 마스터(현행) | 자유 | 자유 |
| **WARN** | 승인 목록 우선 정렬 + 비승인 회색 '비승인' 배지 | 가능 | 경고 토스트 + **'등재 요청' 버튼** 노출 |
| **BLOCK** | 승인 목록만 표시(토글로 '전체 보기' 가능) | 비승인 선택 시 차단 | 불가 — '등재 요청'으로 유도 |

- 도입 시나리오: OFF로 배포 → 위원회가 초기 목록 구축(현 사용 실적 일괄 등재, §3.5) → 영역별 WARN → 안정화 후 BLOCK.

### 3.3 처방 화면 반영 (code-search 확장)

- **우선순위 재정의**: `MY_LIST > DEPT_CATALOG > FORMULARY > ALL` — sortPriority에 formulary 계층 삽입(기존 정렬 로직 확장).
- 응답에 `formularyStatus: 'ACTIVE' | 'SUSPENDED' | null` 동봉 → FE 배지(승인=초록 '원내' / SUSPENDED=회색 '중지' / null=WARN·BLOCK 모드에서 '비승인').
- **등재 요청 진입점**: 검색 결과의 비승인 항목 옆 `등재 요청` 버튼 + 검색 결과 없음(신약 등) 시 "『검색어』 등재 요청" — 사유 입력 모달 → `FormularyRequest` 생성 → 요청자에게 심의 결과 알림(기존 Notification).
- 치료/활동/간호 프리셋: formulary(PRESET·NURSING_CODE)에서 로드 — 위원회가 항목 추가/중지 시 **배포 없이 반영**(F-4 해소).

### 3.4 관리 화면 (`/admin/formulary`)

- **탭 = 7영역**. 각 탭:
  - 승인 목록 그리드(검색·상태 필터·SUSPENDED 토글·위원회/결정일/메모)
  - `+ 등재`: 마스터 검색→담기(기존 콤보 패턴 재사용)·일괄 등재(CSV)
  - **요청함**: PENDING 요청 목록 → 상세(사유·요청자·긴급도) → 승인(→FormularyItem 자동 생성)/반려(사유 필수)
- 권한: `feature-access-matrix`에 `FORMULARY_MANAGE` 기능 등록(위원회 간사·ADMIN). 심의 승인은 **4-eyes 옵션**(config, AdminApproval 선례).
- 대시보드 위젯(선택): 대기 요청 수·최근 결정.

### 3.5 초기 데이터 전략 (콜드스타트 회피)

- **사용 실적 기반 일괄 등재**: 최근 N개월 `Prescription`에서 실제 사용된 medicationCodeId/procedureCodeId를 추출 → FormularyItem ACTIVE 일괄 생성(위원회 추인 형태·note='초기 실적 등재').
- 치료 18·활동 17·NIC 50 프리셋 → PRESET/NURSING_CODE로 시드.
- 과 카탈로그 등재분은 자동 포함(DEPT_CATALOG ⊂ FORMULARY 불변식 — 과 카탈로그 등록 시 formulary 미존재면 경고 or 자동 등재 정책 결정 필요, §7).

### 3.6-b 코드마스터 상호 반영 (✅ P0에 포함 구현)

포뮬러리와 코드마스터(`/admin/codes`·`/api/v1/codes/*`)는 **양방향으로 반영**된다:

| 방향 | 내용 | 구현 |
|------|------|------|
| **마스터 → 포뮬러리** | 마스터에서 코드 비활성/삭제 시: ① 처방 검색은 `isActive` 필터로 **자동 미노출**(안전) ② 포뮬러리 관리 화면에 **'마스터 비활성'** 빨간 경고 표시(정리 유도) | `list()` enrich에 `masterActive` 동봉 |
| **포뮬러리 → 코드마스터 화면** | 코드마스터 약품/수가/간호(NIC) 탭에 **'원내' 컬럼** — 승인 상태 배지 + **원클릭 토글**(미등재→등재→중지→재개). 수가는 EDI 접두로 영역(검사/영상/식이) 자동 추론 | `GET /formulary/status?ids=`(batch) + `POST /formulary/toggle` |
| **신규 항목 흐름 완결** | 마스터에 없는 등재 요청(freeText): 요청함에서 **'코드마스터 등록 →'** 링크 → 마스터 등록 → 포뮬러리 등재 → 요청 승인 처리 | 요청함 UI 분기 |
| 경계 | 진단(diagnosis)·표준매핑(mappings) 탭은 포뮬러리 비대상(§7-3) | — |

### 3.6-c AI 체크리스트 (✅ 구현)

전체 마스터 검색이 불편하다는 현장 피드백 → **AI 큐레이션 체크리스트**:
- 관리자가 주제 입력(예: "고혈압 외래 초진") → ① LLM(qwen2.5:14b·WeRU.B Ollama)이 검색 키워드 6~10개 생성 ② 키워드로 마스터 후보 수집(도메인 필터·dedup·cap 250) ③ LLM이 관련 항목 선별 + 임상 카테고리 분류(**번호 기반 응답 — 코드 환각 방지**)
- 초안을 **카테고리별 체크리스트**로 검토(기본 전체 체크·카테고리/항목 단위 토글) → 이름 지정 저장(`FormularyList`·JsonB)
- 저장 리스트에서 **카테고리 단위/전체 일괄 처방집 등재**(기존 add 재사용·위원회/메모 입력)
- ⚠️ 구현 함정: AI 프록시가 `stream:false`를 무시하고 NDJSON 스트리밍 반환 → **라인 병합 필수**
- 운영 검증: '고혈압 외래 초진' → 키워드 10·후보 115·혈압강하제 40건 분류

### 3.6 ERP 연동

- 승인/중지 시 기존 HIS→ERP outbox에 `formulary.item_changed` 이벤트(선택) — 구매/재고는 ERP 소관.

---

## 4. 단계별 계획

| 단계 | 범위 | 규모 |
|------|------|------|
| **P0** | 모델 2 + manual SQL·EP(CRUD·요청 생성/심의) + `/admin/formulary`(목록·등재·요청함) + code-search `formularyStatus` 동봉·FORMULARY 정렬 계층 + config `OFF/WARN`(BLOCK 제외) + 초기 실적 일괄 등재 스크립트 | L |
| **P1** | **WARN 모드 FE 완성**(비승인 배지·등재 요청 모달·알림) + 프리셋(치료/활동/NIC) formulary 로드 전환(폴백 유지) + 요청 심의 4-eyes 옵션 | M |
| **P2** | **BLOCK 모드**(검색 필터·선택 차단·'전체 보기' 토글) + 일괄 CSV 등재 + ERP 이벤트 + 위원회 회의록 첨부(결정 근거 파일) | M |

---

## 5. 리스크·완화

| 리스크 | 완화 |
|--------|------|
| BLOCK 도입 시 진료 차단(누락 코드) | 기본 OFF→WARN 장기 운용으로 목록 성숙 후 BLOCK·응급 우회(URGENT 요청 시 임시 허용 config) |
| 초기 목록 공백(콜드스타트) | 사용 실적 일괄 등재(§3.5)로 현행 처방 무중단 |
| 과 카탈로그와 불변식 충돌 | DEPT_CATALOG ⊂ FORMULARY 검증(등록 시) — 정책은 §7 결정 |
| code-search 성능 | FormularyItem(domain,codeId) 인덱스 + 결과 30~100건에 in-메모리 매핑(추가 쿼리 1회) |
| 요청 남발 | 사유 필수·과별 통계 노출·반려 사유 축적 |

## 6. 검증
- OFF 모드에서 현행 검색과 완전 동일(회귀 0).
- WARN: 비승인 배지·경고·요청 생성→심의 승인→즉시 검색에 '원내' 배지 반영(E2E).
- BLOCK: 비승인 검색 제외·선택 차단·요청 유도.
- 감사: 등재/중지/심의 이력 조회.

## 7. 열린 결정
1. **과 카탈로그 관계**: DEPT_CATALOG 등록 시 formulary 자동 등재 vs 사전 등재 강제.
2. **심의 주체 모델**: 단일 승인자(간사) vs 4-eyes 기본 vs 위원회별 승인자 그룹.
3. **상병(진단) 포함 여부**: 요청은 처방 7영역 — 상병은 마스터 전체 사용이 관례라 **제외 권고**(포함 시 domain 확장만으로 가능).
4. **BLOCK의 응급 우회**: URGENT 요청 시 임시 사용 허용(사후 심의) 여부.
5. 초기 실적 등재 기간(3/6/12개월).
