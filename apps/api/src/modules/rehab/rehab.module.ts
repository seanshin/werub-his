import { Module } from '@nestjs/common';
import { RehabController } from './rehab.controller';
import { RehabService } from './rehab.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

// ConfigRuntimeModule 비글로벌 — rehab.sessionGate 조회에 필수(누락 시 게이트 조용히 OFF)
@Module({
  imports: [ConfigRuntimeModule],
  controllers: [RehabController],
  providers: [RehabService],
})
export class RehabModule {}
