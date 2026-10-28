import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// 계측 정본은 스캐너 스크립트다 — 세는 규칙을 두 곳에 적으면 갈라진다.
import { scanScreens, stripComments, catalogKeysOf } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 운영·행정 화면 1 의 UI 언어 배선 가드 (2026-09-11 §12-B · 카탈로그 `admin9`).
 *    검진권 대시보드 · 직원 자격·교육(SQE) · 상시 감시 · 환자여정 프로토콜.
 *
 * 이 가드가 못박는 것은 **반증 가능한 것만**이다:
 *   (a) 화면별 한글 잔여 조각 수 — **정확 일치**(늘면 실패·줄면 기준선을 낮춘다. 여유 0).
 *   (b) 화면별 `<T>`/`tAttr` 배선 수 — 하한(0 이 되면 이 가드는 아무것도 보증하지 않는다).
 *   (c) 화면이 `<T k>`/`<Tf k>`/`tAttr`/`tfAttr` 로 부르는 **한국어 키가 어느 카탈로그엔가 있다**.
 *   (c2) 🔴 **동적 라벨** — 맵·삼항으로 `<T k={…}>` 에 들어가는 원문(스캐너가 잔여 조각으로 세는 것)도
 *        카탈로그에 있거나, 아래 `RESIDUAL_ALLOWED` 에 **사유와 함께** 적혀 있다. (c) 는 리터럴만 보므로
 *        `SEV_MARK.label` 같은 자리가 미등록이어도 통과한다 — 그 구멍을 이것이 막는다.
 *   (d) 🔴 **죽은 키 0** — `admin9` 의 키를 **먼저 등록된** 카탈로그가 이미 갖고 있으면 사본은 영원히 안 읽힌다.
 *   (e) 🔴 **고아 키 0** — 카탈로그에만 있고 문구 출처(소유 화면 + 그 화면이 그리는 서버·shared 원문)에 없는 키.
 *   (f) 세 언어 키 집합 동일 + 빈 값 0.
 *   (g) 🔴 **자리표시자 보존** — 번역문이 키와 같은 `{이름}` 집합을 갖는다. 빠뜨리면 값이 사라지고
 *        (`Showing  of 12`), 지어내면 `{이름}` 이 화면에 그대로 뜬다. `{AI표기}`(AI기본법 표기)도 여기서 지킨다.
 *   (h) 보간 키를 `<T k>`/`tAttr` 로 부르지 않는다 — 부르면 `{건수}` 가 글자 그대로 화면에 나간다.
 *   (i) 🔴 **JSX 식 사이 생한글 0** — `{total}건 중 {shown}건 표시` 같은 텍스트는 스캐너의 `>…<` 규칙에 걸리지
 *        않는다(`}` 와 `{` 사이라서). 그래서 (a) 는 이 자리가 조각으로 **되돌아가도** 통과한다 — 이것이 막는다.
 *
 * 🔴 **정본에서 파생한다** — 카탈로그 목록·등록 순서는 `registry.ts` 를 읽어서 만든다(수기 배열 금지).
 * (2026-09-11 §12-H) 스캐너가 `<Tf>`/`tfAttr` 키를 벗기게 됐다 — 예고대로 (a) 기준선이 실패로 알려줬고 **낮췄다**
 *    (sqe 24→16 · sentinel 53→37 · protocols 45→38). 자리표시자 키 원문을 잔여로 세던 계측 아티팩트였다.
 */
const ROOT = resolve(process.cwd(), '../..');
const APP = join(ROOT, 'apps/web/src/app');
const MSG = join(ROOT, 'packages/shared/src/i18n/messages');
const read = (p: string) => readFileSync(p, 'utf8');

/** 이 갈래가 소유한 화면 */
const OWNED = [
  '(main)/admin/voucher/dashboard/page.tsx',
  '(main)/admin/sqe/page.tsx',
  '(main)/admin/sentinel/page.tsx',
  '(main)/admin/protocols/page.tsx',
] as const;

/**
 * 소유 화면이 **그리지만 원문은 다른 곳에 있는** 문구의 출처 — 고아 판정(e)에서만 쓴다.
 * · 프로토콜 서버 검증 문구(`validateSteps`) — 목록 화면이 `<IssueText>` 로 그대로 그린다.
 * · 감시 판정·소관 설명(shared 정본) — 판정 폼·소관 칩 툴팁이 동적으로 그린다.
 */
const MESSAGE_ORIGINS = [
  'apps/api/src/modules/protocol/protocol.service.ts',
  'packages/shared/src/sentinel-judgment.ts',
  'packages/shared/src/sentinel-audience.ts',
] as const;

/**
 * 2026-09-11 실측 (재현: `node scripts/i18n-unwired-scan.mjs --json`).
 * `ko` = 남은 한글 조각(유니크) — **표시 문구의 상한**이다. 동적 라벨 맵의 원문(배선됨·등재됨)·
 *   `<Tf>` 자리표시자 키·저장값(`'새 단계'`)·`<Unit>` 단위어가 여기 남아 있다(사유는 `admin9.ts` 머리 주석).
 * `t`  = `<T` + `tAttr(` 출현 수(스캐너 규칙 — `<Tf`·`tfAttr(` 는 세지 않는다).
 */
  // 🔴 2026-09-12 계측 모델 교정 — 스스로 번역하는 부품(EmptyState·Ratio)의 문자열 prop 은 잔여가 아니라 배선이다(스캐너 규칙). 그만큼 ko 가 내려갔다.
const BASELINE: Record<string, { ko: number; t: number }> = {
  '(main)/admin/voucher/dashboard/page.tsx': { ko: 6, t: 21 },
  '(main)/admin/sqe/page.tsx': { ko: 16, t: 88 },
  '(main)/admin/sentinel/page.tsx': { ko: 35, t: 127 },
  '(main)/admin/protocols/page.tsx': { ko: 38, t: 107 },
};

/**
 * (c2) 카탈로그에 없어도 되는 잔여 조각 — **사유가 있는 것만**. 여기 없는 미등록 조각은 실패다.
 */
const RESIDUAL_ALLOWED: Record<string, string> = {
  '새 단계': '저장값 — 새 단계의 기본 title 로 서버에 저장된다(번역하면 저장 데이터가 로케일마다 갈라진다)',
  '전이 대상 단계 없음: ${t.toKey}': '클라 검증 미러의 문구 생성부 — 표시는 issueKey() 가 자리표시자 키로 바꾼다',
  '미지원 게이트 술어: ${s.gateRule}': '클라 검증 미러의 문구 생성부 — 표시는 issueKey() 가 자리표시자 키로 바꾼다',
  '미지원 조건 필드: ${m[1]}': '클라 검증 미러의 문구 생성부 — 표시는 issueKey() 가 자리표시자 키로 바꾼다',
  '조건식 형식 오류: "${c}"': '클라 검증 미러의 문구 생성부 — 표시는 issueKey() 가 자리표시자 키로 바꾼다',
  '{조건식}': '스캐너 조각 — 키 `조건식 형식 오류: "{조건식}"` 안의 큰따옴표를 따로 읽은 것',
  '${RATIO_UNAVAILABLE} — 표본 0': 'shared 정본 문구 조합 — NullReason 이 구절(산출 불가 · 표본 0)마다 <T> 로 번역한다(둘 다 등재)',
};

/* ── 카탈로그 파싱 (정본 = registry.ts 의 등록 순서) ────────────────────────── */

function registeredOrder(): string[] {
  const reg = read(join(MSG, 'registry.ts'));
  const files = [...reg.matchAll(/from '\.\/([a-z0-9_-]+)'/gi)].map((m) => `${m[1]}.ts`);
  // 🔴 common 은 t.ts 가 직접 등록한다(registry 에 registerCatalog 호출이 없다) — 맨 앞이다
  return [...new Set(['common.ts', ...files])];
}

/** 카탈로그 파일의 키 집합 — 두 가지 표기(`'키': [...]` / `['키', ...]`)를 모두 읽는다 */
function keysOf(file: string): Set<string> {
  // 파서 정본은 스캐너(`catalogKeysOf`) — 가드마다 두면 표기 하나를 빠뜨려 갈라진다(§12-H)
  return catalogKeysOf(read(join(MSG, file)));
}

/** admin9 의 [en, ja, ar] 튜플 — 한 줄·여러 줄 표기를 모두 읽는다 */
function admin9Rows(): Array<{ key: string; v: string[] }> {
  const src = read(join(MSG, 'admin9.ts'));
  const body = src.slice(src.indexOf('const TRANSLATIONS'), src.indexOf('const en: Record'));
  return [...body.matchAll(/^\s*'((?:\\.|[^'\\])+)':\s*\[([\s\S]*?)\],$/gm)].map((m) => ({
    key: m[1].replace(/\\'/g, "'"),
    v: [...m[2].matchAll(/'((?:\\.|[^'\\])*)'/g)].map((x) => x[1].replace(/\\'/g, "'")),
  }));
}

/** 화면 소스(주석 제거)에서 i18n 호출에 넘긴 리터럴 키 */
function literalKeys(src: string): { t: Set<string>; tf: Set<string> } {
  const s = stripComments(src);
  const t = new Set<string>();
  const tf = new Set<string>();
  for (const m of s.matchAll(/<T\s+k="((?:\\.|[^"\\])+)"/g)) t.add(m[1]);
  for (const m of s.matchAll(/<T\s+k=\{'((?:\\.|[^'\\])+)'\}/g)) t.add(m[1].replace(/\\'/g, "'"));
  for (const m of s.matchAll(/\btAttrG?\('((?:\\.|[^'\\])+)'\)/g)) t.add(m[1].replace(/\\'/g, "'"));
  for (const m of s.matchAll(/<Tf\s+k="((?:\\.|[^"\\])+)"/g)) tf.add(m[1]);
  for (const m of s.matchAll(/<Tf\s+k=\{'((?:\\.|[^'\\])+)'\}/g)) tf.add(m[1].replace(/\\'/g, "'"));
  for (const m of s.matchAll(/\btfAttrG?\('((?:\\.|[^'\\])+)'/g)) tf.add(m[1].replace(/\\'/g, "'"));
  // 🔴 (2026-09-12) 스스로 번역하는 부품(EmptyState·Ratio)의 문자열 prop 은 키다 — 285곳 껍데기 회수 후 이 추출기가
  //    그 키를 못 봐 대조군(used.size>250)이 정확히 250 에 걸렸다. 임계를 낮추지 않고 추출기를 넓힌다(`"…"`·`{'…'}`·`{"…"}`).
  //    🔴 태그 안으로 한정한다 — 파일 전체의 `title=` 을 보면 다른 부품의 보간 문장(`hint="…{표본}건…"`)까지 키로 읽는다(첫 판 실측).
  for (const tag of s.matchAll(/<(?:EmptyState|Ratio)\b[\s\S]*?(?:\/>|>)/g)) {
    for (const m of tag[0].matchAll(/\b(?:title|hint|unavailableHint)=(?:"((?:\\.|[^"\\])+)"|\{\s*'((?:\\.|[^'\\])+)'\s*\}|\{\s*"((?:\\.|[^"\\])+)"\s*\})/g)) t.add((m[1] ?? m[2] ?? m[3]).replace(/\\'/g, "'"));
  }
  return { t, tf };
}

const HAN = /[가-힣]/;
const PARAM = /\{([^{}\s]+)\}/g;
const paramsOf = (s: string) => [...s.matchAll(PARAM)].map((m) => m[1]).sort();

const ORDER = registeredOrder();
const ADMIN9_AT = ORDER.indexOf('admin9.ts');
const CAT = new Map(ORDER.map((f) => [f, keysOf(f)]));
const ALL_KEYS = new Set<string>();
for (const f of ORDER) for (const k of CAT.get(f)!) ALL_KEYS.add(k);
const ROWS = admin9Rows();
const ORIGIN_SRC = [
  ...OWNED.map((f) => read(join(APP, f))),
  ...MESSAGE_ORIGINS.map((f) => read(join(ROOT, f))),
].join('\n');
const scan = () => scanScreens(APP, APP) as Array<{ file: string; ko: number; t: number; frags: string[] }>;

/**
 * JSX 식 사이(`}…{`·`>…{`·`}…<`)에 남은 한글 텍스트 — 스캐너가 세지 않는 자리.
 * 문자열 리터럴은 비우고(스캐너가 따로 센다), `<Unit>건</Unit>` 은 Unit 부품이 `@단위` 로 번역하므로 뺀다.
 */
function jsxGapHangul(src: string): string[] {
  const s = stripComments(src)
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/<Unit>[^<>{}]*<\/Unit>/g, '<Unit></Unit>');
  return [...s.matchAll(/[}>]([^<>{}]*[가-힣][^<>{}]*)[{<]/g)].map((m) => m[1].trim());
}

describe('🔴 운영·행정 화면 1 i18n 배선 (admin9)', () => {
  it('대조군 — 스캐너·파서가 실제로 대상을 읽는다(0 이 되면 통과가 무의미하다)', () => {
    const rows = scan();
    expect(rows.length).toBeGreaterThan(500);
    for (const f of OWNED) expect(rows.find((r) => r.file === f), `스캔 대상에 없다: ${f}`).toBeTruthy();
    expect(ADMIN9_AT, 'registry 에서 admin9 를 찾지 못했다').toBeGreaterThan(0);
    expect(ORDER.length, 'registry 파싱이 깨졌다').toBeGreaterThan(15);
    expect(ROWS.length, 'admin9 표 파싱이 깨졌다').toBeGreaterThan(90);
    expect(ROWS.length, '표 파싱 수가 파일의 키 수와 다르다(여러 줄 표기를 놓쳤다)').toBe(CAT.get('admin9.ts')!.size);
    expect(ALL_KEYS.size, '카탈로그 키 수집이 깨졌다').toBeGreaterThan(3000);
  });

  it('(a) 화면별 한글 잔여가 기준선과 **정확히** 일치한다(여유 0 — 줄면 기준선을 낮춘다)', () => {
    const rows = scan();
    const actual = Object.fromEntries(OWNED.map((f) => [f, rows.find((r) => r.file === f)!.ko]));
    const expected = Object.fromEntries(OWNED.map((f) => [f, BASELINE[f].ko]));
    expect(actual).toEqual(expected);
  });

  it('(b) 화면마다 <T>/tAttr 배선이 기준선 이상이다(0 이면 배선이 통째로 사라진 것)', () => {
    const rows = scan();
    for (const f of OWNED) {
      const t = rows.find((r) => r.file === f)!.t;
      expect(t, `${f} 배선이 줄었다`).toBeGreaterThanOrEqual(BASELINE[f].t);
    }
  });

  it('(c) 화면이 부르는 한국어 키가 카탈로그에 있다 — 없으면 화면에 EN× 거짓 티가 뜬다', () => {
    const used = new Set<string>();
    let tfCount = 0;
    for (const f of OWNED) {
      const { t, tf } = literalKeys(read(join(APP, f)));
      for (const k of t) used.add(k);
      for (const k of tf) { used.add(k); tfCount++; }
    }
    expect(used.size).toBeGreaterThan(250); // 추출이 깨지면 조용히 0건 통과한다
    expect(tfCount, '자리표시자 키 추출이 깨졌다').toBeGreaterThan(20); // 2026-09-11 실측 30
    const missing = [...used].filter((k) => HAN.test(k) && !ALL_KEYS.has(k)).sort();
    expect(missing, `미등록 키(원문+티로 나간다):\n${missing.join('\n')}`).toEqual([]);
  });

  it('🔴 (c2) 동적 라벨·잔여 조각은 등재됐거나 사유가 적힌 제외다 — 맵 값이 조용히 미등록으로 남지 않는다', () => {
    const rows = scan();
    const bad: string[] = [];
    for (const f of OWNED) {
      for (const frag of rows.find((r) => r.file === f)!.frags) {
        if (!HAN.test(frag) || ALL_KEYS.has(frag) || frag in RESIDUAL_ALLOWED) continue;
        bad.push(`${f}: ${frag}`);
      }
    }
    expect(bad, `카탈로그에도 제외 목록에도 없는 한글 조각:\n${bad.join('\n')}`).toEqual([]);
    // 제외 목록이 낡으면 신규 위반을 흡수한다 — 실제로 남아 있는 조각만 제외로 둔다
    const allFrags = new Set(rows.filter((r) => (OWNED as readonly string[]).includes(r.file)).flatMap((r) => r.frags));
    const stale = Object.keys(RESIDUAL_ALLOWED).filter((k) => !allFrags.has(k));
    expect(stale, `더 이상 화면에 없는 제외 항목(목록에서 지운다):\n${stale.join('\n')}`).toEqual([]);
  });

  it('🔴 (d) 죽은 키 0 — 앞서 등록된 카탈로그가 이미 가진 원문을 admin9 가 다시 정의하지 않는다', () => {
    const earlier = ORDER.slice(0, ADMIN9_AT);
    const dead = [...CAT.get('admin9.ts')!]
      .filter((k) => earlier.some((f) => CAT.get(f)!.has(k)))
      .map((k) => `${k} ← ${earlier.filter((f) => CAT.get(f)!.has(k)).join(',')}`)
      .sort();
    expect(dead, `죽은 키(앞 카탈로그가 이긴다 — 여기서 지운다):\n${dead.join('\n')}`).toEqual([]);
  });

  it('🔴 (e) 고아 키 0 — 카탈로그에만 있고 문구 출처에 원문이 없는 키', () => {
    const orphan = ROWS.map((r) => r.key)
      .filter((k) => !ORIGIN_SRC.includes(k.split('@')[0]))
      .sort();
    expect(orphan, `문구 출처(소유 화면·서버·shared 정본)에 원문이 없는 키:\n${orphan.join('\n')}`).toEqual([]);
  });

  it('(f) 세 언어 키 집합이 같고 빈 값이 없다 (한 언어만 조용히 비는 회귀 차단)', () => {
    const bad = ROWS.filter((r) => r.v.length !== 3 || r.v.some((x) => !x.trim())).map((r) => r.key);
    expect(bad, `en/ja/ar 중 빠지거나 빈 값:\n${bad.join('\n')}`).toEqual([]);
  });

  it('🔴 (g) 번역문이 키와 같은 자리표시자를 갖는다 — 빠뜨리면 값이 사라지고, 지어내면 {이름}이 화면에 뜬다', () => {
    const withParams = ROWS.filter((r) => paramsOf(r.key).length > 0);
    expect(withParams.length, '자리표시자 키 파싱이 깨졌다').toBeGreaterThan(30);
    const bad: string[] = [];
    for (const r of ROWS) {
      const want = JSON.stringify(paramsOf(r.key.split('@')[0]));
      r.v.forEach((x, i) => {
        if (JSON.stringify(paramsOf(x)) !== want) bad.push(`${r.key} [${['en', 'ja', 'ar'][i]}] ${x}`);
      });
    }
    expect(bad, `자리표시자 불일치:\n${bad.join('\n')}`).toEqual([]);
  });

  it('(h) 보간 키를 <T k>/tAttr 로 부르지 않는다 — `{건수}` 가 글자 그대로 나간다', () => {
    const bad: string[] = [];
    for (const f of OWNED) {
      const { t } = literalKeys(read(join(APP, f)));
      for (const k of t) if (paramsOf(k).length) bad.push(`${f}: ${k}`);
    }
    expect(bad).toEqual([]);
  });

  it('🔴 (i) JSX 식 사이에 생한글이 없다 — 숫자 사이 조각은 스캐너가 못 센다', () => {
    const bad: string[] = [];
    for (const f of OWNED) for (const h of jsxGapHangul(read(join(APP, f)))) bad.push(`${f}: ${h}`);
    expect(bad, `<T>/<Tf> 를 지나지 않는 JSX 텍스트:\n${bad.join('\n')}`).toEqual([]);
  });

  it('(i) 대조군 — 탐지기가 실제로 조각을 잡는다(아무것도 못 잡는 탐지기는 통과가 무의미하다)', () => {
    expect(jsxGapHangul('<p>{total}건 중 {shown}건 표시</p>')).toEqual(['건 중', '건 표시']);
    expect(jsxGapHangul('<p>{n}<Unit>건</Unit> <T k="초과" /></p>'), 'Unit 단위어는 부품이 번역한다').toEqual([]);
    expect(jsxGapHangul("<p>{x ? '관측 불가' : n}</p>"), '문자열은 스캐너 축이다').toEqual([]);
  });

  it('전량 AI_DRAFT — 사람 검수(VERIFIED) 를 코드가 임의로 선언하지 않는다', () => {
    const src = read(join(MSG, 'admin9.ts'));
    expect(src).toMatch(/ADMIN9_VERIFIED: ReadonlySet<string> = new Set\(\)/);
  });

  it('🔴 카탈로그 헤더가 "무엇을 왜 뺐는지"를 적었다 (제외 주장은 검증 가능해야 한다)', () => {
    const head = read(join(MSG, 'admin9.ts'));
    const block = head.slice(0, head.indexOf('*/') + 2);
    expect(block).toMatch(/의도적\s*미등재/);
    expect(block, '중복 회피 실측을 적지 않았다').toMatch(/중복이라 등재하지 않았다/);
    expect(block, '저장값 제외 사유를 적지 않았다').toMatch(/저장값·전송값이라 등재하지 않았다/);
    expect(block, '사람 검수 대상을 열거하지 않았다').toMatch(/사람 검수 대상/);
    expect(block, 'AI 표기를 번역하지 않는다는 사실을 적지 않았다').toMatch(/AI_ORIGIN_TEXT/);
  });
});
