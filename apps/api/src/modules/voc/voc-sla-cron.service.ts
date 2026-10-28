import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { NotificationService } from '../notification/notification.service';

/**
 * D5: VoC/상담 SLA 자동 구동 크론 — consult 에 @Cron 이 전무해 SLA 필드가 수동으로만 채워지던 공백 봉합.
 * 1) 비동기 VocTicket dueAt 초과·미답변 → severity 승격 + 담당/미배정 알림
 * 2) 실시간 ConsultSession 장기 대기(마지막 환자 메시지 경과) → priority/escalationLevel 상향 + 팀 알림
 * 3) ANSWERED 후 무응답 자동 종결(voc.autoCloseDays)
 */
@Injectable()
export class VocSlaCronService {
  private readonly logger = new Logger(VocSlaCronService.name);
  // 실시간 상담 대기 임계(초) — 첫 응답 없이 이 시간 초과 시 승격
  private readonly CONSULT_WAIT_L1 = 300; // 5분
  private readonly CONSULT_WAIT_L2 = 900; // 15분

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigRuntimeService,
    @Optional() private readonly notify?: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run() {
    try {
      await this.sweepVocOverdue();
      await this.sweepConsultWaiting();
      await this.autoCloseAnswered();
    } catch (e) {
      this.logger.warn(`VoC SLA 크론 오류: ${(e as Error).message}`);
    }
  }

  /** 1) VocTicket 마감 초과·미답변 → severity 승격 + 알림(중복 방지: 이미 HIGH/URGENT면 skip) */
  private async sweepVocOverdue() {
    const now = new Date();
    const overdue = await this.prisma.vocTicket.findMany({
      where: {
        status: { notIn: ['CLOSED'] },
        firstResponseAt: null,
        dueAt: { lt: now },
        severity: { in: ['LOW', 'NORMAL'] },
      },
      select: { id: true, ticketNo: true, assigneeId: true, type: true },
      take: 100,
    });
    for (const t of overdue) {
      await this.prisma.vocTicket.update({ where: { id: t.id }, data: { severity: 'HIGH' } });
      const target = t.assigneeId;
      if (target) {
        this.notify?.notify(target, {
          type: 'VOC_SLA_OVERDUE', title: 'VoC SLA 초과',
          message: `${t.ticketNo} — 답변 기한을 초과했습니다.`, severity: 'WARNING',
          refType: 'VocTicket', refId: t.id,
        });
      }
    }
    if (overdue.length) this.logger.log(`VoC SLA 초과 승격 ${overdue.length}건`);
  }

  /** 2) 상담 세션 장기 대기 → priority/escalationLevel 상향(마지막 메시지가 환자이고 미배정/미응답) */
  private async sweepConsultWaiting() {
    const now = Date.now();
    const sessions = await this.prisma.consultSession.findMany({
      where: { status: { in: ['OPEN', 'WAITING'] }, firstResponseAt: null },
      select: {
        id: true, teamId: true, priority: true, escalationLevel: true, createdAt: true,
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { sender: true, createdAt: true } },
      },
      take: 100,
    });
    for (const s of sessions) {
      const last = s.messages[0];
      // 마지막이 환자 메시지일 때만 '직원 응답 대기' — 직원/AI가 마지막이거나 메시지가 없으면 대기 아님(오에스컬레이션 방지)
      if (!last || last.sender !== 'PATIENT') continue;
      const waitSec = Math.round((now - new Date(last.createdAt).getTime()) / 1000);
      let level = 0;
      if (waitSec >= this.CONSULT_WAIT_L2) level = 2;
      else if (waitSec >= this.CONSULT_WAIT_L1) level = 1;
      if (level > (s.escalationLevel ?? 0)) {
        await this.prisma.consultSession.update({
          where: { id: s.id },
          data: { escalationLevel: level, escalatedAt: new Date(), priority: level >= 2 ? 'URGENT' : 'HIGH' },
        });
        // 팀 ONLINE 상담원·LEAD에 알림
        const agents = await this.prisma.consultAgent.findMany({
          where: { status: 'ONLINE', ...(s.teamId ? { teamId: s.teamId } : {}) },
          select: { userId: true },
        });
        for (const a of agents) {
          this.notify?.notify(a.userId, {
            type: 'CONSULT_SLA', title: '상담 대기 지연',
            message: `대기 ${Math.floor(waitSec / 60)}분 경과 — 응대가 필요합니다.`, severity: level >= 2 ? 'ERROR' : 'WARNING',
            refType: 'ConsultSession', refId: s.id,
          });
        }
      }
    }
  }

  /** 3) ANSWERED 후 환자 무응답 → 자동 종결 */
  private async autoCloseAnswered() {
    // 🔴 (2026-10-01 .catch 비리터럴 판정) 종전 `.catch(() => 7)` — 조회가 실패하면 **기본 7일로 종결**했다. 원내가 30일로 정해 두었어도
    //    설정 서비스가 잠깐 죽으면 답변 7일 넘은 문의가 닫힌다(상태를 바꾸는 쪽 폴백). 실패는 전파 → run() 이 로그로 남기고 이번 회차는 닫지 않는다.
    const days = Number((await this.config.get('voc.autoCloseDays')) ?? 7);
    const cutoff = new Date(Date.now() - days * 86400_000);
    const r = await this.prisma.vocTicket.updateMany({
      where: { status: 'ANSWERED', updatedAt: { lt: cutoff } },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    if (r.count) this.logger.log(`VoC 자동 종결 ${r.count}건(무응답 ${days}일)`);
  }
}
