import { describe, it, expect, vi } from 'vitest';
import { GoLiveService } from '../../src/modules/go-live/go-live.service';
import { GO_LIVE_REGISTRY, EXPECTED_GIN_INDEXES } from '../../src/modules/go-live/go-live.registry';

/**
 * 운영 전환 관제 — **준비율이 사실을 말하는지** 계약 (2026-08-14 신설, 화면 실사용 점검 P17).
 *
 * 배경: /admin/go-live 는 "✅ 실운영 전환 가능"·"준비도 100%" 를 띄울 수 있는 화면이다.
 * 그 초록이 무엇을 근거로 하는지 검증하지 않으면, 관제가 스스로를 승인하게 된다.
 * 여기서 고정하는 것은 네 가지 — 분모가 비면 산출하지 않는다 / 맵 게이트를 문자열로 뭉개지 않는다 /
 * 사람의 신고와 시스템 실검증을 섞지 않는다 / 인덱스 존재는 실측으로만 말한다.
 */

type Row = Partial<{ id: string; area: string; key: string; title: string; type: string; owner: string | null;
  status: string; sourceKey: string | null; targetMode: string | null; isBlocking: boolean;
  targetDate: Date | null; blocker: string | null; drillDown: string | null; updatedAt: Date }>;

const row = (r: Row): any => ({
  id: r.id ?? r.key ?? 'i1', area: r.area ?? 'A', key: r.key ?? 'k1', title: r.title ?? 't',
  type: r.type ?? 'MANUAL', owner: r.owner ?? null, status: r.status ?? 'NOT_READY',
  sourceKey: r.sourceKey ?? null, targetMode: r.targetMode ?? null,
  isBlocking: r.isBlocking ?? true, targetDate: r.targetDate ?? null, blocker: r.blocker ?? null,
  drillDown: r.drillDown ?? null, updatedAt: r.updatedAt ?? new Date(),
  approvals: [], _count: { approvals: 0 },
});

const svcWith = (opts: { items?: Row[]; cfg?: Record<string, unknown>; ginIndexes?: string[]; gates?: any[] }) => {
  const prisma: any = {
    goLiveItem: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue((opts.items ?? []).map(row)),
    },
    integrationGate: { findMany: vi.fn().mockResolvedValue(opts.gates ?? []) },
    $queryRaw: vi.fn().mockResolvedValue((opts.ginIndexes ?? []).map((n) => ({ indexname: n }))),
  };
  const config: any = { get: vi.fn((k: string) => Promise.resolve((opts.cfg ?? {})[k])) };
  return new GoLiveService(prisma, config);
};

describe('🔴 준비율 — 분모가 없으면 산출하지 않는다', () => {
  it('필수 항목이 0건이면 100% 가 아니라 산출 불가(pct=null)이고 전환 가능이 아니다', async () => {
    // 예전 식 `blocking.length ? … : 100` 은 표본 부재를 만점으로 바꿔 배너를 초록으로 만들었다
    const r = await svcWith({ items: [{ key: 'x', isBlocking: false, status: 'NOT_READY' }] }).rollup();
    expect(r.readiness.computable).toBe(false);
    expect(r.readinessPct).toBeNull();
    expect(r.canGoLive).toBe(false);
    expect(r.readiness.basis).toContain('산출 불가');
  });

  it('항목이 아예 없어도 전환 가능이 되지 않는다', async () => {
    const r = await svcWith({ items: [] }).rollup();
    expect(r.readinessPct).toBeNull();
    expect(r.canGoLive).toBe(false);
  });

  it('필수 항목이 전부 준비돼야만 전환 가능', async () => {
    const ready = { status: 'DONE', isBlocking: true };
    const r = await svcWith({ items: [{ key: 'a', ...ready }, { key: 'b', ...ready }] }).rollup();
    expect(r.readinessPct).toBe(100);
    expect(r.canGoLive).toBe(true);
    const r2 = await svcWith({ items: [{ key: 'a', ...ready }, { key: 'b', isBlocking: true, status: 'NOT_READY' }] }).rollup();
    expect(r2.readinessPct).toBe(50);
    expect(r2.canGoLive).toBe(false);
  });

  it('산출 불가면 추이 스냅샷에 숫자를 남기지 않는다(빈 표본을 0/100 으로 기록 금지)', async () => {
    const svc = svcWith({ items: [] });
    const snap = await svc.snapshot();
    expect(snap.computable).toBe(false);
    expect(snap.readinessPct).toBeNull();
    expect(snap.canGoLive).toBe(false);
  });
});

describe('🔴 준비율 — 실검증과 자가신고를 섞지 않는다', () => {
  it('수동 항목의 READY 는 자가신고로 분류돼 분해값에 드러난다', async () => {
    const r = await svcWith({
      items: [
        { key: 'manual', sourceKey: null, status: 'READY', isBlocking: true },
        { key: 'auto', sourceKey: 'some.gate', targetMode: 'BLOCK', status: 'NOT_READY', isBlocking: true },
      ],
      cfg: { 'some.gate': 'BLOCK' },
    }).rollup();
    expect(r.readinessPct).toBe(100); // 준비율 자체는 100
    expect(r.readiness.verifiedReady).toBe(1);
    expect(r.readiness.selfReportedReady).toBe(1); // 그러나 절반은 사람이 적은 것
    expect(r.readiness.verifiedPct).toBe(50);
    expect(r.readiness.basis).toContain('자가신고 1');
  });

  it('항목마다 evidence 가 붙는다(화면이 배지로 구분할 수 있게)', async () => {
    const r = await svcWith({
      items: [{ key: 'm', sourceKey: null, status: 'READY' }, { key: 'g', sourceKey: 'g.k', status: 'NOT_READY' }],
      cfg: { 'g.k': 'OFF' },
    }).rollup();
    expect(r.items.find((i) => i.key === 'm')!.evidence).toBe('SELF_REPORTED');
    expect(r.items.find((i) => i.key === 'g')!.evidence).toBe('VERIFIED');
  });
});

describe('🔴 config 게이트 — 영역별 맵을 문자열로 뭉개지 않는다', () => {
  const deriveMap = (svc: GoLiveService, raw: unknown, target = 'BLOCK') =>
    (svc as any).deriveConfigGate(raw, target) as { status: string; detail: string };

  it('7영역 중 1영역만 BLOCK 이면 준비완료가 아니다(최저 영역 기준)', () => {
    // 예전에는 String({...}) = '[object Object]' → fail-closed 분기에 걸려 **BLOCK/준비완료** 로 읽혔다
    const map = { dosage: 'BLOCK', route: 'OFF', duration: 'OFF', age: 'OFF', renal: 'OFF', hepatic: 'OFF', interaction: 'OFF' };
    const r = deriveMap(svcWith({}), map);
    expect(r.status).toBe('IN_PROGRESS');
    expect(r.detail).toContain('1영역만');
    expect(r.detail).toContain('최저 OFF');
    expect(r.detail).toContain('route=OFF');
  });

  it('전 영역이 목표에 도달해야 READY', () => {
    const r = deriveMap(svcWith({}), { a: 'BLOCK', b: 'BLOCK' });
    expect(r.status).toBe('READY');
  });

  it('빈 맵은 준비완료가 아니다', () => {
    expect(deriveMap(svcWith({}), {}).status).toBe('NOT_READY');
  });

  it('WARN 목표라면 WARN 이상만 충족으로 센다', () => {
    expect(deriveMap(svcWith({}), { a: 'WARN', b: 'BLOCK' }, 'WARN').status).toBe('READY');
    expect(deriveMap(svcWith({}), { a: 'OFF', b: 'BLOCK' }, 'WARN').status).toBe('IN_PROGRESS');
  });
});

describe('🔴 GIN 인덱스 — 선언이 아니라 pg_indexes 실측', () => {
  const derive = (svc: GoLiveService) => (svc as any).deriveGinIndex() as Promise<{ status: string; detail: string }>;

  it('레지스트리 항목이 DB 실측으로 배선돼 있다(수동 선언 불가)', () => {
    const d = GO_LIVE_REGISTRY.find((x) => x.key === 'infra.ginIndex')!;
    expect(d.type).toBe('DB_PROBE');
    expect(d.sourceKey).toBe('ginIndex');
  });

  it('실측 당시처럼 6종이 전부 없으면 NOT_READY 이고 부재 인덱스를 이름으로 말한다', async () => {
    // 2026-08-14 운영 DB 실측: 존재하는 gin 은 임상기록 3본뿐이었다
    const r = await derive(svcWith({ ginIndexes: ['idx_encounters_soap_trgm', 'idx_nursing_notes_search_trgm', 'idx_progress_notes_content_trgm'] }));
    expect(r.status).toBe('NOT_READY');
    expect(r.detail).toContain('적용 0/6');
    expect(r.detail).toContain('idx_medication_codes_nameko_trgm');
  });

  it('일부만 적용되면 READY 가 아니라 IN_PROGRESS', async () => {
    const r = await derive(svcWith({ ginIndexes: [EXPECTED_GIN_INDEXES[0]] }));
    expect(r.status).toBe('IN_PROGRESS');
    expect(r.detail).toContain('적용 1/6');
  });

  it('전부 있으면 READY', async () => {
    const r = await derive(svcWith({ ginIndexes: [...EXPECTED_GIN_INDEXES] }));
    expect(r.status).toBe('READY');
  });

  it('실측이 실패하면 준비완료로 넘어가지 않는다(모르면 모른다고 말한다)', async () => {
    const svc = svcWith({});
    (svc as any).prisma.$queryRaw = vi.fn().mockRejectedValue(new Error('relation not accessible'));
    const r = await derive(svc);
    expect(r.status).toBe('NOT_READY');
    expect(r.detail).toContain('확인 불가');
  });

  it('실측 대상 목록은 수동 SQL 파일의 인덱스 이름과 일치한다(한쪽만 고치면 실측이 거짓말한다)', async () => {
    const fs = await import('node:fs');
    const sql = fs.readFileSync(new URL('../../prisma/manual/search-trgm-indexes-20260705.sql', import.meta.url), 'utf8');
    for (const name of EXPECTED_GIN_INDEXES) expect(sql).toContain(name);
  });
});

describe('🔴 연동 결재 — 개발 시드를 실 결재로 세지 않는다', () => {
  const derive = (svc: GoLiveService, key: string) =>
    (svc as any).deriveIntegration(key) as Promise<{ status: string; detail: string }>;

  it('DEV-SEED 결재만 있으면 준비완료가 아니다', async () => {
    const gates = [
      { status: 'CONFIRMED', evidenceRef: '개발 시드(DEV-SEED)', note: null },
      { status: 'CONFIRMED', evidenceRef: 'DEV-SEED', note: null },
    ];
    const r = await derive(svcWith({ gates }), 'track:LIS_REFLEX');
    expect(r.status).toBe('NOT_READY');
    expect(r.detail).toContain('실 결재 0/2');
    expect(r.detail).toContain('개발 시드 2건 제외');
  });

  it('실 결재로 전건 교체되면 DONE', async () => {
    const gates = [{ status: 'CONFIRMED', evidenceRef: '진단검사의학과 회신 2026-08-01', note: null }];
    const r = await derive(svcWith({ gates }), 'track:LIS_REFLEX');
    expect(r.status).toBe('DONE');
    expect(r.detail).toContain('1/1');
  });

  it('게이트가 아예 없으면 미착수', async () => {
    expect((await derive(svcWith({ gates: [] }), 'track:X')).status).toBe('NOT_READY');
  });
});

describe('🔴 ERP 실 이관 — UI 플래그를 근거로 삼지 않는다', () => {
  it('erp.enabled(바로가기 노출용) 를 sourceKey 로 쓰지 않는다', () => {
    const d = GO_LIVE_REGISTRY.find((x) => x.key === 'integ.erp')!;
    expect(d.sourceKey).toBeUndefined();
    expect(d.note).toContain('erp.enabled');
  });

  it('레지스트리 전체에서 erp.enabled 를 준비 근거로 참조하는 항목이 없다', () => {
    expect(GO_LIVE_REGISTRY.filter((d) => (d.sourceKey ?? '').includes('erp.enabled'))).toHaveLength(0);
  });
});
