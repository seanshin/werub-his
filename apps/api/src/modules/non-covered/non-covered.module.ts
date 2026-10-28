import { Module } from '@nestjs/common';
import { NonCoveredController } from './non-covered.controller';
import { NonCoveredService } from './non-covered.service';

@Module({
  controllers: [NonCoveredController],
  providers: [NonCoveredService],
})
export class NonCoveredModule {}
