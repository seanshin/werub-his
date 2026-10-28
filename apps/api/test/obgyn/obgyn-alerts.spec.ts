import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObGynService } from '../../src/modules/obgyn/obgyn.service';

describe('ObGynService P3 경보(전자간증·태아곤란)', () => {
  let svc: ObGynService;
  let prisma: any;
  let events: { emit: any };

  beforeEach(() => {
    events = { emit: vi.fn() };
    prisma = {
      obGynExam: { create: vi.fn(async ({ data }: any) => ({ id: 'e1', ...data })) },
      deliveryRecord: { findUnique: vi.fn(async () => ({ id: 'd1', status: 'IN_LABOR', patientId: 'p1' })) },
      laborProgressRecord: { create: vi.fn(async ({ data }: any) => ({ id: 'l1', ...data })) },
    };
    svc = new ObGynService(prisma as any, events as any);
  });

  it('전자간증 — 중증 고혈압+요단백 emit', async () => {
    await svc.createExam({ patientId: 'p1', examType: 'PRENATAL', bloodPressure: '165/112', urineProtein: '2+', examinedBy: 'u1' } as any);
    expect(events.emit).toHaveBeenCalledWith('obgyn.preeclampsia', expect.objectContaining({ patientId: 'p1' }));
  });

  it('전자간증 — 정상 혈압이면 emit 없음', async () => {
    await svc.createExam({ patientId: 'p1', examType: 'PRENATAL', bloodPressure: '120/80', urineProtein: '2+', examinedBy: 'u1' } as any);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('전자간증 — 고혈압이나 요단백 음성이면 emit 없음', async () => {
    await svc.createExam({ patientId: 'p1', examType: 'PRENATAL', bloodPressure: '165/112', urineProtein: '음성', examinedBy: 'u1' } as any);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('태아곤란 — FHR 서맥(<110) emit', async () => {
    await svc.addLaborProgress('d1', { fetalHeartRate: 90 } as any, 'u1');
    expect(events.emit).toHaveBeenCalledWith('labor.fetal_distress', expect.objectContaining({ type: 'BRADYCARDIA' }));
  });

  it('태아곤란 — FHR 빈맥(>160) emit', async () => {
    await svc.addLaborProgress('d1', { fetalHeartRate: 180 } as any, 'u1');
    expect(events.emit).toHaveBeenCalledWith('labor.fetal_distress', expect.objectContaining({ type: 'TACHYCARDIA' }));
  });

  it('태아곤란 — FHR 정상(110~160)이면 emit 없음', async () => {
    await svc.addLaborProgress('d1', { fetalHeartRate: 140 } as any, 'u1');
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('🔴 잰 값이 없는 진행 기록은 받지 않는다 · 측정 시각을 저장 · 미래 거절(2026-10-10)', async () => {
    await expect(svc.addLaborProgress('d1', { note: '확인' } as any, 'u1')).rejects.toMatchObject({ response: { code: 'LABOR_PROGRESS_EMPTY' } });
    await expect(svc.addLaborProgress('d1', { cervicalDilation: 4, recordedAt: new Date(Date.now() + 3_600_000).toISOString() } as any, 'u1')).rejects.toMatchObject({ response: { code: 'LABOR_PROGRESS_TIME_FUTURE' } });
    await svc.addLaborProgress('d1', { cervicalDilation: 4, recordedAt: '2026-10-10T00:30:00Z' } as any, 'u1');
    const data = (prisma as any).laborProgressRecord.create.mock.calls.at(-1)[0].data;
    expect(data).toMatchObject({ cervicalDilation: 4, recordedAt: new Date('2026-10-10T00:30:00Z'), recordedBy: 'u1' });
  });
});
