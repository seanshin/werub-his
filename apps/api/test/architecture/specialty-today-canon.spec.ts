import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SPECIALTY_DEPARTMENTS } from '../../src/common/specialty-board';

/**
 * 전문과 '오늘 현황' 정본 가드 (2026-08-13 · 화면 점검 W4).
 *
 * 🔴 12개 전문과 화면의 상단 4타일과 '오늘 환자 목록'이 **쿼리가 아니라 서버 리터럴**이었다:
 *    `async getToday() { return []; }` · `{ todayAppointments: 0, completed: 0, inProgress: 0, waiting: 0 }`.
 *    오늘 실예약이 있는 과들이 전부 "오늘 예약 0 / 오늘 예약된 환자가 없습니다"라고 말했다.
 *    한 과에서 고치고 나머지를 두면 다시 갈라지므로(W3 의 반복 교훈) 정본 사용을 강제한다.
 */
const MODULES = [
  'internal-medicine', 'orthopedics', 'neurosurgery', 'obgyn', 'pediatrics', 'psychiatry',
  'ophthalmology', 'ent', 'dermatology', 'dental', 'plastic', 'urology',
];
const SRC = join(process.cwd(), 'src/modules');

describe('전문과 오늘 현황 — 정본 사용 강제', () => {
  it('12과 전부 정본(specialty-board)을 경유한다', () => {
    const offenders = MODULES.filter((m) => {
      const p = join(SRC, m, `${m}.service.ts`);
      if (!existsSync(p)) return false;
      return !readFileSync(p, 'utf-8').includes('specialty-board');
    });
    expect(offenders, '이 과들은 오늘 현황을 자체 구현한다 — 정본에서 갈라진다').toEqual([]);
  });

  it('🔴 `return []` 스텁과 하드코딩 0 이 되살아나지 않는다', () => {
    const offenders: string[] = [];
    for (const m of MODULES) {
      const p = join(SRC, m, `${m}.service.ts`);
      if (!existsSync(p)) continue;
      const src = readFileSync(p, 'utf-8');
      if (/async getToday\(\)\s*\{\s*return \[\];/.test(src)) offenders.push(`${m}: getToday 스텁`);
      if (/todayAppointments:\s*0\s*,/.test(src)) offenders.push(`${m}: todayAppointments 하드코딩 0`);
    }
    expect(offenders, '재본 적 없는 값을 0 이라 단정하지 않는다(P1-ⓐ)').toEqual([]);
  });

  it('전문과 key 는 진료과 매핑을 갖는다 — 빠지면 그 과만 조용히 0 이 된다', () => {
    const missing = MODULES.filter((m) => !SPECIALTY_DEPARTMENTS[m]?.length);
    expect(missing).toEqual([]);
  });
});
