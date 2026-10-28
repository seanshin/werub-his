import { describe, it, expect, vi } from 'vitest';
import { SmartAuthService } from '../../src/modules/smart-auth/smart-auth.service';
import { fakeRedis } from './fake-redis';

/**
 * EHR launch 런처 계약 — 2026-07-30 (Cerno 요청: "런처에서 요청하는 기능").
 *
 * standalone 에 사용자 인증을 요구하게 되면서 외부 앱이 스스로 code 를 받아올 수 없다.
 * 정상 진입은 **HIS 차트에서 실행**(환자+의료진 바인딩 launch 토큰)이므로 그 진입점을 계약으로 고정한다.
 */
const CLIENT = {
  name: 'cerno (개인화 임상 AI)',
  isActive: true,
  launchUrl: 'https://cerno.example.org/smart/launch',
  scopes: ['launch', 'openid', 'fhirUser', 'patient/Patient.read'],
};

function build(over: { client?: unknown; patient?: unknown; consent?: unknown; apps?: unknown[] } = {}) {
  const prisma: any = {
    smartClient: {
      findUnique: vi.fn().mockResolvedValue('client' in over ? over.client : CLIENT),
      findMany: vi.fn().mockResolvedValue(over.apps ?? [{ clientId: 'cerno', name: CLIENT.name, launchUrl: CLIENT.launchUrl, scopes: CLIENT.scopes }]),
    },
    patient: { findUnique: vi.fn().mockResolvedValue('patient' in over ? over.patient : { id: 'p-1' }) },
    patientAiConsent: { findUnique: vi.fn().mockResolvedValue('consent' in over ? over.consent : { consented: true, revokedAt: null }) },
  };
  const redis = fakeRedis();
  return { svc: new SmartAuthService(prisma, {} as any, {} as any, redis as never), prisma, redis };
}

describe('EHR launch 발급(buildEhrLaunch)', () => {
  it('앱 launch URL 에 iss·launch 를 붙여 돌려준다', async () => {
    const { svc } = build();
    const out = await svc.buildEhrLaunch('cerno', 'p-1', 'u-doc');
    const u = new URL(out.url);
    expect(u.origin + u.pathname).toBe('https://cerno.example.org/smart/launch');
    expect(u.searchParams.get('iss')).toBe(out.iss);
    expect(u.searchParams.get('launch')).toBe(out.launch);
    expect(out.appName).toBe(CLIENT.name);
  });

  it('launch 문맥에 환자와 **의료진 본인**이 함께 바인딩된다(fhirUser 근거)', async () => {
    const { svc, redis } = build();
    const out = await svc.buildEhrLaunch('cerno', 'p-1', 'u-doc');
    expect(redis.read(`smart:launch:${out.launch}`)).toMatchObject({ patient: 'p-1', fhirUser: 'Practitioner/u-doc' });
    await expect(svc.hasLaunchContext(out.launch)).resolves.toBe(true);
  });

  it('launch 토큰은 5분 만료다', async () => {
    const { svc, redis } = build();
    const out = await svc.buildEhrLaunch('cerno', 'p-1', 'u-doc');
    const ttl = redis.ttlMs(`smart:launch:${out.launch}`);
    expect(ttl).toBeGreaterThan(4 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it('🔴 user/ 스코프만 가진 앱도 AI 활용 동의 없으면 발급하지 않는다', async () => {
    const { svc } = build({ client: { ...CLIENT, scopes: ['launch', 'openid', 'user/*.read'] }, consent: null });
    await expect(svc.buildEhrLaunch('cerno', 'p-1', 'u-doc')).rejects.toThrow(/동의/);
  });

  it('🔴 런처 목록도 같은 판정 — user/ 앱을 patientScoped 로 표시', async () => {
    const { svc } = build({ apps: [{ clientId: 'u', name: 'u', launchUrl: 'https://x', scopes: ['user/Observation.read'] }], consent: null });
    const apps = await svc.listLaunchApps('p-1');
    expect(apps[0]).toMatchObject({ patientScoped: true, consentOk: false });
  });

  it('🔴 환자 스코프 앱은 AI 활용 동의 없으면 발급하지 않는다(PHI 외부전송 게이트)', async () => {
    const { svc } = build({ consent: null });
    await expect(svc.buildEhrLaunch('cerno', 'p-1', 'u-doc')).rejects.toThrow(/동의/);
  });

  it('동의 철회분도 미동의로 본다', async () => {
    const { svc } = build({ consent: { consented: true, revokedAt: new Date() } });
    await expect(svc.buildEhrLaunch('cerno', 'p-1', 'u-doc')).rejects.toThrow(/동의/);
  });

  it('환자 스코프가 없는 앱(인구단위·비PHI)은 동의 게이트를 타지 않는다', async () => {
    const { svc, prisma } = build({ client: { ...CLIENT, scopes: ['launch', 'openid'] }, consent: null });
    await expect(svc.buildEhrLaunch('cerno', 'p-1', 'u-doc')).resolves.toMatchObject({ appName: CLIENT.name });
    expect(prisma.patientAiConsent.findUnique).not.toHaveBeenCalled();
  });

  it('비활성·미등록 클라이언트는 404', async () => {
    await expect(build({ client: null }).svc.buildEhrLaunch('x', 'p-1', 'u')).rejects.toThrow(/등록되지 않은/);
    await expect(build({ client: { ...CLIENT, isActive: false } }).svc.buildEhrLaunch('cerno', 'p-1', 'u')).rejects.toThrow(/등록되지 않은/);
  });

  it('launch URL 미등록 앱은 400(관리에서 등록하도록 안내)', async () => {
    const { svc } = build({ client: { ...CLIENT, launchUrl: null } });
    await expect(svc.buildEhrLaunch('cerno', 'p-1', 'u')).rejects.toThrow(/launch URL/);
  });

  it('없는 환자로는 문맥을 만들지 않는다', async () => {
    const { svc } = build({ patient: null });
    await expect(svc.buildEhrLaunch('cerno', 'p-x', 'u')).rejects.toThrow(/환자를 찾을 수 없습니다/);
  });
});

describe('런처 목록(listLaunchApps)', () => {
  it('launchUrl 이 등록된 활성 앱만 질의한다', async () => {
    const { svc, prisma } = build();
    await svc.listLaunchApps();
    expect(prisma.smartClient.findMany.mock.calls[0][0].where).toEqual({ isActive: true, launchUrl: { not: null } });
  });

  it('환자를 주면 동의 여부를 함께 실어 준다(런처가 미리 표시)', async () => {
    const { svc } = build({ consent: null });
    const apps = await svc.listLaunchApps('p-1');
    expect(apps[0]).toMatchObject({ clientId: 'cerno', patientScoped: true, consentOk: false });
  });

  it('환자가 없으면 동의 여부는 미판정(undefined)', async () => {
    const { svc, prisma } = build();
    const apps = await svc.listLaunchApps();
    expect(apps[0].consentOk).toBeUndefined();
    expect(prisma.patientAiConsent.findUnique).not.toHaveBeenCalled();
  });

  it('목록에 시크릿·launch URL 원문을 노출하지 않는다', async () => {
    const { svc } = build();
    const apps = await svc.listLaunchApps('p-1');
    expect(JSON.stringify(apps)).not.toMatch(/clientSecret|launchUrl/);
  });
});
