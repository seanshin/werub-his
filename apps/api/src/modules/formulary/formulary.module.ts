import { Module } from '@nestjs/common';
import { FormularyController } from './formulary.controller';
import { FormularyService } from './formulary.service';
import { FormularyGateService } from './formulary-gate.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

// FormularyGateService = 처방 발행 경로가 주입하는 순수 게이트(Prisma·ConfigRuntime만 의존).
// 발행 경로(PrescriptionModule)는 이 모듈을 import 하지 않고 provider 로 직접 등록해 순환을 원천 차단한다
// (PreAuthGateService 와 동일 패턴).
@Module({
  imports: [ConfigRuntimeModule],
  controllers: [FormularyController],
  providers: [FormularyService, FormularyGateService],
  exports: [FormularyService, FormularyGateService],
})
export class FormularyModule {}
