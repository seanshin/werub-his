/**
 * 대시보드 정돈(2026-09-29 사람 요청 "세련되게 정리") — 모양을 고치다 드러난 **사실 결함**을 못박는다.
 *
 *  1. 요약 띠 라벨은 지표 키가 정한다 — `/dashboard/overview` 는 병원 전체 집계인데 의사에게 "내 ~"로,
 *     간호사에게 DRAFT 진료 수를 "입원 환자"로 말하고 있었다(P1·P11).
 *  2. 접속 정보의 "시스템 정상 운영 중"(초록 점멸)은 아무것도 재지 않는 상수였다(P17) — 되살리지 않는다.
 *  3. 관리자 패널이 '내 대기 환자' 목록을 안에 또 그려, 기본 배치의 my-queue 위젯과 같은 목록이 두 번 나왔다.
 *  4. 위젯 틀 안에서 또 흰 카드·같은 제목을 그리던 이중 틀 — 틀은 WidgetWrapper 하나.
 *  5. 담당 센서스는 조회 실패·빈 목록 모두 `null` → 제목만 있는 빈 카드였다. 실패와 없음을 가른다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a) } }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const DASH = join(__dirname, '../../src/app/(main)/dashboard');
const src = (f: string) => readFileSync(join(DASH, f), 'utf8');

beforeEach(() => { cleanup(); get.mockReset(); });

describe('요약 띠 라벨은 지표 키가 정한다', () => {
  it('병원 전체 값을 "내 ~"로 말하지 않는다 · 역할마다 같은 키는 같은 라벨', async () => {
    const { OVERVIEW_KEY_LABEL, ROLE_KEYS } = await import('@/app/(main)/dashboard/components/widgets/StatBarWidget');
    for (const label of Object.values(OVERVIEW_KEY_LABEL)) expect(label.startsWith('내 ')).toBe(false);
    expect(OVERVIEW_KEY_LABEL.draftEncounters).toBe('미완료 차트');
    for (const keys of Object.values(ROLE_KEYS)) for (const k of keys) expect(OVERVIEW_KEY_LABEL[k]).toBeTruthy();
  });
  it('구조 — 역할별 목록에 라벨 문자열을 다시 적지 않는다', () => {
    const s = src('components/widgets/StatBarWidget.tsx');
    const roleBlock = s.slice(s.indexOf('export const ROLE_KEYS'), s.indexOf('};', s.indexOf('export const ROLE_KEYS')));
    expect(roleBlock).not.toMatch(/label\s*:/);
  });
});

describe('근거 없는 안심·중복·이중 틀', () => {
  it('접속 정보가 "정상 운영"을 상수로 말하지 않는다', () => {
    const s = src('components/SessionInfo.tsx').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(s).not.toMatch(/정상 운영/);
    expect(s).not.toMatch(/animate-pulse/);
  });
  it('관리자 패널이 내 대기 환자 목록을 다시 그리지 않는다(관리자 기본 배치는 접수 대기 현황을 쓴다 · 2026-10-02)', async () => {
    expect(src('components/AdminDashboard.tsx')).not.toMatch(/<MyWaitingQueueWidget/);
    // 요약 띠와 같은 값을 다시 그리던 '관리자 업무' 머리 블록도 되살리지 않는다
    expect(src('components/AdminDashboard.tsx')).not.toMatch(/<T k="관리자 업무"/);
    const { getDefaultConfig } = await import('@/app/(main)/dashboard/components/default-layouts');
    // 2026-10-02 — 관리자는 의사 본인 대기열(/queue/my)이 늘 비어 있었다 → 병원 접수 대기(reception-queue)
    expect(getDefaultConfig('ADMIN').layouts.lg.map((l) => l.i)).toContain('reception-queue');
    expect(getDefaultConfig('ADMIN').layouts.lg.map((l) => l.i)).not.toContain('my-queue');
  });
  it.each(['components/QuickActions.tsx', 'components/SessionInfo.tsx', 'components/MyWaitingQueueWidget.tsx', 'components/MyCensusPanel.tsx'])(
    '%s — 위젯 틀 안에서 흰 카드 틀을 또 그리지 않는다', (f) => {
      expect(src(f)).not.toMatch(/bg-white rounded-xl border border-gray-100 p-4/);
    });
});

describe('담당 센서스 — 실패와 없음을 가른다', () => {
  const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
  it('조회 실패는 실패로(빈 카드가 아니다)', async () => {
    get.mockRejectedValue(new Error('500'));
    const { default: MyCensusPanel } = await import('@/app/(main)/dashboard/components/MyCensusPanel');
    const { container } = wrap(<MyCensusPanel />);
    await vi.waitFor(() => expect(container.textContent).not.toBe(''), { timeout: 3000 });
    expect(container.textContent).not.toContain('담당 입원 환자가 없습니다');
  });
  it('0명은 "없습니다"로', async () => {
    get.mockResolvedValue({ data: { totalPatients: 0, byStatus: {}, patients: [] } });
    const { default: MyCensusPanel } = await import('@/app/(main)/dashboard/components/MyCensusPanel');
    wrap(<MyCensusPanel />);
    expect(await screen.findByText(/담당 입원 환자가 없습니다/)).toBeTruthy();
  });
});
