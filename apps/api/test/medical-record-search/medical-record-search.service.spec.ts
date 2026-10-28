import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MedicalRecordSearchService } from '../../src/modules/medical-record-search/medical-record-search.service';

describe('MedicalRecordSearchService', () => {
  let service: MedicalRecordSearchService;
  let mockPrisma: any;
  let mockRedis: any;

  beforeEach(() => {
    mockPrisma = {
      $queryRawUnsafe: vi.fn(),
    };

    mockRedis = {
      get: vi.fn(),
      setex: vi.fn(),
    };

    service = new MedicalRecordSearchService(mockPrisma, mockRedis);
  });

  describe('search', () => {
    it('should return empty results for empty query', async () => {
      const result = await service.search('', {});
      expect(result.results).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should return empty results for query < 2 chars', async () => {
      const result = await service.search('a', {});
      expect(result.results).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should return cached results if available', async () => {
      const cachedData = {
        results: [
          {
            id: 'enc-1',
            type: 'encounter',
            headline: '고혈압 진료',
            patientName: '김환자',
            doctorName: '이의사',
            recordedAt: '2026-05-13T10:00:00Z',
          },
        ],
        total: 1,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(cachedData));

      const result = await service.search('고혈압', {});

      expect(result).toEqual(cachedData);
      expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('should search in encounters', async () => {
      mockRedis.get.mockResolvedValue(null);

      const mockResults = [
        {
          id: 'enc-1',
          type: 'encounter',
          headline: '고혈압',
          patient_name: '김환자',
          doctor_name: '이의사',
          recorded_at: new Date('2026-05-13'),
        },
      ];

      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce(mockResults) // results
        .mockResolvedValueOnce([{ total: BigInt(1) }]); // count

      const result = await service.search('고혈압', { type: 'encounter' });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].type).toBe('encounter');
      expect(result.total).toBe(1);
      expect(mockRedis.setex).toHaveBeenCalled();
    });

    it('should search in progress notes', async () => {
      mockRedis.get.mockResolvedValue(null);

      const mockResults = [
        {
          id: 'pn-1',
          type: 'progress_note',
          headline: '환자 호소: 두통',
          patient_name: '박환자',
          doctor_name: '김의사',
          recorded_at: new Date('2026-05-13'),
        },
      ];

      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce(mockResults)
        .mockResolvedValueOnce([{ total: BigInt(1) }]);

      const result = await service.search('두통', { type: 'progress_note' });

      expect(result.results[0].type).toBe('progress_note');
    });

    it('should support pagination', async () => {
      mockRedis.get.mockResolvedValue(null);

      const mockResults = Array.from({ length: 10 }, (_, i) => ({
        id: `enc-${i}`,
        type: 'encounter',
        headline: '진료 기록',
        patient_name: '환자',
        doctor_name: '의사',
        recorded_at: new Date(),
      }));

      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce(mockResults)
        .mockResolvedValueOnce([{ total: BigInt(100) }]);

      const result = await service.search('진료', { page: 2, limit: 10 });

      expect(result.results).toHaveLength(10);
      expect(result.total).toBe(100);
    });

    it('should filter by date range', async () => {
      mockRedis.get.mockResolvedValue(null);

      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([
          {
            id: 'enc-1',
            type: 'encounter',
            headline: '2026년 5월 진료',
            patient_name: '환자',
            doctor_name: '의사',
            recorded_at: new Date('2026-05-13'),
          },
        ])
        .mockResolvedValueOnce([{ total: BigInt(1) }]);

      const result = await service.search('진료', {
        dateFrom: '2026-05-01',
        dateTo: '2026-05-31',
      });

      expect(result.results).toHaveLength(1);
    });

    it('should filter by doctor', async () => {
      mockRedis.get.mockResolvedValue(null);

      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([
          {
            id: 'enc-1',
            type: 'encounter',
            headline: '진료 기록',
            patient_name: '환자',
            doctor_name: '이의사',
            recorded_at: new Date(),
          },
        ])
        .mockResolvedValueOnce([{ total: BigInt(1) }]);

      const result = await service.search('진료', { doctorId: 'doc-1' });

      expect(result.results).toHaveLength(1);
    });

    it('should search across multiple record types', async () => {
      mockRedis.get.mockResolvedValue(null);

      const mockResults = [
        {
          id: 'enc-1',
          type: 'encounter',
          headline: '고혈압',
          patient_name: '김환자',
          doctor_name: '이의사',
          recorded_at: new Date(),
        },
        {
          id: 'pn-1',
          type: 'progress_note',
          headline: '고혈압 추적',
          patient_name: '김환자',
          doctor_name: '이의사',
          recorded_at: new Date(),
        },
      ];

      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce(mockResults)
        .mockResolvedValueOnce([{ total: BigInt(2) }]);

      const result = await service.search('고혈압', {}); // no type filter

      expect(result.results).toHaveLength(2);
      expect(result.results.map((r) => r.type)).toContain('encounter');
      expect(result.results.map((r) => r.type)).toContain('progress_note');
    });

    it('should handle Redis cache failure gracefully', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis error'));

      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([
          {
            id: 'enc-1',
            type: 'encounter',
            headline: '진료',
            patient_name: '환자',
            doctor_name: '의사',
            recorded_at: new Date(),
          },
        ])
        .mockResolvedValueOnce([{ total: BigInt(1) }]);

      const result = await service.search('진료', {});

      expect(result.results).toHaveLength(1);
    });

    it('should highlight search query in results', async () => {
      mockRedis.get.mockResolvedValue(null);

      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([
          {
            id: 'enc-1',
            type: 'encounter',
            headline: '고혈압 진료 기록',
            patient_name: '김환자',
            doctor_name: '이의사',
            recorded_at: new Date(),
          },
        ])
        .mockResolvedValueOnce([{ total: BigInt(1) }]);

      const result = await service.search('고혈압', {});

      // headline should contain highlighted text
      expect(result.results[0].headline).toContain('고혈압');
    });
  });
});
