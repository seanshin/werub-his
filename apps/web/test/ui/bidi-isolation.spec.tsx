import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  KDate, Money, MoneyText, UnitText, Num, Duration, StayDays, Ratio, DrugName,
  PatientName, StaffName, Unknown, EmptyState,
} from '../../src/components/ui/display';
import { Term } from '../../src/components/ui/term';
import { useTermLangStore } from '../../src/stores/term-lang-store';

/**
 * BiDi 격리 가드 — 아랍어 트랙 R-A0(`arabic-rtl-track.plan.md` §3 R-A0 · §5 가드 5).
 *
 * 무엇을 지키는가:
 *  1. **격리 유지** — 수치·날짜·용어·약물명 정본 부품이 내용을 `<bdi>` 로 감싼다.
 *     RTL 문맥에서 `120/80 mmHg`·`12 / 15 (80.0%)`·`2026-09-07 14:30`·`E6591` 은
 *     중립 문자(`/ : - ( )`)와 약한 방향의 숫자로 이루어져 **주변 문단 방향에 끌려 재배치**된다.
 *  2. 🔴 **LTR 불변** — 지금(ko/en/ja) 화면의 렌더 문자열이 한 글자도 바뀌지 않는다.
 *     격리를 넣으면서 표기를 건드리는 것을 막으려고 **텍스트를 통째로 동결**한다.
 *  3. **바깥 껍데기 불변** — 부품이 돌려주는 최상위 요소는 여전히 `<span>` 이고 호출부 className 을
 *     그대로 지닌다(flex/grid 자식 신원·CSS 선택자가 그대로여야 배치가 안 바뀐다).
 *  4. **이중 격리 금지** — `<bdi>` 안에 `<bdi>` 를 넣지 않는다.
 *
 * 🔴 **이 가드가 증명하지 못하는 것**: 아랍어 화면(`app/(ae)/**`)이 아직 없어
 *    **RTL 에서 실제로 올바르게 보이는지는 검증하지 못했다.** 여기서 증명되는 것은
 *    "LTR 이 안 바뀐다"와 "격리가 배선돼 있다" 둘뿐이다. 시각 검증은 R-A2 이후 사람 몫(§4.4).
 */

const withQuery = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);

const D = '2026-09-07T14:30:00.000Z';

/** [이름, 노드, LTR 렌더 텍스트(동결), 격리 필요 여부] */
type Row = [string, React.ReactNode, string, boolean];

const ROWS: Row[] = [
  // ── 격리 대상 ────────────────────────────────────────────────────────────
  ['KDate.date', <KDate value={D} />, '2026-09-07', true],
  ['KDate.datetime', <KDate value={D} mode="datetime" />, '2026-09-07 23:30', true],
  ['KDate.time', <KDate value={D} mode="time" />, '23:30', true],
  ['Money', <Money value={12340} />, '12,340원', true],
  ['MoneyText', <MoneyText text="12,340원" />, '12,340원', true],
  ['UnitText.bp', <UnitText text="120/80 mmHg" />, '120/80mmHg', true],
  ['UnitText.temp', <UnitText text="38.2℃" />, '38.2℃', true],
  ['Num.unit', <Num value={38.25} domain="temperature" />, '38.3℃', true],
  ['Num.nounit', <Num value={38.25} domain="temperature" unit={false} />, '38.3', true],
  ['Duration.hm', <Duration minutes={352} />, '5시간 52분', true],
  ['StayDays', <StayDays admit="2026-09-01T00:00:00.000Z" discharge="2026-09-05T00:00:00.000Z" />, '4일', true],
  ['Ratio.full', <Ratio numerator={12} denominator={15} />, '12 / 15 (80.0%)', true],
  ['Ratio.pctOnly', <Ratio numerator={12} denominator={15} pctOnly decimals={0} />, '80%', true],
  ['DrugName.bilingual', <DrugName nameKo="타이레놀정500mg" nameEn="Tylenol 500mg" bilingual />, '타이레놀정500mg (Tylenol 500mg)', true],
  ['DrugName.code', <DrugName code="A11800581" />, 'A11800581', true],

  // ── 격리 대상이 아닌 것(대조군) ──────────────────────────────────────────
  // 🔴 "성공하면 실패로 말하지 않는다" — 낱말·이름까지 감싸는 과잉 적용도 여기서 드러난다.
  ['KDate.unknown', <KDate value={null} unknown="UNRECORDED" />, '기록 없음', false],
  ['Ratio.unavail', <Ratio numerator={0} denominator={0} unavailableHint="이 기간 관찰 기록 없음" />, '산출 불가이 기간 관찰 기록 없음', false],
  ['Unknown', <Unknown kind="NA" />, '해당 없음', false],
  ['EmptyState', <EmptyState title="자료가 없습니다" icon="👤" />, '👤자료가 없습니다', false],
  ['PatientName', <PatientName familyName="홍" givenName="길동" mrn="MRN-000123" />, '홍길동MRN-000123', false],
  ['StaffName', <StaffName name="이수진" suffix=" 선생님" role="판독의" />, '이수진 선생님판독의', false],
];

/** 용어 부품은 표시 모드(KO/EN/BOTH)에 따라 분기가 갈린다 — 분기마다 격리를 확인한다 */
const TERM_ROWS: [('KO' | 'EN' | 'BOTH'), string, React.ReactNode, string, boolean][] = [
  ['KO', 'Term.KO', <Term nameKo="급성 인두염" nameEn="Acute pharyngitis" />, '급성 인두염', true],
  ['EN', 'Term.EN', <Term nameKo="급성 인두염" nameEn="Acute pharyngitis" />, 'Acute pharyngitis', true],
  ['EN', 'Term.EN.missing', <Term nameKo="급성 인두염" />, '급성 인두염EN×', true],
  ['BOTH', 'Term.BOTH', <Term nameKo="급성 인두염" nameEn="Acute pharyngitis" />, '급성 인두염 (Acute pharyngitis)', true],
  ['EN', 'DrugName.EN', <DrugName nameKo="아세트아미노펜정" ingredient="Acetaminophen" />, 'Acetaminophen', true],
  ['EN', 'DrugName.EN.missing', <DrugName nameKo="한글전용약" code="X1" />, '한글전용약EN×', true],
  ['BOTH', 'DrugName.BOTH', <DrugName nameKo="타이레놀정500mg" nameEn="Tylenol 500mg" />, '타이레놀정500mg (Tylenol 500mg)', true],
  ['KO', 'Term.empty', <Term />, '-', false],
];

beforeEach(() => useTermLangStore.setState({ mode: 'KO' }));

describe('BiDi 격리 — 수치·날짜·용어 정본 부품(R-A0)', () => {
  it.each(ROWS)('%s', (_name, node, text, isolated) => {
    const { container } = render(withQuery(node));
    // 2. LTR 불변 — 격리를 넣으면서 표기를 바꾸지 않는다(동결)
    expect(container.textContent).toBe(text);
    // 1. 격리 유지 / 대조군
    const bdis = container.querySelectorAll('bdi');
    if (isolated) {
      expect(bdis.length, 'RTL 에서 숫자·단위·코드가 재배치된다 — <bdi> 를 되돌리지 않는다').toBeGreaterThanOrEqual(1);
    } else {
      expect(bdis.length, '낱말·이름에는 격리가 필요 없다(과잉 적용도 결함이다)').toBe(0);
    }
  });

  it.each(TERM_ROWS)('[%s] %s', (mode, _name, node, text, isolated) => {
    useTermLangStore.setState({ mode });
    const { container } = render(withQuery(node));
    expect(container.textContent).toBe(text);
    const bdis = container.querySelectorAll('bdi');
    if (isolated) expect(bdis.length).toBeGreaterThanOrEqual(1);
    else expect(bdis.length).toBe(0);
  });

  it('🔴 바깥 껍데기가 바뀌지 않는다 — 최상위는 여전히 span 이고 className 을 지닌다(배치 불변)', () => {
    for (const [name, node] of [
      ['KDate', <KDate value={D} className="text-xs text-gray-500" />],
      ['Money', <Money value={12340} className="font-bold" />],
      ['Num', <Num value={38.25} domain="temperature" className="tabular-nums" />],
      ['Ratio', <Ratio numerator={1} denominator={2} className="text-sm" />],
      ['DrugName', <DrugName nameKo="타이레놀" className="truncate" />],
      ['Term', <Term nameKo="급성 인두염" className="truncate" />],
      ['Duration', <Duration minutes={90} className="text-xs" />],
      ['UnitText', <UnitText text="38.2℃" className="text-xs" />],
    ] as [string, React.ReactNode][]) {
      const { container } = render(withQuery(node));
      const root = container.firstElementChild!;
      expect(root.tagName, `${name}: 최상위 태그가 바뀌면 부모의 CSS 선택자·flex 자식 계산이 달라진다`).toBe('SPAN');
      expect(root.className, `${name}: 호출부 className 이 최상위에 남아야 한다`).not.toBe('');
      // 격리는 **안쪽**에 있다 — 바깥을 바꾸지 않는 것이 LTR no-op 의 근거다
      expect(root.querySelector('bdi'), `${name}: 격리가 최상위 안쪽에 있어야 한다`).toBeTruthy();
    }
  });

  it('🔴 이중 격리 금지 — <bdi> 안에 <bdi> 가 없다', () => {
    for (const [, node] of ROWS.map((r) => [r[0], r[1]] as const)) {
      const { container } = render(withQuery(node));
      expect(container.querySelectorAll('bdi bdi').length, '이미 격리된 자리를 다시 감싸지 않는다').toBe(0);
    }
  });
});

/**
 * 🔴 `fs.globSync` 는 **Node 22+** 에만 있다 — CI 는 Node 20 이라 이 가드가
 *    2026-09-03~09-08 **닷새 동안 `TypeError` 로 죽어 있었고**, 그 사이 CI 는 계속 빨강이었다.
 *    로컬(Node 25)에서만 통과해서 아무도 눈치채지 못했다.
 *    저장소 관행대로 `readdirSync` 재귀로 훑는다(SRC 기준 상대 경로 — glob 출력과 같은 모양).
 */
function listTsx(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listTsx(p, base));
    else if (e.name.endsWith('.tsx')) out.push(relative(base, p));
  }
  return out;
}

/**
 * 🔴 `dir="auto"` 와 `<bdi>` 는 **다른 일**이다 — 섞어 쓰면 한쪽이 다른 쪽을 대신한다고 착각한다.
 *    `<T>`(UI 크롬 문자열)는 문자열 자신의 기저 방향을 정하는 `dir="auto"` 를 쓰고,
 *    수치·코드 부품은 주변으로부터 격리하는 `<bdi>` 를 쓴다. 이 분담을 소스에서 동결한다.
 */
describe('격리와 방향 판정의 분담(소스 동결)', () => {
  const SRC = join(process.cwd(), 'src');
  const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

  it('<T> 는 dir="auto" 를 유지하고 bdi 로 바꾸지 않는다', () => {
    const s = read('components/ui/i18n-text.tsx');
    expect(s, '<T> 의 dir="auto" 가 사라지면 번역문의 기저 방향 판정이 없어진다').toContain('dir="auto"');
    expect(s, '<T> 에 <bdi> 를 넣으면 두 도구가 겹친다 — 문자열 방향은 dir="auto" 의 일이다').not.toContain('<bdi');
  });

  it('수치·날짜·용어 정본 파일이 격리를 갖는다(파일 단위 기준선)', () => {
    for (const f of ['components/ui/display.tsx', 'components/ui/term.tsx']) {
      expect(read(f), `${f}: R-A0 격리가 회수됐습니다`).toContain('<bdi');
    }
  });

  /**
   * 🔴 `<bdi>` 가 LTR 렌더를 바꿀 수 있는 **유일한 실제 기전**을 동결한다.
   *
   *    이 부품들은 종전에 `{금액}<span>{단위}</span>` 처럼 **두 개의 조각**을 최상위 span 에 직접 놓았다.
   *    호출부가 그 span 에 `flex`/`gap-*`/`space-x-*` 를 주면 그 두 조각이 **flex 자식 2개**가 되어
   *    간격이 생겼다. 격리 후에는 둘이 `<bdi>` 하나 안으로 들어가 **flex 자식이 1개**가 되므로
   *    그 간격이 조용히 사라진다.
   *
   *    2026-09-07 전수 실측 **0건** — 그래서 이 변경은 지금 배치를 바꾸지 않는다.
   *    🔴 여유를 두지 않고 0 으로 못박는다(여유를 두면 신규 위반을 흡수한다).
   *    새로 필요하면 부품 안에서 처리하거나 감싸는 요소에 flex 를 준다.
   */
  it('🔴 정본 부품에 flex/gap className 을 주지 않는다(격리가 간격을 지우는 유일한 자리 — 기준선 0)', () => {
    const PARTS = 'Money|KDate|Num|Term|DrugName|UnitText|MoneyText|Duration|StayDays|Ratio';
    const files = listTsx(SRC).filter((f) => !f.startsWith('components/ui/'));
    let scanned = 0;
    const hits: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(SRC, f), 'utf8');
      for (const m of src.matchAll(new RegExp(`<(?:${PARTS})\\s[^>]*?/?>`, 'gs'))) {
        scanned += 1;
        const cls = /className="([^"]*)"/.exec(m[0])?.[1] ?? '';
        if (/\b(?:inline-)?(?:flex|grid)\b|\bgap-|\bspace-x-|\bdivide-/.test(cls)) hits.push(`${f}: ${m[0].slice(0, 120)}`);
      }
    }
    // 🔴 대상이 0 이 되면 이 검사는 아무것도 보증하지 않는다 — 스캐너가 실제로 호출부를 훑었는지 먼저 본다
    expect(scanned, '정본 부품 호출부를 찾지 못했습니다 — 검사가 헛돕니다').toBeGreaterThan(300);
    expect(hits, `격리(<bdi>)가 flex 자식 2개를 1개로 합쳐 간격이 사라집니다:\n  ${hits.join('\n  ')}`).toEqual([]);
  });
});
