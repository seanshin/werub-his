import { Module } from '@nestjs/common';
import { PediatricsController } from './pediatrics.controller';
import { PediatricsService } from './pediatrics.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  imports: [ConfigRuntimeModule], // 예방접종 게이트(immunization.enforce) — 비글로벌이라 명시 import 필수
  controllers: [PediatricsController],
  providers: [PediatricsService],
})
export class PediatricsModule {}
