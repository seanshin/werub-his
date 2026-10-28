# 사람 결정 관리 콘솔 + 결정에 따른 자동 반영

작성 2026-08-27 · 발단: 사람 지시
("사람 결정 34건 정리해서 관리 기능으로 분리할 것. 그리고, 자동화가 필요한 부분은
결정에 따라 반영되도록 구현되도록 기획서 작성")

정본: `decision.registry.ts`(등록부) · `decision.service.ts`(기록) ·
`gld/governance-enactment.service.ts`(집행 엔진) · `go-live.registry.ts`(개시 관제)

---

## 0. 한 줄

🔴 **자동 반영 엔진은 이미 있다. 결정 등록부가 그것을 쓰지 않고, 옆에 더 약한 것을 하나 더 갖고 있다.**

---

## 1. 실측 — 지금 무슨 일이 일어나고 있는가 (2026-08-27)

### 1.1 결정 34건의 구성

| 축 | 분포 |
|---|---|
| 층 | 허가권자 **9** · 원내 위원회 **23** · 직원 건별 **1** |
| 승인 경로 | `COMMITTEE` **19** · `AUTHORIZED_ROLE` **7** · `CODE_CHANGE` **6** · `PER_EVENT_DIALOG` **1** |
| 개시 관계 | `REQUIRED_BEFORE` **5** · `CAN_FOLLOW` **24** · `NOT_RELATED` **4** |
| 🔴 **`configKey` 가 있는 것** | **3 / 34** |
| 기록된 결정 | **0건**(운영) |

### 1.2 🔴 결정 체계가 둘이고, 자동화가 붙어 있는 쪽은 등록부가 아니다

| | **A. 결정 등록부** (`decision-registry`) | **B. 거버넌스 엔진** (`gld`) |
|---|---|---|
| 무엇을 담나 | "사람이 정해야 할 것" 34건 + 브리핑 | 위원회 안건 → 의결 → **집행** |
| 저장소 | `SystemConfig` 의 키 하나(`KEY(key)`) | `CommitteeDecision` + **`DecisionAction`** 테이블 |
| 적용 방법 | `config.set(d.configKey, value)` **직접 호출** | kind 8종(`CONFIG_CHANGE`·`GATE_MODE`·`FORMULARY`·`MASTER_DATA`·`TEMPLATE`·`ACCESS`·`PUBLISH`·`RETENTION`) |
| 적용 전 스냅샷 | ❌ 없음 | ✅ `snapshotBefore` |
| 적용 실패 기록 | 🔴 **없음** — `config.set` 이 던지면 **결정 기록 자체가 남지 않는다**(try/catch 부재) | ✅ `status='FAILED'` + `error` + 간사 통보 |
| 재시도 안전성 | 미정의 | ✅ **목표 상태 지정**(토글류 바인딩 금지) |
| 적용 대상 | **3건**뿐 | 9종 kind |

연결은 **한 방향뿐**이다 — 거버넌스가 안건을 만들 때 등록부 정의를 **인용**한다
(`governance.service.ts:607`). 반대 방향, 즉 **등록부의 결정이 집행 엔진으로 흘러가는 경로는 없다.**

🔴 이것이 이 저장소가 반복해서 당한 **P12(같은 사실에 정본이 둘)** 다.
게다가 약한 쪽이 실제 운영 설정을 바꾸고 있다.

### 1.2-b 🔴 그런데 **쓰이고 있는 쪽은 집행 엔진이다** (운영 실측 2026-08-27)

| | 행 수 |
|---|---:|
| `decision_actions` | **24** — `CONFIG_CHANGE` **12** · `GATE_MODE` **5** · `MANUAL` **7** (전부 `ENACTED`) |
| `committee_decisions` | **20** (`ENACTED` 19 · `RESOLVED` 1) |
| 🔴 결정 등록부 기록(`system_configs` `decision.*`) | **0** |

이 실측이 방향을 정한다:

- 🔴 **집행 엔진은 "만들어놓고 안 쓰인 정본"이 아니다.** 위원회 의결 19건이 실제로 집행됐고,
  설정 변경 12건·게이트 모드 5건이 그 경로로 반영됐다. **검증된 경로다.**
- 🔴 **쓰이지 않는 쪽은 결정 등록부다.** 34건 등재·기록 **0건**.
  즉 지금 34건은 *"정해야 한다"고 화면에 적혀 있을 뿐* 아무 것도 통과한 적이 없다.

→ 그러므로 D4(등록부를 집행 엔진에 붙이기)는 **약한 것을 강한 것에 합치는 일**이지
  검증되지 않은 두 시스템을 섞는 일이 아니다. **엔진을 살리는 작업은 필요 없다.**

⚠️ 다만 `FAILED` 는 24건 중 **0건**이다 — 실패 경로는 **아직 한 번도 지나가지 않았다.**
그래서 D5 는 반드시 **결함 재주입으로** 검증한다(집행을 던지게 하고 `FAILED` 가 남는지).

### 1.3 나머지 30건은 결정해도 아무 일도 일어나지 않는다

`configKey` 가 없으면 `decide()` 는 문자열만 남긴다:

- `COMMITTEE` → *"위원회 의결 사항이라 이 화면은 적용하지 않는다 — /admin/gld 에 안건으로"*
- `CODE_CHANGE` → *"코드·스키마 변경이라 배포로만 반영된다"*

**이 문장들은 사실이다.** 문제는 그 다음이 **아무 데도 없다는 것**이다 —
안건이 실제로 올라갔는지, 배포가 됐는지, 누가 들고 있는지를 시스템이 모른다.
🔴 **결정은 기록됐는데 이행은 사람 기억에 남는다.**

### 1.4 관리 기능이라 부를 것이 없다

`/admin/decisions`(344줄)는 층별로 34건을 **나열**한다. 없는 것:

- 필터·검색(층·경로·개시관계·상태) · 정렬
- 🔴 **담당자·기한** — 등록부에 `owner`/`dueDate` 필드가 **0건**(개시 관제에는 `owner` 가 있다)
- 의존 관계 보기(`dependsOn` 9건이 있는데 그래프가 없다)
- **이행 추적**(의결→집행→확인)
- 변경 이력(누가 언제 뒤집었는가)

---

## 2. 🔴 엔진의 실제 계약 — 여기에 맞추지 않으면 붙지 않는다

기획을 쓰기 전에 집행 엔진(`governance-enactment.service.ts` 557줄)을 읽었다.
**아래는 설계 취향이 아니라 코드가 이미 강제하는 것들이다.**

| # | 계약 | 근거 |
|---|---|---|
| C1 | 🔴 **액션은 `CommitteeDecision` 에 매달린다** — `DecisionAction.decisionId` **NOT NULL** | schema |
| C2 | 🔴 **`CommitteeDecision` 은 `committeeId`·`agendaId` 가 NOT NULL**(`agendaId` 는 unique) | schema |
| C3 | 집행은 `RESOLVED`/`PARTIALLY_ENACTED` 상태에서만 | `enactDecision()` |
| C4 | `CONFIG_CHANGE`/`GATE_MODE` 는 **`config.hasDefault(key)` 통과 필수** — DEFAULTS 카탈로그에 없으면 `KEY_NOT_IN_CATALOG` | `validateAction()` |
| C5 | `PROTECTED_KEYS`(`integration.pseudonymizeChartNo`·`integration.cutoverApproval`)는 **바인딩 금지** | `validateAction()` |
| C6 | **비멱등 op 금지** — `toggle` 대신 `setStatus` 로 **목표 상태 지정**(재시도 안전) | `validateAction()` |
| C7 | `MASTER_DATA` 는 **등록제** — 허용 마스터 7종 밖은 의결 시점에 거부 | `MASTER_BINDINGS` |
| C8 | 크론 10분 · `effectiveFrom` 도래분만 · **크론 집행은 `enactedBy=null`**(주체 날조 금지) | `cron()` |
| C9 | 실패는 `FAILED`+`error`+간사 알림 — 조용히 넘어가지 않는다 | `enactDecision()` |
| C10 | 게이트 `governance.enactment.enabled` — 🔴 **운영 실측 `true`**(엔진이 켜져 있다) | 운영 DB |

### 2.1 🔴 그래서 D4 를 처음 안대로 하면 거짓말을 하게 된다

C1+C2 때문에 **허가권자 결정(7건)을 지금 엔진에 넣으려면 위원회와 안건을 지어내야 한다.**
그러면 원장(`committee_decisions`)에 **위원회가 의결하지 않은 것이 의결로 박힌다.**

이 저장소의 고정 원칙과 정면으로 어긋난다 —
*"결정의 세 층은 고정 · **하위가 상위를 대체하지 못한다**"* ·
*"화면이 갖지 않은 권한을 가진 척하지 않는다"*.

**→ 이 방안은 채택하지 않는다.**

---

## 3. 채택안 — **원장을 일반화한다**(엔진은 그대로 둔다)

집행의 본질(*무엇을 어떻게 바꾸는가*)은 **출처와 무관하다.**
바뀌어야 하는 것은 집행기가 아니라 **"이 액션이 어느 결정에서 왔는가"** 한 칸이다.

```
DecisionAction
  decisionId   String?   ← NOT NULL 을 nullable 로   (위원회 의결에서 온 액션)
  registryKey  String?   ← 신설                      (결정 등록부에서 온 액션)
  🔴 불변식: 정확히 하나만 채워진다(둘 다 null·둘 다 채움 금지)
```

- `validateAction` · `executeAction` · `snapshotBefore` · `FAILED`+error · `surfaceKeyOf`
  **전부 그대로 재사용한다.** 한 줄도 복제하지 않는다.
- 엔진에 진입점 하나만 더한다 — `enactRegistryDecision(registryKey, userId)`.
  내부는 `enactDecision` 과 **같은 루프**를 부른다(C3 상태 검사만 출처별로 갈린다).

### 3.1 승인 경로별 배선 — 층 규칙을 자동화가 깨지 않는다

| 등록부 `approvalPath` | 건수 | 자동 반영 경로 | 액션 출처 |
|---|---:|---|---|
| `AUTHORIZED_ROLE` | 7 | 결정 기록 즉시 → 집행 | **`registryKey`** |
| `COMMITTEE` | 19 | 🔴 **안건 상신 → 위원회 의결 → 집행**(기존 경로 그대로) | `decisionId` |
| `CODE_CHANGE` | 6 | ❌ 배포로만 — `MANUAL` 액션으로 **이행만 추적** | `registryKey` |
| `PER_EVENT_DIALOG` | 1 | 자동화 대상 아님(건별 승인) | — |

🔴 **`COMMITTEE` 결정은 등록부 화면이 집행하지 않는다.** 등록부의 일은 *안건을 올리는 것*까지다.
거버넌스는 이미 `sourceRef: {type:'DECISION', key}` 로 등록부를 인용하는 경로를 갖고 있다
(`governance.service.ts:607`) — **그 경로에 상신 버튼을 붙이는 것으로 족하다.**

이렇게 하면 자동화가 층을 넘지 못한다:
**허가권자 사항은 위원회 의결로 반영될 수 없고, 위원회 사항은 등록부 기록만으로 반영되지 않는다.**

### 3.2 🔴 이 변경이 깨뜨리는 것 — 미리 찾아둔 2곳

`decisionId` 를 nullable 로 만들면 아래 둘이 **런타임에 터진다**(둘 다 `a.decision` 을 널 아님으로 읽는다):

| 위치 | 지금 | 고칠 것 |
|---|---|---|
| `governance.service.ts` `provenance()` | `include: { decision: {...} }` → `a.decision` | 출처 2종을 모두 표시(위원회 결정번호 / 등록부 결정키) |
| 같은 파일 `activeDecisionBadges()` | `a.decision.id`·`a.decision.decisionNo` | ⚖ 배지가 **출처를 구분해** 말한다 |

🔴 **배지가 등록부 액션을 "위원회 의결"로 그리면 그 화면이 거짓말을 한다.**
배지 문구를 출처별로 나눈다(`위원회 <결정번호>` / `허가권자 결정 <키>`).

### 3.3 바인딩 스키마 — 엔진 어휘를 **import** 한다

```ts
enactment?: {
  kind: EnactmentKind;                       // 🔴 ENACTABLE_KINDS 에서 import(어휘를 지어내지 않는다)
  targetByChoice: Record<string, object | null>;  // 선택지 → target · null = "이 선택은 바꾸지 않는다"
}
```

- 🔴 **선택지를 빠뜨리는 것과 바꾸지 않는 것은 다른 사실이다** → `null` 을 명시하게 하고 가드가 전 선택지 존재를 강제한다.
- 🔴 **C4 때문에 `CONFIG_CHANGE` 바인딩 키는 DEFAULTS 에 있어야 한다.**
  현재 3건(`billing.institution.grade`·`notification.patientPush.enabled`·`notification.staffLabResult.enabled`)은 **전부 통과**(실측).
- 🔴 **C5 충돌 사전 점검**: `legal.erpMrn.pseudonymization` 은 성격상
  `integration.pseudonymizeChartNo` 를 겨눌 텐데 그 키는 **`PROTECTED_KEYS`** 다 →
  바인딩 불가이며 `MANUAL` 로 둔다(전용 승인 워크플로가 따로 있다).
- 🔴 **C6**: 등록부 선택지는 대개 목표 상태라 자연히 멱등이다. `toggle` 형 문구가 있으면 **문구를 고친다**.

### 3.4 `decide()` 에서 걷어낼 것

```
지금:  config.set(d.configKey, value)      ← 스냅샷 없음 · try/catch 없음 · 실패하면 결정 기록 자체가 사라짐
이후:  DecisionAction(registryKey, kind, target) 생성 → 엔진 집행 → ENACTED | FAILED
```

🔴 **결정 기록과 집행을 분리한다.** 지금은 한 트랜잭션처럼 엮여 있어
집행이 실패하면 *"정했다"는 사실까지 사라진다.* 결정은 사람이 한 것이고, 집행은 시스템이 한 것이다 —
**하나가 실패했다고 다른 하나를 지우지 않는다.**

### 3.5 게이트가 꺼져 있을 때

C10 상 게이트는 지금 `true` 지만, 꺼지면 `enactDecision` 은 `ENACTMENT_OFF` 로 거부한다.
🔴 그때 등록부 화면은 **"기록됐고, 반영은 보류 중"** 이라고 말한다 —
"적용됨"이라 말하면 안 되고, 결정 기록을 막아서도 안 된다(사람의 결정은 이미 일어난 사실이다).

---

## 3-b. 관리 콘솔 (`/admin/decisions/console` 신설)

지금 `/admin/decisions`(344줄)는 **결정하는 곳**이다 — 독자는 허가권자·위원.
콘솔은 **관리하는 곳**이다 — 독자는 전산·기획·간사. 화면을 나누는 이유는 독자가 다르기 때문이다.

콘솔이 답할 질문(그 순서대로 짠다):

1. **지금 개시를 막고 있는 것** — `REQUIRED_BEFORE` 5건 + 그 선행 조건
2. **지금 결정할 수 있는 것** — `readyToDecide`(이미 구현된 `unmetDependencies` 재사용)
3. 🔴 **결정했는데 아직 반영되지 않은 것** — `PENDING`/`FAILED` 액션
4. **누가 들고 있는가 · 언제까지인가**

### 3-b.1 등록부에 `owner`·`dueBy` 를 더한다

개시 관제(`go-live.registry.ts`)는 이미 `owner` 를 갖는데 결정에는 **0건**이다.
- 🔴 **사람 이름이 아니라 역할·부서**(사람이 바뀌면 담당이 사라진다)
- 🔴 `dueBy` 는 **절대 날짜가 아니라 개시 기준 상대 표현**(`BEFORE_GO_LIVE`/`WITHIN_30D`/`NONE`) —
  개시일이 없는데 날짜를 박으면 그 날짜가 곧 거짓이 된다

### 3-b.2 개시 관제와 양방향

지금 연결은 `note` 안의 **문자열**이다(`billing.institutionGrade` 항목).
→ 정본 필드 `decisionKey` 로 올리고 **양쪽 존재를 기계 대조**한다.
🔴 문자열 링크는 키를 바꿔도 아무도 모른다.

### 3-b.3 이행 상태 5종

| 상태 | 뜻 |
|---|---|
| `미결` | 아직 결정하지 않았다 |
| `결정·반영됨` | `ENACTED` — 무엇이 바뀌었는지 값으로 보인다 |
| `결정·반영대기` | `PENDING` — 의결·배포·게이트 OFF 등으로 남아 있다 |
| 🔴 `결정·반영실패` | `FAILED` — **지금은 이 상태가 존재조차 하지 않는다** |
| `결정·수동확인` | `MANUAL` 이행을 사람이 표시(자가신고로 센다) |

🔴 **`반영대기`를 `반영됨`과 같은 초록으로 그리지 않는다.** 합치면
"20건 결정 완료"가 실제로는 아무것도 바뀌지 않은 상태를 가린다.
🔴 **층별 진행률을 합치지 않고**(기존 규칙) **실검증/자가신고를 갈라서** 센다.

---

## 3-c. 하지 않을 것

- 🔴 **새 집행 엔진·새 액션 원장을 만들지 않는다** — 검증된 것(24건 집행)에 합친다
- 🔴 **위원회·안건을 지어내지 않는다**(§2.1)
- 🔴 **자동 롤백을 만들지 않는다** — 엔진의 D8 그대로(복원은 되돌리는 **결정**으로)
- 🔴 **결정 저장소를 `SystemConfig` 에서 옮기지 않는다**(이번 범위 밖) — 이행 상태만 액션 원장으로
- 🔴 **결정 여부를 `config.get()` 으로 판정하지 않는다** — 기본값이 결정으로 읽힌다(오늘 종별 축에서 확인)
- **자동 실행 기본 ON 금지** — 대외 발신 3조건 규약 그대로

## 4. 단계

| 단계 | 내용 | 선행 |
|---|---|---|
| **D1** | 🔴 **스키마**: `DecisionAction.decisionId` nullable + `registryKey` 신설 + 불변식(정확히 하나) | — |
| **D2** | 🔴 **`provenance()`·`activeDecisionBadges()` 를 출처 2종에 대응**(§3.2 — 안 고치면 터진다) · ⚖ 배지 문구 분리 | D1 |
| **D3** | 엔진 진입점 `enactRegistryDecision(key, userId)` — `validateAction`/`executeAction`/스냅샷/FAILED **재사용** | D1 |
| **D4** | `enactment` 바인딩 스키마(`ENACTABLE_KINDS` import) + 기존 3건 이전 · `decide()` 에서 `config.set` 직접 호출 제거 | D3 |
| **D5** | 이행 상태 5종 + `FAILED` 경로 · 게이트 OFF 시 "반영 보류" 표기 | D4 |
| **D6** | 등록부에 `owner`·`dueBy` + 개시 관제 `decisionKey` 양방향 가드 | — |
| **D7** | `/admin/decisions/console` 신설 | D5·D6 |
| **D8** | `COMMITTEE` 19건에 **안건 상신** 버튼(기존 `sourceRef DECISION` 경로) | D4 |
| **D9** | 나머지 결정에 바인딩 부여(가능한 것만) · 불가한 것은 `MANUAL` 로 명시 | D4 |

🔴 **D1~D4 가 이 기획의 몸통이다.** D6~D7 만 하면 화면만 좋아지고 이행은 여전히 기억에 남는다.
🔴 **D2 를 D1 과 같은 배포에 넣는다** — 나누면 그 사이에 배지·역추적이 죽는다.

---

## 5. 가드 (착수 시) — 전부 **결함 재주입**으로 검증한다

### 5.1 원장 일반화 (D1~D3)

- 🔴 **불변식**: `decisionId` 와 `registryKey` 중 **정확히 하나**만 채워진다
  · 재주입: 둘 다 null / 둘 다 채움 → 거부되는가
- 🔴 **`provenance()` 가 두 출처를 모두 돌려준다** — 재주입: 등록부 액션만 있는 표면을 조회
  · 🔴 **대조군**: 위원회 액션만 있는 표면은 종전과 **똑같이** 나온다(회귀 없음)
- 🔴 **⚖ 배지가 등록부 액션을 "위원회 의결"로 그리지 않는다**(출처 문구 분리)
  · 재주입: 문구를 합치면 실패해야 한다

### 5.2 바인딩 (D4)

- 🔴 **`kind` 어휘가 `ENACTABLE_KINDS` 와 집합이 같다** — 등록부가 어휘를 지어내지 못하게
  · 오늘 종별 축에서 같은 실수를 할 뻔했다
- 🔴 **바인딩된 결정의 모든 선택지가 target 을 갖는다** — 빠뜨림 = 조용한 미반영
  · **대조군**: `null`(바꾸지 않음)은 정당하다
- 🔴 **C4**: `CONFIG_CHANGE` 바인딩 키가 전부 `hasDefault()` 를 통과한다
- 🔴 **C5**: `PROTECTED_KEYS` 를 겨눈 바인딩이 없다
- 🔴 **C6**: 바인딩 target 이 **목표 상태**다(toggle 형 없음)

### 5.3 층 규칙 (D4·D8)

- 🔴 **`COMMITTEE` 결정은 등록부 기록만으로 집행되지 않는다**
  · 재주입: `approvalPath:'COMMITTEE'` 에 `registryKey` 액션을 만들면 거부되는가
- 🔴 **위원회 의결이 `LICENSE_HOLDER` 사항을 반영하지 못한다**
- **대조군**: `AUTHORIZED_ROLE` + 바인딩은 정상 집행된다(전부 막는 가드 방지)

### 5.4 정직성 (D5)

- 🔴 **집행이 실패하면 `FAILED` 가 남고 결정 기록은 지워지지 않는다**
  · 재주입: `executeAction` 을 던지게 하고 **둘 다** 확인
  · 🔴 이 경로는 운영에서 **한 번도 지나간 적이 없다**(FAILED 0건) — 재주입이 유일한 증거다
- 🔴 **게이트 OFF 면 "반영됨"이라 말하지 않는다** — `ENACTMENT_OFF` 를 "보류"로 표시
  · **대조군**: 게이트 ON 이면 조용히 반영된다
- 🔴 **결정 여부를 `config.get()` 으로 판정하지 않는다**(기본값이 결정으로 읽히지 않게)

### 5.5 콘솔 (D6~D7)

- **개시 관제 ↔ 등록부 링크가 양쪽에 실재한다**(문자열 링크 금지)
- 진행률이 **층별로 분리**되고 **실검증/자가신고가 갈라져** 있다
- 🔴 `반영대기`가 `반영됨`과 같은 색으로 그려지지 않는다

## 6. 확인하지 못한 것

- ~~집행 엔진이 실제로 집행된 적이 있는지~~ → **실측 완료**(§1.2-b · 24건 ENACTED).
- ~~9종 중 6종이 한 번도 집행된 적 없다 — 바인딩 전에 눌러본다~~ → **완료(2026-08-27)**:
  · 부팅 프로브로 **배선 6종 전부 확인**(`BINDING_NOT_WIRED` **0건** — `@Optional()` 이라 미배선이면 여기서 걸린다)
  · 올바른 payload 로 `validateAction` **11/12 통과**(1건은 내 payload 오류·`dept` 는 경로 배열)
  · `executeAction` **디스패치를 테스트로 못박음**(10건 · 재주입 7/7)
  🔴 **남은 위험 하나**: 디스패치는 메서드 **이름**만 타입이 지키고 **인자는 `as never`** 로 우회한다.
     이름이 바뀌면 tsc 가 잡지만 **인자 순서가 바뀌면 아무도 모른다** → 그래서 인자 순서를 단언한다.
     실제로 이 테스트를 쓰다가 내가 정본 메서드 이름을 잘못 짚었고(`setItemStatus` ← 실제 `update`)
     테스트가 잡았다.
- ~~거버넌스 게이트 모드~~ → **실측 완료**: `governance.enactment.enabled = true` ·
  `governance.ai.enabled = true`(둘 다 운영에서 켜져 있다).
- 🔴 **위원회 마스터에 `code` 가 빈 행이 6건 있다**(사망·환자안전·의료윤리·약사·질향상·감염관리).
  `code` 는 집행 컨텍스트(`committee.code`)와 표면 맵에 쓰인다 —
  `COMMITTEE` 경로를 살리려면 **이 6건을 먼저 정리해야 하는지** 확인이 필요하다(이번 범위 밖).
- 결정 34건 중 **위원회가 실제로 열려야 하는 것**이 몇 건인지(19건은 등록부 기준이지 일정이 아니다).
- `DecisionAction` 불변식을 DB 제약(CHECK)으로 걸 수 있는지 — Prisma 에서 표현이 제한적이라
  **애플리케이션 가드로 갈지** 착수 시 판단한다.
