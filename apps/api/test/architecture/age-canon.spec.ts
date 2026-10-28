import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ageOf, ageInMonths } from '@hospital-run/shared';

/**
 * 🔴 나이 정본 (2026-08-29 · 발굴 8회차).
 *
 * `ageOf` 는 **미래 생년월일·150세 초과를 `null`(나이 미상)** 로 답한다.
 * 그런데 임상 경로 셋이 같은 계산을 **각자 다시 적어** 그 검사를 통과시켰다:
 *  · DUR(약물 상호작용) — 연령 금기 규칙에 음수·비현실 나이가 들어간다
 *  · 검사 기준치 — 엉뚱한 연령 구간의 정상범위로 판정하면 **위급값을 정상이라 부른다**
 *  · 자격 판정(운영이 SIMULATION 모드로 돈다) — 🔴 **연도 차이만** 봐서 생일 전이면
 *    한 살 많았고, 생년월일이 없으면 **0세(신생아)** 로 떨어졌다. `age >= 65` 가
 *    산정특례를 정하므로 **본인부담 경계가 한 살 어긋났다.**
 *
 * 운영 실측(2026-08-29): 미래 생년월일 0 · 150세 초과 0 · 110~150세 **1명**
 * → 🔴 **구조적 결함이고 현재 갈라지는 환자는 없다(다른 사실이다).**
 */
/**
 * 🔴 **이 파일의 `@hospital-run/shared` 는 소스가 아니라 `packages/shared/dist` 다.**
 *    재주입으로 알아냈다 — shared **소스**를 고치고 테스트를 돌리면 **옛 코드가 통과한다**.
 *    shared 동작을 바꿨으면 **빌드해야 이 테스트가 그것을 본다**(안 그러면 통과가 거짓이다).
 */
describe('🔴 나이 정본이 거르는 값', () => {
  const now = new Date(2026, 7, 29);

  it('미래 생년월일은 나이 미상이다 — 0 이나 음수로 뭉개지 않는다', () => {
    expect(ageOf(new Date(2030, 0, 1), now)).toBeNull();
  });

  it('150세를 넘으면 나이 미상이다', () => {
    expect(ageOf(new Date(1800, 0, 1), now)).toBeNull();
  });

  it('없으면 나이 미상이다 — 🔴 0세(신생아)로 떨어지지 않는다', () => {
    expect(ageOf(null, now)).toBeNull();
    expect(ageOf(undefined, now)).toBeNull();
  });

  it('🔴 생일 전이면 한 살 적다 — 연도 차이만 보면 본인부담 경계가 어긋난다', () => {
    expect(ageOf(new Date(1961, 11, 1), now), '1961-12 생 → 2026-08 시점 64세').toBe(64);
    expect(ageOf(new Date(1961, 0, 1), now), '1961-01 생 → 65세').toBe(65);
  });

  it('정상 범위는 그대로 센다(대조군 — 무조건 null 이면 소용없다)', () => {
    expect(ageOf(new Date(1990, 5, 15), now)).toBe(36);
    expect(ageInMonths(new Date(2026, 1, 15), now)).toBe(6);
  });
});

describe('🔴 임상 경로가 나이 계산을 다시 적지 않는다', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // 🔴 주석의 설명이 검사에 걸리지 않게

  const PATHS = [
    'modules/prescription/dur/dur.service.ts',
    'modules/lab/lab.service.ts',
    'modules/eligibility/simulation.provider.ts',
  ];

  for (const rel of PATHS) {
    it(`${rel.split('/').pop()} 가 정본을 쓴다`, () => {
      const src = read(rel);
      expect(src, 'ageOf/ageInMonths 정본을 쓴다').toMatch(/\bage(Of|InMonths)\(/);
      // 🔴 재발 방지: 연도 차이로 나이를 직접 만드는 코드
      expect(src, '나이 계산을 다시 적었다(getFullYear 차이)')
        .not.toMatch(/getFullYear\(\)\s*-\s*\w+\.getFullYear\(\)/);
    });
  }

  it('🔴 자격 판정이 나이를 모를 때 고령 특례로 넘기지 않는다', () => {
    const src = read('modules/eligibility/simulation.provider.ts');
    expect(src).toMatch(/age !== null && age >= 65/);
    expect(src, '나이 미상을 0 으로 떨어뜨리던 코드').not.toMatch(/getFullYear\(\)\s*:\s*0/);
  });
});
