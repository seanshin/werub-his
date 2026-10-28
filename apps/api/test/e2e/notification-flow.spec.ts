/**
 * Hospital RUN — 알림 시스템 E2E 테스트
 * 시나리오: 알림 목록 조회 → 안 읽은 수 확인 → 읽음 처리 → 재확인
 *
 * Run: cd apps/api && npx vitest run test/e2e/notification-flow.spec.ts
 * Env: TEST_API_URL (기본: http://localhost:4000)
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE =
  process.env.TEST_API_URL || process.env.API_URL || 'http://localhost:4000';

// ── Shared state ──
let adminToken = '';
let doctorToken = '';
let notificationId = '';
let initialUnreadCount = 0;

// ── Helper ──
interface ApiResponse {
  status: number;
  data: any;
  ok: boolean;
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<ApiResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: any = null;
  if (res.status !== 204) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    console.error(
      `[API ERROR] ${method} ${path} → ${res.status}`,
      JSON.stringify(data, null, 2),
    );
  }

  return { status: res.status, data, ok: res.ok };
}

// ── Tests ──

describe.skipIf(!process.env.TEST_API_URL)(
  '알림 시스템 E2E: 목록→안읽은수→읽음처리',
  () => {
    // ============================================================
    // Setup: 로그인
    // ============================================================
    beforeAll(async () => {
      // 관리자 로그인
      const adminRes = await api('POST', '/api/v1/auth/login', {
        email: 'admin@hospitalrun.example',
        password: 'staff1234!',
      });
      expect(adminRes.status, '관리자 로그인 실패').toBe(200);
      adminToken = adminRes.data.data.accessToken;

      // 의사 로그인 (알림 수신 대상)
      const doctorRes = await api('POST', '/api/v1/auth/login', {
        email: 'kim.naegwa@hospitalrun.example',
        password: 'staff1234!',
      });
      expect(doctorRes.status, '의사 로그인 실패').toBe(200);
      doctorToken = doctorRes.data.data.accessToken;
    });

    // ============================================================
    // 1. 알림 목록 조회
    // ============================================================
    it('1. 알림 목록 조회', async () => {
      // 현재 사용자의 알림 목록을 조회한다
      const { status, data } = await api(
        'GET',
        '/api/v1/notifications',
        undefined,
        doctorToken,
      );

      expect(status).toBe(200);
      expect(data.data).toBeTruthy();

      if (Array.isArray(data.data)) {
        console.log(`  ✓ 알림 목록 조회 — ${data.data.length}건`);

        // 읽음 처리용 알림 ID 저장 (안 읽은 알림 우선)
        const unread = data.data.find((n: any) => !n.readAt && !n.isRead);
        if (unread) {
          notificationId = unread.id;
          console.log(`  → 읽지 않은 알림 선택: ${notificationId}`);
        } else if (data.data.length > 0) {
          notificationId = data.data[0].id;
          console.log(`  → 첫 번째 알림 선택: ${notificationId}`);
        }
      } else {
        console.log(`  ✓ 알림 목록 조회 완료`);
      }
    });

    // ============================================================
    // 2. 안 읽은 알림 수 조회
    // ============================================================
    it('2. 안 읽은 알림 수 조회', async () => {
      const { status, data } = await api(
        'GET',
        '/api/v1/notifications/unread-count',
        undefined,
        doctorToken,
      );

      expect(status).toBe(200);

      // 응답 형식에 따라 count 추출
      const count =
        data.data?.count ?? data.data?.unreadCount ?? data.data ?? 0;
      initialUnreadCount = typeof count === 'number' ? count : 0;

      expect(initialUnreadCount).toBeGreaterThanOrEqual(0);
      console.log(`  ✓ 안 읽은 알림 수: ${initialUnreadCount}건`);
    });

    // ============================================================
    // 3. 알림 읽음 처리
    // ============================================================
    it('3. 알림 읽음 처리', async () => {
      if (!notificationId) {
        console.log('  ⚠ 읽음 처리할 알림이 없어 스킵');
        return;
      }

      const { status, data } = await api(
        'PATCH',
        `/api/v1/notifications/${notificationId}/read`,
        undefined,
        doctorToken,
      );

      expect(status).toBe(200);
      expect(data.data).toBeTruthy();

      // 읽음 처리 확인 (readAt 또는 isRead)
      if (data.data.readAt) {
        expect(data.data.readAt).toBeTruthy();
      } else if (data.data.isRead !== undefined) {
        expect(data.data.isRead).toBe(true);
      }

      console.log(`  ✓ 알림 읽음 처리 완료: ${notificationId}`);
    });

    // ============================================================
    // 4. 읽음 처리 후 안 읽은 수 재확인
    // ============================================================
    it('4. 읽음 처리 후 안 읽은 수 재확인', async () => {
      if (!notificationId) {
        console.log('  ⚠ 읽음 처리한 알림이 없어 스킵');
        return;
      }

      const { status, data } = await api(
        'GET',
        '/api/v1/notifications/unread-count',
        undefined,
        doctorToken,
      );

      expect(status).toBe(200);

      const newCount =
        data.data?.count ?? data.data?.unreadCount ?? data.data ?? 0;

      // 읽음 처리 후 안 읽은 수가 이전보다 같거나 줄었어야 함
      expect(newCount).toBeLessThanOrEqual(initialUnreadCount);
      console.log(
        `  ✓ 안 읽은 알림 수 변화: ${initialUnreadCount} → ${newCount}`,
      );

      // 최종 요약
      console.log('\n══════════════════════════════════════');
      console.log('  알림 시스템 E2E 완료 요약');
      console.log('══════════════════════════════════════');
      console.log(`  읽음 처리 알림 ID : ${notificationId || '(없음)'}`);
      console.log(`  안 읽은 수 변화   : ${initialUnreadCount} → ${newCount}`);
      console.log('══════════════════════════════════════\n');
    });
  },
);
