import { describe, it, expect, vi } from 'vitest';
import { QiService } from '../../src/modules/qi/qi.service';

/**
 * 🔴 인증 근거 자동수집 (B3 · 2026-08-31).
 * 실측 근거 원천(evidenceSource)을 병기하되 🔴 **사람이 쓴 DB evidence 를 덮어쓰지 않는다**(클로버링 방지).
 * 🔴 자동으로 COMPLIANT 판정하지 않는다 — 링크만 단다.
 */
function svcWith(items: any[]) {
  const prisma: any = { accreditationItem: { findMany: vi.fn().mockResolvedValue(items) } };
  return new QiService(prisma);
}

describe('getAccreditationChecklist — 근거 병기', () => {
  it('🔴 DB evidence(사람 근거)를 보존하고 evidenceSource(실측 링크)를 별도로 단다', async () => {
    const svc = svcWith([
      { id: 'JCI-IPSG-4', standard: 'JCI', chapter: 'IPSG', name: '수술확인', status: 'PENDING', evidence: '심사자가 적은 근거' },
    ]);
    const r = await svc.getAccreditationChecklist();
    expect(r.available).toBe(true);
    const it = (r as any).items[0];
    expect(it.evidence, 'DB 근거가 덮어써졌다').toBe('심사자가 적은 근거');
    expect(it.evidenceSource?.source, 'IPSG-4 실측 근거 원천 미부착').toContain('surgery-safety');
  });

  it('🔴 근거 원천이 없는 항목은 evidenceSource=null(지어내지 않는다)', async () => {
    const svc = svcWith([
      { id: 'JCI-IPSG-3', standard: 'JCI', chapter: 'IPSG', name: '고위험약물', status: 'PENDING', evidence: null },
    ]);
    const r = await svc.getAccreditationChecklist();
    expect((r as any).items[0].evidenceSource).toBeNull();
  });

  it('🔴 판정(status)은 자동으로 바뀌지 않는다 — 근거만 병기(PENDING 유지)', async () => {
    const svc = svcWith([
      { id: 'JCI-IPSG-1', standard: 'JCI', chapter: 'IPSG', name: '환자확인', status: 'PENDING', evidence: null },
    ]);
    const r = await svc.getAccreditationChecklist();
    expect((r as any).items[0].status).toBe('PENDING');
  });
});
