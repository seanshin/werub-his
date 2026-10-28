import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SENTINEL_AUDIENCES } from '@hospital-run/shared';
import { DATA_AUDIENCE, FLOW_AUDIENCE, AXIS_AUDIENCE_DEFAULT, audienceOf } from '../../src/sentinel/sentinel-audience';
import { FLOW_STAGES } from '../../src/sentinel/flow-registry';
import { PIPE_CHECKS } from '../../src/sentinel/pipe-registry';

/**
 * 소관(관리자/의료진/행정) 매핑 가드 — 양방향 기계 대조.
 * ① SQL 의 모든 불변식 키가 매핑에 있다(새 검사를 추가하면 소관도 정한다)
 * ② 매핑의 키가 실제 검사에 존재한다(유령 키 = 조용히 죽은 분류)
 * 🔴 소관은 표시 분류이지 권한이 아니다 — 이 가드는 권한을 재지 않는다.
 */

const REPO_ROOT = join(process.cwd(), '..', '..');

/** 정합성 SQL 의 검사 키 추출 — '30 days' 같은 interval 리터럴은 키가 아니다 */
function sqlCheckKeys(): string[] {
  const raw = readFileSync(join(REPO_ROOT, 'infra/scripts/data-integrity-scan.sql'), 'utf-8');
  const keys = new Set<string>();
  for (const m of raw.matchAll(/'(\d{2}[a-z]?) ([^']+)'/g)) {
    if (/^(day|hour|second|minute|year)s?$/.test(m[2])) continue;
    keys.add(`integrity.${m[1]}`);
  }
  return [...keys];
}

describe('감시 발견 소관 매핑', () => {
  const sqlKeys = sqlCheckKeys();

  it('추출기가 실제로 키를 찾았다(대조군 — 0이면 아래가 전부 헛돈다)', () => {
    expect(sqlKeys.length).toBeGreaterThan(60);
    expect(sqlKeys).toContain('integrity.09');
    expect(sqlKeys).toContain('integrity.48e');
    // interval 리터럴을 키로 오인하지 않는다 — 30 은 진짜 검사라 있고, 가짜 키가 늘지 않았는지는 총수가 잡는다
    expect(sqlKeys.length).toBeLessThan(100); // 90→100 2026-10-01 실제 검사 91(여정 82~85 추가) — 가짜 키 상한
  });

  it('🔴 ① SQL 의 모든 불변식이 소관을 갖는다 — 새 검사를 추가하면 여기서 소관도 정한다', () => {
    const missing = sqlKeys.filter((k) => !(k in DATA_AUDIENCE));
    expect(missing, '소관 미지정 검사 키').toEqual([]);
  });

  it('🔴 ② 매핑에 유령 키가 없다 — SQL 에서 사라진 검사의 분류는 함께 지운다', () => {
    const phantom = Object.keys(DATA_AUDIENCE).filter((k) => !sqlKeys.includes(k));
    expect(phantom, 'SQL 에 없는 매핑 키').toEqual([]);
  });

  it('🔴 FLOW 매핑이 flow-registry 와 양방향 일치한다', () => {
    const regKeys = FLOW_STAGES.map((s: { key: string }) => s.key).sort();
    expect(Object.keys(FLOW_AUDIENCE).sort()).toEqual(regKeys);
  });

  it('모든 소관 값이 어휘 정본 안에 있다', () => {
    const all = [...Object.values(DATA_AUDIENCE), ...Object.values(FLOW_AUDIENCE), ...Object.values(AXIS_AUDIENCE_DEFAULT)];
    for (const v of all) expect(SENTINEL_AUDIENCES).toContain(v);
  });

  it('🔴 모르는 키는 null(미분류) — 소관을 지어내지 않는다', () => {
    expect(audienceOf('DATA', 'integrity.999')).toBeNull();
    expect(audienceOf('FLOW', 'flow.unknown')).toBeNull();
    expect(audienceOf('NOPE', 'x')).toBeNull();
  });

  it('CONTRACT·PIPE 는 축 단위 관리자 소관이다(대조군 — 동적 drift.* 키도 잡힌다)', () => {
    expect(audienceOf('CONTRACT', 'drift.KEY_MISSING.command-center.buildKpi')).toBe('ADMIN');
    expect(audienceOf('PIPE', PIPE_CHECKS[0].key)).toBe('ADMIN');
  });

  it('세 소관이 전부 실제로 쓰인다 — 분류가 한쪽으로 쏠려 죽은 어휘가 되지 않았다', () => {
    const used = new Set(Object.values(DATA_AUDIENCE));
    for (const a of SENTINEL_AUDIENCES) expect(used.has(a), `${a} 소관이 DATA 에 하나도 없다`).toBe(true);
  });
});
