import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PacuService, aldreteZeroItems } from '../../src/modules/pacu/pacu.service';

/**
 * PACU 검토 보완 — 2026-09-30.
 *  1. 🔴 Aldrete 통증 항목(0=극심·2=경미)이 NRS 통증(0~10) 칸을 덮어써 가장 아픈 환자가 "통증 0/10"
 *  2. 🔴 0점 항목(의식 0 등)이 있어도 총점 9 로 "퇴실가능" → 0점 항목은 기준 미달(사유+의사 경로)
 *  3. 세부 필수·키 정확히 · 4. 입실: 수술 확인·환자=수술·간호사=사용자·중복 409
 *  5. 퇴실 뒤 평가 수정 금지 · 6. 평가자·시각 · 7. 기준값은 설정(출처를 말한다) · 8. 우회 쓰기 EP 제거
 */
const full = { activity: 2, respiration: 2, circulation: 2, consciousness: 2, spo2: 2, pain: 2 };
function mk(rec: Record<string, unknown> = {}, cfg: Record<string, unknown> = {}, opts: { surgery?: unknown; open?: unknown } = {}) {
  const record = { id: 'r1', patientId: 'p1', surgeryId: 's1', arrivalTime: new Date(), dischargeTime: null, aldretScore: null, aldreteDetail: null, padssScore: null, painScore: 7, vitalSigns: [], complications: [], painAssessments: [], arrivalHandoff: null, dischargeHandoff: null, ...rec };
  const prisma = {
    pacuRecord: {
      findUnique: vi.fn(async () => record),
      findFirst: vi.fn(async () => opts.open ?? null),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...record, ...data })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new', ...data, patient: null })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    admission: { findFirst: vi.fn(async () => ({ id: 'adm-1', bedId: 'bed-1', bed: { roomNumber: '501', bedNumber: '1', ward: { name: '5병동' } } })) },
    icuAdmission: { findFirst: vi.fn(async () => null) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    surgery: { findUnique: vi.fn(async () => (opts.surgery === undefined ? { id: 's1', patientId: 'p1', status: 'COMPLETED' } : opts.surgery)) },
  };
  const config = { get: vi.fn(async (k: string) => (k in cfg ? cfg[k] : null)) };
  return { svc: new PacuService(prisma as never, undefined, undefined, config as never), prisma };
}
const code = (e: unknown) => (e as { response?: { code?: string } })?.response?.code;

describe('Aldrete', () => {
  it('🔴 Aldrete 저장이 NRS 통증 칸을 건드리지 않는다 · 평가자·시각을 남긴다', async () => {
    const { svc, prisma } = mk();
    await svc.updateAldrete('r1', { score: 10, detail: { ...full, pain: 0, spo2: 2, activity: 2 } } as never, 'nur-1').catch(() => undefined);
    await svc.updateAldrete('r1', { score: 12, detail: full } as never, 'nur-1');
    const data = (prisma.pacuRecord.update.mock.calls.at(-1) as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data).not.toHaveProperty('painScore');
    expect(data).toMatchObject({ aldreteAssessedById: 'nur-1' });
    expect(data.aldreteAssessedAt).toBeInstanceOf(Date);
  });
  it('🔴 0점 항목이 있으면 총점이 기준 이상이어도 퇴실 기준 미달', async () => {
    const r = await mk().svc.updateAldrete('r1', { score: 10, detail: { ...full, consciousness: 0 } } as never, 'n');
    expect(r).toMatchObject({ dischargeReady: false, zeroItems: ['consciousness'] });
    expect(aldreteZeroItems({ ...full })).toEqual([]);
  });
  it('세부 없음·항목 누락·모르는 키는 400 — 저장하지 않는다', async () => {
    const a = mk();
    await expect(a.svc.updateAldrete('r1', { score: 9 } as never, 'n')).rejects.toSatisfy((e) => code(e) === 'PACU_SCORE_DETAIL_REQUIRED');
    await expect(a.svc.updateAldrete('r1', { score: 4, detail: { activity: 2, respiration: 2 } } as never, 'n')).rejects.toSatisfy((e) => code(e) === 'PACU_SCORE_DETAIL_KEYS');
    await expect(a.svc.updateAldrete('r1', { score: 12, detail: { ...full, extra: 0 } } as never, 'n')).rejects.toSatisfy((e) => code(e) === 'PACU_SCORE_DETAIL_KEYS');
    expect(a.prisma.pacuRecord.update).not.toHaveBeenCalled();
  });
});

describe('퇴실 게이트', () => {
  it('🔴 0점 항목이 있으면 사유 없이 퇴실 불가(ALDRETE_ITEM_ZERO) · 간호사 단독 강제 퇴실 불가', async () => {
    const rec = { aldretScore: 10, aldreteDetail: { ...full, consciousness: 0 } };
    await expect(mk(rec).svc.discharge('r1', 'u', 'WARD')).rejects.toSatisfy((e) => code(e) === 'ALDRETE_ITEM_ZERO');
    await expect(mk(rec).svc.discharge('r1', 'u', 'WARD', '마취과 판단', undefined, 'NURSE')).rejects.toSatisfy((e) => code(e) === 'DISCHARGE_OVERRIDE_REQUIRES_DOCTOR');
  });
  it('대조군 — 0점 항목 없이 기준 이상이면 사유 없이 퇴실', async () => {
    const { svc, prisma } = mk({ aldretScore: 12, aldreteDetail: full });
    await svc.discharge('r1', 'u', 'WARD');
    expect(prisma.pacuRecord.updateMany).toHaveBeenCalled();
  });
  it('기준값은 설정이 이긴다(출처 CONFIG) · 미설정이면 기본 9(출처 DEFAULT) · 만점 초과 설정은 기본값', async () => {
    const d = await mk().svc.getMonitoringSettings();
    expect(d).toMatchObject({ criteriaSource: 'DEFAULT', scales: { aldrete: { dischargeMin: 9 } } });
    const c = await mk({}, { 'pacu.aldrete.dischargeMin': 11 }).svc.getMonitoringSettings();
    expect(c).toMatchObject({ criteriaSource: 'CONFIG', scales: { aldrete: { dischargeMin: 11 } } });
    await expect(mk({ aldretScore: 10, aldreteDetail: { ...full, pain: 0 } }, { 'pacu.aldrete.dischargeMin': 11 }).svc.discharge('r1', 'u', 'WARD')).rejects.toBeTruthy();
    const bad = await mk({}, { 'pacu.aldrete.dischargeMin': 99 }).svc.getMonitoringSettings();
    expect(bad.scales.aldrete.dischargeMin).toBe(9);
  });
});

describe('입실·퇴실 후', () => {
  it('수술 미완료 409 · 다른 환자 400 · 재실 중 중복 409 — 기록을 만들지 않는다', async () => {
    const a = mk({}, {}, { surgery: { id: 's1', patientId: 'p1', status: 'IN_PROGRESS' } });
    await expect(a.svc.admit({ surgeryId: 's1' } as never, 'n')).rejects.toSatisfy((e) => code(e) === 'PACU_SURGERY_NOT_COMPLETED');
    const b = mk();
    await expect(b.svc.admit({ surgeryId: 's1', patientId: 'other' } as never, 'n')).rejects.toSatisfy((e) => code(e) === 'PACU_PATIENT_MISMATCH');
    const c = mk({}, {}, { open: { id: 'r0' } });
    await expect(c.svc.admit({ surgeryId: 's1' } as never, 'n')).rejects.toSatisfy((e) => code(e) === 'PACU_ALREADY_ADMITTED');
    for (const x of [a, b, c]) expect(x.prisma.pacuRecord.create).not.toHaveBeenCalled();
  });
  it('🔴 퇴실 뒤에는 Aldrete·PADSS·PONV·합병증·통증을 고칠 수 없다', async () => {
    const { svc, prisma } = mk({ dischargeTime: new Date() });
    const calls = [
      svc.updateAldrete('r1', { score: 12, detail: full } as never, 'n'),
      svc.updatePadss('r1', { score: 10, detail: { vitalSigns: 2, ambulation: 2, nausea: 2, pain: 2, bleeding: 2 } } as never, 'n'),
      svc.updatePonv('r1', { score: 0 } as never, 'n'),
      svc.addComplication('r1', { type: 'OTHER', severity: 'MILD' } as never, 'n'),
      svc.addPainAssessment('r1', { score: 3 } as never, 'n'),
    ];
    for (const c of calls) await expect(c).rejects.toSatisfy((e) => code(e) === 'PACU_ALREADY_DISCHARGED');
    expect(prisma.pacuRecord.update).not.toHaveBeenCalled();
  });
});

describe('우회 쓰기 EP 제거', () => {
  it('surgery-advanced 에 PACU 쓰기(POST :surgeryId/pacu · PATCH pacu/:id)가 없다 — 조회만 남는다', () => {
    const src = readFileSync(join(__dirname, '../../src/modules/surgery/surgery-advanced.controller.ts'), 'utf8').replace(/\/\/[^\n]*/g, '');
    expect(src).not.toMatch(/@Post\(':surgeryId\/pacu'\)/);
    expect(src).not.toMatch(/@Patch\('pacu\/:id'\)/);
  });
});
