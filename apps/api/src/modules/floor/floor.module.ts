import { Module } from '@nestjs/common';
import { FloorController } from './floor.controller';
import { FloorService } from './floor.service';
import { FloorLocationListener } from './floor-location.listener';

@Module({
  controllers: [FloorController],
  providers: [FloorService, FloorLocationListener],
  exports: [FloorService],
})
export class FloorModule {}
