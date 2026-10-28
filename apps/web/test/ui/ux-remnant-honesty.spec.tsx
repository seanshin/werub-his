import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ConfirmDialog from '../../src/components/ui/ConfirmDialog';

/**
 * 가드 — UX 전수 검토 잔여 5건 회수(2026-09-03).
 *  1. ConfirmDialog: role/aria·Esc·포커스(유일 소비처가 "되돌릴 수 없음" 확정이라 가장 엄격해야 한다)
 *  2. Sidebar: 메뉴 오버라이드 조회 실패가 숨긴 메뉴를 되살리며 침묵하지 않는다(fail-open 고지)
 *  3. homepage/seo: 미입력을 0점 Poor(빨강)로 그리지 않는다
 *  4. admin/displays: 단말 생존이 색 점 하나가 아니라 글자 라벨과 함께 나온다
 *  5. auto-mapping: 분모 상수(ICF: 20)·비례 배분 추정이 되살아나지 않는다
 */

const web = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');
const stripComments = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('ConfirmDialog — 파괴적 확정을 지키는 다이얼로그', () => {
  it('🔴 danger 는 alertdialog 로, aria-modal·labelledby 를 단다', () => {
    const { getByRole } = render(
      <ConfirmDialog open title="보고 대상 확정" message="되돌릴 수 없습니다" variant="danger" onConfirm={() => {}} onCancel={() => {}} />,
    );
    const dlg = getByRole('alertdialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dlg.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('🔴 Esc 가 취소를 부른다(종전엔 백드롭 클릭만 닫기 수단)', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="t" message="m" onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('🔴 열리면 포커스가 취소 버튼에 있다 — Enter 연타가 파괴 확정을 누르지 않게', () => {
    const { getByText } = render(
      <ConfirmDialog open title="t" message="m" variant="danger" cancelText="취소" onConfirm={() => {}} onCancel={() => {}} />,
    );
    // <T> 도입으로 텍스트가 span 안에 든다 — 가드 의도(버튼 포커스)는 closest 로 유지
    expect(document.activeElement).toBe(getByText('취소').closest('button'));
  });

  it('닫혀 있으면 아무것도 그리지 않는다(대조군)', () => {
    const { container } = render(
      <ConfirmDialog open={false} title="t" message="m" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(container.innerHTML).toBe('');
  });
});

describe('Sidebar — 메뉴 오버라이드 fail-open 고지', () => {
  const src = web('components/layout/Sidebar.tsx');
  it('🔴 오버라이드 조회 실패를 무음 catch 로 접지 않는다 — 캐시 폴백+배너', () => {
    // menu-overrides fetch 블록만 잘라 본다(다른 fetch 의 무음 catch 는 이 가드의 대상이 아니다)
    const start = src.indexOf("'/api/v1/access-control/menu-overrides'");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf('apiClient.get', start + 10));
    expect(stripComments(block), '실패가 다시 무음이 됐습니다').not.toMatch(/\.catch\(\(\)\s*=>\s*\{\}\)/);
    expect(block).toContain('MENU_OVERRIDE_CACHE_KEY');
    expect(block).toContain('setOverridesFallback');
  });
  it('실패 상태가 화면에 말로 나온다(배너)', () => {
    expect(src).toContain('메뉴 설정을 불러오지 못');
  });
});

describe('homepage/seo — 미입력 ≠ 0점 Poor', () => {
  const src = web('app/(main)/admin/homepage/seo/page.tsx');
  it('🔴 기본 페이지 주입이 score 0 이 아니라 null 이다', () => {
    expect(stripComments(src)).not.toMatch(/h1:\s*'',\s*score:\s*0\s*\}/);
    expect(src).toMatch(/score:\s*null\s*\}/);
  });
  it('통계 분모가 평가된 것만 센다', () => {
    expect(src).toMatch(/e\.score !== null/);
  });
  it('조회 실패를 빈 목록으로 접지 않는다', () => {
    expect(src).toContain('loadFailed');
    expect(stripComments(src)).not.toMatch(/seo'\)\.catch\(/);
  });
});

describe('admin/displays — 단말 생존은 색 점이 아니라 글자로', () => {
  const src = web('app/(main)/admin/displays/page.tsx');
  it('🔴 라벨 없는 생존 점이 되살아나지 않는다', () => {
    expect(stripComments(src)).not.toMatch(/w-2 h-2 rounded-full[^`]*bg-emerald/);
    expect(src).toContain('StatusShapeMark');
    expect(src).toContain('접속 기록 없음');
    expect(src).toContain('24시간 내 접속');
  });
});

describe('auto-mapping — 분모 상수·비례 배분 추정 금지', () => {
  const src = web('app/(main)/admin/codes/auto-mapping-dashboard.tsx');
  it('🔴 코드 상수 분모(ICF: 20)가 되살아나지 않는다', () => {
    expect(stripComments(src)).not.toMatch(/ICF:\s*\d+/);
    expect(stripComments(src)).not.toMatch(/systemTargets/);
  });
  it('🔴 안분 추정(totalMappings × 비율)이 되살아나지 않는다 — 실측 mappedByType 만', () => {
    expect(stripComments(src)).not.toMatch(/totalMappings\s*\*\s*\(/);
    expect(src).toContain('mappedByType');
    expect(src).toContain('systemCoverage');
  });
  it('분모 미상이면 비율을 그리지 않는다 — 문구는 shared 정본(RATIO_UNAVAILABLE)으로', () => {
    expect(src).toContain('RATIO_UNAVAILABLE');
    expect(src).toContain('분모(적용 대상) 미상');
  });
});
