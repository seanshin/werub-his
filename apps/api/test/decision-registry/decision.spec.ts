/**
 * 🔴 중요 사람 결정 — **근거 없이 기록되지 않고, 권한 없는 적용은 하지 않는다** (2026-08-20).
 *
 * 사람 지시: "중요 사람 결정사항은 모두 다이얼로그로 설정하는 기능으로 표현해야 하고,
 * 허가권을 가진 사람이 **법적 검토 후에** 진행되어야 한다."
 *
 * 재주입: 법적 검토 근거 검사를 지우거나, 위원회 사항을 화면이 적용하게 만들면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { DecisionService } from '../../src/modules/decision-registry/decision.service';
import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';

function mk() {
  const store = new Map<string, unknown>();
  const config: any = {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    /**
     * 🔴 목은 **정본이 실제로 하는 일**을 한다 — `list()` 는 설정을 한 번에 읽는다(왕복 줄이기).
     *    여기서 빠뜨리면 "기록이 없다"가 아니라 **전부 미결로 보이는** 화면을 통과시킨다.
     */
    getMany: vi.fn(async (keys: string[]) => new Map(keys.map((k) => [k, store.get(k) ?? null]))),
    set: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }),
  };
  /**
   * 🔴 집행 스텁은 **정본이 실제로 하는 일**을 한다 — 액션 원장에서 target 을 읽어 설정에 반영한다.
   *    2026-08-27 에 생성자가 4인자(prisma·config·enactment·audit)로 늘었는데,
   *    목이 3인자로 남아 있어 `enactment` 자리에 audit 스텁이 들어가 있었다(이 테스트가 잡았다).
   *    빈 스텁으로 때우면 "적용된다"는 단언이 아무것도 보증하지 않게 된다.
   */
  const actions: { id: string; registryKey: string; kind: string; target: any; status: string }[] = [];
  const prisma: any = {
    decisionAction: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `a${actions.length + 1}`, ...data, error: null, enactedAt: null, createdAt: new Date() };
        actions.push(row);
        return row;
      }),
      // 🔴 `list()` 가 이행 상태를 산출하려고 원장을 읽는다 — 목이 이것을 빠뜨리면
      //    "정했는데 반영 안 됨"을 화면이 영원히 말하지 못한다(빈 스텁으로 때우지 않는다)
      findMany: vi.fn(async ({ where }: any) => {
        const keys: string[] = where?.registryKey?.in ?? [];
        return actions.filter((a) => keys.includes(a.registryKey));
      }),
    },
  };
  const enactment: any = {
    enactRegistryDecision: vi.fn(async (registryKey: string) => {
      let enacted = 0;
      for (const a of actions.filter((x) => x.registryKey === registryKey && x.status === 'PENDING')) {
        if (a.kind === 'CONFIG_CHANGE') store.set(String(a.target.key), a.target.newValue);
        a.status = 'ENACTED';
        enacted++;
      }
      return { registryKey, enacted, failed: 0, remaining: 0 };
    }),
  };
  const svc = new DecisionService(prisma, config, enactment, { onRecorded: vi.fn(async () => ({ logged: true, propagatedTo: [] })), listSignals: vi.fn(async () => ({ lastReview: new Map(), counts: new Map(), devEvents: new Map() })) } as never, { log: vi.fn().mockResolvedValue(null) } as never);
  return { svc, config, store, actions, enactment };
}
const ATT = { filename: 'f.pdf', originalName: '근거.pdf', mimetype: 'application/pdf', size: 10 };
const OK = { legalReviewRef: 'CPO-2026-014 개인정보 검토 회신', authorityClaim: '개인정보보호책임자' };

describe('등록부 — 무엇을 결정해야 하는지 적어 둔다', () => {
  it('모든 결정에 법적 검토 항목·허가권·선택지가 있다', () => {
    expect(DECISION_REGISTRY.length).toBeGreaterThan(3);
    for (const d of DECISION_REGISTRY) {
      expect(d.authority, `${d.key} 에 허가권이 없다`).toBeTruthy();
      // 🔴 건별 다이얼로그 층은 여기서 고르는 것이 아니라 업무 화면에서 이뤄진다 — 선택지 1개가 정상
      if (d.approvalPath !== 'PER_EVENT_DIALOG') {
        expect(d.options.length, `${d.key} 에 선택지가 없다`).toBeGreaterThan(1);
      }
      // 🔴 선택의 결과를 화면이 먼저 보여줘야 한다 — 고르고 나서 알면 늦다
      for (const o of d.options) expect(o.effect, `${d.key}/${o.value} 에 결과 설명이 없다`).toBeTruthy();
    }
  });

  it('🔴 기록이 없으면 "미결"이다 — 기본값을 결정인 것처럼 말하지 않는다', async () => {
    const { svc } = mk();
    const { items } = await svc.list();
    expect(items.every((i) => i.decided === false)).toBe(true);
    expect(items.every((i) => i.record === null)).toBe(true);
  });

  it('🔴 시스템이 허가권을 검증하지 못한다는 사실을 밝힌다', async () => {
    const { svc } = mk();
    const r = await svc.list();
    expect(r.caveat).toContain('검증하지 못한다');
  });
});

describe('기록 — 근거 없이는 거부한다(fail-closed)', () => {
  it('🔴 법적 검토 근거가 없으면 거부', async () => {
    const { svc } = mk();
    await expect(svc.decide('policy.patientPush.enable', 'u1', { choice: 'ON', legalReviewRef: '', authorityClaim: 'CPO' }))
      .rejects.toThrow(/법적 검토 근거/);
  });

  it('허가권 근거가 없으면 거부', async () => {
    const { svc } = mk();
    await expect(svc.decide('policy.patientPush.enable', 'u1', { choice: 'ON', legalReviewRef: OK.legalReviewRef, authorityClaim: '' }))
      .rejects.toThrow(/허가권/);
  });

  it('선택지에 없는 값은 거부 — 화면 밖 값으로 켜지지 않는다', async () => {
    const { svc } = mk();
    await expect(svc.decide('policy.patientPush.enable', 'u1', { choice: 'FORCE_ON', ...OK })).rejects.toThrow(/선택지/);
  });

  it('등록되지 않은 결정은 거부 — 등재부터 한다', async () => {
    const { svc } = mk();
    await expect(svc.decide('no.such.decision', 'u1', { choice: 'ON', ...OK })).rejects.toThrow();
  });
});

describe('적용 — 화면이 갖지 않은 권한을 가진 척하지 않는다', () => {
  it('허가권 경로는 **상위 층이 충족된 뒤에** 기록하면 설정을 적용한다', async () => {
    const { svc, store } = mk();
    await svc.addAttachment('legal.patientPush.consentScope', 'u1', ATT);
    await svc.decide('legal.patientPush.consentScope', 'u1', { choice: 'CLEARED', ...OK }); // 법적 요건 선행
    const r = await svc.decide('policy.patientPush.enable', 'u1', { choice: 'ON', ...OK });
    expect(r.record.applied).toBe(true);
    expect(store.get('notification.patientPush.enabled')).toBe(true);
  });

  it('🔴 위원회 의결 사항은 적용하지 않는다 — 안건으로 넘긴다', async () => {
    const { svc, store } = mk();
    await svc.addAttachment('legal.ai.deviceClassification', 'u1', ATT);
    await svc.decide('legal.ai.deviceClassification', 'u1', { choice: 'CLEARED_NON_DEVICE', ...OK });
    const r = await svc.decide('policy.ai.autonomyScope', 'u1', { choice: 'LOW_RISK_ONLY', ...OK });
    expect(r.record.applied).toBe(false);
    expect(r.record.appliedDetail).toContain('위원회');
    expect(store.get('policy.ai.autonomyScope')).toBeUndefined();
  });

  it('🔴 코드·스키마 변경은 기록만 한다 — 배포로만 반영된다', async () => {
    const { svc } = mk();
    await svc.addAttachment('legal.claimStatusAccuracy', 'u1', ATT);
    const r = await svc.decide('legal.claimStatusAccuracy', 'u1', { choice: 'CLEARED_SCHEMA_CHANGE', ...OK });
    expect(r.record.applied).toBe(false);
    expect(r.record.appliedDetail).toContain('배포');
  });

  it('기록에 결정자·시각·근거가 남는다', async () => {
    const { svc } = mk();
    const r = await svc.decide('policy.patientPush.enable', 'u9', { choice: 'OFF', ...OK });
    expect(r.record.decidedByUserId).toBe('u9');
    expect(r.record.legalReviewRef).toContain('CPO-2026-014');
    expect(new Date(r.record.decidedAt).getTime()).toBeGreaterThan(0);
  });
});

/**
 * 🔴 등록부가 실재하지 않는 것을 가리키면, 화면은 "결정하면 바뀐다"고 말하면서 아무것도 바꾸지 못한다.
 * 재주입: `configKey` 를 없는 키로 바꾸면 실패한다.
 */
describe('등록부 ↔ 실물 대조', () => {
  it('🔴 configKey 는 실제 설정 키다(DEFAULTS 에 등록돼 있다)', async () => {
    const { DEFAULTS } = await import('../../src/modules/config/config-runtime.service');
    const missing = DECISION_REGISTRY.filter((d) => d.configKey && !(d.configKey in (DEFAULTS as Record<string, unknown>)))
      .map((d) => `${d.key} → ${d.configKey}`);
    expect(missing, '등록부가 없는 설정 키를 가리킨다').toEqual([]);
  });

  it('🔴 위원회·코드변경 경로는 configKey 를 갖지 않는다 — 적용할 수 없는 것을 적용 가능한 것처럼 보이지 않게', () => {
    const bad = DECISION_REGISTRY.filter((d) => d.approvalPath !== 'AUTHORIZED_ROLE' && d.configKey).map((d) => d.key);
    expect(bad, '위원회/코드변경 항목에 configKey 가 붙어 있다').toEqual([]);
  });

  it('drillDown 은 있으면 절대경로다', () => {
    for (const d of DECISION_REGISTRY) if (d.drillDown) expect(d.drillDown.startsWith('/')).toBe(true);
  });
});

/**
 * 🔴🔴 고정 원칙 — 세 층은 별개이고 **하위가 상위를 대체하지 못한다** (2026-08-20 사람 결정).
 *
 * 재주입: `unmetDependencies` 검사를 지우면(=위원회 의결이 법적 요건을 앞지르면) 실패한다.
 */
describe('층 분리 — 하위가 상위를 대체하지 못한다', () => {
  it('세 층이 모두 등재돼 있고 각 층의 한계가 명시돼 있다', async () => {
    const { LAYER_META } = await import('../../src/modules/decision-registry/decision.registry');
    for (const k of ['LICENSE_HOLDER', 'INTERNAL_COMMITTEE', 'STAFF'] as const) {
      expect(LAYER_META[k].scope).toBeTruthy();
      expect(LAYER_META[k].cannot, `${k} 에 "무엇을 할 수 없는가"가 없다`).toContain('🔴');
    }
    expect(DECISION_REGISTRY.some((d) => d.layer === 'LICENSE_HOLDER')).toBe(true);
    expect(DECISION_REGISTRY.some((d) => d.layer === 'INTERNAL_COMMITTEE')).toBe(true);
    expect(DECISION_REGISTRY.some((d) => d.layer === 'STAFF')).toBe(true);
  });

  it('🔴 선행 조건이 **하위 층**을 가리키지 않는다 — 하위가 상위의 조건이 될 수 없다(같은 층 순서 의존은 정당)', async () => {
    const { LAYER_RANK } = await import('../../src/modules/decision-registry/decision.registry');
    const bad: string[] = [];
    for (const d of DECISION_REGISTRY) {
      for (const dep of d.dependsOn ?? []) {
        const p = DECISION_REGISTRY.find((x) => x.key === dep);
        if (!p) { bad.push(`${d.key} → ${dep}(없음)`); continue; }
        if (LAYER_RANK[p.layer] < LAYER_RANK[d.layer]) bad.push(`${d.key}(${d.layer}) → ${dep}(${p.layer})`);
      }
    }
    expect(bad, '하위 층을 선행 조건으로 삼았다').toEqual([]);
  });

  it('🔴 법적 요건이 미결이면 원내 의결은 기록돼도 적용되지 않는다', async () => {
    const { svc, store } = mk();
    const r = await svc.decide('policy.patientPush.enable', 'u1', { choice: 'ON', ...OK });
    expect(r.record.applied).toBe(false);
    expect(r.record.appliedDetail).toContain('선행 조건');
    expect(store.get('notification.patientPush.enabled')).toBeUndefined();
  });

  it('🔴 법적 요건이 **부정 결정**이어도 적용되지 않는다 — 부정도 결정이다', async () => {
    const { svc } = mk();
    await svc.addAttachment('legal.patientPush.consentScope', 'u1', ATT);
    await svc.decide('legal.patientPush.consentScope', 'u1', { choice: 'NOT_REVIEWED', ...OK });
    const r = await svc.decide('policy.patientPush.enable', 'u1', { choice: 'ON', ...OK });
    expect(r.record.applied).toBe(false);
  });

  it('🔴 직원 건별 판단은 이 화면에서 결정하지 않는다', async () => {
    const { svc } = mk();
    await expect(svc.decide('staff.patientPush.perEvent', 'u1', { choice: 'IN_WORKFLOW', ...OK }))
      .rejects.toThrow(/업무 화면/);
  });

  it('막힌 항목은 무엇이 막고 있는지 목록에 드러난다', async () => {
    const { svc } = mk();
    const { items } = await svc.list();
    const policy = items.find((i) => i.key === 'policy.patientPush.enable')!;
    expect(policy.blockedBy.length).toBeGreaterThan(0);
    expect(policy.blockedBy[0].key).toBe('legal.patientPush.consentScope');
  });
});

/**
 * 🔴 허가 결정은 **근거 문서 없이 기록되지 않는다** (2026-08-20 사람 지시).
 *
 * 법적 요건의 근거가 말로만 남으면 나중에 "무엇을 보고 판단했는가"에 답할 수 없다.
 * 🔴 다만 시스템은 문서의 **진위·유효성을 검증하지 못한다** — 무엇이 언제 누구에 의해
 * 올라왔는지만 남는다. 그 한계를 화면과 계약이 함께 말해야 한다.
 *
 * 재주입: `LICENSE_HOLDER` 첨부 필수 검사를 지우면 실패한다.
 */
describe('허가 근거 문서 — 첨부 없이는 기록되지 않는다', () => {
  const FILE = { filename: 'f1.pdf', originalName: '검토회신.pdf', mimetype: 'application/pdf', size: 1234 };

  it('🔴 허가권자 층은 첨부가 없으면 거부', async () => {
    const { svc } = mk();
    await expect(svc.decide('legal.patientPush.consentScope', 'u1', { choice: 'CLEARED', ...OK }))
      .rejects.toThrow(/근거 문서/);
  });

  it('첨부가 있으면 기록되고, 기록에 함께 봉인된다', async () => {
    const { svc } = mk();
    await svc.addAttachment('legal.patientPush.consentScope', 'u1', FILE);
    const r = await svc.decide('legal.patientPush.consentScope', 'u1', { choice: 'CLEARED', ...OK });
    expect(r.record.attachments).toHaveLength(1);
    expect(r.record.attachments![0].fileName).toBe('검토회신.pdf');
    // 🔴 서명 게이트가 걸린 경로여야 한다(정적 서빙은 서명 없이는 401)
    expect(r.record.attachments![0].url).toContain('/uploads/decisions/');
  });

  it('🔴 봉인 후 대기 목록은 비워진다 — 같은 문서가 다음 결정에 재사용되지 않게', async () => {
    const { svc } = mk();
    await svc.addAttachment('legal.patientPush.consentScope', 'u1', FILE);
    await svc.addAttachment('legal.patientPush.consentScope', 'u1', ATT);
    await svc.decide('legal.patientPush.consentScope', 'u1', { choice: 'CLEARED', ...OK });
    expect(await svc.pendingAttachments('legal.patientPush.consentScope')).toHaveLength(0);
  });

  it('위원회·직원 층은 첨부를 강제하지 않는다 — 법적 근거를 요구하는 층이 아니다', async () => {
    const { svc } = mk();
    const r = await svc.decide('policy.alertRouting', 'u1', { choice: 'DRAFT', ...OK });
    expect(r.record.choice).toBe('DRAFT');
  });

  it('등록되지 않은 결정에는 첨부할 수 없다', async () => {
    const { svc } = mk();
    await expect(svc.addAttachment('no.such.key', 'u1', FILE)).rejects.toThrow();
  });

  it('첨부에 올린 사람·시각이 남는다', async () => {
    const { svc } = mk();
    const a = await svc.addAttachment('legal.sms.entrustment', 'u7', FILE);
    expect(a.uploadedByUserId).toBe('u7');
    expect(new Date(a.uploadedAt).getTime()).toBeGreaterThan(0);
  });
});
