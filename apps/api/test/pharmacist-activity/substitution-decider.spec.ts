import { describe, it, expect, vi } from 'vitest';
import { PharmacyService } from '../../src/modules/pharmacy/pharmacy.service';

/**
 * 대체조제 판정자 칸 — 2026-09-30.
 *  🔴 종전엔 승인/거부 여부만 남아 누가(책임 처방의/관리자 대리)·언제·왜를 알 수 없었고 거부 사유가 약사에게 가지 않았다.
 *  · 판정자·시각·사유를 같은 조건부 갱신에 · 거부는 사유 필수(판정 전에 400 — 쓰지 않는다) · 승인 메모 선택
 *  · 같은 판정 재전송은 먼저 판정한 사람을 덮지 않는다 · 요청한 약사에게 인앱 알림(결과 {attempted,sent,reason})
 *  · 최근 판정 목록: 판정자가 책임 처방의 본인인지 · 판정자 칸 이전 건은 null(지어내지 않는다)
 */
function mk(status = 'REQUESTED', notifier: unknown = { notify: vi.fn(async () => undefined) }) {
  const row = { id: 'g1', status, pharmacistId: 'ph1', decisionNote: null as string | null, substituteMedication: { nameKo: '대체약' }, originalPrescription: { medicationCode: { nameKo: '원약' } } };
  const prisma = {
    genericSubstitution: {
      findUnique: vi.fn(async (a: { select?: unknown }) => (a.select ? { status } : row)),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { Object.assign(row, data); return { count: 1 }; }),
      findMany: vi.fn(async () => []),
    },
    user: { findMany: vi.fn(async () => []) },
  };
  const svc = new PharmacyService(prisma as never, {} as never, {} as never);
  (svc as unknown as { notifications: unknown }).notifications = notifier;
  return { svc, prisma, notifier: notifier as { notify: ReturnType<typeof vi.fn> } };
}
const code = (e: unknown) => (e as { response?: { code?: string } })?.response?.code;

describe('판정 — 누가·언제·왜', () => {
  it('승인: 판정자·시각을 같은 조건부 갱신에 · 메모는 선택 · 요청한 약사에게 알림', async () => {
    const { svc, prisma, notifier } = mk();
    const r = await svc.approveSubstitution('g1', 'doc1');
    const call = prisma.genericSubstitution.updateMany.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> };
    expect(call.where).toEqual({ id: 'g1', status: 'REQUESTED' });
    expect(call.data).toMatchObject({ status: 'APPROVED', doctorApproved: true, decidedById: 'doc1', decisionNote: null });
    expect(call.data.decidedAt).toBeInstanceOf(Date);
    expect(notifier.notify).toHaveBeenCalledWith('ph1', expect.objectContaining({ type: 'SUBSTITUTION_DECIDED', refId: 'g1' }));
    expect(r.pharmacistNotice).toEqual({ attempted: true, sent: true, reason: null });
  });
  it('🔴 거부는 사유 필수 — 빈 사유면 400 이고 쓰지 않는다 · 사유가 있으면 원장과 알림에 실린다', async () => {
    const a = mk();
    await expect(a.svc.rejectSubstitution('g1', 'doc1', '  ')).rejects.toSatisfy((e) => code(e) === 'SUBSTITUTION_REJECT_REASON_REQUIRED');
    expect(a.prisma.genericSubstitution.updateMany).not.toHaveBeenCalled();
    const b = mk();
    await b.svc.rejectSubstitution('g1', 'doc1', ' 원처방 유지 필요 ');
    expect((b.prisma.genericSubstitution.updateMany.mock.calls[0][0] as { data: Record<string, unknown> }).data).toMatchObject({ status: 'REJECTED', decisionNote: '원처방 유지 필요' });
    expect(b.notifier.notify.mock.calls[0][1]).toMatchObject({ severity: 'WARNING', message: expect.stringContaining('원처방 유지 필요') });
  });
  it('같은 판정 재전송은 먼저 판정한 사람·사유를 덮지 않는다(쓰지도 알리지도 않는다)', async () => {
    const { svc, prisma, notifier } = mk('APPROVED');
    await svc.approveSubstitution('g1', 'admin9', '다시');
    expect(prisma.genericSubstitution.updateMany).not.toHaveBeenCalled();
    expect(notifier.notify).not.toHaveBeenCalled();
  });
  it('알림 서비스가 없거나 실패해도 판정은 남고, 그 사실을 말한다', async () => {
    expect((await mk('REQUESTED', null).svc.approveSubstitution('g1', 'doc1')).pharmacistNotice).toEqual({ attempted: false, sent: false, reason: 'NO_NOTIFIER' });
    const f = mk('REQUESTED', { notify: vi.fn(async () => { throw new Error('x'); }) });
    const r = await f.svc.approveSubstitution('g1', 'doc1');
    expect(r.pharmacistNotice).toEqual({ attempted: true, sent: false, reason: 'FAILED' });
    expect(f.prisma.genericSubstitution.updateMany).toHaveBeenCalled();
  });
});

describe('최근 판정 목록 — 판정자 구분', () => {
  it('책임 처방의 본인 / 관리자 대리 / 판정자 칸 이전(null)', async () => {
    const { svc, prisma } = mk();
    const base = { status: 'APPROVED', decidedAt: new Date(), decisionNote: null, requestedAt: new Date(), originalPrescription: { prescriberId: 'doc1', createdBy: 'doc1' } };
    prisma.genericSubstitution.findMany.mockResolvedValue([
      { ...base, id: 's1', decidedById: 'doc1' },
      { ...base, id: 's2', decidedById: 'adm1' },
      { ...base, id: 's3', decidedById: null, decidedAt: null },
    ] as never);
    prisma.user.findMany.mockResolvedValue([{ id: 'doc1', familyName: '이', givenName: '의사', role: 'DOCTOR' }, { id: 'adm1', familyName: '관', givenName: '리', role: 'ADMIN' }] as never);
    const r = await svc.getDecidedSubstitutions();
    const by = Object.fromEntries(r.items.map((i) => [i.id, i.decidedBy]));
    expect(by.s1).toMatchObject({ name: '이의사', isPrescriber: true });
    expect(by.s2).toMatchObject({ role: 'ADMIN', isPrescriber: false });
    expect(by.s3).toBeNull();
    expect(r.windowDays).toBe(30);
  });
});
