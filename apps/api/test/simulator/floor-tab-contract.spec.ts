import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FloorService } from '../../src/modules/floor/floor.service';

/**
 * 🔴 시뮬레이터 '플로어맵' 탭 ↔ `/api/floor/*` 응답 모양(2026-09-28).
 * 서버는 `{ floors }`·`{ zones }`·`{ entities }`·`{ stats }` 로 감싸는데 화면은 배열로 읽어 탭을 열면 `floors.map` 에서 터졌다.
 * 서버 쪽은 실제 서비스 반환으로, 화면 쪽은 소스로 대조한다.
 */
const page = readFileSync(join(__dirname, '../../../web/src/app/(main)/simulator/page.tsx'), 'utf8');

describe('플로어맵 탭 계약', () => {
  it('서버 반환 키(실제 서비스 호출)', async () => {
    const prisma: any = {
      spaceNode: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null) },
      patientLocation: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    };
    const svc = new FloorService(prisma);
    expect(Object.keys(await svc.getFloorPlans())).toEqual(['floors']);
    expect(await svc.getZones('X')).toEqual({ zones: [] });
    expect(await svc.getEntities('X')).toMatchObject({ entities: [] });
    expect(await svc.getStats('X')).toEqual({ stats: [] });
  });
  it('화면이 같은 키로 읽는다 · 배열로 읽지 않는다', () => {
    expect(page).toMatch(/floorsRes\?\.data\?\.floors \?\? \[\]/);
    expect(page).toMatch(/zonesRes\?\.data\?\.zones \?\? \[\]/);
    expect(page).toMatch(/entitiesRes\?\.data\?\.entities \?\? \[\]/);
    expect(page).toMatch(/statsRes\?\.data\?\.stats \?\? null/);
    expect(page).not.toMatch(/(floors|zones|entities)Res\?\.data \?\? \[\]/);
    expect(page).not.toMatch(/JSON\.stringify\(value\)/);
  });
});
