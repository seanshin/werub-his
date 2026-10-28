import { Module } from '@nestjs/common';
import { PathologyController } from './pathology.controller';
import { PathologyService } from './pathology.service';

@Module({
  controllers: [PathologyController],
  providers: [PathologyService],
})
export class PathologyModule {}
