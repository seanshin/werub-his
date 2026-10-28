/**
 * 의료진 관점 여정(2026-10-01) — 오더·처방·위급값 단계 이력과 질관리 점검.
 *  · 단계 시각은 도메인 원장 그대로 · 없으면 null(추정 없음) · 소요 시간은 양 끝이 있을 때만
 *  · 결과 확인은 결과 확인함과 같은 조건(검사·영상·COMPLETED·확인 없음·취소 아님)
 *  · 요약은 수·분모·중앙값+표본 수 — 임계 판정 없음
 *  · 검체 채취 = 접수 순간이면 그 사실을 표시
 */
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { UserRole } from '@prisma/client';
import { buildClinicalLens, medianOf, orderStages, type LensOrderInput, type LensPrescriptionInput } from '../../src/modules/journey/clinical-lens';
import { JourneyController } from '../../src/modules/journey/journey.controller';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { PHI_READ_PATTERNS } from '../../src/modules/audit/audit-routes';

const t = (iso: string) => new Date(iso);
const NOW = t('2026-10-01T12:00:00Z');

const lab = (over: Partial<LensOrderInput> = {}): LensOrderInput => ({
  id: 'o1', department: 'LAB', status: 'COMPLETED', priority: 'ROUTINE',
  createdAt: t('2026-10-01T00:00:00Z'), receivedAt: t('2026-10-01T00:30:00Z'), startedAt: null,
  completedAt: t('2026-10-01T02:00:00Z'), cancelledAt: null, acknowledgedAt: null,
  prescription: { type: 'LAB', procedureCode: { nameKo: 'CBC' } },
  labResult: { status: 'COMPLETED', collectedAt: t('2026-10-01T00:30:00Z'), completedAt: t('2026-10-01T02:00:00Z'), verifiedAt: null, items: [{ flag: 'H' }, { flag: null }] },
  ...over,
});

const rx = (over: Partial<LensPrescriptionInput> = {}): LensPrescriptionInput => ({
  id: 'p1', type: 'MEDICATION', status: 'ACTIVE', priority: 'ROUTINE', createdAt: t('2026-09-30T00:00:00Z'), duration: 7,
  dosage: '10mg', frequency: '1일 1회', orderSource: 'WRITTEN', readBackConfirmedAt: null, prescriberCosignedAt: null,
  durChecked: true, durOverridden: false, durWarnings: [], discontinuedAt: null, discontinueReason: null, renewedFromId: null,
  medicationCode: { nameKo: '아토르바스타틴' },
  medAdmins: [
    { status: 'ADMINISTERED', scheduledAt: t('2026-09-30T09:00:00Z'), administeredAt: t('2026-09-30T09:20:00Z') },
    { status: 'ADMINISTERED', scheduledAt: t('2026-10-01T09:00:00Z'), administeredAt: t('2026-10-01T09:40:00Z') },
    { status: 'SCHEDULED', scheduledAt: t('2026-10-01T11:00:00Z'), administeredAt: null },
    { status: 'SCHEDULED', scheduledAt: t('2026-10-02T09:00:00Z'), administeredAt: null },
  ],
  ...over,
});

const build = (orders: LensOrderInput[], prescriptions: LensPrescriptionInput[] = [], criticals = [] as Parameters<typeof buildClinicalLens>[0]['criticals']) =>
  buildClinicalLens({ orders, prescriptions, criticals, period: { from: t('2026-09-01T00:00:00Z'), to: NOW }, truncated: { orders: false, prescriptions: false, criticals: false }, now: NOW });

describe('오더 단계', () => {
  it('검사: 발행→접수→채취→결과→검증→의사 확인 · 없는 단계는 null', () => {
    const st = orderStages(lab());
    expect(st.map((s) => s.key)).toEqual(['ORDERED', 'RECEIVED', 'COLLECTED', 'RESULTED', 'VERIFIED', 'ACKNOWLEDGED']);
    expect(st.find((s) => s.key === 'VERIFIED')!.at).toBeNull();
    expect(st.find((s) => s.key === 'ACKNOWLEDGED')!.at).toBeNull();
  });
  it('영상·약제·치료는 각자 단계 · 취소는 끝에 붙는다', () => {
    expect(orderStages(lab({ department: 'IMAGING', imagingResult: { status: 'REPORTED', acquiredAt: null, reportedAt: t('2026-10-01T03:00:00Z') } })).map((s) => s.key))
      .toEqual(['ORDERED', 'RECEIVED', 'ACQUIRED', 'REPORTED', 'ACKNOWLEDGED']);
    expect(orderStages(lab({ department: 'PHARMACY' })).map((s) => s.key)).toEqual(['ORDERED', 'RECEIVED', 'DISPENSED', 'VERIFIED', 'ISSUED']);
    const c = orderStages(lab({ department: 'THERAPY', status: 'CANCELLED', cancelledAt: t('2026-10-01T01:00:00Z') }));
    expect(c[c.length - 1]).toEqual({ key: 'CANCELLED', at: '2026-10-01T01:00:00.000Z' });
  });
  it('🔴 소요 시간·미확인·이상·채취=접수 표시 · 취소 건은 소요 시간을 재지 않는다', () => {
    const r = build([lab(), lab({ id: 'o2', acknowledgedAt: t('2026-10-01T03:00:00Z') }), lab({ id: 'o3', status: 'CANCELLED', cancelledAt: t('2026-10-01T00:10:00Z') })]);
    const [a, b, c] = r.orders;
    expect(a).toMatchObject({ orderToResultMin: 120, resultToAckMin: null, unacknowledged: true, abnormal: true, critical: false, collectedSameAsReceived: true, name: 'CBC' });
    expect(b).toMatchObject({ resultToAckMin: 60, unacknowledged: false });
    expect(c).toMatchObject({ orderToResultMin: null, unacknowledged: false });
    expect(r.quality.resultAck).toEqual({ numerator: 1, denominator: 2 });
    expect(r.quality.resultToAckMin).toEqual({ value: 60, n: 1 });
    expect(r.quality.orderToResultMin.LAB).toEqual({ value: 120, n: 2 });
    expect(r.quality.orderToResultMin.IMAGING).toEqual({ value: null, n: 0 }); // 표본 0 — 0 이 아니다
  });
  it('접수 대기 — 수와 가장 오래 기다린 시간(임계 판정 없음)', () => {
    const r = build([lab({ status: 'ORDERED', receivedAt: null, completedAt: null, labResult: null, createdAt: t('2026-10-01T10:00:00Z') })]);
    expect(r.quality.awaitingReceipt).toEqual({ n: 1, oldestMin: 120 });
  });
});

describe('처방·투약', () => {
  it('🔴 투약 — 예정이 지났는데 기록 없음·지연 중앙값 · 미래 예정은 세지 않는다', () => {
    const r = build([], [rx()]);
    const p = r.prescriptions[0];
    expect(p.mar).toMatchObject({ total: 4, administered: 2, pastDueUnrecorded: 1 });
    expect(p.mar.delayMedianMin).toEqual({ value: 30, n: 2 });
    expect(r.quality.mar).toMatchObject({ scheduledPast: 3, recorded: 2, pastDueUnrecorded: 1 });
    expect(p.dosing.state).toBe('DOSING');
  });
  it('구두 처방 — 사후 확인 없음을 센다 · 대조군 서면 처방은 대상 아님 · DUR 무시', () => {
    const r = build([], [
      rx({ id: 'v', orderSource: 'VERBAL', readBackConfirmedAt: t('2026-09-30T00:01:00Z') }),
      rx({ id: 'w' }),
      rx({ id: 'd', durOverridden: true, durWarnings: [{}, {}] }),
    ]);
    expect(r.quality.verbal).toEqual({ total: 1, uncosigned: 1 });
    expect(r.prescriptions[0].verbal).toEqual({ readBackAt: '2026-09-30T00:01:00.000Z', cosignedAt: null });
    expect(r.prescriptions[1].verbal).toBeNull();
    expect(r.quality.dur).toEqual({ medications: 3, checked: 3, overridden: 1 });
    expect(r.prescriptions[2].dur.warnings).toBe(2);
  });
  it('중단·갱신을 센다', () => {
    const r = build([], [rx({ status: 'DISCONTINUED', discontinuedAt: t('2026-09-30T12:00:00Z'), discontinueReason: '부작용' }), rx({ id: 'n', renewedFromId: 'p1' })]);
    expect(r.quality).toMatchObject({ discontinued: 1, renewed: 1 });
    expect(r.prescriptions[0].dosing.state).toBe('ENDED');
  });
});

describe('위급값', () => {
  it('확인까지 걸린 시간 · 미확인 수', () => {
    const base = { testName: 'K', value: '6.8', unit: 'mmol/L', escalatedAt: null, actedAt: null, closedAt: null };
    const r = build([], [], [
      { ...base, id: 'c1', status: 'ACKNOWLEDGED', notifiedAt: t('2026-10-01T00:00:00Z'), acknowledgedAt: t('2026-10-01T00:15:00Z') },
      { ...base, id: 'c2', status: 'PENDING', notifiedAt: t('2026-10-01T01:00:00Z'), acknowledgedAt: null },
    ]);
    expect(r.quality.critical).toEqual({ total: 2, unacknowledged: 1, toAckMin: { value: 15, n: 1 } });
  });
});

describe('공통', () => {
  it('중앙값 — 표본 0 이면 null · 짝수 평균', () => {
    expect(medianOf([])).toEqual({ value: null, n: 0 });
    expect(medianOf([10, null, 30])).toEqual({ value: 20, n: 2 });
  });
  it('EP — 임상 역할 · 환자 지목 열람 감사 대상', () => {
    expect(Reflect.getMetadata(ROLES_KEY, JourneyController.prototype.getClinicalLens)).toEqual([UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.ADMIN]);
    expect(PHI_READ_PATTERNS.some((re) => re.test('/api/v1/journey/11111111-1111-4111-8111-111111111111/clinical-lens'))).toBe(true);
  });
});
