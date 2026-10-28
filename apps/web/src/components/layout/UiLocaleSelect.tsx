'use client';

import { activeLocaleCoverage, isActiveLocale, RATIO_UNAVAILABLE } from '@hospital-run/shared';
import { useUiLocaleStore } from '@/stores/ui-locale-store';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { useTopBarDensity } from '@/components/layout/topbar-density';

/**
 * 화면 언어 셀렉트 — TopBar(기획 ui-locale-i18n.plan.md §2.3).
 * 🔴 의료용어 한/영 토글("의료코드")과 별개 축 — 이것은 메뉴·버튼·라벨(화면 크롬)의 언어다.
 * 🔴 아랍어는 **이 선택지에 없다**(2026-09-07 사람 결정 — 별도 트랙 §8). RTL 레이아웃도 검수자도
 *    없는 상태로 고르게 두면 "쓸 수 있는 것"으로 읽힌다. 카탈로그는 보존돼 있고 되돌리기는 한 줄이다.
 *
 * 🔴 **커버리지를 분모와 함께 보인다**(2026-09-07). 추가 언어 6종(zh·ru·vi·kk·mn·th)은
 *    코어 6,175키 중 약 550~730키(9~12%)만 가진 채 ACTIVE 다 — 고르면 화면의 대부분이
 *    한국어 원문 + 미번역 티로 나온다. 종전에는 그 사실이 **어디에도 없었다**:
 *    `packCoverage()` 는 있었지만 소비처가 테스트 한 곳뿐이라 사용자는 "Tiếng Việt" 라는
 *    이름만 보고 완역된 언어라고 읽었다.
 * 🔴 **막지 않는다.** 부분 번역 언어를 못 고르게 하는 것은 이 단계의 답이 아니다
 *    (9% 언어를 ACTIVE 로 둘 것인가는 사람 결정거리다 — §1 정직성은 "사실을 보이고 고르게" 한다).
 * 🔴 **분모를 병기한다.** "9%" 가 아니라 "727 / 6,175". 분모가 0(코어 미조립)이면
 *    비율을 그리지 않고 '산출 불가'라고 말한다 — 0% 도 100% 도 아니다.
 */

const nf = new Intl.NumberFormat('ko-KR');

/**
 * 선택지 한 줄의 표기 — 완역이면 이름만, 부분 번역이면 이름 + 분모 병기.
 * 🔴 `<option>` 안에는 부품(`<T>`)을 넣을 수 없어 문자열이어야 한다 — 번역은 **주입**받는다
 *    (여기서 tOf 를 직접 부르면 훅 밖이라 로케일을 모른다).
 */
export function localeOptionText(
  c: { label: string; translated: number; coreTotal: number; complete: boolean; unavailable: boolean },
  t: (k: string) => string = (k) => k,
): string {
  if (c.unavailable) return `${c.label} — ${t('번역')} ${RATIO_UNAVAILABLE}`;
  if (c.complete) return c.label;
  return `${c.label} — ${t('번역')} ${nf.format(c.translated)} / ${nf.format(c.coreTotal)}`;
}

export function UiLocaleSelect() {
  const { locale, setLocale } = useUiLocaleStore();
  const coverage = activeLocaleCoverage();
  // 🔴 이 셀렉트의 안내문은 **자기 자신을 설명하는 문구**다 — 등재는 했으나 전량 AI 초안이라
  //    사람 검수 우선순위가 높다(등재하지 않으면 영어 화면에 한국어 툴팁이 남는다).
  const tAttr = useTAttr();
  const density = useTopBarDensity();

  return (
    <label
      className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-gray-200 bg-gray-50 px-1.5 py-0.5"
      title={
        tAttr('화면 언어 — 메뉴·버튼·라벨의 표시 언어입니다(기록·인쇄 불변).') + ' ' +
        tAttr('목록의 숫자는 「이 언어에 번역된 문구 / 화면 전체 문구」입니다.') + ' ' +
        tAttr('번역이 없는 문구는 한국어 원문에 미번역 표시가 붙어 나옵니다.') + ' ' +
        tAttr('등재된 번역은 전량 AI 초안이며 사람 검수를 거치지 않았습니다.')
      }
    >
      <span aria-hidden className="text-[11px]">🌐</span>
      {density === 0 && <T k="화면 언어" className="select-none text-[10px] font-medium text-gray-400" />}
      <select
        aria-label={tAttr('화면 언어 (선택지에 번역 문구 수 / 화면 전체 문구 수를 병기)')}
        value={locale}
        onChange={(e) => { if (isActiveLocale(e.target.value)) setLocale(e.target.value); }}
        className="min-h-[28px] cursor-pointer rounded-md border-0 bg-transparent pr-1 text-[11px] font-medium text-gray-700 focus:outline-none"
      >
        {/* 🔴 팩 기반 — 언어 팩을 ACTIVE 로 넣으면 코드 수정 없이 여기 뜬다(§9) */}
        {coverage.map((c) => (
          <option key={c.code} value={c.code}>{localeOptionText(c, tAttr)}</option>
        ))}
      </select>
      {/* 🔴 배지를 따로 두지 않는다 — 닫힌 셀렉트가 선택된 option 의 문구를 그대로 보여주므로
          분모 병기가 상시 노출된다. 옆에 같은 수치를 또 그리면 같은 사실을 두 번 말하는 것이고,
          폭만 먹는다(상시 노출 문구는 짧게 — 안 읽히면 없는 것과 같다).
          그래서 이 셀렉트에는 폭을 줄이는 truncate·max-width 를 걸지 않는다: 걸면 수치가 잘린다. */}
    </label>
  );
}
