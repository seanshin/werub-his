import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// 계측 정본은 스캐너 스크립트다 — 세는 규칙을 두 곳에 적으면 갈라진다.
import { scanScreens, stripComments, catalogKeysOf } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 **어느 카탈로그도 갖지 않던 23화면**의 UI 언어 배선 가드 (2026-09-12 §12 잔여 · 카탈로그 `clinical6`).
 *
 * 실측 경위: `배선 0 · 한글>0` 167화면을 **소유 관계로 갈랐더니**
 *   · 20화면(133조각)은 이미 카탈로그·가드가 소유한 것이었다 —
 *     `dashboard/widgets/ext` 17종은 `label:` 을 부모(`ApiStatsWidget`)가 `<T>` 로 그리고(staffdash),
 *     베드사이드 디스플레이는 **기기 단위 화면이라 배선하지 않기로 한 결정**(clinical5 ⑥)이다.
 *     🔴 스캐너의 "배선 0"은 **부모가 번역하는 prop 을 못 본다** — 그 수를 그대로 결함으로 읽으면 틀린다.
 *   · 남은 23화면(273조각)만 진짜 무소속이었다. 이 가드는 그 23화면을 못박는다.
 *
 * 못박는 것은 **반증 가능한 것만**이다:
 *   (a)  화면별 한글 잔여(`ko`)·식 옆 텍스트(`koExpr`)·배선 수(`t`) — **정확 일치**(여유 0).
 *        줄면 기준선을 낮추고, 늘면 실패한다.
 *   (b)  화면이 i18n 층에 넘기는 한국어 키가 **어느 카탈로그엔가 있다**(없으면 화면에 `EN×` 거짓 티).
 *   (c)  🔴 고아 키 0 — clinical6 의 모든 키를 이 23화면이 실제로 넘긴다.
 *   (d)  🔴 죽은 키 0 — 앞서 등록된 카탈로그가 이미 가진 원문을 clinical6 가 다시 정의하지 않는다.
 *   (e)  세 언어 키 집합 동일 · 빈 값 0 · 번역문이 키와 **같은 자리표시자**를 갖는다.
 *   (f)  🔴 뜻이 갈리는 문맥 키 2개가 살아 있다 — `투약@패널`(맨 키는 'Administered')·
 *        `미확인@임신`(맨 키는 'Unacknowledged'). 맨 키로 되돌리면 화면이 **다른 뜻**을 말한다.
 *   (g)  🔴 의도적 미등재가 **사유와 함께** 남아 있다 — 병원명이 든 문장 2건(§12-C 축이 먼저다).
 *        사유 없이 사라지면(=조용히 등재되면) 여기서 걸린다.
 *   (h)  대조군 — 스캐너·파서·추출기가 실제로 대상을 읽는다(0 이 되면 통과가 무의미하다).
 */

const ROOT = resolve(__dirname, '../../../..');
const APP = join(ROOT, 'apps/web/src/app');
const MSG = join(ROOT, 'packages/shared/src/i18n/messages');
const read = (p: string) => readFileSync(p, 'utf-8');
const HAN = /[가-힣]/;

/** 이 갈래가 배선한 화면 — 스캐너 `rows[].file` 표기(=`apps/web/src/app` 상대) */
const OWNED = [
  '(main)/nursing-station/page.tsx',
  // 2026-10-04 스테이션 보드 상세화 — 보드를 화면·인계 보드·환자 보기로 나눴다(같은 화면의 부품)
  '(main)/nursing-station/HandoffBoard.tsx',
  '(main)/nursing-station/PatientViews.tsx',
  '(main)/nursing-station/handoff-ui.tsx',
  '(main)/nursing-station/StaffingPanel.tsx',
  '(main)/nursing-station/AssignControls.tsx',
  'station-wall/page.tsx',
  '(main)/nurse-station/imaging/page.tsx',
  '(main)/pharmacy-board/page.tsx',
  '(main)/imaging/components/OrdersTab.tsx',
  '(main)/imaging/components/StatsTab.tsx',
  '(main)/imaging/components/PacsHealthBadge.tsx',
  '(main)/reception/components/AiReceptionChat.tsx',
  '(main)/reception/components/PatientPhotoCapture.tsx',
  '(main)/departments/[slug]/page.tsx',
  '(main)/his-news/page.tsx',
  '(main)/patients/[id]/components/board/panel-registry.tsx',
  '(main)/patients/[id]/components/board/BoardPanel.tsx',
  '(main)/patients/[id]/components/board/BoardLayoutEditor.tsx',
  '(main)/patients/[id]/components/PrescriptionSafetyBadges.tsx',
  '(main)/patients/[id]/components/ForeignCareBadges.tsx',
  '(main)/patients/[id]/encounter/new/components/PregnancyStatusCard.tsx',
  '(main)/patients/[id]/encounter/new/components/EncounterActionBar.tsx',
  '(main)/doctors/[userId]/page.tsx',
  '(main)/doctors/page.tsx',
  '(main)/medical-records/search/page.tsx',
  '(main)/qr/page.tsx',
  '(main)/rounds/all-rounds-board.tsx',
  '(main)/encounters/[appointmentId]/page.tsx',
  '(main)/kiosk/clock/page.tsx',
  '(main)/error.tsx',
];

/**
 * 2026-09-12 배선 후 실측(재현: `node scripts/i18n-unwired-scan.mjs --json` → rows[].ko / koExpr / t).
 * `ko` 에 남은 것은 표시 문구가 아니다 — 라벨 맵 **정의**(`<T k={맵[x]}>` 로 렌더) · `<Unit>` 이 갖는 단위 꼬리 ·
 *   스스로 번역하는 부품의 prop(`EmptyState` title/hint) · 🔴 **의도적 미등재**(병원명 문장 2건 · (g) 가 지킨다).
 * `panel-registry.tsx` 의 `t: 0` 은 정상이다 — **라벨 정본**이라 렌더 지점이 없다(소비처 3곳이 `<T>` 로 그린다).
 * 🔴 여유 0 — 늘면 실패, 줄면 이 표를 내린다.
 */
  // 🔴 2026-09-12 계측 모델 교정 — 스스로 번역하는 부품(EmptyState·Ratio)의 문자열 prop 은 잔여가 아니라 배선이다(스캐너 규칙). 그만큼 ko 가 내려갔다.
// 🔴 2026-09-12 계측 교정: 스스로 번역하는 부품의 문자열 prop 이 t 로 세어져 t 가 올랐다(같은 코드 · 규칙만 바뀜).
const BASELINE: Record<string, { ko: number; koExpr: number; t: number }> = {
  // 2026-10-04 보드 상세화로 세 파일로 나눔 — page 의 ko 6 = KPI 라벨 prop(`<Kpi label>` 이 `<T k={label}>` 로 그린다) ·
  //   PatientViews 의 ko 8 = 격리 라벨 맵 정의 6 + `<Unit>` 단위 꼬리 2
  '(main)/nursing-station/page.tsx': { ko: 6, koExpr: 0, t: 36 },
  '(main)/nursing-station/HandoffBoard.tsx': { ko: 0, koExpr: 0, t: 32 },
  '(main)/nursing-station/PatientViews.tsx': { ko: 8, koExpr: 0, t: 62 },
  '(main)/nursing-station/handoff-ui.tsx': { ko: 0, koExpr: 0, t: 4 },
  '(main)/nursing-station/StaffingPanel.tsx': { ko: 0, koExpr: 0, t: 49 },
  '(main)/nursing-station/AssignControls.tsx': { ko: 0, koExpr: 0, t: 19 },
  // 벽걸이 — ko 3 = 근무조 라벨 맵 정의(`<T k={SHIFT_KEY[x]}>` 로 렌더)
  'station-wall/page.tsx': { ko: 3, koExpr: 0, t: 27 },
  '(main)/nurse-station/imaging/page.tsx': { ko: 5, koExpr: 0, t: 17 },
  '(main)/pharmacy-board/page.tsx': { ko: 6, koExpr: 1, t: 15 },
  '(main)/imaging/components/OrdersTab.tsx': { ko: 0, koExpr: 0, t: 16 },
  '(main)/imaging/components/StatsTab.tsx': { ko: 8, koExpr: 0, t: 10 },
  '(main)/imaging/components/PacsHealthBadge.tsx': { ko: 2, koExpr: 0, t: 3 },
  '(main)/reception/components/AiReceptionChat.tsx': { ko: 3, koExpr: 1, t: 14 },
  '(main)/reception/components/PatientPhotoCapture.tsx': { ko: 0, koExpr: 0, t: 7 },
  '(main)/departments/[slug]/page.tsx': { ko: 1, koExpr: 0, t: 14 },
  '(main)/his-news/page.tsx': { ko: 10, koExpr: 0, t: 7 },
  '(main)/patients/[id]/components/board/panel-registry.tsx': { ko: 14, koExpr: 0, t: 0 },
  '(main)/patients/[id]/components/board/BoardPanel.tsx': { ko: 2, koExpr: 0, t: 13 },
  '(main)/patients/[id]/components/board/BoardLayoutEditor.tsx': { ko: 2, koExpr: 1, t: 13 },
  '(main)/patients/[id]/components/PrescriptionSafetyBadges.tsx': { ko: 2, koExpr: 0, t: 10 },
  '(main)/patients/[id]/components/ForeignCareBadges.tsx': { ko: 2, koExpr: 0, t: 8 },
  '(main)/patients/[id]/encounter/new/components/PregnancyStatusCard.tsx': { ko: 3, koExpr: 0, t: 6 },
  '(main)/patients/[id]/encounter/new/components/EncounterActionBar.tsx': { ko: 0, koExpr: 0, t: 3 },
  '(main)/doctors/[userId]/page.tsx': { ko: 0, koExpr: 1, t: 12 },
  '(main)/doctors/page.tsx': { ko: 1, koExpr: 2, t: 5 },
  '(main)/medical-records/search/page.tsx': { ko: 5, koExpr: 0, t: 8 },
  '(main)/qr/page.tsx': { ko: 2, koExpr: 0, t: 8 },
  '(main)/rounds/all-rounds-board.tsx': { ko: 1, koExpr: 2, t: 5 },
  '(main)/encounters/[appointmentId]/page.tsx': { ko: 0, koExpr: 0, t: 5 },
  '(main)/kiosk/clock/page.tsx': { ko: 0, koExpr: 0, t: 5 },
  '(main)/error.tsx': { ko: 0, koExpr: 0, t: 4 },
};

/** 🔴 병원명이 박혀 사유와 함께 **일부러** 남긴 문장 — 등재하면 기관 정체성 정본과 갈린다(§12-C) */
const INTENTIONAL_KO = [
  { file: '(main)/doctors/page.tsx', frag: '위루비병원의 전문 의료진을 소개합니다' },
  { file: '(main)/his-news/page.tsx', frag: '위루비병원의 공지사항, 언론보도, 행사 소식을 안내합니다' },
];

/* ── 카탈로그 ─────────────────────────────────────────────────────────────── */

/** registry.ts 의 등록 순서 = `t()` 우선순위 정본 */
function registeredOrder(): string[] {
  const reg = read(join(MSG, 'registry.ts'));
  const files = [...reg.matchAll(/from '\.\/([a-z0-9_-]+)'/gi)].map((m) => `${m[1]}.ts`);
  // common 은 t.ts 가 직접 등록한다(registry 에 호출이 없다) — 맨 앞이다
  return [...new Set(['common.ts', ...files])];
}
/** 파서 정본은 스캐너(`catalogKeysOf`) — 가드마다 두면 표기 하나를 빠뜨려 갈라진다 */
const keysOf = (file: string) => catalogKeysOf(read(join(MSG, file))) as Set<string>;

const ORDER = registeredOrder();
const AT = ORDER.indexOf('clinical6.ts');
const MINE = keysOf('clinical6.ts');
const BEFORE = new Set<string>();
for (const f of ORDER.slice(0, AT)) for (const k of keysOf(f)) BEFORE.add(k);
const ALL_KEYS = new Set<string>();
for (const f of ORDER) for (const k of keysOf(f)) ALL_KEYS.add(k);

/** clinical6 의 [en, ja, ar] 튜플 */
function rowsOf(): Array<{ key: string; v: string[] }> {
  const src = read(join(MSG, 'clinical6.ts'));
  const body = src.slice(src.indexOf('const TRANSLATIONS'), src.indexOf('const en: Record'));
  const out: Array<{ key: string; v: string[] }> = [];
  for (const m of body.matchAll(/^ {2}'((?:\\.|[^'\\])+)':\s*\[([\s\S]*?)\],$/gm)) {
    const vals = [...m[2].matchAll(/'((?:\\.|[^'\\])*)'/g)].map((x) => x[1].replace(/\\'/g, "'"));
    out.push({ key: m[1].replace(/\\'/g, "'"), v: vals });
  }
  return out;
}

/* ── 화면이 i18n 층에 넘기는 키 ───────────────────────────────────────────── */
function literals(expr: string): string[] {
  return [...expr.matchAll(/'((?:\\.|[^'\\\n])*)'/g)].map((m) => m[1].replace(/\\'/g, "'"))
    .concat([...expr.matchAll(/"((?:\\.|[^"\\\n])*)"/g)].map((m) => m[1]));
}
function usedKeys(file: string): Set<string> {
  const src = stripComments(read(join(APP, file)));
  const out = new Set<string>();
  const attrs = String.raw`(?:className=(?:"[^"]*"|\{[^{}]*\})\s+)?`;
  for (const m of src.matchAll(new RegExp(String.raw`<T\s+${attrs}k="((?:\\.|[^"\\])+)"`, 'g'))) out.add(m[1]);
  for (const m of src.matchAll(new RegExp(String.raw`<Tf\s+${attrs}[\s\S]{0,4}?k="((?:\\.|[^"\\])+)"`, 'g'))) out.add(m[1]);
  for (const m of src.matchAll(new RegExp(String.raw`<Tf?\s+${attrs}k=\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}`, 'g'))) for (const l of literals(m[1])) out.add(l);
  for (const m of src.matchAll(/\bt(?:Attr|fAttr)\(\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g)) for (const l of literals(m[1])) out.add(l);
  // 라벨 맵 값(`label: '…'`) — 소비처가 `<T k={맵[x]}>` 로 그린다
  for (const m of src.matchAll(/\blabel:\s*'((?:\\.|[^'\\\n])*)'/g)) out.add(m[1].replace(/\\'/g, "'"));
  // 스스로 번역하는 부품의 문자열 prop(EmptyState title/hint)
  for (const m of src.matchAll(/\b(?:title|hint)="([^"]*)"/g)) out.add(m[1]);
  // JSX 가 엔티티를 디코드한다(`&quot;` → `"`) — 카탈로그 키는 디코드된 모양이다
  return new Set([...out].map((k) => k.replace(/&quot;/g, '"')).filter((k) => HAN.test(k)));
}

const USED = OWNED.map((f) => ({ f, keys: usedKeys(f) }));
const USED_ALL = new Set<string>();
for (const { keys } of USED) for (const k of keys) USED_ALL.add(k);

describe('🔴 무소속 23화면 i18n 배선 (clinical6)', () => {
  it('(h) 대조군 — 스캐너·파서·추출기가 실제로 대상을 읽는다(0 이 되면 통과가 무의미하다)', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string }>;
    expect(rows.length).toBeGreaterThan(500);
    for (const f of OWNED) expect(rows.find((r) => r.file === f), `스캔 대상에 없다: ${f}`).toBeTruthy();
    expect(AT, 'registry 에서 clinical6 를 찾지 못했다').toBeGreaterThan(0);
    expect(ORDER.length, 'registry 파싱이 깨졌다').toBeGreaterThan(30);
    expect(MINE.size, 'clinical6 표 파싱이 깨졌다').toBeGreaterThan(100);
    expect(ALL_KEYS.size, '카탈로그 키 수집이 깨졌다').toBeGreaterThan(5000);
    expect(USED_ALL.size, '화면 키 추출이 깨졌다').toBeGreaterThan(150);
    // 추출기 대조군 — 경로마다 실제로 잡는다
    expect(USED_ALL.has('간호 스테이션 보드')).toBe(true); // <T k="…">
    expect(USED_ALL.has('{수}시간 전')).toBe(true); // tfAttr
    expect(USED_ALL.has('진료 시작 전')).toBe(true); // <T k={조건식}>
    expect(USED_ALL.has('투약@패널')).toBe(true); // 라벨 맵 값
    expect(USED_ALL.has('재원 환자가 없습니다.')).toBe(true); // EmptyState title prop
    expect(USED_ALL.has('"{검색어}" 검색 결과: {건수}')).toBe(true); // 🔴 JSX 엔티티 디코드(&quot;)
  });

  it('(a) 화면별 한글 잔여·식 옆 텍스트·배선 수가 기준선과 **정확히** 일치한다(여유 0)', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string; ko: number; koExpr: number; t: number }>;
    const actual: Record<string, { ko: number; koExpr: number; t: number }> = {};
    for (const f of OWNED) {
      const r = rows.find((x) => x.file === f)!;
      actual[f] = { ko: r.ko, koExpr: r.koExpr, t: r.t };
    }
    expect(actual).toEqual(BASELINE);
  });

  it('(b) 화면이 넘기는 한국어 키가 카탈로그에 있다 — 없으면 화면에 EN× 거짓 티가 뜬다', () => {
    const missing: string[] = [];
    for (const { f, keys } of USED) for (const k of keys) if (!ALL_KEYS.has(k)) missing.push(`${f}: ${k}`);
    expect(missing, `미등록 키(원문+티로 나간다):\n${missing.join('\n')}`).toEqual([]);
  });

  it('(c) 🔴 고아 키 0 — clinical6 의 모든 키를 소유 화면이 실제로 넘긴다', () => {
    const orphan = [...MINE].filter((k) => !USED_ALL.has(k));
    expect(orphan, `소유 화면이 부르지 않는 키:\n${orphan.join('\n')}`).toEqual([]);
  });

  it('(d) 🔴 죽은 키 0 — 앞 카탈로그가 이미 가진 원문을 다시 정의하지 않는다', () => {
    const dup = [...MINE].filter((k) => BEFORE.has(k));
    expect(dup, `앞 카탈로그와 중복(사본은 죽은 키가 된다):\n${dup.join('\n')}`).toEqual([]);
  });

  it('(e) 세 언어 키 집합 동일 · 빈 값 0 · 자리표시자 일치', () => {
    const rows = rowsOf();
    expect(rows.length, '표 행 수와 키 수가 다르다(파서가 행을 흘렸다)').toBe(MINE.size);
    const bad: string[] = [];
    for (const { key, v } of rows) {
      if (v.length !== 3) { bad.push(`${key}: 언어 ${v.length}개`); continue; }
      if (v.some((x) => !x.trim())) bad.push(`${key}: 빈 값`);
      const want = [...key.matchAll(/\{([^{}\s]+)\}/g)].map((m) => m[1]).sort().join(',');
      for (const [i, x] of v.entries()) {
        const got = [...x.matchAll(/\{([^{}\s]+)\}/g)].map((m) => m[1]).sort().join(',');
        if (got !== want) bad.push(`${key}[${['en', 'ja', 'ar'][i]}]: 자리표시자 ${got || '(없음)'} ≠ ${want || '(없음)'}`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('(f) 🔴 뜻이 갈리는 문맥 키 2개가 살아 있다 — 맨 키로 되돌리면 화면이 다른 뜻을 말한다', () => {
    // 맨 키가 앞 카탈로그에서 **다른 뜻**임을 함께 확인한다(이 사실이 문맥 키의 근거다)
    expect(MINE.has('투약@패널'), 'panel-registry 가 맨 `투약`(=Administered)으로 되돌아갔다').toBe(true);
    expect(MINE.has('미확인@임신'), '임신 여부가 맨 `미확인`(=Unacknowledged)으로 되돌아갔다').toBe(true);
    expect(BEFORE.has('투약'), '대조군 — 맨 `투약` 이 앞 카탈로그에 없으면 문맥 키의 근거가 사라진다').toBe(true);
    expect(BEFORE.has('미확인'), '대조군 — 맨 `미확인` 이 앞 카탈로그에 없으면 문맥 키의 근거가 사라진다').toBe(true);
    const registry = read(join(APP, '(main)/patients/[id]/components/board/panel-registry.tsx'));
    expect(registry).toMatch(/label: '투약@패널'/);
  });

  it('(g) 🔴 의도적 미등재가 사유와 함께 남아 있다 — 조용히 등재되면 기관 정체성 정본과 갈린다', () => {
    for (const { file, frag } of INTENTIONAL_KO) {
      const src = read(join(APP, file));
      expect(src, `${file}: 남기기로 한 문장이 사라졌다`).toContain(frag);
      expect(src, `${file}: 사유 주석(§12-C)이 없다 — 왜 안 했는지가 코드에 없으면 다음 사람이 모른다`).toContain('§12-C');
      expect(MINE.has(frag), `${file}: 병원명이 든 문장이 카탈로그에 등재됐다`).toBe(false);
    }
  });
});
