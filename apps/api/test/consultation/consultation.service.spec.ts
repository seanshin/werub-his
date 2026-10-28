import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ConsultationService } from '../../src/modules/consultation/consultation.service';

describe('ConsultationService', () => {
  let service: ConsultationService;
  let p: any;
  let notification: any;
  const mockConsult = { id: 'cs-1', status: 'REQUESTED', toDoctorId: null, toDepartment: '정형외과', requestingDoctorId: 'doc-1' };

  beforeEach(() => {
    p = {
      // 🔴 (D1) 상태 전이는 조건부 `updateMany`(where status=현재) 로 쓴다 — 목도 그 모양을 따른다
      consultation: {
        create: vi.fn().mockResolvedValue(mockConsult),
        findMany: vi.fn().mockResolvedValue([mockConsult]),
        findUnique: vi.fn().mockResolvedValue(mockConsult),
        update: vi.fn().mockResolvedValue({ ...mockConsult, status: 'REPLIED' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ department: '정형외과' }), findMany: vi.fn().mockResolvedValue([]) },
    };
    notification = { create: vi.fn().mockResolvedValue({ id: 'n-1', type: 'CONSULT_REQUEST', title: 't', message: 'm', severity: 'INFO', refType: 'consultation', refId: 'cs-1' }), pushNotification: vi.fn() };
    service = new ConsultationService(p, notification);
  });

  it('create — 타과 협진 요청', async () => {
    const r = await service.create({ encounterId: 'e-1', requestingDoctorId: 'doc-1', toDepartment: '정형외과', reason: '골절 의심' });
    expect(r.id).toBe('cs-1');
  });
  it('findByEncounter', async () => { await service.findByEncounter('e-1'); expect(p.consultation.findMany).toHaveBeenCalled(); });
  it('findPending', async () => { await service.findPending('정형외과'); expect(p.consultation.findMany).toHaveBeenCalled(); });
  it('reply', async () => {
    await service.reply('cs-1', { replyDoctorId: 'doc-2', replyContent: '골절 확인' });
    expect(p.consultation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cs-1', status: 'REQUESTED' },
      data: expect.objectContaining({ status: 'REPLIED' }),
    }));
  });
  it('reply — 없는 협진 NotFoundException', async () => { p.consultation.findUnique.mockResolvedValue(null); await expect(service.reply('x', { replyDoctorId: 'doc-2', replyContent: 'test' })).rejects.toThrow(NotFoundException); });
  it('close', async () => { await service.close('cs-1'); expect(p.consultation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'CLOSED', closedAt: expect.any(Date), closedById: null } })); });
});
