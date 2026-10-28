import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NursingService } from '../../src/modules/nursing/nursing.service';
import { BadRequestException } from '@nestjs/common';

/**
 * 간호중재 이행 기록 가드 (계획서 1단계 1-7 "계획만 있고 이행이 없다").
 *
 * 🔴 종전에는 `status` 만 바꿨다 — "COMPLETED" 여도 **누가 언제 했는지 알 수 없었다.**
 *    낙상 예방 중재처럼 그 자체가 안전 지표의 분자인 항목이 원장에서 증명되지 않았다.
 */
describe('간호중재 — 이행은 상태가 아니라 기록이다', () => {
  let service: NursingService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      nursingIntervention: {
        findUnique: vi.fn().mockResolvedValue({ performedAt: null }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    service = new NursingService(prisma as any, undefined, undefined, undefined);
  });

  const data = () => prisma.nursingIntervention.update.mock.calls[0][0].data;

  it('COMPLETED 로 옮기면 수행자·수행시각을 함께 적는다', async () => {
    await service.updateIntervention('iv-1', 'COMPLETED', 'nurse-1');

    expect(data().status).toBe('COMPLETED');
    expect(data().performedBy).toBe('nurse-1');
    expect(data().performedAt).toBeInstanceOf(Date);
  });

  it('🔴 수행자를 모르면 이행으로 적지 않는다 — 모르는 것을 원장에 박지 않는다', async () => {
    await expect(service.updateIntervention('iv-1', 'COMPLETED')).rejects.toThrow(BadRequestException);
    expect(prisma.nursingIntervention.update).not.toHaveBeenCalled();
  });

  it('되돌릴 때 수행 기록을 지우지 않는다 — 했던 사실은 사실이다', async () => {
    prisma.nursingIntervention.findUnique.mockResolvedValue({ performedAt: new Date('2026-08-19T01:00:00Z') });

    await service.updateIntervention('iv-1', 'PLANNED', 'nurse-1');

    expect(data().status).toBe('PLANNED');
    expect(data().performedBy).toBeUndefined();
    expect(data().performedAt).toBeUndefined();
  });

  it('이미 이행된 중재를 다시 COMPLETED 로 해도 시각을 덮어쓰지 않는다', async () => {
    const first = new Date('2026-08-19T01:00:00Z');
    prisma.nursingIntervention.findUnique.mockResolvedValue({ performedAt: first });

    await service.updateIntervention('iv-1', 'COMPLETED', 'nurse-2');

    expect(data().performedAt).toBeUndefined();
  });

  it('잘못된 상태는 거부한다', async () => {
    await expect(service.updateIntervention('iv-1', 'DONE', 'nurse-1')).rejects.toThrow(BadRequestException);
  });
});
