import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoLiveService } from '../../src/modules/go-live/go-live.service';
import { GO_LIVE_REGISTRY } from '../../src/modules/go-live/go-live.registry';

/**
 * 운영 모드 REAL 전환 판정 가드 (2026-08-25 등재)
 *
 * 🔴 왜 등재하는가: 리허설 배포본에는 시드 로그인(직원 계정·공용 비밀번호·시드 환자 MRN)이
 *    **번들에 들어 있다.** 관리 화면 토글은 숨길 뿐 지우지 못한다 — 되돌리는 것은 재배포다.
 *    "개시 전에 리얼로 바꾸자"를 사람 기억에 맡기면 백업 건(89일 방치)이 반복된다.
 *
 * 🔴 판정은 **빌드 상한**으로 한다. 런타임이 REAL 이어도 번들에 시드가 있으면 준비된 것이 아니다.
 */
describe('운영 모드 — 개시 전 REAL 전환을 화면이 판정한다', () => {
  const ORIGINAL = process.env.HIS_MODE;
  const svc = (runtime: unknown = null) =>
    new GoLiveService({} as never, { get: vi.fn().mockResolvedValue(runtime) } as never);
  const derive = (s: GoLiveService) =>
    (s as unknown as { deriveHisMode: () => Promise<{ status: string; detail: string }> }).deriveHisMode();

  beforeEach(() => { delete process.env.HIS_MODE; });
  afterEach(() => { if (ORIGINAL === undefined) delete process.env.HIS_MODE; else process.env.HIS_MODE = ORIGINAL; });

  it('등록부에 실측 항목으로 있다(수동 선언 타입이 아니다)', () => {
    const item = GO_LIVE_REGISTRY.find((d) => d.key === 'security.hisMode');
    expect(item, '운영 모드 항목 미등재').toBeDefined();
    expect(item!.type).toBe('DB_PROBE');
    expect(item!.sourceKey).toBe('hisMode');
  });

  it('🔴 리허설 빌드는 NOT_READY — 시드가 번들에 있다는 사실을 그대로 말한다', async () => {
    process.env.HIS_MODE = 'REHEARSAL';
    const r = await derive(svc());
    expect(r.status).toBe('NOT_READY');
    expect(r.detail).toMatch(/시드 로그인이 포함/);
    expect(r.detail).toMatch(/재배포/);
  });

  it('🔴 런타임을 REAL 로 돌려놔도 리허설 빌드는 여전히 NOT_READY (토글로는 지워지지 않는다)', async () => {
    process.env.HIS_MODE = 'REHEARSAL';
    const r = await derive(svc('REAL'));
    expect(r.status).toBe('NOT_READY');
  });

  it('개발 빌드도 NOT_READY', async () => {
    process.env.HIS_MODE = 'DEV';
    expect((await derive(svc())).status).toBe('NOT_READY');
  });

  it('대조군 — REAL 빌드는 READY 라고 말한다(성공을 실패로 말하지 않는다)', async () => {
    process.env.HIS_MODE = 'REAL';
    const r = await derive(svc());
    expect(r.status).toBe('READY');
    expect(r.detail).toMatch(/REAL/);
  });

  it('REAL 빌드에 런타임이 넓게 저장돼 있으면 무시됐다는 사실을 함께 말한다', async () => {
    process.env.HIS_MODE = 'REAL';
    const r = await derive(svc('DEV'));
    expect(r.status).toBe('READY');
    expect(r.detail).toMatch(/넓히지 못해 무시/);
  });

  it('미설정은 READY 이되 "확인했다"고 말하지 않는다', async () => {
    const r = await derive(svc());
    expect(r.status).toBe('READY');
    expect(r.detail).toMatch(/미설정/);
  });
});
