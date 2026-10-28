/**
 * 화면의 '미수·남은 금액'은 정본 하나(2026-10-14 결함 발굴 수납·청구 P4-1).
 *  · 🔴 종전: 수납 미수금 탭 행 = 본인부담 전액 · 포털 '온라인 결제'는 없는 EP(pay-link)를 불러 늘 실패·감면 무시 · 모바일 미수 = 총진료비 − 납부
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { trOf } from '@/lib/i18n/portal-i18n';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('🔴 미수 표시 정본', () => {
  it('수납 미수금 탭 — 행·합계 폴백이 남은 본인부담(서버 outstanding → shared billingOutstanding)', () => {
    const s = src('src/app/(main)/billing/page.tsx');
    expect(s).toMatch(/formatCurrency\(outstandingOfItem\(item\)\)/);
    expect(s).not.toMatch(/items\.reduce\(\(s, i\) => s \+ \(i\.patientCopay \?\? 0\), 0\)/);
  });
  it('포털 — 없는 결제 링크 EP 를 부르지 않는다 · 감면·남은 금액 · 연동 없음 고지(환자 언어 카탈로그)', () => {
    const s = src('src/app/portal/_services/ServicesTab.tsx');
    expect(s).not.toMatch(/`\/api\/v1\/portal\/billings\/\$\{b\.id\}\/pay-link`/); // 주석의 원 결함 기록은 세지 않는다
    expect(s).toMatch(/data-portal-pay-unavailable/);
    expect(src('src/app/portal/page.tsx')).toMatch(/outstanding: billingOutstanding\(/);
    for (const k of ['감면', '남은 금액', '온라인 결제는 아직 연결되지 않았습니다 — 다음 방문 때 병원 창구에서 수납해 주세요.']) expect(trOf(k, 'en').missing, k).toBe(false);
  });
  it('모바일 — 미수 = 서버 outstanding(없으면 본인부담 − 감면 − 납부) · 총진료비로 세지 않는다', () => {
    const s = readFileSync(join(process.cwd(), '../mobile/app/(tabs)/billing-summary.tsx'), 'utf8');
    expect(s).not.toMatch(/b\.totalAmount - \(b\.paidAmount \?\? 0\)/);
    expect(s).toMatch(/b\.outstanding/);
  });
});
