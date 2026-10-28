import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { Prisma, BotTriggerType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class BotsService {
  /** 액션 엔진 배선 여부(정본) — 붙이는 날 wired:true 로 바꾸고 execute() 를 실제 실행으로 교체한다 */
  static readonly ACTION_ENGINE_STATUS = {
    wired: false,
    note: '액션 엔진이 배선되어 있지 않습니다. 트리거는 기록되지만 봇의 동작(알림·태스크 생성 등)은 수행되지 않습니다.',
  };

  private readonly logger = new Logger('BotsService');

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.bot.findMany({ orderBy: { name: 'asc' } });
  }

  async findById(id: string) {
    const bot = await this.prisma.bot.findUnique({ where: { id }, include: { executions: { orderBy: { createdAt: 'desc' }, take: 20 } } });
    if (!bot) throw new NotFoundException('Bot not found');
    return bot;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async create(data: { name: string; description?: string; triggerType: string; triggerConfig: Record<string, any>; action: Record<string, any>; createdBy: string }) {
    return this.prisma.bot.create({
      data: {
        name: data.name,
        description: data.description,
        triggerType: data.triggerType as BotTriggerType,
        triggerConfig: data.triggerConfig as unknown as Prisma.InputJsonValue,
        action: data.action as unknown as Prisma.InputJsonValue,
        createdBy: data.createdBy,
      },
    });
  }

  async toggle(id: string) {
    const bot = await this.prisma.bot.findUnique({ where: { id } });
    if (!bot) throw new NotFoundException('Bot not found');
    const newStatus = bot.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    return this.prisma.bot.update({ where: { id }, data: { status: newStatus } });
  }

  /**
   * Bot 실행 (트리거 발생 시 호출)
   *
   * 🔴 2026-08-14 W8(P16) — **액션 엔진이 없다.** 종전 구현은 `bot.action` 을 로그로 한 줄 찍고
   *    `BotExecution.success = true` 를 남겼다. 알림도, 태스크 생성도, 아무 일도 일어나지 않았는데
   *    실행 이력은 전건 성공이었고 화면의 '실행 횟수'는 계속 올라갔다 —
   *    **하지 않은 것을 했다고 기록한 것**이다. 액션 엔진을 급조하지 않는 대신,
   *    기록이 사실을 말하게 한다: 트리거는 발생했고(runCount·lastRunAt 은 참) **액션은 수행되지 않았다**.
   *    액션 엔진을 붙이는 날 이 분기를 실제 실행으로 교체한다.
   */
  async execute(botId: string, input?: { resourceType?: string; event?: string; resourceId?: string }) {
    const bot = await this.prisma.bot.findUnique({ where: { id: botId } });
    if (!bot || bot.status !== 'ACTIVE') return null;

    const startTime = Date.now();
    // 액션 엔진 미구현 — 성공으로 기록하지 않는다.
    const success = false;
    const error = 'ACTION_ENGINE_NOT_IMPLEMENTED';
    const output: Record<string, unknown> = {
      executed: false,
      reason: '액션 엔진이 배선되지 않아 트리거만 기록했습니다(수행된 동작 없음).',
      action: bot.action,
      triggeredAt: new Date().toISOString(),
      input,
    };
    this.logger.warn(`Bot "${bot.name}" 트리거됨 — 액션 엔진 미구현으로 수행되지 않음: ${JSON.stringify(bot.action)}`);

    const duration = Date.now() - startTime;

    await this.prisma.bot.update({ where: { id: botId }, data: { lastRunAt: new Date(), runCount: { increment: 1 } } });

    return this.prisma.botExecution.create({
      data: {
        botId,
        triggeredBy: input?.resourceId ?? 'manual',
        input: (input ?? null) as unknown as Prisma.InputJsonValue,
        output: output as unknown as Prisma.InputJsonValue,
        success,
        error,
        duration,
      },
    });
  }

  /**
   * 특정 리소스 변경에 반응하는 봇 찾기 + 실행
   */
  async triggerByResource(resourceType: string, event: string, resourceId: string) {
    const bots = await this.prisma.bot.findMany({
      where: { status: 'ACTIVE', triggerType: { in: ['RESOURCE_CREATED', 'RESOURCE_UPDATED', 'RESOURCE_DELETED'] } },
    });

    const matchingBots = bots.filter(bot => {
      const config = bot.triggerConfig as Record<string, unknown>;
      return config?.resourceType === resourceType && config?.event === event;
    });

    for (const bot of matchingBots) {
      await this.execute(bot.id, { resourceType, event, resourceId });
    }

    return { triggered: matchingBots.length };
  }
}
