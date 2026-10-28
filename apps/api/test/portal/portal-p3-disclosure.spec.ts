/**
 * 환자 포털 공개 범위 P3(2026-10-20 · 결정 등록부 배치 10-J · 사용자 지시).
 *  · B8 `portal.labResultRelease` = 수치는 바로 · 판정은 의료진 확인 뒤 — 결과 목록·건강 요약·추이·입원 상세가 같은 규칙
 *    🔴 종전: 끝난 검사의 판정(H·L·HH)이 바로 보였고, 위급값 수치 가림은 결과 목록에만 있었다(건강 요약·추이·입원 상세는 그대로 노출)
 *  · B2 `portal.visitSummaryScope` = 일반 수준 — 🔴 종전: 진료 이력·입원 상세가 의사 소견 원문(작성 중 기록 포함)·회진 기록을 실었다
 *  · B6 `portal.costEstimate` = 예측 자료로 — 🔴 단가 0원을 "0원"이라 말하지 않는다
 *  · 대조군: 확인된 결과는 판정 그대로 · 승인된 판독은 결론 그대로 · 단가가 있으면 금액
 */
import { describe, it, expect, vi } from 'vitest';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PortalService } from '../../src/modules/portal/portal.service';
import { BillingService } from '../../src/modules/billing/billing.service';
import { guardianDenies, BTG_GUARDIAN_SCOPE, DEFAULT_GUARDIAN_SCOPE } from '../../src/modules/portal/guardian-scope';

const ACK = new Date('2026-10-19T02:00:00Z');
const lab = (id: string, acknowledgedAt: Date | null, items: any[]) => ({ id, completedAt: new Date('2026-10-18T00:00:00Z'), notes: 'CBC', order: { acknowledgedAt }, items });
const K_HH = { testName: 'K', value: '6.9', unit: 'mmol/L', normalMin: 3.5, normalMax: 5.1, flag: 'HH' };
const NA_H = { testName: 'Na', value: '149', unit: 'mmol/L', normalMin: 135, normalMax: 145, flag: 'H' };

function portal(prisma: any, moduleRef?: any): any {
  const svc = Object.create(PortalService.prototype) as any;
  svc.prisma = { criticalValueAlert: { findMany: vi.fn().mockResolvedValue([]) }, checkupVisit: { findMany: vi.fn().mockResolvedValue([]) }, ...prisma };
  svc.moduleRef = moduleRef;
  return svc;
}

describe('🔴 B8 검사 결과 — 수치는 바로, 판정은 의료진 확인 뒤', () => {
  it('확인 전 결과: 수치는 그대로 · 판정은 비움 · AWAITING_REVIEW · 대조군 확인된 결과는 판정 그대로', async () => {
    const svc = portal({ labResult: { findMany: vi.fn().mockResolvedValue([lab('a', null, [NA_H]), lab('b', ACK, [NA_H])]) } });
    const [a, b] = await svc.getLabResults('p1');
    expect(a).toMatchObject({ release: 'AWAITING_REVIEW', reviewedAt: null });
    expect(a.items[0]).toMatchObject({ name: 'Na', value: '149', unit: 'mmol/L', flag: '', judgmentPending: true });
    expect(b).toMatchObject({ release: 'REVIEWED', reviewedAt: ACK });
    expect(b.items[0]).toMatchObject({ value: '149', flag: 'H' });
    expect(b.items[0].judgmentPending).toBeUndefined();
  });

  it('위급값 폐루프는 그대로 — 경보가 열려 있으면 확인된 결과라도 수치를 가린다', async () => {
    const svc = portal({
      labResult: { findMany: vi.fn().mockResolvedValue([lab('a', ACK, [K_HH])]) },
      criticalValueAlert: { findMany: vi.fn().mockResolvedValue([{ labResultId: 'a', testName: 'K' }]) },
    });
    const [a] = await svc.getLabResults('p1');
    expect(a.items[0]).toMatchObject({ value: '담당의 확인 중', unit: '', pendingReview: true });
  });

  it('🔴 건강 요약(health-dashboard)·추이(lab-trends)도 같은 규칙 — 종전엔 위급값 수치·확인 전 판정이 그대로 나갔다', async () => {
    const alerts = vi.fn().mockResolvedValue([{ labResultId: 'a', testName: 'K' }]);
    const trends = portal({
      labResultItem: { findMany: vi.fn().mockResolvedValue([
        { ...K_HH, labResult: { id: 'a', completedAt: new Date(), order: { acknowledgedAt: null } } },
        { ...NA_H, labResult: { id: 'b', completedAt: new Date(), order: { acknowledgedAt: null } } },
      ]) },
      criticalValueAlert: { findMany: alerts },
    });
    const t = await trends.getLabTrends('p1', ['K', 'Na']);
    const k = t.find((x: any) => x.testName === 'K').data[0];
    const na = t.find((x: any) => x.testName === 'Na').data[0];
    expect(k).toMatchObject({ value: '담당의 확인 중', pendingReview: true, flag: null });
    expect(na).toMatchObject({ value: '149', flag: null, judgmentPending: true });

    const dashSrc = (await import('node:fs')).readFileSync('src/modules/portal/portal.service.ts', 'utf8');
    const body = dashSrc.slice(dashSrc.indexOf('async getHealthDashboard'), dashSrc.indexOf('// ── Portal v2 Phase 2'));
    expect(body).toMatch(/releasedLabItem\(item/);
    expect(body).not.toMatch(/flag: item\.flag,/);
  });

  it('기초검사 — 판독 승인(APPROVED) 전에는 결론·소견을 비운다 · 대조군 승인되면 그대로', async () => {
    const rows = [
      { id: 'd1', testType: 'ECG', testName: '심전도', performedAt: new Date(), conclusion: 'ABNORMAL', findings: 'ST 상승', reviewStatus: 'PENDING_REVIEW', reviewedAt: null },
      { id: 'd2', testType: 'ECG', testName: '심전도', performedAt: new Date(), conclusion: 'NORMAL', findings: '정상 동율동', reviewStatus: 'APPROVED', reviewedAt: ACK },
      { id: 'd3', testType: 'PFT', testName: '폐기능', performedAt: new Date(), conclusion: 'NORMAL', findings: 'x', reviewStatus: null, reviewedAt: null },
    ];
    const svc = portal({ diagnosticTest: { findMany: vi.fn().mockResolvedValue(rows) } });
    const [d1, d2, d3] = await svc.getDiagnosticTests('p1');
    expect(d1).toMatchObject({ conclusion: null, findings: null, release: 'AWAITING_REVIEW', reviewedAt: null });
    expect(d2).toMatchObject({ conclusion: 'NORMAL', findings: '정상 동율동', release: 'REVIEWED', reviewedAt: ACK });
    expect(d3).toMatchObject({ conclusion: null, release: 'AWAITING_REVIEW' });
    expect(d1).not.toHaveProperty('reviewStatus');
  });
});

describe('🔴 B2 진료 후 요약 — 일반 수준', () => {
  it('진료 이력은 의사 소견 원문을 고르지 않는다 · 감별·배제 진단은 뺀다', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'e1', createdAt: new Date(), doctor: { familyName: '김', givenName: '의사', department: '내과' }, diagnoses: [
      { type: 'PRIMARY', certainty: 'CONFIRMED', diagnosisCode: { code: 'I10', nameKo: '고혈압' } },
      { type: 'DIFFERENTIAL', certainty: null, diagnosisCode: { code: 'C34', nameKo: '폐암' } },
      { type: 'SECONDARY', certainty: 'RULE_OUT', diagnosisCode: { code: 'I21', nameKo: '심근경색' } },
    ] }]);
    const svc = portal({ encounter: { findMany } });
    const [e] = await svc.getEncounters('p1');
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty('assessment');
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty('plan');
    expect(e.diagnoses.map((d: any) => d.diagnosisCode.code)).toEqual(['I10']);
  });

  it('요약: 서명된 진료만 · 진단·약·검사·다음 예약·병원 전화 · 소견 원문 없음 · 추정 표기', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'e1', createdAt: new Date('2026-10-18T01:00:00Z'), signedAt: new Date('2026-10-18T02:00:00Z'),
      doctor: { familyName: '김', givenName: '의사', department: '내과' },
      diagnoses: [
        { type: 'PRIMARY', certainty: 'PROVISIONAL', diagnosisCode: { code: 'E11', nameKo: '2형 당뇨병' } },
        { type: 'DIFFERENTIAL', certainty: null, diagnosisCode: { code: 'C25', nameKo: '췌장암' } },
      ],
      prescriptions: [
        { type: 'MEDICATION', status: 'ACTIVE', dosage: '500mg', frequency: 'BID', duration: 30, route: 'PO', instructions: null, dischargeMed: false, medicationCode: { nameKo: '메트포르민' }, procedureCode: null },
        { type: 'LAB', status: 'ACTIVE', dosage: null, frequency: null, duration: null, route: null, instructions: null, dischargeMed: false, medicationCode: null, procedureCode: { nameKo: '당화혈색소' } },
      ],
    });
    const svc = portal({
      encounter: { findFirst },
      appointment: { findFirst: vi.fn().mockResolvedValue({ id: 'a1', scheduledAt: new Date('2026-11-01T01:00:00Z'), doctor: { familyName: '김', givenName: '의사', department: '내과' } }) },
      systemConfig: { findMany: vi.fn().mockResolvedValue([{ key: 'hospital.phone', value: '02-000-0000' }]) },
    });
    const s = await svc.getVisitSummary('p1', 'e1');
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ id: 'e1', patientId: 'p1', status: 'SIGNED' });
    expect(findFirst.mock.calls[0][0].select).not.toHaveProperty('assessment');
    expect(s.scope).toBe('GENERAL');
    expect(s.diagnoses).toEqual([{ name: '2형 당뇨병', code: 'E11', primary: true, provisional: true }]);
    expect(s.medications[0]).toMatchObject({ name: '메트포르민', durationDays: 30, discontinued: false });
    expect(s.orders).toEqual([{ type: 'LAB', name: '당화혈색소' }]);
    expect(s.nextAppointment).toMatchObject({ id: 'a1', doctorName: '김의사' });
    expect(s.hospitalPhone).toBe('02-000-0000');
    expect(JSON.stringify(s)).not.toMatch(/assessment|"plan"/);
  });

  it('없는·작성 중·남의 진료는 404 · 보호자 위임(민감 동의 없음)은 민감 진료과 404', async () => {
    const svc = portal({ encounter: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(svc.getVisitSummary('p1', 'e1')).rejects.toBeInstanceOf(NotFoundException);
    const psy = portal({ encounter: { findFirst: vi.fn().mockResolvedValue({ id: 'e1', createdAt: new Date(), signedAt: null, doctor: { familyName: '이', givenName: '의사', department: '정신건강의학과' }, diagnoses: [], prescriptions: [] }) } });
    await expect(psy.getVisitSummary('p1', 'e1', { hideSensitive: true })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('🔴 입원 상세 — 작성 중 진료 평가·회진 기록 원문을 싣지 않는다 · 검사는 같은 공개 규칙', async () => {
    const src = (await import('node:fs')).readFileSync('src/modules/portal/portal.service.ts', 'utf8');
    const body = src.slice(src.indexOf('async getInpatientDetail'), src.indexOf('async getActiveQuestionnaires'));
    expect(body).not.toMatch(/assessment: true/);
    expect(body).not.toMatch(/notes: true, plan: true/);
    expect(body).toMatch(/releasedLabItem\(it/);
  });
});

describe('🔴 B6 예상 진료비 — 예측 자료 · 모르면 금액을 지어내지 않는다', () => {
  function billingSvc(proc: any, rate: number | null, recent: any[] = []) {
    const svc = Object.create(BillingService.prototype) as any;
    svc.prisma = {
      patient: { findUnique: vi.fn().mockResolvedValue({ insuranceType: 'NHI' }) },
      encounter: { count: vi.fn().mockResolvedValue(3) },
      procedureCode: { findFirst: vi.fn().mockResolvedValue(proc) },
      eligibilityCheck: { findFirst: vi.fn().mockResolvedValue({ id: 'el1' }) },
      billing: { findMany: vi.fn().mockResolvedValue(recent) },
    };
    svc.eligibility = { resolveCopayRate: vi.fn().mockResolvedValue({ rate, copayCategory: 'NHI' }) };
    svc.configRuntime = { get: vi.fn().mockResolvedValue(null) }; // 종별 미설정 = 의원(AA154·AA254)
    return svc;
  }
  it('🔴 재진 진찰료 단가 0원(운영 실측) → 0원이 아니라 산출 불가 · 대조군 단가 있으면 금액(요율 30%)', async () => {
    const zero = await billingSvc({ id: 'pc', nameKo: '재진진찰료', unitPrice: 0 }, 0.3).estimateVisitCopay('p1', { type: 'FOLLOW_UP', department: '내과' }, 6);
    expect(zero.consultation).toMatchObject({ code: 'AA254', visitKind: 'FOLLOW_UP', totalAmount: null, patientCopay: null, unknownReason: 'CONSULT_PRICE_UNKNOWN' });
    const priced = await billingSvc({ id: 'pc', nameKo: '재진진찰료', unitPrice: 20000 }, 0.3).estimateVisitCopay('p1', { type: 'FOLLOW_UP', department: '내과' }, 6);
    expect(priced.consultation).toMatchObject({ totalAmount: 20000, patientCopay: 6000, unknownReason: null, basis: 'ELIGIBILITY' });
  });
  it('수가 미등재 → 이유 · 최근 같은 과 범위는 감면 뒤 · 표본 0 이면 null', async () => {
    const svc = billingSvc(null, 0.3, [{ patientCopay: 9000, discountAmount: 1000 }, { patientCopay: 15000, discountAmount: null }]);
    const r = await svc.estimateVisitCopay('p1', { type: 'INITIAL', department: '내과' }, 6);
    expect(r.consultation).toMatchObject({ code: 'AA154', unknownReason: 'CONSULT_CODE_UNREGISTERED', patientCopay: null });
    expect(r.recent).toEqual({ department: '내과', sampleSize: 2, min: 8000, max: 15000 });
    expect(svc.prisma.billing.findMany.mock.calls[0][0].where.status).toEqual({ notIn: ['CANCELLED', 'REFUNDED'] });
    // 종별 설정값이 표 밖(오타 등) → 아무 종별로 짐작하지 않는다
    const odd = billingSvc({ id: 'pc', nameKo: 'x', unitPrice: 18840 }, 0.3);
    odd.configRuntime.get.mockResolvedValue('DENTAL?');
    const o = await odd.estimateVisitCopay('p1', { type: 'INITIAL', department: null }, 6);
    expect(o.consultation).toMatchObject({ code: null, unknownReason: 'INSTITUTION_GRADE_UNKNOWN', patientCopay: null, visitKind: 'INITIAL' });
    expect(odd.prisma.procedureCode.findFirst).not.toHaveBeenCalled();
    const none = await billingSvc(null, 0.3, []).estimateVisitCopay('p1', { type: 'INITIAL', department: null }, 6);
    expect(none.recent).toEqual({ department: null, sampleSize: 0, min: null, max: null });
  });
  it('포털: 다가오는 본인 예약만 · 계산 정본을 못 찾으면 503(금액을 지어내지 않는다) · 응답은 늘 estimate:true', async () => {
    const appt = { id: 'a1', type: 'FOLLOW_UP', departmentName: null, doctor: { department: '내과' } };
    const none = portal({ appointment: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(none.getAppointmentCostEstimate('p1', 'a1')).rejects.toBeInstanceOf(NotFoundException);
    const noBilling = portal({ appointment: { findFirst: vi.fn().mockResolvedValue(appt) } }, { get: () => { throw new Error('nope'); } });
    await expect(noBilling.getAppointmentCostEstimate('p1', 'a1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    const estimateVisitCopay = vi.fn().mockResolvedValue({ consultation: {}, recent: {} });
    const ok = portal({ appointment: { findFirst: vi.fn().mockResolvedValue(appt) } }, { get: () => ({ estimateVisitCopay }) });
    const r = await ok.getAppointmentCostEstimate('p1', 'a1');
    expect(r).toMatchObject({ appointmentId: 'a1', estimate: true });
    expect(estimateVisitCopay).toHaveBeenCalledWith('p1', { type: 'FOLLOW_UP', department: '내과' }, 6);
    const where = (ok.prisma.appointment.findFirst as any).mock.calls[0][0].where;
    expect(where).toMatchObject({ id: 'a1', patientId: 'p1', status: { in: ['SCHEDULED', 'CONFIRMED'] } });
  });
  it('보호자 위임 — 예상 진료비는 수납 구획(응급 임시 열람은 막힌다) · 대조군 일반 위임은 열림', () => {
    const url = '/api/v1/portal/appointments/11111111-1111-4111-8111-111111111111/cost-estimate';
    expect(guardianDenies(BTG_GUARDIAN_SCOPE, url)).toBe(true);
    expect(guardianDenies(DEFAULT_GUARDIAN_SCOPE, url)).toBe(false);
    expect(guardianDenies(BTG_GUARDIAN_SCOPE, '/api/v1/portal/appointments')).toBe(false);
  });
});
