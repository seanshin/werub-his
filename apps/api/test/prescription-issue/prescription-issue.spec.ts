import { describe, it, expect, vi } from 'vitest';
import { PrescriptionIssueService } from '../../src/modules/prescription-issue/prescription-issue.service';
import { DocumentService } from '../../src/modules/document/document.service';
import { OUTBOUND_CHANNELS } from '../../src/modules/outbound-channel/outbound-channel.registry';

/**
 * 처방전 발급 — 2026-09-30.
 *  🔴 종전 인쇄물: "이 처방전은 전자처방전입니다 · 하단 QR로 검증" — QR 없음·전송 없음·교부번호는 계산만(기록 없음).
 *  · 스냅샷은 서버가 DB 에서(화면이 보낸 내용을 해시하지 않는다) · 인쇄 대상과 같은 집합(원외 있으면 원외만)
 *  · 서명된 진료만 · 약 없으면 409 · 같은 내용 재인쇄 = 같은 번호 · 내용 변경 = 새 번호 + 이전 SUPERSEDED
 *  · 응답은 전송하지 않았다고 말한다 · 관제에 전송 채널이 '미구현'으로 보인다 · 공개 확인은 SUPERSEDED 를 무효로
 */
const rx = (id: string, over: Record<string, unknown> = {}) => ({ id, dosage: '1T', frequency: 'bid', duration: 3, quantity: 6, route: 'PO', dispensingType: 'EXTERNAL', rxValidUntil: new Date('2026-10-03T00:00:00Z'), medicationCode: { code: `C${id}`, nameKo: `약${id}` }, ...over });
function mk(o: { status?: string; rxs?: unknown[]; prior?: unknown[]; dx?: unknown[] } = {}) {
  const prisma = {
    encounter: { findUnique: vi.fn(async () => ({ id: 'e1', status: o.status ?? 'SIGNED', patientId: 'p1', doctorId: 'd1', doctor: { familyName: '이', givenName: '의사' }, diagnoses: o.dx ?? [{ diagnosisCode: { code: 'J00', nameKo: '급성 비인두염' } }], prescriptions: o.rxs ?? [rx('b'), rx('a'), rx('c', { dispensingType: 'INTERNAL' })] })) },
    issuedDocument: {
      findMany: vi.fn(async () => o.prior ?? []),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => ({ dateKey: '20260930', seq: 7 })),
    },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
  };
  const docs = { issue: vi.fn(async (dto: { snapshot: unknown }) => ({ issueNo: 'WRB-PRESCRIPTION-20260930-0007', status: 'ORIGINAL', issuedAt: new Date(), hash: 'h', qrUrl: 'u', qrDataUrl: 'q', dto })), verifyUrl: vi.fn(async () => ({ qrUrl: 'u', qrDataUrl: 'q' })) };
  return { svc: new PrescriptionIssueService(prisma as never, docs as never), prisma, docs };
}
const code = (e: unknown) => (e as { response?: { code?: string } })?.response?.code;

describe('발급', () => {
  it('서버가 만든 스냅샷(원외만·정렬) · 새 번호 · 전송하지 않았다고 말한다', async () => {
    const { svc, docs } = mk();
    const r = await svc.issue('e1', 'u1');
    const snap = (docs.issue.mock.calls[0] as unknown as [{ snapshot: { scope: string; items: { prescriptionId: string }[] }; documentType: string; sourceId: string }])[0];
    expect(snap.documentType).toBe('PRESCRIPTION');
    expect(snap.sourceId).toBe('e1');
    expect(snap.snapshot.scope).toBe('EXTERNAL');
    expect(snap.snapshot.items.map((i) => i.prescriptionId)).toEqual(['a', 'b']);
    expect(r).toMatchObject({ reused: false, itemCount: 2, dateKey: '20260930', seq: 7, transmission: { implemented: false, transmitted: false, transmittedAt: null, reason: 'CHANNEL_NOT_IMPLEMENTED' } });
  });
  it('같은 내용 재인쇄는 같은 번호(새로 발급하지 않는다)', async () => {
    const first = mk();
    const s1 = await first.svc.buildSnapshot('e1');
    const hash = (await import('crypto')).createHash('sha256').update(JSON.stringify(s1.snapshot)).digest('hex');
    const again = mk({ prior: [{ issueNo: 'WRB-PRESCRIPTION-20260930-0003', hash, dateKey: '20260930', seq: 3, issuedAt: new Date(), status: 'ORIGINAL' }] });
    const r = await again.svc.issue('e1', 'u1');
    expect(r).toMatchObject({ reused: true, issueNo: 'WRB-PRESCRIPTION-20260930-0003', seq: 3 });
    expect(again.docs.issue).not.toHaveBeenCalled();
  });
  it('내용이 바뀌면 새 번호 + 이전 발급은 SUPERSEDED(이전 종이가 진위 확인을 통과하지 않게)', async () => {
    const { svc, prisma } = mk({ prior: [{ issueNo: 'OLD-1', hash: 'different', dateKey: '20260930', seq: 1, issuedAt: new Date(), status: 'ORIGINAL' }] });
    const r = await svc.issue('e1', 'u1');
    expect(r.superseded).toEqual(['OLD-1']);
    expect(prisma.issuedDocument.updateMany).toHaveBeenCalledWith({ where: { issueNo: { in: ['OLD-1'] }, status: { in: ['ORIGINAL', 'REISSUE'] } }, data: { status: 'SUPERSEDED' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
  it('🔴 지난번 대체가 실패해 두 번호가 유효하게 남았어도, 같은 내용 재인쇄가 마저 대체한다(수렴)', async () => {
    const first = mk();
    const s1 = await first.svc.buildSnapshot('e1');
    const hash = (await import('crypto')).createHash('sha256').update(JSON.stringify(s1.snapshot)).digest('hex');
    const { svc, prisma } = mk({ prior: [
      { issueNo: 'NEW', hash, dateKey: '20260930', seq: 2, issuedAt: new Date(), status: 'ORIGINAL' },
      { issueNo: 'OLD', hash: 'different', dateKey: '20260930', seq: 1, issuedAt: new Date(), status: 'ORIGINAL' },
    ] });
    const r = await svc.issue('e1', 'u1');
    expect(r).toMatchObject({ reused: true, issueNo: 'NEW', superseded: ['OLD'] });
    expect((prisma.issuedDocument.updateMany.mock.calls[0] as unknown as [{ where: { issueNo: { in: string[] } } }])[0].where.issueNo.in).toEqual(['OLD']);
  });
  it('서명 전 진료·약 없음은 409 — 번호를 만들지 않는다 · 원외가 없으면 활성 약 전부(ALL)', async () => {
    const d = mk({ status: 'DRAFT' });
    await expect(d.svc.issue('e1', 'u1')).rejects.toSatisfy((e) => code(e) === 'ENCOUNTER_NOT_SIGNED');
    const n = mk({ rxs: [] });
    await expect(n.svc.issue('e1', 'u1')).rejects.toSatisfy((e) => code(e) === 'NO_PRESCRIPTION_ITEMS');
    expect(d.docs.issue).not.toHaveBeenCalled();
    expect(n.docs.issue).not.toHaveBeenCalled();
    const all = await mk({ rxs: [rx('a', { dispensingType: 'INTERNAL' })] }).svc.buildSnapshot('e1');
    expect(all.snapshot.scope).toBe('ALL');
  });
});

describe('관제·공개 확인', () => {
  it('전송 채널이 관제에 미구현으로 등재돼 있다', () => {
    const ch = OUTBOUND_CHANNELS.find((c) => c.key === 'EPRESCRIPTION');
    expect(ch).toMatchObject({ implemented: false });
    expect(ch?.manualFallback).toMatch(/종이|교부/);
  });
  it('공개 확인: SUPERSEDED 는 무효 · 기관명은 설정에서(없으면 null — 상수로 박지 않는다)', async () => {
    const mkDoc = (status: string, name: unknown) => new DocumentService({
      issuedDocument: { findUnique: vi.fn(async () => ({ issueNo: 'N', documentType: 'PRESCRIPTION', issuedAt: new Date(), status, hash: 'h' })) },
      systemConfig: { findUnique: vi.fn(async () => (name === undefined ? null : { value: name })) },
    } as never);
    expect((await mkDoc('SUPERSEDED', '테스트병원').verify('N')).valid).toBe(false);
    const ok = await mkDoc('ORIGINAL', '테스트병원').verify('N');
    expect(ok).toMatchObject({ valid: true, hospital: '테스트병원' });
    expect((await mkDoc('ORIGINAL', undefined).verify('N')).hospital).toBeNull();
  });
});

describe('🔴 (B2) 종이에 찍히는 것은 전부 발급 해시에', () => {
  it('지시사항·진단이 스냅샷에 · 지시사항만 바뀌어도 새 번호(이전 발급 SUPERSEDED) · 응답에 발급된 판', async () => {
    const a = mk({ rxs: [rx('a', { instructions: '식후 30분' })] });
    const r1 = await a.svc.issue('e1', 'u1');
    const s1 = (a.docs.issue.mock.calls[0] as unknown as [{ snapshot: { items: Array<{ instructions: string | null }>; diagnoses: unknown[] } }])[0].snapshot;
    expect(s1.items[0].instructions).toBe('식후 30분');
    expect(s1.diagnoses).toEqual([{ code: 'J00', name: '급성 비인두염' }]);
    expect((r1 as { snapshot: unknown }).snapshot).toEqual(s1);
    const { createHash } = await import('node:crypto');
    const h1 = createHash('sha256').update(JSON.stringify(s1)).digest('hex');
    const b = mk({ rxs: [rx('a', { instructions: '식전' })], prior: [{ issueNo: 'WRB-PRESCRIPTION-20260930-0001', hash: h1, status: 'ORIGINAL' }] });
    const r2 = await b.svc.issue('e1', 'u1');
    expect(r2).toMatchObject({ reused: false, superseded: ['WRB-PRESCRIPTION-20260930-0001'] });
    const c = mk({ rxs: [rx('a', { instructions: '식후 30분' })], prior: [{ issueNo: 'WRB-PRESCRIPTION-20260930-0001', hash: h1, status: 'ORIGINAL' }] });
    expect(await c.svc.issue('e1', 'u1')).toMatchObject({ reused: true }); // 대조군 — 같은 내용이면 같은 번호
  });
});

