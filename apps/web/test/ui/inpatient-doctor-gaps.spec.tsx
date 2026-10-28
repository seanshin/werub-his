/**
 * 입원 의사 업무 공백 봉합 (2026-09-30).
 *  1. 일일 경과기록 쓰기 — EP 는 있었는데 부르는 화면이 0이었다(「경과 기록」 탭은 읽기만).
 *     일일 SOAP 정본 = ProgressNote · 회진 폼은 S/O 를 Round.notes 에 섞지 않고 경과기록 탭으로 안내만 한다.
 *  3. 수술 준비 동의서 — 상수 "확인 필요"(P15) 대신 동의서 원장의 실제 상태(서명됨/서명 대기/없음/조회 실패).
 * 대조군: 성공하면 실패로 말하지 않는다 · 서명본이 있으면 서명됨으로 말한다 · 조회 실패는 "없음"이 되지 않는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const wrap = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);
const SRC = join(__dirname, '../../src/app/(main)');

beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); });

describe('composeSoapNote — 일일 SOAP 본문 규약', () => {
  it('빈 구획은 적지 않고, 전부 비면 빈 문자열(저장 안 함)', async () => {
    const { composeSoapNote, EMPTY_SOAP } = await import('@/lib/progress-note-soap');
    expect(composeSoapNote(EMPTY_SOAP)).toBe('');
    expect(composeSoapNote({ ...EMPTY_SOAP, subjective: '  ' })).toBe('');
    expect(composeSoapNote({ subjective: '복통 감소', objective: '', assessment: '호전', plan: ' 식이 진행 ' }))
      .toBe('[S] 복통 감소\n[A] 호전\n[P] 식이 진행');
  });
});

describe('ProgressNoteForm — 경과기록 쓰기 폼', () => {
  const mount = async () => {
    const { ProgressNoteForm } = await import('@/app/(main)/inpatient/[admissionId]/ProgressNoteForm');
    return render(<ProgressNoteForm admissionId="adm-1" />, { wrapper: wrap });
  };

  it('초기값은 전부 빈칸 · 비어 있으면 저장 불가 · 저장 버튼 44px 이상', async () => {
    const { getByTestId } = await mount();
    for (const k of ['subjective', 'objective', 'assessment', 'plan']) {
      expect((getByTestId(`pn-${k}`) as HTMLTextAreaElement).value).toBe('');
    }
    const btn = getByTestId('progress-note-save') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.className).toContain('min-h-[44px]');
  });

  it('저장 → 기존 EP 를 부르고 본문은 SOAP 표지로 · 성공 후 폼 비움 · 오류 표시 없음(대조군)', async () => {
    post.mockResolvedValue({ data: { id: 'pn-1' } });
    const { getByTestId, queryByTestId } = await mount();
    fireEvent.change(getByTestId('pn-assessment'), { target: { value: '폐렴 호전 중' } });
    fireEvent.change(getByTestId('pn-plan'), { target: { value: '항생제 유지' } });
    fireEvent.click(getByTestId('progress-note-save'));
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe('/api/v1/inpatient/adm-1/progress-note');
    // 기록 종류(noteType)를 함께 보낸다 — 기본은 경과기록(PROGRESS) · H&P 는 ADMISSION(2026-09-30)
    expect(post.mock.calls[0][1]).toEqual({ content: '[A] 폐렴 호전 중\n[P] 항생제 유지', noteType: 'PROGRESS' });
    await vi.waitFor(() => expect((getByTestId('pn-assessment') as HTMLTextAreaElement).value).toBe(''));
    expect(queryByTestId('progress-note-error')).toBeNull();
  });

  it('서버 거부 사유를 그대로 보여준다(뭉개지 않는다) · 입력은 남긴다', async () => {
    const { ApiError } = await import('@/lib/api-client');
    post.mockRejectedValue(new ApiError('FORBIDDEN', 'Forbidden resource — role'));
    const { getByTestId, findByTestId } = await mount();
    fireEvent.change(getByTestId('pn-subjective'), { target: { value: '두통' } });
    fireEvent.click(getByTestId('progress-note-save'));
    const err = await findByTestId('progress-note-error');
    expect(err.textContent).toContain('Forbidden resource — role');
    expect((getByTestId('pn-subjective') as HTMLTextAreaElement).value).toBe('두통');
  });
});

describe('입원 상세 화면 — 일일 SOAP 정본은 하나', () => {
  const page = readFileSync(join(SRC, 'inpatient/[admissionId]/page.tsx'), 'utf8');
  it('경과 기록 탭이 쓰기 폼을 그린다(의사) · 회진 폼은 경과기록 탭으로 안내한다', () => {
    expect(page).toMatch(/<ProgressNoteForm admissionId=\{admission\.id\} \/>/);
    expect(page).toMatch(/data-testid="rounds-soap-canon-link"/);
    expect(page).toMatch(/onOpenNotes=\{\(\) => setTab\('notes'\)\}/);
  });
  it('회진 폼이 S/O 를 Round.notes 에 섞지 않는다(두 벌 금지)', () => {
    expect(page).not.toMatch(/`\[S\] \$\{form\.subjective\}`/);
    expect(page).not.toMatch(/`\[O\] \$\{form\.objective\}`/);
  });
  it("회진 폼 환자 상태 초기값은 미선택(종전 'STABLE' 이 누르지 않아도 저장됐다)", () => {
    expect(page).toMatch(/pendingResults: '', patientCondition: '',/);
    expect(page).not.toMatch(/patientCondition: 'STABLE'/);
  });
});

describe('SurgeryConsentStatus — 수술 전 동의서 실제 상태', () => {
  const mount = async (props: { patientId?: string | null; surgeryId?: string | null }) => {
    const { SurgeryConsentStatus } = await import('@/app/(main)/workstation/surgery-prep/SurgeryConsentStatus');
    return render(<SurgeryConsentStatus {...props} />, { wrapper: wrap });
  };
  const items = [
    { consentType: 'SURGERY', state: 'SIGNED', matchedBy: 'PATIENT_WINDOW', consentId: 'c1', signedAt: '2026-09-26T01:00:00Z', createdAt: '2026-09-25T00:00:00Z' },
    { consentType: 'ANESTHESIA', state: 'PENDING', matchedBy: 'PATIENT_WINDOW', consentId: 'c2', signedAt: null, createdAt: '2026-09-25T00:00:00Z' },
    { consentType: 'TRANSFUSION', state: 'NONE', matchedBy: null, consentId: null, signedAt: null, createdAt: null },
  ];

  it('종류별 실제 상태 · 느슨한 대조임을 밝힌다 · 수술 id 가 있으면 넘긴다', async () => {
    get.mockResolvedValue({ data: { rule: 'SURGERY_ID_THEN_PATIENT_WINDOW', windowDays: 30, items } });
    const { container, findByTestId } = await mount({ patientId: 'p1', surgeryId: 's1' });
    await findByTestId('consent-loose-match');
    expect(get.mock.calls[0][0]).toBe('/api/v1/consent/surgery-status');
    expect(get.mock.calls[0][1]).toEqual({ patientId: 'p1', surgeryId: 's1' });
    const states = [...container.querySelectorAll('[data-state]')].map((e) => e.getAttribute('data-state'));
    expect(states).toEqual(['SIGNED', 'PENDING', 'NONE']);
    expect(container.textContent).toContain('서명됨');
    expect(container.textContent).toContain('서명 대기');
    expect(container.textContent).not.toContain('확인 필요');
    expect(container.textContent).toContain('30');
  });

  it('대조군 — 수술에 연결된(SURGERY_ID) 것만이면 느슨한 대조 문구를 달지 않는다', async () => {
    get.mockResolvedValue({ data: { rule: 'SURGERY_ID_THEN_PATIENT_WINDOW', windowDays: 30, items: items.map((i) => ({ ...i, matchedBy: i.matchedBy ? 'SURGERY_ID' : null })) } });
    const { container, queryByTestId } = await mount({ patientId: 'p1', surgeryId: 's1' });
    await vi.waitFor(() => expect(container.querySelector('[data-state="SIGNED"]')).toBeTruthy());
    expect(queryByTestId('consent-loose-match')).toBeNull();
  });

  it('조회 실패는 "조회 실패"(세 번째 상태) — "없음"으로 번역하지 않는다', async () => {
    get.mockRejectedValue(new Error('boom'));
    const { container } = await mount({ patientId: 'p1' });
    await vi.waitFor(() => expect(container.querySelector('[data-state="error"]')).toBeTruthy());
    expect(container.textContent).toContain('동의서 조회 실패');
    expect(container.querySelector('[data-state="NONE"]')).toBeNull();
  });

  it('환자 식별자가 없으면 부르지 않고 "대조 불가"라 말한다', async () => {
    const { container } = await mount({ patientId: null });
    expect(container.querySelector('[data-state="no-patient"]')).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });

  it('수술 준비 화면에 상수 "확인 필요" 목록·로컬 마취 동의서 체크박스가 남아 있지 않다', () => {
    const src = readFileSync(join(SRC, 'workstation/surgery-prep/page.tsx'), 'utf8');
    expect(src).not.toMatch(/\['수술 동의서', '마취 동의서', '수혈 동의서'\]/);
    expect(src).not.toMatch(/<T k="마취 동의서" \/>/);
    expect(src).toMatch(/<SurgeryConsentStatus patientId=\{selected\.patient\?\.id\} surgeryId=\{selected\.surgeryId\}/);
  });
});
