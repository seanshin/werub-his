import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LisReferenceService } from '../../src/modules/lis-reference/lis-reference.service';

describe('LisReferenceService (LIS 참조)', () => {
  let svc: LisReferenceService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      eApprovalRelay: { findFirst: vi.fn() },
      consentForm: { findFirst: vi.fn() },
      patient: { findUnique: vi.fn(async () => ({ id: 'p1' })) }, // MRN 폴백 해소용(비uuid 식별자)
    };
    svc = new LisReferenceService(prisma as any);
  });

  it('getGateApproval — gateKey(refModule:refId) 분리 조회', async () => {
    prisma.eApprovalRelay.findFirst = vi.fn(async ({ where }: any) => {
      expect(where.refModule).toBe('lis.org_gate');
      expect(where.refId).toBe('g1');
      return { id: 'r1', docType: 'X', title: 't', status: 'APPROVED', result: 'APPROVED', decidedAt: new Date(), refModule: 'lis.org_gate', refId: 'g1', approvalLine: [{ order: 1, staffId: 's1', result: 'APPROVED' }] };
    });
    const r: any = await svc.getGateApproval('lis.org_gate:g1');
    expect(r.found).toBe(true);
    expect(r.docNumber).toBe('r1');
    expect(r.approvers).toHaveLength(1);
  });

  it('getGateApproval — gateKey 없으면 예외', async () => {
    await expect(svc.getGateApproval()).rejects.toThrow(/gateKey/);
  });

  it('getGateApproval — 없으면 found false', async () => {
    prisma.eApprovalRelay.findFirst = vi.fn(async () => null);
    const r: any = await svc.getGateApproval('refonly');
    expect(r.found).toBe(false);
  });

  it('getConsent — active 파생', async () => {
    prisma.consentForm.findFirst = vi.fn(async () => ({ id: 'c1', status: 'SIGNED', isValid: true, signedAt: new Date(), expiresAt: null }));
    const r: any = await svc.getConsent('p1');
    expect(r._derivedState).toBe('active');
    expect(r.status).toBe('active');
  });

  it('getConsent — withdrawn(REVOKED) 파생', async () => {
    prisma.consentForm.findFirst = vi.fn(async () => ({ id: 'c1', status: 'REVOKED', isValid: false, revokedAt: new Date() }));
    const r: any = await svc.getConsent('p1');
    expect(r._derivedState).toBe('withdrawn');
    expect(r.status).toBe('inactive');
  });

  it('getConsent — expired 파생', async () => {
    prisma.consentForm.findFirst = vi.fn(async () => ({ id: 'c1', status: 'SIGNED', isValid: true, signedAt: new Date(), expiresAt: new Date(Date.now() - 1000) }));
    const r: any = await svc.getConsent('p1');
    expect(r._derivedState).toBe('expired');
  });

  it('getConsent — 없으면 found false', async () => {
    prisma.consentForm.findFirst = vi.fn(async () => null);
    const r: any = await svc.getConsent('p1');
    expect(r.found).toBe(false);
  });

  it('getConsent — MRN 폴백: 비uuid 식별자는 MRN으로 해소 후 조회', async () => {
    prisma.patient.findUnique = vi.fn(async ({ where }: any) => {
      expect(where.mrn).toBe('HR24-0001');
      return { id: 'uuid-1' };
    });
    prisma.consentForm.findFirst = vi.fn(async ({ where }: any) => {
      expect(where.patientId).toBe('uuid-1');
      return { id: 'c1', status: 'SIGNED', isValid: true, signedAt: new Date(), expiresAt: null };
    });
    const r: any = await svc.getConsent('HR24-0001');
    expect(r._derivedState).toBe('active');
  });

  it('getConsent — 미존재 MRN은 found:false(500 방지)', async () => {
    prisma.patient.findUnique = vi.fn(async () => null);
    const r: any = await svc.getConsent('HR99-9999');
    expect(r.found).toBe(false);
    expect(prisma.consentForm.findFirst).not.toHaveBeenCalled();
  });

  it('getConsent — uuid 식별자는 MRN 해소 없이 직접 조회', async () => {
    prisma.consentForm.findFirst = vi.fn(async ({ where }: any) => {
      expect(where.patientId).toBe('abcdefab-1234-4abc-9def-abcdefabcdef');
      return null;
    });
    await svc.getConsent('abcdefab-1234-4abc-9def-abcdefabcdef');
    expect(prisma.patient.findUnique).not.toHaveBeenCalled();
  });
});
