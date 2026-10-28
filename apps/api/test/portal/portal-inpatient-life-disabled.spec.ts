/**
 * 환자 포털 입원 생활(식이·중간정산) — 병원 설정이 꺼져 있으면 고정 코드로 말한다(2026-10-19 사용자 신고).
 *  · 🔴 종전: 404 'Not Found' 하나 — 화면이 "기능 꺼짐(카드 없음)"과 "조회 실패"를 가를 수 없어 홈에 오류 카드가 떴다
 *  · 대조군: 켜져 있으면 이 코드로 막지 않는다
 */
import { describe, it, expect, vi } from 'vitest';
import { PortalService } from '../../src/modules/portal/portal.service';

const mk = (on: boolean) => {
  const svc = Object.create(PortalService.prototype) as any;
  svc.configRuntime = { get: vi.fn(async (k: string) => (k === 'portal.inpatientLife' ? on : undefined)) };
  svc.prisma = { admission: { findFirst: vi.fn().mockResolvedValue(null) } };
  return svc;
};

describe('🔴 입원 생활 꺼짐 — PORTAL_INPATIENT_LIFE_DISABLED', () => {
  it('꺼져 있으면 404 + 고정 코드(식이·중간정산 둘 다)', async () => {
    for (const m of ['getInpatientMeals', 'getInpatientInterimBill']) {
      const e: any = await mk(false)[m]('p1').catch((x: unknown) => x);
      expect(e.getStatus(), m).toBe(404);
      expect(e.getResponse(), m).toMatchObject({ code: 'PORTAL_INPATIENT_LIFE_DISABLED' });
    }
  });
  it('대조군 — 켜져 있으면 이 코드로 막지 않는다(활성 입원 없음은 다른 사유)', async () => {
    const e: any = await mk(true).getInpatientMeals('p1').catch((x: unknown) => x);
    expect(e?.getResponse?.()?.code).not.toBe('PORTAL_INPATIENT_LIFE_DISABLED');
  });
});
