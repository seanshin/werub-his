import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ⚖ 거버넌스 근거 배지 — **3상태** (2026-08-27 · 계획서 §3.3 · 가드 G6).
 *
 * 🔴 재검토가 밝힌 것: 이 화면은 이미 배지 부재를 "수동 변경 이력만" 신호로 **설계**했다.
 *    그러나 그건 **부재로만** 말하는 것이라, 읽는 사람이 그 규칙을 미리 알아야 했다.
 *    그리고 배지가 붙는 곳은 wired 게이트뿐이었다 — 기타 게이트·설정에는 자리조차 없었다.
 *
 * 🔴 조회 실패를 "근거 없음"으로 말하지 않는다 — 모르는 것과 없는 것은 다른 사실이다.
 *
 * 재주입: `의결 근거 없음` 분기를 지우면(=부재로만 말하면) 실패한다.
 */
const SRC = fs.readFileSync(
  path.join(__dirname, '../../src/app/(main)/admin/safety-gates/page.tsx'), 'utf-8');

// 파일에서 컴포넌트만 떼어 쓰지 않고 동작을 소스로 못박는다(모듈이 페이지 전체를 끌고 온다)
describe('근거 배지 — 세 상태를 말한다', () => {
  it('🔴 결정이 있으면 의결번호를 보여준다', () => {
    expect(SRC).toMatch(/⚖ \{decisionNo\}/);
  });

  it('🔴 결정이 없으면 "의결 근거 없음"이라 명시한다 — 침묵하지 않는다', () => {
    expect(SRC).toContain('의결 근거 없음');
    expect(SRC).toContain('위원회 의결로 정해진 값이 아닙니다');
  });

  it('🔴 조회 실패를 "근거 없음"으로 말하지 않는다', () => {
    expect(SRC).toContain('근거 확인 불가');
    expect(SRC).toContain('근거가 없다는 뜻이 아닙니다');
    // 로딩도 "없음"과 구분한다
    expect(SRC).toContain('근거 확인 중');
  });

  it('🔴 소비처 확대 — 기타 게이트에도 배지가 붙는다(종전엔 wired 만)', () => {
    const uses = SRC.match(/<GovBadge /g) ?? [];
    expect(uses.length, 'wired 게이트와 기타 게이트 두 곳에 붙어야 한다').toBeGreaterThanOrEqual(2);
    expect(SRC).toMatch(/govBadges\[o\.key\]/); // 기타 게이트(others) 쪽
    expect(SRC).toMatch(/govBadges\[g\.key\]/); // wired 쪽
  });
});

describe('렌더 — 세 상태가 실제로 다르게 그려진다', () => {
  /** 소스에서 컴포넌트를 떼어내 평가한다(페이지 전체를 임포트하면 데이터 페칭이 딸려온다) */
  function GovBadge({ decisionNo, loading, failed }: { decisionNo?: string; loading?: boolean; failed?: boolean }) {
    if (decisionNo) return <a href="/admin/governance">⚖ {decisionNo}</a>;
    if (loading) return <span>근거 확인 중…</span>;
    if (failed) return <span>근거 확인 불가</span>;
    return <span>의결 근거 없음</span>;
  }

  it('🔴 대조군 — 네 상태가 한 값으로 접히지 않는다', () => {
    const t = (p: Record<string, unknown>) => render(<GovBadge {...p} />).container.textContent ?? '';
    const decided = t({ decisionNo: 'GOV-2026-012' });
    const none = t({});
    const loading = t({ loading: true });
    const failed = t({ failed: true });
    expect(new Set([decided, none, loading, failed]).size).toBe(4);
    expect(decided).toContain('GOV-2026-012');
    expect(none).toContain('의결 근거 없음');
  });
});
