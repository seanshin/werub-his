import { Module } from '@nestjs/common';
import { DocumentModule } from '../document/document.module';
import { PrescriptionIssueController } from './prescription-issue.controller';
import { PrescriptionIssueService } from './prescription-issue.service';

@Module({
  imports: [DocumentModule],
  controllers: [PrescriptionIssueController],
  providers: [PrescriptionIssueService],
})
export class PrescriptionIssueModule {}
