import { describe, it, expect } from 'vitest';
import { matchAttendance } from '../../src/modules/gld/governance.service';

/**
 * 정족수 명부 대조 (2026-08-28).
 *
 * 🔴 발단(운영 실측): 정족수는 `attendees` **배열 길이**만 셌다. 명부를 아무도 보지 않아
 *    **위원 0명 위원회 9개가 의결을 누적**하고 있었고, 저장된 참석자는
 *    `["a","b","c","d","e"]` — 화면이 이름을 콤마로 타이핑받아 문자열로 저장한 것이었다.
 *    아무 문자 다섯 개로 정족수 5가 충족됐다.
 *
 * 결정은 **중첩**이다 — 위원 임명이 먼저 있고 그 위에 의결이 얹힌다.
 */
const ROSTER = new Set([
  '00000000-0000-4000-a000-000000000001',
  '00000000-0000-4000-a000-000000000002',
]);

describe('참석자 ↔ 명부 대조', () => {
  it('계정 id 로 기록된 참석자는 명부와 대조된다', () => {
    const m = matchAttendance(
      ['00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000009'],
      ROSTER,
    );
    expect(m.identifiable).toBe(true);
    expect(m.identified).toBe(2);
    expect(m.onRoster).toBe(1);
  });

  it('`{ userId }` 형태도 읽는다 — 저장 모양이 두 가지다', () => {
    const m = matchAttendance([{ userId: '00000000-0000-4000-a000-000000000002' }], ROSTER);
    expect(m.identifiable).toBe(true);
    expect(m.onRoster).toBe(1);
  });

  it('🔴 이름 문자열은 신원이 아니다 — 대조 불가로 남긴다', () => {
    // 운영에 실제로 있던 값. 이걸 "명부 0명"으로 세면 **없는 위반**을 만든다.
    const m = matchAttendance(['a', 'b', 'c', 'd', 'e'], ROSTER);
    expect(m.identifiable, '이름 문자열을 신원으로 읽지 않는다').toBe(false);
    expect(m.identified).toBe(0);
  });

  it('🔴 하나라도 못 읽으면 전체를 대조 불가로 본다 — 부분 대조는 거짓 수치가 된다', () => {
    const m = matchAttendance(['00000000-0000-4000-a000-000000000001', '홍길동'], ROSTER);
    expect(m.identifiable).toBe(false);
  });

  it('🔴 중복 참석자는 한 번만 센다 — 같은 사람으로 정족수를 채울 수 없다', () => {
    const dup = '00000000-0000-4000-a000-000000000001';
    const m = matchAttendance([dup, dup], ROSTER);
    // 2명이 적혔지만 실제 사람은 1명 → 전원 식별했다고 말할 수 없다
    expect(m.identifiable).toBe(false);
    expect(m.onRoster).toBe(1);
  });

  it('참석자가 비면 대조하지 않는다(의결 자체가 앞에서 막힌다)', () => {
    expect(matchAttendance([], ROSTER).identifiable).toBe(false);
  });
});

describe('🔴 판정을 두 갈래로 가른다', () => {
  const SRC = require('fs').readFileSync(
    require('path').join(process.cwd(), 'src/modules/gld/governance.service.ts'), 'utf-8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('명부가 비었으면 참석자 형태와 무관하게 위반이다', () => {
    // rosterEmpty 는 identifiable 과 AND 로 묶이면 안 된다 —
    // 이름 문자열로 기록한 회의에서 "명부 0명"이 통째로 빠져나간다
    expect(SRC).toMatch(/const rosterEmpty = roster\.length === 0;/);
    expect(SRC).toMatch(/violated: rosterEmpty \|\| shortOfRoster/);
  });

  it('정족수 미달 판정은 신원을 읽을 수 있을 때만 한다', () => {
    expect(SRC).toMatch(/shortOfRoster = !rosterEmpty && attendance\.identifiable/);
  });

  it('🔴 대조 불가라는 사실이 조용해지지 않는다', () => {
    expect(SRC).toContain('대조하지 않았다');
  });

  it('🔴 게이트는 3상 정본을 쓰고 기본은 WARN 이다 — 바로 막으면 회의록이 시스템 밖으로 나간다', () => {
    expect(SRC).toMatch(/gateMode\(await this\.config\?\.get\('governance\.quorumRosterGate'\), 'WARN'\)/);
    expect(SRC).toMatch(/enforceGate\(\{/);
  });

  it('🔴 WARN 통과를 의결자에게 돌려준다 — 원장에만 남기면 그 자리에서 안 고쳐진다', () => {
    expect(SRC).toMatch(/rosterWarning \? \{ \.\.\.out, gateWarnings/);
  });
});
