/**
 * `@Optional() config?: ConfigRuntimeService` 가 **조용히 undefined** 가 되지 않는다(2026-10-01).
 *
 * 🔴 실측(부트 후 DI 스캔): VitalsModule·UserModule·NutritionModule·OpeningModule 이 ConfigRuntimeModule 을
 *    import 하지 않아 서비스의 `config` 가 undefined 였다. `@Optional()` 이라 부트도 테스트도 조용했고,
 *    `this.config?.get(...)` 은 undefined 를 돌려 **설정이 개통 이래 무시**됐다:
 *      · 환자안전위 활력 임계 개정(clinical.vitals.thresholds)·위급 알림 억제(clinical.vitals.criticalAlert)
 *      · 비밀번호 최소 길이(security.password.minLength) · 기관 국가(hospital.country) · 급양 워크리스트 기준
 *    단위 테스트는 config 목을 직접 넣으니 통과한다 — 모듈 배선은 이 가드만 본다.
 *
 * 규칙: 생성자에 ConfigRuntimeService 를 받는 provider 를 등록한 모듈은 ConfigRuntimeModule 을 import 하거나
 *       ConfigRuntimeService 를 직접 provide 해야 한다.
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

/** `@Module({ key: [ ... ] })` 의 최상위 이름들 — 괄호 균형으로 끝을 찾는다(registerAsync({ imports: [...] }) 안에서 끊기지 않게) */
const listOf = (src: string, key: 'providers' | 'imports' | 'exports'): string[] => {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
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
  // 최상위 원소만(중첩 안의 이름은 그 호출의 인자다)
  const items: string[] = []; let d = 0; let cur = '';
  for (const c of body) {
    if (c === '[' || c === '(' || c === '{') d++;
    if (c === ']' || c === ')' || c === '}') d--;
    if (c === ',' && d === 0) { items.push(cur); cur = ''; } else cur += c;
  }
  items.push(cur);
  return items
    .map((s) => s.trim())
    .map((s) => s.match(/^forwardRef\(\s*\(\)\s*=>\s*(\w+)\s*\)$/)?.[1] ?? (s.startsWith('...') ? '' : s))
    .filter((s) => /^[A-Z]\w*$/.test(s));
};

/** 생성자 파라미터에 ConfigRuntimeService 가 있는가(주석 제외) */
const ctorTakesConfig = (src: string): boolean => {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const m = code.match(/constructor\s*\(([\s\S]*?)\)\s*\{/);
  return !!m && /ConfigRuntimeService/.test(m[1]);
};

interface ModInfo { file: string; src: string; imports: string[]; exports: string[]; providers: string[] }

function moduleGraph(): Map<string, ModInfo> {
  const g = new Map<string, ModInfo>();
  for (const f of walk(SRC).filter((x) => x.endsWith('.module.ts'))) {
    const src = readFileSync(f, 'utf8');
    const name = src.match(/export class (\w+Module)\b/)?.[1];
    if (!name) continue;
    g.set(name, { file: f, src, imports: listOf(src, 'imports'), exports: listOf(src, 'exports'), providers: listOf(src, 'providers') });
  }
  return g;
}

/** 이 모듈을 import 하면 ConfigRuntimeService 가 보이는가(재수출 사슬 포함) */
function exportsConfig(g: Map<string, ModInfo>, name: string, seen = new Set<string>()): boolean {
  if (name === 'ConfigRuntimeModule') return true;
  if (seen.has(name)) return false;
  seen.add(name);
  const m = g.get(name);
  if (!m) return false;
  if (m.exports.includes('ConfigRuntimeService') && m.providers.includes('ConfigRuntimeService')) return true;
  return m.exports.some((x) => g.has(x) && m.imports.includes(x) && exportsConfig(g, x, seen));
}

function violations(): string[] {
  const out: string[] = [];
  const g = moduleGraph();
  for (const m of g.values()) {
    if (m.providers.includes('ConfigRuntimeService') || m.imports.some((i) => exportsConfig(g, i))) continue;
    for (const name of m.providers) {
      const im = m.src.match(new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'([^']+)'`));
      if (!im || !im[1].startsWith('.')) continue;
      const file = resolve(dirname(m.file), im[1]) + '.ts';
      let psrc: string;
      try { psrc = readFileSync(file, 'utf8'); } catch { continue; }
      if (ctorTakesConfig(psrc)) out.push(`${m.file.slice(SRC.length + 1)} → ${name}`);
    }
  }
  return out.sort();
}

describe('ConfigRuntimeService 주입 배선', () => {
  it('🔴 config 를 받는 provider 의 모듈은 ConfigRuntimeModule 을 import 한다', () => {
    expect(violations()).toEqual([]);
  });
  it('대조군 — 검사기가 실제로 provider 를 본다(Vitals·Nursing 이 대상에 잡힌다)', () => {
    const vitalsMod = readFileSync(join(SRC, 'modules/vitals/vitals.module.ts'), 'utf8');
    expect(listOf(vitalsMod, 'providers')).toContain('VitalsService');
    expect(ctorTakesConfig(readFileSync(join(SRC, 'modules/vitals/vitals.service.ts'), 'utf8'))).toBe(true);
  });
});

describe('배선을 고친 뒤 — 카탈로그 기본값을 "원내 확정"으로 읽지 않는다', () => {
  const svc = async (source: 'db' | 'default') => {
    const { NutritionAdvancedService } = await import('../../src/modules/nutrition/nutrition-advanced.service');
    const { vi } = await import('vitest');
    const e = () => ({ findMany: vi.fn(async () => []) });
    const prisma = { admission: e(), nutritionAssessment: e(), nutritionCounsel: e(), mealOrder: e(), specialNutritionOrder: e() };
    const config = { getWithSource: vi.fn(async (k: string) => ({ value: k.endsWith('Hours') ? 48 : 7, source, registered: true })) };
    return new NutritionAdvancedService(prisma as never, {} as never, config as never);
  };
  it('🔴 값이 카탈로그 기본값(source default)이면 configured:false', async () => {
    const r = (await (await svc('default')).getDietitianWorklist()) as { policy: { configured: boolean } };
    expect(r.policy.configured).toBe(false);
  });
  it('대조군 — 원내가 넣은 값(source db)이면 configured:true', async () => {
    const r = (await (await svc('db')).getDietitianWorklist()) as { policy: { configured: boolean } };
    expect(r.policy.configured).toBe(true);
  });
});

describe('기관 국가 — 설정값과 카탈로그 기본값을 가른다', () => {
  const svc = async (value: string, source: 'db' | 'default') => {
    const { OpeningService } = await import('../../src/modules/opening/opening.service');
    const { vi } = await import('vitest');
    const config = { getWithSource: vi.fn(async () => ({ value, source, registered: true })) };
    return new OpeningService({} as never, {} as never, {} as never, config as never);
  };
  it('🔴 카탈로그 기본값 KR 은 fromConfig:false', async () => {
    expect(await (await svc('KR', 'default')).country()).toEqual({ code: 'KR', fromConfig: false });
  });
  it('대조군 — 기관이 넣은 AE 는 그대로', async () => {
    expect(await (await svc('AE', 'db')).country()).toEqual({ code: 'AE', fromConfig: true });
  });
});
