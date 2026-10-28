/**
 * 진료 작성 화면(환자 차트) 재검토 — 2026-09-30 사람 요청 "레이아웃 재검토·필요한 기능·위험·표현 개선".
 *
 *  1. 진료과 레이아웃 16종에 처방 입력이 없었다 → 페이지가 처방 열(rxSlot)을 넘기고 레이아웃이 서명 바 위에 그린다
 *  2. 산부인과 분만·산후 입력 20칸이 비제어라 서명하면 사라졌다 → 입력한 칸만 O(객관 소견)에 남는다 · 태반 만출 기본 '완전' 제거
 *  3. 전자서명(인증서) 값은 저장·게이트를 지난 **같은 서명 요청**에 싣는다(종전: 먼저 따로 보내 옛 기록에 서명)
 *  4. 처방 참고 — 조회 실패·로딩을 '기록 없음'으로 말하지 않는다 · 빈 알레르기의 뜻을 서버 문진 상태로 가른다
 *  5. 임신 여부 — 재진입 시 늦게 온 기록값을 따라간다
 *  6. 쓰기 폼 초기값 '미선택'(사회력·약 처방) · 빈 ROS 를 '전체 정상'으로 적지 않는다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const patch = vi.fn();
const put = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(async () => ({ data: {} })), put: (...a: unknown[]) => put(...a), patch: (...a: unknown[]) => patch(...a), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
const DIR = join(process.cwd(), 'src/app/(main)/patients/[id]/encounter/new');
const src = (f: string) => readFileSync(join(DIR, f), 'utf8');

beforeEach(() => { cleanup(); get.mockReset(); patch.mockReset(); put.mockReset(); });

describe('진료과 레이아웃에도 처방 열', () => {
  const layouts = readdirSync(join(DIR, 'components')).filter((f) => f.endsWith('EncounterLayout.tsx'));
  it('레이아웃 16종 전부 rxSlot 을 받아 그린다 · 페이지는 16곳 모두에 넘긴다', () => {
    expect(layouts).toHaveLength(16);
    for (const f of layouts) expect(src(`components/${f}`), f).toMatch(/\{rxSlot\}/);
    expect(src('page.tsx').match(/rxSlot=\{rxColumn\}/g)?.length).toBe(16);
  });
  it('실제 렌더 — 치과 레이아웃의 서명 바 위에 넘긴 처방 열이 나온다', async () => {
    const { DentalEncounterLayout } = await import('@/app/(main)/patients/[id]/encounter/new/components/DentalEncounterLayout');
    const { container } = render(<DentalEncounterLayout patientId="p" encounterId="e" onStartEncounter={() => {}} patient={{}} onSaveDraft={() => {}} onSignAndBill={() => {}} isSaving={false} isSigning={false} rxSlot={<div data-rx-slot>RX</div>} />, { wrapper: wrap });
    expect(container.querySelector('[data-rx-slot]')).toBeTruthy();
  });
});

describe('산부인과 분만 기록이 서명에서 사라지지 않는다', () => {
  it('분만 칸에 적은 것만 O 에 · 고르지 않은 태반 만출을 "완전"으로 적지 않는다', async () => {
    const { ObGynEncounterLayout } = await import('@/app/(main)/patients/[id]/encounter/new/components/ObGynEncounterLayout');
    const onSign = vi.fn();
    const { container } = render(<ObGynEncounterLayout patientId="p" encounterId="e" onStartEncounter={() => {}} patient={{}} onSaveDraft={() => {}} onSignAndBill={onSign} isSaving={false} isSigning={false} />, { wrapper: wrap });
    fireEvent.click(screen.getByText('분만'));
    const apgar1 = container.querySelector('input[placeholder="0~10"]') as HTMLInputElement;
    fireEvent.change(apgar1, { target: { value: '8' } });
    fireEvent.click(screen.getByText('서명 완료'));
    const arg = onSign.mock.calls[0][0] as { objective?: string };
    expect(arg.objective).toContain('[분만]');
    expect(arg.objective).toContain('Apgar 1분: 8');
    expect(arg.objective).not.toContain('태반 만출');
  });
});

describe('전자서명 값은 같은 서명 요청에', () => {
  it('useSignEncounter 가 blockchainSignature 를 본문에 싣는다 · 문자열 호출은 종전대로', async () => {
    const { useSignEncounter } = await import('@/hooks/useEncounters');
    const { renderHook, act } = await import('@testing-library/react');
    patch.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useSignEncounter(), { wrapper: wrap });
    await act(async () => { await result.current.mutateAsync({ id: 'e1', blockchainSignature: { signatureValue: 's' } }); });
    expect(patch).toHaveBeenLastCalledWith('/api/v1/encounters/e1/sign', { blockchainSignature: { signatureValue: 's' } });
    await act(async () => { await result.current.mutateAsync('e2'); });
    expect(patch).toHaveBeenLastCalledWith('/api/v1/encounters/e2/sign', undefined);
  });
  it('페이지는 전자서명 콜백에서 서버를 부르지 않는다(저장·게이트 앞 서명 금지)', () => {
    const p = src('page.tsx');
    const cb = p.slice(p.indexOf('onBlockchainSign={'), p.indexOf('onBlockchainSign={') + 400);
    expect(cb).not.toMatch(/apiClient\.|\/sign`/);
    expect(cb).toContain('pendingBlockchainSigRef.current =');
  });
});

describe('처방 참고 — 실패·로딩 ≠ 기록 없음', () => {
  const mount = async () => {
    const { RxContextPanel } = await import('@/app/(main)/patients/[id]/encounter/new/components/RxContextPanel');
    return render(<RxContextPanel patientId="p" />, { wrapper: wrap });
  };
  it('🔴 조회 실패면 "알레르기 기록 없음·복용약 없음"을 말하지 않는다', async () => {
    get.mockRejectedValue(new Error('403'));
    const { container } = await mount();
    await vi.waitFor(() => expect(container.textContent).toMatch(/다시|재시도|불러오지/));
    expect(container.textContent).not.toContain('등록된 알레르기 기록 없음');
    expect(container.textContent).not.toContain('복용 중인 약 기록 없음');
  });
  it('서버가 무알레르기로 확인했으면 그렇게 말한다(미문진 문구와 구별)', async () => {
    get.mockImplementation(async (url: string) => (url.includes('patient-context') ? { data: { allergies: [], allergyStatus: 'NO_KNOWN_ALLERGIES', medications: [], problems: [] } } : { data: { items: [] } }));
    const { container } = await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('무알레르기 확인됨(NKA)'));
    expect(container.textContent).not.toContain('미문진일 수 있으니');
  });
  it('대조군 — 상태가 없으면 종전대로 "기록 없음 — 미문진일 수 있으니"', async () => {
    get.mockImplementation(async (url: string) => (url.includes('patient-context') ? { data: { allergies: [], medications: [], problems: [] } } : { data: { items: [] } }));
    const { container } = await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('등록된 알레르기 기록 없음'));
  });
});

describe('임신 여부 — 늦게 온 기록값을 따라간다', () => {
  it('첫 렌더엔 값이 없고 뒤에 PREGNANT 가 오면 임신이 선택된다', async () => {
    const { PregnancyStatusCard } = await import('@/app/(main)/patients/[id]/encounter/new/components/PregnancyStatusCard');
    const patient = { gender: 'FEMALE', dateOfBirth: '1995-01-01' };
    const { rerender, container } = render(<PregnancyStatusCard encounterId="e" patient={patient} value={undefined} />, { wrapper: wrap });
    expect(container.textContent).toContain('미확인');
    rerender(<PregnancyStatusCard encounterId="e" patient={patient} value="PREGNANT" />);
    await vi.waitFor(() => expect(screen.getByText('임신').closest('button')?.className).toContain('bg-rose-600'));
  });
});

describe('쓰기 폼 초기값 · 빈 문진을 정상으로 적지 않는다', () => {
  const p = src('page.tsx');
  it('사회력·약 처방 초기값이 비어 있다', () => {
    expect(p).toContain("socialHistory: { smoking: '', alcohol: '', occupation: '' }");
    expect(p).not.toMatch(/duration: 5,\s*quantity: 15/);
    expect(p).toMatch(/EMPTY_MED_FORM = \{ dosage: '', frequency: '', duration: null/);
  });
  it("ROS 미체크는 '전체 정상'이 아니라 '미시행'", () => {
    expect(p).not.toContain("'ROS: 전체 정상'");
    expect(p).toContain("'ROS: 미시행'");
  });
});
