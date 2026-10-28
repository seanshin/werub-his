import { describe, expect, it, vi } from 'vitest';
import { GovernanceEnactmentService, ENACTABLE_KINDS, AUTO_ENACT_KINDS, surfaceKeyOf } from '../../src/modules/gld/governance-enactment.service';

/**
 * 거버넌스 집행 바인딩 계약(P3·D11) — kind 9종의 ①검증 규칙 ②디스패치 ③표면 키 귀속 baseline.
 * 원칙 고정: 비멱등 toggle 금지·파기 실행 바인딩 금지·미배선 바인딩 의결 시점 거부·Map 부분 키 집행은 타 키 불변.
 */

type AnyRecord = Record<string, unknown>;

function makeService(overrides: {
  config?: AnyRecord; prisma?: AnyRecord;
  formulary?: AnyRecord | null; referenceRange?: AnyRecord; cdss?: AnyRecord; triage?: AnyRecord;
  codeMaster?: AnyRecord; duty?: AnyRecord; durRules?: AnyRecord; consentTemplate?: AnyRecord;
  chartTemplate?: AnyRecord; accessControl?: AnyRecord; featureAccess?: AnyRecord;
  protocol?: AnyRecord; pathway?: AnyRecord; orderSet?: AnyRecord; retention?: AnyRecord;
} = {}) {
  const config = overrides.config ?? {
    hasDefault: (k: string) => k !== 'not.registered',
    get: vi.fn(async () => null),
    set: vi.fn(async () => ({})),
  };
  const stub = () => ({} as AnyRecord);
  const svc = new GovernanceEnactmentService(
    (overrides.prisma ?? {}) as never,
    config as never,
    undefined, undefined,
    (overrides.formulary === null ? undefined : (overrides.formulary ?? stub())) as never,
    (overrides.referenceRange ?? stub()) as never,
    (overrides.cdss ?? stub()) as never,
    (overrides.triage ?? stub()) as never,
    (overrides.codeMaster ?? stub()) as never,
    (overrides.duty ?? stub()) as never,
    (overrides.durRules ?? stub()) as never,
    (overrides.consentTemplate ?? stub()) as never,
    (overrides.chartTemplate ?? stub()) as never,
    (overrides.accessControl ?? stub()) as never,
    (overrides.featureAccess ?? stub()) as never,
    (overrides.protocol ?? stub()) as never,
    (overrides.pathway ?? stub()) as never,
    (overrides.orderSet ?? stub()) as never,
    (overrides.retention ?? stub()) as never,
  );
  return { svc, config };
}

describe('개방 kind 목록', () => {
  it('9종 개방·MANUAL 은 자동 집행 밖', () => {
    expect([...ENACTABLE_KINDS].sort()).toEqual(
      ['ACCESS', 'CONFIG_CHANGE', 'FORMULARY', 'GATE_MODE', 'MANUAL', 'MASTER_DATA', 'PUBLISH', 'RETENTION', 'TEMPLATE'],
    );
    expect(AUTO_ENACT_KINDS).not.toContain('MANUAL');
  });
});

describe('validateAction — 의결 시점 검증', () => {
  const { svc } = makeService();

  it('CONFIG_CHANGE — 보호 키·미등재 키 거부(기존 계약 유지)', () => {
    expect(() => svc.validateAction('CONFIG_CHANGE', { key: 'integration.pseudonymizeChartNo', newValue: true }))
      .toThrowError(/PROTECTED_KEY|전용 승인/);
    expect(() => svc.validateAction('CONFIG_CHANGE', { key: 'not.registered', newValue: 1 }))
      .toThrowError(/카탈로그에 없습니다/);
  });

  it('GATE_MODE — Map 부분 키(D15)는 3상만, boolean 은 mapKey 없이만', () => {
    expect(() => svc.validateAction('GATE_MODE', { gateKey: 'formulary.enforce', mapKey: 'LAB', mode: 'WARN' })).not.toThrow();
    expect(() => svc.validateAction('GATE_MODE', { gateKey: 'formulary.enforce', mapKey: 'LAB', mode: true }))
      .toThrowError(/OFF\/WARN\/BLOCK/);
    expect(() => svc.validateAction('GATE_MODE', { gateKey: 'inpatient.dischargeGate', mode: true })).not.toThrow();
  });

  it('FORMULARY — toggle 은 비멱등이라 금지, setStatus 는 목표 상태 지정', () => {
    expect(() => svc.validateAction('FORMULARY', { op: 'toggle', domain: 'MEDICATION', id: 'x' }))
      .toThrowError(/비멱등|NON_IDEMPOTENT/);
    expect(() => svc.validateAction('FORMULARY', { op: 'setStatus', id: 'f1', status: 'SUSPENDED' })).not.toThrow();
    expect(() => svc.validateAction('FORMULARY', { op: 'setStatus', status: 'SUSPENDED' })).toThrowError(/id/);
    expect(() => svc.validateAction('FORMULARY', { op: 'add', domain: 'BOGUS', items: [{}] })).toThrowError(/domain/);
    expect(() => svc.validateAction('FORMULARY', { op: 'decide', requestId: 'r1', approve: true })).not.toThrow();
  });

  it('MASTER_DATA — 서브바인딩 등록제·약품마스터 필드 화이트리스트', () => {
    expect(() => svc.validateAction('MASTER_DATA', { master: 'ward-master', op: 'update', id: 'x', payload: {} }))
      .toThrowError(/등재되지 않은 마스터/);
    expect(() => svc.validateAction('MASTER_DATA', { master: 'medication-code', op: 'update', id: 'm1', payload: { unitPrice: 100, __bogus__: 1 } }))
      .toThrowError(/허용 밖 필드/);
    expect(() => svc.validateAction('MASTER_DATA', { master: 'dur-rules', op: 'update', id: 'd1', payload: { isActive: false } })).not.toThrow();
    expect(() => svc.validateAction('MASTER_DATA', { master: 'staffing-rule', op: 'upsert', payload: { department: '내과', shift: 'DAY', minCount: 3 } })).not.toThrow();
  });

  it('TEMPLATE — toggle 금지·CONSENT=setActive/restore·CHART=rollback/deactivate', () => {
    expect(() => svc.validateAction('TEMPLATE', { templateType: 'CONSENT', id: 't1', op: 'toggle' }))
      .toThrowError(/비멱등|NON_IDEMPOTENT/);
    expect(() => svc.validateAction('TEMPLATE', { templateType: 'CONSENT', id: 't1', op: 'setActive' })).toThrowError(/active/);
    expect(() => svc.validateAction('TEMPLATE', { templateType: 'CONSENT', id: 't1', op: 'setActive', active: true })).not.toThrow();
    expect(() => svc.validateAction('TEMPLATE', { templateType: 'CHART', id: 't2', op: 'rollback', versionId: 'v1' })).not.toThrow();
    expect(() => svc.validateAction('TEMPLATE', { templateType: 'CHART', id: 't2', op: 'rollback' })).toThrowError(/versionId/);
  });

  it('ACCESS — scope 4종·dept 는 경로 배열', () => {
    expect(() => svc.validateAction('ACCESS', { scope: 'menu', key: 'x', value: {} })).toThrowError(/scope/);
    expect(() => svc.validateAction('ACCESS', { scope: 'dept', key: '원무과', value: 'not-array' })).toThrowError(/배열/);
    expect(() => svc.validateAction('ACCESS', { scope: 'dept', key: '원무과', value: ['/dashboard'] })).not.toThrow();
    expect(() => svc.validateAction('ACCESS', { scope: 'role-data', key: 'NURSE', value: { labView: true } })).not.toThrow();
  });

  it('PUBLISH — PROTOCOL 은 publish 만(정본에 retire 부재)·PATHWAY/ORDER_SET 은 publish/retire', () => {
    expect(() => svc.validateAction('PUBLISH', { docType: 'PROTOCOL', id: 'p1', op: 'retire' })).toThrowError(/publish 만/);
    expect(() => svc.validateAction('PUBLISH', { docType: 'PATHWAY', id: 'p2', op: 'retire' })).not.toThrow();
    expect(() => svc.validateAction('PUBLISH', { docType: 'ORDER_SET', id: 'p3', op: 'publish' })).not.toThrow();
  });

  it('RETENTION — 정책 등록만·파기 실행 바인딩 거부(4-eyes 존중)', () => {
    expect(() => svc.validateAction('RETENTION', { resourceType: 'AuditLog', retentionDays: 1825 })).not.toThrow();
    expect(() => svc.validateAction('RETENTION', { resourceType: 'AuditLog', retentionDays: 1825, op: 'purge' }))
      .toThrowError(/파기 실행|PURGE_NOT_BINDABLE/);
    expect(() => svc.validateAction('RETENTION', { resourceType: 'AuditLog', retentionDays: -1 })).toThrowError(/0 이상/);
  });

  it('미배선 서비스 바인딩은 의결 시점 거부(BINDING_NOT_WIRED — 조용한 no-op 방지)', () => {
    const { svc: bare } = makeService({ formulary: null });
    expect(() => bare.validateAction('FORMULARY', { op: 'setStatus', id: 'f1', status: 'ACTIVE' }))
      .toThrowError(/미배선|BINDING_NOT_WIRED/);
  });
});

describe('surfaceKeyOf — 역추적·배지 귀속 규칙', () => {
  it('config/gate 는 bare(하위호환)·신규 kind 는 네임스페이스', () => {
    expect(surfaceKeyOf('CONFIG_CHANGE', { key: 'dur.enforce' })).toBe('dur.enforce');
    expect(surfaceKeyOf('GATE_MODE', { gateKey: 'formulary.enforce', mapKey: 'LAB' })).toBe('formulary.enforce');
    expect(surfaceKeyOf('FORMULARY', { op: 'add', domain: 'MEDICATION' })).toBe('formulary:MEDICATION');
    expect(surfaceKeyOf('MASTER_DATA', { master: 'dur-rules' })).toBe('master:dur-rules'); // SURFACE_SEED 표기와 일치
    expect(surfaceKeyOf('TEMPLATE', { templateType: 'CONSENT' })).toBe('template:consent'); // SURFACE_SEED 표기와 일치
    expect(surfaceKeyOf('ACCESS', { scope: 'dept', key: '원무과' })).toBe('access:dept:원무과');
    expect(surfaceKeyOf('PUBLISH', { docType: 'PATHWAY', id: 'p1' })).toBe('publish:pathway:p1');
    expect(surfaceKeyOf('RETENTION', { resourceType: 'AuditLog' })).toBe('retention:AuditLog');
  });
});

describe('enactDecision — 디스패치·스냅샷·Map 부분 집행', () => {
  function makeEnactHarness(actions: AnyRecord[], extra: Parameters<typeof makeService>[0] = {}) {
    const updates: AnyRecord[] = [];
    const prisma = {
      committeeDecision: {
        findUnique: vi.fn(async () => ({
          id: 'd1', status: 'RESOLVED', effectiveFrom: null, committeeId: 'c1',
          decisionNo: 'GOV-2026-900', committee: { code: 'DTC' }, actions,
        })),
        update: vi.fn(async () => ({})),
      },
      decisionAction: {
        update: vi.fn(async (args: AnyRecord) => { updates.push(args); return {}; }),
        count: vi.fn(async () => 0),
      },
      user: { findMany: vi.fn(async () => []) },
      formularyItem: { findUnique: vi.fn(async () => ({ status: 'ACTIVE', committee: null, note: null })) },
      formularyRequest: { findUnique: vi.fn(async () => ({ status: 'PENDING', decision: null })) },
      retentionPolicy: { findUnique: vi.fn(async () => null) },
      consentTemplate: { findUnique: vi.fn(async () => ({ isActive: false, version: '1.0' })) },
      chartTemplate: { findUnique: vi.fn(async () => ({ isActive: true, version: 3 })) },
      clinicalPathway: { findUnique: vi.fn(async () => ({ status: 'DRAFT' })) },
      orderSet: { findUnique: vi.fn(async () => ({ status: 'DRAFT' })) },
      protocolTemplate: { findUnique: vi.fn(async () => ({ status: 'DRAFT', code: 'P', version: 1 })) },
      durRule: { findUnique: vi.fn(async () => ({ isActive: true })) },
    };
    const config = {
      hasDefault: () => true,
      get: vi.fn(async (k: string) => (k === 'governance.enactment.enabled' ? true : { MEDICATION: 'BLOCK' })),
      set: vi.fn(async () => ({})),
    };
    const { svc } = makeService({ ...extra, prisma, config });
    return { svc, prisma, config, updates };
  }

  it('FORMULARY setStatus — 정본 update 호출·committee 필드에 의결번호 귀속·스냅샷 기록', async () => {
    const formulary = { update: vi.fn(async () => ({})) };
    const { svc, updates } = makeEnactHarness(
      [{ id: 'a1', status: 'PENDING', kind: 'FORMULARY', target: { op: 'setStatus', id: 'f1', status: 'SUSPENDED' } }],
      { formulary },
    );
    const r = await svc.enactDecision('d1', 'user-1');
    expect(r.enacted).toBe(1);
    expect(formulary.update).toHaveBeenCalledWith('user-1', 'f1', { status: 'SUSPENDED', committee: 'DTC GOV-2026-900' });
    const enactedUpdate = updates.find((u) => (u.data as AnyRecord).status === 'ENACTED');
    expect((enactedUpdate!.data as AnyRecord).snapshotBefore).toMatchObject({ id: 'f1', before: { status: 'ACTIVE' } });
  });

  it('GATE_MODE Map 부분 키(D15) — 대상 키만 바꾸고 타 영역 불변', async () => {
    const { svc, config } = makeEnactHarness(
      [{ id: 'a1', status: 'PENDING', kind: 'GATE_MODE', target: { gateKey: 'formulary.enforce', mapKey: 'LAB', mode: 'WARN' } }],
    );
    await svc.enactDecision('d1', 'user-1');
    expect(config.set).toHaveBeenCalledWith('formulary.enforce', { MEDICATION: 'BLOCK', LAB: 'WARN' }, 'user-1');
  });

  it('RETENTION — upsertPolicy 정본 호출(파기 경로 접근 없음)', async () => {
    const retention = { upsertPolicy: vi.fn(async () => ({})), purge: vi.fn() };
    const { svc } = makeEnactHarness(
      [{ id: 'a1', status: 'PENDING', kind: 'RETENTION', target: { resourceType: 'VoiceCommandLog', retentionDays: 365, action: 'SOFT_DELETE' } }],
      { retention },
    );
    const r = await svc.enactDecision('d1', 'user-1');
    expect(r.enacted).toBe(1);
    expect(retention.upsertPolicy).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'VoiceCommandLog', retentionDays: 365, action: 'SOFT_DELETE' }));
    expect(retention.purge).not.toHaveBeenCalled();
  });

  it('PUBLISH ORDER_SET publish — changeStatus(ACTIVE) 정본 경유·실패는 FAILED 로 남는다', async () => {
    const orderSet = {
      changeStatus: vi.fn(async () => { throw new Error('미해석 항목 2건 — ACTIVE 승격 불가'); }),
      deprecateOrderSet: vi.fn(),
    };
    const { svc, updates } = makeEnactHarness(
      [{ id: 'a1', status: 'PENDING', kind: 'PUBLISH', target: { docType: 'ORDER_SET', id: 'os1', op: 'publish' } }],
      { orderSet },
    );
    const r = await svc.enactDecision('d1', 'user-1');
    expect(r.failed).toBe(1);
    const failedUpdate = updates.find((u) => (u.data as AnyRecord).status === 'FAILED');
    expect((failedUpdate!.data as AnyRecord).error).toContain('미해석 항목');
  });

  it('TEMPLATE CONSENT setActive — 멱등 목표 상태 경로만 호출(toggleActive 미사용)', async () => {
    const consentTemplate = { setActive: vi.fn(async () => ({})), toggleActive: vi.fn() };
    const { svc } = makeEnactHarness(
      [{ id: 'a1', status: 'PENDING', kind: 'TEMPLATE', target: { templateType: 'CONSENT', id: 't1', op: 'setActive', active: true } }],
      { consentTemplate },
    );
    const r = await svc.enactDecision('d1', 'user-1');
    expect(r.enacted).toBe(1);
    expect(consentTemplate.setActive).toHaveBeenCalledWith('t1', true);
    expect(consentTemplate.toggleActive).not.toHaveBeenCalled();
  });

  it('MASTER_DATA dur-rules update — Repo 쓰기 정본(캐시 무효화 내장) 경유', async () => {
    const durRules = { updateRule: vi.fn(async () => ({})) };
    const { svc } = makeEnactHarness(
      [{ id: 'a1', status: 'PENDING', kind: 'MASTER_DATA', target: { master: 'dur-rules', op: 'update', id: 'r1', payload: { isActive: false } } }],
      { durRules },
    );
    const r = await svc.enactDecision('d1', 'user-1');
    expect(r.enacted).toBe(1);
    expect(durRules.updateRule).toHaveBeenCalledWith('r1', { isActive: false });
  });
});
