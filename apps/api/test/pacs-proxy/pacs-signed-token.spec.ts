/**
 * HIS ↔ OpenPACS 인증 — HIS 서명 토큰(RS256 · JWKS · aud=pacs)(2026-10-19 사용자 신고 "PACS 연동이 안 됨").
 *  · 🔴 종전: 직원 경로는 HIS 직원 JWT(HS256)를 그대로 넘기고, 포털 경로는 비밀번호 서비스 계정(운영 설정 없음 → 개발 자격)
 *    → OpenPACS 재구성 뒤 둘 다 401 — 직원 영상 목록·워크리스트·포털 영상·판독 알림 전부 끊김
 *  · 이제: 직원은 그 직원 이름으로 서명한 aud=pacs 토큰 · 포털/배치는 용도별 서비스 토큰(조회 NURSE · 업로드 LAB_TECH)
 *  · 대조군: 기관이 비밀번호 계정을 명시로 넣었으면 그것 · 서명 서비스가 없으면 종전 경로
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PacsProxyService } from '../../src/modules/pacs-proxy/pacs-proxy.service';
import { SignIntegrationService } from '../../src/modules/sign-integration/sign-integration.service';

const exp = () => new Date(Date.now() + 600_000).toISOString();
function mk(env: Record<string, string> = {}, signer: any = undefined) {
  const config: any = { get: vi.fn((k: string, d?: string) => env[k] ?? d) };
  const moduleRef: any = signer === null ? undefined : { get: vi.fn(() => signer) };
  return new PacsProxyService(config, moduleRef);
}
const signerMock = () => ({
  issueServiceToken: vi.fn(async (id: string) => ({ token: `svc-${id}`, expiresAt: exp() })),
  issueStaffToken: vi.fn(async (uid: string, aud: string) => ({ token: `staff-${uid}-${aud}`, expiresAt: exp() })),
});
const SSO = { hisUserId: 'u1', hisUserEmail: 'a@b', hisUserRole: 'DOCTOR', hisJwt: 'his-hs256' };

beforeEach(() => { vi.stubEnv('HIS_MODE', 'REHEARSAL'); global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'pw-token' }) }) as any; });

describe('🔴 서비스 경로(포털·배치) — 비밀번호 로그인 대신 서명 토큰', () => {
  it('조회 = pacs-read · 업로드 = pacs-upload · 비밀번호 로그인 시도 없음', async () => {
    const s = signerMock(); const p = mk({}, s);
    expect(await p.serviceAuthHeaders()).toEqual({ Authorization: 'Bearer svc-pacs-read' });
    expect(await p.serviceAuthHeaders('upload')).toEqual({ Authorization: 'Bearer svc-pacs-upload' });
    expect(global.fetch).not.toHaveBeenCalled();
    await p.serviceAuthHeaders();
    expect(s.issueServiceToken).toHaveBeenCalledTimes(2); // 캐시 — 같은 용도는 다시 서명하지 않는다
    expect(p.isServiceAccountConfigured()).toBe(true);
  });
  it('대조군 — 기관이 비밀번호 계정을 명시로 넣었으면 그 계정 · 서명 서비스 없으면 종전 경로', async () => {
    const s = signerMock();
    expect(await mk({ OPENPACS_USER: 'svc', OPENPACS_PASS: 'x' }, s).serviceAuthHeaders()).toEqual({ Authorization: 'Bearer pw-token' });
    expect(s.issueServiceToken).not.toHaveBeenCalled();
    expect(await mk({}, null).serviceAuthHeaders()).toEqual({ Authorization: 'Bearer pw-token' });
  });
});

describe('🔴 직원 경로 — HIS 직원 JWT 를 그대로 넘기지 않는다', () => {
  it('그 직원 이름으로 aud=pacs 서명 · 사용자 헤더 유지 · 서명 서비스 없으면 종전 JWT', async () => {
    const s = signerMock();
    const h: any = await (mk({}, s) as any).authHeaders(SSO);
    expect(h.Authorization).toBe('Bearer staff-u1-pacs');
    expect(h['X-HIS-User-Id']).toBe('u1');
    expect(s.issueStaffToken).toHaveBeenCalledWith('u1', 'pacs');
    const old: any = await (mk({}, null) as any).authHeaders(SSO);
    expect(old.Authorization).toBe('Bearer his-hs256');
  });
});

describe('서비스 토큰 내용 — 용도별 최소 권한 · 사람 id 와 섞이지 않음', () => {
  it('sub his-service:<용도> · aud pacs · 조회 NURSE · 업로드 LAB_TECH · email 로 감사 이름', async () => {
    const svc = Object.create(SignIntegrationService.prototype) as any;
    svc.config = { get: vi.fn(async () => 'hospitalrun') };
    svc.keyCustody = { kid: vi.fn(async () => 'k1'), signRs256: vi.fn(async () => Buffer.from('sig')) };
    const claims = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
    const r = claims((await svc.issueServiceToken('pacs-read')).token);
    expect(r).toMatchObject({ iss: 'hospitalrun', aud: 'pacs', sub: 'his-service:pacs-read', role: 'NURSE', email: 'his-portal-read@his.local', service: true });
    expect(claims((await svc.issueServiceToken('pacs-upload')).token)).toMatchObject({ role: 'LAB_TECH', sub: 'his-service:pacs-upload' });
    expect(JSON.parse(Buffer.from((await svc.issueServiceToken('pacs-read')).token.split('.')[0], 'base64url').toString())).toMatchObject({ alg: 'RS256', kid: 'k1' });
  });
});
