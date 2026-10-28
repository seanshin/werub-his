/**
 * 개발 시드 결정 기록(2026-10-03 사용자 지시 "현재는 시드형태로 의결").
 *  🔴 운영 DB 는 가상 병원 시드다 — 시드 형태로 남긴 결정을 실결정으로 세면 "N건 결정 완료"가 아무도 정하지 않은 것을 가린다
 *     (go-live 가 시드 결재 3건을 실결재로 세어 준비율 65% 를 그렸던 함정과 같다 · 실제 45%).
 *  · 근거에 DEV-SEED·개발 시드 → 보이되(seeded) 결정 수·선행 조건 충족·개원 단계 준비에 넣지 않는다
 *  · 실결정으로 다시 기록하면 결정으로 센다(시드가 실결정을 막지 않는다)
 *  · 시드는 D8·D9 를 **없을 때만** 만든다(사람이 남긴 실결정을 덮지 않는다)
 * 재주입: 시드 판정·결정 수 제외·선행 조건 제외·개원 단계 문구·시드 create-only 를 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DecisionService, isSeedDecisionRecord } from '../../src/modules/decision-registry/decision.service';
import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';

const SEED = { legalReviewRef: '개발 시드(DEV-SEED) — 2026-10-03 사용자 지시(위원회 의결 전)', authorityClaim: '개발 시드(DEV-SEED) — 허가권 미검증' };
const rec = (choice: string, over: Record<string, unknown> = {}) => ({ choice, decidedByUserId: 'u', decidedAt: '2026-10-03T03:00:00Z', applied: false, legalReviewRef: '위원회 의결 2026-QI-07', authorityClaim: 'QI 위원회', ...over });

function mk() {
  const store = new Map<string, unknown>();
  const config: any = {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    getMany: vi.fn(async (keys: string[]) => new Map(keys.map((k) => [k, store.get(k) ?? null]))),
    set: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }),
  };
  const prisma: any = { decisionAction: { findMany: vi.fn(async () => []), create: vi.fn() } };
  const svc = new DecisionService(prisma, config, { enactRegistryDecision: vi.fn() } as never, { onRecorded: vi.fn(async () => ({ logged: true, propagatedTo: [] })), listSignals: vi.fn(async () => ({ lastReview: new Map(), counts: new Map(), devEvents: new Map() })) } as never, { log: vi.fn().mockResolvedValue(null) } as never);
  return { svc, store };
}

describe('시드 판정', () => {
  it('근거·권한·메모 어디든 DEV-SEED·개발 시드면 시드 · 대조군: 실근거는 시드가 아니다', () => {
    expect(isSeedDecisionRecord(rec('X', SEED))).toBe(true);
    expect(isSeedDecisionRecord(rec('X', { note: '개발 시드 — 실결정 아님' }))).toBe(true);
    expect(isSeedDecisionRecord(rec('X'))).toBe(false);
    expect(isSeedDecisionRecord(null)).toBe(false);
  });
});

describe('결정 목록', () => {
  it('🔴 시드 기록은 보이되 결정으로 세지 않는다 — 실결정은 센다 · 층·축·전체 시드 수', async () => {
    const { svc, store } = mk();
    store.set('decision.journey.outpatientEnd', rec('BILLING_PAID', SEED));
    store.set('decision.emergency.departureTimeSource', rec('DEPARTED_AT_FIELD'));
    const r = await svc.list();
    const d8 = r.items.find((i) => i.key === 'journey.outpatientEnd')!;
    const d9 = r.items.find((i) => i.key === 'emergency.departureTimeSource')!;
    expect(d8).toMatchObject({ seeded: true, decided: false, readyToDecide: true });
    expect(d8.record?.choice).toBe('BILLING_PAID'); // 무엇으로 해 두었는지는 보인다
    expect(d8.enactment.state).toBe('UNDECIDED');
    expect(d9).toMatchObject({ seeded: false, decided: true, readyToDecide: false });
    expect(r.summary.seeded).toBe(1);
    const layer = r.summary.byLayer.find((l) => l.layer === 'INTERNAL_COMMITTEE')!;
    expect(layer.seeded).toBe(1);
    const decidedQuality = r.summary.byTrack.find((t) => t.track === 'QUALITY')!;
    expect(decidedQuality.seeded).toBe(1);
  });

  it('🔴 시드 기록은 선행 조건을 채우지 않는다 — 대조군: 같은 선택의 실결정은 채운다', async () => {
    const dep = DECISION_REGISTRY.find((d) => (d.dependsOn ?? []).length === 1)!;
    const upKey = dep.dependsOn![0];
    const up = DECISION_REGISTRY.find((d) => d.key === upKey)!;
    const positive = up.options.find((o) => !/^(NOT_|OFF$|UNSET$|DRAFT$|KEEP_OFF$|NONE$|PENDING$|DEVICE_APPLIES$)/.test(o.value))!;
    const a = mk();
    a.store.set(`decision.${upKey}`, rec(positive.value, SEED));
    expect((await a.svc.list()).items.find((i) => i.key === dep.key)!.blockedBy.map((b) => b.key)).toEqual([upKey]);
    const b = mk();
    b.store.set(`decision.${upKey}`, rec(positive.value));
    expect((await b.svc.list()).items.find((i) => i.key === dep.key)!.blockedBy).toEqual([]);
  });
});

describe('개원 단계·시드·화면', () => {
  it('🔴 개원 단계는 시드 기록을 준비로 세지 않고 그 사실을 말한다', () => {
    const s = readFileSync(join(__dirname, '../../src/modules/opening/opening.service.ts'), 'utf8');
    expect(s).toMatch(/status: it\.decided \? 'READY' : 'NOT_READY'/);
    expect(s).toMatch(/it\.seeded \? serverMsg\('개발 시드 기록 — 실결정 아님'\)/);
  });

  it('🔴 시드는 D8·D9 를 시드 근거로 · 없을 때만 만든다(update: {})', () => {
    const seed = readFileSync(join(__dirname, '../../prisma/seed.ts'), 'utf8');
    const i = seed.indexOf('const seededDecisions');
    const block = seed.slice(i, i + 1800);
    expect(block).toMatch(/\{ key: 'journey\.outpatientEnd', choice: 'BILLING_PAID' \}/);
    expect(block).toMatch(/\{ key: 'emergency\.departureTimeSource', choice: 'DEPARTED_AT_FIELD' \}/);
    expect(block).toMatch(/legalReviewRef: '개발 시드\(DEV-SEED\)/);
    expect(block).toMatch(/update: \{\},\s*\}\);/);
    // 등록부에 있는 선택지인지
    for (const [k, c] of [['journey.outpatientEnd', 'BILLING_PAID'], ['emergency.departureTimeSource', 'DEPARTED_AT_FIELD']]) {
      expect(DECISION_REGISTRY.find((d) => d.key === k)!.options.map((o) => o.value)).toContain(c);
    }
  });

  it('화면 — 시드 배지와 결정 수에 넣지 않는다는 문구', () => {
    const p = readFileSync(join(__dirname, '../../../web/src/app/(main)/admin/decisions/page.tsx'), 'utf8');
    expect(p).toMatch(/data-decision-seeded=/);
    // 2026-10-11 표기 "의사결정" — 문구는 바뀌어도 "결정 수에 넣지 않음"은 그대로 말한다
    expect(p).toMatch(/개발 시드 \{수\}건 — 결정 수에 넣지 않음/);
  });
});

/**
 * 위원회 몫 개발 시드(2026-10-10 사용자 지시 "위원회몫은 시드 데이터로 결정해둘것" · "시드 데이터로 결정할 부분들은 의사결정 진행").
 *  🔴 시드가 등록부에 없는 선택지·집행 대상과 다른 설정 값을 넣으면 "결정된 모양"이 등록부와 갈라진다.
 *  🔴 시드가 대외 발신·반출·녹화·위치 수집을 켜면 아무도 정하지 않은 발신이 데모에서 나간다.
 */
describe('위원회 몫 개발 시드 — 데이터 파일 정본', async () => {
  const { DECISION_DEV_SEEDS } = await import('../../prisma/seeds/decision-dev-seeds');
  const { DEFAULTS } = await import('../../src/modules/config/config-runtime.service');
  const { settingValueInvalidReason } = await import('@hospital-run/shared');
  const seed = readFileSync(join(__dirname, '../../prisma/seed.ts'), 'utf8');

  it('대조군 — 데이터가 읽혔다(10-F 10건 포함)', () => {
    expect(DECISION_DEV_SEEDS.length).toBeGreaterThanOrEqual(10);
    expect(DECISION_DEV_SEEDS.find((d) => d.key === 'qi.docIssuance.slaHours')?.choice).toBe('H72');
  });

  it('🔴 위원회 층만 · 중복 없음 · 이유 있음 · 선택지는 등록부에 있다', () => {
    const keys = new Set<string>();
    for (const r of DECISION_DEV_SEEDS) {
      expect(keys.has(r.key), `중복 ${r.key}`).toBe(false); keys.add(r.key);
      const d = DECISION_REGISTRY.find((x) => x.key === r.key);
      expect(d, r.key).toBeTruthy();
      expect(d!.layer, `${r.key} — 허가권자·직원 몫은 시드하지 않는다`).toBe('INTERNAL_COMMITTEE');
      expect(d!.options.some((o) => o.value === r.choice), `${r.key}=${r.choice}`).toBe(true);
      expect(r.why.trim().length, `${r.key} 이유`).toBeGreaterThan(0);
    }
  });

  it('🔴 설정 값 = 그 선택지의 집행 대상 · 카탈로그 범주 · 허용 값 규칙 · 집행 없는 선택은 config null', () => {
    for (const r of DECISION_DEV_SEEDS) {
      const opt = DECISION_REGISTRY.find((x) => x.key === r.key)!.options.find((o) => o.value === r.choice)!;
      const e = opt.enact as unknown as { key?: string; newValue?: unknown; target?: { key: string; newValue: unknown } } | null;
      const t = e ? (e.target ?? (e as { key: string; newValue: unknown })) : null;
      if (!t) { expect(r.config, `${r.key} 선택에 집행이 없는데 설정을 넣었다`).toBeNull(); continue; }
      expect(r.config, r.key).not.toBeNull();
      expect({ key: r.config!.key, value: r.config!.value }).toEqual({ key: t.key, value: t.newValue });
      expect(r.config!.category, r.config!.key).toBe(DEFAULTS[t.key]?.category);
      expect(settingValueInvalidReason(r.config!.key, r.config!.value) ?? null, r.config!.key).toBeNull();
    }
  });

  it('🔴 대외 발신·반출·녹화·위치 수집·AI 외부 송출을 켜는 시드가 없다', () => {
    const OUTBOUND = /patientPush\.enabled$|kops|outbound|sms|egress|export|recording|cctv|location\.wifi\.enabled|\.send|webhook/i;
    const on = DECISION_DEV_SEEDS.filter((r) => r.config && OUTBOUND.test(r.config.key) && r.config.value !== false && r.config.value !== null && r.config.value !== 'OFF' && r.config.value !== 'NONE');
    expect(on.map((r) => `${r.key} → ${r.config!.key}=${JSON.stringify(r.config!.value)}`)).toEqual([]);
  });

  it('🔴 seed.ts 가 데이터 파일을 쓰고 DEV-SEED 표식 · 결정·설정 둘 다 없을 때만(update: {})', () => {
    const start = seed.indexOf('const committeeSeedDecisions = DECISION_DEV_SEEDS');
    expect(start).toBeGreaterThan(0);
    // 범위 = 위원회 결정 시드 루프만(뒤따르는 결정권한자 표 시드는 `decision-committees-link.spec.ts` 가 본다)
    const end = seed.indexOf('for (let i = 0; i < COMMITTEE_CODES.length', start);
    expect(end).toBeGreaterThan(start);
    const block = seed.slice(start, end);
    expect(block).toMatch(/legalReviewRef: '개발 시드\(DEV-SEED\)/);
    expect(isSeedDecisionRecord({ legalReviewRef: '개발 시드(DEV-SEED) — 2026-10-10 사용자 지시(위원회 의결 전)' })).toBe(true);
    expect((block.match(/update: \{\},/g) ?? []).length).toBe(2);
  });
});
