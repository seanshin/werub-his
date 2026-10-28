/**
 * 모든 `@Optional()` 생성자 의존이 **그 모듈에서 보인다**(2026-10-01 · config 가드의 일반화).
 *
 * 🔴 `@Optional()` 은 배선이 빠져도 부트가 성공하고 의존이 조용히 undefined 가 된다. `this.x?.…` 가 아무것도 안 하고 넘어간다.
 *    부트 후 DI 전수 스캔(281 optional 파라미터·143 클래스) 실측:
 *      · ConfigRuntimeService 4모듈(→ optional-config-di.spec.ts)
 *      · 🔴 **CdssModule 의 DurService.allergyService** — AllergyModule 미import 로 CDSS 경로 DUR(/cdss 점검·CPOE cdss.enforce
 *        게이트)이 **구조화 알레르기 원장을 보지 못했다**(운영 13건 전부 — 페니실린·아스피린·이부프로펜 등. 레거시 JSON 만 봤다).
 *    단위 테스트는 의존을 직접 넣으니 통과한다 — 모듈 배선은 이 가드만 본다.
 *
 * 규칙: provider 의 `@Optional()` 클래스 의존 T 는 등록 모듈에서 보여야 한다 — 같은 모듈 provide · import 한 모듈의 export
 *       (재수출 사슬 포함) · @Global 모듈의 export · 프레임워크 전역(EventEmitter2·Reflector 등) 중 하나.
 *       일부러 비워 두는 의존은 아래 INTENTIONALLY_ABSENT 에 이유와 함께 적는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const SRC = join(__dirname, '..', '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const listOf = (src: string, key: 'providers' | 'imports' | 'exports'): string[] => {
  const code = strip(src);
  const mod = code.indexOf('@Module(');
  if (mod < 0) return [];
  const at = code.slice(mod).search(new RegExp(`\\b${key}:\\s*\\[`));
  if (at < 0) return [];
  let i = mod + at + code.slice(mod + at).indexOf('[') + 1;
  let depth = 1; const start = i;
  for (; i < code.length && depth > 0; i++) {
    const c = code[i];
    if (c === '[' || c === '(' || c === '{') depth++;
    else if (c === ']' || c === ')' || c === '}') depth--;
  }
  const body = code.slice(start, i - 1);
  const items: string[] = []; let d = 0; let cur = '';
  for (const c of body) {
    if (c === '[' || c === '(' || c === '{') d++;
    if (c === ']' || c === ')' || c === '}') d--;
    if (c === ',' && d === 0) { items.push(cur); cur = ''; } else cur += c;
  }
  items.push(cur);
  return items
    .map((s) => s.trim())
    .map((s) => s.match(/^forwardRef\(\s*\(\)\s*=>\s*(\w+)\s*\)$/)?.[1] ?? s.match(/^\{\s*provide:\s*(\w+)/)?.[1] ?? (s.startsWith('...') ? '' : s))
    .filter((s) => /^[A-Z]\w*$/.test(s));
};

interface Mod { name: string; file: string; src: string; global: boolean; imports: string[]; exports: string[]; providers: string[] }
function graph(): Map<string, Mod> {
  const g = new Map<string, Mod>();
  for (const f of walk(SRC).filter((x) => x.endsWith('.module.ts'))) {
    const src = readFileSync(f, 'utf8');
    const name = src.match(/export class (\w+Module)\b/)?.[1];
    if (!name) continue;
    g.set(name, { name, file: f, src, global: /@Global\(\)/.test(src), imports: listOf(src, 'imports'), exports: listOf(src, 'exports'), providers: listOf(src, 'providers') });
  }
  return g;
}

/** 모듈 M 을 import 하면 T 가 보이는가(재수출 사슬) */
function exportsSym(g: Map<string, Mod>, m: string, t: string, seen = new Set<string>()): boolean {
  if (seen.has(m)) return false;
  seen.add(m);
  const mod = g.get(m);
  if (!mod) return false;
  if (mod.exports.includes(t)) return true;
  return mod.exports.some((x) => g.has(x) && exportsSym(g, x, t, seen));
}

/** Nest·라이브러리 전역 — forRoot 등으로 앱 전역 등록 */
const FRAMEWORK_GLOBAL = new Set(['EventEmitter2', 'Reflector', 'ModuleRef', 'SchedulerRegistry', 'HttpAdapterHost', 'ConfigService', 'JwtService']);

/** 일부러 비워 두는 의존(기능이 없는 배포가 정상인 것) — 이유 필수 */
const INTENTIONALLY_ABSENT: Record<string, string> = {};

/** 생성자에서 `@Optional()` 이 붙은 클래스 타입 이름들 */
function optionalCtorTypes(src: string): string[] {
  const code = strip(src);
  const m = code.match(/constructor\s*\(([\s\S]*?)\)\s*\{/);
  if (!m) return [];
  const out: string[] = [];
  const re = /@Optional\(\)\s*(?:@Inject\((?:forwardRef\(\s*\(\)\s*=>\s*(\w+)\s*\)|[^)]*)\)\s*)?(?:private|protected|public)?\s*(?:readonly\s+)?\w+\??\s*:\s*([A-Z]\w*)/g;
  for (const x of m[1].matchAll(re)) out.push(x[1] ?? x[2]);
  return out;
}

function violations(): string[] {
  const g = graph();
  const globalExports = new Set<string>();
  for (const m of g.values()) if (m.global) for (const e of m.exports) { globalExports.add(e); for (const x of g.values()) if (m.exports.includes(x.name)) x.exports.forEach((y) => globalExports.add(y)); }
  const out: string[] = [];
  for (const m of g.values()) {
    for (const p of m.providers) {
      const im = m.src.match(new RegExp(`import\\s*\\{[^}]*\\b${p}\\b[^}]*\\}\\s*from\\s*'([^']+)'`));
      if (!im || !im[1].startsWith('.')) continue;
      let psrc: string;
      try { psrc = readFileSync(resolve(dirname(m.file), im[1]) + '.ts', 'utf8'); } catch { continue; }
      for (const t of optionalCtorTypes(psrc)) {
        const key = `${m.name} → ${p}.${t}`;
        if (INTENTIONALLY_ABSENT[key]) continue;
        const visible = m.providers.includes(t) || FRAMEWORK_GLOBAL.has(t) || globalExports.has(t)
          || m.imports.some((i) => exportsSym(g, i, t));
        if (!visible) out.push(key);
      }
    }
  }
  return [...new Set(out)].sort();
}

describe('@Optional 생성자 의존 배선', () => {
  it('🔴 모든 @Optional 클래스 의존이 등록 모듈에서 보인다(안 보이면 조용히 undefined)', () => {
    expect(violations()).toEqual([]);
  });
  it('대조군 — 검사기가 실제로 의존을 읽는다(DurService 의 allergyService·VitalsService 의 config)', () => {
    expect(optionalCtorTypes(readFileSync(join(SRC, 'modules/prescription/dur/dur.service.ts'), 'utf8'))).toContain('AllergyService');
    expect(optionalCtorTypes(readFileSync(join(SRC, 'modules/vitals/vitals.service.ts'), 'utf8'))).toContain('ConfigRuntimeService');
  });
});
