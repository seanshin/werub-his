/**
 * 환자 포털 세션 만료·기능 꺼짐(2026-10-19 사용자 신고 — 홈에 "세션이 만료되었습니다"·"입원 생활 조회가 비활성화되어 있습니다").
 *  · 🔴 포털이 만료 통지를 듣지 않아 카드마다 "세션 만료"를 그리고 다른 카드는 옛 데이터를 보였다 → 로그인 화면으로 돌아간다
 *  · 🔴 포털 경로 401 을 **직원 토큰 갱신**(직원 쿠키)으로 풀려 했다 → 환자 경로는 갱신하지 않고 끝낸다
 *  · 🔴 입원 식이·중간 정산은 병원 설정이 꺼지면 카드가 없는 것이 사실 — "조회 실패"로 그리지 않는다
 *  · 🔴 (v4.93.1 회귀) 등록번호 세션의 알림 조회 401 을 세션 끝으로 읽어 로그인 직후 튕겼다 → 세션 정본(프로필)이 401 일 때만 로그아웃
 *  · 대조군: 진짜 조회 실패(PACS 503 등)는 그대로 말한다 · 직원 경로는 종전대로 갱신을 시도한다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { trOf } from '@/lib/i18n/portal-i18n';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('🔴 api-client — 환자 경로 401 은 직원 토큰 갱신을 부르지 않는다', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  it('포털 401 → 갱신 호출 없이 세션 만료 · 대조군 직원 경로는 갱신 시도', async () => {
    const { apiClient, resetSessionExpiredNotice, SESSION_EXPIRED_EVENT } = await import('@/lib/api-client');
    const seen = vi.fn(); window.addEventListener(SESSION_EXPIRED_EVENT, seen);
    resetSessionExpiredNotice();
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const e: any = await apiClient.get('/api/v1/portal/journey/status').catch((x) => x);
    expect(e.code).toBe('UNAUTHORIZED');
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).not.toContain('/api/v1/auth/refresh');
    expect(seen).toHaveBeenCalledTimes(1);
    fetchMock.mockReset(); fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    resetSessionExpiredNotice();
    await apiClient.get('/api/v1/patients').catch(() => null);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/api/v1/auth/refresh'))).toBe(true);
  });
});

describe('🔴 포털 화면', () => {
  it('만료 통지를 듣고 로그인 화면으로 돌아간다(안내 문구 · 환자 언어 카탈로그)', () => {
    const s = src('src/app/portal/page.tsx');
    expect(s).toMatch(/window\.addEventListener\(SESSION_EXPIRED_EVENT, onExpired\)/);
    expect(s).toMatch(/data-portal-session-expired/);
    expect(trOf('로그인 시간이 지나 안전을 위해 로그아웃되었습니다. 다시 로그인해 주세요.', 'en').missing).toBe(false);
  });
  it('홈 — 기능 꺼짐·세션 만료는 카드별 "조회 실패"로 그리지 않는다 · 나머지 실패는 그대로', () => {
    const s = src('src/app/portal/_home/HomeTab.tsx');
    expect(s).toMatch(/codeOf\(e\) !== 'PORTAL_INPATIENT_LIFE_DISABLED' && codeOf\(e\) !== 'UNAUTHORIZED'/);
    expect(s).toMatch(/realFailure\(readingIsError, readingError\)/);
    expect(s).not.toMatch(/^\s+mealsIsError && \{ key: 'meals'/m);
  });
});

describe('🔴 (v4.93.1) 401 하나로 로그아웃하지 않는다 — 세션 정본으로 확인', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  it('프로필 200 → 세션 살아 있음(등록번호 세션 알림 401) · 프로필 401 → 끝 · 확인 실패는 끝이라 단정 안 함 · 토큰 없음 → 끝', async () => {
    const { portalSessionEnded } = await import('@/app/portal/_auth/session-check');
    fetchMock.mockResolvedValueOnce({ status: 200 });
    expect(await portalSessionEnded('t')).toBe(false);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/v1\/portal\/profile$/);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer t');
    fetchMock.mockResolvedValueOnce({ status: 401 });
    expect(await portalSessionEnded('t')).toBe(true);
    fetchMock.mockRejectedValueOnce(new Error('net'));
    expect(await portalSessionEnded('t')).toBe(false);
    expect(await portalSessionEnded(null)).toBe(true);
  });
  it('포털 화면 — 확인 뒤에만 로그아웃 · 살아 있으면 통지 상태를 되돌린다(다음 진짜 만료를 놓치지 않게)', () => {
    const s = src('src/app/portal/page.tsx');
    expect(s).toMatch(/if \(!\(await portalSessionEnded\(apiClient\.getToken\(\)\)\)\) \{ resetSessionExpiredNotice\(\); return; \}\s*apiClient\.setToken\(null\)/);
  });
});

describe('🔴 (v4.93.2) 계정 전용 기능 — 등록번호 세션에 "세션 만료"를 그리지 않는다', () => {
  it('403 PATIENT_ACCOUNT_REQUIRED 판정 · 대조군 다른 코드', async () => {
    const { isAccountRequired } = await import('@/app/portal/_auth/session-check');
    expect(isAccountRequired({ code: 'PATIENT_ACCOUNT_REQUIRED' })).toBe(true);
    for (const c of ['UNAUTHORIZED', 'FORBIDDEN', undefined]) expect(isAccountRequired({ code: c })).toBe(false);
    expect(isAccountRequired(null)).toBe(false);
  });
  it('내 정보 탭 — 주민번호·보호자/가족·가족 계정 세 곳이 안내로 · 추가·등록 버튼 숨김 · 알림 센터는 계정 안내로 접음', () => {
    const s = src('src/app/portal/_profile/ProfileTab.tsx');
    // (A1 이후) 능력표 false 또는 403 PATIENT_ACCOUNT_REQUIRED → 안내 · 렌더 시험은 portal-session-capabilities.spec.tsx
    expect(s.match(/isAccountRequired\((nidQueryError|error)\)/g)!.length).toBeGreaterThanOrEqual(3);
    expect(s).toMatch(/\{!nidNeedsAccount && <button/);
    expect(s).toMatch(/!adding && !needsAccount &&/);
    expect(trOf('휴대폰 번호로 가입한 계정으로 로그인하면 이용할 수 있습니다.', 'en').missing).toBe(false);
    expect(src('src/app/portal/_shared/NotificationCenter.tsx')).toMatch(/e\.code === 'UNAUTHORIZED' \|\| isAccountRequired\(e\)/);
  });
});
