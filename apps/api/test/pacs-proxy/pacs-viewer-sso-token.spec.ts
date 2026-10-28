import { describe, it, expect, vi } from 'vitest';
import { PacsProxyService } from '../../src/modules/pacs-proxy/pacs-proxy.service';
import { PacsProxyController } from '../../src/modules/pacs-proxy/pacs-proxy.controller';

/**
 * 뷰어 URL 의 자격(외부 점검) · 상태 EP 의 서비스 계정 표시.
 *
 * 무엇이 틀려 있었나:
 *   · §22 — `GET /pacs/viewer/:studyUid` 가 `extractSso(req).hisJwt` — **8시간 메인 access 토큰**을 뷰어 URL 쿼리에 실었다.
 *     jti 가 없어 재사용되고 브라우저 기록·PACS 접근 로그·Referer 에 남는다. 같은 화면의 '스터디 없음' 경로
 *     (`web/src/lib/pacs.ts`)는 이미 내부 IdP grant(aud `ohif`·60초·1회)를 쓰고 있었다 — 같은 사실에 자격이 둘(P12).
 *   · R26 잔여 — `GET /pacs/health` 가 서비스 계정 자격 유무를 말하지 않아 "PACS 살아 있음"과
 *     "포털·웹훅·배치가 503 을 받는 상태"가 같은 모양이었다.
 *
 * 🔴 재주입하면 반드시 실패한다:
 *   - 컨트롤러가 `extractSso(req)?.hisJwt` 를 다시 넘기면 → '메인 access 토큰을 싣지 않는다' 실패
 *   - grant 실패 catch 에서 `viewerToken = extractSso(req)?.hisJwt` 로 되돌아가면 → '발급 실패는 토큰 없는 URL' 실패
 *   - checkHealth 에서 `serviceAccount` 를 빼면 → '상태 응답이 서비스 계정 유무를 말한다' 실패
 */
const MAIN_TOKEN = 'MAIN-8H-ACCESS-TOKEN';
const reqOf = (user?: { id: string; role: string }) => ({
  user: user ? { ...user, email: 'd@h.example' } : undefined,
  headers: { authorization: `Bearer ${MAIN_TOKEN}` },
}) as any;

/** 정본(PacsProxyService)의 실제 getViewerUrl 을 쓴다 — 목이 내 가정이 되지 않게 */
function makeService(env: Record<string, string> = {}) {
  const config = { get: vi.fn((k: string, d?: string) => env[k] ?? d) } as any;
  return new PacsProxyService(config);
}

describe('🔴 PACS 뷰어 URL — 8시간 메인 토큰 대신 내부 IdP 단기·1회용 토큰(§22)', () => {
  it('내부 IdP grant(aud ohif)로 받은 토큰만 싣고, 메인 access 토큰은 싣지 않는다', async () => {
    const ssoIdp = { grant: vi.fn().mockResolvedValue({ mode: 'url', token: 'short-ohif-token', expiresIn: 60 }) };
    const ctrl = new PacsProxyController(makeService(), {} as any, ssoIdp as any);
    const out: any = await ctrl.getViewerUrl(reqOf({ id: 'u-1', role: 'DOCTOR' }), '1.2.3');
    expect(ssoIdp.grant).toHaveBeenCalledWith('u-1', 'DOCTOR', 'ohif');
    expect(out.data.url).toBe('/viewer/?StudyInstanceUIDs=1.2.3&token=short-ohif-token');
    expect(out.data.url).not.toContain(MAIN_TOKEN);
    expect(out.meta).toEqual({ tokenKind: 'internal-sso', audience: 'ohif', expiresInSec: 60, oneTime: true });
  });

  it('발급이 실패하면 토큰 없는 URL 이고 meta 가 그 사실을 말한다 — 메인 토큰으로 되돌아가지 않는다', async () => {
    const ssoIdp = { grant: vi.fn().mockRejectedValue(new Error('redis down')) };
    const ctrl = new PacsProxyController(makeService(), {} as any, ssoIdp as any);
    const out: any = await ctrl.getViewerUrl(reqOf({ id: 'u-1', role: 'DOCTOR' }), '1.2.3');
    expect(out.data.url).toBe('/viewer/?StudyInstanceUIDs=1.2.3');
    expect(out.data.url).not.toContain('token=');
    expect(out.meta).toEqual({ tokenKind: 'none', reason: 'SSO_GRANT_FAILED' });
  });

  it('grant 가 url 모드가 아니면(정본 어휘 redeem) 토큰을 싣지 않고 실패로 말한다', async () => {
    const ssoIdp = { grant: vi.fn().mockResolvedValue({ mode: 'redeem', redemptionCode: 'c', expiresIn: 60 }) };
    const ctrl = new PacsProxyController(makeService(), {} as any, ssoIdp as any);
    const out: any = await ctrl.getViewerUrl(reqOf({ id: 'u-1', role: 'DOCTOR' }), '1.2.3');
    expect(out.data.url).not.toContain('token=');
    expect(out.meta.tokenKind).toBe('none');
  });

  it('요청에 사용자가 없으면 발급을 시도하지 않는다(NO_USER) — 헤더의 토큰을 대신 싣지 않는다', async () => {
    const ssoIdp = { grant: vi.fn() };
    const ctrl = new PacsProxyController(makeService(), {} as any, ssoIdp as any);
    const out: any = await ctrl.getViewerUrl(reqOf(undefined), '1.2.3');
    expect(ssoIdp.grant).not.toHaveBeenCalled();
    expect(out.data.url).not.toContain(MAIN_TOKEN);
    expect(out.meta).toEqual({ tokenKind: 'none', reason: 'NO_USER' });
  });
});

describe('PACS 상태 EP — 서비스 계정 자격 유무를 갈라 말한다', () => {
  it('REAL 빌드 · 자격 미설정 → serviceAccount=NOT_CONFIGURED (PACS 가 살아 있어도)', async () => {
    vi.stubEnv('HIS_MODE', 'REAL');
    try {
      const svc = makeService({ OPENPACS_API_URL: 'http://pacs.test' });
      vi.spyOn(svc, 'checkHealth').mockResolvedValue({ status: 'ok' });
      const ctrl = new PacsProxyController(svc, {} as any, {} as any);
      const out: any = await ctrl.checkHealth();
      expect(out.data.status).toBe('ok');
      expect(out.data.serviceAccount).toBe('NOT_CONFIGURED');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('[대조군] 자격이 설정돼 있으면 CONFIGURED — 성공을 실패로 말하지 않는다', async () => {
    vi.stubEnv('HIS_MODE', 'REAL');
    try {
      const svc = makeService({ OPENPACS_API_URL: 'http://pacs.test', OPENPACS_USER: 'svc', OPENPACS_PASS: 'set' });
      vi.spyOn(svc, 'checkHealth').mockResolvedValue({ status: 'ok' });
      const ctrl = new PacsProxyController(svc, {} as any, {} as any);
      const out: any = await ctrl.checkHealth();
      expect(out.data.serviceAccount).toBe('CONFIGURED');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
