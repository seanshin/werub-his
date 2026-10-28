/**
 * 🔴 결정 등록부 증분 A(2026-09-15) — 기획서 전체 검토·세션 산출 사람 결정 D01~D17 이 **화면에 올라와 있다**.
 *
 * 문서(`docs/04-report/remaining-2026-09-14/2-human-decisions.md`)에 있는 동안에는 아무도 고를 수 없다.
 * 지키는 것: ① 17건 전부 등재·키 중복 0 ② 고를 수 있는 모양(선택지 2+·결과·현행·확인 경로·남는 일)
 *           ③ 등재가 결정을 대신하지 않는다 — 자동 집행 바인딩(enactKind·configKey)을 걸지 않았다
 *           ④ 서비스 목록(/admin/decisions)이 17건을 "미결"로 그린다
 *           ⑤ 법령 수치를 등록부에 넣지 않는다(판정 규칙 7장)
 */
import { describe, it, expect, vi } from 'vitest';
import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';
import { DECISION_BATCH_2026_09_A } from '../../src/modules/decision-registry/decision.registry.batch-2026-09-a';
import { DecisionService } from '../../src/modules/decision-registry/decision.service';

const KEYS = [
  'policy.careTeam.accessModel', 'legal.voucher.legalFloors', 'policy.voucher.settlement',
  'policy.clinicalChartLibrary.exposure', 'policy.healthContent.medicalReview', 'ai.draftProvenanceSchema',
  'legal.recordArchive.policy', 'policy.disasterRecovery', 'policy.consent.requiredBeforeIntake',
  'policy.consent.translation', 'policy.mrn.numbering', 'policy.db.unappliedIndexes',
  'policy.criticalValue.escalation', 'policy.journey.patientExposure', 'policy.facilityInfo.floorGuide',
  'policy.microbiology.scope', 'policy.lab.referenceRangeSource',
];

describe('결정 등록부 증분 A — D01~D17', () => {
  it('① 17건 전부 등록부에 있고 키가 중복되지 않는다', () => {
    expect(DECISION_BATCH_2026_09_A.map((d) => d.key)).toEqual(KEYS);
    const all = DECISION_REGISTRY.map((d) => d.key);
    for (const k of KEYS) expect(all.filter((x) => x === k), k).toHaveLength(1);
  });

  it('② 고를 수 있는 모양 — 선택지 2개 이상·결과·현행·확인 경로·남는 일', () => {
    for (const d of DECISION_BATCH_2026_09_A) {
      expect(d.options.length, d.key).toBeGreaterThan(1);
      for (const o of d.options) expect(o.effect.trim().length, `${d.key}.${o.value}`).toBeGreaterThan(20);
      expect(d.statusQuo.trim().length, `${d.key}: statusQuo`).toBeGreaterThan(30);
      expect((d.verifyHow ?? []).length, `${d.key}: verifyHow`).toBeGreaterThan(0);
      expect((d.afterDecision ?? '').trim().length, `${d.key}: afterDecision`).toBeGreaterThan(10);
    }
  });

  it('③ 등재가 결정을 대신하지 않는다 — 자동 집행 바인딩을 걸지 않았다', () => {
    const bound = DECISION_BATCH_2026_09_A.filter((d) => d.enactKind || d.configKey || d.options.some((o) => 'enact' in o));
    expect(bound.map((d) => d.key)).toEqual([]);
  });

  it('④ 서비스 목록이 17건을 미결로 그린다', async () => {
    const config: any = {
      get: vi.fn(async () => null),
      getMany: vi.fn(async (keys: string[]) => new Map(keys.map((k) => [k, null]))),
      set: vi.fn(),
    };
    const prisma: any = { decisionAction: { findMany: vi.fn(async () => []) } };
    const svc = new DecisionService(prisma, config, {} as never, { onRecorded: vi.fn(async () => ({ logged: true, propagatedTo: [] })), listSignals: vi.fn(async () => ({ lastReview: new Map(), counts: new Map(), devEvents: new Map() })) } as never, { log: vi.fn() } as never);
    const res: any = await svc.list();
    const items: any[] = Array.isArray(res) ? res : res.items;
    const mine = items.filter((i) => KEYS.includes(i.key));
    expect(mine).toHaveLength(KEYS.length);
    expect(mine.every((i) => i.decided === false)).toBe(true);
  });

  it('⑤ 법령 수치를 넣지 않는다 — 개월·%·년 수치 표기가 선택지·현행에 없다', () => {
    const NUM = /\d+\s*(개월|%|년)/;
    for (const d of DECISION_BATCH_2026_09_A) {
      const text = [d.statusQuo, d.why, ...d.options.map((o) => o.effect), ...d.legalReview].join(' ');
      expect(text, d.key).not.toMatch(NUM);
    }
  });

  it('대조군 — 개시 전 필수는 기한도 개시 전이다', () => {
    const req = DECISION_BATCH_2026_09_A.filter((d) => d.goLive === 'REQUIRED_BEFORE');
    expect(req.length).toBeGreaterThan(0);
    for (const d of req) expect(d.dueBy, d.key).toBe('BEFORE_GO_LIVE');
  });
});
