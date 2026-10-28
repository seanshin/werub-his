/**
 * 지표가 표본 0 에서 `0` 으로 떨어지는 자리 — 파일별 **정확값** 동결(I4 2026-09-16).
 *
 * 🔴 **42 = 결함 42 가 아니다.** `0` 이 정답인 지표가 섞여 있다(관측했는데 진짜 0 · 개수성 지표 ·
 *    바로 다음 줄에서 `null` 로 다시 감싸는 자리 — qi `rate`→`rateOrNull` 이 그렇다).
 *    한 건씩 봐야 알고, 이 기준선이 지키는 것은 **조용히 늘지 않는다** 하나다.
 *    고치면 이 수를 줄이는 커밋을 강제한다(줄이는 방향은 언제나 허용).
 *
 * 🔴 (2026-09-16 J3) **37 → 57 로 늘었다 — 위반이 늘어난 것이 아니라 스캐너가 더 보게 된 것이다.**
 *    종전 정규식은 지표어가 뒤에 오는 이름(`avgScore`)만 봤고 `avgStay`·`avgLos`·`avgWait` 처럼
 *    **앞에 오는 이름**은 통째로 빠져 있었다 — QI 대시보드의 '평균 체류·평균 재원·평균 수술시간'이
 *    `: 0` 인 채 기준선 밖에 있었다(그 셋은 이번에 null 로 고쳤다).
 *
 * J3(2026-09-16) 가 뺀 자리: obgyn(제왕절개율) · nutrition(목표 열량 2000 지어냄→달성률) ·
 *   satisfaction(추이 평균) · schedule(노쇼율) · orchestrator(AI 도구 병상 가동률·가동률 정본의 세 번째 사본)
 *
 * J3 판정 — 남은 37 을 한 건씩 본 결과(정당으로 남긴 대표):
 *   · qi `rate`(389) — 바로 다음 줄에서 `rateOrNull` 로 다시 감싼다(스캐너가 중간 변수를 센다)
 *   · checkup `rate`(2019)·dialysis `ufRate`(48) — 가드 안이라 `: 0` 이 **도달 불가**한 분기
 *   · journey-analytics(25·202) — 화면이 `count===0` 이면 '—' 로 그린다(I4 확인)
 *   · patient 매칭 `score`(588·659·662) — 후보가 없으면 **진짜 0점**이다(표본 부재가 아니라 판정 결과)
 *   · lab `inProgress`·patient-auth `discountRate` — 카운터·가격 리터럴(이름만 지표계열)
 *   · dashboard(4)·crm(8)·inventory(2) 등 경영·운영 비율 — 분모를 응답에 함께 싣고 있어 위험순에서 뒤로 뒀다
 *
 * I4 가 이 목록에서 뺀 자리(표본 부재를 `null`+사유로 바꾼 것):
 *   emergency(평균 대기·평균 진료·퇴원율·입원율) · operational-stats(병동 퇴원율) ·
 *   concierge(만족도 평균) · radiation(분할조사 완료율) · education(EPA 달성률) ·
 *   dashboard(병상 가동률 추이 — executive 와 정본이 갈라져 있었다)
 *
 * 🔴 (2026-09-17 L4) **57 → 46.** 두 방향이 동시에 움직였다 — 섞어 읽지 말 것:
 *    ① 봉합 19자리(아래) ② 스캐너 사각 3종을 닫아 **새로 보이게 된 자리 8**(billing 2·partner-request 2·
 *    crm 1·triage 1·patient 1·cost-analysis 1 — 늘어난 것이 아니라 더 보게 된 것이다).
 *    닫은 사각: ⓐ 한 줄의 **첫 지표만** 보던 것(`{ avgLatencyMs: …, satisfactionRate: … : 0 }` 의 뒤엣것이
 *    통째로 안 보였다 — medical-ai:941 이 실제로 그랬다) ⓑ Prisma `_avg.x ?? 0`(집계는 표본 0 에서 **null** 을
 *    돌려준다 — 그 null 을 0 으로 번역하는 부류를 아예 못 봤다) ⓒ 앞 지표가 뒤 지표의 `: 0` 을 주워
 *    같은 자리를 두 번 세던 것(구간을 다음 지표 앞까지로 끊어 해소).
 *
 * L4 가 뺀 자리(표본 부재 → `null`):
 *   bed(평균 재원일수 — 같은 함수의 occupancyRate 는 이미 null 인데 이 줄만 0 이었다) ·
 *   checkup-station(평균 소요) · checkup-contract(진행률) · education(EPA 신뢰수준 — 척도 1~5 라 0 은
 *   어떤 실제 평가보다 낮다) · consult(종결률) · order-set(수정률) · operational-stats(평균 청구액) ·
 *   journey-console(하위호환 avgWaitMin·avgStayDays — 정본 avgWait/avgStay 는 이미 null 이라 **한 응답 안에서
 *   같은 사실을 둘로 말했다**) · journey-analytics(과별 평균 진료시간·평균 재원일수) ·
 *   workgroup 3(대기 평균 — 층 요약이 **표본 없는 구역의 0 분을 섞어 평균을 희석**하던 것도 함께 고쳤다) ·
 *   floor 2 · medical-ai(부정 피드백률·만족도·평균 지연)
 *
 * 🔴 (2026-09-21 H) **46 → 53.** L4 와 똑같이 두 방향이 동시에 움직였다 — 섞어 읽으면 "늘었다"로 오독한다:
 *    ① 스캐너 사각 2종을 닫아 **새로 보이게 된 자리 17** ② 그중·그 밖에서 **봉합 10자리**.
 *      46 + 17 − 10 = 53.
 *    🔴 (2026-09-23 T1 회수) 이 산식은 **main(`02080139f`) 위에서 다시 잰 값**이다 — 워크트리 수치를 베끼지 않았다:
 *      main 원본(봉합 전) + 새 스캐너 = **63** = 46 + 17(ⓓ 15 · ⓔ 2 — admission fallRiskScore·billing dailyRate·
 *      checkup-program discountRate·chemo doseReductionPct·consult avgRating·dashboard inProgress×3·data-quality
 *      score·executive lastWeekAvgRevenue·lab/qc zScore·nutrition percent·order-set score·questionnaire maxScore·
 *      simulator progress·voice-emr 는 종전 4 그대로) → 봉합 10 을 빼면 **53**. 스캐너·봉합·기준선 셋이 한 벌이다.
 *
 *    닫은 사각(기존 3종 ⓐⓑⓒ 에 이어):
 *    ⓓ **`?? 0` / `|| 0` 을 `_avg.` 에만 물었다.** L4 가 Prisma 집계만 닫은 탓에 평범한 nullish 폴백이
 *      통째로 밖에 있었다 — `fallRiskScore: na.fallRiskAssessment?.score ?? 0`(낙상위험 **미평가**를
 *      Morse **0점 = 최저위험**으로 말함)이 그 자리였다. 간호스테이션은 등급 쪽(`NONE`)을 이미
 *      "미평가·회색"으로 읽도록 2026-08-20 에 고쳐 뒀는데 **점수만 0 으로 남아** 한 응답이 같은 사실을
 *      둘로 말하고 있었다.
 *      🔴 경계만 쓰면(`0\b`) `?? 0.3`(기본 비율)의 `0` 이 걸려 오탐이 쏟아진다 — `0(?![.\d\w])` 로 못박았다.
 *    ⓔ **스캐너가 줄 단위라 여러 줄 삼항을 못 봤다.** prettier 가 접은 `조건\n ? …\n : 0` 이다 —
 *      lab QC 의 z-score(`targetSD !== 0 ? … : 0`)가 이 모양이라, **목표 SD 미설정 건에 z=0 이 찍혀
 *      Westgard 가 `PASS`·`isAccepted=true` 를 기록**하는데도 기준선 밖이었다(P17 — 안전 화면의 초록).
 *      같은 화면의 입력 미리보기는 이미 SD 0 에서 `null` 을 쓰고 있었으니 **서버만 값을 지어냈다**(P12).
 *
 *    H 가 뺀 자리(표본 부재/미측정 → `null` + 사유):
 *      lab/qc(z-score·Westgard — `NOT_EVALUABLE` 4번째 상태 신설 · 대시보드가 `passed` 도 `failed` 도
 *        아닌 **별도 칸**으로 센다: 거짓 안심도 거짓 경보도 만들지 않는다 · FE L-J 점·배지·요약 동반) ·
 *      admission(fallRiskScore) · nutrition(끼니 섭취율 — 미기록을 "0% 섭취"로 말하고 그 0 을 총 섭취
 *        열량에 더했다. J3 가 **같은 함수의 목표 열량**은 고쳤는데 이 줄만 남아 있었다 · 분모
 *        `intakeRecordedMeals/totalMeals` 병기) · questionnaire(설문 만점 미정의 → `7/0` 이 진료기록
 *        subjective 에 박혔다) · billing(비급여 보고서 평균단가 ×2 — 0원은 미기록이 아니라 **무료**로 읽힌다 ·
 *        nonCoveredRatio — 분모 0 에 0% + **분모 미동봉**. 화면 `/claims/stats` 가 그 두 이유로 이 값을
 *        **그리기를 거부하고 있었다**) · crm(RFM 세그먼트 평균 점수 — 0점은 최하 등급) ·
 *      partner-request(평균 응답시간 ×2 — 0ms 는 가능한 값이 아니라 **가장 빠른 값**이다)
 *
 *    🔴 H 가 스스로 적발한 것: nonCoveredRatio 첫 봉합이 가드에 `Number(x ?? 0) > 0` 을 써서
 *       **내 새 패스가 내 봉합을 위반으로 셌다.** 가드를 좁히는 대신(그러면 `(spo2 ?? 100) < 95`
 *       부류를 놓친다) 코드에서 `?? 0` 을 없앴다 — 내가 만든 가드도 점검 대상이다.
 *
 * H 판정 — 남은 53 중 정당으로 남긴 대표(이름만 적지 않는다):
 *   · infection-control `standardDurationDays`(16·21) — **스캐너 오탐**이다. `Ratio` 정규식이
 *     `du`**`Ratio`**`n` 에 걸렸다(지표가 아니라 '기간'). STANDARD/PROTECTIVE 는 표준 기간이 없어 0 이다.
 *   · consult `avgRating`(710) — `rated = sessions.filter(s => s.rating != null)` 안의 `?? 0` 이라
 *     **도달 불가**(TS 내로잉 때문에 남은 것)
 *   · billing `dailyRate`(738) — 바로 다음 줄 `if (!(dailyRate > 0))` 가 config 폴백 체인으로 넘긴다
 *   · executive `lastWeekAvgRevenue`(158) — `lastWeekN > 0` 가드 안의 중간 변수(바깥은 이미 `null`)
 *   · dashboard `inProgress`(43·68·93)·lab `inProgress`·order-set `useCount`·triage 누산기 초기값 ·
 *     duty-schedule `generated: 0` — **개수**다(0 이 정답)
 *   · checkup-program `discountRate`·chemo `doseReductionPct` — **DTO 기본값**(할인 없음·감량 없음)
 *   · voice-emr stt-chunk(4) — 주석에 적힌 **의도된 fail-open**(성문은 인증이 아니고, 반환값은
 *     항상 안전측 `isEnrolled:false` 와 동반한다 · 확인 게이트는 통과 여부와 무관하게 유지)
 *   · data-quality(287·289) — 판정 실패를 0(=동일인 아님, **병합하지 않음**)으로 접는 안전측이고
 *     289 는 `reason: 'AI 판별 실패 — 수동 확인'` 을 동반한다
 *   · simulator(154·477) — 시뮬레이터 내부 지표(임상·경영 사실이 아니다)
 *   · dashboard `completionRate` ×3·`claimApprovalRate` · crm 발송 비율 6 · inventory · cost-analysis ·
 *     journey-analytics · qi · checkup · dialysis · code-master · schedule ·
 *     patient 매칭 `score`(후보가 없으면 **진짜 0점** — 표본 부재가 아니라 판정 결과) —
 *     **분모를 응답에 함께 싣고 있어** 위험순에서 뒤로 뒀다(다음 갈래 몫)
 *   · patient-auth `discountRate`(515) — 가격 리터럴(이름만 지표 계열) · 병행 갈래 소관이라 손대지 않았다
 */
// 53→54 2026-10-02 command-center-space `inProgress: 0` — 검진 스테이션 '검사 중' **인원 계수의 초기값**(지표 아님 · 이름이 Progress 패턴에 걸린 오탐 · 이름을 바꿔 피하지 않는다)
// 54→55 2026-10-14 billing.service 원무 납입확인서(P4-5) 월별 납입액 합 — 낸 돈이 없는 달은 진짜 0원이다(표본 부재가 아니라 '안 냈다' · 입원 일수처럼 모르는 것은 null)
export const METRIC_ZERO_TOTAL_BASELINE = 54; // 55→54 2026-10-22 billing.service 입원료 단가 사슬 일원화

export const METRIC_ZERO_BASELINE: Record<string, number> = {
  'billing/billing.service.ts': 1, // 2→1 2026-10-22 입원료 단가 사슬을 stayPricing 하나로(퇴원 청구·중간정산 공용)
  'burn-assessment/burn-assessment.service.ts': 1,
  'checkup/checkup-program.service.ts': 1,
  'checkup/checkup.service.ts': 1,
  'chemo/chemo.service.ts': 1,
  'code-master/auto-mapper.service.ts': 1,
  'command-center/command-center-space.service.ts': 1, // 계수 초기값 오탐(위 주석)
  'code-master/drg-reference.service.ts': 1,
  'consult/consult.service.ts': 1,
  'cost-analysis/cost-analysis.service.ts': 2,
  'crm/crm-ai.service.ts': 2,
  'crm/crm.service.ts': 6,
  'dashboard/dashboard.service.ts': 7,
  'data-quality/data-quality.service.ts': 2,
  'dialysis/dialysis.service.ts': 1,
  'duty-schedule/duty-schedule.service.ts': 1,
  'executive/executive.service.ts': 2,
  'infection-control/isolation-protocol.defaults.ts': 2,
  'inventory/inventory.service.ts': 2,
  'journey-console/journey-analytics.service.ts': 3,
  'lab/diagnostics-board.service.ts': 1,
  'order-set/order-set.service.ts': 1,
  'partner-request/partner-request.service.ts': 1,
  'patient-auth/patient-auth.service.ts': 1,
  'patient/patient.service.ts': 2,
  'qi/qi.service.ts': 1,
  'schedule/schedule.service.ts': 1,
  'simulator/simulator.service.ts': 2,
  'triage/triage.service.ts': 1,
  'voice-emr/stt-chunk.client.ts': 4,
};
