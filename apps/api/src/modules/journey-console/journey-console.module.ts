import { Module } from '@nestjs/common';
import { JourneyConsoleController } from './journey-console.controller';
import { JourneyConsoleService } from './journey-console.service';
import { JourneyAnalyticsService } from './journey-analytics.service';
import { JourneyAckService } from './journey-ack.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  imports: [ConfigRuntimeModule], // qi.targets.* 목표값 소비(§7 P1)
  controllers: [JourneyConsoleController],
  providers: [JourneyConsoleService, JourneyAnalyticsService, JourneyAckService],
  exports: [JourneyAckService],
})
export class JourneyConsoleModule {}
