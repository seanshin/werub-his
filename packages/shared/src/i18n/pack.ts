/**
 * 언어 팩(Locale Pack) — **새 언어를 파일 하나로 추가하는 구조** (2026-09-07 사람 지시).
 *
 * 종전 구조는 언어를 늘리려면 영역 카탈로그 11개 파일(`messages/*.ts`)을 전부 열어
 * 각 파일의 en/ja/ar 옆에 새 언어를 끼워 넣어야 했다 — 언어가 늘수록 파일이 넓어지고,
 * 한 파일만 빠뜨려도 그 영역만 조용히 미번역이 된다(P2 에서 실제로 잡힌 함정).
 *
 * 팩 구조에서는:
 *   · 기존 영역 카탈로그(en/ja/ar)는 **빌트인 팩으로 자동 조립**된다(기존 데이터·동작 불변).
 *   · 새 언어는 `packs/<code>.ts` **한 파일**을 만들고 등재 한 줄이면 끝이다.
 *   · 팩은 **부분 번역을 허용**한다 — 없는 키는 한국어 원문 + 티(§2.2 3상태 그대로).
 *
 * 🔴 팩은 "표시"만 바꾼다 — 기록·저장·검색·집계·인쇄(법정 서식)는 불변(§0).
 * 🔴 팩을 추가한다고 **선택지에 자동으로 뜨지 않는다**: `status: 'ACTIVE'` 여야 한다.
 *    번역만 있고 레이아웃(RTL)·검수자가 없는 언어를 고르게 두면 "쓸 수 있는 것"으로 읽힌다
 *    (아랍어 결정 §8 이 그 사례다).
 */

export type LocalePackStatus =
  /** 화면 선택지에 노출 */
  | 'ACTIVE'
  /** 자산은 보존하되 선택지에서 제외(레이아웃·검수 미비 등 — 사유를 note 에) */
  | 'DEFERRED';

export interface LocalePack {
  /** 언어 코드(BCP-47 기본) — ko/en/ja/ar/zh/vi/ru/mn … */
  code: string;
  /** 자국어 표기 — 어느 언어 화면에서도 자기 언어를 찾을 수 있게 */
  label: string;
  /** 문자 방향. rtl 팩은 레이아웃 대응이 별도로 필요하다(§8) */
  dir: 'ltr' | 'rtl';
  /** 날짜·숫자 포맷용 BCP-47 태그. 임상 수치 오독 방지를 위해 숫자는 서구 숫자 권장(`-u-nu-latn`) */
  tag: string;
  status: LocalePackStatus;
  /** 키(한국어 원문) → 번역. 부분 번역 허용 */
  messages: Record<string, string>;
  /** 사람 검수 완료 키 — 비등재는 AI_DRAFT(미검수 티) */
  verified?: ReadonlySet<string>;
  /** 출처·검수 주체·미비 사유 등 — 관제 화면이 그대로 보여준다(지어내지 않는다) */
  note?: string;
}

const PACKS = new Map<string, LocalePack>();

/**
 * 팩 등록. 같은 코드로 다시 등록하면 **병합**한다(확장 팩) —
 * 나중 등록이 같은 키를 덮고, verified 는 합집합이다.
 */
export function registerLocalePack(pack: LocalePack): void {
  const prev = PACKS.get(pack.code);
  if (!prev) {
    PACKS.set(pack.code, pack);
    return;
  }
  PACKS.set(pack.code, {
    ...prev,
    ...pack,
    messages: { ...prev.messages, ...pack.messages },
    verified: new Set([...(prev.verified ?? []), ...(pack.verified ?? [])]),
  });
}

export function getLocalePack(code: string): LocalePack | undefined {
  return PACKS.get(code);
}

/** 등록된 전 팩(보류 포함) — 검수 관제용 */
export function allLocalePacks(): LocalePack[] {
  return [...PACKS.values()];
}

/** 화면 선택지에 뜨는 팩 */
export function activeLocalePacks(): LocalePack[] {
  return [...PACKS.values()].filter((p) => p.status === 'ACTIVE');
}

/** 팩에서 한 키를 찾는다 — 없으면 null(호출부가 원문+티로 처리) */
export function packLookup(code: string, key: string): { text: string; draft: boolean } | null {
  const p = PACKS.get(code);
  const hit = p?.messages[key];
  if (hit == null || hit === '') return null;
  return { text: hit, draft: !(p!.verified?.has(key) ?? false) };
}

/**
 * 🔴 **문맥 키 결손** — 무문맥 원문은 번역돼 있는데 그 문맥 변형(`원문@문맥`)이 없는 자리.
 *    이 자리는 미번역이 아니라 **뜻이 틀린 번역이 나가는 자리**다: `이탈` 이 활력 'Out of limit' 으로
 *    번역돼 있고 `이탈@CRM`(고객 이탈)이 없으면, CRM 화면이 "활력징후 이탈"을 보여준다.
 *    2026-09-09 실측에서 zh·th 5건, ru·kk·mn 4건이 그 상태였고 **사람이 손으로 찾아야 했다**.
 *    새 언어 팩이 늘수록 손으로는 못 찾는다 — 파생으로 만들어 가드와 화면이 함께 본다.
 *
 * @returns 코어에 문맥 키가 있고, 팩이 그 무문맥 원문은 가졌는데 문맥 키는 없는 키 목록(정렬)
 */
export function packContextGaps(code: string): string[] | null {
  const p = PACKS.get(code);
  const core = PACKS.get(COVERAGE_CORE_LOCALE);
  if (!p || !core) return null;
  const base = (k: string) => k.slice(0, k.lastIndexOf('@'));
  return Object.keys(core.messages)
    .filter((k) => k.lastIndexOf('@') > 0)
    .filter((k) => !p.messages[k] && !!p.messages[base(k)])
    .sort();
}

/** 팩 커버리지 — 관제 화면이 분모를 병기할 때 쓴다 */
export function packCoverage(code: string): { total: number; verified: number; draft: number } | null {
  const p = PACKS.get(code);
  if (!p) return null;
  const total = Object.keys(p.messages).filter((k) => p.messages[k]).length;
  const verified = [...(p.verified ?? [])].filter((k) => p.messages[k]).length;
  return { total, verified, draft: total - verified };
}

/* ── 커버리지 정직성 ─────────────────────────────────────────────────────────
 * 🔴 `packCoverage` 는 **분모가 자기 자신**이다 — 그 팩이 가진 키를 셀 뿐이라
 *    "vi 586키"까지만 말하고 "화면이 필요로 하는 6,175키 중 586"이라고는 말하지 못한다.
 *    그래서 추가 언어 6종(zh·ru·vi·kk·mn·th)이 **약 9% 커버리지로 ACTIVE** 인데도
 *    화면 어디에도 그 사실이 없었다(2026-09-07 실측 — `packCoverage` 소비처는 테스트 1곳뿐).
 *    그 언어를 고른 사용자는 화면의 90%를 한국어 원문+티로 본다.
 * 🔴 아래는 **읽기 전용 파생**이다 — 등록·조회·선택지 동작은 무엇도 바뀌지 않는다.
 *    막지도 않는다(부분 번역 언어를 못 고르게 하는 것은 사람 결정이다). 사실만 보인다.
 */

/**
 * 커버리지 **분모의 정본** — 코어 팩. 화면 크롬 문구의 전집을 담는 언어다.
 * (빌트인 조립에서 en/ja 는 키 집합이 같도록 가드가 걸려 있다 — i18n-pack.spec.ts)
 */
export const COVERAGE_CORE_LOCALE = 'en';

export interface LocaleCoverage {
  code: string;
  label: string;
  /** 이 언어가 실제로 가진 키 수(빈 값 제외) */
  translated: number;
  /** 🔴 분모 — 코어 팩 키 전집. **비율만 주지 않는다**(이 저장소 규약: 비율에는 분모를 함께) */
  coreTotal: number;
  /** 사람 검수 완료 키 수 — 나머지는 AI 초안(미검수) */
  verified: number;
  /** 코어 전집을 다 가졌는가. 🔴 `coreTotal === 0` 이면 **판정하지 않는다**(아래 참조) */
  complete: boolean;
  /**
   * 🔴 `coreTotal === 0`(코어 팩 미조립) — 0% 도 100% 도 아니고 **산출 불가**다.
   *    소비처는 이 값이 true 면 비율을 그리지 않는다.
   */
  unavailable: boolean;
}

/**
 * 한 언어의 커버리지 — 분모(코어 전집)를 **함께** 돌려준다.
 *
 * ko 는 팩이 없다: 한국어 원문이 곧 키이자 정본이라 미번역이라는 상태가 존재하지 않는다
 * (0/6,175 로 그리면 "한국어가 하나도 번역 안 됐다"는 거짓말이 된다).
 * 등록되지 않은 코드는 `null` — 0 으로 지어내지 않는다.
 */
export function localeCoverage(code: string): LocaleCoverage | null {
  const core = PACKS.get(COVERAGE_CORE_LOCALE);
  const coreTotal = core ? Object.keys(core.messages).filter((k) => core.messages[k]).length : 0;
  const unavailable = coreTotal === 0;
  if (code === 'ko') {
    return { code, label: '한국어', translated: coreTotal, coreTotal, verified: coreTotal, complete: true, unavailable };
  }
  const p = PACKS.get(code);
  if (!p) return null;
  const cov = packCoverage(code)!;
  return {
    code,
    label: p.label,
    translated: cov.total,
    coreTotal,
    verified: cov.verified,
    complete: !unavailable && cov.total >= coreTotal,
    unavailable,
  };
}

/** 선택지에 뜨는 언어들의 커버리지 — 언어 선택 UI 가 분모를 병기할 때 쓴다 */
export function activeLocaleCoverage(): LocaleCoverage[] {
  return activeLocaleCodes()
    .map((c) => localeCoverage(c))
    .filter((c): c is LocaleCoverage => c != null);
}

/* ── 팩 기반 조회 헬퍼 ───────────────────────────────────────────────────────
 * 🔴 **팩 하나를 넣으면 화면 선택지에 뜬다** — 소비처(셀렉트·포맷·검증)가 이 헬퍼를
 *    쓰기 때문이다. 종전엔 `UI_LOCALES` 하드코딩이라 팩을 넣어도 화면이 몰랐다.
 *    한국어(ko)는 팩이 없다 — 원문이 정본이라 번역 데이터가 필요 없기 때문이다.
 */

/** 선택 가능한 언어 코드 — ko(원문) + ACTIVE 팩 */
export function activeLocaleCodes(): string[] {
  return ['ko', ...activeLocalePacks().map((p) => p.code)];
}

/** 선택 가능한 언어 목록(표시용) */
export function activeLocaleOptions(): { code: string; label: string }[] {
  return [{ code: 'ko', label: '한국어' }, ...activeLocalePacks().map((p) => ({ code: p.code, label: p.label }))];
}

/** 저장·복원 시 검증 — 선택지에 없는 코드는 받지 않는다(보류 언어 포함) */
export function isActiveLocale(v: unknown): v is string {
  return typeof v === 'string' && activeLocaleCodes().includes(v);
}

/** 날짜·숫자 포맷용 BCP-47 태그. 미등록이면 한국어 기준(지어내지 않는다) */
export function localeTagOf(code: string): string {
  if (code === 'ko') return 'ko-KR';
  return PACKS.get(code)?.tag ?? 'ko-KR';
}

/** 문자 방향 — 팩이 정한다. 미등록은 ltr */
export function localeDirOf(code: string): 'ltr' | 'rtl' {
  if (code === 'ko') return 'ltr';
  return PACKS.get(code)?.dir ?? 'ltr';
}

/** 표시 라벨 — 미등록이면 코드 그대로(모르는 것을 아는 척하지 않는다) */
export function localeLabelOf(code: string): string {
  if (code === 'ko') return '한국어';
  return PACKS.get(code)?.label ?? code;
}
