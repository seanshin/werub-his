import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **전 직군에게 열린 위젯이 특정 직군 전용 EP 를 부르면 매일 빨간 줄이 뜬다**
 *    (2026-08-29 · 발굴 16회차 · 역할별 실로그인 실측).
 *
 * 실측: 대시보드 기본 위젯을 각 역할로 열어보니
 *  · DOCTOR·NURSE → 실패 0/6
 *  · 🔴 NUTRITION·MEDICAL_RECORDS·LAB_TECH·CHECKUP → **4/6 실패** · PHARMACIST 3 · RECEPTIONIST 2
 *
 * 원인 중 하나가 `my-today` 위젯이었다 — `roles: []`(전 직군)인데
 * `/api/v1/appointments?doctorId=<나>` 를 불렀다. **`doctorId=나` 는 진료 직군의 개념**이다.
 *
 * 🔴 **화면은 정직했다** — 403 을 "0건"이 아니라 "조회 실패"(빨강)로 그렸다.
 *    그래서 이것은 **거짓말이 아니라 거짓 경보**다. 거짓 경보는 진짜 경보를 죽인다.
 * 🔴 **EP 를 여는 것이 답이 아니다** — 남의 예약을 보여줄 이유가 없다. **묻지 않는 것**이 답이다.
 */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, 'src', p), 'utf8');
/**
 * 🔴 **주석을 벗기고 본다.** "종전엔 `.catch(() => [])` 였다"고 **설명한 주석**이
 *    "되살아났다" 검사에 걸린다 — 이 세션에서만 다섯 번째 같은 함정
 *    (주석 · import 문 · 변수 선언 · 다시 주석 · 또 주석).
 */
const strip = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const W = 'app/(main)/dashboard/components/widgets/MyTodayWidget.tsx';

describe('🔴 전 직군 위젯이 진료 직군 전용 EP 를 부르지 않는다', () => {
  const src = read(W);
  const code = strip(src); // 규약 검사는 주석을 벗긴 본문으로

  it('진료 직군일 때만 예약을 조회한다', () => {
    expect(src).toMatch(/seesOwnAppointments/);
    expect(src, 'enabled 로 호출 자체를 막는다').toMatch(/enabled:.*seesOwnAppointments/);
  });

  it('🔴 그 줄을 아예 그리지 않는다 — 없는 개념을 "조회 실패"로도 말하지 않는다', () => {
    expect(src).toMatch(/\{seesOwnAppointments && \(/);
  });

  it('🔴 값을 지어내지 않는다(대조군) — 숨긴다고 0 으로 채우면 더 나쁘다', () => {
    // 실패를 0건으로 접는 종전 관용구가 되살아나면 실패
    expect(code, '.catch(() => []) 가 되살아났다').not.toMatch(/\.catch\(\(\)\s*=>\s*\[\]\)/);
    // 조회 실패 표기 자체는 남아 있어야 한다(진료 직군에게는 여전히 필요하다)
    expect(src).toMatch(/조회 실패/);
  });

  it('근태 줄은 전 직군 공통이라 그대로 둔다(대조군 — 과하게 숨기지 않았다)', () => {
    expect(code, "근태 EP 가 바뀌었다").toMatch(/'\/api\/v1\/ess\/attendance'/);
    expect(src).toMatch(/미출근/);
  });
});
