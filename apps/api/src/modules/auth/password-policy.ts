import { randomInt as cryptoRandomInt } from 'node:crypto';

/**
 * 비밀번호 정책 — 🔴 **한 곳에서만 정한다.**
 *
 * 실측(2026-08-28)으로 드러난 것: 같은 정책이 **네 곳에 각자** 적혀 있었고 값이 전부 달랐다.
 *
 * | 경로 | 종전 | 문제 |
 * |---|---|---|
 * | 본인 변경(`changePassword`) | **12자 + 대소문자·숫자·특수문자·반복금지** | 이것이 선언된 기준("EMR 인증 기준") |
 * | 관리자 초기화 | 6자 → (1차 수정) 8자 | 🔴 선언 기준 아래 — **뒷문** |
 * | 사용자 생성 | 8자 | 🔴 선언 기준 아래 — **뒷문** |
 * | 설정 화면 `security.password.minLength` | 8 | 🔴 읽는 코드가 없다(미배선 고지함) |
 *
 * 🔴 **로그인 입력 하한은 정책이 아니다.** 로그인은 **이미 있는** 비밀번호를 받는다 —
 *    여기에 신규 정책(12자)을 걸면 그보다 짧은 비밀번호를 쓰는 **기존 계정이 전부 로그인
 *    불가**가 된다(운영 시드 계정이 10자다). 그래서 하한을 따로 둔다.
 *
 * 🔴 **DTO 데코레이터는 설정으로 만들지 않는다.** `class-validator` 의 데코레이터는
 *    클래스 로딩 시점에 값이 고정되어 런타임 설정을 읽을 수 없다 — 설정으로 두면
 *    "저장했는데 안 바뀐다"가 된다.
 *
 * 🔴 R9-④(2026-09-06): `security.password.minLength` 는 **런타임 함수 계층에서 강화 전용**으로
 *    배선했다 — 유효 하한 = max(12, config). 설정으로 12 아래로 **완화할 수 없고**(선언 기준이
 *    하한), 조회 실패 시에도 12 가 유지된다(fail-closed 방향). DTO 의 @MinLength 는 여전히
 *    상수 12(로딩 시점 고정)라, config 를 12 초과로 올리면 실제 거부는 서비스 계층에서 난다.
 *    `security.password.requireSpecial` 은 **키 자체를 제거**했다 — 특수문자 필수는 선언 기준
 *    (EMR 인증)의 일부라 완화 스위치가 성립하지 않고, true 는 이미 코드 동작과 같다(중복 정본).
 */

/** 신규·변경 비밀번호의 최소 길이 — 선언된 기준(EMR 인증) */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * 🔴 로그인 **입력** 하한 — 정책이 아니라 입력 sanity 다.
 *    올리면 기존 계정이 로그인하지 못한다(정책은 비밀번호를 **바꿀 때** 적용된다).
 */
export const LOGIN_INPUT_MIN_LENGTH = 8;

/**
 * 🔴 (2026-09-15) 비밀번호 **최대 사용 기간(일)** — 종전엔 판정(`isPasswordExpired` 의 `> 90`)과
 *    응답(`password-status` 의 `maxAgeDays: 90`)이 각자 90 을 적고 있었다(한쪽만 바뀌면 화면이 틀린 기간을 말한다).
 *    값은 종전 그대로(90). 바꾸는 것은 정책 결정이다.
 */
export const PASSWORD_MAX_AGE_DAYS = 90;

/**
 * 신규·변경 비밀번호 강도 검사 — 위반 목록을 돌려준다(빈 배열 = 통과).
 * 🔴 던지지 않고 **목록으로 돌려준다**: 호출부마다 예외 종류(401/400)가 다르고,
 *    사용자에게 "무엇이 부족한지"를 한 번에 말해야 한다.
 */
export function passwordPolicyViolations(password: string, opts?: { minLength?: number | null }): string[] {
  const errors: string[] = [];
  // 강화 전용 — config 는 하한(12)을 올릴 수만 있다. 이상값/미설정은 12.
  const cfg = Number(opts?.minLength);
  const minLength = Number.isFinite(cfg) && cfg > PASSWORD_MIN_LENGTH ? Math.floor(cfg) : PASSWORD_MIN_LENGTH;
  if ((password ?? '').length < minLength) errors.push(`최소 ${minLength}자 이상`);
  if (!/[A-Z]/.test(password)) errors.push('대문자 1자 이상');
  if (!/[a-z]/.test(password)) errors.push('소문자 1자 이상');
  if (!/[0-9]/.test(password)) errors.push('숫자 1자 이상');
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) errors.push('특수문자 1자 이상');
  if (/(.)\1{2,}/.test(password)) errors.push('동일 문자 3회 이상 반복 불가');
  return errors;
}

/**
 * 🔴 (2026-09-14) 관리자가 계정을 만들거나 초기화할 때 쓰는 **일회용 임의 비밀번호** — 종전엔 화면이 공용 기본값
 *    (시드 계정 비밀번호와 같은 문자열)을 채워 넣었다(공용 번역 청크로 모든 사용자에게 내려갔고, 10자·대문자 없음이라 이 정책을 통과하지도 못해
 *    등록·초기화가 400 으로 막히는 기본값이었다). 새 정책을 만들지 않는다 — 위 `passwordPolicyViolations` 를 통과할 때까지 뽑는다.
 *    난수는 `crypto.randomInt`(암호학적 난수) · 헷갈리는 글자(0/O·1/l/I)는 뺀다(구두 전달 오독 방지).
 */
export function generateCompliantPassword(minLength?: number | null, randomInt: (max: number) => number = cryptoRandomInt): string {
  const cfg = Number(minLength);
  const len = Math.max(16, Number.isFinite(cfg) && cfg > PASSWORD_MIN_LENGTH ? Math.floor(cfg) : PASSWORD_MIN_LENGTH);
  const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const LOWER = 'abcdefghijkmnopqrstuvwxyz';
  const DIGIT = '23456789';
  const SPECIAL = '!@#$%^&*-_=+?';
  const ALL = UPPER + LOWER + DIGIT + SPECIAL;
  const pick = (set: string) => set[randomInt(set.length)];
  for (let attempt = 0; attempt < 100; attempt++) {
    const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SPECIAL)];
    while (chars.length < len) chars.push(pick(ALL));
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    const candidate = chars.join('');
    if (passwordPolicyViolations(candidate, { minLength }).length === 0) return candidate;
  }
  // 100회 안에 못 뽑는 것은 난수원 결함이다 — 약한 값을 돌려주지 않고 실패한다
  throw new Error('generateCompliantPassword: could not produce a policy-compliant password');
}
