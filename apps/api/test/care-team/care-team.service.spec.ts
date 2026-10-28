import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { CareTeamService } from '../../src/modules/care-team/care-team.service';

describe('CareTeamService', () => {
  let service: CareTeamService;
  let p: any;
  const mockTeam = { id: 'ct-1', doctorId: 'doc-1', nurseId: 'n-1', departmentName: '내과', isActive: true };

  // CareTeam.doctorId/nurseId 는 users.id — 서비스가 저장 전 계정을 확인한다(W8)
  const USERS: Record<string, { id: string; role: string; isActive: boolean }> = {
    'doc-1': { id: 'doc-1', role: 'DOCTOR', isActive: true },
    'doc-2': { id: 'doc-2', role: 'DOCTOR', isActive: true },
    'n-1': { id: 'n-1', role: 'NURSE', isActive: true },
    'n-2': { id: 'n-2', role: 'NURSE', isActive: true },
    'staff-1': { id: 'staff-1', role: 'ADMIN', isActive: true },
  };

  beforeEach(() => {
    p = {
      careTeam: { findMany: vi.fn().mockResolvedValue([mockTeam]), findUnique: vi.fn().mockResolvedValue(mockTeam), create: vi.fn().mockResolvedValue(mockTeam), update: vi.fn().mockResolvedValue(mockTeam) },
      user: { findUnique: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(USERS[where.id] ?? null)) },
    };
    service = new CareTeamService(p);
  });

  it('findAll — 필터', async () => { await service.findAll('내과', 'OUTPATIENT'); expect(p.careTeam.findMany).toHaveBeenCalled(); });
  it('create', async () => { const r = await service.create({ doctorId: 'doc-1', nurseId: 'n-1', departmentName: '내과' } as any); expect(r.id).toBe('ct-1'); });
  it('create 중복 시 ConflictException', async () => {
    p.careTeam.create.mockRejectedValue(new Error('Unique constraint'));
    await expect(service.create({ doctorId: 'doc-1', nurseId: 'n-1', departmentName: '내과' } as any)).rejects.toThrow(ConflictException);
  });
  it('update', async () => { await service.update('ct-1', { teamType: 'INPATIENT' } as any); expect(p.careTeam.update).toHaveBeenCalled(); });
  it('update — 없는 팀 NotFoundException', async () => { p.careTeam.findUnique.mockResolvedValue(null); await expect(service.update('x', {} as any)).rejects.toThrow(NotFoundException); });
  it('deactivate', async () => { await service.deactivate('ct-1'); expect(p.careTeam.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: false }) })); });
  it('getMyTeam', async () => { await service.getMyTeam('doc-1'); expect(p.careTeam.findMany).toHaveBeenCalled(); });
  it('getByDoctor', async () => { await service.getByDoctor('doc-1'); expect(p.careTeam.findMany).toHaveBeenCalled(); });
});
