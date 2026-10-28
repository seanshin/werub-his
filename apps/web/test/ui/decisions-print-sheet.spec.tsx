/**
 * 결정 인쇄본(2026-10-12 사용자 "인쇄 버튼 누르면 제대로 안 나옴 · 의사결정 표시가 명확한 구조로, 다시 인식할 수 있는 형태로").
 *  · 🔴 종전 인쇄는 빈 종이 — 공용 문서 CSS 가 인쇄 루트 유무와 상관없이 body 직계를 모두 숨겼다(인쇄 버튼 12곳)
 *  · 인쇄 전용 문서를 body 직하 `.doc-print-root` 에 그린다(화면을 찍지 않는다)
 *  · 결정마다 결정 키·상태 코드(REAL/SEED/OPEN)·선택 값 코드 · 문서 해시·QR
 *  · 🔴 2026-10-12 사용자 결정: 행별 기계 코드는 사람이 보기에 부적합 → 사람 확인 칸(☐·서명) + 문서 끝 서명란
 *  · 결정 문서: 선택지 전체 ☑/☐ · 값 코드
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtl, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: vi.fn(), post: vi.fn(), getToken: () => 'x' } }));
beforeEach(() => { cleanup(); document.body.querySelectorAll('.doc-print-root').forEach((e) => e.remove()); });

const base = {
  mechanism: 'CONFIRM_ONLY', settings: [], why: '이유 본문', legalReview: [], approvalPath: 'AUTHORIZED_ROLE', authority: '원장', statusQuo: '현행 **상태**', goLive: 'CAN_FOLLOW',
  owner: '팀', dueBy: 'NONE', currentConfigValue: null, pendingAttachments: [], unlocks: [], blockedBy: [], readyToDecide: false, agenda: null, stage: null, committee: null,
  enactment: { state: 'UNDECIDED', label: '미결', detail: null, actions: [] }, needsReview: [], governedConfig: [],
  options: [{ value: 'OFF', label: '끔', effect: '끈다' }, { value: 'ON', label: '켬', effect: '켠다' }],
};
const rec = (choice: string, ref = '운영위 3호') => ({ choice, legalReviewRef: ref, authorityClaim: '진료부장', decidedByUserId: 'u', decidedAt: '2026-10-01T00:00:00.000Z', applied: true });
const ITEMS = [
  { ...base, key: 'policy.patientPush.enable', title: '알림 **마스터**', layer: 'INTERNAL_COMMITTEE', track: 'NOTIFY', domain: 'OPERATIONS', decided: true, seeded: false, record: rec('ON') },
  { ...base, key: 'billing.institutionType', title: '종별', layer: 'LICENSE_HOLDER', track: 'BILLING', domain: 'FOUNDATION', decided: false, seeded: true, record: rec('OFF', '개발 시드(DEV-SEED)') },
  { ...base, key: 'auth.staffIdleTimeout', title: '유휴 만료', layer: 'INTERNAL_COMMITTEE', track: 'SECURITY', domain: 'SECURITY', decided: false, seeded: false, record: null },
] as never[];
const render = (ui: React.ReactElement) => rtl(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const root = () => document.body.querySelector(':scope > .doc-print-root')!;

describe('결정 대장 인쇄본', () => {
  it('🔴 body 직하 인쇄 루트 · 영역 › 세부 분류 순 · 키·상태 코드·값 코드·검증 코드', async () => {
    const { DecisionRegisterPrint } = await import('@/app/(main)/admin/decisions/print-sheet');
    render(<DecisionRegisterPrint items={ITEMS} measuredAt="2026-10-12T00:00:00.000Z" />);
    await waitFor(() => expect(root()?.querySelector('[data-print-doc-hash]')?.textContent).toMatch(/[0-9a-f]{64}/));
    const r = root();
    expect([...r.querySelectorAll('[data-print-group]')].map((g) => g.getAttribute('data-print-group'))).toEqual(['F_CORPORATE', 'O_PATIENT_ENV', 'S_INTERNAL']);
    expect([...r.querySelectorAll('[data-print-row]')].map((x) => x.getAttribute('data-print-state'))).toEqual(['SEED', 'REAL', 'OPEN']);
    const real = r.querySelector('[data-print-row="policy.patientPush.enable"]')!;
    expect(real.textContent).toContain('policy.patientPush.enable');
    expect(real.textContent).toContain('[ON]');
    expect(real.textContent).not.toContain('**');
    // 사람 확인 칸 — ☐ 와 서명 줄 · 🔴 16진 코드가 없다
    for (const row of r.querySelectorAll('[data-print-row]')) {
      expect(row.querySelector('[data-print-check]')!.textContent).toContain('☐');
      expect(row.textContent).not.toMatch(/\b[0-9a-f]{8}\b/);
    }
    expect(r.querySelector('[data-print-signoff]')!.textContent).toContain('검토자');
    // 🔴 시드는 실결정으로 찍히지 않는다
    expect(r.querySelector('[data-print-row="billing.institutionType"]')!.textContent).toContain('SEED');
    const lines = ['billing.institutionType|SEED|OFF|2026-10-01T00:00:00.000Z', 'policy.patientPush.enable|REAL|ON|2026-10-01T00:00:00.000Z', 'auth.staffIdleTimeout|OPEN||'];
    expect(r.querySelector('[data-print-doc-hash]')!.textContent).toContain(createHash('sha256').update(lines.join('\n')).digest('hex'));
  });
});

describe('🔴 쪽마다 QR(2026-10-12 사용자 "페이지마다 보안 인증해야 하니 QR코드 명시")', () => {
  it('@page 여백 상자 — 모든 쪽 오른쪽 아래 QR · 왼쪽 아래 문서 코드·sha256 앞 16자·쪽 n / N', async () => {
    const { DecisionRegisterPrint } = await import('@/app/(main)/admin/decisions/print-sheet');
    render(<DecisionRegisterPrint items={ITEMS} measuredAt="2026-10-12T00:00:00.000Z" />);
    await waitFor(() => expect(root()?.querySelector('style[data-print-page-qr]')?.getAttribute('data-print-page-qr')).toBe('ready'));
    const css = root().querySelector('style[data-print-page-qr]')!.textContent!;
    const lines = ['billing.institutionType|SEED|OFF|2026-10-01T00:00:00.000Z', 'policy.patientPush.enable|REAL|ON|2026-10-01T00:00:00.000Z', 'auth.staffIdleTimeout|OPEN||'];
    const h16 = createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
    for (const page of ['dps', 'dps-land']) expect(css).toContain(`@page ${page} {`);
    expect(css).toMatch(/@bottom-right \{ content: url\(data:image\/png;base64,/);
    expect(css).toContain(`HIS-DECISION-REGISTER v1 · sha256 ${h16}`);
    expect(css).toContain('counter(page) " / " counter(pages)');
  });
});

describe('결정 문서 인쇄본(의사결정서)', () => {
  it('🔴 고른 선택지만 ☑ · 값 코드 · 상태 코드 · 결정 키', async () => {
    const { DecisionDocPrint } = await import('@/app/(main)/admin/decisions/print-sheet');
    render(<DecisionDocPrint item={ITEMS[0]} measuredAt="2026-10-12T00:00:00.000Z" />);
    await waitFor(() => expect(root()?.querySelector('[data-print-doc-hash]')?.textContent).toContain(createHash('sha256').update('policy.patientPush.enable|REAL|ON|2026-10-01T00:00:00.000Z').digest('hex')));
    expect(root().querySelector('[data-print-signoff]')).toBeTruthy();
    const r = root();
    expect(r.querySelector('[data-print-key]')!.textContent).toBe('policy.patientPush.enable');
    expect(r.querySelector('[data-print-state]')!.getAttribute('data-print-state')).toBe('REAL');
    expect(r.querySelector('[data-print-option="ON"]')!.getAttribute('data-print-chosen')).toBe('Y');
    expect(r.querySelector('[data-print-option="ON"]')!.textContent).toContain('☑');
    expect(r.querySelector('[data-print-option="OFF"]')!.textContent).toContain('☐');
    expect(r.querySelector('[data-print-option="OFF"]')!.textContent).toContain('[OFF]');
  });
  it('미결이면 아무것도 ☑ 하지 않는다', async () => {
    const { DecisionDocPrint } = await import('@/app/(main)/admin/decisions/print-sheet');
    render(<DecisionDocPrint item={ITEMS[2]} measuredAt="2026-10-12T00:00:00.000Z" />);
    await waitFor(() => expect(root()?.querySelector('[data-print-option]')).toBeTruthy());
    expect([...root().querySelectorAll('[data-print-option]')].map((x) => x.getAttribute('data-print-chosen'))).toEqual(['N', 'N']);
    expect([...root().querySelectorAll('[data-print-option]')].some((x) => x.textContent!.includes('☑'))).toBe(false);
    expect(root().querySelector('[data-print-state]')!.getAttribute('data-print-state')).toBe('OPEN');
  });
});

describe('🔴 인쇄 CSS — 인쇄 루트가 없을 때 빈 종이가 되지 않는다', () => {
  const css = readFileSync(join(__dirname, '../../src/components/document/document.css'), 'utf8');
  const g = readFileSync(join(__dirname, '../../src/app/globals.css'), 'utf8');
  it('문서 CSS 의 숨김 규칙은 인쇄 루트가 있을 때만 · 워터마크는 남긴다', () => {
    const rules = css.split('\n').filter((l) => /display:\s*none/.test(l) && /body/.test(l) && /doc-print-root/.test(l) && !l.trim().startsWith('/*'));
    expect(rules.length).toBe(1);
    expect(rules[0]).toContain('body:has(> .doc-print-root) > *');
    expect(rules[0]).toContain(':not(.print-watermark)');
  });
  it('루트 없는 허용 인쇄는 앱 껍데기 높이·스크롤 가둠을 푼다 · 메뉴·상단 바 제외', () => {
    expect(g).toMatch(/html\.print-allowed body:not\(:has\(> \.doc-print-root\)\) :is\(\.h-screen, main\) \{ height: auto !important; overflow: visible !important; \}/);
    expect(g).toContain('[data-sidebar-shell], header[data-topbar-density]');
  });
  it('결정 대장·결정 문서가 인쇄본을 그린다', () => {
    const reg = readFileSync(join(__dirname, '../../src/app/(main)/admin/decisions/register/page.tsx'), 'utf8');
    const doc = readFileSync(join(__dirname, '../../src/app/(main)/admin/decisions/[key]/page.tsx'), 'utf8');
    expect(reg).toMatch(/<DecisionRegisterPrint items=\{items\}/);
    expect(doc).toMatch(/<DecisionDocPrint item=\{item\}/);
  });
});
