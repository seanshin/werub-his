/**
 * 운영 모드 정본 — **개발 / 리허설 / 리얼**.
 *
 * 왜 있는가
 *   개시 전에는 "각종 단계를 다양하게 눌러 봐야" 하고(리허설), 개시 후에는 그 통로가
 *   **원천적으로 없어야** 한다(리얼). 종전에는 그 구분이 `NEXT_PUBLIC_SHOW_TEST_ACCOUNTS`
 *   하나뿐이었고, 그마저 **어디에도 정의되지 않아 개발기에서도 꺼져 있었다**(2026-08-25 사람 신고).
 *
 * 🔴 **모드는 두 층이다. 층을 섞으면 거짓말이 된다.**
 *   ① **빌드 모드(상한)** — 무엇이 번들·서버에 **들어갈 수 있는가**. `REAL` 빌드에는 시드 계정
 *      모듈이 **아예 없다**(조건부 렌더나 런타임 플래그로는 값이 번들에 남아 그대로 검색된다 —
 *      2026-08-24 WEB-SEC-01 에서 실측된 사실이다).
 *   ② **런타임 모드(토글)** — 그 안에서 **지금 무엇을 보이게 할 것인가**. 관리 화면에서 즉시 바꾼다.
 *
 *   런타임은 **더 좁히기만 한다.** 리얼 빌드에서 런타임을 `DEV` 로 놓아도 없는 모듈은 살아나지 않는다.
 *   그래서 `resolveHisMode` 는 **둘 중 더 제한적인 쪽**을 고른다 — 화면이 가진 적 없는 능력을
 *   가진 척하지 않기 위해서다.
 *
 * 🔴 기본값은 `REAL` 이다. 위험한 쪽(=시드 노출)은 **명시적 옵트인**이어야 한다
 *   ("운영에 NODE_ENV 가 없다"에서 배운 것 — 설정돼 있겠지 싶은 변수에 안전을 걸지 않는다).
 */

export const HIS_MODES = ['DEV', 'REHEARSAL', 'REAL'] as const;
export type HisMode = (typeof HIS_MODES)[number];

/** 제한 강도. 큰 값일수록 제한적이다(REAL 이 가장 제한적). */
const RESTRICTION: Record<HisMode, number> = { DEV: 0, REHEARSAL: 1, REAL: 2 };

/** 아무 값도 확인되지 않을 때의 모드 — 🔴 가장 제한적인 쪽. */
export const HIS_MODE_FALLBACK: HisMode = 'REAL';

/** 문자열 → 모드. 모르는 값은 만들어내지 않고 `null` 을 돌려준다(부르는 쪽이 정한다). */
export function parseHisMode(value: unknown): HisMode | null {
  const v = String(value ?? '').trim().toUpperCase();
  return (HIS_MODES as readonly string[]).includes(v) ? (v as HisMode) : null;
}

/**
 * 실효 모드 = 빌드 상한과 런타임 토글 중 **더 제한적인 쪽**.
 * 런타임이 없거나(미설정) 해석 불가면 빌드 모드를 그대로 쓴다 — 모르는 값으로 넓히지 않는다.
 */
export function resolveHisMode(buildMode: HisMode | null, runtimeMode: HisMode | null): HisMode {
  const build = buildMode ?? HIS_MODE_FALLBACK;
  if (!runtimeMode) return build;
  return RESTRICTION[runtimeMode] >= RESTRICTION[build] ? runtimeMode : build;
}

/** 런타임 토글이 실제로 효력을 갖는가 — 빌드보다 넓히려 한 경우 화면이 그 사실을 말해야 한다. */
export function isRuntimeModeEffective(buildMode: HisMode | null, runtimeMode: HisMode | null): boolean {
  if (!runtimeMode) return true;
  return RESTRICTION[runtimeMode] >= RESTRICTION[buildMode ?? HIS_MODE_FALLBACK];
}

/** 런타임 설정 키(SystemConfig). 카테고리 `mode`. */
export const HIS_MODE_CONFIG_KEY = 'mode.current';

export interface HisModeMeta {
  mode: HisMode;
  /** 화면에 그대로 쓰는 이름 */
  label: string;
  /** 배너 한 줄 — 무엇을 뜻하는지 사람 말로(비인증 화면·설명이 필요한 자리) */
  banner: string;
  /** 🔴 상시 노출되는 자리(전 화면 상단)용 **짧은** 표기. 길면 자리를 잡아먹고 곧 안 읽힌다. */
  short: string;
  /** 배너 색조(FE 가 해석) */
  tone: 'info' | 'warn' | 'none';
}

export const HIS_MODE_META: Record<HisMode, HisModeMeta> = {
  DEV: {
    mode: 'DEV',
    label: '개발',
    banner: '개발 모드 — 시드(가상) 데이터입니다. 실환자 기록이 아니며 대외 발신은 나가지 않습니다.',
    short: '시드 데이터 · 대외 발신 차단',
    tone: 'info',
  },
  REHEARSAL: {
    mode: 'REHEARSAL',
    label: '리허설',
    banner: '리허설 모드 — 실환자 데이터가 아닙니다. 문자·메일·기관 전송은 실제로 나가지 않습니다.',
    short: '시드 데이터 · 대외 발신 차단',
    tone: 'warn',
  },
  REAL: {
    mode: 'REAL',
    // 🔴 리얼에서는 배너를 띄우지 않는다. 상시 배너는 곧 읽히지 않게 되고,
    //    그러면 리허설 배너도 같이 안 보이게 된다(거짓 경보가 진짜 경보를 죽인다).
    label: '실운영',
    banner: '',
    short: '',
    tone: 'none',
  },
};

/** 시드 로그인(직원 계정·딜러 계정·시드 환자 MRN) 노출 여부 — 리얼에서는 언제나 false. */
export function allowsSeedLogin(mode: HisMode): boolean {
  return mode !== 'REAL';
}

/**
 * 대외 발신이 실제로 나갈 수 있는가 — 리얼이 아니면 **설정과 무관하게** 나가지 않는다.
 * 🔴 리허설 중 실제 문자가 환자에게 가는 사고를 막는 것이 이 함수의 전부다.
 *    (반대로 이것이 `true` 라고 발신이 켜졌다는 뜻은 아니다 — 채널별 3조건은 그대로 적용된다.)
 */
export function allowsOutboundSend(mode: HisMode): boolean {
  return mode === 'REAL';
}

/** 시드 데이터 배지를 화면에 붙이는가 — 리얼에서는 시드가 없어야 하므로 붙이지 않는다. */
export function showsSeedBadge(mode: HisMode): boolean {
  return mode !== 'REAL';
}

/**
 * 결정적 시드 UUID 표식 — `00000000-0000-4000-…`.
 *
 * 🔴 이것은 **네 가지 시드 표식 중 하나**일 뿐이다(접두·해시 UUID·컬럼·시각 군집).
 *    나머지는 이 함수로 판정하지 못한다 — **"배지가 없다"가 "실데이터다"라는 뜻은 아니다.**
 *    화면은 그 한계를 함께 말한다.
 */
export function isSeedUuid(id: unknown): boolean {
  return typeof id === 'string' && /^00000000-0000-4000-/i.test(id);
}
