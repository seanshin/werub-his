import { describe, it, expect } from 'vitest';
import {
  localeCoverage, activeLocaleCoverage, COVERAGE_CORE_LOCALE,
  getLocalePack, activeLocaleCodes, registerLocalePack, packCoverage,
  packContextGaps, allLocalePacks,
} from '../src';

/**
 * 커버리지 정직성 가드 — "이 언어는 몇 %만 번역됐는가"를 **분모와 함께** 말하는지.
 *
 * 🔴 이 가드가 생긴 이유(2026-09-07 실측):
 *    추가 언어 팩 6종(zh·ru·vi·kk·mn·th)이 코어 6,175키 중 **약 550~730키(9~12%)** 만 가진 채
 *    전부 `status: 'ACTIVE'` 였다. 그 언어를 고른 사용자는 화면의 대부분을 한국어 원문+티로 본다.
 *    `packCoverage()` 는 **있었지만** 소비처가 이 test 디렉터리 한 곳뿐이었다 —
 *    만든 것과 소비처가 쓰는 것은 다른 일이다(§2 정본). 화면 어디에도 그 사실이 없었다.
 *
 * 🔴 이 가드는 **막지 않는다.** 9% 언어를 ACTIVE 로 둘 것인가는 사람 결정거리다.
 *    여기서 지키는 것은 "고르는 자리에서 그 사실이 보이는가" 하나다.
 */
describe('언어 커버리지 — 분모 병기', () => {
  it('🔴 커버리지는 분모(코어 전집)를 함께 준다 — 비율만 주지 않는다', () => {
    const core = getLocalePack(COVERAGE_CORE_LOCALE)!;
    const coreTotal = Object.keys(core.messages).filter((k) => core.messages[k]).length;
    expect(coreTotal, '코어 팩이 비었다 — 분모가 없으면 커버리지는 산출 불가다').toBeGreaterThan(1000);

    for (const c of activeLocaleCoverage()) {
      expect(c.coreTotal, `${c.code} 분모 누락`).toBe(coreTotal);
      expect(c.unavailable, `${c.code} 분모가 있는데 산출 불가로 말한다`).toBe(false);
      expect(c.translated).toBeLessThanOrEqual(c.coreTotal);
    }
  });

  it('ko 는 0/N 이 아니다 — 원문이 곧 정본이라 미번역이라는 상태가 없다', () => {
    const ko = localeCoverage('ko')!;
    expect(ko.complete, 'ko 를 부분 번역으로 그리면 "한국어가 미번역"이라는 거짓말이 된다').toBe(true);
    expect(ko.translated).toBe(ko.coreTotal);
  });

  it('미등록 코드는 null — 0 으로 지어내지 않는다(모르는 것과 0은 다른 사실)', () => {
    expect(localeCoverage('zz-nonexistent')).toBeNull();
  });

  it('🔴 코어 자신은 complete · 추가 팩은 부분 번역을 부분 번역이라 말한다', () => {
    expect(localeCoverage(COVERAGE_CORE_LOCALE)!.complete).toBe(true);
    const extras = activeLocaleCoverage().filter(
      (c) => c.code !== 'ko' && c.code !== COVERAGE_CORE_LOCALE && c.code !== 'ja',
    );
    expect(extras.length, '추가 언어 팩이 하나도 없다 — 이 가드의 표본이 사라졌다').toBeGreaterThan(0);
    for (const c of extras) {
      // 부분 번역인 팩은 반드시 complete=false 여야 한다(완역인 척하지 않는다)
      if (c.translated < c.coreTotal) expect(c.complete, `${c.code} 가 완역인 척한다`).toBe(false);
    }
  });

  it('검수 수는 등재 수를 넘지 않는다 — 전량 AI 초안이면 0 을 그대로 말한다', () => {
    for (const c of activeLocaleCoverage()) {
      if (c.code === 'ko') continue;
      expect(c.verified).toBeLessThanOrEqual(c.translated);
      expect(c.verified).toBe(packCoverage(c.code)!.verified);
    }
  });

  it('선택지에 있는 코드는 전부 커버리지를 낼 수 있다 — 목록에 있는데 산출 불가인 언어는 없다', () => {
    for (const code of activeLocaleCodes()) {
      expect(localeCoverage(code), `${code} 는 선택지에 있는데 커버리지가 null 이다`).not.toBeNull();
    }
  });

  it('🔴 재주입 — 1키짜리 팩을 ACTIVE 로 넣으면 1/N 로 드러난다(완역으로 흡수되지 않는다)', () => {
    registerLocalePack({
      code: 'xx-coverage', label: 'Coverage Probe', dir: 'ltr', tag: 'en-US', status: 'ACTIVE',
      messages: { '저장': 'probe' }, note: '가드 전용 — 커버리지 표본',
    });
    const c = localeCoverage('xx-coverage')!;
    expect(c.translated).toBe(1);
    expect(c.coreTotal).toBeGreaterThan(1000);
    expect(c.complete).toBe(false);
    // 선택지 목록에도 그 사실이 실려 나간다(화면이 분모를 그릴 재료를 받는다)
    const inList = activeLocaleCoverage().find((x) => x.code === 'xx-coverage')!;
    expect(inList.translated).toBe(1);
    expect(inList.coreTotal).toBe(c.coreTotal);
  });
});

/**
 * 🔴 vi 팩 — 문맥 키 회수 검증(2026-09-07).
 *    코어는 동음이의를 `원문@문맥` 으로 가르는데 팩이 무문맥 원문만 가지면 그 자리들은
 *    전부 한국어 원문+티가 된다(회수 전 실측 63자리). 그 재발을 막는다.
 */
describe('vi 팩 — 문맥 키가 무문맥 원문에 흡수되지 않는다', () => {
  const ctxKeysOfCore = () =>
    Object.keys(getLocalePack(COVERAGE_CORE_LOCALE)!.messages).filter((k) => k.lastIndexOf('@') > 0);

  it('🔴 행위형과 상태형을 갈라 둔다 — 투약(Administered) ≠ 투약@행위(Administer)', () => {
    const vi = getLocalePack('vi')!;
    expect(vi.messages['투약']).toBeTruthy();
    expect(vi.messages['투약@행위']).toBeTruthy();
    expect(
      vi.messages['투약@행위'],
      '투약 행위 버튼이 "이미 투약함"으로 읽히면 안 된다(무문맥 값 복사 금지)',
    ).not.toBe(vi.messages['투약']);
  });

  it('vi 가 가진 무문맥 키의 문맥 변형이 코어에 있으면 그 문맥 키도 갖는다(잔여는 명시 제외분만)', () => {
    const vi = getLocalePack('vi')!;
    const base = (k: string) => k.slice(0, k.lastIndexOf('@'));
    const dead = ctxKeysOfCore().filter((k) => !vi.messages[k] && vi.messages[base(k)]);
    // 🔴 `일반@마약류` 는 베트남 약사법 용어를 확인하지 못해 **일부러** 뺐다(원문+티가 정직하다).
    //    여기 다른 키가 늘면 = 문맥으로 갈리며 죽은 자리가 다시 생긴 것이다.
    expect(dead).toEqual(['일반@마약류']);
  });
});

/**
 * 🔴 **전 팩 문맥 결손** — 한 언어만 보던 검사를 등재된 모든 팩으로 넓힌다(2026-09-09).
 *
 * 이 자리는 "번역이 없다"가 아니라 **뜻이 틀린 번역이 나가는 자리**다: 팩이 무문맥 `이탈`(활력
 * 'Out of limit')만 가지고 `이탈@CRM`(고객 이탈)이 없으면 CRM 화면이 활력징후 문구를 보여준다.
 * 2026-09-09 라운드에서 문맥 키가 늘자 zh·th 17, ru·kk·mn 13, ar 15 자리가 그렇게 됐고
 * **사람이 손으로 찾아 보고했다** — 팩이 늘수록 손으로는 못 찾는다. 정본 파생으로 못박는다.
 *
 * 🔴 이 가드는 **번역을 강요하지 않는다.** 확인할 수 없는 언어의 어휘를 지어내는 것이 더 나쁘다
 *    (vi 의 `일반@마약류` 선례). 몇 자리가 그 상태인지를 동결해, 새 문맥 키를 만들면서 팩을
 *    그냥 두는 일이 조용히 늘지 않게 한다. 늘었으면 팩을 채우거나 사유와 함께 이 수를 올린다.
 */
describe('🔴 전 팩 — 문맥 키 결손(뜻이 틀린 번역이 나가는 자리)', () => {
  /**
   * 2026-09-09 회수 후 실측. 줄이면 낮추고, 늘면 실패한다(여유를 두지 않는다).
   *
   * 🔴 en·ja 는 코어 조립본이라 0 이어야 한다 — 여기 0 이 아니면 조립이 깨진 것이다(대조군 역할).
   * 🔴 **0 이 아닌 수는 전부 "못 채운 것"이 아니라 "채우지 않기로 한 것"이다.** 사유 없이 이 수를
   *    올리면 이 가드는 죽는다. 잔여 키와 사유(각 팩 파일 헤더 주석에 같은 내용이 있다):
   *
   *    · ar 15 — DEFERRED 자산이라 설계상 부분집합이다(§8 아랍어 결정). 이번 회수 대상 아님.
   *    · zh 2 · th 2 — `판정@검사`(en Flag ↔ ja 判定 — 정본이 어긋나 어느 쪽을 따라도 근거가 없고,
   *      검사 결과 플래그라 틀리면 위급값 판독을 오도한다) · `재실@체류시간`(en Time in PACU —
   *      회복실 체류시간 어휘 대응어 미확인). 둘 다 2026-09-07 라운드의 제외 판단을 승계한다.
   *    · ru 3 — `병상@단위`·`항목@개수`·`회@단위`. 러시아어는 수사에 따라 коек/койки/койка 로
   *      형태가 갈리는데 이 자리는 `{수}{접미}` 로 이어붙는 고정 문자열이라 한 형태를 박으면
   *      대부분의 수에서 틀린다. 기존 `원`·`건` 제외와 같은 사유 — **수 일치 포맷터가 생기기
   *      전에는 어휘로 넣지 않는다.** (같은 키를 kk·mn 은 채웠다: 두 언어는 수사 뒤 명사가
   *      단수형 그대로라 접미가 성립한다.)
   *    · vi 1 — `일반@마약류`(en Non-controlled). 베트남 약사법의 특별관리 대상 규정 용어를
   *      확인하지 못했다. 틀리면 통제 약품이 일반약으로 읽힌다.
   *    · kk 0 · mn 0 — 이번 라운드 결손 전량 회수.
   */
  const GAP_BASELINE: Record<string, number> = { en: 0, ja: 0, ar: 15, zh: 2, ru: 3, vi: 1, kk: 0, mn: 0, th: 2 };

  it('팩별 결손 수가 조용히 늘지 않는다', () => {
    const actual: Record<string, number> = {};
    for (const p of allLocalePacks()) {
      // 🔴 `xx-` 는 위 커버리지 재주입 테스트가 등록한 **가드 전용 표본**이다(실제 언어 팩이 아니다).
      //    조준을 좁히는 것이지 완화가 아니므로, 바로 아래에서 실팩이 전부 남았는지 하한을 확인한다.
      if (p.code.startsWith('xx-')) continue;
      actual[p.code] = (packContextGaps(p.code) ?? []).length;
    }
    expect(Object.keys(actual).sort(), '실제 언어 팩이 빠졌다 — 표본이 사라지면 이 가드는 아무것도 보증하지 않는다')
      .toEqual(Object.keys(GAP_BASELINE).sort());
    expect(actual, '문맥 키를 새로 만들었으면 팩도 함께 보라 — 못 채우면 사유와 함께 기준선을 올린다').toEqual(
      GAP_BASELINE,
    );
  });

  it('🔴 대조군 — 파생이 죽으면 0 이 된다(0 을 "결손 없음"으로 읽지 않는다)', () => {
    const core = getLocalePack(COVERAGE_CORE_LOCALE)!;
    const ctx = Object.keys(core.messages).filter((k) => k.lastIndexOf('@') > 0);
    expect(ctx.length, '코어에 문맥 키가 0이면 이 검사 자체가 무의미하다').toBeGreaterThan(10);
    expect(packContextGaps('존재하지-않는-팩')).toBeNull();
  });
});
