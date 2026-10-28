import { Module } from '@nestjs/common';
import { CheckupController } from './checkup.controller';
import { CheckupProtocolController } from './checkup-protocol.controller';
import { CheckupDisplayController } from './checkup-display.controller';
import { CheckupService } from './checkup.service';
import { CheckupProtocolService } from './checkup-protocol.service';
import { CheckupProgramService } from './checkup-program.service';
import { CheckupContractService } from './checkup-contract.service';
import { CheckupQuestionnaireService } from './checkup-questionnaire.service';
import { CheckupStationService } from './checkup-station.service';
import { CheckupTestMasterService } from './checkup-test-master.service';
import { PrismaClinicAdapter } from './adapters/prisma-clinic.adapter';
import { PdfGenerationService } from '../medical-record-copy/pdf-generation.service';
import { MedicalAiModule } from '../medical-ai/medical-ai.module';
import { DocumentModule } from '../document/document.module';
import { SpaceModelModule } from '../space-model/space-model.module';

@Module({
  imports: [MedicalAiModule, DocumentModule, SpaceModelModule],
  controllers: [CheckupController, CheckupProtocolController, CheckupDisplayController],
  providers: [CheckupService, CheckupProtocolService, CheckupProgramService, CheckupContractService, CheckupQuestionnaireService, CheckupStationService, CheckupTestMasterService, PrismaClinicAdapter, PdfGenerationService],
  exports: [CheckupService, CheckupProtocolService, CheckupProgramService, CheckupContractService, CheckupQuestionnaireService, CheckupStationService, CheckupTestMasterService, PrismaClinicAdapter],
})
export class CheckupModule {}
