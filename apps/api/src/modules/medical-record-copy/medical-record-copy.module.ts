import { Module } from '@nestjs/common';
import { MedicalRecordCopyController } from './medical-record-copy.controller';
import { MedicalRecordCopyService } from './medical-record-copy.service';
import { PdfGenerationService } from './pdf-generation.service';

@Module({

  controllers: [MedicalRecordCopyController],
  providers: [MedicalRecordCopyService, PdfGenerationService],
  exports: [MedicalRecordCopyService, PdfGenerationService],
})
export class MedicalRecordCopyModule {}
