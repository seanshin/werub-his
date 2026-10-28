/**
 * 🔴 (2026-09-13) 부팅 시 trgm GIN 생성이 `.catch(() => {})` 로 실패를 삼키고 무조건 "ensured" 를 남겼다.
 * 지키는 것: ① 생성 실패 → 그 인덱스 FAILED·warn·"ensured" 없음 ② CONCURRENTLY 잔재(indisvalid=false) → INVALID
 *           ③ 확장 생성 실패 → 전부 FAILED ④ 대조군 — 전부 성공이면 ensured 1회·warn 0 ⑤ 부팅을 막지 않는다(throw 없음)
 */
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MedicalRecordSearchService } from '../../src/modules/medical-record-search/medical-record-search.service';

describe('trgm 인덱스 부팅 보장 — 실패를 ensured 로 말하지 않는다', () => {
  let prisma: { $executeRawUnsafe: ReturnType<typeof vi.fn>; $queryRawUnsafe: ReturnType<typeof vi.fn> };
  let svc: MedicalRecordSearchService;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    prisma = { $executeRawUnsafe: vi.fn().mockResolvedValue(0), $queryRawUnsafe: vi.fn().mockResolvedValue([{ valid: true }]) };
    svc = new MedicalRecordSearchService(prisma as never, {} as never);
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const ensuredLogged = () => logSpy.mock.calls.some((c) => String(c[0]).includes('ensured'));

  it('④ 대조군 — 전부 성공이면 ensured·warn 0', async () => {
    await svc.onModuleInit();
    expect(ensuredLogged()).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(4); // 확장 1 + 인덱스 3
  });

  it('① 인덱스 하나 생성 실패 → FAILED·warn(인덱스명·원인)·ensured 없음·부팅 계속', async () => {
    prisma.$executeRawUnsafe.mockImplementation(async (sql: string) => {
      if (sql.includes('idx_progress_notes_content_trgm')) throw new Error('lock timeout');
      return 0;
    });
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
    expect(ensuredLogged()).toBe(false);
    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toContain('idx_progress_notes_content_trgm FAILED: lock timeout');
    const r = await svc.ensureTrgmIndexes();
    expect(r.map((x) => x.status)).toEqual(['VALID', 'FAILED', 'VALID']);
  });

  it('② CONCURRENTLY 잔재(indisvalid=false) → INVALID 로 말한다', async () => {
    prisma.$queryRawUnsafe.mockImplementation(async (_sql: string, name: string) => (name === 'idx_encounters_soap_trgm' ? [{ valid: false }] : [{ valid: true }]));
    await svc.onModuleInit();
    expect(ensuredLogged()).toBe(false);
    expect(warnSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('idx_encounters_soap_trgm INVALID');
  });

  it('③ pg_trgm 확장 생성 실패 → 세 인덱스 모두 FAILED', async () => {
    prisma.$executeRawUnsafe.mockRejectedValueOnce(new Error('permission denied to create extension'));
    const r = await svc.ensureTrgmIndexes();
    expect(r.every((x) => x.status === 'FAILED' && x.reason?.includes('permission denied'))).toBe(true);
  });

  it('유효성 조회 실패는 VALID 가 아니라 UNKNOWN', async () => {
    prisma.$queryRawUnsafe.mockRejectedValue(new Error('conn reset'));
    const r = await svc.ensureTrgmIndexes();
    expect(r.every((x) => x.status === 'UNKNOWN')).toBe(true);
  });
});
