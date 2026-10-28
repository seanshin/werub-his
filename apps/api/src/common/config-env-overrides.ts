/**
 * 🔴 **배포로만 바꾸는 설정 키의 환경변수 정본**.
 *
 * `ai.server.url` 은 범용 설정 PUT 이 막아 두고 "변경은 배포(환경변수/마이그레이션)로만"이라 말했는데,
 * 정작 **그 환경변수를 읽는 코드가 없었다** — `AI_SERVER_URL` 은 env 스키마 선언에만 있었다.
 * 그래서 새로 설치하는 기관은 **DB 를 직접 고치는 수밖에** 없었고, 시드가 넣어 둔 다른 설치본 주소가 남았다.
 *
 * 🔴 **정본은 여기 하나다.** 이 키를 읽는 곳이 세 갈래였다(설정 서비스 · 의료 AI · 포털 복약 설명 —
 * 뒤 둘은 `system_configs` 를 직접 읽는다). 한 곳만 고치면 "관리 화면에는 환경변수 값이 보이는데
 * 실제 전송은 DB 주소로 나가는" 상태가 된다 — 정본을 만든 것과 소비처가 그것을 쓰는 것은 다른 일이다.
 */
export const CONFIG_ENV_OVERRIDES: Readonly<Record<string, string>> = {
  'ai.server.url': 'AI_SERVER_URL',
};

/** 환경변수로 덮인 값(문자열) — 없거나 비면 `undefined`(덮지 않는다) */
export function configEnvOverride(key: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const name = CONFIG_ENV_OVERRIDES[key];
  if (!name) return undefined;
  const v = env[name];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/** DB/기본값에서 읽은 값에 환경변수 덮어쓰기를 적용한다(소비처 공용) */
export function applyConfigEnvOverride<T>(key: string, value: T): T | string {
  return configEnvOverride(key) ?? value;
}
