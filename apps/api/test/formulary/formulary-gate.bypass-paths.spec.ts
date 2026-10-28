import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ForbiddenException } from '@nestjs/common';
import { FormularyGateService } from '../../src/modules/formulary/formulary-gate.service';
import { PreOrderService } from '../../src/modules/pre-order/pre-order.service';
import { PreOrderModule } from '../../src/modules/pre-order/pre-order.module';
import { RemoteConsultationService } from '../../src/modules/remote-consultation/remote-consultation.service';
import { RemoteConsultationModule } from '../../src/modules/remote-consultation/remote-consultation.module';

/**
 * 원내 처방집 게이트 — **PrescriptionService 를 거치지 않는 발행 경로**(W8-R3, 2026-08-14).
 *
 * 🔴 원 결함: W8-R2 는 게이트를 처방 서비스 3경로(create·copy·repeat)에만 달았다. 그런데
 *   `prisma.prescription.create` 를 직접 부르는 발행 경로가 둘 더 있었다 —
 *   사전 오더 승인(pre-order.approve)과 비대면 진료 처방(remote-consultation.createPrescription).
 *   둘 다 DUR·사전승인 게이트는 통과시키면서 포뮬러리만 통째로 우회했고, 관리 화면은 그것을
 *   '미배선 경로'라고 표시만 하고 있었다. 한 곳만 고치면 갈라진다 — 여기서 봉합한다.
 *
 * 이 스펙이 지키는 사실:
 *  ① 두 경로가 **정본 게이트를 실제로** 부른다(새 판정 아님 · assertOrderAllowed 하나)
 *  ② provider 가 등록돼 있다 — 빠지면 @Optional 주입이라 게이트가 **조용히 no-op** 이 된다
 *  ③ 운영 현재 모드(MEDICATION=WARN)는 막지 않되 GateViolationLog 에 위반을 남긴다
 *  ④ 호출 순서가 정본과 같다(DUR 뒤 · 사전승인 앞)
 *  ⑤ 구조 가드 — `prisma.prescription.create` 를 직접 쓰는 **새 파일**은 게이트를 import 해야 한다
 */

function makeGatePrisma() {
  return {
    systemConfig: { findUnique: vi.fn().mockResolvedValue(null) },
    formularyItem: { findFirst: vi.fn().mockResolvedValue(null) },
    gateViolationLog: { create: vi.fn().mockResolvedValue({}) },
    medicationCode: { findUnique: vi.fn().mockResolvedValue({ code: 'M001', nameKo: '아목시실린' }) },
    procedureCode: { findUnique: vi.fn().mockResolvedValue({ code: 'B001', nameKo: '일반혈액검사' }) },
  };
}

const makeConfig = (values: Record<string, unknown>) => ({ get: vi.fn(async (k: string) => values[k] ?? null), set: vi.fn() });

const logged = (prisma: ReturnType<typeof makeGatePrisma>) =>
  prisma.gateViolationLog.create.mock.calls.map((c) => (c[0] as { data: { severity: string; message: string; gateKey: string } }).data);

const gateFor = (mode: unknown, gatePrisma: ReturnType<typeof makeGatePrisma>) =>
  new FormularyGateService(gatePrisma as never, makeConfig({ 'formulary.enforce': { MEDICATION: mode, LAB: mode } }) as never);

// ────────────────────────────────────────────────────────────────────────────
describe('우회 경로 ① 사전 오더 승인(pre-order.approve) — 처방 발행이므로 게이트를 통과해야 한다', () => {
  let prisma: any;
  let gatePrisma: ReturnType<typeof makeGatePrisma>;
  let preAuthGate: { assertOrderGate: ReturnType<typeof vi.fn> };
  let dur: { checkInteractions: ReturnType<typeof vi.fn> };

  const PRE_ORDER = {
    id: 'po-1', status: 'PENDING', type: 'MEDICATION', medicationCodeId: 'm-1', procedureCodeId: null,
    patientId: 'p-1', doctorId: 'doc-1', priority: 'ROUTINE', dosage: '500mg', frequency: 'TID',
    duration: 7, quantity: 21, route: 'PO', instructions: null,
  };

  const build = (mode: unknown) => {
    gatePrisma = makeGatePrisma();
    prisma = {
      preOrder: { findUnique: vi.fn().mockResolvedValue(PRE_ORDER), update: vi.fn().mockResolvedValue({ id: 'po-1' }) },
      prescription: { create: vi.fn().mockResolvedValue({ id: 'rx-1' }) },
      order: { create: vi.fn().mockResolvedValue({ id: 'o-1' }) },
    };
    // 처방·오더·상태 갱신은 한 트랜잭션(F3) — 정본의 실제 호출 모양
    prisma.$transaction = vi.fn((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
    dur = { checkInteractions: vi.fn().mockResolvedValue([]) };
    preAuthGate = { assertOrderGate: vi.fn().mockResolvedValue({}) };
    return new PreOrderService(
      prisma, dur as never, { emit: vi.fn() } as never,
      makeConfig({}) as never, preAuthGate as never, gateFor(mode, gatePrisma),
    );
  };

  it('BLOCK + 미등재 — 처방이 만들어지기 전에 차단된다(종전엔 그냥 발행됐다)', async () => {
    const svc = build('BLOCK');
    await expect(svc.approve('po-1', 'doc-2', 'enc-1')).rejects.toThrow(ForbiddenException);
    expect(prisma.prescription.create).not.toHaveBeenCalled();
    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.preOrder.update).not.toHaveBeenCalled(); // 상태도 APPROVED 로 넘어가지 않는다
    expect(logged(gatePrisma)[0]).toEqual(
      expect.objectContaining({ gateKey: 'formulary.enforce', severity: 'BLOCK', message: expect.stringContaining('[CREATE/MEDICATION]') }),
    );
  });

  it('③ 운영 현재 모드(WARN) — 막지 않고 발행하되 위반을 남긴다', async () => {
    const svc = build('WARN');
    const r = await svc.approve('po-1', 'doc-2', 'enc-1');
    expect(prisma.prescription.create).toHaveBeenCalled();
    expect(r.data.prescription).toEqual({ id: 'rx-1' });
    expect(logged(gatePrisma)[0]).toEqual(expect.objectContaining({ severity: 'WARN' }));
  });

  it('승인(ACTIVE) 항목은 BLOCK 이어도 통과하고 아무것도 기록하지 않는다', async () => {
    const svc = build('BLOCK');
    gatePrisma.formularyItem.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    await svc.approve('po-1', 'doc-2', 'enc-1');
    expect(prisma.prescription.create).toHaveBeenCalled();
    expect(gatePrisma.gateViolationLog.create).not.toHaveBeenCalled();
  });

  it('미지 게이트값은 fail-closed 로 차단된다(설정 오타가 통제를 끄지 못한다)', async () => {
    const svc = build('WRN');
    await expect(svc.approve('po-1', 'doc-2', 'enc-1')).rejects.toThrow(ForbiddenException);
    expect(prisma.prescription.create).not.toHaveBeenCalled();
  });

  it('④ 호출 순서 — DUR 재검증 뒤, 사전승인 게이트 앞에서 판정한다(정본 prescription.service 와 동일)', async () => {
    const svc = build('BLOCK');
    await expect(svc.approve('po-1', 'doc-2', 'enc-1')).rejects.toThrow(ForbiddenException);
    expect(dur.checkInteractions).toHaveBeenCalled();        // DUR 은 이미 돌았고
    expect(preAuthGate.assertOrderGate).not.toHaveBeenCalled(); // 사전승인은 아직 소비되지 않았다
  });

  it('검사(LAB) 사전오더도 같은 게이트를 통과한다 — 약물 전용이 아니다', async () => {
    gatePrisma = makeGatePrisma();
    prisma = {
      preOrder: { findUnique: vi.fn().mockResolvedValue({ ...PRE_ORDER, type: 'LAB', medicationCodeId: null, procedureCodeId: 'proc-1' }), update: vi.fn() },
      prescription: { create: vi.fn() },
      order: { create: vi.fn() },
    };
    // 처방·오더·상태 갱신은 한 트랜잭션(F3) — 정본의 실제 호출 모양
    prisma.$transaction = vi.fn((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
    const svc = new PreOrderService(
      prisma, { checkInteractions: vi.fn().mockResolvedValue([]) } as never, { emit: vi.fn() } as never,
      makeConfig({}) as never, { assertOrderGate: vi.fn() } as never, gateFor('BLOCK', gatePrisma),
    );
    await expect(svc.approve('po-1', 'doc-2', 'enc-1')).rejects.toThrow(ForbiddenException);
    expect(logged(gatePrisma)[0].message).toContain('[CREATE/LAB]');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('우회 경로 ② 비대면 진료 처방(remote-consultation.createPrescription)', () => {
  let prisma: any;
  let gatePrisma: ReturnType<typeof makeGatePrisma>;
  let preAuthGate: { assertOrderGate: ReturnType<typeof vi.fn> };
  let dur: { checkInteractions: ReturnType<typeof vi.fn> };

  const MEDS = [{ medicationCodeId: 'm-1', dosage: '500mg', frequency: 'TID', duration: 3, quantity: 9, route: 'PO' }];

  const build = (mode: unknown) => {
    gatePrisma = makeGatePrisma();
    prisma = {
      remoteConsultation: {
        findFirst: vi.fn().mockResolvedValue({ id: 'rc-1', doctorId: 'doc-1', patientId: 'p-1', encounterId: 'enc-1', subject: '두통' }),
        update: vi.fn(),
      },
      prescription: { create: vi.fn().mockResolvedValue({ id: 'rx-1', medicationCode: { nameKo: '아목시실린', code: 'M001' } }) },
      order: { create: vi.fn().mockResolvedValue({ id: 'o-1' }) },
      consultationMessage: { create: vi.fn().mockResolvedValue({}) },
      encounter: { create: vi.fn() },
      gateViolationLog: { create: vi.fn().mockResolvedValue({}) },
    };
    // 처방·오더·상태 갱신은 한 트랜잭션(F3) — 정본의 실제 호출 모양
    prisma.$transaction = vi.fn((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
    dur = { checkInteractions: vi.fn().mockResolvedValue([]) };
    preAuthGate = { assertOrderGate: vi.fn().mockResolvedValue({}) };
    return new RemoteConsultationService(
      prisma, { get: vi.fn() } as never, undefined, preAuthGate as never, dur as never,
      makeConfig({}) as never, { emit: vi.fn() } as never, gateFor(mode, gatePrisma),
    );
  };

  it('BLOCK + 미등재 — 원격 처방도 발행 전에 차단된다(약국 오더·환자 안내까지 생기지 않는다)', async () => {
    const svc = build('BLOCK');
    await expect(svc.createPrescription('rc-1', 'doc-1', { medications: MEDS })).rejects.toThrow(ForbiddenException);
    expect(prisma.prescription.create).not.toHaveBeenCalled();
    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.consultationMessage.create).not.toHaveBeenCalled();
    expect(logged(gatePrisma)[0]).toEqual(
      expect.objectContaining({ gateKey: 'formulary.enforce', severity: 'BLOCK', message: expect.stringContaining('[CREATE/MEDICATION]') }),
    );
  });

  it('③ 운영 현재 모드(WARN) — 막지 않고 발행하되 위반을 남긴다', async () => {
    const svc = build('WARN');
    const r = await svc.createPrescription('rc-1', 'doc-1', { medications: MEDS });
    expect(r.prescriptions).toHaveLength(1);
    expect(logged(gatePrisma)[0]).toEqual(expect.objectContaining({ severity: 'WARN' }));
  });

  it('④ 호출 순서 — DUR 뒤, 사전승인 앞', async () => {
    const svc = build('BLOCK');
    await expect(svc.createPrescription('rc-1', 'doc-1', { medications: MEDS })).rejects.toThrow(ForbiddenException);
    expect(dur.checkInteractions).toHaveBeenCalled();
    expect(preAuthGate.assertOrderGate).not.toHaveBeenCalled();
  });

  it('약 여러 건이면 건건이 판정한다 — 첫 건이 승인이어도 둘째 미등재는 잡힌다', async () => {
    const svc = build('BLOCK');
    gatePrisma.formularyItem.findFirst
      .mockResolvedValueOnce({ status: 'ACTIVE' })
      .mockResolvedValueOnce(null);
    await expect(svc.createPrescription('rc-1', 'doc-1', {
      medications: [MEDS[0], { ...MEDS[0], medicationCodeId: 'm-2' }],
    })).rejects.toThrow(ForbiddenException);
    expect(prisma.prescription.create).toHaveBeenCalledTimes(1); // 첫 건만 발행, 둘째에서 멈춘다
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('② 게이트 DI 배선 — provider 가 빠지면 게이트는 조용히 no-op 이 된다', () => {
  it.each([
    ['PreOrderModule', PreOrderModule],
    ['RemoteConsultationModule', RemoteConsultationModule],
  ])('%s 가 FormularyGateService 를 provider 로 등록한다', (_name, mod) => {
    const providers = (Reflect.getMetadata('providers', mod) ?? []) as unknown[];
    expect(providers).toContain(FormularyGateService);
  });
});

// ────────────────────────────────────────────────────────────────────────────
/**
 * ⑤ 구조 가드 — 새 우회 경로 차단.
 *
 * `prisma.prescription.create` / `tx.prescription.create` 를 직접 부르는 파일은 정본 게이트를
 * import 해야 한다. 아래 면제 목록은 **왜 집행할 수 없는지**를 사유로 남긴다(면제=안전하다는 뜻이 아니다).
 * 새 파일이 목록 밖에서 처방을 직접 만들면 이 테스트가 실패한다.
 */
describe('⑤ 구조 가드 — 처방을 직접 만드는 파일은 게이트를 import 한다', () => {
  const SRC = path.join(__dirname, '..', '..', 'src');
  const RAW_CREATE = /(?:prisma|tx)\.prescription\.create\b/;

  /** 면제 — 사유 명시. 집행 가능한데 빠진 것이 아니라, 구조적으로 대조가 불가능하거나 실환자 발행이 아니다. */
  const EXEMPT: Record<string, string> = {
    'modules/workstation/workstation.service.ts':
      'THERAPY 전용 발행 — THERAPY 는 등재가 프리셋 키이고 처방엔 대조 컬럼이 없어 집행 불가(FORMULARY_ORDER_KEY.THERAPY=null)',
    'modules/patient-auth/patient-auth.service.ts':
      '환자 포털 데모 데이터 생성(실환자 발행 아님) — 코드 ID 없는 자유기재라 대조 대상도 없다',
    'modules/dev-demo/dev-demo.service.ts':
      '개발 데모 시드 생성기(실환자 발행 아님)',
  };

  /** 주석 줄 제거 — 게이트 서비스 자신이 doc 주석에서 이 패턴을 인용하므로 코드만 본다 */
  const codeOnly = (text: string) =>
    text.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');

  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(p);
    }
    return out;
  };

  const offenders = walk(SRC)
    .map((p) => ({ rel: path.relative(SRC, p).split(path.sep).join('/'), text: fs.readFileSync(p, 'utf8') }))
    .filter((f) => RAW_CREATE.test(codeOnly(f.text)));

  it('처방을 직접 만드는 파일을 하나도 놓치지 않고 잡는다(스캐너 자체 검증)', () => {
    // 정본(prescription.service)·봉합한 두 우회로가 스캔에 걸려야 스캐너가 살아 있는 것이다
    const rels = offenders.map((f) => f.rel);
    expect(rels).toEqual(expect.arrayContaining([
      'modules/prescription/prescription.service.ts',
      'modules/pre-order/pre-order.service.ts',
      'modules/remote-consultation/remote-consultation.service.ts',
    ]));
  });

  it('면제 목록 밖의 모든 직접 발행 파일이 FormularyGateService 를 import 한다', () => {
    const missing = offenders
      .filter((f) => !(f.rel in EXEMPT))
      .filter((f) => !/formulary-gate\.service/.test(f.text))
      .map((f) => f.rel);
    expect(missing).toEqual([]);
  });

  it('면제 목록은 실재하는 파일만 담는다(사라진 면제가 남아 새 우회로를 가리지 않게)', () => {
    const rels = new Set(offenders.map((f) => f.rel));
    expect(Object.keys(EXEMPT).filter((k) => !rels.has(k))).toEqual([]);
  });
});
