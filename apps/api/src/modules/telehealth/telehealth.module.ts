import { Module } from '@nestjs/common';
import { TelehealthController } from './telehealth.controller';
import { TelehealthRecordingsController } from './telehealth-recordings.controller';
import { TelehealthService } from './telehealth.service';
import { TierPriceService } from '../billing/tier-price.service';
import { TelehealthRecordingsService } from './telehealth-recordings.service';
import { MedicalAiModule } from '../medical-ai/medical-ai.module';
import { EligibilityModule } from '../eligibility/eligibility.module';

@Module({
  imports: [MedicalAiModule, EligibilityModule],
  controllers: [TelehealthController, TelehealthRecordingsController],
  providers: [TelehealthService, TelehealthRecordingsService, TierPriceService], // TierPriceService = Prisma 리프 — 모듈 import 없이 재등록
  exports: [TelehealthService],
})
export class TelehealthModule {}
