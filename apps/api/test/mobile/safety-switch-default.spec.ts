import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { IdentityService, allowLocalFake } from '../../src/modules/mobile/identity/identity.service';
import { LocalFakeIdentityAdapter } from '../../src/modules/mobile/identity/local-fake.adapter';

/**
 * 🔴 안전 분기를 **설정되지 않은 변수**에 걸지 않는다.
 *
 * 실측(2026-08-24): 운영 서버(`his.example.org`)에 `NODE_ENV` 가 **아예 설정돼 있지 않았다**.
 * 그래서 `process.env.NODE_ENV === 'production'` 으로 가른 안전 분기는 운영에서 **거짓**이 됐고,
 * ① 개발용 fake 본인확인 어댑터가 운영에서 선택될 수 있었고
 * ② development attestation 이 운영에서 통과할 수 있었다.
 *
 * 규칙: 위험한 쪽은 **명시적 옵트인**으로만 열린다. 설정을 잊은 환경은 안전한 환경이어야 한다.
 */
describe('위험한 기본값은 없다 — 옵트인해야 열린다', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env.IDENTITY_ALLOW_LOCAL_FAKE;
    delete process.env.APP_ATTEST_ALLOW_DEVELOPMENT;
    delete process.env.NODE_ENV;
    delete process.env.HIS_MODE;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  const makeIdentity = (configured: boolean) =>
    new IdentityService(
      {} as never,
      { isConfigured: vi.fn(() => configured) } as never,
      {} as never,
      new LocalFakeIdentityAdapter(),
    );

  it('🔴 NODE_ENV 가 없어도 fake 본인확인은 선택되지 않는다', async () => {
    const svc = makeIdentity(false);
    await expect(svc.start({ purpose: 'PATIENT_SIGNUP' })).rejects.toThrowError(ServiceUnavailableException);
  });

  // 🔴 (2026-09-13 상용 릴리즈 T4-3) 옵트인은 **개발 모드에서만** 먹는다 — `HIS_MODE` 미설정은 REAL(가장 제한적)이라
  //    종전처럼 옵트인만으로 열리지 않는다. "개발에서 쓸 수 있다" 대조군은 개발 모드를 **명시**한다.
  it('대조군 — 개발 모드에서 명시적으로 켜면 쓸 수 있다(기능을 죽이지 않는다)', () => {
    process.env.HIS_MODE = 'DEV';
    expect(allowLocalFake()).toBe(false);
    process.env.IDENTITY_ALLOW_LOCAL_FAKE = 'true';
    expect(allowLocalFake()).toBe(true);
  });

  it('🔴 REAL(및 HIS_MODE 미설정)에서는 옵트인이 켜져 있어도 fake 본인확인을 쓰지 않는다', () => {
    process.env.IDENTITY_ALLOW_LOCAL_FAKE = 'true';
    delete process.env.HIS_MODE;
    expect(allowLocalFake()).toBe(false);
    process.env.HIS_MODE = 'REAL';
    expect(allowLocalFake()).toBe(false);
    process.env.HIS_MODE = 'REHEARSAL';
    expect(allowLocalFake()).toBe(true); // 리허설은 종전 동작 유지(운영이 리허설이다)
  });

  it('🔴 health 는 fake 가 실제로 쓸 수 있을 때만 그 이름을 말한다', async () => {
    process.env.HIS_MODE = 'DEV';
    const svc = makeIdentity(false);
    expect((await svc.health()).developmentFallback).toBeNull();
    process.env.IDENTITY_ALLOW_LOCAL_FAKE = 'true';
    expect((await svc.health()).developmentFallback).toBe('LOCAL_FAKE');
  });

  it('🔴 코드가 NODE_ENV 로 안전을 가르지 않는다 (같은 실수 재발 차단)', async () => {
    const { readFileSync } = await import('node:fs');
    const files = [
      'src/modules/mobile/identity/identity.service.ts',
      'src/modules/mobile/app-key/app-key.service.ts',
    ];
    for (const f of files) {
      const src = readFileSync(`${process.cwd()}/${f}`, 'utf8');
      // 주석에서 사건을 설명하는 것은 허용하고, **실행되는 비교**만 막는다
      const executable = src
        .split('\n')
        .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
        .join('\n');
      expect(executable).not.toMatch(/NODE_ENV\s*===?\s*'production'/);
    }
  });
});
