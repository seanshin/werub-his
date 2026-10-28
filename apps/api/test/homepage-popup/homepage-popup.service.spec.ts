import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HomepagePopupService } from '../../src/modules/homepage-popup/homepage-popup.service';

describe('HomepagePopupService', () => {
  let service: HomepagePopupService;
  let p: any;
  const mock = { id: 'hp-1', title: '공지', isActive: true, targetPages: ['*'] };

  beforeEach(() => {
    p = { homepagePopup: { findMany: vi.fn().mockResolvedValue([mock]), findUnique: vi.fn().mockResolvedValue(mock), create: vi.fn().mockResolvedValue(mock), update: vi.fn().mockResolvedValue(mock), delete: vi.fn() } };
    service = new HomepagePopupService(p);
  });

  it('findAll', async () => { await service.findAll(); expect(p.homepagePopup.findMany).toHaveBeenCalled(); });
  it('findActive', async () => { await service.findActive('home'); expect(p.homepagePopup.findMany).toHaveBeenCalled(); });
  it('create', async () => { const r = await service.create({ title: '공지', type: 'MODAL', content: 'test', startDate: '2026-06-01', endDate: '2026-06-30' }, 'u-1'); expect(r.id).toBe('hp-1'); });
  it('toggleActive', async () => { await service.toggleActive('hp-1'); expect(p.homepagePopup.update).toHaveBeenCalled(); });
  it('remove', async () => { await service.remove('hp-1'); expect(p.homepagePopup.delete).toHaveBeenCalled(); });
});
