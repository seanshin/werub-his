import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CmsConfigService } from '../../src/modules/cms-config/cms-config.service';

describe('CmsConfigService', () => {
  let service: CmsConfigService;
  let p: any;

  beforeEach(() => {
    p = {
      cmsCategory: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: 'cc-1' }), update: vi.fn(), delete: vi.fn() },
      cmsMenu: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: 'cm-1' }), update: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    };
    service = new CmsConfigService(p);
  });

  it('getCategories', async () => { await service.getCategories(); expect(p.cmsCategory.findMany).toHaveBeenCalled(); });
  it('createCategory', async () => { const r = await service.createCategory({ code: 'news', name: '뉴스' }); expect(r.id).toBe('cc-1'); });
  it('deleteCategory', async () => { await service.deleteCategory('cc-1'); expect(p.cmsCategory.delete).toHaveBeenCalled(); });
  it('getMenus', async () => { await service.getMenus('header'); expect(p.cmsMenu.findMany).toHaveBeenCalled(); });
  it('createMenu', async () => { const r = await service.createMenu({ menuGroup: 'header', label: '진료안내' }); expect(r.id).toBe('cm-1'); });
});
