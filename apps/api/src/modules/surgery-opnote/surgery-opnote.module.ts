import { Module } from '@nestjs/common';
import { SurgeryOpnoteController } from './surgery-opnote.controller';
import { SurgeryOpnoteService } from './surgery-opnote.service';

@Module({
  controllers: [SurgeryOpnoteController],
  providers: [SurgeryOpnoteService],
})
export class SurgeryOpnoteModule {}
