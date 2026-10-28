import { Module } from '@nestjs/common';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { AuditModule } from '../audit/audit.module';
import { MedicalAiModule } from '../medical-ai/medical-ai.module';
import { ScribeService } from './scribe.service';
import { ScribeAiClient } from './scribe-ai.client';
import { SpeakerResolver } from './speaker-resolver';
import { ScribeSessionController, ScribeVoiceProfileController } from './scribe.controller';
import { ScribeAudioFileController } from './scribe-audio-file.controller';
import { AmbientScribeService } from './ambient.service';
import { AmbientScribeController } from './ambient.controller';

/**
 * 앰비언트 진료 스크라이브 — 세션·오디오 PHI 저장(HMAC)·음성 프로파일·전사(P1)·SOAP 초안.
 * config `scribe.enabled` 기본 OFF. 전사=ScribeAiClient(격리), 초안=MedicalAiService(autoRecord 재사용).
 */
@Module({
  imports: [ConfigRuntimeModule, AuditModule, MedicalAiModule],
  controllers: [ScribeSessionController, ScribeVoiceProfileController, ScribeAudioFileController, AmbientScribeController],
  providers: [ScribeService, ScribeAiClient, SpeakerResolver, AmbientScribeService],
  exports: [ScribeService],
})
export class ScribeModule {}
