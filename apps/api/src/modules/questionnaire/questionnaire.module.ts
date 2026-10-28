import { Module } from '@nestjs/common';
import { QuestionnaireController, QuestionnairePublicController } from './questionnaire.controller';
import { QuestionnaireAdminController } from './questionnaire-admin.controller';
import { QuestionnaireService } from './questionnaire.service';
import { QuestionnaireAdminService } from './questionnaire-admin.service';
// 발송 판정 정본(SENT/SIMULATED/FAILED) — W6 CRM 과 같은 채널·같은 판정
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [CrmModule],
  controllers: [QuestionnaireController, QuestionnairePublicController, QuestionnaireAdminController],
  providers: [QuestionnaireService, QuestionnaireAdminService],
  exports: [QuestionnaireService, QuestionnaireAdminService],
})
export class QuestionnaireModule {}
