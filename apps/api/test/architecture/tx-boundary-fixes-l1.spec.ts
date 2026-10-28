import { describe, it, expect, vi } from 'vitest';

/**
 * L1 (트랜잭션 7차) — 봉합한 자리의 **동작**을 본다(소스 문자열이 아니라).
 *
 * 🔴 앞 갈래들이 배운 것을 그대로 지킨다:
 *  · 목은 정본이 실제로 부르는 모양으로 준다 — `$transaction` 이 없는 목은 콜백을 **아예 실행하지 않아**
 *    가드가 공허하게 통과한다(I2·J1·K1 이 그런 목을 여러 개 찾았다).
 *  · 추출 표식을 변수명 문자열로 두지 않는다(J1).
 *  · 건마다 **정상 경로 대조군**을 둔다 — 막기만 하고 끝내면 그것도 결함이다.
 */
function txMock(models: Record<string, unknown>) {
  const prisma: Record<string, unknown> = {
    ...models,
    $transaction: vi.fn().mockImplementation((cb: unknown) =>
      typeof cb === 'function' ? (cb as (c: unknown) => unknown)(prisma) : Promise.all(cb as unknown[]),
    ),
  };
  return { prisma };
}

describe('🔴 L1 — 검진권 배치 앵커는 한 트랜잭션이고, 두 번 앵커하지 않는다', () => {
  const makeSvc = async (batch: { anchorId: string | null; merkleRoot?: string | null }) => {
    const { VoucherLedgerService } = await import('../../src/modules/voucher/voucher-ledger.service');
    const anchorCreate = vi.fn().mockResolvedValue({ id: 'anchor-1' });
    const batchUpdate = vi.fn().mockResolvedValue({});
    const eventUpdate = vi.fn().mockResolvedValue({ count: 3 });
    const { prisma } = txMock({
      checkupVoucher: { findMany: vi.fn().mockResolvedValue([{ headHash: 'a'.repeat(64) }, { headHash: 'b'.repeat(64) }]) },
      voucherBatch: { findUnique: vi.fn().mockResolvedValue(batch), update: batchUpdate },
      blockchainAnchor: { create: anchorCreate },
      voucherEvent: { updateMany: eventUpdate },
    });
    const svc = new VoucherLedgerService(prisma as never);
    return { svc, prisma, anchorCreate, batchUpdate, eventUpdate };
  };

  it('🔴 앵커 생성·배치 갱신·이벤트 표시가 한 트랜잭션에서 일어난다(앵커만 커밋되면 배치는 영영 미앵커)', async () => {
    const { svc, prisma, anchorCreate, batchUpdate, eventUpdate } = await makeSvc({ anchorId: null });
    const r = await svc.anchorBatch('batch-1', 'INTERNAL');
    expect(prisma.$transaction as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(anchorCreate).toHaveBeenCalledTimes(1);
    expect(batchUpdate).toHaveBeenCalledTimes(1);
    expect(eventUpdate).toHaveBeenCalledTimes(1);
    expect(r.anchorId).toBe('anchor-1');
  });

  it('🔴 이미 앵커된 배치는 **새 앵커를 만들지 않는다**(원장은 append-only 라 되돌릴 수 없다)', async () => {
    const { svc, anchorCreate, batchUpdate, eventUpdate } = await makeSvc({ anchorId: 'anchor-old', merkleRoot: 'root-old' });
    const r = await svc.anchorBatch('batch-1', 'INTERNAL');
    expect(anchorCreate).not.toHaveBeenCalled();
    expect(batchUpdate).not.toHaveBeenCalled();
    expect(eventUpdate).not.toHaveBeenCalled();
    expect(r).toMatchObject({ anchorId: 'anchor-old', merkleRoot: 'root-old' });
  });
});

describe('🔴 L1 — 전량 발행됐는데 앵커가 없는 배치는 멱등 분기에서 이어서 앵커한다', () => {
  const makeSvc = async (existing: Record<string, unknown>) => {
    const { VoucherService } = await import('../../src/modules/voucher/voucher.service');
    const anchorBatch = vi.fn().mockResolvedValue({ merkleRoot: 'root-new', anchorId: 'anchor-new' });
    const prisma = {
      voucherBatch: { findUnique: vi.fn().mockResolvedValue(existing) },
      checkupVoucher: { count: vi.fn().mockResolvedValue(10) },
    };
    const policy = { getActive: vi.fn().mockResolvedValue({ anchorChainType: 'INTERNAL' }) };
    const svc = new VoucherService(prisma as never, policy as never, { anchorBatch } as never, {} as never, {} as never);
    return { svc, anchorBatch };
  };

  it('🔴 앵커가 비어 있으면 이어서 앵커한다(첫 시도에 실패하면 재시도가 여기서 막혔다)', async () => {
    const { svc, anchorBatch } = await makeSvc({ id: 'b-1', quantity: 10, status: 'ISSUED', anchorId: null, merkleRoot: null });
    const r = await svc.issueBatch({ idempotencyKey: 'k' } as never, 'admin');
    expect(anchorBatch).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ idempotent: true, anchorId: 'anchor-new' });
  });

  it('대조군 — 이미 앵커된 배치는 다시 앵커하지 않는다', async () => {
    const { svc, anchorBatch } = await makeSvc({ id: 'b-1', quantity: 10, status: 'ISSUED', anchorId: 'anchor-old', merkleRoot: 'root-old' });
    const r = await svc.issueBatch({ idempotencyKey: 'k' } as never, 'admin');
    expect(anchorBatch).not.toHaveBeenCalled();
    expect(r).toMatchObject({ idempotent: true, anchorId: 'anchor-old' });
  });
});

describe('🔴 L1 — sign webhook 은 반영에 실패하면 멱등 표식을 되돌린다', () => {
  const makeSvc = async (failApply: boolean) => {
    const { SignIntegrationService } = await import('../../src/modules/sign-integration/sign-integration.service');
    const del = vi.fn().mockResolvedValue(1);
    const redis = { set: vi.fn().mockResolvedValue('OK'), del };
    const prisma = {
      consentForm: {
        findFirst: vi.fn().mockImplementation(() => (failApply ? Promise.reject(new Error('DB down')) : Promise.resolve(null))),
      },
      issuedDocument: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const svc = new SignIntegrationService({} as never, prisma as never, {} as never, redis as never, {} as never, {} as never);
    return { svc, del };
  };

  it('🔴 반영이 실패하면 표식을 지운다 — 안 지우면 sign 재전송이 "중복"으로 ack 돼 영영 미반영된다', async () => {
    const { svc, del } = await makeSvc(true);
    await expect(svc.handleWebhook({ eventId: 'e-1', signatureRequestId: 'r-1' })).rejects.toThrow();
    expect(del).toHaveBeenCalledWith('sign:webhook:evt:e-1');
  });

  it('대조군 — 정상 처리되면 표식을 유지한다(그래야 replay 가 막힌다)', async () => {
    const { svc, del } = await makeSvc(false);
    const r = await svc.handleWebhook({ eventId: 'e-1', signatureRequestId: 'r-1' });
    expect(del).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, matched: false });
  });
});

describe('🔴 L1 — 태블릿 페어링 코드 소비와 기기 등록은 한 트랜잭션이다', () => {
  const makeSvc = async (existing: Record<string, unknown> | null) => {
    const { ConsentDeviceService } = await import('../../src/modules/consent/consent-device.service');
    const codeConsume = vi.fn().mockResolvedValue({ count: 1 });
    const deviceUpdate = vi.fn().mockResolvedValue({ id: 'dev-1', approvalStatus: 'APPROVED', status: 'IDLE', name: '태블릿' });
    const deviceCreate = vi.fn().mockResolvedValue({ id: 'dev-1', approvalStatus: 'APPROVED', status: 'IDLE', name: '태블릿' });
    const { prisma } = txMock({
      consentSigningDevice: { findUnique: vi.fn().mockResolvedValue(existing), update: deviceUpdate, create: deviceCreate },
      devicePairingCode: { updateMany: codeConsume },
    });
    const svc = new ConsentDeviceService(prisma as never, { emitWorkstation: vi.fn() } as never);
    return { svc, prisma, codeConsume, deviceUpdate, deviceCreate };
  };

  it('🔴 재페어링 — 코드 소비와 secret 교체가 한 트랜잭션(코드만 타 버리면 1회용 코드를 다시 받아야 한다)', async () => {
    const { svc, prisma, codeConsume, deviceUpdate } = await makeSvc({
      id: 'dev-1', approvalStatus: 'APPROVED', isActive: true, deviceSecret: 'old-secret', status: 'IDLE', name: '태블릿',
    });
    const r = await svc.enroll({ deviceUid: 'uid-1', name: '태블릿', code: 'CODE1' });
    expect(prisma.$transaction as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(codeConsume).toHaveBeenCalled();
    expect(deviceUpdate).toHaveBeenCalledTimes(1);
    expect(r.deviceSecret).not.toBe('old-secret'); // 유출 의심 secret 은 교체된다
  });

  it('🔴 신규 등록 — 코드 소비와 기기 생성이 한 트랜잭션', async () => {
    const { svc, prisma, codeConsume, deviceCreate } = await makeSvc(null);
    await svc.enroll({ deviceUid: 'uid-2', name: '태블릿', code: 'CODE2' });
    expect(prisma.$transaction as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(codeConsume).toHaveBeenCalled();
    expect(deviceCreate).toHaveBeenCalledTimes(1);
  });

  it('대조군 — 코드 없는 신규 등록은 트랜잭션 없이 대기(PENDING)로 생성된다', async () => {
    const { svc, prisma, codeConsume, deviceCreate } = await makeSvc(null);
    await svc.enroll({ deviceUid: 'uid-3', name: '태블릿' });
    expect(prisma.$transaction as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(codeConsume).not.toHaveBeenCalled();
    expect(deviceCreate.mock.calls[0][0].data).toMatchObject({ approvalStatus: 'PENDING' });
  });
});

describe('🔴 L1 — 코드 생성과 용어 매핑은 한 트랜잭션(매핑만 사라지면 다시 만들 수도 없다)', () => {
  const makeSvc = async () => {
    const { CodeMasterService } = await import('../../src/modules/code-master/code-master.service');
    const mappingCreate = vi.fn().mockResolvedValue({});
    const mappingUpsert = vi.fn().mockResolvedValue({});
    const { prisma } = txMock({
      medicationCode: { create: vi.fn().mockResolvedValue({ id: 'm-1' }) },
      procedureCode: { create: vi.fn().mockResolvedValue({ id: 'p-1' }) },
      diagnosisCode: { create: vi.fn().mockResolvedValue({ id: 'd-1' }) },
      labTestCode: { create: vi.fn().mockResolvedValue({ id: 'l-1' }) },
      terminologyMapping: { create: mappingCreate, upsert: mappingUpsert },
    });
    const svc = new CodeMasterService(prisma as never, {} as never, {} as never);
    return { svc, prisma, mappingCreate, mappingUpsert };
  };

  it('🔴 약품 — 코드와 SNOMED 매핑이 한 트랜잭션', async () => {
    const { svc, prisma, mappingCreate } = await makeSvc();
    await svc.createMedication({ code: 'M1', nameKo: '약', snomedCode: 'S1' } as never);
    expect(prisma.$transaction as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(mappingCreate).toHaveBeenCalledTimes(1);
  });

  it('🔴 약품 — 매핑 실패를 삼키지 않는다(사용자가 입력한 매핑이 말없이 사라지면 안 된다)', async () => {
    const { svc, mappingCreate } = await makeSvc();
    mappingCreate.mockRejectedValueOnce(new Error('mapping failed'));
    await expect(svc.createMedication({ code: 'M1', nameKo: '약', snomedCode: 'S1' } as never)).rejects.toThrow();
  });

  it('🔴 수가·진단·검사 — 같은 쌍둥이도 한 트랜잭션', async () => {
    for (const run of [
      async (s: Record<string, (x: unknown) => Promise<unknown>>) => s.createProcedure({ code: 'P1', nameKo: '수가', snomedCode: 'S1' } as never),
      async (s: Record<string, (x: unknown) => Promise<unknown>>) => s.createDiagnosis({ code: 'D1', nameKo: '진단', icd10Code: 'A00' } as never),
      async (s: Record<string, (x: unknown) => Promise<unknown>>) => s.createLabTest({ code: 'L1', nameKo: '검사', loincCode: '1234-5' } as never),
    ]) {
      const { svc, prisma } = await makeSvc();
      await run(svc as never);
      expect(prisma.$transaction as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    }
  });

  it('대조군 — 매핑 코드가 없으면 매핑을 만들지 않는다(빈 매핑을 지어내지 않는다)', async () => {
    const { svc, mappingCreate, mappingUpsert } = await makeSvc();
    await svc.createMedication({ code: 'M2', nameKo: '약' } as never);
    expect(mappingCreate).not.toHaveBeenCalled();
    expect(mappingUpsert).not.toHaveBeenCalled();
  });
});

describe('🔴 L1 — 고시 반영의 수가 버전 교체(이전 종료 ↔ 새 버전)는 한 트랜잭션이다', () => {
  const makeSvc = async (verdict: 'NEW' | 'CHANGED') => {
    const { CodeImportService } = await import('../../src/modules/code-master/code-import.service');
    const procUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const procUpsert = vi.fn().mockResolvedValue({});
    const { prisma } = txMock({ procedureCode: { updateMany: procUpdateMany, upsert: procUpsert } });
    const svc = new CodeImportService(prisma as never);
    vi.spyOn(svc as never, 'preview' as never).mockResolvedValue({
      counts: { ERROR: 0, UNCHANGED: 0 },
      rows: [{ verdict, parsed: { code: 'A1', nameKo: '수가', unitPrice: 1000 } }],
      missingInFile: 0,
    } as never);
    return { svc, prisma, procUpdateMany, procUpsert };
  };

  it('🔴 이전 버전 종료와 새 버전 생성이 한 트랜잭션(앞만 커밋되면 시행일 이후 유효한 수가가 없다)', async () => {
    const { svc, prisma, procUpdateMany, procUpsert } = await makeSvc('CHANGED');
    const r = await svc.apply('procedure', 'raw', '2026-10-01', 'admin');
    expect(prisma.$transaction as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(procUpdateMany).toHaveBeenCalledTimes(1);
    expect(procUpsert).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ versioned: 1, created: 0 });
  });

  it('대조군 — 신설(NEW)은 이전 버전을 닫지 않는다', async () => {
    const { svc, procUpdateMany, procUpsert } = await makeSvc('NEW');
    const r = await svc.apply('procedure', 'raw', '2026-10-01', 'admin');
    expect(procUpdateMany).not.toHaveBeenCalled();
    expect(procUpsert).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ created: 1, versioned: 0 });
  });
});
