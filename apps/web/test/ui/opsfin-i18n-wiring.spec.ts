import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// 계측 정본은 스캐너 스크립트다 — 세는 규칙을 두 곳에 적으면 갈라진다.
import { scanScreens, catalogKeysOf } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 원무·경영·인사 화면의 UI 언어 배선 가드 (2026-09-09 P3 · 카탈로그 `opsfin`).
 *
 * 이 가드가 못박는 것은 **반증 가능한 것만**이다:
 *   (a) 화면별 한글 잔여 조각 수 — **정확 일치**(늘면 실패·줄면 기준선을 낮춘다).
 *       🔴 여유를 두지 않는다. 이 저장소는 기준선에 여유를 뒀다가 재주입 위반을 두 번 흡수했다.
 *   (b) 화면별 `<T>`/`tAttr` 배선 수 — 하한(0 이 되면 이 가드는 아무것도 보증하지 않는다).
 *   (c) 화면이 `<T k="원문">`/`tAttr('원문')` 로 부르는 **한국어 키가 어느 카탈로그엔가 있다**
 *       (없으면 화면에 `EN×` 거짓 티가 뜬다).
 *   (d) 🔴 **죽은 키 0** — `opsfin` 의 키를 **먼저 등록된** 카탈로그가 이미 갖고 있으면,
 *       `t()` 는 앞 것을 돌려주므로 여기 등재분은 **아무도 보지 못하는 사본**이 된다.
 *   (e) 🔴 **고아 키 0** — 카탈로그에만 있고 소유 화면 소스에 원문이 없는 키(오타·삭제 잔재).
 *   (f) 세 언어 키 집합 동일 + 빈 값 0(한 언어만 조용히 비는 회귀 차단).
 *
 * 🔴 **정본에서 파생한다** — 카탈로그 목록·등록 순서는 `registry.ts` 를 읽어서 만든다.
 *    수기 배열을 두면 새 카탈로그가 통째로 시야 밖이 된다(2026-09-07 에 실제로 8종이 그랬다).
 */
const ROOT = resolve(process.cwd(), '../..');
const APP = join(ROOT, 'apps/web/src/app');
const MSG = join(ROOT, 'packages/shared/src/i18n/messages');
const read = (p: string) => readFileSync(p, 'utf8');

/** 이 갈래가 소유한 화면 — 배선 전/후를 이 목록으로 못박는다 */
const OWNED = [
  '(main)/cost-analysis/page.tsx',
  '(main)/hr/page.tsx',
  '(main)/duty-schedule/page.tsx',
  '(main)/billing/[id]/page.tsx',
  '(main)/satisfaction/page.tsx',
  '(main)/consent/templates/page.tsx',
  '(main)/executive/clinical/page.tsx',
  '(main)/executive/page.tsx',
  '(main)/claims/stats/page.tsx',
  '(main)/claims/stats/AdjustmentStatsWidget.tsx',
  '(main)/executive/finance-benchmark/page.tsx', // 2026-09-28 경영성과 벤치마크(공시 손익)
  '(main)/executive/finance-benchmark/FinanceBenchmarkCard.tsx',
  '(main)/executive/finance-benchmark/KoreaBubbleMap.tsx', // 2026-09-28 시도·시군구 경계 지도
  '(main)/executive/finance-benchmark/InstitutionDetail.tsx', // 2026-09-28 선택 기관 상세(개요·손익 흐름·수익 구성)
  '(main)/executive/finance-benchmark/TypeOverview.tsx', // 2026-09-28 종별 개관(병원·요양·정신) · 의원 공개 범위 안내
  '(main)/executive/finance-benchmark/MapMarker.tsx', // 2026-09-29 병원 표식·범례(모양=종별·색=이익률·크기=규모)
  '(main)/executive/finance-benchmark/KoreaMap3D.tsx', // 2026-09-29 3D 지도(건물 모형·정보 카드)
  '(main)/executive/finance-benchmark/TrendChart.tsx', // 2026-09-29 추이(연도 축·공시 없는 해 표시)
  '(main)/executive/finance-benchmark/ProfitDrilldown.tsx', // 2026-09-29 손익 흐름·수익 구성 세목 드릴다운
  '(main)/executive/finance-benchmark/ui.tsx', // 2026-09-29 화면 부품(카드·지표 타일·탭·기관 찾기)
] as const;

/**
 * 2026-09-09 실측 (재현: `node scripts/i18n-unwired-scan.mjs --json`).
 * `ko` = 남은 한글 조각(유니크) — **표시 문구의 상한**이다. 저장값(카드사·감면 사유·설문 문항)·
 *   요일 축·금액 단위·법정 서식 지면·마크업으로 쪼개진 문장은 **의도적 미등재**라 여기 남아 있다
 *   (사유는 `packages/shared/src/i18n/messages/opsfin.ts` 머리 주석).
 * `t`  = `<T` + `tAttr(` 출현 수.
 */
const BASELINE: Record<string, { ko: number; t: number }> = {
  '(main)/cost-analysis/page.tsx': { ko: 48, t: 115 },
  '(main)/hr/page.tsx': { ko: 44, t: 67 },
  '(main)/duty-schedule/page.tsx': { ko: 57, t: 82 },
  // billing/[id] ko 55→43 2026-10-14 P2-1 — 법정 항목 표를 shared 정본(RECEIPT_CLASSES)으로 · 54→55 2026-10-14 P1-3 — 감면 사유 저장값 표를 헬퍼(discountReasonText)로 뽑으며 조각이 갈림(저장값 · 의도적 미등재) · 원단위 절사 문구는 제거
  // billing/[id] ko 43→45 2026-10-14 P5 — 환불 뒤 후속 확인 토스트 2(자리표시자 문장 · `useTfAttr` 로 배선 · 카탈로그 등재 — 스캐너는 tf( 를 배선으로 세지 않는다)
  '(main)/billing/[id]/page.tsx': { ko: 45, t: 103 },
  '(main)/satisfaction/page.tsx': { ko: 31, t: 82 },
  '(main)/consent/templates/page.tsx': { ko: 52, t: 81 },
  '(main)/executive/clinical/page.tsx': { ko: 24, t: 44 },
  '(main)/executive/page.tsx': { ko: 27, t: 42 },
  '(main)/claims/stats/page.tsx': { ko: 15, t: 34 },
  '(main)/claims/stats/AdjustmentStatsWidget.tsx': { ko: 5, t: 5 },
  '(main)/executive/finance-benchmark/page.tsx': { ko: 0, t: 87 },
  '(main)/executive/finance-benchmark/FinanceBenchmarkCard.tsx': { ko: 0, t: 14 },
  // ko 4 = 데이터 대조 리터럴(개칭 시도 이름 표·법인 접두어 정규식·개칭 시군구 '인천광역시|미추홀구'→'남구') — 화면 문구 아님
  '(main)/executive/finance-benchmark/KoreaBubbleMap.tsx': { ko: 4, t: 26 },
  '(main)/executive/finance-benchmark/InstitutionDetail.tsx': { ko: 0, t: 9 },
  '(main)/executive/finance-benchmark/TypeOverview.tsx': { ko: 0, t: 17 },
  '(main)/executive/finance-benchmark/MapMarker.tsx': { ko: 0, t: 5 },
  '(main)/executive/finance-benchmark/KoreaMap3D.tsx': { ko: 0, t: 25 },
  '(main)/executive/finance-benchmark/TrendChart.tsx': { ko: 0, t: 1 },
  '(main)/executive/finance-benchmark/ProfitDrilldown.tsx': { ko: 0, t: 44 },
  '(main)/executive/finance-benchmark/ui.tsx': { ko: 0, t: 6 },
};

/* ── 카탈로그 파싱 (정본 = registry.ts 의 등록 순서) ────────────────────────── */

/** registry.ts 가 `registerCatalog` 로 등록하는 순서 — `t()` 의 우선순위 정본 */
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

/** opsfin 의 [en, ja, ar] 튜플 — 세 언어 대조용 */
function opsfinRows(): Array<{ key: string; v: string[] }> {
  const src = read(join(MSG, 'opsfin.ts'));
  const body = src.slice(src.indexOf('const TRANSLATIONS'), src.indexOf('const en: Record'));
  return [...body.matchAll(/^\s*'((?:\\.|[^'\\])+)':\s*\[([\s\S]*?)\],$/gm)].map((m) => ({
    key: m[1].replace(/\\'/g, "'"),
    v: [...m[2].matchAll(/'((?:\\.|[^'\\])*)'/g)].map((x) => x[1]),
  }));
}

const HAN = /[가-힣]/;
const ORDER = registeredOrder();
const OPSFIN_AT = ORDER.indexOf('opsfin.ts');
const CAT = new Map(ORDER.map((f) => [f, keysOf(f)]));
const ALL_KEYS = new Set<string>();
for (const f of ORDER) for (const k of CAT.get(f)!) ALL_KEYS.add(k);
const ROWS = opsfinRows();
// 법정 항목 이름(진찰료·검사료…)은 2026-10-14 P2-1 부터 shared 정본 `receipt-class.ts` 에 있고 수납 상세가 `<T k={cat.name}>` 로 그린다
const OWNED_SRC = [...OWNED.map((f) => read(join(APP, f))), read(join(process.cwd(), '../../packages/shared/src/receipt-class.ts'))].join('\n');

describe('🔴 원무·경영·인사 i18n 배선 (opsfin)', () => {
  it('대조군 — 스캐너·파서가 실제로 대상을 읽는다(0 이 되면 통과가 무의미하다)', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string; ko: number; t: number }>;
    expect(rows.length).toBeGreaterThan(500);
    for (const f of OWNED) expect(rows.find((r) => r.file === f), `스캔 대상에 없다: ${f}`).toBeTruthy();
    expect(OPSFIN_AT, 'registry 에서 opsfin 을 찾지 못했다').toBeGreaterThan(0);
    expect(ORDER.length, 'registry 파싱이 깨졌다').toBeGreaterThan(15);
    expect(ROWS.length, 'opsfin 표 파싱이 깨졌다').toBeGreaterThan(300);
    expect(ALL_KEYS.size, '카탈로그 키 수집이 깨졌다').toBeGreaterThan(3000);
  });

  it('(a) 화면별 한글 잔여가 기준선과 **정확히** 일치한다(여유 0 — 줄면 기준선을 낮춘다)', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string; ko: number }>;
    const actual: Record<string, number> = {};
    for (const f of OWNED) actual[f] = rows.find((r) => r.file === f)!.ko;
    const expected = Object.fromEntries(OWNED.map((f) => [f, BASELINE[f].ko]));
    expect(actual).toEqual(expected);
  });

  it('(b) 화면마다 <T>/tAttr 배선이 기준선 이상이다(0 이면 배선이 통째로 사라진 것)', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string; t: number }>;
    for (const f of OWNED) {
      const t = rows.find((r) => r.file === f)!.t;
      expect(t, `${f} 배선이 줄었다`).toBeGreaterThanOrEqual(BASELINE[f].t);
    }
  });

  it('(c) 화면이 부르는 한국어 키가 카탈로그에 있다 — 없으면 화면에 EN× 거짓 티가 뜬다', () => {
    const used = new Set<string>();
    for (const f of OWNED) {
      const s = read(join(APP, f));
      for (const m of s.matchAll(/<T\s+k="((?:\\.|[^"\\])+)"/g)) used.add(m[1]);
      for (const m of s.matchAll(/tAttr\('((?:\\.|[^'\\])+)'\)/g)) used.add(m[1].replace(/\\'/g, "'"));
    }
    expect(used.size).toBeGreaterThan(300); // 추출이 깨지면 조용히 0건 통과한다
    const missing = [...used].filter((k) => HAN.test(k) && !ALL_KEYS.has(k)).sort();
    expect(missing, `미등록 키(원문+티로 나간다):\n${missing.join('\n')}`).toEqual([]);
  });

  it('🔴 (d) 죽은 키 0 — 앞서 등록된 카탈로그가 이미 가진 원문을 opsfin 이 다시 정의하지 않는다', () => {
    const earlier = ORDER.slice(0, OPSFIN_AT);
    const dead = [...CAT.get('opsfin.ts')!]
      .filter((k) => earlier.some((f) => CAT.get(f)!.has(k)))
      .map((k) => `${k} ← ${earlier.filter((f) => CAT.get(f)!.has(k)).join(',')}`)
      .sort();
    expect(dead, `죽은 키(앞 카탈로그가 이긴다 — 여기서 지운다):\n${dead.join('\n')}`).toEqual([]);
  });

  it('🔴 (e) 고아 키 0 — 카탈로그에만 있고 소유 화면에 원문이 없는 키', () => {
    const orphan = ROWS.map((r) => r.key)
      .filter((k) => !OWNED_SRC.includes(k.split('@')[0]))
      .sort();
    expect(orphan, `소유 화면에 원문이 없는 키:\n${orphan.join('\n')}`).toEqual([]);
  });

  it('(f) 세 언어 키 집합이 같고 빈 값이 없다 (한 언어만 조용히 비는 회귀 차단)', () => {
    const bad = ROWS.filter((r) => r.v.length !== 3 || r.v.some((x) => !x.trim())).map((r) => r.key);
    expect(bad, `en/ja/ar 중 빠지거나 빈 값:\n${bad.join('\n')}`).toEqual([]);
  });

  it('전량 AI_DRAFT — 사람 검수(VERIFIED) 를 코드가 임의로 선언하지 않는다', () => {
    const src = read(join(MSG, 'opsfin.ts'));
    expect(src).toMatch(/OPSFIN_VERIFIED: ReadonlySet<string> = new Set\(\)/);
  });

  it('🔴 카탈로그 헤더가 "무엇을 왜 뺐는지"를 적었다 (제외 주장은 검증 가능해야 한다)', () => {
    const head = read(join(MSG, 'opsfin.ts'));
    const block = head.slice(0, head.indexOf('*/') + 2);
    expect(block).toMatch(/의도적\s*미등재/);
    expect(block, '중복 회피 실측을 적지 않았다').toMatch(/중복이라 등재하지 않았다/);
    expect(block, '저장값 제외 사유를 적지 않았다').toMatch(/저장값·전송값이라 등재하지 않았다/);
    expect(block, '사람 검수 대상을 열거하지 않았다').toMatch(/사람 검수 대상/);
  });
});
