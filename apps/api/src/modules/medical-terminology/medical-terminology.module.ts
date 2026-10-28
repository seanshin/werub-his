import { Module } from '@nestjs/common';
import { MedicalTerminologyService } from './medical-terminology.service';
import { MedicalTerminologyController } from './medical-terminology.controller';

@Module({
  
  controllers: [MedicalTerminologyController],
  providers: [MedicalTerminologyService],
  exports: [MedicalTerminologyService],
})
export class MedicalTerminologyModule {}
