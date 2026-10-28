import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoLiveService } from '../../src/modules/go-live/go-live.service';
import { GO_LIVE_REGISTRY } from '../../src/modules/go-live/go-live.registry';

/**
 * PID 암호화 키 로테이션 실측 판정 가드 (2026-09-01 · 사람/외부 게이트를 관리 화면에 노출).
 *
 * 🔴 운영 `ENCRYPTION_KEY` 가 all-zeros(개발 플레이스홀더)면 PID 암호화가 무력하다(2026-08-25 운영 실측).
 *    이 항목은 사람 선언이 아니라 **env 값으로 자동 판정**한다 — 플레이스홀더면 /admin/go-live 가
 *    자동으로 NOT_READY(빨강)로 표시해 권한자가 로테이션을 결정하게 한다.
 *
 * 재주입: all-zeros 를 READY 로 통과시키면(예: `/^0+$/` 검사 삭제) 아래가 실패한다.
 */
describe('PID 암호화 키 로테이션 — env 로 판정한다(사람 선언 불가)', () => {
  const svc = () => new GoLiveService({} as never, { get: vi.fn() } as never);
  const derive = (s: GoLiveService) =>
    (s as unknown as { deriveEncryptionKey: () => { status: string; detail: string } }).deriveEncryptionKey();
  let saved: string | undefined;
  beforeEach(() => { saved = process.env.ENCRYPTION_KEY; });
  afterEach(() => { if (saved === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = saved; });

  it('등록부에 실측 항목으로 있다(수동 선언 타입이 아니다)', () => {
    const item = GO_LIVE_REGISTRY.find((d) => d.key === 'security.encryptionKey');
    expect(item, '키 로테이션 항목 미등재').toBeDefined();
    expect(item!.type).toBe('DB_PROBE');
    expect(item!.sourceKey).toBe('encryptionKey');
  });

  it('🔴 all-zeros(플레이스홀더)는 NOT_READY — "키 있음"으로 통과시키지 않는다', () => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    const r = derive(svc());
    expect(r.status).toBe('NOT_READY');
    expect(r.detail).toMatch(/all-zeros|플레이스홀더/);
  });

  it('🔴 미설정은 NOT_READY', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(derive(svc()).status).toBe('NOT_READY');
  });

  it('🔴 길이 오류(64자 아님)는 NOT_READY', () => {
    process.env.ENCRYPTION_KEY = 'abc123';
    expect(derive(svc()).status).toBe('NOT_READY');
  });

  it('실 키(64 hex·플레이스홀더 아님)는 READY — 과잉 차단이 아니다', () => {
    process.env.ENCRYPTION_KEY = 'a3f9'.repeat(16); // 64 hex, 0 아님
    expect(derive(svc()).status).toBe('READY');
  });
});
