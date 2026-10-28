import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GoLiveService } from '../../src/modules/go-live/go-live.service';
import { GO_LIVE_REGISTRY } from '../../src/modules/go-live/go-live.registry';

/**
 * 정기 DB 백업 실측 판정 가드 (2026-08-25 · 실사고 후 등재)
 *
 * 🔴 실사고: 크론은 2026-05-07부터 매일 돌았는데 스크립트에 실행 비트가 없어 `Permission denied` **89회**.
 *    문서에는 "매일 03:00 자동 백업"이라 적혀 있었고 **아무도 확인하지 않았다.**
 *    그래서 이 항목은 "크론이 등록됐는가"가 아니라 **"최근 백업 파일이 있는가"** 를 본다 —
 *    크론이 돌아도 실패하면 파일이 안 생긴다. 그 구분이 이 항목의 존재 이유다.
 */
describe('정기 DB 백업 — 파일로 판정한다(사람 선언 불가)', () => {
  let dir: string;
  const svc = () => new GoLiveService({} as never, { get: vi.fn() } as never);
  const derive = (s: GoLiveService) => (s as unknown as { deriveDbBackup: () => Promise<{ status: string; detail: string }> }).deriveDbBackup();

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
    process.env.DB_BACKUP_DIR = dir;
  });
  afterEach(() => {
    delete process.env.DB_BACKUP_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('등록부에 실측 항목으로 있다(수동 선언 타입이 아니다)', () => {
    const item = GO_LIVE_REGISTRY.find((d) => d.key === 'security.dbBackup');
    expect(item, '백업 항목 미등재').toBeDefined();
    expect(item!.type).toBe('DB_PROBE');
    expect(item!.sourceKey).toBe('dbBackup');
  });

  it('🔴 백업 파일이 없으면 NOT_READY — "크론 있음"으로 통과시키지 않는다', async () => {
    const r = await derive(svc());
    expect(r.status).toBe('NOT_READY');
    expect(r.detail).toMatch(/없다/);
  });

  it('🔴 오래된 백업(48h 초과)은 NOT_READY — 파일이 있다고 통과시키지 않는다', async () => {
    const f = path.join(dir, 'hospitalrun_20260801_030001.sql.gz.gpg');
    fs.writeFileSync(f, 'x');
    const old = Date.now() - 5 * 24 * 3_600_000;
    fs.utimesSync(f, new Date(old), new Date(old));
    const r = await derive(svc());
    expect(r.status).toBe('NOT_READY');
    expect(r.detail).toMatch(/일 전/);
  });

  it('대조군 — 최근 백업이 있으면 READY 라고 말한다(성공을 실패로 말하지 않는다)', async () => {
    fs.writeFileSync(path.join(dir, 'hospitalrun_20260911_030001.sql.gz.gpg'), 'x');
    const r = await derive(svc());
    expect(r.status).toBe('READY');
    expect(r.detail).toMatch(/최근 백업/);
  });

  it('🔴 디렉터리를 못 읽으면 "정상"이 아니라 판정 불가로 말한다', async () => {
    process.env.DB_BACKUP_DIR = path.join(dir, 'no-such-dir');
    const r = await derive(svc());
    expect(r.status).toBe('NOT_READY');
    expect(r.detail).toMatch(/판정 불가/);
  });

  it('평문(.sql.gz)만 있으면 암호화 백업으로 세지 않는다(BR-2)', async () => {
    fs.writeFileSync(path.join(dir, 'hospitalrun_20260911_030001.sql.gz'), 'x');
    const r = await derive(svc());
    expect(r.status).toBe('NOT_READY');
  });

  /**
   * 🔴 2026-09-11 — 배포 백업(`deploy.sh backup_db`)도 `.gpg` 가 됐다. 이 판정이 `.gpg` 면 아무거나 세던 때라
   *    **정기 크론이 죽어도 배포만 하면 READY** 가 됐을 것이다(감시자 `pipe.backup` 이 v4.14.0 에 겪은 그 모양).
   *    이름 패턴은 정본 `common/backup-files.ts` 하나 — 감시자와 같은 것을 본다.
   */
  it('🔴 배포 백업(pre-deploy_*.gpg)만 최근이면 NOT_READY — 정기 백업을 대신하지 않는다', async () => {
    const old = path.join(dir, 'hospitalrun_20260801_030001.sql.gz.gpg');
    fs.writeFileSync(old, 'x');
    const t = Date.now() - 5 * 24 * 3_600_000;
    fs.utimesSync(old, new Date(t), new Date(t));
    fs.writeFileSync(path.join(dir, 'pre-deploy_20260911_082624.sql.gz.gpg'), 'x'); // 방금 배포
    const r = await derive(svc());
    expect(r.status).toBe('NOT_READY');
    expect(r.detail, '방금 만든 배포 백업의 시각이 아니라 5일 전 정기 백업의 시각을 말해야 한다').toMatch(/5일 전/);
  });

  it('🔴 배포 백업만 있고 정기 백업이 없으면 "없다"로 말한다', async () => {
    fs.writeFileSync(path.join(dir, 'pre-deploy_20260911_082624.sql.gz.gpg'), 'x');
    const r = await derive(svc());
    expect(r.status).toBe('NOT_READY');
    expect(r.detail).toMatch(/정기 백업 파일이 없다/);
  });

  it('대조군 — 정기 백업과 배포 백업이 섞여 있어도 최근 정기 백업이면 READY·보관 건수는 정기만', async () => {
    fs.writeFileSync(path.join(dir, 'hospitalrun_20260911_030001.sql.gz.gpg'), 'x');
    fs.writeFileSync(path.join(dir, 'pre-deploy_20260911_082624.sql.gz.gpg'), 'x');
    fs.writeFileSync(path.join(dir, 'pre-deploy_20260910_082624.sql.gz'), 'x');
    const r = await derive(svc());
    expect(r.status).toBe('READY');
    expect(r.detail).toMatch(/보관 1건/);
  });
});
