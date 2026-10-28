/**
 * 수납 화면은 남은 금액을 기본값으로, 결과는 서버 응답으로(2026-10-14 결함 발굴 수납 P1-1·P1-3).
 *  · 🔴 종전: 빈 칸 기본값 = 본인부담 전액(부분 납부·감면·검진권 뒤에도) · 원 단위 절사(1~9원 미수) ·
 *    복합결제가 감면을 안 보내고 `{status:'PAID'}` 를 지어내 "완료"
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { billingRemaining } from '@hospital-run/shared';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('남은 납부 금액 정본(shared)', () => {
  it('본인부담 − 감면 − 이미 낸 돈 · 본인부담 모르면 null(0 아님) · 더 받았으면 음수 그대로', () => {
    expect(billingRemaining({ patientCopay: 15000, discountAmount: 3000, paidAmount: 5000 })).toBe(7000);
    expect(billingRemaining({ patientCopay: null })).toBeNull();
    expect(billingRemaining({ patientCopay: 10000, paidAmount: 12000 })).toBe(-2000);
  });
});

describe('🔴 수납 화면 구조', () => {
  const list = src('src/app/(main)/billing/page.tsx');
  const detail = src('src/app/(main)/billing/[id]/page.tsx');
  it('수납 모달 기본값은 남은 금액(본인부담 전액이 아니다)', () => {
    expect(list).toMatch(/const remaining = billingRemaining\(billing\)/);
    expect(list).not.toMatch(/Number\(payAmount\) \|\| \(billing\.patientCopay/);
  });
  it('상세 화면 — 남은 금액 정본·절사 없음·지어낸 PAID 없음·감면 정본 반올림', () => {
    expect(detail).toMatch(/billingRemaining\(\{ patientCopay: copay/);
    expect(detail).not.toMatch(/Math\.floor\(n \/ roundUnit\)/);
    expect(detail).not.toMatch(/return \{ data: \{ status: 'PAID' \} \}/);
    expect(detail).not.toMatch(/Math\.round\(copay \*/);
  });
});
