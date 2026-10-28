/**
 * 서버 발급 인쇄본 P1(2026-10-12 기획 `decision-print-remaining`) — 개시 브리핑·당직표·QI 보고서 · 발급 대상 아님 · 원장 미등재.
 *  · 발급되면 쪽 QR = 진위확인 주소 · 쪽 글자 = 발급번호 · 범례 끝 진위 문구도 발급 기준
 *  · 🔴 발급 원장에 오르지 않는 인쇄본(단축키 = 발급 대상 아님 · 환자 정보 = 사람 결정 D2 전 원장 미등재)은 QR 을 싣지 않는다
 *     — 대조할 곳이 없는 QR 은 인증인 척이다(G4)
 *  · 화면 줄 = shared 정본 함수(서버 발급 스냅샷과 같다)
 *  · 구조 가드: PrintDoc 을 그리는 곳은 발급 상태(발급 경로 또는 미발급 사유)를 반드시 넘긴다
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtl, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { dutyRosterPrintLines, goLivePrintLines } from '@hospital-run/shared';

vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: vi.fn(), post: vi.fn(), getToken: () => 'x' } }));
beforeEach(() => { cleanup(); document.body.querySelectorAll('.doc-print-root').forEach((e) => e.remove()); });
const render = (ui: React.ReactElement) => rtl(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const root = () => document.body.querySelector(':scope > .doc-print-root')!;
const qrStyle = () => root().querySelector('style[data-print-page-qr]')!;
const ISSUED = { issueNo: 'WRB-DUTY_ROSTER-20261012-0001', hash: 'c'.repeat(64), verifyUrl: 'https://his.example/verify/document/WRB-DUTY_ROSTER-20261012-0001?v=ABCDEFGHJK', issuedAt: 'x' };
const DAYS = [{ date: '2026-10-01', dayOfWeek: '목', shifts: [{ id: 'e1', shift: 'DAY', staffName: '김간호' }], leaves: [] }];

describe('발급된 인쇄본 — 쪽 QR = 진위확인 주소', () => {
  it('🔴 당직표 — 발급번호·발급 해시가 쪽 글자 · QR 준비 · 진위 문구는 발급 기준', async () => {
    const { DutyRosterPrint } = await import('@/components/print/DutyRosterPrint');
    render(<DutyRosterPrint month="2026-10" department="전체" days={DAYS} loading={false} leaveLabel={{}} issued={ISSUED} />);
    await waitFor(() => expect(qrStyle().getAttribute('data-print-page-qr')).toBe('ready'));
    expect(qrStyle().textContent).toContain(`${ISSUED.issueNo} · sha256 ${'c'.repeat(16)}`);
    expect(root().querySelector('[data-print-issue-no]')!.textContent).toContain(ISSUED.issueNo);
    expect(root().querySelector('[data-print-legend]')!.textContent).toContain('진위확인 주소');
    expect(root().querySelector('[data-print-legend]')!.textContent).not.toContain('QR·sha256');
    // 🔴 화면이 계산한 해시 = shared 정본 줄의 해시(서버가 같은 줄로 발급한다 — 다르면 발급 후 인쇄가 막힌다)
    await waitFor(() => expect(root().querySelector('[data-print-doc-hash]')!.textContent).toContain(createHash('sha256').update(dutyRosterPrintLines(DAYS).join('\n')).digest('hex')));
  });
  it('미리보기(발급 실패) — QR 없음 · 미발급 표시', async () => {
    const { DutyRosterPrint } = await import('@/components/print/DutyRosterPrint');
    render(<DutyRosterPrint month="2026-10" department="전체" days={DAYS} loading={false} leaveLabel={{}} unissued="PREVIEW" />);
    await waitFor(() => expect(qrStyle().getAttribute('data-print-page-qr')).toBe('none'));
    expect(qrStyle().textContent).not.toContain('url(data:');
    expect(root().querySelector('p[data-print-unissued="PREVIEW"]')!.textContent).toContain('미발급');
  });
});

describe('🔴 발급 원장에 오르지 않는 인쇄본 — QR 을 싣지 않는다', () => {
  it('단축키 — 발급 대상 아님', async () => {
    const { ShortcutsPrint } = await import('@/components/print/ShortcutsPrint');
    render(<ShortcutsPrint globalKeys={[]} actionKeys={[]} role="NURSE" who="x" grouped={[]} />);
    await waitFor(() => expect(qrStyle().getAttribute('data-print-page-qr')).toBe('none'));
    expect(qrStyle().textContent).toContain('발급 대상 아님');
    expect(qrStyle().textContent).not.toContain('url(data:');
    expect(root().querySelector('[data-print-legend]')!.textContent).toContain('진위확인을 할 수 없습니다');
  });
  it('환자 정보 인쇄본 — 원장 미등재(사람 결정 D2 전) · 4종 소스가 같은 사유를 넘긴다', () => {
    for (const f of ['app/(main)/patients/[id]/components/PatientChartPrint.tsx', 'app/(main)/inpatient/[admissionId]/DischargeSettlementPrint.tsx']) {
      expect(readFileSync(join(__dirname, '../../src', f), 'utf8'), f).toContain('unissued="PENDING_D2"');
    }
    const rec = readFileSync(join(__dirname, '../../src/components/record-timeline/RecordPrintBody.tsx'), 'utf8');
    expect(rec.match(/unissued="PENDING_D2"/g)?.length).toBe(2);
  });
});

describe('화면 줄 = shared 정본(서버 발급 스냅샷과 같은 함수)', () => {
  it('당직표 — 배정 + 승인 휴가 · 이름의 구분자는 지운다', () => {
    expect(dutyRosterPrintLines([{ date: '2026-10-01', shifts: [{ id: 'e2', shift: 'NIGHT', staffName: 'a|b' }], leaves: [{ userId: 'u', type: 'ANNUAL' }] }]))
      .toEqual(['L:2026-10-01:u|ANNUAL', 'S:e2|2026-10-01|NIGHT|a b']);
  });
  it('개시 브리핑 — 결정은 개시 전 필수만', () => {
    expect(goLivePrintLines([{ key: 'g', status: 'TODO' }], [{ key: 'a', decided: false, goLive: 'CAN_FOLLOW' }, { key: 'b', decided: true, goLive: 'REQUIRED_BEFORE', record: { choice: 'X', decidedAt: 't' } }]))
      .toEqual(['D:b|REAL|X|t', 'G:g|TODO']);
  });
});

describe('구조 가드', () => {
  const SRC = join(__dirname, '../../src');
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(n) ? [p] : []; });
  it('🔴 PrintDoc 을 그리는 곳은 발급 상태(발급·미발급 사유)를 넘긴다 — 아무것도 안 넘기면 옛 브라우저 해시 QR 로 떨어진다', () => {
    const users = walk(SRC).filter((f) => /<PrintDoc\b/.test(readFileSync(f, 'utf8'))).map((f) => relative(SRC, f));
    expect(users.length).toBeGreaterThanOrEqual(7); // 당직표·개시 브리핑·단축키·QI 보고서·환자 차트·퇴원 정산·기록(2026-10-12)
    const bad = users.filter((f) => !/unissued=|issued=\{|\{\.\.\.pr\.state\}/.test(readFileSync(join(SRC, f), 'utf8')));
    expect(bad).toEqual([]);
  });
  it('발급 연결 화면 — 개시 브리핑·당직표·QI 보고서는 직접 인쇄하지 않고 발급 훅을 지난다', () => {
    for (const [f, kind] of [['components/golive/GoLiveBriefing.tsx', 'GOLIVE_BRIEFING'], ['app/(main)/admin/duty-schedule/page.tsx', 'DUTY_ROSTER'], ['app/(main)/print/qi-report/[id]/page.tsx', 'QI_REPORT']]) {
      const s = readFileSync(join(SRC, f), 'utf8');
      expect(s, f).toContain(`usePrintIssue('${kind}'`);
      expect(s, f).not.toContain('sanctionedPrint');
    }
  });
});
