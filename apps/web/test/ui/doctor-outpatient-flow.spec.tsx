/**
 * 의사 외래 흐름 점검(2026-09-30 "의사 기능 전체 검토 → 미비 기능 구현").
 *
 *  1. 호출 → 차트: 대기열↔진료를 잇는 진료시작(/start)을 거쳐 그 진료로 들어간다(진료실 대기·대시보드 위젯 모두)
 *  2. 미완료 차트는 그 진료를 이어 쓴다(encounterId) · 서명 뒤 '다음 환자'는 진료실 대기 · '다음 예약 잡기'는 환자 프리필
 *  3. 처방전 인쇄 — 취소 처방 제외 · 원내/원외는 기록값으로 · 면허번호 · 기관 설정 실패를 '병원'으로 지어내지 않음 · 서명 전 표식
 *  4. 진단서·소견서는 발급 대장 화면으로(환자·종류 프리필)
 *  5. 서버가 막는 버튼을 권한과 맞춤(문진표 발송·가족관계·명령 수정·경로 마일스톤)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Suspense } from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const patch = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), patch: (...a: unknown[]) => patch(...a), post: (...a: unknown[]) => post(...a), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
const encounterData: { current: unknown } = { current: null };
vi.mock('@/hooks/useEncounters', async (orig) => ({ ...(await orig<object>()), useEncounter: () => ({ data: { data: encounterData.current }, isLoading: false, error: null }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
const APP = join(process.cwd(), 'src/app/(main)');
const src = (f: string) => readFileSync(join(APP, f), 'utf8');

beforeEach(() => { cleanup(); get.mockReset(); patch.mockReset(); post.mockReset(); });

describe('호출 → 차트는 진료시작을 거친다', () => {
  it('진료실 대기 — WAITING 호출 뒤에도 /start 로 진료를 만들고 그 진료로 간다', () => {
    const s = src('clinic-queue/page.tsx');
    const fn = s.slice(s.indexOf('const handleCallAndStart'), s.indexOf('const encHref'));
    expect(fn).toMatch(/callWithConsent\(item\.id, \(\) => startAndOpen\(item\)\)/);
    expect(fn).not.toMatch(/callWithConsent\([^)]*router\.push/);
  });
  it('대시보드 내 대기 위젯 — 호출 성공·진료 버튼 모두 /start 경유(encounter/new 로 곧장 가지 않는다)', () => {
    const s = src('dashboard/components/MyWaitingQueueWidget.tsx');
    expect(s).toMatch(/\/api\/v1\/queue\/\$\{queueItem\.id\}\/start/);
    expect(s).not.toMatch(/router\.push\(`\/patients\/\$\{queueItem\.patientId\}\/encounter\/new`\)/);
    expect(s).not.toMatch(/href=\{`\/patients\/\$\{q\.patientId\}\/encounter\/new`\}/);
  });
  it('미완료 차트는 그 진료로 · 서명 뒤 다음 환자는 진료실 대기 · 다음 예약은 환자 프리필', () => {
    expect(src('dashboard/components/DoctorDashboard.tsx')).toContain('encounter/new?encounterId=${enc.id}');
    const enc = src('patients/[id]/encounter/new/page.tsx');
    expect(enc).toContain("router.push('/clinic-queue')");
    expect(enc).toMatch(/\/schedule\/new\?patientId=\$\{patientId\}&type=FOLLOW_UP/);
    const sch = src('schedule/new/page.tsx');
    expect(sch).toMatch(/useState\(initParams\?\.get\('patientId'\) \?\? ''\)/);
  });
});

describe('처방전 인쇄', () => {
  // 인쇄 페이지 첫 import 는 무겁다 — 병렬 부하에서 5초 기본 제한을 넘은 적이 있다(로직 실패 아님)
  vi.setConfig({ testTimeout: 20_000 });
  const base = {
    id: 'e1', status: 'SIGNED', createdAt: '2026-09-30T00:00:00Z',
    patient: { familyName: '김', givenName: '환자', mrn: 'M1' },
    doctor: { familyName: '이', givenName: '의사', licenseNumber: '98765' },
    diagnoses: [],
  };
  const mount = async () => {
    const { default: Page } = await import('@/app/(main)/print/prescription/[encounterId]/page');
    // React use() 는 이미 풀린 thenable(status·value)을 동기로 읽는다 — 테스트 환경에서 Suspense 가 깨어나지 않는 것을 피한다
    const params = Object.assign(Promise.resolve({ encounterId: 'e1' }), { status: 'fulfilled', value: { encounterId: 'e1' } });
    const r = render(<Suspense fallback={null}><Page params={params} /></Suspense>, { wrapper: wrap });
    await vi.waitFor(() => expect(r.container.textContent).toContain('처방'), { timeout: 10_000 });
    return r;
  };
  it('🔴 취소 처방을 싣지 않고 · 원외 항목만 원외처방전에 · 면허번호를 찍는다', async () => {
    get.mockResolvedValue({ data: [{ key: 'hospital.name', value: '테스트병원' }] });
    encounterData.current = { ...base, prescriptions: [
      { id: 'a', type: 'MEDICATION', status: 'ACTIVE', dispensingType: 'EXTERNAL', medicationCode: { nameKo: '원외약가' } },
      { id: 'b', type: 'MEDICATION', status: 'ACTIVE', dispensingType: 'INTERNAL', medicationCode: { nameKo: '원내약나' } },
      { id: 'c', type: 'MEDICATION', status: 'CANCELLED', dispensingType: 'EXTERNAL', medicationCode: { nameKo: '취소약다' } },
    ] };
    const { container } = await mount();
    const t = container.textContent ?? '';
    expect(t).toContain('원외약가');
    expect(t).not.toContain('취소약다');
    expect(t).not.toContain('원내약나');
    expect(t).toContain('☑ 원외처방');
    expect(t).toContain('원내 조제 약 1건');
    expect(t).toContain('98765');
    expect(t).not.toMatch(/☑ 불가/);
  });
  it('원외 항목이 없으면 원내조제로 표기 · 서명 전이면 초안 표식', async () => {
    get.mockResolvedValue({ data: [] });
    encounterData.current = { ...base, status: 'DRAFT', prescriptions: [{ id: 'b', type: 'MEDICATION', status: 'ACTIVE', dispensingType: 'INTERNAL', medicationCode: { nameKo: '원내약나' } }] };
    const { container } = await mount();
    expect(container.textContent).toContain('☑ 원내조제');
    expect(container.querySelector('[data-rx-draft]')).toBeTruthy();
    expect(container.textContent).toContain('미설정'); // 설정 행이 없으면 '병원'·'-' 이 아니라 미설정
  });
  it('기관 설정 조회 실패는 "확인 불가" — "병원"을 지어내지 않는다', async () => {
    get.mockRejectedValue(new Error('500'));
    encounterData.current = { ...base, prescriptions: [] };
    const { container } = await mount();
    await vi.waitFor(() => expect(container.textContent).toContain('확인 불가'));
  });
});

describe('진단서·소견서는 발급 대장으로', () => {
  it('진료 머리 버튼이 진단서 발급 화면을 환자·종류와 함께 연다 · 그 화면은 프리필로 접수 창을 연다', () => {
    const enc = src('patients/[id]/encounter/new/page.tsx');
    expect(enc).toMatch(/certType: 'DIAGNOSIS_CERT'/);
    expect(enc).toMatch(/\/workstation\/certificates\?patientId=\$\{patientId\}&type=\$\{d\.certType\}/);
    const ws = src('workstation/certificates/page.tsx');
    expect(ws).toMatch(/useState\(!!prefill\)/);
    expect(ws).toMatch(/useState\(initial\?\.patientId \?\? ''\)/);
  });
});

describe('외부 의뢰·회송을 차트에서', () => {
  it('진료 머리의 의뢰·회송이 전원 화면을 이 환자로 열고, 전원 화면은 환자를 불러와 선택해 둔다', () => {
    expect(src('patients/[id]/encounter/new/page.tsx')).toMatch(/\/transfer\/request\?patientId=\$\{patientId\}/);
    const tr = src('transfer/request/page.tsx');
    expect(tr).toMatch(/get\('patientId'\)/);
    expect(tr).toMatch(/setSelectedPatient\(pt\)/);
    expect(tr).toMatch(/prefillIsError && !selectedPatient && <QueryErrorFallback/);
  });
});

describe('서버가 막는 버튼을 권한과 맞춘다', () => {
  it('문진표 발송(간호·관리) · 가족관계(patient:relation:edit) · 명령 수정(patient:edit) · 경로 마일스톤 수정/삭제(관리)', () => {
    expect(src('patients/[id]/components/QuestionnaireTab.tsx')).toMatch(/canSend \? \(/);
    const info = src('patients/[id]/components/PatientInfoTab.tsx');
    expect(info).toMatch(/useHasPermission\('patient:relation:edit'\)/);
    expect(info).toMatch(/\{canEditPatient && <PatientAiCli/);
    expect(info).toContain("useState(''); // 쓰기 폼 초기값은 미선택");
    const cp = src('clinical-pathway/page.tsx');
    const at = cp.indexOf('openMilestoneEdit(ms)');
    expect(cp.slice(at - 400, at)).toContain('{canEditMaster && (<>');
  });
});

describe('구두·전화 처방 사후 확인(/verbal-orders)', () => {
  const mount = async () => {
    const { default: Page } = await import('@/app/(main)/verbal-orders/page');
    return render(<Page />, { wrapper: wrap });
  };
  it('🔴 조회 실패는 "확인할 처방 없음"이 아니다', async () => {
    get.mockRejectedValue(new Error('500'));
    const { container } = await mount();
    await vi.waitFor(() => expect(container.textContent).toMatch(/다시|재시도|불러오지/), { timeout: 10_000 });
    expect(container.textContent).not.toContain('확인할 구두·전화 처방이 없습니다');
  });
  it('목록 → 확인 버튼이 그 처방의 사후 확인을 부른다 · 잘렸으면 총수를 말한다', async () => {
    get.mockResolvedValue({ data: { items: [{ id: 'r1', type: 'MEDICATION', orderSource: 'TELEPHONE', createdAt: '2026-09-30T03:00:00Z', medicationCode: { nameKo: '세프트리악손' }, readBackConfirmedAt: null }], total: 250, cap: 200, truncated: true } });
    patch.mockResolvedValue({ data: { alreadyCosigned: false } });
    const { container, findByText } = await mount();
    await findByText('세프트리악손', {}, { timeout: 10_000 });
    expect(container.textContent).toContain('복창 기록 없음');
    expect(container.textContent).toMatch(/250/);
    fireEvent.click((await findByText('내가 낸 처방 확인')).closest('button')!);
    await vi.waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/prescriptions/verbal-cosign/r1'));
  });
});

describe('입원 초진기록(H&P) 구분', () => {
  it('종류를 H&P 로 바꾸면 noteType=ADMISSION 으로 저장한다', async () => {
    post.mockResolvedValue({ data: { id: 'pn' } });
    const { ProgressNoteForm } = await import('@/app/(main)/inpatient/[admissionId]/ProgressNoteForm');
    const { container, findByText } = render(<ProgressNoteForm admissionId="adm" />, { wrapper: wrap });
    fireEvent.click((await findByText('입원 초진기록(H&P)')).closest('button')!);
    fireEvent.change(container.querySelector('[data-testid="pn-subjective"]')!, { target: { value: '흉통 2일' } });
    fireEvent.click(container.querySelector('[data-testid="progress-note-save"]')!);
    await vi.waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({ noteType: 'ADMISSION' });
  });
});
