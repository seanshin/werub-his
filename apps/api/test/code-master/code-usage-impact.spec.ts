import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CodeUsageService } from '../../src/modules/code-master/code-usage.service';

/**
 * 🔴 코드를 중지하기 전에 **무엇이 깨지는지** 볼 수 있어야 한다(2026-08-26 · C1).
 *    종전에는 `delete*` 가 곧바로 `isActive:false` 였고, 그 코드를 쓰던 처방·오더·문제목록이
 *    조용히 깨졌다. 무엇이 깨졌는지 아무도 몰랐다.
 *
 * 🔴 참조 목록을 **손으로 적지 않는다** — 실측에서 손으로 세면
 *    `FamilyHistory`·`PreOrder.medicationCodeId` 를 놓쳤다. 하나라도 빠지면
 *    "사용처 없음"이라 말하고 중지하게 된다.
 */
const SVC = join(process.cwd(), 'src/modules/code-master/code-usage.service.ts');
const MASTER = join(process.cwd(), 'src/modules/code-master/code-master.service.ts');

const prismaWith = (counts: Record<string, number | Error>) => {
  const h: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(counts)) {
    h[k] = { count: vi.fn().mockImplementation(() => (v instanceof Error ? Promise.reject(v) : Promise.resolve(v))) };
  }
  return new Proxy(h, { get: (t, p) => (t as Record<string, unknown>)[p as string] ?? { count: vi.fn().mockResolvedValue(0) } }) as never;
};

describe('코드 사용처(변경 영향)', () => {
  it('🔴 참조 목록을 Prisma 메타데이터에서 뽑는다(손으로 적지 않는다)', () => {
    const src = readFileSync(SVC, 'utf8');
    expect(src).toContain('Prisma.dmmf.datamodel.models');
    expect(src).toMatch(/relationFromFields/);
  });

  it('사용처가 전부 0이면 중지해도 안전하다고 말한다', async () => {
    const svc = new CodeUsageService(prismaWith({}) );
    const u = await svc.getUsage('diagnosis', 'x');
    expect(u.total).toBe(0);
    expect(u.safeToDeactivate).toBe(true);
    expect(u.refs.length, '참조 모델을 하나도 찾지 못했다면 유도가 죽은 것이다').toBeGreaterThan(0);
  });

  it('🔴 하나라도 세지 못하면 "안전"이라고 말하지 않는다', async () => {
    const svc = new CodeUsageService(prismaWith({ prescription: new Error('db down') }));
    const u = await svc.getUsage('diagnosis', 'x');
    expect(u.total, '못 셌는데 합계를 냈다').toBeNull();
    expect(u.safeToDeactivate).toBe(false);
    expect(u.countedRefs).toBeLessThan(u.totalRefs);
  });

  it('사용 중이면 건수를 그대로 낸다', async () => {
    const svc = new CodeUsageService(prismaWith({ prescription: 3, encounterDiagnosis: 2 }));
    const u = await svc.getUsage('diagnosis', 'x');
    expect(u.total).toBe(5);
    expect(u.safeToDeactivate).toBe(false);
  });

  it('알 수 없는 코드 종류는 조용히 통과시키지 않는다', async () => {
    const svc = new CodeUsageService(prismaWith({}));
    await expect(svc.getUsage('unknown', 'x')).rejects.toThrow();
  });
});

describe('중지 가드', () => {
  const src = readFileSync(MASTER, 'utf8');

  it('🔴 세 종류 모두 중지 전 확인을 거친다', () => {
    for (const k of ['deleteDiagnosis', 'deleteProcedure', 'deleteMedication']) {
      const i = src.indexOf(`async ${k}(`);
      expect(i, `${k} 없음`).toBeGreaterThan(0);
      expect(src.slice(i, i + 260), `${k} 가 확인 없이 중지한다`).toContain('assertDeactivatable');
    }
  });

  it('🔴 강행(force)에는 사유가 필요하다', () => {
    expect(src).toContain('CODE_DEACTIVATE_REASON_REQUIRED');
  });

  it('🔴 못 센 경우와 사용 중인 경우를 다른 코드로 말한다', () => {
    expect(src).toContain('CODE_USAGE_UNKNOWN');
    expect(src).toContain('CODE_IN_USE');
  });

  it('대조군 — 사용처가 없으면 그대로 중지된다(막기만 하지 않는다)', () => {
    expect(src).toMatch(/if \(usage\.safeToDeactivate\) return usage;/);
  });
});
