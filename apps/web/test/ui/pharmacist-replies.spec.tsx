/**
 * 약사 회신 요청(의사 워크리스트 /pharmacist-replies · 2026-09-30) — 지키는 것:
 *  1. 🔴 조회 실패는 "없음"이 아니다 — 중재·대체조제·DUR 무시 기록 셋 다 실패 폴백을 그린다
 *  2. 거절·수정 수락은 사유가 있어야 기록된다 · 수정 수락은 서버 상태로 수락(ACCEPTED)이다(상태 어휘를 지어내지 않는다)
 *  3. 대체조제 승인·거부는 자기 처방 목록(`substitution/mine`)에서 · 서버 거부(403)는 그 사유를 그대로 말한다
 *  4. DUR 무시 사유가 비어 있으면 "사유 미기록"이라고 말한다
 *  5. 메뉴는 의사·관리자 · 화면번호 1217
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const get = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), patch: (...a: unknown[]) => patch(...a) } }));
const toastError = vi.fn();
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a), warning: vi.fn() } }));

const INTV = [{
  id: 'i1', patientId: 'p1', patientName: '김영수', prescriptionId: 'rx1', prescriptionDrug: 'Vancomycin 1g',
  pharmacistName: '임약사', type: 'DOSE', reason: 'eGFR 25 — 감량 필요', suggestion: '750mg q24h', status: 'PENDING', createdAt: '2026-09-30T01:00:00Z',
}];
const SUBS = [{
  id: 's1', reason: '품절', status: 'REQUESTED', requestedAt: '2026-09-30T01:00:00Z',
  originalPrescription: { medicationCode: { nameKo: '원약정' }, encounter: { patient: { familyName: '박', givenName: '민지', mrn: 'M002' } } },
  substituteMedication: { nameKo: '대체정' }, pharmacist: { familyName: '임', givenName: '약사' },
}];
const DUR = [{
  prescriptionId: 'rx9', status: 'ACTIVE', drugName: '와파린', drugCode: 'W', patient: { id: 'p9', familyName: '최', givenName: '수아', mrn: 'M009' },
  reason: null, overriddenBy: 'd1', overriddenByName: '이의사', overriddenByRole: 'DOCTOR', overriddenAt: '2026-09-29T01:00:00Z', prescriberId: 'd1', prescriberName: '이의사',
}];

function route(url: string) {
  if (url === '/api/v1/pharmacist/interventions/mine') return Promise.resolve({ data: INTV, meta: { truncated: false, limit: 200 } });
  if (url === '/api/v1/pharmacy/substitution/mine') return Promise.resolve({ data: SUBS });
  if (url === '/api/v1/pharmacy/dur-overrides') return Promise.resolve({ data: DUR, meta: { truncated: false, limit: 200, windowDays: 30, scope: 'MINE' } });
  return Promise.reject(new Error(`unexpected ${url}`));
}

async function mount() {
  const { default: Page } = await import('@/app/(main)/pharmacist-replies/page');
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Page /></QueryClientProvider>);
}

beforeEach(() => { cleanup(); get.mockReset(); patch.mockReset(); toastError.mockReset(); get.mockImplementation(route); patch.mockResolvedValue({ data: {} }); });

describe('약사 회신 요청 — 조회 실패는 없음이 아니다', () => {
  it('🔴 세 목록 모두 실패하면 실패 폴백이 셋 · "없습니다"는 하나도 그리지 않는다', async () => {
    get.mockImplementation(() => Promise.reject(new Error('500')));
    const { container } = await mount();
    // 중재·대체조제는 섹션 안 compact 폴백('재시도'), DUR 목록은 full 폴백('다시 시도')
    await waitFor(() => expect(screen.getAllByText('재시도').length + screen.getAllByText('다시 시도').length).toBe(3), { timeout: 3000 });
    expect(container.textContent).not.toContain('회신을 기다리는 약사 중재가 없습니다');
    expect(container.textContent).not.toContain('승인을 기다리는 대체조제가 없습니다');
    expect(container.textContent).not.toContain('DUR 경고 무시 기록이 없습니다');
  });

  it('대조군 — 진짜 빈 목록이면 "없습니다"를 말한다', async () => {
    get.mockImplementation((url: string) => Promise.resolve(url.includes('dur-overrides')
      ? { data: [], meta: { truncated: false, limit: 200, windowDays: 30, scope: 'MINE' } } : { data: [] }));
    const { container } = await mount();
    await screen.findByText('회신을 기다리는 약사 중재가 없습니다', {}, { timeout: 3000 });
    expect(container.textContent).toContain('승인을 기다리는 대체조제가 없습니다');
    expect(screen.queryByText('다시 시도')).toBeNull();
    expect(screen.queryByText('재시도')).toBeNull();
  });
});

describe('중재 회신', () => {
  it('🔴 거절은 사유 없이 기록되지 않는다 · 사유를 쓰면 REJECTED 로 PATCH', async () => {
    const { container } = await mount();
    await screen.findByText('750mg q24h', { exact: false });
    const row = container.querySelector('[data-intervention-row="i1"]') as HTMLElement;
    fireEvent.click(row.querySelector('[data-reply="REJECT"]')!);
    const submit = row.querySelector('[data-reply-submit]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(row).getByRole('textbox'), { target: { value: '의도적 처방(투석 예정)' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith('/api/v1/pharmacist/interventions/i1', { status: 'REJECTED', doctorResponse: '의도적 처방(투석 예정)' });
  });

  it('수정 수락은 서버 상태로 수락(ACCEPTED) + 수정 내용 · 수락은 사유 없이도 기록된다', async () => {
    const { container } = await mount();
    await screen.findByText('750mg q24h', { exact: false });
    const row = container.querySelector('[data-intervention-row="i1"]') as HTMLElement;
    fireEvent.click(row.querySelector('[data-reply="MODIFY"]')!);
    expect((row.querySelector('[data-reply-submit]') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(row).getByRole('textbox'), { target: { value: '500mg q24h 로 감량' } });
    fireEvent.click(row.querySelector('[data-reply-submit]')!);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/pharmacist/interventions/i1', { status: 'ACCEPTED', doctorResponse: '500mg q24h 로 감량' }));

    fireEvent.click(row.querySelector('[data-reply="ACCEPT"]')!);
    expect((row.querySelector('[data-reply-submit]') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('대체조제 판정', () => {
  it('승인은 자기 목록의 건을 approve 경로로 · 서버 거부(403)는 사유를 그대로 말한다', async () => {
    const { ApiError } = await import('@/lib/api-client');
    patch.mockRejectedValueOnce(new ApiError('Forbidden', '본인이 책임 처방의인 처방의 대체조제만 판정할 수 있습니다'));
    const { container } = await mount();
    await screen.findByText('대체정');
    fireEvent.click(container.querySelector('[data-substitution-row="s1"] [data-sub-approve]')!);
    // 2026-09-30 — 판정은 확정 단계를 거친다(승인 메모 선택 · 거부 사유 필수 · 판정자는 서버가 남긴다)
    fireEvent.click(container.querySelector('[data-substitution-row="s1"] [data-sub-confirm]')!);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/pharmacy/substitution/s1/approve', {}));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('본인이 책임 처방의인 처방의 대체조제만 판정할 수 있습니다'));
  });
});

describe('DUR 무시 기록', () => {
  it('사유가 비어 있으면 "사유 미기록" · 범위(내 처방)를 말한다', async () => {
    const { container } = await mount();
    await screen.findByText('와파린');
    const row = container.querySelector('[data-dur-override-row]') as HTMLElement;
    expect(row.textContent).toContain('사유 미기록');
    expect(container.textContent).toContain('내가 책임 처방의인 처방만 보입니다');
  });
});

describe('메뉴·화면번호·알림 링크', () => {
  const root = join(__dirname, '..', '..', 'src');
  it('메뉴는 의사·관리자(DOCTOR_ADMIN) · 화면번호 1217 · 알림 refType 이 이 화면으로 간다', () => {
    const sidebar = readFileSync(join(root, 'components/layout/Sidebar.tsx'), 'utf8');
    // 2026-10-07 메뉴는 '의사 할 일함' 하나 — 이 화면은 그 탭이자 OFF_NAV(번호 이동·직접 링크)
    expect(sidebar).toMatch(/href: '\/pharmacist-replies', label: '약사 회신 요청', section: '진단·약제', roles: DOCTOR_ADMIN/);
    const frozen = readFileSync(join(root, 'components/layout/screen-codes.frozen.ts'), 'utf8');
    expect(frozen).toContain("'/pharmacist-replies': '1217'");
    const store = readFileSync(join(root, 'stores/notification-store.ts'), 'utf8');
    expect(store).toMatch(/case 'PHARMACIST_INTERVENTION': case 'GENERIC_SUBSTITUTION': return '\/doctor-inbox\?tab=pharmacist'/);
  });
});
