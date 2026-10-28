import { describe, it, expect, vi } from 'vitest';
import { IssuanceService, receiptNumberOf } from '../../src/modules/medical-record-issuance/issuance.service';

/**
 * 원무 창구 접수 확장(2026-10-10) — 수령 방법·보낼 곳·대리 신청 대면 확인 기록·접수증·대기 목록 찾기.
 * 🔴 우편·팩스는 보낼 곳이 있어야 보낼 수 있다 · 대면 확인은 **기록**이지 진위 검증이 아니다(확인 안 했으면 PENDING 으로 남는다).
 */
function svc() {
  const created: any[] = [];
  const prisma: any = {
    patient: { findUnique: vi.fn(async () => ({ id: 'p1', mrn: 'M1', familyName: '김', givenName: '가' })) },
    systemConfig: { findUnique: vi.fn(async () => null) },
    documentRequest: {
      create: vi.fn(async (a: any) => { created.push(a.data); return { id: '1a2b3c4d-0000-4000-8000-000000000000', ...a.data, createdAt: new Date() }; }),
      findMany: vi.fn(async () => []), groupBy: vi.fn(async () => []), count: vi.fn(async () => 0),
    },
  };
  const audit = { safeLog: vi.fn(async () => undefined) };
  return { s: new IssuanceService(prisma, {} as never, audit as never, { emit: vi.fn() } as never, {} as never), prisma, created };
}
const base = { patientId: 'p1', type: 'DIAGNOSIS_CERT', legalBasis: 'SELF' };

describe('창구 접수 — 수령 방법·보낼 곳', () => {
  it('🔴 우편은 주소, 팩스는 번호가 있어야 한다(저장 0)', async () => {
    const { s, created } = svc();
    await expect(s.staffCreateRequest({ ...base, deliveryMethod: 'MAIL' }, 'u1')).rejects.toMatchObject({ response: { code: 'DELIVERY_ADDRESS_REQUIRED' } });
    await expect(s.staffCreateRequest({ ...base, deliveryMethod: 'FAX', deliveryDestination: '팩스 없음' }, 'u1')).rejects.toMatchObject({ response: { code: 'DELIVERY_FAX_INVALID' } });
    expect(created).toEqual([]);
  });
  it('보낼 곳은 우편·팩스일 때만 남긴다(방문·포털은 받아도 버린다)', async () => {
    const { s, created } = svc();
    await s.staffCreateRequest({ ...base, deliveryMethod: 'FAX', deliveryDestination: ' 02-000-1001 ' }, 'u1');
    await s.staffCreateRequest({ ...base, deliveryMethod: 'PORTAL', deliveryDestination: '가상시 어딘가 1' }, 'u1');
    expect(created[0]).toMatchObject({ deliveryMethod: 'FAX', deliveryDestination: '02-000-1001' });
    expect(created[1]).toMatchObject({ deliveryMethod: 'PORTAL', deliveryDestination: null });
  });
  it('수령 방법을 안 주면 방문(종전 동작)', async () => {
    const { s, created } = svc();
    await s.staffCreateRequest(base, 'u1');
    expect(created[0].deliveryMethod).toBe('VISIT');
  });
});

describe('대리 신청 — 대면 확인 기록', () => {
  it('🔴 확인했으면 확인자·시각 · 안 했으면 PENDING · 본인 신청은 손대지 않는다', async () => {
    const { s, created } = svc();
    await s.staffCreateRequest({ ...base, legalBasis: 'DELEGATED', identityChecked: true }, 'clerk');
    await s.staffCreateRequest({ ...base, legalBasis: 'BEREAVED' }, 'clerk');
    await s.staffCreateRequest({ ...base, identityChecked: true }, 'clerk');
    expect(created[0]).toMatchObject({ proxyVerifyStatus: 'VERIFIED', proxyVerifiedBy: 'clerk' });
    expect(created[0].proxyVerifiedAt).toBeInstanceOf(Date);
    expect(created[1]).toMatchObject({ proxyVerifyStatus: 'PENDING' });
    expect(created[1].proxyVerifiedBy).toBeUndefined();
    expect(created[2].proxyVerifyStatus).toBeUndefined();
  });
});

describe('접수증 · 대기 목록 찾기', () => {
  it('접수 응답에 접수번호(요청 id 앞 8자리)·환자·견적 표시', async () => {
    const { s } = svc();
    const r: any = await s.staffCreateRequest(base, 'u1');
    expect(r.receipt).toEqual({ number: '1A2B3C4D', feeIsEstimate: true });
    expect(r.patient).toEqual({ mrn: 'M1', name: '김가' });
    expect(receiptNumberOf('1a2b3c4d-0000-4000-8000-000000000000')).toBe('1A2B3C4D');
  });
  it('찾기 — 등록번호·이름·성+이름·접수번호(소문자 id 앞자리)', async () => {
    const { s, prisma } = svc();
    await s.staffQueue({ status: 'REQUESTED', q: '1A2B3C4D' });
    const or = prisma.documentRequest.findMany.mock.calls[0][0].where.OR;
    expect(or).toEqual(expect.arrayContaining([{ id: { startsWith: '1a2b3c4d' } }, { patient: { mrn: { contains: '1A2B3C4D', mode: 'insensitive' } } }]));
    await s.staffQueue({ q: '김가' });
    const or2 = prisma.documentRequest.findMany.mock.calls[1][0].where.OR;
    expect(or2).toEqual(expect.arrayContaining([{ patient: { familyName: { startsWith: '김' }, givenName: { startsWith: '가' } } }]));
    expect(or2.some((c: any) => c.id)).toBe(false);
  });
  it('대조군 — 찾는 말이 없으면 OR 를 걸지 않는다', async () => {
    const { s, prisma } = svc();
    await s.staffQueue({ status: 'REQUESTED', q: '  ' });
    expect(prisma.documentRequest.findMany.mock.calls[0][0].where.OR).toBeUndefined();
  });
});
