import { describe, it, expect, vi } from 'vitest';
import * as crypto from 'crypto';
import { fakeRedis } from './fake-redis';
import { SmartAuthService } from '../../src/modules/smart-auth/smart-auth.service';

/**
 * SMART id_token(RS256)·standalone launch 계약 — 2026-07-30 (Cerno 회신 결함 A·B 봉합).
 *
 * A: 종전 id_token 은 client_secret **해시**로 HS256 서명돼 클라이언트가 영원히 검증 불가였다.
 * B: standalone launch 는 사용자 인증이 없어 fhirUser 가 undefined 였고, 그 결과 "의료진 본인
 *    권한 범위" 전제도 성립하지 않았다.
 */
const KID = 'test-kid';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

function build(over: { client?: unknown; patient?: unknown } = {}) {
  const prisma: any = {
    smartClient: {
      findUnique: vi.fn().mockResolvedValue(over.client ?? { id: 'c1', clientId: 'cerno', clientSecret: 'HASHED', name: 'cerno', scopes: ['openid', 'fhirUser', 'patient/Patient.read'], redirectUris: ['https://cerno.example/cb'], isActive: true, orgId: null }),
      update: vi.fn().mockResolvedValue({}),
    },
    patient: { findUnique: vi.fn().mockResolvedValue(over.patient ?? { id: 'p-1' }) },
  };
  const jwt: any = { sign: vi.fn().mockReturnValue('access-token') };
  const keyCustody: any = {
    kid: vi.fn().mockResolvedValue(KID),
    signRs256: vi.fn(async (_ref: string, data: Buffer) => crypto.sign('RSA-SHA256', data, privateKey)),
    publicJwks: vi.fn().mockResolvedValue({ keys: [{ kty: 'RSA', kid: KID, use: 'sig', alg: 'RS256' }] }),
  };
  const redis = fakeRedis();
  return { svc: new SmartAuthService(prisma, jwt, keyCustody, redis as never), prisma, keyCustody, redis };
}

/** RS256 JWT 를 공개키로 검증(클라이언트가 하는 일과 동일) */
function verifyRs256(token: string): Record<string, unknown> {
  const [h, p, s] = token.split('.');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url'));
  expect(ok).toBe(true);
  return JSON.parse(Buffer.from(p, 'base64url').toString());
}

describe('A. id_token 서명 — RS256(JWKS)', () => {
  it('공개키로 검증 가능한 RS256 토큰을 발급한다(해시 서명 금지)', async () => {
    const { svc, keyCustody, redis } = build();
    await svc.issueAuthorizationCodeForUser('cerno', 'https://cerno.example/cb', 'openid fhirUser patient/Patient.read', 'u-1', { patientId: 'p-1' });
    const code = [...redis._store.keys()].find((k) => k.startsWith('smart:authcode:'))!.slice('smart:authcode:'.length);
    const res: any = await svc.exchangeAuthorizationCode(code, 'cerno', 'https://cerno.example/cb');
    expect(res.id_token).toBeTruthy();
    const header = JSON.parse(Buffer.from(res.id_token.split('.')[0], 'base64url').toString());
    expect(header).toMatchObject({ alg: 'RS256', kid: KID });
    const claims = verifyRs256(res.id_token);
    expect(claims.aud).toBe('cerno');
    // 🔴 시크릿(해시)으로 서명하지 않는다 — 서명은 KeyCustody 개인키로만
    expect(keyCustody.signRs256).toHaveBeenCalled();
  });

  it('JWKS 는 공개키만 게시(개인키 미노출)', async () => {
    const { svc } = build();
    const jwks = await svc.idTokenJwks();
    expect(jwks.keys[0]).toMatchObject({ alg: 'RS256', use: 'sig' });
    expect(JSON.stringify(jwks)).not.toContain('PRIVATE');
  });

  it('well-known 은 RS256·jwks_uri 를 광고한다', () => {
    const { svc } = build();
    const cfg: any = svc.getSmartConfiguration('https://his.example');
    expect(cfg.id_token_signing_alg_values_supported).toEqual(['RS256']);
    expect(cfg.jwks_uri).toBe('https://his.example/.well-known/smart-jwks.json');
  });
});

describe('B. standalone launch — 사용자 바인딩', () => {
  it('로그인 의료진을 fhirUser(Practitioner/<id>)로 바인딩한다', async () => {
    const { svc, redis } = build();
    await svc.issueAuthorizationCodeForUser('cerno', 'https://cerno.example/cb', 'openid fhirUser patient/Patient.read', 'u-42', { patientId: 'p-1' });
    const entry = redis.read([...redis._store.keys()].find((k) => k.startsWith('smart:authcode:'))!);
    expect(entry.fhirUser).toBe('Practitioner/u-42');
    expect(entry.patient).toBe('p-1');
  });

  it('id_token 에 fhirUser·patient 클레임이 실린다(서고 소유 키)', async () => {
    const { svc, redis } = build();
    await svc.issueAuthorizationCodeForUser('cerno', 'https://cerno.example/cb', 'openid fhirUser patient/Patient.read', 'u-42', { patientId: 'p-1' });
    const code = [...redis._store.keys()].find((k) => k.startsWith('smart:authcode:'))!.slice('smart:authcode:'.length);
    const res: any = await svc.exchangeAuthorizationCode(code, 'cerno', 'https://cerno.example/cb');
    const claims = verifyRs256(res.id_token);
    expect(claims.fhirUser).toBe('Practitioner/u-42');
    expect(claims.patient).toBe('p-1');
    expect(claims.sub).toBe('Practitioner/u-42'); // 주체는 사용자
  });

  it('환자 스코프를 요청했는데 환자 미선택이면 거부(fail-closed)', async () => {
    const { svc } = build();
    await expect(
      svc.issueAuthorizationCodeForUser('cerno', 'https://cerno.example/cb', 'patient/Patient.read', 'u-1', {}),
    ).rejects.toThrow();
  });

  it('없는 환자면 거부', async () => {
    const { svc, prisma } = build();
    prisma.patient.findUnique.mockResolvedValue(null);
    await expect(
      svc.issueAuthorizationCodeForUser('cerno', 'https://cerno.example/cb', 'patient/Patient.read', 'u-1', { patientId: 'nope' }),
    ).rejects.toThrow();
  });

  it('미등록 redirect_uri 는 거부', async () => {
    const { svc } = build();
    await expect(
      svc.issueAuthorizationCodeForUser('cerno', 'https://evil.example/cb', 'openid', 'u-1', {}),
    ).rejects.toThrow();
  });

  it('EHR launch 문맥 유효성 판정 — 없는/만료 토큰은 standalone 으로 분기', async () => {
    const { svc } = build();
    await expect(svc.hasLaunchContext(undefined)).resolves.toBe(false);
    await expect(svc.hasLaunchContext('nope')).resolves.toBe(false);
    const launch = await svc.createLaunchContext('p-1', 'Practitioner/u-9');
    await expect(svc.hasLaunchContext(launch)).resolves.toBe(true);
  });
});
