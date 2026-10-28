import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 가드 — 감시자 판정 기록 UX(2026-09-04).
 *
 * 이 화면이 지켜야 하는 것:
 *  1. 🔴 판정 이후 값이 늘어난 항목을 "판정됨"으로 그리지 않는다(재판정 필요) —
 *     옛 판정이 새 위반을 조용히 덮으면 그것이 곧 거짓 안심이다.
 *  2. 쓰기 폼의 초기값은 미선택이다(기본 판정을 골라 두면 안 읽고 저장된다).
 *  3. 판정 어휘는 shared 정본 하나다 — 화면이 로컬 라벨 Record 를 재정의하지 않는다.
 *  4. 표본 없는 지표는 '산출 불가'다 — 0이나 빈 숫자로 접지 않는다.
 *  5. 커버리지는 분모를 병기한다(미판정 N / 미해결 적색 M).
 */

const src = readFileSync(
  join(process.cwd(), 'src', 'app', '(main)', 'admin', 'sentinel', 'page.tsx'),
  'utf8',
);
// 🔴 주석이 문자열 검사에 걸리는 함정(v4.11.0) — 코드만 본다
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('감시자 판정 기록 — 화면 정직성', () => {
  it('🔴 판정 이후 증가는 "재판정 필요"로 되돌린다 — staleIncreased 분기가 판정 배지보다 먼저다', () => {
    // 삼항의 참 쪽(staleIncreased)이 재판정 문구를, 거짓 쪽이 판정 배지를 그린다
    const branch = /j\.staleIncreased\s*\?\s*\(([\s\S]{0,600}?)\)\s*:\s*\(/.exec(code);
    expect(branch, 'staleIncreased 분기가 사라졌다 — 옛 판정이 새 위반을 덮는다').toBeTruthy();
    expect(branch![1]).toContain('재판정 필요');
    expect(branch![1], '증가분을 함께 말한다').toContain('increasedBy');
  });

  it('🔴 쓰기 폼 초기값은 미선택(null)이다', () => {
    expect(code).toMatch(/useState<SentinelJudgmentVerdict \| null>\(null\)/);
  });

  it('🔴 제출은 판정 선택+근거(10자)가 없으면 비활성이고, 쓰기 버튼은 44px 이상이다', () => {
    const submit = /<button[^>]*onClick=\{\(\) => mut\.mutate\(\)\}[\s\S]{0,300}?>/.exec(code)?.[0] ?? '';
    expect(submit, '판정 기록 제출 버튼을 찾지 못했다').not.toBe('');
    expect(submit).toContain('disabled={!verdict || basis.trim().length < 10');
    expect(submit).toContain('min-h-[44px]');
  });

  it('🔴 판정 어휘는 shared 정본이다 — import 만이 아니라 실제 사용까지 본다', () => {
    // import 문이 사용 검사를 대신 통과하는 함정 — 사용 지점을 따로 센다
    expect(code).toMatch(/SENTINEL_JUDGMENT_LABEL[,\s}]/);
    const uses = (code.match(/SENTINEL_JUDGMENT_LABEL\[/g) ?? []).length;
    expect(uses, 'shared 라벨 정본을 실제로 그리는 곳이 있어야 한다').toBeGreaterThanOrEqual(2);
    // 로컬 라벨 재정의 금지 — 배지 색 Record(VERDICT_BADGE)는 색만 갖는다
    const badge = /const VERDICT_BADGE[\s\S]{0,400}?\};/.exec(code)?.[0] ?? '';
    expect(badge).not.toMatch(/시드|실결함|보존/);
  });

  it('🔴 해결 중앙값은 표본 0 이면 산출 불가라고 말한다(0일로 접지 않는다·문구는 shared 정본)', () => {
    expect(code).toMatch(/nullText=\{`\$\{RATIO_UNAVAILABLE\} — 표본 0`\}/);
    // MiniMetric 이 null 을 숫자 0 으로 그리지 않고 정본 문구로 떨어진다
    expect(code).toMatch(/value === null[\s\S]{0,200}?nullText \?\? RATIO_UNAVAILABLE/);
  });

  it('🔴 판정 커버리지는 분모를 병기한다 — 미판정 N / 미해결 적색 M', () => {
    const tile = /label="적색 미판정"[\s\S]{0,300}?\/>/.exec(code)?.[0] ?? '';
    expect(tile).toContain('cov.unjudged');
    expect(tile).toContain('cov.openRed');
  });

  it('체류일은 사실이다 — "지연" 판정 어휘를 쓰지 않는다', () => {
    // 워크리스트 줄에서 체류일을 그리되, 지연/초과 같은 판정 어휘로 색을 입히지 않는다
    // 🔴 i18n 배선이 `체류 {i.dwellDays` 를 `<T k="체류" /> {i.dwellDays` 로 바꿨다(2026-09-09).
    //    기준선을 지우지 말고 **두 형태를 모두** 찾도록 넓힌다(정본 `ui-locale-i18n.plan.md` §10).
    expect(code).toMatch(/(?:체류|<T\s+k="체류"\s*\/>)\s*\{i\.dwellDays/);
    // 부정 단언도 배선 형태를 함께 막는다 — 한 형태만 막으면 조용히 통과한다
    expect(code).not.toMatch(/(?:지연|<T\s+k="지연"\s*\/>)\s*\{/);
  });

  it('판정 폼이 서버 스냅샷 사실을 밝힌다 — 시점 건수가 서버에서 저장됨을 화면이 말한다', () => {
    expect(code).toContain('서버에서 함께 저장됩니다');
  });
});

describe('소관(관리자/의료진/행정) 구분 — 표시 분류이지 권한이 아니다', () => {
  it('라벨 어휘는 shared 정본을 쓴다 — 로컬 라벨 재정의 금지', () => {
    expect(code).toMatch(/SENTINEL_AUDIENCE_LABEL\[/);
    const chipBlock = /const AUDIENCE_CHIP[\s\S]{0,400}?\};/.exec(code)?.[0] ?? '';
    expect(chipBlock.length).toBeGreaterThan(50);
    expect(chipBlock).not.toMatch(/관리자|의료진|행정/);
  });

  it('🔴 응답에 소관이 없는 것(undefined)과 미분류(null)를 가른다 — 없는 것을 미분류라 주장하지 않는다', () => {
    const badge = /function AudienceBadge[\s\S]*?\n}\n/.exec(code)?.[0] ?? '';
    expect(badge).toMatch(/audience === undefined.*return null/);
    expect(badge).toMatch(/audience === null/);
    expect(badge).toContain('SENTINEL_AUDIENCE_UNASSIGNED_LABEL');
  });

  it('🔴 미분류 필터 칩은 있을 때만 그린다 — 없는 분류 칸을 지어내지 않는다', () => {
    expect(code).toMatch(/audCount\('UNASSIGNED'\) > 0 && \(/);
  });

  it('🔴 필터 칩은 건수를 병기하고, 필터로 비면 전체 건수를 말한다 — 숨긴 것이 사라진 척하지 않는다', () => {
    expect(code).toMatch(/function AudienceFilterChip[\s\S]{0,800}?count\.toLocaleString/);
    expect(code).toMatch(/이 소관 필터에 해당하는 항목이 없습니다[\s\S]{0,120}?rows\.length/);
  });

  it('소관 필터는 권한이 아니라는 사실을 코드가 밝힌다(주석 규약 대조군)', () => {
    // 주석은 검사에서 걷어내므로 원본으로 본다
    expect(src).toContain('표시 분류이지 권한이 아니다');
  });
});

describe('AI 판정 보조 — 초안·보조 규약', () => {
  const panel = /function AdvisorPanel[\s\S]*?\n}\n/.exec(code)?.[0] ?? '';

  it('AdvisorPanel 을 실제로 찾았다(대조군)', () => {
    expect(panel.length).toBeGreaterThan(200);
    // 폼 안에 실제로 렌더된다 — 만든 것과 소비처는 다른 일이다
    expect(code).toMatch(/<AdvisorPanel finding=\{finding\} \/>/);
  });

  it('🔴 AI 제안이 폼을 채우지 않는다 — setVerdict/setBasis 를 부르지 않는다', () => {
    expect(panel).not.toContain('setVerdict');
    expect(panel).not.toContain('setBasis');
  });

  it('🔴 AI 표기 병기 + 관계 모드(보조·초안·사람 확정)를 화면이 밝힌다', () => {
    // 2026-09-11 i18n(§12-B): 템플릿 리터럴 → 보간 키 `{AI표기} 판정 보조`. AI 표기는 번역하지 않고 값으로 넘긴다 —
    //    그래서 두 형태를 다 받되, 보간 형태는 자리표시자가 **AI_ORIGIN_TEXT 에 묶였는지**까지 본다(다른 값이면 병기가 아니다).
    expect(panel).toMatch(/\$\{AI_ORIGIN_TEXT\} 판정 보조|'\{AI표기\} 판정 보조'[\s\S]{0,80}AI표기: AI_ORIGIN_TEXT/);
    expect(panel).toContain('확정 판정은 사람이 합니다');
  });

  it('🔴 UNAVAILABLE 은 사유를 그린다 — 실패·불가를 빈 화면이나 지어낸 초안으로 접지 않는다', () => {
    expect(panel).toMatch(/source === 'UNAVAILABLE'[\s\S]{0,200}?r\.reason/);
    expect(panel).toMatch(/mut\.isError/);
  });
});
