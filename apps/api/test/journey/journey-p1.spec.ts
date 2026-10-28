/**
 * 환자 여정 P1(2026-10-01 · `docs/01-plan/features/patient-journey-model.plan.md` §6 P1).
 *  · P1-1 발생 시각(occurredAt)과 기록 시각을 가른다 — 모르면 null+UNKNOWN(기록 시각으로 채우지 않는다)
 *  · P1-2 사건–객체 관계표(OCEL) — refType 이 방문 단위면 episode, 원 기록이면 focus + 명시 episode
 *  · P1-3 도메인 시각을 아는 발행 지점은 그 시각을 넘긴다 · 방문 단위 필수 유형은 방문 단위를 싣는다(구조 가드)
 *  · P1-4 데이터 출처 — 정본 발행기는 LIVE · 시드 SEED · 데모 DEMO
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  JOURNEY_EPISODE_REQUIRED, JOURNEY_EVENT_TYPES, JOURNEY_OBJECT_TYPES, JOURNEY_REF_TYPE_TO_OBJECT, journeyObjectTypeOf,
} from '@hospital-run/shared';
import { JourneyService, journeyObjectLinks, journeyTimeFields } from '../../src/modules/journey/journey.service';

const V = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('P1-1 시각 필드', () => {
  const rec = new Date('2026-10-01T03:00:00Z');
  it('발생 시각을 안 주면 발행 순간 = 기록 순간(SAME_AS_RECORDED)', () => {
    expect(journeyTimeFields({}, rec)).toEqual({ occurredAt: rec, occurredAtSource: 'SAME_AS_RECORDED', occurredAtPrecision: 'SECOND' });
  });
  it('도메인 시각을 주면 DOMAIN_FIELD · 사용자 입력이면 그 출처를 유지', () => {
    const d = new Date('2026-10-01T01:00:00Z');
    expect(journeyTimeFields({ occurredAt: d }, rec)).toMatchObject({ occurredAt: d, occurredAtSource: 'DOMAIN_FIELD' });
    expect(journeyTimeFields({ occurredAt: d, occurredAtSource: 'USER_CLAIMED', occurredAtPrecision: 'DAY' }, rec))
      .toEqual({ occurredAt: d, occurredAtSource: 'USER_CLAIMED', occurredAtPrecision: 'DAY' });
  });
  it('🔴 null·잘못된 날짜는 미상 — 기록 시각으로 채우지 않는다', () => {
    expect(journeyTimeFields({ occurredAt: null }, rec)).toEqual({ occurredAt: null, occurredAtSource: 'UNKNOWN', occurredAtPrecision: null });
    expect(journeyTimeFields({ occurredAt: new Date('x') }, rec).occurredAt).toBeNull();
  });
});

describe('P1-2 사건–객체 관계', () => {
  it('refType 이 방문 단위면 episode 한 줄', () => {
    expect(journeyObjectLinks({ refType: 'EmergencyVisit', refId: V })).toEqual([{ objectType: 'EmergencyVisit', objectId: V, qualifier: 'episode' }]);
    expect(journeyObjectLinks({ refType: 'ADMISSION', refId: V })).toEqual([{ objectType: 'Admission', objectId: V, qualifier: 'episode' }]);
  });
  it('원 기록 + 명시 episode → 두 줄(episode·focus)', () => {
    expect(journeyObjectLinks({ refType: 'PACU', refId: V, episode: { type: 'Surgery', id: S } })).toEqual([
      { objectType: 'Surgery', objectId: S, qualifier: 'episode' },
      { objectType: 'PacuRecord', objectId: V, qualifier: 'focus' },
    ]);
  });
  it('명시 episode 가 refType 과 같은 객체면 한 줄', () => {
    expect(journeyObjectLinks({ refType: 'SURGERY', refId: S, episode: { type: 'Surgery', id: S } })).toHaveLength(1);
  });
  it('🔴 uuid 아닌 refId·모르는 refType 은 싣지 않는다(@db.Uuid — 넣으면 사건 저장 전체가 실패한다)', () => {
    expect(journeyObjectLinks({ refType: 'Order', refId: 'ORD-001' })).toEqual([]);
    expect(journeyObjectLinks({ refType: 'Mystery', refId: V })).toEqual([]);
    expect(journeyObjectTypeOf(undefined)).toBeNull();
  });
  it('매핑은 shared 객체 어휘 안에서만', () => {
    for (const t of Object.values(JOURNEY_REF_TYPE_TO_OBJECT)) expect(JOURNEY_OBJECT_TYPES).toContain(t);
    for (const [k, t] of Object.entries(JOURNEY_EPISODE_REQUIRED)) {
      expect(JOURNEY_EVENT_TYPES as readonly string[]).toContain(k);
      expect(JOURNEY_OBJECT_TYPES).toContain(t);
    }
  });
});

describe('P1 emit — 저장 모양', () => {
  function make() {
    const create = vi.fn().mockResolvedValue({ id: 'ev1', eventAt: new Date() });
    const svc = new JourneyService({ patientJourneyEvent: { create } } as any, {} as any);
    const warn = vi.fn();
    (svc as any).logger = { warn, log: vi.fn(), error: vi.fn() };
    vi.spyOn(svc as any, 'updatePatientLocation').mockResolvedValue(undefined);
    return { svc, create, warn };
  }
  it('LIVE·시각·관계표·발행 파일명을 함께 저장하고 episode 는 컬럼으로 새지 않는다', async () => {
    const { svc, create, warn } = make();
    const d = new Date('2026-10-01T01:00:00Z');
    svc.emit({ patientId: 'p', eventType: 'PACU_ADMISSION', title: 't', refType: 'PACU', refId: V, episode: { type: 'Surgery', id: S }, occurredAt: d });
    await flush();
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ dataOrigin: 'LIVE', occurredAt: d, occurredAtSource: 'DOMAIN_FIELD', plannedAt: null });
    expect(data.objects.create).toHaveLength(2);
    expect(data).not.toHaveProperty('episode');
    expect(data.emitter).toBe('journey-p1.spec');
    expect(warn).not.toHaveBeenCalled();
  });
  it('🔴 방문 단위 필수 유형에 방문 단위가 없으면 warn(저장은 한다) · 대조군 있으면 침묵', async () => {
    const { svc, create, warn } = make();
    svc.emit({ patientId: 'p', eventType: 'PACU_DISCHARGE', title: 't', refType: 'PACU', refId: V });
    await flush();
    expect(create).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/PACU_DISCHARGE without Surgery/);
    const b = make();
    b.svc.emit({ patientId: 'p', eventType: 'LAB_RESULT', title: 't' });
    await flush();
    expect(b.warn).not.toHaveBeenCalled();
  });
});

// ── 구조 가드 ──
const SRC = join(__dirname, '..', '..', 'src');
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
function emitBlocks(code: string): { type: string; block: string; line: number }[] {
  const out: { type: string; block: string; line: number }[] = [];
  for (const m of code.matchAll(/eventType:\s*'([A-Za-z_.]+)'/g)) {
    let i = m.index!; let depth = 0;
    while (i > 0) { const c = code[i]; if (c === '}') depth++; if (c === '{') { if (depth === 0) break; depth--; } i--; }
    let j = m.index!; depth = 0;
    while (j < code.length) { const c = code[j]; if (c === '{') depth++; if (c === '}') { if (depth === 0) break; depth--; } j++; }
    out.push({ type: m[1], block: code.slice(i, j + 1), line: code.slice(0, m.index!).split('\n').length });
  }
  return out;
}
const DEMO_FILES = ['modules/patient-auth/patient-auth.service.ts'];
/** 도메인이 발생 시각을 아는 유형 — 발행 지점이 그 시각을 넘긴다(발행 순간과 다를 수 있다: 입력 시각·트랜잭션 시각) */
const DOMAIN_TIME_TYPES = [
  'ER_ARRIVAL', 'ER_TRIAGE', 'ER_TREATMENT_START', 'ADMISSION', 'DISCHARGE', 'TRANSFER_CARE',
  'SURGERY_START', 'SURGERY_COMPLETE', 'PACU_ADMISSION', 'PACU_DISCHARGE', 'MEDICATION_ADMINISTERED',
  'CHECKUP_STATION_ARRIVE', 'CHECKUP_STATION_COMPLETE', 'CHECKUP_COMPLETE',
];

describe('P1-3 구조 가드', () => {
  const files = walk(SRC).filter((f) => !DEMO_FILES.includes(relative(SRC, f))).map((f) => ({ rel: relative(SRC, f), code: strip(readFileSync(f, 'utf8')) }));
  const blocks = files.flatMap((f) => emitBlocks(f.code).map((b) => ({ ...b, rel: f.rel })));

  it('🔴 방문 단위 필수 유형은 방문 단위 refType 이거나 episode 를 싣는다', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const b of blocks) {
      const need = JOURNEY_EPISODE_REQUIRED[b.type as keyof typeof JOURNEY_EPISODE_REQUIRED];
      if (!need) continue;
      checked++;
      const ref = b.block.match(/refType:\s*'([A-Za-z_]+)'/)?.[1];
      const ok = /episode:\s*\{/.test(b.block) || journeyObjectTypeOf(ref) === need;
      if (!ok) missing.push(`${b.rel}:${b.line} ${b.type} (ref ${ref ?? '-'})`);
    }
    expect(missing).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(25);
  });

  it('🔴 도메인 시각을 아는 유형은 발행 지점마다 occurredAt 을 넘긴다', () => {
    const missing = blocks.filter((b) => DOMAIN_TIME_TYPES.includes(b.type) && !/occurredAt:/.test(b.block)).map((b) => `${b.rel}:${b.line} ${b.type}`);
    expect(missing).toEqual([]);
    expect(blocks.filter((b) => DOMAIN_TIME_TYPES.includes(b.type)).length).toBeGreaterThanOrEqual(DOMAIN_TIME_TYPES.length);
  });

  it('데모 사건은 DEMO 로 · 데모 정리는 DEMO 행만 지운다', () => {
    const demo = readFileSync(join(SRC, 'modules/patient-auth/patient-auth.service.ts'), 'utf8');
    const creates = demo.match(/patientJourneyEvent\.create\(/g) ?? [];
    expect(creates.length).toBeGreaterThan(0);
    expect((demo.match(/dataOrigin: 'DEMO'/g) ?? []).length).toBeGreaterThanOrEqual(creates.length + 1);
    expect(demo).toMatch(/patientJourneyEventObject\.deleteMany/);
  });

  it('시드 사건은 SEED 로', () => {
    const seeds = ['../../prisma/seed.ts', '../../prisma/seeds/recent-clinical-activity.ts'].map((p) => readFileSync(join(__dirname, p), 'utf8'));
    for (const s of seeds) expect(s).toMatch(/dataOrigin: 'SEED'/);
  });

  it('감시자 77 목록 = shared JOURNEY_EPISODE_REQUIRED · 77·78 은 LIVE 행만 센다(소급 없음)', () => {
    const sql = readFileSync(join(__dirname, '../../../../infra/scripts/data-integrity-scan.sql'), 'utf8');
    const seg = sql.slice(sql.indexOf("'77 여정 원장"), sql.indexOf("'78 여정 원장"));
    const listed = [...seg.slice(seg.indexOf('ARRAY[')).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect([...listed].sort()).toEqual(Object.keys(JOURNEY_EPISODE_REQUIRED).sort());
    expect(seg).toMatch(/data_origin = 'LIVE'/);
    const seg78 = sql.slice(sql.indexOf("'78 여정 원장"), sql.indexOf('UNION ALL', sql.indexOf("'78 여정 원장")));
    expect(seg78).toMatch(/data_origin = 'LIVE'/);
  });
});
