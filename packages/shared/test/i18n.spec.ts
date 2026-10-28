import { describe, it, expect } from 'vitest';
import { tOf, t, registerCatalog, activeLocaleCodes, localeDirOf, isActiveLocale, CATALOG_LOCALES, DEFERRED_LOCALES } from '../src';
import { AREA_CATALOGS } from '../src/i18n/messages/registry';
import { COMMON_MESSAGES } from '../src/i18n/messages/common';
import { NAV_MESSAGES } from '../src/i18n/messages/nav';
import { STATUS_MESSAGES } from '../src/i18n/messages/status';
import { OUTPATIENT_MESSAGES } from '../src/i18n/messages/outpatient';
import { CHART_MESSAGES } from '../src/i18n/messages/chart';
import { NURSING_MESSAGES } from '../src/i18n/messages/nursing';
import { PHARMLAB_MESSAGES } from '../src/i18n/messages/pharmlab';
import { SURGERYER_MESSAGES } from '../src/i18n/messages/surgeryer';
import { BILLING_MESSAGES } from '../src/i18n/messages/billing';
import { ADMINOPS_MESSAGES } from '../src/i18n/messages/adminops';
import { WSPORTAL_MESSAGES } from '../src/i18n/messages/wsportal';

/**
 * UI 크롬 언어 t() 가드 — 기획 ui-locale-i18n.plan.md §5.
 * 🔴 조용한 폴백 금지가 핵심 계약: 미등록 키는 한국어 원문 + missing=true.
 *    (포털 CATALOG 가 미번역을 조용히 한국어로 반환해 누락이 영원히 안 보였던 함정의 재발 방지.)
 */
describe('UI 로케일 정본', () => {
  it('선택지는 팩이 정한다 — 아랍어는 보류라 선택 불가(2026-09-07 결정)', () => {
    const codes = activeLocaleCodes();
    expect(codes).toContain('ko');   // 원문(팩 없음)
    expect(codes).toContain('en');
    expect(codes).toContain('ja');
    expect(localeDirOf('ja')).toBe('ltr');
    expect(isActiveLocale('ar')).toBe(false); // 보류 팩은 선택·저장 모두 거부
    expect(isActiveLocale('없는코드')).toBe(false);
  });

  it('🔴 아랍어 카탈로그 자산은 보존된다 — 별도 트랙(§8)의 재사용 자산이라 지우지 않는다', () => {
    expect(CATALOG_LOCALES).toContain('ar');
    expect(DEFERRED_LOCALES).toEqual(['ar']);
    // 실제 데이터가 남아 있는지(스텁으로 비면 자산 소실)
    expect(Object.keys(COMMON_MESSAGES.ar ?? {}).length).toBeGreaterThan(0);
  });
});

describe('t()/tOf — 조용한 폴백 금지', () => {
  it('등록 키는 번역 + missing=false (검수 전이면 draft=true — AI_DRAFT 3상태)', () => {
    expect(tOf('저장', 'en')).toEqual({ text: 'Save', missing: false, draft: true });
    expect(tOf('저장', 'ja')).toEqual({ text: '保存', missing: false, draft: true });
    expect(tOf('저장', 'ar').missing).toBe(false);
  });

  it('🔴 미등록 키는 한국어 원문 + missing=true — 조용히 한국어를 돌려주지 않는다', () => {
    const r = tOf('이런 키는 없다 12345', 'en');
    expect(r.text).toBe('이런 키는 없다 12345');
    expect(r.missing).toBe(true);
  });

  it('ko 는 원문이 정본 — 카탈로그 없이 missing=false·draft=false', () => {
    expect(tOf('아무 원문', 'ko')).toEqual({ text: '아무 원문', missing: false, draft: false });
  });

  it('verified 집합에 든 키만 draft=false — 검수는 명시 행위다', () => {
    registerCatalog({ en: { '검수된키@test': 'verified-probe' } }, new Set(['검수된키@test']));
    expect(tOf('검수된키@test', 'en')).toEqual({ text: 'verified-probe', missing: false, draft: false });
  });

  it('동음이의 `원문@문맥` — @ 뒤는 표시에서 제거된다(ko·미등록 양쪽)', () => {
    // 🔴 표본 키는 실카탈로그가 절대 등재하지 않을 값으로 — '접수@원무'를 쓰다가
    //    P2 에이전트가 실제로 등재해 미등록 계약 검사가 깨졌다(2026-09-07 실측)
    expect(t('접수@spec전용미등록표본', 'ko')).toBe('접수');
    const r = tOf('접수@spec전용미등록표본', 'ja');
    expect(r.text).toBe('접수');
    expect(r.missing).toBe(true);
  });

  it('registerCatalog 로 영역 카탈로그가 추가된다(P1/P2 확장 계약)', () => {
    registerCatalog({ en: { '가드검증용키@test': 'guard-probe' } });
    expect(tOf('가드검증용키@test', 'en')).toEqual({ text: 'guard-probe', missing: false, draft: true });
  });

  it('영역 카탈로그(nav·status) — 세 언어 키 집합 동일 + 빈 값 0(재주입 실측: en 만 조용히 비는 회귀)', () => {
    // P1 지렛대 2 + P2 영역 8 — 어느 영역이든 한 언어만 비면 미번역 티가 갈라진다
    // 🔴 **정본에서 파생한다 — 베껴 적지 않는다.** 종전엔 여기 11종을 수기로 나열했고,
    //    P2b·P2c 가 10종을 더 추가하자 **이 가드가 그 10종을 아예 보지 않았다**
    //    (chart2·admin2·admin3·components2·ws2·portal2·checkup·crm2·ws3·admin4).
    //    P2c-1 이 이 공백을 발견해 주석으로 남겼고(조용히 통과시키지 않았다), 여기서 해소한다.
    //    교차 충돌 가드도 같은 이유로 이미 `AREA_CATALOGS` 파생으로 바뀌었다 — **수기 목록은 낡는다.**
    //
    // 🔴 하한을 영역별로 못 갈라서 파생이 막혀 있었다. 하한이 겨누는 것은 "스텁으로 되돌지 않았나"이고,
    //    그건 **영역마다 다른 수**가 아니라 **합계**로 봐야 한다(portal2·common 은 원래 소형이다).
    //    영역별로는 "비어 있지 않다"만 보고, 규모 회귀는 합계로 잡는다.
    const AREAS: [string, typeof NAV_MESSAGES][] =
      AREA_CATALOGS.map((a) => [a.area, a.c as typeof NAV_MESSAGES]);
    // 🔴 영역마다 즉시 단언하면 **첫 실패에서 루프가 죽어 그 뒤 영역은 아예 검사되지 않는다.**
    //    2026-09-09 라운드에서 실제로 그랬다: 빈 스텁 하나 때문에 뒤의 clinical4·comp1·comp2 가
    //    "통과"도 "실패"도 아닌 **미검사** 상태였는데 화면에는 실패 1건으로만 보였다.
    //    전 영역을 모아 한 번에 단언한다 — 검사되지 않은 영역이 생기지 않게.
    const problems: string[] = [];
    for (const [name, cat] of AREAS) {
      const en = Object.keys(cat.en ?? {}).sort();
      const ja = Object.keys(cat.ja ?? {}).sort();
      const ar = Object.keys(cat.ar ?? {}).sort();
      if (en.length === 0) { problems.push(`${name}: 비었다 — 스텁으로 되돌았나`); continue; }
      if (JSON.stringify(ja) !== JSON.stringify(en)) {
        const onlyEn = en.filter((k) => !ja.includes(k));
        const onlyJa = ja.filter((k) => !en.includes(k));
        problems.push(`${name}: ja 키집합 불일치(en 에만 ${onlyEn.length}·ja 에만 ${onlyJa.length}) ${JSON.stringify([...onlyEn, ...onlyJa].slice(0, 3))}`);
      }
      // 🔴 ar 은 **부분집합이면 정상**이다 — DEFERRED 자산이라 새 화면 키가 없을 수 있다
      //    (i18n-pack.spec 이 같은 기준을 쓴다. 두 가드가 다른 기준을 쓰면 하나는 반드시 거짓말한다).
      //    다만 **고아 키**(코어에 없는 ar 키)는 자산이 아니라 오염이므로 잡는다.
      const enSet = new Set(en);
      const orphan = ar.filter((k) => !enSet.has(k));
      if (orphan.length) problems.push(`${name}: ar 고아 키 ${orphan.length} ${JSON.stringify(orphan.slice(0, 3))}`);
      for (const lang of ['en', 'ja', 'ar'] as const) {
        const empty = Object.entries(cat[lang] ?? {}).filter(([, v]) => !v || !String(v).trim()).map(([k]) => k);
        if (empty.length) problems.push(`${name}/${lang}: 빈 값 ${empty.length} ${JSON.stringify(empty.slice(0, 3))}`);
      }
    }
    expect(problems, `영역 카탈로그 무결성 — 전 ${AREAS.length}영역 검사(첫 실패에서 멈추지 않는다)`).toEqual([]);
    // 규모 회귀는 합계로 잡는다(영역별 하한이 파생을 막던 자리 — 위 주석)
    const total = AREAS.reduce((n, [, c]) => n + Object.keys(c.en ?? {}).length, 0);
    expect(total, '전체 등재 규모가 줄었다 — 스텁 회귀 의심').toBeGreaterThan(4000);
  });

  it('공통 카탈로그 키 집합이 세 언어에서 일치한다(한 언어만 빠지면 미번역 티가 갈라진다)', () => {
    const en = Object.keys(COMMON_MESSAGES.en ?? {}).sort();
    const ja = Object.keys(COMMON_MESSAGES.ja ?? {}).sort();
    const ar = Object.keys(COMMON_MESSAGES.ar ?? {}).sort();
    expect(en.length).toBeGreaterThan(0);
    expect(ja).toEqual(en);
    expect(ar).toEqual(en);
  });
});
