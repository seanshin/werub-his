/**
 * 청구 일괄 생성 결과 문장(2026-09-30) — 🔴 종전 화면은 응답을 읽지 않고 늘 "청구 데이터가 생성되었습니다"였다(P16).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeClaimGenerate, readClaimGenerateResult } from '@/lib/claims-generate-result';

const keys = (r: ReturnType<typeof describeClaimGenerate>) => r.parts.map((p) => (p.n != null ? `${p.key}:${p.n}` : p.key));

describe('청구 생성 결과', () => {
  it('생성분이 있으면 성공 — 건너뜀·자비 제외도 함께 말한다', () => {
    const r = describeClaimGenerate({ generated: 3, skipped: 1, excludedSelfPay: 2 });
    expect(r.tone).toBe('success');
    expect(keys(r)).toEqual(['청구 생성:3', '이미 청구가 있어 건너뜀:1', '자비 수납 제외:2']);
  });
  it('(P2-2) 산재·자동차보험 제외 수도 읽고 말한다 · 0건이면 경고', () => {
    const r = readClaimGenerateResult({ data: { generated: 0, skipped: 0, excludedSelfPay: 0, excludedOtherPayer: 2 } });
    expect(r.excludedOtherPayer).toBe(2);
    const d = describeClaimGenerate(r);
    expect(d.tone).toBe('warning');
    expect(keys(d)).toContain('산재·자동차보험 제외(청구처 다름):2');
  });
  it('🔴 0건인데 전부 건너뜀 — 성공이 아니라 경고', () => {
    const r = describeClaimGenerate({ generated: 0, skipped: 2, excludedSelfPay: 0 });
    expect(r.tone).toBe('warning');
    expect(keys(r)[0]).toBe('새로 만든 청구 0건');
  });
  it('대상이 없으면 그렇게 말한다(성공 문장 아님)', () => {
    expect(describeClaimGenerate({ generated: 0, skipped: 0, excludedSelfPay: 0 }).tone).toBe('info');
  });
  it('응답을 못 읽으면 0 으로 채우지 않고 확인 불가라 말한다', () => {
    const r = readClaimGenerateResult({ data: {} });
    expect(r.generated).toBeNull();
    expect(describeClaimGenerate(r).tone).toBe('warning');
  });
  it('이중 래핑·구 서버(excludedSelfPay 없음)도 읽는다', () => {
    expect(readClaimGenerateResult({ data: { data: { generated: 2, skipped: 0 } } })).toEqual({ generated: 2, skipped: 0, excludedSelfPay: null, excludedOtherPayer: null });
  });
  it('구조 — 화면이 결과를 읽는다(고정 성공 문장 금지)', () => {
    const src = readFileSync(join(__dirname, '../../src/app/(main)/claims/page.tsx'), 'utf8');
    expect(src).not.toContain("toast.success('청구 데이터가 생성되었습니다.')");
    expect(src).toMatch(/describeClaimGenerate\(readClaimGenerateResult\(res\)\)/);
  });
});
