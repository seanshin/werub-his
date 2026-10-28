/**
 * 포털 미번역 가시화 가드 — P2b-8(2026-09-07) · `app/portal/_shared/PT.tsx`.
 *
 * 🔴 종전 `useT()` 는 미등록 키를 **조용히 한국어로** 돌려주어, 환자가 "번역이 안 된 것"과
 *    "원래 한국어인 것"을 구분할 수 없었다(번역 누락이 영원히 드러나지 않는다).
 *    아래 단언 중 셋째가 **결함 재주입**이다 — 카탈로그에 없는 키를 넣어 티가 실제로 뜨는지 본다.
 *    (티를 다시 지우면 이 스펙이 깨진다 = 가드가 가드로 작동한다)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { PT } from '@/app/portal/_shared/PT';
import { StatusBadge } from '@/app/portal/_shared';
import { usePortalLocale, type PortalLocale } from '@/lib/i18n/portal-i18n';

const setLocale = (l: PortalLocale) => usePortalLocale.setState({ locale: l });

describe('포털 PT — 미번역은 조용하지 않다', () => {
  beforeEach(() => setLocale('ko'));

  it('ko 는 원문 그대로 · 티 없음(ko 렌더 불변 규약)', () => {
    const { container } = render(<PT k="홈" />);
    expect(container.textContent).toBe('홈');
    expect(container.querySelector('sup')).toBeNull();
  });

  it('등록된 키는 번역문 · 티 없음(거짓 미번역 신호 금지)', () => {
    setLocale('en');
    const { container } = render(<PT k="홈" />);
    expect(container.textContent).toBe('Home');
    expect(container.querySelector('sup')).toBeNull();
  });

  it('🔴 재주입 — 미등록 한글 키는 한국어 원문 + EN× 티', () => {
    setLocale('en');
    const { container } = render(<PT k="이 문구는 카탈로그에 등재하지 않는다" />);
    expect(container.textContent).toContain('이 문구는 카탈로그에 등재하지 않는다');
    expect(container.querySelector('sup')?.textContent).toBe('EN×');
  });

  it('zh/ja 도 각자의 티를 단다(환자 축은 zh 를 갖는다)', () => {
    setLocale('zh');
    expect(render(<PT k="등재하지 않은 문구 하나" />).container.querySelector('sup')?.textContent).toBe('ZH×');
    setLocale('ja');
    expect(render(<PT k="등재하지 않은 문구 둘" />).container.querySelector('sup')?.textContent).toBe('JA×');
  });

  it('한글이 없는 키(코드값·라틴 약어)에는 티를 달지 않는다', () => {
    setLocale('en');
    const { container } = render(<PT k="PACU-01" />);
    expect(container.textContent).toBe('PACU-01');
    expect(container.querySelector('sup')).toBeNull();
  });

  it('빈 키는 아무것도 그리지 않는다(내용 없이 티만 뜨는 사고 방지)', () => {
    setLocale('en');
    expect(render(<PT k="   " />).container.textContent).toBe('');
  });

  it('P2b-8 신규 키는 en/zh/ja 세 언어 전부에 있다(한 언어만 채우면 갈라진다)', () => {
    const keys = ['치료 일정', '원격진료', '내 정보', '퇴원 약 수령', '실시간 대기 현황',
      '주의', '병원 문의', '접수', '대기', '진료 진행 상황', '판독 결과 알림'];
    for (const l of ['en', 'zh', 'ja'] as const) {
      setLocale(l);
      for (const k of keys) {
        expect(render(<PT k={k} />).container.querySelector('sup'), `${l} / ${k}`).toBeNull();
      }
    }
  });

  it('포털 StatusBadge 도 같은 축을 탄다(라벨 번역 · 미등재 코드값엔 티 없음)', () => {
    setLocale('ja');
    expect(render(<StatusBadge status="PAID" domain="billing" />).container.textContent).toBe('支払済');
    // 🔴 (2026-10-19 A2) 정본에 없는 상태는 환자에게 코드(`DRAFT`)를 보이지 않는다 — "상태 확인 필요"(번역됨 · 코드는 title 로만)
    const unknown = render(<StatusBadge status="DRAFT" domain="billing" />).container;
    expect(unknown.textContent).not.toContain('DRAFT');
    expect(unknown.querySelector('[title="DRAFT"]')).not.toBeNull();
    expect(unknown.querySelector('sup')).toBeNull();
    expect(render(<StatusBadge status="CHECKED_IN" domain="appointment" />).container.textContent).not.toContain('CHECKED_IN');
  });

  it('🔴 임상 지시 상세문은 의도적 미등재 — 지어내지 않고 티로 드러낸다', () => {
    setLocale('zh');
    const { container } = render(
      <PT k="검사 전날 자정부터 금식해주세요. 아침 약은 소량의 물과 함께 복용 가능합니다." />,
    );
    expect(container.querySelector('sup')?.textContent).toBe('ZH×');
  });
});
