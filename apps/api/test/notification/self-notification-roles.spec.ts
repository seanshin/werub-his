/**
 * 🔴 자기 알림은 **모든 직원의 것**이다 — 역할이 빠지면 그 직군은 알림을 하나도 못 받는다.
 *
 * 2026-08-21 사람 신고(급양 계정 로그인)로 드러났다. 운영 실측(배포 전):
 *   NUTRITION·RECEPTIONIST·MEDICAL_RECORDS·CHECKUP·ADMIN_STAFF·CRM_MANAGER·EXECUTIVE
 *   → `/api/v1/notifications` **전원 403**.
 * 그런데 `(main)` 레이아웃은 **전 직군에 SSE 를 연결**하고 `/notifications`(2906) 화면도
 * 전 직군(`EVERY_ROLE`)에 열려 있다 — 화면은 열리는데 목록은 403 이었다.
 * v3.96 에서 지원 직군을 신설할 때 이 EP 가 따라가지 않았다
 * (🔴 "placeholder 역할은 API 배선 실측 필수" — 그 실측이 여기선 안 됐다).
 *
 * 재주입: `SELF_NOTIFICATION_ROLES` 에서 역할을 빼거나 EP 의 `@Roles` 를 되돌리면 실패한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const CONTROLLER = join(__dirname, '../../src/modules/notification/notification.controller.ts');
const SIDEBAR = join(__dirname, '../../../web/src/components/layout/Sidebar.tsx');

/** 자기 알림을 받아야 하는 직원 역할 — 환자·시스템 계정은 제외 */
const STAFF_ROLES = [
  'DOCTOR', 'NURSE', 'PHARMACIST', 'LAB_TECH', 'ADMIN',
  'NUTRITION', 'RECEPTIONIST', 'ADMIN_STAFF', 'MEDICAL_RECORDS',
  'CHECKUP', 'CRM_MANAGER', 'CRM_STAFF', 'EXECUTIVE', 'READ',
];

describe('자기 알림 역할', () => {
  const src = readFileSync(CONTROLLER, 'utf8');

  it('🔴 `SELF_NOTIFICATION_ROLES` 가 전 직원 14역할을 담는다', () => {
    const m = src.match(/const SELF_NOTIFICATION_ROLES = \[([\s\S]*?)\] as const;/);
    expect(m, '상수를 찾지 못했다').toBeTruthy();
    const roles = [...m![1].matchAll(/UserRole\.(\w+)/g)].map((x) => x[1]);
    const missing = STAFF_ROLES.filter((r) => !roles.includes(r));
    expect(missing, `자기 알림에서 빠진 직군: ${missing.join(', ')}`).toEqual([]);
  });

  it('🔴 자기 알림 EP 들이 그 상수를 쓴다 — 역할을 EP 마다 다시 적지 않는다', () => {
    // 목록·미읽음수·읽음처리·전체읽음·SSE 스트림
    const selfEps = ['@Sse(\'stream\')', '@Get()', '@Get(\'unread-count\')', '@Patch(\'read-all\')', '@Patch(\':id/read\')'];
    for (const ep of selfEps) {
      const i = src.indexOf(ep);
      expect(i, `${ep} 를 찾지 못했다`).toBeGreaterThan(-1);
      const after = src.slice(i, i + 200);
      expect(after, `${ep} 가 자기 알림 역할 정본을 쓰지 않는다`).toContain('SELF_NOTIFICATION_ROLES');
    }
  });

  it('관제성 EP 는 좁힌 채로 둔다 — 남의 알림 통계는 성격이 다르다', () => {
    for (const ep of ["@Get('registry')", "@Get('patient-push/settings')"]) {
      const i = src.indexOf(ep);
      expect(i, `${ep}`).toBeGreaterThan(-1);
      const after = src.slice(i, i + 200);
      expect(after, `${ep} 가 넓어졌다`).not.toContain('SELF_NOTIFICATION_ROLES');
      expect(after).toContain('UserRole.ADMIN');
    }
  });

  it('🔴 `/notifications` 화면이 열린 직군과 API 가 어긋나지 않는다', () => {
    const nav = readFileSync(SIDEBAR, 'utf8');
    const m = nav.match(/\{ href: '\/notifications'[^}]*roles: (\w+)/);
    expect(m, '/notifications nav 항목을 찾지 못했다').toBeTruthy();
    // 화면이 EVERY_ROLE 이면 API 도 전 직원이어야 한다(그렇지 않으면 화면은 열리고 목록은 403)
    if (m![1] === 'EVERY_ROLE') {
      const roles = [...src.match(/const SELF_NOTIFICATION_ROLES = \[([\s\S]*?)\] as const;/)![1].matchAll(/UserRole\.(\w+)/g)].map((x) => x[1]);
      expect(STAFF_ROLES.every((r) => roles.includes(r)), '화면은 전 직군인데 API 가 좁다').toBe(true);
    }
  });
});
