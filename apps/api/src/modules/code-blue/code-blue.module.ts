import { Module } from '@nestjs/common';
import { CodeBlueController } from './code-blue.controller';
import { CodeBlueService } from './code-blue.service';

@Module({
  controllers: [CodeBlueController],
  providers: [CodeBlueService],
})
export class CodeBlueModule {}
