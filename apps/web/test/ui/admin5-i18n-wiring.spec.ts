import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tOf, ADMIN5_MESSAGES } from '@hospital-run/shared';
// 계측 정본은 .mjs 스크립트다(수치를 두 곳에 적으면 갈라진다).
// 🔴 `@ts-expect-error` 를 달지 않는다 — 이 .mjs 는 타입 해석에 성공해 지시자 자체가
//    미사용 오류(TS2578)가 된다(i18n-exclusion-vs-gap 이 같은 함정을 이미 겪었다).
import { scanScreens, stripComments } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 관리자 A 20화면 — UI 언어(i18n) 배선 가드 (2026-09-09 · P3 라운드 2).
 *
 * 기획 `docs/01-plan/features/ui-locale-i18n.plan.md` §5.
 * 이 가드가 못박는 것은 셋이고, 셋 다 **반증 가능한 것만** 본다.
 *   ① 20화면 전부에 `<T>`/`tAttr` 배선이 있다(배선 0 = 누락이지 제외가 아니다).
 *   ② 화면별 **잔여 한글 조각 수를 정확히 동결**한다 — 여유 0. 늘면 실패, 줄면 이 표를 내린다.
 *      🔴 여유를 두면 신규 위반을 흡수한다(이 저장소가 55/50 으로 두 번 겪었다).
 *   ③ **죽은 키 0** — admin5 의 모든 키가 (a) 소유 화면·정본 Record 안에 리터럴로 실재하고
 *      (b) `tOf()` 가 실제로 admin5 값을 돌려준다(등록 순서에 먹히지 않았다).
 *
 * 🔴 ②의 `ko` 는 **표시 문구의 상한**이다 — 라벨 Record 값처럼 `<T k={값}>` 으로 배선된 자리도
 *    리터럴이라 세어진다. 그래서 "0이 되어야 한다"고 말하지 않고 **늘지 않는 것만** 못박는다.
 */
const ROOT = resolve(process.cwd(), '../..');
const APP = join(ROOT, 'apps/web/src/app');

const OWNED = [
  'forms', 'decisions/[key]', 'clinical-chart-verification', 'governance/standards', 'smart-clients',
  'cdss-rules', 'treatment-templates', 'care-teams', 'hira-edi', 'erp', 'clinic-schedule',
  'reference-ranges', 'er-beds', 'workstations', 'non-covered', 'integration-gates',
  'homepage/deploy', 'rbac', 'voucher/list', 'drug-mapping',
].map((d) => `(main)/admin/${d}/page.tsx`).concat([
  // 2026-10-11 결정 설명자료 본문을 부품으로 — 설명자료 페이지와 의사결정 창이 같은 본문을 쓴다(키 소유는 그대로 admin5)
  '(main)/admin/decisions/briefing.tsx',
]);

/**
 * 🔴 화면이 `<T k={정본Record[x]}>` 로 넘기는 **정본 Record 가 사는 파일**.
 *    이 파일들의 값 문자열도 admin5 의 정당한 키다(화면 소스에는 리터럴로 없다).
 *    Record 를 화면에서 재정의하지 않는다는 규약의 뒷면이라, 여기 목록이 곧 "어디서 왔는가"다.
 */
const KEY_SOURCES = [
  'apps/web/src/app/(main)/admin/decisions/types.ts',            // LAYER_TITLE · PATH_LABEL · GO_LIVE_LABEL
  'apps/web/src/components/clinical-charts/useChartVerifications.ts', // VERIFY_STATE_META
  'apps/web/src/lib/clinical-charts/index.ts',                   // ARCHETYPE_LABEL
  'packages/shared/src/decision-basis.ts',                       // BASIS_KIND_LABEL
].map((p) => join(ROOT, p));

/** 2026-09-09 실측(재현: `node scripts/i18n-unwired-scan.mjs --json`). 배선 전 계 1,049 → 232. */
const KO_BASELINE: Record<string, number> = {
  '(main)/admin/care-teams/page.tsx': 7,
  '(main)/admin/cdss-rules/page.tsx': 26,
  '(main)/admin/clinic-schedule/page.tsx': 17,
  '(main)/admin/clinical-chart-verification/page.tsx': 6,
  // 2026-10-11 본문을 briefing.tsx 로 옮김 — 27 = 6(페이지) + 21(본문) · 늘지 않았다(옮겼을 뿐) · Section title 은 Section 이 `<T k={title}>` 로 번역
  '(main)/admin/decisions/[key]/page.tsx': 6,
  '(main)/admin/decisions/briefing.tsx': 21,
  '(main)/admin/drug-mapping/page.tsx': 6,
  '(main)/admin/er-beds/page.tsx': 23,
  '(main)/admin/erp/page.tsx': 5,
  '(main)/admin/forms/page.tsx': 15,
  '(main)/admin/governance/standards/page.tsx': 19,
  '(main)/admin/hira-edi/page.tsx': 13,
  '(main)/admin/homepage/deploy/page.tsx': 9, // +4 발행 전 점검 3상태·'발행됨 · 전환 안 됨' 배지 라벨(기존 badge 와 같은 Record→<T k> 패턴·전부 등재) 2026-09-15
  '(main)/admin/integration-gates/page.tsx': 14,
  '(main)/admin/non-covered/page.tsx': 7,
  // 🔴 5 → 3 (2026-09-09): 화면이 바뀐 것이 아니라 **계측이 고쳐졌다**. 스캐너 토크나이저가
  //    템플릿 리터럴의 `${...}` 안 주석을 코드로 남겨 한글 2건을 잔여로 세고 있었다(`ui-locale-i18n.plan.md` §11).
  '(main)/admin/rbac/page.tsx': 3,
  '(main)/admin/reference-ranges/page.tsx': 6,
  '(main)/admin/smart-clients/page.tsx': 0,
  '(main)/admin/treatment-templates/page.tsx': 14,
  '(main)/admin/voucher/list/page.tsx': 6,
  '(main)/admin/workstations/page.tsx': 13,
};

type Row = { file: string; t: number; ko: number; frags: string[] };
const allRows: Row[] = scanScreens(APP, APP);
const rows = allRows.filter((r) => OWNED.includes(r.file));
const ownedSources = OWNED.map((f) => readFileSync(join(APP, f), 'utf8'));
const keySources = [...ownedSources, ...KEY_SOURCES.map((p) => readFileSync(p, 'utf8'))];
const keys = Object.keys(ADMIN5_MESSAGES.en ?? {});

/** 소스에 담긴 형태로 되돌린다 — `\n` 은 소스에서 이스케이프 두 글자다 */
const asSource = (k: string) => k.replace(/\n/g, '\\n');

/**
 * 🔴 **JSX 속성의 HTML 엔티티는 컴파일 시 디코드된다**(2026-09-09 실측: `<T k="&lsquo;x&rsquo;">` 의
 *    런타임 키는 `‘x’`). 그래서 카탈로그는 **디코드된 형태**를 담아야 하고(소스 형태로 담으면 죽은 키다),
 *    이 가드처럼 **소스 문자열과 대조**할 때는 소스 쪽을 디코드해서 봐야 한다.
 *    한쪽만 보면 정당한 키가 죽은 키로 잡힌다(실제로 그렇게 잡혔다).
 *    (`tAttr('…&#10;…')` 는 JS 문자열이라 디코드되지 않는다 — 그래서 **소스 원형도 함께** 본다.)
 */
const ENTITY: Record<string, string> = {
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D',
  amp: '&', nbsp: '\u00A0', hellip: '…', mdash: '—', ndash: '–', quot: '"', apos: "'",
};
const decodeEntities = (s: string) =>
  s.replace(/&(lsquo|rsquo|ldquo|rdquo|amp|nbsp|hellip|mdash|ndash|quot|apos|#(\d+));/g,
    (m, name: string, _all, num: string) => (name.startsWith('#') ? String.fromCharCode(Number(num)) : (ENTITY[name] ?? m)));

/**
 * 🔴 문맥 키는 **런타임에 조립**되는 것이 있다 — `bedStatusKey()` 가 `${STATUS_LABEL[s]}@병상` 을
 *    만든다. 그래서 소스에는 `가용` 과 `@병상` 이 따로 있고 합쳐진 리터럴은 없다.
 *    "리터럴로 실재한다"를 그대로 요구하면 정당한 키가 죽은 키로 잡힌다 —
 *    **원문과 접미사가 둘 다 소스에 있으면** 실재로 본다(지어낸 키는 여전히 걸린다).
 */
const existsInSource = (k: string): boolean => {
  if (keySources.some((s) => s.includes(asSource(k)) || decodeEntities(s).includes(asSource(k)))) return true;
  const at = k.lastIndexOf('@');
  if (at <= 0) return false;
  const base = k.slice(0, at);
  const ctx = k.slice(at); // '@병상'
  return keySources.some((s) => s.includes(base)) && keySources.some((s) => s.includes(`}${ctx}\``) || s.includes(`${ctx}\``));
};

describe('관리자 A 20화면 — i18n 배선(admin5)', () => {
  it('표본 확인 — 20화면이 실제로 스캔된다(0이 되면 이 가드는 아무것도 보증하지 않는다)', () => {
    const missing = OWNED.filter((f) => !allRows.some((r) => r.file === f));
    expect(missing, `소유 화면 스캔 실패 — 경로가 바뀌었나:\n${missing.join('\n')}`).toEqual([]);
    expect(rows.length).toBe(21); // 20화면 + 결정 설명자료 본문 부품(2026-10-11)
    expect(keys.length, 'admin5 카탈로그가 비었다 — 스텁으로 되돌았나').toBeGreaterThan(600);
  });

  it('① 20화면 전부에 <T>/tAttr 배선이 있다 (배선 0 = 누락, 제외가 아니다)', () => {
    const unwired = rows.filter((r) => r.t === 0).map((r) => r.file);
    expect(unwired, `배선 0 인 화면:\n${unwired.join('\n')}`).toEqual([]);
  });

  it('② 화면별 잔여 한글 조각 수가 조용히 늘지 않는다 (여유 0 · 정확 동결)', () => {
    const actual: Record<string, number> = {};
    for (const r of rows) actual[r.file] = r.ko;
    expect(actual).toEqual(KO_BASELINE);
  });

  it('③-a 죽은 키 0 — admin5 의 모든 키가 소유 화면·정본 Record 안에 리터럴로 실재한다', () => {
    const orphan = keys.filter((k) => !existsInSource(k));
    expect(orphan, `소스 어디에도 없는 키(죽은 키):\n${orphan.join('\n')}`).toEqual([]);
  });

  it('③-b 🔴 죽은 키 0 — tOf() 가 실제로 admin5 값을 돌려준다 (등록 순서에 먹히지 않았다)', () => {
    const shadowed = keys
      .filter((k) => tOf(k, 'en').text !== ADMIN5_MESSAGES.en![k])
      .map((k) => `${k}: admin5="${ADMIN5_MESSAGES.en![k]}" → 실제="${tOf(k, 'en').text}"`);
    expect(shadowed, `앞 카탈로그에 가려진 키:\n${shadowed.slice(0, 20).join('\n')}`).toEqual([]);
  });

  it('④ 배선한 리터럴 키가 세 언어 모두에 등재돼 있다 (EN×/JA× 거짓 티가 뜨지 않는다)', () => {
    const used = new Set<string>();
    for (const s of ownedSources) {
      const noc = stripComments(s);
      // 🔴 JSX **속성**(`k="…"`)만 엔티티가 디코드된다 — 런타임 키는 디코드된 형태다.
      //    `k={'…'}`·`tAttr('…')` 는 JS 문자열이라 디코드되지 않는다(원형 그대로가 키다).
      for (const m of noc.matchAll(/<T\s+k="((?:[^"\\]|\\.)*)"/g)) used.add(decodeEntities(m[1]));
      for (const m of noc.matchAll(/<T\s+k=\{'((?:[^'\\]|\\.)*)'\}/g)) used.add(m[1]);
      for (const m of noc.matchAll(/tAttr\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g)) used.add(m[1]);
      for (const m of noc.matchAll(/tAttr\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g)) used.add(m[1]);
    }
    expect(used.size, '리터럴 키 추출이 0 — 정규식이 죽었다').toBeGreaterThan(600);
    const HAN = /[가-힣]/;
    for (const loc of ['en', 'ja'] as const) {
      const miss = [...used].filter((k) => HAN.test(k) && tOf(k.replace(/\\n/g, '\n'), loc).missing);
      expect(miss, `${loc} 미등재 키:\n${miss.slice(0, 20).join('\n')}`).toEqual([]);
    }
  });

  it('⑤ 대조군 — 등재되지 않은 키는 미등록으로 말한다(성공을 실패로, 실패를 성공으로 말하지 않는다)', () => {
    // 🔴 표본은 **누구도 등재할 수 없는 값**으로 둔다(표본 키를 실제로 등재해 계약 검사가 깨진 사고가 있었다)
    expect(ADMIN5_MESSAGES.en?.['@spec전용미등록표본admin5']).toBeUndefined();
    expect(tOf('@spec전용미등록표본admin5', 'en').missing).toBe(true);
    // 실제 등재 키는 미등록이 아니다
    expect(tOf('개통 (config ON)', 'en').missing).toBe(false);
    expect(tOf('개통 (config ON)', 'en').draft).toBe(true); // 전량 AI 초안 — 검수 전이라고 말한다
  });

  it('⑥ 세 언어 키 집합이 같고 빈 값이 없다 (한 언어만 조용히 비는 회귀 방지)', () => {
    const en = Object.keys(ADMIN5_MESSAGES.en ?? {}).sort();
    const ja = Object.keys(ADMIN5_MESSAGES.ja ?? {}).sort();
    const ar = Object.keys(ADMIN5_MESSAGES.ar ?? {}).sort();
    expect(ja).toEqual(en);
    expect(ar).toEqual(en);
    for (const k of en) {
      expect(ADMIN5_MESSAGES.en![k], `en 빈 값: ${k}`).toBeTruthy();
      expect(ADMIN5_MESSAGES.ja![k], `ja 빈 값: ${k}`).toBeTruthy();
      expect(ADMIN5_MESSAGES.ar![k], `ar 빈 값: ${k}`).toBeTruthy();
    }
  });

  it('🔴 ⑦ 문맥 키로 가른 자리가 무문맥 원문으로 되돌아가지 않는다 (동음이의 재발 방지)', () => {
    // 무문맥 `예약` 은 common 의 'Appointment'(진료 예약)라 응급 베드 RESERVED 에 쓰면 뜻이 바뀐다
    expect(tOf('예약', 'en').text).not.toBe(tOf('예약@병상', 'en').text);
    expect(tOf('예약@병상', 'en').text).toBe('Reserved');
    const erBeds = readFileSync(join(APP, '(main)/admin/er-beds/page.tsx'), 'utf8');
    expect(erBeds).toContain('bedStatusKey');
    expect(erBeds).not.toMatch(/tAttr\(STATUS_LABEL\[s\]\)/);
    // 팀 해제는 pharmlab 의 'Clear'(초기화)가 아니다
    expect(tOf('해제@팀', 'en').text).toBe('Release');
  });
});
