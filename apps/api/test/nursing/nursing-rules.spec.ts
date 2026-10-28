/**
 * 간호 원내 규정(2026-10-26) — 원내 판단 몫을 화면에서 고르고 그대로 동작시킨다.
 *  · 규정 읽기 정본 하나(보호대·통증 재평가·인계 인수 방식) — 출처 원내 설정/코드 기본값/미설정/조회 실패
 *  · 🔴 통증 재평가: 규정 미설정이면 목록을 만들지 않는다(기준을 지어내지 않음) · 재평가 = 사건 뒤 통증 기록 ·
 *    약품 분류를 모르는 투약은 진통제 아님으로 접지 않고 센다
 *  · 🔴 인계 "늘 묶음": 처음 확인 · 지정 인수자 본인(간호사)만 담당을 넘긴다 · 관리자 대리·다시 누름·방식 모름은 넘기지 않는다 ·
 *    담당 인수 실패는 확인을 되돌리지 않고 사유를 말한다
 *  · 범용 설정 저장도 같은 값 검사 · 담당 인수 쓰기는 한 함수
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { settingValueInvalidReason } from '@hospital-run/shared';
import { readHandoffAckMode, readPainReassessRule, readRestraintInterval } from '../../src/modules/nursing-rules/nursing-rules.read';
import { NursingRulesService } from '../../src/modules/nursing-rules/nursing-rules.service';
import { NursingRulesController } from '../../src/modules/nursing-rules/nursing-rules.controller';
import { InpatientService } from '../../src/modules/inpatient/inpatient.service';
import { DEFAULTS } from '../../src/modules/config/config-runtime.service';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';

const SRC = join(__dirname, '../../src/modules');
const PAIN = 'nursing.pain.reassessRule';
const MODE = 'nursing.handoff.ackTakeOverMode';
const RULE = { thresholdScore: 4, withinMinutes: 60, afterAnalgesicMinutes: 30 };

function cfg(values: Record<string, unknown> = {}, opts: { throwKeys?: string[]; source?: string } = {}) {
  return {
    getWithSource: vi.fn(async (k: string) => {
      if (opts.throwKeys?.includes(k)) throw new Error('db down');
      return k in values ? { value: values[k], source: opts.source ?? 'db', registered: true } : { value: DEFAULTS[k]?.value ?? null, source: 'default', registered: true };
    }),
    get: vi.fn(async () => null),
  } as any;
}

describe('규정 읽기 정본 — 출처', () => {
  it('통증 규정: 원내 설정 · 기본값 없음 = 미설정 · 형식 밖 = 미설정 · 조회 실패 = 확인 불가', async () => {
    expect(await readPainReassessRule(cfg({ [PAIN]: RULE }))).toEqual({ rule: RULE, source: 'CONFIGURED' });
    expect(await readPainReassessRule(cfg())).toEqual({ rule: null, source: 'UNSET' });
    expect(await readPainReassessRule(cfg({ [PAIN]: { ...RULE, thresholdScore: 11 } }))).toEqual({ rule: null, source: 'UNSET' });
    expect(await readPainReassessRule(cfg({}, { throwKeys: [PAIN] }))).toEqual({ rule: null, source: 'UNKNOWN' });
  });
  it('인수 방식: 비면 코드 기본값 OFFER_BOTH · 🔴 조회 실패면 모른다(null — 짐작하지 않음)', async () => {
    expect(await readHandoffAckMode(cfg({ [MODE]: 'ALWAYS_BUNDLED' }))).toEqual({ mode: 'ALWAYS_BUNDLED', source: 'CONFIGURED' });
    expect(await readHandoffAckMode(cfg())).toEqual({ mode: 'OFFER_BOTH', source: 'CODE_DEFAULT' });
    expect(await readHandoffAckMode(cfg({}, { throwKeys: [MODE] }))).toEqual({ mode: null, source: 'UNKNOWN' });
  });
  it('보호대 간격: 코드 기본값 120 은 원내 설정이 아니다 · 실패해도 감시는 120', async () => {
    expect(await readRestraintInterval(cfg())).toEqual({ minutes: 120, source: 'CODE_DEFAULT' });
    expect(await readRestraintInterval(cfg({ 'nursing.restraint.checkIntervalMinutes': 60 }))).toEqual({ minutes: 60, source: 'CONFIGURED' });
    expect(await readRestraintInterval(cfg({}, { throwKeys: ['nursing.restraint.checkIntervalMinutes'] }))).toEqual({ minutes: 120, source: 'UNKNOWN' });
  });
  it('범용 설정 저장 값 검사 — 같은 규칙 · null 은 미설정으로 되돌림', () => {
    expect(settingValueInvalidReason(PAIN, RULE)).toBeNull();
    expect(settingValueInvalidReason(PAIN, { ...RULE, withinMinutes: 5 })).toBeTruthy();
    expect(settingValueInvalidReason(PAIN, null)).toBeNull();
    expect(settingValueInvalidReason(MODE, 'SEPARATE')).toBeNull();
    expect(settingValueInvalidReason(MODE, 'ALWAYS')).toBeTruthy();
    expect(settingValueInvalidReason('nursing.restraint.checkIntervalMinutes', 10)).toBeTruthy();
    expect(settingValueInvalidReason('nursing.restraint.checkIntervalMinutes', 90)).toBeNull();
    for (const k of [PAIN, MODE]) expect(DEFAULTS[k]?.value, k).toBeNull();
  });
});

const NOW = new Date('2026-10-26T12:00:00Z');
const at = (min: number) => new Date(NOW.getTime() - min * 60_000);
function painSvc(o: { rule?: unknown; ruleThrows?: boolean; flows?: any[]; assessments?: any[]; mar?: any[] }) {
  const ADM = [
    { id: 'a1', patientId: 'p1', admitDate: at(5000), dischargeDate: null, patient: { id: 'p1', familyName: '김', givenName: '가람', mrn: 'M1' }, bed: { roomNumber: '501', bedNumber: 'A', ward: { id: 'w1', name: '5병동' } } },
    { id: 'a2', patientId: 'p2', admitDate: at(5000), dischargeDate: null, patient: { id: 'p2', familyName: '이', givenName: '나래', mrn: 'M2' }, bed: { roomNumber: '502', bedNumber: 'B', ward: { id: 'w1', name: '5병동' } } },
  ];
  const prisma: any = {
    admission: { findMany: vi.fn(async () => ADM) },
    flowSheetEntry: { findMany: vi.fn(async () => o.flows ?? []) },
    preVisitVitals: { findMany: vi.fn(async () => []) },
    nursingAssessment: { findMany: vi.fn(async () => o.assessments ?? []) },
    medicationAdministration: { findMany: vi.fn(async () => o.mar ?? []) },
  };
  const config = cfg(o.rule === undefined ? {} : { [PAIN]: o.rule }, { throwKeys: o.ruleThrows ? [PAIN] : [] });
  return { svc: new NursingRulesService(prisma, config), prisma };
}
const flow = (admissionId: string, min: number, painScore: number | null) => ({ id: `f-${admissionId}-${min}`, admissionId, recordedAt: at(min), nurseId: 'n', painScore, systolicBp: null, diastolicBp: null, heartRate: null, temperature: null, spo2: null, respiratoryRate: null, consciousness: null, notes: null });

describe('🔴 통증 재평가 대기', () => {
  it('규정 미설정 → 목록 없음(items null · 원장 조회도 안 함) · 조회 실패 → RULE_UNKNOWN', async () => {
    const u = painSvc({});
    expect(await u.svc.painReassessment(NOW)).toMatchObject({ reason: 'RULE_UNSET', items: null });
    expect(u.prisma.admission.findMany).not.toHaveBeenCalled();
    expect(await painSvc({ ruleThrows: true }).svc.painReassessment(NOW)).toMatchObject({ reason: 'RULE_UNKNOWN', items: null });
  });
  it('기준 이상 기록 뒤 재평가 없음 → 지연 · 뒤에 기록 있으면 빠짐 · 기준 미만은 사건 아님', async () => {
    const r = await painSvc({ rule: { ...RULE, afterAnalgesicMinutes: null }, flows: [flow('a1', 90, 7), flow('a2', 120, 6), flow('a2', 30, 2)] }).svc.painReassessment(NOW);
    expect(r.items!.map((i) => [i.admissionId, i.status, i.minutes])).toEqual([['a1', 'OVERDUE', 30]]);
  });
  it('🔴 마지막 기록이 기준 이상이면 그 자체가 새 사건(재평가했어도 여전히 아프면 다시)', async () => {
    const r = await painSvc({ rule: { ...RULE, afterAnalgesicMinutes: null }, flows: [flow('a1', 100, 8), flow('a1', 20, 6)] }).svc.painReassessment(NOW);
    expect(r.items![0]).toMatchObject({ admissionId: 'a1', status: 'DUE', minutes: 40, trigger: { kind: 'PAIN_SCORE', score: 6 } });
  });
  it('진통제 투여 뒤 기한 · 🔴 분류 모르는 투약은 세고 넣지 않는다 · 투여 전 기록은 재평가가 아니다', async () => {
    const mar = [
      { patientId: 'p2', administeredAt: at(45), prescription: { medicationCode: { nameKo: '트라마돌', category: '해열·진통·소염제', highAlertCategory: null } } },
      { patientId: 'p1', administeredAt: at(45), prescription: { medicationCode: null } },
    ];
    const r = await painSvc({ rule: RULE, flows: [flow('a2', 50, 3)], mar }).svc.painReassessment(NOW);
    expect(r.items!.map((i) => [i.admissionId, i.trigger.kind, i.status, i.minutes])).toEqual([['a2', 'ANALGESIC', 'OVERDUE', 15]]);
    expect(r.unclassifiedAdministrations).toBe(1);
  });
  it('진통제 사건을 끈 규정이면 투약을 읽지 않고 분류 수도 null', async () => {
    const m = painSvc({ rule: { ...RULE, afterAnalgesicMinutes: null } });
    const r = await m.svc.painReassessment(NOW);
    expect(m.prisma.medicationAdministration.findMany).not.toHaveBeenCalled();
    expect(r.unclassifiedAdministrations).toBeNull();
  });
  it('간호 초기평가 통증 점수도 통증 기록이다', async () => {
    const r = await painSvc({ rule: { ...RULE, afterAnalgesicMinutes: null }, assessments: [{ admissionId: 'a1', assessedAt: at(10), painScore: 5 }] }).svc.painReassessment(NOW);
    expect(r.items![0]).toMatchObject({ admissionId: 'a1', status: 'DUE', minutes: 50 });
  });
  it('EP 역할 — 간호사·의사·관리자', () => {
    for (const m of ['overview', 'painReassessment'] as const) {
      expect(Reflect.getMetadata(ROLES_KEY, NursingRulesController.prototype[m])).toEqual([UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN]);
    }
  });
});

describe('🔴 인계 "늘 묶음" — 인수 확인 = 담당 인수', () => {
  function ackSvc(o: { mode?: string; modeThrows?: boolean; row?: any; already?: boolean; admStatus?: string }) {
    const row = { id: 'h1', type: 'NURSING_SHIFT', toDoctorId: 'n2', admissionId: 'adm1', acknowledgedAt: o.already ? new Date() : null, acknowledgedBy: o.already ? 'n2' : null, fromDoctor: { role: 'NURSE' }, ...(o.row ?? {}) };
    const assign = { updateMany: vi.fn(async () => ({ count: 1 })), findFirst: vi.fn(async () => null), create: vi.fn(async ({ data }: any) => ({ id: 'as1', ...data })) };
    const tx: any = { admission: { findUnique: vi.fn(async () => ({ status: o.admStatus ?? 'ADMITTED' })) }, nursePatientAssignment: assign };
    const prisma: any = {
      clinicalHandoff: {
        findUnique: vi.fn(async (q: any) => (q.include ? row : { toDoctorId: row.toDoctorId })),
        updateMany: vi.fn(async () => ({ count: o.already ? 0 : 1 })),
      },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    };
    const config = cfg(o.mode ? { [MODE]: o.mode } : {}, { throwKeys: o.modeThrows ? [MODE] : [] });
    return { svc: new InpatientService(prisma, undefined, config), assign };
  }
  it('늘 묶음 · 인수자 본인 간호사 · 처음 확인 → 담당 인수(다른 배정 해제)', async () => {
    const m = ackSvc({ mode: 'ALWAYS_BUNDLED' });
    const r: any = await m.svc.acknowledgeHandoff('h1', 'n2', 'NURSE');
    expect(r.data.takeOver).toEqual({ mode: 'ALWAYS_BUNDLED', done: true, reason: null });
    expect(m.assign.updateMany.mock.calls[0][0].where).toMatchObject({ admissionId: 'adm1', nurseId: { not: 'n2' } });
    expect(m.assign.create.mock.calls[0][0].data).toMatchObject({ nurseId: 'n2', admissionId: 'adm1', isPrimary: true });
  });
  it('🔴 관리자 대리 확인 · 다시 누름 · 방식 모름 · 둘 다 제공 · 묶지 않음 → 담당을 넘기지 않는다', async () => {
    const cases: Array<[Parameters<typeof ackSvc>[0], string, string, string]> = [
      [{ mode: 'ALWAYS_BUNDLED' }, 'admin1', 'ADMIN', 'PROXY_ACK'],
      [{ mode: 'ALWAYS_BUNDLED', already: true }, 'n2', 'NURSE', 'ALREADY_ACKNOWLEDGED'],
      [{ modeThrows: true }, 'n2', 'NURSE', 'MODE_UNKNOWN'],
      [{}, 'n2', 'NURSE', 'NOT_BUNDLED'],
      [{ mode: 'SEPARATE' }, 'n2', 'NURSE', 'NOT_BUNDLED'],
    ];
    for (const [o, user, role, reason] of cases) {
      const m = ackSvc(o);
      const r: any = await m.svc.acknowledgeHandoff('h1', user, role);
      expect(r.data.takeOver, reason).toMatchObject({ done: false, reason });
      expect(m.assign.create, reason).not.toHaveBeenCalled();
      expect(m.assign.updateMany, reason).not.toHaveBeenCalled();
    }
  });
  it('담당 인수 실패(퇴원한 입원) → 확인은 남고 사유를 말한다 · 간호 교대 아니면 묶음 판정 없음', async () => {
    const r: any = await ackSvc({ mode: 'ALWAYS_BUNDLED', admStatus: 'DISCHARGED' }).svc.acknowledgeHandoff('h1', 'n2', 'NURSE');
    expect(r.data).toMatchObject({ alreadyAcknowledged: false, takeOver: { done: false, reason: 'ADMISSION_NOT_ACTIVE' } });
    const doc: any = await ackSvc({ mode: 'ALWAYS_BUNDLED', row: { type: 'SHIFT_CHANGE', fromDoctor: { role: 'DOCTOR' } } }).svc.acknowledgeHandoff('h1', 'n2', 'DOCTOR');
    expect(doc.data.takeOver).toBeNull();
  });
  it('담당 인수 쓰기는 한 함수 — 간호 스테이션 EP 와 묶음 확인이 같은 takeOverInTx', () => {
    const ns = readFileSync(join(SRC, 'nurse-station/nurse-station.service.ts'), 'utf8');
    const ip = readFileSync(join(SRC, 'inpatient/inpatient.service.ts'), 'utf8');
    expect(ns).toMatch(/takeOverInTx\(tx, nurseId, admissionId, shiftType\)/);
    expect(ip).toMatch(/takeOverInTx\(tx, userId, h\.admissionId!, shiftType\)/);
    for (const s of [ns, ip]) expect(s).not.toMatch(/nursePatientAssignment\.updateMany\(\{\s*where: \{ admissionId, releasedAt: null, nurseId: \{ not/);
  });
});
