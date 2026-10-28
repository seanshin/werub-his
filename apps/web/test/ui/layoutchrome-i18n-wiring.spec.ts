/**
 * 레이아웃·전역 크롬 i18n 배선 가드 (`packages/shared/src/i18n/messages/layoutchrome.ts` · 2026-09-09 P3).
 *
 * 🔴 **왜 이 축이 따로 필요한가**: 화면(page.tsx) 배선은 진행됐는데 **그 화면을 감싸는 틀**이
 *    한국어로 남아 있었다(사람 운영 스크린샷 실측 — English 로 두고 찍었는데 상단 바 검색
 *    placeholder·운영 모드 배지·역할 배지·사이드바 푸터가 전부 한국어). 계측 정본
 *    `scripts/i18n-unwired-scan.mjs` 는 `apps/web/src/app/**` 만 걷는다 — `components/**` 와
 *    `lib/his-mode.tsx` 는 **그 스캐너의 시야 밖**이라 "화면 배선률"이 초록이어도 틀은 한국어였다.
 *    그래서 이 가드는 스캐너의 **세는 함수만 재사용**하고 대상 목록을 직접 든다.
 *
 * 이 가드가 지키는 것:
 *   ① 소유 파일 12개에 `<T>`/`tAttr` 배선이 있다(배선 0 = 누락이지 "일부러 한국어"가 아니다).
 *      단, 표시 문구가 애초에 없는 파일 2개(A11yRoot·Providers)는 **대조군**으로 0 을 못박는다 —
 *      "성공하면 실패로 말하지 않는다"의 반대편(문구가 없는데 배선을 요구하지 않는다).
 *   ② 파일별 **잔여 한글 조각 수를 정확 동결**한다(여유 0 — 여유를 두면 신규 하드코딩을 흡수한다).
 *      🔴 이 수는 **표시 문구의 상한**이다: `<T k={ROLE_LABEL[x]}>` 로 이미 배선된 Record 정의와
 *      DB 부서명 비교값도 함께 세어진다(스캐너 규칙 ③).
 *   ③ **죽은 키 0** — layoutchrome 의 모든 키가 (a) 소유 파일 안에 리터럴로 실재하고
 *      (b) `tOf()` 로 조회했을 때 실제로 layoutchrome 값이 나온다. (b)가 핵심이다:
 *      먼저 등록된 카탈로그가 같은 원문을 가지면 등록 순서상 그쪽이 이겨 내 값은 **파일에만 있고
 *      화면에는 영원히 안 나오는** 죽은 키가 된다.
 *   ④ **고아 키 0** — 화면이 `<T k="…">`/`tAttr('…')` 로 부르는 한국어 키 중 미등재는
 *      **의도적 미등재 집합과 정확히 같다**(조용히 늘지도, 조용히 번역되지도 않는다).
 *   ⑤ 🔴 **운영 모드 배지는 안전 문구다** — `차단`/`나가지 않습니다` 가 세 언어에서 약해지지
 *      않았는지(blocked/ブロック/محظور) 못박는다. "차단"이 "제한"이 되면 리허설 중 실제 발신이
 *      나갈 수 있다고 읽히지 않는다.
 *   ⑥ 크롬 문구의 **정본은 shared 하나**다 — 역할 라벨·운영 모드 문구·용어 토글 라벨을 화면이
 *      다시 정의하지 않는다(정본이 둘이면 갈라진다).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tOf } from '@hospital-run/shared';
import { LAYOUTCHROME_MESSAGES, LAYOUTCHROME_VERIFIED } from '@hospital-run/shared/dist/i18n/messages/layoutchrome';
// 계측 정본은 .mjs 스크립트다(수치를 두 곳에 적으면 갈라진다).
// 🔴 `@ts-expect-error` 를 달지 않는다 — 이 .mjs 는 타입 해석에 성공해 지시자 자체가 TS2578 이 된다.
import { stripComments, stripI18nKeys, koFragments } from '../../../../scripts/i18n-unwired-scan.mjs';

const ROOT = resolve(process.cwd(), '../..');
const SRC = join(ROOT, 'apps/web/src');

/** 소유 파일 — 레이아웃 축(전역 셸 + 그 셸 전용 하위 부품) */
const OWNED = [
  'components/layout/A11yRoot.tsx',
  'components/layout/EduLauncher.tsx',
  'components/layout/ErpLauncher.tsx',
  'components/layout/ManualLink.tsx',
  'components/layout/Providers.tsx',
  'components/layout/ScreenJump.tsx',
  'components/layout/Sidebar.tsx',
  'components/layout/SmartSearchBar.tsx',
  'components/layout/TermLangToggle.tsx',
  'components/layout/TopBar.tsx',
  'components/layout/UiLocaleSelect.tsx',
  'components/layout/WorkstationBadge.tsx',
  'app/(main)/layout.tsx',
  // 🔴 운영 모드 칩·띠는 `components/layout` 밖에 있지만 **레이아웃 전용 렌더 지점**이다
  //    (HisModeChip=TopBar 전용 · HisModeBanner=(main)/layout 전용). 여기서 보지 않으면 아무도 안 본다.
  'lib/his-mode.tsx',
  // 비밀번호 변경 필요 배너 — (main)/layout 전용 렌더 지점(2026-09-14)
  'components/auth/PasswordStatusBanner.tsx',
];

/** 🔴 표시 문구가 애초에 없는 파일 — 배선 0 이 정상이다(대조군: 여기에 문구가 생기면 ①이 깨진다) */
const NO_TEXT_FILES = ['components/layout/A11yRoot.tsx', 'components/layout/Providers.tsx'];

/**
 * 2026-09-09 실측(재현: `scripts/i18n-unwired-scan.mjs` 의 stripComments→stripI18nKeys→koFragments).
 * 🔴 여유 0 — 늘면 실패, 줄면 이 표를 내린다.
 * 🔴 남은 수의 정체(전부 위 머리 주석 ②의 "상한"): Sidebar 424 = NAV 데이터 라벨(전부 `<T>` 배선)
 *    + DB 부서명 비교값 + `${AI_ORIGIN_TEXT}` 조합 · TopBar 11 = 역할 라벨 Record 정의(배선됨)
 *    · ManualLink 9 = 매뉴얼 라벨 Record 정의(배선됨) · SmartSearchBar 6 = 결과 유형 라벨 5(배선됨)
 *    + 통화 부제 1 · WorkstationBadge 10 = `<b>` 로 쪼개진 2문장 + 동적 title · ScreenJump 3 = 동적 토스트.
 */
const KO_BASELINE: Record<string, number> = {
  'app/(main)/layout.tsx': 0,
  'components/layout/A11yRoot.tsx': 0,
  'components/layout/EduLauncher.tsx': 0,
  'components/layout/ErpLauncher.tsx': 0,
  'components/layout/ManualLink.tsx': 9,
  'components/layout/Providers.tsx': 0,
  'components/layout/ScreenJump.tsx': 3,
  // 2026-09-09 +1: OFF_NAV_SCREENS 에 `/admin/ui-locale/review`(3411 · 언어팩 사람 검수) 등재.
  // 화면번호 정본(NAV_SECTIONS ∪ OFF_NAV_SCREENS)에 넣으려면 라벨이 한국어 리터럴이어야 하고,
  // nav 라벨 정본은 `nav.ts`(코디네이터 소유)라 여기 사본을 두지 않는다 — 원문 + EN× 티로 나간다.
  // 2026-09-13 +1: 상용 릴리즈 T10-7 nav `/admin/legal-hold` 라벨 '법적 보존명령'(nav.ts 에 등재 — 원문 리터럴은 nav 정본 규약).
  // 2026-09-14 +1: nav `/patient-messages` 라벨 '환자 메시지함'(nav.ts 에 등재 — 원문 리터럴은 nav 정본 규약 · 환자 메시지 직원 측 수신처 신설).
  // 2026-09-14 +1: nav `/settings/password` 라벨 '비밀번호 변경'(nav.ts 에 등재 — 원문 리터럴은 nav 정본 규약 · 변경 화면 소비처 0 해소).
  // 2026-09-23 +1: OFF_NAV `/admin/config` 라벨 '시스템 설정'→'설정값 목록(읽기 전용)'(nav.ts 에 등재 · S8 「시스템 설정」 정본 하나로 —
  //    종전 라벨은 `/admin/ai-settings` 와 같은 문자열이라 조각 수에 안 잡혔고, 새 이름은 고유 문자열이라 +1).
  // 2026-09-28 +1: nav `/admin/space-assets` 라벨 '공간 자산 배치'(nav.ts 등재).
  // 2026-09-28 +1: nav `/admin/space-model` 라벨 '공간 도면'.
  // 2026-09-28 +1: nav `/executive/finance-benchmark` 라벨 '경영성과 벤치마크'(nav.ts 등재).
  // 2026-09-30 +1: nav `/results-inbox`(1011) 라벨 '검사결과 확인함'(키는 pharmlab.ts 에 등재 — 결과 확인 워크리스트 신설).
  // 2026-09-30 +1: nav `/pharmacist-replies` 라벨 '약사 회신 요청'(clinical5.ts 등재 — 같은 키를 화면 제목도 쓴다).
  // 2026-09-30 +1: nav `/verbal-orders`(1012) 라벨 '구두·전화 처방 확인'.
  // 2026-09-30 +1: nav `/renewals`(1013) 라벨 '처방 갱신 대기'.
  'components/layout/Sidebar.tsx': 446, // +1 2026-10-26 nav '간호 원내 규정'(3418 · 라벨은 번역 층) · +1 2026-10-26 nav '사람 몫 할 일'(2419 · 라벨은 번역 층) · +1 2026-10-21 nav '임상 규칙 대장'(3417 · 라벨은 번역 층) · +1 2026-10-12 OFF_NAV '사람 확인 문서'(2418 · 라벨은 번역 층) · +1 2026-10-11 OFF_NAV '결정 대장'(2417 · 라벨은 번역 층) · +2 2026-10-10 간호 메뉴 '분만 현황'(1103)·'격리·강박 감시'(1104) · +1 2026-10-09 nav '무선 위치'(3416) · +1 2026-10-07 nav '활력 표시 표준'(3415) · +1 2026-10-07 nav '의사 할 일함'(개별 4 화면은 OFF_NAV 라벨·구역으로 이동) · +1 2026-09-30 nav '병동 간 전동'(메뉴 라벨은 사이드바가 번역 층으로 넘긴다)
  'components/layout/SmartSearchBar.tsx': 6,
  'components/layout/TermLangToggle.tsx': 0,
  'components/layout/TopBar.tsx': 11,
  'components/layout/UiLocaleSelect.tsx': 0,
  'components/layout/WorkstationBadge.tsx': 10,
  'lib/his-mode.tsx': 0,
  'components/auth/PasswordStatusBanner.tsx': 0,
};

/**
 * 🔴 **배선은 했고 등재는 하지 않은** 키 — 사이드바 소분류(group) 헤더.
 *    어휘 정본은 `messages/nav.ts` 이고 layoutchrome 이 사본을 두면 정본이 둘이 된다(P12).
 *    화면에는 한국어 원문 + `EN×` 티로 뜬다 — 미번역이라는 사실이 보이는 쪽이 정직하고,
 *    nav 담당이 그 구멍을 볼 수 있다. 🔴 이 집합이 늘거나(새 미등재) 줄면(조용히 번역됨) 실패한다.
 */
const NAV_GROUP_UNREGISTERED: string[] = []; // 🔴 2026-09-09 nav.ts 정본에 등재 완료(코디네이터) — 원문+티가 사라졌다

/**
 * 같은 이유로 등재하지 않은 두 번째 집합 — off-nav 화면의 `section` 라벨
 * (`SCREEN_REGISTRY` → ScreenJump 목록·통합 검색 부제에서 `<T>`/`tAttr` 를 지난다).
 * NAV_SECTIONS 에 없는 섹션이라 nav.ts 도 아직 갖고 있지 않다 — **여기 사본을 두면 나중에
 * nav 가 채울 때 정본이 둘이 된다.** 원문 + `EN×` 티로 나가고, 이 집합이 바뀌면 실패한다.
 */
const OFFNAV_SECTION_UNREGISTERED: string[] = []; // 🔴 2026-09-09 nav.ts 정본에 등재 완료(코디네이터) — 원문+티가 사라졌다

type Row = { file: string; t: number; ko: number; frags: string[] };
const rows: Row[] = OWNED.map((f) => {
  const noc = stripComments(readFileSync(join(SRC, f), 'utf8'));
  const t = (noc.match(/<T[\s>]/g) || []).length + (noc.match(/tAttr\(/g) || []).length;
  return { file: f, t, ko: [...koFragments(stripI18nKeys(noc))].length, frags: [...koFragments(stripI18nKeys(noc))] };
});

const HAN = /[가-힣]/;
const ownedSources = OWNED.map((f) => readFileSync(join(SRC, f), 'utf8'));
const keys = Object.keys(LAYOUTCHROME_MESSAGES.en ?? {});

describe('레이아웃·전역 크롬 — i18n 배선(layoutchrome)', () => {
  it('표본 확인 — 소유 15파일이 실제로 읽힌다(0이 되면 이 가드는 아무것도 보증하지 않는다)', () => {
    expect(rows.length).toBe(15);
    expect(keys.length, 'layoutchrome 카탈로그가 비었다 — 스텁으로 되돌았나').toBeGreaterThan(60);
  });

  it('① 표시 문구가 있는 12파일 전부에 <T>/tAttr 배선이 있다 (배선 0 = 누락, 제외가 아니다)', () => {
    const unwired = rows.filter((r) => r.t === 0 && !NO_TEXT_FILES.includes(r.file)).map((r) => r.file);
    expect(unwired, `배선 0 인 파일:\n${unwired.join('\n')}`).toEqual([]);
    // 대조군 — 문구가 없는 파일에는 배선을 요구하지 않는다(요구하면 억지 가드가 된다)
    for (const f of NO_TEXT_FILES) {
      const r = rows.find((x) => x.file === f)!;
      expect(r.t, `${f} 에 문구가 생겼다 — NO_TEXT_FILES 에서 빼고 배선하라`).toBe(0);
      expect(r.ko, `${f} 에 한국어가 생겼다`).toBe(0);
    }
  });

  it('② 파일별 잔여 한글 조각 수가 조용히 늘지 않는다 (여유 0 · 정확 동결)', () => {
    const actual: Record<string, number> = {};
    for (const r of rows) actual[r.file] = r.ko;
    expect(actual).toEqual(KO_BASELINE);
  });

  it('③-a 죽은 키 0 — layoutchrome 의 모든 키가 소유 파일 안에 리터럴로 실재한다', () => {
    // 🔴 shared 상수를 통해 렌더되는 문구(운영 모드 3키·용어 토글 라벨 5키)는 웹 소스에 리터럴이
    //    없다 — 정본이 shared 이기 때문이다. 그 정본 파일도 함께 본다(수기 예외 목록을 두지 않는다).
    const canonSources = [
      readFileSync(join(ROOT, 'packages/shared/src/his-mode.ts'), 'utf8'),
      readFileSync(join(ROOT, 'packages/shared/src/term-display.ts'), 'utf8'),
    ];
    const all = [...ownedSources, ...canonSources];
    const orphan = keys.filter((k) => !all.some((s) => s.includes(k)));
    expect(orphan, `어디서도 부르지 않는 키(죽은 키):\n${orphan.join('\n')}`).toEqual([]);
  });

  it('③-b 🔴 죽은 키 0 — tOf() 가 실제로 layoutchrome 값을 돌려준다 (등록 순서에 먹히지 않았다)', () => {
    const shadowed = keys
      .filter((k) => tOf(k, 'en').text !== LAYOUTCHROME_MESSAGES.en![k])
      .map((k) => `${k}: layoutchrome="${LAYOUTCHROME_MESSAGES.en![k]}" → 실제="${tOf(k, 'en').text}"`);
    expect(
      shadowed,
      `먼저 등록된 카탈로그가 이겨 화면에 안 나가는 키 — 중복을 빼거나 문맥 키로 가른다:\n${shadowed.join('\n')}`,
    ).toEqual([]);
  });

  it('④ 고아 키 0 — 화면이 부르는 한국어 키 중 미등재는 nav 소분류 정확 집합뿐이다', () => {
    const used = new Set<string>();
    for (const s of ownedSources) {
      for (const m of s.matchAll(/<T\s+k="((?:[^"\\]|\\.)*)"/g)) used.add(m[1]);
      for (const m of s.matchAll(/tAttr\(\s*'((?:[^'\\]|\\.)*)'/g)) used.add(m[1]);
    }
    const missing = [...used].filter((k) => HAN.test(k) && tOf(k, 'en').missing).sort();
    expect(missing, '정적 키 중 미등재 — 전부 등재돼 있어야 한다').toEqual([]);

    // 동적 키(nav 소분류 group) — 배선은 됐고 등재는 안 됐다. 정확 집합.
    const sidebar = readFileSync(join(SRC, 'components/layout/Sidebar.tsx'), 'utf8');
    expect(sidebar, '소분류 헤더가 <T> 를 지나지 않는다').toContain('<T k={group}');
    const groups = [...new Set([...sidebar.matchAll(/group: '((?:[^'\\]|\\.)+)'/g)].map((m) => m[1]))];
    expect(groups.length, '소분류 group 을 하나도 못 찾았다 — 정규식이 낡았나').toBeGreaterThan(10);
    const unreg = groups.filter((g) => tOf(g, 'en').missing).sort();
    expect(
      unreg,
      'nav 소분류 미등재 집합이 바뀌었다 — 늘었으면 nav.ts 에 넣고, 줄었으면 이 목록을 내린다(조용히 번역되는 것도 실패다)',
    ).toEqual([...NAV_GROUP_UNREGISTERED].sort());

    // off-nav 화면의 section 라벨 — ScreenJump 목록·통합 검색 부제가 이것을 그린다
    const jumpSrc = readFileSync(join(SRC, 'components/layout/ScreenJump.tsx'), 'utf8');
    expect(jumpSrc, 'ScreenJump 목록의 섹션이 <T> 를 지나지 않는다').toContain('<T k={e.section}');
    const searchSrc = readFileSync(join(SRC, 'components/layout/SmartSearchBar.tsx'), 'utf8');
    expect(searchSrc, '통합 검색 부제의 섹션이 tAttr 을 지나지 않는다').toContain('tAttr(e.section)');
    const sections = [...new Set([...sidebar.matchAll(/section: '((?:[^'\\]|\\.)+)'/g)].map((m) => m[1]))];
    expect(sections.length, 'off-nav section 을 하나도 못 찾았다 — 정규식이 낡았나').toBeGreaterThan(8);
    expect(
      sections.filter((g) => tOf(g, 'en').missing).sort(),
      'off-nav 섹션 미등재 집합이 바뀌었다 — 어휘 정본은 nav 축이다(여기 사본을 두지 않는다)',
    ).toEqual([...OFFNAV_SECTION_UNREGISTERED].sort());
  });

  it('키 집합이 세 언어에서 동일하고 빈 값이 없다 (한 언어만 조용히 비는 회귀 차단)', () => {
    const en = Object.keys(LAYOUTCHROME_MESSAGES.en ?? {}).sort();
    expect(Object.keys(LAYOUTCHROME_MESSAGES.ja ?? {}).sort()).toEqual(en);
    expect(Object.keys(LAYOUTCHROME_MESSAGES.ar ?? {}).sort()).toEqual(en);
    for (const lang of ['en', 'ja', 'ar'] as const) {
      const empty = Object.entries(LAYOUTCHROME_MESSAGES[lang] ?? {}).filter(([, v]) => !v || !String(v).trim()).map(([k]) => k);
      expect(empty, `${lang} 빈 값`).toEqual([]);
    }
  });

  it('전량 AI_DRAFT — 검수(VERIFIED)는 사람이 커밋으로 남긴다', () => {
    expect([...LAYOUTCHROME_VERIFIED]).toEqual([]);
    // 대조군: 실제 등재 키는 draft=true·missing=false 로 나온다(성공을 실패로 말하지 않는다)
    expect(tOf('로그아웃', 'en')).toMatchObject({ missing: false, draft: true });
  });

  it('⑤ 🔴 운영 모드 배지는 안전 문구다 — "차단"이 세 언어에서 약해지지 않았다', () => {
    const badge = '시드 데이터 · 대외 발신 차단';
    expect(tOf(badge, 'en').text).toMatch(/blocked/i);
    expect(tOf(badge, 'ja').text).toMatch(/ブロック|遮断/);
    expect(tOf(badge, 'ar').text).toMatch(/محظور/);
    // 모드 배너 2문장도 "나가지 않는다"를 부정형 그대로 유지한다(약해지면 반대로 읽힌다)
    const dev = '개발 모드 — 시드(가상) 데이터입니다. 실환자 기록이 아니며 대외 발신은 나가지 않습니다.';
    const reh = '리허설 모드 — 실환자 데이터가 아닙니다. 문자·메일·기관 전송은 실제로 나가지 않습니다.';
    for (const k of [dev, reh]) {
      expect(tOf(k, 'en').text, k).toMatch(/\b(no|not|do not|does not)\b/i);
      expect(tOf(k, 'ja').text, k).toMatch(/ません/);
    }
    // 🔴 정직성 어휘를 흐리지 않는다 — '확인불가' 는 "확인하지 못했다"이지 "없다"가 아니다
    expect(tOf('확인불가', 'en').text).toMatch(/cannot confirm/i);
  });

  it('⑥ 크롬 문구 정본은 shared 하나 — 화면이 다시 정의하지 않는다', () => {
    const chip = readFileSync(join(SRC, 'lib/his-mode.tsx'), 'utf8');
    // 모드 문구는 HIS_MODE_META 에서 온다(FE 가 라벨을 새로 적으면 갈라진다)
    expect(chip).toContain('<T k={meta.label}');
    expect(chip).toContain('<T k={meta.short}');
    for (const lit of ['리허설', '개발', '시드 데이터 · 대외 발신 차단']) {
      expect(chip.includes(`'${lit}'`), `모드 문구 '${lit}' 을 화면이 다시 정의했다`).toBe(false);
    }
    const toggle = readFileSync(join(SRC, 'components/layout/TermLangToggle.tsx'), 'utf8');
    expect(toggle).toContain('<T k={TERM_LANG_LABEL[m]}');
    expect(toggle).toContain('tAttr(TERM_LANG_DESC[m])');
    // 역할 라벨은 TopBar 의 Record 가 정본 키(한국어)이고, 렌더에서만 조회한다
    const top = readFileSync(join(SRC, 'components/layout/TopBar.tsx'), 'utf8');
    expect(top).toContain('<T k={roleLabel[user.role] ?? user.role}');
    // 🔴 부정 단언은 "어떤 형태로도 없다"를 본다 — JSX 텍스트 노드로 직접 그리는 형태가 남으면 실패
    expect(/>\s*\{roleLabel\[user\.role\]/.test(top), '역할 배지가 <T> 없이 직접 렌더된다').toBe(false);
  });

  it('🔴 스크린샷에서 한국어로 남아 있던 자리들이 실제로 <T>/tAttr 를 지난다 (2026-09-09 사람 실측)', () => {
    const top = readFileSync(join(SRC, 'components/layout/TopBar.tsx'), 'utf8');
    expect(top).toContain('<T k="환자, 약품, 진단코드, 화면 통합 검색..."');
    const sel = readFileSync(join(SRC, 'components/layout/UiLocaleSelect.tsx'), 'utf8');
    expect(sel).toContain('<T k="화면 언어"');
    const toggle = readFileSync(join(SRC, 'components/layout/TermLangToggle.tsx'), 'utf8');
    expect(toggle).toContain('<T k="의료코드"');
    const ws = readFileSync(join(SRC, 'components/layout/WorkstationBadge.tsx'), 'utf8');
    expect(ws).toContain('<T k="워크스테이션 선택"');
    const jump = readFileSync(join(SRC, 'components/layout/ScreenJump.tsx'), 'utf8');
    expect(jump).toContain("tAttr('화면번호')");
    const side = readFileSync(join(SRC, 'components/layout/Sidebar.tsx'), 'utf8');
    const manual = readFileSync(join(SRC, 'components/layout/ManualLink.tsx'), 'utf8');
    expect(manual).toContain('<T k={m.label}');
    const edu = readFileSync(join(SRC, 'components/layout/EduLauncher.tsx'), 'utf8');
    expect(edu).toContain('<T k="사내교육"');
    const erp = readFileSync(join(SRC, 'components/layout/ErpLauncher.tsx'), 'utf8');
    expect(erp).toContain("tAttr('ERP (SSO 자동 로그인)')");
    // 🔴 소분류 접기/펼치기가 대분류와 달리 tAttr 을 지나지 않던 자리(실결함 회수)
    expect(side).toContain("${open ? tAttr('접기') : tAttr('펼치기')}");
    expect(side.includes("${open ? '접기' : '펼치기'}"), '소분류 aria-label 이 생한글로 남았다').toBe(false);
  });
});
