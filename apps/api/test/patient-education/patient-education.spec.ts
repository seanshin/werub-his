import { describe, it, expect, vi } from 'vitest';
import { PatientEducationService } from '../../src/modules/patient-education/patient-education.service';

/**
 * 환자 교육 기록 — 2026-09-30.
 *  · 주제·대상·내용·시각 · 이해도는 보낸 경우에만(미기록 = null — 이해함으로 두지 않는다)
 *  · 재원 중이면 그 입원에 붙인다 · 미래 시각 400 · 다른 환자의 진료 400
 *  · 지우지 않는다 — 무효 처리(기록한 사람·관리자·사유 필수 · 조건부)
 *  · 보기 = 원장 + 다른 기록의 교육(출처) · 한 출처 실패는 sourceErrors(없음으로 접지 않는다)
 */
const NOW = new Date('2026-09-30T05:00:00Z');
function mk(o: { admission?: unknown; encounter?: unknown; record?: unknown; failNursing?: boolean } = {}) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    patient: { findUnique: vi.fn(async () => ({ id: 'p1' })) },
    admission: { findFirst: vi.fn(async () => (o.admission === undefined ? { id: 'a1' } : o.admission)) },
    encounter: { findUnique: vi.fn(async () => o.encounter ?? null) },
    patientEducationRecord: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: 'r1', ...data }; }),
      findMany: vi.fn(async () => [{ id: 'r1', educatorId: 'u1', voidedById: null, educatedAt: NOW }]),
      findUnique: vi.fn(async () => o.record ?? null),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    user: { findMany: vi.fn(async () => [{ id: 'u1', familyName: '김', givenName: '간호' }]) },
    dispensingCounsel: { findMany: vi.fn(async () => [{ id: 'd1', counseledAt: new Date('2026-09-20'), counselType: 'DISCHARGE', content: '복약', pharmacist: { familyName: '박', givenName: '약사' } }]) },
    nutritionCounsel: { findMany: vi.fn(async () => []) },
    nursingNote: { findMany: vi.fn(async () => { if (o.failNursing) throw new Error('boom'); return [{ id: 'n1', recordedAt: new Date('2026-09-25'), education: '낙상 예방 설명', nurse: null }]; }) },
    dischargeSummary: { findMany: vi.fn(async () => []) },
  };
  return { svc: new PatientEducationService(prisma as never), prisma, created };
}
const dto = (over: Record<string, unknown> = {}) => ({ topic: 'FALL_PREVENTION', learner: 'GUARDIAN', content: ' 침상 난간 사용 ', educatedAt: '2026-09-30T04:30:00Z', ...over }) as never;
const code = (e: unknown) => (e as { response?: { code?: string } })?.response?.code;

describe('기록', () => {
  it('재원 중 입원에 붙고 · 내용은 다듬고 · 이해도를 보내지 않으면 null(미기록)', async () => {
    const { svc, created } = mk();
    await svc.create('p1', dto(), 'u1', NOW);
    expect(created[0]).toMatchObject({ patientId: 'p1', admissionId: 'a1', topic: 'FALL_PREVENTION', learner: 'GUARDIAN', content: '침상 난간 사용', understanding: null, followUpNeeded: null, educatorId: 'u1' });
  });
  it('대조군 — 이해도를 보내면 그대로 · 방법은 중복 제거 · 입원 없으면 admissionId null', async () => {
    const { svc, created } = mk({ admission: null });
    await svc.create('p1', dto({ understanding: 'PARTIAL', methods: ['VERBAL', 'VERBAL', 'PRINTED'] }), 'u1', NOW);
    expect(created[0]).toMatchObject({ understanding: 'PARTIAL', methods: ['VERBAL', 'PRINTED'], admissionId: null });
  });
  it('빈 내용·미래 시각·다른 환자의 진료는 400 — 기록을 만들지 않는다', async () => {
    const a = mk();
    await expect(a.svc.create('p1', dto({ content: '   ' }), 'u1', NOW)).rejects.toSatisfy((e) => code(e) === 'EDUCATION_CONTENT_REQUIRED');
    await expect(a.svc.create('p1', dto({ educatedAt: '2026-09-30T06:00:00Z' }), 'u1', NOW)).rejects.toSatisfy((e) => code(e) === 'EDUCATION_TIME_FUTURE');
    const b = mk({ encounter: { patientId: 'other' } });
    await expect(b.svc.create('p1', dto({ encounterId: '11111111-1111-4111-8111-111111111111' }), 'u1', NOW)).rejects.toSatisfy((e) => code(e) === 'EDUCATION_ENCOUNTER_MISMATCH');
    expect(a.created).toHaveLength(0);
    expect(b.created).toHaveLength(0);
  });
});

describe('무효 처리 — 지우지 않는다', () => {
  const rec = { id: 'r1', patientId: 'p1', educatorId: 'u1', voidedAt: null };
  it('기록한 사람은 사유와 함께 무효 처리(조건부 갱신)', async () => {
    const { svc, prisma } = mk({ record: rec });
    await svc.void('p1', 'r1', 'u1', 'NURSE', ' 다른 환자 ');
    expect(prisma.patientEducationRecord.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'r1', voidedAt: null }, data: { voidedById: 'u1', voidReason: '다른 환자' } });
  });
  it('남의 기록은 403(관리자 제외) · 사유 없으면 400 · 다른 환자의 기록 id 는 404 · 이미 무효면 그대로', async () => {
    await expect(mk({ record: rec }).svc.void('p1', 'r1', 'u2', 'NURSE', 'x')).rejects.toSatisfy((e) => code(e) === 'EDUCATION_VOID_NOT_ALLOWED');
    await expect(mk({ record: rec }).svc.void('p1', 'r1', 'u2', 'ADMIN', 'x')).resolves.toBeTruthy();
    await expect(mk({ record: rec }).svc.void('p1', 'r1', 'u1', 'NURSE', '  ')).rejects.toSatisfy((e) => code(e) === 'EDUCATION_VOID_REASON_REQUIRED');
    await expect(mk({ record: rec }).svc.void('p9', 'r1', 'u1', 'NURSE', 'x')).rejects.toThrow('not found');
    const done = mk({ record: { ...rec, voidedAt: new Date() } });
    expect((await done.svc.void('p1', 'r1', 'u1', 'NURSE', 'x')).alreadyVoided).toBe(true);
    expect(done.prisma.patientEducationRecord.updateMany).not.toHaveBeenCalled();
  });
});

describe('보기 — 원장 + 다른 기록의 교육', () => {
  it('출처별로 모으고 최신순 · 교육자 이름', async () => {
    const r = await mk().svc.list('p1');
    expect(r.records[0].educatorName).toBe('김간호');
    expect(r.related.map((x) => x.source)).toEqual(['NURSING_NOTE', 'PHARMACY_COUNSEL']);
    expect(r.sourceErrors).toEqual([]);
  });
  it('🔴 한 출처가 실패하면 sourceErrors 로 말한다 — 나머지는 보인다(실패를 없음으로 접지 않는다)', async () => {
    const r = await mk({ failNursing: true }).svc.list('p1');
    expect(r.sourceErrors.map((e) => e.source)).toEqual(['NURSING_NOTE']);
    expect(r.related.map((x) => x.source)).toEqual(['PHARMACY_COUNSEL']);
  });
});

describe('퇴원 준비 — 교육 기록 원장을 센다', () => {
  it('기록이 있으면 RECORDS · 요약 글자뿐이면 SUMMARY_TEXT · 둘 다 없으면 null', async () => {
    const { InpatientService } = await import('../../src/modules/inpatient/inpatient.service');
    const run = async (n: number, text: string | null) => {
      const prisma = {
        admission: { findUnique: vi.fn(async () => ({ id: 'a1', status: 'ADMITTED', expectedDischargeDate: null })) },
        dischargeSummary: { findUnique: vi.fn(async () => ({ status: 'SIGNED', signedAt: new Date(), followUpDate: null, dischargeMedications: null, patientEducation: text })) },
        order: { count: vi.fn(async () => 0) },
        prescription: { findMany: vi.fn(async () => []) },
        patientEducationRecord: { count: vi.fn(async () => n) },
      };
      const svc = Object.create(InpatientService.prototype) as Record<string, unknown>;
      svc.prisma = prisma; svc.logger = { error: vi.fn() };
      svc.getDischargeSettlement = vi.fn(async () => ({ data: { balanceDue: 0 } }));
      const r = await (svc as unknown as { getDischargeReadiness: (id: string) => Promise<Record<string, any>> }).getDischargeReadiness('a1');
      return { r, where: prisma.patientEducationRecord.count.mock.calls[0][0] };
    };
    const a = await run(2, null);
    expect(a.r.education).toEqual({ records: 2, summaryText: false, source: 'RECORDS' });
    expect(a.r.educationDone).toBe(true);
    expect(a.where).toEqual({ where: { admissionId: 'a1', voidedAt: null } });
    expect((await run(0, '설명함')).r.education.source).toBe('SUMMARY_TEXT');
    const c = await run(0, null);
    expect(c.r.education.source).toBeNull();
    expect(c.r.educationDone).toBe(false);
  });
});
