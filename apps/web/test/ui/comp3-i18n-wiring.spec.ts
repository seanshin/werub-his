import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// 계측 정본은 스캐너 스크립트다 — 세는 규칙을 두 곳에 적으면 갈라진다. 여기서는 그 규칙을 **가져다 쓰고**
// 스캐너가 못 보는 두 자리만 덧댄다(아래 `residual()` 주석).
import { stripComments, stripI18nKeys, koFragments, countSelfTranslating } from '../../../../scripts/i18n-unwired-scan.mjs';
// 🔴 카탈로그는 **소스**에서 읽는다. `@hospital-run/shared` 는 dist 를 보므로 빌드 전에는 comp3 가 비어 보인다
//    (이 가드가 dist 를 보면 "등재했다"는 주장을 검증하지 못한 채 통과하거나 실패한다). 등록 순서의 정본은
//    registry.ts 의 `AREA_CATALOGS`(= 먼저 등록된 영역이 이긴다) — 수기 배열을 두지 않는다.
import { AREA_CATALOGS } from '../../../../packages/shared/src/i18n/messages/registry';
import { COMP3_MESSAGES } from '../../../../packages/shared/src/i18n/messages/comp3';

/**
 * 🔴 §12-B 공용·ESS·음성 i18n 배선 가드 (2026-09-11 · 카탈로그 `comp3`).
 *
 * 이 가드가 못박는 것은 **반증 가능한 것만**이다:
 *   (a) ESS 4 · 음성 3 파일의 한글 잔여 조각 수 — **정확 일치**(늘면 실패·줄면 기준선을 낮춘다. 여유 0).
 *   (b) 같은 파일의 `<T>`/`tAttr`/`<Tf>`/`tfAttr` 배선 수 — 하한.
 *   (c) 이 파일들이 부르는 한국어 키(정적 키 + 동적 키 표의 값)가 어느 카탈로그엔가 있다.
 *       없는 것은 **의도적 미등재 목록과 정확히 같아야** 한다(그 목록은 카탈로그 헤더에 사유와 함께 적혀 있다).
 *   (d) 🔴 죽은 키 0 — 앞서 등록된 카탈로그가 이미 가진 원문을 comp3 가 다시 정의하지 않는다.
 *   (e) 🔴 고아 키 0 — comp3 에만 있고 소유 소스(주석 제거)에 **키 전체가** 없는 키.
 *   (f) 세 언어 키 집합 동일 + 빈 값 0 + 🔴 자리표시자 보존(번역문이 `{건수}` 를 잃으면 숫자가 조용히 사라진다).
 *   (g) 🔴 근태 정정·초과근무의 **성공/실패 메시지가 둘 다** i18n 을 지난다(성공만 생한글이라 두 언어로 뜨던 자리).
 *   (h) `<Unit>` 주변 문장 뼈대 8곳 — 보간 키가 있고 생한글 문장 뼈대가 돌아오지 않는다.
 *       🔴 이 8파일은 **파일 전체 기준선을 두지 않는다**(다른 라운드의 소유 — 여기서 동결하면 그쪽 배선이 실패로 읽힌다).
 *   (i) 🔴 `SpeakerEnrollment` 의 조회 함수가 렌더마다 바뀌지 않는다 — `useTAttr()` 는 렌더마다 새 함수라
 *       의존성에 넣으면 `useEffect([load])` 가 렌더마다 조회를 다시 쏜다(라운드 4 배선이 만든 무한 조회 회귀).
 */
const ROOT = resolve(process.cwd(), '../..');
const SRC = join(ROOT, 'apps/web/src');
const MSG = join(ROOT, 'packages/shared/src/i18n/messages');
const read = (p: string) => readFileSync(p, 'utf8');
const code = (f: string) => stripComments(read(join(SRC, f))) as string;

/** 이 갈래가 소유한 파일 — 파일 단위 기준선을 둔다 */
const OWNED = [
  'app/(main)/ess/_components/PayslipSection.tsx',
  'app/(main)/ess/_components/AttendanceSelfServiceSection.tsx',
  'app/(main)/ess/_components/PayrollBasicsSection.tsx',
  'app/(main)/ess/_components/EssContent.tsx',
  // 2026-09-23 수렴 — ERP 조회 실패 사유 문장의 유일한 출처(어휘 = shared ERP_READ_FAILURES). 표 값은 DYNAMIC_TABLES 가 대조한다.
  'app/(main)/ess/_components/ErpFailureNote.tsx',
  'components/voice-emr/SpeakerEnrollment.tsx',
  'components/voice-emr/VoiceSettingsPanel.tsx',
  'components/voice-emr/DiarizationTest.tsx',
] as const;

/**
 * 2026-09-11 실측(배선 후). `ko` = `residual()` 이 센 유니크 조각 — 표시 문구의 상한이다.
 * 남은 것은 전부 **의도적 미등재**다(사유는 `comp3.ts` 머리 주석):
 *   · 동적 키 표의 값(`LABEL`·`STATUS_KO`·`OT_KO`·`DOC_CATS`·`RELATIONS`·`CLOCK_METHOD_KO`·`BALANCE_SOURCE_KO`·`TABS`) —
 *     렌더는 `<T k={…}>`/`tAttr(…)` 를 지나고, 값 자체는 (c) 가 카탈로그 대조한다.
 *   · 저장값(`RELATIONS`)·전송값(휴가 취소 사유)·금액 접미 `원`·단위 `<Unit>일</Unit>`·음성 등록 연습 문장 5.
 * `t` = `<T` + `tAttr(` + `<Tf` + `tfAttr(` 출현 수.
 */
const BASELINE: Record<(typeof OWNED)[number], { ko: number; t: number }> = {
  // 🔴 2026-09-23 t 27→26: ERP 장애 블록의 '다시 시도' <T> 가 ErpFailureNote 로 **옮겨간** 것이지 배선이 준 것이 아니다
  //    (사유 문장도 그쪽 표로 옮겼다 — 이 파일은 "무엇을 못 봤는지"만 말한다).
  'app/(main)/ess/_components/PayslipSection.tsx': { ko: 16, t: 26 },
  // ko 6 = ERP_FAILURE_TEXT 표 5 + 사유 미상 1 — 동적 키 표의 값(렌더는 <T k={…}> · 값은 (c) 가 카탈로그 대조)
  'app/(main)/ess/_components/ErpFailureNote.tsx': { ko: 6, t: 3 },
  // 🔴 2026-09-14 Q5 ko 7→3·t 29→27: 로컬 STATUS_KO 표를 shared `StatusBadge domain="hrRequest"` 로 옮겼다 — 라벨 번역을 배지가 맡아 이 파일의 <T> 2곳이 빠진 것이지 배선이 준 것이 아니다.
  'app/(main)/ess/_components/AttendanceSelfServiceSection.tsx': { ko: 3, t: 27 },
  'app/(main)/ess/_components/PayrollBasicsSection.tsx': { ko: 14, t: 42 },
  'app/(main)/ess/_components/EssContent.tsx': { ko: 8, t: 43 },
  'components/voice-emr/SpeakerEnrollment.tsx': { ko: 5, t: 44 },
  'components/voice-emr/VoiceSettingsPanel.tsx': { ko: 5, t: 23 },
  'components/voice-emr/DiarizationTest.tsx': { ko: 0, t: 22 },
};

/**
 * 의도적 미등재 키 — 화면이 부르지만 어느 카탈로그에도 없는 키(원문+초안 티로 나간다).
 * 🔴 **정확히 이 집합이어야 한다**: 늘면 새 미등재가 조용히 생긴 것이고, 줄면(누가 등재하면) 방침이 바뀐 것이라
 *    헤더와 이 목록을 함께 고친다. 각 키는 comp2/comp3 헤더에 사유와 함께 적혀 있어야 한다.
 */
const INTENTIONAL_UNREGISTERED = [
  // 급여명세 항목 표(LABEL) — 급여·근로 법정 어휘
  '기본급', '연장근로수당', '야간근로수당', '휴일근로수당', '직책수당', '상여금', '수당',
  '국민연금', '장기요양보험', '고용보험', '소득세', '지방소득세',
  // 귀속연도 문장(comp3) — `귀속` 은 법정 어휘
  '{연도}년 귀속',
  '⚠ 요청 {요청}년 · 응답 {응답}년 귀속 — 급여시스템이 다른 연도를 반환했습니다(인사팀 확인 필요)',
  // comp2 헤더가 이미 미등재로 둔 법정 어휘
  '원천징수영수증', '발급 전(연말정산 후 제공)', '부양가족 (인적공제)', '공제제외', '공제구분(선택)',
  '연차 잔여', '연차 잔여 정보 없음', '연차 부여 정보가 없어 잔여 검증 없이 접수됩니다',
].sort();

/**
 * 동적 키 표 — 화면이 `<T k={표[x]}>`/`tAttr(표값)` 로 부르는 값. 가능한 값 **전부**가 키다
 * (하나만 빠져도 그 상태에서 한국어가 남는다 — safety-text 가드 ② 와 같은 교훈).
 * `RELATIONS` 는 저장값이라 표시 키는 `RELATION_LABEL_KEY` 로 옮겨진 값이다(아래 `dynamicKeys`).
 */
const DYNAMIC_TABLES: Array<{ file: (typeof OWNED)[number]; name: string }> = [
  { file: 'app/(main)/ess/_components/PayslipSection.tsx', name: 'LABEL' },
  // STATUS_KO 는 2026-09-14 Q5 에 shared HR_REQUEST_STATUS_LABEL(StatusBadge hrRequest)로 옮겨 표가 없다.
  { file: 'app/(main)/ess/_components/AttendanceSelfServiceSection.tsx', name: 'OT_KO' },
  { file: 'app/(main)/ess/_components/PayrollBasicsSection.tsx', name: 'DOC_CATS' },
  { file: 'app/(main)/ess/_components/EssContent.tsx', name: 'CLOCK_METHOD_KO' },
  { file: 'app/(main)/ess/_components/EssContent.tsx', name: 'BALANCE_SOURCE_KO' },
  // 🔴 ERP 실패 사유 표 — shared 어휘 5종 전부의 문장. 하나라도 카탈로그에 없으면 그 사유는 한국어로 뜬다.
  { file: 'app/(main)/ess/_components/ErpFailureNote.tsx', name: 'ERP_FAILURE_TEXT' },
  { file: 'components/voice-emr/VoiceSettingsPanel.tsx', name: 'TABS' },
];

/**
 * comp3 키를 **부르기만 하는** 파일(파일 단위 기준선은 두지 않는다 — UNIT_SENTENCES 와 같은 취급).
 * 2026-09-23: 직원 대시보드 근무표가 ERP 실패를 `?? []`("근무 없음")로 접던 것을 ErpFailureNote 로 배선했다.
 */
const KEY_CONSUMERS = ['app/staff/dashboard/page.tsx'] as const;

/** `<Unit>` 주변 문장 뼈대 8곳 — 파일 전체가 아니라 **그 문장만** 본다 */
const UNIT_SENTENCES: Array<{ file: string; key: string; raw: RegExp }> = [
  { file: 'app/(main)/lab/components/InterfaceTab.tsx', key: '파싱된 결과 ({건수}건)', raw: /파싱된 결과\s*\(\s*\{/ },
  { file: 'app/(main)/lab/components/WorksheetTab.tsx', key: '검체 목록 ({건수}건)', raw: /검체 목록\s*\(\s*\{/ },
  { file: 'app/(main)/inventory/components/ItemsTab.tsx', key: '총 {개수}개 품목', raw: /총\s*\{\s*items\.length|<\/Unit>\s*품목/ },
  { file: 'app/(main)/inventory/components/ReceivingTab.tsx', key: '검수 대기 발주: {건수}건', raw: /검수 대기 발주:\s*\{/ },
  { file: 'app/(main)/inventory/page.tsx', key: '경고 {건수}건', raw: /경고\s*\{\s*alerts\.length/ },
  { file: 'app/(main)/telehealth/[sessionId]/_components/NurseChart.tsx', key: '바이탈 트렌드 (최근 {횟수}회)', raw: /최근\s*\{\s*trends\.length/ },
  { file: 'app/(main)/telehealth/[sessionId]/_components/PatientInfoPanel.tsx', key: '외 {건수}건', raw: />\s*외\s*\{/ },
  { file: 'app/(main)/surgery/components/SurgeryAdvanced.tsx', key: '현재 {점수}점', raw: /현재\s*\{\s*savedScore/ },
];

/* ── 계측 ─────────────────────────────────────────────────────────────────── */

/** 스캐너 규칙 ②(i18n 키 인자 제거)에 **보간 키**를 더한다 — 스캐너는 `<Tf k>`·`tfAttr(` 를 모른다(2026-09-11 실측). */
const stripTfKeys = (s: string) =>
  s
    .replace(/<Tf\s+k=(["'])(?:\\.|(?!\1)[\s\S])*?\1/g, '<Tf k=""')
    .replace(/<Tf\s+k=\{[^{}]*\}/g, '<Tf k={}')
    .replace(/tfAttr\(\s*(["'])(?:\\.|(?!\1)[\s\S])*?\1/g, 'tfAttr(');

/**
 * 한글 잔여 = 스캐너 규칙(`koFragments`) ∪ **식 옆 JSX 텍스트**.
 * 🔴 스캐너의 JSX 텍스트 규칙은 `>…<` 사이만 본다 — `<p>표본 {n}개는 …</p>` 처럼 **보간이 낀 문장은
 *    한 글자도 세지 않는다**(`>표본 ` 뒤가 `{`, `}개는 …` 앞이 `}`). §12-B 의 문장 뼈대가 스캐너에 안 잡힌 이유다.
 *    그래서 `[>}]…[<{]` 사이의 한글 텍스트(따옴표·백틱 없는 것 = 코드 리터럴이 아닌 것)를 덧댄다.
 */
function residual(src: string): string[] {
  const s = stripTfKeys(stripI18nKeys(src) as string);
  const out = new Set<string>(koFragments(s) as Set<string>);
  for (const m of s.matchAll(/[>}]([^<>{}'"`]*[가-힣][^<>{}'"`]*)[<{]/g)) {
    const t = m[1].trim();
    if (t) out.add(t);
  }
  return [...out].sort();
}
// 🔴 2026-09-12 — 스스로 번역하는 부품(EmptyState·Ratio)의 문자열 prop 도 배선이다(스캐너와 같은 규칙 · 계수기를 둘로 두면 갈라진다)
const tCount = (src: string) =>
  (src.match(/<T[\s>]/g) ?? []).length + (src.match(/tAttr\(/g) ?? []).length +
  (src.match(/<Tf[\s>]/g) ?? []).length + (src.match(/tfAttr\(/g) ?? []).length + countSelfTranslating(src);

const HAN = /[가-힣]/;
const unq = (s: string) => s.replace(/\\'/g, "'").replace(/\\"/g, '"');

/** 정적 키 — `<T k="…">` `<Tf k="…">` `tAttr('…')` `tfAttr('…', …)` + `<T k={조건 ? '가' : '나'}>` 의 리터럴 */
function staticKeys(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/<Tf?\s+k="((?:\\.|[^"\\])+)"/g)) out.add(unq(m[1]));
  for (const m of src.matchAll(/<Tf?\s+k='((?:\\.|[^'\\])+)'/g)) out.add(unq(m[1]));
  for (const m of src.matchAll(/\bt[f]?Attr\(\s*'((?:\\.|[^'\\])+)'/g)) out.add(unq(m[1]));
  for (const m of src.matchAll(/\bt[f]?Attr\(\s*"((?:\\.|[^"\\])+)"/g)) out.add(unq(m[1]));
  for (const m of src.matchAll(/<Tf?\s+k=\{([^{}]*)\}/g)) {
    for (const lit of m[1].matchAll(/'((?:\\.|[^'\\])+)'/g)) out.add(unq(lit[1]));
  }
  return [...out].filter((k) => HAN.test(k));
}

/** `const NAME … = …;` 선언 블록의 한국어 문자열 리터럴 */
function tableValues(src: string, name: string): string[] {
  const at = src.search(new RegExp(`const ${name}\\b`));
  if (at < 0) return [];
  const block = src.slice(at, src.indexOf(';', at));
  return [...block.matchAll(/'((?:\\.|[^'\\])+)'/g)].map((m) => unq(m[1])).filter((v) => HAN.test(v));
}

/** 동적 키 표 + `RELATIONS`(저장값) → 표시 키(`RELATION_LABEL_KEY` 로 옮긴 값) */
function dynamicKeys(): string[] {
  const out = new Set<string>();
  for (const { file, name } of DYNAMIC_TABLES) for (const v of tableValues(code(file), name)) out.add(v);
  const pb = code('app/(main)/ess/_components/PayrollBasicsSection.tsx');
  const map = new Map<string, string>();
  const mapBlock = pb.slice(pb.indexOf('const RELATION_LABEL_KEY'), pb.indexOf(';', pb.indexOf('const RELATION_LABEL_KEY')));
  for (const m of mapBlock.matchAll(/([가-힣]+):\s*'((?:\\.|[^'\\])+)'/g)) map.set(m[1], m[2]);
  for (const r of tableValues(pb, 'RELATIONS')) out.add(map.get(r) ?? r);
  return [...out];
}

/* ── 카탈로그(정본 = AREA_CATALOGS 등록 순서) ─────────────────────────────── */
const ORDER = AREA_CATALOGS.map((a) => a.area);
const COMP3_AT = ORDER.indexOf('comp3');
const has = (a: (typeof AREA_CATALOGS)[number], k: string) => Object.prototype.hasOwnProperty.call(a.c.en ?? {}, k);
const inAnyCatalog = (k: string) => AREA_CATALOGS.some((a) => has(a, k));
const COMP3_KEYS = Object.keys(COMP3_MESSAGES.en ?? {});
const PARAMS = (s: string) => [...s.matchAll(/\{([^{}\s]+)\}/g)].map((m) => m[1]).sort();

describe('🔴 §12-B 공용·ESS·음성 i18n 배선 (comp3)', () => {
  it('대조군 — 파일·카탈로그·계측이 실제로 대상을 읽는다(0 이 되면 통과가 무의미하다)', () => {
    for (const f of OWNED) expect(code(f).length, `읽지 못했다: ${f}`).toBeGreaterThan(1000);
    expect(COMP3_AT, 'AREA_CATALOGS 에 comp3 이 없다 — 팩 조립·검수 관제의 시야 밖이다').toBeGreaterThan(20);
    expect(ORDER.length, 'registry 파싱이 깨졌다').toBeGreaterThan(30);
    expect(COMP3_KEYS.length, 'comp3 표가 비었다').toBeGreaterThan(50);
    // 🔴 계측 대조군: 덧댄 규칙이 실제로 "보간 낀 생문장"을 잡는다(스캐너는 0 을 낸다)
    const probe = 'const X = () => <p>표본 {n}개는 기록일 뿐입니다</p>;';
    expect(koFragments(stripI18nKeys(probe)).size, '스캐너가 이 자리를 보기 시작했다 — residual() 덧댐을 재검토').toBe(0);
    expect(residual(probe).length).toBe(2);
    // 보간 키로 배선하면 잔여에서 빠진다
    expect(residual('const X = () => <p><Tf k="표본 {개수}개는 기록일 뿐입니다" params={{ 개수: n }} /></p>;')).toEqual([]);
  });

  it('(a) 파일별 한글 잔여가 기준선과 **정확히** 일치한다(여유 0 — 줄면 기준선을 낮춘다)', () => {
    const actual = Object.fromEntries(OWNED.map((f) => [f, residual(code(f)).length]));
    const expected = Object.fromEntries(OWNED.map((f) => [f, BASELINE[f].ko]));
    expect(actual, OWNED.map((f) => `${f}\n  ${residual(code(f)).join(' | ')}`).join('\n')).toEqual(expected);
  });

  it('(b) 파일마다 <T>/tAttr/<Tf>/tfAttr 배선이 기준선 이상이다', () => {
    for (const f of OWNED) expect(tCount(code(f)), `${f} 배선이 줄었다`).toBeGreaterThanOrEqual(BASELINE[f].t);
  });

  it('(c) 부르는 한국어 키가 카탈로그에 있다 — 없는 것은 의도적 미등재 목록과 **정확히** 같다', () => {
    const used = new Set<string>();
    for (const f of OWNED) for (const k of staticKeys(code(f))) used.add(k);
    expect(used.size, '정적 키 추출이 깨졌다(조용히 0건 통과한다)').toBeGreaterThan(150);
    const dyn = dynamicKeys();
    expect(dyn.length, '동적 키 표 추출이 깨졌다').toBeGreaterThan(30);
    for (const k of dyn) used.add(k);
    const missing = [...used].filter((k) => !inAnyCatalog(k)).sort();
    expect(missing, `미등록 키(원문+티로 나간다) — 의도적 미등재가 아니면 등재하라:\n${missing.join('\n')}`).toEqual(INTENTIONAL_UNREGISTERED);
    // 의도적 미등재 주장은 헤더에 적혀 있어야 검증 가능하다
    const heads = ['comp2.ts', 'comp3.ts'].map((f) => { const s = read(join(MSG, f)); return s.slice(0, s.indexOf('*/')); }).join('\n');
    const undeclared = INTENTIONAL_UNREGISTERED.filter((k) => !heads.includes(k) && !heads.includes(`'${k}'`));
    expect(undeclared, `헤더에 사유 없이 빠진 키:\n${undeclared.join('\n')}`).toEqual([]);
  });

  it('🔴 (d) 죽은 키 0 — 앞서 등록된 카탈로그가 이미 가진 원문을 comp3 가 다시 정의하지 않는다', () => {
    const earlier = AREA_CATALOGS.slice(0, COMP3_AT);
    const dead = COMP3_KEYS
      .filter((k) => earlier.some((a) => has(a, k)))
      .map((k) => `${k} ← ${earlier.filter((a) => has(a, k)).map((a) => a.area).join(',')}`)
      .sort();
    expect(dead, `죽은 키(앞 카탈로그가 이긴다 — 여기서 지운다):\n${dead.join('\n')}`).toEqual([]);
  });

  it('🔴 (e) 고아 키 0 — comp3 키 **전체**가 소유 소스(주석 제거)에 리터럴로 있다', () => {
    const src = [...OWNED, ...KEY_CONSUMERS, ...UNIT_SENTENCES.map((u) => u.file)].map(code).join('\n');
    // `@` 로 시작하는 키 등 원문부가 비는 키도 걸린다(§12-F: bare='' 이면 includes('') 가 늘 참이던 허점)
    const orphan = COMP3_KEYS.filter((k) => !k.split('@')[0] || !src.includes(k)).sort();
    expect(orphan, `소유 소스에 없는 키:\n${orphan.join('\n')}`).toEqual([]);
  });

  it('(f) 세 언어 키 집합이 같고 빈 값이 없으며 자리표시자가 보존된다', () => {
    const langs = ['en', 'ja', 'ar'] as const;
    for (const l of langs) expect(Object.keys(COMP3_MESSAGES[l] ?? {}).sort(), `${l} 키 집합이 다르다`).toEqual([...COMP3_KEYS].sort());
    const bad: string[] = [];
    for (const k of COMP3_KEYS) {
      for (const l of langs) {
        const v = COMP3_MESSAGES[l]?.[k] ?? '';
        if (!v.trim()) bad.push(`${l} 빈 값: ${k}`);
        else if (PARAMS(v).join(',') !== PARAMS(k).join(',')) bad.push(`${l} 자리표시자 불일치: ${k} → ${v}`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('🔴 (g) 근태 정정·초과근무 — 성공과 실패 메시지가 **둘 다** i18n 을 지난다', () => {
    const s = code('app/(main)/ess/_components/AttendanceSelfServiceSection.tsx');
    // setMsg( … ) 인자를 괄호 짝으로 떼어 낸다
    const args: string[] = [];
    for (let i = s.indexOf('setMsg('); i >= 0; i = s.indexOf('setMsg(', i + 1)) {
      let depth = 0, j = i + 'setMsg'.length;
      for (; j < s.length; j++) { if (s[j] === '(') depth++; else if (s[j] === ')' && --depth === 0) break; }
      args.push(s.slice(i + 'setMsg('.length, j));
    }
    expect(args.length, 'setMsg 호출 추출이 깨졌다').toBeGreaterThanOrEqual(6);
    const raw = args.filter((a) => residual(a).length > 0);
    expect(raw, `생한글로 조립된 메시지(한 언어만 번역된다):\n${raw.join('\n---\n')}`).toEqual([]);
    // 성공·실패 양쪽 키가 실제로 배선돼 있다(추출이 비어 통과하는 것을 막는다)
    for (const k of ['정정 결재 상신 완료', '정정 결재 상신 완료 — 결재자: {결재자}', '초과근무 {시간}h 상신 완료{경고}', '초과근무 {시간}h 상신 완료{경고} — 결재자: {결재자}', '정정이 자동 승인되었습니다(데모)', '신청 실패']) {
      expect(args.some((a) => a.includes(`'${k}'`)), `메시지 키가 setMsg 경로에 없다: ${k}`).toBe(true);
      expect(inAnyCatalog(k), `카탈로그에 없다: ${k}`).toBe(true);
    }
  });

  it('(h) <Unit> 주변 문장 뼈대 8곳 — 보간 키로 배선됐고 생한글 뼈대가 돌아오지 않는다', () => {
    expect(UNIT_SENTENCES.length).toBe(8);
    for (const u of UNIT_SENTENCES) {
      const s = code(u.file);
      expect(s, `${u.file} 보간 키가 없다: ${u.key}`).toContain(`<Tf k="${u.key}"`);
      expect(inAnyCatalog(u.key), `카탈로그에 없다: ${u.key}`).toBe(true);
      // 키 인자를 지운 뒤에도 문장 뼈대가 생 JSX 텍스트로 남아 있으면 되돌아간 것이다
      const bare = stripTfKeys(stripI18nKeys(s) as string);
      expect(u.raw.test(bare), `${u.file} 생한글 문장 뼈대가 남았다(${u.raw})`).toBe(false);
    }
  });

  it('🔴 (i) SpeakerEnrollment 조회 함수가 렌더마다 바뀌지 않는다(무한 조회 회귀 차단)', () => {
    const s = code('components/voice-emr/SpeakerEnrollment.tsx');
    const at = s.indexOf('const load = useCallback(');
    expect(at, 'load 선언을 찾지 못했다 — 이 검사의 전제가 깨졌다').toBeGreaterThan(0);
    const deps = s.slice(at).match(/\},\s*\[([^\]]*)\]\);/);
    expect(deps, 'load 의존성 배열을 찾지 못했다').toBeTruthy();
    expect(deps![1], 'load 의존성에 렌더마다 새로 만들어지는 번역 함수가 들어갔다').not.toMatch(/\bt[f]?Attr\b/);
    expect(s).toMatch(/useEffect\(\(\) => \{ void load\(\); \}, \[load\]\)/);
  });

  it('전량 AI_DRAFT — 사람 검수(VERIFIED)를 코드가 임의로 선언하지 않는다', () => {
    expect(read(join(MSG, 'comp3.ts'))).toMatch(/COMP3_VERIFIED: ReadonlySet<string> = new Set\(\)/);
  });

  it('🔴 카탈로그 헤더가 "무엇을 왜 뺐는지"를 적었다(제외 주장은 검증 가능해야 한다)', () => {
    const src = read(join(MSG, 'comp3.ts'));
    const head = src.slice(0, src.indexOf('*/') + 2);
    expect(head).toMatch(/의도적\s*미등재/);
    expect(head, '중복 회피 실측을 적지 않았다').toMatch(/중복이라 등재하지 않았다/);
    expect(head, '저장값 제외 사유를 적지 않았다').toMatch(/저장값·전송값이라 등재하지 않았다/);
    expect(head, '사람 검수 대상을 적지 않았다').toMatch(/사람 검수 대상/);
  });
});
