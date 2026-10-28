import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BlockchainCertService } from '../../src/modules/blockchain-cert/blockchain-cert.service';

/**
 * W8 가드 — **발급일을 다른 컬럼으로 대체하지 않는다.**
 *
 * 🔴 원 결함: 환자 sign 인증서 현황의 '발급일'이 `patient.updatedAt` 이었다.
 *    환자 레코드를 아무거나(주소 한 줄) 수정하면 인증서 발급일이 오늘로 바뀐다 —
 *    인증서와 아무 관계 없는 시각을 법정 성격의 화면이 '발급일'이라 부르고 있었다.
 *    sign 이 발급한 인증서의 발급 시각이 HIS 에 없으면 정답은 **'미상'(null)** 이다.
 */
describe('W8 가드 — 인증서 발급일(모르면 미상)', () => {
  let service: BlockchainCertService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      patient: { findMany: vi.fn() },
      blockchainCertificate: { findMany: vi.fn().mockResolvedValue([]) },
    };
    service = new BlockchainCertService(prisma, { get: vi.fn().mockResolvedValue(true) } as any);
  });

  it('🔴 HIS 원장에 없는 serial 은 발급일을 null 로 낸다 — updatedAt 으로 때우지 않는다', async () => {
    prisma.patient.findMany.mockResolvedValue([
      { id: 'p1', familyName: '박', givenName: '환자', mrn: 'MRN001', signCertSerial: 'SIGN-XYZ' },
    ]);

    const r = await service.patientSignCerts();

    expect(r.patients[0].issuedAt).toBeNull();
  });

  it('환자 조회에 updatedAt 을 아예 select 하지 않는다(다시 새어들지 않게)', async () => {
    prisma.patient.findMany.mockResolvedValue([]);

    await service.patientSignCerts();

    const select = prisma.patient.findMany.mock.calls[0][0].select;
    expect(select.updatedAt).toBeUndefined();
  });

  it('HIS 원장에 같은 serial 이 있으면 그 issuedAt 만 쓴다', async () => {
    prisma.patient.findMany.mockResolvedValue([
      { id: 'p1', familyName: '박', givenName: '환자', mrn: 'MRN001', signCertSerial: 'CERT-1' },
    ]);
    prisma.blockchainCertificate.findMany.mockResolvedValue([
      { serialNumber: 'CERT-1', issuedAt: new Date('2026-03-02T01:00:00Z') },
    ]);

    const r = await service.patientSignCerts();

    expect(r.patients[0].issuedAt).toBe('2026-03-02T01:00:00.000Z');
  });
});
