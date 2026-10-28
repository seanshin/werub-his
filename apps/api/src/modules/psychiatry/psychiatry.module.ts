import { Module } from '@nestjs/common';
import { PsychiatryController } from './psychiatry.controller';
import { PsychiatryService } from './psychiatry.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

// ConfigRuntimeModule 비글로벌 — §75/ECT 게이트 config 조회에 필수(누락 시 게이트 기본값으로만 동작)
@Module({
  imports: [ConfigRuntimeModule],
  controllers: [PsychiatryController],
  providers: [PsychiatryService],
})
export class PsychiatryModule {}
