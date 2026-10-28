import { Module } from '@nestjs/common';
import { SatisfactionController } from './satisfaction.controller';
import { SurveyPublicController } from './survey-public.controller';
import { SatisfactionService } from './satisfaction.service';
import { MedicalAiModule } from '../medical-ai/medical-ai.module';

@Module({
  imports: [MedicalAiModule],
  controllers: [SatisfactionController, SurveyPublicController],
  providers: [SatisfactionService],
  exports: [SatisfactionService],
})
export class SatisfactionModule {}
