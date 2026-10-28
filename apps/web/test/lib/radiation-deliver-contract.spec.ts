import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 방사선 '조사 완료' 계약 가드 — 이연 회수 T2-4(2026-08-18).
 *
 * 방사선 화면의 '조사 완료' 버튼이 **빈 body `{}`** 를 보냈다. 서버는 조사선량을 필수로 받으므로
 * 이 버튼은 개통 이래 **100% 400 실패**했다("조사 완료 실패" 토스트만 떴다).
 *
 * 조사선량은 사람이 확인해 입력해야 한다 — 화면이 처방값을 자동으로 넣고 완료를 찍으면
 * **실제로 조사한 값이 아닌 숫자가 원장에 남는다**(P16). 프리필은 placeholder 로만 한다.
 */

const SRC = join(process.cwd(), 'src');

const PAGES = [
  'app/(main)/radiation/page.tsx',
  'app/(main)/workstation/therapy/page.tsx',
];

describe('조사 완료는 실제 조사선량을 보낸다', () => {
  for (const rel of PAGES) {
    it(`${rel} — deliver 호출에 deliveredDose 가 있다`, () => {
      const src = readFileSync(join(SRC, rel), 'utf8');
      const callsDeliver = src.includes('/deliver');
      expect(callsDeliver, '조사 완료 호출이 사라졌다면 이 가드를 갱신한다').toBe(true);
      expect(src, '조사선량 없이 조사 완료를 보낸다').toContain('deliveredDose');
    });
  }

  it('🔴 빈 body 로 조사 완료를 보내지 않는다', () => {
    for (const rel of PAGES) {
      const src = readFileSync(join(SRC, rel), 'utf8');
      const emptyBody = src.match(/deliver\w*\.mutate\(\{[^}]*body:\s*\{\s*\}/);
      expect(emptyBody, `${rel} 가 빈 body 로 조사 완료를 보낸다`).toBeNull();
    }
  });

  it('🔴 조사선량을 화면이 자동으로 채워 넣지 않는다 — 입력값이 비면 버튼이 잠긴다', () => {
    const src = readFileSync(join(SRC, 'app/(main)/radiation/page.tsx'), 'utf8');
    // 값이 없으면 제출 불가(0 이하·NaN 차단)
    expect(src).toMatch(/disabled=\{[^}]*parseFloat\(deliverForm\.deliveredDose\)\s*>\s*0/);
    // 처방 분할선량은 placeholder(제안)로만 쓴다 — value 기본값으로 넣지 않는다
    expect(src).toMatch(/placeholder=\{[^}]*perFraction/);
  });
});
