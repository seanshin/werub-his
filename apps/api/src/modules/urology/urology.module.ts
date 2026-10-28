import { Module } from '@nestjs/common';
import { UrologyController } from './urology.controller';
import { UrologyService } from './urology.service';

@Module({
  controllers: [UrologyController],
  providers: [UrologyService],
})
export class UrologyModule {}
