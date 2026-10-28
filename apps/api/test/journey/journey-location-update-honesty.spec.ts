/**
 * 🔴 (2026-09-14 P3) 여정 발행 후 환자 위치 갱신 실패를 `.catch(() => {})` 로 삼켰다.
 * 지키는 것: ① 위치 갱신 실패는 warn 으로 남는다 ② 대조군 — 성공하면 warn 없음 ③ 발행 저장은 그대로(동작 불변)
 */
import { describe, expect, it, vi } from 'vitest';
import { JourneyService } from '../../src/modules/journey/journey.service';

const flush = () => new Promise((r) => setTimeout(r, 0));

function make() {
  const prisma = { patientJourneyEvent: { create: vi.fn().mockResolvedValue({ id: 'ev1' }) } };
  const svc = new JourneyService(prisma as any, {} as any);
  const warn = vi.fn();
  (svc as any).logger = { warn, log: vi.fn(), error: vi.fn() };
  return { svc, prisma, warn };
}

describe('여정 위치 갱신 실패 정직성', () => {
  it('① 위치 갱신 실패 → warn(이벤트 id·유형 포함)', async () => {
    const { svc, prisma, warn } = make();
    vi.spyOn(svc as any, 'updatePatientLocation').mockRejectedValue(new Error('zone lookup down'));
    svc.emit({ patientId: 'p1', eventType: 'ER_ARRIVAL', title: 't', refType: 'EmergencyVisit', refId: '11111111-1111-4111-8111-111111111111' } as any);
    await flush(); await flush();
    expect(prisma.patientJourneyEvent.create).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/ev1.*ER_ARRIVAL.*zone lookup down/);
  });

  it('② 대조군 — 위치 갱신 성공이면 warn 없음', async () => {
    const { svc, warn } = make();
    vi.spyOn(svc as any, 'updatePatientLocation').mockResolvedValue(undefined);
    svc.emit({ patientId: 'p1', eventType: 'ER_ARRIVAL', title: 't', refType: 'EmergencyVisit', refId: '11111111-1111-4111-8111-111111111111' } as any);
    await flush(); await flush();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('층별 이동 이벤트 발행 실패 정직성(2026-09-15)', () => {
  // 2026-09-28 P0-3: 위치 쓰기·이동 발행이 `FloorService.recordLocation` 하나로 모였다 — 가드도 그 정본을 겨눈다.
  it('③ 이동 발행 실패는 정본(floor.service)에서 삼키지 않고 warn 으로 남긴다 · 여정은 원장에 직접 쓰지 않는다', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const strip = (f: string) => fs.readFileSync(path.resolve(__dirname, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const floor = strip('../../src/modules/floor/floor.service.ts');
    const journey = strip('../../src/modules/journey/journey.service.ts');
    // 빈 catch(`catch {}` · `catch { /* 무시 */ }` 는 주석 제거 후 `catch {}` 가 된다) 금지
    expect(floor).not.toMatch(/catch\s*(\(\w*\))?\s*\{\s*\}/);
    expect((floor.match(/catch \(err\) \{\s*this\.logger\.warn/g) ?? []).length).toBeGreaterThanOrEqual(2); // emitMovement·emitLeave
    expect(journey).not.toMatch(/patientLocation\.(create|updateMany|update)\(/);
    expect(journey).toMatch(/this\.floor\.recordLocation\(/);
  });
});
