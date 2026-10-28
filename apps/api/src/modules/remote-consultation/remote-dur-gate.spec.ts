import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { RemoteConsultationService } from './remote-consultation.service';

/**
 * 원격 DUR 게이트 회귀 — 원격 처방도 DUR ERROR 시 dur.enforce 모드별 차단/경고(대면 동일).
 * 종전 원격은 DUR 우회했음(모듈 순환으로 보류 후 leaf DurModule로 봉합).
 */
describe('원격 DUR 게이트 — applyRemoteDurGate', () => {
  let prisma: any;
  let runtimeConfig: any;

  beforeEach(() => {
    prisma = { gateViolationLog: { create: vi.fn().mockResolvedValue({}) } };
    runtimeConfig = { get: vi.fn() };
  });

  const svc = () => new RemoteConsultationService(prisma, {} as any, undefined, undefined, undefined, runtimeConfig) as any;

  it('ERROR 경고 없으면 통과', async () => {
    await expect(svc().applyRemoteDurGate([{ severity: 'WARNING', message: 'x' }], 'e1')).resolves.toBeUndefined();
    expect(prisma.gateViolationLog.create).not.toHaveBeenCalled();
  });

  it('BLOCK(기본): ERROR 경고 시 차단 + 위반기록', async () => {
    runtimeConfig.get.mockResolvedValue('BLOCK');
    await expect(svc().applyRemoteDurGate([{ type: 'INTERACTION', severity: 'ERROR', message: '병용금기' }], 'e1'))
      .rejects.toThrow(BadRequestException);
    expect(prisma.gateViolationLog.create).toHaveBeenCalled();
  });

  it('WARN: ERROR 경고 통과 + 기록', async () => {
    runtimeConfig.get.mockResolvedValue('WARN');
    await expect(svc().applyRemoteDurGate([{ type: 'DUP', severity: 'ERROR', message: '중복' }], 'e1')).resolves.toBeUndefined();
    expect(prisma.gateViolationLog.create).toHaveBeenCalled();
  });

  it('기본값 BLOCK(config 미설정)', async () => {
    runtimeConfig.get.mockResolvedValue(undefined);
    await expect(svc().applyRemoteDurGate([{ type: 'ALLERGY', severity: 'ERROR', message: '알레르기' }], 'e1'))
      .rejects.toThrow('DUR');
  });
});
