import { Module } from '@nestjs/common';
import { OrthopedicsController } from './orthopedics.controller';
import { OrthopedicsService } from './orthopedics.service';

@Module({
  controllers: [OrthopedicsController],
  providers: [OrthopedicsService],
})
export class OrthopedicsModule {}
