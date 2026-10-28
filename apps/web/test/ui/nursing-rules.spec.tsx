/**
 * 간호 원내 규정 화면 3418 · 간호 스테이션 통증 재평가 탭 · 인계 인수 방식(2026-10-26).
 *  · 🔴 쓰기 폼은 미선택으로 시작 — 코드 기본값을 원내 규정처럼 미리 채우지 않는다 · 형식 맞을 때만 저장 · 보낸 값 그대로
 *  · 🔴 통증 규정이 없으면 목록이 아니라 "규정 없음" — "대기 0"이라 말하지 않는다 · 분류 모르는 투약 수 · 범위 밖 수
 *  · 🔴 인수 방식을 모르면 인수 확인만(짐작으로 담당 인수 단추를 주지 않는다)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, act, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), getToken: () => 't' }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: api }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
beforeEach(() => { cleanup(); api.get.mockReset(); api.put.mockReset(); });

const wrap = (el: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{el}</QueryClientProvider>;
const OVERVIEW_UNSET = {
  restraint: { minutes: 120, source: 'CODE_DEFAULT' },
  painReassess: { rule: null, source: 'UNSET' },
  handoffAckMode: { mode: 'OFFER_BOTH', source: 'CODE_DEFAULT' },
};

async function mountAdmin(overview: unknown = OVERVIEW_UNSET) {
  api.get.mockImplementation(async () => ({ data: overview }));
  api.put.mockResolvedValue({ data: {} });
  const { default: Page } = await import('@/app/(main)/admin/nursing-rules/page');
  let v!: ReturnType<typeof render>;
  await act(async () => { v = render(wrap(<Page />)); });
  await waitFor(() => expect(v.container.querySelector('[data-rule-section="pain"]')).not.toBeNull());
  return v;
}
const q = (v: ReturnType<typeof render>, sel: string) => v.container.querySelector(sel) as HTMLInputElement;

describe('🔴 간호 원내 규정 화면', () => {
  it('미설정이면 빈 칸·미선택으로 시작 · 출처 배지 · 저장 잠김', async () => {
    const v = await mountAdmin();
    expect(q(v, '[data-field="threshold"]').value).toBe('');
    expect(q(v, '[data-field="within"]').value).toBe('');
    expect(q(v, '[data-field="restraint"]').value).toBe('');
    expect([...v.container.querySelectorAll('input[name="ack-mode"]')].some((e) => (e as HTMLInputElement).checked)).toBe(false);
    expect(v.container.querySelector('[data-rule-section="pain"] [data-rule-source]')!.getAttribute('data-rule-source')).toBe('UNSET');
    expect(v.container.querySelector('[data-rule-section="handoff"] [data-rule-source]')!.getAttribute('data-rule-source')).toBe('CODE_DEFAULT');
    for (const k of ['pain', 'handoff', 'restraint']) expect((q(v, `[data-save="${k}"]`) as unknown as HTMLButtonElement).disabled).toBe(true);
  });
  it('통증 규정 — 진통제 여부를 고르기 전엔 저장 불가 · 고르면 보낸 값 그대로', async () => {
    const v = await mountAdmin();
    fireEvent.change(q(v, '[data-field="threshold"]'), { target: { value: '4' } });
    fireEvent.change(q(v, '[data-field="within"]'), { target: { value: '60' } });
    expect((q(v, '[data-save="pain"]') as unknown as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(v.container.querySelectorAll('input[name="analgesic"]')[0]);
    fireEvent.change(q(v, '[data-field="analgesic-min"]'), { target: { value: '30' } });
    await act(async () => { fireEvent.click(q(v, '[data-save="pain"]')); });
    expect(api.put).toHaveBeenCalledWith('/api/v1/config/nursing.pain.reassessRule', { value: { thresholdScore: 4, withinMinutes: 60, afterAnalgesicMinutes: 30 } });
  });
  it('형식 밖 기한(10분)이면 저장 불가 · 인수 방식 고르면 그 값 · 보호대 간격', async () => {
    const v = await mountAdmin();
    fireEvent.change(q(v, '[data-field="threshold"]'), { target: { value: '4' } });
    fireEvent.change(q(v, '[data-field="within"]'), { target: { value: '10' } });
    fireEvent.click(v.container.querySelectorAll('input[name="analgesic"]')[1]);
    expect((q(v, '[data-save="pain"]') as unknown as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(v.container.querySelector('[data-mode-option="ALWAYS_BUNDLED"] input')!);
    await act(async () => { fireEvent.click(q(v, '[data-save="handoff"]')); });
    expect(api.put).toHaveBeenCalledWith('/api/v1/config/nursing.handoff.ackTakeOverMode', { value: 'ALWAYS_BUNDLED' });
    fireEvent.change(q(v, '[data-field="restraint"]'), { target: { value: '90' } });
    await act(async () => { fireEvent.click(q(v, '[data-save="restraint"]')); });
    expect(api.put).toHaveBeenCalledWith('/api/v1/config/nursing.restraint.checkIntervalMinutes', { value: 90 });
  });
  it('원내 설정이 있으면 그 값으로 채운다', async () => {
    const v = await mountAdmin({
      restraint: { minutes: 60, source: 'CONFIGURED' },
      painReassess: { rule: { thresholdScore: 5, withinMinutes: 45, afterAnalgesicMinutes: null }, source: 'CONFIGURED' },
      handoffAckMode: { mode: 'SEPARATE', source: 'CONFIGURED' },
    });
    expect(q(v, '[data-field="threshold"]').value).toBe('5');
    expect(q(v, '[data-field="restraint"]').value).toBe('60');
    expect((v.container.querySelector('[data-mode-option="SEPARATE"] input') as HTMLInputElement).checked).toBe(true);
    expect((v.container.querySelectorAll('input[name="analgesic"]')[1] as HTMLInputElement).checked).toBe(true);
  });
});

describe('🔴 위험 재평가 주기(2026-10-27)', () => {
  const RI = { FALL_RISK: { HIGH: 2, MODERATE: 4, LOW: 8 }, PRESSURE_ULCER: { HIGH: 4, MODERATE: 8, LOW: 24 } };
  it('코드 기본값이면 빈 칸(지금 값은 회색 안내) · 고위험이 더 길면 저장 불가 · 맞으면 보낸 표 그대로', async () => {
    const v = await mountAdmin({ ...OVERVIEW_UNSET, riskReassessIntervals: { table: RI, source: 'CODE_DEFAULT' } });
    expect(q(v, '[data-field="risk-FALL_RISK-HIGH"]').value).toBe('');
    expect(q(v, '[data-field="risk-FALL_RISK-HIGH"]').placeholder).toBe('2');
    const set = (t: string, l: string, val: string) => fireEvent.change(q(v, `[data-field="risk-${t}-${l}"]`), { target: { value: val } });
    set('FALL_RISK', 'HIGH', '10'); set('FALL_RISK', 'MODERATE', '4'); set('FALL_RISK', 'LOW', '8');
    set('PRESSURE_ULCER', 'HIGH', '4'); set('PRESSURE_ULCER', 'MODERATE', '8'); set('PRESSURE_ULCER', 'LOW', '24');
    expect((q(v, '[data-save="risk"]') as unknown as HTMLButtonElement).disabled).toBe(true);
    set('FALL_RISK', 'HIGH', '1');
    await act(async () => { fireEvent.click(q(v, '[data-save="risk"]')); });
    expect(api.put).toHaveBeenCalledWith('/api/v1/config/nursing.riskReassess.intervalHours', { value: { FALL_RISK: { HIGH: 1, MODERATE: 4, LOW: 8 }, PRESSURE_ULCER: { HIGH: 4, MODERATE: 8, LOW: 24 } } });
  });
  it('개발 시드면 채워지고 "이 값으로 원내 확정" · 시드 안내 수에 든다', async () => {
    const v = await mountAdmin({ ...OVERVIEW_UNSET, riskReassessIntervals: { table: RI, source: 'SEED' } });
    expect(q(v, '[data-field="risk-PRESSURE_ULCER-LOW"]').value).toBe('24');
    expect(q(v, '[data-save="risk"]').textContent).toContain('이 값으로 원내 확정');
    expect(v.container.querySelector('[data-rules-seeded]')!.getAttribute('data-rules-seeded')).toBe('1');
  });
});

describe('🔴 개발 시드 규정(2026-10-27)', () => {
  const SEEDED = {
    restraint: { minutes: 120, source: 'SEED' },
    painReassess: { rule: { thresholdScore: 4, withinMinutes: 60, afterAnalgesicMinutes: 60 }, source: 'SEED' },
    handoffAckMode: { mode: 'OFFER_BOTH', source: 'SEED' },
  };
  it('시드 값으로 채우고 "원내 규정 아님" 배지·안내 · 저장 단추는 "이 값으로 원내 확정" · 저장하면 같은 값을 보낸다', async () => {
    const v = await mountAdmin(SEEDED);
    expect(v.container.querySelector('[data-rules-seeded]')!.getAttribute('data-rules-seeded')).toBe('3');
    expect([...v.container.querySelectorAll('[data-rule-source]')].map((e) => e.getAttribute('data-rule-source'))).toEqual(['SEED', 'SEED', 'SEED']);
    expect(q(v, '[data-field="threshold"]').value).toBe('4');
    expect(q(v, '[data-field="restraint"]').value).toBe('120');
    expect((v.container.querySelector('[data-mode-option="OFFER_BOTH"] input') as HTMLInputElement).checked).toBe(true);
    expect(q(v, '[data-save="pain"]').textContent).toContain('이 값으로 원내 확정');
    await act(async () => { fireEvent.click(q(v, '[data-save="pain"]')); });
    expect(api.put).toHaveBeenCalledWith('/api/v1/config/nursing.pain.reassessRule', { value: { thresholdScore: 4, withinMinutes: 60, afterAnalgesicMinutes: 60 } });
  });
  it('원내 설정만이면 시드 안내 없음 · 단추는 "규정 저장"', async () => {
    const v = await mountAdmin({ ...SEEDED, restraint: { minutes: 60, source: 'CONFIGURED' }, painReassess: { ...SEEDED.painReassess, source: 'CONFIGURED' }, handoffAckMode: { mode: 'SEPARATE', source: 'CONFIGURED' } });
    expect(v.container.querySelector('[data-rules-seeded]')).toBeNull();
    expect(q(v, '[data-save="pain"]').textContent).toContain('규정 저장');
  });
});

async function mountPain(payload: unknown, scope: string[] = ['a1'], reject = false) {
  api.get.mockImplementation(async () => { if (reject) throw new Error('500'); return { data: payload }; });
  const { PainReassessTab } = await import('@/app/(main)/nurse-station/pain-reassess');
  let v!: ReturnType<typeof render>;
  await act(async () => { v = render(wrap(<PainReassessTab scopeAdmissionIds={new Set(scope)} onRecordVitals={() => undefined} />)); });
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/v1/nursing-rules/pain-reassessment'));
  return v;
}
const ITEM = (id: string, status: 'DUE' | 'OVERDUE') => ({
  admissionId: id, patient: { id: 'p', familyName: '김', givenName: '가람', mrn: 'M1' }, ward: { id: 'w', name: '5병동' }, room: '501-A',
  lastPain: { at: '2026-10-26T01:00:00Z', score: 7 }, trigger: { kind: 'PAIN_SCORE', at: '2026-10-26T01:00:00Z', score: 7 }, dueAt: '2026-10-26T02:00:00Z', status, minutes: 20,
});

describe('🔴 통증 재평가 탭', () => {
  it('규정 미설정 → 규정 없음 안내(목록·"대기 0" 없음)', async () => {
    const v = await mountPain({ rule: null, ruleSource: 'UNSET', reason: 'RULE_UNSET', windowHours: 24, items: null, admissions: null, unclassifiedAdministrations: null, generatedAt: '' });
    await waitFor(() => expect(v.container.querySelector('[data-pain-reason="RULE_UNSET"]')).not.toBeNull());
    expect(v.container.querySelector('[data-pain-reassess]')).toBeNull();
  });
  it('조회 실패는 대기 없음이 아니다', async () => {
    const v = await mountPain(null, ['a1'], true);
    await waitFor(() => expect(v.container.textContent).not.toContain('재평가 대기가 없습니다'));
    expect(v.container.querySelector('[data-pain-reassess]')).toBeNull();
  });
  it('🔴 개발 시드 규정이면 그렇다고 말한다', async () => {
    const v = await mountPain({ rule: { thresholdScore: 4, withinMinutes: 60, afterAnalgesicMinutes: null }, ruleSource: 'SEED', reason: null, windowHours: 24, items: [], admissions: 0, unclassifiedAdministrations: null, generatedAt: '' });
    await waitFor(() => expect(v.container.querySelector('[data-pain-rule-seed]')).not.toBeNull());
  });
  it('규정 표시 · 범위로 거름 · 범위 밖 수 · 분류 모르는 투약 수 · 지연 수', async () => {
    const v = await mountPain({
      rule: { thresholdScore: 4, withinMinutes: 60, afterAnalgesicMinutes: 30 }, ruleSource: 'CONFIGURED', reason: null, windowHours: 24,
      items: [ITEM('a1', 'OVERDUE'), ITEM('a9', 'DUE')], admissions: 2, unclassifiedAdministrations: 3, generatedAt: '',
    });
    await waitFor(() => expect(v.container.querySelector('[data-pain-reassess]')).not.toBeNull());
    expect(v.container.querySelectorAll('[data-pain-item]').length).toBe(1);
    expect(v.container.querySelector('[data-pain-overdue]')!.getAttribute('data-pain-overdue')).toBe('1');
    expect(v.container.querySelector('[data-pain-unclassified]')!.getAttribute('data-pain-unclassified')).toBe('3');
    expect(v.container.querySelector('[data-pain-rule]')!.textContent).toContain('4');
    expect(v.container.textContent).toContain('1');
  });
});

describe('🔴 인계 인수 방식 — 간호 스테이션', () => {
  const code = readFileSync(join(__dirname, '../../src/app/(main)/nurse-station/page.tsx'), 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}|\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  it('두 단추는 OFFER_BOTH 일 때만 · 늘 묶음이면 단추 하나(서버가 담당 인수) · 묶지 않음 안내 · 모르면 인수 확인만', () => {
    expect(code).toMatch(/\{ackMode === 'OFFER_BOTH' && isNursingShift\(h\) && h\.admissionId && \(/);
    expect(code).toMatch(/ackMode === 'ALWAYS_BUNDLED' && isNursingShift\(h\) && h\.admissionId \? <T k="인수 확인 \+ 담당 인수" \/> : <T k="인수 확인" \/>/);
    expect(code).toMatch(/data-ack-mode-hint="SEPARATE"/);
    expect(code).toMatch(/ackMode == null && \([\s\S]{0,120}data-ack-mode-hint="UNKNOWN"/);
    expect(code).toMatch(/const ackMode = rulesQ\.data\?\.handoffAckMode\?\.mode \?\? null;/);
  });
  it('늘 묶음 응답의 담당 인수 실패를 성공처럼 말하지 않는다', () => {
    expect(code).toMatch(/takeOver\?\.mode === 'ALWAYS_BUNDLED' && takeOver\.done/);
    expect(code).toMatch(/인수 확인은 기록됐지만 담당 인수는 하지 않았습니다/);
  });
});
