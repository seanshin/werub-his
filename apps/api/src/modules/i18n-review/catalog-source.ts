import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { AREA_CATALOGS, getLocalePack, packContextGaps, type MessageCatalog } from '@hospital-run/shared';

/**
 * 코드 초안값 읽기 — 🔴 **정본은 코드다.** 카탈로그를 DB 에 복제하지 않고 여기서 매번 읽는다
 *    (정본이 둘이 되면 다음 배포가 조용히 되돌린다 · `i18n-human-review.plan.md` §1).
 *
 * 🔴 영역 목록은 등록부 정본 `AREA_CATALOGS` 에서 **파생**한다 — 수기 배열이면 새 카탈로그가
 *    통째로 시야 밖이 된다(관제 화면이 29종 중 3종만 세고 있던 선례 · ui-locale-i18n §9.3).
 */

interface AreaEntry {
  area: string;
  c: MessageCatalog;
  v: ReadonlySet<string>;
}

const AREAS = AREA_CATALOGS as unknown as AreaEntry[];

export interface CodeEntry {
  key: string;
  area: string;
  /** 이 언어의 코드 값. null = 코드에 번역이 없다(빈 문자열과 다른 사실) */
  value: string | null;
  /** 코드 카탈로그가 사람 검수 완료로 표기한 키인가(현재 전 영역이 빈 집합이다) */
  codeVerified: boolean;
}

/**
 * 이 언어의 검수 대상 전집 — **키 → (영역·코드값)**.
 *
 * 전집의 정의: 카탈로그 영역이 담은 키의 합집합(`AREA_CATALOGS` 의 en/ja/ar 합집합)
 * ∪ 그 언어 팩이 실제로 가진 키. 팩만 가진 언어(zh·ru·vi·kk·mn·th)도 자기 키를 검수할 수 있어야 한다.
 *
 * 🔴 같은 키가 여러 영역에 있으면 **먼저 등록된 영역이 이긴다** — 조회 우선순위와 같게 둔다
 *    (여기서 순서를 뒤집으면 화면이 보여주는 "코드 값"이 실제 화면에 나가는 값과 달라진다).
 */
export function codeEntriesFor(locale: string): Map<string, CodeEntry> {
  const out = new Map<string, CodeEntry>();
  for (const { area, c, v } of AREAS) {
    // 전집은 언어와 무관하게 "이 영역이 대상이라 선언한 키"다 — 그래야 미번역도 목록에 남는다
    const declared = new Set<string>();
    for (const loc of Object.keys(c)) {
      for (const k of Object.keys((c as Record<string, Record<string, string>>)[loc] ?? {})) declared.add(k);
    }
    const table = (c as Record<string, Record<string, string> | undefined>)[locale] ?? {};
    for (const k of declared) {
      if (out.has(k)) continue; // 먼저 등록된 영역이 이긴다
      const raw = table[k];
      out.set(k, { key: k, area, value: raw != null && raw !== '' ? raw : null, codeVerified: v.has(k) });
    }
  }
  // 팩에만 있는 키(확장 팩·부분 보정)도 검수 대상이다
  const pack = getLocalePack(locale);
  if (pack) {
    for (const [k, val] of Object.entries(pack.messages)) {
      const prev = out.get(k);
      if (!prev) {
        out.set(k, { key: k, area: 'pack', value: val || null, codeVerified: pack.verified?.has(k) ?? false });
      } else if (prev.value == null && val) {
        // 영역 카탈로그에는 없고 팩 파일이 채운 값 — 그것이 화면에 나가는 값이다
        out.set(k, { ...prev, value: val, codeVerified: pack.verified?.has(k) ?? prev.codeVerified });
      }
    }
  }
  return out;
}

/** 등록부에서 파생한 영역 코드 목록(+ 팩 전용 키 버킷) */
export function areaCodes(): string[] {
  return [...AREAS.map((a) => a.area), 'pack'];
}

/**
 * 문맥 결손 키 — 무문맥 원문은 번역돼 있는데 문맥 변형(`원문@문맥`)이 없는 자리.
 * 🔴 이 자리는 미번역이 아니라 **뜻이 틀린 번역이 나가는 자리**다(shared `packContextGaps` 주석).
 * 팩이 없는 언어는 `null` — 0 으로 지어내지 않는다.
 */
export function contextGapSet(locale: string): Set<string> | null {
  const gaps = packContextGaps(locale);
  return gaps ? new Set(gaps) : null;
}

/* ── "쓰이는 곳" — 키를 쓰는 화면 목록 ────────────────────────────────────────
 * 🔴 문맥 없이 번역하면 틀린다. 그래서 검수 화면은 그 키가 **어느 화면에 뜨는지**를 보여준다.
 * 🔴 소스 트리가 없으면(운영에서 dist 만 배포된 경우) **빈 배열을 주지 않는다** —
 *    "쓰이는 곳 없음"과 "셀 수 없음"은 다른 사실이다. `null` + 사유로 답한다.
 */

export type UsageIndex = { map: Map<string, string[]>; scannedFiles: number } | null;

let USAGE_CACHE: { at: number; index: UsageIndex; reason: string | null } | null = null;
const USAGE_TTL_MS = 5 * 60 * 1000;

function webSrcRoot(): string | null {
  // apps/api 에서 실행되든(dev·test) 저장소 루트에서 실행되든 찾는다
  const candidates = [
    resolve(process.cwd(), '../web/src/app'),
    resolve(process.cwd(), 'apps/web/src/app'),
    resolve(process.cwd(), '../../apps/web/src/app'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkTsx(p, out);
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** `<T k="원문" …>` · `tAttr('원문')` · `t('원문'` 에서 키를 뽑는다(동적 키 `k={...}` 는 셀 수 없다) */
const KEY_PATTERNS: RegExp[] = [
  /<T\s+k=(?:"([^"]+)"|'([^']+)')/g,
  /\btAttr\(\s*(?:"([^"]+)"|'([^']+)')/g,
];

function buildUsageIndex(): { index: UsageIndex; reason: string | null } {
  const root = webSrcRoot();
  if (!root) {
    return { index: null, reason: 'WEB_SOURCE_NOT_AVAILABLE — 화면 소스 트리를 찾지 못했습니다(배포본에는 없을 수 있습니다)' };
  }
  const map = new Map<string, string[]>();
  let files: string[];
  try {
    files = walkTsx(root);
  } catch (e) {
    return { index: null, reason: `WEB_SOURCE_SCAN_FAILED — ${(e as Error).message}` };
  }
  for (const f of files) {
    let src: string;
    try {
      src = readFileSync(f, 'utf8');
    } catch {
      continue; // 한 파일을 못 읽은 것을 전체 실패로 만들지 않는다(그 파일만 빠진다)
    }
    const rel = '/' + relative(root, f).replace(/\/page\.tsx$/, '').replace(/\.tsx$/, '');
    for (const re of KEY_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) != null) {
        const key = m[1] ?? m[2];
        if (!key) continue;
        const arr = map.get(key);
        if (!arr) map.set(key, [rel]);
        else if (!arr.includes(rel)) arr.push(rel);
      }
    }
  }
  return { index: { map, scannedFiles: files.length }, reason: null };
}

export function usageIndex(): { index: UsageIndex; reason: string | null } {
  const now = Date.now();
  if (USAGE_CACHE && now - USAGE_CACHE.at < USAGE_TTL_MS) {
    return { index: USAGE_CACHE.index, reason: USAGE_CACHE.reason };
  }
  const built = buildUsageIndex();
  USAGE_CACHE = { at: now, index: built.index, reason: built.reason };
  return built;
}
