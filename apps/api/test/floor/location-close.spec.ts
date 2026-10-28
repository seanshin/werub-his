/**
 * 위치 원장 — 떠난 환자의 위치를 닫는다 · 한 환자 한 열린 위치(2026-10-03).
 *  🔴 종전: 위치는 새 위치가 열릴 때만 닫혔다 — 떠난 환자의 마지막 위치가 영영 "현재"(운영 열린 위치 69 중 대부분이 7~9월 추정)
 *     · 퇴원은 "로비에 있다(완료)"를 **새로 열었다** · 같은 순간 들어온 사건 둘이 각자 열어 열린 위치가 둘인 환자 18명
 *  · 위치 쓰기는 환자별 잠금 뒤에서(열기·닫기 모두) · 닫기는 새 위치 없이 · 닫은 근거를 행에 남긴다(관측 퇴장과 구분)
 *  · 재원 종료(admission.closed — 퇴원·전원·입원 취소)가 닫는다 · 퇴원은 위치를 열지 않는다
 *  · 외래 끝(D8)·응급 퇴실(D9)은 사람 결정 전 — 닫지 않는다(처분 결정은 퇴실이 아니다)
 * 재주입: 잠금·닫기·근거 표식·리스너 배선·퇴원 매핑 제거·불변식을 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FloorService } from '../../src/modules/floor/floor.service';
import { FloorLocationListener } from '../../src/modules/floor/floor-location.listener';
import { JourneyService } from '../../src/modules/journey/journey.service';

const T0 = new Date('2026-10-03T00:00:00Z');
const src = (rel: string) => readFileSync(join(__dirname, '../..', rel), 'utf8');

function make(open: Array<{ id: string; zoneId: string; enteredAt: Date; metadata?: unknown }>) {
  const order: string[] = [];
  const tx: any = {
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...vals: unknown[]) => { order.push(`lock:${strings.join('?')}:${vals.join(',')}`); return 1; }),
    patientLocation: {
      findMany: vi.fn(async () => { order.push('findMany'); return open; }),
      update: vi.fn(async (a: any) => { order.push(`update:${a.where.id}`); return a; }),
      create: vi.fn(async (a: any) => { order.push('create'); return { id: 'new', ...a.data }; }),
    },
  };
  const prisma: any = { $transaction: async (cb: any) => cb(tx) };
  const svc = new FloorService(prisma);
  const leave = vi.spyOn(svc, 'emitLeave').mockResolvedValue(undefined);
  vi.spyOn(svc, 'emitMovement').mockResolvedValue(undefined);
  return { svc, tx, order, leave };
}

describe('환자별 잠금 — 한 환자 한 열린 위치', () => {
  it('🔴 위치를 열 때 열린 위치를 읽기 **전에** 그 환자 잠금을 잡는다(다른 환자와는 막지 않는다)', async () => {
    const { svc, order } = make([]);
    await svc.recordLocation({ patientId: 'p1', zoneId: 'z', source: 'OBSERVED_QR', granularity: 'ZONE', status: 'PRESENT' });
    expect(order[0]).toMatch(/^lock:.*pg_advisory_xact_lock\(hashtext\(.*:patient_location:p1$/);
    expect(order.indexOf('findMany')).toBeGreaterThan(0);
  });
});

describe('닫기 — 새 위치 없이', () => {
  it('🔴 열린 위치를 전부 닫는다(체류 분) · 닫은 근거를 남기고 기존 메타는 보존 · 새 위치를 열지 않는다 · 마지막 구역에서 떠남을 알린다', async () => {
    vi.useFakeTimers({ now: new Date(T0.getTime() + 40 * 60000) });
    const { svc, tx, order, leave } = make([
      { id: 'a', zoneId: 'z-ward', enteredAt: T0, metadata: { bedId: 'b1' } },
      { id: 'b', zoneId: 'z-er', enteredAt: new Date(T0.getTime() - 3600000), metadata: null },
    ]);
    const r = await svc.closeOpenLocations({ patientId: 'p1', closedBy: 'ADMISSION_CLOSED:DISCHARGE', closeSource: 'INFERRED_EVENT', eventRef: 'adm-1' });
    vi.useRealTimers();
    expect(r.closed).toBe(2);
    expect(order[0]).toMatch(/patient_location:p1/);
    expect(tx.patientLocation.create).not.toHaveBeenCalled();
    const a = tx.patientLocation.update.mock.calls[0][0].data;
    expect(a).toMatchObject({ duration: 40, metadata: { bedId: 'b1', closedBy: 'ADMISSION_CLOSED:DISCHARGE', closeSource: 'INFERRED_EVENT', closeRef: 'adm-1' } });
    expect(a.leftAt).toBeInstanceOf(Date);
    expect(tx.patientLocation.update.mock.calls[1][0].data.duration).toBe(100);
    expect(leave).toHaveBeenCalledWith('p1', 'z-ward');
  });

  it('대조군 — 열린 위치가 없으면 아무것도 쓰지 않고 떠남도 알리지 않는다', async () => {
    const { svc, tx, leave } = make([]);
    expect((await svc.closeOpenLocations({ patientId: 'p1', closedBy: 'X', closeSource: 'INFERRED_EVENT' })).closed).toBe(0);
    expect(tx.patientLocation.update).not.toHaveBeenCalled();
    expect(leave).not.toHaveBeenCalled();
  });
});

describe('재원 종료 → 위치 닫기', () => {
  it('🔴 admission.closed 를 받아 그 환자의 위치를 닫는다(사유를 근거로) · 환자 없으면 무동작 · 실패는 퇴원을 막지 않는다', async () => {
    const floor = { closeOpenLocations: vi.fn(async () => ({ closed: 1 })) };
    const l = new FloorLocationListener(floor as never);
    await l.onAdmissionClosed({ admissionId: 'adm-1', patientId: 'p1', reason: 'DISCHARGE' });
    expect(floor.closeOpenLocations).toHaveBeenCalledWith({ patientId: 'p1', closedBy: 'ADMISSION_CLOSED:DISCHARGE', closeSource: 'INFERRED_EVENT', eventRef: 'adm-1' });
    await l.onAdmissionClosed({ admissionId: 'adm-2' });
    expect(floor.closeOpenLocations).toHaveBeenCalledTimes(1);
    floor.closeOpenLocations.mockRejectedValueOnce(new Error('db'));
    await expect(l.onAdmissionClosed({ admissionId: 'adm-3', patientId: 'p3', reason: 'CANCELLED' })).resolves.toBeUndefined();
  });

  it('🔴 배선 — 모듈이 리스너를 싣고, 재원 종료를 내는 모든 자리가 환자를 싣는다 · 이벤트 이름이 같다', () => {
    expect(src('src/modules/floor/floor.module.ts')).toMatch(/providers: \[FloorService, FloorLocationListener\]/);
    expect(src('src/modules/floor/floor-location.listener.ts')).toMatch(/@OnEvent\('admission\.closed'/);
    const inp = src('src/modules/inpatient/inpatient.service.ts');
    const emits = [...inp.matchAll(/emit\('admission\.closed', \{([\s\S]*?)\}\)/g)].map((m) => m[1]);
    expect(emits.length).toBeGreaterThanOrEqual(2);
    for (const e of emits) expect(e).toMatch(/patientId:/);
  });
});

describe('퇴원은 위치를 열지 않는다', () => {
  it('🔴 여정 DISCHARGE 는 위치 매핑이 없다(종전 "로비·완료"를 새로 열어 영영 현재로 남았다) · 대조군: 입원은 병실을 연다', () => {
    const svc = Object.create(JourneyService.prototype) as { getLocationMapping: (e: unknown) => unknown };
    expect(svc.getLocationMapping({ eventType: 'DISCHARGE', patientId: 'p1' })).toBeNull();
    expect(svc.getLocationMapping({ eventType: 'ADMISSION', patientId: 'p1' })).toMatchObject({ spaceType: 'WARD_ROOM' });
    // 처분 결정·수납은 닫지 않는다(D8·D9 사람 결정 전) — 여전히 위치 매핑이 있다
    expect(svc.getLocationMapping({ eventType: 'ER_DISPOSITION', patientId: 'p1' })).not.toBeNull();
  });
});

describe('감시자 — 한 환자 열린 위치 둘 이상', () => {
  it('🔴 정합성 스캔에 불변식이 있고 소관이 정해져 있다', () => {
    const sql = readFileSync(join(__dirname, '../../../../infra/scripts/data-integrity-scan.sql'), 'utf8');
    expect(sql).toMatch(/SELECT '🟡', '87 위치 원장 — 열린 위치가 둘 이상인 환자'[\s\S]*?FROM \(SELECT patient_id FROM patient_locations WHERE left_at IS NULL GROUP BY patient_id HAVING count\(\*\) > 1\)/);
    expect(src('src/sentinel/sentinel-audience.ts')).toMatch(/'integrity\.87': 'ADMIN'/);
  });
});
