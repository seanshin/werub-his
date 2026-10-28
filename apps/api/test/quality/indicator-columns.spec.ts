import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizeIndicatorDirection,
  resolveIndicatorPolicy,
  undeterminedReason,
} from '../../src/modules/quality/indicator-policy';
import { QualityService } from '../../src/modules/quality/quality.service';

/**
 * 질 지표 방향·단위·배율의 **DB 컬럼 배선** 가드 (W7 이연 · 2026-08-18).
 *
 * 🔴 봉합한 것
 *   ① 방향이 코드 등재표에만 있어, 관리자가 화면에서 만든 새 지표는 **측정 입력이 422 로 막혔다**
 *      (풀려면 코드 배포가 필요했다). 측정값은 사실인데 통째로 버려졌다.
 *   ② `QiMeasurement.meetTarget` 이 NOT NULL 이라 **'판정 불가'를 저장할 자리가 없었다**.
 *   ③ 컬럼이 생긴 뒤에도 코드 등재표를 먼저 보면 관리자가 등재한 방향이 무시된다(정본이 둘 = P12).
 *
 * 이 스펙은 위 셋이 되살아나는 것을 막는다. **결함을 되돌리면 실패해야 가드다.**
 */

const API_SRC = join(process.cwd(), 'src');
const WEB_SRC = join(process.cwd(), '..', 'web', 'src');
const read = (p: string) => readFileSync(p, 'utf-8');

/** 코드 등재표에 '낮을수록 좋음'으로 확정된 지표 — 컬럼과의 우선순위를 시험하기 좋다 */
const FALL = { name: '낙상 발생률', category: '환자안전', formula: '(낙상 발생 건수 / 재원일수) × 1000' };

describe('우선순위 ① DB 컬럼 → ② 코드 등재표 → ③ 미등재', () => {
  it('🔴 컬럼이 코드 등재표를 이긴다 — 관리자가 등재한 방향이 무시되면 화면이 반대로 말한다', () => {
    const p = resolveIndicatorPolicy({ ...FALL, direction: 'HIGHER_IS_BETTER' });
    expect(p.direction).toBe('HIGHER_IS_BETTER');
    expect(p.directionSource).toBe('COLUMN');
    // 🔴 어긋남을 조용히 덮지 않는다 — 화면이 이 사실을 말해야 한다
    expect(p.directionConflict).toBe(true);
  });

  it('컬럼이 비면 코드 등재표로 내려간다', () => {
    const p = resolveIndicatorPolicy({ ...FALL, direction: null });
    expect(p.direction).toBe('LOWER_IS_BETTER');
    expect(p.directionSource).toBe('REGISTRY');
    expect(p.directionConflict).toBe(false);
    expect(p.registeredDirection).toBeNull(); // 등재된 적 없다는 사실은 따로 남는다
  });

  it('🔴 둘 다 없으면 미등재 — 방향을 지어내지 않는다', () => {
    const p = resolveIndicatorPolicy({ name: '신규 지표 XYZ', formula: '(a / b) × 100' });
    expect(p.direction).toBeNull();
    expect(p.directionSource).toBeNull();
  });

  it('단위·배율도 컬럼이 산식 파싱을 이긴다', () => {
    const p = resolveIndicatorPolicy({ ...FALL, unit: '건/1000 환자일', valueScale: 100 });
    expect(p.unit).toBe('건/1000 환자일'); // 산식은 '건/1000 재원일수'
    expect(p.unitSource).toBe('COLUMN');
    expect(p.valueScale).toBe(100);        // 산식은 1000
    expect(p.valueScaleSource).toBe('COLUMN');
    expect(p.valueScaleKnown).toBe(true);
  });

  it('컬럼이 비면 산식 → 그래도 없으면 백분율 가정(가정임을 표시한다)', () => {
    expect(resolveIndicatorPolicy(FALL).valueScaleSource).toBe('FORMULA');
    const assumed = resolveIndicatorPolicy({ name: 'x', formula: '알 수 없는 산식' });
    expect(assumed.valueScale).toBe(100);
    expect(assumed.valueScaleKnown).toBe(false);
    expect(assumed.valueScaleSource).toBe('ASSUMED');
  });

  it('🔴 쓸 수 없는 배율(0·음수·소수)은 등재로 치지 않는다', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const p = resolveIndicatorPolicy({ ...FALL, valueScale: bad });
      expect(p.registeredValueScale, String(bad)).toBeNull();
      expect(p.valueScale, String(bad)).toBe(1000); // 산식으로 내려간다
    }
  });
});

describe('방향 문자열 정규화 — 읽기는 관대, 쓰기는 정본 하나', () => {
  it('스키마 주석 표기·대소문자·하이픈을 흡수한다', () => {
    for (const raw of ['LOWER_BETTER', 'lower_is_better', 'Lower-Is-Better', ' LOWER ']) {
      expect(normalizeIndicatorDirection(raw), raw).toBe('LOWER_IS_BETTER');
    }
    for (const raw of ['HIGHER_BETTER', 'higher_is_better', 'HIGHER']) {
      expect(normalizeIndicatorDirection(raw), raw).toBe('HIGHER_IS_BETTER');
    }
  });

  it('🔴 모르는 표기는 방향으로 지어내지 않는다(null = 미등재)', () => {
    for (const raw of ['UP', 'GOOD', 'LOWERR', '높을수록', '', null, undefined]) {
      expect(normalizeIndicatorDirection(raw as string), String(raw)).toBeNull();
    }
  });
});

describe('판정 불가의 이유를 말한다', () => {
  it('무엇이 없어서 판정 못 했는지 구분한다', () => {
    expect(undeterminedReason(null, 1.5, 'LOWER_IS_BETTER')).toBe('NO_VALUE');
    expect(undeterminedReason(1.2, null, 'LOWER_IS_BETTER')).toBe('NO_TARGET');
    expect(undeterminedReason(1.2, 1.5, null)).toBe('DIRECTION_NOT_REGISTERED');
    expect(undeterminedReason(1.2, 1.5, 'LOWER_IS_BETTER')).toBeNull();
  });
});

describe('QualityService — 컬럼 배선', () => {
  let service: QualityService;
  let prisma: any;
  const unknown = { id: 'i3', name: '신규 지표 XYZ', category: '기타', formula: '(a / b) × 100', targetValue: 50, direction: null, unit: null, valueScale: null };

  beforeEach(() => {
    prisma = {
      qualityIndicator: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
      qiMeasurement: { findMany: vi.fn(), create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve(data)), findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
    };
    service = new QualityService(prisma);
  });

  it('🔴 컬럼 방향으로 대시보드가 판정한다 — 코드 등재표와 반대여도', async () => {
    prisma.qualityIndicator.findMany.mockResolvedValue([
      { ...FALL, id: 'i1', targetValue: 1.5, direction: 'HIGHER_IS_BETTER', unit: null, valueScale: null,
        measurements: [{ value: 3.0, period: '2026-05', meetTarget: false, measuredAt: new Date('2026-05-31') }] },
    ]);
    const [row] = await service.getDashboard();
    expect(row.direction).toBe('HIGHER_IS_BETTER'); // 컬럼
    expect(row.meetTarget).toBe(true);              // 3.0 >= 1.5
  });

  it('🔴 컬럼 방향으로 추이도 재판정한다(저장값을 믿지 않는다)', async () => {
    prisma.qualityIndicator.findUnique.mockResolvedValue({ ...FALL, id: 'i1', targetValue: 1.5, direction: 'LOWER_BETTER', unit: null, valueScale: null });
    prisma.qiMeasurement.findMany.mockResolvedValue([{ id: 'm1', period: '2026-05', value: 1.2, meetTarget: false }]);
    const [row] = await service.getMeasurements('i1');
    expect(row.direction).toBe('LOWER_IS_BETTER'); // 표기 흡수
    expect(row.meetTarget).toBe(true);
    expect(row.storedMeetTarget).toBe(false);
    expect(row.undetermined).toBe(false);
  });

  it('🔴 방향 미등재 지표의 측정은 저장된다(422 로 막지 않는다) · meet_target = null', async () => {
    prisma.qualityIndicator.findUnique.mockResolvedValue(unknown);
    const r = await service.addMeasurement({ indicatorId: 'i3', period: '2026-06', numerator: 60, denominator: 100 });
    expect(prisma.qiMeasurement.create).toHaveBeenCalledTimes(1);
    expect(r.meetTarget).toBeNull();
    expect(r.meetTarget).not.toBe(true);  // 🔴 모르는 것을 '달성'으로 접지 않는다
    expect(r.meetTarget).not.toBe(false); // 🔴 '미달'로도 뭉개지 않는다
    expect(r.undeterminedReason).toBe('DIRECTION_NOT_REGISTERED');
  });

  it('🔴 컬럼 배율로 측정값을 계산한다(산식보다 우선)', async () => {
    prisma.qualityIndicator.findUnique.mockResolvedValue({ ...FALL, id: 'i1', targetValue: 1.5, direction: null, unit: null, valueScale: 100 });
    const r = await service.addMeasurement({ indicatorId: 'i1', period: '2026-06', numerator: 1, denominator: 1000 });
    expect(r.value).toBe(0.1);        // 컬럼 ×100 (산식이었다면 ×1000 → 1)
    expect(r.valueScale).toBe(100);
  });

  it('🔴 측정 입력이 코드 등재표의 방향을 옆문으로 뒤집지 못한다', async () => {
    prisma.qualityIndicator.findUnique.mockResolvedValue({ ...FALL, id: 'i1', targetValue: 1.5, direction: null, unit: null, valueScale: null });
    await expect(
      service.addMeasurement({ indicatorId: 'i1', period: '2026-06', numerator: 1, denominator: 1000, direction: 'HIGHER_IS_BETTER' }),
    ).rejects.toThrow(/등재표/);
    expect(prisma.qiMeasurement.create).not.toHaveBeenCalled();
  });

  it('이미 등재된 방향과 다른 값을 측정 입력으로 보내면 거절한다', async () => {
    prisma.qualityIndicator.findUnique.mockResolvedValue({ ...unknown, direction: 'LOWER_IS_BETTER' });
    await expect(
      service.addMeasurement({ indicatorId: 'i3', period: '2026-06', numerator: 60, denominator: 100, direction: 'HIGHER_IS_BETTER' }),
    ).rejects.toThrow(/이미 등재/);
  });

  it('updateIndicator 가 방향·단위·배율을 등재하고, 비우면 해제한다', async () => {
    prisma.qualityIndicator.findUnique.mockResolvedValue(unknown);
    prisma.qualityIndicator.update.mockImplementation(({ data }: any) => Promise.resolve({ ...unknown, ...data }));

    const r = await service.updateIndicator('i3', { direction: 'HIGHER_BETTER', unit: '%', valueScale: 100 });
    expect(prisma.qualityIndicator.update).toHaveBeenCalledWith({
      where: { id: 'i3' }, data: { direction: 'HIGHER_IS_BETTER', unit: '%', valueScale: 100 },
    });
    expect(r.directionSource).toBe('COLUMN');

    await service.updateIndicator('i3', { direction: null, unit: null, valueScale: null });
    expect(prisma.qualityIndicator.update).toHaveBeenLastCalledWith({
      where: { id: 'i3' }, data: { direction: null, unit: null, valueScale: null },
    });
  });

  it('🔴 해석되지 않는 방향 문자열은 거절한다(오타를 방향으로 저장하지 않는다)', async () => {
    prisma.qualityIndicator.findUnique.mockResolvedValue(unknown);
    await expect(service.updateIndicator('i3', { direction: 'UP' })).rejects.toThrow(/방향/);
    expect(prisma.qualityIndicator.update).not.toHaveBeenCalled();
  });

  it('🔴 저장된 측정값을 소급 수정하지 않는다 — 읽는 시점 재판정이 정본이다', async () => {
    prisma.qualityIndicator.findUnique.mockResolvedValue(unknown);
    prisma.qualityIndicator.update.mockResolvedValue({ ...unknown, direction: 'LOWER_IS_BETTER' });
    await service.updateIndicator('i3', { direction: 'LOWER_IS_BETTER' });
    expect(prisma.qiMeasurement.create).not.toHaveBeenCalled();
    expect((prisma.qiMeasurement as any).updateMany).toBeUndefined();
  });
});

/* ── 구조 가드 — 결함을 되돌리면 실패한다 ─────────────────────────── */

describe('구조 가드: 컬럼을 건너뛰지 않는다', () => {
  const svc = read(join(API_SRC, 'modules/quality/quality.service.ts'));

  it('🔴 서비스가 지표명만으로 방향을 구하지 않는다(컬럼을 무시하는 회귀)', () => {
    // 컬럼을 읽는 유일한 경로는 resolveIndicatorPolicy(indicator) 다.
    expect(svc).not.toMatch(/resolveIndicatorDirection\s*\(/);
    expect(svc).toMatch(/resolveIndicatorPolicy\(/);
  });

  it('🔴 방향 미등재를 422 로 막지 않는다 — 측정값(사실)을 버리지 않는다', () => {
    expect(svc).not.toMatch(/UnprocessableEntityException/);
  });

  it('🔴 판정 불가를 false/true 로 접지 않는다', () => {
    const code = svc
      .split('\n')
      .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/meetTarget\s*(\?\?|\|\|)\s*(false|true)/);
    expect(code).not.toMatch(/meetTarget:\s*meetTarget\s*===\s*true/);
  });

  it('우선순위 규칙이 정본 주석 한 곳에 못박혀 있다', () => {
    const policy = read(join(API_SRC, 'modules/quality/indicator-policy.ts'));
    expect(policy).toMatch(/DB 컬럼/);
    expect(policy).toMatch(/코드 등재표/);
    expect(policy).toMatch(/미등재/);
  });
});

describe('구조 가드: 화면이 표본 부재를 0%/100% 로 말하지 않는다', () => {
  const page = read(join(WEB_SRC, 'app/(main)/quality/page.tsx'));

  it('🔴 판정된 지표가 없으면 달성률은 0 이 아니라 null(산출 불가)', () => {
    expect(page).toMatch(/judged\s*>\s*0\s*\?[\s\S]{0,60}:\s*null/);
    expect(page).not.toMatch(/judged\s*>\s*0\s*\?[\s\S]{0,60}:\s*0\b/);
    expect(page).toMatch(/산출 불가/);
  });

  it('🔴 방향 미등재를 화면이 말하고, 어디서 등재하는지 알려준다', () => {
    expect(page).toMatch(/방향 미등재/);
    expect(page).toMatch(/quality\/indicators\//); // 수정(등재) 경로가 화면에 배선돼 있다
  });

  it('🔴 새 지표 등록 폼이 방향·단위·배율을 함께 보낸다 — 만들자마자 판정 불가로 태어나지 않게', () => {
    const from = page.indexOf("apiClient.post('/api/v1/quality/indicators'");
    expect(from, '등록 경로가 화면에 배선돼 있지 않다').toBeGreaterThan(-1);
    // 등록 요청 본문(payload)만 잘라서 본다 — 파일 어딘가에 같은 단어가 있는 것으로는 통과시키지 않는다
    const payload = page.slice(from, page.indexOf('}),', from));
    for (const field of ['direction:', 'unit:', 'valueScale:']) {
      expect(payload, field).toContain(field);
    }
  });

  it('🔴 등재 원본(registered*)으로 폼을 프리필한다 — 폴백값을 등재된 것처럼 보이지 않게', () => {
    expect(page).toMatch(/registeredDirection\s*\?\?\s*''/);
    expect(page).toMatch(/registeredValueScale === null/);
  });
});

/**
 * 🔴 코디네이터 회수분(2026-08-18) — 등재한 방향을 **한 화면만 무시**하는 것을 막는다.
 *
 * `safety-quality-board` 는 지표 row 에서 `name`·`targetValue` 만 뽑고
 * `resolveIndicatorDirection(name)`(이름 기반 등재표)로 판정했다. 그래서 관리자가 화면에서 등재한
 * `direction` 컬럼이 **이 보드에서만** 무시돼, 같은 지표가 화면마다 달성/미달이 갈렸다(P12).
 */
describe('안전·질 보드가 등재된 방향을 무시하지 않는다', () => {
  const SRC = readFileSync(
    join(process.cwd(), 'src/modules/qi/safety-quality-board.service.ts'),
    'utf-8',
  );

  it('🔴 지표 select 에 direction 컬럼이 있다', () => {
    expect(SRC).toMatch(/indicator:\s*\{\s*select:\s*\{[^}]*direction:\s*true/);
  });

  it('🔴 이름만 보는 등재표 우회 경로를 쓰지 않는다', () => {
    expect(SRC).not.toContain('resolveIndicatorDirection(');
    expect(SRC).toContain('resolveIndicatorPolicy(');
  });
});
