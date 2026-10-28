import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { fakeRedis } from './fake-redis';
import { SmartAuthService } from '../../src/modules/smart-auth/smart-auth.service';
import { hashClientSecret } from '../../src/modules/smart-auth/smart-secret.util';

describe('SmartAuthService', () => {
  let service: SmartAuthService;
  let mockPrisma: any;
  let mockJwtService: any;

  const mockClient = {
    id: 'client-uuid',
    clientId: 'test-client-001',
    clientSecret: 'secret-abc-123',
    name: 'Test Client',
    orgId: 'org-uuid',
    scopes: ['patient/Patient.read', 'patient/Encounter.read'],
    isActive: true,
    lastUsedAt: null,
  };

  beforeEach(() => {
    mockPrisma = {
      smartClient: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };
    mockJwtService = {
      sign: vi.fn().mockReturnValue('mock-jwt-token'),
      verify: vi.fn(),
    };
    service = new SmartAuthService(mockPrisma, mockJwtService, {} as never, fakeRedis() as never);
  });

  describe('issueToken', () => {
    it('유효한 client_credentials로 토큰 발급', async () => {
      mockPrisma.smartClient.findUnique.mockResolvedValue(mockClient);
      mockPrisma.smartClient.update.mockResolvedValue(mockClient);

      const result = await service.issueToken('test-client-001', 'secret-abc-123');

      expect(result.access_token).toBe('mock-jwt-token');
      expect(result.token_type).toBe('Bearer');
      expect(result.expires_in).toBe(3600);
      expect(result.scope).toContain('patient/Patient.read');
      expect(mockJwtService.sign).toHaveBeenCalledWith(expect.objectContaining({
        sub: 'client-uuid',
        client_id: 'test-client-001',
        token_type: 'smart',
      }));
    });

    it('잘못된 client_id 시 401', async () => {
      mockPrisma.smartClient.findUnique.mockResolvedValue(null);

      await expect(service.issueToken('bad-id', 'secret')).rejects.toThrow(UnauthorizedException);
    });

    it('비활성 클라이언트 시 401', async () => {
      mockPrisma.smartClient.findUnique.mockResolvedValue({ ...mockClient, isActive: false });

      await expect(service.issueToken('test-client-001', 'secret-abc-123')).rejects.toThrow(UnauthorizedException);
    });

    it('잘못된 secret 시 401', async () => {
      mockPrisma.smartClient.findUnique.mockResolvedValue(mockClient);

      await expect(service.issueToken('test-client-001', 'wrong-secret')).rejects.toThrow(UnauthorizedException);
    });

    it('해시 저장된 시크릿 매치 — 업그레이드 없음', async () => {
      mockPrisma.smartClient.findUnique.mockResolvedValue({ ...mockClient, clientSecret: hashClientSecret('secret-abc-123') });
      mockPrisma.smartClient.update.mockResolvedValue(mockClient);
      const res = await service.issueToken('test-client-001', 'secret-abc-123');
      expect(res.access_token).toBe('mock-jwt-token');
      const secretUpgrades = mockPrisma.smartClient.update.mock.calls.filter((c: any) => c[0]?.data?.clientSecret);
      expect(secretUpgrades.length).toBe(0); // 이미 해시라 시크릿 업그레이드 없음(lastUsedAt만)
    });

    it('레거시 평문 시크릿 → 해시로 자동 업그레이드(lazy migration)', async () => {
      mockPrisma.smartClient.findUnique.mockResolvedValue({ ...mockClient, clientSecret: 'secret-abc-123' }); // 평문 저장분
      mockPrisma.smartClient.update.mockResolvedValue(mockClient);
      await service.issueToken('test-client-001', 'secret-abc-123');
      expect(mockPrisma.smartClient.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ clientSecret: hashClientSecret('secret-abc-123') }) }),
      );
    });

    it('요청 scope와 허가 scope 교차', async () => {
      mockPrisma.smartClient.findUnique.mockResolvedValue(mockClient);
      mockPrisma.smartClient.update.mockResolvedValue(mockClient);

      const result = await service.issueToken('test-client-001', 'secret-abc-123', 'patient/Patient.read patient/Observation.read');

      // patient/Observation.read는 허가 안됨
      expect(result.scope).toBe('patient/Patient.read');
    });

    it('유효 scope 없으면 401', async () => {
      mockPrisma.smartClient.findUnique.mockResolvedValue(mockClient);

      await expect(
        service.issueToken('test-client-001', 'secret-abc-123', 'patient/Observation.read'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('validateToken', () => {
    it('유효한 SMART 토큰 검증', async () => {
      const payload = { sub: 'client-uuid', client_id: 'test', scope: 'patient/Patient.read', token_type: 'smart' };
      mockJwtService.verify.mockReturnValue(payload);

      const result = await service.validateToken('valid-token');
      expect(result).toEqual(payload);
    });

    it('내부 JWT (token_type !== smart) 거부', async () => {
      mockJwtService.verify.mockReturnValue({ sub: 'user-uuid', token_type: undefined });

      await expect(service.validateToken('internal-token')).rejects.toThrow(UnauthorizedException);
    });

    it('만료된 토큰 거부', async () => {
      mockJwtService.verify.mockImplementation(() => { throw new Error('jwt expired'); });

      await expect(service.validateToken('expired-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('hasScope', () => {
    const payload = { sub: 'id', client_id: 'c', scope: 'patient/Patient.read patient/Encounter.read patient/*.write', token_type: 'smart' as const };

    it('정확한 scope 매칭', () => {
      expect(service.hasScope(payload, 'Patient', 'read')).toBe(true);
      expect(service.hasScope(payload, 'Encounter', 'read')).toBe(true);
    });

    it('와일드카드 write scope', () => {
      expect(service.hasScope(payload, 'Patient', 'write')).toBe(true);
      expect(service.hasScope(payload, 'Observation', 'write')).toBe(true);
    });

    it('없는 scope 거부', () => {
      expect(service.hasScope(payload, 'Observation', 'read')).toBe(false);
    });

    it('system/* (Backend Services) scope 인식', () => {
      const sys = { sub: 'id', client_id: 'lis', token_type: 'smart' as const,
        scope: 'system/DiagnosticReport.write system/Observation.write system/ServiceRequest.read system/Patient.read' };
      expect(service.hasScope(sys, 'DiagnosticReport', 'write')).toBe(true);
      expect(service.hasScope(sys, 'Observation', 'write')).toBe(true);
      expect(service.hasScope(sys, 'ServiceRequest', 'read')).toBe(true);
      expect(service.hasScope(sys, 'Patient', 'read')).toBe(true);
      // 미허가 조합 거부
      expect(service.hasScope(sys, 'DiagnosticReport', 'read')).toBe(false);
      expect(service.hasScope(sys, 'Patient', 'write')).toBe(false);
    });

    it('system/*.* 와일드카드', () => {
      const sys = { sub: 'id', client_id: 'lis', token_type: 'smart' as const, scope: 'system/*.*' };
      expect(service.hasScope(sys, 'DiagnosticReport', 'write')).toBe(true);
      expect(service.hasScope(sys, 'Patient', 'read')).toBe(true);
    });
  });

  describe('hasSystemScope (인구단위 판독 판정)', () => {
    it('system/* 만 true — patient/·user/ 는 false(환자컨텍스트 필요)', () => {
      const sys = { sub: 'i', client_id: 'c', token_type: 'smart' as const, scope: 'system/Observation.read' };
      expect(service.hasSystemScope(sys, 'Observation', 'read')).toBe(true);
      const pat = { sub: 'i', client_id: 'c', token_type: 'smart' as const, scope: 'patient/*.read' };
      expect(service.hasSystemScope(pat, 'Observation', 'read')).toBe(false); // patient/*는 hasScope엔 true지만 system 아님
      expect(service.hasScope(pat, 'Observation', 'read')).toBe(true);
      const usr = { sub: 'i', client_id: 'c', token_type: 'smart' as const, scope: 'user/*.read' };
      expect(service.hasSystemScope(usr, 'Observation', 'read')).toBe(false);
    });
  });

  describe('getSmartConfiguration', () => {
    it('SMART Configuration 반환', () => {
      const config = service.getSmartConfiguration('https://api.hospital.kr');

      expect(config.issuer).toBe('https://api.hospital.kr');
      expect(config.token_endpoint).toBe('https://api.hospital.kr/oauth2/token');
      expect(config.grant_types_supported).toContain('client_credentials');
      expect(config.scopes_supported.length).toBeGreaterThan(0);
    });
  });
});
