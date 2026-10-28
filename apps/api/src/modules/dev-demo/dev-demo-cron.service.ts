import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DevDemoService } from './dev-demo.service';

/**
 * 데모 데이터 날짜 롤포워드 스케줄러 (개발용).
 * - 매일 자정(KST) 실행 — config dev.demoDateRoll=true 일 때만.
 * - 부팅 시에도 1회 실행(서버가 자정에 꺼져 있었거나 배포 직후 즉시 반영). 멱등.
 */
@Injectable()
export class DevDemoCronService implements OnModuleInit {
  private readonly logger = new Logger(DevDemoCronService.name);

  constructor(private readonly svc: DevDemoService) {}

  async onModuleInit() {
    // 부팅 직후 반영(비차단·실패 무시)
    void this.run('boot').catch((e) => this.logger.warn(`boot roll 실패: ${e instanceof Error ? e.message : String(e)}`));
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'dev-demo-roll', timeZone: 'Asia/Seoul' })
  async nightly() {
    await this.run('cron');
  }

  /** 매일 09시(KST) 진료실 대기 배치 — 과별 5~20명·신환/재환 혼합(요청 2026-08-04). 서비스가 09시 이전 호출을 무동작 처리한다 */
  @Cron('0 0 9 * * *', { name: 'dev-demo-clinic-queue-9am', timeZone: 'Asia/Seoul' })
  async morningClinicQueue() {
    if (!(await this.svc.isEnabled())) return;
    const r = await this.svc.refreshClinicQueue(false).catch((e) => {
      this.logger.warn(`아침 대기 배치 실패: ${e instanceof Error ? e.message : String(e)}`);
      return { created: 0, depts: 0 };
    });
    if (r.created > 0) this.logger.log(`진료실 대기 아침 배치 → ${r.created}건(${r.depts}과)`);
    // 회복실 데모(2026-10-07) — 아침에 오늘 재실·퇴실·입실 대기를 만든다(낮 시각 기준 상대 시각)
    const p = await this.svc.refreshPacu(false).catch((e) => {
      this.logger.warn(`회복실 데모 배치 실패: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
    if (p && (p.created > 0 || p.closed > 0)) this.logger.log(`회복실 데모 → 생성 ${p.created} · 정리 ${p.closed}`);
  }

  private async run(trigger: string) {
    if (!(await this.svc.isEnabled())) return;
    const r = await this.svc.refreshAll(false);
    const moved = r.dates.filter((t) => t.shifted > 0);
    const queues = r.queues.filter((q) => q.revived > 0 || q.created > 0);
    const parts: string[] = [];
    if (moved.length) parts.push(moved.map((t) => `${t.label} ${t.shifted}건(+${t.offsetDays}d)`).join(', '));
    if (queues.length) parts.push(`큐 ${queues.map((q) => `${q.department}(소생${q.revived}·신규${q.created})`).join('·')}`);
    if (r.diagnosticsDemo > 0) parts.push(`진단검사보드 ${r.diagnosticsDemo}건`);
    // (2026-10-01) 갈래 실패는 0 이 아니라 실패로 온다 — 로그에도 실패로 남긴다
    const failed = (
      [['진료실대기', r.clinicQueue], ['접수예약', r.receptionAppts], ['수술', r.surgeries], ['응급', r.emergency]] as const
    ).filter(([, v]) => typeof v === 'object' && v !== null && 'failed' in v).map(([k, v]) => `${k}(${(v as { error: string }).error})`);
    if (!('failed' in r.clinicQueue) && r.clinicQueue.created > 0) parts.push(`진료실대기 ${r.clinicQueue.created}건(${r.clinicQueue.depts}과)`);
    if (typeof r.receptionAppts === 'number' && r.receptionAppts > 0) parts.push(`접수예약 ${r.receptionAppts}건`);
    if (!('failed' in r.surgeries) && (r.surgeries.moved > 0 || r.surgeries.created > 0)) parts.push(`수술 이동${r.surgeries.moved}·생성${r.surgeries.created}`);
    if (!('failed' in r.emergency) && (r.emergency.closed > 0 || r.emergency.created > 0)) parts.push(`응급 마감${r.emergency.closed}·생성${r.emergency.created}`);
    if (parts.length) this.logger.log(`데모 리프레시[${trigger}] → ${r.today}: ${parts.join(' / ')}`);
    if (failed.length) this.logger.warn(`데모 리프레시[${trigger}] 실패 갈래: ${failed.join(' / ')}`);
  }
}
