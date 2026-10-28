import { Module } from '@nestjs/common';
import { DocumentSignController } from './document-sign.controller';
import { DocumentSignService } from './document-sign.service';

@Module({
  controllers: [DocumentSignController],
  providers: [DocumentSignService],
  exports: [DocumentSignService],
})
export class DocumentSignModule {}
