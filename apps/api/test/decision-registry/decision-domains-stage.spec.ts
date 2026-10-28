/**
 * 결정 목록 — 영역·연결 안건·과정 단계 배선(2026-10-10 사용자 요청 "위원회 의사결정 과정 순서와 기본 설정·의료·운영·행정 구분").
 *  · 등록부 전 키가 영역을 가진다 · 예외 키는 등록부에 실재한다 · 축 어휘 = 등록부 DECISION_TRACKS
 *  · 안건은 한 번에 읽는다(N+1 없음) · 최신 1건 · 🔴 조회 실패는 'UNKNOWN'(안건 없음으로 접지 않는다)
 *  · 🔴 개발 시드 + 의결 안건 없음 → PREPARE(시드는 단계를 앞당기지 않는다)
 */
import { describe, it, expect, vi } from 'vitest';
import { DecisionService } from '../../src/modules/decision-registry/decision.service';
import { DECISION_REGISTRY, DECISION_TRACKS } from '../../src/modules/decision-registry/decision.registry';
import { DECISION_TRACK_DOMAIN, DECISION_DOMAIN_OVERRIDES, decisionDomainOf } from '@hospital-run/shared';

const SEED = { legalReviewRef: '개발 시드(DEV-SEED) — 테스트', authorityClaim: '개발 시드(DEV-SEED)' };
const committeeKey = DECISION_REGISTRY.find((d) => d.layer === 'INTERNAL_COMMITTEE' && !(d.dependsOn ?? []).length)!.key;
const otherCommitteeKey = DECISION_REGISTRY.filter((d) => d.layer === 'INTERNAL_COMMITTEE' && !(d.dependsOn ?? []).length)[1].key;

function mk(opts: { agendas?: unknown[]; agendaFail?: boolean; records?: Record<string, unknown> } = {}) {
  const store = new Map<string, unknown>(Object.entries(opts.records ?? {}));
  const config: any = {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    getMany: vi.fn(async (keys: string[]) => new Map(keys.map((k) => [k, store.get(k) ?? null]))),
    set: vi.fn(),
  };
  const agendaFind = vi.fn(async () => { if (opts.agendaFail) throw new Error('db down'); return opts.agendas ?? []; });
  const prisma: any = { decisionAction: { findMany: vi.fn(async () => []) }, committeeAgenda: { findMany: agendaFind } };
  const svc = new DecisionService(prisma, config, { enactRegistryDecision: vi.fn() } as never, { onRecorded: vi.fn(async () => ({ logged: true, propagatedTo: [] })), listSignals: vi.fn(async () => ({ lastReview: new Map(), counts: new Map(), devEvents: new Map() })) } as never, { log: vi.fn().mockResolvedValue(null) } as never);
  return { svc, agendaFind };
}

describe('영역 매핑 — 등록부 대조', () => {
  it('축 어휘 = 등록부 DECISION_TRACKS(빠짐·유령 없음)', () => {
    expect(Object.keys(DECISION_TRACK_DOMAIN).sort()).toEqual(Object.keys(DECISION_TRACKS).sort());
  });
  it('🔴 등록부 전 키가 영역을 가진다', () => {
    const none = DECISION_REGISTRY.filter((d) => decisionDomainOf(d.key, d.track) == null).map((d) => d.key);
    expect(none).toEqual([]);
  });
  it('🔴 예외 키는 등록부에 실재한다(오타·삭제된 키 없음)', () => {
    const keys = new Set(DECISION_REGISTRY.map((d) => d.key));
    expect(Object.keys(DECISION_DOMAIN_OVERRIDES).filter((k) => !keys.has(k))).toEqual([]);
  });
});

describe('목록 — 안건·단계 배선', () => {
  it('안건은 한 번에 읽고(N+1 없음) 최신 1건만 붙는다 · 단계 = 안건 상태', async () => {
    const { svc, agendaFind } = mk({ agendas: [
      { id: 'a2', status: 'SCHEDULED', meetingId: 'm1', updatedAt: new Date('2026-10-09'), sourceRef: { type: 'DECISION', key: committeeKey }, committee: { code: 'QPS', name: 'QI 위원회' } },
      { id: 'a1', status: 'SUBMITTED', meetingId: null, updatedAt: new Date('2026-10-01'), sourceRef: { type: 'DECISION', key: committeeKey }, committee: { code: 'QPS', name: 'QI 위원회' } },
    ] });
    const r = await svc.list();
    expect(agendaFind).toHaveBeenCalledTimes(1);
    expect(agendaFind.mock.calls[0][0].where).toEqual({ sourceRef: { path: ['type'], equals: 'DECISION' } });
    const it0 = r.items.find((i) => i.key === committeeKey)!;
    expect(it0.agenda).toMatchObject({ id: 'a2', status: 'SCHEDULED', committee: { name: 'QI 위원회' } });
    expect(it0.stage.stage).toBe('DELIBERATION');
    expect(r.items.find((i) => i.key === otherCommitteeKey)!.agenda).toBeNull();
    expect(r.summary.agendaUnknown).toBe(false);
  });

  it('🔴 안건 조회 실패 — 목록은 살고 항목은 UNKNOWN · 요약에 표식 · 대조군: 정상이면 null', async () => {
    const r = await mk({ agendaFail: true }).svc.list();
    expect(r.items.every((i) => i.agenda === 'UNKNOWN')).toBe(true);
    expect(r.summary.agendaUnknown).toBe(true);
    expect(r.items.find((i) => i.key === committeeKey)!.stage.flags).toContain('AGENDA_UNKNOWN');
    const ok = await mk().svc.list();
    expect(ok.items.find((i) => i.key === committeeKey)!.agenda).toBeNull();
  });

  it('🔴 개발 시드는 단계를 앞당기지 않는다(PREPARE + 시드 표식)', async () => {
    const r = await mk({ records: { [`decision.${committeeKey}`]: { choice: DECISION_REGISTRY.find((d) => d.key === committeeKey)!.options[0].value, decidedByUserId: 'u', decidedAt: '2026-10-10', applied: true, ...SEED } } }).svc.list();
    const it0 = r.items.find((i) => i.key === committeeKey)!;
    expect(it0.seeded).toBe(true);
    expect(it0.stage.stage).toBe('PREPARE');
    expect(it0.stage.flags).toContain('SEEDED');
  });

  it('요약 — 영역별 합 = 전체 · 순서 기본 설정부터 · 단계별은 위원회 층만 · ⑦ 확인은 null', async () => {
    const r = await mk().svc.list();
    expect(r.summary.byDomain.map((d) => d.domain)).toEqual(['FOUNDATION', 'MEDICAL', 'OPERATIONS', 'ADMIN', 'SECURITY']);
    expect(r.summary.byDomain.reduce((n, d) => n + d.total, 0)).toBe(DECISION_REGISTRY.length);
    const committee = DECISION_REGISTRY.filter((d) => d.layer === 'INTERNAL_COMMITTEE').length;
    expect(r.summary.byStage.filter((s) => s.count != null).reduce((n, s) => n + (s.count ?? 0), 0)).toBe(committee);
    expect(r.summary.byStage.find((s) => s.stage === 'VERIFIED')!.count).toBeNull();
  });
});
