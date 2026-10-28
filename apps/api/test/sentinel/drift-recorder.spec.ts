import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DriftRecorderService } from '../../src/sentinel/drift-recorder.service';
import { SentinelService } from '../../src/sentinel/sentinel.service';
import { SentinelReadService } from '../../src/sentinel/sentinel-read.service';
import { CONTRACT_OBSERVATION_POINTS } from '../../src/sentinel/contract-observation';

const SRC = join(process.cwd(), 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const strip = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * 축 C — 계약 드리프트.
 *
 * 🔴 실측 01번: 롤업이 `bed.summary.totalBeds` 를 `'total'` 로 읽어 분모를 잃었고
 *    화면은 "산출 불가 — 등록 병상 없음"이라 그렸다(운영엔 병상 57개).
 *    그때 남은 것은 **로그 한 줄**이라 아무도 보지 않았다 — 이제 원장에 남는다.
 */
describe('드리프트 기록기 — 요청 경로를 막지 않고 한 줄로 접는다', () => {
  const mkPrisma = (over: Record<string, unknown> = {}) => ({
    sentinelRuntimeSignal: {
      upsert: vi.fn(async () => ({})),
      findMany: vi.fn(async () => []),
    },
    ...over,
  });

  it('record 는 DB 를 건드리지 않는다 — 임상 요청이 감시 때문에 느려지면 안 된다', () => {
    const prisma = mkPrisma();
    const rec = new DriftRecorderService(prisma as never);
    rec.record({ kind: 'KEY_MISSING', producer: 'bed-board.summary', consumer: 'command-center.buildKpi', detail: "읽은 키 'total'" });
    expect(prisma.sentinelRuntimeSignal.upsert).not.toHaveBeenCalled();
    expect(rec.pendingCount()).toBe(1);
  });

  it('🔴 같은 드리프트는 한 줄로 접고 횟수로 규모를 말한다', async () => {
    const prisma = mkPrisma();
    const rec = new DriftRecorderService(prisma as never);
    for (let i = 0; i < 143; i += 1) {
      rec.record({ kind: 'KEY_MISSING', producer: 'bed-board.summary', consumer: 'command-center.buildKpi', detail: 'x' });
    }
    expect(rec.pendingCount(), '143번 관측이 143줄이 되면 로그 홍수가 원장으로 옮겨간 것뿐이다').toBe(1);
    await rec.flush();
    expect(prisma.sentinelRuntimeSignal.upsert).toHaveBeenCalledTimes(1);
    const arg = prisma.sentinelRuntimeSignal.upsert.mock.calls[0][0] as { create: { hitCount: number }; update: { hitCount: { increment: number } } };
    expect(arg.create.hitCount).toBe(143);
    expect(arg.update.hitCount.increment).toBe(143);
  });

  it('생산자·소비자·종류가 다르면 다른 줄이다', async () => {
    const prisma = mkPrisma();
    const rec = new DriftRecorderService(prisma as never);
    rec.record({ kind: 'KEY_MISSING', producer: 'a', consumer: 'x', detail: '' });
    rec.record({ kind: 'KEY_MISSING', producer: 'b', consumer: 'x', detail: '' });
    rec.record({ kind: 'NULL_FOLDED', producer: 'a', consumer: 'x', detail: '' });
    expect(rec.pendingCount()).toBe(3);
  });

  it('🔴 적재 실패를 삼키지 않는다 — 여기서 조용히 접으면 기록기 자신이 결함이 된다', async () => {
    const prisma = mkPrisma({
      sentinelRuntimeSignal: {
        upsert: vi.fn(async () => { throw new Error('디스크 오류'); }),
        findMany: vi.fn(async () => []),
      },
    });
    const rec = new DriftRecorderService(prisma as never);
    rec.record({ kind: 'KEY_MISSING', producer: 'a', consumer: 'x', detail: '' });
    const r = await rec.flush();
    expect(r.attempted).toBe(1);
    expect(r.succeeded).toBe(0);
    expect(r.failed).toBe(1);
  });

  it('flush 는 모아둔 것을 비운다(두 번 세지 않는다)', async () => {
    const prisma = mkPrisma();
    const rec = new DriftRecorderService(prisma as never);
    rec.record({ kind: 'KEY_MISSING', producer: 'a', consumer: 'x', detail: '' });
    await rec.flush();
    await rec.flush();
    expect(prisma.sentinelRuntimeSignal.upsert).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 배선 — 주입이 빠지면 조용히 아무것도 안 남는다', () => {
  it('상황판이 키 불일치를 원장에 적는다(로그만 남기지 않는다)', () => {
    const src = strip(read('modules/command-center/command-center.service.ts'));
    expect(src, 'warnMissing 이 기록기를 부르지 않는다').toMatch(/this\.drift\?\.record\(/);
    expect(src, "KEY_MISSING 종류로 적어야 한다").toMatch(/kind: 'KEY_MISSING'/);
  });

  it('🔴 SentinelModule 이 실제로 물려 있다 — @Optional() 주입은 빠져도 에러가 안 난다', () => {
    const mod = strip(read('modules/command-center/command-center.module.ts'));
    // 🔴 **import 문이 검사를 대신 통과했다**(재주입에서 드러남 · 이 저장소가 이미 기록한 함정).
    //    `imports:` 배열 안에 실제로 들어 있는지를 본다 — import 만 남아도 주입은 undefined 다.
    const importsArray = /imports:\s*\[([^\]]*)\]/.exec(mod)?.[1] ?? '';
    expect(importsArray, 'imports 배열을 찾지 못했습니다 — 검사가 헛돕니다').not.toBe('');
    expect(importsArray, 'imports 에 SentinelModule 이 없으면 drift 가 undefined 가 되어 원장이 통째로 빈다')
      .toMatch(/SentinelModule/);
    const sentinel = strip(read('sentinel/sentinel.module.ts'));
    expect(sentinel, '기록기가 provider 로 등록돼 있어야 한다').toMatch(/DriftRecorderService/);
    expect(sentinel, '다른 모듈이 쓰려면 export 돼 있어야 한다').toMatch(/exports:[\s\S]*DriftRecorderService/);
  });
});

/** 실제 저장 모양을 흉내낸 최소 목 */
function mockPrisma(signals: Record<string, unknown>[] = []) {
  const runs: Record<string, unknown>[] = [];
  const findings = new Map<string, Record<string, unknown>>();
  return {
    runs, findings,
    sentinelRun: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `r${runs.length}`, ...data, ok: false }; runs.push(row); return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(runs.find((r) => r.id === where.id)!, data); return {};
      }),
      // 🔴 목이 항상 null 을 주면 "성공한 스윕 없음" 경로만 타 가드가 헛돈다 — 정본처럼 동작시킨다
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const list = runs.filter((r) => r.axis === where.axis && (where.ok === undefined || r.ok === where.ok));
        return list.length ? list[list.length - 1] : null;
      }),
    },
    sentinelFinding: {
      findUnique: vi.fn(async ({ where }: { where: { axis_checkKey: { axis: string; checkKey: string } } }) =>
        findings.get(`${where.axis_checkKey.axis}|${where.axis_checkKey.checkKey}`) ?? null),
      upsert: vi.fn(async ({ where, create, update }: { where: { axis_checkKey: { axis: string; checkKey: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const k = `${where.axis_checkKey.axis}|${where.axis_checkKey.checkKey}`;
        const cur = findings.get(k);
        findings.set(k, cur ? { ...cur, ...update } : { ...create });
        return {};
      }),
      findMany: vi.fn(async () => [...findings.values()]),
    },
    sentinelRuntimeSignal: { findMany: vi.fn(async () => signals), upsert: vi.fn(async () => ({})) },
  };
}

describe('축 C 스윕 — 신호를 발견으로 승격한다', () => {
  const sig = (over: Record<string, unknown> = {}) => ({
    kind: 'KEY_MISSING', producer: 'bed-board.summary', consumer: 'command-center.buildKpi',
    detail: "읽은 키 'total' 가 없습니다 · 실제 키: totalBeds, occupied",
    hitCount: 143, lastSeenAt: new Date(), firstSeenAt: new Date(), ...over,
  });

  it('🔴 실측 01번을 되돌리면 계약 축에 한 줄이 뜬다(완료 판정)', async () => {
    const prisma = mockPrisma([sig()]);
    const r = await new SentinelService(prisma as never).sweepContract();
    expect(r.attempted).toBe(1);
    expect(r.ok).toBe(true);
    const f = prisma.findings.get('CONTRACT|drift.KEY_MISSING.command-center.buildKpi')!;
    expect(f.value).toBe(143);
    expect(f.resolvedAt, '방금 본 드리프트는 해결이 아니다').toBeNull();
    expect(f.detail).toMatch(/totalBeds/);
  });

  it('🔴 오래 안 보였다고 "고쳐졌다"고 단정하지 않는다 — 그 사실을 함께 적는다', async () => {
    const old = new Date(Date.now() - 48 * 3_600_000);
    const prisma = mockPrisma([sig({ lastSeenAt: old })]);
    await new SentinelService(prisma as never).sweepContract({ staleHours: 24 });
    const f = prisma.findings.get('CONTRACT|drift.KEY_MISSING.command-center.buildKpi')!;
    expect(f.resolvedAt).not.toBeNull();
    expect(f.detail, '그 경로를 아무도 안 지났을 가능성을 남겨야 한다').toMatch(/아무도 지나지 않았습니다/);
  });

  it('신호가 없으면 발견도 없다(없는 결함을 만들지 않는다 — 대조군)', async () => {
    const prisma = mockPrisma([]);
    const r = await new SentinelService(prisma as never).sweepContract();
    expect(r.attempted).toBe(0);
    expect(prisma.findings.size).toBe(0);
  });

  it('조회가 실패하면 성공으로 적지 않는다', async () => {
    const prisma = mockPrisma();
    prisma.sentinelRuntimeSignal.findMany = vi.fn(async () => { throw new Error('DB 불달'); }) as never;
    await expect(new SentinelService(prisma as never).sweepContract()).rejects.toThrow(/DB 불달/);
    expect(prisma.runs.at(-1)!.ok).toBe(false);
  });
});

describe('🔴 계약 축의 0 은 "관측점 안에서의 0" 이다', () => {
  it('관측 범위를 화면에 밝힌다 — 밝히지 않으면 안 보는 곳을 정상이라 말한다', async () => {
    const prisma = mockPrisma([]);
    // 성공한 스윕이 하나 있어야 숫자가 나온다
    await new SentinelService(prisma as never).sweepContract();
    const { axes } = await new SentinelReadService(prisma as never).overview();
    const c = axes.find((a) => a.key === 'CONTRACT')!;
    expect(c.open).toBe(0);
    expect(c.coverageNote, '0건의 범위를 밝히지 않으면 거짓 안심이다').toMatch(/관측점 \d+곳/);
    expect(c.coverageNote, '어디를 보는지 이름까지 밝힌다').toMatch(/통합 상황판 KPI/);
    expect(c.coverageNote).toMatch(/에서만 감시 중/);
    expect(c.coverageNote).toMatch(/0건이 아닙니다/);
  });

  it('🔴 등록부→코드: 모든 관측점의 consumer 가 자기 sourceFile 에 실재한다 — 등록부에만 있는 관측점은 보지도 않으면서 본다고 말하는 것', () => {
    expect(CONTRACT_OBSERVATION_POINTS.length).toBeGreaterThan(0);
    for (const p of CONTRACT_OBSERVATION_POINTS) {
      expect(p.consumer.length).toBeGreaterThan(3);
      const src = readFileSync(join(SRC, p.sourceFile), 'utf8');
      expect(src, `${p.sourceFile} 에 consumer '${p.consumer}' 를 적는 코드가 없습니다`).toContain(`consumer: '${p.consumer}'`);
      expect(strip(src), `${p.sourceFile} 이 기록기를 부르지 않습니다`).toMatch(/\.record\(/);
    }
  });

  it('🔴 코드→등록부: src 안의 모든 drift consumer 문자열이 등록부에 있다 — 코드에만 있으면 범위 고지(관측점 N곳)가 거짓이 된다', () => {
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    const files = (readdirSync(SRC, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
    expect(files.length, '소스 훑기가 깨졌습니다 — 이 가드가 헛돕니다').toBeGreaterThan(100);
    const registered = new Set(CONTRACT_OBSERVATION_POINTS.map((p) => p.consumer));
    const found = new Set<string>();
    for (const f of files) {
      // 등록부 자신·기록기 정의는 제외 — record 호출이 있는 소비처 파일의 consumer 리터럴만
      if (f.includes('sentinel')) continue;
      const src = readFileSync(join(SRC, f), 'utf8');
      if (!src.includes("kind: 'KEY_MISSING'") && !src.includes("kind: 'NULL_FOLDED'")) continue;
      for (const m of src.matchAll(/consumer:\s*'([^']+)'/g)) {
        found.add(m[1]);
        expect(registered.has(m[1]), `'${m[1]}' (${f}) 이 CONTRACT_OBSERVATION_POINTS 에 등재되지 않았습니다`).toBe(true);
      }
    }
    // 대조군 — 스캔 자체가 아무것도 못 찾으면 위 expect 가 한 번도 안 돈 것
    expect(found.size, 'consumer 리터럴을 하나도 못 찾았습니다 — 정규식/경로가 깨진 것').toBeGreaterThanOrEqual(registered.size);
  });

  it('🔴 배선: 관측점 소스의 모듈이 DriftRecorderService 를 provider 로 들거나 SentinelModule 을 import 한다 — 빠지면 @Optional 주입이 조용히 undefined', () => {
    const MODULE_OF: Record<string, string> = {
      'modules/command-center/command-center.service.ts': 'modules/command-center/command-center.module.ts',
      'modules/pacs-proxy/pacs-webhook.controller.ts': 'modules/pacs-proxy/pacs-proxy.module.ts',
      'modules/billing/billing.service.ts': 'modules/billing/billing.module.ts',
      'modules/portal/portal.controller.ts': 'modules/portal/portal.module.ts',
      'modules/safety-gate/safety-gate.service.ts': 'modules/safety-gate/safety-gate.module.ts',
      'modules/integration/integration-outbox.service.ts': 'modules/integration/integration-outbox.module.ts',
      'modules/order-set/order-set.service.ts': 'modules/order-set/order-set.module.ts',
      'modules/clinic-integration/erp-eapproval.service.ts': 'modules/clinic-integration/clinic-integration.module.ts',
      'modules/clinic-integration/clinic-api.service.ts': 'modules/clinic-integration/clinic-integration.module.ts',
      'modules/hie/hie.service.ts': 'modules/hie/hie.module.ts',
      'modules/medical-ai/medical-ai.service.ts': 'modules/medical-ai/medical-ai.module.ts',
      'modules/vitals/vitals.service.ts': 'modules/vitals/vitals.module.ts',
    };
    for (const p of CONTRACT_OBSERVATION_POINTS) {
      const modPath = MODULE_OF[p.sourceFile];
      expect(modPath, `${p.sourceFile} 의 모듈 파일을 이 표에 등재하세요(배선 검사가 그 파일을 봅니다)`).toBeTruthy();
      const mod = strip(readFileSync(join(SRC, modPath), 'utf8'));
      const importsArray = /imports:\s*\[([^\]]*)\]/.exec(mod)?.[1] ?? '';
      const providersArray = /providers:\s*\[([^\]]*)\]/.exec(mod)?.[1] ?? '';
      const wired = importsArray.includes('SentinelModule') || providersArray.includes('DriftRecorderService');
      expect(wired, `${modPath} 에 SentinelModule import 도 DriftRecorderService provider 도 없습니다 — drift 가 undefined 로 조용히 아무것도 안 남습니다`).toBe(true);
    }
  });

  it('다른 축은 이 문구를 달지 않는다(대조군 — 아무 데나 붙이지 않는다)', async () => {
    const prisma = mockPrisma([]);
    const { axes } = await new SentinelReadService(prisma as never).overview();
    for (const a of axes.filter((x) => x.key !== 'CONTRACT')) {
      expect(a.coverageNote).toBeNull();
    }
  });
});
