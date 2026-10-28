import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CommandCenterService, SECTION_ROLES } from './command-center.service';
import {
  TREND_BUCKET_MINUTES, TREND_MAX_HOURS, TREND_RETENTION_DAYS, bucketOf, metricsForRole, snapshotOf,
} from './command-center-trend';

/**
 * 통합 상황판 지표 이력 — 기록(5분)·조회(2026-10-02 · 상황판 디자인 F 추세선).
 *
 * 🔴 추세선을 그리려면 과거 값이 있어야 한다. 종전 상황판 서버는 **현재 값만** 줬고, 상시 감시자의 1분 펄스는
 *    지표 10개·관리자 전용이라 상황판 지표가 아니다. 이력 없이 그리면 그래프를 지어낸다 → 서버가 남긴다.
 *  - 기록: 5분마다 상황판과 **같은 집계**(getSummary · 역할 필터 없음 = 전 섹션)를 한 행으로. 칸(bucketAt) 유일 —
 *    같은 칸을 두 번 쓰지 않는다(재시작·중복 실행 무관). 실패 섹션의 지표는 null.
 *  - 보존: 30일 — 같은 크론이 정시 칸에서 지난 행을 지운다(파생 지표 · 원장 아님).
 *  - 조회: 역할이 볼 수 있는 섹션의 지표만(요약 EP 와 같은 필터) · 기록 시작 시각을 함께 준다(그 이전은 "없음"이 아니라 "기록 전").
 */
@Injectable()
export class CommandCenterTrendService {
  private readonly logger = new Logger(CommandCenterTrendService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly summary: CommandCenterService,
  ) {}

  // NestJS 크론은 프로세스 TZ(Asia/Seoul) — 5분 간격이라 시간대와 무관하다
  @Cron(`*/${TREND_BUCKET_MINUTES} * * * *`, { name: 'command-center-kpi-snapshot' })
  async record(now: Date = new Date()): Promise<{ recorded: boolean; bucketAt: string; purged: number }> {
    const bucketAt = bucketOf(now);
    let recorded = false;
    let purged = 0;
    try {
      const s = await this.summary.getSummary();
      const { values, failedSections } = snapshotOf(s);
      const r = await this.prisma.commandCenterKpiSnapshot.createMany({
        data: [{ bucketAt, takenAt: now, values, failedSections }],
        skipDuplicates: true, // 같은 칸은 한 행 — 이미 있으면 쓰지 않는다
      });
      recorded = r.count > 0;
      if (failedSections.length) this.logger.warn(`상황판 지표 이력 — 섹션 조회 실패 ${failedSections.join(', ')} → 해당 지표 null 로 기록`);
    } catch (e) {
      // 🔴 기록 실패를 조용히 넘기지 않는다 — 그 칸은 추세선에서 끊긴 칸으로 보인다(지어내지 않는다)
      this.logger.error(`상황판 지표 이력 기록 실패(${bucketAt.toISOString()}): ${e instanceof Error ? e.message : String(e)}`);
    }
    if (bucketAt.getUTCMinutes() === 0) purged = await this.purgeExpired(now);
    return { recorded, bucketAt: bucketAt.toISOString(), purged };
  }

  /** 보존 기간 지난 행 정리 — 기록과 별개 쓰기(한 트랜잭션으로 묶을 사실이 아니다: 기록 성공과 정리 성공은 서로 무관) */
  private async purgeExpired(now: Date): Promise<number> {
    try {
      const cutoff = new Date(now.getTime() - TREND_RETENTION_DAYS * 86_400_000);
      return (await this.prisma.commandCenterKpiSnapshot.deleteMany({ where: { bucketAt: { lt: cutoff } } })).count;
    } catch (e) {
      this.logger.error(`상황판 지표 이력 보존 정리 실패: ${e instanceof Error ? e.message : String(e)}`);
      return 0;
    }
  }

  async trend(role: string | undefined, hoursRaw?: string) {
    const hours = hoursRaw == null || hoursRaw === '' ? 24 : Number(hoursRaw);
    if (!Number.isInteger(hours) || hours < 1 || hours > TREND_MAX_HOURS) {
      throw new BadRequestException('hours 는 1~168 사이의 정수여야 합니다'); // TREND_MAX_HOURS — 문장을 조립하지 않는다
    }
    const to = new Date();
    const from = new Date(to.getTime() - hours * 3_600_000);
    const metrics = metricsForRole(role, SECTION_ROLES);
    const [rows, first] = await Promise.all([
      this.prisma.commandCenterKpiSnapshot.findMany({
        where: { bucketAt: { gte: from, lte: to } },
        orderBy: { bucketAt: 'asc' },
        select: { bucketAt: true, values: true, failedSections: true },
      }),
      this.prisma.commandCenterKpiSnapshot.findFirst({ orderBy: { bucketAt: 'asc' }, select: { bucketAt: true } }),
    ]);
    const keys = new Set(metrics.map((m) => m.key));
    return {
      bucketMinutes: TREND_BUCKET_MINUTES,
      from: from.toISOString(),
      to: to.toISOString(),
      /** 처음 기록된 칸 — 이 이전은 "값 없음"이 아니라 "기록 전" · null = 아직 한 번도 기록되지 않음 */
      recordingSince: first?.bucketAt.toISOString() ?? null,
      metrics: metrics.map((m) => m.key),
      points: rows.map((r) => {
        const v = (r.values ?? {}) as Record<string, unknown>;
        const values: Record<string, number | null> = {};
        for (const k of keys) values[k] = typeof v[k] === 'number' ? (v[k] as number) : null;
        return { at: r.bucketAt.toISOString(), values };
      }),
    };
  }
}
