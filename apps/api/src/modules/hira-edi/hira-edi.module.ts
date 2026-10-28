import { Module } from '@nestjs/common';
import { HiraEdiController } from './hira-edi.controller';
import { HiraEdiService } from './hira-edi.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  imports: [ConfigRuntimeModule], // 기관정보(hospital.code/name) — P2 하드코딩 제거
  controllers: [HiraEdiController],
  providers: [HiraEdiService],
})
export class HiraEdiModule {}
