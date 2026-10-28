/**
 * 수납 상세 — P5 후속 확인을 말한다(2026-10-14 결함 발굴 수납·청구 P5).
 *  · 단가 0원 항목(약가·수가 미등재일 수 있음)을 조용히 넘기지 않는다
 *  · 환불 응답의 보험 청구 검토 필요·선수금 몫을 말한다(자동으로 바꾸지 않은 것을 사람이 알게)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const s = readFileSync(join(process.cwd(), 'src/app/(main)/billing/[id]/page.tsx'), 'utf8');

describe('🔴 수납 상세 P5', () => {
  it('단가 0원 항목 경고', () => {
    expect(s).toMatch(/items\.some\(\(i: BillingItem\) => i\.unitPrice === 0\)/);
    expect(s).toMatch(/data-unpriced-lines/);
  });
  it('환불 뒤 청구 검토·선수금 몫을 말한다', () => {
    expect(s).toMatch(/r\?\.claimReview\?\.needed/);
    expect(s).toMatch(/r\.depositPortion > 0/);
  });
});
