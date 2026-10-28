import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

const STATUSES = ['ONLINE', 'AWAY', 'BUSY', 'OFFLINE'];

@Injectable()
export class ConsultAgentService {
  constructor(private readonly prisma: PrismaService) {}

  /** 활성 세션 수(담당·ACTIVE) */
  async activeCount(userId: string): Promise<number> {
    return this.prisma.consultSession.count({ where: { assigneeId: userId, status: 'ACTIVE' } });
  }

  /** 내 상담 프로필 + 소속팀 + 부하 */
  async getMe(userId: string, systemAdmin = false) {
    const agent = await this.prisma.consultAgent.findUnique({ where: { userId }, include: { team: true } });
    if (!agent) {
      // 시스템 ADMIN 부트스트랩: 미등록이어도 ADMIN 권한으로 콘솔 접근
      return { enrolled: false, role: systemAdmin ? 'ADMIN' : null, status: 'OFFLINE', team: null, maxConcurrent: 0, activeCount: 0 };
    }
    const activeCount = await this.activeCount(userId);
    return {
      enrolled: true,
      role: agent.role,
      status: agent.status,
      maxConcurrent: agent.maxConcurrent,
      activeCount,
      team: agent.team ? { id: agent.team.id, name: agent.team.name } : null,
    };
  }

  /** 내 상태 변경(ONLINE/AWAY/BUSY/OFFLINE). OFFLINE 전환 시 담당 ACTIVE 세션을 팀 큐로 반환(R8). */
  async setStatus(userId: string, status: string) {
    if (!STATUSES.includes(status)) throw new BadRequestException('잘못된 상태값');
    await this.prisma.consultAgent.update({ where: { userId }, data: { status } });
    let released = 0;
    if (status === 'OFFLINE') {
      const r = await this.prisma.consultSession.updateMany({
        where: { assigneeId: userId, status: 'ACTIVE' },
        data: { assigneeId: null, status: 'OPEN' },
      });
      released = r.count;
    }
    return { ok: true, status, released };
  }

  /** maxConcurrent 검증 — 초과 시 예외 */
  async assertCapacity(userId: string) {
    const agent = await this.prisma.consultAgent.findUnique({ where: { userId } });
    if (!agent) return; // 시스템 ADMIN 부트스트랩 등 미등록은 검증 생략
    const active = await this.activeCount(userId);
    if (active >= agent.maxConcurrent) {
      throw new BadRequestException({ code: 'CONSULT_AGENT_FULL', message: `동시 상담 상한(${agent.maxConcurrent}) 도달` });
    }
  }
}
