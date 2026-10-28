import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tOf } from '@hospital-run/shared';
// 🔴 이 카탈로그는 shared index 가 재수출하지 않는다(index.ts 는 오케스트레이터 소유라
//    병렬 라운드에서 건드리지 않는다) — 테스트만 소스를 직접 읽는다(번들 영향 없음).
import {
  CRMCHECKUP_MESSAGES,
  CRMCHECKUP_VERIFIED,
  CRMCHECKUP_REVIEW_REQUIRED,
} from '../../../../packages/shared/src/i18n/messages/crmcheckup';
// 계측 정본은 스크립트에 있다 — 세는 규칙을 두 곳에 적으면 갈라진다(i18n-exclusion-vs-gap 과 같은 규약).
import { scanScreens } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * CRM 15화면 + 검진 13화면 i18n 배선 가드 (2026-09-09 · P3 라운드 2 · 카탈로그 `crmcheckup`).
 *
 * 🔴 이 가드가 못박는 것은 넷이다.
 *   ① **미등록 0** — 화면이 정적으로 부르는 `<T k="…">`/`tAttr('…')` 키가 카탈로그에 다 있다.
 *      하나라도 빠지면 화면에 `EN×`/`JA×` 거짓 티가 뜬다("번역이 없다"고 화면이 말하는데
 *      사실은 등재를 빠뜨린 것 — 화면이 실제보다 덜 완성된 것처럼 말한다).
 *   ② **죽은 키 0** — 카탈로그에 등재했는데 어느 소유 화면도 그 원문을 쓰지 않는 키가 없다.
 *      만든 것과 소비처가 쓰는 것은 다른 일이다(사본은 조용히 늙는다).
 *   ③ **잔여 기준선 동결** — 소유 화면의 한글 조각 수를 **정확값**으로 못박는다. 여유를 두면
 *      신규 하드코딩을 그대로 흡수한다(이 저장소가 같은 함정을 두 번 겪었다).
 *      🔴 이 수는 "표시 문구"가 아니라 **상한**이다(저장값·보간 조각·비교 문자열 포함).
 *   ④ **판정 어휘의 사람 검수 목록이 실재한다** — 오역이 임상 위해가 되는 키를 열거만 하고
 *      실제로는 등재하지 않았다면 그 목록은 아무것도 지키지 않는다.
 *
 * 재주입하면 실패한다(실증 완료): 카탈로그에서 키 1개를 지우면 ①, 안 쓰는 키 1개를 넣으면 ②,
 * 화면에 한글 리터럴 1개를 늘리면 ③ 이 각각 빨강이 된다.
 */
const ROOT = resolve(process.cwd(), '../..');
const APP = join(ROOT, 'apps/web/src/app');
const OWNED = /^\(main\)\/(crm|his-checkup)\//;

/** 소유 트리의 소스 전문 — 죽은 키 판정의 모집단 */
function ownedSources(): { file: string; src: string }[] {
  const out: { file: string; src: string }[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) out.push({ file: relative(APP, p), src: readFileSync(p, 'utf8') });
    }
  };
  walk(join(APP, '(main)/crm'));
  walk(join(APP, '(main)/his-checkup'));
  return out;
}

const SOURCES = ownedSources();
const ALL_SRC = SOURCES.map((s) => s.src).join('\n');
const CATALOG_KEYS = Object.keys(CRMCHECKUP_MESSAGES.en ?? {});

/**
 * 🔴 **소스 기준 등재 키 집합** — 재주입 역검증에서 이 가드가 죽어 있는 것을 발견해 넣었다.
 *    처음엔 `tOf`(= shared **dist**)로만 판정했는데, 카탈로그 **소스**에서 키를 지워도
 *    dist 가 낡은 채 남아 **가드가 초록**이었다(주입 성공 1건을 확인했는데도 통과 —
 *    이 저장소의 알려진 함정 그대로다: web 은 shared dist 를 본다).
 *    그래서 판정을 둘로 나눈다: ①-a 는 **소스**(재주입이 닿는 곳), ①-b 는 **dist**(실제로 나가는 것).
 *    등록 목록은 registry.ts 에서 파생한다 — 수기 배열은 낡는다.
 */
function sourceRegisteredKeys(): Set<string> {
  const MSG = join(ROOT, 'packages/shared/src/i18n/messages');
  const reg = readFileSync(join(MSG, 'registry.ts'), 'utf8');
  const files = new Set<string>();
  for (const m of reg.matchAll(/from '\.\/([a-z0-9_-]+)'/gi)) files.add(`${m[1]}.ts`);
  files.add('common.ts'); // t.ts 가 직접 등록한다 — registry import 만 보면 빠진다
  const keys = new Set<string>();
  for (const f of files) {
    const src = readFileSync(join(MSG, f), 'utf8');
    for (const m of src.matchAll(/^\s*'((?:\\.|[^'\\])+)':/gm)) {
      const k = m[1].replace(/\\'/g, "'");
      if (/[가-힣]/.test(k)) keys.add(k);
    }
  }
  return keys;
}
const SOURCE_KEYS = sourceRegisteredKeys();

/** 화면이 **정적으로** 부르는 키(동적 `<T k={expr}>` 는 ③·② 로 간접 확인한다) */
function staticKeys(src: string): string[] {
  const keys = new Set<string>();
  for (const m of src.matchAll(/<T\s+k="((?:\\.|[^"\\])*)"/g)) keys.add(m[1]);
  for (const m of src.matchAll(/tAttr\('((?:\\.|[^'\\])*)'\)/g)) keys.add(m[1].replace(/\\'/g, "'"));
  return [...keys];
}

/**
 * 잔여 한글 조각 수 — 2026-09-09 실측 정확값(재현: `node scripts/i18n-unwired-scan.mjs --json`).
 * 🔴 여유 0. 줄었으면 이 표를 낮추고, 늘었으면 실패다.
 * (0 이 아닌 이유는 카탈로그 헤더 §3~§5 에 사실로 적었다 — 저장값·보간·toast·데이터 예시.)
 */
  // 🔴 2026-09-12 계측 모델 교정 — 스스로 번역하는 부품(EmptyState·Ratio)의 문자열 prop 은 잔여가 아니라 배선이다(스캐너 규칙). 그만큼 ko 가 내려갔다.
const KO_BASELINE: Record<string, number> = {
  '(main)/crm/analytics/page.tsx': 16,
  '(main)/crm/automation/page.tsx': 30, // 2026-09-14 R3 — 발송 크론 사본 표를 서버 정본 카드로 옮김(−7)
  '(main)/crm/campaigns/[id]/page.tsx': 7,
  '(main)/crm/campaigns/page.tsx': 13,
  '(main)/crm/checkup/analytics/page.tsx': 1,
  '(main)/crm/checkup/follow-ups/page.tsx': 10,
  '(main)/crm/checkup/targets/page.tsx': 5,
  '(main)/crm/communications/page.tsx': 4,
  '(main)/crm/consultation/page.tsx': 6,
  '(main)/crm/international/agencies/page.tsx': 4,
  '(main)/crm/international/analytics/page.tsx': 2,
  '(main)/crm/international/cases/page.tsx': 9,
  '(main)/crm/page.tsx': 32,
  '(main)/crm/segments/page.tsx': 3,
  '(main)/crm/templates/page.tsx': 6,
  '(main)/his-checkup/contracts/page.tsx': 12,
  '(main)/his-checkup/flow-board/page.tsx': 6,
  '(main)/his-checkup/follow-ups/page.tsx': 2,
  '(main)/his-checkup/page.tsx': 25,
  '(main)/his-checkup/programs/page.tsx': 59,
  '(main)/his-checkup/protocols/page.tsx': 20,
  '(main)/his-checkup/questionnaires/[id]/page.tsx': 9,
  '(main)/his-checkup/questionnaires/page.tsx': 53,
  '(main)/his-checkup/reception/page.tsx': 6,
  '(main)/his-checkup/review/page.tsx': 1,
  '(main)/his-checkup/schedule/page.tsx': 18,
  '(main)/his-checkup/station/page.tsx': 18,
  '(main)/his-checkup/stats/page.tsx': 12,
  '(main)/his-checkup/test-catalog/page.tsx': 28,
  '(main)/his-checkup/visit/[id]/page.tsx': 76,
  '(main)/his-checkup/waiting/page.tsx': 6,
  '(main)/his-checkup/ws/components/DynamicStationForm.tsx': 3,
  '(main)/his-checkup/ws/components/NextStationGuide.tsx': 1,
  '(main)/his-checkup/ws/components/StationLayout.tsx': 3,
  '(main)/his-checkup/ws/components/StationPage.tsx': 2,
  '(main)/his-checkup/ws/hub/page.tsx': 2,
};

describe('CRM·검진 i18n 배선 — 카탈로그 crmcheckup', () => {
  it('대조군 — 스캔이 실제로 소유 화면을 읽는다(0이면 아래 판정은 아무것도 보증하지 않는다)', () => {
    expect(SOURCES.length).toBeGreaterThan(30);
    expect(CATALOG_KEYS.length).toBeGreaterThan(300);
    const withT = SOURCES.filter((s) => s.src.includes('<T ')).length;
    expect(withT, '<T> 를 쓰는 소유 화면이 0 — 배선이 통째로 사라졌다').toBeGreaterThan(25);
  });

  it('①-a 화면이 부르는 정적 키가 전부 **소스** 카탈로그에 있다 — 재주입이 닿는 판정', () => {
    expect(SOURCE_KEYS.size, '소스 키 파싱이 깨지면 이 판정은 조용히 통과한다').toBeGreaterThan(4000);
    const miss: string[] = [];
    let checked = 0;
    for (const { file, src } of SOURCES) {
      for (const k of staticKeys(src)) {
        if (!/[가-힣]/.test(k)) continue; // 한글이 없는 키는 번역 대상이 아니다(부품이 티를 달지 않는다)
        checked += 1;
        if (!SOURCE_KEYS.has(k)) miss.push(`${file} ${k}`);
      }
    }
    expect(checked, '정적 키 표본이 0 — 이 판정은 무의미하다').toBeGreaterThan(400);
    expect(miss, `소스 카탈로그에 없는 키(화면이 원문+티를 그린다):\n${miss.join('\n')}`).toEqual([]);
  });

  it('①-b 실제로 나가는 것(shared dist)도 그 키를 안다 — dist 가 낡으면 화면에 거짓 티가 뜬다', () => {
    const miss: string[] = [];
    for (const { file, src } of SOURCES) {
      for (const k of staticKeys(src)) {
        if (!/[가-힣]/.test(k)) continue;
        for (const loc of ['en', 'ja'] as const) if (tOf(k, loc).missing) miss.push(`${file} [${loc}] ${k}`);
      }
    }
    expect(miss, `dist 미등재(= shared 재빌드 필요):\n${miss.join('\n')}`).toEqual([]);
  });

  it('② 죽은 키 0 — 등재했는데 어느 소유 화면도 쓰지 않는 키가 없다', () => {
    // 문맥 키(`원문@문맥`)는 화면이 문맥까지 통째로 쓴다. 무문맥 키는 원문이 소스에 있으면 된다
    // (동적 `<T k={라벨상수}>` 경유가 있어 리터럴 존재로 판정한다).
    const dead = CATALOG_KEYS.filter((k) => !ALL_SRC.includes(k));
    expect(dead, `죽은 키(사본은 조용히 늙는다):\n${dead.join('\n')}`).toEqual([]);
  });

  it('②-b 문맥 키는 화면이 문맥까지 그대로 쓴다 — 무문맥으로 부르면 다른 정의가 이긴다', () => {
    const ctx = CATALOG_KEYS.filter((k) => k.includes('@'));
    expect(ctx.length, '문맥 키 표본이 0 — 이 판정은 무의미하다').toBeGreaterThan(3);
    const unused = ctx.filter((k) => !ALL_SRC.includes(`"${k}"`) && !ALL_SRC.includes(`'${k}'`));
    expect(unused, `문맥 키를 화면이 안 쓴다:\n${unused.join('\n')}`).toEqual([]);
  });

  it('③ 소유 화면의 한글 잔여가 기준선을 넘지 않는다(여유 0 — 정확값)', () => {
    const rows = scanScreens(APP, APP).filter((r: { file: string }) => OWNED.test(r.file));
    const actual: Record<string, number> = {};
    for (const r of rows as { file: string; ko: number }[]) if (r.ko > 0) actual[r.file] = r.ko;
    expect(Object.keys(actual).length, '소유 화면 스캔이 비었다').toBeGreaterThan(30);
    expect(actual).toEqual(KO_BASELINE);
  });

  it('③-b 소유 화면 중 배선 0 인 것이 없다 — "안 봤다"가 남아 있지 않다', () => {
    const rows = scanScreens(APP, APP).filter((r: { file: string }) => OWNED.test(r.file));
    const unwired = (rows as { file: string; ko: number; t: number }[])
      .filter((r) => r.ko > 0 && r.t === 0)
      .map((r) => r.file);
    expect(unwired, `배선 0(한글만 남은) 소유 화면:\n${unwired.join('\n')}`).toEqual([]);
  });

  it('세 언어 키 집합이 같고 빈 값이 0 — 한 언어만 조용히 비지 않는다', () => {
    const en = Object.keys(CRMCHECKUP_MESSAGES.en ?? {}).sort();
    const ja = Object.keys(CRMCHECKUP_MESSAGES.ja ?? {}).sort();
    const ar = Object.keys(CRMCHECKUP_MESSAGES.ar ?? {}).sort();
    expect(ja).toEqual(en);
    expect(ar).toEqual(en);
    for (const loc of ['en', 'ja', 'ar'] as const) {
      const empty = Object.entries(CRMCHECKUP_MESSAGES[loc] ?? {}).filter(([, v]) => !v || !String(v).trim());
      expect(empty.map(([k]) => `${loc}:${k}`)).toEqual([]);
    }
  });

  it('④ 전량 AI_DRAFT — 사람 검수 전에 VERIFIED 로 올리지 않는다', () => {
    expect(CRMCHECKUP_VERIFIED.size).toBe(0);
  });

  it('④-b 판정·소견 어휘의 사람 검수 목록이 실재 등재 키다 — 열거만 하고 안 넣지 않았다', () => {
    expect(CRMCHECKUP_REVIEW_REQUIRED.length).toBeGreaterThan(15);
    const notRegistered = CRMCHECKUP_REVIEW_REQUIRED.filter(
      (k) => !(k in (CRMCHECKUP_MESSAGES.en ?? {})),
    );
    expect(notRegistered, `검수 목록에 있는데 등재되지 않은 키:\n${notRegistered.join('\n')}`).toEqual([]);
    // 검수 대상은 검수 전이므로 VERIFIED 에 들어 있으면 안 된다(중복 판정이 아니라 대조군이다)
    for (const k of CRMCHECKUP_REVIEW_REQUIRED) expect(CRMCHECKUP_VERIFIED.has(k)).toBe(false);
  });

  it('🔴 이미 shared 정본에 있는 판정 어휘를 재등재하지 않았다(정본이 둘이면 갈라진다)', () => {
    // 정상·이상·위험·위급·재검·판정 은 status/checkup/pharmlab 정본이 갖는다 — 여기 사본이 있으면 실패
    for (const k of ['정상', '이상', '위험', '위급', '재검', '판정', '검사완료', '소견대기', '부분완료']) {
      expect(CATALOG_KEYS, `'${k}' 사본이 crmcheckup 에 들어왔다`).not.toContain(k);
      expect(tOf(k, 'en').missing, `'${k}' 가 어느 카탈로그에도 없다 — 화면이 원문+티를 그린다`).toBe(false);
    }
  });
});
