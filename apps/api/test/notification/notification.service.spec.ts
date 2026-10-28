import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationService } from '../../src/modules/notification/notification.service';

describe('NotificationService', () => {
  let service: NotificationService;
  let mockPrisma: any;

  const mockNotif = { id: 'n-1', userId: 'u-1', type: 'ALERT', title: '긴급', message: '바이탈 이상', isRead: false };

  beforeEach(() => {
    mockPrisma = {
      notification: {
        create: vi.fn().mockResolvedValue(mockNotif),
        findMany: vi.fn().mockResolvedValue([mockNotif]),
        update: vi.fn().mockResolvedValue({ ...mockNotif, isRead: true }),
        count: vi.fn().mockResolvedValue(5),
      },
    };
    service = new NotificationService(mockPrisma);
  });

  describe('create', () => {
    it('알림 생성', async () => {
      const result = await service.create('u-1', { type: 'ALERT', title: '긴급', message: '바이탈 이상' });
      expect(result.id).toBe('n-1');
      expect(mockPrisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ userId: 'u-1', severity: 'INFO' }),
      }));
    });

    it('severity 지정', async () => {
      await service.create('u-1', { type: 'ALERT', title: '긴급', message: 'msg', severity: 'CRITICAL' });
      expect(mockPrisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ severity: 'CRITICAL' }),
      }));
    });
  });

  describe('findByUser', () => {
    it('전체 알림 조회', async () => {
      const result = await service.findByUser('u-1');
      expect(result).toHaveLength(1);
    });

    it('읽지 않은 알림만', async () => {
      await service.findByUser('u-1', true);
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ isRead: false }),
      }));
    });
  });

  describe('markRead', () => {
    it('읽음 처리 — 소유자 스코프', async () => {
      mockPrisma.notification.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      await service.markRead('n-1', 'u-1');
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'n-1', userId: 'u-1' },
        data: expect.objectContaining({ isRead: true, readAt: expect.any(Date) }),
      }));
    });
  });

  describe('getUnreadCount', () => {
    it('읽지 않은 알림 수', async () => {
      const count = await service.getUnreadCount('u-1');
      expect(count).toBe(5);
    });
  });

  describe('getStream', () => {
    it('SSE Observable 반환', () => {
      const stream = service.getStream('u-1');
      expect(stream).toBeDefined();
      expect(stream.subscribe).toBeDefined();
    });
  });

  describe('pushNotification', () => {
    it('구독자에게 푸시', () => {
      // 먼저 stream을 열어서 subject 생성
      service.getStream('u-1');
      // pushNotification 호출 (에러 없이 완료)
      expect(() => service.pushNotification('u-1', { id: 'n-2', type: 'INFO', title: 'test', message: 'msg' })).not.toThrow();
    });

    it('구독자 없으면 무시', () => {
      expect(() => service.pushNotification('unknown', { id: 'n-3', type: 'INFO', title: 'test', message: 'msg' })).not.toThrow();
    });
  });
});
