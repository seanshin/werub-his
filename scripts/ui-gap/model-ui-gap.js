// UI 미노출 필드 스캔 3단계 — Prisma 모델 스칼라 필드 ↔ 웹 전체 사용 대조
// "DB 가 보유하는데 화면 어디에도 없는 필드" 를 모델 단위로 뽑는다.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = require('path').join(__dirname, '..', '..');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'apps/api/prisma/schema.prisma'), 'utf8');
const WEB = path.join(ROOT, 'apps/web/src');

const TARGET_MODELS = process.argv.slice(2); // 비우면 전체 모델

// 노출 가치가 없는 기술 필드
const SKIP = /^(id|createdAt|updatedAt|createdBy|updatedBy|deletedAt|validFrom|validTo)$/;
// *By 는 사용자 UUID — 화면에는 ID 가 아니라 **관계(이름)** 로 노출하는 것이 원칙이므로
// 미노출 후보에서 제외한다. 대신 해당 관계가 응답 include 에 들어 있는지는 별도로 확인할 것
// (실례: Order.acknowledger 는 관계가 있었는데 include 누락이라 이름을 쓸 수 없었다 — 2026-07).
const SKIP_SUFFIX = /(Id|Ids|By|Hash|Token|Secret|Signature)$/;

function parseModels(src) {
  const out = new Map();
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m;
  while ((m = re.exec(src))) {
    const [, name, body] = m;
    const fields = [];
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('//') || t.startsWith('@@')) continue;
      const fm = t.match(/^(\w+)\s+([\w\[\]?]+)/);
      if (!fm) continue;
      const [, fname, ftype] = fm;
      // 관계 필드(대문자 시작 타입, 스칼라 아님) 제외
      if (/^[A-Z]/.test(ftype.replace(/[\[\]?]/g, '')) && !/^(String|Int|Float|Boolean|DateTime|Decimal|Json|BigInt|Bytes)$/.test(ftype.replace(/[\[\]?]/g, ''))) {
        // enum 일 수 있으므로 enum 목록 확인
        if (!new RegExp(`^enum\\s+${ftype.replace(/[\\[\\]?]/g, '')}\\s*\\{`, 'm').test(src)) continue;
      }
      fields.push({ name: fname, type: ftype });
    }
    out.set(name, fields);
  }
  return out;
}

const models = parseModels(SCHEMA);

// 웹 소스를 한 번만 읽어 메모리에서 검색 — 모델 전량(512) 스캔 시 grep 스폰 비용이 지배적이었다
let WEB_SRC = null;
function loadWeb() {
  if (WEB_SRC) return WEB_SRC;
  const acc = [];
  (function walkWeb(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walkWeb(p); }
      else if (/\.(tsx?|jsx?)$/.test(e.name)) acc.push(fs.readFileSync(p, 'utf8'));
    }
  })(WEB);
  WEB_SRC = acc.join('\n');
  return WEB_SRC;
}

function webUsage(field) {
  const src = loadWeb();
  return new RegExp(`\\b${field}\\b`).test(src) ? 1 : 0;
}

const MODELS_TO_SCAN = TARGET_MODELS.length ? TARGET_MODELS : [...models.keys()];
let totalUnused = 0;
for (const model of MODELS_TO_SCAN) {
  const fields = models.get(model);
  if (!fields) { console.log(`(모델 없음: ${model})`); continue; }
  const cands = fields.filter((f) => !SKIP.test(f.name) && !SKIP_SUFFIX.test(f.name));
  const unused = [];
  for (const f of cands) {
    const n = webUsage(f.name);
    if (n === 0) unused.push(f);
  }
  if (!unused.length) continue; // 전량 스캔 시 잡음 제거 — 미노출이 있는 모델만 출력
  totalUnused += unused.length;
  console.log(`\n== ${model} — 스칼라 ${cands.length} 중 웹 미사용 ${unused.length} ==`);
  unused.forEach((f) => console.log(`   · ${f.name.padEnd(28)} ${f.type}`));
}

if (!TARGET_MODELS.length) console.log(`\n전체 ${MODELS_TO_SCAN.length} 모델 · 미노출 필드 총 ${totalUnused}`);
