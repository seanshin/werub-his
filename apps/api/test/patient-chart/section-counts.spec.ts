import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SectionCountsController } from '../../src/modules/specialty-counts/section-counts.controller';

/**
 * 🔴 C2 — 차트가 탭 42개를 그리는데 개수를 세는 탭은 **4종**뿐이었다(2026-08-26).
 *    표본 환자에서 문제목록·알레르기·영상·수술·간호기록은 전부 0인데 내용 있는 탭과 똑같이 생겼다.
 *    임상의는 22번 눌러보거나, 누르지 않고 없다고 가정한다 — 둘 다 나쁘다.
 */
const CTRL = join(process.cwd(), 'src/modules/specialty-counts/section-counts.controller.ts');
const PAGE = join(process.cwd(), '../web/src/app/(main)/patients/[id]/page.tsx');

/** 목은 정본이 실제로 부르는 모양 그대로 — 모든 델리게이트에 count 를 둔다 */
const mk = (opts: { value?: number; failKeys?: string[] } = {}) => {
  const failing = new Set(opts.failKeys ?? []);
  return new Proxy({} as Record<string, unknown>, {
    get: (_t, model: string) => ({
      count: vi.fn().mockImplementation(() =>
        failing.has(model) ? Promise.reject(new Error('db')) : Promise.resolve(opts.value ?? 0),
      ),
    }),
  }) as never;
};

describe('차트 탭 건수', () => {
  const src = readFileSync(CTRL, 'utf8');
  const page = readFileSync(PAGE, 'utf8');

  it('한 번의 호출로 여러 구간을 센다 — 탭마다 따로 부르지 않는다', async () => {
    const r = await new SectionCountsController(mk({ value: 3 })).counts('p1');
    expect(Object.keys(r.data.counts).length).toBeGreaterThanOrEqual(15);
    expect(r.data.failed).toEqual([]);
  });

  it('🔴 세지 못한 구간을 `0` 으로 내지 않는다 — 키가 없고 failed 에 담긴다', async () => {
    const r = await new SectionCountsController(mk({ value: 2, failKeys: ['imagingResult'] })).counts('p1');
    expect(r.data.failed).toContain('imaging');
    expect(r.data.counts).not.toHaveProperty('imaging');
    // 대조군: 나머지는 정상적으로 세어진다(하나 실패했다고 전부 버리지 않는다)
    expect(r.data.counts.problems).toBe(2);
  });

  it('🔴 한 구간이 실패해도 나머지를 포기하지 않는다(Promise.all 이 아니다)', () => {
    expect(src).toMatch(/Promise\.allSettled/);
    expect(src).not.toMatch(/await Promise\.all\(sections/);
  });

  it('🔴 동의서 건수는 동의서 탭이 부르는 정본과 같은 모델을 센다', () => {
    // 탭은 `/patients/:id/consents` → `ConsentForm` 을 본다. 배지가 다른 모델을 세면 탭과 어긋난다.
    expect(src).toMatch(/consentForm\.count/);
    expect(src).not.toMatch(/patientConsent\.count/);
  });

  it('🔴 화면이 0건 탭을 숨기지 않는다 — 숨기면 "그런 탭이 없다"로 읽힌다', () => {
    expect(page).toMatch(/0건 탭도 \*\*숨기지 않는다\*\*/);
    // 필터에 count 로 거르는 코드가 없어야 한다
    expect(page).not.toMatch(/\.filter\([^)]*tabCounts\[[^\]]+\]\s*[>!]/);
  });

  it('🔴 못 센 것과 0건을 화면이 다르게 그린다', () => {
    expect(page).toMatch(/sectionCountFailed\.includes/);
    expect(page).toMatch(/비어 있다는 뜻이 아닙니다/);
  });
});
