import { Module } from '@nestjs/common';
import { EncounterTemplateController } from './encounter-template.controller';
import { EncounterTemplateService } from './encounter-template.service';

@Module({
  
  controllers: [EncounterTemplateController],
  providers: [EncounterTemplateService],
  exports: [EncounterTemplateService],
})
export class EncounterTemplateModule {}
