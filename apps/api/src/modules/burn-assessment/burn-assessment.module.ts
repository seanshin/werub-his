import { Module } from '@nestjs/common';
import { BurnAssessmentController } from './burn-assessment.controller';
import { BurnAssessmentService } from './burn-assessment.service';

@Module({
  controllers: [BurnAssessmentController],
  providers: [BurnAssessmentService],
})
export class BurnAssessmentModule {}
