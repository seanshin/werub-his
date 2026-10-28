/**
 * `/admin/ai-oversight` — 화면이 **모르는 것을 값으로 그리지 않는다**.
 *
 * 🔴 이 축의 운영 데이터는 오늘 배선돼 거의 비어 있다. 그래서 이 화면이 가장 자주 그리는 것은
 *    숫자가 아니라 '산출 불가'와 그 사유다. 표본 부재를 `0%` 로 그리면 "아무 문제 없음"으로 읽힌다
 *    (분모 0이면 완결률이 100% 가 되던 자리와 같은 계열).
 *
 * 🔴 렌더 검사 + 소스 검사를 함께 한다 — 소스 검사만 하면 "import 는 했는데 안 그린다"를 놓치고
 *    (2026-09-02 실측 17파일), 렌더 검사만 하면 `queryFn` 안 `.catch` 같은 배선 결함을 놓친다.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RATIO_UNAVAILABLE } from '@hospital-run/shared';
import {
  RateCard,
  QuickAcceptPanel,
  ReviewTimingPanel,
  CallsPanel,
  AxisTable,
  ScribeEditPanel,
  type EditDistribution,
  type ScribeEditStats,
  type RateValue,
  type ReviewTiming,
  type CallsResult,
} from '@/app/(main)/admin/ai-oversight/parts';

const ROOT = resolve(__dirname, '../..');
const PAGE = readFileSync(resolve(ROOT, 'src/app/(main)/admin/ai-oversight/page.tsx'), 'utf8');
const PARTS = readFileSync(resolve(ROOT, 'src/app/(main)/admin/ai-oversight/parts.tsx'), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const rate = (over: Partial<RateValue> = {}): RateValue => ({
  numerator: null,
  denominator: 0,
  pct: null,
  unavailableReason: 'ZERO_DENOMINATOR',
  denominatorLabel: '결정된 건수(ACCEPTED+EDITED+REJECTED)',
  ...over,
});

const review = (over: Partial<ReviewTiming> = {}): ReviewTiming => ({
  sample: 0,
  decidedSample: 0,
  truncated: false,
  p50Sec: null,
  p90Sec: null,
  minSampleForDistribution: 5,
  distributionUnavailableReason: '검토 소요를 잴 수 있는 건이 0건뿐이라 분포를 내지 않습니다(최소 5건).',
  notPresentedDecided: 0,
  negativeInterval: 0,
  quickAccept: { thresholdSec: 5, count: 0, items: [] },
  ...over,
});

/* ═════════════ 표본 0 ═════════════ */

describe('표본 0 — 화면이 산출 불가를 말한다', () => {
  it('🔴 분모 0 인 비율 카드는 `0%` 가 아니라 정본 문구를 그린다', () => {
    render(<RateCard title="수용률" rate={rate()} hint="결정된 건 없음" />);
    expect(screen.getByText(RATIO_UNAVAILABLE)).toBeTruthy();
    expect(screen.queryByText(/0%/)).toBeNull();
  });

  it('🔴 분모를 값 옆에 적는다 — 축마다 분모가 다른데 이름이 없으면 같은 것으로 읽힌다', () => {
    render(<RateCard title="수용률" rate={rate()} />);
    expect(screen.getByText(/분모: 결정된 건수/)).toBeTruthy();
  });

  it('🔴 대조군: 표본이 있으면 `n / N (p%)` 를 그린다(전부 산출 불가로 접힌 것이 아니다)', () => {
    render(<RateCard title="수용률" rate={rate({ numerator: 3, denominator: 4, pct: 75, unavailableReason: null })} />);
    expect(screen.getByText(/3 \/ 4 \(75/)).toBeTruthy();
    expect(screen.queryByText(RATIO_UNAVAILABLE)).toBeNull();
  });

  it('🔴 검토 소요 표본이 모자라면 값 자리에 사유를 쓴다(p50=0초 로 접지 않는다)', () => {
    render(<ReviewTimingPanel review={review()} />);
    expect(screen.getByTestId('review-unavailable').textContent).toMatch(/분포를 내지 않습니다/);
    expect(screen.queryByText('0초')).toBeNull();
  });

  it('🔴 잴 수 있는 건이 0 이면 "무검토 의심 0건"이라 말하지 않는다 — 판정 자체가 불가능했다', () => {
    render(<QuickAcceptPanel review={review()} />);
    const text = screen.getByTestId('quick-accept').textContent ?? '';
    expect(text).toMatch(/잴 수 있는 건이 없습니다/);
    // 🔴 "봤는데 없었다"(대조군 문장)로 말하면 안 된다 — 본 적이 없다
    expect(text).not.toMatch(/임계 미만 승인은 없었습니다/);
  });

  it('🔴 대조군: 잴 수 있었는데 임계 미만이 없으면 "봤고 없었다"고 말한다(위와 다른 문장)', () => {
    render(<QuickAcceptPanel review={review({ sample: 12, decidedSample: 12 })} />);
    expect(screen.getByTestId('quick-accept').textContent).toMatch(/12건을 봤고/);
  });

  it('🔴 지연 표본이 모자라면 사유를 쓴다(0ms 로 접지 않는다)', () => {
    const calls: CallsResult = {
      windowDays: 7,
      distribution: { sample: 0, rows: [], byStatusClass: [], note: 'note' },
      latency: { sample: 1, p50Ms: null, p90Ms: null, minSampleForDistribution: 5, unavailableReason: '지연이 기록된 호출이 1건뿐이라 분포를 내지 않습니다(최소 5건).' },
    };
    render(<CallsPanel calls={calls} />);
    expect(screen.getByTestId('calls-panel').textContent).toMatch(/분포를 내지 않습니다/);
    expect(screen.getByTestId('calls-panel').textContent).not.toMatch(/0ms/);
  });
});

/* ═════════════ 임계 출처 ═════════════ */

describe('무검토 임계 — 코드 기본값을 정책인 척하지 않는다', () => {
  it('🔴 미설정이면 그 사실을 화면이 말한다', () => {
    render(
      <QuickAcceptPanel
        review={review({ sample: 3 })}
        policy={{ seconds: 5, configured: false, note: 'ai.oversight.quickAcceptSec 미설정 — 코드 기본값 5초를 씁니다(원내 정책으로 정해진 값이 아닙니다).' }}
      />,
    );
    expect(screen.getByTestId('quick-accept-policy').textContent).toMatch(/미설정/);
  });

  it('설정돼 있으면 원내 설정이라고 말한다(같은 문장이 아니다)', () => {
    render(
      <QuickAcceptPanel review={review({ sample: 3 })} policy={{ seconds: 12, configured: true, note: '원내 설정(ai.oversight.quickAcceptSec)' }} />,
    );
    expect(screen.getByTestId('quick-accept-policy').textContent).toMatch(/원내 설정/);
    expect(screen.getByTestId('quick-accept-policy').textContent).not.toMatch(/미설정/);
  });
});

/* ═════════════ 미측정 ≠ 0 ═════════════ */

describe('미측정을 0 으로 그리지 않는다', () => {
  /**
   * 🔴 이 단언은 **그 셀만** 본다. 처음엔 패널 전체 텍스트에서 '기록 없음'을 찾았는데,
   *    같은 행의 `modelRef: null` 셀이 같은 문구를 내고 있어 **다른 이유로 통과**했다
   *    (재주입해도 초록이었다 — 이 저장소의 반복 함정). 그래서 modelRef 는 값을 채우고
   *    편집거리 셀을 testid 로 지목한다.
   */
  it('🔴 편집거리 null 은 `0` 이 아니라 "기록 없음"으로 그린다', () => {
    render(
      <QuickAcceptPanel
        review={review({
          sample: 9,
          decidedSample: 9,
          quickAccept: {
            thresholdSec: 5,
            count: 1,
            items: [{ proposalId: 'p1', kind: 'SOAP_DRAFT', modelRef: 'qwen2.5:14b', decidedBy: null, seconds: 1.2, editDistance: null }],
          },
        })}
      />,
    );
    const cell = screen.getByTestId('quick-edit-p1').textContent ?? '';
    expect(cell).toMatch(/기록 없음/);
    expect(cell).not.toMatch(/\b0\b/);
  });

  it('🔴 노출 없이 결정된 건을 "0초 검토"로 세지 않고 따로 그린다', () => {
    render(<ReviewTimingPanel review={review({ notPresentedDecided: 4, decidedSample: 4 })} />);
    expect(screen.getByTestId('review-timing').textContent).toMatch(/노출 기록 없이 결정\(측정 불가\)/);
  });
});

/* ═════════════ 빈 축 ═════════════ */

describe('빈 축 — "없음"과 "0" 을 가른다', () => {
  it('행이 없으면 빈 상태와 힌트를 그린다(0% 표를 만들지 않는다)', () => {
    render(<AxisTable title="모델별" rows={[]} emptyHint="상류가 모델 태그를 보고했을 때만 채워집니다" />);
    expect(screen.getByText(/이 기간에 기록된 제안이 없습니다/)).toBeTruthy();
    expect(screen.getByText(/상류가 모델 태그를 보고했을 때만/)).toBeTruthy();
  });
});

/* ═════════════ 배선(소스) ═════════════ */

describe('배선 — 규칙을 주석이 아니라 코드가 지킨다', () => {
  it('🔴 `queryFn` 안에 `.catch(` 가 하나도 없다(있으면 isError 가 영원히 false 다)', () => {
    const code = stripComments(PAGE);
    const offenders = code
      .split('\n')
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /queryFn/.test(line) && /\.catch\(/.test(line));
    expect(offenders.map((o) => o.i + 1), 'queryFn 폴백 catch').toEqual([]);
    // queryFn 이 여러 줄에 걸칠 수 있으므로 파일 전체에서도 확인한다
    expect((code.match(/\.catch\(\s*\(\)\s*=>/g) ?? []).length, '폴백 catch 관용구').toBe(0);
  });

  it('🔴 로딩 · 실패 · 없음이 서로 다른 분기다', () => {
    expect(PAGE).toMatch(/summaryQ\.isError/);
    expect(PAGE).toMatch(/summaryQ\.isLoading/);
    expect(PAGE).toMatch(/<QueryErrorFallback/);
    expect(PAGE).toMatch(/<EmptyState/);
  });

  it('🔴 폴링 주기를 숫자 리터럴로 박지 않는다(설정 정본 pollMs)', () => {
    expect(PAGE).toMatch(/refetchInterval:\s*pollMs\(/);
    expect(stripComments(PAGE)).not.toMatch(/refetchInterval:\s*\d/);
  });

  it("🔴 '산출 불가' 문구를 화면이 손으로 적지 않는다 — 정본(<Ratio>)이 만든다", () => {
    expect(stripComments(PARTS)).not.toMatch(/'산출 불가'|"산출 불가"|>산출 불가</);
    expect(stripComments(PAGE)).not.toMatch(/'산출 불가'|"산출 불가"|>산출 불가</);
    expect(PARTS, '<Ratio> 를 실제로 쓴다').toMatch(/<Ratio\s/);
  });

  it('🔴 자릿수·반올림 정본을 우회하지 않는다(toFixed 직접 호출 0)', () => {
    expect(stripComments(PAGE)).not.toMatch(/\.toFixed\(/);
    expect(stripComments(PARTS)).not.toMatch(/\.toFixed\(/);
  });

  it('🔴 AI 표기는 shared 정본을 쓴다(브랜드를 화면이 적지 않는다)', () => {
    expect(PAGE).toMatch(/AI_ORIGIN_TEXT/);
  });

  it('🔴 반출 버튼은 ADMIN 에게만 — 못 누를 버튼을 보여 주지 않는다', () => {
    expect(PAGE).toMatch(/isAdmin\s*&&/);
    expect(PAGE).toMatch(/user\?\.role\)\s*===\s*'ADMIN'/);
  });

  it('🔴 CSV 실패를 성공처럼 말하지 않는다(!res.ok 를 던진다)', () => {
    expect(PAGE).toMatch(/if \(!res\.ok\) throw/);
  });

  it('page.tsx 는 default 외의 이름 있는 export 를 두지 않는다(next build 실패 방지)', () => {
    const named = [...stripComments(PAGE).matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm)].map((m) => m[1]);
    expect(named, '부품은 parts.tsx 에 둔다').toEqual([]);
  });
});

/* ═════════════ 화면번호·nav ═════════════ */

describe('화면번호 · nav 등재', () => {
  it('freeze 에 등재돼 있고 9xxx 임시 코드가 아니다', async () => {
    const { SCREEN_CODE_FROZEN } = await import('@/components/layout/screen-codes.frozen');
    const code = SCREEN_CODE_FROZEN['/admin/ai-oversight'];
    expect(code, 'freeze 미등재면 번호 이동이 조용히 실패한다').toBe('3410');
    expect(code.startsWith('9')).toBe(false);
  });

  it('🔴 레지스트리에서 코드로 해석된다 — "코드는 있는데 안 가는" 화면이 되지 않는다', async () => {
    const { SCREEN_BY_CODE, SCREEN_CODE_ORPHANS } = await import('@/components/layout/Sidebar');
    expect(SCREEN_BY_CODE['3410']?.href).toBe('/admin/ai-oversight');
    expect(SCREEN_CODE_ORPHANS).not.toContain('/admin/ai-oversight');
  });

  it('🔴 nav 역할이 API @Roles(ADMIN, EXECUTIVE, DOCTOR) 와 같다 — dead-menu 도 결함이다', async () => {
    const { SCREEN_REGISTRY } = await import('@/components/layout/Sidebar');
    const entry = SCREEN_REGISTRY.find((e) => e.href === '/admin/ai-oversight');
    expect(entry, 'nav 미등재').toBeTruthy();
    expect([...entry!.roles].sort()).toEqual(['ADMIN', 'DOCTOR', 'EXECUTIVE']);
  });
});

/* ═════════════ 스크라이브 초안 ↔ 확정 수정량 (2026-10-01) ═════════════ */

const dist = (over: Partial<EditDistribution> = {}): EditDistribution => ({
  drafted: 0,
  capped: 0,
  measured: 0,
  medianPct: null,
  p90Pct: null,
  minSampleForDistribution: 5,
  distributionUnavailableReason: 'NO_SAMPLE',
  unchanged: rate({ denominatorLabel: '수정량을 잴 수 있었던 초안 수' }),
  ...over,
});

const scribeStats = (over: Partial<ScribeEditStats> = {}): ScribeEditStats => ({
  windowDays: 7,
  truncated: false,
  funnel: { signedScribed: 0, notCurrentlySigned: 0, amendedAfterSign: 0, eligible: 0, noDraftSnapshot: 0, capped: 0, measured: 0 },
  overall: dist(),
  sections: { subjective: dist(), objective: dist(), assessment: dist(), plan: dist() },
  draftedWithoutApply: 0,
  ...over,
});

describe('스크라이브 수정량 패널 — 표본 부재를 0% 로 그리지 않는다', () => {
  it('🔴 표본 0 이면 중앙값·p90 자리에 산출 불가를 쓰고 `0%` 를 그리지 않는다', () => {
    const { container } = render(<ScribeEditPanel stats={scribeStats()} />);
    // 정의 문장("0% 는 초안 그대로…")은 빼고 값 자리(표 본문)만 본다
    expect(container.querySelector('tbody')!.textContent).not.toMatch(/(^|[^0-9])0%/);
    // 전체 + S·O·A·P 다섯 줄 × (중앙값·p90·무수정 비율) — 문구는 정본 하나
    expect(screen.getAllByText(RATIO_UNAVAILABLE).length).toBe(15);
  });

  it('대조군 — 잰 값이 있으면 그대로 그린다(측정을 미측정으로 말하지 않는다)', () => {
    const measured = dist({ drafted: 6, measured: 6, medianPct: 12.5, p90Pct: 40, unchanged: rate({ numerator: 2, denominator: 6, pct: 33.3, unavailableReason: null }) });
    const { container } = render(<ScribeEditPanel stats={scribeStats({ overall: measured, funnel: { signedScribed: 6, notCurrentlySigned: 0, amendedAfterSign: 0, eligible: 6, noDraftSnapshot: 0, capped: 0, measured: 6 } })} />);
    expect(container.textContent).toContain('12.5%');
    expect(container.textContent).toContain('40%');
  });

  it('표본이 최소 미만이면 몇 건인지 말한다', () => {
    const { container } = render(<ScribeEditPanel stats={scribeStats({ overall: dist({ drafted: 2, measured: 2 }) })} />);
    expect(container.textContent).toContain('표본 2건 — 최소 5건 미만');
  });

  it('🔴 page 가 scribe-edits 를 부르고 실패를 QueryErrorFallback 으로 낸다(`.catch` 없음)', () => {
    const code = stripComments(PAGE);
    expect(code).toContain("'/scribe-edits'");
    expect(code).toMatch(/scribeQ\.isError\s*\?\s*\(\s*<QueryErrorFallback/);
    expect(code).toContain('<ScribeEditPanel');
  });
});
