import { Module } from '@nestjs/common';
import { NursingNoteController } from './nursing-note.controller';
import { NursingNoteService } from './nursing-note.service';

@Module({
  controllers: [NursingNoteController],
  providers: [NursingNoteService],
  exports: [NursingNoteService],
})
export class NursingNoteModule {}
