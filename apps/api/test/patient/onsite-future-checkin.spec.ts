import { describe, it, expect } from 'vitest';
import { onsitePatientWhere } from '../../src/modules/patient/onsite-filter';

/**
 * '원내' 판정 계약 — 2026-08-13 (화면 점검 W3 · 패턴 P1-ⓓ).
 *
 * 🔴 `checkedInAt` 에 **상한이 없어** "지금 병원에 있는 사람"에 아직 오지 않은 예약이 섞였다.
 *    실측(08:30): 대기 180건 중 **129건이 미래 접수**(최대 9시간 뒤).
 *    오늘 아침 진료실 대기·접수 데스크에서 같은 병을 고쳤는데 원내 판정에 남아 있었다 —
 *    **한 곳만 고치면 갈라진다**(이번이 세 번째 화면).
 */

type QueueCond = { waitingQueues?: { some?: { checkedInAt?: { gte?: Date; lte?: Date } } } };

describe('원내 환자 판정', () => {
  const now = new Date('2026-08-13T08:30:00+09:00');

  it('🔴 대기 조건에 상한(now)이 있다 — 미래 접수를 원내로 세지 않는다', () => {
    const where = onsitePatientWhere('waiting', now) as { OR: QueueCond[] };
    const q = where.OR.find((c) => c.waitingQueues);
    expect(q, '대기 조건이 없다').toBeTruthy();
    expect(q!.waitingQueues!.some!.checkedInAt!.lte, '상한이 없어 미래 접수가 섞인다').toEqual(now);
  });

  it('하한은 KST 오늘 시작 — 어제 접수는 원내가 아니다', () => {
    const where = onsitePatientWhere('waiting', now) as { OR: QueueCond[] };
    const gte = where.OR.find((c) => c.waitingQueues)!.waitingQueues!.some!.checkedInAt!.gte!;
    expect(gte.getTime()).toBeLessThan(now.getTime());
    expect(now.getTime() - gte.getTime()).toBeLessThanOrEqual(24 * 3600_000);
  });

  it("'오늘 예약'은 별도 상태로 센다(대기와 이중 계상하지 않게 칩이 분리돼 있다)", () => {
    const where = onsitePatientWhere('booked', now) as { OR: Array<Record<string, unknown>> };
    expect(JSON.stringify(where)).toMatch(/appointments/);
    expect(JSON.stringify(where)).not.toMatch(/waitingQueues/);
  });
});
