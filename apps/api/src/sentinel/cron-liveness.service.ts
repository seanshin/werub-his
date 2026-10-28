import { Injectable, Logger } from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { HospitalInfoService } from '../modules/hospital-info/hospital-info.service';

export interface CronLiveness {
  name: string;
  /** cron 표현식 */
  schedule: string | null;
  /** 스케줄러가 이 잡을 돌리고 있는가(중지된 잡은 영영 안 뜬다) */
  active: boolean;
  /**
   * 🔴 **이 프로세스가 기동한 뒤** 실행된 시각이다. 재시작하면 null 로 돌아간다.
   *    배포가 잦은 서버라 `null` 이 곧 "죽은 크론"이 아니다 — 화면은 그 한계를 함께 말해야 한다.
   */
  lastRunAt: string | null;
  nextRunAt: string | null;
}

/**
 * NestJS 크론 생존 — **등록되어 있는가 · 돌고 있는가 · 다음이 언제인가**.
 *
 * 🔴 왜 이것이 필요한가: 이 저장소에서 크론이 조용히 사라지는 사고가 반복됐다.
 *    모듈 등록 누락으로 주입이 undefined 였던 적이 있고(그때도 화면은 "위반 0건"이었다),
 *    실행 비트 하나가 정기 백업을 89일 막았다(그쪽은 OS 크론이라 파일 신선도로 본다).
 *
 * 🔴 **한계를 숨기지 않는다.** `lastRunAt` 은 프로세스 기동 이후만 반영한다.
 *    그래서 이 EP 는 `processStartedAt` 을 함께 내고, 화면은 "그 이후 실행 없음"이라고 쓴다
 *    ("실행된 적 없음"이라 쓰면 거짓이다).
 */
@Injectable()
export class CronLivenessService {
  private readonly logger = new Logger(CronLivenessService.name);
  private readonly startedAt = new Date();

  constructor(
    private readonly scheduler: SchedulerRegistry,
    private readonly prisma: PrismaService,
    private readonly hospitalInfo: HospitalInfoService,
  ) {}

  list(): { processStartedAt: string; jobs: CronLiveness[]; error: string | null } {
    try {
      const jobs: CronLiveness[] = [];
      for (const [name, job] of this.scheduler.getCronJobs()) {
        const j = job as unknown as {
          lastDate?: () => Date | null;
          nextDate?: () => { toJSDate?: () => Date } | Date | null;
          cronTime?: { source?: unknown };
          running?: boolean;
          isActive?: boolean;
        };
        let next: Date | null = null;
        try {
          const n = j.nextDate?.();
          // cron v3 는 Luxon DateTime 을 준다 — toJSDate 가 있으면 그걸 쓴다
          next = n && typeof (n as { toJSDate?: () => Date }).toJSDate === 'function'
            ? (n as { toJSDate: () => Date }).toJSDate()
            : (n as Date | null);
        } catch { next = null; }

        let last: Date | null = null;
        try { last = j.lastDate?.() ?? null; } catch { last = null; }

        jobs.push({
          name,
          schedule: j.cronTime?.source != null ? String(j.cronTime.source) : null,
          active: Boolean(j.running ?? j.isActive ?? false),
          lastRunAt: last ? last.toISOString() : null,
          nextRunAt: next ? next.toISOString() : null,
        });
      }
      return { processStartedAt: this.startedAt.toISOString(), jobs, error: null };
    } catch (e) {
      // 🔴 실패를 "크론 0개"로 번역하지 않는다 — 사유를 그대로 넘긴다
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`크론 목록 조회 실패: ${msg}`);
      return { processStartedAt: this.startedAt.toISOString(), jobs: [], error: msg };
    }
  }

  /**
   * 프로브 적재 — 10분마다 **API 만 아는 것**을 원장에 적는다. 판단은 감시자가 한다.
   *
   * 🔴 감시자에게 관리자 토큰을 쥐여 주지 않으려고 이 방향을 택했다(자격 관리 문제를 만들지 않는다).
   * 🔴 이 행이 낡으면 **API 가 멈춘 것**이다 — 그래서 API 생존이 덤으로 관측된다.
   *    그러니 이 크론이 실패해도 조용히 넘기지 않고 사유까지 payload 에 적는다.
   */
  @Cron('*/10 * * * *', { name: 'sentinel.probeCapture' })
  async captureProbes() {
    const now = new Date();
    const write = async (key: string, payload: unknown) => {
      await this.prisma.sentinelProbe.upsert({
        where: { key },
        create: { key, payload: payload as never, capturedAt: now },
        update: { payload: payload as never, capturedAt: now },
      }).catch((e) => this.logger.warn(`프로브 적재 실패 ${key}: ${(e as Error).message}`));
    };

    await write('cron', this.list());

    // 🔴 공개 사이트 확인은 외부 요청이라 실패할 수 있다. 실패를 '최신'으로 접지 않고
    //    정본이 주는 { checked:false } 를 그대로 적는다(감시자가 관측 불가로 읽는다).
    try {
      await write('publicSite', await this.hospitalInfo.homepageLiveFreshness());
    } catch (e) {
      await write('publicSite', {
        checked: false, fresh: null,
        detail: `공개 사이트 확인 자체가 실패했습니다: ${e instanceof Error ? e.message : e}`,
      });
    }
  }
}
