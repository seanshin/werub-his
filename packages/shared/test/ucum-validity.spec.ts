import { describe, it, expect } from 'vitest';
// @ts-expect-error — ucum-lhc 는 타입 정의를 제공하지 않는다(검증 전용 devDependency)
import { UcumLhcUtils } from '@lhncbc/ucum-lhc';
import { UCUM_BY_DISPLAY } from '../src/fhir-quantity';
import { NUMERIC_POLICIES } from '../src/numeric-policy';

/**
 * UCUM 유효성 기계 검증 (수치 정책 P5).
 *
 * `UCUM_BY_DISPLAY` 와 `NUMERIC_POLICIES[*].ucumUnit` 은 **손으로 적은 표**다. UCUM 은 대소문자를
 * 구분하고 대괄호 규칙이 있어(`[IU]`·`mm[Hg]`·`10*3/uL`) 눈으로는 오타를 못 잡는다. 우리가 `system:
 * http://unitsofmeasure.org` 를 선언하는 이상 그 코드는 **실제로 파싱되는 UCUM 이어야** 한다 —
 * 아니면 외부에 표준을 지켰다고 거짓말하는 것이고, 그건 애초에 이 정본이 막으려던 결함이다.
 *
 * 공식 구현(NLM/LHNCBC ucum-lhc)으로 전수 검증한다. 새 단위를 추가하면 여기서 자동으로 검증된다.
 * 참조: https://github.com/lhncbc/ucum-lhc
 */

const ucum = UcumLhcUtils.getInstance();

/** 유효하면 undefined, 아니면 사유 문자열 */
function invalidReason(code: string): string | undefined {
  const r = ucum.validateUnitString(code, true);
  if (r.status === 'valid') return undefined;
  return `${r.status}${r.msg?.length ? ` — ${r.msg.join('; ')}` : ''}`;
}

describe('UCUM 코드 유효성 (P5 — 공식 ucum-lhc 전수 검증)', () => {
  it('🔴 표시단위→UCUM 대응표의 모든 코드가 실제 UCUM 이다', () => {
    const bad = Object.entries(UCUM_BY_DISPLAY)
      .map(([display, code]) => {
        const reason = invalidReason(code);
        return reason ? `${display} → ${code} (${reason})` : null;
      })
      .filter(Boolean);
    expect(bad, `UCUM 파싱 실패:\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('🔴 수치 정책 레지스트리의 ucumUnit 이 전부 실제 UCUM 이다', () => {
    const bad = Object.values(NUMERIC_POLICIES)
      .filter((p) => p.ucumUnit)
      .map((p) => {
        const reason = invalidReason(p.ucumUnit as string);
        return reason ? `${p.key} → ${p.ucumUnit} (${reason})` : null;
      })
      .filter(Boolean);
    expect(bad, `UCUM 파싱 실패:\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('검증기가 실제로 걸러낸다 — 표시형은 대개 UCUM 이 아니다(가드의 가드)', () => {
    // 종전 결함이 UCUM code 자리에 그대로 실어보내던 표시 문자열들.
    // 하나라도 valid 로 통과하면 이 테스트는 무의미해지므로 전부 invalid 여야 한다.
    expect(invalidReason('mmHg')).toBeDefined(); // → mm[Hg]
    expect(invalidReason('/μL')).toBeDefined(); // 마이크로 기호는 UCUM 이 아니다 → /uL
    expect(invalidReason('IU/L')).toBeDefined(); // 국제단위는 대괄호 → [IU]/L
    expect(invalidReason('mEq/L')).toBeDefined(); // → meq/L (UCUM 은 대소문자 구분)
    expect(invalidReason('sec')).toBeDefined(); // → s
    expect(invalidReason('SICU')).toBeDefined(); // 애초에 단위가 아님
  });

  it('🔵 `10^3/uL` 은 표시형이지만 실제로 유효한 UCUM 이다(UCUM 은 10* 와 10^ 를 모두 허용)', () => {
    // 실측으로 확인된 사실 — "표시형이면 무조건 UCUM 이 아니다"는 틀렸다.
    // 그래도 대응표는 정규형 `10*3/uL` 로 보낸다(외부 구현별 편차를 줄이는 쪽).
    expect(invalidReason('10^3/uL')).toBeUndefined();
    expect(UCUM_BY_DISPLAY['10^3/uL']).toBe('10*3/uL');
  });
});
