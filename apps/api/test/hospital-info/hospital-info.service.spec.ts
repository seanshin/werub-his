import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HospitalInfoService } from '../../src/modules/hospital-info/hospital-info.service';

describe('HospitalInfoService', () => {
  let service: HospitalInfoService;
  let p: any;
  const mock = { id: 'hi-1', title: '안내', category: 'notice', isPublished: true, slug: 'test' };

  beforeEach(() => {
    p = {
      hospitalInfoContent: { findMany: vi.fn().mockResolvedValue([mock]), findUnique: vi.fn().mockResolvedValue(mock), findFirst: vi.fn().mockResolvedValue(mock), create: vi.fn().mockResolvedValue(mock), update: vi.fn().mockResolvedValue(mock), delete: vi.fn(), count: vi.fn().mockResolvedValue(5), updateMany: vi.fn(), createMany: vi.fn() },
      hospitalInfoAudit: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue({ id: 'a-1', snapshot: {} }), findFirst: vi.fn().mockResolvedValue({ id: 'a-1', snapshot: {} }), create: vi.fn() },
      user: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue({ id: 'u-1', familyName: '김', givenName: '의사' }) },
      doctorProfile: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({ id: 'dp-1' }) },
      seoEntry: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({ id: 'se-1' }) },
    };
    service = new HospitalInfoService(p);
  });

  it('findAll', async () => { await service.findAll({}); expect(p.hospitalInfoContent.findMany).toHaveBeenCalled(); });
  it('findById', async () => { await service.findById('hi-1'); expect(p.hospitalInfoContent.findUnique).toHaveBeenCalled(); });
  it('findBySlug', async () => { await service.findBySlug('notice', 'test'); expect(p.hospitalInfoContent.findUnique).toHaveBeenCalled(); });
  it('create', async () => { const r = await service.create({ title: '공지', category: 'notice', content: 'test' } as any, 'u-1'); expect(r).toBeDefined(); });
  it('toggle', async () => { await service.toggle('hi-1', 'u-1'); expect(p.hospitalInfoContent.update).toHaveBeenCalled(); });
  it('findPublic', async () => { await service.findPublic('notice'); expect(p.hospitalInfoContent.findMany).toHaveBeenCalled(); });
  it('searchPublic', async () => { await service.searchPublic('안내'); expect(p.hospitalInfoContent.findMany).toHaveBeenCalled(); });

  /**
   * 🔴 (2026-09-03) 종전 복원은 publishFrom/publishUntil/editableDepts 를 아예 쓰지 않았고,
   *    스냅샷에 없는 키는 조용히 건너뛰며 "복원 완료"처럼 보였다 — 부분 복원을 밝힌다.
   */
  describe('restoreVersion — 부분 복원을 완전 복원처럼 말하지 않는다', () => {
    it('🔴 게시 기간·편집 권한까지 복원한다(JSON 문자열 날짜 → Date)', async () => {
      p.hospitalInfoAudit.findFirst.mockResolvedValue({
        id: 'a-1',
        snapshot: {
          title: '옛 제목', content: '옛 본문', metadata: {}, sortOrder: 1, tags: [], imageUrl: null,
          isPinned: false, isActive: true,
          publishFrom: '2026-01-01T00:00:00.000Z', publishUntil: null, editableDepts: ['원무과'],
        },
      });
      const r = await service.restoreVersion('hi-1', 'a-1', 'u-1');
      const data = p.hospitalInfoContent.update.mock.calls.at(-1)[0].data;
      expect(data.publishFrom).toBeInstanceOf(Date);
      expect(data.publishUntil).toBeNull();
      expect(data.editableDepts).toEqual(['원무과']);
      expect((r as { restoreSkippedFields: string[] }).restoreSkippedFields).toEqual([]);
    });

    it('🔴 스냅샷에 없는 필드는 조용히 넘어가지 않고 restoreSkippedFields 로 말한다', async () => {
      p.hospitalInfoAudit.findFirst.mockResolvedValue({
        id: 'a-2',
        snapshot: { title: '구형 스냅샷', content: '본문' }, // 구형 — 나머지 필드 부재
      });
      const r = await service.restoreVersion('hi-1', 'a-2', 'u-1');
      const skipped = (r as { restoreSkippedFields: string[] }).restoreSkippedFields;
      expect(skipped).toContain('publishFrom');
      expect(skipped).toContain('editableDepts');
      expect(skipped).not.toContain('title');
    });
  });
});
