/**
 * 🔴 집행 게이트의 설정 조회는 **실패를 삼키지 않는다** — 2026-08-27 신설.
 *
 * 실측 배경: 사전승인(`preauth.enforce`)·포뮬러리(`formulary.enforce`)·근무제약(`duty.constraint.enforce`)
 * 세 게이트가 설정 조회에 `.catch(() => null)` 을 달고 있었다. 그러면 조회가 한 번 실패할 때
 * `{}` → **전 유형 'OFF'** 가 되어, BLOCK 으로 운영 중이어도 마약류 처방·수혈·항암·고가검사가
 * 전부 통과하고 `GateViolationLog` 조차 남지 않는다.
 *
 * 🔴 포뮬러리는 바로 아래 주석이 **"존재하는 미지값 = BLOCK(fail-closed)"** 이라고 적어두고 있었다 —
 *    **주석으로 적어둔 규칙을 실패 경로가 어기고 있었다.**
 *
 * 대조군이 근거다: 이 저장소의 다른 집행 게이트 10곳(dur·cdss·bcma·surgery·blood-bank·
 * obgyn·pediatrics·pharmacy×2·remote-consultation)은 전부 `.catch` 없이 전파한다.
 * 키 부재는 `ConfigRuntimeService.get()` 이 `null` 을 돌려주므로 그대로 기본값(OFF)으로 흐른다 —
 * **부재와 실패는 다른 사실이다.**
 *
 * 재주입: 아무 게이트 설정 조회에 `.catch(() => null)` 을 되살리면 실패한다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(__dirname, '..', '..', 'src', 'modules');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(f);
  }
  return out;
}

/** 집행 모드를 결정하는 설정 키 — 이 값이 게이트의 OFF/WARN/BLOCK 을 정한다 */
const GATE_KEY = /\.get\(\s*(['"`])([^'"`]*(?:enforce|Gate|gateMode)[^'"`]*)\1\s*\)|\.get\(\s*[A-Z_]*GATE[A-Z_]*\s*\)/;
/** 그 조회에 붙은 값-폴백 catch */
const SWALLOW = /\.get\([^)]*\)\s*\.catch\(/;

/**
 * 면제 — **실패가 더 엄격한 쪽으로 떨어지는 자리**. 면제에는 이유를 적는다.
 *
 * 🔴 첫 판정은 `er.registration.guardianGate` 를 위반으로 올렸는데, 그 자리는 실패 시
 *    `raw === 'OFF' ? 'OFF' : 'WARN'` 이라 **WARN(더 엄격)** 으로 떨어진다 — 오탐이었다.
 *    **정직한 코드를 가드에 맞추지 않고, 면제에 이유를 적었다.**
 */
const FAIL_SAFE_ALLOW: Array<{ key: string; why: string }> = [
  { key: 'er.registration.guardianGate', why: "실패 → null → `=== 'OFF' ? 'OFF' : 'WARN'` 의 else 로 가 **WARN**(더 엄격)" },
];

describe('집행 게이트 — 설정 조회 실패를 OFF 로 접지 않는다', () => {
  const files = walk(SRC);

  it('🔴 게이트 설정 조회에 `.catch(...)` 가 붙어 있지 않다 (실패=전면 해제가 된다)', () => {
    // 표본이 사라지면 조용히 통과한다 — 하한을 건다(2026-08-27 실측: 게이트 설정 조회 20+)
    let scanned = 0;
    const offenders: string[] = [];
    for (const f of files) {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((l, i) => {
        if (!GATE_KEY.test(l)) return;
        scanned++;
        if (!SWALLOW.test(l)) return;
        if (FAIL_SAFE_ALLOW.some((a) => l.includes(a.key))) return;
        offenders.push(`${path.relative(SRC, f)}:${i + 1}  ${l.trim().slice(0, 90)}`);
      });
    }
    expect(scanned, '게이트 설정 조회를 하나도 못 찾았다 — 추출이 깨진 것이다').toBeGreaterThanOrEqual(15);
    expect(
      offenders,
      `게이트 설정 조회 실패가 'OFF' 로 접힌다(대조군: 다른 게이트 10곳은 전파한다):\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('대조군 — 판정식이 실제로 잡는다(무조건 통과가 아니다)', () => {
    const bad = "const v = await this.config.get('preauth.enforce').catch(() => null);";
    const good = "const v = await this.config.get('preauth.enforce');";
    const unrelated = "const v = await this.config.get('ui.pollMs').catch(() => null);";
    const stricter = "this.config?.get('er.registration.guardianGate').catch(() => null) ?? null,";
    expect(GATE_KEY.test(bad) && SWALLOW.test(bad)).toBe(true);
    expect(GATE_KEY.test(good) && SWALLOW.test(good)).toBe(false);
    // 게이트가 아닌 설정까지 잡으면 오탐이 나고, 오탐이 나면 가드를 끄게 된다
    expect(GATE_KEY.test(unrelated)).toBe(false);
    // 🔴 면제는 '판정 대상이 아니다'가 아니라 '이유가 있다' — 이유 없는 면제를 두지 않는다
    expect(FAIL_SAFE_ALLOW.every((a) => a.why.length > 10)).toBe(true);
    expect(FAIL_SAFE_ALLOW.some((a) => stricter.includes(a.key))).toBe(true);
    // 면제 목록이 통째로 비면 이 대조군이 무의미해진다 — 그리고 면제가 늘어나면 사람이 본다
    expect(FAIL_SAFE_ALLOW.length).toBeLessThanOrEqual(3);
  });
});
