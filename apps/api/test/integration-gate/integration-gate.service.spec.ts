import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IntegrationGateService } from '../../src/modules/integration-gate/integration-gate.service';

describe('IntegrationGateService', () => {
  let service: IntegrationGateService;
  let mockPrisma: any;

  const gate = (key: string, status = 'PENDING', over: Record<string, unknown> = {}) => ({
    id: `g-${key}`, track: 'LIS_REFLEX', key, title: 't', owner: 'o', status, note: null,
    evidenceType: null, evidenceRef: null, approvedOn: null, approverName: null, evidenceUrl: null, ...over,
  });
  const EVIDENCE = { evidenceType: 'APPROVAL_DOC', evidenceRef: '결재-2026-071' };

  beforeEach(() => {
    mockPrisma = {
      integrationGate: {
        upsert: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue(gate('A-1', 'CONFIRMED')),
      },
      integrationGateEvent: {
        create: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([]),
      },
      systemConfig: {
        findUnique: vi.fn().mockResolvedValue(null), // 미개통
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
    service = new IntegrationGateService(mockPrisma);
  });

  it('should seed gates idempotently and report live/allConfirmed', async () => {
    mockPrisma.integrationGate.findMany.mockResolvedValue([gate('A-1', 'CONFIRMED'), gate('A-2', 'CONFIRMED'), gate('A-3', 'CONFIRMED')]);
    mockPrisma.systemConfig.findUnique.mockResolvedValue({ value: true });

    const result = await service.getTrack('LIS_REFLEX');

    expect(mockPrisma.integrationGate.upsert).toHaveBeenCalledTimes(3); // A-1~3 시드
    expect(result.allConfirmed).toBe(true);
    expect(result.live).toBe(true);
  });

  it('should reject unknown track', async () => {
    await expect(service.getTrack('NOPE')).rejects.toThrow(NotFoundException);
  });

  it('should require evidenceType on confirm', async () => {
    await expect(service.confirm('LIS_REFLEX', 'A-1', 'u-1', { evidenceRef: 'ref' })).rejects.toThrow(/유형/);
  });

  it('should require evidenceRef on confirm (결재 식별자)', async () => {
    await expect(service.confirm('LIS_REFLEX', 'A-1', 'u-1', { evidenceType: 'MEETING' })).rejects.toThrow(/식별자/);
  });

  it('should reject invalid approvedOn date', async () => {
    await expect(
      service.confirm('LIS_REFLEX', 'A-1', 'u-1', { ...EVIDENCE, approvedOn: 'not-a-date' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should confirm with structured evidence and log CONFIRM event', async () => {
    mockPrisma.integrationGate.findUnique.mockResolvedValue(gate('A-1'));
    await service.confirm('LIS_REFLEX', 'A-1', 'u-1', {
      ...EVIDENCE, approvedOn: '2026-07-12', approverName: '김진단 과장', evidenceUrl: 'https://gw.example.com/doc/1',
    });
    expect(mockPrisma.integrationGate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CONFIRMED', confirmedBy: 'u-1',
          evidenceType: 'APPROVAL_DOC', evidenceRef: '결재-2026-071', approverName: '김진단 과장',
        }),
      }),
    );
    expect(mockPrisma.integrationGateEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'CONFIRM', key: 'A-1', actorId: 'u-1' }),
      }),
    );
  });

  it('should reject double confirm', async () => {
    mockPrisma.integrationGate.findUnique.mockResolvedValue(gate('A-1', 'CONFIRMED'));
    await expect(service.confirm('LIS_REFLEX', 'A-1', 'u-1', EVIDENCE)).rejects.toThrow(/이미 확인/);
  });

  it('should block activate with pending gates', async () => {
    mockPrisma.integrationGate.findMany.mockResolvedValue([gate('A-1', 'CONFIRMED'), gate('A-2'), gate('A-3')]);
    await expect(service.activate('LIS_REFLEX', 'u-1')).rejects.toThrow(/A-2, A-3/);
    expect(mockPrisma.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('should activate (config ON) when all gates confirmed and log ACTIVATE event', async () => {
    mockPrisma.integrationGate.findMany.mockResolvedValue([gate('A-1', 'CONFIRMED'), gate('A-2', 'CONFIRMED'), gate('A-3', 'CONFIRMED')]);
    await service.activate('LIS_REFLEX', 'u-1');
    expect(mockPrisma.systemConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'fhir.serviceRequestInbound.enabled' },
        update: expect.objectContaining({ value: true }),
      }),
    );
    expect(mockPrisma.integrationGateEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'ACTIVATE' }) }),
    );
  });

  it('should block revoke while live (개통 중 게이트 공백 방지)', async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValue({ value: true });
    await expect(service.revoke('LIS_REFLEX', 'A-3', 'u-1')).rejects.toThrow(/개통 중/);
  });

  it('should revoke with prior evidence preserved in event snapshot and reset gate evidence', async () => {
    mockPrisma.integrationGate.findUnique.mockResolvedValue(
      gate('A-1', 'CONFIRMED', { evidenceType: 'APPROVAL_DOC', evidenceRef: '결재-2026-071' }),
    );
    await service.revoke('LIS_REFLEX', 'A-1', 'u-1', '실결재로 교체');
    expect(mockPrisma.integrationGateEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'REVOKE',
          snapshot: expect.objectContaining({
            revokeReason: '실결재로 교체',
            prior: expect.objectContaining({ evidenceRef: '결재-2026-071' }),
          }),
        }),
      }),
    );
    expect(mockPrisma.integrationGate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING', evidenceType: null, evidenceRef: null }),
      }),
    );
  });

  it('should deactivate, keep gate records, and log DEACTIVATE event', async () => {
    await service.deactivate('LIS_REFLEX', 'u-1');
    expect(mockPrisma.systemConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ value: false }) }),
    );
    expect(mockPrisma.integrationGate.update).not.toHaveBeenCalled(); // 게이트 기록 보존
    expect(mockPrisma.integrationGateEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'DEACTIVATE' }) }),
    );
  });

  it('should list track events (최근순)', async () => {
    mockPrisma.integrationGateEvent.findMany.mockResolvedValue([{ id: 'e-1', action: 'CONFIRM' }]);
    const events = await service.getEvents('LIS_REFLEX');
    expect(mockPrisma.integrationGateEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { track: 'LIS_REFLEX' }, orderBy: { createdAt: 'desc' } }),
    );
    expect(events).toHaveLength(1);
  });
});
