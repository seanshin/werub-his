import { Module } from '@nestjs/common';
import { ConciergeController, ConciergePatientAuthController } from './concierge.controller';
import { ConciergeService } from './concierge.service';
import { MedicalAiModule } from '../medical-ai/medical-ai.module';

@Module({
  imports: [MedicalAiModule],
  controllers: [ConciergeController, ConciergePatientAuthController],
  providers: [ConciergeService],
  exports: [ConciergeService],
})
export class ConciergeModule {}
