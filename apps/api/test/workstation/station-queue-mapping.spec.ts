import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { WorkstationService } from '../../src/modules/workstation/workstation.service';

/**
 * 워크스테이션 큐 매핑 계약 — 2026-08-12 (화면 점검 W1 · 패턴 P4 서버판).
 *
 * 🔴 `STATION_DEPT_MAP[stationId] ?? 'LAB'` 폴백 때문에 **등재되지 않은 스테이션이 남의 검사 오더를
 *    자기 업무로 보여줬다.** 퇴원 워크스테이션이 "대기 중인 퇴원 업무"라며 HbA1c·CRP 를 띄우고 있었다
 *    (2026-08-12 실측 12스테이션). 같은 폴백 버그가 영양·약국에서 이미 두 번 고쳐졌는데도 남아 있었다.
 *
 * 임상 워크리스트에서 **틀린 목록은 빈 목록보다 나쁘다** — 사람이 그 목록을 보고 조치한다.
 */

function svc() {
  const prisma = {
    workstationConfig: { findUnique: vi.fn().mockResolvedValue(null) },
    order: { findMany: vi.fn().mockResolvedValue([]) },
    therapyOrder: { findMany: vi.fn().mockResolvedValue([]) },
    mealOrder: { findMany: vi.fn().mockResolvedValue([]) },
  } as never;
  return { s: new WorkstationService(prisma), prisma: prisma as unknown as { order: { findMany: ReturnType<typeof vi.fn> } } };
}

describe('워크스테이션 큐 — 스테이션 매핑', () => {
  it('🔴 미등재 스테이션에 검사(LAB) 오더를 주지 않는다', async () => {
    for (const id of ['discharge', 'icu', 'reception', 'blood-bank', 'cssd', 'equipment', 'infection-control']) {
      const { s, prisma } = svc();
      const r = await s.getQueue(id);
      expect(r, `${id}: 미등재인데 목록이 나온다`).toEqual([]);
      expect(prisma.order.findMany, `${id}: 오더를 조회하면 안 된다`).not.toHaveBeenCalled();
    }
  });

  it('🔴 영상 스테이션은 IMAGING 오더를 본다 — `imaging-xray` 별칭 포함', async () => {
    for (const id of ['imaging-xray', 'img-xray', 'img-ct']) {
      const { s, prisma } = svc();
      await s.getQueue(id);
      const where = prisma.order.findMany.mock.calls[0]?.[0]?.where;
      expect(where?.department, `${id} 이 IMAGING 이 아니다`).toBe('IMAGING');
    }
  });

  it('🔴 미배선 스테이션은 meta 로 그 사실을 밝힌다 — 빈 목록이 "한가하다"는 뜻이 아니다', async () => {
    const { s } = svc();
    const h = await s.getStationConfigHealth('reception');
    expect(h.queueWired, 'reception 은 아직 도메인 큐가 없다').toBe(false);
  });

  it('배선된 스테이션은 wired 로 보고한다', async () => {
    const { s } = svc();
    for (const id of ['lab-hematology', 'pharmacy', 'therapy-pt', 'nutrition']) {
      expect((await s.getStationConfigHealth(id)).queueWired, `${id} 가 미배선으로 보고된다`).toBe(true);
    }
  });

  it('검사 스테이션은 그대로 LAB 을 본다(회귀 방지)', async () => {
    const { s, prisma } = svc();
    await s.getQueue('lab-hematology');
    expect(prisma.order.findMany.mock.calls[0][0].where.department).toBe('LAB');
  });

  it('🔴 치료실은 `therapy-` 접두도 치료 큐로 간다(LAB 폴백 금지)', async () => {
    const { s, prisma } = svc();
    await s.getQueue('therapy-pt');
    expect(prisma.order.findMany, '치료실이 오더 큐를 조회하면 안 된다').not.toHaveBeenCalled();
  });

  it('🔴 FE 가 부르는 모든 stationId 가 처리 경로를 갖는다(조용한 폴백 금지)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'modules', 'workstation', 'workstation.service.ts'),
      'utf-8',
    );
    // 폴백이 되살아나면 실패
    expect(src, "`?? 'LAB'` 폴백이 되살아났다").not.toMatch(/STATION_DEPT_MAP\[stationId\]\s*\?\?\s*'LAB'/);
    expect(src, '미매핑 조기 반환이 사라졌다').toMatch(/if \(!dept\) return \[\];/);
  });
});
