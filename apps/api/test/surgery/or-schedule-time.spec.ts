import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SurgeryAdvancedService } from '../../src/modules/surgery/surgery-advanced.service';

const SRC = join(process.cwd(), 'src');
const strip = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * 수술실 시각 — 2026-09-03 운영 실측에서 나온 것.
 *
 * 🔴 `or_schedules.start_time` 은 **문자열**인데 형식이 강제되지 않아 `9:00` 한 건이 섞여 있었다.
 *    그 하나가 두 가지를 깼다:
 *      ① 목록이 문자열 오름차순이라 `… 13:00 14:52 15:00 9:00` — **오전 9시 수술이 오후 3시 뒤에**
 *      ② 현재 상태를 `s.startTime <= currentTime` 으로 판정하는데 `'9:00' <= '09:35'` 는 **거짓** —
 *         **수술 중인 방을 '사용 가능'으로** 표시했다. 빈 방인 줄 알고 배정하면 충돌이다.
 *
 *    수술 순서와 방 점유는 금식·마취 준비와 직결된다.
 */
const svc = SurgeryAdvancedService as unknown as {
  minutesOf: (t: string | null | undefined) => number;
};
const call = (s: unknown, rows: { status: string; startTime: string; endTime: string }[]) =>
  (s as { getRoomCurrentStatus: (r: unknown) => string }).getRoomCurrentStatus(rows);

describe('수술실 시각 — 문자열이 아니라 분으로 잰다', () => {
  it('🔴 0 을 안 채운 시각도 제대로 읽는다(기존 행은 그대로 남는다)', () => {
    expect(svc.minutesOf('9:00')).toBe(540);
    expect(svc.minutesOf('09:00')).toBe(540);
    expect(svc.minutesOf('15:00')).toBe(900);
    // 🔴 정렬이 뒤집히던 그 조합
    expect(svc.minutesOf('9:00')).toBeLessThan(svc.minutesOf('15:00'));
  });

  it('🔴 형식을 모르면 맨 뒤로 보내되 버리지 않는다(진행 중으로 오판하지 않는다)', () => {
    for (const bad of ['', 'abc', '25:00', '09:99', null, undefined]) {
      expect(svc.minutesOf(bad as string), `${String(bad)}`).toBe(Number.MAX_SAFE_INTEGER);
    }
  });

  it('🔴 수술 중인 방을 "사용 가능"이라 말하지 않는다 — 0 안 채운 시각이 섞여도', () => {
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    // 지금을 감싸는 일정을 0 안 채운 형식으로 만든다(운영에 실재하던 모양)
    const h = Math.floor(Math.max(cur - 30, 0) / 60);
    const start = `${h}:${String(Math.max(cur - 30, 0) % 60).padStart(2, '0')}`;   // 예: '9:05'
    const eh = Math.floor(Math.min(cur + 30, 1439) / 60);
    const end = `${String(eh).padStart(2, '0')}:${String(Math.min(cur + 30, 1439) % 60).padStart(2, '0')}`;
    const inst = Object.create(SurgeryAdvancedService.prototype);
    expect(call(inst, [{ status: 'SCHEDULED', startTime: start, endTime: end }]),
      `진행 중(${start}~${end})인데 빈 방이라 말하면 배정 충돌이 난다`).toBe('IN_USE');
  });

  it('취소된 일정은 방을 점유하지 않는다(대조군)', () => {
    const inst = Object.create(SurgeryAdvancedService.prototype);
    expect(call(inst, [{ status: 'CANCELLED', startTime: '00:00', endTime: '23:59' }])).toBe('AVAILABLE');
  });

  it('앞으로 있을 일정은 SCHEDULED, 지나간 것만 있으면 AVAILABLE(대조군)', () => {
    const inst = Object.create(SurgeryAdvancedService.prototype);
    expect(call(inst, [{ status: 'SCHEDULED', startTime: '23:58', endTime: '23:59' }])).toBe(
      new Date().getHours() * 60 + new Date().getMinutes() < 23 * 60 + 58 ? 'SCHEDULED' : 'AVAILABLE',
    );
    expect(call(inst, [{ status: 'SCHEDULED', startTime: '00:00', endTime: '00:01' }])).toBe(
      new Date().getHours() * 60 + new Date().getMinutes() < 1 ? 'IN_USE' : 'AVAILABLE',
    );
  });

  it('🔴 문자열 비교가 되돌아오지 않는다', () => {
    const src = strip(readFileSync(join(SRC, 'modules/surgery/surgery-advanced.service.ts'), 'utf-8'));
    expect(src, '시각을 사전순으로 비교하면 0 안 채운 값에서 뒤집힌다')
      .not.toMatch(/startTime\s*<=\s*currentTime|endTime\s*>\s*currentTime/);
    expect(src, '목록을 DB 문자열 정렬에 맡기면 9:00 이 15:00 뒤로 간다')
      .not.toMatch(/orderBy:\s*\{\s*startTime/);
    expect(src, '분 변환 정본이 있어야 한다').toMatch(/minutesOf/);
  });

  it('🔴 새 일정은 HH:MM(0 채움)만 받는다 — 관대함이 순서를 깬다', () => {
    const dto = strip(readFileSync(join(SRC, 'modules/surgery/dto/surgery-advanced.dto.ts'), 'utf-8'));
    const matches = dto.match(/@Matches\(\/\^\(\[01\]\\d\|2\[0-3\]\):\[0-5\]\\d\$\//g) ?? [];
    expect(matches.length, 'startTime·endTime 둘 다 형식을 강제해야 한다').toBeGreaterThanOrEqual(2);
  });
});
