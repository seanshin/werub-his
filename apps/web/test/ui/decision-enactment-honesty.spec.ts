import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENACT_STYLE, type EnactmentState } from '@/app/(main)/admin/decisions/types';

/**
 * 🔴 **"정했다"와 "그렇게 됐다"를 화면이 가른다.**
 *
 * 2026-08-27 이전 화면은 `record.applied` 하나로 '적용됨'/'기록만' 두 갈래였다.
 * 그런데 실제로는 다섯 가지다 — 특히 **`FAILED`(집행 실패)는 표현 자체가 없었다.**
 * 반영대기를 반영됨과 같은 초록으로 그리면 "20건 결정 완료"가
 * 아무것도 바뀌지 않은 상태를 가린다.
 */
const ROOT = resolve(__dirname, '../..');
const PAGE = readFileSync(resolve(ROOT, 'src/app/(main)/admin/decisions/page.tsx'), 'utf8');

const STATES: EnactmentState[] = ['UNDECIDED', 'ENACTED', 'PENDING', 'FAILED', 'MANUAL_CONFIRMED'];

describe('결정 이행 상태 — 화면이 접지 않는다', () => {
  it('다섯 상태에 각각 스타일이 있다', () => {
    for (const s of STATES) expect(ENACT_STYLE[s], `${s} 스타일 없음`).toBeTruthy();
  });

  it('🔴 반영됨(ENACTED)과 반영대기(PENDING)가 **다른 색**이다', () => {
    expect(ENACT_STYLE.PENDING).not.toBe(ENACT_STYLE.ENACTED);
  });

  it('🔴 실패(FAILED)가 다른 어떤 상태와도 같은 색이 아니다 — 실패는 눈에 띄어야 한다', () => {
    for (const s of STATES) {
      if (s !== 'FAILED') expect(ENACT_STYLE.FAILED, `FAILED 가 ${s} 와 같은 색`).not.toBe(ENACT_STYLE[s]);
    }
  });

  it('🔴 자가신고(MANUAL_CONFIRMED)를 실검증(ENACTED)과 같은 색으로 그리지 않는다', () => {
    expect(ENACT_STYLE.MANUAL_CONFIRMED).not.toBe(ENACT_STYLE.ENACTED);
  });

  it('대조군: 다섯 색이 모두 서로 다르다(전부 같은 값으로 접힌 것이 아니다)', () => {
    expect(new Set(STATES.map((s) => ENACT_STYLE[s])).size).toBe(STATES.length);
  });

  it('🔴 화면이 이행 상태를 실제로 렌더한다 — 정본만 만들고 안 쓰면 소용없다', () => {
    expect(PAGE).toMatch(/d\.enactment/);
    expect(PAGE, '상태별 스타일을 써야 한다').toMatch(/ENACT_STYLE\[d\.enactment\.state\]/);
  });

  it('🔴 집행 실패 사유(error)를 화면이 감추지 않는다', () => {
    expect(PAGE).toMatch(/a\.error/);
  });
});

const CONSOLE = readFileSync(resolve(ROOT, 'src/app/(main)/admin/decisions/console/page.tsx'), 'utf8');
const FROZEN = readFileSync(resolve(ROOT, 'src/components/layout/screen-codes.frozen.ts'), 'utf8');

/**
 * 🔴 관리 콘솔은 **관리하는 곳**이다 — 결정 화면(브리핑·기록)과 독자가 다르다.
 *    이 화면이 답해야 할 질문 넷이 화면에 실제로 있는지 본다.
 */
describe('결정 관리 콘솔', () => {
  it('🔴 층별 진행률을 하나로 합치지 않는다 — 합치면 거짓 안심이 생긴다', () => {
    expect(CONSOLE).toMatch(/LAYER_ORDER\.map/);
    // 전체 합계 퍼센트를 만들지 않는다
    expect(CONSOLE, '전 층을 합친 퍼센트를 만들면 안 된다').not.toMatch(/items\.length\s*\)\s*\*\s*100/);
  });

  it('🔴 "결정했으나 미반영"을 반영됨에 더하지 않고 **따로** 말한다', () => {
    expect(CONSOLE).toMatch(/결정했으나 미반영/);
    expect(CONSOLE).toMatch(/bucketOf\(i\) === 'DONE'/);
  });

  it('🔴 반영실패 묶음이 따로 있다 — 성공에 묻히지 않는다', () => {
    expect(CONSOLE).toMatch(/FAILED: \{ title: '반영 실패'/);
  });

  it('🔴 담당·기한을 화면이 보여준다 — 없으면 34건은 아무의 일도 아니다', () => {
    expect(CONSOLE).toMatch(/\{d\.owner\}/);
    expect(CONSOLE).toMatch(/DUE_LABEL\[d\.dueBy\]/);
  });

  it('🔴 `queryFn` 안에서 `.catch(() => 기본값)` 을 쓰지 않는다(isError 가 영원히 false 가 된다)', () => {
    const qf = CONSOLE.slice(CONSOLE.indexOf('queryFn:'), CONSOLE.indexOf('const items'));
    expect(qf).not.toMatch(/\.catch\(\s*\(\s*\)\s*=>/);
  });

  it('화면번호가 동결돼 있다 — 번호를 치면 열려야 한다', () => {
    expect(FROZEN).toMatch(/'\/admin\/decisions\/console': '\d{4}'/);
  });
});

/**
 * 🔴 **import 만 하고 쓰지 않으면 그 기능은 없는 것이다.**
 *    결정 화면은 `ProposeAgendaButton` 을 import 해 두고 **한 번도 렌더하지 않았다**
 *    (서버·모달·타입은 모두 `DECISION` 출처를 지원하고 있었다 — 2026-08-27 실측).
 *    다른 3화면(data-quality·go-live·safety-gates)은 정상적으로 쓰고 있었다.
 */
describe('위원회 상신 — 등록부가 집행하지 않는 대신 다음 단계를 준다', () => {
  const PAGE_ = readFileSync(resolve(ROOT, 'src/app/(main)/admin/decisions/page.tsx'), 'utf8');

  it('🔴 `ProposeAgendaButton` 이 import 만 되어 있지 않고 실제로 렌더된다', () => {
    const uses = [...PAGE_.matchAll(/<ProposeAgendaButton/g)].length;
    expect(uses, 'import 만 있고 사용처가 0이면 그 기능은 없는 것이다').toBeGreaterThan(0);
  });

  it('🔴 위원회 경로에만 상신 버튼이 뜬다 — 허가권자 결정을 안건으로 올리게 하지 않는다', () => {
    expect(PAGE_).toMatch(/approvalPath === 'COMMITTEE'[\s\S]{0,400}<ProposeAgendaButton/);
  });

  it('출처가 DECISION 으로 붙는다 — 위원이 무엇을 의결하는지 안건에서 바로 읽는다', () => {
    expect(PAGE_).toMatch(/sourceRef=\{\{ type: 'DECISION', key: d\.key \}\}/);
  });
});

/**
 * 🔴 **집행 실패가 "기록만"으로 읽히면 안 된다.**
 *    종전 라벨은 `record.applied` 불리언이라 두 갈래뿐이었고, FAILED 도 주황 "기록만"이었다 —
 *    화면이 사실보다 안전하게 말하는 것도 사실이 아니다.
 */
describe('결정 기록 라벨 — 불리언으로 접지 않는다', () => {
  const PAGE2 = readFileSync(resolve(ROOT, 'src/app/(main)/admin/decisions/page.tsx'), 'utf8');

  it('🔴 라벨을 `record.applied` 삼항 하나로 결정하지 않는다', () => {
    expect(PAGE2, 'applied 불리언만으로 색을 정하면 FAILED 가 "기록만"이 된다')
      .not.toMatch(/className=\{d\.record\.applied \? 'text-emerald-700' : 'text-amber-800'\}/);
  });

  it('🔴 FAILED 는 빨강으로 구분된다', () => {
    expect(PAGE2).toMatch(/d\.enactment\?\.state === 'FAILED' \? 'font-bold text-red-700'/);
  });

  it('이행 상태의 라벨을 그대로 쓴다 — 화면이 두 번째 어휘를 만들지 않는다', () => {
    expect(PAGE2).toMatch(/d\.enactment\?\.label/);
  });
});
