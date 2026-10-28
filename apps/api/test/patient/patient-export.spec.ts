import { describe, it, expect, vi } from 'vitest';
import { PatientService } from '../../src/modules/patient/patient.service';

/**
 * 대량 반출 계약 — 2026-07-31.
 * 🔴 CSV 는 PHI 가 파일로 병원 밖에 나가는 지점이라 ①관리자만 ②상한 ③감사가 함께 걸려야 한다.
 *    (컨트롤러의 @Roles·감사는 라우팅 레벨, 여기서는 서비스의 상한·절단 표시를 고정한다)
 */
function build(rowCount: number) {
  const rows = Array.from({ length: rowCount }, (_, i) => ({ id: `p${i}`, mrn: `M${i}`, familyName: '김', givenName: `환자${i}` }));
  const prisma: any = { patient: { findMany: vi.fn().mockImplementation(({ take }: { take: number }) => Promise.resolve(rows.slice(0, take))) } };
  const config: any = { getOrThrow: () => '00'.repeat(32) };
  return { svc: new PatientService(prisma, config), prisma };
}

describe('exportList', () => {
  it('요청 상한만큼만 내보내고, 잘렸으면 truncated 로 알린다(조용한 일부 반출 금지)', async () => {
    const { svc } = build(20);
    const res = await svc.exportList({} as never, 10);
    expect(res.count).toBe(10);
    expect(res.truncated).toBe(true);
    expect(res.max).toBe(10);
  });

  it('상한 안이면 truncated=false', async () => {
    const { svc } = build(5);
    const res = await svc.exportList({} as never, 10);
    expect(res.count).toBe(5);
    expect(res.truncated).toBe(false);
  });

  it('🔴 호출부가 상한을 키워도 하드 상한(5000)을 넘지 못한다', async () => {
    const { svc, prisma } = build(3);
    await svc.exportList({} as never, 999_999);
    expect(prisma.patient.findMany.mock.calls[0][0].take).toBe(5001); // 5000 + 초과판별 1
  });

  it('절단 판별용으로 1건 더 읽되 응답에는 넣지 않는다', async () => {
    const { svc, prisma } = build(100);
    const res = await svc.exportList({} as never, 50);
    expect(prisma.patient.findMany.mock.calls[0][0].take).toBe(51);
    expect(res.data).toHaveLength(50);
  });
});
