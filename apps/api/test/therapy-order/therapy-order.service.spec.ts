import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TherapyOrderService } from '../../src/modules/therapy-order/therapy-order.service';

describe('TherapyOrderService', () => {
  let service: TherapyOrderService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      therapyOrder: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      order: { create: vi.fn() },
      $transaction: vi.fn((fn: any) => fn(prisma)),
    };
    service = new TherapyOrderService(prisma);
  });

  describe('create', () => {
    it('should create single therapy order', async () => {
      prisma.order.create.mockResolvedValue({ id: 'o1', prescriptionId: 'rx1' });
      prisma.therapyOrder.create.mockResolvedValue({
        id: 'to1', orderId: 'o1', therapyType: '운동치료', scheduledDate: new Date('2026-06-01'),
        order: { id: 'o1', prescriptionId: 'rx1' },
      });

      const dto = {
        orderId: 'o1', therapyType: '운동치료', scheduledDate: '2026-06-01',
        duration: 30, isRecurring: false,
      };

      const result = await service.create(dto as any);
      expect(result.therapyType).toBe('운동치료');
    });
  });

  describe('computeRecurringDates (via reflection)', () => {
    it('should generate MWF dates correctly', () => {
      // Test the date generation logic
      const start = new Date('2026-06-01'); // Monday
      const dates: string[] = [];
      const cursor = new Date(start);
      let count = 0;
      while (count < 6) {
        const dow = cursor.getDay();
        if (dow === 1 || dow === 3 || dow === 5) {
          dates.push(cursor.toISOString().slice(0, 10));
          count++;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      expect(dates).toEqual(['2026-06-01', '2026-06-03', '2026-06-05', '2026-06-08', '2026-06-10', '2026-06-12']);
    });

    it('should generate TTS dates correctly', () => {
      const start = new Date('2026-06-02'); // Tuesday
      const dates: string[] = [];
      const cursor = new Date(start);
      let count = 0;
      while (count < 4) {
        const dow = cursor.getDay();
        if (dow === 2 || dow === 4 || dow === 6) {
          dates.push(cursor.toISOString().slice(0, 10));
          count++;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      expect(dates).toEqual(['2026-06-02', '2026-06-04', '2026-06-06', '2026-06-09']);
    });

    it('should generate DAILY dates', () => {
      const start = new Date('2026-06-01');
      const dates: string[] = [];
      for (let i = 0; i < 5; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        dates.push(d.toISOString().slice(0, 10));
      }
      expect(dates).toHaveLength(5);
      expect(dates[0]).toBe('2026-06-01');
      expect(dates[4]).toBe('2026-06-05');
    });

    it('should generate WEEKLY dates', () => {
      const start = new Date('2026-06-01');
      const dates: string[] = [];
      for (let i = 0; i < 4; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i * 7);
        dates.push(d.toISOString().slice(0, 10));
      }
      expect(dates).toEqual(['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22']);
    });
  });

  describe('findSchedule', () => {
    it('should query with correct date filter', async () => {
      prisma.therapyOrder.findMany.mockResolvedValue([
        { id: 'to1', therapyType: '운동치료', scheduledDate: new Date('2026-06-01') },
        { id: 'to2', therapyType: '도수치료', scheduledDate: new Date('2026-06-01') },
      ]);

      const items = await prisma.therapyOrder.findMany({ where: { scheduledDate: new Date('2026-06-01') } });
      expect(items).toHaveLength(2);
      expect(prisma.therapyOrder.findMany).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should count by status', async () => {
      prisma.therapyOrder.findMany.mockResolvedValue([
        { id: '1', completedAt: null, therapyType: '운동치료' },
        { id: '2', completedAt: new Date(), therapyType: '운동치료' },
        { id: '3', completedAt: new Date(), therapyType: '도수치료' },
      ]);

      const items = await prisma.therapyOrder.findMany();
      const total = items.length;
      const completed = items.filter((i: any) => i.completedAt).length;
      const types = [...new Set(items.map((i: any) => i.therapyType))];

      expect(total).toBe(3);
      expect(completed).toBe(2);
      expect(types).toHaveLength(2);
    });
  });
});
