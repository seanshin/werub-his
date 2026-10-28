import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScheduleReminderCronService } from '../../src/modules/patient-schedule/schedule-reminder.cron';

describe('ScheduleReminderCronService', () => {
  let service: ScheduleReminderCronService;
  let mockPrisma: any;
  let mockConfig: any;
  let mockEmitter: any;

  const item = (id: string, patientId: string, over: Record<string, unknown> = {}) => ({
    id, plannedAt: new Date(), itemType: 'LAB', title: 'HbA1c 검사', status: 'PLANNED',
    remindedAt: null, schedule: { patientId }, ...over,
  });

  beforeEach(() => {
    mockPrisma = {
      patientScheduleItem: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    mockConfig = { get: vi.fn().mockResolvedValue(true) };
    mockEmitter = { emit: vi.fn() };
    service = new ScheduleReminderCronService(mockPrisma, mockConfig, mockEmitter);
  });

  it('should no-op when config gate is off', async () => {
    mockConfig.get.mockResolvedValue(false);
    const result = await service.sendReminders();
    expect(result).toEqual({ patients: 0, items: 0 });
    expect(mockPrisma.patientScheduleItem.findMany).not.toHaveBeenCalled();
  });

  it('should query only patient-visible types, unreminded, ACTIVE schedule', async () => {
    await service.sendReminders();
    expect(mockPrisma.patientScheduleItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['PLANNED', 'LINKED'] },
          remindedAt: null,
          itemType: { in: expect.arrayContaining(['LAB', 'IMAGING', 'VISIT', 'PROCEDURE', 'EDUCATION']) },
          schedule: { status: 'ACTIVE' },
        }),
      }),
    );
  });

  it('should group by patient — one event per patient with count and stamp remindedAt first', async () => {
    mockPrisma.patientScheduleItem.findMany.mockResolvedValue([
      item('i1', 'pat-1'), item('i2', 'pat-1', { title: '식이 교육' }), item('i3', 'pat-2'),
    ]);

    const result = await service.sendReminders();

    expect(result).toEqual({ patients: 2, items: 3 });
    expect(mockEmitter.emit).toHaveBeenCalledTimes(2);
    expect(mockEmitter.emit).toHaveBeenCalledWith('treatment.schedule.reminder',
      expect.objectContaining({ patientId: 'pat-1', count: 2, firstTitle: 'HbA1c 검사' }));
    // 멱등 스탬프가 emit보다 선행 (재실행 중복 방지)
    expect(mockPrisma.patientScheduleItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['i1', 'i2'] }, remindedAt: null }),
        data: { remindedAt: expect.any(Date) },
      }),
    );
  });

  it('should isolate per-patient failures (비차단)', async () => {
    mockPrisma.patientScheduleItem.findMany.mockResolvedValue([item('i1', 'pat-1'), item('i2', 'pat-2')]);
    mockPrisma.patientScheduleItem.updateMany
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ count: 1 });

    const result = await service.sendReminders();

    expect(result.patients).toBe(1); // pat-1 실패·pat-2 성공
    expect(mockEmitter.emit).toHaveBeenCalledTimes(1);
  });
});
