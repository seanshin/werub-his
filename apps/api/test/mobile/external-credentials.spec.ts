import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { ExternalCredentialsService } from '../../src/modules/mobile/external-credentials.service';
import { EXTERNAL_CREDENTIALS } from '../../src/modules/mobile/external-credentials';
import { LocalFakeIdentityAdapter } from '../../src/modules/mobile/identity/local-fake.adapter';

/**
 * 🔴 외부 자격증명을 한 곳에 모은 이유 — 흩어져 있으면 **미설정이 "설정된 것처럼" 조용히 통과한다.**
 *    이 가드는 "없으면 무엇이 되는가"가 실제로 그렇게 되는지를 확인한다.
 */
describe('외부 자격증명 — 없으면 되는 척하지 않는다', () => {
  let svc: ExternalCredentialsService;
  const env: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    svc = new ExternalCredentialsService({ get: vi.fn((k: string) => env[k]) } as never);
    for (const c of EXTERNAL_CREDENTIALS) for (const e of c.env) delete process.env[e];
  });

  it('미설정이면 configured=false 이고 빠진 **환경변수 이름**을 말한다', () => {
    const row = svc.status().find((r) => r.key === 'apple.appIdentity')!;
    expect(row.configured).toBe(false);
    expect(row.missing).toContain('APPLE_TEAM_ID');
  });

  it('🔴 상태에 **값 자체는 담기지 않는다** (로그·응답에 실려 나가지 않게)', () => {
    process.env.APPLE_TEAM_ID = 'SECRET_TEAM';
    const json = JSON.stringify(svc.status());
    expect(json).not.toContain('SECRET_TEAM');
    delete process.env.APPLE_TEAM_ID;
  });

  it('🔴 FAIL_CLOSED 값을 요구하면 **기본값으로 잇지 않고 멈춘다**', () => {
    expect(() => svc.requireValue('apple.appIdentity', 'APPLE_TEAM_ID')).toThrowError(ServiceUnavailableException);
    try {
      svc.requireValue('apple.appIdentity', 'APPLE_TEAM_ID');
    } catch (e) {
      expect((e as ServiceUnavailableException).getResponse()).toMatchObject({
        code: 'APP_IDENTITY_NOT_CONFIGURED',
      });
    }
  });

  it('대조군 — 설정되면 값을 돌려준다(무조건 던지는 가드가 아니다)', () => {
    env.APPLE_TEAM_ID = 'TEAM123456';
    expect(svc.requireValue('apple.appIdentity', 'APPLE_TEAM_ID')).toBe('TEAM123456');
  });

  it('🔴 준비율을 하나로 합치지 않는다 (FAIL_CLOSED 와 FEATURE_OFF 는 다른 사실)', () => {
    const s = svc.summary();
    expect(s).toHaveProperty('failClosed');
    expect(s).toHaveProperty('featureOff');
    expect(s.failClosed.total + s.featureOff.total).toBe(EXTERNAL_CREDENTIALS.length);
  });

  it('모든 항목이 담당자와 미설정 코드를 갖는다 (누가 넣어야 하는지 모르면 영원히 미설정이다)', () => {
    for (const c of EXTERNAL_CREDENTIALS) {
      expect(c.owner.length).toBeGreaterThan(1);
      expect(c.unavailableCode).toMatch(/^[A-Z_]+$/);
      // 🔴 계약은 "설정 경로가 하나 이상 있다"이지 "env 배열이 비어 있지 않다"가 아니다.
      //    FCM 처럼 두 변수 중 **택일**인 항목은 anyOfEnv 로 표시한다(2026-08-25).
      expect(c.env.length + (c.anyOfEnv?.length ?? 0)).toBeGreaterThan(0);
    }
  });
});

describe('개발용 본인확인 fake — 운영으로 새지 않는다', () => {
  it('🔴 fake 어댑터는 운영 사용 불가로 표시된다', () => {
    expect(new LocalFakeIdentityAdapter().usableInProduction).toBe(false);
  });

  it('합성 CI 는 접두로 구분된다 (운영 데이터에 섞여도 셀 수 있게)', async () => {
    const a = new LocalFakeIdentityAdapter();
    await a.completeCallback({ verificationId: 'v1', stateNonce: 's', raw: { tx: 't1', seed: 'x' } });
    const r = await a.fetchVerifiedResult('t1');
    expect(r.ci.startsWith('LOCALFAKE')).toBe(true);
    // 형식은 본인확인기관 CI 와 같아야 가입 경로가 열린다(형식 검증을 통과해야 흐름이 끝까지 돈다)
    expect(r.ci).toMatch(/^[A-Za-z0-9+/]{86}==$/);
  });
});
