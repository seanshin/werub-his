/**
 * 서버 표시 문장 — `{ k, params }` 로 내려보내고 화면이 카탈로그로 조립한다.
 *
 * 🔴 (2026-09-15) 서버가 `\`입력 ${n} / 필수 ${m}\`` 처럼 한국어 문장을 값 보간으로 **조립해** 내려주면
 *    화면 언어를 무엇으로 바꿔도 그 줄은 한국어다 — 값이 문장 안에 녹아 있어 카탈로그로는 고칠 수 없다.
 *    그래서 서버는 **카탈로그 키(한국어 원문 + `{자리}`)와 값**만 보낸다. 화면은 `<ServerText msg>` 로 조립한다.
 *
 * - `k`      : 카탈로그 키 = 한국어 원문 문장, 자리표시자는 `{이름}` (web `<Tf>` 와 같은 문법)
 * - `params` : 자리 값. 숫자·코드·식별자는 그대로(번역 대상 아님),
 *              한국어 낱말 조각은 `{ k }` 로 보낸다 → 화면이 그 조각도 번역한다,
 *              문장 조각이 통째로 달라지는 자리는 `ServerMessage` 를 중첩한다.
 *
 * 설계 정본: `docs/01-plan/features/server-display-text-i18n.plan.md`
 */
export interface ServerMessageKey {
  k: string;
}

export type ServerMessageParam = string | number | ServerMessageKey | ServerMessage;

export interface ServerMessage {
  k: string;
  params?: Record<string, ServerMessageParam>;
}

const PLACEHOLDER = /\{([^{}]+)\}/g;

export function isServerMessage(v: unknown): v is ServerMessage {
  return !!v && typeof v === 'object' && typeof (v as { k?: unknown }).k === 'string';
}

/** 서버 표시 문장 생성 — 문자열 조립 대신 이것을 쓴다 */
export function serverMsg(k: string, params?: Record<string, ServerMessageParam>): ServerMessage {
  return params ? { k, params } : { k };
}

/**
 * 한국어 원문 폴백 — `detail` 같은 **종전 문자열 필드를 쓰는 소비처**(다른 서버 모듈·로그·외부 API 호출자)를 위해서만.
 * 화면은 이것을 그리지 않고 `msg` 를 조립한다. 자리 값이 비면 자리표시자를 그대로 남긴다(지어내지 않는다).
 */
export function renderServerMessageKo(m: ServerMessage): string {
  return m.k.replace(PLACEHOLDER, (whole, name: string) => {
    const v = m.params?.[name];
    if (v === undefined || v === null) return whole;
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    return isServerMessage(v) && v.params ? renderServerMessageKo(v) : v.k;
  });
}

/** 문장이 쓰는 카탈로그 키 전부(중첩·조각 포함) — 가드가 카탈로그 등재를 대조할 때 쓴다 */
export function serverMessageKeys(m: ServerMessage): string[] {
  const out = [m.k];
  for (const v of Object.values(m.params ?? {})) {
    if (v && typeof v === 'object') out.push(...serverMessageKeys(v as ServerMessage));
  }
  return out;
}
