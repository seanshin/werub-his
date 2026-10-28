/**
 * 설정 목록·상세의 개발 시드 표식(2026-10-27).
 *  · 🔴 개발 시드 행은 출처 db 지만 원내가 정한 값이 아니다 — 목록·상세·단건 조회가 `seeded` 를 싣는다(시드 행일 때만)
 *  · 사람이 정한 행·기본값에는 없다
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { DEV_SEED_CONFIG_LABEL } from '@hospital-run/shared';
import { ConfigRuntimeService } from '../../src/modules/config/config-runtime.service';
import { ConfigRuntimeController } from '../../src/modules/config/config-runtime.controller';

const SEED_LABEL = `${DEV_SEED_CONFIG_LABEL} — 원내 규정 아님`;
const rows = [
  { key: 'nursing.restraint.checkIntervalMinutes', value: 120, category: 'nursing', label: SEED_LABEL, updatedAt: new Date(), updatedBy: null },
  { key: 'nursing.handoff.ackTakeOverMode', value: 'SEPARATE', category: 'nursing', label: '사람이 저장', updatedAt: new Date(), updatedBy: 'u1' },
  { key: 'zz.unregistered.seed', value: 1, category: 'nursing', label: SEED_LABEL, updatedAt: new Date(), updatedBy: null },
];
const prisma: any = {
  systemConfig: {
    findMany: vi.fn(async ({ where }: any) => (where?.key?.in ? rows.filter((r) => where.key.in.includes(r.key)) : rows)),
    findUnique: vi.fn(async ({ where }: any) => rows.find((r) => r.key === where.key) ?? null),
  },
};
const svc = new ConfigRuntimeService(prisma, { emit: vi.fn() } as never);

describe('🔴 설정 개발 시드 표식', () => {
  it('목록 — 시드 행(등재·미등재)만 seeded · 사람 행·기본값엔 없음', async () => {
    const list = await svc.getAll('nursing');
    const by = (k: string) => list.find((e) => e.key === k)!;
    expect(by('nursing.restraint.checkIntervalMinutes')).toMatchObject({ source: 'db', seeded: true });
    expect(by('zz.unregistered.seed')).toMatchObject({ registered: false, seeded: true });
    expect('seeded' in by('nursing.handoff.ackTakeOverMode')).toBe(false);
    expect('seeded' in by('nursing.pain.reassessRule')).toBe(false); // 행 없음 = 기본값
  });
  it('상세(describeMany)·단건 조회 meta 도 같은 표식', async () => {
    const m = await svc.describeMany(['nursing.restraint.checkIntervalMinutes', 'nursing.handoff.ackTakeOverMode']);
    expect(m.get('nursing.restraint.checkIntervalMinutes')!.seeded).toBe(true);
    expect(m.get('nursing.handoff.ackTakeOverMode')!.seeded).toBeUndefined();
    const ctl = Object.create(ConfigRuntimeController.prototype);
    ctl.configService = svc;
    expect((await ctl.get('nursing.restraint.checkIntervalMinutes')).meta).toEqual({ source: 'db', registered: true, seeded: true });
    expect((await ctl.get('nursing.handoff.ackTakeOverMode')).meta).toEqual({ source: 'db', registered: true });
  });
});
