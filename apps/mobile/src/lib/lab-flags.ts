/**
 * 검사 결과 flag 판정 — 모바일 정본.
 *
 * 🔴 2026-08-14(W9) 신설. 종전 모바일 5개 화면이 전부 `flag !== 'NORMAL'` 로 이상 여부를
 *    판정했는데, 운영 서버가 실제로 내는 값은 두 벌이다(실측):
 *      · LabResultItem.flag        → 'N' | 'H' | 'L' | 'HH' | 'LL' | 'A' | null
 *      · 검진 유래(CheckupResultItem) → 'NORMAL' | 'HIGH' | 'LOW' | 'CRITICAL'
 *    그래서 정상('N')이 전부 "이상"으로 붉게 칠해지고(거짓 경보), 반대로 'H'/'HH' 는
 *    `flag === 'HIGH'` 비교에 걸리지 않아 ↑ 화살표도 위급 표시도 뜨지 않았다.
 *    → 거짓 경보는 진짜 경보를 죽인다. 두 벌을 모두 아는 판정 함수로 수렴한다.
 *
 * 판정 규칙은 `packages/shared/src/lab-flags.ts`(정본)와 동일하다. 모바일은 Metro 번들러가
 * 모노레포 workspace 를 물지 않아(watchFolders 설정 없음·package.json 에 의존성 없음)
 * `@hospital-run/shared` 를 import 할 수 없어 **의도적 미러**로 둔다.
 * 🔴 정본이 바뀌면 이 파일도 같이 바꿔야 한다.
 */

/** 위급 flag — HIS 는 HH/LL(·정성 AA)를 낸다. C·CC·CRITICAL·PANIC 은 외부·구데이터 방어. */
const CRITICAL_FLAGS = ['HH', 'LL', 'AA', 'C', 'CC', 'CRITICAL', 'PANIC'];

/** 정상으로 보는 값 — null/미판정은 "모른다"이지 "정상"이 아니다(아래 isAbnormalFlag 참조). */
const NORMAL_FLAGS = ['N', 'NORMAL'];

/** 이상(정상 아님). null/N/NORMAL 만 정상. 그 외 flag 는 전부 이상으로 본다(오정상 방지). */
export function isAbnormalFlag(f?: string | null): boolean {
  return !!f && !NORMAL_FLAGS.includes(f);
}

/** 위급(패닉값) — 즉시 확인 대상. */
export function isCriticalFlag(f?: string | null): boolean {
  return !!f && CRITICAL_FLAGS.includes(f);
}

/** 높음 방향(H·HH·HIGH) */
export function isHighFlag(f?: string | null): boolean {
  return f === 'H' || f === 'HH' || f === 'HIGH';
}

/** 낮음 방향(L·LL·LOW) */
export function isLowFlag(f?: string | null): boolean {
  return f === 'L' || f === 'LL' || f === 'LOW';
}

/**
 * 값 뒤에 붙일 방향 표식. 위급은 '!!' 를 덧붙여 H/L 과 구분한다.
 * flag 가 없으면(미판정) 아무것도 붙이지 않는다 — 모르는 것을 정상이라고 말하지 않는다.
 */
export function flagMark(f?: string | null): string {
  if (!f) return '';
  const critical = isCriticalFlag(f);
  if (isHighFlag(f)) return critical ? ' ↑!!' : ' ↑';
  if (isLowFlag(f)) return critical ? ' ↓!!' : ' ↓';
  if (critical) return ' !!';
  return isAbnormalFlag(f) ? ' *' : '';
}

/** 목록 배지용 라벨. 위급이 하나라도 있으면 '위급'이 '이상'을 이긴다. */
export function summarizeFlags(flags: Array<string | null | undefined>): {
  label: string;
  variant: 'error' | 'warning' | 'default';
} | null {
  if (flags.some(isCriticalFlag)) return { label: '위급', variant: 'error' };
  if (flags.some(isAbnormalFlag)) return { label: '이상', variant: 'warning' };
  return null;
}
