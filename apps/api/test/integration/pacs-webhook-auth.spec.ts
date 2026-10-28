import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

import { IntegrationAuthService } from '../../src/modules/integration/integration-auth.service';

/**
 * PACS 웹훅 키 회귀 — 종전 구현은 시크릿 미구성 시 검증을 건너뛰어(fail-open) 무인증 개방이었음.
 * 판독 소견·오더 상태를 쓰는 인바운드이므로 fail-closed가 정본.
 */
describe('IntegrationAuthService.assertPacsWebhookKey', () => {
  let configMap: Record<string, unknown>;
  let service: IntegrationAuthService;
  const envBackup = process.env.PACS_WEBHOOK_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    configMap = {};
    delete process.env.PACS_WEBHOOK_SECRET;
    const config = { get: vi.fn(async (k: string) => configMap[k] ?? null) };
    service = new IntegrationAuthService(config as never);
  });

  it('시크릿 미구성이면 키를 보내도 거부한다 (fail-closed)', async () => {
    await expect(service.assertPacsWebhookKey('any')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.assertPacsWebhookKey(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('구성된 시크릿과 일치할 때만 통과한다', async () => {
    configMap['pacs.webhookSecret'] = 'S3CRET-VALUE';
    await expect(service.assertPacsWebhookKey('S3CRET-VALUE')).resolves.toBeUndefined();
    await expect(service.assertPacsWebhookKey('wrong')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.assertPacsWebhookKey(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('config 미설정 시 env PACS_WEBHOOK_SECRET로 폴백한다', async () => {
    process.env.PACS_WEBHOOK_SECRET = 'ENV-SECRET';
    await expect(service.assertPacsWebhookKey('ENV-SECRET')).resolves.toBeUndefined();
    await expect(service.assertPacsWebhookKey('wrong')).rejects.toBeInstanceOf(UnauthorizedException);
    if (envBackup === undefined) delete process.env.PACS_WEBHOOK_SECRET;
    else process.env.PACS_WEBHOOK_SECRET = envBackup;
  });

  it('길이가 다른 키는 상수시간 비교에서 거부된다', async () => {
    configMap['pacs.webhookSecret'] = 'SHORT';
    await expect(service.assertPacsWebhookKey('SHORT-BUT-LONGER')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
