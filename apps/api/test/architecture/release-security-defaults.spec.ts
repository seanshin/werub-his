import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  DEV_ONLY_SWITCHES,
  DEV_SECRET_LITERALS,
  buildModeOf,
  cookieSecure,
  devSwitchOn,
  exposeErrorDetails,
  releaseSecurityFindings,
  swaggerEnabled,
} from '../../src/common/release-security';

/**
 * 🔴 판매본(REAL) 보안 기본값 — 2026-09-13 · 상용 릴리즈 T4(`commercial-release-v1-freeze.plan.md`).
 *
 * 무엇이 틀려 있었나: ① 저장소에 적힌 개발 비밀로 떨어지는 폴백 4곳(PDF 토큰·렌더/다운로드 서명·AI 출처 서명)
 * ② `NODE_ENV` 분기 7곳 — 설치하는 쪽이 `NODE_ENV=development` 를 넣으면 REAL 서버에서 Swagger·오류 상세가 열리고
 * 인증 쿠키가 평문으로 나갔다 ③ 개발 편의 스위치(`ALLOW_*` 5 + `SWAGGER_ENABLED`)가 REAL 에서도 먹었다.
 *
 * 지키는 것
 *   (a) REAL 은 공개 비밀·스위치·all-zeros 키로 부팅을 거부하고, REHEARSAL·DEV 는 **막지 않고 경고만**(운영이 리허설이다 — 대조군)
 *   (b) `HIS_MODE` 미설정은 REAL 이다(모르면 가장 제한적)
 *   (c) REAL 에서는 NODE_ENV·스위치가 무엇이든 쿠키 secure·Swagger 닫힘·오류 상세 없음 / DEV 에서는 종전 동작(대조군 — 기능을 죽이지 않는다)
 *   (d) 🔴 구조: `NODE_ENV` 를 읽는 실행 코드는 정본 한 곳뿐 · 스위치를 직접 읽는 코드 0 · 개발 비밀 리터럴은 정본 상수에만
 *   (e) 부팅 경로(`main.ts` → `validateEnv`)가 판정을 실제로 부르고 거부 시 종료한다
 */

const SRC = resolve(__dirname, '../../src');
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.ts') && !e.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}
/** 주석을 걷어낸 실행 코드 — 사건을 설명하는 주석의 `NODE_ENV === 'production'` 을 위반으로 세지 않는다 */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const SECRETS_SET = { PDF_SERVICE_TOKEN: 'x'.repeat(40), PDF_RENDER_SECRET: 'y'.repeat(40), DOC_DOWNLOAD_SECRET: 'z'.repeat(40), AI_PROVENANCE_SECRET: 'w'.repeat(40), DOC_VERIFY_SECRET: 'v'.repeat(40), ENCRYPTION_KEY: 'a'.repeat(64) };

describe('🔴 판매본 보안 기본값(T4)', () => {
  it('(a) REAL — 공개 개발 비밀로 떨어지면 부팅을 거부한다', () => {
    const r = releaseSecurityFindings({ HIS_MODE: 'REAL', ENCRYPTION_KEY: 'a'.repeat(64) });
    expect(r.mode).toBe('REAL');
    expect(r.refuse.map((f) => f.key).sort()).toEqual(['AI_PROVENANCE_SECRET', 'DOC_DOWNLOAD_SECRET', 'DOC_VERIFY_SECRET', 'PDF_RENDER_SECRET', 'PDF_SERVICE_TOKEN']);
  });

  it('(a) 대조군 — REHEARSAL·DEV 는 같은 env 에서 **막지 않고** 경고만 한다(운영 his.example.org 은 REHEARSAL)', () => {
    for (const mode of ['REHEARSAL', 'DEV']) {
      const r = releaseSecurityFindings({ HIS_MODE: mode, ENCRYPTION_KEY: '0'.repeat(64), ALLOW_INSECURE_COOKIES: 'true' });
      expect(r.refuse, `${mode} 가 부팅을 거부했다 — 운영이 깨진다`).toEqual([]);
      expect(r.warn.length).toBeGreaterThan(0);
    }
  });

  it('(a) 대조군 — REAL 이라도 비밀이 다 있으면 거부하지 않는다(성공을 실패로 말하지 않는다)', () => {
    const r = releaseSecurityFindings({ HIS_MODE: 'REAL', ...SECRETS_SET });
    expect(r.refuse).toEqual([]);
  });

  it('(a) 체인 끝이 공개 리터럴일 때만 거부 — PDF_RENDER_SECRET 이 있으면 다운로드·AI 서명은 경고로 내린다', () => {
    const r = releaseSecurityFindings({ HIS_MODE: 'REAL', PDF_SERVICE_TOKEN: 't'.repeat(40), PDF_RENDER_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'a'.repeat(64) });
    expect(r.refuse).toEqual([]);
    expect(r.warn.map((f) => f.key).sort()).toEqual(['AI_PROVENANCE_SECRET', 'DOC_DOWNLOAD_SECRET', 'DOC_VERIFY_SECRET']);
  });

  it('(a) REAL — 개발 편의 스위치가 하나라도 켜져 있으면 거부 · all-zeros 키는 옵트인으로도 못 넘는다', () => {
    for (const k of DEV_ONLY_SWITCHES) {
      const r = releaseSecurityFindings({ HIS_MODE: 'REAL', ...SECRETS_SET, [k]: 'true' });
      expect(r.refuse.map((f) => f.key), `${k}=true 가 REAL 에서 통과했다`).toContain(k);
    }
    const z = releaseSecurityFindings({ HIS_MODE: 'REAL', ...SECRETS_SET, ENCRYPTION_KEY: '0'.repeat(64), ALLOW_INSECURE_ENCRYPTION_KEY: 'true' });
    expect(z.refuse.map((f) => f.key)).toContain('ENCRYPTION_KEY');
  });

  it('(b) HIS_MODE 미설정·해석 불가는 REAL 이다', () => {
    expect(buildModeOf({})).toBe('REAL');
    expect(buildModeOf({ HIS_MODE: 'production' })).toBe('REAL');
    expect(buildModeOf({ HIS_MODE: 'rehearsal' })).toBe('REHEARSAL');
    expect(releaseSecurityFindings({}).refuse.length).toBeGreaterThan(0);
  });

  it('(c) REAL 은 NODE_ENV=development·스위치가 켜져 있어도 안전한 쪽이다', () => {
    const env = { HIS_MODE: 'REAL', NODE_ENV: 'development', SWAGGER_ENABLED: 'true', IDENTITY_ALLOW_LOCAL_FAKE: 'true' };
    expect(cookieSecure(env)).toBe(true);
    expect(swaggerEnabled(env)).toBe(false);
    expect(exposeErrorDetails(env)).toBe(false);
    expect(devSwitchOn('IDENTITY_ALLOW_LOCAL_FAKE', env)).toBe(false);
  });

  it('(c) 대조군 — DEV 는 종전 동작 그대로다(개발 기능을 죽이지 않는다) · 미설정 NODE_ENV 는 안전한 쪽', () => {
    const dev = { HIS_MODE: 'DEV', NODE_ENV: 'development', IDENTITY_ALLOW_LOCAL_FAKE: 'true' };
    expect(cookieSecure(dev)).toBe(false);
    expect(swaggerEnabled(dev)).toBe(true);
    expect(exposeErrorDetails(dev)).toBe(true);
    expect(devSwitchOn('IDENTITY_ALLOW_LOCAL_FAKE', dev)).toBe(true);
    const rehearsalNoNodeEnv = { HIS_MODE: 'REHEARSAL' };
    expect(cookieSecure(rehearsalNoNodeEnv)).toBe(true);
    expect(swaggerEnabled(rehearsalNoNodeEnv)).toBe(false);
    expect(exposeErrorDetails(rehearsalNoNodeEnv)).toBe(false);
  });

  describe('(d) 🔴 구조 — 정본 한 곳으로만', () => {
    const files = walk(SRC);
    const OWNER = 'common/release-security.ts';

    it('대조군 — 스캔 대상이 실제로 있다', () => {
      expect(files.length).toBeGreaterThan(500);
      expect(files.some((f) => relative(SRC, f) === OWNER)).toBe(true);
    });

    it('`NODE_ENV` 를 읽는 실행 코드는 정본과 env 스키마 선언뿐이다(0 동결)', () => {
      const bad: string[] = [];
      for (const f of files) {
        const rel = relative(SRC, f);
        if (rel === OWNER) continue;
        code(readFileSync(f, 'utf8')).split('\n').forEach((l, i) => {
          if (!/NODE_ENV/.test(l)) return;
          if (rel === 'common/env.validation.ts' && /^\s*NODE_ENV:\s*z\./.test(l)) return; // zod 스키마 선언(판정 아님)
          bad.push(`${rel}:${i + 1}  ${l.trim().slice(0, 110)}`);
        });
      }
      expect(bad, `NODE_ENV 로 안전을 가르는 자리 — release-security 의 cookieSecure/swaggerEnabled/exposeErrorDetails 를 쓰세요:\n${bad.join('\n')}`).toEqual([]);
    });

    it('개발 편의 스위치를 `process.env` 로 직접 읽는 코드 0(REAL 방어를 우회한다)', () => {
      const re = new RegExp(`process\\.env(?:\\.|\\[\\s*['"])(${DEV_ONLY_SWITCHES.join('|')})\\b`);
      const bad: string[] = [];
      for (const f of files) {
        const rel = relative(SRC, f);
        if (rel === OWNER) continue;
        code(readFileSync(f, 'utf8')).split('\n').forEach((l, i) => { if (re.test(l)) bad.push(`${rel}:${i + 1}  ${l.trim().slice(0, 110)}`); });
      }
      expect(bad, `devSwitchOn()/swaggerEnabled() 를 쓰세요:\n${bad.join('\n')}`).toEqual([]);
    });

    it('개발 비밀 리터럴은 정본 상수에만 있다(다른 파일에 문자열로 적히면 폴백이 둘이 된다)', () => {
      const literals = Object.values(DEV_SECRET_LITERALS);
      const bad: string[] = [];
      for (const f of files) {
        const rel = relative(SRC, f);
        if (rel === OWNER) continue;
        const c = code(readFileSync(f, 'utf8'));
        for (const lit of literals) if (c.includes(`'${lit}'`) || c.includes(`"${lit}"`) || c.includes(`\`${lit}\``)) bad.push(`${rel}: ${lit}`);
      }
      expect(bad).toEqual([]);
    });
  });

  it('(e) 부팅 경로가 판정을 실제로 부르고, 거부가 있으면 종료한다', () => {
    const main = readFileSync(join(SRC, 'main.ts'), 'utf8');
    expect(main).toMatch(/validateEnv\(\)/);
    const env = code(readFileSync(join(SRC, 'common/env.validation.ts'), 'utf8'));
    const fn = env.slice(env.indexOf('export function validateEnv'));
    expect(fn).toMatch(/releaseSecurityFindings\(process\.env\)/);
    expect(fn).toMatch(/sec\.refuse\.length\s*>\s*0[\s\S]{0,700}?process\.exit\(1\)/);
  });
});
