import { describe, it, expect, vi } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { VerbalCosignService } from '../../src/modules/prescription/verbal-cosign.service';
import { AddProgressNoteDto } from '../../src/modules/inpatient/dto/inpatient.dto';
import { InpatientService } from '../../src/modules/inpatient/inpatient.service';

/**
 * 구두·전화 처방 처방의 사후 확인 + 입원 초진기록(H&P) 구분 — 2026-09-30 의사 업무 점검.
 * 🔴 복창은 받은 간호사의 확인이고, 낸 의사가 확인할 칸·목록이 없었다(스키마 신설: prescriber_cosigned_at/by).
 */
type Rx = { id: string; orderSource: string; prescriberId: string | null; createdBy: string; prescriberCosignedAt: Date | null; prescriberCosignedBy: string | null };
const mk = (rx: Rx | null, updateCount = 1) => {
  const prisma = {
    prescription: {
      findUnique: vi.fn(async () => rx),
      updateMany: vi.fn(async () => ({ count: updateCount })),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
  };
  return { svc: new VerbalCosignService(prisma as never), prisma };
};
const code = (e: unknown) => (e as { response?: { code?: string } })?.response?.code;
const base: Rx = { id: 'r1', orderSource: 'TELEPHONE', prescriberId: 'doc', createdBy: 'nurse', prescriberCosignedAt: null, prescriberCosignedBy: null };

describe('처방의 사후 확인', () => {
  it('책임 처방의 본인이 확인 → 시각·확인자가 남는다(한 번만 — 미확인 조건부 갱신)', async () => {
    const { svc, prisma } = mk(base);
    const r = await svc.cosign('r1', 'doc');
    expect(r.alreadyCosigned).toBe(false);
    expect(prisma.prescription.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'r1', prescriberCosignedAt: null }, data: { prescriberCosignedBy: 'doc' } });
  });
  it('🔴 다른 의사·받아 적은 간호사는 확인할 수 없다', async () => {
    await expect(mk(base).svc.cosign('r1', 'other-doc')).rejects.toSatisfy((e) => code(e) === 'NOT_RESPONSIBLE_PRESCRIBER');
    await expect(mk(base).svc.cosign('r1', 'nurse')).rejects.toSatisfy((e) => code(e) === 'NOT_RESPONSIBLE_PRESCRIBER');
  });
  it('지정 처방의가 없으면 입력자가 책임 처방의(원장 정의)', async () => {
    const { svc } = mk({ ...base, prescriberId: null, createdBy: 'doc2' });
    await expect(svc.cosign('r1', 'doc2')).resolves.toMatchObject({ alreadyCosigned: false });
  });
  it('서면 처방은 사후 확인 대상이 아니다', async () => {
    await expect(mk({ ...base, orderSource: 'WRITTEN' }).svc.cosign('r1', 'doc')).rejects.toSatisfy((e) => code(e) === 'NOT_VERBAL_ORDER');
  });
  it('이미 확인된 것은 덮지 않는다 · 동시 확인에 지면 먼저 남은 기록을 돌려준다', async () => {
    const at = new Date('2026-09-30T00:00:00Z');
    const a = mk({ ...base, prescriberCosignedAt: at, prescriberCosignedBy: 'doc' });
    await expect(a.svc.cosign('r1', 'doc')).resolves.toMatchObject({ alreadyCosigned: true, cosignedAt: at });
    expect(a.prisma.prescription.updateMany).not.toHaveBeenCalled();
    const b = mk(base, 0);
    await expect(b.svc.cosign('r1', 'doc')).resolves.toMatchObject({ alreadyCosigned: true });
  });
  it('대기 목록은 내가 책임 처방의인 구두·전화·미확인·미취소만', async () => {
    const { svc, prisma } = mk(null);
    await svc.listPending('doc');
    const where = (prisma.prescription.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ orderSource: { in: ['VERBAL', 'TELEPHONE'] }, prescriberCosignedAt: null, status: { not: 'CANCELLED' } });
    expect(where.OR).toEqual([{ prescriberId: 'doc' }, { prescriberId: null, createdBy: 'doc' }]);
  });
});

describe('입원 초진기록(H&P) 구분', () => {
  it('noteType 은 PROGRESS·ADMISSION 만 · 생략하면 경과기록', async () => {
    expect(await validate(plainToInstance(AddProgressNoteDto, { content: 'x', noteType: 'ADMISSION' }))).toHaveLength(0);
    expect((await validate(plainToInstance(AddProgressNoteDto, { content: 'x', noteType: 'DISCHARGE' }))).length).toBeGreaterThan(0);
    const create = vi.fn(async (a: unknown) => a);
    const svc = Object.create(InpatientService.prototype) as InpatientService;
    (svc as unknown as { prisma: unknown }).prisma = { progressNote: { create } };
    await svc.addProgressNote('adm', 'doc', { content: 'x' });
    await svc.addProgressNote('adm', 'doc', { content: 'y', noteType: 'ADMISSION' });
    // 생략하면 코드는 값을 넣지 않는다 → DB 컬럼 기본값(PROGRESS)이 정본
    expect((create.mock.calls[0][0] as { data: { noteType?: string } }).data.noteType).toBeUndefined();
    expect((create.mock.calls[1][0] as { data: { noteType: string } }).data.noteType).toBe('ADMISSION');
  });
});
