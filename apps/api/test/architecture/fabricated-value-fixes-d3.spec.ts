import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentSessionService } from '../../src/modules/agent-session/agent-session.service';
import { EmergencyService, AUTO_CLOSE_NO_DISPOSITION_NOTE } from '../../src/modules/emergency/emergency.service';
import { CodeMasterService } from '../../src/modules/code-master/code-master.service';
import { EquipmentService } from '../../src/modules/equipment/equipment.service';
import { TelehealthService } from '../../src/modules/telehealth/telehealth.service';
import { BlockchainCertService } from '../../src/modules/blockchain-cert/blockchain-cert.service';
import { ObGynService, MOTHER_BABY_CHECK_TYPE } from '../../src/modules/obgyn/obgyn.service';

/**
 * D3 — **저장되는 값을 지어내던 자리**의 동작 확인(2026-09-15).
 * 건마다 "진짜 값은 그대로 저장된다"는 대조군을 둔다 — 지어내지 않는 것과 못 쓰는 것은 다르다.
 */
describe('D3 · 채팅 접수가 성별·작성자를 지어내지 않는다', () => {
  const baseCtx = {
    patient: { familyName: '홍', givenName: '길동', birthDate: '1990-01-01', phone: '010-1111-2222', address: '가상시 1로' },
    reception: {},
  };
  const makeSvc = (prisma: any) =>
    new AgentSessionService(prisma as any, { } as any, { } as any, { } as any, { } as any);

  const prismaWith = (operatorId: string | null) => {
    const patientCreate = vi.fn(async () => ({ id: 'p-new', mrn: 'HR-1', familyName: '홍', givenName: '길동' }));
    return {
      patientCreate,
      prisma: {
        agentSession: {
          findUnique: vi.fn(async () => ({
            // HIS_RECEPTION 채널은 LLM-first 경로를 건너뛴다(원무 데스크 — 서비스 규약)
            id: 's1', state: 'COLLECTING_PATIENT_INFO', operatorId, channel: 'HIS_RECEPTION',
            context: JSON.parse(JSON.stringify(baseCtx)), messages: [],
          })),
          update: vi.fn(async () => ({})),
        },
        patient: { create: patientCreate, findMany: vi.fn(async () => []) },
        allergy: { findMany: vi.fn(async () => []) },
      },
    };
  };

  it('🔴 담당자 없는(공개) 세션은 환자를 등록하지 않는다 — 작성자를 지어낼 수 없기 때문', async () => {
    const { prisma, patientCreate } = prismaWith(null);
    const svc = makeSvc(prisma);
    const r = await svc.processMessage('s1', '19900101 010-1111-2222');
    expect(patientCreate).not.toHaveBeenCalled();
    expect(r.response).toContain('접수 창구');
  });

  it('대조군 — 담당자가 있으면 등록하고, 작성자는 그 담당자다(고정 UUID 아님)', async () => {
    const { prisma, patientCreate } = prismaWith('op-1');
    const svc = makeSvc(prisma);
    await svc.processMessage('s1', '19900101 010-1111-2222');
    expect(patientCreate).toHaveBeenCalledTimes(1);
    const data = patientCreate.mock.calls[0][0].data;
    expect(data.createdBy).toBe('op-1');
    expect(data.updatedBy).toBe('op-1');
  });

  it('🔴 성별을 모르면 UNKNOWN 으로 남긴다(종전 기본값 MALE)', async () => {
    const { prisma, patientCreate } = prismaWith('op-1');
    await makeSvc(prisma).processMessage('s1', '19900101 010-1111-2222');
    expect(patientCreate.mock.calls[0][0].data.gender).toBe('UNKNOWN');
  });

  it('대조군 — 성별을 들었으면 그대로 저장한다', async () => {
    const { prisma, patientCreate } = prismaWith('op-1');
    const session = prisma.agentSession.findUnique as any;
    const ctx = JSON.parse(JSON.stringify(baseCtx));
    ctx.patient.gender = 'FEMALE';
    session.mockResolvedValue({ id: 's1', state: 'COLLECTING_PATIENT_INFO', operatorId: 'op-1', channel: 'HIS_RECEPTION', context: ctx, messages: [] });
    await makeSvc(prisma).processMessage('s1', '19900101 010-1111-2222');
    expect(patientCreate.mock.calls[0][0].data.gender).toBe('FEMALE');
  });
});

describe('D3 · 응급 자동 종결이 처분을 지어내지 않는다', () => {
  const makeSvc = (update: any, stale: any[]) => {
    const prisma = { emergencyVisit: { findMany: vi.fn(async () => stale), update } };
    const config = { get: vi.fn(async () => 24) };
    return new EmergencyService(prisma as any, undefined, undefined, undefined, undefined, undefined, undefined, config as any);
  };

  it('🔴 처분이 기록된 적 없으면 비워 둔다 — 시한 경과를 귀가로 적지 않는다', async () => {
    const update = vi.fn(async () => ({}));
    const r = await makeSvc(update, [{ id: 'v1', disposition: null }]).autoCloseStaleVisits();
    expect(r.closed).toBe(1);
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('COMPLETED');
    expect(data.disposition).toBeUndefined();
    expect(data.dispositionNote).toBe(AUTO_CLOSE_NO_DISPOSITION_NOTE);
  });

  it('대조군 — 이미 기록된 처분은 그대로 두고 종결 시각을 남긴다', async () => {
    const update = vi.fn(async () => ({}));
    await makeSvc(update, [{ id: 'v2', disposition: 'ADMISSION' }]).autoCloseStaleVisits();
    const data = update.mock.calls[0][0].data;
    expect(data.disposition).toBe('ADMISSION');
    expect(data.dispositionAt).toBeInstanceOf(Date);
  });
});

describe('D3 · 수가 코드가 0원·본인부담 30% 를 지어내지 않는다', () => {
  // 🔴 (2026-09-17 L1) 정본이 코드↔매핑을 `$transaction` 으로 묶었다 — `$transaction` 없는 목은
  //    콜백을 **아예 실행하지 않아** 이 테스트가 공허하게 통과한다. 실제 호출 모양으로 준다.
  const makeSvc = (create: any) => {
    const prisma: any = { procedureCode: { create }, terminologyMapping: { create: vi.fn() } };
    prisma.$transaction = vi.fn(async (cb: any) => (typeof cb === 'function' ? cb(prisma) : Promise.all(cb)));
    return new CodeMasterService(prisma, {} as any, {} as any);
  };

  it('🔴 미입력이면 null — 청구가 읽는 수가를 지어내지 않는다', async () => {
    const create = vi.fn(async () => ({ id: 'pc1' }));
    await makeSvc(create).createProcedure({ code: 'X1', nameKo: '검사', category: 'LAB' } as any);
    const data = create.mock.calls[0][0].data;
    expect(data.unitPrice).toBeNull();
    expect(data.copayRate).toBeNull();
  });

  it('대조군 — 입력된 수가·본인부담률은 그대로 저장한다', async () => {
    const create = vi.fn(async () => ({ id: 'pc1' }));
    await makeSvc(create).createProcedure({ code: 'X1', nameKo: '검사', category: 'LAB', unitPrice: 12000, copayRate: 0.2 } as any);
    const data = create.mock.calls[0][0].data;
    expect(data.unitPrice).toBe(12000);
    expect(data.copayRate).toBe(0.2);
  });
});

describe('D3 · 장비 사용 후 상태를 "정상"으로 지어내지 않는다', () => {
  const makeSvc = (create: any) =>
    new EquipmentService(
      {
        equipment: { findUnique: vi.fn(async () => ({ id: 'e1', name: 'CT', assetNumber: 'A1', status: 'ACTIVE', nextCalibration: null })) },
        equipmentUsageLog: { create },
        gateViolationLog: { create: vi.fn(async () => ({})) },
      } as any,
      { publish: vi.fn() } as any,
      { get: vi.fn(async () => 'OFF') } as any,
    );

  it('🔴 상태를 보고하지 않았으면 비워 둔다', async () => {
    const create = vi.fn(async () => ({ id: 'u1' }));
    await makeSvc(create).addUsageLog('e1', { usedDate: '2026-09-15', usedBy: '김기사' } as any);
    expect(create.mock.calls[0][0].data.condition).toBeNull();
  });

  it('대조군 — 이상을 보고했으면 그대로 저장한다', async () => {
    const create = vi.fn(async () => ({ id: 'u1' }));
    await makeSvc(create).addUsageLog('e1', { usedDate: '2026-09-15', usedBy: '김기사', condition: 'ISSUE', issueNotes: '소음' } as any);
    expect(create.mock.calls[0][0].data.condition).toBe('ISSUE');
  });
});

describe('D3 · 원격진료 주호소를 "원격진료"로 지어내지 않는다', () => {
  const makeSvc = (session: any, encounterCreate: any) =>
    new TelehealthService(
      {
        telehealthSession: { findUnique: vi.fn(async () => session), update: vi.fn(async () => ({})) },
        encounter: { create: encounterCreate },
      } as any,
    );

  it('🔴 주호소가 없으면 null — 진료 형태를 주호소로 적지 않는다', async () => {
    const encounterCreate = vi.fn(async () => ({ id: 'e1' }));
    await makeSvc({ id: 't1', patientId: 'p1', doctorId: 'd1', chiefComplaint: null, sessionType: 'VIDEO', encounterId: null }, encounterCreate).startSession('t1');
    expect(encounterCreate.mock.calls[0][0].data.chiefComplaint).toBeNull();
  });

  it('대조군 — 환자가 호소한 증상은 그대로 옮긴다', async () => {
    const encounterCreate = vi.fn(async () => ({ id: 'e1' }));
    await makeSvc({ id: 't1', patientId: 'p1', doctorId: 'd1', chiefComplaint: '기침 3일', sessionType: 'VIDEO', encounterId: null }, encounterCreate).startSession('t1');
    expect(encounterCreate.mock.calls[0][0].data.chiefComplaint).toBe('기침 3일');
  });
});

describe('D3 · 인증서 승인이 실행 없이 성공을 말하지 않는다', () => {
  const makeSvc = (cert: any, update: any) =>
    new BlockchainCertService(
      {
        blockchainCertificate: { findUnique: vi.fn(async () => cert), update },
        certificateAuditLog: { create: vi.fn(async () => ({})) },
      } as any,
    );

  it('🔴 PENDING 이면 실제로 활성화한다(종전 no-op)', async () => {
    const update = vi.fn(async () => ({ id: 'c1', status: 'ACTIVE' }));
    const r: any = await makeSvc({ id: 'c1', status: 'PENDING', ownerType: 'STAFF', userId: 'u1', patientId: null }, update).approve('c1', 'admin-1');
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data.status).toBe('ACTIVE');
    expect(r.approved).toBe(true);
  });

  it('대조군 — 이미 ACTIVE 면 바꾸지 않고, 바뀐 것이 없다고 말한다', async () => {
    const update = vi.fn(async () => ({}));
    const r: any = await makeSvc({ id: 'c1', status: 'ACTIVE', ownerType: 'STAFF', userId: 'u1', patientId: null }, update).approve('c1', 'admin-1');
    expect(update).not.toHaveBeenCalled();
    expect(r.approved).toBe(false);
    expect(r.reason).toBe('NOT_PENDING');
    expect(r.status).toBe('ACTIVE');
  });
});

describe('D3 · 모아 식별밴드 대조를 원장에 남긴다', () => {
  let prisma: any;
  let idCheckCreate: any;
  beforeEach(() => {
    idCheckCreate = vi.fn(async () => ({ id: 'chk1' }));
    prisma = {
      newbornRecord: { findUnique: vi.fn(async () => ({ id: 'n1', idBandNo: 'B1', motherBandNo: 'M1', delivery: { patientId: 'mom-1' } })) },
      patientIdentificationCheck: { create: idCheckCreate },
    };
  });
  const svc = () => new ObGynService(prisma as any);

  it('🔴 통과도 남는다 — 누가 언제 무엇을 대조했는지', async () => {
    const r: any = await svc().verifyMotherBabyMatch('n1', 'M1', 'B1', 'nurse-1');
    expect(idCheckCreate).toHaveBeenCalledTimes(1);
    const data = idCheckCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ patientId: 'mom-1', checkType: MOTHER_BABY_CHECK_TYPE, method: 'BARCODE', verifiedBy: 'nurse-1', result: 'PASS' });
    expect(data.verifiedItems).toEqual({ motherBand: true, babyBand: true });
    expect(r.recorded).toBe(true);
  });

  it('🔴 불일치(오식별 시도)는 막기 전에 먼저 남긴다 — 종전엔 흔적이 없었다', async () => {
    await expect(svc().verifyMotherBabyMatch('n1', 'M1', 'WRONG', 'nurse-1')).rejects.toThrow(/불일치/);
    expect(idCheckCreate).toHaveBeenCalledTimes(1);
    const data = idCheckCreate.mock.calls[0][0].data;
    expect(data.result).toBe('FAIL');
    expect(data.verifiedItems).toEqual({ motherBand: true, babyBand: false });
    expect(data.failureReason).toContain('불일치');
  });

  it('대조군 — 확인자를 모르면 기록하지 않고, 기록하지 못한 사실을 응답이 말한다', async () => {
    const r: any = await svc().verifyMotherBabyMatch('n1', 'M1', 'B1');
    expect(idCheckCreate).not.toHaveBeenCalled();
    expect(r.recorded).toBe(false);
  });
});
