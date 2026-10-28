import { Module } from '@nestjs/common';
import { DataQualityController } from './data-quality.controller';
import { DataQualityService } from './data-quality.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  imports: [ConfigRuntimeModule], // 비글로벌(기존 함정) — 명시 import
  controllers: [DataQualityController],
  providers: [DataQualityService],
  exports: [DataQualityService],
})
export class DataQualityModule {}
