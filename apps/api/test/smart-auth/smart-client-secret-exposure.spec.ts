import { describe, it, expect, vi } from 'vitest';
import { SmartClientService } from '../../src/modules/smart-client/smart-client.service';

/**
 * 🔴 자격증명 해시 비노출 계약 — 2026-07-30 (프로드 실측에서 PATCH 응답이 clientSecret 해시를 반환).
 * 저장값이 해시라도 API 로 내보내면 오프라인 대입 표면이 되고, 종전 HS256 시절엔 그 값이 곧 서명키였다.
 * 평문은 **발급 응답에서 1회만** 나온다.
 */
function build() {
  const prisma: any = {
    smartClient: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ id: 'c1', isActive: true }),
      create: vi.fn().mockImplementation(({ select }: any) => Promise.resolve({ id: 'c1', clientId: 'x', ...(select ? {} : { clientSecret: 'HASH' }) })),
      update: vi.fn().mockResolvedValue({ id: 'c1' }),
      delete: vi.fn().mockResolvedValue({ id: 'c1' }),
    },
  };
  return { svc: new SmartClientService(prisma), prisma };
}

const noSecret = (call: any) => {
  expect(call.select).toBeDefined();
  expect(call.select.clientSecret).toBeUndefined();
};

describe('SmartClient 응답에서 시크릿 제외', () => {
  it('목록은 select 로 시크릿을 제외한다', async () => {
    const { svc, prisma } = build();
    await svc.findAll();
    noSecret(prisma.smartClient.findMany.mock.calls[0][0]);
  });

  it('수정·활성전환·삭제 응답도 시크릿을 담지 않는다', async () => {
    const { svc, prisma } = build();
    await svc.update('c1', { launchUrl: 'https://a.example/smart/launch' });
    await svc.toggle('c1');
    await svc.remove('c1');
    noSecret(prisma.smartClient.update.mock.calls[0][0]);
    noSecret(prisma.smartClient.update.mock.calls[1][0]);
    noSecret(prisma.smartClient.delete.mock.calls[0][0]);
  });

  it('발급은 평문 시크릿을 1회 반환하되 DB 조회 결과에서는 해시를 가져오지 않는다', async () => {
    const { svc, prisma } = build();
    const created: any = await svc.create({ name: 'app' });
    noSecret(prisma.smartClient.create.mock.calls[0][0]);
    expect(created.clientSecret).toMatch(/^[0-9a-f]{64}$/); // 평문(랜덤 32바이트)
  });
});
