/**
 * 결정 등록부 배치 H (2026-09-28) — **재시도·멱등 축**에서 코드로 닫을 수 없는 2건.
 *
 * 출처: 2026-09-17 결함 발굴 캠페인의 미병합 작업(워크트리 a13360)을 main 위에서 재판정한 결과
 *      (`docs/04-report/worktree-rejudge-2026-09-28-a13360.md`). 그 작업은 이 두 건을 **테스트 파일 안 목록**
 *      (`IDEMPOTENCY_HUMAN_DECISIONS`)에 두었다 — 그 자리는 화면에 뜨지 않으므로 "문서에 있는 동안엔 아무도
 *      못 고른다"와 같다. 그래서 여기 키를 만들고 멱등 판정 등록부(`test/architecture/idempotency-judgment.ts`)가
 *      이 키를 가리키게 했다(기계 대조).
 *
 * 🔴 등재 ≠ 결정. 선택지와 결과만 적고 권고·기본 선택은 하지 않는다. 어느 항목도 `enactKind` 를 갖지 않고
 *    모든 선택지의 `enact` 는 `null` 이다 — 어느 쪽을 골라도 코드 변경이 남는다(CODE_CHANGE).
 * 🔴 `statusQuo` 는 2026-09-28 main(`c5866890a` 이후) + 이 갈래의 봉합을 **코드로 다시 읽고** 적었다.
 */
import type { DecisionDef } from './decision.registry';

export const DECISION_BATCH_2026_09_H: DecisionDef[] = [
  {
    key: 'policy.inventory.duplicateSubmit',
    track: 'PLATFORM',
    title: '같은 내용의 발주·부서청구·소분지시·실사를 다시 올린 것을 중복으로 볼 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '재고 문서 4종은 올릴 때마다 새 문서번호를 받는다. 같은 요청이 두 번 도착하면(더블클릭·느린 응답 뒤 재시도·두 사람) ' +
      '문서가 두 벌 생기고, 둘 다 승인·출고되면 **이중 발주·이중 불출**로 이어질 수 있다. ' +
      '그러나 같은 부서가 같은 품목을 하루에 두 번 청구하는 것은 업무상 정당할 수 있다 — ' +
      '무엇을 "같은 제출"로 볼지(시간창·내용 비교·명시적 재제출 확인)는 구매·물류 정책이고, ' +
      '코드가 임의의 시간창(예: 60초)을 정하면 그 추정이 정책인 척한다. 임계값을 정할 운영 표본도 없다(가상 병원 시드).',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '구매·물류 책임자 · 원무·행정 책임자',
    options: [
      {
        value: 'ALLOW_REPEAT',
        label: '중복으로 보지 않는다 — 두 번 올리면 두 문서(현행)',
        effect: '지금과 같다. 중복 여부는 승인자가 목록에서 눈으로 가린다. 화면에 "같은 내용 문서가 오늘 이미 있다"는 안내를 둘지는 별도로 정한다.',
        enact: null,
      },
      {
        value: 'WARN_SAME_CONTENT',
        label: '같은 날 같은 부서·같은 품목 구성이면 확인을 받는다(막지 않음)',
        effect: '서버가 같은 날 같은 구성의 문서를 찾아 "그래도 올린다" 확인을 요구한다. 정당한 두 번째 제출은 확인 한 번으로 통과한다.',
        enact: null,
      },
      {
        value: 'IDEMPOTENCY_KEY',
        label: '화면이 제출마다 멱등키를 붙이고, 같은 키의 재도착은 첫 문서를 돌려준다',
        effect: '재시도·더블클릭만 정확히 걸러지고, 사람이 의도해 다시 올린 것은 새 문서가 된다. 스키마 변경(키 칸)이 필요하다.',
        enact: null,
      },
    ],
    statusQuo:
      '`apps/api/src/modules/inventory/inventory.service.ts` `createPurchaseOrder`·`createRequest`·`createRepackOrder`·`createCount` 는 ' +
      '중복 확인 없이 문서를 만든다. 🔴 2026-09-28 까지는 번호를 `Date.now()` 끝 세 자리로 뽑아 같은 날 두 문서가 부딪히면 ' +
      '`@unique` 번호에 막혀 **정상 생성이 500 으로 실패**했다 — 이 갈래에서 잠금 + 그날치 최대 번호 + 1 로 봉합했다. ' +
      '🔴 번호 충돌을 없앤 것이지 중복 제출을 막은 것이 아니다. 멱등 계측(`test/architecture/idempotency-inventory.spec.ts`)은 이 4자리를 여전히 무방비로 센다.',
    opens: ['선택한 방식의 서버 판정·화면 확인 배선'],
    verifyHow: [
      '`/inventory` 계열 화면에서 같은 부서청구를 연달아 두 번 올린다 — 번호가 다른 문서 두 벌이 생긴다',
      '`inventory.service.ts` `createRequest` 를 읽는다 — 번호 채번 외에 기존 문서를 찾는 코드가 없다',
    ],
    afterDecision: '어느 쪽을 골라도(현행 유지 제외) 서버·화면 개발이 남는다. IDEMPOTENCY_KEY 는 스키마 변경을 동반한다.',
    owner: '구매·물류팀 · 전산팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'policy.cssd.partialReceiptResend',
    track: 'PLATFORM',
    title: 'CSSD 발주 부분 입고 중 같은 입고가 다시 오면 무엇으로 볼 것인가 — 그리고 초과 입고를 허용할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      'CSSD 발주 입고는 라인별 수량을 받아 재고(`instrumentItem.stock`)를 늘리고 원장(`supply_transactions`)에 IN 을 남긴다. ' +
      '발주가 아직 전량 입고되지 않은 상태(APPROVED)에서 같은 입고 요청이 순차로 다시 오면, 그것이 **분할 입고**인지 ' +
      '**재전송**인지 서버가 가릴 근거가 없다 — 지금은 둘 다 더한다. 또 발주 수량을 넘겨 받는 것(초과 입고)도 막지 않는다. ' +
      '공급사 과다 납품을 받아들일지, 분할 입고를 무엇으로 식별할지(납품서 번호 등)는 구매·물류 정책이다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: 'CSSD 책임자 · 구매·물류 책임자',
    options: [
      {
        value: 'KEEP',
        label: '현행 — 부분 입고 중 재도착도 더하고, 초과 입고도 받는다',
        effect: '지금과 같다. 재전송으로 재고가 과다 계상되면 실사·조정으로 바로잡는다.',
        enact: null,
      },
      {
        value: 'CAP_AT_ORDERED',
        label: '라인별 누적 입고가 발주 수량을 넘지 못하게 막는다',
        effect: '초과 입고와 "전량을 넘기는 재전송"은 막히고, 발주 수량 안의 재전송은 여전히 더해진다. 과다 납품은 별도 입고 경로로 받아야 한다.',
        enact: null,
      },
      {
        value: 'DELIVERY_REF',
        label: '입고마다 납품서 번호를 받아 같은 번호의 재도착은 무시한다',
        effect: '분할 입고와 재전송이 정확히 갈린다. 입고 화면에 납품서 번호 입력이 생기고 스키마 변경이 필요하다.',
        enact: null,
      },
    ],
    statusQuo:
      '`apps/api/src/modules/cssd/cssd-po.service.ts` `receive` — 🔴 2026-09-28 이 갈래에서 두 가지를 막았다: ' +
      '① 전량 입고된(RECEIVED) 발주의 재입고(종전 상태 검사가 `[\'APPROVED\',\'RECEIVED\']` 라 통과했다) ' +
      '② 동시에 도착한 두 요청(발주 단위 잠금 + 잠근 안에서 재조회). ' +
      '남은 것: APPROVED 상태에서 **순차로** 다시 온 같은 입고는 두 번 더해지고, 라인별 누적 입고가 발주 수량을 넘어도 막지 않는다.',
    opens: ['선택한 방식의 서버 검사(수량 상한 또는 납품서 번호)와 입고 화면 배선'],
    verifyHow: [
      '`cssd-po.service.ts` `receive` 를 읽는다 — `receivedQty` 와 발주 수량 `qty` 를 비교해 막는 코드가 없다',
      '`/cssd` 발주 탭의 입고 버튼은 "전량 입고"(남은 수량 전부)만 보낸다(`apps/web/src/app/(main)/cssd/page.tsx` `receive`) — ' +
        '그래서 부분 입고는 **화면이 아니라 API(`POST /api/v1/cssd/po/:id/receive`)로만** 생긴다. 이 결정은 그 경로의 문제다',
    ],
    afterDecision: 'KEEP 이외를 고르면 서버 검사·화면 개발이 남는다. DELIVERY_REF 는 스키마 변경을 동반한다.',
    owner: 'CSSD · 구매·물류팀 · 전산팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
