import { Module } from '@nestjs/common';
import { AgentSessionController, BookingController } from './agent-session.controller';
import { AgentSessionService } from './agent-session.service';
import { MedicalAiModule } from '../medical-ai/medical-ai.module';
import { TriageModule } from '../triage/triage.module';
import { HolidayModule } from '../holiday/holiday.module';
import { QuestionnaireModule } from '../questionnaire/questionnaire.module';

@Module({
  imports: [MedicalAiModule, TriageModule, HolidayModule, QuestionnaireModule],
  controllers: [AgentSessionController, BookingController],
  providers: [AgentSessionService],
  exports: [AgentSessionService],
})
export class AgentSessionModule {}
