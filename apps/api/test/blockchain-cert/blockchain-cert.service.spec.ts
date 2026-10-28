import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BlockchainCertService } from '../../src/modules/blockchain-cert/blockchain-cert.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { generateKeyPairSync } from 'node:crypto';
// 🔴 (2026-09-15 N2) 발급 입구가 SPKI 공개키만 받는다 — 픽스처도 실제 키를 쓴다(지어낸 'pk-test-123' 은 이제 400)
const rsaPem = () => generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
const PK = rsaPem();
const PK_NEW = rsaPem();

describe('BlockchainCertService', () => {
  let service: BlockchainCertService;
  let mockPrisma: any;

  const baseCert = {
    id: 'cert-1',
    ownerType: 'STAFF',
    userId: 'user-1',
    patientId: null,
    serialNumber: 'CERT-20260520-ABCD1234',
    subjectDn: 'CN=김의사',
    publicKey: PK,
    algorithm: 'RSA-2048',
    issuedAt: new Date('2026-01-01'),
    expiresAt: new Date('2027-01-01'),
    status: 'ACTIVE',
    licenseNumber: 'LIC-001',
    licenseType: '의사',
    department: '내과',
    specialty: '소화기내과',
    patientMrn: null,
    identityVerified: false,
    certHash: 'hash-abc',
    fingerprint: 'fp-abc',
    pinFailCount: 0,
    pinLockedUntil: null,
    revokedAt: null,
    revokeReason: null,
    previousCertId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockPrisma = {
      blockchainCertificate: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
        groupBy: vi.fn(),
      },
      certificateAuditLog: {
        create: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
      user: { findUnique: vi.fn() },
      staff: { findUnique: vi.fn() },
    };
    const mockConfigRuntime = { get: vi.fn().mockResolvedValue(true) };
    service = new BlockchainCertService(mockPrisma, mockConfigRuntime as any);
  });

  // ─── issue ────────────────────────────────────────────────────

  describe('issue', () => {
    const issueData = {
      ownerType: 'STAFF',
      userId: 'user-1',
      subjectDn: 'CN=김의사',
      publicKey: PK,
      algorithm: 'RSA-2048',
      expiresAt: new Date('2027-01-01'),
      licenseNumber: 'LIC-001',
    };

    it('🔴 지어낸 공개키(base64 "portal-patient-…")는 400 — 기존 인증서를 폐기하기 전에 거부', async () => {
      await expect(service.issue({ ...issueData, publicKey: Buffer.from('portal-patient-1').toString('base64') })).rejects.toThrow(BadRequestException);
      expect(mockPrisma.blockchainCertificate.update).not.toHaveBeenCalled();
      expect(mockPrisma.blockchainCertificate.create).not.toHaveBeenCalled();
    });

    it('should issue cert with ACTIVE status immediately', async () => {
      mockPrisma.blockchainCertificate.findFirst.mockResolvedValue(null);
      mockPrisma.blockchainCertificate.create.mockResolvedValue({ ...baseCert, status: 'ACTIVE' });
      mockPrisma.certificateAuditLog.create.mockResolvedValue({});

      const result = await service.issue(issueData);

      expect(result.status).toBe('ACTIVE');
      expect(mockPrisma.blockchainCertificate.create).toHaveBeenCalledTimes(1);
      const createArg = mockPrisma.blockchainCertificate.create.mock.calls[0][0].data;
      expect(createArg.status).toBe('ACTIVE');
    });

    it('should auto-revoke existing ACTIVE cert on new issue', async () => {
      mockPrisma.blockchainCertificate.findFirst.mockResolvedValue({ ...baseCert, id: 'old-cert' });
      mockPrisma.blockchainCertificate.update.mockResolvedValue({});
      mockPrisma.blockchainCertificate.create.mockResolvedValue({ ...baseCert, status: 'ACTIVE', previousCertId: 'old-cert' });
      mockPrisma.certificateAuditLog.create.mockResolvedValue({});

      const result = await service.issue(issueData);

      expect(result.status).toBe('ACTIVE');
      expect(mockPrisma.blockchainCertificate.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'old-cert' }, data: expect.objectContaining({ status: 'REVOKED' }) }),
      );
    });

    it('should issue patient cert with ACTIVE status', async () => {
      const patientData = { ...issueData, ownerType: 'PATIENT', patientId: 'patient-1' };
      mockPrisma.blockchainCertificate.findFirst.mockResolvedValue(null);
      mockPrisma.blockchainCertificate.create.mockResolvedValue({ ...baseCert, ownerType: 'PATIENT', status: 'ACTIVE' });
      mockPrisma.certificateAuditLog.create.mockResolvedValue({});

      const result = await service.issue(patientData);

      const createArg = mockPrisma.blockchainCertificate.create.mock.calls[0][0].data;
      expect(createArg.status).toBe('ACTIVE');
    });

    it('should generate serialNumber in CERT-YYYYMMDD-XXXX format', async () => {
      mockPrisma.blockchainCertificate.findFirst.mockResolvedValue(null);
      mockPrisma.blockchainCertificate.create.mockImplementation(({ data }: any) => data);
      mockPrisma.certificateAuditLog.create.mockResolvedValue({});

      const result = await service.issue(issueData);

      expect(result.serialNumber).toMatch(/^CERT-\d{8}-[A-F0-9]{8}$/);
    });

    it('should compute certHash and fingerprint as SHA-256 hex strings', async () => {
      mockPrisma.blockchainCertificate.findFirst.mockResolvedValue(null);
      mockPrisma.blockchainCertificate.create.mockImplementation(({ data }: any) => data);
      mockPrisma.certificateAuditLog.create.mockResolvedValue({});

      const result = await service.issue(issueData);

      expect(result.certHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should write ISSUED audit log', async () => {
      mockPrisma.blockchainCertificate.findFirst.mockResolvedValue(null);
      mockPrisma.blockchainCertificate.create.mockImplementation(({ data }: any) => ({ ...data, id: 'cert-new' }));
      mockPrisma.certificateAuditLog.create.mockResolvedValue({});

      await service.issue(issueData);

      expect(mockPrisma.certificateAuditLog.create).toHaveBeenCalled();
      const lastLog = mockPrisma.certificateAuditLog.create.mock.calls.at(-1)[0].data;
      expect(lastLog.eventType).toBe('ISSUED');
      expect(lastLog.certificateId).toBe('cert-new');
    });
  });

  // ─── getMyCerts ───────────────────────────────────────────────

  describe('getMyCerts', () => {
    it('should return user certs ordered by createdAt desc', async () => {
      const certs = [baseCert, { ...baseCert, id: 'cert-2' }];
      mockPrisma.blockchainCertificate.findMany.mockResolvedValue(certs);

      const result = await service.getMyCerts('user-1');

      expect(result).toHaveLength(2);
      expect(mockPrisma.blockchainCertificate.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array for user with no certs', async () => {
      mockPrisma.blockchainCertificate.findMany.mockResolvedValue([]);

      const result = await service.getMyCerts('user-none');

      expect(result).toEqual([]);
    });
  });

  // ─── issueForSelf / requireOwnership (🔴 W7 인가 봉합) ─────────

  describe('issueForSelf', () => {
    it('should take identity from the token user, not from the request body', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1', familyName: '김', givenName: '의사', role: 'DOCTOR', department: '내과', specialty: null,
      });
      mockPrisma.staff.findUnique.mockResolvedValue({ licenseNumber: 'LIC-001', department: '내과', specialty: '소화기내과', position: '전문의' });
      mockPrisma.blockchainCertificate.findFirst.mockResolvedValue(null);
      mockPrisma.blockchainCertificate.create.mockImplementation(({ data }: any) => ({ ...data, id: 'cert-new' }));
      mockPrisma.certificateAuditLog.create.mockResolvedValue({});

      const result = await service.issueForSelf('user-1', { publicKey: PK, algorithm: 'RSA-2048' });

      expect(result.userId).toBe('user-1');
      expect(result.ownerType).toBe('STAFF');
      expect(result.subjectDn).toContain('김의사');
      // 면허번호는 Staff 정본에서만 — 요청 본문 자기신고 금지
      expect(result.licenseNumber).toBe('LIC-001');
      // 자체발급 경로는 본인확인을 증명하지 않는다 → 세우지 않는다
      expect(result.identityVerified).toBeUndefined();
    });

    it('should leave licenseNumber empty when no Staff record exists (추정 금지)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-2', familyName: '박', givenName: '간호', role: 'NURSE', department: null, specialty: null,
      });
      mockPrisma.staff.findUnique.mockResolvedValue(null);
      mockPrisma.blockchainCertificate.findFirst.mockResolvedValue(null);
      mockPrisma.blockchainCertificate.create.mockImplementation(({ data }: any) => ({ ...data, id: 'cert-new' }));
      mockPrisma.certificateAuditLog.create.mockResolvedValue({});

      const result = await service.issueForSelf('user-2', { publicKey: PK, algorithm: 'RSA-2048' });

      expect(result.licenseNumber).toBeUndefined();
      expect(result.subjectDn).toContain('NURSE'); // 부서가 없으면 역할로 대체
    });

    it('should throw NotFoundException for an unknown user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.issueForSelf('ghost', { publicKey: PK, algorithm: 'RSA-2048' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('requireOwnership', () => {
    it('should return the cert for its owner', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue({ id: 'cert-1', userId: 'user-1' });

      await expect(service.requireOwnership('cert-1', 'user-1')).resolves.toEqual({ id: 'cert-1', userId: 'user-1' });
    });

    it('should answer 404 identically for a missing cert and someone else’s cert', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue(null);
      const missing = await service.requireOwnership('cert-x', 'user-1').catch((e) => e);

      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue({ id: 'cert-1', userId: 'victim-1' });
      const foreign = await service.requireOwnership('cert-1', 'attacker-1').catch((e) => e);

      expect(missing).toBeInstanceOf(NotFoundException);
      expect(foreign).toBeInstanceOf(NotFoundException);
      expect(foreign.message).toBe(missing.message); // 존재 여부를 알려주지 않는다
    });

    it('should reject patient certs for a staff caller (userId null)', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue({ id: 'cert-p', userId: null });

      await expect(service.requireOwnership('cert-p', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getCertById ──────────────────────────────────────────────

  describe('getCertById', () => {
    it('should return cert with relations', async () => {
      const certWithRelations = { ...baseCert, previousCert: null, renewedBy: [], user: null, patient: null };
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue(certWithRelations);

      const result = await service.getCertById('cert-1');

      expect(result.id).toBe('cert-1');
      expect(mockPrisma.blockchainCertificate.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cert-1' },
          include: expect.objectContaining({ previousCert: true, renewedBy: true }),
        }),
      );
    });

    it('should throw NotFoundException if cert not found', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue(null);

      await expect(service.getCertById('not-exist')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── approve ──────────────────────────────────────────────────

  describe('approve (deprecated no-op)', () => {
    it('should return existing cert (no-op)', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue({ ...baseCert, status: 'ACTIVE' });

      const result = await service.approve('cert-1');

      expect(result.status).toBe('ACTIVE');
    });
  });

  // ─── reject ───────────────────────────────────────────────────

  describe('reject', () => {
    it('should set status to REVOKED with reason', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue(baseCert);
      mockPrisma.blockchainCertificate.update.mockResolvedValue({ ...baseCert, status: 'REVOKED', revokeReason: '서류 미비' });
      mockPrisma.certificateAuditLog.create.mockResolvedValue({});

      const result = await service.reject('cert-1', '서류 미비');

      expect(result.status).toBe('REVOKED');
      const updateArg = mockPrisma.blockchainCertificate.update.mock.calls[0][0].data;
      expect(updateArg.revokeReason).toBe('서류 미비');
    });

    it('should write REVOKED audit log with reason (reject delegates to revoke)', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue(baseCert);
      mockPrisma.blockchainCertificate.update.mockResolvedValue({ ...baseCert, status: 'REVOKED' });
      mockPrisma.certificateAuditLog.create.mockResolvedValue({});

      await service.reject('cert-1', '서류 미비');

      const logArg = mockPrisma.certificateAuditLog.create.mock.calls[0][0].data;
      expect(logArg.eventType).toBe('REVOKED');
      expect(logArg.eventDetail).toEqual({ reason: '서류 미비' });
    });
  });

  // ─── renew ────────────────────────────────────────────────────

  describe('renew', () => {
    it('should create new cert via issue (auto-revokes old)', async () => {
      // findUnique for requireCert
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue({ ...baseCert, status: 'ACTIVE' });
      // findFirst in issue finds the old cert
      mockPrisma.blockchainCertificate.findFirst.mockResolvedValue({ ...baseCert, id: 'cert-1' });
      // update for revoking old cert
      mockPrisma.blockchainCertificate.update.mockResolvedValue({ ...baseCert, status: 'REVOKED' });
      mockPrisma.blockchainCertificate.create.mockImplementation(({ data }: any) => ({ ...data, id: 'cert-new' }));
      mockPrisma.certificateAuditLog.create.mockResolvedValue({});

      const result = await service.renew('cert-1', PK_NEW);

      expect(result.previousCertId).toBe('cert-1');
      expect(result.publicKey).toBe(PK_NEW);
      expect(result.status).toBe('ACTIVE');
    });
  });

  // ─── suspend ──────────────────────────────────────────────────

  describe('suspend', () => {
    it('should set status to SUSPENDED', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue({ ...baseCert, status: 'ACTIVE' });
      mockPrisma.blockchainCertificate.update.mockResolvedValue({ ...baseCert, status: 'SUSPENDED' });
      mockPrisma.certificateAuditLog.create.mockResolvedValue({});

      const result = await service.suspend('cert-1');

      expect(result.status).toBe('SUSPENDED');
    });

    it('should reject non-ACTIVE cert', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue({ ...baseCert, status: 'PENDING' });

      await expect(service.suspend('cert-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── revoke ───────────────────────────────────────────────────

  describe('revoke', () => {
    it('should set status to REVOKED with timestamp and reason', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue(baseCert);
      mockPrisma.blockchainCertificate.update.mockResolvedValue({ ...baseCert, status: 'REVOKED', revokeReason: '보안사고' });
      mockPrisma.certificateAuditLog.create.mockResolvedValue({});

      const result = await service.revoke('cert-1', '보안사고');

      expect(result.status).toBe('REVOKED');
      const updateArg = mockPrisma.blockchainCertificate.update.mock.calls[0][0].data;
      expect(updateArg.revokedAt).toBeInstanceOf(Date);
      expect(updateArg.revokeReason).toBe('보안사고');
    });

    it('should write REVOKED audit log', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue(baseCert);
      mockPrisma.blockchainCertificate.update.mockResolvedValue({ ...baseCert, status: 'REVOKED' });
      mockPrisma.certificateAuditLog.create.mockResolvedValue({});

      await service.revoke('cert-1', '보안사고');

      const logArg = mockPrisma.certificateAuditLog.create.mock.calls[0][0].data;
      expect(logArg.eventType).toBe('REVOKED');
    });
  });

  // ─── restore ──────────────────────────────────────────────────

  describe('restore', () => {
    it('should set ACTIVE from SUSPENDED', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue({ ...baseCert, status: 'SUSPENDED' });
      mockPrisma.blockchainCertificate.update.mockResolvedValue({ ...baseCert, status: 'ACTIVE' });
      mockPrisma.certificateAuditLog.create.mockResolvedValue({});

      const result = await service.restore('cert-1');

      expect(result.status).toBe('ACTIVE');
    });

    it('should reject non-SUSPENDED cert', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue({ ...baseCert, status: 'ACTIVE' });

      await expect(service.restore('cert-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── getCrl ───────────────────────────────────────────────────

  describe('getCrl', () => {
    it('should return REVOKED and SUSPENDED certs', async () => {
      const crlCerts = [
        { id: 'c1', serialNumber: 'CERT-001', status: 'REVOKED', fingerprint: 'fp1' },
        { id: 'c2', serialNumber: 'CERT-002', status: 'SUSPENDED', fingerprint: 'fp2' },
      ];
      mockPrisma.blockchainCertificate.findMany.mockResolvedValue(crlCerts);

      const result = await service.getCrl();

      expect(result).toHaveLength(2);
      expect(mockPrisma.blockchainCertificate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: { in: ['REVOKED', 'SUSPENDED'] } },
        }),
      );
    });
  });

  // ─── verifyByFingerprint ──────────────────────────────────────

  describe('verifyByFingerprint', () => {
    it('should return valid=true for ACTIVE cert', async () => {
      mockPrisma.blockchainCertificate.findFirst.mockResolvedValue({
        ...baseCert,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      });

      const result = await service.verifyByFingerprint('fp-abc');

      expect(result.valid).toBe(true);
    });

    it('should return valid=false for revoked cert', async () => {
      mockPrisma.blockchainCertificate.findFirst.mockResolvedValue({
        ...baseCert,
        status: 'REVOKED',
      });

      const result = await service.verifyByFingerprint('fp-abc');

      expect(result.valid).toBe(false);
    });

    it('should return valid=false when not found', async () => {
      mockPrisma.blockchainCertificate.findFirst.mockResolvedValue(null);

      const result = await service.verifyByFingerprint('fp-unknown');

      expect(result.valid).toBe(false);
      expect(result.message).toBeDefined();
    });
  });

  // ─── getAuditLog ──────────────────────────────────────────────

  describe('getAuditLog', () => {
    it('should return paginated audit logs', async () => {
      const logs = [{ id: 'log-1', eventType: 'ISSUED' }];
      mockPrisma.certificateAuditLog.findMany.mockResolvedValue(logs);
      mockPrisma.certificateAuditLog.count.mockResolvedValue(1);

      const result = await service.getAuditLog({ page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.totalPages).toBe(1);
    });

    it('should apply filters (certificateId, userId, eventType)', async () => {
      mockPrisma.certificateAuditLog.findMany.mockResolvedValue([]);
      mockPrisma.certificateAuditLog.count.mockResolvedValue(0);

      await service.getAuditLog({ certificateId: 'cert-1', userId: 'user-1', eventType: 'ISSUED' });

      const where = mockPrisma.certificateAuditLog.findMany.mock.calls[0][0].where;
      expect(where.certificateId).toBe('cert-1');
      expect(where.userId).toBe('user-1');
      expect(where.eventType).toBe('ISSUED');
    });
  });

  // ─── recordPinFail ────────────────────────────────────────────

  describe('recordPinFail', () => {
    it('should increment count and write PIN_FAILED log when under 5', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue({ ...baseCert, pinFailCount: 2 });
      mockPrisma.blockchainCertificate.update.mockResolvedValue({ ...baseCert, pinFailCount: 3 });
      mockPrisma.certificateAuditLog.create.mockResolvedValue({});

      await service.recordPinFail('cert-1');

      const updateData = mockPrisma.blockchainCertificate.update.mock.calls[0][0].data;
      expect(updateData.pinFailCount).toBe(3);
      const logArg = mockPrisma.certificateAuditLog.create.mock.calls[0][0].data;
      expect(logArg.eventType).toBe('PIN_FAILED');
    });

    it('should lock for 10 minutes at 5 failures and write PIN_LOCKED log', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue({ ...baseCert, pinFailCount: 4 });
      mockPrisma.blockchainCertificate.update.mockResolvedValue({ ...baseCert, pinFailCount: 5 });
      mockPrisma.certificateAuditLog.create.mockResolvedValue({});

      await service.recordPinFail('cert-1');

      const updateData = mockPrisma.blockchainCertificate.update.mock.calls[0][0].data;
      expect(updateData.pinFailCount).toBe(5);
      expect(updateData.pinLockedUntil).toBeInstanceOf(Date);
      const logArg = mockPrisma.certificateAuditLog.create.mock.calls[0][0].data;
      expect(logArg.eventType).toBe('PIN_LOCKED');
    });

    it('should SUSPEND at 10 failures and write PIN_LOCKED log with action', async () => {
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue({ ...baseCert, pinFailCount: 9 });
      mockPrisma.blockchainCertificate.update.mockResolvedValue({ ...baseCert, pinFailCount: 10, status: 'SUSPENDED' });
      mockPrisma.certificateAuditLog.create.mockResolvedValue({});

      await service.recordPinFail('cert-1');

      const updateData = mockPrisma.blockchainCertificate.update.mock.calls[0][0].data;
      expect(updateData.pinFailCount).toBe(10);
      expect(updateData.status).toBe('SUSPENDED');
      const logArg = mockPrisma.certificateAuditLog.create.mock.calls[0][0].data;
      expect(logArg.eventDetail.action).toBe('SUSPENDED');
    });

    it('should calculate correct lockout time (10 min from now)', async () => {
      const now = Date.now();
      mockPrisma.blockchainCertificate.findUnique.mockResolvedValue({ ...baseCert, pinFailCount: 6 });
      mockPrisma.blockchainCertificate.update.mockResolvedValue({});
      mockPrisma.certificateAuditLog.create.mockResolvedValue({});

      await service.recordPinFail('cert-1');

      const updateData = mockPrisma.blockchainCertificate.update.mock.calls[0][0].data;
      const lockTime = updateData.pinLockedUntil.getTime();
      // Should be ~10 minutes from now (allow 5 second tolerance)
      expect(lockTime).toBeGreaterThan(now + 9 * 60 * 1000);
      expect(lockTime).toBeLessThan(now + 11 * 60 * 1000);
    });
  });

  // ─── recordPinSuccess ─────────────────────────────────────────

  describe('recordPinSuccess', () => {
    it('should reset pinFailCount to 0 and clear pinLockedUntil', async () => {
      mockPrisma.blockchainCertificate.update.mockResolvedValue({ ...baseCert, pinFailCount: 0, pinLockedUntil: null });

      const result = await service.recordPinSuccess('cert-1');

      expect(mockPrisma.blockchainCertificate.update).toHaveBeenCalledWith({
        where: { id: 'cert-1' },
        data: { pinFailCount: 0, pinLockedUntil: null },
      });
    });
  });

  // ─── getStats ─────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return grouped stats by status', async () => {
      mockPrisma.blockchainCertificate.groupBy.mockResolvedValue([
        { status: 'ACTIVE', _count: { id: 10 } },
        { status: 'PENDING', _count: { id: 3 } },
        { status: 'REVOKED', _count: { id: 2 } },
      ]);

      const result = await service.getStats();

      expect(result).toEqual({ ACTIVE: 10, PENDING: 3, REVOKED: 2 });
    });
  });

  // ─── getAllCerts ───────────────────────────────────────────────

  describe('getAllCerts', () => {
    it('should return paginated results', async () => {
      const certs = [baseCert];
      mockPrisma.blockchainCertificate.findMany.mockResolvedValue(certs);
      mockPrisma.blockchainCertificate.count.mockResolvedValue(1);

      const result = await service.getAllCerts({ page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
    });

    it('should apply search filter on serialNumber and subjectDn', async () => {
      mockPrisma.blockchainCertificate.findMany.mockResolvedValue([]);
      mockPrisma.blockchainCertificate.count.mockResolvedValue(0);

      await service.getAllCerts({ search: '김의사' });

      const where = mockPrisma.blockchainCertificate.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { serialNumber: { contains: '김의사', mode: 'insensitive' } },
        { subjectDn: { contains: '김의사', mode: 'insensitive' } },
      ]);
    });
  });

  // ─── getExpiringCerts ─────────────────────────────────────────

  describe('getExpiringCerts', () => {
    it('should return empty array (certs are now effectively permanent)', async () => {
      const result = await service.getExpiringCerts(30);

      expect(result).toEqual([]);
    });
  });
});
