import { Module } from '@nestjs/common';
import { DutyScheduleController } from './duty-schedule.controller';
import { DutyScheduleService } from './duty-schedule.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  imports: [ConfigRuntimeModule], // ⚠️ 비글로벌 — 누락 시 @Optional 주입이 조용히 undefined(게이트 무력화)
  controllers: [DutyScheduleController],
  providers: [DutyScheduleService],
  exports: [DutyScheduleService],
})
export class DutyScheduleModule {}
