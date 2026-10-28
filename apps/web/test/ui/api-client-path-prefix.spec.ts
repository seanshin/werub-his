import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 `apiClient` 는 경로 접두를 **붙여주지 않는다** — `url = API_URL + path` 그대로다.
 *    그래서 호출부가 `/api/v1/...` 를 전부 적어야 한다.
 *
 * 2026-08-25 실측: 운영 모드 조회를 `'/mode'` 로 적어 **Next 페이지 404** 를 받았고,
 * 화면은 그것을 정직하게 "서버 미확인"으로 표시했다 — 배너가 없었으면 조용히 틀린 값이 됐을 것이다.
 * 이 계약은 눈으로 지킬 수 없으니 기계가 지킨다.
 */
const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** `apiClient.get('…')` / `apiClient.put(`…`)` 의 첫 인자 리터럴만 뽑는다(변수는 판정하지 않는다). */
const CALL = /apiClient\.(?:get|post|put|patch|del)\s*(?:<[^(]*>)?\s*\(\s*['"`]([^'"`]+)['"`]/g;

describe('apiClient 호출 경로는 접두를 포함한다', () => {
  const files = walk(SRC);

  /** 첫 인자 리터럴을 모두 모은다. 보간(`${API}/x`)은 **판정하지 않는다** — 접두가 상수 안에 있다. */
  const collect = () => {
    const judged: { file: string; path: string }[] = [];
    const skipped: { file: string; path: string }[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(CALL)) {
        const path = m[1];
        const rec = { file: f.replace(SRC + '/', ''), path };
        // 🔴 `${…}` 로 시작하면 접두가 그 상수 안에 있다 — 여기서는 알 수 없으므로 판정하지 않는다.
        //    (첫 판은 이것을 위반으로 세어 11건을 거짓 보고했다 — 내 스캐너가 먼저 틀렸다.)
        (path.startsWith('/') ? judged : skipped).push(rec);
      }
    }
    return { judged, skipped };
  };

  // 🔴 정본 접두는 **둘**이다 — CLAUDE.md: `/api/v1/`(내부) · `/fhir/R4/`(FHIR).
  //    처음엔 `/api/` 만 규칙으로 잡아 전원서 화면의 정당한 FHIR 호출 3건을 위반으로 셌다.
  //    **규칙은 내 가정이 아니라 문서의 계약에서 가져온다.**
  const VALID_PREFIXES = ['/api/', '/fhir/'];

  it('리터럴 경로는 정본 접두(`/api/` 또는 `/fhir/`)로 시작한다', () => {
    const { judged } = collect();
    const bad = judged.filter((r) => !VALID_PREFIXES.some((pre) => r.path.startsWith(pre)));
    expect(bad.map((r) => `${r.file} → ${r.path}`), '접두 없는 호출').toEqual([]);
  });

  it('🔴 대조군 — 이 스캐너가 실제로 호출부를 찾고 있다(0건을 통과로 읽지 않는다)', () => {
    const { judged } = collect();
    expect(judged.length, 'apiClient 리터럴 호출을 못 찾았다면 정규식이 죽은 것이다').toBeGreaterThan(50);
  });

  it('🔴 판정하지 못한 것(보간 경로)이 몇 건인지 밝힌다 — "전부 확인했다"고 말하지 않는다', () => {
    const { skipped } = collect();
    // 접두가 상수 안에 있어 이 가드로는 확인할 수 없다. 건수만 고정해 **늘어나면 알아채게** 한다.
    expect(skipped.length, `보간 경로 ${skipped.length}건은 이 가드의 범위 밖이다`).toBeLessThanOrEqual(40);
  });
});
