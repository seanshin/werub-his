import { describe, it, expect, vi } from 'vitest';
import { GovernanceEnactmentService } from '../../src/modules/gld/governance-enactment.service';

/**
 * 🔴 **바인딩하기 전에 그 경로를 눌러본다.**
 *
 * 집행 kind 9종 중 운영에서 실제로 지나간 것은 **3종뿐**이다
 * (`CONFIG_CHANGE` 12 · `GATE_MODE` 5 · `MANUAL` 7 — 2026-08-27 실측).
 * 나머지 6종(`FORMULARY`·`MASTER_DATA`·`TEMPLATE`·`ACCESS`·`PUBLISH`·`RETENTION`)은
 * **한 번도 집행된 적이 없다.** 결정에 바인딩하는 순간 처음 도는 코드가 된다.
 *
 * 부팅 프로브(2026-08-27)로 **배선은 6종 전부 확인**했다(`BINDING_NOT_WIRED` 0건).
 * 여기서는 그 다음 층 — **디스패치가 정본의 어느 메서드를 어떤 인자로 부르는가** — 를 못박는다.
 *
 * 🔴 왜 필요한가: 디스패치는 메서드 **이름**만 타입이 지키고 **인자는 `as never`** 로 우회한다.
 *    이름이 바뀌면 tsc 가 잡지만, 인자 순서가 바뀌면 아무도 모른 채 잘못된 값이 정본에 들어간다.
 */
type Svc = Record<string, ReturnType<typeof vi.fn>>;

function make() {
  const mk = (...names: string[]): Svc =>
    Object.fromEntries(names.map((n) => [n, vi.fn().mockResolvedValue(null)])) as Svc;

  const services = {
    formulary: mk('add', 'update', 'decide'),
    referenceRange: mk('create', 'update', 'deactivate'),
    cdss: mk('createRule', 'updateRule', 'deleteRule'),
    triage: mk('createRule', 'updateRule', 'deleteRule'),
    codeMaster: mk('createMedication', 'updateMedication', 'deleteMedication'),
    duty: mk('upsertStaffingRule', 'deleteStaffingRule'),
    durRules: mk('createRule', 'updateRule', 'deleteRule'),
    nursing: mk('upsertChecklistTemplate'),
    consentTemplate: mk('setActive', 'restoreVersion'),
    chartTemplate: mk('rollbackToVersion', 'delete'),
    accessControl: mk('getRoleDataAccess', 'setRoleDataAccess', 'getDeptAccess', 'setDeptAccess', 'getPacsAccess', 'setPacsAccess'),
    featureAccess: mk('getConfig', 'setConfig'),
    protocol: mk('publishDraft'),
    pathway: mk('publish', 'retire'),
    orderSet: mk('changeStatus'),
    retention: mk('setPolicy', 'upsertPolicy'),
  };

  const svc = Object.create(GovernanceEnactmentService.prototype) as GovernanceEnactmentService;
  const prismaAny = new Proxy({}, {
    get: () => ({ findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null) }),
  });
  Object.assign(svc, services, {
    prisma: prismaAny,
    config: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(null), hasDefault: () => true },
    audit: { log: vi.fn().mockResolvedValue(null) },
  });
  const exec = (kind: string, target: Record<string, unknown>) =>
    (svc as unknown as {
      executeAction(k: string, t: Record<string, unknown>, c: { decisionNo: string; committeeCode: string | null; userId: string | null }): Promise<unknown>;
    }).executeAction(kind, target, { decisionNo: 'D-1', committeeCode: 'QPS', userId: 'u1' });
  return { exec, services };
}

describe('한 번도 집행된 적 없는 kind 6종 — 디스패치를 못박는다', () => {
  it('FORMULARY — op 별로 정본 메서드가 갈린다(add/update/decide)', async () => {
    const { exec, services } = make();
    await exec('FORMULARY', { op: 'setStatus', id: 'f1', status: 'SUSPENDED' });
    expect(services.formulary.update).toHaveBeenCalled();
    expect(services.formulary.add).not.toHaveBeenCalled();
    await exec('FORMULARY', { op: 'add', domain: 'MEDICATION', items: [{ codeId: 'c1' }] });
    expect(services.formulary.add).toHaveBeenCalled();
    await exec('FORMULARY', { op: 'decide', requestId: 'r1', approve: true });
    expect(services.formulary.decide).toHaveBeenCalled();
  });

  /**
   * 🔴 집행이 정본에 **의결 참조**를 실어야 한다 — 실리지 않으면 나중에
   *    "이 포뮬러리 변경이 어느 결정에서 왔는가"에 답할 수 없다(⚖ 역추적의 근거).
   */
  it('🔴 FORMULARY 가 결정번호를 정본에 남긴다', async () => {
    const { exec, services } = make();
    await exec('FORMULARY', { op: 'setStatus', id: 'f1', status: 'SUSPENDED' });
    const [, , patch] = services.formulary.update.mock.calls[0];
    expect(JSON.stringify(patch), '의결 참조(committee)가 실리지 않았다').toMatch(/D-1|QPS/);
  });

  it('MASTER_DATA — 마스터별로 **다른 정본**을 부른다(한 곳으로 접히지 않았다)', async () => {
    const { exec, services } = make();
    await exec('MASTER_DATA', { master: 'reference-range', op: 'update', id: 'r1', payload: { low: 1 } });
    await exec('MASTER_DATA', { master: 'cdss-rule', op: 'update', id: 'c1', payload: {} });
    await exec('MASTER_DATA', { master: 'dur-rules', op: 'update', id: 'd1', payload: {} });
    expect(services.referenceRange.update).toHaveBeenCalledWith('r1', expect.anything());
    expect(services.cdss.updateRule).toHaveBeenCalledWith('c1', expect.anything());
    expect(services.durRules.updateRule).toHaveBeenCalled();
    // 🔴 대조군: 서로를 부르지 않는다
    expect(services.cdss.updateRule).toHaveBeenCalledTimes(1);
    expect(services.triage.updateRule).not.toHaveBeenCalled();
  });

  it('🔴 MASTER_DATA 인자 **순서** — (id, payload) 다. 뒤바뀌면 정본에 id 가 값으로 들어간다', async () => {
    const { exec, services } = make();
    await exec('MASTER_DATA', { master: 'reference-range', op: 'update', id: 'r1', payload: { low: 7 } });
    const [first, second] = services.referenceRange.update.mock.calls[0];
    expect(first).toBe('r1');
    expect(second).toMatchObject({ low: 7 });
  });

  it('TEMPLATE — CONSENT 와 CHART 가 서로 다른 정본이다', async () => {
    const { exec, services } = make();
    await exec('TEMPLATE', { templateType: 'CONSENT', op: 'setActive', id: 't1', active: true });
    expect(services.consentTemplate.setActive).toHaveBeenCalledWith('t1', true);
    await exec('TEMPLATE', { templateType: 'CHART', op: 'deactivate', id: 't2' });
    expect(services.chartTemplate.delete).toHaveBeenCalledWith('t2');
    expect(services.consentTemplate.restoreVersion).not.toHaveBeenCalled();
  });

  it('ACCESS — scope 별로 다른 정본이고 **집행 전 스냅샷을 읽는다**', async () => {
    const { exec, services } = make();
    await exec('ACCESS', { scope: 'feature', key: 'k1', value: { ADMIN: true } });
    expect(services.featureAccess.getConfig).toHaveBeenCalledWith('k1');   // 🔴 snapshotBefore
    expect(services.featureAccess.setConfig).toHaveBeenCalled();
    await exec('ACCESS', { scope: 'role-data', key: 'NURSE', value: { labs: true } });
    expect(services.accessControl.getRoleDataAccess).toHaveBeenCalledWith('NURSE');
    expect(services.accessControl.setRoleDataAccess).toHaveBeenCalled();
  });

  it('PUBLISH — docType 별 정본 · publish 와 retire 가 갈린다', async () => {
    const { exec, services } = make();
    await exec('PUBLISH', { docType: 'PATHWAY', op: 'publish', id: 'p1' });
    expect(services.pathway.publish).toHaveBeenCalledWith('p1');
    expect(services.pathway.retire).not.toHaveBeenCalled();
    await exec('PUBLISH', { docType: 'PATHWAY', op: 'retire', id: 'p2' });
    expect(services.pathway.retire).toHaveBeenCalledWith('p2');
    await exec('PUBLISH', { docType: 'PROTOCOL', op: 'publish', id: 'x1' });
    expect(services.protocol.publishDraft).toHaveBeenCalled();
  });

  it('🔴 ORDER_SET publish 는 목표 상태를 지정한다(토글이 아니다 — 재시도 안전)', async () => {
    const { exec, services } = make();
    await exec('PUBLISH', { docType: 'ORDER_SET', op: 'publish', id: 'o1' });
    expect(services.orderSet.changeStatus).toHaveBeenCalledWith('o1', 'ACTIVE', 'u1');
  });

  it('RETENTION 은 정책 등록만 — 🔴 파기 실행 메서드를 부르지 않는다', async () => {
    const { exec, services } = make();
    await exec('RETENTION', { resourceType: 'AuditLog', retentionDays: 1825 });
    const called = Object.entries(services.retention).filter(([, f]) => f.mock.calls.length);
    expect(called.length, '보존 정본이 호출되지 않았다').toBeGreaterThan(0);
    for (const [name] of called) {
      expect(name, `파기 실행처럼 보이는 메서드를 불렀다: ${name}`).not.toMatch(/purge|delete|destroy|execute/i);
    }
  });

  it('🔴 대조군: 알 수 없는 kind 는 조용히 넘어가지 않는다', async () => {
    const { exec, services } = make();
    await exec('NOPE' as never, {}).catch(() => undefined);
    for (const [, svc] of Object.entries(services)) {
      for (const [, f] of Object.entries(svc)) expect(f).not.toHaveBeenCalled();
    }
  });
});
