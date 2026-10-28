/**
 * AI 어시스턴트 패널 재구성(2026-10-02).
 *  · 오른쪽에 붙는다(왼쪽 232px 고정 아님) · 명령 팔레트 = shared 정본(역할·맥락으로 미리 막음)
 *  · 환자 맥락: 화면이 건 patientId·작성 중 SOAP 를 보낸다(이름·나이·성별은 보내지 않는다) · 맥락 빼고 묻기
 *  · 출처 배지 · UNAVAILABLE 은 실패로 · AI 를 부르지 않은 응답은 이유만(면책 문구 없음) · 초안 표지
 *  · 환자가 바뀌면 대화를 새로
 *  · 마크다운은 요소로(`**` 가 글자로 보이지 않는다) · HTML 은 해석하지 않는다
 * 재주입: 맥락 전송을 지우면, 출처 배지 분기를 지우면, 환자 전환 초기화를 지우면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AI_CHAT_COMMANDS } from '@hospital-run/shared';

const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: vi.fn(), post: (...a: unknown[]) => post(...a), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
let role = 'DOCTOR';
vi.mock('@/stores/auth-store', () => ({ useAuthStore: (sel?: (s: unknown) => unknown) => { const st = { user: { role } }; return sel ? sel(st) : st; } }));

const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
const PID = '11111111-1111-4111-8111-111111111111';

async function setup() {
  const { AiChatBar } = await import('@/components/ai/AiChatBar');
  const { useAiChatStore } = await import('@/stores/ai-chat-store');
  return { AiChatBar, store: useAiChatStore };
}

beforeEach(async () => {
  cleanup(); post.mockReset(); role = 'DOCTOR';
  const { useAiChatStore } = await import('@/stores/ai-chat-store');
  useAiChatStore.setState({ context: null, soapGetter: null, wide: false, pendingQuestion: null });
});

describe('배치·팔레트', () => {
  it('🔴 오른쪽에 붙는다 — 사이드바 폭(232px)에 묶이지 않는다', () => {
    const src = readFileSync(join(__dirname, '../../src/components/ai/AiChatBar.tsx'), 'utf8');
    expect(src).not.toMatch(/left-\[232px\]/);
    expect(src).toMatch(/right-0/);
  });

  it('🔴 팔레트는 정본 전 명령(도움 제외)을 그리고 · ADMIN 에겐 임상 판단 명령이 없다', async () => {
    const { AiChatBar } = await setup();
    const { container, unmount } = render(<AiChatBar isOpen onClose={() => {}} />, { wrapper: wrap });
    const shown = [...container.querySelectorAll('[data-ai-cmd]')].map((b) => b.getAttribute('data-ai-cmd'));
    expect(shown.sort()).toEqual(AI_CHAT_COMMANDS.filter((c) => c.cmd !== '/도움').map((c) => c.cmd).sort());
    unmount();
    role = 'ADMIN';
    const r2 = render(<AiChatBar isOpen onClose={() => {}} />, { wrapper: wrap });
    expect(r2.container.querySelector('[data-ai-cmd="/감별"]')).toBeNull();
    expect(r2.container.querySelector('[data-ai-cmd="/참고"]')).not.toBeNull();
  });

  it('맥락이 없으면 SOAP·환자가 필요한 명령은 미리 막힌다', async () => {
    const { AiChatBar } = await setup();
    const { container } = render(<AiChatBar isOpen onClose={() => {}} />, { wrapper: wrap });
    expect((container.querySelector('[data-ai-cmd="/요약"]') as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('[data-ai-cmd="/재입원"]') as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('[data-ai-cmd="/참고"]') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('맥락 전송', () => {
  it('🔴 화면이 건 환자·작성 중 SOAP 를 보낸다(이름은 보내지 않는다) · 맥락 빼고 묻기', async () => {
    const { AiChatBar, store } = await setup();
    store.getState().setContext({ patientId: PID, patientName: '홍길동', encounterId: null, surface: 'ENCOUNTER' }, () => ({ subjective: '두통 3일' }));
    post.mockResolvedValue({ data: { cmd: '/요약', type: 'summarize', source: 'AI', draft: true, data: { summary: { subjective: '두통' } } } });
    const { container, getByText } = render(<AiChatBar isOpen onClose={() => {}} />, { wrapper: wrap });
    expect(container.querySelector('[data-ai-context-patient]')!.textContent).toBe('홍길동');
    fireEvent.click(container.querySelector('[data-ai-cmd="/요약"]')!);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [, body] = post.mock.calls[0];
    expect(body).toEqual({ message: '/요약', context: { patientId: PID, soap: { subjective: '두통 3일' } } });
    expect(JSON.stringify(body)).not.toContain('홍길동');
    await waitFor(() => expect(container.querySelector('[data-ai-draft]')).not.toBeNull());

    fireEvent.click(getByText('맥락 빼고 묻기'));
    const ta = container.querySelector('textarea')!;
    fireEvent.change(ta, { target: { value: '두통 치료' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][1]).toEqual({ message: '두통 치료' });
  });

  it('🔴 환자가 바뀌면 대화를 새로 시작한다', async () => {
    const { AiChatBar, store } = await setup();
    store.getState().setContext({ patientId: PID, patientName: 'A', surface: 'PATIENT' });
    post.mockResolvedValue({ data: { cmd: null, type: 'chat', source: 'AI', draft: false, data: { answer: '답 A' } } });
    const { container } = render(<AiChatBar isOpen onClose={() => {}} />, { wrapper: wrap });
    const ta = container.querySelector('textarea')!;
    fireEvent.change(ta, { target: { value: '질문' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    await waitFor(() => expect(container.textContent).toContain('답 A'));
    act(() => store.getState().setContext({ patientId: '22222222-2222-4222-8222-222222222222', patientName: 'B', surface: 'PATIENT' }));
    await waitFor(() => expect(container.textContent).not.toContain('답 A'));
    expect(container.textContent).toContain('환자 맥락이 바뀌어 새 대화를 시작했습니다');
  });
});

describe('출처·이유', () => {
  async function ask(env: unknown) {
    const { AiChatBar } = await setup();
    post.mockResolvedValue({ data: env });
    const r = render(<AiChatBar isOpen onClose={() => {}} />, { wrapper: wrap });
    const ta = r.container.querySelector('textarea')!;
    fireEvent.change(ta, { target: { value: '/참고 두통' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    await waitFor(() => expect(r.container.querySelector('[data-ai-message],[data-ai-notice],[data-ai-failed]')).not.toBeNull());
    return r.container;
  }

  it('🔴 UNAVAILABLE 은 실패로 말한다(빈 답이 아니다) · 세부 코드 표시', async () => {
    const c = await ask({ cmd: '/참고', type: 'reference', source: 'UNAVAILABLE', reason: 'UPSTREAM_ERROR', detail: 'AI_SERVER_URL_UNSET', draft: false, data: null });
    expect(c.querySelector('[data-ai-unavailable]')!.textContent).toContain('받지 못한 것입니다');
    expect(c.textContent).toContain('AI_SERVER_URL_UNSET');
    expect(c.textContent).not.toContain('빈 결과');
  });

  it('AI 를 부르지 않은 응답 = 이유만 · 면책 문구 없음', async () => {
    const c = await ask({ cmd: '/감별', type: 'notice', source: null, reason: 'ARG_REQUIRED', draft: false, data: null });
    expect(c.querySelector('[data-ai-notice="ARG_REQUIRED"]')).not.toBeNull();
    expect(c.textContent).not.toContain('최종 판단은 반드시 의료진이');
  });

  it('대조군 — AI 답은 AI 배지·마크다운 요소·면책 문구 · 빈 답은 "빈 결과"', async () => {
    const c = await ask({ cmd: '/참고', type: 'reference', source: 'AI', draft: false, data: { answer: '**굵게** 와 `코드` <b>x</b>' }, disclaimer: '참고용 면책' });
    expect(c.querySelector('[data-ai-source="AI"]')).not.toBeNull();
    expect(c.querySelector('[data-rich-text] strong')!.textContent).toBe('굵게');
    expect(c.textContent).not.toContain('**');
    expect(c.querySelector('[data-rich-text] b')).toBeNull(); // HTML 은 해석하지 않는다
    expect(c.textContent).toContain('참고용 면책');
    cleanup();
    const e = await ask({ cmd: '/참고', type: 'reference', source: 'AI', draft: false, data: { answer: '' } });
    expect(e.querySelector('[data-ai-empty]')).not.toBeNull();
  });

  it('FALLBACK 은 "AI 답이 아님"을 말한다', async () => {
    const c = await ask({ cmd: '/추론', type: 'reasoning', source: 'FALLBACK', detail: 'UPSTREAM_ERROR', draft: false, data: { steps: [] } });
    expect(c.textContent).toContain('AI 답이 아닙니다');
    expect(c.querySelector('[data-ai-source="FALLBACK"]')).not.toBeNull();
  });

  it('모르는 모양은 덤프가 아니라 "정리하지 못한 응답"+접힌 원본', async () => {
    const c = await ask({ cmd: '/매핑', type: 'mapping', source: 'AI', draft: false, data: { weird: 1 } });
    expect(c.querySelector('[data-ai-unshaped] details')).not.toBeNull();
  });

  it('🔴 초안은 제안 원장에 남았는지·왜 안 남았는지를 말한다(실패 ≠ 만들지 않음)', async () => {
    let c = await ask({ cmd: '/요약', type: 'summarize', source: 'AI', draft: true, data: { summary: { subjective: 'S' } }, proposal: { proposalId: 'p1' } });
    expect(c.querySelector('[data-ai-proposal="CREATED"]')!.textContent).toContain('제안 원장에 기록됨');
    cleanup();
    c = await ask({ cmd: '/설명', type: 'explain', source: 'AI', draft: true, data: { explanation: 'x' }, proposal: { proposalId: null, proposalSkipped: 'KIND_UNMAPPED' } });
    expect(c.querySelector('[data-ai-proposal="KIND_UNMAPPED"]')).not.toBeNull();
    cleanup();
    c = await ask({ cmd: '/요약', type: 'summarize', source: 'AI', draft: true, data: { summary: { subjective: 'S' } }, proposal: { proposalId: null, proposalError: 'PROPOSAL_CREATE_FAILED' } });
    expect(c.querySelector('[data-ai-proposal="PROPOSAL_CREATE_FAILED"]')!.textContent).toContain('실패');
  });

  it('요청 실패(HTTP)는 AI 응답과 구분한다', async () => {
    const { AiChatBar } = await setup();
    post.mockRejectedValue(new Error('403 Forbidden'));
    const { container } = render(<AiChatBar isOpen onClose={() => {}} />, { wrapper: wrap });
    const ta = container.querySelector('textarea')!;
    fireEvent.change(ta, { target: { value: '질문' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    await waitFor(() => expect(container.querySelector('[data-ai-failed]')).not.toBeNull());
    expect(container.querySelector('[data-ai-message]')).toBeNull();
  });
});

describe('화면 배선', () => {
  it('🔴 환자·진료·입원 화면이 맥락을 건다(소비처 0 재발 금지) · 진료 화면은 SOAP 까지', () => {
    const root = join(__dirname, '../../src/app/(main)');
    const enc = readFileSync(join(root, 'patients/[id]/encounter/new/page.tsx'), 'utf8');
    expect(enc).toMatch(/useAiAssistantContext\([\s\S]{0,300}surface: 'ENCOUNTER'[\s\S]{0,40}soap,/);
    expect(readFileSync(join(root, 'patients/[id]/page.tsx'), 'utf8')).toContain("surface: 'PATIENT'");
    expect(readFileSync(join(root, 'inpatient/[admissionId]/page.tsx'), 'utf8')).toContain("surface: 'INPATIENT'");
  });
});
