import { Module } from '@nestjs/common';
import { CodeMasterController } from './code-master.controller';
import { CodeMasterService } from './code-master.service';
import { AutoMapperService } from './auto-mapper.service';
import { CodeUsageService } from './code-usage.service';
import { CodeImportService } from './code-import.service';
import { CodeSynonymService } from './code-synonym.service';
import { CodeDuplicateService } from './code-duplicate.service';
import { CodeExportService } from './code-export.service';
import { CodeCategoryDeriveService } from './code-category-derive.service';
import { AtcMappingImportService } from './atc-mapping-import.service';
import { ReferenceDatasetService } from './reference-dataset.service';
import { DrgReferenceService } from './drg-reference.service';
import { MedicalAiModule } from '../medical-ai/medical-ai.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  imports: [MedicalAiModule, ConfigRuntimeModule],
  controllers: [CodeMasterController],
  providers: [
    CodeMasterService,
    AutoMapperService,
    CodeUsageService,
    CodeImportService,
    CodeSynonymService,
    CodeDuplicateService,
    CodeExportService,
    CodeCategoryDeriveService,
    AtcMappingImportService,
    ReferenceDatasetService,
    DrgReferenceService,
  ],
  exports: [
    CodeMasterService,
    AutoMapperService,
    CodeUsageService,
    CodeImportService,
    CodeSynonymService,
    CodeDuplicateService,
    CodeExportService,
    CodeCategoryDeriveService,
    AtcMappingImportService,
    ReferenceDatasetService,
    DrgReferenceService,
  ],
})
export class CodeMasterModule {}
