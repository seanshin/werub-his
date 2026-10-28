# 운영 전환(Go-Live/Cutover) 관제 센터 기획서

- **작성일**: 2026-07-25
- **대상 경로**: `/admin/go-live` (신규 통합 카테고리)
- **한 줄 요약**: 실운영 전환(컷오버)에 필요한 **게이트·승인·외부의존·데이터·하드웨어 항목이 6개 이상 화면·문서에 파편화**돼 "실운영 준비됐나? 뭐가 막나? 누가 담당인가?"를 한눈에 볼 수 없다. 이를 **단일 레지스트리 기반 관제 카테고리**로 통합 — 기존 상세 화면은 존치하고 그 위에 **롤업(집계·준비도·승인)** 계층을 얹는다.

---

## 0. 현행 실측 (파편화 진단)

실운영 전환 항목이 아래처럼 흩어져 있어 **단일 진실 소스가 없다**:

| # | 표면 | 관리 대상 | 형태 | 소유 신호 |
|---|------|-----------|------|-----------|
| 1 | `/admin/safety-gates` | 임상 안전게이트 10+종(dur.enforce·cdss.enforce·imaging·rehab·정신과…) | config OFF/WARN/BLOCK + 위반통계(GateViolationLog) | 없음(모드만) |
| 2 | `/admin/integration-gates` | 외부 연동 컷오버 트랙(LIS·ERP…) A-1~ 결재 항목 | IntegrationGate 테이블 + owner + config | owner 있음 |
| 3 | `/admin/phase0-cutover` | MRN 가명화 컷오버 승인 | 체크리스트 6항 + approve/execute/rollback + SoD(3중통제) | 승인자/실행자 |
| 4 | config `*.mode`(SIMULATION↔REAL) | eligibility·sign·ess.leaveApproval·erp… 실연동 전환 | SystemConfig 값 | 없음 |
| 5 | `/admin/data-quality` master | 기관정보 4개 미입력(요양기관기호·사업자번호·대표자·국문주소) | quality.metric(master.hospitalInfoUnset) | 없음 |
| 6 | `docs/…/go-live-checklist-security.md` | 단말②·HSM·sign전환·GIN인덱스·Redis·pm2 | **문서만**(앱 내 추적 없음) | 문서 |
| 7 | (없음) | 하드웨어(프린터 ZPL·WEBUSB·STT GPU) | 미추적 | — |
| 8 | config `*.ai.*` | AI 게이트(voc.ai·quality.ai·scribe) opt-in | SystemConfig | 없음 |

**결론**: 게이트/승인 **엔진**은 이미 잘 갖춰져 있으나(safety-gate·integration-gate·phase0-cutover), 이를 **가로지르는 운영 전환 관제(무엇이 실운영을 막고 있는가)**가 없다. go-live 체크리스트는 문서라 상태·소유·승인이 추적되지 않는다.

---

## 1. 목표와 범위

### 1.1 사용자 스토리
- **병원장/운영총괄**: "지금 실운영으로 넘어갈 수 있나? 못 넘어간다면 정확히 무엇이·누구 때문에 막혀 있고, 언제 풀리나?"
- **원무/QI/보안 담당**: "내가 담당인 전환 항목이 뭐고, 승인/실행은 어디서 하나?"
- **감사/법무**: "각 컷오버 항목의 승인 근거·이력이 남는가?"

### 1.2 핵심 원칙 — **집계(aggregation), 대체(replacement) 아님**
- 기존 상세 화면(safety-gates·integration-gates·phase0-cutover·data-quality)은 **그대로 존치** = 항목별 실제 조작/승인 장소.
- 신규 `/admin/go-live`는 그 위의 **롤업 계층**: 전 항목의 상태를 실시간 집계·준비도 점수·크리티컬 패스·담당/승인 추적. 각 항목은 상세 화면으로 **딥링크**.
- 이렇게 하면 중복 구현 없이 "단일 진실 소스"를 확보한다.

### 1.3 범위 밖
- 개별 게이트의 판정 로직(각 도메인 소관)·실 배포 스크립트(deploy.sh) — 관제는 상태 표시·승인만.

---

## 2. 통합 영역 도출 (운영 전환 관리영역 = 7영역)

실측을 근거로 실운영 전환 항목을 **7개 영역**으로 정본화:

| 영역(area) | 포함 항목 | 소스 |
|-----------|-----------|------|
| **A. 임상 안전게이트** | DUR·조제·CDSS·조영제·임신·재활·격리·ECT 등 10+종 OFF/WARN/BLOCK 승격 | safety-gate 레지스트리 |
| **B. 외부 연동 컷오버** | LIS·ERP·sign·edu·PACS 트랙별 결재/자격/이벤트 | integration-gate + `*.mode`(SIMULATION↔REAL) |
| **C. 개인정보/가명화** | MRN 가명화 컷오버(Phase0) 3중통제 | phase0-cutover |
| **D. 데이터 준비** | 기관정보 4개·코드마스터·시드 정합 | data-quality master |
| **E. 보안/인증** | 단말② 재인증·HSM·sign 전환·인증서 폐지·JWKS | go-live-checklist(문서→항목화) |
| **F. 인프라/성능** | GIN 인덱스·Redis maxmemory·pgss·pm2 cluster | go-live-checklist(문서→항목화) |
| **G. 하드웨어/AI** | 프린터ZPL·WEBUSB·STT GPU / AI 게이트 opt-in | 신규 추적 + config `*.ai.*` |

> 각 영역은 신규 `/admin/go-live` 카테고리에서 **탭/섹션**으로 관리되고, 항목은 아래 레지스트리로 정본화.

---

## 3. 아키텍처 (레지스트리 + 어댑터 집계)

```
                 ┌──────────────── /admin/go-live (운영 전환 관제) ───────────────┐
                 │  준비도 점수 · 영역별 롤업 · 크리티컬 패스 · 승인/이력          │
                 └───▲──────────▲──────────▲──────────▲──────────▲───────────────┘
                     │ adapter  │ adapter  │ adapter  │ adapter  │ (수동 상태)
        ┌────────────┴──┐ ┌─────┴─────┐ ┌──┴────────┐ ┌┴─────────┐ ┌──────────────┐
        │ safety-gate   │ │integration│ │phase0     │ │data-qual │ │ GoLiveItem   │
        │ (모드·위반)   │ │-gate      │ │-cutover   │ │(master)  │ │ (E/F/G 수동) │
        └───────────────┘ └───────────┘ └───────────┘ └──────────┘ └──────────────┘
```

- **어댑터**: 각 기존 서비스에 `readiness()` 어댑터를 두어 항목 상태를 표준 형태(`GoLiveItemStatus`)로 변환·집계. 기존 데이터 소스 그대로 사용(중복 저장 없음).
- **GoLiveItem(신규)**: 어댑터가 없는 영역(E 보안·F 인프라·G 하드웨어)의 항목을 **수동 관리 레지스트리**로 영속(문서였던 go-live 체크리스트를 앱 항목화).

---

## 4. 도메인 모델 (신규 Prisma)

```prisma
model GoLiveItem {
  id          String   @id @default(uuid()) @db.Uuid
  area        String   @db.VarChar(4)   // A~G
  key         String   @unique @db.VarChar(60)  // 'security.terminal2'·'infra.ginIndex'
  title       String   @db.VarChar(300)
  type        String   @db.VarChar(12)  // CONFIG_GATE/APPROVAL/EXTERNAL/MANUAL/HARDWARE
  owner       String?  @db.VarChar(60)  // 담당 역할/팀
  status      String   @default("NOT_READY") @db.VarChar(12) // NOT_READY/IN_PROGRESS/READY/DONE/BLOCKED
  blocker     String?  @db.Text          // 무엇이 막고 있나(사람 입력)
  drillDown   String?  @db.VarChar(200)  // 상세 관리 화면 딥링크
  sourceKey   String?  @db.VarChar(80)   // 어댑터 연동 키(config key·gate key·track key)·null=수동
  targetMode  String?  @db.VarChar(8)    // A영역 항목: 준비 판정 목표 모드(OFF/WARN/BLOCK). null=수동
  isBlocking  Boolean  @default(true)    // go-live 필수 여부(false=선택/후속)
  targetDate  DateTime? @db.Date         // 목표 전환일
  updatedBy   String?  @db.Uuid
  updatedAt   DateTime @updatedAt
  createdAt   DateTime @default(now())

  approvals   GoLiveApproval[]

  @@index([area, status])
  @@map("go_live_items")
}

model GoLiveApproval {
  id         String   @id @default(uuid()) @db.Uuid
  itemId     String   @db.Uuid
  action     String   @db.VarChar(12) // APPROVE/REVOKE/EXECUTE/ROLLBACK
  actorId    String   @db.Uuid
  actorName  String   @db.VarChar(100)
  reason     String   @db.Text
  createdAt  DateTime @default(now())
  item       GoLiveItem @relation(fields: [itemId], references: [id], onDelete: Cascade)
  @@map("go_live_approvals")
}
```

- **자동 항목(A~D)**: `sourceKey`로 어댑터가 status를 실시간 계산(레코드는 시딩만·status는 파생). 예: `sourceKey='dur.enforce'`→safety-gate 모드가 BLOCK이면 READY.
- **수동 항목(E~G)**: 담당이 status·blocker를 직접 갱신 + 필요 시 승인.

---

## 5. 관제 화면 (`/admin/go-live`)

### 5.1 상단 — 준비도 대시보드
- **Go-Live 준비도**: `READY+DONE / 전체 blocking 항목` %. 대형 게이지.
- 영역별 롤업 카드(A~G): 준비/전체·BLOCKED 강조.
- **크리티컬 패스**: BLOCKED·NOT_READY인 blocking 항목만 소유자·blocker와 함께 리스트(= "실운영을 막는 것").

### 5.2 항목 리스트(영역 탭)
- 각 항목: area·title·type칩·owner·status배지·targetDate·딥링크.
- 자동 항목은 실시간 파생 status(회색=조작 불가·딥링크로 상세 이동), 수동 항목은 인라인 status/blocker 편집.

### 5.3 항목 상세/승인
- APPROVAL 유형(가명화·연동 ENFORCE·인증서 폐지 등): phase0-cutover식 **승인→실행→롤백 + 직무분리(4-eyes) + 감사**. 승인 이력(GoLiveApproval) 표시.

---

## 6. 승인·거버넌스 (기존 3중통제 재사용)

- **APPROVAL 항목**은 phase0-cutover의 3중 통제 패턴 준용: ①승인 게이팅(체크리스트 전항+사유) ②config PUT 우회 차단(PROTECTED_KEYS 확장) ③직무분리(승인자≠실행자·config 토글).
- **감사**: 모든 상태 변경·승인은 GoLiveApproval + AuditLog(모델 실재·schema 798).
- **권한(V1 교정)**: `/admin/go-live` = **ADMIN(편집·승인) + EXECUTIVE(읽기전용 롤업)**. "운영총괄"이라는 UserRole은 없음 — EXECUTIVE(경영진·읽기전용 관제·강마스킹)가 정본이며 safety-gate 컨트롤러(`@Roles(ADMIN, EXECUTIVE)`)와 정합. 승인/실행 액션은 ADMIN 전용.

---

## 7. 집계·준비도 로직 (어댑터 — 실측 시그니처)

각 영역 어댑터가 기존 서비스를 호출해 표준 `GoLiveItemStatus`로 변환:

- **A 안전게이트** — `SafetyGateService.dashboard()` → `{gates: GateStat[]}`, 각 `{key, mode(OFF/WARN/BLOCK·gateMode 정규화), rawValue, defaultMode, violations7d/30d}`.
  - 판정(V4): **mode 순서 OFF(0)<WARN(1)<BLOCK(2)** 로 `mode >= targetMode`. 단 **`rawValue !== null`(의식적 설정)** 동반 확인 — gateMode는 부재 시 fail-closed로 BLOCK을 반환하므로 "한번도 안 만진 게이트"가 거짓 READY로 보이는 것 방지. targetMode는 GoLiveItem에 항목별 지정(전부 BLOCK 아님 — CDSS·조영제 등은 병원이 WARN/의식적 OFF를 목표로 둘 수 있음).
- **B 연동** — `IntegrationGateService`의 트랙 조회. IntegrationGate(`{track, key, status(PENDING|CONFIRMED), owner, evidence*}`·`@@unique[track,key]`)의 **트랙 전 게이트 status=CONFIRMED** + 해당 `*.mode`=REAL이면 DONE. (integration-gate가 이미 증빙·결재자·문서링크 보유 → GoLiveItem은 중복 저장 없이 트랙키 참조만·V3)
- **C 가명화** — `Phase0CutoverService.status()` → `{approved, executed, canExecute}`. executed→DONE·approved→READY·else NOT_READY.
- **D 데이터** — `DataQualityService.summary()` → `{domains:[{metrics:[{key,value}]}]}`. `master.hospitalInfoUnset` value=0이면 READY.
- **수동(E~G)**: GoLiveItem.status 직접(어댑터 없음).

**모드 실연동 키(V2 정정)**: SIMULATION↔REAL 토글은 광범위하지 않고 **3키뿐** — `eligibility.mode`(SIMULATION|NHIS)·`sign.mode`(SIMULATION|EXTERNAL)·`ess.leaveApprovalMode`(SIMULATION|CLINIC). `erp.enabled`·`scribe.enabled`·`voc.enabled`는 on/off. 그 외 실운영 게이트는 `*.enforce`(asp·cdss·dur·immunization·preauth) OFF/WARN/BLOCK.

**준비도 점수** = blocking 항목 중 READY/DONE 비율. 100%면 "실운영 전환 가능" 배너.

---

## 8. 구현 단계 (P0~P3)

| 단계 | 내용 | 산출 |
|------|------|------|
| **P0** | GoLiveItem/Approval 스키마 + `/admin/go-live` 롤업(어댑터 A안전게이트·C가명화·D데이터 집계·준비도 점수·크리티컬 패스) | 단일 관제 뷰 |
| **P1** | 수동 레지스트리(E보안·F인프라·G하드웨어) 시딩(go-live 체크리스트 항목화)+인라인 상태/blocker 편집·소유자·목표일 | 문서→추적 |
| **P2** | B 연동 어댑터(integration-gate·`*.mode`)+APPROVAL 항목 승인/실행/롤백(3중통제)+config PUT 보호 확장 | 승인 워크플로우 |
| **P3** | 준비도 이력 스냅샷(추이)·목표일 알림·전환 리허설 체크·go-live 실행 게이트 | 전환 실행 지원 |

각 단계: 클린 `nest build`+`node dist/main.js` 부팅검증→deploy.sh→스모크→운영 e2e→PR/머지. 스키마(P0)는 `--schema`+prisma generate.

---

## 9. 리스크·결정 필요

| 항목 | 이슈 | 기본안 |
|------|------|--------|
| 어댑터 status 파생 정확도 | 게이트 모드 ≠ 실제 준비도(예: BLOCK인데 위반 다발) | mode + 최근 위반통계 함께 표기·판정은 mode 기준 |
| 수동 항목 신선도 | E~G status가 낡을 수 있음 | updatedAt 표시·오래되면 "재확인 필요" 배지 |
| go-live 실행 자동화 | 준비 100%여도 실행은 사람 판단 | 배너/통지만·실행 버튼 없음(각 항목 상세에서 개별 실행) |
| 권한 남용 | 관제에서 게이트 일괄 변경 | 관제는 읽기+승인만·실제 mode 변경은 기존 상세 화면(권한 분리) |

---

## 10. 재사용 자산
- 게이트 레지스트리: safety-gate(모드·위반통계)·integration-gate(트랙·owner)
- 승인 3중통제: phase0-cutover(approve/execute/rollback·SoD·PROTECTED_KEYS)
- 데이터 준비: data-quality master metric·quality-registry
- config: SystemConfig `*.mode`(SIMULATION↔REAL)·`*.enforce`·`*.ai.*`
- 문서 소스: go-live-checklist-security.md(E/F 항목화 원천)
- 관제 UI 규약: StatusBadge·KDate·드릴다운 딥링크(data-quality 패턴)

## 11-A. 정밀 검증 결과 (스키마·실코드 대조 교정)

착수 전 모든 집계 소스·가정을 실코드와 대조. 교정·확정:

| # | 가정 | 실측 | 반영 |
|---|------|------|------|
| V1 | 권한 = ADMIN + "운영총괄" | UserRole에 운영총괄 없음. safety-gate는 `@Roles(ADMIN, EXECUTIVE)`·EXECUTIVE=경영진 읽기전용(강마스킹) | ADMIN(편집·승인)+EXECUTIVE(읽기전용). 승인은 ADMIN 전용 |
| V2 | `*.mode` SIMULATION↔REAL 광범위 | 실제 3키만: `eligibility.mode`·`sign.mode`·`ess.leaveApprovalMode`. 나머지는 `*.enabled`(on/off)·`*.enforce`(OFF/WARN/BLOCK) | 어댑터가 키별 정확히 매핑 |
| V3 | GoLiveItem이 연동 승인 저장 | IntegrationGate가 이미 `status(PENDING\|CONFIRMED)·owner·evidenceType·approverName·evidenceUrl·approvedOn`+`@@unique[track,key]` 보유 | B영역은 **참조만**(sourceKey=track)·중복 저장 금지 |
| V4 | 안전게이트 READY=BLOCK 일괄 | gateMode는 부재 시 fail-closed BLOCK 반환 → 미설정 게이트가 거짓 READY. mode는 순서형(OFF<WARN<BLOCK) | **targetMode 항목별 지정** + `rawValue!==null`(의식적 설정) 동반 판정 |
| V5 | data-quality 지표 임의 조회 | `summary()`→`{domains:[{metrics:[{key,value,total}]}]}`. master.hospitalInfoUnset은 P3에서 신설됨(quality-registry MASTER_METRICS) | D영역=summary()에서 해당 key value=0 판정 |
| V6 | phase0 status 임의 | `Phase0CutoverService.status()`→`{approved, executed, canExecute, technicalReady, checklist}` | C영역=executed→DONE·approved→READY |
| V7 | config PUT 보호 신규 | `config-runtime.controller` PROTECTED_KEYS(pseudonymizeChartNo·cutoverApproval) 이미 존재 | APPROVAL 항목 키를 PROTECTED_KEYS에 확장 |
| V8 | gateMode 단순 | fail-closed(오타·공백·미설정→BLOCK) — "값 있음 ≠ 의식적 결정" | rawValue null 체크로 "결정됨" 구분 |

### 11-A.1 어댑터 인터페이스 (표준 변환)
```ts
interface GoLiveItemStatus { key: string; status: 'NOT_READY'|'IN_PROGRESS'|'READY'|'DONE'|'BLOCKED'; detail?: string; drillDown?: string; }
// A: safetyGate.dashboard().gates → 각 targetMode·rawValue 기준
// B: integrationGate 트랙 gates 전부 CONFIRMED + mode=REAL → DONE
// C: phase0.status() → executed/approved
// D: dataQuality.summary() → master.hospitalInfoUnset value
```

### 11-A.2 config 게이트 키 정본 목록 (실측)
- **enforce(OFF/WARN/BLOCK)**: `dur.enforce`·`cdss.enforce`·`asp.enforce`·`preauth.enforce`·`immunization.enforce`·`pharmacy.durGate.enforce`·`inventory.expiryIssueEnforce`·`equipment.useEnforce`·`imaging.contrastEnforce`·`imaging.pregnancyEnforce`·`rehab.sessionGate`·`psychiatry.*Enforce`·`formulary.enforce`
- **mode(SIMULATION↔실)**: `eligibility.mode`·`sign.mode`·`ess.leaveApprovalMode`
- **enabled(on/off)**: `erp.enabled`·`scribe.enabled`·`eligibility.enabled`·`voc.enabled`
- **AI opt-in**: `voc.ai.*`·`quality.ai.*`·`ai.server.enabled`
- **가명화**: `integration.pseudonymizeChartNo`·`integration.cutoverApproval`(PROTECTED)

### 11-A.3 마이그레이션·배포 (신규 2모델)
- GoLiveItem/GoLiveApproval → `deploy.sh --schema` + prisma generate(신규모델 rsync+generate+build+restart). `db push` 플래그 없이.
- 어댑터가 참조하는 모듈(SafetyGate·IntegrationGate·Phase0Cutover·DataQuality)을 GoLiveModule에 import — **순환 위험 점검 필수**(부팅검증). 순환 시 leaf 서비스 직접등록(DurModule 선례) 또는 어댑터를 config/DB 직접 조회로 우회.
- Sidebar 신규 카테고리 등록(ADMIN_ONLY + EXECUTIVE).

## 12. 핵심 설계 판단 (요약)
1. **집계 계층, 대체 아님** — 기존 게이트/승인 엔진(safety-gate·integration-gate·phase0-cutover)은 잘 갖춰짐. 없는 건 "가로지르는 운영 전환 관제". 롤업만 신설·상세는 존치·딥링크.
2. **7영역 정본화** — 파편화된 컷오버 항목을 A~G로 분류·단일 카테고리.
3. **자동 파생 + 수동 레지스트리 혼합** — A~D는 어댑터로 실시간(중복 저장 없음), E~G(문서였던 go-live 체크리스트)는 GoLiveItem으로 추적.
4. **승인은 3중통제 재사용** — 새 거버넌스 엔진 없이 phase0 패턴(승인·실행·롤백·SoD·PROTECTED_KEYS) 확장.
5. **정밀검증 8건 반영** — 권한=EXECUTIVE·mode 3키·연동은 참조·targetMode+rawValue 판정·어댑터 모듈 순환 점검(§11-A).
