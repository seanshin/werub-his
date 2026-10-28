import { Module } from '@nestjs/common';
import { BedController } from './bed.controller';
import { BedService } from './bed.service';
import { BedBoardController } from './bed-board.controller';
import { BedBoardService } from './bed-board.service';

@Module({

  controllers: [BedController, BedBoardController],
  providers: [BedService, BedBoardService],
  exports: [BedService],
})
export class BedModule {}
