import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { StaffQualificationService } from '../../src/modules/staff-qualification/staff-qualification.service';

/**
 * 🔴 외부 점검 — 이수 기록의 Idempotency-Key 에 **과정명이 빠진 채** 오는 것이 관측됐다
 * (`userId::완료시각` 모양). 같은 순간에 끝난 **다른 과정**이 그 키로 오면, 종전 코드는
 * "이미 있다"며 **앞 기록을 돌려주고 새 기록을 만들지 않았다** — 교육 이수는 법정 근거가 되는 기록이라
 * 한 건이 조용히 사라지는 것이 가장 나쁘다.
 *
 * 지킨다: 같은 키 + 다른 내용 = **409 로 말한다**(삼키지 않는다). 같은 키 + 같은 내용 = 종전대로 멱등.
 *
 * 🔴 2026-09-23 — **실패 경로(동시 재전송 폴백)도 같은 대조를 지난다.** 1순위 조회에서 못 본 행이
 * `create` 유니크 위반 뒤 catch 에서 다시 조회되는데, 종전 폴백은 대조 없이 그 행을 돌려줬다 —
 * 1순위에서 막은 결함이 레이스에서 되살아나는 자리다.
 */
describe('🔴 이수 기록 멱등키 — 다른 내용을 같은 키로 삼키지 않는다', () => {
  let service: StaffQualificationService;
  let prisma: any;

  const stored = {
    id: 'edu-1',
    userId: 'u-1',
    courseName: '감염관리 기본과정',
    category: 'INFECTION',
    completedAt: new Date('2026-09-14T01:00:00Z'),
  };

  beforeEach(() => {
    prisma = {
      staffEducation: {
        findUnique: vi.fn().mockResolvedValue(stored),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }: any) => ({ id: 'edu-2', ...data })),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'u-1' }) },
    };
    service = new StaffQualificationService(prisma, { enqueue: vi.fn() } as any);
  });

  it('같은 키 · 같은 내용 — 종전대로 멱등(새로 만들지 않는다)', async () => {
    const res = await service.recordEducationIdempotent({
      userId: 'u-1', courseName: stored.courseName, category: stored.category,
      completedAt: '2026-09-14T01:00:00Z', idempotencyKey: 'u-1::2026-09-14T01:00:00Z',
    });
    expect(res.idempotent).toBe(true);
    expect(prisma.staffEducation.create).not.toHaveBeenCalled();
  });

  it('🔴 같은 키 · 다른 과정 — 삼키지 않고 409 로 말한다', async () => {
    await expect(
      service.recordEducationIdempotent({
        userId: 'u-1', courseName: '환자안전 보수교육', category: 'SAFETY',
        completedAt: '2026-09-14T01:00:00Z', idempotencyKey: 'u-1::2026-09-14T01:00:00Z',
      }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.staffEducation.create, '충돌인데 새 기록을 만들었다').not.toHaveBeenCalled();
  });

  it('대조군 — 키가 없으면 자연키(과정명 포함)로 판정한다(과정명이 다르면 새 기록)', async () => {
    const res = await service.recordEducationIdempotent({
      userId: 'u-1', courseName: '환자안전 보수교육', category: 'SAFETY', completedAt: '2026-09-14T01:00:00Z',
    });
    expect(res.idempotent).toBe(false);
    expect(prisma.staffEducation.create).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 동시 재전송 폴백(유니크 위반 뒤 재조회)도 같은 대조를 지난다(2026-09-23)', () => {
  let service: StaffQualificationService;
  let prisma: any;
  const stored = { id: 'edu-1', userId: 'u-1', courseName: '감염관리 기본과정', category: 'INFECTION', completedAt: new Date('2026-09-14T01:00:00Z') };
  const uniqueViolation = Object.assign(new Error('Unique constraint failed on the fields: (`idempotency_key`)'), { code: 'P2002' });

  beforeEach(() => {
    prisma = {
      staffEducation: {
        // 1순위 조회 때는 아직 없고(레이스), create 가 유니크 위반으로 죽은 뒤 재조회에서 나타난다
        findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValue(stored),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockRejectedValue(uniqueViolation),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'u-1' }) },
    };
    service = new StaffQualificationService(prisma, { enqueue: vi.fn() } as any);
  });

  it('🔴 폴백에서 찾은 행이 **다른 과정**이면 돌려주지 않고 409(IDEMPOTENCY_KEY_REUSED)로 말한다', async () => {
    const p = service.recordEducationIdempotent({
      userId: 'u-1', courseName: '환자안전 보수교육', category: 'SAFETY',
      completedAt: '2026-09-14T01:00:00Z', idempotencyKey: 'u-1::2026-09-14T01:00:00Z',
    });
    await expect(p).rejects.toThrow(ConflictException);
    await p.catch((e: ConflictException) => {
      expect((e.getResponse() as { error?: string }).error).toBe('IDEMPOTENCY_KEY_REUSED');
    });
    // 주입 확인 — 폴백 경로를 실제로 지났다(1순위 null → create 위반 → 재조회)
    expect(prisma.staffEducation.create).toHaveBeenCalledTimes(1);
    expect(prisma.staffEducation.findUnique).toHaveBeenCalledTimes(2);
  });

  it('대조군 — 폴백에서 찾은 행이 **같은 내용**이면 종전대로 멱등으로 돌려준다', async () => {
    const res = await service.recordEducationIdempotent({
      userId: 'u-1', courseName: stored.courseName, category: stored.category,
      completedAt: '2026-09-14T01:00:00Z', idempotencyKey: 'u-1::2026-09-14T01:00:00Z',
    });
    expect(res).toEqual({ record: stored, idempotent: true });
    expect(prisma.staffEducation.findUnique).toHaveBeenCalledTimes(2);
  });

  it('대조군 — 폴백 재조회에도 행이 없으면(키 없는 유니크 위반 등) 원래 예외를 그대로 던진다(삼키지 않는다)', async () => {
    prisma.staffEducation.findUnique = vi.fn().mockResolvedValue(null);
    await expect(
      service.recordEducationIdempotent({
        userId: 'u-1', courseName: stored.courseName, category: stored.category,
        completedAt: '2026-09-14T01:00:00Z', idempotencyKey: 'u-1::2026-09-14T01:00:00Z',
      }),
    ).rejects.toBe(uniqueViolation);
  });
});
