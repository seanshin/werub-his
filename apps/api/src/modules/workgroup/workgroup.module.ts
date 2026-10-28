import { Module } from '@nestjs/common';
import { WorkgroupController } from './workgroup.controller';
import { WorkgroupService } from './workgroup.service';
import { DutyScheduleModule } from '../duty-schedule/duty-schedule.module';

@Module({
  imports: [DutyScheduleModule], // 당직 정본(DutyEntry) 위임 — 모델 이원화 통합(2026-07-22)
  controllers: [WorkgroupController],
  providers: [WorkgroupService],
  exports: [WorkgroupService],
})
export class WorkgroupModule {}
