// UI 미노출 필드 스캔 1단계 — 페이지별 (호출 API, JSX 참조 필드) 추출
const fs = require('fs');
const path = require('path');

const WEB = require('path').join(__dirname, '..', '..', 'apps/web/src/app');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === 'page.tsx') out.push(p);
  }
  return out;
}

// 같은 폴더의 components/*.tsx 도 화면의 일부로 본다
function siblings(pageFile) {
  const dir = path.dirname(pageFile);
  const out = [];
  for (const sub of ['components', '.']) {
    const d = path.join(dir, sub);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (f.endsWith('.tsx') && path.join(d, f) !== pageFile) out.push(path.join(d, f));
    }
  }
  return out;
}

const API_RE = /['"`](\/api\/v1\/[A-Za-z0-9\-_/${}.:]*)['"`]/g;
// JSX/코드에서 참조되는 속성 접근자 (obj.field / obj?.field)
const FIELD_RE = /(?:\?\.|\.)([a-z][A-Za-z0-9_]{1,40})\b/g;

const IGNORE_FIELDS = new Set([
  'map','filter','find','length','toString','then','catch','push','slice','join','split','replace',
  'toLocaleString','toLocaleDateString','toLocaleTimeString','toFixed','includes','forEach','reduce',
  'data','json','ok','status','value','target','current','props','children','key','className','style',
  'trim','some','every','sort','concat','keys','entries','values','padStart','startsWith','endsWith',
  'toUpperCase','toLowerCase','getTime','getFullYear','setHours','flat','flatMap','indexOf','at','matchAll',
]);

const pages = walk(WEB);
const rows = [];
for (const p of pages) {
  const files = [p, ...siblings(p)];
  const apis = new Set();
  const fields = new Set();
  let size = 0;
  for (const f of files) {
    let src;
    try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
    size += src.length;
    let m;
    API_RE.lastIndex = 0;
    while ((m = API_RE.exec(src))) apis.add(m[1].replace(/\$\{[^}]*\}/g, ':id'));
    FIELD_RE.lastIndex = 0;
    while ((m = FIELD_RE.exec(src))) if (!IGNORE_FIELDS.has(m[1])) fields.add(m[1]);
  }
  rows.push({
    page: path.relative(WEB, p),
    files: files.length,
    size,
    apis: [...apis],
    fields: [...fields],
  });
}

fs.writeFileSync(path.join(process.cwd(), 'ui-pages.json'), JSON.stringify(rows, null, 1));
console.log(`페이지 ${pages.length} · API 참조 총 ${rows.reduce((s, r) => s + r.apis.length, 0)}`);
const withApi = rows.filter((r) => r.apis.length);
console.log(`API 를 호출하는 페이지 ${withApi.length}`);
console.log('\n== API 호출이 많은 화면 상위 20 ==');
withApi.sort((a, b) => b.apis.length - a.apis.length).slice(0, 20)
  .forEach((r) => console.log(String(r.apis.length).padStart(3), r.page.replace(/\/page\.tsx$/, ''), `(필드참조 ${r.fields.length})`));
