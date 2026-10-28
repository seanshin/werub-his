import { Module } from '@nestjs/common';
import { ReferenceRangeController } from './reference-range.controller';
import { ReferenceRangeService } from './reference-range.service';

@Module({
  controllers: [ReferenceRangeController],
  providers: [ReferenceRangeService],
  exports: [ReferenceRangeService],
})
export class ReferenceRangeModule {}
