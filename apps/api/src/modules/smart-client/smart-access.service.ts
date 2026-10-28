import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * 외부 SMART 앱 접근 리포트 — Cerno 협의 '감사로그 연계' 항목.
 *
 * 두 축으로 답한다: **누가**(의료진·per-user launch) / **어떤 앱이**(클라이언트) 무엇을 얼마나 읽었는가.
 * 원문 기록은 SmartAccessLog(감사 인터셉터가 적재), 여기서는 집계·조회만 한다.
 */
@Injectable()
export class SmartAccessService {
  constructor(private readonly prisma: PrismaService) {}

  private window(from?: string, to?: string) {
    const at: Record<string, Date> = {};
    if (from) at.gte = new Date(from);
    if (to) at.lte = new Date(to);
    return Object.keys(at).length ? { at } : {};
  }

  /** 클라이언트별·사용자별 요약(기간 내) */
  async summary(from?: string, to?: string) {
    const where = this.window(from, to);

    const [byClient, byUser, byResource, total] = await Promise.all([
      this.prisma.smartAccessLog.groupBy({ by: ['clientId'], where, _count: { _all: true }, _max: { at: true } }),
      this.prisma.smartAccessLog.groupBy({ by: ['userId'], where, _count: { _all: true }, _max: { at: true } }),
      this.prisma.smartAccessLog.groupBy({ by: ['resourceType'], where, _count: { _all: true } }),
      this.prisma.smartAccessLog.count({ where }),
    ]);

    // 이름 해석은 배치 1쿼리씩(항목 수 무관 — N+1 금지)
    const clientIds = byClient.map((c) => c.clientId);
    const userIds = byUser.map((u) => u.userId).filter((v): v is string => !!v);
    const [clients, users] = await Promise.all([
      clientIds.length
        ? this.prisma.smartClient.findMany({ where: { clientId: { in: clientIds } }, select: { clientId: true, name: true, isActive: true } })
        : Promise.resolve([]),
      userIds.length
        ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, familyName: true, givenName: true, role: true, department: true } })
        : Promise.resolve([]),
    ]);
    const clientName = new Map(clients.map((c) => [c.clientId, c]));
    const userName = new Map(users.map((u) => [u.id, u]));

    // 앱별 접근 환자 수(distinct) — groupBy 로는 못 세므로 앱별 1쿼리(앱 수는 한 자릿수)
    const patientCounts = await Promise.all(
      clientIds.map(async (clientId) => ({
        clientId,
        patients: (
          await this.prisma.smartAccessLog.findMany({
            where: { ...where, clientId, patientId: { not: null } },
            distinct: ['patientId'],
            select: { patientId: true },
          })
        ).length,
      })),
    );
    const patientsByClient = new Map(patientCounts.map((p) => [p.clientId, p.patients]));

    return {
      total,
      clients: byClient
        .map((c) => ({
          clientId: c.clientId,
          name: clientName.get(c.clientId)?.name ?? '(삭제된 클라이언트)',
          isActive: clientName.get(c.clientId)?.isActive ?? false,
          requests: c._count._all,
          patients: patientsByClient.get(c.clientId) ?? 0,
          lastAt: c._max.at,
        }))
        .sort((a, b) => b.requests - a.requests),
      users: byUser
        .map((u) => ({
          userId: u.userId,
          name: u.userId ? (userName.has(u.userId) ? `${userName.get(u.userId)!.familyName}${userName.get(u.userId)!.givenName}` : '(퇴직·삭제)') : null,
          role: u.userId ? userName.get(u.userId)?.role ?? null : null,
          department: u.userId ? userName.get(u.userId)?.department ?? null : null,
          /** userId 없음 = 사용자 문맥 없는 시스템 단위 접근(system/* · client_credentials) */
          systemLevel: !u.userId,
          requests: u._count._all,
          lastAt: u._max.at,
        }))
        .sort((a, b) => b.requests - a.requests),
      resources: byResource
        .map((r) => ({ resourceType: r.resourceType, requests: r._count._all }))
        .sort((a, b) => b.requests - a.requests),
    };
  }

  /** 최근 접근 목록 — 클라이언트·사용자·환자로 좁힐 수 있다(커서 = 마지막 at) */
  async list(q: { clientId?: string; userId?: string; patientId?: string; from?: string; to?: string; before?: string; limit?: number }) {
    const take = Math.min(Math.max(q.limit ?? 50, 1), 200);
    const at = { ...this.window(q.from, q.to).at, ...(q.before ? { lt: new Date(q.before) } : {}) };
    const rows = await this.prisma.smartAccessLog.findMany({
      where: {
        ...(Object.keys(at).length ? { at } : {}),
        ...(q.clientId ? { clientId: q.clientId } : {}),
        ...(q.userId ? { userId: q.userId } : {}),
        ...(q.patientId ? { patientId: q.patientId } : {}),
      },
      orderBy: { at: 'desc' },
      take: take + 1,
      select: { id: true, at: true, clientId: true, userId: true, patientId: true, resourceType: true, action: true, path: true, ipAddress: true },
    });
    const page = rows.slice(0, take);
    const userIds = [...new Set(page.map((r) => r.userId).filter((v): v is string => !!v))];
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, familyName: true, givenName: true } })
      : [];
    const name = new Map(users.map((u) => [u.id, `${u.familyName}${u.givenName}`]));
    return {
      items: page.map((r) => ({ ...r, userName: r.userId ? name.get(r.userId) ?? '(퇴직·삭제)' : null })),
      hasMore: rows.length > take,
      nextCursor: rows.length > take ? page[page.length - 1].at.toISOString() : null,
    };
  }
}
