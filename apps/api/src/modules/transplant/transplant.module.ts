import { Module } from '@nestjs/common';
import { TransplantController } from './transplant.controller';
import { TransplantService } from './transplant.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  imports: [ConfigRuntimeModule], // 이식 적합성 게이트 transplant.compatEnforce
  controllers: [TransplantController],
  providers: [TransplantService],
  exports: [TransplantService],
})
export class TransplantModule {}
