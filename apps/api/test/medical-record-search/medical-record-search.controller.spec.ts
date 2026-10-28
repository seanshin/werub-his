import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MedicalRecordSearchController } from '../../src/modules/medical-record-search/medical-record-search.controller';
import { MedicalRecordSearchService } from '../../src/modules/medical-record-search/medical-record-search.service';

describe('MedicalRecordSearchController', () => {
  let controller: MedicalRecordSearchController;
  let service: MedicalRecordSearchService;

  beforeEach(() => {
    service = {
      search: vi.fn(),
    } as any;

    controller = new MedicalRecordSearchController(service);
  });

  describe('search', () => {
    it('should return search results', async () => {
      const mockResults = {
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
        total: 5,
      };

      vi.mocked(service.search).mockResolvedValue(mockResults);

      const result = await controller.search('고혈압');

      expect(result.data.results).toHaveLength(1);
      expect(result.data.total).toBe(5);
    });

    it('should call search service with filters', async () => {
      const mockResults = { results: [], total: 0 };

      vi.mocked(service.search).mockResolvedValue(mockResults);

      await controller.search('고혈압', 'encounter', '2026-05-01', '2026-05-31', 'doc-1', '1', '20');

      expect(service.search).toHaveBeenCalledWith('고혈압', {
        type: 'encounter',
        dateFrom: '2026-05-01',
        dateTo: '2026-05-31',
        doctorId: 'doc-1',
        page: 1,
        limit: 20,
      });
    });

    it('should convert page and limit to numbers', async () => {
      const mockResults = { results: [], total: 0 };

      vi.mocked(service.search).mockResolvedValue(mockResults);

      await controller.search('진료', undefined, undefined, undefined, undefined, '2', '50');

      expect(service.search).toHaveBeenCalledWith('진료', expect.objectContaining({ page: 2, limit: 50 }));
    });

    it('should handle missing pagination parameters', async () => {
      const mockResults = { results: [], total: 0 };

      vi.mocked(service.search).mockResolvedValue(mockResults);

      await controller.search('진료');

      expect(service.search).toHaveBeenCalledWith(
        '진료',
        expect.objectContaining({
          page: undefined,
          limit: undefined,
        })
      );
    });

    it('should return empty results', async () => {
      vi.mocked(service.search).mockResolvedValue({ results: [], total: 0 });

      const result = await controller.search('xxx');

      expect(result.data.results).toEqual([]);
      expect(result.data.total).toBe(0);
    });

    it('should search across multiple record types', async () => {
      const mockResults = {
        results: [
          {
            id: 'enc-1',
            type: 'encounter',
            headline: '고혈압',
            patientName: '환자',
            doctorName: '의사',
            recordedAt: '2026-05-13T10:00:00Z',
          },
          {
            id: 'pn-1',
            type: 'progress_note',
            headline: '고혈압 추적',
            patientName: '환자',
            doctorName: '의사',
            recordedAt: '2026-05-13T11:00:00Z',
          },
        ],
        total: 2,
      };

      vi.mocked(service.search).mockResolvedValue(mockResults);

      const result = await controller.search('고혈압');

      expect(result.data.results).toHaveLength(2);
      expect(result.data.results.map((r: any) => r.type)).toContain('encounter');
      expect(result.data.results.map((r: any) => r.type)).toContain('progress_note');
    });
  });
});
