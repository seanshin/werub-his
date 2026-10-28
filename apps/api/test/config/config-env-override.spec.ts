import { describe, it, expect, afterEach, vi } from 'vitest';
import { ConfigRuntimeService } from '../../src/modules/config/config-runtime.service';

/**
 * 🔴 외부 점검 — `ai.server.url` 은 범용 설정 PUT 이 막아 두고 "변경은 배포(환경변수/마이그레이션)로만"
 * 이라 말했는데, **그 환경변수를 읽는 코드가 없었다**(`AI_SERVER_URL` 은 env 스키마에만 있었다).
 * 새로 설치하는 기관은 DB 를 직접 고치는 수밖에 없었고, 시드가 넣어 둔 **다른 설치본 주소**가 남았다.
 *
 * 지킨다: ① 환경변수가 있으면 DB 보다 이긴다 ② 출처를 `env` 로 **말한다**(값이 어디서 왔는지 숨기지 않는다)
 *        ③ 대조군 — 환경변수가 없으면 종전 그대로(DB → DEFAULTS).
 */
function svc(dbValue: string | null) {
  const prisma = {
    systemConfig: {
      findUnique: vi.fn(async () => (dbValue === null ? null : { key: 'ai.server.url', value: dbValue })),
    },
  } as any;
  return new ConfigRuntimeService(prisma);
}

describe('🔴 배포로만 바꾸는 키 — 환경변수가 이긴다', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('AI_SERVER_URL 이 있으면 DB 값을 이긴다', async () => {
    vi.stubEnv('AI_SERVER_URL', 'https://ai.institution.example');
    const s = svc('https://ai.other-install.example');
    expect(await s.get('ai.server.url')).toBe('https://ai.institution.example');
  });

  it('출처를 env 로 말한다(화면에서 못 바꾼다는 사실을 드러낸다)', async () => {
    vi.stubEnv('AI_SERVER_URL', 'https://ai.institution.example');
    const s = svc('https://ai.other-install.example');
    const got = await s.getWithSource('ai.server.url');
    expect(got).toMatchObject({ value: 'https://ai.institution.example', source: 'env' });
  });

  it('대조군 — 환경변수가 비어 있으면 종전대로 DB 값을 쓴다', async () => {
    vi.stubEnv('AI_SERVER_URL', '   ');
    const s = svc('https://ai.other-install.example');
    expect(await s.get('ai.server.url')).toBe('https://ai.other-install.example');
    expect((await s.getWithSource('ai.server.url')).source).toBe('db');
  });

  it('대조군 — 환경변수 덮어쓰기는 지정한 키에만 적용된다', async () => {
    vi.stubEnv('AI_SERVER_URL', 'https://ai.institution.example');
    const s = svc('WARN');
    expect(await s.get('pharmacy.durGate.enforce')).toBe('WARN');
  });
});
