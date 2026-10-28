import { Module } from '@nestjs/common';
import { CompoundingController } from './compounding.controller';
import { CompoundingService } from './compounding.service';

@Module({
  controllers: [CompoundingController],
  providers: [CompoundingService],
  exports: [CompoundingService],
})
export class CompoundingModule {}
