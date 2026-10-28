import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useNotificationStore } from '@/stores/notification-store';
import { act } from '@testing-library/react';

// Mock apiClient
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    patch: vi.fn().mockResolvedValue({}),
    getToken: vi.fn().mockReturnValue('test-token'),
  },
}));

describe('NotificationStore', () => {
  beforeEach(() => {
    const store = useNotificationStore.getState();
    // Reset state
    useNotificationStore.setState({
      notifications: [],
      unreadCount: 0,
      isOpen: false,
      sseAbortController: null,
    });
  });

  it('should initialize with empty state', () => {
    const state = useNotificationStore.getState();
    expect(state.notifications).toHaveLength(0);
    expect(state.unreadCount).toBe(0);
    expect(state.isOpen).toBe(false);
  });

  it('should toggle panel open/close', () => {
    const { toggle } = useNotificationStore.getState();
    act(() => toggle());
    expect(useNotificationStore.getState().isOpen).toBe(true);
    act(() => toggle());
    expect(useNotificationStore.getState().isOpen).toBe(false);
  });

  it('should mark notification as read', () => {
    useNotificationStore.setState({
      notifications: [
        { id: 'n-1', type: 'order', title: '오더 알림', message: '테스트', read: false, createdAt: new Date().toISOString() },
        { id: 'n-2', type: 'lab', title: '검사 알림', message: '테스트2', read: false, createdAt: new Date().toISOString() },
      ],
      unreadCount: 2,
    });

    act(() => useNotificationStore.getState().markRead('n-1'));

    const state = useNotificationStore.getState();
    expect(state.notifications[0].read).toBe(true);
    expect(state.notifications[1].read).toBe(false);
    expect(state.unreadCount).toBe(1);
  });

  it('should mark all as read', () => {
    useNotificationStore.setState({
      notifications: [
        { id: 'n-1', type: 'order', title: '알림1', message: 'msg', read: false, createdAt: new Date().toISOString() },
        { id: 'n-2', type: 'lab', title: '알림2', message: 'msg', read: false, createdAt: new Date().toISOString() },
      ],
      unreadCount: 2,
    });

    act(() => useNotificationStore.getState().markAllRead());

    const state = useNotificationStore.getState();
    expect(state.notifications.every(n => n.read)).toBe(true);
    expect(state.unreadCount).toBe(0);
  });

  it('should close panel', () => {
    useNotificationStore.setState({ isOpen: true });
    act(() => useNotificationStore.getState().close());
    expect(useNotificationStore.getState().isOpen).toBe(false);
  });
});
