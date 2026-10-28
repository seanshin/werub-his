import { Module } from '@nestjs/common';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { AuditModule } from '../audit/audit.module';
import { VoiceEmrService } from './voice-emr.service';
import { VoiceEmrController } from './voice-emr.controller';
import { SttChunkClient } from './stt-chunk.client';
import { ScribeAiClient } from '../scribe/scribe-ai.client';
import { VitalsModule } from '../vitals/vitals.module';
import { HisModeModule } from '../../common/his-mode/his-mode.module';

/**
 * VoiceEMR — 음성 구동 EMR(실시간 STT·intent 파서·확인 게이트·개인화).
 * config voiceEmr.* 기본 OFF·pilotUserIds 게이트. STT=WeRU.B /api/stt/chunk(ai.server.* 재사용).
 */
@Module({
  imports: [ConfigRuntimeModule, AuditModule, VitalsModule, HisModeModule],
  controllers: [VoiceEmrController],
  providers: [VoiceEmrService, SttChunkClient, ScribeAiClient],
  exports: [VoiceEmrService],
})
export class VoiceEmrModule {}
