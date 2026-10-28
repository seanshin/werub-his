import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 공개 사이트(hospital.example.org) 라이브 최신성 — **트리거 기록이 아니라 살아 있는 것**을 본다.
 *
 * 🔴 2026-09-02 실측: 서버의 `homepage-build-status.json` 은 2026-06-17 `deploy_triggered` 에 멈춰
 *    있었고, `/admin/homepage/deploy` 는 그 기록을 **77일째** "배포 전환 중"이라고 보여줬다.
 *
 * 🔴 2026-09-03 표본 교체: 종전 표본(예약 페이지 AI 표기)은 그 페이지 본문이 Suspense 셸이라
 *    초기 HTML 에 구조적으로 나올 수 없었다 — **발행이 성공해도**(새 빌드 청크 대조로 실증) 감지기가
 *    영원히 '낡음'을 말했다(실제보다 덜 좋게 말하는 것도 사실이 아니다). 이제 빌드가 심는
 *    `/build-stamp.txt`(빌드 TS)를 트리거 기록의 ts 와 기계 대조한다.
 * 🔴 조회 실패를 '낡음'으로 번역하지 않는다 — `checked:false` 로 돌려 화면이 단정하지 못하게 한다.
 */
const safeFetchMock = vi.fn();
vi.mock('../../src/common/util/safe-fetch', () => ({
  safeFetch: (...a: unknown[]) => safeFetchMock(...a),
  EgressBlockedError: class EgressBlockedError extends Error {},
}));

const { HospitalInfoService } = await import('../../src/modules/hospital-info/hospital-info.service');

describe('공개 사이트 라이브 최신성 확인 — 빌드 스탬프 대조', () => {
  let svc: any;

  beforeEach(() => {
    safeFetchMock.mockReset();
    svc = new HospitalInfoService({} as any, { get: (k: string) => (k === 'HOMEPAGE_PUBLIC_URL' ? 'https://hospital.example.org' : undefined) } as any);
  });

  const withLastTs = (ts: string | undefined) => {
    vi.spyOn(svc as { readBuildStatus: () => unknown }, 'readBuildStatus' as never)
      .mockReturnValue(ts ? { status: 'deploy_triggered', ts } : null);
  };

  it('라이브 스탬프 = 최신 발행 ts 면 fresh', async () => {
    withLastTs('20260903-1611');
    safeFetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '20260903-1611' });
    const r = await svc.homepageLiveFreshness();
    expect(r.checked).toBe(true);
    expect(r.fresh).toBe(true);
    expect(r.detail).toContain('20260903-1611');
  });

  it('🔴 스탬프가 최신 발행과 다르면 낡음 — 두 ts 를 모두 말한다(전환 실패/다른 빌드)', async () => {
    withLastTs('20260903-1611');
    safeFetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '20260617-1748' });
    const r = await svc.homepageLiveFreshness();
    expect(r.fresh).toBe(false);
    expect(r.detail).toContain('20260617-1748');
    expect(r.detail).toContain('20260903-1611');
  });

  it('🔴 스탬프 404 = 스탬프 도입 이전 빌드 — 낡음으로 판정한다(유일하게 404 가 사실을 말하는 경우)', async () => {
    withLastTs('20260903-1611');
    safeFetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => '' });
    const r = await svc.homepageLiveFreshness();
    expect(r.checked).toBe(true);
    expect(r.fresh).toBe(false);
    expect(r.detail).toContain('이전 빌드');
  });

  it('🔴 연결 실패를 "낡음"으로 번역하지 않는다 — 확인 불가로 돌려준다', async () => {
    safeFetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await svc.homepageLiveFreshness();
    expect(r.checked).toBe(false);
    expect(r.fresh).toBeNull();
    expect(r.detail).toContain('확인 불가');
  });

  it('🔴 HTTP 5xx 도 "낡음"이 아니다', async () => {
    withLastTs('20260903-1611');
    safeFetchMock.mockResolvedValue({ ok: false, status: 502, text: async () => '' });
    const r = await svc.homepageLiveFreshness();
    expect(r.checked).toBe(false);
    expect(r.fresh).toBeNull();
  });

  it('🔴 스탬프 형식이 이상하면 판정하지 않는다(HTML 오류 페이지를 ts 로 읽지 않는다)', async () => {
    withLastTs('20260903-1611');
    safeFetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '<html>err</html>' });
    const r = await svc.homepageLiveFreshness();
    expect(r.checked).toBe(false);
    expect(r.fresh).toBeNull();
  });

  it('트리거 기록이 없으면 비교하지 않고 사실만 말한다', async () => {
    withLastTs(undefined);
    safeFetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '20260903-1611' });
    const r = await svc.homepageLiveFreshness();
    expect(r.checked).toBe(true);
    expect(r.fresh).toBeNull();
    expect(r.detail).toContain('비교할 대상이 없습니다');
  });

  it('빌드 스크립트가 스탬프를 실제로 심는다(생산자↔소비자 한 벌)', async () => {
    const { readFileSync } = await import('node:fs');
    const script = readFileSync('../../infra/scripts/build-homepage.sh', 'utf8');
    expect(script, '스크립트가 스탬프를 안 심으면 감지기는 영원히 404 낡음을 말한다').toContain('public/build-stamp.txt');
    const svcSrc = readFileSync('src/modules/hospital-info/hospital-info.service.ts', 'utf8');
    expect(svcSrc).toContain('/build-stamp.txt');
  });
});
