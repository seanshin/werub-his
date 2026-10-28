import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 시드가 만든 처방에 오더가 딸려 있는가 — 소스 대조 스캐너.
 *
 * 🔴 왜 (2026-09-16 운영 실측): `prescriptions` 1,772 중 오더 없는 것 **250 건이 전부 시드 산출물**이었다.
 *    런타임 정본(`PrescriptionService.create` 외 7 경로)은 처방·오더를 **한 트랜잭션에서** 만드는데,
 *    시드 4곳만 처방을 단독으로 넣었다(chart-richness 182 · chronic-followup 60 · e2e SQL 5 · timeline 3).
 *    오더 없는 처방은 조제 큐(`orders` 기준)·오더 서명 원장·완료 경로에 **영영 보이지 않는다**.
 *    정합성 스캔 07(⚪)이 244 로 이미 보고하고 있었으나 원인이 특정되지 않아 방치돼 있었다.
 *
 * 세는 규칙: `prisma|tx.prescription.(create|upsert)` 한 건마다 **그 처방을 가리키는 오더 생성**이
 * 같은 파일 안에 있어야 한다. id 를 명시하면 그 식(`makeId('rx', …)`·`rxId`)으로, 명시하지 않으면
 * 대입된 변수(`const rx = await …` → `rx.id`)로 잇는다. SQL 은 INSERT 행의 id 값으로 잇는다.
 *
 * 🔴 주석·문자열을 코드로 읽지 않는다 — 이 저장소에서 두 번 났다(v4.11.0 · E4 크론 스캐너).
 */
export interface SeedRxRow {
  file: string;
  line: number;
  /** 이 처방을 가리키는 토큰(정규화) — 오더의 prescriptionId 와 대조한다 */
  token: string;
  paired: boolean;
}

/** 블록 주석·줄 주석 제거(문자열 안의 `//` 는 남긴다 — URL·정규식이 통째로 지워지던 함정) */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

/** SQL 주석(`--`) 제거 */
export function stripSqlComments(src: string): string {
  return src
    .split('\n')
    .map((l) => l.replace(/(^|[^'"])--.*$/, '$1'))
    .join('\n');
}

const norm = (s: string) => s.replace(/\s+/g, '').replace(/[`'"]/g, "'");

/**
 * 단순 식별자 토큰(`rxId`)은 **선언식까지 풀어서** 비교한다.
 * 🔴 (재주입에서 드러남) chart-richness 는 외래·입원 두 반복문이 **같은 변수명 `rxId`** 를 쓴다.
 *    이름만으로 이으면 한쪽 오더가 다른 쪽 처방까지 대신 짝지어 — 오더 생성을 지워도 가드가 통과했다.
 *    호출 위치 **앞의 가장 가까운 `const <이름> = …`** 로 풀어 서로 다른 토큰이 되게 한다.
 */
function resolveToken(code: string, token: string, atIdx: number): string {
  if (!/^[A-Za-z_$][\w$]*$/.test(token)) return token;
  const re = new RegExp(`const\\s+${token}\\s*=\\s*([^;\\n]+)`, 'g');
  let best: string | null = null;
  for (const d of code.matchAll(re)) {
    if (d.index! > atIdx) break;
    best = d[1];
  }
  return best ? norm(best) : token;
}

/** `(` 부터 균형 잡힌 닫는 괄호까지 — 중첩 객체·화살표 함수를 넘기기 위해 */
function balanced(src: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      depth--;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  return src.slice(openIdx);
}

const RX_CALL = /(?:const\s+(\w+)\s*=\s*)?await\s+(?:this\.)?(?:prisma|tx)\.prescription\.(create|upsert)\s*\(/g;
const ORDER_CALL = /(?:prisma|tx)\.order\.(?:create|upsert)\s*\(/g;

function scanTs(code: string, file: string): SeedRxRow[] {
  // 오더가 가리키는 처방 토큰 집합
  const orderTargets = new Set<string>();
  for (const m of code.matchAll(ORDER_CALL)) {
    const block = balanced(code, m.index! + m[0].length - 1);
    for (const t of block.matchAll(/prescriptionId\s*:\s*([^,\n}]+)/g)) orderTargets.add(resolveToken(code, norm(t[1]), m.index!));
    // `create: { id, ...orderData }` 처럼 **객체를 변수에 담아 펼치는** 모양 — 변수 선언까지 따라간다.
    // 🔴 이걸 안 따라가면 recent-clinical-activity 처럼 정상 페어링을 "오더 없음"으로 신고한다(첫 판이 그랬다).
    for (const sp of block.matchAll(/\.\.\.(\w+)/g)) {
      const decl = code.match(new RegExp(`const\\s+${sp[1]}\\s*=\\s*\\{`));
      if (!decl) continue;
      const obj = balanced(code, decl.index! + decl[0].length - 1);
      for (const t of obj.matchAll(/prescriptionId\s*:\s*([^,\n}]+)/g)) orderTargets.add(resolveToken(code, norm(t[1]), m.index!));
    }
  }

  const rows: SeedRxRow[] = [];
  for (const m of code.matchAll(RX_CALL)) {
    const assigned = m[1];
    const block = balanced(code, m.index! + m[0].length - 1);
    // id 를 명시했으면 그 식, 아니면 대입 변수의 `.id`
    const idExpr =
      block.match(/where\s*:\s*\{\s*id\s*:\s*([^,\n}]+)/)?.[1] ??
      block.match(/\bid\s*:\s*([^,\n}]+)/)?.[1];
    const token = idExpr
      ? resolveToken(code, norm(idExpr), m.index!)
      : assigned ? norm(`${assigned}.id`) : `(익명:${m.index})`;
    rows.push({
      file,
      line: code.slice(0, m.index).split('\n').length,
      token,
      paired: orderTargets.has(token),
    });
  }
  return rows;
}

function scanSql(code: string, file: string): SeedRxRow[] {
  const orderTargets = new Set<string>();
  for (const m of code.matchAll(/INSERT\s+INTO\s+orders\s*\(([^)]*)\)\s*VALUES([\s\S]*?);/gi)) {
    const cols = m[1].split(',').map((c) => c.trim().toLowerCase());
    const pos = cols.indexOf('prescription_id');
    if (pos < 0) continue;
    for (const row of m[2].matchAll(/\(([^)]*)\)/g)) {
      const vals = row[1].split(',').map((v) => v.trim());
      if (vals[pos]) orderTargets.add(norm(vals[pos]));
    }
  }

  const rows: SeedRxRow[] = [];
  for (const m of code.matchAll(/INSERT\s+INTO\s+prescriptions\s*\(([^)]*)\)\s*VALUES([\s\S]*?);/gi)) {
    const cols = m[1].split(',').map((c) => c.trim().toLowerCase());
    const pos = cols.indexOf('id');
    const startLine = code.slice(0, m.index).split('\n').length;
    for (const row of m[2].matchAll(/\(([^)]*)\)/g)) {
      const vals = row[1].split(',').map((v) => v.trim());
      const token = pos >= 0 && vals[pos] ? norm(vals[pos]) : `(id미상:${file})`;
      rows.push({ file, line: startLine, token, paired: orderTargets.has(token) });
    }
  }
  return rows;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'migrations') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|sql)$/.test(p) && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** prisma 시드 전체를 훑어 "오더 없는 처방 생성" 자리를 돌려준다 */
export function scanSeedPrescriptions(prismaDir: string): SeedRxRow[] {
  const rows: SeedRxRow[] = [];
  for (const f of walk(prismaDir)) {
    const rel = relative(prismaDir, f);
    const raw = readFileSync(f, 'utf-8');
    if (f.endsWith('.sql')) {
      if (!/INSERT\s+INTO\s+prescriptions/i.test(raw)) continue;
      rows.push(...scanSql(stripSqlComments(raw), rel));
    } else {
      if (!/prescription\.(create|upsert)/.test(raw)) continue;
      rows.push(...scanTs(stripComments(raw), rel));
    }
  }
  return rows;
}

export const unpairedByFile = (rows: SeedRxRow[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const r of rows) if (!r.paired) out[r.file] = (out[r.file] ?? 0) + 1;
  return out;
};
