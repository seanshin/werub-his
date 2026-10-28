import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import {
  DEV_SECRET_CANON,
  devSecretLiteralsOf,
  devSecretFallbackHits,
  scanDevSecretFallbacks,
  importedStringConstsOf,
  exportedStringConstsOf,
  localObjectStringPropsOf,
} from '../../../../scripts/release-gate.mjs';
import { DEV_SECRET_LITERALS } from '../../src/common/release-security';

/**
 * 🔴 릴리즈 게이트 G10(공개된 개발용 비밀 폴백) — 2026-09-13 · 상용 릴리즈 T4 잔여.
 *
 * 무엇이 틀려 있었나: G10 이 리터럴을 apps/api/src 전체에서 찾아 **정본 상수 파일 자신**을 위반으로 세었다(영구 FAIL —
 * 영구 FAIL 게이트는 아무도 안 본다). 동시에 apps/web 의 `REVALIDATE_SECRET || '<리터럴>'` 은 범위 밖이라 못 봤다.
 * 지킨다: ① 목록은 정본에서 읽는다(게이트가 따로 적지 않는다) ② 정본 밖 리터럴·비밀 env 리터럴 폴백은 잡는다
 *         ③ 빈 문자열 폴백·주석 서술·정본 상수 참조는 잡지 않는다(대조군) ④ 현재 트리는 0건 ⑤ 정본을 못 읽으면 PASS 가 아니다.
 */
const ROOT = join(__dirname, '../../../..');

describe('G10 — 공개 비밀 폴백 스캔', () => {
  it('리터럴 목록을 정본 파일에서 읽고, 정본 상수와 같다(목록이 둘이 아니다)', () => {
    const lits = devSecretLiteralsOf(readFileSync(join(ROOT, DEV_SECRET_CANON), 'utf8'));
    expect(lits).toEqual(Object.values(DEV_SECRET_LITERALS));
  });

  it('정본 밖에 리터럴이 적히면 잡는다', () => {
    const lit = Object.values(DEV_SECRET_LITERALS)[0];
    expect(devSecretFallbackHits('apps/api/src/x.ts', `const t = process.env.A || '${lit}';`, [lit])).toHaveLength(1);
  });

  it.each([
    [`if (s !== (process.env.REVALIDATE_SECRET || 'hospitalrun-revalidate')) {`],
    [`const k = process.env.JWT_SECRET ?? "hospital-run-secret";`],
    [`const k = process.env['PDF_SERVICE_TOKEN'] || \`dev\`;`],
    [`const s = this.config.get<string>('HOMEPAGE_REVALIDATE_SECRET') || 'x';`],
    [`const s = config.get('DB_PASSWORD', 'secret');`],
    [`const s = process.env.ENCRYPTION_KEY || 'abc';`],
    // 메서드 체인이 끼어도 — 이 모양을 종전 정규식이 놓친 것을 재주입으로 확인했다
    [`const expected = process.env.REVALIDATE_SECRET?.trim() || 'hospitalrun-revalidate';`],
    [`const s = this.config.get<string>('X_TOKEN')?.trim().toLowerCase() ?? 'dev';`],
    // 🔴 외부 점검 — `OPENPACS_PASS` 를 못 보고 있었다(PASSWORD 는 잡고 PASS 는 못 잡았다).
    //    사람이 찾아 준 자리를 규칙으로 되돌려 놓는다(이름 규칙을 다시 좁히면 여기서 실패한다).
    [`this.pacsPass = this.config.get<string>('OPENPACS_PASS', 'pacs1234!');`],
    [`const pw = process.env.PACS_PWD || 'dev';`],
    [`const c = process.env.LIS_CREDENTIAL ?? 'dev';`],
  ])('비밀 env 리터럴 폴백을 잡는다: %s', (line) => {
    expect(devSecretFallbackHits('apps/web/src/y.ts', line, ['zz-unused'])).toHaveLength(1);
  });

  it.each([
    [`const s = process.env.HOMEPAGE_REVALIDATE_SECRET || '';`],
    [` *    \`process.env.JWT_SECRET ?? 'hospital-run-secret'\` 를 썼는데,`],
    [`// process.env.X_SECRET || 'old'`],
    [`const u = process.env.HOMEPAGE_PUBLIC_URL || 'https://hospital.example.org';`],
    [`const t = process.env.PDF_SERVICE_TOKEN || DEV_SECRET_LITERALS.PDF_SERVICE_TOKEN;`],
    // 대조군 — `PASS` 를 이름에 넣었다고 다 자격은 아니다(BYPASS 를 잡으면 규칙이 넓은 것이다)
    [`const b = process.env.ALLOW_BYPASS || 'off';`],
  ])('대조군 — 잡지 않는다: %s', (line) => {
    expect(devSecretFallbackHits('apps/api/src/z.ts', line, Object.values(DEV_SECRET_LITERALS))).toEqual([]);
  });

  describe('🔴 같은 파일 지역 상수를 거친 폴백(2026-09-13 사각지대)', () => {
    const hit = (src: string) => devSecretFallbackHits('apps/api/src/x.ts', src, []);
    it.each([
      ['|| 상수', "const t = 'dev-fallback';\nconst s = process.env.X_SECRET || t;"],
      ['?? 상수 + 메서드 체인', "const d = 'q';\nconst v = process.env.API_TOKEN?.trim() ?? d;"],
      ['config.get 두 번째 인자', "const DEF: string = \"abc\";\nthis.config.get('JWT_SECRET', DEF);"],
      ['config.get() || 상수', "const DEF = 'abc';\nthis.config.get<string>('DB_PASSWORD') || DEF;"],
      ['$ 가 든 상수', "const t = 'pa$$w';\nprocess.env.DB_PASSWORD || t;"],
    ])('잡는다 — %s', (_label, src) => {
      expect(hit(src)).toHaveLength(1);
    });
    it.each([
      ['빈 문자열 상수', "const t = '';\nconst s = process.env.X_SECRET || t;"],
      ['비밀 아닌 env', "const t = 'http://localhost';\nconst s = process.env.API_URL || t;"],
      ['함수 호출', "const t = 'x';\nconst s = process.env.X_SECRET || t2();"],
      ['멤버 접근', "const t = 'x';\nconst s = process.env.X_SECRET || t.value;"],
      ['파일 안에 선언이 없는 식별자', "const s = process.env.X_SECRET || fromElsewhere;"],
      ['보간 템플릿 상수', "const t = `x${a}`;\nconst s = process.env.X_SECRET || t;"],
      ['주석 줄의 상수 선언', "// const t = 'x';\nconst s = process.env.X_SECRET || t;"],
    ])('잡지 않는다(대조군) — %s', (_label, src) => {
      expect(hit(src)).toHaveLength(0);
    });
  });

  describe('🔴 ④ 2026-09-14 사각지대 — import 상수·객체 속성·대입·구조분해', () => {
    const hit = (src: string, imported?: { consts: Map<string, string>; props: Map<string, string> }) =>
      devSecretFallbackHits('apps/api/src/x.ts', src, [], imported);
    const imp = (consts: Record<string, string> = {}, props: Record<string, string> = {}) =>
      ({ consts: new Map(Object.entries(consts)), props: new Map(Object.entries(props)) });

    it.each([
      ['import 상수 ??', "const s = process.env.X_SECRET ?? DEV_X;", imp({ DEV_X: 'lit' })],
      ['import 상수 config.get 2인자', "this.config.get('JWT_SECRET', DEV_J);", imp({ DEV_J: 'lit' })],
      ['지역 객체 속성', "const DEFAULTS = { secret: 'lit', url: 'http://x' };\nconst s = process.env.API_TOKEN || DEFAULTS.secret;", undefined],
      ['import 객체 속성', "const s = process.env.API_TOKEN ?? DEF.token;", imp({}, { 'DEF.token': 'lit' })],
      ['??= 리터럴', "process.env.JWT_SECRET ??= 'dev-secret';", undefined],
      ['||= 리터럴', "process.env.JWT_SECRET ||= 'dev-secret';", undefined],
      ['직접 대입 리터럴', "process.env.ENCRYPTION_KEY = 'a3f9a3f9';", undefined],
      ['??= import 상수', "process.env.JWT_SECRET ??= DEV_J;", imp({ DEV_J: 'lit' })],
      ['구조분해 기본값 리터럴', "const { JWT_SECRET = 'dev', PORT } = process.env;", undefined],
      ['구조분해 기본값 여러 줄 + 상수', "const D = 'x';\nconst {\n  PORT,\n  DB_PASSWORD = D,\n} = process.env;", undefined],
    ])('잡는다 — %s', (_l, src, imported) => {
      expect(hit(src, imported)).toHaveLength(1);
    });

    it.each([
      ['빈 문자열 export 상수', "const s = process.env.X_SECRET ?? EMPTY;", imp({})],
      ['비밀 아닌 env + import 상수', "const s = process.env.API_URL ?? DEV_URL;", imp({ DEV_URL: 'http://x' })],
      ['getOrThrow 는 정당', "const s = this.config.getOrThrow<string>('JWT_SECRET');", undefined],
      ['비교 연산(==) 은 대입이 아니다', "if (process.env.JWT_SECRET === 'x') {}", undefined],
      ['객체 속성이 문자열이 아닌 것', "const D = { secret: 42 };\nconst s = process.env.X_SECRET || D.secret;", undefined],
      ['import 하지 않은 객체', "const s = process.env.X_SECRET || Other.secret;", imp({}, { 'DEF.secret': 'lit' })],
      ['구조분해 기본값 빈 문자열', "const { JWT_SECRET = '' } = process.env;", undefined],
      ['구조분해 — process.env 가 아닌 객체', "const { JWT_SECRET = 'x' } = opts;", undefined],
      ['정본 객체 참조는 정당(스캐너가 정본 import 를 제외한다)', "const t = process.env.PDF_SERVICE_TOKEN || DEV_SECRET_LITERALS.PDF_SERVICE_TOKEN;", undefined],
    ])('잡지 않는다(대조군) — %s', (_l, src, imported) => {
      expect(hit(src, imported)).toHaveLength(0);
    });

    it('수출 목록 — export const·export { as }·객체 속성만, 비수출·타입·빈 문자열은 빼고 읽는다', () => {
      const ex = exportedStringConstsOf([
        "export const A = 'a';",
        "const B = 'b';",
        "export const E = '';",
        "export const OBJ = { k: 'v', n: 1, 'q': `t` };",
        "const L = 'local';",
        "export { L as ALIAS, B };",
        "export type T = string;",
      ].join('\n'));
      expect([...ex.consts]).toEqual([['A', 'a'], ['B', 'b'], ['ALIAS', 'local']]); // L 은 ALIAS 로만 수출된다
      expect([...ex.props]).toEqual([['OBJ.k', 'v'], ['OBJ.q', 't']]);
      expect(localObjectStringPropsOf("const O = { a: 'x', b: `${y}` };").get('O.b')).toBeUndefined();
    });

    it('상대경로·alias(@/) import 를 따라간다 — .ts/.tsx/index 해석 · type import 제외 · 풀리지 않는 alias 는 못 본다', () => {
      const root = mkdtempSync(join(tmpdir(), 'g10-'));
      try {
        // 🔴 (2026-09-14) alias 는 가장 가까운 tsconfig.json 의 `"@/*"` 로 해석한다 — 종전엔 한계로 못박혀 있었다
        writeFileSync(join(root, 'tsconfig.json'), '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }\n');
        mkdirSync(join(root, 'src', 'lib'), { recursive: true });
        writeFileSync(join(root, 'src', 'lib', 'alias.ts'), "export const NOPE = 'aliased';\n");
        mkdirSync(join(root, 'lib'), { recursive: true });
        writeFileSync(join(root, 'lib', 'index.ts'), "export const DEV_T = 'tok';\nexport const DEFAULTS = { secret: 'sec' };\n");
        writeFileSync(join(root, 'consts.tsx'), "export const DEV_K = 'key';\n");
        const file = join(root, 'x.ts');
        const src = [
          "import { DEV_T, DEFAULTS as D } from './lib';",
          "import { DEV_K as K } from './consts';",
          "import type { DEV_T as TypeOnly } from './lib';",
          "import { NOPE } from '@/lib/alias';",
          "const a = process.env.PDF_SERVICE_TOKEN ?? DEV_T;",
          "const b = process.env.PDF_RENDER_SECRET || D.secret;",
          "const c = process.env.ENCRYPTION_KEY || K;",
          "const d = process.env.X_SECRET || NOPE;",
          "import { MISSING } from '@/lib/not-there';",
          "const e = process.env.Y_SECRET || MISSING;",
        ].join('\n');
        writeFileSync(file, src);
        const imported = importedStringConstsOf(file, src, {});
        expect([...imported.consts]).toEqual([['DEV_T', 'tok'], ['K', 'key'], ['NOPE', 'aliased']]);
        expect([...imported.props]).toEqual([['D.secret', 'sec']]);
        const hits = devSecretFallbackHits('x.ts', src, [], imported);
        expect(hits.map((h) => h.split(':')[1])).toEqual(['5', '6', '7', '8']); // MISSING(해석 불가 alias) 는 못 본다 — 한계
      } finally { rmSync(root, { recursive: true, force: true }); }
    });

    it('재수출 사슬을 깊이 3 까지 따라간다 — export {X as Y} from · export * from · 깊이 초과·정본 경유는 따라가지 않는다', () => {
      const root = mkdtempSync(join(tmpdir(), 'g10-re-'));
      try {
        mkdirSync(join(root, 'a'), { recursive: true });
        writeFileSync(join(root, 'a', 'leaf.ts'), "export const DEV_LEAF = 'leaf';\nexport const OBJ = { secret: 'objsec' };\n");
        writeFileSync(join(root, 'a', 'mid.ts'), "export { DEV_LEAF as DEV_MID, OBJ } from './leaf';\n");
        writeFileSync(join(root, 'a', 'index.ts'), "export * from './mid';\n");
        // 깊이 4 사슬: d0 → d1 → d2 → d3 → d4(리터럴)
        writeFileSync(join(root, 'd4.ts'), "export const DEEP = 'deep';\n");
        writeFileSync(join(root, 'd3.ts'), "export * from './d4';\n");
        writeFileSync(join(root, 'd2.ts'), "export * from './d3';\n");
        writeFileSync(join(root, 'd1.ts'), "export * from './d2';\n");
        writeFileSync(join(root, 'd0.ts'), "export * from './d1';\n");
        const canon = join(root, 'canon.ts');
        writeFileSync(canon, "export const CANON_X = 'canon';\n");
        writeFileSync(join(root, 'via-canon.ts'), "export { CANON_X } from './canon';\n");
        const file = join(root, 'x.ts');
        const src = [
          "import { DEV_MID, OBJ } from './a';",
          "import { DEEP } from './d0';",
          "import { CANON_X } from './via-canon';",
          "const a = process.env.PDF_SERVICE_TOKEN ?? DEV_MID;",
          "const b = process.env.PDF_RENDER_SECRET || OBJ.secret;",
          "const c = process.env.ENCRYPTION_KEY || DEEP;",
          "const d = process.env.X_SECRET || CANON_X;",
        ].join('\n');
        writeFileSync(file, src);
        const imported = importedStringConstsOf(file, src, { canonAbs: canon });
        expect([...imported.consts]).toEqual([['DEV_MID', 'leaf']]); // DEEP(깊이 4)·CANON_X(정본 경유) 는 없다
        expect([...imported.props]).toEqual([['OBJ.secret', 'objsec']]);
        const hits = devSecretFallbackHits('x.ts', src, [], imported);
        expect(hits.map((h) => h.split(':')[1])).toEqual(['4', '5']);
      } finally { rmSync(root, { recursive: true, force: true }); }
    });

    it('스캔 전체 — 정본에서 import 한 객체는 제외, 다른 파일에서 import 한 상수 폴백은 파일·줄을 지목한다', () => {
      const root = mkdtempSync(join(tmpdir(), 'g10-root-'));
      try {
        const canon = join(root, DEV_SECRET_CANON);
        mkdirSync(dirname(canon), { recursive: true });
        cpSync(join(ROOT, DEV_SECRET_CANON), canon);
        const mod = join(root, 'apps/api/src/modules/m');
        mkdirSync(mod, { recursive: true });
        writeFileSync(join(mod, 'consts.ts'), "export const DEV_TOKEN = 'dev-tok';\n");
        writeFileSync(join(mod, 'ok.service.ts'), "import { DEV_SECRET_LITERALS } from '../../common/release-security';\nconst t = process.env.PDF_SERVICE_TOKEN || DEV_SECRET_LITERALS.PDF_SERVICE_TOKEN;\n");
        writeFileSync(join(mod, 'bad.service.ts'), "import { DEV_TOKEN } from './consts';\nconst t = process.env.PDF_SERVICE_TOKEN ?? DEV_TOKEN;\n");
        const r = scanDevSecretFallbacks(root);
        expect(r.error).toBeNull();
        expect(r.hits).toHaveLength(1);
        expect(r.hits[0]).toMatch(/bad\.service\.ts:2: 비밀 env 상수 폴백\(DEV_TOKEN · import\)/);
      } finally { rmSync(root, { recursive: true, force: true }); }
    });
  });

  // 🔴 import 추적이 붙어 전수 스캔이 단독 3~7초(2026-09-14 실측) — 기본 5초에 걸린다
  it('현재 트리는 0건이고, 정본 파일 자신은 세지 않는다', { timeout: 60_000 }, () => {
    const r = scanDevSecretFallbacks(ROOT);
    expect(r.error).toBeNull();
    expect(r.literals.length).toBeGreaterThan(0);
    expect(r.hits).toEqual([]);
  });

  it('정본을 못 읽으면 통과로 말하지 않는다(error)', () => {
    expect(devSecretLiteralsOf('export const OTHER = {}')).toBeNull();
    const r = scanDevSecretFallbacks(join(ROOT, 'no-such-root'));
    expect(r.error).toMatch(/정본/);
  });
});
