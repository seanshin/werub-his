import { Module } from '@nestjs/common';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { FinanceBenchmarkController } from './finance-benchmark.controller';
import { FinanceBenchmarkService } from './finance-benchmark.service';

/** 경영성과 벤치마크 — 의료기관 회계정보공시 손익 가져오기·동급 비교 */
@Module({
  imports: [ConfigRuntimeModule],
  controllers: [FinanceBenchmarkController],
  providers: [FinanceBenchmarkService],
})
export class FinanceBenchmarkModule {}
