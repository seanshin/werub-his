import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { requireDateParam, parseLocalDate } from '../../src/common/day-range';

/**
 * 🔴 **날짜 파싱 실패는 500 이 아니라 400 이다** (2026-08-30 · 발굴 26회차 · 모바일 앱 실측).
 *
 * 모바일 환자앱이 부르는 EP 39종을 환자 토큰으로 전부 눌러 **원격진료 슬롯 500** 을 잡았고,
 * 같은 모양을 찾으려 포털 GET 64종을 파라미터 없이 눌러 **3곳**을 확인했다:
 *   · `portal/telehealth-slots` · `portal/checkup-capacity` · `portal/appointments/availability`
 * 셋 다 `new Date(param)` 의 `Invalid Date` 가 그대로 Prisma 로 들어가 크래시했다.
 * 사용자는 "서버 오류"만 보고 **자기 입력 문제인 줄 모른다.**
 *
 * 🔴 **정본은 이미 있었다** — `parseLocalDate` 주석이 "Invalid Date 를 Prisma 로 넘기면 500 이
 *    난다"고 적어 뒀는데 세 곳이 그것을 쓰지 않았다. 400 으로 말하는 얇은 래퍼만 더했다.
 *
 * 🔴 availability 는 DTO 에 `@IsDateString()` 이 **있는데도** 터졌다 —
 *    컨트롤러가 `@Query('date')` 개별 인자로 받아 ValidationPipe 가 통째로 스킵된다(§규약 8).
 */
describe('🔴 필수 날짜 파라미터는 400 으로 말한다', () => {
  it('없거나 못 읽으면 BadRequest', () => {
    for (const bad of [undefined, null, '', '  ', 'not-a-date', '2026-13-99x']) {
      expect(() => requireDateParam(bad as string, '조회할 날짜'), `${String(bad)} 가 통과했다`)
        .toThrow(BadRequestException);
    }
  });

  it('읽을 수 있으면 로컬 자정 Date — 정본(parseLocalDate)과 같은 값이다', () => {
    const d = requireDateParam('2026-08-30', '조회할 날짜');
    expect(d.getTime()).toBe(parseLocalDate('2026-08-30')!.getTime());
    expect(d.getHours()).toBe(0);
  });

  it('🔴 메시지가 무엇을 어떻게 줘야 하는지 말한다 — "서버 오류"로 끝내지 않는다', () => {
    try { requireDateParam(undefined, '조회 시작일'); }
    catch (e) {
      const m = (e as BadRequestException).message;
      expect(m).toContain('조회 시작일');
      expect(m).toContain('YYYY-MM-DD');
      // 🔴 "날짜을(를)" 같은 기계 표기를 사람에게 보이지 않는다 — 받침으로 조사를 고른다
      expect(m, '조사 표기가 기계적이다').not.toContain('을(를)');
    }
    try { requireDateParam(undefined, '조회할 날짜'); }
    catch (e) {
      expect((e as BadRequestException).message).toContain('날짜를');
    }
  });
});

describe('🔴 500 이 났던 세 자리가 정본을 쓴다', () => {
  const svc = readFileSync(join(process.cwd(), 'src/modules/portal/portal.service.ts'), 'utf8');

  it('원격진료 슬롯·검진 정원·예약 가용시간이 requireDateParam 을 거친다', () => {
    for (const [fn, needle] of [
      ['getTelehealthSlots', "requireDateParam(date, '조회할 날짜')"],
      ['getCheckupCapacity', "requireDateParam(from, '조회 시작일')"],
      ['getAppointmentAvailability', "requireDateParam(query.date, '조회할 날짜')"],
    ] as const) {
      const i = svc.indexOf(fn);
      expect(i, `${fn} 을 찾지 못했다`).toBeGreaterThan(-1);
      expect(svc.slice(i, i + 1400), `${fn} 이 정본을 안 쓴다`).toContain(needle);
    }
  });

  it('🔴 검증 없는 `new Date(...)` 로 되돌아가지 않았다', () => {
    const i = svc.indexOf('getTelehealthSlots');
    const block = svc.slice(i, i + 900);
    expect(block, 'date 를 그대로 new Date 로 넘긴다').not.toMatch(/const d = new Date\(date\)/);
  });

  /**
   * 🔴 **한 건 고치고 끝내지 않는다** — 같은 레시피를 직원용 GET **896종**에 돌려
   *    5xx 만 걸러 6곳을 더 찾았다(2026-08-30 발굴 27회차, 전부 운영 실측).
   */
  it('직원용 EP 6곳도 정본을 거친다 — 같은 모양을 넓혀서 찾았다', () => {
    const read = (p: string) => readFileSync(join(process.cwd(), 'src/modules', p), 'utf8');
    const CASES: Array<[string, string, string]> = [
      ['schedule/schedule.service.ts', 'getDayGrid', "requireDateParam(query.date, '조회할 날짜')"],
      ['schedule/schedule.service.ts', 'getAvailability', "requireDateParam(query.date, '조회할 날짜')"],
      ['checkup/checkup.service.ts', 'getCapacity', "requireDateParam(query.from, '조회 시작일')"],
      ['checkup/checkup.service.ts', 'getMonthlyReport', 'YYYY-MM 형식으로'],
      ['crm/crm.service.ts', 'available-slots', "requireDateParam(date, '조회할 날짜')"],
      ['rehab/rehab.service.ts', 'getTherapistSchedule', "requireDateParam(date, '조회할 날짜')"],
    ];
    for (const [file, fn, needle] of CASES) {
      const src = read(file);
      // crm available-slots: 2026-09-14 예약 정본(getAvailability) 경유로 바뀌어 KST 범위 리터럴이 사라졌다 — 함수 이름으로 찾는다
      const i = fn === 'available-slots' ? src.indexOf('async proxyGetAvailableSlots') : src.indexOf(fn);
      expect(i, `${file}:${fn} 을 찾지 못했다`).toBeGreaterThan(-1);
      expect(src.slice(Math.max(0, i - 600), i + 900), `${file}:${fn} 이 검증을 안 거친다`).toContain(needle);
    }
  });

  it('공개 EP 도 잘못된 입력에 서버 오류를 내보이지 않는다', () => {
    const ctl = readFileSync(join(process.cwd(), 'src/modules/holiday/holiday.controller.ts'), 'utf8');
    expect(ctl).toContain("requireDateParam(date, '확인할 날짜')");
    expect(ctl, 'date 를 그대로 new Date 로 넘긴다').not.toMatch(/const d = new Date\(date\);/);
  });

  /**
   * 🔴 **외부 시스템의 상태코드를 그대로 되던지지 않는다** — Clinic 이 500 을 주면 우리도
   *    500 을 내보내 **우리 서버 오류로 읽혔다**(운영 실측). 연동처 장애는 502 로 말한다.
   *    4xx(우리가 잘못 보냄)는 그대로 전달해 원인을 감추지 않는다(대조군).
   */
  it('연동처 장애를 우리 오류로 말하지 않는다', () => {
    const svc = readFileSync(join(process.cwd(), 'src/modules/clinic-integration/clinic-api.service.ts'), 'utf8');
    expect(svc).toContain('CLINIC_UNAVAILABLE');
    expect(svc).toMatch(/upstream >= 500 \? HttpStatus\.BAD_GATEWAY : upstream/);
    expect(svc, '외부 상태코드를 그대로 되던진다').not.toMatch(/new HttpException\(`Clinic API error: \$\{res\.status\}`, res\.status\)/);
  });

  it('정본 주석이 이유를 남긴다(다음 사람이 같은 함정에 빠지지 않게)', () => {
    const canon = readFileSync(join(process.cwd(), 'src/common/day-range.ts'), 'utf8');
    expect(canon).toMatch(/export function requireDateParam/);
    expect(canon).toContain('500');
  });
});
