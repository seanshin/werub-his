import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 지표(비율·평균·점수)가 **표본 0 에서 `0` 으로 떨어지는 자리**를 센다 — I4(2026-09-16).
 *
 * 세는 모양: `<표본> ? <계산> : 0` · `<분모> > 0 ? <계산> : 0` · 빈 표본 조기반환의 `<지표>: 0`
 *   (이름이 rate/avg/score/percent/progress/compliance 계열인 것만 — 개수·id 는 0 이 정답이다)
 *
 * 🔴 **"N개가 결함"이 아니다.** `0` 이 정답인 지표도 있다(관측했는데 진짜 0). 한 건씩 봐야 알고,
 *    이 가드가 지키는 것은 **조용히 늘지 않는다** 하나다. 고치면 기준선을 줄이는 커밋을 강제한다.
 *
 * 🔴 주석·문자열·정규식 리터럴은 코드로 읽지 않는다 — 이 저장소에서 스캐너가 자기 주석을 세어
 *    "고친 자리를 여전히 위반"으로 셌던 함정이 반복됐다(v4.11.0·E4·G3).
 */
export interface MetricZeroRow {
  file: string;
  line: number;
  field: string;
  text: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** 주석·문자열·정규식 리터럴을 공백으로 지운다(줄 번호·열 위치 보존) */
export function stripForScan(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && c2 === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += q; i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { out += ' '; i++; if (i < n) { out += ' '; i++; } continue; }
        out += src[i] === '\n' ? '\n' : ' '; i++;
      }
      if (i < n) { out += q; i++; }
      continue;
    }
    if (c === '/') {
      const prev = out.trimEnd().slice(-1) || '';
      if (/[\w)\]]/.test(prev)) { out += c; i++; continue; } // 나눗셈
      out += ' '; i++;
      let inClass = false;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\') { out += '  '; i += 2; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) { out += ' '; i++; break; }
        else if (ch === '\n') { out += '\n'; i++; break; }
        out += ' '; i++;
      }
      while (i < n && /[gimsuy]/.test(src[i])) { out += ' '; i++; }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** 지표 이름(비율·평균·점수 계열) — 개수(count·total)·식별자는 제외한다 */
/**
 * 🔴 (2026-09-16 J3) 종전 정규식은 지표어가 **뒤에 오는 이름**만 봤다(`openRate`·`avgScore`) —
 *    `avgStay`·`avgLos`·`avgOp` 처럼 **앞에 오는 이름**은 `\bavg\b` 경계에 걸려 통째로 빠졌다.
 *    그래서 QI 대시보드의 '평균 체류·평균 재원일수·평균 수술시간'이 `: 0` 인 채 기준선 밖에 있었다.
 */
const METRIC_NAME = /\b([A-Za-z_]*(?:[Rr]ate|[Rr]atio|[Aa]verage|avg|Avg|[Pp]ercent|[Pp]ct|[Ss]core|[Pp]rogress|[Cc]ompliance|[Aa]dherence|[Aa]chievement|[Oo]ccupancy|[Uu]tilization)[A-Za-z_]*)\b/;
/** `<가드> ? <계산> : 0` — 표본·분모 가드 뒤에서 0 으로 떨어지는 삼항 */
const TERNARY_ZERO = /\?[^?:]*:\s*0\s*[,;)\]}]/;
const SAMPLE_GUARD = /(\.length|>\s*0|count|total|sample|\bn\b)/i;

/**
 * 🔴 (2026-09-21 H) 사각 ⓓ — **`?? 0` / `|| 0` 을 `_avg.` 에만 물었다.**
 *    L4 가 Prisma 집계만 본 탓에 `fallRiskScore: na.fallRiskAssessment?.score ?? 0`
 *    (낙상위험 **미평가**를 Morse 0점=최저위험으로 말함)이 기준선 밖에 있었다.
 *    지표 이름을 가진 **대입 대상**이면 nullish/or 폴백도 센다.
 *
 *    두 가지를 못박는다:
 *    ① `0(?![.\d])` — `?? 0.3`(기본 비율·상수)은 표본 폴백이 아니다. 경계만 쓰면(`0\b`)
 *       `0.3` 의 `0` 이 걸려 오탐이 쏟아진다(이 축 첫 판이 실제로 그랬다).
 *    ② `_avg.` 가 붙은 자리는 **아래 집계 패스가 이미 가진다** — 여기서 또 세면 한 자리가 두 행이 된다.
 */
const NULLISH_ZERO = /(\?\?|\|\|)\s*0(?![.\d\w])/g;
const OWNED_BY_AGG = /_avg\.[A-Za-z_]\w*\s*$/;
/** 대입 대상 이름 — 줄 앞쪽에서 가장 가까운 `이름 :` / `이름 =` 를 찾는다 */
const ASSIGN_TARGET = /\b([A-Za-z_]\w*)\s*[:=]\s*(?![:=])/g;

/**
 * 🔴 (2026-09-21 H) 사각 ⓔ — **스캐너가 줄 단위라 여러 줄 삼항을 통째로 못 봤다.**
 *    `targetSD !== 0\n ? … \n : 0` 처럼 prettier 가 접은 자리가 그렇다 —
 *    lab QC 의 z-score 가 이 모양이라 SD 0 에서 `PASS` 가 찍히는데도 기준선 밖이었다.
 */
const CONT_ZERO_LINE = /^\s*:\s*0\s*[,;)\]}]?\s*$/;
const LOOKBACK = 4;

export function scanMetricZeroFallbacks(modulesDir: string): MetricZeroRow[] {
  const rows: MetricZeroRow[] = [];
  for (const f of walk(modulesDir)) {
    const raw = readFileSync(f, 'utf8');
    const src = stripForScan(raw);
    const srcLines = src.split('\n');
    const rawLines = raw.split('\n');
    srcLines.forEach((ln, idx) => {
      // 🔴 (2026-09-17 L4) 종전엔 `METRIC_NAME.exec(ln)` 로 **한 줄의 첫 지표만** 봤다 —
      //    `{ avgLatencyMs: …, satisfactionRate: total ? … : 0 }` 처럼 한 줄에 지표가 둘이면
      //    뒤의 것은 통째로 안 보였다(medical-ai:941 이 실제로 그랬다). 줄 안의 지표를 모두 센다.
      const re = new RegExp(METRIC_NAME.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(ln)) !== null) {
        // 🔴 구간을 **다음 지표 이름 앞까지**로 끊는다 — 끊지 않으면 앞 지표가 뒤 지표의 `: 0` 을 주워
        //    같은 자리를 두 번 센다(L4 첫 판이 medical-ai:941 을 2 행으로 셌다).
        const rest = ln.slice(m.index + m[0].length);
        const nextAt = rest.search(METRIC_NAME);
        const after = nextAt >= 0 ? ln.slice(m.index, m.index + m[0].length + nextAt) : ln.slice(m.index);
        // 이름 뒤가 `:` 또는 `=` 로 값을 만드는 자리여야 한다
        if (!/^[A-Za-z_]*\w*\s*[:=]/.test(after)) continue;
        const zeroTernary = TERNARY_ZERO.test(after) && SAMPLE_GUARD.test(after);
        const zeroLiteral = /^[A-Za-z_]*\w*\s*:\s*0\s*[,;}]/.test(after);
        // 🔴 Prisma 집계는 **표본 0 에서 `null`** 을 돌려준다 — `_avg.x ?? 0` 은 그 null 을 0 으로 번역한다.
        //    이름 규칙(avg*/…)에 걸리지 않는 자리도 있어 종전 스캐너는 이 부류를 아예 못 봤다.
        const aggZero = /_avg\.[A-Za-z_]\w*\s*(\?\?|\|\|)\s*0\b/.test(after);
        if (!zeroTernary && !zeroLiteral && !aggZero) continue;
        rows.push({ file: relative(modulesDir, f), line: idx + 1, field: m[1], text: rawLines[idx].trim().slice(0, 120) });
      }
      // 🔴 Prisma 집계 0 폴백은 **이름과 무관하게 따로 센다** — 위 구간 끊기가 `item._avg.x ?? 0` 의
      //    `?? 0` 을 다음 지표(`_avg`) 앞에서 잘라내므로, 이름 패스만으로는 이 부류가 다시 안 보인다(L4 실측).
      const agg = /_avg\.[A-Za-z_]\w*\s*(?:\?\?|\|\|)\s*0\b/g;
      let a: RegExpExecArray | null;
      while ((a = agg.exec(ln)) !== null) {
        rows.push({ file: relative(modulesDir, f), line: idx + 1, field: '_avg', text: rawLines[idx].trim().slice(0, 120) });
      }

      // ── 사각 ⓓ: 지표 이름 대입에 걸린 `?? 0` / `|| 0`(집계 패스가 가진 `_avg.` 는 제외)
      const nz = new RegExp(NULLISH_ZERO.source, 'g');
      let z: RegExpExecArray | null;
      while ((z = nz.exec(ln)) !== null) {
        const before = ln.slice(0, z.index);
        if (OWNED_BY_AGG.test(before)) continue; // 위 집계 패스 소관 — 두 번 세지 않는다
        const at = new RegExp(ASSIGN_TARGET.source, 'g');
        let t: RegExpExecArray | null;
        let target: string | null = null;
        while ((t = at.exec(before)) !== null) target = t[1]; // 가장 가까운 대입 대상
        if (!target || !METRIC_NAME.test(target)) continue;
        rows.push({ file: relative(modulesDir, f), line: idx + 1, field: target, text: rawLines[idx].trim().slice(0, 120) });
      }

      // ── 사각 ⓔ: 여러 줄 삼항의 `: 0` 줄 — 위 LOOKBACK 줄에서 지표 대입 + `?` 를 찾는다
      if (CONT_ZERO_LINE.test(ln)) {
        for (let back = 1; back <= LOOKBACK && idx - back >= 0; back++) {
          const head = srcLines[idx - back];
          const between = srcLines.slice(idx - back, idx).join(' ');
          if (!between.includes('?')) continue;
          const at = new RegExp(ASSIGN_TARGET.source, 'g');
          let t: RegExpExecArray | null;
          let target: string | null = null;
          while ((t = at.exec(head)) !== null) target = t[1];
          if (!target || !METRIC_NAME.test(target)) continue;
          rows.push({ file: relative(modulesDir, f), line: idx - back + 1, field: target, text: rawLines[idx - back].trim().slice(0, 120) });
          break;
        }
      }
    });
  }
  return rows;
}

export function countByFile(rows: MetricZeroRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.file] = (out[r.file] ?? 0) + 1;
  return out;
}
