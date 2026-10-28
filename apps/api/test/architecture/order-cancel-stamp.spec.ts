import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');
const strip = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/**
 * 오더 취소 스탬프 — 2026-09-03 실측.
 *
 * 🔴 원외처방전 자동 만료 크론이 `status: 'CANCELLED'` 만 쓰고 `cancelledAt` 을 비워 뒀다.
 *    운영에 스탬프 없는 취소 오더 **63건 중 59건**이 이 크론이 만든 것이었다.
 *
 *    `order-sign-entry.ts` 는 **"시각을 모르는 취소는 로그를 만들지 않는다"**(추정 금지)이므로,
 *    그 59건은 **CPOE 서명 로그에 통째로 빠진다** — 누가·언제 오더를 끊었는지 사후에 복원할 수 없다.
 *    법정 성격의 기록이라 "나중에 채우면 된다"가 통하지 않는다.
 */
describe('오더 취소 — 상태만 바꾸고 시각을 빠뜨리지 않는다', () => {
  it('🔴 order 를 CANCELLED 로 쓰는 모든 자리가 cancelledAt 을 함께 찍는다', () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const f of walk(SRC)) {
      const src = strip(readFileSync(f, 'utf-8'));
      // prisma.order / tx.order 의 update·updateMany 호출 블록만 본다
      for (const m of src.matchAll(/\b(?:this\.prisma|tx|prisma)\.order\.updateMany?\(\{[\s\S]{0,700}?\n\s*\}\);/g)) {
        const block = m[0];
        if (!/status:\s*'CANCELLED'/.test(block)) continue;
        checked += 1;
        if (!/cancelledAt/.test(block)) offenders.push(`${f.replace(SRC + '/', '')}`);
      }
    }
    // 🔴 대조군 — 검사가 실제로 무언가를 봤는지(정규식이 깨지면 0개를 통과시킨다)
    expect(checked, '오더 취소 쓰기를 하나도 찾지 못했습니다 — 검사가 헛돕니다').toBeGreaterThanOrEqual(2);
    expect(offenders, `취소 스탬프 없이 상태만 바꾸는 자리:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('🔴 자동 만료 크론이 스탬프를 찍는다(59건이 여기서 나왔다)', () => {
    const s = strip(readFileSync(join(SRC, 'modules/pharmacy/pharmacy.service.ts'), 'utf-8'));
    const block = /expireExternalPrescriptions\(\)[\s\S]{0,900}/.exec(s)?.[0] ?? '';
    expect(block, '자동 만료 메서드를 찾지 못했습니다 — 검사가 헛돕니다').not.toBe('');
    expect(block, '상태만 바꾸면 서명 로그에서 이 취소가 사라진다').toMatch(/cancelledAt/);
    // 행위자는 시스템이다 — 사람을 지어내지 않는다
    expect(block, '자동 만료에 사람 행위자를 넣으면 그것이 거짓 기록이다').not.toMatch(/cancelledById:\s*(?!null)/);
  });

  it('🔴 서명 로그는 시각 없는 취소를 추정하지 않는다(그래서 스탬프가 필수다)', () => {
    const s = strip(readFileSync(join(SRC, 'modules/order-sign-log/order-sign-entry.ts'), 'utf-8'));
    expect(s, 'cancelledAt 이 있을 때만 취소 로그를 만든다').toMatch(/if \(o\.cancelledAt\)/);
    expect(s, 'updatedAt 같은 값으로 취소 시각을 추정하면 안 된다').not.toMatch(/occurredAt:\s*o\.updatedAt/);
  });
});
