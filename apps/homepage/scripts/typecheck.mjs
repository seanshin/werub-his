#!/usr/bin/env node
/**
 * apps/homepage 타입 검사 계측 — 파일별 오류 수와 오류 종류를 낸다.
 *
 * 🔴 (2026-09-14 P6) "격리 npm install 이 없어 기존 오류 73건"으로 기록돼 있었지만 실측은 **의존성 문제가 아니었다**.
 *    워크스페이스 node_modules 로 tsc 가 정상 동작하고, 73건 전부가 4개 페이지(en·international·ja·zh)의
 *    **JSX 구문 오류**다 — `STATS.map(s => ( {/* 주석 *\/} <div …> ))` 처럼 괄호 안 첫 요소 앞에 JSX 주석을 넣어
 *    객체 리터럴로 해석된다(커밋 5a4a08bd, 2026-09-03). 같은 문법은 Next(SWC) 빌드도 거부할 수 있다(next build 는 여기서 돌리지 않는다).
 *    → 2026-09-14 Q6 교정(주석을 괄호 밖으로) · 교정 후 구문·의미 오류 0.
 *
 * 🔴 tsc 는 구문 오류가 있으면 의미 검사(TS2307 모듈 없음 등)를 건너뛴다 — 지금의 '구문 오류만'은 의미 오류가 없다는 뜻이 아니다.
 *
 * 사용:
 *   node apps/homepage/scripts/typecheck.mjs          # 파일별 표
 *   node apps/homepage/scripts/typecheck.mjs --json   # { total, byFile, byCode, syntaxOnly }
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const r = spawnSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json', '--pretty', 'false'], { cwd: APP, encoding: 'utf8', timeout: 240_000 });
if (r.error) {
  console.error(`tsc 실행 실패 — 측정 불가(0 건으로 세지 않는다): ${r.error.message}`);
  process.exit(2);
}
const lines = `${r.stdout}\n${r.stderr}`.split('\n').filter((l) => /error TS\d+/.test(l));
if (r.status !== 0 && lines.length === 0) {
  console.error(`tsc 가 오류 코드 ${r.status} 로 끝났는데 오류 줄을 읽지 못했다 — 측정 불가:\n${(r.stderr || r.stdout).slice(0, 800)}`);
  process.exit(2);
}
const byFile = {};
const byCode = {};
for (const l of lines) {
  const file = l.split('(')[0].trim();
  const code = /error (TS\d+)/.exec(l)[1];
  byFile[file] = (byFile[file] ?? 0) + 1;
  byCode[code] = (byCode[code] ?? 0) + 1;
}
// TS1xxx = 구문(파서) 오류 · TS17xxx/TS2657 = JSX 구조 오류 — 타입·의존성 오류(TS2307 모듈 없음 등)가 섞였는지 가른다
const syntaxOnly = Object.keys(byCode).every((c) => /^TS1\d{3}$/.test(c) || /^TS17\d{3}$/.test(c) || c === 'TS2657');
const out = { total: lines.length, byFile, byCode, syntaxOnly };
if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(out));
} else {
  console.log(`apps/homepage tsc 오류 ${out.total}건 · 구문 오류만: ${syntaxOnly ? '예' : '아니오'}`);
  for (const [f, n] of Object.entries(byFile)) console.log(`  ${String(n).padStart(4)}  ${f}`);
  console.log(`  종류: ${Object.entries(byCode).map(([c, n]) => `${c}×${n}`).join(' · ')}`);
}
