import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HolidayService } from '../../src/modules/holiday/holiday.service';

describe('HolidayService', () => {
  let service: HolidayService;
  let p: any;
  let mockConfig: any;

  beforeEach(() => {
    p = {
      holidayCalendar: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({ id: 'h-1' }),
      },
    };
    mockConfig = { get: vi.fn().mockReturnValue('') };
    service = new HolidayService(p, mockConfig);
  });

  it('isHoliday — 평일', async () => { const r = await service.isHoliday(new Date('2026-06-02')); expect(typeof r).toBe('boolean'); });
  it('getHolidays', async () => { await service.getHolidays(2026); expect(p.holidayCalendar.findMany).toHaveBeenCalled(); });
  it('addHospitalHoliday', async () => { await service.addHospitalHoliday(new Date('2026-12-25'), '크리스마스'); expect(p.holidayCalendar.upsert).toHaveBeenCalled(); });
});
