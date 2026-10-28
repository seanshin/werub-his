import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

// 미퇴근 자동마감 Cron (terminal-zero-trust 설계 §5.3.2 / FR-T9b)
// 출근(CLOCK_IN)만 있고 퇴근(CLOCK_OUT)이 없는 전일 근무를 새벽에 추정 퇴근(provisional)으로 마감.
// ⚠️ 추정 퇴근은 급여 확정 입력이 아님 — provisional=true, 본인/부서장 ESS 근태정정 후 확정(근로기준법).

@Injectable()
export class TerminalCronService {
  private readonly logger = new Logger(TerminalCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async closeUnclosedShifts() {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    // 전일 CLOCK_IN 들 — 대응 CLOCK_OUT 없으면 추정 마감
    const clockIns = await this.prisma.attendanceRecord.findMany({
      where: { type: 'CLOCK_IN', at: { gte: yesterdayStart, lt: todayStart } },
      select: { id: true, userId: true, at: true },
    });

    let closed = 0;
    for (const ci of clockIns) {
      const out = await this.prisma.attendanceRecord.findFirst({
        where: { userId: ci.userId, type: 'CLOCK_OUT', at: { gt: ci.at } },
        select: { id: true },
      });
      if (out) continue; // 정상 퇴근

      // 추정 퇴근(provisional) — 보수적으로 CLOCK_IN 시각 기준(0분, 정정 대기)
      await this.prisma.attendanceRecord.create({
        data: {
          userId: ci.userId,
          type: 'CLOCK_OUT',
          method: 'AUTO',
          provisional: true,
          autoClosedAt: now,
          at: ci.at,
          correctionOf: ci.id,
        },
      });
      // 관찰성 감사 — 한 건 실패가 배치 루프를 중단시키지 않도록 safeLog(throw 안 함)
      await this.audit.safeLog({
        userId: ci.userId,
        action: AuditAction.CREATE,
        resourceType: 'TERMINAL_AUTO_CLOCKOUT',
        resourceId: ci.userId,
        changes: { provisionalClockOut: { old: null, new: ci.id } },
      });
      closed++;
    }

    if (closed > 0) {
      this.logger.warn(`미퇴근 자동마감(추정 퇴근): ${closed}건 — ESS 근태정정 필요`);
    }
    return { scanned: clockIns.length, closed };
  }
}
