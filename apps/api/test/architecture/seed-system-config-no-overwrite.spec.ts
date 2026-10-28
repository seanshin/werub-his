import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **시드는 운영자가 바꾼 시스템 설정을 덮어쓰지 않는다** — 시드 소스 구조 가드.
 *
 * 왜(2026-09-21 · 형제 프로젝트 인바운드 H1 · 기준 커밋 `e9d303984f80` 코드 읽기):
 *   `prisma/seed.ts` 의 시스템 설정 루프가 `upsert` 의 `update: { value: sc.value }` 로 **기존 행을 덮어썼다.**
 *   그래서 관리자가 `/admin/ai-settings` 에서 꺼 둔 `ai.server.enabled` 가 시드 재실행으로 다시 켜지고,
 *   `ai.server.url` 이 특정 설치본 주소로 되돌아가고, 기관이 입력한 병원명·병상 수·진료 시간·본인부담률·
 *   위급값 기준이 데모 값으로 되돌아갔다. `seed-lab-lis-enrich.ts` 의 `preauth.imaging`(고가 검사 판정 기준)도
 *   같은 모양이었다.
 *
 * 규칙(CLAUDE.md §시드가 정책을 정해버린다):
 *   시드는 **없을 때 기본값을 넣는 일**만 한다 — 값 변경은 관리 화면(사람)의 몫이다.
 *   그래서 시드 파일의 `systemConfig` 쓰기는 `create` 뿐이어야 하고, `upsert` 의 `update` 는 **비어 있어야** 한다.
 *   기존 행을 손대는 `update()` · `updateMany()` · `deleteMany()` 도 시드에는 두지 않는다(현재 0건 — 동결).
 *
 * 🔴 이 가드는 시드를 **실행하지 않는다**(운영 DB 접속·시드 실행 금지). 소스 모양만 본다.
 */

const PRISMA_DIR = join(process.cwd(), 'prisma');
const SEED_EXT = /\.(ts|js|cjs|mjs)$/;

/** 🔴 `fs.globSync` 는 Node 22+ 다 — CI(engines 20)에서 가드가 조용히 죽는다. readdirSync 재귀로 센다. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'migrations' || entry === 'manual') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SEED_EXT.test(entry) && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/**
 * 주석을 걷어낸 본문. 🔴 결함을 **설명하는 주석**에 정규식이 걸려 고쳐진 파일을 신고한 전례가 있다
 * (`seed-generator-consistency-guard.spec.ts` 머리말). 코드 모양을 보는 단언은 코드만 본다.
 *
 * 🔴 그런데 **정규식으로 주석을 걷으면 문자열을 주석으로 읽는다** — 이 가드를 만들면서 실제로 당했다.
 *    `/\/\*[\s\S]*?\*\//g` 는 SMART 스코프 문자열 `'patient/*.read'` 의 `/*` 를 블록 주석 시작으로 보고
 *    거기서부터 **288,217자**(seed.ts 의 1/3)를 지웠고, 그 안에 있던 시스템 설정 upsert 가 통째로 사라져
 *    **결함을 재주입해도 가드가 통과**했다(재주입 역검증이 유일한 증거 — CLAUDE.md §3).
 *    그래서 문자열·템플릿 리터럴을 아는 상태 기계로 걷는다. 길이 보존은 `countRaw` 대조군이 지킨다.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') {
          out += '  ';
          i += 2;
          continue;
        }
        if (src[i] === quote) break;
        // 🔴 리터럴 안의 `/*`·`//` 가 다음 단계에 새지 않도록 중립 문자로 바꿔 담는다(길이 보존)
        out += src[i] === '/' || src[i] === '{' || src[i] === '}' ? '_' : src[i];
        i++;
      }
      out += quote;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** 주석 제거가 **코드를 먹지 않았는지** 대조하는 원시 카운트 */
const countRaw = (src: string) => (src.match(/\.systemConfig\.(upsert|update|updateMany|deleteMany)\s*\(/g) ?? []).length;

/** `start` 의 여는 괄호부터 짝이 맞는 닫는 괄호까지(문자열 리터럴 무시하지 않는 단순 카운터 — 시드에 괄호 문자열은 없다). */
function balanced(src: string, start: number, open: string, close: string): string {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
}

type Finding = { file: string; kind: string; snippet: string };

function scanSeedFiles(): { files: string[]; findings: Finding[] } {
  const files = walk(PRISMA_DIR);
  const findings: Finding[] = [];

  for (const file of files) {
    const code = stripComments(readFileSync(file, 'utf-8'));
    const rel = file.slice(file.indexOf('prisma/'));

    // ① 기존 행을 직접 고치거나 지우는 호출 — 시드에 두지 않는다
    for (const m of code.matchAll(/\.systemConfig\.(update|updateMany|deleteMany)\s*\(/g)) {
      findings.push({ file: rel, kind: `systemConfig.${m[1]}()`, snippet: code.slice(m.index, m.index + 120) });
    }

    // ② upsert 의 update 절이 비어 있는가
    for (const m of code.matchAll(/\.systemConfig\.upsert\s*\(/g)) {
      const argStart = code.indexOf('{', m.index);
      if (argStart < 0) continue;
      const arg = balanced(code, argStart, '{', '}');
      // 최상위 `update:` 만 본다 — `create:` 안의 중첩 키에 걸리지 않게 depth 를 센다
      let depth = 0;
      let updateValue: string | null = null;
      for (let i = 0; i < arg.length; i++) {
        const ch = arg[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        else if (depth === 1 && arg.startsWith('update:', i) && !/[A-Za-z0-9_$]/.test(arg[i - 1] ?? '')) {
          const vStart = arg.indexOf('{', i);
          updateValue = vStart < 0 ? arg.slice(i, i + 60) : balanced(arg, vStart, '{', '}');
          break;
        }
      }
      if (updateValue !== null && updateValue.replace(/\s/g, '') !== '{}') {
        findings.push({ file: rel, kind: 'systemConfig.upsert update 절이 비어 있지 않다', snippet: updateValue.slice(0, 160) });
      }
    }
  }
  return { files, findings };
}

describe('시드 — 운영자가 바꾼 시스템 설정을 되돌리지 않는다', () => {
  it('🔴 시드 파일이 기존 SystemConfig 행을 덮어쓰지 않는다 (create 만 한다)', () => {
    const { findings } = scanSeedFiles();
    const lines = findings.map((f) => `  · ${f.file} — ${f.kind}\n      ${f.snippet.replace(/\s+/g, ' ')}`).join('\n');
    expect(
      findings,
      '시드가 기존 시스템 설정을 덮어쓴다 — 관리자가 꺼 둔 기능이 시드 재실행으로 다시 켜진다.\n' +
        '`update: {}` 로 두고, 값 변경은 관리 화면에서 한다.\n' +
        lines,
    ).toEqual([]);
  });

  it('대조군 — 스캐너가 실제로 시드 파일과 systemConfig 쓰기를 보고 있다 (0건으로 통과하지 않는다)', () => {
    const { files } = scanSeedFiles();
    // 🔴 "결함 0건"이 **스캔 대상 0건** 때문이면 이 가드는 아무것도 보증하지 않는다.
    expect(files.length, 'prisma 아래 시드 파일을 하나도 찾지 못했다 — 경로 규칙이 바뀌었다').toBeGreaterThan(20);
    const withConfigWrite = files.filter((f) => countRaw(readFileSync(f, 'utf-8')) > 0);
    expect(withConfigWrite.length, 'systemConfig 를 쓰는 시드 파일이 하나도 없다 — 스캐너 정규식이 헛돈다').toBeGreaterThanOrEqual(2);
  });

  it('🔴 대조군 — 주석 제거가 코드를 먹지 않는다 (문자열 안의 `/*` 로 upsert 가 사라진 적이 있다)', () => {
    const { files } = scanSeedFiles();
    for (const file of files) {
      const raw = readFileSync(file, 'utf-8');
      const rawN = countRaw(raw);
      if (rawN === 0) continue;
      expect(
        countRaw(stripComments(raw)),
        `${file.slice(file.indexOf('prisma/'))} — 주석 제거 뒤 systemConfig 쓰기가 ${rawN}건에서 줄었다.\n` +
          '문자열 리터럴을 주석으로 읽어 코드를 지운 것이다 — 이 상태면 결함을 재주입해도 가드가 통과한다.',
      ).toBe(rawN);
    }
  });
});
