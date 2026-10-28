import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 수술기록(Op Note) 화면 ↔ 서버 DTO 계약 가드 — 2026-08-18.
 *
 * 🔴 전역 `ValidationPipe({ whitelist: true, forbidNonWhitelisted: false })` 는 DTO 에 없는 키를
 *    **조용히 지운다.** 수술기록은 법정기록이라, 검체·합병증·보조 집도진이 사라지면 사고 조사에서
 *    근거 자체가 없다. 실측(2026-08-18)으로 드러난 것:
 *      · `OpNotePanel` 이 보낸 9개 키(`mallampati`·`npoConfirmed`·`prophylacticAntibiotic`·
 *        `signIn`·`timeOut`·`signOut`·`specimen`·`fluids`·`clavienDindo`)가 전부 whitelist 에 지워짐
 *      · 그 패널은 애초에 **어느 화면에도 렌더되지 않는 고아**라 `SurgeryOpNote` 가 도달 불가였음
 *      · 수정은 `PATCH /surgery-opnote/{surgeryId}` 로 보내는데 서버는 op note id 를 받아 전건 404
 *      · `CompleteSurgeryDto.ebl` 이 `@IsString()` 인데 화면은 숫자를 보내 **Op Note 저장 전체가 400**
 *      · 수술 진료 레이아웃의 WHO 체크리스트 17개 체크값이 `@Body` 없는 핸들러로 가 통째로 버려짐
 *
 * 기존 `encounter-payload-contract.spec.ts` 는 **리터럴 경로의 `apiClient.post` 만** 본다.
 * 수술기록은 전부 템플릿 리터럴 경로(`/api/v1/surgery/${id}/complete`)의 `patch` 라 그 그물을 빠져나갔다.
 * 이 스펙은 템플릿 경로와 patch/put 까지 포함해 대조한다.
 */

const WEB = join(process.cwd(), 'src');
const API = join(process.cwd(), '..', 'api', 'src');

/** 점검 대상 — 수술기록을 쓰는 화면 전부. 파일이 사라지면 가드가 조용히 통과하지 않도록 존재를 단언한다. */
const SCREENS = [
  join(WEB, 'app', '(main)', 'surgery', '[id]', 'page.tsx'),
  join(WEB, 'app', '(main)', 'surgery', 'components', 'OpNotePanel.tsx'),
  join(WEB, 'app', '(main)', 'surgery', 'components', 'SurgicalChecklistPanel.tsx'),
  join(WEB, 'app', '(main)', 'patients', '[id]', 'encounter', 'new', 'components', 'SurgeryEncounterLayout.tsx'),
];

/** 서버 DTO 에 없어도 되는 키 — **이유가 있는 것만**. 조용히 늘지 않게 여기에만 적는다. */
const ALLOWED: Record<string, Record<string, string>> = {};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(f) ? [p] : [];
  });
}

/** 주석을 지운 소스 — 🔴 주석 속 문자열이 부정 단언을 통과시키지 않게, 코드만 본다. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** 경로 파라미터를 별표로 바꾼다: `/api/v1/surgery/${id}/complete` → `/api/v1/surgery/[*]/complete` */
function pattern(path: string): string {
  return path.replace(/\$\{[^}]*\}/g, '*').replace(/:[A-Za-z_][\w]*/g, '*').replace(/\/+$/, '');
}

/**
 * 전 컨트롤러: 경로 패턴 → 본문 수용 형태.
 *   { kind: 'dto', name }  — DTO 클래스. whitelist 가 **DTO 에 없는 키를 지운다**(여기가 유실 지점).
 *   { kind: 'inline' }     — 인라인 @Body(Record<...> 등). 검증도 whitelist 도 걸리지 않아 통과한다.
 *   { kind: 'none' }       — @Body 자체가 없다. 화면이 무엇을 보내든 **서버가 읽지 않는다**.
 */
type BodyShape = { kind: 'dto'; name: string } | { kind: 'inline' } | { kind: 'none' };

function routeDtoMap(dtoNames: Set<string>): Map<string, BodyShape> {
  const map = new Map<string, BodyShape>();
  for (const file of walk(API).filter((f) => f.endsWith('.controller.ts'))) {
    const src = readFileSync(file, 'utf8');
    const prefixes = [...src.matchAll(/@Controller\('([^']*)'\)/g)].map((m) => ({ at: m.index ?? 0, path: m[1] }));
    for (const m of src.matchAll(/@(?:Post|Put|Patch)\('?([^')]*)'?\)((?:.|\n){0,900}?)\)\s*[:{]/g)) {
      const at = m.index ?? 0;
      const prefix = prefixes.filter((p) => p.at < at).slice(-1)[0]?.path ?? '';
      const sub = m[1].replace(/'/g, '');
      const full = pattern(`/${[prefix, sub].filter(Boolean).join('/')}`);
      const typed = /@Body\(\)\s*\w+\s*:\s*(\w+)/.exec(m[2]);
      const shape: BodyShape = typed && dtoNames.has(typed[1])
        ? { kind: 'dto', name: typed[1] }
        : /@Body\(/.test(m[2]) ? { kind: 'inline' } : { kind: 'none' };
      if (!map.has(full)) map.set(full, shape);
    }
  }
  return map;
}

/** DTO 클래스 → 필드 이름 집합 */
function dtoFields(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const file of walk(API)) {
    const src = readFileSync(file, 'utf8');
    for (const c of src.matchAll(/export class (\w+)\s*(?:extends[^{]*)?\{([\s\S]*?)\n\}/g)) {
      const set = map.get(c[1]) ?? new Set<string>();
      for (const f of c[2].matchAll(/(?:^\s*|\)\s+)([a-zA-Z_][a-zA-Z0-9_]*)!?\??\s*[:]\s*/gm)) set.add(f[1]);
      map.set(c[1], set);
    }
  }
  return map;
}

/** src[from] 이후 첫 `{` 부터 짝이 맞는 `}` 까지 잘라낸다. */
function braceBlock(src: string, from: number): { body: string; end: number } | null {
  const start = src.indexOf('{', from);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return { body: src.slice(start + 1, i), end: i };
  }
  return null;
}

/** 객체 리터럴 본문에서 최상위 키와 스프레드 식별자를 뽑는다. */
function literalKeys(body: string): { keys: string[]; spreads: string[] } {
  const keys: string[] = [];
  const spreads: string[] = [];
  let d = 0;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (d === 0) {
      const k = /^([A-Za-z_$][\w$]*)\s*[:,]/.exec(line);
      if (k) keys.push(k[1]);
      const s = /^\.\.\.([A-Za-z_$][\w$]*)\s*,?$/.exec(line);
      if (s) spreads.push(s[1]);
    }
    d += (raw.match(/[{[(]/g)?.length ?? 0) - (raw.match(/[}\])]/g)?.length ?? 0);
  }
  return { keys, spreads };
}

/** 파일 안의 `const NAME = { … }` 리터럴을 찾는다(한 단계 간접참조 해소용). */
function namedLiteral(src: string, name: string): string | null {
  const re = new RegExp(`\\bconst\\s+${name}\\s*(?::[^=]+)?=\\s*\\{`);
  const m = re.exec(src);
  if (!m) return null;
  return braceBlock(src, (m.index ?? 0) + m[0].length - 1)?.body ?? null;
}

describe('수술기록 화면이 보내는 값은 서버가 실제로 받는다', () => {
  const fields = dtoFields();
  const routes = routeDtoMap(new Set(fields.keys()));

  it('점검 대상 화면이 모두 존재한다(경로가 바뀌면 조용히 통과하지 않도록)', () => {
    expect(SCREENS.filter((f) => !existsSync(f))).toEqual([]);
  });

  for (const file of SCREENS.filter(existsSync)) {
    const short = file.split('/').slice(-2).join('/');
    it(`${short} — 버려지는 키가 없다`, () => {
      const src = stripComments(readFileSync(file, 'utf8'));
      const allowed = ALLOWED[short] ?? {};
      const problems: string[] = [];
      let calls = 0;

      const callRe = /apiClient\.(post|patch|put)\s*\(\s*[`'"]([^`'"]+)[`'"]\s*(,)?/g;
      for (const m of src.matchAll(callRe)) {
        const path = m[2];
        if (!path.startsWith('/api/v1/surgery')) continue;
        calls++;
        const key = pattern(path);
        if (!routes.has(key)) { problems.push(`라우트 없음: ${m[1].toUpperCase()} ${path}`); continue; }
        const shape = routes.get(key)!;
        const hasArg = !!m[3];

        // 본문 없이 부르는 호출(생성 트리거 등)은 대조할 것이 없다.
        const after = src.slice((m.index ?? 0) + m[0].length);
        const argHead = after.replace(/^\s*/, '');
        if (!hasArg || argHead.startsWith(')')) continue;

        // 🔴 @Body 가 없는 핸들러에 본문을 보내면 **전량 버려진다**(응답은 201).
        if (shape.kind === 'none') { problems.push(`서버가 본문을 받지 않는 핸들러에 본문 전송: ${m[1].toUpperCase()} ${path}`); continue; }
        // 인라인 @Body 는 whitelist 가 걸리지 않아 키가 지워지지 않는다(대신 검증도 없다).
        if (shape.kind === 'inline') continue;

        // 인자를 객체 리터럴로 해소한다(인라인 리터럴 · `const NAME = {…}` 한 단계).
        let body: string | null = null;
        if (argHead.startsWith('{')) body = braceBlock(after, 0)?.body ?? null;
        else {
          const ident = /^([A-Za-z_$][\w$]*)\s*[,)]/.exec(argHead);
          if (ident) body = namedLiteral(src, ident[1]);
        }
        if (body === null) {
          /**
           * 🔴 예외: **서버가 항목 정의를 소유**하는 경우(수술안전 체크리스트).
           * 화면은 서버가 내려준 `items[].key` 를 그대로 보내므로 본문 키가 동적이다 —
           * 정적 대조가 불가능한 것이 결함이 아니라 **의도한 설계**다(화면이 항목을 자체 정의하면
           * 정본이 둘이 된다·오늘 그 결함을 제거했다).
           * 대신 서버 쪽 가드가 **정의 목록 ↔ DTO 수신 목록**을 기계 대조한다
           * (`apps/api/test/surgery/surgery-assistant.spec.ts`).
           */
          if (/\/checklist\//.test(path)) continue;
          problems.push(`본문을 정적으로 확인할 수 없다(인라인 리터럴이나 같은 파일의 const 로 적어라): ${path}`);
          continue;
        }

        const known = fields.get(shape.name);
        expect(known, `DTO 클래스를 못 찾음: ${shape.name}`).toBeDefined();

        const { keys, spreads } = literalKeys(body);
        const all = [...keys];
        for (const sp of spreads) {
          const inner = namedLiteral(src, sp);
          if (inner === null) { problems.push(`스프레드 원본을 못 찾음: ...${sp} (${path})`); continue; }
          all.push(...literalKeys(inner).keys);
        }
        for (const k of all) {
          if (!known!.has(k) && !(k in allowed)) problems.push(`${path} [${shape.name}] 가 버리는 키: ${k}`);
        }
      }

      expect(calls, `${short} 에서 수술 API 호출을 하나도 못 찾았다 — 가드가 헛돌고 있다`).toBeGreaterThan(0);
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }

  it('WHO 체크리스트는 서버 정의(items)를 받아 쓰는 정본 패널 하나만 쓴다', () => {
    const panel = join(WEB, 'app', '(main)', 'surgery', 'components', 'SurgicalChecklistPanel.tsx');
    expect(existsSync(panel)).toBe(true);
    const panelSrc = stripComments(readFileSync(panel, 'utf8'));
    // 항목 정의는 서버에서 온다 — 화면이 자체 목록을 들고 있으면 서버 정의와 조용히 갈라진다.
    expect(panelSrc).toContain('/checklist');
    expect(panelSrc).toMatch(/items\?\.\[phase\]|cd\?\.items/);

    // 🔴 다른 수술 화면이 체크 항목을 다시 적어두지 않는다(정본이 둘이 되는 순간 드리프트한다).
    const drifted = ['patientIdentity', 'pulseOx', 'allergyChecked', 'airwayChecked', 'bloodLossRisk',
      'patientConfirmed', 'anticipatedEvents', 'antibioticGiven'];
    for (const file of SCREENS.filter(existsSync).filter((f) => !f.endsWith('SurgicalChecklistPanel.tsx'))) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const k of drifted) {
        expect(code, `${file.split('/').pop()} 에 체크리스트 항목 정의가 다시 생겼다: ${k}`).not.toContain(k);
      }
    }
  });
});
