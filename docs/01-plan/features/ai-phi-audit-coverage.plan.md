# AI 전송 감사 커버리지 — 환자 지목 AI 조회가 원장에 남지 않는다

> **상태(2026-09-14 코드 대조)**: 구현됨 — apps/api/src/modules/ai-oversight/ai-oversight.controller.ts:16 · apps/api/src/modules/imaging/imaging.controller.ts:165 · 잔여: 없음

> 작성 2026-08-20 · 상태 **배포 완료 · 운영 실증**(`95c54bd2` · 스모크 29 PASS) · 발견 경로: LoopSpec L0 파일럿의 부수 발견을 코디네이터가 재검증

## 🔴 전제 — AI 서버는 **원내**다 (2026-08-20 사람 결정)

이 문서의 초판은 이 갭을 "PHI 가 **외부**로 나간다"고 적었다. **그 표현은 철회한다.**
운영 전제는 **원내 AI 서버(WeRU.B)** 이며, 제3자 LLM 사업자에게 넘기는 위탁·제공이 아니다.

그래서 이 갭의 성격은 **국외이전·제3자 제공이 아니라 접근기록(열람 감사)**이다.
그것만으로 충분히 문제다 — 의료법·개인정보보호법이 요구하는 것은 "누가 언제 어떤 환자의
기록을 열었는가"이고, 이 EP 들은 **환자 기록을 읽어 프롬프트에 담는 열람 행위**인데
원장에 한 줄도 남지 않는다.

관측 사실 하나(전제를 뒤집지는 않는다): 현재 `ai.server.url` 인 `example.org` 은
**Cloudflare 를 경유**한다(`198.51.100.20`·`198.51.100.21`·`2606:4700::`). 모델 호스트가
원내라도 **전송 경로는 현재 제3자 CDN 을 지난다.** 폐쇄망 요건을 따질 때 이 사실이 필요하다.

## 0. 이 문서의 위치

감사 축의 정본은 `apps/api/src/modules/audit/audit-routes.ts` 와
`docs/03-analysis/audit-coverage-audit-2026-07.md` 다. 이 문서는 **그 규약이 AI 계열 EP 에
적용되지 않고 있다**는 갭 하나만 다룬다. 규약을 다시 쓰지 않는다.

## 1. 실측 (2026-08-20 · 재현 방법 포함)

| 사실 | 값 | 어떻게 셌나 |
|---|---|---|
| 환자 식별자를 받는 AI GET EP | **27** | 컨트롤러 `@Controller`+`@Get` 결합 경로에서 세그먼트 `ai` 매칭 |
| 그중 환자 지목(PHI) 계열 | **21** | 비환자 식별자(`:code`·`:jobId`) 5건 제외 |
| 핸들러가 직접 감사하는 것 | **1** (`/api/v1/ai/patient-context/:patientId`) | 핸들러 본문에 `auditAiEgress`/`audit.log` 존재 여부 |
| 🔴 **감사 없음** | **20** | 위 21 − 1 |
| 🔴 그중 **AI 서버 호출이 확인**된 것 | **15** | 컨트롤러 → 서비스 메서드 추적 후 본문에서 `medicalAi`/`chatLlm`/`aiEgressFetch` 표식 |
| 판정 보류(원내 규칙일 수 있음) | 6 | 위 표식이 없음 — 간접 호출 여부 미확인 |

🔴 **운영 실측**: `audit_logs` 에서 AI 계열 열람 기록은 `AiPatientContext` **91행**과
`TERMINAL_DAILY_PIN` 3행뿐이다. 나머지 EP 는 **개통 이래 한 줄도 남기지 않았다.**

### 감사 없이 AI 서버를 호출하는 15 EP (환자 기록을 읽어 프롬프트에 담는다)

| 모듈 | 경로 | 서비스 메서드 |
|---|---|---|
| medical-ai | `GET /api/v1/ai/brief/:patientId` | `PatientBriefService.get` |
| lab | `orders/:orderId/ai-interpret` · `ai-followup` · `patients/:patientId/ai-trend` | `interpretResultAI` · `suggestFollowupTests` · `analyzeLabTrend` |
| pharmacy | `orders/:orderId/ai-review` · `ai-guidance` | `reviewPrescriptionAI` · `generateMedicationGuidance` |
| surgery | `:id/ai-risk` (· `:id/ai-opnote` 2026-10-05 제거 — 부르는 화면 0·수술명만으로 기록 생성) | `predictRiskAI` |
| telehealth | `sessions/:id/ai-classify` · `ai-reply` | `classifyPatientMessage` · `suggestReply` |
| checkup | `visits/:id/ai-interpret` · `ai-followup` | `interpretCheckupAI` · `suggestFollowupCheckup` |
| emergency | `visits/:visitId/ai-triage` | `aiTriageReassessment` |
| nursing | `:admissionId/ai-nanda` · `nursing/:admissionId/ai-handoff` | `suggestNandaDiagnosis` · `summarizeHandoff` |

판정 보류 6: imaging `ai-analyze`·`ai-structured-report`·`ai-compare` · consult `ai-draft` ·
nursing `ai-care-plan`·`ai-handoff-sbar`.

## 2. 왜 이렇게 됐나 — 정본이 한 모듈 안에만 있었다

`auditAiEgress` 는 **`medical-ai.controller.ts` 의 private 메서드**다(파일:93). 그 컨트롤러의
POST 계열은 전부 이것을 부른다. 그런데 **다른 9개 모듈은 그 함수의 존재를 알 수 없다.**
인터셉터도 이들을 잡지 못한다 — `PHI_READ_PATTERNS` 는 `/api/v1/lab/results/<uuid>` 는 있어도
`/api/v1/lab/orders/<uuid>/ai-interpret` 는 없고, 쿼리에 `patientId` 도 없어
`readPatientId` 도 null 이다(`audit.interceptor.ts:76-78`).

🔴 이 저장소가 반복해서 겪은 그것이다 — **정본을 만든 것과 모든 소비처가 그것을 쓰는 것은 다른 일이다.**

## 3. 설계 — 아직 결정하지 않은 것이 하나 있다

1. **정본을 모듈 밖으로 꺼낸다** — `auditAiEgress` 를 `modules/audit` 아래 주입 가능한
   서비스로 옮기고, `medical-ai.controller` 는 그것을 쓰도록 바꾼다(**두 벌이 되지 않게 원본은 제거**).
2. 🔴 **미결 — `resourceId` 를 무엇으로 할 것인가.**
   감사 규약은 열람 기록의 `resourceId` 를 **patientId** 로 못박고 있다(`audit-routes.ts`).
   그런데 `lab/orders/:orderId/ai-interpret` 같은 EP 는 **컨트롤러가 patientId 를 모른다.**
   - (가) 서비스 안에서 감사한다 — patientId 를 아는 자리라 정확하지만 20곳을 각각 고쳐야 한다
   - (나) 컨트롤러가 응답에서 patientId 를 꺼내 감사한다 — 얇지만 응답 모양에 의존한다
   - (다) 경로 식별자(orderId 등)를 그대로 넣는다 — 얇지만 **환자 지목 조회 규약을 깬다**
   → 셋 중 하나를 고르기 전에는 착수하지 않는다. 섞어 쓰면 원장이 갈라진다.
3. 판정 보류 6건은 **간접 호출까지 추적한 뒤** 목록을 확정한다(전송하지 않는 EP 를
   전송한다고 적지 않는다).

## 4. 검증 규칙

- 🔴 **가드는 결함을 재주입해 실패해야 한다** — EP 하나에서 감사 호출을 빼면 실패하는 구조 가드
  (환자 지목 AI GET 목록 ⊆ 감사되는 EP 집합). 목록을 손으로 적지 말고 **컨트롤러에서 기계 추출**한다.
- 수치는 전부 **재현 방법과 함께**. "27/21/20/15" 는 위 §1 표의 방법으로만 재현된다.
- 운영 확인은 `audit_logs` 에 새 `resource_type` 이 실제로 **쌓이는지**로 한다 —
  코드가 부르는 것만으로는 증거가 아니다(`.catch(() => {})` 로 삼키는 자리가 이미 있다).

## 4-a. 배포 후 실증 (2026-08-20 12:34)

코드가 감사를 부른다는 것과 원장에 행이 쌓인다는 것은 다른 사실이다. 배포 후 직접 확인했다:

```
GET /api/v1/ai/brief/d66da57d-… → 200
audit_logs: AiPatientBrief | d66da57d-… | patientBound=true;via=response;path=/api/v1/ai/brief/d66da57d-…
```

`resource_id` 가 **환자 UUID** 이므로 환자별 접근이력 조회에 그대로 잡힌다.

**남은 확인**: `patientBound=false` 로 떨어지는 EP 가 실제로 어느 것인지는 운영 트래픽이
쌓인 뒤 `SELECT resource_type, count(*) … WHERE changes->'egress'->>'new' LIKE '%patientBound=false%'`
로 센다. 🔴 그 목록이 나오면 **응답에 patientId 를 실어 보내도록 서비스를 고치는 것**이
정답이지, 경로 ID 를 patientId 자리에 넣는 것이 아니다.

## 5. 사람 게이트

없음(CLI). 다만 §3-2 의 `resourceId` 선택은 **감사 규약에 닿으므로** 기록으로 남기고 진행한다.

---

## 6. 🔴 2단계 — 감사는 남는데 **환자에 귀속되지 않던 것** (2026-08-27)

§4-a 가 "운영 트래픽이 쌓인 뒤 세라"고 남겨둔 것을 셌다. 결과는 남겨둔 것보다 컸다.

### 6.1 운영 실측 (`audit_logs`, 2026-08-27)

| resource_type | 행 | `patientBound=false` |
|---|--:|--:|
| AiLabTrend | 11 | 0 |
| AiPatientBrief | 5 | 0 |
| **AiSurgeryRisk** | 2 | **2** |
| **AiNursingCarePlan** | 1 | **1** |

3행 모두 `resource_id = 00000000-0000-0000-0000-000000000000` —
**감사행은 있는데 환자별 접근이력 조회에서는 영원히 빠진다.**

### 6.2 코드 전수 판정 — 2건이 아니라 21건이었다

인터셉터는 `응답.data.patientId → 응답.patientId → 라우트 → 쿼리` 순으로만 환자를 찾는다.
`@AuditAiRead` **23 EP 의 서비스 반환 shape 을 전수로 읽었다**:

| | EP | 근거 |
|---|--:|---|
| 귀속됨 | **2** | 라우트에 `:patientId`(`ai/brief/:patientId` · `lab/patients/:patientId/ai-trend`) |
| 🔴 귀속 안 됨 | **21** | 반환 키가 `visitId`·`orderId`·`surgeryId`·`admissionId`·`encounterId`·`sessionId`·`imagingResultId` 뿐 |

🔴 **정적 판정이 운영 실측과 4/4 일치했다**(예측 true 2 / false 2 = 실제). 세 번째 근거로 교차 확인.
운영에 3행만 보인 것은 나머지 19 EP 가 **아직 한 번도 불리지 않았기 때문**이지 정상이어서가 아니다.

### 6.3 조치 — 21 EP 의 응답에 `patientId` 를 실었다

§3-2 에서 (가)/(나)/(다) 중 **(나) 응답 경유**로 이미 결정돼 있었다(§4-a). 그대로 따랐다.

- `Order` 에는 `patientId` 컬럼이 없다 → **처방 → 진료 경유**로 찾는다(약제 2 EP·검사 2 EP).
  검사는 `interpretResultAI` 가 쓰던 식을 그대로 써서 정본이 둘이 되지 않게 했다.
- 간호 3 EP 는 `admission` 을 안 읽고 있었다 → `patientIdOfAdmission()` 헬퍼 추가.
  **못 찾으면 `null`** — 다른 ID 를 patientId 자리에 넣지 않는다.
- 🔴 **부수 발견**: `summarizeHandoff` 가 AI 서버에 `patientId: admissionId` 를 보내고 있었다
  (입원 ID 를 환자 ID 자리에). AI 서버의 환자 맥락이 잘못된 키로 쌓인다 — 같이 교정했다.
- 영상 3 EP 는 AI 를 호출하지 않지만(영상 참조 부재) **환자 영상 기록을 읽으므로** 감사 귀속 대상이다.

### 6.4 가드 (`test/audit/ai-read-audit.spec.ts`)

컨트롤러에서 EP 를 **기계 추출**하고, 각 서비스 메서드의 **최상위 반환 객체**에 `patientId` 가
있는지 본다(중첩 콜백의 반환은 메서드의 반환이 아니므로 제외 — `.map(d => ({...}))`).
라우트에 `:patientId` 가 있으면 면제. 추출 수 하한 23.

- **재주입 3/3 실패 확인** — surgery(단일행)·checkup(다중행)·consult(반환 1개짜리 얇은 메서드).
- **대조군** — 판정 함수가 `{orderId, review}` 를 결함으로, `{orderId, patientId, review}` 를
  정상으로, 중첩 콜백 반환을 오탐 아님으로 판정하는지 각각 단언(무조건 통과 방지).

### 6.5 ✅ 배포 후 실증 (2026-08-27 11:36 배포 · 직후 확인)

**코드가 patientId 를 싣는다는 것과 원장에 행이 쌓인다는 것은 다른 사실이다.** 23 EP 를 전부 눌렀다.

| 확인 | 결과 |
|---|---|
| 호출 | **23/23 EP HTTP 200**, 응답 `data.patientId` 가 전부 실제 환자 UUID |
| 원장(직후 30분) | AI 열람 **23행** · `patientBound=true` **23** · `false` **0** · `resource_id`=`00000000-…` **0건** · 환자 9명 |
| 배포 전 미귀속 3행 | **그대로 둔다** — 일어난 사실이고 소급하지 않는다 |

프로브 중 404 두 건이 났는데 **둘 다 내 프로브의 오류**였다(결함 아님):
`ai-nanda` 의 실제 경로는 `/api/v1/<admissionId>/ai-nanda`(그 핸들러만 `@Controller('api/v1')`
아래에 있다) · 약제 guidance 는 `medicationCode` 가 없는 오더를 골랐다.
🔴 **404 를 결함으로 적기 전에 내 호출이 맞는지 본다.**

### 6.6 아직 증거가 아닌 것

**코드가 patientId 를 싣는다는 것과 원장에 `patientBound=true` 가 쌓인다는 것은 다른 사실이다.**
배포 후 각 EP 를 실제로 눌러 확인해야 하고, 19 EP 는 **개통 이래 한 번도 불린 적이 없어**
그 확인이 유일한 증거다. 확인 쿼리:

```sql
SELECT resource_type, count(*) FILTER (WHERE changes::text LIKE '%patientBound=false%') AS unbound
FROM audit_logs WHERE resource_type LIKE 'Ai%' GROUP BY 1 ORDER BY 2 DESC;
```
