import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PacuService } from '../../src/modules/pacu/pacu.service';

describe('PacuService', () => {
  let service: PacuService;
  let p: any;
  // 🔴 목(mock)은 **정본이 실제로 돌려주는 모양**을 쓴다 — 없는 필드를 빼두면 그 필드를 읽는
  //    코드가 목에서만 죽고(또는 목에서만 산다) 가드가 헛돈다. `arrivalTime` 은 스키마상 NOT NULL 이다.
  const mock = {
    id: 'pr-1', patientId: 'pt-1', surgeryId: 'sg-1', status: 'ADMITTED',
    arrivalTime: new Date('2026-08-26T00:00:00Z'), dischargeTime: null,
    aldretScore: 0, padssScore: null, vitalSigns: [], interventions: [],
    arrivalHandoff: null, dischargeHandoff: null, dischargeOverride: null,
    nurseId: 'nur-1', prescribedBy: 'doc-1',
  };

  beforeEach(() => {
    p = {
      pacuRecord: { findMany: vi.fn().mockResolvedValue([mock]), findUnique: vi.fn().mockResolvedValue(mock), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(mock), update: vi.fn().mockResolvedValue(mock), count: vi.fn().mockResolvedValue(3) },
      surgery: { findUnique: vi.fn().mockResolvedValue({ id: 'sg-1', patientId: 'pt-1', status: 'COMPLETED' }) },
      admission: { findFirst: vi.fn().mockResolvedValue({ id: 'adm-1', bedId: 'bed-1', bed: { roomNumber: '501', bedNumber: '1', ward: { name: '5병동' } } }) },
    icuAdmission: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(),
    };
    p.pacuRecord.updateMany = vi.fn().mockResolvedValue({ count: 1 });
    p.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(p));
    service = new PacuService(p);
  });

  it('admit — 환자는 수술에서 · 담당 간호사는 처리한 사용자', async () => {
    const r = await service.admit({ surgeryId: 'sg-1' } as never, 'nur-9');
    expect(r.id).toBe('pr-1');
    expect(p.pacuRecord.create.mock.calls[0][0].data).toMatchObject({ patientId: 'pt-1', surgeryId: 'sg-1', nurseId: 'nur-9' });
  });
  it('getRecords', async () => { await service.getRecords({}); expect(p.pacuRecord.findMany).toHaveBeenCalled(); });
  it('getRecordById', async () => { await service.getRecordById('pr-1'); expect(p.pacuRecord.findUnique).toHaveBeenCalled(); });
  it('getRecordById — 없음', async () => { p.pacuRecord.findUnique.mockResolvedValue(null); await expect(service.getRecordById('x')).rejects.toThrow(NotFoundException); });
  it('updateAldrete', async () => {
    await service.updateAldrete('pr-1', { score: 11, detail: { activity: 2, respiration: 2, circulation: 2, consciousness: 2, spo2: 2, pain: 1 } } as never, 'nur-1');
    expect(p.pacuRecord.update).toHaveBeenCalled();
  });
  it('discharge', async () => { await service.discharge('pr-1', 'doc-1', 'WARD', '마취과 판단'); expect(p.pacuRecord.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ disposition: 'WARD', dischargedById: 'doc-1' }) })); });
  it('[P1] 기준미달 강제퇴실은 간호사 단독 불가(의사만)', async () => {
    // aldretScore 0 < 기준 → below=true. NURSE role override 시도 → Forbidden
    await expect(service.discharge('pr-1', 'nur-1', 'WARD', '사유', undefined, 'NURSE')).rejects.toMatchObject({ response: { code: 'DISCHARGE_OVERRIDE_REQUIRES_DOCTOR' } });
    expect(p.pacuRecord.update).not.toHaveBeenCalled();
    expect(p.pacuRecord.updateMany).not.toHaveBeenCalled();
  });
  it('[P1] 기준미달 강제퇴실 의사(DOCTOR)는 허용', async () => {
    await service.discharge('pr-1', 'doc-1', 'WARD', '마취과 판단', undefined, 'DOCTOR');
    expect(p.pacuRecord.updateMany).toHaveBeenCalled();
  });
  it('getActivePatients', async () => { await service.getActivePatients(); expect(p.pacuRecord.findMany).toHaveBeenCalled(); });
});
