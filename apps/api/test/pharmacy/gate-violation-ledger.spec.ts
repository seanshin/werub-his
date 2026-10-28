import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PharmacyService } from '../../src/modules/pharmacy/pharmacy.service';
import { SafetyGateService } from '../../src/modules/safety-gate/safety-gate.service';

/**
 * 약국 안전 게이트 2종의 **위반 원장 배선** — `pharmacy.highAlertDoubleCheck` · `asp.enforce`.
 *
 * 🔴 왜 필요한가(2026-08-26 실측):
 *    둘 다 **집행은 하는데 원장에 남기지 않았다**(BLOCK 은 예외만 던지고, WARN 은 `logger.warn` 뿐).
 *    그래서 `/admin/safety-gates` 에서 두 게이트는 개통 이래 "위반 0건"이었고,
 *    그 0 이 '준수'인지 '탐지기가 죽음'인지 구분할 방법이 아무 데도 없었다
 *    (v4.4.0 DUR 43룰 · v4.2.0 퇴원 게이트와 같은 유형).
 *    운영 `gate_violation_logs` 전체가 2행(`encounter.requireDiagnosisOnSign`)뿐이라는 사실이
 *    "게이트가 12종 켜져 있다"는 화면의 말과 나란히 서 있었다.
 *
 * 🔴 이 가드는 **결함을 재주입하면 실패해야** 가드다. 재주입 검증(2026-08-26 실제로 지워서 확인):
 *    · `pharmacy.service.ts` 의 `completeDispensing` 에서 `recordGateViolation({ gateKey: 'pharmacy.highAlertDoubleCheck' … })`
 *      블록을 통째로 지우면 → BLOCK·WARN 두 케이스가 실패한다(2건).
 *    · `startDispensing` 에서 `recordGateViolation({ gateKey: 'asp.enforce' … })` 를 지우면
 *      → ASP BLOCK·WARN 두 케이스가 실패한다(2건).
 *    · `pharmacy.module.ts` 의 `SafetyGateModule` import 를 지우면
 *      → `gate-three-phase-and-ledger.spec.ts` 의 모듈 배선 케이스가 실패한다.
 *
 * 🔴 **대조군을 함께 둔다** — 통과한 건을 기록하면 붉은 숫자가 올라가 진짜 위반이 묻힌다.
 *    "위반이면 남는다"만 시험하는 가드는 `record()` 를 무조건 부르는 코드도 통과시킨다.
 *
 * 🔴 목(mock)은 **정본의 실제 시그니처**를 베낀다 —
 *    `SafetyGateService.record(gateKey, severity, message, refType?, refId?)`
 *    (`modules/safety-gate/safety-gate.service.ts`). 내가 가정한 모양을 시험하면 가드가 헛돈다.
 */

/** 정본 시그니처를 타입으로 못박는다 — 정본이 바뀌면 여기서 `tsc` 가 먼저 깨진다 */
type RecordArgs = Parameters<SafetyGateService['record']>;

const mkGates = () => {
  const calls: RecordArgs[] = [];
  const record = vi.fn(async (...a: RecordArgs) => {
    calls.push(a);
    return undefined;
  });
  return { calls, gates: { record } as unknown as SafetyGateService, record };
};

describe('asp.enforce — 제한항생제 ASP 미승인 위반이 원장에 남는다', () => {
  const RESTRICTED = {
    id: 'ord-asp', status: 'ORDERED', pharmacyType: 'INTERNAL',
    prescription: {
      id: 'rx-asp', medicationCodeId: 'm-asp', quantity: 1,
      durWarnings: null, durOverridden: false,
      medicationCode: { aspRestrictedLevel: 'RESTRICTED', nameKo: '메로페넴' },
      encounter: { patientId: 'p-1' },
    },
  };
  /** 대조군용 — 제한항생제가 아닌 처방(평가 모집단 밖) */
  const PLAIN = { ...RESTRICTED, prescription: { ...RESTRICTED.prescription, medicationCode: { aspRestrictedLevel: null, nameKo: '아세트아미노펜' } } };

  let prisma: any;
  let config: any;

  const mk = (order: unknown, aspValue: string | null, approved: unknown = null) => {
    prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(order), update: vi.fn().mockResolvedValue({}) },
      prescription: { update: vi.fn().mockResolvedValue({}) },
      aspRequest: { findFirst: vi.fn().mockResolvedValue(approved) },
      admission: { count: vi.fn().mockResolvedValue(0) },
      dispensing: { create: vi.fn().mockResolvedValue({ id: 'disp-1' }) },
      gateViolationLog: { create: vi.fn().mockResolvedValue({}) },
    };
    // 오더 상태와 조제 기록은 한 트랜잭션(F3) — 정본의 실제 호출 모양
    prisma.$transaction = vi.fn((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
    config = { get: vi.fn(async (k: string) => (k === 'asp.enforce' ? aspValue : null)) };
    const g = mkGates();
    const svc = new PharmacyService(prisma, { emit: vi.fn() } as any, { enqueue: vi.fn() } as any, config, undefined, g.gates);
    return { svc, ...g };
  };

  it('BLOCK + 미승인 — 원장에 BLOCK 으로 남고, 차단은 종전 그대로 409(ConflictException)', async () => {
    const { svc, record, calls } = mk(RESTRICTED, 'BLOCK');
    await expect(svc.startDispensing('ord-asp', 'ph-1')).rejects.toThrow(ConflictException);
    expect(record).toHaveBeenCalledTimes(1);
    expect(calls[0][0]).toBe('asp.enforce');
    expect(calls[0][1]).toBe('BLOCK');
    expect(calls[0][3]).toBe('PRESCRIPTION');
    expect(calls[0][4]).toBe('rx-asp');
    // 🔴 집행 동작 불변 — 차단이므로 조제 행이 생기지 않는다
    expect(prisma.dispensing.create).not.toHaveBeenCalled();
  });

  it('WARN + 미승인 — 원장에 WARN 으로 남되 막지 않는다(집행 동작 불변)', async () => {
    const { svc, record, calls } = mk(RESTRICTED, 'WARN');
    const r = await svc.startDispensing('ord-asp', 'ph-1');
    expect(r.id).toBe('disp-1');
    expect(record).toHaveBeenCalledTimes(1);
    expect(calls[0][1]).toBe('WARN');
  });

  // ── 대조군 ── 통과한 건은 남기지 않는다
  it('대조군: ASP 승인이 있으면 기록도 차단도 없다', async () => {
    const { svc, record } = mk(RESTRICTED, 'BLOCK', { id: 'asp-1', status: 'APPROVED' });
    await expect(svc.startDispensing('ord-asp', 'ph-1')).resolves.toBeTruthy();
    expect(record).not.toHaveBeenCalled();
  });

  it('대조군: OFF 면 미승인이어도 기록도 차단도 없다(끈 게이트가 경보를 만들지 않는다)', async () => {
    const { svc, record } = mk(RESTRICTED, 'OFF');
    await expect(svc.startDispensing('ord-asp', 'ph-1')).resolves.toBeTruthy();
    expect(record).not.toHaveBeenCalled();
  });

  it('대조군: 미설정(기본 OFF)이어도 기록 없음 — 운영 현재 상태', async () => {
    const { svc, record } = mk(RESTRICTED, null);
    await expect(svc.startDispensing('ord-asp', 'ph-1')).resolves.toBeTruthy();
    expect(record).not.toHaveBeenCalled();
  });

  it('대조군: 제한항생제가 아니면 BLOCK 이어도 평가 대상이 아니다', async () => {
    const { svc, record } = mk(PLAIN, 'BLOCK');
    await expect(svc.startDispensing('ord-asp', 'ph-1')).resolves.toBeTruthy();
    expect(record).not.toHaveBeenCalled();
  });

  it('원장 기록이 실패해도 BLOCK 은 그대로 막는다(기록 장애가 게이트를 뚫지 않는다)', async () => {
    const { svc } = (() => {
      const p: any = {
        order: { findUnique: vi.fn().mockResolvedValue(RESTRICTED), update: vi.fn().mockResolvedValue({}) },
        prescription: { update: vi.fn().mockResolvedValue({}) },
        aspRequest: { findFirst: vi.fn().mockResolvedValue(null) },
        admission: { count: vi.fn().mockResolvedValue(0) },
        dispensing: { create: vi.fn().mockResolvedValue({ id: 'disp-1' }) },
        gateViolationLog: { create: vi.fn().mockResolvedValue({}) },
      };
      const failing = { record: vi.fn(async () => { throw new Error('ledger down'); }) } as unknown as SafetyGateService;
      return { svc: new PharmacyService(p, { emit: vi.fn() } as any, { enqueue: vi.fn() } as any, { get: vi.fn(async (k: string) => (k === 'asp.enforce' ? 'BLOCK' : null)) } as any, undefined, failing) };
    })();
    await expect(svc.startDispensing('ord-asp', 'ph-1')).rejects.toThrow(ConflictException);
  });
});

describe('pharmacy.highAlertDoubleCheck — 2인확인 미충족 위반이 원장에 남는다', () => {
  const item = (nameKo: string, high: boolean, sched: string | null) => ({
    medicationCode: { nameKo, highAlertFlag: high, controlSchedule: sched },
  });
  const HIGH_ALERT = {
    id: 'disp-1', status: 'PENDING', pharmacistId: 'ph-1', orderId: 'ord-1', patientId: 'p-1',
    items: [item('헤파린', true, null)],
    order: { prescriptionId: 'rx-1' },
  };
  const PLAIN = { ...HIGH_ALERT, items: [item('아세트아미노펜', false, null)] };

  let prisma: any;

  const mk = (dispensing: unknown, gateValue: string | null, checker: unknown = null) => {
    prisma = {
      dispensing: { findUnique: vi.fn().mockResolvedValue(dispensing), update: vi.fn().mockResolvedValue({ id: 'disp-1', items: [] }) },
      user: { findUnique: vi.fn().mockResolvedValue(checker) },
      $transaction: vi.fn(async (fn: any) =>
        fn({
          dispensing: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            update: vi.fn().mockResolvedValue({ id: 'disp-1', items: [] }),
          },
          order: { update: vi.fn().mockResolvedValue({}) },
        }),
      ),
    };
    const config = { get: vi.fn(async (k: string) => (k === 'pharmacy.highAlertDoubleCheck' ? gateValue : null)) };
    const g = mkGates();
    const svc = new PharmacyService(prisma, { emit: vi.fn() } as any, { enqueue: vi.fn() } as any, config as any, undefined, g.gates);
    return { svc, ...g };
  };

  it('BLOCK(기본·미설정) + 2차확인자 없음 — 원장에 BLOCK 으로 남고, 차단은 종전 그대로 409', async () => {
    const { svc, record, calls } = mk(HIGH_ALERT, null); // 운영 현재 상태: 미설정 → fail-closed BLOCK
    await expect(svc.completeDispensing('disp-1')).rejects.toThrow(ConflictException);
    expect(record).toHaveBeenCalledTimes(1);
    expect(calls[0][0]).toBe('pharmacy.highAlertDoubleCheck');
    expect(calls[0][1]).toBe('BLOCK');
    expect(calls[0][3]).toBe('Dispensing');
    expect(calls[0][4]).toBe('disp-1');
    // 🔴 집행 동작 불변 — 차단이므로 상태 전이 트랜잭션에 들어가지 않는다
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('WARN + 2차확인자 없음 — 원장에 WARN 으로 남되 막지 않는다(집행 동작 불변)', async () => {
    const { svc, record, calls } = mk(HIGH_ALERT, 'WARN');
    await expect(svc.completeDispensing('disp-1')).resolves.toBeTruthy();
    expect(record).toHaveBeenCalledTimes(1);
    expect(calls[0][1]).toBe('WARN');
  });

  it('마약류(controlSchedule)도 고위험약과 같은 모집단이다', async () => {
    const { svc, calls } = mk({ ...HIGH_ALERT, items: [item('모르핀', false, 'II')] }, 'WARN');
    await svc.completeDispensing('disp-1');
    expect(calls[0][0]).toBe('pharmacy.highAlertDoubleCheck');
  });

  // ── 대조군 ── 통과한 건은 남기지 않는다
  it('대조군: 유효한 2차 확인자가 있으면 기록도 차단도 없다', async () => {
    const { svc, record } = mk(HIGH_ALERT, 'BLOCK', { isActive: true, role: UserRole.PHARMACIST });
    await expect(svc.completeDispensing('disp-1', 'ph-2')).resolves.toBeTruthy();
    expect(record).not.toHaveBeenCalled();
  });

  it('대조군: OFF 면 2차확인자가 없어도 기록도 차단도 없다', async () => {
    const { svc, record } = mk(HIGH_ALERT, 'OFF');
    await expect(svc.completeDispensing('disp-1')).resolves.toBeTruthy();
    expect(record).not.toHaveBeenCalled();
  });

  it('대조군: 고위험약/마약류가 없으면 평가 대상이 아니다', async () => {
    const { svc, record } = mk(PLAIN, 'BLOCK');
    await expect(svc.completeDispensing('disp-1')).resolves.toBeTruthy();
    expect(record).not.toHaveBeenCalled();
  });

  it('🔴 자격 없는 2차 확인자(비활성)는 여전히 위반이다 — 게이트를 약화하지 않았다', async () => {
    const { svc, record, calls } = mk(HIGH_ALERT, 'BLOCK', { isActive: false, role: UserRole.PHARMACIST });
    await expect(svc.completeDispensing('disp-1', 'ph-2')).rejects.toThrow(ConflictException);
    expect(record).toHaveBeenCalledTimes(1);
    expect(calls[0][1]).toBe('BLOCK');
  });

  it('원장 기록이 실패해도 BLOCK 은 그대로 막는다', async () => {
    const p: any = {
      dispensing: { findUnique: vi.fn().mockResolvedValue(HIGH_ALERT), update: vi.fn() },
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(),
    };
    const failing = { record: vi.fn(async () => { throw new Error('ledger down'); }) } as unknown as SafetyGateService;
    const svc = new PharmacyService(p, { emit: vi.fn() } as any, { enqueue: vi.fn() } as any, { get: vi.fn(async () => 'BLOCK') } as any, undefined, failing);
    await expect(svc.completeDispensing('disp-1')).rejects.toThrow(ConflictException);
  });

  it('🔴 기록자가 주입되지 않아도 집행은 그대로다(다만 그 사실은 로그로 드러난다)', async () => {
    const p: any = {
      dispensing: { findUnique: vi.fn().mockResolvedValue(HIGH_ALERT), update: vi.fn() },
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(),
    };
    // gates 미주입 — SafetyGateModule 을 import 하지 않은 모듈에서 실제로 일어나는 상태
    const svc = new PharmacyService(p, { emit: vi.fn() } as any, { enqueue: vi.fn() } as any, { get: vi.fn(async () => 'BLOCK') } as any);
    await expect(svc.completeDispensing('disp-1')).rejects.toThrow(ConflictException);
  });
});
