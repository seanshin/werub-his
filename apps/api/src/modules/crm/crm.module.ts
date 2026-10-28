import { Module } from '@nestjs/common';
import { HisModeModule } from '../../common/his-mode/his-mode.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { CrmCronService } from './crm-cron.service';
import { CrmChannelService } from './crm-channel.service';
import { CrmAiService } from './crm-ai.service';

@Module({
  // ScheduleModule — 예약 대행이 예약 정본(휴진·세션·충돌 검증·여정)을 지나가게(2026-09-14)
  imports: [HisModeModule, ScheduleModule],
  controllers: [CrmController],
  providers: [CrmService, CrmCronService, CrmChannelService, CrmAiService],
  exports: [CrmService, CrmChannelService],
})
export class CrmModule {}
