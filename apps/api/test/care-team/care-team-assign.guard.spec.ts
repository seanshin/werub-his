import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { CareTeamService } from '../../src/modules/care-team/care-team.service';
import { HrService } from '../../src/modules/hr/hr.service';

/**
 * 가드 — 화면 실사용 점검 W8 (2026-08-14)
 *
 * 🔴 원 결함(S1): 의료팀 편성 화면이 통째로 죽어 있었다.
 *    ① `/hr/staff` 응답에 `role` 이 없어(Staff 에는 category/position 뿐) 화면의
 *       `s.role === 'DOCTOR'` 필터가 항상 0건 → 드롭다운이 영구히 비었다.
 *    ② 고쳐서 staff.id 를 넘겨도 CareTeam.doctorId/nurseId 는 **users.id** 라 FK 위반(P2003 → 500).
 *       두 테이블을 잇는 키는 Staff.userId(1:1 unique) 하나뿐 — 실측 90/90 연결됨.
 *    ③ 수정 시 서비스가 doctorId/nurseId 를 **읽지도 않아** 담당자가 안 바뀌는데 화면은
 *       모달을 닫으며 성공한 얼굴을 했다(조용한 성공).
 */
describe('CareTeam — 담당자 지정 (W8 가드)', () => {
  let service: CareTeamService;
  let p: any;

  const USERS: Record<string, { id: string; role: string; isActive: boolean }> = {
    'u-doc': { id: 'u-doc', role: 'DOCTOR', isActive: true },
    'u-doc2': { id: 'u-doc2', role: 'DOCTOR', isActive: true },
    'u-nurse': { id: 'u-nurse', role: 'NURSE', isActive: true },
    'u-doc-off': { id: 'u-doc-off', role: 'DOCTOR', isActive: false },
  };

  beforeEach(() => {
    p = {
      careTeam: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({ id: 'ct-1', doctorId: 'u-doc', nurseId: 'u-nurse' }),
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'ct-1', ...data })),
        update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'ct-1', ...data })),
      },
      user: { findUnique: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(USERS[where.id] ?? null)) },
    };
    service = new CareTeamService(p);
  });

  it('담당자 변경이 실제로 저장된다 — 조용한 성공 금지', async () => {
    await service.update('ct-1', { doctorId: 'u-doc2' } as any);
    expect(p.careTeam.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ doctorId: 'u-doc2' }) }),
    );
  });

  it('staff.id 처럼 users 에 없는 키를 넘기면 저장이 실패한다 — 성공으로 보고하지 않는다', async () => {
    await expect(
      service.create({ doctorId: 'staff-uuid', nurseId: 'u-nurse', departmentName: '내과' } as any),
    ).rejects.toThrow(BadRequestException);
    expect(p.careTeam.create).not.toHaveBeenCalled();

    await expect(service.update('ct-1', { doctorId: 'staff-uuid' } as any)).rejects.toThrow(BadRequestException);
    expect(p.careTeam.update).not.toHaveBeenCalled();
  });

  it('역할이 맞지 않는 계정은 담당 의사가 될 수 없다', async () => {
    await expect(
      service.create({ doctorId: 'u-nurse', nurseId: 'u-nurse', departmentName: '내과' } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('비활성 계정은 담당자로 지정할 수 없다', async () => {
    await expect(
      service.create({ doctorId: 'u-doc-off', nurseId: 'u-nurse', departmentName: '내과' } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('중복 편성은 P2002 코드로도 409 로 잡힌다(메시지 문구에 의존하지 않는다)', async () => {
    p.careTeam.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(
      service.create({ doctorId: 'u-doc', nurseId: 'u-nurse', departmentName: '내과' } as any),
    ).rejects.toThrow(ConflictException);
  });
});

/**
 * 🔴 /hr/staff 가 화면이 필요로 하는 두 가지 — 계정 역할(role)과 계정 키(userId) — 를 실어야
 *    드롭다운이 채워진다. 여기가 비면 의료팀 편성 화면은 다시 통째로 죽는다.
 */
describe('HR staff 목록 — 계정 역할/키 노출 (W8 가드)', () => {
  it('연결된 users.role 을 실어 보내고, 계정 없는 직원은 role=null 로 정직하게 말한다', async () => {
    const prisma: any = {
      staff: {
        findMany: vi.fn().mockResolvedValue([
          { id: 's-1', userId: 'u-doc', familyName: '김', givenName: '의사', department: '내과' },
          { id: 's-2', userId: null, familyName: '박', givenName: '무계정', department: '원무과' },
        ]),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'u-doc', role: 'DOCTOR', isActive: true }]),
      },
    };
    const svc = new HrService(prisma, { enqueue: vi.fn() } as any);

    const rows: any[] = await svc.findAll({});

    expect(rows[0].userId).toBe('u-doc');
    expect(rows[0].role).toBe('DOCTOR');
    expect(rows[0].userActive).toBe(true);
    // 계정이 없으면 추정하지 않는다
    expect(rows[1].role).toBeNull();
  });
});
