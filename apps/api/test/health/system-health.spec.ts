/**
 * 관리자 대시보드 '시스템 상태' 서버 점검(2026-10-02).
 * 🔴 위젯이 "API/DB/Redis 상태"라 적어 놓고 `/health`(살아 있음)만 물어 개통 이래 "데이터 없음"이었다.
 *    `/health/ready` 는 외부 경로에 열려 있지 않다 → 같은 점검을 `/api/v1/system-health`(관리자)로.
 * 재주입: 실패를 ok 로 접으면, 관리자 외에 열면, 실패 사유 문자열을 내보내면 실패한다.
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { HIS_VERSION } from '@hospital-run/shared';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { SystemHealthController } from '../../src/modules/health/system-health.controller';

const make = (db: () => Promise<unknown>, redis: () => Promise<unknown>) =>
  new SystemHealthController({ $queryRaw: vi.fn(db) } as never, { ping: vi.fn(redis) } as never);

describe('SystemHealthController', () => {
  it('DB·Redis 가 응답하면 ok · 버전은 정본', async () => {
    const { data } = await make(() => Promise.resolve([{ 1: 1 }]), () => Promise.resolve('PONG')).check();
    expect(data).toMatchObject({ api: 'ok', db: 'ok', redis: 'ok', version: HIS_VERSION });
    expect(typeof data.checkedAt).toBe('string');
  });

  it('🔴 DB 실패를 ok 로 접지 않는다 — 다른 점검은 각자 말한다', async () => {
    const { data } = await make(() => Promise.reject(new Error('connection refused 10.0.0.3:5432')), () => Promise.resolve('PONG')).check();
    expect(data.db).toBe('error');
    expect(data.redis).toBe('ok');
    // 실패 사유(내부 주소 등)는 내보내지 않는다
    expect(JSON.stringify(data)).not.toContain('10.0.0.3');
  });

  it('🔴 Redis 실패도 error', async () => {
    const { data } = await make(() => Promise.resolve([]), () => Promise.reject(new Error('x'))).check();
    expect(data).toMatchObject({ db: 'ok', redis: 'error' });
  });

  it('관리자 전용 · /api/v1 아래', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, SystemHealthController.prototype.check);
    expect(roles).toEqual([UserRole.ADMIN]);
    expect(Reflect.getMetadata('path', SystemHealthController)).toBe('api/v1/system-health');
  });
});
