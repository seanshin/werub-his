import { Module } from '@nestjs/common';
import { ImagingController } from './imaging.controller';
import { ImagingService } from './imaging.service';
import { ImagingSafetyService } from './imaging-safety.service';
import { MedicalAiModule } from '../medical-ai/medical-ai.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

// ConfigRuntimeModule은 비글로벌 — 안전게이트(imaging.contrastEnforce 등) config 조회에 필수(누락 시 게이트 조용히 OFF)
@Module({
  imports: [MedicalAiModule, ConfigRuntimeModule],
  controllers: [ImagingController],
  providers: [ImagingService, ImagingSafetyService],
  exports: [ImagingSafetyService],
})
export class ImagingModule {}
