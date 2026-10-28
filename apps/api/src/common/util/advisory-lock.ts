import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * 채번/슬롯배정 원자화 헬퍼 — 트랜잭션 안에서 PostgreSQL advisory xact lock을 획득한 뒤 fn 실행.
 * check-then-act(count/max+1 → create, 충돌검사 → create) 경쟁상태 봉합의 정본 패턴.
 * lock은 트랜잭션 종료(commit/rollback) 시 자동 해제. 같은 key끼리만 직렬화(다른 key는 병행).
 *
 * 사용:
 *   const rec = await withAdvisoryLock(this.prisma, `specimen:${dateStr}`, async (tx) => {
 *     const n = await tx.pathologySpecimen.count({ where: {...} });
 *     return tx.pathologySpecimen.create({ data: { accessionNo: `SP-${dateStr}-${n+1}`, ... } });
 *   });
 */
export function withAdvisoryLock<T>(
  prisma: PrismaService,
  key: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    return fn(tx);
  });
}
