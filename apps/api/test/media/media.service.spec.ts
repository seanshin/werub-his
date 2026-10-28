import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MediaService } from '../../src/modules/media/media.service';

describe('MediaService', () => {
  let service: MediaService;
  let p: any;

  beforeEach(() => {
    p = {
      mediaFile: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({ id: 'mf-1', url: '/media/test.png' }),
        create: vi.fn().mockResolvedValue({ id: 'mf-1' }),
        delete: vi.fn().mockResolvedValue({ id: 'mf-1' }),
      },
    };
    service = new MediaService(p);
  });

  it('findAll', async () => { await service.findAll({}); expect(p.mediaFile.findMany).toHaveBeenCalled(); });
  it('remove', async () => { await service.remove('mf-1'); expect(p.mediaFile.delete).toHaveBeenCalled(); });
  it('getStats', async () => { const r = await service.getStats(); expect(r).toBeDefined(); });
  it('getFolders', async () => { await service.getFolders(); expect(p.mediaFile.findMany).toHaveBeenCalled(); });
});
