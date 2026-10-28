import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 진료 입력 화면 ↔ 서버 DTO 계약 가드 — 2026-08-18.
 *
 * 🔴 전역 `ValidationPipe({ whitelist: true, forbidNonWhitelisted: false })` 는
 *    **DTO 에 없는 키를 조용히 버린다.** 그래서 화면이 받은 임상 입력이 서버에 닿지 않아도
 *    응답은 201 이고 화면은 "저장되었습니다"라고 말한다. 실측(2026-08-18)으로 드러난 것:
 *      · 비뇨 — IPSS 총점·QoL·PSA·최대/평균 요속이 전부 유실(`ipss`/`qol`/`psa`/`maxFlow`…)
 *      · 신경외과 — GCS 4항목과 동공 좌우가 중첩 키로 나가 통째로 유실
 *      · 산부인과 — 산전·부인과 폼을 객체째 보내 examType 만 저장
 *      · 수술 — `surgeonId` 미전송으로 예약이 **100% 400 실패**
 *
 * 이 스펙은 화면이 보내는 최상위 키가 **실제 핸들러의 @Body DTO 에 있는지** 기계 대조한다.
 * 저장 경로가 다른 키(SOAP 로 보관 등)는 이유와 함께 아래 예외표에만 남긴다 — 조용히 늘지 않게.
 */

const WEB = join(process.cwd(), 'src');
const API = join(process.cwd(), '..', 'api', 'src');
const LAYOUTS = join(WEB, 'app', '(main)', 'patients', '[id]', 'encounter', 'new', 'components');

/** 화면이 보내지만 서버 DTO 에 없어도 되는 키 — **이유가 있는 것만**. */
const ALLOWED: Record<string, Record<string, string>> = {
  // 소견은 진료기록 SOAP(objective)로 저장된다 — exam 행에 중복 보관하지 않는다.
  'OrthopedicsEncounterLayout.tsx': { findings: 'SOAP objective 로 저장(buildSoap)' },
  // 내과는 저장 위치가 셋으로 갈린다(2026-08-18 해소):
  //   활력=`/api/v1/vitals` · HbA1c=exam 컬럼 · 현병력·소견·나머지 검사값·만성질환 목표=진료기록 SOAP.
  //   🔴 오더 없는 검사값을 LabResult 로 만들지 않는다(시행하지 않은 검사의 결과가 된다).
  //   정본 매퍼: `src/lib/specialty/im-note.ts`
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(f) ? [p] : [];
  });
}

/** 전 컨트롤러에서 (전체 경로 → @Body DTO 이름) 표. 한 파일에 @Controller 가 여러 개일 수 있다. */
function routeDtoMap(): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const file of walk(API).filter((f) => f.endsWith('.controller.ts'))) {
    const src = readFileSync(file, 'utf8');
    const prefixes = [...src.matchAll(/@Controller\('([^']*)'\)/g)].map((m) => ({ at: m.index ?? 0, path: m[1] }));
    for (const m of src.matchAll(/@(?:Post|Put|Patch)\('?([^')]*)'?\)((?:.|\n){0,600}?)\)\s*[:{]/g)) {
      const at = m.index ?? 0;
      const prefix = prefixes.filter((p) => p.at < at).slice(-1)[0]?.path ?? '';
      const sub = m[1].replace(/'/g, '');
      const full = `/${[prefix, sub].filter(Boolean).join('/')}`;
      const dto = /@Body\(\)\s*\w+\s*:\s*(\w+)/.exec(m[2]);
      if (!map.has(full)) map.set(full, dto ? dto[1] : null);
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

/** 화면의 post 호출에서 최상위 키를 뽑는다(중첩·스프레드 안쪽은 세지 않는다). */
function topLevelKeys(src: string, from: number): string[] {
  const start = src.indexOf('{', from);
  let depth = 0, i = start;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  const keys: string[] = [];
  let d = 0;
  for (const line of src.slice(start + 1, i).split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*[:,]/.exec(line.trim());
    if (d === 0 && m) keys.push(m[1]);
    d += (line.match(/[{[]/g)?.length ?? 0) - (line.match(/[}\]]/g)?.length ?? 0);
  }
  return keys;
}

describe('진료 입력 화면이 보내는 값은 서버가 실제로 받는다', () => {
  const routes = routeDtoMap();
  const fields = dtoFields();
  const layouts = existsSync(LAYOUTS) ? readdirSync(LAYOUTS).filter((f) => f.endsWith('EncounterLayout.tsx')) : [];

  it('진료 레이아웃을 찾는다(경로가 바뀌면 이 가드가 조용히 통과하지 않도록)', () => {
    expect(layouts.length).toBeGreaterThan(10);
  });

  for (const file of layouts) {
    it(`${file} — 버려지는 키가 없다`, () => {
      const src = readFileSync(join(LAYOUTS, file), 'utf8');
      const allowed = ALLOWED[file] ?? {};
      const problems: string[] = [];

      for (const m of src.matchAll(/apiClient\.post\('(\/api\/v1\/[a-z0-9\-/]+)'/g)) {
        const path = m[1];
        if (!routes.has(path)) { problems.push(`라우트 없음: ${path}`); continue; }
        const dto = routes.get(path);
        if (!dto) { problems.push(`인라인 @Body(검증 스킵): ${path}`); continue; }
        const known = fields.get(dto);
        expect(known, `DTO 클래스를 못 찾음: ${dto}`).toBeDefined();
        for (const key of topLevelKeys(src, (m.index ?? 0) + m[0].length)) {
          if (!known!.has(key) && !(key in allowed)) problems.push(`${path} [${dto}] 가 버리는 키: ${key}`);
        }
      }
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }
});
