import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RetentionService } from './retention.service';

// 데이터 보유/파기 DRY-RUN 리포트 Cron (security-governance G1)
// 매일 후보 집계만 — 실제 파기는 3중 게이트(retention.service.purge) 통과 시 수동/별도.
@Injectable()
export class RetentionCronService {
  private readonly logger = new Logger(RetentionCronService.name);

  constructor(private readonly retention: RetentionService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async dailyReport() {
    const r = await this.retention.report();
    // 미지원(candidates=null)은 합산하지 않는다 — 세지 않은 것을 0 으로 더하지 않는다
    const counted = r.policies.filter((p) => p.candidates != null);
    const total = counted.reduce((s, p) => s + (p.candidates ?? 0), 0);
    if (total > 0) {
      this.logger.log(`보유/파기 DRY-RUN: 후보 ${total}건 — ${counted.filter((p) => (p.candidates ?? 0) > 0).map((p) => `${p.resourceType}:${p.candidates}`).join(', ')}`);
    }
  }
}
