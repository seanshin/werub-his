import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  pass,
  fail,
  skip,
  verdictOf,
  summarize,
  EXIT_CODE,
  parseVitestSummary,
  buildSnapshot,
} from '../../../../scripts/release-gate.mjs';

/**
 * 🔴 상용 릴리즈 기계 게이트의 판정 어휘 (2026-09-13 · 기획 T5-1·T5-2).
 *
 * 이 스크립트가 거짓말하는 가장 쉬운 방법은 **돌리지 않은 게이트를 통과로 세는 것**이다
 * (`--quick` 으로 tsc·테스트를 건너뛰었는데 "10/10 PASS"). 그래서 판정·집계를 순수 함수로 떼어 여기서 못박는다.
 * 재주입: `verdictOf` 가 SKIP 을 PASS 로 보거나 · `summarize` 가 SKIP 을 pass 칸에 더하거나 ·
 *         빈 결과를 PASS 로 보거나 · SKIP 사유 검사를 지우면 실패한다.
 */
describe('release-gate — SKIP 은 PASS 가 아니다', () => {
  it('전부 PASS 일 때만 PASS', () => {
    expect(verdictOf([pass('a', 'A'), pass('b', 'B')])).toBe('PASS');
  });

  it('🔴 SKIP 이 하나라도 있으면 INCOMPLETE — 돌리지 않은 것을 통과로 세지 않는다', () => {
    const r = [pass('a', 'A'), skip('b', 'B', '--quick 로 건너뜀')];
    expect(verdictOf(r)).toBe('INCOMPLETE');
    const s = summarize(r);
    expect(s.pass, 'SKIP 을 pass 칸에 더했다').toBe(1);
    expect(s.skip).toBe(1);
    expect(s.verdict).toBe('INCOMPLETE');
    expect(EXIT_CODE[s.verdict], 'INCOMPLETE 가 성공 종료 코드로 나가면 CI 가 통과로 읽는다').not.toBe(0);
  });

  it('FAIL 은 SKIP 보다 우선한다', () => {
    expect(verdictOf([skip('a', 'A', '사유'), fail('b', 'B', '깨짐')])).toBe('FAIL');
  });

  it('🔴 아무것도 안 돌렸으면 PASS 가 아니다', () => {
    expect(verdictOf([])).toBe('INCOMPLETE');
  });

  it('🔴 SKIP 에는 사유가 필수다', () => {
    expect(() => skip('x', 'X', '')).toThrow(/사유/);
  });

  it('vitest 요약 판독 — 못 읽으면 null(0 으로 지어내지 않는다)', () => {
    expect(parseVitestSummary(' Tests  2043 passed (2043)')).toEqual({ failed: 0, passed: 2043 });
    expect(parseVitestSummary(' Tests  2 failed | 2041 passed (2043)')).toEqual({ failed: 2, passed: 2041 });
    expect(parseVitestSummary('no summary here')).toBeNull();
  });

  it('스냅샷은 기준선을 가드 파일에서 읽고, 못 읽으면 null 로 남긴다', () => {
    const root = join(__dirname, '../../../..');
    const real = (p: string) => readFileSync(join(root, p), 'utf8');
    const snap = buildSnapshot({ version: 'vTEST', head: 'deadbeef', results: [pass('a', 'A')], tests: null, readFile: real });
    expect(snap.version).toBe('vTEST');
    expect(snap.gates.verdict).toBe('PASS');
    // 대조군 — 실제 가드 파일에서 숫자를 읽는다(전부 null 이면 추출이 죽은 것이다)
    expect(Object.values(snap.baselines).filter((v) => typeof v === 'number').length).toBeGreaterThan(1);
    const broken = buildSnapshot({ version: 'v', head: 'h', results: [], tests: null, readFile: () => { throw new Error('x'); } });
    expect(Object.values(broken.baselines).every((v) => v === null)).toBe(true);
    expect(broken.systemScale).toBeNull();
  });
});
