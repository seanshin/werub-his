import { Module } from '@nestjs/common';
import { OperationalStatsController } from './operational-stats.controller';
import { OperationalStatsService } from './operational-stats.service';

@Module({
  controllers: [OperationalStatsController],
  providers: [OperationalStatsService],
  exports: [OperationalStatsService],
})
export class OperationalStatsModule {}
