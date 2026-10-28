import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SignIntegrationService } from '../../src/modules/sign-integration/sign-integration.service';

/**
 * e-sign #6 — 다중봉투 STAFF 서명자 certSerial 내부 주입(#2 (a)) 단위 테스트.
 * prepareSigners/resolveSignerUserId 는 private → (service as any) 로 호출.
 */
describe('SignIntegrationService.prepareSigners (STAFF 다자 certSerial 주입)', () => {
  let service: any;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      user: { findUnique: vi.fn() },
      staff: { findFirst: vi.fn() },
    };
    const cfg = { get: vi.fn().mockResolvedValue('EXTERNAL') };
    service = new SignIntegrationService(cfg as any, mockPrisma as any, {} as any, {} as any, {} as any, {} as any);
    // ensureStaffCert 무력화 — 해소된 userId 에 대해 고정 serial 반환
    vi.spyOn(service as any, 'ensureStaffCert').mockImplementation(async (uid: string) => ({ serialNumber: `SER-${uid}`, reused: true }));
  });

  const U = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  it('erp:staff:<empId> → Staff.erpEmployeeCode 역해소 후 certSerial 주입', async () => {
    mockPrisma.staff.findFirst.mockResolvedValue({ userId: U });
    const signers = [
      { displayName: '홍의사', channel: 'STAFF', signOrder: 1, signerType: 'STAFF', requiredIdentityLevel: 'STAFF_SSO', externalSignerRef: 'erp:staff:E1234' },
    ];

    const out = await (service as any).prepareSigners(signers);

    expect(mockPrisma.staff.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ erpEmployeeCode: 'E1234' }, { employeeNumber: 'E1234' }] } }),
    );
    expect(out[0].certSerial).toBe(`SER-${U}`);
    // externalSignerRef 이미 있으면 보존
    expect(out[0].externalSignerRef).toBe('erp:staff:E1234');
  });

  it('erp:staff:<empId> → erpEmployeeCode 미동기 시 employeeNumber 로 폴백 해소', async () => {
    // erpEmployeeCode 0건(운영 현황) 가정 — findFirst 가 OR(erpEmployeeCode|employeeNumber) 로 employeeNumber 매칭
    mockPrisma.staff.findFirst.mockResolvedValue({ userId: U });
    const out = await (service as any).prepareSigners([
      { channel: 'STAFF', signerType: 'STAFF', requiredIdentityLevel: 'STAFF_SSO', externalSignerRef: 'erp:staff:BF-2026-0007' },
    ]);
    expect(mockPrisma.staff.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ erpEmployeeCode: 'BF-2026-0007' }, { employeeNumber: 'BF-2026-0007' }] } }),
    );
    expect(out[0].certSerial).toBe(`SER-${U}`);
  });

  it('externalSignerRef 없고 userId(uuid) 제공 → 해소 + externalSignerRef=user.id 보정', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: U });
    const out = await (service as any).prepareSigners([
      { channel: 'STAFF', userId: U },
    ]);
    expect(out[0].certSerial).toBe(`SER-${U}`);
    expect(out[0].externalSignerRef).toBe(U); // 미러 키 정합
  });

  it('PORTAL 원소는 무변경(certSerial 미주입)', async () => {
    const portal = { displayName: '환자', channel: 'PORTAL', signOrder: 2, signerType: 'WITNESS_EXTERNAL', requiredIdentityLevel: 'NONE' };
    const out = await (service as any).prepareSigners([portal]);
    expect(out[0].certSerial).toBeUndefined();
    expect(mockPrisma.staff.findFirst).not.toHaveBeenCalled();
    expect((service as any).ensureStaffCert).not.toHaveBeenCalled();
  });

  it('STAFF인데 HIS User 미해소 → certSerial 미주입(원소 통과·throw 없음)', async () => {
    mockPrisma.staff.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const out = await (service as any).prepareSigners([
      { channel: 'STAFF', externalSignerRef: 'erp:staff:UNKNOWN' },
    ]);
    expect(out[0].certSerial).toBeUndefined();
    expect(out).toHaveLength(1);
  });

  it('이미 certSerial 있으면 재주입 안 함(멱등)', async () => {
    const out = await (service as any).prepareSigners([
      { channel: 'STAFF', externalSignerRef: 'erp:staff:E1', certSerial: 'PRESET' },
    ]);
    expect(out[0].certSerial).toBe('PRESET');
    expect((service as any).ensureStaffCert).not.toHaveBeenCalled();
  });

  it('requiredIdentityLevel=STAFF_SSO 만으로도 STAFF 판정', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: U });
    const out = await (service as any).prepareSigners([
      { requiredIdentityLevel: 'STAFF_SSO', email: 'doc@hospital.example.org' },
    ]);
    // email 경로 해소
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'doc@hospital.example.org' } }));
    expect(out[0].certSerial).toBe(`SER-${U}`);
  });

  it('비객체 원소는 그대로 통과', async () => {
    const out = await (service as any).prepareSigners(['raw', null, 42]);
    expect(out).toEqual(['raw', null, 42]);
  });
});

// e-sign #6 — 다자 봉투 portalUrl relay(Track 1) 정규화
describe('SignIntegrationService.normalizeSignersRelay', () => {
  let service: any;
  beforeEach(() => {
    service = new SignIntegrationService(
      { get: vi.fn() } as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
  });

  it('signers 부재(단일 응답) → null (단일 경로 회귀 0)', () => {
    expect((service as any).normalizeSignersRelay(undefined)).toBeNull();
    expect((service as any).normalizeSignersRelay(null)).toBeNull();
  });

  it('다자 응답 → per-signer relay(externalSignerRef 키·portalUrl 보존)', () => {
    const raw = [
      { participantId: 'p1', signOrder: 1, signerRole: 'DOCTOR', channel: 'STAFF', externalSignerRef: 'uid-1', portalUrl: undefined },
      { participantId: 'p2', signOrder: 2, signerRole: 'COSIGNER', channel: 'PORTAL', externalSignerRef: 'erp:cosigner:1', portalUrl: 'https://sign/portal/p2' },
    ];
    const out = (service as any).normalizeSignersRelay(raw);
    expect(out).toHaveLength(2);
    // STAFF 원소: portalUrl 없음(정상·발송 제외) — 키는 보존
    expect(out[0]).toEqual({ participantId: 'p1', signOrder: 1, signerRole: 'DOCTOR', channel: 'STAFF', externalSignerRef: 'uid-1', portalUrl: null });
    // PORTAL 원소: portalUrl relay
    expect(out[1]).toMatchObject({ externalSignerRef: 'erp:cosigner:1', portalUrl: 'https://sign/portal/p2' });
  });

  it('누락 필드는 null 정규화(인덱스 의존 금지·키만 신뢰)', () => {
    const out = (service as any).normalizeSignersRelay([{ portalUrl: 'u' }]);
    expect(out[0]).toEqual({ participantId: null, signOrder: null, signerRole: null, channel: null, externalSignerRef: null, portalUrl: 'u' });
  });
});
