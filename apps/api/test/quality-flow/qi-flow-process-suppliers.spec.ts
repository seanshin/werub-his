import { describe, it, expect, vi } from 'vitest';
import { QI_SUPPLIERS, QI_SUPPLIER_DEFINITION, QI_SUPPLY_UNAVAILABLE_TEXT, qiChartKindFor, qiSupplierByName } from '@hospital-run/shared';
import { IndicatorSupplierService } from '../../src/modules/quality/indicator-supplier.service';
import { normalizeIndicatorKey } from '../../src/modules/quality/indicator-policy';

/**
 * 질관리 — 과정 지표 공급원·재원 사고 분자(2026-10-10).
 * 🔴 재원일수·입원 분모의 사고율이 외래·응급 사고까지 분자로 세었다(운영 낙상·욕창·투약 34건 중 재원 중 0건 · 병동 기록 0건).
 */
const SEP = { from: new Date(2026, 8, 1), to: new Date(2026, 9, 1) };
const cfg = (v: Record<string, unknown>) => ({ get: vi.fn(async (k: string) => v[k] ?? null) });
const H = 3_600_000;

describe('재원 중 사고만 분자 — 사고율(낙상·투약·욕창)', () => {
  const prisma = (rows: Array<{ patientId: string | null; wardId: string | null; occurredAt: Date }>, stays: Array<{ patientId: string; admitDate: Date; dischargeDate: Date | null }>) => ({
    safetyIncident: { findMany: vi.fn(async () => rows) },
    admission: { findMany: vi.fn(async () => stays), count: vi.fn(async () => 10) },
  });
  it('🔴 병동 사고·재원 중 사고만 세고 · 재원 밖·식별 없는 사고는 수만 남긴다', async () => {
    const at = new Date(2026, 8, 10);
    const p = prisma([
      { patientId: 'p1', wardId: 'w1', occurredAt: at }, // 병동 사고
      { patientId: 'p2', wardId: null, occurredAt: at }, // 재원 중
      { patientId: 'p3', wardId: null, occurredAt: at }, // 외래(재원 없음)
      { patientId: null, wardId: null, occurredAt: at }, // 어디서 났는지 모름
    ], [{ patientId: 'p2', admitDate: new Date(2026, 8, 1), dischargeDate: null }]);
    const s = new IndicatorSupplierService(p as never, cfg({ 'qi.autoMeasure.incidentDenominator': 'ADMISSIONS' }) as never);
    const r = await s.supply('FALL_RATE', SEP);
    expect(r).toMatchObject({ available: true, numerator: 2, denominator: 10, evidence: { excluded: { outsideStay: 1, unattributed: 1 } } });
  });
  it('대조군 — 결정 전에도 분자(재원 중)는 대조 근거로', async () => {
    const p = prisma([{ patientId: 'p3', wardId: null, occurredAt: new Date(2026, 8, 3) }], []);
    expect(await new IndicatorSupplierService(p as never, cfg({}) as never).supply('FALL_RATE', SEP)).toMatchObject({ available: false, reason: 'DENOMINATOR_UNSET', numerator: 0 });
  });
});

describe('과정 지표 공급원', () => {
  it('근무조 활력 — 온전히 재원이었던 근무조만 분모 · 두 원장 어느 쪽이든 1회면 기록', async () => {
    // 9/10 07:00 KST(=9/9 22:00Z) 입원 · 9/11 07:00 KST 퇴원 → 주·초·야·주·초·야 = 6 근무조
    const admitDate = new Date('2026-09-09T22:00:00Z');
    const dischargeDate = new Date('2026-09-10T22:00:00Z');
    const p = {
      admission: { findMany: vi.fn(async () => [{ id: 'a1', patientId: 'p1', admitDate, dischargeDate }]) },
      flowSheetEntry: { findMany: vi.fn(async () => [{ admissionId: 'a1', recordedAt: new Date('2026-09-10T01:00:00Z') }]) }, // 주간
      preVisitVitals: { findMany: vi.fn(async () => [{ patientId: 'p1', measuredAt: new Date('2026-09-10T08:00:00Z') }]) }, // 초번(17:00 KST)
    };
    const r = await new IndicatorSupplierService(p as never, cfg({}) as never).supply('SHIFT_VITALS_COMPLETE', SEP);
    expect(r).toMatchObject({ available: true, numerator: 2, denominator: 3 });
  });

  it('협진 48시간 — 회신 없이 종결 제외 · 기한 안 온 미회신 제외 · 경계 포함', async () => {
    const now = new Date();
    const c = (createdAt: Date, repliedAt: Date | null, status: string) => ({ createdAt, repliedAt, status });
    const t0 = new Date(2026, 8, 5);
    const p = { consultation: { findMany: vi.fn(async () => [
      c(t0, new Date(t0.getTime() + 48 * H), 'REPLIED'), // 경계 — 포함
      c(t0, new Date(t0.getTime() + 49 * H), 'REPLIED'), // 늦음
      c(t0, null, 'CLOSED'), // 취소
      c(t0, null, 'REQUESTED'), // 미회신(기한 지남)
      c(new Date(now.getTime() - 2 * H), null, 'REQUESTED'), // 기한 미도래
    ]) } };
    expect(await new IndicatorSupplierService(p as never).supply('CONSULT_REPLY_48H', SEP))
      .toMatchObject({ available: true, numerator: 1, denominator: 3, evidence: { excluded: { closedWithoutReply: 1, pending: 1 } } });
  });

  it('진료기록 7일 서명 · 방사선 기록자 · 표본 0 은 산출 불가', async () => {
    const t0 = new Date(2026, 8, 2);
    const enc = { encounter: { findMany: vi.fn(async () => [{ createdAt: t0, signedAt: new Date(t0.getTime() + 2 * 86_400_000) }, { createdAt: t0, signedAt: null }]) } };
    expect(await new IndicatorSupplierService(enc as never).supply('ENCOUNTER_SIGN_7D', SEP)).toMatchObject({ available: true, numerator: 1, denominator: 2 });
    const rad = { radiationFraction: { count: vi.fn(async (a: { where: Record<string, unknown> }) => ('therapistId' in a.where ? 2 : 5)) } };
    expect(await new IndicatorSupplierService(rad as never).supply('RADIATION_RECORDER', SEP)).toMatchObject({ available: true, numerator: 2, denominator: 5 });
    const empty = { radiationFraction: { count: vi.fn(async () => 0) } };
    expect(await new IndicatorSupplierService(empty as never).supply('RADIATION_RECORDER', SEP)).toMatchObject({ available: false, reason: 'NO_SAMPLE' });
  });

  it('🔴 서류 처리 기한 — 원내 규정 미설정이면 산출 불가(코드 고정 3일을 규정으로 쓰지 않는다) · 설정되면 반려·미도래 제외', async () => {
    const t0 = new Date(2026, 8, 3);
    const rows = [
      { createdAt: t0, completedAt: new Date(t0.getTime() + 10 * H), status: 'READY' },
      { createdAt: t0, completedAt: new Date(t0.getTime() + 80 * H), status: 'DELIVERED' },
      { createdAt: t0, completedAt: null, status: 'REJECTED' },
    ];
    const p = { documentRequest: { findMany: vi.fn(async () => rows) } };
    expect(await new IndicatorSupplierService(p as never, cfg({}) as never).supply('DOC_ISSUE_SLA', SEP)).toMatchObject({ available: false, reason: 'SLA_POLICY_UNSET' });
    expect(await new IndicatorSupplierService(p as never, cfg({ 'qi.docIssuance.slaHours': 72 }) as never).supply('DOC_ISSUE_SLA', SEP))
      .toMatchObject({ available: true, numerator: 1, denominator: 2, evidence: { slaHours: 72, excluded: { rejected: 1 } } });
  });

  it('🔴 무선 측위 — 수집이 꺼져 있으면 산출 불가(시뮬레이션으로 채우지 않는다) · 켜지면 관측만', async () => {
    const count = vi.fn(async (a: { where: Record<string, unknown> }) => ('granularity' in a.where ? 3 : 4));
    const p = { wifiPositionFix: { count } };
    expect(await new IndicatorSupplierService(p as never, cfg({}) as never).supply('WIFI_ZONE_RESOLVED', SEP)).toMatchObject({ available: false, reason: 'WIFI_COLLECTION_OFF' });
    expect(count).not.toHaveBeenCalled();
    const r = await new IndicatorSupplierService(p as never, cfg({ 'location.wifi.enabled': true }) as never).supply('WIFI_ZONE_RESOLVED', SEP);
    expect(r).toMatchObject({ available: true, numerator: 3, denominator: 4 });
    expect((count.mock.calls[0] as unknown as [{ where: { source: string } }])[0].where.source).toBe('OBSERVED_WIFI');
  });
});

describe('정본 일관성', () => {
  it('모든 공급원에 정의(이름·모집단·분자·제외)가 있고 · 이름 정규형이 공급원 이름과 같다(이름으로도 묶인다)', () => {
    for (const k of Object.keys(QI_SUPPLIERS) as Array<keyof typeof QI_SUPPLIERS>) {
      const d = QI_SUPPLIER_DEFINITION[k];
      expect(d, k).toBeTruthy();
      expect(d.population && d.numerator && d.exclusions, k).toBeTruthy();
      expect(qiSupplierByName(normalizeIndicatorKey(d.name)), k).toBe(k);
    }
  });
  it('비율 공급원은 p 관리도 · 노출당 발생은 u', () => {
    for (const k of ['SHIFT_VITALS_COMPLETE', 'CONSULT_REPLY_48H', 'ENCOUNTER_SIGN_7D', 'RADIATION_RECORDER', 'DOC_ISSUE_SLA', 'WIFI_ZONE_RESOLVED', 'NURSING_INITIAL_24H', 'HAND_HYGIENE'] as const) expect(qiChartKindFor(k, [], 100), k).toBe('P');
    for (const k of ['FALL_RATE', 'CLABSI_RATE'] as const) expect(qiChartKindFor(k, [], 1000), k).toBe('U');
  });
  it('산출 불가 이유마다 화면 문장이 있다', () => {
    for (const r of ['SLA_POLICY_UNSET', 'WIFI_COLLECTION_OFF', 'NO_SAMPLE', 'DENOMINATOR_UNSET']) expect(QI_SUPPLY_UNAVAILABLE_TEXT[r], r).toBeTruthy();
  });
});
