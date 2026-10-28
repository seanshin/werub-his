import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NUMERIC_POLICIES } from '@hospital-run/shared';

/**
 * 🔴 수치 정본 **키** 가드 — 2026-08-18.
 *
 * `roundBy(value, key)` 는 **미등재 키를 만나면 원값을 그대로 돌려준다**(`if (!p) return v`).
 * `decimals` override 도 무시된다. 그래서 오타나 미등재 키를 쓰면
 * **반올림이 한 번도 일어나지 않는데 코드는 정본을 부르는 모양**을 갖춘다 —
 * 이 저장소에서 실제로 그런 코드가 있었다(`roundBy(v, 'qiValue', { decimals: 2 })`,
 * `qiValue` 미등재 → 무반올림). 테스트도 타입도 잡지 못했다(키가 `string` 이라서).
 *
 * 이 가드는 소스에서 리터럴 키를 뽑아 `NUMERIC_POLICIES` 와 기계 대조한다.
 * 🔴 표시(`formatNum`/`<Num domain>`)도 같은 표를 쓰므로 함께 본다.
 */

const ROOTS = [
  join(process.cwd(), 'src'),
  join(process.cwd(), '..', 'web', 'src'),
  join(process.cwd(), '..', '..', 'packages', 'shared', 'src'),
];

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (/\.(ts|tsx)$/.test(f) && !/\.spec\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

/**
 * `roundBy(x, 'key'` · `formatNum(x, 'key'` · `domain="key"` 의 **리터럴** 키만 뽑는다(변수는 볼 수 없다).
 *
 * 🔴 첫 인자에 괄호가 들어가면(예: `roundBy((a / b) * scale, 'qiValue')`) 단순 정규식은 끊긴다 —
 *    이 가드의 첫 판이 실제로 그래서 **재주입에도 통과**했다. 괄호 균형으로 인자를 자른다.
 */
function literalKeys(src: string): { key: string; call: string }[] {
  const found: { key: string; call: string }[] = [];
  for (const m of src.matchAll(/\b(roundBy|formatNum|policyOf)\s*\(/g)) {
    const call = m[1];
    let i = (m.index ?? 0) + m[0].length;
    let depth = 1;
    const args: string[] = [];
    let cur = '';
    for (; i < src.length && depth > 0; i++) {
      const c = src[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) break; }
      if (depth === 1 && c === ',') { args.push(cur); cur = ''; continue; }
      cur += c;
    }
    args.push(cur);
    const second = (args[1] ?? '').trim();
    const lit = /^'([^']+)'$/.exec(second);
    if (lit) found.push({ key: lit[1], call });
  }
  for (const m of src.matchAll(/domain=\{?"([a-zA-Z][a-zA-Z0-9_]*)"\}?/g)) {
    found.push({ key: m[1], call: '<Num domain>' });
  }
  return found;
}

describe('수치 정본 키는 등재된 것만 쓴다', () => {
  const files = ROOTS.flatMap((r) => walk(r));

  it('스캔 대상을 찾는다(경로가 바뀌면 조용히 통과하지 않도록)', () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it('🔴 `roundBy`/`formatNum` 이 미등재 키로 불리지 않는다 — 미등재면 반올림이 조용히 사라진다', () => {
    const known = new Set(Object.keys(NUMERIC_POLICIES));
    const offenders: string[] = [];

    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // 주석은 옛 키를 설명할 수 있다 — 코드만 본다
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const { key, call } of literalKeys(code)) {
        // `<Num domain>` 은 StatusBadge 등 다른 domain prop 과 이름이 겹칠 수 있어 수치 호출만 엄격히 본다
        if (call === '<Num domain>' && !known.has(key)) continue;
        if (!known.has(key)) {
          offenders.push(`${f.replace(process.cwd(), '.')}: ${call}(… , '${key}')`);
        }
      }
    }

    expect(
      offenders,
      `등재되지 않은 수치 정본 키다 — roundBy 가 값을 그대로 돌려주므로 자릿수 계약이 지켜지지 않는다:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('등재된 정책은 자릿수 규칙을 하나 이상 갖는다(빈 정책은 아무것도 보장하지 않는다)', () => {
    const empty = Object.values(NUMERIC_POLICIES)
      .filter((p) => p.decimals == null && p.sigFigs == null && p.step == null)
      .map((p) => p.key);
    expect(empty, `자릿수·유효숫자·스텝이 모두 없는 정책: ${empty.join(', ')}`).toEqual([]);
  });
});
