import { describe, it, expect, vi } from 'vitest';
import { DocumentService } from '../../src/modules/document/document.service';

// 발급번호 채번: MAX(seq)+1(단조). count+1이면 삭제 시 번호 재사용→issueNo 충돌(외부 sign 멱등키 오염).
describe('DocumentService.issue — 채번 단조성(MAX+1)', () => {
  const build = (maxSeq: number | null) => {
    const create = vi.fn().mockImplementation(({ data }: any) =>
      Promise.resolve({ issueNo: data.issueNo, status: 'ORIGINAL', issuedAt: new Date('2026-06-28T00:00:00Z'), hash: data.hash }));
    const aggregate = vi.fn().mockResolvedValue({ _max: { seq: maxSeq } });
    const prisma: any = { issuedDocument: { aggregate, create } };
    return { svc: new DocumentService(prisma), create, aggregate };
  };

  it('기존 최대 seq=5(삭제로 count=2여도) → 다음 seq=6', async () => {
    const { svc, create } = build(5);
    await svc.issue({ documentType: 'ERP_MEDICAL_CONTRACT', sourceId: '7', snapshot: {} } as any);
    expect(create.mock.calls[0][0].data.seq).toBe(6);
    expect(create.mock.calls[0][0].data.issueNo).toMatch(/-0006$/);
  });

  it('당일 발급 이력 없음(max=null) → seq=1', async () => {
    const { svc, create } = build(null);
    await svc.issue({ documentType: 'CONSENT', sourceId: 's', snapshot: {} } as any);
    expect(create.mock.calls[0][0].data.seq).toBe(1);
  });

  it('count 가 아니라 aggregate(_max)로 채번(삭제 내성)', async () => {
    const { svc, aggregate } = build(3);
    await svc.issue({ documentType: 'CONSENT', sourceId: 's', snapshot: {} } as any);
    expect(aggregate).toHaveBeenCalledWith(expect.objectContaining({ _max: { seq: true } }));
  });
});
