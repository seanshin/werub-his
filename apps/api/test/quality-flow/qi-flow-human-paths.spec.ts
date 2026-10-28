/**
 * 사람이 하는 일의 경로(2026-10-09) — 사람 몫을 대신하지 않고, 사람이 끝까지 할 수 있게.
 *  ① 설정 값 규칙 — 기능이 모르는 값은 범용 설정 저장·집행 엔진 둘 다 거른다(같은 규칙)
 *  ② 결정 현황 출처 — 위원회 의결 집행(ENACTED)과 관리자 직접 변경(DIRECT)을 가른다
 *  ③ 경보 승인 원장 — 근거 필수·그때 값 snapshot·코드가 바뀌면 재승인 필요·철회는 사유와 함께
 */
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { qiFlowSettingInvalidReason, QI_FLOW_SETTING_ALLOWED } from '@hospital-run/shared';
import { ConfigRuntimeController } from '../../src/modules/config/config-runtime.controller';
import { GovernanceEnactmentService } from '../../src/modules/gld/governance-enactment.service';
import { DEFAULTS } from '../../src/modules/config/config-runtime.service';
import { QiFlowSettingsService } from '../../src/modules/quality-flow/qi-flow-settings.service';
import { NotificationService } from '../../src/modules/notification/notification.service';
import { ALERT_REGISTRY } from '../../src/modules/notification/alert-registry';
import { alertApprovalStatus, alertSnapshot } from '../../src/modules/notification/alert-approval';

describe('① 설정 값 규칙', () => {
  it('🔴 기능이 모르는 값·형식이 틀린 날짜·미래 날짜는 거른다 · null(미설정)은 허용', () => {
    const today = new Date(2026, 9, 9);
    expect(qiFlowSettingInvalidReason('qi.autoManual.precedence', 'auto')).toBeTruthy();
    expect(qiFlowSettingInvalidReason('qi.autoManual.precedence', 'AUTO')).toBeNull();
    expect(qiFlowSettingInvalidReason('qi.deviceLedger.coverageFrom', '2026/10/01', today)).toBeTruthy();
    expect(qiFlowSettingInvalidReason('qi.deviceLedger.coverageFrom', '2026-02-30', today)).toBeTruthy();
    expect(qiFlowSettingInvalidReason('qi.deviceLedger.coverageFrom', '2026-10-10', today)).toBeTruthy();
    expect(qiFlowSettingInvalidReason('qi.deviceLedger.coverageFrom', '2026-10-01', today)).toBeNull();
    expect(qiFlowSettingInvalidReason('qi.autoMeasure.enabled', 'true')).toBeTruthy(); // 문자열은 불리언이 아니다
    expect(qiFlowSettingInvalidReason('safety.harmLevelScale', null)).toBeNull();
    expect(qiFlowSettingInvalidReason('ui.theme', 'anything')).toBeUndefined(); // 규칙 밖 키는 판정하지 않는다
  });
  it('🔴 규칙의 키는 전부 설정 카탈로그에 있다', () => {
    for (const k of Object.keys(QI_FLOW_SETTING_ALLOWED)) expect(k in DEFAULTS, k).toBe(true);
  });
  it('🔴 범용 설정 저장(관리자)이 거른다 — 대조군: 맞는 값은 저장', async () => {
    const set = vi.fn(async () => ({}));
    const c = new ConfigRuntimeController(Object.assign({ get: async () => null }, { set } as never) as never, { emitAsync: async () => [] } as never);
    await expect(c.set('qi.autoManual.precedence', { value: 'auto' } as never, 'u1')).rejects.toThrow(BadRequestException);
    expect(set).not.toHaveBeenCalled();
    await c.set('qi.autoManual.precedence', { value: 'AUTO' } as never, 'u1');
    expect(set).toHaveBeenCalledWith('qi.autoManual.precedence', 'AUTO', 'u1');
  });
  it('🔴 집행 엔진도 같은 규칙으로 의결 시점에 거른다', () => {
    const engine = new GovernanceEnactmentService({} as never, { hasDefault: (k: string) => k in DEFAULTS } as never);
    expect(() => engine.validateAction('CONFIG_CHANGE', { key: 'safety.harmLevelScale', newValue: 'WHO' })).toThrow(BadRequestException);
    expect(() => engine.validateAction('CONFIG_CHANGE', { key: 'safety.harmLevelScale', newValue: 'KOPS' })).not.toThrow();
  });
});

describe('② 결정 현황 출처', () => {
  const mk = (updatedAt: Date, action: unknown) => new QiFlowSettingsService(
    { getWithSource: vi.fn(async (k: string) => (k === 'qi.autoManual.precedence' ? { value: 'AUTO', source: 'db', registered: true } : { value: null, source: 'default', registered: true })) } as never,
    { systemConfig: { findUnique: vi.fn(async () => ({ updatedAt })) }, decisionAction: { findFirst: vi.fn(async () => action) } } as never,
  );
  const row = async (svc: QiFlowSettingsService) => (await svc.read()).rows.find((r) => r.key === 'qi.autoManual.precedence')!;
  it('🔴 의결 집행 뒤 그대로면 ENACTED(의결 번호)', async () => {
    const t = new Date('2026-10-09T01:00:00Z');
    const r = await row(mk(t, { enactedAt: new Date(t.getTime() + 500), target: { key: 'qi.autoManual.precedence', newValue: 'AUTO' }, registryKey: null, decision: { decisionNo: 'QPS-2026-07' } }));
    expect(r.provenance).toMatchObject({ by: 'ENACTED', decisionNo: 'QPS-2026-07' });
  });
  it('🔴 집행 뒤 관리자가 바꿨거나 집행 기록이 없으면 DIRECT(위원회 의결 아님)', async () => {
    const t = new Date('2026-10-09T05:00:00Z');
    expect((await row(mk(t, { enactedAt: new Date('2026-10-09T01:00:00Z'), target: { newValue: 'AUTO' }, registryKey: null, decision: null }))).provenance?.by).toBe('DIRECT');
    expect((await row(mk(t, null))).provenance?.by).toBe('DIRECT');
    // 같은 시각이라도 값이 다르면 의결 반영이 아니다
    expect((await row(mk(t, { enactedAt: t, target: { newValue: 'MANUAL' }, registryKey: null, decision: null }))).provenance?.by).toBe('DIRECT');
  });
  it('기본값으로 떨어진 키에는 출처를 붙이지 않는다', async () => {
    const r = (await mk(new Date(), null).read()).rows.find((x) => x.key === 'safety.harmLevelScale')!;
    expect(r.provenance).toBeUndefined();
  });
});

describe('③ 경보 승인 원장', () => {
  const def = ALERT_REGISTRY.find((d) => d.code === 'QI_TARGET_MISSED')!;
  it('🔴 승인 당시 값과 지금 코드가 다르면 CHANGED(재승인 필요) · 철회면 미승인', () => {
    expect(alertApprovalStatus(def, null)).toBe('UNAPPROVED');
    expect(alertApprovalStatus(def, { snapshot: alertSnapshot(def), revokedAt: null })).toBe('APPROVED');
    expect(alertApprovalStatus(def, { snapshot: { ...alertSnapshot(def), tier: 1 }, revokedAt: null })).toBe('CHANGED');
    expect(alertApprovalStatus(def, { snapshot: alertSnapshot(def), revokedAt: new Date() })).toBe('UNAPPROVED');
    // 키 순서는 무관
    const s = alertSnapshot(def);
    expect(alertApprovalStatus(def, { snapshot: Object.fromEntries(Object.entries(s).reverse()), revokedAt: null })).toBe('APPROVED');
  });
  const mk = (latest: unknown) => {
    const prisma = { alertApproval: { findFirst: vi.fn(async () => latest), create: vi.fn(async (a: { data: unknown }) => a.data), updateMany: vi.fn(async () => ({ count: 1 })) } };
    return { svc: new NotificationService(prisma as never), prisma };
  };
  it('🔴 근거 5자 미만 거부 · 등록부 밖 코드 거부 · 이미 지금 값으로 승인됐으면 409', async () => {
    await expect(mk(null).svc.approveAlert('QI_TARGET_MISSED', '짧음', 'u1')).rejects.toThrow(BadRequestException);
    await expect(mk(null).svc.approveAlert('NO_SUCH', '위원회 의결 QPS-1', 'u1')).rejects.toMatchObject({ response: { code: 'ALERT_NOT_REGISTERED' } });
    await expect(mk({ snapshot: alertSnapshot(def), revokedAt: null }).svc.approveAlert('QI_TARGET_MISSED', '위원회 의결 QPS-1', 'u1')).rejects.toThrow(ConflictException);
  });
  it('승인은 지금 값을 snapshot 으로 남긴다 · 바뀐 뒤엔 다시 승인할 수 있다', async () => {
    const { svc, prisma } = mk({ snapshot: { ...alertSnapshot(def), dedupHours: 1 }, revokedAt: null });
    await svc.approveAlert('QI_TARGET_MISSED', '위원회 의결 QPS-2', 'u1');
    expect((prisma.alertApproval.create.mock.calls as unknown as Array<[{ data: { snapshot: unknown } }]>)[0][0].data.snapshot).toEqual(alertSnapshot(def));
  });
  it('🔴 철회는 사유 필수 · 조건부(동시 두 번이면 409)', async () => {
    await expect(mk({ id: 'a', revokedAt: null }).svc.revokeAlertApproval('QI_TARGET_MISSED', '짧음', 'u1')).rejects.toThrow(BadRequestException);
    const { svc, prisma } = mk({ id: 'a', revokedAt: null });
    prisma.alertApproval.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(svc.revokeAlertApproval('QI_TARGET_MISSED', '라우팅 재검토 결정', 'u1')).rejects.toThrow(ConflictException);
    expect((prisma.alertApproval.updateMany.mock.calls as unknown as Array<[{ where: unknown }]>)[0][0].where).toEqual({ id: 'a', revokedAt: null });
  });
});
