import { Module } from '@nestjs/common';
import { TriageController } from './triage.controller';
import { TriageService } from './triage.service';
import { MedicalAiModule } from '../medical-ai/medical-ai.module';

@Module({
  imports: [MedicalAiModule,
],
  controllers: [TriageController],
  providers: [TriageService],
  exports: [TriageService],
})
export class TriageModule {}
