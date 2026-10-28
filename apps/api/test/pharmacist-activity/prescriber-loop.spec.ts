import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PharmacistActivityService } from '../../src/modules/pharmacist-activity/pharmacist-activity.service';
import { PharmacistActivityController } from '../../src/modules/pharmacist-activity/pharmacist-activity.controller';
import { PharmacyService } from '../../src/modules/pharmacy/pharmacy.service';
import { PharmacyController } from '../../src/modules/pharmacy/pharmacy.controller';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { responsiblePrescriberOf } from '../../src/common/responsible-prescriber';

/**
 * 🔴 약사 ↔ 의사 루프 가드(2026-09-30).
 *
 * 되살아나면 안 되는 것:
 *  ① 의사가 **자기 앞으로 온 중재·대체조제를 볼 목록이 없다**(회신·승인 EP 만 열려 있고 목록은 약사 전용이었다)
 *  ② **아무 의사나 아무 중재에 회신·아무 대체조제를 판정**할 수 있다(누구의 처방인지 보지 않았다)
 *  ③ 중재가 등록돼도 **처방의에게 아무 신호가 없다**(알림 0)
 *  ④ DUR 경고 무시 사유가 **아무 화면에도 모이지 않는다**
 *
 * 목(mock)은 조건을 실제로 평가하는 작은 인메모리 원장이다 — where 인자만 대조하면 "다른 의사"
 * 대조군이 아무것도 보증하지 않는다(조건을 빼도 인자 대조는 통과할 수 있다).
 */

const DOC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DOC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NURSE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PHARM = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PATIENT = '11111111-1111-4111-8111-111111111111';
const RX_A = '20000000-0000-4000-8000-00000000000a'; // DOC_A 가 직접 입력(prescriberId 미지정)
const RX_A_DELEG = '20000000-0000-4000-8000-00000000000d'; // 간호사 입력·책임 처방의 DOC_A
const RX_B = '20000000-0000-4000-8000-00000000000b';
const INTV_A = '30000000-0000-4000-8000-00000000000a';
const INTV_A2 = '30000000-0000-4000-8000-00000000000d';
const INTV_B = '30000000-0000-4000-8000-00000000000b';
const INTV_NORX = '30000000-0000-4000-8000-00000000000e';

// ── 조건 평가기(쓰는 모양만: 등호·{not:null}·{in}·{gte}·OR·중첩 관계) ──
type Row = Record<string, any>;
function match(row: Row, where: Row | undefined, rel: (row: Row, key: string) => Row | undefined = () => undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return (cond as Row[]).some((c) => match(row, c, rel));
    const v = row[k];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return (cond.in as unknown[]).includes(v);
      if ('not' in cond) return cond.not === null ? v != null : v !== cond.not;
      if ('gte' in cond) return v != null && v >= cond.gte;
      const r = rel(row, k);
      return r ? match(r, cond, rel) : false;
    }
    return v === cond;
  });
}

function makeLedger() {
  const prescriptions: Row[] = [
    { id: RX_A, prescriberId: null, createdBy: DOC_A, encounter: { patientId: PATIENT } },
    { id: RX_A_DELEG, prescriberId: DOC_A, createdBy: NURSE, encounter: { patientId: PATIENT } },
    { id: RX_B, prescriberId: null, createdBy: DOC_B, encounter: { patientId: PATIENT } },
  ];
  const now = new Date('2026-09-30T00:00:00Z');
  const base = { pharmacistId: PHARM, patientId: PATIENT, drugText: 'Vancomycin', type: 'DOSE', reason: 'r', suggestion: 's', status: 'PENDING', doctorResponse: null, respondedBy: null, respondedAt: null, createdAt: now, updatedAt: now };
  const interventions: Row[] = [
    { ...base, id: INTV_A, prescriptionId: RX_A },
    { ...base, id: INTV_A2, prescriptionId: RX_A_DELEG },
    { ...base, id: INTV_B, prescriptionId: RX_B },
    { ...base, id: INTV_NORX, prescriptionId: null },
  ];
  const prisma: any = {
    pharmacistIntervention: {
      findMany: vi.fn(async ({ where, distinct }: any) => {
        const rows = interventions.filter((r) => match(r, where));
        if (distinct) {
          const seen = new Set();
          return rows.filter((r) => (seen.has(r.prescriptionId) ? false : (seen.add(r.prescriptionId), true)));
        }
        return rows;
      }),
      findUnique: vi.fn(async ({ where }: any) => interventions.find((r) => r.id === where.id) ?? null),
      create: vi.fn(async ({ data }: any) => ({ ...base, id: '30000000-0000-4000-8000-0000000000ff', prescriptionId: null, drugText: null, ...data })),
    },
    prescription: {
      findMany: vi.fn(async ({ where }: any) => prescriptions.filter((r) => match(r, where))),
      findUnique: vi.fn(async ({ where }: any) => prescriptions.find((r) => r.id === where.id) ?? null),
    },
    patient: {
      findMany: vi.fn(async () => [{ id: PATIENT, familyName: '홍', givenName: '길동' }]),
      findUnique: vi.fn(async () => ({ id: PATIENT })),
    },
    user: { findMany: vi.fn(async ({ where }: any) => (where.id.in as string[]).map((id) => ({ id, familyName: 'U', givenName: id.slice(0, 4), role: 'DOCTOR' }))) },
  };
  return { prisma, interventions, prescriptions };
}

describe('정본 — 책임 처방의 = prescriberId ?? createdBy', () => {
  it('지정 처방의가 있으면 그가, 없으면 입력자가 책임 처방의다', () => {
    expect(responsiblePrescriberOf({ prescriberId: DOC_A, createdBy: NURSE })).toBe(DOC_A);
    expect(responsiblePrescriberOf({ prescriberId: null, createdBy: DOC_B })).toBe(DOC_B);
  });
});

describe('① 의사 회신 워크리스트 — 내 처방에 달린 중재만', () => {
  let L: ReturnType<typeof makeLedger>;
  let svc: PharmacistActivityService;
  beforeEach(() => { L = makeLedger(); svc = new PharmacistActivityService(L.prisma); });

  it('🔴 DOC_A 는 자기 처방(직접 입력 + 위임 지정)의 중재 둘만 본다 — DOC_B 의 것·처방 없는 것은 안 보인다', async () => {
    const page = await svc.getMyInterventions(DOC_A);
    expect(page.items.map((i) => i.id).sort()).toEqual([INTV_A, INTV_A2].sort());
    expect(page.items.every((i) => i.prescriberId === DOC_A)).toBe(true);
  });

  it('대조군 — DOC_B 는 자기 것 하나만, 처방이 없는 사람은 빈 목록', async () => {
    expect((await svc.getMyInterventions(DOC_B)).items.map((i) => i.id)).toEqual([INTV_B]);
    expect((await svc.getMyInterventions(NURSE)).items).toEqual([]); // 입력자여도 책임 처방의가 아니면 아니다
  });

  it('기본은 회신 대기(PENDING) — 이미 회신된 건은 대기 목록에 없다', async () => {
    L.interventions.find((r) => r.id === INTV_A)!.status = 'ACCEPTED';
    expect((await svc.getMyInterventions(DOC_A)).items.map((i) => i.id)).toEqual([INTV_A2]);
    expect((await svc.getMyInterventions(DOC_A, 'ACCEPTED')).items.map((i) => i.id)).toEqual([INTV_A]);
  });

  it('약사 목록도 책임 처방의를 싣는다 — 처방 연결이 없으면 null(지어내지 않는다)', async () => {
    const page = await svc.getInterventions();
    const byId = new Map(page.items.map((i) => [i.id, i]));
    expect(byId.get(INTV_A2)!.prescriberId).toBe(DOC_A);
    expect(byId.get(INTV_NORX)!.prescriberId).toBeNull();
    expect(byId.get(INTV_NORX)!.prescriberName).toBeNull();
  });
});

describe('② 회신 권한 — 의사는 자기 처방의 중재에만', () => {
  let L: ReturnType<typeof makeLedger>;
  let svc: PharmacistActivityService;
  beforeEach(() => { L = makeLedger(); svc = new PharmacistActivityService(L.prisma); });

  it('🔴 다른 의사의 처방에 달린 중재에는 403', async () => {
    await expect(svc.assertCanRespond(INTV_B, { id: DOC_A, role: UserRole.DOCTOR })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('대조군 — 책임 처방의 본인은 통과(직접 입력·위임 지정 둘 다)', async () => {
    await expect(svc.assertCanRespond(INTV_A, { id: DOC_A, role: UserRole.DOCTOR })).resolves.toBeUndefined();
    await expect(svc.assertCanRespond(INTV_A2, { id: DOC_A, role: UserRole.DOCTOR })).resolves.toBeUndefined();
  });

  it('처방 연결이 없으면 책임 처방의를 모른다 → 의사 직접 회신 403(모르면 안전측)', async () => {
    await expect(svc.assertCanRespond(INTV_NORX, { id: DOC_A, role: UserRole.DOCTOR })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('없는 중재는 404', async () => {
    await expect(svc.assertCanRespond('30000000-0000-4000-8000-000000000999', { id: DOC_A, role: UserRole.DOCTOR })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('관리자·약사(대리 기록)는 종전 그대로 통과한다', async () => {
    await expect(svc.assertCanRespond(INTV_B, { id: PHARM, role: UserRole.PHARMACIST })).resolves.toBeUndefined();
    await expect(svc.assertCanRespond(INTV_B, { id: DOC_A, role: UserRole.ADMIN })).resolves.toBeUndefined();
  });

  it('🔴 컨트롤러는 권한 검사가 실패하면 쓰지 않는다', async () => {
    const update = vi.fn();
    const ctl = new PharmacistActivityController({
      assertCanRespond: (id: string, u: any) => svc.assertCanRespond(id, u),
      updateIntervention: update,
    } as never);
    await expect(ctl.updateIntervention(INTV_B, { status: 'ACCEPTED' } as never, { id: DOC_A, role: UserRole.DOCTOR }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
    // 대조군 — 본인 처방이면 쓴다
    await ctl.updateIntervention(INTV_A, { status: 'REJECTED', doctorResponse: '의도적 처방' } as never, { id: DOC_A, role: UserRole.DOCTOR });
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe('③ 중재 등록 → 책임 처방의 인앱 알림', () => {
  let L: ReturnType<typeof makeLedger>;
  beforeEach(() => { L = makeLedger(); });

  it('🔴 연결 처방의 책임 처방의(위임이면 지정의)에게 알린다 — 입력자(간호사)가 아니다', async () => {
    const notify = vi.fn().mockResolvedValue({ id: 'n1' });
    const svc = new PharmacistActivityService(L.prisma, { notify } as never);
    const out = await svc.createIntervention({ pharmacistId: PHARM, patientId: PATIENT, prescriptionId: RX_A_DELEG, type: 'DOSE', reason: 'r', suggestion: 's' });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toBe(DOC_A);
    expect(notify.mock.calls[0][1]).toMatchObject({ type: 'PHARMACIST_INTERVENTION', refType: 'PHARMACIST_INTERVENTION', refId: out.id });
    expect(out.prescriberNotice).toEqual({ attempted: true, sent: true, reason: null });
    expect(out.prescriberId).toBe(DOC_A);
  });

  it('처방 연결이 없으면 받을 사람을 모른다 — 보내지 않고 그렇게 말한다', async () => {
    const notify = vi.fn();
    const svc = new PharmacistActivityService(L.prisma, { notify } as never);
    const out = await svc.createIntervention({ pharmacistId: PHARM, patientId: PATIENT, type: 'DOSE', reason: 'r', suggestion: 's' });
    expect(notify).not.toHaveBeenCalled();
    expect(out.prescriberNotice).toEqual({ attempted: false, sent: false, reason: 'NO_PRESCRIPTION' });
  });

  it('알림 실패는 중재를 되돌리지 않되 성공으로 말하지 않는다', async () => {
    const svc = new PharmacistActivityService(L.prisma, { notify: vi.fn().mockRejectedValue(new Error('db down')) } as never);
    const out = await svc.createIntervention({ pharmacistId: PHARM, patientId: PATIENT, prescriptionId: RX_A, type: 'DOSE', reason: 'r', suggestion: 's' });
    expect(out.id).toBeTruthy();
    expect(out.prescriberNotice).toEqual({ attempted: true, sent: false, reason: 'FAILED' });
  });
});

// ── 대체조제 · DUR 오버라이드 ──

function makePharmacy() {
  const prescriptions: Row[] = [
    { id: RX_A, prescriberId: null, createdBy: DOC_A },
    { id: RX_A_DELEG, prescriberId: DOC_A, createdBy: NURSE },
    { id: RX_B, prescriberId: null, createdBy: DOC_B },
  ];
  const subs: Row[] = [
    { id: 'sub-a', originalPrescriptionId: RX_A, status: 'REQUESTED' },
    { id: 'sub-a2', originalPrescriptionId: RX_A_DELEG, status: 'REQUESTED' },
    { id: 'sub-b', originalPrescriptionId: RX_B, status: 'REQUESTED' },
    { id: 'sub-a-done', originalPrescriptionId: RX_A, status: 'APPROVED' },
  ];
  const rel = (row: Row, key: string) => (key === 'originalPrescription' ? prescriptions.find((p) => p.id === row.originalPrescriptionId) : undefined);
  const withRx = (s: Row) => ({ ...s, originalPrescription: prescriptions.find((p) => p.id === s.originalPrescriptionId) ?? null });
  const overrides: Row[] = [
    { id: RX_A, durOverridden: true, durOverrideAt: new Date(), durOverrideReason: '의도적 병용', durOverrideBy: DOC_A, prescriberId: null, createdBy: DOC_A, status: 'ACTIVE', durWarnings: null, medicationCode: null, encounter: null },
    { id: RX_B, durOverridden: true, durOverrideAt: new Date(), durOverrideReason: '  ', durOverrideBy: PHARM, prescriberId: null, createdBy: DOC_B, status: 'ACTIVE', durWarnings: null, medicationCode: null, encounter: null },
  ];
  const prisma: any = {
    genericSubstitution: {
      findMany: vi.fn(async ({ where }: any) => subs.filter((s) => match(s, where, rel)).map(withRx)),
      findUnique: vi.fn(async ({ where }: any) => { const s = subs.find((x) => x.id === where.id); return s ? withRx(s) : null; }),
      create: vi.fn(async ({ data }: any) => ({ id: 'sub-new', ...data, substituteMedication: { nameKo: '대체약', code: 'X' }, originalPrescription: { ...prescriptions.find((p) => p.id === data.originalPrescriptionId), medicationCode: { nameKo: '원약' }, encounter: { patient: { familyName: '홍', givenName: '길동' } } } })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    prescription: { findMany: vi.fn(async ({ where }: any) => overrides.filter((r) => match(r, where))) },
    user: { findMany: vi.fn(async () => []) },
  };
  return { prisma, subs };
}

describe('④ 대체조제 — 의사 워크리스트·판정 권한', () => {
  it('🔴 DOC_A 의 승인 대기는 자기 처방 둘뿐(DOC_B 것·이미 판정된 것 제외)', async () => {
    const { prisma } = makePharmacy();
    const svc = new PharmacyService(prisma);
    const rows = await svc.getMyPendingSubstitutions(DOC_A);
    expect(rows.map((r: any) => r.id).sort()).toEqual(['sub-a', 'sub-a2']);
    // 대조군
    expect((await svc.getMyPendingSubstitutions(DOC_B)).map((r: any) => r.id)).toEqual(['sub-b']);
    expect(await svc.getMyPendingSubstitutions(NURSE)).toEqual([]);
  });

  it('🔴 다른 의사의 처방 대체조제는 판정 403 · 본인은 통과 · 관리자는 예외', async () => {
    const { prisma } = makePharmacy();
    const svc = new PharmacyService(prisma);
    await expect(svc.assertCanDecideSubstitution('sub-b', { id: DOC_A, role: UserRole.DOCTOR })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.assertCanDecideSubstitution('sub-a2', { id: DOC_A, role: UserRole.DOCTOR })).resolves.toBeUndefined();
    await expect(svc.assertCanDecideSubstitution('sub-b', { id: 'x', role: UserRole.ADMIN })).resolves.toBeUndefined();
    await expect(svc.assertCanDecideSubstitution('nope', { id: DOC_A, role: UserRole.DOCTOR })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('🔴 컨트롤러 승인·거부는 권한 검사가 실패하면 판정하지 않는다', async () => {
    const { prisma } = makePharmacy();
    const svc = new PharmacyService(prisma);
    const approve = vi.spyOn(svc, 'approveSubstitution');
    const reject = vi.spyOn(svc, 'rejectSubstitution');
    const ctl = new PharmacyController(svc);
    await expect(ctl.approveSubstitution('sub-b', {}, { id: DOC_A, role: UserRole.DOCTOR })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctl.rejectSubstitution('sub-b', { note: '사유' }, { id: DOC_A, role: UserRole.DOCTOR })).rejects.toBeInstanceOf(ForbiddenException);
    expect(approve).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
    expect(prisma.genericSubstitution.updateMany).not.toHaveBeenCalled();
    // 대조군 — 본인 처방은 판정된다
    await ctl.approveSubstitution('sub-a', {}, { id: DOC_A, role: UserRole.DOCTOR });
    // 판정자 = 요청한 사용자(2026-09-30)
    expect(approve).toHaveBeenCalledWith('sub-a', DOC_A, undefined);
  });

  it('요청 → 책임 처방의(위임이면 지정의)에게 인앱 알림 · 알림 서비스가 없으면 그렇다고 말한다', async () => {
    const { prisma } = makePharmacy();
    const notify = vi.fn().mockResolvedValue({ id: 'n' });
    const svc = new PharmacyService(prisma, {} as never, {} as never, {} as never, undefined, undefined, { notify } as never);
    const out: any = await svc.requestSubstitution({ originalPrescriptionId: RX_A_DELEG, substituteMedicationCodeId: 'm', reason: 'r', pharmacistId: PHARM });
    expect(notify.mock.calls[0][0]).toBe(DOC_A);
    expect(notify.mock.calls[0][1]).toMatchObject({ type: 'SUBSTITUTION_REQUEST', refType: 'GENERIC_SUBSTITUTION', refId: 'sub-new' });
    expect(out.prescriberNotice).toEqual({ attempted: true, sent: true, reason: null });

    const bare: any = await new PharmacyService(makePharmacy().prisma).requestSubstitution({ originalPrescriptionId: RX_A, substituteMedicationCodeId: 'm', reason: 'r', pharmacistId: PHARM });
    expect(bare.prescriberNotice).toEqual({ attempted: false, sent: false, reason: 'NO_NOTIFIER' });
  });
});

describe('⑤ DUR 오버라이드 검토 목록 — 약사·관리자 전건 / 의사는 자기 처방만', () => {
  it('🔴 의사는 자기 처방만, 약사는 전건', async () => {
    const { prisma } = makePharmacy();
    const svc = new PharmacyService(prisma);
    const mine = await svc.getDurOverrides({ id: DOC_A, role: UserRole.DOCTOR });
    expect(mine.items.map((i) => i.prescriptionId)).toEqual([RX_A]);
    expect(mine.scope).toBe('MINE');
    const all = await svc.getDurOverrides({ id: PHARM, role: UserRole.PHARMACIST });
    expect(all.items.map((i) => i.prescriptionId).sort()).toEqual([RX_A, RX_B].sort());
    expect(all.scope).toBe('ALL');
  });

  it('공백 사유는 null — "사유 미기록"을 빈 문자열로 가리지 않는다 · 창은 기본 30일', async () => {
    const { prisma } = makePharmacy();
    const svc = new PharmacyService(prisma);
    const all = await svc.getDurOverrides({ id: PHARM, role: UserRole.PHARMACIST });
    expect(all.items.find((i) => i.prescriptionId === RX_B)!.reason).toBeNull();
    expect(all.items.find((i) => i.prescriptionId === RX_A)!.reason).toBe('의도적 병용');
    expect(all.windowDays).toBe(30);
    expect((await svc.getDurOverrides({ id: PHARM, role: UserRole.PHARMACIST }, 9999)).windowDays).toBe(30);
  });
});

describe('역할 메타데이터 — 의사에게 여는 것은 자기 스코프 EP 뿐', () => {
  const roles = (cls: any, m: string) => Reflect.getMetadata(ROLES_KEY, cls.prototype[m]) as string[] | undefined;
  const classRoles = (cls: any) => Reflect.getMetadata(ROLES_KEY, cls) as string[];

  it('내 중재·내 대체조제는 DOCTOR·ADMIN', () => {
    expect(roles(PharmacistActivityController, 'getMyInterventions')).toEqual([UserRole.DOCTOR, UserRole.ADMIN]);
    expect(roles(PharmacyController, 'getMyPendingSubstitutions')).toEqual([UserRole.DOCTOR, UserRole.ADMIN]);
    expect(roles(PharmacyController, 'getDurOverrides')).toEqual([UserRole.PHARMACIST, UserRole.DOCTOR, UserRole.ADMIN]);
  });

  it('대조군 — 전건 중재 목록·전건 대체조제 대기는 여전히 약사·관리자(클래스 역할)', () => {
    expect(roles(PharmacistActivityController, 'getInterventions')).toBeUndefined();
    expect(classRoles(PharmacistActivityController)).not.toContain(UserRole.DOCTOR);
    expect(roles(PharmacyController, 'getPendingSubstitutions')).toBeUndefined();
    expect(classRoles(PharmacyController)).not.toContain(UserRole.DOCTOR);
  });
});
