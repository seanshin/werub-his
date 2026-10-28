import { Module } from '@nestjs/common';
import { LabController } from './lab.controller';
import { LabService } from './lab.service';
import { CellTherapyController } from './cell-therapy.controller';
import { CellTherapyService } from './cell-therapy.service';
import { GenomicsController } from './genomics.controller';
import { GenomicsService } from './genomics.service';
import { QcController } from './qc.controller';
import { QcService } from './qc.service';
import { DiagnosticsBoardController } from './diagnostics-board.controller';
import { DiagnosticsBoardService } from './diagnostics-board.service';
import { MedicalAiModule } from '../medical-ai/medical-ai.module';
import { ReferenceRangeModule } from '../reference-range/reference-range.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { CriticalValueEscalationService } from './critical-value-escalation.service';

@Module({
  imports: [MedicalAiModule, ReferenceRangeModule, ConfigRuntimeModule],
  controllers: [LabController, CellTherapyController, GenomicsController, QcController, DiagnosticsBoardController],
  providers: [LabService, CellTherapyService, GenomicsService, QcService, DiagnosticsBoardService, CriticalValueEscalationService],
  exports: [LabService],
})
export class LabModule {}
