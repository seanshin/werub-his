/**
 * AI 감독 `scribe-edits` — 스크라이브 초안 ↔ 서명 진료기록 수정량 **집계**의 정직성 계약.
 *
 * 🔴 목은 Prisma 실제 반환 모양(`findMany`→행 배열 · `count`→number)을 쓴다.
 * 🔴 지키는 사실:
 *    ① 표본 0 → 중앙값·p90 null + 사유, 무수정 비율 pct null(ZERO_DENOMINATOR) — 0% 가 아니다
 *    ② 초안 없는 진료는 표본이 아니다(noDraftSnapshot 으로 따로 센다 · 0 으로 섞지 않는다)
 *    ③ 서명 후 정정·정정 중인 진료는 분포에서 빼고 몇 건인지 말한다
 *    ④ 상한 초과는 분포에 섞지 않고 따로 센다
 *    ⑤ 응답에 환자·진료 식별자·본문이 없다(집계만)
 *    ⑥ 역할은 이웃 EP(summary)와 같다 — ADMIN·EXECUTIVE·DOCTOR
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { AiOversightService } from '../../src/modules/ai-oversight/ai-oversight.service';
import { AiOversightController } from '../../src/modules/ai-oversight/ai-oversight.controller';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { EDIT_DISTANCE_CAP } from '../../src/common/util/edit-distance';

type Row = Record<string, any>;

function makePrisma(seed: { encounters?: Row[]; sessions?: Row[]; amended?: string[]; draftedCount?: number }) {
  const encounters = seed.encounters ?? [];
  const sessions = seed.sessions ?? [];
  return {
    encounter: {
      findMany: vi.fn(async () => encounters.map((e) => ({ ...e }))),
    },
    patientJourneyEvent: {
      findMany: vi.fn(async ({ where }: any) =>
        (seed.amended ?? []).filter((id) => where.refId.in.includes(id)).map((refId) => ({ refId }))),
    },
    scribeSession: {
      findMany: vi.fn(async ({ where }: any) => sessions.filter((s) => where.id.in.includes(s.id)).map((s) => ({ id: s.id, draftSnapshot: s.draftSnapshot }))),
      count: vi.fn(async () => seed.draftedCount ?? 0),
    },
  } as any;
}

const svc = (prisma: any) => new AiOversightService(prisma, { callStats: vi.fn() } as any);

const PATIENT_TEXT = '환자고유문장-두통이심함';
let seq = 0;
function enc(over: Row = {}): Row {
  seq++;
  const id = `0000000${seq}-0000-4000-8000-000000000000`.slice(-36);
  return {
    id, status: 'SIGNED', scribeSessionId: `s-${seq}`,
    subjective: PATIENT_TEXT, objective: null, assessment: '평가', plan: '계획',
    ...over,
  };
}

describe('scribeEdits — 표본 0', () => {
  it('🔴 ① 표본 0 이면 분포는 null + 사유, 무수정 pct 는 null(0% 아님)', async () => {
    const r = await svc(makePrisma({})).scribeEdits(7);
    expect(r.funnel).toMatchObject({ signedScribed: 0, eligible: 0, measured: 0 });
    expect(r.overall.medianPct).toBeNull();
    expect(r.overall.p90Pct).toBeNull();
    expect(r.overall.distributionUnavailableReason).toBe('NO_SAMPLE');
    expect(r.overall.unchanged.pct).toBeNull();
    expect(r.overall.unchanged.unavailableReason).toBe('ZERO_DENOMINATOR');
    for (const f of ['subjective', 'objective', 'assessment', 'plan'] as const) {
      expect(r.sections[f].medianPct).toBeNull();
      expect(r.sections[f].unchanged.pct).toBeNull();
    }
  });

  it('🔴 ② 초안 스냅샷 없는 진료는 표본이 아니다 — noDraftSnapshot 으로 센다', async () => {
    const e = enc();
    const r = await svc(makePrisma({ encounters: [e], sessions: [{ id: e.scribeSessionId, draftSnapshot: null }] })).scribeEdits(7);
    expect(r.funnel.eligible).toBe(1);
    expect(r.funnel.noDraftSnapshot).toBe(1);
    expect(r.funnel.measured).toBe(0);
    expect(r.overall.unchanged.pct).toBeNull();
    expect(r.overall.medianPct).toBeNull();
  });
});

describe('scribeEdits — 분포', () => {
  it('대조군 — 5건 모두 무수정이면 중앙값 0%·p90 0%·무수정 100%(진짜 0 은 0)', async () => {
    const encs = Array.from({ length: 5 }, () => enc());
    const sessions = encs.map((e) => ({ id: e.scribeSessionId, draftSnapshot: { soap: { subjective: PATIENT_TEXT } } }));
    const r = await svc(makePrisma({ encounters: encs, sessions })).scribeEdits(7);
    expect(r.funnel.measured).toBe(5);
    expect(r.overall.medianPct).toBe(0);
    expect(r.overall.p90Pct).toBe(0);
    expect(r.overall.unchanged).toMatchObject({ numerator: 5, denominator: 5, pct: 100 });
    // 초안이 S 만 냈다 — O·A·P 는 표본이 아니다
    expect(r.sections.subjective.measured).toBe(5);
    expect(r.sections.plan.drafted).toBe(0);
    expect(r.sections.plan.unchanged.pct).toBeNull();
  });

  it('수정이 있으면 정규화 수정량 분포를 낸다(섹션 지움 = 100%)', async () => {
    const encs = Array.from({ length: 5 }, (_, i) => enc(i === 0 ? { subjective: null } : {}));
    const sessions = encs.map((e) => ({ id: e.scribeSessionId, draftSnapshot: { soap: { subjective: PATIENT_TEXT } } }));
    const r = await svc(makePrisma({ encounters: encs, sessions })).scribeEdits(7);
    expect(r.overall.measured).toBe(5);
    expect(r.overall.unchanged).toMatchObject({ numerator: 4, denominator: 5 });
    expect(r.overall.medianPct).toBe(0);
    expect(r.overall.p90Pct).toBe(60); // [0,0,0,0,1] p90 선형보간 = 0.6
  });

  it('표본이 최소 미만이면 분포 null + 몇 건인지 말한다(무수정 비율은 분모와 함께 낸다)', async () => {
    const encs = [enc(), enc()];
    const sessions = encs.map((e) => ({ id: e.scribeSessionId, draftSnapshot: { soap: { subjective: PATIENT_TEXT } } }));
    const r = await svc(makePrisma({ encounters: encs, sessions })).scribeEdits(7);
    expect(r.overall.medianPct).toBeNull();
    expect(r.overall.distributionUnavailableReason).toBe('BELOW_MIN_SAMPLE');
    expect(r.overall.measured).toBe(2);
    expect(r.overall.unchanged).toMatchObject({ numerator: 2, denominator: 2, pct: 100 });
  });

  it('🔴 ③ 정정 이력·정정 중인 진료는 분포에서 빼고 센다', async () => {
    const a = enc();
    const b = enc({ status: 'AMENDED' });
    const c = enc();
    const sessions = [a, b, c].map((e) => ({ id: e.scribeSessionId, draftSnapshot: { soap: { subjective: PATIENT_TEXT } } }));
    const r = await svc(makePrisma({ encounters: [a, b, c], sessions, amended: [a.id] })).scribeEdits(7);
    expect(r.funnel).toMatchObject({ signedScribed: 3, notCurrentlySigned: 1, amendedAfterSign: 1, eligible: 1, measured: 1 });
  });

  it('🔴 ④ 상한 초과는 분포에 섞지 않고 따로 센다', async () => {
    const long = 'x'.repeat(EDIT_DISTANCE_CAP + 10);
    const e = enc({ subjective: long });
    const r = await svc(makePrisma({ encounters: [e], sessions: [{ id: e.scribeSessionId, draftSnapshot: { soap: { subjective: long } } }] })).scribeEdits(7);
    expect(r.funnel.capped).toBe(1);
    expect(r.funnel.measured).toBe(0);
    expect(r.overall.unchanged.pct).toBeNull();
  });

  it('녹음 초안이 반영 기록 없이 남은 세션 수를 함께 말한다', async () => {
    const r = await svc(makePrisma({ draftedCount: 3 })).scribeEdits(30);
    expect(r.draftedWithoutApply).toBe(3);
    expect(r.windowDays).toBe(30);
  });

  it('🔴 ⑤ 응답에 환자 본문·진료 id·세션 id 가 없다', async () => {
    const encs = Array.from({ length: 5 }, () => enc());
    const sessions = encs.map((e) => ({ id: e.scribeSessionId, draftSnapshot: { soap: { subjective: PATIENT_TEXT } } }));
    const r = await svc(makePrisma({ encounters: encs, sessions })).scribeEdits(7);
    const json = JSON.stringify(r);
    expect(json).not.toContain(PATIENT_TEXT);
    for (const e of encs) {
      expect(json).not.toContain(e.id);
      expect(json).not.toContain(e.scribeSessionId);
    }
  });
});

describe('scribe-edits EP', () => {
  it('⑥ 역할은 이웃 summary 와 같다 — ADMIN·EXECUTIVE·DOCTOR', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, AiOversightController.prototype.scribeEdits);
    const summaryRoles = Reflect.getMetadata(ROLES_KEY, AiOversightController.prototype.summary);
    expect([...roles].sort()).toEqual([...summaryRoles].sort());
  });

  it('응답 규약 { data, meta } — meta 가 측정 수와 잘림을 말한다', async () => {
    const service = { scribeEdits: vi.fn(async () => ({ funnel: { measured: 0 }, truncated: false })) } as any;
    const ctl = new AiOversightController(service, {} as any);
    const out = await ctl.scribeEdits({ days: 7 } as any);
    expect(out.meta).toEqual({ measured: 0, truncated: false });
    expect(service.scribeEdits).toHaveBeenCalledWith(7);
  });
});
