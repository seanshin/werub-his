/**
 * 🔴 (2026-09-14) 분납 회차 모달 — 잔액·예정일 경과는 서버 summary 그대로, 납부 시각은 KST.
 * 지키는 것: ① summary 를 그리고 없으면 '계산하지 않는다'고 말한다 ② 화면이 회차 금액을 합산하지 않는다
 * ③ paidAt 을 UTC 절단(slice(0,10))하지 않는다 ④ '연체' 라고 부르지 않는다 ⑤ 새 키가 카탈로그에 있다
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BILLING_MESSAGES } from '@hospital-run/shared';

const page = readFileSync(resolve(__dirname, '../../src/app/(main)/billing/page.tsx'), 'utf8');
const start = page.indexOf('function InstallmentPlanModal');
const next = page.indexOf('\nfunction ', start + 10);
const modal = page.slice(start, next > 0 ? next : undefined).replace(/\{\/\*[\s\S]*?\*\/\}|\/\/.*$/gm, '');

describe('분납 회차 모달', () => {
  it('① 서버 summary 사용·없음 문구', () => {
    expect(start).toBeGreaterThan(-1);
    expect(modal).toMatch(/plan\.summary\.remainingAmount/);
    expect(modal).toContain('잔액 정보를 받지 못했습니다 — 화면에서 계산하지 않습니다.');
    expect(modal).toMatch(/pmt\.dueDatePassed/);
  });
  it('② 회차 금액을 화면에서 합산하지 않는다', () => {
    expect(modal).not.toMatch(/\.reduce\(/);
  });
  it('③ paidAt 을 UTC 절단하지 않는다', () => {
    expect(modal).not.toMatch(/paidAt\.slice\(0,\s*10\)/);
  });
  it('④ 연체라 부르지 않는다', () => {
    expect(modal).not.toContain('연체');
  });
  it('⑤ 새 키가 billing 카탈로그에 있다', () => {
    for (const k of ['예정일 경과', '납부 완료액', '{회차}회차 · {금액}', '납부 {일시}', '잔액 정보를 받지 못했습니다 — 화면에서 계산하지 않습니다.']) {
      expect(BILLING_MESSAGES.en?.[k], k).toBeTruthy();
    }
  });
});
