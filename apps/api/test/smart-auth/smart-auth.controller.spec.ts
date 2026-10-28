import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { SmartAuthController } from '../../src/modules/smart-auth/smart-auth.controller';

describe('SmartAuthController', () => {
  let controller: SmartAuthController;
  let mockService: any;

  const mockTokenResponse = {
    access_token: 'mock-jwt',
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'patient/Patient.read',
  };

  beforeEach(() => {
    mockService = {
      issueToken: vi.fn().mockResolvedValue(mockTokenResponse),
      getSmartConfiguration: vi.fn().mockReturnValue({
        issuer: 'https://api.hospital.kr',
        token_endpoint: 'https://api.hospital.kr/oauth2/token',
        grant_types_supported: ['client_credentials'],
      }),
    };
    controller = new SmartAuthController(mockService);
  });

  describe('issueToken', () => {
    it('client_credentials grant로 토큰 발급', async () => {
      const result = await controller.issueToken({
        grant_type: 'client_credentials',
        client_id: 'test-client',
        client_secret: 'test-secret',
        scope: 'patient/Patient.read',
      });

      expect(result.access_token).toBe('mock-jwt');
      expect(mockService.issueToken).toHaveBeenCalledWith('test-client', 'test-secret', 'patient/Patient.read');
    });

    it('Basic Auth 지원', async () => {
      const basicAuth = Buffer.from('test-client:test-secret').toString('base64');
      await controller.issueToken(
        { grant_type: 'client_credentials' },
        `Basic ${basicAuth}`,
      );

      expect(mockService.issueToken).toHaveBeenCalledWith('test-client', 'test-secret', undefined);
    });

    it('grant_type 누락 시 401', async () => {
      await expect(controller.issueToken({ grant_type: 'authorization_code' })).rejects.toThrow(UnauthorizedException);
    });

    it('client_id/secret 누락 시 401', async () => {
      await expect(controller.issueToken({ grant_type: 'client_credentials' })).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('getSmartConfiguration', () => {
    it('.well-known/smart-configuration 반환', () => {
      const mockReq = { protocol: 'https', get: vi.fn().mockReturnValue('api.hospital.kr') } as any;
      const result = controller.getSmartConfiguration(mockReq);

      expect(result.issuer).toBe('https://api.hospital.kr');
      expect(result.grant_types_supported).toContain('client_credentials');
    });
  });
});
