import { describe, it, expect, vi } from 'vitest';
import { WorkstationService } from '../../src/modules/workstation/workstation.service';

/**
 * 수술 준비 워크스테이션 큐 — 2026-09-30.
 * 🔴 종전 `surgery-prep` 은 오더 부서 매핑에 없어 **구조적으로 영원히 빈 목록**이었다(수술은 orders 에 없다).
 *  · 큐 = 예정(SCHEDULED) 수술 · 어제 0시~내일 24시(KST)
 *  · 준비 상태는 이미 있는 기록에서 파생(마취전평가·동의서 정본·WHO Sign-in) — 평가가 없으면 금식은 null(false 아님)
 *  · 창 밖 예정 건·상한은 meta 로 밝힌다
 */
const NOW = new Date('2026-09-30T03:00:00Z'); // KST 12:00
function mk(opts: { surgeries?: unknown[]; consents?: unknown[]; checklists?: unknown[]; stale?: number; inWindow?: number } = {}) {
  const prisma = {
    surgery: {
      findMany: vi.fn(async () => opts.surgeries ?? []),
      count: vi.fn(async ({ where }: { where: { scheduledAt: { lt?: Date; gte?: Date } } }) => (where.scheduledAt.gte ? (opts.inWindow ?? 0) : (opts.stale ?? 0))),
    },
    consentForm: { findMany: vi.fn(async () => opts.consents ?? []) },
    surgicalChecklist: { findMany: vi.fn(async () => opts.checklists ?? []) },
    workstationConfig: { findUnique: vi.fn(async () => null) },
  };
  return { svc: new WorkstationService(prisma as never), prisma };
}
const surg = (id: string, over: Record<string, unknown> = {}) => ({
  id, status: 'SCHEDULED', scheduledAt: new Date('2026-09-30T05:00:00Z'), procedureName: `수술${id}`, procedureCode: null, bodySite: null, laterality: null,
  anesthesiaType: null, admissionId: null, patientId: 'p1', createdAt: new Date('2026-09-20'),
  patient: { id: 'p1', mrn: 'M1', familyName: '김', givenName: '환자', gender: 'M', dateOfBirth: new Date('1970-01-01') },
  surgeon: { familyName: '이', givenName: '의사' }, preAnesthesiaEvaluation: null, ...over,
});
const consent = (over: Record<string, unknown>) => ({ id: 'c', patientId: 'p1', status: 'SIGNED', signedAt: new Date('2026-09-29'), surgeryId: null, createdAt: new Date('2026-09-29'), isValid: true, revokedAt: null, supersededAt: null, expiresAt: null, ...over });

describe('수술 준비 큐 — 정본은 surgeries', () => {
  it('getQueue("surgery-prep") 가 예정 수술을 창(어제 0시~내일 24시 KST) 안에서 조회한다 — 빈 배열 고정이 아니다', async () => {
    const { svc, prisma } = mk({ surgeries: [surg('s1')] });
    const rows = await svc.getQueue('surgery-prep') as Array<{ surgeryId: string }>;
    expect(rows.map((r) => r.surgeryId)).toEqual(['s1']);
    const where = (prisma.surgery.findMany.mock.calls[0] as unknown as [{ where: { status: string; scheduledAt: { gte: Date; lt: Date } } }])[0].where;
    expect(where.status).toBe('SCHEDULED');
    const { start, end } = WorkstationService.surgeryPrepWindow(NOW);
    expect(end.getTime() - start.getTime()).toBe(3 * 86_400_000);
    expect(start.getHours()).toBe(0); // 서버 로컬(KST) 자정
  });
  it('준비 상태 파생 — 평가 없음이면 금식 null(미확인 false 와 다르다) · 동의서는 정본 규칙 · Sign-in 시각', async () => {
    const { svc } = mk({
      surgeries: [
        surg('s1'),
        surg('s2', { preAnesthesiaEvaluation: { status: 'COMPLETED', npoConfirmed: true, completedAt: new Date() } }),
        surg('s3', { preAnesthesiaEvaluation: { status: 'DRAFT', npoConfirmed: false, completedAt: null } }),
      ],
      consents: [consent({ id: 'c2', consentType: 'SURGERY', surgeryId: 's2' }), consent({ id: 'c3', consentType: 'ANESTHESIA', status: 'PENDING', signedAt: null, surgeryId: 's3' })],
      checklists: [{ surgeryId: 's2', signInCompletedAt: new Date('2026-09-30T04:00:00Z') }],
    });
    const rows = await svc.getSurgeryPrepQueue(NOW) as Array<{ surgeryId: string; pastScheduled: boolean; prep: { preAnesthesia: string; npoConfirmed: boolean | null; consent: Record<string, { state: string; matchedBy: string | null }>; signInCompletedAt: Date | null } }>;
    const by = Object.fromEntries(rows.map((r) => [r.surgeryId, r]));
    expect(by.s1.prep).toMatchObject({ preAnesthesia: 'NONE', npoConfirmed: null, signInCompletedAt: null });
    expect(by.s2.prep.preAnesthesia).toBe('COMPLETED');
    expect(by.s2.prep.npoConfirmed).toBe(true);
    expect(by.s2.prep.consent.SURGERY).toEqual({ state: 'SIGNED', matchedBy: 'SURGERY_ID' });
    expect(by.s2.prep.signInCompletedAt).toBeInstanceOf(Date);
    expect(by.s3.prep).toMatchObject({ preAnesthesia: 'DRAFT', npoConfirmed: false });
    expect(by.s3.prep.consent.ANESTHESIA.state).toBe('PENDING');
    expect(by.s3.prep.consent.TRANSFUSION.state).toBe('NONE');
    expect(by.s1.pastScheduled).toBe(false);
  });
  it('예정 시각이 지났는데 SCHEDULED 면 pastScheduled — 판정 없이 사실만', async () => {
    const { svc } = mk({ surgeries: [surg('late', { scheduledAt: new Date('2026-09-29T23:30:00Z') })] });
    const [r] = await svc.getSurgeryPrepQueue(NOW) as Array<{ pastScheduled: boolean }>;
    expect(r.pastScheduled).toBe(true);
  });
  it('meta — 창보다 오래된 예정 건 수·상한 초과를 밝힌다 · 큐가 배선됐다고 말한다', async () => {
    const m = await mk({ stale: 3, inWindow: 250 }).svc.getSurgeryPrepMeta(NOW);
    expect(m).toMatchObject({ staleScheduled: 3, total: 250, truncated: true });
    const h = await mk().svc.getStationConfigHealth('surgery-prep');
    expect(h.queueWired).toBe(true);
  });
  it('대조군 — 매핑 없는 다른 스테이션은 여전히 빈 목록(남의 오더를 주지 않는다)', async () => {
    const { svc, prisma } = mk({ surgeries: [surg('s1')] });
    expect(await svc.getQueue('post-op')).toEqual([]);
    expect(prisma.surgery.findMany).not.toHaveBeenCalled();
  });
});
