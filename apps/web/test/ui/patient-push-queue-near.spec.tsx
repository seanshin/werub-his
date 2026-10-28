/**
 * 포털 B3 — 진료 차례 임박 푸시 관리 화면(2026-10-26).
 *  · 🔴 켜져 있어도 기준(앞 인원)이 없으면 "마스터가 꺼져 있어"가 아니라 "기준이 정해지지 않아"라고 말한다
 *  · 기준이 있으면 "앞 대기 N명 이하가 된 첫 순간 한 번" · 미설정이면 설정 키를 보여 준다
 *  · 대조군 — 다른 유형은 종전 문구(마스터) 그대로 · 옛 서버(blockedBy 없음)도 종전 문구
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), getToken: () => 't' }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: api }));
beforeEach(() => { cleanup(); api.get.mockReset(); });

const base = (types: unknown[]) => ({
  master: { key: 'notification.patientPush.enabled', enabled: true },
  pushChannel: { available: true, note: '' },
  quietHours: { key: 'k', startHour: 22, endHour: 7, timezone: 'Asia/Seoul', nowKstHour: 10, inQuietHoursNow: false, note: '' },
  types,
});
const QN = { type: 'QUEUE_NEAR', label: '진료 차례 임박', configKey: 'notification.patientPush.types.QUEUE_NEAR', enabled: true, requiresOptIn: false, quietHoursExempt: true, dedupMinutes: 3, alertCode: 'PATIENT_PUSH_QUEUE_NEAR' };

async function mount(data: unknown) {
  api.get.mockResolvedValue({ data });
  const { PatientPushSettings } = await import('@/app/(main)/admin/outbound-channels/PatientPushSettings');
  let v!: ReturnType<typeof render>;
  await act(async () => { v = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PatientPushSettings /></QueryClientProvider>); });
  return v;
}

describe('🔴 차례 임박 — 막힌 이유와 기준', () => {
  it('기준 미설정 → "기준이 정해지지 않아" · 마스터 탓 아님 · 설정 키 표시', async () => {
    const v = await mount(base([{ ...QN, effective: false, blockedBy: 'THRESHOLD_UNSET', threshold: { key: 'notification.patientPush.queueNearAhead', aheadCount: null } }]));
    await waitFor(() => expect(v.container.querySelector('[data-push-blocked]')).not.toBeNull());
    expect(v.container.querySelector('[data-push-blocked]')!.getAttribute('data-push-blocked')).toBe('THRESHOLD_UNSET');
    expect(v.container.querySelector('[data-push-blocked]')!.textContent).toContain('기준');
    expect(v.container.querySelector('[data-push-blocked]')!.textContent).not.toContain('마스터');
    expect(v.container.querySelector('[data-push-threshold]')!.getAttribute('data-push-threshold')).toBe('UNSET');
    expect(v.container.textContent).toContain('notification.patientPush.queueNearAhead');
  });
  it('기준 2 → 앞 대기 2명 · 막힘 문구 없음', async () => {
    const v = await mount(base([{ ...QN, effective: true, blockedBy: null, threshold: { key: 'notification.patientPush.queueNearAhead', aheadCount: 2 } }]));
    await waitFor(() => expect(v.container.querySelector('[data-push-threshold]')).not.toBeNull());
    expect(v.container.querySelector('[data-push-threshold]')!.textContent).toContain('2');
    expect(v.container.querySelector('[data-push-blocked]')).toBeNull();
  });
  it('대조군 — 다른 유형 마스터 꺼짐 · 옛 서버(blockedBy 없음)는 종전 문구', async () => {
    const v = await mount(base([{ type: 'CALLED', label: '진료 호출', configKey: 'k2', enabled: true, effective: false, requiresOptIn: true, quietHoursExempt: true, dedupMinutes: 3, alertCode: 'A' }]));
    await waitFor(() => expect(v.container.querySelector('[data-push-blocked]')).not.toBeNull());
    expect(v.container.querySelector('[data-push-blocked]')!.textContent).toContain('마스터');
    expect(v.container.querySelector('[data-push-threshold]')).toBeNull();
  });
});
