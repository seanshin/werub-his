import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KeyCustodyService } from '../../src/common/crypto/key-custody.service';
import { isEncrypted } from '../../src/common/crypto/field-encryption';
import type { ConfigRuntimeService } from '../../src/modules/config/config-runtime.service';

/**
 * 🔴 외부 점검 — RS256 **개인키**는 `system_configs` 에 평문 PEM 으로 들어가 있었다.
 * 설정 테이블을 읽을 수 있거나 DB 백업을 가진 사람이 **직원 서명 토큰(aud=sign)을 위조**할 수 있는 구조다.
 *
 * 지킨다: ① 새로 만든 키는 감싸서 저장한다 ② 감싼 값은 다시 PEM 으로 읽힌다
 *        ③ 레거시 평문은 읽히고 **그 자리에서** 감싸진다 ④ 🔴 풀지 못하면 **던진다**
 *        ⑤ ENCRYPTION_KEY 가 없으면 종전대로 저장하되 경고한다(설치를 죽이지 않는다).
 *
 * ④ 가 핵심이다 — 정본 `decryptField` 는 실패 시 **원본을 그대로 돌려준다**. 그 값을 PEM 인 척
 * 서명기에 넘기면 "키가 바뀌었다"가 알 수 없는 서명 오류로 둔갑한다.
 */
function fakeConfig() {
  const store = new Map<string, unknown>();
  const config = {
    get: vi.fn(async (k: string) => store.get(k)),
    set: vi.fn(async (k: string, v: unknown) => {
      store.set(k, v);
    }),
  } as unknown as ConfigRuntimeService;
  return { config, store };
}

const KEY_REF = 'test.jwks';

describe('🔴 RS256 개인키 저장 — 평문으로 두지 않는다(R15)', () => {
  beforeEach(() => vi.stubEnv('ENCRYPTION_KEY', '0123456789abcdef0123456789abcdef'));
  afterEach(() => vi.unstubAllEnvs());

  it('새로 만든 개인키는 감싸서 저장한다(평문 PEM 이 설정 테이블에 남지 않는다)', async () => {
    const { config, store } = fakeConfig();
    const service = new KeyCustodyService(config);

    await service.kid(KEY_REF);

    const stored = store.get(`${KEY_REF}PrivateSecret`) as string;
    expect(stored, '저장값이 없다 — 이 가드는 아무것도 보증하지 않는다').toBeTruthy();
    expect(stored.includes('PRIVATE KEY'), '개인키가 평문으로 저장됐다').toBe(false);
    expect(isEncrypted(stored)).toBe(true);
  });

  it('감싼 값은 다시 PEM 으로 읽혀 서명에 쓰인다', async () => {
    const { config } = fakeConfig();
    const service = new KeyCustodyService(config);
    await service.kid(KEY_REF);

    const sig = await service.signRs256(KEY_REF, Buffer.from('hello'));
    expect(sig.length).toBeGreaterThan(64);
  });

  it('레거시 평문 개인키는 읽히고 — 그 자리에서 감싸진다', async () => {
    const { config, store } = fakeConfig();
    const seed = new KeyCustodyService(config);
    await seed.kid(KEY_REF);
    // 평문으로 되돌려 놓는다(종전 상태 재현)
    const pem = (await (seed as any).ensureRs256(KEY_REF)).privatePem as string;
    store.set(`${KEY_REF}PrivateSecret`, pem);

    const service = new KeyCustodyService(config);
    const sig = await service.signRs256(KEY_REF, Buffer.from('hello'));

    expect(sig.length).toBeGreaterThan(64);
    expect(isEncrypted(store.get(`${KEY_REF}PrivateSecret`) as string), '평문이 그대로 남았다').toBe(true);
  });

  it('🔴 풀리지 않는 값은 — 조용히 통과시키지 않고 던진다(키가 바뀌었거나 값이 상했다)', async () => {
    const { config, store } = fakeConfig();
    const seed = new KeyCustodyService(config);
    await seed.kid(KEY_REF);

    // 🔴 키 교체를 한 프로세스 안에서 흉내 낼 수 없다 — `field-encryption` 이 파생 키를 캐시한다(재기동에서만 바뀐다).
    //    같은 결과(=풀 수 없는 저장값)를 값 훼손으로 만든다: GCM authTag 가 어긋나 복호가 실패한다.
    const [iv, tag, cipher] = (store.get(`${KEY_REF}PrivateSecret`) as string).split(':');
    const flipped = cipher.slice(0, -1) + (cipher.endsWith('a') ? 'b' : 'a');
    store.set(`${KEY_REF}PrivateSecret`, `${iv}:${tag}:${flipped}`);

    const service = new KeyCustodyService(config);
    await expect(service.signRs256(KEY_REF, Buffer.from('x'))).rejects.toThrow(/ENCRYPTION_KEY/);
    // 원본을 PEM 인 척 넘기지 않았다 — 저장값도 덮어쓰지 않는다(손상 확정 금지)
    expect(isEncrypted(store.get(`${KEY_REF}PrivateSecret`) as string)).toBe(true);
  });

  it('대조군 — ENCRYPTION_KEY 가 없으면 종전대로(평문) 저장하고 설치를 죽이지 않는다', async () => {
    vi.stubEnv('ENCRYPTION_KEY', '');
    const { config, store } = fakeConfig();
    const service = new KeyCustodyService(config);

    const sig = await service.signRs256(KEY_REF, Buffer.from('hello'));
    expect(sig.length).toBeGreaterThan(64);
    expect((store.get(`${KEY_REF}PrivateSecret`) as string).includes('PRIVATE KEY')).toBe(true);
  });
});
