import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SurgeryService } from '../../src/modules/surgery/surgery.service';
import { CreateSurgeryDto } from '../../src/modules/surgery/dto/surgery.dto';

/**
 * 🔴 수술 예약 '보조 의사' 저장 경로 가드 — 2026-08-18.
 *
 * 종전 동작: 컬럼(`Surgery.assistantId` uuid)은 있는데 **설정 경로가 어디에도 없었다.**
 * 화면은 자유 텍스트로 "보조 의사 이름"을 받아 아무 데도 보내지 않았고(운영 실측 assistantId 14/14 null),
 * 그 값을 읽는 수술 프로토콜 단계 알림(`protocol.service.afterTransition` — DOCTOR 수신자에 assistantId 포함)은
 * 개통 이래 보조의에게 **한 번도 가지 않았다.**
 *
 * 규약:
 *  - 보조의는 **고르는 것**이지 적는 것이 아니다 — 이름 문자열은 uuid 칸에 들어갈 수 없다(400 으로 거절).
 *  - 스키마에 FK 가 없으므로(관계 미선언) **서버가 실재·직군·재직을 확인한다** — 모르는 사람을 원장에 박지 않는다.
 *  - 집도의와 같은 사람은 보조의가 될 수 없다.
 */
describe('수술 예약 — 보조 의사(assistantId)', () => {
  let service: SurgeryService;
  let mockPrisma: any;

  const DOCTOR = { id: '11111111-1111-4111-8111-111111111111', role: 'DOCTOR', isActive: true };
  const SURGEON_ID = '22222222-2222-4222-8222-222222222222';
  const base = {
    patientId: 'pat-1',
    surgeonId: SURGEON_ID,
    scheduledAt: '2026-09-01T09:00:00.000Z',
    procedureName: '충수절제술',
  };

  beforeEach(() => {
    mockPrisma = {
      user: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      surgery: { create: vi.fn().mockResolvedValue({ id: 'surg-1', status: 'SCHEDULED' }), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
      orSchedule: { findMany: vi.fn().mockResolvedValue([]) },
    };
    service = new SurgeryService(mockPrisma, { assertChecklistReadyForStart: vi.fn(), assertChecklistReadyForClose: vi.fn() } as any);
  });

  it('🔴 고른 보조의가 실제로 저장된다 — 배선을 되돌리면 실패한다', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(DOCTOR);

    await service.schedule({ ...base, assistantId: DOCTOR.id });

    expect(mockPrisma.surgery.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assistantId: DOCTOR.id }) }),
    );
  });

  it('🔴 집도의를 자기 수술의 보조의로 지정할 수 없다', async () => {
    // 🔴 집도의 계정은 **실재하는 의사**다 — 여기서 존재검증에 걸려 통과하면 가드가 아무것도 보증하지 않는다.
    //    (동일인 검사를 지워도 '없는 계정' 오류로 떨어져 단언이 통과하던 것을 재주입으로 확인하고 조였다)
    mockPrisma.user.findUnique.mockResolvedValue({ id: SURGEON_ID, role: 'DOCTOR', isActive: true });

    await expect(service.schedule({ ...base, assistantId: SURGEON_ID })).rejects.toMatchObject({
      response: { code: 'ASSISTANT_SAME_AS_SURGEON' },
    });
    expect(mockPrisma.surgery.create).not.toHaveBeenCalled();
  });

  it('🔴 존재하지 않는 계정은 저장하지 않는다(스키마에 FK 가 없어 서버가 마지막 방어선이다)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.schedule({ ...base, assistantId: DOCTOR.id })).rejects.toMatchObject({
      response: { code: 'ASSISTANT_NOT_FOUND' },
    });
    expect(mockPrisma.surgery.create).not.toHaveBeenCalled();
  });

  it('🔴 의사 아닌 계정(간호사 등)은 보조의가 될 수 없다', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...DOCTOR, role: 'NURSE' });
    await expect(service.schedule({ ...base, assistantId: DOCTOR.id })).rejects.toMatchObject({
      response: { code: 'ASSISTANT_NOT_DOCTOR' },
    });
    expect(mockPrisma.surgery.create).not.toHaveBeenCalled();
  });

  it('🔴 퇴직(비활성) 계정은 보조의가 될 수 없다', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...DOCTOR, isActive: false });
    await expect(service.schedule({ ...base, assistantId: DOCTOR.id })).rejects.toMatchObject({
      response: { code: 'ASSISTANT_INACTIVE' },
    });
    expect(mockPrisma.surgery.create).not.toHaveBeenCalled();
  });

  it('지정하지 않으면 조회하지 않고 그대로 예약된다(선택 항목)', async () => {
    await service.schedule(base);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.surgery.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assistantId: undefined }) }),
    );
  });

  it('🔴 저장한 보조의를 읽는 경로가 있다 — 목록이 이름을 되읽어 준다(관계가 없어 수동 조인)', async () => {
    mockPrisma.surgery.findMany.mockResolvedValue([
      { id: 'surg-1', assistantId: DOCTOR.id, scheduledAt: new Date(), status: 'SCHEDULED' },
    ]);
    mockPrisma.user.findMany.mockResolvedValue([
      { id: DOCTOR.id, familyName: '김', givenName: '보조', department: '외과' },
    ]);

    const rows = await service.getSchedule();
    expect(rows[0]).toMatchObject({ assistant: { id: DOCTOR.id, familyName: '김', givenName: '보조' } });
  });

  it('보조의 계정을 찾지 못하면 이름을 지어내지 않고 null 이다', async () => {
    mockPrisma.surgery.findMany.mockResolvedValue([
      { id: 'surg-1', assistantId: DOCTOR.id, scheduledAt: new Date(), status: 'SCHEDULED' },
    ]);
    mockPrisma.user.findMany.mockResolvedValue([]);

    const rows = await service.getSchedule();
    expect((rows[0] as { assistant: unknown }).assistant).toBeNull();
  });

  it('🔴 예상 소요시간은 배정(OrSchedule)에서만 나온다 — 목록이 그 값을 실어 준다', async () => {
    mockPrisma.surgery.findMany.mockResolvedValue([{ id: 'surg-1', scheduledAt: new Date(), status: 'SCHEDULED' }]);
    mockPrisma.orSchedule.findMany.mockResolvedValue([
      { surgeryId: 'surg-1', startTime: '09:00', endTime: '11:00', estimatedDuration: 120, room: { name: 'OR-1' } },
    ]);

    const rows = await service.getSchedule();
    expect(rows[0]).toMatchObject({ orRoom: { name: 'OR-1', estimatedDuration: 120 } });
  });
});

describe('CreateSurgeryDto — 보조의는 계정 id 다', () => {
  const valid = {
    patientId: '33333333-3333-4333-8333-333333333333',
    surgeonId: '22222222-2222-4222-8222-222222222222',
    scheduledAt: '2026-09-01T09:00:00.000Z',
    procedureName: '충수절제술',
  };

  it('🔴 자유 텍스트 이름은 거절된다 — 이름을 uuid 칸에 밀어 넣으면 그 순간 원장이 거짓이 된다', async () => {
    const dto = plainToInstance(CreateSurgeryDto, { ...valid, assistantId: '김보조' });
    const errors = await validate(dto, { whitelist: true });
    expect(errors.map((e) => e.property)).toContain('assistantId');
  });

  it('계정 id 는 통과하고 whitelist 에서 살아남는다(조용히 버려지지 않는다)', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const dto = plainToInstance(CreateSurgeryDto, { ...valid, assistantId: id });
    const errors = await validate(dto, { whitelist: true });
    expect(errors).toHaveLength(0);
    expect((dto as CreateSurgeryDto).assistantId).toBe(id);
  });
});

/**
 * 🔴 코디네이터 회수분(2026-08-18) — **체크리스트 항목 정의가 두 곳에 산다.**
 *
 * 서버 `CHECKLIST_ITEMS`(정의 정본)와 `UpdateSurgicalChecklistDto`(수신 허용 목록)가 별개라,
 * 서버가 항목을 하나 추가하면 DTO 에 없어 **whitelist 가 조용히 지운다** — 화면은 체크했는데
 * 저장은 안 되고 성공을 표시한다(오늘 이 경로에서 이미 한 번 겪었다: `@Body` 부재로 17개 전량 유실).
 * 두 목록을 기계로 대조한다.
 */
describe('수술안전 체크리스트 — 정의와 수신 목록이 갈라지지 않는다', () => {
  const SVC = readFileSync(
    join(process.cwd(), 'src/modules/surgery/surgery-advanced.service.ts'), 'utf-8',
  );
  const DTO = readFileSync(
    join(process.cwd(), 'src/modules/surgery/dto/surgery-advanced.dto.ts'), 'utf-8',
  );

  /** `CHECKLIST_ITEMS` 블록에서 `key: '…'` 를 뽑는다 */
  function serverKeys(): string[] {
    const start = SVC.indexOf('CHECKLIST_ITEMS');
    const end = SVC.indexOf('\n  };', start);
    return [...SVC.slice(start, end).matchAll(/key:\s*'([^']+)'/g)].map((m) => m[1]);
  }

  /** DTO 에서 boolean 필드 이름을 뽑는다(주석 제외) */
  function dtoKeys(): string[] {
    const start = DTO.indexOf('class UpdateSurgicalChecklistDto');
    const end = DTO.indexOf('\n}', start);
    const body = DTO.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    return [...body.matchAll(/@IsBoolean\(\)\s+([a-zA-Z][a-zA-Z0-9]*)\?:/g)].map((m) => m[1]);
  }

  it('서버가 정의한 항목을 DTO 가 전부 받는다 — 빠지면 그 체크는 조용히 사라진다', () => {
    const missing = serverKeys().filter((k) => !dtoKeys().includes(k));
    expect(missing, `DTO 가 받지 못하는 체크 항목: ${missing.join(', ')}`).toEqual([]);
  });

  it('🔴 오부위수술 방지 항목이 양쪽에 있다', () => {
    for (const k of ['procedure', 'site', 'siteMarked']) {
      expect(serverKeys(), `서버 정의에 ${k} 가 없다`).toContain(k);
      expect(dtoKeys(), `DTO 가 ${k} 를 받지 못한다`).toContain(k);
    }
  });
});
