# 결정 경로(Decision Pathway) 엔진 — 보완계획서

작성 2026-08-27 · 발단: 사람 지시
("욕창 부분과 같이 진료위원회의 한 항목에서 상세하게 결정하는 기능과 해당 선택이 로그와 같이
관리되는 기능이 필요함" → "전체적으로 이렇게 의사결정이 필요한 부분들을 각 항목별로 조사해서,
해당 기능을 구성해야 함. 그리고, 해당 기능들이 어떤 근거로 동작시켜야 하는지에 대해서 기록이
남아야 함" → "운영위원회가 의사결정하는 CP와 같은 구성과 엔진이 필요함")

선행 계획서: `decision-console-and-enactment.plan.md`(등록부↔엔진 통합) ·
`committee-governance-engine.plan.md`(대장·GOV 발번) · `governance-agenda-workbench.plan.md`(AI 영향평가)
정본: `decision.registry.ts` · `gld/governance-enactment.service.ts` · `common/enactment-kinds.ts`

---

## 0. 한 줄

🔴 **임상에는 CP 엔진(템플릿·버전·단계·담당역할·게이트·SLA·전이·인스턴스·막힘사유)이 있는데,
의사결정에는 그 중 하나도 없다. 결정은 자유서술 두 칸과 사람이 손으로 타이핑하는 액션이 전부다.**

그리고 그 결과가 실측으로 나온다.

| 무엇이 | 얼마나 | 근거 |
|---|---:|---|
| 정책성 설정이 담당도 근거도 없이 동작 | **27 / 36** (75%) | §1.1 |
| **발효 중인 진료 표준에 의결 근거 없음** | **9 / 9** (임상경로 5·프로토콜 4) | §1.5 |

🔴 **급성심근경색 표준경로는 관리자 클릭 한 번으로 전 병원에 발효됐고, 누가 눌렀는지도 남지 않는다.**
실제 의료기관에서 CP·프로토콜은 위원회가 제정·개정·폐지를 의결하고 그 의결번호로 발효된다.
이 계획서가 메우려는 것이 그 사이다.

---

## 1. 실측 — 조사 결과 (2026-08-27 · 운영 DB)

### 1.1 🔴 정책성 표면 36 중 27이 근거 없이 동작 중

| 구분 | 수 |
|---|---:|
| 운영 설정 키 `system_configs` 전체 | 120 |
| **정책성(게이트형) 키** — `enforce`/`gate`/`required`/`enabled` | **36** |
| 그중 담당 위원회가 지정된 것(`committee_surface_maps`) | 8 |
| 그중 **결정으로 값이 정해진 것**(`decision_actions`) | **3** |
| 그중 둘 다 있는 것 | 2 |
| 🔴 **담당도 없고 결정도 없는 것** | **27 (75%)** |

(8 + 3 − 2 = 9 커버 · 36 − 9 = 27. 🔴 **담당이 정해진 것과 근거가 있는 것은 다른 축이다** —
담당 8 중 6은 담당만 있고 그 값이 왜 그 값인지는 없다.)

**항목별 조사 — 근거 없이 동작 중인 27개**

| 영역 | 키 | 현재값 | 왜 결정 사안인가 |
|---|---|---|---|
| 환자안전 | `nursing.bcma.enforce` | `"WARN"` | 투약 바코드 확인을 경고로만 — 승격 여부는 환자안전위원회 |
| 환자안전 | `bloodBank.bedsideScan.enforce` | `true` | 수혈 베드사이드 확인(IPSG.1) |
| 환자안전 | `surgery.preAnesthesiaGate` | `true` | 마취 전 평가 게이트 |
| 환자안전 | `inpatient.dischargeGate` | `true` | 퇴원 게이트 |
| AI | `ai.server.enabled` | `true` | AI 서버 사용 — **AI 의료기기 해당 여부(허가권자)에 종속** |
| AI | `scribe.enabled` | `true` | 앰비언트 스크라이브 |
| AI | `voiceEmr.enabled` / `.ambient.enabled` / `.ambient.aiDraft.enabled` | `true`×3 | **진료 원음 수집·AI 초안** — 자동실행 범위 결정에 종속 |
| AI | `quality.ai.enabled` | `false` | AI 품질 평가 |
| AI | `governance.ai.enabled` | `true` | 위원회 안건 AI 영향평가 |
| AI | `nursing.aiAssist.enabled` | `true` | 간호 AI 보조 |
| 전자결재 | `approval.clinicalNote.enabled` | `false` | 기록지 결재 게이트 |
| 전자결재 | `approval.clinicalCertificate.enabled` | `false` | 진단서 결재 |
| 전자결재 | `approval.consent.enabled` | `false` | 동의서 결재 |
| 전자결재 | `approval.recordCopy.enabled` | `false` | 기록 사본 발급 결재 |
| 전자결재 | `ess.approval.reminder.enabled` | `true` | 결재 독촉 |
| 대외연동 | `pacs.exportEnabled` | `true` | **영상 반출** — 대외 발신 3조건 축 |
| 대외연동 | `erp.webhookEnabled` / `erp.financeWebhookEnforce` / `erp.targetAuthEnforce` | `true`×3 | 재무 데이터 외부 전송 |
| 대외연동 | `lis.targetAuthEnforce` | `true` | 검사 결과 수신 인증 |
| 대외연동 | `fhir.serviceRequestInbound.enabled` | `true` | 외부 오더 수신 |
| 청구 | `billing.copayCap.preCoverageEnabled` | `true` | 본인부담상한 사전급여 |
| 청구 | `inpatient.stayBilling.enabled` | `true` | 입원료 자동 청구 |
| 기타 | `blockchain.selfIssuanceEnabled` | `false` | 검진권 자체 발행 |
| 기타 | `ess.payrollRelay.enabled` | `true` | 급여 중계 |

(위 표는 **23행에 27키**를 묶었다 — `voiceEmr` 3 · `approval` 4 · `erp` 3 을 한 줄로 합쳤다.)

#### 🔴 1.1-b 정정 — "화면이 정책인 척한다"는 **과장이었다** (2026-08-27 재검토)

초안은 "화면은 그것을 정책인 것처럼 보여준다"고 썼다. 다시 재니 **화면마다 다르다.**

| 어디에 있는가 | 27개 중 | 근거 표시 |
|---|---:|---|
| `/admin/safety-gates` 의 **wired 게이트** | **4** | ⚖ 배지 **자리가 있다**. 결정이 없어 배지가 안 뜰 뿐이고, 화면은 그 부재를 *"수동 변경 이력만"* 신호로 **설계했다**(주석까지 있다). 조회 실패와도 구분한다 |
| 기타 게이트(분류기) · `/admin/config` | **23** | 🔴 **근거 표시 자리가 아예 없다** |

배지 자리가 있는 4건 — `nursing.bcma.enforce` · `bloodBank.bedsideScan.enforce` ·
`surgery.preAnesthesiaGate` · `inpatient.dischargeGate`.

🔴 **그래서 정확한 문장은 이것이다** — 근거를 말할 자리가 있는 곳은 **4곳뿐**이고,
나머지 23곳은 자리조차 없다. 그리고 있는 4곳도 **부재로만** 말한다(명시 라벨이 아니다) —
읽는 사람이 "배지가 없으면 근거가 없다"는 규칙을 미리 알아야 한다.
**이 정정 없이 그대로 뒀으면 이미 정직하게 설계된 화면을 결함으로 몰 뻔했다.**

#### 1.1-c 항목별 판정 — **27개 중 21개만 결정 사안이다** (2026-08-28 · P1-b 착수 실측)

27개는 키 이름 패턴으로 뽑은 **후보**였다. 소비처를 하나씩 읽어 성격을 갈랐다.

🔴 **먼저 내 실측이 틀렸던 것 하나** — `erp.targetAuthEnforce`·`lis.targetAuthEnforce` 는
리터럴 grep 에서 **소비처 0** 으로 나왔다. 죽은 키가 아니라 `` `${scope}.targetAuthEnforce` `` 로
**동적 조합**돼 읽힌다(`integration-auth.service.ts:121`). *정적 분석은 호출 형태를 놓친다.*

**① 결정 사안 — 21건**

| 묶음 | 키 | 층·담당 | 왜 |
|---|---|---|---|
| 임상 안전 게이트 4 | `nursing.bcma.enforce`(WARN) · `bloodBank.bedsideScan.enforce` · `surgery.preAnesthesiaGate` · `inpatient.dischargeGate` | 위원회(QPS·TRF) | 게이트 모드가 환자 안전을 직접 정한다 |
| AI 임상 기능 6 | `ai.server.enabled` · `scribe.enabled` · `voiceEmr.enabled` · `voiceEmr.ambient.enabled` · `voiceEmr.ambient.aiDraft.enabled` · `nursing.aiAssist.enabled` | 허가권자 선행 → 위원회 | 🔴 선행 `legal.ai.deviceClassification`·`legal.phiBoundary.gpuTier` 에 **종속**. 기존 `policy.ai.autonomyScope` 는 **자동실행 범위**이지 "켤 것인가"가 아니다 — 그 질문은 등재된 적이 없다 |
| 기록 문서 전자결재 4 | `approval.clinicalNote/clinicalCertificate/consent/recordCopy.enabled`(전부 OFF) | 위원회(MRC) | 의무기록 결재 절차를 켤 것인가 |
| 대외 전송 3 | `pacs.exportEnabled` · `erp.webhookEnabled` · `ess.payrollRelay.enabled` | 허가권자+위원회 | 대외 발신 3조건 축 |
| 외부 오더 수신 1 | `fhir.serviceRequestInbound.enabled` | 위원회 | 외부 기관 오더를 받을 것인가 |
| 청구 2 | `billing.copayCap.preCoverageEnabled` · `inpatient.stayBilling.enabled` | 위원회(원무) | 제도 적용·자동 청구 |
| 사업 1 | `blockchain.selfIssuanceEnabled` | 경영 | 검진권 자체 발행 |

🔴 **가장 무거운 발견** — `voiceEmr.ambient.enabled` 는 **진료 원음 수집**이다.
건별 환자 동의(`ConsentType.RECORDING`)는 검증하고 있으나(`ambient.service.ts:63`),
**기관 차원의 적법근거가 등록부에 없다**(음성·녹음으로 grep 0건).
`legal.patientPush.consentScope` 와 같은 층의 항목이 **빠져 있다.**

**② 결정 사안 아님 — 보안 요구사항 3건** (전부 현재 `true`)

`erp.targetAuthEnforce` · `lis.targetAuthEnforce` · `erp.financeWebhookEnforce`

🔴 이것은 **IDOR 차단**이다. "끌지 말지를 위원회가 정한다"는 것이 이상하다 —
**켜져 있는 것이 기본이고, 꺼지면 사고다.** 결정 대상이 아니라 **상시 ON 요구사항**으로 두고
`OFF` 로 내려가면 경보하는 것이 맞다. (거버넌스 대상으로 등재하면 "위원회가 끌 수도 있는 것"처럼
보이게 된다 — 그 자체가 위험한 표현이다.)

**③ 결정 사안 아님 — 운영 편의 3건**

`ess.approval.reminder.enabled`(결재 독촉 알림) · `governance.ai.enabled`(안건 AI 영향평가 —
행정 보조) · `quality.ai.enabled`(데이터 품질 AI · 현재 OFF).
임상·법적 영향이 없다. **결함 아닌 것을 결정 사안으로 만들면 진짜 결정이 묻힌다.**

---

### 1.2 🔴 위원회는 선택지를 고를 수 없다 — 자유서술뿐

`resolveAgenda()` 의 입력은 이것이 전부다:

```ts
{ resolution: string;               // 자유서술
  voteFor/Against/Abstain?: number;
  actions?: { kind, target, manualNote }[] }   // 🔴 사람이 손으로 타이핑
```

- `CommitteeAgenda` 에 **선택지 컬럼이 없다**. 안건은 `title` + `body`(자유서술)뿐이다.
- `CommitteeDecision` 에 **고른 선택 컬럼이 없다**. `resolution` 산문만 남는다.
- 결정 등록부에는 `options[{ value, label, effect, enact }]` 가 **있는데**, 안건으로 올라갈 때
  `sourceRefData` 로 `{ label, effect }` 만 인용되고 **`enact`(무엇을 바꾸는가)가 빠진다.**
  그나마 그 인용은 **AI 영향평가 프롬프트 안**이라 의결 화면의 선택 대상이 아니다.

그래서 욕창 같은 안건은 **"B안으로 의결"해도 어느 안을 골랐는지가 구조로 남지 않는다.**
집행하려면 위원이 `kind`/`target` 을 **다시 타이핑**해야 하고, 그 순간 정본이 둘이 된다.

### 1.3 등록부 35항목 중 32개가 집행 바인딩 없음

| 축 | 수 |
|---|---:|
| `DECISION_REGISTRY` 항목 | 35 |
| 층: 허가권자 / 위원회 / 직원 | 10 / 24 / 1 |
| 승인경로: 위원회 / 코드변경 / 권한자 / 건별 | 20 / 7 / 7 / 1 |
| **`enactKind` 보유(자동 반영 가능)** | **3** |
| 등록부 출처 집행 액션(운영 `decision_actions.registry_key`) | **0** |
| 위원회 출처 집행 액션 | 24 (전부 `ENACTED`) |

→ 선행 계획서가 통합한 원장은 살아 있으나(24건), **등록부 쪽 유입은 아직 0**이다.

🔴 **재검토에서 새로 나온 것** — 등록부를 실제로 import 해 세니 `legalReview` 가 **비어 있는 항목이
13/35(37%)** 다. §3.2 의 근거(basis)는 이 필드를 유입원으로 삼는데, **유입원 자체가 3분의 1 이상
비어 있다.** 그러므로 근거는 "채워질 것"으로 전제하지 말고 **비어 있음이 기본 상태**여야 한다.

### 1.4 🔴 욕창처럼 "조사되지 않은" 결정 지점

`욕창 재평가 저장 스키마` 는 화면이 **"저장할 정본 표가 아직 없습니다"** 라고 정직하게 말하고
있지만, **결정 등록부에는 없다**(2026-08-27 grep 0건). 즉:

- 화면은 안다 · 계획서도 안다 · **결정 체계는 모른다**
- 그래서 누구도 "이 결정이 언제까지 누구 손에 있는지" 를 볼 수 없다

같은 성격의 미등재 항목이 더 있다고 보아야 한다(§1.1 의 27개가 그 증거다).

### 1.5 🔴 발효 중인 표준 9건에 **의결 근거가 하나도 없다**

사람 지시(2026-08-27): *"실제 의료기관의 프로세스와 프로토콜, CP가 동작되기 위한 위원회의
의사결정과정을 정의하고 구성을 선택할 수 있는 관리기능이 효과적으로 구성되어야 함."*

→ 그래서 **지금 그 표준들이 어떻게 발효되고 있는지**를 쟀다.

| 표준 | 운영 발효 수 | 발효 경로 | 의결 근거 | 발행자 기록 |
|---|---:|---|---|---|
| 임상경로 `ClinicalPathway` | **5** (전건 ACTIVE) | `POST /:id/publish` · `@Roles(ADMIN)` | **없음** | 🔴 **컬럼 자체가 없다** |
| 프로토콜 템플릿 `ProtocolTemplate` | **4** (ER·IPD·OPD·SURGERY) | `publish()` → 이전 버전 RETIRED | **없음** | 🔴 4건 전부 **미기록** |

```
CP-AMI-001    급성심근경색 표준경로   순환기내과   ACTIVE
CP-CABG-001   관상동맥우회술 경로     흉부외과     ACTIVE
CP-PNEU-001   지역사회 폐렴 경로      호흡기내과   ACTIVE
CP-STROKE-001 급성 뇌경색 표준경로    신경외과     ACTIVE
CP-TKR-001    인공관절치환술 경로     정형외과     ACTIVE
```

🔴 **임상경로 발행 코드에는 승인이 없다** — 상태만 본다:

```ts
async publish(id) {
  if (pathway.status !== 'DRAFT') throw …;
  return prisma.clinicalPathway.update({ where:{id}, data:{ status:'ACTIVE' } });
}   // ← 관리자 한 명의 클릭으로 급성심근경색 표준경로가 전 병원에 발효된다
```

그리고 **거버넌스 등재 대상에 CP·프로토콜은 없다.** `committee_surface_maps` 40건의 구성:

| 접두사 | 수 | 예 |
|---|---:|---|
| `config:` | 35 | `config:dur.enforce` |
| `master:` | 4 | `master:isolation-protocol` → 감염관리위원회 |
| `template:` | 1 | `template:consent` → 의무기록위원회 |
| 🔴 `pathway:` / `protocol:` | **0** | — |

**정리** — 실제 의료기관에서 CP·프로토콜은 위원회가 **제정·개정·폐지를 의결**하고 그 의결번호로
발효된다. 이 시스템에서는 **관리자 클릭 하나**이고, 누가 눌렀는지도 남지 않는다.
§1.1(설정 27개)과 같은 병이지만 **이쪽이 더 무겁다 — 환자에게 직접 적용되는 진료 표준이다.**

---

## 2. 🔴 CP 엔진과의 대조 — 결정 축에 없는 것

임상에는 이미 범용 단계 엔진이 있다(`ProtocolTemplate` / `ProtocolStep` / `ProtocolInstance` /
`ProtocolStepState`). 결정 축과 1:1로 놓으면 무엇이 비어 있는지가 그대로 드러난다.

| CP 엔진이 가진 것 | 임상 축 | 결정 축 | 결과 |
|---|---|---|---|
| **템플릿 + 버전** (`code`,`version`,`status:DRAFT/ACTIVE/RETIRED`) | ✅ | ❌ | 결정 유형별 표준 경로가 없다 |
| **발행 이력** (`publishedAt`,`publishedBy`) | ✅ | ❌ | 경로를 누가 언제 확정했는지 없다 |
| **단계** (`key`,`title`,`sortOrder`,`phase`) | ✅ | ❌ | 상신·검토·심의·의결·집행·검증이 상태 문자열 하나로 뭉개짐 |
| **단계별 담당역할** (`ownerRoles[]`) | ✅ | ❌ | 지금 누구 손에 있는지 모른다 |
| **게이트 단계** (`gate`,`gateRule`) | ✅ | ❌ | "법적 검토 없이 의결" 을 막을 자리가 없다 |
| **SLA** (`slaMinutes`) | ✅ | ❌ | 지연을 셀 수 없다(`dueBy` 는 3값 상수뿐) |
| **전이 조건** (`transitions[{toKey,condition}]`) | ✅ | ❌ | 분기(반려·보류·재심의)가 구조로 없다 |
| **인스턴스 + 템플릿버전 스냅샷** (`templateVersion`) | ✅ | ❌ | 경로가 바뀌면 과거 안건이 소급 해석된다 |
| **현재 단계** (`currentStepKey`) | ✅ | ❌ | 안건 `status` 6값이 전부 |
| **단계 상태 + 막힘 사유** (`ProtocolStepState.blockedReason`) | ✅ | ❌ | **왜 멈춰 있는지가 어디에도 없다** |

🔴 **정리** — 결정은 "상태 문자열 + 자유서술" 이고, 임상은 "버전된 경로 + 단계 + 담당 + 게이트 +
막힘 사유" 다. 병원에서 **더 오래 멈춰 있는 쪽은 결정인데**, 계측이 없는 쪽도 결정이다.

---

## 3. 채택안

원칙은 선행 계획서와 같다 — 🔴 **엔진을 새로 만들지 않는다. 있는 것을 확장한다.**
CP 엔진(`protocol`)은 환자 인스턴스에 묶여 있어 그대로 재사용할 수 없다. **모양을 차용하되
결정 축의 표를 따로 둔다**(환자 축과 결정 축을 한 표에 섞으면 둘 다 오염된다).

### 3.1 안건 선택지 · 고른 선택 (P0 — 사람 지시의 직접 대상)

```prisma
model CommitteeAgenda {
  // …기존
  /// 선택지 — 등록부 `DecisionOption` 과 **같은 모양**. 어휘 정본은 shared 하나.
  /// [{ value, label, effect, enact }]  · enact:null = "아무것도 바꾸지 않는다"는 명시
  options   Json?  @map("options")
}

model CommitteeDecision {
  // …기존
  /// 🔴 어느 안을 골랐는가 — value 하나가 아니라 **그때의 선택지 전문을 스냅샷**으로 남긴다.
  ///    안건 선택지는 나중에 바뀔 수 있고, 그때 무엇을 보고 골랐는지가 근거다.
  chosenOption Json?  @map("chosen_option")
}
```

집행 연결:
- 고른 선택지의 `enact` 가 **그대로** `DecisionAction.target` 이 된다 — 사람이 다시 타이핑하지 않는다.
- 🔴 `enact === null` 이면 액션 0건이 **정상**이다(빠뜨림 `undefined` 와 구분 — 가드가 강제).
- 🔴 선택지가 있는 안건은 `chosenOption` 없이 의결할 수 없다(선택지를 두고 산문만 남기면
  §1.2 로 되돌아간다). 선택지가 없는 안건은 종전대로 자유서술 의결.
- 🔴 **"A안을 일부 수정하여 의결"** — 재검토에서 빠진 것을 찾았다. 실제 위원회에서 가장 흔한
  형태인데 초안은 정의하지 않았다. 선택지를 강제하면 위원은 **맞지 않는 안을 고르게 된다**
  (§4 "필수로 강제하면 거짓 데이터가 된다"). 그래서 세 번째 값을 둔다:

  | `chosenOption.value` | 뜻 | 집행 |
  |---|---|---|
  | 선택지의 `value` | 그 안 그대로 | `enact` 자동 |
  | `MODIFIED` | 그 안을 수정해 의결 | 🔴 **자동 집행하지 않는다** — 수정분을 사람이 적고, 그 사실을 화면이 표기 |
  | `NONE_OF_ABOVE` | 선택지 밖 의결 | 자동 집행 없음 · 사유 필수 |

  `MODIFIED`·`NONE_OF_ABOVE` 는 **원본 선택지도 함께 스냅샷**한다 — 무엇을 수정한 것인지가 근거다.

### 3.2 근거(basis) — "무슨 근거로 이렇게 동작하는가"

```prisma
model DecisionAction {
  // …기존
  /// 🔴 이 집행이 선 근거. **세 갈래를 섞지 않는다.**
  ///    { legal?: string[]     — 법령·고시 (예: "의료법 §22", "환자안전법 §17")
  ///      accreditation?: string[] — 인증 기준 (예: "인증 Ver.5.0 IPSG.3")
  ///      evidence?: string[]  — 원내 실측 근거 (예: "게이트 위반 30일 12건") }
  basis Json? @map("basis")
}
```

- 유입: 등록부 `legalReview[]` → `legal`, 안건 `sourceRef` 의 실측 → `evidence`.
- 🔴 **근거가 비어 있으면 비어 있다고 말한다.** "근거 없음"은 유효한 상태이며, `[]` 를
  "검토했고 해당 없음" 으로 읽히게 하지 않는다(`null`=미기재 ≠ `[]`=해당 없음).

### 3.3 표면 → 근거 역조회 — 🔴 **신설이 아니라 확장이다** (2026-08-27 재검토 정정)

초안은 `GET /governance/surface-basis` 를 **신설**하자고 썼다. 그건 틀렸다 —
**이미 둘 다 있다.** 옆에 약한 것을 하나 더 만들 뻔했다(이 저장소가 반복해 앓은 병).

| 이미 있는 것 | 무엇을 하나 | 소비처 |
|---|---|---|
| `GET /governance/provenance?surfaceKey=` | 그 표면을 건드린 **결정 체인** — 출처를 `COMMITTEE`/`REGISTRY` 로 구분까지 한다 | 🔴 **0** |
| `GET /governance/badges` | 표면별 최신 유효 결정 배지(일괄) | `/admin/safety-gates` ✅ |

**그래서 할 일은 셋뿐이다.**

1. `provenance` 응답에 **없는 것만** 더한다 — 현재값 · `chosenOption`(§3.1) · `basis`(§3.2) ·
   `ownerCommittee` 를 **id 가 아니라 코드·이름으로**(지금은 id 만 나와 화면이 다시 조회해야 한다).
2. 🔴 **3번째 상태를 명시한다.** 지금은 체인이 비면 `chain: []` 이고, "결정이 없다"와
   "이 표면은 결정 대상이 아니다"가 같은 모양이다. `basisState: DECIDED | NO_DECISION | NOT_GOVERNED`
   로 갈라 낸다.
3. **소비처를 넓힌다** — 배지가 붙는 곳이 지금 안전게이트 4건뿐이다(§1.1-b).
   기타 게이트와 `/admin/config` 에 같은 배지를 붙인다. **EP 는 이미 있으므로 화면 일이다.**

### 3.4 결정 경로 엔진 (P2 — CP 구성 차용)

```prisma
/// 결정 유형별 표준 경로 — CP `ProtocolTemplate` 의 결정 축 대응물
model DecisionPathway {
  id, code, name, version, status(DRAFT|ACTIVE|RETIRED),
  layer  DecisionLayer,       // 어느 층의 결정에 쓰는 경로인가
  publishedAt, publishedBy
  steps  DecisionPathwayStep[]
}
model DecisionPathwayStep {
  key, title, sortOrder,
  ownerRoles String[],        // 이 단계는 누구 손에 있는가
  gate Boolean, gateRule String?,   // 예: legal_review_recorded
  slaDays Int?,               // 🔴 분이 아니라 일 — 결정의 시간 단위는 다르다
  transitions Json?           // [{toKey, condition}] 반려·보류·재심의
}
/// 안건 하나 = 인스턴스. 🔴 templateVersion 스냅샷(경로가 바뀌어도 과거가 소급되지 않는다)
model DecisionPathwayInstance {
  agendaId? / registryKey?,   // 🔴 출처 배타 — DecisionAction 과 같은 불변식
  pathwayId, pathwayVersion, currentStepKey, status(ACTIVE|BLOCKED|DONE|CANCELLED)
  states DecisionPathwayStepState[]
}
model DecisionPathwayStepState {
  stepKey, status(PENDING|IN_PROGRESS|DONE|BLOCKED|SKIPPED),
  actorId?, actedAt?, blockedReason?   // 🔴 왜 멈춰 있는가 — 지금 어디에도 없는 값
}
```

기본 경로 3종(시드):
| code | 대상 | 단계 |
|---|---|---|
| `LICENSE` | 허가권자 결정 | 상신 → **법적검토(게이트)** → 허가권자 결재 → 기록 → 후속 |
| `COMMITTEE` | 위원회 의결 | 상신 → 사전검토 → 회의배정 → **정족수(게이트)** → 의결(선택) → 집행 → 검증 |
| `CODE_CHANGE` | 스키마·코드 변경 | 상신 → 설계 → 승인 → 개발 → 배포 → **운영검증(게이트)** |

🔴 **욕창은 `CODE_CHANGE` 경로의 첫 인스턴스가 된다** — 지금은 "화면만 아는" 상태다.

### 3.5 🔴 표준 발효 거버넌스 (P1-c) — **관리기능(정의 · 구성 선택)** ← 사람 지시의 직접 대상

> *"프로세스와 프로토콜, CP가 동작되기 위한 위원회의 의사결정과정을 **정의**하고
> **구성을 선택**할 수 있는 관리기능"*

**`/admin/governance/standards`** — 표준 한 줄마다 "무엇이 있어야 발효되는가"를 정의한다.

#### 3.5.1 정의 — 표준 유형별 발효 규칙

🔴 **재검토 정정 — 초안은 담당을 이 표에 또 넣어 정본을 둘로 만들 뻔했다.**
`committee_surface_maps` 가 이미 "이 표면은 어느 위원회 것인가"의 정본이다.
여기에 `committeeIds` 를 두면 **같은 질문에 답이 둘**이 된다.

→ **담당은 `committee_surface_maps` 하나로 둔다**(`pathway:CP-AMI-001` 같은 키를 추가).
합동 의결이 필요하면 그 표가 **여러 행**을 갖게 한다 —
지금 `surfaceKey` 는 `@unique` 이므로 **제약을 풀고 `@@unique([surfaceKey, committeeId])` 로 바꾼다.**
🔴 소비처는 `provenance()` 의 `findUnique` **한 곳**이라 `findMany` 로 바꾸면 된다
(nullable 로 바꾸기 전에 소비처를 먼저 찾는다 — 규약 §8).

```prisma
/// 표준이 발효되기 위한 **요건**만 갖는다. 담당(누구 것인가)은 여기 없다.
model StandardGovernanceRule {
  standardKind   String   // PATHWAY | PROTOCOL | PROCESS
  standardCode   String?  // null = 그 유형 전체의 기본 규칙 · 값 = 이 표준만의 예외
  /// 복수 담당일 때 전원 의결(AND)인가 한 곳이면 되는가(OR) — 담당 목록 자체는 surfaceMap 이 갖는다
  requireAll     Boolean  @default(true)
  /// 행위별 요건 — 제정은 위원회, 오타 수정까지 위원회는 과하다
  actions        Json     // { ENACT:…, AMEND:…, RETIRE:… }
  requireBasis   String[] // ['legal','accreditation','evidence'] 중 필수인 것
  reviewCycleM   Int?     // 재심의 주기(월). null = 주기 없음(주기를 지어내지 않는다)
  gateMode       String   // OFF | WARN | BLOCK  ← 🔴 아래 3.5.3
  @@unique([standardKind, standardCode])
}
```

🔴 **합동 의결에서 두 위원회가 다른 결론을 내면?** 초안은 이 경우를 정의하지 않았다.
→ **자동으로 병합하지 않는다.** 불일치는 `CONFLICT` 로 두고 발효를 보류하며,
어느 위원회가 무엇을 의결했는지를 **둘 다 그대로** 보여준다. 조정은 사람이 한다.
(하위가 상위를 대체하지 못하듯, **다수결로 위원회를 합치지 않는다.**)

#### 3.5.2 구성 선택 — 관리 화면이 고르게 하는 것

한 표준(예: `CP-AMI-001 급성심근경색 표준경로`)에 대해 **선택지로** 고른다.
🔴 자유 입력이 아니라 **선택지**여야 한다 — 어휘가 갈라지면 규칙이 규칙이 아니게 된다.

| 고를 것 | 선택지 | 기본 |
|---|---|---|
| 의결 주체 | 진료위원회 / QPS / 진료위+QPS 합동 | 유형 기본 규칙 |
| 제정(ENACT) | 위원회 의결 필수 | 위원회 |
| 개정(AMEND) | 위원회 의결 / **위원회가 위임한 경미개정** | 위원회 |
| 폐지(RETIRE) | 위원회 의결 필수 | 위원회 |
| 필요 근거 | 법령 · 인증기준 · 원내실측 (복수 선택) | 인증기준 |
| 재심의 주기 | 12·24·36개월 / 없음 | **없음**(주기를 지어내지 않는다) |
| 시행 강도 | OFF · WARN · BLOCK | **WARN** |

🔴 **재검토 정정 — 초안의 "부서장 전결"은 이 계획서가 선 원칙을 스스로 깼다.**
결정의 세 층(허가권자 / 원내 위원회 / 직원)은 고정이고 **하위가 상위를 대체하지 못한다.**
"부서장 전결"은 위원회 자리를 부서장이 대신하는 형태라 그 원칙을 정면으로 어긴다.

→ 남기되 **성격을 바꾼다**: `위원회가 위임한 경미개정`.
성립 조건은 **위임 근거 의결번호**다 — 위원회가 "경미개정은 소유부서가 한다"고 **의결한 적이
있어야** 이 선택지를 고를 수 있고, 없으면 화면이 그 선택지를 **비활성**으로 둔다.
그러면 층을 깨지 않는다(위원회가 여전히 위에 있고, 그 안에서 위임한 것이다).

🔴 **의결 주체 선택지에는 실체 있는 위원회만 올린다.** 운영 실측(2026-08-27): 위원회 16건 중
**코드 없는 6건은 안건 0·의결 0** 이고 이름이 기존 위원회와 **중복**된다(감염관리·약사·환자안전·
질향상·의료윤리·사망). 그대로 선택지에 올리면 **위원이 껍데기 위원회를 골라 의결한다.**
이 6건은 시드 잔재 여부를 먼저 가리고, 그 전까지 선택지에서 제외한다.

그리고 화면은 각 표준마다 **지금 상태를 3상으로** 말한다:

| 표시 | 뜻 |
|---|---|
| `의결 GOV-2026-012` | 이 의결로 발효됨 — 고른 선택지·근거를 함께 보여준다 |
| 🔴 `의결 근거 없음` | 발효돼 있으나 근거가 없다 — **지금 9건 전부가 여기** |
| `규칙 미설정` | 이 표준에 요건이 아직 정의되지 않았다(근거 없음과 **다른 사실**) |

#### 3.5.3 🔴 이미 발효된 9건을 어떻게 할 것인가 — 막지 않는다

가장 위험한 설계 실수는 규칙을 만들고 `BLOCK` 으로 켜는 것이다.
**지금 5개 임상경로가 환자에게 적용 중**이고, 근거가 없다는 이유로 즉시 중단시키면
그것은 안전측이 아니라 **진료 중단**이다.

- 기존 발효분은 **그대로 둔다.** 대신 `의결 근거 없음` 으로 **드러낸다.**
- 규칙은 **신규 발효·개정부터** 적용한다.
- 게이트 기본값은 **WARN** — 발효는 되지만 "근거 없이 발효했다"가 기록되고 목록에 남는다.
- `BLOCK` 승격은 **위원회가 정한다**(이 규칙 자체가 §3.1 의 선택지 결정 대상이다).
- 🔴 미결 9건은 빨간 경보가 아니라 **줄어드는 목록**으로 표현한다.

#### 3.5.4 함께 메울 두 구멍

- `ClinicalPathway` 에 **발행자·발행시각이 없다** → `publishedAt`·`publishedBy`·`governanceRef`
  (프로토콜은 앞 둘이 이미 있다 — 같은 모양으로 맞춘다. 여기서 다른 이름을 쓰면 갈라진다).
- `POST /clinical-pathway/:id/publish` 가 `@Roles(ADMIN)` 단독 → 규칙 평가를 거치게 한다.
  🔴 **권한을 좁히는 것이 아니라 근거를 요구하는 것이다** — ADMIN 은 그대로 누르되,
  근거 없이 눌렀다는 사실이 남는다.

### 3.6 이 계획서가 **하지 않을 것**

- ❌ **집행 엔진을 새로 만들지 않는다** — `governance-enactment.service.ts` 가 정본이고 살아 있다(24건).
- ❌ **CP 표(`protocol_*`)를 결정에 재사용하지 않는다** — 환자 인스턴스 축이라 섞으면 둘 다 오염된다.
- ❌ **자동 결정하지 않는다** — 엔진은 경로·상태·근거를 관리할 뿐, 무엇을 고를지는 사람이다.
- ❌ **미결을 빨간 경보로 만들지 않는다** — 27개 중 다수는 개시 전 정상 상태다.
  드러내되 **줄어드는 목록**으로 표현한다(사라지는 알림이 아니라).
- ❌ **`legalReview` 를 강제 입력으로 만들지 않는다** — 강제하면 거짓 데이터가 된다(규약 §4).

---

## 4. 단계

| 단계 | 내용 | 스키마 |
|---|---|---|
| **P0** | 안건 선택지 + 고른 선택 + 집행 자동 연결 · 욕창 안건을 첫 사례로 | `options`·`chosenOption` |
| **P0-b** | `basis` 3계층 + 등록부 `legalReview` 유입 | `basis` |
| **P1** | 표면→근거 역조회 EP + 게이트/설정 화면 3상태 표기 | 없음 |
| **P1-b** | §1.1 의 27개를 등록부·안건으로 유입(항목별) | 없음 |
| **P1-c** | 🔴 **표준 발효 거버넌스**(§3.5) — 규칙 정의·구성 선택 관리화면 · CP 발행자/의결번호 · WARN 기본 | 신규 1표 + CP 3컬럼 + `surfaceKey` 제약 변경 |
| **P2** | 결정 경로 엔진(템플릿·단계·인스턴스·막힘사유) + 기본 경로 3종 | 신규 4표 |
| **P3** | 지연 계측(SLA 초과)·경로별 진행률(층별 분리 — 합치지 않는다) | 없음 |

---

## 5. 가드 — 전부 **결함 재주입**으로 검증한다

| # | 가드 | 재주입하면 |
|---|---|---|
| G1 | 선택지 있는 안건은 `chosenOption` 없이 의결 불가 | 산문 의결이 통과하면 실패 |
| G2 | `chosenOption` 은 **스냅샷**이다(value 만 저장 금지) | 안건 선택지를 바꾸면 과거 의결이 달라지면 실패 |
| G3 | 고른 선택지의 `enact` 가 `DecisionAction.target` 과 **일치** | 사람이 다시 타이핑한 값이 들어가면 실패 |
| G4 | `enact:null` 은 액션 0건이 정상 · `undefined` 는 검증 오류 | 둘을 같게 다루면 실패 |
| G5 | 근거 `null`(미기재)과 `[]`(해당 없음)을 구분 | 뭉개면 실패 |
| G6 | 표면 역조회가 `DEFAULT` 를 `DECISION` 으로 말하지 않는다 | 기본값을 정책으로 그리면 실패 |
| G7 | 층 규칙 — 하위 층 경로가 상위 층 게이트를 건너뛰지 못한다 | 위원회 경로가 법적검토를 스킵하면 실패 |
| G8 | 인스턴스는 `pathwayVersion` 스냅샷을 갖는다 | 경로 개정이 과거에 소급되면 실패 |
| G9 | 대조군 — 정상 경로가 "막힘"으로 표시되지 않는다 | 전건 BLOCKED 로 만들면 실패 |
| G10 | 발효 규칙 기본이 **WARN** — 기존 9건을 중단시키지 않는다 | BLOCK 기본으로 바꾸면 실패(진료 중단 방지) |
| G11 | `의결 근거 없음`과 `규칙 미설정`을 구분한다 | 뭉개면 실패(다른 사실이다) |
| G12 | 임상경로 발행이 발행자를 남긴다 | 익명 발행이 통과하면 실패 |
| G13 | `MODIFIED`·`NONE_OF_ABOVE` 는 **자동 집행하지 않는다** | 수정 의결이 원안 `enact` 를 그대로 집행하면 실패 |
| G14 | 담당 정본은 `committee_surface_maps` **하나** | 규칙 표가 담당을 또 들면 실패 |
| G15 | 위임 근거 의결이 없으면 `경미개정 위임` 을 고를 수 없다 | 위임 없이 전결이 통과하면 실패 |
| G16 | 합동 의결 불일치는 `CONFLICT` — 자동 병합하지 않는다 | 다수결로 합치면 실패 |

---

## 6. 🔴 확인하지 못한 것 (착수 전 재실측 필요)

1. **§1.1 의 27개 중 몇 개가 실제로 "결정 사안"인가** — 분류는 키 이름 패턴(`enforce|gate|
   required|enabled`)으로 뽑은 **후보**다. 운영 파라미터가 섞여 있을 수 있다.
   🔴 **후보와 확정 결함을 구분해 말한다** — 항목별 성격 판정은 사람이 함께 봐야 한다.
2. ~~**위원회 16개 중 실제 활동 위원회 수**~~ → 🔴 **재검토에서 실측됐다**(확인 못한 것 아님):
   16건 중 **코드 없는 6건은 안건 0·의결 0**이고 이름이 기존 위원회와 **중복**된다
   (감염관리·약사·환자안전·질향상·의료윤리·사망). 시드 잔재로 보이나 **삭제 여부는 사람 판단**이다
   — 의결 주체 선택지에서는 그 전까지 제외한다(§3.5.2).
3. **`slaDays` 기준값** — 감으로 정하지 않는다. 기존 안건 21건의 상신→의결 실소요를
   먼저 재고, 표본이 부족하면 **기준을 넣지 않는다**(미설정임을 밝힌다).
4. **욕창 외에 등록부 미등재 결정 지점의 전체 규모** — §1.1 은 config 축만 본 것이고,
   스키마·코드 변경 대기 항목은 계획서·주석에 흩어져 있다.
5. 🔴 **발효 중인 CP 5건이 실제로 쓰이고 있는가** — `pathway_assignments` 실측 **0행**.
   "0행"은 ①안 쓰임 ②쓰기 막힘 중 무엇인지 **눌러서 갈라야** 한다.
   안 쓰이는 표준에 거버넌스를 먼저 씌우면 순서가 뒤바뀐다.
6. **의결 주체 선택지가 실제 원내 위원회 구성과 맞는가** — 위원회 16건 중 6건은 코드가 없다.

---

## 7. 🔴 재검토 기록 (2026-08-27 · 초안을 다시 잰 결과)

이 계획서는 초안 그대로 두지 않았다. **내가 쓴 것도 점검 대상**이라 사실·설계를 다시 쟀고
**10건을 고쳤다.** 무엇을 고쳤는지 남긴다 — 남기지 않으면 다음 사람이 초안을 실측으로 읽는다.

### 사실이 틀렸던 것 (3)

| # | 초안 | 재실측 |
|---|---|---|
| 1 | "화면은 기본값을 정책인 것처럼 보여준다" | **과장.** 27개 중 4개는 ⚖배지 자리가 있고 화면이 부재를 *신호로 설계*했다(주석까지). 나머지 23개만 자리조차 없다 (§1.1-b) |
| 2 | 표면→근거 역조회 EP **신설** | **이미 있다.** `provenance` + `badges`, `badges` 는 안전게이트 화면이 이미 쓴다. 신설이 아니라 **확장 + 소비처 확대** (§3.3) |
| 3 | §1.1 표를 27행으로 읽음 | **23행에 27키**를 묶은 것이다(`voiceEmr` 3·`approval` 4·`erp` 3) |

🔴 **①이 가장 위험했다** — 그대로 뒀으면 **이미 정직하게 설계된 화면을 결함으로 몰 뻔했다.**
(규약 §9 "오탐은 자진 철회한다")

### 내 설계가 원칙을 깬 것 (3)

| # | 무엇 | 왜 문제인가 | 어떻게 고쳤나 |
|---|---|---|---|
| 4 | 의결 주체 선택지에 **"부서장 전결"** | 결정 3층 고정 원칙을 정면으로 깬다 — 하위가 상위를 대체 | `위원회가 위임한 경미개정` + **위임 근거 의결번호 필수** |
| 5 | `StandardGovernanceRule.committeeIds` | 담당 정본이 `committee_surface_maps` 와 **둘**이 된다 | 담당은 surfaceMap 하나 · unique 를 복합키로 풀어 합동 표현 |
| 6 | 합동 의결 불일치 **미정의** | 두 위원회가 다른 결론이면 무슨 일이 일어나는지 없음 | `CONFLICT` 로 보류 · **자동 병합·다수결 금지** |

### 빠뜨린 경우 (2)

| # | 무엇 | 왜 중요한가 |
|---|---|---|
| 7 | **"A안을 일부 수정하여 의결"** | 실제 위원회에서 가장 흔한 형태인데 없었다. 선택지를 강제하면 위원이 **맞지 않는 안을 고른다**(§4 "필수로 강제하면 거짓 데이터가 된다") → `MODIFIED`/`NONE_OF_ABOVE` 신설, **자동 집행 금지** |
| 8 | 합동 의결 시 **담당 복수 표현 불가** | `surfaceKey @unique` 라 구조적으로 한 위원회뿐이었다 |

### 새로 실측된 것 (2)

| # | 실측 | 영향 |
|---|---|---|
| 9 | 등록부 `legalReview` 가 **13/35(37%) 비어 있다** | 근거(basis)의 유입원 자체가 비어 있다 → **비어 있음이 기본 상태**여야 한다 |
| 10 | 위원회 16 중 **코드 없는 6건은 안건 0·의결 0의 중복 껍데기** | 그대로 선택지에 올리면 **위원이 껍데기 위원회를 골라 의결한다** |

### 재검토가 확인한 것 (바꿀 필요 없던 것)

- 등록부 35항목·층 10/24/1·승인경로 7/7/20/1·`enactKind` 3 — **import 해서 다시 세도 동일**
- 등록부 선택지가 **AI 프롬프트에만** 닿는다는 §1.2 주장 — `buildAssessContext` 전용이 맞다
- 정책성 36 · 근거 없음 27 · 발효 표준 9건 무근거 — 전부 재현됨

---

## 8. 근거 (이 계획서가 선 자리)

- 사람 지시 3건(2026-08-27) — 위 머리말
- 운영 실측(2026-08-27) — `system_configs` 120 · 정책성 36 · 근거 없음 27 ·
  `committee_decisions` 20 · `decision_actions` 24(등록부 출처 0) · `DECISION_REGISTRY` 35(`enactKind` 3)
- 규약: CLAUDE.md §2(정본) · §4(게이트·강제) · §6(대외 발신·사람 결정) · §9(일하는 방식)
- 선행: `decision-console-and-enactment.plan.md` §2(엔진 계약) · §3(원장 일반화)
