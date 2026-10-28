#!/usr/bin/env node
/**
 * 경보 등록부(`alert-registry.ts`)의 `emitters`(발화 지점 file:line)를 **기계로 도출**한다.
 *
 * 🔴 왜 있나 — 2026-08-20 LoopSpec 라운드가 "emitter 줄번호가 드리프트했다. 수기로 2건만 확인했고
 *    **오라클이 없어** 나머지는 세지 못했다"고 남겼다. 2026-08-27 재실측: 66개 항목 중 **35개가 불일치**
 *    (리스너 항목들이 일제히 +52줄 밀려 있었다 — 파일이 자랐는데 등록부가 안 따라갔다).
 *    `emitters` 는 관리 콘솔(`/admin/safety-gates` 경보 패널)에 **사람에게 표시**되므로,
 *    틀린 줄번호는 "여기서 발행된다"는 거짓말이다.
 *
 * 도출 규칙(관례에 의존하지 않는다 — 실제로 네 관례가 섞여 있었다):
 *   ① 그 경보의 `code` 를 **알림 type 자리**에 쓴 줄을 찾는다(`type: 'X'` · 삼항 · `notifyUser(u,'X',…)`).
 *      🔴 대문자 리터럴을 전부 주우면 `refType`·enum·소비 코드까지 발행으로 센다(첫 도출이 그랬다 — `LAB_RESULT` 가 7곳).
 *   ② 그 줄에서 위로 최대 WINDOW 줄 안의 **가장 가까운 발행 호출**(emit/notify/create 계열)을 앵커로 삼는다
 *   ③ 앵커를 못 찾으면 발행이 아니라 **소비**(`if (n.type === 'X')` 등)로 보고 버린다
 *
 * 사용:
 *   node scripts/alert-emitters.mjs            # 현황 표 (기본 = --check 와 같은 판정, 종료코드만 다름)
 *   node scripts/alert-emitters.mjs --check    # 불일치가 있으면 종료코드 1 (가드/CI 용)
 *   node scripts/alert-emitters.mjs --write    # 등록부의 emitters 를 도출값으로 교체
 *
 * PATIENT_PUSH_* 는 **이벤트 발행 관례**(`emitAsync('patient.called')`)라 code 문자열이 코드에 없다.
 * 이들은 `test/notification/patient-push-wiring.spec.ts` 가 따로 지키므로 이 도구의 범위 밖이다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'apps/api/src/modules');
const REGISTRY = path.join(SRC, 'notification/alert-registry.ts');

/** 발행 호출로 인정하는 어휘 — 실측으로 모은 것이다(추측으로 넓히지 않는다) */
const CALL = /(\.emit\(|emitAsync\(|notifyAttendingDoctor\(|notifyAll\(|notifyUser\(|\.notify\(|\.create\(|createMany\()/;
/** code 문자열에서 위로 몇 줄까지 발행 호출을 찾는가 */
const WINDOW = 15;
/** 이벤트 발행 관례라 code 문자열이 코드에 없다 — 별도 가드 소관 */
const OUT_OF_SCOPE = (code) => code.startsWith('PATIENT_PUSH_');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(f);
  }
  return out;
}

export function readRegistry() {
  const src = fs.readFileSync(REGISTRY, 'utf8');
  const entries = [];
  for (const m of src.matchAll(/code:\s*'([A-Z0-9_]+)'[\s\S]{0,2000}?emitters:\s*\[([^\]]*)\]/g)) {
    entries.push({ code: m[1], emitters: [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]) });
  }
  return entries;
}

/**
 * 코드별 실제 발행 지점을 도출한다 → Map<code, string[]>(정렬됨)
 *
 * 🔴 줄 단위로 보면 `type:` 과 리터럴이 **여러 줄에 걸친 호출**(`notifyUser(\n  id,\n  'HR_DUTY_CLASH',`)을
 *    놓친다(첫 도출이 6건을 "발행 없음"으로 오판했다). 오프셋 기준으로 앞 문맥을 본다.
 */
export function deriveEmitters(codes) {
  const found = new Map();
  const wanted = new Set(codes.filter((c) => !OUT_OF_SCOPE(c)));
  for (const p of walk(SRC)) {
    if (p === REGISTRY) continue;
    const rel = path.relative(SRC, p);
    const text = fs.readFileSync(p, 'utf8');
    const lines = text.split('\n');
    // 오프셋 → 줄번호
    const lineOf = (off) => text.slice(0, off).split('\n').length;
    // 상수 경유 발행 — `static readonly NOTIFICATION_TYPE = 'X'` 를 `type: Cls.NOTIFICATION_TYPE` 로 쓰는 관례.
    // 리터럴만 보면 이 발행을 통째로 놓친다(SURGERY_SAFETY_DIGEST 가 그랬다).
    for (const c of text.matchAll(/(?:static\s+readonly\s+|const\s+)([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*'([A-Z][A-Z0-9_]{2,})'/g)) {
      const [, ident, code] = c;
      if (!wanted.has(code)) continue;
      for (const u of text.matchAll(new RegExp(`type:\\s*[\\w.]*\\b${ident}\\b`, 'g'))) {
        const i = lineOf(u.index) - 1;
        for (let j = i; j >= Math.max(0, i - WINDOW); j--) {
          if (CALL.test(lines[j])) {
            if (!found.has(code)) found.set(code, new Set());
            found.get(code).add(`${rel}:${j + 1}`);
            break;
          }
        }
      }
    }
    for (const m of text.matchAll(/'([A-Z][A-Z0-9_]{2,})'/g)) {
      const code = m[1];
      if (!wanted.has(code)) continue;
      // 앞 문맥에 알림 type 자리 표식이 있어야 발행이다 — 없으면 소비(`n.type === 'X'`)·enum·refType 이다.
      const before = text.slice(Math.max(0, m.index - 160), m.index);
      // type 자리 · positional 발행 호출(`this.notify(uid, 'CODE', …)`) 둘 다 인정한다.
      if (!/type:\s*[^;]{0,120}$|\b(notify|notifyUser|notifyAll)\([^)]{0,120}$/.test(before)) continue;
      const i = lineOf(m.index) - 1;
      for (let j = i; j >= Math.max(0, i - WINDOW); j--) {
        if (CALL.test(lines[j])) {
          if (!found.has(code)) found.set(code, new Set());
          found.get(code).add(`${rel}:${j + 1}`);
          break;
        }
      }
    }
  }
  return new Map([...found].map(([k, v]) => [k, [...v].sort()]));
}

export function compare() {
  const reg = readRegistry();
  const derived = deriveEmitters(reg.map((r) => r.code));
  const rows = [];
  for (const { code, emitters } of reg) {
    if (OUT_OF_SCOPE(code)) continue;
    const real = derived.get(code) ?? [];
    const cur = [...emitters].sort();
    const same = real.length === cur.length && real.every((v, i) => v === cur[i]);
    rows.push({ code, cur, real, same, orphan: real.length === 0 });
  }
  return rows;
}

function main() {
  const mode = process.argv[2] ?? '';
  const rows = compare();
  const drift = rows.filter((r) => !r.same && !r.orphan);
  const orphan = rows.filter((r) => r.orphan);

  if (mode === '--write') {
    let src = fs.readFileSync(REGISTRY, 'utf8');
    let n = 0;
    for (const r of rows) {
      if (r.same || r.orphan) continue;
      const re = new RegExp(`(code:\\s*'${r.code}'[\\s\\S]{0,2000}?emitters:\\s*)\\[[^\\]]*\\]`);
      if (!re.test(src)) continue;
      src = src.replace(re, `$1[${r.real.map((x) => `'${x}'`).join(', ')}]`);
      n++;
    }
    fs.writeFileSync(REGISTRY, src);
    console.log(`emitters 갱신: ${n}건`);
    if (orphan.length) console.log(`🔴 발행 호출을 못 찾아 손대지 않은 항목 ${orphan.length}건: ${orphan.map((o) => o.code).join(', ')}`);
    return;
  }

  console.log(`경보 등록부 emitters — 대상 ${rows.length}건(PATIENT_PUSH 제외)`);
  console.log(`  일치 ${rows.filter((r) => r.same).length} · 불일치 ${drift.length} · 발행 호출 없음 ${orphan.length}`);
  for (const r of drift) console.log(`  🔴 ${r.code}\n       등록부: ${r.cur.join(', ')}\n       실제  : ${r.real.join(', ')}`);
  for (const r of orphan) console.log(`  ⚠️  ${r.code} — 코드에서 발행 호출을 못 찾았다(등록부: ${r.cur.join(', ')})`);
  if (mode === '--check' && (drift.length || orphan.length)) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
