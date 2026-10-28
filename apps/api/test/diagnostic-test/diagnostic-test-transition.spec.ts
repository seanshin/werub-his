/**
 * 기초검사 상태 전이(취소·보류·보류 해제) — diagnostics-board-enhancement P2 (2026-09-14)
 *
 * 🔴 착수 전: 전이 EP 가 어느 상태로든 바꿨고, 사유를 **위험소견 메모(criticalNote)에 덮어써** 판독자의 위험소견을 지웠다.
 * 지키는 것:
 *  ① 전이표 전수 — shared 정본의 허용 전이는 통과, 나머지 전부 400(서비스가 자기 표를 따로 두지 않는다)
 *  ② 취소·보류는 사유 필수 · 사유는 statusReason 에 · criticalNote 는 건드리지 않는다
 *  ③ 결과 있는 검사 취소: 확인 없으면 409(무엇이 남았는지) · 확인하면 통과하고 결과는 그대로 · warnings HAS_RESULT
 *  ④ 오더·청구는 바꾸지 않는다 — 청구는 판정 불가로 말한다(대조군: 오더 update 호출 0)
 *  ⑤ 여정 이벤트 — 취소·보류·보류 해제만 발행
 *  ⑥ 보류·취소된 검사는 시작·판독 저장으로 되살아나지 않는다
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { DIAGNOSTIC_TEST_TRANSITIONS, DIAGNOSTIC_TEST_REASON_REQUIRED } from '@hospital-run/shared';
import { DomainException } from '../../src/common/errors/domain.exception';
import { DiagnosticTestService } from '../../src/modules/diagnostic-test/diagnostic-test.service';

/** 거절이 어떤 코드·상태로 나가는지까지 본다 — 예외 필터는 DomainException 의 code·details 만 응답에 싣는다 */
async function rejectsWith(p: Promise<unknown>, status: number, code: string) {
  const err = await p.then(() => null, (e) => e);
  expect(err, `거절돼야 한다: ${code}`).toBeInstanceOf(DomainException);
  expect({ status: (err as DomainException).getStatus(), code: (err as DomainException).domainCode }).toEqual({ status, code });
}

const ALL = ['ORDERED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED'];
const DTO_TARGETS = ['CANCELLED', 'ON_HOLD', 'SCHEDULED', 'ORDERED'];

function baseTest(over: Record<string, unknown> = {}) {
  return {
    id: 't1', patientId: 'p1', testType: 'EKG', testName: '심전도', status: 'ORDERED',
    scheduledAt: new Date('2026-09-15T01:00:00Z'), reportedAt: null, findings: null, impression: null, conclusion: null,
    measurements: null, criticalNote: '판독자 위험소견 메모', orderId: null, ...over,
  };
}

describe('DiagnosticTestService.transition', () => {
  let prisma: any;
  let journey: { emit: ReturnType<typeof vi.fn> };
  let svc: DiagnosticTestService;

  beforeEach(() => {
    prisma = {
      diagnosticTest: { findUnique: vi.fn(), update: vi.fn(async ({ data }: any) => ({ ...baseTest(), ...data })) },
      order: { findUnique: vi.fn(), update: vi.fn() },
    };
    journey = { emit: vi.fn() };
    svc = new DiagnosticTestService(prisma, undefined, journey as any);
  });

  it('① 전이표 전수 — 허용은 통과, 나머지는 400', async () => {
    let allowedSeen = 0;
    let rejectedSeen = 0;
    for (const from of ALL) {
      for (const to of DTO_TARGETS) {
        prisma.diagnosticTest.findUnique.mockResolvedValue(baseTest({ status: from }));
        const call = svc.transition('t1', to, '사유', 'u1', { acknowledgeResult: true });
        if ((DIAGNOSTIC_TEST_TRANSITIONS[from] ?? []).includes(to)) {
          await expect(call, `${from}→${to}`).resolves.toMatchObject({ status: to });
          allowedSeen++;
        } else {
          await rejectsWith(call, 400, 'DIAGNOSTIC_TRANSITION_NOT_ALLOWED');
          rejectedSeen++;
        }
      }
    }
    // 표본이 양쪽에 모두 있어야 이 검사가 빈 검사가 아니다
    expect(allowedSeen).toBeGreaterThan(5);
    expect(rejectedSeen).toBeGreaterThan(5);
  });

  it('② 취소·보류는 사유 필수 — 사유는 statusReason 에, criticalNote 는 그대로', async () => {
    for (const to of DIAGNOSTIC_TEST_REASON_REQUIRED) {
      prisma.diagnosticTest.findUnique.mockResolvedValue(baseTest());
      await rejectsWith(svc.transition('t1', to, '   ', 'u1'), 400, 'DIAGNOSTIC_TRANSITION_REASON_REQUIRED');
    }
    prisma.diagnosticTest.findUnique.mockResolvedValue(baseTest());
    await svc.transition('t1', 'ON_HOLD', '환자 발열', 'u1');
    const data = prisma.diagnosticTest.update.mock.calls.at(-1)[0].data;
    expect(data).toMatchObject({ status: 'ON_HOLD', statusReason: '환자 발열', statusChangedBy: 'u1' });
    expect(data.statusChangedAt).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty('criticalNote');
  });

  it('③ 결과 있는 검사 취소 — 확인 없으면 409, 확인하면 통과·결과 필드 무변경·HAS_RESULT', async () => {
    const withResult = baseTest({ status: 'COMPLETED', reportedAt: new Date(), findings: '동성리듬', measurements: { hr: 72 } });
    prisma.diagnosticTest.findUnique.mockResolvedValue(withResult);
    await rejectsWith(svc.transition('t1', 'CANCELLED', '중복 의뢰', 'u1'), 409, 'DIAGNOSTIC_HAS_RESULT');
    expect(prisma.diagnosticTest.update).not.toHaveBeenCalled();

    const out: any = await svc.transition('t1', 'CANCELLED', '중복 의뢰', 'u1', { acknowledgeResult: true });
    expect(out.warnings).toEqual(['HAS_RESULT']);
    const data = prisma.diagnosticTest.update.mock.calls.at(-1)[0].data;
    for (const k of ['findings', 'impression', 'conclusion', 'measurements', 'reportedAt']) expect(data).not.toHaveProperty(k);
  });

  it('③ 대조군 — 결과 없는 검사 취소는 확인 없이 통과하고 경고가 없다', async () => {
    prisma.diagnosticTest.findUnique.mockResolvedValue(baseTest());
    const out: any = await svc.transition('t1', 'CANCELLED', '환자 거부', 'u1');
    expect(out.warnings).toEqual([]);
  });

  it('④ 오더·청구는 바꾸지 않는다 — 오더 상태만 알리고 청구는 판정 불가', async () => {
    prisma.diagnosticTest.findUnique.mockResolvedValue(baseTest({ orderId: 'o1' }));
    prisma.order.findUnique.mockResolvedValue({ id: 'o1', status: 'ORDERED' });
    const out: any = await svc.transition('t1', 'CANCELLED', '환자 거부', 'u1');
    expect(out.impacts.order).toEqual({ id: 'o1', status: 'ORDERED', found: true });
    expect(out.impacts.billing).toEqual({ determinable: false, reason: 'BILLING_ITEM_HAS_NO_TEST_OR_ORDER_LINK' });
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(prisma.diagnosticTest.update).toHaveBeenCalledTimes(1);
  });

  it('⑤ 여정 이벤트 — 취소·보류·보류 해제만', async () => {
    prisma.diagnosticTest.findUnique.mockResolvedValue(baseTest());
    await svc.transition('t1', 'ON_HOLD', '장비 고장', 'u1');
    prisma.diagnosticTest.findUnique.mockResolvedValue(baseTest({ status: 'ON_HOLD' }));
    await svc.transition('t1', 'ORDERED', undefined, 'u1');
    prisma.diagnosticTest.findUnique.mockResolvedValue(baseTest({ status: 'ORDERED' }));
    await svc.transition('t1', 'SCHEDULED', undefined, 'u1'); // 이벤트 없음(대조군)
    prisma.diagnosticTest.findUnique.mockResolvedValue(baseTest());
    await svc.transition('t1', 'CANCELLED', '중복', 'u1');
    expect(journey.emit.mock.calls.map((c) => c[0].eventType)).toEqual(['DIAGNOSTIC_ON_HOLD', 'DIAGNOSTIC_RESUMED', 'DIAGNOSTIC_CANCELLED']);
  });

  it('예정 시각 없는 검사는 예정으로 옮기지 않는다', async () => {
    prisma.diagnosticTest.findUnique.mockResolvedValue(baseTest({ status: 'ON_HOLD', scheduledAt: null }));
    await expect(svc.transition('t1', 'SCHEDULED', undefined, 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('⑥ 보류·취소된 검사는 시작·판독 저장으로 되살아나지 않는다', async () => {
    for (const status of ['ON_HOLD', 'CANCELLED']) {
      prisma.diagnosticTest.findUnique.mockResolvedValue(baseTest({ status }));
      await expect(svc.perform('t1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.report('t1', { findings: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.diagnosticTest.update).not.toHaveBeenCalled();
  });
});
