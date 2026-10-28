/**
 * 🔴 (2026-09-14 P3) 예약 가능성 검증이 휴진 영향 조회와 다른 판정을 썼다 — 종일 세션에 반일 휴진이 걸리면 '휴진 아님'으로 통과.
 * 지키는 것: ① 오전 세션+오전 휴진 → 오전 예약 거부(BLOCK) ② 같은 날 오후 예약 통과 ③ 종일 세션+반일 휴진은 막지 않고 경고
 *           ④ 종일 휴진은 거부 ⑤ 휴진 판정은 closure-impact 정본 하나(소스 대조)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ScheduleService } from '../../src/modules/schedule/schedule.service';

const DATE = '2026-09-16';
const at = (hhmm: string) => new Date(`${DATE}T${hhmm}:00+09:00`);
const AM = { period: 'AM', startTime: '09:00', endTime: '12:30', maxPatients: 99 };
const PM = { period: 'PM', startTime: '13:30', endTime: '17:30', maxPatients: 99 };
const ALLDAY = { period: 'ALL', startTime: '09:00', endTime: '17:30', maxPatients: 99 };

function svc(schedules: unknown[], closures: unknown[]) {
  const prisma = {
    clinicSchedule: { findMany: vi.fn().mockResolvedValue(schedules) },
    clinicClosure: { findMany: vi.fn().mockResolvedValue(closures) },
    appointment: { count: vi.fn().mockResolvedValue(0) },
  };
  const config = { get: vi.fn().mockResolvedValue(undefined) }; // 기본: workingHours WARN · closure BLOCK · capacity WARN
  const s = new ScheduleService(prisma as any, config as any);
  (s as any).logger = { warn: vi.fn(), log: vi.fn(), error: vi.fn() };
  return s as any;
}

describe('validateBookable — 휴진 판정 정본', () => {
  it('① 오전 세션 + 오전 반휴진 → 오전 예약 거부', async () => {
    const s = svc([AM, PM], [{ id: 'c', period: 'AM' }]);
    await expect(s.validateBookable('d1', at('10:00'), 30)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('② 같은 날 오후 예약은 통과', async () => {
    const s = svc([AM, PM], [{ id: 'c', period: 'AM' }]);
    await expect(s.validateBookable('d1', at('14:00'), 30)).resolves.toEqual([]);
  });

  it('③ 종일 세션 + 반일 휴진 → 막지 않고 경고·기록(종전엔 조용히 통과)', async () => {
    const s = svc([ALLDAY], [{ id: 'c', period: 'AM' }]);
    const w: string[] = await s.validateBookable('d1', at('10:00'), 30);
    expect(w.some((x) => x.includes('반일 휴진'))).toBe(true);
    expect(s.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('③-경계 — 종일 세션 끝(17:30)에 딱 끝나는 예약도 같은 판정(경고)', async () => {
    const s = svc([ALLDAY], [{ id: 'c', period: 'PM' }]);
    const w: string[] = await s.validateBookable('d1', at('17:00'), 30);
    expect(w.some((x) => x.includes('반일 휴진'))).toBe(true);
  });

  it('④ 종일 휴진은 거부', async () => {
    const s = svc([ALLDAY], [{ id: 'c', period: null }]);
    await expect(s.validateBookable('d1', at('15:00'), 30)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('⑤ 휴진 판정은 closure-impact 하나 — 두 소비처가 같은 함수를 import 한다', () => {
    const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../src/modules', p), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(read('schedule/schedule.service.ts')).toMatch(/from '\.\.\/clinic-schedule\/closure-impact'/);
    expect(read('schedule/schedule.service.ts')).not.toMatch(/c\.period === covering\.period/);
    expect(read('clinic-schedule/clinic-schedule.service.ts')).toMatch(/from '\.\/closure-impact'/);
    expect(read('clinic-schedule/clinic-schedule.service.ts')).not.toMatch(/export function classifyClosureImpact/);
  });
});
