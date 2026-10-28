// 트랜잭션 경계 전수 스캔 — 한 메서드 안에서 여러 번 쓰는데 tx 로 묶이지 않은 지점을 찾는다.
// 부분 성공(앞 쓰기만 반영되고 뒤가 실패) 시 데이터가 어긋나는 후보.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'apps/api/src/modules');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.service.ts')) out.push(p);
  }
  return out;
}

const WRITE = /this\.prisma\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g;
const TX = /\$transaction|tx\.\w+\.(create|update|upsert|delete)/;

const rows = [];
for (const f of walk(SRC)) {
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split('\n');

  // 메서드 단위로 자른다(async name( … ) 시작 → 다음 async 또는 파일 끝)
  const starts = [];
  lines.forEach((l, i) => { if (/^\s{2}(private\s+|public\s+)?async\s+\w+\s*\(/.test(l)) starts.push(i); });
  starts.push(lines.length);

  for (let k = 0; k < starts.length - 1; k++) {
    const from = starts[k], to = starts[k + 1];
    const body = lines.slice(from, to).join('\n');
    const name = (lines[from].match(/async\s+(\w+)/) || [])[1] ?? '?';

    const writes = [...body.matchAll(WRITE)].map((m) => `${m[1]}.${m[2]}`);
    if (writes.length < 2) continue;                 // 쓰기 1회 이하는 대상 아님
    if (TX.test(body)) continue;                     // 이미 트랜잭션 사용
    // 서로 다른 모델을 2개 이상 쓰는 경우가 진짜 위험(같은 모델 반복은 루프일 때가 많음)
    const models = new Set(writes.map((w) => w.split('.')[0]));
    rows.push({
      file: path.relative(SRC, f),
      method: name,
      writes: writes.length,
      models: [...models],
      line: from + 1,
    });
  }
}

rows.sort((a, b) => b.models.length - a.models.length || b.writes - a.writes);
fs.writeFileSync(path.join(process.cwd(), 'tx-rows.json'), JSON.stringify(rows, null, 1));

console.log(`tx 미사용 다중 쓰기 메서드 ${rows.length}`);
console.log(`  · 서로 다른 모델 3개 이상: ${rows.filter((r) => r.models.length >= 3).length}`);
console.log(`  · 2개: ${rows.filter((r) => r.models.length === 2).length}`);
console.log(`  · 1개(같은 모델 반복): ${rows.filter((r) => r.models.length === 1).length}`);
console.log('\n== 모델 3개 이상 (부분 성공 시 정합 깨짐 위험 높음) ==');
rows.filter((r) => r.models.length >= 3).slice(0, 25).forEach((r) => {
  console.log(`  ${r.file}:${r.line} ${r.method}() 쓰기${r.writes} [${r.models.join(', ')}]`);
});
