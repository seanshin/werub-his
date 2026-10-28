import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JourneyController } from '../../src/modules/journey/journey.controller';

describe('JourneyController', () => {
  let controller: JourneyController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getMetrics: vi.fn(),
      getTimeline: vi.fn(),
    };
    controller = new JourneyController(mockService);
  });

  // ── getMetrics ──

  describe('getMetrics', () => {
    it('should get quality metrics and wrap in data', async () => {
      const mockMetrics = {
        period: { from: '2026-05-01T00:00:00Z', to: '2026-05-31T23:59:59Z' },
        avgOutpatientWaitMinutes: 15.5,
        avgErStayHours: 4.2,
        avgLengthOfStayDays: 5.8,
        readmissionRate30Days: 12.5,
        sampleCounts: { outpatientWaits: 100, erStays: 45, admissions: 200, discharges: 180, readmissions: 22 },
      };
      mockService.getMetrics.mockResolvedValue(mockMetrics);

      const result = await controller.getMetrics();
      expect(result).toHaveProperty('data');
      expect(result.data.avgOutpatientWaitMinutes).toBe(15.5);
      expect(mockService.getMetrics).toHaveBeenCalledWith({ from: undefined, to: undefined });
    });

    it('should pass date range to service', async () => {
      mockService.getMetrics.mockResolvedValue({});
      await controller.getMetrics('2026-05-01', '2026-05-31');
      expect(mockService.getMetrics).toHaveBeenCalledWith({ from: '2026-05-01', to: '2026-05-31' });
    });

    it('should include sample counts in response', async () => {
      mockService.getMetrics.mockResolvedValue({
        sampleCounts: { outpatientWaits: 100, erStays: 50, admissions: 200, discharges: 150, readmissions: 18 },
      });
      const result = await controller.getMetrics();
      expect(result.data.sampleCounts.outpatientWaits).toBe(100);
    });
  });

  // ── getTimeline ──

  describe('getTimeline', () => {
    it('should get timeline for patient', async () => {
      mockService.getTimeline.mockResolvedValue({ events: [
        { id: 'evt-1', eventType: 'ADMISSION' },
        { id: 'evt-2', eventType: 'CONSULTATION' },
      ], truncated: false, olderCursor: null });
      const result = await controller.getTimeline('p-1');
      expect(result.data).toHaveLength(2);
      expect(mockService.getTimeline).toHaveBeenCalledWith('p-1', {
        from: undefined, to: undefined, types: undefined, limit: undefined, before: undefined,
      });
    });

    it('should filter by date range', async () => {
      mockService.getTimeline.mockResolvedValue({ events: [], truncated: false, olderCursor: null });
      await controller.getTimeline('p-1', '2026-05-01', '2026-05-31');
      expect(mockService.getTimeline).toHaveBeenCalledWith('p-1', {
        from: '2026-05-01', to: '2026-05-31', types: undefined, limit: undefined, before: undefined,
      });
    });

    it('should split and trim event types', async () => {
      mockService.getTimeline.mockResolvedValue({ events: [], truncated: false, olderCursor: null });
      await controller.getTimeline('p-1', undefined, undefined, 'ADMISSION , DISCHARGE');
      expect(mockService.getTimeline).toHaveBeenCalledWith('p-1', {
        from: undefined, to: undefined, types: ['ADMISSION', 'DISCHARGE'], limit: undefined, before: undefined,
      });
    });

    it('should parse limit as integer', async () => {
      mockService.getTimeline.mockResolvedValue({ events: [], truncated: false, olderCursor: null });
      await controller.getTimeline('p-1', undefined, undefined, undefined, '50');
      expect(mockService.getTimeline).toHaveBeenCalledWith('p-1', expect.objectContaining({ limit: 50 }));
    });

    it('should wrap response in data object', async () => {
      mockService.getTimeline.mockResolvedValue({ events: [], truncated: false, olderCursor: null });
      const result = await controller.getTimeline('p-1');
      expect(result).toHaveProperty('data');
    });

    it('should handle empty timeline', async () => {
      mockService.getTimeline.mockResolvedValue({ events: [], truncated: false, olderCursor: null });
      const result = await controller.getTimeline('p-1');
      expect(result.data).toHaveLength(0);
    });

    it('should include event details in response', async () => {
      mockService.getTimeline.mockResolvedValue({ events: [
        { eventType: 'ADMISSION', department: 'Emergency', doctorName: 'Dr. Kim', severity: 'HIGH' },
      ], truncated: false, olderCursor: null });
      const result = await controller.getTimeline('p-1');
      expect(result.data[0].department).toBe('Emergency');
      expect(result.data[0].doctorName).toBe('Dr. Kim');
    });
  });

  // ── Response Format ──

  describe('Response Format', () => {
    it('should wrap all responses in data object', async () => {
      mockService.getMetrics.mockResolvedValue({});
      mockService.getTimeline.mockResolvedValue({ events: [], truncated: false, olderCursor: null });

      const metricsResult = await controller.getMetrics();
      const timelineResult = await controller.getTimeline('p-1');

      expect(metricsResult).toEqual({ data: {} });
      // 잘림은 meta 로 말한다(여정 P0-8)
      expect(timelineResult).toEqual({ data: [], meta: { truncated: false, olderCursor: null } });
    });
  });
});
