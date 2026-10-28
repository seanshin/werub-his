# 위원회 거버넌스 엔진 — 의사결정 기록·시계열·EMR 집행

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/prisma/schema.prisma:11093 · apps/api/prisma/schema.prisma:11257 · apps/api/src/modules/decision-registry/decision.service.ts:8 · 잔여: 없음

- **작성**: 2026-08-04 v1 → **v2 (2026-08-04 HIS 전수 실측 반영)**
- **상태**: 기획 v2 (구현 전)
- **v2 개정 요지**: ①🔴 **GLD 모듈에 Committee·CommitteeMeeting·InstitutionalPolicy 가 이미 존재**(approve EP 포함) — 신규 모델 신설 → **기존 확장**으로 전환(기존기능 중복 생성 함정 회피) ②HIS 전수 실측으로 **정책 표면(Policy Surface) 카탈로그** 신설 — config 308키·게이트 39종·마스터 API 17계열(즉시 바인딩 가능 A군) vs 하드코딩 사각지대 20+건(선행 조치 B군) ③위원회↔표면 담당 매핑은 **go-live.registry 의 owner 선언표 직수입** ④선행 정비(P0 결함성 4건)를 Phase 에 편입

---

## 0. v2 전수 실측 요약 — "위원회의 영향을 받아들일 표면"이 어디에 있는가

| 층 | 실측 | 거버넌스 관점 |
|---|---|---|
| 런타임 config | **308키·66접두어**, 변경=`PUT /api/v1/config/:key`(ADMIN) 단일 범용 EP. 보호 키 2개는 전용 승인 워크플로 강제 | 전 키가 집행 바인딩 후보. 단 DEFAULTS↔코드 드리프트가 반복된 이력(48+8키 일괄 등재) — **드리프트 검출을 엔진 기능으로** |
| 안전 게이트 | 3상(OFF/WARN/BLOCK) 28종 + boolean 게이트 11종 + Map형 3종(preauth·diagnosis·formulary). safety-gate 관제는 **읽기 전용**(모드 변경은 config PUT) | 게이트 승격이 위원회 의결의 최다 빈도 대상. ⚠️ Map/Boolean형은 관제 `others` 수집에서 **누락**(선행 조치) |
| 정책성 마스터 | 변경 API 보유: reference-range·CDSS 룰·triage 룰·약품/시술/상병 마스터(마약류·고위험·ASP 필드)·staffing-rules·retention(4-eyes)·feature-access·동의서/차트 템플릿(버전·롤백)·오더셋/프로토콜/임상경로(publish/retire)·인증 정책·검진 프로토콜 | **A군 — 즉시 바인딩 가능** |
| 하드코딩 사각지대 | **DUR 룰 5종**(병용금기 22쌍·연령·최대용량·Beers·소아 mg/kg — `dur.enforce=BLOCK` 으로 **실차단 중인데 룰이 코드에**)·검사 위급값 10종(ReferenceRange 와 **이중 정본**)·활력/EWS 임계 **3중 정본**·격리 프로토콜(PPE·기간)·KTAS 재평가/도어투트리아지 목표·NEDOCS 등급 경계·재활 hold·조영제 eGFR·좌우구분 키워드·간호 체크리스트 등 20+건 | **B군 — config화/룰 테이블화 선행 필요**. 위원회 결정이 현재 닿을 수 없는 곳 |
| 기존 거버넌스 자산 | **gld 모듈**: `Committee`(10410)·`CommitteeMember`·`CommitteeMeeting`(decisions JsonB)·`InstitutionalPolicy`(version·approvedBy·effectiveDate·reviewDate·status) + `POST /gld/policies/:id/approve` — **단, 집행 대상 참조 필드가 0** | 엔진이 채울 공백이 정확히 여기: **결정↔표면 연결(PolicyBinding)** |
| 참조 구현 3종 | `integration-gate`(근거 evidenceType=**MEETING** 필수·전 게이트 CONFIRMED→config ON·이벤트 이력) · `formulary`(요청→심의→`decide`→등재·**committee 필드 기보유**·영역별 시행모드) · `retention`(전역 스위치+legalConfirmed+4-eyes) | 신규 발명 불요 — 이 패턴들의 일반화가 엔진 |
| 담당 매핑 | `go-live.registry.ts` 가 항목별 **owner**(약제위·진료부·법무·CPO·영상의학과…)·sourceKey·targetMode 를 이미 선언 | 위원회↔표면 매핑 시드로 직수입 |
| 버전/개정 선례 | ProtocolTemplate `@@unique([code,version])`+인스턴스 버전 고정(최성숙)·ConsentForm supersededBy 체인·encounter AMENDED·차트템플릿 rollback | PolicyRevision 은 이 두 패턴의 합 |

## 1. 문제 (v1 유지 + v2 보강)

변경 사실은 AuditLog 에, 게이트 현황은 관제에 있지만 **"어느 합의체가 어떤 심의로 의결했고, 그 의결이 시스템의 어느 표면을 바꿨나"** 는 어디에도 없다. v2 실측이 보탠 것: 문제는 두 겹이다 —

1. **연결 부재**: 표면(A군)은 충분한데 의결 기록(gld)과 이어지지 않는다(InstitutionalPolicy 는 content Text 만).
2. **도달 불가**: 상당수 임상 정책(B군)은 하드코딩이라 위원회가 결정해도 **코드 배포 없이는 반영 자체가 불가능**하다. "위원회의 영향에 따른 변화를 받아들이는" 시스템이 되려면 B군의 표면화가 엔진과 동급 과제다.

## 2. 결정표 (v2 — D11~D15 추가·D9 개정)

| # | 결정 | 근거 |
|---|---|---|
| D1 | 의결(합의체) ≠ 결재(상신) — EApprovalRelay 미재사용. 의결 후 원장 결재 필요 안건만 릴레이(선택) | 결재는 개인 승인 체인, 의결은 정족수·표결 |
| D2 | 집행은 **바인딩 등록제** — 엔진은 임의 코드를 실행하지 않고 **기존 정본 API 만** 호출 | §5.2 화이트리스트. 정본 우회 금지 |
| D3 | 집행 없는 결정(MANUAL)도 1급 시민 | 교육·시설 등 시스템 밖 결정이 다수 |
| D4 | 시계열 정본 = **supersede 체인**(의사결정 이력) | 값 이력은 AuditLog 몫 |
| D5 | 의사록·의결은 **sign 해시체인 봉인**(스트림 `his-governance`·order-sign-log 패턴) | 법정 다툼 대상·append-only |
| D6 | 집행은 effectiveFrom **예약·크론 단일 경로**(즉시=now) | 경로 2개면 한쪽이 썩는다 |
| D7 | 역추적 **양방향** — 결정→집행 로그 / 표면→근거 배지 | 배지 없는 수동 변경이 보이는 것 자체가 신호 |
| D8 | **자동 롤백 금지** — 복원도 REVOKE 의결 경유(스냅샷은 보관만) | 엔진이 과거를 임의 복원하면 백도어 |
| D9(개정) | **신규 모델 최소화 — gld 모듈 확장이 정본** | 🔴 Committee·Meeting·InstitutionalPolicy 실존(approve EP 포함). v1의 신규 설계는 중복 — 기존 확장+부족분(Agenda·Decision·Action·Binding)만 신설 |
| D10 | 자동 집행 게이트 `governance.enactment.enabled`(기본 OFF) — **DEFAULTS 등재 필수**(가드 테스트 규약) | formulary.enforce 미등재 전철 방지 |
| D11(신설) | **정책 표면 레지스트리(Policy Surface Registry)** — HIS 의 governable 표면을 코드 선언 카탈로그로 관리 | "전체 변화를 받아들이는" 구조의 본체. go-live.registry 패턴 확장: `{surfaceKey, kind, 정본 API, ownerCommittee, 현재값 리더}` 선언표. 등재 3종 세트(집행 함수·역추적 배지·계약 테스트) 없으면 거부 |
| D12(신설) | **B군 표면화가 선행 과제** — 특히 P0 4건(DUR 룰·위급값 이중정본·활력 3중정본·격리 프로토콜)은 거버넌스 이전에 **결함성**으로 처리 | DUR 은 BLOCK 실차단 중인데 룰이 코드에 — 약사위가 금기쌍 하나 못 바꾼다. 임계 3중 정본은 화면·경보·타임라인이 서로 다른 기준으로 판정 중 |
| D13(신설) | **드리프트 검출은 엔진의 상시 기능** — governance health check | ①코드가 읽는 config 키 ↔ DEFAULTS ②동일 정책의 이중/삼중 정본 ③관제 수집 누락(Map/Boolean 게이트) ④바인딩 대상 API 생존 여부. 주기 스캔+관제 카드 |
| D14(신설) | 위원회↔표면 담당 매핑 시드 = **go-live.registry owner 직수입** | 이미 선언된 owner(약제위·진료부·법무·CPO…)를 CommitteeSurfaceMap 으로 이관 — 이중 선언 금지, go-live 는 이 맵을 참조하도록 후속 수렴 |
| D15(신설) | Map형 게이트(formulary.enforce·preauth.enforce·diagnosis.restrictionEnforce)는 **부분 키 단위 집행**(`{mapKey, mode}`) | 영역/유형별 의결이 실무 단위(예: "LAB 영역만 WARN") |

## 3. 도메인 모델 (v2 — gld 확장)

### 3.1 기존 유지·확장 (신설 아님)

- `Committee`·`CommitteeMember` — **유지**. 추가 컬럼: `quorum Int @default(0)`, `meetingCycle String?`. 시드 9종(DTC/IC/MRC/QPS/TRF/ETH/NUT/SAFE/OPS)은 upsert(기존 데이터 보존).
- `CommitteeMeeting` — **유지**. `decisions JsonB` 는 **동결(deprecated)** — 정형 의결은 신설 `CommitteeDecision` 로. 추가 컬럼: `minutesSignedAt`, `minutesSignRef`(D5).
- `InstitutionalPolicy` — **유지·격상**: "정책 문서" 정본. 신설 `CommitteeDecision.policyId?` 로 연결(결정이 정책 문서를 제·개정하는 관계). version·reviewDate·approve EP 그대로 활용.

### 3.2 신설 4종

```prisma
model CommitteeAgenda {        // 안건 — 접수→상정→의결 파이프라인
  id/committeeId/meetingId?/seq?/title/proposerId/body
  sourceRef Json?              // 유입 출처 {type:'SAFETY_GATE'|'GO_LIVE'|'FORMULARY_REQUEST'|'DATA_QUALITY', key}
  status                       // SUBMITTED, SCHEDULED, RESOLVED, REJECTED, DEFERRED, WITHDRAWN
}

model CommitteeDecision {      // 의결 — GOV-YYYY-NNN
  id/committeeId/agendaId@unique/decisionNo@unique/resolution
  voteFor/voteAgainst/voteAbstain/resolvedAt
  effectiveFrom?/effectiveUntil?/reviewDue?
  status                       // RESOLVED, ENACTED, PARTIALLY_ENACTED, SUPERSEDED, REVOKED, EXPIRED
  supersedesId?                // D4 체인
  policyId?                    // InstitutionalPolicy 제·개정 연결(3.1)
  signRef?                     // D5 봉인 영수증
}

model DecisionAction {         // 집행 항목
  id/decisionId/kind/target Json
  status                       // PENDING, ENACTED, FAILED, SKIPPED, CANCELLED
  snapshotBefore Json?/enactedAt?/enactedBy?/error?/manualNote?
}

model CommitteeSurfaceMap {    // D14 — 표면 담당 매핑(go-live owner 이관 시드)
  id/surfaceKey@unique         // 'config:dur.enforce', 'gate:formulary.enforce:LAB', 'master:reference-range'
  committeeId                  // 담당 위원회
  note?                        // 근거(법정·인증 조항)
}
```

## 4. 시계열 (v1 유지)

안건 `SUBMITTED→SCHEDULED→RESOLVED|REJECTED|DEFERRED` · 결정 `RESOLVED→(크론)→ENACTED|PARTIALLY_ENACTED→SUPERSEDED|REVOKED|EXPIRED`. 체인 조회 `GET /governance/policies/:surfaceKey` — supersede 를 따라 현재 유효 결정+전체 이력. reviewDue 30일 전 간사 알림(notify — **refId=decision.id UUID 규약**). InstitutionalPolicy.reviewDate 와 이원화하지 않는다 — 정책 문서 재검토는 문서의 reviewDate, 개별 의결 재검토는 decision.reviewDue(대상이 다름을 주석으로 명시).

## 5. 집행 엔진

### 5.1 구동 (v1 유지)

크론 10분 주기 + 수동 [지금 집행](동일 경로·D6). 집행 = ①snapshotBefore 기록 ②정본 API 호출 ③성공 ENACTED+AuditLog(`GovernanceEnactment`) / 실패 FAILED+error+간사 알림(탐지≠상신 분리 불가) ④전 액션 종결 시 결정 상태 승격.

### 5.2 집행 바인딩 (v2 — 실측 A군 기반 9종으로 확장)

| kind | target | 집행 정본(실측 EP) | 비고 |
|---|---|---|---|
| `CONFIG_CHANGE` | `{key, newValue}` | `PUT /api/v1/config/:key` 와 동일 서비스 | DEFAULTS 등재 키만. **보호 키 2종(integration.pseudonymizeChartNo·cutoverApproval)은 거부** — 전용 워크플로 존중 |
| `GATE_MODE` | `{gateKey, mode}` 또는 `{gateKey, mapKey, mode}`(D15) | config 경유(게이트=config 키) | 3상 28종+boolean 11종+Map형 3종 전체 |
| `FORMULARY` | `{action, medicationCodeId…}` | `POST /formulary`·`PATCH /:id`·`toggle`·`requests/:id/decide` | 기존 committee 필드에 decisionNo 기입 |
| `MASTER_DATA` | `{master:'reference-range'\|'cdss-rule'\|'triage-rule'\|'medication-code'\|'staffing-rule', op, payload}` | 각 마스터 CRUD EP(실측 §0) | 마스터별 서브바인딩 등록제 |
| `TEMPLATE` | `{templateType:'CONSENT'\|'CHART', op, id, version}` | consent-templates·chart-templates EP(버전·롤백 기보유) | |
| `ACCESS` | `{scope:'feature'\|'role-data'\|'dept'\|'pacs', key, value}` | `PUT /access-control/*` | 정보보호위 |
| `PUBLISH` | `{docType:'PROTOCOL'\|'PATHWAY'\|'ORDER_SET', id, op:'publish'\|'retire'}` | protocols/pathways publish·retire EP | QI위 |
| `RETENTION` | `{resourceType, retentionDays…}` | `POST /retention/policy` | **파기 실행은 바인딩 제외** — 기존 4-eyes 경로만(3중 안전장치 존중) |
| `MANUAL` | `{description}` | 없음 — 간사 이행 확인 | |

확장 규약(D11): 신규 kind/서브바인딩 = ①집행 함수 ②역추적 배지 ③계약 테스트 3종 세트 필수.

### 5.3 역추적 (v1 유지 + 확대)

`GET /governance/provenance?surfaceKey=…` + 화면 `⚖ GOV-2026-014` 배지 — 대상: /admin 시스템 설정·safety-gates·포뮬러리·reference-ranges·cdss-rules·retention·access-control·템플릿 관리. 유효 결정이 있는 표면의 수동 변경 시 경고(차단 아님·응급 존중).

### 5.4 거버넌스 헬스체크 (D13 — v2 신설)

주기 스캔(일 1회 크론) + `/admin/governance` 관제 카드:

1. **config 드리프트**: 코드 `config.get('x')` 호출 키 목록(정적 스캔 스크립트) ↔ DEFAULTS — 미등재 키 검출(48+8키 사후 등재의 재발 방지를 상시화)
2. **이중 정본 감시**: 등록된 표면인데 하드코딩 판정 로직이 병존하는 곳(§7 B군 잔여) — 소진 추적 카운터
3. **관제 수집 누락**: 3상 게이트 스캔 로직이 놓치는 Map/Boolean 게이트 목록
4. **바인딩 생존성**: 등재된 집행 EP 가 여전히 존재·호출 가능한지(계약 테스트와 이중)

## 6. 유입 (v1 유지 + formulary 추가)

[위원회 상정] 버튼(sourceRef 자동): /admin/safety-gates(위반 통계 첨부)·/admin/go-live(운영 판단 항목)·/admin/data-quality·**포뮬러리 요청(FormularyRequest→DTC 안건 자동 상정 — decide 와 의결 기록 연결)**.

## 7. 선행 정비 트랙 (v2 신설 — B군 표면화)

엔진과 병행하되 **P0 는 엔진보다 먼저**(결함성):

### P0 — 결함성 4건 (위원회 이전에 안전 문제) — **✅ 전량 완료(2026-08-04)**

| 대상 | 현재 결함 | 조치 |
|---|---|---|
| ~~DUR 룰 5종~~ | ✅ **실행(2026-08-04·8a0bd0aa~e787f4fd)**: `DurRule` 전용 모델(CdssRule 혼용 배제 — 두 판정 엔진이 한 테이블을 다르게 소비하는 혼선 방지)·부팅 자동 이관 55건·캐시 60s·**타입별 하드코딩 폴백**(fail-safe)·CRUD `/api/v1/dur/rules`(source=의결번호 자리)·왕복 대조 spec 8건. 동반 결함 2: 🔴DurService 직접 등록 모듈(prescription·cdss)에 Repo 미제공→부팅 루프 / 🔴Repo 3중 인스턴스 onModuleInit 레이스→시드 3중 삽입(advisory lock 직렬화·중복 110건 정리) | 완료 |
| ~~검사 위급값 10종~~ | ✅ **실행(2026-08-04·c1581810)**: 판정을 ReferenceRange(criticalLow/High) **우선**으로 — 별칭 토큰+단위 정규화 매칭·마스터 등재 검사는 이중 판정 금지·미등록만 하드코딩 폴백(fail-safe)·시드 13행(단위별). 🔴이중 정본 실증=칼륨 하한 마스터 2.8 vs 하드코딩 2.5(마스터가 정본으로 승격) | 완료 |
| ~~활력/EWS 임계~~ | ✅ **실행(2026-08-04·6caaa29d)**: 수치 선언=vitals-evaluate 단일 정본(warn 층 편입)·record-issues 는 표현만 소유(buildVitalRules 유도·이중 선언 부재 가드 spec)·config `clinical.vitals.thresholds`(JSON 부분 병합·역전 무시 fail-safe·DEFAULTS 등재)=환자안전위 개정 표면. **NEWS2 밴드는 RCP 표준 — 의도적 제외 명시** | 완료 |
| ~~격리 프로토콜~~ | ✅ **실행(2026-08-04·f6beb599)**: IsolationProtocol 테이블(6종)·부팅 자동 시드(advisory lock)·캐시·미등재 폴백(fail-safe)·PUT /infection-control/protocols/:type(source=의결번호 자리). 운영 검증=시드 6종 정확 1회·AIRBORNE 조회가 테이블 정본 응답 | 완료 |

### P1 — 표면화·관제 보수

`formulary.enforce` DEFAULTS 등재 · safety-gate `others` 수집 필터 확장(Map/Boolean) · KTAS 재평가/도어투트리아지 목표·NEDOCS 등급 경계·외래/수납 대기 목표 config 그룹(`qi.targets.*`) · 게이트 판정 기준 config 화(재활 hold·조영제 eGFR·방사선 편차·투석 UF·교차시험 유효시간·좌우구분 키워드) · 직원측 `NotificationPolicy` 마스터 신설

**✅앞 3건 실행(2026-08-04·P3 동반·4a1b5706)**: ①`formulary.enforce` DEFAULTS 등재 + getPolicy/setPolicy ConfigRuntime 정본 경유 전환(가드 테스트·관제·go-live 3중 사각 해소) ②수집 필터 → `classifyGateEntry` 단일 분류기(common/gate-mode — TRI 문자열/MAP 부분키맵/BOOL·슬래시 표기 `nursing.bcma.enforce` 4번째 갭도 봉합·헬스체크 gateCollectionGaps 는 같은 분류기로 동적화) ③`qi.targets.*` 5키 등재+소비 배선(emergency KTAS 재평가·NEDOCS 경계 / journey-analytics 도어투트리아지·외래/수납 목표 — 전부 하드코딩 폴백 fail-safe·부분 병합·SURFACE_SEED QPS 귀속). 🔴실측: KTAS_REASSESS_MIN(L1=15)과 KTAS_TARGET(L1=1)은 서로 다른 값의 이중 선언 — 별도 키로 분리 등재.

**✅후반 실행(2026-08-04·P3 후속)**: 게이트 판정 기준 6종 표면화 — `rehab.holdCriteria`(Berg 21/40·SBP 180/90·HR 120/50·SpO₂ 90·38℃·활력창 72h)·`imaging.contrastEgfr`(30/45 — MDRD 계수는 불변)·`radiation.doseTolerance`(분할 ±10%·누적 +5%·처방 정합 ±5% — 3지점 산개를 한 키로)·`dialysis.ufLimits`(13mL/kg/hr·건체중 -1kg)·`bloodbank.crossmatchValidHours`(72h — validUntil 영속이라 신규 검사부터 적용)·`surgery.lateralityKeywords`(33개 전량 대체형 — 정본을 common/laterality-keywords 로 승격해 DEFAULTS 와 단일 선언·⚠️'신' 단독 토큰 오매칭은 위원회 개정 몫으로 명시). 전부 기존 merge 헬퍼(mergeTargetMap/positiveNumberOr/신설 nonEmptyStringArrayOr) 폴백 fail-safe. **NotificationPolicy**: 모델 신설 대신 config MAP 채택(타 표면과 일관·집행 바인딩 재사용) — `notification.policy`(유형별 roles·dedupHours 오버라이드·1차 적용=ADMIN 브로드캐스트 3종: 마약류 불일치·치명 안전사건·RCA 기한 초과)+`notification.retentionDays`(읽음 90/미읽음 180·정리 크론 소비). 🔴NotificationModule 이 ConfigRuntimeModule 미임포트(조용한 폴백 함정)라 배선부터. SURFACE_SEED 8건 귀속(QPS/SAFE/TRF/OPS).

### P2 — 위생

FE 대기시간 색상 임계 6화면 → `clinical.queue.*` config 소비 전환(**config 가 있는데 FE 가 안 읽는 실측**) · 간호 체크리스트 템플릿 테이블화 · 인증/단말/BTG 기본값 3중화 해소 · 고위험 동의서 종류 불일치(`sign.highRiskConsentTypes` vs ess 하드코딩) 일원화

**✅실행(2026-08-04·P3 후속)**:
- **대기 임계 수렴**: 실측 결과 `clinical.queue.*` 3키는 **BE 조차 안 읽는 완전 고아**·FE 는 7화면 8지점이 10/15/20/30/60 혼재. `lib/queue-thresholds`(useQueueThresholds+waitTone — warn=waitWarningMinutes(20)·danger=maxWaitMinutes(60)·폴백 내장) 신설 후 7화면 수렴(진료실 대기·사이드레일·접수 대기열·front-desk 2·내 대기열 위젯·약제/수납 보드). ⚠️화면 표시 변화: 종전 '30분=빨강'이 '경고 20분/위험 60분' 단일 정책으로 — 운영이 30분 빨강을 원하면 maxWaitMinutes=30 설정. **ER 은 의도적 제외**(KTAS 별도 축·qi.targets).
- **체크리스트 테이블화**: `NursingChecklistTemplate` 모델 신설(code unique·items Json·source 의결번호 자리)+부팅 시드(advisory lock·기존 6종+**TRANSFUSION 편입** — 종전 FE 에만 하드코딩·서버 기록 0이던 수혈 체크리스트)+`GET/PATCH /nursing/checklist-templates`+생성은 테이블 우선·코드 폴백. 거버넌스 `MASTER_DATA nursing-checklist` 바인딩(upsert·code 키) 등재. 인스턴스는 스냅샷이라 개정은 신규 생성분부터.
- **3중화 해소**: ①🔴**passkey maxDevices 실버그** — Redis `auth:policy` 만 봐서 /admin/identity(DB AuthPolicy) 변경이 등록 한도에 무효였음 → DB(GLOBAL→ROLE) 우선·Redis 폴백으로 수렴 ②단말 — `terminal.failmode.*` 3키(정의만 되고 소비 0)를 health() 실배선·`terminal.pin.length` 를 PIN 생성에 실배선(4~8 클램프) ③BTG — `security.btg.enabled`(소비 0이던 게이트)를 발급 경로에 실배선+`security.btg.defaultMinutes/maxMinutes` 신설 등재. btg.guard 컨트롤러 배선은 행동 변경이라 운영 판단으로 보류.
- **고위험 동의서 분리**: 실질은 '3종 vs 5종 불일치'가 아니라 **두 정책이 한 이름에 뭉쳐 있던 것** — `consent.doctorSignRequiredTypes`(의사 확약 대상 5종·ess+품질지표 공용 정본·common/consent-types)를 신설 분리하고 `sign.highRiskConsentTypes`(PASS 재인증 3종)는 유지. sign-integration 인라인 폴백은 DEFAULTS 참조로 사본 0.

## 8. 화면 (v1 유지 + 헬스체크 카드)

`/admin/governance`(관제 홈: 위원회 카드·재검토 임박·집행 로그·실패 경고·**헬스체크 카드**) · `/admin/governance/[committee]`(안건 칸반) · `/meetings/[id]`(정족수 실시간·표결·의사록 서명 봉인) · `/decisions/[id]`(액션·스냅샷·supersede 체인 시계열 뷰·[지금 집행]/[REVOKE 상정]) · 기존 화면 ⚖배지(§5.3). 기존 gld 화면이 있으면 흡수·개편(실측 후 판단 — FE 미조사).

## 9. Phase (v2 개정)

- **P0-a 선행 정비(결함성 4건)** — §7 P0. 엔진 없이도 가치 있는 독립 트랙
- **P0-b 대장** — **✅BE 완료(2026-08-04·a45f0ad4)**: gld 확장(Committee code·quorum / Meeting decisions JsonB 동결·sign 필드 예약)+신설 4모델+EP 9종(/api/v1/governance/*)+시드(위원회 9종·표면 매핑 16건 — 운영 검증 완료). 종단 실증=안건(sourceRef)→회의 배정→**참석 미기록 의결 차단**→의결 GOV-2026-001 발번·MANUAL 액션 1건(시연 데이터 잔존·무해). 🔴db push가 committees.code unique 를 손실 경고로 거부 → --accept-data-loss 금지 원칙에 따라 **무손실 DDL 수동 선적용**(신설 컬럼=중복 불가 증명) 후 push 통과. **✅FE 완료(3b447396)**: /admin/governance 관제(위원회 카드 9·KPI·재검토 임박·최근 의결)+안건 파이프라인+의결 대장(회의 생성·참석 기록·배정·의결을 한 모달 흐름). gld POST meetings attendees 미저장 갭 봉합. 종단 실증 완결=이행 확인(ADMIN 가드 — 의사 계정 403 확인)→액션 ENACTED→결정 자동 승격 ENACTED. **P0-b 전체 완료** — 다음: P1 엔진
- **P1 엔진** — **✅완료(2026-08-04·d54bc8df~171e1666)**: GovernanceEnactmentService — 크론 10분+수동 enact 동일 경로(D6)·ConfigRuntime.set 정본 경유만(D2)·의결/집행 이중 검증(미등재 KEY_NOT_IN_CATALOG·보호 PROTECTED_KEY 거부)·스냅샷 기록(자동 롤백 없음 D8)·실패=FAILED+ADMIN 알림·게이트 OFF 기본. 운영 종단 실증=거부 3종(미등재·보호·게이트 OFF)→ON→GOV-2026-002 집행 enacted1·ENACTED 승격·스냅샷 확인→게이트 OFF 원복. 🔴동반=GldModule ConfigRuntimeModule 미임포트 부팅 실패(신규 서비스 주입 시 모듈 imports 전수 확인)
- **P2 시계열·역추적·헬스체크** — **✅완료(2026-08-04·66d65b89)**: provenance(표면→결정 체인)·badges 일괄 맵·safety-gates ⚖배지·재검토 크론(09:30·dedupe)·헬스체크(D13). **운영 실검출: DB↔DEFAULTS 드리프트 32건**(관리 화면 비노출 갭의 살아있는 재발 — §7 P1 표면화의 실측 근거)+Map형 게이트 수집 누락 3종. supersede 체인은 P0-b 기구현(getDecision supersededBy)
- **P3 유입·봉인·잔여 바인딩** — **✅완료(2026-08-04·4a1b5706)**: ①상정 버튼 4곳(safety-gates 위반통계 첨부·go-live·data-quality·포뮬러리 요청 — 공용 `ProposeAgendaModal`·sourceRef 자동·surface-map 담당 위원회 자동 제안) ②의사록 sign 봉인(D5 — `his-governance` 스트림·sha256 만 전송(PHI 미전송)·anchor·완료 회의만·봉인 후 minutes 불변·의결은 resolve 시 자동 봉인 best-effort·`GET /governance/sign-chain/verify`) ③바인딩 6종 개방(D11 3종 세트: 집행 함수=기존 정본 서비스 주입 호출·surfaceKeyOf 배지 귀속·계약 테스트 29건 — **비멱등 toggle 바인딩 금지**(setStatus/setActive 목표 상태만)·PROTOCOL 은 publish 만(정본에 retire 부재)·RETENTION 은 정책 등록만(파기=4-eyes 존중)·medication-code 필드 화이트리스트·미배선=의결 시점 BINDING_NOT_WIRED 거부) + GATE_MODE Map 부분 키 집행(D15 — 타 키 불변 계약 테스트) + §7 P1 앞 3건 병행. 정본 승격 4건: DurRulesRepo 쓰기(캐시 무효화 내장)·RetentionService.upsertPolicy·ConsentTemplateService.setActive·AccessControlService export. 🔴동반 실결함: GldModule 이 AuditModule/NotificationModule 을 미임포트 — P1 집행 감사로그·실패 알림이 **조용히 no-op**(@Optional 주입 함정 변종·모듈 imports 전수 확인 원칙 재확인). FE=의결 모달 바인딩 JSON 입력·[지금 집행]·집행 대기/FAILED 표시·봉인 버튼/배지

## 10. 비범위 (v1 유지 + 추가)

IRB·회의 일정/화상 연동·그룹웨어 릴레이(후속 선택)·전자투표 + **(v2 추가)** 파기 실행 바인딩(기존 4-eyes 전용 경로 존중·D2)·법정치(정신과 격리 12h/강박 4h 등)는 표면화하되 위원회 재량 아님을 SurfaceMap note 에 명시.

## 11. 검증 계획 (v1 유지 + v2 추가)

- [x] v1 6항목(종단·실패 경로·supersede·REVOKE 무자동롤백·봉인·게이트) — 종단=P0-b/P1/P3 운영 실증(GOV-2026-001~003)·실패 경로=계약 테스트(FAILED+error)·봉인=P3 실증(signRef+TSA 앵커 valid:true)·게이트=OFF 거부 실측
- [x] **보호 키 거부**: CONFIG_CHANGE 로 integration.pseudonymizeChartNo 시도 → 등재 거부 (계약 테스트 enactment-bindings.spec)
- [x] **Map형 부분 집행**: formulary.enforce LAB 만 WARN → 타 영역 불변 — **운영 실증(2026-08-04·GOV-2026-003)**: 집행 후 policy LAB=WARN·나머지 6영역 OFF 유지·snapshotBefore 기록·⚖배지 귀속·검증 후 원복
- [x] **gld 호환**: 기존 InstitutionalPolicy·approve EP 무손상 — P0-b 이후 전체 스위트 통과 유지(6,679)
- [x] **헬스체크**: DB↔DEFAULTS 드리프트 상시 검출(32건 실검출→formulary.enforce 등재로 31건)·gateCollectionGaps 는 관제와 같은 분류기로 동적화 — P3 후 운영 실측 **[]**(종전 3종 소진)
- [x] **P0-a 정합**: DUR 룰 왕복 대조 spec 8건(P0-a① 기록 참조)
