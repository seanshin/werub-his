// RBAC 매트릭스 실적용 스캔 — @Roles 누락 변이 핸들러(과대 권한) 검출.
// RolesGuard 는 @Roles(핸들러 없으면 클래스) 가 없으면 role 검증을 건너뛴다(모든 인증 역할 통과).
const fs = require('fs');
const path = require('path');

const SRC = require('path').join(__dirname, '..', 'apps/api/src/modules');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

const rows = [];
for (const f of walk(SRC)) {
  const src = fs.readFileSync(f, 'utf8');
  // RolesGuard 를 실제로 쓰는가
  if (!/@UseGuards\([^)]*RolesGuard/.test(src)) continue;
  const lines = src.split('\n');

  // 클래스 레벨 @Roles 여부 — @Controller 직전 데코레이터 블록
  const ctrlIdx = lines.findIndex((l) => /@Controller\(/.test(l));
  const classHead = lines.slice(Math.max(0, ctrlIdx - 8), ctrlIdx).join('\n');
  const classHasRoles = /@Roles\(/.test(classHead);
  const classHasPerm = /@RequirePermission\(|@RequireFeature\(/.test(classHead);
  const classHasPublic = /@Public\(|@NoAuth|SkipAuth/.test(classHead);

  // 각 변이 핸들러(@Post/@Patch/@Delete/@Put)에서 위쪽 데코레이터에 @Roles/@RequirePermission 있는지
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/@(Post|Put|Patch|Delete)\(/);
    if (!m) continue;
    // 핸들러 데코레이터 블록 — @method 위쪽 12줄 + async 선언까지 아래로(데코레이터 순서 무관)
    let end = i + 1;
    while (end < lines.length && end < i + 12 && !/^\s*(public |private |async )?\w+\s*\(/.test(lines[end])) end++;
    const around = lines.slice(Math.max(0, i - 12), end + 1).join('\n');
    const hasRoles = /@Roles\(/.test(around);
    const hasPerm = /@RequirePermission\(|@RequireFeature\(/.test(around);
    const route = (lines[i].match(/@\w+\(\s*['"`]([^'"`]*)/) || [])[1] ?? '';
    if (!classHasRoles && !classHasPerm && !hasRoles && !hasPerm && !classHasPublic) {
      rows.push({
        file: path.relative(SRC, f),
        method: m[1].toUpperCase(),
        route,
        line: i + 1,
      });
    }
  }
}

fs.writeFileSync(path.join(process.cwd(), 'rbac-rows.json'), JSON.stringify(rows, null, 1));
console.log(`RolesGuard 붙었으나 @Roles/@RequirePermission 없는 변이 핸들러: ${rows.length}`);
const byMod = {};
for (const r of rows) { const mod = r.file.split('/')[0]; (byMod[mod] ??= []).push(r); }
for (const [mod, v] of Object.entries(byMod).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(v.length).padStart(3)} ${mod}`);
}
