import { Module } from '@nestjs/common';
import { ChemoController } from './chemo.controller';
import { ChemoService } from './chemo.service';
import { CompoundingModule } from '../compounding/compounding.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { PreAuthGateService } from '../pre-auth/pre-auth-gate.service';

// PreAuthGateService(순수)는 provider 직접 등록 — 모듈 import 없이 순환 원천 차단(pre-auth 패턴).
@Module({
  imports: [CompoundingModule, ConfigRuntimeModule],
  controllers: [ChemoController],
  providers: [ChemoService, PreAuthGateService],
  exports: [ChemoService],
})
export class ChemoModule {}
