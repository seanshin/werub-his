import { Module } from '@nestjs/common';
import { OmopCdmService } from './omop-cdm.service';
import { OmopCdmController } from './omop-cdm.controller';

@Module({
  controllers: [OmopCdmController],
  providers: [OmopCdmService],
  exports: [OmopCdmService],
})
export class OmopCdmModule {}
