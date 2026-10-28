import { Module } from '@nestjs/common';
import { MedicalRecordSearchController } from './medical-record-search.controller';
import { MedicalRecordSearchService } from './medical-record-search.service';

@Module({
  
  controllers: [MedicalRecordSearchController],
  providers: [MedicalRecordSearchService],
})
export class MedicalRecordSearchModule {}
