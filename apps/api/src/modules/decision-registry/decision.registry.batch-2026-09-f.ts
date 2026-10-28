/**
 * 결정 등록부 배치 F (2026-09-23) — **운영 모드·시드 축**에서 코드로 닫을 수 없던 3건.
 *
 * 출처: 형제 프로젝트가 기준 커밋 `e9d303984f80` 을 격리 네트워크에 세워 실제로 불러 보고 보내온
 *      인바운드 문서(§3 ESS · §7 H1/H3 · §8 R10 · §14 R53). 같은 문서의 나머지는 코드로 닫았다
 *      (시드가 설정을 덮어쓰던 자리 · 인바운드 수용을 시드가 켜던 자리 · ESS 쓰기 모드 게이트 · 수납 라인 코드 등).
 *
 * 🔴 등재 ≠ 결정. 선택지와 결과만 적고 권고·기본 선택은 하지 않는다(판정 규칙 6장).
 *    어느 항목도 `enactKind` 를 갖지 않고 모든 선택지의 `enact` 는 `null` 이다 — 기록이 시스템을 자동으로 바꾸지 않는다.
 * 🔴 법령 조문·수수료·기한은 적지 않는다(검토 항목 이름만).
 * 🔴 `statusQuo` 는 등재 시점(2026-09-23 · main `c9cf1c485`)에 코드를 다시 읽고 적었다 — 초안(09-21)이 적은
 *    "ESS `erpGet` 은 실패 구분이 없다" · "`/admin/erp` 가 보류 사유를 말하도록 고쳤다" 는 등재 시점에 **사실이 아니어서** 옮기지 않았다.
 */
import type { DecisionDef } from './decision.registry';

export const DECISION_BATCH_2026_09_F: DecisionDef[] = [
  {
    key: 'seed.rehearsalFeatureDefaults',
    track: 'PLATFORM',
    title: '개발·리허설 설치본은 어떤 기능을 켠 채 시작할 것인가 (시드가 정하고 있다)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '기본 시드가 환자 포털·알림 기능 여섯 개를 **켠 상태로** 만든다. 여섯 키 모두 코드 기본값은 OFF 이고 설명에 "기본 OFF·opt-in" 이라 적혀 있다 — ' +
      '즉 시드가 코드가 정한 기본값을 덮어쓰고 있고, 그중 `portal.aiDrugExplain` 은 **환자에게 보이는 AI 설명**을 켠다. ' +
      '🔴 판매 설치본(REAL)은 이 행들을 받지 않는다 — 시드가 REAL 모드에서 실행을 거부하기 때문이다(`seed-mode-guard`). ' +
      '영향 범위는 개발·리허설 설치본이고, 형제 프로젝트가 리허설 설치본에서 이 상태를 실제로 보고 물어 왔다. ' +
      '리허설은 "실제처럼" 돌려 보는 자리라 무엇을 켜고 시작할지는 운영 정책이지 시드 작성자가 고를 일이 아니다.',
    legalReview: [
      '환자 대상 AI 설명 표시 의무(생성물 표기)와 리허설 환경에서의 적용 범위',
      '환자 알림(복약·치료일정) 발송 동의 — 리허설 데이터 대상 발송의 취급',
    ],
    approvalPath: 'CODE_CHANGE',
    authority: '의료정보위원회 · 환자경험(포털) 담당 · 약제부(복약 설명)',
    options: [
      {
        value: 'ALL_ON',
        label: '현행 유지 — 여섯 기능을 켠 채 시작',
        effect: '새 개발·리허설 설치본은 포털 셀프예약·AI 복약설명·복약 리마인더·실손 서류번들·치료일정 리마인더가 켜진 상태로 시작한다. 기관이 끄면 그 값은 유지된다(시드가 더는 덮어쓰지 않는다).',
        enact: null,
      },
      {
        value: 'SAFETY_ONLY',
        label: '안전 게이트만 켜고 나머지는 코드 기본값(OFF)으로',
        effect: '조제 DUR 차단만 켠 채 시작하고 포털·알림 다섯 기능은 꺼진 상태로 시작한다. 리허설에서 그 기능을 보려면 관리 화면에서 켠다(개발 필요 — 시드 목록 축소).',
        enact: null,
      },
      {
        value: 'NONE_ON',
        label: '시드는 아무 기능도 켜지 않는다',
        effect: '모든 기능이 코드 기본값(대부분 OFF)으로 시작한다. 리허설 준비가 한 단계 늘고, 대신 "켜져 있는 것은 누군가 켠 것"이 된다(개발 필요).',
        enact: null,
      },
    ],
    statusQuo:
      '2026-09-23 코드 확인 — `apps/api/prisma/seed.ts` 말미 "R1 활성화" 블록이 `portal.selfBooking`·`portal.aiDrugExplain`·`portal.medicationReminder`·' +
      '`portal.insuranceDocBundle`·`treatmentSchedule.reminder`·`pharmacy.durGate.enforce` 여섯 행을 **없을 때만**(`upsert` 의 `update: {}`) 만든다. ' +
      '코드 기본값은 `config-runtime.service.ts` 에서 앞 다섯이 `false`, DUR 게이트가 `OFF` 다. ' +
      '2026-09-21 에 고친 것: ① 시드 시스템 설정 루프가 `update: { value }` 로 **기존 값을 덮어쓰던 것**을 create 전용으로 바꿨다(관리자가 끈 AI 가 재시드로 다시 켜지던 자리). ' +
      '② DUR 게이트에 들어가던 구 boolean `true` 를 정본 어휘 `BLOCK` 으로 맞췄다(동작 동일 · 어휘 드리프트만 해소). ' +
      '③ `ai.server.url`·`ai.server.enabled` 등 **코드 기본값을 글자 그대로 복제하던 행**을 시드에서 뺐다(기본값이 "사람이 설정함"으로 보이던 자리 · 지금 seed.ts 에는 주석으로만 남아 있다).',
    verifyHow: [
      '`grep -n "R1 활성화" -A30 apps/api/prisma/seed.ts`',
      '`grep -nE "\'(portal\\.(selfBooking|aiDrugExplain|medicationReminder|insuranceDocBundle)|treatmentSchedule\\.reminder|pharmacy\\.durGate\\.enforce)\':" apps/api/src/modules/config/config-runtime.service.ts`',
      '`npx vitest run test/architecture/seed-system-config-no-overwrite.spec.ts`(시드가 설정을 덮어쓰지 않는지)',
    ],
    afterDecision: '현행 유지가 아니면 시드 목록 축소 개발이 남는다. 🔴 이미 켜진 설치본의 값은 소급하지 않는다 — 시드는 없을 때만 만들므로 기존 DB 는 그대로다.',
    owner: '전산실 · 환자경험(포털) 담당 · 약제부',
    dueBy: 'NONE',
    // 개시 뒤로 둘 수 있는 근거: REAL 설치본은 이 시드를 받지 않는다(seed-mode-guard) — 개발·리허설에 한정된다.
    goLive: 'CAN_FOLLOW',
    // 🔴 `/admin/config` 는 출처 배지와 함께 **보기만** 하는 화면이다(settings-screen-canon 가드) — 고치러 가는 길은 편집 화면이다.
    drillDown: '/admin/ai-settings',
  },
  {
    key: 'mode.essErpPull',
    track: 'PLATFORM',
    title: '리허설 모드에서 ERP 조회(pull)를 실제 ERP 로 보낼 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '운영 모드 게이트(`allowsOutboundSend`)는 **아웃박스·문자·메일·ESS 쓰기** 네 곳에 걸려 있다. 직원 셀프서비스(ESS)의 ERP 조회 9경로와 ' +
      '진료비 계산서·약품 매핑 반입 조회는 아웃박스를 거치지 않아 **리허설에서도 실제 ERP 로 나간다**. ' +
      '조회는 발송과 성격이 다르다 — 리허설에서 ERP 값을 못 읽으면 ESS 화면 전체를 시험할 수 없다(형제 프로젝트는 이 경로로 급여명세·연차 조회를 성공 검증했다). ' +
      '반면 리허설 모드 배너는 직원에게 "대외 발신은 나가지 않습니다"라고 말하고 있고, 조회 요청에도 사번과 서명된 대상 토큰이 실려 나간다. ' +
      '🔴 ESS 의 **쓰기**(계좌번호·주민등록번호를 ERP 로 릴레이)는 2026-09-21 에 모드 게이트를 걸었다 — 리허설의 시험 입력이 실 ERP 에 들어가면 되돌릴 수 없기 때문이다. ' +
      '남은 것은 **조회를 어떻게 할 것인가**이고, 그것은 기술 판단이 아니라 "리허설이 무엇을 리허설하는가"의 문제다.',
    legalReview: [
      '개인정보 처리 위탁·제공 범위 — 리허설 환경에서 실 인사·급여 시스템 조회의 취급',
      '직원 급여·인사 정보 조회 기록의 보존 주체(HIS ↔ ERP)',
    ],
    approvalPath: 'CODE_CHANGE',
    authority: '의료정보위원회 · 인사(급여) · 개인정보보호책임자',
    options: [
      {
        value: 'ALLOW_AS_IS',
        label: '현행 유지 — 리허설에서도 실제 ERP 를 조회한다',
        effect: 'ESS 화면이 리허설에서 실제 값으로 동작한다. 리허설 배너의 "대외 발신은 나가지 않습니다" 는 발송에 한정된 말이 된다(문구 보완 필요).',
        enact: null,
      },
      {
        value: 'ALLOW_AND_DISCLOSE',
        label: '허용하되 화면이 밝힌다 — "이 값은 실제 ERP 에서 조회했습니다"',
        effect: '동작은 같고, ESS 화면과 모드 배너가 조회는 나간다는 사실을 말한다. 조회 시도를 원장에 남길지는 별도 판단(현재 ESS 조회는 실패만 로그에 남고 DB·화면에는 시도 흔적이 없다) — 개발 필요.',
        enact: null,
      },
      {
        value: 'BLOCK_IN_REHEARSAL',
        label: '리얼이 아니면 조회도 막는다',
        effect: '리허설 ESS 는 급여명세·연차 등을 "ERP 미연결" 로 표시한다(값을 지어내지 않는다). 리허설에서 ESS 연동을 시험할 수 없게 된다 — 개발 필요.',
        enact: null,
      },
    ],
    statusQuo:
      '2026-09-23 코드 확인 — `modules/ess/ess.service.ts` `erpGetDetailed()` 가 `erp.webhookUrl` 를 기준 주소로 `X-Integration-Key` + 60초 대상 토큰을 붙여 ERP 를 부른다' +
      '(호출부 9곳 · 증명서 PDF `getErpCertificatePdf` 1경로는 별도 fetch). **모드 검사는 없다.** ' +
      '같은 모양(기준 주소 + 키 · 모드 검사 없음)이 `billing.service.ts getErpInvoice()`·`pullConfirmedDrugCodes()`·`portal.service.ts getInpatientInterimBill()` 에도 있다. ' +
      '실패 사유는 구분된다 — 2026-09-22~23 에 종전 `erpGet`(사유를 버리고 `data|null` 만 주던 래퍼)을 지우고 `erpGetDetailed` 로 수렴했다: ' +
      '어휘는 shared `ERP_READ_FAILURES` 5종(NOT_CONFIGURED·UNAUTHORIZED·UPSTREAM_ERROR·UNREACHABLE·BAD_RESPONSE) 하나이고 화면(`ErpFailureNote`)이 같은 어휘로 분기한다. ' +
      '모드 게이트(`allowsOutboundSend`)가 걸린 곳은 `integration-outbox.service.ts`·`crm-channel.service.ts`·`voucher-email.service.ts` 와 ESS 의 **쓰기** `erpPost()`(`/hr/payroll-identity`, 계좌·주민등록번호 — 2026-09-21) 네 곳이다. ' +
      '쓰기는 리얼이 아니면 보내지 않고, "실패"가 아니라 "보내지 않았다"(`heldByMode`)로 말하며 전송 시각도 남기지 않는다. ' +
      '🔴 읽기 경로에는 그 게이트가 없다 — 이 항목이 묻는 것이 바로 그것이다.',
    verifyHow: [
      '`grep -n "erpGetDetailed\\|erpPost\\|allowsOutboundSend" apps/api/src/modules/ess/ess.service.ts`',
      '`grep -rln "allowsOutboundSend" apps/api/src`(게이트가 걸린 파일 전수)',
      '`grep -n "ERP_READ_FAILURES" packages/shared/src/erp-read-failure.ts`(실패 어휘 정본)',
      '`npx vitest run test/ess/ess-erp-write-mode-gate.spec.ts`',
    ],
    afterDecision: '현행 유지가 아니면 조회 게이트·화면 문구·조회 기록(원장) 개발이 남는다. 이미 조회된 값은 소급하지 않는다.',
    owner: '전산실 · 인사(급여)팀 · 개인정보보호 담당',
    dueBy: 'BEFORE_GO_LIVE',
    // 🔴 개시 전 필요한 근거: 리얼 전환 시점에 "무엇이 나가고 있었는가"를 기관이 알고 있어야 한다.
    goLive: 'REQUIRED_BEFORE',
    drillDown: '/admin/outbound-channels',
  },
  {
    key: 'ops.rehearsalOutboxAtCutover',
    track: 'NOTIFY',
    title: '리허설 동안 쌓인 대외 발신 대기 건을 리얼 전환 때 보낼 것인가, 버릴 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '리허설 모드에서 아웃박스 디스패처는 행을 **건드리지 않고 보류**한다 — 보내지 않았으므로 `SENT` 로 적지 않는 것이 옳다. ' +
      '그런데 그래서 리얼로 전환하는 순간 디스패처가 그 행들을 **그대로 발송한다.** 리허설 중 시험 삼아 누른 이벤트(가상 환자 청구·직원 변동 등)가 실제 기관으로 나갈 수 있다. ' +
      '🔴 지금은 버리는 경로가 **없다** — 취소·폐기 EP 도, 화면 버튼도 없고 원시 SQL 뿐이다. ' +
      '🔴 그리고 버리는 방향은 자동으로 정할 수 없다: 리허설 중에 만들어진 것이 전부 가짜라는 보장이 없고(전환 직전 실제 업무가 섞일 수 있다), ' +
      '반대로 전부 보내면 외부 기관이 가상 데이터를 받는다. 끊는 방향은 사람 판단이다.',
    legalReview: [
      '외부 기관(ERP·교육·연동 채널)에 시험 데이터가 전달됐을 때의 통지·정정 의무',
      '전송 기록의 보존 — 폐기한 대기 건의 흔적을 어떻게 남길 것인가',
    ],
    approvalPath: 'CODE_CHANGE',
    authority: '의료정보위원회 · 연동 상대 기관 담당 · 개인정보보호책임자',
    options: [
      {
        value: 'SEND_ALL',
        label: '현행 유지 — 전환 시점에 대기 건을 그대로 보낸다',
        effect: '전환 직후 리허설 중 쌓인 이벤트가 실제 상대 기관으로 나간다. 전환 전에 `/admin/erp` 에서 건수를 확인하는 것이 유일한 방어다.',
        enact: null,
      },
      {
        value: 'DISCARD_WITH_RECORD',
        label: '전환 전에 대기 건을 폐기한다 — 무엇을 버렸는지 기록으로 남기고',
        effect: '폐기 경로(화면·EP)와 폐기 원장이 필요하다. 보낸 적 없는 건을 "보냈다"로 적지 않고 "폐기됨"으로 남긴다(개발 필요).',
        enact: null,
      },
      {
        value: 'REVIEW_THEN_DECIDE',
        label: '건별로 보고 고른다 — 목록을 띄우고 사람이 보낼 것/버릴 것을 지정',
        effect: '대기 목록 화면과 건별 폐기가 필요하다. 건수가 많으면 시간이 걸린다(개발 필요).',
        enact: null,
      },
    ],
    statusQuo:
      '2026-09-23 코드 확인 — `integration-outbox.service.ts dispatch()` 는 리얼이 아니면 `return` 만 하고 행을 `PENDING` 그대로 둔다(2026-08-26 부터 · 주석: "모드가 REAL 이 되면 그대로 나간다"). ' +
      '`adminStats()` 는 `mode`·`outboundHeldByMode` 를 함께 돌려주는데 **`/admin/erp` 화면 타입이 두 필드를 빠뜨려 한 번도 그려지지 않았다**(형제 프로젝트 R53) — ' +
      '2026-09-23 이 등재와 같은 커밋에서 화면이 두 필드를 읽어 보류 사유(모드)와 PENDING 건수를 말하도록 고쳤다(서버는 손대지 않았다). ' +
      '아웃박스 변경 EP 는 `retry`(FAILED → PENDING) 하나뿐이고, 삭제·취소는 API·화면 어디에도 없다(`integrationOutbox.delete`/`deleteMany` 호출 0). ' +
      '전환 문서(`real-mode-cutover.md`)에는 같은 커밋에서 "전환 전 PENDING 건수 확인" 항목을 넣었다 — 다만 확인이 곧 처리 수단은 아니다.',
    verifyHow: [
      '`grep -n "allowsOutboundSend" -A12 apps/api/src/modules/integration/integration-outbox.service.ts`',
      '`grep -rn "integrationOutbox.delete" apps/api/src`(0건이어야 한다 — 버리는 경로가 없다는 근거)',
      '`grep -n "outboundHeldByMode" "apps/web/src/app/(main)/admin/erp/page.tsx"`(화면이 서버의 보류 사실을 읽는지)',
      '`/admin/erp` 「연동 모니터(outbox)」 — 보류 배너와 PENDING 건수',
    ],
    afterDecision: '현행 유지가 아니면 폐기 경로·폐기 원장 개발이 남는다. 🔴 이미 나간 발신은 소급하지 않는다.',
    owner: '전산실 · 연동 담당',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
    drillDown: '/admin/erp',
  },
];
