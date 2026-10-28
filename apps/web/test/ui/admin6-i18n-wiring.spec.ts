/**
 * 관리자 B 그룹 25화면 i18n 배선 가드 (`packages/shared/src/i18n/messages/admin6.ts` · 2026-09-09 P3 라운드 2).
 *
 * 🔴 이 가드가 지키는 것은 넷이다. 전부 **반증 가능한 것**만 못박는다:
 *   ① 25화면 전부에 `<T>`/`tAttr` 배선이 있다 — 배선 0 인 화면은 "일부러 한국어로 뒀다"고 말할 근거가 없다.
 *   ② 화면별 **잔여 한글 조각 수를 정확 동결**한다(여유 0 — 여유를 두면 신규 하드코딩을 흡수한다).
 *      🔴 이 수는 **표시 문구의 상한**이다: 스캐너 규칙상 `<T k={RECORD[x]}>` 로 이미 배선된
 *      Record 정의(`{ PENDING: '대기' }`)와 토스트·비교 문자열도 함께 세어진다.
 *   ③ **죽은 키 0** — admin6 의 모든 키가 (a) 소유 25화면 안에 리터럴로 실재하고
 *      (b) `tOf()` 로 조회했을 때 **실제로 admin6 값이 나온다**. (b)가 핵심이다:
 *      먼저 등록된 카탈로그가 같은 원문을 갖고 있으면 등록 순서상 그쪽이 이겨 내 값은
 *      **파일에만 있고 화면에는 영원히 안 나오는** 죽은 키가 된다(합류 직전 실측 8건 회수).
 *   ④ `/admin/ui-locale` **자기참조 8건은 의도적 미등재**다 — 번역 관제 화면 자신의 3상태 어휘를
 *      번역하면 "번역이 없다"를 설명하는 문구까지 AI 초안으로 덮인다. 배선은 하되 등재하지 않아
 *      한국어 원문 + 미번역 티로 나간다. 집합이 늘거나 줄면 실패한다(조용히 번역되는 것도 실패).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tOf } from '@hospital-run/shared';
import { ADMIN6_MESSAGES, ADMIN6_VERIFIED } from '@hospital-run/shared/dist/i18n/messages/admin6';
// 계측 정본은 .mjs 스크립트다(수치를 두 곳에 적으면 갈라진다).
// 🔴 `@ts-expect-error` 를 달지 않는다 — 이 .mjs 는 타입 해석에 성공해 지시자 자체가 TS2578 이 된다
//    (i18n-exclusion-vs-gap.spec.ts 가 같은 함정을 이미 겪었다).
import { scanScreens } from '../../../../scripts/i18n-unwired-scan.mjs';

const ROOT = resolve(process.cwd(), '../..');
const APP = join(ROOT, 'apps/web/src/app');

/** 소유 25화면 — 갈래 소유권 목록(라우트 경로 기준) */
const OWNED = [
  'ui-locale', 'partner-requests', 'voucher/settings', 'menu-config', 'billing-calc', 'ai-meeting',
  'partner-requests/[id]', 'displays/[keyId]', 'data-quality', 'displays', 'ai-vision', 'organizations',
  'checkup-explainer', 'categories', 'location-stations', 'hie-dashboard', 'screen-codes',
  'prescriber-rules', 'patient-flags', 'homepage/media', 'emr-cert', 'device-recall', 'dept-catalog',
  'partner-monitoring/[orgId]', 'menus',
].map((d) => `(main)/admin/${d}/page.tsx`);

/**
 * 2026-09-09 실측(재현: `node scripts/i18n-unwired-scan.mjs --json`).
 * 🔴 여유 0 — 늘면 실패, 줄면 이 표를 내린다.
 */
  // 🔴 2026-09-12 계측 모델 교정 — 스스로 번역하는 부품(EmptyState·Ratio)의 문자열 prop 은 잔여가 아니라 배선이다(스캐너 규칙). 그만큼 ko 가 내려갔다.
const KO_BASELINE: Record<string, number> = {
  '(main)/admin/ai-meeting/page.tsx': 12,
  '(main)/admin/ai-vision/page.tsx': 13,
  // 18→17(2026-10-20): 종별 선택 줄을 결정 기록 패널로 옮겨 그 줄의 한글 조각이 빠졌다
  '(main)/admin/billing-calc/page.tsx': 17,
  '(main)/admin/categories/page.tsx': 5,
  '(main)/admin/checkup-explainer/page.tsx': 20,
  '(main)/admin/data-quality/page.tsx': 30,
  '(main)/admin/dept-catalog/page.tsx': 3,
  '(main)/admin/device-recall/page.tsx': 11,
  '(main)/admin/displays/[keyId]/page.tsx': 17,
  '(main)/admin/displays/page.tsx': 27,
  '(main)/admin/emr-cert/page.tsx': 12,
  '(main)/admin/hie-dashboard/page.tsx': 10,
  '(main)/admin/homepage/media/page.tsx': 10,
  '(main)/admin/location-stations/page.tsx': 10,
  '(main)/admin/menu-config/page.tsx': 22,
  '(main)/admin/menus/page.tsx': 8,
  '(main)/admin/organizations/page.tsx': 9,
  '(main)/admin/partner-monitoring/[orgId]/page.tsx': 0,
  '(main)/admin/partner-requests/[id]/page.tsx': 6,
  '(main)/admin/partner-requests/page.tsx': 15,
  '(main)/admin/patient-flags/page.tsx': 7,
  '(main)/admin/prescriber-rules/page.tsx': 16,
  '(main)/admin/screen-codes/page.tsx': 20,
  // 🔴 18→15: 오케스트레이터가 이 화면의 영역 목록을 수기 배열에서 등록부 정본(AREA_CATALOGS) 파생으로
  //    바꾸면서 라벨 3줄이 사라졌다(카탈로그 라벨 2키도 고아가 되어 제거). 줄었으므로 낮춘다.
  '(main)/admin/ui-locale/page.tsx': 15,
  '(main)/admin/voucher/settings/page.tsx': 23,
};

/**
 * 🔴 `/admin/ui-locale` 자기참조 — 배선은 됐고 **등재는 하지 않은** 어휘(정확 집합).
 *    이 화면이 설명하는 대상이 곧 이 단어들이라, 번역하면 화면이 자기를 설명하지 못한다.
 */
const SELF_REFERENCE_UNREGISTERED = [
  '검수 / 등재',
  '검수 완료',
  '누락',
  '등재 / 전집',
  '미검수 초안',
  '잔여',
  '카탈로그 미채움 (등재 0)',
  '카탈로그 미채움 — 세 영역 모두 등재 키 0. 등재(P1-A/B 커밋) 전에는 산출할 잔여가 없습니다(0% 도 100% 도 아님).',
];

type Row = { file: string; t: number; ko: number; frags: string[] };
const allRows: Row[] = scanScreens(APP, APP);
const rows = allRows.filter((r) => OWNED.includes(r.file));

const HAN = /[가-힣]/;
const ownedSources = OWNED.map((f) => readFileSync(join(APP, f), 'utf8'));
const keys = Object.keys(ADMIN6_MESSAGES.en ?? {});

describe('관리자 B 25화면 — i18n 배선(admin6)', () => {
  it('표본 확인 — 25화면이 실제로 스캔된다(0이 되면 이 가드는 아무것도 보증하지 않는다)', () => {
    expect(rows.length, `소유 화면 스캔 실패 — 경로가 바뀌었나:\n${OWNED.filter((f) => !allRows.some((r) => r.file === f)).join('\n')}`).toBe(25);
    expect(keys.length, 'admin6 카탈로그가 비었다 — 스텁으로 되돌았나').toBeGreaterThan(300);
  });

  it('① 25화면 전부에 <T>/tAttr 배선이 있다 (배선 0 = 누락, 제외가 아니다)', () => {
    const unwired = rows.filter((r) => r.t === 0).map((r) => r.file);
    expect(unwired, `배선 0 인 화면:\n${unwired.join('\n')}`).toEqual([]);
  });

  it('② 화면별 잔여 한글 조각 수가 조용히 늘지 않는다 (여유 0 · 정확 동결)', () => {
    const actual: Record<string, number> = {};
    for (const r of rows) actual[r.file] = r.ko;
    expect(actual).toEqual(KO_BASELINE);
  });

  it('③-a 죽은 키 0 — admin6 의 모든 키가 소유 25화면 안에 리터럴로 실재한다', () => {
    const orphan = keys.filter((k) => !ownedSources.some((s) => s.includes(k)));
    expect(orphan, `소유 화면에 없는 키(죽은 키):\n${orphan.join('\n')}`).toEqual([]);
  });

  it('③-b 🔴 죽은 키 0 — tOf() 가 실제로 admin6 값을 돌려준다 (등록 순서에 먹히지 않았다)', () => {
    const shadowed = keys
      .filter((k) => tOf(k, 'en').text !== ADMIN6_MESSAGES.en![k])
      .map((k) => `${k}: admin6="${ADMIN6_MESSAGES.en![k]}" → 실제="${tOf(k, 'en').text}"`);
    expect(
      shadowed,
      `먼저 등록된 카탈로그가 이겨 화면에 안 나가는 키 — 중복을 빼거나 문맥 키로 가른다:\n${shadowed.join('\n')}`,
    ).toEqual([]);
  });

  it('키 집합이 세 언어에서 동일하고 빈 값이 없다 (한 언어만 조용히 비는 회귀 차단)', () => {
    const en = Object.keys(ADMIN6_MESSAGES.en ?? {}).sort();
    const ja = Object.keys(ADMIN6_MESSAGES.ja ?? {}).sort();
    const ar = Object.keys(ADMIN6_MESSAGES.ar ?? {}).sort();
    expect(ja).toEqual(en);
    expect(ar).toEqual(en);
    for (const lang of ['en', 'ja', 'ar'] as const) {
      const empty = Object.entries(ADMIN6_MESSAGES[lang] ?? {}).filter(([, v]) => !v || !String(v).trim()).map(([k]) => k);
      expect(empty, `${lang} 빈 값`).toEqual([]);
    }
  });

  it('전량 AI_DRAFT — 검수(VERIFIED)는 사람이 커밋으로 남긴다', () => {
    expect([...ADMIN6_VERIFIED]).toEqual([]);
    // 대조군: 실제 등재 키는 draft=true·missing=false 로 나온다(성공을 실패로 말하지 않는다)
    const sample = keys.find((k) => HAN.test(k))!;
    expect(tOf(sample, 'en')).toMatchObject({ missing: false, draft: true });
  });

  it('④ /admin/ui-locale 자기참조 어휘는 배선됐고 등재는 안 됐다 (정확 집합)', () => {
    const src = readFileSync(join(APP, '(main)/admin/ui-locale/page.tsx'), 'utf8');
    for (const k of SELF_REFERENCE_UNREGISTERED) {
      expect(src.includes(`<T k="${k}"`), `${k} 가 배선되지 않았다`).toBe(true);
      expect(tOf(k, 'en').missing, `${k} 가 등재됐다 — 번역 관제 화면이 자기 어휘를 번역하면 안 된다`).toBe(true);
    }
    // 자기참조 목록이 조용히 늘지 않는다: 이 화면의 정적 키 중 미등재는 위 8건뿐이다
    const used = [...src.matchAll(/<T\s+k="((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).filter((k) => HAN.test(k));
    const missing = [...new Set(used.filter((k) => tOf(k, 'en').missing))].sort();
    expect(missing).toEqual([...SELF_REFERENCE_UNREGISTERED].sort());
  });

  it('🔴 로케일 코드·언어명은 손대지 않았다 — 화면이 shared 정본을 그대로 쓴다', () => {
    const src = readFileSync(join(APP, '(main)/admin/ui-locale/page.tsx'), 'utf8');
    expect(src).toContain('CATALOG_LOCALE_LABEL');
    expect(src).toContain('CATALOG_LOCALES');
    expect(src).toContain('RATIO_UNAVAILABLE');
    // 언어명을 화면이 다시 적지 않는다(정본이 둘이면 갈라진다)
    for (const lit of ['English', '日本語', 'العربية', '한국어']) {
      expect(src.includes(`'${lit}'`), `언어명 '${lit}' 을 화면이 다시 정의했다`).toBe(false);
    }
  });

  it('🔴 서버가 정본인 전송 상태 문구는 FE 가 번역하지 않는다 (HIE — 정본이 둘이면 갈라진다)', () => {
    const src = readFileSync(join(APP, '(main)/admin/hie-dashboard/page.tsx'), 'utf8');
    // 서버 판정(transmission)을 그대로 그린다 — <T> 로 감싸 FE 카탈로그를 태우지 않는다
    expect(src).toContain('{log.transmission?.label ?? log.status}');
    expect(src.includes('<T k={log.transmission')).toBe(false);
  });
});
