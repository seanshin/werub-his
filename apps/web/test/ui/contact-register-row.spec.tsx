import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const post = vi.fn(async () => ({ data: {} }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<any>()), apiClient: { post: (...a: unknown[]) => (post as (...x: unknown[]) => unknown)(...a) } }));

import { RegisterContactRow } from '../../src/app/(main)/infection/ContactCandidatesPanel';

/**
 * 접촉자 등록 폼(P5 후속 · 2026-09-28) — 🔴 쓰기 폼 초기값은 미선택 · 보호구 '모름'은 착용 여부를 보내지 않는다
 * (서버가 UNKNOWN 으로 적는다 — 종전 서버는 미입력을 `PPE: No` 로 지어냈다).
 */
const C = { patientId: 'p2', familyName: '김', givenName: '가', mrn: 'M2', grade: 'OBSERVED' as const, overlaps: 1, overlapMinutes: 12, zones: ['채혈실'], firstAt: '2026-09-28T01:00:00.000Z', registered: false };
const wrap = (ui: React.ReactNode) => <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;

describe('RegisterContactRow', () => {
  beforeEach(() => post.mockClear());
  it('셋 다 고르기 전에는 저장 버튼이 꺼져 있다(초기값 미선택)', () => {
    render(wrap(<RegisterContactRow sourcePatientId="p1" c={C} onDone={() => {}} />));
    const btn = screen.getByRole('button', { name: '접촉자로 등록' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    for (const sel of screen.getAllByRole('combobox') as HTMLSelectElement[]) expect(sel.value).toBe('');
  });
  it('보호구 모름 → wearingPPE 를 보내지 않는다 · 겹침 시각·시간은 후보에서', async () => {
    const onDone = vi.fn();
    render(wrap(<RegisterContactRow sourcePatientId="p1" c={C} onDone={onDone} />));
    const [rel, risk, ppe] = screen.getAllByRole('combobox');
    fireEvent.change(rel, { target: { value: 'PATIENT' } });
    fireEvent.change(risk, { target: { value: 'HIGH' } });
    fireEvent.change(ppe, { target: { value: 'UNKNOWN' } });
    fireEvent.click(screen.getByRole('button', { name: '접촉자로 등록' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, body] = post.mock.calls[0] as any[];
    expect(url).toBe('/api/v1/infection-control/contact-traces');
    expect(body).toMatchObject({ sourcePatientId: 'p1', contactPersonId: 'p2', relationshipType: 'PATIENT', riskLevel: 'HIGH', contactStartDate: C.firstAt, contactDurationMinutes: 12 });
    expect('wearingPPE' in body).toBe(false);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
  it('착용 → wearingPPE:true', async () => {
    render(wrap(<RegisterContactRow sourcePatientId="p1" c={C} onDone={() => {}} />));
    const [rel, risk, ppe] = screen.getAllByRole('combobox');
    fireEvent.change(rel, { target: { value: 'ROOMMATE' } });
    fireEvent.change(risk, { target: { value: 'LOW' } });
    fireEvent.change(ppe, { target: { value: 'YES' } });
    fireEvent.click(screen.getByRole('button', { name: '접촉자로 등록' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect((post.mock.calls[0] as any[])[1].wearingPPE).toBe(true);
  });
});
