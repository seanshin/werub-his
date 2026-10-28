import { Module } from '@nestjs/common';
import { SpecialtyCountsController } from './specialty-counts.controller';
import { SectionCountsController } from './section-counts.controller';

@Module({
  controllers: [SpecialtyCountsController, SectionCountsController],
})
export class SpecialtyCountsModule {}
