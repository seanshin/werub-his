import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';
import { EGRESS_ROUTES, egressSummary } from '@hospital-run/shared';
import { useUiLocaleStore } from '../../src/stores/ui-locale-store';
import { EgressInventorySection } from '../../src/app/(main)/admin/outbound-channels/EgressInventorySection';

/**
 * 외부 전송 경로 섹션(/admin/outbound-channels · T10-4 데이터 소재지) — 화면이 사실을 말하는가.
 *
 * 🔴 목은 정본의 실제 반환 모양을 쓴다 — API `egressInventory()` 가 돌려주는 것과 같은
 *    shared `EGRESS_ROUTES`·`egressSummary()` 를 그대로 넣는다(내가 지어낸 경로를 그리지 않는다).
 */
const egress = { routes: [...EGRESS_ROUTES], summary: egressSummary(), verdictNote: '국가 프로파일 결정 전 — 판정 없음' };
const TIE = /[A-Z]{2}×/;

beforeEach(() => useUiLocaleStore.setState({ locale: 'ko' }));
afterEach(() => cleanup());

describe('외부 전송 경로 섹션', () => {
  it('분모를 함께 말하고 불명을 따로 센다(0 으로 접지 않는다)', () => {
    const { getByTestId } = render(<EgressInventorySection egress={egress} />);
    const text = getByTestId('egress-summary').textContent ?? '';
    const unknown = EGRESS_ROUTES.filter((r) => r.dataClass === 'UNKNOWN').length;
    const review = EGRESS_ROUTES.filter((r) => r.dataClass === 'PHI' || r.dataClass === 'PSEUDONYMOUS').length;
    expect(unknown).toBeGreaterThan(0); // 표본 — 불명 경로가 실측상 존재한다
    expect(text).toContain(`전체 경로 ${EGRESS_ROUTES.length}개 중`);
    expect(text).toContain(`검토 대상(PHI·가명) ${review}개`);
    expect(text).toContain(`데이터 불명 ${unknown}개`);
  });

  it('🔴 불명 경로 행은 "데이터 불명"·"검토 여부 불명"으로 그린다 — "비PHI"·"검토 대상 아님"이 아니다', () => {
    const { getByTestId } = render(<EgressInventorySection egress={egress} />);
    for (const r of EGRESS_ROUTES.filter((x) => x.dataClass === 'UNKNOWN')) {
      const row = within(getByTestId(`egress-route-${r.id}`));
      expect(row.getByText('데이터 불명')).toBeTruthy();
      expect(row.getByText('검토 여부 불명')).toBeTruthy();
      expect(row.queryByText('비PHI')).toBeNull();
      expect(row.queryByText('검토 대상 아님')).toBeNull();
    }
  });

  it('🔴 원외 고정 호스트 FCM 푸시는 "데이터 불명"으로 보인다(자유 입력 사유가 실린다 — 비PHI 로 접으면 거짓 안심)', () => {
    const { getByTestId } = render(<EgressInventorySection egress={egress} />);
    const row = within(getByTestId('egress-route-push.fcm'));
    expect(row.getByText('데이터 불명')).toBeTruthy();
    expect(row.getByText('host:fcm.googleapis.com')).toBeTruthy();
  });

  it('원외 고정 호스트 PHI 경로(검진권 이메일)는 검토 대상으로 보인다', () => {
    const { getByTestId } = render(<EgressInventorySection egress={egress} />);
    const row = within(getByTestId('egress-route-email.resend'));
    expect(row.getByText('환자정보(PHI)')).toBeTruthy();
    expect(row.getByText('국외 이전 검토 대상')).toBeTruthy();
    expect(row.getByText('host:api.resend.com')).toBeTruthy();
  });

  it('판정 없음을 밝히고 "원내"로 접힌 경로가 없다', () => {
    const { container } = render(<EgressInventorySection egress={egress} />);
    expect(container.textContent).toContain('국외 이전 판정 없음 — 국가 프로파일 결정 전');
    expect(container.textContent).not.toMatch(/허용됨|금지됨|적합/);
    expect(egress.summary.internal).toBe(0);
  });

  it('응답에 목록이 없으면 "경로 0"이 아니라 "목록 없음"을 말한다', () => {
    const { container } = render(<EgressInventorySection egress={undefined} />);
    expect(container.textContent).toContain('경로가 없다는 뜻이 아닙니다');
    expect(container.textContent).not.toContain('전체 경로 0개');
  });

  it('en — 크롬 문구는 등재돼 있고(티 없음) 서버 문장은 <Data> 로 그대로 나간다', () => {
    useUiLocaleStore.setState({ locale: 'en' });
    const { container, getByTestId } = render(<EgressInventorySection egress={egress} />);
    const summary = getByTestId('egress-summary').textContent ?? '';
    expect(summary).toContain(`Of ${EGRESS_ROUTES.length} routes in total`);
    expect(summary).not.toMatch(TIE);
    expect(container.querySelector('[title="번역 미등록 — 한국어 원문을 표시합니다"]')).toBeNull();
  });
});
