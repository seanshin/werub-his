import { describe, it, expect } from 'vitest';
import {
  allLocalePacks, activeLocalePacks, getLocalePack, packLookup, packCoverage,
  registerLocalePack, tOf, activeLocaleCodes, DEFERRED_LOCALES, CATALOG_LOCALES,
} from '../src';
import { COMMON_MESSAGES } from '../src/i18n/messages/common';

/**
 * 언어 팩 구조 가드 — "새 언어를 파일 하나로 추가한다"가 실제로 성립하는지.
 *
 * 🔴 조립 누락은 조용하다: 영역 카탈로그를 팩으로 합칠 때 한 영역을 빠뜨려도 화면은
 *    그 키를 다른 경로(빌트인 카탈로그)로 찾아내 **아무 증상이 없다**. 팩만 보는
 *    소비처(검수 관제·외부 조회)에서만 구멍이 난다 — 실제로 common 65키가 그렇게
 *    빠졌다(2026-09-07 조립 실측). 그래서 **팩 단독 조회**로 검사한다.
 */
describe('언어 팩 — 빌트인 조립', () => {
  it('활성 팩이 곧 선택지다 — ko(원문) + ACTIVE 팩', () => {
    const active = activeLocalePacks().map((p) => p.code).sort();
    const codes = activeLocaleCodes().filter((c) => c !== 'ko').sort();
    expect(codes).toEqual(active);
    expect(activeLocaleCodes()).toContain('ko'); // 원문은 팩 없이 항상 선택 가능
  });

  it('보류 언어는 팩으로 남아 있다 — 자산 보존(선택지 밖 ≠ 삭제)', () => {
    for (const code of DEFERRED_LOCALES) {
      const p = getLocalePack(code);
      expect(p, `${code} 팩이 사라졌다`).toBeTruthy();
      expect(p!.status).toBe('DEFERRED');
      expect(Object.keys(p!.messages).length).toBeGreaterThan(100);
      expect(p!.note, '보류 사유를 적는다(지어내지 않고 사실을)').toBeTruthy();
    }
  });

  it('🔴 팩 단독 조회로 공통 어휘가 나온다 — 조립 누락 검출(common 실측 회수)', () => {
    const sample = Object.keys(COMMON_MESSAGES.en ?? {})[0];
    expect(sample).toBeTruthy();
    // 🔴 팩마다 expect 를 걸면 **첫 팩에서 멈춘다** — 아래 '전 팩을 모아서 한 번에' 주석 참조.
    const missing = allLocalePacks().filter((p) => !packLookup(p.code, sample)).map((p) => p.code);
    expect(missing, `common 키 '${sample}' 가 없는 팩`).toEqual([]);
  });

  it('빌트인 **활성** 팩(en/ja)의 키 집합이 같다 — 조립 누락 검출', () => {
    // 🔴 조준 두 번 교정한 자리다.
    //    ① 전 팩 동수 → 신규 언어 팩(부분 번역이 정상)이 들어오는 순간 거짓 실패 → 빌트인으로 좁힘.
    //    ② 빌트인 3종 동수 → **보류 언어(ar)에 신규 키가 없는 것이 정상**인데 실패했다
    //       (2026-09-07 P2b: 새 영역 카탈로그에 en/ja 만 넣자 ar 만 작아져 실패).
    //       ar 은 DEFERRED 자산이라 새 화면 키가 없을 수 있다 — **부분집합이면 정상**이다.
    const en = getLocalePack('en')!;
    const ja = getLocalePack('ja')!;
    expect(en, '빌트인 en 팩이 없다 — 조립이 안 돌았다').toBeTruthy();
    expect(ja, '빌트인 ja 팩이 없다').toBeTruthy();
    expect(Object.keys(ja.messages).sort(), 'en/ja 키 집합 불일치 — 영역 조립 누락').toEqual(Object.keys(en.messages).sort());
  });

  it('보류 팩(ar)은 활성 키의 부분집합이고 자산 규모가 유지된다', () => {
    const en = getLocalePack('en')!;
    const ar = getLocalePack('ar')!;
    const enKeys = new Set(Object.keys(en.messages));
    const orphan = Object.keys(ar.messages).filter((k) => !enKeys.has(k));
    expect(orphan, 'ar 에만 있는 키 — 활성 언어에 없는 자산은 고아다').toEqual([]);
    expect(Object.keys(ar.messages).length, 'ar 자산이 소실됐다(§8 보존 규약)').toBeGreaterThan(1000);
  });

  /**
   * 🔴 **전 팩을 모아서 한 번에 실패한다 — 앞 팩에서 멈추지 않는다**(2026-09-07 코어 어휘 라운드).
   *
   * 종전에는 `for (const p of extra) { expect(...) }` 였다. vitest 의 expect 는 **첫 실패에서 던지므로**
   * 알파벳순 앞 팩(kk)이 깨져 있으면 뒤 팩(mn·ru·th·vi·zh)은 **검사조차 되지 않는다**.
   * 실제 피해: ru·kk·mn 담당과 zh·th 담당이 **각각** 자기 팩의 결함을 이 가드로 볼 수 없어
   * 임시 스펙을 따로 만들어야 했다. "N건 고쳤다 → 다시 돌리니 또 실패" 를 팩 수만큼 반복하게 된다.
   *
   * 그래서 세 검사(빈 값·지어낸 키·규모)를 **팩별로 다 돌려 모은 뒤 한 번만** expect 한다.
   * 검사 종류끼리도 갈라 놓지 않는다 — 빈 값에서 던지면 지어낸 키는 또 안 보인다.
   */
  it('추가 언어 팩은 부분 번역이 정상 — 다만 빈 값 0·코어 키만(지어낸 키 금지) · 전 팩 일괄 보고', () => {
    const builtinCodes = new Set<string>(CATALOG_LOCALES);
    const extra = allLocalePacks().filter((p) => !builtinCodes.has(p.code) && !p.code.startsWith('xx-'));
    const coreKeys = new Set(Object.keys(getLocalePack('en')!.messages));
    const show = (ks: string[]) => (ks.length > 6 ? `${ks.slice(0, 6).join(', ')} … 외 ${ks.length - 6}` : ks.join(', '));
    const problems: string[] = [];
    for (const p of extra) {
      const empty = Object.entries(p.messages).filter(([, v]) => !v || !String(v).trim()).map(([k]) => k);
      if (empty.length) problems.push(`${p.code}: 빈 값 ${empty.length}키 — ${show(empty)}`);
      const unknown = Object.keys(p.messages).filter((k) => !coreKeys.has(k));
      if (unknown.length) problems.push(`${p.code}: 코어에 없는 키(지어낸 키) ${unknown.length} — ${show(unknown)}`);
      const size = Object.keys(p.messages).length;
      if (size <= 50) problems.push(`${p.code}: 사실상 빈 팩(${size}키 ≤ 50)`);
    }
    // 🔴 대조군 — 검사할 팩이 0 이면 이 가드는 아무것도 보증하지 않는다(항상 통과하는 초록)
    expect(extra.length, '추가 언어 팩이 하나도 없다 — 이 가드의 표본이 사라졌다').toBeGreaterThan(0);
    expect(problems, `팩 결함(전 팩 일괄):\n${problems.join('\n')}`).toEqual([]);
  });

  it('커버리지는 분모를 준다 — 전량 미검수면 verified 0 을 그대로 말한다', () => {
    const cov = packCoverage('en')!;
    expect(cov.total).toBeGreaterThan(1000);
    expect(cov.verified + cov.draft).toBe(cov.total);
  });
});

describe('언어 팩 — 확장(새 언어 추가 경로)', () => {
  it('팩 하나를 등록하면 t() 가 즉시 그 언어를 본다(영역 파일 수정 0)', () => {
    registerLocalePack({
      code: 'xx-test', label: 'Test', dir: 'ltr', tag: 'en-US', status: 'DEFERRED',
      messages: { '팩테스트키@spec': 'pack-hit' }, verified: new Set(['팩테스트키@spec']),
      note: '가드 전용',
    });
    expect(tOf('팩테스트키@spec', 'xx-test')).toEqual({ text: 'pack-hit', missing: false, draft: false });
    // 미등록 키는 여전히 원문 + missing(조용한 폴백 금지 — 팩에서도 같다)
    expect(tOf('없는키@spec전용미등록표본', 'xx-test').missing).toBe(true);
  });

  it('같은 코드로 다시 등록하면 병합된다(확장 팩·부분 보정)', () => {
    registerLocalePack({
      code: 'xx-test', label: 'Test', dir: 'ltr', tag: 'en-US', status: 'DEFERRED',
      messages: { '추가키@spec': 'added' }, note: '확장',
    });
    expect(packLookup('xx-test', '팩테스트키@spec')?.text).toBe('pack-hit'); // 기존 유지
    expect(packLookup('xx-test', '추가키@spec')?.text).toBe('added');       // 신규 병합
  });

  it('🔴 팩을 넣는다고 선택지에 뜨지 않는다 — ACTIVE 여야 한다(반쪽 언어 노출 금지)', () => {
    expect(activeLocalePacks().map((p) => p.code)).not.toContain('xx-test');
  });
});
