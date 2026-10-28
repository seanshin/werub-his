import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
// 계측 규칙 정본은 스캐너 하나 — 주석 속 `.catch(() => {})` 문구가 문자열 검사에 걸리던 전례(주석 토크나이저를 다시 만들지 않는다)
import { stripComments } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 D7 — 대화 패널의 서버 쓰기 3자리(화자 토글·발화 삭제·반영 provenance)가 `.catch(() => {})` 로 실패를 삼켰다
 *    (voice-emr-ambient-conversation.plan.md §13.2 P1-2). 삭제는 "지워진 척"(서버 deleted=false), 반영은 출처가 빠져
 *    서명 시 편집거리가 영원히 null. 여기서 지키는 사실 — **각 항목은 결함을 재주입하면 실패한다**:
 *      ① 삭제 실패 = 카드 복원 + 오류 토스트 · ② 화자 토글 실패 = 이전 라벨 복원 + 안내
 *      ③ 반영 실패 = 텍스트는 그대로(되돌리지 않는다) + 배너 + 재시도 버튼(재시도 성공 시 배너 소멸)
 *      ④ 동의 필요 오류에 동의 접수 화면 링크 · ⑤ 분석 응답의 비식별 건수/AI 생략 사유를 그린다(D5)
 *      ⑥ 소스 가드 — 패널에 `.catch(() => {})` 가 0
 */
const { ambient, voice, toastMock, captureOpts } = vi.hoisted(() => ({
  ambient: {
    start: vi.fn(), get: vi.fn(), addUtterance: vi.fn(), patchUtterance: vi.fn(), close: vi.fn(), analyze: vi.fn(), apply: vi.fn(),
  },
  voice: { start: vi.fn(), chunk: vi.fn(), close: vi.fn() },
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  captureOpts: { current: null as null | { onFinal: (r: { text?: string; confidence?: number }, reason: string) => void } },
}));

vi.mock('@/lib/voice-api', () => ({ ambientApi: ambient, voiceApi: voice }));
vi.mock('@/stores/toast-store', () => ({ toast: toastMock }));
vi.mock('@/lib/ui-settings', () => ({ kdate: () => '10:00' }));
vi.mock('@/components/scribe/RecordingConsentGate', () => ({
  default: ({ onConsent }: { onConsent: () => void }) => <button type="button" onClick={onConsent}>consent-ok</button>,
}));
vi.mock('@/components/voice-emr/useAmbientCapture', () => ({
  useAmbientCapture: (opts: any) => {
    captureOpts.current = opts;
    return { begin: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined), setPaused: vi.fn() };
  },
}));

import ConversationStreamPanel from '../../src/components/voice-emr/ConversationStreamPanel';

const ENT = { symptoms: [{ term: '기침', negated: false }], vitals: [], medications: [], plan: [] };

async function openWithUtterance(onAppendSoap?: (f: string, t: string) => void) {
  ambient.start.mockResolvedValue({ id: 's1', status: 'RECORDING', patient: { name: '강미경', mrn: 'P1' } });
  voice.start.mockResolvedValue({ id: 'v1' });
  ambient.addUtterance.mockResolvedValue({ seq: 0, entities: ENT });
  render(<ConversationStreamPanel encounterId="e1" onAppendSoap={onAppendSoap as any} />);
  act(() => { window.dispatchEvent(new Event('voice:ambient-open')); });
  fireEvent.click(await screen.findByText('consent-ok'));
  await waitFor(() => expect(screen.getByText('기록 중')).toBeTruthy());
  await act(async () => { captureOpts.current!.onFinal({ text: '기침이 나요', confidence: 0.9 }, 'silence'); });
  await waitFor(() => expect(screen.getByText('기침이 나요')).toBeTruthy());
  await waitFor(() => expect(screen.getByText('S에 반영')).toBeTruthy());
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom 에는 Element.scrollTo 가 없다(패널의 자동 스크롤 effect) — 화면 동작과 무관한 환경 스텁
  if (typeof (Element.prototype as any).scrollTo !== 'function') (Element.prototype as any).scrollTo = () => {};
});

describe('대화 패널 — 서버 쓰기 실패를 되돌리고 말한다(D7)', () => {
  it('🔴 ① 삭제 실패: 카드가 복원되고 "서버에서 삭제되지 않았습니다"를 말한다', async () => {
    await openWithUtterance();
    ambient.patchUtterance.mockRejectedValueOnce(new Error('500'));
    fireEvent.click(screen.getByTitle('삭제(기록 제외)'));
    // 낙관적 삭제 → 실패 → 복원
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('서버에서 삭제되지 않았습니다')));
    expect(screen.getByText('기침이 나요')).toBeTruthy();
    expect(ambient.patchUtterance).toHaveBeenCalledWith('s1', 0, { deleted: true });
  });

  it('대조군 — 삭제 성공은 카드가 사라지고 오류를 말하지 않는다', async () => {
    await openWithUtterance();
    ambient.patchUtterance.mockResolvedValueOnce({ seq: 0, deleted: true, entities: null });
    fireEvent.click(screen.getByTitle('삭제(기록 제외)'));
    await waitFor(() => expect(screen.queryByText('기침이 나요')).toBeNull());
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('🔴 ② 화자 토글 실패: 이전 라벨로 되돌리고 안내한다', async () => {
    await openWithUtterance();
    const btn = screen.getByTitle('화자 정정(탭)');
    const before = btn.textContent;
    ambient.patchUtterance.mockRejectedValueOnce(new Error('500'));
    fireEvent.click(btn);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('화자 변경이 서버에 저장되지 않았습니다')));
    expect(screen.getByTitle('화자 정정(탭)').textContent).toBe(before);
  });

  it('🔴 ③ 반영 provenance 실패: 텍스트는 SOAP 에 그대로 두고 배너+재시도 — 재시도 성공 시 배너가 사라진다', async () => {
    const append = vi.fn();
    await openWithUtterance(append);
    ambient.apply.mockRejectedValueOnce(new Error('500'));
    fireEvent.click(screen.getByText('S에 반영'));
    expect(append).toHaveBeenCalledWith('subjective', expect.stringContaining('기침'));
    const banner = await screen.findByTestId('provenance-failed');
    expect(banner.textContent).toContain('출처 기록 실패');
    expect(banner.textContent).toContain('1건');
    expect(append).toHaveBeenCalledTimes(1); // 텍스트를 되돌리거나 다시 붙이지 않는다

    ambient.apply.mockResolvedValueOnce({ ok: true });
    fireEvent.click(screen.getByText('출처 다시 기록'));
    await waitFor(() => expect(screen.queryByTestId('provenance-failed')).toBeNull());
    expect(ambient.apply).toHaveBeenCalledTimes(2);
    expect(ambient.apply.mock.calls[1][1]).toMatchObject({ field: 'subjective', engine: 'RULE', sourceSeqs: [0] });
  });

  it('④ RECORDING 동의 없음 → 동의 접수 화면 링크(/workstation/consent)를 함께 그린다', async () => {
    ambient.start.mockRejectedValueOnce(new Error('RECORDING_CONSENT_REQUIRED'));
    render(<ConversationStreamPanel encounterId="e1" />);
    act(() => { window.dispatchEvent(new Event('voice:ambient-open')); });
    fireEvent.click(await screen.findByText('consent-ok'));
    const link = await screen.findByTestId('consent-workstation-link');
    expect(link.getAttribute('href')).toBe('/workstation/consent');
  });

  it('⑤ 분석 응답의 비식별 건수·AI 생략 사유를 그린다(D5) — null 이면 그리지 않는다', async () => {
    await openWithUtterance();
    const coverage1 = { utterances: 1, withEntities: 1, noEntities: 0, lowConfidence: 0, skipped: 0 };
    ambient.analyze.mockResolvedValueOnce({
      engine: 'RULE+AI', suggestions: [], skipped: [], coverage: coverage1, droppedTotal: 0,
      redacted: { names: 3, ids: 1 }, aiSkipped: null,
    });
    fireEvent.click(screen.getByText('SOAP 분석'));
    const red = await screen.findByTestId('ai-redacted');
    expect(red.textContent).toContain('3');
    expect(red.textContent).toContain('1');
    expect(screen.queryByTestId('ai-skipped')).toBeNull();

    ambient.analyze.mockResolvedValueOnce({
      engine: 'RULE', suggestions: [], skipped: [], coverage: coverage1, droppedTotal: 0,
      redacted: null, aiSkipped: 'NAMES_UNAVAILABLE',
    });
    fireEvent.click(screen.getByText('SOAP 분석'));
    await waitFor(() => expect(screen.getByTestId('ai-skipped').textContent).toContain('비식별 없이 보내지 않았습니다'));
    expect(screen.queryByTestId('ai-redacted')).toBeNull();
  });

  it('🔴 D2 — 머리글이 분모를 말한다("N발화 중 M발화에서 제안") · 분모 0은 "산출 불가"(0을 다른 사실과 섞지 않는다)', async () => {
    await openWithUtterance();
    ambient.analyze.mockResolvedValueOnce({
      engine: 'RULE', suggestions: [], skipped: [],
      coverage: { utterances: 12, withEntities: 7, noEntities: 3, lowConfidence: 1, skipped: 1 },
      droppedTotal: 0, redacted: null, aiSkipped: null,
    });
    fireEvent.click(screen.getByText('SOAP 분석'));
    await waitFor(() => expect(screen.getByText(/12발화 중 7발화에서 제안/)).toBeTruthy());

    ambient.analyze.mockResolvedValueOnce({
      engine: 'RULE', suggestions: [], skipped: [],
      coverage: { utterances: 0, withEntities: 0, noEntities: 0, lowConfidence: 0, skipped: 0 },
      droppedTotal: 0, redacted: null, aiSkipped: null,
    });
    fireEvent.click(screen.getByText('SOAP 분석'));
    await waitFor(() => expect(screen.getByText(/산출 불가/)).toBeTruthy());
  });
});

describe('소스 가드 — 패널에 삼키는 catch 가 없다', () => {
  const src = stripComments(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'voice-emr', 'ConversationStreamPanel.tsx'), 'utf8')) as string;
  it('⑥ `.catch(() => {})` 0 · 동의 링크 · 재시도 버튼이 소스에 있다', () => {
    const swallow = src.match(/\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/g) ?? [];
    expect(swallow, swallow.join('\n')).toEqual([]);
    expect(src).toContain('href="/workstation/consent"');
    expect(src).toMatch(/ambientApi\.apply\([^)]*\)\.catch\(/);
  });
});
