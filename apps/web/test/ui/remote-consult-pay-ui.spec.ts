/**
 * 포털 비대면 진료 결제 화면(2026-10-14 결함 발굴 수납·청구 P3-1).
 *  · 🔴 종전: 카드·카카오페이 버튼 → 승인 없이 '결제 완료' · 결제 전 취소도 '전액 환불'이라 안내
 *  · 이제: 온라인 결제 연동이 없다는 사실을 말하고 후불 정산만 고른다 · 서버는 카드·카카오페이를 거부
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { trOf } from '@/lib/i18n/portal-i18n';

const src = readFileSync(join(process.cwd(), 'src/app/portal/_care/CareTab.tsx'), 'utf8');

describe('🔴 포털 비대면 진료 결제', () => {
  it('늘 실패할 카드·카카오페이 결제 버튼이 없다 · 연동 없음 고지 · 결제 수단 기본값 후불', () => {
    expect(src).not.toMatch(/payConsult\(p\.k\)/);
    expect(src).not.toMatch(/\{ k: 'CARD', label: '신용\/체크카드' \}/);
    expect(src).toMatch(/data-online-payment-unavailable/);
    expect(src).toMatch(/payConsult\('DEFERRED'\)/);
    expect(src).toMatch(/useState\('DEFERRED'\)/);
  });
  it('취소 안내가 결제 전에도 "전액 환불"이라 단정하지 않는다', () => {
    expect(src).not.toContain("'상담을 취소하시겠습니까? (전액 환불)'");
    expect(src).toContain('결제한 금액은 전액 환불');
  });
  it('새 고지 문구가 환자 언어 카탈로그에 있다', () => {
    for (const k of ['온라인 결제(카드·카카오페이)는 아직 연결되지 않았습니다 — 후불 정산을 고르시면 다음 방문 때 창구에서 수납합니다.', '후불 정산으로 기록되었습니다 — 다음 방문 때 창구에서 수납합니다.', '상담 취소 (답변 전 · 결제한 금액은 전액 환불)']) {
      expect(trOf(k, 'en').missing, k).toBe(false);
    }
  });
});
