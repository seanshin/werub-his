/**
 * 방문의 끝 — 2026-10-03 사람 결정(사용자) D8 `journey.outpatientEnd` = BILLING_PAID · D9 `emergency.departureTimeSource` = DEPARTED_AT_FIELD.
 *  D9 · 🔴 종전: 퇴실 확정은 상태만 바꾸고 시각을 남기지 않아 응급 체류(ED LOS)를 잴 수 없었다
 *     → 퇴실(귀가·전원)·입원 전환·사망에서 퇴실 시각 · 직원이 넣은 과거 시각은 USER_CLAIMED · 도착 이전·미래 거부
 *     · 자동 종결은 떠난 시각을 모르니 비운다 · 응급실을 떠나면 위치를 그 시각으로 닫는다(입원 전환은 병동 위치가 잇는다)
 *  D8 · 🔴 종전: 수납 완료가 "약국 대기" 위치를 새로 열어 그 위치가 남았다 → 외래 진료 수납이면 위치를 닫는다(입원·응급 진행 중 제외)
 * 재주입: 퇴실 시각 기록·출처·검증·이벤트·자동 종결 공백·수납 닫기 조건을 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EmergencyService } from '../../src/modules/emergency/emergency.service';
import { FloorLocationListener } from '../../src/modules/floor/floor-location.listener';
import { FloorService } from '../../src/modules/floor/floor.service';
import { JourneyService } from '../../src/modules/journey/journey.service';

const ARRIVAL = new Date('2026-10-03T00:00:00Z');
const src = (rel: string) => readFileSync(join(__dirname, '../..', rel), 'utf8');

function er(over: Record<string, unknown> = {}) {
  const update = vi.fn(async (a: any) => a);
  const prisma: any = {
    emergencyVisit: { findUnique: vi.fn(async () => ({ id: 'v1', patientId: 'p1', status: 'IN_TREATMENT', disposition: 'DISCHARGE', arrivalAt: ARRIVAL, ...over })), update },
  };
  const journey = { emit: vi.fn() };
  const events = { emit: vi.fn() };
  const svc = new EmergencyService(prisma, journey as never, undefined, undefined, events as never);
  return { svc, update, journey, events };
}

describe('D9 응급 퇴실 시각', () => {
  it('🔴 비우면 처리 시각(RECORDED)으로 남기고 위치 닫기 이벤트·여정 발생 시각을 같은 값으로', async () => {
    const { svc, update, journey, events } = er();
    const r: any = await svc.checkout('v1', 'u1');
    const data = update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'COMPLETED', departedAtSource: 'RECORDED' });
    expect(data.departedAt).toBeInstanceOf(Date);
    expect(r.departedAtSource).toBe('RECORDED');
    expect(events.emit).toHaveBeenCalledWith('emergency.departed', { visitId: 'v1', patientId: 'p1', departedAt: data.departedAt.toISOString(), reason: 'DISCHARGE' });
    expect(journey.emit.mock.calls[0][0]).toMatchObject({ eventType: 'ER_CHECKOUT', occurredAt: data.departedAt, occurredAtSource: 'DOMAIN_FIELD' });
  });

  it('🔴 직원이 넣은 과거 시각은 그 시각 + USER_CLAIMED(입력값으로 표식)', async () => {
    const { svc, update, journey } = er();
    await svc.checkout('v1', 'u1', '2026-10-03T02:30:00Z');
    expect(update.mock.calls[0][0].data).toMatchObject({ departedAt: new Date('2026-10-03T02:30:00Z'), departedAtSource: 'USER_CLAIMED' });
    expect(journey.emit.mock.calls[0][0].occurredAtSource).toBe('USER_CLAIMED');
  });

  it('🔴 도착 이전·미래(2분 넘게)·형식 오류는 거부 — 확실히 틀린 시각을 원장에 박지 않는다', async () => {
    const { svc, update } = er();
    await expect(svc.checkout('v1', 'u1', '2026-10-02T23:59:00Z')).rejects.toThrow(/도착 시각보다 앞/);
    await expect(svc.checkout('v1', 'u1', new Date(Date.now() + 10 * 60_000).toISOString())).rejects.toThrow(/지금보다 뒤/);
    await expect(svc.checkout('v1', 'u1', 'not-a-date')).rejects.toThrow(/형식/);
    expect(update).not.toHaveBeenCalled();
  });

  it('🔴 경로별 — 입원 전환·사망은 처리 시각을 남긴다 · 입원 전환은 위치 닫기 이벤트를 내지 않는다 · 자동 종결은 비운다', () => {
    const s = src('src/modules/emergency/emergency.service.ts');
    const admit = s.slice(s.indexOf('async transferToAdmission'), s.indexOf('async transferToAdmission') + 4000);
    expect(admit).toMatch(/status: 'COMPLETED',\s*departedAt: new Date\(\),\s*departedAtSource: 'RECORDED'/);
    expect(admit).not.toMatch(/emitDeparted\(/);
    expect(s).toMatch(/data: \{ status: 'COMPLETED', departedAt, departedAtSource: 'RECORDED' \} \}\);\s*await this\.erBeds\?\.releaseByVisit\(visitId, 'DISPOSITION'\);\s*this\.emitDeparted\(visit\.patientId, visitId, departedAt, 'DEATH'\)/);
    const auto = s.slice(s.indexOf("emergency.staleVisitAutoCloseHours"), s.indexOf("emergency.staleVisitAutoCloseHours") + 2500);
    expect(auto).toMatch(/status: 'COMPLETED'/);
    expect(auto).not.toMatch(/departedAt/);
  });

  it('컨트롤러가 본문의 퇴실 시각을 넘긴다 · DTO 는 ISO 시각만', () => {
    expect(src('src/modules/emergency/emergency.controller.ts')).toMatch(/this\.service\.checkout\(visitId, userId, body\?\.departedAt\)/);
    expect(src('src/modules/emergency/dto/checkout.dto.ts')).toMatch(/@IsOptional\(\) @IsISO8601\(\)\s*departedAt\?: string;/);
  });
});

describe('응급 퇴실 → 위치 닫기', () => {
  it('🔴 퇴실 시각으로 닫는다 · 그 시각보다 뒤에 들어온 열린 기록은 건드리지 않는다', async () => {
    const floor = { closeOpenLocations: vi.fn(async () => ({ closed: 1 })) };
    await new FloorLocationListener(floor as never).onEmergencyDeparted({ visitId: 'v1', patientId: 'p1', departedAt: '2026-10-03T02:30:00.000Z', reason: 'DISCHARGE' });
    expect(floor.closeOpenLocations).toHaveBeenCalledWith({ patientId: 'p1', closedBy: 'ER_DEPARTED:DISCHARGE', closeSource: 'INFERRED_EVENT', eventRef: 'v1', at: new Date('2026-10-03T02:30:00.000Z') });

    const tx: any = {
      $executeRaw: vi.fn(async () => 1),
      patientLocation: { findMany: vi.fn(async () => []), update: vi.fn() },
    };
    const svc = new FloorService({ $transaction: async (cb: any) => cb(tx) } as never);
    const at = new Date('2026-10-03T02:30:00Z');
    await svc.closeOpenLocations({ patientId: 'p1', closedBy: 'X', closeSource: 'INFERRED_EVENT', at });
    expect(tx.patientLocation.findMany.mock.calls[0][0].where).toEqual({ patientId: 'p1', leftAt: null, enteredAt: { lte: at } });
  });
});

describe('D8 외래 끝 = 수납 완료 → 위치 닫기', () => {
  const make = (enc: Record<string, unknown> | null, counts = { admitted: 0, er: 0 }) => {
    const prisma: any = {
      billing: { findUnique: vi.fn(async () => (enc ? { encounter: enc } : null)) },
      admission: { count: vi.fn(async () => counts.admitted) },
      emergencyVisit: { count: vi.fn(async () => counts.er) },
      spaceNode: { findMany: vi.fn(async () => []) },
    };
    const floor = { closeOpenLocations: vi.fn(async () => ({ closed: 1 })), recordLocation: vi.fn() };
    const svc = new JourneyService(prisma, floor as never) as unknown as { updatePatientLocation: (e: unknown, id: string) => Promise<void> };
    return { svc, floor };
  };
  const paid = { patientId: 'p1', eventType: 'BILLING_PAID', refType: 'Billing', refId: 'b1' };

  it('🔴 외래 진료 수납이면 닫는다(약국 대기를 새로 열지 않는다)', async () => {
    const { svc, floor } = make({ visitType: 'OUTPATIENT', admissionId: null });
    await svc.updatePatientLocation(paid, 'je1');
    expect(floor.closeOpenLocations).toHaveBeenCalledWith({ patientId: 'p1', closedBy: 'OUTPATIENT_PAID', closeSource: 'INFERRED_EVENT', eventRef: 'b1' });
    expect(floor.recordLocation).not.toHaveBeenCalled();
  });

  it.each([
    ['입원 진료 수납', { visitType: 'INPATIENT', admissionId: 'a1' }, { admitted: 0, er: 0 }],
    ['응급 협진 수납', { visitType: 'ER_CONSULT', admissionId: null }, { admitted: 0, er: 0 }],
    ['지금 재원 중', { visitType: 'OUTPATIENT', admissionId: null }, { admitted: 1, er: 0 }],
    ['응급 진행 중', { visitType: 'OUTPATIENT', admissionId: null }, { admitted: 0, er: 1 }],
  ])('🔴 %s이면 닫지 않는다(그 머묾이 정본)', async (_n, enc, counts) => {
    const { svc, floor } = make(enc, counts);
    await svc.updatePatientLocation(paid, 'je1');
    expect(floor.closeOpenLocations).not.toHaveBeenCalled();
    expect(floor.recordLocation).not.toHaveBeenCalled();
  });

  it('시뮬레이터 수납은 닫지 않는다 · 수납 원장이 없으면 무동작', async () => {
    const a = make({ visitType: 'OUTPATIENT', admissionId: null });
    await a.svc.updatePatientLocation({ ...paid, metadata: { simulated: true } }, 'je1');
    expect(a.floor.closeOpenLocations).not.toHaveBeenCalled();
    const b = make(null);
    await b.svc.updatePatientLocation(paid, 'je1');
    expect(b.floor.closeOpenLocations).not.toHaveBeenCalled();
  });
});
