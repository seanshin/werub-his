import { HIS_MODE_FALLBACK, parseHisMode, type HisMode } from '@hospital-run/shared';

/**
 * 🔴 판매본(REAL) 보안 기본값 정본 — 2026-09-13 · 상용 릴리즈 기획 T4
 *    (`docs/01-plan/features/commercial-release-v1-freeze.plan.md`).
 *
 * 무엇이 틀려 있었나
 *   ① **공개된 개발용 비밀 폴백** — `PDF_SERVICE_TOKEN || 'hispdf-fixedtoken-dev'` 처럼 저장소에 적힌 문자열로
 *      떨어지는 자리가 4곳. 판매본에서 그 값을 안 넣으면 **누구나 아는 비밀로** 렌더 토큰·다운로드 토큰·AI 출처 서명을
 *      만들 수 있다.
 *   ② **`NODE_ENV` 분기 7곳**(쿠키 secure 5 · Swagger · 오류 details) — "미설정 = 안전"으로 짜여 있어 지금 운영에는
 *      해가 없지만, 설치하는 쪽이 `NODE_ENV=development` 를 넣는 순간 **REAL 서버에서 문서·오류 상세가 열리고 쿠키가
 *      평문으로 나간다**. 안전을 "설정돼 있겠지 싶은 변수"에 걸지 않는다(운영에 NODE_ENV 가 없어 4건 사고 — 2026-08-25).
 *   ③ **`ALLOW_*` 느슨한 스위치 5종 + `SWAGGER_ENABLED`** — 개발 편의 옵트인이 REAL 에서도 그대로 먹었다.
 *
 * 규칙
 *   · 🔴 **빌드 상한 모드로 판정한다** — `HIS_MODE` 환경변수(없으면 `REAL` · shared 정본 `HIS_MODE_FALLBACK`).
 *     런타임 토글은 좁히기만 하므로 부팅 판정에는 빌드 상한이 맞다(`his-mode.service.ts` 와 같은 해석).
 *   · 🔴 **REAL 은 부팅을 거부한다**(`validateEnv` → exit 1). DEV·REHEARSAL 은 **종전 동작 그대로 + 경고**다 —
 *     운영 `his.example.org` 은 REHEARSAL 이라 이 파일로 동작이 바뀌지 않는다.
 *   · 🔴 `HIS_MODE` 미설정 = REAL 이다. 로컬 개발기는 `.env` 에 `HIS_MODE=DEV` 를 **명시**해야 개발 비밀 폴백으로
 *     부팅한다 — 위험한 쪽을 여는 것이 옵트인이다(`.env.example` 에 적었다).
 *   · 폴백 **체인의 끝이 공개 리터럴일 때만** 거부한다. `DOC_DOWNLOAD_SECRET` 이 없어도 `PDF_RENDER_SECRET` 이 있으면
 *     공개 비밀은 아니다 — 대신 컨텍스트 분리가 약해진다는 **경고**를 남긴다(막지 않는다).
 */

/** 저장소에 적혀 있는 개발용 비밀 — 이 값으로 떨어지면 비밀이 아니다(가드가 이 목록과 코드를 기계 대조한다) */
export const DEV_SECRET_LITERALS = {
  PDF_SERVICE_TOKEN: 'hispdf-fixedtoken-dev',
  PDF_RENDER_SECRET: 'pdf-render-dev-secret',
  AI_PROVENANCE_SECRET: 'weru-nursing-ai-provenance',
  /** `ALLOW_DEV_VOUCHER_SECRET=true` 옵트인 때만 쓰인다(REAL 은 옵트인 자체가 막힌다) */
  VOUCHER_SERIAL_SECRET: 'voucher-dev-secret',
  /**
   * PACS(OpenPACS) 서비스 계정 비밀번호 — 🔴 외부 점검 이 사람 눈으로 찾아 준 자리다.
   * 종전 `config.get('OPENPACS_PASS', 'pacs1234!')` 는 게이트 이름 규칙(SECRET|TOKEN|PASSWORD|_KEY)에
   * `PASS` 가 없어 **스캐너를 통과**했다(규칙을 넓혔다 — `scripts/release-gate.mjs`).
   * REAL 은 이 값으로 떨어지지 않는다 — 미설정이면 **서비스 계정을 비활성**하고 그 사실을 말한다.
   */
  OPENPACS_PASS: 'pacs1234!',
} as const;

/** PACS 서비스 계정의 개발용 사용자명 — 비밀은 아니지만 REAL 에서 자동으로 쓰이면 안 된다 */
export const DEV_PACS_USER = 'admin';

/** REAL 에서 켜져 있으면 부팅을 거부하는 개발 편의 스위치 */
export const DEV_ONLY_SWITCHES = [
  'ALLOW_INSECURE_ENCRYPTION_KEY',
  'ALLOW_INSECURE_COOKIES',
  'ALLOW_DEV_VOUCHER_SECRET',
  'IDENTITY_ALLOW_LOCAL_FAKE',
  'APP_ATTEST_ALLOW_DEVELOPMENT',
  'SWAGGER_ENABLED',
] as const;

type Env = Record<string, string | undefined>;

const has = (env: Env, k: string) => typeof env[k] === 'string' && env[k]!.trim() !== '';
const on = (env: Env, k: string) => String(env[k] ?? '').trim().toLowerCase() === 'true';

/** 빌드 상한 모드 — `HIS_MODE` 환경변수, 해석 불가·미설정은 REAL */
export function buildModeOf(env: Env = process.env): HisMode {
  return parseHisMode(env.HIS_MODE) ?? HIS_MODE_FALLBACK;
}
export const isRealBuild = (env: Env = process.env) => buildModeOf(env) === 'REAL';

export interface SecurityFinding { key: string; reason: string }

/**
 * 부팅 판정 — `refuse` 가 하나라도 있으면 REAL 에서 부팅을 거부한다. DEV·REHEARSAL 은 refuse 를 비워 두고 전부 warn 으로 준다.
 * 순수 함수다(프로세스를 끝내지 않는다) — 테스트가 env 를 넘겨 판정만 본다.
 */
export function releaseSecurityFindings(env: Env = process.env): { mode: HisMode; refuse: SecurityFinding[]; warn: SecurityFinding[] } {
  const mode = buildModeOf(env);
  const problems: SecurityFinding[] = [];
  const softs: SecurityFinding[] = [];

  // ① 폴백 체인의 끝이 공개 리터럴인가
  if (!has(env, 'PDF_SERVICE_TOKEN')) problems.push({ key: 'PDF_SERVICE_TOKEN', reason: '미설정 — 저장소에 적힌 공개 개발 토큰(DEV_SECRET_LITERALS)으로 PDF 렌더러를 호출한다' });
  if (!has(env, 'PDF_RENDER_SECRET')) {
    problems.push({ key: 'PDF_RENDER_SECRET', reason: '미설정 — 인쇄 렌더 토큰을 저장소에 적힌 공개 비밀(DEV_SECRET_LITERALS)로 서명한다' });
    if (!has(env, 'DOC_DOWNLOAD_SECRET')) problems.push({ key: 'DOC_DOWNLOAD_SECRET', reason: '미설정 + PDF_RENDER_SECRET 미설정 — 완료본 다운로드 토큰을 공개 비밀로 서명한다' });
    if (!has(env, 'AI_PROVENANCE_SECRET')) problems.push({ key: 'AI_PROVENANCE_SECRET', reason: '미설정 + PDF_RENDER_SECRET 미설정 — AI 초안 무결성 서명을 저장소에 적힌 공개 비밀(DEV_SECRET_LITERALS)로 만든다' });
    if (!has(env, 'DOC_VERIFY_SECRET')) problems.push({ key: 'DOC_VERIFY_SECRET', reason: '미설정 + PDF_RENDER_SECRET 미설정 — 인쇄본 진위확인 코드를 공개 비밀로 만든다(누구나 진본 확인 코드를 계산한다)' });
  } else {
    if (!has(env, 'DOC_DOWNLOAD_SECRET')) softs.push({ key: 'DOC_DOWNLOAD_SECRET', reason: '미설정 — PDF_RENDER_SECRET 을 재사용한다(토큰 컨텍스트는 접두어로 분리되지만 비밀은 하나다)' });
    if (!has(env, 'AI_PROVENANCE_SECRET')) softs.push({ key: 'AI_PROVENANCE_SECRET', reason: '미설정 — PDF_RENDER_SECRET 을 재사용한다(렌더 비밀이 새면 AI 초안 서명도 위조된다)' });
    if (!has(env, 'DOC_VERIFY_SECRET')) softs.push({ key: 'DOC_VERIFY_SECRET', reason: '미설정 — PDF_RENDER_SECRET 을 재사용한다(렌더 비밀이 새면 인쇄본 확인 코드도 계산된다 · 회전 시 DOC_VERIFY_SECRET_PREVIOUS 병행)' });
  }

  // ② 개발 편의 스위치
  for (const k of DEV_ONLY_SWITCHES) if (on(env, k)) problems.push({ key: k, reason: '켜져 있다 — 개발 편의 옵트인이다(판매본에서 켜 둘 이유가 없다)' });

  // ③ all-zeros 암호화 키 — REAL 은 옵트인(ALLOW_INSECURE_ENCRYPTION_KEY)으로도 넘어가지 않는다
  if (has(env, 'ENCRYPTION_KEY') && /^0+$/.test(env.ENCRYPTION_KEY!.trim())) problems.push({ key: 'ENCRYPTION_KEY', reason: 'all-zeros — PID 암호화가 사실상 무력하다(키 교체는 재암호화 로테이션 동반)' });

  // ④ NODE_ENV=development 는 REAL 에서 의미가 없다 — 켜져 있으면 설치 설정이 개발용이라는 신호
  if (String(env.NODE_ENV ?? '').trim() === 'development') softs.push({ key: 'NODE_ENV', reason: 'development — REAL 에서는 쿠키·Swagger·오류 상세 분기가 이 값을 무시한다(모드가 이긴다)' });

  if (mode === 'REAL') return { mode, refuse: problems, warn: softs };
  return { mode, refuse: [], warn: [...problems, ...softs] };
}

/* ── NODE_ENV 분기의 모드 정본 ── 🔴 REAL 은 NODE_ENV 가 무엇이든 안전한 쪽이다 ───────────────── */

/** 인증 쿠키 `secure` — REAL 은 항상 true. 그 외는 종전 규칙(`NODE_ENV !== 'development'`) 그대로 */
export function cookieSecure(env: Env = process.env): boolean {
  if (isRealBuild(env)) return true;
  return env.NODE_ENV !== 'development';
}

/** Swagger 공개 — REAL 은 항상 false(켜져 있으면 부팅 자체가 거부된다). 그 외는 종전 규칙 그대로 */
export function swaggerEnabled(env: Env = process.env): boolean {
  if (isRealBuild(env)) return false;
  return env.SWAGGER_ENABLED === 'true' || env.NODE_ENV === 'development';
}

/** 오류 응답에 내부 details 를 싣는가 — REAL 은 항상 false. 그 외는 종전 규칙 그대로 */
export function exposeErrorDetails(env: Env = process.env): boolean {
  if (isRealBuild(env)) return false;
  return env.NODE_ENV === 'development';
}

/**
 * 개발 편의 스위치 판독 — REAL 에서는 켜져 있어도 false(부팅이 먼저 막지만, 부팅 경로 밖에서 모듈이 먼저 읽힐 수 있어
 * 방어를 한 겹 더 둔다). 🔴 이 함수를 거치지 않고 `process.env.ALLOW_*` 를 직접 읽는 코드는 가드가 잡는다.
 */
export function devSwitchOn(key: (typeof DEV_ONLY_SWITCHES)[number], env: Env = process.env): boolean {
  if (isRealBuild(env)) return false;
  return on(env, key);
}
