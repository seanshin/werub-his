// N+1 스캔 — 배열 순회(map/for) 안에서 prisma 쿼리를 도는 패턴 검출.
const fs = require('fs');
const path = require('path');
const SRC = require('path').join(__dirname, '..', 'apps/api/src/modules');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.service.ts')) out.push(p);
  }
  return out;
}

const rows = [];
for (const f of walk(SRC)) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  // .map(async / for(...) 블록 안에서 this.prisma.*.find/count/aggregate 를 찾는다
  for (let i = 0; i < lines.length; i++) {
    const loopStart = /\.map\(\s*async|\.forEach\(\s*async|for\s*\(|for await\s*\(/.test(lines[i]);
    if (!loopStart) continue;
    // 루프 블록 끝(들여쓰기 기반 근사): 최대 30줄 내에서 prisma 쿼리 탐색
    for (let j = i + 1; j < Math.min(i + 30, lines.length); j++) {
      // 중첩 map/Promise.all 로 이미 병렬화됐으면 제외
      const q = lines[j].match(/this\.prisma\.(\w+)\.(findUnique|findFirst|findMany|count|aggregate|groupBy)\(/);
      if (q) {
        // 같은 루프 헤더에 Promise.all 이 감싸면 병렬(N+1 아님) — 위 3줄 확인
        const ctx = lines.slice(Math.max(0, i - 2), i + 1).join('\n');
        const parallel = /Promise\.all|Promise\.allSettled/.test(ctx);
        rows.push({
          file: path.relative(SRC, f),
          loopLine: i + 1,
          queryLine: j + 1,
          model: q[1],
          op: q[2],
          parallel,
        });
        break; // 루프당 첫 쿼리만
      }
      // 루프 종료 근사
      if (/^\s{0,4}\}\)?;?\s*$/.test(lines[j]) && j > i + 1) break;
    }
  }
}

fs.writeFileSync(path.join(process.cwd(), 'nplus1-rows.json'), JSON.stringify(rows, null, 1));
const seq = rows.filter((r) => !r.parallel);
console.log(`루프 내 prisma 쿼리 ${rows.length} (병렬 ${rows.length - seq.length} · 순차 N+1 후보 ${seq.length})`);
const byMod = {};
for (const r of seq) { const m = r.file.split('/')[0]; (byMod[m] ??= []).push(r); }
console.log('\n== 순차 N+1 후보 모듈별 ==');
for (const [m, v] of Object.entries(byMod).sort((a, b) => b[1].length - a[1].length).slice(0, 20)) {
  console.log(`  ${String(v.length).padStart(3)} ${m}  [${[...new Set(v.map((x) => x.model + '.' + x.op))].slice(0, 3).join(', ')}]`);
}
