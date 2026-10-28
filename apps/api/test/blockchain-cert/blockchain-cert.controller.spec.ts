import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { BlockchainCertController } from '../../src/modules/blockchain-cert/blockchain-cert.controller';

describe('BlockchainCertController', () => {
  let controller: BlockchainCertController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      issue: vi.fn(),
      getMyCerts: vi.fn(),
      getCertById: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
      renew: vi.fn(),
      suspend: vi.fn(),
      revoke: vi.fn(),
      restore: vi.fn(),
      getCrl: vi.fn(),
      verifyByFingerprint: vi.fn(),
      getAuditLog: vi.fn(),
      recordPinFail: vi.fn(),
      recordPinSuccess: vi.fn(),
      getStats: vi.fn(),
      getAllCerts: vi.fn(),
      getExpiringCerts: vi.fn(),
      issueForSelf: vi.fn(),
      requireOwnership: vi.fn(),
    };
    controller = new BlockchainCertController(mockService, { get: vi.fn(), set: vi.fn() } as never);
  });

  // 🔴 W7: 발급 명의를 본문에서 받던 것 — 토큰 사용자로 고정
  it('issue should ignore body-supplied identity and issue for the token user', async () => {
    const cert = { id: 'cert-1', status: 'ACTIVE' };
    mockService.issueForSelf.mockResolvedValue(cert);

    const result = await controller.issue(
      { ownerType: 'STAFF', userId: 'victim-1', subjectDn: 'CN=피해자', identityVerified: true, publicKey: 'pk', algorithm: 'RSA-2048' },
      'attacker-1',
    );

    expect(result).toEqual({ data: cert });
    expect(mockService.issue).not.toHaveBeenCalled();
    expect(mockService.issueForSelf).toHaveBeenCalledWith('attacker-1', {
      publicKey: 'pk',
      algorithm: 'RSA-2048',
      keyCustody: undefined,
      attestationRef: undefined,
    });
  });

  it('issue should accept FE 계약(publicKeyPem) as public key', async () => {
    mockService.issueForSelf.mockResolvedValue({ id: 'cert-1' });

    await controller.issue({ publicKeyPem: 'pem-key', algorithm: 'ECDSA-P256' }, 'user-1');

    expect(mockService.issueForSelf).toHaveBeenCalledWith('user-1', expect.objectContaining({ publicKey: 'pem-key' }));
  });

  it('issue should reject missing publicKey/algorithm', async () => {
    await expect(controller.issue({ algorithm: 'RSA-2048' }, 'user-1')).rejects.toThrow(BadRequestException);
    expect(mockService.issueForSelf).not.toHaveBeenCalled();
  });

  it('getMyCerts should return { data: result }', async () => {
    const certs = [{ id: 'cert-1' }];
    mockService.getMyCerts.mockResolvedValue(certs);

    const result = await controller.getMyCerts('user-1');

    expect(result).toEqual({ data: certs });
    expect(mockService.getMyCerts).toHaveBeenCalledWith('user-1');
  });

  it('getCrl should return { data: result }', async () => {
    const crl = [{ id: 'cert-1', status: 'REVOKED' }];
    mockService.getCrl.mockResolvedValue(crl);

    const result = await controller.getCrl();

    expect(result).toEqual({ data: crl });
  });

  it('getAuditLog should call service with filter params', async () => {
    const logResult = { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } };
    mockService.getAuditLog.mockResolvedValue(logResult);

    const result = await controller.getAuditLog('cert-1', 'user-1', 'ISSUED', 1, 50);

    expect(result).toEqual(logResult);
    expect(mockService.getAuditLog).toHaveBeenCalledWith({
      certificateId: 'cert-1',
      userId: 'user-1',
      eventType: 'ISSUED',
      page: 1,
      limit: 50,
    });
  });

  it('getStats should return { data: result }', async () => {
    const stats = { ACTIVE: 10, PENDING: 3 };
    mockService.getStats.mockResolvedValue(stats);

    const result = await controller.getStats();

    expect(result).toEqual({ data: stats });
  });

  it('getAllCerts should call service with filter params', async () => {
    const allResult = { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } };
    mockService.getAllCerts.mockResolvedValue(allResult);

    const result = await controller.getAllCerts('ACTIVE', 'STAFF', '김', 1, 50);

    expect(result).toEqual(allResult);
    expect(mockService.getAllCerts).toHaveBeenCalledWith({
      status: 'ACTIVE',
      ownerType: 'STAFF',
      search: '김',
      page: 1,
      limit: 50,
    });
  });

  it('getExpiringCerts should return { data: result }', async () => {
    const certs = [{ id: 'cert-1' }];
    mockService.getExpiringCerts.mockResolvedValue(certs);

    const result = await controller.getExpiringCerts(30);

    expect(result).toEqual({ data: certs });
    expect(mockService.getExpiringCerts).toHaveBeenCalledWith(30);
  });

  it('verifyByFingerprint should return { data: result }', async () => {
    const verifyResult = { valid: true, cert: { id: 'cert-1' }, isExpired: false };
    mockService.verifyByFingerprint.mockResolvedValue(verifyResult);

    const result = await controller.verifyByFingerprint('fp-abc');

    expect(result).toEqual({ data: verifyResult });
    expect(mockService.verifyByFingerprint).toHaveBeenCalledWith('fp-abc');
  });

  it('getCertById should return { data: result } for the owner', async () => {
    const cert = { id: 'cert-1', serialNumber: 'CERT-001' };
    mockService.getCertById.mockResolvedValue(cert);
    mockService.requireOwnership.mockResolvedValue({ id: 'cert-1', userId: 'user-1' });

    const result = await controller.getCertById('cert-1', 'user-1', UserRole.DOCTOR);

    expect(result).toEqual({ data: cert });
    expect(mockService.requireOwnership).toHaveBeenCalledWith('cert-1', 'user-1');
  });

  // 🔴 W7: 소유 무관 상세 열람(성명·MRN·면허번호) — 남의 것은 없는 것과 똑같이 404
  it('getCertById should 404 for a cert the caller does not own', async () => {
    mockService.requireOwnership.mockRejectedValue(new NotFoundException('인증서를 찾을 수 없습니다'));

    await expect(controller.getCertById('cert-1', 'other-user', UserRole.NURSE)).rejects.toThrow(NotFoundException);
    expect(mockService.getCertById).not.toHaveBeenCalled();
  });

  it('getCertById should skip ownership check for ADMIN', async () => {
    mockService.getCertById.mockResolvedValue({ id: 'cert-1' });

    await controller.getCertById('cert-1', 'admin-1', UserRole.ADMIN);

    expect(mockService.requireOwnership).not.toHaveBeenCalled();
  });

  it('approve should return { data: result }', async () => {
    const cert = { id: 'cert-1', status: 'ACTIVE' };
    mockService.approve.mockResolvedValue(cert);

    const result = await controller.approve('cert-1');

    expect(result).toEqual({ data: cert });
  });

  it('reject should return { data: result }', async () => {
    const cert = { id: 'cert-1', status: 'REVOKED' };
    mockService.reject.mockResolvedValue(cert);

    const result = await controller.reject('cert-1', { reason: '서류 미비' });

    expect(result).toEqual({ data: cert });
    expect(mockService.reject).toHaveBeenCalledWith('cert-1', '서류 미비');
  });

  it('renew should return { data: result } for the owner', async () => {
    const cert = { id: 'cert-2', previousCertId: 'cert-1' };
    mockService.renew.mockResolvedValue(cert);
    mockService.requireOwnership.mockResolvedValue({ id: 'cert-1', userId: 'user-1' });

    const result = await controller.renew('cert-1', { publicKey: 'new-pk' }, 'user-1');

    expect(result).toEqual({ data: cert });
    expect(mockService.requireOwnership).toHaveBeenCalledWith('cert-1', 'user-1');
    expect(mockService.renew).toHaveBeenCalledWith('cert-1', 'new-pk');
  });

  // 🔴 W7: 타인 인증서를 공격자 공개키로 재발급 = 명의 서명 위조
  it('renew should 404 (not renew) when the caller is not the owner', async () => {
    mockService.requireOwnership.mockRejectedValue(new NotFoundException('인증서를 찾을 수 없습니다'));

    await expect(controller.renew('cert-1', { publicKey: 'attacker-pk' }, 'attacker-1')).rejects.toThrow(NotFoundException);
    expect(mockService.renew).not.toHaveBeenCalled();
  });

  it('suspend should return { data: result }', async () => {
    const cert = { id: 'cert-1', status: 'SUSPENDED' };
    mockService.suspend.mockResolvedValue(cert);

    const result = await controller.suspend('cert-1');

    expect(result).toEqual({ data: cert });
  });

  it('revoke should return { data: result }', async () => {
    const cert = { id: 'cert-1', status: 'REVOKED' };
    mockService.revoke.mockResolvedValue(cert);

    const result = await controller.revoke('cert-1', { reason: '보안사고' });

    expect(result).toEqual({ data: cert });
    expect(mockService.revoke).toHaveBeenCalledWith('cert-1', '보안사고');
  });

  it('restore should return { data: result }', async () => {
    const cert = { id: 'cert-1', status: 'ACTIVE' };
    mockService.restore.mockResolvedValue(cert);

    const result = await controller.restore('cert-1');

    expect(result).toEqual({ data: cert });
  });

  it('recordPinFail should return { data: result } for the owner', async () => {
    const cert = { id: 'cert-1', pinFailCount: 3 };
    mockService.recordPinFail.mockResolvedValue(cert);
    mockService.requireOwnership.mockResolvedValue({ id: 'cert-1', userId: 'user-1' });

    const result = await controller.recordPinFail({ certId: 'cert-1' }, 'user-1');

    expect(result).toEqual({ data: cert });
    expect(mockService.requireOwnership).toHaveBeenCalledWith('cert-1', 'user-1');
  });

  // 🔴 W7: certId 만 알면 타인 인증서를 10회 호출로 SUSPENDED 시킬 수 있었다
  it('recordPinFail should 404 (not record) when the caller is not the owner', async () => {
    mockService.requireOwnership.mockRejectedValue(new NotFoundException('인증서를 찾을 수 없습니다'));

    await expect(controller.recordPinFail({ certId: 'cert-1' }, 'attacker-1')).rejects.toThrow(NotFoundException);
    expect(mockService.recordPinFail).not.toHaveBeenCalled();
  });

  it('recordPinSuccess should return { data: result } for the owner', async () => {
    const cert = { id: 'cert-1', pinFailCount: 0 };
    mockService.recordPinSuccess.mockResolvedValue(cert);
    mockService.requireOwnership.mockResolvedValue({ id: 'cert-1', userId: 'user-1' });

    const result = await controller.recordPinSuccess({ certId: 'cert-1' }, 'user-1');

    expect(result).toEqual({ data: cert });
    expect(mockService.requireOwnership).toHaveBeenCalledWith('cert-1', 'user-1');
  });

  // 🔴 W7: 남의 PIN 잠금 카운터를 리셋할 수 있었다
  it('recordPinSuccess should 404 (not reset) when the caller is not the owner', async () => {
    mockService.requireOwnership.mockRejectedValue(new NotFoundException('인증서를 찾을 수 없습니다'));

    await expect(controller.recordPinSuccess({ certId: 'cert-1' }, 'attacker-1')).rejects.toThrow(NotFoundException);
    expect(mockService.recordPinSuccess).not.toHaveBeenCalled();
  });
});
