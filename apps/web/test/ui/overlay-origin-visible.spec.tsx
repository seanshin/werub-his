import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18N_VALUE_ORIGIN_TEXT, I18N_REVIEW_STATE_TEXT, type I18nValueOrigin } from '@hospital-run/shared';
import { ReviewRowItem, PermissionNotice, StatsPanel } from '../../src/app/(main)/admin/ui-locale/review/parts';
import type { ReviewPermission, ReviewRow, ReviewStats } from '../../src/app/(main)/admin/ui-locale/review/contract';

/**
 * 🔴 `overlay-origin-visible` — **화면이 값의 출처를 말한다**(기획서 §4 · §1-1).
 *
 * 검수 화면이 보여주는 번역 문구는 넷 중 하나에서 온다:
 *   미번역(원문) · 코드 AI 초안 · 코드 검수 완료 · 검수 완료(오버레이).
 * 배지 없이 값만 그리면 사람은 **전부 "누군가 검수한 값"으로 읽는다** — 그 오독 위에서
 * 안전 키(임상·규제) 판단을 하게 된다. 그래서 출처 표시는 장식이 아니라 계약이다.
 *
 * 🔴 이 스펙은 **소스 문자열 검사가 아니라 실제 렌더**를 본다(주석·import 가 검사를 대신 통과한
 *    선례가 이 저장소에 9건 있다). 배지를 지우면 실패해야 가드다 — 재주입으로 검증했다.
 */

const withQuery = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

const baseRow: ReviewRow = {
  id: null,
  locale: 'en',
  key: '투약',
  source: '투약',
  context: null,
  area: 'nursing',
  codeValue: 'Medication',
  codeVerified: false,
  overlayValue: null,
  status: 'NONE',
  effectiveValue: 'Medication',
  effectiveOrigin: 'CODE_AI_DRAFT',
  effectiveOriginText: I18N_VALUE_ORIGIN_TEXT.CODE_AI_DRAFT,
  safetyKey: false,
  safetyReason: null,
  contextGap: false,
  baseChanged: false,
  baseValue: null,
  note: null,
  decisionReason: null,
  decisionAt: null,
  noTranslate: false,
  proposedBy: null,
  proposedByName: null,
  proposedAt: null,
  reviewedBy: null,
  reviewedByName: null,
  reviewedAt: null,
  mergedAt: null,
  selfApproved: false,
  usedIn: null,
};

const permission: ReviewPermission = {
  locale: 'en',
  canPropose: true,
  canApprove: true,
  canMarkMerged: false,
  reason: '설정 i18n.reviewers 에 en 검수자로 등록되어 있습니다.',
  reviewerCount: 2,
  configKey: 'i18n.reviewers',
};

const actions = {
  onPropose: vi.fn(),
  onApprove: vi.fn(),
  onReject: vi.fn(),
  onRejectKey: vi.fn(),
  onMarkMerged: vi.fn(),
};

const renderRow = (row: Partial<ReviewRow>, perm: ReviewPermission | undefined = permission, usageAvailable = true) =>
  render(
    withQuery(
      <ReviewRowItem row={{ ...baseRow, ...row }} permission={perm} usageAvailable={usageAvailable} actions={actions} busy={false} />,
    ),
  );

describe('🔴 검수 화면은 값의 출처를 말한다 — 배지 없이 그리지 않는다', () => {
  const ORIGINS: I18nValueOrigin[] = ['UNTRANSLATED', 'CODE_AI_DRAFT', 'CODE_VERIFIED', 'REVIEW_APPROVED'];

  for (const origin of ORIGINS) {
    it(`${origin} — 출처 배지가 실제로 렌더된다(문구는 shared 정본)`, () => {
      const { container, unmount } = renderRow({ effectiveOrigin: origin, effectiveOriginText: I18N_VALUE_ORIGIN_TEXT[origin] });
      const badge = container.querySelector('[data-i18n-origin]');
      expect(badge, '출처 배지가 없다 — 사람은 이 값을 검수된 것으로 읽는다').not.toBeNull();
      expect(badge!.getAttribute('data-i18n-origin')).toBe(origin);
      // 🔴 어휘를 화면이 지어내지 않는다 — shared 표 그대로여야 한다
      expect(badge!.textContent).toContain(I18N_VALUE_ORIGIN_TEXT[origin]);
      unmount();
    });
  }

  it('대조군 — 출처가 다르면 화면 문구도 다르다(한 문구를 늘 찍고 있지 않다)', () => {
    const seen = new Set<string>();
    for (const origin of ORIGINS) {
      const { container, unmount } = renderRow({ effectiveOrigin: origin });
      seen.add(container.querySelector('[data-i18n-origin]')!.textContent ?? '');
      unmount();
    }
    expect(seen.size, '네 출처가 모두 같은 문구로 그려진다').toBe(ORIGINS.length);
  });

  it('🔴 코드 AI 초안을 "검수 완료"로 말하지 않는다', () => {
    const { container } = renderRow({ effectiveOrigin: 'CODE_AI_DRAFT' });
    const badge = container.querySelector('[data-i18n-origin]')!;
    expect(badge.textContent).toBe(I18N_VALUE_ORIGIN_TEXT.CODE_AI_DRAFT);
    expect(badge.textContent).not.toContain(I18N_VALUE_ORIGIN_TEXT.REVIEW_APPROVED);
  });

  it('번역이 없으면 "번역 없음"이라 말한다 — 빈칸으로 두지 않는다(없음과 못 받음은 다르다)', () => {
    renderRow({ effectiveValue: null, effectiveOrigin: 'UNTRANSLATED' });
    expect(screen.getByText(/번역 없음/)).toBeTruthy();
  });
});

describe('🔴 기록 ≠ 적용 · 4-eyes · 안전 키 — 화면이 사실을 말한다', () => {
  it('저장은 제안일 뿐 반영이 아니라는 사실을 그 자리에서 말한다', () => {
    renderRow({});
    expect(screen.getByText(/승인 전에는 화면에 반영되지 않습니다/)).toBeTruthy();
  });

  it('제안자=승인자면 그 사실이 화면에 남는다(막지 않고 드러낸다)', () => {
    renderRow({ id: 'x', status: 'APPROVED', selfApproved: true });
    expect(screen.getByText('제안자=승인자')).toBeTruthy();
  });

  it('안전 키는 배지로 드러내고 "번역하지 않음"이 정답일 수 있음을 안내한다', () => {
    renderRow({ safetyKey: true, safetyReason: 'KTAS 등급 어휘' });
    expect(screen.getByText('안전 키')).toBeTruthy();
    expect(screen.getByText(/번역하지 않고 원문으로 두는 것도 정답/)).toBeTruthy();
  });

  it('상태 라벨은 shared 정본 어휘를 쓴다(로컬 재정의 금지)', () => {
    renderRow({ id: 'x', status: 'PROPOSED' });
    expect(screen.getByText(I18N_REVIEW_STATE_TEXT.PROPOSED)).toBeTruthy();
  });

  it('🔴 사용처를 못 세면 "없음"이 아니라 "확인 불가"라고 말한다', () => {
    renderRow({ usedIn: null }, permission, false);
    expect(screen.getByText(/확인 불가\(사용처 색인 없음\)/)).toBeTruthy();
  });

  it('대조군 — 사용처를 셌는데 0 이면 "찾지 못했습니다"로 다르게 말한다', () => {
    renderRow({ usedIn: [] }, permission, true);
    expect(screen.getByText(/이 키를 쓰는 화면을 찾지 못했습니다/)).toBeTruthy();
  });
});

describe('🔴 권한 — 숨기지 않고 왜 못 하는지 말한다', () => {
  it('권한이 없어도 결정 버튼은 화면에 남고, 비활성 사유가 붙는다', () => {
    const noPerm: ReviewPermission = {
      ...permission,
      canPropose: false,
      canApprove: false,
      reason: '설정 i18n.reviewers 에 en 검수자로 등록되어 있지 않습니다. 읽기는 열려 있고 쓰기만 막힙니다.',
    };
    renderRow({ id: 'x', status: 'PROPOSED' }, noPerm);
    const approve = screen.getByRole('button', { name: '승인' });
    expect(approve).toBeTruthy(); // 🔴 숨김 ≠ 권한 회수
    expect((approve as HTMLButtonElement).disabled, '버튼이 살아 있으면 권한 없이 눌린다').toBe(true);
    expect(approve.getAttribute('title')).toContain('등록되어 있지 않습니다');
  });

  it('권한 판정 자체를 못 받았으면 "권한 없음"이라 단정하지 않는다', () => {
    render(withQuery(<PermissionNotice permission={undefined} />));
    expect(screen.getByText(/권한이 없다는 뜻이 아닙니다/)).toBeTruthy();
  });

  it('서버가 보낸 사유 문장을 그대로 보여준다(FE 가 사유를 지어내지 않는다)', () => {
    render(withQuery(<PermissionNotice permission={permission} />));
    expect(screen.getByText(permission.reason)).toBeTruthy();
  });

  it('검수자 수 조회 실패(null)를 "0명"으로 번역하지 않는다', () => {
    render(withQuery(<PermissionNotice permission={{ ...permission, reviewerCount: null }} />));
    expect(screen.getByText(/확인 불가/)).toBeTruthy();
  });
});

describe('🔴 결정은 건별이고, 터치 타깃을 지킨다', () => {
  it('일괄 승인 버튼이 없다', () => {
    renderRow({ id: 'x', status: 'PROPOSED' });
    for (const b of screen.getAllByRole('button')) {
      expect(b.textContent ?? '').not.toMatch(/일괄|전체 승인|모두 승인/);
    }
  });

  it('승인·반려·저장 버튼은 44px 이상(임상 쓰기 규약)', () => {
    const { container } = renderRow({ id: 'x', status: 'PROPOSED' });
    const decisions = [...container.querySelectorAll('button')].filter((b) =>
      /승인|반려|교정 저장|코드 반영/.test(b.textContent ?? ''),
    );
    expect(decisions.length).toBeGreaterThanOrEqual(4);
    for (const b of decisions) {
      expect(b.className, `${b.textContent} 가 44px 규약을 안 지킨다`).toContain('min-h-[44px]');
    }
  });

  it('제안 기록이 없는 키는 승인할 수 없고, 그 이유를 말한다', () => {
    renderRow({ id: null, status: 'NONE' });
    const approve = screen.getByRole('button', { name: '승인' });
    expect((approve as HTMLButtonElement).disabled, '버튼이 살아 있으면 권한 없이 눌린다').toBe(true);
    expect(approve.getAttribute('title')).toContain('제안 기록이 없어');
    expect(within(document.body).getByText(/승인은 제안된 항목에만 남고/)).toBeTruthy();
  });
});

/* ── §2.4 "번역하지 않음" — 사유 필수 · 기록 ≠ 적용 ─────────────────────────── */

const REASON_INPUT = "사유·근거 — '번역하지 않음'에는 필수입니다";

describe('🔴 "번역하지 않음"(reject-key) — 사유 없이 부를 수 없다', () => {
  it('사유가 비면 버튼이 막히고, 필수라는 사실을 **누르기 전에** 말한다', () => {
    renderRow({ id: null, status: 'NONE', safetyKey: true, safetyReason: 'KTAS 등급 어휘' });
    const btn = screen.getByRole('button', { name: '번역하지 않음(사유 필수)' });
    expect((btn as HTMLButtonElement).disabled, '사유 없이 판정이 나간다').toBe(true);
    expect(btn.getAttribute('title')).toContain('사유가 필수입니다');
    // 누르기 전에 화면이 먼저 말한다
    expect(screen.getByText(/'번역하지 않음'에는 사유가 필수입니다/)).toBeTruthy();
  });

  it('🔴 공백만 넣은 것은 사유가 아니다(`!reason` 로 판정하지 않는다)', () => {
    renderRow({ id: null, status: 'NONE' });
    fireEvent.change(screen.getByPlaceholderText(REASON_INPUT), { target: { value: '   ' } });
    const btn = screen.getByRole('button', { name: '번역하지 않음(사유 필수)' });
    expect((btn as HTMLButtonElement).disabled, '공백만으로 판정이 나간다').toBe(true);
  });

  it('대조군 — 사유를 쓰면 눌리고, 그 사유가 그대로 넘어간다', () => {
    actions.onRejectKey.mockClear();
    renderRow({ id: null, status: 'NONE', key: 'KTAS 1' });
    fireEvent.change(screen.getByPlaceholderText(REASON_INPUT), {
      target: { value: 'KTAS 등급은 원문 유지(국제 표준 표기)' },
    });
    const btn = screen.getByRole('button', { name: '번역하지 않음(사유 필수)' });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);
    expect(actions.onRejectKey).toHaveBeenCalledTimes(1);
    expect(actions.onRejectKey.mock.calls[0][1]).toBe('KTAS 등급은 원문 유지(국제 표준 표기)');
  });

  it('안전 키 행은 이것이 정답인 선택임을 그 자리에서 안내한다', () => {
    renderRow({ id: null, safetyKey: true });
    expect(screen.getByText(/번역하지 않고 원문으로 두는 것도 정답입니다/)).toBeTruthy();
  });

  it('제안이 있는 행에서는 사유 없는 반려가 그대로 가능하다(DecisionDto.reason 은 선택)', () => {
    renderRow({ id: 'x', status: 'PROPOSED' });
    const btn = screen.getByRole('button', { name: '반려' });
    expect((btn as HTMLButtonElement).disabled, '선택인 사유를 필수처럼 막으면 거짓 데이터가 된다').toBe(false);
  });
});

describe('🔴 기록 ≠ 적용 — 반려해도 코드 초안이 남으면 그 초안이 나간다', () => {
  it('코드 초안이 남은 "번역하지 않음" 행은 아직 적용되지 않았다고 말한다', () => {
    const { container } = renderRow({ id: 'x', status: 'REJECTED', noTranslate: true, codeValue: 'Medication' });
    const mark = container.querySelector('[data-no-translate]');
    expect(mark, '번역하지 않음 판정의 적용 여부를 화면이 말하지 않는다').not.toBeNull();
    expect(mark!.getAttribute('data-no-translate')).toBe('CODE_STILL_SHOWS');
    expect(screen.getByText(/코드에 AI 초안이 남아 화면에는 그 초안이 계속 나갑니다/)).toBeTruthy();
  });

  it('대조군 — 코드에도 값이 없으면 다른 사실을 말한다(원문+티가 나간다)', () => {
    const { container } = renderRow({
      id: 'x',
      status: 'REJECTED',
      noTranslate: true,
      codeValue: null,
      effectiveValue: null,
      effectiveOrigin: 'UNTRANSLATED',
    });
    expect(container.querySelector('[data-no-translate]')!.getAttribute('data-no-translate')).toBe('SOURCE_SHOWN');
    expect(screen.getByText(/코드에도 값이 없어 화면에는 원문\+티가 나갑니다/)).toBeTruthy();
  });

  it("🔴 `overlayValue: ''` 를 \"값 있음\"으로 읽지 않는다 — 교정 입력이 빈칸이다", () => {
    renderRow({ id: 'x', status: 'REJECTED', noTranslate: true, overlayValue: '' });
    expect((screen.getByPlaceholderText('이 언어로 확정할 문구') as HTMLTextAreaElement).value).toBe('');
  });
});

const stats: ReviewStats = {
  locale: 'en',
  packPresent: true,
  catalogTotal: 100,
  translated: 80,
  untranslated: 20,
  safetyTotal: 5,
  contextGaps: 3,
  contextGapsUnavailableReason: null,
  review: { proposed: 1, approved: 2, rejected: 3, merged: 0, reviewed: 5, unreviewed: 95 },
  orphanOverrides: 0,
  approvedNotInCode: 2,
  noTranslate: 3,
  noTranslateButCodeStillShows: 2,
  reviewedRatio: { value: 5, numerator: 5, denominator: 100, unavailableReason: null },
  translatedRatio: { value: 80, numerator: 80, denominator: 100, unavailableReason: null },
  codeVerifiedCount: 0,
};

describe('🔴 통계 — "번역하지 않기로 함"과 "실제로 안 나간다"는 다른 사실이다', () => {
  it('코드 초안이 남은 몫을 분모와 함께 드러낸다', () => {
    const { container } = render(withQuery(<StatsPanel stats={stats} />));
    expect(container.querySelector('[data-code-still-shows]'), '판정만 세고 적용 여부를 감춘다(P17)').not.toBeNull();
    // 🔴 분모 병기 — "2건"만 말하면 모집단이 사라진다
    expect(screen.getAllByText(/2 \/ 3/).length).toBeGreaterThan(0);
  });

  it('대조군 — 남은 몫이 0 이면 붉은 배너를 띄우지 않는다(거짓 경보는 진짜 경보를 죽인다)', () => {
    const { container } = render(withQuery(<StatsPanel stats={{ ...stats, noTranslateButCodeStillShows: 0 }} />));
    expect(container.querySelector('[data-code-still-shows]')).toBeNull();
  });

  it('🔴 분모 0(번역하지 않음 판정이 없다)이면 100% 도 0% 도 아닌 "산출 불가"', () => {
    const { container } = render(
      withQuery(<StatsPanel stats={{ ...stats, noTranslate: 0, noTranslateButCodeStillShows: 0 }} />),
    );
    expect(container.querySelector('[data-ratio="unavailable"]')).not.toBeNull();
  });
});
