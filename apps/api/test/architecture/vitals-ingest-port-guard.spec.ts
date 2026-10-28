import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 구조 가드 — **활력 저장은 수집 포트를 지나야 한다.**
 *
 * 기획: `docs/01-plan/features/vitals-device-integration.plan.md` §10-1(포트 우회 금지 가드).
 *
 * 🔴 이 축의 결함은 "같은 개념이 경로마다 다르게 처리됨"이었다. 외래에서 봉합한 미관측 처리가
 *    입원 경로에 그대로 남아 하루 뒤 다시 고쳐야 했던 일이 실제로 있었다(기획 §1.1).
 *    저장 지점이 다시 늘어나면 같은 일이 반복된다 — 그래서 **여유 0 으로 동결**한다.
 *
 * 실패하면 둘 중 하나다:
 *   1. 새 코드가 `preVisitVitals.create`·`flowSheetEntry.create`·`icuRecord.create` 를 직접 불렀다
 *      → `VitalsIngestService.ingest()` 로 보낸다
 *   2. 포트를 리팩터링해 파일이 옮겨졌다 → 아래 `PORT_FILE` 을 갱신한다(늘리는 방향은 근거 필요)
 */

const API_SRC = path.join(__dirname, '..', '..', 'src');
const PORT_FILE = 'modules/vitals/vitals-ingest.service.ts';

/** 활력 저장소 3종의 생성 호출 — 포트 밖에서 나타나면 안 된다 */
const CREATE_PATTERNS = [
  /\bpreVisitVitals\s*\.\s*create\b/g,
  /\bflowSheetEntry\s*\.\s*create\b/g,
  /\bicuRecord\s*\.\s*create\b/g,
];

/**
 * 🔴 주석을 코드로 세지 않는다 — 이 저장소에서 코디네이터가 두 번 저지른 오탐이다.
 *    "이러이러하게 부르지 말라"고 적은 주석이 위반으로 잡히면, 사람은 가드가 아니라 주석을 지운다.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

describe('활력 수집 포트 — 우회 금지(구조 가드)', () => {
  const files = walk(API_SRC);

  it('활력 저장소 3종의 create 는 수집 포트 파일에서만 호출된다(여유 0)', () => {
    const offenders: { file: string; hits: number }[] = [];
    for (const f of files) {
      const rel = path.relative(API_SRC, f).split(path.sep).join('/');
      if (rel === PORT_FILE) continue;
      const src = stripComments(fs.readFileSync(f, 'utf8'));
      const hits = CREATE_PATTERNS.reduce((n, re) => n + (src.match(re)?.length ?? 0), 0);
      if (hits > 0) offenders.push({ file: rel, hits });
    }
    expect(offenders).toEqual([]);
  });

  it('포트 파일은 세 저장소를 전부 쓴다(라우팅이 살아 있다)', () => {
    const src = stripComments(fs.readFileSync(path.join(API_SRC, PORT_FILE), 'utf8'));
    for (const re of CREATE_PATTERNS) expect(src).toMatch(re);
  });

  it('활력 쓰기 서비스 3곳이 포트를 부른다', () => {
    for (const rel of [
      'modules/vitals/vitals.service.ts',
      'modules/nursing/nursing.service.ts',
      'modules/icu/icu.service.ts',
    ]) {
      const src = stripComments(fs.readFileSync(path.join(API_SRC, rel), 'utf8'));
      expect(src, `${rel} 가 수집 포트를 부르지 않는다`).toMatch(/\.ingest\s*(<[^>]*>)?\s*\(/);
    }
  });
});
