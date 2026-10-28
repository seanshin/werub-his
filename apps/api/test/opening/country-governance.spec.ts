import { describe, it, expect } from 'vitest';
import {
  OPENING_REGISTRY, COUNTRY_ORDER, COUNTRY_META, DEFAULT_COUNTRY, isCountryCode,
} from '../../src/modules/opening/opening.registry';

/**
 * 국가별 개원 거버넌스 (2026-08-28 · KR·AE).
 *
 * 🔴 이 축의 위험은 **내가 규제 사실을 지어내는 것**이다. 조사한 것만 적고,
 *    조문·수수료·처리기한은 적지 않는다(검증할 수 없고 자주 바뀐다).
 */
describe('모든 항목이 나라를 밝힌다', () => {
  it('🔴 `countries` 가 빈 항목이 없다 — 비면 "모든 나라"인지 "안 정했는지" 모른다', () => {
    const bad = OPENING_REGISTRY.filter((d) => !Array.isArray(d.countries) || d.countries.length === 0);
    expect(bad.map((d) => d.key)).toEqual([]);
  });

  it('정본에 없는 나라 코드를 쓰지 않는다', () => {
    const bad: string[] = [];
    for (const d of OPENING_REGISTRY) for (const c of d.countries) if (!isCountryCode(c)) bad.push(`${d.key}→${c}`);
    expect(bad).toEqual([]);
  });

  it('나라마다 항목이 실제로 있다 — 목록만 만들고 비어 있으면 화면이 빈다', () => {
    for (const c of COUNTRY_ORDER) {
      const n = OPENING_REGISTRY.filter((d) => d.countries.includes(c)).length;
      expect(n, `${c} 항목 수`).toBeGreaterThan(10);
    }
  });

  it('선행 항목이 **같은 나라 안에** 있다 — 다른 나라 항목을 선행으로 걸면 영원히 안 풀린다', () => {
    const byKey = new Map(OPENING_REGISTRY.map((d) => [d.key, d]));
    const bad: string[] = [];
    for (const d of OPENING_REGISTRY) {
      for (const k of d.dependsOn ?? []) {
        const p = byKey.get(k);
        if (!p) continue;
        for (const c of d.countries) if (!p.countries.includes(c)) bad.push(`${d.key}(${c})→${k}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('기본 국가가 정본 안에 있다', () => {
    expect(COUNTRY_ORDER).toContain(DEFAULT_COUNTRY);
    for (const c of COUNTRY_ORDER) {
      expect(COUNTRY_META[c].label, c).toBeTruthy();
      expect(COUNTRY_META[c].note, c).toBeTruthy();
    }
  });
});

describe('🔴 UAE — 관할을 하나로 단정하지 않는다', () => {
  const AE = OPENING_REGISTRY.filter((d) => d.countries.includes('AE') && !d.countries.includes('KR'));

  it('관할 확정이 첫 항목으로 있다 — 이게 정해져야 제출처가 정해진다', () => {
    const j = AE.find((d) => d.key === 'open.ae.jurisdiction');
    expect(j, '관할 확정 항목').toBeTruthy();
    expect(j!.note).toContain('먼저');
  });

  it('🔴 세 관할을 모두 밝힌다 — 한 곳으로 단정하면 다른 에미리트에서 틀린 말이 된다', () => {
    expect(COUNTRY_META.AE.note).toContain('DHA');
    expect(COUNTRY_META.AE.note).toContain('DoH');
    expect(COUNTRY_META.AE.note).toContain('MOHAP');
  });

  it('관할에 따라 달라지는 항목은 `authority` 에 그렇게 적는다', () => {
    for (const k of ['open.ae.eclaim', 'open.ae.hie']) {
      const d = AE.find((x) => x.key === k)!;
      expect(d.authority, k).toContain('관할에 따라 다름');
    }
  });

  it('🔴 FANR 은 연방 소관임을 밝힌다 — 보건당국과 섞으면 절차를 놓친다', () => {
    const f = AE.find((d) => d.key === 'open.ae.fanr')!;
    expect(f.authority).toContain('FANR');
    expect(f.note).toContain('연방');
  });

  it('통제약 월간 · 마약류 분기 — 주기를 뭉개지 않는다', () => {
    expect(AE.find((d) => d.key === 'open.ae.narcoticReport')!.cycle).toBe('MONTHLY');
    expect(AE.find((d) => d.key === 'open.ae.narcoticReportQ')!.cycle).toBe('QUARTERLY');
  });
});

describe('🔴 조사한 것만 적는다', () => {
  const SRC = OPENING_REGISTRY.map((d) => JSON.stringify(d)).join('\n');

  it('조문·기한을 적지 않는다(국가 항목이 늘어도 유지된다)', () => {
    expect(SRC).not.toMatch(/제\s*\d+\s*조/);
    expect(SRC).not.toMatch(/Federal Law No/i);
    expect(SRC).not.toMatch(/\d+\s*일\s*(이내|내)/);
    expect(SRC).not.toMatch(/\d+\s*(주|weeks?)\s*(이내|소요)/);
  });

  it('🔴 수수료를 적지 않는다 — 자주 바뀌고 내가 검증할 수 없다', () => {
    expect(SRC).not.toMatch(/AED\s*[\d,]/);
    expect(SRC).not.toMatch(/[\d,]+\s*원(?!무)/);
  });

  it('UAE 목록이 전수가 아니라는 사실을 파일이 말한다', () => {
    const file = require('fs').readFileSync(
      require('path').join(process.cwd(), 'src/modules/opening/opening.registry.ts'), 'utf-8',
    );
    expect(file).toContain('확인한 것만 적었다');
  });
});
