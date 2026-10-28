import { Module } from '@nestjs/common';
import { PlasticController } from './plastic.controller';
import { PlasticService } from './plastic.service';

@Module({
  controllers: [PlasticController],
  providers: [PlasticService],
})
export class PlasticModule {}
